import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bestAxisScale, isOffScale, priceAxisRange, resolveOffScalePrice } from "../price-scale-check.js";

// SOLUSD H4, 2026-11-23: the axis ran 66 to 104 and the last price tag said 71.761, but the reader returned 188.23.
const solTicks = [104, 100, 96, 92.3, 88, 82, 66];

test("the axis range comes from the ticks, as numbers or text, and needs at least three of them", () => {
  assert.deepEqual(priceAxisRange(["104.000", "100.000", "96.000"]), { min: 96, max: 104, span: 8, count: 3 });
  assert.equal(priceAxisRange([104, 100]), null);
  assert.equal(priceAxisRange([]), null);
  assert.equal(priceAxisRange(undefined), null);
  assert.equal(priceAxisRange([5, 5, 5]), null, "a flat axis says nothing");
  assert.equal(priceAxisRange([-1, 0, "x", null]), null);
});

test("a price far above the chart's axis is off the scale, one on the chart is not", () => {
  assert.equal(isOffScale(188.23, solTicks), true);
  assert.equal(isOffScale(71.761, solTicks), false);
  assert.equal(isOffScale(66, solTicks), false);
  assert.equal(isOffScale(104, solTicks), false);
  // the last price may sit a little past the outermost tick
  assert.equal(isOffScale(106, solTicks), false);
  assert.equal(isOffScale(112, solTicks), true);
  assert.equal(isOffScale(55, solTicks), true);
});

test("with no price, no usable axis or a forex price, nothing is called off scale", () => {
  assert.equal(isOffScale(null, solTicks), false);
  assert.equal(isOffScale(188.23, []), false);
  assert.equal(isOffScale(188.23, [100, 104]), false);
  assert.equal(isOffScale(1.30312, [1.335, 1.33, 1.325, 1.32, 1.315, 1.31, 1.305]), false);
  assert.equal(isOffScale(1.52, [1.335, 1.33, 1.325, 1.32, 1.315, 1.31, 1.305]), true);
});

test("an off-scale price is replaced by the header's four prices when those sit on the axis", () => {
  const header = { open: 71.771, high: 71.8, low: 71.518, close: 71.761 };
  const fix = resolveOffScalePrice({ price: 188.23, ticks: solTicks, header });
  assert.equal(fix.action, "use_header");
  assert.equal(fix.price, 71.761);
  assert.equal(fix.open, 71.771);
  assert.equal(fix.range.max, 104);
});

test("an off-scale price is dropped when the header read is missing or also off the axis", () => {
  assert.equal(resolveOffScalePrice({ price: 188.23, ticks: solTicks, header: null }).action, "drop");
  assert.equal(resolveOffScalePrice({ price: 188.23, ticks: solTicks, header: { open: 188, high: 189, low: 187, close: 188.2 } }).action, "drop");
  assert.equal(resolveOffScalePrice({ price: 188.23, ticks: solTicks, header: { open: 71, high: 72, low: 70, close: 188 } }).action, "drop");
});

test("a price on the axis is kept untouched", () => {
  assert.deepEqual(resolveOffScalePrice({ price: 71.761, ticks: solTicks, header: null }), { action: "keep", factor: 1 });
  assert.deepEqual(resolveOffScalePrice({ price: 188.23, ticks: [], header: null }), { action: "keep", factor: 1 });
});

test("the review runs the check right after the price-axis step and before any date is chosen, with an off switch", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /import \{ isOffScale, resolveOffScalePrice \} from "\.\/price-scale-check\.js";/);
  const check = server.indexOf("PRICE SCALE CHECK.");
  assert.ok(check > 0, "the check is in server.js");
  assert.ok(check > server.indexOf("[price-axis-calibration] skipped:"), "after the price-axis calibration");
  assert.ok(check < server.indexOf("YEAR SLIP. The axis prints no year"), "before the year is corrected");
  assert.ok(check < server.indexOf("let dateDecision = chooseFinalChartDate"), "before the date decision");
  assert.match(server, /PRICE_SCALE_CHECK \|\| "on"/);
});

// The production log of the first deploy (2026-11-23 23:45 UTC): the axis labels came back as 104000, 100000 ... 68000
// (the reader dropped the decimal point of "104.000"), and the header read was open 77.994, high 72.338, low 71.518,
// close 71.761 (an open above the high). The price was dropped instead of fixed.
const thousandTicks = [104000, 100000, 96000, 92300, 88000, 86000, 82000, 66000, 68000, 90000];
const soloHeader = { open: 77.994, high: 72.338, low: 71.518, close: 71.761 };

test("axis labels read a thousand times too large are put back on the price scale by the header's prices", () => {
  assert.equal(bestAxisScale(thousandTicks, [188.23, 71.761, 72.338, 71.518]), 0.001);
  assert.equal(bestAxisScale(solTicks, [188.23, 71.761]), 1);
  assert.equal(bestAxisScale(thousandTicks, []), 1, "with nothing to compare, the scale is left alone");
});

test("the production case: ticks x1000 and an inconsistent header still give the header's close, without its open", () => {
  const fix = resolveOffScalePrice({ price: 188.23, ticks: thousandTicks, header: soloHeader });
  assert.equal(fix.action, "use_header");
  assert.equal(fix.price, 71.761);
  assert.equal(fix.factor, 0.001);
  assert.equal(fix.open, null, "the impossible open (above the high) is not passed on");
  assert.equal(fix.high, null);
  assert.equal(fix.low, null);
  assert.equal(fix.range.max, 104);
});

test("a correct price on x1000 ticks is kept, even when the header read fails", () => {
  assert.equal(resolveOffScalePrice({ price: 71.761, ticks: thousandTicks, header: null }).action, "keep");
  assert.equal(resolveOffScalePrice({ price: 71.761, ticks: thousandTicks, header: soloHeader }).action, "keep");
  assert.equal(isOffScale(71.761, thousandTicks), true, "on its own the x1000 axis looks off, which is why the header is read");
});

test("a consistent header on the right scale brings its open, high and low along", () => {
  const fix = resolveOffScalePrice({ price: 188.23, ticks: thousandTicks, header: { open: 71.771, high: 71.8, low: 71.518, close: 71.761 } });
  assert.equal(fix.open, 71.771);
  assert.equal(fix.high, 71.8);
  assert.equal(fix.low, 71.518);
});

test("the server only changes the price when the check did not say keep", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /if \(fix\.action !== "keep"\) chartDetection = \{/);
  assert.match(server, /axisScale: fix\.factor,/);
});
