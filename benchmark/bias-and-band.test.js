import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveFrameworkBias } from "../framework-calendar.js";
import { evaluateFrameworkCandidate } from "../shared-analysis-engine.js";

// EURUSD H1, week of Monday 2026-10-05, read on Wednesday 03:35 UTC. Monday spiked
// down to 1.11617 and recovered; Tuesday made a higher low (1.12023) and a
// marginally higher high (1.12786 against 1.12719); Wednesday is pulling back.
const week = [
  { date: "2026-10-05", open: 1.12534, high: 1.12719, low: 1.11617, close: 1.1226 },
  { date: "2026-10-06", open: 1.1226, high: 1.12786, low: 1.12023, close: 1.1259 },
  { date: "2026-10-07", open: 1.1259, high: 1.1262, low: 1.1233, close: 1.1237, partialPeriod: true, periodLifecycle: "in_progress" },
];

test("a recovery week a few pips under its open is bullish by its completed days, not bearish", () => {
  const bias = resolveFrameworkBias({ periodInventory: week, periodOpen: 1.12534, periodClose: 1.1237 });
  assert.equal(bias.direction, "bullish");
  assert.equal(bias.source, "completed_period_structure");
  // Wednesday's candle is red, so the live move is the pullback, not the bias.
  assert.equal(bias.phase, "bearish_pullback_after_bullish_structure");
});

test("a small week move with a lower high and lower low is bearish by its completed days", () => {
  const down = [
    { date: "2026-10-05", open: 1.13, high: 1.135, low: 1.128 },
    { date: "2026-10-06", open: 1.1295, high: 1.1335, low: 1.126 },
    { date: "2026-10-07", open: 1.1296, high: 1.1305, low: 1.1288, close: 1.1299, partialPeriod: true },
  ];
  const bias = resolveFrameworkBias({ periodInventory: down, periodOpen: 1.13, periodClose: 1.1299 });
  assert.equal(bias.direction, "bearish");
  assert.equal(bias.source, "completed_period_structure");
});

test("a decisive week move still decides, whatever the day structure says", () => {
  // up-structure but the week is 70% of its range below its open
  const rows = [
    { date: "2026-10-05", open: 1.13, high: 1.131, low: 1.12 },
    { date: "2026-10-06", open: 1.121, high: 1.132, low: 1.121 },
    { date: "2026-10-07", open: 1.1225, high: 1.123, low: 1.1195, close: 1.1205, partialPeriod: true },
  ];
  const bias = resolveFrameworkBias({ periodInventory: rows, periodOpen: 1.13, periodClose: 1.1205 });
  assert.equal(bias.direction, "bearish");
  assert.notEqual(bias.source, "completed_period_structure");
});

test("a small move with no clear day structure keeps using the open and close", () => {
  const bias = resolveFrameworkBias({
    periodInventory: [{ high: 120, low: 90, open: 105 }],
    periodOpen: 105,
    periodClose: 104,
  });
  assert.equal(bias.direction, "bearish");
  assert.equal(bias.source, "calendar_open_close");
});

// The Fibonacci band is 38.2%-61.8% of the framing range; a level a few pips
// outside either edge still qualifies, in proportion to the range.
const frame = { swingHigh: 1.12786, swingLow: 1.11617 }; // 116.9 pips
const range = frame.swingHigh - frame.swingLow;
const allowance = range * 0.05; // what server.js passes for boundaryTolerance
const buyCandidate = (price) => ({
  price,
  zoneLow: price,
  zoneHigh: price,
  areaType: "demand",
  independentEntryEvidence: true,
});
const evaluateBuy = (price, boundaryTolerance, currentPrice = 1.1237) =>
  evaluateFrameworkCandidate({
    candidate: buyCandidate(price),
    direction: "bullish",
    currentPrice,
    ...frame,
    tolerance: Math.max(0.0001, range * 0.01),
    boundaryTolerance,
    frameUsable: true,
    structuralEvidenceValid: true,
  });

test("the Tuesday low, 65% down the range, qualifies once the band allows a few pips", () => {
  // 61.8% down from the high is 1.12064; the Tuesday low 1.12023 is 4.1 pips past it
  assert.equal(evaluateBuy(1.12023, 0.0003).qualified, false); // the old fixed 3-pip buffer
  const decision = evaluateBuy(1.12023, allowance);
  assert.equal(decision.qualified, true);
  assert.equal(decision.fibMatch.ratio, 0.618);
});

test("a level well outside the band is still rejected", () => {
  // 1.1190 is about 17 pips past the 61.8% line
  const decision = evaluateBuy(1.119, allowance);
  assert.equal(decision.qualified, false);
  assert.ok(decision.rejectionReasons.includes("outside the 38.2%-61.8% retracement band"));
});

test("the allowance applies at the 38.2% edge as well", () => {
  // 38.2% down from the high is 1.12339; 1.1238 is 4.1 pips on the shallow side
  assert.equal(evaluateBuy(1.1238, 0.0003, 1.125).qualified, false);
  assert.equal(evaluateBuy(1.1238, allowance, 1.125).qualified, true);
  // the sell mirror image: 38.2% up from the low is 1.12064, 61.8% is 1.12339
  const sell = evaluateFrameworkCandidate({
    candidate: { price: 1.1238, zoneLow: 1.1238, zoneHigh: 1.1238, areaType: "resistance", independentEntryEvidence: true },
    direction: "bearish",
    currentPrice: 1.1205,
    ...frame,
    tolerance: Math.max(0.0001, range * 0.01),
    boundaryTolerance: allowance,
    frameUsable: true,
    structuralEvidenceValid: true,
  });
  assert.equal(sell.qualified, true);
});

test("the live selector passes a range-based boundary allowance", () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.ok(source.includes("Math.max(brokerPipBuffer ?? 0, impulseRange * 0.05)"));
});
