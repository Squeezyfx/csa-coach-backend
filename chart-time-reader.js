import {decodePng8} from './chart-raster-reader.js';
const MINUTES={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240};
const groups=xs=>{const out=[];for(const x of xs){if(!out.length||x>out.at(-1).at(-1)+1)out.push([x]);else out.at(-1).push(x);}return out;};
function advance(time,bars,minutes){for(let n=0;n<bars;n++){do{time+=minutes*60000;}while([0,6].includes(new Date(time).getUTCDay()));}return time;}
export function resolveAxisTimestamp({anchors=[],lastCandleX,candleStep,timeframe}={}){
 const minutes=MINUTES[timeframe];if(!minutes||!(candleStep>0)||anchors.length<3)return null;
 const rows=anchors.map(a=>({...a,t:Date.parse(String(a.timestamp).replace(' ','T')+'Z')}));
 if(rows.some(a=>!Number.isFinite(a.t)||!Number.isFinite(a.x)))return null;
 for(let i=1;i<rows.length;i++){
  const n=(rows[i].x-rows[i-1].x)/candleStep;
  if(!Number.isInteger(n)||n<=0||n>10000||advance(rows[i-1].t,n,minutes)!==rows[i].t)return null;
 }
 const last=rows.at(-1),n=(lastCandleX-last.x)/candleStep;
 if(!Number.isInteger(n)||n<0||n>1000)return null;
 const timestamp=new Date(advance(last.t,n,minutes)).toISOString().slice(0,19).replace('T',' ');
 return {timestamp,evidence:'verified_axis_bar_count',candlesAfterLastLabel:n,anchorCount:rows.length,candleStep,lastCandleX,anchors};
}
// Measures candle/time-axis geometry only. No price values or distances are read.
export function readMt4ForexTimestamp({imageBase64,timeframe,timeAxisTimestamps=[]}={}){
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
 return resolveAxisTimestamp({anchors,lastCandleX:last,candleStep:step,timeframe});
}
