import test from "node:test";
import assert from "node:assert/strict";
import { findHoveredCandleMatch } from "../chart-endpoint-guard.js";

// GBPUSD H1, 2026-10-16: the screenshot header read the candle under the mouse
// (12 Oct 14:00) while the chart's last candle closed at 1.33582.
const candles = [
  { datetime: "2026-10-12 13:00:00", open: 1.3225, high: 1.3240, low: 1.3220, close: 1.3231 },
  { datetime: "2026-10-12 14:00:00", open: 1.3231, high: 1.3233, low: 1.3218, close: 1.3219 },
  { datetime: "2026-10-12 15:00:00", open: 1.3219, high: 1.3225, low: 1.3205, close: 1.3210 },
  { datetime: "2026-10-15 20:00:00", open: 1.3300, high: 1.3320, low: 1.3295, close: 1.3315 },
  { datetime: "2026-10-16 13:00:00", open: 1.3340, high: 1.3360, low: 1.3335, close: 1.3355 },
  { datetime: "2026-10-16 14:00:00", open: 1.3355, high: 1.3359, low: 1.3350, close: 1.33582 },
];

test("a header that reads an older candle is reported as a hovered candle", () => {
  const hit = findHoveredCandleMatch({
    candles,
    header: { open: 1.3231, high: 1.3233, low: 1.3218, close: 1.3219 },
    tolerance: 0.0006,
  });
  assert.equal(hit?.datetime, "2026-10-12 14:00:00");
});

test("a header that matches the final candles is a normal reading", () => {
  const hit = findHoveredCandleMatch({
    candles,
    header: { open: 1.3355, high: 1.3359, low: 1.3350, close: 1.33582 },
    tolerance: 0.0006,
  });
  assert.equal(hit, null);
});

test("a price from a different dataset matches nothing", () => {
  const hit = findHoveredCandleMatch({
    candles,
    header: { open: 1.2410, high: 1.2420, low: 1.2400, close: 1.2415 },
    tolerance: 0.0006,
  });
  assert.equal(hit, null);
});

test("a close on its own is not enough evidence", () => {
  const hit = findHoveredCandleMatch({ candles, header: { close: 1.3219 }, tolerance: 0.0006 });
  assert.equal(hit, null);
});
