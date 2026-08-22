import test from "node:test";
import assert from "node:assert/strict";
import { strictFixtureFromAutomaticResult } from "./public/fixture-promotion.js";

function automaticResult(entries) {
  return {
    mode: "automatic",
    status: "passed",
    label: "2882",
    validation: {
      direction: "bullish",
      selectedEntries: entries,
      versions: { buildId: "CSA-test-build" },
    },
    analysis: {
      detectedPair: "USDCHF",
      detectedTimeframe: "H1",
      analysisType: "post-trade",
      entitlement: { basePlan: "starter" },
    },
  };
}

test("promotes automatic entries and preserves supply/demand boundaries", () => {
  const result = automaticResult([
    { order: 1, center: 0.81069, levelText: "0.81069", areaType: "converted support", zoneLow: 0.81069, zoneHigh: 0.81069 },
    { order: 2, center: 0.8091, levelText: "0.80910", areaType: "demand", zoneLow: 0.8091, zoneHigh: 0.8091 },
  ]);
  result.analysis.analysisFacts = {
    selectedEntryAreas: [
      { executionOrder: 1, areaType: "converted support", authoritativeCenter: 0.81069, zoneLow: 0.81009, zoneHigh: 0.81129 },
      { executionOrder: 2, areaType: "demand", authoritativeCenter: 0.8091, zoneLow: 0.8091, zoneHigh: 0.81025 },
    ],
  };
  const fixture = strictFixtureFromAutomaticResult(result);

  assert.equal(fixture.instrument, "USDCHF");
  assert.equal(fixture.timeframe, "H1");
  assert.equal(fixture.expectedDirection, "bullish");
  assert.equal(fixture.expectedEntry1, "0.81069");
  assert.equal(fixture.expectedEntry1Type, "converted support");
  assert.equal(fixture.expectedEntry2, "0.80910");
  assert.equal(fixture.expectedEntry2Type, "demand");
  assert.equal(fixture.expectedEntry2ZoneLow, "0.8091");
  assert.equal(fixture.expectedEntry2ZoneHigh, "0.81025");
  assert.equal(fixture.entry2Required, true);
  assert.equal(fixture.requiredLevels, "0.81069, 0.80910");
  assert.equal(fixture.requiredFeedbackTerms, "converted support, demand");
});

test("promotes a consistent no-entry result", () => {
  const fixture = strictFixtureFromAutomaticResult(automaticResult([]));
  assert.equal(fixture.noEntryExpected, true);
  assert.equal(fixture.entry2Required, false);
  assert.equal(fixture.expectedEntry1, "");
  assert.equal(fixture.requiredLevels, "");
});

test("promotes an independently validated third entry alternative", () => {
  const result = automaticResult([
    { order: 1, center: 1.38066, levelText: "1.38066", areaType: "supply", zoneLow: 1.3805, zoneHigh: 1.3808 },
    { order: 2, center: 1.38437, levelText: "1.38437", areaType: "converted resistance", zoneLow: 1.38437, zoneHigh: 1.38437 },
    { order: 3, center: 1.38767, levelText: "1.38767", areaType: "resistance", zoneLow: 1.38767, zoneHigh: 1.38767 },
  ]);
  result.analysis.detectedPair = "USDCAD";
  const fixture = strictFixtureFromAutomaticResult(result);

  assert.equal(fixture.expectedEntry3, "1.38767");
  assert.equal(fixture.expectedEntry3Type, "resistance");
  assert.equal(fixture.entry3Required, true);
});

test("rejects an automatic result that needs review", () => {
  const result = automaticResult([]);
  result.status = "failed";
  assert.throws(
    () => strictFixtureFromAutomaticResult(result),
    /Only a consistent automatic result/
  );
});
