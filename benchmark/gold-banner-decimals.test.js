import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCleanChart } from '../clean-chart.js';
import { pageDataMatchStatus } from '../feed-price-guard.js';

const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function candles(count, start, step, digits) {
  return Array.from({ length: count }, (_, i) => {
    const base = start - i * step;
    const day = String(9 + Math.floor(i / 24)).padStart(2, '0');
    const f = (v) => Number(v.toFixed(digits));
    return { datetime: `2026-11-${day} ${String(i % 24).padStart(2, '0')}:00:00`, open: f(base), high: f(base + step * 3), low: f(base - step * 3), close: f(base - step) };
  });
}

// XAUUSD H4 2026-11-20: tags read 3853.26757 beside the written 3853.27.
test('a price in the thousands is drawn to two decimals at most, small prices keep theirs', () => {
  const gold = buildCleanChart({ marketReference: { timeframeCandles: candles(72, 3900.12345, 0.31234, 5) }, finalFeedback: { entry1: { authoritativeCenter: 3853.26757 } } });
  assert.equal(gold.decimals, 2);
  const eur = buildCleanChart({ marketReference: { timeframeCandles: candles(72, 1.11303, 0.0002, 5) }, finalFeedback: { entry1: { authoritativeCenter: 1.11303 } } });
  assert.equal(eur.decimals, 5);
  const jpy = buildCleanChart({ marketReference: { timeframeCandles: candles(72, 155.123, 0.05, 3) } });
  assert.equal(jpy.decimals, 3);
  // an index quoted in whole points stays at two (the floor), never more than the data has
  const index = buildCleanChart({ marketReference: { timeframeCandles: candles(72, 53421.2, 4.5, 1) } });
  assert.equal(index.decimals, 2);
});

test('the banner is left off when the framework periods are verified, never for a real mismatch', () => {
  for (const status of ['date_unverified', 'time_unverified', 'partial_or_unknown_candle']) {
    assert.equal(pageDataMatchStatus(status, true, true), 'partial_reference', status);
    // without the verification the warning stays
    assert.equal(pageDataMatchStatus(status, true, false), status, status);
  }
  assert.equal(pageDataMatchStatus('mismatch', true, true), 'mismatch');
  assert.equal(pageDataMatchStatus('matched_reference', true, true), 'matched_reference');
});

test('the server passes the verification to the banner status, with an off switch', () => {
  assert.match(serverSource, /BANNER_HIDE_WHEN_VERIFIED/);
  assert.match(serverSource, /isSyntheticInstrument\(submittedInstrument\) \|\|\s+\(String\(process\.env\.BANNER_HIDE_WHEN_VERIFIED \|\| "on"\)\.toLowerCase\(\) !== "off" &&\s+chartDetection\?\.marketInventoryDiagnostics\?\.marketInventoryVerified === true\)/);
});
