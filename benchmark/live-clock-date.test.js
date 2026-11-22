import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveClockDate, liveClockConfirmsDate, isFreshChartClock } from "../chart-timezone.js";
import { assessChartDataMatch } from "../market-data-matching.js";

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

// XAUUSD H4 on TradingView, 2026-11-20 02:53 UTC: the reader saw 6 Dec, the future-date guard put back the typed
// 20 Nov, and the date stayed "unverified" although the printed clock matched the server to the second.
const rescued = (extra = {}) => ({
  latestVisibleDate: "2026-11-20",
  latestVisibleDateEvidence: "typed_date_after_future_rejection",
  dateConfidence: "medium",
  chartClock: "02:53:34",
  latestVisibleTime: null,
  ...extra,
});
const NOW_GOLD = at("2026-11-20T02:53:57Z");

test("a rescued date that is already today's is confirmed by the live clock", () => {
  assert.deepEqual(liveClockConfirmsDate({ chartDetection: rescued(), chartTimezone: "UTC", nowMs: NOW_GOLD }), { date: "2026-11-20", readDate: "2026-11-20", ageMinutes: 0 });
  // the replacing rule has nothing to do here, and the two never both answer
  assert.equal(liveClockDate({ chartDetection: rescued(), chartTimezone: "UTC", nowMs: NOW_GOLD }), null);
  assert.equal(liveClockConfirmsDate({ chartDetection: rescued({ latestVisibleDate: "2026-11-17" }), chartTimezone: "UTC", nowMs: NOW_GOLD }), null);
  assert.ok(liveClockDate({ chartDetection: rescued({ latestVisibleDate: "2026-11-17" }), chartTimezone: "UTC", nowMs: NOW_GOLD }));
});

test("the confirmation needs a fresh clock, a timezone, a weekday and a date that is not already explicit", () => {
  assert.equal(liveClockConfirmsDate({ chartDetection: rescued({ chartClock: "13:15:14" }), chartTimezone: "UTC", nowMs: NOW_GOLD }), null);
  assert.equal(liveClockConfirmsDate({ chartDetection: rescued(), chartTimezone: null, nowMs: NOW_GOLD }), null);
  assert.equal(liveClockConfirmsDate({ chartDetection: rescued({ chartClock: "" }), chartTimezone: "UTC", nowMs: NOW_GOLD }), null);
  assert.equal(liveClockConfirmsDate({ chartDetection: rescued({ latestVisibleDateEvidence: "verified_axis_bar_count" }), chartTimezone: "UTC", nowMs: NOW_GOLD }), null);
  // Saturday 21 Nov at the same clock time: the last candle is Friday's
  assert.equal(liveClockConfirmsDate({ chartDetection: rescued({ latestVisibleDate: "2026-11-21" }), chartTimezone: "UTC", nowMs: at("2026-11-21T02:53:57Z") }), null);
});

test("with the date confirmed the gold H4 chart matches the provider's candle; without it, it stays unverified", () => {
  const candles = [
    { datetime: "2026-11-19 20:00:00", open: 3650, high: 3660, low: 3600, close: 3640 },
    { datetime: "2026-11-20 00:00:00", open: 3631.2, high: 3637.5, low: 3522.73274, close: 3551.59924 },
  ];
  const detection = {
    latestVisiblePrice: 3551.661, latestVisiblePriceConfidence: "high", latestVisibleClose: 3551.661,
    latestVisibleOpen: 3630.444, latestVisibleHigh: 3636.726, latestVisibleLow: 3526.24,
    latestVisibleDate: "2026-11-20", latestVisibleTime: null,
  };
  const run = (extra) => assessChartDataMatch({ candles, detection: { ...detection, ...extra }, cutoff: "2026-11-20 02:53:59", timeframe: "H4", symbol: "XAU/USD", source: "Twelve Data", tolerance: 0 });
  assert.equal(run({ latestVisibleDateEvidence: "typed_date_after_future_rejection", dateConfidence: "medium" }).status, "date_unverified");
  const confirmed = run({ latestVisibleDateEvidence: "explicit_final_candle_timestamp", dateConfidence: "high" });
  assert.equal(confirmed.status, "matched_reference");
});

test("server wiring: the confirmation follows the replacing rule, is limited to the rescued date on intraday charts, and has an off switch", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /liveClockConfirmsDate(, correctChartDateYear)? \} from "\.\/chart-timezone\.js";/);
  assert.match(server, /LIVE_CLOCK_CONFIRMS_DATE/);
  const replace = server.indexOf("const clockDate = liveClockDate(");
  const confirm = server.indexOf("liveClockConfirmsDate({ chartDetection");
  assert.ok(replace > 0 && confirm > replace);
  const block = server.slice(replace, server.indexOf("// FINAL VISIBLE date fallback."));
  assert.match(block, /latestVisibleDateEvidence === "typed_date_after_future_rejection"/);
  assert.match(block, /\["M1", "M5", "M15", "M30", "H1", "H4"\]\.includes/);
  assert.match(block, /the chart's clock confirms the date/);
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
