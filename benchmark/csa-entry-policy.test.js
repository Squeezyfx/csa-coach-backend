import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildFinalVisibleTerminalImpulse,
  canonicalInstrumentCode,
  classifyCsaStructuralStage,
  consolidateQualifiedSupplyDemandClusters,
  getMarketDataSymbolCandidates,
  getSupplyDemandClusterTolerance,
  hasIndependentChartPriceEvidence,
  hasIndependentStructuralEntryEvidence,
  isSupportedInstrumentCode,
  orderStructuralCandidatesForFib,
  parseChartHeaderText,
  reconcileLatestVisibleDateWithAxisYear,
  selectIndependentEntryAreas,
  selectProtectiveSupplyDemandAnchor,
  sequenceFibQualifiedAreas,
  shouldMergeQualifiedSupplyDemandCluster,
  shouldApplyFinalVisibleTerminalImpulse,
} from "../csa-entry-policy.js";

test("selector has no candidate-local Fibonacci source", () => {
  const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.equal(serverSource.includes("candidate_specific_prior_sr_break_period_impulse"), false);
  assert.equal(serverSource.includes("buildPriorConversionRelevantFibonacci"), false);
  assert.match(serverSource, /const relevantFibonacci = fibonacci;/);
});

test("normalizes common index aliases while preserving broker index tickers", () => {
  assert.equal(canonicalInstrumentCode("USA30,H1"), "USA30");
  assert.equal(canonicalInstrumentCode("US30"), "USA30");
  assert.equal(canonicalInstrumentCode("DJ30.cash"), "USA30");
  assert.equal(canonicalInstrumentCode("NAS100"), "USTEC");
  assert.equal(canonicalInstrumentCode("XAUUSD,H1"), "XAUUSD");
});

test("maps broker index names to provider candidates without changing CSA identity", () => {
  assert.deepEqual(getMarketDataSymbolCandidates("USA30"), ["DJI", "USA30"]);
  assert.deepEqual(getMarketDataSymbolCandidates("US30.cash"), ["DJI", "USA30"]);
  assert.deepEqual(getMarketDataSymbolCandidates("US500"), ["SPX", "US500"]);
  assert.deepEqual(getMarketDataSymbolCandidates("EURUSD"), ["EURUSD"]);
});

test("bottom time-axis year corrects a model date copied from unrelated chart chrome", () => {
  assert.equal(
    reconcileLatestVisibleDateWithAxisYear("2025-08-20", 2026),
    "2026-08-20"
  );
  assert.equal(
    reconcileLatestVisibleDateWithAxisYear("2026-08-20", 2026),
    "2026-08-20"
  );
  assert.equal(reconcileLatestVisibleDateWithAxisYear("not-a-date", 2026), null);
});

test("accepts supported five-character index symbols without accepting junk", () => {
  assert.equal(isSupportedInstrumentCode("USA30"), true);
  assert.equal(isSupportedInstrumentCode("US30.cash"), true);
  assert.equal(isSupportedInstrumentCode("XAUUSD"), true);
  assert.equal(isSupportedInstrumentCode("ABCDE"), false);
  assert.equal(isSupportedInstrumentCode("not detected"), false);
});

test("parses compact chart headers including USA30,H1", () => {
  assert.deepEqual(parseChartHeaderText("USA30,H1 52841.20 52888.20"), {
    instrument: "USA30",
    timeframe: "H1",
  });
  assert.deepEqual(parseChartHeaderText("XAUUSD,H4"), {
    instrument: "XAUUSD",
    timeframe: "H4",
  });
});

test("CSA structural checks always run S/R before S/D before other structure", () => {
  const ordered = orderStructuralCandidatesForFib([
    { id: "demand", type: "demand" },
    { id: "other", type: "pivot" },
    { id: "support", type: "support" },
    { id: "converted", type: "converted support" },
    { id: "supply", type: "supply" },
  ]);

  assert.deepEqual(
    ordered.map((item) => item.id),
    ["support", "converted", "demand", "supply", "other"]
  );
  assert.deepEqual(
    ordered.map((item) => item.standardStructuralStage),
    [
      "support_resistance",
      "support_resistance",
      "supply_demand",
      "supply_demand",
      "other_structure",
    ]
  );
});

test("explicit prior S/R and current S/D stages retain their structural identities", () => {
  assert.equal(
    classifyCsaStructuralStage({ stepwiseEntryStage: "immediate_prior_broken_sr" }).key,
    "support_resistance"
  );
  assert.equal(
    classifyCsaStructuralStage({ stepwiseEntryStage: "current_period_supply_demand" }).key,
    "supply_demand"
  );
});

test("after Fib qualification bullish entries follow nearest-to-deeper price path", () => {
  const sequenced = sequenceFibQualifiedAreas(
    [
      { id: "demand", authoritativeCenter: 1.40341 },
      { id: "support", authoritativeCenter: 1.4052 },
    ],
    "bullish"
  );
  assert.deepEqual(sequenced.map((item) => item.id), ["support", "demand"]);
});

test("after Fib qualification bearish entries follow nearest-to-deeper price path", () => {
  const sequenced = sequenceFibQualifiedAreas(
    [
      { id: "deep-supply", authoritativeCenter: 1.41 },
      { id: "near-resistance", authoritativeCenter: 1.407 },
    ],
    "bearish"
  );
  assert.deepEqual(sequenced.map((item) => item.id), ["near-resistance", "deep-supply"]);
});

test("Entry 2 may come from the next CSA structural stage when it independently qualifies", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "entry-1", areaType: "converted support", authoritativeCenter: 1.4052, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 50, fibonacciScore: 1 },
      { id: "failed-local", areaType: "converted support", authoritativeCenter: 1.4048, authoritativeFrameworkLevel: true, requiredFibConfluence: false, structuralScore: 50, fibonacciScore: 0 },
      { id: "entry-2", areaType: "demand", authoritativeCenter: 1.40341, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 55, fibonacciScore: 1, samePeriodDisplacementBaseValidated: true },
    ],
    "bullish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["entry-1", "entry-2"]);
});

test("Entry 2 may be a separate converted level only when it independently qualifies", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "entry-1", areaType: "converted resistance", authoritativeCenter: 53275.6, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 60, fibonacciScore: 1, priceSource: "independent_horizontal_line_reader_exact" },
      { id: "entry-2", areaType: "converted resistance", authoritativeCenter: 53421.2, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 55, fibonacciScore: 1, priceSource: "independent_horizontal_line_reader_exact" },
    ],
    "bearish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["entry-1", "entry-2"]);
});

test("exact marked level outranks a nearer inferred fragment after shared Fib qualification", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "inferred-supply", areaType: "supply", authoritativeCenter: 1.38285, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 52, fibonacciScore: 1, strongDepartureCount: 0 },
      { id: "marked-conversion", areaType: "converted resistance", authoritativeCenter: 1.38022, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 60, fibonacciScore: 1, priceSource: "independent_horizontal_line_reader_exact" },
    ],
    "bearish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["marked-conversion"]);
});

test("an inferred same-stage fragment cannot become Entry 2 behind a marked level", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "marked", areaType: "converted support", authoritativeCenter: 4436.15, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 60, fibonacciScore: 1, priceSource: "independent_horizontal_line_reader_exact" },
      { id: "fragment", areaType: "converted support", authoritativeCenter: 4428.73, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 55, fibonacciScore: 1, priceSource: "per_target_framework_price" },
    ],
    "bullish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["marked"]);
});

test("independent supply or demand requires its own structural evidence", () => {
  assert.equal(hasIndependentStructuralEntryEvidence({ areaType: "demand" }), false);
  assert.equal(
    hasIndependentStructuralEntryEvidence({
      areaType: "demand",
      samePeriodDisplacementBaseValidated: true,
    }),
    true
  );
});

test("final-visible terminal impulse must improve exact structural confluence", () => {
  const terminalImpulse = { enabled: true };
  assert.equal(
    shouldApplyFinalVisibleTerminalImpulse({ terminalImpulse, majorSelection: null }),
    true
  );
  assert.equal(
    shouldApplyFinalVisibleTerminalImpulse({ terminalImpulse, majorSelection: { pivotPrice: 1.2 } }),
    false
  );
  assert.equal(
    shouldApplyFinalVisibleTerminalImpulse({
      terminalImpulse,
      majorSelection: { pivotPrice: 1.2 },
      terminalStructuralScore: { matchCount: 2, normalizedDistanceSum: 0.4 },
      majorStructuralScore: { matchCount: 1, normalizedDistanceSum: 0.1 },
    }),
    true
  );
  assert.equal(
    shouldApplyFinalVisibleTerminalImpulse({
      terminalImpulse,
      majorSelection: { pivotPrice: 1.2 },
      terminalStructuralScore: { matchCount: 1, normalizedDistanceSum: 0.9 },
      majorStructuralScore: { matchCount: 1, normalizedDistanceSum: 0.5 },
    }),
    false
  );
});

test("selector reconciles exact chart/framework levels before choosing Fibonacci", () => {
  const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(serverSource, /function buildExactChartFrameworkCandidates/);
  assert.match(serverSource, /structuralLevelHints: exactChartFrameworkCandidates/);
  assert.match(serverSource, /structuralHintScore: scoreFibonacciFrameAgainstStructuralHints/);
  assert.match(serverSource, /chartExactFrameworkConfirmed/);
});

test("Fibonacci qualification cannot use the whole 50%-61.8% interval as confluence", () => {
  const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.equal(serverSource.includes('matchType: "inside_50_618_acceptance_band"'), false);
  assert.match(serverSource, /const matches = exactLevelMatches;/);
});

test("redundant same-stage Entry 2 is rejected without independent chart evidence", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "entry-1", areaType: "converted support", authoritativeCenter: 1.35703, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 60, fibonacciScore: 1 },
      { id: "stale-reference", areaType: "converted support", authoritativeCenter: 1.35543, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 55, fibonacciScore: 1, priceSource: "per_target_framework_price" },
    ],
    "bullish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["entry-1"]);
});

test("latest confirmed bullish break supplies the final-visible Fib impulse", () => {
  const impulse = buildFinalVisibleTerminalImpulse({
    candles: [
      { low: 4324, high: 4370 },
      { low: 4340, high: 4410 },
      { low: 4390, high: 4450 },
      { low: 4470, high: 4524 },
    ],
    direction: "bullish",
    oppositeEvent: { index: 0 },
    directionalEvent: { index: 2, pivotIndex: 1 },
  });

  assert.equal(impulse.originPrice, 4390);
  assert.equal(impulse.terminalPrice, 4524);
  assert.equal(impulse.originStartIndex, 2);
  assert.equal(impulse.terminalIndex, 3);
  assert.equal(impulse.rule, "latest_confirmed_break_candle_to_terminal_extreme");
  assert.equal(impulse.source, "final_visible_latest_confirmed_break_impulse");
});

test("latest confirmed bearish break supplies the final-visible Fib impulse", () => {
  const impulse = buildFinalVisibleTerminalImpulse({
    candles: [
      { low: 1.387, high: 1.39091 },
      { low: 1.38437, high: 1.389 },
      { low: 1.38022, high: 1.385 },
      { low: 1.37575, high: 1.381 },
    ],
    direction: "bearish",
    oppositeEvent: { index: 0 },
    directionalEvent: { index: 2, pivotIndex: 1 },
  });

  assert.equal(impulse.originPrice, 1.385);
  assert.equal(impulse.terminalPrice, 1.37575);
  assert.equal(impulse.originStartIndex, 2);
});

test("does not invent Entry 2 when a deeper candidate fails the shared Fib gate", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "entry-1", areaType: "converted resistance", authoritativeCenter: 1.38022, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 60, fibonacciScore: 1 },
      { id: "rejected", areaType: "converted resistance", authoritativeCenter: 1.38437, authoritativeFrameworkLevel: true, requiredFibConfluence: false, structuralScore: 55, fibonacciScore: 0 },
    ],
    "bearish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["entry-1"]);
});

test("overlapping demand keeps the lower protective launch-base boundary", () => {
  const selected = selectProtectiveSupplyDemandAnchor(
    { id: "shallow", areaType: "demand", authoritativeCenter: 1.40395 },
    { id: "deep", areaType: "demand", authoritativeCenter: 1.40341 }
  );
  assert.equal(selected.id, "deep");
});

test("overlapping supply keeps the upper protective launch-base boundary", () => {
  const selected = selectProtectiveSupplyDemandAnchor(
    { id: "shallow", areaType: "supply", authoritativeCenter: 0.80948 },
    { id: "deep", areaType: "supply", authoritativeCenter: 0.81 }
  );
  assert.equal(selected.id, "deep");
});

test("near-touching demand fragments use the wider qualified S/D merge allowance", () => {
  const atr = 0.00092;
  const tolerance = getSupplyDemandClusterTolerance(
    { areaType: "demand", zoneLow: 1.40395, zoneHigh: 1.4044 },
    { areaType: "demand", zoneLow: 1.40349, zoneHigh: 1.40383 },
    atr
  );

  assert.equal(tolerance, atr * 0.15);
  assert.ok(1.40395 - 1.40383 <= tolerance);

  const selected = selectProtectiveSupplyDemandAnchor(
    { id: "shallow", areaType: "demand", authoritativeCenter: 1.40395 },
    { id: "protective", areaType: "demand", authoritativeCenter: 1.40349 }
  );
  assert.equal(selected.id, "protective");
});

test("near-touching supply fragments keep the upper protective boundary", () => {
  const atr = 0.001;
  const tolerance = getSupplyDemandClusterTolerance(
    { areaType: "supply", zoneLow: 1.4101, zoneHigh: 1.4105 },
    { areaType: "supply", zoneLow: 1.41062, zoneHigh: 1.411 },
    atr
  );
  assert.ok(1.41062 - 1.4105 <= tolerance);

  const selected = selectProtectiveSupplyDemandAnchor(
    { id: "shallow", areaType: "supply", authoritativeCenter: 1.4105 },
    { id: "protective", areaType: "supply", authoritativeCenter: 1.411 }
  );
  assert.equal(selected.id, "protective");
});

test("support and demand keep the narrower normal dedupe allowance", () => {
  const atr = 0.00092;
  const tolerance = getSupplyDemandClusterTolerance(
    { areaType: "support" },
    { areaType: "demand" },
    atr
  );

  assert.equal(tolerance, atr * 0.08);
});

test("qualified overlapping demand fragments merge despite different quality scores", () => {
  assert.equal(
    shouldMergeQualifiedSupplyDemandCluster(
      { areaType: "demand", structuralScore: 55, fibonacciScore: 1 },
      { areaType: "demand", structuralScore: 62, fibonacciScore: 1 },
      { existingTrusted: false, candidateTrusted: false }
    ),
    true
  );
});

test("ordinary chart reconciliation does not impersonate an independently marked price", () => {
  assert.equal(
    hasIndependentChartPriceEvidence({ chartReconciled: true }),
    false
  );
  assert.equal(
    hasIndependentChartPriceEvidence({
      reconciliationConfidence: 25,
      priceSource: "independent_horizontal_line",
    }),
    true
  );
  assert.equal(
    hasIndependentChartPriceEvidence({ reconciliationConfidence: 100 }),
    false
  );
  assert.equal(
    hasIndependentChartPriceEvidence({
      chartReconciled: true,
      priceSource: "per_target_framework_price",
    }),
    false
  );
});

test("unmarked framework demand can merge with its overlapping intraday fragment", () => {
  const frameworkDemand = {
    areaType: "demand",
    authoritativeCenter: 0.8091,
    zoneLow: 0.8091,
    zoneHigh: 0.80977,
    priceSource: "per_target_framework_price",
  };
  const intradayDemand = {
    areaType: "demand",
    authoritativeCenter: 0.80948,
    zoneLow: 0.80948,
    zoneHigh: 0.81025,
  };

  assert.equal(
    shouldMergeQualifiedSupplyDemandCluster(frameworkDemand, intradayDemand, {
      existingTrusted: hasIndependentChartPriceEvidence(frameworkDemand),
      candidateTrusted: hasIndependentChartPriceEvidence(intradayDemand),
    }),
    true
  );
  assert.equal(
    selectProtectiveSupplyDemandAnchor(frameworkDemand, intradayDemand)
      .authoritativeCenter,
    0.8091
  );

  const consolidated = consolidateQualifiedSupplyDemandClusters(
    [intradayDemand, frameworkDemand],
    0.00083
  );
  assert.equal(consolidated.length, 1);
  assert.equal(consolidated[0].authoritativeCenter, 0.8091);
  assert.equal(consolidated[0].zoneLow, 0.8091);
  assert.equal(consolidated[0].zoneHigh, 0.81025);
});
