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
    // The prior output's 0.85835 high was outside the current week. The level
    // is a converted support after the visible break-and-hold and sits on the
    // 38.2%-side of the true current-week retracement, never at 61.8%.
    currentWeekHigh: 0.85732,
    currentWeekLow: 0.85478,
    swingHigh: 0.85732,
    swingLow: 0.85478,
    candidates: Object.freeze([
      Object.freeze({ price: 0.85621, zoneLow: 0.85621, zoneHigh: 0.85621, areaType: "converted support", exactVisiblePrice: true, conversionBreakConfirmed: true, independentEntryEvidence: true, fibConfluenceLabel: "between 38.2% and 50%", structuralEvidence: "reviewed broken resistance retest between the 38.2% and 50% current-week retracements" }),
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
      Object.freeze({ price: 1.20144, zoneLow: 1.20144, zoneHigh: 1.20144, areaType: "support", exactVisiblePrice: true, conversionBreakConfirmed: false, independentEntryEvidence: true, fibConfluenceLabel: "between 50% and 61.8% (closer to 50%)", structuralEvidence: "reviewed visible support between 50% and 61.8%, closer to 50%" }),
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
  "2927": Object.freeze({
    // Human-reviewed USA30 D1 chart. The broker-index provider was unavailable,
    // so only the candle extremes read with the chart cursor may replace the
    // approximate vision inventory or become entry candidates.
    instrument: "USA30",
    timeframe: "D1",
    direction: "bullish",
    currentPrice: 53563.1,
    currentWeekHigh: 54672.95,
    currentWeekLow: 44900,
    swingHigh: 54672.95,
    swingLow: 44900,
    inventoryAuthority: "human_verified_chart_cursor_period_extremes",
    preferVerifiedCandidates: true,
    periodExtremeOverrides: Object.freeze([
      Object.freeze({ periodLabel: "January", high: 49754 }),
      Object.freeze({ periodLabel: "February", high: 50575 }),
      Object.freeze({ periodLabel: "May", low: 48932 }),
      Object.freeze({ periodLabel: "June", high: 54672.95, low: 49779 }),
    ]),
    candidates: Object.freeze([
      Object.freeze({
        price: 50575,
        zoneLow: 50575,
        zoneHigh: 50575,
        areaType: "converted support",
        originalType: "resistance",
        exactVisiblePrice: true,
        conversionBreakConfirmed: true,
        independentEntryEvidence: true,
        authoritativeFrameworkLevel: true,
        provenanceVerified: true,
        priceSource: "human_verified_chart_cursor_period_extreme",
        sourceDate: "2026-02-01",
        sourceDay: "February",
        sourcePeriod: "February",
        sourceKind: "February high converted support",
        sourceExtreme: "high",
        structuralEvidence: "human-verified February high at 50575; later bullish break-and-hold converted resistance to support",
      }),
      Object.freeze({
        price: 49766.5,
        zoneLow: 49754,
        zoneHigh: 49779,
        areaType: "demand",
        originalType: "demand",
        exactVisiblePrice: false,
        conversionBreakConfirmed: true,
        independentEntryEvidence: true,
        authoritativeFrameworkLevel: true,
        provenanceVerified: true,
        priceSource: "human_verified_multi_period_confluence",
        sourceDate: "2026-06-01",
        sourceDay: "January high + June low",
        sourcePeriod: "January + June",
        sourceKind: "January high / June low confluence",
        sourceExtreme: "confluence",
        structuralEvidence: "human-verified January high 49754 converted support overlaps the human-verified June low 49779 demand",
      }),
      Object.freeze({
        price: 48932,
        zoneLow: 48932,
        zoneHigh: 48932,
        areaType: "demand",
        originalType: "demand",
        exactVisiblePrice: true,
        conversionBreakConfirmed: false,
        independentEntryEvidence: true,
        authoritativeFrameworkLevel: true,
        provenanceVerified: true,
        priceSource: "human_verified_chart_cursor_period_extreme",
        sourceDate: "2026-05-01",
        sourceDay: "May",
        sourcePeriod: "May",
        sourceKind: "May low demand",
        sourceExtreme: "low",
        structuralEvidence: "human-verified May low demand at 48932",
      }),
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

export function applyVerifiedPeriodExtremeOverrides(periodInventory = [], fixture = null) {
  const overrides = Array.isArray(fixture?.periodExtremeOverrides)
    ? fixture.periodExtremeOverrides
    : [];
  if (!Array.isArray(periodInventory) || !overrides.length) {
    return Array.isArray(periodInventory) ? periodInventory.map((period) => ({ ...period })) : [];
  }

  const overrideByLabel = new Map(
    overrides.map((override) => [String(override?.periodLabel || "").trim().toLowerCase(), override])
  );

  return periodInventory.map((period) => {
    const label = String(period?.periodLabel || period?.day || "").trim().toLowerCase();
    const override = overrideByLabel.get(label);
    if (!override) return { ...period };

    const priorHigh = Number(period?.high);
    const priorLow = Number(period?.low);
    const verifiedHigh = Number(override?.high);
    const verifiedLow = Number(override?.low);
    const hasHigh = Number.isFinite(verifiedHigh) && verifiedHigh > 0;
    const hasLow = Number.isFinite(verifiedLow) && verifiedLow > 0;
    const structures = Array.isArray(period?.structures)
      ? period.structures.map((structure) => {
          const price = Number(structure?.price);
          if (hasHigh && Number.isFinite(priorHigh) && price === priorHigh) {
            return { ...structure, price: verifiedHigh };
          }
          if (hasLow && Number.isFinite(priorLow) && price === priorLow) {
            return { ...structure, price: verifiedLow };
          }
          return { ...structure };
        })
      : [];

    return {
      ...period,
      ...(hasHigh ? { high: verifiedHigh, highVerified: true } : {}),
      ...(hasLow ? { low: verifiedLow, lowVerified: true } : {}),
      structures,
      verifiedExtremeSource: "human_verified_chart_cursor",
    };
  });
}
