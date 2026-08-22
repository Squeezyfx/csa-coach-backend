import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBatchFeedbackDiversityChecks,
  validateBenchmarkResult,
} from "./validator.js";

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

test("batch mode does not mistake price-specific feedback for reused boilerplate", () => {
  const firstAnalysis = structuredClone(baseResult);
  const secondAnalysis = structuredClone(baseResult);
  firstAnalysis.finalFeedback = {
    strengths: ["The bullish structure produced Entry 1 around 1.40520 after the full checks."],
    weaknesses: [
      "No completed trade is visible around 1.40520, so execution accuracy cannot be assessed.",
      "A stop loss and target are not both shown for the planned buy around 1.40520.",
    ],
  };
  secondAnalysis.finalFeedback = {
    strengths: ["The bearish structure produced Entry 1 around 0.80711 after the full checks."],
    weaknesses: [
      "No completed trade is visible around 0.80711, so execution accuracy cannot be assessed.",
      "A stop loss and target are not both shown for the planned sell around 0.80711.",
    ],
  };

  const makeItem = (analysis) => ({
    status: "passed",
    mode: "automatic",
    analysis,
    validation: validateBenchmarkResult(analysis, {}),
  });
  const checked = applyBatchFeedbackDiversityChecks([
    makeItem(firstAnalysis),
    makeItem(secondAnalysis),
  ]);

  assert.equal(checked[0].status, "passed");
  assert.equal(checked[1].status, "passed");
});

test("batch mode still rejects identical generic feedback statements", () => {
  const firstAnalysis = structuredClone(baseResult);
  const secondAnalysis = structuredClone(baseResult);
  const repeated = {
    strengths: ["The chart structure is clear enough to review."],
    weaknesses: [
      "No completed trade is visible, so execution accuracy cannot be assessed.",
      "A stop loss and target are not both shown, so risk cannot be assessed.",
    ],
  };
  firstAnalysis.finalFeedback = structuredClone(repeated);
  secondAnalysis.finalFeedback = structuredClone(repeated);

  const makeItem = (analysis) => ({
    status: "passed",
    mode: "automatic",
    analysis,
    validation: validateBenchmarkResult(analysis, {}),
  });
  const checked = applyBatchFeedbackDiversityChecks([
    makeItem(firstAnalysis),
    makeItem(secondAnalysis),
  ]);

  assert.equal(checked[0].status, "failed");
  assert.ok(checked[0].validation.criticalFailures.some(
    (check) => check.id === "batch_feedback_diversity"
  ));
});

test("accepts a demand entry anchor anywhere inside the configured demand zone", () => {
  const demand = structuredClone(baseResult);
  demand.analysis = "Bullish. Entry 1 is support around 1.40520. If it fails, watch the demand area around 1.40395.";
  demand.analysisFacts.selectedEntryAreas = [
    {
      executionOrder: 1,
      areaType: "support",
      authoritativeCenter: 1.40520,
      zoneLow: 1.40516,
      zoneHigh: 1.40524,
    },
    {
      executionOrder: 2,
      areaType: "demand",
      authoritativeCenter: 1.40395,
      zoneLow: 1.40395,
      zoneHigh: 1.40418,
    },
  ];
  demand.analysisFacts.structuralReferenceAreas = [];
  demand.finalFeedback.entry1 = demand.analysisFacts.selectedEntryAreas[0];
  demand.finalFeedback.entry2 = demand.analysisFacts.selectedEntryAreas[1];

  const result = validateBenchmarkResult(demand, {
    expectedDirection: "bullish",
    expectedEntry1: "1.40520",
    expectedEntry1Type: "support",
    expectedEntry2: "1.40341",
    expectedEntry2Type: "demand",
    expectedEntry2ZoneLow: "1.40341",
    expectedEntry2ZoneHigh: "1.40395",
    entry2Required: true,
    requiredLevels: "1.40520,1.40341",
    requiredFeedbackLevels: "1.40520,1.40341",
    requiredFeedbackTerms: "support,demand",
    tolerance: "0.00008",
  });

  assert.equal(result.passed, true);
  assert.equal(result.checks.find((check) => check.id === "entry_2")?.passed, true);
  assert.equal(result.checks.find((check) => check.id === "required_level_1.40341")?.passed, true);
  assert.equal(
    result.checks.find((check) => check.id === "required_feedback_level_1.40341")?.passed,
    true
  );
});

test("accepts meaningful overlap between expected and detected supply zones", () => {
  const supply = structuredClone(baseResult);
  supply.analysisFacts.direction = "bearish";
  supply.analysis = "Bearish. Watch the supply area around 1.20540.";
  supply.analysisFacts.selectedEntryAreas = [
    {
      executionOrder: 1,
      areaType: "supply",
      authoritativeCenter: 1.20540,
      zoneLow: 1.20500,
      zoneHigh: 1.20550,
    },
  ];
  supply.analysisFacts.structuralReferenceAreas = [];
  supply.finalFeedback.entry1 = supply.analysisFacts.selectedEntryAreas[0];

  const result = validateBenchmarkResult(supply, {
    expectedDirection: "bearish",
    expectedEntry1Type: "supply",
    expectedEntry1ZoneLow: "1.20480",
    expectedEntry1ZoneHigh: "1.20520",
    requiredFeedbackTerms: "supply",
    tolerance: "0.00002",
  });

  assert.equal(result.passed, true);
});

test("rejects a supply or demand area with no meaningful expected-zone overlap", () => {
  const demand = structuredClone(baseResult);
  demand.analysisFacts.selectedEntryAreas[0] = {
    executionOrder: 1,
    areaType: "demand",
    authoritativeCenter: 1.40450,
    zoneLow: 1.40430,
    zoneHigh: 1.40470,
  };
  demand.finalFeedback.entry1 = demand.analysisFacts.selectedEntryAreas[0];

  const result = validateBenchmarkResult(demand, {
    expectedEntry1Type: "demand",
    expectedEntry1ZoneLow: "1.40341",
    expectedEntry1ZoneHigh: "1.40395",
    tolerance: "0.00002",
  });

  assert.equal(result.passed, false);
  assert.ok(result.criticalFailures.some((check) => check.id === "entry_1"));
});

test("keeps support and resistance expectations anchored to exact levels", () => {
  const support = structuredClone(baseResult);
  support.analysisFacts.selectedEntryAreas[0] = {
    executionOrder: 1,
    areaType: "support",
    authoritativeCenter: 1.40580,
    zoneLow: 1.40510,
    zoneHigh: 1.40600,
  };
  support.finalFeedback.entry1 = support.analysisFacts.selectedEntryAreas[0];

  const result = validateBenchmarkResult(support, {
    expectedEntry1: "1.40520",
    expectedEntry1Type: "support",
    tolerance: "0.00008",
  });

  assert.equal(result.passed, false);
  assert.ok(result.criticalFailures.some((check) => check.id === "entry_1"));
});

test("automatic mode verifies chart context, ordered structure and hidden Fibonacci entry confluence", () => {
  const automatic = structuredClone(baseResult);
  automatic.chartDetection = {
    detectedInstrument: "AUDUSD",
    detectedTimeframe: "H1",
  };
  automatic.finalFeedback.entry1 = {
    executionOrder: 1,
    areaType: "support",
    authoritativeCenter: 0.70104,
    zoneLow: 0.7009,
    zoneHigh: 0.7012,
  };
  automatic.analysisFacts.selectorDiagnostics = {
    selectorVersion: "4.6.2",
    structuralCandidates: [
      { areaType: "support", frameworkPrice: 0.70104, structurallyValid: true },
      { areaType: "demand", frameworkPrice: 0.69845, structurallyValid: true },
    ],
    fibCandidates: [
      { areaType: "support", resolvedEntryPrice: 0.70104, passed: true },
      { areaType: "demand", resolvedEntryPrice: 0.69845, passed: false },
    ],
  };

  const result = validateBenchmarkResult(automatic, { automaticMode: true });
  assert.equal(result.passed, true);
  assert.equal(result.checks.find((check) => check.id === "ordered_selector")?.passed, true);
  assert.equal(
    result.checks.find((check) => check.id === "automatic_fibonacci_confluence")?.passed,
    true
  );
});

test("automatic mode rejects a selected entry that did not pass Fibonacci confluence", () => {
  const automatic = structuredClone(baseResult);
  automatic.chartDetection = {
    detectedInstrument: "AUDUSD",
    detectedTimeframe: "H1",
  };
  automatic.finalFeedback.entry1 = {
    executionOrder: 1,
    areaType: "support",
    authoritativeCenter: 0.70104,
  };
  automatic.analysisFacts.selectorDiagnostics = {
    selectorVersion: "4.6.2",
    structuralCandidates: [{ areaType: "support", frameworkPrice: 0.70104 }],
    fibCandidates: [{ areaType: "support", resolvedEntryPrice: 0.70104, passed: false }],
  };

  const result = validateBenchmarkResult(automatic, { automaticMode: true });
  assert.equal(result.passed, false);
  assert.equal(
    result.criticalFailures.some((check) => check.id === "automatic_fibonacci_confluence"),
    true
  );
});

test("automatic mode accepts explicit chart-native fallback Fibonacci diagnostics", () => {
  const automatic = structuredClone(baseResult);
  automatic.chartDetection = {
    detectedInstrument: "USA30",
    detectedTimeframe: "H1",
  };
  automatic.analysisFacts.selectedEntryAreas = [
    {
      executionOrder: 1,
      areaType: "converted resistance",
      authoritativeCenter: 53275.6,
      zoneLow: 53275.6,
      zoneHigh: 53275.6,
    },
  ];
  automatic.finalFeedback.entry1 = {
    executionOrder: 1,
    areaType: "converted resistance",
    authoritativeCenter: 53275.6,
  };
  automatic.analysisFacts.selectorDiagnostics = {
    selectorVersion: "4.16.0",
    fallbackSource: "uploaded_chart_only",
    selectedEntries: [
      {
        authoritativeCenter: 53275.6,
        fibonacciMatches: [
          { label: "50.0", ratio: 0.5, price: 53305.6 },
        ],
      },
    ],
  };

  const result = validateBenchmarkResult(automatic, { automaticMode: true });
  assert.equal(result.passed, true);
  assert.equal(result.checks.find((check) => check.id === "ordered_selector")?.passed, true);
  assert.equal(
    result.checks.find((check) => check.id === "automatic_fibonacci_confluence")?.passed,
    true
  );
});

test("a verified one-entry baseline rejects an unnecessary Entry 2", () => {
  const automatic = structuredClone(baseResult);
  automatic.analysisFacts.selectedEntryAreas = [
    {
      executionOrder: 1,
      areaType: "converted support",
      authoritativeCenter: 1.35703,
      zoneLow: 1.35703,
      zoneHigh: 1.35703,
    },
    {
      executionOrder: 2,
      areaType: "converted support",
      authoritativeCenter: 1.35543,
      zoneLow: 1.35543,
      zoneHigh: 1.35543,
    },
  ];
  automatic.finalFeedback.narrativeLock = {
    selectedEntries: automatic.analysisFacts.selectedEntryAreas,
  };
  automatic.finalFeedback.entry1 = automatic.analysisFacts.selectedEntryAreas[0];
  automatic.finalFeedback.entry2 = automatic.analysisFacts.selectedEntryAreas[1];
  const result = validateBenchmarkResult(automatic, { expectedEntryCount: 1 });
  assert.equal(result.passed, false);
  assert.equal(
    result.criticalFailures.some((check) => check.id === "expected_entry_count"),
    true
  );
});
