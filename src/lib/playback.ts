// Pure playback math: ad cue points and resume/save rules. Kept dependency
// free so node:test can cover it (src/lib/playback.test.mjs) — the player
// screen imports these instead of reimplementing the rules inline.

export const RESUME_THRESHOLD_SECONDS = 10;
export const END_MARGIN_SECONDS = 15;
export const AUTOSAVE_INTERVAL_SECONDS = 10;
/** No cue point may fire inside the final moments of a title. */
export const MIN_TAIL_SECONDS = 30;
/** After a cue fires it is ignored for this long (polling tolerance). */
export const CUE_CONSUMED_TOLERANCE_SECONDS = 1;

export type CuePointOptions = {
  /** Manual markers from ad_markers (mid-roll). */
  manualSeconds?: number[];
  runtimeSeconds?: number | null;
  /** Ad settings fallback cadence when no manual markers exist. */
  intervalSeconds?: number;
  midRollEnabled?: boolean;
};

/**
 * Sorted mid-roll cue points.
 * - Disabled mid-rolls (or premium) => none.
 * - Manual markers always win; the interval cadence only fills in when the
 *   admin has not placed any markers for the title.
 * - Nothing within the last MIN_TAIL_SECONDS, and no runtime => manual only.
 */
export function buildCuePoints({
  manualSeconds = [],
  runtimeSeconds = null,
  intervalSeconds = 300,
  midRollEnabled = true,
}: CuePointOptions): number[] {
  if (!midRollEnabled) return [];

  const hasRuntime = typeof runtimeSeconds === "number" && runtimeSeconds > 0;
  const cutoff = hasRuntime ? (runtimeSeconds as number) - MIN_TAIL_SECONDS : Infinity;

  const manual = [
    ...new Set(
      manualSeconds.filter((s) => Number.isFinite(s) && s > 0 && s < cutoff)
    ),
  ].sort((a, b) => a - b);

  if (manual.length > 0) return manual;
  if (!hasRuntime || !Number.isFinite(cutoff) || intervalSeconds <= 0) return manual;

  const points: number[] = [];
  for (let t = intervalSeconds; t < cutoff; t += intervalSeconds) points.push(t);
  return points;
}

/**
 * The next cue to fire for the current position, skipping anything already
 * consumed (before the resume point, behind a forward seek, or just played).
 */
export function dueCuePoint(
  cuePoints: number[],
  position: number,
  lastConsumedSeconds: number
): number | null {
  for (const cue of cuePoints) {
    if (
      cue > lastConsumedSeconds + CUE_CONSUMED_TOLERANCE_SECONDS &&
      position >= cue
    ) {
      return cue;
    }
  }
  return null;
}

export type ProgressLike = {
  position_seconds: number;
  duration_seconds: number;
  completed?: boolean;
} | null;

/**
 * Where to seek on load: 0 for fresh/completed/near-the-end plays,
 * otherwise the stored position.
 */
export function initialResumePosition(progress: ProgressLike): number {
  if (!progress || progress.completed) return 0;
  const position = progress.position_seconds;
  if (!Number.isFinite(position) || position < RESUME_THRESHOLD_SECONDS) return 0;
  if (
    progress.duration_seconds > 0 &&
    position > progress.duration_seconds - END_MARGIN_SECONDS
  ) {
    return 0;
  }
  return position;
}

/** True once AUTOSAVE_INTERVAL_SECONDS of new playback has accumulated. */
export function shouldAutosave(lastSavedSeconds: number, position: number): boolean {
  return position - lastSavedSeconds >= AUTOSAVE_INTERVAL_SECONDS;
}

/** A play is complete when it reaches the closing margin of the runtime. */
export function isCompleted(position: number, duration: number): boolean {
  return duration > 0 && position >= duration - END_MARGIN_SECONDS;
}

/** 0..1 watched fraction, clamped (safe for zero/unknown durations). */
export function progressFraction(position: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(position) || position <= 0) return 0;
  return Math.min(1, position / duration);
}
