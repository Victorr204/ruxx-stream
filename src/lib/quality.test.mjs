import assert from "node:assert/strict";
import test from "node:test";

import {
  bitRateLabel,
  matchLevel,
  parseMasterLevels,
  qualityLabel,
  resolveVariantUrl,
  sortLevelsDesc,
} from "./quality.ts";

const MASTER = [
  "#EXTM3U",
  "#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI=\"iframe.m3u8\"",
  "#EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=4500000,RESOLUTION=1920x1080",
  "v-1080.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720",
  "v-720.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480",
  "/abs/v-480.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360",
  "v-360.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS=\"mp4a.40.2\"",
  "audio.m3u8",
  "",
].join("\n");

const level = (height, extra = {}) => ({
  id: String(height),
  height,
  width: null,
  bitrate: null,
  label: `${height}p`,
  url: null,
  ...extra,
});

test("labels heights the way the sheet reads them", () => {
  assert.equal(qualityLabel(2160), "4K");
  assert.equal(qualityLabel(4320), "8K");
  assert.equal(qualityLabel(1080), "1080p");
  assert.equal(qualityLabel(null), "Source");
  assert.equal(qualityLabel(0), "Source");
});

test("bitrates read as Mbps above one million", () => {
  assert.equal(bitRateLabel(4_500_000), "4.5 Mbps");
  assert.equal(bitRateLabel(2_000_000), "2 Mbps");
  assert.equal(bitRateLabel(640_000), "640 kbps");
  assert.equal(bitRateLabel(null), null);
});

test("levels sort highest to lowest with bitrate as the tie-break", () => {
  const sorted = sortLevelsDesc([
    level(720, { bitrate: 2_000_000 }),
    level(1080, { bitrate: 1_000_000 }),
    level(720, { bitrate: 3_000_000 }),
    level(2160),
  ]);
  assert.deepEqual(
    sorted.map((l) => [l.height, l.bitrate]),
    [
      [2160, null],
      [1080, 1_000_000],
      [720, 3_000_000],
      [720, 2_000_000],
    ]
  );
});

test("a master playlist parses to sorted levels without audio-only or iframe variants", () => {
  const levels = parseMasterLevels(MASTER, "https://cdn.example.com/hls/master.m3u8");
  assert.deepEqual(
    levels.map((l) => [l.height, l.bitrate, l.url]),
    [
      [1080, 4_500_000, "https://cdn.example.com/hls/v-1080.m3u8"],
      [720, 2_500_000, "https://cdn.example.com/hls/v-720.m3u8"],
      [480, 1_200_000, "https://cdn.example.com/abs/v-480.m3u8"],
      [360, 600_000, "https://cdn.example.com/hls/v-360.m3u8"],
    ]
  );
  assert.equal(levels[0].label, "1080p");
});

test("duplicate heights keep the highest-bitrate variant", () => {
  const text = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720",
    "low.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720",
    "high.m3u8",
  ].join("\n");
  const levels = parseMasterLevels(text, "https://x.test/m.m3u8");
  assert.equal(levels.length, 1);
  assert.equal(levels[0].bitrate, 3_000_000);
  assert.ok(levels[0].url?.endsWith("high.m3u8"));
});

test("absolute variant URIs are kept as-is", () => {
  const text = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720",
    "https://other.example.com/720.m3u8",
  ].join("\n");
  const [parsed] = parseMasterLevels(text, "https://x.test/m.m3u8");
  assert.equal(parsed.url, "https://other.example.com/720.m3u8");
});

test("a signed master's query rides along to same-origin children", () => {
  assert.equal(
    resolveVariantUrl("https://b2.example.com/b/hls/master.m3u8?X-Amz-Signature=abc", "v720.m3u8"),
    "https://b2.example.com/b/hls/v720.m3u8?X-Amz-Signature=abc"
  );
  // Different origin: the signature would be meaningless there.
  assert.equal(
    resolveVariantUrl("https://b2.example.com/b/m.m3u8?sig=1", "https://cdn.example.com/v.m3u8"),
    "https://cdn.example.com/v.m3u8"
  );
});

test("preference matching never upscales past the request", () => {
  const levels = [level(1080), level(720), level(480), level(360)];
  assert.equal(matchLevel(levels, 1080)?.height, 1080);
  assert.equal(matchLevel(levels, 900)?.height, 720);
  assert.equal(matchLevel(levels, 100)?.height, 360);
  assert.equal(matchLevel(levels, 4000)?.height, 1080);
  assert.equal(matchLevel(levels, null)?.height, 1080);
  assert.equal(matchLevel([], 720), null);
});
