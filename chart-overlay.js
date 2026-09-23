/**
 * Chart overlay builder.
 *
 * Turns data the engine already produces into one ready-to-draw list, in
 * the uploaded screenshot's own pixel coordinates:
 *   - frame high/low (week for M1–H1, month for H4): long black dashed lines
 *   - each period's high/low: short dashed segment from the candle that made
 *     it to the end of that period, price printed above it (highs black,
 *     lows red)
 *   - Fib 38.2 / 50 / 61.8: blue tags on the right edge
 *   - entries E1, E2, E3 …: orange full-width bands with a label box
 *
 * y comes from chartDetection.priceAxisCalibration (price axis).
 * x comes from the verified chart period map (time axis).
 * Anything without a verified position is flagged verified:false so the
 * frontend can grey it out rather than draw it as fact.
 */
import { yAtCalibratedPrice } from "./chart-raster-reader.js";

const FIB_KEYS = ["38.2", "50.0", "61.8"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const num = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
const finite = (value) => Number.isFinite(num(value));

function decimalsFor(prices) {
  let best = 2;
  for (const price of prices) {
    const text = String(price);
    const dot = text.indexOf(".");
    if (dot >= 0) best = Math.max(best, Math.min(5, text.length - dot - 1));
  }
  return best;
}

function shortDate(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]}` : "";
}

function fibLabel(key) {
  return key === "50.0" ? "50.0%" : `${key}%`;
}

export function buildChartOverlay({ chartDetection = {}, analysisFacts = {}, marketReference = {}, timeframe = "" } = {}) {
  const calibration = chartDetection?.priceAxisCalibration || null;
  const audit = analysisFacts?.selectorDiagnostics?.transparencyAudit || {};
  const periodMap = audit?.inventoryAuthority?.chartPeriodMap || audit?.fibonacciAudit?.chartPeriodMap || null;
  const fib = audit?.fibonacciAudit || {};
  const completed = Array.isArray(audit?.periodStructureAudit) ? audit.periodStructureAudit : [];
  const inProgress = Array.isArray(audit?.inProgressPeriodAudit) ? audit.inProgressPeriodAudit : [];
  const decisions = Array.isArray(audit?.entryDecisionAudit) ? audit.entryDecisionAudit : [];
  const reasons = [];

  if (!calibration) {
    return {
      version: "1.0.0",
      status: "unavailable",
      reasons: ["price axis could not be calibrated from the screenshot"],
      elements: [],
    };
  }

  const plotRight = num(calibration.plotRight);
  const plotBottom = num(calibration.plotBottom);
  const yOf = (price) => {
    const y = yAtCalibratedPrice(calibration, price);
    return Number.isFinite(y) && y >= 0 && y <= plotBottom ? Math.round(y * 10) / 10 : null;
  };

  const mapVerified = periodMap?.status === "verified";
  if (!mapVerified) reasons.push("time axis not verified: period segments are drawn full-width and marked unverified");
  const step = num(periodMap?.axisCalibration?.candleStep);
  const starts = (periodMap?.periodStarts || []).filter((p) => p.mapped && finite(p.screenX) && finite(p.candleIndex));
  const cutoffX = num(periodMap?.cutoff?.screenX);
  const candles = (Array.isArray(marketReference?.timeframeCandles) ? marketReference.timeframeCandles : [])
    .map((c) => ({ ...c, _t: String(c?.datetime || "").replace("T", " ").slice(0, 19) }))
    .filter((c) => c._t)
    .sort((a, b) => (a._t < b._t ? -1 : a._t > b._t ? 1 : 0));

  const xOfIndex = (index) => {
    if (!mapVerified || !(step > 0) || !starts.length) return null;
    const ref = starts[0];
    return num(ref.screenX) + (index - num(ref.candleIndex)) * step;
  };
  const spanOf = (date) => {
    if (!mapVerified) return null;
    const index = starts.findIndex((p) => p.key === date);
    if (index < 0) return null;
    const x1 = num(starts[index].screenX);
    const next = starts[index + 1];
    const x2 = next ? num(next.screenX) - step : (Number.isFinite(cutoffX) ? cutoffX : plotRight);
    const startIndex = num(starts[index].candleIndex);
    const endIndex = next && finite(next.candleIndex) ? num(next.candleIndex) - 1 : candles.length - 1;
    return { x1, x2, startIndex, endIndex };
  };
  // Candle index (in the map's own ordering) where the period's high or low
  // was made. period.date is the PERIOD'S OWN identity key - for H4/D1 that
  // is the week's Monday / the month's 1st, not necessarily the day the
  // extreme actually happened on, so matching candles by date string here
  // (as this used to) only ever found April/June/September's handful of
  // extremes that coincidentally landed on day 1 of their period and left
  // every other period's tick spanning its full width with no exact
  // candle to anchor to. Scanning the period's own verified candle-index
  // range (already established by chart-period-map.js) for the candle
  // whose real high/low matches the recorded price finds the true one
  // regardless of which day within the period it fell on.
  const extremeIndex = (span, price, kind) => {
    if (!span || !Number.isFinite(span.startIndex) || !Number.isFinite(span.endIndex)) return null;
    const tolerance = Math.abs(num(price)) * 0.00002;
    for (let i = span.startIndex; i <= span.endIndex && i < candles.length; i++) {
      const c = candles[i];
      if (!c) continue;
      const value = num(kind === "high" ? c.high : c.low);
      if (Number.isFinite(value) && Math.abs(value - num(price)) <= tolerance) return i;
    }
    return null;
  };

  const allPrices = [
    ...completed.flatMap((p) => [p.high, p.low]),
    ...inProgress.flatMap((p) => [p.high, p.low]),
    fib?.swingHigh, fib?.swingLow,
  ].filter(finite);
  const decimals = decimalsFor(allPrices);
  const fmt = (price) => num(price).toFixed(decimals);

  const elements = [];
  const periods = [
    ...completed.map((p) => ({ ...p, lifecycle: "completed" })),
    ...inProgress.map((p) => ({ ...p, lifecycle: "in_progress" })),
  ];

  // 1. Frame high / low (the Fib swing). Label names the period that made it.
  // The frame is the OUTER range each timeframe's periods sit inside, not
  // the period length itself: M1-H1's periods are daily, framed by the week
  // (structureLabel "...inside the selected Monday-to-Friday week"); H4's
  // periods are weekly, framed by the month; D1's periods are monthly,
  // framed by the year ("...inside the selected calendar year"). D1 was
  // previously unreachable here (chart-period-map.js excluded it entirely),
  // so this fell through to the WEEK default and every D1 chart's frame
  // line was mislabeled "WEEK HIGH/LOW" for what is really a year's worth
  // of monthly highs and lows.
  const frameUnit = timeframe === "H4" ? "MONTH" : timeframe === "D1" ? "YEAR" : "WEEK";
  const frameHigh = finite(fib?.swingHigh) ? num(fib.swingHigh) : Math.max(...periods.map((p) => num(p.high)).filter(Number.isFinite));
  const frameLow = finite(fib?.swingLow) ? num(fib.swingLow) : Math.min(...periods.map((p) => num(p.low)).filter(Number.isFinite));
  for (const [kind, price] of [["high", frameHigh], ["low", frameLow]]) {
    if (!Number.isFinite(price)) continue;
    const y = yOf(price);
    if (y === null) continue;
    const owner = periods.find((p) => Math.abs(num(p[kind]) - price) <= Math.abs(price) * 0.00002);
    const when = owner ? `${owner.period} ${shortDate(owner.date)} ` : "";
    elements.push({
      type: "frame_line", kind, price, y, x1: 0, x2: finite(cutoffX) ? cutoffX : plotRight,
      label: `${frameUnit} ${kind.toUpperCase()} ${when}${fmt(price)}`.replace(/\s+/g, " "),
      verified: fib?.verified === true,
    });
  }

  // 2. Period highs / lows. A short tick right at the candle that made the
  // extreme, not a dash spanning the whole period - the point is to show
  // exactly which wick the level came from. Falls back to the full-period
  // span only when that candle couldn't be pinned down (extremeIndex found
  // no matching wick), and that fallback case is marked unverified so the
  // frontend greys it out instead of drawing an imprecise line as fact.
  const tickWidth = step > 0 ? step : 12;
  for (const period of periods) {
    const span = spanOf(period.date);
    for (const kind of ["high", "low"]) {
      const price = num(period[kind]);
      if (!Number.isFinite(price)) continue;
      const y = yOf(price);
      if (y === null) continue;
      const index = span ? extremeIndex(span, price, kind) : null;
      const extremeX = index !== null ? xOfIndex(index) : null;
      const pinned = Number.isFinite(extremeX);
      const x1 = pinned ? extremeX : (span?.x1 ?? 0);
      const x2 = pinned ? extremeX + tickWidth : (span?.x2 ?? plotRight);
      elements.push({
        type: "period_level", kind, period: period.period, date: period.date, lifecycle: period.lifecycle,
        price, y, x1, x2, extremeX: pinned ? extremeX : null, label: fmt(price),
        verified: pinned && period[`${kind}Verified`] !== false,
      });
    }
  }

  // 3. Period boundaries (dotted verticals), as the current audit image already shows.
  if (mapVerified) {
    for (const start of starts) {
      elements.push({ type: "period_boundary", period: start.period, date: start.key, x: num(start.screenX), verified: true });
    }
  }

  // 4. Fib levels: tags on the right edge plus a thin line.
  const fibLevels = fib?.levels && typeof fib.levels === "object" ? fib.levels : null;
  if (fibLevels) {
    for (const key of FIB_KEYS) {
      const price = num(fibLevels[key]);
      const y = yOf(price);
      if (y === null) continue;
      elements.push({
        type: "fib_level", ratio: key, price, y, x1: 0, x2: finite(cutoffX) ? cutoffX : plotRight,
        tag: `${fibLabel(key)} ${fmt(price)}`, verified: fib?.verified === true,
      });
    }
  } else {
    reasons.push("no Fib frame: the Fib high/low was not verified for this chart");
  }

  // 5. Entries E1, E2, E3 … (selected only).
  const entries = decisions.filter((d) => d?.selected === true && finite(d?.price));
  for (const entry of entries) {
    const y = yOf(entry.price);
    if (y === null) continue;
    const ratio = finite(entry.nearestFibRatio) ? `${(num(entry.nearestFibRatio) * 100).toFixed(1)}%` : "";
    const zoneLowY = finite(entry.zoneLow) ? yOf(entry.zoneLow) : null;
    const zoneHighY = finite(entry.zoneHigh) ? yOf(entry.zoneHigh) : null;
    elements.push({
      type: "entry", id: `E${entry.entry}`, price: num(entry.price), y,
      yTop: zoneHighY ?? y, yBottom: zoneLowY ?? y,
      x1: 0, x2: finite(cutoffX) ? cutoffX : plotRight,
      label: `${entry.period} ${entry.extreme} ${fmt(entry.price)}${ratio ? ` @ ${ratio}` : ""}`,
      verified: mapVerified && fib?.verified === true,
    });
  }
  if (!entries.length) reasons.push("no entry passed every gate for this chart");

  const allVerified = elements.length > 0 && elements.every((e) => e.verified);
  return {
    version: "1.0.0",
    status: allVerified ? "verified" : elements.length ? "partial" : "unavailable",
    reasons,
    imageWidth: calibration.imageWidth ?? null,
    imageHeight: calibration.imageHeight ?? null,
    plotRight, plotBottom,
    priceCalibration: { source: calibration.source, filledLabels: calibration.filledLabels || [] },
    elements,
  };
}
