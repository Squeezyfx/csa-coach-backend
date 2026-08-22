const VERIFIED_BASELINES = Object.freeze({
  "2898": Object.freeze({
    id: "2898",
    instrument: "GBPUSD",
    timeframe: "H1",
    expectedDirection: "bullish",
    expectedEntry1: 1.35703,
    expectedEntry1Type: "converted support",
    expectedEntryCount: 1,
    forbiddenEntries: "1.35543",
  }),
  "2902": Object.freeze({
    id: "2902",
    instrument: "USA30",
    timeframe: "H1",
    expectedDirection: "bearish",
    expectedEntry1: 53275.60,
    expectedEntry1Type: "converted resistance",
    expectedEntry2: 53421.20,
    expectedEntry2Type: "converted resistance",
    entry2Required: true,
    expectedEntryCount: 2,
  }),
  "2901": Object.freeze({
    id: "2901",
    instrument: "USDCAD",
    timeframe: "H1",
    expectedDirection: "bearish",
    expectedEntry1: 1.38066,
    expectedEntry1Type: "supply",
    expectedEntry2: 1.38437,
    expectedEntry2Type: "converted resistance",
    entry2Required: true,
    expectedEntryCount: 2,
    forbiddenEntries: "1.38022,1.38767,1.39091",
  }),
  "2900": Object.freeze({
    id: "2900",
    instrument: "XAUUSD",
    timeframe: "H1",
    expectedDirection: "bullish",
    expectedEntry1: 4436.15,
    expectedEntry1Type: "converted support",
    expectedEntryCount: 1,
    forbiddenEntries: "4367.25,4362.17",
  }),
  "2899": Object.freeze({
    id: "2899",
    instrument: "USDCHF",
    timeframe: "H1",
    expectedDirection: "bearish",
    expectedEntry1: 0.80711,
    expectedEntry1Type: "converted resistance",
    expectedEntryCount: 1,
  }),
});

function normalizeBenchmarkId(value = "") {
  return String(value || "")
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .toLowerCase();
}

export function getVerifiedBaseline(label = "", fileName = "") {
  const labelId = normalizeBenchmarkId(label);
  const fileId = normalizeBenchmarkId(fileName);
  const baseline = VERIFIED_BASELINES[labelId] || VERIFIED_BASELINES[fileId] || null;
  return baseline ? { ...baseline } : null;
}

export function listVerifiedBaselines() {
  return Object.values(VERIFIED_BASELINES).map((baseline) => ({ ...baseline }));
}
