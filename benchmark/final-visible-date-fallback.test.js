import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { locateFinalVisibleCandle, FINAL_VISIBLE_LOOKBACK_DAYS } from "../candle-alignment.js";
import { fetchRecentCandles } from "../oanda-data.js";
import { buildDateCheck, describeDateCheck } from "../date-check.js";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

const PIP = 0.0001;
const candle = (datetime, open, high, low, close) => ({ datetime, open, high, low, close });
// The 9 Nov GBPUSD case: the header of a still-forming 18:00 candle (a 5.9 pip range), price tag 1.34248.
const header = { open: 1.34192, high: 1.34249, low: 1.3419, close: 1.34248 };
const forming = candle("2026-11-09 18:00:00", 1.34192, 1.34261, 1.34185, 1.34255);

// Fifty ordinary completed candles wandering between 1.3350 and 1.3470, none near the header.
function ordinary() {
  const rows = [];
  for (let i = 0; i < 50; i++) {
    const base = 1.337 + (i % 10) * 0.0006;
    const day = 5 + Math.floor(i / 24);
    const hour = String(i % 24).padStart(2, "0");
    rows.push(candle(`2026-11-0${day} ${hour}:00:00`, base, base + 0.0011, base - 0.0009, base + 0.0004));
  }
  return rows;
}
const locate = (extra = {}) =>
  locateFinalVisibleCandle({ header, lastPrice: 1.34248, candles: ordinary(), forming, tolerance: PIP, maxOffset: PIP * 1.5, ...extra });

test("a live chart: the still-forming candle identifies the date", () => {
  const r = locate();
  assert.equal(r.ok, true);
  assert.equal(r.mode, "forming_partial");
  assert.equal(r.candle.datetime, "2026-11-09 18:00:00");
});

test("a completed candle that fits the whole header is found", () => {
  const exact = candle("2026-11-04 13:00:00", 1.3419, 1.3426, 1.3412, 1.34255);
  const r = locateFinalVisibleCandle({
    header: { open: 1.3419, high: 1.3426, low: 1.3412, close: 1.34255 },
    lastPrice: 1.34255,
    candles: [...ordinary(), exact],
    forming: null,
    tolerance: PIP,
    maxOffset: PIP * 1.5,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "full_ohlc");
  assert.equal(r.candle.datetime, "2026-11-04 13:00:00");
});

test("a small feed difference is allowed, a loose coincidence is not", () => {
  const off = candle("2026-11-04 13:00:00", 1.3420, 1.3427, 1.3413, 1.34265); // +1 pip on every price
  const ok = locateFinalVisibleCandle({
    header: { open: 1.3419, high: 1.3426, low: 1.3412, close: 1.34255 },
    lastPrice: 1.34255, candles: [off], forming: null, tolerance: PIP, maxOffset: PIP * 1.5,
  });
  assert.equal(ok.ok, true);
  const loose = candle("2026-11-04 14:00:00", 1.3419, 1.3426, 1.3412, 1.34325); // close 7 pips away
  const no = locateFinalVisibleCandle({
    header: { open: 1.3419, high: 1.3426, low: 1.3412, close: 1.34255 },
    lastPrice: 1.34255, candles: [loose], forming: null, tolerance: PIP, maxOffset: PIP * 1.5,
  });
  assert.equal(no.ok, false);
  assert.equal(no.reason, "no_candle_fits_header");
});

test("nothing fits: no change", () => {
  const r = locate({ forming: candle("2026-11-09 18:00:00", 1.3300, 1.3302, 1.3299, 1.3301) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_candle_fits_header");
});

test("two completed candles that fit equally well are ambiguous, nothing is changed", () => {
  const twinA = candle("2026-11-04 13:00:00", 1.3419, 1.3426, 1.3412, 1.34255);
  const twinB = candle("2026-11-05 09:00:00", 1.3419, 1.3426, 1.3412, 1.34255);
  const r = locateFinalVisibleCandle({
    header: { open: 1.3419, high: 1.3426, low: 1.3412, close: 1.34255 },
    lastPrice: 1.34255, candles: [twinA, twinB], forming: null, tolerance: PIP, maxOffset: PIP * 1.5,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "ambiguous");
});

test("a completed candle and the forming candle both fitting is ambiguous", () => {
  const coincidence = candle("2026-11-04 13:00:00", 1.34192, 1.34249, 1.3419, 1.34248);
  const r = locate({ candles: [...ordinary(), coincidence] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "ambiguous");
});

test("a much better fit than the runner-up is accepted", () => {
  const best = candle("2026-11-04 13:00:00", 1.3419, 1.3426, 1.3412, 1.34255);
  const worse = candle("2026-11-05 09:00:00", 1.34195, 1.34265, 1.34115, 1.34262); // residual about 0.5 pip
  const r = locateFinalVisibleCandle({
    header: { open: 1.3419, high: 1.3426, low: 1.3412, close: 1.34255 },
    lastPrice: 1.34255, candles: [worse, best], forming: null, tolerance: PIP, maxOffset: PIP * 1.5,
  });
  assert.equal(r.ok, true);
  assert.equal(r.candle.datetime, "2026-11-04 13:00:00");
});

test("a header that is not the last candle (mouse pointer on the chart) is never used", () => {
  const r = locate({ lastPrice: 1.3361 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "header_not_last_candle");
});

test("no last price on the axis or no header: nothing is changed", () => {
  assert.equal(locate({ lastPrice: null }).reason, "no_last_price");
  assert.equal(locate({ header: { open: null, high: null, low: null, close: null } }).reason, "no_header_prices");
});

test("only intraday and daily charts are searched, with a window that fits the timeframe", () => {
  assert.ok(FINAL_VISIBLE_LOOKBACK_DAYS["1h"] >= 7);
  assert.ok(FINAL_VISIBLE_LOOKBACK_DAYS["1min"] <= 2);
  assert.equal(FINAL_VISIBLE_LOOKBACK_DAYS["1week"], undefined);
  assert.equal(FINAL_VISIBLE_LOOKBACK_DAYS["1month"], undefined);
});

test("fetchRecentCandles returns the completed candles and the forming one separately", async () => {
  const now = Date.parse("2026-11-09T18:31:00Z");
  const row = (time, complete, o, h, l, c) => ({ time, complete, bid: { o: String(o), h: String(h), l: String(l), c: String(c) } });
  let requested = "";
  const fetchImpl = async (url) => {
    requested = String(url);
    return {
      ok: true,
      json: async () => ({
        instrument: "GBP_USD",
        granularity: "H1",
        candles: [
          row("2026-11-09T16:00:00.000000000Z", true, 1.3401, 1.3410, 1.3398, 1.3405),
          row("2026-11-09T17:00:00.000000000Z", true, 1.3405, 1.3422, 1.3402, 1.3419),
          row("2026-11-09T18:00:00.000000000Z", false, 1.34192, 1.34261, 1.34185, 1.34255),
        ],
      }),
    };
  };
  const out = await fetchRecentCandles({ symbol: "GBPUSD", interval: "1h", days: 14, timezone: "UTC", token: "test-token-123", environment: "practice", price: "B", now, fetchImpl });
  assert.equal(out.candles.length, 2);
  assert.equal(out.candles[1].datetime, "2026-11-09 17:00:00");
  assert.equal(out.forming.datetime, "2026-11-09 18:00:00");
  assert.equal(out.forming.open, 1.34192);
  assert.match(requested, /GBP_USD/);
  assert.match(requested, /granularity=H1/);
});

test("the whole path on the 9 Nov case: a typed 23 Sep is replaced by the date of the chart", async () => {
  const now = Date.parse("2026-11-09T18:31:00Z");
  const bid = (o, h, l, c) => ({ o: String(o), h: String(h), l: String(l), c: String(c) });
  const rows = ordinary().map((c) => ({
    time: c.datetime.replace(" ", "T") + ".000000000Z",
    complete: true,
    bid: bid(c.open, c.high, c.low, c.close),
  }));
  rows.push({ time: "2026-11-09T18:00:00.000000000Z", complete: false, bid: bid(1.34192, 1.34261, 1.34185, 1.34255) });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ instrument: "GBP_USD", granularity: "H1", candles: rows }) });
  const recent = await fetchRecentCandles({ symbol: "GBPUSD", interval: "1h", days: 14, timezone: "UTC", token: "test-token-123", now, fetchImpl });
  const found = locateFinalVisibleCandle({ header, lastPrice: 1.34248, candles: recent.candles, forming: recent.forming, tolerance: PIP, maxOffset: PIP * 1.5 });
  assert.equal(found.ok, true);
  assert.equal(String(found.candle.datetime).slice(0, 10), "2026-11-09");
  assert.notEqual(String(found.candle.datetime).slice(0, 10), "2026-09-23");
});

test("the review text: a corrected date and an unmatched typed date are both said plainly", () => {
  const corrected = buildDateCheck({
    finalVisibleDate: { mode: "final_visible", source: "chart-final-visible-date", typedDate: "2026-09-23", reviewedDate: "2026-11-09", priceMatched: true },
    matchStatus: "matched_reference",
  });
  assert.equal(corrected.kind, "corrected");
  assert.match(describeDateCheck(corrected), /found from the chart's prices/);
  assert.match(describeDateCheck(corrected), /2026-11-09, not 2026-09-23 as you typed/);

  const unverified = buildDateCheck({
    finalVisibleDate: { mode: "final_visible", source: "user-selected-date", typedDate: "2026-09-23", reviewedDate: "2026-09-23", priceMatched: false },
    matchStatus: "date_unverified",
  });
  assert.equal(unverified.kind, "unverified");
  assert.match(describeDateCheck(unverified), /may be about the wrong day/);
});

test("no date note when nothing is wrong", () => {
  const typed = { mode: "final_visible", source: "user-selected-date", typedDate: "2026-11-04", reviewedDate: "2026-11-04", priceMatched: false };
  assert.equal(buildDateCheck({ finalVisibleDate: typed, matchStatus: "matched_reference" }), null);
  assert.equal(buildDateCheck({ finalVisibleDate: { ...typed, source: "chart-final-visible-date" }, matchStatus: "date_unverified" }), null);
  assert.equal(buildDateCheck({ finalVisibleDate: { ...typed, mode: "selected_day" }, matchStatus: "date_unverified" }), null);
  assert.equal(buildDateCheck({ finalVisibleDate: { ...typed, priceMatched: true }, matchStatus: "matched_reference" }), null);
  assert.equal(buildDateCheck({ finalVisibleDate: null, matchStatus: "date_unverified" }), null);
});

test("server: the fallback runs only in Final visible mode, with no readable date, on OANDA forex, and can be switched off", () => {
  const start = server.indexOf("// FINAL VISIBLE date fallback.");
  assert.ok(start > 0, "the fallback block exists");
  const block = server.slice(start, start + 3600);
  assert.match(block, /FINAL_VISIBLE_DATE_FALLBACK/);
  assert.match(block, /normalizedRequestedCutoffMode === "final_visible"/);
  assert.match(block, /!isUsableChartDateDetection\(chartDetection\)/);
  assert.match(block, /process\.env\.OANDA_API_TOKEN/);
  assert.match(block, /forexPipSize\(normalizedSymbol\)/);
  assert.match(block, /locateFinalVisibleCandle\(/);
  assert.match(block, /latestVisibleDateEvidence: "provider_price_match"/);
  assert.match(block, /catch \(error\)/);
  // The located date is taken before the date is decided, and only the day is used (no exact time).
  assert.ok(server.indexOf("let dateDecision = chooseFinalChartDate({") > start);
  assert.ok(!/latestVisibleTime/.test(block.slice(0, block.indexOf("let dateDecision"))), "the located time is never used");
});

test("server: the review text carries the date check", () => {
  assert.match(server, /dateCheck: buildDateCheck\(/);
  assert.match(server, /"DATE CHECK:"/);
});
