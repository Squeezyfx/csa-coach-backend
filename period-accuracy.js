// Price authority is separate from a model supplying plausible calendar labels.
export function isUnverifiedPeriodCandidate(candidate = {}) {
  return candidate.provenanceVerified === false ||
    /unverified|estimated_period/.test(String(candidate.priceSource || ""));
}

const positive = (value) => value !== null && value !== undefined && value !== "" &&
  Number.isFinite(Number(value)) && Number(value) > 0;

// Read-only reference inventory. This never supplies selector authority or Fib.
export function buildCompletedPeriodReferences({ periods = [], candles = [], timeframe = "D1", visibleDateFloor = "", providerAvailable = false, tolerance = 0 } = {}) {
  const output = { status: "unavailable", source: "Twelve Data", chartVerified: false,
    brokerVerified: false, entryEligible: false, visibleDateFloor, periods: [], rejected: [] };
  const floor = new Date(`${visibleDateFloor}T00:00:00Z`);
  if (!providerAvailable || !/^\d{4}-\d{2}-\d{2}$/.test(visibleDateFloor) ||
      !Number.isFinite(floor.getTime()) || floor.toISOString().slice(0,10) !== visibleDateFloor) return output;
  if (!["D1", "H4", "H1", "M30", "M15", "M5", "M1"].includes(timeframe)) return output;
  const counts = new Map();
  for (const p of periods) counts.set(p.date, (counts.get(p.date) || 0) + 1);
  for (const period of periods) {
    const date = String(period.date || "");
    const start = new Date(`${date}T00:00:00Z`);
    const reject = reason => output.rejected.push({ date, reason });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start.getTime()) || start.toISOString().slice(0,10) !== date || counts.get(period.date) !== 1) { reject("invalid_or_duplicate_date"); continue; }
    const end = new Date(start);
    if (timeframe === "D1") {
      if (start.getUTCDate() !== 1) { reject("not_month_start"); continue; }
      end.setUTCMonth(end.getUTCMonth() + 1);
    } else end.setUTCDate(end.getUTCDate() + (timeframe === "H4" ? 7 : 1));
    // Strictly before an actually printed date; never extrapolate a final day.
    if (end >= floor || period.partialPeriod === true || period.periodLifecycle === "in_progress") { reject("completion_not_established"); continue; }
    const endDate = end.toISOString().slice(0,10);
    const owned = candles.filter(c => String(c.datetime || c.date || "").slice(0,10) >= date && String(c.datetime || c.date || "").slice(0,10) < endDate);
    const audit = auditPeriodInventory({periods:[period], candles:owned, tolerance, cutoffDate:visibleDateFloor});
    if (!audit.passed) { reject("period_integrity_failed"); continue; }
    output.periods.push({ date, endDateExclusive:endDate, period:period.periodLabel || period.day || date,
      high:Number(period.high), low:Number(period.low), source:"provider_reference",
      integrityChecked:true, chartVerified:false, brokerVerified:false, entryEligible:false,
      evidence:audit.evidence[0] });
  }
  output.periods.sort((a,b) => a.date.localeCompare(b.date));
  output.status = output.periods.length ? "completed_provider_reference" : "no_completed_reference";
  return output;
}

export function auditPeriodInventory({ periods = [], candles = [], tolerance = 0, cutoffDate = "" } = {}) {
  const issues = [];
  const seen = new Set();
  const evidence = [];
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index];
    const date = String(period.date || "").slice(0, 10);
    const nextDate = String(periods[index + 1]?.date || "9999-12-31").slice(0, 10);
    const fail = (reason) => issues.push({ period: period.periodLabel || date, date,
      extreme: "period_integrity", requiresReview: true, resolution: reason });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(date) || date >= nextDate) {
      fail("Missing, duplicate or out-of-order period start date");
    }
    seen.add(date);
    if (cutoffDate && date > cutoffDate) fail("Period starts after the chart cutoff");
    if (!positive(period.high) || !positive(period.low) || Number(period.high) < Number(period.low)) {
      fail("Invalid period high/low; null and zero are not prices");
      continue;
    }
    if (period.sourceIntegrityWarning === true ||
        (period.authoritativeSourceMissing === true && period.partialPeriod !== true)) {
      fail("Provider period authority is incomplete or has an integrity warning");
    }
    for (const field of ["open", "close"]) {
      if (positive(period[field]) && (Number(period[field]) > Number(period.high) + tolerance ||
          Number(period[field]) < Number(period.low) - tolerance)) fail(`${field} lies outside its period high/low`);
    }
    // These are provider/session dates, never dates inferred from image x spacing.
    const owned = candles.filter((candle) => {
      const stamp = String(candle.datetime || candle.date || "").slice(0, 10);
      return stamp >= date && stamp < nextDate && (!cutoffDate || stamp <= cutoffDate) &&
        positive(candle.high) && positive(candle.low);
    });
    const escaped = owned.some((candle) => Number(candle.high) > Number(period.high) + tolerance ||
      Number(candle.low) < Number(period.low) - tolerance);
    if (escaped) fail("A dated source candle exceeds the reported period range; do not certify this inventory");
    evidence.push({ date, checkedCandleCount: owned.length,
      highCandleDate: owned.find(c => Math.abs(Number(c.high) - Number(period.high)) <= tolerance)?.datetime || null,
      lowCandleDate: owned.find(c => Math.abs(Number(c.low) - Number(period.low)) <= tolerance)?.datetime || null });
  }
  return { passed: periods.length > 0 && issues.length === 0, issues, evidence };
}

export function compareDatedPeriodInventories(primary = [], secondary = [], tolerance = 0) {
  const conflicts = [];
  const byDate = new Map(secondary.map(period => [String(period.date || ""), period]));
  for (const period of primary) {
    const match = byDate.get(String(period.date || ""));
    if (!match) {
      conflicts.push({ period: period.periodLabel || period.date, extreme: "date",
        resolution: "No matching period start date in provider inventory" });
      continue;
    }
    for (const extreme of ["high", "low"]) {
      if (!positive(period[extreme]) || !positive(match[extreme])) continue;
      const difference = Math.abs(Number(period[extreme]) - Number(match[extreme]));
      if (difference > tolerance) conflicts.push({ period: period.periodLabel || period.date,
        date: period.date, extreme, chartPrice: Number(period[extreme]), marketPrice: Number(match[extreme]),
        difference, tolerance, resolution: "Chart/provider disagreement requires source review" });
    }
  }
  if (primary.length !== secondary.length) conflicts.push({ period: "inventory", extreme: "count",
    chartCount: primary.length, marketCount: secondary.length, resolution: "Inventory count disagreement" });
  return conflicts;
}
