// How far (as a share of price) the chart's last price may sit from the market data's newest close
// before it is distrusted. 0.75% is about 100 pips on a major pair.
export const PRICE_GAP_LIMIT = 0.0075;
// The smallest gap to the live candle at which a one-digit slip is looked for (a 0.01 slip on 1.35 is 0.74%).
export const SLIP_MIN_GAP = 0.0065;

const MATCHED = ["matched_reference", "partial_reference"];
const PAGE_WEAK = ["date_unverified", "time_unverified", "mismatch", "partial_or_unknown_candle"];

// True when the market data could not be matched to the chart and the chart's last price is far from
// the data's newest close, which usually means the price was misread from the picture.
export function chartPriceFarFromFeed({ chartDetection, marketReference, limit = PRICE_GAP_LIMIT } = {}) {
  if (MATCHED.includes(String(marketReference?.chartDataMatch?.status || ""))) return false;
  const price = Number(chartDetection?.latestVisibleClose ?? chartDetection?.latestVisiblePrice);
  const candles = (Array.isArray(marketReference?.timeframeCandles) ? marketReference.timeframeCandles : [])
    .filter((c) => c && c.datetime && Number(c.close) > 0)
    .sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
  const feedClose = Number(candles.at(-1)?.close);
  if (!(price > 0) || !(feedClose > 0)) return false;
  return Math.abs(price - feedClose) / feedClose > limit;
}

// The match status the page uses to decide whether to show "Lower confidence". It only knows four weak
// statuses, so any other unmatched outcome of an attempted market-data check is reported as "mismatch".
export function pageDataMatchStatus(status, marketDataAttempted) {
  const text = String(status || "");
  if (MATCHED.includes(text) || PAGE_WEAK.includes(text)) return text;
  return marketDataAttempted ? "mismatch" : text;
}

// A chart reader sometimes drops or adds a digit (1.3177 read as 1.3077). Given the live candle's close,
// tries the one-digit slips of the printed price and returns the corrected price when the chart's price is
// at least `limit` (0.65%, so a 0.01 slip on a 1.35 pair, 0.74%, still counts) from the live candle and exactly one slip lands within `tolerance` of it.
// Returns { price, delta } or null. A price that already agrees with the live candle is never touched.
export function correctPriceSlipAgainstLiveCandle({ price, liveClose, limit = SLIP_MIN_GAP, tolerance } = {}) {
  const chart = Number(price);
  const live = Number(liveClose);
  if (!(chart > 0) || !(live > 0)) return null;
  if (Math.abs(chart - live) / live <= limit) return null;
  const near = tolerance > 0 ? tolerance : live * 0.002;
  // The two lowest digits a reader drops or adds: 0.01 and 0.001 on a 1.3xxx price, 1 and 0.1 on a 150.xx price.
  const magnitude = Math.floor(Math.log10(chart));
  const steps = [10 ** (magnitude - 2), 10 ** (magnitude - 3)];
  const decimals = 6;
  const fits = [];
  for (const step of steps) {
    for (const sign of [-1, 1]) {
      const candidate = Number((chart + sign * step).toFixed(decimals));
      if (Math.abs(candidate - live) <= near) fits.push(candidate);
    }
  }
  const unique = [...new Set(fits)];
  if (unique.length !== 1) return null;
  return { price: unique[0], delta: Number((unique[0] - chart).toFixed(decimals)) };
}
