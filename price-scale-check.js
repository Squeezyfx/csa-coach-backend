/**
 * Price scale check.
 *
 * The chart reader sometimes returns a "last price" that is not on the chart's price axis at all: SOLUSD H4 on
 * 2026-11-23 was read as 188.23 on a chart whose axis ran from 66 to 104 and whose last price tag said 71.76
 * (most likely the volume pane's own label, "188.23K"). A price like that can never match the data feed, so the
 * review was marked "lower confidence", the year was guessed from it, and a take profit of 188 was suggested.
 *
 * The axis ticks the reader transcribes from the same picture give the range the chart really shows. A price
 * far outside that range is not a price on this chart.
 */

export const SCALE_CHECK_MIN_TICKS = 3;
// A last price sits inside the visible axis range; the ticks may stop a little short of the edges.
export const SCALE_CHECK_PAD = 0.2;

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return NaN;
  const text = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  return Number(text);
};

// The range the price axis covers, or null when too few ticks were read to say.
export function priceAxisRange(ticks) {
  const values = (Array.isArray(ticks) ? ticks : []).map(toNumber).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < SCALE_CHECK_MIN_TICKS) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!(max > min)) return null;
  return { min, max, span: max - min, count: values.length };
}

// True only when the price is clearly outside the chart's own axis. No usable axis, or no price, is never "off".
export function isOffScale(price, ticks, { pad = SCALE_CHECK_PAD } = {}) {
  const value = toNumber(price);
  if (!Number.isFinite(value) || value <= 0) return false;
  const range = priceAxisRange(ticks);
  if (!range) return false;
  return value < range.min - range.span * pad || value > range.max + range.span * pad;
}

// What to do with a read last price: keep it, or (when it is off the chart's scale) replace it with the header's own
// four prices when those sit on the scale, or drop it. `header` is the result of the small header read, or null.
export function resolveOffScalePrice({ price, ticks, header = null }) {
  if (!isOffScale(price, ticks)) return { action: "keep" };
  const range = priceAxisRange(ticks);
  const onScale = (value) => Number.isFinite(toNumber(value)) && !isOffScale(value, ticks);
  if (header && ["open", "high", "low", "close"].every((key) => onScale(header[key]))) {
    return {
      action: "use_header",
      range,
      price: toNumber(header.close),
      open: toNumber(header.open),
      high: toNumber(header.high),
      low: toNumber(header.low),
    };
  }
  return { action: "drop", range };
}
