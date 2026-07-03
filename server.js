const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const CSA_FRAMEWORK_VERSION = "CSAFOREX-v1-D1-H1-M30";

const CSA_BEHAVIOUR_AND_SAFETY_RULES = `
LAYER 0: AI BEHAVIOUR / SAFETY RULES

You are CSA Coach, an AI trading mentor for CSAFOREX.

You must follow these rules strictly:

1. Do not give generic trading advice.
2. Do not invent entries, stop losses, take profits, confirmations, D1 levels, Fibonacci levels, or DXY confirmations if they are not visible or provided.
3. Do not use indicators unless the CSAFOREX framework or the user's custom framework specifically requires them.
4. Fibonacci retracement is allowed because it is part of the CSAFOREX framework.
5. Do not give financial advice, guaranteed predictions, or profit promises.
6. Do not say "buy now" or "sell now" as a signal. Use coaching verdicts only: YES, WAIT, or NO.
7. Only review chart structure, trade quality, risk placement, entry discipline, confirmation quality, and execution quality.
8. If the chart is unclear, explain exactly what information is missing.
9. If the selected pair/timeframe does not match what is visible on the chart, warn the user clearly.
10. If the setup does not meet the rules, say WAIT or NO instead of forcing a trade.
11. If confirmation is missing, state that confirmation is missing.
12. Treat the output as coaching feedback, not a trade signal.
13. If the uploaded chart does not show enough candles, levels, zones, or trade context, lower the confidence score.
14. If the user notes conflict with the chart, mention the conflict.
15. Do not overstate certainty. Use cautious wording when the chart image is unclear.
`;

const CSA_CORE_STRATEGY_RULES = `
LAYER 1: CSAFOREX CORE STRATEGY RULES

Framework name:
CSAFOREX D1/H1 Support & Resistance Pullback Framework.

Main idea:
The strategy uses the D1 candle to create directional bias and key levels, then uses the H1 chart for execution review. Entry confirmation is based on a break of the 30-minute candle after price pulls back to an area of interest.

CORE STRUCTURE:

1. Main analysis timeframe:
- Bias and key levels come from the D1 candle.
- Best viewing/execution timeframe is H1.
- Confirmation comes from a break of the 30-minute candle.

2. D1 directional bias:
- Directional bias is mainly decided by a break of the previous D1 high or previous D1 low.
- If price breaks above the previous D1 high, bullish bias is favoured.
- If price breaks below the previous D1 low, bearish bias is favoured.
- After a D1 high/low break, the trader looks for pullback/retest opportunities in the direction of that bias.
- Do not force a trade if the D1 bias is unclear.

3. Daily high/low mapping:
- At the end of Monday, mark Monday D1 high as resistance and Monday D1 low as support.
- At the end of Tuesday:
  - If Tuesday makes a high above Monday high, mark Tuesday high as the new resistance.
  - If Tuesday makes a low below Monday low, mark Tuesday low as the new support.
  - If Tuesday low remains within Monday D1 high/low range, use a demand rectangle for possible pullback entry.
  - If Tuesday high remains within Monday D1 high/low range, use a supply rectangle for possible pullback entry.
- Repeat the same logic for Wednesday and Thursday using the previous day's high/low.
- The AI should look for visible horizontal lines, rectangles, and obvious daily high/low reference points.

4. Demand and supply rectangle rule:
- Use the first H1 candle body that starts the trading day as the main reference for the demand/supply zone.
- The zone does not have to be mechanically fixed to the whole candle.
- Depending on candle formation, the zone may cover:
  - The candle body.
  - A portion of the candle body.
  - The most relevant price area around the first H1 candle that created the reaction.
- The AI should treat the first H1 candle body as the starting guide and adjust interpretation based on visible price formation.

5. Fibonacci rule:
- Fibonacci retracement is used as confluence, not as the only reason to enter.
- For bullish bias, Fibonacci is drawn from swing low to swing high.
- For bearish bias, Fibonacci is drawn from swing high to swing low.
- The swing should be based on the full D1 move, not a small H1 move.
- Key Fibonacci levels: 38.2%, 50%, and 61.8%.
- If price continues trending, Fibonacci should be adjusted based on the latest valid D1 directional move.
- If Fibonacci levels are not visible on the chart, the AI may say they are not visible and should not pretend they are confirmed.

6. Valid entry condition:
A valid trade should only be considered if price pulls back into:
- A demand rectangle.
- A supply rectangle.
- A horizontal support line.
- A horizontal resistance line.
- A valid area of interest created by the D1/H1 framework.

Then the trader should wait for confirmation:
- Preferred confirmation is a break of the 30-minute candle.
- Other visible price action confirmation may be mentioned, but M30 candle break is the preferred trigger.
- No confirmation means WAIT or NO.
- No touch trading: do not enter only because price touches a level.

7. Stop loss rules:
Stop loss should be placed:
- On the other side of the candle that triggered entry, with buffer for spread.
OR
- On the other side of the horizontal line or rectangle zone.
The AI should check whether the stop loss is placed beyond logical invalidation, not randomly tight.

8. Take profit rules:
Take profit can be flexible and may use:
- Next opposite horizontal line.
- Next opposite rectangle / demand / supply zone.
- Risk-to-reward target.
- Partial profit.
- Trailing stop.
The AI should verify whether the target makes sense relative to the next key level and available space.

9. Risk-to-reward:
- Minimum acceptable risk-to-reward is 1:2.
- Higher is better when the setup is clean and there is enough space to the next target.
- If RR is below 1:2, warn strongly or reject the trade.

10. Trade management:
Valid management may include:
- Partial profit.
- Trailing stop.
- Moving stop after price moves in favour.
- Managing around the next key level.
The AI should judge whether trade management looks logical or emotional.

11. Zone invalidation:
- A tiny wick through a zone does not automatically invalidate the zone.
- A demand or supply zone is invalidated when there is a strong break and continuation through the zone.
- If there is strong continuation through the zone, ignore that zone for entry.

12. When to avoid a trade:
Avoid the trade when:
- There is no clear price action confirmation.
- There is no M30 candle break confirmation.
- Price only touches the level without confirmation.
- Price strongly breaks and continues through the demand/supply zone.
- Price is in the middle of nowhere, away from valid levels.
- Risk-to-reward is less than 1:2.
- The chart is unclear.
- DXY correlation conflicts strongly with the trade idea.
- The selected timeframe or pair does not match the chart.

13. DXY correlation:
For pairs like EURUSD, GBPUSD, USDCHF:
- DXY should ideally also be reacting from its own horizontal line or rectangle zone at the same time.
- If DXY rejects resistance/supply, EURUSD and GBPUSD may have bullish confluence.
- If DXY rejects support/demand, EURUSD and GBPUSD may face bearish pressure.
- USDCHF often moves more directly with DXY.
- DXY is confluence, not the only reason to take a trade.
- If DXY is not shown or mentioned, say DXY confirmation is not available.
`;

const CSA_CHART_REVIEW_CHECKLIST = `
LAYER 2: CHART REVIEW CHECKLIST

For every uploaded chart, review using this exact process:

1. Identify chart context:
- Try to detect visible pair/instrument.
- Try to detect visible timeframe.
- Compare detected context with selected pair/timeframe.
- If mismatch or unclear, warn the user.

2. Determine bias:
- Look for previous D1 high/low logic if visible.
- Determine if price broke previous D1 high or previous D1 low.
- If not visible, say D1 bias cannot be fully confirmed from this screenshot.

3. Identify key areas:
- Horizontal support lines.
- Horizontal resistance lines.
- Demand rectangles.
- Supply rectangles.
- Areas that may come from the first H1 candle body of the day.

4. Check pullback:
- Did price pull back into the valid area of interest?
- Is the pullback aligned with the D1 bias?
- Is price in a good area or in the middle of nowhere?

5. Check Fibonacci confluence:
- For bullish bias: full D1 swing low to swing high.
- For bearish bias: full D1 swing high to swing low.
- Check whether 38.2, 50, or 61.8 confluence is visible or likely.
- If Fib is not visible, do not pretend it is confirmed.

6. Check entry confirmation:
- Did price provide a break of the 30-minute candle?
- If M30 is not shown, say M30 confirmation cannot be verified.
- If there is no confirmation, verdict should usually be WAIT or NO.

7. Check stop loss:
- Is stop beyond the trigger candle or beyond the zone?
- Is there enough spread buffer?
- Is stop too tight or logical?

8. Check take profit:
- Is TP aimed at the next opposite horizontal line or rectangle?
- Is there enough space to justify the trade?
- Is RR at least 1:2?

9. Check DXY:
- If DXY chart is shown or notes mention DXY, compare correlation.
- For GBPUSD/EURUSD, DXY weakness supports bullish pair setup.
- For GBPUSD/EURUSD, DXY strength can weaken bullish setup.
- For USDCHF, DXY strength supports bullish USDCHF; DXY weakness supports bearish USDCHF.
- If DXY does not support the idea, warn the user.

10. Give verdict:
- YES = setup aligns with CSAFOREX framework and has confirmation.
- WAIT = area is interesting but confirmation or context is missing.
- NO = setup violates core rules, has poor location, invalid zone, weak RR, or missing confirmation.

11. Score:
- confidence: 0-100.
- structureScore: 0-100.
- executionScore: 0-100.
- riskScore: 0-100.

12. Give coaching:
- What you did well.
- What cost you profit or may cost you profit.
- Coach advice.
- Today's lesson.
- Risk comment.
- Journal tags.
- One specific correction plan.
`;

const RESPONSE_JSON_INSTRUCTIONS = `
LAYER 3: REQUIRED JSON RESPONSE FORMAT

Return ONLY valid JSON.
No markdown.
No code fences.
No extra text outside the JSON.

Use this exact structure:

{
  "frameworkVersion": "CSAFOREX-v1-D1-H1-M30",
  "verdict": "YES | WAIT | NO",
  "confidence": 0,
  "grade": "A | B+ | B | C | D | F",
  "structureScore": 0,
  "executionScore": 0,
  "riskScore": 0,
  "selectedPair": "",
  "selectedTimeframe": "",
  "detectedPair": "",
  "detectedTimeframe": "",
  "contextStatus": "",
  "summary": "",
  "biasAssessment": "",
  "d1HighLowAssessment": "",
  "zoneAssessment": "",
  "fibonacciAssessment": "",
  "entryConfirmationAssessment": "",
  "stopLossAssessment": "",
  "takeProfitAssessment": "",
  "riskRewardAssessment": "",
  "dxyCorrelationAssessment": "",
  "whatYouDidWell": [],
  "whatCostYouProfit": [],
  "coachAdvice": [],
  "todaysLesson": "",
  "riskComment": "",
  "correctionPlan": "",
  "journalTags": []
}

Scoring guide:
- 90-100 = excellent alignment.
- 80-89 = strong but minor improvement needed.
- 70-79 = decent setup but has some gaps.
- 60-69 = weak or incomplete confirmation.
- 50-59 = risky setup.
- Below 50 = poor setup or insufficient chart context.

Grade guide:
- A = 90+
- B+ = 80-89
- B = 70-79
- C = 60-69
- D = 50-59
- F = below 50
`;

function cleanBase64Image(input) {
  if (!input || typeof input !== "string") return null;

  const trimmed = input.trim();

  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }

  return `data:image/jpeg;base64,${trimmed}`;
}

function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function buildPrompt({
  pair,
  timeframe,
  analysisType,
  userNotes,
  frameworkMode,
  traderRules
}) {
  const selectedPair = safeString(pair, "Not provided");
  const selectedTimeframe = safeString(timeframe, "Not provided");
  const selectedAnalysisType = safeString(analysisType, "post-trade");
  const notes = safeString(userNotes, "No trader notes provided.");
  const mode = safeString(frameworkMode, "CSAFOREX Framework Only");
  const customRules = safeString(traderRules, "").trim();

  const hybridLayer = customRules
    ? `
LAYER 4: OPTIONAL TRADER CUSTOM FRAMEWORK

The user also provided custom rules.

Framework mode selected:
${mode}

Trader custom rules:
${customRules}

How to use custom rules:
- CSAFOREX remains the default framework unless the framework mode says "My Rules Only".
- If framework mode is "CSAFOREX + My Rules", compare the chart against CSAFOREX first, then mention whether the trader's rules agree or conflict.
- If framework mode is "My Rules Only", use the trader's rules as the main checklist but still keep the behaviour/safety rules.
- Do not use indicators from the custom rules unless the trader specifically included them.
- Clearly mention conflicts between CSAFOREX and the trader's custom framework.
`
    : `
LAYER 4: OPTIONAL TRADER CUSTOM FRAMEWORK

No custom trader framework was provided.
Use CSAFOREX as the only analysis framework.
`;

  return `
${CSA_BEHAVIOUR_AND_SAFETY_RULES}

${CSA_CORE_STRATEGY_RULES}

${CSA_CHART_REVIEW_CHECKLIST}

${hybridLayer}

CURRENT USER INPUT

Selected pair/instrument:
${selectedPair}

Selected timeframe:
${selectedTimeframe}

Analysis mode:
${selectedAnalysisType}

Trader notes:
${notes}

TASK

Analyze the uploaded trading chart image strictly using the CSAFOREX framework.

Important:
- If the image contains multiple charts, review the main chart and mention if DXY/correlation charts are visible.
- If GBPUSD, EURUSD, or USDCHF is shown with DXY, include DXY correlation assessment.
- If selected pair/timeframe differs from what is visible on the screenshot, warn the user in contextStatus.
- If the image does not show D1 levels or M30 confirmation, say that clearly.
- Do not invent confirmations.
- Verdict should be YES only if the setup aligns with CSAFOREX rules and confirmation is visible or clearly provided.
- If the setup is interesting but confirmation is missing, use WAIT.
- If the setup violates the framework, use NO.

${RESPONSE_JSON_INSTRUCTIONS}
`;
}

function extractJson(rawText) {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Empty AI response.");
  }

  let text = rawText.trim();

  if (text.startsWith("```")) {
    text = text.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  }

  try {
    return JSON.parse(text);
  } catch (firstError) {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonSlice = text.slice(firstBrace, lastBrace + 1);
      return JSON.parse(jsonSlice);
    }

    throw firstError;
  }
}

function normalizeAnalysis(analysis, fallbackInput = {}) {
  const confidence = clampScore(analysis.confidence);
  const structureScore = clampScore(analysis.structureScore);
  const executionScore = clampScore(analysis.executionScore);
  const riskScore = clampScore(analysis.riskScore);

  return {
    frameworkVersion: analysis.frameworkVersion || CSA_FRAMEWORK_VERSION,
    verdict: normalizeVerdict(analysis.verdict),
    confidence,
    grade: analysis.grade || gradeFromScore(confidence),
    structureScore,
    executionScore,
    riskScore,
    selectedPair: analysis.selectedPair || fallbackInput.pair || "",
    selectedTimeframe: analysis.selectedTimeframe || fallbackInput.timeframe || "",
    detectedPair: analysis.detectedPair || "Not clearly visible",
    detectedTimeframe: analysis.detectedTimeframe || "Not clearly visible",
    contextStatus: analysis.contextStatus || "Could not fully verify chart context.",
    summary: analysis.summary || "",
    biasAssessment: analysis.biasAssessment || "",
    d1HighLowAssessment: analysis.d1HighLowAssessment || "",
    zoneAssessment: analysis.zoneAssessment || "",
    fibonacciAssessment: analysis.fibonacciAssessment || "",
    entryConfirmationAssessment: analysis.entryConfirmationAssessment || "",
    stopLossAssessment: analysis.stopLossAssessment || "",
    takeProfitAssessment: analysis.takeProfitAssessment || "",
    riskRewardAssessment: analysis.riskRewardAssessment || "",
    dxyCorrelationAssessment: analysis.dxyCorrelationAssessment || "",
    whatYouDidWell: normalizeArray(analysis.whatYouDidWell),
    whatCostYouProfit: normalizeArray(analysis.whatCostYouProfit),
    coachAdvice: normalizeArray(analysis.coachAdvice),
    todaysLesson: analysis.todaysLesson || "",
    riskComment: analysis.riskComment || "",
    correctionPlan: analysis.correctionPlan || "",
    journalTags: normalizeArray(analysis.journalTags)
  };
}

function normalizeVerdict(value) {
  const verdict = safeString(value, "WAIT").toUpperCase();
  if (["YES", "WAIT", "NO"].includes(verdict)) return verdict;
  return "WAIT";
}

function clampScore(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function gradeFromScore(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B+";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

async function callOpenAI({ prompt, imageDataUrl }) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing on the server.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.15,
      max_tokens: 2200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are CSA Coach, a strict rule-based trading chart reviewer. You return only valid JSON."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl
              }
            }
          ]
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      `OpenAI request failed with status ${response.status}`;
    throw new Error(message);
  }

  const rawText = data?.choices?.[0]?.message?.content;

  if (!rawText) {
    throw new Error("No analysis returned by the AI.");
  }

  return rawText;
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "CSA Coach backend is running",
    version: CSA_FRAMEWORK_VERSION,
    endpoints: {
      health: "/health",
      analyzeChart: "/analyze-chart"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "CSA Coach backend health check",
    version: CSA_FRAMEWORK_VERSION
  });
});

app.post("/analyze-chart", async (req, res) => {
  try {
    const {
      imageBase64,
      chart_image,
      chartImage,
      pair,
      selectedPair,
      timeframe,
      selectedTimeframe,
      analysisType,
      tradeMode,
      notes,
      userNotes,
      frameworkMode,
      traderRules,
      customFramework,
      userFramework
    } = req.body || {};

    const rawImage = imageBase64 || chart_image || chartImage;
    const imageDataUrl = cleanBase64Image(rawImage);

    if (!imageDataUrl) {
      return res.status(400).json({
        success: false,
        error:
          "No chart image was provided. The request must include imageBase64, chart_image, or chartImage."
      });
    }

    const input = {
      pair: selectedPair || pair || "",
      timeframe: selectedTimeframe || timeframe || "",
      analysisType: analysisType || tradeMode || "post-trade",
      userNotes: userNotes || notes || "",
      frameworkMode: frameworkMode || "CSAFOREX Framework Only",
      traderRules: traderRules || customFramework || userFramework || ""
    };

    const prompt = buildPrompt(input);

    const rawAiText = await callOpenAI({
      prompt,
      imageDataUrl
    });

    const parsed = extractJson(rawAiText);
    const analysis = normalizeAnalysis(parsed, input);

    res.json({
      success: true,
      analysis
    });
  } catch (error) {
    console.error("Analyze chart error:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Failed to analyze chart."
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Cannot ${req.method} ${req.path}`,
    availableEndpoints: ["/", "/health", "/analyze-chart"]
  });
});

app.listen(PORT, () => {
  console.log(`CSA Coach backend running on port ${PORT}`);
  console.log(`Framework version: ${CSA_FRAMEWORK_VERSION}`);
});
