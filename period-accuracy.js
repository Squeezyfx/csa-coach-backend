// Price authority is separate from a model supplying plausible calendar labels.
export function isUnverifiedPeriodCandidate(candidate = {}) {
  return candidate.provenanceVerified === false ||
    /unverified|estimated_period/.test(String(candidate.priceSource || ""));
}

const positive = (value) => value !== null && value !== undefined && value !== "" &&
  Number.isFinite(Number(value)) && Number(value) > 0;

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
