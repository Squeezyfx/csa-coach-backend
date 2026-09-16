/**
 * Is the framework period that contains the chart's cutoff complete AT that
 * cutoff?
 *
 * Replaces a rule that compared the cutoff date with today's wall-clock date.
 * That rule made every historical chart's live period "complete", so a chart
 * ending XAUUSD 2026-09-09 08:00 and benchmarked on 09-16 used the provider's
 * full Wednesday bar, including highs printed after the screenshot. It also
 * made results depend on the day the benchmark ran.
 *
 * The answer now depends only on the cutoff:
 *  - cutoff after the period's last trading day            -> complete
 *  - cutoff before the last trading day                    -> not complete
 *  - cutoff on the last trading day: complete once the chart's final candle
 *    is that day's last candle.
 *
 * Last trading day: a period ending on Saturday/Sunday ends on the Friday
 * before (FX, metals, indices). Friday's last intraday candle can start as
 * early as 20:00 UTC (FX close at 21:00 UTC in northern summer), so on
 * Fridays that is the threshold.
 *
 * Known trade-off: a 24/7 instrument (crypto) whose chart ends Friday between
 * 20:00 and 22:59 UTC is treated as complete for that day. Every other case is
 * conservative: treating a complete period as live only reconstructs it from
 * execution candles up to the cutoff, which cannot leak future data.
 */

const INTERVAL_MINUTES = {
  "1min": 1, "5min": 5, "15min": 15, "30min": 30, "45min": 45,
  "1h": 60, "2h": 120, "4h": 240, "1day": 1440, "1week": 10080, "1month": 43200,
};

/** Latest end-of-day fallback time used by the server ("YYYY-MM-DD 23:59:59"). */
const END_OF_DAY = "23:59";
/** Earliest start of the final intraday candle on a Friday (FX summer close). */
const FRIDAY_LAST_CANDLE_FLOOR = "20:00";

function hhmm(totalMinutes) {
  const m = Math.max(0, Math.min(totalMinutes, 1439));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Start time ("HH:MM") of the day's last candle for an interval, or null. */
export function lastCandleStart(interval) {
  const minutes = INTERVAL_MINUTES[String(interval || "").toLowerCase()];
  if (!minutes) return null;
  return minutes >= 1440 ? "00:00" : hhmm(1440 - minutes);
}

function weekday(dateText) {
  const d = new Date(`${dateText}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

function shiftDays(dateText, days) {
  const d = new Date(`${dateText}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Period end moved back to Friday when it falls on a weekend. */
export function lastTradingDay(periodEndDate) {
  const day = weekday(periodEndDate);
  if (day === 6) return shiftDays(periodEndDate, -1);
  if (day === 0) return shiftDays(periodEndDate, -2);
  return periodEndDate;
}

/**
 * @param {string} cutoffDate     "YYYY-MM-DD"
 * @param {string} cutoffTime     "HH:MM" or "HH:MM:SS" (chart's final candle, or 23:59:59 fallback)
 * @param {string} periodEndDate  "YYYY-MM-DD" calendar end of the framework period
 * @param {string} interval       execution interval, e.g. "1h", "4h", "1day"
 */
export function periodCompleteAtCutoff({ cutoffDate, cutoffTime = "00:00", periodEndDate, interval }) {
  if (!cutoffDate || !periodEndDate) return false;
  if (cutoffDate > periodEndDate) return true;
  const finalDay = lastTradingDay(periodEndDate);
  if (cutoffDate > finalDay) return true; // weekend after a Friday close
  if (cutoffDate < finalDay) return false;

  const time = String(cutoffTime || "00:00").slice(0, 5);
  if (time >= END_OF_DAY) return true;
  const last = lastCandleStart(interval);
  if (!last) return false;
  const threshold = weekday(cutoffDate) === 5 && last > FRIDAY_LAST_CANDLE_FLOOR
    ? FRIDAY_LAST_CANDLE_FLOOR
    : last;
  return time >= threshold;
}
