import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverSource = readFileSync(
  fileURLToPath(new URL("../server.js", import.meta.url)),
  "utf8"
);

test("focused automatic fallback inventories D1 candles for H1", () => {
  assert.match(serverSource, /treat each D1 candle inside the visible current trading week/);
  assert.match(serverSource, /Return Monday, Tuesday, Wednesday, Thursday and Friday separately/);
});

test("focused automatic fallback inventories W1 candles for H4", () => {
  assert.match(serverSource, /For H4, treat each W1 candle inside the visible current calendar month/);
  assert.match(serverSource, /Return W1, W2, W3, W4 and W5 when present/);
  assert.match(serverSource, /Do not skip, merge or renumber inventory periods/);
  assert.match(serverSource, /required period start dates, in exact chronological order/);
  assert.match(serverSource, /Ignore every candle before/);
  assert.match(serverSource, /highest candle wick only between that row's start date and the next row's start date/);
  assert.match(serverSource, /first candle of every W1 period is Monday 00:00/);
  assert.match(serverSource, /Monday 04:00 label is the second candle/);
  assert.match(serverSource, /Exclude Saturday and Sunday completely/);
  assert.match(serverSource, /early third-candle high/);
});

test("focused automatic fallback inventories MN candles for D1", () => {
  assert.match(serverSource, /For D1, treat each MN candle inside the visible current calendar year/);
  assert.match(serverSource, /Return January through the final visible month separately/);
});

test("focused inventory returns the required verification flag", () => {
  assert.match(serverSource, /"currentPeriodFrameVerified": false/);
  assert.match(serverSource, /Set currentPeriodFrameVerified=true only when every required/);
});

test("period inventory remains separate from the Fibonacci frame", () => {
  assert.match(serverSource, /This Fibonacci frame qualifies structure but does not replace the individual D1\/W1 inventory/);
  assert.match(serverSource, /currentPeriodHigh/);
  assert.match(serverSource, /periodInventory/);
});

test("a complete inventory can authoritatively reconstruct the current-period frame", () => {
  assert.match(serverSource, /deriveVerifiedPeriodFrameFromInventory/);
  assert.match(serverSource, /inventoryDerivedPeriodFrame/);
  assert.match(serverSource, /inventory_verified/);
});

test("complete deterministic inventory outranks vision-estimated period prices", () => {
  assert.match(serverSource, /aggregateH4CandlesIntoWeeklyInventory/);
  assert.match(serverSource, /focusedInventoryVerified/);
  assert.match(serverSource, /const selectedPeriodInventory = marketInventoryVerified/);
  assert.match(serverSource, /cutoff_safe_market_period_inventory_chart_endpoint_reconciled/);
  assert.match(serverSource, /inventoryPriceConflicts/);
});

test("date labels alone cannot verify vision-estimated highs and lows", () => {
  assert.match(serverSource, /focusedInventoryDateSequenceVerified/);
  assert.match(serverSource, /rawInventoryPriceConflicts\.length === 0/);
  assert.match(serverSource, /usable: marketInventoryVerified && Boolean\(fallbackDirection\)/);
  assert.match(serverSource, /rejectedFocusedPeriodInventory/);
  assert.match(serverSource, /requiresReview: !marketInventoryVerified/);
  assert.match(serverSource, /vision-estimated period price rejected/);
});

test("verified fixed-period structure outranks the final pullback direction", () => {
  assert.match(serverSource, /deriveVerifiedFixedPeriodBias/);
  assert.match(serverSource, /verified fixed-period structure is bullish/);
  assert.match(serverSource, /final bearish move treated as a pullback/);
  assert.match(serverSource, /latestClose < latestOpen/);
  assert.match(serverSource, /latestClose > latestOpen/);
});

test("focused reader uses the full vision model once for exact period prices", () => {
  assert.match(serverSource, /openaiModel: "gpt-4\.1"/);
  assert.match(serverSource, /Promise\.resolve\(null\)/);
});

test("final chart-header candle is reconciled into the final period", () => {
  assert.match(serverSource, /latestVisibleOpen/);
  assert.match(serverSource, /latestVisibleHigh/);
  assert.match(serverSource, /latestVisibleLow/);
  assert.match(serverSource, /reconcileFinalPeriodWithVisibleCandle/);
});

test("final-visible price synchronization cannot rewind to an older similar close", () => {
  assert.match(serverSource, /anchorDate: chartDetection\?\.latestVisibleDate/);
  assert.match(serverSource, /maximumDateDistanceDays: chartDetection\?\.latestVisibleDate \? 1 : null/);
});

test("unfinished framework periods are context only, never structural entries", () => {
  assert.match(serverSource, /currentFrameworkPeriodComplete/);
  assert.match(serverSource, /periodLifecycle:\s*index === periods\.length - 1 \? "in_progress" : "completed"/);
  assert.match(serverSource, /const completedDailyLevels = dailyLevels\.filter/);
  assert.match(serverSource, /const inProgressPeriods = normalizedPeriods\.filter/);
  assert.match(serverSource, /current framework period is still in progress and cannot supply structural S\/R, S\/D or an entry candidate/);
  assert.match(serverSource, /retainedFor: "current Fib frame, current price and phase only"/);
});

test("full period inventory remains available for current Fib-frame verification", () => {
  assert.match(serverSource, /periodInventory: selectedPeriodInventory/);
  assert.match(serverSource, /structuralPeriodInventory: authoritativeInventory\.periods/);
  assert.match(serverSource, /inProgressPeriodInventory: authoritativeInventory\.inProgressPeriods/);
});
