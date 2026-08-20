import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCsaStructuralStage,
  orderStructuralCandidatesForFib,
  sequenceFibQualifiedAreas,
} from "../csa-entry-policy.js";

test("CSA structural checks always run S/R before S/D before other structure", () => {
  const ordered = orderStructuralCandidatesForFib([
    { id: "demand", type: "demand" },
    { id: "other", type: "pivot" },
    { id: "support", type: "support" },
    { id: "converted", type: "converted support" },
    { id: "supply", type: "supply" },
  ]);

  assert.deepEqual(
    ordered.map((item) => item.id),
    ["support", "converted", "demand", "supply", "other"]
  );
  assert.deepEqual(
    ordered.map((item) => item.standardStructuralStage),
    [
      "support_resistance",
      "support_resistance",
      "supply_demand",
      "supply_demand",
      "other_structure",
    ]
  );
});

test("explicit prior S/R and current S/D stages retain their structural identities", () => {
  assert.equal(
    classifyCsaStructuralStage({ stepwiseEntryStage: "immediate_prior_broken_sr" }).key,
    "support_resistance"
  );
  assert.equal(
    classifyCsaStructuralStage({ stepwiseEntryStage: "current_period_supply_demand" }).key,
    "supply_demand"
  );
});

test("after Fib qualification bullish entries follow nearest-to-deeper price path", () => {
  const sequenced = sequenceFibQualifiedAreas(
    [
      { id: "demand", authoritativeCenter: 1.40341 },
      { id: "support", authoritativeCenter: 1.4052 },
    ],
    "bullish"
  );
  assert.deepEqual(sequenced.map((item) => item.id), ["support", "demand"]);
});

test("after Fib qualification bearish entries follow nearest-to-deeper price path", () => {
  const sequenced = sequenceFibQualifiedAreas(
    [
      { id: "deep-supply", authoritativeCenter: 1.41 },
      { id: "near-resistance", authoritativeCenter: 1.407 },
    ],
    "bearish"
  );
  assert.deepEqual(sequenced.map((item) => item.id), ["near-resistance", "deep-supply"]);
});
