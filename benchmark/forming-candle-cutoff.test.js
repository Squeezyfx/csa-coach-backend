import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOandaSeries } from '../oanda-data.js';

// A chart captured at 00:39 UTC and reviewed at 02:16 UTC. OANDA's forming daily candle reflects 02:16, not 00:39.
const REAL_NOW = Date.now;
const NOW = Date.UTC(2026, 10, 18, 2, 16, 0);
const CUTOFF = '2026-11-18 00:39:59';
const DAY = Date.UTC(2026, 10, 18, 0, 0, 0);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', '.000000000Z');
const bid = (o, h, l, c) => ({ o: String(o), h: String(h), l: String(l), c: String(c) });
// EURUSD stand-in slides 0.25 a minute from 3850: minute n opens at 3850 - 0.25n and closes 0.25 lower.
const minuteBar = (n) => ({ time: iso(DAY + n * 60000), complete: true, bid: bid(3850 - 0.25 * n, 3850 - 0.25 * n + 0.1, 3850 - 0.25 * (n + 1) - 0.1, 3850 - 0.25 * (n + 1)) });

function makeFetch({ calls = [], failMinutes = false } = {}) {
  return async (url) => {
    const u = new URL(url);
    const granularity = u.searchParams.get('granularity');
    calls.push(granularity);
    if (granularity === 'D') {
      const candles = [
        { time: iso(Date.UTC(2026, 10, 16)), complete: true, bid: bid(3900, 3920, 3860, 3880) },
        { time: iso(Date.UTC(2026, 10, 17)), complete: true, bid: bid(3880, 3895, 3835, 3849) },
        // The forming candle as it stands at 02:16: the latest price and a low made after the screenshot.
        { time: iso(DAY), complete: false, bid: bid(3850, 3858.4, 3790.28, 3804.31) },
      ];
      return { ok: true, json: async () => ({ instrument: 'EUR_USD', granularity, candles }) };
    }
    if (failMinutes) return { ok: false, status: 500, json: async () => ({}) };
    const candles = [];
    for (let n = 0; n < 136; n++) candles.push(minuteBar(n));
    return { ok: true, json: async () => ({ instrument: 'EUR_USD', granularity, candles }) };
  };
}
const run = (extra = {}, fetchOptions = {}) => fetchOandaSeries({
  symbol: 'EURUSD', interval: '1day', startDate: '2026-11-16', endDateTime: CUTOFF, token: 'test', fetchImpl: makeFetch(fetchOptions), ...extra,
});

// Every case runs at a fixed clock and with the switch cleared, then puts both back.
const at = (name, body) => test(name, async () => {
  Date.now = () => NOW; delete process.env.FORMING_CANDLE_AT_CUTOFF;
  try { await body(); } finally { Date.now = REAL_NOW; delete process.env.FORMING_CANDLE_AT_CUTOFF; }
});

at('a stale forming daily candle is rebuilt from minute candles that end at the cutoff', async () => {
  const calls = [];
  const result = await run({ formingAtCutoff: true }, { calls });
  const c = result.alignmentCandle;
  // The last minute bar that finished before 00:39:59 is minute 38 (00:38-00:39), which closes at 3850 - 0.25 * 39.
  assert.equal(c.datetime, '2026-11-18 00:00:00');
  assert.equal(c.open, 3850);
  assert.equal(c.close, 3850 - 0.25 * 39);
  assert.equal(c.atCutoff, true);
  // Neither the 02:16 close nor the low made after the screenshot is in it.
  assert.ok(c.low > 3790.28 && c.high < 3858.4 + 0.001);
  assert.ok(Math.abs(c.close - 3827.468) / 3827.468 < 0.005, 'close within the 0.5% same-instrument limit of the chart close');
  assert.deepEqual(calls.filter((g) => g === 'M1').length >= 1, true);
});

at('without the flag the candle stays the live snapshot and no minute candles are fetched', async () => {
  const calls = [];
  const result = await run({}, { calls });
  assert.equal(result.alignmentCandle.close, 3804.31);
  assert.equal(result.alignmentCandle.atCutoff, undefined);
  assert.ok(!calls.includes('M1'));
});

at('a fresh screenshot (cutoff within a few minutes of now) keeps the snapshot and makes no extra request', async () => {
  Date.now = () => Date.UTC(2026, 10, 18, 0, 41, 0);
  const calls = [];
  const result = await run({ formingAtCutoff: true }, { calls });
  assert.equal(result.alignmentCandle.close, 3804.31);
  assert.ok(!calls.includes('M1'));
});

at('if the minute candles cannot be fetched the snapshot is kept', async () => {
  const result = await run({ formingAtCutoff: true }, { failMinutes: true });
  assert.equal(result.alignmentCandle.close, 3804.31);
  assert.equal(result.alignmentCandle.atCutoff, undefined);
});

at('FORMING_CANDLE_AT_CUTOFF=off restores the snapshot', async () => {
  process.env.FORMING_CANDLE_AT_CUTOFF = 'off';
  const calls = [];
  const result = await run({ formingAtCutoff: true }, { calls });
  assert.equal(result.alignmentCandle.close, 3804.31);
  assert.ok(!calls.includes('M1'));
});
