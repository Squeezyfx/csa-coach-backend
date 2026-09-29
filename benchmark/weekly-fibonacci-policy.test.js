import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVisiblePeriodFibonacciFrame,
  buildVisibleWeekFibonacciFrame,
  resolveCalendarPeriodDirection,
  resolveDeepRetracementDirectionOverride,
} from "./weekly-fibonacci-policy.js";

const candles = [
  { datetime: "2026-08-21T20:00:00Z", open: 1.4, high: 1.41, low: 1.39, close: 1.395 },
  { datetime: "2026-08-24T00:00:00Z", open: 1.38, high: 1.38903, low: 1.37912, close: 1.384 },
  { datetime: "2026-08-25T12:00:00Z", open: 1.384, high: 1.386, low: 1.38246, close: 1.385 },
  { datetime: "2026-08-26T20:00:00Z", open: 1.385, high: 1.388, low: 1.381, close: 1.383 },
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

test("USA30-style weekly pullback keeps the full week low as the Fib origin", () => {
  const usa30 = [
    { datetime: "2026-08-24T00:00:00Z", open: 53240, high: 53524.2, low: 53158.9, close: 53500 },
    { datetime: "2026-08-25T12:00:00Z", open: 53500, high: 53750, low: 53384.7, close: 53620 },
    { datetime: "2026-08-26T01:00:00Z", open: 53522.2, high: 53522.2, low: 53477.2, close: 53496.2 },
  ];
  const frame = buildVisibleWeekFibonacciFrame({ candles: usa30, direction: "bullish", timeframe: "H1" });
  assert.equal(frame.swingHigh, 53750);
  assert.equal(frame.swingLow, 53158.9);
  assert.equal(frame.periodCandleDirection, "bullish");
  assert.ok(Math.abs(frame.levels[0].price - 53524.2) < 0.01);
  assert.ok(Math.abs(frame.levels[2].price - 53384.7) < 0.01);
});

test("H4, D1 and W1 reject incomplete calendar coverage instead of falling through", () => {
  const partialMonth = [
    { datetime: "2026-08-10T00:00:00Z", open: 10, high: 12, low: 9, close: 11 },
    { datetime: "2026-08-20T00:00:00Z", open: 11, high: 13, low: 10, close: 12 },
  ];
  const partialYear = [
    { datetime: "2026-03-01T00:00:00Z", open: 10, high: 12, low: 9, close: 11 },
    { datetime: "2026-08-20T00:00:00Z", open: 11, high: 13, low: 10, close: 12 },
  ];
  assert.equal(buildVisiblePeriodFibonacciFrame({ candles: partialMonth, direction: "bullish", timeframe: "H4" }), null);
  assert.equal(buildVisiblePeriodFibonacciFrame({ candles: partialYear, direction: "bullish", timeframe: "D1" }), null);
  assert.equal(buildVisiblePeriodFibonacciFrame({ candles: partialYear, direction: "bullish", timeframe: "W1" }), null);
});

test("calendar-period OHLC overrides a conflicting recent direction", () => {
  const year = [
    { datetime: "2026-01-01T00:00:00Z", open: 100, high: 110, low: 90, close: 95 },
    { datetime: "2026-08-20T00:00:00Z", open: 95, high: 130, low: 94, close: 120 },
  ];
  const frame = buildVisiblePeriodFibonacciFrame({ candles: year, direction: "bearish", timeframe: "D1" });
  assert.equal(frame.direction, "bullish");
  assert.equal(frame.periodCandleDirection, "bullish");
  assert.ok(Math.abs(frame.levels[0].price - 114.72) < 0.000001);

  assert.deepEqual(resolveCalendarPeriodDirection({
    frameVerified: true,
    periodDirection: "bullish",
    recentDirection: "bearish",
  }), {
    direction: "bullish",
    phase: "bearish_pullback_after_bullish_structure",
  });
  assert.equal(resolveCalendarPeriodDirection({ frameVerified: false, periodDirection: "bullish" }), null);
});

test("deep retracement past 61.8% of the framing swing flips a bearish read to bullish (USDJPY H4)", () => {
  const periods = [
    { key: "2026-08-31", periodLabel: "W1", high: 160.40466, low: 155.2976, periodLifecycle: "completed" },
    { key: "2026-09-07", periodLabel: "W2", high: 156.8, low: 152.90794, periodLifecycle: "completed" },
    { key: "2026-09-14", periodLabel: "W3", high: 155.6, low: 153.1, periodLifecycle: "completed" },
    { key: "2026-09-21", periodLabel: "W4", high: 159.02924, low: 156.59305, periodLifecycle: "completed" },
    { key: "2026-09-28", periodLabel: "W5", high: 158.4, low: 157.1, periodLifecycle: "in_progress", partialPeriod: true },
  ];
  const result = resolveDeepRetracementDirectionOverride({ periods });
  assert.equal(result.direction, "bullish");
  assert.equal(result.swingHigh, 160.40466);
  assert.equal(result.swingLow, 152.90794);
  assert.equal(result.swingHighKey, "2026-08-31");
  assert.equal(result.swingLowKey, "2026-09-07");
  assert.ok(Math.abs(result.retracementRatio - 0.81656) < 0.0001);
});

test("deep retracement mirrors for an up-move pullback past 61.8%, flipping bullish to bearish", () => {
  const periods = [
    { key: "2026-08-31", periodLabel: "W1", high: 90, low: 80, periodLifecycle: "completed" },
    { key: "2026-09-07", periodLabel: "W2", high: 120, low: 88, periodLifecycle: "completed" },
    { key: "2026-09-14", periodLabel: "W3", high: 100, low: 90.72, periodLifecycle: "completed" },
  ];
  const result = resolveDeepRetracementDirectionOverride({ periods });
  assert.equal(result.direction, "bearish");
  assert.equal(result.swingHigh, 120);
  assert.equal(result.swingLow, 80);
  // recentTrough = min(W2.low=88, W3.low=90.72) = 88; (120-88)/(120-80) = 0.8
  assert.ok(Math.abs(result.retracementRatio - 0.8) < 0.0001);
});

test("deep retracement stays null under the threshold, without a clear impulse, or with too little data", () => {
  // Only retraced 50% of the 160->150 down-move (peak back to 155), short of
  // the 61.8% threshold - distinct high/low periods, just not deep enough.
  const shallow = [
    { key: "2026-08-31", high: 160, low: 155, periodLifecycle: "completed" },
    { key: "2026-09-07", high: 155, low: 150, periodLifecycle: "completed" },
    { key: "2026-09-14", high: 155, low: 152, periodLifecycle: "completed" },
  ];
  assert.equal(resolveDeepRetracementDirectionOverride({ periods: shallow }), null);

  // The same period made both the swing high and low - no chronological impulse to measure.
  const samePeriod = [
    { key: "2026-08-31", high: 160, low: 150, periodLifecycle: "completed" },
  ];
  assert.equal(resolveDeepRetracementDirectionOverride({ periods: samePeriod }), null);

  // The in-progress current period must never source this signal.
  const onlyInProgress = [
    { key: "2026-08-31", high: 160, low: 150, periodLifecycle: "completed" },
    { key: "2026-09-07", high: 159, low: 151.5, periodLifecycle: "in_progress", partialPeriod: true },
  ];
  assert.equal(resolveDeepRetracementDirectionOverride({ periods: onlyInProgress }), null);

  assert.equal(resolveDeepRetracementDirectionOverride({ periods: [] }), null);
});
