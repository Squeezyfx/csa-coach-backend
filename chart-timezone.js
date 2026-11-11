// The timezone a chart prints beside its clock ("UTC", "UTC+1", "UTC-5:30").
export function parseChartTimezoneLabel(value) {
  const text = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const match = /^(?:UTC|GMT)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(text);
  if (!match) return null;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  if (hours > 14 || minutes > 59) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const offsetMinutes = sign * (hours * 60 + minutes);
  const label = offsetMinutes === 0
    ? "UTC"
    : `UTC${sign < 0 ? "-" : "+"}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
  return { label, offsetMinutes };
}

// "YYYY-MM-DD HH:mm:ss" read on a clock that is `fromOffsetMinutes` from UTC,
// written as the same instant on the wall clock of `timezone`.
export function wallClockInTimezone(text, fromOffsetMinutes, timezone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(text || "").trim());
  if (!match) return null;
  const instant =
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])) -
    fromOffsetMinutes * 60000;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type) => parts.find((item) => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
  } catch {
    return null;
  }
}

// A final-visible cutoff (the printed clock, or the end of the chart's last
// day) is in the chart's timezone, not the device's. A UTC chart makes UTC the
// provider timezone (so days and candles line up with the chart); any other
// printed offset keeps the device timezone and moves the cutoff to the same
// instant.
export function alignCutoffToChartTimezone({ chartCutoff, chartTimezone, deviceTimezone }) {
  const unchanged = { timezone: deviceTimezone, endDateTime: chartCutoff?.endDateTime || null, applied: false };
  const chart = parseChartTimezoneLabel(chartTimezone);
  if (!chart || chartCutoff?.mode !== "final_visible" || !["exact-visible", "day"].includes(chartCutoff?.precision)) return unchanged;
  if (chart.offsetMinutes === 0) return { ...unchanged, timezone: "UTC", applied: true, chartTimezone: chart.label };
  const moved = wallClockInTimezone(chartCutoff.endDateTime, chart.offsetMinutes, deviceTimezone);
  return moved ? { ...unchanged, endDateTime: moved, applied: true, chartTimezone: chart.label } : unchanged;
}

// The clock time (HH:MM) the screenshot was taken at. The chart's own clock, read as printed ("20:11:58
// UTC"), is preferred: the older latestVisibleTime field is a guess at the last candle's time and
// sometimes holds only the minutes and seconds of the clock ("11:58"). A clock read as printed counts as a
// confident read; the older field must be medium or high, and "00:00" there is treated as a placeholder.
export function chartClockTime(chartDetection) {
  const clock = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(chartDetection?.chartClock || "").trim());
  if (clock) return { time: `${clock[1]}:${clock[2]}`, fromClock: true };
  const time = String(chartDetection?.latestVisibleTime || "").trim();
  const confidence = String(chartDetection?.latestVisibleTimeConfidence || "").toLowerCase();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || time === "00:00" || !["high", "medium"].includes(confidence)) return null;
  return { time, fromClock: false };
}

// How many minutes ago the chart's printed clock was, or null when the clock
// cannot be trusted (no printed timezone, a placeholder or low-confidence time,
// or a date other than the one being reviewed).
export function chartClockAgeMinutes({ chartDetection, chartTimezone, nowMs, resolvedDate } = {}) {
  const chart = parseChartTimezoneLabel(chartTimezone);
  const date = String(chartDetection?.latestVisibleDate || "").trim();
  const clock = chartClockTime(chartDetection);
  if (!chart || !clock || !Number.isFinite(nowMs) || date !== resolvedDate) return null;
  const time = clock.time;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return null;
  const instant =
    Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(time.slice(0, 2)), Number(time.slice(3, 5)), 59) -
    chart.offsetMinutes * 60000;
  return (nowMs - instant) / 60000;
}

// A screenshot analysed long after it was taken falls back to "end of the
// chart's day", which pulls in every candle printed since. When the chart
// prints its timezone and a readable clock, that clock is the better cutoff for
// such a stale screenshot. Fresh screenshots keep the end-of-day fallback.
export function staleClockCutoff({ chartCutoff, chartDetection, chartTimezone, nowMs, staleMinutes = 45 } = {}) {
  if (chartCutoff?.mode !== "final_visible" || chartCutoff?.source !== "chart-final-visible-day-fallback") return null;
  const age = chartClockAgeMinutes({ chartDetection, chartTimezone, nowMs, resolvedDate: chartCutoff.resolvedDate });
  if (age === null || age < staleMinutes) return null;
  return { endDateTime: `${chartDetection.latestVisibleDate} ${chartClockTime(chartDetection).time}:59`, ageMinutes: Math.round(age) };
}

// True when the chart's clock is recent: the feed's candle that is still
// forming right now is then the screenshot's own final candle.
export function isFreshChartClock({ chartDetection, chartTimezone, nowMs, resolvedDate, freshMinutes = 45, futureMinutes = 10 } = {}) {
  const age = chartClockAgeMinutes({ chartDetection, chartTimezone, nowMs, resolvedDate });
  return age !== null && age >= -futureMinutes && age < freshMinutes;
}

// A screenshot cannot be from the future. True when the chart's date (and clock, when readable) lies
// ahead of the server's now. Without a printed timezone the furthest-ahead timezone (UTC+14) is allowed.
export function chartDateIsInFuture({ chartDetection, chartTimezone, nowMs, graceMinutes = 10 } = {}) {
  const date = String(chartDetection?.latestVisibleDate || "").trim();
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts || !Number.isFinite(nowMs)) return false;
  const time = String(chartDetection?.latestVisibleTime || "").trim();
  const hasTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const chart = parseChartTimezoneLabel(chartTimezone);
  const offsetMinutes = chart ? chart.offsetMinutes : 14 * 60;
  const instant =
    Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), hasTime ? Number(time.slice(0, 2)) : 0, hasTime ? Number(time.slice(3, 5)) : 0, 0) -
    offsetMinutes * 60000;
  return instant > nowMs + graceMinutes * 60000;
}

// When the chart reader's date is in the future (the empty axis space to the right of the last candle
// can read as tomorrow), the typed date replaces it if that date is possible. Null when the date is fine.
export function rescueFutureChartDate({ chartDetection, chartTimezone, nowMs, selectedDateText } = {}) {
  if (!chartDateIsInFuture({ chartDetection, chartTimezone, nowMs })) return null;
  const typed = /^\d{4}-\d{2}-\d{2}$/.test(String(selectedDateText || "")) ? String(selectedDateText) : null;
  const usable = typed !== null && !chartDateIsInFuture({ chartDetection: { ...chartDetection, latestVisibleDate: typed }, chartTimezone, nowMs });
  return { rejectedDate: chartDetection.latestVisibleDate, date: usable ? typed : null };
}

// The UTC offset (minutes) of an IANA timezone at a given instant, or null when it cannot be worked out.
export function timezoneOffsetMinutesAt(timezone, nowMs) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(nowMs));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    if (!Number.isFinite(wall)) return null;
    return Math.round((wall - Math.floor(nowMs / 60000) * 60000) / 60000);
  } catch {
    return null;
  }
}

// When the chart reader returned no timezone, the printed clock can still give it away: a screenshot taken
// minutes ago shows a clock within a few minutes of the server's own clock, at a whole-hour offset from UTC.
// Only UTC and the device's own timezone are considered (TradingView prints one of those), so an old
// screenshot whose age happens to be a whole number of hours is not mistaken for another timezone. The
// printed date must agree too. Returns a label such as "UTC+1", or null when there is no single clear answer.
export function inferChartTimezoneFromLiveClock({ chartDetection, nowMs, deviceTimezone, windowMinutes = 6 } = {}) {
  if (parseChartTimezoneLabel(chartDetection?.chartTimezone)) return null;
  const date = String(chartDetection?.latestVisibleDate || "").trim();
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = chartClockTime(chartDetection);
  if (!parts || !clock || !Number.isFinite(nowMs)) return null;
  const time = clock.time;
  const deviceOffset = deviceTimezone ? timezoneOffsetMinutesAt(deviceTimezone, nowMs) : null;
  const candidates = [0];
  if (deviceOffset !== null && deviceOffset % 60 === 0 && deviceOffset !== 0) candidates.push(deviceOffset);
  const printedLocal = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(time.slice(0, 2)), Number(time.slice(3, 5)), 0);
  const fits = candidates.filter((offset) => {
    const ageMinutes = (nowMs - (printedLocal - offset * 60000)) / 60000;
    return ageMinutes >= -windowMinutes && ageMinutes <= windowMinutes;
  });
  if (fits.length !== 1) return null;
  const offset = fits[0];
  if (offset === 0) return "UTC";
  const sign = offset < 0 ? "-" : "+";
  return `UTC${sign}${Math.abs(offset) / 60}`;
}

const INTRADAY_MINUTES = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60 };

// The open time (HH:MM, on the provider's clock) of the candle that was forming when the screenshot was
// taken: the chart's clock rounded down to the timeframe. A feed candle is labelled by its open time, so
// this is the time the feed check must find on the live candle (a clock of 17:19 is the 17:00 H1 candle).
// Null for timeframes above H1 or when the clock, its timezone or the date is missing.
export function liveCandleOpenTime({ chartDetection, chartTimezone, timeframe, providerTimezone } = {}) {
  const minutes = INTRADAY_MINUTES[String(timeframe || "").toUpperCase()];
  const chart = parseChartTimezoneLabel(chartTimezone);
  const clock = chartClockTime(chartDetection);
  const date = String(chartDetection?.latestVisibleDate || "").trim();
  if (!minutes || !chart || !clock || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const wall = wallClockInTimezone(`${date} ${clock.time}:00`, chart.offsetMinutes, providerTimezone || "UTC");
  if (!wall) return null;
  const floored = Math.floor((Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16))) / minutes) * minutes;
  return `${String(Math.floor(floored / 60)).padStart(2, "0")}:${String(floored % 60).padStart(2, "0")}`;
}
