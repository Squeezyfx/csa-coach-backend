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

Your current role is ONLY to identify CSAFOREX areas of interest on the uploaded chart.

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

CSAFOREX CURRENT FRAMEWORK STAGE:
The current framework stage is AREA IDENTIFICATION ONLY.

This means:
- Identify the most recent Monday-to-Friday trading data for the selected chart date.
- Use market-data OHLC values supplied by the backend as the source of truth for Monday-to-Friday highs/lows.
- Use the uploaded chart image for visual context only.
- Ignore Sunday candles.
- Do not analyze reaction type yet.
- Do not analyze entry trigger yet.
- Do not analyze stop loss yet.
- Do not analyze trade management yet.

HYBRID DATA RULE:
The backend may provide CSA reference data from Twelve Data.
If CSA reference data is provided, treat those OHLC values and CSA area calculations as the source of truth.
Do not override backend OHLC values with approximate readings from the screenshot.
Do not relabel a backend-provided Monday high as Tuesday high, or Tuesday high as Monday high.

The uploaded chart image is still useful for:
- Checking whether the selected instrument/timeframe visually matches the screenshot.
- Noting whether visible user-drawn lines/zones appear close to the backend-calculated CSA areas.
- Explaining the areas in a trader-friendly way.

If the chart image and backend market data appear slightly different, explain that small differences can happen because broker feeds and data providers may differ slightly.
Do not accuse the user of being wrong. Use cautious wording.

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
The CSA analysis must focus on the Monday-to-Friday week that contains the user-selected chart/trade date.
If the selected date is Wednesday, use Monday, Tuesday, and Wednesday data available up to that date.
If the selected date is Friday, use Monday through Friday data.
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

OUTPUT STYLE:
Be clear and structured.
Do not over-explain general trading theory.
Focus on the market-data-backed CSA areas for the selected week.

Your answer should follow this format:

- Data Source Check:
  State whether backend OHLC market data was provided.
  Mention that Twelve Data/reference feed levels may differ slightly from a broker screenshot.

- Week Used:
  State the Monday-to-Friday week/date range used.
  State that Sunday candles are ignored.

- Monday Areas:
  Identify Monday resistance and support using the provided OHLC values.

- Tuesday Areas:
  Compare Tuesday to Monday and identify Tuesday resistance/support/supply/demand if Tuesday data is available.

- Wednesday Areas:
  Compare Wednesday to Tuesday and identify Wednesday resistance/support/supply/demand if Wednesday data is available.

- Thursday Areas:
  Compare Thursday to Wednesday and identify Thursday resistance/support/supply/demand if Thursday data is available.

- Friday Areas:
  Compare Friday to Thursday and identify Friday resistance/support/supply/demand if Friday data is available.

- Current Key Areas of Interest:
  List the most important current support, resistance, supply, and demand areas from the selected week only.

- Chart/Image Notes:
  Briefly mention if the uploaded chart seems to match the selected pair/timeframe or if there is a visible mismatch.
  Do not rely on the screenshot for exact prices when backend OHLC data is available.

- Missing Information:
  State if chart date, instrument, or backend OHLC data was missing or incomplete.

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

async function fetchTwelveDataDailyLevels({ symbol, chartDate, timezone = "UTC" }) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      error: "TWELVE_DATA_API_KEY is missing on the server.",
      dailyLevels: [],
      csaAreas: [],
      weekRange: chartDate ? getWeekRangeForDate(chartDate) : null,
    };
  }

  if (!symbol) {
    return {
      ok: false,
      error: "Instrument/pair is missing or unsupported.",
      dailyLevels: [],
      csaAreas: [],
      weekRange: chartDate ? getWeekRangeForDate(chartDate) : null,
    };
  }

  if (!chartDate) {
    return {
      ok: false,
      error: "Chart / Trade Date is missing. Add a date so the backend can fetch the correct Monday-to-Friday data.",
      dailyLevels: [],
      csaAreas: [],
      weekRange: null,
    };
  }

  const weekRange = getWeekRangeForDate(chartDate);

  const params = new URLSearchParams({
    symbol,
    interval: "1day",
    start_date: `${weekRange.startDate} 00:00:00`,
    end_date: `${weekRange.endDate} 23:59:59`,
    timezone,
    order: "ASC",
    outputsize: "10",
    apikey: apiKey,
  });

  const url = `${TWELVE_DATA_BASE_URL}?${params.toString()}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.status === "error" || !Array.isArray(data.values)) {
    return {
      ok: false,
      error: data.message || data.error || `Twelve Data request failed with status ${response.status}.`,
      dailyLevels: [],
      csaAreas: [],
      weekRange,
      symbol,
      timezone,
    };
  }

  const dailyLevels = data.values
    .map((bar) => {
      const dateOnly = String(bar.datetime || "").slice(0, 10);
      const date = new Date(`${dateOnly}T00:00:00.000Z`);
      const dayNum = date.getUTCDay();

      return {
        date: dateOnly,
        weekday: weekdayNameFromDate(dateOnly),
        dayNum,
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
      };
    })
    .filter((bar) => bar.date && bar.dayNum >= 1 && bar.dayNum <= 5)
    .filter((bar) => bar.date >= weekRange.startDate && bar.date <= weekRange.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    ok: dailyLevels.length > 0,
    error: dailyLevels.length > 0 ? "" : "No Monday-to-Friday daily OHLC data was returned for the selected week.",
    dailyLevels,
    csaAreas: buildCsaAreas(dailyLevels),
    weekRange,
    symbol,
    timezone,
  };
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "N/A";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 100) return value.toFixed(3);
  if (Math.abs(value) >= 10) return value.toFixed(4);
  return value.toFixed(5);
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
        logic: `No previous visible weekday was available for comparison, so ${day.weekday} high is only a reference high.`,
      });

      areas.push({
        day: day.weekday,
        date: day.date,
        type: "reference low",
        price: day.low,
        priceText: formatPrice(day.low),
        logic: `No previous visible weekday was available for comparison, so ${day.weekday} low is only a reference low.`,
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

function buildMarketDataSummary(reference) {
  if (!reference || !reference.ok) {
    return `Market-data reference status: unavailable. Reason: ${reference?.error || "Unknown error"}`;
  }

  const dailyLines = reference.dailyLevels
    .map(
      (day) =>
        `- ${day.weekday} ${day.date}: open ${formatPrice(day.open)}, high ${formatPrice(day.high)}, low ${formatPrice(day.low)}, close ${formatPrice(day.close)}`
    )
    .join("\n");

  const areaLines = reference.csaAreas
    .map(
      (area) =>
        `- ${area.day} ${area.date}: ${area.type.toUpperCase()} at ${area.priceText}. ${area.logic}`
    )
    .join("\n");

  return `
Market-data reference status: available.
Provider: Twelve Data.
Symbol used: ${reference.symbol}.
Timezone used: ${reference.timezone}.
Week requested: ${reference.weekRange.startDate} to ${reference.weekRange.fridayDate}.
Data used up to: ${reference.weekRange.endDate}.
Sunday candles: ignored.

Daily OHLC reference:
${dailyLines || "No weekday data returned."}

CSA area calculations from backend:
${areaLines || "No CSA areas calculated."}

Important: Use these backend OHLC values and CSA area calculations as the source of truth for exact Monday-to-Friday highs/lows. Use the uploaded chart image only for visual context and mismatch checks.
`;
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "CSA Coach backend is running",
  });
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

    const submittedInstrument = instrument || pair || selectedPair || "Not provided";
    const submittedNotes = notes || userNotes || "";
    const normalizedSymbol = normalizeSymbol(submittedInstrument);
    const selectedDate = parseISODateOnly(chartDate || tradeDate);

    const marketReference = await fetchTwelveDataDailyLevels({
      symbol: normalizedSymbol,
      chartDate: selectedDate,
      timezone: timezone || "UTC",
    });

    const imageBase64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/png";
    const marketDataSummary = buildMarketDataSummary(marketReference);

    const userContext = `
User submitted a chart for CSA Coach area identification.

Chart details:
- Timeframe: ${timeframe}
- Instrument selected by user: ${submittedInstrument}
- Normalized market-data symbol: ${normalizedSymbol || "Not available"}
- Chart / trade date: ${chartDate || tradeDate || "Not provided"}
- Timezone: ${timezone || "UTC"}
- Analysis type: ${analysisType}
- User notes: ${submittedNotes}

Current task:
Identify CSAFOREX areas of interest only.

Focus only on:
- Market-data-backed Monday-to-Friday data for the selected week/date
- Support areas
- Resistance areas
- Supply zones
- Demand zones

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
      max_output_tokens: 1800,
    });

    const analysis = response.output_text || "No analysis was returned. Please try again.";

    res.json({
      success: true,
      analysis,
      summary: analysis,
      selectedPair: submittedInstrument,
      selectedTimeframe: timeframe,
      selectedDate: chartDate || tradeDate || "Not provided",
      detectedPair: normalizedSymbol || "Not available",
      detectedTimeframe: timeframe,
      contextStatus: marketReference.ok
        ? "Market-data-backed area identification completed"
        : `Area identification completed without market data: ${marketReference.error}`,
      grade: "--",
      confidence: 0,
      structureScore: 0,
      executionScore: 0,
      riskScore: 0,
      strengths: marketReference.ok
        ? ["CSA areas calculated from Twelve Data OHLC for the selected Monday-to-Friday week."]
        : ["CSA area identification completed using the uploaded chart, but market-data reference was unavailable."],
      weaknesses: marketReference.ok
        ? ["Broker chart prices may differ slightly from Twelve Data reference levels."]
        : [marketReference.error || "Market-data reference unavailable."],
      coachAdvice: [analysis],
      journalTags: ["area identification only", marketReference.ok ? "market-data-backed" : "vision-only fallback"],
      marketReference: {
        ok: marketReference.ok,
        error: marketReference.error,
        symbol: marketReference.symbol,
        timezone: marketReference.timezone,
        weekRange: marketReference.weekRange,
        dailyLevels: marketReference.dailyLevels,
        csaAreas: marketReference.csaAreas,
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
