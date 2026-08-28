const SR_TYPES = new Set([
  "support",
  "resistance",
  "converted support",
  "converted resistance",
]);

const SD_TYPES = new Set(["supply", "demand"]);

const INSTRUMENT_ALIASES = new Map([
  ["GOLD", "XAUUSD"], ["BTCUSDT", "BTCUSD"],
  ["US30", "USA30"], ["DJ30", "USA30"], ["DOW30", "USA30"], ["DJI", "USA30"],
  ["NAS100", "USTEC"], ["NASDAQ100", "USTEC"], ["US100", "USTEC"],
  ["SPX500", "US500"], ["SP500", "US500"],
]);

const SUPPORTED_INSTRUMENTS = new Set([
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
  "EURCHF", "EURGBP", "GBPJPY", "XAUUSD", "BTCUSD", "ETHUSD", "USA30",
  "US500", "USTEC", "GER40", "UK100", "JP225",
]);

export function canonicalInstrumentCode(input = "") {
  const raw = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw || ["NULL", "NOTPROVIDED", "NOTDETECTED"].includes(raw)) return "";
  for (const [alias, canonical] of INSTRUMENT_ALIASES) {
    if (raw === alias || raw.includes(alias)) return canonical;
  }
  return [...SUPPORTED_INSTRUMENTS].find((symbol) => raw.includes(symbol)) || raw;
}

export function isSupportedInstrumentCode(input = "") {
  return SUPPORTED_INSTRUMENTS.has(canonicalInstrumentCode(input));
}

export function getMarketDataSymbolCandidates(input = "") {
  const canonical = canonicalInstrumentCode(input);
  const candidatesByInstrument = {
    USA30: ["DJI", "USA30"],
    US500: ["SPX", "US500"],
    USTEC: ["NDX", "USTEC"],
    GER40: ["DAX", "GER40"],
    UK100: ["FTSE", "UK100"],
    JP225: ["N225", "JP225"],
  };

  return candidatesByInstrument[canonical] || [canonical || String(input || "")];
}

export function reconcileLatestVisibleDateWithAxisYear(dateText = "", axisYear = null) {
  const match = String(dateText || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const year = Number(axisYear);
  if (!match || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return match ? match[0] : null;
  }

  const reconciled = `${year}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${reconciled}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === reconciled
    ? reconciled
    : match[0];
}

export function parseChartHeaderText(input = "") {
  const raw = String(input || "").toUpperCase();
  const instrument = canonicalInstrumentCode(raw);
  const timeframeMatch = raw.match(
    /(?:^|[^A-Z0-9])(MN1?|W1|D1|H(?:1|2|3|4|6|8|12)|M(?:1|2|3|4|5|10|15|20|30))(?:$|[^A-Z0-9])/i
  );
  const timeframe = timeframeMatch ? timeframeMatch[1].toUpperCase() : "";

  return {
    instrument,
    timeframe: timeframe === "MN" ? "MN1" : timeframe,
  };
}

export function classifyCsaStructuralStage(candidate = {}) {
  const explicit = String(candidate?.stepwiseEntryStage || "").trim();
  const type = String(candidate?.type || candidate?.areaType || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (explicit === "immediate_prior_broken_sr") {
    return { rank: 1, key: "support_resistance", detail: explicit };
  }

  if (SR_TYPES.has(type)) {
    return { rank: 1, key: "support_resistance", detail: explicit || "support_resistance" };
  }

  if (explicit === "current_period_supply_demand" || SD_TYPES.has(type)) {
    return { rank: 2, key: "supply_demand", detail: explicit || "supply_demand" };
  }

  return { rank: 3, key: "other_structure", detail: explicit || "other_structure" };
}

export function orderStructuralCandidatesForFib(candidates = []) {
  return candidates
    .map((candidate, index) => ({
      candidate: {
        ...candidate,
        standardStructuralStage: classifyCsaStructuralStage(candidate).key,
      },
      index,
      stage: classifyCsaStructuralStage(candidate),
    }))
    .sort((a, b) => {
      const aPeriodPriority = Number(a.candidate?.frameworkPeriodLookback);
      const bPeriodPriority = Number(b.candidate?.frameworkPeriodLookback);
      const aHasPeriodPriority = Number.isInteger(aPeriodPriority) && aPeriodPriority > 0;
      const bHasPeriodPriority = Number.isInteger(bPeriodPriority) && bPeriodPriority > 0;

      if (aHasPeriodPriority && bHasPeriodPriority && aPeriodPriority !== bPeriodPriority) {
        return aPeriodPriority - bPeriodPriority;
      }
      if (aHasPeriodPriority !== bHasPeriodPriority) return aHasPeriodPriority ? -1 : 1;
      if (a.stage.rank !== b.stage.rank) return a.stage.rank - b.stage.rank;
      return a.index - b.index;
    })
    .map((item) => item.candidate);
}

export function annotateFrameworkPeriodPriority(candidates = [], totalPeriods = 0) {
  const count = Number(totalPeriods);
  return candidates.map((candidate) => {
    const sourceIndex = Number(candidate?.sourceIndex);
    const lookback = Number.isInteger(count) && count > 0 && Number.isInteger(sourceIndex)
      ? count - sourceIndex
      : null;
    return {
      ...candidate,
      frameworkPeriodLookback:
        Number.isInteger(lookback) && lookback > 0 ? lookback : null,
    };
  });
}

export function selectNearestFrameworkPeriodHints(
  candidates = [],
  totalPeriods = 0,
  maximumLookback = 2
) {
  const annotated = annotateFrameworkPeriodPriority(candidates, totalPeriods);
  const nearby = annotated.filter((candidate) =>
    Number.isInteger(Number(candidate?.frameworkPeriodLookback)) &&
    Number(candidate.frameworkPeriodLookback) <= Number(maximumLookback)
  );
  return nearby.length ? nearby : annotated;
}

export function compareStructureLedCompletedImpulseCandidates(a = {}, b = {}) {
  const aHintMatches = Number(a?.structuralHintScore?.matchCount || 0);
  const bHintMatches = Number(b?.structuralHintScore?.matchCount || 0);

  if ((aHintMatches > 0) !== (bHintMatches > 0)) {
    return aHintMatches > 0 ? -1 : 1;
  }

  if (aHintMatches > 0 && bHintMatches > 0) {
    const recencyDifference = Number(b?.breakIndex) - Number(a?.breakIndex);
    if (Number.isFinite(recencyDifference) && recencyDifference !== 0) {
      return recencyDifference;
    }

    if (aHintMatches !== bHintMatches) {
      return bHintMatches - aHintMatches;
    }

    const aHintDistance = Number(a?.structuralHintScore?.normalizedDistanceSum);
    const bHintDistance = Number(b?.structuralHintScore?.normalizedDistanceSum);
    if (
      Number.isFinite(aHintDistance) &&
      Number.isFinite(bHintDistance) &&
      Math.abs(aHintDistance - bHintDistance) > 0.05
    ) {
      return aHintDistance - bHintDistance;
    }
  }

  const adjustedDifference =
    Number(b?.hierarchyAdjustedScore || 0) -
    Number(a?.hierarchyAdjustedScore || 0);
  if (Math.abs(adjustedDifference) > 3) return adjustedDifference;

  if (Number(b?.hierarchyPosition) !== Number(a?.hierarchyPosition)) {
    return Number(b?.hierarchyPosition || 0) - Number(a?.hierarchyPosition || 0);
  }

  if (Number(b?.breakIndex) !== Number(a?.breakIndex)) {
    return Number(b?.breakIndex || 0) - Number(a?.breakIndex || 0);
  }

  return Number(a?.pivotIndex || 0) - Number(b?.pivotIndex || 0);
}

export function isMostRecentStructureCompatibleImpulse(
  selection = null,
  candidates = []
) {
  if (
    !selection ||
    Number(selection?.structuralHintScore?.matchCount || 0) <= 0 ||
    !Number.isFinite(Number(selection?.breakIndex))
  ) {
    return false;
  }

  const compatible = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) =>
      Number(candidate?.structuralHintScore?.matchCount || 0) > 0 &&
      Number.isFinite(Number(candidate?.breakIndex))
    );
  if (!compatible.length) return false;

  const mostRecentBreakIndex = Math.max(
    ...compatible.map((candidate) => Number(candidate.breakIndex))
  );
  return Number(selection.breakIndex) === mostRecentBreakIndex;
}

export function replaceMisclassifiedZoneWithExactConvertedLines(
  fallback = {},
  visibleLevels = []
) {
  if (fallback?.usable !== true || !["bullish", "bearish"].includes(fallback?.direction)) {
    return fallback;
  }

  const exactPrices = [...new Set((Array.isArray(visibleLevels) ? visibleLevels : [])
    .map((level) => Number(level?.displayedPrice))
    .filter((price) => Number.isFinite(price) && price > 0))];
  if (exactPrices.length < 2) return fallback;

  const candidates = [];
  for (const candidate of Array.isArray(fallback?.candidates) ? fallback.candidates : []) {
    const areaType = String(candidate?.areaType || "").toLowerCase().trim();
    const rawLow = Number(candidate?.zoneLow);
    const rawHigh = Number(candidate?.zoneHigh);
    const hasBroadZone = Number.isFinite(rawLow) && Number.isFinite(rawHigh) && rawLow !== rawHigh;

    if (
      !["supply", "demand"].includes(areaType) ||
      candidate?.conversionBreakConfirmed !== true ||
      !hasBroadZone
    ) {
      candidates.push(candidate);
      continue;
    }

    const zoneLow = Math.min(rawLow, rawHigh);
    const zoneHigh = Math.max(rawLow, rawHigh);
    const printedLinesInside = exactPrices
      .filter((price) => price >= zoneLow && price <= zoneHigh)
      .sort((a, b) => fallback.direction === "bearish" ? a - b : b - a);

    if (printedLinesInside.length < 2) {
      candidates.push(candidate);
      continue;
    }

    const convertedType = fallback.direction === "bearish"
      ? "converted resistance"
      : "converted support";
    for (const price of printedLinesInside) {
      candidates.push({
        ...candidate,
        price,
        zoneLow: price,
        zoneHigh: price,
        areaType: convertedType,
        exactVisiblePrice: true,
        independentEntryEvidence: true,
        structuralEvidence: [
          String(candidate?.structuralEvidence || "").trim(),
          "exact printed horizontal line preserved as converted support/resistance",
        ].filter(Boolean).join("; "),
        fibRatio: null,
        fibPrice: null,
      });
    }
  }

  return {
    ...fallback,
    candidates,
    exactConvertedLineOverrideApplied: candidates.length !== fallback.candidates.length,
  };
}

export function mergeAdjacentExactConvertedLines(
  fallback = {},
  independentlyReadLines = [],
  maximumAdjacentRangeRatio = 0.05
) {
  if (fallback?.usable !== true || !["bullish", "bearish"].includes(fallback?.direction)) {
    return fallback;
  }

  const swingHigh = Number(fallback?.swingHigh);
  const swingLow = Number(fallback?.swingLow);
  const impulseRange = swingHigh - swingLow;
  if (!Number.isFinite(impulseRange) || impulseRange <= 0) return fallback;

  const lines = (Array.isArray(independentlyReadLines) ? independentlyReadLines : [])
    .map((line) => ({
      price: Number(line?.displayedPrice),
      colour: String(line?.colour || "other").toLowerCase().trim(),
      evidence: String(line?.evidence || "").trim(),
    }))
    .filter((line) => Number.isFinite(line.price) && line.price > 0);
  if (!lines.length) return fallback;

  const candidates = Array.isArray(fallback?.candidates)
    ? fallback.candidates.map((candidate) => ({ ...candidate }))
    : [];
  const convertedType = fallback.direction === "bearish"
    ? "converted resistance"
    : "converted support";
  const adjacencyAllowance = impulseRange * Math.max(Number(maximumAdjacentRangeRatio) || 0, 0);
  const duplicateAllowance = Math.max(impulseRange * 0.00001, Number.EPSILON * 100);

  for (const line of lines) {
    if (candidates.some((candidate) =>
      Math.abs(Number(candidate?.price) - line.price) <= duplicateAllowance
    )) {
      continue;
    }

    const nearestConverted = candidates
      .filter((candidate) =>
        String(candidate?.areaType || "").toLowerCase().trim() === convertedType &&
        candidate?.exactVisiblePrice === true &&
        candidate?.conversionBreakConfirmed === true
      )
      .map((candidate) => ({
        candidate,
        distance: Math.abs(Number(candidate.price) - line.price),
      }))
      .filter((item) => Number.isFinite(item.distance) && item.distance <= adjacencyAllowance)
      .sort((a, b) => a.distance - b.distance)[0] || null;
    if (!nearestConverted) continue;

    const anchorLine = lines
      .map((candidateLine) => ({
        ...candidateLine,
        distance: Math.abs(
          candidateLine.price - Number(nearestConverted.candidate.price)
        ),
      }))
      .sort((a, b) => a.distance - b.distance)[0] || null;

    // Closely stacked lines are treated as separate converted levels only
    // when their visual colour agrees with either an independently read anchor
    // line or the already-confirmed converted line's visible description.
    // This avoids turning an unrelated nearby axis price into structure merely
    // because it is numerically close.
    const evidenceColour = ["blue", "red", "green", "orange"]
      .find((colour) =>
        String(nearestConverted.candidate?.structuralEvidence || "")
          .toLowerCase()
          .includes(colour)
      ) || "";
    const anchorColour =
      anchorLine && anchorLine.distance <= duplicateAllowance
        ? anchorLine.colour
        : evidenceColour;

    if (
      !line.colour ||
      line.colour === "other" ||
      !anchorColour ||
      anchorColour !== line.colour
    ) {
      continue;
    }

    candidates.push({
      ...nearestConverted.candidate,
      price: line.price,
      zoneLow: line.price,
      zoneHigh: line.price,
      areaType: convertedType,
      exactVisiblePrice: true,
      conversionBreakConfirmed: true,
      independentEntryEvidence: true,
      structuralEvidence: [
        line.evidence,
        "adjacent independently read exact horizontal line preserved as a separate converted level",
      ].filter(Boolean).join("; "),
      fibRatio: null,
      fibPrice: null,
    });
  }

  return {
    ...fallback,
    candidates,
    adjacentExactConvertedLineMergeApplied:
      candidates.length > (fallback?.candidates || []).length,
  };
}

export function promoteConfirmedBreakPassedExactLevels(fallback = {}) {
  if (fallback?.usable !== true || !["bullish", "bearish"].includes(fallback?.direction)) {
    return fallback;
  }

  const currentPrice = Number(fallback?.currentPrice);
  if (!Number.isFinite(currentPrice)) return fallback;

  const convertedType = fallback.direction === "bearish"
    ? "converted resistance"
    : "converted support";
  const plainType = fallback.direction === "bearish" ? "resistance" : "support";
  const candidates = Array.isArray(fallback?.candidates)
    ? fallback.candidates.map((candidate) => ({ ...candidate }))
    : [];

  const promoted = candidates.map((candidate) => {
    const type = String(candidate?.areaType || "").toLowerCase().trim();
    const price = Number(candidate?.price);
    const evidence = String(candidate?.structuralEvidence || "").toLowerCase();
    const sideCompatible = fallback.direction === "bearish"
      ? price > currentPrice
      : price < currentPrice;
    const breakEvidence = /breakdown|broke\s+(below|above)|passed\s+through|breakout/.test(evidence);
    const confirmedSibling = candidates.some((other) => {
      if (String(other?.areaType || "").toLowerCase().trim() !== convertedType) return false;
      const otherPrice = Number(other?.price);
      return fallback.direction === "bearish"
        ? otherPrice > price
        : otherPrice < price;
    });

    if (
      type !== plainType ||
      candidate?.exactVisiblePrice !== true ||
      !Number.isFinite(price) ||
      !sideCompatible ||
      !breakEvidence ||
      !confirmedSibling
    ) {
      return candidate;
    }

    return {
      ...candidate,
      areaType: convertedType,
      conversionBreakConfirmed: true,
      structuralEvidence: [
        String(candidate?.structuralEvidence || "").trim(),
        "exact level broke with price holding on the opposite side; converted role preserved",
      ].filter(Boolean).join("; "),
    };
  });

  return {
    ...fallback,
    candidates: promoted,
    confirmedBreakPassedLevelPromotionApplied:
      promoted.some((candidate, index) =>
        candidate?.areaType !== candidates[index]?.areaType
      ),
  };
}

export function selectStructureLedChartNativeImpulseFrame({
  direction = "range",
  swingHigh = null,
  swingLow = null,
  candidates = [],
  currentPrice = null,
  approvedTolerance = 0,
  toleranceRatio = 0.06,
  minimumLocalRangeRatio = 0.35,
} = {}) {
  const originalHigh = Number(swingHigh);
  const originalLow = Number(swingLow);
  if (
    !["bullish", "bearish"].includes(direction) ||
    !Number.isFinite(originalHigh) ||
    !Number.isFinite(originalLow) ||
    originalHigh <= originalLow
  ) {
    return null;
  }

  const originalRange = originalHigh - originalLow;
  const visibleCurrentPrice = Number(currentPrice);
  const structural = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) =>
      Number.isFinite(Number(candidate?.price)) &&
      Number(candidate.price) > 0 &&
      (
        candidate?.exactVisiblePrice === true ||
        (
          ["supply", "demand"].includes(
            String(candidate?.areaType || "").toLowerCase().trim()
          ) &&
          candidate?.independentEntryEvidence === true
        )
      )
    );

  const frames = [{
    swingHigh: originalHigh,
    swingLow: originalLow,
    source: "reported_completed_impulse",
  }];

  for (const candidate of structural) {
    const price = Number(candidate.price);
    const localHigh = direction === "bearish" ? price : originalHigh;
    const localLow = direction === "bullish" ? price : originalLow;
    const localRange = localHigh - localLow;
    if (
      localRange <= 0 ||
      localRange < originalRange * Math.max(Number(minimumLocalRangeRatio) || 0, 0) ||
      localRange >= originalRange
    ) {
      continue;
    }
    frames.push({
      swingHigh: localHigh,
      swingLow: localLow,
      source: "nearer_exact_structural_origin",
      originCandidatePrice: price,
    });
  }

  const scored = frames.map((frame, index) => {
    const range = frame.swingHigh - frame.swingLow;
    const tolerance = Math.max(
      Number(approvedTolerance) || 0,
      range * Math.max(Number(toleranceRatio) || 0, 0)
    );
    const rawMatchedPrices = structural
      .filter((candidate) => findNearestAllowedFibonacciMatch({
        direction,
        swingHigh: frame.swingHigh,
        swingLow: frame.swingLow,
        price: Number(candidate.price),
        zoneLow: Number(candidate?.zoneLow ?? candidate.price),
        zoneHigh: Number(candidate?.zoneHigh ?? candidate.price),
        tolerance,
      }))
      .map((candidate) => Number(candidate.price));

    const matchedPrices = [...new Set(rawMatchedPrices)];
    const nearestCurrentDistance = Number.isFinite(visibleCurrentPrice)
      ? matchedPrices.reduce((nearest, price) =>
          Math.min(nearest, Math.abs(price - visibleCurrentPrice)),
          Number.POSITIVE_INFINITY
        )
      : Number.POSITIVE_INFINITY;

    return {
      ...frame,
      index,
      range,
      tolerance,
      matchCount: matchedPrices.length,
      matchedPrices,
      nearestCurrentDistance,
    };
  });

  const bestMatchCount = Math.max(...scored.map((frame) => frame.matchCount));
  const original = scored[0];

  // A local structural origin may replace the reported broad origin only
  // when it independently explains at least two visible structures and does
  // not reduce the best match count. Single-level charts retain the reported
  // completed impulse, preventing a nearby line from manufacturing its own
  // Fibonacci frame.
  const materiallyCloserStructureLedFrame = scored
    .filter((frame) =>
      frame.index !== 0 &&
      frame.matchCount >= 1 &&
      Number.isFinite(frame.nearestCurrentDistance) &&
      Number.isFinite(original.nearestCurrentDistance) &&
      frame.nearestCurrentDistance <
        original.nearestCurrentDistance - original.range * 0.05
    )
    .sort((a, b) =>
      a.nearestCurrentDistance - b.nearestCurrentDistance ||
      a.range - b.range ||
      a.index - b.index
    )[0] || null;

  const multiLevelSelection = bestMatchCount >= 2
    ? scored
        .filter((frame) => frame.matchCount === bestMatchCount)
        .sort((a, b) => a.range - b.range || a.index - b.index)[0]
    : null;

  const materiallyCloserSingleLevel = scored
    .filter((frame) =>
      frame.index !== 0 &&
      frame.matchCount >= 1 &&
      frame.matchCount >= original.matchCount &&
      Number.isFinite(frame.nearestCurrentDistance) &&
      Number.isFinite(original.nearestCurrentDistance) &&
      frame.nearestCurrentDistance <
        original.nearestCurrentDistance - original.range * 0.05
    )
    .sort((a, b) =>
      a.nearestCurrentDistance - b.nearestCurrentDistance ||
      a.range - b.range ||
      a.index - b.index
    )[0] || null;

  // The broad frame can match several older levels simply because its range
  // is wider.  It must not therefore suppress a nearer completed local leg
  // whose independently confirmed S/R or S/D confluence is materially closer
  // to the current price.  This keeps the prior-period inventory intact while
  // still applying one shared, deterministic Fib frame to all candidates.
  const selected =
    materiallyCloserStructureLedFrame ||
    multiLevelSelection ||
    materiallyCloserSingleLevel ||
    original;

  return {
    ...selected,
    originalSwingHigh: originalHigh,
    originalSwingLow: originalLow,
    originalMatchCount: original.matchCount,
    structureLedOverrideApplied: selected.index !== 0,
  };
}

export function sequenceFibQualifiedAreas(candidates = [], direction = "range") {
  return [...candidates].sort((a, b) => {
    const aCenter = Number(a?.authoritativeCenter ?? a?.resolvedEntryPrice);
    const bCenter = Number(b?.authoritativeCenter ?? b?.resolvedEntryPrice);
    if (!Number.isFinite(aCenter) || !Number.isFinite(bCenter)) return 0;
    return direction === "bearish" ? aCenter - bCenter : bCenter - aCenter;
  });
}

export function findNearestAllowedFibonacciMatch({
  direction = "range",
  swingHigh = null,
  swingLow = null,
  price = null,
  zoneLow = null,
  zoneHigh = null,
  tolerance = 0,
} = {}) {
  const high = Number(swingHigh);
  const low = Number(swingLow);
  const center = Number(price);
  const rawLow = Number(zoneLow);
  const rawHigh = Number(zoneHigh);
  const allowedTolerance = Math.max(Number(tolerance) || 0, 0);

  if (
    !["bullish", "bearish"].includes(direction) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    high <= low ||
    !Number.isFinite(center)
  ) {
    return null;
  }

  const hasZone = Number.isFinite(rawLow) && Number.isFinite(rawHigh);
  const lowerBoundary = hasZone ? Math.min(rawLow, rawHigh) : center;
  const upperBoundary = hasZone ? Math.max(rawLow, rawHigh) : center;
  const impulseRange = high - low;
  const firstRetracementPrice = direction === "bearish"
    ? low + impulseRange * 0.382
    : high - impulseRange * 0.382;

  // A proximity allowance may absorb broker/zone-boundary variation, but it
  // must never pull an entirely shallow candidate across the 38.2 threshold.
  // Bearish candidates below 38.2 and bullish candidates above 38.2 remain
  // structural references rather than entries.
  if (
    (direction === "bearish" && upperBoundary < firstRetracementPrice) ||
    (direction === "bullish" && lowerBoundary > firstRetracementPrice)
  ) {
    return null;
  }

  const matches = [0.382, 0.5, 0.618]
    .map((ratio) => {
      const fibPrice = direction === "bearish"
        ? low + impulseRange * ratio
        : high - impulseRange * ratio;
      const distance = fibPrice < lowerBoundary
        ? lowerBoundary - fibPrice
        : fibPrice > upperBoundary
        ? fibPrice - upperBoundary
        : 0;

      return { ratio, fibPrice, distance };
    })
    .sort((a, b) => a.distance - b.distance || a.ratio - b.ratio);

  return matches[0]?.distance <= allowedTolerance ? matches[0] : null;
}

export function mergeFocusedSupplyDemandInventory(
  primaryFallback = {},
  focusedFallback = {}
) {
  if (primaryFallback?.usable !== true) return focusedFallback;
  if (
    focusedFallback?.usable !== true ||
    focusedFallback?.direction !== primaryFallback?.direction
  ) {
    return primaryFallback;
  }

  const primaryCandidates = Array.isArray(primaryFallback?.candidates)
    ? primaryFallback.candidates
    : [];
  const focusedSupplyDemand = (Array.isArray(focusedFallback?.candidates)
    ? focusedFallback.candidates
    : []
  ).filter((candidate) => {
    const type = String(candidate?.areaType || "").toLowerCase().trim();
    return (
      ["supply", "demand"].includes(type) &&
      candidate?.independentEntryEvidence === true &&
      Boolean(String(candidate?.structuralEvidence || "").trim()) &&
      Number.isFinite(Number(candidate?.price)) &&
      Number(candidate.price) > 0
    );
  });

  const merged = [...primaryCandidates];
  for (const candidate of focusedSupplyDemand) {
    const price = Number(candidate.price);
    const type = String(candidate.areaType).toLowerCase().trim();
    const duplicate = merged.some((existing) =>
      String(existing?.areaType || "").toLowerCase().trim() === type &&
      Math.abs(Number(existing?.price) - price) <= Number.EPSILON * 100
    );
    if (!duplicate) merged.push(candidate);
  }

  return {
    ...primaryFallback,
    candidates: merged,
    focusedSupplyDemandInventoryMerged: merged.length > primaryCandidates.length,
  };
}

export function expandExactSupportResistanceBoundaries(candidates = []) {
  return candidates
    .flatMap((candidate) => {
      const areaType = String(candidate?.areaType || candidate?.type || "")
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const low = Number(candidate?.zoneLow);
      const high = Number(candidate?.zoneHigh);
      const isExactSr =
        candidate?.exactVisiblePrice === true &&
        SR_TYPES.has(areaType) &&
        Number.isFinite(low) &&
        low > 0 &&
        Number.isFinite(high) &&
        high > 0 &&
        Math.abs(high - low) > Number.EPSILON * 100;

      if (!isExactSr) return [candidate];

      // Separately printed S/R prices are point levels, not the boundaries of
      // one broad zone. Preserve each line as independently selectable
      // structure. Genuine supply/demand candidates remain bounded zones.
      return [...new Set([low, high])].map((price) => ({
        ...candidate,
        price,
        zoneLow: price,
        zoneHigh: price,
        areaType,
        independentEntryEvidence: true,
        structuralEvidence: [
          String(candidate?.structuralEvidence || "").trim(),
          "separate exact printed support/resistance line",
        ]
          .filter(Boolean)
          .join("; "),
      }));
    })
    .filter((candidate, index, expanded) => {
      const price = Number(candidate?.price);
      const areaType = String(candidate?.areaType || candidate?.type || "")
        .toLowerCase()
        .trim();
      return expanded.findIndex((item) =>
        Number(item?.price) === price &&
        String(item?.areaType || item?.type || "").toLowerCase().trim() === areaType
      ) === index;
    });
}

export function selectIndependentEntryAreas(candidates = [], direction = "range") {
  // Every returned entry must carry its own completed structural validation
  // and its own pass against the batch-wide dominant Fibonacci impulse.
  // Entry 2 may be another genuinely independent S/R conversion (for example
  // two separate USA30 resistance levels), but it cannot inherit Entry 1's
  // qualification or rely on a candidate-local Fibonacci calculation.
  const qualified = sequenceFibQualifiedAreas(candidates, direction)
    .filter((candidate) =>
      candidate?.authoritativeFrameworkLevel === true &&
      candidate?.requiredFibConfluence === true &&
      Number(candidate?.structuralScore || 0) > 0 &&
      Number(candidate?.fibonacciScore || 0) > 0
    );

  if (!qualified.length) return [];

  // An exact price read from a visible chart line is authoritative only after
  // that level has independently passed structure and the shared Fibonacci
  // gate above. When one exists, it must not be displaced by a nearby inferred
  // candle fragment. This is evidence precedence, not a benchmark exception.
  const exactMarked = qualified.filter(hasIndependentChartPriceEvidence);
  const primary = exactMarked.length
    ? sequenceFibQualifiedAreas(exactMarked, direction)[0]
    : qualified[0];

  const selected = [primary];

  // CSA may expose as many as three genuinely separate entry opportunities.
  // Each later entry must independently prove both its structural role and
  // its confluence; it never inherits either qualification from Entry 1.
  for (const candidate of qualified) {
    if (selected.length >= 3 || selected.includes(candidate)) continue;

    const candidateStage = classifyCsaStructuralStage(candidate).key;
    const hasSeparateEvidence = hasIndependentChartPriceEvidence(candidate)
      ? candidate?.independentEntryEvidence === true
      : candidateStage === "supply_demand"
      ? hasIndependentSecondarySupplyDemandEvidence(candidate)
      : candidate?.independentEntryEvidence === true;

    if (!hasSeparateEvidence) continue;

    // Do not allow a nearby OCR fragment or duplicate zone to consume another
    // entry slot. A candidate must be a distinct structural opportunity.
    const duplicate = selected.some((existing) => {
      const existingCenter = Number(
        existing?.authoritativeCenter ?? existing?.resolvedEntryPrice
      );
      const candidateCenter = Number(
        candidate?.authoritativeCenter ?? candidate?.resolvedEntryPrice
      );
      if (!Number.isFinite(existingCenter) || !Number.isFinite(candidateCenter)) {
        return false;
      }
      const allowance = Math.max(
        Number(existing?.closeAllowance || 0),
        Number(candidate?.closeAllowance || 0),
        Math.abs(existingCenter) * 0.00001
      );
      return Math.abs(existingCenter - candidateCenter) <= allowance;
    });

    if (!duplicate) selected.push(candidate);
  }

  return sequenceFibQualifiedAreas(selected, direction).slice(0, 3);
}

export function hasIndependentSecondarySupplyDemandEvidence(area = {}) {
  if (area?.independentEntryEvidence === true) return true;
  if (!hasIndependentStructuralEntryEvidence(area)) return false;

  const fibOriginModel = String(area?.fibOriginModel || "").toLowerCase();
  const fibonacciSource = String(area?.fibonacciSource || "").toLowerCase();

  return (
    fibOriginModel.includes("historical_framework_local") ||
    fibonacciSource.includes("historical_framework_local") ||
    fibOriginModel.includes("chart_native_completed_directional_impulse") ||
    fibonacciSource.includes("uploaded_chart_completed_impulse")
  );
}

export function hasIndependentStructuralEntryEvidence(area = {}) {
  if (area?.independentEntryEvidence === true) return true;

  const stage = classifyCsaStructuralStage(area).key;
  if (stage !== "supply_demand") return false;

  return (
    area?.structuralZoneReinforcedByIntradayStructure === true ||
    area?.supplyDemandRefinedBySamePeriodBase === true ||
    area?.samePeriodDisplacementBaseValidated === true
  );
}

export function shouldApplyFinalVisibleTerminalImpulse({
  terminalImpulse = null,
  majorSelection = null,
  terminalStructuralScore = null,
  majorStructuralScore = null,
  direction = "range",
} = {}) {
  if (terminalImpulse?.enabled !== true) return false;
  if (!majorSelection) return true;

  const terminalMatches = Number(terminalStructuralScore?.matchCount || 0);
  const majorMatches = Number(majorStructuralScore?.matchCount || 0);

  // The chart's authoritative S/R and S/D levels are identified before Fib.
  // Use the terminal leg only when it validates more of those exact levels
  // than the broader major impulse. This prevents an unconditional terminal
  // override from erasing valid structure on charts whose last few candles
  // are only a pullback or rebound inside the controlling move.
  if (terminalMatches !== majorMatches) {
    return terminalMatches > majorMatches;
  }

  if (terminalMatches > 0) {
    const terminalPrices = (terminalStructuralScore?.matches || [])
      .map((match) => Number(match?.price))
      .filter(Number.isFinite);
    const majorPrices = (majorStructuralScore?.matches || [])
      .map((match) => Number(match?.price))
      .filter(Number.isFinite);

    if (terminalPrices.length && majorPrices.length) {
      const terminalNearest = direction === "bearish"
        ? Math.min(...terminalPrices)
        : Math.max(...terminalPrices);
      const majorNearest = direction === "bearish"
        ? Math.min(...majorPrices)
        : Math.max(...majorPrices);

      // When both frames validate the same number of chart-exact structural
      // levels, prefer the completed terminal impulse if it validates the
      // first level price will meet on the current directional path.
      if (
        (direction === "bearish" && terminalNearest < majorNearest) ||
        (direction === "bullish" && terminalNearest > majorNearest)
      ) {
        return true;
      }
    }

    const terminalDistance = Number(
      terminalStructuralScore?.normalizedDistanceSum
    );
    const majorDistance = Number(majorStructuralScore?.normalizedDistanceSum);

    if (Number.isFinite(terminalDistance) && Number.isFinite(majorDistance)) {
      // Require a material improvement so tiny OCR/rounding differences do
      // not make the selected impulse oscillate between otherwise equal runs.
      return terminalDistance <= majorDistance * 0.8;
    }
  }

  return false;
}

export function buildFinalVisibleTerminalImpulse({
  candles = [],
  direction = "range",
  directionalEvent = null,
  oppositeEvent = null,
} = {}) {
  if (!Array.isArray(candles) || candles.length < 3) return null;
  if (!["bullish", "bearish"].includes(direction)) return null;

  const breakIndex = Number(directionalEvent?.index);
  if (!Number.isInteger(breakIndex) || breakIndex < 0 || breakIndex >= candles.length) {
    return null;
  }

  const terminalWindow = candles.slice(breakIndex);
  const terminalValues = terminalWindow.map((candle) =>
    Number(direction === "bullish" ? candle?.high : candle?.low)
  );
  const finiteTerminal = terminalValues.filter(Number.isFinite);
  if (!finiteTerminal.length) return null;

  const terminalPrice = direction === "bullish"
    ? Math.max(...finiteTerminal)
    : Math.min(...finiteTerminal);
  const terminalOffset = terminalValues.findIndex((value) => value === terminalPrice);
  if (terminalOffset < 0) return null;

  const terminalIndex = breakIndex + terminalOffset;
  const launchWindow = candles.slice(breakIndex, terminalIndex + 1);
  const launchValues = launchWindow.map((candle) =>
    Number(direction === "bullish" ? candle?.low : candle?.high)
  );
  const finiteLaunch = launchValues.filter(Number.isFinite);
  if (!finiteLaunch.length) return null;

  const originPrice = direction === "bullish"
    ? Math.min(...finiteLaunch)
    : Math.max(...finiteLaunch);
  const originOffset = launchValues.findIndex((value) => value === originPrice);
  const originStart = breakIndex + Math.max(originOffset, 0);
  const valid = direction === "bullish"
    ? terminalPrice > originPrice
    : originPrice > terminalPrice;

  if (!valid) return null;

  return {
    enabled: true,
    direction,
    originPrice,
    terminalPrice,
    originStartIndex: originStart,
    breakIndex,
    terminalIndex,
    source: "final_visible_latest_confirmed_break_impulse",
    rule: "latest_confirmed_break_candle_to_terminal_extreme",
  };
}

export function selectProtectiveSupplyDemandAnchor(existing = {}, candidate = {}) {
  const areaType = String(existing?.areaType || existing?.type || "")
    .toLowerCase()
    .trim();
  const candidateType = String(candidate?.areaType || candidate?.type || "")
    .toLowerCase()
    .trim();
  const existingAnchor = Number(
    existing?.authoritativeCenter ?? existing?.resolvedEntryPrice
  );
  const candidateAnchor = Number(
    candidate?.authoritativeCenter ?? candidate?.resolvedEntryPrice
  );

  if (
    areaType !== candidateType ||
    !["demand", "supply"].includes(areaType) ||
    !Number.isFinite(existingAnchor) ||
    !Number.isFinite(candidateAnchor)
  ) {
    return existing;
  }

  if (areaType === "demand") {
    return candidateAnchor < existingAnchor ? candidate : existing;
  }

  return candidateAnchor > existingAnchor ? candidate : existing;
}

export function getSupplyDemandClusterTolerance(
  existing = {},
  candidate = {},
  atr = 0
) {
  const existingType = String(existing?.areaType || existing?.type || "")
    .toLowerCase()
    .trim();
  const candidateType = String(candidate?.areaType || candidate?.type || "")
    .toLowerCase()
    .trim();
  const baseTolerance = Math.max(Number(atr || 0) * 0.08, 0);

  if (
    existingType !== candidateType ||
    !["demand", "supply"].includes(existingType)
  ) {
    return baseTolerance;
  }

  // A single launch-base area is often detected as two adjacent candle
  // fragments. Keep the allowance conservative, but wide enough to combine
  // overlapping or near-touching Fib-qualified fragments before Entry 2 is
  // selected. Candidate-specific Fib proximity allowances are included when
  // the detector provides them.
  return Math.max(
    baseTolerance,
    Number(atr || 0) * 0.15,
    Number(existing?.closeAllowance || 0),
    Number(candidate?.closeAllowance || 0)
  );
}

export function hasIndependentChartPriceEvidence(area = {}) {
  return (
    area?.chartExactFrameworkConfirmed === true ||
    area?.exactChartFrameworkConfirmed === true ||
    /independent_horizontal_line/i.test(String(area?.priceSource || ""))
  );
}

export function shouldMergeQualifiedSupplyDemandCluster(
  existing = {},
  candidate = {},
  options = {}
) {
  const existingType = String(existing?.areaType || existing?.type || "")
    .toLowerCase()
    .trim();
  const candidateType = String(candidate?.areaType || candidate?.type || "")
    .toLowerCase()
    .trim();

  return (
    classifyCsaStructuralStage(existing).key === "supply_demand" &&
    classifyCsaStructuralStage(candidate).key === "supply_demand" &&
    existingType === candidateType &&
    ["demand", "supply"].includes(existingType) &&
    options.existingTrusted !== true &&
    options.candidateTrusted !== true
  );
}

export function consolidateQualifiedSupplyDemandClusters(
  candidates = [],
  atr = 0
) {
  const consolidated = [];

  for (const candidate of candidates) {
    const candidateLow = Number(candidate?.zoneLow);
    const candidateHigh = Number(candidate?.zoneHigh);
    const mergeIndex = consolidated.findIndex((existing) => {
      if (
        !shouldMergeQualifiedSupplyDemandCluster(existing, candidate, {
          existingTrusted: hasIndependentChartPriceEvidence(existing),
          candidateTrusted: hasIndependentChartPriceEvidence(candidate),
        })
      ) {
        return false;
      }

      const tolerance = getSupplyDemandClusterTolerance(
        existing,
        candidate,
        atr
      );
      return (
        Number(existing?.zoneHigh) + tolerance >= candidateLow &&
        candidateHigh + tolerance >= Number(existing?.zoneLow)
      );
    });

    if (mergeIndex < 0) {
      consolidated.push(candidate);
      continue;
    }

    const existing = consolidated[mergeIndex];
    const selected = selectProtectiveSupplyDemandAnchor(existing, candidate);
    consolidated[mergeIndex] = {
      ...selected,
      zoneLow: Math.min(Number(existing.zoneLow), candidateLow),
      zoneHigh: Math.max(Number(existing.zoneHigh), candidateHigh),
      structuralScore: Math.max(
        Number(existing?.structuralScore || 0),
        Number(candidate?.structuralScore || 0)
      ),
      qualityScore: Math.max(
        Number(existing?.qualityScore || 0),
        Number(candidate?.qualityScore || 0)
      ),
      reactionCount: Math.max(
        Number(existing?.reactionCount || 0),
        Number(candidate?.reactionCount || 0)
      ),
      strongDepartureCount: Math.max(
        Number(existing?.strongDepartureCount || 0),
        Number(candidate?.strongDepartureCount || 0)
      ),
      overlappingSupplyDemandClusterMerged: true,
      clusterAnchorRule:
        String(selected?.areaType || "").toLowerCase() === "demand"
          ? "bullish_demand_lower_launch_boundary"
          : "bearish_supply_upper_launch_boundary",
    };
  }

  return consolidated;
}
