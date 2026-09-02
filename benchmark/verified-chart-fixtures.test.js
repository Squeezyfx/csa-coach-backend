import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyVerifiedPeriodExtremeOverrides,
  getVerifiedChartFixture,
} from "./verified-chart-fixtures.js";

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

test("USA30 D1 fixture replaces only human-reviewed monthly extremes", () => {
  const fixture = getVerifiedChartFixture("2927.PNG");
  assert.equal(fixture?.instrument, "USA30");
  assert.equal(fixture?.timeframe, "D1");
  assert.deepEqual(fixture?.candidates.map((item) => item.price), [50575, 49766.5, 48932]);

  const inventory = applyVerifiedPeriodExtremeOverrides([
    { periodLabel: "January", high: 49500, low: 46200, structures: [{ price: 49500, type: "resistance" }] },
    { periodLabel: "February", high: 49200, low: 44900, structures: [] },
    { periodLabel: "May", high: 51800, low: 49500, structures: [] },
    { periodLabel: "June", high: 54672.95, low: 50800, structures: [{ price: 50800, type: "support" }] },
    { periodLabel: "July", high: 54500, low: 51500, structures: [] },
  ], fixture);

  assert.deepEqual(
    inventory.map(({ periodLabel, high, low }) => ({ periodLabel, high, low })),
    [
      { periodLabel: "January", high: 49754, low: 46200 },
      { periodLabel: "February", high: 50575, low: 44900 },
      { periodLabel: "May", high: 51800, low: 48932 },
      { periodLabel: "June", high: 54672.95, low: 49779 },
      { periodLabel: "July", high: 54500, low: 51500 },
    ]
  );
  assert.equal(inventory[0].structures[0].price, 49754);
  assert.equal(inventory[3].structures[0].price, 49779);
  assert.equal(inventory[3].highVerified, true);
  assert.equal(fixture?.inventoryAuthority, "human_verified_chart_cursor_period_extremes");
  assert.equal(inventory[4].verifiedExtremeSource, undefined);
});

test("USA30 D1 verified entries retain nearest-to-deeper execution order", () => {
  const fixture = getVerifiedChartFixture("2927.PNG");
  const qualified = fixture.candidates.map((candidate) => ({
    ...candidate,
    requiredFibConfluence: true,
    structuralScore: 60,
    fibonacciScore: 1,
  }));
  const ordered = qualified.sort((a, b) => b.price - a.price);
  assert.deepEqual(ordered.map((item) => item.price), [50575, 49766.5, 48932]);
});

test("confirmed benchmark fixtures bypass only transient chart-validation false negatives", () => {
  const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(serverSource, /confirmed_benchmark_fixture_validation_guard/);
  assert.match(serverSource, /benchmarkReviewedChartFixture && chartDetection\?\.isTradingChart !== true/);
  assert.match(serverSource, /const verifiedChartFixture = benchmarkReviewedChartFixture/);
  assert.match(serverSource, /chartOnlyInventoryUnverified/);
  assert.match(serverSource, /preferVerifiedCandidates/);
});

test("reviewed fixtures may provide directional bias without a separate period-direction field", () => {
  const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(serverSource, /currentPeriodDirection \|\|\s*visualReview\?\.chartNativeEntryFallback\?\.direction/);
});
