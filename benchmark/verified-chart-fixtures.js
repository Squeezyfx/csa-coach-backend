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
