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
 assert.equal(assessChartDataMatch({...base,detection:{...base.detection,latestVisiblePrice:1.39026}}).status,'matched_reference');
 assert.notEqual(assessChartDataMatch({...base,detection:{...base.detection,latestVisibleCandleComplete:true,providerSessionAligned:true}}).status,'matched_reference');
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
test('all supported timeframes retain provisional status and exclude current entry period',()=>{
 for(const timeframe of ['M1','M5','M15','M30','H1','H4','D1','W1','MN']){
  const map=calendarMapping(timeframe,'2026-08-28');
  const periods=map.dates.map((date,i)=>({date,open:1.4,high:1.41-i*.0001,low:1.37+i*.0001,close:1.38988}));
  const result=analyzeFramework({timeframe,cutoff:'2026-08-28',periodInventory:periods,currentPrice:1.38988,authority:'provider_reference_provisional',calendarMappingVerified:true});
  assert.equal(result.status,'provisional',timeframe);assert.equal(result.priceVerified,false);
  assert.equal(result.completedPeriods.length,periods.length-1);
 }
});
