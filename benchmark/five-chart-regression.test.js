import test from "node:test";
import assert from "node:assert/strict";
import { validateBenchmarkResult } from "./validator.js";
import { listVerifiedBaselines } from "./verified-baselines.js";

const verifiedCases = listVerifiedBaselines().map((baseline) => ({
  id: baseline.id,
  instrument: baseline.instrument,
  direction: baseline.expectedDirection,
  entry1: baseline.expectedEntry1,
  type1: baseline.expectedEntry1Type,
  entry2: baseline.expectedEntry2,
  type2: baseline.expectedEntry2Type,
  entry2Required: baseline.entry2Required === true,
  forbiddenEntries: baseline.forbiddenEntries || "",
}));

function resultFor(item) {
  const entries = [
    { executionOrder: 1, areaType: item.type1, authoritativeCenter: item.entry1, zoneLow: item.entry1, zoneHigh: item.entry1 },
  ];
  if (item.entry2 !== undefined) {
    entries.push({ executionOrder: 2, areaType: item.type2, authoritativeCenter: item.entry2, zoneLow: item.entry2, zoneHigh: item.entry2 });
  }
  return {
    analysis: `Direction ${item.direction}. Entry 1 ${item.entry1}.${item.entry2 ? ` Entry 2 ${item.entry2}.` : ""}`,
    chartDetection: { detectedInstrument: item.instrument, detectedTimeframe: "H1" },
    analysisFacts: { direction: item.direction, selectedEntryAreas: entries },
    finalFeedback: {
      strengths: [`Chart ${item.id} preserves its verified structural path.`],
      weaknesses: [`Chart ${item.id} still requires a fresh trigger before execution.`],
      narrativeLock: { selectedEntries: entries },
    },
  };
}

for (const item of verifiedCases) {
  test(`verified five-chart baseline ${item.id}`, () => {
    const validation = validateBenchmarkResult(resultFor(item), {
      expectedDirection: item.direction,
      expectedEntry1: item.entry1,
      expectedEntry1Type: item.type1,
      expectedEntry2: item.entry2 ?? "",
      expectedEntry2Type: item.type2 ?? "",
      entry2Required: item.entry2Required,
      forbiddenEntries: item.forbiddenEntries,
    });
    assert.equal(validation.passed, true);
  });
}
