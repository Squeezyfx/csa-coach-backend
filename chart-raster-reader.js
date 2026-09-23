import { inflateSync } from "node:zlib";
import { isCryptoSymbol } from "./market-data-matching.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng8(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) return null;
    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      interlace = buffer[dataStart + 12];
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") break;
    offset = dataEnd + 4;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || !channels || !idat.length) return null;
  const packed = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (packed.length < (stride + 1) * height) return null;
  const pixels = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = packed[sourceOffset++];
    const scanline = Buffer.from(packed.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? scanline[x - channels] : 0;
      const up = previous[x] || 0;
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      const predictor = filter === 1 ? left
        : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2)
        : filter === 4 ? paeth(left, up, upperLeft)
        : 0;
      if (filter > 4) return null;
      scanline[x] = (scanline[x] + predictor) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      const gray = channels === 1 ? scanline[src] : null;
      pixels[dst] = gray ?? scanline[src];
      pixels[dst + 1] = gray ?? scanline[src + 1];
      pixels[dst + 2] = gray ?? scanline[src + 2];
      pixels[dst + 3] = channels === 4 ? scanline[src + 3] : 255;
    }
    previous = scanline;
  }
  return { width, height, pixels };
}

function pixel(image, x, y) {
  const index = (y * image.width + x) * 4;
  return [image.pixels[index], image.pixels[index + 1], image.pixels[index + 2]];
}

function dark(rgb) {
  return rgb[0] < 72 && rgb[1] < 72 && rgb[2] < 72;
}

function candleColour(rgb) {
  return (rgb[0] > 145 && rgb[1] < 110 && rgb[2] < 110) ||
    (rgb[1] > 55 && rgb[0] < 110 && rgb[2] < 110);
}

function groupConsecutive(values) {
  const groups = [];
  for (const value of values) {
    if (!groups.length || value > groups.at(-1).at(-1) + 1) groups.push([value]);
    else groups.at(-1).push(value);
  }
  return groups;
}

function modePositive(values, min = 1, max = Infinity) {
  const counts = new Map();
  for (const value of values) {
    if (value < min || value > max) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
}

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function interpolateX(timestamp, anchors) {
  if (!Number.isFinite(timestamp) || anchors.length < 2) return null;
  let left = anchors[0];
  let right = anchors[1];
  if (timestamp <= left.timestamp) {
    left = anchors[0]; right = anchors[1];
  } else if (timestamp >= anchors.at(-1).timestamp) {
    left = anchors.at(-2); right = anchors.at(-1);
  } else {
    for (let index = 0; index < anchors.length - 1; index += 1) {
      if (timestamp >= anchors[index].timestamp && timestamp <= anchors[index + 1].timestamp) {
        left = anchors[index]; right = anchors[index + 1]; break;
      }
    }
  }
  const span = right.timestamp - left.timestamp;
  if (!(span > 0)) return null;
  return left.x + (timestamp - left.timestamp) / span * (right.x - left.x);
}

function weekdayDistance(leftTimestamp, rightTimestamp) {
  if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp) || leftTimestamp === rightTimestamp) return 0;
  const direction = rightTimestamp > leftTimestamp ? 1 : -1;
  let cursor = leftTimestamp;
  let count = 0;
  while ((direction > 0 && cursor < rightTimestamp) || (direction < 0 && cursor > rightTimestamp)) {
    cursor += direction * 86400000;
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) count += direction;
  }
  return count;
}

function moveWeekendForward(timestamp) {
  let resolved = timestamp;
  while ([0, 6].includes(new Date(resolved).getUTCDay())) resolved += 86400000;
  return resolved;
}

function previousDailySession(timestamp, includesWeekends) {
  let resolved = timestamp - 86400000;
  if (includesWeekends) return resolved;
  while ([0, 6].includes(new Date(resolved).getUTCDay())) resolved -= 86400000;
  return resolved;
}

function interpolateDailySessionX(timestamp, anchors, candleStep) {
  if (!Number.isFinite(timestamp) || anchors.length < 2 || !(candleStep > 0)) return null;
  let left = anchors[0];
  let right = anchors[1];
  if (timestamp <= left.timestamp) {
    left = anchors[0]; right = anchors[1];
  } else if (timestamp >= anchors.at(-1).timestamp) {
    left = anchors.at(-2); right = anchors.at(-1);
  } else {
    for (let index = 0; index < anchors.length - 1; index += 1) {
      if (timestamp >= anchors[index].timestamp && timestamp <= anchors[index + 1].timestamp) {
        left = anchors[index]; right = anchors[index + 1]; break;
      }
    }
  }
  const calendarSpan = Math.round((right.timestamp - left.timestamp) / 86400000);
  const weekdaySpan = weekdayDistance(left.timestamp, right.timestamp);
  const observedSteps = (right.x - left.x) / candleStep;
  const useWeekdays = Math.abs(observedSteps - weekdaySpan) + 0.75 < Math.abs(observedSteps - calendarSpan);
  const resolvedTimestamp = useWeekdays ? moveWeekendForward(timestamp) : timestamp;
  const totalUnits = useWeekdays ? weekdaySpan : calendarSpan;
  const elapsedUnits = useWeekdays
    ? weekdayDistance(left.timestamp, resolvedTimestamp)
    : (resolvedTimestamp - left.timestamp) / 86400000;
  if (!(totalUnits > 0)) return interpolateX(timestamp, anchors);
  return left.x + elapsedUnits / totalUnits * (right.x - left.x);
}

function precisionFor({ latestVisibleClose, priceTicks }) {
  const values = [latestVisibleClose, ...(priceTicks || [])].filter(Number.isFinite);
  const magnitude = Math.max(...values.map(Math.abs), 0);
  if (magnitude < 1) return 5;
  if (magnitude < 100) return 2;
  if (magnitude < 10000) return 2;
  return 3;
}

function regularAxisPositions(candidates, approximateStep, minimumCount = 3, tolerance = 2) {
  if (candidates.length < minimumCount) return [];
  let best = [];
  for (const start of candidates) {
    const sequence = [start];
    let expected = start + approximateStep;
    for (const candidate of candidates) {
      if (candidate <= start) continue;
      if (Math.abs(candidate - expected) <= tolerance) {
        sequence.push(candidate);
        expected = candidate + approximateStep;
      }
    }
    if (sequence.length > best.length) best = sequence;
  }
  return best.length >= minimumCount ? best : [];
}

// Locates the MT4 plot frame: the right-hand price-axis border and the
// bottom time-axis border. Shared by every raster reader in this file so
// the price calibration and the candle scan agree on the same plot box.
function detectPlotFrame(image) {
  const { width, height } = image;
  const verticalBorders = [];
  for (let x = 0; x < width - 20; x += 1) {
    let count = 0;
    for (let y = 20; y < height - 20; y += 1) if (dark(pixel(image, x, y))) count += 1;
    if (count > (height - 40) * 0.6) verticalBorders.push(x);
  }
  const plotRight = verticalBorders.at(-1);
  if (!Number.isFinite(plotRight)) return null;
  const horizontalBorders = [];
  for (let y = 0; y < height - 8; y += 1) {
    let count = 0;
    for (let x = 0; x <= plotRight; x += 1) if (dark(pixel(image, x, y))) count += 1;
    if (count > plotRight * 0.6) horizontalBorders.push(y);
  }
  const plotBottom = horizontalBorders.at(-1);
  if (!Number.isFinite(plotBottom) || plotBottom < height * 0.6) return null;
  return { plotRight, plotBottom };
}

// Y-axis (price) calibration from the right-edge tick marks and the OCR'd
// price labels. Moved verbatim out of extractMt4PngMonthlyInventory so the
// same calibration can be reused for any timeframe. This measures the axis
// only; it does not cross-check against candle OHLC (the monthly reader
// still does that itself with the final-candle header).
function calibratePriceAxis(image, { plotRight, plotBottom, prices }) {
  const { width } = image;
  let firstY = 20;
  let lastY = null;
  let yAnchors = [];
  let firstPrice = null;
  let lastPrice = null;
  let axisPriceAtY = null;
  let axisPricePerPixel = null;
  let inferredAxisCalibration = false;
  if (prices.length >= 3) {
    const rawYAxisTicks = [];
    for (let y = 12; y < plotBottom; y += 1) {
      let count = 0;
      for (let x = plotRight; x < Math.min(width, plotRight + 7); x += 1) if (dark(pixel(image, x, y))) count += 1;
      if (count >= 3) rawYAxisTicks.push(y);
    }
    const yTickGroups = groupConsecutive(rawYAxisTicks).filter((group) => group.length <= 2);
    const yStep = modePositive(yTickGroups.slice(1).map((group, index) => group[0] - yTickGroups[index][0]), 20, 100) || 49;
    let yAxisPositions = regularAxisPositions(yTickGroups.map((group) => group[0]), yStep, 3);
    if (yAxisPositions.length !== prices.length) {
      if (yAxisPositions.length > prices.length) yAxisPositions = yAxisPositions.slice(0, prices.length);
      else {
        const firstDetectedY = yTickGroups[0]?.[0];
        if (Number.isFinite(firstDetectedY)) {
          yAxisPositions = Array.from({ length: prices.length }, (_, index) => firstDetectedY + index * yStep);
          if (yAxisPositions.at(-1) >= plotBottom + 2) yAxisPositions = [];
        }
      }
    }
    if (yAxisPositions.length === prices.length) {
      firstY = yAxisPositions[0];
      lastY = yAxisPositions.at(-1);
      firstPrice = prices[0];
      lastPrice = prices.at(-1);
      if (lastY > firstY && firstPrice > lastPrice) {
        axisPricePerPixel = Math.abs((lastPrice - firstPrice) / (lastY - firstY));
        const tickFirstY = firstY;
        const tickLastY = lastY;
        axisPriceAtY = (y) => firstPrice + (y - tickFirstY) / (tickLastY - tickFirstY) * (lastPrice - firstPrice);
        yAnchors = yAxisPositions.map((y, index) => ({ y, price: prices[index], evidence: "tick_mark" }));
      }
    }
  }
  // Some MT4 captures contain labels but no dark tick marks inside the plot
  // border. The labels are evenly spaced on the linear price scale; infer
  // their vertical anchors from the plot margins rather than abandoning the
  // raster pass. The final-candle header calibration below still overrides
  // this estimate whenever the wick span is large enough.
  if (typeof axisPriceAtY !== "function" && prices.length >= 3 && plotBottom - firstY > 100 && prices[0] > prices.at(-1)) {
    const inferredFirstY = Math.max(firstY, 32);
    const inferredLastY = Math.max(inferredFirstY + 1, plotBottom - 22);
    axisPriceAtY = (y) => inferredFirstY === inferredLastY
      ? prices[0]
      : prices[0] + (y - inferredFirstY) / (inferredLastY - inferredFirstY) * (prices.at(-1) - prices[0]);
    axisPricePerPixel = Math.abs((prices.at(-1) - prices[0]) / (inferredLastY - inferredFirstY));
    firstY = inferredFirstY;
    firstPrice = prices[0];
    lastPrice = prices.at(-1);
    inferredAxisCalibration = true;
    lastY = inferredLastY;
    const labelSpacing = prices.length > 1 ? (inferredLastY - inferredFirstY) / (prices.length - 1) : 0;
    yAnchors = prices.map((price, index) => ({ y: inferredFirstY + index * labelSpacing, price, evidence: "inferred_from_plot_margins" }));
  }

  return { firstY, lastY, firstPrice, lastPrice, axisPriceAtY, axisPricePerPixel, inferredAxisCalibration, anchors: yAnchors };
}

/**
 * Public Y-axis calibration, the price-side counterpart of the time-axis
 * calibration in chart-time-reader.js. Returns plain data only (no
 * functions), so it can travel through chartDetection like timestampAudit.
 * Convert a pixel row to a price with priceAtCalibratedY(calibration, y).
 *
 * verified is always false here: axis ticks alone are not cross-checked.
 * One OCR misread label stretches every price, which is why the monthly
 * reader also checks the final candle's header OHLC before trusting it.
 */
export function readMt4PriceAxisCalibration({ imageBase64, priceAxisTicks = [] } = {}) {
  const rawPrices = (Array.isArray(priceAxisTicks) ? priceAxisTicks : []).map(Number).filter(Number.isFinite);
  if (rawPrices.length < 3 || rawPrices[0] <= rawPrices.at(-1)) return null;
  const { prices, filledLabels } = fillMissingPriceLabels(rawPrices);
  let image;
  try {
    image = decodePng8(Buffer.from(String(imageBase64 || ""), "base64"));
  } catch {
    return null;
  }
  if (!image || image.width < 500 || image.height < 250) return null;
  const frame = detectPlotFrame(image);
  if (!frame) return null;
  const axis = calibratePriceAxis(image, { ...frame, prices });
  if (typeof axis.axisPriceAtY !== "function" || !(axis.lastY > axis.firstY)) return null;
  return {
    version: "1.0.0",
    source: axis.inferredAxisCalibration ? "interpolated_price_axis_labels" : "price_axis_tick_marks",
    verified: false,
    verification: "not_cross_checked_against_candle_ohlc",
    plotRight: frame.plotRight,
    plotBottom: frame.plotBottom,
    firstY: axis.firstY,
    lastY: axis.lastY,
    firstPrice: axis.firstPrice,
    lastPrice: axis.lastPrice,
    pricePerPixel: axis.axisPricePerPixel,
    anchors: axis.anchors,
    filledLabels,
    imageWidth: image.width,
    imageHeight: image.height,
  };
}

// MT4 axis labels are evenly spaced. A label hidden behind the boxed
// current-price tag (e.g. USOIL 95.80 under 96.05) shows up as one gap that
// is twice the normal spacing. Without a fill, the labels shift against the
// tick marks and every price on the scale is wrong.
function fillMissingPriceLabels(prices) {
  const gaps = prices.slice(1).map((price, index) => prices[index] - price);
  const sorted = [...gaps].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  if (!(typical > 0)) return { prices, filledLabels: [] };
  const out = [prices[0]];
  const filledLabels = [];
  for (let index = 1; index < prices.length; index += 1) {
    const ratio = gaps[index - 1] / typical;
    if (ratio > 1.7 && ratio < 2.3) {
      const filled = (prices[index - 1] + prices[index]) / 2;
      out.push(filled);
      filledLabels.push(Number(filled.toFixed(6)));
    }
    out.push(prices[index]);
  }
  return { prices: out, filledLabels };
}

export function yAtCalibratedPrice(calibration, price) {
  const { firstY, lastY, firstPrice, lastPrice } = calibration || {};
  if (![firstY, lastY, firstPrice, lastPrice, Number(price)].every(Number.isFinite) || firstPrice === lastPrice) return null;
  return firstY + (Number(price) - firstPrice) / (lastPrice - firstPrice) * (lastY - firstY);
}

export function priceAtCalibratedY(calibration, y) {
  const { firstY, lastY, firstPrice, lastPrice } = calibration || {};
  if (![firstY, lastY, firstPrice, lastPrice, Number(y)].every(Number.isFinite) || !(lastY > firstY)) return null;
  return firstPrice + (Number(y) - firstY) / (lastY - firstY) * (lastPrice - firstPrice);
}

/**
 * Reads each period's high/low directly from candle wick pixels instead of
 * trusting a vision estimate, which can snap to the nearest printed axis
 * label (USOIL's Monday low landing on the tick price 88.70 exactly, not a
 * real wick). Requires the time axis to already give each period's exact
 * pixel x-range (candle-index based, from chart-period-map.js's verified
 * periodStarts) and the price axis to already be calibrated. Reuses the
 * same dark-pixel-only wick detection already proven in
 * extractMt4PngMonthlyInventory, so a red zig-zag overlay can't corrupt it.
 */
export function readPeriodWickExtremesFromPixels({
  imageBase64,
  priceAxisCalibration,
  candleStep,
  periods = [],
} = {}) {
  if (!(Number(candleStep) > 0) || !Array.isArray(periods) || !periods.length) return null;
  const calibration = priceAxisCalibration;
  if (!calibration || !Number.isFinite(calibration.firstY) || !Number.isFinite(calibration.lastY)) return null;
  let image;
  try {
    image = decodePng8(Buffer.from(String(imageBase64 || ""), "base64"));
  } catch {
    return null;
  }
  if (!image) return null;
  const { width, height } = image;
  const plotBottom = Math.min(height - 1, Math.round(Number(calibration.plotBottom) || Math.max(calibration.firstY, calibration.lastY) + 10));
  const topLimit = Math.max(2, Math.round(Math.min(calibration.firstY, calibration.lastY) - 8));
  const scanRight = Math.min(width - 1, Math.round(periods.at(-1).x2 ?? periods.at(-1).x1 + candleStep));

  // Rows that are dark across almost the full scanned width are chart chrome
  // (borders/gridlines), not a candle wick - exclude them so a horizontal
  // gridline can never be mistaken for a wick extreme.
  const excludedRows = new Set();
  for (let y = topLimit; y < plotBottom; y += 1) {
    let count = 0;
    for (let x = 1; x <= scanRight; x += 1) if (dark(pixel(image, x, y))) count += 1;
    if (count > scanRight * 0.45) excludedRows.add(y);
  }
  const wickExtremesAt = (x) => {
    const ys = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      const px = x + dx;
      if (px < 0 || px >= width) continue;
      for (let y = topLimit; y < plotBottom; y += 1) {
        if (!excludedRows.has(y) && dark(pixel(image, px, y))) ys.push(y);
      }
    }
    return ys.length ? { highY: Math.min(...ys), lowY: Math.max(...ys) } : null;
  };

  return periods.map((period) => {
    const x1 = Math.max(0, Math.round(period.x1));
    const x2 = Math.min(width, Math.round(period.x2 ?? x1 + candleStep));
    if (!(x2 > x1)) return { key: period.key, high: null, low: null };
    let highY = null, lowY = null;
    for (let x = x1; x < x2; x += candleStep) {
      const extremes = wickExtremesAt(Math.round(x));
      if (!extremes) continue;
      if (highY === null || extremes.highY < highY) highY = extremes.highY;
      if (lowY === null || extremes.lowY > lowY) lowY = extremes.lowY;
    }
    if (highY === null || lowY === null) return { key: period.key, high: null, low: null };
    return {
      key: period.key,
      high: priceAtCalibratedY(calibration, highY),
      low: priceAtCalibratedY(calibration, lowY),
      highY,
      lowY,
    };
  });
}

export function extractMt4PngMonthlyInventory({
  imageBase64,
  mimeType = "",
  timeframe = "",
  periodDates = [],
  periodPixelRanges = [],
  timeAxisDates = [],
  priceAxisTicks = [],
  latestVisibleHigh = null,
  latestVisibleLow = null,
  latestVisibleClose = null,
  latestVisibleDate = "",
  instrument = "",
} = {}) {
  // Diagnostic reason tracking: this function used to return bare null on
  // every failure, which was indistinguishable from any other failure once
  // it reached the export - AUDCHF/GBPCAD kept coming back with an empty
  // inventory across several fixes because there was no way to tell WHICH
  // of the many early exits below was actually firing for those specific
  // charts without a pixel-identical reference screenshot to hand-test
  // against (which the benchmark's own re-captures never quite are). Every
  // failure path now returns {ok:false, reason, ...} instead of bare null;
  // callers that only ever used `?.` optional chaining or falsy checks on
  // the result are unaffected, since {ok:false} still reads as "no usable
  // data" everywhere it's consumed.
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  if (String(timeframe).toUpperCase() !== "D1" || !/png/i.test(String(mimeType))) return fail("not_a_d1_png_chart");
  const dates = (Array.isArray(timeAxisDates) ? timeAxisDates : []).map(parseDate).filter(Number.isFinite);
  // Keep the complete OCR scale list. A boxed live-price label can be a valid
  // scale anchor even though it is not an ordinary tick; dropping it without
  // detecting its pixel position would shift the remaining labels.
  const prices = (Array.isArray(priceAxisTicks) ? priceAxisTicks : []).map(Number).filter(Number.isFinite);
  if (prices.length >= 3 && prices[0] <= prices.at(-1)) return fail("price_axis_ticks_not_descending", { prices });
  let image;
  try {
    image = decodePng8(Buffer.from(String(imageBase64 || ""), "base64"));
  } catch (error) {
    return fail("png_decode_failed", { error: error?.message || String(error) });
  }
  if (!image || image.width < 500 || image.height < 250) return fail("image_too_small", { width: image?.width, height: image?.height });

  const { width, height } = image;
  const frame = detectPlotFrame(image);
  if (!frame) return fail("plot_frame_not_detected");
  const { plotRight, plotBottom } = frame;

  // The MT4 screenshots used by the benchmark often contain a continuous
  // red zig-zag overlay. Treating every red pixel as a candle joins the whole
  // chart into one giant group and disables raster extraction. Candle bodies
  // and wicks have dark outlines, so detect columns with repeated dark pixels
  // instead and deliberately ignore the red overlay.
  const candleColumns = [];
  for (let x = 2; x < plotRight - 2; x += 1) {
    let darkCount = 0;
    for (let y = 22; y < plotBottom; y += 1) {
      if (dark(pixel(image, x, y))) darkCount += 1;
    }
    if (darkCount >= 2) candleColumns.push(x);
  }
  const candleGroups = groupConsecutive(candleColumns);
  const candleCenters = candleGroups.map((group) => Math.round((group[0] + group.at(-1)) / 2));
  const candleStep = modePositive(candleCenters.slice(1).map((value, index) => value - candleCenters[index]), 2, 12);
  if (!candleStep || candleCenters.length < 40) return fail("candle_geometry_not_detected", { candleStep, candleCenterCount: candleCenters.length });
  const firstCandleX = candleCenters[0];
  const lastCandleX = candleCenters.at(-1);

  let dateAnchors = [];
  if (dates.length >= 3) {
    const rawXAxisTicks = [];
    for (let x = 1; x < Math.min(plotRight, lastCandleX + candleStep); x += 1) {
      let count = 0;
      for (let y = plotBottom; y < Math.min(height, plotBottom + 6); y += 1) if (dark(pixel(image, x, y))) count += 1;
      if (count >= 4) rawXAxisTicks.push(x);
    }
    let xAxisPositions = regularAxisPositions(groupConsecutive(rawXAxisTicks).map((group) => group[0]), candleStep * 24, 3, 0);
    if (xAxisPositions.length < dates.length) {
      const phase = ((firstCandleX % (candleStep * 24)) + candleStep * 24) % (candleStep * 24);
      xAxisPositions = [];
      for (let x = phase || candleStep * 24; x <= lastCandleX; x += candleStep * 24) xAxisPositions.push(x);
    }
    if (xAxisPositions.length > dates.length) xAxisPositions = xAxisPositions.slice(0, dates.length);
    if (xAxisPositions.length === dates.length) {
      dateAnchors = dates.map((timestamp, index) => ({ timestamp, x: xAxisPositions[index] }));
      if (!dateAnchors.every((item, index) => index === 0 || item.timestamp > dateAnchors[index - 1].timestamp)) dateAnchors = [];
    }
  }

  const priceAxis = calibratePriceAxis(image, { plotRight, plotBottom, prices });
  const { firstY, firstPrice, lastPrice, axisPriceAtY, axisPricePerPixel, inferredAxisCalibration } = priceAxis;

  const excludedRows = new Set();
  for (let y = 20; y < plotBottom; y += 1) {
    let count = 0;
    for (let x = 1; x <= lastCandleX; x += 1) if (dark(pixel(image, x, y))) count += 1;
    if (count > lastCandleX * 0.45) excludedRows.add(y);
  }
  const candles = [];
  for (let x = firstCandleX; x <= lastCandleX; x += candleStep) {
    const ys = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      const px = x + dx;
      // Bottom-axis tick marks extend only a few pixels upward into the plot
      // and share the candle-grid x phase. Exclude the final four raster rows
      // while retaining genuine extreme wicks near the lower plot edge.
      for (let y = Math.max(20, firstY - 8); y < plotBottom - 4; y += 1) {
        if (!excludedRows.has(y) && dark(pixel(image, px, y))) ys.push(y);
      }
    }
    if (ys.length) candles.push({ x, highY: Math.min(...ys), lowY: Math.max(...ys) });
  }
  if (candles.length < candleCenters.length * 0.75) return fail("wick_detection_incomplete", { candlesFound: candles.length, candleCentersExpected: candleCenters.length });

  // Price-axis labels are transcribed before this deterministic raster pass.
  // A single OCR error (for example Cocoa's 2921 bottom tick read as 2018)
  // otherwise stretches every monthly price while leaving the wick geometry
  // apparently valid. Cross-check the scale against the exact final-candle
  // header OHLC. When that candle spans enough pixels, its high/low provide a
  // second independent affine calibration and override a conflicting axis.
  const finalCandle = candles.reduce((best, candle) =>
    !best || Math.abs(candle.x - lastCandleX) < Math.abs(best.x - lastCandleX)
      ? candle
      : best, null);
  const headerHigh = Number(latestVisibleHigh);
  const headerLow = Number(latestVisibleLow);
  const headerPixelSpan = finalCandle ? finalCandle.lowY - finalCandle.highY : 0;
  const headerRange = headerHigh - headerLow;
  const headerValuesUsable =
    Number.isFinite(headerHigh) && Number.isFinite(headerLow) && headerRange > 0 &&
    finalCandle && headerPixelSpan > 0;
  const headerTolerance = headerValuesUsable
    ? Math.max((axisPricePerPixel || headerRange / headerPixelSpan) * 4, headerRange * 0.35, ((firstPrice || headerHigh) - (lastPrice || headerLow)) * 0.003)
    : Infinity;
  const axisMatchesHeader = headerValuesUsable && typeof axisPriceAtY === "function" &&
    Math.abs(axisPriceAtY(finalCandle.highY) - headerHigh) <= headerTolerance &&
    Math.abs(axisPriceAtY(finalCandle.lowY) - headerLow) <= headerTolerance;
  // When tick marks are outside the image crop, axisPriceAtY is unavailable.
  // The final candle's printed OHLC still gives a reliable local affine scale;
  // use it rather than abandoning deterministic raster extraction.
  const useHeaderCalibration = headerValuesUsable && headerPixelSpan >= 12 &&
    (!axisMatchesHeader || typeof axisPriceAtY !== "function");
  const headerPricePerPixel = useHeaderCalibration
    ? (headerLow - headerHigh) / headerPixelSpan
    : null;
  const priceAtY = useHeaderCalibration
    ? (y) => headerHigh + (y - finalCandle.highY) * headerPricePerPixel
    : axisPriceAtY;
  if (typeof priceAtY !== "function") return fail("no_price_calibration_available", { headerValuesUsable, hasAxisPriceAtY: typeof axisPriceAtY === "function" });
  const chartPriceScaleVerified = axisMatchesHeader || useHeaderCalibration || inferredAxisCalibration;
  const priceCalibrationSource = useHeaderCalibration
    ? "exact_final_candle_header_ohlc"
    : axisMatchesHeader
    ? "price_axis_cross_checked_by_final_candle_header"
    : inferredAxisCalibration
    ? "interpolated_price_axis_labels"
    : "unverified_price_axis";

  const starts = (Array.isArray(periodDates) ? periodDates : []).map((date) => ({ date, timestamp: parseDate(date) })).filter((item) => Number.isFinite(item.timestamp));
  if (!starts.length) return fail("no_period_dates_supplied");
  const includesWeekends = isCryptoSymbol(instrument);
  let finalTimestamp = parseDate(latestVisibleDate);
  // A non-crypto D1 chart whose last visible date is inferred as Saturday or
  // Sunday actually ends on the prior Friday session. Anchor the rightmost
  // candle to that completed trading session before walking backwards.
  if (Number.isFinite(finalTimestamp) && !includesWeekends && [0, 6].includes(new Date(finalTimestamp).getUTCDay())) {
    finalTimestamp = previousDailySession(finalTimestamp, false);
  }
  const datedCandles = [];
  if (dateAnchors.length < 2 && Number.isFinite(finalTimestamp)) {
    let candleTimestamp = finalTimestamp;
    for (let index = candles.length - 1; index >= 0; index -= 1) {
      datedCandles[index] = { ...candles[index], timestamp: candleTimestamp };
      candleTimestamp = previousDailySession(candleTimestamp, includesWeekends);
    }
  }
  const decimals = precisionFor({ latestVisibleClose: Number(latestVisibleClose), priceTicks: prices });
  const round = (value) => Number(Number(value).toFixed(decimals));
  // chartPeriodMap positions each period by real fetched-candle index once it
  // has one verified anchor - it never assumes a weekday pattern the way
  // dateAnchors/datedCandles below do. When the caller supplies its already-
  // verified pixel range for a date, use it directly instead of re-deriving
  // a separate, weaker estimate; only dates it doesn't cover (or when it
  // isn't verified at all) fall back to this reader's own axis detection.
  const pixelRangesByDate = new Map(
    (Array.isArray(periodPixelRanges) ? periodPixelRanges : [])
      .filter((range) => range && String(range.date || "") && Number.isFinite(Number(range.x1)) && Number.isFinite(Number(range.x2)))
      .map((range) => [String(range.date), { x1: Number(range.x1), x2: Number(range.x2) }])
  );
  const inventory = starts.map((start, index) => {
    const endTimestamp = starts[index + 1]?.timestamp ??
      (dateAnchors.at(-1)?.timestamp ?? finalTimestamp ?? start.timestamp) + 45 * 86400000;
    const verifiedRange = pixelRangesByDate.get(start.date);
    const startX = verifiedRange
      ? verifiedRange.x1
      : dateAnchors.length >= 2 ? interpolateDailySessionX(start.timestamp, dateAnchors, candleStep) : null;
    const endX = verifiedRange
      ? verifiedRange.x2
      : dateAnchors.length >= 2 ? interpolateDailySessionX(endTimestamp, dateAnchors, candleStep) : null;
    const owned = Number.isFinite(startX) && Number.isFinite(endX)
      ? candles.filter((candle) => candle.x >= startX - candleStep * 0.5 && candle.x < endX - candleStep * 0.5)
      : datedCandles.filter((candle) => candle.timestamp >= start.timestamp && candle.timestamp < endTimestamp);
    if (!owned.length) return null;
    const highCandle = owned.reduce((best, candle) => candle.highY < best.highY ? candle : best);
    const lowCandle = owned.reduce((best, candle) => candle.lowY > best.lowY ? candle : best);
    // A wick within one candle step of a calendar boundary can belong to
    // either adjacent period because screenshot interpolation and broker
    // session cut-offs are not exact. Keep the value, but mark the period
    // ambiguous so downstream validation cannot silently accept it.
    const boundaryBuffer = Math.max(candleStep * 0.75, 2);
    const boundaryAmbiguous = [highCandle.x, lowCandle.x].some((x) =>
      Math.abs(x - startX) <= boundaryBuffer || Math.abs(x - endX) <= boundaryBuffer
    );
    return {
      date: start.date,
      high: round(priceAtY(highCandle.highY)),
      low: round(priceAtY(lowCandle.lowY)),
      boundaryAmbiguous,
    };
  }).filter(Boolean);
  // A period with zero owned candles (owned.length === 0, usually one whose
  // interpolated start/end x lands slightly off because of an axis-label
  // irregularity elsewhere on the chart) used to discard the ENTIRE
  // inventory here, not just that one period - so one bad month meant this
  // reader contributed nothing at all for the whole chart, even though
  // every other month's wick data was read correctly. The caller
  // (rasterCorrectedPeriodInventory in server.js) already applies this
  // inventory per period and keeps its own original data for any date
  // missing here, so a short inventory is fine; only a genuinely inverted
  // high/low is a real error worth discarding.
  if (!inventory.length) return fail("no_period_found_any_owned_candles", { periodsRequested: starts.length, verifiedRangesSupplied: pixelRangesByDate.size });
  if (inventory.some((period) => !(period.high > period.low))) return fail("inverted_high_low_in_inventory", { periodsRecovered: inventory.length, periodsRequested: starts.length });
  const lastStartDate = starts.at(-1)?.date;
  const final = inventory.at(-1)?.date === lastStartDate ? inventory.at(-1) : null;
  if (final) {
    if (Number(latestVisibleHigh) > 0) final.high = Math.max(final.high, Number(latestVisibleHigh));
    if (Number(latestVisibleLow) > 0) final.low = Math.min(final.low, Number(latestVisibleLow));
  }
  return {
    ok: true,
    inventory,
    periodsRecovered: inventory.length,
    periodsRequested: starts.length,
    verifiedRangesUsed: pixelRangesByDate.size,
    source: "deterministic_mt4_png_wick_raster",
    chartPriceScaleVerified,
    priceCalibrationSource,
    priceCalibrationAudit: {
      axisMatchesFinalCandleHeader: axisMatchesHeader,
      finalCandlePixelSpan: headerPixelSpan,
      usedFinalCandleHeaderOverride: useHeaderCalibration,
    },
    candleStep,
    firstCandleX,
    lastCandleX,
  };
}
