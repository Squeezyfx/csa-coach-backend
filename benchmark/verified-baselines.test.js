import test from "node:test";
import assert from "node:assert/strict";
import { getVerifiedBaseline, listVerifiedBaselines } from "./verified-baselines.js";

test("resolves the five verified charts by label or filename", () => {
  assert.equal(listVerifiedBaselines().length, 5);
  assert.equal(getVerifiedBaseline("2902", "")?.instrument, "USA30");
  assert.equal(getVerifiedBaseline("", "2900.PNG")?.expectedEntry1, 4436.15);
});

test("verified one-entry charts explicitly reject an extra Entry 2", () => {
  assert.equal(getVerifiedBaseline("2898")?.expectedEntryCount, 1);
  assert.equal(getVerifiedBaseline("2901")?.expectedEntryCount, 1);
  assert.equal(getVerifiedBaseline("2900")?.expectedEntryCount, 1);
  assert.equal(getVerifiedBaseline("2899")?.expectedEntryCount, 1);
  assert.equal(getVerifiedBaseline("2902")?.expectedEntryCount, 2);
});

test("unknown charts remain automatic rule checks instead of borrowing a baseline", () => {
  assert.equal(getVerifiedBaseline("new-chart", "new-chart.PNG"), null);
});
