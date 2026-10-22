import test from "node:test";
import assert from "node:assert/strict";
import { buildCleanChart, CLEAN_CHART_MAX_CANDLES } from "../clean-chart.js";

function candles(count, start = 1.12, step = 0.0004) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const base = start + Math.sin(i / 5) * step * 6;
    const day = String(19 + Math.floor(i / 24)).padStart(2, "0");
    const hour = String(i % 24).padStart(2, "0");
    rows.push({
      datetime: `2026-10-${day} ${hour}:00:00`,
      open: Number(base.toFixed(5)),
      high: Number((base + step).toFixed(5)),
      low: Number((base - step).toFixed(5)),
      close: Number((base + step / 3).toFixed(5)),
    });
  }
  return rows;
}

const marketReference = { timeframeCandles: candles(72) };

test("too few candles means no picture, with a reason", () => {
  const chart = buildCleanChart({ marketReference: { timeframeCandles: candles(4) } });
  assert.equal(chart.status, "unavailable");
  assert.ok(chart.reason);
  assert.deepEqual(chart.candles, []);
});

test("candles are compact rows, in time order, and capped", () => {
  const many = candles(CLEAN_CHART_MAX_CANDLES + 40);
  const chart = buildCleanChart({ marketReference: { timeframeCandles: [...many].reverse() } });
  assert.equal(chart.status, "ok");
  assert.equal(chart.candles.length, CLEAN_CHART_MAX_CANDLES);
  assert.equal(chart.candles[0].length, 5);
  assert.ok(chart.candles[0][0] < chart.candles[1][0]);
  assert.equal(chart.last, chart.candles[chart.candles.length - 1][4]);
  assert.equal(chart.decimals, 5);
});

test("entries and the level to watch are drawn with the review's own numbers", () => {
  const chart = buildCleanChart({
    marketReference,
    finalFeedback: {
      entry1: { authoritativeCenter: 1.1205 },
      entry2: { authoritativeCenter: 1.1185 },
      chartGeometry: { watch: [{ price: 1.1235, areaType: "support" }] },
    },
  });
  const byLabel = Object.fromEntries(chart.levels.map((l) => [l.label, l.price]));
  assert.equal(byLabel["Entry 1"], 1.1205);
  assert.equal(byLabel["Entry 2"], 1.1185);
  assert.equal(byLabel["Level to watch"], 1.1235);
});

test("a planned trade shows the trader's own lines and lighter suggested exits", () => {
  const chart = buildCleanChart({
    marketReference,
    finalFeedback: {
      entry1: { authoritativeCenter: 1.1205 },
      chartGeometry: {
        trade: {
          kind: "plan",
          side: "buy",
          entry: 1.1205,
          entryTyped: false,
          stop: 1.1185,
          stopTyped: 1.1190,
          targets: [1.1225, 1.1245],
          targetTyped: null,
        },
      },
    },
  });
  const styles = Object.fromEntries(chart.levels.map((l) => [l.label, l.style]));
  assert.equal(styles["Your stop"], "stop");
  assert.equal(styles["Suggested stop"], "planStop");
  assert.equal(styles["TP1"], "planTarget");
  assert.equal(styles["Final TP"], "planTarget");
});

test("a placed trade shows entry, stop and take profit as the trader's own", () => {
  const chart = buildCleanChart({
    marketReference,
    finalFeedback: {
      chartGeometry: { trade: { kind: "placed", side: "sell", entry: 1.1215, stop: 1.1235, targets: [1.1175] } },
    },
  });
  const labels = chart.levels.map((l) => l.label);
  assert.ok(labels.includes("Your entry"));
  assert.ok(labels.includes("Your stop"));
  assert.ok(labels.includes("Your take profit"));
});

test("two labels at one price share a line", () => {
  const chart = buildCleanChart({
    marketReference,
    finalFeedback: {
      entry1: { authoritativeCenter: 1.1205 },
      chartGeometry: { watch: [{ price: 1.12051 }] },
    },
  });
  const entry = chart.levels.filter((l) => l.style === "entry");
  assert.equal(entry.length, 1);
  const watch = chart.levels.filter((l) => l.style === "watch");
  assert.equal(watch.length, 1);
});

test("a level far from the candles is listed under the picture instead of squashing them", () => {
  const chart = buildCleanChart({
    marketReference,
    finalFeedback: { entry1: { authoritativeCenter: 1.3 } },
  });
  assert.equal(chart.levels.length, 0);
  assert.equal(chart.offChart.length, 1);
  assert.equal(chart.offChart[0].price, 1.3);
});
