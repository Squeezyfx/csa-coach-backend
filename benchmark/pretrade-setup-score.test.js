import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const start = server.indexOf("function controlledScores(facts) {");
const end = server.indexOf("function controlledScoreLabel(");
const context = vm.createContext({});
vm.runInContext(`${server.slice(start, end)}\nthis.controlledScores = controlledScores;`, context);
const score = (facts) => context.controlledScores(facts);

// A clean plan: bullish, validated area, high confluence, price has not come back to the area yet, no trigger.
const plan = (extra = {}) => ({
  direction: "bullish",
  analysisType: "pre-trade",
  trade: { visible: false },
  risk: {},
  confluence: { strength: "high" },
  preferredEntryArea: { validated: true, directionMatch: true, areaRetested: false, triggerPresent: false, lifecycleStatus: "identified" },
  ...extra,
});

test("a clean Pre-trade plan is no longer capped at 68: 80 setup, 70 overall", () => {
  const result = score(plan());
  assert.equal(result.setupQuality, 80);
  assert.equal(result.entryAccuracy, 58);
  assert.equal(result.riskManagement, 55);
  assert.equal(result.overall, 70);
});

test("a Post-trade chart whose area price never reached keeps the cap", () => {
  const result = score(plan({ analysisType: "post-trade" }));
  assert.equal(result.setupQuality, 68);
  assert.equal(result.overall, 63);
});

test("a placed trade whose area price never reached keeps the cap, even in Pre-trade mode", () => {
  const result = score(plan({ trade: { visible: true } }));
  assert.equal(result.setupQuality, 68);
});

test("a weak Pre-trade setup is still weak: no validated area scores low, the cap was never the limit", () => {
  const result = score(plan({ preferredEntryArea: { validated: false, directionMatch: false, areaRetested: false }, confluence: { strength: "low" } }));
  assert.ok(result.setupQuality <= 60);
});

test("an area price has reached is scored as before in every mode", () => {
  const retested = { validated: true, directionMatch: true, areaRetested: true, triggerPresent: false, lifecycleStatus: "respected" };
  assert.equal(score(plan({ preferredEntryArea: retested })).setupQuality, score(plan({ analysisType: "post-trade", preferredEntryArea: retested })).setupQuality);
});

test("the change is limited to the cap, and the scoring version tells old rows from new", () => {
  assert.match(server, /const waitingForPrice =\s+facts\?\.analysisType === "pre-trade" && !tradeVisible;/);
  assert.match(server, /if \(!area\?\.areaRetested && !waitingForPrice\) \{\s+setup = Math\.min\(setup, 68\);/);
  assert.match(server, /const CSA_SCORING_MODEL_VERSION = "2\.2\.0-pretrade-setup-uncapped";/);
});
