import { inflateSync } from "node:zlib";

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

export function extractMt4PngMonthlyInventory({
  imageBase64,
  mimeType = "",
  timeframe = "",
  periodDates = [],
  timeAxisDates = [],
  priceAxisTicks = [],
  latestVisibleHigh = null,
  latestVisibleLow = null,
  latestVisibleClose = null,
} = {}) {
  if (String(timeframe).toUpperCase() !== "D1" || !/png/i.test(String(mimeType))) return null;
  const dates = (Array.isArray(timeAxisDates) ? timeAxisDates : []).map(parseDate).filter(Number.isFinite);
  const prices = (Array.isArray(priceAxisTicks) ? priceAxisTicks : []).map(Number).filter(Number.isFinite);
  if (dates.length < 3 || prices.length < 3 || prices[0] <= prices.at(-1)) return null;
  let image;
  try {
    image = decodePng8(Buffer.from(String(imageBase64 || ""), "base64"));
  } catch {
    return null;
  }
  if (!image || image.width < 500 || image.height < 250) return null;

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

  const colouredColumns = [];
  for (let x = 2; x < plotRight - 2; x += 1) {
    let found = false;
    for (let y = 22; y < plotBottom; y += 1) {
      if (candleColour(pixel(image, x, y))) { found = true; break; }
    }
    if (found) colouredColumns.push(x);
  }
  const candleGroups = groupConsecutive(colouredColumns);
  const candleCenters = candleGroups.map((group) => Math.round((group[0] + group.at(-1)) / 2));
  const candleStep = modePositive(candleCenters.slice(1).map((value, index) => value - candleCenters[index]), 2, 12);
  if (!candleStep || candleCenters.length < 40) return null;
  const firstCandleX = candleCenters[0];
  const lastCandleX = candleCenters.at(-1);

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
  if (xAxisPositions.length !== dates.length) {
    if (xAxisPositions.length > dates.length) xAxisPositions = xAxisPositions.slice(0, dates.length);
    else return null;
  }
  const dateAnchors = dates.map((timestamp, index) => ({ timestamp, x: xAxisPositions[index] }));
  if (!dateAnchors.every((item, index) => index === 0 || item.timestamp > dateAnchors[index - 1].timestamp)) return null;

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
      if (!Number.isFinite(firstDetectedY)) return null;
      yAxisPositions = Array.from({ length: prices.length }, (_, index) => firstDetectedY + index * yStep);
      if (yAxisPositions.at(-1) >= plotBottom + 2) return null;
    }
  }
  const firstY = yAxisPositions[0];
  const lastY = yAxisPositions.at(-1);
  const firstPrice = prices[0];
  const lastPrice = prices.at(-1);
  if (!(lastY > firstY) || !(firstPrice > lastPrice)) return null;
  const axisPriceAtY = (y) => firstPrice + (y - firstY) / (lastY - firstY) * (lastPrice - firstPrice);

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
      // Bottom-axis tick marks extend a few pixels upward into the plot and
      // share the candle-grid x phase. Excluding the final five raster rows
      // prevents those ticks from becoming a false low on every 24th candle.
      for (let y = Math.max(20, firstY - 8); y < plotBottom - 10; y += 1) {
        if (!excludedRows.has(y) && dark(pixel(image, px, y))) ys.push(y);
      }
    }
    if (ys.length) candles.push({ x, highY: Math.min(...ys), lowY: Math.max(...ys) });
  }
  if (candles.length < candleCenters.length * 0.75) return null;

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
  const axisPricePerPixel = Math.abs((lastPrice - firstPrice) / (lastY - firstY));
  const headerRange = headerHigh - headerLow;
  const headerValuesUsable =
    Number.isFinite(headerHigh) && Number.isFinite(headerLow) && headerRange > 0 &&
    finalCandle && headerPixelSpan > 0;
  const headerTolerance = headerValuesUsable
    ? Math.max(axisPricePerPixel * 4, headerRange * 0.35, (firstPrice - lastPrice) * 0.003)
    : Infinity;
  const axisMatchesHeader = headerValuesUsable &&
    Math.abs(axisPriceAtY(finalCandle.highY) - headerHigh) <= headerTolerance &&
    Math.abs(axisPriceAtY(finalCandle.lowY) - headerLow) <= headerTolerance;
  const useHeaderCalibration = headerValuesUsable && !axisMatchesHeader && headerPixelSpan >= 12;
  const headerPricePerPixel = useHeaderCalibration
    ? (headerLow - headerHigh) / headerPixelSpan
    : null;
  const priceAtY = useHeaderCalibration
    ? (y) => headerHigh + (y - finalCandle.highY) * headerPricePerPixel
    : axisPriceAtY;
  const chartPriceScaleVerified = axisMatchesHeader || useHeaderCalibration;
  const priceCalibrationSource = useHeaderCalibration
    ? "exact_final_candle_header_ohlc"
    : axisMatchesHeader
    ? "price_axis_cross_checked_by_final_candle_header"
    : "unverified_price_axis";

  const starts = (Array.isArray(periodDates) ? periodDates : []).map((date) => ({ date, timestamp: parseDate(date) })).filter((item) => Number.isFinite(item.timestamp));
  if (!starts.length) return null;
  const decimals = precisionFor({ latestVisibleClose: Number(latestVisibleClose), priceTicks: prices });
  const round = (value) => Number(Number(value).toFixed(decimals));
  const inventory = starts.map((start, index) => {
    const endTimestamp = starts[index + 1]?.timestamp ?? dateAnchors.at(-1).timestamp + 45 * 86400000;
    const startX = interpolateDailySessionX(start.timestamp, dateAnchors, candleStep);
    const endX = interpolateDailySessionX(endTimestamp, dateAnchors, candleStep);
    if (!Number.isFinite(startX) || !Number.isFinite(endX)) return null;
    const owned = candles.filter((candle) => candle.x >= startX - candleStep * 0.5 && candle.x < endX - candleStep * 0.5);
    if (!owned.length) return null;
    const highCandle = owned.reduce((best, candle) => candle.highY < best.highY ? candle : best);
    const lowCandle = owned.reduce((best, candle) => candle.lowY > best.lowY ? candle : best);
    return {
      date: start.date,
      high: round(priceAtY(highCandle.highY)),
      low: round(priceAtY(lowCandle.lowY)),
      rasterHighY: highCandle.highY,
      rasterLowY: lowCandle.lowY,
    };
  }).filter(Boolean);
  if (inventory.length !== starts.length || inventory.some((period) => !(period.high > period.low))) return null;
  const final = inventory.at(-1);
  if (Number(latestVisibleHigh) > 0) final.high = Math.max(final.high, Number(latestVisibleHigh));
  if (Number(latestVisibleLow) > 0) final.low = Math.min(final.low, Number(latestVisibleLow));
  return {
    inventory,
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
