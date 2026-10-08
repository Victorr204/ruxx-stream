// Message protocol between the app and the transcription engine page.
//
// The engine runs in its own document — an <iframe> on web, a WebView on
// native — so every state change crosses a postMessage boundary as JSON.
// Keep this file dependency-free: both sides import it.

export type ScanPhase =
  /** Downloading the Whisper weights + ONNX runtime (one-time, cached). */
  | "preparing"
  /** Reading audio out of the movie file (no playback needed). */
  | "extracting"
  /** The same, but the file has to play through to be heard. */
  | "playing"
  | "transcribing"
  | "saving"
  | "done";

export type ScanProgress = {
  type: "progress";
  phase: ScanPhase;
  /** 0–100 across the whole job, monotonic. */
  percent: number;
  /** Short human line shown under the bar ("Reading audio… 34%"). */
  detail: string;
  /** Which engine won: webgpu, wasm — null until known. */
  backend: "webgpu" | "wasm" | null;
  /** Seconds of audio left at the current transcription rate (null early). */
  etaSeconds: number | null;
};

export type ScanDone = {
  type: "done";
  cues: { s: number; e: number; t: string }[];
  /** Language the speech engine heard (whisper tag, normalized). */
  language: string;
  /** Whole-transcript sample for server-side detection fallback. */
  sample: string;
};

export type ScanError = { type: "error"; message: string };
export type ScanReady = { type: "ready" };

export type EngineMessage = ScanProgress | ScanDone | ScanError | ScanReady;

export type HostMessage =
  | { type: "cancel" }
  /** Kick off a scan. The media URL is posted (not query-stringed) so the
   *  presigned credential never lands in server access logs. */
  | { type: "start"; movie_id: string; url: string };
