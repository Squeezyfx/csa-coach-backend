/**
 * Clean chart data.
 *
 * A plain candlestick picture the page draws from the market data already downloaded for the
 * review, with only the levels the review talks about: Entry 1/2/3, the level to watch, the
 * trade lines (the trader's own order, or the planned entry, stop and take profits) and the
 * current price. No indicators, grids or the trader's own drawings, so it is always easy to
 * read, and every price on it is the exact number used in the written feedback.
 *
 * The candles come from the data provider, not the trader's broker, so a price can differ by a
 * fraction of a pip to a few pips from their own platform. The page says so under the picture.
 */

export const CLEAN_CHART_VERSION = "1.0.0";
export const CLEAN_CHART_MAX_CANDLES = 150;
const MIN_CANDLES = 10;

const num = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
const finite = (value) => Number.isFinite(num(value));

function decimalsFor(values) {
  let best = 2;
  for (const value of values) {
    const text = String(value);
    const dot = text.indexOf(".");
    if (dot >= 0) best = Math.max(best, Math.min(5, text.length - dot - 1));
  }
  return best;
}

function timeText(datetime) {
  return String(datetime || "").replace("T", " ").replace(/Z$/, "").slice(0, 16);
}

function sameLevel(a, b, range) {
  return Math.abs(a - b) <= Math.max(range * 0.004, Math.abs(a) * 0.00003);
}

export function buildCleanChart({
  marketReference = null,
  finalFeedback = null,
  instrument = "",
  timeframe = "",
  analysisType = "",
  dataMatchStatus = "",
} = {}) {
  const source = Array.isArray(marketReference?.timeframeCandles) ? marketReference.timeframeCandles : [];
  const rows = source
    .map((c) => ({
      t: timeText(c?.datetime),
      o: num(c?.open),
      h: num(c?.high),
      l: num(c?.low),
      c: num(c?.close),
    }))
    .filter((r) => r.t && [r.o, r.h, r.l, r.c].every(Number.isFinite) && r.h >= r.l)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
    .slice(-CLEAN_CHART_MAX_CANDLES);

  if (rows.length < MIN_CANDLES) {
    return {
      version: CLEAN_CHART_VERSION,
      status: "unavailable",
      reason: "Market data for this chart was not available, so a clean chart could not be drawn.",
      candles: [],
      levels: [],
      offChart: [],
    };
  }

  const decimals = decimalsFor(rows.flatMap((r) => [r.o, r.h, r.l, r.c]));
  const high = Math.max(...rows.map((r) => r.h));
  const low = Math.min(...rows.map((r) => r.l));
  const range = high - low || Math.abs(high) * 0.001;
  const last = rows[rows.length - 1].c;

  const geometry = finalFeedback?.chartGeometry || {};
  const trade = geometry.trade || null;
  const levels = [];
  const add = (item) => {
    const price = num(item.price);
    if (!(price > 0)) return;
    // Two labels for one price share a line instead of drawing on top of each other.
    const twin = levels.find((existing) => existing.style === item.style && sameLevel(existing.price, price, range));
    if (twin) {
      if (!twin.label.includes(item.label)) twin.label += ` / ${item.label}`;
      return;
    }
    levels.push({ ...item, price });
  };

  // Entries the framework selected.
  [finalFeedback?.entry1, finalFeedback?.entry2, finalFeedback?.entry3].forEach((entry, index) => {
    if (entry && finite(entry.authoritativeCenter)) {
      add({ id: `E${index + 1}`, kind: "entry", style: "entry", label: `Entry ${index + 1}`, price: entry.authoritativeCenter });
    }
  });

  // The one or two levels worth watching, as the written review names them.
  (Array.isArray(geometry.watch) ? geometry.watch : []).slice(0, 2).forEach((item) => {
    add({ id: "W", kind: "watch", style: "watch", label: "Level to watch", price: item.price });
  });

  if (trade && trade.kind === "placed") {
    add({ id: "TE", kind: "trade", style: "yourEntry", label: "Your entry", price: trade.entry });
    if (finite(trade.stop)) add({ id: "TS", kind: "trade", style: "stop", label: "Your stop", price: trade.stop });
    (trade.targets || []).forEach((price) => add({ id: "TT", kind: "trade", style: "target", label: "Your take profit", price }));
  } else if (trade && trade.kind === "plan") {
    if (trade.entryTyped) add({ id: "TE", kind: "trade", style: "yourEntry", label: "Your entry", price: trade.entry });
    if (finite(trade.stopTyped)) add({ id: "TS", kind: "trade", style: "stop", label: "Your stop", price: trade.stopTyped });
    if (finite(trade.targetTyped)) add({ id: "TT", kind: "trade", style: "target", label: "Your take profit", price: trade.targetTyped });
    // The coach's suggested exits, drawn lighter than the trader's own.
    if (finite(trade.stop) && !(finite(trade.stopTyped) && sameLevel(trade.stop, num(trade.stopTyped), range))) {
      add({ id: "SS", kind: "plan", style: "planStop", label: "Suggested stop", price: trade.stop });
    }
    const targets = Array.isArray(trade.targets) ? trade.targets : [];
    targets.forEach((price, index) => {
      if (finite(trade.targetTyped) && sameLevel(num(price), num(trade.targetTyped), range)) return;
      const isLast = index === targets.length - 1;
      add({
        id: `ST${index + 1}`,
        kind: "plan",
        style: "planTarget",
        label: targets.length === 1 ? "Suggested take profit" : isLast ? "Final TP" : `TP${index + 1}`,
        price,
      });
    });
  }

  // Keep every level whose price is near the candles. A level far outside them (for example a
  // Monday level when the picture shows only a late-week stretch) would squash the candles, so
  // it is listed under the picture instead.
  const pad = range * 0.6;
  const visible = [];
  const offChart = [];
  for (const level of levels) {
    if (level.price >= low - pad && level.price <= high + pad) visible.push(level);
    else offChart.push({ label: level.label, price: level.price });
  }

  return {
    version: CLEAN_CHART_VERSION,
    status: "ok",
    instrument: String(instrument || "").toUpperCase(),
    timeframe: String(timeframe || "").toUpperCase(),
    analysisType: String(analysisType || ""),
    // How well the chart's own price matched the market data. When it did not (the date or
    // candle could not be verified, which is common when the mouse pointer is on the chart),
    // the page tells the trader the review is less reliable and how to get a better one.
    dataMatch: String(dataMatchStatus || ""),
    decimals,
    last,
    candles: rows.map((r) => [r.t, r.o, r.h, r.l, r.c]),
    levels: visible,
    offChart,
    note: "Drawn from market data, not your broker's feed, so prices can differ by a few pips from your own chart.",
  };
}
