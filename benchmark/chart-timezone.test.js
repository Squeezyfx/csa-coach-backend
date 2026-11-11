import test from "node:test";
import assert from "node:assert/strict";
import { parseChartTimezoneLabel, wallClockInTimezone, alignCutoffToChartTimezone } from "../chart-timezone.js";

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

const finalVisible = { mode: "final_visible", exactVisibleCutoff: true, endDateTime: "2026-11-11 14:29:59" };

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
    { chartCutoff: { ...finalVisible, exactVisibleCutoff: false }, chartTimezone: "UTC" },
    { chartCutoff: { ...finalVisible, mode: "selected_day" }, chartTimezone: "UTC" },
    { chartCutoff: { mode: "exact", exactVisibleCutoff: true, endDateTime: "2026-11-11 06:00:59" }, chartTimezone: "UTC" },
  ]) {
    const result = alignCutoffToChartTimezone({ ...input, deviceTimezone: device });
    assert.equal(result.applied, false);
    assert.equal(result.timezone, device);
    assert.equal(result.endDateTime, input.chartCutoff.endDateTime);
  }
});
