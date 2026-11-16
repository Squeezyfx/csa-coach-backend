import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCleanChart, stopDistanceText } from "../clean-chart.js";

function candles(low, high, count = 40) {
  return Array.from({ length: count }, (_, i) => {
    const mid = low + ((high - low) * (i % 10)) / 10;
    const day = String(1 + (i % 28)).padStart(2, "0");
    const month = String(1 + Math.floor(i / 28)).padStart(2, "0");
    return { datetime: `2026-${month}-${day} 00:00:00`, open: mid, high: mid + (high - low) * 0.03, low: mid - (high - low) * 0.03, close: mid + (high - low) * 0.01 };
  });
}

const goldTrade = {
  kind: "plan",
  entry: 4511,
  stop: 4608.42267,
  targets: [4225.62012, 4098.87012, 3833.62085],
  backups: [
    { order: 2, entry: 4697.66016, stop: 4890.0002 },
    { order: 3, entry: 4773.83008, stop: 4890.0002 },
  ],
};
const goldFeedback = {
  entry1: { authoritativeCenter: 4511 },
  entry2: { authoritativeCenter: 4697.66016 },
  entry3: { authoritativeCenter: 4773.83008 },
  chartGeometry: { trade: goldTrade },
};

test("the stop tags carry the stop size measured from each stop's own entry (gold: points)", () => {
  const chart = buildCleanChart({ marketReference: { timeframeCandles: candles(3800, 4750) }, finalFeedback: goldFeedback, instrument: "XAUUSD", entryWord: "Sell" });
  const labels = chart.levels.map((level) => level.label);
  assert.ok(labels.includes("Stop 1 (97.42 pts)"), labels.join(" | "));
  // Stops 2 and 3 share one price, so they share one line, each keeping its own size.
  assert.ok(labels.includes("Stop 2 (192.3 pts) / Stop 3 (116.2 pts)"), labels.join(" | "));
  // Entries and take profits are not touched.
  assert.ok(labels.includes("Sell 1") && labels.includes("Sell 2") && labels.includes("Sell 3"));
  assert.ok(labels.includes("TP1") && labels.includes("Final TP"));
});

test("forex stops are in pips, and JPY pairs use the 0.01 pip", () => {
  const eur = buildCleanChart({
    marketReference: { timeframeCandles: candles(1.10, 1.14) },
    finalFeedback: { entry1: { authoritativeCenter: 1.1130 }, chartGeometry: { trade: { kind: "plan", entry: 1.1130, stop: 1.1155, targets: [1.108] } } },
    instrument: "EURUSD",
  });
  assert.ok(eur.levels.some((level) => level.label === "Suggested stop (25 pips)"), eur.levels.map((l) => l.label).join(" | "));
  const jpy = buildCleanChart({
    marketReference: { timeframeCandles: candles(150, 156) },
    finalFeedback: { entry1: { authoritativeCenter: 153.2 }, chartGeometry: { trade: { kind: "plan", entry: 153.2, stop: 153.7, targets: [151] } } },
    instrument: "USDJPY",
  });
  assert.ok(jpy.levels.some((level) => level.label === "Suggested stop (50 pips)"), jpy.levels.map((l) => l.label).join(" | "));
});

test("a stop the trader actually placed shows its size too", () => {
  const chart = buildCleanChart({
    marketReference: { timeframeCandles: candles(1.10, 1.14) },
    finalFeedback: { chartGeometry: { trade: { kind: "placed", entry: 1.1130, stop: 1.1110, targets: [1.118] } } },
    instrument: "EURUSD",
  });
  assert.ok(chart.levels.some((level) => level.label === "Your stop (20 pips)"));
});

test("the switch turns the sizes off and the old labels come back", () => {
  const chart = buildCleanChart({ marketReference: { timeframeCandles: candles(3800, 4750) }, finalFeedback: goldFeedback, instrument: "XAUUSD", showStopDistance: false });
  const labels = chart.levels.map((level) => level.label);
  assert.ok(labels.includes("Stop 1") && labels.includes("Stop 2 / Stop 3"), labels.join(" | "));
});

test("no size is shown when it cannot be worked out, and never a made-up one", () => {
  assert.equal(stopDistanceText(null, 1.2, "EURUSD"), "");
  assert.equal(stopDistanceText(1.2, undefined, "EURUSD"), "");
  assert.equal(stopDistanceText(1.2, 1.2, "EURUSD"), "");
  assert.equal(stopDistanceText(0, 1.2, "EURUSD"), "");
  assert.equal(stopDistanceText(4511, 4608.42267, "XAUUSD"), "97.42 pts");
  assert.equal(stopDistanceText(1.1130, 1.1155, "EURUSD"), "25 pips");
  const chart = buildCleanChart({
    marketReference: { timeframeCandles: candles(1.10, 1.14) },
    finalFeedback: { chartGeometry: { trade: { kind: "plan", entry: null, stop: 1.1155, targets: [1.108] } } },
    instrument: "EURUSD",
  });
  assert.ok(chart.levels.some((level) => level.label === "Suggested stop"));
  assert.ok(!chart.levels.some((level) => /\(\)|NaN|undefined/.test(level.label)));
});

test("server wiring: the page's chart gets the setting and CHART_STOP_DISTANCE=off hides the sizes", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /showStopDistance: String\(process\.env\.CHART_STOP_DISTANCE \|\| ""\)\.trim\(\)\.toLowerCase\(\) !== "off"/);
});
