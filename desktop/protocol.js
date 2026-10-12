// app:// protocol — serves the bundled Expo web export (and decrypted
// offline copies) without any network or dev server.
//
//   app://app/            → dist/index.html        (the app's landing route)
//   app://app/home        → dist/home.html
//   app://app/movie/123   → dist/movie/[id].html   (expo static route files)
//   app://offline/<file>  → <downloads dir>/<file> (transient playback copy)
//
// The route mapping lives in routes.js (pure Node, unit-tested); this file
// only wires it into Electron.

const path = require("path");
const { net, protocol } = require("electron");
const { pathToFileURL } = require("url");

const { isFile, resolveBundleFile } = require("./routes");

const BUNDLE_HOST = "app";
const OFFLINE_HOST = "offline";

let bundleRoot = null;
let offlineRoot = null;

/** Register the scheme as standard/secure before app.ready. */
function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

function notFound() {
  return new Response("Not found", { status: 404 });
}

/** Wire protocol.handle("app", …). Call after app.whenReady(). */
function start({ bundleDir, offlineDir }) {
  bundleRoot = bundleDir;
  offlineRoot = offlineDir;

  protocol.handle("app", (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return notFound();
    }

    if (url.hostname === OFFLINE_HOST) {
      // Transient decrypted playback copies — basename only, never a path.
      const name = path.posix.basename(url.pathname);
      if (!name || !offlineRoot) return notFound();
      const file = path.join(offlineRoot, name);
      return isFile(file) ? net.fetch(pathToFileURL(file).toString()) : notFound();
    }

    if (url.hostname !== BUNDLE_HOST || !bundleRoot) return notFound();

    const file = resolveBundleFile(bundleRoot, url.pathname);
    if (file) return net.fetch(pathToFileURL(file).toString());

    // Unknown paths fall back to the app shell (client router decides).
    const fallback = path.join(bundleRoot, "index.html");
    return isFile(fallback) ? net.fetch(pathToFileURL(fallback).toString()) : notFound();
  });
}

module.exports = { registerSchemes, start, BUNDLE_HOST, OFFLINE_HOST };
