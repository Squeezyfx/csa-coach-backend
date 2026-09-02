import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverSource = readFileSync(
  fileURLToPath(new URL("../server.js", import.meta.url)),
  "utf8"
);
const runnerSource = readFileSync(
  fileURLToPath(new URL("../benchmark-server.js", import.meta.url)),
  "utf8"
);
const uiSource = readFileSync(
  fileURLToPath(new URL("./public/app.js", import.meta.url)),
  "utf8"
);
const htmlSource = readFileSync(
  fileURLToPath(new URL("./public/index.html", import.meta.url)),
  "utf8"
);

test("automatic benchmark defaults to credit-saving diagnostics", () => {
  assert.match(htmlSource, /id="diagnosticSummaryOnly"[^>]*checked/);
  assert.match(uiSource, /diagnosticSummaryOnly:\s*\n\s*benchmarkMode === "automatic"/);
  assert.match(runnerSource, /benchmarkDiagnosticSummaryOnly/);
});

test("diagnostic mode skips the expensive optional vision stages", () => {
  assert.match(serverSource, /full customer-facing visual feedback/);
  assert.match(serverSource, /separateFrameworkPriceMapSkipped: benchmarkDiagnosticOnly/);
  assert.match(serverSource, /chartNativeImpulseMappingSkipped: benchmarkDiagnosticOnly/);
  assert.match(serverSource, /focused_period_structure_inventory/);
});

test("diagnostic mode is authorized only for benchmark dry runs", () => {
  assert.match(serverSource, /const benchmarkDiagnosticOnly =\s*\n\s*benchmarkDryRun &&/);
});
