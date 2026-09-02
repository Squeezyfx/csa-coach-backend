import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(
  fileURLToPath(new URL("./public/app.js", import.meta.url)),
  "utf8"
);

test("automatic report renders structural levels independently of Fibonacci", () => {
  assert.match(appSource, /const structureAuditHtml =/);
  assert.match(appSource, /S\/R and S\/D level audit/);
  assert.match(appSource, /selectorDiagnostics\.structuralCandidates/);
  assert.match(appSource, /structuralReferenceAreas/);
  assert.match(appSource, /\$\{periodInventoryAuditHtml\}\$\{structureAuditHtml\}\$\{fibAuditHtml\}\$\{entryDecisionAuditHtml\}\$\{provenanceConflictHtml\}/);
});

test("the missing-Fibonacci branch does not replace the structural audit", () => {
  const structurePosition = appSource.indexOf("const structureAuditHtml =");
  const fibonacciPosition = appSource.indexOf("const fibAuditHtml =");
  assert.ok(structurePosition > -1);
  assert.ok(fibonacciPosition > structurePosition);
});

test("the D1/W1 inventory is rendered independently of Fibonacci", () => {
  assert.match(appSource, /const periodInventoryAuditHtml =/);
  assert.match(appSource, /D1\/W1 candle high-low inventory/);
  assert.match(appSource, /selectorDiagnostics\.periodInventory/);
});

test("the benchmark exposes entry decisions and price-source conflicts", () => {
  assert.match(appSource, /Entry 1–3 decision audit/);
  assert.match(appSource, /Price-source conflicts/);
  assert.match(appSource, /candidateEvaluationAudit/);
  assert.match(appSource, /Inside 38\.2–61\.8/);
});

test("the benchmark renders a compact one-row-per-chart diagnosis summary", () => {
  assert.match(appSource, /function renderBatchOverview/);
  assert.match(appSource, /Batch diagnosis summary/);
  assert.match(appSource, /Structural bias \/ phase/);
  assert.match(appSource, /Period highs & lows/);
  assert.match(appSource, /Show review rows only/);
});
