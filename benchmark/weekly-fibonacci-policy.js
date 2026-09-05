const RATIOS = Object.freeze([0.382, 0.5, 0.618]);
const INTRADAY_WEEKLY = new Set(["M1", "M5", "M15", "M30", "H1"]);

function asValidCandle(candle) {
  const timestamp = new Date(candle?.datetime);
  const high = Number(candle?.high);
  const low = Number(candle?.low);
  return !Number.isNaN(timestamp.getTime()) && Number.isFinite(high) && Number.isFinite(low) && high > low;
}

function periodForTimeframe(timeframe = "") {
  const tf = String(timeframe || "").toUpperCase();
  if (INTRADAY_WEEKLY.has(tf)) return "week";
  if (tf === "H4") return "month";
  if (tf === "D1" || tf === "W1") return "year";
  if (tf === "MN") return "visible_range";
  return null;
}

function startOfPeriodUtc(date, period) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (period === "week") {
    const day = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  } else if (period === "month") {
    start.setUTCDate(1);
  } else if (period === "year") {
    start.setUTCMonth(0, 1);
  }
  return start;
}

/** One shared current-period Fib frame; never a candidate-local swing. */
export function buildVisiblePeriodFibonacciFrame({ candles = [], direction = "range", timeframe = "" } = {}) {
  const period = periodForTimeframe(timeframe);
  if (!period || !["bullish", "bearish"].includes(direction)) return null;

  const ordered = candles.filter(asValidCandle).sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
  if (!ordered.length) return null;

  const finalDate = new Date(ordered.at(-1).datetime);
  const start = period === "visible_range" ? new Date(ordered[0].datetime) : startOfPeriodUtc(finalDate, period);

  // A calendar Fib is valid only when the supplied candles visibly include
  // the beginning of that week/month/year. Never turn partial coverage into
  // a smaller local impulse.
  if (period !== "visible_range") {
    const earliestVisibleDate = new Date(ordered[0].datetime);
    if (earliestVisibleDate > start) return null;
  }
  const periodCandles = ordered.filter((candle) => {
    const timestamp = new Date(candle.datetime);
    return timestamp >= start && timestamp <= finalDate;
  });
  if (periodCandles.length < 2) return null;

  const highCandle = periodCandles.reduce((best, candle) => Number(candle.high) > Number(best.high) ? candle : best);
  const lowCandle = periodCandles.reduce((best, candle) => Number(candle.low) < Number(best.low) ? candle : best);
  const periodOpen = Number(periodCandles[0].open);
  const periodClose = Number(periodCandles.at(-1).close);
  const swingHigh = Number(highCandle.high);
  const swingLow = Number(lowCandle.low);
  if (!(swingHigh > swingLow)) return null;

  // The calendar-period candle owns direction. The supplied direction is only
  // an eligibility hint and must not reverse a readable week/month/year bar.
  const periodCandleDirection =
    Number.isFinite(periodOpen) && Number.isFinite(periodClose)
      ? periodClose > periodOpen
        ? "bullish"
        : periodClose < periodOpen
        ? "bearish"
        : "range"
      : "range";
  if (!["bullish", "bearish"].includes(periodCandleDirection)) return null;
  const effectiveDirection = periodCandleDirection;

  const range = swingHigh - swingLow;
  const source = `visible_current_${period}_high_low`;
  return {
    direction: effectiveDirection,
    period,
    swingHigh,
    swingLow,
    periodOpen: Number.isFinite(periodOpen) ? periodOpen : null,
    periodClose: Number.isFinite(periodClose) ? periodClose : null,
    // This is deliberately separate from the immediate H1 leg. A current
    // week can be bullish overall while the final H1 candles are pulling back.
    periodCandleDirection,
    swingHighTime: highCandle.datetime,
    swingLowTime: lowCandle.datetime,
    impulseRange: range,
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: finalDate.toISOString().slice(0, 10),
    // Backward-compatible names for the existing H1 policy diagnostics.
    weekStart: period === "week" ? start.toISOString().slice(0, 10) : null,
    weekEnd: period === "week" ? finalDate.toISOString().slice(0, 10) : null,
    source,
    fibOriginModel: source,
    levels: RATIOS.map((ratio) => ({
      ratio,
      label: ratio === 0.5 ? "50%" : `${(ratio * 100).toFixed(1)}%`,
      price: effectiveDirection === "bearish" ? swingLow + range * ratio : swingHigh - range * ratio,
    })),
  };
}

export function resolveCalendarPeriodDirection({
  frameVerified = false,
  periodDirection = "",
  recentDirection = "",
} = {}) {
  const direction = String(periodDirection || "").toLowerCase();
  const recent = String(recentDirection || "").toLowerCase();
  if (frameVerified !== true || !["bullish", "bearish"].includes(direction)) return null;
  return {
    direction,
    phase:
      ["bullish", "bearish"].includes(recent) && recent !== direction
        ? direction === "bullish"
          ? "bearish_pullback_after_bullish_structure"
          : "bullish_recovery_after_bearish_structure"
        : `${direction}_current_period_structure`,
  };
}

// Retained for existing callers/tests. H1 belongs to the intraday weekly rule.
export function buildVisibleWeekFibonacciFrame(args = {}) {
  return String(args?.timeframe || "").toUpperCase() === "H1"
    ? buildVisiblePeriodFibonacciFrame(args)
    : null;
}
