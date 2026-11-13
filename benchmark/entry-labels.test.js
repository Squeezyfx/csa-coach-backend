import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { entryWordForDirection, relabelEntries, relabelEntriesDeep, relabelCustomerText } from '../entry-labels.js';
import { buildCleanChart } from '../clean-chart.js';

const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('the direction picks the word, and no clear direction keeps "Entry"', () => {
  assert.equal(entryWordForDirection('bullish'), 'Buy');
  assert.equal(entryWordForDirection('buy'), 'Buy');
  assert.equal(entryWordForDirection('bearish'), 'Sell');
  assert.equal(entryWordForDirection('Sell'), 'Sell');
  assert.equal(entryWordForDirection('range'), 'Entry');
  assert.equal(entryWordForDirection(null), 'Entry');
  assert.equal(entryWordForDirection(''), 'Entry');
});

test('only the numbered label changes, in real feedback sentences', () => {
  assert.equal(relabelEntries('Entry 1 stop loss: about 0.68928, past the entry zone.', 'Sell'), 'Sell 1 stop loss: about 0.68928, past the entry zone.');
  assert.equal(relabelEntries('Backup (Entry 2): around 102.284, only if Entry 1 fails.', 'Buy'), 'Backup (Buy 2): around 102.284, only if Buy 1 fails.');
  assert.equal(relabelEntries('Do not add to a losing Entry 1.', 'Buy'), 'Do not add to a losing Buy 1.');
  assert.equal(relabelEntries('If Entry 2 also fails, treat it as Entry 3 only after a fresh trigger.', 'Sell'), 'If Sell 2 also fails, treat it as Sell 3 only after a fresh trigger.');
  assert.equal(relabelEntries('Entry 1 / Entry 2', 'Buy'), 'Buy 1 / Buy 2');
  // other uses of the word are left alone
  for (const text of ['Entry area: Levels marked on chart', 'Your entry 1.2345', 'entry zone', 'Entry 10', 'Planned entry area (102.355)', 'Entry trigger: wait for a candle']) {
    assert.equal(relabelEntries(text, 'Buy'), text);
  }
  // no direction, no change
  assert.equal(relabelEntries('Entry 1 stop loss', 'Entry'), 'Entry 1 stop loss');
  assert.equal(relabelEntries(42, 'Buy'), 42);
});

test('the deep version only touches strings in plain objects and arrays', () => {
  const when = new Date(0);
  const out = relabelEntriesDeep({ a: 'Entry 1', b: ['Entry 2', 3, null], c: { d: 'Entry 3 here' }, n: 1.5, when }, 'Sell');
  assert.deepEqual(out, { a: 'Sell 1', b: ['Sell 2', 3, null], c: { d: 'Sell 3 here' }, n: 1.5, when });
  assert.equal(out.when, when);
});

test('only the parts the trader reads are rewritten, engine facts are not', () => {
  const body = {
    analysis: 'Entry 1 is the support.',
    summary: 'Entry 1 is the support.',
    finalFeedback: { nextAction: 'Wait at Entry 1.', entry1: { authoritativeCenter: 1.1, levelText: '1.100' } },
    dashboard: { strengths: ['Entry 2 matched'] },
    cleanChart: { levels: [{ label: 'Entry 1', price: 1.1 }] },
    analysisFacts: { note: 'Entry 1 selected' },
    visualReview: { text: 'Entry 1 per the model' },
    regressionSnapshot: { entries: { entry1: { authoritativeCenter: 1.1 } } },
  };
  const out = relabelCustomerText(body, 'Buy');
  assert.equal(out.analysis, 'Buy 1 is the support.');
  assert.equal(out.summary, 'Buy 1 is the support.');
  assert.equal(out.finalFeedback.nextAction, 'Wait at Buy 1.');
  assert.equal(out.finalFeedback.entry1.authoritativeCenter, 1.1);
  assert.deepEqual(out.dashboard.strengths, ['Buy 2 matched']);
  assert.equal(out.cleanChart.levels[0].label, 'Buy 1');
  assert.equal(out.analysisFacts.note, 'Entry 1 selected');
  assert.equal(out.visualReview.text, 'Entry 1 per the model');
  assert.deepEqual(out.regressionSnapshot, body.regressionSnapshot);
  // the input is not changed, and "Entry" leaves the same object
  assert.equal(body.analysis, 'Entry 1 is the support.');
  assert.equal(relabelCustomerText(body, 'Entry'), body);
  // running it twice changes nothing more
  assert.deepEqual(relabelCustomerText(out, 'Buy'), out);
});

function candles(count, start = 0.6885) {
  return Array.from({ length: count }, (_, i) => {
    const base = start - i * 0.00003;
    const day = String(9 + Math.floor(i / 24)).padStart(2, '0');
    return { datetime: `2026-11-${day} ${String(i % 24).padStart(2, '0')}:00:00`, open: base, high: base + 0.0003, low: base - 0.0003, close: base - 0.0001 };
  });
}

test('the chart draws "Sell 1" with its own stop and keeps "Entry 1" when told nothing', () => {
  const finalFeedback = { entry1: { authoritativeCenter: 0.68848 }, entry2: { authoritativeCenter: 0.6866 } };
  const marketReference = { timeframeCandles: candles(72) };
  const sell = buildCleanChart({ marketReference, finalFeedback, entryWord: 'Sell' });
  assert.deepEqual(sell.levels.filter((l) => l.kind === 'entry').map((l) => l.label), ['Sell 1', 'Sell 2']);
  const plain = buildCleanChart({ marketReference, finalFeedback });
  assert.deepEqual(plain.levels.filter((l) => l.kind === 'entry').map((l) => l.label), ['Entry 1', 'Entry 2']);
});

test('the server applies it at the end of the review, skips benchmark runs and has an off switch', () => {
  assert.match(serverSource, /import \{ entryWordForDirection, relabelEntriesDeep, relabelCustomerText \} from "\.\/entry-labels\.js";/);
  assert.match(serverSource, /BUY_SELL_LABELS/);
  assert.match(serverSource, /benchmarkDryRun \|\| benchmarkDiagnosticOnly\s*\? "Entry"\s*: entryWordForDirection\(analysisFacts\?\.direction\)/);
  assert.match(serverSource, /entryWord,\r?\n\s+dataMatchStatus: pageDataMatchStatus\(/);
  assert.match(serverSource, /relabelEntriesDeep\(analysis, entryWord\)/);
  assert.match(serverSource, /relabelEntriesDeep\(dashboardFeedback, entryWord\)/);
  assert.match(serverSource, /relabelCustomerText\(\{\s+\.\.\.finalClientResponse,/);
  // the engine itself still talks about entry1 / entry2: the selector code does not mention Buy/Sell labels
  assert.ok(serverSource.indexOf('const entryWord =') > serverSource.indexOf('const finalFeedback = buildControlledFeedback('));
});
