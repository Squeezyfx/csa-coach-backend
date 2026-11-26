import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { phaseContexts } from "../phase-context.js";

test("a bearish pullback after a bullish breakout is the context of a buy review, not of a sell review", () => {
  const phase = "bearish_pullback_after_bullish_breakout";
  assert.equal(phaseContexts({ historicalPhaseName: phase, direction: "bullish" }).bearishPullbackContext, true);
  // SOLUSD H4 2026-11-24: resolved direction bearish, sells at 85.02 and 88.46, history phase as above.
  assert.equal(phaseContexts({ historicalPhaseName: phase, direction: "bearish" }).bearishPullbackContext, false);
});

test("a bullish recovery after a bearish breakdown is the context of a sell review, not of a buy review", () => {
  const phase = "bullish_recovery_after_bearish_breakdown";
  assert.equal(phaseContexts({ historicalPhaseName: phase, direction: "bearish" }).bullishRecoveryContext, true);
  assert.equal(phaseContexts({ historicalPhaseName: phase, direction: "bullish" }).bullishRecoveryContext, false);
});

test("the transition flags work like the phase names, and an undecided direction keeps both contexts", () => {
  assert.equal(phaseContexts({ transitionState: { bearishPullbackAfterBreakout: true }, direction: "bearish" }).bearishPullbackContext, false);
  assert.equal(phaseContexts({ transitionState: { bearishPullbackAfterBreakout: true }, direction: "bullish" }).bearishPullbackContext, true);
  assert.equal(phaseContexts({ transitionState: { bullishRecoveryAfterBreakdown: true }, direction: "bullish" }).bullishRecoveryContext, false);
  assert.equal(phaseContexts({ transitionState: { bullishRecoveryAfterBreakdown: true }, direction: "bearish" }).bullishRecoveryContext, true);
  const range = phaseContexts({ historicalPhaseName: "bearish_pullback_after_bullish_breakout", direction: "range" });
  assert.equal(range.bearishPullbackContext, true);
  assert.deepEqual(phaseContexts({}), { bullishRecoveryContext: false, bearishPullbackContext: false });
  assert.deepEqual(phaseContexts({ historicalPhaseName: "Bearish_Pullback_After_Bullish_Breakout", direction: "BULLISH" }), { bullishRecoveryContext: false, bearishPullbackContext: true });
});

test("the review wording takes both contexts from the helper", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /import \{ phaseContexts \} from "\.\/phase-context\.js";/);
  assert.match(server, /const \{ bullishRecoveryContext, bearishPullbackContext \} = phaseContexts\(\{/);
});

// A pullback that has not broken the trend is nothing the trader did wrong (EURUSD H1 buy, 26 Nov 2026), so it is not
// listed as a weakness; a review with no entry still says so during a pullback or recovery.
test("an intact trend is not listed as a weakness, and a no-entry review still says there is no entry", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.doesNotMatch(server, /not reversed yet|trend isn't reversed|bullish recovery hasn't broken|bearish pullback hasn't broken/);
  assert.match(server, /\} else if \(!hasValidatedArea\) \{\s*addWeakness\(/);
});
