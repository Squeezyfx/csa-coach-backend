import express from "express";
import cors from "cors";
import multer from "multer";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TWELVE_URL = "https://api.twelvedata.com/time_series";

const CHART_PROMPT = `
You are CSA Coach's chart screenshot validator. Return ONLY valid JSON.
A valid chart must show visible candles/bars/line movement, price scale, and time/date axis.
A platform screenshot alone is not enough.
Invalid: photos, documents, logos, blank/loading charts, cropped/blurred charts, or charts with fewer than about 20 visible candles/bars/points.

Important selected-date rule:
If a selected chart/trade date is provided and it is later than the latest visible date on the chart, selectedDateVisible must be false.
Example: selected date 2026-07-10 but latest visible chart date around 2026-06-11 means selectedDateVisible=false and latestVisibleDate=2026-06-11 if readable.
Always estimate latestVisibleDate from the bottom time axis when possible.
Twelve Data must not replace a blank, unclear, or wrong-date uploaded chart.

Entry trigger: only return visibleTrigger if there is a real confirmation like engulfing, pin bar, hammer, doji rejection, inside bar break, lower high/higher low, breakout/breakdown, flag/channel/triangle break, head and shoulders, Quasimodo, or clean break-and-hold. Bounce/pullback/reaction/consolidation alone is not a trigger.

Return exactly:
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

const CONFIRMED = ["engulfing", "pin bar", "pinbar", "hammer", "doji", "inside bar", "lower high", "higher low", "breakout", "breakdown", "break-and-hold", "break and hold", "head and shoulders", "quasimodo", "channel", "flag", "triangle", "rejection"];
const CONTEXT_ONLY = ["bounce", "pullback", "retracement", "retrace", "consolidation", "reaction", "range", "ranging", "moving away"];

function normSym(v = "") {
  const raw = String(v).trim().toUpperCase().replace(/\s+/g, "");
  const map = { EURUSD: "EUR/USD", GBPUSD: "GBP/USD", USDJPY: "USD/JPY", USDCHF: "USD/CHF", USDCAD: "USD/CAD", AUDUSD: "AUD/USD", NZDUSD: "NZD/USD", EURCHF: "EUR/CHF", EURGBP: "EUR/GBP", GBPJPY: "GBP/JPY", XAUUSD: "XAU/USD", GOLD: "XAU/USD", BTCUSD: "BTC/USD", BTCUSDT: "BTC/USD" };
  if (map[raw]) return map[raw];
  if (raw.includes("/")) return raw;
  if (raw.length === 6) return `${raw.slice(0, 3)}/${raw.slice(3)}`;
  return raw;
}
function cmpSym(v = "") {
  const raw = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.includes("GOLD")) return "XAUUSD";
  if (raw.includes("BTCUSDT")) return "BTCUSD";
  return ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD", "EURCHF", "EURGBP", "GBPJPY", "XAUUSD", "BTCUSD"].find((s) => raw.includes(s)) || normSym(raw).replace(/[^A-Z0-9]/g, "");
}
function cmpTf(v = "") {
  const raw = String(v).trim().toUpperCase().replace(/\s+/g, "");
  const c = raw.replace(/[^A-Z0-9]/g, "");
  const m = { "1": "M1", "1M": "M1", M1: "M1", "1MIN": "M1", "5": "M5", "5M": "M5", M5: "M5", "5MIN": "M5", "15": "M15", "15M": "M15", M15: "M15", "15MIN": "M15", "30": "M30", "30M": "M30", M30: "M30", "30MIN": "M30", "60": "H1", "60M": "H1", "1H": "H1", H1: "H1", "240": "H4", "240M": "H4", "4H": "H4", H4: "H4", D: "D1", "1D": "D1", D1: "D1", DAILY: "D1", W: "W1", "1W": "W1", W1: "W1", WEEKLY: "W1", MN: "MN", MTH: "MN", MONTH: "MN", MONTHLY: "MN", "1MO": "MN", "1MONTH": "MN" };
  return m[raw] || m[c] || c || "";
}
function interval(v = "") {
  return { M1: "1min", M5: "5min", M15: "15min", M30: "30min", H1: "1h", H4: "4h", D1: "1day", W1: "1week", MN: "1month" }[cmpTf(v)] || "1h";
}
function mode(v = "") {
  return String(v).toLowerCase().includes("pre") ? "pre-trade" : "post-trade";
}
function parseDate(v) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function price(v) { const n = Number(v); if (!Number.isFinite(n)) return "N/A"; if (Math.abs(n) >= 1000) return n.toFixed(2); if (Math.abs(n) >= 100) return n.toFixed(3); if (Math.abs(n) >= 10) return n.toFixed(4); return n.toFixed(5); }
function stripJson(s = "") { return String(s).replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim(); }
function parseJson(s = "") { try { return JSON.parse(stripJson(s)); } catch {} const m = stripJson(s).match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } }
function tolerance(sym) { const s = cmpSym(sym); if (s.includes("JPY")) return 0.02; if (s.includes("XAU")) return 0.2; if (s.includes("BTC")) return 20; return 0.0002; }

function profile(tf = "H1") {
  const t = cmpTf(tf) || "H1";
  if (["M1", "M5", "M15", "M30", "H1"].includes(t)) return { tf: t, interval: interval(t), mode: "daily-week", label: "Daily highs/lows inside the selected Monday-to-Friday week", unit: "daily levels", rangeKind: "week" };
  if (t === "H4") return { tf: t, interval: "4h", mode: "weekly-month", label: "Weekly highs/lows inside the selected calendar month", unit: "weekly levels", rangeKind: "month" };
  if (t === "D1") return { tf: t, interval: "1day", mode: "monthly-year", label: "Monthly highs/lows inside the selected calendar year", unit: "monthly levels", rangeKind: "year" };
  if (t === "W1") return { tf: t, interval: "1week", mode: "quarterly-year", label: "Quarterly highs/lows inside the selected calendar year", unit: "quarterly levels", rangeKind: "year" };
  if (t === "MN") return { tf: t, interval: "1month", mode: "yearly-multi", label: "Yearly highs/lows across selected year plus previous 4 years", unit: "yearly levels", rangeKind: "multi-year range" };
  return profile("H1");
}
function rangeFor(date, p, analysisMode) {
  const full = analysisMode === "post-trade";
  if (p.mode === "daily-week") { const day = date.getUTCDay(); const mon = addDays(date, day === 0 ? -6 : 1 - day); const fri = addDays(mon, 4); const end = full ? fri : (date < fri ? date : fri); return { startDate: fmtDate(mon), endDate: fmtDate(end), finalDate: fmtDate(fri) }; }
  if (p.mode === "weekly-month") { const y = date.getUTCFullYear(), m = date.getUTCMonth(); const start = new Date(Date.UTC(y, m, 1)); const last = new Date(Date.UTC(y, m + 1, 0)); const end = full ? last : (date < last ? date : last); return { startDate: fmtDate(start), endDate: fmtDate(end), finalDate: fmtDate(last) }; }
  if (["monthly-year", "quarterly-year"].includes(p.mode)) { const y = date.getUTCFullYear(); const start = new Date(Date.UTC(y, 0, 1)); const last = new Date(Date.UTC(y, 11, 31)); const end = full ? last : (date < last ? date : last); return { startDate: fmtDate(start), endDate: fmtDate(end), finalDate: fmtDate(last) }; }
  const y = date.getUTCFullYear(); const start = new Date(Date.UTC(y - 4, 0, 1)); const last = new Date(Date.UTC(y, 11, 31)); const end = full ? last : (date < last ? date : last); return { startDate: fmtDate(start), endDate: fmtDate(end), finalDate: fmtDate(last) };
}
function periodKey(date, p) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth();
  if (p.mode === "daily-week") return { key: fmtDate(date), label: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date), date: fmtDate(date) };
  if (p.mode === "weekly-month") { const first = new Date(Date.UTC(y, m, 1)); const wk = Math.ceil((date.getUTCDate() + first.getUTCDay()) / 7); return { key: `${y}-${String(m + 1).padStart(2, "0")}-W${wk}`, label: `Week ${wk}`, date: fmtDate(date) }; }
  if (p.mode === "monthly-year") return { key: `${y}-${String(m + 1).padStart(2, "0")}`, label: new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(date), date: `${y}-${String(m + 1).padStart(2, "0")}-01` };
  if (p.mode === "quarterly-year") { const q = m <= 2 ? "Q1" : m <= 5 ? "Q2" : m <= 8 ? "Q3" : "Q4"; return { key: `${y}-${q}`, label: q, date: `${y}-${q}` }; }
  return { key: String(y), label: String(y), date: `${y}-01-01` };
}

async function detectChart({ imageBase64, mimeType, submittedInstrument, selectedTimeframe, selectedDateText, analysisType }) {
  const fallback = (reason) => ({ ok: false, isTradingChart: false, chartValidityReason: reason, hasUsablePriceData: false, visibleCandleCount: 0, chartDataQuality: "unclear", selectedDateVisible: false, insufficientDataReason: reason, detectedInstrument: null, detectedTimeframe: null, latestVisibleDate: null, dateConfidence: "low", visibleTrigger: null, rejectedTriggerContext: null, triggerDirection: null, triggerConfidence: "low", notes: reason, raw: "" });
  try {
    const r = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "system", content: CHART_PROMPT }, { role: "user", content: [{ type: "input_text", text: `Selected instrument: ${submittedInstrument}\nSelected timeframe: ${selectedTimeframe}\nSelected date: ${selectedDateText || "not provided"}\nAnalysis type: ${analysisType}\nReturn only JSON.` }, { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}` }] }],
      max_output_tokens: 700,
    });
    const x = parseJson(r.output_text || "");
    if (!x) return fallback("Chart validation did not return usable JSON.");
    const rawTrigger = x.visibleTrigger || null;
    const trigConf = x.triggerConfidence || "low";
    let trigger = rawTrigger;
    const low = String(rawTrigger || "").toLowerCase();
    if (!rawTrigger || String(trigConf).toLowerCase() === "low" || (!CONFIRMED.some(w => low.includes(w)) || CONTEXT_ONLY.some(w => low.includes(w)))) trigger = null;
    return { ok: true, isTradingChart: x.isTradingChart === true, chartValidityReason: x.chartValidityReason || "", hasUsablePriceData: x.hasUsablePriceData === true, visibleCandleCount: Number(x.visibleCandleCount || 0), chartDataQuality: x.chartDataQuality || "unclear", selectedDateVisible: x.selectedDateVisible === true, insufficientDataReason: x.insufficientDataReason || null, detectedInstrument: x.detectedInstrument || null, detectedTimeframe: x.detectedTimeframe || null, latestVisibleDate: x.latestVisibleDate || null, dateConfidence: x.dateConfidence || "low", visibleTrigger: trigger, rejectedTriggerContext: rawTrigger && !trigger ? rawTrigger : null, triggerDirection: trigger ? x.triggerDirection || null : null, triggerConfidence: trigger ? trigConf : "low", notes: x.notes || "", raw: r.output_text || "" };
  } catch (e) { return fallback(`Chart validation failed: ${e.message}`); }
}
function uploadedChartUsable(d, selectedDateText) { if (!d?.isTradingChart) return false; if (d.hasUsablePriceData !== true) return false; if (["blank", "insufficient", "unclear"].includes(String(d.chartDataQuality || "").toLowerCase())) return false; if (Number(d.visibleCandleCount || 0) > 0 && Number(d.visibleCandleCount) < 20) return false; if (selectedDateText && d.selectedDateVisible === false) return false; return true; }
function daysBetween(a, b) { return Math.round((Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) / 86400000); }
function allowedGap(tf) { const t = cmpTf(tf); if (["M1", "M5", "M15", "M30", "H1"].includes(t)) return 2; if (t === "H4") return 7; if (t === "D1") return 31; if (t === "W1") return 92; if (t === "MN") return 370; return 2; }
function dateMismatch(det, selectedDate, tf) { if (!selectedDate || !det?.latestVisibleDate) return { hasMismatch: false }; const latest = parseDate(det.latestVisibleDate); if (!latest) return { hasMismatch: false }; const gap = daysBetween(latest, selectedDate); const allowed = allowedGap(tf); const conf = String(det.dateConfidence || "low").toLowerCase(); const hasMismatch = ["high", "medium"].includes(conf) && gap > allowed; return { hasMismatch, latestVisibleDateText: fmtDate(latest), selectedDateText: fmtDate(selectedDate), daysAfterLatestVisible: gap, allowedGapDays: allowed, dateConfidence: conf, reason: hasMismatch ? `Selected date is ${gap} day(s) after latest visible date; allowed gap is ${allowed}.` : "Selected date is not clearly beyond the latest visible chart date." }; }
function chooseDate(selectedDate, det, analysisMode) { const latest = det?.latestVisibleDate && ["high", "medium"].includes(String(det.dateConfidence || "").toLowerCase()) ? parseDate(det.latestVisibleDate) : null; if (selectedDate) return { finalDate: selectedDate, finalDateText: fmtDate(selectedDate), selectedDateText: fmtDate(selectedDate), detectedDateText: latest ? fmtDate(latest) : null, source: `${analysisMode}-user-selected-date`, reason: "User-selected chart/trade date used." }; if (latest) return { finalDate: latest, finalDateText: fmtDate(latest), selectedDateText: null, detectedDateText: fmtDate(latest), source: "chart-detected-date", reason: "Latest visible chart date used." }; return { finalDate: null, finalDateText: "Not provided", selectedDateText: null, detectedDateText: null, source: "missing-date", reason: "No usable date." }; }

async function marketData(symbol, finalDate, tf, timezone, analysisMode) {
  const p = profile(tf);
  const empty = (error) => ({ ok: false, error, symbol, timezone, interval: p.interval, profile: p, dailyLevels: [], csaAreas: [], directionalBias: { bias: "Insufficient data", biasCode: "insufficient", confidence: "low", reason: error }, rawCandleCount: 0, weekRange: null });
  if (!process.env.TWELVE_DATA_API_KEY) return empty("TWELVE_DATA_API_KEY is missing on the server.");
  if (!finalDate) return empty("Final chart date is missing.");
  const range = rangeFor(finalDate, p, analysisMode);
  const q = new URLSearchParams({ symbol, interval: p.interval, start_date: `${range.startDate} 00:00:00`, end_date: `${range.endDate} 23:59:59`, timezone, order: "ASC", outputsize: "5000", apikey: process.env.TWELVE_DATA_API_KEY });
  const resp = await fetch(`${TWELVE_URL}?${q}`);
  const data = await resp.json();
  if (!resp.ok || data.status === "error" || !Array.isArray(data.values)) return { ...empty(data.message || data.error || `Twelve Data failed: ${resp.status}`), weekRange: range };
  const grouped = new Map();
  for (const bar of data.values) {
    const ds = String(bar.datetime || "").slice(0, 10); if (!ds || ds < range.startDate || ds > range.endDate) continue;
    const d = parseDate(ds); if (!d) continue;
    if (p.mode === "daily-week") { const wd = d.getUTCDay(); if (wd < 1 || wd > 5) continue; }
    const o = num(bar.open), h = num(bar.high), l = num(bar.low), c = num(bar.close); if ([o, h, l, c].some(v => v === null)) continue;
    const per = periodKey(d, p);
    if (!grouped.has(per.key)) grouped.set(per.key, { key: per.key, day: per.label, date: per.date, open: o, high: h, low: l, close: c });
    else { const x = grouped.get(per.key); x.high = Math.max(x.high, h); x.low = Math.min(x.low, l); x.close = c; }
  }
  const levels = [...grouped.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const areas = [];
  for (let i = 0; i < levels.length; i++) {
    const cur = levels[i];
    if (i === 0) { areas.push({ ...cur, type: "resistance", price: cur.high, priceText: price(cur.high) }, { ...cur, type: "support", price: cur.low, priceText: price(cur.low) }); continue; }
    const prev = levels[i - 1], tol = tolerance(symbol);
    areas.push({ ...cur, type: cur.high - prev.high > tol ? "resistance" : "supply", price: cur.high, priceText: price(cur.high) });
    areas.push({ ...cur, type: prev.low - cur.low > tol ? "support" : "demand", price: cur.low, priceText: price(cur.low) });
  }
  const first = levels[0], last = levels.at(-1); let biasCode = "mixed", bias = "Mixed / Range-bound"; let up = 0, down = 0;
  for (let i = 1; i < levels.length; i++) { if (levels[i].high > levels[i - 1].high) up++; if (levels[i].low < levels[i - 1].low) down++; }
  if (last && first && last.close > first.open && up >= down) { bias = "Bullish"; biasCode = "bullish"; }
  if (last && first && last.close < first.open && down >= up) { bias = "Bearish"; biasCode = "bearish"; }
  const directionalBias = { bias, biasCode, confidence: Math.abs(up - down) >= 2 ? "high" : "medium", periodStartPrice: first?.open ?? null, presentPrice: last?.close ?? null, periodHigh: levels.length ? Math.max(...levels.map(x => x.high)) : null, periodLow: levels.length ? Math.min(...levels.map(x => x.low)) : null, resistanceCount: up, supportCount: down, reason: `${bias} bias based on ${p.label}.` };
  return { ok: levels.length > 0, error: levels.length ? "" : `No usable ${p.unit} returned.`, symbol, timezone, interval: p.interval, profile: p, rawCandleCount: data.values.length, weekRange: range, dailyLevels: levels, csaAreas: areas, directionalBias };
}

function broken(area, levels, symbol) { const tol = tolerance(symbol), later = levels.filter(x => String(x.date) > String(area.date)); if (["resistance", "supply"].includes(area.type)) return later.some(x => x.close > area.price + tol); if (["support", "demand"].includes(area.type)) return later.some(x => x.close < area.price - tol); return false; }
function listAreas(areas, type) { const arr = areas.filter(a => a.type === type).slice(0, 4); return arr.length ? arr.map(a => `- ${a.day} ${type}: ${a.priceText}`).join("\n") : "- None identified."; }
function failedAreas(areas, levels, symbol) { return areas.filter(a => broken(a, levels, symbol)).map(a => ({ ...a, mistakeLabel: `Failed ${a.type} area`, explanation: `${a.day} ${a.type} around ${a.priceText} failed because price later closed through it.`, newRole: ["support", "demand"].includes(a.type) ? "Can become resistance if retested from below" : "Can become support if retested from above" })); }
function analysisText(mr, decision, det, selected, tf) { const p = mr.profile || profile(tf); if (!mr.ok) return `CSA COACH VERDICT\n\nDirectional Bias:\n- Insufficient data\n- Reason: ${mr.error}\n\nOverall Setup Score:\n- 0/10`; const b = mr.directionalBias, failed = failedAreas(mr.csaAreas, mr.dailyLevels, mr.symbol); const score = failed.length ? 5 : b.biasCode === "mixed" ? 6 : 7; return `CSA COACH VERDICT\n\nCSA Structure Used:\n- ${p.label}\n\nDirectional Bias:\n- ${b.bias}\n- Reason: ${b.reason}\n\nBest Entry Area:\n- Use valid CSA support/resistance or supply/demand area aligned with the bias. Do not trade a failed area unless it is reclaimed and confirms again.\n\nEntry Trigger:\n- ${det.visibleTrigger ? `Visible confirmed trigger: ${det.visibleTrigger}` : "No confirmed entry trigger is visible yet. Do not treat bounce/pullback as confirmation."}\n\nStop Loss Placement:\n- Place stop beyond the trigger candle and beyond the CSA area.\n\nTake Profit Placement:\n- Use previous structural areas as targets.\n\nRisk-to-Reward:\n- Minimum 1:2. Skip if TP1 is too close.\n\nTrade Management:\n- Partial at TP1, breakeven only after strong reaction, trail behind structure.\n\nCoach Verdict:\n- ${failed.length ? "Failed CSA area detected. Reclassify it before considering another setup." : "CSA review completed using uploaded chart context and market-data reference."}\n\nOverall Setup Score:\n- ${score}/10\n\nREAD_MORE_DETAILS:\n- Final date used: ${decision.finalDateText}\n- Selected instrument: ${selected}\n- Selected timeframe: ${tf}\n- Chart latest visible date: ${det.latestVisibleDate || "Not detected"}\n- Chart data quality: ${det.chartDataQuality}\n\nResistance:\n${listAreas(mr.csaAreas, "resistance")}\n\nSupport:\n${listAreas(mr.csaAreas, "support")}\n\nSupply:\n${listAreas(mr.csaAreas, "supply")}\n\nDemand:\n${listAreas(mr.csaAreas, "demand")}\n\nFailed CSA Areas:\n${failed.length ? failed.map(f => `- ${f.mistakeLabel}: ${f.explanation}`).join("\n") : "- None detected."}`; }
function dashboard(mr, det, selected, tf, selectedDateText, setupScore) { const failed = failedAreas(mr.csaAreas || [], mr.dailyLevels || [], mr.symbol || selected); const mistakes = []; if (!det.visibleTrigger) mistakes.push({ title: "No confirmed entry trigger", severity: "medium", detail: "No clear confirmation was detected on the uploaded chart.", correction: "Wait for a valid candlestick or pattern trigger at the CSA area." }); for (const f of failed) mistakes.push({ title: f.mistakeLabel, severity: "high", detail: f.explanation, correction: f.newRole }); const setupQualityScore = Math.max(0, Math.min(100, setupScore * 10 - failed.length * 8 + (mr.ok ? 5 : -20))); const entryAccuracyScore = Math.max(0, Math.min(100, 65 + (det.visibleTrigger ? 15 : -18) - failed.length * 10)); const riskManagementScore = Math.max(0, Math.min(100, 70 - failed.length * 8 - (!det.visibleTrigger ? 8 : 0))); const context = { selectedInstrument: selected, selectedTimeframe: tf, selectedDate: selectedDateText || "Not provided", detectedInstrument: det.detectedInstrument || "Not detected", detectedTimeframe: det.detectedTimeframe || "Not detected", detectedLatestVisibleDate: det.latestVisibleDate || "Not detected", status: mr.ok ? "Matched and reviewed" : "Review limited", structureUsed: mr.profile?.label || profile(tf).label, chartValidation: det.isTradingChart ? "Valid trading chart" : "Invalid or unverified chart", chartDataQuality: det.chartDataQuality || "unclear", visibleCandleCount: det.visibleCandleCount || 0 }; return { strengths: [mr.ok ? `CSA structure used correctly: ${mr.profile.label}.` : "Market data was unavailable.", det.hasUsablePriceData ? "Uploaded chart contains usable visible price data." : "Uploaded chart data was not usable."], weaknesses: [!det.visibleTrigger ? "No confirmed entry trigger was visible on the uploaded chart." : "No major trigger weakness detected.", ...failed.map(f => f.explanation)].slice(0, 7), chartContextCheck: context, contextCheck: context, setupQuality: { score: setupQualityScore, label: "Review", summary: "Setup quality is based on CSA structure, failed areas and chart confirmation." }, setupQualityScore, entryAccuracy: { score: entryAccuracyScore, label: "Review", summary: "Entry accuracy depends on visible confirmation at the CSA area." }, entryAccuracyScore, riskManagement: { score: riskManagementScore, label: "Review", summary: "Risk score checks stop logic and failed area risk." }, riskManagementScore, aiMistakeDetectionHub: mistakes.length ? mistakes : [{ title: "No major mistake detected", severity: "low", detail: "No failed area or obvious confirmation problem detected.", correction: "Still confirm stop and risk-to-reward." }], mistakes, failedAreas: failed, dashboard: {}, dashboardCards: {} }; }
function stopPayload({ res, errorType, error, analysis, selected, tf, det, symbol, timezone }) { const p = profile(tf); const context = { selectedInstrument: selected, selectedTimeframe: tf, detectedInstrument: det?.detectedInstrument || "Not detected", detectedTimeframe: det?.detectedTimeframe || "Not detected", detectedLatestVisibleDate: det?.latestVisibleDate || "Not detected", status: "Analysis stopped", structureUsed: p.label, chartValidation: det?.isTradingChart ? "Valid trading chart" : "Invalid or unverified chart", chartDataQuality: det?.chartDataQuality || "unclear", visibleCandleCount: det?.visibleCandleCount || 0 }; const mistake = { title: errorType, severity: "high", detail: error, correction: "Correct the upload or selected context and run analysis again." }; return res.status(200).json({ success: false, errorType, error, analysis, summary: analysis, selectedPair: selected, selectedTimeframe: tf, detectedPair: context.detectedInstrument, detectedTimeframe: context.detectedTimeframe, detectedLatestVisibleDate: context.detectedLatestVisibleDate, contextStatus: "Analysis stopped before market-data-backed feedback.", grade: "--", confidence: 0, structureScore: 0, executionScore: 0, riskScore: 0, strengths: ["Chart validation was completed before analysis stopped."], weaknesses: [error], chartContextCheck: context, contextCheck: context, setupQuality: { score: 0, label: "Stopped", summary: error }, setupQualityScore: 0, entryAccuracy: { score: 0, label: "Stopped", summary: error }, entryAccuracyScore: 0, riskManagement: { score: 0, label: "Stopped", summary: error }, riskManagementScore: 0, aiMistakeDetectionHub: [mistake], mistakes: [mistake], failedAreas: [], coachAdvice: [analysis], journalTags: [errorType, "analysis-stopped"], chartDetection: det, marketReference: { ok: false, error, symbol, timezone, interval: interval(tf), rawCandleCount: 0, dailyLevels: [], csaAreas: [], profile: p } }); }

app.get("/", (req, res) => res.json({ status: "ok", message: "CSA Coach backend is running" }));
app.get("/health", (req, res) => res.json({ ok: true, service: "csa-coach-backend", time: new Date().toISOString() }));
app.get("/test-twelve", async (req, res) => { try { const symbol = normSym(req.query.symbol || "GBP/USD"); const tf = req.query.timeframe || "H1"; const d = parseDate(req.query.date || "2026-07-15"); if (!d) return res.status(400).json({ ok: false, error: "Invalid date." }); return res.json(await marketData(symbol, d, tf, req.query.timezone || "UTC", mode(req.query.analysisType || "post-trade"))); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); } });

app.post("/analyze-chart", upload.single("chart"), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: "OPENAI_API_KEY is missing on the server." });
    if (!req.file) return res.status(400).json({ success: false, error: "No chart image uploaded." });
    const { timeframe = "Not provided", instrument = "", pair = "", selectedPair = "", analysisType = "post-trade", chartDate = "", tradeDate = "", timezone = "UTC" } = req.body;
    const selected = instrument || pair || selectedPair || "Not provided";
    const symbol = normSym(selected);
    const analysisMode = mode(analysisType);
    const selectedDateText = chartDate || tradeDate || "";
    const selectedDate = parseDate(selectedDateText);
    const det = await detectChart({ imageBase64: req.file.buffer.toString("base64"), mimeType: req.file.mimetype || "image/png", submittedInstrument: selected, selectedTimeframe: timeframe, selectedDateText, analysisType: analysisMode });
    if (!det.isTradingChart) return stopPayload({ res, errorType: "invalid_chart_image", error: "Uploaded image is not a valid trading chart.", analysis: `Invalid Chart Upload\n\n${det.chartValidityReason || "The uploaded image could not be verified as a trading chart."}`, selected, tf: timeframe, det, symbol, timezone });
    if (!uploadedChartUsable(det, selectedDateText)) return stopPayload({ res, errorType: "insufficient_chart_data", error: "Uploaded chart does not have enough visible price data for review.", analysis: `Insufficient Chart Data\n\nThe uploaded chart is not usable for review.\nReason: ${det.insufficientDataReason || "Not enough visible candles/data or selected date is not visible."}`, selected, tf: timeframe, det, symbol, timezone });
    const dm = dateMismatch(det, selectedDate, timeframe);
    if (dm.hasMismatch) return stopPayload({ res, errorType: "selected_date_not_visible", error: "Selected chart/trade date is not visible or reasonably covered by the uploaded chart.", analysis: `Selected Date Not Visible On Chart\n\nSelected date: ${selectedDateText}\nLatest visible chart date: ${dm.latestVisibleDateText}\nReason: ${dm.reason}\n\nUpload a chart where the selected date is visible, or change the selected date.`, selected, tf: timeframe, det, symbol, timezone });
    if (hasStrongInstrumentMismatch({ selectedInstrument: symbol, detectedInstrument: det.detectedInstrument })) return stopPayload({ res, errorType: "instrument_mismatch", error: "Selected instrument does not match uploaded chart.", analysis: `Chart Context Mismatch\n\nSelected: ${selected}\nDetected: ${det.detectedInstrument}`, selected, tf: timeframe, det, symbol, timezone });
    if (hasStrongTimeframeMismatch({ selectedTimeframe: timeframe, detectedTimeframe: det.detectedTimeframe })) return stopPayload({ res, errorType: "timeframe_mismatch", error: "Selected timeframe does not match uploaded chart timeframe.", analysis: `Chart Timeframe Mismatch\n\nSelected: ${timeframe}\nDetected: ${det.detectedTimeframe}`, selected, tf: timeframe, det, symbol, timezone });
    const decision = chooseDate(selectedDate, det, analysisMode);
    const mr = await marketData(symbol, decision.finalDate, timeframe, timezone || "UTC", analysisMode);
    const analysis = analysisText(mr, decision, det, selected, timeframe);
    const score = Number(String(analysis).match(/Overall Setup Score:\s*\n- (\d+)\/10/i)?.[1] || 0);
    const dash = dashboard(mr, det, selected, timeframe, selectedDateText || "Not provided", score);
    return res.json({ success: true, analysis, summary: analysis, selectedPair: selected, selectedTimeframe: timeframe, selectedDate: selectedDateText || "Not provided", analysisType: analysisMode, detectedPair: det.detectedInstrument || symbol, detectedTimeframe: det.detectedTimeframe || timeframe, detectedLatestVisibleDate: det.latestVisibleDate || "Not detected", finalDateUsed: decision.finalDateText, dateDecision: decision, csaDirectionalBias: mr.directionalBias, contextStatus: mr.ok ? `Market-data-backed CSA setup review completed using ${mr.profile.label}.` : `Setup review completed without market data: ${mr.error}`, grade: score >= 8 ? "A" : score >= 7 ? "B" : score >= 6 ? "C" : score >= 4 ? "D" : "F", confidence: score * 10, structureScore: dash.setupQualityScore, executionScore: dash.entryAccuracyScore, riskScore: dash.riskManagementScore, ...dash, coachAdvice: [analysis], journalTags: ["setup review", "directional bias", mr.ok ? "market-data-backed" : "vision-only fallback"], chartDetection: det, marketReference: mr });
  } catch (e) { console.error("CSA Coach analyze error:", e); return res.status(500).json({ success: false, error: "Something went wrong while analyzing the chart.", details: e.message }); }
});

process.on("uncaughtException", (e) => console.error("Uncaught exception:", e));
process.on("unhandledRejection", (r) => console.error("Unhandled rejection:", r));
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`CSA Coach backend running on port ${PORT}`));
