import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_VIDEO_BITRATE_BPS,
  TARGET_OUTPUT_BYTES,
  formatBitrate,
  planCompression,
  skipReasonLabel,
} from "./compressPlan.ts";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

test("unknown duration skips with unknown-length", () => {
  const plan = planCompression({ sizeBytes: 2 * GB, durationSeconds: 0 });
  assert.equal(plan.action, "skip");
  assert.equal(plan.reason, "unknown-length");
});

test("unknown size skips with unknown-length", () => {
  const plan = planCompression({ sizeBytes: 0, durationSeconds: 7200 });
  assert.equal(plan.action, "skip");
  assert.equal(plan.reason, "unknown-length");
});

test("files already under the target are left alone", () => {
  const plan = planCompression({ sizeBytes: 120 * MB, durationSeconds: 7200 });
  assert.equal(plan.action, "skip");
  assert.equal(plan.reason, "already-small");
  assert.equal(plan.estimatedBytes, 120 * MB);
});

test("the target size itself counts as already small", () => {
  const plan = planCompression({
    sizeBytes: TARGET_OUTPUT_BYTES,
    durationSeconds: 3600,
  });
  assert.equal(plan.action, "skip");
  assert.equal(plan.reason, "already-small");
});

test("a long 4GB source hits the quality floor and still shrinks", () => {
  const plan = planCompression({ sizeBytes: 4 * GB, durationSeconds: 7200 });
  assert.equal(plan.action, "compress");
  assert.equal(plan.videoBitrateBps, MIN_VIDEO_BITRATE_BPS);
  assert.equal(plan.floorApplied, true);
  assert.equal(plan.estimatedBytes, Math.round(((700_000 + 128_000) * 7200) / 8));
  assert.ok(plan.estimatedBytes < 4 * GB);
});

test("a moderate source computes the raw target bitrate without the floor", () => {
  const plan = planCompression({ sizeBytes: 200 * MB, durationSeconds: 1400 });
  assert.equal(plan.action, "compress");
  assert.equal(plan.floorApplied, false);
  assert.ok(plan.videoBitrateBps > MIN_VIDEO_BITRATE_BPS);
  assert.ok(Math.abs(plan.estimatedBytes - TARGET_OUTPUT_BYTES * 0.98) < 1024);
});

test("the quality floor refuses encodes that would not shrink the file", () => {
  const plan = planCompression({ sizeBytes: 160 * MB, durationSeconds: 7200 });
  assert.equal(plan.action, "skip");
  assert.equal(plan.reason, "not-worth-it");
});

test("compress never lands below the quality floor", () => {
  const plan = planCompression({ sizeBytes: 3 * GB, durationSeconds: 10_800 });
  if (plan.action === "compress") {
    assert.ok(plan.videoBitrateBps >= MIN_VIDEO_BITRATE_BPS);
  }
});

test("formatBitrate renders kbps and Mbps", () => {
  assert.equal(formatBitrate(700_000), "700 kbps");
  assert.equal(formatBitrate(1_500_000), "1.5 Mbps");
  assert.equal(formatBitrate(0), "—");
  assert.equal(formatBitrate(Number.NaN), "—");
});

test("skipReasonLabel covers every skip reason", () => {
  assert.equal(skipReasonLabel("unknown-length"), "duration unknown");
  assert.equal(skipReasonLabel("already-small"), "already under the 150MB target");
  assert.equal(skipReasonLabel("not-worth-it"), "quality floor would not shrink it");
});
