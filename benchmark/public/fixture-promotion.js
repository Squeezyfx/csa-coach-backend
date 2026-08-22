const STRICT_PLANS = new Set(["starter", "pro", "elite"]);
const ZONE_TYPES = new Set(["demand", "supply"]);

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function entryPrice(entry) {
  return firstText(entry?.levelText, entry?.center);
}

function zoneBounds(entry) {
  const type = String(entry?.areaType || "").toLowerCase();
  const low = Number(entry?.zoneLow);
  const high = Number(entry?.zoneHigh);
  if (!ZONE_TYPES.has(type) || !Number.isFinite(low) || !Number.isFinite(high) || low === high) {
    return { low: "", high: "" };
  }
  return { low: String(Math.min(low, high)), high: String(Math.max(low, high)) };
}

export function strictFixtureFromAutomaticResult(item = {}, base = {}) {
  if (item.mode !== "automatic" || item.status !== "passed" || !item.validation || !item.analysis) {
    throw new Error("Only a consistent automatic result can be saved as a strict benchmark.");
  }

  const analysis = item.analysis;
  const detection = analysis.chartDetection || {};
  const summaryEntries = Array.isArray(item.validation.selectedEntries)
    ? item.validation.selectedEntries.slice(0, 3)
    : [];
  const structuredEntries = Array.isArray(analysis?.analysisFacts?.selectedEntryAreas)
    ? analysis.analysisFacts.selectedEntryAreas
    : [];
  const entries = summaryEntries.map((entry, index) => {
    const order = Number(entry?.order || index + 1);
    const structured = structuredEntries.find((candidate, candidateIndex) =>
      Number(candidate?.executionOrder || candidateIndex + 1) === order
    );
    return {
      ...(structured || {}),
      ...entry,
      zoneLow: structured?.zoneLow ?? entry?.zoneLow,
      zoneHigh: structured?.zoneHigh ?? entry?.zoneHigh,
    };
  });
  const entry1 = entries[0] || null;
  const entry2 = entries[1] || null;
  const entry3 = entries[2] || null;
  const entry1Zone = zoneBounds(entry1);
  const entry2Zone = zoneBounds(entry2);
  const entry3Zone = zoneBounds(entry3);
  const requiredPrices = entries.map(entryPrice).filter(Boolean);
  const requiredTerms = [...new Set(entries.map((entry) => String(entry?.areaType || "").trim()).filter(Boolean))];
  const detectedPlan = String(analysis?.entitlement?.basePlan || base.plan || "starter").toLowerCase();

  return {
    ...base,
    label: firstText(item.label, base.label),
    instrument: firstText(detection.detectedInstrument, analysis.detectedPair, analysis.selectedPair, base.instrument),
    timeframe: firstText(detection.detectedTimeframe, analysis.detectedTimeframe, analysis.selectedTimeframe, base.timeframe, "H1"),
    plan: STRICT_PLANS.has(detectedPlan) ? detectedPlan : "starter",
    analysisType: analysis.analysisType === "pre-trade" ? "pre-trade" : "post-trade",
    cutoffMode: "final_visible",
    chartDate: "",
    expectedDirection: String(item.validation.direction || "").toLowerCase(),
    expectedEntry1: entryPrice(entry1),
    expectedEntry1Type: String(entry1?.areaType || ""),
    expectedEntry1ZoneLow: entry1Zone.low,
    expectedEntry1ZoneHigh: entry1Zone.high,
    expectedEntry2: entryPrice(entry2),
    expectedEntry2Type: String(entry2?.areaType || ""),
    expectedEntry2ZoneLow: entry2Zone.low,
    expectedEntry2ZoneHigh: entry2Zone.high,
    entry2Required: Boolean(entry2),
    expectedEntry3: entryPrice(entry3),
    expectedEntry3Type: String(entry3?.areaType || ""),
    expectedEntry3ZoneLow: entry3Zone.low,
    expectedEntry3ZoneHigh: entry3Zone.high,
    entry3Required: Boolean(entry3),
    noEntryExpected: entries.length === 0,
    requiredLevels: requiredPrices.join(", "),
    requiredFeedbackLevels: requiredPrices.join(", "),
    requiredFeedbackTerms: requiredTerms.join(", "),
    forbiddenEntries: String(base.forbiddenEntries || ""),
    tolerance: String(base.tolerance || ""),
    notes: String(base.notes || ""),
    savedFromBuildId: String(item.validation?.versions?.buildId || ""),
    savedAt: new Date().toISOString(),
  };
}
