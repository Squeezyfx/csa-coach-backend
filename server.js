import express from "express";
import cors from "cors";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "15mb" }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "CSA Coach backend is running",
    version: "2.0-chart-specific",
    endpoints: { analyzeChart: "/analyze-chart" }
  });
});

app.post("/analyze-chart", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "OPENAI_API_KEY is missing on the server. Add it in Render under Environment Variables."
      });
    }

    // Accept both field names so the frontend and backend cannot easily mismatch.
    const imageBase64 = req.body.imageBase64 || req.body.chart_image || req.body.image || req.body.chartImage;
    const mode = req.body.mode || "Pre-trade analysis";
    const pair = req.body.pair || "Not specified";
    const timeframe = req.body.timeframe || "Not specified";
    const notes = req.body.notes || "No extra notes provided.";
    const strategyProfile = req.body.strategy_profile || "CSA Framework";

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: "No chart image was provided. The request must include imageBase64 or chart_image."
      });
    }

    const prompt = `
You are CSA Coach™, an AI trading mentor that reviews forex chart screenshots using the CSA Forex Framework.

DO NOT give a generic answer. First read the uploaded chart and mention visible chart-specific observations. If the screenshot is unclear, say what is unclear and lower the confidence.

POSITIONING / SAFETY:
- Do not predict the future.
- Do not promise profits.
- Do not give financial advice.
- Your job is execution coaching: structure, support/resistance, retest quality, risk, discipline, and rule-following.
- Speak like a direct but calm human mentor.

CSA FOREX FRAMEWORK TO APPLY:
1. Start with clean support and resistance, not random indicators.
2. Prefer trades aligned with higher-timeframe bias where the chart gives enough context.
3. Look for support-to-resistance or resistance-to-support flip zones.
4. Best entries happen around a retest/confirmation area, not after price has already run far away.
5. Stop loss should be beyond the invalidation swing/zone with breathing room, not squeezed too tight.
6. Take profit should target the next clean opposing level/liquidity area when visible.
7. There must be enough room from entry to target to justify the risk.
8. Avoid chasing impulsive candles.
9. Avoid buying directly into resistance or selling directly into support.
10. Judge discipline and rule-following more than whether the trade later won or lost.
11. Ignore ICT/SMC/Elliott Wave labels unless they are visibly relevant; still grade mainly with CSA support/resistance rules.

USER CONTEXT:
Coaching mode: ${mode}
Strategy profile: ${strategyProfile}
Pair: ${pair}
Timeframe: ${timeframe}
Trader notes: ${notes}

MODE-SPECIFIC INSTRUCTIONS:
- If mode is pre-trade, answer whether the trader should take the trade now, wait, or avoid it.
- If mode is post-trade, review whether the trader followed the plan and what should improve.

OUTPUT RULES:
Return valid JSON only. No markdown. Use this exact structure:
{
  "verdict": "YES / NO / WAIT",
  "confidence": 0,
  "executionScore": 0,
  "structureScore": 0,
  "riskScore": 0,
  "grade": "A / B / C / D",
  "summary": "Short chart-specific mentor summary.",
  "chartObservations": ["visible observation 1", "visible observation 2", "visible observation 3"],
  "whatYouDidWell": ["point 1", "point 2", "point 3"],
  "whatCostYouProfit": ["point 1", "point 2"],
  "coachAdvice": ["point 1", "point 2", "point 3"],
  "todaysLesson": "One clear lesson for the trader.",
  "riskComment": "Short risk-management comment.",
  "journalTags": ["tag1", "tag2", "tag3"]
}

Scoring rules:
- confidence, executionScore, structureScore, and riskScore must be numbers from 0 to 100.
- verdict must be YES, NO, or WAIT.
- For unclear screenshots, use WAIT or NO and explain what is missing.
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageBase64 } }
          ]
        }
      ],
      max_tokens: 1500
    });

    const content = response.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({ success: false, error: "No analysis was returned by the AI." });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      return res.status(500).json({ success: false, error: "AI returned invalid JSON.", raw: content });
    }

    return res.json({ success: true, analysis: parsed });
  } catch (error) {
    console.error("CSA Coach analysis error:", error);
    return res.status(500).json({ success: false, error: "Failed to analyze chart.", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CSA Coach backend running on port ${PORT}`));
