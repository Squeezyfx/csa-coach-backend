// Read-only OANDA adapter. It never changes provider prices to fit a chart.
const CURRENCIES=new Set('USD EUR GBP JPY CHF CAD AUD NZD SGD HKD NOK SEK DKK ZAR MXN TRY PLN CNH HUF CZK'.split(' '));
const GRANULARITY={'1min':'M1','5min':'M5','15min':'M15','30min':'M30','1h':'H1','4h':'H4','1day':'D','1week':'W','1month':'M'};
export function oandaInstrument(symbol='') {
 const parts=String(symbol).toUpperCase().replace(/^#/,'').replace(/[/_]/g,'').match(/^([A-Z]{3})([A-Z]{3})$/);
 return parts&&parts[1]!==parts[2]&&CURRENCIES.has(parts[1])&&CURRENCIES.has(parts[2])?`${parts[1]}_${parts[2]}`:null;
}
export function forexPipSize(symbol) {const pair=oandaInstrument(symbol);return pair?(pair.endsWith('_JPY')?.01:.0001):null;}
export function forexComparisonTolerance(symbol){const pip=forexPipSize(symbol);return pip===null?null:Number((3*pip).toFixed(8));}
function fail(message,category='provider_error'){return Object.assign(new Error(message),{category});}
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
export async function fetchOandaSeries({symbol,interval,startDate,endDateTime,timezone='UTC',token,environment='practice',price='B',fetchImpl=fetch,maxPages=100}={}){
 const instrument=oandaInstrument(symbol),granularity=GRANULARITY[interval];
 if(!instrument)throw fail('OANDA forex adapter does not support this instrument','symbol_unavailable');
 if(!granularity)throw fail('Unsupported OANDA candle interval');
 if(!token)throw fail('OANDA_API_TOKEN is missing','authentication');
 if(!['practice','live'].includes(environment)||!['B','A','M'].includes(price))throw fail('Invalid OANDA environment or price component','configuration');
 const start=localToUtc(`${startDate} 00:00:00`,timezone),end=localToUtc(endDateTime,timezone);
 if(end<=start)throw fail('Empty historical window','history_unavailable');
 const origin=environment==='live'?'https://api-fxtrade.oanda.com':'https://api-fxpractice.oanda.com';
 const values=new Map();let cursor=start,includeFirst=true,finished=false;
 for(let page=0;page<maxPages;page++){
  const params=new URLSearchParams({granularity,price,from:new Date(cursor).toISOString(),count:'5000',includeFirst:String(includeFirst),smooth:'false',dailyAlignment:'0',alignmentTimezone:timezone,weeklyAlignment:'Monday'});
  const response=await fetchImpl(`${origin}/v3/instruments/${instrument}/candles?${params}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok)throw fail(`OANDA candle request failed (${response.status})`,response.status===401?'authentication':response.status===403?'subscription_access':response.status===429?'rate_limit':response.status===404?'symbol_unavailable':'provider_error');
  if(data.instrument!==instrument||data.granularity!==granularity||!Array.isArray(data.candles))throw fail('OANDA response instrument/interval does not match request');
  if(!data.candles.length){finished=true;break;}
  let last=cursor;
  for(const c of data.candles){
   const time=Date.parse(c.time);if(!Number.isFinite(time))throw fail('OANDA returned an invalid candle time');last=Math.max(last,time);
   if(time<start||time>=end)continue;
   // API complete refers to today, so also enforce completion at the historical cutoff.
   if(c.complete!==true||endOfCandle(time,granularity,timezone)>end)continue;
   const p=c[{B:'bid',A:'ask',M:'mid'}[price]];
   const row={datetime:localString(time,timezone),open:Number(p?.o),high:Number(p?.h),low:Number(p?.l),close:Number(p?.c)};
   if(![row.open,row.high,row.low,row.close].every(n=>Number.isFinite(n)&&n>0)||row.low>Math.min(row.open,row.close)||row.high<Math.max(row.open,row.close)||row.high<row.low)throw fail('Invalid OANDA OHLC');
   values.set(time,row);
  }
  if(last>=end||data.candles.length<5000){finished=true;break;}
  if(last<=cursor)throw fail('OANDA pagination did not advance');cursor=last;includeFirst=false;
 }
 if(!finished)throw fail('OANDA history exceeded the page limit; partial history rejected','history_unavailable');
 if(!values.size)throw fail('No completed OANDA candles before cutoff','history_unavailable');
 return {values:[...values.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v),providerSymbol:instrument.replace('_','/'),source:'OANDA',priceComponent:price,timezone};
}
