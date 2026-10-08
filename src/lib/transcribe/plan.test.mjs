import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAudioPlan,
  firstSampleAtOrAfter,
  PlanError,
} from "./plan.ts";

test("buildAudioPlan maps offsets, timestamps and merges contiguous runs", () => {
  const plan = buildAudioPlan({
    timescale: 48000,
    durationUnits: 4 * 1024,
    chunkOffsets: [1000, 1124, 2000, 2124],
    sampleSizes: [100, 100, 124, 124, 80, 80, 90, 90],
    stsc: [{ firstChunk: 1, samplesPerChunk: 2 }],
    stts: [{ count: 8, delta: 1024 }],
  });

  assert.equal(plan.totalSamples, 8);
  assert.equal(plan.offsets[0], 1000);
  assert.equal(plan.offsets[2], 1124);
  assert.equal(plan.offsets[4], 2000);
  assert.equal(plan.offsets[7], 2124 + 90);
  assert.equal(plan.sizes[2], 124);

  // 1024 / 48000 s per sample
  assert.ok(Math.abs(plan.ctsSeconds[1] - 1024 / 48000) < 1e-7);
  assert.ok(Math.abs(plan.ctsSeconds[4] - 4096 / 48000) < 1e-7);

  // Byte-adjacent samples merge; chunk boundaries with gaps start new runs.
  assert.deepEqual(
    plan.runs.map((r) => [r.startByte, r.endByte, r.firstSample, r.endSample]),
    [
      [1000, 1200, 0, 2],
      [1124, 1372, 2, 4],
      [2000, 2160, 4, 6],
      [2124, 2304, 6, 8],
    ]
  );
  assert.ok(plan.durationSeconds >= 8 * 1024 / 48000);
});

test("buildAudioPlan applies stsc run boundaries", () => {
  const plan = buildAudioPlan({
    timescale: 44100,
    durationUnits: 5 * 1024,
    chunkOffsets: [0, 300, 600, 900],
    sampleSizes: [100, 100, 100, 100, 100, 100],
    stsc: [
      { firstChunk: 1, samplesPerChunk: 2 },
      { firstChunk: 3, samplesPerChunk: 1 },
    ],
    stts: [{ count: 6, delta: 1024 }],
  });
  // chunks 1-2 → 2 samples each, chunks 3-4 → 1 sample each
  assert.equal(plan.totalSamples, 6);
  assert.equal(plan.offsets[4], 600);
  assert.equal(plan.offsets[5], 900);
});

test("buildAudioPlan applies ctts offsets", () => {
  const plan = buildAudioPlan({
    timescale: 1000,
    durationUnits: 3000,
    chunkOffsets: [0],
    sampleSizes: [10, 10, 10],
    stsc: [{ firstChunk: 1, samplesPerChunk: 3 }],
    stts: [{ count: 3, delta: 1000 }],
    ctts: [{ count: 3, offset: -50 }],
  });
  assert.ok(Math.abs(plan.ctsSeconds[0] - -0.05) < 1e-6);
  assert.ok(Math.abs(plan.ctsSeconds[2] - 1.95) < 1e-6);
});

test("buildAudioPlan rejects inconsistent tables", () => {
  assert.throws(
    () =>
      buildAudioPlan({
        timescale: 1000,
        durationUnits: 1000,
        chunkOffsets: [0],
        sampleSizes: [10, 10],
        stsc: [{ firstChunk: 1, samplesPerChunk: 1 }],
        stts: [{ count: 1, delta: 1000 }],
      }),
    PlanError
  );
  assert.throws(
    () =>
      buildAudioPlan({
        timescale: 1000,
        durationUnits: 1000,
        chunkOffsets: [],
        sampleSizes: [10],
        stsc: [{ firstChunk: 1, samplesPerChunk: 1 }],
        stts: [{ count: 1, delta: 1000 }],
      }),
    /no chunks/
  );
});

test("firstSampleAtOrAfter binary-searches presentation times", () => {
  const plan = buildAudioPlan({
    timescale: 1000,
    durationUnits: 5000,
    chunkOffsets: [0],
    sampleSizes: [1, 1, 1, 1, 1],
    stsc: [{ firstChunk: 1, samplesPerChunk: 5 }],
    stts: [{ count: 5, delta: 1000 }],
  });
  assert.equal(firstSampleAtOrAfter(plan, 0), 0);
  assert.equal(firstSampleAtOrAfter(plan, 1), 1);
  assert.equal(firstSampleAtOrAfter(plan, 1.001), 2);
  assert.equal(firstSampleAtOrAfter(plan, 9999), 4);
});
