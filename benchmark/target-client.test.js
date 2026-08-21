import test from "node:test";
import assert from "node:assert/strict";
import {
  compactResponsePreview,
  parseRetryAfterMs,
  requestJsonWithRetry,
  waitForTargetHealth,
} from "./target-client.js";

test("parses Retry-After seconds and HTTP dates", () => {
  assert.equal(parseRetryAfterMs("12"), 12000);
  assert.equal(
    parseRetryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT", Date.parse("Wed, 21 Oct 2026 07:27:50 GMT")),
    10000
  );
  assert.equal(parseRetryAfterMs("not-a-date"), null);
});

test("compacts response details without exposing an unlimited body", () => {
  assert.equal(compactResponsePreview("  Too\n many   requests  "), "Too many requests");
  assert.equal(compactResponsePreview("abcdef", 4), "abcd…");
});

test("retries HTTP 429 and honors Retry-After", async () => {
  let calls = 0;
  const waits = [];
  const result = await requestJsonWithRetry({
    makeRequest: async () => {
      calls += 1;
      if (calls === 1) {
        const response = new Response("Too many requests", {
          status: 429,
          headers: { "retry-after": "2", "content-type": "text/plain" },
        });
        return { response, text: await response.text() };
      }
      const response = new Response('{"success":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      return { response, text: await response.text() };
    },
    sleepImpl: async (ms) => waits.push(ms),
  });

  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(result.payload.success, true);
  assert.equal(result.attempts, 2);
});

test("reports useful diagnostics after a persistent non-JSON 429", async () => {
  await assert.rejects(
    requestJsonWithRetry({
      maxAttempts: 2,
      makeRequest: async () => {
        const response = new Response("Render rate limit page", {
          status: 429,
          headers: { "content-type": "text/html" },
        });
        return { response, text: await response.text() };
      },
      sleepImpl: async () => {},
    }),
    /HTTP 429, content-type text\/html.*after 2 attempts.*Render rate limit page/
  );
});

test("warm-up waits until the target health endpoint returns JSON health", async () => {
  let calls = 0;
  const waits = [];
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("Service waking", {
        status: 503,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response('{"ok":true,"service":"staging"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await waitForTargetHealth({
    targetUrl: "https://staging.example.com/",
    fetchImpl,
    sleepImpl: async (ms) => waits.push(ms),
    delayMs: 25,
  });

  assert.equal(result.attempts, 2);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(waits, [25]);
});
