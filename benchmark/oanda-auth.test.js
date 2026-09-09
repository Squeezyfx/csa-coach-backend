import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOandaConfig,checkOandaConnection,fetchOandaSeries} from '../oanda-data.js';
const sample={time:'2026-08-25T00:00:00Z',complete:true,mid:{o:'1.1',h:'1.2',l:'1.0',c:'1.15'}};
test('copy-paste token wrappers are stripped without changing token contents',()=>{
 for(const token of [' demo-token ', '"demo-token"',"'demo-token'",'Bearer demo-token','OANDA_API_TOKEN="demo-token"','"Bearer demo-token"']){
  assert.deepEqual(normalizeOandaConfig({token,environment:' Practice ',price:' m '}),{token:'demo-token',environment:'practice',price:'M'});
 }
});
test('malformed config fails without printing secret contents',()=>{
 for(const token of ['', 'demo token', 'demo\nsecret', 'secret!']) {
  assert.throws(()=>normalizeOandaConfig({token}),e=>e.category==='authentication'&&!e.message.includes('demo')&&!e.message.includes('secret'));
 }
 assert.throws(()=>normalizeOandaConfig({token:'demo',environment:'wrong'}),/practice or live/);
});
test('connection check retrieves prices with selected midpoint and never switches environment',async()=>{
 const calls=[];
 const result=await checkOandaConnection({token:'Bearer demo-token',environment:'practice',price:'M',fetchImpl:async(url,opts)=>{
  calls.push(url);assert.equal(opts.headers.Authorization,'Bearer demo-token');assert.equal(new URL(url).searchParams.get('price'),'M');
  return {ok:true,json:async()=>({instrument:'EUR_USD',granularity:'M5',candles:[sample]})};
 }});
 assert.equal(result.ok,true);assert.equal(result.sampleOHLC.c,'1.15');assert.equal(calls.length,1);assert.ok(calls[0].startsWith('https://api-fxpractice.oanda.com/v3/instruments/'));assert.equal(JSON.stringify(result).includes('demo-token'),false);
});
test('401 gives actionable environment guidance without retrying or echoing response secrets',async()=>{
 let calls=0;
 await assert.rejects(checkOandaConnection({token:'secret-token',fetchImpl:async()=>{calls++;return {ok:false,status:401,json:async()=>({errorMessage:'secret-token'})};}}),e=>e.category==='authentication'&&e.message.includes('practice')&&!e.message.includes('secret-token'));
 assert.equal(calls,1);
});
test('historical fetch also handles non-JSON 401 safely',async()=>{
 await assert.rejects(fetchOandaSeries({symbol:'USDCAD',interval:'4h',startDate:'2026-08-01',endDateTime:'2026-08-02 00:00:00',token:'"secret-token"',fetchImpl:async()=>({ok:false,status:401,json:async()=>{throw Error('HTML response');}})}),e=>e.category==='authentication'&&e.message.includes('401'));
});
