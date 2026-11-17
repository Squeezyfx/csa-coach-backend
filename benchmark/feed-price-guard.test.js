import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chartPriceFarFromFeed, pageDataMatchStatus, correctPriceSlipAgainstLiveCandle } from "../feed-price-guard.js";

const candles = [
  { datetime: "2026-11-11 15:00:00", close: 1.32836 },
  { datetime: "2026-11-11 16:00:00", close: 1.32789 },
];
const unmatched = { chartDataMatch: { status: "unverified" }, timeframeCandles: candles };

test("a last price about 100 pips from the unmatched feed is distrusted", () => {
  assert.equal(chartPriceFarFromFeed({ chartDetection: { latestVisiblePrice: 1.3077 }, marketReference: unmatched }), true);
  assert.equal(chartPriceFarFromFeed({ chartDetection: { latestVisiblePrice: 1.3177 }, marketReference: unmatched }), true);
});

test("a normal gap, a matched feed or missing data is not flagged", () => {
  assert.equal(chartPriceFarFromFeed({ chartDetection: { latestVisiblePrice: 1.3264 }, marketReference: unmatched }), false);
  assert.equal(chartPriceFarFromFeed({ chartDetection: { latestVisiblePrice: 1.3077 }, marketReference: { ...unmatched, chartDataMatch: { status: "matched_reference" } } }), false);
  assert.equal(chartPriceFarFromFeed({ chartDetection: { latestVisiblePrice: 1.3077 }, marketReference: { chartDataMatch: { status: "unverified" }, timeframeCandles: [] } }), false);
  assert.equal(chartPriceFarFromFeed({ chartDetection: {}, marketReference: unmatched }), false);
});

test("the page is told 'Lower confidence' for every unmatched market-data check", () => {
  assert.equal(pageDataMatchStatus("matched_reference", true), "matched_reference");
  assert.equal(pageDataMatchStatus("partial_reference", true), "partial_reference");
  assert.equal(pageDataMatchStatus("time_unverified", true), "time_unverified");
  assert.equal(pageDataMatchStatus("unverified", true), "mismatch");
  assert.equal(pageDataMatchStatus("", true), "mismatch");
  assert.equal(pageDataMatchStatus("", false), "");
});

const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const pillarsSource = readFileSync(new URL("../trade-pillars.js", import.meta.url), "utf8");

test("the guards are wired into the response and the review text", () => {
  assert.match(serverSource, /priceUnreliable: chartPriceFarFromFeed\(\{ chartDetection, marketReference \}\)/);
  assert.match(serverSource, /dataMatchStatus: pageDataMatchStatus\(/);
  // only the helper itself may read the raw price
  assert.equal((pillarsSource.match(/num\(facts\?\.currentPrice\)/g) || []).length, 1);
  assert.match(pillarsSource, /facts\?\.priceUnreliable === true \? null/);
});

test("a one-digit slip is corrected only when the live candle disagrees and exactly one slip lands near it", () => {
  assert.deepEqual(correctPriceSlipAgainstLiveCandle({ price: 1.3077, liveClose: 1.3177 }), { price: 1.3177, delta: 0.01 });
  assert.deepEqual(correctPriceSlipAgainstLiveCandle({ price: 1.3277, liveClose: 1.3177 }), { price: 1.3177, delta: -0.01 });
  // already agrees with the live candle
  assert.equal(correctPriceSlipAgainstLiveCandle({ price: 1.3177, liveClose: 1.319 }), null);
  // far from the live candle but no one-digit slip explains it
  assert.equal(correctPriceSlipAgainstLiveCandle({ price: 1.3077, liveClose: 1.325 }), null);
  assert.deepEqual(correctPriceSlipAgainstLiveCandle({ price: 1.35, liveClose: 1.36 }), { price: 1.36, delta: 0.01 });
  // the 2026-11-11 reads: 1.3277 read as 1.3077 (a 0.02 slip) and 1.32777 read as 1.31777
  assert.deepEqual(correctPriceSlipAgainstLiveCandle({ price: 1.3077, liveClose: 1.3277 }), { price: 1.3277, delta: 0.02 });
  assert.deepEqual(correctPriceSlipAgainstLiveCandle({ price: 1.31777, liveClose: 1.3278 }), { price: 1.32777, delta: 0.01 });
  assert.equal(correctPriceSlipAgainstLiveCandle({ price: 0, liveClose: 1.3177 }), null);
  assert.equal(correctPriceSlipAgainstLiveCandle({ price: 1.3077, liveClose: null }), null);
});

test("the slip correction is wired in before the feed check and only for a live final candle", () => {
  const at = serverSource.indexOf("correctPriceSlipAgainstLiveCandle({");
  assert.ok(at > 0);
  assert.ok(at < serverSource.indexOf("chartDataMatch = assessChartDataMatch({"));
  assert.match(serverSource, /finalCandleIsLive && liveCandle/);
  assert.match(serverSource, /PRICE_SLIP_CORRECTION/);
});

test("a computed feed (the US Dollar Index) does not show the lower-confidence warning for unverified time or date", () => {
  for (const status of ["time_unverified", "date_unverified", "partial_or_unknown_candle"]) {
    assert.equal(pageDataMatchStatus(status, true, true), "partial_reference");
    // Ordinary feeds keep the warning.
    assert.equal(pageDataMatchStatus(status, true, false), status);
    assert.equal(pageDataMatchStatus(status, true), status);
  }
  // A real price disagreement still warns, even for the computed feed.
  assert.equal(pageDataMatchStatus("mismatch", true, true), "mismatch");
  // Matched stays matched, and no market data at all still warns.
  assert.equal(pageDataMatchStatus("matched_reference", true, true), "matched_reference");
  assert.equal(pageDataMatchStatus("session_unverified", true, true), "mismatch");
});

test("the clean chart is told the instrument's feed is computed", () => {
  assert.match(serverSource, /isSyntheticInstrument\(submittedInstrument\)/);
});

import { sameInstrumentFromFeed } from "../feed-price-guard.js";

// XAUUSD 17 Nov 23:20 UTC: the chart's daily candle had only been open since 22:00 UTC (range 10), the data's
// day candle was the whole UTC day. Close agrees (0.2%), open/high/low are tens of points apart.
const goldLate = [
  { field: "close", chart: 3854.63, provider: 3846.8026 },
  { field: "open", chart: 3848.97, provider: 3885.3 },
  { field: "high", chart: 3855.54, provider: 3901.2 },
  { field: "low", chart: 3845.4, provider: 3833.7 },
];

test("an unaligned chart candle is judged on its close only, so a new-session candle does not fail gold", () => {
  const result = sameInstrumentFromFeed({ comparisons: goldLate, status: "date_unverified" });
  assert.equal(result.confirmed, true);
  assert.equal(result.closeOnly, true);
  assert.equal(result.deviations.length, 1);
});

test("an aligned or matched chart keeps every price in the check", () => {
  for (const status of ["matched_reference", "partial_reference", "mismatch"]) {
    const result = sameInstrumentFromFeed({ comparisons: goldLate, status });
    assert.equal(result.confirmed, false, status);
    assert.equal(result.closeOnly, false, status);
    assert.ok(result.maxDeviation > 0.005, status);
  }
});

test("a wrong-symbol chart (close off by whole percent) still fails even when unaligned", () => {
  const wrong = [{ field: "close", chart: 1.0850, provider: 1.1130 }, { field: "open", chart: 1.0830, provider: 1.1100 }];
  assert.equal(sameInstrumentFromFeed({ comparisons: wrong, status: "date_unverified" }).confirmed, false);
  // Gold read from a silver-priced chart, and no comparisons at all, are not confirmed either.
  assert.equal(sameInstrumentFromFeed({ comparisons: [{ field: "close", chart: 30, provider: 3846 }], status: "time_unverified" }).confirmed, false);
  assert.equal(sameInstrumentFromFeed({ comparisons: [], status: "date_unverified" }).confirmed, false);
});

test("unchanged for the passing gold case (all four prices within 0.09%) and the off switch restores the old check", () => {
  const ok = [
    { field: "close", chart: 3866.58, provider: 3867.1 },
    { field: "open", chart: 3883.89, provider: 3884.3 },
    { field: "high", chart: 3901.23, provider: 3900.0 },
    { field: "low", chart: 3832.541, provider: 3833.0 },
  ];
  assert.equal(sameInstrumentFromFeed({ comparisons: ok, status: "date_unverified" }).confirmed, true);
  const before = process.env.FEED_CLOSE_ONLY_WHEN_UNALIGNED;
  process.env.FEED_CLOSE_ONLY_WHEN_UNALIGNED = "off";
  try {
    assert.equal(sameInstrumentFromFeed({ comparisons: goldLate, status: "date_unverified" }).confirmed, false);
  } finally {
    if (before === undefined) delete process.env.FEED_CLOSE_ONLY_WHEN_UNALIGNED; else process.env.FEED_CLOSE_ONLY_WHEN_UNALIGNED = before;
  }
});

test("server wiring: the same-instrument check uses sameInstrumentFromFeed", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /sameInstrumentFromFeed\(\{\s*comparisons: feedComparisons,\s*status: marketReference\?\.chartDataMatch\?\.status/);
});
