import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FORMING_FINER, formingBucketEnd, formingCandleNeedsRebuild, rebuildFormingCandle, wallClockNow } from '../forming-candle.js';

// A chart captured at 00:39 UTC and reviewed at 02:16 UTC.
const NOW = Date.UTC(2026, 10, 18, 2, 16, 0);
const CUTOFF = '2026-11-18 00:39:59';
const hhmm = (n) => `2026-11-18 ${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`;
const bar = (n, o, h, l, c) => ({ datetime: hhmm(n), open: String(o), high: String(h), low: String(l), close: String(c) });

// Gold slides 0.2 a minute from 3860; minute 10 spikes to 3875.4 (before the cutoff).
const sliding = () => Array.from({ length: 136 }, (_, n) => {
  const close = 3860 - n * 0.2;
  return bar(n, close + 0.2, n === 10 ? 3875.4 : close + 0.3, close - 0.1, close);
});

test('a candle ends where its size says it does', () => {
  assert.equal(formingBucketEnd('2026-11-18', '1day'), '2026-11-19 00:00:00');
  assert.equal(formingBucketEnd('2026-11-18 00:00:00', '4h'), '2026-11-18 04:00:00');
  assert.equal(formingBucketEnd('2026-11-16', '1week'), '2026-11-23 00:00:00');
  assert.equal(formingBucketEnd('2026-11-01', '1month'), '2026-12-01 00:00:00');
  assert.equal(formingBucketEnd('2026-11-18', '1min'), null);
  assert.equal(FORMING_FINER['1day'], '1min');
});

test('wall-clock time is read in the requested timezone', () => {
  assert.equal(wallClockNow('UTC', NOW), '2026-11-18 02:16:00');
  assert.equal(wallClockNow('Africa/Lagos', NOW), '2026-11-18 03:16:00');
  assert.equal(wallClockNow('Not/AZone', NOW), null);
});

test('only an old cutoff inside a candle that is still open is rebuilt', () => {
  const candle = { datetime: '2026-11-18' };
  const base = { candle, interval: '1day', cutoff: CUTOFF, timezone: 'UTC', nowMs: NOW };
  assert.equal(formingCandleNeedsRebuild(base), true);
  // Screenshot only a minute old: the live candle is right.
  assert.equal(formingCandleNeedsRebuild({ ...base, nowMs: Date.UTC(2026, 10, 18, 0, 41, 0) }), false);
  // The candle has closed since (reviewed two days later): the past-cutoff checks own that.
  assert.equal(formingCandleNeedsRebuild({ ...base, nowMs: Date.UTC(2026, 10, 20, 2, 0, 0) }), false);
  // The cutoff lies in an earlier candle.
  assert.equal(formingCandleNeedsRebuild({ ...base, cutoff: '2026-11-17 23:30:00' }), false);
  // An interval with no finer rebuild, or no candle at all.
  assert.equal(formingCandleNeedsRebuild({ ...base, interval: '1min' }), false);
  assert.equal(formingCandleNeedsRebuild({ ...base, candle: undefined }), false);
  process.env.FORMING_CANDLE_AT_CUTOFF = 'off';
  try { assert.equal(formingCandleNeedsRebuild(base), false); } finally { delete process.env.FORMING_CANDLE_AT_CUTOFF; }
});

test('close, and a low made after the screenshot, are rolled back to the cutoff; an earlier high is kept', () => {
  const rows = sliding();
  const candle = { datetime: '2026-11-18', open: '3860.2', high: '3875.4', low: String(3860 - 135 * 0.2 - 0.1), close: String(3860 - 135 * 0.2) };
  const rebuilt = rebuildFormingCandle({ candle, fineRows: rows, cutoff: CUTOFF });
  // The last minute at or before 00:39:59 is the 00:39 bar.
  assert.equal(rebuilt.close, 3860 - 39 * 0.2);
  assert.equal(rebuilt.low, 3860 - 39 * 0.2 - 0.1);
  assert.equal(rebuilt.high, 3875.4);
  assert.equal(rebuilt.open, 3860.2);
  assert.ok(Math.abs(rebuilt.close - Number(candle.close)) > 15, 'moved away from the 02:16 close');
});

test('a high made after the screenshot is replaced by the highest finer candle up to the cutoff', () => {
  const rows = Array.from({ length: 136 }, (_, n) => bar(n, 3800 + n * 0.1, 3800 + n * 0.1 + 0.2, 3800 + n * 0.1 - 0.1, 3800 + n * 0.1 + 0.1));
  const candle = { datetime: '2026-11-18', open: '3800', high: String(3800 + 135 * 0.1 + 0.2), low: '3799.9', close: String(3800 + 135 * 0.1 + 0.1) };
  const rebuilt = rebuildFormingCandle({ candle, fineRows: rows, cutoff: CUTOFF });
  assert.equal(rebuilt.high, 3800 + 39 * 0.1 + 0.2);
  assert.equal(rebuilt.close, 3800 + 39 * 0.1 + 0.1);
  assert.equal(rebuilt.low, 3799.9, 'the early low set before the cutoff is kept');
});

test('nothing to rebuild from means no candle', () => {
  assert.equal(rebuildFormingCandle({ candle: { datetime: '2026-11-18', open: 1, high: 2, low: 1, close: 1.5 }, fineRows: [], cutoff: CUTOFF }), null);
  assert.equal(rebuildFormingCandle({ candle: { datetime: '2026-11-18', open: 1, high: 2, low: 1, close: 1.5 }, fineRows: [bar(900, 1, 2, 1, 1.5)], cutoff: CUTOFF }), null);
});

test('the server rebuilds only the primary-interval candle, and keeps the provider candle on any failure', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /interval === profile\.interval\s*\? await formingValuesAtCutoff\(/);
  assert.match(server, /formingCandleNeedsRebuild\(\{ candle: last, interval, cutoff, timezone \}\)/);
  assert.match(server, /\[forming-candle\] kept the provider candle/);
  assert.match(server, /formingAtCutoff:interval === profile\.interval/);
});
