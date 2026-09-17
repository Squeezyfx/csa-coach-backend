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

/**
 * Default feed-offset bound when the caller does not supply a symbol-aware
 * one. Kept only as a fallback: a flat percentage of price is the wrong
 * shape for this check. A feed/broker offset is a roughly constant, small
 * absolute amount (a few pips), not a fraction of price, so it should not
 * scale with the instrument's price level. 0.5% of BTC at $78,000 is $390 —
 * larger than BTC often moves within one hourly candle — which is how an
 * unrelated candle passed as a "feed offset" match in the reference export.
 * Callers should pass `maxOffset` (an absolute price amount, e.g. a multiple
 * of their own per-symbol clean-break tolerance) instead of relying on this.
 */
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

function offsetWithinBound(offset, visibleClose, maxOffset) {
  return Number.isFinite(maxOffset)
    ? Math.abs(offset) <= maxOffset
    : Math.abs(offset) / visibleClose <= MAX_FEED_OFFSET_RATIO;
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
export function ohlcAligned(visible, candle, tolerance, { partial = false, maxOffset = null } = {}) {
  const s = scoreOhlcAlignment(visible, candle);
  if (!s) return { aligned: false, reason: "incomplete_ohlc" };
  if (!offsetWithinBound(s.offset, visible.close, maxOffset)) {
    return { aligned: false, reason: "offset_exceeds_same_instrument_bound", ...s };
  }
  if (!partial) {
    return s.residual <= tolerance
      ? { aligned: true, mode: "full_ohlc", ...s }
      : { aligned: false, reason: "ohlc_shape_mismatch", ...s };
  }
  // The partial check only needs the open to agree (the period hasn't moved
  // yet at its own start), so gate specifically on the open offset rather
  // than the median-of-four offset scoreOhlcAlignment computed for full mode.
  const openOffset = s.diffs.open;
  if (!offsetWithinBound(openOffset, visible.close, maxOffset)) {
    return { aligned: false, reason: "offset_exceeds_same_instrument_bound", ...s, offset: openOffset };
  }
  const hi = num(candle.high) + openOffset;
  const lo = num(candle.low) + openOffset;
  const inside = visible.high <= hi + tolerance && visible.low >= lo - tolerance;
  return inside
    ? { aligned: true, mode: "partial_open_and_range", ...s, offset: openOffset }
    : { aligned: false, reason: "partial_candle_outside_provider_range", ...s, offset: openOffset };
}

/**
 * Best provider candle for the visible final candle. Candidates must pass
 * ohlcAligned. The tightest residual wins; ties go to the earlier candle,
 * because choosing a later bar is the direction that leaks future data.
 */
export function findOhlcAlignedCandle(candles = [], visible, tolerance, {
  accept = () => true,
  maxOffset = null,
} = {}) {
  if (!visible || !Array.isArray(candles)) return null;
  const hits = [];
  candles.forEach((candle, index) => {
    if (!accept(candle)) return;
    const r = ohlcAligned(visible, candle, tolerance, { maxOffset });
    if (r.aligned) hits.push({ candle, index, ...r });
  });
  hits.sort((a, b) => a.residual - b.residual || a.index - b.index);
  return hits[0] || null;
}

/**
 * Correct a same-instrument chartDataMatch that a close-only comparison
 * flagged as unverified, when the chart's own OHLC actually matches a
 * provider candle.
 *
 * Two matches are checked, in order:
 *  1. Full-shape match near the candle the caller already identified
 *     (candleDate). Catches a broker feed offset that a plain close
 *     comparison mistook for a mismatch.
 *  2. Partial-candle match against that exact candle only. The chart's final
 *     candle can still be forming (screenshot taken mid-hour) while the
 *     provider's candle for the same hour has already closed; only the open
 *     is expected to track the feed offset, and the chart's high/low must sit
 *     inside the provider's completed range. This is GBPUSD 2026-09-09
 *     15:00 in the reference export: open matched to 2.9 pips, but the
 *     chart's high/low were narrower than the closed hourly bar because the
 *     hour had not finished when the screenshot was taken.
 *
 * Only ever upgrades a non-matching status to "matched_reference" or
 * "partial_reference" — an existing match is left alone, and no candle
 * search is widened for the partial check, so this cannot pick a
 * numerically-closer but wrong candle the way a close-only search can.
 */
export function reconcileChartDataMatch({
  chartDataMatch, candles = [], alignmentCandle = null, visibleOhlc, tolerance, maxOffset = null, windowSize = 2,
} = {}) {
  if (!chartDataMatch || !visibleOhlc || !["mismatch", "date_unverified", "time_unverified", "partial_or_unknown_candle"]
    .includes(chartDataMatch.status)) {
    return chartDataMatch;
  }
  // The candle assessChartDataMatch actually compared against may be the live,
  // still-forming candle OANDA returns through a separate alignment fetch,
  // not anything present in the regular candle series (that series omits
  // in-progress candles). Search it first so the anchor lookup below can
  // find it.
  const pool = alignmentCandle ? [...candles, alignmentCandle] : candles;
  const anchorIndex = pool.findIndex((c) => normalizeCandleDatetime(c?.datetime) === normalizeCandleDatetime(chartDataMatch.candleDate));
  if (anchorIndex === -1) return chartDataMatch;

  const window = pool
    .map((candle, index) => ({ candle, index }))
    .filter(({ index }) => Math.abs(index - anchorIndex) <= windowSize);
  const full = findOhlcAlignedCandle(window.map((w) => w.candle), visibleOhlc, tolerance, { maxOffset });
  if (full) {
    return { ...chartDataMatch, status: "matched_reference", matchMode: full.mode,
      feedOffset: full.offset, ohlcResidual: full.residual, candleDate: full.candle.datetime,
      priorStatus: chartDataMatch.status, reason: "OHLC shape matched a provider candle; the original close-only check missed a consistent feed offset." };
  }
  const anchorCandle = pool[anchorIndex];
  const partial = ohlcAligned(visibleOhlc, anchorCandle, tolerance, { partial: true, maxOffset });
  if (partial.aligned) {
    return { ...chartDataMatch, status: "partial_reference", matchMode: partial.mode,
      feedOffset: partial.offset, ohlcResidual: partial.residual,
      priorStatus: chartDataMatch.status, reason: "Chart candle was still forming; open and range fit inside the provider's completed candle for the same period." };
  }
  return chartDataMatch;
}

function normalizeCandleDatetime(value = "") {
  return String(value || "").trim().replace("T", " ").slice(0, 19);
}
