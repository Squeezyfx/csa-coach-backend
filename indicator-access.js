// Rules for the bonus MT4/MT5 indicator licence: who may register trading
// accounts, how many, and when one may be removed again. Pure functions, so the
// rules can be tested without a database.

export const INDICATOR_ACCOUNT_LIMITS = { pro: 1, elite: 3 };
export const INDICATOR_REMOVE_AFTER_DAYS = 30;

const DAY_MS = 86400000;

// Pro and Elite keep the indicator while the subscription is paid, including
// the short grace window after a failed renewal. Starter and beta testers do not.
export function indicatorLimitFor(entitlement = {}) {
  const plan = String(entitlement.basePlan || "").toLowerCase();
  const limit = INDICATOR_ACCOUNT_LIMITS[plan] || 0;
  if (!limit) return 0;
  const status = String(entitlement.subscriptionStatus || "").toLowerCase();
  const paid = status === "active" || status === "trialing";
  const inGrace = status === "past_due" && Boolean(entitlement.paymentGraceEndsAt);
  return paid || inGrace ? limit : 0;
}

// Trading account numbers are plain digits. Returns the cleaned number, or null.
export function normalizeAccountNumber(value) {
  const digits = String(value ?? "").replace(/[\s-]/g, "");
  if (!/^\d{4,12}$/.test(digits)) return null;
  return digits.replace(/^0+(?=\d)/, "");
}

export function normalizePlatform(value) {
  const platform = String(value ?? "").trim().toLowerCase();
  return platform === "mt4" || platform === "mt5" ? platform : null;
}

export function cleanBroker(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

// An account can be removed once it has been registered for 30 days, so one
// subscription cannot be passed from account to account every few days.
export function removalAllowedAt(createdAt) {
  const created = Date.parse(createdAt || "");
  if (!Number.isFinite(created)) return null;
  return new Date(created + INDICATOR_REMOVE_AFTER_DAYS * DAY_MS).toISOString();
}

export function canRemove(createdAt, now = Date.now()) {
  const allowed = removalAllowedAt(createdAt);
  return allowed ? Date.parse(allowed) <= now : false;
}

// What the page shows for one registered account.
export function describeAccount(row, entitlement, now = Date.now()) {
  return {
    id: row.id,
    accountNumber: row.account_number,
    platform: row.platform,
    broker: row.broker || "",
    status: row.status === "active" ? "active" : "pending",
    createdAt: row.created_at,
    canRemove: canRemove(row.created_at, now),
    removableFrom: removalAllowedAt(row.created_at),
    activeUntil: row.status === "active" ? entitlement?.currentPeriodEnd || null : null,
  };
}
