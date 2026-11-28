import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { weekendReviewDate, closedWeekendFriday, weekendClockRule, matchesWeekClose, staleClockCutoff } from "../chart-timezone.js";
import { marketClosedForWeek, newWeekWithoutCompletedDay } from "../framework-calendar.js";
import { fetchMarketReferenceReliably } from "../market-data-retry.js";

const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

// Saturday 28 November 2026, 14:09 UTC: the USDCAD H1 run.
const saturday = Date.UTC(2026, 10, 28, 14, 9, 19);
const sunday = Date.UTC(2026, 10, 29, 14, 9, 19);
const detection = (chartClock) => ({ latestVisibleDate: "2026-11-27", chartClock });
const rule = (extra = {}) => weekendClockRule({
  chartDetection: detection("14:08:55"), chartTimezone: "UTC", nowMs: saturday, resolvedDate: "2026-11-27", ...extra,
});

test("a weekend date means the Friday just before it", () => {
  const move = (date, nowMs = saturday) => weekendReviewDate({ date, nowMs });
  assert.equal(move("2026-11-28"), "2026-11-27");
  assert.equal(move("2026-11-29", sunday), "2026-11-27");
  assert.equal(move("2026-11-21"), "2026-11-20");
  // once the market has reopened on Sunday evening, that Sunday has candles of its own
  assert.equal(move("2026-11-29", Date.UTC(2026, 10, 29, 22, 0)), null);
  assert.equal(move("2026-11-27"), null);
  assert.equal(move(""), null);
  assert.equal(weekendReviewDate({ date: "2026-11-28", nowMs: saturday, tradesOnWeekends: true }), null);
});

test("the Friday just closed is known only while the market is shut", () => {
  assert.equal(closedWeekendFriday(saturday), "2026-11-27");
  assert.equal(closedWeekendFriday(sunday), "2026-11-27");
  assert.equal(closedWeekendFriday(Date.UTC(2026, 10, 27, 22, 30)), "2026-11-27");
  assert.equal(closedWeekendFriday(Date.UTC(2026, 10, 27, 20, 0)), null);
  assert.equal(closedWeekendFriday(Date.UTC(2026, 10, 29, 21, 30)), null);
  assert.equal(closedWeekendFriday(Date.UTC(2026, 10, 30, 10, 0)), null);
});

test("the live case: Saturday's clock is no longer put on Friday", () => {
  // the old behaviour: the clock cuts Friday off at 14:08
  const cut = staleClockCutoff({
    chartCutoff: { mode: "final_visible", source: "chart-final-visible-day-fallback", resolvedDate: "2026-11-27" },
    chartDetection: detection("14:08:55"), chartTimezone: "UTC", nowMs: saturday, staleMinutes: -10,
  });
  assert.equal(cut.endDateTime, "2026-11-27 14:08:59");
  assert.equal(rule(), "ignore");
  assert.equal(rule({ nowMs: sunday }), "ignore");
  // a chart printed one hour ahead of UTC says the same moment as 15:08
  assert.equal(rule({ chartDetection: detection("15:08:55"), chartTimezone: "UTC+1" }), "ignore");
});

test("an earlier clock is settled by the price, and other days are untouched", () => {
  assert.equal(rule({ chartDetection: detection("09:00:00") }), "check_price");
  assert.equal(rule({ resolvedDate: "2026-11-26" }), null);
  assert.equal(rule({ nowMs: Date.UTC(2026, 11, 2, 14, 9) }), null);
  assert.equal(rule({ nowMs: Date.UTC(2026, 10, 27, 23, 0), chartDetection: detection("22:59:00") }), null);
  assert.equal(rule({ tradesOnWeekends: true }), null);
  assert.equal(rule({ chartDetection: { latestVisibleDate: "2026-11-27", latestVisibleTime: "14:00", latestVisibleTimeConfidence: "high" } }), null);
});

test("the chart price matches the week's close only when it is on it", () => {
  assert.equal(matchesWeekClose({ price: 1.4247, close: 1.4249, tolerance: 0.0003 }), true);
  assert.equal(matchesWeekClose({ price: 1.4247, close: 1.4301, tolerance: 0.0003 }), false);
  assert.equal(matchesWeekClose({ price: NaN, close: 1.43, tolerance: 0.0003 }), false);
  assert.equal(matchesWeekClose({ price: 1.43, close: null, tolerance: 0.0003 }), false);
});

test("a Friday reviewed over the weekend is reviewed, with the closed-market note", () => {
  const position = { timeframe: "H1", resolvedDate: "2026-11-27", selectedDate: "2026-11-27" };
  assert.equal(newWeekWithoutCompletedDay(position), null);
  assert.equal(marketClosedForWeek({ ...position, closedNow: true })?.reason, "friday_close_market_closed");
  assert.equal(marketClosedForWeek(position), null);
  assert.equal(marketClosedForWeek({ ...position, resolvedDate: "2026-11-26", closedNow: true }), null);
});

const failed = (failureCategory = "provider_error") => ({ ok: false, failureCategory, error: "boom" });
const good = (name) => ({ ok: true, name });
const run = async (answers, options = {}) => {
  let calls = 0;
  const result = await fetchMarketReferenceReliably({
    fetchPrimary: async () => answers[Math.min(calls++, answers.length - 1)],
    sleep: async () => {}, log: () => {}, ...options,
  });
  return { result, calls };
};

test("a passing failure is tried again", async () => {
  const { result, calls } = await run([failed(), good("second")]);
  assert.equal(result.name, "second");
  assert.equal(calls, 2);
});

test("after three failures the backup provider is asked", async () => {
  const { result, calls } = await run([failed()], { fetchBackup: async () => good("backup") });
  assert.equal(result.name, "backup");
  assert.equal(calls, 3);
});

test("if the backup fails too, the first provider's failure is returned", async () => {
  const { result } = await run([failed("rate_limit")], { fetchBackup: async () => { throw new Error("down"); } });
  assert.equal(result.failureCategory, "rate_limit");
});

test("a failure that cannot pass is not repeated, and a good answer is used at once", async () => {
  for (const category of ["authentication", "symbol_unavailable", "history_unavailable", undefined]) {
    const { calls } = await run([failed(category ?? null)], { fetchBackup: async () => good("backup") });
    assert.equal(calls, 1, String(category));
  }
  assert.equal((await run([good("first")])).calls, 1);
});

test("a request that was already slow goes straight to the backup", async () => {
  let time = 0;
  const { result, calls } = await run([failed()], { now: () => (time += 20000), fetchBackup: async () => good("backup") });
  assert.equal(calls, 1);
  assert.equal(result.name, "backup");
});

test("the server uses the weekend rules and the reliable request, and records a failure", () => {
  assert.ok(serverSource.includes("weekendReviewDate({ date: selectedDateText"));
  assert.ok(serverSource.includes("weekendClockRule({"));
  assert.ok(serverSource.includes("chartCutoff.weekendClosed ="));
  assert.ok(serverSource.includes("closedNow: marketReference?.chartCutoff?.weekendClosed === true"));
  assert.equal(serverSource.split("await requestMarketReference()").length - 1, 2);
  assert.ok(serverSource.includes('"[market-data] request failed:"'));
});
