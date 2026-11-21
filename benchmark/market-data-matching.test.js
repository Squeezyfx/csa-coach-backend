import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { providerSymbol, validateProviderMetadata, classifyProviderError, assessChartDataMatch, clearRejectedProviderData, shouldRetainProviderPeriods, WEAK_MATCH_STATUSES } from "../market-data-matching.js";

test("variable length crypto and metals normalize without substituting quotes", () => {
  for (const [input, expected] of [["DOGEUSD","DOGE/USD"],["XPTUSD","XPT/USD"],["Platinum","XPT/USD"],["BTCUSDT","BTC/USDT"],["COCOA","COCOA"],["USDINDEX","USDINDEX"],["SPX","SPX"]]) assert.equal(providerSymbol(input), expected);
});
test("response metadata must match requested symbol and interval", () => {
  assert.equal(validateProviderMetadata({symbol:"DOGE/USD",interval:"1day"},"DOGEUSD","1day"), null);
  assert.ok(validateProviderMetadata({symbol:"BTC/USDT",interval:"1day"},"BTC/USD","1day"));
  assert.ok(validateProviderMetadata({},"BTC/USD","1day"));
  assert.ok(validateProviderMetadata({symbol:"BTC/USD",interval:"1month"},"BTC/USD","1day"));
});
test("access errors cannot trigger unrelated symbol fallbacks", () => {
  assert.equal(classifyProviderError("symbol requires subscription",403),"subscription_access");
  assert.equal(classifyProviderError("API credits exhausted",429),"rate_limit");
  assert.equal(classifyProviderError("symbol not found",404),"symbol_unavailable");
});
const base = { candles:[{datetime:"2026-08-20",open:99,high:102,low:98,close:100}], detection:{latestVisibleDate:"2026-08-20",latestVisibleDateEvidence:"explicit_final_candle_timestamp",dateConfidence:"high",providerSessionAligned:true,latestVisibleCandleComplete:true,latestVisiblePrice:100,latestVisiblePriceConfidence:"high",latestVisibleOpen:99,latestVisibleHigh:102,latestVisibleLow:98},cutoff:"2026-08-20 23:59:59",timeframe:"D1" };
test("matching data is labelled reference, never broker exact", () => {
  const result = assessChartDataMatch(base);
  assert.equal(result.status,"matched_reference");
  assert.equal(result.brokerVerified,false);
});
test("wrong date, price or header extremes cannot pass", () => {
  const offset = assessChartDataMatch({...base,cutoff:"2026-08-21 23:59:59"});
  assert.equal(offset.status,"matched_reference");
  assert.equal(offset.providerCoverage.weekdaySessionLag,true);
  assert.equal(assessChartDataMatch({...base,detection:{...base.detection,latestVisiblePrice:120}}).status,"mismatch");
  assert.equal(assessChartDataMatch({...base,detection:{...base.detection,latestVisibleHigh:110}}).status,"mismatch");
  assert.equal(assessChartDataMatch({...base,detection:{}}).status,"unverified");
});
test("D1 weekend cutoff accepts the last tradable Friday when OHLC aligns", () => {
  const friday = { datetime:"2026-08-21", open:99, high:102, low:98, close:100 };
  const detection = {
    ...base.detection,
    latestVisibleDate:"2026-08-22",
    latestVisibleDateEvidence:"inferred_axis",
    dateConfidence:"high",
  };
  const result = assessChartDataMatch({
    candles:[friday], detection, cutoff:"2026-08-22 23:59:59", timeframe:"D1",
  });
  assert.equal(result.status,"matched_reference");
  assert.equal(result.providerCoverage.weekendSessionLag,true);
  assert.equal(result.providerCoverage.lastProviderCandleDate,"2026-08-21");
});
test("weekday provider coverage gaps remain mismatches", () => {
  const result = assessChartDataMatch({...base, cutoff:"2026-08-24 23:59:59"});
  assert.equal(result.status,"mismatch");
  assert.equal(result.providerCoverage.lagDays,4);
});
test("OANDA weekday session offset is accepted only when full OHLC aligns", () => {
  const result = assessChartDataMatch({
    ...base,
    candles:[{datetime:"2026-08-19",open:99,high:102,low:98,close:100}],
    cutoff:"2026-08-20 23:59:59",
  });
  assert.equal(result.status,"matched_reference");
  assert.equal(result.providerCoverage.weekdaySessionLag,true);
  assert.equal(result.providerCoverage.sessionLagAligned,true);

  const mismatch = assessChartDataMatch({
    ...base,
    candles:[{datetime:"2026-08-19",open:99.5,high:102,low:98,close:100}],
    cutoff:"2026-08-20 23:59:59",
  });
  assert.equal(mismatch.status,"mismatch");
});
test("future candles cannot rescue an unmatched screenshot", () => {
  assert.equal(assessChartDataMatch({...base,candles:[{datetime:"2026-08-21",close:100}]}).status,"unverified");
});
test("DOGE August 20 inferred date is not a confirmed feed mismatch", () => {
  const detection = { latestVisiblePrice:0.08491,latestVisiblePriceConfidence:"high",latestVisibleOpen:0.08479,latestVisibleHigh:0.08543,latestVisibleLow:0.08396,dateConfidence:"medium",latestVisibleDateEvidence:"inferred_axis" };
  const result = assessChartDataMatch({candles:[{datetime:"2026-08-20",open:0.07504,high:0.08355,low:0.07445,close:0.08047}],detection,cutoff:base.cutoff,timeframe:"D1",tolerance:0.0002});
  assert.equal(result.status,"date_unverified");
  assert.equal(result.comparisons.length,4);
});
test("unfinished candles and unknown sessions are distinguished from mismatch", () => {
  const detection = {...base.detection,latestVisiblePrice:101,latestVisibleCandleComplete:null};
  assert.equal(assessChartDataMatch({...base,detection}).status,"partial_or_unknown_candle");
  assert.equal(assessChartDataMatch({...base,detection:{...detection,latestVisibleCandleComplete:true,providerSessionAligned:false}}).status,"session_unverified");
  assert.equal(assessChartDataMatch({...base,detection:{...detection,latestVisibleHigh:105}}).status,"mismatch");
});
test("rejected provider direction and numeric anchors are removed, diagnostics retained", () => {
  const rejected = clearRejectedProviderData({ok:true,directionalBias:{higherTimeframeView:"stale 0.06962",presentPrice:0.06962},approvedAreas:[{price:4}],periodHigh:9,chartDataMatch:{status:"date_unverified",comparisons:[{chart:1,provider:2}]},error:"date uncertain"});
  assert.equal(rejected.directionalBias.presentPrice,undefined);
  assert.equal(rejected.periodHigh,undefined);
  assert.equal(rejected.directionalBias.provisional,true);
  assert.deepEqual(rejected.approvedAreas,[]);
  assert.equal(rejected.chartDataMatch.comparisons.length,1);
});
test("server gates inventory approval and UI exposes source failures", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("./public/csa-benchmark-app.js", import.meta.url), "utf8");
  assert.match(server, /map\(\(candidate\) => providerSymbol\(candidate\)\)/);
  assert.match(server, /validateProviderMetadata\(data.meta, providerSymbol, interval\)/);
  assert.match(server, /providerCoverage/);
  assert.match(server, /providerDiagnostics/);
  assert.match(server, /marketReference\?\.chartDataMatch\?\.status === "matched_reference"/);
  assert.match(server, /!marketReference.chartDataMatch &&\s*normalizedRequestedCutoffMode/);
  assert.match(ui, /Provider reference; not broker-exact/);
  assert.match(ui, /providerFailure.reason/);
});

// XAUUSD H4, 2026-11-20 02:53 UTC: four weekly candles loaded from Twelve Data, but no daily-style completed
// references, so any weak match (date unverified, then a close 3.3 points off) wiped the levels and the review fell back
// to a picture-only read with no entries. EURUSD/AUDUSD H4 passed only because their match was exact.
test("a weak match keeps the provider's framework periods, a mismatch still clears them", () => {
  const gold = { provider: "Twelve Data", completedPeriodCount: 0, providerFrameworkPeriodCount: 4, knownSmallGap: false };
  for (const status of WEAK_MATCH_STATUSES) assert.equal(shouldRetainProviderPeriods({ ...gold, status }), true, status);
  assert.equal(shouldRetainProviderPeriods({ ...gold, status: "mismatch" }), false);
  assert.equal(shouldRetainProviderPeriods({ ...gold, status: "chart_mismatch" }), false);
  // daily-style references keep working exactly as before
  assert.equal(shouldRetainProviderPeriods({ provider: "OANDA", completedPeriodCount: 3, providerFrameworkPeriodCount: 0, status: "date_unverified" }), true);
  // nothing to keep, or another provider: no change
  assert.equal(shouldRetainProviderPeriods({ ...gold, providerFrameworkPeriodCount: 0, status: "date_unverified" }), false);
  assert.equal(shouldRetainProviderPeriods({ ...gold, provider: "Other", status: "date_unverified" }), false);
  // a known small gap keeps them on any status
  assert.equal(shouldRetainProviderPeriods({ ...gold, knownSmallGap: true, status: "mismatch" }), true);
  assert.deepEqual(WEAK_MATCH_STATUSES, ["date_unverified", "time_unverified", "partial_or_unknown_candle"]);
});

test("the server decides keep-or-clear with that rule and has an off switch", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /shouldRetainProviderPeriods\(\{\s+provider: marketReference\.dataProvider,/);
  assert.match(server, /KEEP_PROVIDER_PERIODS_ON_WEAK_MATCH/);
  assert.match(server, /marketReference\?\.providerPeriodAnalysis\?\.periods\)/);
  assert.match(server, /clearRejectedProviderData\(\{ \.\.\.marketReference, error: chartDataMatch\.reason,/);
});
