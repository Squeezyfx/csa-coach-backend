import test from "node:test";
import assert from "node:assert/strict";
import { chooseWatchReferences } from "../watch-references.js";

// EURUSD H1, Tuesday 3 Nov 2026 02:54: only Monday is complete (high 1.12397, low 1.11449), price 1.11842.
// The AI also read 1.11800 off the chart picture (no completed period behind it).
const mondayLow = { areaType: "support", authoritativeCenter: 1.11449, frameworkPeriod: "Monday", structuralScore: 40 };
const mondayHigh = { areaType: "resistance", authoritativeCenter: 1.12397, frameworkPeriod: "Monday", structuralScore: 40 };
const chartRead = { areaType: "support", authoritativeCenter: 1.118, frameworkPeriod: null, structuralScore: 25 };
const options = { direction: "bullish", lastPrice: 1.11842 };

test("a level read only from the chart picture is not offered when a completed-period level exists", () => {
  const chosen = chooseWatchReferences([chartRead, mondayLow, mondayHigh], { ...options, isCloseToZone: (r) => r === chartRead });
  assert.deepEqual(chosen, [mondayLow]);
});

test("with only Monday complete, a bullish bias watches Monday's low even outside the retracement zone", () => {
  const chosen = chooseWatchReferences([mondayLow, mondayHigh], { ...options, isCloseToZone: () => false });
  assert.deepEqual(chosen, [mondayLow]);
});

test("a bearish bias watches the nearest resistance above price", () => {
  const chosen = chooseWatchReferences([mondayLow, mondayHigh], { direction: "bearish", lastPrice: 1.11842, isCloseToZone: () => false });
  assert.deepEqual(chosen, [mondayHigh]);
});

test("completed-period levels near the zone are used as before", () => {
  const nearLevel = { areaType: "support", authoritativeCenter: 1.1181, frameworkPeriod: "Monday" };
  const chosen = chooseWatchReferences([nearLevel, mondayLow], { ...options, isCloseToZone: (r) => r === nearLevel });
  assert.deepEqual(chosen, [nearLevel]);
});

test("a completed-period level on the wrong side leaves nothing to watch rather than the chart-read level", () => {
  const chosen = chooseWatchReferences([mondayHigh, chartRead], { ...options, isCloseToZone: () => true });
  assert.deepEqual(chosen, [mondayHigh]);
  const none = chooseWatchReferences([mondayHigh, chartRead], { ...options, isCloseToZone: (r) => r === chartRead });
  assert.deepEqual(none, []);
});

test("with no completed-period level at all, chart-read levels are used as before", () => {
  const chosen = chooseWatchReferences([chartRead], { ...options, isCloseToZone: () => true });
  assert.deepEqual(chosen, [chartRead]);
  assert.deepEqual(chooseWatchReferences([], options), []);
  assert.deepEqual(chooseWatchReferences(undefined, options), []);
});

test("without a direction or a price nothing outside the zone is offered", () => {
  assert.deepEqual(chooseWatchReferences([mondayLow], { direction: "range", lastPrice: 1.118, isCloseToZone: () => false }), []);
  assert.deepEqual(chooseWatchReferences([mondayLow], { direction: "bullish", lastPrice: null, isCloseToZone: () => false }), []);
});
