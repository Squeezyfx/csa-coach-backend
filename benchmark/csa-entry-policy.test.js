import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  annotateFrameworkPeriodPriority,
  buildFinalVisibleTerminalImpulse,
  canonicalInstrumentCode,
  classifyCsaStructuralStage,
  compareStructureLedCompletedImpulseCandidates,
  consolidateQualifiedSupplyDemandClusters,
  expandExactSupportResistanceBoundaries,
  findNearestAllowedFibonacciMatch,
  getMarketDataSymbolCandidates,
  getSupplyDemandClusterTolerance,
  hasIndependentChartPriceEvidence,
  hasIndependentSecondarySupplyDemandEvidence,
  hasIndependentStructuralEntryEvidence,
  isMostRecentStructureCompatibleImpulse,
  isSupportedInstrumentCode,
  mergeAdjacentExactConvertedLines,
  mergeFocusedSupplyDemandInventory,
  orderStructuralCandidatesForFib,
  parseChartHeaderText,
  reconcileLatestVisibleDateWithAxisYear,
  replaceMisclassifiedZoneWithExactConvertedLines,
  selectIndependentEntryAreas,
  selectNearestFrameworkPeriodHints,
  selectProtectiveSupplyDemandAnchor,
  selectStructureLedChartNativeImpulseFrame,
  sequenceFibQualifiedAreas,
  shouldMergeQualifiedSupplyDemandCluster,
  shouldApplyFinalVisibleTerminalImpulse,
} from "../csa-entry-policy.js";

test("framework inventory checks the immediate previous period before older periods", () => {
  const ordered = orderStructuralCandidatesForFib(
    annotateFrameworkPeriodPriority([
      { id: "older-sr", sourceIndex: 1, areaType: "resistance" },
      { id: "previous-sd", sourceIndex: 3, areaType: "supply" },
      { id: "previous-sr", sourceIndex: 3, areaType: "converted resistance" },
      { id: "second-previous-sr", sourceIndex: 2, areaType: "converted resistance" },
    ], 4)
  );

  assert.deepEqual(ordered.map((item) => item.id), [
    "previous-sr",
    "previous-sd",
    "second-previous-sr",
    "older-sr",
  ]);
});

test("impulse hints use the two nearest completed framework periods first", () => {
  const hints = selectNearestFrameworkPeriodHints([
    { id: "old", sourceIndex: 0 },
    { id: "second-previous", sourceIndex: 2 },
    { id: "previous", sourceIndex: 3 },
  ], 4, 2);
  assert.deepEqual(hints.map((item) => item.id), ["second-previous", "previous"]);
});

test("two printed converted S/R lines override an inferred broad demand zone", () => {
  const corrected = replaceMisclassifiedZoneWithExactConvertedLines({
    usable: true,
    direction: "bullish",
    candidates: [{
      price: 4436.15,
      zoneLow: 4415.55,
      zoneHigh: 4436.15,
      areaType: "demand",
      conversionBreakConfirmed: true,
      structuralEvidence: "price broke above the prior resistance region",
    }],
  }, [
    { displayedPrice: 4436.15 },
    { displayedPrice: 4428.73 },
    { displayedPrice: 4367.25 },
  ]);

  assert.deepEqual(corrected.candidates.map((item) => [item.price, item.areaType]), [
    [4436.15, "converted support"],
    [4428.73, "converted support"],
  ]);
  assert.ok(corrected.candidates.every((item) => item.zoneLow === item.zoneHigh));
});

test("independent line audit restores a closely stacked converted XAUUSD level", () => {
  const merged = mergeAdjacentExactConvertedLines({
    usable: true,
    direction: "bullish",
    swingLow: 4324.64,
    swingHigh: 4532.24,
    candidates: [{
      price: 4436.15,
      zoneLow: 4436.15,
      zoneHigh: 4436.15,
      areaType: "converted support",
      exactVisiblePrice: true,
      conversionBreakConfirmed: true,
      independentEntryEvidence: true,
      structuralEvidence: "prior resistance broke and held above",
    }],
  }, [
    { displayedPrice: 4436.15, colour: "blue", evidence: "upper blue line" },
    { displayedPrice: 4428.73, colour: "blue", evidence: "lower blue line" },
    { displayedPrice: 4367.25, colour: "red", evidence: "red support line" },
  ]);

  assert.deepEqual(merged.candidates.map((candidate) => candidate.price), [
    4436.15,
    4428.73,
  ]);
  assert.equal(merged.candidates[1].areaType, "converted support");
  assert.equal(merged.candidates[1].exactVisiblePrice, true);
});

test("chart-native impulse uses the nearer USA30 frame that validates two closer levels", () => {
  const frame = selectStructureLedChartNativeImpulseFrame({
    direction: "bearish",
    swingLow: 52823.2,
    swingHigh: 54314.8,
    candidates: [
      { price: 53275.6, zoneLow: 53275.6, zoneHigh: 53275.6, areaType: "converted resistance", exactVisiblePrice: true },
      { price: 53421.2, zoneLow: 53421.2, zoneHigh: 53421.2, areaType: "converted resistance", exactVisiblePrice: true },
      { price: 53788, zoneLow: 53788, zoneHigh: 53788, areaType: "converted resistance", exactVisiblePrice: true },
    ],
  });

  assert.equal(frame?.swingHigh, 53788);
  assert.equal(frame?.swingLow, 52823.2);
  assert.equal(frame?.structureLedOverrideApplied, true);
  assert.deepEqual(frame?.matchedPrices, [53275.6, 53421.2]);
});

test("recent structure-compatible impulse outranks an older broad frame", () => {
  const olderBroad = {
    id: "older-broad",
    breakIndex: 120,
    pivotIndex: 80,
    hierarchyAdjustedScore: 180,
    hierarchyPosition: 0.9,
    structuralHintScore: { matchCount: 2, normalizedDistanceSum: 0.1 },
  };
  const recentLocal = {
    id: "recent-local",
    breakIndex: 220,
    pivotIndex: 190,
    hierarchyAdjustedScore: 80,
    hierarchyPosition: 0.5,
    structuralHintScore: { matchCount: 1, normalizedDistanceSum: 0.3 },
  };

  const ordered = [olderBroad, recentLocal]
    .sort(compareStructureLedCompletedImpulseCandidates);
  assert.deepEqual(ordered.map((candidate) => candidate.id), [
    "recent-local",
    "older-broad",
  ]);
  assert.equal(
    isMostRecentStructureCompatibleImpulse(recentLocal, ordered),
    true
  );
  assert.equal(
    isMostRecentStructureCompatibleImpulse(olderBroad, ordered),
    false
  );
});

test("server calculates every allowed Fib ratio instead of trusting the model label", () => {
  const match = findNearestAllowedFibonacciMatch({
    direction: "bearish",
    swingHigh: 1.39091,
    swingLow: 1.37575,
    price: 1.38154,
    zoneLow: 1.3815,
    zoneHigh: 1.3816,
    tolerance: (1.39091 - 1.37575) * 0.06,
  });

  assert.equal(match?.ratio, 0.382);
});

test("USDCAD 1.38066 remains below the conservative 38.2 proximity gate", () => {
  const match = findNearestAllowedFibonacciMatch({
    direction: "bearish",
    swingHigh: 1.39091,
    swingLow: 1.37575,
    price: 1.38066,
    zoneLow: 1.3805,
    zoneHigh: 1.3808,
    tolerance: (1.39091 - 1.37575) * 0.06,
  });
  assert.equal(match, null);
});

test("Fib proximity checks the full supply zone rather than only its center", () => {
  const match = findNearestAllowedFibonacciMatch({
    direction: "bearish",
    swingHigh: 1.39091,
    swingLow: 1.37575,
    price: 1.381,
    zoneLow: 1.3808,
    zoneHigh: 1.3816,
    tolerance: 0.0004,
  });

  assert.equal(match?.ratio, 0.382);
  assert.ok(match.distance < 0.0004);
});

test("focused inventory merges only independent supply or demand candidates", () => {
  const primary = {
    usable: true,
    direction: "bearish",
    swingHigh: 1.39091,
    swingLow: 1.37575,
    candidates: [
      { price: 1.38437, areaType: "converted resistance", exactVisiblePrice: true },
    ],
  };
  const focused = {
    usable: true,
    direction: "bearish",
    candidates: [
      { price: 1.38066, areaType: "supply", independentEntryEvidence: true, structuralEvidence: "completed rejection base with bearish displacement" },
      { price: 1.38767, areaType: "resistance", exactVisiblePrice: true, structuralEvidence: "extra S/R" },
      { price: 1.381, areaType: "supply", independentEntryEvidence: false, structuralEvidence: "uncertain base" },
    ],
  };

  const merged = mergeFocusedSupplyDemandInventory(primary, focused);
  assert.deepEqual(merged.candidates.map((item) => item.price), [1.38437, 1.38066]);
  assert.equal(merged.swingHigh, 1.39091);
  assert.equal(merged.swingLow, 1.37575);
});

test("USDCAD excludes the below-38.2 supply and retains converted resistance only", () => {
  const swingHigh = 1.39091;
  const swingLow = 1.37575;
  const tolerance = (swingHigh - swingLow) * 0.06;
  const areas = [
    {
      id: "thursday-supply",
      areaType: "supply",
      authoritativeCenter: 1.38066,
      zoneLow: 1.3805,
      zoneHigh: 1.3808,
      authoritativeFrameworkLevel: true,
      independentEntryEvidence: true,
      structuralScore: 60,
    },
    {
      id: "deeper-converted-resistance",
      areaType: "converted resistance",
      authoritativeCenter: 1.38437,
      zoneLow: 1.38437,
      zoneHigh: 1.38437,
      authoritativeFrameworkLevel: true,
      independentEntryEvidence: true,
      structuralScore: 58,
    },
  ].map((area) => {
    const match = findNearestAllowedFibonacciMatch({
      direction: "bearish",
      swingHigh,
      swingLow,
      price: area.authoritativeCenter,
      zoneLow: area.zoneLow,
      zoneHigh: area.zoneHigh,
      tolerance,
    });
    return {
      ...area,
      requiredFibConfluence: Boolean(match),
      fibonacciScore: match ? 1 : 0,
    };
  });

  const selected = selectIndependentEntryAreas(areas, "bearish");
  assert.deepEqual(selected.map((area) => area.id), ["deeper-converted-resistance"]);
});

test("keeps separately printed S/R boundaries as exact independent levels", () => {
  const expanded = expandExactSupportResistanceBoundaries([
    {
      price: 53421.2,
      zoneLow: 53275.6,
      zoneHigh: 53421.2,
      areaType: "converted resistance",
      exactVisiblePrice: true,
      independentEntryEvidence: true,
      fibRatio: 0.618,
    },
  ]);

  assert.deepEqual(
    expanded.map((candidate) => [candidate.price, candidate.zoneLow, candidate.zoneHigh]),
    [
      [53275.6, 53275.6, 53275.6],
      [53421.2, 53421.2, 53421.2],
    ]
  );
});

test("does not split a genuine supply/demand zone", () => {
  const candidate = {
    price: 1.40349,
    zoneLow: 1.40349,
    zoneHigh: 1.4044,
    areaType: "demand",
    exactVisiblePrice: true,
  };

  assert.deepEqual(expandExactSupportResistanceBoundaries([candidate]), [candidate]);
});

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

test("Entry 2 may come from the next CSA structural stage when local framework Fib independently qualifies it", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "entry-1", areaType: "converted support", authoritativeCenter: 1.4052, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 50, fibonacciScore: 1 },
      { id: "failed-local", areaType: "converted support", authoritativeCenter: 1.4048, authoritativeFrameworkLevel: true, requiredFibConfluence: false, structuralScore: 50, fibonacciScore: 0 },
      { id: "entry-2", areaType: "demand", authoritativeCenter: 1.40341, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 55, fibonacciScore: 1, samePeriodDisplacementBaseValidated: true, fibOriginModel: "historical_framework_local_period_impulse" },
    ],
    "bullish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["entry-1", "entry-2"]);
});

test("broad major-swing Fib cannot manufacture a secondary supply or demand entry", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "entry-1", areaType: "converted support", authoritativeCenter: 1.35703, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 60, fibonacciScore: 1, priceSource: "independent_horizontal_line_reader_exact" },
      { id: "false-entry-2", areaType: "demand", authoritativeCenter: 1.35366, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 71, fibonacciScore: 1, samePeriodDisplacementBaseValidated: true, fibOriginModel: "local_protected_swing_fallback", fibonacciSource: "major_break_significance_protected_swing_impulse" },
    ],
    "bullish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["entry-1"]);
});

test("local historical framework impulse preserves a separately qualified demand Entry 2", () => {
  assert.equal(
    hasIndependentSecondarySupplyDemandEvidence({
      areaType: "demand",
      samePeriodDisplacementBaseValidated: true,
      fibOriginModel: "historical_framework_local_period_impulse",
    }),
    true
  );
});

test("Entry 2 may be a separate converted level only when it independently qualifies", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "entry-1", areaType: "converted resistance", authoritativeCenter: 53275.6, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 60, fibonacciScore: 1, priceSource: "independent_horizontal_line_reader_exact" },
      { id: "entry-2", areaType: "converted resistance", authoritativeCenter: 53421.2, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 55, fibonacciScore: 1, priceSource: "independent_horizontal_line_reader_exact", independentEntryEvidence: true },
    ],
    "bearish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["entry-1", "entry-2"]);
});

test("a second exact same-stage level is rejected without independent evidence", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "entry-1", areaType: "converted support", authoritativeCenter: 4436.15, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 60, fibonacciScore: 1, chartExactFrameworkConfirmed: true },
      { id: "duplicate", areaType: "converted support", authoritativeCenter: 4428.73, authoritativeFrameworkLevel: true, requiredFibConfluence: true, structuralScore: 55, fibonacciScore: 1, chartExactFrameworkConfirmed: true },
    ],
    "bullish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["entry-1"]);
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
      strongDepartureCount: 1,
    }),
    false
  );
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
  assert.equal(
    shouldApplyFinalVisibleTerminalImpulse({
      terminalImpulse,
      majorSelection: { pivotPrice: 1.2 },
      direction: "bearish",
      terminalStructuralScore: {
        matchCount: 1,
        normalizedDistanceSum: 0.6,
        matches: [{ price: 1.38022 }],
      },
      majorStructuralScore: {
        matchCount: 1,
        normalizedDistanceSum: 0.2,
        matches: [{ price: 1.38767 }],
      },
    }),
    true
  );
});

test("selector reconciles exact chart/framework levels before choosing Fibonacci", () => {
  const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(serverSource, /function buildExactChartFrameworkCandidates/);
  assert.match(serverSource, /structuralLevelHints: nearestPeriodStructuralHints/);
  assert.match(serverSource, /selectNearestFrameworkPeriodHints/);
  assert.match(serverSource, /structuralHintScore: scoreFibonacciFrameAgainstStructuralHints/);
  assert.match(serverSource, /chartExactFrameworkConfirmed/);
  assert.match(serverSource, /function rankChartNativeFallbackAreas/);
  assert.match(serverSource, /function extractFocusedChartNativeEntryFallback/);
  assert.match(serverSource, /focused_chart_native_entry_fallback/);
  assert.match(serverSource, /internalChartNativeFallback/);
  assert.match(serverSource, /Closely stacked parallel lines are separate lines/);
  assert.match(serverSource, /mergeAdjacentExactConvertedLines/);
  assert.match(serverSource, /selectStructureLedChartNativeImpulseFrame/);
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

test("sequences up to three independently structured Fibonacci-qualified alternatives", () => {
  const selected = selectIndependentEntryAreas(
    [
      { id: "entry-1", areaType: "supply", authoritativeCenter: 1.38066, authoritativeFrameworkLevel: true, independentEntryEvidence: true, strongDepartureCount: 1, requiredFibConfluence: true, structuralScore: 60, fibonacciScore: 1 },
      { id: "entry-2", areaType: "converted resistance", authoritativeCenter: 1.38437, authoritativeFrameworkLevel: true, independentEntryEvidence: true, requiredFibConfluence: true, structuralScore: 58, fibonacciScore: 1 },
      { id: "entry-3", areaType: "resistance", authoritativeCenter: 1.38767, authoritativeFrameworkLevel: true, independentEntryEvidence: true, requiredFibConfluence: true, structuralScore: 55, fibonacciScore: 1 },
      { id: "entry-4", areaType: "resistance", authoritativeCenter: 1.39091, authoritativeFrameworkLevel: true, independentEntryEvidence: true, requiredFibConfluence: true, structuralScore: 52, fibonacciScore: 1 },
    ],
    "bearish"
  );

  assert.deepEqual(selected.map((item) => item.id), ["entry-1", "entry-2", "entry-3"]);
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
  assert.equal(
    hasIndependentChartPriceEvidence({
      chartExactFrameworkConfirmed: true,
      priceSource: "per_target_framework_price",
    }),
    true
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
