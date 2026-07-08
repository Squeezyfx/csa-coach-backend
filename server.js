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
  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      detectedInstrument: null,
      detectedTimeframe: null,
      latestVisibleDate: null,
      dateConfidence: "low",
      notes: "OPENAI_API_KEY is missing.",
      raw: "",
    };
  }

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

function latestArea(areaList = []) {
  if (!Array.isArray(areaList) || !areaList.length) return null;

  return [...areaList].sort((a, b) => {
    const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
    if (dateCompare !== 0) return dateCompare;
    return Number(b.price || 0) - Number(a.price || 0);
  })[0];
}

function listAreas(areaList = [], label = "area", max = 3) {
  if (!Array.isArray(areaList) || !areaList.length) return "- None identified.";

  return [...areaList]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, max)
    .map((area) => `- ${area.day} ${label}: ${area.priceText}`)
    .join("\n");
}

function buildSimpleDayBreakdown(dailyLevels = [], normalizedSymbol = "") {
  if (!dailyLevels.length) return "- No weekday data available.";

  return dailyLevels
    .map((day, index) => {
      if (index === 0 || String(day.weekday || "").toLowerCase() === "monday") {
        return `${day.weekday}:
- High ${formatPrice(day.high)} = Monday resistance.
- Low ${formatPrice(day.low)} = Monday support.`;
      }

      const previous = dailyLevels[index - 1];

      const highComparison = compareHighWithTolerance(
        day.high,
        previous.high,
        normalizedSymbol
      );

      const lowComparison = compareLowWithTolerance(
        day.low,
        previous.low,
        normalizedSymbol
      );

      const highResult = highComparison.cleanBreak
        ? `High broke above ${previous.weekday}'s high, so ${day.weekday} high became resistance.`
        : `High failed to cleanly break ${previous.weekday}'s high, so ${day.weekday} high became supply.`;

      const lowResult = lowComparison.cleanBreak
        ? `Low broke below ${previous.weekday}'s low, so ${day.weekday} low became support.`
        : `Low held/retested ${previous.weekday}'s low, so ${day.weekday} low became demand.`;

      return `${day.weekday}:
- ${highResult}
- ${lowResult}`;
    })
    .join("\n\n");
}

function buildTradeCoachingSummary({
  resistanceAreas,
  supportAreas,
  supplyAreas,
  demandAreas,
  bias,
}) {
  const biasValue = String(bias?.bias || "").toLowerCase();

  const latestResistance = latestArea(resistanceAreas);
  const latestSupport = latestArea(supportAreas);
  const latestSupply = latestArea(supplyAreas);
  const latestDemand = latestArea(demandAreas);

  let direction = "Mixed / Wait";
  let bestEntryArea = "No clean entry area yet. Wait for price to reach a clear CSA area.";
  let entryTrigger =
    "Wait for a clear reaction: rejection candle, break-and-hold, retest, or lower/high higher-low confirmation.";
  let stopLoss =
    "Place stop beyond the invalidation point, not inside the same CSA area.";
  let takeProfit =
    "First target should be the nearest opposite CSA area. Second target only applies if price breaks and holds beyond the first target.";
  let riskReward =
    "Only consider the setup if at least 1:2 risk-to-reward is available before the next major CSA area.";
  let tradeManagement =
    "Do not manage the trade from the middle of the range. React only at trouble areas or after a clear structure shift.";
  let verdict =
    "Setup is not clean enough to chase. Wait for price to return to a CSA area and confirm.";
  let score = 5;

  if (biasValue.includes("bullish")) {
    direction = "Bullish";

    const entryRef = latestDemand || latestSupport;
    const troubleRef = latestResistance || latestSupply;

    bestEntryArea = entryRef
      ? `${entryRef.day} ${entryRef.type} around ${entryRef.priceText}. This is only valid if price returns/retraces and holds.`
      : "No strong buyer area confirmed. Wait for demand/support to form or hold.";

    entryTrigger =
      "Look for a hold above demand/support, bullish rejection, higher low, or break-and-hold above resistance before considering the setup valid.";

    stopLoss = entryRef
      ? `Below the ${entryRef.day} ${entryRef.type} area, or below the reaction swing low that confirms the setup.`
      : "Below the most recent confirmed swing low or below the demand/support area that creates the reaction.";

    takeProfit = troubleRef
      ? `First target near ${troubleRef.day} ${troubleRef.type} at ${troubleRef.priceText}. Further target only if price breaks and holds above that area.`
      : "First target should be the next visible resistance/supply area.";

    riskReward =
      "The setup is only worth considering if the distance from entry to first target is at least twice the stop size.";

    tradeManagement =
      "After price reaches the first trouble area, reduce risk or protect the position. If price rejects hard from resistance/supply, do not force a hold.";

    verdict =
      "Bullish idea is only valid from demand/support or after a confirmed resistance break-and-hold. Do not chase price in the middle.";

    score = bias.confidence === "high" ? 8 : bias.confidence === "medium" ? 7 : 6;
  } else if (biasValue.includes("bearish")) {
    direction = "Bearish";

    const entryRef = latestSupply || latestResistance;
    const troubleRef = latestSupport || latestDemand;

    bestEntryArea = entryRef
      ? `${entryRef.day} ${entryRef.type} around ${entryRef.priceText}. This is only valid if price returns/retraces and rejects.`
      : "No strong seller area confirmed. Wait for supply/resistance to form or reject.";

    entryTrigger =
      "Look for rejection from supply/resistance, lower high, bearish candle confirmation, or break-and-hold below support before considering the setup valid.";

    stopLoss = entryRef
      ? `Above the ${entryRef.day} ${entryRef.type} area, or above the reaction swing high that confirms the setup.`
      : "Above the most recent confirmed swing high or above the supply/resistance area that creates the rejection.";

    takeProfit = troubleRef
      ? `First target near ${troubleRef.day} ${troubleRef.type} at ${troubleRef.priceText}. Further target only if price breaks and holds below that area.`
      : "First target should be the next visible support/demand area.";

    riskReward =
      "The setup is only worth considering if the distance from entry to first target is at least twice the stop size.";

    tradeManagement =
      "After price reaches the first trouble area, reduce risk or protect the position. If price reacts strongly from support/demand, do not force continuation.";

    verdict =
      "Bearish idea is only valid from supply/resistance or after a confirmed support break-and-hold. Do not chase price in the middle.";

    score = bias.confidence === "high" ? 8 : bias.confidence === "medium" ? 7 : 6;
  } else {
    direction = "Mixed / Range-bound";

    const buyerRef = latestDemand || latestSupport;
    const sellerRef = latestSupply || latestResistance;

    bestEntryArea =
      buyerRef || sellerRef
        ? `Range condition. Buyer area: ${
            buyerRef ? `${buyerRef.day} ${buyerRef.type} ${buyerRef.priceText}` : "none"
          }. Seller area: ${
            sellerRef ? `${sellerRef.day} ${sellerRef.type} ${sellerRef.priceText}` : "none"
          }. Avoid the middle.`
        : "No clean CSA area confirmed. Wait.";

    entryTrigger =
      "Because bias is mixed, only take a reaction from the outer area of the range. Do not act from the middle.";

    stopLoss =
      "Stop should go beyond the outer range area that created the reaction, not inside the range.";

    takeProfit =
      "Target the opposite side of the range first. Do not expect trend continuation until price breaks and holds beyond the range.";

    riskReward =
      "Only consider the setup if the range gives at least 1:2 risk-to-reward. Skip if price is already close to the opposite side.";

    tradeManagement =
      "Take partials or protect risk near the middle/opposite side of the range. Mixed bias requires faster management.";

    verdict =
      "Mixed setup. Best action is patience. Wait for price to reach an outer CSA area or wait for a clean breakout and hold.";

    score = bias.confidence === "high" ? 6 : bias.confidence === "medium" ? 5 : 4;
  }

  return {
    direction,
    bestEntryArea,
    entryTrigger,
    stopLoss,
    takeProfit,
    riskReward,
    tradeManagement,
    verdict,
    score,
  };
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
  if (!marketReference || !marketReference.ok) {
    return `CSA COACH VERDICT

Overall Setup Score:
- 0/10

Directional Bias:
- Insufficient data

Best Entry Area:
- Not available. Backend OHLC market data was not available.

Entry Trigger:
- Not available. The coach cannot confirm valid triggers without reliable market data.

Stop Loss Placement:
- Not available.

Take Profit Placement:
- Not available.

Risk-to-Reward:
- Not available.

Trade Management:
- Not available.

Coach Verdict:
- The chart cannot be reliably reviewed because backend OHLC data was unavailable.
- Do not rely on screenshot-only level readings when the chart scale is unclear.

READ_MORE_DETAILS:

Data Issue:
- Reason: ${marketReference?.error || "Unknown error"}
- Selected date: ${dateDecision?.selectedDateText || "Not provided"}
- Final date used: ${dateDecision?.finalDateText || "Not provided"}
- Detected instrument: ${chartDetection?.detectedInstrument || "Not detected"}
- Detected timeframe: ${chartDetection?.detectedTimeframe || "Not detected"}`;
  }

  const dailyLevels = marketReference.dailyLevels || [];
  const areas = marketReference.csaAreas || [];
  const bias =
    marketReference.directionalBias ||
    calculateCsaDirectionalBias(dailyLevels, normalizedSymbol);

  const tolerance = getCleanBreakTolerance(normalizedSymbol);

  const resistanceAreas = areas.filter((area) => area.type === "resistance");
  const supportAreas = areas.filter((area) => area.type === "support");
  const supplyAreas = areas.filter((area) => area.type === "supply");
  const demandAreas = areas.filter((area) => area.type === "demand");

  const tradeCoach = buildTradeCoachingSummary({
    resistanceAreas,
    supportAreas,
    supplyAreas,
    demandAreas,
    bias,
  });

  const quickReason =
    Array.isArray(bias.progression) && bias.progression.length
      ? bias.progression[bias.progression.length - 1]
      : bias.reason ||
        "CSA bias was calculated from the selected week's high/low progression.";

  return `CSA COACH VERDICT

Overall Setup Score:
- ${tradeCoach.score}/10

Directional Bias:
- ${tradeCoach.direction}
- Reason: ${quickReason}

Best Entry Area:
- ${tradeCoach.bestEntryArea}

Entry Trigger:
- ${tradeCoach.entryTrigger}

Stop Loss Placement:
- ${tradeCoach.stopLoss}

Take Profit Placement:
- ${tradeCoach.takeProfit}

Risk-to-Reward:
- ${tradeCoach.riskReward}

Trade Management:
- ${tradeCoach.tradeManagement}

Coach Verdict:
- ${tradeCoach.verdict}
- These are coaching guidelines only, not buy/sell signals.

READ_MORE_DETAILS:

Key CSA Areas:
Resistance:
${listAreas(resistanceAreas, "resistance")}

Support:
${listAreas(supportAreas, "support")}

Supply:
${listAreas(supplyAreas, "supply")}

Demand:
${listAreas(demandAreas, "demand")}

Monday-to-Friday CSA Breakdown:
${buildSimpleDayBreakdown(dailyLevels, normalizedSymbol)}

CSA Bias Details:
- Bias: ${bias.bias}
- Confidence: ${bias.confidence}
- High breaks: ${bias.highBreakCount}
- Low breaks: ${bias.lowBreakCount}
- Demand holds: ${bias.demandHoldCount}
- Supply holds: ${bias.supplyHoldCount}

Technical Notes:
- Data source: Twelve Data
- Symbol used: ${marketReference.symbol}
- Selected instrument: ${submittedInstrument}
- Timeframe used: ${marketReference.interval}
- Week used: ${marketReference.weekRange.startDate} to ${marketReference.weekRange.fridayDate}
- Data used up to: ${marketReference.weekRange.endDate}
- Clean-break tolerance: ${formatPrice(tolerance)}
- Chart image was used only for visual context and mismatch checks.
- Stop loss, target, and risk-to-reward are structural coaching comments only. They are not financial advice.`;
}

function buildInstrumentMismatchAnalysis({
  selectedInstrument,
  detectedInstrument,
  selectedTimeframe,
  detectedTimeframe,
}) {
  return `Chart Context Mismatch

Selected Instrument:
${selectedInstrument || "Not provided"}

Detected Chart Instrument:
${detectedInstrument || "Not detected"}

Selected Timeframe:
${selectedTimeframe || "Not provided"}

Detected Chart Timeframe:
${detectedTimeframe || "Not detected"}

Why Analysis Was Stopped:
The selected instrument does not match the uploaded chart.

How To Fix:
- Change the selected pair to match the uploaded chart, or
- Upload the correct chart for the selected pair.`;
}

function buildTimeframeMismatchAnalysis({
  selectedInstrument,
  detectedInstrument,
  selectedTimeframe,
  detectedTimeframe,
}) {
  return `Chart Timeframe Mismatch

Selected Instrument:
${selectedInstrument || "Not provided"}

Detected Chart Instrument:
${detectedInstrument || "Not detected"}

Selected Timeframe:
${selectedTimeframe || "Not provided"}

Detected Chart Timeframe:
${detectedTimeframe || "Not detected"}

Why Analysis Was Stopped:
The selected timeframe does not match the uploaded chart timeframe.

How To Fix:
- Change the selected timeframe to match the uploaded chart, or
- Upload a chart that matches the selected timeframe.`;
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "CSA Coach backend is running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "csa-coach-backend",
    time: new Date().toISOString(),
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
    console.error("test-twelve error:", error);
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
        success: false,
        error: "OPENAI_API_KEY is missing on the server.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
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

    const setupScoreMatch = String(analysis).match(/Overall Setup Score:\s*\n- (\d+)\/10/i);
    const setupScore = setupScoreMatch ? Number(setupScoreMatch[1]) : 0;

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
          ? "Market-data-backed post-trade full-week setup review completed"
          : "Market-data-backed pre-trade date-capped setup review completed"
        : `Setup review completed without market data: ${marketReference.error}`,
      grade: setupScore >= 8 ? "A" : setupScore >= 7 ? "B" : setupScore >= 6 ? "C" : setupScore >= 4 ? "D" : "F",
      confidence: setupScore * 10,
      structureScore: setupScore * 10,
      executionScore: 0,
      riskScore: 0,
      strengths: marketReference.ok
        ? [
            `CSA areas calculated from Twelve Data ${marketReference.interval} candles for the selected Monday-to-Friday week.`,
            `CSA directional bias calculated as ${bias.bias} with ${bias.confidence} confidence.`,
            "Main feedback now focuses on bias, entry area, trigger, stop placement, target placement, risk-to-reward, and trade management.",
          ]
        : [
            "CSA setup review could not be fully market-data-backed.",
          ],
      weaknesses: marketReference.ok
        ? [
            "Broker chart prices may differ slightly from Twelve Data reference levels.",
            "Setup comments are structural coaching only, not buy/sell signals.",
          ]
        : [marketReference.error || "Market-data reference unavailable."],
      coachAdvice: [analysis],
      journalTags: [
        "setup review",
        "directional bias",
        "entry area",
        "entry trigger",
        "stop placement",
        "take profit placement",
        "risk reward",
        "trade management",
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

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CSA Coach backend running on port ${PORT}`);
});
