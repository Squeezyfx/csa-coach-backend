import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { auditPeriodInventory, compareDatedPeriodInventories, isUnverifiedPeriodCandidate, buildCompletedPeriodReferences, reconcilePeriodMapping, buildNoEntryTransparencyAudit } from "../period-accuracy.js";
import * as policy from "../csa-entry-policy.js";
import { validateBenchmarkResult, applyBatchFeedbackDiversityChecks } from "./validator.js";

// Synthetic dated OHLC fixtures, not asserted broker history or screenshot prices.
const datedPeriods = [
  {date:"2026-01-01",periodLabel:"January",open:100,high:130,low:90,close:120},
  {date:"2026-02-01",periodLabel:"February",open:120,high:140,low:110,close:135},
  {date:"2026-03-01",periodLabel:"March",open:135,high:150,low:125,close:145,partialPeriod:true},
];
const referenceArgs = {periods:datedPeriods, timeframe:"D1",visibleDateFloor:"2026-03-16",providerAvailable:true};
test("DOGE historical alignment rejects wrong January/February estimates without swapping prices", () => {
  const result = reconcilePeriodMapping({periods:[{date:"2026-01-01",sourceUnit:"MN",periodLabel:"February",high:.128,low:.092},{date:"2026-02-01",sourceUnit:"MN",high:.152,low:.086}],references:[{date:"2026-01-01",high:.15656,low:.09461},{date:"2026-02-01",high:.11757,low:.08001}],tolerance:.0004});
  assert.equal(result.periods[0].periodLabel,"January");
  assert.equal(result.periods[0].high,null);
  assert.equal(result.periods[1].high,null);
  assert.equal(result.rejected.length,4);
  assert.equal(result.verified,false);
});
test("wrong-month wick evidence is rejected while unknown rows keep their calendar position", () => {
  const result = reconcilePeriodMapping({periods:[{date:"2026-01-01",sourceUnit:"MN",high:130,low:90,highDate:"2026-02-01"},{date:"2026-02-01",sourceUnit:"MN",high:null,low:null},{date:"2026-03-01",sourceUnit:"MN",high:140,low:100}]});
  assert.equal(result.periods[0].high,null);
  assert.equal(result.periods[1].date,"2026-02-01");
  assert.equal(result.periods[2].high,140);
});
test("same-month matching reference remains a reference, not automatic verification", () => {
  const period={date:"2026-01-01",sourceUnit:"MN",high:130,low:90};
  const result=reconcilePeriodMapping({periods:[period],references:[period]});
  assert.equal(result.periods[0].high,130);
  assert.equal(result.verified,false);
});
test("duplicate calendar records cannot override one another", () => {
  const period={date:"2026-01-01",sourceUnit:"MN",high:130,low:90};
  assert.ok(reconcilePeriodMapping({periods:[period,period]}).periods.every(p=>p.high===null));
});
test("completed provider months survive unknown final day, with no entry authority", () => {
  const reference = buildCompletedPeriodReferences(referenceArgs);
  assert.deepEqual(reference.periods.map(p=>[p.date,p.high,p.low]),[["2026-01-01",130,90],["2026-02-01",140,110]]);
  assert.equal(reference.entryEligible,false);
  assert.ok(reference.periods.every(p=>!p.chartVerified && !p.brokerVerified && !p.entryEligible));
});
test("each period is audited independently: a bad month does not remove a good month", () => {
  const reference = buildCompletedPeriodReferences({...referenceArgs,periods:[datedPeriods[0],{...datedPeriods[1],low:160}]});
  assert.equal(reference.periods.length,1);
  assert.equal(reference.rejected[0].reason,"period_integrity_failed");
});
test("missing middle month cannot extend ownership into the following month", () => {
  const reference = buildCompletedPeriodReferences({...referenceArgs, periods:[datedPeriods[0]],candles:[{datetime:"2026-02-20",high:500,low:1}]});
  assert.equal(reference.periods.length,1);
  assert.equal(reference.periods[0].evidence.checkedCandleCount,0);
});
test("dated candles exceeding a completed range reject only that period", () => {
  const reference = buildCompletedPeriodReferences({...referenceArgs,candles:[{datetime:"2026-01-15",high:131,low:95}]});
  assert.deepEqual(reference.periods.map(p=>p.date),["2026-02-01"]);
});
test("no source, no printed date, invalid dates and duplicate periods cannot be certified", () => {
  for (const args of [{providerAvailable:false},{visibleDateFloor:""},{visibleDateFloor:"2026-02-30"},{periods:[datedPeriods[0],datedPeriods[0]]}]) {
    assert.equal(buildCompletedPeriodReferences({...referenceArgs,...args}).periods.length,0);
  }
});
test("weekly and daily period references use independent calendar ends", () => {
  const periods = [{date:"2026-08-03",high:20,low:10},{date:"2026-08-10",high:22,low:11}];
  assert.equal(buildCompletedPeriodReferences({...referenceArgs,periods,timeframe:"H4",visibleDateFloor:"2026-08-12"}).periods.length,1);
  assert.equal(buildCompletedPeriodReferences({...referenceArgs,periods,timeframe:"H1",visibleDateFloor:"2026-08-12"}).periods.length,2);
});
test("diagnostic-only repeated safety text is not a coaching diversity failure", () => {
  const item = {status:"failed",analysis:{benchmarkDiagnosticOnly:true,strengths:["This identical safety explanation is intentionally shared by diagnostics."],weaknesses:["Another identical safety explanation is intentionally shared by diagnostics."]},validation:{checks:[]}};
  assert.ok(applyBatchFeedbackDiversityChecks([item,item]).every(r=>r.validation.checks.length===0));
});

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
test("actual unresolved-direction return retains references and failure diagnostics", () => {
  const start = server.indexOf("function rankRawEntryAreas(");
  const source = server.slice(start,server.indexOf("\n}\n",start)+2);
  const ctx = vm.createContext({buildNoEntryTransparencyAudit,CSA_SELECTOR_VERSION:"test",BENCHMARK_DRY_RUN_ENABLED:true,rankChartNativeFallbackAreas:()=>null});
  vm.runInContext(source,ctx);
  const fallback={usable:false,completedPeriodReferences:{periods:[{date:"2026-01-01",high:.15656,low:.09461}]},providerFailure:{category:"date_unverified"},periodMappingAudit:{rejected:[{date:"2026-02-01"}]}};
  for (const direction of ["range","bullish"]) {
    const result=ctx.rankRawEntryAreas({direction,timeframe:"D1",visualReview:{chartNativeEntryFallback:fallback}});
    const audit=result.regressionDiagnostics.transparencyAudit;
    assert.equal(audit.inventoryAuthority.completedPeriodReferences.periods.length,1);
    assert.equal(audit.inventoryAuthority.providerFailure.category,"date_unverified");
    assert.equal(audit.inventoryAuthority.periodMappingAudit.rejected.length,1);
    assert.equal(audit.fibonacciAudit.verified,false);
    assert.equal(result.regressionDiagnostics.selectedEntries.length,0);
  }
});
// Exercise the actual server selector without starting Express or provider calls.
const functionSource = name => {
  const start = server.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return server.slice(start, server.indexOf("\n}\n", start) + 2);
};
const context = vm.createContext({ ...policy, isUnverifiedPeriodCandidate,
  asPositiveNumber: value => Number(value) > 0 ? Number(value) : null,
  getCleanBreakTolerance: () => 0.00001,
  getApprovedPriceTolerance: () => 0.00001,
  getSupportedCsaTimeframeProfile: () => ({}),
  formatPrice: value => String(value), safeUserText: value => String(value || ""),
  compareHighWithTolerance: (value, prior) => ({ cleanBreak: value > prior }),
  compareLowWithTolerance: (value, prior) => ({ cleanBreak: value < prior }),
  CSA_SELECTOR_VERSION: "4.37.0",
  CSA_BUILD_ID: "test", console: { log() {} },
});
for (const name of ["buildCsaAreas", "buildPeriodInventoryStructuralCandidates", "rankChartNativeFallbackAreas"])
  vm.runInContext(functionSource(name), context);

const periods = [
  { date: "2026-01-01", periodLabel: "January", high: 200, low: 100 },
  { date: "2026-02-01", periodLabel: "February", high: 150, low: 110 },
  { date: "2026-03-01", periodLabel: "March", high: 160, low: 120, partialPeriod: true },
];

test("supply derived from an unverified period cannot bypass the selector", () => {
  const result = context.rankChartNativeFallbackAreas({
    timeframe: "D1", direction: "bearish", currentPrice: 125,
    visualReview: { chartNativeEntryFallback: {
      usable: true, direction: "bearish", currentWeekHigh: 200, currentWeekLow: 100,
      currentPeriodFrameVerified: true, inventoryAuthority: "complete_chart_only_period_inventory_provider_unavailable_human_review",
      periodInventory: periods,
    } },
  });
  assert.equal(result.areas.length, 0);
  assert.equal(result.regressionDiagnostics.transparencyAudit.fibonacciAudit.verified, false);
  const feb = result.regressionDiagnostics.candidateEvaluations.find(item => item.candidate.sourceKind === "February high");
  assert.equal(feb.candidate.independentEntryEvidence, false);
  assert.equal(feb.qualified, false);
});

test("matching an estimated extreme cannot manufacture exact-line authority (Cocoa regression)", () => {
  const result = context.buildPeriodInventoryStructuralCandidates({ periodInventory: periods,
    inventoryProvenanceVerified: false, direction: "bullish", currentPrice: 190,
    visualReview: { chartNativeEntryFallback: { candidates: [
      { price: 110, areaType: "support", sourceKind: "February low", exactVisiblePrice: true },
    ] } },
  });
  assert.equal(result.rejectedVisualCandidates.length, 1);
  assert.equal(result.candidates.some(item => item.priceSource === "independent_horizontal_line_reader_exact"), false);
});

test("verified completed periods still produce entries and current month never supplies one", () => {
  const result = context.rankChartNativeFallbackAreas({ timeframe: "D1", direction: "bearish", currentPrice: 125,
    visualReview: { chartNativeEntryFallback: { usable: true, direction: "bearish",
      currentWeekHigh: 200, currentWeekLow: 100, currentPeriodFrameVerified: true,
      marketInventoryVerified: true, inventoryAuthority: "cutoff_safe_market_period_inventory",
      periodInventory: periods } },
  });
  assert.ok(result.areas.some(item => item.sourcePeriod === "February"));
  assert.ok(result.areas.every(item => item.sourcePeriod !== "March"));
});

test("a final daily candle neither shrinks a month nor fills missing month extremes", () => {
  const source = [{ date: "2026-08-01", high: 7000, low: 5000, open: 5500 }];
  const [row] = policy.reconcileFinalPeriodWithVisibleCandle({ periodInventory: source,
    timeframe: "D1", visibleDate: "2026-08-20", visibleOpen: 6222, visibleHigh: 6677,
    visibleLow: 6208, visibleClose: 6627 });
  assert.deepEqual([row.high, row.low, row.open], [7000, 5000, 5500]);
  assert.equal(source[0].close, undefined);
  const [missing] = policy.reconcileFinalPeriodWithVisibleCandle({
    periodInventory: [{ high: null, low: null, open: null }], visibleHigh: 6677, visibleLow: 6208 });
  assert.deepEqual([missing.high, missing.low, missing.open], [null, null, null]);
});

test("August header cannot contaminate July when the August inventory row is absent", () => {
  const source = [{ date: "2026-07-01", high: 100, low: 80 }];
  assert.deepEqual(policy.reconcileFinalPeriodWithVisibleCandle({ periodInventory: source,
    timeframe: "D1", visibleDate: "2026-08-20", visibleHigh: 120, visibleLow: 70 }), source);
});

test("missing header prices are not treated as zero", () => {
  const source = [{ high: 100, low: 80 }];
  assert.deepEqual(policy.reconcileFinalPeriodWithVisibleCandle({ periodInventory: source }), source);
});

test("inventory comparisons join by month date, not array index", () => {
  assert.deepEqual(compareDatedPeriodInventories(periods, [...periods].reverse()), []);
});

test("dated source candle exceeding a month extreme blocks verification", () => {
  const audit = auditPeriodInventory({ periods: periods.slice(0, 2), candles: [
    { datetime: "2026-02-01", high: 201, low: 110 },
  ] });
  assert.equal(audit.passed, false);
  assert.equal(audit.issues[0].date, "2026-02-01");
});

test("out-of-order, missing and zero price inventories are not certified", () => {
  assert.equal(auditPeriodInventory({ periods: [...periods].reverse() }).passed, false);
  assert.equal(auditPeriodInventory({ periods: [{ date: "2026-01-01", high: 2, low: null }] }).passed, false);
  assert.equal(auditPeriodInventory({ periods: [] }).passed, false);
});

test("source dates are preserved and future candles are excluded from the audit", () => {
  const audit = auditPeriodInventory({ periods: periods.slice(0, 1), cutoffDate: "2026-01-31", candles: [
    { datetime: "2026-01-12", high: 200, low: 100 },
    { datetime: "2026-02-02", high: 999, low: 1 },
  ] });
  assert.equal(audit.passed, true);
  assert.equal(audit.evidence[0].highCandleDate, "2026-01-12");
});

test("USA500 July shallower than 38.2 cannot qualify by joining a deeper level", () => {
  // Synthetic geometry only; these are NOT claimed broker benchmark prices.
  const common = { direction: "bullish", swingHigh: 8000, swingLow: 6000, tolerance: 20 };
  assert.equal(policy.findNearestAllowedFibonacciMatch({ ...common, price: 7300, zoneLow: 7300, zoneHigh: 7300 }), null);
  for (const price of [7230, 7000, 6770]) assert.ok(policy.findNearestAllowedFibonacciMatch({ ...common, price, zoneLow: price, zoneHigh: price }));
});

test("Platinum candidate beyond the capped 61.8 allowance is rejected", () => {
  assert.equal(policy.findNearestAllowedFibonacciMatch({ direction: "bearish", swingHigh: 2900,
    swingLow: 1515, price: 2426.30, zoneLow: 2426.30, zoneHigh: 2426.30, tolerance: 100 }), null);
});

test("validator rejects explicit unverified selected prices even if other fields claim validated", () => {
  const result = validateBenchmarkResult({ detectedTimeframe: "D1", detectedPair: "TEST",
    analysisFacts: { direction: "bullish", selectorDiagnostics: { selectorVersion: "4.37.0",
      selectedEntries: [{ priceSource: "unverified_chart_estimated_period_inventory", provenanceVerified: false }],
      transparencyAudit: { fibonacciAudit: { verified: false } } } } }, { automaticMode: true });
  assert.ok(result.checks.some(check => check.id === "automatic_selected_price_provenance" && !check.passed));
});

test("D1 validator rejects missing or misdated monthly rows", () => {
  const result = validateBenchmarkResult({ detectedTimeframe: "D1", detectedPair: "TEST",
    detectedLatestVisibleDate: "2026-03-20", analysisFacts: { direction: "bullish",
      selectorDiagnostics: { periodInventory: [periods[0], periods[2]] } } }, { automaticMode: true });
  assert.ok(result.checks.some(check => check.id === "automatic_framework_period_inventory" && !check.passed));
});

test("matching a verified price cannot attach a different month or structural role", () => {
  const result = context.buildPeriodInventoryStructuralCandidates({ periodInventory: periods,
    inventoryProvenanceVerified: true, direction: "bullish", currentPrice: 190,
    visualReview: { chartNativeEntryFallback: { candidates: [
      { price: 110, areaType: "support", sourceKind: "July low", sourcePeriod: "July" },
    ] } },
  });
  assert.equal(result.candidates.some(item => item.sourcePeriod === "July"), false);
  assert.ok(result.candidates.some(item => item.price === 110 && item.sourcePeriod === "February"));
});
