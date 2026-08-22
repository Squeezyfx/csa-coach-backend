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
      if (a.stage.rank !== b.stage.rank) return a.stage.rank - b.stage.rank;
      return a.index - b.index;
    })
    .map((item) => item.candidate);
}

export function sequenceFibQualifiedAreas(candidates = [], direction = "range") {
  return [...candidates].sort((a, b) => {
    const aCenter = Number(a?.authoritativeCenter ?? a?.resolvedEntryPrice);
    const bCenter = Number(b?.authoritativeCenter ?? b?.resolvedEntryPrice);
    if (!Number.isFinite(aCenter) || !Number.isFinite(bCenter)) return 0;
    return direction === "bearish" ? aCenter - bCenter : bCenter - aCenter;
  });
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

  if (qualified.length < 2) return [primary];

  const primaryStage = classifyCsaStructuralStage(primary).key;
  const secondary = qualified.find((candidate) => {
    if (candidate === primary) return false;

    const candidateStage = classifyCsaStructuralStage(candidate).key;

    // A second exact-looking price is not automatically a second entry. It
    // must still prove that it represents a separate structural opportunity.
    // This blocks adjacent OCR/framework fragments such as 4428.73 behind
    // 4436.15, while preserving explicitly independent pairs such as the two
    // separate USA30 converted-resistance levels.
    if (hasIndependentChartPriceEvidence(candidate)) {
      return candidate?.independentEntryEvidence === true;
    }

    // A different structural stage may provide Entry 2, but only when the
    // detector retained its own displacement/base evidence. Merely having a
    // different label is not enough to manufacture a second entry. A current
    // S/D area behind a primary S/R must also be qualified by its local
    // historical-framework impulse (or carry explicit independent evidence).
    // The broad major-swing Fib can validate a primary area, but must not
    // manufacture an otherwise-unverified secondary S/D entry.
    if (candidateStage !== primaryStage) {
      return hasIndependentSecondarySupplyDemandEvidence(candidate);
    }

    return (
      candidate?.independentEntryEvidence === true
    );
  });

  return secondary
    ? sequenceFibQualifiedAreas([primary, secondary], direction)
    : [primary];
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
