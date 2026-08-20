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

test("validates the exact structural role of Entry 1", () => {
  const demandResult = structuredClone(baseResult);
  demandResult.analysis = "Bullish. Entry 1 is demand around 0.70104.";
  demandResult.analysisFacts.selectedEntryAreas[0].areaType = "demand";

  const passed = validateBenchmarkResult(demandResult, {
    expectedEntry1: 0.70104,
    expectedEntry1Type: "demand",
  });
  assert.equal(passed.passed, true);

  const failed = validateBenchmarkResult(demandResult, {
    expectedEntry1: 0.70104,
    expectedEntry1Type: "supply",
  });
  assert.equal(failed.passed, false);
  assert.ok(failed.criticalFailures.some((check) => check.id === "entry_1_type"));
});

test("accepts normalized buy-area and sell-area structural families", () => {
  const buy = validateBenchmarkResult(baseResult, { expectedEntry1Type: "buy area" });
  assert.equal(buy.passed, true);

  const sellResult = structuredClone(baseResult);
  sellResult.analysisFacts.direction = "bearish";
  sellResult.analysisFacts.selectedEntryAreas[0].areaType = "potential_converted_resistance";
  const sell = validateBenchmarkResult(sellResult, { expectedEntry1Type: "sell area" });
  assert.equal(sell.passed, true);
});

test("base S/R expectations accept converted subtypes but converted expectations stay exact", () => {
  const convertedSupport = structuredClone(baseResult);
  convertedSupport.analysisFacts.selectedEntryAreas[0].areaType = "converted support";
  convertedSupport.finalFeedback.entry1.areaType = "converted support";

  assert.equal(
    validateBenchmarkResult(convertedSupport, { expectedEntry1Type: "support" }).passed,
    true
  );
  assert.equal(
    validateBenchmarkResult(baseResult, { expectedEntry1Type: "converted support" }).passed,
    false
  );
});

test("can require that no valid entry is returned", () => {
  const empty = structuredClone(baseResult);
  empty.analysisFacts.selectedEntryAreas = [];
  empty.finalFeedback.entry1 = null;
  empty.finalFeedback.entry2 = null;

  const passed = validateBenchmarkResult(empty, { noEntryExpected: true });
  assert.equal(passed.passed, true);

  const failed = validateBenchmarkResult(baseResult, { noEntryExpected: true });
  assert.equal(failed.passed, false);
  assert.ok(failed.criticalFailures.some((check) => check.id === "no_entry_expected"));
});

test("requires every configured customer-facing feedback term", () => {
  const demandResult = structuredClone(baseResult);
  demandResult.analysis = "Bullish. Entry 1 is demand around 0.70104 near support.";

  const passed = validateBenchmarkResult(demandResult, {
    requiredFeedbackTerms: "demand, support",
  });
  assert.equal(passed.passed, true);

  const failed = validateBenchmarkResult(demandResult, {
    requiredFeedbackTerms: "demand, resistance",
  });
  assert.equal(failed.passed, false);
  assert.ok(
    failed.criticalFailures.some(
      (check) => check.id === "required_feedback_term_resistance"
    )
  );
});

test("uses explicit tolerance for approximate entries on unmarked charts", () => {
  const approximate = structuredClone(baseResult);
  approximate.analysisFacts.selectedEntryAreas[0] = {
    executionOrder: 1,
    areaType: "supply",
    authoritativeCenter: 0.81231,
    zoneLow: 0.81210,
    zoneHigh: 0.81252,
  };
  approximate.finalFeedback.entry1 = { authoritativeCenter: 0.81231 };

  const result = validateBenchmarkResult(approximate, {
    expectedEntry1: 0.81216,
    expectedEntry1Type: "supply",
    tolerance: 0.0004,
  });
  assert.equal(result.passed, true);
});

test("uses configured approximation tolerance for required and feedback levels", () => {
  const approximate = structuredClone(baseResult);
  approximate.analysisFacts.selectedEntryAreas[0] = {
    executionOrder: 1,
    authoritativeCenter: 1.40525,
    zoneLow: 1.4052,
    zoneHigh: 1.4053,
    areaType: "support",
  };
  approximate.analysisFacts.structuralReferenceAreas = [];
  approximate.finalFeedback.entry1 = {
    ...approximate.analysisFacts.selectedEntryAreas[0],
  };
  approximate.analysis = "Entry 1 is support around 1.40525.";

  const result = validateBenchmarkResult(approximate, {
    expectedEntry1: "1.40520",
    requiredLevels: "1.40520",
    requiredFeedbackLevels: "1.40520",
    tolerance: "0.00008",
  });

  assert.equal(result.passed, true);
  assert.equal(result.checks.find((check) => check.id === "required_level_1.4052")?.passed, true);
  assert.equal(
    result.checks.find((check) => check.id === "required_feedback_level_1.4052")?.passed,
    true
  );
});
