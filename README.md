# ruxx stream

Multi-platform movie streaming app (iOS, Android, Android TV, Web/PWA,
Windows/macOS desktop) built with
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

> **Free-tier rule — 7-file cap.** The Supabase free plan allows at most
> **seven migration files** per project and the set below is already at that
> limit. Until the project is upgraded to a paid plan, **never add an eighth
> file**: append new SQL as a commented, *idempotent* section at the end of
> `supabase/migrations/20261008140000_home_lists_subtitles.sql` (item 7, the
> merged file), then document the section in the list below. Every section must
> be safe to re-run because the whole file is pasted again on each change.
> After the upgrade, switch back to one file per change.

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
7. `supabase/migrations/20261008140000_home_lists_subtitles.sql` — the
   one merged file for everything after the billing migration (the free
   tier is kept to a **seven-file** set, so pending SQL accumulates into
   a single re-runnable file). It contains, in order: the
   `trending_movie_ids` RPC behind the home hero's Trending slide (skip
   it and the slot falls back to new uploads), **My List** (named lists
   per account — free 5 · premium 15, enforced by a trigger — their
   items, and the RLS policies keeping every list private), the four
   curated home categories (Western TV Shows, Nollywood Movies, Korean
   Drama, Bollywood Movies), `movie_subtitles` /
   `movie_subtitle_translations` (admin-uploaded .srt/.vtt files per
   movie plus the machine-translation cache: admins write, everyone
   reads), `movie_subtitles.detected_language` (what the auto-detector
   answered about each uploaded file — null until first use), and
    `movie_subtitles.origin` (`upload` | `generated`, so the audio
    scanner's results stay distinguishable from admin files), and the
    ad cadence move (`ad_settings.mid_roll_interval_seconds` now
    defaults to **600**: one ad per title every interval of wall-clock
    time, persisted per title so the countdown keeps running while the
    viewer is away), and
    premium expiry (`profiles.premium_until` — one-time bank-transfer
    payments grant a bounded window instead of lifetime premium, and
    `public.is_premium()`, the My List quota, the admin counts and the
    privilege guard all honour it). Every
    statement is idempotent: pasting the file on a fresh project brings
    it fully up to date, and re-running on a live one is safe.

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
supabase functions deploy translate-subtitles
supabase functions deploy save-transcript
supabase functions deploy whisper-model --no-verify-jwt
```

`whisper-model` must be deployed with `--no-verify-jwt`: the scanner's
transformers.js fetches plain model files with no `Authorization` header —
the function's path allowlist is the only boundary (it 302s to a
presigned GET inside the private bucket, so nothing ever goes public).

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

3. Upload the scanner's model files (Whisper weights from Hugging Face +
   the ONNX Runtime wasm from `node_modules`) into the bucket. The script
   reads the same `S3_*` names from the environment or `.env`:

   ```bash
   node scripts/upload-whisper-model.mjs          # everything
   node scripts/upload-whisper-model.mjs --wasm   # runtime only
   ```

   Keys land at `models/onnx-community/whisper-tiny/…` and
   `models/whisper-wasm/…` — exactly what `whisper-model` signs
   (`?path=<key under models/>`). Re-run it after bumping
   `@huggingface/transformers` or `onnxruntime-web`.

4. Let the browser read those objects cross-origin. The function answers
   with a redirect, so the *final* GET hits B2 directly and needs a bucket
   CORS rule (B2 console → bucket → CORS rules), e.g.:

   ```json
   [{
     "corsRuleName": "reads",
     "allowedHeaders": ["*"],
     "allowedOperations": ["b2_download_file_by_name", "b2_get_file"],
     "allowedOrigins": ["*"],
     "exposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
     "maxAgeSeconds": 3600
   }]
   ```

   `exposeHeaders` matters: the scanner reads `Content-Range` from Range
   responses to plan its audio-byte fetches. The same rule covers signed
   media streams, so playback seeking works with it too.

### 6. Promote yourself to admin

Create your account in the app, then run:

```sql
update public.profiles
  set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

### 7. Paystack premium checkout (optional)

Premium purchases run through Paystack: the Profile tab shows a single
**Ruxx Premium** row that opens a themed bottom sheet with the price broken
out (₦1,500.00 subscription + ₦112.50 VAT (7.5%) = **₦1,612.50**/month) and
two ways to pay:

- **Pay with Card** — a subscription bound to the monthly plan, so it
  renews automatically. Before opening Paystack, `checkout` pushes the
  plan's amount up to the VAT-inclusive total (`PUT /plan` — Paystack
  charges whatever the plan says and ignores the transaction's `amount`)
  and restricts the page to the card channel, because renewals can only
  draw on a stored card authorization.
- **Pay with Bank Transfer** — a one-time Pay with Transfer charge for
  the same VAT-inclusive total (card kept as a fallback channel). It
  carries `metadata.premium_days = 30`, so `paystack-verify` /
  `paystack-webhook` open `profiles.premium_until` for 30 days instead of
  granting lifetime premium; every premium gate reads that window, and
  `guard_profile_privileges` stops ordinary users from editing it.
  Subscription grants clear the window again.

**First-month promo:** a member who has never been charged (no
`billing_customer_id`) gets the first month for **₦1,075.00** — the
₦1,000.00 base plus the same 7.5% VAT (`PAYSTACK_PROMO_BASE_AMOUNT`) —
on both buttons: a one-time charge (no plan) that buys the same 30-day
window. Their next purchase falls back to the regular prices, since
`checkout` re-checks eligibility server-side.

Until the secrets are set, the row keeps its "Premium is coming soon"
state.

1. Create a monthly plan in the Paystack dashboard or via the API (any
   starting amount works — checkout syncs it to ₦1,612.50 on first use);
   copy the plan code (`PLN_…`).
2. Enable **Pay with Transfer** in your Paystack dashboard settings, or the
   Transfer option will not appear on checkout.
3. Add a webhook endpoint in Paystack pointing at
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook`
   (Paystack signs with your secret key — no separate signing secret).
   The function must keep `verify_jwt` off — Paystack never sends a
   Supabase JWT, and late-confirming transfers depend on the webhook.
4. Give the functions their credentials (never put these in the app):

```bash
supabase secrets set \
  PAYSTACK_SECRET_KEY=sk_test_your_key \
  PAYSTACK_PLAN_CODE=PLN_your_plan \
  PAYSTACK_PLAN_AMOUNT=150000 \
  PAYSTACK_PROMO_BASE_AMOUNT=100000 \
  PAYSTACK_VAT_RATE=7.5 \
  PAYSTACK_PAYMENT_PAGE=https://paystack.shop/pay_your_slug
```

When `PAYSTACK_PAYMENT_PAGE` is set (preferred — a subscription page bound
to the same plan), `checkout` returns that link with the payer's email
prefilled and locked (`read-only=email`); otherwise it initializes a
transaction directly. After the browser returns the app calls
`paystack-verify` for an instant grant (metadata id or exact payer-email
match), while `paystack-webhook` stays the source of truth — it verifies
the `x-paystack-signature` HMAC, logs each raw payload once into
`billing_events`, resolves the account by metadata, payer email, or stored
customer code, and flips `profiles.is_premium` / `premium_until` as the
service role. Bank transfers often confirm only after the browser has
closed, so the webhook is what finishes those.

Google Play / App Store in-app billing come later (Phases 12–13); their
secret placeholders live in `.env.example` until the developer accounts
exist. Everywhere else — web, smart TV browser, sideloaded Android — falls
back to Paystack.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Expo dev server |
| `npm run android` / `ios` / `web` | Run on a platform |
| `npm run android:tv` | Android TV build (`EXPO_TV=1`) |
| `npm run web:export` | Static web build into `dist/` (also the desktop app's bundle) |
| `npm run desktop:start` | Run the Windows/macOS shell against `dist/` |
| `npm run desktop:dist` | Build the desktop installers into `desktop/release/` |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` (app + edge functions) |
| `npm test` | `node --test` unit tests (SigV4 presigning, …) |
| `node scripts/upload-whisper-model.mjs` | Push Whisper weights + ORT wasm into the model bucket |

Native builds go through EAS (`eas build -p android --profile preview`, see
`eas.json` — `android-tv` profile enables TV mode).

## Home

- **Hero carousel** — three slides that auto-advance every 4 seconds
  (swipeable; pauses while a TV/keyboard focus sits on a CTA): the
  admin-featured title first, then the newest upload, then the most-watched
  title ("Trending", via the `trending_movie_ids` RPC — without migration 7
  the slot degrades to another new upload). Gold dots sit top-right.
- **New Movies** shelf — the six latest uploads, with **See all** opening
  `/category/new` (the full newest-first listing). Anything added in the
  last 14 days carries a gold **New** badge on every poster (home,
  category and search).
- **Trending Now** — the eight most-watched titles, ranked by play/resume
  events through the `trending_movie_ids` RPC (migration 7): what most
  people are actually watching right now. Hides itself until the RPC is
  applied.
- **Popular Genres** — chips for the genres with the most active titles
  (count on each card), one tap from `/category/{id}`.
- **Continue Watching** — resume with a progress bar under the poster.
- **Category rows** — capped at the 3 newest titles per genre so the feed
  stays light no matter how large the catalog grows; every older title
  stays one tap away behind **See all**, which opens `/category/{id}` —
  the full paginated listing (30 per page) of that genre, newest first.
  As new uploads arrive they take the shelf and push older ones out to
  See all.
- **Curated categories** — Western TV Shows, Nollywood Movies, Korean
  Drama and Bollywood Movies ship as genres of their own: tag a movie
  with one in the admin console and its home row, category page and
  Popular Genres chip light up automatically.

## Subtitles

- **Audio scanner** — a movie with no uploaded file can build its own
  source track: the sheet's **Scan audio for subtitles** card runs
  on-device Whisper (`src/lib/transcribe/`) over the movie's audio —
  mp4 sample-table parsing + Range fetches for the audio bytes only,
  WebCodecs decode (with a silent capture-worklet fallback), then
  `whisper-tiny` through transformers.js (WebGPU with wasm fallback) —
  auto-detects the spoken language, converts the result to cues and
  saves them through the `save-transcript` edge function as an
  `origin: 'generated'` row. Any signed-in viewer can start a scan;
  results are stored once per movie+language and shared by everyone,
  and a second scan refuses to overwrite an admin's upload. Progress
  survives reloads (IndexedDB checkpoints + 5-minute segment grid), the
  engine runs in a hidden web frame / native WebView at `/transcribe`,
  and model bytes come from the private bucket via the `whisper-model`
  302 signer — no third-party STT ever sees the audio. Hidden on TV.
- **Admin uploads** — the movie editor's **Subtitles** section takes
  `.srt`/`.vtt` files: pick the language, upload, done. Files are parsed
  and validated before saving (one file per movie + language, replace to
  update, trash to remove).
- **Player** — the language button in the player's top bar opens the
  subtitle sheet, which keeps the two sources apart on purpose:
  **Uploaded subtitles** (solid rows, cloud icon — the admin's file, played
  exactly as uploaded, never routed through the generator) and **In-app
  generator** (dashed gold rows, sparkles icon — languages with no file,
  made on demand). The choice is remembered across titles, and a failed
  generation leaves whatever subtitle was already on screen alone instead
  of blanking it.
- **Automatic language detection** — opening the sheet auto-detects which
  language the movie's source subtitle track is actually written in (its
  movie language, in the usual case) and shows it in the **Movie
  language** card, so a title whose subtitles are in nobody's language is
  obvious before you pick a target. Detection reads the cue text itself —
  script rules and function-word counts first (`src/lib/subtitles.ts`,
  free and instant), the translator's own auto-detect only when those
  aren't confident — and the answer is stored in
  `movie_subtitles.detected_language`, so the first viewer of a title pays
  once and everyone after is instant. When neither answers, the card says
  so and falls back to the file's declared label. Guests can see the
  detection — only generating needs a session.
- **In-app generator** — picking a language with no uploaded file calls
  the `translate-subtitles` edge function, which translates the source
  file (English preferred, otherwise the first upload — the sheet's card
  tells you which one) chunk-by-chunk and caches the result in
  `movie_subtitle_translations`. Repeat views load instantly; replacing
  the source file purges its translations automatically. Translation
  needs a signed-in session; uploaded files play for guests too.
  Titles with no uploaded subtitle file can't be generated from — the
  sheet says so instead of offering a dead list.

## My Lists

- **My List tab** in the navbar — the account's named lists ("Watch
  later", "Favorites", …). Create one from the tab (name input + gold
  **Create** button), tap to open `/list/{id}` (its titles, 30 per page),
  long-press to arm a two-step delete.
- **Limits** — free accounts create up to **5** lists, premium up to
  **15**. The cap is enforced twice: a friendly check in the app (with a
  Premium pointer) and `enforce_user_list_limit()` in the database, so the
  API can't be bypassed.
- **Adding titles** — every movie page has a **My List** button under
  Play/Download. It opens a sheet with your lists (tap to toggle this
  title in/out) plus an inline create field that saves the movie into the
  new list straight away.
- **Privacy** — `user_lists` / `user_list_items` are RLS-owned per
  account (`user_id = auth.uid()`); list items also verify the list
  belongs to the caller.

## Ads

Pre-roll and mid-roll breaks both play everywhere:

- **Native builds** show AdMob interstitials using the unit ids from
  Admin → Ads. **Google test IDs** are seeded so development never serves
  real ads — replace them before launch (apps need AdMob
  `ca-app-pub-…/…` ids; an AdSense `pub-…` publisher id is for websites
  and will not work in the app).
- **Web, Android TV and Expo Go** have no AdMob engine, so each break
  plays the in-app house overlay (countdown + skip). The "fail open"
  toggle only governs real AdMob request failures on native.
- **The Windows/macOS desktop app shows no ads at all.** It is a
  premium-only surface: every placement is disabled in the shell
  (`src/stores/adsConfig.ts`), and the Electron main process blocks ad
  network requests outright — Google's AdSense policies allow its code on
  websites only, so loading it inside an installed app would risk the
  publisher account that monetizes the website.
- Mid-rolls fire on a wall-clock cadence: one ad per title every
  `mid_roll_interval_seconds` (default 600) of real time since the last ad,
  persisted per title so leaving and returning inside the window plays with
  no ads at all.

## Admin console

`Profile → Admin console` (admins only, enforced again by RLS):

- **Catalog** — create/edit movies with zero URL entry: metadata (title,
  synopsis, year, rating, genres, active/featured), **upload the video
  file** (it streams to Backblaze B2; playback uses signed URLs) and
  **upload the poster/backdrop** (public `artwork` bucket), hide/show,
  feature one hero title (it opens the first slide of the auto-sliding
  hero carousel), two-step delete (row first, then the B2 video
  object and poster/backdrop are removed from storage — a warning surfaces
  if storage cleanup partially fails). The runtime field accepts
  decimals (`0.5` = 30 seconds) so sub-minute clips save — and they play
  in full. Premium members get the same
  object for streaming and download grants. Browser-based admin video
  uploads also need a PUT CORS rule on the B2 bucket; the native app does
  not. Saved movies also gain a **Subtitles** section for uploading
  `.srt`/`.vtt` files per language (see **Subtitles** below).
- **Ads** — pre/mid/banner toggles, mid-roll interval, fail-open, and the
  AdMob unit ids per placement (saved config is re-fetched by the player).
- **Grants** — grant/revoke offline downloads for any user.
- **Notify** — broadcast a push announcement to every registered device.

### Video upload pipeline

Picking a movie file runs pick → probe → compress → presigned B2 PUT →
save, with live progress and a cancel button at every stage:

- **Compression** (native builds only) targets ~150MB with a **quality
  floor of 700 kbps** — the floor always wins, so long movies can exceed
  150MB rather than getting crushed. Sources already under the target, or
  where the floor would not shrink the file, are uploaded unchanged. Audio
  is fixed at 128 kbps; resolution is preserved (cap 7680). The estimated
  size and chosen bitrate are shown while compressing.
- **Native only** — compression uses `react-native-compressor` (Nitro), so
  it needs a dev build or store build, not Expo Go. In Expo Go the picker,
  upload and progress UI all still work — compression is skipped and the
  inline warning tells the admin to rebuild. The web console skips
  compression entirely: the original file is uploaded and the UI states
  "Browser uploads aren't compressed — use the mobile app for large
  titles."
- **Failure policy** — if compression fails the upload falls back to the
  original file automatically and shows an inline warning; cancelling
  anywhere aborts cleanly and deletes any temp output.
- **Progress** — `probing` / `compressing` / `uploading` stages as one
  bar with byte counts; browser uploads use XHR `upload.onprogress`
  (native uses `expo-file-system` upload tasks).

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

## Desktop app (Windows / macOS)

`desktop/` wraps the same web export in Electron, so the installer users
download is the app they already know from the browser — plus real offline
downloads and auto-updates:

- **Premium-only, ad-free** — free accounts browse the catalog, but Play
  and Download open the Premium checkout (`useDesktopPremiumLock`); admins
  bypass the gate. Every ad placement is disabled in the shell and ad
  network requests are blocked in `desktop/main.js`.
- **Offline downloads** work through the Electron main process
  (`desktop/downloads.js`) in the same AES-256-GCM record format the mobile
  apps use; the device master key lives in the OS keystore via
  `safeStorage`. Manifest state stays in the renderer, entitlement still
  goes through `download_grants`.
- **Paystack checkout** opens in the user's default browser; the existing
  verification polling unlocks Premium in the app once the webhook lands.
- **Auto-updates** come from the site's `/downloads` folder
  (electron-updater, generic feed). Installers ship **unsigned** for now:
  Windows shows SmartScreen (More info → Run anyway), macOS needs
  right-click → Open once.

Build with `npm run web:export` then `npm run desktop:dist`, or let
`.github/workflows/desktop.yml` build both platforms on a tag push.
Release steps, signing notes and the ready-to-paste website download
buttons live in `desktop/README.md` and `desktop/WEBSITE_LINKS.md`.

## Offline downloads

Premium members can save **progressive files only** (mp4 / mov / m4v / webm /
mkv) — HLS titles stay streaming-only and say so when tapped. The server
entitlement lives in `download_grants` (written before the transfer starts,
revoked on failure or removal), while transfer state sits in a local manifest
(AsyncStorage `ruxx.downloads.v1`) with files under
`<documents>/ruxx-downloads/`.

- Native (iOS / Android / TV) and the desktop app; a plain browser tab
  shows "Available on mobile" on the Downloads tab.
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
