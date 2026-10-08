// Audio extraction for the in-app subtitle generator.
//
// Two strategies, chosen automatically:
//
//   file      — parse the movie's moov box (mp4box), plan the audio sample
//               tables, then Range-fetch ONLY the audio bytes and decode
//               them with WebCodecs. Video bytes are never downloaded and
//               nothing plays: a 2-hour movie is scanned as fast as the
//               network and CPU allow. Needs mp4 + a supported codec
//               (AAC in practice).
//   playback  — anything else (webm, mkv, HLS, fragmented mp4, browsers
//               without WebCodecs): a hidden video element plays the file
//               while an AudioWorklet captures its audio. Works wherever
//               the player works, but takes as long as the movie runs.
//
// Both paths hand the engine fixed-size mono 16 kHz segments through a
// bounded queue, so transcription pace can never let memory run away.

import { createFile, AudioSampleEntry, type ISOFile, type Box } from "mp4box";
import {
  buildAudioPlan,
  firstSampleAtOrAfter,
  PlanError,
  type AudioSampleTables,
} from "./plan";

export const TARGET_SAMPLE_RATE = 16000;
/** Seconds of audio per transcription segment (bounded memory, resume grain). */
export const SEGMENT_SECONDS = 300;

export type ExtractionMode = "file" | "playback";

export type ExtractionEvents = {
  mode: (mode: ExtractionMode) => void;
  /** Total duration once known (seconds). */
  duration: (seconds: number) => void;
  /** Extraction position in seconds of source audio. */
  progress: (seconds: number) => void;
  /** Non-fatal problem the user may be able to resolve (e.g. autoplay). */
  notice: (message: string) => void;
};

// ─────────────────────────────────────────────────────── shared plumbing

/** Bounded hand-off: extraction pushes segments, the engine consumes. */
export class SegmentQueue {
  private chunks: Float32Array[] = [];
  private samples = 0;
  private done = false;
  private failure: Error | null = null;
  private waiters: (() => void)[] = [];
  private pushers: (() => void)[] = [];
  private nextStart: number;

  constructor(startSeconds = 0) {
    this.nextStart = startSeconds;
  }

  /** Waits for the next segment (null once extraction finished). */
  async take(): Promise<{ pcm: Float32Array; start: number } | null> {
    for (;;) {
      if (this.failure) throw this.failure;
      if (this.chunks.length > 0) {
        const pcm = this.chunks.shift()!;
        this.samples -= pcm.length;
        const start = this.nextStart;
        this.nextStart += pcm.length / TARGET_SAMPLE_RATE;
        this.release();
        return { pcm, start };
      }
      if (this.done) return null;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** Appends one segment; blocks while the queue is at high water. */
  async push(pcm: Float32Array): Promise<void> {
    if (this.done || this.failure || pcm.length === 0) return;
    this.chunks.push(pcm);
    this.samples += pcm.length;
    const high = 2 * SEGMENT_SECONDS * TARGET_SAMPLE_RATE;
    while (this.samples >= high && !this.done && !this.failure) {
      await new Promise<void>((resolve) => this.pushers.push(resolve));
    }
    this.release();
  }

  finish(remainder: Float32Array | null): void {
    if (remainder && remainder.length > 0) {
      this.chunks.push(remainder);
      this.samples += remainder.length;
    }
    this.done = true;
    this.release();
  }

  fail(error: Error): void {
    this.failure = error;
    this.release();
  }

  /** Seconds of buffered audio waiting for the engine. */
  fillSeconds(): number {
    return this.samples / TARGET_SAMPLE_RATE;
  }

  isFull(): boolean {
    return this.fillSeconds() >= 2 * SEGMENT_SECONDS;
  }

  private release(): void {
    this.waiters.splice(0).forEach((resolve) => resolve());
    if (this.samples < SEGMENT_SECONDS * TARGET_SAMPLE_RATE) {
      this.pushers.splice(0).forEach((resolve) => resolve());
    }
  }
}

/** Accumulates PCM into exactly SEGMENT_SECONDS pieces. */
class SegmentBuilder {
  private parts: Float32Array[] = [];
  private size = 0;
  private queue: SegmentQueue;

  constructor(queue: SegmentQueue) {
    this.queue = queue;
  }

  async push(pcm: Float32Array): Promise<void> {
    if (pcm.length === 0) return;
    this.parts.push(pcm);
    this.size += pcm.length;
    const full = SEGMENT_SECONDS * TARGET_SAMPLE_RATE;
    while (this.size >= full) {
      const merged = this.concat();
      const segment = merged.subarray(0, full);
      const rest = merged.subarray(full);
      this.parts = rest.length > 0 ? [rest.slice()] : [];
      this.size = rest.length;
      await this.queue.push(segment);
    }
  }

  remainder(): Float32Array {
    return this.concat();
  }

  private concat(): Float32Array {
    if (this.parts.length === 1) return this.parts[0];
    const out = new Float32Array(this.size);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/** Streaming linear resampler (stateful across frame boundaries). */
class Resampler {
  private ratio: number;
  private position = 0;
  private buffer: Float32Array = new Float32Array(0);

  constructor(fromRate: number) {
    this.ratio = fromRate / TARGET_SAMPLE_RATE;
  }

  process(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input;
    const merged = new Float32Array(this.buffer.length + input.length);
    merged.set(this.buffer);
    merged.set(input, this.buffer.length);
    const out: number[] = [];
    while (this.position + 1 < merged.length) {
      const index = Math.floor(this.position);
      const frac = this.position - index;
      out.push(merged[index] + (merged[index + 1] - merged[index]) * frac);
      this.position += this.ratio;
    }
    const keep = Math.floor(this.position);
    this.buffer = merged.slice(keep);
    this.position -= keep;
    return Float32Array.from(out);
  }
}

function downmix(data: AudioData): Float32Array {
  const frames = data.numberOfFrames;
  const channels = data.numberOfChannels;
  if (channels === 1) {
    const mono = new Float32Array(frames);
    data.copyTo(mono, { format: "f32-planar", planeIndex: 0 });
    return mono;
  }
  const mono = new Float32Array(frames);
  const plane = new Float32Array(frames);
  for (let channel = 0; channel < channels; channel += 1) {
    data.copyTo(plane, { format: "f32-planar", planeIndex: channel });
    for (let i = 0; i < frames; i += 1) mono[i] += plane[i] / channels;
  }
  return mono;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

// ─────────────────────────────────────────────── fast path (mp4 + Range)

type Mp4BoxLike = Box & {
  chunk_offsets?: number[];
  first_chunk?: number[];
  samples_per_chunk?: number[];
  sample_sizes?: number[];
  sample_counts?: number[];
  sample_deltas?: number[];
  sample_offsets?: number[];
  sample_count?: number;
  sample_size?: number;
  entries?: { sample_count: number; sample_offset: number }[];
};

type TrakLike = Box & {
  tkhd: { track_id: number };
  mdia: {
    mdhd: { timescale: number; duration: number };
    minf: { stbl: Record<string, Mp4BoxLike | undefined> };
  };
};

function tablesFromTrak(trak: TrakLike): AudioSampleTables {
  const stbl = trak.mdia.minf.stbl as unknown as Record<string, Mp4BoxLike | undefined>;
  const stco = stbl.stco ?? stbl.co64;
  const stsz = stbl.stsz;
  const stsc = stbl.stsc;
  const stts = stbl.stts;
  if (!stco?.chunk_offsets) throw new PlanError("missing chunk offsets");
  if (!stsz?.sample_sizes) throw new PlanError("missing sample sizes");
  if (!stsc?.first_chunk || !stsc.samples_per_chunk) throw new PlanError("missing stsc");
  if (!stts?.sample_counts || !stts.sample_deltas) throw new PlanError("missing stts");
  if ((stsz.sample_sizes.length ?? 0) === 0) throw new PlanError("empty track");
  const cttsBox = stbl.ctts;
  let ctts: AudioSampleTables["ctts"];
  if (cttsBox) {
    if (cttsBox.sample_counts && cttsBox.sample_offsets) {
      ctts = cttsBox.sample_counts.map((count, i) => ({
        count,
        offset: cttsBox.sample_offsets![i],
      }));
    } else if (cttsBox.entries) {
      ctts = cttsBox.entries.map((e) => ({ count: e.sample_count, offset: e.sample_offset }));
    } else {
      // mp4box does not type every ctts build; guessing would desync cues.
      throw new PlanError("unsupported ctts layout");
    }
  }
  return {
    timescale: trak.mdia.mdhd.timescale,
    durationUnits: trak.mdia.mdhd.duration,
    chunkOffsets: stco.chunk_offsets,
    sampleSizes: stsz.sample_sizes,
    stsc: stsc.first_chunk.map((firstChunk, i) => ({
      firstChunk,
      samplesPerChunk: stsc.samples_per_chunk![i],
    })),
    stts: stts.sample_counts.map((count, i) => ({ count, delta: stts.sample_deltas![i] })),
    ctts,
  };
}

type DescriptorLike = {
  data?: Uint8Array;
  findDescriptor: (tag: number) => DescriptorLike | undefined;
};
type EsdLike = {
  getAudioConfig?: () => number | undefined;
  getOTI?: () => number | undefined;
  findDescriptor: (tag: number) => DescriptorLike | undefined;
};

function codecCandidates(entry: AudioSampleEntry & { fourcc?: string }): {
  candidates: string[];
  description?: ArrayBuffer;
} {
  const fourcc = entry.fourcc ?? "mp4a";
  const esd = (
    (entry as unknown as { esds?: { esd?: EsdLike } }).esds ??
    (entry as unknown as { wave?: { esds?: { esd?: EsdLike } } }).wave?.esds
  )?.esd;
  const dsi = esd?.findDescriptor(4)?.findDescriptor(5)?.data;
  const aot = esd?.getAudioConfig?.();

  if (fourcc === "mp4a") {
    if (!dsi) throw new PlanError("missing AudioSpecificConfig");
    const candidates = aot ? [`mp4a.40.${aot}`, "mp4a.40.2"] : ["mp4a.40.2"];
    const copy = new Uint8Array(dsi);
    return { candidates, description: copy.buffer };
  }
  if (fourcc === "Opus") return { candidates: ["opus"] };
  if (fourcc === "fLaC") return { candidates: ["flac"] };
  if (fourcc === "alac") return { candidates: ["alac"] };
  return { candidates: [fourcc.toLowerCase(), fourcc] };
}

async function openDecoder(
  entry: AudioSampleEntry & { fourcc?: string },
  onOutput: (frame: AudioData) => void,
  onError: (error: Error) => void
): Promise<AudioDecoder> {
  const base: Omit<AudioDecoderConfig, "codec"> = {
    sampleRate: Math.round(entry.getSampleRate()) || 48000,
    numberOfChannels: entry.getChannelCount() || 2,
  };
  const { candidates, description } = codecCandidates(entry);
  let lastError: Error | null = null;
  for (const codec of candidates) {
    try {
      const config: AudioDecoderConfig = description ? { ...base, codec, description } : { ...base, codec };
      const support = await AudioDecoder.isConfigSupported(config);
      if (!support.supported) {
        lastError = new Error(`codec ${codec} not supported`);
        continue;
      }
      const decoder = new AudioDecoder({ output: onOutput, error: onError });
      decoder.configure(config);
      return decoder;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw new PlanError(lastError?.message ?? "no usable audio codec");
}

async function readAll(
  response: Response,
  onChunk: (chunk: ArrayBuffer, fileStart: number) => void,
  signal: AbortSignal,
  stopWhen?: () => boolean
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new PlanError("media host does not stream");
  let offset = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
      onChunk(buffer, offset);
      offset += value.byteLength;
      if (stopWhen?.()) break;
    }
  } finally {
    if (stopWhen?.()) await reader.cancel().catch(() => undefined);
  }
}

type ReadyFile = {
  file: ISOFile;
  ready: Promise<void>;
  state: () => "pending" | "ready" | "error";
  error: () => Error | null;
};

function makeParseFile(): ReadyFile {
  const file = createFile();
  let status: "pending" | "ready" | "error" = "pending";
  let parseError: Error | null = null;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  file.onError = (message: string) => {
    status = "error";
    parseError = new PlanError(message);
    rejectReady(parseError);
  };
  file.onReady = () => {
    status = "ready";
    resolveReady();
  };
  return { file, ready, state: () => status, error: () => parseError };
}

function append(file: ISOFile, buffer: ArrayBuffer, fileStart: number): void {
  const tagged = buffer as ArrayBuffer & { fileStart: number };
  tagged.fileStart = fileStart;
  file.appendBuffer(tagged);
}

function parseContentRange(header: string | null): { total: number } | null {
  if (!header) return null;
  const match = /\/(\d+)\s*$/.exec(header);
  if (!match) return null;
  return { total: Number(match[1]) };
}

const HEAD_LIMIT = 16 * 1024 * 1024;
const SCAN_BYTE_CAP = 64 * 1024 * 1024;

async function locateMoov(mediaUrl: string, holder: ReadyFile, signal: AbortSignal): Promise<void> {
  const head = await fetch(mediaUrl, { headers: { Range: `bytes=0-${HEAD_LIMIT - 1}` }, signal });
  const metadataFound = () => holder.state() !== "pending";
  if (head.status === 200) {
    // Server ignored Range: stream, but never blindly download a whole movie.
    let appended = 0;
    await readAll(
      head,
      (buffer, fileStart) => {
        append(holder.file, buffer, fileStart);
        appended += buffer.byteLength;
        if (appended > SCAN_BYTE_CAP && holder.state() === "pending") {
          throw new PlanError("audio metadata too far into the file");
        }
      },
      signal,
      metadataFound
    );
    if (holder.state() === "error") throw holder.error()!;
    if (holder.state() === "pending") throw new PlanError("no audio metadata found in file");
    return;
  }
  if (head.status !== 206) throw new PlanError(`unexpected HTTP ${head.status} for media`);

  const size = parseContentRange(head.headers.get("content-range"))?.total ?? 0;
  await readAll(
    head,
    (buffer, fileStart) => append(holder.file, buffer, fileStart),
    signal,
    metadataFound
  );
  if (holder.state() !== "pending") {
    if (holder.state() === "error") throw holder.error()!;
    return;
  }
  if (!size || size <= HEAD_LIMIT) throw new PlanError("audio metadata not found");

  // moov lives at the tail: fetch the region after the head probe with no overlap.
  const tailStart = Math.max(HEAD_LIMIT, size - HEAD_LIMIT);
  const tail = await fetch(mediaUrl, {
    headers: { Range: `bytes=${tailStart}-${size - 1}` },
    signal,
  });
  if (tail.status !== 206) throw new PlanError("media host cannot seek");
  await readAll(
    tail,
    (buffer, fileStart) => append(holder.file, buffer, tailStart + fileStart),
    signal,
    metadataFound
  );
  await Promise.race([holder.ready.catch(() => undefined), sleep(2000)]);
  if (holder.state() === "error") throw holder.error()!;
  if (holder.state() === "pending") throw new PlanError("audio metadata not found");
}

function findAudioTrak(file: ISOFile): TrakLike | null {
  const traks = (file as unknown as { moov?: { traks?: TrakLike[] } }).moov?.traks ?? [];
  for (const trak of traks) {
    const entry = trak.mdia.minf.stbl.stsd as unknown as
      | { entries?: (AudioSampleEntry & { fourcc?: string })[] }
      | undefined;
    const candidate = entry?.entries?.[0];
    if (candidate instanceof AudioSampleEntry) return trak;
  }
  return null;
}

async function extractFromFile(
  mediaUrl: string,
  events: ExtractionEvents,
  queue: SegmentQueue,
  builder: SegmentBuilder,
  signal: AbortSignal,
  resumeFrom: number
): Promise<void> {
  if (typeof AudioDecoder === "undefined") throw new PlanError("WebCodecs unavailable");

  const holder = makeParseFile();
  await locateMoov(mediaUrl, holder, signal);
  if (signal.aborted) throw new DOMException("cancelled", "AbortError");

  const file = holder.file;
  if ((file as unknown as { moov?: { mvex?: unknown } }).moov?.mvex) {
    throw new PlanError("fragmented mp4 is not scannable directly");
  }
  const trak = findAudioTrak(file);
  if (!trak) throw new PlanError("no audio track");
  const stsd = trak.mdia.minf.stbl.stsd as unknown as
    | { entries?: (AudioSampleEntry & { fourcc?: string })[] }
    | undefined;
  const entry = stsd?.entries?.[0];
  if (!entry) throw new PlanError("missing audio sample entry");
  const plan = buildAudioPlan(tablesFromTrak(trak));
  events.duration(plan.durationSeconds);

  const startIndex = resumeFrom > 0 ? firstSampleAtOrAfter(plan, resumeFrom) : 0;
  const startRun = plan.runs.findIndex(
    (run) => run.firstSample <= startIndex && startIndex < run.endSample
  );
  if (startRun < 0) throw new PlanError("no audio runs");

  let decodedSeconds = resumeFrom;
  let lastReported = Math.floor(resumeFrom);
  const report = (seconds: number) => {
    decodedSeconds = Math.max(decodedSeconds, seconds);
    const whole = Math.floor(decodedSeconds);
    if (whole > lastReported) {
      lastReported = whole;
      events.progress(decodedSeconds);
    }
  };

  const resamplers = new Map<number, Resampler>();
  let chain: Promise<void> = Promise.resolve();
  let failed: Error | null = null;
  const decoder = await openDecoder(
    entry,
    (frame) => {
      const sourceSeconds = frame.timestamp / 1_000_000;
      const mono = downmix(frame);
      const rate = frame.sampleRate;
      frame.close();
      let resampler = resamplers.get(rate);
      if (!resampler && rate !== TARGET_SAMPLE_RATE) {
        resampler = new Resampler(rate);
        resamplers.set(rate, resampler);
      }
      const pcm = resampler ? resampler.process(mono) : mono;
      chain = chain.then(async () => {
        if (failed) return;
        try {
          if (pcm.length > 0) {
            report(sourceSeconds + mono.length / rate);
            await builder.push(pcm);
          }
        } catch (e) {
          failed = e instanceof Error ? e : new Error(String(e));
        }
      });
    },
    (error) => {
      failed = error;
      queue.fail(error);
    }
  );

  const fetchRange = async (start: number, end: number): Promise<ArrayBuffer> => {
    const response = await fetch(mediaUrl, {
      headers: { Range: `bytes=${start}-${end - 1}` },
      signal,
    });
    if (response.status !== 206) throw new PlanError("media host cannot serve byte ranges");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== end - start) throw new PlanError("truncated range response");
    return buffer;
  };

  const decodeRun = async (runIndex: number, buffer: ArrayBuffer): Promise<void> => {
    const run = plan.runs[runIndex];
    for (let i = run.firstSample; i < run.endSample; i += 1) {
      if (i < startIndex) continue;
      if (failed) throw failed;
      while (decoder.decodeQueueSize > 96 && !failed) await sleep(15);
      while (queue.isFull() && !failed) await sleep(60);
      if (failed) throw failed;
      const offset = Number(plan.offsets[i]) - run.startByte;
      const data = buffer.slice(offset, offset + plan.sizes[i]);
      decoder.decode(
        new EncodedAudioChunk({
          type: "key",
          data,
          timestamp: Math.round(plan.ctsSeconds[i] * 1_000_000),
        })
      );
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    }
  };

  const WINDOW = 3;
  const pending: (Promise<ArrayBuffer> | null)[] = [];
  let scheduled = startRun;
  let consumed = startRun;
  try {
    while (scheduled < plan.runs.length) {
      while (queue.isFull() && consumed === scheduled) await sleep(80);
      while (scheduled < plan.runs.length && scheduled - consumed < WINDOW) {
        const index = scheduled;
        pending[index] = (async () => {
          const run = plan.runs[index];
          return await fetchRange(run.startByte, run.endByte);
        })();
        scheduled += 1;
      }
      const index = consumed;
      const buffer = await pending[index]!;
      pending[index] = null;
      await decodeRun(index, buffer);
      consumed += 1;
    }
    for (const promise of pending) if (promise) await promise;
  } finally {
    for (const promise of pending) promise?.catch(() => undefined);
    // Drain decode output, then flush remaining frames.
    while (decoder.decodeQueueSize > 0 && !failed) await sleep(20);
    try {
      await decoder.flush();
    } catch (e) {
      if (!failed && decodedSeconds <= resumeFrom + 1) failed = e instanceof Error ? e : new Error(String(e));
    }
    await chain;
    if (decoder.state !== "closed") decoder.close();
  }
  if (failed) throw failed;
  if (signal.aborted) throw new DOMException("cancelled", "AbortError");
}

// ─────────────────────────────────────────────────── playback fallback

const CAPTURE_WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      const frames = input[0].length;
      const channels = input.length;
      const out = new Float32Array(frames);
      let energy = 0;
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += input[c][i];
        out[i] = sum / channels;
        energy += Math.abs(out[i]);
      }
      this.port.postMessage({ pcm: out, energy }, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

async function extractFromPlayback(
  mediaUrl: string,
  events: ExtractionEvents,
  queue: SegmentQueue,
  builder: SegmentBuilder,
  signal: AbortSignal,
  resumeFrom: number
): Promise<void> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.playsInline = true;
  video.muted = false;
  video.volume = 1;
  video.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none";
  video.src = mediaUrl;
  document.body.appendChild(video);

  let context: AudioContext | null = null;
  let progressTimer = 0;
  const cleanup = () => {
    if (progressTimer) window.clearInterval(progressTimer);
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    if (context && context.state !== "closed") context.close().catch(() => undefined);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
        reject(new PlanError("could not load this movie for scanning"));
      };
      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("error", onError);
      video.load();
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration > 0) events.duration(duration);

    context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    const source = context.createMediaElementSource(video);
    const captureRate = context.sampleRate;
    const resamplers = new Map<number, Resampler>();
    let chain: Promise<void> = Promise.resolve();
    let energy = 0;
    let heardSound = false;
    let captureFailed: Error | null = null;

    const onPcm = (data: Float32Array, blockEnergy: number) => {
      energy += blockEnergy;
      if (!heardSound && energy > 0.5) heardSound = true;
      let resampler = resamplers.get(captureRate);
      if (!resampler && captureRate !== TARGET_SAMPLE_RATE) {
        resampler = new Resampler(captureRate);
        resamplers.set(captureRate, resampler);
      }
      const pcm = resampler ? resampler.process(data) : data;
      if (pcm.length > 0) {
        chain = chain.then(async () => {
          if (captureFailed) return;
          try {
            await builder.push(pcm);
          } catch (e) {
            captureFailed = e instanceof Error ? e : new Error(String(e));
          }
        });
      }
    };

    if (typeof context.audioWorklet !== "undefined") {
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(context, "capture-processor");
      node.port.onmessage = (event: MessageEvent<{ pcm: Float32Array; energy: number }>) => {
        onPcm(event.data.pcm, event.data.energy);
      };
      source.connect(node); // deliberately not connected to destination
    } else {
      const node = context.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (event) => {
        const input = Float32Array.from(event.inputBuffer.getChannelData(0));
        let sum = 0;
        for (let i = 0; i < input.length; i += 1) sum += Math.abs(input[i]);
        onPcm(input, sum);
      };
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(node);
      node.connect(silent);
      silent.connect(context.destination);
    }

    const startPlayback = async () => {
      if (resumeFrom > 0 && Number.isFinite(video.duration)) video.currentTime = resumeFrom;
      await context!.resume();
      await video.play();
    };

    try {
      await startPlayback();
    } catch {
      events.notice("Tap anywhere to start the audio scan");
      await new Promise<void>((resolve, reject) => {
        const onTap = () => {
          cleanupActivation();
          startPlayback().then(resolve, reject);
        };
        const cleanupActivation = () => {
          document.removeEventListener("pointerdown", onTap, true);
          window.removeEventListener("keydown", onTap as unknown as EventListener, true);
        };
        document.addEventListener("pointerdown", onTap, true);
        window.addEventListener("keydown", onTap as unknown as EventListener, true);
        signal.addEventListener("abort", () => {
          cleanupActivation();
          reject(new DOMException("cancelled", "AbortError"));
        });
      });
    }

    const ended = new Promise<void>((resolve) => {
      video.addEventListener("ended", () => resolve(), { once: true });
    });

    let probedSilence = false;
    progressTimer = window.setInterval(() => {
      if (!video.paused && queue.fillSeconds() >= 2 * SEGMENT_SECONDS) video.pause();
      else if (video.paused && !video.ended && queue.fillSeconds() < SEGMENT_SECONDS) {
        video.play().catch(() => undefined);
      }
      events.progress(video.currentTime);
      if (!probedSilence && video.currentTime > resumeFrom + 10) {
        probedSilence = true;
        if (!heardSound) {
          captureFailed = new PlanError(
            "the media host blocked audio capture (CORS) — upload with CORS allowed for this origin"
          );
          video.pause();
        }
      }
    }, 400);

    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("cancelled", "AbortError")),
        { once: true }
      );
    });
    aborted.catch(() => undefined); // observed via race; avoid unhandled rejection later
    await Promise.race([ended, aborted]);
    video.pause();
    await sleep(400);
    await chain;
    if (captureFailed) throw captureFailed;
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
  } catch (error) {
    cleanup();
    throw error;
  }
  cleanup();
}

// ──────────────────────────────────────────────────────────── entrypoint

export async function extractAudio(
  mediaUrl: string,
  events: ExtractionEvents,
  signal: AbortSignal,
  resumeFrom = 0
): Promise<{ queue: SegmentQueue; done: Promise<void> }> {
  const queue = new SegmentQueue(resumeFrom);
  const builder = new SegmentBuilder(queue);
  const looksStreamy = /\.m3u8(\?|$)/i.test(mediaUrl) || /\.(webm|mkv)(\?|$)/i.test(mediaUrl);

  const run = async () => {
    try {
      if (!looksStreamy && typeof AudioDecoder !== "undefined") {
        try {
          events.mode("file");
          await extractFromFile(mediaUrl, events, queue, builder, signal, resumeFrom);
          queue.finish(builder.remainder());
          return;
        } catch (error) {
          if (isAbort(error, signal)) throw error;
          // Codec/layout/Range problem → play it through instead.
        }
      }
      events.mode("playback");
      await extractFromPlayback(mediaUrl, events, queue, builder, signal, resumeFrom);
      queue.finish(builder.remainder());
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error(String(error));
      if (isAbort(error, signal)) {
        queue.fail(new DOMException("cancelled", "AbortError"));
        return;
      }
      queue.fail(failure);
    }
  };

  return { queue, done: run() };
}
