// High-impact news for the instrument under review, from the Finance Calendar API
// (https://www.financecalendar.com/api/reference/). Read-only and optional: with no FC_API_KEY, or when the
// service is slow or down, the review simply has no news section. It never touches the grade or the entries.
// Attribution is required by their terms: "Source: FinanceCalendar.com" is part of the text shown.

const BASE_URL = "https://www.financecalendar.com/wp-json/fc/v1";
const CACHE_MS = 30 * 60 * 1000;
const FAILURE_CACHE_MS = 5 * 60 * 1000;
const WINDOW_HOURS = 24;
const RECENT_MINUTES = 120;
const MAX_SHOWN = 5;

// Country codes the API uses, per currency. Up to three codes are allowed in one request.
const CURRENCY_COUNTRIES = {
  USD: ["US"], EUR: ["EU", "DE"], GBP: ["GB"], JPY: ["JP"], CAD: ["CA"], AUD: ["AU"], CHF: ["CH"],
  NZD: ["NZ"], SEK: ["SE"], NOK: ["NO"], CNY: ["CN"], CNH: ["CN"],
};
// Names that are not a currency pair, mapped to the economies that move them.
const NAMED = {
  DXY: ["US"], USDINDEX: ["US"], USDIDX: ["US"],
  US30: ["US"], DJ30: ["US"], US500: ["US"], SPX500: ["US"], SPX: ["US"], US100: ["US"], NAS100: ["US"], USTEC: ["US"], NDX: ["US"],
  USOIL: ["US"], UKOIL: ["US"], WTI: ["US"], BRENT: ["US"], NATGAS: ["US"],
  GER40: ["DE", "EU"], DE40: ["DE", "EU"], GER30: ["DE", "EU"], DAX: ["DE", "EU"], DAX40: ["DE", "EU"],
  UK100: ["GB"], FTSE: ["GB"], FTSE100: ["GB"],
  JP225: ["JP"], JPN225: ["JP"], NIKKEI: ["JP"], NI225: ["JP"],
  AUS200: ["AU"], AU200: ["AU"],
  EU50: ["EU", "DE"], STOXX50: ["EU", "DE"], FRA40: ["EU"], FR40: ["EU"], ESP35: ["EU"], ES35: ["EU"],
};

// The API country codes behind an instrument, or null when none apply (single stocks, unknown names).
export function newsCountriesForInstrument(symbol) {
  const name = String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!name) return null;
  if (NAMED[name]) return [...NAMED[name]].slice(0, 3);
  if (name.length === 6) {
    const out = [];
    for (const leg of [name.slice(0, 3), name.slice(3)]) {
      for (const country of CURRENCY_COUNTRIES[leg] || []) if (!out.includes(country)) out.push(country);
    }
    // Gold, silver and crypto quoted in dollars (XAUUSD, BTCUSD) end up with the dollar leg only.
    if (out.length) return out.slice(0, 3);
  }
  return null;
}

const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

function normalizeEvent(raw) {
  const at = String(raw?.release_at_utc || raw?.time_utc || "").trim();
  const ms = at ? Date.parse(at) : NaN;
  const impact = String(raw?.impact || "").toLowerCase();
  const name = String(raw?.name || "").trim();
  if (!name || impact !== "high") return null;
  return { name, country: String(raw?.country || "").toUpperCase(), impact, atMs: Number.isFinite(ms) ? ms : null, date: String(raw?.date || "").slice(0, 10) };
}

const defaultCache = new Map();

// Returns { status: "ok", countries, events } | { status: "not_configured" | "not_applicable" | "unavailable" }.
// events are high-impact releases from RECENT_MINUTES ago to WINDOW_HOURS ahead, soonest first.
export async function fetchHighImpactNews({
  symbol, nowMs = Date.now(), apiKey = process.env.FC_API_KEY, fetchImpl = globalThis.fetch,
  cache = defaultCache, timeoutMs = 4000,
} = {}) {
  if (!apiKey) return { status: "not_configured" };
  const countries = newsCountriesForInstrument(symbol);
  if (!countries) return { status: "not_applicable" };
  const from = utcDate(nowMs - RECENT_MINUTES * 60000);
  const to = utcDate(nowMs + WINDOW_HOURS * 3600000);
  const key = `${countries.join(",")}|${from}|${to}`;
  const hit = cache.get(key);
  let payload;
  if (hit && hit.until > nowMs) {
    payload = hit.payload;
  } else {
    try {
      const url = `${BASE_URL}/calendar?country=${encodeURIComponent(countries.join(","))}&impact=high&from=${from}&to=${to}&limit=20`;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let response;
      try {
        response = await fetchImpl(url, { headers: { "X-API-Key": apiKey, Accept: "application/json" }, signal: controller?.signal });
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!response?.ok) throw new Error(`HTTP ${response?.status}`);
      payload = await response.json();
      cache.set(key, { until: nowMs + CACHE_MS, payload });
    } catch (error) {
      cache.set(key, { until: nowMs + FAILURE_CACHE_MS, payload: null });
      console.log("[news] calendar unavailable:", error?.message || error);
      return { status: "unavailable" };
    }
  }
  if (!payload) return { status: "unavailable" };
  const rows = Array.isArray(payload.events) ? payload.events : Array.isArray(payload.items) ? payload.items : [];
  const events = rows
    .map(normalizeEvent)
    .filter((event) => event && event.atMs !== null && event.atMs >= nowMs - RECENT_MINUTES * 60000 && event.atMs <= nowMs + WINDOW_HOURS * 3600000)
    .sort((a, b) => a.atMs - b.atMs);
  return { status: "ok", countries, events };
}

function wallParts(ms, timezone) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(ms)).map((p) => [p.type, p.value])
    );
    return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  } catch {
    return null;
  }
}

function whenText(ms, nowMs, timezone) {
  const at = wallParts(ms, timezone) || wallParts(ms, "UTC");
  const now = wallParts(nowMs, timezone) || wallParts(nowMs, "UTC");
  const zone = wallParts(ms, timezone) ? timezone : "UTC";
  const dayWord = at.day === now.day ? "today" : "tomorrow";
  return { text: `${dayWord} ${at.time}`, zone };
}

// The plain-words lines for the review ("NEWS TODAY"); empty when there is nothing trustworthy to say.
export function describeNewsToday(news, { symbol = "this instrument", timezone = "UTC", nowMs = Date.now() } = {}) {
  if (!news || news.status !== "ok") return [];
  if (!news.events.length) {
    return [`- No high-impact releases are scheduled in the next ${WINDOW_HOURS} hours for ${symbol}. Source: FinanceCalendar.com.`];
  }
  const shown = news.events.slice(0, MAX_SHOWN).map((event) => {
    const when = whenText(event.atMs, nowMs, timezone);
    const state = event.atMs < nowMs ? " (already out)" : "";
    return `${event.name} (${event.country}) ${when.text}${state}`;
  });
  const zone = whenText(news.events[0].atMs, nowMs, timezone).zone;
  const more = news.events.length > MAX_SHOWN ? ` and ${news.events.length - MAX_SHOWN} more` : "";
  return [
    `- High-impact news for ${symbol} (${zone} time): ${shown.join("; ")}${more}.`,
    "- Expect faster, larger price moves and wider spreads around those times, so be careful with new entries shortly before and after a release.",
    "- Scheduled times only, not a prediction of direction and not a signal. Source: FinanceCalendar.com.",
  ];
}
