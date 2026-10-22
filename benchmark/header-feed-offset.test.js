import test from "node:test";
import assert from "node:assert/strict";
import { reconcileWithHeaderFeedOffset } from "../candle-alignment.js";

// A provider series of distinct hourly candles (each has its own shape), plus a broker feed that
// sits a constant 0.0005 above it.
function series(count) {
  const rows = [];
  let price = 1.1;
  // Seeded pseudo-random shapes, so every candle has its own body and wick sizes.
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < count; i += 1) {
    const move = (random() - 0.5) * 0.004;
    const open = price;
    const close = price + move;
    const high = Math.max(open, close) + 0.0001 + random() * 0.0025;
    const low = Math.min(open, close) - 0.0001 - random() * 0.0025;
    const day = String(1 + Math.floor(i / 24)).padStart(2, "0");
    const hour = String(i % 24).padStart(2, "0");
    rows.push({
      datetime: `2026-10-${day} ${hour}:00:00`,
      open: Number(open.toFixed(5)),
      high: Number(high.toFixed(5)),
      low: Number(low.toFixed(5)),
      close: Number(close.toFixed(5)),
    });
    price = close;
  }
  return rows;
}

const OFFSET = 0.0005;
const candles = series(200);
const hovered = candles[120];
const header = {
  open: hovered.open + OFFSET,
  high: hovered.high + OFFSET,
  low: hovered.low + OFFSET,
  close: hovered.close + OFFSET,
};
const lastClose = candles[candles.length - 1].close + OFFSET;
const unverified = { status: "date_unverified", candleDate: candles[candles.length - 1].datetime };
const base = { chartDataMatch: unverified, candles, header, lastClose, tolerance: 0.0003, maxOffset: 0.0015 };

test("a header that identifies one candle, with a feed offset that fits the last price, verifies the feed", () => {
  const result = reconcileWithHeaderFeedOffset(base);
  assert.equal(result.status, "matched_reference");
  assert.equal(result.matchMode, "header_feed_offset");
  assert.equal(result.headerCandleDate, hovered.datetime);
  assert.ok(Math.abs(result.feedOffset - OFFSET) < 0.00005);
  assert.equal(result.priorStatus, "date_unverified");
});

test("it never touches a status that is already a match", () => {
  const matched = { status: "matched_reference", candleDate: "x" };
  assert.equal(reconcileWithHeaderFeedOffset({ ...base, chartDataMatch: matched }), matched);
  const partial = { status: "partial_reference", candleDate: "x" };
  assert.equal(reconcileWithHeaderFeedOffset({ ...base, chartDataMatch: partial }), partial);
});

test("the offset must carry through to the chart's last price", () => {
  const result = reconcileWithHeaderFeedOffset({ ...base, lastClose: lastClose + 0.001 });
  assert.equal(result, unverified);
});

test("two similar candles in the recent window make the match a coincidence", () => {
  const twin = candles.map((c) => ({ ...c }));
  twin[150] = { ...twin[150], open: twin[120].open, high: twin[120].high, low: twin[120].low, close: twin[120].close };
  const result = reconcileWithHeaderFeedOffset({ ...base, candles: twin });
  assert.equal(result, unverified);
});

test("a candle older than the recent window is not searched", () => {
  const oldHeader = {
    open: candles[10].open + OFFSET,
    high: candles[10].high + OFFSET,
    low: candles[10].low + OFFSET,
    close: candles[10].close + OFFSET,
  };
  const result = reconcileWithHeaderFeedOffset({ ...base, header: oldHeader, window: 100 });
  assert.equal(result, unverified);
});

test("a missing or broken header changes nothing", () => {
  assert.equal(reconcileWithHeaderFeedOffset({ ...base, header: { open: null, high: null, low: null, close: null } }), unverified);
  assert.equal(reconcileWithHeaderFeedOffset({ ...base, header: { open: 1.2, high: 1.1, low: 1.15, close: 1.18 } }), unverified);
  assert.equal(reconcileWithHeaderFeedOffset({ ...base, lastClose: null }), unverified);
});

test("an offset larger than the same-instrument bound is rejected", () => {
  const far = {
    open: hovered.open + 0.01,
    high: hovered.high + 0.01,
    low: hovered.low + 0.01,
    close: hovered.close + 0.01,
  };
  const result = reconcileWithHeaderFeedOffset({ ...base, header: far, lastClose: candles[candles.length - 1].close + 0.01 });
  assert.equal(result, unverified);
});

test("the outcome is reported for logging, whether or not the status changed", () => {
  const seen = [];
  reconcileWithHeaderFeedOffset({ ...base, onDiagnostic: (info) => seen.push(info.reason) });
  reconcileWithHeaderFeedOffset({ ...base, lastClose: lastClose + 0.01, onDiagnostic: (info) => seen.push(info.reason) });
  assert.deepEqual(seen, ["upgraded", "offset_does_not_reach_last_price"]);
});
