// Lines the trader drew on the chart, as read by the independent line reader.
const EXACT_LINE_SOURCE = "independent_horizontal_line_reader_exact";

const positive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const isExactLineRead = (item) =>
  item?.extractionSource === EXACT_LINE_SOURCE && positive(item?.displayedPrice) !== null;

const sameLine = (a, b) => Math.abs(a - b) <= Number.EPSILON * 100;

// The same drawn line is read twice: once on its own (no framework period) and once
// matched to a framework level. Only the first copy survives the de-duplication, so
// the match is copied onto it as extra fields that nothing else reads.
export function annotateMatchedLines(levels = [], matchedLevels = []) {
  const matched = (Array.isArray(matchedLevels) ? matchedLevels : []).filter(
    (item) => isExactLineRead(item) && Boolean(item?.frameworkPeriodHint)
  );
  return (Array.isArray(levels) ? levels : []).map((item) => {
    if (!isExactLineRead(item)) return item;
    const match = matched.find((candidate) => sameLine(Number(candidate.displayedPrice), Number(item.displayedPrice)));
    if (!match) return item;
    return {
      ...item,
      matchedFrameworkPeriod: match.frameworkPeriodHint,
      matchedFrameworkSide: match.frameworkSideHint || null,
      matchedFrameworkPrice: positive(match.matchedFrameworkPrice),
      matchedAreaType: String(match.matchedAreaType || ""),
      matchTolerance: positive(match.matchTolerance),
    };
  });
}

// The framework levels the trader's drawn lines sit on, nearest to price first.
// Two lines on the same level count once.
export function matchedFrameworkAreas(levels = [], referencePrice = null) {
  const areas = [];
  for (const item of frameworkMatchedLineReads(levels)) {
    const price = positive(item?.matchedFrameworkPrice);
    if (price === null || areas.some((area) => sameLine(area.price, price))) continue;
    areas.push({ price, areaType: String(item?.matchedAreaType || "") });
  }
  const reference = positive(referencePrice);
  return reference === null
    ? areas
    : areas.sort((a, b) => Math.abs(a.price - reference) - Math.abs(b.price - reference));
}

const COUNT_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };

// "You marked two framework levels: the A area around 1.2 and the B area around 1.1."
// Only for two or more levels; one level is credited by the first-area strength.
export function markedAreasStrength(areas = [], { label = (type) => type, format = String } = {}) {
  if (!Array.isArray(areas) || areas.length < 2) return "";
  const parts = areas.map((area) => {
    const name = String(label(area.areaType) || "").trim();
    return `the ${name ? `${name} area` : "level"} around ${format(area.price)}`;
  });
  const list = parts.length === 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `You marked ${COUNT_WORDS[areas.length] || areas.length} framework levels: ${list}.`;
}

// The price map only keeps a displayed price when it is within tolerance of one
// framework level, so an exact read that names a framework period is a drawn
// line sitting on a real previous high or low. Lines with no period behind them
// (a gridline, the last-price line) are not.
export function frameworkMatchedLineReads(levels = []) {
  return (Array.isArray(levels) ? levels : []).filter(
    (item) => isExactLineRead(item) && Boolean(item?.frameworkPeriodHint || item?.matchedFrameworkPeriod)
  );
}

// A drawn line marks an area when it sits within the fixed tolerance of the
// area's centre, or within the wider tolerance it was matched to the framework
// with (feeds differ by a few pips, so the match tolerance scales with ATR).
export function lineMarksArea(levels = [], center, baseTolerance = 0) {
  const target = positive(center);
  if (target === null) return false;
  return (Array.isArray(levels) ? levels : []).some((item) => {
    if (!isExactLineRead(item)) return false;
    const allowed = Math.max(Number(baseTolerance) || 0, positive(item?.matchTolerance) || 0);
    return Math.abs(Number(item.displayedPrice) - target) <= allowed;
  });
}

const UNMARKED_CLAIM = /no visible evidence|not marked|could not be verified/i;

// When the visual review called the chart unmarked but a drawn line sits on a
// framework level, the chart is marked. Statements that say otherwise are dropped.
export function markChartFromFrameworkLines(visualReview = {}) {
  if (String(visualReview?.chartMarkingStatus || "").toLowerCase() === "marked") return visualReview;
  if (!frameworkMatchedLineReads(visualReview?.visibleMarkedLevels).length) return visualReview;

  const keep = (items) =>
    (Array.isArray(items) ? items : []).filter((item) => !UNMARKED_CLAIM.test(String(item || "")));

  return {
    ...visualReview,
    chartMarkingStatus: "marked",
    csaLevelVisibility: "partial",
    visualChartStyle: "marked chart",
    csaSimilarities: keep(visualReview?.csaSimilarities),
    csaDifferences: keep(visualReview?.csaDifferences),
    chartSpecificStrengths: keep(visualReview?.chartSpecificStrengths),
    chartSpecificWeaknesses: keep(visualReview?.chartSpecificWeaknesses),
  };
}
