/**
 * Screenshot-to-candle period map.
 *
 * This deliberately maps a timestamp to a chart x-position by candle index,
 * never by elapsed screen time.  That prevents weekend/market-closure gaps
 * from moving a Monday/Tuesday/Wednesday boundary to the wrong candle.
 */
import { calendarMapping, normalizeFrameworkTimeframe } from "./framework-calendar.js";

const INTRADAY = new Set(["M1", "M5", "M15", "M30", "H1", "H4"]);
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
const weekLabel = (date) => `Week of ${monday(date)}`;
const sameMoment = (a, b) => Number.isFinite(instant(a)) && instant(a) === instant(b);

function periodKey(timeframe, timestamp) {
  const date = dateOnly(timestamp);
  if (!date) return null;
  if (["M1", "M5", "M15", "M30", "H1"].includes(timeframe)) return date;
  if (timeframe === "H4") return monday(date);
  return null;
}

function periodLabel(timeframe, key) {
  if (timeframe === "H4") return weekLabel(key);
  return new Date(`${key}T00:00:00Z`).toLocaleString("en-US", { weekday: "long", timeZone: "UTC" });
}

function startTimestamp(timeframe, key) {
  return `${key} 00:00:00`;
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
  if (!INTRADAY.has(tf)) reasons.push("period-map currently applies to intraday M1–H4 charts only");
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
  if (usableAnchors.length < 3 && !terminalCalibration) reasons.push("at least three timestamped x-axis anchors are required");
  if (!(Number(calibration?.candleStep) > 0)) reasons.push("candle spacing could not be calibrated");
  if (!bars.length) reasons.push("no provider candles were available at or before the cutoff");

  const byTimestamp = new Map(bars.map((candle, index) => [candle._timestamp, { candle, index }]));
  const anchorIndexes = usableAnchors.map((anchor) => ({ ...anchor, row: byTimestamp.get(iso(anchor.timestamp)) || null }));
  if ((usableAnchors.length >= 3 || terminalCalibration) && anchorIndexes.some((anchor) => !anchor.row)) {
    reasons.push("one or more chart time anchors did not match the fetched selected-timeframe candles");
  }
  const usableCalibration = reasons.length === 0;
  const screenXFor = (timestamp) => {
    const row = byTimestamp.get(iso(timestamp));
    const reference = anchorIndexes.find((anchor) => anchor.row);
    if (!row || !reference || !usableCalibration) return null;
    return Number(reference.x) + (row.index - reference.row.index) * Number(calibration.candleStep);
  };
  const keys = map?.dates || [];
  const periodStarts = keys.map((key) => {
    const expectedStart = startTimestamp(tf, key);
    const first = bars.find((candle) => periodKey(tf, candle._timestamp) === key) || null;
    const isCurrent = key === keys.at(-1);
    return {
      period: periodLabel(tf, key), key, startTimestamp: first?._timestamp || expectedStart,
      expectedStartTimestamp: expectedStart,
      screenX: first ? screenXFor(first._timestamp) : null,
      status: isCurrent ? "in_progress" : "completed",
      candleIndex: first ? byTimestamp.get(first._timestamp)?.index ?? null : null,
      mapped: Boolean(first && screenXFor(first._timestamp) !== null),
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
