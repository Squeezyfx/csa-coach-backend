import { calendarMapping, calendarFrame, resolveFrameworkBias } from "./framework-calendar.js";
import { findNearestAllowedFibonacciMatch, selectIndependentEntryAreas } from "./csa-entry-policy.js";

/** Adapters supply evidence; the engine never upgrades an estimate to verified. */
export function analyzeFramework({timeframe,cutoff,periodInventory=[],currentPrice,periodOpen,
  authority="estimate",calendarMappingVerified=false}={}) {
  const mapping=calendarMapping(timeframe,cutoff);
  const frame=calendarFrame({timeframe,latestVisibleDate:cutoff,periodInventory});
  const complete=frame.currentPeriodFrameVerified;
  const verified=complete&&calendarMappingVerified&&["chart_verified","provider_aligned"].includes(authority);
  const markedInventory=periodInventory.map(p=>({...p,partialPeriod:p.partialPeriod===true||p.date===mapping?.dates.at(-1)}));
  const bias=complete?resolveFrameworkBias({periodInventory:markedInventory,periodOpen,currentPrice}):null;
  const currentKey=mapping?.dates.at(-1);
  const completedPeriods=periodInventory.filter(p=>p.date!==currentKey&&p.partialPeriod!==true&&p.periodLifecycle!=="in_progress");
  return {version:"1.0.0",mapping,frame,bias,completedPeriods,
    authority,brokerVerified:false,priceVerified:verified,
    status:!complete||!bias?"blocked":verified?"verified":"provisional",
    reasons:[...(!mapping?["unsupported_timeframe_or_invalid_cutoff"]:[]),
      ...(!complete?["incomplete_calendar_inventory"]:[]),
      ...(!bias?["direction_unresolved"]:[]),...(!verified?["price_or_calendar_evidence_unverified"]:[])]};
}

/** Shared structural/Fibonacci gate: used by all timeframe adapters. */
export function evaluateFrameworkCandidate({candidate={},direction,currentPrice,swingHigh,swingLow,
  tolerance=0,boundaryTolerance=null,frameUsable=false,structuralEvidenceValid=false}={}) {
  const price=candidate.price==null?NaN:Number(candidate.price);
  const type=String(candidate.areaType||"").toLowerCase().trim();
  const allowed=direction==="bullish"?["support","demand","converted support"]:
    direction==="bearish"?["resistance","supply","converted resistance"]:[];
  const zoneLow=Number(candidate.zoneLow)>0?Number(candidate.zoneLow):price;
  const zoneHigh=Number(candidate.zoneHigh)>0?Number(candidate.zoneHigh):price;
  const fibMatch=findNearestAllowedFibonacciMatch({direction,swingHigh,swingLow,price,
    zoneLow:Math.min(zoneLow,zoneHigh),zoneHigh:Math.max(zoneLow,zoneHigh),tolerance,boundaryTolerance});
  const side=Number.isFinite(price)&&(direction==="bullish"?
    price<currentPrice||(candidate.reclaimRequired===true&&type==="support"):direction==="bearish"&&price>currentPrice);
  const rejectionReasons=[];
  if(!allowed.includes(type)) rejectionReasons.push("structural role conflicts with bias");
  if(!side) rejectionReasons.push("level is on the wrong side of current price");
  if(!fibMatch) rejectionReasons.push("outside the 38.2%-61.8% retracement band");
  if(!structuralEvidenceValid) rejectionReasons.push("missing independent structural provenance");
  if(!frameUsable) rejectionReasons.push("fixed-period Fibonacci frame is unavailable");
  if(candidate.partialPeriod===true||candidate.periodLifecycle==="in_progress") rejectionReasons.push("current period cannot supply an entry");
  return {qualified:rejectionReasons.length===0,rejectionReasons,fibMatch};
}
export function selectFrameworkEntries(candidates,direction) {
  return selectIndependentEntryAreas(candidates,direction);
}
