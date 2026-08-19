const DAY_WORDS = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:'s)?\b/i;
const FIB_WORDS = /\b(?:fib(?:onacci)?|38\.2%|50%|61\.8%)\b/i;

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

  addCheck(
    checks,
    "canonical_entry_consistency",
    "Internal and customer-facing entries agree",
    entrySetsAgree(factsEntries, entries),
    `Structured facts contain ${factsEntries.length} entr${factsEntries.length === 1 ? "y" : "ies"}; canonical feedback contains ${entries.length}.`
  );

  const expectedEntry1 = finiteNumber(expectation.expectedEntry1);
  if (expectedEntry1 !== null) {
    const tolerance = toleranceOverride ?? defaultTolerance(expectedEntry1);
    addCheck(
      checks,
      "entry_1",
      "Entry 1",
      areaContains(entries[0], expectedEntry1, tolerance),
      entries[0]
        ? `Expected ${expectedEntry1}; received ${entries[0].levelText || entries[0].center}.`
        : `Expected ${expectedEntry1}; no Entry 1 was returned.`
    );
  }

  const expectedEntry2 = finiteNumber(expectation.expectedEntry2);
  const entry2Required = expectation.entry2Required === true || expectedEntry2 !== null;
  if (entry2Required) {
    const tolerance = toleranceOverride ?? defaultTolerance(expectedEntry2 ?? entries[1]?.center ?? 1);
    const passed = expectedEntry2 === null
      ? Boolean(entries[1])
      : areaContains(entries[1], expectedEntry2, tolerance);
    addCheck(
      checks,
      "entry_2",
      "Entry 2",
      passed,
      entries[1]
        ? `Expected ${expectedEntry2 ?? "a second entry"}; received ${entries[1].levelText || entries[1].center}.`
        : "A valid Entry 2 was required but none was returned."
    );
  }

  for (const required of parsePriceExpectations(expectation.requiredLevels)) {
    const requiredPrice = required.value;
    const tolerance = finiteNumber(expectation.levelTolerance) ?? exactLevelTolerance(requiredPrice, required.digits);
    const present =
      references.some((area) => Math.abs(Number(area.center) - requiredPrice) <= tolerance) ||
      textMentionsPrice(feedbackText, requiredPrice, tolerance, required.digits);
    addCheck(
      checks,
      `required_level_${requiredPrice}`,
      `Required level ${requiredPrice}`,
      present,
      present ? "The exact level is present in the structured facts or feedback." : "The exact required level is missing; broad zone containment does not count."
    );
  }

  for (const required of parsePriceExpectations(expectation.requiredFeedbackLevels)) {
    const requiredPrice = required.value;
    const tolerance = finiteNumber(expectation.levelTolerance) ?? exactLevelTolerance(requiredPrice, required.digits);
    const present = textMentionsPrice(feedbackText, requiredPrice, tolerance, required.digits);
    addCheck(
      checks,
      `required_feedback_level_${requiredPrice}`,
      `Feedback must mention ${requiredPrice}`,
      present,
      present ? "The exact level is present in customer-facing feedback." : "The required level is absent from customer-facing feedback."
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
  selectedEntries,
  factsSelectedEntries,
  canonicalSelectedEntries,
  referenceEntries,
  areaContains,
  defaultTolerance,
  exactLevelTolerance,
};
