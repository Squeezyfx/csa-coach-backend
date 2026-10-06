import test from "node:test";
import assert from "node:assert/strict";
import {
  assessTradePillars,
  compilePillarItems,
  buildPillarNextSteps,
  detectEntryTrigger,
  priceDistance,
  scoreFromSignals,
  estimateRiskUsd,
  collectStructuralLevels,
  averageCandleRange,
  typicalSpread,
  minimumStopFloor,
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
  assert.match(next.exit, /Take profit: the next key low at 1\.13110/);
  assert.match(next.risk, /1\.5 times/);
  assert.match(next.management, /partial close/);
});

test("a plan names where the stop loss and take profit would go, and what that risks", () => {
  const facts = {
    instrument: "EURUSD",
    direction: "bearish",
    trade: { visible: false },
    executedOrder: null,
    risk: { stopShown: false, targetShown: false },
    selectorDiagnostics: levels([1.13907, 1.13524, 1.13714, 1.1311]),
  };
  const { next } = run(facts, eurusdArea);
  assert.equal(
    next.exit,
    "Stop loss: just above the key high at 1.13714, with room for the spread. Take profit: the next key low at 1.13110."
  );
  assert.match(next.risk, /risk 20 pips to make 41 pips \(2\.1 times your risk\)\. That meets the 1\.5 to 2 times rule\./);

  const buyFacts = {
    ...facts,
    direction: "bullish",
    selectorDiagnostics: levels([1.1, 1.1052, 1.11, 1.12]),
  };
  const buy = run(buyFacts, { direction: "buy", authoritativeCenter: 1.1052 });
  assert.match(buy.next.exit, /^Stop loss: just below the key low at 1\.10000, with room for the spread\./);
  assert.match(buy.next.exit, /Take profit: the next key high at 1\.11000\./);
  assert.match(buy.next.risk, /under 1\.5 times/);
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
  assert.deepEqual(shortWeaknesses, [
    "Exit: No take profit",
    "Risk: Reward unknown (no target)",
    "Risk: Risk per trade unknown",
  ]);

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

const withRiskInputs = (facts, balance, lots) => ({ ...facts, riskInputs: { balance, lots } });

test("risk per trade is called out as unknown when balance and lot size are missing", () => {
  const { weaknesses, next } = run(eurusdSell(), eurusdArea);
  assert.ok(has(weaknesses, "Risk: Risk per trade is unknown."));
  assert.match(next.risk, /Add your account balance and lot size/);

  const plan = run(
    {
      instrument: "EURUSD",
      direction: "bearish",
      trade: { visible: false },
      executedOrder: null,
      risk: {},
      selectorDiagnostics: levels([1.13907, 1.13524, 1.13714, 1.1311]),
    },
    eurusdArea
  );
  assert.match(plan.next.risk, /Add your account balance and lot size/);
  assert.deepEqual(plan.weaknesses, []);
});

test("account risk is worked out from balance, lot size and stop distance", () => {
  // 25 pip stop, 0.1 lot on EURUSD = $25 risked. On $10,000 that is 0.25%.
  const small = run(withRiskInputs(eurusdSell(), 10000, 0.1), eurusdArea);
  assert.ok(has(small.strengths, "Risk: Risking $25 (0.3% of your account). That is a sensible size."));
  assert.ok(!has(small.weaknesses, "Risk per trade"));
  assert.match(small.next.risk, /^Keep your risk at 2% or less per trade\./);

  // 25 pips x 1 lot = $250 on $5,000 = 5%.
  const high = run(withRiskInputs(eurusdSell(), 5000, 1), eurusdArea);
  assert.ok(has(high.weaknesses, "Risking $250 (5% of your account). That is on the high side."));
  assert.match(high.next.risk, /Cut your lot size to about 0\.20 to risk about 1%\./);
});

test("a risk of 50% of the account triggers a fast-depletion warning", () => {
  // 25 pips x 2 lots = $500 on $1,000 = 50%.
  const result = assessTradePillars({
    facts: withRiskInputs(eurusdSell(), 1000, 2),
    area: eurusdArea,
    hasValidatedArea: true,
  });
  const weaknesses = compilePillarItems(result.weaknesses, { withWhy: true });
  assert.ok(has(weaknesses, "Risking $500 (50% of your account). That is far too high."));
  assert.ok(has(weaknesses, "wiped out fast: one loss could cost half of it or more"));
  assert.equal(result.signals.riskPct, 50);
  assert.deepEqual(compilePillarItems(result.weaknesses, { short: true }).filter((l) => l.startsWith("Risk")), [
    "Risk: Risk far too high (50%)",
    "Risk: Reward unknown (no target)",
  ]);

  // 25 pips x 0.5 lot = $125 on $1,000 = 12.5%: depletion measured in losses.
  const twelve = run(withRiskInputs(eurusdSell(), 1000, 0.5), eurusdArea);
  assert.ok(has(twelve.weaknesses, "far too high"));
  const full = assessTradePillars({ facts: withRiskInputs(eurusdSell(), 1000, 0.5), area: eurusdArea, hasValidatedArea: true });
  assert.ok(has(compilePillarItems(full.weaknesses, { withWhy: true }), "just 6 losses in a row"));
});

test("risk estimates cover USD-quoted, USD-based, gold and cross pairs", () => {
  const usdQuoted = estimateRiskUsd({ symbol: "GBPUSD", lots: 1, distance: 0.005, price: 1.3 });
  assert.equal(Math.round(usdQuoted.amount), 500);
  assert.equal(usdQuoted.approx, false);

  const usdBase = estimateRiskUsd({ symbol: "USDJPY", lots: 1, distance: 0.5, price: 150 });
  assert.equal(Math.round(usdBase.amount), 333);

  const gold = estimateRiskUsd({ symbol: "XAUUSD", lots: 0.1, distance: 10, price: 2000 });
  assert.equal(Math.round(gold.amount), 100);

  const cross = estimateRiskUsd({ symbol: "EURGBP", lots: 1, distance: 0.0020, price: 0.85 });
  assert.equal(cross.approx, true);

  assert.equal(estimateRiskUsd({ symbol: "US30", lots: 1, distance: 50, price: 40000 }), null);
});

test("an unreadable account size means the risk stays unknown", () => {
  const result = run(withRiskInputs(eurusdSell(), 10000, null), eurusdArea);
  assert.ok(has(result.weaknesses, "Risk per trade is unknown"));
});

test("account risk feeds the risk score and its summary", () => {
  const base = { trend: "with", plan: "better", trigger: "found", stop: "beyond", target: "none", rr: null };
  const safe = scoreFromSignals({ ...base, riskPct: 1 });
  const none = scoreFromSignals(base);
  const reckless = scoreFromSignals({ ...base, riskPct: 50 });
  assert.equal(safe.risk, none.risk + 5);
  assert.equal(reckless.risk, none.risk - 35);
  assert.match(reckless.riskSummary, /risking 50% of the account/);
});

test("a planned trade shows what the planned stop would risk", () => {
  const facts = {
    instrument: "EURUSD",
    direction: "bearish",
    trade: { visible: false },
    executedOrder: null,
    risk: {},
    riskInputs: { balance: 1000, lots: 1 },
    selectorDiagnostics: levels([1.13907, 1.13524, 1.13714, 1.1311]),
  };
  const result = assessTradePillars({ facts, area: eurusdArea, hasValidatedArea: true });
  // stop 19 pips away plus a 1-pip spread = 20 pips x 1 lot = $200 on $1,000 = 20%
  assert.match(result.next.risk, /At that stop, 1 lots would risk \$200 \(20% of your account\)\. That is far too high\./);
  assert.match(result.next.risk, /Cut your lot size to about 0\.05/);
  assert.ok(has(compilePillarItems(result.weaknesses), "Risk: At that stop"));
});

const withSwing = (facts, swingLow, swingHigh) => ({
  ...facts,
  selectorDiagnostics: { ...facts.selectorDiagnostics, fibonacci: { swingLow, swingHigh } },
});

const planFacts = (prices, direction = "bearish") => ({
  instrument: "EURUSD",
  direction,
  trade: { visible: false },
  executedOrder: null,
  risk: {},
  selectorDiagnostics: levels(prices),
});

test("a sell plan ends its take profits at the main swing low", () => {
  const facts = withSwing(planFacts([1.13907, 1.13524, 1.13714, 1.1311, 1.1286, 1.124]), 1.1215, 1.145);
  const { next } = run(facts, eurusdArea);
  assert.equal(
    next.exit,
    "Stop loss: just above the key high at 1.13714, with room for the spread. Take profits: TP1 1.13110, TP2 1.12400, final TP 1.12150 (the main swing low)."
  );
  assert.match(next.risk, /to make 137 pips at the final target \(6\.9 times your risk\)/);
});

test("a buy plan ends its take profits at the main swing high", () => {
  const facts = withSwing(planFacts([1.1, 1.1052, 1.1012, 1.1085], "bullish"), 1.09, 1.12);
  const { next } = run(facts, { direction: "buy", authoritativeCenter: 1.1052 });
  assert.match(next.exit, /^Stop loss: just below the key low at 1\.10120, with room for the spread\./);
  assert.match(next.exit, /Take profits: TP1 1\.10850, final TP 1\.12000 \(the main swing high\)\./);
});

test("with only the swing beyond the entry, the swing is the single take profit", () => {
  const facts = withSwing(planFacts([1.13907, 1.13524, 1.13714]), 1.1215, 1.145);
  const { next } = run(facts, eurusdArea);
  assert.match(next.exit, /Take profit: the main swing low at 1\.12150\./);
});

test("a swing on the wrong side of the entry is ignored", () => {
  // swing low sits above the entry, so it cannot be a sell target
  const facts = withSwing(planFacts([1.13907, 1.13524, 1.13714, 1.1311]), 1.14, 1.145);
  const { next } = run(facts, eurusdArea);
  assert.match(next.exit, /Take profit: the next key low at 1\.13110\./);
});

test("candidates reported as frameworkPrice are used as key levels and invalid ones are not", () => {
  const facts = {
    instrument: "EURUSD",
    direction: "bearish",
    trade: { visible: false },
    executedOrder: null,
    risk: {},
    selectorDiagnostics: {
      structuralCandidates: [
        { frameworkPrice: 1.1311, chartReconciledPrice: 1.13105, structurallyValid: true },
        { frameworkPrice: 1.1286, structurallyValid: false },
        { frameworkPrice: 1.13714, structurallyValid: true },
      ],
    },
  };
  assert.deepEqual(collectStructuralLevels(facts), [1.13105, 1.13714]);
  const { next } = run(facts, eurusdArea);
  assert.match(next.exit, /Take profit: the next key low at 1\.13105\./);
});

test("a take profit at the main swing is not marked down for passing a nearer level", () => {
  const facts = withSwing(eurusdSell(), 1.1215, 1.145);
  facts.executedOrder.targetPrice = 1.1225;
  facts.risk.targetShown = true;
  const result = run(facts, eurusdArea);
  assert.ok(has(result.strengths, "Take profit at 1.12250 sits at or before the main swing low (1.12150)."));
  assert.ok(!has(result.weaknesses, "Take profit at"));

  facts.executedOrder.targetPrice = 1.119;
  const beyond = run(facts, eurusdArea);
  assert.ok(has(beyond.weaknesses, "Take profit at 1.11900 is beyond the main swing low (1.12150)."));
});

test("a missing take profit is suggested as a ladder ending at the main swing", () => {
  const facts = withSwing(eurusdSell(), 1.1215, 1.145);
  facts.selectorDiagnostics = { ...facts.selectorDiagnostics, ...levels([1.13907, 1.13524, 1.13714, 1.1311, 1.1286]), fibonacci: { swingLow: 1.1215 } };
  const { next } = run(facts, eurusdArea);
  assert.match(next.exit, /Add take profits: TP1 1\.13110, TP2 1\.12860, final TP 1\.12150 \(the main swing low\)\./);
});

test("average candle range uses the latest candles and needs enough of them", () => {
  const candle = (n, range) => ({ datetime: `2026-09-${String(n).padStart(2, "0")} 00:00:00`, high: 1 + range, low: 1 });
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => candle(i + 1, 0.1)),
    ...Array.from({ length: 14 }, (_, i) => candle(i + 10, 0.002)),
  ];
  assert.ok(Math.abs(averageCandleRange(rows) - 0.002) < 1e-9);
  assert.equal(averageCandleRange(rows.slice(0, 3)), null);
  assert.equal(averageCandleRange([]), null);
});

const sellAreaFacts = (extra = {}) => ({
  instrument: "EURUSD",
  direction: "bearish",
  trade: { visible: false },
  executedOrder: null,
  risk: {},
  volatility: { avgRange: 0.001 },
  activeEntryAreas: [
    { direction: "sell", authoritativeCenter: 1.13097 },
    { direction: "sell", authoritativeCenter: 1.13227 },
  ],
  selectorDiagnostics: levels([1.13097, 1.13227, 1.1337, 1.12861]),
  ...extra,
});
const sellArea = { direction: "sell", authoritativeCenter: 1.13097, zoneLow: 1.13067, zoneHigh: 1.13127 };

test("the planned stop is not placed on the Backup entry and clears normal candle noise", () => {
  const { next } = run(sellAreaFacts(), sellArea);
  // 1.13227 is Entry 2, 1.1337 is beyond it: neither is a stop for Entry 1.
  assert.match(next.exit, /^Stop loss: about 1\.13207, past the entry zone, normal candle moves and the spread\./);
  assert.match(next.risk, /risk 11 pips to make/);
});

test("a key level that is far enough away is used for the stop", () => {
  const facts = sellAreaFacts({
    activeEntryAreas: [{ direction: "sell", authoritativeCenter: 1.13097 }],
    selectorDiagnostics: levels([1.13097, 1.13227, 1.1337, 1.12861]),
  });
  const { next } = run(facts, sellArea);
  // 1.13227 is now an ordinary key high 13 pips away (one candle is 10).
  assert.match(next.exit, /^Stop loss: just above the key high at 1\.13227, with room for the spread\./);
});

test("a stop is never tighter than one average candle, even on a daily chart", () => {
  const buyArea = { direction: "buy", authoritativeCenter: 0.80515, zoneLow: 0.80485, zoneHigh: 0.80545 };
  const facts = {
    instrument: "USDCHF",
    direction: "bullish",
    trade: { visible: false },
    executedOrder: null,
    risk: {},
    volatility: { avgRange: 0.006 },
    activeEntryAreas: [
      { direction: "buy", authoritativeCenter: 0.80515 },
      { direction: "buy", authoritativeCenter: 0.80419 },
    ],
    selectorDiagnostics: levels([0.80515, 0.80441, 0.80419, 0.80402, 0.796, 0.78, 0.814]),
  };
  const withLevel = run(facts, buyArea);
  assert.match(withLevel.next.exit, /^Stop loss: just below the key low at 0\.79600, with room for the spread\./);

  facts.selectorDiagnostics = levels([0.80515, 0.80441, 0.80419, 0.80402, 0.78, 0.814]);
  const synthetic = run(facts, buyArea);
  assert.match(synthetic.next.exit, /^Stop loss: about 0\.79905, past the entry zone/);
  assert.match(synthetic.next.risk, /risk 61 pips/);
});

test("a tiny five-minute range still gets a realistic stop with the spread added", () => {
  // AUDJPY M5: one candle is only 2.6 pips, but entry may be on a break or
  // close and the cross spread is about 2 pips, so the stop floor applies.
  const facts = {
    instrument: "AUDJPY",
    direction: "bearish",
    trade: { visible: false },
    executedOrder: null,
    risk: {},
    volatility: { avgRange: 0.026 },
    activeEntryAreas: [{ direction: "sell", authoritativeCenter: 109.886 }],
    selectorDiagnostics: {
      ...levels([109.886, 109.669, 108.88]),
      fibonacci: { swingLow: 108.694 },
    },
  };
  const { next } = run(facts, { direction: "sell", authoritativeCenter: 109.886 });
  assert.match(next.exit, /^Stop loss: about 109\.966, past the entry zone, normal candle moves and the spread\./);
  assert.match(next.risk, /risk 8 pips to make 119 pips at the final target/);
  assert.match(next.risk, /A ratio this high usually means a distant target/);
});

test("spread and stop floor are set per instrument", () => {
  assert.ok(Math.abs(typicalSpread("EURUSD") - 0.0001) < 1e-12);
  assert.ok(Math.abs(typicalSpread("EURGBP") - 0.0002) < 1e-12);
  assert.ok(Math.abs(typicalSpread("USDJPY") - 0.01) < 1e-12);
  assert.ok(Math.abs(typicalSpread("XAUUSD") - 0.3) < 1e-12);
  assert.equal(typicalSpread("US30"), 0);
  assert.ok(Math.abs(minimumStopFloor("EURUSD") - 0.0006) < 1e-12);
  assert.ok(Math.abs(minimumStopFloor("AUDJPY") - 0.06) < 1e-12);
  assert.equal(minimumStopFloor("XAUUSD"), 0);
});

test("the chart's last-price line is not treated as a key level", () => {
  // EURCHF W1: a reference "resistance" at exactly the close (0.93173).
  const facts = {
    instrument: "EURCHF",
    direction: "bullish",
    currentPrice: 0.93173,
    trade: { visible: false },
    executedOrder: null,
    risk: {},
    structuralReferenceAreas: [{ areaType: "resistance", authoritativeCenter: 0.93173 }],
    selectorDiagnostics: levels([0.9266, 0.93491, 0.9096]),
  };
  assert.deepEqual(collectStructuralLevels(facts), [0.9096, 0.9266, 0.93491]);

  const buy = run({ ...facts, selectorDiagnostics: { ...levels([0.9266, 0.93491, 0.9096]), fibonacci: { swingHigh: 0.9485 } } }, {
    direction: "buy",
    authoritativeCenter: 0.9266,
  });
  assert.match(buy.next.exit, /Take profits: TP1 0\.93491, final TP 0\.94850/);
  assert.ok(!buy.next.exit.includes("0.93173"));
});

test("a placed trade gets a one-place summary of entry, stop, target and where price is now", () => {
  const facts = eurusdSell();
  facts.executedOrder = { ticket: "1", direction: "sell", entryPrice: 1.13705, stopPrice: 1.13905 };
  facts.currentPrice = 1.124;
  const { snapshot } = assessTradePillars({ facts, area: eurusdArea, hasValidatedArea: true });
  assert.deepEqual(snapshot, [
    "Sell entered at 1.13705.",
    "Stop loss at 1.13905, 20 pips from your entry.",
    "No take profit marked.",
    "Price is now 1.12400: 130 pips in profit (6.5 times your risk).",
    "Your stop loss is 150 pips from the current price.",
  ]);
});

test("the trade summary covers a losing trade, a moved stop and a take profit", () => {
  const losing = eurusdSell();
  losing.currentPrice = 1.1377;
  losing.executedOrder.targetPrice = 1.1264;
  const a = assessTradePillars({ facts: losing, area: eurusdArea, hasValidatedArea: true }).snapshot;
  assert.ok(a.includes("Price is now 1.13770: 13 pips against you (52% of the way to your stop)."));
  assert.ok(a.includes("Take profit at 1.12640, 100 pips from your entry (4.0 times your risk)."));
  assert.ok(a.includes("Your take profit is 113 pips from the current price."));

  const breakeven = eurusdSell();
  breakeven.executedOrder.stopPrice = 1.1364;
  const b = assessTradePillars({ facts: breakeven, area: eurusdArea, hasValidatedArea: true }).snapshot;
  assert.ok(b.includes("Stop loss is at your entry price (breakeven), so this trade can't lose."));

  const noStop = eurusdSell();
  delete noStop.executedOrder.stopPrice;
  noStop.risk.stopShown = false;
  const c = assessTradePillars({ facts: noStop, area: eurusdArea, hasValidatedArea: true }).snapshot;
  assert.ok(c.includes("No stop loss marked."));
});

test("a plan with no placed trade has no trade summary", () => {
  const { snapshot } = assessTradePillars({
    facts: { instrument: "EURUSD", direction: "bearish", trade: { visible: false }, executedOrder: null, risk: {} },
    area: eurusdArea,
    hasValidatedArea: true,
  });
  assert.deepEqual(snapshot, []);
});

test("a placed trade's mistakes are listed worst first in the hub's own words", () => {
  const facts = eurusdSell();
  facts.entryTrigger = { found: false, candlesChecked: 48 };
  const { mistakes } = assessTradePillars({ facts, area: eurusdArea, hasValidatedArea: true });
  assert.deepEqual(
    mistakes.map((m) => m.title),
    ["Failed to wait for confirmation", "No take profit"]
  );

  const bad = eurusdSell();
  bad.direction = "bullish";
  delete bad.executedOrder.stopPrice;
  bad.risk.stopShown = false;
  const worst = assessTradePillars({ facts: bad, area: eurusdArea, hasValidatedArea: true }).mistakes;
  assert.deepEqual(
    worst.map((m) => `${m.title}|${m.severity}`),
    [
      "No stop loss|HIGH RISK",
      "Traded against the trend|HIGH RISK",
      "Failed to wait for confirmation|DISCIPLINE",
      "No take profit|WARNING",
    ]
  );

  const clean = eurusdSell();
  clean.entryTrigger = { found: true, type: "engulfing", candlesChecked: 48 };
  clean.executedOrder.targetPrice = 1.1264;
  clean.risk.targetShown = true;
  assert.deepEqual(assessTradePillars({ facts: clean, area: eurusdArea, hasValidatedArea: true }).mistakes, []);

  const plan = assessTradePillars({
    facts: { instrument: "EURUSD", direction: "bearish", trade: { visible: false }, executedOrder: null, risk: {} },
    area: eurusdArea,
    hasValidatedArea: true,
  });
  assert.deepEqual(plan.mistakes, []);
});

// ---------------------------------------------------------------- planned trade
// Pre-trade mode: the trader types the entry, stop loss and take profit they are
// thinking of; each is judged on its own, and the plan says when to walk away.

const planned = (entry, stop, target, extra = {}) =>
  withSwing(
    sellAreaFacts({ analysisType: "pre-trade", currentPrice: 1.1285, plannedTrade: { entry, stop, target }, ...extra }),
    1.1215,
    1.145
  );

const assess = (facts) => assessTradePillars({ facts, area: sellArea, hasValidatedArea: true });

test("a planned sell with a sound entry, stop and target is praised and summarised", () => {
  const result = assess(planned(1.131, 1.134, 1.124));
  const strengths = compilePillarItems(result.strengths);
  assert.ok(has(strengths, "Planned entry at 1.13100 is right at the Entry 1 area (1.13097)."));
  assert.ok(has(strengths, "Planned stop at 1.13400 sits above the nearest key high (1.13370)."));
  assert.ok(has(strengths, "Planned take profit at 1.12400 sits at or before the main swing low (1.12150)."));
  assert.ok(has(strengths, "Planned risk 30 pips to make 70 pips (2.3 times your risk)."));
  assert.equal(result.next.exit, "Keep your planned stop where it is. Keep your planned take profit.");
  assert.equal(result.snapshotTitle, "YOUR PLANNED TRADE:");
  assert.deepEqual(result.snapshot, [
    "Planned sell at 1.13100.",
    "Stop loss at 1.13400, 30 pips from your entry.",
    "Take profit at 1.12400, 70 pips from your entry (2.3 times your risk).",
    "Price is now 1.12850, 25 pips below your entry.",
  ]);
  assert.deepEqual(result.mistakes, []);
});

test("a stop that is too tight for the candles and the spread is called out", () => {
  const result = assess(planned(1.131, 1.1315, 1.124));
  const weaknesses = compilePillarItems(result.weaknesses);
  assert.ok(has(weaknesses, "Planned stop is only 5 pips from your entry, inside normal candle movement and the spread."));
  assert.match(result.next.exit, /^Widen your stop to about 1\.13210 or further\./);
});

test("a stop before the nearest key level and a thin reward are flagged", () => {
  const result = assess(planned(1.131, 1.1335, 1.1275));
  const weaknesses = compilePillarItems(result.weaknesses);
  assert.ok(has(weaknesses, "Planned stop at 1.13350 sits before the nearest key high (1.13370)."));
  assert.ok(has(weaknesses, "Planned reward is only 1.4 times your risk (25 pips risked, 35 pips to gain)."));
  assert.match(result.next.exit, /Move your stop just beyond the key high \(1\.13370\)\./);
});

test("a stop or target on the wrong side of the entry is flagged, not graded", () => {
  // both below the entry: contradictory, so the chart's sell direction decides
  const result = assess(planned(1.131, 1.128, 1.124));
  const weaknesses = compilePillarItems(result.weaknesses);
  assert.ok(has(weaknesses, "Planned stop at 1.12800 is not above your entry (1.13100), so it would not protect a sell."));
  assert.match(result.next.exit, /^Put your stop just above the key high/);
  assert.ok(has(compilePillarItems(result.strengths), "Planned take profit at 1.12400"));
});

test("an entry before the area, or beyond it, is explained", () => {
  const before = assess(planned(1.1295, 1.134, 1.124));
  assert.ok(has(compilePillarItems(before.weaknesses), "Planned entry at 1.12950 comes before price reaches the Entry 1 area (1.13097)."));
  const beyond = assess(planned(1.1316, 1.1355, 1.124));
  assert.ok(has(compilePillarItems(beyond.weaknesses), "Planned entry at 1.13160 is beyond the Entry 1 area (1.13097), so price may turn before it fills."));
});

test("a planned buy against the bearish trend is flagged", () => {
  const result = assess(planned(1.131, 1.128, 1.1215 + 0.03));
  const weaknesses = compilePillarItems(result.weaknesses);
  assert.ok(has(weaknesses, "Your planned buy goes against the bearish trend."));
});

test("only the entry typed: the stop and take profits are suggested from that entry", () => {
  const result = assess(planned(1.131, null, null));
  assert.match(result.next.exit, /^Stop loss: about 1\.13210, past the entry zone/);
  assert.match(result.next.exit, /Take profits: .*final TP 1\.12150 \(the main swing low\)\./);
  assert.deepEqual(result.snapshot.slice(0, 3), [
    "Planned sell at 1.13100.",
    "No stop loss entered yet.",
    "No take profit entered yet.",
  ]);
});

test("prices that do not look like this chart are set aside and the trader told", () => {
  const result = assess(planned(113.1, 113.4, 112.4));
  const weaknesses = compilePillarItems(result.weaknesses);
  assert.ok(has(weaknesses, "The prices you entered don't look like this chart (price is about 1.12850)."));
  assert.deepEqual(result.snapshot, []);
  assert.match(result.next.exit, /^Stop loss: about 1\.13207/);
});

test("the risk of a planned stop uses the balance and lot size typed in", () => {
  const facts = planned(1.131, 1.134, 1.124, { riskInputs: { balance: 1000, lots: 0.1 } });
  const result = assess(facts);
  assert.ok(has(compilePillarItems(result.weaknesses), "At that stop, 0.1 lots would risk $30 (3% of your account). That is on the high side."));
  assert.match(result.next.risk, /At that stop, 0\.1 lots would risk \$30 \(3% of your account\)/);
});

test("a pre-trade plan says when it is cancelled and that it is not a signal", () => {
  const result = assess(planned(1.131, 1.134, 1.124));
  assert.match(result.next.cancel, /^If a candle closes above 1\.13210, this sell idea is wrong\./);
  assert.match(result.next.cancel, /Skip it too if price reaches 1\.12861 \(your first take profit\) before your entry fills\./);
  assert.match(result.next.cancel, /stand aside and wait for a fresh setup\.$/);
  assert.match(result.next.note, /not a signal to trade/);
  const steps = buildPillarNextSteps({ entryPlan: "Wait.", next: result.next });
  assert.match(steps[steps.length - 2], /^Cancel the idea: If a candle closes above/);
  assert.match(steps[steps.length - 1], /^Remember: This is a plan to prepare with, not a signal/);

  // the unmarked chart in Pre-trade mode gets the same two lines
  const bare = assess(sellAreaFacts({ analysisType: "pre-trade" }));
  assert.match(bare.next.cancel, /^If a candle closes above/);

  // a post-trade review of a chart with no trade keeps its old output
  const post = assess(sellAreaFacts({ analysisType: "post-trade" }));
  assert.equal(post.next.cancel, "");
  assert.equal(post.next.note, "");
});

test("a placed trade ignores any typed plan", () => {
  const facts = { ...eurusdSell(), analysisType: "pre-trade", plannedTrade: { entry: 1.2, stop: 1.3, target: 1.1 } };
  const result = assessTradePillars({ facts, area: eurusdArea, hasValidatedArea: true });
  assert.equal(result.snapshotTitle, "YOUR TRADE SO FAR:");
  assert.equal(result.next.cancel, "");
});
