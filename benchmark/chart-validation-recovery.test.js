import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const helper = source.slice(source.indexOf("async function readChartDetectionResponse("), source.indexOf("async function detectChartContextFromImage("));
function setup(responses) {
  const calls = [];
  const context = vm.createContext({
    extractJsonObject: text => { try { return JSON.parse(text); } catch { return null; } },
    runVisionModel: async options => {
      calls.push(options);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  });
  vm.runInContext(helper, context);
  return { calls, run: () => context.readChartDetectionResponse({userText:"Read chart"}) };
}
for (const symbol of ["DOGEUSD", "BTCUSD", "Cocoa", "Platinum", "USA500"]) {
  test(symbol + " valid context survives without an extra vision call", async () => {
    const expected = {isTradingChart:true, detectedInstrument:symbol, timeAxisDates:["2026-01-01"], priceAxisTicks:[10,5]};
    const {run,calls} = setup([{text:JSON.stringify(expected)}]);
    const result = await run();
    assert.equal(result.parsed.detectedInstrument,symbol);
    assert.equal(calls.length,1);
    assert.equal(calls[0].maxTokens,1800);
  });
}
test("truncated JSON recovers once without rejecting a valid chart",async()=>{
  const {run,calls}=setup([{text:'{"isTradingChart":true,',raw:{status:"incomplete"}},{text:'{"isTradingChart":true,"detectedInstrument":"DOGEUSD"}'}]);
  const result=await run();
  assert.equal(result.recovered,true);
  assert.equal(result.parsed.isTradingChart,true);
  assert.equal(calls.length,2);
});
test("two malformed responses stop without inventing a valid or invalid verdict",async()=>{
  const {run,calls}=setup([{text:"{"},{text:"not JSON"}]);
  const result=await run();
  assert.equal(result.parsed,null);
  assert.equal(calls.length,2);
});
test("valid negative verdict is preserved without retry",async()=>{
  const {run,calls}=setup([{text:'{"isTradingChart":false}'}]);
  assert.equal((await run()).parsed.isTradingChart,false);
  assert.equal(calls.length,1);
});
test("transport failure is not treated as a chart verdict",async()=>{
  const {run,calls}=setup([new Error("network failure")]);
  await assert.rejects(run,/network failure/);
  assert.equal(calls.length,1);
});
