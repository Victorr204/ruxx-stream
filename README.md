# ruxx stream

Multi-platform movie streaming app (iOS, Android, Android TV, Web/PWA) built with
Expo SDK 57, Supabase (free tier) and Backblaze B2 for video storage.

> Content note: only upload media you own or are licensed to distribute.

## Setup

### 1. Create the Supabase project

Create a project at [supabase.com](https://supabase.com) (free tier is enough).

### 2. Paste the env vars

```bash
cp .env.example .env
```

Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
(Project Settings → API). The anon key is safe to ship: every table is behind
Row Level Security. Add `EXPO_PUBLIC_SITE_URL` for the web origin.

### 3. Run the SQL

In the Supabase SQL editor, run in order:

1. `supabase/migrations/20261005090000_ruxx_stream_init.sql` — schema, indexes,
   RLS policies, artwork storage bucket, admin RPCs.
2. `supabase/migrations/20261005090100_seed.sql` — genres, ad units (Google
   **test** IDs), sample titles on public test streams.
3. `supabase/migrations/20261006090000_premium_checkout.sql` — billing
   customer column, billing_events log, privilege guard amendment for the
   webhook.
4. `supabase/migrations/20261006110000_admin_grants_policy.sql` — lets admins
   grant downloads to any user from the console.
5. `supabase/migrations/20261006120000_push_tokens.sql` — Expo push token
   registry (per-account, RLS-owned).
6. `supabase/migrations/20261006130000_paystack_billing.sql` — renames the
   Stripe-era billing columns to generic names and recreates the privilege
   guard against them.

CLI alternative (project linked in `supabase/config.toml`): apply everything in
one shot with

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --project-ref YOUR_PROJECT_REF
```

### 4. Deploy the edge functions

```bash
supabase functions deploy sign-stream-url
supabase functions deploy r2-upload-ticket
supabase functions deploy r2-delete
supabase functions deploy checkout
supabase functions deploy paystack-verify
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy send-push
```

### 5. Backblaze B2 bucket + secrets

1. Create a Backblaze B2 account (no credit card required — first 10GB free),
   create a bucket (e.g. `ruxx-stream`), and an application key with
   `listFiles, readFiles, writeFiles, deleteFiles` on that bucket.
2. Give the functions their credentials (never put these in the app):

```bash
supabase secrets set \
  S3_ENDPOINT=s3.eu-central-003.backblazeb2.com \
  S3_REGION=eu-central-003 \
  S3_ACCESS_KEY_ID=your_application_key_id \
  S3_SECRET_ACCESS_KEY=your_application_key \
  S3_BUCKET=ruxx-stream
```

Any S3-compatible provider works — set `S3_ENDPOINT`/`S3_REGION` to match it.

### 6. Promote yourself to admin

Create your account in the app, then run:

```sql
update public.profiles
  set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

### 7. Paystack premium checkout (optional)

Premium purchases run through Paystack — cards, bank transfer and USSD all
work in Nigeria without an international card. Until the secrets are set,
the Upgrade row keeps its "Premium is coming soon" state.

1. Create a monthly plan (₦1,500 / `150000` kobo) in the Paystack dashboard
   or via the API; copy the plan code (`PLN_…`).
2. Add a webhook endpoint in Paystack pointing at
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook`
   (Paystack signs with your secret key — no separate signing secret).
3. Give the functions their credentials (never put these in the app):

```bash
supabase secrets set \
  PAYSTACK_SECRET_KEY=sk_test_your_key \
  PAYSTACK_PLAN_CODE=PLN_your_plan \
  PAYSTACK_PLAN_AMOUNT=150000
```

The `checkout` function initializes the transaction for the signed-in user
and returns the hosted authorization URL; after the browser returns the app
calls `paystack-verify` for an instant grant, while `paystack-webhook`
stays the source of truth — it verifies the `x-paystack-signature` HMAC,
logs each raw payload once into `billing_events`, and flips
`profiles.is_premium` as the service role.

Google Play / App Store in-app billing come later (Phases 11–12); their
secret placeholders live in `.env.example` until the developer accounts
exist. Everywhere else — web, smart TV browser, sideloaded Android — falls
back to Paystack.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Expo dev server |
| `npm run android` / `ios` / `web` | Run on a platform |
| `npm run android:tv` | Android TV build (`EXPO_TV=1`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` (app + edge functions) |
| `npm test` | `node --test` unit tests (SigV4 presigning, …) |
| `npx expo export --platform web` | Static PWA build into `dist/` |

Native builds go through EAS (`eas build -p android --profile preview`, see
`eas.json` — `android-tv` profile enables TV mode).

## Ads

AdMob **Google test IDs** are seeded and wired up so development never serves
real ads. Replace them before launch. Android TV has no AdMob support — the TV
ad adapter is a no-op.

## Admin console

`Profile → Admin console` (admins only, enforced again by RLS):

- **Catalog** — create/edit movies (sources, artwork, genres, premium
  rendition), hide/show, feature one hero title, two-step delete.
- **Ads** — pre/mid/banner toggles, mid-roll interval, fail-open, and the
  AdMob unit ids per placement (saved config is re-fetched by the player).
- **Grants** — grant/revoke offline downloads for any user.
- **Notify** — broadcast a push announcement to every registered device.

## Notifications

- Members opt in from `Profile → Enable notifications` (permission + Expo
  push token saved to `push_tokens` for their account).
- A local "Download ready" notification fires when a download finishes
  sealing — no server involved.
- Admins broadcast via the `send-push` edge function (admin JWT checked in
  the function; tokens read through the admin RLS policy), chunked against
  the Expo Push Service.
- Web has no notification story — the row and the local notification are
  native-only.

## Offline downloads

Premium members can save **progressive files only** (mp4 / mov / m4v / webm /
mkv) — HLS titles stay streaming-only and say so when tapped. The server
entitlement lives in `download_grants` (written before the transfer starts,
revoked on failure or removal), while transfer state sits in a local manifest
(AsyncStorage `ruxx.downloads.v1`) with files under
`<documents>/ruxx-downloads/`.

- Native only (iOS / Android / TV); the Downloads tab shows
  "Available on mobile" on web.
- The movie page's Download button shows live progress; cancel, retry and
  two-step delete live on the Downloads tab.
- Playback prefers the local file over the network, never plays ads from a
  downloaded copy, and falls back to the manifest's movie snapshot when
  the network is down.
- **Encrypted at rest:** on native, sealed files are stored as AES-256-GCM
  records under `<documents>/ruxx-downloads/<id>.enc` with a per-file key
  wrapped by a device master key held in the Secure Store
  (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Nothing decryptable sits on disk; the
  plaintext is only materialized into a transient playback copy while the
  player is open, and it is wiped on unmount.
