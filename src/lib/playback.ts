// Pure playback math: the wall-clock ad cadence and resume/save rules. Kept
// dependency free so node:test can cover it (src/lib/playback.test.mjs) — the
// player screen imports these instead of reimplementing the rules inline.

export const RESUME_THRESHOLD_SECONDS = 10;
export const END_MARGIN_SECONDS = 15;
export const AUTOSAVE_INTERVAL_SECONDS = 10;

// ── Ad cadence (wall clock) ──────────────────────────────────────────
// One ad per title every intervalSeconds, measured from the moment an ad
// was last shown. The clock keeps running while the viewer is away: leaving
// the player and returning inside the window plays with no ads at all.

/** Ten minutes of wall-clock time between ads on a title. */
export const DEFAULT_AD_INTERVAL_SECONDS = 600;

/**
 * True when an ad is due for a title: never any ad yet, or the last one is
 * at least intervalSeconds ago. Callers disable the cadence entirely via the
 * ad settings toggles instead of passing a zero/negative interval here.
 */
export function adIsDue(
  lastAdAtMs: number | null,
  nowMs: number,
  intervalSeconds: number
): boolean {
  if (lastAdAtMs === null) return true;
  if (!Number.isFinite(lastAdAtMs) || lastAdAtMs <= 0) return true;
  return nowMs - lastAdAtMs >= Math.max(1, intervalSeconds) * 1000;
}

/** Restore a persisted ad-clock timestamp — junk or missing reads as null. */
export function parseAdClock(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
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

/**
 * Closing margin for completion: the credits window on real features, but it
 * shrinks with the title so seconds-long clips still play to (nearly) the
 * end instead of instantly "completing".
 */
export function closingMarginSeconds(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(END_MARGIN_SECONDS, duration * 0.1);
}

/** A play is complete when it reaches the closing margin of the runtime. */
export function isCompleted(position: number, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  return position >= duration - closingMarginSeconds(duration);
}

/** 0..1 watched fraction, clamped (safe for zero/unknown durations). */
export function progressFraction(position: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(position) || position <= 0) return 0;
  return Math.min(1, position / duration);
}
