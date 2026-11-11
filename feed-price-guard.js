// How far (as a share of price) the chart's last price may sit from the market data's newest close
// before it is distrusted. 0.75% is about 100 pips on a major pair.
export const PRICE_GAP_LIMIT = 0.0075;

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
