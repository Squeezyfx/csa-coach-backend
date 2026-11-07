import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildActivityProfile, describeActivityProfile } from "../activity-profile.js";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

// Five weeks of hourly candles, written in Africa/Lagos wall time (UTC+1, no daylight saving). Every hour
// ranges 10 pips, the 13:00-16:00 UTC overlap ranges 40, Wednesdays run 1.5x and Mondays 0.7x. The last
// day stops at 05:00 UTC (a Thursday), so it is partial and must not count as a full day.
function candles({ stopAt = "2026-11-05T05:00:00Z", start = "2026-10-05T00:00:00Z", weekends = true } = {}) {
  const rows = [];
  const end = Date.parse(stopAt);
  for (let t = Date.parse(start); t <= end; t += 3600000) {
    const utc = new Date(t);
    const day = utc.getUTCDay();
    if (!weekends && (day === 0 || day === 6)) continue;
    const hour = utc.getUTCHours();
    const weekdayFactor = day === 3 ? 1.5 : day === 1 ? 0.7 : 1;
    const range = (hour >= 13 && hour < 16 ? 0.004 : 0.001) * weekdayFactor;
    const wall = new Date(t + 3600000).toISOString();
    rows.push({ datetime: `${wall.slice(0, 10)} ${wall.slice(11, 19)}`, open: 1.1, high: 1.1 + range, low: 1.1, close: 1.1 + range / 2 });
  }
  return rows;
}

const profile = () => buildActivityProfile({ candles: candles(), timeframe: "H1", timezone: "Africa/Lagos" });

test("the busiest and quietest weekdays come from full days only", () => {
  const result = profile();
  assert.equal(result.status, "ok");
  assert.equal(result.days[0].name, "Wednesday");
  assert.equal(result.days[result.days.length - 1].name, "Monday");
  assert.ok(result.days[0].versusAverage > 0.2);
  assert.ok(result.days[result.days.length - 1].versusAverage < -0.1);
  // Oct 5 to Nov 4 is 23 full weekdays; the partial Nov 5 does not count
  assert.equal(result.tradingDays, 23);
});

test("the busiest hours are found in UTC and shown in the user's own time", () => {
  const { bestWindow } = profile();
  assert.equal(bestWindow.startUtc, 13);
  assert.equal(bestWindow.endUtc, 16);
  assert.equal(bestWindow.start, "14:00");
  assert.equal(bestWindow.end, "17:00");
  assert.ok(bestWindow.intensity > 2);
});

test("the overlap session carries the largest share of a day's movement", () => {
  const { sessions } = profile();
  const best = [...sessions].sort((a, b) => b.share - a.share)[0];
  assert.equal(best.key, "overlap");
  const total = sessions.reduce((sum, session) => sum + session.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("the review's own moment is placed in a session and against the busiest hours", () => {
  const { reviewMoment } = profile();
  assert.equal(reviewMoment.weekday, "Thursday");
  assert.equal(reviewMoment.time, "06:00");
  assert.equal(reviewMoment.session, "Asia");
  assert.equal(reviewMoment.hoursToBestWindow, 8);
  assert.ok(reviewMoment.intensity < 1);
});

test("weekend candles are ignored", () => {
  const withWeekends = buildActivityProfile({ candles: candles({ weekends: true }), timeframe: "H1", timezone: "Africa/Lagos" });
  const without = buildActivityProfile({ candles: candles({ weekends: false }), timeframe: "H1", timezone: "Africa/Lagos" });
  assert.deepEqual(withWeekends.days, without.days);
  assert.deepEqual(withWeekends.bestWindow, without.bestWindow);
});

test("sub-hourly candles are grouped by hour, so they do not inflate the ranges", () => {
  const quarter = [];
  for (const row of candles()) {
    const wall = Date.parse(`${row.datetime.replace(" ", "T")}Z`);
    for (let i = 0; i < 4; i += 1) {
      const t = new Date(wall + i * 900000).toISOString();
      quarter.push({ ...row, datetime: `${t.slice(0, 10)} ${t.slice(11, 19)}` });
    }
  }
  const hourly = profile();
  const fine = buildActivityProfile({ candles: quarter, timeframe: "M15", timezone: "Africa/Lagos" });
  assert.equal(fine.bestWindow.startUtc, hourly.bestWindow.startUtc);
  assert.ok(Math.abs(fine.bestWindow.intensity - hourly.bestWindow.intensity) < 1e-9);
});

test("higher timeframes, a short history and no candles say so instead of guessing", () => {
  assert.equal(buildActivityProfile({ candles: candles(), timeframe: "H4" }).status, "not_applicable");
  assert.equal(buildActivityProfile({ candles: candles(), timeframe: "D1" }).status, "not_applicable");
  const short = buildActivityProfile({ candles: candles({ start: "2026-10-26T00:00:00Z" }), timeframe: "H1", timezone: "Africa/Lagos" });
  assert.equal(short.status, "unavailable");
  assert.match(short.reason, /full trading days/);
  assert.equal(buildActivityProfile({ candles: [], timeframe: "H1" }).status, "unavailable");
  assert.equal(buildActivityProfile({ candles: null, timeframe: "H1" }).status, "unavailable");
});

test("an unknown timezone falls back to UTC instead of failing", () => {
  const result = buildActivityProfile({ candles: candles(), timeframe: "H1", timezone: "Not/AZone" });
  assert.equal(result.status, "ok");
});

test("the Elite lines are plain words, name the user's time and say it is not a signal", () => {
  const lines = describeActivityProfile(profile(), { symbol: "GBPUSD" });
  const text = lines.join("\n");
  assert.match(text, /Busiest days for GBPUSD \(last 23 trading days\): Wednesday \(\d+% above an average day\)/);
  assert.match(text, /Quietest: Monday \(\d+% below\)/);
  assert.match(text, /Busiest hours: 14:00 to 17:00 your time \(Africa\/Lagos\)/);
  assert.match(text, /London and New York overlap \d+%/);
  assert.match(text, /This review is set at Thursday 06:00 \(Asia, [\d.]+ times the average hour\)\. The busiest hours start in about 8 hours\./);
  assert.match(text, /not a signal/);
  assert.match(describeActivityProfile({ status: "not_applicable", reason: "It needs an hourly or lower chart." }).join(" "), /Not available for this chart\. It needs an hourly or lower chart\./);
  assert.match(describeActivityProfile(null).join(" "), /Not available for this chart\./);
});

test("only Elite sees it: the section sits after the Elite heading and never in the Pro or Starter text", () => {
  const elite = server.indexOf("const eliteSections = [");
  const section = server.indexOf('"BEST TIME TO WATCH:"');
  const analysis = server.indexOf("const analysis =", elite);
  assert.ok(elite > 0 && section > elite && section < analysis);
  assert.equal(server.split('"BEST TIME TO WATCH:"').length - 1, 1);
  assert.match(server, /import \{ buildActivityProfile, describeActivityProfile \} from "\.\/activity-profile\.js";/);
});

test("the profile is read-only: it is built from the review's own candles and cannot break a review", () => {
  const block = server.slice(server.indexOf("activityProfile: (() => {"), server.indexOf("activityProfile: (() => {") + 600);
  assert.match(block, /marketReference\?\.impulseCandles\?\.length/);
  assert.match(block, /catch \(error\)/);
  assert.match(block, /return null;/);
});
