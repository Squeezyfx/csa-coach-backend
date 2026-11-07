// Where and when a pair has moved most over the last weeks, from the candles a review already has
// (up to its cutoff, so nothing after the chosen moment is used). Descriptive only: it says where
// price has been busy, never where it will turn. Elite shows it as "best time to watch".

const SESSIONS = [
  { key: "asia", label: "Asia", startHour: 0, endHour: 7 },
  { key: "london", label: "London", startHour: 7, endHour: 12 },
  { key: "overlap", label: "London and New York overlap", startHour: 12, endHour: 16 },
  { key: "newyork", label: "New York", startHour: 16, endHour: 21 },
  { key: "late", label: "late New York and rollover", startHour: 21, endHour: 24 },
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const INTRADAY = /^(M1|M5|M15|M30|H1)$/;
const WALL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/;
// A full FX weekday has about 23 hourly buckets; fewer means a holiday or the unfinished last day.
const COMPLETE_DAY_HOURS = 18;
const WINDOW_HOURS = 3;

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const pct = (value) => Math.round(value * 100);

// Offset of a timezone from UTC at noon UTC of that date, in ms (0 when the zone is unknown).
function offsetMsFor(dateKey, timezone, cache) {
  const key = `${dateKey}|${timezone}`;
  if (cache.has(key)) return cache.get(key);
  let offset = 0;
  try {
    const noon = Date.parse(`${dateKey}T12:00:00Z`);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      })
        .formatToParts(new Date(noon))
        .map((part) => [part.type, part.value])
    );
    offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - noon;
  } catch {
    offset = 0;
  }
  cache.set(key, offset);
  return offset;
}

const clock = (minutes) => {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
};

export function buildActivityProfile({ candles = [], timeframe = "", timezone = "UTC", minTradingDays = 15 } = {}) {
  const tf = String(timeframe || "").toUpperCase();
  if (!INTRADAY.test(tf)) {
    return { status: "not_applicable", reason: "It needs an hourly or lower chart." };
  }
  const zone = String(timezone || "UTC");
  const cache = new Map();

  // Candles to hourly buckets in UTC, weekdays only.
  const buckets = new Map();
  for (const candle of Array.isArray(candles) ? candles : []) {
    const match = WALL.exec(String(candle?.datetime || ""));
    const high = Number(candle?.high);
    const low = Number(candle?.low);
    if (!match || !Number.isFinite(high) || !Number.isFinite(low) || high < low) continue;
    const dateKey = `${match[1]}-${match[2]}-${match[3]}`;
    const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
    const utc = new Date(wall - offsetMsFor(dateKey, zone, cache));
    const weekday = utc.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const hour = utc.getUTCHours();
    const key = `${utc.toISOString().slice(0, 10)}|${hour}`;
    const bucket = buckets.get(key) || { date: utc.toISOString().slice(0, 10), hour, weekday, high: -Infinity, low: Infinity };
    bucket.high = Math.max(bucket.high, high);
    bucket.low = Math.min(bucket.low, low);
    buckets.set(key, bucket);
  }
  const stamp = (b) => `${b.date} ${String(b.hour).padStart(2, "0")}`;
  const hours = [...buckets.values()].map((b) => ({ ...b, range: b.high - b.low })).sort((a, b) => (stamp(a) < stamp(b) ? -1 : 1));
  if (!hours.length) return { status: "unavailable", reason: "There are no recent candles to measure." };

  // Days: only full days count for the weekday comparison.
  const byDate = new Map();
  for (const h of hours) {
    const day = byDate.get(h.date) || { date: h.date, weekday: h.weekday, high: -Infinity, low: Infinity, count: 0 };
    day.high = Math.max(day.high, h.high);
    day.low = Math.min(day.low, h.low);
    day.count += 1;
    byDate.set(h.date, day);
  }
  const fullDays = [...byDate.values()].filter((day) => day.count >= COMPLETE_DAY_HOURS).map((day) => ({ ...day, range: day.high - day.low }));
  if (fullDays.length < minTradingDays) {
    return { status: "unavailable", reason: `Only ${fullDays.length} full trading days of history are available (at least ${minTradingDays} are needed).` };
  }

  const dayAverage = mean(fullDays.map((day) => day.range));
  const days = [1, 2, 3, 4, 5]
    .map((weekday) => {
      const rows = fullDays.filter((day) => day.weekday === weekday);
      return { weekday, name: WEEKDAYS[weekday], count: rows.length, average: mean(rows.map((row) => row.range)) };
    })
    .filter((day) => day.count >= 3)
    .map((day) => ({ ...day, versusAverage: dayAverage > 0 ? day.average / dayAverage - 1 : 0 }));
  if (days.length < 3) return { status: "unavailable", reason: "Not enough days of each weekday to compare." };

  const hourAverage = mean(hours.map((h) => h.range));
  const totalRange = hours.reduce((sum, h) => sum + h.range, 0);
  const sessions = SESSIONS.map((session) => {
    const rows = hours.filter((h) => h.hour >= session.startHour && h.hour < session.endHour);
    return {
      ...session,
      share: totalRange > 0 ? rows.reduce((sum, h) => sum + h.range, 0) / totalRange : 0,
      intensity: hourAverage > 0 ? mean(rows.map((h) => h.range)) / hourAverage : 0,
    };
  });

  const averageByHour = Array.from({ length: 24 }, (_, hour) => mean(hours.filter((h) => h.hour === hour).map((h) => h.range)));
  let bestStart = 0;
  let bestAverage = -1;
  for (let start = 0; start < 24; start += 1) {
    const value = mean(Array.from({ length: WINDOW_HOURS }, (_, i) => averageByHour[(start + i) % 24]));
    if (value > bestAverage) {
      bestAverage = value;
      bestStart = start;
    }
  }

  // Where the review's own moment sits, and the display offset for the last date.
  const last = hours[hours.length - 1];
  const offsetMinutes = offsetMsFor(last.date, zone, cache) / 60000;
  const lastSession = SESSIONS.find((session) => last.hour >= session.startHour && last.hour < session.endHour) || SESSIONS[0];
  const lastIntensity = sessions.find((session) => session.key === lastSession.key)?.intensity || 0;
  const hoursToWindow = (bestStart - last.hour + 24) % 24;

  return {
    status: "ok",
    timeframe: tf,
    timezone: zone,
    tradingDays: fullDays.length,
    from: fullDays[0].date,
    to: fullDays[fullDays.length - 1].date,
    days: days.sort((a, b) => b.versusAverage - a.versusAverage),
    sessions,
    bestWindow: {
      startUtc: bestStart,
      endUtc: (bestStart + WINDOW_HOURS) % 24,
      start: clock(bestStart * 60 + offsetMinutes),
      end: clock((bestStart + WINDOW_HOURS) * 60 + offsetMinutes),
      intensity: hourAverage > 0 ? bestAverage / hourAverage : 0,
    },
    reviewMoment: {
      time: clock(last.hour * 60 + offsetMinutes),
      weekday: WEEKDAYS[last.weekday],
      session: lastSession.label,
      intensity: lastIntensity,
      hoursToBestWindow: hoursToWindow,
    },
  };
}

const sign = (value) => (value >= 0 ? `${pct(value)}% above` : `${pct(-value)}% below`);

// The Elite lines: plain words, with the limits said out loud.
export function describeActivityProfile(profile, { symbol = "this pair" } = {}) {
  if (!profile || profile.status !== "ok") {
    const reason = profile?.reason ? ` ${profile.reason}` : "";
    return [`- Not available for this chart.${reason}`];
  }
  const [busiest, second] = profile.days;
  const quietest = profile.days[profile.days.length - 1];
  const lines = [];
  lines.push(
    `- Busiest days for ${symbol} (last ${profile.tradingDays} trading days): ${busiest.name} (${sign(busiest.versusAverage)} an average day)${
      second && second.versusAverage > 0.02 ? ` and ${second.name} (${sign(second.versusAverage)})` : ""
    }. Quietest: ${quietest.name} (${sign(quietest.versusAverage)}).`
  );
  const best = profile.bestWindow;
  lines.push(
    `- Busiest hours: ${best.start} to ${best.end} your time (${profile.timezone}), about ${best.intensity.toFixed(1)} times the average hour.`
  );
  lines.push(
    `- Share of a day's movement by session: ${profile.sessions.map((session) => `${session.label} ${pct(session.share)}%`).join(", ")} (times are approximate and based on UTC).`
  );
  const moment = profile.reviewMoment;
  lines.push(
    moment.hoursToBestWindow === 0
      ? `- This review is set at ${moment.weekday} ${moment.time}, inside the busiest hours.`
      : `- This review is set at ${moment.weekday} ${moment.time} (${moment.session}, ${moment.intensity.toFixed(1)} times the average hour). The busiest hours start in about ${moment.hoursToBestWindow} hour${moment.hoursToBestWindow === 1 ? "" : "s"}.`
  );
  lines.push("- This shows where price has moved most recently. It does not say where it will turn, and it is not a signal.");
  return lines;
}
