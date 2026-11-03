// Which levels a review may call "levels to watch" when no entry qualified.
//
// Levels the AI only read off the chart picture (a price-axis tick, a stray label) have no completed
// period behind them (frameworkPeriod is empty). Entries and levels to watch come from the highs and
// lows of previous, completed periods, so:
//   1. Completed-period levels near the retracement zone are used, as before.
//   2. If none is near the zone, the nearest completed-period level on the side the bias trades from is
//      used (a bullish bias watches the support below price, a bearish one the resistance above it).
//      This is the early-week case: with only Monday complete, Monday's low or high is the level.
//   3. Levels read only from the chart are used only when the review has no completed-period level at all.

const SUPPORT_SIDE = ["support", "demand", "converted support"];
const RESISTANCE_SIDE = ["resistance", "supply", "converted resistance"];

function isAnchored(reference) {
  return Boolean(reference?.frameworkPeriod);
}

export function chooseWatchReferences(references = [], { direction = "range", lastPrice = null, isCloseToZone = () => true } = {}) {
  const all = Array.isArray(references) ? references : [];
  const anchored = all.filter(isAnchored);
  if (!anchored.length) return all.filter(isCloseToZone);

  const near = anchored.filter(isCloseToZone);
  if (near.length) return near;

  const price = Number(lastPrice);
  const sideTypes = direction === "bullish" ? SUPPORT_SIDE : direction === "bearish" ? RESISTANCE_SIDE : [];
  if (!sideTypes.length || !Number.isFinite(price)) return [];

  const rightSide = anchored
    .filter((reference) => {
      const center = Number(reference?.authoritativeCenter);
      if (!Number.isFinite(center)) return false;
      if (!sideTypes.includes(String(reference?.areaType || "").toLowerCase())) return false;
      return direction === "bullish" ? center < price : center > price;
    })
    .sort((a, b) => Math.abs(Number(a.authoritativeCenter) - price) - Math.abs(Number(b.authoritativeCenter) - price));
  return rightSide.slice(0, 1);
}
