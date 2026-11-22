// Lines the trader drew on the chart, as read by the independent line reader.
const EXACT_LINE_SOURCE = "independent_horizontal_line_reader_exact";

const positive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const isExactLineRead = (item) =>
  item?.extractionSource === EXACT_LINE_SOURCE && positive(item?.displayedPrice) !== null;

const sameLine = (a, b) => Math.abs(a - b) <= Number.EPSILON * 100;

// How far a drawn line's printed price may sit from a framework level and still count as that level: the larger of
// the standard reconciliation tolerance, a quarter of the ATR, and the feed allowance. The dollar index is built from
// six currency pairs (OANDA), not the trader's broker feed, and its levels drift 0.07 to 0.19 from the broker's chart;
// USDINDEX H4 2026-11-22: the trader's line at 102.227 (the week of 2 Nov high on the ThinkMarkets chart, 102.22 on the
// MT4 chart) was 0.074 from the exchange weekly high and 0.118 from the candle-built one, outside a 0.037 tolerance, so
// it stayed a second entry next to that high. feedAllowance is that index tolerance (0 for every other instrument).
export function lineMatchTolerance({ standardTolerance = 0, atr = 0, feedAllowance = 0 } = {}) {
  return Math.max(Number(standardTolerance) || 0, (Number(atr) || 0) * 0.25, Number(feedAllowance) || 0);
}

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

// The price map compares the drawn lines with the framework levels known when it runs, which
// follow the earlier direction. When the final review flips direction (or picks other entries),
// a line on one of the final areas was never compared with it. Compare the lines that have no
// match yet with the final areas, within the same ATR-scaled tolerance.
export function matchLinesToAreas(levels = [], areas = [], tolerance = 0) {
  const list = Array.isArray(levels) ? levels : [];
  const allowed = positive(tolerance);
  const candidates = (Array.isArray(areas) ? areas : []).filter((area) => positive(area?.price) !== null);
  if (allowed === null || !candidates.length) return list;
  let changed = false;
  const result = list.map((item) => {
    if (!isExactLineRead(item) || item.frameworkPeriodHint || item.matchedFrameworkPeriod) return item;
    const price = Number(item.displayedPrice);
    const nearest = candidates
      .map((area) => ({ area, distance: Math.abs(Number(area.price) - price) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest.distance > allowed) return item;
    changed = true;
    return {
      ...item,
      matchedFrameworkPeriod: nearest.area.period || "framework",
      matchedFrameworkSide: null,
      matchedFrameworkPrice: Number(nearest.area.price),
      matchedAreaType: String(nearest.area.areaType || ""),
      matchTolerance: allowed,
    };
  });
  return changed ? result : list;
}

// The visual review with its drawn lines compared with the final framework areas, and the chart
// marked when one of them sits on a framework level.
export function markLinesOnAreas(visualReview = {}, areas = [], tolerance = 0) {
  const levels = Array.isArray(visualReview?.visibleMarkedLevels) ? visualReview.visibleMarkedLevels : [];
  const matched = matchLinesToAreas(levels, areas, tolerance);
  const review = matched === levels ? visualReview : { ...visualReview, visibleMarkedLevels: matched };
  return markChartFromFrameworkLines(review);
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
export function markedAreasStrength(areas = [], { label = (type) => type, format = String, entryNumbers = null } = {}) {
  if (!Array.isArray(areas) || areas.length < 2) return "";
  const parts = areas.map((area) => {
    const name = String(label(area.areaType) || "").trim();
    return `the ${name ? `${name} area` : "level"} around ${format(area.price)}`;
  });
  const list = parts.length === 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  // Which of the marked levels are entry areas ("Entry 3"), when the caller knows.
  const entries = (Array.isArray(entryNumbers) ? entryNumbers : []).filter((number) => number > 0);
  const named = entries.map((number) => `Entry ${number}`);
  const entryNote = !named.length
    ? ""
    : named.length === 1
    ? ` ${named[0]} is one of them.`
    : ` ${named.slice(0, -1).join(", ")} and ${named[named.length - 1]} are among them.`;
  return `You marked ${COUNT_WORDS[areas.length] || areas.length} framework levels: ${list}.${entryNote}`;
}

// Which entry (1, 2, 3 in the order they are listed) each marked framework area is; 0 when it is none of them.
// The marked area carries the framework's own price, so the match is within a hair of exact.
export function markedEntryNumbers(areas = [], entries = [], relativeTolerance = 0.00005) {
  const list = Array.isArray(entries) ? entries : [];
  return (Array.isArray(areas) ? areas : []).map((area) => {
    const price = positive(area?.price);
    if (price === null) return 0;
    const index = list.findIndex((entry) => {
      const center = positive(entry?.authoritativeCenter);
      return center !== null && Math.abs(center - price) <= price * relativeTolerance + Number.EPSILON * 100;
    });
    return index + 1;
  });
}

const ORDINAL_WORDS = ["first", "second", "third"];

// The trader's own drawn lines that the engine used as entry areas, in entry order (the entries array is the entry
// list: index 0 is Entry 1). A drawn line that reached no framework period is an entry in its own right (the
// price map compares lines with framework levels, and the line reader's own areas are left out of that
// comparison), so nothing else credits it: USDINDEX H4 2026-11-22, the trader's line at 102.227 became Buy 2 and
// "What you did well" only said the pair and timeframe matched.
// Returns { areas: [{ price, areaType }], numbers: [entry numbers] }.
export const DRAWN_LINE_ENTRY_SOURCE = "independent_horizontal_line_reader_exact";
export function drawnLineEntryCredit(entries = []) {
  const areas = [];
  const numbers = [];
  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    if (String(entry?.priceSource || "") !== DRAWN_LINE_ENTRY_SOURCE) return;
    const price = positive(entry?.authoritativeCenter);
    if (price === null || areas.some((area) => sameLine(area.price, price))) return;
    areas.push({ price, areaType: String(entry?.areaType || "") });
    numbers.push(index + 1);
  });
  return { areas, numbers };
}

// One marked level that sits on one of the framework's entry areas: "You marked the ... area around 0.68538,
// which is the framework's third entry area (Entry 3)." Several levels are credited by markedAreasStrength.
export function markedEntryStrength(areas = [], entryNumbers = [], { label = (type) => type, format = String } = {}) {
  if (!Array.isArray(areas) || areas.length !== 1) return "";
  const number = Number(entryNumbers?.[0]);
  if (!(number > 0)) return "";
  const name = String(label(areas[0].areaType) || "").trim();
  const ordinal = ORDINAL_WORDS[number - 1];
  return `You marked the ${name ? `${name} area` : "level"} around ${format(areas[0].price)}, which is the framework's ${ordinal ? `${ordinal} ` : ""}entry area (Entry ${number}).`;
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

// The drawn line (if any) that replaces a period high/low as an entry candidate, or undefined. A line replaces a
// level that is not identical to it when the gap is within `fraction` of price (the long-standing 0.05% rule), or
// when the line has a match tolerance (how far it was matched to a framework level) and the level is the nearest
// period level to the line and within that tolerance. The nearest-only rule keeps a line between two levels from
// swallowing both.
export function supersedingDrawnLine({ candidatePrice, candidatePrices = [], lines = [], fraction = 0.0005 } = {}) {
  const price = positive(candidatePrice);
  if (price === null) return undefined;
  const others = (Array.isArray(candidatePrices) ? candidatePrices : []).map(positive).filter((value) => value !== null);
  for (const line of Array.isArray(lines) ? lines : []) {
    const linePrice = positive(line?.price);
    if (linePrice === null) continue;
    const gap = Math.abs(linePrice - price);
    if (gap === 0) continue;
    if (gap <= linePrice * fraction) return linePrice;
    const tolerance = positive(line?.tolerance);
    if (tolerance !== null && gap <= tolerance) {
      const nearest = Math.min(...others.map((other) => Math.abs(linePrice - other)).filter((distance) => distance > 0), gap);
      if (gap <= nearest) return linePrice;
    }
  }
  return undefined;
}
