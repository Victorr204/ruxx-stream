# ruxx stream — desktop app (Windows / macOS)

An Electron shell around the existing Expo web export. The renderer is the
exact bundle the website runs — same code, same Supabase project — with a
few desktop-only capabilities layered on through `window.ruxxDesktop`
(`preload.js`):

- **Premium-only**: no ads anywhere in the app (AdSense is not allowed in
  desktop apps), and free accounts get the subscribe wall on Play
  (`src/hooks/useDesktopPremiumLock.ts`). Admins bypass the gate.
- **Premium offline downloads**: sealed with AES-256-GCM at rest
  (`downloads.js`, byte-compatible with `src/lib/crypto.ts`), master key in
  the OS keystore via `safeStorage`.
- **Auto-updates** from `https://app.ruxxdigital.name.ng/downloads`
  (electron-builder generic feed + electron-updater).
- External links (Paystack checkout, legal pages) open in the default
  browser.

## Layout

| File | Purpose |
| --- | --- |
| `main.js` | Window, ad-network blocking, deep links, auto-update |
| `preload.js` | The `ruxxDesktop` bridge (contextBridge, no Node in the page) |
| `protocol.js` | `app://` protocol serving the bundled export + offline copies |
| `downloads.js` | Download/seal/decrypt engine (Node fs + crypto) |
| `electron-builder.yml` | NSIS `.exe` (x64/arm64) + `.dmg` (x64/arm64) targets |
| `assets/icon.png` | 1024×1024 source icon — builder derives `.ico`/`.icns` |

## Local development

```bash
# 1. one-time: install the desktop shell's own dependencies
npm --prefix desktop install

# 2. build the web bundle (repo root)
npm run web:export

# 3. run the shell against it
npm run desktop:start      # = npm --prefix desktop start
```

Both are plain `npm` scripts from the repo root. To iterate on renderer
code, re-run `npm run web:export` and reload the window (Ctrl/Cmd+R).

## Building installers

```bash
npm run web:export          # from the repo root
npm run desktop:dist        # writes desktop/release/*.exe and *.dmg
```

or per platform:

```bash
npm --prefix desktop run dist:win
npm --prefix desktop run dist:mac    # must run on macOS
```

> macOS installers can only be built on a Mac (or a macOS CI runner) — the
> GitHub Actions workflow `.github/workflows/desktop.yml` does both platforms.

## Releasing

1. Bump `version` in **both** `package.json` (root) and `desktop/package.json`.
2. Tag and push: `git tag v1.1.0 && git push --tags`.
3. CI builds the installers; on success copy these files into the site's
   `/downloads` folder (or set the `RUXX_DEPLOY_*` secrets and the deploy
   job does it):
   - `ruxx-stream-setup-<version>-x64.exe`, `ruxx-stream-setup-<version>-arm64.exe`
   - `ruxx-stream-<version>-arm64.dmg`, `ruxx-stream-<version>-x64.dmg`
   - `latest.yml` (+ `latest.yml.blockmap`, `*.blockmap`) — required for
     auto-updates.
4. Point the download buttons on the website at those files
   (see `WEBSITE_LINKS.md`).

## Code signing (optional, later)

Installers are unsigned today, so Windows shows SmartScreen's "Unknown
publisher" page (More info → Run anyway) and macOS asks users to
right-click → Open the first time. To remove those warnings later:

- **Windows**: set `CSC_LINK` + `CSC_KEY_PASSWORD` (or `win.certificateFile`)
  when building.
- **macOS**: remove `identity: null` from `electron-builder.yml` and provide
  `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` for notarization.

No code changes are needed.
