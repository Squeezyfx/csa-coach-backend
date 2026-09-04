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

export function assessChartDataMatch({ candles = [], detection = {}, cutoff = "", tolerance = 0, timeframe = "D1" }) {
  const result = (status, reason, extra = {}) => ({ status, reason, brokerVerified: false, source: "Twelve Data", ...extra });
  const price = Number(detection.latestVisiblePrice ?? detection.latestVisibleClose);
  if (!(price > 0) || !["high", "medium"].includes(String(detection.latestVisiblePriceConfidence).toLowerCase())) {
    return result("unverified", "Readable chart price required to check provider alignment");
  }
  const rows = candles.filter(c => String(c.datetime || "").slice(0, 19) <= cutoff).sort((a,b) => String(a.datetime).localeCompare(String(b.datetime)));
  const last = rows.at(-1);
  if (!last || !(Number(last.close) > 0)) return result("unverified", "No provider candles at the chart cutoff");
  if (String(last.datetime).slice(0,10) !== cutoff.slice(0,10)) return result("mismatch", "Provider history does not reach the chart date");
  const limit = Math.max(Number(tolerance) || 0, price * 0.0005);
  const comparisons = [{ field: "close", chart: price, provider: Number(last.close) }];
  // D1 header extrema describe the last daily candle, not the whole month.
  if (timeframe === "D1") for (const field of ["open", "high", "low"]) {
    const value = Number(detection[`latestVisible${field[0].toUpperCase()}${field.slice(1)}`]);
    if (value > 0) comparisons.push({ field, chart: value, provider: Number(last[field]) });
  }
  const mismatch = comparisons.some(c => !Number.isFinite(c.provider) || Math.abs(c.chart - c.provider) > limit);
  return result(mismatch ? "mismatch" : "matched_reference", mismatch ? "Provider candle differs from the visible chart; do not substitute its levels" : "Chart endpoint aligns within tolerance; provider reference, not broker-exact", { comparisons, tolerance: limit, candleDate: last.datetime });
}
