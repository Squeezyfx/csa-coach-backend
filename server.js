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

const CSA_FRAMEWORK_RULES = `
You are CSA Coach, an AI chart-structure coach trained to identify CSAFOREX areas of interest.

Your current role is ONLY to identify CSAFOREX areas of interest on the uploaded chart and explain CSA directional bias from the progression of those areas.

Do NOT provide trade signals.
Do NOT give financial advice.
Do NOT predict where price will go next.
Do NOT review entries.
Do NOT review stop losses.
Do NOT review take profits.
Do NOT review trade management.
Do NOT review risk-to-reward.
Do NOT grade the trade.
Do NOT tell the user whether to buy or sell.
Do NOT give trade setup recommendations.

For now, your job is only to identify:
- Support areas
- Resistance areas
- Supply zones
- Demand zones
- CSA directional bias based on support/resistance and supply/demand progression

CSAFOREX CURRENT FRAMEWORK STAGE:
The current framework stage is AREA IDENTIFICATION + DIRECTIONAL BIAS ONLY.

This means:
- Identify the Monday-to-Friday trading data for the final visible chart date.
- Use market-data OHLC values calculated by the backend as the source of truth for Monday-to-Friday highs/lows.
- Use the uploaded chart image for visual context only.
- Ignore Sunday candles.
- Explain directional bias from CSA structure progression.
- Do not analyze reaction type yet.
- Do not analyze entry trigger yet.
- Do not analyze stop loss yet.
- Do not analyze trade management yet.

HYBRID DATA RULE:
The backend may provide CSA reference data from Twelve Data.
If CSA reference data is provided, treat those OHLC values, CSA area calculations, and CSA directional bias calculations as the source of truth.
Do not override backend OHLC values with approximate readings from the screenshot.
Do not relabel a backend-provided Monday high as Tuesday high, or Tuesday high as Monday high.

The uploaded chart image is still useful for:
- Checking whether the selected instrument/timeframe visually matches the screenshot.
- Noting whether visible user-drawn lines/zones appear close to the backend-calculated CSA areas.
- Explaining the areas in a trader-friendly way.

If the chart image and backend market data appear slightly different, explain that small differences can happen because broker feeds, data providers, spreads, and server times may differ slightly.
Do not accuse the user of being wrong. Use cautious wording.

DATE SELECTION RULE:
The user may select a trade date or entry date that is earlier than the latest date visible on the uploaded chart.
If the backend says the chart-detected latest visible date is later than the user-selected date, explain that the system used the chart-detected latest visible date for the Monday-to-Friday CSA framework.
This is correct because the CSA area identification should use the final visible chart date, not only the trade entry date.

If the chart-detected date is unclear, the backend will use the user-selected date.
Do not invent a chart date if the backend did not confirm one.

TIMEFRAME RULE:
If the selected timeframe is 1m, M1, 5m, M5, 15m, M15, 30m, M30, 1H, or H1:
Use the CSA lower-timeframe Monday-to-Friday area identification framework.

If the selected timeframe is 4H, H4, Daily, D1, Weekly, or W1:
Do not force this lower-timeframe rule unless the user explicitly wants it.
For now, say the current CSA lower-timeframe rule is designed mainly for 1m to 1H charts and only identify obvious visible support/resistance areas if possible.

SUNDAY CANDLE RULE:
Ignore Sunday candles for CSA Monday-to-Friday area identification.
If the broker shows partial Sunday candles, do not treat Sunday as Monday.
Treat Monday as the first full Monday trading day after the weekend.

MOST RECENT WEEK RULE:
The CSA analysis must focus on the Monday-to-Friday week that contains the final visible chart date used by the backend.
If the final visible date is Wednesday, use Monday, Tuesday, and Wednesday data available up to that date.
If the final visible date is Friday, use Monday through Friday data.
Do not use older weeks as the main CSA analysis unless no current-week market data is available.

CSA LOWER-TIMEFRAME AREA IDENTIFICATION FRAMEWORK:

1. MONDAY
- Monday high represents Monday resistance.
- Monday low represents Monday support.

2. TUESDAY
Compare Tuesday with Monday.
- If Tuesday high is higher than Monday high: Tuesday high is Tuesday resistance.
- If Tuesday low is lower than Monday low: Tuesday low is Tuesday support.
- If Tuesday high is NOT higher than Monday high: Tuesday high area is Tuesday supply.
- If Tuesday low is NOT lower than Monday low: Tuesday low area is Tuesday demand.

3. WEDNESDAY
Compare Wednesday with Tuesday.
- If Wednesday high is higher than Tuesday high: Wednesday high is Wednesday resistance.
- If Wednesday low is lower than Tuesday low: Wednesday low is Wednesday support.
- If Wednesday high is NOT higher than Tuesday high: Wednesday high area is Wednesday supply.
- If Wednesday low is NOT lower than Tuesday low: Wednesday low area is Wednesday demand.

4. THURSDAY
Compare Thursday with Wednesday.
- If Thursday high is higher than Wednesday high: Thursday high is Thursday resistance.
- If Thursday low is lower than Wednesday low: Thursday low is Thursday support.
- If Thursday high is NOT higher than Wednesday high: Thursday high area is Thursday supply.
- If Thursday low is NOT lower than Wednesday low: Thursday low area is Thursday demand.

5. FRIDAY
Compare Friday with Thursday.
- If Friday high is higher than Thursday high: Friday high is Friday resistance.
- If Friday low is lower than Thursday low: Friday low is Friday support.
- If Friday high is NOT higher than Thursday high: Friday high area is Friday supply.
- If Friday low is NOT lower than Thursday low: Friday low area is Friday demand.

IMPORTANT COMPARISON RULES:
- Always compare current day high to previous day high.
- Always compare current day low to previous day low.
- Never compare a current day low to the previous day high.
- Do not call every high resistance.
- Do not call every low support.
- Use the CSA comparison rule.

CSA DIRECTIONAL BIAS RULE:
Directional bias must be based on the progression of CSA support, resistance, supply, and demand areas.

Bullish CSA bias usually means:
- Highs are breaking above previous highs.
- Lows are holding above previous lows.
- Demand areas are holding.
- Resistance levels are being pushed higher.
- The CSA structure is progressing upward.

Bearish CSA bias usually means:
- Lows are breaking below previous lows.
- Highs are failing to break previous highs.
- Supply areas are holding.
- Support levels are being pushed lower.
- The CSA structure is progressing downward.

Mixed or range-bound CSA bias usually means:
- Price is breaking both sides inconsistently.
- Highs and lows are not progressing cleanly in one direction.
- Support, resistance, supply, and demand are conflicting.
- Trend-following conditions are less clear.

Directional bias is NOT a trade signal.
Do not say buy, sell, enter, or take this trade.
Instead, explain which CSA areas are more relevant for a trend-following trader and which areas may be counter-trend or higher caution.

SECTION SEPARATION RULE:
Keep the output clean and separated into standalone sections.
Monday-to-Friday CSA Area Breakdown must be one section by itself.
CSA Directional Bias must be one section by itself.
Current Key Areas of Interest must be one section by itself.
Use spacing between Monday, Tuesday, Wednesday, Thursday, and Friday information so the user can scan it easily.

OUTPUT STYLE:
Be clear and structured.
Do not over-explain general trading theory.
Focus on the market-data-backed CSA areas for the selected week.

Your answer should follow this format with clean standalone sections and clear spacing:

- Data Source Check:
  State whether backend OHLC market data was provided.
  Mention the data provider, symbol, timeframe interval, and timezone used.
  Mention that Twelve Data/reference feed levels may differ slightly from a broker screenshot.

- Date Check:
  State the user-selected date.
  State the chart-detected latest visible date if provided.
  State the actual final visible chart date used for the market-data fetch.
  If the chart-detected date overrode the user-selected date, explain this clearly and briefly.

- Week Used:
  State the Monday-to-Friday week/date range used.
  State that Sunday candles are ignored.

- Monday-to-Friday CSA Area Breakdown:
  This must be a separate, clearly visible section.
  Start the section with exactly this heading: "Monday-to-Friday CSA Area Breakdown".
  Use a blank line or spacing between each day.
  For each available day, show the high, low, and CSA interpretation.
  Do not mix directional bias into this section.

  Use this structure:

  Monday
  - Resistance: Monday high at [price].
  - Support: Monday low at [price].

  Tuesday
  - Compare Tuesday with Monday.
  - High area: Resistance or Supply at [price] with reason.
  - Low area: Support or Demand at [price] with reason.

  Wednesday
  - Compare Wednesday with Tuesday.
  - High area: Resistance or Supply at [price] with reason.
  - Low area: Support or Demand at [price] with reason.

  Thursday
  - Compare Thursday with Wednesday.
  - High area: Resistance or Supply at [price] with reason.
  - Low area: Support or Demand at [price] with reason.

  Friday
  - Compare Friday with Thursday.
  - High area: Resistance or Supply at [price] with reason.
  - Low area: Support or Demand at [price] with reason.

- CSA Directional Bias:
  This must be a separate, clearly visible section.
  Start the section with exactly this heading: "CSA Directional Bias".
  State the bias as Bullish, Bearish, Mixed / Range-bound, or Insufficient data.
  State the confidence level if backend bias confidence is provided.
  Explain the bias using the progression of CSA highs, lows, support, resistance, supply, and demand.
  Keep this section focused only on directional structure.
  Do not mix this section with the daily area breakdown.

  Use this structure:

  CSA Directional Bias
  Bias: Bullish / Bearish / Mixed / Range-bound / Insufficient data
  Confidence: High / Medium / Low

  Bias Reason:
  Explain why, based on CSA progression.

  Trend Trading Focus:
  Explain which CSA areas deserve more attention for trend-following traders.
  Do not provide an entry signal.
  Use wording like watch, focus on, more important area, or area of interest.

  Counter-Trend Caution:
  Explain which areas may attract counter-trend reactions but should be treated with more caution if they go against the CSA bias.
  Do not provide a counter-trend signal.

- Current Key Areas of Interest:
  This must be a separate, clearly visible section.
  Start the section with exactly this heading: "Current Key Areas of Interest".
  List the most important current support, resistance, supply, and demand areas from the selected week only.
  Do not mix this section with directional bias.
  Do not include entry, stop loss, take profit, or trade signal.

  Use this structure:

  Current Key Areas of Interest

  Key Resistance Areas:
  - List resistance areas only.

  Key Support Areas:
  - List support areas only.

  Key Supply Areas:
  - List supply areas only.

  Key Demand Areas:
  - List demand areas only.

  Trend-Following Priority:
  - State which of the above areas are more relevant based on the CSA directional bias.

- Chart/Image Notes:
  Briefly mention if the uploaded chart seems to match the selected pair/timeframe or if there is a visible mismatch.
  Do not rely on the screenshot for exact prices when backend OHLC data is available.

- Missing Information:
  State if chart date, instrument, timeframe, or backend OHLC data was missing or incomplete.

Do not include:
- Entry review
- Stop loss review
- Take profit review
- Trade management review
- Risk-to-reward review
- Buy/sell recommendation
- Trade signal
- Prediction
- Trade grade
`;

const CHART_DETECTION_PROMPT = `
You are a chart screenshot pre-check assistant for CSA Coach.

Your only job is to inspect the uploaded chart image and return a small JSON object.

Detect:
1. The trading instrument/pair visible on the chart, if readable.
2. The timeframe visible on the chart, if readable.
3. The latest/final visible calendar date shown on the chart, if readable.

Important:
- The chart may be from TradingView, MT4, MT5, or another platform.
- The latest visible chart date means the last/rightmost date visible on the x-axis or candles.
- If the user selected an earlier trade date but the chart clearly shows a later date, return the later latestVisibleDate from the chart.
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

function getWeekRangeForDate(chartDate) {
  const day = chartDate.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(chartDate, mondayOffset);
  const friday = addDays(monday, 4);
  const end = chartDate < friday ? chartDate : friday;

  return {
    monday,
    friday,
    end,
    startDate: formatDateOnly(monday),
    fridayDate: formatDateOnly(friday),
    endDate: formatDateOnly(end),
  };
}

function weekdayNameFromDate(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
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

function candleDateOnly(datetimeValue = "") {
  return String(datetimeValue).slice(0, 10);
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

function chooseFinalChartDate({ selectedDate, detection }) {
  const detectedIsUsable = isUsableChartDateDetection(detection);
  const detectedDate = detectedIsUsable
    ? parseISODateOnly(detection.latestVisibleDate)
    : null;

  if (selectedDate && detectedDate && detectedDate > selectedDate) {
    return {
      finalDate: detectedDate,
      finalDateText: formatDateOnly(detectedDate),
      selectedDateText: formatDateOnly(selectedDate),
      detectedDateText: formatDateOnly(detectedDate),
      source: "chart-detected-later-date",
      reason:
        "The uploaded chart appears to show a later final visible date than the user-selected date, so the chart-detected date was used for the Monday-to-Friday CSA framework.",
    };
  }

  if (selectedDate) {
    return {
      finalDate: selectedDate,
      finalDateText: formatDateOnly(selectedDate),
      selectedDateText: formatDateOnly(selectedDate),
      detectedDateText: detectedDate ? formatDateOnly(detectedDate) : null,
      source: "user-selected-date",
      reason:
        "The user-selected date was used because no later high-confidence chart date was detected.",
    };
  }

  if (detectedDate) {
    return {
      finalDate: detectedDate,
      finalDateText: formatDateOnly(detectedDate),
      selectedDateText: null,
      detectedDateText: formatDateOnly(detectedDate),
      source: "chart-detected-date",
      reason:
        "No user-selected date was provided, so the chart-detected latest visible date was used.",
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

function buildDailyLevelsFromCandles(candles, weekRange) {
  const grouped = new Map();

  candles.forEach((bar) => {
    const dateOnly = candleDateOnly(bar.datetime);
    if (!dateOnly) return;

    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return;

    const dayNum = date.getUTCDay();

    // Ignore Saturday and Sunday.
    if (dayNum < 1 || dayNum > 5) return;

    // Only use selected Monday to final visible chart date, capped at Friday.
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

function buildCsaAreas(dailyLevels) {
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

    const highBreak = day.high > previous.high;
    const lowBreak = day.low < previous.low;

    areas.push({
      day: day.weekday,
      date: day.date,
      type: highBreak ? "resistance" : "supply",
      price: day.high,
      priceText: formatPrice(day.high),
      comparedWith: `${previous.weekday} ${previous.date}`,
      logic: highBreak
        ? `${day.weekday} high broke above ${previous.weekday} high, so ${day.weekday} high is resistance.`
        : `${day.weekday} high did not break above ${previous.weekday} high, so ${day.weekday} high is supply.`,
    });

    areas.push({
      day: day.weekday,
      date: day.date,
      type: lowBreak ? "support" : "demand",
      price: day.low,
      priceText: formatPrice(day.low),
      comparedWith: `${previous.weekday} ${previous.date}`,
      logic: lowBreak
        ? `${day.weekday} low broke below ${previous.weekday} low, so ${day.weekday} low is support.`
        : `${day.weekday} low did not break below ${previous.weekday} low, so ${day.weekday} low is demand.`,
    });
  });

  return areas;
}

function calculateCsaDirectionalBias(dailyLevels = [], csaAreas = []) {
  if (!Array.isArray(dailyLevels) || dailyLevels.length < 2) {
    return {
      bias: "Insufficient data",
      biasCode: "insufficient",
      confidence: "low",
      bullishScore: 0,
      bearishScore: 0,
      highBreakCount: 0,
      lowBreakCount: 0,
      demandHoldCount: 0,
      supplyHoldCount: 0,
      higherCloseCount: 0,
      lowerCloseCount: 0,
      progression: [],
      reason:
        "At least two weekdays are needed to compare CSA progression and form a directional bias.",
      trendTradingFocus:
        "There is not enough CSA progression yet to define a clear trend-following focus.",
      counterTrendCaution:
        "Counter-trend interpretation is not reliable until more weekday structure is available.",
    };
  }

  let bullishScore = 0;
  let bearishScore = 0;
  let highBreakCount = 0;
  let lowBreakCount = 0;
  let demandHoldCount = 0;
  let supplyHoldCount = 0;
  let higherCloseCount = 0;
  let lowerCloseCount = 0;
  const progression = [];

  for (let i = 1; i < dailyLevels.length; i += 1) {
    const current = dailyLevels[i];
    const previous = dailyLevels[i - 1];

    const highBreak = current.high > previous.high;
    const lowBreak = current.low < previous.low;
    const demandHeld = current.low >= previous.low;
    const supplyHeld = current.high <= previous.high;
    const closeHigher = current.close > previous.close;
    const closeLower = current.close < previous.close;

    if (highBreak) {
      bullishScore += 2;
      highBreakCount += 1;
    } else if (supplyHeld) {
      bearishScore += 1;
      supplyHoldCount += 1;
    }

    if (demandHeld) {
      bullishScore += 1.5;
      demandHoldCount += 1;
    } else if (lowBreak) {
      bearishScore += 2;
      lowBreakCount += 1;
    }

    if (closeHigher) {
      bullishScore += 0.5;
      higherCloseCount += 1;
    } else if (closeLower) {
      bearishScore += 0.5;
      lowerCloseCount += 1;
    }

    let line = `${current.weekday} ${current.date}: `;

    if (highBreak && demandHeld) {
      line += `bullish progression because ${current.weekday} broke above ${previous.weekday}'s high and held above ${previous.weekday}'s low.`;
    } else if (lowBreak && supplyHeld) {
      line += `bearish progression because ${current.weekday} broke below ${previous.weekday}'s low and failed to break above ${previous.weekday}'s high.`;
    } else if (highBreak && lowBreak) {
      line += `expanded both sides because ${current.weekday} broke above the previous high and below the previous low, so the bias is less clean.`;
    } else if (supplyHeld && demandHeld) {
      line += `range compression because ${current.weekday} stayed inside the previous day's high and low.`;
    } else if (highBreak) {
      line += `partial bullish pressure because ${current.weekday} broke above the previous high.`;
    } else if (lowBreak) {
      line += `partial bearish pressure because ${current.weekday} broke below the previous low.`;
    } else {
      line += `no clear directional expansion compared with ${previous.weekday}.`;
    }

    progression.push(line);
  }

  const scoreDifference = bullishScore - bearishScore;
  const totalComparisons = dailyLevels.length - 1;

  let bias = "Mixed / Range-bound";
  let biasCode = "mixed";
  let confidence = "medium";

  if (
    scoreDifference >= 2 &&
    highBreakCount >= 1 &&
    demandHoldCount >= lowBreakCount
  ) {
    bias = "Bullish";
    biasCode = "bullish";
  } else if (
    scoreDifference <= -2 &&
    lowBreakCount >= 1 &&
    supplyHoldCount >= highBreakCount
  ) {
    bias = "Bearish";
    biasCode = "bearish";
  }

  if (totalComparisons <= 1) {
    confidence = "low";
  } else if (Math.abs(scoreDifference) >= 4) {
    confidence = "high";
  } else if (Math.abs(scoreDifference) < 2) {
    confidence = "low";
  }

  let reason = "";
  let trendTradingFocus = "";
  let counterTrendCaution = "";

  if (biasCode === "bullish") {
    reason = `The CSA progression is bullish because the week shows ${highBreakCount} high break(s), ${demandHoldCount} demand hold(s), and ${higherCloseCount} higher close comparison(s). Resistance is being pushed higher while demand/support is holding above previous lows.`;
    trendTradingFocus =
      "For trend-following traders, the more important CSA areas are demand/support areas created during the bullish progression, especially areas that formed after price broke previous highs. These are areas to watch for later reaction/confirmation when that part of the CSA framework is added.";
    counterTrendCaution =
      "Supply/resistance areas can still create reactions, but counter-trend selling against bullish CSA progression should be treated with more caution because the structure is currently favoring upward progression.";
  } else if (biasCode === "bearish") {
    reason = `The CSA progression is bearish because the week shows ${lowBreakCount} low break(s), ${supplyHoldCount} supply hold(s), and ${lowerCloseCount} lower close comparison(s). Support is being pushed lower while supply/resistance is holding below previous highs.`;
    trendTradingFocus =
      "For trend-following traders, the more important CSA areas are supply/resistance areas created during the bearish progression, especially areas that formed after price broke previous lows. These are areas to watch for later reaction/confirmation when that part of the CSA framework is added.";
    counterTrendCaution =
      "Demand/support areas can still create reactions, but counter-trend buying against bearish CSA progression should be treated with more caution because the structure is currently favoring downward progression.";
  } else {
    reason = `The CSA progression is mixed/range-bound because bullish and bearish structure signals are conflicting. The week shows ${highBreakCount} high break(s), ${lowBreakCount} low break(s), ${demandHoldCount} demand hold(s), and ${supplyHoldCount} supply hold(s), so the structure is not cleanly one-sided.`;
    trendTradingFocus =
      "For trend-following traders, it may be better to wait for a cleaner CSA progression before placing more weight on trend-continuation areas. The most important areas are the extremes of the current week rather than the middle of the range.";
    counterTrendCaution =
      "Counter-trend reactions may appear inside mixed/ranging conditions, but the middle of the range is lower quality. Extreme support/demand or resistance/supply areas should be treated with more caution and require stronger confirmation later.";
  }

  return {
    bias,
    biasCode,
    confidence,
    bullishScore,
    bearishScore,
    scoreDifference,
    highBreakCount,
    lowBreakCount,
    demandHoldCount,
    supplyHoldCount,
    higherCloseCount,
    lowerCloseCount,
    progression,
    reason,
    trendTradingFocus,
    counterTrendCaution,
  };
}

async function fetchTwelveDataIntradayLevels({
  symbol,
  chartDate,
  timeframe = "H1",
  timezone = "UTC",
}) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const interval = normalizeTimeframe(timeframe);

  if (!apiKey) {
    return {
      ok: false,
      error: "TWELVE_DATA_API_KEY is missing on the server.",
      dailyLevels: [],
      csaAreas: [],
      directionalBias: calculateCsaDirectionalBias([], []),
      rawCandleCount: 0,
      weekRange: chartDate ? getWeekRangeForDate(chartDate) : null,
      interval,
    };
  }

  if (!symbol) {
    return {
      ok: false,
      error: "Instrument/pair is missing or unsupported.",
      dailyLevels: [],
      csaAreas: [],
      directionalBias: calculateCsaDirectionalBias([], []),
      rawCandleCount: 0,
      weekRange: chartDate ? getWeekRangeForDate(chartDate) : null,
      interval,
    };
  }

  if (!chartDate) {
    return {
      ok: false,
      error:
        "Final Visible Chart Date is missing. Add the latest date visible on the chart so the backend can fetch the correct Monday-to-Friday data.",
      dailyLevels: [],
      csaAreas: [],
      directionalBias: calculateCsaDirectionalBias([], []),
      rawCandleCount: 0,
      weekRange: null,
      interval,
    };
  }

  const weekRange = getWeekRangeForDate(chartDate);

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
      directionalBias: calculateCsaDirectionalBias([], []),
      rawCandleCount: 0,
      weekRange,
      symbol,
      timezone,
      interval,
      twelveDataStatus: data.status || "unknown",
    };
  }

  const rawCandles = data.values || [];
  const dailyLevels = buildDailyLevelsFromCandles(rawCandles, weekRange);
  const csaAreas = buildCsaAreas(dailyLevels);
  const directionalBias = calculateCsaDirectionalBias(dailyLevels, csaAreas);

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
    meta: data.meta || null,
  };
}

function buildMarketDataSummary(reference, dateDecision, chartDetection) {
  const dateBlock = `
Date decision:
- User-selected date: ${dateDecision.selectedDateText || "Not provided"}
- Chart-detected latest visible date: ${
    dateDecision.detectedDateText || "Not detected"
  }
- Chart detection confidence: ${chartDetection?.dateConfidence || "low"}
- Final visible chart date used for market data: ${dateDecision.finalDateText}
- Date source: ${dateDecision.source}
- Reason: ${dateDecision.reason}
`;

  if (!reference || !reference.ok) {
    return `${dateBlock}

Market-data reference status: unavailable. Reason: ${
      reference?.error || "Unknown error"
    }`;
  }

  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  const dayBlocks = dayNames
    .map((dayName) => {
      const day = reference.dailyLevels.find((item) => item.weekday === dayName);
      if (!day) {
        return `${dayName}\n- No ${dayName} data was returned for the selected week/date.`;
      }

      const areasForDay = reference.csaAreas.filter(
        (area) => area.day === dayName
      );

      const areaLines = areasForDay
        .map(
          (area) =>
            `- ${area.type.toUpperCase()} at ${area.priceText}. ${area.logic}`
        )
        .join("\n");

      return `${dayName}
- Date: ${day.date}
- OHLC: open ${formatPrice(day.open)}, high ${formatPrice(
        day.high
      )}, low ${formatPrice(day.low)}, close ${formatPrice(day.close)}
- Candles used: ${day.candleCount}
- First candle: ${day.firstCandleTime}
- Last candle: ${day.lastCandleTime}
${areaLines || "- No CSA areas calculated for this day."}`;
    })
    .join("\n\n");

  const resistanceAreas = reference.csaAreas.filter(
    (area) => area.type === "resistance"
  );
  const supportAreas = reference.csaAreas.filter(
    (area) => area.type === "support"
  );
  const supplyAreas = reference.csaAreas.filter(
    (area) => area.type === "supply"
  );
  const demandAreas = reference.csaAreas.filter(
    (area) => area.type === "demand"
  );

  const formatAreaList = (areas) =>
    areas.length
      ? areas
          .map(
            (area) =>
              `- ${area.day} ${area.date}: ${area.priceText}. ${area.logic}`
          )
          .join("\n")
      : "- None identified from the available selected-week data.";

  const bias = reference.directionalBias || calculateCsaDirectionalBias([], []);

  const progressionLines = Array.isArray(bias.progression)
    ? bias.progression.map((line) => `- ${line}`).join("\n")
    : "- Not enough progression data available.";

  return `
${dateBlock}

Market-data reference status: available.
Provider: Twelve Data.
Symbol used: ${reference.symbol}.
Timeframe interval used to calculate daily highs/lows: ${reference.interval}.
Timezone used: ${reference.timezone}.
Week requested: ${reference.weekRange.startDate} to ${
    reference.weekRange.fridayDate
  }.
Data used up to: ${reference.weekRange.endDate}.
Raw candles returned: ${reference.rawCandleCount}.
Sunday candles: ignored.

MONDAY-TO-FRIDAY CSA AREA BREAKDOWN FROM BACKEND:
${dayBlocks}

CSA DIRECTIONAL BIAS FROM BACKEND:
- Bias: ${bias.bias}
- Confidence: ${bias.confidence}
- Bullish score: ${bias.bullishScore}
- Bearish score: ${bias.bearishScore}
- High breaks: ${bias.highBreakCount}
- Low breaks: ${bias.lowBreakCount}
- Demand holds: ${bias.demandHoldCount}
- Supply holds: ${bias.supplyHoldCount}
- Bias reason: ${bias.reason}
- Trend trading focus: ${bias.trendTradingFocus}
- Counter-trend caution: ${bias.counterTrendCaution}

CSA progression notes:
${progressionLines}

CURRENT KEY AREAS OF INTEREST FROM BACKEND:
Key Resistance Areas:
${formatAreaList(resistanceAreas)}

Key Support Areas:
${formatAreaList(supportAreas)}

Key Supply Areas:
${formatAreaList(supplyAreas)}

Key Demand Areas:
${formatAreaList(demandAreas)}

Important: Use these backend-calculated OHLC values, CSA area calculations, CSA directional bias, and current key areas as the source of truth. Use the uploaded chart image only for visual context and mismatch checks.
`;
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "CSA Coach backend is running",
  });
});

app.get("/test-twelve", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol || "GBP/USD");
    const timeframe = req.query.timeframe || "H1";
    const date = req.query.date || "2026-07-03";
    const timezone = req.query.timezone || "UTC";

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
    });

    res.json({
      ok: result.ok,
      symbol,
      timeframe,
      interval: result.interval,
      date,
      timezone,
      error: result.error,
      weekRange: result.weekRange,
      rawCandleCount: result.rawCandleCount,
      dailyLevels: result.dailyLevels,
      csaAreas: result.csaAreas,
      directionalBias: result.directionalBias,
    });
  } catch (error) {
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
        error: "OPENAI_API_KEY is missing on the server.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "No chart image uploaded.",
      });
    }

    const {
      timeframe = "Not provided",
      instrument = "",
      pair = "",
      selectedPair = "",
      analysisType = "area-identification",
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

    const imageBase64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/png";

    const selectedDate = parseISODateOnly(chartDate || tradeDate);

    const chartDetection = await detectChartContextFromImage({
      imageBase64,
      mimeType,
    });

    const dateDecision = chooseFinalChartDate({
      selectedDate,
      detection: chartDetection,
    });

    const marketReference = await fetchTwelveDataIntradayLevels({
      symbol: normalizedSymbol,
      chartDate: dateDecision.finalDate,
      timeframe,
      timezone: timezone || "UTC",
    });

    const marketDataSummary = buildMarketDataSummary(
      marketReference,
      dateDecision,
      chartDetection
    );

    const userContext = `
User submitted a chart for CSA Coach area identification and CSA directional bias review.

User-selected details:
- Timeframe selected by user: ${timeframe}
- Instrument selected by user: ${submittedInstrument}
- Normalized market-data symbol: ${normalizedSymbol || "Not available"}
- User-selected chart/trade date: ${chartDate || tradeDate || "Not provided"}
- Timezone: ${timezone || "UTC"}
- Analysis type: ${analysisType}
- User notes: ${submittedNotes}

AI chart pre-check:
- Detected instrument from chart: ${
      chartDetection.detectedInstrument || "Not detected"
    }
- Detected timeframe from chart: ${
      chartDetection.detectedTimeframe || "Not detected"
    }
- Detected latest visible chart date: ${
      chartDetection.latestVisibleDate || "Not detected"
    }
- Date confidence: ${chartDetection.dateConfidence || "low"}
- Detection notes: ${chartDetection.notes || ""}

Current task:
Identify CSAFOREX areas of interest and CSA directional bias only.

Focus only on:
- Market-data-backed Monday-to-Friday data for the final visible chart date used by the backend
- Support areas
- Resistance areas
- Supply zones
- Demand zones
- Directional bias based on CSA level progression
- Trend-trading focus based on CSA bias
- Counter-trend caution based on CSA bias

Do not analyze:
- Entry
- Stop loss
- Take profit
- Risk-to-reward
- Trade management
- Trade outcome
- Trade signal
- Trade grade

${marketDataSummary}
`;

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: CSA_FRAMEWORK_RULES,
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: userContext,
            },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${imageBase64}`,
            },
          ],
        },
      ],
      max_output_tokens: 2400,
    });

    const analysis =
      response.output_text || "No analysis was returned. Please try again.";

    const bias =
      marketReference.directionalBias || calculateCsaDirectionalBias([], []);

    res.json({
      success: true,
      analysis,
      summary: analysis,
      selectedPair: submittedInstrument,
      selectedTimeframe: timeframe,
      selectedDate: chartDate || tradeDate || "Not provided",
      detectedPair:
        chartDetection.detectedInstrument || normalizedSymbol || "Not available",
      detectedTimeframe: chartDetection.detectedTimeframe || timeframe,
      detectedLatestVisibleDate:
        chartDetection.latestVisibleDate || "Not detected",
      finalDateUsed: dateDecision.finalDateText,
      dateDecision,
      csaDirectionalBias: bias,
      contextStatus: marketReference.ok
        ? "Market-data-backed area identification and directional bias completed"
        : `Area identification completed without market data: ${marketReference.error}`,
      grade: "--",
      confidence: 0,
      structureScore: 0,
      executionScore: 0,
      riskScore: 0,
      strengths: marketReference.ok
        ? [
            `CSA areas calculated from Twelve Data ${marketReference.interval} candles for the selected Monday-to-Friday week.`,
            `CSA directional bias calculated as ${bias.bias} with ${bias.confidence} confidence.`,
          ]
        : [
            "CSA area identification completed using the uploaded chart, but market-data reference was unavailable.",
          ],
      weaknesses: marketReference.ok
        ? [
            "Broker chart prices may differ slightly from Twelve Data reference levels.",
            "CSA directional bias is structural context only, not a buy/sell signal.",
          ]
        : [marketReference.error || "Market-data reference unavailable."],
      coachAdvice: [analysis],
      journalTags: [
        "area identification only",
        "directional bias",
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`CSA Coach backend running on port ${PORT}`);
});
