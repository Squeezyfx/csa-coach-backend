import test from "node:test";
import assert from "node:assert/strict";
import {
  assessTradePillars,
  compilePillarItems,
  buildPillarNextSteps,
  detectEntryTrigger,
  priceDistance,
  scoreFromSignals,
} from "../trade-pillars.js";

const levels = (prices) => ({ structuralCandidates: prices.map((price) => ({ price })) });

// The real EURUSD H1 sell that exposed the original gaps: entry 1.13640,
// stop loss 1.13890, no take profit, price now 1.13354.
const eurusdSell = () => ({
  instrument: "EURUSD",
  direction: "bearish",
  trade: { visible: true },
  executedOrder: { ticket: "44111581", direction: "sell", entryPrice: 1.1364, stopPrice: 1.1389 },
  currentPrice: 1.13354,
  risk: { stopShown: true, targetShown: false },
  selectorDiagnostics: levels([1.13907, 1.13524, 1.13714, 1.1311]),
  entryTrigger: { found: false, candlesChecked: 48 },
});
const eurusdArea = { direction: "sell", authoritativeCenter: 1.13524 };

const run = (facts, area, hasValidatedArea = true) => {
  const result = assessTradePillars({ facts, area, hasValidatedArea });
  return {
    strengths: compilePillarItems(result.strengths),
    weaknesses: compilePillarItems(result.weaknesses),
    next: result.next,
  };
};

const has = (list, text) => list.some((item) => item.includes(text));

test("a visible sell is reviewed against all five pillars", () => {
  const { strengths, weaknesses, next } = run(eurusdSell(), eurusdArea);

  assert.ok(has(strengths, "Entry area: Your sell matches the bearish trend"));
  assert.ok(has(strengths, "beat the planned level"));
  assert.ok(has(strengths, "Exit: Stop loss at 1.13890 sits above the nearest key high"));
  assert.ok(has(strengths, "Trade management: In profit by 29 pips"));

  assert.ok(has(weaknesses, "Entry trigger: No clear trigger candle"));
  assert.ok(has(weaknesses, "Exit: No take profit marked"));
  assert.ok(has(weaknesses, "Risk: Risking 25 pips"));

  assert.match(next.exit, /next key low \(1\.13110\)/);
  assert.match(next.management, /breakeven/);
});

test("stop loss and take profit give a risk-to-reward verdict", () => {
  const facts = eurusdSell();
  facts.executedOrder.targetPrice = 1.1264;
  facts.risk.targetShown = true;
  const { strengths } = run(facts, eurusdArea);
  assert.ok(has(strengths, "Risk: Risking 25 pips to make 100 pips (4.0 times your risk)"));

  facts.executedOrder.targetPrice = 1.1355;
  const thin = run(facts, eurusdArea);
  assert.ok(has(thin.weaknesses, "Risk: Risking 25 pips to make 9 pips"));
});

test("a stop loss placed before the nearest key level is flagged", () => {
  const facts = eurusdSell();
  facts.executedOrder.stopPrice = 1.1368;
  const { weaknesses, next } = run(facts, eurusdArea);
  assert.ok(has(weaknesses, "Exit: Stop loss at 1.13680 sits before the nearest key high"));
  assert.match(next.exit, /just beyond the key high \(1\.13714\)/);
});

test("trading against the trend is a weakness", () => {
  const facts = eurusdSell();
  facts.direction = "bullish";
  const { weaknesses } = run(facts, eurusdArea);
  assert.ok(has(weaknesses, "Your sell goes against the bullish trend"));
});

test("a losing trade says how far it is from the stop and not to widen it", () => {
  const facts = eurusdSell();
  facts.currentPrice = 1.1377;
  const { weaknesses, next } = run(facts, eurusdArea);
  assert.ok(has(weaknesses, "Trade management: Against you by 13 pips (52% of the way to your stop)"));
  assert.match(next.management, /do not move it further away/);
});

test("a stop moved to the entry price is credited as breakeven management", () => {
  const facts = eurusdSell();
  facts.executedOrder.stopPrice = 1.1364;
  const { strengths } = run(facts, eurusdArea);
  assert.ok(has(strengths, "Stop moved to breakeven"));
});

test("with no stop loss, management advice starts with adding one", () => {
  const facts = eurusdSell();
  delete facts.executedOrder.stopPrice;
  facts.risk.stopShown = false;
  const { weaknesses, next } = run(facts, eurusdArea);
  assert.ok(has(weaknesses, "Exit: No stop loss or take profit marked"));
  assert.match(next.management, /^First add a stop loss/);
});

test("with no placed trade the five pillars become a plan", () => {
  const facts = {
    instrument: "EURUSD",
    direction: "bearish",
    trade: { visible: false },
    executedOrder: null,
    risk: { stopShown: false, targetShown: false },
    selectorDiagnostics: levels([1.139, 1.1352, 1.1311]),
  };
  const { strengths, weaknesses, next } = run(facts, eurusdArea);
  assert.deepEqual(strengths, []);
  assert.deepEqual(weaknesses, []);
  assert.match(next.trigger, /bearish engulfing candle/);
  assert.match(next.exit, /take profit at the next key low \(1\.13110\)/);
  assert.match(next.risk, /1\.5 to 2 times more reward than risk/);
  assert.match(next.management, /partial close/);
});

test("pillar items are ordered, capped per pillar, labelled and de-duplicated", () => {
  const items = [
    { pillar: "management", text: "M1." },
    { pillar: "entry", text: "E2.", priority: 1 },
    { pillar: "entry", text: "E1.", priority: 0 },
    { pillar: "entry", text: "E3.", priority: 1 },
    { pillar: "entry", text: "E1.", priority: 0 },
    { pillar: "exit", text: "X1.", why: "Because." },
  ];
  assert.deepEqual(compilePillarItems(items), [
    "Entry area: E1.",
    "Entry area: E2.",
    "Exit: X1.",
    "Trade management: M1.",
  ]);
  assert.equal(compilePillarItems(items, { withWhy: true })[2], "Exit: X1. Because.");
});

test("next steps give one bullet per pillar", () => {
  const steps = buildPillarNextSteps({
    entryPlan: "Plan.",
    next: { trigger: "T.", exit: "X.", risk: "R.", management: "M." },
  });
  assert.deepEqual(steps, [
    "Entry area: Plan.",
    "Entry trigger: T.",
    "Exit: X.",
    "Risk: R.",
    "Trade management: M.",
  ]);
});

test("distances are pips for FX pairs and points for everything else", () => {
  assert.equal(priceDistance(0.0025, "EURUSD").text, "25 pips");
  assert.equal(priceDistance(0.5, "USDJPY").text, "50 pips");
  assert.equal(priceDistance(10, "XAUUSD").text, "10 points");
});

const candle = (datetime, open, high, low, close) => ({ datetime, open, high, low, close });
const filler = () =>
  Array.from({ length: 10 }, (_, i) =>
    candle(`2026-09-29 ${String(i).padStart(2, "0")}:00:00`, 1.132, 1.1325, 1.1315, 1.132)
  );

test("a rejection candle at the entry level is detected for a sell", () => {
  const candles = [
    ...filler(),
    // long upper wick into 1.1364, closes back near the low
    candle("2026-09-29 10:00:00", 1.1352, 1.1365, 1.1349, 1.1351),
    candle("2026-09-29 11:00:00", 1.1351, 1.1353, 1.1344, 1.1346),
  ];
  const result = detectEntryTrigger({ candles, price: 1.1364, direction: "sell" });
  assert.equal(result.found, true);
  assert.equal(result.type, "rejection");
});

test("an engulfing candle at the entry level is detected for a buy", () => {
  const candles = [
    ...filler(),
    candle("2026-09-29 10:00:00", 1.1366, 1.1368, 1.1358, 1.1361),
    candle("2026-09-29 11:00:00", 1.136, 1.1372, 1.1359, 1.1371),
  ];
  const result = detectEntryTrigger({ candles, price: 1.1361, direction: "buy" });
  assert.equal(result.found, true);
  assert.equal(result.type, "engulfing");
});

test("no trigger is reported when price never reached the entry level", () => {
  const result = detectEntryTrigger({ candles: filler(), price: 1.1364, direction: "sell" });
  assert.equal(result.found, false);
  assert.equal(result.candlesChecked, 10);
});

test("too few candles gives no verdict either way", () => {
  const result = detectEntryTrigger({ candles: filler().slice(0, 3), price: 1.1364, direction: "sell" });
  assert.equal(result.found, false);
  assert.equal(result.candlesChecked, 3);
});

test("summary boxes get short headlines while coaching keeps the full bullets", () => {
  const facts = eurusdSell();
  facts.entryTrigger = { found: true, type: "engulfing", candlesChecked: 48 };
  const result = assessTradePillars({ facts, area: eurusdArea, hasValidatedArea: true });

  const shortStrengths = compilePillarItems(result.strengths, { short: true });
  assert.deepEqual(shortStrengths, [
    "Entry area: With the trend",
    "Entry area: Better price than planned",
    "Entry trigger: Trigger candle at your entry",
    "Exit: Stop beyond a key level",
    "Trade management: In profit (29 pips)",
  ]);

  const shortWeaknesses = compilePillarItems(result.weaknesses, { short: true });
  assert.deepEqual(shortWeaknesses, ["Exit: No take profit", "Risk: Reward unknown (no target)"]);

  const full = compilePillarItems(result.strengths);
  assert.ok(full.every((line, index) => line !== shortStrengths[index]));
});

test("a placed trade exposes the signals its score is built from", () => {
  const { signals } = assessTradePillars({ facts: eurusdSell(), area: eurusdArea, hasValidatedArea: true });
  assert.deepEqual(signals, {
    trend: "with",
    plan: "better",
    trigger: "missing",
    stop: "beyond",
    target: "none",
    rr: null,
  });

  const plan = assessTradePillars({
    facts: { instrument: "EURUSD", direction: "bearish", trade: { visible: false }, executedOrder: null, risk: {} },
    area: eurusdArea,
    hasValidatedArea: true,
  });
  assert.equal(plan.signals, null);
  assert.equal(scoreFromSignals(plan.signals), null);
});

test("entry and risk scores follow the pillar findings", () => {
  const strong = scoreFromSignals({
    trend: "with",
    plan: "better",
    trigger: "found",
    stop: "beyond",
    target: "none",
    rr: null,
  });
  assert.equal(strong.entry, 90);
  assert.equal(strong.risk, 65);
  assert.equal(strong.entrySummary, "Strong entry: with the trend, at a good price, with a trigger candle.");
  assert.equal(strong.riskSummary, "Partly covered: stop placed beyond a key level, but no take profit.");

  const weak = scoreFromSignals({
    trend: "against",
    plan: "early",
    trigger: "missing",
    stop: "none",
    target: "none",
    rr: null,
  });
  assert.equal(weak.entry, 20);
  assert.equal(weak.risk, 30);
  assert.equal(weak.riskSummary, "Weak risk plan: no stop loss, no take profit.");

  const full = scoreFromSignals({
    trend: "with",
    plan: "close",
    trigger: "found",
    stop: "beyond",
    target: "ok",
    rr: 2.5,
  });
  assert.equal(full.risk, 95);
  assert.ok(full.risk > strong.risk && strong.risk > weak.risk);
});
