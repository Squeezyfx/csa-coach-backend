/**
 * OHLC shape alignment between a broker screenshot's final candle and a
 * provider candle.
 *
 * Matching on close alone is unsafe: a later candle can close at the same
 * price by coincidence. XAUUSD 2026-09-09 is the reference failure. The chart's
 * 08:00 candle (O 4419.21 H 4420.99 L 4411.43 C 4412.50) was matched to the
 * provider's 13:00 candle because their closes differed by 0.50. That pulled
 * five hours of post-screenshot data into the analysis. The provider's 08:00
 * candle sits a steady ~+10.8 below the broker on all four prices, which is
 * what a feed offset looks like.
 *
 * A broker feed differs from the provider by a near-constant offset. So:
 *   offset   = median of the four (chart - provider) differences
 *   residual = largest deviation of any single difference from that offset
 * A true match has a small residual, whatever the offset. A coincidental
 * close match has a large one.
 */

/** Same bound as the server's same-instrument check. */
export const MAX_FEED_OFFSET_RATIO = 0.005;

const FIELDS = ["open", "high", "low", "close"];

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Returns {open, high, low, close} or null unless all four are usable. */
export function visibleOhlcFromDetection(detection = {}) {
  const o = {
    open: num(detection?.latestVisibleOpen),
    high: num(detection?.latestVisibleHigh),
    low: num(detection?.latestVisibleLow),
    close: num(detection?.latestVisibleClose ?? detection?.latestVisiblePrice),
  };
  if (FIELDS.some((f) => o[f] === null || o[f] <= 0)) return null;
  if (o.high < Math.max(o.open, o.close) || o.low > Math.min(o.open, o.close)) return null;
  return o;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Score one provider candle against the visible OHLC.
 * Returns null when the candle lacks usable prices.
 */
export function scoreOhlcAlignment(visible, candle) {
  if (!visible || !candle) return null;
  const diffs = {};
  for (const f of FIELDS) {
    const p = num(candle[f]);
    if (p === null) return null;
    diffs[f] = visible[f] - p;
  }
  const offset = median(Object.values(diffs));
  const residual = Math.max(...Object.values(diffs).map((d) => Math.abs(d - offset)));
  const offsetRatio = Math.abs(offset) / visible.close;
  return { diffs, offset, residual, offsetRatio };
}

/**
 * True when the candle is the same bar as the screenshot's final candle,
 * allowing a constant feed offset.
 *
 * A still-forming chart candle can be narrower than the provider's completed
 * bar. Callers that know the chart candle is live should pass partial: true.
 * In that case only the open must track the offset, and the chart's high and
 * low must sit inside the provider range (after removing the offset).
 */
export function ohlcAligned(visible, candle, tolerance, { partial = false } = {}) {
  const s = scoreOhlcAlignment(visible, candle);
  if (!s) return { aligned: false, reason: "incomplete_ohlc" };
  if (s.offsetRatio > MAX_FEED_OFFSET_RATIO) {
    return { aligned: false, reason: "offset_exceeds_same_instrument_bound", ...s };
  }
  if (!partial) {
    return s.residual <= tolerance
      ? { aligned: true, mode: "full_ohlc", ...s }
      : { aligned: false, reason: "ohlc_shape_mismatch", ...s };
  }
  const openOffset = s.diffs.open;
  const hi = num(candle.high) + openOffset;
  const lo = num(candle.low) + openOffset;
  const inside = visible.high <= hi + tolerance && visible.low >= lo - tolerance;
  return inside
    ? { aligned: true, mode: "partial_open_and_range", ...s, offset: openOffset }
    : { aligned: false, reason: "partial_candle_outside_provider_range", ...s };
}

/**
 * Best provider candle for the visible final candle. Candidates must pass
 * ohlcAligned. The tightest residual wins; ties go to the earlier candle,
 * because choosing a later bar is the direction that leaks future data.
 */
export function findOhlcAlignedCandle(candles = [], visible, tolerance, {
  accept = () => true,
} = {}) {
  if (!visible || !Array.isArray(candles)) return null;
  const hits = [];
  candles.forEach((candle, index) => {
    if (!accept(candle)) return;
    const r = ohlcAligned(visible, candle, tolerance);
    if (r.aligned) hits.push({ candle, index, ...r });
  });
  hits.sort((a, b) => a.residual - b.residual || a.index - b.index);
  return hits[0] || null;
}
