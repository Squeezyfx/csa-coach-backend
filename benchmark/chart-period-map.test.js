import test from "node:test";
import assert from "node:assert/strict";
import { buildChartPeriodMap } from "../chart-period-map.js";

function h1Candles(start, end) {
  const output = [];
  const startMs = Date.parse(start.includes("T") ? start : `${start}T00:00:00Z`);
  const endMs = Date.parse(end.includes("T") ? end : `${end}T00:00:00Z`);
  for (let value = startMs; value <= endMs; value += 3600000) {
    const day = new Date(value).getUTCDay();
    if (day === 0 || day === 6) continue;
    output.push({ datetime: new Date(value).toISOString().slice(0, 19).replace("T", " ") });
  }
  return output;
}

test("H1 period map uses candle indices, marks Thursday in-progress and excludes future candles", () => {
  const candles = h1Candles("2026-09-07", "2026-09-10T08:00:00Z");
  const map = buildChartPeriodMap({
    timeframe: "H1",
    candles,
    chartCutoff: { endDateTime: "2026-09-10 06:00:59", exactVisibleCutoff: true },
    axisCalibration: {
      candleStep: 8,
      lastCandleX: 800,
      anchors: [
        { x: 100, timestamp: "2026-09-07 00:00:00" },
        { x: 292, timestamp: "2026-09-08 00:00:00" },
        { x: 484, timestamp: "2026-09-09 00:00:00" },
      ],
    },
  });
  assert.equal(map.status, "verified");
  assert.equal(map.cutoff.lastIncludedTimestamp, "2026-09-10 06:00:00");
  assert.equal(map.cutoff.firstExcludedTimestamp, "2026-09-10 07:00:00");
  assert.equal(map.cutoff.screenX, 724);
  assert.deepEqual(map.periodStarts.map((period) => [period.period, period.status, period.screenX, period.selectable]), [
    ["Monday", "completed", 100, true],
    ["Tuesday", "completed", 292, true],
    ["Wednesday", "completed", 484, true],
    ["Thursday", "in_progress", 676, false],
  ]);
});

test("period map fails closed when anchor calibration is not available", () => {
  const map = buildChartPeriodMap({
    timeframe: "H1",
    candles: h1Candles("2026-09-07", "2026-09-10"),
    chartCutoff: { endDateTime: "2026-09-10 06:00:59", exactVisibleCutoff: true },
  });
  assert.equal(map.status, "unverified");
  assert.equal(map.canUseForPeriodInventory, false);
  assert.equal(map.canUseForFibonacci, false);
  assert.equal(map.canSelectEntries, false);
  assert.match(map.limitations.join(" "), /three timestamped x-axis anchors/);
});

test("H4 map groups periods by Monday and leaves the current week unselectable", () => {
  const candles = [
    "2026-08-31 00:00:00", "2026-09-01 00:00:00", "2026-09-07 00:00:00", "2026-09-10 00:00:00",
  ].map(datetime => ({ datetime }));
  const map = buildChartPeriodMap({
    timeframe: "H4", candles,
    chartCutoff: { endDateTime: "2026-09-10 00:00:59", exactVisibleCutoff: true },
    axisCalibration: { candleStep: 12, anchors: [
      { x: 10, timestamp: "2026-08-31 00:00:00" }, { x: 22, timestamp: "2026-09-01 00:00:00" }, { x: 34, timestamp: "2026-09-07 00:00:00" },
    ] },
  });
  assert.equal(map.status, "verified");
  assert.equal(map.periodStarts.at(-1).status, "in_progress");
  assert.equal(map.periodStarts.at(-1).selectable, false);
});
