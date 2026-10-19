import test from "node:test";
import assert from "node:assert/strict";
import { newWeekWithoutCompletedDay } from "../framework-calendar.js";

const run = (args) => newWeekWithoutCompletedDay({ timeframe: "H1", ...args });

test("a chart ending on Sunday evening is the start of a new week", () => {
  assert.equal(run({ resolvedDate: "2026-10-18" })?.reason, "sunday_evening_open");
});

test("a chart ending on a Monday has no completed day yet", () => {
  assert.equal(run({ resolvedDate: "2026-10-19" })?.reason, "monday_no_completed_day");
});

test("a chart ending on Saturday, with the market closed, is between weeks", () => {
  assert.equal(run({ resolvedDate: "2026-10-17" })?.reason, "weekend_market_closed");
});

test("a Friday chart counts only when its final candle is from the last hours before the close", () => {
  assert.equal(run({ resolvedDate: "2026-10-16", lastVisibleTime: "20:59" })?.reason, "friday_close_market_closed");
  assert.equal(run({ resolvedDate: "2026-10-16", lastVisibleTime: "21:30" })?.reason, "friday_close_market_closed");
  assert.equal(run({ resolvedDate: "2026-10-16", lastVisibleTime: "15:00" }), null);
  assert.equal(run({ resolvedDate: "2026-10-16" }), null);
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
  assert.equal(run({ resolvedDate: "2026-10-16", selectedDate: "2026-10-17" }), null);
  assert.equal(run({ resolvedDate: "2026-10-14", selectedDate: "2026-10-19" }), null);
});
