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
