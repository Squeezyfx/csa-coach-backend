import test from "node:test";
import assert from "node:assert/strict";
import { periodCompleteAtCutoff, lastCandleStart, lastTradingDay } from "../period-completion.js";

test("a non-Friday day-period is not complete until the calendar date rolls over, regardless of the execution interval's own last-candle-start time", () => {
  // Reproduces the EURUSD M30 bug: Tuesday 2026-09-29 at 23:36:59, interval
  // "30min" whose own last candle starts at 23:30 - 30 minutes before real
  // midnight. That must not mark the day complete.
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-29", cutoffTime: "23:36:59", periodEndDate: "2026-09-29", interval: "30min",
  }), false);
  // Same instant, finer intervals whose own last-candle-start is later still
  // correctly stayed not-complete before this fix too - confirm they still do.
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-29", cutoffTime: "23:36:59", periodEndDate: "2026-09-29", interval: "15min",
  }), false);
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-29", cutoffTime: "23:36:59", periodEndDate: "2026-09-29", interval: "1min",
  }), false);
  // Even right up to 23:58, a Tuesday is still not complete.
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-29", cutoffTime: "23:58:00", periodEndDate: "2026-09-29", interval: "30min",
  }), false);
});

test("a day is complete once the calendar date has actually rolled over", () => {
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-30", cutoffTime: "00:00:00", periodEndDate: "2026-09-29", interval: "30min",
  }), true);
  // The 23:59 end-of-day fallback still works on any weekday.
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-29", cutoffTime: "23:59:00", periodEndDate: "2026-09-29", interval: "30min",
  }), true);
});

test("Friday's early market close still completes a week via the execution interval's last-candle-start (unchanged behavior)", () => {
  assert.equal(weekdayIsFriday("2026-09-25"), true);
  // H4's own last candle starts at 20:00 - reaching it on Friday completes the week.
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-25", cutoffTime: "20:00:00", periodEndDate: "2026-09-27", interval: "4h",
  }), true);
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-25", cutoffTime: "19:59:00", periodEndDate: "2026-09-27", interval: "4h",
  }), false);
  // A finer interval than the 20:00 floor is still capped at the floor, not its own later start.
  assert.equal(lastCandleStart("30min"), "23:30");
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-25", cutoffTime: "20:00:00", periodEndDate: "2026-09-27", interval: "30min",
  }), true);
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-25", cutoffTime: "19:59:00", periodEndDate: "2026-09-27", interval: "30min",
  }), false);
});

test("weekend cutoff after a Friday-ending period is complete", () => {
  assert.equal(lastTradingDay("2026-09-27"), "2026-09-25"); // Sunday -> Friday
  assert.equal(periodCompleteAtCutoff({
    cutoffDate: "2026-09-26", cutoffTime: "00:00:00", periodEndDate: "2026-09-27", interval: "4h",
  }), true);
});

function weekdayIsFriday(dateText) {
  return new Date(`${dateText}T00:00:00Z`).getUTCDay() === 5;
}
