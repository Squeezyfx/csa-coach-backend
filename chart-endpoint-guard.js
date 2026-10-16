// A TradingView screenshot taken with the mouse over the chart shows the OHLC of
// the HOVERED candle in the top-left header, not the last candle. If the header
// values match an older candle of the provider's own data, the screenshot did not
// disagree with the data: the header was just reading a different candle.

const finite = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

// Returns { datetime, index } of an older provider candle whose open/high/low/close
// match the header (at least `minMatches` of the 4 within `tolerance`), or null.
// The last `excludeLast` candles are never reported: a header that matches the
// final candles is a normal reading, not a hover.
export function findHoveredCandleMatch({
  candles = [],
  header = {},
  tolerance = 0,
  excludeLast = 3,
  minMatches = 4,
} = {}) {
  const fields = ["open", "high", "low", "close"];
  const given = fields.filter((field) => finite(header?.[field]));
  if (given.length < minMatches || !(tolerance > 0)) return null;
  const rows = Array.isArray(candles) ? candles : [];
  const limit = rows.length - Math.max(0, excludeLast);
  let best = null;
  for (let index = 0; index < limit; index += 1) {
    const candle = rows[index];
    if (!candle) continue;
    const matches = given.filter(
      (field) => finite(candle[field]) && Math.abs(Number(candle[field]) - Number(header[field])) <= tolerance
    ).length;
    if (matches >= minMatches && (!best || matches > best.matches)) {
      best = { index, datetime: candle.datetime || null, matches };
    }
  }
  return best;
}
