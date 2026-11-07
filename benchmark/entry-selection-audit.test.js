import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const start = server.indexOf("function logEntrySelectionAudit(");
const end = server.indexOf("function rankChartNativeFallbackAreas(");

function run(args) {
  const lines = [];
  const context = vm.createContext({ console: { log: (...parts) => lines.push(parts.join(" ")) } });
  vm.runInContext(`${server.slice(start, end)}\nthis.logEntrySelectionAudit = logEntrySelectionAudit;`, context);
  context.logEntrySelectionAudit(args);
  return lines;
}

const parse = (line) => JSON.parse(line.slice(line.indexOf("{")));

// GBPUSD H1, reviewed at 2026-11-05 06:00: bullish, price 1.3488 at the cutoff, the screenshot's own last price 1.3452.
const rankedAreaResult = {
  areas: [],
  validation: { passed: true, errors: [], fallbackSource: "uploaded_chart_only_no_qualified_entry" },
  regressionDiagnostics: {
    fallbackSource: "uploaded_chart_only_no_qualified_entry",
    fibonacci: { source: "uploaded_chart_visible_current_week_high_low", swingLow: 1.33782, swingHigh: 1.35023 },
    transparencyAudit: {
      fibonacciAudit: {
        verified: true, chartDerivedUsable: true, source: "uploaded_chart_visible_current_week_high_low",
        swingHigh: 1.35023, swingLow: 1.33782, acceptedBandLow: 1.34256, acceptedBandHigh: 1.34549,
      },
      candidateEvaluationAudit: [
        {
          period: "Monday", extreme: "high", structuralRole: "converted support", originalRole: "resistance",
          price: 1.34475, nearestFibRatio: 0.382, nearestFibPrice: 1.34549, fibDistance: 0.00074,
          insideAcceptedBand: true, qualified: false, rejectionReasons: ["missing independent structural provenance"],
        },
        {
          period: "Wednesday", extreme: "low", structuralRole: "demand", originalRole: "demand",
          price: 1.34055, nearestFibRatio: 0.618, nearestFibPrice: 1.34256, fibDistance: 0.00201,
          insideAcceptedBand: false, qualified: false, rejectionReasons: ["outside the 38.2%-61.8% retracement band"],
        },
      ],
    },
  },
};
const structuralReferenceAreas = [
  { authoritativeCenter: 1.3452, areaType: "support", frameworkPeriod: "Wednesday", priceSource: "uploaded_chart_supply_demand_zone", referenceOnly: true, outsideIdealZone: true },
];
const base = {
  rankedAreaResult, structuralReferenceAreas, direction: "bullish", phase: "bullish_structure",
  currentPrice: 1.3488, chartLastPrice: 1.3452, symbol: "GBPUSD", timeframe: "H1",
};

test("one line names the frame, the band and every candidate with its reasons", () => {
  const lines = run(base);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^CSA ENTRY SELECTION AUDIT: /);
  const audit = parse(lines[0]);
  assert.equal(audit.direction, "bullish");
  assert.equal(audit.currentPrice, 1.3488);
  assert.equal(audit.chartLastPrice, 1.3452);
  assert.equal(audit.fallbackSource, "uploaded_chart_only_no_qualified_entry");
  assert.deepEqual(
    { high: audit.frame.swingHigh, low: audit.frame.swingLow, bandLow: audit.frame.bandLow, bandHigh: audit.frame.bandHigh },
    { high: 1.35023, low: 1.33782, bandLow: 1.34256, bandHigh: 1.34549 }
  );
  assert.equal(audit.candidates.length, 2);
  assert.deepEqual(audit.candidates[0].reasons, ["missing independent structural provenance"]);
  assert.equal(audit.candidates[0].inBand, true);
  assert.equal(audit.candidates[1].inBand, false);
  assert.deepEqual(audit.selected, []);
});

test("a level to watch carries its source so its origin can be traced", () => {
  const audit = parse(run(base)[0]);
  assert.equal(audit.references.length, 1);
  assert.equal(audit.references[0].price, 1.3452);
  assert.equal(audit.references[0].source, "uploaded_chart_supply_demand_zone");
  assert.equal(audit.references[0].referenceOnly, true);
});

test("selected entries are listed with their period and source", () => {
  const selected = [{ authoritativeCenter: 1.60226, areaType: "converted support", sourcePeriod: "Monday", priceSource: "native_D1" }];
  const audit = parse(run({ ...base, rankedAreaResult: { ...rankedAreaResult, areas: selected } })[0]);
  assert.deepEqual(audit.selected, [{ price: 1.60226, role: "converted support", period: "Monday", source: "native_D1" }]);
});

test("missing or broken input never throws and never changes a review", () => {
  for (const args of [undefined, {}, { rankedAreaResult: null }, { rankedAreaResult: { regressionDiagnostics: { transparencyAudit: { candidateEvaluationAudit: "x" } } } }]) {
    assert.doesNotThrow(() => run(args));
  }
  const circular = {};
  circular.self = circular;
  const lines = run({ ...base, structuralReferenceAreas: [circular] });
  assert.equal(lines.length, 1);
});

test("the server logs after the selector and the references are built, and only logs", () => {
  const call = server.lastIndexOf("logEntrySelectionAudit({");
  assert.ok(call > server.indexOf("const structuralReferenceAreas = supplementReferencesWithExactChartLevels({"));
  assert.ok(call < server.indexOf("visualReview = markLinesOnAreas("));
  assert.ok(server.slice(start, end).includes("try {") && server.slice(start, end).includes("CSA ENTRY SELECTION AUDIT failed"));
});
