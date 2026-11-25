import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fibBandBoundaryAllowance, findNearestAllowedFibonacciMatch } from "../csa-entry-policy.js";

// USDINDEX H4, 25 Nov 2026 (bullish month): swing 101.2006 to 104.5048, band 102.4628-103.2426. Our index levels sit
// 0.05-0.19 above the broker's MT4 chart, so the broker's 102.22 / 103.32 were our 102.3448 / 103.3662, 0.118 and 0.124
// outside the band: just beyond the 0.1% cap (0.104), well inside 0.15% (0.155).
const swing = { swingHigh: 104.5048, swingLow: 101.2006, direction: "bullish" };
const range = swing.swingHigh - swing.swingLow;
const match = (price, capFraction) =>
  findNearestAllowedFibonacciMatch({
    ...swing,
    price,
    zoneLow: price,
    zoneHigh: price,
    tolerance: range * 0.01,
    boundaryTolerance: fibBandBoundaryAllowance({ impulseRange: range, price, capFraction }),
  });

test("the default 0.1% cap rejects the two near misses (as before)", () => {
  assert.equal(match(102.3448), null);
  assert.equal(match(103.3662), null);
});

test("with the index cap (0.15%) the two near misses qualify, the far levels still do not", () => {
  assert.ok(match(102.3448, 0.0015));
  assert.ok(match(103.3662, 0.0015));
  assert.equal(match(103.4343, 0.0015), null); // 0.19 above the band
  assert.equal(match(101.2006, 0.0015), null); // the swing low itself
  assert.equal(match(103.975, 0.0015), null);
});

test("the cap only ever widens the allowance, and an invalid cap falls back to 0.1%", () => {
  assert.ok(Math.abs(fibBandBoundaryAllowance({ impulseRange: range, price: 103.3662, capFraction: 0.0015 }) - 103.3662 * 0.0015) < 1e-9);
  assert.ok(Math.abs(fibBandBoundaryAllowance({ impulseRange: range, price: 103.3662 }) - 103.3662 * 0.001) < 1e-9);
  assert.ok(Math.abs(fibBandBoundaryAllowance({ impulseRange: range, price: 103.3662, capFraction: 0 }) - 103.3662 * 0.001) < 1e-9);
  // the 5% of range still bounds it when that is smaller (EURUSD week)
  assert.ok(Math.abs(fibBandBoundaryAllowance({ pipBuffer: 0.0003, impulseRange: 0.01169, price: 1.12023, capFraction: 0.0015 }) - 0.0005845) < 1e-9);
});

test("the server gives only the synthetic index the wider cap, with an off switch", () => {
  const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.match(serverSource, /INDEX_FIB_ALLOWANCE/);
  assert.match(serverSource, /isSyntheticInstrument\(symbol \|\| ""\)\s*\n\s*\? 0\.0015/);
  assert.match(serverSource, /capFraction: indexFibCap/);
});
