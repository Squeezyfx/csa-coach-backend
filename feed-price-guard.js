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

// A chart reader sometimes gets one digit wrong (1.3277 read as 1.3077, 1.3177 as 1.3077). Given the live
// candle's close, tries every single-digit change of the printed price's second decimal (0.01 place) and,
// failing that, a +-1 change of the third decimal. Returns the corrected price when the chart's price is
// at least `limit` (0.65%, so a 0.01 slip on a 1.35 pair, 0.74%, still counts) from the live candle and
// exactly one candidate lands within `tolerance` (default 0.2%, about 25 pips) of it.
// Returns { price, delta } or null. A price that already agrees with the live candle is never touched.
export function correctPriceSlipAgainstLiveCandle({ price, liveClose, limit = SLIP_MIN_GAP, tolerance } = {}) {
  const chart = Number(price);
  const live = Number(liveClose);
  if (!(chart > 0) || !(live > 0)) return null;
  if (Math.abs(chart - live) / live <= limit) return null;
  const near = tolerance > 0 ? tolerance : live * 0.002;
  const magnitude = Math.floor(Math.log10(chart));
  const round = (value) => Number(value.toFixed(6));
  const unique = (values) => [...new Set(values)];
  const pick = (candidates) => {
    const fits = unique(candidates.filter((candidate) => candidate > 0 && Math.abs(candidate - live) <= near));
    return fits.length === 1 ? { price: fits[0], delta: round(fits[0] - chart) } : null;
  };
  // 0.01 place on a 1.3xxx price (1 on a 150.xx price): any other digit in that place.
  const big = 10 ** (magnitude - 2);
  const digit = Math.floor(chart / big + 1e-9) % 10;
  const bigSlips = [];
  for (let d = 0; d <= 9; d++) if (d !== digit) bigSlips.push(round(chart + (d - digit) * big));
  const first = pick(bigSlips);
  if (first) return first;
  // 0.001 place (0.1 on a 150.xx price): the neighbouring digits only.
  const small = 10 ** (magnitude - 3);
  return pick([round(chart - small), round(chart + small)]);
}
