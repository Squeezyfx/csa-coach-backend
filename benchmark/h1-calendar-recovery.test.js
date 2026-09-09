import test from "node:test";
import assert from "node:assert/strict";
import {resolveFrameworkBias} from "../framework-calendar.js";
for (const timeframe of ["M1","M5","M15","M30","H1","H4","D1","W1","MN"]) {
 test(timeframe+" preserves calendar direction through a final pullback",()=>{
  const result=resolveFrameworkBias({timeframe,periodOpen:100,periodClose:115,
   periodInventory:[{high:120,low:90},{high:118,low:110,open:117,close:115}]});
  assert.equal(result.direction,"bullish");
  assert.equal(result.phase,"bearish_pullback_after_bullish_structure");
 });
}
test("missing open can use range evidence consistently",()=>{
 assert.equal(resolveFrameworkBias({periodClose:115,periodInventory:[{high:120,low:90}]}).direction,"bullish");
 assert.equal(resolveFrameworkBias({periodClose:105,periodInventory:[{high:120,low:90}]}),null);
});
