import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {calendarMapping,calendarFrame,frameworkProfile} from '../framework-calendar.js';
import {analyzeFramework,evaluateFrameworkCandidate} from '../shared-analysis-engine.js';
const profiles={M1:['week','day',4],M5:['week','day',4],M15:['week','day',4],M30:['week','day',4],H1:['week','day',4],H4:['month','week',4],D1:['year','month',8],W1:['year','quarter',3],MN:['five_years','year',5]};
for (const [timeframe,[range,unit,count]] of Object.entries(profiles)) {
 test(`${timeframe}: mapped periods, shared bias, estimates remain provisional`,()=>{
  const map=calendarMapping(timeframe,'2026-08-27');
  assert.equal(map.range,range); assert.equal(map.unit,unit); assert.equal(map.dates.length,count);
  for(const scale of [.001,1,1000]) {
   const periodInventory=map.dates.map((date,i)=>({date,open:100*scale,high:(120-i)*scale,low:(90+i)*scale,close:115*scale}));
   const args={timeframe,cutoff:map.cutoff,periodInventory,currentPrice:115*scale};
   const result=analyzeFramework(args);
   assert.equal(result.bias.direction,'bullish'); assert.equal(result.status,'provisional');
   assert.equal(result.frame.currentPeriodHigh,120*scale); assert.equal(result.frame.currentPeriodLow,90*scale);
   assert.equal(result.completedPeriods.length,count-1);
   assert.equal(analyzeFramework({...args,authority:'provider_aligned',calendarMappingVerified:false}).status,'provisional');
   assert.equal(analyzeFramework({...args,authority:'provider_aligned',calendarMappingVerified:true}).status,'verified');
   assert.equal(analyzeFramework({...args,periodInventory:periodInventory.slice(1)}).status,'blocked');
   assert.equal(analyzeFramework({...args,periodInventory:periodInventory.map((p,i)=>i===0?{...p,date:'2025-01-01'}:p)}).status,'blocked');
  }
 });
}
test('calendar edges: Sunday, opening partial week, new year, leap day',()=>{
 assert.deepEqual(calendarMapping('M1','2026-08-30').dates,calendarMapping('H1','2026-08-28').dates);
 const map=calendarMapping('H4','2026-04-08');
 assert.deepEqual(map.dates,['2026-03-30','2026-04-06']);
 const rows=map.dates.map(date=>({date,high:120,low:90}));
 assert.equal(calendarFrame({timeframe:'H4',latestVisibleDate:map.cutoff,periodInventory:rows}).coverageVerified,false);
 rows[0].coverageStart='2026-04-01';
 assert.equal(calendarFrame({timeframe:'H4',latestVisibleDate:map.cutoff,periodInventory:rows}).currentPeriodFrameVerified,true);
 assert.deepEqual(calendarMapping('D1','2027-01-01').dates,['2027-01-01']);
 assert.equal(calendarMapping('D1','2024-02-29').dates.length,2);
 assert.equal(calendarMapping('D1','2026-02-29'),null);
 assert.equal(frameworkProfile('MN1').range,'five_years');
 assert.equal(frameworkProfile('H2'),null);
});
test('one candidate gate rejects wrong side, unfinished periods, missing proof and missing frame',()=>{
 const args={direction:'bullish',currentPrice:120,swingHigh:120,swingLow:90,frameUsable:true,structuralEvidenceValid:true,candidate:{price:105,areaType:'support'}};
 assert.equal(evaluateFrameworkCandidate(args).qualified,true);
 for(const patch of [{frameUsable:false},{structuralEvidenceValid:false},{candidate:{price:119,areaType:'support'}},{candidate:{price:105,areaType:'resistance'}},{candidate:{price:105,areaType:'support',partialPeriod:true}}]) assert.equal(evaluateFrameworkCandidate({...args,...patch}).qualified,false);
});
test('actual server guard cannot fall through for any timeframe in customer or benchmark mode',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const start=server.indexOf('function rankRawEntryAreas(');
 const fn=server.slice(start,server.indexOf('\n}\n',start)+2);
 for(const benchmark of [false,true]) {
  const ctx=vm.createContext({CSA_SELECTOR_VERSION:'test',BENCHMARK_DRY_RUN_ENABLED:benchmark,rankChartNativeFallbackAreas:()=>null,buildNoEntryTransparencyAudit:()=>({})});
  vm.runInContext(fn,ctx);
  for(const timeframe of [...Object.keys(profiles),'H2']) {
   const result=ctx.rankRawEntryAreas({timeframe,direction:'bullish'});
   assert.equal(result.areas.length,0);
   assert.match(result.regressionDiagnostics.fallbackSource,/no_entry_missing/);
  }
 }
});
