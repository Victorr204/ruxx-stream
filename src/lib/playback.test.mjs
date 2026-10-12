import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOSAVE_INTERVAL_SECONDS,
  DEFAULT_AD_INTERVAL_SECONDS,
  adIsDue,
  closingMarginSeconds,
  initialResumePosition,
  isCompleted,
  parseAdClock,
  progressFraction,
  shouldAutosave,
} from "./playback.ts";

// ── Ad cadence: one ad per title every interval of wall-clock time ──────

test("the default ad interval is ten minutes of wall-clock time", () => {
  assert.equal(DEFAULT_AD_INTERVAL_SECONDS, 600);
});

test("a title with no ad history is due immediately", () => {
  assert.equal(adIsDue(null, 1_000_000, 600), true);
});

test("inside the window after an ad, nothing is due", () => {
  const lastAd = 50_000_000;
  assert.equal(adIsDue(lastAd, lastAd + 1_000, 600), false);
  assert.equal(adIsDue(lastAd, lastAd + 599_000, 600), false);
});

test("at exactly the interval the next ad is due", () => {
  const lastAd = 50_000_000;
  assert.equal(adIsDue(lastAd, lastAd + 600_000, 600), true);
  assert.equal(adIsDue(lastAd, lastAd + 600_001, 600), true);
});

test("leaving the player does not pause the countdown", () => {
  // Ad shown, viewer leaves immediately and returns eight minutes later:
  // still inside the window, so no ad.
  const lastAd = 10_000_000;
  assert.equal(adIsDue(lastAd, lastAd + 8 * 60_000, 600), false);
  // Twelve minutes after the ad (four away, eight back), it is due.
  assert.equal(adIsDue(lastAd, lastAd + 12 * 60_000, 600), true);
});

test("an interval of zero or less still treats a stamp as due at 1s", () => {
  const lastAd = 10_000_000;
  assert.equal(adIsDue(lastAd, lastAd + 1_000, 0), true);
  assert.equal(adIsDue(lastAd, lastAd + 500, -5), false);
});

test("corrupt stored stamps read as never-shown (=> due)", () => {
  assert.equal(adIsDue(Number.NaN, 1_000, 600), true);
  assert.equal(adIsDue(0, 1_000, 600), true);
  assert.equal(adIsDue(-9, 1_000, 600), true);
});

test("parseAdClock restores only sane stored values", () => {
  assert.equal(parseAdClock("1728000000000"), 1728000000000);
  assert.equal(parseAdClock(null), null);
  assert.equal(parseAdClock(undefined), null);
  assert.equal(parseAdClock(""), null);
  assert.equal(parseAdClock("junk"), null);
  assert.equal(parseAdClock("-5"), null);
  assert.equal(parseAdClock("0"), null);
});

test("an ad shown after the clock restarts the window from the new stamp", () => {
  const first = 1_000_000;
  const second = first + 700_000; // shown a bit late
  assert.equal(adIsDue(first, first + 650_000, 600), true); // due before second
  assert.equal(adIsDue(second, second + 100_000, 600), false); // fresh window
  assert.equal(adIsDue(second, second + 600_000, 600), true); // due again
});

// ── Resume / save rules ─────────────────────────────────────────────────

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
