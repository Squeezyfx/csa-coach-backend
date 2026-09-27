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
 * before (FX, metals, indices). On that Friday, every timeframe uses the
 * SAME real-world close threshold (22:00 UTC, a conservative estimate
 * covering DST variation) rather than each interval's own theoretical
 * last-candle-start time - a too-late theoretical time (M1-H1's 23:00) is
 * capped down to it, and a too-early one (H4's 20:00, which is merely when
 * that day's final candle OPENS, not when the market stops trading) is
 * raised up to it. See FRIDAY_CLOSE_THRESHOLD below.
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
/**
 * The real-world Friday close, applied uniformly to every timeframe's
 * completion check - not just as a ceiling on an interval's own theoretical
 * last-candle-start time. FX/CFD markets close around 21:00-22:00 UTC on
 * Fridays (varies with DST); 22:00 is a safe, conservative estimate for
 * "the market has definitely stopped trading" year-round.
 *
 * The old FRIDAY_LAST_CANDLE_FLOOR ("20:00") only ever CAPPED a too-late
 * threshold down (right for M1-H1, whose day-final-candle start, 23:00, is
 * clearly later than any real close) - it had no way to RAISE a
 * too-EARLY one. H4's own last-candle-start is exactly 20:00, which the
 * old logic then used unmodified as "the week is done," even though the
 * market can still be trading for another 1-2 hours past that moment.
 * Confirmed on USDCHF H4: a chart whose final visible candle read
 * "20:00" (high confidence) was marked as a fully closed week, when it
 * was still that week's actively-forming final candle - which then
 * incorrectly qualified it to source an entry.
 *
 * Applying ONE real close-time threshold on Fridays, for every timeframe,
 * fixes both directions at once and keeps the rule uniform: a too-late
 * theoretical last candle (M1-H1) is still correctly capped down, and a
 * too-early one (H4) is correctly raised, instead of two different pieces
 * of logic disagreeing on what "Friday is over" means depending on which
 * timeframe asks.
 */
const FRIDAY_CLOSE_THRESHOLD = "22:00";

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
  // Friday uses the same real-world close threshold for every timeframe,
  // regardless of the interval's own theoretical last-candle-start time -
  // so a too-late theoretical time (M1-H1's 23:00) is capped down to the
  // real close, and a too-early one (H4's 20:00) is correctly raised to
  // it, instead of the old asymmetric logic that could only ever cap down.
  const threshold = weekday(cutoffDate) === 5 ? FRIDAY_CLOSE_THRESHOLD : last;
  return time >= threshold;
}
