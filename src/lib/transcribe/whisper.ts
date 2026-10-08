// Whisper on transformers.js, with every network touch pointed at our own
// Supabase functions instead of huggingface.co / jsdelivr:
//
//   model weights   → GET /functions/v1/whisper-model?path=<repo>/<file>
//                     (302 to a presigned B2 object; responses are Cache-API
//                      cached by the browser so a rescan costs nothing)
//   onnx runtime    → same function, path=whisper-wasm/<file>
//
// The env must be configured after the package import (its module init
// writes CDN defaults) but before the first pipeline() call.

import { env, pipeline as hfPipeline } from "@huggingface/transformers";
import { supabaseUrl } from "../supabase";

export type EngineBackend = "webgpu" | "wasm";

const MODEL_ID = "onnx-community/whisper-tiny";

type AsrCall = (
  audio: Float32Array,
  options: Record<string, unknown>
) => Promise<{
  text?: string;
  chunks?: { timestamp?: [number | null, number | null]; text?: string }[];
}>;

type EngineHooks = {
  onDownload?: (file: string, fraction: number) => void;
  onBackend?: (backend: EngineBackend) => void;
};

let hostConfigured = false;
let hooks: EngineHooks = {};

function configureHost(): void {
  if (hostConfigured) return;
  hostConfigured = true;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = `${supabaseUrl}/functions/v1/whisper-model?path=`;
  env.remotePathTemplate = "{model}/";

  const wasmBase = `${supabaseUrl}/functions/v1/whisper-model?path=whisper-wasm/`;
  // Old Safari (pre-26, no WebGPU) cannot run the asyncify build.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const versionMatch = /Version\/(\d+(?:\.\d+)?)/.exec(ua);
  const oldSafari =
    versionMatch !== null && /Safari\//.test(ua) && !/Chrome|Chromium|Edg/.test(ua)
      ? Number(versionMatch[1]) < 26
      : false;
  const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  const suffix = oldSafari && !hasGpu ? "" : ".asyncify";
  type WasmEnv = { wasmPaths?: unknown; numThreads?: number };
  const backends = env.backends.onnx as { wasm?: WasmEnv };
  backends.wasm = {
    ...backends.wasm,
    wasmPaths: {
      mjs: `${wasmBase}ort-wasm-simd-threaded${suffix}.mjs`,
      wasm: `${wasmBase}ort-wasm-simd-threaded${suffix}.wasm`,
    },
    numThreads:
      typeof self !== "undefined" && self.crossOriginIsolated
        ? Math.max(1, ((typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4) - 1)
        : 1,
  };
}

function trackProgress(event: {
  status?: string;
  file?: string;
  progress?: number;
}): void {
  if (event.status === "progress" && event.file) {
    const name = event.file.split("/").pop() ?? event.file;
    const done = Math.min(100, Math.max(0, event.progress ?? 0));
    hooks.onDownload?.(name, done / 100);
  }
}

async function doPrepare(): Promise<{ backend: EngineBackend; asr: AsrCall }> {
  configureHost();
  const wantGpu =
    typeof navigator !== "undefined" && "gpu" in navigator && navigator.gpu !== undefined;
  const attempts: EngineBackend[] = wantGpu ? ["webgpu", "wasm"] : ["wasm"];
  let lastError: Error | null = null;
  for (const device of attempts) {
    try {
      const pipe = await hfPipeline("automatic-speech-recognition", MODEL_ID, {
        dtype: "q8",
        device,
        progress_callback: trackProgress as never,
      });
      return { backend: device, asr: pipe as unknown as AsrCall };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("could not start the speech engine");
}

let prepared: Promise<{ backend: EngineBackend }> | null = null;
let resolvedAsr: AsrCall | null = null;
let resolvedBackend: EngineBackend | null = null;

async function ensurePrepared(): Promise<{ backend: EngineBackend }> {
  if (resolvedAsr) return { backend: resolvedBackend ?? "wasm" };
  if (!prepared) {
    prepared = doPrepare()
      .then(({ backend, asr }) => {
        resolvedAsr = asr;
        resolvedBackend = backend;
        hooks.onBackend?.(backend);
        return { backend };
      })
      .catch((error) => {
        prepared = null;
        throw error;
      });
  }
  return prepared;
}

/**
 * Loads (or reuses) the model. The first call downloads weights (progress
 * via `nextHooks.onDownload`); later calls resolve immediately.
 */
export function prepareEngine(nextHooks: EngineHooks = {}): Promise<{ backend: EngineBackend }> {
  hooks = { ...hooks, ...nextHooks };
  return ensurePrepared();
}

export type SegmentTranscript = {
  text: string;
  chunks: { s: number; e: number | null; t: string }[];
};

/**
 * Runs Whisper over one 16 kHz mono segment. `language` is null for the
 * first segment (auto-detect) and pinned afterwards for consistency.
 */
export async function transcribeSegment(
  pcm: Float32Array,
  options: { language?: string | null } = {}
): Promise<SegmentTranscript> {
  await ensurePrepared();
  const asr = resolvedAsr;
  if (!asr) throw new Error("speech engine is not ready");
  const callOptions: Record<string, unknown> = {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    task: "transcribe",
  };
  if (options.language) callOptions.language = options.language;
  const output = await asr(pcm, callOptions);
  const chunks = (output.chunks ?? []).map((chunk) => ({
    s: chunk.timestamp?.[0] ?? 0,
    e: chunk.timestamp?.[1] ?? null,
    t: String(chunk.text ?? ""),
  }));
  return { text: String(output.text ?? ""), chunks };
}
