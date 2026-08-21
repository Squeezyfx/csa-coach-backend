import test from "node:test";
import assert from "node:assert/strict";
import { validateBenchmarkResult } from "./validator.js";

const verifiedCases = [
  { id: "2898", instrument: "GBPUSD", direction: "bullish", entry1: 1.35703, type1: "converted support" },
  { id: "2902", instrument: "USA30", direction: "bearish", entry1: 53275.60, type1: "converted resistance", entry2: 53421.20, type2: "converted resistance" },
  { id: "2901", instrument: "USDCAD", direction: "bearish", entry1: 1.38022, type1: "converted resistance" },
  { id: "2900", instrument: "XAUUSD", direction: "bullish", entry1: 4436.15, type1: "converted support" },
  { id: "2899", instrument: "USDCHF", direction: "bearish", entry1: 0.80711, type1: "converted resistance" },
];

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
      entry2Required: item.entry2 !== undefined,
      forbiddenEntries: item.id === "2898" ? "1.35543" : item.id === "2901" ? "1.38625" : item.id === "2900" ? "4367.25,4362.17" : "",
    });
    assert.equal(validation.passed, true);
  });
}
