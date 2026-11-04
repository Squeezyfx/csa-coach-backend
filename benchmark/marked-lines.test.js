import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { annotateMatchedLines, frameworkMatchedLineReads, lineMarksArea, markChartFromFrameworkLines } from "../marked-lines.js";

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

test("the review pipeline uses these helpers", () => {
  const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.match(serverSource, /visibleMarkedLevels: annotateMatchedLines\(/);
  assert.match(serverSource, /matchTolerance: nullablePositiveNumber\(item\?\.matchTolerance\)/);
  assert.match(serverSource, /visualReview = markChartFromFrameworkLines\(visualReview\)/);
  assert.match(serverSource, /lineMarksArea\(\s*visibleUserMarkedLevels/);
  assert.match(serverSource, /matchTolerance: nullablePositiveNumber\(match\?\.selectedTolerance\)/);
});
