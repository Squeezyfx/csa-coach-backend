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

export function canonicalInstrumentCode(input = "") {
  const raw = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw || ["NULL", "NOTPROVIDED", "NOTDETECTED"].includes(raw)) return "";
  for (const [alias, canonical] of INSTRUMENT_ALIASES) {
    if (raw === alias || raw.includes(alias)) return canonical;
  }
  const known = [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
    "EURCHF", "EURGBP", "GBPJPY", "XAUUSD", "BTCUSD", "ETHUSD", "USA30",
    "US500", "USTEC", "GER40", "UK100", "JP225",
  ];
  return known.find((symbol) => raw.includes(symbol)) || raw;
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

export function selectIndependentEntryAreas(candidates = [], direction = "range") {
  // Every returned entry must carry its own completed structural validation
  // and its own pass against the batch-wide dominant Fibonacci impulse.
  // Entry 2 may be another genuinely independent S/R conversion (for example
  // two separate USA30 resistance levels), but it cannot inherit Entry 1's
  // qualification or rely on a candidate-local Fibonacci calculation.
  return sequenceFibQualifiedAreas(candidates, direction)
    .filter((candidate) =>
      candidate?.authoritativeFrameworkLevel === true &&
      candidate?.requiredFibConfluence === true &&
      Number(candidate?.structuralScore || 0) > 0 &&
      Number(candidate?.fibonacciScore || 0) > 0
    )
    .slice(0, 2);
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
  return /independent_horizontal_line/i.test(
    String(area?.priceSource || "")
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
