import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  annotateMatchedLines,
  frameworkMatchedLineReads,
  lineMarksArea,
  markChartFromFrameworkLines,
  markLinesOnAreas,
  markedAreasStrength,
  matchedFrameworkAreas,
  matchLinesToAreas,
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
  assert.match(serverSource, /markedAreasStrength\(userEvidence\.markedFrameworkAreas/);
  assert.match(serverSource, /visualReview = markChartFromFrameworkLines\(visualReview\)/);
  assert.match(serverSource, /lineMarksArea\(\s*visibleUserMarkedLevels/);
  assert.match(serverSource, /matchTolerance: nullablePositiveNumber\(match\?\.selectedTolerance\)/);
  assert.match(serverSource, /visualReview = markLinesOnAreas\(\s*visualReview,\s*\[\.\.\.rankedRawAreas, \.\.\.structuralReferenceAreas\]/);
  assert.match(serverSource, /getExactLineMatchTolerances\(\{ marketReference, timeframe \}\)\.exactLabelTolerance/);
});
