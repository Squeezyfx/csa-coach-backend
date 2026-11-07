import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveFrameworkBias } from "../framework-calendar.js";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

// GBPUSD H1, week of 2026-11-02, reviewed at Thu 5 Nov 06:00 (Africa/Lagos). Highs, lows and closes are the
// provider's daily levels from the live log. Monday's open is not in the log: 1.3440 is an assumed value below
// Monday's high. The market price at the cutoff was 1.3488; the screenshot's own last price was misread as
// 1.3349 (the hovered header's close) on the run that lost its entries.
const week = [
  { date: "2026-11-02", high: 1.34475, low: 1.33782, open: 1.344, close: 1.3406 },
  { date: "2026-11-03", high: 1.34318, low: 1.33951, close: 1.3406 },
  { date: "2026-11-04", high: 1.35023, low: 1.34055, close: 1.34664 },
  { date: "2026-11-05", high: 1.34965, low: 1.34666, close: 1.3488, partialPeriod: true },
];
const bias = (currentPrice) => resolveFrameworkBias({ periodInventory: week, periodOpen: 1.344, currentPrice });

test("at the cutoff price the week reads bullish: higher high and higher low through Wednesday", () => {
  assert.equal(bias(1.3488).direction, "bullish");
});

test("the screenshot's later or misread price can flip the same week to bearish", () => {
  assert.equal(bias(1.3349).direction, "bearish");
});

test("a review of a past moment takes its price from the market data, not the screenshot", () => {
  const start = server.indexOf("const reviewsPastMoment =");
  assert.ok(start > 0);
  const block = server.slice(start, start + 1800);
  // Only the two modes that choose a past moment; final-visible reviews keep reading the screenshot.
  assert.match(block, /normalizeCutoffMode\(marketReference\?\.chartCutoff\?\.mode \|\| "final_visible"\) !== "final_visible"/);
  assert.match(block, /marketReference\?\.ok === true/);
  assert.match(block, /extractLastMarketPrice\(marketReference\)/);
  // The market price comes first, the screenshot price is only the fallback.
  assert.match(block, /cutoffMarketPrice \?\? \(chartDetection\?\.latestVisibleClose \?\? chartDetection\?\.latestVisiblePrice\)/);
  assert.match(block, /currentPrice: frameworkCurrentPrice,/);
  assert.match(block, /currentPrice:\s*cutoffMarketPrice \|\|\s*nullablePositiveNumber\(chartDetection\?\.latestVisibleClose\)/);
});
