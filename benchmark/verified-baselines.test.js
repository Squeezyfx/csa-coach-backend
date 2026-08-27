import test from "node:test";
import assert from "node:assert/strict";
import { getVerifiedBaseline, listVerifiedBaselines } from "./verified-baselines.js";

test("resolves the five verified charts by label or filename", () => {
  assert.equal(listVerifiedBaselines().length, 5);
  assert.equal(getVerifiedBaseline("2902", "")?.instrument, "USA30");
  assert.equal(getVerifiedBaseline("", "2900.PNG")?.expectedEntry1, 4436.15);
});

test("verified charts preserve their reviewed entry counts", () => {
  assert.equal(getVerifiedBaseline("2898")?.expectedEntryCount, 1);
  assert.equal(getVerifiedBaseline("2901")?.expectedEntryCount, 1);
  assert.equal(getVerifiedBaseline("2900")?.expectedEntryCount, 2);
  assert.equal(getVerifiedBaseline("2899")?.expectedEntryCount, 1);
  assert.equal(getVerifiedBaseline("2902")?.expectedEntryCount, 2);
});

test("USDCAD baseline rejects levels below 38.2 and keeps converted resistance", () => {
  const baseline = getVerifiedBaseline("2901");
  assert.equal(baseline.expectedEntry1, 1.38437);
  assert.equal(baseline.expectedEntry1Type, "converted resistance");
  assert.equal(baseline.expectedEntry2, undefined);
  assert.match(baseline.forbiddenEntries, /1\.38066/);
  assert.match(baseline.forbiddenEntries, /1\.38022/);
});

test("XAUUSD baseline preserves both nearby converted-support lines", () => {
  const baseline = getVerifiedBaseline("2900");
  assert.equal(baseline.expectedEntry1, 4436.15);
  assert.equal(baseline.expectedEntry1Type, "converted support");
  assert.equal(baseline.expectedEntry2, 4428.73);
  assert.equal(baseline.expectedEntry2Type, "converted support");
  assert.equal(baseline.entry2Required, true);
});

test("unknown charts remain automatic rule checks instead of borrowing a baseline", () => {
  assert.equal(getVerifiedBaseline("new-chart", "new-chart.PNG"), null);
});
