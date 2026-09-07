import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchOandaSeries,forexComparisonTolerance,oandaInstrument,localToUtc} from '../oanda-data.js';
import {assessChartDataMatch} from '../market-data-matching.js';
const candle=(time,extra={})=>({time,complete:true,bid:{o:'1.1',h:'1.2',l:'1.0',c:'1.15'},...extra});
const args={symbol:'EURUSD',interval:'1h',startDate:'2026-08-24',endDateTime:'2026-08-24 03:00:00',token:'test'};
const response=rows=>async()=>({ok:true,json:async()=>({instrument:'EUR_USD',granularity:'H1',candles:rows})});
test('three pips applies only to recognized forex pairs, including JPY',()=>{
 assert.equal(forexComparisonTolerance('USDCAD'),.0003);
 assert.equal(forexComparisonTolerance('USDJPY'),.03);
 for(const s of ['DOGEUSD','XAUUSD','USA500','Cocoa'])assert.equal(forexComparisonTolerance(s),null);
 assert.equal(oandaInstrument('EUR/USD'),'EUR_USD');
});
test('cutoff excludes unfinished and future candle extrema',async()=>{
 const rows=[candle('2026-08-24T01:00:00Z'),candle('2026-08-24T02:00:00Z'),candle('2026-08-24T03:00:00Z'),candle('2026-08-24T00:00:00Z',{complete:false})];
 const r=await fetchOandaSeries({...args,fetchImpl:response(rows)});
 assert.equal(r.values.length,2);assert.equal(r.values.at(-1).datetime,'2026-08-24 02:00:00');
 const partial=await fetchOandaSeries({...args,endDateTime:'2026-08-24 02:30:00',fetchImpl:response(rows)});
 assert.equal(partial.values.length,1);
});
test('request fixes bid basis and calendar alignment; token stays in header',async()=>{
 let seen;
 await fetchOandaSeries({...args,fetchImpl:async(url,options)=>{seen={url,options};return response([candle('2026-08-24T01:00:00Z')])();}});
 const url=new URL(seen.url);assert.equal(url.hostname,'api-fxpractice.oanda.com');
 assert.equal(url.searchParams.get('price'),'B');assert.equal(url.searchParams.get('weeklyAlignment'),'Monday');assert.equal(url.searchParams.get('dailyAlignment'),'0');assert.equal(url.searchParams.has('token'),false);
 assert.equal(seen.options.headers.Authorization,'Bearer test');
});
test('errors and wrong instruments cannot silently substitute another feed',async()=>{
 await assert.rejects(fetchOandaSeries({...args,token:''}),/missing/);
 await assert.rejects(fetchOandaSeries({...args,fetchImpl:async()=>({ok:false,status:401,json:async()=>({})})}),e=>e.category==='authentication');
 await assert.rejects(fetchOandaSeries({...args,fetchImpl:async()=>({ok:true,json:async()=>({instrument:'GBP_USD',granularity:'H1',candles:[]})})}),/does not match/);
});
test('IANA timezone conversion respects DST and rejects nonexistent local times',()=>{
 assert.equal(new Date(localToUtc('2026-08-24 00:00:00','America/New_York')).toISOString(),'2026-08-24T04:00:00.000Z');
 assert.equal(new Date(localToUtc('2026-01-24 00:00:00','America/New_York')).toISOString(),'2026-01-24T05:00:00.000Z');
 assert.throws(()=>localToUtc('2026-03-08 02:30:00','America/New_York'));
});
const match={source:'OANDA',symbol:'USDCAD',timeframe:'H4',cutoff:'2026-08-24 08:00:00',candles:[{datetime:'2026-08-24 04:00:00',open:1.39,high:1.391,low:1.388,close:1.389}],detection:{latestVisibleDate:'2026-08-24',latestVisibleDateEvidence:'explicit_final_candle_timestamp',dateConfidence:'high',latestVisibleTime:'04:00',latestVisibleTimeConfidence:'high',latestVisiblePrice:1.3893,latestVisiblePriceConfidence:'high',latestVisibleOpen:1.39,latestVisibleHigh:1.391,latestVisibleLow:1.388,latestVisibleCandleComplete:true,providerSessionAligned:true}};
test('exactly three pips passes; beyond three fails without changing prices or fib rules',()=>{
 const r=assessChartDataMatch({...match,tolerance:10});assert.equal(r.status,'matched_reference');assert.equal(r.tolerance,.0003);assert.equal(r.brokerVerified,false);
 assert.equal(assessChartDataMatch({...match,detection:{...match.detection,latestVisiblePrice:1.38931}}).status,'mismatch');
 assert.equal(assessChartDataMatch({...match,detection:{...match.detection,latestVisibleHigh:1.395}}).status,'mismatch');
});
test('an inferred date or wrong time is not verified by coincidental price similarity',()=>{
 assert.equal(assessChartDataMatch({...match,detection:{...match.detection,latestVisibleDateEvidence:'inferred_axis'}}).status,'date_unverified');
 assert.equal(assessChartDataMatch({...match,detection:{...match.detection,latestVisibleTime:'00:00'}}).status,'time_unverified');
});
test('pagination rejects capped history and advances without duplicated candles',async()=>{
 const start=Date.parse('2026-08-01T00:00:00Z');
 const rows=Array.from({length:5000},(_,i)=>candle(new Date(start+i*60000).toISOString()));
 let calls=0;
 const fetchImpl=async url=>{calls++; const params=new URL(url).searchParams;
  if(calls===2)assert.equal(params.get('includeFirst'),'false');
  return {ok:true,json:async()=>({instrument:'EUR_USD',granularity:'M1',candles:calls===1?rows:[candle('2026-08-05T00:00:00Z')]})};};
 const request={...args,interval:'1min',startDate:'2026-08-01',endDateTime:'2026-08-06 00:00:00',fetchImpl};
 const data=await fetchOandaSeries(request);assert.equal(calls,2);assert.equal(data.values.length,5001);
 calls=0;await assert.rejects(fetchOandaSeries({...request,maxPages:1}),/partial history rejected/);
});
test('future parts of historical daily candles are excluded despite API complete=true',async()=>{
 const result=await fetchOandaSeries({...args,interval:'1day',endDateTime:'2026-08-25 12:00:00',fetchImpl:async()=>({ok:true,json:async()=>({instrument:'EUR_USD',granularity:'D',candles:[candle('2026-08-24T00:00:00Z'),candle('2026-08-25T00:00:00Z')]})})});
 assert.equal(result.values.length,1);assert.equal(result.values[0].datetime,'2026-08-24 00:00:00');
});
