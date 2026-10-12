# Download links for the website

Paste this into the separate website repo. Either option below works the same
way for the visitor: the browser starts the download and **the page never
navigates away** (GitHub serves release assets with
`content-disposition: attachment`, so a plain `<a href>` is enough — don't add
`target="_blank"`, and don't `fetch()` the file, GitHub blocks cross-origin
reads of ~90 MB files).

## 1. Permanent GitHub links (recommended, no server needed)

The release workflow uploads every installer **twice**:

- versioned — `ruxx-stream-setup-1.0.0-x64.exe` (what the app's auto-updater
  and humans browsing the releases page see)
- version-less alias — `ruxx-stream-setup-x64.exe`

Link to the **aliases**: `/releases/latest/download/<name>` always redirects to
the newest release, so these URLs never change and the HTML below never needs
editing again.

```
Windows 64-bit          https://github.com/Victorr204/ruxx-stream/releases/latest/download/ruxx-stream-setup-x64.exe
Windows on ARM          https://github.com/Victorr204/ruxx-stream/releases/latest/download/ruxx-stream-setup-arm64.exe
macOS (Apple Silicon)   https://github.com/Victorr204/ruxx-stream/releases/latest/download/ruxx-stream-arm64.dmg
macOS (Intel)           https://github.com/Victorr204/ruxx-stream/releases/latest/download/ruxx-stream-x64.dmg
```

Pinning a specific build instead: use the versioned files,
`.../releases/download/v1.0.1/ruxx-stream-setup-1.0.0-x64.exe`.

## 2. Self-hosted on your own server (optional, enables in-app auto-update)

Copying the files next to the site under `/downloads` is what makes the desktop
app's **auto-updater** work (it polls
`https://app.ruxxdigital.name.ng/downloads/latest.yml`). Set the
`RUXX_DEPLOY_HOST/USER/PATH/KEY` repository secrets and the `deploy` job in
`.github/workflows/desktop.yml` does this automatically on every tag push.

```
/downloads/ruxx-stream-setup-<version>-x64.exe   ← Windows (most laptops)
/downloads/ruxx-stream-setup-<version>-arm64.exe ← Windows on ARM
/downloads/ruxx-stream-<version>-arm64.dmg       ← macOS (Apple Silicon: M1–M4)
/downloads/ruxx-stream-<version>-x64.dmg         ← macOS (Intel)
/downloads/latest.yml                            ← auto-updater feed (keep!)
/downloads/*.blockmap                            ← auto-updater deltas (keep!)
```

## 3. Buttons block (plain HTML — works anywhere)

```html
<section class="ruxx-downloads" id="download">
  <h2>Watch on your laptop</h2>
  <p>
    Install ruxx stream on Windows or macOS — ad-free, with offline
    downloads. Premium membership included.
  </p>

  <div class="ruxx-dl-row">
    <a class="ruxx-dl-btn"
       href="https://github.com/Victorr204/ruxx-stream/releases/latest/download/ruxx-stream-setup-x64.exe">
      <strong>Download for Windows</strong>
      <span>.exe installer · 64-bit</span>
    </a>

    <a class="ruxx-dl-btn"
       href="https://github.com/Victorr204/ruxx-stream/releases/latest/download/ruxx-stream-arm64.dmg">
      <strong>Download for macOS</strong>
      <span>.dmg · Apple Silicon (M1–M4)</span>
    </a>
  </div>

  <details class="ruxx-dl-more">
    <summary>Other versions</summary>
    <a href="https://github.com/Victorr204/ruxx-stream/releases/latest/download/ruxx-stream-setup-arm64.exe">Windows on ARM (Snapdragon)</a>
    <a href="https://github.com/Victorr204/ruxx-stream/releases/latest/download/ruxx-stream-x64.dmg">macOS · Intel</a>
  </details>

  <p class="ruxx-dl-help">
    <strong>Windows:</strong> if SmartScreen says “Windows protected your PC”,
    click <em>More info → Run anyway</em> (the installer isn’t signed yet).<br>
    <strong>macOS:</strong> open the app by right-clicking it → <em>Open</em>
    the first time (Gatekeeper).
  </p>
</section>

<style>
  .ruxx-dl-row { display: flex; gap: .75rem; flex-wrap: wrap; }
  .ruxx-dl-btn {
    display: block; padding: .95rem 1.6rem; border-radius: 14px;
    background: linear-gradient(135deg, #f0c75e, #d4a030); color: #111;
    text-decoration: none; font-weight: 800; min-width: 220px;
    box-shadow: 0 8px 24px rgba(232, 184, 74, .35);
    transition: transform .15s ease;
  }
  .ruxx-dl-btn:hover { transform: translateY(-2px); }
  .ruxx-dl-btn span { display: block; font-size: .8rem; font-weight: 600; opacity: .75; }
  .ruxx-dl-more { margin-top: .9rem; font-size: .9rem; }
  .ruxx-dl-more summary { cursor: pointer; color: #b98c1e; font-weight: 700; }
  .ruxx-dl-more a { display: block; padding: .4rem 0; color: #b98c1e; }
  .ruxx-dl-help { margin-top: 1.25rem; font-size: .85rem; opacity: .7; }
</style>

<script>
  // "Starting download…" feedback + optional counter — never preventDefault,
  // so the download always starts and the page stays put.
  document.querySelectorAll(".ruxx-dl-btn").forEach(function (a) {
    a.addEventListener("click", function () {
      var strong = a.querySelector("strong");
      if (!strong) return;
      var label = strong.textContent;
      strong.textContent = "Starting download…";
      setTimeout(function () { strong.textContent = label; }, 5000);
      // Optional: count installs
      // navigator.sendBeacon("/api/downloads", JSON.stringify({ file: a.href.split("/").pop() }));
    });
  });
</script>
```

Both primary buttons are always visible (a phone can legitimately want either).
If you'd rather auto-pick, reveal only the matching `data-os` button from
`navigator.userAgentData?.platform` — but note browsers cannot distinguish
Apple Silicon from Intel, so the Apple Silicon DMG is the sensible default.

## 4. What happens inside the app

- **No ads at all** — the desktop app is premium-only by design (Google
  forbids AdSense inside desktop apps, and this protects the website's
  AdSense account).
- **Free accounts** can browse the catalog; Play and Download open the
  Premium checkout (Paystack opens in the user's default browser).
- **Premium members** stream ad-free and can save titles offline
  (encrypted at rest).
- The app **auto-updates** itself — but only from the `/downloads` files in
  option 2. Without those, installed copies stay on the version they were
  downloaded with.
