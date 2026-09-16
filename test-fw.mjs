import { analyseFrameworkEntries, describeEntries, currentFrameBounds, buildPeriodInventory }
  from "./framework-periods.js";
import assert from "node:assert";

// Synthesise H1 candles reproducing the USOIL current week we measured.
const DAYS = {
  "2026-09-07": { h: 93.13, l: 90.92 },
  "2026-09-08": { h: 94.58, l: 91.86 },
  "2026-09-09": { h: 96.90, l: 93.75 },
};
const candles = [];
for (const [d, v] of Object.entries(DAYS))
  for (let hr = 1; hr <= 23; hr++)
    candles.push({ time: `${d}T${String(hr).padStart(2,"0")}:00:00Z`,
                   high: hr === 5 ? v.h : v.l, low: v.l });
// two earlier weeks that must be excluded by the frame
for (const d of ["2026-08-31","2026-09-01","2026-09-04"])
  for (let hr = 1; hr <= 23; hr++)
    candles.push({ time: `${d}T${String(hr).padStart(2,"0")}:00:00Z`, high: 200, low: 10 });

const a = analyseFrameworkEntries(candles, "H1", { latest: "2026-09-09", currentPrice: 96.05 });
console.log(describeEntries(a));

console.log("\n--- assertions ---");
assert.equal(a.periods.length, 3, "frame must hold only the current week");
assert.equal(a.frame.high, 96.90); assert.equal(a.frame.low, 90.92);
assert.equal(a.entries.length, 3);
assert.deepEqual(a.entries.map(e => [e.periodLabel, e.kind, e.fibName]),
  [["Tuesday","high","38.2"],["Wednesday","low","50.0"],["Monday","high","61.8"]]);
console.log("H1 USOIL week matches the measured chart: PASS");

// frame bounds: H4 month must reach back to the carry-in Monday
const b = currentFrameBounds("H4", "2026-09-15");
assert.equal(b.start.toISOString().slice(0,10), "2026-08-31");
console.log("H4 September frame opens Mon 31 Aug (carry-in week): PASS");

// D1 year frame
const y = currentFrameBounds("D1", "2026-09-15");
assert.equal(y.start.toISOString().slice(0,10), "2026-01-01");
console.log("D1 frame opens 1 Jan: PASS");

// sparse frame -> refuses rather than inventing
const mon = candles.filter(c => c.time.startsWith("2026-09-07"));
const thin = analyseFrameworkEntries(mon, "H1", { latest: "2026-09-07", currentPrice: 92 });
assert.equal(thin.frame.verified, false);
assert.equal(thin.frame.reason, "insufficient_frame_periods");
console.log("single-period frame refuses:", thin.frame.reason, "PASS");

// one entry per Fib level
const lv = a.entries.map(e => e.fibName);
assert.equal(new Set(lv).size, lv.length);
console.log("each Fib level claimed at most once: PASS");
