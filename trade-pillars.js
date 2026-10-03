// Plain-language trade review organised around the five things that decide
// whether a trade was a good one:
//   1. Entry area   - was it taken at a real support/resistance or supply/demand level?
//   2. Entry trigger - did a trigger candle/pattern confirm the level was holding?
//   3. Exit         - where were the stop loss and take profit placed?
//   4. Risk         - how much was risked for the reward (risk-to-reward)?
//   5. Management   - breakeven, partial close, trailing stop.
// Pure functions only: no I/O, no model calls. Every figure is computed from
// facts the engine already verified (the placed order read from the chart,
// structural levels, current price, candles).
//
// Style rule: every line is one short bullet, one idea, about one line long,
// so a brand-new trader can scan it in seconds. Each item also carries a
// 2-5 word `short` headline for the summary boxes, so those and the full
// coaching bullets are never the same sentence twice.

export const PILLAR_ORDER = ["trade", "entry", "trigger", "exit", "risk", "management"];

export const PILLAR_LABELS = {
  trade: "Trade",
  entry: "Entry area",
  trigger: "Entry trigger",
  exit: "Exit",
  risk: "Risk",
  management: "Trade management",
};

const WHY = {
  noStop: "It limits your loss if you are wrong.",
  stopInside: "Price often pokes into a level, then reverses.",
  noTarget: "Without a target you can't judge the trade.",
  targetBeyond: "Price often stalls at key levels.",
  rewardRisk: "Aim for 1.5 to 2 times more reward than risk.",
  trend: "Trading with the trend gives better odds.",
  trigger: "A trigger candle confirms the level is holding.",
  loss: "Stick to your stop and don't widen it.",
  early: "Early entries have less confirmation.",
};

const num = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const compactSymbol = (symbol = "") =>
  String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function fmtPrice(value) {
  const n = num(value);
  if (n === null) return "";
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 100) return n.toFixed(3);
  if (Math.abs(n) >= 10) return n.toFixed(4);
  return n.toFixed(5);
}

// Distance in pips for standard FX pairs, in plain price points for anything
// else (gold, crypto, indices), where "pips" would mean different things.
export function priceDistance(diff, symbol = "") {
  const abs = Math.abs(Number(diff));
  if (!Number.isFinite(abs)) return { value: null, text: "" };
  const code = compactSymbol(symbol);
  const isFxPair =
    /^[A-Z]{6}$/.test(code) && !/XAU|XAG|XPT|XPD|BTC|ETH|LTC|XRP/.test(code);
  if (isFxPair) {
    const pipSize = code.includes("JPY") ? 0.01 : 0.0001;
    const pips = abs / pipSize;
    const rounded = pips >= 10 ? Math.round(pips) : Math.round(pips * 10) / 10;
    return { value: abs, text: `${rounded} ${rounded === 1 ? "pip" : "pips"}` };
  }
  const rounded = abs >= 100 ? Math.round(abs * 10) / 10 : Math.round(abs * 100) / 100;
  return { value: abs, text: `${rounded} points` };
}

// Every structural price the engine knows about, de-duplicated and sorted.
export function collectStructuralLevels(facts = {}) {
  const sources = [
    ...(Array.isArray(facts?.selectorDiagnostics?.structuralCandidates)
      ? facts.selectorDiagnostics.structuralCandidates
      : []),
    ...(Array.isArray(facts?.activeEntryAreas) ? facts.activeEntryAreas : []),
    ...(Array.isArray(facts?.structuralReferenceAreas) ? facts.structuralReferenceAreas : []),
  ];

  const prices = [];
  for (const item of sources) {
    const low = num(item?.zoneLow);
    const high = num(item?.zoneHigh);
    const price =
      num(item?.price) ??
      num(item?.authoritativeCenter) ??
      (low !== null && high !== null ? (low + high) / 2 : null);
    if (price !== null && price > 0) prices.push(price);
  }

  prices.sort((a, b) => a - b);
  const levels = [];
  for (const price of prices) {
    if (!levels.length || Math.abs(price - levels[levels.length - 1]) > price * 0.00003) {
      levels.push(price);
    }
  }
  return levels;
}

// Looks for a trigger candle at the entry price: a rejection candle (long
// wick that pushed into the level and closed back away from it) or an
// engulfing candle. Reports what the chart shows at that level; it cannot
// know which candle the trader actually clicked on.
export function detectEntryTrigger({ candles = [], price, direction, lookback = 48 } = {}) {
  const level = num(price);
  const side = direction === "buy" || direction === "sell" ? direction : null;
  const rows = (Array.isArray(candles) ? candles : [])
    .map((c) => ({
      datetime: c?.datetime || null,
      open: num(c?.open),
      high: num(c?.high),
      low: num(c?.low),
      close: num(c?.close),
    }))
    .filter(
      (c) =>
        c.open !== null &&
        c.high !== null &&
        c.low !== null &&
        c.close !== null &&
        c.high >= c.low
    )
    .sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)))
    .slice(-lookback);

  if (level === null || !side || rows.length < 5) {
    return { found: false, candlesChecked: rows.length };
  }

  const tol = level * 0.0004;

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const c = rows[i];
    const range = c.high - c.low;
    if (range <= 0) continue;
    const prev = i > 0 ? rows[i - 1] : null;

    if (side === "sell") {
      const reached = c.high >= level - tol && c.high <= level + tol * 2;
      if (!reached) continue;
      const upperWick = c.high - Math.max(c.open, c.close);
      if (upperWick / range >= 0.55 && (c.close - c.low) / range <= 0.45) {
        return { found: true, type: "rejection", datetime: c.datetime, candlesChecked: rows.length };
      }
      if (
        prev &&
        prev.close > prev.open &&
        c.close < c.open &&
        c.open >= prev.close - tol * 0.25 &&
        c.close <= prev.open + tol * 0.25
      ) {
        return { found: true, type: "engulfing", datetime: c.datetime, candlesChecked: rows.length };
      }
    } else {
      const reached = c.low <= level + tol && c.low >= level - tol * 2;
      if (!reached) continue;
      const lowerWick = Math.min(c.open, c.close) - c.low;
      if (lowerWick / range >= 0.55 && (c.high - c.close) / range <= 0.45) {
        return { found: true, type: "rejection", datetime: c.datetime, candlesChecked: rows.length };
      }
      if (
        prev &&
        prev.close < prev.open &&
        c.close > c.open &&
        c.open <= prev.close + tol * 0.25 &&
        c.close >= prev.open - tol * 0.25
      ) {
        return { found: true, type: "engulfing", datetime: c.datetime, candlesChecked: rows.length };
      }
    }
  }

  return { found: false, candlesChecked: rows.length };
}

function triggerExplanation(dir) {
  if (dir === "sell") {
    return "Wait for a trigger candle at the level: a long upper wick that closes back down, or a bearish engulfing candle (a big down candle).";
  }
  if (dir === "buy") {
    return "Wait for a trigger candle at the level: a long lower wick that closes back up, or a bullish engulfing candle (a big up candle).";
  }
  return "Wait for a trigger candle at the level, such as a rejection wick or an engulfing candle.";
}

const RISK_RULE =
  "Aim for at least 1.5 to 2 times more reward than risk. Risk only a small share of your account (many use 1%).";

const PLAN_MANAGEMENT =
  "Plan ahead: move your stop to breakeven (your entry price), take some profit (a partial close), or trail your stop.";

export function assessTradePillars({ facts = {}, area = null, hasValidatedArea = false } = {}) {
  const strengths = [];
  const weaknesses = [];
  const next = { trigger: "", exit: "", risk: "", management: "" };
  let signals = null;
  const add = (list, pillar, text, short, extra = {}) =>
    list.push({ pillar, text, short, priority: 1, ...extra });

  const symbol = facts?.instrument || "";
  const tradeVisible = facts?.trade?.visible === true;
  const order = tradeVisible && facts?.executedOrder ? facts.executedOrder : null;
  const biasDir =
    facts?.direction === "bearish" ? "sell" : facts?.direction === "bullish" ? "buy" : null;
  const areaDir = area?.direction === "buy" || area?.direction === "sell" ? area.direction : null;
  const orderDir = order?.direction === "buy" || order?.direction === "sell" ? order.direction : null;
  const dir = orderDir || areaDir || biasDir;
  const isSell = dir === "sell";
  const protectWord = isSell ? "high" : "low";
  const targetWord = isSell ? "low" : "high";
  const levels = collectStructuralLevels(facts);

  const stopShown = facts?.risk?.stopShown === true;
  const targetShown = facts?.risk?.targetShown === true;

  next.trigger = triggerExplanation(dir);
  next.risk = RISK_RULE;
  next.management = PLAN_MANAGEMENT;

  const entry = order ? num(order.entryPrice) : null;

  // ---------------------------------------------------------------- a real,
  // placed order with a readable entry price
  if (order && orderDir && entry !== null) {
    const sl = num(order.stopPrice);
    const tp = num(order.targetPrice);
    const current = num(facts?.currentPrice);
    const small = entry * 0.00005;
    const beTol = entry * 0.00008;
    const flatTol = entry * 0.0003;
    const word = isSell ? "sell" : "buy";

    signals = {
      trend: null,
      plan: null,
      trigger: null,
      stop: "none",
      target: "none",
      rr: null,
    };

    // 1. Entry area -------------------------------------------------------
    if (biasDir) {
      if (biasDir === orderDir) {
        signals.trend = "with";
        add(strengths, "entry", `Your ${word} matches the ${facts.direction} trend.`, "With the trend", {
          priority: 0,
        });
      } else {
        signals.trend = "against";
        add(
          weaknesses,
          "entry",
          `Your ${word} goes against the ${facts.direction} trend.`,
          "Against the trend",
          { priority: 0, why: WHY.trend }
        );
      }
    }

    const frameworkPrice = num(area?.authoritativeCenter);
    if (hasValidatedArea && frameworkPrice !== null) {
      const closeEnough = Math.abs(entry - frameworkPrice) / frameworkPrice <= 0.0005;
      const betterPrice = isSell ? entry > frameworkPrice : entry < frameworkPrice;
      if (closeEnough) {
        signals.plan = "close";
        add(
          strengths,
          "entry",
          `Entry at ${fmtPrice(entry)} is right at the planned level (${fmtPrice(frameworkPrice)}).`,
          "At the planned level",
          { priority: 0 }
        );
      } else if (betterPrice) {
        signals.plan = "better";
        add(
          strengths,
          "entry",
          `Entry at ${fmtPrice(entry)} beat the planned level (${fmtPrice(frameworkPrice)}).`,
          "Better price than planned",
          { priority: 0 }
        );
      } else {
        signals.plan = "early";
        add(
          weaknesses,
          "entry",
          `Entry at ${fmtPrice(entry)} came before price reached the planned level (${fmtPrice(frameworkPrice)}).`,
          "Entered before the planned level",
          { priority: 0, why: WHY.early }
        );
      }
    }

    // 2. Entry trigger ----------------------------------------------------
    const trigger = facts?.entryTrigger;
    if (trigger?.found) {
      signals.trigger = "found";
      const what =
        trigger.type === "engulfing"
          ? isSell
            ? "A bearish engulfing candle (big down candle)"
            : "A bullish engulfing candle (big up candle)"
          : isSell
          ? "A bearish rejection candle (long upper wick)"
          : "A bullish rejection candle (long lower wick)";
      add(strengths, "trigger", `${what} formed at your entry level.`, "Trigger candle at your entry", {
        priority: 0,
      });
    } else if (trigger && trigger.candlesChecked >= 5) {
      signals.trigger = "missing";
      add(weaknesses, "trigger", "No clear trigger candle at your entry level.", "No trigger candle", {
        priority: 0,
        why: WHY.trigger,
      });
    }

    // 3. Exit -------------------------------------------------------------
    const slOnRiskSide = sl !== null && (isSell ? sl > entry : sl < entry);
    const slAtBreakeven = sl !== null && Math.abs(sl - entry) <= beTol;
    const slLockedProfit = sl !== null && (isSell ? sl < entry - beTol : sl > entry + beTol);
    const riskDist = slOnRiskSide ? Math.abs(sl - entry) : null;
    const tpOnProfitSide = tp !== null && (isSell ? tp < entry : tp > entry);
    const rewardDist = tpOnProfitSide ? Math.abs(tp - entry) : null;

    const protectLevels = levels
      .filter((l) => (isSell ? l > entry + small : l < entry - small))
      .sort((a, b) => (isSell ? a - b : b - a));
    const nearestProtect = protectLevels.length ? protectLevels[0] : null;

    const targetLevels = levels
      .filter((l) => (isSell ? l < entry - small : l > entry + small))
      .sort((a, b) => (isSell ? b - a : a - b));
    const nearestTarget = targetLevels.length ? targetLevels[0] : null;

    // Where a sensible first take profit could go: the next key level beyond
    // BOTH the entry and wherever price is now, in the profit direction.
    const reference =
      current !== null ? (isSell ? Math.min(entry, current) : Math.max(entry, current)) : entry;
    const suggestionLevels = levels
      .filter((l) => (isSell ? l < reference - small : l > reference + small))
      .sort((a, b) => (isSell ? b - a : a - b));
    const tpSuggestion = suggestionLevels.length ? suggestionLevels[0] : null;

    const addTpAdvice = () =>
      `Add a take profit near the next key ${targetWord}${
        tpSuggestion !== null ? ` (${fmtPrice(tpSuggestion)})` : ""
      }.`;

    if (sl !== null) signals.stop = "present";
    if (tp !== null) signals.target = "present";

    if (sl === null && tp === null) {
      add(weaknesses, "exit", "No stop loss or take profit marked.", "No stop loss or take profit", {
        priority: 0,
        why: WHY.noStop,
      });
      next.exit = `Add a stop loss just ${isSell ? "above" : "below"} the nearest key ${protectWord}${
        nearestProtect !== null ? ` (${fmtPrice(nearestProtect)})` : ""
      }. ${addTpAdvice()}`;
    } else {
      const parts = [];

      if (sl === null) {
        add(weaknesses, "exit", "No stop loss marked.", "No stop loss", {
          priority: 0,
          why: WHY.noStop,
        });
        parts.push(
          `Add a stop loss just ${isSell ? "above" : "below"} the nearest key ${protectWord}${
            nearestProtect !== null ? ` (${fmtPrice(nearestProtect)})` : ""
          }.`
        );
      } else if (slOnRiskSide) {
        if (nearestProtect !== null) {
          const beyond = isSell ? sl > nearestProtect : sl < nearestProtect;
          if (beyond) {
            signals.stop = "beyond";
            add(
              strengths,
              "exit",
              `Stop loss at ${fmtPrice(sl)} sits ${isSell ? "above" : "below"} the nearest key ${protectWord} (${fmtPrice(nearestProtect)}).`,
              "Stop beyond a key level",
              { priority: 0 }
            );
            parts.push("Keep your stop where it is.");
          } else {
            signals.stop = "inside";
            add(
              weaknesses,
              "exit",
              `Stop loss at ${fmtPrice(sl)} sits before the nearest key ${protectWord} (${fmtPrice(nearestProtect)}).`,
              "Stop inside a key level",
              { priority: 0, why: WHY.stopInside }
            );
            parts.push(`Move your stop just beyond the key ${protectWord} (${fmtPrice(nearestProtect)}).`);
          }
        } else {
          add(
            strengths,
            "exit",
            `Stop loss marked at ${fmtPrice(sl)}, so your loss is limited.`,
            "Stop loss marked",
            { priority: 0 }
          );
          parts.push("Keep your stop in place.");
        }
      } else if (slAtBreakeven) {
        signals.stop = "breakeven";
        parts.push("Your stop is at your entry price (breakeven).");
      } else if (slLockedProfit) {
        signals.stop = "locked";
        parts.push("Your stop is past your entry, so some profit is locked in.");
      }

      if (tp === null) {
        add(weaknesses, "exit", "No take profit marked.", "No take profit", {
          priority: 0,
          why: WHY.noTarget,
        });
        parts.push(addTpAdvice());
      } else if (tpOnProfitSide) {
        if (nearestTarget !== null) {
          const beyondLevel = isSell ? tp < nearestTarget : tp > nearestTarget;
          if (beyondLevel) {
            signals.target = "beyond";
            add(
              weaknesses,
              "exit",
              `Take profit at ${fmtPrice(tp)} is beyond the next key ${targetWord} (${fmtPrice(nearestTarget)}).`,
              "Target past a key level",
              { priority: 0, why: WHY.targetBeyond }
            );
            parts.push(`Consider taking some profit at the key ${targetWord} (${fmtPrice(nearestTarget)}).`);
          } else {
            signals.target = "ok";
            add(
              strengths,
              "exit",
              `Take profit at ${fmtPrice(tp)} sits at or before the next key ${targetWord} (${fmtPrice(nearestTarget)}).`,
              "Target at a key level",
              { priority: 0 }
            );
          }
        } else {
          add(strengths, "exit", `Take profit marked at ${fmtPrice(tp)}.`, "Take profit marked", {
            priority: 0,
          });
        }
      }

      next.exit = parts.join(" ").trim();
    }

    // 4. Risk -------------------------------------------------------------
    if (riskDist !== null) {
      const riskText = priceDistance(riskDist, symbol).text;
      if (rewardDist !== null) {
        const rr = rewardDist / riskDist;
        signals.rr = rr;
        const rewardText = priceDistance(rewardDist, symbol).text;
        const rrText = rr.toFixed(1);
        if (rr >= 1.5) {
          add(
            strengths,
            "risk",
            `Risking ${riskText} to make ${rewardText} (${rrText} times your risk).`,
            `Reward is ${rrText} times risk`,
            { priority: 0 }
          );
        } else if (rr < 1) {
          add(
            weaknesses,
            "risk",
            `Risking ${riskText} to make ${rewardText}: more risk than reward.`,
            "More risk than reward",
            { priority: 0, why: WHY.rewardRisk }
          );
        } else {
          add(
            weaknesses,
            "risk",
            `Reward is only ${rrText} times your risk (${riskText} risked, ${rewardText} to gain).`,
            "Thin reward for the risk",
            { priority: 0, why: WHY.rewardRisk }
          );
        }
      } else if (tp === null) {
        add(
          weaknesses,
          "risk",
          `Risking ${riskText}, but with no take profit the reward is unknown.`,
          "Reward unknown (no target)",
          { priority: 0, why: WHY.rewardRisk }
        );
      }
    }

    // 5. Trade management -------------------------------------------------
    if (slAtBreakeven) {
      add(
        strengths,
        "management",
        "Stop moved to breakeven, so this trade can't turn into a loss.",
        "Stop at breakeven",
        { priority: 0 }
      );
      next.management =
        "Your stop is protecting the trade. Decide where to take profit, or trail your stop behind price.";
    } else if (slLockedProfit) {
      add(
        strengths,
        "management",
        "Stop moved past your entry, so some profit is locked in.",
        "Profit locked in",
        { priority: 0 }
      );
      next.management =
        "Your stop is locking in profit. Decide where to take the rest, or trail your stop behind price.";
    } else if (current !== null) {
      const move = isSell ? entry - current : current - entry;
      if (Math.abs(move) > flatTol) {
        const dist = priceDistance(move, symbol).text;
        const multiple = riskDist ? Math.abs(move) / riskDist : null;
        if (move > 0) {
          add(
            strengths,
            "management",
            `In profit by ${dist}${multiple !== null ? ` (${multiple.toFixed(1)} times your risk)` : ""}.`,
            `In profit (${dist})`,
            { priority: 0 }
          );
          next.management =
            multiple !== null && multiple >= 1
              ? "Consider moving your stop to breakeven (your entry price) and taking some profit (a partial close)."
              : "Let it run. Once you are up about the size of your risk, move your stop to breakeven (your entry price).";
        } else {
          const usedPct =
            riskDist !== null ? Math.min(100, Math.round((Math.abs(move) / riskDist) * 100)) : null;
          add(
            weaknesses,
            "management",
            `Against you by ${dist}${usedPct !== null ? ` (${usedPct}% of the way to your stop)` : ""}.`,
            `Against you (${dist})`,
            { priority: 0, why: WHY.loss }
          );
          next.management =
            "Keep your original stop and do not move it further away. If you are wrong, accept the small loss.";
        }
      }
    }

    // Without a stop loss there is nothing to move to breakeven yet.
    if (sl === null) {
      next.management =
        "First add a stop loss (see Exit). Then, once you are up about the size of your risk, move it to breakeven (your entry price).";
    }
  } else if (order) {
    // ------------------------------------------------------------ a trade is
    // visible, but no readable entry price: judge what is marked, no numbers
    if (!stopShown && !targetShown) {
      add(weaknesses, "exit", "No stop loss or take profit marked.", "No stop loss or take profit", {
        priority: 0,
        why: WHY.noStop,
      });
    } else if (stopShown && !targetShown) {
      add(weaknesses, "exit", "Stop loss marked, but no take profit.", "No take profit", {
        priority: 0,
        why: WHY.noTarget,
      });
    } else if (!stopShown && targetShown) {
      add(weaknesses, "exit", "Take profit marked, but no stop loss.", "No stop loss", {
        priority: 0,
        why: WHY.noStop,
      });
    } else {
      add(strengths, "exit", "Stop loss and take profit are both marked.", "Stop and target marked", {
        priority: 0,
      });
    }
  } else if (tradeVisible) {
    // A trade is confirmed (for example from your notes) but no order lines
    // could be read from the chart.
    if (!stopShown && !targetShown) {
      add(
        weaknesses,
        "exit",
        "No stop loss or take profit marked on the chart.",
        "No stop loss or take profit",
        { priority: 0, why: WHY.noStop }
      );
    }
  } else {
    // ----------------------------------------------------- no placed trade:
    // coach the plan instead
    const center = hasValidatedArea ? num(area?.authoritativeCenter) : null;
    let planTarget = null;
    if (center !== null) {
      const small = center * 0.00005;
      const candidates = levels
        .filter((l) => (isSell ? l < center - small : l > center + small))
        .sort((a, b) => (isSell ? b - a : a - b));
      planTarget = candidates.length ? candidates[0] : null;
    }
    // The stop goes just beyond the nearest key level on the wrong side of
    // the entry (a few pips away at least, so it is not inside the noise).
    let planStop = null;
    if (center !== null) {
      const minGap = center * 0.0003;
      const beyond = levels
        .filter((l) => (isSell ? l > center + minGap : l < center - minGap))
        .sort((a, b) => (isSell ? a - b : b - a));
      planStop = beyond.length ? beyond[0] : null;
    }
    next.exit = dir
      ? planStop !== null && planTarget !== null
        ? `Stop loss: just ${isSell ? "above" : "below"} the key ${protectWord} at ${fmtPrice(planStop)}. Take profit: the next key ${targetWord} at ${fmtPrice(planTarget)}.`
        : `Put your stop just beyond the level that proves you wrong (${
            isSell ? "above" : "below"
          } your entry area) and your take profit at the next key ${targetWord}${
            planTarget !== null ? ` (${fmtPrice(planTarget)})` : ""
          }.`
      : "Put your stop just beyond the level that proves you wrong and your take profit at the next key support or resistance.";
    if (planStop !== null && planTarget !== null) {
      const riskDist = Math.abs(planStop - center);
      const rewardDist = Math.abs(center - planTarget);
      const rr = rewardDist / riskDist;
      const verdict =
        rr >= 1.5
          ? "That meets the 1.5 to 2 times rule."
          : "That is under 1.5 times, so look for a further target or skip it.";
      next.risk =
        `At those levels you risk ${priceDistance(riskDist, symbol).text} to make ${priceDistance(rewardDist, symbol).text} (${rr.toFixed(1)} times your risk). ${verdict} Risk only a small share of your account (many use 1%).`;
    }
    if (stopShown && targetShown) {
      add(strengths, "exit", "Stop loss and take profit are both marked.", "Stop and target marked", {
        priority: 0,
      });
    }
  }

  return { strengths, weaknesses, next, signals };
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, Math.round(value)));

const sentence = (lead, positives, negatives) => {
  if (positives.length && !negatives.length) return `${lead.strong}: ${positives.join(", ")}.`;
  if (!positives.length && negatives.length) return `${lead.weak}: ${negatives.join(", ")}.`;
  if (positives.length && negatives.length) {
    return `${lead.mixed}: ${positives.join(", ")}, but ${negatives.join(", ")}.`;
  }
  return null;
};

// Entry Accuracy and Risk Management for a placed trade, scored from the same
// pillar findings the bullets are written from, so the grade can never
// disagree with the feedback. Returns null when there is no readable order.
export function scoreFromSignals(signals) {
  if (!signals) return null;

  let entry = 50;
  const entryPositives = [];
  const entryNegatives = [];

  if (signals.trend === "with") {
    entry += 15;
    entryPositives.push("with the trend");
  } else if (signals.trend === "against") {
    entry -= 20;
    entryNegatives.push("against the trend");
  }

  if (signals.plan === "better" || signals.plan === "close") {
    entry += 15;
    entryPositives.push("at a good price");
  } else if (signals.plan === "early") {
    entry -= 10;
    entryNegatives.push("before price reached the planned level");
  }

  if (signals.trigger === "found") {
    entry += 15;
    entryPositives.push("with a trigger candle");
  } else if (signals.trigger === "missing") {
    entry -= 10;
    entryNegatives.push("without a clear trigger candle");
  }

  // The trigger check reports what the chart shows at the entry level, not
  // which candle was clicked, so even a perfect entry stops short of 100.
  entry = clamp(entry, 20, 90);

  let risk = 30;
  const riskPositives = [];
  const riskNegatives = [];
  const hasStop = signals.stop && signals.stop !== "none";
  const hasTarget = signals.target && signals.target !== "none";

  if (hasStop) {
    risk += 25;
    if (signals.stop === "beyond") {
      risk += 10;
      riskPositives.push("stop placed beyond a key level");
    } else if (signals.stop === "inside") {
      risk -= 5;
      riskNegatives.push("stop placed inside a key level");
    } else if (signals.stop === "breakeven") {
      risk += 8;
      riskPositives.push("stop moved to breakeven");
    } else if (signals.stop === "locked") {
      risk += 8;
      riskPositives.push("profit locked in");
    } else {
      riskPositives.push("stop loss marked");
    }
  } else {
    riskNegatives.push("no stop loss");
  }

  if (hasTarget) {
    risk += 15;
    if (signals.target === "ok") {
      risk += 5;
      riskPositives.push("target at a key level");
    } else if (signals.target === "beyond") {
      risk -= 5;
      riskNegatives.push("target past a key level");
    } else {
      riskPositives.push("take profit marked");
    }
  } else {
    riskNegatives.push("no take profit");
  }

  if (typeof signals.rr === "number" && Number.isFinite(signals.rr)) {
    if (signals.rr >= 1.5) {
      risk += 15;
      riskPositives.push("good reward for the risk");
    } else if (signals.rr >= 1) {
      risk += 3;
      riskNegatives.push("thin reward for the risk");
    } else {
      risk -= 10;
      riskNegatives.push("more risk than reward");
    }
  }

  risk = clamp(risk, 10, 95);

  return {
    entry,
    risk,
    entrySummary: sentence(
      { strong: "Strong entry", weak: "Weak entry", mixed: "Mixed entry" },
      entryPositives,
      entryNegatives
    ),
    riskSummary: sentence(
      { strong: "Solid risk plan", weak: "Weak risk plan", mixed: "Partly covered" },
      riskPositives,
      riskNegatives
    ),
  };
}

// Orders pillar items (trade, entry, trigger, exit, risk, management), keeps
// at most `perPillar` per pillar, and prefixes each with its pillar label.
// Modes: default = the full one-line bullet; `withWhy` appends the short "why
// it matters" clause; `short` uses the 2-5 word headline instead.
export function compilePillarItems(
  items = [],
  { withWhy = false, short = false, perPillar = 2, limit = 6 } = {}
) {
  const rank = (pillar) => {
    const index = PILLAR_ORDER.indexOf(pillar);
    return index === -1 ? 99 : index;
  };

  const ordered = items
    .map((item, index) => ({ ...item, _index: index }))
    .sort((a, b) => {
      const byPillar = rank(a.pillar) - rank(b.pillar);
      if (byPillar !== 0) return byPillar;
      const byPriority = (a.priority ?? 1) - (b.priority ?? 1);
      if (byPriority !== 0) return byPriority;
      return a._index - b._index;
    });

  const counts = {};
  const seen = new Set();
  const out = [];

  for (const item of ordered) {
    const text = String((short && item.short) || item.text || "").trim();
    if (!text) continue;
    const key = `${item.pillar}|${text}`;
    if (seen.has(key)) continue;
    counts[item.pillar] = counts[item.pillar] || 0;
    if (counts[item.pillar] >= perPillar) continue;
    seen.add(key);
    counts[item.pillar] += 1;

    const label = PILLAR_LABELS[item.pillar];
    const why = withWhy && !short && item.why ? ` ${item.why}` : "";
    out.push(`${label ? `${label}: ` : ""}${text}${short ? "" : why}`);
    if (out.length >= limit) break;
  }

  return out;
}

// One bullet per pillar for the "Next action" section.
export function buildPillarNextSteps({ entryPlan = "", next = {} } = {}) {
  const steps = [];
  if (entryPlan) steps.push(`${PILLAR_LABELS.entry}: ${entryPlan}`);
  if (next.trigger) steps.push(`${PILLAR_LABELS.trigger}: ${next.trigger}`);
  if (next.exit) steps.push(`${PILLAR_LABELS.exit}: ${next.exit}`);
  if (next.risk) steps.push(`${PILLAR_LABELS.risk}: ${next.risk}`);
  if (next.management) steps.push(`${PILLAR_LABELS.management}: ${next.management}`);
  return steps;
}
