import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCsaStructuralStage,
  getSupplyDemandClusterTolerance,
  hasIndependentChartPriceEvidence,
  orderStructuralCandidatesForFib,
  selectProtectiveSupplyDemandAnchor,
  sequenceFibQualifiedAreas,
  shouldMergeQualifiedSupplyDemandCluster,
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

test("overlapping demand keeps the lower protective launch-base boundary", () => {
  const selected = selectProtectiveSupplyDemandAnchor(
    { id: "shallow", areaType: "demand", authoritativeCenter: 1.40395 },
    { id: "deep", areaType: "demand", authoritativeCenter: 1.40341 }
  );
  assert.equal(selected.id, "deep");
});

test("overlapping supply keeps the upper protective launch-base boundary", () => {
  const selected = selectProtectiveSupplyDemandAnchor(
    { id: "shallow", areaType: "supply", authoritativeCenter: 0.80948 },
    { id: "deep", areaType: "supply", authoritativeCenter: 0.81 }
  );
  assert.equal(selected.id, "deep");
});

test("near-touching demand fragments use the wider qualified S/D merge allowance", () => {
  const atr = 0.00092;
  const tolerance = getSupplyDemandClusterTolerance(
    { areaType: "demand", zoneLow: 1.40395, zoneHigh: 1.4044 },
    { areaType: "demand", zoneLow: 1.40349, zoneHigh: 1.40383 },
    atr
  );

  assert.equal(tolerance, atr * 0.15);
  assert.ok(1.40395 - 1.40383 <= tolerance);

  const selected = selectProtectiveSupplyDemandAnchor(
    { id: "shallow", areaType: "demand", authoritativeCenter: 1.40395 },
    { id: "protective", areaType: "demand", authoritativeCenter: 1.40349 }
  );
  assert.equal(selected.id, "protective");
});

test("near-touching supply fragments keep the upper protective boundary", () => {
  const atr = 0.001;
  const tolerance = getSupplyDemandClusterTolerance(
    { areaType: "supply", zoneLow: 1.4101, zoneHigh: 1.4105 },
    { areaType: "supply", zoneLow: 1.41062, zoneHigh: 1.411 },
    atr
  );
  assert.ok(1.41062 - 1.4105 <= tolerance);

  const selected = selectProtectiveSupplyDemandAnchor(
    { id: "shallow", areaType: "supply", authoritativeCenter: 1.4105 },
    { id: "protective", areaType: "supply", authoritativeCenter: 1.411 }
  );
  assert.equal(selected.id, "protective");
});

test("support and demand keep the narrower normal dedupe allowance", () => {
  const atr = 0.00092;
  const tolerance = getSupplyDemandClusterTolerance(
    { areaType: "support" },
    { areaType: "demand" },
    atr
  );

  assert.equal(tolerance, atr * 0.08);
});

test("qualified overlapping demand fragments merge despite different quality scores", () => {
  assert.equal(
    shouldMergeQualifiedSupplyDemandCluster(
      { areaType: "demand", structuralScore: 55, fibonacciScore: 1 },
      { areaType: "demand", structuralScore: 62, fibonacciScore: 1 },
      { existingTrusted: false, candidateTrusted: false }
    ),
    true
  );
});

test("ordinary chart reconciliation does not impersonate an independently marked price", () => {
  assert.equal(
    hasIndependentChartPriceEvidence({ chartReconciled: true }),
    false
  );
  assert.equal(
    hasIndependentChartPriceEvidence({
      reconciliationConfidence: 25,
      priceSource: "independent_horizontal_line",
    }),
    true
  );
  assert.equal(
    hasIndependentChartPriceEvidence({
      chartReconciled: true,
      priceSource: "per_target_framework_price",
    }),
    false
  );
});

test("unmarked framework demand can merge with its overlapping intraday fragment", () => {
  const frameworkDemand = {
    areaType: "demand",
    authoritativeCenter: 0.8091,
    zoneLow: 0.8091,
    zoneHigh: 0.80977,
    priceSource: "per_target_framework_price",
  };
  const intradayDemand = {
    areaType: "demand",
    authoritativeCenter: 0.80948,
    zoneLow: 0.80948,
    zoneHigh: 0.81025,
  };

  assert.equal(
    shouldMergeQualifiedSupplyDemandCluster(frameworkDemand, intradayDemand, {
      existingTrusted: hasIndependentChartPriceEvidence(frameworkDemand),
      candidateTrusted: hasIndependentChartPriceEvidence(intradayDemand),
    }),
    true
  );
  assert.equal(
    selectProtectiveSupplyDemandAnchor(frameworkDemand, intradayDemand)
      .authoritativeCenter,
    0.8091
  );
});
