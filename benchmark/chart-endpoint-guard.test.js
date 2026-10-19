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

import { providerFinalClose } from "../chart-endpoint-guard.js";

test("the provider's newest close stands in for a hovered header", () => {
  assert.equal(providerFinalClose([...candles].reverse()), 1.33582);
  assert.equal(providerFinalClose([]), null);
});

test("a hovered candle is still found when the chart's feed differs by a few tenths (gold)", () => {
  // XAUUSD H1: the header showed O 4156.040 H 4158.000 L 4151.785 C 4156.445 while the
  // provider's copy of that candle differs slightly and the chart ended near 4176.
  const gold = [
    { datetime: "2026-10-14 14:00:00", open: 4155.40, high: 4158.70, low: 4151.10, close: 4156.10 },
    { datetime: "2026-10-14 15:00:00", open: 4156.10, high: 4162.00, low: 4155.00, close: 4160.20 },
    { datetime: "2026-10-16 21:00:00", open: 4170.00, high: 4178.00, low: 4169.50, close: 4176.36 },
  ];
  const header = { open: 4156.04, high: 4158.0, low: 4151.785, close: 4156.445 };
  assert.equal(findHoveredCandleMatch({ candles: gold, header, tolerance: 0.6, excludeLast: 1 }), null);
  const hit = findHoveredCandleMatch({ candles: gold, header, tolerance: 4176.36 * 0.0002, excludeLast: 1 });
  assert.equal(hit?.datetime, "2026-10-14 14:00:00");
});
