import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {assessChartDataMatch} from '../market-data-matching.js';
import {analyzeFramework} from '../shared-analysis-engine.js';
import {calendarMapping} from '../framework-calendar.js';
const base={source:'OANDA',symbol:'USDCAD',timeframe:'H4',cutoff:'2026-08-28 20:00:00',
 alignmentCandle:{datetime:'2026-08-28 20:00:00',open:1.39022,high:1.39086,low:1.39006,close:1.39026},
 detection:{latestVisibleDate:'2026-08-28',latestVisibleDateEvidence:'verified_axis_bar_count',dateConfidence:'high',latestVisibleTime:'20:00',latestVisibleTimeConfidence:'high',latestVisiblePriceConfidence:'high',latestVisibleCandleComplete:null,latestVisiblePrice:1.38988,latestVisibleOpen:1.39014,latestVisibleHigh:1.39088,latestVisibleLow:1.38979}};
test('reported USDCAD close discrepancy retains provisional reference without changing tolerance',()=>{
 const result=assessChartDataMatch(base);
 assert.equal(result.status,'partial_reference');assert.equal(result.tolerance,.0003);
 assert.equal(result.brokerVerified,false);assert.equal(result.priceVerified,false);assert.equal(result.requiresReview,true);
 assert.deepEqual(result.failedFields,['close']);
 assert.equal(base.alignmentCandle.close,1.39026);
});
test('missing time, date, OHL, completed candle and failed extrema never qualify',()=>{
 for(const patch of [{latestVisibleTime:'16:00'},{dateConfidence:'medium'},{latestVisibleOpen:null},{latestVisibleHigh:1.4},{latestVisibleLow:1.38},{latestVisibleCandleComplete:true},{latestVisiblePrice:1.389}]){
  assert.notEqual(assessChartDataMatch({...base,detection:{...base.detection,...patch}}).status,'partial_reference',JSON.stringify(patch));
 }
 assert.notEqual(assessChartDataMatch({...base,source:'Twelve Data',candles:[base.alignmentCandle]}).status,'partial_reference');
});
test('passing close remains a normal reference; no widening for completed candles',()=>{
 assert.equal(assessChartDataMatch({...base,detection:{...base.detection,latestVisiblePrice:1.39026,latestVisibleCandleComplete:true}}).status,'matched_reference');
 assert.notEqual(assessChartDataMatch({...base,detection:{...base.detection,latestVisibleCandleComplete:true,providerSessionAligned:true}}).status,'matched_reference');
});
test('unknown final time selects the completed same-date candle by printed OHLC',()=>{
 const candles=[{datetime:'2026-08-27 16:00:00',open:1.39014,high:1.39088,low:1.38979,close:1.38988},
   {datetime:'2026-08-27 20:00:00',open:1.38536,high:1.38575,low:1.38492,close:1.38507}];
 const result=assessChartDataMatch({...base,cutoff:'2026-08-27 20:00:00',alignmentCandle:candles[1],candles,detection:{...base.detection,latestVisibleDate:'2026-08-27',latestVisibleClose:1.38988,latestVisibleTime:null,latestVisibleTimeConfidence:'low',latestVisibleDateEvidence:'inferred_axis'}});
 assert.equal(result.status,'partial_reference'); assert.equal(result.candleDate,'2026-08-27 16:00:00'); assert.equal(result.tolerance,.0003); assert.equal(result.closeDeferred,true);
});
test('unfinished close is deferred when OHL identifies the candle within tolerance',()=>{
 const result=assessChartDataMatch({...base,detection:{...base.detection,latestVisiblePrice:1.39026,latestVisibleClose:1.39026}});
 assert.equal(result.status,'partial_reference');
 assert.equal(result.closeDeferred,true);
 assert.deepEqual(result.failedFields,[]);
 assert.equal(result.requiresReview,true);
});
test('runtime inventory selection retains OANDA provisional data and does not set verified',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const a=server.indexOf('      const marketInventoryVerified =');
 const b=server.indexOf('      const rawInventoryPriceConflicts',a);
 const c=server.indexOf('      const inventoryUsable =',b);
 const d=server.indexOf('      const inventoryPriceConflicts',c);
 for(const status of ['partial_reference','matched_reference','partial_or_unknown_candle']){
  for(const integrity of [true,false]){
   const context={marketReference:{ok:true,dataProvider:'OANDA',chartDataMatch:{status}},marketPeriodIntegrity:{passed:integrity},marketInventoryFrame:{currentPeriodFrameVerified:true},marketPeriodInventory:[{high:1.4,low:1.38}],chartOnlyInventoryUsable:false,chartOnlyInventoryVerified:false,chartPeriodInventory:[]};
   vm.runInNewContext(server.slice(a,b)+server.slice(c,d)+'; output={marketInventoryVerified,marketInventoryProvisional,selectedPeriodInventory,inventoryAuthority};',context);
   assert.equal(context.output.marketInventoryProvisional,status==='partial_reference'&&integrity);
   assert.equal(context.output.marketInventoryVerified,status==='matched_reference'&&integrity);
   assert.equal(context.output.selectedPeriodInventory.length,integrity&&status!=='partial_or_unknown_candle'?1:0);
  }
 }
});
test('provisional OANDA inventory does not create a false zero-versus-four visual conflict',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(server,/!marketInventoryVerified && !marketInventoryProvisional/);
 assert.match(server,/visual inventory unavailable by design; OANDA period reference retained provisionally/);
});
test('date-uncertain OANDA endpoint preserves completed period references provisionally',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(server,/retainCompletedOandaReference/);
 assert.match(server,/periodReferenceOnly = true/);
 assert.match(server,/\["partial_reference", "date_unverified", "time_unverified", "partial_or_unknown_candle"\]/);
});
test('H1 displays cutoff-safe partial daily ranges without making them entry-eligible',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(server,/const displayPeriodInventory = selectedPeriodInventory\.length/);
 assert.match(server,/periodInventory: displayPeriodInventory/);
 assert.match(server,/if \(marketInventoryVerified \|\| marketInventoryProvisional\)/);
});
test('lower-timeframe days before the latest visible date are closed',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(server,/const calendarDayClosed = \["M1", "M5", "M15", "M30", "H1"\]/);
 assert.match(server,/String\(period\?\.date \|\| ""\) < String\(cutoffDate \|\| ""\)/);
 assert.match(server,/const inheritedPartial = period\?\.partialPeriod === true && !calendarDayClosed/);
});
test('inferred medium-confidence chart time cannot truncate the visible day',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.match(server,/detectedTimeConfidence === "high"/);
 assert.match(server,/explicit_final_candle_timestamp.*verified_axis_bar_count/);
 assert.match(server,/entire final trading day/);
});
test('all supported timeframes retain provisional status and exclude current entry period',()=>{
 for(const timeframe of ['M1','M5','M15','M30','H1','H4','D1','W1','MN']){
  const map=calendarMapping(timeframe,'2026-08-28');
  const periods=map.dates.map((date,i)=>({date,open:1.4,high:1.41-i*.0001,low:1.37+i*.0001,close:1.38988}));
  const result=analyzeFramework({timeframe,cutoff:'2026-08-28',periodInventory:periods,currentPrice:1.38988,authority:'provider_reference_provisional',calendarMappingVerified:true});
  assert.equal(result.status,'provisional',timeframe);assert.equal(result.priceVerified,false);
  assert.equal(result.completedPeriods.length,periods.length-1);
 }
});
