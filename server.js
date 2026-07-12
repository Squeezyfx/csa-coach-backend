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
  const useFull = normalizeAnalysisType(analysisType) === "post-trade";
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
  if (!Array.isArray(levels) || levels.length < 2) return { bias: "Insufficient data", biasCode: "insufficient", confidence: "low", reason: `At least two ${profile.sourceUnitPlural} are needed.`, periodStartPrice: null, presentPrice: null, periodHigh: null, periodLow: null };
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
    bias,
    biasCode,
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
  const levelLines = levels.slice(0, 12).map((level) => `- ${level.periodLabel || level.day || level.key || level.date}: open ${formatPrice(level.open)}, high ${formatPrice(level.high)}, low ${formatPrice(level.low)}, close ${formatPrice(level.close)}`);
  const areaLines = areas.slice(0, 20).map((area) => `- ${area.day || area.period || area.date}: ${area.type} at ${area.priceText || formatPrice(area.price)}`);
  return [
    `CSA structure mode: ${profile.structureLabel || "Not available"}`,
    `Structure range: ${marketReference?.weekRange ? `${marketReference.weekRange.startDate} to ${marketReference.weekRange.endDate}` : "Not available"}`,
    `Directional bias: ${bias.bias || "Not available"} (${bias.confidence || "low"} confidence)`,
    "",
    "CSA OHLC levels:",
    levelLines.length ? levelLines.join("\n") : "- No levels available.",
    "",
    "CSA areas:",
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
  if (!marketReference?.ok) return visualFallback("CSA market structure was unavailable, so visual comparison could not be completed.");
  if (!imageBase64) return visualFallback("Uploaded chart image was not available for visual comparison.");

  const prompt = `
You are CSA Coach's visual framework comparison assistant.
Return ONLY valid JSON. Do not use markdown.

Compare the uploaded chart image against the CSA framework below.

Critical rules:
- The chart has already passed basic validation. Do NOT return "insufficient chart data" unless the image is truly blank.
- Do not give generic feedback.
- Do not invent entries, stop loss, or targets if they are not visible.
- If no entry/SL/TP is visible, say "No visible entry/SL/TP to judge" rather than giving risk mistakes.
- Compare visible markings with CSA: horizontal levels, trendlines/channels, indicators, marked zones, arrows, circles, entry/SL/TP, and whether CSA levels are visible.
- Two different looking charts must receive different chartSpecificStrengths, chartSpecificWeaknesses, simpleMistakeHub, and scores.
- The simpleMistakeHub must only include short chart-specific mistake titles with tags.

CSA framework:
${buildCsaFrameworkSummaryForVision(marketReference)}

Selected context:
- Instrument: ${submittedInstrument}
- Timeframe: ${timeframe}
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
  "visualChartStyle": "horizontal CSA levels | trendline/channel based | indicator based | clean price action | mixed | unclear",
  "csaLevelVisibility": "clear | partial | not marked | unclear",
  "visualSummary": "2-4 sentences comparing this exact uploaded chart to CSA",
  "chartMarkupAssessment": "short assessment of visible drawings/markings",
  "entryEvidence": "what entry evidence is visible, or 'No visible entry evidence'",
  "riskEvidence": "what SL/TP/risk evidence is visible, or 'No visible SL/TP evidence'",
  "chartSpecificStrengths": ["specific strength visible on this chart"],
  "chartSpecificWeaknesses": ["specific weakness visible on this chart"],
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
          { type: "input_text", text: "Compare this uploaded chart visually against the CSA framework. Return only the required JSON." },
          { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}` },
        ]},
      ],
      max_output_tokens: 1200,
    });

    const parsed = extractJsonObject(response.output_text || "");
    if (!parsed || isBadVisualReview(parsed)) return visualFallback("Visual comparison was inconclusive, so CSA framework fallback was used.");

    return {
      ok: true,
      frameworkMatch: parsed.frameworkMatch || "not enough evidence",
      visualChartStyle: parsed.visualChartStyle || "unclear",
      csaLevelVisibility: parsed.csaLevelVisibility || "unclear",
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
    console.error("Visual CSA comparison error:", error);
    return visualFallback(`Visual CSA comparison failed: ${error.message}`);
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
  const mixedBias = String(bias?.biasCode || "").toLowerCase() === "mixed" || String(bias?.bias || "").toLowerCase().includes("mixed");
  const marketOk = Boolean(marketReference?.ok);
  const visualOk = Boolean(visualReview?.ok);

  const frameworkStrengths = [];
  const frameworkWeaknesses = [];
  if (marketOk) {
    frameworkStrengths.push(`CSA structure calculated: ${profile.structureLabel}.`);
    frameworkStrengths.push(`${levels.length} ${profile.sourceUnitPlural} were reviewed from market data.`);
    frameworkStrengths.push(`Framework bias: ${bias.bias}.`);
  } else frameworkWeaknesses.push(marketReference?.error || "Market data unavailable.");

  if (chartDetection?.hasUsablePriceData) frameworkStrengths.push("Uploaded chart contains usable visible price data.");
  if (!hasConfirmedTrigger) frameworkWeaknesses.push("No confirmed entry trigger was detected automatically on the uploaded chart.");
  failedAreas.forEach((area) => frameworkWeaknesses.push(area.explanation));
  if (mixedBias) frameworkWeaknesses.push("Directional bias is mixed; avoid middle-of-range entries.");

  const visualStrengths = visualOk ? normalizeArrayOfStrings(visualReview.chartSpecificStrengths, []) : [];
  const visualWeaknesses = visualOk ? normalizeArrayOfStrings(visualReview.chartSpecificWeaknesses, []) : [];
  const strengths = [...visualStrengths, ...frameworkStrengths].filter(Boolean);
  const weaknesses = [...visualWeaknesses, ...frameworkWeaknesses].filter(Boolean);

  const baseSetupQualityScore = clampScore((setupScore || 0) * 10 - failedAreas.length * 8 - (mixedBias ? 12 : 0) + (marketOk ? 5 : -20));
  const baseEntryAccuracyScore = clampScore(65 + (hasConfirmedTrigger ? 15 : -10) - failedAreas.length * 10 - (mixedBias ? 8 : 0));
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
    status: marketOk ? "Matched and reviewed" : "Review limited",
    structureUsed: profile.structureLabel,
    rangeUsed: marketReference?.weekRange ? `${marketReference.weekRange.startDate} to ${marketReference.weekRange.endDate}` : "Not available",
    chartValidation: chartDetection?.isTradingChart ? "Valid trading chart" : "Invalid or unverified chart",
    chartDataQuality: chartDetection?.chartDataQuality || "unclear",
    visibleCandleCount: chartDetection?.visibleCandleCount || 0,
    visualFrameworkMatch: visualReview?.frameworkMatch || "Not reviewed",
    visualChartStyle: visualReview?.visualChartStyle || "Not reviewed",
    csaLevelVisibility: visualReview?.csaLevelVisibility || "Not reviewed",
  };

  const visualMistakes = visualOk ? normalizeVisualMistakeItems(visualReview.simpleMistakeHub) : [];
  const frameworkMistakes = buildFrameworkMistakeHub({ failedAreas, hasConfirmedTrigger, rejectedContext, mixedBias, marketOk, entryAccuracyScore: baseEntryAccuracyScore, riskManagementScore: baseRiskManagementScore });
  const aiMistakeDetectionHub = visualMistakes.length ? visualMistakes : frameworkMistakes;

  const setupQuality = { score: setupQualityScore, label: scoreLabel(setupQualityScore), summary: visualOk && visualReview.visualSummary ? visualReview.visualSummary : "Setup quality is based on CSA structure, failed areas, and chart context." };
  const entryAccuracy = { score: entryAccuracyScore, label: scoreLabel(entryAccuracyScore), summary: visualOk && visualReview.entryEvidence ? visualReview.entryEvidence : "Entry accuracy depends on visible confirmation at the CSA area." };
  const riskManagement = { score: riskManagementScore, label: scoreLabel(riskManagementScore), summary: visualOk && visualReview.riskEvidence ? visualReview.riskEvidence : "Risk score checks visible stop/target evidence and failed area risk." };

  return {
    strengths: strengths.length ? strengths.slice(0, 7) : ["CSA Coach completed the review."],
    weaknesses: weaknesses.length ? weaknesses.slice(0, 7) : ["No major weakness detected from the available CSA structure data."],
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

function buildDeterministicCsaAnalysis({ marketReference, dateDecision, chartDetection, visualReview = null, submittedInstrument, normalizedSymbol, timeframe }) {
  const profile = marketReference?.profile || getSupportedCsaTimeframeProfile(timeframe);
  if (!marketReference || !marketReference.ok) return `CSA COACH VERDICT\n\nDirectional Bias:\n- Insufficient data\n- Reason: ${marketReference?.error || "Market data unavailable."}\n\nOverall Setup Score:\n- 0/10`;
  const levels = marketReference.dailyLevels || [];
  const areas = marketReference.csaAreas || [];
  const bias = marketReference.directionalBias || calculateCsaDirectionalBias(levels, normalizedSymbol, profile);
  const { resistanceAreas, supportAreas, supplyAreas, demandAreas } = splitAreas(areas);
  const failedAreas = buildFailedAreas({ supportAreas, resistanceAreas, supplyAreas, demandAreas, levels, symbol: normalizedSymbol });
  const overallScore = Number.isFinite(Number(visualReview?.setupQualityScore)) && Number(visualReview.setupQualityScore) >= 20 ? Math.max(1, Math.round(Number(visualReview.setupQualityScore) / 10)) : (failedAreas.length ? 5 : bias.biasCode === "mixed" ? 6 : 7);

  return `CSA COACH VERDICT

CSA Structure Used:
- ${profile.structureLabel}

Directional Bias:
- ${bias.bias}
- Reason: ${bias.reason}

VISUAL CSA FRAMEWORK COMPARISON:
- Framework match: ${visualReview?.frameworkMatch || "Not reviewed"}
- Visible chart style: ${visualReview?.visualChartStyle || "Not reviewed"}
- CSA level visibility: ${visualReview?.csaLevelVisibility || "Not reviewed"}
- Visual summary: ${visualReview?.visualSummary || "Visual comparison was not available."}
- Chart markings: ${visualReview?.chartMarkupAssessment || "Not reviewed."}
- Entry evidence: ${visualReview?.entryEvidence || "Not reviewed."}
- Risk evidence: ${visualReview?.riskEvidence || "Not reviewed."}

Best Entry Area:
- Use the valid CSA area that aligns with the framework bias and is actually visible/relevant on the uploaded chart.

Entry Trigger:
- ${chartDetection?.visibleTrigger ? `Visible confirmed trigger: ${chartDetection.visibleTrigger}` : "No confirmed entry trigger is visible yet. Do not treat bounce/pullback as confirmation."}

Stop Loss Placement:
- Place stop beyond the trigger candle/pattern and beyond the CSA area. If no SL is visible on the uploaded chart, risk cannot be fully judged.

Take Profit Placement:
- Use previous CSA structural areas as targets. If no TP is visible on the uploaded chart, target quality cannot be fully judged.

Risk-to-Reward:
- Minimum 1:2. Skip the setup if TP1 is too close or if SL/TP is not visible enough to judge.

Trade Management:
- Partial close at TP1, breakeven after strong reaction, trail behind structure.

Coach Verdict:
- ${visualReview?.visualSummary || "CSA review completed using market structure and uploaded chart context."}
- These are coaching guidelines only, not buy/sell signals.

Overall Setup Score:
- ${overallScore}/10

READ_MORE_DETAILS:

Final date used: ${dateDecision?.finalDateText || "Not provided"}
Selected instrument: ${submittedInstrument}
Selected timeframe: ${timeframe}
Latest visible chart date: ${chartDetection?.latestVisibleDate || "Not detected"}
Chart data quality: ${chartDetection?.chartDataQuality || "unclear"}

CSA Bias Calculation:
- ${profile.startPriceLabel}: ${formatPrice(bias.periodStartPrice)}
- ${profile.currentPriceLabel}: ${formatPrice(bias.presentPrice)}
- Highest price: ${formatPrice(bias.periodHigh)}
- Lowest price: ${formatPrice(bias.periodLow)}
- Bias confidence: ${bias.confidence}

Resistance:
${listAreas(resistanceAreas, "resistance")}

Support:
${listAreas(supportAreas, "support")}

Supply:
${listAreas(supplyAreas, "supply")}

Demand:
${listAreas(demandAreas, "demand")}

Failed CSA Areas:
${listFailedAreas(failedAreas)}

${profile.breakdownTitle}:
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
