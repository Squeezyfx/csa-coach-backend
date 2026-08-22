const DAY_WORDS = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:'s)?\b/i;
const FIB_WORDS = /\b(?:fib(?:onacci)?|38\.2%|50%|61\.8%)\b/i;
const BENCHMARK_VALIDATOR_VERSION = "1.6.0";

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDirection(value = "") {
  const text = String(value || "").toLowerCase();
  if (/bull|buy|long/.test(text)) return "bullish";
  if (/bear|sell|short/.test(text)) return "bearish";
  if (/range|neutral|sideways/.test(text)) return "range";
  return "unknown";
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(finiteNumber).filter((item) => item !== null);
  return String(value || "")
    .split(/[\s,;|]+/)
    .map(finiteNumber)
    .filter((item) => item !== null);
}

function parseTextList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAreaType(value = "") {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "unknown";
  if (text.includes("converted support")) return "converted support";
  if (text.includes("converted resistance")) return "converted resistance";
  if (text.includes("demand")) return "demand";
  if (text.includes("supply")) return "supply";
  if (text.includes("support")) return "support";
  if (text.includes("resistance")) return "resistance";
  if (text === "buy area" || text === "sell area") return text;
  return text;
}

function areaTypeMatches(actualValue, expectedValue) {
  const actual = normalizeAreaType(actualValue);
  const expected = normalizeAreaType(expectedValue);
  if (expected === "unknown") return true;
  if (expected === "buy area") {
    return ["support", "demand", "converted support"].includes(actual);
  }
  if (expected === "sell area") {
    return ["resistance", "supply", "converted resistance"].includes(actual);
  }
  if (expected === "support") {
    return ["support", "converted support"].includes(actual);
  }
  if (expected === "resistance") {
    return ["resistance", "converted resistance"].includes(actual);
  }
  return actual === expected;
}

function isSupplyDemandType(value) {
  return ["supply", "demand"].includes(normalizeAreaType(value));
}

function normalizeZoneBounds(lowValue, highValue) {
  const low = finiteNumber(lowValue);
  const high = finiteNumber(highValue);
  if (low === null || high === null || low === high) return null;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function expectedEntryZone(expectation = {}, entryNumber = 1) {
  const type = expectation[`expectedEntry${entryNumber}Type`];
  if (!isSupplyDemandType(type)) return null;
  return normalizeZoneBounds(
    expectation[`expectedEntry${entryNumber}ZoneLow`],
    expectation[`expectedEntry${entryNumber}ZoneHigh`]
  );
}

function areaBounds(area) {
  if (!area) return null;
  const center = finiteNumber(area.center);
  const low = finiteNumber(area.zoneLow) ?? center;
  const high = finiteNumber(area.zoneHigh) ?? center;
  if (low === null || high === null) return null;
  return { low: Math.min(low, high), high: Math.max(low, high), center };
}

function priceInsideZone(price, zone, tolerance = 0) {
  const value = finiteNumber(price);
  if (value === null || !zone) return false;
  return value >= zone.low - tolerance && value <= zone.high + tolerance;
}

function areaMatchesExpectedZone(area, expectedZone, tolerance = 0) {
  const actual = areaBounds(area);
  if (!actual || !expectedZone) return false;

  // A selected entry anchor inside the expected S/D area is sufficient. This
  // covers customer-facing output that exposes one actionable price while the
  // structured facts retain the full candle-defined zone.
  if (priceInsideZone(actual.center, expectedZone, tolerance)) return true;

  const overlapLow = Math.max(actual.low, expectedZone.low);
  const overlapHigh = Math.min(actual.high, expectedZone.high);
  const overlap = Math.max(0, overlapHigh - overlapLow + tolerance * 2);
  const actualWidth = Math.max(0, actual.high - actual.low);
  const expectedWidth = Math.max(0, expectedZone.high - expectedZone.low);
  const narrowerWidth = Math.min(actualWidth, expectedWidth);

  // For two genuine areas, require meaningful overlap rather than accepting a
  // broad zone that merely brushes the benchmark boundary. Point-like actual
  // output is handled by the anchor-containment rule above.
  return narrowerWidth > 0 && overlap / narrowerWidth >= 0.25;
}

function textMentionsZone(text, zone, tolerance = 0) {
  if (!zone) return false;
  const candidates = String(text || "").match(/\d+(?:\.\d+)?/g) || [];
  return candidates.some((candidate) =>
    priceInsideZone(Number(candidate), zone, tolerance)
  );
}

function formatExpectedZone(zone) {
  return zone ? `${zone.low}–${zone.high}` : "";
}

function feedbackMentionsTerm(text, term) {
  const normalizedText = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  return Boolean(normalizedTerm) && normalizedText.includes(normalizedTerm);
}

function parsePriceExpectations(value) {
  const tokens = Array.isArray(value)
    ? value.map((item) => String(item))
    : String(value || "").split(/[\s,;|]+/);

  return tokens
    .map((raw) => {
      const text = String(raw || "").trim();
      const value = finiteNumber(text);
      if (value === null) return null;
      const decimalText = text.includes(".") ? text.split(".")[1] : "";
      return {
        value,
        text,
        digits: Math.max(0, Math.min(decimalText.length, 8)),
      };
    })
    .filter(Boolean);
}

function priceDigits(price) {
  const text = String(price);
  const decimals = text.includes(".") ? text.split(".")[1].length : 0;
  return Math.max(0, Math.min(decimals, 8));
}

function defaultTolerance(price) {
  const n = Math.abs(Number(price));
  if (n >= 1000) return 1.5;
  if (n >= 100) return 0.15;
  if (n >= 10) return 0.03;
  if (n >= 1) return 0.00025;
  return 0.00008;
}

function exactLevelTolerance(price, expectedDigits = null) {
  const digits = Number.isInteger(expectedDigits)
    ? expectedDigits
    : priceDigits(price);
  return Math.max(Number.EPSILON * 100, 0.5 * 10 ** -digits);
}

function entryFrom(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const zoneLow = finiteNumber(value.zoneLow);
  const zoneHigh = finiteNumber(value.zoneHigh);
  const center =
    finiteNumber(value.authoritativeCenter) ??
    finiteNumber(value.center) ??
    finiteNumber(value.price) ??
    (zoneLow !== null && zoneHigh !== null ? (zoneLow + zoneHigh) / 2 : null);

  if (center === null && zoneLow === null && zoneHigh === null) return null;
  return {
    order: Number(value.executionOrder || value.rank || index + 1),
    center,
    zoneLow: zoneLow ?? center,
    zoneHigh: zoneHigh ?? center,
    areaType: String(value.areaType || value.type || ""),
    levelText: String(value.levelText || value.zoneText || ""),
  };
}

function factsSelectedEntries(result = {}) {
  return Array.isArray(result?.analysisFacts?.selectedEntryAreas)
    ? result.analysisFacts.selectedEntryAreas.map(entryFrom).filter(Boolean)
    : [];
}

function canonicalSelectedEntries(result = {}) {
  const lockedEntries = Array.isArray(result?.finalFeedback?.narrativeLock?.selectedEntries)
    ? result.finalFeedback.narrativeLock.selectedEntries.map(entryFrom).filter(Boolean)
    : [];

  if (lockedEntries.length) return lockedEntries.sort((a, b) => a.order - b.order);

  const feedbackEntries = [result?.finalFeedback?.entry1, result?.finalFeedback?.entry2]
    .map(entryFrom)
    .filter(Boolean);

  if (feedbackEntries.length) return feedbackEntries.sort((a, b) => a.order - b.order);

  return factsSelectedEntries(result).sort((a, b) => a.order - b.order);
}

function selectedEntries(result = {}) {
  return canonicalSelectedEntries(result);
}

function allPromotedEntries(result = {}) {
  return [...factsSelectedEntries(result), ...canonicalSelectedEntries(result)];
}

function entrySetsAgree(factsEntries = [], canonicalEntries = []) {
  if (factsEntries.length !== canonicalEntries.length) return false;

  return canonicalEntries.every((canonical, index) => {
    const facts = factsEntries[index];
    if (!facts) return false;
    const tolerance = defaultTolerance(canonical.center ?? facts.center ?? 1);
    return Math.abs(Number(canonical.center) - Number(facts.center)) <= tolerance;
  });
}

function referenceEntries(result = {}) {
  const references = Array.isArray(result?.analysisFacts?.structuralReferenceAreas)
    ? result.analysisFacts.structuralReferenceAreas.map(entryFrom).filter(Boolean)
    : [];
  return [...selectedEntries(result), ...references];
}

function areaContains(area, expected, tolerance) {
  if (!area) return false;
  const low = finiteNumber(area.zoneLow) ?? finiteNumber(area.center);
  const high = finiteNumber(area.zoneHigh) ?? finiteNumber(area.center);
  if (low === null || high === null) return false;
  return expected >= Math.min(low, high) - tolerance && expected <= Math.max(low, high) + tolerance;
}

function entryMatchesExpectation(area, expectedPrice, expectedType, zone, tolerance) {
  if (!area) return false;
  if (zone && isSupplyDemandType(expectedType)) {
    return areaMatchesExpectedZone(area, zone, tolerance);
  }
  if (expectedPrice === null) return Boolean(area);

  // Support/resistance is a level, so its authoritative anchor must match.
  // Demand/supply without configured boundaries retains legacy point behavior.
  const normalizedType = normalizeAreaType(expectedType);
  if (["support", "resistance", "converted support", "converted resistance"].includes(normalizedType)) {
    const center = finiteNumber(area.center);
    return center !== null && Math.abs(center - expectedPrice) <= tolerance;
  }
  return areaContains(area, expectedPrice, tolerance);
}

function textMentionsPrice(text, price, tolerance, expectedDigits = null) {
  const source = String(text || "");
  if (!source) return false;
  const digits = Number.isInteger(expectedDigits)
    ? expectedDigits
    : priceDigits(price);
  const candidates = source.match(/\d+(?:\.\d+)?/g) || [];
  return candidates.some((candidate) => {
    const value = Number(candidate);
    if (!Number.isFinite(value)) return false;
    const adaptiveTolerance = Math.max(tolerance, 0.5 * 10 ** -digits);
    return Math.abs(value - price) <= adaptiveTolerance;
  });
}

function duplicateItems(items = []) {
  const seen = new Set();
  const duplicates = [];
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    if (seen.has(normalized)) duplicates.push(item);
    seen.add(normalized);
  }
  return duplicates;
}

function feedbackTemplateFingerprint(value = "") {
  // Preserve instrument-specific prices, direction and structural roles.
  // Removing those facts made genuinely chart-specific feedback appear to be
  // a reused generic template. Exact rendered boilerplate is still caught.
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function feedbackItems(result = {}) {
  const strengths = Array.isArray(result?.finalFeedback?.strengths)
    ? result.finalFeedback.strengths
    : Array.isArray(result?.dashboard?.strengths)
    ? result.dashboard.strengths
    : [];
  const weaknesses = Array.isArray(result?.finalFeedback?.weaknesses)
    ? result.finalFeedback.weaknesses
    : Array.isArray(result?.dashboard?.weaknesses)
    ? result.dashboard.weaknesses
    : [];
  return [...strengths, ...weaknesses]
    .map(feedbackTemplateFingerprint)
    .filter((item) => item.length >= 30);
}

function refreshValidation(validation = {}) {
  const checks = Array.isArray(validation.checks) ? validation.checks : [];
  const failedChecks = checks.filter((check) => !check.passed);
  const criticalFailures = failedChecks.filter((check) => check.critical);
  return {
    ...validation,
    passed: criticalFailures.length === 0,
    score: checks.length
      ? Math.round(((checks.length - failedChecks.length) / checks.length) * 100)
      : 100,
    checks,
    failedChecks,
    criticalFailures,
  };
}

export function applyBatchFeedbackDiversityChecks(results = []) {
  const eligible = results
    .map((item, index) => ({ item, index, templates: feedbackItems(item?.analysis) }))
    .filter(({ item, templates }) => item?.status !== "error" && templates.length > 0);

  const collisions = new Map();
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) {
      const shared = [...new Set(eligible[left].templates)].filter((template) =>
        eligible[right].templates.includes(template)
      );
      if (shared.length < 2) continue;
      collisions.set(eligible[left].index, Math.max(collisions.get(eligible[left].index) || 0, shared.length));
      collisions.set(eligible[right].index, Math.max(collisions.get(eligible[right].index) || 0, shared.length));
    }
  }

  return results.map((item, index) => {
    const sharedCount = collisions.get(index) || 0;
    if (!sharedCount || !item?.validation) return item;
    const checks = Array.isArray(item.validation.checks) ? [...item.validation.checks] : [];
    checks.push({
      id: "batch_feedback_diversity",
      label: "Chart-specific strengths and weaknesses",
      passed: false,
      details: `${sharedCount} identical feedback statements were reused across different charts.`,
      critical: true,
    });
    const validation = refreshValidation({ ...item.validation, checks });
    return { ...item, status: validation.passed ? "passed" : "failed", validation };
  });
}

function addCheck(checks, id, label, passed, details, critical = true) {
  checks.push({ id, label, passed: Boolean(passed), details: details || "", critical });
}

export function validateBenchmarkResult(result = {}, expectation = {}) {
  const checks = [];
  const toleranceOverride = finiteNumber(expectation.tolerance);
  const direction = normalizeDirection(
    result?.analysisFacts?.direction ||
      result?.regressionSnapshot?.direction ||
      result?.csaDirectionalBias?.biasCode ||
      result?.csaDirectionalBias?.bias ||
      result?.finalFeedback?.directionalBias ||
      ""
  );
  const expectedDirection = normalizeDirection(expectation.expectedDirection || "");
  const entries = selectedEntries(result);
  const factsEntries = factsSelectedEntries(result).sort((a, b) => a.order - b.order);
  const promotedEntries = allPromotedEntries(result);
  const references = referenceEntries(result);
  const feedbackText = String(result?.analysis || result?.summary || result?.finalFeedback?.analysis || "");

  if (expectation.automaticMode === true) {
    const detectedInstrument = String(
      result?.chartDetection?.detectedInstrument || result?.detectedPair || ""
    ).trim();
    const detectedTimeframe = String(
      result?.chartDetection?.detectedTimeframe || result?.detectedTimeframe || ""
    ).trim();
    const selectorDiagnostics = result?.analysisFacts?.selectorDiagnostics;
    const fibCandidates = Array.isArray(selectorDiagnostics?.fibCandidates)
      ? selectorDiagnostics.fibCandidates
      : [];
    const recognizedTypes = new Set([
      "support", "resistance", "converted support", "converted resistance",
      "demand", "supply",
    ]);
    const everyEntryIsStructured = entries.every((entry) =>
      recognizedTypes.has(normalizeAreaType(entry.areaType))
    );
    const everyEntryHasFibConfluence = entries.every((entry) => {
      const entryPrice = finiteNumber(entry.center);
      if (entryPrice === null) return false;
      const tolerance = defaultTolerance(entryPrice);
      return fibCandidates.some((candidate) => {
        if (candidate?.passed !== true) return false;
        const candidatePrice =
          finiteNumber(candidate.resolvedEntryPrice) ??
          finiteNumber(candidate.chartReconciledPrice) ??
          finiteNumber(candidate.frameworkPrice);
        return candidatePrice !== null &&
          Math.abs(candidatePrice - entryPrice) <= tolerance;
      });
    });

    addCheck(
      checks,
      "automatic_chart_context",
      "Instrument and timeframe detected",
      Boolean(detectedInstrument && detectedTimeframe),
      `Detected ${detectedInstrument || "no instrument"} on ${detectedTimeframe || "no timeframe"}.`
    );
    addCheck(
      checks,
      "automatic_direction",
      "Directional bias resolved",
      direction !== "unknown",
      `Resolved direction: ${direction}.`
    );
    addCheck(
      checks,
      "ordered_selector",
      "S/R → S/D → Fibonacci sequence completed",
      Boolean(selectorDiagnostics && Array.isArray(selectorDiagnostics.structuralCandidates) && Array.isArray(selectorDiagnostics.fibCandidates)),
      selectorDiagnostics
        ? `Selector ${selectorDiagnostics.selectorVersion || "unknown"} evaluated structure before Fibonacci filtering.`
        : "Ordered selector diagnostics were not returned."
    );
    addCheck(
      checks,
      "automatic_structural_roles",
      "Selected entries use valid structural roles",
      everyEntryIsStructured,
      everyEntryIsStructured
        ? `${entries.length} selected entr${entries.length === 1 ? "y uses" : "ies use"} support/resistance or supply/demand structure.`
        : "At least one selected entry has an unsupported structural role."
    );
    addCheck(
      checks,
      "automatic_fibonacci_confluence",
      "Selected entries pass hidden Fibonacci confluence",
      everyEntryHasFibConfluence,
      everyEntryHasFibConfluence
        ? `${entries.length} selected entr${entries.length === 1 ? "y is" : "ies are"} backed by a passed 38.2%, 50% or 61.8% candidate check.`
        : "At least one selected entry was not matched to a passed hidden Fibonacci candidate."
    );
  }

  if (expectation.noEntryExpected === true) {
    addCheck(
      checks,
      "no_entry_expected",
      "No valid entry returned",
      factsEntries.length === 0 && entries.length === 0,
      `Expected no selected entries; structured facts returned ${factsEntries.length} and customer-facing output returned ${entries.length}.`
    );
  }

  if (expectedDirection !== "unknown") {
    addCheck(
      checks,
      "direction",
      "Directional bias",
      direction === expectedDirection,
      `Expected ${expectedDirection}; received ${direction}.`
    );
  }

  addCheck(
    checks,
    "maximum_two_entries",
    "Maximum two selected entries",
    factsEntries.length <= 2 && entries.length <= 2,
    `Structured facts returned ${factsEntries.length}; customer-facing output returned ${entries.length}.`
  );

  const expectedEntryCount = finiteNumber(expectation.expectedEntryCount);
  if (expectedEntryCount !== null) {
    addCheck(
      checks,
      "expected_entry_count",
      "Verified number of entries",
      factsEntries.length === expectedEntryCount && entries.length === expectedEntryCount,
      `Expected exactly ${expectedEntryCount}; structured facts returned ${factsEntries.length} and customer-facing output returned ${entries.length}.`
    );
  }

  addCheck(
    checks,
    "canonical_entry_consistency",
    "Internal and customer-facing entries agree",
    entrySetsAgree(factsEntries, entries),
    `Structured facts contain ${factsEntries.length} entr${factsEntries.length === 1 ? "y" : "ies"}; canonical feedback contains ${entries.length}.`
  );

  const expectedEntry1 = finiteNumber(expectation.expectedEntry1);
  const expectedEntry1Type = normalizeAreaType(expectation.expectedEntry1Type || "");
  const entry1Zone = expectedEntryZone(expectation, 1);
  if (expectedEntry1 !== null || entry1Zone) {
    const tolerance = toleranceOverride ?? defaultTolerance(expectedEntry1);
    addCheck(
      checks,
      "entry_1",
      "Entry 1",
      entryMatchesExpectation(entries[0], expectedEntry1, expectedEntry1Type, entry1Zone, tolerance),
      entries[0]
        ? entry1Zone
          ? `Expected ${expectedEntry1Type} zone ${formatExpectedZone(entry1Zone)}; received ${entries[0].levelText || entries[0].center} (${entries[0].zoneLow}–${entries[0].zoneHigh}).`
          : `Expected ${expectedEntry1}; received ${entries[0].levelText || entries[0].center}.`
        : `Expected ${entry1Zone ? `${expectedEntry1Type} zone ${formatExpectedZone(entry1Zone)}` : expectedEntry1}; no Entry 1 was returned.`
    );
  }

  if (expectedEntry1Type !== "unknown") {
    const actualEntry1 = factsEntries[0] || entries[0] || null;
    addCheck(
      checks,
      "entry_1_type",
      "Entry 1 structural role",
      Boolean(actualEntry1) && areaTypeMatches(actualEntry1.areaType, expectedEntry1Type),
      actualEntry1
        ? `Expected ${expectedEntry1Type}; received ${normalizeAreaType(actualEntry1.areaType)}.`
        : `Expected ${expectedEntry1Type}; no Entry 1 was returned.`
    );
  }

  const expectedEntry2 = finiteNumber(expectation.expectedEntry2);
  const expectedEntry2Type = normalizeAreaType(expectation.expectedEntry2Type || "");
  const entry2Zone = expectedEntryZone(expectation, 2);
  const entry2Required = expectation.entry2Required === true || expectedEntry2 !== null || Boolean(entry2Zone);
  if (entry2Required) {
    const tolerance = toleranceOverride ?? defaultTolerance(expectedEntry2 ?? entries[1]?.center ?? 1);
    const passed = entryMatchesExpectation(
      entries[1],
      expectedEntry2,
      expectedEntry2Type,
      entry2Zone,
      tolerance
    );
    addCheck(
      checks,
      "entry_2",
      "Entry 2",
      passed,
      entries[1]
        ? entry2Zone
          ? `Expected ${expectedEntry2Type} zone ${formatExpectedZone(entry2Zone)}; received ${entries[1].levelText || entries[1].center} (${entries[1].zoneLow}–${entries[1].zoneHigh}).`
          : `Expected ${expectedEntry2 ?? "a second entry"}; received ${entries[1].levelText || entries[1].center}.`
        : "A valid Entry 2 was required but none was returned."
    );
  }

  if (expectedEntry2Type !== "unknown") {
    const actualEntry2 = factsEntries[1] || entries[1] || null;
    addCheck(
      checks,
      "entry_2_type",
      "Entry 2 structural role",
      Boolean(actualEntry2) && areaTypeMatches(actualEntry2.areaType, expectedEntry2Type),
      actualEntry2
        ? `Expected ${expectedEntry2Type}; received ${normalizeAreaType(actualEntry2.areaType)}.`
        : `Expected ${expectedEntry2Type}; no Entry 2 was returned.`
    );
  }

  const configuredEntryZones = [
    { entry: entries[0], zone: entry1Zone, type: expectedEntry1Type },
    { entry: entries[1], zone: entry2Zone, type: expectedEntry2Type },
  ].filter((item) => item.zone && isSupplyDemandType(item.type));

  for (const required of parsePriceExpectations(expectation.requiredLevels)) {
    const requiredPrice = required.value;
    const tolerance =
      finiteNumber(expectation.levelTolerance) ??
      toleranceOverride ??
      exactLevelTolerance(requiredPrice, required.digits);
    const matchingZoneExpectation = configuredEntryZones.find((item) =>
      priceInsideZone(requiredPrice, item.zone, tolerance)
    );
    const present = matchingZoneExpectation
      ? areaMatchesExpectedZone(
          matchingZoneExpectation.entry,
          matchingZoneExpectation.zone,
          tolerance
        ) || textMentionsZone(feedbackText, matchingZoneExpectation.zone, tolerance)
      : references.some((area) => Math.abs(Number(area.center) - requiredPrice) <= tolerance) ||
        textMentionsPrice(feedbackText, requiredPrice, tolerance, required.digits);
    addCheck(
      checks,
      `required_level_${requiredPrice}`,
      `Required level ${requiredPrice}`,
      present,
      present
        ? matchingZoneExpectation
          ? `The configured ${matchingZoneExpectation.type} zone is represented by the selected entry or feedback.`
          : "The exact level is present in the structured facts or feedback."
        : matchingZoneExpectation
        ? `The required ${matchingZoneExpectation.type} zone ${formatExpectedZone(matchingZoneExpectation.zone)} is missing.`
        : "The exact required level is missing; broad zone containment does not count."
    );
  }

  for (const required of parsePriceExpectations(expectation.requiredFeedbackLevels)) {
    const requiredPrice = required.value;
    const tolerance =
      finiteNumber(expectation.levelTolerance) ??
      toleranceOverride ??
      exactLevelTolerance(requiredPrice, required.digits);
    const matchingZoneExpectation = configuredEntryZones.find((item) =>
      priceInsideZone(requiredPrice, item.zone, tolerance)
    );
    const present = matchingZoneExpectation
      ? textMentionsZone(feedbackText, matchingZoneExpectation.zone, tolerance)
      : textMentionsPrice(feedbackText, requiredPrice, tolerance, required.digits);
    addCheck(
      checks,
      `required_feedback_level_${requiredPrice}`,
      `Feedback must mention ${requiredPrice}`,
      present,
      present
        ? matchingZoneExpectation
          ? `Customer-facing feedback mentions a price inside the configured ${matchingZoneExpectation.type} zone.`
          : "The exact level is present in customer-facing feedback."
        : matchingZoneExpectation
        ? `Customer-facing feedback does not mention the configured ${matchingZoneExpectation.type} zone ${formatExpectedZone(matchingZoneExpectation.zone)}.`
        : "The required level is absent from customer-facing feedback."
    );
  }

  for (const requiredTerm of parseTextList(expectation.requiredFeedbackTerms)) {
    const present = feedbackMentionsTerm(feedbackText, requiredTerm);
    addCheck(
      checks,
      `required_feedback_term_${normalizeText(requiredTerm).replace(/\s+/g, "_")}`,
      `Feedback must include “${requiredTerm}”`,
      present,
      present
        ? "The required wording is present in customer-facing feedback."
        : `Customer-facing feedback does not include “${requiredTerm}”.`
    );
  }

  for (const forbiddenPrice of parseList(expectation.forbiddenEntries)) {
    const tolerance = toleranceOverride ?? defaultTolerance(forbiddenPrice);
    const promoted = promotedEntries.some((area) => areaContains(area, forbiddenPrice, tolerance));
    addCheck(
      checks,
      `forbidden_entry_${forbiddenPrice}`,
      `Forbidden entry ${forbiddenPrice}`,
      !promoted,
      promoted
        ? "This structural reference was incorrectly promoted as an entry."
        : "The price was not promoted as Entry 1 or Entry 2."
    );
  }

  const strengths = Array.isArray(result?.finalFeedback?.strengths)
    ? result.finalFeedback.strengths
    : Array.isArray(result?.dashboard?.strengths)
    ? result.dashboard.strengths
    : [];
  const weaknesses = Array.isArray(result?.finalFeedback?.weaknesses)
    ? result.finalFeedback.weaknesses
    : Array.isArray(result?.dashboard?.weaknesses)
    ? result.dashboard.weaknesses
    : [];

  addCheck(checks, "strength_limit", "Maximum four strengths", strengths.length <= 4, `${strengths.length} returned.`, false);
  addCheck(checks, "weakness_limit", "Maximum four weaknesses", weaknesses.length <= 4, `${weaknesses.length} returned.`, false);
  addCheck(checks, "duplicate_strengths", "No duplicate strengths", duplicateItems(strengths).length === 0, "Exact normalized duplicates are not allowed.", false);
  addCheck(checks, "duplicate_weaknesses", "No duplicate weaknesses", duplicateItems(weaknesses).length === 0, "Exact normalized duplicates are not allowed.", false);
  addCheck(checks, "hidden_fibonacci", "Fibonacci remains internal", !FIB_WORDS.test(feedbackText), "Customer-facing feedback must not mention Fibonacci.");
  addCheck(checks, "neutral_level_labels", "No day-of-week labels", !DAY_WORDS.test(feedbackText), "Use neutral support/resistance wording.", false);

  const failedChecks = checks.filter((check) => !check.passed);
  const criticalFailures = failedChecks.filter((check) => check.critical);
  const score = checks.length ? Math.round((checks.length - failedChecks.length) / checks.length * 100) : 100;

  return {
    passed: criticalFailures.length === 0,
    score,
    direction,
    selectedEntries: entries,
    checks,
    failedChecks,
    criticalFailures,
    versions: {
      benchmarkValidatorVersion: BENCHMARK_VALIDATOR_VERSION,
      buildId: result?.buildId || null,
      feedbackEngineVersion: result?.feedbackEngineVersion || null,
      selectorVersion: result?.selectorVersion || null,
      regressionEngineVersion: result?.regressionSnapshot?.engineVersion || null,
    },
  };
}

export const benchmarkValidatorInternals = {
  normalizeDirection,
  parseList,
  parsePriceExpectations,
  parseTextList,
  normalizeAreaType,
  areaTypeMatches,
  feedbackMentionsTerm,
  selectedEntries,
  factsSelectedEntries,
  canonicalSelectedEntries,
  referenceEntries,
  areaContains,
  areaMatchesExpectedZone,
  expectedEntryZone,
  entryMatchesExpectation,
  normalizeZoneBounds,
  textMentionsZone,
  defaultTolerance,
  exactLevelTolerance,
  feedbackTemplateFingerprint,
};
