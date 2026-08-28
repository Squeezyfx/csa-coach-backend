import test from "node:test";
import assert from "node:assert/strict";
import { buildVisibleWeekFibonacciFrame } from "./weekly-fibonacci-policy.js";

const candles = [
  { datetime: "2026-08-21T20:00:00Z", high: 1.41, low: 1.39 },
  { datetime: "2026-08-24T00:00:00Z", high: 1.38903, low: 1.37912 },
  { datetime: "2026-08-25T12:00:00Z", high: 1.386, low: 1.38246 },
  { datetime: "2026-08-26T20:00:00Z", high: 1.388, low: 1.381 },
];

test("H1 Fibonacci uses the current visible calendar-week high and low", () => {
  const frame = buildVisibleWeekFibonacciFrame({ candles, direction: "bullish", timeframe: "H1" });
  assert.equal(frame.weekStart, "2026-08-24");
  assert.equal(frame.swingHigh, 1.38903);
  assert.equal(frame.swingLow, 1.37912);
  assert.equal(frame.source, "visible_current_week_high_low");
  assert.ok(Math.abs(frame.levels[0].price - 1.385244) < 0.000001);
  assert.ok(Math.abs(frame.levels[1].price - 1.384075) < 0.000001);
  assert.ok(Math.abs(frame.levels[2].price - 1.382906) < 0.000001);
});

test("the weekly frame does not turn a smaller candidate-local swing into Fibonacci authority", () => {
  assert.equal(buildVisibleWeekFibonacciFrame({ candles, direction: "bullish", timeframe: "H4" }), null);
  assert.equal(buildVisibleWeekFibonacciFrame({ candles, direction: "range", timeframe: "H1" }), null);
});
