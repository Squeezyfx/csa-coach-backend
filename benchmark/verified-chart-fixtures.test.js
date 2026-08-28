import test from "node:test";
import assert from "node:assert/strict";
import { getVerifiedChartFixture } from "./verified-chart-fixtures.js";

test("verified benchmark fixtures preserve the reviewed USA30, USDCAD and XAUUSD inventories", () => {
  assert.deepEqual(
    getVerifiedChartFixture("2902.PNG")?.candidates.map((item) => item.price),
    [53275.6, 53421.2]
  );
  assert.deepEqual(
    getVerifiedChartFixture("2901.png")?.candidates.map((item) => item.price),
    [1.38437]
  );
  assert.deepEqual(
    getVerifiedChartFixture("2900.PNG")?.candidates.map((item) => item.price),
    [4436.15, 4428.73]
  );
  assert.equal(getVerifiedChartFixture("unseen-chart.PNG"), null);
});
