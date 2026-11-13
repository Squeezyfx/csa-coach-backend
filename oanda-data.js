// Read-only OANDA adapter. It never changes provider prices to fit a chart.
const CURRENCIES=new Set('USD EUR GBP JPY CHF CAD AUD NZD SGD HKD NOK SEK DKK ZAR MXN TRY PLN CNH HUF CZK'.split(' '));
const GRANULARITY={'1min':'M1','5min':'M5','15min':'M15','30min':'M30','1h':'H1','4h':'H4','1day':'D','1week':'W','1month':'M'};
// UNVERIFIED against any live account: these are OANDA's commonly published
// v20 CFD instrument codes, but (a) CFD availability depends on the specific
// account's region/type — some OANDA accounts are FX-and-metals only — and
// (b) I have no API access to confirm these codes or that this account can
// see them. Before relying on this, call this account's own
// /v3/accounts/{accountID}/instruments and check the returned names match.
// Today this table is the only thing that can route USA100/USOIL to OANDA at
// all: the regex below requires two 3-letter currency codes, so it could
// never have matched these regardless of how the input string was spelled.
const CFD_INSTRUMENTS={USA100:'NAS100_USD',NAS100:'NAS100_USD',USTEC:'NAS100_USD',
 USA500:'SPX500_USD',US500:'SPX500_USD',SPX500:'SPX500_USD',USA30:'US30_USD',US30:'US30_USD',
 UK100:'UK100_GBP',GER30:'DE30_EUR',GER40:'DE40_EUR',DE30:'DE30_EUR',DE40:'DE40_EUR',
 JP225:'JP225_USD',USOIL:'WTICO_USD',WTICO:'WTICO_USD',UKOIL:'BCO_USD',UKBRENT:'BCO_USD',
 // Added 2026-11-11 (same caveat as above: OANDA's published v20 codes, availability depends on the account).
 FRA40:'FR40_EUR',FR40:'FR40_EUR',EU50:'EU50_EUR',STOXX50:'EU50_EUR',ESP35:'ES35_EUR',ES35:'ES35_EUR',
 HK50:'HK33_HKD',HK33:'HK33_HKD',AUS200:'AU200_AUD',AU200:'AU200_AUD',CHINA50:'CN50_USD',CN50:'CN50_USD',
 NATGAS:'NATGAS_USD',
 // The US Dollar Index has no data feed of its own at either provider, so it is built from the six currency
 // pairs that make it up (see fetchSyntheticDxy).
 DXY:'DXY_INDEX',USDINDEX:'DXY_INDEX',USDIDX:'DXY_INDEX'};
export const DXY_INSTRUMENT='DXY_INDEX';
// ICE US Dollar Index formula: 50.14348112 x EURUSD^-0.576 x USDJPY^0.136 x GBPUSD^-0.119 x USDCAD^0.091 x USDSEK^0.042 x USDCHF^0.036.
const DXY_FORMULA={constant:50.14348112,parts:[['EUR_USD',-0.576],['USD_JPY',0.136],['GBP_USD',-0.119],['USD_CAD',0.091],['USD_SEK',0.042],['USD_CHF',0.036]]};
// Finer candles the index is computed from, then rolled up to the requested candle size.
const SYNTHETIC_FINER={'1min':'1min','5min':'1min','15min':'5min','30min':'5min','1h':'15min','4h':'15min','1day':'1h','1week':'4h'};
export function oandaInstrument(symbol='') {
 const raw=String(symbol).toUpperCase().replace(/^#/,'').replace(/[/_]/g,'');
 if(CFD_INSTRUMENTS[raw])return CFD_INSTRUMENTS[raw];
 const parts=raw.match(/^([A-Z]{3})([A-Z]{3})$/);
 return parts&&parts[1]!==parts[2]&&CURRENCIES.has(parts[1])&&CURRENCIES.has(parts[2])?`${parts[1]}_${parts[2]}`:null;
}
// A CFD instrument (from the table above) is not a currency pair, so a pip
// size / three-pip tolerance built for currency pairs must not apply to it —
// 0.0003 is meaningless for an index around 29000. Only compute a pip size
// when the instrument is genuinely two recognized currencies.
function isForexPair(pair){const p=String(pair||'').split('_');return p.length===2&&CURRENCIES.has(p[0])&&CURRENCIES.has(p[1]);}
export function forexPipSize(symbol) {const pair=oandaInstrument(symbol);return isForexPair(pair)?(pair.endsWith('_JPY')?.01:.0001):null;}
export function forexComparisonTolerance(symbol){const pip=forexPipSize(symbol);return pip===null?null:Number((3*pip).toFixed(8));}
// The computed Dollar Index is an approximation of the broker's index (different weights of rounding, no
// intra-candle extremes), so its chart check is wider than a currency pair's: 0.25 index points (about 0.25%).
export function syntheticIndexTolerance(symbol){return oandaInstrument(symbol)===DXY_INSTRUMENT?0.25:null;}
export function isSyntheticInstrument(symbol){return oandaInstrument(symbol)===DXY_INSTRUMENT;}
function fail(message,category='provider_error'){return Object.assign(new Error(message),{category});}
export function normalizeOandaConfig({token="",environment="practice",price="B"}={}) {
 let cleaned=String(token).trim();
 // Recover common copy/paste wrappers; do not change internal token characters.
 for(let i=0;i<3;i++) {
  cleaned=cleaned.replace(/^OANDA_API_TOKEN\s*=\s*/i,"").trim();
  if ((cleaned.startsWith('"')&&cleaned.endsWith('"'))||(cleaned.startsWith("'")&&cleaned.endsWith("'"))) cleaned=cleaned.slice(1,-1).trim();
  cleaned=cleaned.replace(/^Bearer\s+/i,"").trim();
 }
 const env=String(environment).trim().toLowerCase(),component=String(price).trim().toUpperCase();
 if(!cleaned)throw fail("OANDA_API_TOKEN is missing","authentication");
 if(/\s/.test(cleaned)||!/^[-A-Za-z0-9._~]+$/.test(cleaned))throw fail("OANDA_API_TOKEN contains invalid characters or internal whitespace; paste the personal access token only","authentication");
 if(!["practice","live"].includes(env))throw fail("OANDA_ENVIRONMENT must be practice or live","configuration");
 if(!["B","A","M"].includes(component))throw fail("OANDA_PRICE_COMPONENT must be B, A or M","configuration");
 return {token:cleaned,environment:env,price:component};
}
export function oandaHttpError(status,environment) {
 const category=status===401?'authentication':status===403?'subscription_access':status===429?'rate_limit':status===404?'symbol_unavailable':'provider_error';
 const hint=status===401?` Token rejected by OANDA ${environment}. Verify that the personal access token belongs to this environment; replace it in Render if invalid or revoked. A trading password or account number is not an API token.`:status===403?' Token lacks permission for this endpoint. Check OANDA API access.':'';
 return fail(`OANDA candle request failed (${status}).${hint}`,category);
}
export async function checkOandaConnection({token,environment="practice",price="B",fetchImpl=fetch}={}) {
 const config=normalizeOandaConfig({token,environment,price});
 const origin=config.environment==='live'?'https://api-fxtrade.oanda.com':'https://api-fxpractice.oanda.com';
 const params=new URLSearchParams({granularity:'M5',price:config.price,count:'2'});
 const response=await fetchImpl(`${origin}/v3/instruments/EUR_USD/candles?${params}`,{headers:{Authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw oandaHttpError(response.status,config.environment);
 const data=await response.json();
 if(data.instrument!=='EUR_USD'||data.granularity!=='M5'||!Array.isArray(data.candles)||!data.candles.length)throw fail('OANDA authenticated but did not return the expected candle data');
 const key={B:'bid',A:'ask',M:'mid'}[config.price];
 const sample=data.candles.find(c=>c.complete===true&&['o','h','l','c'].every(k=>Number(c[key]?.[k])>0));
 if(!sample)throw fail('OANDA authenticated but no completed readable sample candle was returned');
 return {ok:true,adapterVersion:'1.1.0',environment:config.environment,priceComponent:config.price,instrument:data.instrument,sampleTime:sample.time,sampleOHLC:sample[key],message:'OANDA authentication and candle retrieval succeeded. Historical chart alignment still requires a separate check.'};
}
function localString(ms,timezone){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));
 const d=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${d.year}-${d.month}-${d.day} ${d.hour}:${d.minute}:${d.second}`;
}
export function localToUtc(text,timezone='UTC'){
 const normalized=String(text).replace('T',' ').slice(0,19);
 if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized))throw fail('Exact cutoff date and time required','date_unverified');
 const wall=Date.parse(normalized.replace(' ','T')+'Z');if(!Number.isFinite(wall))throw fail('Invalid cutoff','date_unverified');
 let guess=wall;
 for(let i=0;i<4;i++){const displayed=Date.parse(localString(guess,timezone).replace(' ','T')+'Z');guess+=wall-displayed;}
 if(localString(guess,timezone)!==normalized)throw fail('Invalid or nonexistent session time','session_unverified');return guess;
}
function endOfCandle(start,granularity,timezone){
 const minutes={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240}[granularity];
 if(minutes)return start+minutes*60000;
 const local=localString(start,timezone),d=new Date(local.replace(' ','T')+'Z');
 if(granularity==='M')d.setUTCMonth(d.getUTCMonth()+1);else d.setUTCDate(d.getUTCDate()+(granularity==='W'?7:1));
 return localToUtc(d.toISOString().slice(0,19),timezone);
}
const BUCKET_MINUTES={'1min':1,'5min':5,'15min':15,'30min':30,'1h':60,'4h':240,'1day':1440,'1week':10080};
// Wall-clock helpers for 'YYYY-MM-DD HH:MM:SS' strings that are already in the requested timezone.
function addMinutesLocal(text,minutes){const d=new Date(text.replace(' ','T')+'Z');d.setUTCMinutes(d.getUTCMinutes()+minutes);return d.toISOString().slice(0,19).replace('T',' ');}
function bucketStartLocal(text,interval){
 const date=text.slice(0,10);
 if(interval==='1day')return `${date} 00:00:00`;
 if(interval==='1week'){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return `${d.toISOString().slice(0,10)} 00:00:00`;}
 const minutes=Number(text.slice(11,13))*60+Number(text.slice(14,16)),size=BUCKET_MINUTES[interval],start=minutes-minutes%size;
 return `${date} ${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')}:00`;
}
// US Dollar Index built from the six currency pairs OANDA does serve. Index values are worked out for every
// finer candle (open and close), then rolled up to the requested candle size. Highs and lows therefore come
// from those finer opens/closes, not from true intra-candle extremes, so they can sit a little inside the real
// ones; the result is an approximation and is reported as such (synthetic: true).
async function fetchSyntheticDxy({interval,startDate,endDateTime,timezone='UTC',token,environment='practice',price='B',fetchImpl=fetch,maxPages=100}={}){
 const fine=SYNTHETIC_FINER[interval];
 if(!fine)throw fail('The US Dollar Index is not available for this candle size','symbol_unavailable');
 const series=await Promise.all(DXY_FORMULA.parts.map(([pair])=>fetchOandaSeries({symbol:pair,interval:fine,startDate,endDateTime,timezone,token,environment,price,fetchImpl,maxPages})));
 const maps=series.map(s=>new Map(s.values.map(row=>[row.datetime,row])));
 const indexAt=(rows,field)=>{let v=DXY_FORMULA.constant;DXY_FORMULA.parts.forEach(([,weight],i)=>{v*=Math.pow(rows[i][field],weight);});return v;};
 const buckets=new Map();
 for(const datetime of [...maps[0].keys()].sort()){
  const rows=maps.map(m=>m.get(datetime));
  if(rows.some(r=>!r))continue;
  const open=indexAt(rows,'open'),close=indexAt(rows,'close'),key=bucketStartLocal(datetime,interval),b=buckets.get(key);
  if(!b)buckets.set(key,{datetime:key,open,high:Math.max(open,close),low:Math.min(open,close),close});
  else{b.high=Math.max(b.high,open,close);b.low=Math.min(b.low,open,close);b.close=close;}
 }
 const cutoff=String(endDateTime).replace('T',' ').slice(0,19);
 const isLiveWindow=Date.now()-localToUtc(endDateTime,timezone)<6*3600000;
 const round=row=>({datetime:row.datetime,open:Number(row.open.toFixed(4)),high:Number(row.high.toFixed(4)),low:Number(row.low.toFixed(4)),close:Number(row.close.toFixed(4))});
 const values=[];let alignmentCandle=null;
 for(const row of [...buckets.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime))){
  const forming=addMinutesLocal(row.datetime,BUCKET_MINUTES[interval])>cutoff;
  if(forming&&isLiveWindow){alignmentCandle=round(row);continue;}
  values.push(round(row));
 }
 if(!values.length)throw fail('No completed index candles before cutoff','history_unavailable');
 return {values,providerSymbol:'DXY',source:'OANDA (computed US Dollar Index)',priceComponent:price,timezone,alignmentCandle,synthetic:true};
}
export async function fetchOandaSeries({symbol,interval,startDate,endDateTime,timezone='UTC',token,environment='practice',price='B',fetchImpl=fetch,maxPages=100}={}){
 const instrument=oandaInstrument(symbol),granularity=GRANULARITY[interval];
 if(!instrument)throw fail('OANDA forex adapter does not support this instrument','symbol_unavailable');
 if(!granularity)throw fail('Unsupported OANDA candle interval');
 if(instrument===DXY_INSTRUMENT)return fetchSyntheticDxy({interval,startDate,endDateTime,timezone,token,environment,price,fetchImpl,maxPages});
 ({token,environment,price}=normalizeOandaConfig({token,environment,price}));
 const start=localToUtc(`${startDate} 00:00:00`,timezone),end=localToUtc(endDateTime,timezone);
 if(end<=start)throw fail('Empty historical window','history_unavailable');
 const origin=environment==='live'?'https://api-fxtrade.oanda.com':'https://api-fxpractice.oanda.com';
 const values=new Map();let cursor=start,includeFirst=true,finished=false,alignmentCandle=null;
 // A candle whose own natural end extends past our requested cutoff is
 // genuinely still forming ONLY when that cutoff is close to the real
 // present moment - the live-analysis case this guards against look-ahead
 // for (a chart uploaded moments after being captured, mid-candle). For an
 // older chart analyzed well after the fact (this benchmark's normal
 // case), that same window closed for real hours or days ago: OANDA now
 // reports it complete=true, but this check alone still flagged it as
 // in-progress and diverted its OHLC to alignmentCandle instead of
 // values - and by the time it's queried, OANDA's live-price plumbing no
 // longer holds the transient partial-tick state that existed exactly at
 // the historical cutoff, so alignmentCandle ended up holding an
 // unrelated, much-later snapshot (confirmed on AUDJPY M5, one real day
 // stale: alignmentCandle's open==close==111.289 didn't match ANY actual
 // candle in the fetched history, while the chart itself read 111.083).
 // Once the cutoff is safely in the past, complete=true alone is the
 // correct, and only recoverable, signal.
 const isLiveWindow=Date.now()-end<6*3600000;
 for(let page=0;page<maxPages;page++){
  const params=new URLSearchParams({granularity,price,from:new Date(cursor).toISOString(),count:'5000',includeFirst:String(includeFirst),smooth:'false',dailyAlignment:'0',alignmentTimezone:timezone,weeklyAlignment:'Monday'});
  const response=await fetchImpl(`${origin}/v3/instruments/${instrument}/candles?${params}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw oandaHttpError(response.status,environment);
  const data=await response.json();
  if(data.instrument!==instrument||data.granularity!==granularity||!Array.isArray(data.candles))throw fail('OANDA response instrument/interval does not match request');
  if(!data.candles.length){finished=true;break;}
  let last=cursor;
  for(const c of data.candles){
   const time=Date.parse(c.time);if(!Number.isFinite(time))throw fail('OANDA returned an invalid candle time');last=Math.max(last,time);
   if(time<start||time>=end)continue;

   const p=c[{B:'bid',A:'ask',M:'mid'}[price]];
   const row={datetime:localString(time,timezone),open:Number(p?.o),high:Number(p?.h),low:Number(p?.l),close:Number(p?.c)};
   if(![row.open,row.high,row.low,row.close].every(n=>Number.isFinite(n)&&n>0)||row.low>Math.min(row.open,row.close)||row.high<Math.max(row.open,row.close)||row.high<row.low)throw fail('Invalid OANDA OHLC');
   // An overlapping candle is comparison-only. Its full later range never
   // enters the historical computation array.
   if(c.complete!==true||(isLiveWindow&&endOfCandle(time,granularity,timezone)>end)) {
     if(!alignmentCandle||row.datetime>alignmentCandle.datetime)alignmentCandle=row;
     continue;
   }
   values.set(time,row);
  }
  if(last>=end||data.candles.length<5000){finished=true;break;}
  if(last<=cursor)throw fail('OANDA pagination did not advance');cursor=last;includeFirst=false;
 }
 if(!finished)throw fail('OANDA history exceeded the page limit; partial history rejected','history_unavailable');
 if(!values.size)throw fail('No completed OANDA candles before cutoff','history_unavailable');
 return {values:[...values.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v),providerSymbol:instrument.replace('_','/'),source:'OANDA',priceComponent:price,timezone,alignmentCandle};
}

// The newest candles up to now: the completed ones, and the still-forming latest candle on its own.
// Used only to find the date of a screenshot whose own date could not be read (see
// locateFinalVisibleCandle); never part of a review.
export async function fetchRecentCandles({symbol,interval,days=14,timezone='UTC',token,environment='practice',price='B',now=Date.now(),fetchImpl=fetch}={}){
 const startMs=now-days*86400000;
 const series=await fetchOandaSeries({symbol,interval,startDate:localString(startMs,timezone).slice(0,10),endDateTime:localString(now,timezone),timezone,token,environment,price,fetchImpl});
 return {candles:series.values,forming:series.alignmentCandle||null};
}

// Candles after a past cutoff, fetched only to prove that a screenshot running beyond the cutoff comes
// from this feed (see verifyFeedPastCutoff). They are never part of the review.
export async function fetchCandlesAfterCutoff({symbol,interval,cutoff,timezone='UTC',token,environment='practice',price='B',days=7,now=Date.now(),fetchImpl=fetch}={}){
 const cutoffText=String(cutoff||'').slice(0,19);
 const cutoffMs=localToUtc(cutoffText,timezone);
 const endMs=Math.min(now,cutoffMs+days*86400000);
 if(endMs<=cutoffMs)return [];
 const series=await fetchOandaSeries({symbol,interval,startDate:cutoffText.slice(0,10),endDateTime:localString(endMs,timezone),timezone,token,environment,price,fetchImpl});
 return series.values.filter(row=>row.datetime>cutoffText);
}

// The same, plus the still-forming latest candle on its own. A screenshot taken within the last hours
// shows that candle in its header, and a window of only a few completed candles is too small to prove
// the feed by itself (see verifyFeedPastCutoff).
export async function fetchLaterCandles({symbol,interval,cutoff,timezone='UTC',token,environment='practice',price='B',days=7,now=Date.now(),fetchImpl=fetch}={}){
 const cutoffText=String(cutoff||'').slice(0,19);
 const cutoffMs=localToUtc(cutoffText,timezone);
 const endMs=Math.min(now,cutoffMs+days*86400000);
 if(endMs<=cutoffMs)return {candles:[],forming:null};
 const series=await fetchOandaSeries({symbol,interval,startDate:cutoffText.slice(0,10),endDateTime:localString(endMs,timezone),timezone,token,environment,price,fetchImpl});
 const forming=series.alignmentCandle&&series.alignmentCandle.datetime>cutoffText?series.alignmentCandle:null;
 return {candles:series.values.filter(row=>row.datetime>cutoffText),forming};
}
