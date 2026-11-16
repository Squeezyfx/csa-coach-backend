import test from "node:test";
import assert from "node:assert/strict";
import { aggregateH4CandlesIntoWeeklyInventory } from "../csa-entry-policy.js";
import { calendarMapping, calendarFrame } from "../framework-calendar.js";

// H4 candles Monday-Friday only (six per day), from `from` up to and including the hour `lastHour` on `to`.
function h4Candles(from, to, lastHour = 20, { weekends = false } = {}) {
  const out = [];
  let price = 1.12;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T23:59:59Z`); t += 86400000) {
    const d = new Date(t);
    const day = d.getUTCDay();
    if (!weekends && (day === 0 || day === 6)) continue;
    const date = d.toISOString().slice(0, 10);
    for (const hour of [0, 4, 8, 12, 16, 20]) {
      if (date === to && hour > lastHour) continue;
      price -= 0.0004;
      out.push({ datetime: `${date} ${String(hour).padStart(2, "0")}:00:00`, open: price + 0.0002, high: price + 0.0008, low: price - 0.0008, close: price });
    }
  }
  return out;
}

const dates = (rows) => rows.map((r) => r.date);

test("November 2026 opens on a Sunday: the week of 26 Oct belongs to October, W1 is 2 Nov", () => {
  const rows = aggregateH4CandlesIntoWeeklyInventory({
    candles: h4Candles("2026-10-26", "2026-11-16", 4),
    cutoffDate: "2026-11-16",
  });
  assert.deepEqual(dates(rows), ["2026-11-02", "2026-11-09", "2026-11-16"]);
});

test("the aggregated H4 inventory now matches the calendar's expected weeks, so the weekly frame verifies", () => {
  const rows = aggregateH4CandlesIntoWeeklyInventory({
    candles: h4Candles("2026-10-26", "2026-11-16", 4),
    cutoffDate: "2026-11-16",
  });
  const map = calendarMapping("H4", "2026-11-16");
  assert.deepEqual(map.dates, ["2026-11-02", "2026-11-09", "2026-11-16"]);
  const frame = calendarFrame({ timeframe: "H4", latestVisibleDate: "2026-11-16", periodInventory: rows });
  assert.equal(frame.periodDateSequenceVerified, true);
  assert.equal(frame.currentPeriodFrameVerified, true);
  assert.ok(Number.isFinite(frame.currentPeriodHigh) && Number.isFinite(frame.currentPeriodLow));
  assert.ok(frame.currentPeriodHigh > frame.currentPeriodLow);
});

test("the previous (completed) weeks keep their own highs and lows", () => {
  const candles = h4Candles("2026-10-26", "2026-11-16", 4);
  const rows = aggregateH4CandlesIntoWeeklyInventory({ candles, cutoffDate: "2026-11-16" });
  const week2 = candles.filter((c) => c.datetime >= "2026-11-09" && c.datetime < "2026-11-14");
  const row = rows.find((r) => r.date === "2026-11-09");
  assert.equal(row.high, Math.max(...week2.map((c) => c.high)));
  assert.equal(row.low, Math.min(...week2.map((c) => c.low)));
});

test("August 2026 opens on a Saturday: same rule, W1 is 3 Aug", () => {
  const rows = aggregateH4CandlesIntoWeeklyInventory({
    candles: h4Candles("2026-07-27", "2026-08-28"),
    cutoffDate: "2026-08-28",
  });
  assert.equal(rows[0].date, "2026-08-03");
  const frame = calendarFrame({ timeframe: "H4", latestVisibleDate: "2026-08-28", periodInventory: rows });
  assert.equal(frame.periodDateSequenceVerified, true);
});

test("months that open on a weekday keep their opening week in the previous month (unchanged)", () => {
  // September 2026 opens on a Tuesday, so its W1 is Monday 31 Aug.
  const sep = aggregateH4CandlesIntoWeeklyInventory({ candles: h4Candles("2026-08-31", "2026-09-25"), cutoffDate: "2026-09-25" });
  assert.equal(sep[0].date, "2026-08-31");
  // June 2026 opens on a Monday.
  const jun = aggregateH4CandlesIntoWeeklyInventory({ candles: h4Candles("2026-06-01", "2026-06-26"), cutoffDate: "2026-06-26" });
  assert.equal(jun[0].date, "2026-06-01");
});

test("crypto (trades weekends) is left as it was: the opening Monday is still the Monday on or before the 1st", () => {
  const rows = aggregateH4CandlesIntoWeeklyInventory({
    candles: h4Candles("2026-10-26", "2026-11-16", 4, { weekends: true }),
    cutoffDate: "2026-11-16",
    tradesOnWeekends: true,
  });
  assert.equal(rows[0].date, "2026-10-26");
});
