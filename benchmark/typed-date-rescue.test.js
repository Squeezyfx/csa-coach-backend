import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { typedDateAccepted, typedDateCandidate } from "../typed-date-rescue.js";

const NOW = Date.parse("2026-11-23T23:50:00Z");
// SOLUSD H4, 2026-11-23: the axis was read as 21 Jan 2025 with a guessed year.
const read = {
  latestVisibleDate: "2025-01-21",
  latestVisibleTime: null,
  latestPrintedAxisDate: "2025-01-21",
  dateConfidence: "medium",
  latestVisibleDateEvidence: "inferred_axis",
  timestampAudit: { timestamp: "2025-01-21 12:00:00" },
  latestVisiblePrice: 71.761,
  detectedInstrument: "SOLUSD",
  chartClock: "13:13:45",
};

test("the typed date becomes the candidate for a date that was only inferred from the axis", () => {
  const candidate = typedDateCandidate(read, "2026-11-23", { nowMs: NOW });
  assert.equal(candidate.latestVisibleDate, "2026-11-23");
  assert.equal(candidate.dateReadByChartReader, "2025-01-21");
  assert.equal(candidate.latestPrintedAxisDate, null, "the wrong printed date is not kept as a floor");
  assert.equal(candidate.timestampAudit, null);
  assert.equal(candidate.chartClock, null, "a clock that may be misread does not cut the data off");
  assert.equal(candidate.dateConfidence, "high");
  assert.equal(candidate.latestVisibleDateEvidence, "explicit_final_candle_timestamp");
  assert.equal(candidate.dateFromTypedDate, true);
  assert.equal(candidate.latestVisiblePrice, 71.761, "the chart's price is carried over untouched");
  assert.equal(read.latestVisibleDate, "2025-01-21", "the original detection is not changed");
});

test("an unknown or missing evidence label is also a guess", () => {
  assert.ok(typedDateCandidate({ ...read, latestVisibleDateEvidence: "unknown" }, "2026-11-23", { nowMs: NOW }));
  assert.ok(typedDateCandidate({ ...read, latestVisibleDateEvidence: undefined }, "2026-11-23", { nowMs: NOW }));
});

test("a firm date, the same date, a bad or future typed date, or a repeat gives no candidate", () => {
  for (const evidence of ["explicit_final_candle_timestamp", "verified_axis_bar_count", "verified_multi_anchor_axis_count", "verified_single_anchor_pixel_count", "provider_price_match"]) {
    assert.equal(typedDateCandidate({ ...read, latestVisibleDateEvidence: evidence }, "2026-11-23", { nowMs: NOW }), null, evidence);
  }
  assert.equal(typedDateCandidate({ ...read, latestVisibleDate: "2026-11-23" }, "2026-11-23", { nowMs: NOW }), null);
  assert.equal(typedDateCandidate(read, "", { nowMs: NOW }), null);
  assert.equal(typedDateCandidate(read, "23/11/2026", { nowMs: NOW }), null);
  assert.equal(typedDateCandidate(read, "2027-01-05", { nowMs: NOW }), null, "a screenshot cannot be from the future");
  assert.equal(typedDateCandidate(null, "2026-11-23", { nowMs: NOW }), null);
  assert.equal(typedDateCandidate({ ...read, dateFromTypedDate: true }, "2026-11-23", { nowMs: NOW }), null);
});

test("the candidate is kept only when the price test is clean and the close is within 1%", () => {
  assert.equal(typedDateAccepted({ cleanlyVerified: true, closeGapRatio: 0.003 }), true);
  assert.equal(typedDateAccepted({ cleanlyVerified: true, closeGapRatio: null }), true);
  assert.equal(typedDateAccepted({ cleanlyVerified: true, closeGapRatio: 0.02 }), false);
  assert.equal(typedDateAccepted({ cleanlyVerified: false, closeGapRatio: 0.001 }), false);
  assert.equal(typedDateAccepted({ cleanlyVerified: false, closeGapRatio: 2.35 }), false);
});

test("the year search tries the typed date first, logs it, and has an off switch", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /import \{ typedDateAccepted, typedDateCandidate \} from "\.\/typed-date-rescue\.js";/);
  const first = server.indexOf("searchCandidates.push({ delta: 0, typed: true");
  const shifts = server.indexOf("searchCandidates.push({ delta: shift, typed: false");
  assert.ok(first > 0 && shifts > first, "typed date first, then the year shifts");
  assert.match(server, /TYPED_DATE_PRICE_RESCUE \|\| "on"/);
  assert.match(server, /\[chart-date\] the typed date was tried against the chart's price:/);
  assert.match(server, /typedDateRescued: true/);
});
