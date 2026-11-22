import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { correctChartDateYear } from "../chart-timezone.js";

const at = (iso) => Date.parse(iso);
const reading = (extra = {}) => ({
  latestVisibleDate: "2024-11-22",
  latestVisibleDateEvidence: "inferred_axis",
  chartClock: "22:43:57",
  latestVisibleTime: null,
  chartTimezone: "UTC",
  ...extra,
});
const fix = (detection, extra = {}) =>
  correctChartDateYear({ chartDetection: detection, chartTimezone: "UTC", nowMs: at("2026-11-22T22:44:44Z"), selectedDateText: "2026-11-22", ...extra });

test("USDINDEX H4, Sunday 22 Nov 2026 22:44 UTC: read as 22 Nov 2024, typed 2026-11-22, the clock matches, so the year is 2026", () => {
  assert.deepEqual(fix(reading()), { date: "2026-11-22", readDate: "2024-11-22", typedDate: "2026-11-22" });
});

test("a reader date a day or two off the typed day keeps its own month and day in the typed year", () => {
  assert.equal(fix(reading({ latestVisibleDate: "2025-11-21" }))?.date, "2026-11-21");
});

test("an old chart of the same time of year is left alone: the printed clock must match the server's clock", () => {
  assert.equal(fix(reading({ chartClock: "10:05:00" })), null);
  assert.equal(fix(reading({ chartClock: null })), null);
});

test("an explicit date (read off the final candle) is never changed", () => {
  assert.equal(fix(reading({ latestVisibleDateEvidence: "explicit_final_candle_timestamp" })), null);
  assert.equal(fix(reading({ latestVisibleDateEvidence: "verified_axis_bar_count" })), null);
});

test("the same year, a different time of year, or a typed date in another year are not touched", () => {
  assert.equal(fix(reading({ latestVisibleDate: "2026-11-20" })), null);
  assert.equal(fix(reading({ latestVisibleDate: "2024-06-14" })), null);
  assert.equal(fix(reading(), { selectedDateText: "2026-11-10" }), null);
  assert.equal(fix(reading(), { selectedDateText: "" }), null);
  assert.equal(fix(reading(), { selectedDateText: "not a date" }), null);
});

test("a corrected date in the future is not used", () => {
  assert.equal(fix(reading({ latestVisibleDate: "2025-11-26" }), { selectedDateText: "2026-11-26" }), null);
});

test("29 February in a year with no 29 February is not invented", () => {
  assert.equal(correctChartDateYear({ chartDetection: reading({ latestVisibleDate: "2024-02-29" }), chartTimezone: "UTC", nowMs: at("2026-03-01T22:44:44Z"), selectedDateText: "2026-03-01" }), null);
});

test("server.js applies the year fix before the live-clock date step, with an off switch", () => {
  const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /correctChartDateYear/);
  assert.match(source, /DATE_YEAR_SLIP_FIX/);
  assert.ok(source.indexOf("correctChartDateYear({") < source.indexOf("// LIVE CLOCK DATE."), "year fix must run before the live-clock date step");
});
