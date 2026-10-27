// Decides where a user's monthly review count starts.
//
// Starter (and beta overrides) count from the 1st of the calendar month. A paid plan counts from the
// day its current billing period began, so someone who upgrades on the 27th sees "0 of 40", not the
// reviews they used on Starter earlier in the month, and the count starts again at each renewal.
// Returns an ISO timestamp, or null to use the calendar month.

const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);
const MAX_PERIOD_AGE_MS = 40 * 86400000;

export function usagePeriodStart({ basePlan = "starter", subscriptionStatus = "", currentPeriodStart = null, now = Date.now() } = {}) {
  if (basePlan === "starter") return null;
  if (!PAID_STATUSES.has(String(subscriptionStatus || "").toLowerCase())) return null;
  const start = Date.parse(currentPeriodStart || "");
  if (!Number.isFinite(start)) return null;
  // A start in the future or far in the past means the profile row is stale: fall back to the month.
  if (start > now + 60000 || now - start > MAX_PERIOD_AGE_MS) return null;
  return new Date(start).toISOString();
}
