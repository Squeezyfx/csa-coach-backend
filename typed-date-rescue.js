/**
 * Typed-date rescue.
 *
 * A coin chart prints no date, so the reader works it out from the axis and sometimes gets the month wrong as well as
 * the year: SOLUSD H4 on 2026-11-23 was read as 21 Jan 2025 (the axis shows "Nov" and day numbers only). The existing
 * year search shifts that read date by one to three years, so it can never reach 23 Nov 2026 and the review ran on
 * January 2025 data that never matched the chart.
 *
 * The date the trader typed is the other candidate. The candidate carries it as the chart's last day with the same
 * evidence label a printed date would, and the caller keeps it only when the chart's price then matches the data
 * provider's candles cleanly on that date: the price test is the verification, the same test every other candidate faces.
 */

// Dates read with these kinds of evidence are not guesses and are never second-guessed here.
const FIRM_EVIDENCE = new Set([
  "explicit_final_candle_timestamp",
  "verified_axis_bar_count",
  "verified_multi_anchor_axis_count",
  "verified_single_anchor_pixel_count",
  "provider_price_match",
]);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// The detection to try with the typed date as the chart's last day, or null when that is not a fair candidate.
export function typedDateCandidate(chartDetection, typedDateText, { nowMs = Date.now() } = {}) {
  const typed = String(typedDateText || "").trim();
  if (!chartDetection || !ISO.test(typed)) return null;
  const typedMs = Date.parse(`${typed}T00:00:00Z`);
  if (!Number.isFinite(typedMs)) return null;
  // A screenshot cannot be from the future (one day of slack for time zones).
  if (typedMs > nowMs + 24 * 3600 * 1000) return null;
  if (chartDetection.latestVisibleDate === typed) return null;
  if (chartDetection.dateFromTypedDate === true) return null;
  const evidence = String(chartDetection.latestVisibleDateEvidence || "").trim();
  if (FIRM_EVIDENCE.has(evidence)) return null;
  return {
    ...chartDetection,
    latestVisibleDate: typed,
    latestVisibleTime: null,
    latestPrintedAxisDate: null,
    timestampAudit: null,
    // The printed clock can be misread (SOLUSD read 23:13 as 13:13) and would cut the provider data off hours early; with
    // none, the typed day is read up to the latest candle.
    chartClock: null,
    dateConfidence: "high",
    latestVisibleDateEvidence: "explicit_final_candle_timestamp",
    dateFromTypedDate: true,
    dateReadByChartReader: chartDetection.latestVisibleDate || null,
  };
}

// Accepted only when the price test came back clean, and (for instruments with a loose price tolerance) the close is
// also within 1% of the provider's.
export function typedDateAccepted({ cleanlyVerified, closeGapRatio }) {
  if (!cleanlyVerified) return false;
  return closeGapRatio === null || closeGapRatio === undefined || (Number.isFinite(closeGapRatio) && closeGapRatio < 0.01);
}
