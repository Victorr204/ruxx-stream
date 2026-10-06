# ruxx stream

Multi-platform movie streaming app (iOS, Android, Android TV, Web/PWA) built with
Expo SDK 57, Supabase (free tier) and Cloudflare R2 for video storage.

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

### 4. Deploy the edge functions

```bash
supabase functions deploy sign-stream-url
supabase functions deploy r2-upload-ticket
supabase functions deploy r2-delete
```

### 5. R2 bucket + secrets

1. Create a Cloudflare R2 bucket (e.g. `ruxx-stream`) and an API token with
   object read/write/delete on that bucket.
2. Give the functions their credentials (never put these in the app):

```bash
supabase secrets set \
  R2_ACCOUNT_ID=your_account_id \
  R2_ACCESS_KEY_ID=your_access_key_id \
  R2_SECRET_ACCESS_KEY=your_secret_access_key \
  R2_BUCKET_NAME=ruxx-stream
```

### 6. Promote yourself to admin

Create your account in the app, then run:

```sql
update public.profiles
  set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

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
