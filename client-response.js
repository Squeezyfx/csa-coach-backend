/**
 * What a trader's browser is sent after a review, and what is kept in their journal.
 *
 * The engine works out far more than the page shows: highs and lows by period, candidates, candles, the AI's reading
 * of the chart. Anyone could read it in the browser's developer tools or in their own journal rows, which shows the
 * method. These are allow lists built from what the page code reads (27 Nov 2026), so a new field is not sent or
 * stored until it is added here. The benchmark runner keeps getting the full response (server.js decides that).
 * SLIM_RESPONSE=off restores the full response and journal record.
 */

export const slimResponseEnabled = (value = process.env.SLIM_RESPONSE) => String(value || "on").trim().toLowerCase() !== "off";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const pick = (source, keys) => {
  if (!isObject(source)) return source ?? null;
  const out = {};
  for (const key of keys) if (key in source) out[key] = source[key];
  return out;
};

// The pair/timeframe check box. The same object also carries the line readings, which name periods.
const CONTEXT_KEYS = ["selectedInstrument", "selectedTimeframe", "detectedInstrument", "detectedTimeframe", "status"];

// What the page reads about the chart itself: the "analysis stopped" panel, and the time used by "Best days and sessions".
const DETECTION_KEYS = [
  "isTradingChart",
  "detectedInstrument",
  "detectedTimeframe",
  "latestVisibleDate",
  "latestVisibleTime",
  "chartValidityReason",
  "insufficientDataReason",
];

const SCORE_KEYS = [
  "setupQuality", "setupQualityScore", "setupQualityLabel", "setupQualitySummary",
  "entryAccuracy", "entryAccuracyScore", "entryAccuracyLabel", "entryAccuracySummary",
  "riskManagement", "riskManagementScore", "riskManagementLabel", "riskManagementSummary",
  "structureScore", "executionScore", "riskScore",
  "scoreContext", "scoreDisplay", "displayLabels", "overallDisplayLabel",
  "setupQualityDisplayLabel", "entryAccuracyDisplayLabel", "riskManagementDisplayLabel",
  "confidence", "grade",
];

const FEEDBACK_KEYS = [
  "strengths", "whatYouDidWell", "weaknesses", "whatCostYouProfit",
  "mistakes", "mistakeHub", "mistakeDetectionHub", "aiMistakeDetectionHub",
];

const DASHBOARD_KEYS = [...SCORE_KEYS, ...FEEDBACK_KEYS];

const RESPONSE_KEYS = [
  "success", "analysisStopped", "errorType", "error", "message", "details",
  "entitlement", "savedToJournal", "saveReason", "reviewId", "chartImagePath", "cacheHit",
  "selectedPair", "pair", "selectedTimeframe", "timeframe", "selectedDate", "analysisType",
  "analysisFramework", "selectedStrategy", "strategyAssessment",
  "detectedPair", "detectedTimeframe", "detectedLatestVisibleDate", "finalDateUsed",
  "chartContextStatus", "contextStatus", "chartContextSummary",
  "analysis", "summary", "coachAdvice", "todaysLesson", "riskComment", "cleanChart",
  "starterRestricted", "lockedFeatures", "upgradeMessage",
  ...SCORE_KEYS,
  ...FEEDBACK_KEYS,
];

const slimDashboard = (dashboard) => {
  if (!isObject(dashboard)) return dashboard ?? null;
  const out = pick(dashboard, DASHBOARD_KEYS);
  for (const key of ["chartContextCheck", "contextCheck"]) {
    if (key in dashboard) out[key] = pick(dashboard[key], CONTEXT_KEYS);
  }
  return out;
};

export function toClientResponse(response) {
  if (!isObject(response)) return response;
  const out = pick(response, RESPONSE_KEYS);
  for (const key of ["chartContextCheck", "contextCheck", "chartContext"]) {
    if (key in response) out[key] = pick(response[key], CONTEXT_KEYS);
  }
  if ("chartDetection" in response) out.chartDetection = pick(response.chartDetection, DETECTION_KEYS);
  if ("finalFeedback" in response) out.finalFeedback = pick(response.finalFeedback, [...SCORE_KEYS, ...FEEDBACK_KEYS, "analysis"]);
  for (const key of ["dashboard", "dashboardFeedback", "dashboardCards"]) {
    if (key in response) out[key] = slimDashboard(response[key]);
  }
  return out;
}

// The saved journal record (raw_ai_response). Traders can read their own rows straight from the database, and the
// page uses only the review text, the chart picture, the scores and mistakes, and the chart time.
export function toJournalRecord(record) {
  if (!isObject(record)) return record;
  const out = pick(record, [
    "analysis", "cleanChart", "analysisFramework", "selectedStrategy", "personalStrategySnapshot",
  ]);
  if ("chartDetection" in record) out.chartDetection = pick(record.chartDetection, DETECTION_KEYS);
  if ("dashboard" in record) out.dashboard = slimDashboard(record.dashboard);
  return out;
}
