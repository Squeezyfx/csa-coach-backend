import express from "express";
import cors from "cors";
import multer from "multer";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TWELVE_DATA_BASE_URL = "https://api.twelvedata.com/time_series";

const CHART_DETECTION_PROMPT = `
You are a chart screenshot pre-check assistant for CSA Coach.

Inspect the uploaded image and return ONLY valid JSON. Do not use markdown.

Your first job is to decide if the uploaded image is a real financial trading chart screenshot.

A valid trading chart screenshot normally contains:
- visible candles, bars, or line-chart price movement
- visible price scale
- visible time/date scale
- chart/platform interface such as TradingView, MT4, MT5, cTrader, or broker chart

Invalid images include:
- photos, random images, logos, documents, rooms, screenshots with no financial chart
- blank charts, loading charts, cropped charts where candles are not visible

Detect:
1. Whether this is a valid financial trading chart.
2. Whether there is enough visible price data to review the setup.
3. Whether the selected chart/trade date is visible or reasonably covered by the image.
4. Instrument/pair if readable.
5. Timeframe if readable. Use M1, M5, M15, M30, H1, H4, D1, W1, MN.
6. Latest/final visible date if readable, YYYY-MM-DD.
7. Any confirmed entry trigger near the latest/right side of the chart.

Usable chart data rules:
- A platform screenshot is NOT enough. The chart itself must show usable price movement.
- hasUsablePriceData must be false if chart area is blank, mostly empty, loading/frozen, too blurry, cropped, or has fewer than about 20 visible candles/bars/price points.
- hasUsablePriceData must be false if the selected chart/trade date is clearly not visible or not reasonably covered by the chart image.
- chartDataQuality must be one of: usable, limited, insufficient, blank, unclear.
- If chartDataQuality is insufficient, blank, or unclear, explain in insufficientDataReason.
- Twelve Data must not replace a blank, empty, loading, cropped, or unclear uploaded chart.

Entry trigger rules:
- Valid triggers include engulfing, pin bar rejection, hammer rejection, doji rejection, inside bar break, lower high/higher low, breakout/breakdown, flag/channel/triangle break, head and shoulders, Quasimodo, or clean break-and-hold.
- Bounce, pullback, retracement, consolidation, ranging, reaction, or price moving away is not a confirmed trigger by itself.
- If there is no confirmed trigger, return visibleTrigger as null.

Return exactly this JSON shape:
{
  "isTradingChart": true,
  "chartValidityReason": "brief reason",
  "hasUsablePriceData": true,
  "visibleCandleCount": 80,
  "chartDataQuality": "usable",
  "selectedDateVisible": true,
  "insufficientDataReason": null,
  "detectedInstrument": "GBPUSD or null",
  "detectedTimeframe": "H1 or M5 or H4 or D1 or W1 or MN or null",
  "latestVisibleDate": "YYYY-MM-DD or null",
  "dateConfidence": "high or medium or low",
  "visibleTrigger": "brief trigger description or null",
  "triggerDirection": "bullish or bearish or neutral or null",
  "triggerConfidence": "high or medium or low",
  "notes": "brief note"
}
`;

const CONTEXT_ONLY_TRIGGER_WORDS = [
  "bounce",
  "bouncing",
  "pullback",
  "pull back",
  "retracement",
  "retrace",
  "consolidation",
  "consolidating",
  "reaction",
  "ranging",
  "range",
  "moving away",
  "slight recovery",
  "recovery",
];

const CONFIRMED_TRIGGER_WORDS = [
  "engulfing",
  "pin bar",
  "pinbar",
  "hammer",
  "doji rejection",
  "inside bar break",
  "inside bar",
  "lower high",
  "higher low",
  "breakdown",
  "breakout",
  "break-and-hold",
  "break and hold",
  "head and shoulders",
  "quasimodo",
  "channel breakdown",
  "channel breakout",
  "flag breakdown",
  "flag breakout",
  "triangle breakdown",
  "triangle breakout",
  "rejection candle",
  "bearish rejection",
  "bullish rejection",
];

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

function comparableInstrument(input = "") {
  const raw = String(input).toUpperCase().replace(/\s+/g, "");

  const known = [
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

  for (const symbol of known) {
    if (raw.includes(symbol)) {
      if (symbol === "GOLD") return "XAUUSD";
      if (symbol === "BTCUSDT") return "BTCUSD";
      return symbol;
    }
  }

  const compact = normalizeSymbol(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (compact === "GOLD") return "XAUUSD";
  if (compact === "BTCUSDT") return "BTCUSD";

  return compact;
}

function comparableTimeframe(input = "") {
  const raw = String(input).trim().toUpperCase().replace(/\s+/g, "");
  const cleaned = raw.replace(/[^A-Z0-9]/g, "");

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

    MN: "MN",
    MTH: "MN",
    MONTH: "MN",
    MONTHLY: "MN",
    "1MO": "MN",
    "1MON": "MN",
    "1MONTH": "MN",
  };

  return map[raw] || map[cleaned] || cleaned;
}

function normalizeTimeframe(input = "") {
  const tf = comparableTimeframe(input);

  const map = {
    M1: "1min",
    M5: "5min",
    M15: "15min",
    M30: "30min",
    H1: "1h",
    H4: "4h",
    D1: "1day",
    W1: "1week",
    MN: "1month",
  };

  return map[tf] || "1h";
}

function normalizeAnalysisType(input = "") {
  const raw = String(input).trim().toLowerCase();

  if (raw.includes("post") || raw.includes("review") || raw.includes("after")) {
    return "post-trade";
  }

  if (raw.includes("pre") || raw.includes("before")) {
    return "pre-trade";
  }

  return raw || "post-trade";
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

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function candleDateOnly(datetimeValue = "") {
  return String(datetimeValue).slice(0, 10);
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "N/A";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 100) return value.toFixed(3);
  if (Math.abs(value) >= 10) return value.toFixed(4);
  return value.toFixed(5);
}

function getMonthName(monthIndex) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, monthIndex, 1)));
}

function getQuarterLabel(monthIndex) {
  if (monthIndex <= 2) return "Q1";
  if (monthIndex <= 5) return "Q2";
  if (monthIndex <= 8) return "Q3";
  return "Q4";
}

function getWeekRangeForDate(chartDate, useFullWeek = false) {
  const day = chartDate.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(chartDate, mondayOffset);
  const friday = addDays(monday, 4);
  const end = useFullWeek ? friday : chartDate < friday ? chartDate : friday;

  return {
    start: monday,
    end,
    final: friday,
    startDate: formatDateOnly(monday),
    endDate: formatDateOnly(end),
    finalDate: formatDateOnly(friday),
    label: `${formatDateOnly(monday)} to ${formatDateOnly(friday)}`,
  };
}

function getMonthRangeForDate(chartDate, useFullMonth = false) {
  const year = chartDate.getUTCFullYear();
  const month = chartDate.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));
  const end = useFullMonth ? monthEnd : chartDate < monthEnd ? chartDate : monthEnd;

  return {
    start,
    end,
    final: monthEnd,
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
    finalDate: formatDateOnly(monthEnd),
    label: `${getMonthName(month)} ${year}`,
  };
}

function getYearRangeForDate(chartDate, useFullYear = false) {
  const year = chartDate.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const end = useFullYear ? yearEnd : chartDate < yearEnd ? chartDate : yearEnd;

  return {
    start,
    end,
    final: yearEnd,
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
    finalDate: formatDateOnly(yearEnd),
    label: String(year),
  };
}

function getMultiYearRangeForDate(chartDate, yearsBack = 4, useFullFinalYear = false) {
  const year = chartDate.getUTCFullYear();
  const start = new Date(Date.UTC(year - yearsBack, 0, 1));
  const finalYearEnd = new Date(Date.UTC(year, 11, 31));
  const end = useFullFinalYear ? finalYearEnd : chartDate < finalYearEnd ? chartDate : finalYearEnd;

  return {
    start,
    end,
    final: finalYearEnd,
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
    finalDate: formatDateOnly(finalYearEnd),
    label: `${year - yearsBack} to ${year}`,
  };
}

function isSameTradingWeek(dateA, dateB) {
  if (!dateA || !dateB) return false;

  const weekA = getWeekRangeForDate(dateA, true);
  const weekB = getWeekRangeForDate(dateB, true);

  return weekA.startDate === weekB.startDate && weekA.finalDate === weekB.finalDate;
}

function weekdayNameFromDate(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

function getOutputSizeForInterval(interval) {
  const map = {
    "1min": "5000",
    "5min": "5000",
    "15min": "3000",
    "30min": "2000",
    "1h": "1000",
    "4h": "500",
    "1day": "400",
    "1week": "300",
    "1month": "120",
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
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sanitizeVisibleTrigger(trigger, confidence = "low") {
  const text = String(trigger || "").trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const hasConfirmedWord = CONFIRMED_TRIGGER_WORDS.some((word) => lower.includes(word));
  const hasContextOnlyWord = CONTEXT_ONLY_TRIGGER_WORDS.some((word) => lower.includes(word));
  const isLowConfidence = String(confidence || "low").toLowerCase() === "low";

  if (isLowConfidence) return null;
  if (hasContextOnlyWord && !hasConfirmedWord) return null;
  if (!hasConfirmedWord) return null;

  return text;
}

async function detectChartContextFromImage({
  imageBase64,
  mimeType,
  submittedInstrument = "",
  selectedTimeframe = "",
  selectedDateText = "",
  analysisType = "post-trade",
}) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      isTradingChart: false,
      chartValidityReason: "OPENAI_API_KEY is missing.",
      hasUsablePriceData: false,
      visibleCandleCount: 0,
      chartDataQuality: "unclear",
      selectedDateVisible: false,
      insufficientDataReason: "OPENAI_API_KEY is missing.",
      detectedInstrument: null,
      detectedTimeframe: null,
      latestVisibleDate: null,
      dateConfidence: "low",
      visibleTrigger: null,
      rejectedTriggerContext: null,
      triggerDirection: null,
      triggerConfidence: "low",
      notes: "OPENAI_API_KEY is missing.",
      raw: "",
    };
  }

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: CHART_DETECTION_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Inspect this uploaded chart image.
Selected instrument: ${submittedInstrument || "not provided"}
Selected timeframe: ${selectedTimeframe || "not provided"}
Selected chart/trade date: ${selectedDateText || "not provided"}
Analysis type: ${analysisType || "post-trade"}

First confirm if it is a valid trading chart. Then confirm if it has enough visible price data/candles and whether the selected date is visible or reasonably covered. Return only JSON.`,
            },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${imageBase64}`,
            },
          ],
        },
      ],
      max_output_tokens: 700,
    });

    const parsed = extractJsonObject(response.output_text || "");
    const isTradingChart = parsed?.isTradingChart === true;
    const rawTrigger = parsed?.visibleTrigger || null;
    const triggerConfidence = parsed?.triggerConfidence || "low";
    const cleanTrigger = sanitizeVisibleTrigger(rawTrigger, triggerConfidence);

    return {
      ok: !!parsed,
      isTradingChart,
      chartValidityReason:
        parsed?.chartValidityReason ||
        (isTradingChart
          ? "The uploaded image appears to be a valid trading chart."
          : "The uploaded image does not appear to be a valid financial trading chart."),
      hasUsablePriceData: isTradingChart ? parsed?.hasUsablePriceData === true : false,
      visibleCandleCount: Number.isFinite(Number(parsed?.visibleCandleCount))
        ? Number(parsed.visibleCandleCount)
        : 0,
      chartDataQuality: isTradingChart ? parsed?.chartDataQuality || "unclear" : "unclear",
      selectedDateVisible: isTradingChart ? parsed?.selectedDateVisible === true : false,
      insufficientDataReason:
        parsed?.insufficientDataReason ||
        (!isTradingChart
          ? "The uploaded image is not a financial trading chart."
          : parsed?.hasUsablePriceData === true
          ? null
          : "The uploaded chart does not show enough usable visible price data."),
      detectedInstrument: isTradingChart ? parsed?.detectedInstrument || null : null,
      detectedTimeframe: isTradingChart ? parsed?.detectedTimeframe || null : null,
      latestVisibleDate: isTradingChart ? parsed?.latestVisibleDate || null : null,
      dateConfidence: isTradingChart ? parsed?.dateConfidence || "low" : "low",
      visibleTrigger: isTradingChart ? cleanTrigger : null,
      rejectedTriggerContext: isTradingChart && rawTrigger && !cleanTrigger ? rawTrigger : null,
      triggerDirection: isTradingChart && cleanTrigger ? parsed?.triggerDirection || null : null,
      triggerConfidence: isTradingChart && cleanTrigger ? triggerConfidence : "low",
      notes: parsed?.notes || "",
      raw: response.output_text || "",
    };
  } catch (error) {
    console.error("Chart detection error:", error);
    return {
      ok: false,
      isTradingChart: false,
      chartValidityReason: `Chart validation failed: ${error.message}`,
      hasUsablePriceData: false,
      visibleCandleCount: 0,
      chartDataQuality: "unclear",
      selectedDateVisible: false,
      insufficientDataReason: `Chart validation failed: ${error.message}`,
      detectedInstrument: null,
      detectedTimeframe: null,
      latestVisibleDate: null,
      dateConfidence: "low",
      visibleTrigger: null,
      rejectedTriggerContext: null,
      triggerDirection: null,
      triggerConfidence: "low",
      notes: `Chart detection failed: ${error.message}`,
      raw: "",
    };
  }
}

function isUploadedChartDataUsable(chartDetection, selectedDateText = "") {
  if (!chartDetection?.isTradingChart) return false;
  if (chartDetection.hasUsablePriceData !== true) return false;

  const quality = String(chartDetection.chartDataQuality || "").toLowerCase();
  if (["blank", "insufficient", "unclear"].includes(quality)) return false;

  const candles = Number(chartDetection.visibleCandleCount || 0);
  if (Number.isFinite(candles) && candles > 0 && candles < 20) return false;

  if (selectedDateText && chartDetection.selectedDateVisible === false) return false;

  return true;
}

function isUsableChartDateDetection(detection) {
  if (!detection || !detection.latestVisibleDate) return false;
  if (!parseISODateOnly(detection.latestVisibleDate)) return false;
  const confidence = String(detection.dateConfidence || "").toLowerCase();
  return confidence === "high" || confidence === "medium";
}

function chooseFinalChartDate({ selectedDate, detection, analysisType = "post-trade" }) {
  const mode = normalizeAnalysisType(analysisType);
  const detectedDate = isUsableChartDateDetection(detection)
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
    if (detectedDate && detectedDate > selectedDate && !isSameTradingWeek(selectedDate, detectedDate)) {
      return {
        finalDate: selectedDate,
        finalDateText: formatDateOnly(selectedDate),
        selectedDateText: formatDateOnly(selectedDate),
        detectedDateText: formatDateOnly(detectedDate),
        source: "post-trade-user-selected-date-detected-date-outside-week-ignored",
        reason:
          "Post-trade mode was selected, but the chart-detected date appeared outside the selected structure period. The user-selected date was used to prevent analysis from jumping into the wrong period.",
      };
    }

    return {
      finalDate: selectedDate,
      finalDateText: formatDateOnly(selectedDate),
      selectedDateText: formatDateOnly(selectedDate),
      detectedDateText: detectedDate ? formatDateOnly(detectedDate) : null,
      source: "post-trade-user-selected-date",
      reason:
        "Post-trade mode was selected, so the user-selected date was used to identify the correct CSA structure period.",
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
    reason: "No usable user-selected date or chart-detected latest visible date was available.",
  };
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
    return { cleanBreak: false, difference: null, tolerance, label: "unavailable" };
  }
  const difference = current - previous;
  if (difference > tolerance) return { cleanBreak: true, difference, tolerance, label: "clean higher high" };
  if (Math.abs(difference) <= tolerance) return { cleanBreak: false, difference, tolerance, label: "equal high / retest of previous high" };
  return { cleanBreak: false, difference, tolerance, label: "failed to break previous high" };
}

function compareLowWithTolerance(currentLow, previousLow, symbol = "") {
  const current = Number(currentLow);
  const previous = Number(previousLow);
  const tolerance = getCleanBreakTolerance(symbol);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { cleanBreak: false, difference: null, tolerance, label: "unavailable" };
  }
  const difference = previous - current;
  if (difference > tolerance) return { cleanBreak: true, difference, tolerance, label: "clean lower low" };
  if (Math.abs(previous - current) <= tolerance) return { cleanBreak: false, difference, tolerance, label: "equal low / retest of previous low" };
  return { cleanBreak: false, difference, tolerance, label: "held above previous low" };
}

function getSupportedCsaTimeframeProfile(timeframe = "H1") {
  const tf = comparableTimeframe(timeframe) || "H1";
  if (["M1", "M5", "M15", "M30", "H1"].includes(tf)) {
    return {
      selectedTimeframe: tf,
      interval: normalizeTimeframe(tf),
      structureMode: "daily-in-week",
      structureLabel: "Daily highs/lows inside the selected Monday-to-Friday week",
      sourceUnitSingular: "day",
      sourceUnitPlural: "daily levels",
      firstPeriodText: "Monday high/low creates the first support and resistance for the week.",
      startPriceLabel: "Monday open",
      currentPriceLabel: "latest close for the selected week",
      rangeKind: "week",
      breakdownTitle: "Monday-to-Friday CSA Breakdown",
    };
  }

  if (tf === "H4") {
    return {
      selectedTimeframe: tf,
      interval: "4h",
      structureMode: "weekly-in-month",
      structureLabel: "Weekly highs/lows inside the selected calendar month",
      sourceUnitSingular: "week",
      sourceUnitPlural: "weekly levels",
      firstPeriodText: "The first available week high/low creates the first support and resistance for the month.",
      startPriceLabel: "first week open",
      currentPriceLabel: "latest close for the selected month",
      rangeKind: "month",
      breakdownTitle: "Weekly CSA Breakdown For Selected Month",
    };
  }

  if (tf === "D1") {
    return {
      selectedTimeframe: tf,
      interval: "1day",
      structureMode: "monthly-in-year",
      structureLabel: "Monthly highs/lows inside the selected calendar year",
      sourceUnitSingular: "month",
      sourceUnitPlural: "monthly levels",
      firstPeriodText: "January high/low, or the first available month high/low, creates the first support and resistance for the year.",
      startPriceLabel: "first month open",
      currentPriceLabel: "latest close for the selected year",
      rangeKind: "year",
      breakdownTitle: "Monthly CSA Breakdown For Selected Year",
    };
  }

  if (tf === "W1") {
    return {
      selectedTimeframe: tf,
      interval: "1week",
      structureMode: "quarterly-in-year",
      structureLabel: "Quarterly highs/lows inside the selected calendar year",
      sourceUnitSingular: "quarter",
      sourceUnitPlural: "quarterly levels",
      firstPeriodText: "Q1 high/low, or the first available quarter high/low, creates the first support and resistance for the year.",
      startPriceLabel: "first quarter open",
      currentPriceLabel: "latest close for the selected year",
      rangeKind: "year",
      breakdownTitle: "Quarterly CSA Breakdown For Selected Year",
    };
  }

  if (tf === "MN") {
    return {
      selectedTimeframe: tf,
      interval: "1month",
      structureMode: "yearly-in-multi-year",
      structureLabel: "Yearly highs/lows across selected year plus previous 4 years",
      sourceUnitSingular: "year",
      sourceUnitPlural: "yearly levels",
      firstPeriodText: "The first available year high/low creates the first support and resistance for the multi-year range.",
      startPriceLabel: "first year open",
      currentPriceLabel: "latest close for the selected multi-year range",
      rangeKind: "multi-year range",
      breakdownTitle: "Yearly CSA Breakdown For Monthly Chart",
    };
  }

  return getSupportedCsaTimeframeProfile("H1");
}

function getStructureRangeForProfile(chartDate, profile, analysisType = "post-trade") {
  const useFull = normalizeAnalysisType(analysisType) === "post-trade";
  if (profile.structureMode === "daily-in-week") return getWeekRangeForDate(chartDate, useFull);
  if (profile.structureMode === "weekly-in-month") return getMonthRangeForDate(chartDate, useFull);
  if (profile.structureMode === "monthly-in-year") return getYearRangeForDate(chartDate, useFull);
  if (profile.structureMode === "quarterly-in-year") return getYearRangeForDate(chartDate, useFull);
  if (profile.structureMode === "yearly-in-multi-year") return getMultiYearRangeForDate(chartDate, 4, useFull);
  return getWeekRangeForDate(chartDate, useFull);
}

function getPeriodKeyAndLabel(date, profile) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  if (profile.structureMode === "daily-in-week") {
    const dateOnly = formatDateOnly(date);
    return { key: dateOnly, label: weekdayNameFromDate(dateOnly), date: dateOnly };
  }

  if (profile.structureMode === "weekly-in-month") {
    const monthStart = new Date(Date.UTC(year, month, 1));
    const weekNumber = Math.ceil((date.getUTCDate() + monthStart.getUTCDay()) / 7);
    const dateOnly = formatDateOnly(date);
    return {
      key: `${year}-${String(month + 1).padStart(2, "0")}-W${weekNumber}`,
      label: `Week ${weekNumber}`,
      date: dateOnly,
    };
  }

  if (profile.structureMode === "monthly-in-year") {
    return {
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: getMonthName(month),
      date: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    };
  }

  if (profile.structureMode === "quarterly-in-year") {
    const quarter = getQuarterLabel(month);
    return { key: `${year}-${quarter}`, label: quarter, date: `${year}-${quarter}` };
  }

  if (profile.structureMode === "yearly-in-multi-year") {
    return { key: String(year), label: String(year), date: `${year}-01-01` };
  }

  const dateOnly = formatDateOnly(date);
  return { key: dateOnly, label: dateOnly, date: dateOnly };
}

function buildStructureLevelsFromCandles(candles, structureRange, profile) {
  const grouped = new Map();

  candles.forEach((bar) => {
    const dateOnly = candleDateOnly(bar.datetime);
    if (!dateOnly) return;

    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return;
    if (dateOnly < structureRange.startDate || dateOnly > structureRange.endDate) return;

    if (profile.structureMode === "daily-in-week") {
      const dayNum = date.getUTCDay();
      if (dayNum < 1 || dayNum > 5) return;
    }

    const open = safeNumber(bar.open);
    const high = safeNumber(bar.high);
    const low = safeNumber(bar.low);
    const close = safeNumber(bar.close);
    if (open === null || high === null || low === null || close === null) return;

    const period = getPeriodKeyAndLabel(date, profile);
    if (!grouped.has(period.key)) {
      grouped.set(period.key, {
        key: period.key,
        date: period.date,
        weekday: period.label,
        periodLabel: period.label,
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

    const existing = grouped.get(period.key);
    existing.high = Math.max(existing.high, high);
    existing.low = Math.min(existing.low, low);
    existing.close = close;
    existing.candleCount += 1;
    existing.lastCandleTime = bar.datetime;
  });

  return Array.from(grouped.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function buildCsaAreas(levels = [], symbol = "", profile = getSupportedCsaTimeframeProfile("H1")) {
  const areas = [];

  levels.forEach((period, index) => {
    const label = period.periodLabel || period.weekday || period.key;

    if (index === 0) {
      areas.push({
        day: label,
        period: label,
        date: period.date,
        type: "resistance",
        price: period.high,
        priceText: formatPrice(period.high),
        logic: `${label} high represents the first resistance for this ${profile.rangeKind}.`,
      });
      areas.push({
        day: label,
        period: label,
        date: period.date,
        type: "support",
        price: period.low,
        priceText: formatPrice(period.low),
        logic: `${label} low represents the first support for this ${profile.rangeKind}.`,
      });
      return;
    }

    const previous = levels[index - 1];
    const previousLabel = previous.periodLabel || previous.weekday || previous.key;
    const highComparison = compareHighWithTolerance(period.high, previous.high, symbol);
    const lowComparison = compareLowWithTolerance(period.low, previous.low, symbol);

    areas.push({
      day: label,
      period: label,
      date: period.date,
      type: highComparison.cleanBreak ? "resistance" : "supply",
      price: period.high,
      priceText: formatPrice(period.high),
      comparedWith: `${previousLabel} ${previous.date}`,
      comparison: highComparison,
      logic: highComparison.cleanBreak
        ? `${label} high made a clean break above ${previousLabel} high, so ${label} high is resistance.`
        : `${label} high did not cleanly break above ${previousLabel} high, so ${label} high is supply.`,
    });

    areas.push({
      day: label,
      period: label,
      date: period.date,
      type: lowComparison.cleanBreak ? "support" : "demand",
      price: period.low,
      priceText: formatPrice(period.low),
      comparedWith: `${previousLabel} ${previous.date}`,
      comparison: lowComparison,
      logic: lowComparison.cleanBreak
        ? `${label} low made a clean break below ${previousLabel} low, so ${label} low is support.`
        : `${label} low did not cleanly break below ${previousLabel} low, so ${label} low is demand.`,
    });
  });

  return areas;
}

function countClosesDirection(levels = []) {
  let risingCloses = 0;
  let fallingCloses = 0;
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i].close > levels[i - 1].close) risingCloses += 1;
    if (levels[i].close < levels[i - 1].close) fallingCloses += 1;
  }
  return { risingCloses, fallingCloses };
}

function calculateCsaDirectionalBias(levels = [], symbol = "", profile = getSupportedCsaTimeframeProfile("H1")) {
  if (!Array.isArray(levels) || levels.length < 2) {
    return {
      bias: "Insufficient data",
      biasCode: "insufficient",
      confidence: "low",
      periodStartPrice: null,
      presentPrice: null,
      periodHigh: null,
      periodLow: null,
      priceMove: null,
      resistanceCount: 0,
      supportCount: 0,
      supplyCount: 0,
      demandCount: 0,
      risingCloses: 0,
      fallingCloses: 0,
      highBreakCount: 0,
      lowBreakCount: 0,
      reason: `At least two ${profile.sourceUnitPlural} are needed to compare OHLC progression and form a directional bias.`,
      progression: [],
    };
  }

  const tolerance = getCleanBreakTolerance(symbol);
  const firstPeriod = levels[0];
  const lastPeriod = levels[levels.length - 1];
  const periodStartPrice = firstPeriod.open;
  const presentPrice = lastPeriod.close;
  const priceMove = presentPrice - periodStartPrice;
  const periodHigh = Math.max(...levels.map((item) => Number(item.high)));
  const periodLow = Math.min(...levels.map((item) => Number(item.low)));

  let resistanceCount = 0;
  let supportCount = 0;
  let supplyCount = 0;
  let demandCount = 0;
  let highBreakCount = 0;
  let lowBreakCount = 0;
  const progression = [];

  for (let i = 0; i < levels.length; i += 1) {
    const current = levels[i];
    const currentLabel = current.periodLabel || current.weekday || current.key;
    if (i === 0) {
      progression.push(`${currentLabel}: ${profile.firstPeriodText}`);
      continue;
    }

    const previous = levels[i - 1];
    const previousLabel = previous.periodLabel || previous.weekday || previous.key;
    const highComparison = compareHighWithTolerance(current.high, previous.high, symbol);
    const lowComparison = compareLowWithTolerance(current.low, previous.low, symbol);

    if (highComparison.cleanBreak) {
      resistanceCount += 1;
      highBreakCount += 1;
    } else {
      supplyCount += 1;
    }

    if (lowComparison.cleanBreak) {
      supportCount += 1;
      lowBreakCount += 1;
    } else {
      demandCount += 1;
    }

    if (highComparison.cleanBreak && !lowComparison.cleanBreak) {
      progression.push(`${currentLabel}: bullish expansion because price created a clean higher high above ${previousLabel} and did not create a clean lower low.`);
    } else if (lowComparison.cleanBreak && !highComparison.cleanBreak) {
      progression.push(`${currentLabel}: bearish expansion because price created a clean lower low below ${previousLabel} and did not create a clean higher high.`);
    } else if (highComparison.cleanBreak && lowComparison.cleanBreak) {
      progression.push(`${currentLabel}: both sides expanded, so the direction is less clean.`);
    } else {
      progression.push(`${currentLabel}: range/retest condition because price did not cleanly break the previous ${profile.sourceUnitSingular}'s high or low.`);
    }
  }

  const { risingCloses, fallingCloses } = countClosesDirection(levels);
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

  const scoreDifference = Math.abs(bullishScore - bearishScore);
  const confidence = scoreDifference >= 4 ? "high" : scoreDifference >= 2 ? "medium" : "low";
  const reason =
    biasCode === "bearish"
      ? `Price moved down from ${profile.startPriceLabel} ${formatPrice(periodStartPrice)} to the ${profile.currentPriceLabel} ${formatPrice(presentPrice)}. The highest price in the selected ${profile.rangeKind} is ${formatPrice(periodHigh)}, and price is trading below that high. The structure shows downside pressure because price created ${supportCount} new support level(s) from lower lows.`
      : biasCode === "bullish"
      ? `Price moved up from ${profile.startPriceLabel} ${formatPrice(periodStartPrice)} to the ${profile.currentPriceLabel} ${formatPrice(presentPrice)}. The lowest price in the selected ${profile.rangeKind} is ${formatPrice(periodLow)}, and price is trading above that low. The structure shows upside pressure because price created ${resistanceCount} new resistance level(s) from higher highs.`
      : `Price has not shown a clean one-sided move from ${profile.startPriceLabel} ${formatPrice(periodStartPrice)} to the ${profile.currentPriceLabel} ${formatPrice(presentPrice)}. The structure is mixed because price has not clearly continued in one direction.`;

  return {
    bias,
    biasCode,
    confidence,
    periodStartPrice,
    presentPrice,
    periodHigh,
    periodLow,
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
    reason,
    progression,
  };
}

async function fetchTwelveDataStructureLevels({
  symbol,
  chartDate,
  timeframe = "H1",
  timezone = "UTC",
  analysisType = "post-trade",
}) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const profile = getSupportedCsaTimeframeProfile(timeframe);
  const interval = profile.interval;

  const empty = (error, range = null) => ({
    ok: false,
    error,
    dailyLevels: [],
    csaAreas: [],
    directionalBias: calculateCsaDirectionalBias([], symbol, profile),
    rawCandleCount: 0,
    weekRange: range,
    symbol,
    timezone,
    interval,
    profile,
    useFullWeek: normalizeAnalysisType(analysisType) === "post-trade",
  });

  if (!apiKey) return empty("TWELVE_DATA_API_KEY is missing on the server.");
  if (!symbol) return empty("Instrument/pair is missing or unsupported.");
  if (!chartDate) return empty("Final visible chart date is missing. Add the latest date visible on the chart.");

  const structureRange = getStructureRangeForProfile(chartDate, profile, analysisType);
  const params = new URLSearchParams({
    symbol,
    interval,
    start_date: `${structureRange.startDate} 00:00:00`,
    end_date: `${structureRange.endDate} 23:59:59`,
    timezone,
    order: "ASC",
    outputsize: getOutputSizeForInterval(interval),
    apikey: apiKey,
  });

  const response = await fetch(`${TWELVE_DATA_BASE_URL}?${params.toString()}`);
  const data = await response.json();
  if (!response.ok || data.status === "error" || !Array.isArray(data.values)) {
    return {
      ...empty(data.message || data.error || `Twelve Data request failed with status ${response.status}.`, structureRange),
      twelveDataStatus: data.status || "unknown",
    };
  }

  const rawCandles = data.values || [];
  const dailyLevels = buildStructureLevelsFromCandles(rawCandles, structureRange, profile);
  const csaAreas = buildCsaAreas(dailyLevels, symbol, profile);
  const directionalBias = calculateCsaDirectionalBias(dailyLevels, symbol, profile);

  return {
    ok: dailyLevels.length > 0,
    error:
      dailyLevels.length > 0
        ? ""
        : `No usable ${profile.sourceUnitPlural} were returned for the selected ${profile.rangeKind}.`,
    dailyLevels,
    csaAreas,
    directionalBias,
    rawCandleCount: rawCandles.length,
    weekRange: structureRange,
    symbol,
    timezone,
    interval,
    profile,
    useFullWeek: normalizeAnalysisType(analysisType) === "post-trade",
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

function areaBrokenByCloseLater(area, levels = [], symbol = "") {
  if (!area || !Array.isArray(levels)) return false;
  const level = Number(area.price);
  const tolerance = getCleanBreakTolerance(symbol);
  if (!Number.isFinite(level)) return false;
  const laterPeriods = levels.filter((item) => String(item.date || "") > String(area.date || ""));

  if (area.type === "supply" || area.type === "resistance") {
    return laterPeriods.some((item) => Number(item.close) > level + tolerance);
  }
  if (area.type === "demand" || area.type === "support") {
    return laterPeriods.some((item) => Number(item.close) < level - tolerance);
  }
  return false;
}

function filterValidAreas(areaList = [], levels = [], symbol = "") {
  return areaList.filter((area) => !areaBrokenByCloseLater(area, levels, symbol));
}

function filterBrokenAreas(areaList = [], levels = [], symbol = "") {
  return areaList.filter((area) => areaBrokenByCloseLater(area, levels, symbol));
}

function splitAreas(areas = []) {
  return {
    resistanceAreas: areas.filter((area) => area.type === "resistance"),
    supportAreas: areas.filter((area) => area.type === "support"),
    supplyAreas: areas.filter((area) => area.type === "supply"),
    demandAreas: areas.filter((area) => area.type === "demand"),
  };
}

function areaLabel(area) {
  const period = area?.day || area?.period || area?.date || "Unknown period";
  return `${period} ${area?.type || "area"} around ${area?.priceText || formatPrice(Number(area?.price))}`;
}

function describeFailedArea(area) {
  const label = areaLabel(area);
  if (area.type === "support") {
    return `${label} failed because price later closed below it. It should no longer be treated as a valid buy/support entry area. If price retests it from below, it can act as resistance.`;
  }
  if (area.type === "demand") {
    return `${label} failed because price later closed below the demand area. It should no longer be treated as a valid buy area until price reclaims it.`;
  }
  if (area.type === "resistance") {
    return `${label} failed because price later closed above it. It should no longer be treated as a valid sell/resistance entry area. If price retests it from above, it can act as support.`;
  }
  if (area.type === "supply") {
    return `${label} failed because price later closed above the supply area. It should no longer be treated as a valid sell area until price loses it again.`;
  }
  return `${label} failed because price closed through it instead of respecting it.`;
}

function buildFailedAreas({ supportAreas = [], resistanceAreas = [], supplyAreas = [], demandAreas = [], levels = [], symbol = "" }) {
  const mapArea = (area, failedType, mistakeLabel, expectedRole, newRole) => ({
    ...area,
    failedType,
    mistakeLabel,
    expectedRole,
    newRole,
    explanation: describeFailedArea(area),
  });

  return [
    ...filterBrokenAreas(supportAreas, levels, symbol).map((area) =>
      mapArea(area, "failed_support", "Failed support area", "Expected to hold as support / buy area", "Can become resistance if retested from below")
    ),
    ...filterBrokenAreas(demandAreas, levels, symbol).map((area) =>
      mapArea(area, "failed_demand", "Failed demand area", "Expected to hold as demand / buy area", "Invalid as demand until reclaimed")
    ),
    ...filterBrokenAreas(resistanceAreas, levels, symbol).map((area) =>
      mapArea(area, "failed_resistance", "Failed resistance area", "Expected to reject as resistance / sell area", "Can become support if retested from above")
    ),
    ...filterBrokenAreas(supplyAreas, levels, symbol).map((area) =>
      mapArea(area, "failed_supply", "Failed supply area", "Expected to reject as supply / sell area", "Invalid as supply until price loses it again")
    ),
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.failedType || "").localeCompare(String(b.failedType || "")));
}

function listAreas(areaList = [], label = "area", max = 3) {
  if (!Array.isArray(areaList) || !areaList.length) return "- None identified.";
  return [...areaList]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, max)
    .map((area) => `- ${area.day} ${label}: ${area.priceText}`)
    .join("\n");
}

function listFailedAreas(failedAreas = [], max = 6) {
  if (!Array.isArray(failedAreas) || !failedAreas.length) return "- None detected. No CSA support/resistance or supply/demand area failed within the data reviewed.";
  return failedAreas
    .slice(0, max)
    .map((area) => `- ${area.mistakeLabel}: ${area.explanation}`)
    .join("\n");
}

function clampScore(value, min = 0, max = 100) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(min, Math.min(max, Math.round(num))) : min;
}

function scoreLabel(score) {
  if (score >= 85) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Weak";
  return "Poor";
}

function getCurrentPeriodDate(levels = []) {
  if (!Array.isArray(levels) || !levels.length) return null;
  return levels[levels.length - 1]?.date || null;
}

function filterPreviousPeriodAreas(areaList = [], levels = []) {
  const currentDate = getCurrentPeriodDate(levels);
  if (!currentDate) return areaList;
  return areaList.filter((area) => String(area.date || "") < String(currentDate));
}

function sortTargetAreas(targetAreas = [], direction = "", entryPrice = null, levels = []) {
  const entry = Number(entryPrice);
  let filtered = targetAreas.filter((area) => Number.isFinite(Number(area.price)));
  filtered = filterPreviousPeriodAreas(filtered, levels);
  if (Number.isFinite(entry)) {
    if (direction === "bearish") filtered = filtered.filter((area) => Number(area.price) < entry);
    if (direction === "bullish") filtered = filtered.filter((area) => Number(area.price) > entry);
  }
  if (direction === "bearish") return filtered.sort((a, b) => Number(b.price) - Number(a.price));
  if (direction === "bullish") return filtered.sort((a, b) => Number(a.price) - Number(b.price));
  return filtered.sort((a, b) => Number(a.price) - Number(b.price));
}

function buildTargetsText(targetAreas = [], direction = "", entryPrice = null, levels = [], profile = getSupportedCsaTimeframeProfile("H1")) {
  const sortedTargets = sortTargetAreas(targetAreas, direction, entryPrice, levels);
  if (!sortedTargets.length) {
    if (direction === "bearish") return `No valid previous-${profile.sourceUnitSingular} support/demand target is available below the entry area. Skip the sell setup unless a lower higher-timeframe target is clearly visible.`;
    if (direction === "bullish") return `No valid previous-${profile.sourceUnitSingular} resistance/supply target is available above the entry area. Skip the buy setup unless a higher higher-timeframe target is clearly visible.`;
    return `Use the closest previous-${profile.sourceUnitSingular} support/resistance or supply/demand area. If no clear target exists, skip the setup.`;
  }

  const lines = [];
  if (sortedTargets[0]) lines.push(`First TP: ${sortedTargets[0].day} ${sortedTargets[0].type} around ${sortedTargets[0].priceText}.`);
  if (sortedTargets[1]) lines.push(`Second TP: ${sortedTargets[1].day} ${sortedTargets[1].type} around ${sortedTargets[1].priceText}.`);
  if (sortedTargets[2]) lines.push(`Third TP: ${sortedTargets[2].day} ${sortedTargets[2].type} around ${sortedTargets[2].priceText}.`);
  if (direction === "bearish") lines.push("For bearish setups, TP1 starts from the closest previous structural level below entry; TP2 must be lower than TP1.");
  if (direction === "bullish") lines.push("For bullish setups, TP1 starts from the closest previous structural level above entry; TP2 must be higher than TP1.");
  lines.push("Higher-timeframe areas of interest should override smaller structure targets when visible.");
  return lines.join(" ");
}

function buildEntryTriggerText({ direction = "", chartDetection = null }) {
  const trigger = sanitizeVisibleTrigger(chartDetection?.visibleTrigger, chartDetection?.triggerConfidence);
  const triggerDirection = String(chartDetection?.triggerDirection || "").toLowerCase();
  const triggerConfidence = String(chartDetection?.triggerConfidence || "").toLowerCase();

  if (trigger && triggerConfidence !== "low" && (triggerDirection === direction || triggerDirection === "neutral")) {
    return `Visible confirmed trigger on chart: ${trigger}. Still confirm that it forms at the entry area, preferably with lower-timeframe confirmation.`;
  }

  const context = chartDetection?.rejectedTriggerContext
    ? ` The chart may show context such as ${chartDetection.rejectedTriggerContext}, but that is not a confirmed entry trigger by itself.`
    : "";

  if (direction === "bullish") {
    return `No confirmed bullish entry trigger is visible yet.${context} For a buy setup, wait for price to reach the entry area and confirm with bullish engulfing, pin bar/hammer rejection, inside bar break, higher low, channel/flag breakout, or a clean break-and-hold above resistance. Do not enter just because price is pulling back or bouncing.`;
  }

  if (direction === "bearish") {
    return `No confirmed bearish entry trigger is visible yet.${context} For a sell setup, wait for price to reach the entry area and confirm with bearish rejection, bearish engulfing, pin bar rejection, doji rejection, lower high, inside bar break, flag/channel breakdown, head and shoulders, Quasimodo, or a clean break-and-hold below support. Do not enter just because price is pulling back or bouncing.`;
  }

  return `No confirmed entry trigger is visible yet.${context} Wait for a clear candlestick or chart-pattern trigger such as engulfing, pin bar, hammer, doji rejection, inside bar break, lower high/higher low, triangle/flag/channel break, head and shoulders, or Quasimodo. Do not treat bounce, pullback, or consolidation as an entry trigger by itself.`;
}

function buildBrokenSupportText(area) {
  return `${area.day} support now turned resistance around ${area.priceText} due to a close below that support.`;
}

function buildBrokenResistanceText(area) {
  return `${area.day} resistance now turned support around ${area.priceText} due to a close above that resistance.`;
}

function buildDirectionalProgressionText({ bias, brokenSupportAreas, brokenResistanceAreas }) {
  const biasValue = String(bias?.bias || "").toLowerCase();
  if (biasValue.includes("bearish")) {
    const brokenSupportText = brokenSupportAreas.length
      ? `Also, ${brokenSupportAreas.length} previous support area(s) have been broken and can now be treated as possible resistance: ${brokenSupportAreas.map(buildBrokenSupportText).join(" ")}`
      : "No previous support area has clearly closed broken yet, so bearish entry quality depends more on valid supply/resistance.";
    return `${bias.reason} ${brokenSupportText}`;
  }
  if (biasValue.includes("bullish")) {
    const brokenResistanceText = brokenResistanceAreas.length
      ? `Also, ${brokenResistanceAreas.length} previous resistance area(s) have been broken and can now be treated as possible support: ${brokenResistanceAreas.map(buildBrokenResistanceText).join(" ")}`
      : "No previous resistance area has clearly closed broken yet, so bullish entry quality depends more on valid demand/support.";
    return `${bias.reason} ${brokenResistanceText}`;
  }
  return bias.reason || "Bias is mixed because CSA evidence is not clean enough.";
}

function buildTradeCoachingSummary({ resistanceAreas, supportAreas, supplyAreas, demandAreas, levels, bias, symbol, chartDetection, profile }) {
  const biasValue = String(bias?.bias || "").toLowerCase();
  const validSupplyAreas = filterValidAreas(supplyAreas, levels, symbol);
  const validDemandAreas = filterValidAreas(demandAreas, levels, symbol);
  const brokenSupportAreas = filterBrokenAreas(supportAreas, levels, symbol);
  const brokenResistanceAreas = filterBrokenAreas(resistanceAreas, levels, symbol);
  const failedAreas = buildFailedAreas({ supportAreas, resistanceAreas, supplyAreas, demandAreas, levels, symbol });

  let direction = "Mixed / Wait";
  let directionReason = buildDirectionalProgressionText({ bias, brokenSupportAreas, brokenResistanceAreas });
  let bestEntryArea = "No clean entry area yet. Wait for price to reach a valid support/resistance or supply/demand area.";
  let entryTrigger = buildEntryTriggerText({ direction: "mixed", chartDetection });
  let stopLoss = "Place stop loss on the other side of the candlestick or chart pattern trigger, or on the other side of the support/resistance or supply/demand area.";
  let takeProfit = "Use the closest previous support/resistance or supply/demand area as TP1, the next valid area as TP2, and a higher-timeframe area as TP3 if available.";
  let riskReward = "Minimum risk-to-reward should be 1:2. Skip the setup if price is too close to the first target.";
  let tradeManagement = "Use trailing stop, partial close, and breakeven after price moves in your favour or reaches the first trouble area.";
  let verdict = failedAreas.length
    ? "Failed CSA area detected. Do not keep using a failed support/resistance or supply/demand area as the original entry area. Reclassify it based on the break and wait for a fresh trigger."
    : "Setup is not clean enough to chase. Wait for price to return to a valid CSA area and confirm with a trigger.";
  let score = failedAreas.length ? 4 : 5;

  if (biasValue.includes("bullish")) {
    direction = "Bullish";
    const latestBrokenResistance = latestArea(brokenResistanceAreas);
    const entryRef = latestBrokenResistance || latestArea(validDemandAreas) || latestArea(supportAreas);
    const targetAreas = [...filterValidAreas(resistanceAreas, levels, symbol), ...filterValidAreas(supplyAreas, levels, symbol)];
    const entryPrice = entryRef ? Number(entryRef.price) : null;

    bestEntryArea = entryRef
      ? latestBrokenResistance
        ? `${buildBrokenResistanceText(latestBrokenResistance)} This is the preferred bullish entry area if price returns/retests and holds.`
        : `${entryRef.day} ${entryRef.type} around ${entryRef.priceText}. For bullish bias, a broken resistance that becomes support, or a valid demand/support area, is the preferred entry area.`
      : "No clean bullish entry area confirmed yet. Wait for price to retest a broken resistance as support, or return to valid demand/support.";

    entryTrigger = buildEntryTriggerText({ direction: "bullish", chartDetection });
    stopLoss = "Place stop loss below the bullish trigger candle/pattern, or below the support/demand area. Do not place the stop inside the same area being used for entry.";
    takeProfit = buildTargetsText(targetAreas, "bullish", entryPrice, levels, profile);
    riskReward = "Only consider the bullish setup if the distance from entry to TP1 gives at least 1:2 risk-to-reward.";
    tradeManagement = "Move to breakeven only after price reacts strongly in your favour or reaches the first trouble area. Consider partial close at TP1 and trail stop behind higher lows if price continues.";
    verdict = failedAreas.length
      ? "Bullish structure exists, but failed CSA areas reduce setup quality. Do not buy a failed demand/support area unless price reclaims it and confirms again."
      : "Bullish setup is valid only if price pulls back to support/demand or broken resistance and confirms with a clean trigger. Do not buy in the middle without confirmation.";
    score = bias.confidence === "high" ? 8 : bias.confidence === "medium" ? 7 : 6;
    if (failedAreas.length) score = Math.max(4, score - 2);
  } else if (biasValue.includes("bearish")) {
    direction = "Bearish";
    const latestBrokenSupport = latestArea(brokenSupportAreas);
    const entryRef = latestBrokenSupport || latestArea(validSupplyAreas) || latestArea(resistanceAreas);
    const targetAreas = [...filterValidAreas(supportAreas, levels, symbol), ...filterValidAreas(demandAreas, levels, symbol)];
    const entryPrice = entryRef ? Number(entryRef.price) : null;

    bestEntryArea = entryRef
      ? latestBrokenSupport
        ? `${buildBrokenSupportText(latestBrokenSupport)} This is the preferred bearish entry area if price returns/retests and rejects.`
        : `${entryRef.day} ${entryRef.type} around ${entryRef.priceText}. For bearish bias, a broken support that becomes resistance, or a valid supply/resistance area, is the preferred entry area.`
      : "No clean bearish entry area confirmed yet. Wait for price to retest a broken support as resistance, or return to valid supply/resistance.";

    entryTrigger = buildEntryTriggerText({ direction: "bearish", chartDetection });
    stopLoss = "Place stop loss above the bearish trigger candle/pattern, or above the resistance/supply area. Do not place the stop inside the same area being used for entry.";
    takeProfit = buildTargetsText(targetAreas, "bearish", entryPrice, levels, profile);
    riskReward = "Only consider the bearish setup if the distance from entry to TP1 gives at least 1:2 risk-to-reward.";
    tradeManagement = "Move to breakeven only after price reacts strongly in your favour or reaches the first trouble area. Consider partial close at TP1 and trail stop behind lower highs if price continues.";
    verdict = failedAreas.length
      ? "Bearish structure exists, but failed CSA areas must be reclassified. Do not sell a failed supply/resistance area unless price loses it again and confirms."
      : "Bearish setup is valid only if price pulls back to resistance/supply or broken support and confirms with a clean trigger. Do not sell in the middle without confirmation.";
    score = bias.confidence === "high" ? 8 : bias.confidence === "medium" ? 7 : 6;
    if (failedAreas.length) score = Math.max(4, score - 2);
  }

  return { direction, directionReason, bestEntryArea, entryTrigger, stopLoss, takeProfit, riskReward, tradeManagement, verdict, score, brokenSupportAreas, brokenResistanceAreas, validSupplyAreas, validDemandAreas, failedAreas };
}

function buildSimpleStructureBreakdown(levels = [], normalizedSymbol = "", profile = getSupportedCsaTimeframeProfile("H1")) {
  if (!levels.length) return "- No structure data available.";
  return levels
    .map((period, index) => {
      const label = period.periodLabel || period.weekday || period.key;
      if (index === 0) {
        return `${label}:\n- High ${formatPrice(period.high)} = first resistance for this ${profile.rangeKind}.\n- Low ${formatPrice(period.low)} = first support for this ${profile.rangeKind}.`;
      }
      const previous = levels[index - 1];
      const previousLabel = previous.periodLabel || previous.weekday || previous.key;
      const highComparison = compareHighWithTolerance(period.high, previous.high, normalizedSymbol);
      const lowComparison = compareLowWithTolerance(period.low, previous.low, normalizedSymbol);
      const highResult = highComparison.cleanBreak
        ? `High broke above ${previousLabel}'s high, so ${label} high became resistance.`
        : `High failed to cleanly break ${previousLabel}'s high, so ${label} high became supply.`;
      const lowResult = lowComparison.cleanBreak
        ? `Low broke below ${previousLabel}'s low, so ${label} low became support.`
        : `Low held/retested ${previousLabel}'s low, so ${label} low became demand.`;
      return `${label}:\n- ${highResult}\n- ${lowResult}`;
    })
    .join("\n\n");
}

function buildDashboardFeedback({ marketReference, chartDetection, submittedInstrument, timeframe, selectedDateText, detectedDateText, setupScore = 0 }) {
  const profile = marketReference?.profile || getSupportedCsaTimeframeProfile(timeframe);
  const levels = marketReference?.dailyLevels || [];
  const areas = marketReference?.csaAreas || [];
  const bias = marketReference?.directionalBias || calculateCsaDirectionalBias([], marketReference?.symbol || submittedInstrument, profile);
  const symbol = marketReference?.symbol || submittedInstrument;
  const { resistanceAreas, supportAreas, supplyAreas, demandAreas } = splitAreas(areas);
  const failedAreas = buildFailedAreas({ supportAreas, resistanceAreas, supplyAreas, demandAreas, levels, symbol });
  const hasConfirmedTrigger = Boolean(chartDetection?.visibleTrigger);
  const rejectedContext = chartDetection?.rejectedTriggerContext || null;
  const mixedBias = String(bias?.biasCode || "").toLowerCase() === "mixed" || String(bias?.bias || "").toLowerCase().includes("mixed");
  const marketOk = Boolean(marketReference?.ok);
  const strengths = [];
  const weaknesses = [];
  const mistakes = [];

  if (marketOk) {
    strengths.push(`CSA structure used correctly: ${profile.structureLabel}.`);
    strengths.push(`Market data was available and ${levels.length} ${profile.sourceUnitPlural} were reviewed.`);
    strengths.push(`Directional bias was calculated as ${bias.bias} with ${bias.confidence} confidence.`);
  } else {
    weaknesses.push(marketReference?.error || "Market-data reference was unavailable, so the review is less reliable.");
    mistakes.push({ title: "Market data unavailable", severity: "high", detail: marketReference?.error || "CSA structure could not be verified with OHLC data.", correction: "Confirm symbol, timeframe, selected date, and Twelve Data API key." });
  }

  if (chartDetection?.isTradingChart) strengths.push("Uploaded image passed the trading-chart validation check.");
  else weaknesses.push("Uploaded image did not pass trading-chart validation.");

  if (chartDetection?.hasUsablePriceData) strengths.push("Uploaded chart contains usable visible price data.");
  else weaknesses.push(chartDetection?.insufficientDataReason || "Uploaded chart does not contain usable visible price data.");

  if (chartDetection?.detectedInstrument || chartDetection?.detectedTimeframe) strengths.push("Chart context check was completed using the uploaded screenshot.");
  if (areas.length) strengths.push("CSA support/resistance and supply/demand areas were identified.");

  if (hasConfirmedTrigger) {
    strengths.push(`A visible trigger was detected: ${chartDetection.visibleTrigger}.`);
  } else {
    weaknesses.push("No confirmed entry trigger was visible on the uploaded chart.");
    mistakes.push({
      title: "No confirmed entry trigger",
      severity: "medium",
      detail: rejectedContext ? `The chart showed context such as ${rejectedContext}, but that is not confirmation by itself.` : "No clear candlestick or chart-pattern confirmation was visible near the reviewed area.",
      correction: "Wait for a clear trigger such as engulfing, pin bar rejection, inside bar break, lower high/higher low, breakout/breakdown, or clean break-and-hold.",
    });
  }

  if (failedAreas.length) {
    weaknesses.push(`${failedAreas.length} failed CSA area(s) detected. These areas did not hold as expected.`);
    failedAreas.slice(0, 5).forEach((area) => {
      mistakes.push({ title: area.mistakeLabel, severity: "high", detail: area.explanation, correction: `Do not keep using ${areaLabel(area)} as the original entry area after it fails. Reclassify it: ${area.newRole}.` });
    });
  } else if (marketOk) {
    strengths.push("No failed CSA support/resistance or supply/demand area was detected in the reviewed structure period.");
  }

  if (mixedBias) {
    weaknesses.push("Directional bias is mixed, so setup quality is weaker until price reaches an outer CSA area or breaks structure cleanly.");
    mistakes.push({ title: "Mixed structure", severity: "medium", detail: "CSA evidence does not show a clean one-sided move.", correction: "Avoid middle-of-range entries. Wait for price to reach a clear outer CSA area or break and hold beyond the range." });
  }

  if (rejectedContext && !hasConfirmedTrigger) weaknesses.push(`Context-only movement detected: ${rejectedContext}. This should not be treated as confirmation.`);

  const setupQualityScore = clampScore((setupScore || 0) * 10 - failedAreas.length * 8 - (mixedBias ? 12 : 0) + (marketOk ? 5 : -20));
  const entryAccuracyScore = clampScore(65 + (hasConfirmedTrigger ? 15 : -18) - failedAreas.length * 10 - (mixedBias ? 8 : 0));
  const riskManagementScore = clampScore(70 - failedAreas.length * 8 - (!hasConfirmedTrigger ? 8 : 0) - (mixedBias ? 5 : 0));

  const contextCheck = {
    selectedInstrument: submittedInstrument || "Not provided",
    selectedTimeframe: timeframe || "Not provided",
    detectedInstrument: chartDetection?.detectedInstrument || "Not detected",
    detectedTimeframe: chartDetection?.detectedTimeframe || "Not detected",
    selectedDate: selectedDateText || "Not provided",
    detectedLatestVisibleDate: detectedDateText || chartDetection?.latestVisibleDate || "Not detected",
    status: marketOk ? "Matched and reviewed" : "Review limited",
    structureUsed: profile.structureLabel,
    rangeUsed: marketReference?.weekRange ? `${marketReference.weekRange.startDate} to ${marketReference.weekRange.endDate}` : "Not available",
    chartValidation: chartDetection?.isTradingChart ? "Valid trading chart" : "Invalid or unverified chart",
    chartDataQuality: chartDetection?.chartDataQuality || "unclear",
    visibleCandleCount: chartDetection?.visibleCandleCount || 0,
  };

  const setupQuality = {
    score: setupQualityScore,
    label: scoreLabel(setupQualityScore),
    summary: failedAreas.length ? "Setup quality is reduced because one or more CSA areas failed instead of holding as expected." : mixedBias ? "Setup quality is limited because the structure is mixed/range-bound." : "Setup quality is based on CSA structure, bias clarity, valid areas, and failed-area checks.",
  };

  const entryAccuracy = {
    score: entryAccuracyScore,
    label: scoreLabel(entryAccuracyScore),
    summary: hasConfirmedTrigger ? "Entry accuracy improves because a visible trigger was detected, but it must still align with the CSA area." : "Entry accuracy is reduced because no confirmed trigger was visible at the reviewed area.",
  };

  const riskManagement = {
    score: riskManagementScore,
    label: scoreLabel(riskManagementScore),
    summary: failedAreas.length ? "Risk management must account for failed areas. Stops should not be placed inside failed zones, and trades should not be forced after invalidation." : "Risk management should still confirm stop placement beyond the structure area and minimum 1:2 risk-to-reward.",
  };

  const aiMistakeDetectionHub = mistakes.length
    ? mistakes
    : [{ title: "No major mistake detected", severity: "low", detail: "No failed CSA area, mismatch, or obvious confirmation problem was detected from the available data.", correction: "Still confirm entry trigger, stop placement, and risk-to-reward before considering any setup." }];

  return {
    strengths: strengths.length ? strengths.slice(0, 7) : ["CSA Coach completed the review, but no specific strength was available from the returned data."],
    weaknesses: weaknesses.length ? weaknesses.slice(0, 7) : ["No major weakness detected from the available CSA structure data."],
    mistakes: aiMistakeDetectionHub,
    aiMistakeDetectionHub,
    failedAreas,
    contextCheck,
    chartContextCheck: contextCheck,
    setupQuality,
    entryAccuracy,
    riskManagement,
    scores: { setupQuality: setupQualityScore, entryAccuracy: entryAccuracyScore, riskManagement: riskManagementScore },
  };
}

function buildDashboardAliases(dashboardFeedback = {}) {
  const contextCheck = dashboardFeedback.contextCheck || dashboardFeedback.chartContextCheck || {};
  const setupQuality = dashboardFeedback.setupQuality || { score: 0, label: "Unavailable", summary: "Setup quality was not calculated." };
  const entryAccuracy = dashboardFeedback.entryAccuracy || { score: 0, label: "Unavailable", summary: "Entry accuracy was not calculated." };
  const riskManagement = dashboardFeedback.riskManagement || { score: 0, label: "Unavailable", summary: "Risk management was not calculated." };
  const strengths = Array.isArray(dashboardFeedback.strengths) && dashboardFeedback.strengths.length ? dashboardFeedback.strengths : ["CSA Coach completed the review, but no strength item was returned."];
  const weaknesses = Array.isArray(dashboardFeedback.weaknesses) && dashboardFeedback.weaknesses.length ? dashboardFeedback.weaknesses : ["No major weakness detected from the available CSA structure data."];
  const aiMistakeDetectionHub = Array.isArray(dashboardFeedback.aiMistakeDetectionHub) && dashboardFeedback.aiMistakeDetectionHub.length ? dashboardFeedback.aiMistakeDetectionHub : [{ title: "No major mistake detected", severity: "low", detail: "No failed CSA area, mismatch, or obvious confirmation problem was detected.", correction: "Still confirm trigger, stop placement, and risk-to-reward." }];
  const failedAreas = Array.isArray(dashboardFeedback.failedAreas) ? dashboardFeedback.failedAreas : [];

  return {
    strengths,
    weaknesses,
    chartContextCheck: contextCheck,
    contextCheck,
    chartContext: contextCheck,
    chartContextStatus: contextCheck.status || "Not available",
    selectedContext: {
      instrument: contextCheck.selectedInstrument || "Not provided",
      timeframe: contextCheck.selectedTimeframe || "Not provided",
      date: contextCheck.selectedDate || "Not provided",
    },
    detectedContext: {
      instrument: contextCheck.detectedInstrument || "Not detected",
      timeframe: contextCheck.detectedTimeframe || "Not detected",
      latestVisibleDate: contextCheck.detectedLatestVisibleDate || "Not detected",
    },
    setupQuality,
    setupQualityScore: setupQuality.score,
    setupQualityLabel: setupQuality.label,
    setupQualitySummary: setupQuality.summary,
    entryAccuracy,
    entryAccuracyScore: entryAccuracy.score,
    entryAccuracyLabel: entryAccuracy.label,
    entryAccuracySummary: entryAccuracy.summary,
    riskManagement,
    riskManagementScore: riskManagement.score,
    riskManagementLabel: riskManagement.label,
    riskManagementSummary: riskManagement.summary,
    aiMistakeDetectionHub,
    mistakeDetectionHub: aiMistakeDetectionHub,
    mistakeHub: aiMistakeDetectionHub,
    mistakes: aiMistakeDetectionHub,
    failedAreas,
    dashboard: { strengths, weaknesses, chartContextCheck: contextCheck, contextCheck, setupQuality, entryAccuracy, riskManagement, aiMistakeDetectionHub, mistakes: aiMistakeDetectionHub, failedAreas },
    dashboardCards: { strengths, weaknesses, chartContextCheck: contextCheck, setupQuality, entryAccuracy, riskManagement, aiMistakeDetectionHub, failedAreas },
  };
}

function buildSimpleTextAnalysisForNoMarketData({ marketReference, dateDecision, chartDetection, profile }) {
  return `CSA COACH VERDICT

Directional Bias:
- Insufficient data
- Reason: Backend OHLC market data was not available, so CSA Coach cannot reliably compare the required ${profile.structureLabel}, broken support/resistance count, or price progression.

Best Entry Area:
- Not available. Wait until backend OHLC data confirms valid support/resistance or supply/demand areas.

Entry Trigger:
- Not available.

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

Overall Setup Score:
- 0/10

READ_MORE_DETAILS:

Data Issue:
- Reason: ${marketReference?.error || "Unknown error"}
- Selected date: ${dateDecision?.selectedDateText || "Not provided"}
- Final date used: ${dateDecision?.finalDateText || "Not provided"}
- CSA structure expected: ${profile.structureLabel}
- Detected instrument: ${chartDetection?.detectedInstrument || "Not detected"}
- Detected timeframe: ${chartDetection?.detectedTimeframe || "Not detected"}`;
}

function buildDeterministicCsaAnalysis({ marketReference, dateDecision, chartDetection, submittedInstrument, normalizedSymbol, timeframe }) {
  const profile = marketReference?.profile || getSupportedCsaTimeframeProfile(timeframe);
  if (!marketReference || !marketReference.ok) return buildSimpleTextAnalysisForNoMarketData({ marketReference, dateDecision, chartDetection, profile });

  const levels = marketReference.dailyLevels || [];
  const areas = marketReference.csaAreas || [];
  const bias = marketReference.directionalBias || calculateCsaDirectionalBias(levels, normalizedSymbol, profile);
  const tolerance = getCleanBreakTolerance(normalizedSymbol);
  const { resistanceAreas, supportAreas, supplyAreas, demandAreas } = splitAreas(areas);
  const validSupplyAreas = filterValidAreas(supplyAreas, levels, normalizedSymbol);
  const validDemandAreas = filterValidAreas(demandAreas, levels, normalizedSymbol);
  const brokenSupplyAreas = filterBrokenAreas(supplyAreas, levels, normalizedSymbol);
  const brokenDemandAreas = filterBrokenAreas(demandAreas, levels, normalizedSymbol);
  const brokenSupportAreas = filterBrokenAreas(supportAreas, levels, normalizedSymbol);
  const brokenResistanceAreas = filterBrokenAreas(resistanceAreas, levels, normalizedSymbol);
  const failedAreas = buildFailedAreas({ supportAreas, resistanceAreas, supplyAreas, demandAreas, levels, symbol: normalizedSymbol });
  const tradeCoach = buildTradeCoachingSummary({ resistanceAreas, supportAreas, supplyAreas, demandAreas, levels, bias, symbol: normalizedSymbol, chartDetection, profile });

  return `CSA COACH VERDICT

CSA Structure Used:
- ${profile.structureLabel}

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
- Timeframe selected: ${profile.selectedTimeframe}
- Structure source: ${profile.structureLabel}
- ${profile.startPriceLabel}: ${formatPrice(bias.periodStartPrice)}
- ${profile.currentPriceLabel}: ${formatPrice(bias.presentPrice)}
- Highest price in selected ${profile.rangeKind}: ${formatPrice(bias.periodHigh)}
- Lowest price in selected ${profile.rangeKind}: ${formatPrice(bias.periodLow)}
- Price movement: ${formatPrice(bias.priceMove)}
- New resistance levels created from higher highs: ${bias.resistanceCount}
- New support levels created from lower lows: ${bias.supportCount}
- Broken support now resistance count: ${brokenSupportAreas.length}
- Broken resistance now support count: ${brokenResistanceAreas.length}
- Bias confidence: ${bias.confidence}

Key CSA Areas:
Resistance:
${listAreas(resistanceAreas, "resistance")}

Support:
${listAreas(supportAreas, "support")}

Broken Support Now Resistance:
${listAreas(brokenSupportAreas, "broken support/resistance")}

Broken Resistance Now Support:
${listAreas(brokenResistanceAreas, "broken resistance/support")}

Valid Supply:
${listAreas(validSupplyAreas, "supply")}

Valid Demand:
${listAreas(validDemandAreas, "demand")}

Ignored / Broken Supply-Demand:
Broken Supply:
${listAreas(brokenSupplyAreas, "supply")}

Broken Demand:
${listAreas(brokenDemandAreas, "demand")}

Failed CSA Areas:
${listFailedAreas(failedAreas)}

${profile.breakdownTitle}:
${buildSimpleStructureBreakdown(levels, normalizedSymbol, profile)}

Chart Trigger Scan:
- Confirmed visible trigger: ${chartDetection?.visibleTrigger || "None confirmed"}
- Rejected context-only movement: ${chartDetection?.rejectedTriggerContext || "None"}
- Trigger direction: ${chartDetection?.triggerDirection || "Not detected"}
- Trigger confidence: ${chartDetection?.triggerConfidence || "low"}
- Chart data quality: ${chartDetection?.chartDataQuality || "unclear"}
- Visible candle count: ${chartDetection?.visibleCandleCount || 0}

Technical Notes:
- Data source: Twelve Data
- Symbol used: ${marketReference.symbol}
- Selected instrument: ${submittedInstrument}
- Selected timeframe: ${timeframe}
- Timeframe used by data source: ${marketReference.interval}
- CSA structure used: ${profile.structureLabel}
- Range used: ${marketReference.weekRange.startDate} to ${marketReference.weekRange.finalDate}
- Data used up to: ${marketReference.weekRange.endDate}
- Clean-break tolerance: ${formatPrice(tolerance)}
- A failed area is an area that was expected to hold as an entry/reaction zone but price closed through it.
- Twelve Data supports/validates levels only; it must not replace an uploaded chart with no usable visible price data.
- Stop loss, target, and risk-to-reward are structural coaching comments only. They are not financial advice.`;
}

function buildInvalidChartAnalysis({ submittedInstrument, timeframe, chartDetection }) {
  return `Invalid Chart Upload

What happened:
- The uploaded image does not appear to be a financial trading chart.

Why analysis was stopped:
- CSA Coach can only review trading chart screenshots with visible price movement, price scale, and date/time structure.

Selected:
- Instrument: ${submittedInstrument || "Not provided"}
- Timeframe: ${timeframe || "Not provided"}

AI image check:
- Status: Not a valid trading chart
- Reason: ${chartDetection?.chartValidityReason || "The uploaded image could not be verified as a trading chart."}

How to fix:
- Upload a real TradingView / MT4 / MT5 / broker chart screenshot.
- Make sure candles or price movement are visible.
- Make sure the selected pair and timeframe match the uploaded chart.`;
}

function buildInsufficientChartDataAnalysis({ submittedInstrument, timeframe, selectedDateText, chartDetection }) {
  return `Insufficient Chart Data

What happened:
- The uploaded image appears to be a trading chart, but it does not show enough usable visible price data for CSA Coach to review the setup.

Why analysis was stopped:
- CSA Coach must verify the uploaded chart itself before using market-data reference levels.
- The chart must show enough visible candles/price movement around the selected chart/trade date.
- Twelve Data cannot replace a blank, empty, loading, cropped, or unclear uploaded chart.

Selected:
- Instrument: ${submittedInstrument || "Not provided"}
- Timeframe: ${timeframe || "Not provided"}
- Selected chart/trade date: ${selectedDateText || "Not provided"}

AI image check:
- Chart data quality: ${chartDetection?.chartDataQuality || "unclear"}
- Visible candle count: ${chartDetection?.visibleCandleCount ?? "Not detected"}
- Selected date visible/covered: ${chartDetection?.selectedDateVisible === true ? "Yes" : "No / not confirmed"}
- Reason: ${chartDetection?.insufficientDataReason || "The chart does not show enough usable price movement."}

How to fix:
- Upload a clearer chart screenshot.
- Make sure candles are visible.
- Make sure the selected date is visible or reasonably covered on the chart.
- Make sure there is enough left-side and right-side price structure.
- Do not upload a blank, loading, or heavily cropped chart.`;
}

function buildInstrumentMismatchAnalysis({ selectedInstrument, detectedInstrument, selectedTimeframe, detectedTimeframe }) {
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

function buildTimeframeMismatchAnalysis({ selectedInstrument, detectedInstrument, selectedTimeframe, detectedTimeframe }) {
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

function buildStoppedDashboard({ errorType, error, submittedInstrument, timeframe, chartDetection, selectedTimeframeProfile }) {
  return buildDashboardAliases({
    strengths: [
      "Chart context validation was completed before the review was stopped.",
      `CSA structure expected: ${selectedTimeframeProfile?.structureLabel || "Not available"}.`,
    ],
    weaknesses: [error, chartDetection?.insufficientDataReason || chartDetection?.chartValidityReason || "Analysis stopped."],
    contextCheck: {
      selectedInstrument: submittedInstrument || "Not provided",
      selectedTimeframe: timeframe || "Not provided",
      detectedInstrument: chartDetection?.detectedInstrument || "Not detected",
      detectedTimeframe: chartDetection?.detectedTimeframe || "Not detected",
      selectedDate: "Not available",
      detectedLatestVisibleDate: chartDetection?.latestVisibleDate || "Not detected",
      status: "Analysis stopped",
      structureUsed: selectedTimeframeProfile?.structureLabel || "Not available",
      rangeUsed: "Not available",
      chartValidation: chartDetection?.isTradingChart ? "Valid trading chart" : "Invalid or unverified chart",
      chartDataQuality: chartDetection?.chartDataQuality || "unclear",
      visibleCandleCount: chartDetection?.visibleCandleCount || 0,
    },
    setupQuality: { score: 0, label: "Stopped", summary: error },
    entryAccuracy: { score: 0, label: "Stopped", summary: error },
    riskManagement: { score: 0, label: "Stopped", summary: error },
    aiMistakeDetectionHub: [{ title: errorType, severity: "high", detail: error, correction: "Correct the upload or selected context and run the analysis again." }],
    failedAreas: [],
  });
}

function stoppedResponse({ res, errorType, error, analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile }) {
  const stoppedDashboard = buildStoppedDashboard({ errorType, error, submittedInstrument, timeframe, chartDetection, selectedTimeframeProfile });
  return res.status(200).json({
    success: false,
    errorType,
    error,
    analysis,
    summary: analysis,
    selectedPair: submittedInstrument,
    selectedTimeframe: timeframe,
    detectedPair: chartDetection?.detectedInstrument || "Not detected",
    detectedTimeframe: chartDetection?.detectedTimeframe || "Not detected",
    detectedLatestVisibleDate: chartDetection?.latestVisibleDate || "Not detected",
    contextStatus: "Analysis stopped before market-data-backed CSA feedback was generated.",
    grade: "--",
    confidence: 0,
    structureScore: 0,
    executionScore: 0,
    riskScore: 0,
    ...stoppedDashboard,
    coachAdvice: [analysis],
    journalTags: [errorType, "analysis-stopped"],
    chartDetection,
    marketReference: {
      ok: false,
      error,
      symbol: normalizedSymbol,
      timezone,
      interval: normalizeTimeframe(timeframe),
      rawCandleCount: 0,
      weekRange: null,
      dailyLevels: [],
      csaAreas: [],
      directionalBias: calculateCsaDirectionalBias([], normalizedSymbol, selectedTimeframeProfile),
      profile: selectedTimeframeProfile,
    },
  });
}

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "CSA Coach backend is running" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "csa-coach-backend", time: new Date().toISOString() });
});

app.get("/test-twelve", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol || "GBP/USD");
    const timeframe = req.query.timeframe || "H1";
    const date = req.query.date || "2026-07-15";
    const timezone = req.query.timezone || "UTC";
    const analysisType = normalizeAnalysisType(req.query.analysisType || "post-trade");
    const chartDate = parseISODateOnly(date);

    if (!chartDate) {
      return res.status(400).json({ ok: false, error: "Invalid date. Use YYYY-MM-DD format." });
    }

    const result = await fetchTwelveDataStructureLevels({ symbol, chartDate, timeframe, timezone, analysisType });
    res.json({
      ok: result.ok,
      symbol,
      timeframe,
      interval: result.interval,
      date,
      timezone,
      analysisType,
      error: result.error,
      structureMode: result.profile?.structureMode,
      structureLabel: result.profile?.structureLabel,
      range: result.weekRange,
      rawCandleCount: result.rawCandleCount,
      dailyLevels: result.dailyLevels,
      csaAreas: result.csaAreas,
      directionalBias: result.directionalBias,
      cleanBreakTolerance: getCleanBreakTolerance(symbol),
    });
  } catch (error) {
    console.error("test-twelve error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/analyze-chart", upload.single("chart"), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ success: false, error: "OPENAI_API_KEY is missing on the server." });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: "No chart image uploaded." });
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

    const submittedInstrument = instrument || pair || selectedPair || "Not provided";
    const submittedNotes = notes || userNotes || "";
    const normalizedSymbol = normalizeSymbol(submittedInstrument);
    const mode = normalizeAnalysisType(analysisType);
    const selectedTimeframeProfile = getSupportedCsaTimeframeProfile(timeframe);
    const imageBase64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/png";
    const selectedDate = parseISODateOnly(chartDate || tradeDate);

    const chartDetection = await detectChartContextFromImage({
      imageBase64,
      mimeType,
      submittedInstrument,
      selectedTimeframe: timeframe,
      selectedDateText: chartDate || tradeDate || "",
      analysisType: mode,
    });

    if (!chartDetection.isTradingChart) {
      const analysis = buildInvalidChartAnalysis({ submittedInstrument, timeframe, chartDetection });
      return stoppedResponse({ res, errorType: "invalid_chart_image", error: "Uploaded image is not a valid trading chart.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    if (!isUploadedChartDataUsable(chartDetection, chartDate || tradeDate || "")) {
      const analysis = buildInsufficientChartDataAnalysis({ submittedInstrument, timeframe, selectedDateText: chartDate || tradeDate || "", chartDetection });
      return stoppedResponse({ res, errorType: "insufficient_chart_data", error: "Uploaded chart does not have enough visible price data for review.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    const instrumentMismatch = hasStrongInstrumentMismatch({ selectedInstrument: normalizedSymbol || submittedInstrument, detectedInstrument: chartDetection.detectedInstrument });
    if (instrumentMismatch) {
      const analysis = buildInstrumentMismatchAnalysis({ selectedInstrument: submittedInstrument, detectedInstrument: chartDetection.detectedInstrument, selectedTimeframe: timeframe, detectedTimeframe: chartDetection.detectedTimeframe });
      return stoppedResponse({ res, errorType: "instrument_mismatch", error: "Selected instrument does not match uploaded chart.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    const timeframeMismatch = hasStrongTimeframeMismatch({ selectedTimeframe: timeframe, detectedTimeframe: chartDetection.detectedTimeframe });
    if (timeframeMismatch) {
      const analysis = buildTimeframeMismatchAnalysis({ selectedInstrument: submittedInstrument, detectedInstrument: chartDetection.detectedInstrument, selectedTimeframe: timeframe, detectedTimeframe: chartDetection.detectedTimeframe });
      return stoppedResponse({ res, errorType: "timeframe_mismatch", error: "Selected timeframe does not match uploaded chart timeframe.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    const dateDecision = chooseFinalChartDate({ selectedDate, detection: chartDetection, analysisType: mode });
    const marketReference = await fetchTwelveDataStructureLevels({ symbol: normalizedSymbol, chartDate: dateDecision.finalDate, timeframe, timezone: timezone || "UTC", analysisType: mode });

    const analysis = buildDeterministicCsaAnalysis({ marketReference, dateDecision, chartDetection, analysisType: mode, submittedInstrument, normalizedSymbol, timeframe, timezone: timezone || "UTC", submittedNotes });
    const bias = marketReference.directionalBias || calculateCsaDirectionalBias([], normalizedSymbol, selectedTimeframeProfile);
    const setupScoreMatch = String(analysis).match(/Overall Setup Score:\s*\n- (\d+)\/10/i);
    const setupScore = setupScoreMatch ? Number(setupScoreMatch[1]) : 0;

    const dashboardFeedback = buildDashboardFeedback({ marketReference, chartDetection, submittedInstrument, timeframe, selectedDateText: chartDate || tradeDate || "Not provided", detectedDateText: chartDetection.latestVisibleDate || "Not detected", setupScore });
    const dashboardAliases = buildDashboardAliases(dashboardFeedback);
    const structureLabel = marketReference.profile?.structureLabel || selectedTimeframeProfile.structureLabel || "CSA structure levels";

    return res.json({
      success: true,
      analysis,
      summary: analysis,
      selectedPair: submittedInstrument,
      selectedTimeframe: timeframe,
      selectedDate: chartDate || tradeDate || "Not provided",
      analysisType: mode,
      detectedPair: chartDetection.detectedInstrument || normalizedSymbol || "Not available",
      detectedTimeframe: chartDetection.detectedTimeframe || timeframe,
      detectedLatestVisibleDate: chartDetection.latestVisibleDate || "Not detected",
      finalDateUsed: dateDecision.finalDateText,
      dateDecision,
      csaDirectionalBias: bias,
      contextStatus: marketReference.ok
        ? `Market-data-backed CSA setup review completed using ${structureLabel}.`
        : `Setup review completed without market data: ${marketReference.error}`,
      grade: setupScore >= 8 ? "A" : setupScore >= 7 ? "B" : setupScore >= 6 ? "C" : setupScore >= 4 ? "D" : "F",
      confidence: setupScore * 10,
      structureScore: dashboardFeedback.scores.setupQuality,
      executionScore: dashboardFeedback.scores.entryAccuracy,
      riskScore: dashboardFeedback.scores.riskManagement,
      ...dashboardAliases,
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
        marketReference.profile?.selectedTimeframe || selectedTimeframeProfile.selectedTimeframe,
        marketReference.profile?.structureMode || selectedTimeframeProfile.structureMode,
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
        profile: marketReference.profile,
        structureMode: marketReference.profile?.structureMode,
        structureLabel: marketReference.profile?.structureLabel,
        cleanBreakTolerance: getCleanBreakTolerance(normalizedSymbol),
      },
    });
  } catch (error) {
    console.error("CSA Coach analyze error:", error);
    return res.status(500).json({ success: false, error: "Something went wrong while analyzing the chart.", details: error.message });
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
