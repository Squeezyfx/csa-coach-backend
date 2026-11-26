// The Fibonacci frame follows the latest leg, not just the period's two extremes.
//
// The engine's frame is the period's highest high and lowest low. When the bias is bullish the retracement is
// measured down from the high, so the high has to come AFTER the low (an up-leg). GBPUSD H1, week of 23 Nov 2026:
// Monday's high (1.31429) came before Monday's low (1.30096), so "high minus 61.8%" described a down-leg the bias
// does not trade. The trader's Fibonacci was the up-leg from that Monday low to Wednesday's high (1.31286), whose
// 61.8% (1.30538) sits right at Wednesday's low zone.
//
// For a bullish bias whose period high came before its low, the frame becomes: the period low and the highest
// high at or after it. For a bearish bias whose period low came before its high: the period high and the lowest
// low at or after it. Anything else (the order already agrees with the bias, no candles, candles that do not
// cover the frame's extremes, a leg too short to be an impulse) leaves the frame untouched.

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function chooseLegFrame({
  direction = "range",
  swingHigh = null,
  swingLow = null,
  candles = [],
  // How far the candles' own extremes may sit from the frame's (feeds differ by a few pips).
  coverage = 0.04,
  // The leg must be at least this share of the full range to count as the impulse.
  minLegShare = 0.4,
} = {}) {
  const unchanged = (reason) => ({ reordered: false, reason, swingHigh: number(swingHigh), swingLow: number(swingLow) });
  if (!["bullish", "bearish"].includes(direction)) return unchanged("direction_not_directional");
  const high = number(swingHigh);
  const low = number(swingLow);
  if (high === null || low === null || high <= low) return unchanged("frame_not_usable");
  const range = high - low;

  const rows = (Array.isArray(candles) ? candles : [])
    .map((candle) => ({ time: candle?.datetime ?? null, high: number(candle?.high), low: number(candle?.low) }))
    .filter((row) => row.high !== null && row.low !== null && row.high >= row.low);
  if (rows.length < 6) return unchanged("not_enough_candles");
  // Candles must run oldest to newest; sort only when every row carries a comparable time.
  if (rows.every((row) => typeof row.time === "string")) rows.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  let highIndex = 0;
  let lowIndex = 0;
  rows.forEach((row, index) => {
    if (row.high >= rows[highIndex].high) highIndex = index; // the latest candle carrying the highest high
    if (row.low < rows[lowIndex].low) lowIndex = index; // the first candle carrying the lowest low
  });
  const candleHigh = rows[highIndex].high;
  const candleLow = rows[lowIndex].low;
  if (Math.abs(candleHigh - high) > range * coverage || Math.abs(candleLow - low) > range * coverage) {
    return unchanged("candles_do_not_cover_frame");
  }

  if (direction === "bullish") {
    if (highIndex > lowIndex) return unchanged("order_agrees_with_bias");
    const afterLow = rows.slice(lowIndex);
    const legCandleHigh = Math.max(...afterLow.map((row) => row.high));
    // Carry the feed difference between the candles and the frame onto the leg's extreme.
    const legHigh = legCandleHigh + (high - candleHigh);
    if (!(legHigh > low) || legHigh - low < range * minLegShare) return unchanged("leg_too_short");
    const legEnd = afterLow.find((row) => row.high === legCandleHigh);
    return {
      reordered: true,
      reason: "high_came_before_low",
      swingHigh: legHigh,
      swingLow: low,
      weekSwingHigh: high,
      weekSwingLow: low,
      legStart: rows[lowIndex].time,
      legEnd: legEnd?.time ?? null,
    };
  }

  if (lowIndex > highIndex) return unchanged("order_agrees_with_bias");
  const afterHigh = rows.slice(highIndex);
  const legCandleLow = Math.min(...afterHigh.map((row) => row.low));
  const legLow = legCandleLow + (low - candleLow);
  if (!(legLow < high) || high - legLow < range * minLegShare) return unchanged("leg_too_short");
  const legEnd = afterHigh.find((row) => row.low === legCandleLow);
  return {
    reordered: true,
    reason: "low_came_before_high",
    swingHigh: high,
    swingLow: legLow,
    weekSwingHigh: high,
    weekSwingLow: low,
    legStart: rows[highIndex].time,
    legEnd: legEnd?.time ?? null,
  };
}
