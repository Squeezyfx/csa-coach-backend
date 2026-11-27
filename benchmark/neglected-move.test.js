import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { markIntradayOrder, resolveFrameworkBias, resolveDeepRetracementDirectionOverride } from '../framework-calendar.js';

const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

const day = (date, high, low, extra = {}) => ({ date, key: date, high, low, ...extra });
const bar = (datetime, high, low) => ({ datetime, high, low });
// Two candles for each [time, high, low] given, so every day has its own order of events.
const bars = (list) => list.map(([datetime, high, low]) => bar(datetime, high, low));

// EURUSD H1, week of 23 Nov 2026: Monday's high came before Monday's low, then price retraced 90% of that move.
const eurWeek = [
  day('2026-11-23', 1.1005, 1.08804),
  day('2026-11-24', 1.09795, 1.08954),
  day('2026-11-25', 1.09921, 1.09305),
  day('2026-11-26', 1.09885, 1.09565),
  day('2026-11-27', 1.09858, 1.09422, { partialPeriod: true }),
];
const eurBars = bars([
  ['2026-11-23 04:00:00', 1.1005, 1.0975], ['2026-11-23 17:00:00', 1.0930, 1.08804], ['2026-11-23 21:00:00', 1.0910, 1.0890],
  ['2026-11-24 03:00:00', 1.0920, 1.08954], ['2026-11-24 19:00:00', 1.09795, 1.0950],
  ['2026-11-25 02:00:00', 1.09921, 1.0970], ['2026-11-25 14:00:00', 1.0950, 1.09305],
  ['2026-11-26 03:00:00', 1.09885, 1.0970], ['2026-11-26 15:00:00', 1.0975, 1.09565],
  ['2026-11-27 02:00:00', 1.09858, 1.0970], ['2026-11-27 13:00:00', 1.09655, 1.09422],
]);
const marked = (rows, candles, extra = {}) => markIntradayOrder({ timeframe: 'H1', periodInventory: rows, candles, ...extra });
const eurBias = (price, rows = marked(eurWeek, eurBars)) => resolveFrameworkBias({ periodInventory: rows, periodOpen: 1.09706, periodClose: price });

test('the candles say which extreme of a day came first', () => {
  const [monday] = marked(eurWeek, eurBars);
  assert.equal(monday.extremeOrder, 'high_first');
  assert.equal(monday.highAfterLow, 1.0910);
});

test('EURUSD: Monday down move retraced past 61.8% is neglected, so the week is bullish', () => {
  const bias = eurBias(1.09434);
  assert.equal(bias.direction, 'bullish');
  assert.ok(Math.abs(bias.holdLine - 1.09231) < 0.00002, String(bias.holdLine));
  // the same numbers without the candle notes read bearish, as they did live
  assert.equal(eurBias(1.09434, eurWeek).direction, 'bearish');
});

test('EURUSD: below the 61.8% line of the new move it is no longer bullish', () => {
  assert.equal(eurBias(1.0924).direction, 'bullish');
  assert.equal(eurBias(1.0922).direction, 'bearish');
});

// GBPUSD H1, same week (the trader's chart): Wednesday's low sits just under the 61.8% line.
const gbpWeek = [
  day('2026-11-23', 1.31428, 1.30103),
  day('2026-11-24', 1.3122, 1.30220),
  day('2026-11-25', 1.31285, 1.30460),
  day('2026-11-26', 1.31220, 1.30940),
  day('2026-11-27', 1.31357, 1.30930, { partialPeriod: true }),
];
const gbpBars = bars([
  ['2026-11-23 04:00:00', 1.31428, 1.3110], ['2026-11-23 17:00:00', 1.3040, 1.30103], ['2026-11-23 21:00:00', 1.3035, 1.3022],
  ['2026-11-24 03:00:00', 1.3045, 1.30220], ['2026-11-24 19:00:00', 1.3122, 1.3080],
  ['2026-11-25 02:00:00', 1.31285, 1.3100], ['2026-11-25 14:00:00', 1.3085, 1.30460],
  ['2026-11-26 03:00:00', 1.31220, 1.3100], ['2026-11-26 15:00:00', 1.3110, 1.30940],
  ['2026-11-27 02:00:00', 1.3110, 1.30930], ['2026-11-27 12:00:00', 1.31357, 1.3108],
]);
const gbpBias = (price) => resolveFrameworkBias({ periodInventory: marked(gbpWeek, gbpBars), periodOpen: 1.3118, periodClose: price });

test('GBPUSD: the level just under the 61.8% line has to break too', () => {
  assert.equal(gbpBias(1.31084).direction, 'bullish');
  assert.equal(gbpBias(1.31084).holdLine, 1.30460);
  // under the 61.8% line (1.30582) but still above Wednesday's low
  assert.equal(gbpBias(1.3050).direction, 'bullish');
  // under both: the trend has changed
  assert.equal(gbpBias(1.3044).direction, 'bearish');
});

test('the bearish case is the mirror image', () => {
  const flip = (value) => Number((2.4 - value).toFixed(5));
  const rows = gbpWeek.map((r) => ({ ...r, high: flip(r.low), low: flip(r.high) }));
  const candles = gbpBars.map((c) => bar(c.datetime, flip(c.low), flip(c.high)));
  const bias = (price) => resolveFrameworkBias({ periodInventory: marked(rows, candles), periodOpen: flip(1.3118), periodClose: flip(price) });
  assert.equal(bias(1.31084).direction, 'bearish');
  assert.equal(bias(1.31084).holdLine, flip(1.30460));
  assert.equal(bias(1.3050).direction, 'bearish');
  assert.equal(bias(1.3044).direction, 'bullish');
});

test("a high printed before the low of the same day is not a retracement of it", () => {
  const rows = [day('2026-11-23', 1.1100, 1.1060), day('2026-11-24', 1.1085, 1.1000), day('2026-11-25', 1.1030, 1.1005)];
  const candles = bars([
    ['2026-11-23 02:00:00', 1.1100, 1.1080], ['2026-11-23 20:00:00', 1.1075, 1.1060],
    // Tuesday: its high comes first, then it falls to the week's low and never bounces far
    ['2026-11-24 02:00:00', 1.1085, 1.1060], ['2026-11-24 20:00:00', 1.1020, 1.1000],
    ['2026-11-25 02:00:00', 1.1030, 1.1010], ['2026-11-25 20:00:00', 1.1020, 1.1005],
  ]);
  assert.equal(resolveDeepRetracementDirectionOverride({ periods: marked(rows, candles), currentPrice: 1.1020 }), null);
});

test('only M1-H1 charts, only days the candles cover, and the switch turns it off', () => {
  assert.equal(markIntradayOrder({ timeframe: 'H4', periodInventory: eurWeek, candles: eurBars }), eurWeek);
  assert.deepEqual(marked(eurWeek, eurBars, { enabled: false }), eurWeek);
  // candles that do not reach the day's own extremes say nothing about that day
  assert.equal(marked(eurWeek, eurBars.slice(1))[0].intradayOrderChecked, undefined);
  assert.equal(eurBias(1.09434, marked(eurWeek, [])).direction, 'bearish');
});

test('the server gives the notes to every place that decides direction', () => {
  assert.equal(serverSource.split('periods: markIntradayOrder({').length - 1, 2);
  assert.ok(serverSource.includes('periodInventory: markIntradayOrder({ timeframe, periodInventory: selectedPeriodInventory'));
});
