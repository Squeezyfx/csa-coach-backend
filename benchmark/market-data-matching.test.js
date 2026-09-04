import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { providerSymbol, validateProviderMetadata, classifyProviderError, assessChartDataMatch, clearRejectedProviderData } from "../market-data-matching.js";

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
  assert.equal(assessChartDataMatch({...base,cutoff:"2026-08-21 23:59:59"}).status,"mismatch");
  assert.equal(assessChartDataMatch({...base,detection:{...base.detection,latestVisiblePrice:120}}).status,"mismatch");
  assert.equal(assessChartDataMatch({...base,detection:{...base.detection,latestVisibleHigh:110}}).status,"mismatch");
  assert.equal(assessChartDataMatch({...base,detection:{}}).status,"unverified");
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
  const ui = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  assert.match(server, /map\(\(candidate\) => providerSymbol\(candidate\)\)/);
  assert.match(server, /validateProviderMetadata\(data.meta, providerSymbol, interval\)/);
  assert.match(server, /marketReference\?\.chartDataMatch\?\.status === "matched_reference"/);
  assert.match(server, /!marketReference.chartDataMatch &&\s*normalizedRequestedCutoffMode/);
  assert.match(ui, /Provider reference; not broker-exact/);
  assert.match(ui, /providerFailure.reason/);
});
