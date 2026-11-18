// Twelve Data returns the candle that is still forming as it stands NOW: its close is the latest price and its
// high and low include everything after a screenshot was taken. Against a chart captured an hour or two earlier
// in a fast market, that pushes an otherwise correct screenshot outside the 0.5% same-instrument limit (gold fell
// 0.6% between a 00:39 screenshot and a 02:16 review). These helpers rebuild that one candle as it stood at the cutoff
// from finer candles, without assuming where the provider's own day or week starts.

// Finer candles used to rebuild a forming candle of each size.
export const FORMING_FINER = { "5min": "1min", "15min": "1min", "30min": "1min", "1h": "1min", "4h": "1min", "1day": "1min", "1week": "15min", "1month": "1h" };
const MINUTES = { "5min": 5, "15min": 15, "30min": 30, "1h": 60, "4h": 240, "1day": 1440, "1week": 10080 };
// A cutoff this close to now is the live candle already; nothing to rebuild.
export const FORMING_SNAPSHOT_GRACE_MS = 3 * 60000;

const full = (text) => {
  const s = String(text || "").replace("T", " ").slice(0, 19);
  return s.length === 10 ? `${s} 00:00:00` : s;
};
const asDate = (text) => new Date(`${full(text).replace(" ", "T")}Z`);
const asText = (date) => date.toISOString().slice(0, 19).replace("T", " ");

// Where a candle that starts at `start` ends, as wall-clock text in the same timezone. Null for a size it does not know.
export function formingBucketEnd(start, interval) {
  const begin = asDate(start);
  if (!Number.isFinite(begin.getTime())) return null;
  if (interval === "1month") { begin.setUTCMonth(begin.getUTCMonth() + 1); return asText(begin); }
  if (!MINUTES[interval]) return null;
  begin.setUTCMinutes(begin.getUTCMinutes() + MINUTES[interval]);
  return asText(begin);
}

// Current wall-clock time in a timezone, as 'YYYY-MM-DD HH:MM:SS' (null if the timezone name is not usable).
export function wallClockNow(timezone = "UTC", nowMs = Date.now()) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  } catch { return null; }
}

// True when the provider's last candle is still open now and the cutoff lies inside it, long enough ago that the
// candle has moved since.
export function formingCandleNeedsRebuild({ candle, interval, cutoff, timezone = "UTC", nowMs = Date.now() }) {
  if (!candle || !FORMING_FINER[interval]) return false;
  if (String(process.env.FORMING_CANDLE_AT_CUTOFF || "").trim().toLowerCase() === "off") return false;
  const start = full(candle.datetime), end = formingBucketEnd(start, interval), cut = full(cutoff), now = wallClockNow(timezone, nowMs);
  if (!end || !now || !start || !cut) return false;
  if (!(start <= cut && cut < end)) return false; // the cutoff is not inside this candle
  if (!(now < end)) return false; // the candle has closed since; the past-cutoff checks own that case
  // Both are wall-clock text in the same timezone, so their difference is the age of the screenshot.
  return asDate(now).getTime() - asDate(cut).getTime() > FORMING_SNAPSHOT_GRACE_MS;
}

// The candle as it stood at the cutoff. `fineRows` run from the candle's start up to now. The close is the last
// finer close at or before the cutoff. A provider high (or low) is kept only when it was not set after the cutoff,
// i.e. the later finer candles do not reach it; otherwise the high (low) comes from the finer candles up to the cutoff.
// Returns null when there is nothing to rebuild from.
export function rebuildFormingCandle({ candle, fineRows = [], cutoff }) {
  const start = full(candle?.datetime), cut = full(cutoff);
  const rows = fineRows
    .map((r) => ({ t: full(r.datetime), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) }))
    .filter((r) => r.t && [r.o, r.h, r.l, r.c].every((n) => Number.isFinite(n) && n > 0))
    .sort((a, b) => a.t.localeCompare(b.t));
  const before = rows.filter((r) => r.t >= start && r.t <= cut);
  const after = rows.filter((r) => r.t > cut);
  if (!before.length) return null;
  const open = Number(candle.open), providerHigh = Number(candle.high), providerLow = Number(candle.low);
  if (![open, providerHigh, providerLow].every((n) => Number.isFinite(n) && n > 0)) return null;
  const close = before[before.length - 1].c;
  const eps = Math.abs(close) * 1e-9;
  const afterHigh = after.length ? Math.max(...after.map((r) => r.h)) : -Infinity;
  const afterLow = after.length ? Math.min(...after.map((r) => r.l)) : Infinity;
  let high = providerHigh > afterHigh + eps ? providerHigh : Math.max(...before.map((r) => r.h));
  let low = providerLow < afterLow - eps ? providerLow : Math.min(...before.map((r) => r.l));
  high = Math.max(high, open, close);
  low = Math.min(low, open, close);
  return { datetime: candle.datetime, open, high, low, close };
}
