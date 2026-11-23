import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isOffScale, priceAxisRange, resolveOffScalePrice } from "../price-scale-check.js";

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
  assert.deepEqual(resolveOffScalePrice({ price: 71.761, ticks: solTicks, header: null }), { action: "keep" });
  assert.deepEqual(resolveOffScalePrice({ price: 188.23, ticks: [], header: null }), { action: "keep" });
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
