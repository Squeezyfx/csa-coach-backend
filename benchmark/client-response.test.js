import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toClientResponse, toJournalRecord, slimResponseEnabled } from "../client-response.js";

const reading = { displayedPrice: 1.42633, matchedFrameworkPeriod: "Tuesday" };
const context = { selectedInstrument: "USDCAD", selectedTimeframe: "H1", detectedInstrument: "USDCAD", detectedTimeframe: "H1", status: "Reviewed", visibleMarkedLevels: [reading] };
const full = {
  success: true,
  analysis: "DIRECTIONAL BIAS:\nBearish",
  strengths: ["a"],
  weaknesses: ["b"],
  cleanChart: { status: "ok", levels: [{ label: "Sell 1", price: 1.42633 }] },
  entitlement: { effectivePlan: "elite" },
  savedToJournal: true,
  setupQuality: { score: 80 },
  chartContextCheck: context,
  contextCheck: context,
  chartContext: context,
  chartDetection: { detectedInstrument: "USDCAD", latestVisibleTime: "21:00", priceAxisTicks: [1.4] },
  finalFeedback: { analysis: "x", strengths: ["a"], entry1: { period: "Tuesday" }, narrativeLock: {} },
  dashboard: { strengths: ["a"], scoreContext: { tradeVisible: false }, chartContextCheck: context, marketReference: {} },
  csaDirectionalBias: { anchorLabel: "Monday" },
  analysisFacts: { selectorDiagnostics: {} },
  regressionSnapshot: { selector: {} },
  marketReference: { dailyLevels: [{ label: "Monday", high: 1.4, low: 1.3 }] },
  visualReview: { visibleMarkedLevels: [reading] },
  chartOverlay: {},
};
const leaks = /monday|tuesday|dailyLevels|selectorDiagnostics|marketReference|visualReview|matchedFrameworkPeriod|priceAxisTicks|narrativeLock/i;

test("the browser gets what the page reads and none of the workings", () => {
  const slim = toClientResponse(full);
  for (const key of ["success", "analysis", "strengths", "weaknesses", "cleanChart", "entitlement", "savedToJournal", "setupQuality"]) {
    assert.deepEqual(slim[key], full[key]);
  }
  assert.equal(slim.chartContextCheck.status, "Reviewed");
  assert.equal(slim.dashboard.scoreContext.tradeVisible, false);
  assert.equal(slim.finalFeedback.analysis, "x");
  assert.equal(slim.chartDetection.latestVisibleTime, "21:00");
  assert.doesNotMatch(JSON.stringify(slim), leaks);
  assert.equal(full.chartContextCheck.visibleMarkedLevels.length, 1); // the full response is not changed
});

test("a field nobody listed is not sent", () => {
  assert.equal("somethingNew" in toClientResponse({ success: true, somethingNew: 1 }), false);
});

test("the saved journal record keeps what the journal shows and nothing else", () => {
  const record = toJournalRecord({
    analysis: "x",
    cleanChart: full.cleanChart,
    chartDetection: full.chartDetection,
    visualReview: full.visualReview,
    marketReference: full.marketReference,
    dateDecision: {},
    dashboard: { mistakes: ["m"], weaknesses: ["b"], scoreContext: { riskBasis: "none" }, contextCheck: context },
  });
  assert.deepEqual(record.dashboard.mistakes, ["m"]);
  assert.equal(record.dashboard.scoreContext.riskBasis, "none");
  assert.equal(record.chartDetection.latestVisibleTime, "21:00");
  assert.deepEqual(record.cleanChart, full.cleanChart);
  assert.doesNotMatch(JSON.stringify(record), leaks);
});

test("the server uses it for both replies and the journal, with an off switch and the benchmark left whole", () => {
  const server = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.equal(slimResponseEnabled("off"), false);
  assert.equal(slimResponseEnabled(undefined), true);
  assert.match(server, /slimResponseEnabled\(\) && !benchmarkDryRun \? toClientResponse\(finalClientResponse\) : finalClientResponse/);
  assert.match(server, /slimResponseEnabled\(\) && !benchmarkDryRun \? toClientResponse\(cachedCompletedAnalysis\) : cachedCompletedAnalysis/);
  assert.match(server, /slim \? toJournalRecord\(fullAiResponse\) : fullAiResponse/);
  assert.match(server, /key_areas_of_interest: slim \? \[\] : keyAreas/);
  assert.doesNotMatch(server, /setup review completed using \$\{structureLabel\}/);
});
