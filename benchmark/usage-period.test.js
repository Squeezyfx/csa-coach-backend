import test from "node:test";
import assert from "node:assert/strict";
import { usagePeriodStart } from "../usage-period.js";

const now = Date.parse("2026-10-27T18:00:00Z");

test("starter counts from the calendar month", () => {
  assert.equal(usagePeriodStart({ basePlan: "starter", subscriptionStatus: "active", currentPeriodStart: "2026-10-27T17:57:00Z", now }), null);
});

test("a paid plan counts from the start of its billing period", () => {
  assert.equal(
    usagePeriodStart({ basePlan: "pro", subscriptionStatus: "active", currentPeriodStart: "2026-10-27T17:57:00Z", now }),
    "2026-10-27T17:57:00.000Z"
  );
  assert.equal(
    usagePeriodStart({ basePlan: "elite", subscriptionStatus: "trialing", currentPeriodStart: "2026-10-10T00:00:00Z", now }),
    "2026-10-10T00:00:00.000Z"
  );
});

test("a past-due plan in its grace window keeps its period", () => {
  assert.equal(
    usagePeriodStart({ basePlan: "pro", subscriptionStatus: "past_due", currentPeriodStart: "2026-10-25T00:00:00Z", now }),
    "2026-10-25T00:00:00.000Z"
  );
});

test("falls back to the month when the period is missing, stale or in the future", () => {
  const base = { basePlan: "pro", subscriptionStatus: "active", now };
  assert.equal(usagePeriodStart({ ...base, currentPeriodStart: null }), null);
  assert.equal(usagePeriodStart({ ...base, currentPeriodStart: "not a date" }), null);
  assert.equal(usagePeriodStart({ ...base, currentPeriodStart: "2026-08-01T00:00:00Z" }), null);
  assert.equal(usagePeriodStart({ ...base, currentPeriodStart: "2026-11-27T00:00:00Z" }), null);
});

test("an ended subscription uses the month", () => {
  assert.equal(usagePeriodStart({ basePlan: "pro", subscriptionStatus: "canceled", currentPeriodStart: "2026-10-20T00:00:00Z", now }), null);
});
