import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstCandleOfDayGap, parseChartTimezoneLabel, wallClockInTimezone, alignCutoffToChartTimezone, staleClockCutoff, isFreshChartClock, chartClockAgeMinutes, chartDateIsInFuture, rescueFutureChartDate, inferChartTimezoneFromLiveClock, timezoneOffsetMinutesAt, chartClockTime, liveCandleOpenTime } from "../chart-timezone.js";

test("the timezone label printed beside the chart clock is read", () => {
  assert.deepEqual(parseChartTimezoneLabel("UTC"), { label: "UTC", offsetMinutes: 0 });
  assert.deepEqual(parseChartTimezoneLabel(" utc+1 "), { label: "UTC+1", offsetMinutes: 60 });
  assert.deepEqual(parseChartTimezoneLabel("UTC-5:30"), { label: "UTC-5:30", offsetMinutes: -330 });
  assert.deepEqual(parseChartTimezoneLabel("GMT+0"), { label: "UTC", offsetMinutes: 0 });
  assert.equal(parseChartTimezoneLabel("UTC+15"), null);
  assert.equal(parseChartTimezoneLabel("Africa/Lagos"), null);
  assert.equal(parseChartTimezoneLabel(null), null);
});

test("a wall clock is rewritten as the same instant in another timezone", () => {
  assert.equal(wallClockInTimezone("2026-11-11 14:29:59", 0, "Africa/Lagos"), "2026-11-11 15:29:59");
  assert.equal(wallClockInTimezone("2026-11-11 23:30:00", 0, "Africa/Lagos"), "2026-11-12 00:30:00");
  assert.equal(wallClockInTimezone("2026-11-11 14:29:59", 60, "America/New_York"), "2026-11-11 08:29:59");
  assert.equal(wallClockInTimezone("not a time", 0, "UTC"), null);
});

const finalVisible = { mode: "final_visible", precision: "exact-visible", exactVisibleCutoff: true, endDateTime: "2026-11-11 14:29:59" };

test("a UTC chart read on a Lagos device is fetched in UTC, so the last candle is not cut off", () => {
  const result = alignCutoffToChartTimezone({ chartCutoff: finalVisible, chartTimezone: "UTC", deviceTimezone: "Africa/Lagos" });
  assert.equal(result.applied, true);
  assert.equal(result.timezone, "UTC");
  assert.equal(result.endDateTime, "2026-11-11 14:29:59");
});

test("a chart in another offset keeps the device timezone and moves the cutoff to the same instant", () => {
  const result = alignCutoffToChartTimezone({ chartCutoff: finalVisible, chartTimezone: "UTC+1", deviceTimezone: "America/New_York" });
  assert.equal(result.applied, true);
  assert.equal(result.timezone, "America/New_York");
  assert.equal(result.endDateTime, "2026-11-11 08:29:59");
});

test("nothing changes without a printed timezone or an exact visible cutoff", () => {
  const device = "Africa/Lagos";
  for (const input of [
    { chartCutoff: finalVisible, chartTimezone: null },
    { chartCutoff: finalVisible, chartTimezone: "Europe/London" },
    { chartCutoff: { ...finalVisible, precision: "invalid" }, chartTimezone: "UTC" },
    { chartCutoff: { ...finalVisible, mode: "selected_day" }, chartTimezone: "UTC" },
    { chartCutoff: { mode: "exact", exactVisibleCutoff: true, endDateTime: "2026-11-11 06:00:59" }, chartTimezone: "UTC" },
  ]) {
    const result = alignCutoffToChartTimezone({ ...input, deviceTimezone: device });
    assert.equal(result.applied, false);
    assert.equal(result.timezone, device);
    assert.equal(result.endDateTime, input.chartCutoff.endDateTime);
  }
});

const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("the Sunday reopen is added to Monday whatever timezone the chart prints", () => {
  assert.match(serverSource, /chartCutoff\.chartTimezone = parseChartTimezoneLabel\(chartDetection\?\.chartTimezone\)/);
  assert.match(serverSource, /\n {2}dailyLevels = extendPeriodsAcrossSessionBoundary\(dailyLevels, impulseCandles, profile\);/);
  assert.doesNotMatch(serverSource, /if \(!chartCutoff\?\.chartTimezone\) \{\s*dailyLevels = extendPeriodsAcrossSessionBoundary/);
});

const dayFallback = {
  mode: "final_visible",
  precision: "day",
  source: "chart-final-visible-day-fallback",
  resolvedDate: "2026-11-11",
  endDateTime: "2026-11-11 23:59:59",
};

test("the end-of-day fallback also follows the chart's own timezone", () => {
  const utc = alignCutoffToChartTimezone({ chartCutoff: dayFallback, chartTimezone: "UTC", deviceTimezone: "Africa/Lagos" });
  assert.equal(utc.applied, true);
  assert.equal(utc.timezone, "UTC");
  assert.equal(utc.endDateTime, "2026-11-11 23:59:59");
  const shifted = alignCutoffToChartTimezone({ chartCutoff: dayFallback, chartTimezone: "UTC+1", deviceTimezone: "America/New_York" });
  assert.equal(shifted.timezone, "America/New_York");
  assert.equal(shifted.endDateTime, "2026-11-11 17:59:59");
});

const detection = { latestVisibleDate: "2026-11-11", latestVisibleTime: "14:29", latestVisibleTimeConfidence: "high" };
const at = (hour, minute) => Date.UTC(2026, 10, 11, hour, minute);

test("an old screenshot is cut off at its own chart clock instead of the end of the day", () => {
  const result = staleClockCutoff({ chartCutoff: dayFallback, chartDetection: detection, chartTimezone: "UTC", nowMs: at(16, 34) });
  assert.deepEqual(result, { endDateTime: "2026-11-11 14:29:59", ageMinutes: 124 });
  const shifted = staleClockCutoff({ chartCutoff: dayFallback, chartDetection: detection, chartTimezone: "UTC+1", nowMs: at(16, 34) });
  assert.deepEqual(shifted, { endDateTime: "2026-11-11 14:29:59", ageMinutes: 184 });
});

test("a fresh screenshot, or one without a trustworthy clock, keeps the end-of-day fallback", () => {
  const base = { chartCutoff: dayFallback, chartDetection: detection, chartTimezone: "UTC", nowMs: at(16, 34) };
  assert.equal(staleClockCutoff({ ...base, nowMs: at(14, 40) }), null);
  assert.equal(staleClockCutoff({ ...base, chartTimezone: null }), null);
  assert.equal(staleClockCutoff({ ...base, chartDetection: { ...detection, latestVisibleTimeConfidence: "low" } }), null);
  assert.equal(staleClockCutoff({ ...base, chartDetection: { ...detection, latestVisibleTime: "00:00" } }), null);
  assert.equal(staleClockCutoff({ ...base, chartDetection: { ...detection, latestVisibleDate: "2026-11-10" } }), null);
  assert.equal(staleClockCutoff({ ...base, chartCutoff: { ...dayFallback, source: "chart-final-visible-candle" } }), null);
});

test("the stale-screenshot cutoff can be switched off", () => {
  assert.match(serverSource, /STALE_SCREENSHOT_CLOCK_CUTOFF/);
  assert.match(serverSource, /staleClockCutoff\(\{ chartCutoff, chartDetection, chartTimezone: chartDetection\?\.chartTimezone, nowMs: Date\.now\(\), staleMinutes: -10 \}\)/);
});

test("a fresh screenshot is also cut off at its clock, so today stays a partial period", () => {
  const fresh = { chartDetection: { ...detection, latestVisibleTime: "20:11" }, chartCutoff: dayFallback, chartTimezone: "UTC" };
  const now = Date.UTC(2026, 10, 11, 20, 21, 0);
  assert.equal(staleClockCutoff({ ...fresh, nowMs: now }), null, "the default still waits for 45 minutes");
  assert.deepEqual(staleClockCutoff({ ...fresh, nowMs: now, staleMinutes: -10 }), { endDateTime: "2026-11-11 20:11:59", ageMinutes: 9 });
  // a clock more than 10 minutes ahead of the server is not trusted
  assert.equal(staleClockCutoff({ ...fresh, nowMs: Date.UTC(2026, 10, 11, 19, 55, 0), staleMinutes: -10 }), null);
});

test("a recent chart clock means the candle still forming in the feed is the screenshot's final candle", () => {
  const base = { chartDetection: { ...detection, latestVisibleTime: "17:19", latestVisibleTimeConfidence: "medium" }, chartTimezone: "UTC", resolvedDate: "2026-11-11" };
  // analysed 21 seconds after the chart's clock minute, as in the fast GBPUSD crash on 2026-11-11
  assert.equal(isFreshChartClock({ ...base, nowMs: Date.UTC(2026, 10, 11, 17, 19, 37) }), true);
  assert.equal(isFreshChartClock({ ...base, nowMs: Date.UTC(2026, 10, 11, 18, 30) }), false);
  assert.equal(isFreshChartClock({ ...base, nowMs: Date.UTC(2026, 10, 11, 17, 5) }), false, "a clock far in the future is not trusted");
  assert.equal(isFreshChartClock({ ...base, chartTimezone: null, nowMs: Date.UTC(2026, 10, 11, 17, 19, 37) }), false);
  assert.equal(isFreshChartClock({ ...base, chartDetection: { ...base.chartDetection, latestVisibleTimeConfidence: "low" }, nowMs: Date.UTC(2026, 10, 11, 17, 19, 37) }), false);
  assert.equal(isFreshChartClock({ ...base, resolvedDate: "2026-11-10", nowMs: Date.UTC(2026, 10, 11, 17, 19, 37) }), false);
});

test("the chart clock age follows the printed offset", () => {
  const age = chartClockAgeMinutes({ chartDetection: detection, chartTimezone: "UTC+1", nowMs: at(16, 34), resolvedDate: "2026-11-11" });
  assert.equal(Math.round(age), 184);
  assert.equal(chartClockAgeMinutes({ chartDetection: detection, chartTimezone: "UTC", nowMs: NaN, resolvedDate: "2026-11-11" }), null);
});

test("the feed check may use the live candle when the chart clock is recent", () => {
  assert.match(serverSource, /const freshClockNow = isFreshChartClock\(/);
  assert.match(serverSource, /const finalCandleIsLive = Boolean\(staleClock\) \|\| freshClockNow;/);
  assert.match(serverSource, /detection: detectionForFeedMatch\(chartDetection\),/);
});

const readerDetection = { latestVisibleDate: "2026-11-12", latestVisibleTime: "17:19", latestVisibleTimeConfidence: "medium" };
const nowAt1732 = Date.UTC(2026, 10, 11, 17, 32, 12);

test("a chart date in the future is detected with or without a printed timezone", () => {
  assert.equal(chartDateIsInFuture({ chartDetection: readerDetection, chartTimezone: "UTC", nowMs: nowAt1732 }), true);
  assert.equal(chartDateIsInFuture({ chartDetection: { ...readerDetection, latestVisibleDate: "2026-11-11" }, chartTimezone: "UTC", nowMs: nowAt1732 }), false);
  // a clock a few minutes ahead is tolerated
  assert.equal(chartDateIsInFuture({ chartDetection: { ...readerDetection, latestVisibleDate: "2026-11-11", latestVisibleTime: "17:38" }, chartTimezone: "UTC", nowMs: nowAt1732 }), false);
  assert.equal(chartDateIsInFuture({ chartDetection: { ...readerDetection, latestVisibleDate: "2026-11-11", latestVisibleTime: "18:30" }, chartTimezone: "UTC", nowMs: nowAt1732 }), true);
  // no printed timezone: tomorrow could be real in UTC+14, two days ahead cannot
  assert.equal(chartDateIsInFuture({ chartDetection: { latestVisibleDate: "2026-11-12" }, chartTimezone: null, nowMs: nowAt1732 }), false);
  assert.equal(chartDateIsInFuture({ chartDetection: { latestVisibleDate: "2026-11-13" }, chartTimezone: null, nowMs: nowAt1732 }), true);
  assert.equal(chartDateIsInFuture({ chartDetection: {}, chartTimezone: "UTC", nowMs: nowAt1732 }), false);
});

test("a future chart date is replaced by the typed date when that date is possible", () => {
  const base = { chartDetection: readerDetection, chartTimezone: "UTC", nowMs: nowAt1732 };
  assert.deepEqual(rescueFutureChartDate({ ...base, selectedDateText: "2026-11-11" }), { rejectedDate: "2026-11-12", date: "2026-11-11" });
  assert.deepEqual(rescueFutureChartDate({ ...base, selectedDateText: "2026-11-12" }), { rejectedDate: "2026-11-12", date: null });
  assert.deepEqual(rescueFutureChartDate({ ...base, selectedDateText: "" }), { rejectedDate: "2026-11-12", date: null });
  assert.equal(rescueFutureChartDate({ ...base, chartDetection: { ...readerDetection, latestVisibleDate: "2026-11-11" }, selectedDateText: "2026-11-11" }), null);
});

test("the future-date guard is applied before the date decision", () => {
  assert.match(serverSource, /const futureDate = rescueFutureChartDate\(/);
  assert.ok(serverSource.indexOf("const futureDate = rescueFutureChartDate(") < serverSource.indexOf("let dateDecision = chooseFinalChartDate("));
});

const inferNow = Date.UTC(2026, 10, 11, 17, 25, 0);
const clock = (time, extra = {}) => ({ latestVisibleDate: "2026-11-11", latestVisibleTime: time, latestVisibleTimeConfidence: "medium", chartTimezone: null, ...extra });

test("the offset of a timezone is worked out for a given moment", () => {
  assert.equal(timezoneOffsetMinutesAt("Africa/Lagos", inferNow), 60);
  assert.equal(timezoneOffsetMinutesAt("UTC", inferNow), 0);
  assert.equal(timezoneOffsetMinutesAt("America/New_York", inferNow), -300);
  assert.equal(timezoneOffsetMinutesAt("Not/AZone", inferNow), null);
});

test("a clock within minutes of the server's, at UTC or the device offset, names the chart timezone", () => {
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("17:22"), nowMs: inferNow, deviceTimezone: "Africa/Lagos" }), "UTC");
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("18:22"), nowMs: inferNow, deviceTimezone: "Africa/Lagos" }), "UTC+1");
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("17:19"), nowMs: inferNow, deviceTimezone: "Africa/Lagos" }), "UTC");
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("12:22"), nowMs: inferNow, deviceTimezone: "America/New_York" }), "UTC-5");
});

test("no timezone is inferred when the clock is old, the date is off, the read is weak or a timezone was already read", () => {
  const args = { nowMs: inferNow, deviceTimezone: "Africa/Lagos" };
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("15:25"), ...args }), null);
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("17:22", { latestVisibleDate: "2026-11-10" }), ...args }), null);
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("17:22", { latestVisibleDate: null }), ...args }), null);
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("17:22", { latestVisibleTimeConfidence: "low" }), ...args }), null);
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("00:00"), ...args }), null);
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("17:22", { chartTimezone: "UTC+2" }), ...args }), null);
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("17:40"), ...args }), null);
});

test("a device in UTC does not produce two competing answers", () => {
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: clock("17:22"), nowMs: inferNow, deviceTimezone: "UTC" }), "UTC");
});

test("the inference is wired in before the cutoff is resolved", () => {
  const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const inferAt = source.indexOf("inferChartTimezoneFromLiveClock({");
  assert.ok(inferAt > 0);
  assert.ok(inferAt < source.indexOf("FINAL VISIBLE date fallback"));
  assert.match(source, /INFER_CHART_TIMEZONE/);
});

test("the clock as printed wins over the last-candle time, so a dropped hour cannot send the review to the wrong hour", () => {
  // 2026-11-11: the chart showed "20:11:58 UTC" and the reader returned latestVisibleTime "11:58"
  const misread = { latestVisibleDate: "2026-11-11", latestVisibleTime: "11:58", latestVisibleTimeConfidence: "medium", chartClock: "20:11:58" };
  assert.deepEqual(chartClockTime(misread), { time: "20:11", fromClock: true });
  assert.deepEqual(chartClockTime({ latestVisibleTime: "17:19", latestVisibleTimeConfidence: "medium" }), { time: "17:19", fromClock: false });
  assert.equal(chartClockTime({ latestVisibleTime: "17:19", latestVisibleTimeConfidence: "low" }), null);
  assert.equal(chartClockTime({ chartClock: "25:99:00" }), null);
  const now = Date.UTC(2026, 10, 11, 20, 12, 30);
  assert.equal(isFreshChartClock({ chartDetection: misread, chartTimezone: "UTC", nowMs: now, resolvedDate: "2026-11-11" }), true);
  assert.equal(staleClockCutoff({ chartCutoff: dayFallback, chartDetection: misread, chartTimezone: "UTC", nowMs: now }), null);
  assert.equal(inferChartTimezoneFromLiveClock({ chartDetection: { ...misread, chartTimezone: null }, nowMs: now, deviceTimezone: "Africa/Lagos" }), "UTC");
  // an old screenshot whose clock is read as printed is still cut off at that clock
  const old = staleClockCutoff({ chartCutoff: dayFallback, chartDetection: { ...misread, chartClock: "11:58:02" }, chartTimezone: "UTC", nowMs: now });
  assert.deepEqual(old, { endDateTime: "2026-11-11 11:58:59", ageMinutes: 494 });
});

test("the live candle is the one opened at the clock rounded down to the timeframe, on the provider's clock", () => {
  const live = { latestVisibleDate: "2026-11-11", chartClock: "17:19:10" };
  assert.equal(liveCandleOpenTime({ chartDetection: live, chartTimezone: "UTC", timeframe: "H1", providerTimezone: "UTC" }), "17:00");
  assert.equal(liveCandleOpenTime({ chartDetection: live, chartTimezone: "UTC", timeframe: "M15", providerTimezone: "UTC" }), "17:15");
  assert.equal(liveCandleOpenTime({ chartDetection: live, chartTimezone: "UTC", timeframe: "M5", providerTimezone: "UTC" }), "17:15");
  assert.equal(liveCandleOpenTime({ chartDetection: live, chartTimezone: "UTC", timeframe: "H1", providerTimezone: "Africa/Lagos" }), "18:00");
  assert.equal(liveCandleOpenTime({ chartDetection: live, chartTimezone: "UTC+1", timeframe: "H1", providerTimezone: "Africa/Lagos" }), "17:00");
  assert.equal(liveCandleOpenTime({ chartDetection: live, chartTimezone: "UTC", timeframe: "H4", providerTimezone: "UTC" }), null);
  assert.equal(liveCandleOpenTime({ chartDetection: live, chartTimezone: null, timeframe: "H1", providerTimezone: "UTC" }), null);
  assert.equal(liveCandleOpenTime({ chartDetection: { chartClock: "17:19:10" }, chartTimezone: "UTC", timeframe: "H1", providerTimezone: "UTC" }), null);
});

test("the chart clock is asked for, parsed and used by the feed check", () => {
  assert.match(serverSource, /"chartClock": "HH:mm:ss exactly as printed/);
  assert.match(serverSource, /chartClock: isTradingChart && /);
  assert.match(serverSource, /liveCandleOpenTime\(\{/);
});

// First hour of a trading day: no finished candle yet today (DXY 2026-11-12 00:49 UTC had no entry).
const candlesThroughWednesday = [
  { datetime: "2026-11-10 23:00:00" },
  { datetime: "2026-11-11 22:00:00" },
  { datetime: "2026-11-11 23:00:00" },
];
test("in the first hour of the day the review is taken as of the end of the previous day", () => {
  assert.deepEqual(
    firstCandleOfDayGap({ endDateTime: "2026-11-12 00:49:59", timeframe: "H1", candles: candlesThroughWednesday }),
    { endDateTime: "2026-11-11 23:59:59", resolvedDate: "2026-11-11" }
  );
  assert.deepEqual(
    firstCandleOfDayGap({ endDateTime: "2026-11-12 00:14:59", timeframe: "M15", candles: candlesThroughWednesday }),
    { endDateTime: "2026-11-11 23:59:59", resolvedDate: "2026-11-11" }
  );
  assert.deepEqual(
    firstCandleOfDayGap({ endDateTime: "2026-11-12 00:00:30", timeframe: "1h", candles: candlesThroughWednesday }),
    { endDateTime: "2026-11-11 23:59:59", resolvedDate: "2026-11-11" }
  );
});

test("the first-hour roll-back does not apply when today already has a finished candle or the day is not a plain weekday", () => {
  // The first H1 candle of the day has finished (it is 01:10): nothing to roll back.
  assert.equal(firstCandleOfDayGap({ endDateTime: "2026-11-12 01:10:59", timeframe: "H1", candles: candlesThroughWednesday }), null);
  // M15 chart at 00:20: the 00:00 candle is finished.
  assert.equal(firstCandleOfDayGap({ endDateTime: "2026-11-12 00:20:59", timeframe: "M15", candles: candlesThroughWednesday }), null);
  // The feed already holds a candle for today (a historical chart whose 00:00 candle is complete).
  assert.equal(
    firstCandleOfDayGap({ endDateTime: "2026-11-12 00:49:59", timeframe: "H1", candles: [...candlesThroughWednesday, { datetime: "2026-11-12 00:00:00" }] }),
    null
  );
  // The feed stops earlier than yesterday: a different gap, not this one.
  assert.equal(firstCandleOfDayGap({ endDateTime: "2026-11-12 00:49:59", timeframe: "H1", candles: [{ datetime: "2026-11-10 23:00:00" }] }), null);
  // Monday (Sunday-evening open), Saturday, Sunday and crypto are left alone.
  assert.equal(firstCandleOfDayGap({ endDateTime: "2026-11-09 00:30:00", timeframe: "H1", candles: [{ datetime: "2026-11-08 23:00:00" }] }), null);
  assert.equal(firstCandleOfDayGap({ endDateTime: "2026-11-12 00:49:59", timeframe: "H1", candles: candlesThroughWednesday, tradesOnWeekends: true }), null);
  // Frameworks that are not day-based (H4, D1) never roll back; end-of-day cutoffs neither.
  assert.equal(firstCandleOfDayGap({ endDateTime: "2026-11-12 00:49:59", timeframe: "H4", candles: candlesThroughWednesday }), null);
  assert.equal(firstCandleOfDayGap({ endDateTime: "2026-11-11 23:59:59", timeframe: "H1", candles: candlesThroughWednesday }), null);
  assert.equal(firstCandleOfDayGap({ endDateTime: "", timeframe: "H1", candles: candlesThroughWednesday }), null);
  assert.equal(firstCandleOfDayGap({}), null);
});

test("the first-hour roll-back is wired into the market-data fetch and can be switched off", () => {
  assert.match(serverSource, /firstCandleOfDayGap\(\{/);
  assert.match(serverSource, /FIRST_HOUR_ROLLBACK/);
  assert.match(serverSource, /chartCutoff\.source = "chart-first-hour-previous-day"/);
  assert.match(serverSource, /let resolvedAnalysisDate = parseISODateOnly\(chartCutoff\.resolvedDate\);/);
});
