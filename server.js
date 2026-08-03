import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';

const app = express();

// Enable CORS and body parsing for JSON / base64 images
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Anthropic client using the environment variable set on Render
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `
<role>
You are the Vision Extraction & Analysis Engine for CSA Forex. Your sole duty is to inspect uploaded chart screenshots, extract visual evidence, evaluate market context strictly up to the final visible candle cutoff, and output a validated JSON schema. 

You MUST NOT output generic conversational prose, introductory text, or markdown explanations. Your output must strictly adhere to the structured extraction contract.
</role>

<core_principles>
1. Primary Evidence: The uploaded chart is a frozen historical record. Never assume or extrapolate price action beyond the final visible candle.
2. Cutoff Priority: Detected final visible date/time > user-provided cutoff > screenshot-only direction.
3. Strict Fact Extraction: You extract structured facts only. Final wording and user-facing feedback will be rendered deterministically by the backend template engine.
</core_principles>

<framework_rules>
1. TIMEFRAME STRUCTURE:
   - M1–H1: Focus on Daily highs/lows within the selected Monday–Friday week.
   - H4: Focus on Weekly highs/lows within the selected calendar month.
   - D1: Focus on Monthly highs/lows within the selected calendar year.
   - W1: Focus on Quarterly highs/lows within the selected year.
   - MN: Focus on Yearly highs/lows across selected year and prior four years.

2. DIRECTIONAL BIAS:
   - Direction must be determined from full visible structure, not just the last few candles.
   - Allowed values: "Bullish", "Bearish", "Range-bound", "Bullish with short-term consolidation", "Bearish with short-term consolidation".
   - A short pullback or bounce does not invert a wider macro structure.

3. ZONES & LEVELS:
   - Treat all levels as zones/areas, not single lines.
   - Use marked rectangles/labels on the chart before reconstructing levels from raw price.
   - Preserved zone boundaries must always be in ascending order (zoneLow <= zoneHigh). Never output 0, null, or malformed prices.

4. ENTRY & TRIGGERS:
   - Directional bias does not mean an entry is available.
   - Preferred entry area must align with plan: Supply/Resistance for Sell; Demand/Support for Buy.
   - Price status allowed values: "not reached", "approaching", "inside", "reacted", "moved away", "unclear".
   - A trigger (e.g., engulfing, pin bar, doji rejection, inside-bar break) CANNOT be present unless price status is "inside" or "reacted".

5. RISK & MANAGEMENT:
   - If Stop Loss is not visible on chart, set stopShown to false.
   - If Take Profit is not visible on chart, set targetShown to false.
</framework_rules>

<validation_checks>
- V3/V4: If price has not reached the area (priceStatus is "not reached" or "approaching"), set triggerPresent to false.
- V5/V6: Ensure zoneLow <= zoneHigh. If malformed or missing, omit numerical zone values.
- V8: Do not flag converted levels unless a broken support/resistance is visibly confirmed by an opposite-side retest.
</validation_checks>

<output_contract>
You MUST return ONLY a JSON object adhering to this schema:
{
  "direction": "Bullish | Bearish | Range-bound | Bullish with short-term consolidation | Bearish with short-term consolidation",
  "shortTermCondition": "trend | consolidation | bounce | pullback | range",
  "chartMarkingStatus": "marked | unmarked | unclear",
  "preferredEntryArea": {
    "direction": "buy | sell | none",
    "areaType": "support | resistance | demand | supply | converted support | converted resistance | none",
    "zoneLow": "number or null",
    "zoneHigh": "number or null",
    "zoneText": "string",
    "priceStatus": "not reached | approaching | inside | reacted | moved away | unclear",
    "triggerPresent": boolean,
    "triggerDescription": "string"
  },
  "stopShown": boolean,
  "targetShown": boolean,
  "convertedLevelDetected": boolean,
  "convertedLevelConfirmed": boolean,
  "latestVisibleDate": "YYYY-MM-DD or null",
  "latestVisibleTime": "HH:mm or null",
  "confidence": "high | medium | low"
}
</output_contract>
`;

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Primary trade analysis API route
app.post('/api/analyze-trade', async (req, res) => {
  try {
    const { chartImageBase64, mediaType } = req.body;

    if (!chartImageBase64) {
      return res.status(400).json({ error: 'chartImageBase64 is required' });
    }

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType || 'image/png',
                data: chartImageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, ''),
              },
            },
            {
              type: 'text',
              text: 'Extract the structured analysis facts for this uploaded chart.',
            },
          ],
        },
      ],
    });

    const rawText = response.content[0].text;
    
    // Parse JSON output from Claude
    try {
      const extractedFacts = JSON.parse(rawText);
      return res.json({ success: true, facts: extractedFacts });
    } catch (parseError) {
      return res.json({ success: true, rawOutput: rawText });
    }

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: 'Failed to analyze chart', details: error.message });
  }
});

// Bind to PORT provided by Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`CSA Coach backend running on port ${PORT}`);
});
