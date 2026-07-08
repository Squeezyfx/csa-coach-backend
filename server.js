import express from "express";
import cors from "cors";
import multer from "multer";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TWELVE_DATA_BASE_URL = "https://api.twelvedata.com/time_series";

const CHART_DETECTION_PROMPT = `
You are a chart screenshot pre-check assistant for CSA Coach.

Your only job is to inspect the uploaded chart image and return a small JSON object.

Detect:
1. The trading instrument/pair visible on the chart, if readable.
2. The timeframe visible on the chart, if readable. Return common compact values like M1, M5, M15, M30, H1, H4, D1, or W1.
3. The latest/final visible calendar date shown on the chart, if readable.

Important:
- The chart may be from TradingView, MT4, MT5, or another platform.
- The latest visible chart date means the last/rightmost date visible on the x-axis or candles.
- If dates are visible as "3 Jul 2026", convert to "2026-07-03".
- If dates are visible as "1 Jul", infer the year only if the chart clearly shows the year elsewhere.
- If the date is not clear, use null.
- Do not guess if unreadable.
- Ignore Sunday candles.
- Return JSON only. No markdown. No explanation.

Return exactly this JSON shape:
{
  "detectedInstrument": "GBPUSD or null",
  "detectedTimeframe": "H1 or M5 or null",
  "latestVisibleDate": "YYYY-MM-DD or null",
  "dateConfidence": "high or medium or low",
  "notes": "brief note"
}
`;

function normalizeSymbol(input = "") {
  const raw = String(input).trim().toUpperCase().replace(/\s+/g, "");

  const map = {
    EURUSD: "EUR/USD",
    GBPUSD: "GBP/USD",
    EURCHF: "EUR/CHF",
    EURGBP: "EUR/GBP",
    GBPJPY: "GBP/JPY",
    USDJPY: "USD/JPY",
    USDCHF: "USD/CHF",
    USDCAD: "USD/CAD",
    AUDUSD: "AUD/USD",
    NZDUSD: "NZD/USD",
    XAUUSD: "XAU/USD",
    GOLD: "XAU/USD",
    BTCUSD: "BTC/USD",
    BTCUSDT: "BTC/USD",
  };

  if (map[raw]) return map[raw];
  if (raw.includes("/")) return raw;
  if (raw.length === 6) return `${raw.slice(0, 3)}/${raw.slice(3)}`;
  return raw || "";
}

function normalizeTimeframe(input = "") {
  const raw = String(input).trim().toUpperCase().replace(/\s+/g, "");

  const map = {
    "1M": "1min",
    M1: "1min",
    "1MIN": "1min",

    "5M": "5min",
    M5: "5min",
    "5MIN": "5min",

    "15M": "15min",
    M15: "15min",
    "15MIN": "15min",

    "30M": "30min",
    M30: "30min",
    "30MIN": "30min",

    "1H": "1h",
    H1: "1h",
    "60M": "1h",

    "4H": "4h",
    H4: "4h",

    D1: "1day",
    DAILY: "1day",
    "1D": "1day",

    W1: "1week",
    WEEKLY: "1week",
    "1W": "1week",
  };

  return map[raw] || "1h";
}

function normalizeAnalysisType(input = "") {
  const raw = String(input).trim().toLowerCase();

  if (
    raw.includes("post") ||
    raw.includes("review") ||
    raw.includes("after") ||
    raw === "post-trade"
  ) {
    return "post-trade";
  }

  if (
    raw.includes("pre") ||
    raw.includes("before") ||
    raw === "pre-trade"
  ) {
    return "pre-trade";
  }

  return raw || "post-trade";
}

function comparableInstrument(input = "") {
  const raw = String(input).toUpperCase().replace(/\s+/g, "");

  const knownSymbols = [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "USDCHF",
    "USDCAD",
    "AUDUSD",
    "NZDUSD",
    "EURCHF",
    "EURGBP",
    "GBPJPY",
    "XAUUSD",
    "GOLD",
    "BTCUSD",
    "BTCUSDT",
  ];

  for (const symbol of knownSymbols) {
    if (raw.includes(symbol)) {
      if (symbol === "GOLD") return "XAUUSD";
      if (symbol === "BTCUSDT") return "BTCUSD";
      return symbol;
    }
  }

  const compact = normalizeSymbol(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (compact === "GOLD") return "XAUUSD";
  if (compact === "BTCUSDT") return "BTCUSD";

  return compact;
}

function comparableTimeframe(input = "") {
  const raw = String(input).trim().toUpperCase().replace(/\s+/g, "");

  if (!raw || raw === "NOTPROVIDED" || raw === "NOTDETECTED" || raw === "NULL") {
    return "";
  }

  const map = {
    "1": "M1",
    "1M": "M1",
    M1: "M1",
    "1MIN": "M1",

    "5": "M5",
    "5M": "M5",
    M5: "M5",
    "5MIN": "M5",

    "15": "M15",
    "15M": "M15",
    M15: "M15",
    "15MIN": "M15",

    "30": "M30",
    "30M": "M30",
    M30: "M30",
    "30MIN": "M30",

    "60": "H1",
    "60M": "H1",
    "1H": "H1",
    H1: "H1",

    "240": "H4",
    "240M": "H4",
    "4H": "H4",
    H4: "H4",

    D: "D1",
    "1D": "D1",
    D1: "D1",
    DAILY: "D1",

    W: "W1",
    "1W": "W1",
    W1: "W1",
    WEEKLY: "W1",
  };

  const cleaned = raw.replace(/[^A-Z0-9]/g, "");
  return map[raw] || map[cleaned] || cleaned;
}

function hasStrongInstrumentMismatch({ selectedInstrument, detectedInstrument }) {
  const selected = comparableInstrument(selectedInstrument);
  const detected = comparableInstrument(detectedInstrument);

  if (!selected || !detected) return false;
  if (selected.length < 6 || detected.length < 6) return false;

  return selected !== detected;
}

function hasStrongTimeframeMismatch({ selectedTimeframe, detectedTimeframe }) {
  const selected = comparableTimeframe(selectedTimeframe);
  const detected = comparableTimeframe(detectedTimeframe);

  if (!selected || !detected) return false;

  return selected !== detected;
}

function parseISODateOnly(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getWeekRangeForDate(chartDate, useFullWeek = false) {
  const day = chartDate.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(chartDate, mondayOffset);
  const friday = addDays(monday, 4);
  const end = useFullWeek ? friday : chartDate < friday ? chartDate : friday;

  return {
    monday,
    friday,
    end,
    useFullWeek,
    startDate: formatDateOnly(monday),
    fridayDate: formatDateOnly(friday),
    endDate: formatDateOnly(end),
  };
}

function isSameTradingWeek(dateA, dateB) {
  if (!dateA || !dateB) return false;

  const weekA = getWeekRangeForDate(dateA, true);
  const weekB = getWeekRangeForDate(dateB, true);

  return (
    weekA.startDate === weekB.startDate &&
    weekA.fridayDate === weekB.fridayDate
  );
}

function weekdayNameFromDate(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

function candleDateOnly(datetimeValue = "") {
  return String(datetimeValue).slice(0, 10);
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "N/A";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 100) return value.toFixed(3);
  if (Math.abs(value) >= 10) return value.toFixed(4);
  return value.toFixed(5);
}

function getOutputSizeForInterval(interval) {
  const map = {
    "1min": "5000",
    "5min": "5000",
    "15min": "3000",
    "30min": "2000",
    "1h": "1000",
    "4h": "500",
    "1day": "50",
  };

  return map[interval] || "1000";
}

function stripCodeFence(text = "") {
  return String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonObject(text = "") {
  const cleaned = stripCodeFence(text);

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
}

function isUsableChartDateDetection(detection) {
  if (!detection || !detection.latestVisibleDate) return false;
  if (!parseISODateOnly(detection.latestVisibleDate)) return false;

  const confidence = String(detection.dateConfidence || "").toLowerCase();
  return confidence === "high" || confidence === "medium";
}

function chooseFinalChartDate({
  selectedDate,
  detection,
  analysisType = "post-trade",
}) {
  const mode = normalizeAnalysisType(analysisType);
  const detectedIsUsable = isUsableChartDateDetection(detection);
  const detectedDate = detectedIsUsable
    ? parseISODateOnly(detection.latestVisibleDate)
    : null;

  if (mode === "pre-trade" && selectedDate) {
    return {
      finalDate: selectedDate,
      finalDateText: formatDateOnly(selectedDate),
      selectedDateText: formatDateOnly(selectedDate),
      detectedDateText: detectedDate ? formatDateOnly(detectedDate) : null,
      source: "pre-trade-user-selected-date",
      reason:
        "Pre-trade mode was selected, so the user-selected date was treated as the decision date. Later candles visible on the chart were ignored to avoid hindsight bias.",
    };
  }

  if (mode === "pre-trade" && !selectedDate && detectedDate) {
    return {
      finalDate: detectedDate,
      finalDateText: formatDateOnly(detectedDate),
      selectedDateText: null,
      detectedDateText: formatDateOnly(detectedDate),
      source: "pre-trade-chart-detected-date-fallback",
      reason:
        "Pre-trade mode was selected but no user-selected date was provided, so the chart-detected latest visible date was used as a fallback.",
    };
  }

  if (mode === "post-trade" && selectedDate) {
    if (
      detectedDate &&
      detectedDate > selectedDate &&
      !isSameTradingWeek(selectedDate, detectedDate)
    ) {
      return {
        finalDate: selectedDate,
        finalDateText: formatDateOnly(selectedDate),
        selectedDateText: formatDateOnly(selectedDate),
        detectedDateText: formatDateOnly(detectedDate),
        source:
          "post-trade-user-selected-date-detected-date-outside-week-ignored",
        reason:
          "Post-trade mode was selected, but the chart-detected date appeared to fall outside the selected trade week. The user-selected date was used to prevent the analysis from jumping into the wrong week.",
      };
    }

    return {
      finalDate: selectedDate,
      finalDateText: formatDateOnly(selectedDate),
      selectedDateText: formatDateOnly(selectedDate),
      detectedDateText: detectedDate ? formatDateOnly(detectedDate) : null,
      source: "post-trade-user-selected-date",
      reason:
        "Post-trade mode was selected, so the user-selected date was used to identify the correct Monday-to-Friday trade week.",
    };
  }

  if (detectedDate) {
    return {
      finalDate: detectedDate,
      finalDateText: formatDateOnly(detectedDate),
      selectedDateText: null,
      detectedDateText: formatDateOnly(detectedDate),
      source: "chart-detected-date-fallback",
      reason:
        "No user-selected date was provided, so the chart-detected latest visible date was used as a fallback.",
    };
  }

  return {
    finalDate: null,
    finalDateText: "Not provided",
    selectedDateText: selectedDate ? formatDateOnly(selectedDate) : null,
    detectedDateText: null,
    source: "missing-date",
    reason:
      "No usable user-selected date or chart-detected latest visible date was available.",
  };
}

async function detectChartContextFromImage({ imageBase64, mimeType }) {
  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: CHART_DETECTION_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Inspect this chart screenshot and return only the JSON object requested.",
            },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${imageBase64}`,
            },
          ],
        },
      ],
      max_output_tokens: 350,
    });

    const parsed = extractJsonObject(response.output_text || "");

    return {
      ok: !!parsed,
      detectedInstrument: parsed?.detectedInstrument || null,
      detectedTimeframe: parsed?.detectedTimeframe || null,
      latestVisibleDate: parsed?.latestVisibleDate || null,
      dateConfidence: parsed?.dateConfidence || "low",
      notes: parsed?.notes || "",
      raw: response.output_text || "",
    };
  } catch (error) {
    console.error("Chart detection error:", error);

    return {
      ok: false,
      detectedInstrument: null,
      detectedTimeframe: null,
      latestVisibleDate: null,
      dateConfidence: "low",
      notes: `Chart detection failed: ${error.message}`,
      raw: "",
    };
  }
}

/*
  IMPORTANT FIX:
  This tolerance prevents errors like:
  - Tuesday low = 1.14005
  - Wednesday low = 1.14000

  Technically Wednesday is slightly lower, but this is not a clean break.
  It should be treated as equal low / retest / hold around 1.1400 unless price breaks by more than tolerance.
*/
function getCleanBreakTolerance(symbol = "") {
  const compact = comparableInstrument(symbol);

  if (compact.includes("JPY")) return 0.02;
  if (compact.includes("XAU")) return 0.2;
  if (compact.includes("BTC")) return 20;

  return 0.0002;
}

function compareHighWithTolerance(currentHigh, previousHigh, symbol = "") {
  const current = Number(currentHigh);
  const previous = Number(previousHigh);
  const tolerance = getCleanBreakTolerance(symbol);

  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return {
      cleanBreak: false,
      equalOrInsideTolerance: false,
      difference: null,
      tolerance,
      label: "unavailable",
    };
  }

  const difference = current - previous;

  if (difference > tolerance) {
    return {
      cleanBreak: true,
      equalOrInsideTolerance: false,
      difference,
      tolerance,
      label: "clean higher high",
    };
  }

  if (Math.abs(difference) <= tolerance) {
    return {
      cleanBreak: false,
      equalOrInsideTolerance: true,
      difference,
      tolerance,
      label: "equal high / retest of previous high",
    };
  }

  return {
    cleanBreak: false,
    equalOrInsideTolerance: false,
    difference,
    tolerance,
    label: "failed to break previous high",
  };
}

function compareLowWithTolerance(currentLow, previousLow, symbol = "") {
  const current = Number(currentLow);
  const previous = Number(previousLow);
  const tolerance = getCleanBreakTolerance(symbol);

  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return {
      cleanBreak: false,
      equalOrInsideTolerance: false,
      difference: null,
      tolerance,
      label: "unavailable",
    };
  }

  const difference = previous - current;

  if (difference > tolerance) {
    return {
      cleanBreak: true,
      equalOrInsideTolerance: false,
      difference,
      tolerance,
      label: "clean lower low",
    };
  }

  if (Math.abs(previous - current) <= tolerance) {
    return {
      cleanBreak: false,
      equalOrInsideTolerance: true,
      difference,
      tolerance,
      label: "equal low / retest of previous low",
    };
  }

  return {
    cleanBreak: false,
    equalOrInsideTolerance: false,
    difference,
    tolerance,
    label: "held above previous low",
  };
}

function buildDailyLevelsFromCandles(candles, weekRange) {
  const grouped = new Map();

  candles.forEach((bar) => {
    const dateOnly = candleDateOnly(bar.datetime);
    if (!dateOnly) return;

    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return;

    const dayNum = date.getUTCDay();

    if (dayNum < 1 || dayNum > 5) return;
    if (dateOnly < weekRange.startDate || dateOnly > weekRange.endDate) return;

    const open = safeNumber(bar.open);
    const high = safeNumber(bar.high);
    const low = safeNumber(bar.low);
    const close = safeNumber(bar.close);

    if (open === null || high === null || low === null || close === null) return;

    if (!grouped.has(dateOnly)) {
      grouped.set(dateOnly, {
        date: dateOnly,
        weekday: weekdayNameFromDate(dateOnly),
        dayNum,
        open,
        high,
        low,
        close,
        candleCount: 1,
        firstCandleTime: bar.datetime,
        lastCandleTime: bar.datetime,
      });
      return;
    }

    const day = grouped.get(dateOnly);
    day.high = Math.max(day.high, high);
    day.low = Math.min(day.low, low);
    day.close = close;
    day.candleCount += 1;
    day.lastCandleTime = bar.datetime;
  });

  return Array.from(grouped.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

function buildCsaAreas(dailyLevels = [], symbol = "") {
  const areas = [];

  dailyLevels.forEach((day, index) => {
    if (day.weekday === "Monday") {
      areas.push({
        day: "Monday",
        date: day.date,
        type: "resistance",
        price: day.high,
        priceText: formatPrice(day.high),
        logic: "Monday high represents Monday resistance.",
      });

      areas.push({
        day: "Monday",
        date: day.date,
        type: "support",
        price: day.low,
        priceText: formatPrice(day.low),
        logic: "Monday low represents Monday support.",
      });

      return;
    }

    const previous = dailyLevels[index - 1];

    if (!previous) {
      areas.push({
        day: day.weekday,
        date: day.date,
        type: "reference high",
        price: day.high,
        priceText: formatPrice(day.high),
        logic: `No previous weekday was available for comparison, so ${day.weekday} high is only a reference high.`,
      });

      areas.push({
        day: day.weekday,
        date: day.date,
        type: "reference low",
        price: day.low,
        priceText: formatPrice(day.low),
        logic: `No previous weekday was available for comparison, so ${day.weekday} low is only a reference low.`,
      });

      return;
    }

    const highComparison = compareHighWithTolerance(day.high, previous.high, symbol);
    const lowComparison = compareLowWithTolerance(day.low, previous.low, symbol);

    areas.push({
      day: day.weekday,
      date: day.date,
      type: highComparison.cleanBreak ? "resistance" : "supply",
      price: day.high,
      priceText: formatPrice(day.high),
      comparedWith: `${previous.weekday} ${previous.date}`,
      comparison: highComparison,
      logic: highComparison.cleanBreak
        ? `${day.weekday} high made a clean break above ${previous.weekday} high, so ${day.weekday} high is resistance.`
        : highComparison.equalOrInsideTolerance
        ? `${day.weekday} high only retested / stayed around ${previous.weekday} high within clean-break tolerance, so ${day.weekday} high is supply, not clean resistance expansion.`
        : `${day.weekday} high did not break above ${previous.weekday} high, so ${day.weekday} high is supply.`,
    });

    areas.push({
      day: day.weekday,
      date: day.date,
      type: lowComparison.cleanBreak ? "support" : "demand",
      price: day.low,
      priceText: formatPrice(day.low),
      comparedWith: `${previous.weekday} ${previous.date}`,
      comparison: lowComparison,
      logic: lowComparison.cleanBreak
        ? `${day.weekday} low made a clean break below ${previous.weekday} low, so ${day.weekday} low is support.`
        : lowComparison.equalOrInsideTolerance
        ? `${day.weekday} low only retested / stayed around ${previous.weekday} low within clean-break tolerance, so ${day.weekday} low is demand, not clean support expansion.`
        : `${day.weekday} low held above ${previous.weekday} low, so ${day.weekday} low is demand.`,
    });
  });

  return areas;
}

function calculateCsaDirectionalBias(dailyLevels = [], symbol = "") {
  if (!Array.isArray(dailyLevels) || dailyLevels.length < 2) {
    return {
      bias: "Insufficient data",
      biasCode: "insufficient",
      confidence: "low",
      bullishScore: 0,
      bearishScore: 0,
      highBreakCount: 0,
      lowBreakCount: 0,
      demandHoldCount: 0,
      supplyHoldCount: 0,
      higherCloseCount: 0,
      lowerCloseCount: 0,
      progression: [],
      reason:
        "At least two weekdays are needed to compare CSA progression and form a directional bias.",
      trendTradingFocus:
        "There is not enough CSA progression yet to define a clear trend-following focus.",
      counterTrendCaution:
        "Counter-trend interpretation is not reliable until more weekday structure is available.",
    };
  }

  let bullishScore = 0;
  let bearishScore = 0;
  let highBreakCount = 0;
  let lowBreakCount = 0;
  let demandHoldCount = 0;
  let supplyHoldCount = 0;
  let higherCloseCount = 0;
  let lowerCloseCount = 0;
  const progression = [];

  for (let i = 1; i < dailyLevels.length; i += 1) {
    const current = dailyLevels[i];
    const previous = dailyLevels[i - 1];

    const highComparison = compareHighWithTolerance(
      current.high,
      previous.high,
      symbol
    );

    const lowComparison = compareLowWithTolerance(
      current.low,
      previous.low,
      symbol
    );

    const highBreak = highComparison.cleanBreak;
    const lowBreak = lowComparison.cleanBreak;
    const demandHeld = !lowBreak;
    const supplyHeld = !highBreak;
    const closeHigher = current.close > previous.close;
    const closeLower = current.close < previous.close;

    if (highBreak) {
      bullishScore += 2;
      highBreakCount += 1;
    } else if (supplyHeld) {
      bearishScore += 1;
      supplyHoldCount += 1;
    }

    if (demandHeld) {
      bullishScore += 1.5;
      demandHoldCount += 1;
    } else if (lowBreak) {
      bearishScore += 2;
      lowBreakCount += 1;
    }

    if (closeHigher) {
      bullishScore += 0.5;
      higherCloseCount += 1;
    } else if (closeLower) {
      bearishScore += 0.5;
      lowerCloseCount += 1;
    }

    let line = `${current.weekday} ${current.date}: `;

    if (highBreak && demandHeld) {
      line += `bullish progression because ${current.weekday} made a clean break above ${previous.weekday}'s high and did not cleanly break below ${previous.weekday}'s low.`;
    } else if (lowBreak && supplyHeld) {
      line += `bearish progression because ${current.weekday} made a clean break below ${previous.weekday}'s low and did not cleanly break above ${previous.weekday}'s high.`;
    } else if (highBreak && lowBreak) {
      line += `expanded both sides because ${current.weekday} made a clean break above the previous high and below the previous low, so the bias is less clean.`;
    } else if (supplyHeld && demandHeld) {
      line += `range compression / retest condition because ${current.weekday} did not cleanly break the previous day's high or low.`;
    } else {
      line += `no clean directional expansion compared with ${previous.weekday}.`;
    }

    progression.push(line);
  }

  const scoreDifference = bullishScore - bearishScore;
  const totalComparisons = dailyLevels.length - 1;

  let bias = "Mixed / Range-bound";
  let biasCode = "mixed";
  let confidence = "medium";

  if (
    scoreDifference >= 2 &&
    highBreakCount >= 1 &&
    demandHoldCount >= lowBreakCount
  ) {
    bias = "Bullish";
    biasCode = "bullish";
  } else if (
    scoreDifference <= -2 &&
    lowBreakCount >= 1 &&
    supplyHoldCount >= highBreakCount
  ) {
    bias = "Bearish";
    biasCode = "bearish";
  }

  if (totalComparisons <= 1) {
    confidence = "low";
  } else if (Math.abs(scoreDifference) >= 4) {
    confidence = "high";
  } else if (Math.abs(scoreDifference) < 2) {
    confidence = "low";
  }

  let reason = "";
  let trendTradingFocus = "";
  let counterTrendCaution = "";

  if (biasCode === "bullish") {
    reason = `The CSA progression is bullish because the week shows ${highBreakCount} clean high break(s), ${demandHoldCount} demand hold/retest condition(s), and ${higherCloseCount} higher close comparison(s). Resistance is being pushed higher while demand/support is mostly holding.`;
    trendTradingFocus =
      "For CSA trend trading, demand/support areas and broken resistance areas that may become support after breaking to the other side and holding are the main potential buyer areas.";
    counterTrendCaution =
      "Supply/resistance areas can still create reactions, but counter-trend selling against bullish CSA progression should be treated with more caution.";
  } else if (biasCode === "bearish") {
    reason = `The CSA progression is bearish because the week shows ${lowBreakCount} clean low break(s), ${supplyHoldCount} supply hold/retest condition(s), and ${lowerCloseCount} lower close comparison(s). Support is being pushed lower while supply/resistance is mostly holding.`;
    trendTradingFocus =
      "For CSA trend trading, supply/resistance areas and broken support areas that may become resistance after breaking to the other side and holding are the main potential seller areas.";
    counterTrendCaution =
      "Demand/support areas can still create reactions, but counter-trend buying against bearish CSA progression should be treated with more caution.";
  } else {
    reason = `The CSA progression is mixed/range-bound because bullish and bearish structure signals are conflicting. The week shows ${highBreakCount} clean high break(s), ${lowBreakCount} clean low break(s), ${demandHoldCount} demand hold/retest condition(s), and ${supplyHoldCount} supply hold/retest condition(s).`;
    trendTradingFocus =
      "For CSA trend trading, it may be better to wait for cleaner CSA progression before placing more weight on trend-following areas.";
    counterTrendCaution =
      "Counter-trend reactions may appear inside mixed/ranging conditions, but the middle of the range is lower quality.";
  }

  return {
    bias,
    biasCode,
    confidence,
    bullishScore,
    bearishScore,
    scoreDifference,
    highBreakCount,
    lowBreakCount,
    demandHoldCount,
    supplyHoldCount,
    higherCloseCount,
    lowerCloseCount,
    progression,
    reason,
    trendTradingFocus,
    counterTrendCaution,
  };
}

async function fetchTwelveDataIntradayLevels({
  symbol,
  chartDate,
  timeframe = "H1",
  timezone = "UTC",
  useFullWeek = false,
}) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const interval = normalizeTimeframe(timeframe);

  if (!apiKey) {
    return {
      ok: false,
      error: "TWELVE_DATA_API_KEY is missing on the server.",
      dailyLevels: [],
      csaAreas: [],
      directionalBias: calculateCsaDirectionalBias([], symbol),
      rawCandleCount: 0,
      weekRange: chartDate ? getWeekRangeForDate(chartDate, useFullWeek) : null,
      interval,
      useFullWeek,
    };
  }

  if (!symbol) {
    return {
      ok: false,
      error: "Instrument/pair is missing or unsupported.",
      dailyLevels: [],
      csaAreas: [],
      directionalBias: calculateCsaDirectionalBias([], symbol),
      rawCandleCount: 0,
      weekRange: chartDate ? getWeekRangeForDate(chartDate, useFullWeek) : null,
      interval,
      useFullWeek,
    };
  }

  if (!chartDate) {
    return {
      ok: false,
      error:
        "Final visible chart date is missing. Add the latest date visible on the chart so the backend can fetch the correct Monday-to-Friday data.",
      dailyLevels: [],
      csaAreas: [],
      directionalBias: calculateCsaDirectionalBias([], symbol),
      rawCandleCount: 0,
      weekRange: null,
      interval,
      useFullWeek,
    };
  }

  const weekRange = getWeekRangeForDate(chartDate, useFullWeek);

  const params = new URLSearchParams({
    symbol,
    interval,
    start_date: `${weekRange.startDate} 00:00:00`,
    end_date: `${weekRange.endDate} 23:59:59`,
    timezone,
    order: "ASC",
    outputsize: getOutputSizeForInterval(interval),
    apikey: apiKey,
  });

  const url = `${TWELVE_DATA_BASE_URL}?${params.toString()}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.status === "error" || !Array.isArray(data.values)) {
    return {
      ok: false,
      error:
        data.message ||
        data.error ||
        `Twelve Data request failed with status ${response.status}.`,
      dailyLevels: [],
      csaAreas: [],
      directionalBias: calculateCsaDirectionalBias([], symbol),
      rawCandleCount: 0,
      weekRange,
      symbol,
      timezone,
      interval,
      useFullWeek,
      twelveDataStatus: data.status || "unknown",
    };
  }

  const rawCandles = data.values || [];
  const dailyLevels = buildDailyLevelsFromCandles(rawCandles, weekRange);
  const csaAreas = buildCsaAreas(dailyLevels, symbol);
  const directionalBias = calculateCsaDirectionalBias(dailyLevels, symbol);

  return {
    ok: dailyLevels.length > 0,
    error:
      dailyLevels.length > 0
        ? ""
        : "No Monday-to-Friday intraday candles were returned for the selected week/date/timeframe.",
    dailyLevels,
    csaAreas,
    directionalBias,
    rawCandleCount: rawCandles.length,
    weekRange,
    symbol,
    timezone,
    interval,
    useFullWeek,
    meta: data.meta || null,
  };
}

function formatShortAreaList(areas, areaType) {
  if (!Array.isArray(areas) || !areas.length) {
    return "- None identified.";
  }

  const sortedAreas = [...areas].sort((a, b) => {
    const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
    if (dateCompare !== 0) return dateCompare;
    return Number(b.price || 0) - Number(a.price || 0);
  });

  return sortedAreas
    .slice(0, 3)
    .map((area) => {
      const day = area.day || "Selected week";
      const price = area.priceText || formatPrice(area.price);
      return `- ${day} ${areaType}: ${price}`;
    })
    .join("\n");
}

function buildTrendFollowingPriorityText(bias = {}) {
  const biasValue = String(bias.bias || "").toLowerCase();

  if (biasValue.includes("bullish")) {
    return "Because CSA bias is bullish, demand/support areas and broken resistance areas that may become support after breaking to the other side and holding are more important for trend-following buyers.";
  }

  if (biasValue.includes("bearish")) {
    return "Because CSA bias is bearish, supply/resistance areas and broken support areas that may become resistance after breaking to the other side and holding are more important for trend-following sellers.";
  }

  if (biasValue.includes("mixed") || biasValue.includes("range")) {
    return "Because CSA bias is mixed/range-bound, trend-trading conditions are less clear. Focus more on the outer support/demand and resistance/supply areas, not the middle of the range.";
  }

  return "CSA bias is not strong enough yet, so focus on the clearest support, resistance, supply, and demand areas from the selected week.";
}

function orderedAreas(areas, options = {}) {
  const { includeMonday = false } = options;

  if (!Array.isArray(areas) || !areas.length) return [];

  return [...areas]
    .filter((area) => {
      if (includeMonday) return true;
      return String(area.day || "").toLowerCase() !== "monday";
    })
    .sort((a, b) => {
      const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
      if (dateCompare !== 0) return dateCompare;
      return Number(a.price || 0) - Number(b.price || 0);
    });
}

function formatAreaPrice(area) {
  return area?.priceText || formatPrice(area?.price);
}

function laterDaysAfterArea(area, dailyLevels = []) {
  if (!area?.date || !Array.isArray(dailyLevels)) return [];

  return dailyLevels
    .filter((day) => String(day.date || "") > String(area.date || ""))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function resistanceWasBrokenLater(area, dailyLevels = [], symbol = "") {
  const laterDays = laterDaysAfterArea(area, dailyLevels);
  const level = Number(area?.price);
  const tolerance = getCleanBreakTolerance(symbol);

  if (!Number.isFinite(level)) return false;

  return laterDays.some((day) => Number(day.high) > level + tolerance);
}

function supportWasBrokenLater(area, dailyLevels = [], symbol = "") {
  const laterDays = laterDaysAfterArea(area, dailyLevels);
  const level = Number(area?.price);
  const tolerance = getCleanBreakTolerance(symbol);

  if (!Number.isFinite(level)) return false;

  return laterDays.some((day) => Number(day.low) < level - tolerance);
}

function demandWasReturnedToLater(area, dailyLevels = [], symbol = "") {
  const laterDays = laterDaysAfterArea(area, dailyLevels);
  const level = Number(area?.price);
  const tolerance = getCleanBreakTolerance(symbol);

  if (!Number.isFinite(level)) return false;

  return laterDays.some((day) => {
    const low = Number(day.low);
    const close = Number(day.close);

    if (!Number.isFinite(low) || !Number.isFinite(close)) return false;

    return low <= level + tolerance && close >= level - tolerance;
  });
}

function supplyWasReturnedToLater(area, dailyLevels = [], symbol = "") {
  const laterDays = laterDaysAfterArea(area, dailyLevels);
  const level = Number(area?.price);
  const tolerance = getCleanBreakTolerance(symbol);

  if (!Number.isFinite(level)) return false;

  return laterDays.some((day) => {
    const high = Number(day.high);
    const close = Number(day.close);

    if (!Number.isFinite(high) || !Number.isFinite(close)) return false;

    return high >= level - tolerance && close <= level + tolerance;
  });
}

function buildResistanceBuyerStory(area, dailyLevels = [], symbol = "") {
  const level = formatAreaPrice(area);

  if (resistanceWasBrokenLater(area, dailyLevels, symbol)) {
    return `- ${area.day}: ${area.day} resistance at ${level} was cleanly broken later in the week, so that area can now be treated as a potential support/buyer area if price returns, retraces, or pulls back and holds above it.`;
  }

  return `- ${area.day}: ${area.day} resistance at ${level} has not been cleanly broken by later selected-week data, so it remains resistance until price breaks to the other side and holds above it.`;
}

function buildSupportSellerStory(area, dailyLevels = [], symbol = "") {
  const level = formatAreaPrice(area);

  if (supportWasBrokenLater(area, dailyLevels, symbol)) {
    return `- ${area.day}: ${area.day} support at ${level} was cleanly broken later in the week, so that area can now be treated as a potential resistance/seller area if price returns, retraces, or pulls back and holds below it.`;
  }

  return `- ${area.day}: ${area.day} support at ${level} has not been cleanly broken by later selected-week data, so it remains support until price breaks to the other side and holds below it.`;
}

function buildDemandBuyerStory(area, dailyLevels = [], symbol = "") {
  const level = formatAreaPrice(area);

  if (demandWasReturnedToLater(area, dailyLevels, symbol)) {
    return `- ${area.day}: ${area.day} demand at ${level} was returned/retraced into later in the week and held around the level, so it was a valid potential buyer area within the CSA story.`;
  }

  return `- ${area.day}: ${area.day} demand at ${level} remains a potential buyer area if price later pulls back, returns, or retraces into it and holds while the bullish structure remains valid.`;
}

function buildSupplySellerStory(area, dailyLevels = [], symbol = "") {
  const level = formatAreaPrice(area);

  if (supplyWasReturnedToLater(area, dailyLevels, symbol)) {
    return `- ${area.day}: ${area.day} supply at ${level} was returned/retraced into later in the week and rejected around the level, so it was a valid potential seller area within the CSA story.`;
  }

  return `- ${area.day}: ${area.day} supply at ${level} remains a potential seller area if price later pulls back, returns, or retraces into it and rejects while the bearish structure remains valid.`;
}

function buildPotentialTrendEntryAreas({
  resistanceAreas,
  supportAreas,
  supplyAreas,
  demandAreas,
  dailyLevels,
  bias,
  symbol,
}) {
  const biasValue = String(bias?.bias || "").toLowerCase();

  const orderedResistance = orderedAreas(resistanceAreas);
  const orderedSupport = orderedAreas(supportAreas);
  const orderedSupply = orderedAreas(supplyAreas);
  const orderedDemand = orderedAreas(demandAreas);

  const buyerLines = [];
  const sellerLines = [];

  if (biasValue.includes("bullish")) {
    orderedDemand.forEach((area) => {
      buyerLines.push(buildDemandBuyerStory(area, dailyLevels, symbol));
    });

    orderedSupport.forEach((area) => {
      buyerLines.push(
        `- ${area.day}: ${area.day} support at ${formatAreaPrice(area)} was a potential buyer area if price returned to it and held while price continued pushing higher.`
      );
    });

    orderedResistance.forEach((area) => {
      buyerLines.push(buildResistanceBuyerStory(area, dailyLevels, symbol));
    });

    orderedSupply.forEach((area) => {
      sellerLines.push(
        `- ${area.day}: ${area.day} supply at ${formatAreaPrice(area)} may still create a reaction, but it is counter-trend while CSA bias remains bullish.`
      );
    });
  } else if (biasValue.includes("bearish")) {
    orderedSupply.forEach((area) => {
      sellerLines.push(buildSupplySellerStory(area, dailyLevels, symbol));
    });

    orderedResistance.forEach((area) => {
      sellerLines.push(
        `- ${area.day}: ${area.day} resistance at ${formatAreaPrice(area)} was a potential seller area if price returned to it and rejected while price continued pushing lower.`
      );
    });

    orderedSupport.forEach((area) => {
      sellerLines.push(buildSupportSellerStory(area, dailyLevels, symbol));
    });

    orderedDemand.forEach((area) => {
      buyerLines.push(
        `- ${area.day}: ${area.day} demand at ${formatAreaPrice(area)} may still create a reaction, but it is counter-trend while CSA bias remains bearish.`
      );
    });
  } else {
    orderedDemand.forEach((area) => {
      buyerLines.push(
        `- ${area.day}: ${area.day} demand at ${formatAreaPrice(area)} can be watched as a potential buyer area only if price reacts clearly, because CSA bias is not clean yet.`
      );
    });

    orderedSupport.forEach((area) => {
      buyerLines.push(
        `- ${area.day}: ${area.day} support at ${formatAreaPrice(area)} can be watched as an outer buyer area, but trend direction is not clean yet.`
      );
    });

    orderedSupply.forEach((area) => {
      sellerLines.push(
        `- ${area.day}: ${area.day} supply at ${formatAreaPrice(area)} can be watched as a potential seller area only if price rejects clearly, because CSA bias is not clean yet.`
      );
    });

    orderedResistance.forEach((area) => {
      sellerLines.push(
        `- ${area.day}: ${area.day} resistance at ${formatAreaPrice(area)} can be watched as an outer seller area, but trend direction is not clean yet.`
      );
    });
  }

  const buyerText = buyerLines.length
    ? buyerLines.slice(0, 8).join("\n")
    : "- None identified from the selected-week CSA structure.";

  const sellerText = sellerLines.length
    ? sellerLines.slice(0, 8).join("\n")
    : "- None identified from the selected-week CSA structure.";

  return `Potential Entry Areas Based on CSA Trend Trading:

Potential Buyer Areas:
${buyerText}

Potential Seller Areas:
${sellerText}

Trend Trading Note:
- This is trend trading because the focus is on using CSA areas in the direction of the CSA bias.
- A resistance area becomes relevant as potential support only after later price breaks above it by more than the clean-break tolerance.
- After resistance is broken, the area can be watched as potential support if price returns, retraces, or pulls back and holds above it.
- A support area becomes relevant as potential resistance only after later price breaks below it by more than the clean-break tolerance.
- After support is broken, the area can be watched as potential resistance if price returns, retraces, or pulls back and holds below it.
- Demand can act as a potential buyer area when price pulls back, returns, or retraces into it while the bullish structure remains valid.
- Supply can act as a potential seller area when price pulls back, returns, or retraces into it while the bearish structure remains valid.
- These are potential areas only, not buy/sell signals.
- Wait for price reaction or confirmation before treating any area as valid.`;
}

function buildDataTable(dailyLevels = [], symbol = "") {
  if (!dailyLevels.length) return "- No weekday data available.";

  return dailyLevels
    .map((day, index) => {
      if (index === 0) {
        return `- ${day.weekday} ${day.date}: High ${formatPrice(
          day.high
        )}, Low ${formatPrice(day.low)}. Monday high is resistance; Monday low is support.`;
      }

      const previous = dailyLevels[index - 1];
      const highComparison = compareHighWithTolerance(
        day.high,
        previous.high,
        symbol
      );
      const lowComparison = compareLowWithTolerance(day.low, previous.low, symbol);

      const highText = highComparison.cleanBreak
        ? `cleanly broke above ${previous.weekday}'s high`
        : highComparison.equalOrInsideTolerance
        ? `retested / stayed around ${previous.weekday}'s high within tolerance`
        : `failed to break above ${previous.weekday}'s high`;

      const lowText = lowComparison.cleanBreak
        ? `cleanly broke below ${previous.weekday}'s low`
        : lowComparison.equalOrInsideTolerance
        ? `retested / stayed around ${previous.weekday}'s low within tolerance`
        : `held above ${previous.weekday}'s low`;

      return `- ${day.weekday} ${day.date}: High ${formatPrice(
        day.high
      )}, Low ${formatPrice(day.low)}. High ${highText}. Low ${lowText}.`;
    })
    .join("\n");
}

function buildDeterministicCsaAnalysis({
  marketReference,
  dateDecision,
  chartDetection,
  analysisType,
  submittedInstrument,
  normalizedSymbol,
  timeframe,
  timezone,
}) {
  const mode = normalizeAnalysisType(analysisType);

  if (!marketReference || !marketReference.ok) {
    return `Data Source Check:
- Market-data reference was unavailable.
- Reason: ${marketReference?.error || "Unknown error"}
- Because backend OHLC data was not available, exact day-to-day break confirmation should not be treated as final from the screenshot alone.

Date Check:
- User-selected date: ${dateDecision.selectedDateText || "Not provided"}
- Chart-detected latest visible date: ${
      dateDecision.detectedDateText || "Not detected"
    }
- Final date used: ${dateDecision.finalDateText}
- Reason: ${dateDecision.reason}

Week Used:
- Not available because market data was unavailable.

Monday-to-Friday CSA Area Breakdown:
- Not available from backend OHLC data.

CSA Directional Bias:
- Insufficient data

Confidence:
- Low

Reason:
- The coach should not make definite statements like "Wednesday broke Tuesday low" or "Wednesday did not break Tuesday low" without backend OHLC values.

Current Key Areas of Interest:

Resistance:
- None identified.

Support:
- None identified.

Supply:
- None identified.

Demand:
- None identified.

Trend-Following Priority:
- Wait for backend data or clearer chart information before confirming CSA levels.

Potential Entry Areas Based on CSA Trend Trading:
- Not available because market-data-backed CSA levels were not available.

Chart/Image Notes:
- Detected instrument: ${chartDetection?.detectedInstrument || "Not detected"}
- Detected timeframe: ${chartDetection?.detectedTimeframe || "Not detected"}
- Detection notes: ${chartDetection?.notes || "None"}

Missing Information:
- Backend OHLC data is required for clean break/retest confirmation.`;
  }

  const dailyLevels = marketReference.dailyLevels || [];
  const areas = marketReference.csaAreas || [];
  const bias = marketReference.directionalBias || calculateCsaDirectionalBias([]);
  const tolerance = getCleanBreakTolerance(normalizedSymbol);

  const resistanceAreas = areas.filter((area) => area.type === "resistance");
  const supportAreas = areas.filter((area) => area.type === "support");
  const supplyAreas = areas.filter((area) => area.type === "supply");
  const demandAreas = areas.filter((area) => area.type === "demand");

  const areaBreakdown = areas.length
    ? areas
        .map((area) => `- ${area.day}: ${area.type.toUpperCase()} at ${area.priceText}. ${area.logic}`)
        .join("\n")
    : "- No CSA areas calculated.";

  const progressionNotes = Array.isArray(bias.progression) && bias.progression.length
    ? bias.progression.map((line) => `- ${line}`).join("\n")
    : "- Not enough progression data available.";

  const potentialTrendEntryAreas = buildPotentialTrendEntryAreas({
    resistanceAreas,
    supportAreas,
    supplyAreas,
    demandAreas,
    dailyLevels,
    bias,
    symbol: normalizedSymbol,
  });

  return `Data Source Check:
- Market-data reference: Available from Twelve Data.
- Symbol used: ${marketReference.symbol}
- Selected instrument: ${submittedInstrument}
- Timeframe used for OHLC calculation: ${marketReference.interval}
- Timezone used: ${timezone}
- Clean-break tolerance used: ${formatPrice(tolerance)}
- Important: The feedback below uses backend OHLC values as the source of truth. The chart image is used only for visual context and mismatch checks.

Date Check:
- User-selected date: ${dateDecision.selectedDateText || "Not provided"}
- Chart-detected latest visible date: ${
    dateDecision.detectedDateText || "Not detected"
  }
- Chart detection confidence: ${chartDetection?.dateConfidence || "low"}
- Final date used to identify trade week: ${dateDecision.finalDateText}
- Analysis mode: ${mode}
- Date source: ${dateDecision.source}
- Reason: ${dateDecision.reason}

Week Used:
- Monday: ${marketReference.weekRange.startDate}
- Friday: ${marketReference.weekRange.fridayDate}
- Data used up to: ${marketReference.weekRange.endDate}
- Raw candles returned: ${marketReference.rawCandleCount}
- Sunday candles: ignored.

Monday-to-Friday CSA Area Breakdown:
${buildDataTable(dailyLevels, normalizedSymbol)}

CSA Area Classification:
${areaBreakdown}

CSA Directional Bias:
- ${bias.bias}

Confidence:
- ${bias.confidence}

Reason:
- ${bias.reason}

CSA Progression Notes:
${progressionNotes}

Current Key Areas of Interest:

Resistance:
${formatShortAreaList(resistanceAreas, "resistance")}

Support:
${formatShortAreaList(supportAreas, "support")}

Supply:
${formatShortAreaList(supplyAreas, "supply")}

Demand:
${formatShortAreaList(demandAreas, "demand")}

Trend-Following Priority:
- ${buildTrendFollowingPriorityText(bias)}

${potentialTrendEntryAreas}

Chart/Image Notes:
- Detected instrument from chart: ${chartDetection?.detectedInstrument || "Not detected"}
- Detected timeframe from chart: ${chartDetection?.detectedTimeframe || "Not detected"}
- Detected latest visible date: ${chartDetection?.latestVisibleDate || "Not detected"}
- Detection notes: ${chartDetection?.notes || "None"}
- Broker chart prices may differ slightly from Twelve Data levels.

Missing Information:
- None for market-data-backed CSA area identification.
- Stop loss, take profit, risk-to-reward, and trade management are intentionally not reviewed at this stage.`;
}

function buildInstrumentMismatchAnalysis({
  selectedInstrument,
  detectedInstrument,
  selectedTimeframe,
  detectedTimeframe,
}) {
  return `Chart Context Mismatch:

Selected Instrument:
${selectedInstrument || "Not provided"}

Detected Chart Instrument:
${detectedInstrument || "Not detected"}

Selected Timeframe:
${selectedTimeframe || "Not provided"}

Detected Chart Timeframe:
${detectedTimeframe || "Not detected"}

Why Analysis Was Stopped:
The selected instrument does not match the uploaded chart. CSA Coach cannot provide reliable market-data-backed feedback because the market data would be calculated for one instrument while the screenshot shows another instrument.

How To Fix:
- Change the selected pair to match the uploaded chart, or
- Upload the correct chart for the selected pair.

No CSA area breakdown, directional bias, potential trend-trading area, or key level was generated for this request.`;
}

function buildTimeframeMismatchAnalysis({
  selectedInstrument,
  detectedInstrument,
  selectedTimeframe,
  detectedTimeframe,
}) {
  return `Chart Timeframe Mismatch:

Selected Instrument:
${selectedInstrument || "Not provided"}

Detected Chart Instrument:
${detectedInstrument || "Not detected"}

Selected Timeframe:
${selectedTimeframe || "Not provided"}

Detected Chart Timeframe:
${detectedTimeframe || "Not detected"}

Why Analysis Was Stopped:
The selected timeframe does not match the uploaded chart timeframe. CSA Coach cannot provide reliable market-data-backed feedback because the backend would calculate CSA levels using the selected timeframe while the screenshot shows a different timeframe.

How To Fix:
- Change the selected timeframe to match the uploaded chart, or
- Upload a chart that matches the selected timeframe.

No CSA area breakdown, directional bias, potential trend-trading area, or key level was generated for this request.`;
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "CSA Coach backend is running",
  });
});

app.get("/test-twelve", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol || "GBP/USD");
    const timeframe = req.query.timeframe || "H1";
    const date = req.query.date || "2026-06-30";
    const timezone = req.query.timezone || "UTC";
    const mode = normalizeAnalysisType(req.query.analysisType || "post-trade");
    const useFullWeek =
      mode === "post-trade" ||
      String(req.query.useFullWeek || "").toLowerCase() === "true";

    const chartDate = parseISODateOnly(date);

    if (!chartDate) {
      return res.status(400).json({
        ok: false,
        error: "Invalid date. Use YYYY-MM-DD format.",
      });
    }

    const result = await fetchTwelveDataIntradayLevels({
      symbol,
      chartDate,
      timeframe,
      timezone,
      useFullWeek,
    });

    res.json({
      ok: result.ok,
      symbol,
      timeframe,
      interval: result.interval,
      date,
      timezone,
      analysisType: mode,
      useFullWeek,
      error: result.error,
      weekRange: result.weekRange,
      rawCandleCount: result.rawCandleCount,
      dailyLevels: result.dailyLevels,
      csaAreas: result.csaAreas,
      directionalBias: result.directionalBias,
      cleanBreakTolerance: getCleanBreakTolerance(symbol),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/analyze-chart", upload.single("chart"), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing on the server.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "No chart image uploaded.",
      });
    }

    const {
      timeframe = "Not provided",
      instrument = "",
      pair = "",
      selectedPair = "",
      analysisType = "post-trade",
      notes = "",
      userNotes = "",
      chartDate = "",
      tradeDate = "",
      timezone = "UTC",
    } = req.body;

    const submittedInstrument =
      instrument || pair || selectedPair || "Not provided";

    const submittedNotes = notes || userNotes || "";
    const normalizedSymbol = normalizeSymbol(submittedInstrument);
    const mode = normalizeAnalysisType(analysisType);
    const useFullWeek = mode === "post-trade";

    const imageBase64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/png";

    const selectedDate = parseISODateOnly(chartDate || tradeDate);

    const chartDetection = await detectChartContextFromImage({
      imageBase64,
      mimeType,
    });

    const instrumentMismatch = hasStrongInstrumentMismatch({
      selectedInstrument: normalizedSymbol || submittedInstrument,
      detectedInstrument: chartDetection.detectedInstrument,
    });

    if (instrumentMismatch) {
      const mismatchAnalysis = buildInstrumentMismatchAnalysis({
        selectedInstrument: submittedInstrument,
        detectedInstrument: chartDetection.detectedInstrument,
        selectedTimeframe: timeframe,
        detectedTimeframe: chartDetection.detectedTimeframe,
      });

      return res.status(200).json({
        success: false,
        errorType: "instrument_mismatch",
        error: "Selected instrument does not match uploaded chart.",
        analysis: mismatchAnalysis,
        summary: mismatchAnalysis,
        selectedPair: submittedInstrument,
        selectedTimeframe: timeframe,
        detectedPair: chartDetection.detectedInstrument || "Not detected",
        detectedTimeframe: chartDetection.detectedTimeframe || "Not detected",
        detectedLatestVisibleDate:
          chartDetection.latestVisibleDate || "Not detected",
        contextStatus:
          "Analysis stopped because selected instrument does not match uploaded chart.",
        grade: "--",
        confidence: 0,
        structureScore: 0,
        executionScore: 0,
        riskScore: 0,
        strengths: [],
        weaknesses: [
          "Instrument mismatch detected. Market-data-backed CSA feedback was not generated.",
        ],
        coachAdvice: [mismatchAnalysis],
        journalTags: ["instrument-mismatch", "analysis-stopped"],
        chartDetection,
        marketReference: {
          ok: false,
          error: "Instrument mismatch. Market data was not fetched.",
          symbol: normalizedSymbol,
          timezone,
          interval: normalizeTimeframe(timeframe),
          rawCandleCount: 0,
          weekRange: null,
          dailyLevels: [],
          csaAreas: [],
          directionalBias: calculateCsaDirectionalBias([], normalizedSymbol),
          useFullWeek,
        },
      });
    }

    const timeframeMismatch = hasStrongTimeframeMismatch({
      selectedTimeframe: timeframe,
      detectedTimeframe: chartDetection.detectedTimeframe,
    });

    if (timeframeMismatch) {
      const mismatchAnalysis = buildTimeframeMismatchAnalysis({
        selectedInstrument: submittedInstrument,
        detectedInstrument: chartDetection.detectedInstrument,
        selectedTimeframe: timeframe,
        detectedTimeframe: chartDetection.detectedTimeframe,
      });

      return res.status(200).json({
        success: false,
        errorType: "timeframe_mismatch",
        error: "Selected timeframe does not match uploaded chart timeframe.",
        analysis: mismatchAnalysis,
        summary: mismatchAnalysis,
        selectedPair: submittedInstrument,
        selectedTimeframe: timeframe,
        detectedPair: chartDetection.detectedInstrument || "Not detected",
        detectedTimeframe: chartDetection.detectedTimeframe || "Not detected",
        detectedLatestVisibleDate:
          chartDetection.latestVisibleDate || "Not detected",
        contextStatus:
          "Analysis stopped because selected timeframe does not match uploaded chart timeframe.",
        grade: "--",
        confidence: 0,
        structureScore: 0,
        executionScore: 0,
        riskScore: 0,
        strengths: [],
        weaknesses: [
          "Timeframe mismatch detected. Market-data-backed CSA feedback was not generated.",
        ],
        coachAdvice: [mismatchAnalysis],
        journalTags: ["timeframe-mismatch", "analysis-stopped"],
        chartDetection,
        marketReference: {
          ok: false,
          error: "Timeframe mismatch. Market data was not fetched.",
          symbol: normalizedSymbol,
          timezone,
          interval: normalizeTimeframe(timeframe),
          rawCandleCount: 0,
          weekRange: null,
          dailyLevels: [],
          csaAreas: [],
          directionalBias: calculateCsaDirectionalBias([], normalizedSymbol),
          useFullWeek,
        },
      });
    }

    const dateDecision = chooseFinalChartDate({
      selectedDate,
      detection: chartDetection,
      analysisType: mode,
    });

    const marketReference = await fetchTwelveDataIntradayLevels({
      symbol: normalizedSymbol,
      chartDate: dateDecision.finalDate,
      timeframe,
      timezone: timezone || "UTC",
      useFullWeek,
    });

    const analysis = buildDeterministicCsaAnalysis({
      marketReference,
      dateDecision,
      chartDetection,
      analysisType: mode,
      submittedInstrument,
      normalizedSymbol,
      timeframe,
      timezone: timezone || "UTC",
      submittedNotes,
    });

    const bias =
      marketReference.directionalBias ||
      calculateCsaDirectionalBias([], normalizedSymbol);

    res.json({
      success: true,
      analysis,
      summary: analysis,
      selectedPair: submittedInstrument,
      selectedTimeframe: timeframe,
      selectedDate: chartDate || tradeDate || "Not provided",
      analysisType: mode,
      useFullWeek,
      detectedPair:
        chartDetection.detectedInstrument || normalizedSymbol || "Not available",
      detectedTimeframe: chartDetection.detectedTimeframe || timeframe,
      detectedLatestVisibleDate:
        chartDetection.latestVisibleDate || "Not detected",
      finalDateUsed: dateDecision.finalDateText,
      dateDecision,
      csaDirectionalBias: bias,
      contextStatus: marketReference.ok
        ? useFullWeek
          ? "Market-data-backed post-trade full-week area identification and trend-trading area review completed"
          : "Market-data-backed pre-trade date-capped area identification and trend-trading area review completed"
        : `Area identification completed without market data: ${marketReference.error}`,
      grade: "--",
      confidence: 0,
      structureScore: 0,
      executionScore: 0,
      riskScore: 0,
      strengths: marketReference.ok
        ? [
            `CSA areas calculated from Twelve Data ${marketReference.interval} candles for the selected Monday-to-Friday week.`,
            useFullWeek
              ? "Post-trade review used the full Monday-to-Friday week containing the selected trade date."
              : "Pre-trade analysis used only the selected/final decision date range to avoid hindsight bias.",
            `CSA directional bias calculated as ${bias.bias} with ${bias.confidence} confidence.`,
            "Potential trend-trading areas were identified using CSA role-change, demand, and supply rules.",
            `Clean-break tolerance applied: ${formatPrice(
              getCleanBreakTolerance(normalizedSymbol)
            )}.`,
          ]
        : [
            "CSA area identification completed using the uploaded chart, but market-data reference was unavailable.",
          ],
      weaknesses: marketReference.ok
        ? [
            "Broker chart prices may differ slightly from Twelve Data reference levels.",
            "CSA directional bias and potential trend-trading areas are structural context only, not buy/sell signals.",
          ]
        : [marketReference.error || "Market-data reference unavailable."],
      coachAdvice: [analysis],
      journalTags: [
        "area identification only",
        "directional bias",
        "potential trend-trading areas",
        "role-change framework",
        useFullWeek ? "post-trade-full-week" : "pre-trade-date-capped",
        marketReference.ok ? "market-data-backed" : "vision-only fallback",
        bias.biasCode || "bias-unavailable",
      ],
      chartDetection,
      marketReference: {
        ok: marketReference.ok,
        error: marketReference.error,
        symbol: marketReference.symbol,
        timezone: marketReference.timezone,
        interval: marketReference.interval,
        rawCandleCount: marketReference.rawCandleCount,
        weekRange: marketReference.weekRange,
        dailyLevels: marketReference.dailyLevels,
        csaAreas: marketReference.csaAreas,
        directionalBias: marketReference.directionalBias,
        useFullWeek: marketReference.useFullWeek,
        cleanBreakTolerance: getCleanBreakTolerance(normalizedSymbol),
      },
    });
  } catch (error) {
    console.error("CSA Coach analyze error:", error);

    res.status(500).json({
      success: false,
      error: "Something went wrong while analyzing the chart.",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`CSA Coach backend running on port ${PORT}`);
});
