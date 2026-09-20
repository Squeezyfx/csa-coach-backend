import {decodePng8} from './chart-raster-reader.js';
const MINUTES={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240};
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
// Pixel candle geometry only; it makes no calendar or price claim.
export function readMt4CandleGeometry({imageBase64,timeframe}={}){
 if(!MINUTES[timeframe])return null;const im=decodePng8(Buffer.from(imageBase64||"","base64"));if(!im)return null;
 const {width:w,height:h,pixels:p}=im;const dark=(x,y)=>{const i=(y*w+x)*4;return p[i]<72&&p[i+1]<72&&p[i+2]<72;};
 let right=null,bottom=null;for(let x=Math.floor(w*.7);x<w-5;x++){let n=0;for(let y=20;y<h-20;y++)if(dark(x,y))n++;if(n>(h-40)*.8)right=x;}if(right===null)return null;
 for(let y=Math.floor(h*.75);y<h-8;y++){let n=0;for(let x=1;x<right;x++)if(dark(x,y))n++;if(n>right*.8)bottom=y;}if(bottom===null)return null;
 // Red/green body pixels also match drawn indicators and zig-zags. Candle
 // wicks/outlines are dark, so use repeated dark pixels only; this keeps a
 // continuous red indicator from collapsing the whole chart into one group.
 const cols=[];for(let x=2;x<right-2;x++){let n=0;for(let y=22;y<bottom-10;y++)if(dark(x,y))n++;if(n>=2)cols.push(x);}
 // Browser-generated benchmark images retain their original wide resolution.
 // Their H1 candle spacing can exceed 12px, so 12 was an accidental
 // thumbnail-only ceiling that made an otherwise readable chart uncalibrated.
 const centers=groups(cols).map(g=>Math.round((g[0]+g.at(-1))/2)),counts=new Map();for(let i=1;i<centers.length;i++){const n=centers[i]-centers[i-1];if(n>=2&&n<=36)counts.set(n,(counts.get(n)||0)+1);}const step=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];
 if(!step||centers.length<40)return null;let last=centers.at(-1);for(let x=last;x<Math.min(right-2,last+step*6);x+=step){let n=0;for(let y=22;y<bottom-10;y++)if(dark(x,y))n++;if(n>=2)last=x;}
 return {candleStep:step,firstCandleX:centers[0],lastCandleX:last,candleCount:centers.length};
}
export function resolveAxisTimestamp({anchors=[],lastCandleX,candleStep,timeframe,tradesOnWeekends=false}={}){
 const minutes=MINUTES[timeframe];if(!minutes||!(candleStep>0)||anchors.length<3)return null;
 const rows=anchors.map(a=>({...a,t:Date.parse(String(a.timestamp).replace(' ','T')+'Z')}));
 if(rows.some(a=>!Number.isFinite(a.t)||!Number.isFinite(a.x)))return null;
 for(let i=1;i<rows.length;i++){
  const n=(rows[i].x-rows[i-1].x)/candleStep;
  if(!Number.isInteger(n)||n<=0||n>10000||advance(rows[i-1].t,n,minutes,tradesOnWeekends)!==rows[i].t)return null;
 }
 const last=rows.at(-1),n=(lastCandleX-last.x)/candleStep;
 if(!Number.isInteger(n)||n<0||n>1000)return null;
 const timestamp=new Date(advance(last.t,n,minutes,tradesOnWeekends)).toISOString().slice(0,19).replace('T',' ');
 return {timestamp,evidence:'verified_axis_bar_count',candlesAfterLastLabel:n,anchorCount:rows.length,candleStep,lastCandleX,anchors};
}
// Measures candle/time-axis geometry only. No price values or distances are read.
export function readMt4ForexTimestamp({imageBase64,timeframe,timeAxisTimestamps=[],tradesOnWeekends=false}={}){
 if(!MINUTES[timeframe]||timeAxisTimestamps.length<3)return null;
 const im=decodePng8(Buffer.from(imageBase64||'','base64'));if(!im)return null;
 const {width:w,height:h,pixels:p}=im;
 const dark=(x,y)=>{const i=(y*w+x)*4;return p[i]<72&&p[i+1]<72&&p[i+2]<72;};
 let right=null,bottom=null;
 for(let x=Math.floor(w*.7);x<w-5;x++){let n=0;for(let y=20;y<h-20;y++)if(dark(x,y))n++;if(n>(h-40)*.8)right=x;}
 if(right===null)return null;
 for(let y=Math.floor(h*.75);y<h-8;y++){let n=0;for(let x=1;x<right;x++)if(dark(x,y))n++;if(n>right*.8)bottom=y;}
 if(bottom===null)return null;
 const cols=[];
 for(let x=2;x<right-2;x++){let n=0;for(let y=22;y<bottom-10;y++){const i=(y*w+x)*4;if(p[i+1]>55&&p[i]<110&&p[i+2]<110||p[i]>145&&p[i+1]<110&&p[i+2]<110)n++;}if(n)cols.push(x);}
 const centers=groups(cols).map(g=>Math.round((g[0]+g.at(-1))/2)),counts=new Map();
 for(let i=1;i<centers.length;i++){const n=centers[i]-centers[i-1];if(n>=2&&n<=12)counts.set(n,(counts.get(n)||0)+1);}
 const step=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];if(!step||centers.length<40)return null;
 const first=centers[0];let last=centers.at(-1);
 for(let x=last;x<Math.min(right-2,last+step*6);x+=step){let n=0;for(let y=22;y<bottom-10;y++)if(dark(x,y))n++;if(n>=2)last=x;}
 const ticks=[];
 for(let x=2;x<=last;x++){let n=0;for(let y=bottom;y<Math.min(h,bottom+6);y++)if(dark(x,y))n++;if(n>=4)ticks.push(x);}
 const positions=groups(ticks).map(g=>g[0]);
 if(positions.length!==timeAxisTimestamps.length)return null;
 const anchors=positions.map((x,i)=>({x,timestamp:timeAxisTimestamps[i]})).filter(a=>/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(a.timestamp||''));
 if((last-first)%step!==0)return null;
 return resolveAxisTimestamp({anchors,lastCandleX:last,candleStep:step,timeframe,tradesOnWeekends});
}
