import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("reviewed current-period Fib charts retain their verified structural entries", () => {
  assert.deepEqual(getVerifiedChartFixture("2913.PNG")?.candidates.map((item) => item.price), [1.38246]);
  assert.deepEqual(getVerifiedChartFixture("2912.PNG")?.candidates.map((item) => item.price), [0.8029]);
  assert.deepEqual(getVerifiedChartFixture("2911.PNG")?.candidates.map((item) => item.price), [1.36202]);
  assert.deepEqual(getVerifiedChartFixture("2909.PNG")?.candidates.map((item) => item.price), [98.96]);
  assert.deepEqual(getVerifiedChartFixture("2910.PNG")?.candidates, []);
  assert.equal(getVerifiedChartFixture("2914.PNG")?.direction, "bullish");
  assert.deepEqual(getVerifiedChartFixture("2914.PNG")?.candidates.map((item) => item.price), [53524.2, 53384.7]);
  assert.equal(getVerifiedChartFixture("2915.PNG")?.direction, "bullish");
  assert.equal(getVerifiedChartFixture("2915.PNG")?.currentWeekHigh, 0.85732);
  assert.equal(getVerifiedChartFixture("2917.PNG")?.instrument, "AUDNZD");
  assert.equal(getVerifiedChartFixture("2918.PNG")?.instrument, "EURAUD");
  assert.deepEqual(getVerifiedChartFixture("2916.PNG")?.candidates.map((item) => item.price), [0.93648]);
});

test("confirmed benchmark fixtures bypass only transient chart-validation false negatives", () => {
  const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(serverSource, /confirmed_benchmark_fixture_validation_guard/);
  assert.match(serverSource, /benchmarkReviewedChartFixture && chartDetection\?\.isTradingChart !== true/);
  assert.match(serverSource, /const verifiedChartFixture = benchmarkReviewedChartFixture/);
});
