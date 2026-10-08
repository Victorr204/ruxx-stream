import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOSAVE_INTERVAL_SECONDS,
  buildCuePoints,
  closingMarginSeconds,
  dueCuePoint,
  initialResumePosition,
  isCompleted,
  progressFraction,
  shouldAutosave,
} from "./playback.ts";

test("manual mid-roll markers win over the interval cadence", () => {
  const points = buildCuePoints({
    manualSeconds: [720, 360, 720],
    runtimeSeconds: 888,
    intervalSeconds: 300,
  });
  assert.deepEqual(points, [360, 720]);
});

test("interval cadence fills in when no manual markers exist", () => {
  const points = buildCuePoints({
    manualSeconds: [],
    runtimeSeconds: 1000,
    intervalSeconds: 300,
  });
  assert.deepEqual(points, [300, 600, 900]);
});

test("cue points stay out of the final 30 seconds", () => {
  const points = buildCuePoints({ manualSeconds: [360, 990], runtimeSeconds: 1000 });
  assert.deepEqual(points, [360]);

  const interval = buildCuePoints({ manualSeconds: [], runtimeSeconds: 620, intervalSeconds: 300 });
  assert.deepEqual(interval, [300]);
});

test("disabled mid-rolls produce no cue points", () => {
  assert.deepEqual(buildCuePoints({ manualSeconds: [360], runtimeSeconds: 900, midRollEnabled: false }), []);
});

test("titles too short for the interval cadence get a midpoint cue", () => {
  assert.deepEqual(buildCuePoints({ manualSeconds: [], runtimeSeconds: 120, intervalSeconds: 300 }), [60]);
  assert.deepEqual(buildCuePoints({ manualSeconds: [], runtimeSeconds: 250, intervalSeconds: 300 }), [125]);
  assert.deepEqual(buildCuePoints({ manualSeconds: [], runtimeSeconds: 30, intervalSeconds: 300 }), [15]);
  assert.deepEqual(buildCuePoints({ manualSeconds: [], runtimeSeconds: 4, intervalSeconds: 300 }), [2]);
});

test("a marker inside the shrinking tail of a short title still yields the midpoint cue", () => {
  assert.deepEqual(buildCuePoints({ manualSeconds: [50], runtimeSeconds: 60 }), [30]);
});

test("one-second titles produce no mid-roll", () => {
  assert.deepEqual(buildCuePoints({ manualSeconds: [], runtimeSeconds: 1, intervalSeconds: 300 }), []);
});

test("unknown runtime keeps manual markers but skips the interval cadence", () => {
  assert.deepEqual(buildCuePoints({ manualSeconds: [120], runtimeSeconds: null }), [120]);
  assert.deepEqual(buildCuePoints({ manualSeconds: [], runtimeSeconds: null, intervalSeconds: 60 }), []);
});

test("dueCuePoint fires once per marker and skips consumed cues", () => {
  const cues = [300, 600];

  assert.equal(dueCuePoint(cues, 100, 0), null);
  assert.equal(dueCuePoint(cues, 305, 0), 300);

  // Consumed => the same marker never fires twice...
  assert.equal(dueCuePoint(cues, 310, 300), null);
  // ...but the next one still can.
  assert.equal(dueCuePoint(cues, 640, 300), 600);

  // Resuming past a marker (lastConsumed >= cue) skips it entirely.
  assert.equal(dueCuePoint(cues, 640, 640), null);
});

test("initialResumePosition honours thresholds and completion", () => {
  const base = { position_seconds: 0, duration_seconds: 900 };

  assert.equal(initialResumePosition(null), 0);
  assert.equal(initialResumePosition({ ...base, position_seconds: 5, completed: false }), 0);
  assert.equal(initialResumePosition({ ...base, position_seconds: 400 }), 400);
  assert.equal(initialResumePosition({ ...base, position_seconds: 400, completed: true }), 0);
  // Near the end => restart instead of resuming on the credits.
  assert.equal(initialResumePosition({ ...base, position_seconds: 895 }), 0);
});

test("autosave triggers every 10 seconds of playback", () => {
  assert.equal(AUTOSAVE_INTERVAL_SECONDS, 10);
  assert.equal(shouldAutosave(0, 9), false);
  assert.equal(shouldAutosave(0, 10), true);
  assert.equal(shouldAutosave(40, 49), false);
  assert.equal(shouldAutosave(40, 50), true);
});

test("isCompleted uses the closing margin", () => {
  assert.equal(isCompleted(899, 900), true);
  assert.equal(isCompleted(885, 900), true);
  assert.equal(isCompleted(884, 900), false);
  assert.equal(isCompleted(800, 900), false);
  assert.equal(isCompleted(500, 0), false);
});

test("short titles play nearly to the end before completing", () => {
  assert.equal(isCompleted(27, 30), true);
  assert.equal(isCompleted(26.9, 30), false);
  assert.equal(isCompleted(9, 10), true);
  assert.equal(isCompleted(8.9, 10), false);
  assert.equal(isCompleted(0.9, 1), true);
  assert.equal(isCompleted(0, 1), false);
  assert.equal(isCompleted(0, 0), false);
  assert.equal(closingMarginSeconds(900), 15);
  assert.equal(closingMarginSeconds(30), 3);
  assert.equal(closingMarginSeconds(0), 0);
});

test("progressFraction clamps to 0..1", () => {
  assert.equal(progressFraction(450, 900), 0.5);
  assert.equal(progressFraction(-10, 900), 0);
  assert.equal(progressFraction(1200, 900), 1);
  assert.equal(progressFraction(100, 0), 0);
  assert.ok(Number.isNaN(progressFraction(NaN, 900)) === false);
});
