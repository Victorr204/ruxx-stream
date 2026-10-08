// Pure sample-table planning for the fast-path audio extractor.
//
// mp4box parses the moov boxes; this module turns the raw table arrays
// (stco/co64, stsc, stsz, stts, ctts) into a flat per-sample index plus a
// list of contiguous byte "runs". The extractor then Range-fetches only
// the audio bytes — video bytes are never downloaded.

export type StscEntry = { firstChunk: number; samplesPerChunk: number };
export type SttsEntry = { count: number; delta: number };
export type CttsEntry = { count: number; offset: number };

export type AudioSampleTables = {
  timescale: number;
  durationUnits: number;
  chunkOffsets: number[];
  sampleSizes: number[];
  stsc: StscEntry[];
  stts: SttsEntry[];
  ctts?: CttsEntry[];
};

export type AudioRun = {
  startByte: number;
  endByte: number;
  firstSample: number;
  endSample: number;
};

export type AudioPlan = {
  totalSamples: number;
  durationSeconds: number;
  offsets: Float64Array;
  sizes: Uint32Array;
  ctsSeconds: Float32Array;
  runs: AudioRun[];
};

export class PlanError extends Error {}

function samplesPerChunkFor(stsc: StscEntry[], chunkIndex0: number): number {
  let result = 0;
  for (const entry of stsc) {
    if (entry.firstChunk - 1 > chunkIndex0) break;
    result = entry.samplesPerChunk;
  }
  return result;
}

export function buildAudioPlan(t: AudioSampleTables): AudioPlan {
  if (!t.timescale || t.timescale <= 0) throw new PlanError("missing timescale");
  if (t.chunkOffsets.length === 0) throw new PlanError("no chunks");
  const total = t.sampleSizes.length;
  if (total === 0) throw new PlanError("no samples");
  if (t.stsc.length === 0) throw new PlanError("empty stsc");
  if (t.stts.length === 0) throw new PlanError("empty stts");

  const offsets = new Float64Array(total);
  const sizes = new Uint32Array(total);
  const ctsSeconds = new Float32Array(total);

  const sttsIndex = { i: 0, left: t.stts[0].count };
  const cttsIndex = { i: 0, left: t.ctts?.[0]?.count ?? 0 };
  let dtsUnits = 0;
  let sample = 0;

  outer: for (let chunk = 0; chunk < t.chunkOffsets.length && sample < total; chunk += 1) {
    const perChunk = samplesPerChunkFor(t.stsc, chunk);
    if (perChunk <= 0) throw new PlanError(`stsc has no entry for chunk ${chunk + 1}`);
    let byte = t.chunkOffsets[chunk];
    for (let k = 0; k < perChunk && sample < total; k += 1) {
      if (sttsIndex.i >= t.stts.length) throw new PlanError("stts exhausted");
      const size = t.sampleSizes[sample];
      offsets[sample] = byte;
      sizes[sample] = size;
      const delta = t.stts[sttsIndex.i].delta;
      let ctsOffset = 0;
      if (t.ctts && t.ctts.length > 0) {
        if (cttsIndex.i >= t.ctts.length) throw new PlanError("ctts exhausted");
        if (cttsIndex.left <= 0) {
          cttsIndex.i += 1;
          if (cttsIndex.i >= t.ctts.length) throw new PlanError("ctts exhausted");
          cttsIndex.left = t.ctts[cttsIndex.i].count;
        }
        cttsIndex.left -= 1;
        ctsOffset = t.ctts[cttsIndex.i].offset;
      }
      ctsSeconds[sample] = (dtsUnits + ctsOffset) / t.timescale;
      dtsUnits += delta;
      sttsIndex.left -= 1;
      if (sttsIndex.left <= 0) {
        sttsIndex.i += 1;
        if (sttsIndex.i < t.stts.length) sttsIndex.left = t.stts[sttsIndex.i].count;
      }
      byte += size;
      sample += 1;
      if (sample >= total) break outer;
    }
  }

  if (sample !== total) {
    throw new PlanError(`sample table mismatch: planned ${sample} of ${total} samples`);
  }

  // Merge byte-adjacent samples into contiguous fetch runs (audio chunks
  // interleave with video chunks, so runs are typically one chunk each).
  const runs: AudioRun[] = [];
  for (let i = 0; i < total; i += 1) {
    const start = offsets[i];
    const end = start + sizes[i];
    const last = runs[runs.length - 1];
    if (last && last.endByte === start && last.endSample === i) {
      last.endByte = end;
      last.endSample = i + 1;
    } else {
      runs.push({ startByte: start, endByte: end, firstSample: i, endSample: i + 1 });
    }
  }

  const byTable = t.durationUnits / t.timescale;
  const bySamples = dtsUnits / t.timescale;
  return {
    totalSamples: total,
    durationSeconds: Math.max(byTable, bySamples, 0),
    offsets,
    sizes,
    ctsSeconds,
    runs,
  };
}

/** Index of the first sample presented at or after `seconds`. */
export function firstSampleAtOrAfter(plan: AudioPlan, seconds: number): number {
  const cts = plan.ctsSeconds;
  let lo = 0;
  let hi = cts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cts[mid] < seconds) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, plan.totalSamples - 1);
}
