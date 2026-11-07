import test from "node:test";
import assert from "node:assert/strict";
import { assessTradePillars } from "../trade-pillars.js";
import { buildCleanChart } from "../clean-chart.js";

const levels = (prices) => ({ structuralCandidates: prices.map((price) => ({ price })) });
const assess = (facts, area) => assessTradePillars({ facts, area, hasValidatedArea: true });

// GBPUSD H1 reviewed at 2026-11-05 06:00: bullish, Entry 1 = Monday's high 1.34475 and Entry 2 = Tuesday's high
// 1.34318 (both converted support), final target Wednesday's high 1.35023. The average candle (0.0012) is assumed.
const gbpusd = (extra = {}) => ({
  instrument: "GBPUSD",
  direction: "bullish",
  analysisType: "pre-trade",
  trade: { visible: false },
  executedOrder: null,
  risk: {},
  volatility: { avgRange: 0.0012 },
  currentPrice: 1.3488,
  activeEntryAreas: [
    { direction: "buy", authoritativeCenter: 1.34475, rank: 1 },
    { direction: "buy", authoritativeCenter: 1.34318, rank: 2 },
  ],
  selectorDiagnostics: { ...levels([1.34475, 1.34318, 1.34055, 1.33951, 1.33782, 1.35023]), fibonacci: { swingHigh: 1.35023, swingLow: 1.33782 } },
  ...extra,
});
const entry1 = { direction: "buy", authoritativeCenter: 1.34475, zoneLow: 1.34475, zoneHigh: 1.34475 };

test("with two entries each one gets its own stop, named in the exit text", () => {
  const { next } = assess(gbpusd(), entry1);
  assert.match(next.exit, /^Entry 1 stop loss: about 1\.34345, past the entry zone, normal candle moves and the spread\./);
  assert.match(next.exit, /Entry 2 stop loss: just below the key low at 1\.34055, with room for the spread\./);
  assert.match(next.exit, /Take profit: the main swing high at 1\.35023\./);
});

test("the stops are drawn in the geometry: Entry 2's sits beyond Entry 2 and below Entry 1's", () => {
  const { geometry } = assess(gbpusd(), entry1);
  assert.equal(geometry.backups.length, 1);
  const backup = geometry.backups[0];
  assert.equal(backup.order, 2);
  assert.equal(backup.entry, 1.34318);
  assert.ok(backup.stop < backup.entry, "a buy's stop is below its entry");
  assert.ok(backup.stop < geometry.stop, "Entry 2's stop is beyond Entry 1's");
  assert.ok(Math.abs(backup.stop - 1.34045) < 1e-9);
});

test("the risk is given for each entry to the same final target", () => {
  const { next } = assess(gbpusd(), entry1);
  assert.match(next.risk, /^For Entry 1, with the suggested stop and targets you risk 13 pips to make 55 pips at the final target \(4\.2 times your risk\)\./);
  assert.match(next.risk, / Entry 2: you risk 27 pips to make 71 pips at the final target \(2\.6 times your risk\)\.$/);
});

test("each stop retires its own entry, and the last one retires the whole idea", () => {
  const { next } = assess(gbpusd(), entry1);
  assert.match(
    next.cancel,
    /^If a candle closes below 1\.34345, Entry 1 is wrong\. If a candle closes below 1\.34045, Entry 2 is wrong and so is the whole buy idea\./
  );
});

test("a sell mirrors it: each backup's stop sits above its entry", () => {
  const facts = {
    instrument: "EURUSD",
    direction: "bearish",
    analysisType: "pre-trade",
    trade: { visible: false },
    executedOrder: null,
    risk: {},
    volatility: { avgRange: 0.001 },
    activeEntryAreas: [
      { direction: "sell", authoritativeCenter: 1.13097 },
      { direction: "sell", authoritativeCenter: 1.13227 },
    ],
    selectorDiagnostics: levels([1.13097, 1.13227, 1.1337, 1.12861]),
  };
  const { geometry, next } = assess(facts, { direction: "sell", authoritativeCenter: 1.13097, zoneLow: 1.13067, zoneHigh: 1.13127 });
  assert.ok(geometry.backups[0].stop > geometry.backups[0].entry);
  assert.ok(geometry.backups[0].stop > geometry.stop);
  assert.match(next.exit, /Entry 2 stop loss: just above the key high at 1\.13370/);
  assert.match(next.cancel, /Entry 2 is wrong and so is the whole sell idea\./);
});

test("one entry reads exactly as before: no entry numbers, one stop", () => {
  // With no backup entry, Tuesday's high is an ordinary key level 15 pips away, so it can hold the stop.
  const facts = gbpusd({ activeEntryAreas: [{ direction: "buy", authoritativeCenter: 1.34475, rank: 1 }] });
  const { next, geometry } = assess(facts, entry1);
  assert.match(next.exit, /^Stop loss: just below the key low at 1\.34318/);
  assert.doesNotMatch(next.exit, /Entry \d stop loss/);
  assert.equal(geometry.backups, undefined);
  assert.match(next.risk, /^With the suggested stop and targets you risk /);
  assert.match(next.cancel, /^If a candle closes below 1\.343\d*, this buy idea is wrong\./);
});

test("an entry the trader typed is their own plan: no backup stops are added", () => {
  const facts = gbpusd({ plannedTrade: { entry: 1.3445, stop: null, target: null } });
  const result = assess(facts, entry1);
  assert.equal(result.geometry.backups, undefined);
  assert.doesNotMatch(result.next.exit, /Entry 2 stop loss/);
});

test("the picture labels the stops by entry, and a single stop keeps its old label", () => {
  const candles = Array.from({ length: 72 }, (_, i) => {
    const base = 1.343 + Math.sin(i / 5) * 0.002;
    return {
      datetime: `2026-11-0${2 + Math.floor(i / 24)} ${String(i % 24).padStart(2, "0")}:00:00`,
      open: Number(base.toFixed(5)), high: Number((base + 0.0005).toFixed(5)), low: Number((base - 0.0005).toFixed(5)), close: Number((base + 0.0002).toFixed(5)),
    };
  });
  const { geometry } = assess(gbpusd(), entry1);
  const two = buildCleanChart({
    marketReference: { timeframeCandles: candles },
    finalFeedback: { entry1: { authoritativeCenter: 1.34475 }, entry2: { authoritativeCenter: 1.34318 }, chartGeometry: { trade: geometry } },
  });
  const labels = two.levels.map((level) => level.label);
  assert.ok(labels.includes("Stop 1") && labels.includes("Stop 2"));
  assert.ok(!labels.includes("Suggested stop"));
  const price = (label) => two.levels.find((level) => level.label === label).price;
  assert.ok(price("Stop 2") < price("Stop 1"));

  const single = buildCleanChart({
    marketReference: { timeframeCandles: candles },
    finalFeedback: { entry1: { authoritativeCenter: 1.34475 }, chartGeometry: { trade: { ...geometry, backups: undefined } } },
  });
  assert.ok(single.levels.map((level) => level.label).includes("Suggested stop"));
});

test("the account risk is given for each entry, and a high one is flagged even when Entry 1 is sensible", () => {
  // $2,500, 0.35 lots: Entry 1's 13 pip stop risks about $45 (1.8%), Entry 2's 27 pip stop about $95 (3.8%).
  const facts = gbpusd({ riskInputs: { balance: 2500, lots: 0.35 } });
  const result = assessTradePillars({ facts, area: entry1, hasValidatedArea: true });
  assert.match(result.next.risk, /At that stop, 0\.35 lots would risk \$45\.5 \(1\.8% of your account\)\. That is a sensible size\./);
  assert.match(result.next.risk, /At Entry 2's stop, 0\.35 lots would risk \$95\.55 \(3\.8% of your account\)\. That is on the high side\./);
  const flagged = result.weaknesses.filter((item) => item.pillar === "risk").map((item) => item.text);
  assert.ok(flagged.some((text) => text.startsWith("At Entry 2's stop")), "the high Entry 2 risk is a weakness");
  assert.ok(!flagged.some((text) => text.startsWith("At Entry 1")), "nothing is flagged for the sensible Entry 1");
});

test("when both entries are sensible there is no extra weakness, only the second figure", () => {
  const facts = gbpusd({ riskInputs: { balance: 2500, lots: 0.18 } });
  const result = assessTradePillars({ facts, area: entry1, hasValidatedArea: true });
  assert.match(result.next.risk, /At Entry 2's stop, 0\.18 lots would risk \$49\.14 \(2% of your account\)\. That is a sensible size\./);
  assert.equal(result.weaknesses.filter((item) => item.pillar === "risk").length, 0);
});
