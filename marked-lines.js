import { isPrintedAxisTick } from "./axis-ticks.js";
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

// The price a line read points at: the exact reader's displayed price, else the first number in the
// approximate price or the platform label.
const readLinePrice = (item) => {
  const direct = positive(item?.displayedPrice);
  if (direct !== null) return direct;
  for (const field of [item?.approximatePrice, item?.platformLabel]) {
    if (field === null || field === undefined) continue;
    const match = String(field).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    const value = match ? positive(match[0]) : null;
    if (value !== null) return value;
  }
  return null;
};

const reviewMarkingStatus = (review) => {
  const explicit = String(review?.chartMarkingStatus || "").toLowerCase();
  if (["marked", "unmarked", "unclear"].includes(explicit)) return explicit;
  const visibility = String(review?.csaLevelVisibility || "").toLowerCase();
  const style = String(review?.visualChartStyle || "").toLowerCase();
  if (visibility === "not marked" || style.includes("unmarked")) return "unmarked";
  if (["clear", "partial"].includes(visibility) || style.includes("marked chart") || style.includes("clear support")) return "marked";
  return "unclear";
};

// A chart is only "marked" when a line the trader could have drawn was actually read. The image reader's
// "marked" call alone is not evidence: USDINDEX H4, 25 Nov 2026, a clean chart, was told "Levels marked on chart".
// Reads that do not count: no price at all, a printed axis number, and the chart's own last-price line.
export function hasDrawnLineEvidence(visualReview = {}, { axisTicks = [], lastPrice = null } = {}) {
  const reads = [
    ...(Array.isArray(visualReview?.visibleMarkedLevels) ? visualReview.visibleMarkedLevels : []),
    ...(Array.isArray(visualReview?.visibleHorizontalLines) ? visualReview.visibleHorizontalLines : []),
  ];
  const last = positive(lastPrice);
  return reads.some((item) => {
    const price = readLinePrice(item);
    if (price === null) return false;
    if (isPrintedAxisTick(price, axisTicks)) return false;
    if (last !== null && Math.abs(price - last) <= last * 0.0002) return false;
    return true;
  });
}

// "marked" with no drawn line behind it becomes "unclear": neither "you marked levels" nor "you marked nothing".
export function requireLineEvidenceForMarked(visualReview = {}, options = {}) {
  if (reviewMarkingStatus(visualReview) !== "marked") return visualReview;
  if (hasDrawnLineEvidence(visualReview, options)) return visualReview;
  return {
    ...visualReview,
    chartMarkingStatus: "unclear",
    csaLevelVisibility: "unclear",
    visualChartStyle: "unclear",
    csaSimilarities: [],
    csaDifferences: [],
    markedClaimDropped: true,
  };
}

// A line read exactly at a printed axis number is the axis number, not a drawn line (USDINDEX H4, 25 Nov 2026: the
// reader "saw" a dashed line at 104.000; the index's wide 0.25 line tolerance matched it to the week-3 high 103.975,
// so a later step marked the chart again and credited levels the trader never drew). These reads are removed from the
// review before any marking or matching step looks at them. Fewer than three printed ticks: nothing is judged.
export function withoutAxisTickReads(visualReview = {}, axisTicks = []) {
  let removed = 0;
  const keep = (items) => {
    if (!Array.isArray(items)) return items;
    return items.filter((item) => {
      const price = readLinePrice(item);
      if (price !== null && isPrintedAxisTick(price, axisTicks)) {
        removed += 1;
        return false;
      }
      return true;
    });
  };
  const visibleMarkedLevels = keep(visualReview?.visibleMarkedLevels);
  const visibleHorizontalLines = keep(visualReview?.visibleHorizontalLines);
  if (!removed) return visualReview;
  return { ...visualReview, visibleMarkedLevels, visibleHorizontalLines, axisTickReadsRemoved: removed };
}

// The printed prices of the drawn lines that were credited to a framework level (the lines the review says the
// trader "marked"). The same lines also come back as reference-only levels, which the chart would draw a second
// time as "Level to watch" (USDINDEX H4, 25 Nov 2026: the line at 103.237, credited to Buy 1 at 103.366, was also
// listed as "Level to watch 103.2370").
export function creditedLinePrices(levels = []) {
  return frameworkMatchedLineReads(levels)
    .map((item) => positive(item?.displayedPrice))
    .filter((price) => price !== null);
}

// References that are one of those credited lines are left out of the levels to watch. A reference only counts as
// the line when it sits on the line's printed price (within 0.01% of price), so an unrelated nearby level stays.
export function withoutCreditedLineReferences(references = [], linePrices = [], relativeTolerance = 0.0001) {
  const prices = (Array.isArray(linePrices) ? linePrices : []).map(positive).filter((price) => price !== null);
  const list = Array.isArray(references) ? references : [];
  if (!prices.length) return list;
  return list.filter((reference) => {
    const center = positive(reference?.authoritativeCenter);
    if (center === null) return true;
    return !prices.some((price) => Math.abs(price - center) <= price * relativeTolerance);
  });
}

// A drawn line that sits on a completed period's high or low is an entry candidate in its own right, whether or not
// the AI's own candidate list happens to name it. The list is the vision model's, and it varies from run to run:
// benchmark chart 2902 (USA30 H1, four runs on 26 Nov 2026) had the trader's line at 53275.6 in two runs and not in the
// other two, so Entry 1 flipped between the line and the candle low 53261.4. Here the candidate is built from the line
// read itself.
//
// Only lines that the price map or the final matching put on a framework level count (a loose line stays reference
// only), and only when the nearest period candidate is within that match tolerance (or 0.05% of price), so the
// existing replacement rule swaps the period level for the line instead of keeping both. One line per period level,
// the closest one. Nothing is built when the AI list already has the line's price. `replacesPrice` is the period
// level the line stands in for, so an AI candidate that is just that level can be dropped by the caller.
//
// A read sitting on the last price (within 0.02%, the same allowance hasDrawnLineEvidence uses) is the platform's
// price line, not a line the trader drew (chart 2914: 53496.2, exactly the last price), so it builds nothing.
const SAME_PRICE = 0.00002;

export function drawnLineCandidatesFromReads({ levels = [], periodCandidates = [], existingPrices = [], lastPrices = [], fraction = 0.0005 } = {}) {
  const last = (Array.isArray(lastPrices) ? lastPrices : []).map(positive).filter((price) => price !== null);
  const periods = (Array.isArray(periodCandidates) ? periodCandidates : []).filter((candidate) => positive(candidate?.price) !== null);
  if (!periods.length) return [];
  const taken = (Array.isArray(existingPrices) ? existingPrices : []).map(positive).filter((price) => price !== null);
  const bestByPeriod = new Map();
  for (const line of frameworkMatchedLineReads(levels)) {
    const price = positive(line?.displayedPrice);
    if (price === null || last.some((other) => Math.abs(price - other) <= other * 0.0002)) continue;
    const nearest = periods
      .map((candidate) => ({ candidate, gap: Math.abs(Number(candidate.price) - price) }))
      .sort((a, b) => a.gap - b.gap)[0];
    const allowed = Math.max(positive(line?.matchTolerance) || 0, price * fraction);
    if (!nearest || nearest.gap > allowed) continue;
    const current = bestByPeriod.get(nearest.candidate);
    if (!current || nearest.gap < current.gap) bestByPeriod.set(nearest.candidate, { price, gap: nearest.gap });
  }
  const built = [];
  for (const [candidate, { price }] of bestByPeriod) {
    if (taken.some((other) => Math.abs(other - price) <= price * SAME_PRICE)) continue;
    built.push({
      ...candidate,
      price,
      zoneLow: price,
      zoneHigh: price,
      exactVisiblePrice: true,
      independentEntryEvidence: true,
      structuralEvidence: `exact line drawn at ${price} on the ${candidate.sourcePeriod || candidate.sourceDay || "framework"} ${candidate.sourceExtreme || "level"}`,
      builtFromDrawnLine: true,
      replacesPrice: Number(candidate.price),
    });
  }
  return built;
}

// The AI-listed candidates that are only the period level a line has replaced.
export function withoutReplacedPeriodCandidates(listed = [], lineBuilt = []) {
  const list = Array.isArray(listed) ? listed : [];
  const replaced = (Array.isArray(lineBuilt) ? lineBuilt : []).map((item) => positive(item?.replacesPrice)).filter((price) => price !== null);
  if (!replaced.length) return list;
  return list.filter((candidate) => {
    const price = positive(candidate?.price);
    return price === null || !replaced.some((other) => Math.abs(other - price) <= other * SAME_PRICE);
  });
}
