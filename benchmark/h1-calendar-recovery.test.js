import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../server.js",import.meta.url),"utf8");
const start=source.indexOf("function deriveVerifiedFixedPeriodBias(");
const end=source.indexOf("function buildPeriodInventoryStructuralCandidates",start);
const ctx=vm.createContext({
 comparableTimeframe:x=>x,
 nullablePositiveNumber:x=>x!=null&&Number.isFinite(Number(x))&&Number(x)>0?Number(x):null
});
vm.runInContext(source.slice(start,end),ctx);
for(const tf of ["M5","M15","H1","H4"]){
 test(tf+" resolves calendar direction from period open and final close",()=>{
  const result=ctx.deriveVerifiedFixedPeriodBias({timeframe:tf,periodOpen:100,periodClose:115,
   periodInventory:[{high:120,low:90},{high:118,low:110,open:117,close:115}]});
  assert.equal(result.direction,"bullish");
  assert.equal(result.phase,"bearish_pullback_after_bullish_breakout");
 });
}
test("missing calendar open does not manufacture H1 direction",()=>{
 assert.equal(ctx.deriveVerifiedFixedPeriodBias({timeframe:"H1",periodClose:115,periodInventory:[{high:120,low:90}]}),null);
});
test("D1 range-position behavior is preserved",()=>{
 assert.equal(ctx.deriveVerifiedFixedPeriodBias({timeframe:"D1",periodClose:115,periodInventory:[{high:120,low:90}]}).direction,"bullish");
});
test("reviewed-chart overlay retains live frame and provider audit",()=>{
 const a=source.indexOf("    if (verifiedChartFixture) {",source.indexOf("const verifiedChartFixture = benchmarkReviewedChartFixture;"));
 const b=source.indexOf("    visualReview = resolveIntradayCsaChartMarking",a);
 const sandbox=vm.createContext({
  verifiedChartFixture:{direction:"bullish",candidates:[]},
  visualReview:{chartNativeEntryFallback:{currentPeriodHigh:120,currentWeekHigh:120,currentWeekLow:90,currentPeriodFrameVerified:false,currentPeriodFrameChartUsable:true,providerFailure:{category:"date_unverified"},periodInventory:[{date:"2026-08-17",high:120,low:90}]}},
  applyVerifiedPeriodExtremeOverrides:x=>x
 });
 vm.runInContext(source.slice(a,b),sandbox);
 const f=sandbox.visualReview.chartNativeEntryFallback;
 assert.equal(f.currentWeekHigh,120);
 assert.equal(f.currentWeekLow,90);
 assert.equal(f.currentPeriodFrameChartUsable,true);
 assert.equal(f.currentPeriodFrameVerified,false);
 assert.equal(f.providerFailure.category,"date_unverified");
});
