import test from "node:test";
import assert from "node:assert/strict";
import {
  indicatorLimitFor,
  normalizeAccountNumber,
  normalizePlatform,
  canRemove,
  removalAllowedAt,
  describeAccount,
} from "../indicator-access.js";

test("Pro gets one account and Elite three while the subscription is paid", () => {
  assert.equal(indicatorLimitFor({ basePlan: "pro", subscriptionStatus: "active" }), 1);
  assert.equal(indicatorLimitFor({ basePlan: "elite", subscriptionStatus: "active" }), 3);
  assert.equal(indicatorLimitFor({ basePlan: "elite", subscriptionStatus: "trialing" }), 3);
});

test("Starter, beta-only and cancelled users get none", () => {
  assert.equal(indicatorLimitFor({ basePlan: "starter", subscriptionStatus: "active" }), 0);
  assert.equal(indicatorLimitFor({ basePlan: "starter", subscriptionStatus: "active", isBetaTester: true }), 0);
  assert.equal(indicatorLimitFor({ basePlan: "pro", subscriptionStatus: "cancelled" }), 0);
  assert.equal(indicatorLimitFor({}), 0);
});

test("a failed payment keeps the indicator only during the grace window", () => {
  assert.equal(indicatorLimitFor({ basePlan: "pro", subscriptionStatus: "past_due", paymentGraceEndsAt: "2026-10-18T00:00:00Z" }), 1);
  assert.equal(indicatorLimitFor({ basePlan: "pro", subscriptionStatus: "past_due", paymentGraceEndsAt: null }), 0);
});

test("account numbers are cleaned and validated", () => {
  assert.equal(normalizeAccountNumber(" 12 345-678 "), "12345678");
  assert.equal(normalizeAccountNumber("007654321"), "7654321");
  assert.equal(normalizeAccountNumber("abc123"), null);
  assert.equal(normalizeAccountNumber("123"), null);
  assert.equal(normalizeAccountNumber("1234567890123"), null);
  assert.equal(normalizeAccountNumber(""), null);
});

test("platform must be MT4 or MT5", () => {
  assert.equal(normalizePlatform("MT5"), "mt5");
  assert.equal(normalizePlatform(" mt4 "), "mt4");
  assert.equal(normalizePlatform("tradingview"), null);
});

test("an account can be removed only after 30 days", () => {
  const now = Date.parse("2026-11-20T00:00:00Z");
  assert.equal(canRemove("2026-10-15T00:00:00Z", now), true);
  assert.equal(canRemove("2026-11-01T00:00:00Z", now), false);
  assert.equal(removalAllowedAt("2026-11-01T00:00:00Z"), "2026-12-01T00:00:00.000Z");
  assert.equal(canRemove("not a date", now), false);
});

test("an account shows its end date only once it is active", () => {
  const ent = { currentPeriodEnd: "2026-11-14T00:00:00Z" };
  const pending = describeAccount({ id: "a", account_number: "123456", platform: "mt4", status: "pending", created_at: "2026-10-14T00:00:00Z" }, ent);
  const active = describeAccount({ id: "b", account_number: "123456", platform: "mt4", status: "active", created_at: "2026-10-14T00:00:00Z" }, ent);
  assert.equal(pending.status, "pending");
  assert.equal(pending.activeUntil, null);
  assert.equal(active.activeUntil, "2026-11-14T00:00:00Z");
});
