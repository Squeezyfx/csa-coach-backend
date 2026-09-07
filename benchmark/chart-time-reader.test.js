import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {readMt4ForexTimestamp,resolveAxisTimestamp} from '../chart-time-reader.js';
import {assessChartDataMatch} from '../market-data-matching.js';
import {fetchOandaSeries} from '../oanda-data.js';
// Text transcribed from the user's original PNG; the production vision reader
// must provide this text. This tests real pixel geometry, not production OCR.
const dates=['2026-06-18','2026-06-24','2026-06-30','2026-07-06','2026-07-10','2026-07-16','2026-07-22','2026-07-28','2026-08-03','2026-08-07','2026-08-13','2026-08-19','2026-08-25'];
const args={imageBase64:readFileSync(new URL('./fixtures/usdcad-h4-time-axis.png',import.meta.url)).toString('base64'),timeframe:'H4',timeAxisTimestamps:dates.map((d,i)=>i?d+' 16:00:00':null)};
test('original USDCAD image reconstructs final time using all 12 readable axis labels',()=>{
 const result=readMt4ForexTimestamp(args);assert.equal(result.timestamp,'2026-08-28 20:00:00');assert.equal(result.candlesAfterLastLabel,19);assert.equal(result.anchorCount,12);
});
test('missing or conflicting text anchors cannot manufacture a verified timestamp',()=>{
 assert.equal(readMt4ForexTimestamp({...args,timeAxisTimestamps:args.timeAxisTimestamps.slice(1)}),null);
 const labels=[...args.timeAxisTimestamps];labels[5]='2026-07-17 16:00:00';assert.equal(readMt4ForexTimestamp({...args,timeAxisTimestamps:labels}),null);
 assert.equal(readMt4ForexTimestamp({...args,timeframe:'D1'}),null);
});
test('fractional candle counts and insufficient anchors are rejected',()=>{
 assert.equal(resolveAxisTimestamp({anchors:[],candleStep:4,lastCandleX:100,timeframe:'H4'}),null);
 const anchors=[{x:0,timestamp:'2026-08-24 00:00:00'},{x:4,timestamp:'2026-08-24 04:00:00'},{x:8,timestamp:'2026-08-24 08:00:00'}];
 assert.equal(resolveAxisTimestamp({anchors,candleStep:4,lastCandleX:9,timeframe:'H4'}),null);
});
test('overlapping historical candle is comparison-only, not included in calculation values',async()=>{
 const row=(hour,c)=>({time:`2026-08-28T${hour}:00:00Z`,complete:true,mid:{o:'1.39014',h:'1.39088',l:'1.38979',c}});
 const result=await fetchOandaSeries({symbol:'USDCAD',interval:'4h',startDate:'2026-08-28',endDateTime:'2026-08-28 20:00:59',token:'test',price:'M',fetchImpl:async()=>({ok:true,json:async()=>({instrument:'USD_CAD',granularity:'H4',candles:[row('16','1.38980'),row('20','1.38988')]})})});
 // Earlier candle has valid OHLC for this fixture too.
 assert.equal(result.values.length,1);assert.equal(result.alignmentCandle.datetime,'2026-08-28 20:00:00');
 const d={latestVisibleDate:'2026-08-28',latestVisibleTime:'20:00',dateConfidence:'high',latestVisibleTimeConfidence:'high',latestVisibleDateEvidence:'verified_axis_bar_count',latestVisiblePrice:1.38988,latestVisiblePriceConfidence:'high',latestVisibleOpen:1.39014,latestVisibleHigh:1.39088,latestVisibleLow:1.38979,latestVisibleClose:1.38988,latestVisibleCandleComplete:true,providerSessionAligned:true};
 const matched=assessChartDataMatch({source:'OANDA',symbol:'USDCAD',timeframe:'H4',cutoff:'2026-08-28 20:00:59',candles:result.values,alignmentCandle:result.alignmentCandle,detection:d});assert.equal(matched.status,'matched_reference');assert.equal(matched.tolerance,.0003);
});
