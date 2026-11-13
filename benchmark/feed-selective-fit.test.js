import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyFeedPastCutoff } from "../candle-alignment.js";
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
const loose = (hour) => candle(`2026-11-13 ${String(hour).padStart(2, "0")}:00:00`, 0.67953, 0.6799, 0.6785, 0.679);
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
