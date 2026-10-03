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
  noStop:
    "A stop loss is your safety net: it closes the trade for you if you are wrong, so one bad trade can't do serious damage.",
  stopInside:
    "Price often pokes into a level and then reverses, so a stop placed before the level can end a trade that was still valid.",
  noTarget:
    "Without a target you don't know where to take profit, and you can't tell whether the trade is worth the risk.",
  targetBeyond:
    "Price often stalls or bounces at key levels, so a target placed beyond one is less likely to be reached.",
  rewardRisk:
    "A simple rule: aim to make at least 1.5 to 2 times what you risk, so you can be wrong fairly often and still come out ahead.",
  trend:
    "Trading with the trend gives you better odds; trading against it needs a much stronger reason.",
  trigger:
    "A trigger candle is your confirmation that the level is actually holding. Entering before it appears is one of the most common beginner mistakes.",
  loss:
    "Losing trades are normal. What matters is sticking to your stop loss and not moving it further away to avoid taking the loss.",
  early:
    "Entering before price reaches the level means there is less confirmation that the level will hold.",
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
    return "Wait for a trigger candle at the level before you sell: a candle that pushes up into the level and closes back down with a long upper wick, or a bearish engulfing candle (a big down candle that fully covers the previous up candle). It is your confirmation that sellers are stepping in.";
  }
  if (dir === "buy") {
    return "Wait for a trigger candle at the level before you buy: a candle that pushes down into the level and closes back up with a long lower wick, or a bullish engulfing candle (a big up candle that fully covers the previous down candle). It is your confirmation that buyers are stepping in.";
  }
  return "Wait for a trigger candle at the level before entering, such as a rejection wick or an engulfing candle. It is your confirmation that the level is holding.";
}

const RISK_RULE =
  "Before entering, check that the reward is at least 1.5 to 2 times your risk, and risk only a small fixed share of your account on any one trade (many traders use 1%).";

const RISK_RULE_NEXT =
  "For future trades, check before you enter that the reward is at least 1.5 to 2 times your risk, and risk only a small fixed share of your account on any one trade (many traders use 1%).";

const PLAN_MANAGEMENT =
  "Decide before you enter how you will manage the trade: when to move your stop loss to breakeven (your entry price), whether to take part of the profit early (a partial close), and whether to trail your stop (move it behind price as the trade moves in your favor). If you do any of these, mention it in Trade Notes so the coach can review it.";

const tradeNotesHint =
  " If you scaled out or moved your stop earlier, mention it in Trade Notes so the coach can review it.";

export function assessTradePillars({ facts = {}, area = null, hasValidatedArea = false } = {}) {
  const strengths = [];
  const weaknesses = [];
  const next = { trigger: "", exit: "", risk: "", management: "" };
  const add = (list, pillar, text, extra = {}) =>
    list.push({ pillar, text, priority: 1, ...extra });

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
  next.risk = order ? RISK_RULE_NEXT : RISK_RULE;
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

    // 1. Entry area -------------------------------------------------------
    if (biasDir) {
      if (biasDir === orderDir) {
        add(
          strengths,
          "entry",
          `Your ${word} matches the market's ${facts.direction} direction, so you were trading with the trend.`,
          { priority: 0 }
        );
      } else {
        add(
          weaknesses,
          "entry",
          `Your ${word} goes against the market's ${facts.direction} direction, so you were trading against the trend.`,
          { priority: 0, why: WHY.trend }
        );
      }
    }

    const frameworkPrice = num(area?.authoritativeCenter);
    if (hasValidatedArea && frameworkPrice !== null) {
      const closeEnough = Math.abs(entry - frameworkPrice) / frameworkPrice <= 0.0005;
      const betterPrice = isSell ? entry > frameworkPrice : entry < frameworkPrice;
      if (closeEnough) {
        add(
          strengths,
          "entry",
          `Your entry at ${fmtPrice(entry)} lines up closely with the level the framework was watching (around ${fmtPrice(frameworkPrice)}).`,
          { priority: 0 }
        );
      } else if (betterPrice) {
        add(
          strengths,
          "entry",
          `Your entry at ${fmtPrice(entry)} got a better price than the level the framework was watching (around ${fmtPrice(frameworkPrice)}).`,
          { priority: 0 }
        );
      } else {
        add(
          weaknesses,
          "entry",
          `Your entry at ${fmtPrice(entry)} came before price reached the level the framework was watching (around ${fmtPrice(frameworkPrice)}).`,
          { priority: 0, why: WHY.early }
        );
      }
    }

    // 2. Entry trigger ----------------------------------------------------
    const trigger = facts?.entryTrigger;
    if (trigger?.found) {
      const what =
        trigger.type === "engulfing"
          ? isSell
            ? "a bearish engulfing candle (a down candle that fully covers the previous up candle)"
            : "a bullish engulfing candle (an up candle that fully covers the previous down candle)"
          : isSell
          ? "a bearish rejection candle (a long upper wick showing buyers were pushed back)"
          : "a bullish rejection candle (a long lower wick showing sellers were pushed back)";
      add(
        strengths,
        "trigger",
        `The chart shows ${what} at your entry level around ${fmtPrice(entry)}, the kind of candle that supports a ${word} there.`,
        { priority: 0 }
      );
    } else if (trigger && trigger.candlesChecked >= 5) {
      add(
        weaknesses,
        "trigger",
        `No clear rejection candle or candle pattern shows up at your entry level around ${fmtPrice(entry)} in the recent candles, so this entry may have been taken before a trigger appeared.`,
        { priority: 0, why: WHY.trigger }
      );
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

    if (sl === null && tp === null) {
      add(weaknesses, "exit", "No stop loss or take profit is marked on this trade.", {
        priority: 0,
        why: WHY.noStop,
      });
      next.exit = `Add a stop loss before anything else. For a ${word}, place it just beyond the nearest key ${protectWord} ${
        isSell ? "above" : "below"
      } your entry${nearestProtect !== null ? ` (around ${fmtPrice(nearestProtect)})` : ""}, so you are only stopped out if your idea is truly wrong. Then add a take profit at the next key ${targetWord}${
        tpSuggestion !== null ? ` around ${fmtPrice(tpSuggestion)}` : ""
      }.`;
    } else {
      let exitNext = "";

      if (sl === null) {
        add(weaknesses, "exit", "No stop loss is marked on this trade.", {
          priority: 0,
          why: WHY.noStop,
        });
        exitNext = `Add a stop loss before anything else, just beyond the nearest key ${protectWord}${
          nearestProtect !== null ? ` (around ${fmtPrice(nearestProtect)})` : ""
        }, so you are only stopped out if your idea is truly wrong.`;
      } else if (slOnRiskSide) {
        if (nearestProtect !== null) {
          const beyond = isSell ? sl > nearestProtect : sl < nearestProtect;
          if (beyond) {
            add(
              strengths,
              "exit",
              `Your stop loss at ${fmtPrice(sl)} sits ${isSell ? "above" : "below"} the nearest key ${protectWord} (around ${fmtPrice(nearestProtect)}), so a small push into that level won't stop you out.`,
              { priority: 0 }
            );
            exitNext = "Keep your stop loss where it is: it sits beyond the nearest key level, so it protects your idea.";
          } else {
            add(
              weaknesses,
              "exit",
              `Your stop loss at ${fmtPrice(sl)} sits before the nearest key ${protectWord} (around ${fmtPrice(nearestProtect)}).`,
              { priority: 0, why: WHY.stopInside }
            );
            exitNext = `Consider placing your stop loss just beyond the key ${protectWord} around ${fmtPrice(nearestProtect)}, so a normal push into that level doesn't end the trade early.`;
          }
        } else {
          add(
            strengths,
            "exit",
            `A stop loss is marked at ${fmtPrice(sl)}, so the most you can lose on this trade is limited.`,
            { priority: 0 }
          );
          exitNext = "Keep your stop loss in place so your loss stays limited.";
        }
      } else if (slAtBreakeven) {
        exitNext = "Your stop loss is at your entry price (breakeven), so this trade can no longer turn into a loss.";
      } else if (slLockedProfit) {
        exitNext = "Your stop loss is already beyond your entry price, so some profit is locked in.";
      }

      if (tp === null) {
        add(weaknesses, "exit", "No take profit target is marked on this trade.", {
          priority: 0,
          why: WHY.noTarget,
        });
        exitNext += ` Add a take profit at the next key ${targetWord}${
          tpSuggestion !== null ? ` around ${fmtPrice(tpSuggestion)}` : ""
        }, so you know in advance where you will take your profit.`;
      } else if (tpOnProfitSide) {
        if (nearestTarget !== null) {
          const beyondLevel = isSell ? tp < nearestTarget : tp > nearestTarget;
          if (beyondLevel) {
            add(
              weaknesses,
              "exit",
              `Your take profit at ${fmtPrice(tp)} is beyond the next key ${targetWord} (around ${fmtPrice(nearestTarget)}), where price often stalls or bounces.`,
              { priority: 0, why: WHY.targetBeyond }
            );
            exitNext += ` Consider taking at least part of your profit at the key ${targetWord} around ${fmtPrice(nearestTarget)}.`;
          } else {
            add(
              strengths,
              "exit",
              `Your take profit at ${fmtPrice(tp)} sits at or before the next key ${targetWord} (around ${fmtPrice(nearestTarget)}), a realistic place for price to reach.`,
              { priority: 0 }
            );
          }
        } else {
          add(strengths, "exit", `A take profit is marked at ${fmtPrice(tp)}, so you know where you plan to get out.`, {
            priority: 0,
          });
        }
      }

      next.exit = exitNext.trim();
    }

    // 4. Risk -------------------------------------------------------------
    if (riskDist !== null) {
      const riskText = priceDistance(riskDist, symbol).text;
      if (rewardDist !== null) {
        const rr = rewardDist / riskDist;
        const rewardText = priceDistance(rewardDist, symbol).text;
        const rrText = rr.toFixed(1);
        if (rr >= 1.5) {
          add(
            strengths,
            "risk",
            `You are risking about ${riskText} to make about ${rewardText} (roughly ${rrText} times your risk), a healthy balance.`,
            { priority: 0 }
          );
        } else if (rr < 1) {
          add(
            weaknesses,
            "risk",
            `You are risking about ${riskText} to make about ${rewardText} (only ${rrText} times your risk), which is more risk than reward.`,
            { priority: 0, why: WHY.rewardRisk }
          );
        } else {
          add(
            weaknesses,
            "risk",
            `Your reward is only about ${rrText} times your risk (${riskText} risked to make ${rewardText}), which is on the thin side.`,
            { priority: 0, why: WHY.rewardRisk }
          );
        }
        next.risk = `Your reward-to-risk on this trade is about ${rrText} to 1. ${RISK_RULE_NEXT}`;
      } else if (tp === null) {
        add(
          weaknesses,
          "risk",
          `You are risking about ${riskText} on this trade, but with no take profit you can't tell whether the reward is worth it.`,
          { priority: 0, why: WHY.rewardRisk }
        );
        next.risk = `You are risking about ${riskText} on this trade. ${RISK_RULE_NEXT}`;
      }
    }

    // 5. Trade management -------------------------------------------------
    if (slAtBreakeven) {
      add(
        strengths,
        "management",
        "You moved your stop loss to your entry price (breakeven), so this trade can no longer turn into a loss.",
        { priority: 0 }
      );
      next.management = `Your stop is already protecting the trade. Decide where you will take profit, or keep trailing your stop behind price (a trailing stop) to follow the move.${tradeNotesHint}`;
    } else if (slLockedProfit) {
      add(
        strengths,
        "management",
        "You moved your stop loss past your entry price, so some profit is already locked in.",
        { priority: 0 }
      );
      next.management = `Your stop is already locking in profit. Decide where you will take the rest, or keep trailing your stop behind price (a trailing stop) to follow the move.${tradeNotesHint}`;
    } else if (current !== null) {
      const move = isSell ? entry - current : current - entry;
      if (Math.abs(move) > flatTol) {
        const dist = priceDistance(move, symbol).text;
        const multiple = riskDist ? Math.abs(move) / riskDist : null;
        if (move > 0) {
          add(
            strengths,
            "management",
            `The trade is currently in profit by about ${dist}${
              multiple !== null ? ` (roughly ${multiple.toFixed(1)} times your risk)` : ""
            }: price is at ${fmtPrice(current)} versus your ${word} entry at ${fmtPrice(entry)}.`,
            { priority: 0 }
          );
          next.management =
            multiple !== null && multiple >= 1
              ? `The trade is about ${multiple.toFixed(1)} times your risk in profit. Consider moving your stop loss to breakeven (your entry price) so it can't turn into a loss, and think about closing part of the position (a partial close) at your first target while letting the rest run.${tradeNotesHint}`
              : `Let the trade work. Once price has moved in your favor by about the size of your risk, consider moving your stop loss to breakeven (your entry price).${tradeNotesHint}`;
        } else {
          const usedPct =
            riskDist !== null ? Math.min(100, Math.round((Math.abs(move) / riskDist) * 100)) : null;
          add(
            weaknesses,
            "management",
            `The trade is currently against you by about ${dist}${
              usedPct !== null ? ` (about ${usedPct}% of the way to your stop loss)` : ""
            }: price is at ${fmtPrice(current)} versus your ${word} entry at ${fmtPrice(entry)}.`,
            { priority: 0, why: WHY.loss }
          );
          next.management =
            "Keep your original stop loss and do not move it further away to give the trade more room. If your idea is proven wrong, accept the small loss and move on.";
        }
      }
    }

    // Without a stop loss there is nothing to move to breakeven yet.
    if (sl === null) {
      next.management = `First add a stop loss (see Exit). Once the trade has moved in your favor by about the size of your risk, move that stop to breakeven (your entry price) so it can't turn into a loss.${tradeNotesHint}`;
    }
  } else if (order) {
    // ------------------------------------------------------------ a trade is
    // visible, but no readable entry price: judge what is marked, no numbers
    if (!stopShown && !targetShown) {
      add(weaknesses, "exit", "No stop loss or take profit is marked on this trade.", {
        priority: 0,
        why: WHY.noStop,
      });
    } else if (stopShown && !targetShown) {
      add(weaknesses, "exit", "A stop loss is marked, but no take profit target is shown.", {
        priority: 0,
        why: WHY.noTarget,
      });
    } else if (!stopShown && targetShown) {
      add(weaknesses, "exit", "A take profit is marked, but no stop loss is shown.", {
        priority: 0,
        why: WHY.noStop,
      });
    } else {
      add(strengths, "exit", "Both a stop loss and a take profit are marked, so the risk can be judged.", {
        priority: 0,
      });
    }
  } else if (tradeVisible) {
    // A trade is confirmed (for example from your notes) but no order lines
    // could be read from the chart.
    if (!stopShown && !targetShown) {
      add(weaknesses, "exit", "No stop loss or take profit is marked on the chart.", {
        priority: 0,
        why: WHY.noStop,
      });
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
    next.exit = dir
      ? `For a ${dir}, place your stop loss just beyond the level that would prove your idea wrong (${
          isSell ? "above" : "below"
        } your entry area) and your take profit at the next key ${targetWord}${
          planTarget !== null ? ` around ${fmtPrice(planTarget)}` : ""
        }.`
      : "Place your stop loss just beyond the level that would prove your idea wrong, and your take profit at the next key support or resistance.";
    if (stopShown && targetShown) {
      add(strengths, "exit", "Both a stop loss and a take profit are marked on the chart, so the risk can be judged.", {
        priority: 0,
      });
    }
  }

  return { strengths, weaknesses, next };
}

// Orders pillar items (trade, entry, trigger, exit, risk, management), keeps
// at most `perPillar` per pillar, and prefixes each with its pillar label.
// With `withWhy`, appends the short "why it matters" line to each item that
// has one.
export function compilePillarItems(
  items = [],
  { withWhy = false, perPillar = 2, limit = 6 } = {}
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
    const text = String(item.text || "").trim();
    if (!text) continue;
    const key = `${item.pillar}|${text}`;
    if (seen.has(key)) continue;
    counts[item.pillar] = counts[item.pillar] || 0;
    if (counts[item.pillar] >= perPillar) continue;
    seen.add(key);
    counts[item.pillar] += 1;

    const label = PILLAR_LABELS[item.pillar];
    const why = withWhy && item.why ? ` ${item.why}` : "";
    out.push(`${label ? `${label}: ` : ""}${text}${why}`);
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
