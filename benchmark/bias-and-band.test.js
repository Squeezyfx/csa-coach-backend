import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveFrameworkBias } from "../framework-calendar.js";
import { evaluateFrameworkCandidate } from "../shared-analysis-engine.js";
import { fibBandBoundaryAllowance } from "../csa-entry-policy.js";
import { benchmarkValidatorInternals } from "./validator.js";

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

test("the band allowance is 5% of the range, never under the pip buffer, never over 0.1% of price", () => {
  // EURUSD week of 117 pips: 5% is 5.8 pips, under the 0.1% cap of 11 pips
  const eurusd = fibBandBoundaryAllowance({ pipBuffer: 0.0003, impulseRange: 0.01169, price: 1.12023 });
  assert.ok(Math.abs(eurusd - 0.0005845) < 1e-9);
  // a tiny range never goes below the broker buffer
  assert.equal(fibBandBoundaryAllowance({ pipBuffer: 0.0003, impulseRange: 0.001, price: 1.12 }), 0.0003);
  // a huge index range is capped at 0.1% of price (USA30 D1: 5% would be 496 points)
  const usa30 = fibBandBoundaryAllowance({ impulseRange: 9917, price: 51149.3 });
  assert.ok(Math.abs(usa30 - 51.1493) < 1e-6);
  // no usable range: fall back to the pip buffer, or nothing
  assert.equal(fibBandBoundaryAllowance({ pipBuffer: 0.0003 }), 0.0003);
  assert.equal(fibBandBoundaryAllowance({}), null);
});

test("the cap keeps the verified near-band entries and drops the far one", () => {
  // USDCHF H1 2899: expected 0.80711 sits 7.4 pips outside the band (range about 186 pips)
  assert.ok(0.00074 <= fibBandBoundaryAllowance({ pipBuffer: 0.0003, impulseRange: 0.0186, price: 0.80711 }));
  // USA30 H1 2902: expected 53421.2 sits 39.8 points outside (range about 1002)
  assert.ok(39.8 <= fibBandBoundaryAllowance({ impulseRange: 1002, price: 53421.2 }));
  // USA30 D1 2927: 51149.3 sits 159 points outside a 9,917-point range, which is too far
  assert.ok(159 > fibBandBoundaryAllowance({ impulseRange: 9917, price: 51149.3 }));
});

test("the live selector and the validator both use the shared allowance", () => {
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const validator = fs.readFileSync(new URL("./validator.js", import.meta.url), "utf8");
  assert.ok(server.includes("fibBandBoundaryAllowance({"));
  assert.ok(validator.includes("fibBandBoundaryAllowance({"));
});

test("a required level read off a screenshot counts within about a pip, but not a real difference", () => {
  const { chartReadingTolerance } = benchmarkValidatorInternals;
  const near = (expected, got) => Math.abs(expected - got) <= chartReadingTolerance(expected);
  // the mismatches seen in the 2026-10-07 strict runs, all under a pip
  assert.ok(near(1.35703, 1.35702)); // 2898
  assert.ok(near(0.80711, 0.80712)); // 2899
  assert.ok(near(1.38437, 1.38439)); // 2901
  assert.ok(near(0.8029, 0.80293)); // 2912
  assert.ok(near(0.85621, 0.85631)); // 2915, exactly one pip
  assert.ok(near(1.20144, 1.20148)); // 2917
  assert.ok(near(1.6278, 1.62775)); // 2918
  assert.ok(near(4428.73, 4427.91357)); // 2900 gold, the same level from a chart line and a period high
  // real differences are still differences
  assert.ok(!near(0.93648, 0.93747)); // 2916 Entry 1, ten pips off
  assert.ok(!near(53275.6, 53261.4)); // 2902 Entry 1, 14 points off
  assert.ok(!near(50575, 50539.4)); // 2927 Entry 1, 36 points off
  assert.equal(chartReadingTolerance("x"), 0);
});

import { selectIndependentEntryAreas } from "../csa-entry-policy.js";

const qualifiedArea = (center, extra = {}) => ({
  authoritativeCenter: center,
  resolvedEntryPrice: center,
  areaType: "converted support",
  provenanceVerified: true,
  authoritativeFrameworkLevel: true,
  requiredFibConfluence: true,
  structuralScore: 5,
  fibonacciScore: 5,
  independentEntryEvidence: true,
  ...extra,
});

test("stacked levels merge into one area at their midpoint; real separate levels stay separate", () => {
  const centers = (areas) => areas.map((a) => Math.round(a.authoritativeCenter * 1e6) / 1e6);
  // gold H1 2900: a chart line at 4436.15 and a Tuesday high at 4435.58 are one level
  const gold = selectIndependentEntryAreas(
    [qualifiedArea(4436.15), qualifiedArea(4435.5801), qualifiedArea(4428.73)],
    "bullish"
  );
  assert.deepEqual(centers(gold), [4435.86505, 4428.73]);
  assert.equal(gold[0].zoneLow, 4435.5801);
  assert.equal(gold[0].zoneHigh, 4436.15);
  // EURGBP 2915: 0.85631 and 0.85612 are one band, centred on the saved 0.85621
  const eurgbp = selectIndependentEntryAreas([qualifiedArea(0.85631), qualifiedArea(0.85612)], "bullish");
  assert.deepEqual(centers(eurgbp), [0.856215]);
  assert.deepEqual(eurgbp[0].mergedEntryLevels, [0.85612, 0.85631]);
  // USA30 H1 2902: Tuesday low and Wednesday low merge; the 53421.2 level stays its own entry
  const usa30 = selectIndependentEntryAreas(
    [qualifiedArea(53281.3), qualifiedArea(53261.4), qualifiedArea(53421.2)],
    "bearish"
  );
  assert.equal(usa30.length, 2);
  assert.ok(Math.abs(usa30[0].authoritativeCenter - 53271.35) < 1e-6);
  // EURAUD 2918 merges (4 pips); AUDNZD 2917 (5.2 pips, 0.043%) is two levels
  assert.equal(selectIndependentEntryAreas([qualifiedArea(1.62775), qualifiedArea(1.62816)], "bullish").length, 1);
  assert.equal(selectIndependentEntryAreas([qualifiedArea(1.20148), qualifiedArea(1.20096)], "bullish").length, 2);
  // EURCHF 2916: 9 pips apart is two entries, the higher one first
  const eurchf = selectIndependentEntryAreas([qualifiedArea(0.93655), qualifiedArea(0.93747)], "bullish");
  assert.deepEqual(centers(eurchf), [0.93747, 0.93655]);
});
