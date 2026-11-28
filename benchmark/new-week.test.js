import test from "node:test";
import assert from "node:assert/strict";
import { newWeekWithoutCompletedDay, marketClosedForWeek } from "../framework-calendar.js";

const run = (args) => newWeekWithoutCompletedDay({ timeframe: "H1", ...args });

test("a chart ending on Sunday evening is the start of a new week", () => {
  assert.equal(run({ resolvedDate: "2026-10-18" })?.reason, "sunday_evening_open");
});

test("a chart ending on a Monday has no completed day yet", () => {
  assert.equal(run({ resolvedDate: "2026-10-19" })?.reason, "monday_no_completed_day");
});

test("a chart that ends at the weekly close is still reviewed", () => {
  assert.equal(run({ resolvedDate: "2026-10-17" }), null);
  assert.equal(run({ resolvedDate: "2026-10-16", lastVisibleTime: "21:30" }), null);
});

test("a chart that ends at the weekly close is marked as a closed market", () => {
  const closed = (args) => marketClosedForWeek({ timeframe: "H1", ...args });
  assert.equal(closed({ resolvedDate: "2026-10-17" })?.reason, "weekend_market_closed");
  assert.equal(closed({ resolvedDate: "2026-10-16", lastVisibleTime: "20:00" })?.reason, "friday_close_market_closed");
  assert.equal(closed({ resolvedDate: "2026-10-16", lastVisibleTime: "21:30" })?.reason, "friday_close_market_closed");
  assert.equal(closed({ resolvedDate: "2026-10-16", lastVisibleTime: "19:59" }), null);
  assert.equal(closed({ resolvedDate: "2026-10-16" }), null);
  assert.equal(closed({ resolvedDate: "2026-10-15", lastVisibleTime: "21:00" }), null);
  assert.equal(closed({ resolvedDate: "2026-10-17", tradesOnWeekends: true }), null);
  assert.equal(marketClosedForWeek({ timeframe: "H4", resolvedDate: "2026-10-17" }), null);
});

test("a normal weekday chart is never treated as a new week", () => {
  for (const day of ["2026-10-13", "2026-10-14", "2026-10-15"]) {
    assert.equal(run({ resolvedDate: day, lastVisibleTime: "21:00" }), null);
  }
});

test("only intraday charts and non-crypto instruments are affected", () => {
  assert.equal(newWeekWithoutCompletedDay({ timeframe: "H4", resolvedDate: "2026-10-19" }), null);
  assert.equal(newWeekWithoutCompletedDay({ timeframe: "D1", resolvedDate: "2026-10-19" }), null);
  assert.equal(run({ resolvedDate: "2026-10-19", tradesOnWeekends: true }), null);
  assert.equal(run({ resolvedDate: "not a date" }), null);
});

test("a Friday chart reviewed on the Monday after is between weeks, even with no readable time", () => {
  assert.equal(run({ resolvedDate: "2026-10-16", selectedDate: "2026-10-19" })?.reason, "chart_ends_before_selected_monday");
  assert.equal(run({ resolvedDate: "2026-10-17", selectedDate: "2026-10-19" })?.reason, "chart_ends_before_selected_monday");
  assert.equal(run({ resolvedDate: "2026-10-16", selectedDate: "2026-10-17" }), null);
  assert.equal(run({ resolvedDate: "2026-10-14", selectedDate: "2026-10-19" }), null);
});
