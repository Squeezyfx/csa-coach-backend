import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectStructuralLevels, buildTargetLadder, finalSwingTarget, finalTpTarget } from "../trade-pillars.js";

// EURUSD H1, Tuesday 3 Nov 2026: only Monday is complete (low 1.11449, high 1.12397), price 1.11851.
// The AI also described a "dashed line at 1.118" that was the chart's own last-price line.
const monday = [
  { price: 1.11449, sourcePeriod: "Monday", sourceKind: "Monday low" },
  { price: 1.12397, sourcePeriod: "Monday", sourceKind: "Monday high" },
];
const chartReadLine = {
  areaType: "support",
  authoritativeCenter: 1.118,
  frameworkPeriod: null,
  priceSource: "independent_horizontal_line_reader_exact_reference_only",
};

test("a level read only from the chart picture is not a take-profit or stop level when completed-period levels exist", () => {
  const facts = { currentPrice: 1.11851, selectorDiagnostics: { structuralCandidates: monday }, structuralReferenceAreas: [chartReadLine] };
  assert.deepEqual(collectStructuralLevels(facts), [1.11449, 1.12397]);
  const ladder = buildTargetLadder({ levels: collectStructuralLevels(facts), origin: 1.11449, isSell: false, finalTarget: 1.12397 });
  assert.deepEqual(ladder, [{ price: 1.12397, final: true }]);
});

test("with no completed-period level, a chart-read level is kept as before", () => {
  const facts = { currentPrice: 1.1195, structuralReferenceAreas: [chartReadLine] };
  assert.deepEqual(collectStructuralLevels(facts), [1.118]);
});

// The filter above only works if the review facts still say where a reference came from.
// Dropping priceSource when the facts are built made it a no-op on live reviews.
test("the review facts carry each reference's priceSource", () => {
  const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  const start = serverSource.indexOf("structuralReferenceAreas: structuralReferenceAreas.map((candidate) => ({");
  assert.notEqual(start, -1);
  assert.match(serverSource.slice(start, start + 600), /priceSource: candidate\.priceSource \|\| null/);
});

test("a chart-read level that has a completed period behind it is kept", () => {
  const matched = { ...chartReadLine, frameworkPeriod: "Monday" };
  const facts = { currentPrice: 1.11851, selectorDiagnostics: { structuralCandidates: monday }, structuralReferenceAreas: [matched] };
  assert.deepEqual(collectStructuralLevels(facts), [1.11449, 1.118, 1.12397]);
});

// The final take profit sits slightly INSIDE the main swing: a sell's a little above the lowest price, a buy's a little
// below the highest. The swing itself stays the yardstick a trader's own take profit is judged against.
test("a sell's final take profit is a little above the swing low, a buy's a little below the swing high", () => {
  const facts = { instrument: "EURUSD", volatility: { avgRange: 0.0022 }, selectorDiagnostics: { fibonacci: { swingHigh: 1.125, swingLow: 1.095 } } };
  const sell = finalTpTarget(facts, 1.113, true);
  assert.ok(sell > 1.095 && sell < 1.113, `sell final TP ${sell} is above the swing low`);
  assert.ok(Math.abs(sell - (1.095 + 0.0022 * 0.25 + 0.0001)) < 1e-9, "a quarter candle plus the one-pip spread");
  const buy = finalTpTarget(facts, 1.105, false);
  assert.ok(buy < 1.125 && buy > 1.105, `buy final TP ${buy} is below the swing high`);
  assert.ok(Math.abs(buy - (1.125 - 0.0022 * 0.25)) < 1e-9, "a quarter candle, no spread for a buy");
  assert.equal(finalSwingTarget(facts, 1.113, true), 1.095, "the swing itself is unchanged");
  assert.equal(finalSwingTarget(facts, 1.105, false), 1.125);
});

test("the distance inside the swing is capped at a tenth of the way to it, and falls back to a small share of price without candles", () => {
  const tight = { instrument: "EURUSD", volatility: { avgRange: 0.01 }, selectorDiagnostics: { fibonacci: { swingLow: 1.1 } } };
  const capped = finalTpTarget(tight, 1.105, true); // entry only 50 pips from the swing: 10% = 5 pips
  assert.ok(Math.abs(capped - (1.1 + 0.0005)) < 1e-9, `capped at a tenth of the distance: ${capped}`);
  const noCandles = { instrument: "XYZUSD", selectorDiagnostics: { fibonacci: { swingHigh: 2 } } };
  assert.ok(Math.abs(finalTpTarget(noCandles, 1.8, false) - (2 - 1.8 * 0.0005)) < 1e-9);
});

test("no usable swing means no final target, and the ladder ends on the inside target", () => {
  assert.equal(finalTpTarget({ selectorDiagnostics: {} }, 1.1, true), null);
  const facts = { instrument: "EURUSD", volatility: { avgRange: 0.0022 }, selectorDiagnostics: { fibonacci: { swingLow: 1.095 } } };
  const ladder = buildTargetLadder({ levels: [1.108, 1.102], origin: 1.113, isSell: true, finalTarget: finalTpTarget(facts, 1.113, true) });
  const last = ladder.at(-1);
  assert.equal(last.final, true);
  assert.ok(last.price > 1.095, "the last take profit is above the swing low");
});
