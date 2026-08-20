const SR_TYPES = new Set([
  "support",
  "resistance",
  "converted support",
  "converted resistance",
]);

const SD_TYPES = new Set(["supply", "demand"]);

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
