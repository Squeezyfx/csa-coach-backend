import {decodePng8} from './chart-raster-reader.js';
const MINUTES={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440};
const groups=xs=>{const out=[];for(const x of xs){if(!out.length||x>out.at(-1).at(-1)+1)out.push([x]);else out.at(-1).push(x);}return out;};
// Forex/CFD/index charts never print weekend candles, so skipping Sat/Sun
// keeps bar counts aligned with the visible axis. Crypto trades every day,
// so that skip must be disabled per-instrument (tradesOnWeekends) or every
// anchor pair spanning a weekend fails validation and returns null.
function advance(time,bars,minutes,tradesOnWeekends){for(let n=0;n<bars;n++){do{time+=minutes*60000;}while(!tradesOnWeekends&&[0,6].includes(new Date(time).getUTCDay()));}return time;}
function parseTimestamp(value){const text=String(value||"").replace("T"," ").slice(0,19);return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)?Date.parse(text.replace(" ","T")+"Z"):NaN;}
function barsBetween(start,end,minutes,tradesOnWeekends){let time=start,count=0;while(time<end&&count<10000){time=advance(time,1,minutes,tradesOnWeekends);count++;}return time===end?count:null;}
// Validates three or more printed axis labels, then advances by the few
// visible bars after the final label. It does not trust a single date label.
export function resolveVisibleTimestampFromAxisCount({timeAxisTimestamps=[],visibleCandlesAfterLastPrintedDate,timeframe,tradesOnWeekends=false}={}){
 const minutes=MINUTES[timeframe],count=Number(visibleCandlesAfterLastPrintedDate);
 const rows=(Array.isArray(timeAxisTimestamps)?timeAxisTimestamps:[]).map(parseTimestamp).filter(Number.isFinite);
 if(!minutes||rows.length<3||!Number.isInteger(count)||count<0||count>48)return null;
 for(let i=1;i<rows.length;i++){const bars=barsBetween(rows[i-1],rows[i],minutes,tradesOnWeekends);if(bars===null||bars<1)return null;}
 const timestamp=new Date(advance(rows.at(-1),count,minutes,tradesOnWeekends)).toISOString().slice(0,19).replace("T"," ");
 return {timestamp,evidence:"verified_multi_anchor_axis_count",anchorCount:rows.length,candlesAfterLastLabel:count,anchors:rows.map(value=>new Date(value).toISOString().slice(0,19).replace("T"," "))};
}
// Shared pixel-geometry core for both readMt4CandleGeometry and
// readMt4ForexTimestamp. Candle centers are found from repeated DARK pixels
// (wicks/outlines) only, never from red/green body color: a drawn indicator
// or zig-zag overlay (present on almost every real MT4 screenshot) matches
// body colors too and can collapse color-based detection to near-nothing,
// which used to make readMt4ForexTimestamp bail out before it ever reached
// its own tick-mark scan, silently falling back to a less-verified reader.
function detectMt4CandleGeometry(im){
 const {width:w,height:h,pixels:p}=im;const dark=(x,y)=>{const i=(y*w+x)*4;return p[i]<72&&p[i+1]<72&&p[i+2]<72;};
 let right=null,bottom=null;for(let x=Math.floor(w*.7);x<w-5;x++){let n=0;for(let y=20;y<h-20;y++)if(dark(x,y))n++;if(n>(h-40)*.8)right=x;}if(right===null)return null;
 for(let y=Math.floor(h*.75);y<h-8;y++){let n=0;for(let x=1;x<right;x++)if(dark(x,y))n++;if(n>right*.8)bottom=y;}if(bottom===null)return null;
 const cols=[];for(let x=2;x<right-2;x++){let n=0;for(let y=22;y<bottom-10;y++)if(dark(x,y))n++;if(n>=2)cols.push(x);}
 // Browser-generated benchmark images retain their original wide resolution.
 // Their H1 candle spacing can exceed 12px, so 12 was an accidental
 // thumbnail-only ceiling that made an otherwise readable chart uncalibrated.
 const centers=groups(cols).map(g=>Math.round((g[0]+g.at(-1))/2)),counts=new Map();for(let i=1;i<centers.length;i++){const n=centers[i]-centers[i-1];if(n>=2&&n<=36)counts.set(n,(counts.get(n)||0)+1);}const step=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];
 if(!step||centers.length<40)return null;let last=centers.at(-1);for(let x=last;x<Math.min(right-2,last+step*6);x+=step){let n=0;for(let y=22;y<bottom-10;y++)if(dark(x,y))n++;if(n>=2)last=x;}
 // The leftmost candle can be clipped by the plot's left edge, shifting its
 // detected center off the regular step grid by a pixel or two. Reconstruct
 // it from the second (unclipped) candle instead of trusting it directly, so
 // firstCandleX always lands on the same grid as every other candle.
 const first=centers.length>1&&centers[1]-centers[0]!==step?centers[1]-step:centers[0];
 return {w,h,p,dark,right,bottom,step,first,last,centerCount:centers.length};
}
// Pixel candle geometry only; it makes no calendar or price claim.
export function readMt4CandleGeometry({imageBase64,timeframe}={}){
 if(!MINUTES[timeframe])return null;const im=decodePng8(Buffer.from(imageBase64||"","base64"));if(!im)return null;
 const geometry=detectMt4CandleGeometry(im);if(!geometry)return null;
 return {candleStep:geometry.step,firstCandleX:geometry.first,lastCandleX:geometry.last,candleCount:geometry.centerCount};
}
// Number of trading-day boundaries crossed strictly after t1's calendar date
// up to and including t2's, i.e. how many times a once-per-day session gap
// (see below) would have occurred between two anchors.
function tradingDaysBetween(t1,t2,tradesOnWeekends){
 let cursor=Date.UTC(new Date(t1).getUTCFullYear(),new Date(t1).getUTCMonth(),new Date(t1).getUTCDate())+86400000;
 const end=Date.UTC(new Date(t2).getUTCFullYear(),new Date(t2).getUTCMonth(),new Date(t2).getUTCDate());
 let days=0;
 while(cursor<=end){if(tradesOnWeekends||![0,6].includes(new Date(cursor).getUTCDay()))days++;cursor+=86400000;}
 return days;
}
// CFDs/commodities/indices commonly have a short daily maintenance halt (a
// broker/exchange rollover window), unlike continuous spot forex or crypto,
// and the halt itself can vary in length day to day (for example a holiday
// session). advance() alone assumes every trading day has exactly
// 24h/H1-step of real candles, so any such chart fails a naive bar-count
// check. Rather than assuming one fixed gap for the whole chart, each
// consecutive anchor PAIR already gives us its own exact before/after
// timestamps, so its own gap (if any) is derived directly and verified
// on its own — never assumed equal to any other pair's. advance() already
// skips weekend calendar time correctly, so comparing against its
// gap-free prediction isolates just the session-gap minutes.
function pairGapMinutes(t1,t2,n,days,minutes,tradesOnWeekends){
 const withoutGap=advance(t1,n,minutes,tradesOnWeekends);
 if(days<=0)return withoutGap===t2?0:null;
 const gap=(t2-withoutGap)/60000/days;
 return Number.isInteger(gap)&&gap>=0&&gap<=480?gap:null;
}
// Validates one candidate anchor chain in full; null means some pair in it
// is not explainable by candle-index spacing plus a plausible session gap.
function validateAnchorChain(rows,candleStep,minutes,tradesOnWeekends){
 if(rows.length<3)return null;
 for(const row of rows){if((row.x-rows[0].x)%candleStep!==0)return null;}
 const pixelRows=rows.map(row=>({...row,n:(row.x-rows[0].x)/candleStep}));
 let lastGapMinutes=0,anySessionGap=false;
 for(let i=1;i<rows.length;i++){
  const n=pixelRows[i].n-pixelRows[i-1].n;
  if(n<=0||n>10000)return null;
  const days=tradingDaysBetween(rows[i-1].t,rows[i].t,tradesOnWeekends);
  const gap=pairGapMinutes(rows[i-1].t,rows[i].t,n,days,minutes,tradesOnWeekends);
  if(gap===null)return null;
  lastGapMinutes=gap;
  if(gap>0)anySessionGap=true;
 }
 return {lastGapMinutes,anySessionGap};
}
export function resolveAxisTimestamp({anchors=[],lastCandleX,candleStep,timeframe,tradesOnWeekends=false}={}){
 const minutes=MINUTES[timeframe];if(!minutes||!(candleStep>0)||anchors.length<3)return null;
 const allRows=anchors.map(a=>({...a,t:Date.parse(String(a.timestamp).replace(' ','T')+'Z')}));
 if(allRows.some(a=>!Number.isFinite(a.t)||!Number.isFinite(a.x)))return null;
 // MT4 often prints only a bare date (no clock time) for the leftmost axis
 // label, since there is no room to its left for the usual "date HH:MM"
 // format. When a vision model is asked to always supply a time, it can
 // invent one (commonly 00:00) for that single label, which is otherwise
 // indistinguishable from a correctly read anchor. Rather than let one bad
 // edge anchor fail the whole chain, drop it and retry if everything else
 // validates cleanly — the same edge-unreliability already handled for
 // pixel geometry in detectMt4CandleGeometry.
 let rows=allRows,result=validateAnchorChain(rows,candleStep,minutes,tradesOnWeekends);
 if(!result&&allRows.length>3){
  rows=allRows.slice(1);
  result=validateAnchorChain(rows,candleStep,minutes,tradesOnWeekends);
 }
 if(!result)return null;
 const{lastGapMinutes,anySessionGap}=result;
 // The trailing segment beyond the last printed label has no "next" anchor
 // to derive its own gap from, so it uses the most recently observed one —
 // the best available estimate for what the chart is doing right now.
 const last=rows.at(-1),n=(lastCandleX-last.x)/candleStep;
 if(!Number.isInteger(n)||n<0||n>1000)return null;
 let finalTime=advance(last.t,n,minutes,tradesOnWeekends);
 if(lastGapMinutes>0){
  for(let guard=0;guard<5;guard++){
   const days=tradingDaysBetween(last.t,finalTime,tradesOnWeekends);
   const next=advance(last.t,n,minutes,tradesOnWeekends)+days*lastGapMinutes*60000;
   if(next===finalTime)break;
   finalTime=next;
  }
 }
 const timestamp=new Date(finalTime).toISOString().slice(0,19).replace('T',' ');
 const droppedLeadingAnchor=rows!==allRows;
 return {timestamp,evidence:anySessionGap?'verified_axis_bar_count_with_session_gap':'verified_axis_bar_count',candlesAfterLastLabel:n,anchorCount:rows.length,candleStep,lastCandleX,anchors:rows.map(({x,timestamp})=>({x,timestamp})),...(anySessionGap?{trailingSessionGapMinutes:lastGapMinutes}:{}),...(droppedLeadingAnchor?{droppedLeadingAnchor:true}:{})};
}
// A printed axis year is easy for a vision model to misread or hallucinate -
// MT4 usually prints it only once, often in a corner easy to miscount - but
// the pixel-verified candle spacing between labels already encodes the real
// weekday pattern (via the weekend-skip gap math in validateAnchorChain).
// Shifting every anchor's year by the same small delta and re-validating
// lets the TRUE year be recovered from that pixel evidence alone, without
// ever trusting vision's OCR of the year digits. Deltas are tried smallest
// magnitude first so the least invasive correction wins if more than one
// happens to validate.
function shiftAnchorYears(anchors,delta){
 return anchors.map(a=>{
  const m=String(a.timestamp).match(/^(\d{4})(-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/);
  return m?{...a,timestamp:`${Number(m[1])+delta}${m[2]}`}:a;
 });
}
function resolveAxisTimestampWithYearCorrection(params){
 const direct=resolveAxisTimestamp(params);
 if(direct)return direct;
 for(let d=1;d<=12;d++){
  for(const delta of [-d,d]){
   const attempt=resolveAxisTimestamp({...params,anchors:shiftAnchorYears(params.anchors,delta)});
   if(attempt)return {...attempt,yearCorrected:true,yearDelta:delta};
  }
 }
 return null;
}
// Measures candle/time-axis geometry only. No price values or distances are read.
export function readMt4ForexTimestamp({imageBase64,timeframe,timeAxisTimestamps=[],tradesOnWeekends=false}={}){
 if(!MINUTES[timeframe]||timeAxisTimestamps.length<3)return null;
 const im=decodePng8(Buffer.from(imageBase64||'','base64'));if(!im)return null;
 const geometry=detectMt4CandleGeometry(im);if(!geometry)return null;
 const {h,bottom,dark,step,first,last}=geometry;
 const ticks=[];
 for(let x=2;x<=last;x++){let n=0;for(let y=bottom;y<Math.min(h,bottom+6);y++)if(dark(x,y))n++;if(n>=4)ticks.push(x);}
 const positions=groups(ticks).map(g=>g[0]);
 // MT4 frequently prints no distinct tick mark for the leftmost axis label -
 // there is no room to its left for the usual tick+text pairing - so the
 // pixel scan below the axis line can legitimately find exactly one fewer
 // tick than there are printed date labels. Drop that unmatched leading
 // label rather than failing outright: the same edge-unreliability already
 // handled for the anchor CHAIN inside resolveAxisTimestamp, just applied
 // one step earlier, before any anchor is even built.
 let labels=timeAxisTimestamps;
 if(positions.length!==timeAxisTimestamps.length){
  if(positions.length===timeAxisTimestamps.length-1)labels=timeAxisTimestamps.slice(1);
  else return null;
 }
 const anchors=positions.map((x,i)=>({x,timestamp:labels[i]})).filter(a=>/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(a.timestamp||''));
 if((last-first)%step!==0)return null;
 return resolveAxisTimestampWithYearCorrection({anchors,lastCandleX:last,candleStep:step,timeframe,tradesOnWeekends});
}
