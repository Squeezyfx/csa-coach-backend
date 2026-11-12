import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newsCountriesForInstrument, fetchHighImpactNews, describeNewsToday } from '../news-calendar.js';

const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0); // Thursday 12:00 UTC = 13:00 in Lagos

const rows = [
  { id: 'a', name: 'US CPI', country: 'US', impact: 'high', date: '2026-11-12', release_at_utc: '2026-11-12T13:30:00+00:00' },
  { id: 'b', name: 'UK GDP', country: 'GB', impact: 'high', date: '2026-11-13', time_utc: '2026-11-13T07:00:00+00:00' },
  { id: 'c', name: 'US Jobless Claims', country: 'US', impact: 'high', date: '2026-11-12', release_at_utc: '2026-11-12T11:00:00+00:00' },
  { id: 'd', name: 'Far away', country: 'US', impact: 'high', date: '2026-11-14', release_at_utc: '2026-11-14T13:30:00+00:00' },
  { id: 'e', name: 'Low one', country: 'US', impact: 'low', date: '2026-11-12', release_at_utc: '2026-11-12T14:00:00+00:00' },
  { id: 'f', name: 'No time', country: 'US', impact: 'high', date: '2026-11-12', release_at_utc: null },
];
function makeFetch(payload, calls = []) {
  return async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => payload }; };
}

test('instruments map to the economies that move them', () => {
  assert.deepEqual(newsCountriesForInstrument('GBPUSD'), ['GB', 'US']);
  assert.deepEqual(newsCountriesForInstrument('EUR/USD'), ['EU', 'DE', 'US']);
  assert.deepEqual(newsCountriesForInstrument('EURGBP'), ['EU', 'DE', 'GB']);
  assert.deepEqual(newsCountriesForInstrument('XAUUSD'), ['US']);
  assert.deepEqual(newsCountriesForInstrument('BTCUSD'), ['US']);
  assert.deepEqual(newsCountriesForInstrument('USDINDEX'), ['US']);
  assert.deepEqual(newsCountriesForInstrument('DXY'), ['US']);
  assert.deepEqual(newsCountriesForInstrument('US30'), ['US']);
  assert.deepEqual(newsCountriesForInstrument('GER40'), ['DE', 'EU']);
  assert.deepEqual(newsCountriesForInstrument('UK100'), ['GB']);
  assert.equal(newsCountriesForInstrument('AAPL'), null);
  assert.equal(newsCountriesForInstrument(''), null);
  for (const name of ['EURGBP', 'EURJPY', 'GBPJPY', 'AUDNZD']) assert.ok(newsCountriesForInstrument(name).length <= 3);
});

test('without a key, or for an unmapped name, nothing is fetched', async () => {
  const calls = [];
  assert.deepEqual(await fetchHighImpactNews({ symbol: 'GBPUSD', nowMs: NOW, apiKey: '', fetchImpl: makeFetch({}, calls), cache: new Map() }), { status: 'not_configured' });
  assert.deepEqual(await fetchHighImpactNews({ symbol: 'AAPL', nowMs: NOW, apiKey: 'k', fetchImpl: makeFetch({}, calls), cache: new Map() }), { status: 'not_applicable' });
  assert.equal(calls.length, 0);
});

test('high-impact releases in the next day are kept, soonest first, and the answer is cached', async () => {
  const calls = [];
  const cache = new Map();
  const result = await fetchHighImpactNews({ symbol: 'GBPUSD', nowMs: NOW, apiKey: 'secret', fetchImpl: makeFetch({ events: rows }, calls), cache });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.events.map((e) => e.name), ['US Jobless Claims', 'US CPI', 'UK GDP']);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/wp-json/fc/v1/calendar');
  assert.equal(url.searchParams.get('country'), 'GB,US');
  assert.equal(url.searchParams.get('impact'), 'high');
  assert.equal(url.searchParams.get('from'), '2026-11-12');
  assert.equal(url.searchParams.get('to'), '2026-11-13');
  assert.equal(calls[0].options.headers['X-API-Key'], 'secret');
  // a second review within half an hour reuses it
  await fetchHighImpactNews({ symbol: 'GBPUSD', nowMs: NOW + 60000, apiKey: 'secret', fetchImpl: makeFetch({ events: rows }, calls), cache });
  assert.equal(calls.length, 1);
});

test('a slow or failing calendar never breaks a review', async () => {
  const cache = new Map();
  const calls = [];
  const failing = async (url) => { calls.push(url); throw new Error('boom'); };
  assert.deepEqual(await fetchHighImpactNews({ symbol: 'GBPUSD', nowMs: NOW, apiKey: 'k', fetchImpl: failing, cache }), { status: 'unavailable' });
  // the failure is remembered for a few minutes instead of being retried at once
  assert.deepEqual(await fetchHighImpactNews({ symbol: 'GBPUSD', nowMs: NOW + 1000, apiKey: 'k', fetchImpl: failing, cache }), { status: 'unavailable' });
  assert.equal(calls.length, 1);
  const notOk = async () => ({ ok: false, status: 429, json: async () => ({}) });
  assert.deepEqual(await fetchHighImpactNews({ symbol: 'US30', nowMs: NOW, apiKey: 'k', fetchImpl: notOk, cache: new Map() }), { status: 'unavailable' });
  assert.deepEqual(describeNewsToday({ status: 'unavailable' }), []);
  assert.deepEqual(describeNewsToday({ status: 'not_configured' }), []);
  assert.deepEqual(describeNewsToday(null), []);
});

test('the lines name each release in the user time, say it is not a signal and credit the source', async () => {
  const result = await fetchHighImpactNews({ symbol: 'GBPUSD', nowMs: NOW, apiKey: 'k', fetchImpl: makeFetch({ events: rows }), cache: new Map() });
  const text = describeNewsToday(result, { symbol: 'GBPUSD', timezone: 'Africa/Lagos', nowMs: NOW }).join('\n');
  assert.match(text, /High-impact news for GBPUSD \(Africa\/Lagos time\)/);
  assert.match(text, /US Jobless Claims \(US\) today 12:00 \(already out\)/);
  assert.match(text, /US CPI \(US\) today 14:30/);
  assert.match(text, /UK GDP \(GB\) tomorrow 08:00/);
  assert.match(text, /faster, larger price moves/);
  assert.match(text, /not a signal/);
  assert.match(text, /FinanceCalendar\.com/);
});

test('a quiet day says so, and a long list is cut', () => {
  const quiet = describeNewsToday({ status: 'ok', countries: ['US'], events: [] }, { symbol: 'US30' });
  assert.equal(quiet.length, 1);
  assert.match(quiet[0], /No high-impact releases are scheduled in the next 24 hours for US30\. Source: FinanceCalendar\.com/);
  const many = { status: 'ok', countries: ['US'], events: Array.from({ length: 8 }, (_, i) => ({ name: `Event ${i}`, country: 'US', atMs: NOW + (i + 1) * 60000 })) };
  const text = describeNewsToday(many, { symbol: 'US30', timezone: 'UTC', nowMs: NOW }).join('\n');
  assert.match(text, /Event 4/);
  assert.doesNotMatch(text, /Event 5/);
  assert.match(text, /and 3 more/);
});

test('the server shows it to Pro and Elite only, after the setup section, and can switch it off', () => {
  assert.match(serverSource, /import \{ fetchHighImpactNews, describeNewsToday \} from "\.\/news-calendar\.js";/);
  const pro = serverSource.indexOf('"NEWS TODAY:"');
  const elite = serverSource.indexOf('const eliteSections = [');
  assert.ok(pro > 0 && pro < elite, 'the news section is part of the Pro text, which Elite includes');
  assert.equal(serverSource.split('"NEWS TODAY:"').length - 1, 1);
  // it sits inside proSections, which is closed just before the Elite list starts
  assert.ok(serverSource.lastIndexOf('const proSections = [', pro) > 0);
  assert.match(serverSource.slice(pro, elite), /^"NEWS TODAY:", \.\.\.facts\.newsTodayLines\] : \[\]\),\n  \];/);
  assert.match(serverSource, /NEWS_CALENDAR/);
  assert.match(serverSource, /newsTodayLines,\n    \}\);/);
});
