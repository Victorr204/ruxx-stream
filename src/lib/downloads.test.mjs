import assert from "node:assert/strict";
import test from "node:test";

import {
  formatBytes,
  isDownloadableUrl,
  mediaExtension,
  offlineFileName,
  reconcileManifest,
  resetInterrupted,
  urlPathname,
} from "./downloads.ts";

test("urlPathname strips query strings and hashes", () => {
  assert.equal(
    urlPathname("https://cdn.example.com/v/movie.mp4?X-Amz-Signature=abc#t=10"),
    "https://cdn.example.com/v/movie.mp4"
  );
  assert.equal(urlPathname("https://cdn.example.com/a.mp4"), "https://cdn.example.com/a.mp4");
});

test("mediaExtension parses extensions case-insensitively", () => {
  assert.equal(mediaExtension("https://x.test/v/movie.MP4"), "mp4");
  assert.equal(mediaExtension("https://x.test/v/movie.mp4?sig=1"), "mp4");
  assert.equal(mediaExtension("https://x.test/v/playlist.m3u8"), "m3u8");
  assert.equal(mediaExtension("https://x.test/v/noext"), null);
  assert.equal(mediaExtension("https://x.test/v/.hidden"), null);
  assert.equal(mediaExtension("https://x.test/v/movie."), null);
});

test("isDownloadableUrl accepts progressive files only", () => {
  // Seeded progressive sources
  assert.equal(
    isDownloadableUrl(
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
    ),
    true
  );
  assert.equal(isDownloadableUrl("https://r2.example.com/movies/clip.webm?token=abc"), true);
  assert.equal(isDownloadableUrl("https://r2.example.com/movies/clip.mkv"), true);

  // Seeded HLS sources -> not downloadable
  assert.equal(isDownloadableUrl("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"), false);
  assert.equal(isDownloadableUrl("https://x.test/playlist.m3u8?start=0"), false);
  assert.equal(isDownloadableUrl("https://x.test/manifest.mpd"), false);

  // Unknown / non-media
  assert.equal(isDownloadableUrl("https://x.test/movie.txt"), false);
  assert.equal(isDownloadableUrl("https://x.test/noext"), false);
  assert.equal(isDownloadableUrl(""), false);
});

test("offlineFileName uses the parsed extension", () => {
  assert.equal(
    offlineFileName("abc-123", "https://x.test/m/movie.mp4?sig=1"),
    "abc-123.mp4"
  );
  assert.equal(offlineFileName("abc-123", "https://x.test/m/noext"), "abc-123.bin");
});

test("formatBytes renders base-1024 units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(-5), "0 B");
  assert.equal(formatBytes(NaN), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(12.4 * 1024 * 1024), "12.4 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024), "1 GB");
});

function entry(id, patch = {}) {
  return {
    movieId: id,
    movie: { id },
    state: "ready",
    progress: 1,
    bytesDone: 100,
    totalBytes: 100,
    fileSizeBytes: 100,
    ext: "mp4",
    uri: `file:///doc/${id}.mp4`,
    error: null,
    updatedAt: "2026-10-05T00:00:00.000Z",
    ...patch,
  };
}

test("reconcileManifest drops entries whose file is gone", () => {
  const entries = { a: entry("a"), b: entry("b") };
  const result = reconcileManifest(entries, (id) => id === "a");
  assert.deepEqual(Object.keys(result), ["a"]);

  // Key/identity mismatch is dropped too.
  const mismatched = { a: entry("b") };
  assert.deepEqual(reconcileManifest(mismatched, () => true), {});
});

test("resetInterrupted converts stuck transfers into failures", () => {
  const entries = {
    a: entry("a", { state: "downloading", progress: 0.4, uri: null }),
    b: entry("b"),
    c: entry("c", { state: "failed", error: "boom" }),
  };
  const result = resetInterrupted(entries);

  assert.equal(result.a.state, "failed");
  assert.equal(result.a.error, "Download interrupted");
  assert.equal(result.a.progress, 0.4); // progress preserved for display
  assert.equal(result.b.state, "ready");
  assert.equal(result.c.error, "boom"); // untouched
  // Pure: input not mutated.
  assert.equal(entries.a.state, "downloading");
});
