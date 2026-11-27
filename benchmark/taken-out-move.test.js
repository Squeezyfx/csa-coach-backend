import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { markIntradayOrder, resolveFrameworkBias, resolveDeepRetracementDirectionOverride } from '../framework-calendar.js';
import { evaluateFrameworkCandidate, selectFrameworkEntries } from '../shared-analysis-engine.js';
import * as policy from '../csa-entry-policy.js';
import * as markedLines from '../marked-lines.js';
import { auditPeriodInventory, isUnverifiedPeriodCandidate, normalizePeriodDateForCompare } from '../period-accuracy.js';
import { isSyntheticInstrument } from '../oanda-data.js';
import { chooseLegFrame } from '../leg-frame.js';

const day = (date, high, low, extra = {}) => ({ date, key: date, high, low, ...extra });
const bar = (datetime, high, low) => ({ datetime, high, low });

// USDINDEX H1, week of 23 Nov 2026: Monday rose, then Wednesday traded below where that rise started.
const week = [
  day('2026-11-23', 104.5048, 103.6411),
  day('2026-11-24', 104.3716, 103.7752),
  day('2026-11-25', 104.0766, 103.6191),
  day('2026-11-26', 103.8200, 103.6601),
  day('2026-11-27', 104.0343, 103.6567, { partialPeriod: true }),
];
const bars = [
  bar('2026-11-23 03:00:00', 103.75, 103.6411), bar('2026-11-23 15:00:00', 104.5048, 104.30),
  bar('2026-11-24 03:00:00', 104.3716, 104.10), bar('2026-11-24 18:00:00', 103.95, 103.7752),
  bar('2026-11-25 03:00:00', 104.0766, 103.90), bar('2026-11-25 18:00:00', 103.70, 103.6191),
  bar('2026-11-26 03:00:00', 103.8200, 103.70), bar('2026-11-26 18:00:00', 103.75, 103.6601),
  bar('2026-11-27 03:00:00', 103.75, 103.6567), bar('2026-11-27 17:00:00', 104.0343, 103.90),
];
const marked = (rows = week, candles = bars) => markIntradayOrder({ timeframe: 'H1', periodInventory: rows, candles });
const bias = (price, rows = marked()) => resolveFrameworkBias({ periodInventory: rows, periodOpen: 103.8524, periodClose: price });

test('USDINDEX: Monday rise was taken out, so the week is bearish until the 61.8% line of the fall', () => {
  const result = bias(104.0175);
  assert.equal(result.direction, 'bearish');
  assert.ok(Math.abs(result.holdLine - 104.1665) < 0.0001, String(result.holdLine));
  assert.equal(bias(104.16).direction, 'bearish');
  // above it the trend has changed (Tuesday's high is too far past the line to count)
  assert.notEqual(resolveDeepRetracementDirectionOverride({ periods: marked(), currentPrice: 104.18 })?.direction, 'bearish');
});

test('the bullish case is the mirror image', () => {
  const flip = (value) => Number((208 - value).toFixed(4));
  const rows = week.map((r) => ({ ...r, high: flip(r.low), low: flip(r.high) }));
  const candles = bars.map((c) => bar(c.datetime, flip(c.low), flip(c.high)));
  const result = resolveFrameworkBias({ periodInventory: marked(rows, candles), periodOpen: flip(103.8524), periodClose: flip(104.0175) });
  assert.equal(result.direction, 'bullish');
  assert.ok(Math.abs(result.holdLine - flip(104.1665)) < 0.0001);
});

test('it also applies when only the current day has taken the earlier move out', () => {
  const rows = [day('2026-11-23', 104.50, 103.64), day('2026-11-24', 104.40, 103.60, { partialPeriod: true })];
  const candles = [bar('2026-11-23 03:00:00', 103.75, 103.64), bar('2026-11-23 15:00:00', 104.50, 104.30),
    bar('2026-11-24 03:00:00', 104.40, 104.00), bar('2026-11-24 15:00:00', 103.80, 103.60)];
  assert.equal(resolveDeepRetracementDirectionOverride({ periods: marked(rows, candles), currentPrice: 103.70 }).direction, 'bearish');
});

test('longer charts: known only when the first extreme is not in the opening period', () => {
  const rows = (list) => list.map(([key, high, low]) => day(key, high, low));
  const later = rows([['2026-11-02', 100, 90], ['2026-11-09', 120, 99], ['2026-11-16', 105, 85], ['2026-11-23', 96, 88]]);
  assert.equal(resolveDeepRetracementDirectionOverride({ periods: later, currentPrice: 95 }).direction, 'bearish');
  // the high is in the opening period and nothing says a rise came before it
  const opening = rows([['2026-11-02', 120, 100], ['2026-11-09', 105, 85], ['2026-11-16', 96, 88]]);
  assert.equal(resolveDeepRetracementDirectionOverride({ periods: opening, currentPrice: 95 }), null);
});

test('no earlier move the other way, or a recovery past 61.8%, leaves the rule out', () => {
  // Monday fell from its first candle: no rise came before the high
  const fell = [bar('2026-11-23 03:00:00', 104.5048, 104.30), bar('2026-11-23 15:00:00', 103.75, 103.6411), ...bars.slice(2)];
  assert.equal(resolveDeepRetracementDirectionOverride({ periods: marked(week, fell), currentPrice: 104.0175 }), null);
  const recovered = week.map((r) => r.date === '2026-11-26' ? day(r.date, 104.30, 103.6601) : r);
  const candles = bars.map((c) => c.datetime === '2026-11-26 03:00:00' ? bar(c.datetime, 104.30, 103.70) : c);
  assert.notEqual(resolveDeepRetracementDirectionOverride({ periods: marked(recovered, candles), currentPrice: 104.0175 })?.source,
    'earlier_move_taken_out_later_move_stands');
});

test('the switch turns it off', () => {
  const before = globalThis.process;
  globalThis.process = { env: { WIPED_MOVE: 'off' } };
  try { assert.equal(bias(104.0175).direction, 'bullish'); }
  finally { globalThis.process = before; }
});

test("USDINDEX: the real entry selector then gives the sell at Wednesday's high", () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const context = vm.createContext({ auditPeriodInventory, isSyntheticInstrument, ...policy, ...markedLines, DRAWN_LINE_SUPERSEDES_FRACTION: 0.0005, evaluateFrameworkCandidate, selectFrameworkEntries, isUnverifiedPeriodCandidate,
    chooseLegFrame, normalizePeriodDateForCompare, process: { env: {} }, zoneFailureClosesSetting: () => 2,
    asPositiveNumber: (value) => Number(value) > 0 ? Number(value) : null,
    getCleanBreakTolerance: () => 0.005, getApprovedPriceTolerance: () => 0.005,
    getSupportedCsaTimeframeProfile: () => ({}),
    formatPrice: (value) => String(value), safeUserText: (value) => String(value || ''),
    compareHighWithTolerance: (value, prior) => ({ cleanBreak: value > prior }),
    compareLowWithTolerance: (value, prior) => ({ cleanBreak: value < prior }),
    CSA_SELECTOR_VERSION: 'test', CSA_BUILD_ID: 'test', console: { log() {} },
  });
  for (const name of ['buildCsaAreas', 'buildPeriodInventoryStructuralCandidates', 'rankChartNativeFallbackAreas']) {
    const start = server.indexOf(`function ${name}(`);
    vm.runInContext(server.slice(start, server.indexOf('\n}\n', start) + 2), context);
  }
  const labels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const periodInventory = week.map((row, i) => ({ ...row, periodLabel: labels[i] }));
  const result = context.rankChartNativeFallbackAreas({
    timeframe: 'H1', symbol: 'USDINDEX', direction: bias(104.0175).direction, currentPrice: 104.0175,
    visualReview: { chartNativeEntryFallback: {
      usable: true, direction: 'bearish', currentWeekHigh: 104.5048, currentWeekLow: 103.6191,
      currentPeriodFrameVerified: true, inventoryAuthority: 'provider_framework_candles', periodInventory,
    } },
  });
  const prices = result.areas.map((area) => area.price ?? area.zoneLow);
  assert.deepEqual(prices, [104.0766], JSON.stringify(result.areas));
});
