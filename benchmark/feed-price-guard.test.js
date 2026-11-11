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
