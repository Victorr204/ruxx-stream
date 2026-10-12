// Pure-Node half of the app:// protocol: maps a request pathname onto a
// file inside the bundled Expo static export (no Electron imports, so
// node:test covers it — desktop/routes.test.mjs). protocol.js wires this
// into protocol.handle().
//
// Expo's static export names dynamic routes with literal brackets
// (`movie/[id].html`), the way static hosts rewrite `/movie/123` onto them;
// resolveBundleFile reimplements that mapping.

const fs = require("fs");
const path = require("path");

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Map a request pathname onto a file inside the bundled export. */
function resolveBundleFile(root, rawPathname) {
  let pathname = rawPathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    // keep the raw path when it is not valid percent-encoding
  }
  const clean = pathname.split("?")[0].split("#")[0];
  const rel = path.posix.normalize(clean).replace(/^\/+/, "");
  if (rel.startsWith("..")) return null;

  const direct = path.join(root, rel);
  if (isFile(direct)) return direct;

  // Route pages: "/home" → home.html, "/admin" → admin/index.html,
  // "/movie/123" → movie/[id].html.
  const trimmed = rel.replace(/\/+$/, "");
  const page = trimmed === "" ? "index" : trimmed;
  const segments = page.split("/");
  const candidates = [`${page}.html`, `${page}/index.html`];
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const dynamic = [...segments];
    dynamic.splice(i, 1, "[id]");
    candidates.push(`${dynamic.join("/")}.html`);
  }
  candidates.push("index.html");
  for (const candidate of candidates) {
    const file = path.join(root, candidate);
    if (isFile(file)) return file;
  }
  return null;
}

module.exports = { isFile, resolveBundleFile };
