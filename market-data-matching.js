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

export function assessChartDataMatch({ candles = [], detection = {}, cutoff = "", tolerance = 0, timeframe = "D1", symbol = "", source = "Twelve Data", alignmentCandle = null }) {
  const result = (status, reason, extra = {}) => ({ status, reason, brokerVerified: false, source, alignmentScope: "final_visible_candle_only", ...extra });
  const dateVerified = ["explicit_final_candle_timestamp", "verified_axis_bar_count"].includes(detection.latestVisibleDateEvidence) && detection.dateConfidence === "high" && detection.latestVisibleDate === cutoff.slice(0, 10);
  const price = Number(detection.latestVisiblePrice ?? detection.latestVisibleClose);
  if (!(price > 0) || !["high", "medium"].includes(String(detection.latestVisiblePriceConfidence).toLowerCase())) {
    return result("unverified", "Readable chart price required to check provider alignment");
  }
  const rows = candles.filter(c => String(c.datetime || "").slice(0, 19) <= cutoff).sort((a,b) => String(a.datetime).localeCompare(String(b.datetime)));
  const exactTime = source === "OANDA" &&
    /^\d{2}:\d{2}$/.test(String(detection.latestVisibleTime || "").slice(0, 5)) &&
    detection.latestVisibleTimeConfidence === "high";
  // When the screenshot does not expose the final candle time, do not use the
  // next/in-progress alignment candle. Match the printed OHLC against the
  // completed same-date candles first; this prevents a later OANDA candle from
  // creating a false time failure.
  const sameDateCompleted = source === "OANDA" && !exactTime
    ? rows.filter(c => String(c.datetime || "").slice(0, 10) === cutoff.slice(0, 10))
    : [];
  const headerValues = ["open", "high", "low", "close"].map(field =>
    Number(detection[`latestVisible${field[0].toUpperCase()}${field.slice(1)}`])
  );
  const headerComparable = headerValues.every(Number.isFinite) && headerValues.every(n => n > 0);
  const last = exactTime && alignmentCandle && String(alignmentCandle.datetime) <= cutoff
    ? alignmentCandle
    : sameDateCompleted.length && headerComparable
    ? sameDateCompleted
        .map(c => ({ c, score: ["open", "high", "low", "close"].reduce((sum, field, i) => sum + Math.abs(headerValues[i] - Number(c[field])), 0) }))
        .sort((a, b) => a.score - b.score)[0]?.c
    : rows.at(-1);
  if (!last || !(Number(last.close) > 0)) return result("unverified", "No provider candles at the chart cutoff");
  const providerDate = String(last.datetime).slice(0, 10);
  const cutoffDate = cutoff.slice(0, 10);
  const providerMs = Date.parse(`${providerDate}T00:00:00Z`);
  const cutoffMs = Date.parse(`${cutoffDate}T00:00:00Z`);
  const lagDays = Number.isFinite(providerMs) && Number.isFinite(cutoffMs)
    ? Math.round((cutoffMs - providerMs) / 86400000)
    : null;
  // Daily charts can end on a Saturday/Sunday while the last tradable candle
  // is Friday. Treat that session gap as an alignment condition, not as a
  // missing-symbol/history failure. Weekday gaps remain hard mismatches.
  const cutoffDay = Number.isFinite(cutoffMs) ? new Date(cutoffMs).getUTCDay() : null;
  const weekendSessionLag = timeframe === "D1" &&
    [0, 6].includes(cutoffDay) && lagDays !== null && lagDays >= 1 && lagDays <= 2;
  if (providerDate !== cutoffDate && !weekendSessionLag) {
    return result("mismatch", "Provider history does not reach the chart date", {
      providerCoverage: { lastProviderCandleDate: providerDate, requestedCutoffDate: cutoffDate, lagDays },
    });
  }
  const forexLimit = forexComparisonTolerance(symbol);
  const limit = forexLimit ?? Math.max(Number(tolerance) || 0, price * 0.0005);
  const comparisons = [{ field: "close", chart: price, provider: Number(last.close) }];
  // D1 header extrema describe the last daily candle, not the whole month.
  if (timeframe === "D1" || source === "OANDA") for (const field of ["open", "high", "low"]) {
    const value = Number(detection[`latestVisible${field[0].toUpperCase()}${field.slice(1)}`]);
    if (value > 0) comparisons.push({ field, chart: value, provider: Number(last[field]) });
  }
  if (source === "OANDA" && exactTime && ["M1","M5","M15","M30","H1","H4"].includes(timeframe)) {
    const time = String(detection.latestVisibleTime || "").slice(0,5);
    if (!/^\d{2}:\d{2}$/.test(time) || detection.latestVisibleTimeConfidence !== "high" || String(last.datetime).slice(11,16) !== time) {
      return result("time_unverified", "Exact final chart candle time must match the OANDA candle; no price-based timestamp guessing", {comparisons,tolerance:limit,candleDate:last.datetime});
    }
  }
  const mismatch = comparisons.some(c => !Number.isFinite(c.provider) || Math.abs(c.chart - c.provider) > limit + Number.EPSILON * Math.max(1, Math.abs(c.chart)) * 8);
  const evidence = { comparisons, tolerance: limit, candleDate: last.datetime };
  const withinLimit = c => Number.isFinite(c.provider) && Math.abs(c.chart - c.provider) <= limit + Number.EPSILON * Math.max(1, Math.abs(c.chart)) * 8;
  const chosenByCompletedHeader = source === "OANDA" && !exactTime && sameDateCompleted.includes(last) &&
    headerComparable && comparisons.filter(c => c.field !== "close").every(withinLimit);
  if (!dateVerified && !chosenByCompletedHeader && !weekendSessionLag) return result("date_unverified", "Final candle date is inferred or unreadable; provider mismatch is not established", evidence);
  // An unfinished screenshot close is not the provider's eventual closing price.
  // Retain only a provisional reference when every available OHL check passes;
  // never promote it to a matched chart or increase the three-pip tolerance.
  const ohl = comparisons.filter(c => c.field !== "close");
  const headerValid = ohl.length === 3 &&
    Number(detection.latestVisibleHigh) >= Math.max(Number(detection.latestVisibleOpen), price) &&
    Number(detection.latestVisibleLow) <= Math.min(Number(detection.latestVisibleOpen), price);
  const ohlOnlyAligned = source === "OANDA" && forexLimit !== null &&
    detection.latestVisibleCandleComplete !== true && headerValid && ohl.every(withinLimit) &&
    price >= Number(last.low) - limit && price <= Number(last.high) + limit;
  if (ohlOnlyAligned) {
    const closeDeferred = !withinLimit(comparisons.find(c => c.field === "close"));
    return result("partial_reference", closeDeferred
      ? "Final close comparison deferred because candle completion is unknown or unfinished; OHL aligns within the three-pip buffer. Completed provider periods remain provisional and require review."
      : "Final close is within the three-pip buffer, but candle completion is unknown or unfinished; completed provider periods remain provisional and require review.",
      {...evidence, requiresReview: true, priceVerified: false, closeDeferred: true, failedFields: closeDeferred ? ["close"] : []});
  }
  if (mismatch && detection.latestVisibleCandleComplete !== true) return result("partial_or_unknown_candle", "Final candle may be unfinished; full provider OHLC cannot verify this screenshot", evidence);
  if (mismatch && detection.providerSessionAligned !== true) return result("session_unverified", "Chart and provider candle session boundaries are not verified", evidence);
  return result(mismatch ? "mismatch" : "matched_reference", mismatch ? "Provider candle differs from the visible chart; do not substitute its levels" : weekendSessionLag ? "Chart endpoint aligns with the last tradable session; provider reference, not broker-exact" : "Chart endpoint aligns within tolerance; provider reference, not broker-exact", {
    comparisons, tolerance: limit, candleDate: last.datetime,
    providerCoverage: { lastProviderCandleDate: providerDate, requestedCutoffDate: cutoffDate, lagDays, weekendSessionLag },
  });
}

export function clearRejectedProviderData(reference = {}) {
  const safe = {};
  for (const key of ["dataProvider", "providerPriceComponent", "symbol", "providerSymbol", "timezone", "interval", "frameworkInterval", "profile", "chartCutoff", "chartDataMatch", "providerCoverage", "providerDiagnostics", "providerAttempts", "error", "failureCategory", "rawCandleCount", "filteredCandleCount", "frameworkCandleCount", "impulseCandleCount"]) {
    if (reference[key] !== undefined) safe[key] = reference[key];
  }
  return { ...safe, ok: false, priceAuthority: "unverified",
    dailyLevels: [], structuralLevels: [], timeframeCandles: [], impulseCandles: [], csaAreas: [], approvedAreas: [],
    frameworkCandleCount: 0, impulseCandleCount: 0,
    directionalBias: { bias: "Unverified", biasCode: "unverified", confidence: "low", provisional: true,
      higherTimeframeView: "Provider prices were not verified against the chart; no provider-derived direction is available.",
      timeframeView: "Chart-only interpretation requires verification.", reason: reference.error || "Provider unavailable" } };
}
