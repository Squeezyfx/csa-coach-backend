import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyFeedPastCutoff } from "../candle-alignment.js";
import { fetchCandlesAfterCutoff } from "../oanda-data.js";

// EURAUD H1, reviewed at 2026-11-04 06:00 (Africa/Lagos) on a screenshot that runs to Friday 6 Nov.
// Provider candles after the cutoff; the chart feed sits a constant 0.0004 above the provider.
if (!AbortSignal.timeout) AbortSignal.timeout = () => undefined;
const OFFSET = 0.0004;
function series(count) {
  const rows = [];
  let price = 1.609;
  let seed = 4242;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < count; i += 1) {
    const move = (random() - 0.5) * 0.003;
    const open = price;
    const close = price + move;
    const high = Math.max(open, close) + 0.0001 + random() * 0.002;
    const low = Math.min(open, close) - 0.0001 - random() * 0.002;
    const day = String(4 + Math.floor((i + 7) / 24)).padStart(2, "0");
    const hour = String((i + 7) % 24).padStart(2, "0");
    rows.push({
      datetime: `2026-11-${day} ${hour}:00:00`,
      open: Number(open.toFixed(5)),
      high: Number(high.toFixed(5)),
      low: Number(low.toFixed(5)),
      close: Number(close.toFixed(5)),
    });
    price = close;
  }
  return rows;
}

const cutoff = "2026-11-04 06:00:59";
const later = series(60);
const last = later[later.length - 1];
const header = {
  open: last.open + OFFSET,
  high: last.high + OFFSET,
  low: last.low + OFFSET,
  close: last.close + OFFSET,
};
const unverified = { status: "date_unverified", candleDate: "2026-11-04 06:00:00", comparisons: [{ field: "close", chart: 1.62246, provider: 1.60902 }] };
const base = { chartDataMatch: unverified, candles: later, header, cutoff, tolerance: 0.0003, maxOffset: 0.0015 };

test("a header candle found after the cutoff verifies the feed", () => {
  const result = verifyFeedPastCutoff(base);
  assert.equal(result.status, "matched_reference");
  assert.equal(result.matchMode, "header_feed_past_cutoff");
  assert.equal(result.headerCandleDate, last.datetime);
  assert.equal(result.priorStatus, "date_unverified");
  assert.ok(Math.abs(result.feedOffset - OFFSET) < 0.00005);
});

test("the proof replaces the cutoff-price comparison, so the same-instrument check passes", () => {
  const result = verifyFeedPastCutoff(base);
  assert.equal(result.comparisons.length, 4);
  for (const item of result.comparisons) {
    assert.ok(Math.abs(item.chart - item.provider) / item.chart < 0.005);
  }
});

test("time_unverified, mismatch and partial_or_unknown_candle are handled the same way", () => {
  for (const status of ["time_unverified", "mismatch", "partial_or_unknown_candle"]) {
    const result = verifyFeedPastCutoff({ ...base, chartDataMatch: { ...unverified, status } });
    assert.equal(result.status, "matched_reference");
    assert.equal(result.priorStatus, status);
  }
});

test("a status that already matches is never touched", () => {
  const matched = { status: "matched_reference", candleDate: "x" };
  assert.equal(verifyFeedPastCutoff({ ...base, chartDataMatch: matched }), matched);
  const partial = { status: "partial_reference", candleDate: "x" };
  assert.equal(verifyFeedPastCutoff({ ...base, chartDataMatch: partial }), partial);
});

test("only candles after the cutoff count", () => {
  // The header equals a candle BEFORE the cutoff: that is the ordinary check's job, not this one.
  const before = { datetime: "2026-11-04 05:00:00", open: 1.6, high: 1.6012, low: 1.5995, close: 1.6008 };
  const beforeHeader = { open: before.open + OFFSET, high: before.high + OFFSET, low: before.low + OFFSET, close: before.close + OFFSET };
  const result = verifyFeedPastCutoff({ ...base, candles: [before, ...later], header: beforeHeader });
  assert.equal(result, unverified);
});

test("a header that matches nothing after the cutoff leaves the status as it was", () => {
  const stranger = { open: 1.7, high: 1.7012, low: 1.6995, close: 1.7008 };
  const seen = [];
  const result = verifyFeedPastCutoff({ ...base, header: stranger, onDiagnostic: (info) => seen.push(info.reason) });
  assert.equal(result, unverified);
  assert.deepEqual(seen, ["no_candle_after_cutoff_fits_header"]);
});

test("a different instrument (large offset) is rejected", () => {
  const far = { open: last.open + 0.02, high: last.high + 0.02, low: last.low + 0.02, close: last.close + 0.02 };
  assert.equal(verifyFeedPastCutoff({ ...base, header: far }), unverified);
});

test("a second candle that fits almost as well does not block the match: only the feed is proven", () => {
  const twin = later.map((c) => ({ ...c }));
  twin[20] = { ...twin[20], open: last.open, high: last.high, low: last.low, close: last.close };
  twin[20] = { ...twin[20], high: Number((last.high + 0.00001).toFixed(5)) };
  const result = verifyFeedPastCutoff({ ...base, candles: twin });
  assert.equal(result.status, "matched_reference");
  assert.equal(result.matchMode, "header_feed_past_cutoff");
});

test("the live EURAUD case: a 2.5 pip residual with 5 of 64 candles fitting is accepted at the ATR-scaled tolerance", () => {
  // Quiet Friday session: five hourly candles share the header's shape within the tolerance (0.0007).
  // The best fit is 2.55 pips off (the spread widens into the weekly close), the runner-up 4.05 pips.
  const residuals = [0.000255, 0.000405, 0.0005, 0.00055, 0.0006];
  const target = { open: 1.62337, high: 1.62368, low: 1.62197, close: 1.62246 };
  const rows = Array.from({ length: 64 }, (_, i) => ({
    datetime: `2026-11-05 ${String(i % 24).padStart(2, "0")}:00:00`,
    open: 1.5, high: 1.5012, low: 1.4995, close: 1.5008, // far from the header: no fit
  }));
  residuals.forEach((residual, n) => {
    // Same shape as the header, one field pushed away by the residual.
    rows[10 + n * 9] = {
      datetime: `2026-11-05 ${String(10 + n * 9).padStart(2, "0")}:00:00`,
      open: target.open - 0.0004, high: target.high - 0.0004 - residual, low: target.low - 0.0004, close: target.close - 0.0004,
    };
  });
  const seen = [];
  const result = verifyFeedPastCutoff({
    ...base, candles: rows, header: target, tolerance: 0.0007, maxOffset: 0.0015, onDiagnostic: (info) => seen.push(info),
  });
  assert.equal(result.status, "matched_reference");
  assert.equal(seen[0].reason, "upgraded");
  assert.equal(seen[0].hits, 5);
});

test("a shape that fits most of the later candles proves nothing and is rejected", () => {
  const flat = later.map((c) => ({ ...c, open: last.open, high: last.high, low: last.low, close: last.close }));
  const seen = [];
  const result = verifyFeedPastCutoff({ ...base, candles: flat, onDiagnostic: (info) => seen.push(info.reason) });
  assert.equal(result, unverified);
  assert.deepEqual(seen, ["fit_not_selective"]);
});

test("a fit looser than half the tolerance is rejected", () => {
  const loose = { open: last.open + OFFSET, high: last.high + OFFSET + 0.00019, low: last.low + OFFSET, close: last.close + OFFSET };
  assert.equal(verifyFeedPastCutoff({ ...base, header: loose, tolerance: 0.0003 }), unverified);
});

test("no later candles, a missing header or a missing cutoff change nothing", () => {
  const seen = [];
  assert.equal(verifyFeedPastCutoff({ ...base, candles: [], onDiagnostic: (info) => seen.push(info.reason) }), unverified);
  assert.deepEqual(seen, ["no_candles_after_cutoff"]);
  assert.equal(verifyFeedPastCutoff({ ...base, header: { open: null, high: null, low: null, close: null } }), unverified);
  assert.equal(verifyFeedPastCutoff({ ...base, cutoff: "" }), unverified);
});

test("the later candles are evidence only: they are not returned for analysis", () => {
  const result = verifyFeedPastCutoff(base);
  assert.equal(result.candles, undefined);
  assert.equal(result.timeframeCandles, undefined);
});

test("fetchCandlesAfterCutoff asks for candles from the cutoff day and returns only those after it", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    const candle = (time, o) => ({ time, complete: true, bid: { o: String(o), h: String(o + 0.001), l: String(o - 0.001), c: String(o + 0.0004) } });
    return {
      ok: true,
      json: async () => ({
        instrument: "EUR_AUD",
        granularity: "H1",
        candles: [
          candle("2026-11-04T04:00:00.000000000Z", 1.608), // 05:00 Lagos, before the cutoff
          candle("2026-11-04T05:00:00.000000000Z", 1.609), // 06:00 Lagos, the last included candle
          candle("2026-11-04T06:00:00.000000000Z", 1.61), // 07:00 Lagos, after
          candle("2026-11-04T07:00:00.000000000Z", 1.611),
        ],
      }),
    };
  };
  const rows = await fetchCandlesAfterCutoff({
    symbol: "EURAUD",
    interval: "1h",
    cutoff: "2026-11-04 06:00:59",
    timezone: "Africa/Lagos",
    token: "test-token-value-0000000000000000",
    environment: "practice",
    now: Date.parse("2026-11-07T00:00:00Z"),
    fetchImpl,
  });
  assert.deepEqual(rows.map((r) => r.datetime), ["2026-11-04 07:00:00", "2026-11-04 08:00:00"]);
  assert.match(requests[0], /from=2026-11-03T23%3A00%3A00\.000Z/);
});

test("the server runs the check only for a user-chosen cutoff, only on OANDA, and keeps the review on the cutoff candles", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /verifyFeedPastCutoff,? ?[^;]*from "\.\/candle-alignment\.js"|verifyFeedPastCutoff } from "\.\/candle-alignment\.js"/);
  assert.match(server, /PAST_CUTOFF_FEED_CHECK/);
  assert.match(server, /\["exact", "selected_day"\]\.includes\(normalizedRequestedCutoffMode\)/);
  // The later header must never be pasted into the candles as a snapshot.
  assert.match(server, /chartDataMatch\.matchMode !== "header_feed_past_cutoff" && marketReference\.oandaAlignmentCandle/);
  // The later candles are fetched into a local variable only.
  assert.doesNotMatch(server, /marketReference\.timeframeCandles\s*=\s*\[\.\.\.laterCandles/);
});
