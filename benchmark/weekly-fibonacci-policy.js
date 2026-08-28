const H1 = "H1";
const RATIOS = Object.freeze([0.382, 0.5, 0.618]);

function asValidCandle(candle) {
  const timestamp = new Date(candle?.datetime);
  const high = Number(candle?.high);
  const low = Number(candle?.low);
  return !Number.isNaN(timestamp.getTime()) && Number.isFinite(high) && Number.isFinite(low) && high > low;
}

function weekStartUtc(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  return start;
}

/**
 * CSA H1 policy: Fibonacci is one shared, deterministic frame for the
 * visible calendar week.  It is never chosen from a candidate-local or
 * smaller impulse simply because that makes a nearby level qualify.
 */
export function buildVisibleWeekFibonacciFrame({ candles = [], direction = "range", timeframe = "" } = {}) {
  if (String(timeframe || "").toUpperCase() !== H1 || !["bullish", "bearish"].includes(direction)) {
    return null;
  }

  const ordered = candles.filter(asValidCandle).sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
  if (!ordered.length) return null;

  const finalDate = new Date(ordered.at(-1).datetime);
  const start = weekStartUtc(finalDate);
  const weekCandles = ordered.filter((candle) => {
    const timestamp = new Date(candle.datetime);
    return timestamp >= start && timestamp <= finalDate;
  });
  if (weekCandles.length < 2) return null;

  const highCandle = weekCandles.reduce((best, candle) => Number(candle.high) > Number(best.high) ? candle : best);
  const lowCandle = weekCandles.reduce((best, candle) => Number(candle.low) < Number(best.low) ? candle : best);
  const swingHigh = Number(highCandle.high);
  const swingLow = Number(lowCandle.low);
  if (!(swingHigh > swingLow)) return null;

  const range = swingHigh - swingLow;
  return {
    direction,
    swingHigh,
    swingLow,
    swingHighTime: highCandle.datetime,
    swingLowTime: lowCandle.datetime,
    impulseRange: range,
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: finalDate.toISOString().slice(0, 10),
    source: "visible_current_week_high_low",
    fibOriginModel: "visible_current_week_high_low",
    levels: RATIOS.map((ratio) => ({
      ratio,
      label: ratio === 0.5 ? "50%" : `${(ratio * 100).toFixed(1)}%`,
      price: direction === "bearish" ? swingLow + range * ratio : swingHigh - range * ratio,
    })),
  };
}
