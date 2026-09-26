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
// W1/MN follow it one level further up again (W1's candles are 1 week and
// its periods are quarters; MN's candles are 1 month and its periods are
// years) - framework-calendar.js's calendarMapping already produces the
// quarter-start/year-start keys for both, this was purely missing here.
// MN's own candle length varies (28-31 days); 43200 (a nominal 30 days) is
// only ever used by the rare stepsPastHistory extrapolation fallback below
// (the current period's own first candle not having posted yet), never by
// the primary exact-candle-index lookup, so the imprecision there doesn't
// reach the normal path.
const SUPPORTED = new Set(["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"]);
const CANDLE_MINUTES = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440, W1: 10080, MN: 43200 };
const iso = (value) => String(value || "").replace("T", " ").slice(0, 19);
const instant = (value) => {
  let text = iso(value);
  // Twelve Data's daily-and-longer candles (confirmed on XAUUSD W1) come
  // back as a bare "YYYY-MM-DD", not "YYYY-MM-DD HH:MM:SS" - OANDA always
  // includes a time component, which is why this only ever surfaced on a
  // Twelve-Data-primary symbol. Without this, every candle silently failed
  // the shape check below and buildChartPeriodMap saw providerCandleCount:
  // 0 despite a non-empty candles array, so no anchor could ever match and
  // no period boundary/tick could be positioned.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text = `${text} 00:00:00`;
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
const quarterStart = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)).toISOString().slice(0, 10);
};
const yearStart = (date) => `${date.slice(0, 4)}-01-01`;
const weekLabel = (date) => `Week of ${monday(date)}`;
const monthLabel = (date) => new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const quarterLabel = (key) => {
  const d = new Date(`${key}T00:00:00Z`);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
};
const yearLabel = (key) => key.slice(0, 4);
const sameMoment = (a, b) => Number.isFinite(instant(a)) && instant(a) === instant(b);
// server.js's own period keying (getPeriodKeyAndLabel) is the format every
// OTHER consumer (chart-overlay.js's spanOf, periodStructureAudit) matches
// periods by: for quarterly-in-year (W1) that's a "YYYY-Qn" label, not a
// real date, while for yearly-in-multi-year (MN) it's the bare year - only
// D1/H4/daily-in-week already agree with framework-calendar.js's own
// date-string keys, which W1 does not. periodKey()/keys above stay
// date-based since that is what matching a real candle's timestamp needs;
// this converts only the final key handed back to callers, so the two
// systems refer to the same period by the same string.
function externalKey(timeframe, key) {
  if (timeframe === "W1") return `${key.slice(0, 4)}-${quarterLabelCode(key)}`;
  if (timeframe === "MN") return yearLabel(key);
  return key;
}
function quarterLabelCode(key) {
  const d = new Date(`${key}T00:00:00Z`);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

function periodKey(timeframe, timestamp) {
  const date = dateOnly(timestamp);
  if (!date) return null;
  if (["M1", "M5", "M15", "M30", "H1"].includes(timeframe)) return date;
  if (timeframe === "H4") return monday(date);
  if (timeframe === "D1") return monthStart(date);
  if (timeframe === "W1") return quarterStart(date);
  if (timeframe === "MN") return yearStart(date);
  return null;
}

function periodLabel(timeframe, key) {
  if (timeframe === "H4") return weekLabel(key);
  if (timeframe === "D1") return monthLabel(key);
  if (timeframe === "W1") return quarterLabel(key);
  if (timeframe === "MN") return yearLabel(key);
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
  if (!SUPPORTED.has(tf)) reasons.push("period-map currently applies to M1-H4, D1, W1 and MN charts only");
  if (!exactCutoff) reasons.push("exact cutoff timestamp is missing or not chart-verified");
  // The chart's printed axis labels span its full visible history (often
  // several weeks), but the fetched provider candles are deliberately
  // narrowed to the current framework period only. An axis label from
  // before that window will never have a matching provider candle — that's
  // expected, not a calibration failure, so only anchors that actually fall
  // inside the fetched candle range are required to match one.
  const barsStartMs = bars.length ? instant(bars[0]._timestamp) : NaN;
  const barsEndMs = bars.length ? instant(bars.at(-1)._timestamp) : NaN;
  const lastBar = bars.at(-1) || null;
  const minutes = CANDLE_MINUTES[tf] || null;
  // A terminal anchor (the single "last visible candle" reference used when
  // the chart's printed history far exceeds the fetch window - see
  // terminalCalibration below) is, by definition, the chart's CURRENT candle.
  // It can legitimately sit just past barsEndMs when that candle has only
  // just begun and the provider has not posted it yet - the exact same gap
  // screenXFor's own fallback extrapolates past further down. Accepting it
  // here too (bounded to a handful of candle-steps, never an unbounded
  // window) lets it still anchor the whole calibration instead of emptying
  // usableAnchors and failing the map outright over a candle that simply
  // has not arrived yet.
  const stepsPastHistory = (timestamp) => lastBar && minutes
    ? candleStepsBetween(lastBar._timestamp, timestamp, minutes, tradesOnWeekends)
    : null;
  const usableAnchors = Number.isFinite(barsStartMs) && Number.isFinite(barsEndMs)
    ? anchors.filter((anchor) => {
        const t = instant(anchor.timestamp);
        if (!Number.isFinite(t)) return false;
        if (t >= barsStartMs && t <= barsEndMs) return true;
        const steps = stepsPastHistory(anchor.timestamp);
        return steps !== null && steps <= 10;
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
  // A broker's chart server clock and the market-data provider's clock can
  // sit a few whole hours apart (e.g. GMT+2 vs GMT+3, or a provider that
  // aligns its own candle grid to UTC while the broker doesn't) - the
  // anchor's DATE is unaffected (periodKey matching below only ever
  // compares dates, not times), but its exact HH:MM:SS never matches a
  // real fetched candle, even though both sides are individually correct.
  // Confirmed against a real H4 chart: axis anchors at "...20:00:00" while
  // every fetched candle sat at "...21:00:00" - a consistent 1h shift that
  // failed every single anchor. Detecting one consistent whole-hour offset
  // that makes EVERY usable anchor match, and applying it uniformly, fixes
  // this without weakening the exact-match requirement for a genuinely
  // wrong anchor (no single consistent offset would rescue those).
  // The search extends to 24h (not just 12) for W1: confirmed on a real
  // GBPJPY chart that MT4 labels its weekly candles by their Sunday
  // session-open, a full day before OANDA's own weekly grid, which we
  // fetch aligned to Monday (weeklyAlignment in oanda-data.js) - a
  // consistent whole-DAY difference, the same class of broker-vs-provider
  // labeling gap as H4's whole-hour one, just one level up in scale.
  const brokerOffsetMinutes = (() => {
    if (!usableAnchors.length) return 0;
    for (let hours = 0; hours <= 24; hours += 1) {
      for (const sign of hours === 0 ? [1] : [1, -1]) {
        const offset = sign * hours * 60;
        const allMatch = usableAnchors.every((anchor) => {
          const t = instant(anchor.timestamp);
          if (!Number.isFinite(t)) return false;
          return byTimestamp.has(iso(new Date(t + offset * 60000).toISOString()));
        });
        if (allMatch) return offset;
      }
    }
    return 0;
  })();
  const anchorIndexes = usableAnchors.map((anchor) => {
    const t = instant(anchor.timestamp);
    const lookupTimestamp = Number.isFinite(t) && brokerOffsetMinutes
      ? iso(new Date(t + brokerOffsetMinutes * 60000).toISOString())
      : iso(anchor.timestamp);
    const row = byTimestamp.get(lookupTimestamp);
    if (row) return { ...anchor, row };
    // Matched via stepsPastHistory above, not an exact fetched candle:
    // synthesize the same virtual index screenXFor would derive for it.
    const steps = stepsPastHistory(anchor.timestamp);
    if (steps !== null && lastBar) {
      const lastRow = byTimestamp.get(lastBar._timestamp);
      if (lastRow) return { ...anchor, row: { candle: null, index: lastRow.index + steps } };
    }
    return { ...anchor, row: null };
  });
  if (usableAnchors.length > 0 && anchorIndexes.some((anchor) => !anchor.row)) {
    reasons.push("one or more chart time anchors did not match the fetched selected-timeframe candles");
  }
  const usableCalibration = reasons.length === 0;
  // A single anchor's timestamp can match a real candle (so it isn't
  // dropped by the check above) while its recorded PIXEL position is still
  // wrong - MT4 frequently mis-renders or crops the leftmost/rightmost axis
  // label/tick, and reading it can get the timestamp right but the x
  // wrong, or vice versa. Confirmed on a real M5 chart: the leftmost
  // anchor's step against its immediate neighbor was 1.3px/candle while
  // every OTHER consecutive pair agreed exactly on 4px/candle - using that
  // one anchor as screenXFor's reference threw every boundary off by
  // however far it sat from the rest, worst for whichever boundary was
  // furthest from it (the current day's own start line, landing far right
  // of its real candles).
  //
  // Comparing every anchor against every OTHER anchor (not just neighbors)
  // doesn't reliably catch this: a single bad anchor's error gets diluted
  // as the index gap to a farther anchor grows, so its implied step drifts
  // asymptotically toward the true value and can cross an all-pairs
  // majority threshold anyway (confirmed: the leftmost anchor above
  // "agreed" with 5 of its 10 others once diluted by distance - a coin
  // flip against a threshold that needed only that many). A real
  // corrupted-tick error is a roughly FIXED pixel offset, so it shows up
  // starkly against the NEAREST neighbor and gets progressively hidden by
  // averaging over longer distances - meaning nearest-neighbor pairs, not
  // all-pairs, are what actually isolates it.
  //
  // An interior anchor is cross-validated by two neighbors, so it only
  // needs to agree with one of them to be trusted. An endpoint anchor has
  // just one neighbor; if that single pairing disagrees, the endpoint -
  // not its neighbor, which is very likely still corroborated from its
  // OTHER side - is the natural suspect.
  const consistentAnchorIndexes = (() => {
    const withRows = anchorIndexes.filter((a) => a.row).sort((a, b) => a.row.index - b.row.index);
    const step = Number(calibration?.candleStep);
    if (withRows.length < 3 || !(step > 0)) return withRows;
    const tolerance = Math.max(1, step * 0.25);
    const pairAgrees = (a, b) => {
      if (a.row.index === b.row.index) return true;
      const impliedStep = (Number(b.x) - Number(a.x)) / (b.row.index - a.row.index);
      return Math.abs(impliedStep - step) <= tolerance;
    };
    return withRows.filter((anchor, i) => {
      const prevOk = i > 0 ? pairAgrees(withRows[i - 1], anchor) : null;
      const nextOk = i < withRows.length - 1 ? pairAgrees(anchor, withRows[i + 1]) : null;
      return prevOk === true || nextOk === true;
    });
  })();
  const screenXFor = (timestamp) => {
    const row = byTimestamp.get(iso(timestamp));
    const reference = consistentAnchorIndexes.find((anchor) => anchor.row) || anchorIndexes.find((anchor) => anchor.row);
    if (!reference || !usableCalibration) return null;
    if (row) return Number(reference.x) + (row.index - reference.row.index) * Number(calibration.candleStep);
    // No provider candle at this exact timestamp - most commonly the very
    // first candle of a period that has only just begun. Extrapolate from
    // the latest available candle instead of leaving the boundary
    // unpositioned; stepsPastHistory only succeeds for a timestamp after
    // that candle, so this never fires for a genuinely missing/invalid one.
    const lastRow = lastBar ? byTimestamp.get(lastBar._timestamp) : null;
    const steps = stepsPastHistory(timestamp);
    if (!lastRow || steps === null) return null;
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
      period: periodLabel(tf, key), key: externalKey(tf, key), startTimestamp: first?._timestamp || expectedStart,
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
      consistentAnchorCount: consistentAnchorIndexes.length,
      inconsistentAnchorsDropped: anchorIndexes.filter((a) => a.row).length - consistentAnchorIndexes.length,
      terminalCalibration,
      weekendSafe: true,
    },
  };
}

export const chartPeriodMapSameTimestamp = sameMoment;
