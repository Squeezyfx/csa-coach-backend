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
