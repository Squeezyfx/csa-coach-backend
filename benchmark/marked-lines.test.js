import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  annotateMatchedLines,
  frameworkMatchedLineReads,
  lineMarksArea,
  markChartFromFrameworkLines,
  drawnLineEntryCredit,
  lineMatchTolerance,
  markLinesOnAreas,
  markedAreasStrength,
  markedEntryNumbers,
  markedEntryStrength,
  matchedFrameworkAreas,
  matchLinesToAreas,
  hasDrawnLineEvidence,
  withoutAxisTickReads,
  requireLineEvidenceForMarked,
  supersedingDrawnLine,
} from "../marked-lines.js";

const EXACT = "independent_horizontal_line_reader_exact";

// EURAUD H1, 4 Nov 2026: the trader drew lines at 1.60266 and 1.59734. The price map matched them to
// Monday's high (1.60259) and Tuesday's low (1.59686) within the ATR-scaled tolerance (0.00066).
const upper = { extractionSource: EXACT, displayedPrice: 1.60266, frameworkPeriodHint: "Monday", frameworkSideHint: "high", matchTolerance: 0.000659 };
const lower = { extractionSource: EXACT, displayedPrice: 1.59734, frameworkPeriodHint: "Tuesday", frameworkSideHint: "low", matchTolerance: 0.000659 };
// EURUSD: the AI described the chart's own last-price line / a gridline at 1.118. No framework period behind it.
const gridline = { extractionSource: EXACT, displayedPrice: 1.118, frameworkPeriodHint: null };

test("only exact line reads that sit on a framework level count as matched", () => {
  const levels = [
    upper,
    lower,
    gridline,
    { extractionSource: "per_target_framework_price_reader", displayedPrice: 1.6, frameworkPeriodHint: "Monday" },
    { extractionSource: EXACT, displayedPrice: null, frameworkPeriodHint: "Monday" },
  ];
  assert.deepEqual(frameworkMatchedLineReads(levels), [upper, lower]);
  assert.deepEqual(frameworkMatchedLineReads(undefined), []);
});

test("a chart the visual review called unmarked becomes marked when a drawn line sits on a framework level", () => {
  const review = {
    chartMarkingStatus: "unmarked",
    visibleMarkedLevels: [upper, lower],
    csaSimilarities: ["Price is above the marked area."],
    csaDifferences: ["There is no visible evidence of user-marked support or resistance on this chart."],
    chartSpecificStrengths: ["Clear trend."],
    chartSpecificWeaknesses: ["Support and resistance are not marked on the chart."],
  };
  const result = markChartFromFrameworkLines(review);
  assert.equal(result.chartMarkingStatus, "marked");
  assert.deepEqual(result.csaDifferences, []);
  assert.deepEqual(result.chartSpecificWeaknesses, []);
  assert.deepEqual(result.csaSimilarities, ["Price is above the marked area."]);
  assert.deepEqual(result.chartSpecificStrengths, ["Clear trend."]);
});

test("a chart that is already marked is left exactly as it was", () => {
  const review = { chartMarkingStatus: "marked", visibleMarkedLevels: [upper], csaDifferences: ["No visible evidence of a second line."] };
  assert.equal(markChartFromFrameworkLines(review), review);
});

test("a gridline or last-price line with no framework period behind it does not mark the chart", () => {
  const review = { chartMarkingStatus: "unmarked", visibleMarkedLevels: [gridline] };
  assert.equal(markChartFromFrameworkLines(review), review);
  assert.equal(markChartFromFrameworkLines({ chartMarkingStatus: "unclear" }).chartMarkingStatus, "unclear");
});

test("a drawn line marks an area within the tolerance it was matched with", () => {
  const fixed = 0.0001;
  // Entry 1 (1.60259) is 0.7 pips from the upper line: inside even the fixed tolerance.
  assert.equal(lineMarksArea([upper, lower], 1.60259, fixed), true);
  // Entry 2 (1.59686) is 4.8 pips from the lower line: only the match tolerance covers it.
  assert.equal(lineMarksArea([{ ...lower, matchTolerance: null }], 1.59686, fixed), false);
  assert.equal(lineMarksArea([lower], 1.59686, fixed), true);
  // A line far from the area never marks it.
  assert.equal(lineMarksArea([upper, lower], 1.58578, fixed), false);
  assert.equal(lineMarksArea([upper], null, fixed), false);
});

// What the live EURAUD run actually produced (benchmark 2026-11-04 04:17): each drawn line is in the list once,
// as the generic read with an empty framework period; the copy that names Monday/Tuesday was dropped as a duplicate.
const survivors = [
  { type: "label", displayedPrice: 1.60266, frameworkPeriodHint: "", frameworkSideHint: "", extractionSource: EXACT },
  { type: "label", displayedPrice: 1.59734, frameworkPeriodHint: "", frameworkSideHint: "", extractionSource: EXACT },
];
const matchedCopies = [
  { displayedPrice: 1.60266, frameworkPeriodHint: "Monday", frameworkSideHint: "high", extractionSource: EXACT, matchTolerance: 0.000613 },
  { displayedPrice: 1.59734, frameworkPeriodHint: "Tuesday", frameworkSideHint: "low", extractionSource: EXACT, matchTolerance: 0.000613 },
];

test("the framework match is copied onto the line that survives de-duplication", () => {
  const annotated = annotateMatchedLines(survivors, matchedCopies);
  assert.equal(annotated[0].matchedFrameworkPeriod, "Monday");
  assert.equal(annotated[1].matchedFrameworkPeriod, "Tuesday");
  assert.equal(annotated[0].matchTolerance, 0.000613);
  // Everything the rest of the engine reads is untouched.
  assert.equal(annotated[0].frameworkPeriodHint, "");
  assert.equal(annotated[0].displayedPrice, 1.60266);
  // A line with no framework match, and a list with no matches, come back unchanged.
  assert.deepEqual(annotateMatchedLines([gridline], matchedCopies), [gridline]);
  assert.deepEqual(annotateMatchedLines(survivors, []), survivors);
});

test("the live EURAUD shape marks the chart and credits both areas", () => {
  const levels = annotateMatchedLines(survivors, matchedCopies);
  const result = markChartFromFrameworkLines({ chartMarkingStatus: "unclear", visibleMarkedLevels: levels });
  assert.equal(result.chartMarkingStatus, "marked");
  assert.equal(lineMarksArea(levels, 1.60259, 0.0001), true);
  assert.equal(lineMarksArea(levels, 1.59686, 0.0001), true);
  // The same chart without the framework match stays unmarked: this is what failed live.
  assert.equal(markChartFromFrameworkLines({ chartMarkingStatus: "unclear", visibleMarkedLevels: survivors }).chartMarkingStatus, "unclear");
});

// Same two lines, now carrying which framework level each one sits on (EURAUD, 4 Nov 2026).
const withPrices = [
  { ...matchedCopies[0], matchedFrameworkPrice: 1.60259, matchedAreaType: "converted support" },
  { ...matchedCopies[1], matchedFrameworkPrice: 1.59686, matchedAreaType: "demand" },
];
const plainLabel = (type) => (type === "converted support" ? "resistance-turned-support" : type);
const fmt = (price) => price.toFixed(5);

test("every drawn line on a framework level is listed, nearest to price first", () => {
  const levels = annotateMatchedLines(survivors, withPrices);
  assert.deepEqual(matchedFrameworkAreas(levels, 1.61656), [
    { price: 1.60259, areaType: "converted support" },
    { price: 1.59686, areaType: "demand" },
  ]);
  // Price below both lines flips the order.
  assert.equal(matchedFrameworkAreas(levels, 1.58)[0].price, 1.59686);
  // Two lines on the same framework level count once; a gridline adds nothing.
  assert.equal(matchedFrameworkAreas([...levels, { ...levels[0], displayedPrice: 1.60268 }, gridline], 1.61656).length, 2);
  assert.deepEqual(matchedFrameworkAreas([gridline]), []);
});

test("two or more marked framework levels are credited together, one level is left to the first-area strength", () => {
  const two = matchedFrameworkAreas(annotateMatchedLines(survivors, withPrices), 1.61656);
  assert.equal(
    markedAreasStrength(two, { label: plainLabel, format: fmt }),
    "You marked two framework levels: the resistance-turned-support area around 1.60259 and the demand area around 1.59686."
  );
  assert.equal(
    markedAreasStrength([...two, { price: 1.58578, areaType: "support" }], { label: plainLabel, format: fmt }),
    "You marked three framework levels: the resistance-turned-support area around 1.60259, the demand area around 1.59686 and the support area around 1.58578."
  );
  assert.equal(markedAreasStrength(two.slice(0, 1), { label: plainLabel, format: fmt }), "");
  assert.equal(markedAreasStrength([], { label: plainLabel, format: fmt }), "");
  // No weekday names in customer text, and a level with no known type still reads sensibly.
  assert.doesNotMatch(markedAreasStrength(two, { label: plainLabel, format: fmt }), /monday|tuesday|wednesday/i);
  assert.match(markedAreasStrength([{ price: 1.1, areaType: "" }, { price: 1.2, areaType: "" }], { format: fmt }), /the level around 1\.10000 and the level around 1\.20000/);
});

// EURAUD H1 pre-trade, 4 Nov 2026 15:53 (production log). The price map only knew the earlier bearish
// target (Tuesday high 1.60729, 46 pips from the nearest line), so both drawn lines came back unmatched.
// The final review then flipped bullish and chose 1.60226 and 1.59683 as its entries.
const unmatched = [
  { type: "label", displayedPrice: 1.60266, frameworkPeriodHint: null, frameworkSideHint: null, extractionSource: EXACT },
  { type: "label", displayedPrice: 1.59734, frameworkPeriodHint: null, frameworkSideHint: null, extractionSource: EXACT },
];
const finalAreas = [
  { price: 1.60226, areaType: "converted support", period: null },
  { price: 1.59683, areaType: "demand", period: null },
  { price: 1.60729, areaType: "converted resistance", period: "Tuesday" },
];
const liveTolerance = 0.0007555357142857036;

test("lines left unmatched by the price map are compared with the final areas", () => {
  const levels = matchLinesToAreas(unmatched, finalAreas, liveTolerance);
  assert.equal(levels[0].matchedFrameworkPrice, 1.60226);
  assert.equal(levels[0].matchedAreaType, "converted support");
  assert.equal(levels[1].matchedFrameworkPrice, 1.59683);
  assert.equal(levels[1].matchedAreaType, "demand");
  assert.equal(levels[0].matchTolerance, liveTolerance);
  // Nothing else about the line changes.
  assert.equal(levels[0].displayedPrice, 1.60266);
  assert.equal(levels[0].frameworkPeriodHint, null);
});

test("a line goes to the nearest final area, and only within the tolerance", () => {
  const far = { ...unmatched[0], displayedPrice: 1.6045 };
  assert.deepEqual(matchLinesToAreas([far], finalAreas, liveTolerance), [far]);
  assert.deepEqual(matchLinesToAreas(unmatched, finalAreas, 0), unmatched);
  assert.deepEqual(matchLinesToAreas(unmatched, [], liveTolerance), unmatched);
  assert.equal(matchLinesToAreas(unmatched, finalAreas, liveTolerance)[0].matchedFrameworkPrice, 1.60226);
});

test("lines the price map already matched, and non-line items, are left alone", () => {
  const already = { ...upper, matchedFrameworkPrice: 1.60259 };
  const other = { type: "label", displayedPrice: 1.60226, extractionSource: "per_target_framework_price_reader" };
  const result = matchLinesToAreas([already, other], finalAreas, liveTolerance);
  assert.equal(result[0], already);
  assert.equal(result[1], other);
});

test("the live pre-trade shape marks the chart and credits both final areas", () => {
  const review = markLinesOnAreas({ chartMarkingStatus: "unclear", visibleMarkedLevels: unmatched }, finalAreas, liveTolerance);
  assert.equal(review.chartMarkingStatus, "marked");
  assert.equal(lineMarksArea(review.visibleMarkedLevels, 1.60226, 0.0001), true);
  assert.equal(lineMarksArea(review.visibleMarkedLevels, 1.59683, 0.0001), true);
  assert.equal(
    markedAreasStrength(matchedFrameworkAreas(review.visibleMarkedLevels, 1.60261), { label: plainLabel, format: fmt }),
    "You marked two framework levels: the resistance-turned-support area around 1.60226 and the demand area around 1.59683."
  );
});

test("a chart with no line near any final area stays as it was", () => {
  const review = { chartMarkingStatus: "unclear", visibleMarkedLevels: [{ ...unmatched[0], displayedPrice: 1.118 }] };
  assert.equal(markLinesOnAreas(review, finalAreas, liveTolerance), review);
  assert.equal(markLinesOnAreas({ chartMarkingStatus: "unclear" }, finalAreas, liveTolerance).chartMarkingStatus, "unclear");
});

test("the review pipeline uses these helpers", () => {
  const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.match(serverSource, /visibleMarkedLevels: annotateMatchedLines\(/);
  assert.match(serverSource, /matchTolerance: nullablePositiveNumber\(item\?\.matchTolerance\)/);
  assert.match(serverSource, /matchedFrameworkPrice: nullablePositiveNumber\(item\?\.matchedFrameworkPrice\)/);
  assert.match(serverSource, /matchedFrameworkPrice: nullablePositiveNumber\(match\?\.frameworkPrice\)/);
  assert.match(serverSource, /markedFrameworkAreas: matchedFrameworkAreas\(visibleUserMarkedLevels, currentPrice\)/);
  assert.match(serverSource, /const creditAreas = drawnEntryCredit\.areas\.length \? drawnEntryCredit\.areas : userEvidence\.markedFrameworkAreas/);
  assert.match(serverSource, /markedAreasStrength\(creditAreas/);
  assert.match(serverSource, /visualReview = markChartFromFrameworkLines\(visualReview\)/);
  assert.match(serverSource, /lineMarksArea\(\s*visibleUserMarkedLevels/);
  assert.match(serverSource, /matchTolerance: nullablePositiveNumber\(match\?\.selectedTolerance\)/);
  assert.match(serverSource, /visualReview = markLinesOnAreas\(\s*visualReview,\s*\[\.\.\.rankedRawAreas, \.\.\.structuralReferenceAreas\]/);
  assert.match(serverSource, /getExactLineMatchTolerances\(\{ marketReference, timeframe \}\)\.exactLabelTolerance/);
});

// AUDUSD H4, 2026-11-20 22:37 UTC: the trader's one drawn line (0.68536) sat on the framework's third entry area
// (0.68538) and the feedback only said "You marked levels on the chart, which makes review easier."
test("a marked level that is an entry area says which entry it is", () => {
  const entries = [{ authoritativeCenter: 0.67686 }, { authoritativeCenter: 0.67793 }, { authoritativeCenter: 0.68538 }];
  const marked = [{ price: 0.68538, areaType: "converted support" }];
  const numbers = markedEntryNumbers(marked, entries);
  assert.deepEqual(numbers, [3]);
  assert.equal(
    markedEntryStrength(marked, numbers, { label: plainLabel, format: fmt }),
    "You marked the resistance-turned-support area around 0.68538, which is the framework's third entry area (Entry 3)."
  );
  assert.match(markedEntryStrength(marked, [1], { label: plainLabel, format: fmt }), /framework's first entry area \(Entry 1\)/);
  // a level that is no entry area, no entries at all, or several levels: nothing here (other wording applies)
  assert.deepEqual(markedEntryNumbers([{ price: 0.7 }], entries), [0]);
  assert.equal(markedEntryStrength([{ price: 0.7, areaType: "support" }], [0], { label: plainLabel, format: fmt }), "");
  assert.deepEqual(markedEntryNumbers(marked, []), [0]);
  assert.equal(markedEntryStrength([...marked, ...marked], [3, 3], { label: plainLabel, format: fmt }), "");
  // a hair of difference still matches (feed rounding); a real gap does not
  assert.deepEqual(markedEntryNumbers([{ price: 0.685381 }], entries), [3]);
  assert.deepEqual(markedEntryNumbers([{ price: 0.6865 }], entries), [0]);
});

test("several marked levels name the entries among them, and read as before when none is an entry", () => {
  const two = [{ price: 1.60259, areaType: "converted support" }, { price: 1.59686, areaType: "demand" }];
  const base = "You marked two framework levels: the resistance-turned-support area around 1.60259 and the demand area around 1.59686.";
  assert.equal(markedAreasStrength(two, { label: plainLabel, format: fmt }), base);
  assert.equal(markedAreasStrength(two, { label: plainLabel, format: fmt, entryNumbers: [0, 0] }), base);
  assert.equal(markedAreasStrength(two, { label: plainLabel, format: fmt, entryNumbers: [0, 2] }), `${base} Entry 2 is one of them.`);
  assert.equal(markedAreasStrength(two, { label: plainLabel, format: fmt, entryNumbers: [1, 2] }), `${base} Entry 1 and Entry 2 are among them.`);
});

test("the server uses it after the first-area credit and before the generic line, with an off switch", () => {
  const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.match(serverSource, /MARKED_ENTRY_NAMED/);
  assert.match(serverSource, /markedEntryNumbers\(userEvidence\.markedFrameworkAreas, selectedEntryAreas\)/);
  const first = serverSource.indexOf("matching the framework's first area.");
  const single = serverSource.indexOf("markedSingleEntryText) {");
  const generic = serverSource.indexOf("You marked levels on the chart, which makes review easier.");
  assert.ok(first > 0 && single > first && generic > single);
});

// XAUUSD H4 2026-11-21: the framework's week-3 low 3853.27 and the trader's line 3863.59 became Sell 1 and Sell 2,
// ten points apart, because a line only replaced a level within 0.05% of price (about 1.9 points on gold).
test("a drawn line replaces the nearest period level within its match tolerance, not only within 0.05%", () => {
  const gold = [3853.26757, 3890.69156, 4147.60021, 4149.00711];
  const line = [{ price: 3863.59, tolerance: 11.84 }];
  assert.equal(supersedingDrawnLine({ candidatePrice: 3853.26757, candidatePrices: gold, lines: line }), 3863.59);
  // the other levels stay
  assert.equal(supersedingDrawnLine({ candidatePrice: 3890.69156, candidatePrices: gold, lines: line }), undefined);
  assert.equal(supersedingDrawnLine({ candidatePrice: 4147.60021, candidatePrices: gold, lines: line }), undefined);
  // without a match tolerance only the old 0.05% rule applies
  assert.equal(supersedingDrawnLine({ candidatePrice: 3853.26757, candidatePrices: gold, lines: [{ price: 3863.59, tolerance: 0 }] }), undefined);
  assert.equal(supersedingDrawnLine({ candidatePrice: 3853.26757, candidatePrices: gold, lines: [{ price: 3863.59 }] }), undefined);
});

test("a line between two period levels replaces only the nearer one; the 0.05% rule and identical prices are as before", () => {
  const prices = [3853.26757, 3866.02108];
  const line = [{ price: 3863.59, tolerance: 11.84 }];
  assert.equal(supersedingDrawnLine({ candidatePrice: 3866.02108, candidatePrices: prices, lines: line }), 3863.59);
  assert.equal(supersedingDrawnLine({ candidatePrice: 3853.26757, candidatePrices: prices, lines: line }), undefined);
  // forex: 0.68536 over 0.68538 is within 0.05% (the old rule), with or without a tolerance
  assert.equal(supersedingDrawnLine({ candidatePrice: 0.68538, candidatePrices: [0.68538, 0.67686], lines: [{ price: 0.68536 }] }), 0.68536);
  // an identical price is not "replaced", and a level outside the tolerance stays
  assert.equal(supersedingDrawnLine({ candidatePrice: 0.68536, candidatePrices: [0.68536], lines: [{ price: 0.68536, tolerance: 0.0007 }] }), undefined);
  assert.equal(supersedingDrawnLine({ candidatePrice: 3890.69156, candidatePrices: [3890.69156], lines: line }), undefined);
  assert.equal(supersedingDrawnLine({ candidatePrice: NaN, lines: line }), undefined);
});

test("the server feeds each line's match tolerance into the replacement, with an off switch", () => {
  const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.match(serverSource, /LINE_REPLACES_LEVEL/);
  assert.match(serverSource, /supersedingDrawnLine\(\{\s+candidatePrice: periodPrice,\s+candidatePrices: periodCandidatePrices,\s+lines: drawnLines,\s+fraction: DRAWN_LINE_SUPERSEDES_FRACTION,/);
  assert.match(serverSource, /asPositiveNumber\(level\?\.matchTolerance\)/);
});

// USDINDEX H4, 22 Nov 2026: Buy 1 = last week-of-2-Nov high 102.3448 (period inventory), Buy 2 = the trader's own line at
// 102.227 (line reader). No line reached a framework period, so nothing credited the line.
const dxyEntries = [
  { priceSource: "deterministic_period_high_low_inventory", authoritativeCenter: 102.3448, areaType: "converted support" },
  { priceSource: EXACT, authoritativeCenter: 102.227, areaType: "converted support" },
];

test("a drawn line that became an entry is found, with its entry number", () => {
  const credit = drawnLineEntryCredit(dxyEntries);
  assert.deepEqual(credit.numbers, [2]);
  assert.deepEqual(credit.areas, [{ price: 102.227, areaType: "converted support" }]);
});

test("entries from period highs and lows, reference-only reads and bad prices are not drawn-line entries", () => {
  assert.deepEqual(drawnLineEntryCredit([dxyEntries[0]]), { areas: [], numbers: [] });
  assert.deepEqual(drawnLineEntryCredit([{ priceSource: `${EXACT}_reference_only`, authoritativeCenter: 1.2 }]), { areas: [], numbers: [] });
  assert.deepEqual(drawnLineEntryCredit([{ priceSource: EXACT, authoritativeCenter: 0 }, { priceSource: EXACT }]), { areas: [], numbers: [] });
  assert.deepEqual(drawnLineEntryCredit(null), { areas: [], numbers: [] });
});

test("two drawn lines that became entries are numbered; the same price twice counts once", () => {
  const credit = drawnLineEntryCredit([
    { priceSource: EXACT, authoritativeCenter: 1.1, areaType: "support" },
    { priceSource: "deterministic_period_high_low_inventory", authoritativeCenter: 1.2, areaType: "demand" },
    { priceSource: EXACT, authoritativeCenter: 1.3, areaType: "resistance" },
    { priceSource: EXACT, authoritativeCenter: 1.3, areaType: "resistance" },
  ]);
  assert.deepEqual(credit.numbers, [1, 3]);
});

test("the credit text names the entry: one drawn entry says which, two list both", () => {
  const credit = drawnLineEntryCredit(dxyEntries);
  const opts = { label: () => "resistance-turned-support", format: (p) => p.toFixed(3), entryNumbers: credit.numbers };
  assert.equal(
    markedEntryStrength(credit.areas, credit.numbers, opts),
    "You marked the resistance-turned-support area around 102.227, which is the framework's second entry area (Entry 2)."
  );
  const two = drawnLineEntryCredit([
    { priceSource: EXACT, authoritativeCenter: 1.1, areaType: "support" },
    { priceSource: EXACT, authoritativeCenter: 1.2, areaType: "support" },
  ]);
  assert.equal(
    markedAreasStrength(two.areas, { label: () => "support", format: (p) => p.toFixed(1), entryNumbers: two.numbers }),
    "You marked two framework levels: the support area around 1.1 and the support area around 1.2. Entry 1 and Entry 2 are among them."
  );
});

test("the server credits a drawn-line entry only when no line was matched to a framework level, with an off switch", () => {
  const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.match(serverSource, /DRAWN_ENTRY_CREDIT/);
  assert.match(serverSource, /drawnLineEntryCredit\(selectedEntryAreas\)/);
  assert.match(serverSource, /!\(Array\.isArray\(userEvidence\.markedFrameworkAreas\) && userEvidence\.markedFrameworkAreas\.length\)/);
  assert.match(serverSource, /priceSource: candidate\.priceSource \|\| null,\s+state: candidate\.state/);
});

// USDINDEX H4, 22 Nov 2026: the trader's line at 102.227 is the week-of-2-Nov high on their own chart (MT4 shows 102.22);
// our index (built from six OANDA pairs) has that high at 102.301 (exchange weekly) or 102.3448 (candle-built).
// ATR 0.1464 gives a 0.0366 tolerance, so the line matched nothing and stayed a second entry beside the high.
const dxyLine = { extractionSource: EXACT, displayedPrice: 102.227 };
const dxyAreas = [
  { price: 102.3448, areaType: "converted support", period: "W1" },
  { price: 101.2006, areaType: "support", period: "W1" },
  { price: 103.4343, areaType: "converted support", period: "W2" },
  { price: 101.4984, areaType: "demand", period: "W2" },
];

test("the index gets the feed allowance; every other instrument keeps the quarter-ATR tolerance", () => {
  assert.equal(lineMatchTolerance({ standardTolerance: 0.0117, atr: 0.1464, feedAllowance: 0 }), 0.0366);
  assert.equal(lineMatchTolerance({ standardTolerance: 0.0117, atr: 0.1464, feedAllowance: 0.25 }), 0.25);
  assert.equal(lineMatchTolerance({ standardTolerance: 5, atr: 47.36, feedAllowance: 0 }), 11.84);
  assert.equal(lineMatchTolerance({}), 0);
});

test("with the index allowance the line on our week-of-2-Nov high is matched, and it replaces that high as the entry", () => {
  const before = matchLinesToAreas([dxyLine], dxyAreas, 0.0366);
  assert.equal(before[0].matchedFrameworkPeriod, undefined);
  const after = matchLinesToAreas([dxyLine], dxyAreas, 0.25);
  assert.equal(after[0].matchedFrameworkPrice, 102.3448);
  assert.equal(after[0].matchTolerance, 0.25);
  const candidatePrices = dxyAreas.map((area) => area.price);
  assert.equal(supersedingDrawnLine({ candidatePrice: 102.3448, candidatePrices, lines: [{ price: 102.227, tolerance: 0.25 }] }), 102.227);
  assert.equal(supersedingDrawnLine({ candidatePrice: 102.3448, candidatePrices, lines: [{ price: 102.227, tolerance: 0.0366 }] }), undefined);
  // the other period levels are not swallowed
  assert.equal(supersedingDrawnLine({ candidatePrice: 103.4343, candidatePrices, lines: [{ price: 102.227, tolerance: 0.25 }] }), undefined);
  assert.equal(supersedingDrawnLine({ candidatePrice: 101.4984, candidatePrices, lines: [{ price: 102.227, tolerance: 0.25 }] }), undefined);
});

test("the server adds the index feed allowance to the line match tolerance, with an off switch", () => {
  const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.match(serverSource, /SYNTHETIC_LINE_TOLERANCE/);
  assert.match(serverSource, /syntheticIndexTolerance\(marketReference\?\.symbol \|\| ""\) \?\? 0/);
  assert.match(serverSource, /exactLabelTolerance: lineMatchTolerance\(\{ standardTolerance, atr, feedAllowance \}\)/);
});

// USDINDEX H4, 25 Nov 2026: a clean chart, nothing drawn. The image reader said "marked", the price reader
// invented a dashed line at the printed axis number 104.000, and the page said "Levels marked on chart".
const axisTicks = [104.6, 104.15, 103.7, 103.25, 102.8];
test("a 'marked' call with no real drawn-line read is not trusted", () => {
  const review = { chartMarkingStatus: "marked", csaLevelVisibility: "partial", visualChartStyle: "marked chart", csaSimilarities: ["x"], visibleMarkedLevels: [], visibleHorizontalLines: [] };
  const out = requireLineEvidenceForMarked(review, { axisTicks, lastPrice: 103.882 });
  assert.equal(out.chartMarkingStatus, "unclear");
  assert.equal(out.csaLevelVisibility, "unclear");
  assert.deepEqual(out.csaSimilarities, []);
  assert.equal(out.markedClaimDropped, true);
});
test("a line read at a printed axis number or at the last price does not count", () => {
  const review = { chartMarkingStatus: "marked", visibleHorizontalLines: [{ approximatePrice: "103.700", description: "dashed line" }, { approximatePrice: "103.88" }] };
  assert.equal(hasDrawnLineEvidence(review, { axisTicks, lastPrice: 103.882 }), false);
  assert.equal(requireLineEvidenceForMarked(review, { axisTicks, lastPrice: 103.882 }).chartMarkingStatus, "unclear");
});
test("a real drawn line keeps the chart marked, whichever field carries its price", () => {
  for (const line of [{ displayedPrice: 103.32 }, { approximatePrice: "approx 103.32" }, { platformLabel: "103.32" }]) {
    const review = { chartMarkingStatus: "marked", visibleMarkedLevels: [line] };
    assert.equal(requireLineEvidenceForMarked(review, { axisTicks, lastPrice: 103.882 }), review);
  }
});
test("unmarked and unclear reviews are left alone; derived 'marked' is also checked", () => {
  const unmarked = { chartMarkingStatus: "unmarked" };
  assert.equal(requireLineEvidenceForMarked(unmarked), unmarked);
  const derived = { csaLevelVisibility: "clear", visibleMarkedLevels: [] };
  assert.equal(requireLineEvidenceForMarked(derived).chartMarkingStatus, "unclear");
});

// The live USDINDEX H4 shape (25 Nov 2026): the reader says "marked", the only line read is the axis number 104.000
// (matched to a framework price through the index's 0.25 tolerance), so a later step re-marked the chart.
test("a line read at a printed axis number is removed before any marking step", () => {
  const ticks = [104.5, 104, 103.5, 103, 102.5];
  const axisLine = { extractionSource: EXACT, displayedPrice: 104, platformLabel: "104.000", frameworkPeriodHint: "Week 4", matchTolerance: 0.25 };
  const review = { chartMarkingStatus: "marked", visibleMarkedLevels: [axisLine], visibleHorizontalLines: [{ approximatePrice: "104.000" }] };
  const cleaned = withoutAxisTickReads(review, ticks);
  assert.deepEqual(cleaned.visibleMarkedLevels, []);
  assert.deepEqual(cleaned.visibleHorizontalLines, []);
  assert.equal(cleaned.axisTickReadsRemoved, 2);
  // with the tick reads gone the framework-match step can no longer re-mark the chart
  assert.equal(markChartFromFrameworkLines({ ...cleaned, chartMarkingStatus: "unclear" }).chartMarkingStatus, "unclear");
  assert.equal(requireLineEvidenceForMarked(cleaned, { axisTicks: ticks, lastPrice: 103.882 }).chartMarkingStatus, "unclear");
});
test("a line that is not at an axis number, or no tick list, leaves the review untouched", () => {
  const ticks = [104.5, 104, 103.5, 103, 102.5];
  const real = { extractionSource: EXACT, displayedPrice: 103.3662, frameworkPeriodHint: "Week 3" };
  const review = { chartMarkingStatus: "marked", visibleMarkedLevels: [real] };
  assert.equal(withoutAxisTickReads(review, ticks), review);
  const atTick = { chartMarkingStatus: "marked", visibleMarkedLevels: [{ extractionSource: EXACT, displayedPrice: 104 }] };
  assert.equal(withoutAxisTickReads(atTick, []), atTick); // fewer than three ticks: nothing is judged
});
test("the server removes axis-number reads before the first marking step, with the off switch", () => {
  const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  const strip = serverSource.indexOf("withoutAxisTickReads(visualReview, chartDetection?.priceAxisTicks)");
  const resolve = serverSource.indexOf("visualReview = resolveIntradayCsaChartMarking({");
  assert.ok(strip > 0 && resolve > strip);
  assert.match(serverSource, /MARKED_NEEDS_LINES/);
});
