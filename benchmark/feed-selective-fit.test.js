import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyFeedPastCutoff, candleSlotFromClock, intervalToMinutes } from "../candle-alignment.js";
import { fetchLaterCandles } from "../oanda-data.js";
import { isPrintedAxisTick } from "../axis-ticks.js";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

const PIP = 0.0001;
const candle = (datetime, open, high, low, close) => ({ datetime, open, high, low, close });
const unverified = { status: "date_unverified", reason: "no candle fits" };
// AUDUSD, screenshot 13 Nov 12:41 UTC reviewed at the end of 12 Nov: the header of a small, still-forming candle.
const header = { open: 0.67953, high: 0.67966, low: 0.67877, close: 0.67894 };
const CUTOFF = "2026-11-12 23:59:59";
const LOOSE = 7 * PIP;

// A completed candle that fits the header loosely (residual about 3 pips) but not tightly.
const loose = (hour) => candle(`2026-11-13 ${String(hour).padStart(2, "0")}:00:00`, 0.67930, 0.6799, 0.6785, 0.679);
// A candle nowhere near the header.
const far = (hour) => candle(`2026-11-13 ${String(hour).padStart(2, "0")}:00:00`, 0.6821, 0.6828, 0.6815, 0.6824);
// 12 later candles: eight fit loosely, four do not (the real log: hits 8 of window 12).
const twelve = () => [...Array.from({ length: 8 }, (_, i) => loose(i)), ...Array.from({ length: 4 }, (_, i) => far(8 + i))];
// The provider's still-forming 12:00 candle: same open, a range that contains the header's.
const forming = candle("2026-11-13 12:00:00", 0.67953, 0.67990, 0.67870, 0.67920);

const verify = (extra = {}) =>
  verifyFeedPastCutoff({
    chartDataMatch: unverified, candles: twelve(), header, cutoff: CUTOFF, tolerance: LOOSE, maxOffset: PIP * 5, ...extra,
  });

test("the old rule rejects the AUDUSD case: 8 of 12 later candles fit loosely", () => {
  let diag = null;
  const r = verify({ onDiagnostic: (i) => (diag = i) });
  assert.equal(r.status, "date_unverified");
  assert.equal(diag.reason, "fit_not_selective");
  assert.equal(diag.hits, 8);
});

test("the still-forming candle now proves the feed, judged at one pip", () => {
  let diag = null;
  const r = verify({ forming, selectiveTolerance: PIP, onDiagnostic: (i) => (diag = i) });
  assert.equal(r.status, "matched_reference");
  assert.equal(r.matchMode, "header_feed_past_cutoff");
  assert.equal(r.headerCandleDate, "2026-11-13 12:00:00");
  assert.equal(diag.basis, "forming_candle");
});

test("without the forming candle, loose fits alone still prove nothing", () => {
  const r = verify({ selectiveTolerance: PIP });
  assert.equal(r.status, "date_unverified");
});

test("one completed candle that fits to a pip is enough, even when most others fit loosely", () => {
  const exact = candle("2026-11-13 09:00:00", 0.67953, 0.67966, 0.67877, 0.67894);
  const rows = [...twelve().slice(0, 8), exact, far(10), far(11), far(12)];
  let diag = null;
  const r = verifyFeedPastCutoff({
    chartDataMatch: unverified, candles: rows, header, cutoff: CUTOFF, tolerance: LOOSE, maxOffset: PIP * 5,
    selectiveTolerance: PIP, onDiagnostic: (i) => (diag = i),
  });
  assert.equal(r.status, "matched_reference");
  assert.equal(diag.basis, "tight_fit");
  assert.equal(r.headerCandleDate, "2026-11-13 09:00:00");
});

test("too many tight fits is still not selective", () => {
  const exact = (h) => candle(`2026-11-13 ${String(h).padStart(2, "0")}:00:00`, 0.67953, 0.67966, 0.67877, 0.67894);
  const rows = [exact(0), exact(1), exact(2), exact(3), exact(4), exact(5), exact(6), far(7), far(8), far(9), far(10), far(11)];
  const r = verifyFeedPastCutoff({
    chartDataMatch: unverified, candles: rows, header, cutoff: CUTOFF, tolerance: LOOSE, maxOffset: PIP * 5, selectiveTolerance: PIP,
  });
  assert.equal(r.status, "date_unverified");
});

test("a forming candle that does not contain the header is not a match", () => {
  const wrong = candle("2026-11-13 12:00:00", 0.6900, 0.6905, 0.6895, 0.6902);
  const r = verify({ forming: wrong, selectiveTolerance: PIP });
  assert.equal(r.status, "date_unverified");
});

test("a forming candle from before the cutoff is ignored", () => {
  const old = candle("2026-11-12 12:00:00", 0.67953, 0.6799, 0.6787, 0.6792);
  const r = verify({ forming: old, selectiveTolerance: PIP });
  assert.equal(r.status, "date_unverified");
});

test("the earlier rule is unchanged: a rare loose fit in a long window is still accepted", () => {
  const rows = Array.from({ length: 40 }, (_, i) => candle(`2026-11-13 ${String(i % 24).padStart(2, "0")}:00:00`, 0.6821, 0.6828, 0.6815, 0.6824));
  rows[10] = candle("2026-11-13 10:00:00", 0.67956, 0.67962, 0.67871, 0.67897); // a fraction of a pip off on every price
  const r = verifyFeedPastCutoff({ chartDataMatch: unverified, candles: rows, header, cutoff: CUTOFF, tolerance: LOOSE, maxOffset: PIP * 5 });
  assert.equal(r.status, "matched_reference");
});

test("fetchLaterCandles returns the completed candles after the cutoff and the forming one apart", async () => {
  const now = Date.parse("2026-11-13T12:47:00Z");
  const row = (time, complete, o, h, l, c) => ({ time, complete, bid: { o: String(o), h: String(h), l: String(l), c: String(c) } });
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      instrument: "AUD_USD",
      granularity: "H1",
      candles: [
        row("2026-11-12T22:00:00.000000000Z", true, 0.6801, 0.6803, 0.6799, 0.6802),
        row("2026-11-12T23:00:00.000000000Z", true, 0.6802, 0.6805, 0.6800, 0.6804),
        row("2026-11-13T11:00:00.000000000Z", true, 0.6796, 0.6799, 0.6793, 0.6795),
        row("2026-11-13T12:00:00.000000000Z", false, 0.67953, 0.6799, 0.67870, 0.6792),
      ],
    }),
  });
  const out = await fetchLaterCandles({ symbol: "AUDUSD", interval: "1h", cutoff: CUTOFF, timezone: "UTC", token: "test-token-123", now, fetchImpl });
  assert.deepEqual(out.candles.map((c) => c.datetime), ["2026-11-13 11:00:00"]);
  assert.equal(out.forming.datetime, "2026-11-13 12:00:00");
});

test("a printed axis number is recognised, a real level and the last price are not", () => {
  const ticks = [0.7, 0.695, 0.69, 0.685, 0.68];
  assert.equal(isPrintedAxisTick(0.68, ticks), true);
  assert.equal(isPrintedAxisTick(0.69, ticks), true);
  assert.equal(isPrintedAxisTick(0.67894, ticks), false); // the last price
  assert.equal(isPrintedAxisTick(0.6825, ticks), false); // a level between ticks
  assert.equal(isPrintedAxisTick(0.68004, ticks), true); // within half a pip of the tick
  assert.equal(isPrintedAxisTick(0.6801, ticks), false); // a full pip away is a different level
});

test("with fewer than three ticks nothing is judged", () => {
  assert.equal(isPrintedAxisTick(0.68, [0.68, 0.685]), false);
  assert.equal(isPrintedAxisTick(0.68, []), false);
  assert.equal(isPrintedAxisTick(null, [0.7, 0.69, 0.68]), false);
});

test("server: the past-cutoff check uses the forming candle and a one-pip selectivity tolerance", () => {
  const start = server.indexOf("const later = await fetchLaterCandles(");
  assert.ok(start > 0, "uses fetchLaterCandles");
  const block = server.slice(start, start + 2200);
  assert.match(block, /forming: later\.forming/);
  assert.match(block, /selectiveTolerance: forexPipSize\(normalizedSymbol\)/);
  assert.match(block, /candles: later\.candles/);
});

test("server: a line read at a printed axis number is not promoted to a level to watch", () => {
  assert.match(server, /axisTickPrices = \[\],\s*\}\) \{\s*const result = references\.map/);
  const start = server.indexOf("if (isPrintedAxisTick(price, axisTickPrices))");
  assert.ok(start > 0, "the guard exists");
  const before = server.slice(start - 500, start);
  assert.match(before, /if \(!matchingFrameworkArea\) \{/, "only for a line with no framework level behind it");
  assert.match(server, /axisTickPrices: chartDetection\?\.priceAxisTicks,/);
});

// The review ran 13:30, an hour after the 12:41 screenshot: the header's candle (12:00) has completed
// and grown, so the full four-price fit no longer holds, and the new 13:00 candle is not the header's.
test("a completed candle that has grown past the header (same open, range contains it) proves the feed", () => {
  const grown = candle("2026-11-13 12:00:00", 0.67953, 0.68010, 0.67861, 0.67990);
  const rows = [...twelve().slice(0, 8), far(8), far(9), far(10), far(11), grown];
  let diag = null;
  const r = verifyFeedPastCutoff({
    chartDataMatch: unverified, candles: rows, header, cutoff: CUTOFF, tolerance: LOOSE, maxOffset: PIP * 5,
    selectiveTolerance: PIP, onDiagnostic: (i) => (diag = i),
  });
  assert.equal(r.status, "matched_reference");
  assert.equal(diag.basis, "grown_candle");
  assert.equal(r.headerCandleDate, "2026-11-13 12:00:00");
});

test("a candle with a different open is not a grown match, however wide its range", () => {
  const wide = candle("2026-11-13 12:00:00", 0.67900, 0.68300, 0.67700, 0.68000);
  const rows = [...twelve().slice(0, 8), far(8), far(9), far(10), far(11), wide];
  const r = verifyFeedPastCutoff({
    chartDataMatch: unverified, candles: rows, header, cutoff: CUTOFF, tolerance: LOOSE, maxOffset: PIP * 5, selectiveTolerance: PIP,
  });
  assert.equal(r.status, "date_unverified");
});

test("a candle whose range does not contain the header's is not a grown match", () => {
  const narrow = candle("2026-11-13 12:00:00", 0.67953, 0.67958, 0.67900, 0.67930);
  const rows = [...twelve().slice(0, 8), far(8), far(9), far(10), far(11), narrow];
  const r = verifyFeedPastCutoff({
    chartDataMatch: unverified, candles: rows, header, cutoff: CUTOFF, tolerance: LOOSE, maxOffset: PIP * 5, selectiveTolerance: PIP,
  });
  assert.equal(r.status, "date_unverified");
});

test("many candles with the same open and a wide range are not selective", () => {
  const same = (h) => candle(`2026-11-13 ${String(h).padStart(2, "0")}:00:00`, 0.67953, 0.68100, 0.67700, 0.67990);
  const rows = [same(0), same(1), same(2), same(3), same(4), same(5), far(6), far(7), far(8), far(9), far(10), far(11)];
  const r = verifyFeedPastCutoff({
    chartDataMatch: unverified, candles: rows, header, cutoff: CUTOFF, tolerance: LOOSE, maxOffset: PIP * 5, selectiveTolerance: PIP,
  });
  assert.equal(r.status, "date_unverified");
});

// AUDUSD 13 Nov, reviewed at 14:26 from a 12:41 screenshot: four quiet candles look like the header.
const lookalikes = () => [
  ...Array.from({ length: 10 }, (_, i) => far(i)),
  candle("2026-11-13 10:00:00", 0.67948, 0.67961, 0.67812, 0.67844),
  candle("2026-11-13 11:00:00", 0.67950, 0.67990, 0.67860, 0.67960),
  candle("2026-11-13 12:00:00", 0.67953, 0.68010, 0.67861, 0.67990), // the header's candle, grown since 12:41
  far(13),
];
const formingLate = candle("2026-11-13 14:00:00", 0.67940, 0.67970, 0.67850, 0.67930);
const lookalikeArgs = (extra = {}) => ({
  chartDataMatch: unverified, candles: lookalikes(), header, cutoff: CUTOFF, tolerance: LOOSE, maxOffset: PIP * 5,
  selectiveTolerance: PIP, forming: formingLate, ...extra,
});

test("without the clock, four lookalike candles are not selective", () => {
  const r = verifyFeedPastCutoff(lookalikeArgs());
  assert.equal(r.status, "date_unverified");
});

test("the chart clock names the header's candle, so lookalikes do not matter", () => {
  let diag = null;
  const r = verifyFeedPastCutoff(lookalikeArgs({ clock: "12:41:56", intervalMinutes: 60, onDiagnostic: (i) => (diag = i) }));
  assert.equal(r.status, "matched_reference");
  assert.equal(diag.basis, "clock_candle");
  assert.equal(r.headerCandleDate, "2026-11-13 12:00:00");
});

test("a clock whose candle does not fit the header proves nothing", () => {
  const r = verifyFeedPastCutoff(lookalikeArgs({ clock: "09:30:00", intervalMinutes: 60 }));
  assert.equal(r.status, "date_unverified");
});

test("a clock with no matching candle after the cutoff falls through to the other rules", () => {
  const r = verifyFeedPastCutoff(lookalikeArgs({ clock: "20:05:00", intervalMinutes: 60 }));
  assert.equal(r.status, "date_unverified");
});

test("a clock candle must still hold the header's open and range", () => {
  // Only the named candle is a lookalike, and it has the wrong open: nothing else may rescue the match.
  const rows = lookalikes().map((c) => (c.datetime.endsWith("12:00:00") ? candle(c.datetime, 0.67900, 0.68300, 0.67700, 0.68000) : /(10|11):00:00$/.test(c.datetime) ? far(Number(c.datetime.slice(11, 13))) : c));
  const r = verifyFeedPastCutoff(lookalikeArgs({ candles: rows, forming: null, clock: "12:41:56", intervalMinutes: 60 }));
  assert.equal(r.status, "date_unverified");
});

test("the candle named by a clock", () => {
  assert.equal(candleSlotFromClock("12:41:56", 60), "12:00");
  assert.equal(candleSlotFromClock("12:41", 15), "12:30");
  assert.equal(candleSlotFromClock("00:04:10", 5), "00:00");
  assert.equal(candleSlotFromClock("12:41:56", 240), null);
  assert.equal(candleSlotFromClock(null, 60), null);
  assert.equal(candleSlotFromClock("25:61", 60), null);
  assert.equal(candleSlotFromClock("12:41:56", 7), null);
});

test("chart timeframes as minutes", () => {
  assert.equal(intervalToMinutes("1h"), 60);
  assert.equal(intervalToMinutes("15min"), 15);
  assert.equal(intervalToMinutes("5min"), 5);
  assert.equal(intervalToMinutes("4h"), 240);
  assert.equal(intervalToMinutes("1day"), null);
  assert.equal(intervalToMinutes(""), null);
});

test("server: the chart clock and timeframe are passed to the past-cutoff check", () => {
  const start = server.indexOf("const pastCutoffMatch = verifyFeedPastCutoff(");
  assert.ok(start > 0);
  const block = server.slice(start, start + 2200);
  assert.match(block, /clock: chartDetection\?\.chartClock/);
  assert.match(block, /intervalMinutes: intervalToMinutes\(selectedTimeframeProfile\.interval\)/);
});

test("the clock candle may differ from the header's open by a pip or two (the chart's feed is not the provider's)", () => {
  // Open 1.5 pips away, range still contains the header's.
  const rows = lookalikes().map((c) => (c.datetime.endsWith("12:00:00") ? candle(c.datetime, 0.67938, 0.68010, 0.67861, 0.67990) : /(10|11):00:00$/.test(c.datetime) ? far(Number(c.datetime.slice(11, 13))) : c));
  let diag = null;
  const r = verifyFeedPastCutoff(lookalikeArgs({ candles: rows, forming: null, clock: "12:41:56", intervalMinutes: 60, onDiagnostic: (i) => (diag = i) }));
  assert.equal(r.status, "matched_reference");
  assert.equal(diag.basis, "clock_candle");
});

test("every diagnostic says what the clock contributed, so a miss can be explained from the log", () => {
  let diag = null;
  verifyFeedPastCutoff(lookalikeArgs({ clock: "09:30:00", intervalMinutes: 60, onDiagnostic: (i) => (diag = i) }));
  assert.equal(diag.clockCheck.slot, "09:00");
  assert.equal(diag.clockCheck.candidates.length, 1);
  assert.equal(diag.clockCheck.candidates[0].ok, false);
  let none = null;
  verifyFeedPastCutoff(lookalikeArgs({ onDiagnostic: (i) => (none = i) }));
  assert.equal(none.clockCheck.clock, null);
  assert.equal(none.clockCheck.slot, null);
});
