/**
 * Phase context for the review wording.
 *
 * "The bearish pullback hasn't broken below the support yet, so the uptrend isn't reversed" describes a BUY in an uptrend
 * (a pullback that has not broken the support). It was also printed on a review whose direction had resolved to BEARISH
 * with sell entries (SOLUSD H4, 2026-11-24: bias "Bearish after a strong breakdown", sells at 85.02 and 88.46, yet "Uptrend
 * not reversed yet" in the weaknesses), because the history phase was "bearish_pullback_after_bullish_breakout".
 * The mirror image ("bullish recovery ... the downtrend isn't reversed") has the same trap for a bullish review.
 *
 * Each context only applies when the review's direction does not already oppose it.
 */

export function phaseContexts({ historicalPhaseName = "", transitionState = null, direction = "" } = {}) {
  const phase = String(historicalPhaseName || "").toLowerCase();
  const dir = String(direction || "").toLowerCase();
  const bullishRecovery =
    transitionState?.bullishRecoveryAfterBreakdown === true || phase === "bullish_recovery_after_bearish_breakdown";
  const bearishPullback =
    transitionState?.bearishPullbackAfterBreakout === true || phase === "bearish_pullback_after_bullish_breakout";
  return {
    // A recovery after a breakdown is the context of a sell (the downtrend not yet reversed), never of a buy review.
    bullishRecoveryContext: bullishRecovery && dir !== "bullish",
    // A pullback after a breakout is the context of a buy (the uptrend not yet reversed), never of a sell review.
    bearishPullbackContext: bearishPullback && dir !== "bearish",
  };
}
