import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPrintedAxisTick } from "../axis-ticks.js";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

// AUDUSD, 13 Nov 2026, end of 12 Nov: no line was drawn, the independent line reader returned the printed
// axis number 0.68000, and Thursday's low (0.67971, three pips away) was reconciled onto it, giving a chart
// that showed "TP2 0.68000" next to "Final TP 0.67971".
const TICKS = [0.7, 0.695, 0.69, 0.685, 0.68];

test("0.68000 is a printed axis number, Thursday's low is not", () => {
  assert.equal(isPrintedAxisTick(0.68, TICKS), true);
  assert.equal(isPrintedAxisTick(0.67971, TICKS), false);
});

test("a price read by the independent line reader at a printed tick is set aside before levels are reconciled", () => {
  const start = server.indexOf("const exactPrices = (Array.isArray(visualReview?.visibleMarkedLevels)", server.indexOf("function supplementReferencesWithExactChartLevels"));
  assert.ok(start > 0, "exactPrices is built from the reader's levels");
  const block = server.slice(start, start + 1800);
  assert.match(block, /independent_horizontal_line_reader_exact"\) return true/, "only the independent reader is judged");
  assert.match(block, /isPrintedAxisTick\(price, axisTickPrices\)/);
  // The guard sits before the prices are mapped, so no later step (reference overlap or framework match) sees them.
  assert.ok(block.indexOf("isPrintedAxisTick") < block.indexOf(".map((item) => nullablePositiveNumber(item?.displayedPrice))"));
});

test("a price from the per-target framework reader is not judged here", () => {
  const start = server.indexOf("const exactPrices = (Array.isArray(visualReview?.visibleMarkedLevels)", server.indexOf("function supplementReferencesWithExactChartLevels"));
  const block = server.slice(start, start + 1800);
  assert.doesNotMatch(block, /per_target_framework_price_reader"\) return false/);
});

test("the tick list reaches the reference builder", () => {
  assert.match(server, /axisTickPrices: chartDetection\?\.priceAxisTicks,/);
});
