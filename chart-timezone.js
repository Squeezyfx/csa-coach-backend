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

// A final-visible cutoff is the clock printed on the chart, so it is in the
// chart's timezone, not the device's. A UTC chart makes UTC the provider
// timezone (so days and candles line up with the chart); any other printed
// offset keeps the device timezone and moves the cutoff to the same instant.
export function alignCutoffToChartTimezone({ chartCutoff, chartTimezone, deviceTimezone }) {
  const unchanged = { timezone: deviceTimezone, endDateTime: chartCutoff?.endDateTime || null, applied: false };
  const chart = parseChartTimezoneLabel(chartTimezone);
  if (!chart || chartCutoff?.mode !== "final_visible" || chartCutoff?.exactVisibleCutoff !== true) return unchanged;
  if (chart.offsetMinutes === 0) return { ...unchanged, timezone: "UTC", applied: true, chartTimezone: chart.label };
  const moved = wallClockInTimezone(chartCutoff.endDateTime, chart.offsetMinutes, deviceTimezone);
  return moved ? { ...unchanged, endDateTime: moved, applied: true, chartTimezone: chart.label } : unchanged;
}
