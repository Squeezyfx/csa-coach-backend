import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveClockDate, isFreshChartClock } from "../chart-timezone.js";

const at = (iso) => Date.parse(iso);
const reading = (extra = {}) => ({
  latestVisibleDate: "2026-11-16",
  latestVisibleDateEvidence: "inferred_axis",
  chartClock: "02:46:09",
  latestVisibleTime: null,
  ...extra,
});

test("USDINDEX D1, 17 Nov 02:46 UTC: read as 16 Nov, but the clock matches the server so it is 17 Nov", () => {
  const result = liveClockDate({ chartDetection: reading(), chartTimezone: "UTC", nowMs: at("2026-11-17T02:46:37Z") });
  assert.deepEqual(result, { date: "2026-11-17", readDate: "2026-11-16", ageMinutes: 0 });
});

test("USDCHF D1, 17 Nov 02:48 UTC: read as 14 Nov (a Saturday), three days out, is put right", () => {
  const result = liveClockDate({
    chartDetection: reading({ latestVisibleDate: "2026-11-14", chartClock: "02:48:24" }),
    chartTimezone: "UTC",
    nowMs: at("2026-11-17T02:48:45Z"),
  });
  assert.equal(result.date, "2026-11-17");
  assert.equal(result.readDate, "2026-11-14");
});

test("once corrected, the same chart counts as a fresh screenshot of the date being reviewed", () => {
  const nowMs = at("2026-11-17T02:46:37Z");
  const fixed = { ...reading(), latestVisibleDate: "2026-11-17" };
  assert.equal(isFreshChartClock({ chartDetection: fixed, chartTimezone: "UTC", nowMs, resolvedDate: "2026-11-17" }), true);
});

test("a date that is already right is left alone", () => {
  const result = liveClockDate({ chartDetection: reading({ latestVisibleDate: "2026-11-17" }), chartTimezone: "UTC", nowMs: at("2026-11-17T02:46:37Z") });
  assert.equal(result, null);
});

test("an explicit date (read off the final candle) is never replaced", () => {
  for (const evidence of ["explicit_final_candle_timestamp", "verified_axis_bar_count"]) {
    const result = liveClockDate({ chartDetection: reading({ latestVisibleDateEvidence: evidence }), chartTimezone: "UTC", nowMs: at("2026-11-17T02:46:37Z") });
    assert.equal(result, null, evidence);
  }
});

test("a screenshot whose clock is hours old is not touched (XAUUSD 13:15 clock, run at 20:31)", () => {
  const result = liveClockDate({
    chartDetection: reading({ latestVisibleDate: "2026-11-16", chartClock: "13:15:14" }),
    chartTimezone: "UTC",
    nowMs: at("2026-11-16T20:31:09Z"),
  });
  assert.equal(result, null);
});

test("no printed timezone, or no readable clock, means no change", () => {
  assert.equal(liveClockDate({ chartDetection: reading(), chartTimezone: null, nowMs: at("2026-11-17T02:46:37Z") }), null);
  assert.equal(liveClockDate({ chartDetection: reading({ chartClock: "" }), chartTimezone: "UTC", nowMs: at("2026-11-17T02:46:37Z") }), null);
  assert.equal(liveClockDate({ chartDetection: reading({ chartClock: "", latestVisibleTime: "02:46", latestVisibleTimeConfidence: "high" }), chartTimezone: "UTC", nowMs: at("2026-11-17T02:46:37Z") }), null);
  assert.equal(liveClockDate({ chartDetection: reading(), chartTimezone: "UTC", nowMs: NaN }), null);
});

test("a chart in another timezone: UTC+3 clock 05:46 at 02:46 UTC is still 17 Nov in that timezone", () => {
  const result = liveClockDate({ chartDetection: reading({ chartClock: "05:46:09" }), chartTimezone: "UTC+3", nowMs: at("2026-11-17T02:46:37Z") });
  assert.equal(result.date, "2026-11-17");
});

test("around midnight: UTC-5 clock 23:50 on 16 Nov while it is 04:55 UTC on 17 Nov belongs to 16 Nov", () => {
  const result = liveClockDate({
    chartDetection: reading({ latestVisibleDate: "2026-11-13", chartClock: "23:50:10" }),
    chartTimezone: "UTC-5",
    nowMs: at("2026-11-17T04:55:00Z"),
  });
  assert.equal(result.date, "2026-11-16");
});

test("on a weekend the last candle is Friday's, so today's date is not used", () => {
  // Saturday 14 Nov 02:46 UTC: reader says Friday 13 Nov, which is right.
  assert.equal(liveClockDate({ chartDetection: reading({ latestVisibleDate: "2026-11-13" }), chartTimezone: "UTC", nowMs: at("2026-11-14T02:46:37Z") }), null);
  // Even a wrong read is left to the existing handling rather than set to a Saturday.
  assert.equal(liveClockDate({ chartDetection: reading({ latestVisibleDate: "2026-11-11" }), chartTimezone: "UTC", nowMs: at("2026-11-15T02:46:37Z") }), null);
});

test("server wiring: runs in Final visible mode only, before the date decision, with an off switch", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /import \{ liveClockDate, parseChartTimezoneLabel/);
  assert.match(server, /process\.env\.LIVE_CLOCK_DATE \|\| "on"/);
  assert.match(server, /normalizedRequestedCutoffMode === "final_visible"\) \{\s+const clockDate = liveClockDate\(/);
  const rescue = server.indexOf("const clockDate = liveClockDate(");
  const decision = server.indexOf("let dateDecision = chooseFinalChartDate(");
  const fallback = server.indexOf("// FINAL VISIBLE date fallback.");
  assert.ok(rescue > 0 && rescue < fallback && fallback < decision);
});
