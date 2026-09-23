/**
 * Screenshot-to-candle period map.
 *
 * This deliberately maps a timestamp to a chart x-position by candle index,
 * never by elapsed screen time.  That prevents weekend/market-closure gaps
 * from moving a Monday/Tuesday/Wednesday boundary to the wrong candle.
 */
import { calendarMapping, normalizeFrameworkTimeframe } from "./framework-calendar.js";

// Every timeframe this map supports, plus the candle length it needs for
// the current-period extrapolation fallback below. D1 follows the exact
// same "map by candle index" approach H4 already uses one level up (H4's
// candles are 4h and its periods are weeks; D1's candles are 1 day and its
// periods are months) - not a separate mechanism, just a different grouping.
const SUPPORTED = new Set(["M1", "M5", "M15", "M30", "H1", "H4", "D1"]);
const CANDLE_MINUTES = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 };
const iso = (value) => String(value || "").replace("T", " ").slice(0, 19);
const instant = (value) => {
  const text = iso(value);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return NaN;
  return Date.parse(`${text.replace(" ", "T")}Z`);
};
const dateOnly = (value) => iso(value).slice(0, 10);
const monday = (date) => {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};
const monthStart = (date) => `${date.slice(0, 7)}-01`;
const weekLabel = (date) => `Week of ${monday(date)}`;
const monthLabel = (date) => new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const sameMoment = (a, b) => Number.isFinite(instant(a)) && instant(a) === instant(b);

function periodKey(timeframe, timestamp) {
  const date = dateOnly(timestamp);
  if (!date) return null;
  if (["M1", "M5", "M15", "M30", "H1"].includes(timeframe)) return date;
  if (timeframe === "H4") return monday(date);
  if (timeframe === "D1") return monthStart(date);
  return null;
}

function periodLabel(timeframe, key) {
  if (timeframe === "H4") return weekLabel(key);
  if (timeframe === "D1") return monthLabel(key);
  return new Date(`${key}T00:00:00Z`).toLocaleString("en-US", { weekday: "long", timeZone: "UTC" });
}

function startTimestamp(timeframe, key) {
  return `${key} 00:00:00`;
}

// Steps forward from `fromIso` by whole candle intervals until `toIso` is
// reached exactly, skipping weekend calendar days the same way the chart's
// own candles do. Used only to extrapolate a boundary's pixel position when
// its very first candle has not been posted by the data provider yet - the
// current framework period's start is still a fixed, known instant even
// though the provider hasn't caught up to it, so it should not have to wait
// on a candle that may not exist for minutes.
function candleStepsBetween(fromIso, toIso, minutes, tradesOnWeekends) {
  let t = instant(fromIso);
  const target = instant(toIso);
  if (!Number.isFinite(t) || !Number.isFinite(target) || !(minutes > 0) || target <= t) return null;
  let steps = 0;
  while (t < target) {
    do { t += minutes * 60000; } while (!tradesOnWeekends && [0, 6].includes(new Date(t).getUTCDay()));
    steps += 1;
    if (steps > 20000) return null;
  }
  return t === target ? steps : null;
}

/**
 * Builds the auditable map used by the period inventory, Fib frame and chart
 * overlay. A verified result requires a three-anchor raster calibration and
 * a precise cutoff. Without both, callers must present diagnostics only.
 */
export function buildChartPeriodMap({
  timeframe = "",
  candles = [],
  chartCutoff = {},
  axisCalibration = null,
  tradesOnWeekends = false,
} = {}) {
  const tf = normalizeFrameworkTimeframe(timeframe);
  const cutoff = iso(chartCutoff?.endDateTime || "");
  const cutoffMs = instant(cutoff);
  const values = (Array.isArray(candles) ? candles : [])
    .map((candle, index) => ({ ...candle, _index: index, _timestamp: iso(candle?.datetime) }))
    .filter((candle) => Number.isFinite(instant(candle._timestamp)))
    .sort((a, b) => instant(a._timestamp) - instant(b._timestamp));
  const calibration = axisCalibration && Array.isArray(axisCalibration.anchors)
    ? axisCalibration
    : null;
  const anchors = calibration?.anchors
    ?.filter((anchor) => Number.isFinite(Number(anchor?.x)) && Number.isFinite(instant(anchor?.timestamp))) || [];
  const exactCutoff = chartCutoff?.exactVisibleCutoff === true && Number.isFinite(cutoffMs);
  const bars = values.filter((candle) => !Number.isFinite(cutoffMs) || instant(candle._timestamp) <= cutoffMs);
  const firstExcluded = values.find((candle) => Number.isFinite(cutoffMs) && instant(candle._timestamp) > cutoffMs) || null;
  const lastIncluded = bars.at(-1) || null;
  const map = calendarMapping(tf, dateOnly(cutoff), {tradesOnWeekends});
  const reasons = [];
  if (!SUPPORTED.has(tf)) reasons.push("period-map currently applies to M1–H4 and D1 charts only");
  if (!exactCutoff) reasons.push("exact cutoff timestamp is missing or not chart-verified");
  // The chart's printed axis labels span its full visible history (often
  // several weeks), but the fetched provider candles are deliberately
  // narrowed to the current framework period only. An axis label from
  // before that window will never have a matching provider candle — that's
  // expected, not a calibration failure, so only anchors that actually fall
  // inside the fetched candle range are required to match one.
  const barsStartMs = bars.length ? instant(bars[0]._timestamp) : NaN;
  const barsEndMs = bars.length ? instant(bars.at(-1)._timestamp) : NaN;
  const usableAnchors = Number.isFinite(barsStartMs) && Number.isFinite(barsEndMs)
    ? anchors.filter((anchor) => {
        const t = instant(anchor.timestamp);
        return Number.isFinite(t) && t >= barsStartMs && t <= barsEndMs;
      })
    : anchors;
  const terminalCalibration = calibration?.terminalAnchor === true && usableAnchors.length === 1;
  // The three-anchor confidence bar is about the axis calibration itself
  // (how many pixel-verified tick-to-timestamp mappings the chart reader
  // found), so it must use the full anchor count. A chart with a long
  // printed history (BNBUSD's H4 chart spans ~7 weeks) can easily have all
  // but one or two of those anchors fall before the current framework's
  // fetch window - that's expected narrowing, not a weak calibration, and
  // must not fail this bar just because usableAnchors ended up small too.
  if (anchors.length < 3 && !terminalCalibration) reasons.push("at least three timestamped x-axis anchors are required");
  if (!(Number(calibration?.candleStep) > 0)) reasons.push("candle spacing could not be calibrated");
  if (!bars.length) reasons.push("no provider candles were available at or before the cutoff");
  else if (anchors.length && !usableAnchors.length) reasons.push("no printed axis anchor falls within the fetched candle range");

  const byTimestamp = new Map(bars.map((candle, index) => [candle._timestamp, { candle, index }]));
  const anchorIndexes = usableAnchors.map((anchor) => ({ ...anchor, row: byTimestamp.get(iso(anchor.timestamp)) || null }));
  if (usableAnchors.length > 0 && anchorIndexes.some((anchor) => !anchor.row)) {
    reasons.push("one or more chart time anchors did not match the fetched selected-timeframe candles");
  }
  const usableCalibration = reasons.length === 0;
  const minutes = CANDLE_MINUTES[tf] || null;
  const screenXFor = (timestamp) => {
    const row = byTimestamp.get(iso(timestamp));
    const reference = anchorIndexes.find((anchor) => anchor.row);
    if (!reference || !usableCalibration) return null;
    if (row) return Number(reference.x) + (row.index - reference.row.index) * Number(calibration.candleStep);
    // No provider candle at this exact timestamp - most commonly the very
    // first candle of a period that has only just begun. Extrapolate from
    // the latest available candle instead of leaving the boundary
    // unpositioned; candleStepsBetween only succeeds for a timestamp after
    // that candle, so this never fires for a genuinely missing/invalid one.
    const lastBar = bars.at(-1);
    const lastRow = lastBar ? byTimestamp.get(lastBar._timestamp) : null;
    if (!lastRow || !minutes) return null;
    const steps = candleStepsBetween(lastBar._timestamp, timestamp, minutes, tradesOnWeekends);
    if (steps === null) return null;
    return Number(reference.x) + (lastRow.index + steps - reference.row.index) * Number(calibration.candleStep);
  };
  const keys = map?.dates || [];
  const periodStarts = keys.map((key) => {
    const expectedStart = startTimestamp(tf, key);
    const first = bars.find((candle) => periodKey(tf, candle._timestamp) === key) || null;
    const isCurrent = key === keys.at(-1);
    // The current period's own start is a fixed instant regardless of
    // whether its first candle has posted yet; fall back to that expected
    // boundary so a brand-new period still gets a chart overlay position.
    const positionTimestamp = first?._timestamp || (isCurrent ? expectedStart : null);
    const resolvedScreenX = positionTimestamp ? screenXFor(positionTimestamp) : null;
    return {
      period: periodLabel(tf, key), key, startTimestamp: first?._timestamp || expectedStart,
      expectedStartTimestamp: expectedStart,
      screenX: resolvedScreenX,
      status: isCurrent ? "in_progress" : "completed",
      candleIndex: first ? byTimestamp.get(first._timestamp)?.index ?? null : null,
      mapped: Boolean(resolvedScreenX !== null),
      selectable: usableCalibration && !isCurrent && Boolean(first),
    };
  });
  if (usableCalibration && periodStarts.some((period) => period.status === "completed" && !period.mapped)) {
    reasons.push("a completed framework period has no candle-index boundary");
  }
  const status = reasons.length ? "unverified" : "verified";
  return {
    version: "1.0.0", status,
    confidence: status === "verified" ? "high" : "low",
    authority: status === "verified" ? "chart_timestamp_anchors_plus_selected_timeframe_candle_indices" : "diagnostic_only",
    mappingMethod: "provider timestamp matched to chart by candle index; no elapsed-screen-time interpolation",
    cutoff: {
      timestamp: cutoff || null,
      exact: exactCutoff,
      lastIncludedTimestamp: lastIncluded?._timestamp || null,
      firstExcludedTimestamp: firstExcluded?._timestamp || null,
      screenX: lastIncluded ? screenXFor(lastIncluded._timestamp) : null,
    },
    axisCalibration: calibration ? {
      candleStep: Number(calibration.candleStep) || null,
      lastCandleX: Number(calibration.lastCandleX) || null,
      anchors: anchors.map((anchor) => ({ x: Number(anchor.x), timestamp: iso(anchor.timestamp) })),
    } : null,
    framework: map ? { range: map.range, unit: map.unit, start: map.start, cutoff: map.cutoff } : null,
    periodStarts,
    canUseForPeriodInventory: status === "verified",
    canUseForFibonacci: status === "verified",
    canSelectEntries: status === "verified",
    limitations: reasons,
    diagnostics: {
      providerCandleCount: values.length,
      includedCandleCount: bars.length,
      matchedAnchorCount: anchorIndexes.filter((anchor) => anchor.row).length,
      allAnchorsMatchProviderCandles: anchors.length > 0 && anchorIndexes.every((anchor) => anchor.row),
      terminalCalibration,
      weekendSafe: true,
    },
  };
}

export const chartPeriodMapSameTimestamp = sameMoment;
