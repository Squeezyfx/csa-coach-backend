import test from "node:test";
import assert from "node:assert/strict";
import { setCourseAccess, ghlConfigured } from "../ghl-access.js";

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
