import test from "node:test";
import assert from "node:assert/strict";
import { createAnalysisSlots } from "../analysis-slots.js";

test("runs up to the limit at once and queues the rest in order", async () => {
  const slots = createAnalysisSlots({ max: 2, maxWaitMs: 1000 });
  const r1 = await slots.acquire();
  const r2 = await slots.acquire();
  assert.deepEqual(slots.stats(), { active: 2, waiting: 0, max: 2 });

  const order = [];
  const third = slots.acquire().then((release) => { order.push("third"); return release; });
  const fourth = slots.acquire().then((release) => { order.push("fourth"); return release; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(slots.stats().waiting, 2);
  assert.deepEqual(order, []);

  r1();
  const r3 = await third;
  assert.deepEqual(order, ["third"]);
  r2();
  const r4 = await fourth;
  assert.deepEqual(order, ["third", "fourth"]);
  r3();
  r4();
  assert.equal(slots.stats().active, 0);
});

test("releasing twice does not free a second slot", async () => {
  const slots = createAnalysisSlots({ max: 1, maxWaitMs: 1000 });
  const release = await slots.acquire();
  release();
  release();
  assert.equal(slots.stats().active, 0);
  const again = await slots.acquire();
  assert.equal(slots.stats().active, 1);
  again();
});

test("a request that waits too long is told the server is busy", async () => {
  const slots = createAnalysisSlots({ max: 1, maxWaitMs: 30 });
  const release = await slots.acquire();
  await assert.rejects(slots.acquire(), (error) => error?.busy === true);
  assert.equal(slots.stats().waiting, 0);
  release();
  const later = await slots.acquire();
  later();
});

test("a higher priority waits less: it goes ahead of lower ones, equal priorities keep their order", async () => {
  const slots = createAnalysisSlots({ max: 1, maxWaitMs: 1000 });
  const first = await slots.acquire();
  const order = [];
  const take = (label, priority) => slots.acquire({ priority }).then((release) => { order.push(label); return release; });
  const starter = take("starter", 0);
  const pro = take("pro", 1);
  const elite1 = take("elite1", 2);
  const elite2 = take("elite2", 2);
  const starter2 = take("starter2", 0);
  first();
  for (const pending of [elite1, elite2, pro, starter, starter2]) (await pending)();
  assert.deepEqual(order, ["elite1", "elite2", "pro", "starter", "starter2"]);
});

test("the middleware only looks up a priority when the request would have to wait", async () => {
  const slots = createAnalysisSlots({ max: 1, maxWaitMs: 1000 });
  let lookups = 0;
  const middleware = slots.middleware(() => {}, { priorityFor: async () => { lookups += 1; return 2; } });
  const fakeRes = () => ({ on() {} });
  await new Promise((resolve) => middleware({}, fakeRes(), resolve)); // quiet server: no lookup
  assert.equal(lookups, 0);
  assert.equal(slots.stats().active, 1);
  const waiting = new Promise((resolve) => middleware({}, fakeRes(), resolve)); // busy: looks up
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(lookups, 1);
  assert.equal(slots.stats().waiting, 1);
  void waiting;
});

test("a failing priority lookup falls back to normal priority and still queues", async () => {
  const slots = createAnalysisSlots({ max: 1, maxWaitMs: 1000 });
  const release = await slots.acquire();
  const middleware = slots.middleware(() => {}, { priorityFor: async () => { throw new Error("db down"); } });
  void new Promise((resolve) => middleware({}, { on() {} }, resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(slots.stats().waiting, 1);
  release();
});
