import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOandaSeries, forexComparisonTolerance, oandaInstrument, syntheticIndexTolerance, isSyntheticInstrument, DXY_INSTRUMENT } from '../oanda-data.js';

// The US Dollar Index has no feed of its own, so it is computed from six OANDA pairs.
const BASE = { EUR_USD: 1.1, USD_JPY: 150, GBP_USD: 1.3, USD_CAD: 1.35, USD_SEK: 10, USD_CHF: 0.9 };
const WEIGHT = { EUR_USD: -0.576, USD_JPY: 0.136, GBP_USD: -0.119, USD_CAD: 0.091, USD_SEK: 0.042, USD_CHF: 0.036 };
const GRAN = { M1: 1, M5: 5, M15: 15, H1: 60 };
const dxy = (rates) => 50.14348112 * Object.keys(WEIGHT).reduce((v, pair) => v * Math.pow(rates[pair], WEIGHT[pair]), 1);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', '.000000000Z');

// Every pair stays flat except EUR_USD, which rises 0.001 per fine candle (index number n opens at 1.1 + 0.001*n).
function rateAt(pair, n) { return pair === 'EUR_USD' ? BASE.EUR_USD + 0.001 * n : BASE[pair]; }
function makeFetch({ firstMs, count, minutes, skip = {}, calls = [] }) {
  return async (url) => {
    const u = new URL(url);
    const pair = u.pathname.split('/')[3];
    const granularity = u.searchParams.get('granularity');
    calls.push({ pair, granularity });
    const candles = [];
    for (let n = 0; n < count; n++) {
      if (skip[pair] === n) continue;
      const open = rateAt(pair, n), close = rateAt(pair, n + 0.5);
      const hi = Math.max(open, close), lo = Math.min(open, close);
      candles.push({ time: iso(firstMs + n * minutes * 60000), complete: true, bid: { o: String(open), h: String(hi), l: String(lo), c: String(close) } });
    }
    return { ok: true, json: async () => ({ instrument: pair, granularity, candles }) };
  };
}

test('the Dollar Index and the extra index/commodity names route to a provider code', () => {
  for (const name of ['DXY', 'USDINDEX', 'USDIDX']) assert.equal(oandaInstrument(name), DXY_INSTRUMENT);
  assert.equal(isSyntheticInstrument('DXY'), true);
  assert.equal(isSyntheticInstrument('GBPUSD'), false);
  assert.equal(forexComparisonTolerance('DXY'), null);
  assert.equal(syntheticIndexTolerance('DXY'), 0.25);
  assert.equal(syntheticIndexTolerance('GBPUSD'), null);
  assert.equal(oandaInstrument('FRA40'), 'FR40_EUR');
  assert.equal(oandaInstrument('EU50'), 'EU50_EUR');
  assert.equal(oandaInstrument('ESP35'), 'ES35_EUR');
  assert.equal(oandaInstrument('HK50'), 'HK33_HKD');
  assert.equal(oandaInstrument('AUS200'), 'AU200_AUD');
  assert.equal(oandaInstrument('CHINA50'), 'CN50_USD');
  assert.equal(oandaInstrument('NATGAS'), 'NATGAS_USD');
  // Existing routes are untouched.
  assert.equal(oandaInstrument('US30'), 'US30_USD');
  assert.equal(oandaInstrument('GBPUSD'), 'GBP_USD');
});

test('an H1 index candle is rolled up from M15 candles of the six pairs (historical cutoff)', async () => {
  const calls = [];
  const firstMs = Date.UTC(2026, 10, 10, 20, 0, 0);
  const result = await fetchOandaSeries({
    symbol: 'DXY', interval: '1h', startDate: '2026-11-10', endDateTime: '2026-11-10 22:30:59', token: 'test',
    fetchImpl: makeFetch({ firstMs, count: 10, minutes: 15, calls }),
  });
  // Six pairs asked for, all at M15.
  assert.deepEqual(calls.map((c) => c.pair).sort(), Object.keys(BASE).sort());
  assert.ok(calls.every((c) => c.granularity === 'M15'));
  assert.equal(result.synthetic, true);
  assert.equal(result.providerSymbol, 'DXY');
  // 20:00 and 21:00 are whole hours; 22:00 holds only 22:00 and 22:15 but the cutoff is long past, so it is kept.
  assert.deepEqual(result.values.map((v) => v.datetime), ['2026-11-10 20:00:00', '2026-11-10 21:00:00', '2026-11-10 22:00:00']);
  const first = result.values[0];
  const rates = (n) => Object.fromEntries(Object.keys(BASE).map((pair) => [pair, rateAt(pair, n)]));
  assert.equal(first.open, Number(dxy(rates(0)).toFixed(4)));
  assert.equal(first.close, Number(dxy(rates(3.5)).toFixed(4)));
  // EUR_USD only rises, so the index only falls: high is the first open, low is the last close.
  assert.equal(first.high, first.open);
  assert.equal(first.low, first.close);
  assert.ok(first.open > first.close);
  // A sensible index level (about 100).
  assert.ok(first.open > 95 && first.open < 110);
});

test('a candle still forming inside a live window goes to the comparison candle, not the history', async () => {
  // "Now" is fixed at 22:40 UTC so the cutoff is inside the 22:00 hour and counts as a live window.
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 10, 10, 22, 40, 0);
  try {
    const firstMs = Date.UTC(2026, 10, 10, 19, 0, 0);
    // M15 candles 19:00 .. 22:30; the 22:30 one is still forming (it ends 22:45, after the cutoff).
    const result = await fetchOandaSeries({
      symbol: 'USDINDEX', interval: '1h', startDate: '2026-11-10', endDateTime: '2026-11-10 22:40:00', token: 'test',
      fetchImpl: makeFetch({ firstMs, count: 15, minutes: 15 }),
    });
    assert.ok(result.alignmentCandle, 'the forming hour is reported as the comparison candle');
    assert.equal(result.alignmentCandle.datetime, '2026-11-10 22:00:00');
    assert.deepEqual(result.values.map((v) => v.datetime), ['2026-11-10 19:00:00', '2026-11-10 20:00:00', '2026-11-10 21:00:00']);
  } finally {
    Date.now = realNow;
  }
});

test('a moment missing for one pair is skipped, not guessed', async () => {
  const firstMs = Date.UTC(2026, 10, 10, 20, 0, 0);
  const result = await fetchOandaSeries({
    symbol: 'DXY', interval: '1h', startDate: '2026-11-10', endDateTime: '2026-11-10 22:30:59', token: 'test',
    // USD_SEK has no candle number 3 (20:45), the last quarter of the 20:00 hour.
    fetchImpl: makeFetch({ firstMs, count: 10, minutes: 15, skip: { USD_SEK: 3 } }),
  });
  const first = result.values[0];
  const rates = (n) => Object.fromEntries(Object.keys(BASE).map((pair) => [pair, rateAt(pair, n)]));
  // Candle 3 cannot be computed for every pair, so the hour ends at candle 2's close.
  assert.equal(first.open, Number(dxy(rates(0)).toFixed(4)));
  assert.equal(first.close, Number(dxy(rates(2.5)).toFixed(4)));
});

test('candle sizes with no finer source are refused rather than invented', async () => {
  await assert.rejects(
    fetchOandaSeries({ symbol: 'DXY', interval: '1month', startDate: '2026-01-01', endDateTime: '2026-11-10 22:30:59', token: 'test', fetchImpl: async () => { throw new Error('should not be called'); } }),
    (e) => e.category === 'symbol_unavailable'
  );
});

test('a daily index candle is rolled up from H1 candles by calendar day', async () => {
  const calls = [];
  const firstMs = Date.UTC(2026, 10, 9, 0, 0, 0);
  const result = await fetchOandaSeries({
    symbol: 'DXY', interval: '1day', startDate: '2026-11-09', endDateTime: '2026-11-11 12:00:00', token: 'test',
    fetchImpl: makeFetch({ firstMs, count: 48, minutes: 60, calls }),
  });
  assert.ok(calls.every((c) => c.granularity === 'H1'));
  assert.deepEqual(result.values.map((v) => v.datetime), ['2026-11-09 00:00:00', '2026-11-10 00:00:00']);
});
