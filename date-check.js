/**
 * The "DATE CHECK" note in a Final visible candle review.
 *
 * In Final visible candle mode the date printed on the chart controls the review. When the chart
 * prints no date for its last candle, the date the trader typed is used instead, and if the market
 * data for that date does not match the chart's prices the review can be about the wrong day.
 * Two cases are worth saying out loud:
 *   corrected  - the date was found from the chart's prices and differs from the typed one;
 *   unverified - the typed date was used and the market data for it does not match the chart.
 */

const UNVERIFIED_STATUSES = ["date_unverified", "mismatch"];

export function buildDateCheck({ finalVisibleDate = null, matchStatus = "" } = {}) {
  const fv = finalVisibleDate;
  if (!fv || fv.mode !== "final_visible") return null;
  const typedDate = fv.typedDate || null;
  const reviewedDate = fv.reviewedDate || null;
  if (fv.priceMatched) {
    if (!reviewedDate || reviewedDate === typedDate) return null;
    return { kind: "corrected", typedDate, reviewedDate };
  }
  if (fv.source === "user-selected-date" && UNVERIFIED_STATUSES.includes(String(matchStatus || ""))) {
    return { kind: "unverified", typedDate, reviewedDate };
  }
  return null;
}

export function describeDateCheck(check) {
  if (!check) return "";
  if (check.kind === "corrected") {
    return `The date could not be read from this chart, so it was found from the chart's prices. The chart ends on ${check.reviewedDate}${
      check.typedDate ? `, not ${check.typedDate} as you typed` : ""
    }, and the review is based on that day.`;
  }
  return `The date could not be read from this chart, and the market data for ${
    check.reviewedDate || "the date you typed"
  } does not match the chart's prices. This review may be about the wrong day. Check the date you typed and run it again.`;
}
