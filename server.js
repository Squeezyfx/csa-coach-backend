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

Invalid/insufficient images:
- photos, logos, documents, rooms, screenshots with no financial chart
- blank charts, loading charts, charts where no candle/line movement is visible
- charts with fewer than about 15 visible candles/bars/points

Important:
- Be practical. If a chart clearly has visible price movement, do not mark it insufficient just because the exact selected date is hard to read.
- If the selected date is clearly far after the latest visible chart date, set selectedDateVisible=false and provide latestVisibleDate.
- If the date axis is hard to read, set dateConfidence="low" instead of blocking the chart.
- Only mark hasUsablePriceData=false when the chart is truly blank/unclear/cropped/loading or has almost no price movement.
- Do not comment on strategies such as trendlines, channels, indicators, Fibonacci, or moving averages in this step. This step only validates the chart and detects basic context.

Entry trigger rule:
Only return visibleTrigger if there is real confirmation such as engulfing, pin bar, hammer, doji rejection, inside bar break, lower high/higher low, breakout/breakdown, retest-and-hold, or clean break-and-hold.
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

function formatDateOnly(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
function safeNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function candleDateOnly(datetimeValue = "") { return String(datetimeValue).slice(0, 10); }

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 100) return n.toFixed(3);
  if (Math.abs(n) >= 10) return n.toFixed(4);
  return n.toFixed(5);
}

function stripCodeFence(text = "") {
  return String(text).replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
}

function extractJsonObject(text = "") {
  const cleaned = stripCodeFence(text);
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
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

function makeSimpleMistake(title, severity = "REVIEW") {
  const cleanTitle = String(title || "").trim() || "Review setup";
  const cleanSeverity = String(severity || "REVIEW").trim().toUpperCase();
  return { title: cleanTitle, severity: cleanSeverity, tag: cleanSeverity, label: cleanSeverity, detail: "", correction: "", summary: "" };
}

function normalizeArrayOfStrings(value = [], fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => {
    if (typeof item === "string") return item.trim();
    if (item && typeof item === "object") return String(item.title || item.summary || item.detail || "").trim();
    return "";
  }).filter(Boolean);
}

function normalizeVisualMistakeItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (typeof item === "string") return makeSimpleMistake(item, "REVIEW");
    return makeSimpleMistake(item?.title || item?.mistake || item?.name || "", item?.tag || item?.severity || item?.label || "REVIEW");
  }).filter((item) => item.title && item.title !== "Review setup").slice(0, 5);
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

function getCleanBreakTolerance(symbol = "") {
  const compact = comparableInstrument(symbol);
  if (compact.includes("JPY")) return 0.02;
  if (compact.includes("XAU")) return 0.2;
  if (compact.includes("BTC")) return 20;
  return 0.0002;
}

function compareHighWithTolerance(currentHigh, previousHigh, symbol = "") {
  const current = Number(currentHigh), previous = Number(previousHigh), tolerance = getCleanBreakTolerance(symbol);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { cleanBreak: false, difference: null, tolerance, label: "unavailable" };
  const difference = current - previous;
  if (difference > tolerance) return { cleanBreak: true, difference, tolerance, label: "clean higher high" };
  if (Math.abs(difference) <= tolerance) return { cleanBreak: false, difference, tolerance, label: "equal high / retest of previous high" };
  return { cleanBreak: false, difference, tolerance, label: "failed to break previous high" };
}

function compareLowWithTolerance(currentLow, previousLow, symbol = "") {
  const current = Number(currentLow), previous = Number(previousLow), tolerance = getCleanBreakTolerance(symbol);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { cleanBreak: false, difference: null, tolerance, label: "unavailable" };
  const difference = previous - current;
  if (difference > tolerance) return { cleanBreak: true, difference, tolerance, label: "clean lower low" };
  if (Math.abs(previous - current) <= tolerance) return { cleanBreak: false, difference, tolerance, label: "equal low / retest of previous low" };
  return { cleanBreak: false, difference, tolerance, label: "held above previous low" };
}

function getSupportedCsaTimeframeProfile(timeframe = "H1") {
  const tf = comparableTimeframe(timeframe) || "H1";
  if (["M1", "M5", "M15", "M30", "H1"].includes(tf)) {
    return { selectedTimeframe: tf, interval: normalizeTimeframe(tf), structureMode: "daily-in-week", structureLabel: "Daily highs/lows inside the selected Monday-to-Friday week", sourceUnitSingular: "day", sourceUnitPlural: "daily levels", firstPeriodText: "Monday high/low creates first support and resistance.", startPriceLabel: "Monday open", currentPriceLabel: "latest close for selected week", rangeKind: "week", breakdownTitle: "Monday-to-Friday CSA Breakdown" };
  }
  if (tf === "H4") return { selectedTimeframe: tf, interval: "4h", structureMode: "weekly-in-month", structureLabel: "Weekly highs/lows inside the selected calendar month", sourceUnitSingular: "week", sourceUnitPlural: "weekly levels", firstPeriodText: "First week high/low creates first support and resistance.", startPriceLabel: "first week open", currentPriceLabel: "latest close for selected month", rangeKind: "month", breakdownTitle: "Weekly CSA Breakdown For Selected Month" };
  if (tf === "D1") return { selectedTimeframe: tf, interval: "1day", structureMode: "monthly-in-year", structureLabel: "Monthly highs/lows inside the selected calendar year", sourceUnitSingular: "month", sourceUnitPlural: "monthly levels", firstPeriodText: "First month high/low creates first support and resistance.", startPriceLabel: "first month open", currentPriceLabel: "latest close for selected year", rangeKind: "year", breakdownTitle: "Monthly CSA Breakdown For Selected Year" };
  if (tf === "W1") return { selectedTimeframe: tf, interval: "1week", structureMode: "quarterly-in-year", structureLabel: "Quarterly highs/lows inside the selected calendar year", sourceUnitSingular: "quarter", sourceUnitPlural: "quarterly levels", firstPeriodText: "First quarter high/low creates first support and resistance.", startPriceLabel: "first quarter open", currentPriceLabel: "latest close for selected year", rangeKind: "year", breakdownTitle: "Quarterly CSA Breakdown For Selected Year" };
  if (tf === "MN") return { selectedTimeframe: tf, interval: "1month", structureMode: "yearly-in-multi-year", structureLabel: "Yearly highs/lows across selected year plus previous 4 years", sourceUnitSingular: "year", sourceUnitPlural: "yearly levels", firstPeriodText: "First year high/low creates first support and resistance.", startPriceLabel: "first year open", currentPriceLabel: "latest close for selected multi-year range", rangeKind: "multi-year range", breakdownTitle: "Yearly CSA Breakdown For Monthly Chart" };
  return getSupportedCsaTimeframeProfile("H1");
}

function getMonthName(monthIndex) {
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, monthIndex, 1)));
}
function getQuarterLabel(monthIndex) { return monthIndex <= 2 ? "Q1" : monthIndex <= 5 ? "Q2" : monthIndex <= 8 ? "Q3" : "Q4"; }
function weekdayNameFromDate(dateString) { return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${dateString}T00:00:00.000Z`)); }

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
  // IMPORTANT: Always stop at the selected chart/trade date.
  // Do not use candles after the selected date to judge the current setup.
  // Example: if the selected date is Tuesday, the review must not use Wednesday-Friday data.
  const useFull = false;
  if (profile.structureMode === "daily-in-week") return getWeekRangeForDate(chartDate, useFull);
  if (profile.structureMode === "weekly-in-month") return getMonthRangeForDate(chartDate, useFull);
  if (["monthly-in-year", "quarterly-in-year"].includes(profile.structureMode)) return getYearRangeForDate(chartDate, useFull);
  if (profile.structureMode === "yearly-in-multi-year") return getMultiYearRangeForDate(chartDate, 4, useFull);
  return getWeekRangeForDate(chartDate, useFull);
}

function getPeriodKeyAndLabel(date, profile) {
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  if (profile.structureMode === "daily-in-week") { const dateOnly = formatDateOnly(date); return { key: dateOnly, label: weekdayNameFromDate(dateOnly), date: dateOnly }; }
  if (profile.structureMode === "weekly-in-month") {
    const monthStart = new Date(Date.UTC(year, month, 1));
    const weekNumber = Math.ceil((date.getUTCDate() + monthStart.getUTCDay()) / 7);
    return { key: `${year}-${String(month + 1).padStart(2, "0")}-W${weekNumber}`, label: `Week ${weekNumber}`, date: formatDateOnly(date) };
  }
  if (profile.structureMode === "monthly-in-year") return { key: `${year}-${String(month + 1).padStart(2, "0")}`, label: getMonthName(month), date: `${year}-${String(month + 1).padStart(2, "0")}-01` };
  if (profile.structureMode === "quarterly-in-year") { const q = getQuarterLabel(month); return { key: `${year}-${q}`, label: q, date: `${year}-${q}` }; }
  if (profile.structureMode === "yearly-in-multi-year") return { key: String(year), label: String(year), date: `${year}-01-01` };
  const dateOnly = formatDateOnly(date);
  return { key: dateOnly, label: dateOnly, date: dateOnly };
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
    if (profile.structureMode === "daily-in-week") { const dayNum = date.getUTCDay(); if (dayNum < 1 || dayNum > 5) return; }
    const open = safeNumber(bar.open), high = safeNumber(bar.high), low = safeNumber(bar.low), close = safeNumber(bar.close);
    if ([open, high, low, close].some((v) => v === null)) return;
    const period = getPeriodKeyAndLabel(date, profile);
    if (!grouped.has(period.key)) {
      grouped.set(period.key, { key: period.key, date: period.date, day: period.label, periodLabel: period.label, open, high, low, close, candleCount: 1 });
    } else {
      const existing = grouped.get(period.key);
      existing.high = Math.max(existing.high, high);
      existing.low = Math.min(existing.low, low);
      existing.close = close;
      existing.candleCount += 1;
    }
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
  if (!Array.isArray(levels) || levels.length < 2) {
    return {
      bias: "Insufficient data",
      biasCode: "insufficient",
      confidence: "low",
      traderBias: "Not enough market data to form a reliable direction.",
      higherTimeframeView: "Not enough market data to compare the key highs, lows, and closes.",
      timeframeView: "Not enough chart data.",
      reason: `At least two ${profile.sourceUnitPlural} are needed.`,
      periodStartPrice: null,
      presentPrice: null,
      periodHigh: null,
      periodLow: null,
      priceMove: null,
      movePercentOfRange: null,
      highBreakCount: 0,
      lowBreakCount: 0,
      risingCloses: 0,
      fallingCloses: 0,
      rangeScore: 0,
    };
  }

  const first = levels[0];
  const last = levels[levels.length - 1];
  const periodStartPrice = Number(first.open);
  const presentPrice = Number(last.close);
  const periodHigh = Math.max(...levels.map((item) => Number(item.high)));
  const periodLow = Math.min(...levels.map((item) => Number(item.low)));
  const fullRange = Math.max(Math.abs(periodHigh - periodLow), getCleanBreakTolerance(symbol));
  const priceMove = presentPrice - periodStartPrice;
  const movePercentOfRange = Math.abs(priceMove) / fullRange;

  const anchorHigh = Number(first.high);
  const anchorLow = Number(first.low);
  const anchorRange = Math.max(Math.abs(anchorHigh - anchorLow), getCleanBreakTolerance(symbol));
  const anchorPositionPercent = Number.isFinite(presentPrice) && Number.isFinite(anchorHigh) && Number.isFinite(anchorLow)
    ? ((presentPrice - anchorLow) / anchorRange) * 100
    : null;
  const anchorLabel = first.periodLabel || first.day || first.key || "the first key range";
  let rangePositionNote = "Price position inside the first key range is not clear.";
  if (Number.isFinite(anchorPositionPercent)) {
    if (presentPrice > anchorHigh + getCleanBreakTolerance(symbol)) {
      rangePositionNote = `Price is above ${anchorLabel} resistance around ${formatPrice(anchorHigh)}, which shows bullish breakout pressure.`;
    } else if (presentPrice < anchorLow - getCleanBreakTolerance(symbol)) {
      rangePositionNote = `Price is below ${anchorLabel} support around ${formatPrice(anchorLow)}, which shows bearish breakout pressure.`;
    } else if (anchorPositionPercent >= 61.8) {
      rangePositionNote = `Price is in the upper part of ${anchorLabel}'s range, closer to resistance around ${formatPrice(anchorHigh)}.`;
    } else if (anchorPositionPercent <= 38.2) {
      rangePositionNote = `Price is in the lower part of ${anchorLabel}'s range, closer to support around ${formatPrice(anchorLow)}.`;
    } else {
      rangePositionNote = `Price is around the middle of ${anchorLabel}'s range, between support around ${formatPrice(anchorLow)} and resistance around ${formatPrice(anchorHigh)}.`;
    }
  }

  let highBreakCount = 0;
  let lowBreakCount = 0;
  let risingCloses = 0;
  let fallingCloses = 0;
  let insideOrOverlapCount = 0;

  for (let i = 1; i < levels.length; i += 1) {
    const highBreak = compareHighWithTolerance(levels[i].high, levels[i - 1].high, symbol).cleanBreak;
    const lowBreak = compareLowWithTolerance(levels[i].low, levels[i - 1].low, symbol).cleanBreak;

    if (highBreak) highBreakCount += 1;
    if (lowBreak) lowBreakCount += 1;
    if (!highBreak && !lowBreak) insideOrOverlapCount += 1;

    if (Number(levels[i].close) > Number(levels[i - 1].close)) risingCloses += 1;
    if (Number(levels[i].close) < Number(levels[i - 1].close)) fallingCloses += 1;
  }

  let bullishScore = 0;
  let bearishScore = 0;
  let rangeScore = 0;

  if (priceMove > 0) bullishScore += 1;
  if (priceMove < 0) bearishScore += 1;

  if (movePercentOfRange >= 0.55 && priceMove > 0) bullishScore += 2;
  if (movePercentOfRange >= 0.55 && priceMove < 0) bearishScore += 2;
  if (movePercentOfRange < 0.35) rangeScore += 2;

  if (highBreakCount > lowBreakCount) bullishScore += 1.5;
  if (lowBreakCount > highBreakCount) bearishScore += 1.5;
  if (highBreakCount === lowBreakCount) rangeScore += 1;

  if (risingCloses > fallingCloses) bullishScore += 1;
  if (fallingCloses > risingCloses) bearishScore += 1;
  if (Math.abs(risingCloses - fallingCloses) <= 1) rangeScore += 1;

  if (insideOrOverlapCount >= Math.max(1, Math.floor((levels.length - 1) / 2))) rangeScore += 1.5;

  const nearHigh = (periodHigh - presentPrice) / fullRange <= 0.25;
  const nearLow = (presentPrice - periodLow) / fullRange <= 0.25;
  if (nearHigh && priceMove > 0) bullishScore += 0.75;
  if (nearLow && priceMove < 0) bearishScore += 0.75;
  if (!nearHigh && !nearLow) rangeScore += 0.75;

  let bias = "Range-bound";
  let biasCode = "range";
  let traderBias = "The bigger-picture view is mostly sideways.";
  let confidence = "medium";

  const scoreDifference = Math.abs(bullishScore - bearishScore);

  if (rangeScore >= Math.max(bullishScore, bearishScore) || scoreDifference < 1.25) {
    if (bearishScore > bullishScore + 0.25) {
      bias = "Range-bound with bearish pressure";
      biasCode = "range_bearish";
      traderBias = "The bigger-picture view is mostly sideways, but sellers have slightly more pressure.";
    } else if (bullishScore > bearishScore + 0.25) {
      bias = "Range-bound with bullish pressure";
      biasCode = "range_bullish";
      traderBias = "The bigger-picture view is mostly sideways, but buyers have slightly more pressure.";
    }
    confidence = rangeScore >= 3 ? "medium" : "low";
  } else if (bullishScore > bearishScore) {
    bias = scoreDifference >= 3 && movePercentOfRange >= 0.45 ? "Bullish" : "Slightly bullish";
    biasCode = scoreDifference >= 3 && movePercentOfRange >= 0.45 ? "bullish" : "slightly_bullish";
    traderBias = bias === "Bullish"
      ? "The bigger-picture view is bullish."
      : "The bigger-picture view leans bullish, but it is not a clean one-way move.";
    confidence = scoreDifference >= 3 ? "high" : "medium";
  } else {
    bias = scoreDifference >= 3 && movePercentOfRange >= 0.45 ? "Bearish" : "Slightly bearish";
    biasCode = scoreDifference >= 3 && movePercentOfRange >= 0.45 ? "bearish" : "slightly_bearish";
    traderBias = bias === "Bearish"
      ? "The bigger-picture view is bearish."
      : "The bigger-picture view leans bearish, but it is not a clean one-way move.";
    confidence = scoreDifference >= 3 ? "high" : "medium";
  }

  if (String(biasCode || "").includes("range") && Number.isFinite(anchorPositionPercent)) {
    if (anchorPositionPercent <= 38.2) {
      bias = "Range-bound with bearish pressure";
      biasCode = "range_bearish";
      traderBias = "The bigger-picture view is mostly sideways, but price is trading in the lower part of the first key range, so sellers have pressure for now.";
    } else if (anchorPositionPercent >= 61.8) {
      bias = "Range-bound with bullish pressure";
      biasCode = "range_bullish";
      traderBias = "The bigger-picture view is mostly sideways, but price is trading in the upper part of the first key range, so buyers have pressure for now.";
    }
  }

  const structureLabelForUsers =
    profile.structureMode === "daily-in-week"
      ? "this week's daily highs, lows, and closes"
      : profile.structureMode === "weekly-in-month"
      ? "this month's weekly highs, lows, and closes"
      : profile.structureMode === "monthly-in-year"
      ? "this year's monthly highs, lows, and closes"
      : profile.structureMode === "quarterly-in-year"
      ? "this year's quarterly highs, lows, and closes"
      : "the higher-timeframe highs, lows, and closes";

  const higherTimeframeView =
    `${traderBias} This is based on ${structureLabelForUsers}. ` +
    `Price opened around ${formatPrice(periodStartPrice)} and is now around ${formatPrice(presentPrice)}. ` +
    `The high of the reviewed period is ${formatPrice(periodHigh)} and the low is ${formatPrice(periodLow)}. ` +
    `${rangePositionNote} ` +
    `Daily/period closes were mixed: ${risingCloses} higher close(s), ${fallingCloses} lower close(s).`;

  const timeframeView =
    `The uploaded ${profile.selectedTimeframe || ""} chart should be read as the execution view. ` +
    `A short-term move on the uploaded chart can be bullish or bearish, but it should still be compared with the bigger-picture view above.`;

  return {
    bias,
    biasCode,
    confidence,
    traderBias,
    higherTimeframeView,
    timeframeView,
    periodStartPrice,
    presentPrice,
    periodHigh,
    periodLow,
    priceMove,
    movePercentOfRange,
    resistanceCount: highBreakCount,
    supportCount: lowBreakCount,
    risingCloses,
    fallingCloses,
    highBreakCount,
    lowBreakCount,
    bullishScore,
    bearishScore,
    rangeScore,
    anchorHigh,
    anchorLow,
    anchorLabel,
    anchorPositionPercent,
    rangePositionNote,
    reason: higherTimeframeView,
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
function splitAreas(areas = []) { return { resistanceAreas: areas.filter((a) => a.type === "resistance"), supportAreas: areas.filter((a) => a.type === "support"), supplyAreas: areas.filter((a) => a.type === "supply"), demandAreas: areas.filter((a) => a.type === "demand") }; }
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

function simpleFailedAreaTitle(area) {
  const type = String(area?.type || "area").toLowerCase();
  if (type === "support") return "Failed support area";
  if (type === "demand") return "Failed demand area";
  if (type === "resistance") return "Failed resistance area";
  if (type === "supply") return "Failed supply area";
  return "Failed CSA area";
}

function buildFrameworkMistakeHub({ failedAreas = [], hasConfirmedTrigger = false, rejectedContext = null, mixedBias = false, marketOk = true, entryAccuracyScore = 0, riskManagementScore = 0 }) {
  const items = [];
  const add = (title, tag) => { if (title && !items.some((item) => item.title.toLowerCase() === String(title).toLowerCase())) items.push(makeSimpleMistake(title, tag)); };
  if (!marketOk) add("Market data unavailable", "DATA ISSUE");
  if (!hasConfirmedTrigger) add("No visible trigger", "REVIEW");
  if (rejectedContext && !hasConfirmedTrigger) add("Context only, no trigger", "DISCIPLINE");
  if (mixedBias) add("Unclear structure", "STRUCTURAL");
  failedAreas.slice(0, 4).forEach((area) => add(simpleFailedAreaTitle(area), "STRUCTURAL"));
  if (Number(entryAccuracyScore) > 0 && Number(entryAccuracyScore) < 50) add("Entry evidence weak", "WARNING");
  if (Number(riskManagementScore) > 0 && Number(riskManagementScore) < 55) add("Risk evidence unclear", "REVIEW");
  if (!items.length) add("No major mistake detected", "REVIEW");
  return items.slice(0, 5);
}

async function detectChartContextFromImage({ imageBase64, mimeType, submittedInstrument = "", selectedTimeframe = "", selectedDateText = "", analysisType = "post-trade" }) {
  const fallback = (reason) => ({ ok: false, isTradingChart: false, chartValidityReason: reason, hasUsablePriceData: false, visibleCandleCount: 0, chartDataQuality: "unclear", selectedDateVisible: false, insufficientDataReason: reason, detectedInstrument: null, detectedTimeframe: null, latestVisibleDate: null, dateConfidence: "low", visibleTrigger: null, rejectedTriggerContext: null, triggerDirection: null, triggerConfidence: "low", notes: reason, raw: "" });
  if (!process.env.OPENAI_API_KEY) return fallback("OPENAI_API_KEY is missing.");

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: CHART_DETECTION_PROMPT },
        { role: "user", content: [
          { type: "input_text", text: `Inspect this uploaded chart image.\nSelected instrument: ${submittedInstrument || "not provided"}\nSelected timeframe: ${selectedTimeframe || "not provided"}\nSelected chart/trade date: ${selectedDateText || "not provided"}\nAnalysis type: ${analysisType || "post-trade"}\nReturn only JSON.` },
          { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}` },
        ]},
      ],
      max_output_tokens: 700,
    });

    const parsed = extractJsonObject(response.output_text || "");
    if (!parsed) return fallback("Chart validation did not return usable JSON.");
    const isTradingChart = parsed?.isTradingChart === true;
    const rawTrigger = parsed?.visibleTrigger || null;
    const triggerConfidence = parsed?.triggerConfidence || "low";
    const cleanTrigger = sanitizeVisibleTrigger(rawTrigger, triggerConfidence);
    const visibleCandleCount = Number.isFinite(Number(parsed?.visibleCandleCount)) ? Number(parsed.visibleCandleCount) : 0;
    const quality = isTradingChart ? parsed?.chartDataQuality || "usable" : "unclear";

    return {
      ok: true,
      isTradingChart,
      chartValidityReason: parsed?.chartValidityReason || (isTradingChart ? "The uploaded image appears to be a valid trading chart." : "The uploaded image does not appear to be a valid financial trading chart."),
      hasUsablePriceData: isTradingChart ? parsed?.hasUsablePriceData !== false : false,
      visibleCandleCount,
      chartDataQuality: quality,
      selectedDateVisible: isTradingChart ? parsed?.selectedDateVisible === true : false,
      insufficientDataReason: parsed?.insufficientDataReason || (!isTradingChart ? "The uploaded image is not a financial trading chart." : null),
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
  const quality = String(chartDetection.chartDataQuality || "").toLowerCase();
  if (["blank", "insufficient"].includes(quality)) return false;
  if (chartDetection.hasUsablePriceData === false && quality === "unclear") return false;
  const candles = Number(chartDetection.visibleCandleCount || 0);
  if (Number.isFinite(candles) && candles > 0 && candles < 15) return false;
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
  if (["M1", "M5", "M15", "M30", "H1"].includes(tf)) return 3;
  if (tf === "H4") return 10;
  if (tf === "D1") return 45;
  if (tf === "W1") return 120;
  if (tf === "MN") return 400;
  return 3;
}

function getSelectedDateMismatch(chartDetection, selectedDate, timeframe = "") {
  if (!selectedDate || !chartDetection?.latestVisibleDate) return { hasMismatch: false };
  const latestVisibleDate = parseISODateOnly(chartDetection.latestVisibleDate);
  if (!latestVisibleDate) return { hasMismatch: false };
  const daysAfterLatestVisible = getDaysBetweenDates(latestVisibleDate, selectedDate);
  const allowedGapDays = getAllowedFutureDateGapDays(timeframe);
  const confidence = String(chartDetection.dateConfidence || "low").toLowerCase();
  const hasMismatch = ["high", "medium"].includes(confidence) && Number.isFinite(daysAfterLatestVisible) && daysAfterLatestVisible > allowedGapDays;
  return { hasMismatch, selectedDateText: formatDateOnly(selectedDate), latestVisibleDateText: formatDateOnly(latestVisibleDate), daysAfterLatestVisible, allowedGapDays, dateConfidence: confidence || "low", reason: hasMismatch ? `Selected date is ${daysAfterLatestVisible} day(s) after the latest visible chart date, beyond the allowed ${allowedGapDays} day(s).` : "Selected date is not clearly beyond the latest visible chart date." };
}

function isUsableChartDateDetection(detection) {
  if (!detection || !detection.latestVisibleDate) return false;
  if (!parseISODateOnly(detection.latestVisibleDate)) return false;
  const confidence = String(detection.dateConfidence || "").toLowerCase();
  return confidence === "high" || confidence === "medium";
}

function chooseFinalChartDate({ selectedDate, detection }) {
  const detectedDate = isUsableChartDateDetection(detection) ? parseISODateOnly(detection.latestVisibleDate) : null;
  if (selectedDate) return { finalDate: selectedDate, finalDateText: formatDateOnly(selectedDate), selectedDateText: formatDateOnly(selectedDate), detectedDateText: detectedDate ? formatDateOnly(detectedDate) : null, source: "user-selected-date", reason: "User-selected chart/trade date was used." };
  if (detectedDate) return { finalDate: detectedDate, finalDateText: formatDateOnly(detectedDate), selectedDateText: null, detectedDateText: formatDateOnly(detectedDate), source: "chart-detected-date", reason: "No user-selected date was provided, so the chart-detected latest visible date was used." };
  return { finalDate: null, finalDateText: "Not provided", selectedDateText: null, detectedDateText: null, source: "missing-date", reason: "No usable date was available." };
}


function buildCsaFrameworkSummaryForVision(marketReference = {}) {
  const profile = marketReference?.profile || {};
  const levels = Array.isArray(marketReference?.dailyLevels) ? marketReference.dailyLevels : [];
  const areas = Array.isArray(marketReference?.csaAreas) ? marketReference.csaAreas : [];
  const bias = marketReference?.directionalBias || {};

  const levelLines = levels.slice(0, 12).map((level) => {
    const label = level.periodLabel || level.day || level.key || level.date;
    return `- ${label}: open ${formatPrice(level.open)}, high ${formatPrice(level.high)}, low ${formatPrice(level.low)}, close ${formatPrice(level.close)}`;
  });

  const areaLines = areas.slice(0, 20).map((area) => {
    const userType =
      area.type === "resistance" || area.type === "supply"
        ? "possible selling area"
        : "possible buying area";
    return `- ${area.day || area.period || area.date}: ${userType} around ${area.priceText || formatPrice(area.price)}`;
  });

  return [
    `Internal structure source: ${profile.structureLabel || "Not available"}`,
    `Reviewed range: ${marketReference?.weekRange ? `${marketReference.weekRange.startDate} to ${marketReference.weekRange.endDate}` : "Not available"}`,
    `Bigger-picture direction: ${bias.bias || "Not available"} (${bias.confidence || "low"} confidence)`,
    `Plain-language direction note: ${bias.higherTimeframeView || bias.reason || "Not available"}`,
    "",
    "Key highs/lows/closes:",
    levelLines.length ? levelLines.join("\n") : "- No levels available.",
    "",
    "Important support/resistance areas, stated in simple language:",
    areaLines.length ? areaLines.join("\n") : "- No areas available.",
  ].join("\n");
}

function visualFallback(reason) {
  return { ok: false, frameworkMatch: "not reviewed", visualChartStyle: "not reviewed", csaLevelVisibility: "not reviewed", chartSpecificStrengths: [], chartSpecificWeaknesses: [reason], simpleMistakeHub: [], setupQualityScore: null, entryAccuracyScore: null, riskManagementScore: null, visualSummary: reason, chartMarkupAssessment: "", entryEvidence: "", riskEvidence: "", raw: "" };
}

function isBadVisualReview(parsed) {
  const text = [parsed?.visualSummary, parsed?.chartMarkupAssessment, parsed?.entryEvidence, parsed?.riskEvidence, ...(Array.isArray(parsed?.chartSpecificWeaknesses) ? parsed.chartSpecificWeaknesses : [])].join(" ").toLowerCase();
  return text.includes("insufficient chart data") || text.includes("uploaded image appears to be a trading chart, but") || text.includes("not enough visible price data");
}


async function compareUploadedChartWithCsaFramework({ imageBase64, mimeType, marketReference, chartDetection, submittedInstrument = "", timeframe = "", analysisType = "post-trade", submittedNotes = "" }) {
  if (!process.env.OPENAI_API_KEY) return visualFallback("OPENAI_API_KEY is missing.");
  if (!marketReference?.ok) return visualFallback("Market structure was unavailable, so visual comparison could not be completed.");
  if (!imageBase64) return visualFallback("Uploaded chart image was not available for visual comparison.");

  const prompt = `
You are CSA Coach's beginner-friendly trade review assistant.
Return ONLY valid JSON. Do not use markdown.

Your job:
- Review the uploaded chart using the internal support/resistance framework below.
- The user is likely a beginner. Use very simple trading language.
- The backend can use the internal method, but user-facing fields must NOT say "CSA", "framework", "daily high/low logic", "supply/demand classification", or other internal method words.
- Do not mention trendlines, channels, Fibonacci, indicators, or moving averages. They are outside this review. Ignore them unless they hide price.
- Explain only what matters to a beginner:
  1. Is the bigger picture bullish, bearish, or ranging?
  2. What is the selected ${timeframe} chart doing right now?
  3. Should the trader wait, buy, sell, or avoid chasing?
  4. Where exactly should price return before a better setup forms? Always include support/resistance and the price level.
  5. Is there a clear entry confirmation?
  6. Is stop loss/target visible enough to judge?
- The internal range-position check may use the first key high/low like a Fibonacci/range-position guide, but user-facing wording should say it simply: "price is in the upper/middle/lower part of the range."
- CSA is mainly a trend-trading strategy. If there is no clean trend yet, do not force a buy or sell. Give both sides: buy at support if it holds, or sell at resistance if it rejects.
- Never write incomplete advice like "wait for price to drop back" without saying the exact support/resistance area and price.
- Keep all user-facing answers short, plain, and useful.
- Two different-looking charts must receive different strengths, weaknesses, mistake hub items, scores, and short-term chart direction.
- Do not invent entries, stop loss, targets, or mistakes if they are not visible.
- If no entry/SL/TP is visible, say "No visible entry, stop loss, or target to judge."
- If the bigger-picture view and uploaded chart timeframe disagree, state both clearly.
  Example: "The bigger picture is slightly bearish, but the ${timeframe} chart is pushing up short-term."
- Do not give financial advice or guaranteed predictions. This is only chart feedback.

Internal support/resistance framework:
${buildCsaFrameworkSummaryForVision(marketReference)}

Selected context:
- Instrument: ${submittedInstrument}
- Timeframe uploaded/selected: ${timeframe}
- Mode: ${analysisType}
- User notes: ${submittedNotes || "None"}

Initial image validation:
- Detected instrument: ${chartDetection?.detectedInstrument || "not detected"}
- Detected timeframe: ${chartDetection?.detectedTimeframe || "not detected"}
- Latest visible date: ${chartDetection?.latestVisibleDate || "not detected"}
- Detected trigger: ${chartDetection?.visibleTrigger || "none confirmed"}

Return exactly this JSON shape:
{
  "frameworkMatch": "strong | partial | weak | not enough evidence",
  "visualChartStyle": "clear support/resistance | clean price action | marked chart | unclear",
  "csaLevelVisibility": "clear | partial | not marked | unclear",
  "shortTermDirection": "bullish | bearish | range-bound | range-bound with bullish pressure | range-bound with bearish pressure | unclear",
  "quickVerdict": "one very simple sentence saying wait, avoid chasing, or setup looks acceptable",
  "plainMarketDirection": "one simple sentence combining bigger-picture direction and ${timeframe} chart direction",
  "whatThisMeans": "one simple sentence explaining what the trader should understand from the chart",
  "timeframeSummary": "one simple sentence describing what the uploaded ${timeframe} chart is doing",
  "bestAreaToWatch": "one simple sentence saying exactly where price should return before a better setup, including support/resistance and price level",
  "visualSummary": "2 short beginner-friendly sentences. Mention bigger-picture direction and uploaded timeframe direction if different.",
  "chartMarkupAssessment": "simple comment about whether the important support/resistance areas are clear; do not mention trendlines/channels/indicators",
  "entryEvidence": "what entry evidence is visible, or 'No visible entry evidence'",
  "riskEvidence": "what SL/TP/risk evidence is visible, or 'No visible entry, stop loss, or target to judge'",
  "mainWarning": "one simple warning the trader should remember",
  "coachVerdict": "one short final verdict in beginner language",
  "chartSpecificStrengths": ["simple strength visible on this chart"],
  "chartSpecificWeaknesses": ["simple weakness visible on this chart"],
  "simpleMistakeHub": [
    { "title": "short mistake title", "tag": "HIGH RISK | WARNING | STRUCTURAL | MATH FLAW | DISCIPLINE | REVIEW" }
  ],
  "setupQualityScore": 50,
  "entryAccuracyScore": 50,
  "riskManagementScore": 50
}`;

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: prompt },
        { role: "user", content: [
          { type: "input_text", text: "Review this uploaded chart in simple beginner trader language using the internal support/resistance framework. Return only the required JSON." },
          { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}` },
        ]},
      ],
      max_output_tokens: 1300,
    });

    const parsed = extractJsonObject(response.output_text || "");
    if (!parsed || isBadVisualReview(parsed)) return visualFallback("Visual comparison was inconclusive, so market-structure fallback was used.");

    return {
      ok: true,
      frameworkMatch: parsed.frameworkMatch || "not enough evidence",
      visualChartStyle: parsed.visualChartStyle || "unclear",
      csaLevelVisibility: parsed.csaLevelVisibility || "unclear",
      shortTermDirection: parsed.shortTermDirection || "unclear",
      quickVerdict: String(parsed.quickVerdict || "").trim(),
      plainMarketDirection: String(parsed.plainMarketDirection || "").trim(),
      whatThisMeans: String(parsed.whatThisMeans || "").trim(),
      timeframeSummary: String(parsed.timeframeSummary || "").trim(),
      bestAreaToWatch: String(parsed.bestAreaToWatch || "").trim(),
      mainWarning: String(parsed.mainWarning || "").trim(),
      coachVerdict: String(parsed.coachVerdict || "").trim(),
      chartSpecificStrengths: normalizeArrayOfStrings(parsed.chartSpecificStrengths, []),
      chartSpecificWeaknesses: normalizeArrayOfStrings(parsed.chartSpecificWeaknesses, []),
      simpleMistakeHub: normalizeVisualMistakeItems(parsed.simpleMistakeHub),
      setupQualityScore: Number.isFinite(Number(parsed.setupQualityScore)) ? clampScore(Number(parsed.setupQualityScore)) : null,
      entryAccuracyScore: Number.isFinite(Number(parsed.entryAccuracyScore)) ? clampScore(Number(parsed.entryAccuracyScore)) : null,
      riskManagementScore: Number.isFinite(Number(parsed.riskManagementScore)) ? clampScore(Number(parsed.riskManagementScore)) : null,
      visualSummary: String(parsed.visualSummary || "").trim(),
      chartMarkupAssessment: String(parsed.chartMarkupAssessment || "").trim(),
      entryEvidence: String(parsed.entryEvidence || "").trim(),
      riskEvidence: String(parsed.riskEvidence || "").trim(),
      raw: response.output_text || "",
    };
  } catch (error) {
    console.error("Visual trade review error:", error);
    return visualFallback(`Visual trade review failed: ${error.message}`);
  }
}

function shouldUseVisualScore(score, marketOk) {
  const n = Number(score);
  if (!Number.isFinite(n)) return false;
  if (marketOk && n < 20) return false;
  return true;
}


function buildDashboardFeedback({ marketReference, chartDetection, visualReview = null, submittedInstrument, timeframe, selectedDateText, detectedDateText, setupScore = 0 }) {
  const profile = marketReference?.profile || getSupportedCsaTimeframeProfile(timeframe);
  const levels = marketReference?.dailyLevels || [];
  const areas = marketReference?.csaAreas || [];
  const bias = marketReference?.directionalBias || calculateCsaDirectionalBias([], marketReference?.symbol || submittedInstrument, profile);
  const symbol = marketReference?.symbol || submittedInstrument;
  const { resistanceAreas, supportAreas, supplyAreas, demandAreas } = splitAreas(areas);
  const failedAreas = buildFailedAreas({ supportAreas, resistanceAreas, supplyAreas, demandAreas, levels, symbol });
  const hasConfirmedTrigger = Boolean(chartDetection?.visibleTrigger);
  const rejectedContext = chartDetection?.rejectedTriggerContext || null;
  const mixedBias = String(bias?.biasCode || "").toLowerCase().includes("range") || String(bias?.bias || "").toLowerCase().includes("range");
  const marketOk = Boolean(marketReference?.ok);
  const visualOk = Boolean(visualReview?.ok);

  const frameworkStrengths = [];
  const frameworkWeaknesses = [];

  if (marketOk) {
    frameworkStrengths.push(`Bigger-picture direction checked using the main highs, lows, and closes.`);
    frameworkStrengths.push(`Main view: ${bias.bias}.`);
  } else {
    frameworkWeaknesses.push(marketReference?.error || "Market data unavailable.");
  }

  if (chartDetection?.hasUsablePriceData) frameworkStrengths.push("Uploaded chart has enough visible price action to review.");
  if (!hasConfirmedTrigger) frameworkWeaknesses.push("No clear entry confirmation was detected on the uploaded chart.");
  failedAreas.forEach((area) => frameworkWeaknesses.push(area.explanation));
  if (mixedBias) frameworkWeaknesses.push("The bigger-picture view is not a clean trend, so middle-of-range trades need caution.");

  const visualStrengths = visualOk ? normalizeArrayOfStrings(visualReview.chartSpecificStrengths, []) : [];
  const visualWeaknesses = visualOk ? normalizeArrayOfStrings(visualReview.chartSpecificWeaknesses, []) : [];
  const strengths = [...visualStrengths, ...frameworkStrengths].filter(Boolean);
  const weaknesses = [...visualWeaknesses, ...frameworkWeaknesses].filter(Boolean);

  const baseSetupQualityScore = clampScore((setupScore || 0) * 10 - failedAreas.length * 8 - (mixedBias ? 8 : 0) + (marketOk ? 5 : -20));
  const baseEntryAccuracyScore = clampScore(65 + (hasConfirmedTrigger ? 15 : -10) - failedAreas.length * 10 - (mixedBias ? 5 : 0));
  const baseRiskManagementScore = clampScore(70 - failedAreas.length * 8 - (mixedBias ? 5 : 0));

  const setupQualityScore = visualOk && shouldUseVisualScore(visualReview.setupQualityScore, marketOk) ? clampScore(visualReview.setupQualityScore) : baseSetupQualityScore;
  const entryAccuracyScore = visualOk && shouldUseVisualScore(visualReview.entryAccuracyScore, marketOk) ? clampScore(visualReview.entryAccuracyScore) : baseEntryAccuracyScore;
  const riskManagementScore = visualOk && shouldUseVisualScore(visualReview.riskManagementScore, marketOk) ? clampScore(visualReview.riskManagementScore) : baseRiskManagementScore;

  const contextCheck = {
    selectedInstrument: submittedInstrument || "Not provided",
    selectedTimeframe: timeframe || "Not provided",
    detectedInstrument: chartDetection?.detectedInstrument || "Not detected",
    detectedTimeframe: chartDetection?.detectedTimeframe || "Not detected",
    selectedDate: selectedDateText || "Not provided",
    detectedLatestVisibleDate: detectedDateText || chartDetection?.latestVisibleDate || "Not detected",
    status: marketOk ? "Reviewed" : "Review limited",
    structureUsed:
      profile.structureMode === "daily-in-week"
        ? "This week's key highs, lows, and closes"
        : profile.structureMode === "weekly-in-month"
        ? "This month's key weekly highs and lows"
        : profile.structureMode === "monthly-in-year"
        ? "This year's key monthly highs and lows"
        : "Higher-timeframe key highs and lows",
    rangeUsed: marketReference?.weekRange ? `${marketReference.weekRange.startDate} to ${marketReference.weekRange.endDate}` : "Not available",
    chartValidation: chartDetection?.isTradingChart ? "Valid trading chart" : "Invalid or unverified chart",
    chartDataQuality: chartDetection?.chartDataQuality || "unclear",
    visibleCandleCount: chartDetection?.visibleCandleCount || 0,
    biggerPictureView: bias.bias || "Not available",
    selectedTimeframeView: visualReview?.shortTermDirection || "Not reviewed",
    visualFrameworkMatch: visualReview?.frameworkMatch || "Not reviewed",
    visualChartStyle: visualReview?.visualChartStyle || "Not reviewed",
    csaLevelVisibility: visualReview?.csaLevelVisibility || "Not reviewed",
  };

  const visualMistakes = visualOk ? normalizeVisualMistakeItems(visualReview.simpleMistakeHub) : [];
  const frameworkMistakes = buildFrameworkMistakeHub({
    failedAreas,
    hasConfirmedTrigger,
    rejectedContext,
    mixedBias,
    marketOk,
    entryAccuracyScore: baseEntryAccuracyScore,
    riskManagementScore: baseRiskManagementScore,
  });
  const aiMistakeDetectionHub = visualMistakes.length ? visualMistakes : frameworkMistakes;

  const setupQuality = {
    score: setupQualityScore,
    label: scoreLabel(setupQualityScore),
    summary: visualOk && visualReview.visualSummary ? visualReview.visualSummary : "Setup quality is based on the bigger-picture direction, key areas, and what is visible on the uploaded chart.",
  };
  const entryAccuracy = {
    score: entryAccuracyScore,
    label: scoreLabel(entryAccuracyScore),
    summary: visualOk && visualReview.entryEvidence ? visualReview.entryEvidence : "Entry accuracy depends on whether there is clear confirmation around a key area.",
  };
  const riskManagement = {
    score: riskManagementScore,
    label: scoreLabel(riskManagementScore),
    summary: visualOk && visualReview.riskEvidence ? visualReview.riskEvidence : "Risk score checks whether stop loss and target placement are visible and logical.",
  };

  return {
    strengths: strengths.length ? strengths.slice(0, 7) : ["Trade review completed."],
    weaknesses: weaknesses.length ? weaknesses.slice(0, 7) : ["No major weakness detected from the available chart information."],
    mistakes: aiMistakeDetectionHub,
    aiMistakeDetectionHub,
    mistakeDetectionHub: aiMistakeDetectionHub,
    mistakeHub: aiMistakeDetectionHub,
    failedAreas,
    visualReview,
    contextCheck,
    chartContextCheck: contextCheck,
    setupQuality,
    setupQualityScore,
    entryAccuracy,
    entryAccuracyScore,
    riskManagement,
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
    strengths, weaknesses,
    chartContextCheck: contextCheck, contextCheck, chartContext: contextCheck, chartContextStatus: contextCheck.status || "Not available",
    selectedContext: { instrument: contextCheck.selectedInstrument || "Not provided", timeframe: contextCheck.selectedTimeframe || "Not provided", date: contextCheck.selectedDate || "Not provided" },
    detectedContext: { instrument: contextCheck.detectedInstrument || "Not detected", timeframe: contextCheck.detectedTimeframe || "Not detected", latestVisibleDate: contextCheck.detectedLatestVisibleDate || "Not detected" },
    setupQuality, setupQualityScore: setupQuality.score, setupQualityLabel: setupQuality.label, setupQualitySummary: setupQuality.summary,
    entryAccuracy, entryAccuracyScore: entryAccuracy.score, entryAccuracyLabel: entryAccuracy.label, entryAccuracySummary: entryAccuracy.summary,
    riskManagement, riskManagementScore: riskManagement.score, riskManagementLabel: riskManagement.label, riskManagementSummary: riskManagement.summary,
    aiMistakeDetectionHub, mistakeDetectionHub: aiMistakeDetectionHub, mistakeHub: aiMistakeDetectionHub, mistakes: aiMistakeDetectionHub,
    failedAreas,
    dashboard: { strengths, weaknesses, chartContextCheck: contextCheck, contextCheck, setupQuality, entryAccuracy, riskManagement, aiMistakeDetectionHub, mistakes: aiMistakeDetectionHub, failedAreas },
    dashboardCards: { strengths, weaknesses, chartContextCheck: contextCheck, setupQuality, entryAccuracy, riskManagement, aiMistakeDetectionHub, failedAreas },
  };
}

function buildSimpleStructureBreakdown(levels = [], normalizedSymbol = "") {
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



function getFirstAnchorLabel(profile = getSupportedCsaTimeframeProfile("H1")) {
  if (profile.structureMode === "daily-in-week") return "Monday";
  if (profile.structureMode === "weekly-in-month") return "the first week";
  if (profile.structureMode === "monthly-in-year") return "the first month";
  if (profile.structureMode === "quarterly-in-year") return "the first quarter";
  if (profile.structureMode === "yearly-in-multi-year") return "the first year";
  return "the first key range";
}

function getInitialRangeAreas(levels = [], profile = getSupportedCsaTimeframeProfile("H1")) {
  const first = Array.isArray(levels) && levels.length ? levels[0] : null;
  const label = first?.periodLabel || first?.day || getFirstAnchorLabel(profile);
  return {
    label,
    support: first && Number.isFinite(Number(first.low)) ? Number(first.low) : null,
    resistance: first && Number.isFinite(Number(first.high)) ? Number(first.high) : null,
  };
}

function getInitialRangeStatus(levels = [], symbol = "", profile = getSupportedCsaTimeframeProfile("H1")) {
  const initial = getInitialRangeAreas(levels, profile);
  const tolerance = getCleanBreakTolerance(symbol);
  const support = Number(initial.support);
  const resistance = Number(initial.resistance);

  const status = {
    ...initial,
    supportText: formatPrice(support),
    resistanceText: formatPrice(resistance),
    hasInitialRange: Number.isFinite(support) && Number.isFinite(resistance),
    wickAboveHigh: false,
    wickBelowLow: false,
    closeAboveHigh: false,
    closeBelowLow: false,
    isStillInsideInitialRange: false,
    breakoutDirection: "none",
    rangeMessage: "",
  };

  if (!status.hasInitialRange) {
    status.rangeMessage = "The first key support/resistance range is not available.";
    return status;
  }

  // If only the first period exists, nothing after it has broken the range yet.
  if (!Array.isArray(levels) || levels.length < 2) {
    status.isStillInsideInitialRange = true;
    status.rangeMessage = `${initial.label} resistance around ${status.resistanceText} and ${initial.label} support around ${status.supportText} are the only active areas for now.`;
    return status;
  }

  const laterLevels = levels.slice(1);

  // Wicks are recorded, but a trend breakout is only accepted after a close beyond the first range.
  // This prevents smaller internal levels from replacing Monday high/low too early.
  status.wickAboveHigh = laterLevels.some((item) => Number(item.high) > resistance + tolerance);
  status.wickBelowLow = laterLevels.some((item) => Number(item.low) < support - tolerance);
  status.closeAboveHigh = laterLevels.some((item) => Number(item.close) > resistance + tolerance);
  status.closeBelowLow = laterLevels.some((item) => Number(item.close) < support - tolerance);
  status.isStillInsideInitialRange = !status.closeAboveHigh && !status.closeBelowLow;

  if (status.closeAboveHigh) status.breakoutDirection = "up";
  if (status.closeBelowLow) status.breakoutDirection = status.breakoutDirection === "up" ? "both" : "down";

  status.rangeMessage = status.isStillInsideInitialRange
    ? `${initial.label} high around ${status.resistanceText} and ${initial.label} low around ${status.supportText} have not closed broken yet. For now, those remain the only main rejection areas.`
    : status.breakoutDirection === "up"
    ? `Price has closed above ${initial.label} resistance around ${status.resistanceText}. The better trend setup is to wait for a pullback/retest of that broken resistance as support.`
    : status.breakoutDirection === "down"
    ? `Price has closed below ${initial.label} support around ${status.supportText}. The better trend setup is to wait for a pullback/retest of that broken support as resistance.`
    : `Price has moved outside ${initial.label}'s range. Wait for a clear retest before judging the next setup.`;

  return status;
}

function getNearestAreaForDirection({ areas = [], levels = [], symbol = "", direction = "buy", currentPrice = null, profile = getSupportedCsaTimeframeProfile("H1") }) {
  const initial = getInitialRangeAreas(levels, profile);
  const tolerance = getCleanBreakTolerance(symbol);
  const price = Number(currentPrice);
  const validAreas = areas.filter((area) => !areaBrokenByCloseLater(area, levels, symbol));

  if (direction === "buy") {
    const buyAreas = validAreas
      .filter((area) => area.type === "support" || area.type === "demand")
      .filter((area) => !Number.isFinite(price) || Number(area.price) <= price + tolerance)
      .sort((a, b) => Math.abs(Number(a.price) - price) - Math.abs(Number(b.price) - price));

    if (buyAreas.length) {
      const area = buyAreas[0];
      return { label: area.day || area.period || initial.label, type: "support", price: Number(area.price), priceText: area.priceText || formatPrice(area.price) };
    }

    return { label: initial.label, type: "support", price: initial.support, priceText: formatPrice(initial.support) };
  }

  const sellAreas = validAreas
    .filter((area) => area.type === "resistance" || area.type === "supply")
    .filter((area) => !Number.isFinite(price) || Number(area.price) >= price - tolerance)
    .sort((a, b) => Math.abs(Number(a.price) - price) - Math.abs(Number(b.price) - price));

  if (sellAreas.length) {
    const area = sellAreas[0];
    return { label: area.day || area.period || initial.label, type: "resistance", price: Number(area.price), priceText: area.priceText || formatPrice(area.price) };
  }

  return { label: initial.label, type: "resistance", price: initial.resistance, priceText: formatPrice(initial.resistance) };
}

function getBiasGroup(biasCode = "") {
  const code = String(biasCode || "").toLowerCase();
  if (code === "bullish" || code === "slightly_bullish") return "bullish";
  if (code === "bearish" || code === "slightly_bearish") return "bearish";
  if (code === "range_bullish") return "range_bullish";
  if (code === "range_bearish") return "range_bearish";
  return "range";
}

function buildBeginnerTrendPlan({ levels = [], areas = [], bias = {}, symbol = "", profile = getSupportedCsaTimeframeProfile("H1") }) {
  const currentPrice = Number(bias.presentPrice);
  const biasGroup = getBiasGroup(bias.biasCode);
  const initialStatus = getInitialRangeStatus(levels, symbol, profile);
  const initial = getInitialRangeAreas(levels, profile);

  // Core CSA trend-trading rule:
  // Until the first key high/low closes broken, do not use smaller internal levels
  // as the main entry areas. The active areas remain the first high and first low.
  // For H1/M15/M30/M5/M1 this means Monday high = resistance and Monday low = support.
  const useInitialRangeOnly = initialStatus.hasInitialRange && initialStatus.isStillInsideInitialRange;

  const buyArea = useInitialRangeOnly
    ? { label: initial.label, type: "support", price: initial.support, priceText: formatPrice(initial.support) }
    : getNearestAreaForDirection({ areas, levels, symbol, direction: "buy", currentPrice, profile });

  const sellArea = useInitialRangeOnly
    ? { label: initial.label, type: "resistance", price: initial.resistance, priceText: formatPrice(initial.resistance) }
    : getNearestAreaForDirection({ areas, levels, symbol, direction: "sell", currentPrice, profile });

  const initialSupportText = initialStatus.supportText || formatPrice(initial.support);
  const initialResistanceText = initialStatus.resistanceText || formatPrice(initial.resistance);
  const buyPriceText = buyArea.priceText || formatPrice(buyArea.price);
  const sellPriceText = sellArea.priceText || formatPrice(sellArea.price);

  let quickVerdict = "Wait for price to reach a clear area before taking action.";
  let whatThisMeans = "The safest plan is to wait for price to reach support or resistance, then look for a clear reaction.";
  let bestAreaToWatch = `Buy only if price drops to support around ${initialSupportText} and holds. Sell only if price rises to resistance around ${initialResistanceText} and rejects.`;
  let mainWarning = "Do not trade in the middle of the range. Wait for price to reach a clear support or resistance area first.";
  let coachVerdict = "This is a wait setup until price reaches one of the key areas and shows a clear reaction.";
  let preferredTrendSetup = "The preferred trend-trading setup is breakout, pullback, and retest.";

  if (useInitialRangeOnly) {
    quickVerdict = `Wait. Price is still inside ${initial.label}'s range.`;
    whatThisMeans = `${initialStatus.rangeMessage} This is not the preferred trend-trading setup yet.`;
    bestAreaToWatch = `For now, the only main areas are ${initial.label} support around ${initialSupportText} and ${initial.label} resistance around ${initialResistanceText}. A buy is only a possible rejection from support; a sell is only a possible rejection from resistance.`;
    mainWarning = `Do not use smaller internal levels as the main entry area yet. Wait for a close above ${initialResistanceText} or below ${initialSupportText}, then wait for a pullback/retest.`;
    coachVerdict = `Not recommended as a trend trade yet. Price needs to close above ${initial.label}'s high around ${initialResistanceText} or close below ${initial.label}'s low around ${initialSupportText} before the cleaner trend setup forms.`;
    preferredTrendSetup = `Preferred setup: close above ${initialResistanceText} then retest for buys, or close below ${initialSupportText} then retest for sells. Until then, only possible rejection trades exist at those two levels.`;
  } else if (biasGroup === "bullish") {
    quickVerdict = `Bullish plan: wait for price to pull back to support around ${buyPriceText} before considering a buy.`;
    whatThisMeans = `The better buy idea is not to chase price now, but to wait for price to drop back to support around ${buyPriceText} and hold.`;
    bestAreaToWatch = `For a buy, wait for price to drop back to support around ${buyPriceText} and then show a clear bullish candle or strong rejection from that area.`;
    mainWarning = `Do not buy in the middle. Wait for support around ${buyPriceText} or a fresh breakout-and-hold before considering a buy.`;
    coachVerdict = `The cleaner plan is to look for buys only after price holds support around ${buyPriceText}.`;
  } else if (biasGroup === "bearish") {
    quickVerdict = `Bearish plan: wait for price to rise back to resistance around ${sellPriceText} before considering a sell.`;
    whatThisMeans = `The better sell idea is not to chase price now, but to wait for price to pull back up to resistance around ${sellPriceText} and reject.`;
    bestAreaToWatch = `For a sell, wait for price to rise back to resistance around ${sellPriceText} and then show a clear bearish candle or strong rejection from that area.`;
    mainWarning = `Do not sell after price has already dropped. Wait for resistance around ${sellPriceText} or a fresh breakdown-and-hold before considering a sell.`;
    coachVerdict = `The cleaner plan is to look for sells only after price rejects resistance around ${sellPriceText}.`;
  } else if (biasGroup === "range_bullish") {
    quickVerdict = `No clean trend yet, but buyers have pressure. Buy only if price drops to support around ${initialSupportText} and holds.`;
    whatThisMeans = `Price is still inside the main range, so support around ${initialSupportText} and resistance around ${initialResistanceText} are the key areas for now.`;
    bestAreaToWatch = `Buy only if price drops to support around ${initialSupportText} and holds. Sell only if price rises to resistance around ${initialResistanceText} and rejects.`;
    mainWarning = `The market has not fully opened up yet. Do not chase; wait for support around ${initialSupportText} or resistance around ${initialResistanceText}.`;
    coachVerdict = `For now, treat this as a range with bullish pressure until price clearly closes above ${initialResistanceText} or below ${initialSupportText}.`;
  } else if (biasGroup === "range_bearish") {
    quickVerdict = `No clean trend yet, but sellers have pressure. Sell only if price rises to resistance around ${initialResistanceText} and rejects.`;
    whatThisMeans = `Price is still inside the main range, so support around ${initialSupportText} and resistance around ${initialResistanceText} are the key areas for now.`;
    bestAreaToWatch = `Buy only if price drops to support around ${initialSupportText} and holds. Sell only if price rises to resistance around ${initialResistanceText} and rejects.`;
    mainWarning = `The market has not fully opened up yet. Do not chase; wait for support around ${initialSupportText} or resistance around ${initialResistanceText}.`;
    coachVerdict = `For now, treat this as a range with bearish pressure until price clearly closes below ${initialSupportText} or above ${initialResistanceText}.`;
  }

  return {
    biasGroup,
    useInitialRangeOnly,
    initialRangeStatus: initialStatus,
    initialSupport: initial.support,
    initialResistance: initial.resistance,
    initialSupportText,
    initialResistanceText,
    buyArea,
    sellArea,
    quickVerdict,
    whatThisMeans,
    bestAreaToWatch,
    mainWarning,
    coachVerdict,
    preferredTrendSetup,
  };
}

function buildDeterministicCsaAnalysis({ marketReference, dateDecision, chartDetection, visualReview = null, submittedInstrument, normalizedSymbol, timeframe }) {
  const profile = marketReference?.profile || getSupportedCsaTimeframeProfile(timeframe);

  if (!marketReference || !marketReference.ok) {
    return `COACH VERDICT

Quick Verdict:
- I could not review this chart properly because the market data was not available.

Market Direction:
- Not enough data to judge the bigger-picture direction.

What This Means:
- Check that the selected instrument, timeframe, and date are correct, then run the review again.

Overall Setup Score:
- 0/10`;
  }

  const levels = marketReference.dailyLevels || [];
  const areas = marketReference.csaAreas || [];
  const bias = marketReference.directionalBias || calculateCsaDirectionalBias(levels, normalizedSymbol, profile);
  const { resistanceAreas, supportAreas, supplyAreas, demandAreas } = splitAreas(areas);
  const failedAreas = buildFailedAreas({ supportAreas, resistanceAreas, supplyAreas, demandAreas, levels, symbol: normalizedSymbol });
  const trendPlan = buildBeginnerTrendPlan({ levels, areas, bias, symbol: normalizedSymbol, profile });

  const overallScore =
    Number.isFinite(Number(visualReview?.setupQualityScore)) && Number(visualReview.setupQualityScore) >= 20
      ? Math.max(1, Math.round(Number(visualReview.setupQualityScore) / 10))
      : failedAreas.length
      ? 5
      : String(bias.biasCode || "").includes("range")
      ? 6
      : 7;

  const directionSummary = visualReview?.plainMarketDirection
    ? visualReview.plainMarketDirection
    : visualReview?.shortTermDirection && visualReview.shortTermDirection !== "unclear"
    ? `The bigger picture is ${String(bias.bias || "").toLowerCase()}, while the ${timeframe} chart is ${visualReview.shortTermDirection}.`
    : `The bigger picture is ${String(bias.bias || "").toLowerCase()}. The ${timeframe} chart direction is not clear enough to judge.`;

  const quickVerdict = trendPlan.quickVerdict;

  const whatThisMeans = trendPlan.whatThisMeans;

  const bestAreaToWatch = trendPlan.bestAreaToWatch;

  const mainWarning =
    failedAreas.length
      ? "One or more key areas failed to hold, so do not keep trusting them without a fresh confirmation."
      : trendPlan.mainWarning;

  const coachVerdict = trendPlan.coachVerdict;

  const supportText = listAreas([...supportAreas, ...demandAreas], "support area", 3);
  const resistanceText = listAreas([...resistanceAreas, ...supplyAreas], "resistance area", 3);

  return `COACH VERDICT

Quick Verdict:
- ${quickVerdict}

Market Direction:
- ${directionSummary}

What This Means:
- ${whatThisMeans}

Best Area To Watch:
- ${bestAreaToWatch}

Preferred Trend Setup:
- ${trendPlan.preferredTrendSetup || "The preferred trend setup is breakout, pullback, and retest."}

Entry Confirmation:
- ${visualReview?.entryEvidence || (chartDetection?.visibleTrigger ? `A possible confirmation is visible: ${chartDetection.visibleTrigger}` : "No clear entry confirmation is visible yet.")}

Stop Loss And Target:
- ${visualReview?.riskEvidence || "No visible entry, stop loss, or target to judge. A good trade idea should show where the risk is and where the target is."}

Main Warning:
- ${mainWarning}

Coach Verdict:
- ${coachVerdict}

Overall Setup Score:
- ${overallScore}/10

READ_MORE_DETAILS:

Bigger Picture:
- ${bias.higherTimeframeView || bias.reason}
- Range position guide: ${bias.rangePositionNote || "Not available."}

Trend Trading Plan:
- Main support to watch: ${trendPlan.initialSupportText}
- Main resistance to watch: ${trendPlan.initialResistanceText}
- Buy plan: wait for price to drop to support around ${trendPlan.initialSupportText} and hold before considering a buy.
- Sell plan: wait for price to rise to resistance around ${trendPlan.initialResistanceText} and reject before considering a sell.

Uploaded Chart:
- ${visualReview?.visualSummary || "The uploaded chart was reviewed using the main support and resistance areas."}
- ${visualReview?.timeframeSummary || "Short-term direction was not clear enough to judge."}

Key Areas To Watch:
Support areas:
${supportText}

Resistance areas:
${resistanceText}

Trade Management:
- If already in a trade, protect the position when price reaches the first trouble area.
- If price does not move away cleanly from entry, reduce risk or wait for a better setup.

Review Details:
- Selected instrument: ${submittedInstrument}
- Selected timeframe: ${timeframe}
- Final date used: ${dateDecision?.finalDateText || "Not provided"}
- Latest visible chart date: ${chartDetection?.latestVisibleDate || "Not detected"}
- Chart data quality: ${chartDetection?.chartDataQuality || "unclear"}
- Reviewed high: ${formatPrice(bias.periodHigh)}
- Reviewed low: ${formatPrice(bias.periodLow)}
- Higher closes: ${bias.risingCloses ?? "N/A"}
- Lower closes: ${bias.fallingCloses ?? "N/A"}
- Direction confidence: ${bias.confidence}

Failed Areas:
${listFailedAreas(failedAreas)}

Technical Structure Summary:
${buildSimpleStructureBreakdown(levels, normalizedSymbol)}`;
}

function buildInvalidChartAnalysis({ submittedInstrument, timeframe, chartDetection }) {
  return `Invalid Chart Upload\n\nSelected:\n- Instrument: ${submittedInstrument || "Not provided"}\n- Timeframe: ${timeframe || "Not provided"}\n\nReason: ${chartDetection?.chartValidityReason || "The uploaded image could not be verified as a trading chart."}`;
}
function buildInsufficientChartDataAnalysis({ submittedInstrument, timeframe, selectedDateText, chartDetection }) {
  return `Insufficient Chart Data\n\nThe uploaded image appears to be a trading chart, but it does not show enough usable visible price data for CSA Coach to review the setup.\n\nSelected:\n- Instrument: ${submittedInstrument || "Not provided"}\n- Timeframe: ${timeframe || "Not provided"}\n- Selected chart/trade date: ${selectedDateText || "Not provided"}\n\nAI image check:\n- Chart data quality: ${chartDetection?.chartDataQuality || "unclear"}\n- Visible candle count: ${chartDetection?.visibleCandleCount ?? "Not detected"}\n- Reason: ${chartDetection?.insufficientDataReason || "The chart does not show enough usable price movement."}`;
}
function buildDateMismatchAnalysis({ selectedDateText, chartDetection, dateMismatch }) {
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
    strengths: ["Chart context validation was completed before the review was stopped."],
    weaknesses: [error, chartDetection?.insufficientDataReason || chartDetection?.chartValidityReason || "Analysis stopped."],
    contextCheck: { selectedInstrument: submittedInstrument || "Not provided", selectedTimeframe: timeframe || "Not provided", detectedInstrument: chartDetection?.detectedInstrument || "Not detected", detectedTimeframe: chartDetection?.detectedTimeframe || "Not detected", detectedLatestVisibleDate: chartDetection?.latestVisibleDate || "Not detected", status: "Analysis stopped", structureUsed: selectedTimeframeProfile?.structureLabel || "Not available", chartValidation: chartDetection?.isTradingChart ? "Valid trading chart" : "Invalid or unverified chart", chartDataQuality: chartDetection?.chartDataQuality || "unclear", visibleCandleCount: chartDetection?.visibleCandleCount || 0, visualFrameworkMatch: "Not reviewed", visualChartStyle: "Not reviewed", csaLevelVisibility: "Not reviewed" },
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
    success: false, errorType, error, analysis, summary: analysis, selectedPair: submittedInstrument, selectedTimeframe: timeframe,
    detectedPair: chartDetection?.detectedInstrument || "Not detected", detectedTimeframe: chartDetection?.detectedTimeframe || "Not detected", detectedLatestVisibleDate: chartDetection?.latestVisibleDate || "Not detected",
    contextStatus: "Analysis stopped before market-data-backed CSA feedback was generated.", grade: "--", confidence: 0, structureScore: 0, executionScore: 0, riskScore: 0,
    ...stoppedDashboard,
    coachAdvice: [analysis], journalTags: [errorType, "analysis-stopped"], chartDetection, visualReview: null,
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

    const chartDetection = await detectChartContextFromImage({ imageBase64, mimeType, submittedInstrument, selectedTimeframe: timeframe, selectedDateText: chartDate || tradeDate || "", analysisType: mode });

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
      const analysis = buildDateMismatchAnalysis({ selectedDateText: chartDate || tradeDate || "", chartDetection, dateMismatch });
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
    const visualReview = await compareUploadedChartWithCsaFramework({ imageBase64, mimeType, marketReference, chartDetection, submittedInstrument, timeframe, analysisType: mode, submittedNotes });
    const analysis = buildDeterministicCsaAnalysis({ marketReference, dateDecision, chartDetection, visualReview, submittedInstrument, normalizedSymbol, timeframe });
    const bias = marketReference.directionalBias || calculateCsaDirectionalBias([], normalizedSymbol, selectedTimeframeProfile);
    const setupScoreMatch = String(analysis).match(/Overall Setup Score:\s*\n- (\d+)\/10/i);
    const setupScore = setupScoreMatch ? Number(setupScoreMatch[1]) : 0;

    const dashboardFeedback = buildDashboardFeedback({ marketReference, chartDetection, visualReview, submittedInstrument, timeframe, selectedDateText: chartDate || tradeDate || "Not provided", detectedDateText: chartDetection.latestVisibleDate || "Not detected", setupScore });
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
      contextStatus: marketReference.ok ? `Market-data-backed CSA setup review completed using ${structureLabel} and visual chart comparison.` : `Setup review completed without market data: ${marketReference.error}`,
      grade: dashboardFeedback.setupQualityScore >= 85 ? "A" : dashboardFeedback.setupQualityScore >= 75 ? "B" : dashboardFeedback.setupQualityScore >= 60 ? "C" : dashboardFeedback.setupQualityScore >= 40 ? "D" : "F",
      confidence: dashboardFeedback.setupQualityScore,
      structureScore: dashboardFeedback.scores.setupQuality,
      executionScore: dashboardFeedback.scores.entryAccuracy,
      riskScore: dashboardFeedback.scores.riskManagement,
      ...dashboardAliases,
      coachAdvice: [analysis],
      journalTags: ["setup review", "directional bias", "entry area", "visual csa comparison", "uploaded chart comparison", "risk reward", marketReference.profile?.selectedTimeframe || selectedTimeframeProfile.selectedTimeframe, marketReference.profile?.structureMode || selectedTimeframeProfile.structureMode, marketReference.ok ? "market-data-backed" : "vision-only fallback", visualReview?.frameworkMatch || "visual-not-reviewed", bias.biasCode || "bias-unavailable"],
      visualReview,
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
