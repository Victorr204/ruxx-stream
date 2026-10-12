// Route mapping for the app:// protocol: the desktop shell serves the
// static Expo export, which names dynamic routes with literal brackets
// (`movie/[id].html`) — exactly how static hosts rewrite `/movie/123`.
// These tests pin the mapping (and the path-traversal guard) down.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveBundleFile } from "./routes.js";

function makeExportFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruxx-dist-"));
  const files = [
    "index.html",
    "home.html",
    "login.html",
    "admin/index.html",
    "movie/[id].html",
    "player/[id].html",
    "category/[id].html",
    "list/[id].html",
    "downloads.html",
    "_expo/static/js/web/entry-abc123.js",
    "assets/logo.deadbeef.png",
  ];
  for (const file of files) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `<!-- ${file} -->`);
  }
  return root;
}

const root = makeExportFixture();
const resolve = (p) => resolveBundleFile(root, p);
const rel = (p) => (p ? path.relative(root, p).split(path.sep).join("/") : null);

test("static pages map onto their exported files", () => {
  assert.equal(rel(resolve("/")), "index.html");
  assert.equal(rel(resolve("")), "index.html");
  assert.equal(rel(resolve("/home")), "home.html");
  assert.equal(rel(resolve("/home/")), "home.html");
  assert.equal(rel(resolve("/downloads")), "downloads.html");
  assert.equal(rel(resolve("/admin")), "admin/index.html");
});

test("dynamic routes fall onto the bracket route files", () => {
  assert.equal(rel(resolve("/movie/123")), "movie/[id].html");
  assert.equal(rel(resolve("/player/abc-def")), "player/[id].html");
  assert.equal(rel(resolve("/category/7")), "category/[id].html");
  assert.equal(rel(resolve("/list/9")), "list/[id].html");
});

test("assets and query strings resolve exactly", () => {
  assert.equal(rel(resolve("/_expo/static/js/web/entry-abc123.js")), "_expo/static/js/web/entry-abc123.js");
  assert.equal(rel(resolve("/assets/logo.deadbeef.png")), "assets/logo.deadbeef.png");
  assert.equal(rel(resolve("/movie/123?utm=1#x")), "movie/[id].html");
});

test("unknown pages fall back to the app shell", () => {
  assert.equal(rel(resolve("/totally/unknown/thing")), "index.html");
});

test("path traversal never escapes the export directory", () => {
  const attacks = [
    "/../secret.txt",
    "/..%2f..%2fsecret.txt",
    "/movie/../../secret.txt",
    "/%2e%2e/secret.txt",
  ];
  for (const attack of attacks) {
    const resolved = resolve(attack);
    if (resolved) {
      assert.ok(
        resolved.startsWith(root + path.sep),
        `traversal escaped the root: ${attack} → ${resolved}`
      );
    }
  }
});
