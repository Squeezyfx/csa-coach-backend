import test from "node:test";
import assert from "node:assert/strict";
import { courseTagUpdates, setCourseAccess, notifyIndicatorRequest, funnelStages, tagFunnelStage, ghlConfigured, ghlSettings } from "../ghl-access.js";

const env = { GHL_API_KEY: "token", GHL_LOCATION_ID: "loc1" };
const quiet = { warn() {} };

function fakeFetch(calls, { failOn = "" } = {}) {
  return async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null, auth: options.headers.Authorization });
    if (failOn && url.includes(failOn)) {
      return { ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) };
    }
    if (url.endsWith("/contacts/upsert")) return { ok: true, status: 200, json: async () => ({ contact: { id: "c123" } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

test("does nothing when GoHighLevel is not configured", async () => {
  const calls = [];
  const result = await setCourseAccess({ email: "a@b.com", active: true }, { env: {}, fetchImpl: fakeFetch(calls), log: quiet });
  assert.equal(result.skipped, "not_configured");
  assert.equal(calls.length, 0);
  assert.equal(ghlConfigured({}), false);
  assert.equal(ghlConfigured(env), true);
});

test("an active subscriber gets the active tag and loses the ended tag", async () => {
  const calls = [];
  const result = await setCourseAccess({ email: " Trader@Example.com ", name: "Tolu", active: true }, { env, fetchImpl: fakeFetch(calls), log: quiet });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url.endsWith("/contacts/upsert"), true);
  assert.deepEqual(calls[0].body, { locationId: "loc1", email: "trader@example.com", name: "Tolu" });
  assert.equal(calls[0].auth, "Bearer token");
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].url.endsWith("/contacts/c123/tags"), true);
  assert.deepEqual(calls[1].body, { tags: ["csa-bonus-active"] });
  assert.equal(calls[2].method, "DELETE");
  assert.deepEqual(calls[2].body, { tags: ["csa-bonus-ended"] });
});

test("an ended subscriber gets the ended tag and loses the active tag", async () => {
  const calls = [];
  await setCourseAccess({ email: "a@b.com", active: false }, { env, fetchImpl: fakeFetch(calls), log: quiet });
  assert.deepEqual(calls[1].body, { tags: ["csa-bonus-ended"] });
  assert.deepEqual(calls[2].body, { tags: ["csa-bonus-active"] });
});

test("a GoHighLevel error is reported but never thrown", async () => {
  const calls = [];
  const result = await setCourseAccess({ email: "a@b.com", active: true }, { env, fetchImpl: fakeFetch(calls, { failOn: "/contacts/upsert" }), log: quiet });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unauthorized/);
});

test("a missing email is refused", async () => {
  const result = await setCourseAccess({ email: "", active: true }, { env, fetchImpl: fakeFetch([]), log: quiet });
  assert.equal(result.ok, false);
});

test("the Elite courses use their own pair of tags", async () => {
  const calls = [];
  await setCourseAccess({ email: "a@b.com", active: true, tier: "elite" }, { env, fetchImpl: fakeFetch(calls), log: quiet });
  assert.deepEqual(calls[1].body, { tags: ["csa-elite-active"] });
  assert.deepEqual(calls[2].body, { tags: ["csa-elite-ended"] });
  const off = [];
  await setCourseAccess({ email: "a@b.com", active: false, tier: "elite" }, { env, fetchImpl: fakeFetch(off), log: quiet });
  assert.deepEqual(off[1].body, { tags: ["csa-elite-ended"] });
  assert.deepEqual(off[2].body, { tags: ["csa-elite-active"] });
});

test("the Elite tag names can be changed with settings", () => {
  const settings = ghlSettings({ ...env, GHL_TAG_ELITE_ACTIVE: "elite-on", GHL_TAG_ELITE_ENDED: "elite-off" });
  assert.equal(settings.eliteActiveTag, "elite-on");
  assert.equal(settings.eliteEndedTag, "elite-off");
  assert.equal(ghlSettings(env).eliteActiveTag, "csa-elite-active");
});

test("which tags are sent after a subscription change", () => {
  // Buying Elite: the Pro bonus and the Elite courses both go on.
  assert.deepEqual(courseTagUpdates({ bonusOn: true, newPlan: "elite", previousPlan: "starter" }), [
    { tier: "pro", active: true }, { tier: "elite", active: true },
  ]);
  // A Pro subscriber changing nothing about Elite: no Elite tags at all.
  assert.deepEqual(courseTagUpdates({ bonusOn: true, newPlan: "pro", previousPlan: "pro" }), [{ tier: "pro", active: true }]);
  // Elite -> Pro: keeps the Pro bonus, loses the Elite courses.
  assert.deepEqual(courseTagUpdates({ bonusOn: true, newPlan: "pro", previousPlan: "elite" }), [
    { tier: "pro", active: true }, { tier: "elite", active: false },
  ]);
  // Elite cancelled: both end.
  assert.deepEqual(courseTagUpdates({ subscriptionEnded: true, newPlan: "starter", previousPlan: "elite" }), [
    { tier: "pro", active: false }, { tier: "elite", active: false },
  ]);
  // Pro cancelled: only the Pro bonus ends.
  assert.deepEqual(courseTagUpdates({ subscriptionEnded: true, newPlan: "starter", previousPlan: "pro" }), [{ tier: "pro", active: false }]);
  // Payment problem (past due): nothing changes, even for Elite.
  assert.deepEqual(courseTagUpdates({ bonusOn: false, subscriptionEnded: false, newPlan: "elite", previousPlan: "elite" }), []);
});

test("an indicator request removes then adds the request tag and leaves a note", async () => {
  const calls = [];
  const result = await notifyIndicatorRequest(
    { email: " Trader@Example.com ", name: "Tolu", platform: "mt4", accountNumber: "123456", broker: "Acme FX" },
    { env, fetchImpl: fakeFetch(calls), log: quiet }
  );
  assert.equal(result.ok, true);
  assert.equal(result.tag, "csa-indicator-requested");
  assert.deepEqual(calls.map((c) => c.method), ["POST", "DELETE", "POST", "POST"]);
  assert.deepEqual(calls[1].body, { tags: ["csa-indicator-requested"] });
  assert.deepEqual(calls[2].body, { tags: ["csa-indicator-requested"] });
  assert.equal(calls[3].url.endsWith("/contacts/c123/notes"), true);
  assert.match(calls[3].body.body, /MT4 account 123456/);
  assert.match(calls[3].body.body, /Broker: Acme FX/);
});

test("an indicator request still tags the contact when the note fails", async () => {
  const calls = [];
  const result = await notifyIndicatorRequest(
    { email: "a@b.com", platform: "mt5", accountNumber: "654321" },
    { env, fetchImpl: fakeFetch(calls, { failOn: "/notes" }), log: quiet }
  );
  assert.equal(result.ok, true);
  assert.equal(calls.some((c) => c.url.endsWith("/tags") && c.method === "POST"), true);
});

test("an indicator request does nothing when GoHighLevel is not configured and never throws on errors", async () => {
  const calls = [];
  const skipped = await notifyIndicatorRequest({ email: "a@b.com" }, { env: {}, fetchImpl: fakeFetch(calls), log: quiet });
  assert.equal(skipped.skipped, "not_configured");
  assert.equal(calls.length, 0);
  const failed = await notifyIndicatorRequest({ email: "a@b.com" }, { env, fetchImpl: fakeFetch([], { failOn: "/contacts/upsert" }), log: quiet });
  assert.equal(failed.ok, false);
  const noEmail = await notifyIndicatorRequest({ email: "" }, { env, fetchImpl: fakeFetch([]), log: quiet });
  assert.equal(noEmail.ok, false);
});

test("funnel stages only apply to free accounts, at the first review and the last allowed one", () => {
  assert.deepEqual(funnelStages({ effectivePlan: "starter", analysesUsed: 1, analysesRemaining: 6 }), ["first_review"]);
  assert.deepEqual(funnelStages({ effectivePlan: "starter", analysesUsed: 4, analysesRemaining: 3 }), []);
  assert.deepEqual(funnelStages({ effectivePlan: "starter", analysesUsed: 7, analysesRemaining: 0 }), ["limit_reached"]);
  assert.deepEqual(funnelStages({ effectivePlan: "starter", analysesUsed: 1, analysesRemaining: 0 }), ["first_review", "limit_reached"]);
  assert.deepEqual(funnelStages({ effectivePlan: "pro", analysesUsed: 1, analysesRemaining: 0 }), []);
  assert.deepEqual(funnelStages({ effectivePlan: "elite", analysesUsed: 40, analysesRemaining: 0 }), []);
  assert.deepEqual(funnelStages({}), []);
});

test("a funnel stage removes then adds its tag", async () => {
  const calls = [];
  const first = await tagFunnelStage({ email: " Trader@Example.com ", name: "Tolu", stage: "first_review" }, { env, fetchImpl: fakeFetch(calls), log: quiet });
  assert.equal(first.ok, true);
  assert.equal(first.tag, "csa-first-review");
  assert.deepEqual(calls.map((c) => c.method), ["POST", "DELETE", "POST"]);
  assert.deepEqual(calls[2].body, { tags: ["csa-first-review"] });
  const more = [];
  const limit = await tagFunnelStage({ email: "a@b.com", stage: "limit_reached" }, { env, fetchImpl: fakeFetch(more), log: quiet });
  assert.equal(limit.tag, "csa-free-limit-reached");
  assert.deepEqual(more[2].body, { tags: ["csa-free-limit-reached"] });
});

test("a funnel stage does nothing when GoHighLevel is not configured and never throws", async () => {
  const calls = [];
  const skipped = await tagFunnelStage({ email: "a@b.com", stage: "first_review" }, { env: {}, fetchImpl: fakeFetch(calls), log: quiet });
  assert.equal(skipped.skipped, "not_configured");
  assert.equal(calls.length, 0);
  assert.equal((await tagFunnelStage({ email: "a@b.com", stage: "nope" }, { env, fetchImpl: fakeFetch([]), log: quiet })).ok, false);
  assert.equal((await tagFunnelStage({ email: "", stage: "first_review" }, { env, fetchImpl: fakeFetch([]), log: quiet })).ok, false);
  const failed = await tagFunnelStage({ email: "a@b.com", stage: "first_review" }, { env, fetchImpl: fakeFetch([], { failOn: "/contacts/upsert" }), log: quiet });
  assert.equal(failed.ok, false);
});
