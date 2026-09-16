/**
 * Framework period inventory, Fibonacci frame, and confluence entry selection.
 *
 * One rule, derived per chart, for every timeframe:
 *
 *   timeframe   Fib frame            period highs/lows
 *   H1          current week Mon-Fri each day
 *   H4          current month        each week (incl. the carry-in Monday)
 *   D1          current year         each month
 *
 * The frame is ALWAYS the current framework period only, never the whole
 * visible chart. Entries are period extremes that sit within tolerance of a
 * 38.2 / 50 / 61.8 retracement of that frame.
 *
 * Input is OHLC candles: [{ time: ISO string, high: number, low: number }].
 * Where a data provider covers the symbol these are exact. Where only a chart
 * raster exists, the same shape can be produced by the raster reader — this
 * module does not care which, and must never be given pixel coordinates.
 */

// ---------------------------------------------------------------- constants

/**
 * Fib levels sit 11.8% of the frame range apart (38.2 -> 50 -> 61.8), so any
 * tolerance at or above 5.9% lets one price claim two levels. 3% keeps every
 * match unambiguous with room to spare, and is expressed against the frame
 * range because the levels themselves are fractions of that same range —
 * a volatility measure such as ATR would introduce an unrelated second scale.
 */
export const DEFAULT_CONFLUENCE_RATIO = 0.03;
export const MAX_CONFLUENCE_RATIO = 0.058;

/** Below this many completed periods the frame is too thin to trust. */
export const PROVISIONAL_PERIOD_COUNT = 3;
/** Below this, there is no usable frame at all. */
export const MINIMUM_PERIOD_COUNT = 2;

const FIB_RATIOS = [
  { ratio: 0.382, name: "38.2" },
  { ratio: 0.5, name: "50.0" },
  { ratio: 0.618, name: "61.8" },
];

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// ------------------------------------------------------------------- scope

/** Which framework period frames the Fib, and which sub-period yields extremes. */
export function frameworkScope(timeframe) {
  switch (String(timeframe || "").toUpperCase()) {
    case "H1": return { frame: "week", period: "day" };
    case "H4": return { frame: "month", period: "week" };
    case "D1": return { frame: "year", period: "month" };
    case "W1": return { frame: "year", period: "quarter" };
    default: return null;
  }
}

// ------------------------------------------------------------ period keying

function utc(d) {
  const t = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

/** Monday of the week containing d. Sunday belongs to the week that just ended. */
export function mondayOf(d) {
  const day = utc(d);
  const wd = day.getUTCDay();
  const back = wd === 0 ? 6 : wd - 1;
  day.setUTCDate(day.getUTCDate() - back);
  return day;
}

function periodKey(date, period) {
  const d = utc(date);
  switch (period) {
    case "day": return d.toISOString().slice(0, 10);
    case "week": return mondayOf(d).toISOString().slice(0, 10);
    case "month": return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    case "quarter": return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    default: throw new Error(`unknown period: ${period}`);
  }
}

function periodLabel(date, period) {
  const d = utc(date);
  switch (period) {
    case "day": return DOW[d.getUTCDay()];
    case "week": return `w/c ${d.getUTCDate()} ${MONTH[d.getUTCMonth()].slice(0, 3)}`;
    case "month": return MONTH[d.getUTCMonth()];
    case "quarter": return `Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    default: return "";
  }
}

// -------------------------------------------------------------- frame bounds

/**
 * Half-open [start, end) covering the framework period that contains `latest`.
 *
 * For a month frame, start is the Monday that OPENS the week containing the
 * 1st, even when that Monday falls in the previous month. That week is a real
 * period on the chart and owns the month's opening sessions — omitting it is
 * what makes expectedFrameworkPeriodDates disagree with its own count today.
 */
export function currentFrameBounds(timeframe, latest) {
  const scope = frameworkScope(timeframe);
  if (!scope) return null;
  const d = utc(latest);
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 1);

  if (scope.frame === "week") {
    return { start: mondayOf(d), end, frame: "week" };
  }
  if (scope.frame === "month") {
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    return { start: mondayOf(first), end, frame: "month" };
  }
  if (scope.frame === "year") {
    return { start: new Date(Date.UTC(d.getUTCFullYear(), 0, 1)), end, frame: "year" };
  }
  return null;
}

// ---------------------------------------------------------------- inventory

/**
 * Group candles into the timeframe's sub-periods, keeping only those inside
 * the current frame. Returns chronological order.
 */
export function buildPeriodInventory(candles = [], timeframe, latest = null) {
  const scope = frameworkScope(timeframe);
  if (!scope) return [];
  const usable = candles
    .filter((c) => c && Number.isFinite(Number(c.high)) && Number.isFinite(Number(c.low)) && c.time)
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  if (!usable.length) return [];

  const latestDate = latest ? utc(latest) : utc(usable[usable.length - 1].time);
  const bounds = currentFrameBounds(timeframe, latestDate);

  const groups = new Map();
  for (const c of usable) {
    const t = utc(c.time);
    if (t < bounds.start || t >= bounds.end) continue;
    const key = periodKey(t, scope.period);
    let g = groups.get(key);
    if (!g) {
      const anchor = scope.period === "week" ? mondayOf(t) : t;
      g = { key, date: key, label: periodLabel(anchor, scope.period),
            start: anchor, high: -Infinity, low: Infinity, candleCount: 0 };
      groups.set(key, g);
    }
    g.high = Math.max(g.high, Number(c.high));
    g.low = Math.min(g.low, Number(c.low));
    g.candleCount += 1;
  }

  const rows = [...groups.values()].sort((a, b) => a.start - b.start);
  // Mark in-progress by the period that CONTAINS the cutoff, not by position.
  // When a provider is missing the live candle the last returned row is a
  // completed period, and flagging it by position mislabels it — which then
  // excludes a finished period from structural selection.
  const livePeriodKey = periodKey(latestDate, scope.period);
  for (const row of rows) row.inProgress = row.key === livePeriodKey;
  return rows.map((r) => ({ ...r, start: r.start.toISOString().slice(0, 10) }));
}

// ------------------------------------------------------------------- frame

export function deriveFibFrame(periods = []) {
  const valid = periods.filter((p) => Number.isFinite(p.high) && Number.isFinite(p.low));
  if (valid.length < MINIMUM_PERIOD_COUNT) {
    return { verified: false, reason: "insufficient_frame_periods",
             periodCount: valid.length, required: MINIMUM_PERIOD_COUNT };
  }
  const highPeriod = valid.reduce((a, b) => (b.high > a.high ? b : a));
  const lowPeriod = valid.reduce((a, b) => (b.low < a.low ? b : a));
  const range = highPeriod.high - lowPeriod.low;
  if (!(range > 0)) return { verified: false, reason: "degenerate_range", periodCount: valid.length };
  return {
    verified: true,
    high: highPeriod.high,
    low: lowPeriod.low,
    range,
    highPeriod: { key: highPeriod.key, label: highPeriod.label },
    lowPeriod: { key: lowPeriod.key, label: lowPeriod.label },
    periodCount: valid.length,
    provisional: valid.length < PROVISIONAL_PERIOD_COUNT,
  };
}

export function fibLevels(frame) {
  if (!frame?.verified) return [];
  return FIB_RATIOS.map(({ ratio, name }) => ({
    ratio, name, price: frame.high - frame.range * ratio,
  }));
}

// -------------------------------------------------------------- confluence

/**
 * Period extremes that land on a retracement level.
 *
 * Two structural rules, neither of which needs a tuned constant:
 *
 *  - The frame's own high and low are 0% and 100%. They define the frame and
 *    cannot be a retracement of it, so they are never candidates.
 *  - Each Fib level is claimed at most once, by the tightest match. Because
 *    levels sit 11.8% of range apart, this guarantees entry separation for
 *    free — no minimum-distance threshold required.
 *
 * Ordering is by distance from current price, nearest first.
 */
export function findConfluenceEntries(periods, frame, {
  currentPrice = null,
  confluenceRatio = DEFAULT_CONFLUENCE_RATIO,
  maxEntries = 3,
} = {}) {
  if (!frame?.verified) {
    return { entries: [], reason: frame?.reason || "no_frame" };
  }
  const ratio = Math.min(Number(confluenceRatio) || DEFAULT_CONFLUENCE_RATIO, MAX_CONFLUENCE_RATIO);
  const tolerance = frame.range * ratio;
  const levels = fibLevels(frame);

  const isAnchor = (p, kind) =>
    (kind === "high" && p.key === frame.highPeriod.key && p.high === frame.high) ||
    (kind === "low" && p.key === frame.lowPeriod.key && p.low === frame.low);

  const matches = [];
  for (const p of periods) {
    for (const kind of ["high", "low"]) {
      const price = p[kind];
      if (!Number.isFinite(price) || isAnchor(p, kind)) continue;
      for (const lv of levels) {
        const gap = Math.abs(price - lv.price);
        if (gap <= tolerance) {
          matches.push({ periodKey: p.key, periodLabel: p.label, kind, price,
                         fibName: lv.name, fibRatio: lv.ratio, fibPrice: lv.price,
                         gap, inProgress: Boolean(p.inProgress) });
        }
      }
    }
  }

  // One entry per level: tightest gap wins, everything else on that level drops.
  const claimed = new Map();
  for (const m of matches.sort((a, b) => a.gap - b.gap)) {
    if (!claimed.has(m.fibName)) claimed.set(m.fibName, m);
  }

  const ref = Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : frame.high;
  const entries = [...claimed.values()]
    .map((m) => ({ ...m, distanceFromPrice: Math.abs(m.price - ref) }))
    .sort((a, b) => a.distanceFromPrice - b.distanceFromPrice)
    .slice(0, maxEntries)
    .map((m, i) => ({ order: i + 1, ...m }));

  return {
    entries,
    tolerance,
    confluenceRatio: ratio,
    levels,
    provisional: Boolean(frame.provisional),
    rejected: matches.length - claimed.size,
  };
}

// --------------------------------------------------------------- one-shot

export function analyseFrameworkEntries(candles, timeframe, {
  latest = null, currentPrice = null, confluenceRatio = DEFAULT_CONFLUENCE_RATIO,
} = {}) {
  const periods = buildPeriodInventory(candles, timeframe, latest);
  const frame = deriveFibFrame(periods);
  const result = findConfluenceEntries(periods, frame, { currentPrice, confluenceRatio });
  return { timeframe, scope: frameworkScope(timeframe), periods, frame, ...result };
}

/** Human-readable summary, in the "Monday high at 61.8%" form. */
export function describeEntries(analysis) {
  if (!analysis?.frame?.verified) {
    return `No frame: ${analysis?.frame?.reason || "unknown"}.`;
  }
  const f = analysis.frame;
  const lines = [
    `Frame (${analysis.scope.frame}): high ${f.high} (${f.highPeriod.label}), ` +
    `low ${f.low} (${f.lowPeriod.label}), range ${f.range.toFixed(5)}` +
    (f.provisional ? "  [provisional - thin frame]" : ""),
    ...analysis.levels.map((l) => `  ${l.name}%  ${l.price}`),
    "",
  ];
  if (!analysis.entries.length) lines.push("No period extreme within tolerance of a Fib level.");
  for (const e of analysis.entries) {
    lines.push(`E${e.order}: ${e.periodLabel} ${e.kind} ${e.price} at the ${e.fibName}% ` +
      `(${e.fibPrice.toFixed(5)}), gap ${e.gap.toFixed(5)}`);
  }
  return lines.join("\n");
}

// ------------------------------------------------- provider inventory rows

const SOURCE_UNIT = { day: "D1", week: "W1", month: "MN", quarter: "MN" };

/**
 * Convert an analysis into rows shaped for normalizeChartNativeEntryFallback.
 *
 * Two things the consumer requires that the internal rows do not carry:
 *  - `date` must be a full YYYY-MM-DD. The internal key for a month period is
 *    "2026-09", which the consumer's regex filter silently drops.
 *  - `sourceUnit` must be D1 / W1 / MN, matching the framework candle interval.
 */
export function toProviderInventoryRows(analysis) {
  if (!analysis?.periods?.length) return [];
  const unit = SOURCE_UNIT[analysis.scope?.period] || null;
  return analysis.periods.map((p) => ({
    coverageStart: p.start || null,
    periodLabel: p.label,
    sourceUnit: unit,
    date: p.start || null,
    high: p.high,
    low: p.low,
    highDate: null,
    lowDate: null,
    open: null,
    close: null,
    partialPeriod: Boolean(p.inProgress),
    periodLifecycle: p.inProgress ? "in_progress" : "completed",
    structures: [],
    priceSource: "provider_framework_candles",
  }));
}

/** Frame fields in the shape the fallback consumer expects. */
export function toProviderFrameFields(analysis) {
  const f = analysis?.frame;
  if (!f?.verified) return { currentPeriodFrameVerified: false };
  return {
    currentPeriodHigh: f.high,
    currentPeriodLow: f.low,
    currentWeekHigh: f.high,
    currentWeekLow: f.low,
    currentPeriodFrameVerified: true,
  };
}
