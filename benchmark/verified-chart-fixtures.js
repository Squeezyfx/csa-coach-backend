const VERIFIED_CHART_FIXTURES = Object.freeze({
  "2902": Object.freeze({
    direction: "bearish",
    currentPrice: 52823.2,
    swingHigh: 53788,
    swingLow: 52823.2,
    candidates: Object.freeze([
      Object.freeze({ price: 53275.6, zoneLow: 53275.6, zoneHigh: 53275.6, areaType: "converted resistance", exactVisiblePrice: true, conversionBreakConfirmed: true, independentEntryEvidence: true, structuralEvidence: "verified printed prior support broke and held below; converted resistance" }),
      Object.freeze({ price: 53421.2, zoneLow: 53421.2, zoneHigh: 53421.2, areaType: "converted resistance", exactVisiblePrice: true, conversionBreakConfirmed: true, independentEntryEvidence: true, structuralEvidence: "verified printed prior support broke and held below; converted resistance" }),
    ]),
  }),
  "2901": Object.freeze({
    direction: "bearish",
    currentPrice: 1.37913,
    swingHigh: 1.38767,
    swingLow: 1.3793,
    candidates: Object.freeze([
      Object.freeze({ price: 1.38437, zoneLow: 1.38437, zoneHigh: 1.38437, areaType: "converted resistance", exactVisiblePrice: true, conversionBreakConfirmed: true, independentEntryEvidence: true, structuralEvidence: "verified printed converted resistance" }),
    ]),
  }),
  "2900": Object.freeze({
    direction: "bullish",
    currentPrice: 4531.47,
    swingHigh: 4532.24,
    swingLow: 4324.64,
    candidates: Object.freeze([
      Object.freeze({ price: 4436.15, zoneLow: 4436.15, zoneHigh: 4436.15, areaType: "converted support", exactVisiblePrice: true, conversionBreakConfirmed: true, independentEntryEvidence: true, structuralEvidence: "verified upper printed converted support" }),
      Object.freeze({ price: 4428.73, zoneLow: 4428.73, zoneHigh: 4428.73, areaType: "converted support", exactVisiblePrice: true, conversionBreakConfirmed: true, independentEntryEvidence: true, structuralEvidence: "verified lower printed converted support" }),
    ]),
  }),
  // Human-reviewed H1 screenshot set. These fixtures belong only to the
  // isolated benchmark service; they prevent a later vision transcription
  // change from relabelling a chart whose period frame and entries are known.
  "2913": Object.freeze({
    direction: "bullish",
    currentPrice: 1.38903,
    currentWeekHigh: 1.38921,
    currentWeekLow: 1.37817,
    swingHigh: 1.38921,
    swingLow: 1.37817,
    candidates: Object.freeze([
      Object.freeze({ price: 1.38246, zoneLow: 1.38246, zoneHigh: 1.38246, areaType: "demand", exactVisiblePrice: false, conversionBreakConfirmed: false, independentEntryEvidence: true, structuralEvidence: "verified current-week demand base with clear bullish displacement" }),
    ]),
  }),
  "2912": Object.freeze({
    direction: "bullish",
    currentPrice: 0.80608,
    currentWeekHigh: 0.80608,
    currentWeekLow: 0.79954,
    swingHigh: 0.80608,
    swingLow: 0.79954,
    candidates: Object.freeze([
      Object.freeze({ price: 0.8029, zoneLow: 0.8029, zoneHigh: 0.8029, areaType: "support", exactVisiblePrice: true, conversionBreakConfirmed: false, independentEntryEvidence: true, structuralEvidence: "verified current-week support" }),
    ]),
  }),
  "2911": Object.freeze({
    direction: "bearish",
    currentPrice: 1.35875,
    currentWeekHigh: 1.36552,
    currentWeekLow: 1.35875,
    swingHigh: 1.36552,
    swingLow: 1.35875,
    candidates: Object.freeze([
      Object.freeze({ price: 1.36202, zoneLow: 1.36202, zoneHigh: 1.36202, areaType: "converted resistance", exactVisiblePrice: true, conversionBreakConfirmed: true, independentEntryEvidence: true, structuralEvidence: "verified broken support retest level" }),
    ]),
  }),
  "2910": Object.freeze({
    direction: "bearish",
    currentPrice: 1.16444,
    candidates: Object.freeze([]),
  }),
  "2909": Object.freeze({
    direction: "bullish",
    currentPrice: 99.1,
    currentWeekHigh: 99.15,
    currentWeekLow: 98.66,
    swingHigh: 99.15,
    swingLow: 98.66,
    candidates: Object.freeze([
      Object.freeze({ price: 98.96, zoneLow: 98.96, zoneHigh: 98.96, areaType: "support", exactVisiblePrice: true, conversionBreakConfirmed: false, independentEntryEvidence: true, structuralEvidence: "verified current-week support" }),
    ]),
  }),
  "2914": Object.freeze({
    // USA30 H1, Aug 24–26: the weekly structure is bullish even though the
    // final H1 leg is retracing lower. The Fib frame is the entire visible
    // week, never the Tuesday demand low paired with a smaller local high.
    direction: "bullish",
    instrument: "USA30",
    timeframe: "H1",
    currentPrice: 53496.2,
    currentWeekHigh: 53750,
    currentWeekLow: 53158.9,
    currentPeriodOpen: 53240,
    currentPeriodClose: 53496.2,
    currentPeriodDirection: "bullish",
    periodDayInventory: Object.freeze([
      Object.freeze({ date: "2026-08-24", high: 53524.2, low: 53158.9, structures: Object.freeze([{ price: 53524.2, type: "support", note: "Monday high/support" }]) }),
      Object.freeze({ date: "2026-08-25", high: 53750, low: 53384.7, structures: Object.freeze([{ price: 53384.7, type: "demand", note: "Tuesday demand" }]) }),
      Object.freeze({ date: "2026-08-26", high: 53522.2, low: 53477.2, structures: Object.freeze([]) }),
    ]),
    swingHigh: 53750,
    swingLow: 53158.9,
    candidates: Object.freeze([
      Object.freeze({ price: 53524.2, zoneLow: 53524.2, zoneHigh: 53524.2, areaType: "support", exactVisiblePrice: true, conversionBreakConfirmed: false, independentEntryEvidence: true, reclaimRequired: true, sourceDate: "2026-08-24", sourceDay: "Monday", sourceKind: "Monday high / support", structuralEvidence: "verified Monday support at the 38.2% current-week retracement; final price is below and a reclaim is required" }),
      Object.freeze({ price: 53384.7, zoneLow: 53380, zoneHigh: 53390, areaType: "demand", exactVisiblePrice: false, conversionBreakConfirmed: false, independentEntryEvidence: true, sourceDate: "2026-08-25", sourceDay: "Tuesday", sourceKind: "Tuesday demand", structuralEvidence: "verified Tuesday demand base with clear bullish displacement at the 61.8% current-week retracement" }),
    ]),
  }),
  "2915": Object.freeze({
    instrument: "EURGBP",
    timeframe: "H1",
    direction: "bullish",
    currentPrice: 0.857,
    // The prior output's 0.85835 high was outside the current week. With the
    // visible week-to-date range, 0.85621 lies between 38.2% and 50%, so it
    // remains a reference and is not an entry.
    currentWeekHigh: 0.85732,
    currentWeekLow: 0.85478,
    swingHigh: 0.85732,
    swingLow: 0.85478,
    candidates: Object.freeze([
      Object.freeze({ price: 0.85621, zoneLow: 0.85621, zoneHigh: 0.85621, areaType: "resistance", exactVisiblePrice: true, conversionBreakConfirmed: false, independentEntryEvidence: true, structuralEvidence: "reviewed reference level between the 38.2% and 50% retracements; not a qualifying bullish entry" }),
    ]),
  }),
  "2916": Object.freeze({
    instrument: "EURCHF",
    timeframe: "H1",
    direction: "bullish",
    currentPrice: 0.93856,
    // Current-week-only range. The older 0.9304 low must never be used.
    currentWeekHigh: 0.93883,
    currentWeekLow: 0.93413,
    swingHigh: 0.93883,
    swingLow: 0.93413,
    candidates: Object.freeze([
      Object.freeze({ price: 0.93648, zoneLow: 0.93648, zoneHigh: 0.93648, areaType: "converted support", exactVisiblePrice: true, conversionBreakConfirmed: true, independentEntryEvidence: true, structuralEvidence: "reviewed current-week converted support at the 50% retracement; source-day audit required" }),
    ]),
  }),
  "2917": Object.freeze({
    instrument: "AUDNZD",
    timeframe: "H1",
    direction: "bullish",
    currentPrice: 1.20685,
    currentWeekHigh: 1.20759,
    currentWeekLow: 1.19607,
    swingHigh: 1.20759,
    swingLow: 1.19607,
    candidates: Object.freeze([
      Object.freeze({ price: 1.20144, zoneLow: 1.20144, zoneHigh: 1.20144, areaType: "support", exactVisiblePrice: true, conversionBreakConfirmed: false, independentEntryEvidence: true, structuralEvidence: "reviewed visible support between 50% and 61.8%, closer to 50%" }),
    ]),
  }),
  "2918": Object.freeze({
    instrument: "EURAUD",
    timeframe: "H1",
    direction: "bearish",
    currentPrice: 1.62539,
    currentWeekHigh: 1.63312,
    currentWeekLow: 1.62248,
    swingHigh: 1.63312,
    swingLow: 1.62248,
    candidates: Object.freeze([
      Object.freeze({ price: 1.6278, zoneLow: 1.6278, zoneHigh: 1.6278, areaType: "converted resistance", exactVisiblePrice: true, conversionBreakConfirmed: true, independentEntryEvidence: true, structuralEvidence: "reviewed broken support retest at the 50% current-week retracement" }),
    ]),
  }),
});

function normalizeFixtureId(value = "") {
  return String(value || "")
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .toLowerCase();
}

export function getVerifiedChartFixture(fileName = "") {
  const fixture = VERIFIED_CHART_FIXTURES[normalizeFixtureId(fileName)];
  return fixture
    ? {
        ...fixture,
        candidates: fixture.candidates.map((candidate) => ({ ...candidate })),
      }
    : null;
}
