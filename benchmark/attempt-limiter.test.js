import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ATTEMPT_LIMITS,
  attemptLimitsFromEnv,
  createAttemptLimiter,
  exemptEmailsFromEnv,
} from "../attempt-limiter.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function clock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (ms) => { time += ms; } };
}

test("a user under every limit is allowed", () => {
  const limiter = createAttemptLimiter({});
  assert.deepEqual(limiter.check({ userId: "a", plan: "pro" }), { allowed: true });
});

test("a burst of attempts is stopped, then allowed again after the window", () => {
  const t = clock();
  const limiter = createAttemptLimiter({ limits: { ...DEFAULT_ATTEMPT_LIMITS, burstMax: 3 }, now: t.now });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(limiter.check({ userId: "a", plan: "pro" }).allowed, true);
    limiter.record("a");
    t.advance(30 * 1000);
  }
  const blocked = limiter.check({ userId: "a", plan: "pro" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "burst");
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 10 * 60);
  t.advance(10 * MINUTE);
  assert.equal(limiter.check({ userId: "a", plan: "pro" }).allowed, true);
});

test("limits are per user", () => {
  const limiter = createAttemptLimiter({ limits: { ...DEFAULT_ATTEMPT_LIMITS, burstMax: 1 } });
  limiter.record("a");
  assert.equal(limiter.check({ userId: "a" }).allowed, false);
  assert.equal(limiter.check({ userId: "b" }).allowed, true);
});

test("repeated failures are stopped on their own, whatever the burst count", () => {
  const t = clock();
  const limiter = createAttemptLimiter({ limits: { ...DEFAULT_ATTEMPT_LIMITS, failureMax: 3 }, now: t.now });
  for (let i = 0; i < 3; i += 1) {
    limiter.record("a");
    limiter.recordFailure("a");
    t.advance(11 * MINUTE);
  }
  const blocked = limiter.check({ userId: "a", plan: "elite" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "failures");
  t.advance(HOUR);
  assert.equal(limiter.check({ userId: "a", plan: "elite" }).allowed, true);
});

test("the daily ceiling depends on the plan", () => {
  const t = clock();
  const limits = { ...DEFAULT_ATTEMPT_LIMITS, burstMax: 1000, dailyMax: { starter: 2, pro: 4, elite: 6 } };
  const limiter = createAttemptLimiter({ limits, now: t.now });
  for (let i = 0; i < 4; i += 1) {
    limiter.record("a");
    t.advance(MINUTE);
  }
  assert.equal(limiter.check({ userId: "a", plan: "starter" }).reason, "daily");
  assert.equal(limiter.check({ userId: "a", plan: "pro" }).reason, "daily");
  assert.equal(limiter.check({ userId: "a", plan: "elite" }).allowed, true);
  // An unknown plan is treated as the smallest one.
  assert.equal(limiter.check({ userId: "a", plan: "mystery" }).reason, "daily");
  t.advance(24 * HOUR);
  assert.equal(limiter.check({ userId: "a", plan: "pro" }).allowed, true);
});

test("the service-wide ceiling stops everyone", () => {
  const limits = { ...DEFAULT_ATTEMPT_LIMITS, burstMax: 1000, globalDailyMax: 3 };
  const limiter = createAttemptLimiter({ limits });
  limiter.record("a");
  limiter.record("b");
  limiter.record("c");
  const blocked = limiter.check({ userId: "d", plan: "elite" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "global");
  assert.equal(blocked.errorType, "coach_capacity_reached");
});

test("messages never contain words the page treats as a plan limit or a sign-in problem", () => {
  const t = clock();
  const limits = { ...DEFAULT_ATTEMPT_LIMITS, burstMax: 1, failureMax: 1, dailyMax: { starter: 1, pro: 1, elite: 1 }, globalDailyMax: 1 };
  const reasons = new Set();
  for (const setup of ["burst", "failures", "daily", "global"]) {
    const limiter = createAttemptLimiter({
      limits: {
        ...limits,
        burstMax: setup === "burst" ? 1 : 1000,
        failureMax: setup === "failures" ? 1 : 1000,
        dailyMax: { starter: setup === "daily" ? 1 : 1000, pro: 1000, elite: 1000 },
        globalDailyMax: setup === "global" ? 1 : 1000,
      },
      now: t.now,
    });
    limiter.record("a");
    limiter.recordFailure("a");
    const verdict = limiter.check({ userId: "a", plan: "starter" });
    assert.equal(verdict.reason, setup);
    reasons.add(setup);
    const text = verdict.message.toLowerCase();
    for (const banned of ["used all", "monthly", "analysis limit", "session", "log in", "unauthorized"]) {
      assert.ok(!text.includes(banned), `${setup}: "${banned}" in "${verdict.message}"`);
    }
  }
  assert.equal(reasons.size, 4);
});

test("waiting times read naturally", () => {
  const t = clock();
  const limiter = createAttemptLimiter({ limits: { ...DEFAULT_ATTEMPT_LIMITS, burstMax: 1 }, now: t.now });
  limiter.record("a");
  assert.match(limiter.check({ userId: "a" }).message, /about 10 minutes/);
  t.advance(9 * MINUTE + 30 * 1000);
  assert.match(limiter.check({ userId: "a" }).message, /about a minute/);
});

test("sweep forgets users with nothing left in any window", () => {
  const t = clock();
  const limiter = createAttemptLimiter({ now: t.now });
  limiter.record("a");
  limiter.recordFailure("a");
  assert.equal(limiter.stats().users, 1);
  t.advance(25 * HOUR);
  limiter.sweep();
  assert.deepEqual(limiter.stats(), { users: 0, globalLast24h: 0 });
});

test("limits can be set from the environment, and bad values fall back to the defaults", () => {
  const limits = attemptLimitsFromEnv({
    ATTEMPT_BURST_MAX: "5",
    ATTEMPT_BURST_MINUTES: "2",
    ATTEMPT_DAILY_PRO: "60",
    ATTEMPT_DAILY_ELITE: "abc",
    ATTEMPT_GLOBAL_DAILY_MAX: "-4",
  });
  assert.equal(limits.burstMax, 5);
  assert.equal(limits.burstWindowMs, 2 * MINUTE);
  assert.equal(limits.dailyMax.pro, 60);
  assert.equal(limits.dailyMax.elite, DEFAULT_ATTEMPT_LIMITS.dailyMax.elite);
  assert.equal(limits.dailyMax.starter, DEFAULT_ATTEMPT_LIMITS.dailyMax.starter);
  assert.equal(limits.globalDailyMax, DEFAULT_ATTEMPT_LIMITS.globalDailyMax);
  assert.deepEqual(attemptLimitsFromEnv({}), DEFAULT_ATTEMPT_LIMITS);
});

test("exempt emails are read case-insensitively", () => {
  const exempt = exemptEmailsFromEnv({ ATTEMPT_LIMIT_EXEMPT_EMAILS: " Owner@Example.com ,, other@example.com" });
  assert.equal(exempt.has("owner@example.com"), true);
  assert.equal(exempt.has("other@example.com"), true);
  assert.equal(exempt.size, 2);
  assert.equal(exemptEmailsFromEnv({}).size, 0);
});
