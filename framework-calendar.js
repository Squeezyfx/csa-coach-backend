/** Calendar ownership only. No instrument prices, model calls, or saved answers. */
const DAY = 86400000;
export function normalizeFrameworkTimeframe(value = "") {
  const tf = String(value).trim().toUpperCase();
  return ({ "1M":"M1","5M":"M5","15M":"M15","30M":"M30","1H":"H1","4H":"H4",
    DAILY:"D1","1D":"D1",WEEKLY:"W1","1W":"W1",MN1:"MN",MONTHLY:"MN" })[tf] || tf;
}
export function frameworkProfile(timeframe) {
  const tf = normalizeFrameworkTimeframe(timeframe);
  const mapping = {
    M1:["week","day"], M5:["week","day"], M15:["week","day"], M30:["week","day"], H1:["week","day"],
    H4:["month","week"], D1:["year","month"], W1:["year","quarter"], MN:["five_years","year"],
  }[tf];
  return mapping ? {timeframe:tf, range:mapping[0], unit:mapping[1]} : null;
}
export function parseCalendarDate(value) {
  const text=String(value || "").slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date=new Date(text+"T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===text ? date : null;
}
const iso=date=>date.toISOString().slice(0,10);
export function calendarMapping(timeframe, cutoff) {
  const profile=frameworkProfile(timeframe), date=parseCalendarDate(cutoff);
  if(!profile || !date) return null;
  const year=date.getUTCFullYear(), month=date.getUTCMonth();
  let start;
  const dates=[];
  if(profile.range==="week") {
    start=new Date(date);
    start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
    const count=Math.min(5,((date.getUTCDay()+6)%7)+1);
    for(let i=0;i<count;i++) dates.push(iso(new Date(+start+i*DAY)));
  } else if(profile.range==="month") {
    start=new Date(Date.UTC(year,month,1));
    // Include the opening partial week; its key is Monday, but candles
    // before the first of this month cannot contribute to this frame.
    const monday=new Date(start);
    monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
    for(let t=+monday;t<=+date;t+=7*DAY) {
      if (t < +start && [0,6].includes(start.getUTCDay())) continue;
      dates.push(iso(new Date(t)));
    }
  } else {
    start=new Date(Date.UTC(profile.range==="five_years"?year-4:year,0,1));
    if(profile.unit==="month") for(let m=0;m<=month;m++) dates.push(iso(new Date(Date.UTC(year,m,1))));
    if(profile.unit==="quarter") for(let m=0;m<=month;m+=3) dates.push(iso(new Date(Date.UTC(year,m,1))));
    if(profile.unit==="year") for(let y=year-4;y<=year;y++) dates.push(iso(new Date(Date.UTC(y,0,1))));
  }
  return {...profile,start:iso(start),cutoff:iso(date),dates};
}
export function calendarFrame({timeframe,latestVisibleDate,periodInventory=[]}={}) {
  const map=calendarMapping(timeframe,latestVisibleDate);
  const rows=Array.isArray(periodInventory)?periodInventory:[];
  const expectedDates=map?.dates || [], returnedDates=rows.map(x=>x?.date);
  const sequence=expectedDates.length>0 && rows.length===expectedDates.length &&
    expectedDates.every((date,i)=>date===returnedDates[i]);
  const numeric=rows.every(r=>r?.high!=null&&r?.low!=null&&Number.isFinite(Number(r.high))&&Number.isFinite(Number(r.low))&&Number(r.low)>0&&Number(r.high)>Number(r.low));
  // An opening partial W1 must explicitly describe its clipped coverage.
  const clipped=map?.timeframe!=="H4" || expectedDates[0]>=map.start ||
    rows[0]?.coverageStart===map.start;
  const complete=sequence&&numeric&&clipped;
  return {currentPeriodFrameVerified:complete,
    currentPeriodHigh:complete?Math.max(...rows.map(r=>Number(r.high))):null,
    currentPeriodLow:complete?Math.min(...rows.map(r=>Number(r.low))):null,
    expectedCount:expectedDates.length||null,returnedCount:rows.length,expectedDates,returnedDates,
    periodDateSequenceVerified:sequence,coverageVerified:clipped,
    source:complete?"complete_framework_candle_inventory":"incomplete_framework_candle_inventory"};
}
/** One bias rule for every timeframe: calendar open/close when readable,
 * otherwise range position then completed structure. Final movement only labels phase. */
export function resolveFrameworkBias({periodInventory=[],periodOpen=null,periodClose=null,currentPrice=null}={}) {
  const number=x=>x!=null&&Number.isFinite(Number(x))&&Number(x)>0?Number(x):null;
  const rows=periodInventory;
  if(!rows.length||rows.some(r=>number(r.high)===null||number(r.low)===null||Number(r.high)<=Number(r.low))) return null;
  const high=Math.max(...rows.map(r=>Number(r.high))),low=Math.min(...rows.map(r=>Number(r.low)));
  const close=number(periodClose)??number(currentPrice);
  if(close===null) return null;
  const position=(close-low)/(high-low),open=number(periodOpen)??number(rows[0].open);
  const completed=rows.filter(r=>r.partialPeriod!==true&&r.periodLifecycle!=="in_progress");
  let direction=open!==null&&close!==open ? (close>open?"bullish":"bearish") : position>=.618?"bullish":position<=.382?"bearish":null;
  let basis=direction?(open!==null&&close!==open?"calendar_open_close":"calendar_range_position"):null;
  if(!direction&&completed.length>=2) {
    const first=completed[0],last=completed.at(-1);
    direction=last.high>first.high&&last.low>first.low?"bullish":last.high<first.high&&last.low<first.low?"bearish":null;
    if(direction) basis="completed_period_structure";
  }
  if(!direction&&open!==null&&Math.abs(close-open)/(high-low)>=.08) {
    direction=close>open?"bullish":"bearish"; basis="calendar_open_close";
  }
  if(!direction) return null;
  const last=rows.at(-1),lastOpen=number(last.open),lastClose=number(last.close)??close;
  const opposite=lastOpen!==null&&(direction==="bullish"?lastClose<lastOpen:lastClose>lastOpen);
  const phase=opposite?(direction==="bullish"?"bearish_pullback_after_bullish_structure":"bullish_recovery_after_bearish_structure"):direction+"_structure";
  return {direction,phase,high,low,close,open,rangePosition:position,source:basis};
}
