import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chooseLegFrame } from "../leg-frame.js";

const hour = (day, h) => `2026-11-${String(day).padStart(2, "0")} ${String(h).padStart(2, "0")}:00:00`;
const bar = (datetime, high, low) => ({ datetime, high: String(high), low: String(low) });

// GBPUSD H1, 23-25 Nov 2026 (OANDA candles): Monday opens at its high (1.31457), falls to its low (1.30119), recovers
// through Tuesday (high 1.31249), Wednesday dips to 1.30459 and rallies to its high 1.31305.
function gbpWeek() {
  const rows = [];
  rows.push(bar(hour(23, 0), 1.31457, 1.31300)); // Monday high first
  for (let h = 1; h < 24; h++) rows.push(bar(hour(23, h), 1.3135 - h * 0.0005, 1.3120 - h * 0.0005 > 1.30119 ? 1.3120 - h * 0.0005 : 1.3015));
  rows.push(bar(hour(23, 23), 1.3030, 1.30119)); // Monday low (late)
  for (let h = 0; h < 24; h++) rows.push(bar(hour(24, h), 1.3030 + h * 0.0004 > 1.31249 ? 1.31249 : 1.3030 + h * 0.0004, 1.3020 + h * 0.0004));
  for (let h = 0; h < 8; h++) rows.push(bar(hour(25, h), 1.3100 - h * 0.0006, 1.3090 - h * 0.0006)); // Wednesday dip
  rows.push(bar(hour(25, 8), 1.3060, 1.30459)); // Wednesday low
  for (let h = 9; h < 24; h++) rows.push(bar(hour(25, h), 1.3070 + (h - 9) * 0.0004 > 1.31305 ? 1.31305 : 1.3070 + (h - 9) * 0.0004, 1.3055 + (h - 9) * 0.0004));
  rows[rows.length - 1].high = "1.31305"; // Wednesday high
  return rows;
}

test("a bullish week whose high came before its low is framed on the up-leg", () => {
  const out = chooseLegFrame({ direction: "bullish", swingHigh: 1.31429, swingLow: 1.30096, candles: gbpWeek() });
  assert.equal(out.reordered, true);
  assert.equal(out.reason, "high_came_before_low");
  assert.equal(out.swingLow, 1.30096); // the period low is kept
  // the leg high is Wednesday's 1.31305 plus the candle-to-frame feed difference (1.31429 - 1.31457)
  assert.ok(Math.abs(out.swingHigh - (1.31305 + (1.31429 - 1.31457))) < 1e-9);
  assert.ok(out.swingHigh < 1.31429);
  assert.equal(out.weekSwingHigh, 1.31429);
  assert.ok(String(out.legStart).startsWith("2026-11-23"));
  assert.ok(String(out.legEnd).startsWith("2026-11-25"));
});

test("on that leg Wednesday's low is within 12% of the range of the 61.8% line, so it is a level to watch", () => {
  const out = chooseLegFrame({ direction: "bullish", swingHigh: 1.31429, swingLow: 1.30096, candles: gbpWeek() });
  const range = out.swingHigh - out.swingLow;
  const ratio = (out.swingHigh - 1.30452) / range;
  const beyond = ratio > 0.618 ? ratio - 0.618 : 0;
  assert.ok(ratio > 0.618 && beyond <= 0.12, `ratio ${ratio}, beyond ${beyond}`);
  // on the old frame the same level was 10.9% beyond: still watchable, but the band was the wrong one (down from Monday's high)
  const oldRatio = (1.31429 - 1.30452) / (1.31429 - 1.30096);
  assert.ok(oldRatio - 0.618 > 0.1);
});

test("the mirror case: a bearish week whose low came before its high is framed on the down-leg", () => {
  const down = gbpWeek().map((row) => ({ ...row, high: String(2.6 - Number(row.low)), low: String(2.6 - Number(row.high)) })); // mirrored prices
  const out = chooseLegFrame({ direction: "bearish", swingHigh: 2.6 - 1.30096, swingLow: 2.6 - 1.31429, candles: down });
  assert.equal(out.reordered, true);
  assert.equal(out.reason, "low_came_before_high");
  assert.equal(out.swingHigh, 2.6 - 1.30096);
  assert.ok(out.swingLow > 2.6 - 1.31429);
});

test("nothing changes when the order already agrees with the bias, or the bias has no direction", () => {
  assert.equal(chooseLegFrame({ direction: "bearish", swingHigh: 1.31429, swingLow: 1.30096, candles: gbpWeek() }).reordered, false); // high first, low later = down-leg: bearish agrees
  assert.equal(chooseLegFrame({ direction: "bearish", swingHigh: 1.31429, swingLow: 1.30096, candles: gbpWeek() }).reason, "order_agrees_with_bias");
  assert.equal(chooseLegFrame({ direction: "range", swingHigh: 1.31429, swingLow: 1.30096, candles: gbpWeek() }).reordered, false);
  const up = [bar(hour(23, 0), 1.301, 1.3), bar(hour(23, 1), 1.302, 1.3005), bar(hour(23, 2), 1.303, 1.301), bar(hour(23, 3), 1.304, 1.302), bar(hour(23, 4), 1.305, 1.303), bar(hour(23, 5), 1.306, 1.304)];
  assert.equal(chooseLegFrame({ direction: "bullish", swingHigh: 1.306, swingLow: 1.3, candles: up }).reason, "order_agrees_with_bias");
});

test("candles that do not cover the frame, too few candles, or a short leg leave the frame alone", () => {
  assert.equal(chooseLegFrame({ direction: "bullish", swingHigh: 1.35, swingLow: 1.30096, candles: gbpWeek() }).reason, "candles_do_not_cover_frame");
  assert.equal(chooseLegFrame({ direction: "bullish", swingHigh: 1.31429, swingLow: 1.30096, candles: gbpWeek().slice(0, 4) }).reason, "not_enough_candles");
  assert.equal(chooseLegFrame({ direction: "bullish", swingHigh: 1.31429, swingLow: 1.30096, candles: [] }).reason, "not_enough_candles");
  // after the low the price only recovers a little: not an impulse leg
  const weak = gbpWeek().slice(0, 25).concat([bar(hour(24, 0), 1.3050, 1.3020), bar(hour(24, 1), 1.3055, 1.3030), bar(hour(24, 2), 1.3050, 1.3028), bar(hour(24, 3), 1.3052, 1.3030)]);
  assert.equal(chooseLegFrame({ direction: "bullish", swingHigh: 1.31429, swingLow: 1.30096, candles: weak }).reason, "leg_too_short");
});

test("the server applies the leg frame inside the ranking function, with an off switch and a log line", () => {
  const src = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.match(src, /import \{ chooseLegFrame \} from "\.\/leg-frame\.js";/);
  assert.match(src, /LEG_FRAME/);
  assert.match(src, /\[leg-frame\]/);
  assert.match(src, /swingHigh: legFrame\?\.reordered \? legFrame\.swingHigh : visibleWeekHigh,/);
});

test("the first-hour rollback no longer flags the last (yesterday's) period partial, with an off switch", () => {
  const src = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.match(src, /FIRST_HOUR_LAST_PERIOD_COMPLETE/);
  assert.match(src, /chartCutoff\?\.source === "chart-first-hour-previous-day"/);
  assert.match(src, /lastPeriod\.partialPeriod=rolledBackLastPeriodComplete\?lastPeriod\.partialPeriod===true:true/);
});
