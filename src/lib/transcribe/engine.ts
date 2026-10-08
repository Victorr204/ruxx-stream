// The transcription engine: drives extraction → Whisper → cue building and
// reports everything over the postMessage protocol (types.ts). Runs inside
// the dedicated engine document (iframe on web, WebView on native).

import {
  detectLanguageLocally,
  detectionSample,
  normalizeDetectedLanguage,
  whisperChunksToCues,
  type SubtitleCue,
} from "../subtitles";
import { extractAudio, SEGMENT_SECONDS } from "./audio";
import { prepareEngine, transcribeSegment, type EngineBackend } from "./whisper";
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from "./checkpoint";
import type { EngineMessage, ScanPhase } from "./types";

export type RunScanParams = {
  movieId: string;
  mediaUrl: string;
  emit: (message: EngineMessage) => void;
  signal: AbortSignal;
};

const PREPARE_WEIGHT = 10;
const MAIN_WEIGHT = 85;
const EMIT_INTERVAL_MS = 250;

export async function runScan(params: RunScanParams): Promise<void> {
  const { movieId, mediaUrl, emit, signal } = params;
  const startedAt = Date.now();
  let backend: EngineBackend | null = null;
  let lastPercent = 0;
  let lastEmit = 0;
  let total = 0;
  let extractDone = 0;
  let transcribeDone = 0;
  let mode: "file" | "playback" = "file";

  const send = (message: EngineMessage, force = false): void => {
    const now = Date.now();
    if (!force && now - lastEmit < EMIT_INTERVAL_MS) return;
    lastEmit = now;
    emit(message);
  };

  const progress = (
    phase: ScanPhase,
    basePercent: number,
    detail: string,
    force = false
  ): void => {
    const percent = Math.max(lastPercent, Math.min(100, basePercent));
    lastPercent = percent;
    let etaSeconds: number | null = null;
    if (transcribeDone > 0 && total > transcribeDone) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = transcribeDone / Math.max(elapsed, 1);
      etaSeconds = Math.round((total - transcribeDone) / Math.max(rate, 0.01));
    }
    send(
      {
        type: "progress",
        phase,
        percent: Math.round(percent),
        detail,
        backend,
        etaSeconds,
      },
      force
    );
  };

  const fail = (error: unknown): void => {
    const aborted =
      signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError");
    const message = aborted
      ? "cancelled"
      : error instanceof Error
        ? error.message || "scan failed"
        : "scan failed";
    emit({ type: "error", message });
  };

  emit({ type: "ready" });

  try {
    // ── resume ────────────────────────────────────────────────────────
    let checkpoint = await loadCheckpoint(movieId);
    if (checkpoint && Date.now() - checkpoint.updatedAt > 48 * 3600 * 1000) {
      await clearCheckpoint(movieId);
      checkpoint = null;
    }
    let resumeFrom = 0;
    let cues: SubtitleCue[] = [];
    let language: string | null = null;
    if (checkpoint && checkpoint.cues.length > 0 && checkpoint.nextStart > 0) {
      resumeFrom = Math.floor(checkpoint.nextStart / SEGMENT_SECONDS) * SEGMENT_SECONDS;
      cues = checkpoint.cues;
      language = checkpoint.language;
      total = checkpoint.total;
    }

    // ── prepare ───────────────────────────────────────────────────────
    progress("preparing", 1, "Loading speech engine…", true);
    const { backend: detected } = await prepareEngine({
      onDownload: (file, fraction) => {
        const percent = Math.min(PREPARE_WEIGHT, (fraction * 100 * PREPARE_WEIGHT) / 100);
        progress("preparing", percent, `Downloading ${file} · ${Math.round(fraction * 100)}%`);
      },
    });
    backend = detected;
    progress("preparing", PREPARE_WEIGHT, "Engine ready", true);
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");

    // ── extract ───────────────────────────────────────────────────────
    const extraction = await extractAudio(
      mediaUrl,
      {
        mode: (next) => {
          mode = next;
        },
        duration: (seconds) => {
          if (seconds > 0 && !total) total = seconds;
        },
        progress: (seconds) => {
          extractDone = Math.max(extractDone, seconds);
          if (transcribeDone === 0) {
            const base = PREPARE_WEIGHT + (MAIN_WEIGHT * 0.3 * extractDone) / (total || 1);
            progress(
              mode === "file" ? "extracting" : "playing",
              total > 0 ? base : PREPARE_WEIGHT,
              mode === "file"
                ? `Reading audio… ${formatSeconds(extractDone)}`
                : `Listening through the movie… ${formatSeconds(extractDone)}`
            );
          }
        },
        notice: (message) => {
          progress(
            transcribeDone > 0 ? "transcribing" : mode === "file" ? "extracting" : "playing",
            lastPercent,
            message
          );
        },
      },
      signal,
      resumeFrom
    );

    // ── transcribe ────────────────────────────────────────────────────
    const mainPercent = (done: number): number =>
      total > 0
        ? PREPARE_WEIGHT + (MAIN_WEIGHT * Math.min(done, total)) / total
        : PREPARE_WEIGHT + MAIN_WEIGHT * 0.3;
    for (;;) {
      const item = await extraction.queue.take();
      if (!item) break;
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");

      const segmentDuration = item.pcm.length / 16000;
      progress(
        "transcribing",
        mainPercent(transcribeDone),
        `Transcribing… ${formatSeconds(transcribeDone)}${total > 0 ? ` / ${formatSeconds(total)}` : ""}`,
        true
      );

      const result = await transcribeSegment(item.pcm, { language });

      if (!language && result.text.trim().length > 0) {
        const detected = normalizeDetectedLanguage(
          detectLanguageLocally(detectionSample([{ s: 0, e: 0, t: result.text }], 1200))
        );
        if (detected) language = detected;
      }

      const offsetChunks = result.chunks.map((chunk) => ({
        s: chunk.s + item.start,
        e: chunk.e !== null ? chunk.e + item.start : null,
        t: chunk.t,
      }));
      cues.push(...whisperChunksToCues(offsetChunks, { duration: segmentDuration }));

      transcribeDone = item.start + segmentDuration;
      progress(
        "transcribing",
        mainPercent(transcribeDone),
        `Transcribing… ${formatSeconds(transcribeDone)}${total > 0 ? ` / ${formatSeconds(total)}` : ""}`
      );

      await saveCheckpoint({
        movieId,
        nextStart: item.start + segmentDuration,
        cues,
        language,
        total,
        updatedAt: Date.now(),
      });
    }
    await extraction.done;
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");

    // ── finish ────────────────────────────────────────────────────────
    if (total > 0) {
      cues = cues
        .map((cue) => ({
          s: Math.min(cue.s, Math.max(0, total - 0.1)),
          e: Math.min(cue.e, total),
          t: cue.t,
        }))
        .filter((cue) => cue.e > cue.s && cue.t.trim().length > 0);
    }
    const sample = detectionSample(cues);
    await clearCheckpoint(movieId);
    progress("done", 100, "Done", true);
    emit({ type: "done", cues, language: language ?? "", sample });
  } catch (error) {
    fail(error);
  }
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
