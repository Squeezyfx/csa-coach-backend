import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseChartTimezoneLabel, wallClockInTimezone, alignCutoffToChartTimezone, staleClockCutoff, isFreshChartClock, chartClockAgeMinutes } from "../chart-timezone.js";

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
  assert.match(serverSource, /staleClockCutoff\(\{ chartCutoff, chartDetection, chartTimezone: chartDetection\?\.chartTimezone, nowMs: Date\.now\(\) \}\)/);
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
  assert.match(serverSource, /const finalCandleIsLive =\s*Boolean\(staleClock\) \|\|\s*isFreshChartClock\(/);
  assert.match(serverSource, /detection: detectionForFeedMatch\(chartDetection\),/);
});
