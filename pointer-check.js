/**
 * Pointer check.
 *
 * With the mouse pointer on a chart, the top-left header describes the candle under the pointer,
 * not the last candle. The chart reader sometimes takes that header's close as the chart's last
 * price, and then everything that follows (the end date, the data match, the levels) is built on
 * a candle that is not the last one, and even "confirms" itself.
 *
 * The coloured price tag on the right-hand axis always shows the real last price. A small second
 * read returns that tag and the header's close. When they disagree by more than a tick or two,
 * the pointer is on the chart: the tag becomes the chart's last price, the header's open, high and
 * low (the hovered candle's) are dropped, the date and time the reader took from the pointer are
 * dropped, and the date is set to the trader's selected chart date when that is later. The
 * engine's existing price synchronisation then finds the candle whose close matches the tag.
 */

const DAY_MS = 86400000;

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const isoDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim()) ? String(value).trim() : "");

// How far apart the header's close and the price tag may be before the header is not the last
// candle: a hundredth of a percent of price (about one pip on EURUSD).
export function pointerPriceThreshold(price) {
  return Number(price) * 0.00008;
}

export function applyPointerEvidence({ chartDetection, evidence, selectedDateText = "" } = {}) {
  const unchanged = (reason, extra = {}) => ({ chartDetection, applied: false, reason, ...extra });
  if (!chartDetection || chartDetection.isTradingChart !== true) return unchanged("not_a_chart");
  const tag = num(evidence?.lastPrice);
  const header = num(evidence?.headerClose);
  if (!tag || !header) return unchanged("evidence_missing");
  // A misread (a volume figure, another axis label) is far from any real header close: ignore it.
  if (Math.abs(tag - header) / header > 0.05) return unchanged("tag_implausible", { tag, header });
  // The tag must sit on the chart's own price axis (within one tick of the printed range).
  const ticks = (Array.isArray(chartDetection.priceAxisTicks) ? chartDetection.priceAxisTicks : []).map(num).filter(Boolean);
  if (ticks.length >= 3) {
    const low = Math.min(...ticks);
    const high = Math.max(...ticks);
    const step = (high - low) / (ticks.length - 1);
    if (tag < low - step || tag > high + step) return unchanged("tag_outside_price_axis", { tag, header });
  }
  const difference = Math.abs(tag - header);
  if (difference <= pointerPriceThreshold(tag)) return unchanged("header_is_last_candle", { tag, header });

  const detected = isoDate(chartDetection.latestVisibleDate);
  const selected = isoDate(selectedDateText);
  // The pointer's date is unreliable. Use the trader's own chart date when it is later than the
  // detected one and not absurdly far (a week), so the engine's price search starts in the
  // right place.
  let date = detected;
  let dateFromSelected = false;
  if (selected && (!detected || selected > detected)) {
    const gap = detected ? (Date.parse(`${selected}T00:00:00Z`) - Date.parse(`${detected}T00:00:00Z`)) / DAY_MS : 0;
    if (!detected || gap <= 7) {
      date = selected;
      dateFromSelected = true;
    }
  }

  const updated = {
    ...chartDetection,
    latestVisibleDate: date || chartDetection.latestVisibleDate || null,
    latestVisibleTime: null,
    latestVisibleDateEvidence: "unknown",
    dateConfidence: dateFromSelected ? "medium" : chartDetection.dateConfidence || "low",
    latestVisiblePrice: tag,
    latestVisibleClose: tag,
    latestVisibleOpen: null,
    latestVisibleHigh: null,
    latestVisibleLow: null,
    latestVisiblePriceConfidence: "high",
    latestVisiblePriceSource: "price_tag_pointer_check",
    pointerOnChart: {
      headerClose: header,
      priceTag: tag,
      detectedDateBefore: detected || null,
      dateUsed: date || null,
      dateFromSelected,
    },
  };
  return { chartDetection: updated, applied: true, reason: "header_is_not_the_last_candle", tag, header, dateFromSelected, date };
}
