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
export function calendarMapping(timeframe, cutoff, {tradesOnWeekends=false}={}) {
  const profile=frameworkProfile(timeframe), date=parseCalendarDate(cutoff);
  if(!profile || !date) return null;
  const year=date.getUTCFullYear(), month=date.getUTCMonth();
  let start;
  const dates=[];
  if(profile.range==="week") {
    start=new Date(date);
    start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
    // FX/indices/commodities trade Monday-Friday only, so the week's day
    // count is capped at 5. Crypto trades every day of the week, so its
    // weekend candles (Sat/Sun) need their own period keys too.
    const count=Math.min(tradesOnWeekends?7:5,((date.getUTCDay()+6)%7)+1);
    for(let i=0;i<count;i++) dates.push(iso(new Date(+start+i*DAY)));
  } else if(profile.range==="month") {
    start=new Date(Date.UTC(year,month,1));
    // Include the opening partial week; its key is Monday, but candles
    // before the first of this month cannot contribute to this frame.
    const monday=new Date(start);
    monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
    for(let t=+monday;t<=+date;t+=7*DAY) {
      // A month that opens on a weekend has no FX/index trading day in that week, so W1 is the next Monday. Crypto
      // trades that Sunday/Saturday, and its weekly inventory keeps the opening week (aggregateH4CandlesIntoWeeklyInventory),
      // so the calendar must expect it too or a coin chart in such a month (Nov 2026: DOT/USD) can never verify its frame.
      if (t < +start && !tradesOnWeekends && [0,6].includes(start.getUTCDay())) continue;
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
export function calendarFrame({timeframe,latestVisibleDate,periodInventory=[],tradesOnWeekends=false}={}) {
  const map=calendarMapping(timeframe,latestVisibleDate,{tradesOnWeekends});
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
  const hasMove=open!==null&&close!==open;
  // The period candle's colour decides only when the move is big enough to mean
  // something. A small open-to-close gap (under 25% of the period's range) is
  // indecisive: a recovery week that is a few pips under its open is not a
  // bearish week. In that case the completed periods' own structure decides
  // (higher high + higher low = bullish, lower high + lower low = bearish),
  // and only if that is unclear does the small open/close difference count.
  const DECISIVE_MOVE=.25;
  let direction=null,basis=null;
  if(hasMove&&Math.abs(close-open)/(high-low)>=DECISIVE_MOVE) {
    direction=close>open?"bullish":"bearish"; basis="calendar_open_close";
  } else if(!hasMove) {
    direction=position>=.618?"bullish":position<=.382?"bearish":null;
    if(direction) basis="calendar_range_position";
  }
  if(!direction&&completed.length>=2) {
    const structure=(from,to)=>to.high>from.high&&to.low>from.low?"bullish":to.high<from.high&&to.low<from.low?"bearish":null;
    direction=structure(completed[0],completed.at(-1));
    // When the latest completed period against the first is unclear (it sits inside the first one's range, or
    // around it), the latest is read against the one before it: EURUSD H1, 26 Nov 2026, Wednesday was inside
    // Monday but had a higher high and higher low than Tuesday, and the week, 1.6 pips under its open, was
    // called bearish. FLAT_WEEK_LAST_TWO=off restores the old behaviour.
    const lastTwoOn=String(globalThis.process?.env?.FLAT_WEEK_LAST_TWO||"on").trim().toLowerCase()!=="off";
    if(!direction&&completed.length>=3&&lastTwoOn) direction=structure(completed.at(-2),completed.at(-1));
    if(direction) basis="completed_period_structure";
  }
  if(!direction&&hasMove) {
    direction=close>open?"bullish":"bearish"; basis="calendar_open_close";
  }
  // A retracement past 61.8% of the completed periods' own framing swing
  // outranks the open/close and range-position heuristics above: those only
  // read the overall period candle's own open-to-close color or where price
  // sits in the range, so a deep multi-period recovery inside an overall red
  // month (open 160.109, close 157.318 on USDJPY H4) still reads "bearish"
  // by them even after price has already retraced 80%+ of the down-move.
  const retracementOverride = resolveDeepRetracementDirectionOverride({periods: rows, currentPrice: close});
  if (retracementOverride) {
    direction = retracementOverride.direction;
    basis = retracementOverride.source;
  }
  if(!direction) return null;
  const last=rows.at(-1),lastOpen=number(last.open),lastClose=number(last.close)??close;
  const opposite=lastOpen!==null&&(direction==="bullish"?lastClose<lastOpen:lastClose>lastOpen);
  const phase=opposite?(direction==="bullish"?"bearish_pullback_after_bullish_structure":"bullish_recovery_after_bearish_structure"):direction+"_structure";
  const holdLine=retracementOverride?.holdLine??null;
  return {direction,phase,high,low,close,open,rangePosition:position,source:basis,...(holdLine===null?{}:{holdLine})};
}

// A retracement past `threshold` of the completed period inventory's own
// framing swing is treated as invalidating the prior trend on its own,
// independent of any narrower signal (a specific swing-event level reclaimed
// and held, the overall period's own open/close color). Shared by
// resolveFrameworkBias above and by server.js's own direction resolution and
// entry selector, so every consumer of period-inventory-derived direction
// agrees once a deep retracement fires, instead of only some of them.
export function resolveDeepRetracementDirectionOverride(options={}) {
  return retracedSwingOverride(options)??takenOutMoveOverride(options);
}

// Re-sorted defensively by key/date rather than trusting array order:
// some callers (server.js's marketReference.dailyLevels) sort before
// passing periods in, but that is not a guaranteed contract here.
function overridePeriods(periods) {
  return (Array.isArray(periods)?periods:[])
    .map(p=>({high:Number(p?.high),low:Number(p?.low),key:String(p?.key||p?.date||""),
      done:p?.periodLifecycle!=="in_progress"&&p?.partialPeriod!==true,
      intraday:p?.intradayOrderChecked===true,order:p?.extremeOrder||null,
      highAfterLow:p?.highAfterLow??null,lowAfterHigh:p?.lowAfterHigh??null}))
    .filter(p=>Number.isFinite(p.high)&&Number.isFinite(p.low)&&p.high>p.low&&p.key)
    .sort((a,b)=>a.key.localeCompare(b.key));
}

function retracedSwingOverride({periods=[],threshold=0.618,currentPrice=null,nearShare=0.12}={}) {
  const all=overridePeriods(periods);
  const valid=all.filter(p=>p.done);
  if(valid.length<2) return null;

  let lowIndex=0,highIndex=0;
  valid.forEach((p,i)=>{
    if(p.low<valid[lowIndex].low) lowIndex=i;
    if(p.high>valid[highIndex].high) highIndex=i;
  });
  // When the chart's candles show what happened inside the days (markIntradayOrder, M1-H1 charts), the week's high
  // and low can share a day, and only what came after the second extreme counts as a retracement.
  const sameDay=lowIndex===highIndex;
  if(sameDay&&!(valid[lowIndex].intraday&&valid[lowIndex].order)) return null;
  const downFirst=sameDay?valid[lowIndex].order==="high_first":highIndex<lowIndex;

  const swingHigh=valid[highIndex].high,swingLow=valid[lowIndex].low,range=swingHigh-swingLow;
  if(!(range>0)) return null;

  // The retracement anchor (recentPeak/recentTrough) only ever looks at
  // completed periods, so it can be stale: a retracement that existed on a
  // now-past candle but has since been given back as of the live price no
  // longer describes the current structure, so the live price is checked too.
  const live=Number.isFinite(Number(currentPrice))&&Number(currentPrice)>0?Number(currentPrice):null;
  const found=(direction,retracementRatio,retracementAnchor,holdLine)=>({direction,swingHigh,swingLow,
    retracementRatio,retracementAnchor,holdLine,
    swingHighKey:valid[highIndex].key,swingLowKey:valid[lowIndex].key,
    source:"deep_retracement_past_threshold_of_framing_swing"});

  // One rule for both directions, written for the bullish case; `sign` mirrors it for the bearish one.
  const sign=downFirst?1:-1;
  const turnIndex=downFirst?lowIndex:highIndex, turn=valid[turnIndex];
  const start=downFirst?swingLow:swingHigh;
  const outer=p=>downFirst?p.high:p.low;
  const furthest=values=>downFirst?Math.max(...values):Math.min(...values);
  const reached=turn.intraday
    ?[downFirst?turn.highAfterLow:turn.lowAfterHigh,...valid.slice(turnIndex+1).map(outer)].filter(v=>Number.isFinite(v))
    :valid.slice(turnIndex).map(outer);
  if(!reached.length) return null;
  const anchor=furthest(reached);
  const retracementRatio=sign*(anchor-start)/range;
  if(retracementRatio<threshold) return null;
  const direction=downFirst?"bullish":"bearish";

  // The week's extremes on different days, with price still past 61.8% of the old move.
  const stillPast=live===null||sign*(live-start)/range>=threshold;
  if(!sameDay&&stillPast) return found(direction,retracementRatio,anchor,null);
  if(!turn.intraday) return null;
  // Price has pulled back since, or both extremes share a day: the first move is finished only when the retracement
  // went past 61.8% by more than the few pips that still count as inside the entry band (5% of the range, capped at
  // 0.1% of price). US30 H1, 26 Aug 2026: 62.5%, 4 points past the line, is the buy level, not the end of the move.
  const slack=live===null?0.05:Math.min(0.05,0.001*live/range);
  if(retracementRatio<threshold+slack) return null;
  // Then the new move holds until price gives back more than 61.8% of it (a pullback into its own retracement is
  // the entry, not the end of it). A day's high or low sitting just past that line (within 12% of the move) has to
  // break as well: GBPUSD H1, 27 Nov 2026, Wednesday's low just under the 61.8% line.
  const tip=furthest([anchor,...all.filter(p=>!p.done&&p.key>turn.key).map(outer)]);
  const move=sign*(tip-start);
  const fibLine=tip-sign*threshold*move;
  const near=valid.slice(turnIndex).flatMap(p=>[p.high,p.low])
    .filter(v=>sign*(fibLine-v)>0&&sign*(fibLine-v)<=nearShare*move);
  const holdLine=near.length?furthest(near):fibLine;
  if(live!==null&&sign*(live-holdLine)<0) return null;
  return found(direction,retracementRatio,anchor,holdLine);
}

/** A move that the next move has taken out completely (price went back past where it started) is neglected, and the
 * later move gives the bias until price recovers more than 61.8% of it. USDINDEX H1, 27 Nov 2026: Monday rose from
 * 103.64 to 104.50, Wednesday traded at 103.62, so the week is bearish. In terms of the period's own extremes: the
 * later move runs from the first of the two to the second, and there was a move the other way before it. That is
 * only known when the first extreme is not in the opening period, or the candles show the order inside that period.
 * WIPED_MOVE=off restores the old behaviour. */
function takenOutMoveOverride({periods=[],threshold=0.618,currentPrice=null,nearShare=0.12}={}) {
  if(String(globalThis.process?.env?.WIPED_MOVE||"on").trim().toLowerCase()==="off") return null;
  const rows=overridePeriods(periods);
  if(!rows.length) return null;
  let lowIndex=0,highIndex=0;
  rows.forEach((p,i)=>{
    if(p.low<rows[lowIndex].low) lowIndex=i;
    if(p.high>rows[highIndex].high) highIndex=i;
  });
  const sameDay=lowIndex===highIndex;
  if(sameDay&&!(rows[lowIndex].intraday&&rows[lowIndex].order)) return null;
  const down=sameDay?rows[lowIndex].order==="high_first":highIndex<lowIndex;
  const startIndex=down?highIndex:lowIndex, endIndex=down?lowIndex:highIndex;
  const first=rows[startIndex], turn=rows[endIndex];
  if(!(startIndex>0||(first.intraday&&first.order===(down?"low_first":"high_first")))) return null;

  // Recovery runs upward after a down move (sign 1) and downward after an up move (sign -1).
  const sign=down?1:-1;
  const swingHigh=rows[highIndex].high,swingLow=rows[lowIndex].low,range=swingHigh-swingLow;
  const end=down?swingLow:swingHigh;
  const outer=p=>down?p.high:p.low;
  const live=Number.isFinite(Number(currentPrice))&&Number(currentPrice)>0?Number(currentPrice):null;
  const after=[turn.intraday?(down?turn.highAfterLow:turn.lowAfterHigh):null,
    ...rows.slice(endIndex+1).filter(p=>p.done).map(outer)].filter(v=>v!==null&&Number.isFinite(v));
  const anchor=after.length?(down?Math.max(...after):Math.min(...after)):end;
  const retracementRatio=sign*(anchor-end)/range;
  // The same few pips past 61.8% that still count as inside the entry band (see retracedSwingOverride).
  const slack=live===null?0.05:Math.min(0.05,0.001*live/range);
  if(retracementRatio>=threshold+slack) return null;
  // A day's high or low sitting just past the 61.8% line has to break as well (the nearest one).
  const fibLine=end+sign*threshold*range;
  const near=rows.slice(startIndex+1).filter(p=>p.done).flatMap(p=>[p.high,p.low])
    .filter(v=>sign*(v-fibLine)>0&&sign*(v-fibLine)<=nearShare*range);
  const holdLine=near.length?(down?Math.min(...near):Math.max(...near)):fibLine;
  if(live!==null&&sign*(live-holdLine)>0) return null;
  return {direction:down?"bearish":"bullish",swingHigh,swingLow,retracementRatio,retracementAnchor:anchor,holdLine,
    swingHighKey:rows[highIndex].key,swingLowKey:rows[lowIndex].key,
    source:"earlier_move_taken_out_later_move_stands"};
}

/** Notes on each day of an M1-H1 week what its chart candles show: which of the day's two extremes came first, the
 * highest high after its low and the lowest low after its high. A day whose candles do not reach its high and low
 * (short history, another feed) is left as it is. NEGLECTED_MOVE=off adds nothing, which restores the old rule. */
export function markIntradayOrder({timeframe,periodInventory=[],candles=[],coverage=.04,
  enabled=String(globalThis.process?.env?.NEGLECTED_MOVE||"on").trim().toLowerCase()!=="off"}={}) {
  const rows=Array.isArray(periodInventory)?periodInventory:[];
  if(!enabled||frameworkProfile(timeframe)?.range!=="week"||!rows.length) return rows;
  const highs=rows.map(r=>Number(r?.high)).filter(Number.isFinite),lows=rows.map(r=>Number(r?.low)).filter(Number.isFinite);
  const allowance=(Math.max(...highs)-Math.min(...lows))*coverage;
  if(!(allowance>0)) return rows;
  const bars=(Array.isArray(candles)?candles:[])
    .map(c=>({time:String(c?.datetime||""),high:Number(c?.high),low:Number(c?.low)}))
    .filter(c=>c.time&&c.high>0&&c.low>0&&c.high>=c.low)
    .sort((a,b)=>a.time.localeCompare(b.time));
  return rows.map(row=>{
    const date=String(row?.date||row?.key||"").slice(0,10),high=Number(row?.high),low=Number(row?.low);
    const day=bars.filter(c=>date&&c.time.slice(0,10)===date);
    if(day.length<2) return row;
    let highAt=0,lowAt=0;
    day.forEach((c,i)=>{ if(c.high>day[highAt].high) highAt=i; if(c.low<day[lowAt].low) lowAt=i; });
    if(!(Math.abs(day[highAt].high-high)<=allowance&&Math.abs(day[lowAt].low-low)<=allowance)) return row;
    const afterLow=day.slice(lowAt+1),afterHigh=day.slice(highAt+1);
    // The gap between the candle feed and the day's own figures is carried over.
    return {...row,intradayOrderChecked:true,
      extremeOrder:highAt<lowAt?"high_first":lowAt<highAt?"low_first":null,
      highAfterLow:afterLow.length?Math.max(...afterLow.map(c=>c.high))+(high-day[highAt].high):null,
      lowAfterHigh:afterHigh.length?Math.min(...afterHigh.map(c=>c.low))+(low-day[lowAt].low):null};
  });
}

/** The start of a trading week, before any day of it has finished.
 * An intraday chart (M1-H1) that ends on the Sunday-evening open or a Monday has no finished day in
 * the new week, so neither a bias nor an entry is clear yet. The same applies to last week's chart
 * reviewed on the Monday after. Over the weekend itself the closed week is still reviewed (see
 * marketClosedForWeek). Returns { active, reason } or null. Crypto trades every day, so it never
 * applies. */
export function newWeekWithoutCompletedDay({timeframe,resolvedDate,selectedDate="",tradesOnWeekends=false}={}) {
  if(tradesOnWeekends) return null;
  const profile=frameworkProfile(timeframe);
  if(!profile||profile.range!=="week") return null;
  const resolved=parseCalendarDate(resolvedDate);
  if(!resolved) return null;
  const day=resolved.getUTCDay();
  if(day===0) return {active:true,reason:"sunday_evening_open"};
  if(day===1) return {active:true,reason:"monday_no_completed_day"};
  // A chart that stops at the end of last week while the trader is reviewing it on a Monday is
  // between weeks too.
  if(day===5||day===6) {
    const selected=parseCalendarDate(selectedDate);
    const gapDays=selected?Math.round((+selected-+resolved)/DAY):0;
    if(selected&&selected.getUTCDay()===1&&gapDays>0&&gapDays<=3) return {active:true,reason:"chart_ends_before_selected_monday"};
  }
  return null;
}

/** An intraday chart that ends when the market has closed for the week: a Saturday, or a Friday whose
 * final candle time is readable and from 20:00 UTC (the last hours before the close), or a Friday reviewed
 * over the weekend (closedNow). The review still gives the bias and areas, and says to check them again once
 * the market reopens. Returns { active, reason } or null. */
export function marketClosedForWeek({timeframe,resolvedDate,lastVisibleTime="",tradesOnWeekends=false,closedNow=false}={}) {
  if(tradesOnWeekends) return null;
  const profile=frameworkProfile(timeframe);
  if(!profile||profile.range!=="week") return null;
  const resolved=parseCalendarDate(resolvedDate);
  if(!resolved) return null;
  const day=resolved.getUTCDay();
  if(day===6) return {active:true,reason:"weekend_market_closed"};
  if(day===5&&closedNow) return {active:true,reason:"friday_close_market_closed"};
  const match=/^(\d{2}):(\d{2})/.exec(String(lastVisibleTime||"").trim());
  if(day===5&&match&&Number(match[1])>=20) return {active:true,reason:"friday_close_market_closed"};
  return null;
}
