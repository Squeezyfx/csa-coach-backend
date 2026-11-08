import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessTradePillars, compilePillarItems } from "../trade-pillars.js";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

const levels = (prices) => ({ structuralCandidates: prices.map((price) => ({ price })) });
const area = { direction: "buy", authoritativeCenter: 1.34475, zoneLow: 1.34475, zoneHigh: 1.34475 };
const facts = (extra = {}) => ({
  instrument: "GBPUSD",
  direction: "bullish",
  analysisType: "pre-trade",
  trade: { visible: false },
  executedOrder: null,
  risk: { stopShown: false, targetShown: false },
  volatility: { avgRange: 0.0012 },
  currentPrice: 1.3488,
  selectorDiagnostics: { ...levels([1.34475, 1.34318, 1.34055, 1.35023]), fibonacci: { swingHigh: 1.35023, swingLow: 1.33782 } },
  ...extra,
});
const weaknessTexts = (result) => compilePillarItems(result.weaknesses, { perPillar: 9, limit: 99 });
const assess = (f) => assessTradePillars({ facts: f, area, hasValidatedArea: true });

test("Pre-trade with nothing entered: no stop, take profit, risk or management weakness", () => {
  const weaknesses = weaknessTexts(assess(facts()));
  for (const pillar of ["Exit:", "Risk:", "Trade management:"]) {
    assert.ok(!weaknesses.some((text) => text.startsWith(pillar)), `no ${pillar} weakness`);
  }
});

test("the same chart in Post-trade is still told what is missing", () => {
  const weaknesses = weaknessTexts(assess(facts({ analysisType: "post-trade" })));
  assert.ok(weaknesses.some((text) => text.startsWith("Exit: No stop loss or take profit is marked")));
  assert.ok(weaknesses.some((text) => text.startsWith("Risk: Risk can't be checked yet")));
  assert.ok(weaknesses.some((text) => text.startsWith("Trade management:")));
});

test("what to do is still in Next action, so nothing is lost", () => {
  const { next } = assess(facts());
  assert.match(next.exit, /stop loss/i);
  assert.match(next.risk, /Add your account balance and lot size|risk/i);
  assert.match(next.management, /Plan ahead/);
});

test("a stop or take profit the trader did enter is still judged", () => {
  const wrongSide = assess(facts({ plannedTrade: { entry: null, stop: 1.35, target: null } }));
  assert.ok(weaknessTexts(wrongSide).some((text) => text.startsWith("Exit:") || text.startsWith("Risk:")));
});

test("a placed trade with no stop is still a weakness, even in Pre-trade mode", () => {
  const placed = facts({
    trade: { visible: true },
    executedOrder: { ticket: "1", direction: "buy", entryPrice: 1.3447, stopPrice: null },
  });
  const weaknesses = weaknessTexts(assess(placed));
  assert.ok(weaknesses.some((text) => /stop loss/i.test(text)));
});

test("real risk problems are still flagged: a typed lot size that is too large", () => {
  const big = assess(facts({ riskInputs: { balance: 1000, lots: 2 } }));
  assert.ok(weaknessTexts(big).some((text) => text.startsWith("Risk:")));
});

test("the review says plainly what is not applicable yet, only for a Pre-trade plan with nothing entered", () => {
  assert.match(server, /not applicable yet, because no trade or plan has been entered\. Suggested ones are under Next action\./);
  const start = server.indexOf('"- Stop loss, take profit, risk and trade management: not applicable yet');
  const guard = server.slice(start - 600, start);
  assert.match(guard, /facts\?\.analysisType === "pre-trade"/);
  assert.match(guard, /!hasExecutedOrder/);
  assert.match(guard, /!\(Number\(facts\?\.plannedTrade\?\.stop\) > 0\)/);
  assert.match(guard, /!facts\?\.risk\?\.stopShown/);
});
