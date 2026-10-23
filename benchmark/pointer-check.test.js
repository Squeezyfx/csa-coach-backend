import test from "node:test";
import assert from "node:assert/strict";
import { applyPointerEvidence, pointerPriceThreshold } from "../pointer-check.js";

const detection = (patch = {}) => ({
  isTradingChart: true,
  latestVisibleDate: "2026-10-21",
  latestVisibleTime: "20:00",
  latestVisibleDateEvidence: "inferred_axis",
  dateConfidence: "high",
  latestVisiblePrice: 1.12374,
  latestVisibleClose: 1.12374,
  latestVisibleOpen: 1.12214,
  latestVisibleHigh: 1.12391,
  latestVisibleLow: 1.12181,
  latestVisiblePriceConfidence: "high",
  ...patch,
});

test("a header close far from the price tag means the pointer is on the chart", () => {
  const result = applyPointerEvidence({
    chartDetection: detection(),
    evidence: { lastPrice: 1.1199, headerClose: 1.12374 },
    selectedDateText: "2026-10-23",
  });
  assert.equal(result.applied, true);
  const next = result.chartDetection;
  assert.equal(next.latestVisibleClose, 1.1199);
  assert.equal(next.latestVisiblePrice, 1.1199);
  assert.equal(next.latestVisibleOpen, null);
  assert.equal(next.latestVisibleHigh, null);
  assert.equal(next.latestVisibleLow, null);
  assert.equal(next.latestVisibleTime, null);
  assert.equal(next.latestVisibleDate, "2026-10-23");
  assert.equal(next.pointerOnChart.detectedDateBefore, "2026-10-21");
});

test("when the header and the tag agree nothing changes", () => {
  const before = detection();
  const result = applyPointerEvidence({ chartDetection: before, evidence: { lastPrice: 1.12374, headerClose: 1.12374 }, selectedDateText: "2026-10-23" });
  assert.equal(result.applied, false);
  assert.equal(result.chartDetection, before);
  const near = applyPointerEvidence({ chartDetection: before, evidence: { lastPrice: 1.12378, headerClose: 1.12374 } });
  assert.equal(near.applied, false);
});

test("the trader's chart date is used only when it is later than the detected date and within a week", () => {
  const earlier = applyPointerEvidence({ chartDetection: detection(), evidence: { lastPrice: 1.1199, headerClose: 1.12374 }, selectedDateText: "2026-10-19" });
  assert.equal(earlier.chartDetection.latestVisibleDate, "2026-10-21");
  const far = applyPointerEvidence({ chartDetection: detection(), evidence: { lastPrice: 1.1199, headerClose: 1.12374 }, selectedDateText: "2026-11-30" });
  assert.equal(far.chartDetection.latestVisibleDate, "2026-10-21");
  const none = applyPointerEvidence({ chartDetection: detection(), evidence: { lastPrice: 1.1199, headerClose: 1.12374 }, selectedDateText: "" });
  assert.equal(none.applied, true);
  assert.equal(none.chartDetection.latestVisibleDate, "2026-10-21");
  assert.equal(none.chartDetection.latestVisibleTime, null);
});

test("missing, implausible or non-chart evidence changes nothing", () => {
  const before = detection();
  assert.equal(applyPointerEvidence({ chartDetection: before, evidence: { lastPrice: null, headerClose: 1.12 } }).applied, false);
  assert.equal(applyPointerEvidence({ chartDetection: before, evidence: { lastPrice: 6.12, headerClose: 1.12374 } }).reason, "tag_implausible");
  assert.equal(applyPointerEvidence({ chartDetection: { isTradingChart: false }, evidence: { lastPrice: 1.1, headerClose: 1.2 } }).applied, false);
  assert.equal(applyPointerEvidence({}).applied, false);
});

test("the tolerance scales with the price", () => {
  assert.ok(pointerPriceThreshold(1.12) < 0.0001);
  assert.ok(pointerPriceThreshold(53000) > 4);
});

test("a tag outside the chart's own price axis is not trusted", () => {
  const ticks = [1.14, 1.135, 1.13, 1.125, 1.12, 1.115];
  const outside = applyPointerEvidence({
    chartDetection: detection({ priceAxisTicks: ticks }),
    evidence: { lastPrice: 1.1005, headerClose: 1.12374 },
  });
  assert.equal(outside.applied, false);
  assert.equal(outside.reason, "tag_outside_price_axis");
  const inside = applyPointerEvidence({
    chartDetection: detection({ priceAxisTicks: ticks }),
    evidence: { lastPrice: 1.1199, headerClose: 1.12374 },
  });
  assert.equal(inside.applied, true);
});
