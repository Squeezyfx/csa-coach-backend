import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasSupplyDemandFailed } from "../csa-entry-policy.js";

const candle = (datetime, close) => ({ datetime, open: close, high: close + 1, low: close - 1, close });
const days = (start, closes) => closes.map((close, i) => {
  const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000);
  return candle(d.toISOString().slice(0, 10), close);
});

test("a supply zone fails after two closes in a row above it", () => {
  const candles = days("2026-07-01", [100, 101, 111, 112, 105, 104]);
  const r = hasSupplyDemandFailed({ type: "supply", price: 110, candles, afterDate: "2026-07-01", requiredCloses: 2 });
  assert.equal(r.failed, true);
  assert.equal(r.at, "2026-07-04");
});

test("one close above is not a failure, and a wick through the zone is not a failure", () => {
  // candle() gives every bar a high 1 above its close, so the second series wicks above 110 without closing there
  const one = days("2026-07-01", [100, 111, 105, 104, 103]);
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: 110, candles: one, afterDate: "2026-07-01" }).failed, false);
  const wick = days("2026-07-01", [100, 109.5, 109.8, 109.9, 103]);
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: 110, candles: wick, afterDate: "2026-07-01" }).failed, false);
});

test("the two closes must be consecutive: a close back inside resets the count", () => {
  const candles = days("2026-07-01", [100, 111, 105, 112, 104, 103]);
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: 110, candles, afterDate: "2026-07-01" }).failed, false);
});

test("a demand zone is the mirror image: two closes in a row below it", () => {
  const candles = days("2026-07-01", [100, 99, 89, 88, 95, 96]);
  const r = hasSupplyDemandFailed({ type: "demand", price: 90, candles, afterDate: "2026-07-01" });
  assert.equal(r.failed, true);
  assert.equal(r.at, "2026-07-04");
  // closing above a demand is not a failure
  assert.equal(hasSupplyDemandFailed({ type: "demand", price: 90, candles: days("2026-07-01", [100, 120, 130, 140, 150]), afterDate: "2026-07-01" }).failed, false);
});

test("closes before the period that made the zone are ignored", () => {
  const candles = days("2026-06-01", [120, 121, 122, 100, 101, 102]);
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: 110, candles, afterDate: "2026-06-04" }).failed, false);
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: 110, candles, afterDate: "2026-06-01" }).failed, true);
});

test("a failed zone stays failed even if price later comes back (permanent)", () => {
  const candles = days("2026-07-01", [100, 111, 112, 90, 85, 80, 75]);
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: 110, candles, afterDate: "2026-07-01" }).failed, true);
});

test("the final candle may still be forming, so it never completes a failure on its own", () => {
  const candles = days("2026-07-01", [100, 105, 111, 112]);
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: 110, candles, afterDate: "2026-07-01" }).failed, false);
  const confirmed = days("2026-07-01", [100, 105, 111, 112, 113]);
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: 110, candles: confirmed, afterDate: "2026-07-01" }).failed, true);
});

test("support and resistance are never judged by this rule, and bad input never throws", () => {
  const candles = days("2026-07-01", [100, 111, 112, 113, 114]);
  assert.equal(hasSupplyDemandFailed({ type: "resistance", price: 110, candles, afterDate: "2026-07-01" }).failed, false);
  assert.equal(hasSupplyDemandFailed({ type: "support", price: 110, candles, afterDate: "2026-07-01" }).failed, false);
  assert.equal(hasSupplyDemandFailed({}).failed, false);
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: null, candles }).failed, false);
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: 110, candles: null }).failed, false);
});

test("XAUUSD D1 shape: June's high (4546.44) failed once August closed above it twice", () => {
  // June high 4546.44; the next period starts 2026-07-01. July stays below, August closes above twice, then drops back.
  const july = days("2026-07-01", [4150, 4120, 4100, 4080]);
  const august = days("2026-08-10", [4500, 4560, 4620, 4690, 4600, 4480, 4440]);
  const rest = days("2026-09-01", [4300, 4200]);
  const candles = [...july, ...august, ...rest];
  const r = hasSupplyDemandFailed({ type: "supply", price: 4546.43994, candles, afterDate: "2026-07-01" });
  assert.equal(r.failed, true);
  assert.equal(r.at, "2026-08-12");
  // September's own supply at 4511 never had two closes above it afterwards, so it stays
  assert.equal(hasSupplyDemandFailed({ type: "supply", price: 4511, candles: days("2026-10-01", [4200, 4225, 4100, 3900]), afterDate: "2026-10-01" }).failed, false);
});

test("server wiring: the rule is passed real candles, has an off switch, and drops (not converts) failed zones", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /function zoneFailureClosesSetting\(\)/);
  assert.match(server, /process\.env\.ZONE_FAILURE_CLOSES/);
  assert.match(server, /executionCandles: Array\.isArray\(marketReference\?\.timeframeCandles\)/);
  assert.match(server, /zoneFailureCloses: zoneFailureClosesSetting\(\)/);
  // the check sits before the support/resistance conversion logic in the candidate builder
  const builder = server.indexOf("function buildPeriodInventoryStructuralCandidates");
  const check = server.indexOf("hasSupplyDemandFailed({", builder);
  const conversion = server.indexOf("const bearishSupportBroken", builder);
  assert.ok(builder > 0 && check > builder && check < conversion);
  assert.match(server, /\}\)\.filter\(Boolean\);\s*\n\s*if \(failedZoneCandidates\.length\)/);
  assert.match(server, /\.\.\.failedZoneCandidates\]/);
});
