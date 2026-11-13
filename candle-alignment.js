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
 * Pick the provider candle matching the chart's final visible candle.
 *
 * A pure "smallest residual across the day" search is not safe on its own:
 * a broker's feed offset is not perfectly constant through a session, so a
 * distant candle's four diffs can occasionally cluster more tightly than the
 * true match's do, and win on residual alone even though it is obviously the
 * wrong hour. XAUUSD 2026-09-09 is a reference case for this: the 08:00
 * candle (correct, offset ~+11) has residual 1.73; the 23:00 candle (15
 * hours later, offset ~+18) has residual 1.38 and would win a plain search.
 *
 * When the chart itself suggested an hour (`preferredDatetime`, built from
 * whatever time-reading path ran, at any confidence level, since alignment
 * below is what actually validates it), that specific candle is checked
 * first and used if it aligns at all, before any broader search runs. Only
 * when there is no hour hint, or that hour does not exist in the provider
 * series, or it fails alignment there, does the search fall back to ranking
 * every candle in the window — the previous, riskier behaviour.
 */
export function pickAlignedCandle(candles = [], visible, tolerance, {
  accept = () => true,
  maxOffset = null,
  preferredDatetime = null,
  preferredTolerance = null,
} = {}) {
  if (preferredDatetime) {
    const index = candles.findIndex((c) => normalizeCandleDatetime(c?.datetime) === normalizeCandleDatetime(preferredDatetime));
    if (index !== -1 && accept(candles[index])) {
      // The broad ATR-based `tolerance` is sized for scanning an entire day
      // and is too generous to validate one specific hour on its own: an
      // adjacent, wrong hour's residual can still land inside it. XAUUSD
      // 2026-09-09 is a direct case — 08:00 (correct) has residual 1.74;
      // 09:00, the wrong hour the chart reader actually reported that run,
      // has residual 2.71 and would pass the day-scan tolerance (4.52)
      // anyway. `preferredTolerance`, a tighter price-proportional bound
      // when supplied, is what actually separates them. Falls back to the
      // day-scan tolerance for callers that don't have a tighter one.
      const r = ohlcAligned(visible, candles[index], preferredTolerance ?? tolerance, { maxOffset });
      if (r.aligned) return { candle: candles[index], index, ...r, preferred: true };
    }
  }
  return findOhlcAlignedCandle(candles, visible, tolerance, { accept, maxOffset });
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

/**
 * Verify the data feed from the chart HEADER when the header is not the last candle.
 *
 * With the mouse pointer on the chart the header prints the candle under the pointer, so the
 * last-candle OHLC is unknown and reconcileChartDataMatch (which looks only next to the last
 * provider candle) cannot confirm the match: the review then stays "date_unverified" and loses
 * levels. The header's four prices still identify one real candle, which proves the provider data
 * is this chart's own dataset and gives the feed offset. That offset, applied to the provider's
 * newest close, must land near the chart's last-price tag. All of these must hold: a tight shape
 * fit, no second candle in the recent window that fits nearly as well (a coincidence), and an
 * offset consistent with the last price. When any fails nothing is changed. onDiagnostic receives
 * the outcome either way so it can be logged and tuned against real charts.
 *
 * Only ever upgrades an unverified status; it never downgrades or changes a match.
 */
export const HEADER_FEED_WINDOW = 250;

export function reconcileWithHeaderFeedOffset({
  chartDataMatch, candles = [], header = null, lastClose = null, tolerance, maxOffset = null, window: windowSize = HEADER_FEED_WINDOW,
  onDiagnostic = null,
} = {}) {
  if (!chartDataMatch || !["mismatch", "date_unverified", "time_unverified", "partial_or_unknown_candle"]
    .includes(chartDataMatch.status)) {
    return chartDataMatch;
  }
  const visible = visibleOhlcFromDetection({
    latestVisibleOpen: header?.open, latestVisibleHigh: header?.high,
    latestVisibleLow: header?.low, latestVisibleClose: header?.close,
  });
  const tag = num(lastClose);
  if (!visible || tag === null || tag <= 0 || !(Number(tolerance) > 0)) return chartDataMatch;

  const rows = (Array.isArray(candles) ? candles : [])
    .filter((c) => c && c.datetime && FIELDS.every((f) => num(c[f]) !== null))
    .sort((a, b) => (normalizeCandleDatetime(a.datetime) < normalizeCandleDatetime(b.datetime) ? -1 : 1));
  if (rows.length < 2) return chartDataMatch;
  const newestClose = num(rows[rows.length - 1].close);

  const recent = rows.slice(-windowSize);
  const hits = [];
  for (const candle of recent) {
    const r = ohlcAligned(visible, candle, tolerance, { maxOffset });
    if (r.aligned) hits.push({ candle, ...r });
  }
  const finish = (reason, extra = {}) => {
    if (typeof onDiagnostic === "function") {
      onDiagnostic({ reason, hits: hits.length, window: recent.length, ...extra });
    }
    return chartDataMatch;
  };
  if (!hits.length) return finish("no_candle_fits_header");
  hits.sort((a, b) => a.residual - b.residual);
  const hit = hits[0];
  // A true match is a tight fit (real feeds differ by a pip or two at most once the constant
  // offset is removed); a loose fit across a wide window is how coincidences happen.
  if (hit.residual > tolerance * 0.5) return finish("best_fit_too_loose", { residual: hit.residual });
  // No second candle may fit nearly as well: that would make the choice a coincidence. A loose
  // fit needs a wide gap to the runner-up. An EXACT fit (all four prices differ from the provider
  // candle by the same constant, to within a fraction of a tick) is very hard to get by chance, so
  // a smaller gap is enough. The 2026-10-23 EURUSD case: residual 0, runner-up 1.75 pips away.
  const runnerUp = hits[1];
  if (runnerUp) {
    const gap = runnerUp.residual - hit.residual;
    const exactFit = hit.residual <= tolerance * 0.02;
    const clear = gap >= tolerance * 0.5 || (exactFit && gap >= tolerance * 0.08);
    if (!clear) {
      return finish("ambiguous_match", { residual: hit.residual, runnerUp: runnerUp.residual });
    }
  }
  // The offset must be broadly consistent with the chart's last price. A feed offset drifts a
  // little through the week, so this check is wider than the shape check above.
  if (Math.abs(tag - (newestClose + hit.offset)) > tolerance * 3) {
    return finish("offset_does_not_reach_last_price", { offset: hit.offset });
  }
  if (typeof onDiagnostic === "function") {
    onDiagnostic({ reason: "upgraded", hits: hits.length, window: recent.length, residual: hit.residual, offset: hit.offset, headerCandle: hit.candle.datetime });
  }

  return {
    ...chartDataMatch,
    status: "matched_reference",
    matchMode: "header_feed_offset",
    feedOffset: hit.offset,
    ohlcResidual: hit.residual,
    headerCandleDate: hit.candle.datetime,
    priorStatus: chartDataMatch.status,
    reason: "The chart header identified one real provider candle, and its feed offset carries through to the chart's last price.",
  };
}

/**
 * Verify the data feed when the screenshot runs PAST the cutoff the user chose.
 *
 * Exact historical time and End of selected day review a past moment on a chart that may
 * continue well beyond it (back-testing). The provider candles stop at the cutoff, so the
 * chart's final candle is not among them and the ordinary check calls the feed "unverified",
 * which drops the market data and leaves a review read from the picture alone.
 *
 * The chart header's four prices identify one real candle. When that candle is found in the
 * provider data AFTER the cutoff, the chart is this provider's own dataset (same instrument,
 * same dates, a constant feed offset). The candles used for the review stay the ones up to the
 * cutoff: the later candles are only evidence for the match and are never returned for analysis.
 * The safety rules: a tight shape fit, an offset within the same-instrument bound, and a fit
 * that is selective (not most of the later candles). Unlike the header check above, a second
 * candle that fits almost as well does not block the match, because only the feed is being
 * proven here, not which candle the header shows. Only a candle after the cutoff counts; a
 * header that matches nothing later leaves the status as it was.
 *
 * Short windows (a screenshot taken hours after the cutoff has only a few later candles) are judged
 * at a tight tolerance instead, with the provider's still-forming candle as one more possible match:
 * the loose ATR tolerance fits most of a few quiet candles (AUDUSD 13 Nov: 8 of 12) and used to end
 * in "fit_not_selective", dropping the market data. A tight fit by one or two candles is enough.
 */
export function verifyFeedPastCutoff({
  chartDataMatch, candles = [], header = null, cutoff = "", tolerance, maxOffset = null, onDiagnostic = null,
  forming = null, selectiveTolerance = null,
} = {}) {
  if (!chartDataMatch || !["mismatch", "date_unverified", "time_unverified", "partial_or_unknown_candle"]
    .includes(chartDataMatch.status)) {
    return chartDataMatch;
  }
  const visible = visibleOhlcFromDetection({
    latestVisibleOpen: header?.open, latestVisibleHigh: header?.high,
    latestVisibleLow: header?.low, latestVisibleClose: header?.close,
  });
  const limit = normalizeCandleDatetime(cutoff);
  if (!visible || !limit || !(Number(tolerance) > 0)) return chartDataMatch;

  const later = (Array.isArray(candles) ? candles : [])
    .filter((c) => c && c.datetime && FIELDS.every((f) => num(c[f]) !== null) && normalizeCandleDatetime(c.datetime) > limit);
  const hits = [];
  for (const candle of later) {
    const r = ohlcAligned(visible, candle, tolerance, { maxOffset });
    if (r.aligned) hits.push({ candle, ...r });
  }
  // The still-forming candle (the provider's incomplete latest one) is what a live screenshot's
  // header usually shows. Its range only grows, so it must contain the header's high and low, and
  // its open must track the header's open; that is judged at the tight tolerance below.
  const tightTolerance = Number(selectiveTolerance) > 0 ? Number(selectiveTolerance) : tolerance * 0.25;
  let formingHit = null;
  if (forming && forming.datetime && FIELDS.every((f) => num(forming[f]) !== null) &&
      normalizeCandleDatetime(forming.datetime) > limit) {
    const r = ohlcAligned(visible, forming, tightTolerance, { partial: true, maxOffset });
    if (r.aligned) formingHit = { candle: forming, ...r };
  }
  const finish = (reason, extra = {}) => {
    if (typeof onDiagnostic === "function") onDiagnostic({ reason, hits: hits.length, window: later.length, forming: Boolean(formingHit), ...extra });
    return chartDataMatch;
  };
  const upgrade = (hit, basis, extra = {}) => {
    if (typeof onDiagnostic === "function") {
      onDiagnostic({ reason: "upgraded", basis, hits: hits.length, window: later.length, residual: hit.residual, offset: hit.offset, headerCandle: hit.candle.datetime, ...extra });
    }
    return {
      ...chartDataMatch,
      status: "matched_reference",
      matchMode: "header_feed_past_cutoff",
      feedOffset: hit.offset,
      ohlcResidual: hit.residual,
      headerCandleDate: hit.candle.datetime,
      // The comparison that proved the feed: the header against the candle it identified.
      comparisons: FIELDS.map((field) => ({ field, chart: visible[field], provider: num(hit.candle[field]) })),
      tolerance,
      priorStatus: chartDataMatch.status,
      reason: "The screenshot runs past the chosen cutoff. Its header identified a real provider candle after the cutoff, so the feed is the chart's own; the review still uses only candles up to the cutoff.",
    };
  };
  if (!later.length && !formingHit) return finish("no_candles_after_cutoff");
  if (!hits.length && !formingHit) return finish("no_candle_after_cutoff_fits_header");
  hits.sort((a, b) => a.residual - b.residual || (normalizeCandleDatetime(a.candle.datetime) < normalizeCandleDatetime(b.candle.datetime) ? -1 : 1));
  const hit = hits[0] || null;
  // The candle's identity is not used (only that the chart is this feed), so a second candle that
  // fits nearly as well does not matter: on a quiet session several hourly candles look alike
  // within an ATR-scaled tolerance. What does matter is that the fit is selective. A shape that
  // fits most of the later candles proves nothing about the feed.
  if (hit && hit.residual <= tolerance * 0.5 && hits.length <= later.length * 0.5) return upgrade(hit, "loose_fit");

  // Short windows: a screenshot taken hours after the cutoff has only a few later candles, and a
  // small still-forming header fits most of them within the loose tolerance (AUDUSD, 13 Nov: 8 of
  // 12). Judge selectivity at the tight tolerance instead: only a candle that fits to a fraction of
  // the loose tolerance counts, and it must be one of very few.
  const tightHits = hits.filter((h) => h.residual <= tightTolerance);
  const tightCount = tightHits.length + (formingHit ? 1 : 0);
  if (tightCount >= 1 && tightCount <= Math.max(2, Math.floor(later.length * 0.25))) {
    const proof = tightHits[0] && (!formingHit || tightHits[0].residual <= formingHit.residual) ? tightHits[0] : formingHit;
    return upgrade(proof, tightHits[0] === proof ? "tight_fit" : "forming_candle", { tightHits: tightHits.length });
  }
  if (hit && hit.residual > tolerance * 0.5 && !tightCount) return finish("best_fit_too_loose", { residual: hit.residual });
  return finish("fit_not_selective", { residual: hit ? hit.residual : null, tightHits: tightHits.length });
}

/**
 * How many days of recent candles to search when the date of a Final visible candle screenshot
 * could not be read. Only intraday and daily charts; weekly and monthly are left alone.
 */
export const FINAL_VISIBLE_LOOKBACK_DAYS = {
  "1min": 1,
  "5min": 2,
  "15min": 4,
  "30min": 6,
  "1h": 14,
  "4h": 30,
  "1day": 60,
};

/**
 * Finds the date of a screenshot from its prices when the chart's own date could not be read.
 *
 * The header's four prices (open, high, low, close of the last candle) are compared with recent
 * provider candles. A candle is only accepted when the match is unmistakable:
 *   - the chart's last price (the tag on the price axis) agrees with the header's close, so the
 *     header describes the last candle and not one the mouse pointer was resting on;
 *   - the shape fits within a tight tolerance (a few tenths of a pip's feed difference, not the
 *     loose ATR tolerance used elsewhere, which a quiet week satisfies by coincidence);
 *   - exactly one candle fits. A still-forming candle (the provider's incomplete latest candle)
 *     counts as a fit when its open tracks the header's open and the header's high and low sit
 *     inside it. If a completed candle and the forming one both fit, or several completed
 *     candles do, the answer is "ambiguous" and nothing is changed.
 *
 * Returns { ok, mode, candle, residual, offset, hits, reason }.
 */
export function locateFinalVisibleCandle({
  header = null, lastPrice = null, candles = [], forming = null, tolerance, maxOffset = null,
} = {}) {
  const visible = visibleOhlcFromDetection({
    latestVisibleOpen: header?.open, latestVisibleHigh: header?.high,
    latestVisibleLow: header?.low, latestVisibleClose: header?.close,
  });
  if (!visible) return { ok: false, reason: "no_header_prices" };
  if (!(Number(tolerance) > 0)) return { ok: false, reason: "no_tolerance" };
  const last = num(lastPrice);
  if (last === null || last <= 0) return { ok: false, reason: "no_last_price" };
  // A real last-candle header closes at the last price. If not, the pointer was on another candle.
  if (Math.abs(last - visible.close) > tolerance) return { ok: false, reason: "header_not_last_candle" };

  const usable = (Array.isArray(candles) ? candles : [])
    .filter((c) => c && c.datetime && FIELDS.every((f) => num(c[f]) !== null));
  const completed = [];
  for (const candle of usable) {
    const r = ohlcAligned(visible, candle, tolerance, { maxOffset });
    if (r.aligned) completed.push({ candle, ...r });
  }
  completed.sort((a, b) => a.residual - b.residual);

  let formingHit = null;
  if (forming && forming.datetime && FIELDS.every((f) => num(forming[f]) !== null)) {
    const r = ohlcAligned(visible, forming, tolerance, { partial: true, maxOffset });
    if (r.aligned) formingHit = { candle: forming, ...r };
  }

  if (completed.length === 1 && !formingHit) {
    return { ok: true, mode: "full_ohlc", candle: completed[0].candle, residual: completed[0].residual, offset: completed[0].offset, hits: 1 };
  }
  if (completed.length === 0 && formingHit) {
    return { ok: true, mode: "forming_partial", candle: formingHit.candle, residual: formingHit.residual, offset: formingHit.offset, hits: 1 };
  }
  // Several fit: the best must be clearly better, not just first (two identical fits are a tie).
  if (completed.length > 1 && !formingHit && completed[1].residual >= tolerance * 0.3 && completed[0].residual <= completed[1].residual * 0.35) {
    return { ok: true, mode: "full_ohlc", candle: completed[0].candle, residual: completed[0].residual, offset: completed[0].offset, hits: completed.length };
  }
  if (!completed.length && !formingHit) return { ok: false, reason: "no_candle_fits_header", window: usable.length };
  return { ok: false, reason: "ambiguous", hits: completed.length + (formingHit ? 1 : 0), window: usable.length };
}

function normalizeCandleDatetime(value = "") {
  return String(value || "").trim().replace("T", " ").slice(0, 19);
}
