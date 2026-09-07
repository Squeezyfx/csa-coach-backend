import { forexComparisonTolerance } from "./oanda-data.js";
// Provider reference checks are not a claim of broker-feed equivalence.
export function providerSymbol(input = "") {
  const raw = String(input).trim().toUpperCase().replace(/^#/, "");
  const aliases = { GOLD: "XAU/USD", SILVER: "XAG/USD", PLATINUM: "XPT/USD" };
  if (aliases[raw]) return aliases[raw];
  if (raw.includes("/")) return raw;
  const pair = raw.match(/^(EUR|GBP|USD|CHF|CAD|AUD|NZD|JPY|SGD|HKD|SEK|NOK|DKK|ZAR|MXN|XAU|XAG|XPT|XPD|BTC|ETH|DOGE|SOL|XRP|ADA|LTC|BCH|BNB|AVAX|LINK|DOT|MATIC|TRX|SHIB|PEPE)(USDT|USDC|USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|SGD|HKD|SEK|NOK|DKK|ZAR|MXN|BTC|ETH)$/);
  return pair ? `${pair[1]}/${pair[2]}` : raw;
}

export function validateProviderMetadata(meta, requestedSymbol, interval) {
  if (!meta?.symbol) return "Provider response is missing instrument metadata";
  if (providerSymbol(meta.symbol) !== providerSymbol(requestedSymbol)) return "Provider returned a different instrument";
  if (meta.interval !== interval) return "Provider returned a different candle interval";
  return null;
}

export function classifyProviderError(message = "", status = 0) {
  if (status === 429 || /rate limit|credits|too many/i.test(message)) return "rate_limit";
  if (status === 401 || /api.?key|unauthorized/i.test(message)) return "authentication";
  if (status === 403 || /plan|subscription|permission|access/i.test(message)) return "subscription_access";
  if (/symbol|not found/i.test(message)) return "symbol_unavailable";
  if (/no data|empty|history/i.test(message)) return "history_unavailable";
  return "provider_error";
}

export function assessChartDataMatch({ candles = [], detection = {}, cutoff = "", tolerance = 0, timeframe = "D1", symbol = "", source = "Twelve Data" }) {
  const result = (status, reason, extra = {}) => ({ status, reason, brokerVerified: false, source, alignmentScope: "final_visible_candle_only", ...extra });
  const dateVerified = detection.latestVisibleDateEvidence === "explicit_final_candle_timestamp" && detection.dateConfidence === "high" && detection.latestVisibleDate === cutoff.slice(0, 10);
  const price = Number(detection.latestVisiblePrice ?? detection.latestVisibleClose);
  if (!(price > 0) || !["high", "medium"].includes(String(detection.latestVisiblePriceConfidence).toLowerCase())) {
    return result("unverified", "Readable chart price required to check provider alignment");
  }
  const rows = candles.filter(c => String(c.datetime || "").slice(0, 19) <= cutoff).sort((a,b) => String(a.datetime).localeCompare(String(b.datetime)));
  const last = rows.at(-1);
  if (!last || !(Number(last.close) > 0)) return result("unverified", "No provider candles at the chart cutoff");
  if (String(last.datetime).slice(0,10) !== cutoff.slice(0,10)) return result("mismatch", "Provider history does not reach the chart date");
  const forexLimit = forexComparisonTolerance(symbol);
  const limit = forexLimit ?? Math.max(Number(tolerance) || 0, price * 0.0005);
  const comparisons = [{ field: "close", chart: price, provider: Number(last.close) }];
  // D1 header extrema describe the last daily candle, not the whole month.
  if (timeframe === "D1" || source === "OANDA") for (const field of ["open", "high", "low"]) {
    const value = Number(detection[`latestVisible${field[0].toUpperCase()}${field.slice(1)}`]);
    if (value > 0) comparisons.push({ field, chart: value, provider: Number(last[field]) });
  }
  if (source === "OANDA" && ["M1","M5","M15","M30","H1","H4"].includes(timeframe)) {
    const time = String(detection.latestVisibleTime || "").slice(0,5);
    if (!/^\d{2}:\d{2}$/.test(time) || detection.latestVisibleTimeConfidence !== "high" || String(last.datetime).slice(11,16) !== time) {
      return result("time_unverified", "Exact final chart candle time must match the OANDA candle; no price-based timestamp guessing", {comparisons,tolerance:limit,candleDate:last.datetime});
    }
  }
  const mismatch = comparisons.some(c => !Number.isFinite(c.provider) || Math.abs(c.chart - c.provider) > limit + Number.EPSILON * Math.max(1, Math.abs(c.chart)) * 8);
  const evidence = { comparisons, tolerance: limit, candleDate: last.datetime };
  if (!dateVerified) return result("date_unverified", "Final candle date is inferred or unreadable; provider mismatch is not established", evidence);
  if (mismatch && detection.latestVisibleCandleComplete !== true) return result("partial_or_unknown_candle", "Final candle may be unfinished; full provider OHLC cannot verify this screenshot", evidence);
  if (mismatch && detection.providerSessionAligned !== true) return result("session_unverified", "Chart and provider candle session boundaries are not verified", evidence);
  return result(mismatch ? "mismatch" : "matched_reference", mismatch ? "Provider candle differs from the visible chart; do not substitute its levels" : "Chart endpoint aligns within tolerance; provider reference, not broker-exact", { comparisons, tolerance: limit, candleDate: last.datetime });
}

export function clearRejectedProviderData(reference = {}) {
  const safe = {};
  for (const key of ["dataProvider", "providerPriceComponent", "symbol", "providerSymbol", "timezone", "interval", "frameworkInterval", "profile", "chartCutoff", "chartDataMatch", "error", "failureCategory", "rawCandleCount", "filteredCandleCount"]) {
    if (reference[key] !== undefined) safe[key] = reference[key];
  }
  return { ...safe, ok: false, priceAuthority: "unverified",
    dailyLevels: [], structuralLevels: [], timeframeCandles: [], impulseCandles: [], csaAreas: [], approvedAreas: [],
    frameworkCandleCount: 0, impulseCandleCount: 0,
    directionalBias: { bias: "Unverified", biasCode: "unverified", confidence: "low", provisional: true,
      higherTimeframeView: "Provider prices were not verified against the chart; no provider-derived direction is available.",
      timeframeView: "Chart-only interpretation requires verification.", reason: reference.error || "Provider unavailable" } };
}
