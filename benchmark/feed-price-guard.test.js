import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chartPriceFarFromFeed, pageDataMatchStatus } from "../feed-price-guard.js";

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
