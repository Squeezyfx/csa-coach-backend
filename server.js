import express from "express";
import cors from "cors";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// For testing, this allows your GoHighLevel page to call the backend.
// Before public launch, replace "*" with your exact domain, e.g. "https://training.csaforex.com".
app.use(cors({ origin: "*" }));

// Allow chart screenshots as base64 strings.
app.use(express.json({ limit: "15mb" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "CSA Coach backend is running",
    endpoints: {
      analyzeChart: "/analyze-chart"
    }
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

    const { imageBase64, mode, pair, timeframe, notes } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: "No chart image was provided. Please upload a chart screenshot."
      });
    }

    const coachingMode = mode || "post-trade";
    const tradingPair = pair || "Not specified";
    const chartTimeframe = timeframe || "Not specified";
    const traderNotes = notes || "No extra notes provided.";

    const prompt = `
You are CSA Coach™, an AI trading mentor trained to review forex chart screenshots using the CSA Forex framework.

IMPORTANT SAFETY AND POSITIONING:
- You are not predicting the market.
- You are not promising profits.
- You are not giving financial advice.
- You are reviewing execution quality, rule-following, structure, risk, and discipline.
- Speak like a calm mentor, not like a generic AI.

CSA FRAMEWORK RULES:
1. Focus mainly on clean support and resistance levels.
2. Prefer higher-timeframe bias alignment where visible.
3. Look for support-to-resistance or resistance-to-support flip zones.
4. Entry should happen around retest areas, not after price has already moved too far.
5. Stop loss should sit beyond the invalidation area, not randomly tight.
6. Take profit should target the next clean opposing level when possible.
7. Good trades should have strong risk-to-reward potential.
8. Avoid chasing price.
9. Avoid entering directly into nearby resistance/support.
10. Judge the trader's discipline, not just whether the trade wins.
11. If the chart contains indicators, ignore them unless they clearly support the CSA support/resistance review.
12. If the chart is unclear, say what information is missing instead of pretending.

USER CONTEXT:
Coaching mode: ${coachingMode}
Pair: ${tradingPair}
Timeframe: ${chartTimeframe}
Trader notes: ${traderNotes}

HOW TO THINK:
- If mode is pre-trade, answer: should the trader take it now, wait, or avoid?
- If mode is post-trade, answer: did the trader follow the plan and what should improve?
- Give simple, practical coaching.
- Do not overuse ICT/SMC/Elliott Wave language unless it is clearly visible and relevant.
- Base the review mainly on CSA support/resistance, flip zones, retest quality, structure, risk, and execution.

Return your response as valid JSON only using this exact structure:

{
  "verdict": "YES / NO / WAIT",
  "confidence": 0,
  "executionScore": 0,
  "grade": "A / B / C / D",
  "summary": "Short human mentor-style summary.",
  "whatYouDidWell": ["point 1", "point 2", "point 3"],
  "whatCostYouProfit": ["point 1", "point 2"],
  "coachAdvice": ["point 1", "point 2", "point 3"],
  "todaysLesson": "One clear lesson for the trader.",
  "riskComment": "Short risk-management comment.",
  "journalTags": ["tag1", "tag2", "tag3"]
}

Rules for scores:
- confidence must be a number from 0 to 100.
- executionScore must be a number from 0 to 100.
- grade must be A, B, C, or D.
- verdict must be YES, NO, or WAIT.
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: imageBase64 }
            }
          ]
        }
      ],
      max_tokens: 1200
    });

    const content = response.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({
        success: false,
        error: "No analysis was returned by the AI."
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      return res.status(500).json({
        success: false,
        error: "AI returned invalid JSON.",
        raw: content
      });
    }

    res.json({
      success: true,
      analysis: parsed
    });
  } catch (error) {
    console.error("CSA Coach analysis error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to analyze chart.",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`CSA Coach backend running on port ${PORT}`);
});
