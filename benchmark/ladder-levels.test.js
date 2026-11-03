import test from "node:test";
import assert from "node:assert/strict";
import { collectStructuralLevels, buildTargetLadder } from "../trade-pillars.js";

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

test("a chart-read level that has a completed period behind it is kept", () => {
  const matched = { ...chartReadLine, frameworkPeriod: "Monday" };
  const facts = { currentPrice: 1.11851, selectorDiagnostics: { structuralCandidates: monday }, structuralReferenceAreas: [matched] };
  assert.deepEqual(collectStructuralLevels(facts), [1.11449, 1.118, 1.12397]);
});
