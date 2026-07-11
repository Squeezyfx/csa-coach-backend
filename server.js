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
You are CSA Coach's chart screenshot validator. Return ONLY valid JSON.

A valid trading chart screenshot must show visible candles/bars/line movement, price scale, and time/date axis.
A platform screenshot alone is not enough.

Invalid or insufficient images include:
- photos, documents, logos, rooms, screenshots with no financial chart
- blank charts, loading charts, heavily cropped charts, or charts where candles are not visible
- charts with fewer than about 20 visible candles/bars/price points

Selected-date rule:
- If a selected chart/trade date is provided and it is later than the latest visible date on the chart, selectedDateVisible must be false.
- Example: selected date 2026-07-10 but latest visible chart date around 2026-06-11 means selectedDateVisible=false and latestVisibleDate=2026-06-11 if readable.
- Always estimate latestVisibleDate from the bottom time axis when possible.
- Twelve Data must not replace a blank, unclear, or wrong-date uploaded chart.

Entry trigger rule:
Only return visibleTrigger if there is real confirmation such as engulfing, pin bar, hammer, doji rejection, inside bar break, lower high/higher low, breakout/breakdown, flag/channel/triangle break, head and shoulders, Quasimodo, or clean break-and-hold.
Bounce, pullback, reaction, retracement, ranging, or consolidation alone is not a trigger.

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
}`;

const CONFIRMED_TRIGGER_WORDS = [
  "engulfing", "pin bar", "pinbar", "hammer", "doji", "inside bar", "lower high",
  "higher low", "breakout", "breakdown", "break-and-hold", "break and hold",
  "head and shoulders", "quasimodo", "channel", "flag", "triangle", "rejection"
];

const CONTEXT_ONLY_TRIGGER_WORDS = [
  "bounce", "bouncing", "pullback", "pull back", "retracement", "retrace",
  "consolidation", "consolidating", "reaction", "range", "ranging", "moving away"
];

function normalizeSymbol(input = "") {
  const raw = String(input).trim().toUpperCase().replace(/\s+/g, "");
  const map = {
    EURUSD: "EUR/USD", GBPUSD: "GBP/USD", EURCHF: "EUR/CHF", EURGBP: "EUR/GBP",
    GBPJPY: "GBP/JPY", USDJPY: "USD/JPY", USDCHF: "USD/CHF", USDCAD: "USD/CAD",
    AUDUSD: "AUD/USD", NZDUSD: "NZD/USD", XAUUSD: "XAU/USD", GOLD: "XAU/USD",
    BTCUSD: "BTC/USD", BTCUSDT: "BTC/USD",
  };
  if (map[raw]) return map[raw];
  if (raw.includes("/")) return raw;
  if (raw.length === 6) return `${raw.slice(0, 3)}/${raw.slice(3)}`;
  return raw || "";
}

function comparableInstrument(input = "") {
  const raw = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  if (raw.includes("GOLD")) return "XAUUSD";
  if (raw.includes("BTCUSDT")) return "BTCUSD";
  const known = [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
    "EURCHF", "EURGBP", "GBPJPY", "XAUUSD", "BTCUSD"
  ];
  return known.find((symbol) => raw.includes(symbol)) || normalizeSymbol(raw).replace(/[^A-Z0-9]/g, "");
}

function comparableTimeframe(input = "") {
  const raw = String(input).trim().toUpperCase().replace(/\s+/g, "");
  const cleaned = raw.replace(/[^A-Z0-9]/g, "");
  if (!raw || raw === "NOTPROVIDED" || raw === "NOTDETECTED" || raw === "NULL") return "";
  const map = {
    "1": "M1", "1M": "M1", M1: "M1", "1MIN": "M1",
    "5": "M5", "5M": "M5", M5: "M5", "5MIN": "M5",
    "15": "M15", "15M": "M15", M15: "M15", "15MIN": "M15",
    "30": "M30", "30M": "M30", M30: "M30", "30MIN": "M30",
    "60": "H1", "60M": "H1", "1H": "H1", H1: "H1",
    "240": "H4", "240M": "H4", "4H": "H4", H4: "H4",
    D: "D1", "1D": "D1", D1: "D1", DAILY: "D1",
    W: "W1", "1W": "W1", W1: "W1", WEEKLY: "W1",
    MN: "MN", MTH: "MN", MONTH: "MN", MONTHLY: "MN", "1MO": "MN", "1MON": "MN", "1MONTH": "MN",
  };
  return map[raw] || map[cleaned] || cleaned;
}

function normalizeTimeframe(input = "") {
  const tf = comparableTimeframe(input);
  const map = { M1: "1min", M5: "5min", M15: "15min", M30: "30min", H1: "1h", H4: "4h", D1: "1day", W1: "1week", MN: "1month" };
  return map[tf] || "1h";
}

function normalizeAnalysisType(input = "") {
  const raw = String(input).trim().toLowerCase();
  if (raw.includes("pre") || raw.includes("before")) return "pre-trade";
  return "post-trade";
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
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function candleDateOnly(datetimeValue = "") {
  return String(datetimeValue).slice(0, 10);
}

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 100) return n.toFixed(3);
  if (Math.abs(n) >= 10) return n.toFixed(4);
  return n.toFixed(5);
}

function getMonthName(monthIndex) {
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, monthIndex, 1)));
}

function getQuarterLabel(monthIndex) {
  if (monthIndex <= 2) return "Q1";
  if (monthIndex <= 5) return "Q2";
  if (monthIndex <= 8) return "Q3";
  return "Q4";
}

function stripCodeFence(text = "") {
  return String(text).replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
}

function extractJsonObject(text = "") {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
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

async function detectChartContextFromImage({ imageBase64, mimeType, submittedInstrument = "", selectedTimeframe = "", selectedDateText = "", analysisType = "post-trade" }) {
  const fallback = (reason) => ({
    ok: false,
    isTradingChart: false,
    chartValidityReason: reason,
    hasUsablePriceData: false,
    visibleCandleCount: 0,
    chartDataQuality: "unclear",
    selectedDateVisible: false,
    insufficientDataReason: reason,
    detectedInstrument: null,
    detectedTimeframe: null,
    latestVisibleDate: null,
    dateConfidence: "low",
    visibleTrigger: null,
    rejectedTriggerContext: null,
    triggerDirection: null,
    triggerConfidence: "low",
    notes: reason,
    raw: "",
  });

  if (!process.env.OPENAI_API_KEY) return fallback("OPENAI_API_KEY is missing.");

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
              text: `Inspect this uploaded chart image.\nSelected instrument: ${submittedInstrument || "not provided"}\nSelected timeframe: ${selectedTimeframe || "not provided"}\nSelected chart/trade date: ${selectedDateText || "not provided"}\nAnalysis type: ${analysisType || "post-trade"}\nReturn only JSON.`,
            },
            { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}` },
          ],
        },
      ],
      max_output_tokens: 700,
    });

    const parsed = extractJsonObject(response.output_text || "");
    if (!parsed) return fallback("Chart validation did not return usable JSON.");

    const isTradingChart = parsed?.isTradingChart === true;
    const rawTrigger = parsed?.visibleTrigger || null;
    const triggerConfidence = parsed?.triggerConfidence || "low";
    const cleanTrigger = sanitizeVisibleTrigger(rawTrigger, triggerConfidence);

    return {
      ok: true,
      isTradingChart,
      chartValidityReason: parsed?.chartValidityReason || (isTradingChart ? "The uploaded image appears to be a valid trading chart." : "The uploaded image does not appear to be a valid financial trading chart."),
      hasUsablePriceData: isTradingChart ? parsed?.hasUsablePriceData === true : false,
      visibleCandleCount: Number.isFinite(Number(parsed?.visibleCandleCount)) ? Number(parsed.visibleCandleCount) : 0,
      chartDataQuality: isTradingChart ? parsed?.chartDataQuality || "unclear" : "unclear",
      selectedDateVisible: isTradingChart ? parsed?.selectedDateVisible === true : false,
      insufficientDataReason: parsed?.insufficientDataReason || (!isTradingChart ? "The uploaded image is not a financial trading chart." : parsed?.hasUsablePriceData === true ? null : "The uploaded chart does not show enough usable visible price data."),
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
    return fallback(`Chart validation failed: ${error.message}`);
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

function getDaysBetweenDates(earlierDate, laterDate) {
  if (!earlierDate || !laterDate) return null;
  const earlier = Date.UTC(earlierDate.getUTCFullYear(), earlierDate.getUTCMonth(), earlierDate.getUTCDate());
  const later = Date.UTC(laterDate.getUTCFullYear(), laterDate.getUTCMonth(), laterDate.getUTCDate());
  const diff = Math.round((later - earlier) / 86400000);
  return Number.isFinite(diff) ? diff : null;
}

function getAllowedFutureDateGapDays(timeframe = "") {
  const tf = comparableTimeframe(timeframe);
  if (["M1", "M5", "M15", "M30", "H1"].includes(tf)) return 2;
  if (tf === "H4") return 7;
  if (tf === "D1") return 31;
  if (tf === "W1") return 92;
  if (tf === "MN") return 370;
  return 2;
}

function getSelectedDateMismatch(chartDetection, selectedDate, timeframe = "") {
  if (!selectedDate || !chartDetection?.latestVisibleDate) {
    return { hasMismatch: false, selectedDateText: selectedDate ? formatDateOnly(selectedDate) : null, latestVisibleDateText: chartDetection?.latestVisibleDate || null };
  }
  const latestVisibleDate = parseISODateOnly(chartDetection.latestVisibleDate);
  if (!latestVisibleDate) return { hasMismatch: false };
  const daysAfterLatestVisible = getDaysBetweenDates(latestVisibleDate, selectedDate);
  const allowedGapDays = getAllowedFutureDateGapDays(timeframe);
  const confidence = String(chartDetection.dateConfidence || "").toLowerCase();
  const hasUsableConfidence = confidence === "high" || confidence === "medium";
  const hasMismatch = hasUsableConfidence && Number.isFinite(daysAfterLatestVisible) && daysAfterLatestVisible > allowedGapDays;
  return {
    hasMismatch,
    selectedDateText: formatDateOnly(selectedDate),
    latestVisibleDateText: formatDateOnly(latestVisibleDate),
    daysAfterLatestVisible,
    allowedGapDays,
    dateConfidence: confidence || "low",
    reason: hasMismatch
      ? `Selected date is ${daysAfterLatestVisible} day(s) after the latest visible chart date, which is beyond the allowed ${allowedGapDays} day(s) for ${comparableTimeframe(timeframe) || timeframe}.`
      : "Selected date is not clearly beyond the latest visible chart date.",
  };
}

function isUsableChartDateDetection(detection) {
  if (!detection || !detection.latestVisibleDate) return false;
  if (!parseISODateOnly(detection.latestVisibleDate)) return false;
  const confidence = String(detection.dateConfidence || "").toLowerCase();
  return confidence === "high" || confidence === "medium";
}

function chooseFinalChartDate({ selectedDate, detection, analysisType = "post-trade" }) {
  const detectedDate = isUsableChartDateDetection(detection) ? parseISODateOnly(detection.latestVisibleDate) : null;
  if (selectedDate) {
    return {
      finalDate: selectedDate,
      finalDateText: formatDateOnly(selectedDate),
      selectedDateText: formatDateOnly(selectedDate),
      detectedDateText: detectedDate ? formatDateOnly(detectedDate) : null,
      source: `${normalizeAnalysisType(analysisType)}-user-selected-date`,
      reason: "User-selected chart/trade date was used.",
    };
  }
  if (detectedDate) {
    return {
      finalDate: detectedDate,
      finalDateText: formatDateOnly(detectedDate),
      selectedDateText: null,
      detectedDateText: formatDateOnly(detectedDate),
      source: "chart-detected-date-fallback",
      reason: "No user-selected date was provided, so the chart-detected latest visible date was used.",
    };
  }
  return { finalDate: null, finalDateText: "Not provided", selectedDateText: null, detectedDateText: null, source: "missing-date", reason: "No usable date was available." };
}

function getCleanBreakTolerance(symbol = "") {
  const compact = comparableInstrument(symbol);
  if (compact.includes("JPY")) return 0.02;
  if (compact.includes("XAU")) return 0.2;
  if (compact.includes("BTC")) return 20;
  return 0.0002;
}

function compareHighWithTolerance(currentHigh, previousHigh, symbol = "") {
  const current = Number(currentHigh), previous = Number(previousHigh), tol = getCleanBreakTolerance(symbol);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { cleanBreak: false, difference: null, tolerance: tol, label: "unavailable" };
  const difference = current - previous;
  if (difference > tol) return { cleanBreak: true, difference, tolerance: tol, label: "clean higher high" };
  if (Math.abs(difference) <= tol) return { cleanBreak: false, difference, tolerance: tol, label: "equal high / retest of previous high" };
  return { cleanBreak: false, difference, tolerance: tol, label: "failed to break previous high" };
}

function compareLowWithTolerance(currentLow, previousLow, symbol = "") {
  const current = Number(currentLow), previous = Number(previousLow), tol = getCleanBreakTolerance(symbol);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { cleanBreak: false, difference: null, tolerance: tol, label: "unavailable" };
  const difference = previous - current;
  if (difference > tol) return { cleanBreak: true, difference, tolerance: tol, label: "clean lower low" };
  if (Math.abs(previous - current) <= tol) return { cleanBreak: false, difference, tolerance: tol, label: "equal low / retest of previous low" };
  return { cleanBreak: false, difference, tolerance: tol, label: "held above previous low" };
}

function getSupportedCsaTimeframeProfile(timeframe = "H1") {
  const tf = comparableTimeframe(timeframe) || "H1";
  if (["M1", "M5", "M15", "M30", "H1"].includes(tf)) return { selectedTimeframe: tf, interval: normalizeTimeframe(tf), structureMode: "daily-in-week", structureLabel: "Daily highs/lows inside the selected Monday-to-Friday week", sourceUnitSingular: "day", sourceUnitPlural: "daily levels", firstPeriodText: "Monday high/low creates the first support and resistance for the week.", startPriceLabel: "Monday open", currentPriceLabel: "latest close for the selected week", rangeKind: "week", breakdownTitle: "Monday-to-Friday CSA Breakdown" };
  if (tf === "H4") return { selectedTimeframe: tf, interval: "4h", structureMode: "weekly-in-month", structureLabel: "Weekly highs/lows inside the selected calendar month", sourceUnitSingular: "week", sourceUnitPlural: "weekly levels", firstPeriodText: "The first available week high/low creates the first support and resistance for the month.", startPriceLabel: "first week open", currentPriceLabel: "latest close for the selected month", rangeKind: "month", breakdownTitle: "Weekly CSA Breakdown For Selected Month" };
  if (tf === "D1") return { selectedTimeframe: tf, interval: "1day", structureMode: "monthly-in-year", structureLabel: "Monthly highs/lows inside the selected calendar year", sourceUnitSingular: "month", sourceUnitPlural: "monthly levels", firstPeriodText: "January high/low, or the first available month high/low, creates the first support and resistance for the year.", startPriceLabel: "first month open", currentPriceLabel: "latest close for the selected year", rangeKind: "year", breakdownTitle: "Monthly CSA Breakdown For Selected Year" };
  if (tf === "W1") return { selectedTimeframe: tf, interval: "1week", structureMode: "quarterly-in-year", structureLabel: "Quarterly highs/lows inside the selected calendar year", sourceUnitSingular: "quarter", sourceUnitPlural: "quarterly levels", firstPeriodText: "Q1 high/low, or the first available quarter high/low, creates the first support and resistance for the year.", startPriceLabel: "first quarter open", currentPriceLabel: "latest close for the selected year", rangeKind: "year", breakdownTitle: "Quarterly CSA Breakdown For Selected Year" };
  if (tf === "MN") return { selectedTimeframe: tf, interval: "1month", structureMode: "yearly-in-multi-year", structureLabel: "Yearly highs/lows across selected year plus previous 4 years", sourceUnitSingular: "year", sourceUnitPlural: "yearly levels", firstPeriodText: "The first available year high/low creates the first support and resistance for the multi-year range.", startPriceLabel: "first year open", currentPriceLabel: "latest close for the selected multi-year range", rangeKind: "multi-year range", breakdownTitle: "Yearly CSA Breakdown For Monthly Chart" };
  return getSupportedCsaTimeframeProfile("H1");
}

function getWeekRangeForDate(chartDate, useFullWeek = false) {
  const day = chartDate.getUTCDay();
  const monday = addDays(chartDate, day === 0 ? -6 : 1 - day);
  const friday = addDays(monday, 4);
  const end = useFullWeek ? friday : chartDate < friday ? chartDate : friday;
  return { start: monday, end, final: friday, startDate: formatDateOnly(monday), endDate: formatDateOnly(end), finalDate: formatDateOnly(friday) };
}

function getMonthRangeForDate(chartDate, useFullMonth = false) {
  const year = chartDate.getUTCFullYear(), month = chartDate.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const final = new Date(Date.UTC(year, month + 1, 0));
  const end = useFullMonth ? final : chartDate < final ? chartDate : final;
  return { start, end, final, startDate: formatDateOnly(start), endDate: formatDateOnly(end), finalDate: formatDateOnly(final) };
}

function getYearRangeForDate(chartDate, useFullYear = false) {
  const year = chartDate.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const final = new Date(Date.UTC(year, 11, 31));
  const end = useFullYear ? final : chartDate < final ? chartDate : final;
  return { start, end, final, startDate: formatDateOnly(start), endDate: formatDateOnly(end), finalDate: formatDateOnly(final) };
}

function getMultiYearRangeForDate(chartDate, yearsBack = 4, useFullFinalYear = false) {
  const year = chartDate.getUTCFullYear();
  const start = new Date(Date.UTC(year - yearsBack, 0, 1));
  const final = new Date(Date.UTC(year, 11, 31));
  const end = useFullFinalYear ? final : chartDate < final ? chartDate : final;
  return { start, end, final, startDate: formatDateOnly(start), endDate: formatDateOnly(end), finalDate: formatDateOnly(final) };
}

function getStructureRangeForProfile(chartDate, profile, analysisType = "post-trade") {
  const useFull = normalizeAnalysisType(analysisType) === "post-trade";
  if (profile.structureMode === "daily-in-week") return getWeekRangeForDate(chartDate, useFull);
  if (profile.structureMode === "weekly-in-month") return getMonthRangeForDate(chartDate, useFull);
  if (["monthly-in-year", "quarterly-in-year"].includes(profile.structureMode)) return getYearRangeForDate(chartDate, useFull);
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
    return { key: `${year}-${String(month + 1).padStart(2, "0")}-W${weekNumber}`, label: `Week ${weekNumber}`, date: formatDateOnly(date) };
  }
  if (profile.structureMode === "monthly-in-year") return { key: `${year}-${String(month + 1).padStart(2, "0")}`, label: getMonthName(month), date: `${year}-${String(month + 1).padStart(2, "0")}-01` };
  if (profile.structureMode === "quarterly-in-year") {
    const q = getQuarterLabel(month);
    return { key: `${year}-${q}`, label: q, date: `${year}-${q}` };
  }
  if (profile.structureMode === "yearly-in-multi-year") return { key: String(year), label: String(year), date: `${year}-01-01` };
  const dateOnly = formatDateOnly(date);
  return { key: dateOnly, label: dateOnly, date: dateOnly };
}

function weekdayNameFromDate(dateString) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${dateString}T00:00:00.000Z`));
}

function getOutputSizeForInterval(interval) {
  const map = { "1min": "5000", "5min": "5000", "15min": "3000", "30min": "2000", "1h": "1000", "4h": "500", "1day": "400", "1week": "300", "1month": "120" };
  return map[interval] || "1000";
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
    const open = safeNumber(bar.open), high = safeNumber(bar.high), low = safeNumber(bar.low), close = safeNumber(bar.close);
    if ([open, high, low, close].some((v) => v === null)) return;
    const period = getPeriodKeyAndLabel(date, profile);
    if (!grouped.has(period.key)) {
      grouped.set(period.key, { key: period.key, date: period.date, day: period.label, periodLabel: period.label, open, high, low, close, candleCount: 1 });
      return;
    }
    const existing = grouped.get(period.key);
    existing.high = Math.max(existing.high, high);
    existing.low = Math.min(existing.low, low);
    existing.close = close;
    existing.candleCount += 1;
  });
  return Array.from(grouped.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function buildCsaAreas(levels = [], symbol = "", profile = getSupportedCsaTimeframeProfile("H1")) {
  const areas = [];
  levels.forEach((period, index) => {
    const label = period.periodLabel || period.day || period.key;
    if (index === 0) {
      areas.push({ day: label, period: label, date: period.date, type: "resistance", price: period.high, priceText: formatPrice(period.high) });
      areas.push({ day: label, period: label, date: period.date, type: "support", price: period.low, priceText: formatPrice(period.low) });
      return;
    }
    const previous = levels[index - 1];
    const highComparison = compareHighWithTolerance(period.high, previous.high, symbol);
    const lowComparison = compareLowWithTolerance(period.low, previous.low, symbol);
    areas.push({ day: label, period: label, date: period.date, type: highComparison.cleanBreak ? "resistance" : "supply", price: period.high, priceText: formatPrice(period.high), comparison: highComparison });
    areas.push({ day: label, period: label, date: period.date, type: lowComparison.cleanBreak ? "support" : "demand", price: period.low, priceText: formatPrice(period.low), comparison: lowComparison });
  });
  return areas;
}

function calculateCsaDirectionalBias(levels = [], symbol = "", profile = getSupportedCsaTimeframeProfile("H1")) {
  if (!Array.isArray(levels) || levels.length < 2) return { bias: "Insufficient data", biasCode: "insufficient", confidence: "low", reason: `At least two ${profile.sourceUnitPlural} are needed.` };
  const first = levels[0], last = levels[levels.length - 1];
  let highBreakCount = 0, lowBreakCount = 0, risingCloses = 0, fallingCloses = 0;
  for (let i = 1; i < levels.length; i += 1) {
    if (compareHighWithTolerance(levels[i].high, levels[i - 1].high, symbol).cleanBreak) highBreakCount += 1;
    if (compareLowWithTolerance(levels[i].low, levels[i - 1].low, symbol).cleanBreak) lowBreakCount += 1;
    if (levels[i].close > levels[i - 1].close) risingCloses += 1;
    if (levels[i].close < levels[i - 1].close) fallingCloses += 1;
  }
  let bias = "Mixed / Range-bound", biasCode = "mixed";
  if (last.close > first.open && highBreakCount >= lowBreakCount) { bias = "Bullish"; biasCode = "bullish"; }
  if (last.close < first.open && lowBreakCount >= highBreakCount) { bias = "Bearish"; biasCode = "bearish"; }
  return {
    bias, biasCode,
    confidence: Math.abs(highBreakCount - lowBreakCount) >= 2 ? "high" : "medium",
    periodStartPrice: first.open,
    presentPrice: last.close,
    periodHigh: Math.max(...levels.map((item) => Number(item.high))),
    periodLow: Math.min(...levels.map((item) => Number(item.low))),
    priceMove: last.close - first.open,
    resistanceCount: highBreakCount,
    supportCount: lowBreakCount,
    risingCloses,
    fallingCloses,
    highBreakCount,
    lowBreakCount,
    reason: `${bias} bias based on ${profile.structureLabel}.`,
  };
}

async function fetchTwelveDataStructureLevels({ symbol, chartDate, timeframe = "H1", timezone = "UTC", analysisType = "post-trade" }) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const profile = getSupportedCsaTimeframeProfile(timeframe);
  const empty = (error, range = null) => ({ ok: false, error, dailyLevels: [], csaAreas: [], directionalBias: calculateCsaDirectionalBias([], symbol, profile), rawCandleCount: 0, weekRange: range, symbol, timezone, interval: profile.interval, profile });
  if (!apiKey) return empty("TWELVE_DATA_API_KEY is missing on the server.");
  if (!symbol) return empty("Instrument/pair is missing or unsupported.");
  if (!chartDate) return empty("Final visible chart date is missing.");
  const structureRange = getStructureRangeForProfile(chartDate, profile, analysisType);
  const params = new URLSearchParams({ symbol, interval: profile.interval, start_date: `${structureRange.startDate} 00:00:00`, end_date: `${structureRange.endDate} 23:59:59`, timezone, order: "ASC", outputsize: getOutputSizeForInterval(profile.interval), apikey: apiKey });
  const response = await fetch(`${TWELVE_DATA_BASE_URL}?${params.toString()}`);
  const data = await response.json();
  if (!response.ok || data.status === "error" || !Array.isArray(data.values)) return { ...empty(data.message || data.error || `Twelve Data request failed with status ${response.status}.`, structureRange), twelveDataStatus: data.status || "unknown" };
  const rawCandles = data.values || [];
  const dailyLevels = buildStructureLevelsFromCandles(rawCandles, structureRange, profile);
  const csaAreas = buildCsaAreas(dailyLevels, symbol, profile);
  const directionalBias = calculateCsaDirectionalBias(dailyLevels, symbol, profile);
  return { ok: dailyLevels.length > 0, error: dailyLevels.length > 0 ? "" : `No usable ${profile.sourceUnitPlural} were returned.`, dailyLevels, csaAreas, directionalBias, rawCandleCount: rawCandles.length, weekRange: structureRange, symbol, timezone, interval: profile.interval, profile };
}

function latestArea(areaList = []) {
  if (!Array.isArray(areaList) || !areaList.length) return null;
  return [...areaList].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || Number(b.price || 0) - Number(a.price || 0))[0];
}

function areaBrokenByCloseLater(area, levels = [], symbol = "") {
  if (!area || !Array.isArray(levels)) return false;
  const level = Number(area.price), tol = getCleanBreakTolerance(symbol);
  if (!Number.isFinite(level)) return false;
  const laterPeriods = levels.filter((item) => String(item.date || "") > String(area.date || ""));
  if (area.type === "supply" || area.type === "resistance") return laterPeriods.some((item) => Number(item.close) > level + tol);
  if (area.type === "demand" || area.type === "support") return laterPeriods.some((item) => Number(item.close) < level - tol);
  return false;
}

function filterValidAreas(areaList = [], levels = [], symbol = "") { return areaList.filter((area) => !areaBrokenByCloseLater(area, levels, symbol)); }
function filterBrokenAreas(areaList = [], levels = [], symbol = "") { return areaList.filter((area) => areaBrokenByCloseLater(area, levels, symbol)); }
function splitAreas(areas = []) { return { resistanceAreas: areas.filter((area) => area.type === "resistance"), supportAreas: areas.filter((area) => area.type === "support"), supplyAreas: areas.filter((area) => area.type === "supply"), demandAreas: areas.filter((area) => area.type === "demand") }; }
function areaLabel(area) { const period = area?.day || area?.period || area?.date || "Unknown period"; return `${period} ${area?.type || "area"} around ${area?.priceText || formatPrice(Number(area?.price))}`; }

function describeFailedArea(area) {
  const label = areaLabel(area);
  if (area.type === "support") return `${label} failed because price later closed below it.`;
  if (area.type === "demand") return `${label} failed because price later closed below demand.`;
  if (area.type === "resistance") return `${label} failed because price later closed above it.`;
  if (area.type === "supply") return `${label} failed because price later closed above supply.`;
  return `${label} failed because price closed through it.`;
}

function buildFailedAreas({ supportAreas = [], resistanceAreas = [], supplyAreas = [], demandAreas = [], levels = [], symbol = "" }) {
  const mapArea = (area, failedType, mistakeLabel, newRole) => ({ ...area, failedType, mistakeLabel, newRole, explanation: describeFailedArea(area) });
  return [
    ...filterBrokenAreas(supportAreas, levels, symbol).map((area) => mapArea(area, "failed_support", "Failed support area", "Can become resistance if retested from below")),
    ...filterBrokenAreas(demandAreas, levels, symbol).map((area) => mapArea(area, "failed_demand", "Failed demand area", "Invalid as demand until reclaimed")),
    ...filterBrokenAreas(resistanceAreas, levels, symbol).map((area) => mapArea(area, "failed_resistance", "Failed resistance area", "Can become support if retested from above")),
    ...filterBrokenAreas(supplyAreas, levels, symbol).map((area) => mapArea(area, "failed_supply", "Failed supply area", "Invalid as supply until price loses it again")),
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.failedType || "").localeCompare(String(b.failedType || "")));
}

function listAreas(areaList = [], label = "area", max = 3) {
  if (!Array.isArray(areaList) || !areaList.length) return "- None identified.";
  return [...areaList].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, max).map((area) => `- ${area.day} ${label}: ${area.priceText}`).join("\n");
}

function listFailedAreas(failedAreas = [], max = 6) {
  if (!Array.isArray(failedAreas) || !failedAreas.length) return "- None detected.";
  return failedAreas.slice(0, max).map((area) => `- ${area.mistakeLabel}: ${area.explanation}`).join("\n");
}

function makeSimpleMistake(title, severity = "REVIEW") {
  return { title, severity, tag: severity, detail: title, correction: title };
}

function simpleFailedAreaTitle(area) {
  const type = String(area?.type || "area").toLowerCase();
  if (type === "support") return "Failed support area";
  if (type === "demand") return "Failed demand area";
  if (type === "resistance") return "Failed resistance area";
  if (type === "supply") return "Failed supply area";
  return "Failed CSA area";
}

function buildSimpleMistakeHub({ failedAreas = [], hasConfirmedTrigger = false, rejectedContext = null, mixedBias = false, marketOk = true, chartDetection = null, setupScore = 0, entryAccuracyScore = 0, riskManagementScore = 0 }) {
  const items = [];
  const add = (title, severity) => {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) return;
    if (items.some((item) => String(item.title).toLowerCase() === cleanTitle.toLowerCase())) return;
    items.push(makeSimpleMistake(cleanTitle, severity));
  };

  if (!marketOk) add("Market data unavailable", "DATA ISSUE");
  if (chartDetection?.isTradingChart && chartDetection?.hasUsablePriceData === false) add("Chart data unclear", "REVIEW");
  if (!hasConfirmedTrigger) add("Failed to wait for confirmation", "DISCIPLINE");
  if (rejectedContext && !hasConfirmedTrigger) add("Entered too early", "HIGH RISK");
  if (mixedBias) add("Entered in unclear structure", "STRUCTURAL");
  failedAreas.slice(0, 4).forEach((area) => add(simpleFailedAreaTitle(area), "STRUCTURAL"));
  if (Number(setupScore) > 0 && Number(setupScore) < 6) add("Low-quality setup", "WARNING");
  if (Number(entryAccuracyScore) > 0 && Number(entryAccuracyScore) < 50) add("Entry accuracy weak", "WARNING");
  if (Number(riskManagementScore) > 0 && Number(riskManagementScore) < 55) add("Risk-to-reward below plan", "MATH FLAW");
  if (!items.length) add("No major mistake detected", "REVIEW");
  return items.slice(0, 5);
}

function clampScore(value, min = 0, max = 100) { const num = Number(value); return Number.isFinite(num) ? Math.max(min, Math.min(max, Math.round(num))) : min; }
function scoreLabel(score) { if (score >= 85) return "Excellent"; if (score >= 75) return "Good"; if (score >= 60) return "Fair"; if (score >= 40) return "Weak"; return "Poor"; }

function getCurrentPeriodDate(levels = []) { if (!Array.isArray(levels) || !levels.length) return null; return levels[levels.length - 1]?.date || null; }
function filterPreviousPeriodAreas(areaList = [], levels = []) { const currentDate = getCurrentPeriodDate(levels); if (!currentDate) return areaList; return areaList.filter((area) => String(area.date || "") < String(currentDate)); }
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
  if (!sortedTargets.length) return `No valid previous-${profile.sourceUnitSingular} target is available. Skip if no clear target exists.`;
  const lines = [];
  if (sortedTargets[0]) lines.push(`First TP: ${sortedTargets[0].day} ${sortedTargets[0].type} around ${sortedTargets[0].priceText}.`);
  if (sortedTargets[1]) lines.push(`Second TP: ${sortedTargets[1].day} ${sortedTargets[1].type} around ${sortedTargets[1].priceText}.`);
  return lines.join(" ");
}

function buildEntryTriggerText({ direction = "", chartDetection = null }) {
  const trigger = sanitizeVisibleTrigger(chartDetection?.visibleTrigger, chartDetection?.triggerConfidence);
  const triggerDirection = String(chartDetection?.triggerDirection || "").toLowerCase();
  const triggerConfidence = String(chartDetection?.triggerConfidence || "").toLowerCase();
  if (trigger && triggerConfidence !== "low" && (triggerDirection === direction || triggerDirection === "neutral")) return `Visible confirmed trigger on chart: ${trigger}.`;
  return "No confirmed entry trigger is visible yet. Do not treat bounce, pullback, or consolidation as confirmation.";
}

function buildBrokenSupportText(area) { return `${area.day} support now turned resistance around ${area.priceText}.`; }
function buildBrokenResistanceText(area) { return `${area.day} resistance now turned support around ${area.priceText}.`; }

function buildDirectionalProgressionText({ bias, brokenSupportAreas, brokenResistanceAreas }) {
  const biasValue = String(bias?.bias || "").toLowerCase();
  if (biasValue.includes("bearish")) return `${bias.reason} ${brokenSupportAreas.length ? `Broken support areas: ${brokenSupportAreas.map(buildBrokenSupportText).join(" ")}` : "No previous support has clearly broken yet."}`;
  if (biasValue.includes("bullish")) return `${bias.reason} ${brokenResistanceAreas.length ? `Broken resistance areas: ${brokenResistanceAreas.map(buildBrokenResistanceText).join(" ")}` : "No previous resistance has clearly broken yet."}`;
  return bias.reason || "Bias is mixed.";
}

function buildTradeCoachingSummary({ resistanceAreas, supportAreas, supplyAreas, demandAreas, levels, bias, symbol, chartDetection, profile }) {
  const biasValue = String(bias?.bias || "").toLowerCase();
  const validSupplyAreas = filterValidAreas(supplyAreas, levels, symbol);
  const validDemandAreas = filterValidAreas(demandAreas, levels, symbol);
  const brokenSupportAreas = filterBrokenAreas(supportAreas, levels, symbol);
  const brokenResistanceAreas = filterBrokenAreas(resistanceAreas, levels, symbol);
  const failedAreas = buildFailedAreas({ supportAreas, resistanceAreas, supplyAreas, demandAreas, levels, symbol });

  let direction = "Mixed / Wait";
  let bestEntryArea = "No clean entry area yet. Wait for price to reach a valid CSA area.";
  let score = failedAreas.length ? 4 : 5;

  if (biasValue.includes("bullish")) {
    direction = "Bullish";
    const entryRef = latestArea(brokenResistanceAreas) || latestArea(validDemandAreas) || latestArea(supportAreas);
    bestEntryArea = entryRef ? `${entryRef.day} ${entryRef.type} around ${entryRef.priceText}.` : "No clean bullish entry area confirmed yet.";
    score = bias.confidence === "high" ? 8 : 7;
    if (failedAreas.length) score = Math.max(4, score - 2);
  } else if (biasValue.includes("bearish")) {
    direction = "Bearish";
    const entryRef = latestArea(brokenSupportAreas) || latestArea(validSupplyAreas) || latestArea(resistanceAreas);
    bestEntryArea = entryRef ? `${entryRef.day} ${entryRef.type} around ${entryRef.priceText}.` : "No clean bearish entry area confirmed yet.";
    score = bias.confidence === "high" ? 8 : 7;
    if (failedAreas.length) score = Math.max(4, score - 2);
  }

  return {
    direction,
    directionReason: buildDirectionalProgressionText({ bias, brokenSupportAreas, brokenResistanceAreas }),
    bestEntryArea,
    entryTrigger: buildEntryTriggerText({ direction: direction.toLowerCase(), chartDetection }),
    stopLoss: "Place stop loss beyond the trigger candle/pattern and beyond the CSA area.",
    takeProfit: buildTargetsText([...supportAreas, ...demandAreas, ...resistanceAreas, ...supplyAreas], direction.toLowerCase(), null, levels, profile),
    riskReward: "Minimum risk-to-reward should be 1:2. Skip the setup if TP1 is too close.",
    tradeManagement: "Partial close at TP1, breakeven after strong reaction, trail behind structure.",
    verdict: failedAreas.length ? "Failed CSA area detected. Reclassify it before considering another setup." : "Review completed. Wait for confirmation before entry.",
    score,
    brokenSupportAreas,
    brokenResistanceAreas,
    validSupplyAreas,
    validDemandAreas,
    failedAreas,
  };
}

function buildSimpleStructureBreakdown(levels = [], normalizedSymbol = "", profile = getSupportedCsaTimeframeProfile("H1")) {
  if (!levels.length) return "- No structure data available.";
  return levels.map((period, index) => {
    const label = period.periodLabel || period.day || period.key;
    if (index === 0) return `${label}:\n- High ${formatPrice(period.high)} = first resistance.\n- Low ${formatPrice(period.low)} = first support.`;
    const previous = levels[index - 1];
    const highComparison = compareHighWithTolerance(period.high, previous.high, normalizedSymbol);
    const lowComparison = compareLowWithTolerance(period.low, previous.low, normalizedSymbol);
    return `${label}:\n- ${highComparison.cleanBreak ? "High broke previous high = resistance." : "High failed to break previous high = supply."}\n- ${lowComparison.cleanBreak ? "Low broke previous low = support." : "Low held/retested previous low = demand."}`;
  }).join("\n\n");
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
  if (marketOk) {
    strengths.push(`CSA structure used correctly: ${profile.structureLabel}.`);
    strengths.push(`Market data was available and ${levels.length} ${profile.sourceUnitPlural} were reviewed.`);
    strengths.push(`Directional bias was calculated as ${bias.bias}.`);
  } else {
    weaknesses.push(marketReference?.error || "Market data unavailable.");
  }
  if (chartDetection?.hasUsablePriceData) strengths.push("Uploaded chart contains usable visible price data.");
  if (!hasConfirmedTrigger) weaknesses.push("No confirmed entry trigger was visible on the uploaded chart.");
  failedAreas.forEach((area) => weaknesses.push(area.explanation));
  if (mixedBias) weaknesses.push("Directional bias is mixed; avoid middle-of-range entries.");

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

  const aiMistakeDetectionHub = buildSimpleMistakeHub({
    failedAreas,
    hasConfirmedTrigger,
    rejectedContext,
    mixedBias,
    marketOk,
    chartDetection,
    setupScore,
    entryAccuracyScore,
    riskManagementScore,
  });

  return {
    strengths: strengths.length ? strengths.slice(0, 7) : ["CSA Coach completed the review."],
    weaknesses: weaknesses.length ? weaknesses.slice(0, 7) : ["No major weakness detected from the available CSA structure data."],
    mistakes: aiMistakeDetectionHub,
    aiMistakeDetectionHub,
    mistakeDetectionHub: aiMistakeDetectionHub,
    mistakeHub: aiMistakeDetectionHub,
    failedAreas,
    contextCheck,
    chartContextCheck: contextCheck,
    setupQuality: { score: setupQualityScore, label: scoreLabel(setupQualityScore), summary: "Setup quality is based on CSA structure, failed areas, and confirmation." },
    setupQualityScore,
    entryAccuracy: { score: entryAccuracyScore, label: scoreLabel(entryAccuracyScore), summary: "Entry accuracy depends on visible confirmation at the CSA area." },
    entryAccuracyScore,
    riskManagement: { score: riskManagementScore, label: scoreLabel(riskManagementScore), summary: "Risk score checks stop logic and failed area risk." },
    riskManagementScore,
    scores: { setupQuality: setupQualityScore, entryAccuracy: entryAccuracyScore, riskManagement: riskManagementScore },
    dashboard: {},
    dashboardCards: {},
  };
}

function buildDashboardAliases(dashboardFeedback = {}) {
  const contextCheck = dashboardFeedback.contextCheck || dashboardFeedback.chartContextCheck || {};
  const setupQuality = dashboardFeedback.setupQuality || { score: 0, label: "Unavailable", summary: "Setup quality was not calculated." };
  const entryAccuracy = dashboardFeedback.entryAccuracy || { score: 0, label: "Unavailable", summary: "Entry accuracy was not calculated." };
  const riskManagement = dashboardFeedback.riskManagement || { score: 0, label: "Unavailable", summary: "Risk management was not calculated." };
  const strengths = Array.isArray(dashboardFeedback.strengths) && dashboardFeedback.strengths.length ? dashboardFeedback.strengths : ["CSA Coach completed the review."];
  const weaknesses = Array.isArray(dashboardFeedback.weaknesses) && dashboardFeedback.weaknesses.length ? dashboardFeedback.weaknesses : ["No major weakness detected."];
  const aiMistakeDetectionHub = Array.isArray(dashboardFeedback.aiMistakeDetectionHub) && dashboardFeedback.aiMistakeDetectionHub.length ? dashboardFeedback.aiMistakeDetectionHub : [makeSimpleMistake("No major mistake detected", "REVIEW")];
  const failedAreas = Array.isArray(dashboardFeedback.failedAreas) ? dashboardFeedback.failedAreas : [];

  return {
    strengths,
    weaknesses,
    chartContextCheck: contextCheck,
    contextCheck,
    chartContext: contextCheck,
    chartContextStatus: contextCheck.status || "Not available",
    selectedContext: { instrument: contextCheck.selectedInstrument || "Not provided", timeframe: contextCheck.selectedTimeframe || "Not provided", date: contextCheck.selectedDate || "Not provided" },
    detectedContext: { instrument: contextCheck.detectedInstrument || "Not detected", timeframe: contextCheck.detectedTimeframe || "Not detected", latestVisibleDate: contextCheck.detectedLatestVisibleDate || "Not detected" },
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

function buildDeterministicCsaAnalysis({ marketReference, dateDecision, chartDetection, submittedInstrument, normalizedSymbol, timeframe }) {
  const profile = marketReference?.profile || getSupportedCsaTimeframeProfile(timeframe);
  if (!marketReference || !marketReference.ok) {
    return `CSA COACH VERDICT\n\nDirectional Bias:\n- Insufficient data\n- Reason: ${marketReference?.error || "Market data unavailable."}\n\nOverall Setup Score:\n- 0/10`;
  }
  const levels = marketReference.dailyLevels || [];
  const areas = marketReference.csaAreas || [];
  const bias = marketReference.directionalBias || calculateCsaDirectionalBias(levels, normalizedSymbol, profile);
  const { resistanceAreas, supportAreas, supplyAreas, demandAreas } = splitAreas(areas);
  const validSupplyAreas = filterValidAreas(supplyAreas, levels, normalizedSymbol);
  const validDemandAreas = filterValidAreas(demandAreas, levels, normalizedSymbol);
  const brokenSupplyAreas = filterBrokenAreas(supplyAreas, levels, normalizedSymbol);
  const brokenDemandAreas = filterBrokenAreas(demandAreas, levels, normalizedSymbol);
  const brokenSupportAreas = filterBrokenAreas(supportAreas, levels, normalizedSymbol);
  const brokenResistanceAreas = filterBrokenAreas(resistanceAreas, levels, normalizedSymbol);
  const failedAreas = buildFailedAreas({ supportAreas, resistanceAreas, supplyAreas, demandAreas, levels, symbol: normalizedSymbol });
  const tradeCoach = buildTradeCoachingSummary({ resistanceAreas, supportAreas, supplyAreas, demandAreas, levels, bias, symbol: normalizedSymbol, chartDetection, profile });

  return `CSA COACH VERDICT\n\nCSA Structure Used:\n- ${profile.structureLabel}\n\nDirectional Bias:\n- ${tradeCoach.direction}\n- Reason: ${tradeCoach.directionReason}\n\nBest Entry Area:\n- ${tradeCoach.bestEntryArea}\n\nEntry Trigger:\n- ${tradeCoach.entryTrigger}\n\nStop Loss Placement:\n- ${tradeCoach.stopLoss}\n\nTake Profit Placement:\n- ${tradeCoach.takeProfit}\n\nRisk-to-Reward:\n- ${tradeCoach.riskReward}\n\nTrade Management:\n- ${tradeCoach.tradeManagement}\n\nCoach Verdict:\n- ${tradeCoach.verdict}\n- These are coaching guidelines only, not buy/sell signals.\n\nOverall Setup Score:\n- ${tradeCoach.score}/10\n\nREAD_MORE_DETAILS:\n\nFinal date used: ${dateDecision?.finalDateText || "Not provided"}\nSelected instrument: ${submittedInstrument}\nSelected timeframe: ${timeframe}\nLatest visible chart date: ${chartDetection?.latestVisibleDate || "Not detected"}\nChart data quality: ${chartDetection?.chartDataQuality || "unclear"}\n\nCSA Bias Calculation:\n- ${profile.startPriceLabel}: ${formatPrice(bias.periodStartPrice)}\n- ${profile.currentPriceLabel}: ${formatPrice(bias.presentPrice)}\n- Highest price: ${formatPrice(bias.periodHigh)}\n- Lowest price: ${formatPrice(bias.periodLow)}\n- Bias confidence: ${bias.confidence}\n\nResistance:\n${listAreas(resistanceAreas, "resistance")}\n\nSupport:\n${listAreas(supportAreas, "support")}\n\nBroken Support Now Resistance:\n${listAreas(brokenSupportAreas, "broken support/resistance")}\n\nBroken Resistance Now Support:\n${listAreas(brokenResistanceAreas, "broken resistance/support")}\n\nValid Supply:\n${listAreas(validSupplyAreas, "supply")}\n\nValid Demand:\n${listAreas(validDemandAreas, "demand")}\n\nBroken Supply:\n${listAreas(brokenSupplyAreas, "supply")}\n\nBroken Demand:\n${listAreas(brokenDemandAreas, "demand")}\n\nFailed CSA Areas:\n${listFailedAreas(failedAreas)}\n\n${profile.breakdownTitle}:\n${buildSimpleStructureBreakdown(levels, normalizedSymbol, profile)}`;
}

function buildInvalidChartAnalysis({ submittedInstrument, timeframe, chartDetection }) {
  return `Invalid Chart Upload\n\nSelected:\n- Instrument: ${submittedInstrument || "Not provided"}\n- Timeframe: ${timeframe || "Not provided"}\n\nReason: ${chartDetection?.chartValidityReason || "The uploaded image could not be verified as a trading chart."}`;
}

function buildInsufficientChartDataAnalysis({ submittedInstrument, timeframe, selectedDateText, chartDetection }) {
  return `Insufficient Chart Data\n\nThe uploaded image appears to be a trading chart, but it does not show enough usable visible price data for CSA Coach to review the setup.\n\nSelected:\n- Instrument: ${submittedInstrument || "Not provided"}\n- Timeframe: ${timeframe || "Not provided"}\n- Selected chart/trade date: ${selectedDateText || "Not provided"}\n\nAI image check:\n- Chart data quality: ${chartDetection?.chartDataQuality || "unclear"}\n- Visible candle count: ${chartDetection?.visibleCandleCount ?? "Not detected"}\n- Selected date visible/covered: ${chartDetection?.selectedDateVisible === true ? "Yes" : "No / not confirmed"}\n- Reason: ${chartDetection?.insufficientDataReason || "The chart does not show enough usable price movement."}\n\nHow to fix:\n- Upload a clearer chart screenshot where candles and the selected date are visible.`;
}

function buildDateMismatchAnalysis({ submittedInstrument, timeframe, selectedDateText, chartDetection, dateMismatch }) {
  return `Selected Date Not Visible On Chart\n\nSelected date: ${selectedDateText || "Not provided"}\nLatest visible chart date: ${dateMismatch?.latestVisibleDateText || chartDetection?.latestVisibleDate || "Not detected"}\nReason: ${dateMismatch?.reason || "Selected date was not confirmed on the uploaded chart."}\n\nUpload a chart where the selected chart/trade date is visible, or change the selected date.`;
}

function buildInstrumentMismatchAnalysis({ selectedInstrument, detectedInstrument, selectedTimeframe, detectedTimeframe }) {
  return `Chart Context Mismatch\n\nSelected Instrument:\n${selectedInstrument || "Not provided"}\n\nDetected Chart Instrument:\n${detectedInstrument || "Not detected"}\n\nSelected Timeframe:\n${selectedTimeframe || "Not provided"}\n\nDetected Chart Timeframe:\n${detectedTimeframe || "Not detected"}`;
}

function buildTimeframeMismatchAnalysis({ selectedInstrument, detectedInstrument, selectedTimeframe, detectedTimeframe }) {
  return `Chart Timeframe Mismatch\n\nSelected Instrument:\n${selectedInstrument || "Not provided"}\n\nDetected Chart Instrument:\n${detectedInstrument || "Not detected"}\n\nSelected Timeframe:\n${selectedTimeframe || "Not provided"}\n\nDetected Chart Timeframe:\n${detectedTimeframe || "Not detected"}`;
}

function buildStoppedDashboard({ errorType, error, submittedInstrument, timeframe, chartDetection, selectedTimeframeProfile }) {
  return buildDashboardAliases({
    strengths: ["Chart context validation was completed before the review was stopped.", `CSA structure expected: ${selectedTimeframeProfile?.structureLabel || "Not available"}.`],
    weaknesses: [error, chartDetection?.insufficientDataReason || chartDetection?.chartValidityReason || "Analysis stopped."],
    contextCheck: {
      selectedInstrument: submittedInstrument || "Not provided",
      selectedTimeframe: timeframe || "Not provided",
      detectedInstrument: chartDetection?.detectedInstrument || "Not detected",
      detectedTimeframe: chartDetection?.detectedTimeframe || "Not detected",
      detectedLatestVisibleDate: chartDetection?.latestVisibleDate || "Not detected",
      status: "Analysis stopped",
      structureUsed: selectedTimeframeProfile?.structureLabel || "Not available",
      chartValidation: chartDetection?.isTradingChart ? "Valid trading chart" : "Invalid or unverified chart",
      chartDataQuality: chartDetection?.chartDataQuality || "unclear",
      visibleCandleCount: chartDetection?.visibleCandleCount || 0,
    },
    setupQuality: { score: 0, label: "Stopped", summary: error },
    entryAccuracy: { score: 0, label: "Stopped", summary: error },
    riskManagement: { score: 0, label: "Stopped", summary: error },
    aiMistakeDetectionHub: [makeSimpleMistake(errorType, "HIGH RISK")],
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
    marketReference: { ok: false, error, symbol: normalizedSymbol, timezone, interval: normalizeTimeframe(timeframe), rawCandleCount: 0, weekRange: null, dailyLevels: [], csaAreas: [], directionalBias: calculateCsaDirectionalBias([], normalizedSymbol, selectedTimeframeProfile), profile: selectedTimeframeProfile },
  });
}

app.get("/", (req, res) => res.json({ status: "ok", message: "CSA Coach backend is running" }));
app.get("/health", (req, res) => res.json({ ok: true, service: "csa-coach-backend", time: new Date().toISOString() }));

app.get("/test-twelve", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol || "GBP/USD");
    const timeframe = req.query.timeframe || "H1";
    const date = req.query.date || "2026-07-15";
    const timezone = req.query.timezone || "UTC";
    const analysisType = normalizeAnalysisType(req.query.analysisType || "post-trade");
    const chartDate = parseISODateOnly(date);
    if (!chartDate) return res.status(400).json({ ok: false, error: "Invalid date. Use YYYY-MM-DD format." });
    const result = await fetchTwelveDataStructureLevels({ symbol, chartDate, timeframe, timezone, analysisType });
    return res.json(result);
  } catch (error) {
    console.error("test-twelve error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/analyze-chart", upload.single("chart"), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: "OPENAI_API_KEY is missing on the server." });
    if (!req.file) return res.status(400).json({ success: false, error: "No chart image uploaded." });

    const { timeframe = "Not provided", instrument = "", pair = "", selectedPair = "", analysisType = "post-trade", notes = "", userNotes = "", chartDate = "", tradeDate = "", timezone = "UTC" } = req.body;

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

    const dateMismatch = getSelectedDateMismatch(chartDetection, selectedDate, timeframe);
    if (dateMismatch.hasMismatch) {
      const analysis = buildDateMismatchAnalysis({ submittedInstrument, timeframe, selectedDateText: chartDate || tradeDate || "", chartDetection, dateMismatch });
      return stoppedResponse({ res, errorType: "selected_date_not_visible", error: "Selected chart/trade date is not visible or reasonably covered by the uploaded chart.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
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
      contextStatus: marketReference.ok ? `Market-data-backed CSA setup review completed using ${structureLabel}.` : `Setup review completed without market data: ${marketReference.error}`,
      grade: setupScore >= 8 ? "A" : setupScore >= 7 ? "B" : setupScore >= 6 ? "C" : setupScore >= 4 ? "D" : "F",
      confidence: setupScore * 10,
      structureScore: dashboardFeedback.scores.setupQuality,
      executionScore: dashboardFeedback.scores.entryAccuracy,
      riskScore: dashboardFeedback.scores.riskManagement,
      ...dashboardAliases,
      coachAdvice: [analysis],
      journalTags: ["setup review", "directional bias", "entry area", "entry trigger", "stop placement", "take profit placement", "risk reward", "trade management", marketReference.profile?.selectedTimeframe || selectedTimeframeProfile.selectedTimeframe, marketReference.profile?.structureMode || selectedTimeframeProfile.structureMode, marketReference.ok ? "market-data-backed" : "vision-only fallback", bias.biasCode || "bias-unavailable"],
      chartDetection,
      marketReference: { ok: marketReference.ok, error: marketReference.error, symbol: marketReference.symbol, timezone: marketReference.timezone, interval: marketReference.interval, rawCandleCount: marketReference.rawCandleCount, weekRange: marketReference.weekRange, dailyLevels: marketReference.dailyLevels, csaAreas: marketReference.csaAreas, directionalBias: marketReference.directionalBias, profile: marketReference.profile, structureMode: marketReference.profile?.structureMode, structureLabel: marketReference.profile?.structureLabel, cleanBreakTolerance: getCleanBreakTolerance(normalizedSymbol) },
    });
  } catch (error) {
    console.error("CSA Coach analyze error:", error);
    return res.status(500).json({ success: false, error: "Something went wrong while analyzing the chart.", details: error.message });
  }
});

process.on("uncaughtException", (error) => console.error("Uncaught exception:", error));
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`CSA Coach backend running on port ${PORT}`));
