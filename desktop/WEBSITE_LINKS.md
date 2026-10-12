# Download links for the website

Paste this into the separate website repo. The installers live next to the
site under `/downloads` (same origin as `app.ruxxdigital.name.ng`), which is
also where auto-update checks `latest.yml`.

## 1. Upload these files after every desktop release

```
/downloads/ruxx-stream-setup-<version>-x64.exe   ← Windows (most laptops)
/downloads/ruxx-stream-setup-<version>-arm64.exe ← Windows on ARM
/downloads/ruxx-stream-<version>-arm64.dmg       ← macOS (Apple Silicon: M1–M4)
/downloads/ruxx-stream-<version>-x64.dmg         ← macOS (Intel)
/downloads/latest.yml                            ← auto-updater feed (keep!)
/downloads/*.blockmap                            ← auto-updater deltas (keep!)
```

## 2. Buttons block (plain HTML — works anywhere)

```html
<section class="ruxx-downloads" id="download">
  <h2>Watch on your laptop</h2>
  <p>
    Install ruxx stream on Windows or macOS — ad-free, with offline
    downloads. Premium membership included.
  </p>

  <!-- Shown when JavaScript picks a default (desktop browsers) -->
  <a class="ruxx-dl-btn" href="/downloads/ruxx-stream-setup-1.0.0-x64.exe"
     data-os="windows" hidden>
    <strong>Download for Windows</strong>
    <span>.exe installer · 64-bit</span>
  </a>

  <a class="ruxx-dl-btn" href="/downloads/ruxx-stream-1.0.0-arm64.dmg"
     data-os="mac" hidden>
    <strong>Download for macOS</strong>
    <span>.dmg · Apple Silicon (M1–M4)</span>
  </a>

  <a class="ruxx-dl-btn" href="/downloads/ruxx-stream-1.0.0-x64.dmg"
     data-os="mac-intel" hidden>
    <strong>Download for macOS (Intel)</strong>
    <span>.dmg · Intel Macs</span>
  </a>

  <p class="ruxx-dl-help">
    <strong>Windows:</strong> if SmartScreen says “Windows protected your PC”,
    click <em>More info → Run anyway</em> (the installer isn’t signed yet).<br>
    <strong>macOS:</strong> open the app by right-clicking it → <em>Open</em>
    the first time (Gatekeeper).
  </p>
</section>

<script>
  (function () {
    var ua = navigator.userAgent;
    var isWin = /Windows/i.test(ua);
    var isMac = /Macintosh|Mac OS X/i.test(ua);
    // Apple Silicon vs Intel (rough but good enough for a default button).
    var isAppleSilicon = isMac &&
      (/Macintosh/i.test(ua) && navigator.maxTouchPoints === 0) &&
      !/Intel/i.test(ua) && (navigator.userAgentData?.platform === "macOS");
    document.querySelectorAll(".ruxx-dl-btn").forEach(function (btn) {
      var os = btn.getAttribute("data-os");
      if ((os === "windows" && isWin) ||
          (os === "mac" && isMac) ||
          (os === "mac-intel" && isMac)) {
        btn.hidden = false;
      }
    });
  })();
</script>

<style>
  .ruxx-downloads { text-align: center; padding: 2.5rem 1rem; }
  .ruxx-dl-btn {
    display: inline-block; margin: .5rem; padding: .9rem 1.6rem;
    border-radius: 12px; background: #e8b84a; color: #111;
    text-decoration: none; min-width: 220px;
  }
  .ruxx-dl-btn span { display: block; font-size: .8rem; opacity: .75; }
  .ruxx-dl-help { margin-top: 1.25rem; font-size: .85rem; opacity: .7; }
</style>
```

## 3. Optional: detect the OS automatically

The snippet above reveals the matching button per OS and keeps the others as
fallback links. If your site has a framework, just render the right `href`
from `navigator.userAgent` / `navigator.platform`.

## 4. What happens inside the app

- **No ads at all** — the desktop app is premium-only by design (Google
  forbids AdSense inside desktop apps, and this protects the website's
  AdSense account).
- **Free accounts** can browse the catalog; Play and Download open the
  Premium checkout (Paystack opens in the user's default browser).
- **Premium members** stream ad-free and can save titles offline
  (encrypted at rest).
- The app **auto-updates** itself from these `/downloads` files — always
  upload `latest.yml` and the `.blockmap` files together with the installers,
  and never rename the files (electron-builder's names are the expected ones).
