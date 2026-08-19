import test from "node:test";
import assert from "node:assert/strict";
import { validateBenchmarkResult } from "./validator.js";

const baseResult = {
  analysis: "DIRECTIONAL BIAS:\nBullish\n\nNEXT ACTION:\nEntry 1 is support around 0.70104. Another important structural area is support around 0.69845.",
  analysisFacts: {
    direction: "bullish",
    selectedEntryAreas: [
      { executionOrder: 1, areaType: "support", authoritativeCenter: 0.70104, zoneLow: 0.7009, zoneHigh: 0.7012 },
    ],
    structuralReferenceAreas: [
      { areaType: "support", authoritativeCenter: 0.69845, zoneLow: 0.6983, zoneHigh: 0.6986 },
      { areaType: "demand", authoritativeCenter: 0.69486, zoneLow: 0.6947, zoneHigh: 0.6950 },
    ],
  },
  finalFeedback: { strengths: ["Clear chart."], weaknesses: ["Wait for confirmation."], entry1: { authoritativeCenter: 0.70104 }, entry2: null },
};

test("passes required structural levels without promoting a forbidden entry", () => {
  const result = validateBenchmarkResult(baseResult, {
    expectedDirection: "bullish",
    expectedEntry1: 0.70104,
    requiredLevels: "0.69845, 0.69486",
    forbiddenEntries: "0.69486",
    tolerance: 0.00025,
  });
  assert.equal(result.passed, true);
});

test("fails when Entry 2 is required and absent", () => {
  const result = validateBenchmarkResult(baseResult, {
    expectedDirection: "bullish",
    entry2Required: true,
  });
  assert.equal(result.passed, false);
  assert.ok(result.criticalFailures.some((check) => check.id === "entry_2"));
});

test("fails if a forbidden structural reference becomes a selected entry", () => {
  const changed = structuredClone(baseResult);
  changed.analysisFacts.selectedEntryAreas.push({ executionOrder: 2, authoritativeCenter: 0.69486, zoneLow: 0.6947, zoneHigh: 0.6950 });
  const result = validateBenchmarkResult(changed, { forbiddenEntries: "0.69486", tolerance: 0.00025 });
  assert.equal(result.passed, false);
});

test("fails when structured facts contain a hidden third entry", () => {
  const changed = structuredClone(baseResult);
  changed.analysisFacts.selectedEntryAreas.push(
    { executionOrder: 2, authoritativeCenter: 0.69620, zoneLow: 0.6961, zoneHigh: 0.6963 },
    { executionOrder: 3, authoritativeCenter: 0.69486, zoneLow: 0.6947, zoneHigh: 0.6950 },
  );
  changed.finalFeedback.narrativeLock = {
    selectedEntries: [
      { executionOrder: 1, authoritativeCenter: 0.70104 },
      { executionOrder: 2, authoritativeCenter: 0.69620 },
    ],
  };

  const result = validateBenchmarkResult(changed, {});
  assert.equal(result.passed, false);
  assert.ok(result.criticalFailures.some((check) => check.id === "maximum_two_entries"));
  assert.ok(result.criticalFailures.some((check) => check.id === "canonical_entry_consistency"));
});

test("broad zone containment does not satisfy an exact required level", () => {
  const changed = structuredClone(baseResult);
  changed.analysis = "Bullish. Wait for support around 0.69887.";
  changed.analysisFacts.structuralReferenceAreas = [];
  changed.analysisFacts.selectedEntryAreas[0] = {
    executionOrder: 1,
    authoritativeCenter: 0.69887,
    zoneLow: 0.69820,
    zoneHigh: 0.69940,
  };
  changed.finalFeedback.entry1 = { authoritativeCenter: 0.69887 };

  const result = validateBenchmarkResult(changed, { requiredLevels: "0.69845" });
  assert.equal(result.passed, false);
  assert.ok(result.criticalFailures.some((check) => check.id === "required_level_0.69845"));
});

test("can require an exact level in customer-facing feedback", () => {
  const result = validateBenchmarkResult(baseResult, { requiredFeedbackLevels: "0.69845" });
  assert.equal(result.passed, true);

  const changed = structuredClone(baseResult);
  changed.analysis = "Bullish. Wait for support around 0.70104.";
  const missing = validateBenchmarkResult(changed, { requiredFeedbackLevels: "0.69845" });
  assert.equal(missing.passed, false);
});

test("preserves trailing-zero precision for five-decimal FX expectations", () => {
  const changed = structuredClone(baseResult);
  changed.analysis = "Bullish. Entry 1 is support around 0.69618.";
  changed.analysisFacts.selectedEntryAreas = [
    { executionOrder: 1, authoritativeCenter: 0.69618, zoneLow: 0.6961, zoneHigh: 0.6963 },
  ];
  changed.analysisFacts.structuralReferenceAreas = [];
  changed.finalFeedback.entry1 = { authoritativeCenter: 0.69618 };

  const result = validateBenchmarkResult(changed, { requiredLevels: "0.69620" });
  assert.equal(result.passed, false);
  assert.ok(result.criticalFailures.some((check) => check.id === "required_level_0.6962"));
});
