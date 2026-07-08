function buildDeterministicCsaAnalysis({
  marketReference,
  dateDecision,
  chartDetection,
  analysisType,
  submittedInstrument,
  normalizedSymbol,
  timeframe,
  timezone,
}) {
  const mode = normalizeAnalysisType(analysisType);

  if (!marketReference || !marketReference.ok) {
    return `CSA Coach Feedback

Quick Verdict:
- CSA Bias: Insufficient data
- Main issue: Backend OHLC market data was not available.
- What this means: The coach cannot safely confirm whether a day broke or did not break the previous day's high/low from the screenshot alone.
- Next step: Confirm that the selected pair, timeframe, date, and Twelve Data API key are correct.

Key CSA Areas:
Resistance:
- None identified.

Support:
- None identified.

Supply:
- None identified.

Demand:
- None identified.

Monday-to-Friday Breakdown:
- Not available because backend market data was unavailable.

Potential Areas:
Buyer Areas:
- None confirmed.

Seller Areas:
- None confirmed.

Coach Note:
- Do not treat screenshot-based level readings as final when the chart scale is unclear.
- Backend OHLC data is required for reliable CSA break/retest confirmation.

Technical Note:
- Reason: ${marketReference?.error || "Unknown error"}
- Selected date: ${dateDecision.selectedDateText || "Not provided"}
- Final date used: ${dateDecision.finalDateText}
- Detected instrument: ${chartDetection?.detectedInstrument || "Not detected"}
- Detected timeframe: ${chartDetection?.detectedTimeframe || "Not detected"}`;
  }

  const dailyLevels = marketReference.dailyLevels || [];
  const areas = marketReference.csaAreas || [];
  const bias = marketReference.directionalBias || calculateCsaDirectionalBias([]);
  const tolerance = getCleanBreakTolerance(normalizedSymbol);

  const resistanceAreas = areas.filter((area) => area.type === "resistance");
  const supportAreas = areas.filter((area) => area.type === "support");
  const supplyAreas = areas.filter((area) => area.type === "supply");
  const demandAreas = areas.filter((area) => area.type === "demand");

  function latestAreaText(areaList, label) {
    if (!Array.isArray(areaList) || !areaList.length) {
      return `- None identified.`;
    }

    return [...areaList]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 3)
      .map((area) => `- ${area.day} ${label}: ${area.priceText}`)
      .join("\n");
  }

  function getMainFocusText() {
    const biasValue = String(bias.bias || "").toLowerCase();

    if (biasValue.includes("bullish")) {
      return "Focus more on demand/support areas and broken resistance areas that may act as support after a confirmed break and hold.";
    }

    if (biasValue.includes("bearish")) {
      return "Focus more on supply/resistance areas and broken support areas that may act as resistance after a confirmed break and hold.";
    }

    return "Bias is mixed, so focus more on outer support/demand and outer resistance/supply. Avoid the middle of the range.";
  }

  function getAvoidText() {
    const biasValue = String(bias.bias || "").toLowerCase();

    if (biasValue.includes("bullish")) {
      return "Avoid forcing seller ideas against bullish CSA progression unless price clearly rejects from supply/resistance.";
    }

    if (biasValue.includes("bearish")) {
      return "Avoid forcing buyer ideas against bearish CSA progression unless price clearly reacts from support/demand.";
    }

    return "Avoid forcing trades from the middle of the range without a clear reaction at a CSA area.";
  }

  function buildSimpleDayBreakdown() {
    if (!dailyLevels.length) {
      return "- No weekday data available.";
    }

    return dailyLevels
      .map((day, index) => {
        if (index === 0 || String(day.weekday || "").toLowerCase() === "monday") {
          return `${day.weekday}:
- High ${formatPrice(day.high)} = Monday resistance.
- Low ${formatPrice(day.low)} = Monday support.
- Monday is the weekly anchor. Tuesday must be compared against Monday high and low.`;
        }

        const previous = dailyLevels[index - 1];

        const highComparison = compareHighWithTolerance(
          day.high,
          previous.high,
          normalizedSymbol
        );

        const lowComparison = compareLowWithTolerance(
          day.low,
          previous.low,
          normalizedSymbol
        );

        const highResult = highComparison.cleanBreak
          ? `High ${formatPrice(day.high)} cleanly broke ${previous.weekday}'s high ${formatPrice(previous.high)}, so ${day.weekday} high becomes resistance.`
          : highComparison.equalOrInsideTolerance
          ? `High ${formatPrice(day.high)} only retested/stayed around ${previous.weekday}'s high ${formatPrice(previous.high)}, so ${day.weekday} high is supply.`
          : `High ${formatPrice(day.high)} failed to break ${previous.weekday}'s high ${formatPrice(previous.high)}, so ${day.weekday} high is supply.`;

        const lowResult = lowComparison.cleanBreak
          ? `Low ${formatPrice(day.low)} cleanly broke ${previous.weekday}'s low ${formatPrice(previous.low)}, so ${day.weekday} low becomes support.`
          : lowComparison.equalOrInsideTolerance
          ? `Low ${formatPrice(day.low)} only retested/stayed around ${previous.weekday}'s low ${formatPrice(previous.low)}, so ${day.weekday} low is demand.`
          : `Low ${formatPrice(day.low)} held above ${previous.weekday}'s low ${formatPrice(previous.low)}, so ${day.weekday} low is demand.`;

        return `${day.weekday}:
- ${highResult}
- ${lowResult}`;
      })
      .join("\n\n");
  }

  function buildShortPotentialAreas() {
    const biasValue = String(bias.bias || "").toLowerCase();

    const latestResistance = [...resistanceAreas].sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    )[0];

    const latestSupport = [...supportAreas].sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    )[0];

    const latestSupply = [...supplyAreas].sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    )[0];

    const latestDemand = [...demandAreas].sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    )[0];

    let buyerArea = "- No strong buyer area confirmed from the selected-week CSA structure.";
    let sellerArea = "- No strong seller area confirmed from the selected-week CSA structure.";

    if (biasValue.includes("bullish")) {
      if (latestDemand) {
        buyerArea = `- ${latestDemand.day} demand at ${latestDemand.priceText} can be watched as a potential buyer area only if price returns/retraces and holds.`;
      } else if (latestSupport) {
        buyerArea = `- ${latestSupport.day} support at ${latestSupport.priceText} can be watched as a potential buyer area only if price reacts and holds.`;
      }

      if (latestSupply) {
        sellerArea = `- ${latestSupply.day} supply at ${latestSupply.priceText} may react, but it is counter-trend while CSA bias remains bullish.`;
      }
    } else if (biasValue.includes("bearish")) {
      if (latestSupply) {
        sellerArea = `- ${latestSupply.day} supply at ${latestSupply.priceText} can be watched as a potential seller area only if price returns/retraces and rejects.`;
      } else if (latestResistance) {
        sellerArea = `- ${latestResistance.day} resistance at ${latestResistance.priceText} can be watched as a potential seller area only if price rejects.`;
      }

      if (latestDemand) {
        buyerArea = `- ${latestDemand.day} demand at ${latestDemand.priceText} may react, but it is counter-trend while CSA bias remains bearish.`;
      }
    } else {
      if (latestDemand || latestSupport) {
        const buyerRef = latestDemand || latestSupport;
        buyerArea = `- ${buyerRef.day} ${buyerRef.type} at ${buyerRef.priceText} can be watched only if price gives a clear reaction.`;
      }

      if (latestSupply || latestResistance) {
        const sellerRef = latestSupply || latestResistance;
        sellerArea = `- ${sellerRef.day} ${sellerRef.type} at ${sellerRef.priceText} can be watched only if price gives a clear rejection.`;
      }
    }

    return `Buyer Areas:
${buyerArea}

Seller Areas:
${sellerArea}`;
  }

  const quickReason =
    Array.isArray(bias.progression) && bias.progression.length
      ? bias.progression[bias.progression.length - 1]
      : bias.reason || "CSA bias was calculated from the selected week's high/low progression.";

  return `CSA Coach Feedback

Quick Verdict:
- CSA Bias: ${bias.bias}
- Main reason: ${quickReason}
- Best focus: ${getMainFocusText()}
- Avoid: ${getAvoidText()}

Key CSA Areas:
Resistance:
${latestAreaText(resistanceAreas, "resistance")}

Support:
${latestAreaText(supportAreas, "support")}

Supply:
${latestAreaText(supplyAreas, "supply")}

Demand:
${latestAreaText(demandAreas, "demand")}

Monday-to-Friday Breakdown:
${buildSimpleDayBreakdown()}

Potential Areas:
${buildShortPotentialAreas()}

Coach Note:
- These are potential areas only, not buy/sell signals.
- Wait for price reaction, rejection, break-and-hold, or retest confirmation.
- A resistance becomes possible support only after price breaks above it and holds.
- A support becomes possible resistance only after price breaks below it and holds.

Technical Note:
- Data source: Twelve Data
- Symbol used: ${marketReference.symbol}
- Timeframe used: ${marketReference.interval}
- Week used: ${marketReference.weekRange.startDate} to ${marketReference.weekRange.fridayDate}
- Clean-break tolerance: ${formatPrice(tolerance)}
- Chart image was used only for visual context and mismatch checks.`;
}
