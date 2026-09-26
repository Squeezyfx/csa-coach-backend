// Price authority is separate from a model supplying plausible calendar labels.
export function buildNoEntryTransparencyAudit(fallback = {}) {
  // A blocked direction or missing Fib anchor must block entries, not hide
  // readable completed framework periods.  This is especially important for
  // H4: W1 can be complete and useful diagnostic evidence while W2 is still
  // in progress and therefore not entry-eligible.
  const inventory = Array.isArray(fallback.periodInventory) && fallback.periodInventory.length
    ? fallback.periodInventory
    : Array.isArray(fallback.periodDayInventory) && fallback.periodDayInventory.length
    ? fallback.periodDayInventory
    : Array.isArray(fallback?.periodMappingAudit?.periods)
    ? fallback.periodMappingAudit.periods
    : [];
  const normalized = inventory
    .map((period, index) => ({
      ...period,
      periodLabel: period?.periodLabel || period?.day || `Period ${index + 1}`,
      high: positive(period?.high) ? Number(period.high) : null,
      low: positive(period?.low) ? Number(period.low) : null,
    }))
    .filter((period) => period.high !== null && period.low !== null && period.high >= period.low);
  const completed = normalized.filter((period) =>
    period?.partialPeriod !== true && period?.periodLifecycle !== "in_progress"
  );
  const inProgress = normalized.filter((period) =>
    period?.partialPeriod === true || period?.periodLifecycle === "in_progress"
  );
  return {
    auditVersion:"1.2.0", selectionStatus:"blocked",
    inventoryAuthority:{
      selectedSource:fallback.inventoryAuthority || "unverified_period_inventory",
      completedPeriodReferences:fallback.completedPeriodReferences || null,
      periodMappingAudit:fallback.periodMappingAudit || null,
      dataMatch:fallback.dataMatch || null,
      providerFailure:fallback.providerFailure || null,
      sourceCandleAudit:fallback.marketPeriodIntegrity || null,
      marketInventoryVerified:fallback.marketInventoryVerified === true,
      chartPeriodMap:fallback.chartPeriodMap || null,
    },
    periodStructureAudit: completed.map((period) => ({
      period: period.periodLabel,
      date: period.date || null,
      sourceUnit: period.sourceUnit || null,
      high: period.high,
      highRole: period.highRole || null,
      highOriginalRole: period.highOriginalRole || null,
      highVerified: period.highVerified === true,
      low: period.low,
      lowRole: period.lowRole || null,
      lowOriginalRole: period.lowOriginalRole || null,
      lowVerified: period.lowVerified === true,
      source: period.source || fallback.inventoryAuthority || "uploaded_chart_period_inventory",
    })),
    inProgressPeriodAudit: inProgress.map((period) => ({
      period: period.periodLabel,
      date: period.date || null,
      high: period.high,
      low: period.low,
      lifecycle: "in_progress",
      structuralUse: "excluded",
      retainedFor: "current Fib frame, current price and phase only",
    })),
    candidateEvaluationAudit:[], entryDecisionAudit:[],
    fibonacciAudit:{verified:false,source:"not_available",swingHigh:null,swingLow:null,levels:null,chartPeriodMap:fallback.chartPeriodMap || null},
    provenanceConflicts:Array.isArray(fallback.inventoryPriceConflicts) ? fallback.inventoryPriceConflicts : [],
  };
}

export function isUnverifiedPeriodCandidate(candidate = {}) {
  return candidate.provenanceVerified === false ||
    /unverified|estimated_period/.test(String(candidate.priceSource || ""));
}

const positive = (value) => value !== null && value !== undefined && value !== "" &&
  Number.isFinite(Number(value)) && Number(value) > 0;

// Calendar identity is authoritative; never move a price to another month to fit it.
export function reconcilePeriodMapping({ periods = [], references = [], tolerance = 0 } = {}) {
  const referenceByDate = new Map(references.map(p => [p.date, p]));
  const counts = new Map();
  for (const p of periods) counts.set(p.date, (counts.get(p.date) || 0) + 1);
  const rejected = [];
  const mapped = periods.map(period => {
    const p = { ...period };
    const date = String(p.date || "");
    const start = new Date(`${date}T00:00:00Z`);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(start.getTime()) && start.toISOString().slice(0,10) === date;
    if (!validDate || counts.get(p.date) !== 1) {
      rejected.push({date, reason:"invalid_or_duplicate_period_date"});
      return {...p, high:null, low:null, open:null, close:null, structures:[], mappingUnverified:true};
    }
    const monthly = p.sourceUnit === "MN";
    const end = new Date(start);
    if (monthly) {
      end.setUTCMonth(end.getUTCMonth()+1);
      p.periodLabel = start.toLocaleString("en-US", {month:"long",timeZone:"UTC"});
    } else end.setUTCDate(end.getUTCDate()+(p.sourceUnit === "W1" ? 7 : 1));
    const next = end.toISOString().slice(0,10);
    const reference = referenceByDate.get(date);
    for (const extreme of ["high","low"]) {
      const evidenceDate = p[`${extreme}Date`];
      const wrongDate = monthly && start.getUTCDate() !== 1 || evidenceDate && (!/^\d{4}-\d{2}-\d{2}$/.test(evidenceDate) || evidenceDate < date || evidenceDate >= next);
      const disagrees = reference && positive(reference[extreme]) && positive(p[extreme]) && Math.abs(Number(reference[extreme])-Number(p[extreme])) > Math.max(0,Number(tolerance)||0);
      if (wrongDate || disagrees) {
        rejected.push({date, extreme, chartEstimate:p[extreme], providerReference:reference?.[extreme] ?? null,
          reason:wrongDate ? "extreme_outside_its_period" : "historical_alignment_unverified"});
        p[extreme] = null;
        p.mappingUnverified = true;
      }
    }
    if (p.mappingUnverified) { p.open=null; p.close=null; p.structures=[]; }
    return p;
  });
  return { periods:mapped, rejected, verified:false };
}

// W1's own period key (chart-period-map.js's externalKey / server.js's
// getPeriodKeyAndLabel quarterly-in-year branch) is "YYYY-Qn", not a real
// date - every other supported timeframe's period.date already is one.
// Kept separate from the real date used for endDate/owned-candle math so
// the original label still comes back out in output.periods (matching
// what chart-overlay.js and everything else already key periods by).
const QUARTER_KEY_RE = /^(\d{4})-Q([1-4])$/;
function quarterKeyStart(value) {
  const m = QUARTER_KEY_RE.exec(String(value || ""));
  return m ? new Date(Date.UTC(Number(m[1]), (Number(m[2]) - 1) * 3, 1)) : null;
}

// Used by auditPeriodInventory below, which is shared by both D1/H4/etc's
// real "YYYY-MM-DD" period dates and W1's "YYYY-Qn" quarter labels - turns a
// quarter label into its start date so ordering/cutoff/candle-ownership
// comparisons work the same way regardless of which format came in.
function normalizePeriodDateForCompare(value) {
  const raw = String(value || "").slice(0, 10);
  const m = QUARTER_KEY_RE.exec(raw);
  if (!m) return raw;
  const month = String((Number(m[2]) - 1) * 3 + 1).padStart(2, "0");
  return `${m[1]}-${month}-01`;
}

// Read-only reference inventory. This never supplies selector authority or Fib.
export function buildCompletedPeriodReferences({ periods = [], candles = [], timeframe = "D1", visibleDateFloor = "", providerAvailable = false, tolerance = 0 } = {}) {
  const output = { status: "unavailable", source: "Twelve Data", chartVerified: false,
    brokerVerified: false, entryEligible: false, visibleDateFloor, periods: [], rejected: [] };
  const floor = new Date(`${visibleDateFloor}T00:00:00Z`);
  if (!providerAvailable || !/^\d{4}-\d{2}-\d{2}$/.test(visibleDateFloor) ||
      !Number.isFinite(floor.getTime()) || floor.toISOString().slice(0,10) !== visibleDateFloor) return output;
  if (!["D1", "H4", "H1", "M30", "M15", "M5", "M1", "W1"].includes(timeframe)) return output;
  const isQuarterly = timeframe === "W1";
  const counts = new Map();
  for (const p of periods) counts.set(p.date, (counts.get(p.date) || 0) + 1);
  for (const period of periods) {
    const date = String(period.date || "");
    const start = isQuarterly ? quarterKeyStart(date) : new Date(`${date}T00:00:00Z`);
    const reject = (reason, details = {}) => output.rejected.push({ date, reason, ...details });
    const validLabel = isQuarterly
      ? start !== null
      : /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(start.getTime()) && start.toISOString().slice(0,10) === date;
    if (!validLabel || counts.get(period.date) !== 1) { reject("invalid_or_duplicate_date"); continue; }
    const end = new Date(start);
    if (timeframe === "D1") {
      if (start.getUTCDate() !== 1) { reject("not_month_start"); continue; }
      end.setUTCMonth(end.getUTCMonth() + 1);
    } else if (isQuarterly) {
      end.setUTCMonth(end.getUTCMonth() + 3);
    } else end.setUTCDate(end.getUTCDate() + (timeframe === "H4" ? 7 : 1));
    // Strictly before an actually printed date; never extrapolate a final day.
    // A period whose exclusive end is exactly the visible date is complete:
    // e.g. Tuesday ends when Wednesday begins. Only periods extending beyond
    // the visible date (the current/incomplete period) remain provisional.
    if (end > floor || period.partialPeriod === true || period.periodLifecycle === "in_progress") { reject("completion_not_established"); continue; }
    const startDate = start.toISOString().slice(0,10);
    const endDate = end.toISOString().slice(0,10);
    const owned = candles.filter(c => String(c.datetime || c.date || "").slice(0,10) >= startDate && String(c.datetime || c.date || "").slice(0,10) < endDate);
    const audit = auditPeriodInventory({periods:[period], candles:owned, tolerance, cutoffDate:visibleDateFloor});
    // Surface the actual issue, not just the generic label: "period_integrity_failed"
    // alone gave no way to tell a genuine data problem from a rounding-scale
    // near-miss (BNBUSD's 2026-08-31 week needed this to diagnose).
    if (!audit.passed) { reject("period_integrity_failed", { issues: audit.issues, periodHigh: Number(period.high), periodLow: Number(period.low), tolerance }); continue; }
    output.periods.push({ date, endDateExclusive:endDate, period:period.periodLabel || period.day || date,
      high:Number(period.high), low:Number(period.low), source:"provider_reference",
      integrityChecked:true, chartVerified:false, brokerVerified:false, entryEligible:false,
      evidence:audit.evidence[0], advisories: audit.advisories.length ? audit.advisories : undefined });
  }
  output.periods.sort((a,b) => a.date.localeCompare(b.date));
  output.status = output.periods.length ? "completed_provider_reference" : "no_completed_reference";
  return output;
}

export function auditPeriodInventory({ periods = [], candles = [], tolerance = 0, cutoffDate = "" } = {}) {
  const issues = [];
  const advisories = [];
  const seen = new Set();
  const evidence = [];
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index];
    const rawDate = String(period.date || "").slice(0, 10);
    // W1's period.date is "YYYY-Qn" (see quarterKeyStart above), not a real
    // date - normalize it to its quarter's start date for every comparison
    // below (ordering, cutoff, candle-ownership), while keeping rawDate as
    // the label surfaced in issues/evidence so it still matches the "2026-Q1"
    // key the rest of the system uses for W1 periods.
    const date = normalizePeriodDateForCompare(rawDate);
    const nextDate = normalizePeriodDateForCompare(String(periods[index + 1]?.date || "9999-12-31").slice(0, 10));
    const fail = (reason) => issues.push({ period: period.periodLabel || rawDate, date: rawDate,
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
    // `sourceIntegrityWarning` means the native provider candle for this
    // period existed but did not score well enough against the cutoff-safe
    // reconstruction to be trusted on its own (see server.js's
    // native_htf_alignment_failed_cutoff_safe_fallback) — server.js's own
    // comment there is explicit that the cutoff-safe reconstruction is kept
    // and meant to remain usable, with the warning only diagnostic. Failing
    // the whole period here contradicted that: BNBUSD's 2026-08-31 week had
    // a sound reconstruction (every other check in this loop passed) but was
    // discarded anyway on this flag alone, so it never survived into
    // completedPeriodReferences at all — not "provisional", just gone.
    // `authoritativeSourceMissing` is a different, weaker situation (no
    // provider higher-timeframe candle existed for the period at all, not
    // just one that failed reconciliation) and remains a hard failure.
    if (period.authoritativeSourceMissing === true && period.partialPeriod !== true) {
      fail("Provider period authority is incomplete or has an integrity warning");
    } else if (period.sourceIntegrityWarning === true) {
      advisories.push({ period: period.periodLabel || rawDate, date: rawDate, extreme: "period_integrity",
        requiresReview: false, advisory: true,
        resolution: "Native provider candle did not reconcile against the cutoff-safe reconstruction; using the reconstruction. Other integrity checks for this period passed." });
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
    // A period tagged calendarExactReconstruction was built by taking the
    // max/min high/low of these exact same dated candles in the first
    // place (see server.js's buildStructureLevelsFromCandles) - checking
    // whether one of them "exceeds" it is tautological when it passes, and
    // when it doesn't (confirmed for GBPCAD's August: the exported data
    // showed no violation by hand, yet this check still failed) it means
    // this function is being handed a different candle set than the one
    // that actually built the period, which is a bug in that plumbing, not
    // a real accuracy problem for this check to act on by rejecting
    // otherwise-good data.
    const escaped = period.calendarExactReconstruction !== true &&
      owned.some((candle) => Number(candle.high) > Number(period.high) + tolerance ||
        Number(candle.low) < Number(period.low) - tolerance);
    if (escaped) fail("A dated source candle exceeds the reported period range; do not certify this inventory");
    evidence.push({ date: rawDate, checkedCandleCount: owned.length,
      highCandleDate: owned.find(c => Math.abs(Number(c.high) - Number(period.high)) <= tolerance)?.datetime || null,
      lowCandleDate: owned.find(c => Math.abs(Number(c.low) - Number(period.low)) <= tolerance)?.datetime || null });
  }
  return { passed: periods.length > 0 && issues.length === 0, issues, advisories, evidence };
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
