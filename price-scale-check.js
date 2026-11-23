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

// The reader sometimes writes a three-decimal label such as "104.000" as 104000 (SOLUSD H4, 2026-11-23: ticks 68000 to
// 104000 on a chart that ran 66 to 104). The scale that makes the most of the readings land on the axis wins; ties keep 1.
export const SCALE_FACTORS = [1, 0.001, 1000];

export function scaleTicks(ticks, factor = 1) {
  return (Array.isArray(ticks) ? ticks : []).map((value) => toNumber(value) * factor);
}

export function bestAxisScale(ticks, references = []) {
  if (!priceAxisRange(ticks)) return 1;
  const refs = references.map(toNumber).filter((value) => Number.isFinite(value) && value > 0);
  let best = { factor: 1, hits: -1 };
  for (const factor of SCALE_FACTORS) {
    const scaled = scaleTicks(ticks, factor);
    const hits = refs.filter((value) => !isOffScale(value, scaled)).length;
    if (hits > best.hits) best = { factor, hits };
  }
  return best.factor;
}

// What to do with a read last price: keep it, or (when it is off the chart's scale) replace it with the header's close
// when that sits on the axis, or drop it. `header` is the result of the small header read, or null. The header's open, high
// and low come along only when all four are on the axis and consistent (a header read can get one of them wrong).
export function resolveOffScalePrice({ price, ticks, header = null }) {
  const factor = bestAxisScale(ticks, [price, header?.close, header?.open, header?.high, header?.low]);
  const scaled = scaleTicks(ticks, factor);
  if (!isOffScale(price, scaled)) return { action: "keep", factor };
  const range = priceAxisRange(scaled);
  const onScale = (value) => Number.isFinite(toNumber(value)) && toNumber(value) > 0 && !isOffScale(value, scaled);
  if (header && onScale(header.close)) {
    const [open, high, low, close] = [header.open, header.high, header.low, header.close].map(toNumber);
    const ohlcFits = [open, high, low].every(onScale) && low <= Math.min(open, close) && high >= Math.max(open, close);
    return {
      action: "use_header",
      range,
      factor,
      price: close,
      open: ohlcFits ? open : null,
      high: ohlcFits ? high : null,
      low: ohlcFits ? low : null,
    };
  }
  return { action: "drop", range, factor };
}
