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

function countClosesDirection(dailyLevels = []) {
  let risingCloses = 0;
  let fallingCloses = 0;

  for (let i = 1; i < dailyLevels.length; i += 1) {
    if (dailyLevels[i].close > dailyLevels[i - 1].close) risingCloses += 1;
    if (dailyLevels[i].close < dailyLevels[i - 1].close) fallingCloses += 1;
  }

  return { risingCloses, fallingCloses };
}

function calculateCsaDirectionalBias(dailyLevels = [], symbol = "") {
  if (!Array.isArray(dailyLevels) || dailyLevels.length < 2) {
    return {
      bias: "Insufficient data",
      biasCode: "insufficient",
      confidence: "low",
      periodStartPrice: null,
      presentPrice: null,
      priceMove: null,
      resistanceCount: 0,
      supportCount: 0,
      supplyCount: 0,
      demandCount: 0,
      risingCloses: 0,
      fallingCloses: 0,
      highBreakCount: 0,
      lowBreakCount: 0,
      demandHoldCount: 0,
      supplyHoldCount: 0,
      reason:
        "At least two weekdays are needed to compare OHLC progression and form a directional bias.",
      progression: [],
    };
  }

  const tolerance = getCleanBreakTolerance(symbol);
  const firstDay = dailyLevels[0];
  const lastDay = dailyLevels[dailyLevels.length - 1];

  const periodStartPrice = firstDay.open;
  const presentPrice = lastDay.close;
  const priceMove = presentPrice - periodStartPrice;

  let resistanceCount = 0;
  let supportCount = 0;
  let supplyCount = 0;
  let demandCount = 0;
  let highBreakCount = 0;
  let lowBreakCount = 0;
  let demandHoldCount = 0;
  let supplyHoldCount = 0;

  const progression = [];

  for (let i = 0; i < dailyLevels.length; i += 1) {
    const current = dailyLevels[i];

    if (i === 0) {
      progression.push(
        `${current.weekday} ${current.date}: Monday high is weekly resistance and Monday low is weekly support.`
      );
      continue;
    }

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

    if (highComparison.cleanBreak) {
      resistanceCount += 1;
      highBreakCount += 1;
    } else {
      supplyCount += 1;
      supplyHoldCount += 1;
    }

    if (lowComparison.cleanBreak) {
      supportCount += 1;
      lowBreakCount += 1;
    } else {
      demandCount += 1;
      demandHoldCount += 1;
    }

    if (highComparison.cleanBreak && !lowComparison.cleanBreak) {
      progression.push(
        `${current.weekday} ${current.date}: bullish expansion because price created a clean higher high and did not create a clean lower low.`
      );
    } else if (lowComparison.cleanBreak && !highComparison.cleanBreak) {
      progression.push(
        `${current.weekday} ${current.date}: bearish expansion because price created a clean lower low and did not create a clean higher high.`
      );
    } else if (highComparison.cleanBreak && lowComparison.cleanBreak) {
      progression.push(
        `${current.weekday} ${current.date}: both sides expanded, so the direction is less clean.`
      );
    } else {
      progression.push(
        `${current.weekday} ${current.date}: range/retest condition because price did not cleanly break the previous day's high or low.`
      );
    }
  }

  const { risingCloses, fallingCloses } = countClosesDirection(dailyLevels);

  let bullishScore = 0;
  let bearishScore = 0;

  if (priceMove > tolerance) bullishScore += 2;
  if (priceMove < -tolerance) bearishScore += 2;

  if (resistanceCount > supportCount) bullishScore += 2;
  if (supportCount > resistanceCount) bearishScore += 2;

  if (risingCloses > fallingCloses) bullishScore += 1.5;
  if (fallingCloses > risingCloses) bearishScore += 1.5;

  if (highBreakCount > lowBreakCount) bullishScore += 1;
  if (lowBreakCount > highBreakCount) bearishScore += 1;

  let bias = "Mixed / Range-bound";
  let biasCode = "mixed";

  if (bullishScore > bearishScore + 1) {
    bias = "Bullish";
    biasCode = "bullish";
  } else if (bearishScore > bullishScore + 1) {
    bias = "Bearish";
    biasCode = "bearish";
  }

  let confidence = "low";
  const scoreDifference = Math.abs(bullishScore - bearishScore);

  if (scoreDifference >= 4) confidence = "high";
  else if (scoreDifference >= 2) confidence = "medium";

  const priceMoveText =
    priceMove > tolerance
      ? `price moved up from ${formatPrice(periodStartPrice)} to ${formatPrice(presentPrice)}`
      : priceMove < -tolerance
      ? `price moved down from ${formatPrice(periodStartPrice)} to ${formatPrice(presentPrice)}`
      : `price is almost flat from ${formatPrice(periodStartPrice)} to ${formatPrice(presentPrice)}`;

  const reason = `${priceMoveText}. New resistance count from higher-high expansion: ${resistanceCount}. New support count from lower-low expansion: ${supportCount}. Rising closes: ${risingCloses}. Falling closes: ${fallingCloses}. In CSA logic, more new resistance areas from higher highs supports bullish pressure, while more new support areas from lower lows supports bearish pressure.`;

  return {
    bias,
    biasCode,
    confidence,
    periodStartPrice,
    presentPrice,
    priceMove,
    resistanceCount,
    supportCount,
    supplyCount,
    demandCount,
    risingCloses,
    fallingCloses,
    bullishScore,
    bearishScore,
    scoreDifference,
    highBreakCount,
    lowBreakCount,
    demandHoldCount,
    supplyHoldCount,
    reason,
    progression,
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

function areaBrokenByCloseLater(area, dailyLevels = [], symbol = "") {
  if (!area || !Array.isArray(dailyLevels)) return false;

  const level = Number(area.price);
  const tolerance = getCleanBreakTolerance(symbol);

  if (!Number.isFinite(level)) return false;

  const laterDays = dailyLevels.filter(
    (day) => String(day.date || "") > String(area.date || "")
  );

  if (area.type === "supply" || area.type === "resistance") {
    return laterDays.some((day) => Number(day.close) > level + tolerance);
  }

  if (area.type === "demand" || area.type === "support") {
    return laterDays.some((day) => Number(day.close) < level - tolerance);
  }

  return false;
}

function filterValidAreas(areaList = [], dailyLevels = [], symbol = "") {
  return areaList.filter((area) => !areaBrokenByCloseLater(area, dailyLevels, symbol));
}

function filterBrokenAreas(areaList = [], dailyLevels = [], symbol = "") {
  return areaList.filter((area) => areaBrokenByCloseLater(area, dailyLevels, symbol));
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

function buildTargetsText(targetAreas = [], direction = "") {
  if (!targetAreas.length) {
    return "Use the closest opposite support/resistance or supply/demand area. If no clear target exists, skip the setup.";
  }

  const first = targetAreas[0];
  const second = targetAreas[1];
  const third = targetAreas[2];

  const lines = [];

  if (first) lines.push(`First TP: ${first.day} ${first.type} around ${first.priceText}.`);
  if (second) lines.push(`Second TP: ${second.day} ${second.type} around ${second.priceText}.`);
  if (third) lines.push(`Third TP: ${third.day} ${third.type} around ${third.priceText}.`);

  lines.push(
    "Higher-timeframe areas of interest should override smaller intraday targets when visible."
  );

  return lines.join(" ");
}

function buildTradeCoachingSummary({
  resistanceAreas,
  supportAreas,
  supplyAreas,
  demandAreas,
  dailyLevels,
  bias,
  symbol,
}) {
  const biasValue = String(bias?.bias || "").toLowerCase();

  const validSupplyAreas = filterValidAreas(supplyAreas, dailyLevels, symbol);
  const validDemandAreas = filterValidAreas(demandAreas, dailyLevels, symbol);

  const brokenSupportAreas = filterBrokenAreas(supportAreas, dailyLevels, symbol);
  const brokenResistanceAreas = filterBrokenAreas(resistanceAreas, dailyLevels, symbol);

  const latestValidSupply = latestArea(validSupplyAreas);
  const latestValidDemand = latestArea(validDemandAreas);
  const latestBrokenSupport = latestArea(brokenSupportAreas);
  const latestBrokenResistance = latestArea(brokenResistanceAreas);
  const latestResistance = latestArea(resistanceAreas);
  const latestSupport = latestArea(supportAreas);

  let direction = "Mixed / Wait";
  let directionReason =
    bias.reason || "Bias is mixed because CSA evidence is not clean enough.";
  let bestEntryArea =
    "No clean entry area yet. Wait for price to reach a valid support/resistance or supply/demand area.";
  let entryTrigger =
    "Use price action confirmation such as engulfing candle, pin bar, hammer, doji rejection, inside bar break, or a valid chart pattern such as triangle, flag, channel, head and shoulders, or Quasimodo. A trader may look for these triggers on a lower timeframe.";
  let stopLoss =
    "Place stop loss on the other side of the candlestick or chart pattern trigger, or on the other side of the support/resistance or supply/demand area.";
  let takeProfit =
    "Use the closest support/resistance or supply/demand area as TP1, the next area as TP2, and the next higher-timeframe area as TP3 if available.";
  let riskReward =
    "Minimum risk-to-reward should be 1:2. Skip the setup if price is too close to the first target.";
  let tradeManagement =
    "Use trailing stop, partial close, and breakeven after price moves in your favour or reaches the first trouble area.";
  let verdict =
    "Setup is not clean enough to chase. Wait for price to return to a valid CSA area and confirm with a trigger.";
  let score = 5;

  if (biasValue.includes("bullish")) {
    direction = "Bullish";

    const entryRef = latestBrokenResistance || latestValidDemand || latestSupport;
    const targetAreas = [
      ...filterValidAreas(resistanceAreas, dailyLevels, symbol),
      ...filterValidAreas(supplyAreas, dailyLevels, symbol),
    ];

    bestEntryArea = entryRef
      ? `${entryRef.day} ${entryRef.type} around ${entryRef.priceText}. For bullish bias, a broken resistance that becomes support, or a valid demand/support area, is the preferred entry area.`
      : "No clean bullish entry area confirmed yet. Wait for price to retest a broken resistance as support, or return to valid demand/support.";

    entryTrigger =
      "Look for bullish price action at the entry area: bullish engulfing, pin bar/hammer rejection, inside bar break, higher low, channel/flag breakout, or break-and-hold above resistance. These triggers can be refined on a lower timeframe.";

    stopLoss =
      "Place stop loss below the bullish trigger candle/pattern, or below the support/demand area. Do not place the stop inside the same area being used for entry.";

    takeProfit = buildTargetsText(targetAreas, "bullish");

    riskReward =
      "Only consider the bullish setup if the distance from entry to TP1 gives at least 1:2 risk-to-reward.";

    tradeManagement =
      "Move to breakeven only after price reacts strongly in your favour or reaches the first trouble area. Consider partial close at TP1 and trail stop behind higher lows if price continues.";

    verdict =
      "Bullish setup is valid only if price pulls back to support/demand or broken resistance and confirms with a clean trigger. Do not buy in the middle without confirmation.";

    score = bias.confidence === "high" ? 8 : bias.confidence === "medium" ? 7 : 6;
  } else if (biasValue.includes("bearish")) {
    direction = "Bearish";

    const entryRef = latestBrokenSupport || latestValidSupply || latestResistance;
    const targetAreas = [
      ...filterValidAreas(supportAreas, dailyLevels, symbol),
      ...filterValidAreas(demandAreas, dailyLevels, symbol),
    ];

    bestEntryArea = entryRef
      ? `${entryRef.day} ${entryRef.type} around ${entryRef.priceText}. For bearish bias, a broken support that becomes resistance, or a valid supply/resistance area, is the preferred entry area.`
      : "No clean bearish entry area confirmed yet. Wait for price to retest a broken support as resistance, or return to valid supply/resistance.";

    entryTrigger =
      "Look for bearish price action at the entry area: bearish engulfing, pin bar rejection, doji rejection, inside bar break, lower high, channel/flag breakdown, head and shoulders, or Quasimodo. These triggers can be refined on a lower timeframe.";

    stopLoss =
      "Place stop loss above the bearish trigger candle/pattern, or above the resistance/supply area. Do not place the stop inside the same area being used for entry.";

    takeProfit = buildTargetsText(targetAreas, "bearish");

    riskReward =
      "Only consider the bearish setup if the distance from entry to TP1 gives at least 1:2 risk-to-reward.";

    tradeManagement =
      "Move to breakeven only after price reacts strongly in your favour or reaches the first trouble area. Consider partial close at TP1 and trail stop behind lower highs if price continues.";

    verdict =
      "Bearish setup is valid only if price pulls back to resistance/supply or broken support and confirms with a clean trigger. Do not sell in the middle without confirmation.";

    score = bias.confidence === "high" ? 8 : bias.confidence === "medium" ? 7 : 6;
  } else {
    direction = "Mixed / Wait";

    const buyerRef = latestValidDemand || latestSupport;
    const sellerRef = latestValidSupply || latestResistance;

    bestEntryArea =
      buyerRef || sellerRef
        ? `Mixed condition. Buyer area: ${
            buyerRef ? `${buyerRef.day} ${buyerRef.type} around ${buyerRef.priceText}` : "none"
          }. Seller area: ${
            sellerRef ? `${sellerRef.day} ${sellerRef.type} around ${sellerRef.priceText}` : "none"
          }. Avoid entries in the middle.`
        : "No clean CSA entry area confirmed. Wait.";

    entryTrigger =
      "Because bias is mixed, only act from the outer support/demand or resistance/supply area with a strong candlestick or chart-pattern trigger.";

    stopLoss =
      "Place stop beyond the outer area that created the reaction, not inside the range.";

    takeProfit =
      "Target the opposite side of the range first. TP2 and TP3 only apply if price breaks and holds beyond that opposite area.";

    riskReward =
      "Minimum 1:2 risk-to-reward is still required. Skip if the opposite side of the range is too close.";

    tradeManagement =
      "Manage faster in mixed conditions. Use partial close at the range midpoint or opposite side, move to breakeven only after strong reaction, and trail only if price breaks out cleanly.";

    verdict =
      "Mixed setup. The best trade is often no trade until price reaches an outer CSA area or breaks and holds beyond the range.";

    score = bias.confidence === "high" ? 6 : bias.confidence === "medium" ? 5 : 4;
  }

  return {
    direction,
    directionReason,
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

Directional Bias:
- Insufficient data
- Reason: Backend OHLC market data was not available, so CSA Coach cannot reliably compare period start price to present price, resistance/support count, or price progression.

Best Entry Area:
- Not available. Wait until backend OHLC data confirms valid support/resistance or supply/demand areas.

Entry Trigger:
- Not available. Trigger confirmation should only be reviewed after valid areas are confirmed.

Stop Loss Placement:
- Not available.

Take Profit Placement:
- Not available.

Risk-to-Reward:
- Minimum 1:2, but setup cannot be measured without valid areas.

Trade Management:
- Not available.

Coach Verdict:
- The chart cannot be reliably reviewed because backend OHLC data was unavailable.
- Do not rely on screenshot-only level readings when the chart scale is unclear.

Overall Setup Score:
- 0/10

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

  const validSupplyAreas = filterValidAreas(supplyAreas, dailyLevels, normalizedSymbol);
  const validDemandAreas = filterValidAreas(demandAreas, dailyLevels, normalizedSymbol);
  const brokenSupplyAreas = filterBrokenAreas(supplyAreas, dailyLevels, normalizedSymbol);
  const brokenDemandAreas = filterBrokenAreas(demandAreas, dailyLevels, normalizedSymbol);

  const tradeCoach = buildTradeCoachingSummary({
    resistanceAreas,
    supportAreas,
    supplyAreas,
    demandAreas,
    dailyLevels,
    bias,
    symbol: normalizedSymbol,
  });

  return `CSA COACH VERDICT

Directional Bias:
- ${tradeCoach.direction}
- Reason: ${tradeCoach.directionReason}

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

Overall Setup Score:
- ${tradeCoach.score}/10

READ_MORE_DETAILS:

CSA Bias Calculation:
- Period start price: ${formatPrice(bias.periodStartPrice)}
- Present price: ${formatPrice(bias.presentPrice)}
- Price movement: ${formatPrice(bias.priceMove)}
- New resistance count from higher-high expansion: ${bias.resistanceCount}
- New support count from lower-low expansion: ${bias.supportCount}
- Rising closes: ${bias.risingCloses}
- Falling closes: ${bias.fallingCloses}
- Bias confidence: ${bias.confidence}

Key CSA Areas:
Resistance:
${listAreas(resistanceAreas, "resistance")}

Support:
${listAreas(supportAreas, "support")}

Valid Supply:
${listAreas(validSupplyAreas, "supply")}

Valid Demand:
${listAreas(validDemandAreas, "demand")}

Ignored / Broken Supply-Demand:
Broken Supply:
${listAreas(brokenSupplyAreas, "supply")}

Broken Demand:
${listAreas(brokenDemandAreas, "demand")}

Monday-to-Friday CSA Breakdown:
${buildSimpleDayBreakdown(dailyLevels, normalizedSymbol)}

Technical Notes:
- Data source: Twelve Data
- Symbol used: ${marketReference.symbol}
- Selected instrument: ${submittedInstrument}
- Timeframe used: ${marketReference.interval}
- Week used: ${marketReference.weekRange.startDate} to ${marketReference.weekRange.fridayDate}
- Data used up to: ${marketReference.weekRange.endDate}
- Clean-break tolerance: ${formatPrice(tolerance)}
- Supply/demand is ignored once price breaks and closes past the area.
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
            "Main feedback follows the requested format: bias, entry area, trigger, stop, target, risk/reward, management, verdict.",
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
