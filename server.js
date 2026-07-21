import express from "express";
import cors from "cors";
import multer from "multer";
import OpenAI from "openai";
import Stripe from "stripe";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SECRET_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || "";
const STRIPE_ELITE_PRICE_ID = process.env.STRIPE_ELITE_PRICE_ID || "";
function normalizePublicUrl(value, fallback) {
  let raw = String(value || fallback || "").trim();

  // Render values must contain only the URL, but recover safely if the
  // variable name or wrapping quotes were accidentally included.
  raw = raw.replace(/^FRONTEND_URL\s*=\s*/i, "").trim();
  raw = raw.replace(/^["']|["']$/g, "").trim();
  raw = raw.replace(/\/+$/, "");

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Unsupported URL protocol.");
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(
      "FRONTEND_URL is not valid. Enter only https://training.csaforex.com/version2web in Render."
    );
  }
}

const FRONTEND_URL = normalizePublicUrl(
  process.env.FRONTEND_URL,
  "https://training.csaforex.com/version2web"
);

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;

const TWELVE_DATA_BASE_URL = "https://api.twelvedata.com/time_series";

const PLAN_CONFIG = Object.freeze({
  starter: Object.freeze({
    code: "starter",
    label: "Starter",
    monthlyAnalyses: 7,
    journalLimit: 5,
    strategyLimit: 0,
    features: Object.freeze({
      basicAnalysis: true,
      fullAnalysis: false,
      journalHistory: "latest_5",
      mistakeDetectionHub: false,
      mistakeTracking: false,
      averageScoreTracking: false,
      weeklyFocus: false,
      advancedDashboard: false,
      weeklyReport: false,
      advancedMistakePatterns: false,
      advancedCoachingReports: false,
      multiChartComparison: false,
      exportReports: false,
    }),
  }),
  pro: Object.freeze({
    code: "pro",
    label: "Pro",
    monthlyAnalyses: 40,
    journalLimit: null,
    strategyLimit: 1,
    features: Object.freeze({
      basicAnalysis: true,
      fullAnalysis: true,
      journalHistory: "unlimited",
      mistakeDetectionHub: true,
      mistakeTracking: true,
      averageScoreTracking: true,
      weeklyFocus: true,
      advancedDashboard: true,
      weeklyReport: true,
      advancedMistakePatterns: false,
      advancedCoachingReports: false,
      multiChartComparison: false,
      exportReports: false,
    }),
  }),
  elite: Object.freeze({
    code: "elite",
    label: "Elite",
    monthlyAnalyses: 150,
    journalLimit: null,
    strategyLimit: 5,
    features: Object.freeze({
      basicAnalysis: true,
      fullAnalysis: true,
      journalHistory: "unlimited",
      mistakeDetectionHub: true,
      mistakeTracking: true,
      averageScoreTracking: true,
      weeklyFocus: true,
      advancedDashboard: true,
      weeklyReport: true,
      advancedMistakePatterns: true,
      advancedCoachingReports: "coming_soon",
      multiChartComparison: "coming_soon",
      exportReports: "coming_soon",
    }),
  }),
});

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

function normalizePlanCode(value = "") {
  const plan = String(value || "").trim().toLowerCase();
  return PLAN_CONFIG[plan] ? plan : "starter";
}

function getCurrentUsageMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function isFutureDate(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

async function getUserPlanEntitlement(userId) {
  if (!supabaseAdmin) {
    const error = new Error("Supabase is not configured on the backend.");
    error.statusCode = 500;
    throw error;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select(`
      id,
      subscription_plan,
      subscription_status,
      plan_override,
      plan_override_expires_at,
      is_beta_tester,
      beta_analysis_limit,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      trial_used
    `)
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    const error = new Error("Your CSA Coach profile could not be found.");
    error.statusCode = 403;
    throw error;
  }

  const basePlan = normalizePlanCode(profile.subscription_plan);
  const subscriptionStatus = String(profile.subscription_status || "active").toLowerCase();

  // Starter remains available without Stripe. Paid plans must be active/trialing.
  const paidBasePlanActive =
    basePlan === "starter" || ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);
  const usableBasePlan = paidBasePlanActive ? basePlan : "starter";

  const hasActiveBetaOverride =
    profile.is_beta_tester === true &&
    normalizePlanCode(profile.plan_override) === "elite" &&
    isFutureDate(profile.plan_override_expires_at);

  const effectivePlan = hasActiveBetaOverride ? "elite" : usableBasePlan;
  const planConfig = PLAN_CONFIG[effectivePlan];

  const { count, error: usageError } = await supabaseAdmin
    .from("usage_records")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action_type", "chart_review")
    .eq("usage_month", getCurrentUsageMonth());

  if (usageError) {
    const error = new Error(`Unable to check monthly usage: ${usageError.message}`);
    error.statusCode = 500;
    throw error;
  }

  const analysesUsed = Number(count || 0);
  const configuredLimit =
    hasActiveBetaOverride && Number(profile.beta_analysis_limit) > 0
      ? Number(profile.beta_analysis_limit)
      : planConfig.monthlyAnalyses;
  const analysesRemaining = Math.max(0, configuredLimit - analysesUsed);

  return {
    basePlan,
    effectivePlan,
    planLabel: hasActiveBetaOverride ? "Elite Beta Tester" : planConfig.label,
    subscriptionStatus,
    isBetaTester: hasActiveBetaOverride,
    betaAccessExpiresAt: hasActiveBetaOverride
      ? profile.plan_override_expires_at
      : null,
    analysesUsed,
    analysesLimit: configuredLimit,
    analysesRemaining,
    usageMonth: getCurrentUsageMonth(),
    journalLimit: planConfig.journalLimit,
    strategyLimit: planConfig.strategyLimit,
    features: planConfig.features,
    cancelAtPeriodEnd: profile.cancel_at_period_end === true,
    currentPeriodStart: profile.current_period_start || null,
    currentPeriodEnd: profile.current_period_end || null,
    trialUsed: profile.trial_used === true,
  };
}

function assertAnalysisAllowed(entitlement) {
  if (entitlement.analysesRemaining > 0) return;

  const error = new Error(
    `You have used all ${entitlement.analysesLimit} chart analyses available on your ${entitlement.planLabel} plan for this month.`
  );
  error.statusCode = 429;
  error.errorType = "monthly_analysis_limit_reached";
  throw error;
}

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

async function getRequestUser(req) {
  const accessToken = getBearerToken(req);

  if (!accessToken) {
    const authError = new Error("Please log in before running a chart analysis.");
    authError.statusCode = 401;
    throw authError;
  }

  if (!supabaseAdmin) {
    const error = new Error("Supabase is not configured on the backend.");
    error.statusCode = 500;
    throw error;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) {
    const authError = new Error("Your login session is invalid or has expired. Please log in again.");
    authError.statusCode = 401;
    throw authError;
  }

  return { user: data.user, accessToken, authProvided: true };
}

function createUserScopedSupabase(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    const error = new Error("Supabase is not configured on the backend.");
    error.statusCode = 500;
    throw error;
  }

  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function serializeSupabaseError(error) {
  if (!error) return null;
  return {
    name: error.name || null,
    message: error.message || null,
    code: error.code || null,
    details: error.details || null,
    hint: error.hint || null,
    status: error.status || null,
  };
}



const STRATEGY_RULE_CATEGORIES = new Set([
  "directional_bias",
  "entry_location",
  "entry_confirmation",
  "stop_loss",
  "take_profit",
  "risk_management",
  "trade_management",
  "invalidation",
  "no_trade_condition",
  "other",
]);

const STRATEGY_RULE_IMPORTANCE = new Set(["required", "preferred", "optional"]);

function cleanTextArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 30);
}

function cleanNullableNumber(value, min = 0, max = 100) {
  if (value === "" || value === null || value === undefined) return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return Math.max(min, Math.min(max, numberValue));
}

function sanitizeStrategyPayload(body = {}) {
  const strategyName = String(body.strategyName || body.strategy_name || "").trim();

  if (!strategyName) {
    const error = new Error("Strategy name is required.");
    error.statusCode = 400;
    error.errorType = "strategy_name_required";
    throw error;
  }

  return {
    strategy_name: strategyName.slice(0, 120),
    description: String(body.description || "").trim() || null,
    markets: cleanTextArray(body.markets),
    timeframes: cleanTextArray(body.timeframes),
    trading_sessions: cleanTextArray(body.tradingSessions || body.trading_sessions),
    directional_bias_rules: String(body.directionalBiasRules || body.directional_bias_rules || "").trim() || null,
    entry_location_rules: String(body.entryLocationRules || body.entry_location_rules || "").trim() || null,
    entry_confirmation_rules: String(body.entryConfirmationRules || body.entry_confirmation_rules || "").trim() || null,
    stop_loss_rules: String(body.stopLossRules || body.stop_loss_rules || "").trim() || null,
    take_profit_rules: String(body.takeProfitRules || body.take_profit_rules || "").trim() || null,
    risk_rules: String(body.riskRules || body.risk_rules || "").trim() || null,
    trade_management_rules: String(body.tradeManagementRules || body.trade_management_rules || "").trim() || null,
    invalidation_rules: String(body.invalidationRules || body.invalidation_rules || "").trim() || null,
    no_trade_conditions: String(body.noTradeConditions || body.no_trade_conditions || "").trim() || null,
    additional_notes: String(body.additionalNotes || body.additional_notes || "").trim() || null,
    minimum_risk_reward: cleanNullableNumber(body.minimumRiskReward ?? body.minimum_risk_reward, 0, 100),
    risk_per_trade_percent: cleanNullableNumber(body.riskPerTradePercent ?? body.risk_per_trade_percent, 0, 100),
    is_active: body.isActive === undefined && body.is_active === undefined
      ? true
      : Boolean(body.isActive ?? body.is_active),
  };
}

function sanitizeStrategyRules(value) {
  if (!Array.isArray(value)) return [];

  return value.map((rule, index) => {
    const category = String(rule?.category || rule?.ruleCategory || "").trim();
    const ruleText = String(rule?.text || rule?.ruleText || "").trim();
    const importance = String(rule?.importance || "required").trim().toLowerCase();

    if (!STRATEGY_RULE_CATEGORIES.has(category) || !ruleText) return null;

    return {
      rule_category: category,
      rule_text: ruleText.slice(0, 1000),
      importance: STRATEGY_RULE_IMPORTANCE.has(importance) ? importance : "required",
      display_order: Number.isFinite(Number(rule?.displayOrder)) ? Number(rule.displayOrder) : index,
      is_active: rule?.isActive === undefined ? true : Boolean(rule.isActive),
    };
  }).filter(Boolean).slice(0, 100);
}

async function getOwnedStrategy(userId, strategyId, db = supabaseAdmin) {
  if (!strategyId) return null;

  const strategyResult = await db
    .from("user_strategies")
    .select("*")
    .eq("id", strategyId)
    .eq("user_id", userId)
    .eq("is_archived", false)
    .maybeSingle();

  if (strategyResult.error) throw strategyResult.error;
  if (!strategyResult.data) return null;

  const rulesResult = await db
    .from("strategy_rules")
    .select(`
      id,
      rule_category,
      rule_text,
      importance,
      display_order,
      is_active
    `)
    .eq("strategy_id", strategyId)
    .eq("user_id", userId)
    .order("display_order", { ascending: true });

  if (rulesResult.error) {
    console.warn("Strategy rules could not be loaded:", rulesResult.error.message);
  }

  return {
    ...strategyResult.data,
    strategy_rules: rulesResult.error ? [] : (rulesResult.data || []),
  };
}

async function countUserStrategies(userId, db = supabaseAdmin) {
  const result = await db
    .from("user_strategies")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_archived", false);

  if (result.error) throw result.error;
  return Number(result.count || 0);
}

function strategySnapshot(strategy) {
  if (!strategy) return null;

  return {
    id: strategy.id,
    strategyName: strategy.strategy_name,
    description: strategy.description || "",
    markets: strategy.markets || [],
    timeframes: strategy.timeframes || [],
    tradingSessions: strategy.trading_sessions || [],
    directionalBiasRules: strategy.directional_bias_rules || "",
    entryLocationRules: strategy.entry_location_rules || "",
    entryConfirmationRules: strategy.entry_confirmation_rules || "",
    stopLossRules: strategy.stop_loss_rules || "",
    takeProfitRules: strategy.take_profit_rules || "",
    riskRules: strategy.risk_rules || "",
    tradeManagementRules: strategy.trade_management_rules || "",
    invalidationRules: strategy.invalidation_rules || "",
    noTradeConditions: strategy.no_trade_conditions || "",
    additionalNotes: strategy.additional_notes || "",
    minimumRiskReward: strategy.minimum_risk_reward,
    riskPerTradePercent: strategy.risk_per_trade_percent,
    version: strategy.version || 1,
    rules: (strategy.strategy_rules || [])
      .filter((rule) => rule.is_active !== false)
      .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
      .map((rule) => ({
        category: rule.rule_category,
        text: rule.rule_text,
        importance: rule.importance,
        displayOrder: rule.display_order,
      })),
  };
}

function normalizeAnalysisFramework(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["personal", "personal_strategy", "strategy"].includes(normalized)
    ? "personal_strategy"
    : "csa";
}

async function resolveSelectedStrategy({ userId, entitlement, analysisFramework, strategyId }) {
  const framework = normalizeAnalysisFramework(analysisFramework);

  if (framework === "csa") {
    return { analysisFramework: "csa", strategy: null, snapshot: null };
  }

  if (Number(entitlement?.strategyLimit || 0) < 1) {
    const error = new Error("Personal strategies are available on the Pro and Elite plans.");
    error.statusCode = 403;
    error.errorType = "personal_strategy_not_available";
    throw error;
  }

  const strategy = await getOwnedStrategy(userId, strategyId);

  if (!strategy || strategy.is_active === false) {
    const error = new Error("The selected personal strategy could not be found or is inactive.");
    error.statusCode = 404;
    error.errorType = "strategy_not_found";
    throw error;
  }

  return {
    analysisFramework: "personal_strategy",
    strategy,
    snapshot: strategySnapshot(strategy),
  };
}

function buildPersonalStrategyPrompt(snapshot) {
  if (!snapshot) return "";

  const structuredRules = (snapshot.rules || []).length
    ? snapshot.rules.map((rule, index) =>
        `${index + 1}. [${rule.importance}] ${rule.category}: ${rule.text}`
      ).join("\n")
    : "No structured rules were added.";

  return `
PERSONAL STRATEGY SELECTED

Strategy name: ${snapshot.strategyName}
Description: ${snapshot.description || "Not provided"}
Markets: ${(snapshot.markets || []).join(", ") || "Not restricted"}
Timeframes: ${(snapshot.timeframes || []).join(", ") || "Not restricted"}
Trading sessions: ${(snapshot.tradingSessions || []).join(", ") || "Not restricted"}
Directional-bias rules: ${snapshot.directionalBiasRules || "Not provided"}
Entry-location rules: ${snapshot.entryLocationRules || "Not provided"}
Entry-confirmation rules: ${snapshot.entryConfirmationRules || "Not provided"}
Stop-loss rules: ${snapshot.stopLossRules || "Not provided"}
Take-profit rules: ${snapshot.takeProfitRules || "Not provided"}
Risk rules: ${snapshot.riskRules || "Not provided"}
Trade-management rules: ${snapshot.tradeManagementRules || "Not provided"}
Invalidation rules: ${snapshot.invalidationRules || "Not provided"}
No-trade conditions: ${snapshot.noTradeConditions || "Not provided"}
Minimum risk-to-reward: ${snapshot.minimumRiskReward ?? "Not provided"}
Risk per trade: ${snapshot.riskPerTradePercent ?? "Not provided"}%
Additional notes: ${snapshot.additionalNotes || "None"}

Structured rules:
${structuredRules}

When reviewing the chart:
- Compare visible evidence against this strategy.
- Do not replace the user's rules with generic trading advice.
- If a rule cannot be checked from the chart or notes, mark it as missing information.
- Required rule failures must reduce the strategy match score more heavily.
`;
}

function requireStripeConfigured() {
  if (
    !stripe ||
    !STRIPE_PRO_PRICE_ID ||
    !STRIPE_ELITE_PRICE_ID ||
    !FRONTEND_URL
  ) {
    const error = new Error("Stripe billing is not fully configured.");
    error.statusCode = 500;
    throw error;
  }
}

function mapPriceIdToPlan(priceId = "") {
  if (priceId === STRIPE_PRO_PRICE_ID) return "pro";
  if (priceId === STRIPE_ELITE_PRICE_ID) return "elite";
  return "starter";
}

function stripeTimestampToIso(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? new Date(numberValue * 1000).toISOString()
    : null;
}

function mapStripeStatus(status = "") {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "active") return "active";
  if (normalized === "trialing") return "trialing";
  if (["past_due", "unpaid", "paused"].includes(normalized)) return "past_due";
  if (["incomplete", "incomplete_expired"].includes(normalized)) return "incomplete";
  if (["canceled", "cancelled"].includes(normalized)) return "cancelled";

  return "incomplete";
}

async function findProfileForStripeObject({
  userId = "",
  customerId = "",
  subscriptionId = "",
}) {
  if (!supabaseAdmin) return null;

  if (userId) {
    const direct = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (!direct.error && direct.data) return direct.data;
  }

  if (subscriptionId) {
    const bySubscription = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (!bySubscription.error && bySubscription.data) return bySubscription.data;
  }

  if (customerId) {
    const byCustomer = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (!byCustomer.error && byCustomer.data) return byCustomer.data;
  }

  return null;
}

async function logStripeEventBestEffort({
  eventId,
  userId,
  customerId,
  subscriptionId,
}) {
  if (!supabaseAdmin || !eventId || !userId) return;

  try {
    await supabaseAdmin.from("subscription_events").insert({
      user_id: userId,
      stripe_customer_id: customerId || null,
      stripe_subscription_id: subscriptionId || null,
      stripe_event_id: eventId,
    });
  } catch (error) {
    console.warn("Stripe event logging skipped:", error?.message || error);
  }
}

async function updateProfileFromStripeSubscription(subscription, eventId = "") {
  if (!supabaseAdmin || !subscription) return null;

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id || "";

  const subscriptionId = subscription.id || "";
  const metadataUserId =
    subscription.metadata?.supabase_user_id ||
    subscription.metadata?.user_id ||
    "";

  const profile = await findProfileForStripeObject({
    userId: metadataUserId,
    customerId,
    subscriptionId,
  });

  if (!profile) {
    console.warn("No Supabase profile matched Stripe subscription", subscriptionId);
    return null;
  }

  const firstItem = subscription.items?.data?.[0] || null;
  const priceId =
    typeof firstItem?.price === "string"
      ? firstItem.price
      : firstItem?.price?.id || "";

  const planCode =
    mapPriceIdToPlan(priceId) !== "starter"
      ? mapPriceIdToPlan(priceId)
      : String(subscription.metadata?.plan_code || "starter").toLowerCase();

  const mappedStatus = mapStripeStatus(subscription.status);
  const subscriptionEnded = mappedStatus === "cancelled";

  const periodStart =
    subscription.current_period_start || firstItem?.current_period_start || null;
  const periodEnd =
    subscription.current_period_end || firstItem?.current_period_end || null;

  const hadTrial =
    Boolean(subscription.trial_start) ||
    subscription.status === "trialing" ||
    profile.trial_used === true;

  const updates = subscriptionEnded
    ? {
        subscription_plan: "starter",
        subscription_status: "cancelled",
        stripe_customer_id: customerId || profile.stripe_customer_id || null,
        stripe_subscription_id: null,
        stripe_price_id: null,
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
        trial_used: hadTrial,
      }
    : {
        subscription_plan: ["pro", "elite"].includes(planCode) ? planCode : "starter",
        subscription_status: mappedStatus,
        stripe_customer_id: customerId || profile.stripe_customer_id || null,
        stripe_subscription_id: subscriptionId || null,
        stripe_price_id: priceId || null,
        current_period_start: stripeTimestampToIso(periodStart),
        current_period_end: stripeTimestampToIso(periodEnd),
        cancel_at_period_end: subscription.cancel_at_period_end === true,
        trial_used: hadTrial,
      };

  const result = await supabaseAdmin
    .from("profiles")
    .update(updates)
    .eq("id", profile.id)
    .select("*")
    .single();

  if (result.error) throw result.error;

  await logStripeEventBestEffort({
    eventId,
    userId: profile.id,
    customerId,
    subscriptionId,
  });

  return result.data;
}

async function markCustomerPastDue(customerId, eventId = "") {
  if (!supabaseAdmin || !customerId) return;

  const profile = await findProfileForStripeObject({ customerId });
  if (!profile) return;

  const result = await supabaseAdmin
    .from("profiles")
    .update({ subscription_status: "past_due" })
    .eq("id", profile.id);

  if (result.error) throw result.error;

  await logStripeEventBestEffort({
    eventId,
    userId: profile.id,
    customerId,
    subscriptionId: profile.stripe_subscription_id || "",
  });
}

async function handleStripeEvent(event) {
  const object = event?.data?.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const subscriptionId =
        typeof object.subscription === "string"
          ? object.subscription
          : object.subscription?.id || "";

      if (subscriptionId && stripe) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["items.data.price"],
        });
        await updateProfileFromStripeSubscription(subscription, event.id);
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await updateProfileFromStripeSubscription(object, event.id);
      break;

    case "invoice.payment_failed": {
      const customerId =
        typeof object.customer === "string"
          ? object.customer
          : object.customer?.id || "";
      await markCustomerPastDue(customerId, event.id);
      break;
    }

    default:
      break;
  }
}

// Stripe must receive the unmodified raw request body for signature verification.
app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      return res.status(503).send("Stripe webhook is not configured.");
    }

    const signature = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (error) {
      console.error("Stripe webhook signature error:", error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
      await handleStripeEvent(event);
      return res.json({ received: true });
    } catch (error) {
      console.error("Stripe webhook processing error:", error);
      return res.status(500).json({
        received: false,
        error: "Webhook processing failed.",
      });
    }
  }
);

app.use(express.json({ limit: "25mb" }));

function safeStorageFilename(filename = "chart.png") {
  const cleaned = String(filename)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(-120);

  return cleaned || "chart.png";
}

function normalizeMistakeTitle(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactRawAiResponse({
  analysis,
  chartDetection,
  visualReview,
  marketReference,
  dashboardFeedback,
  dateDecision,
  analysisFramework = "csa",
  selectedStrategy = null,
  personalStrategySnapshot = null,
}) {
  return {
    analysis,
    analysisFramework,
    selectedStrategy: selectedStrategy
      ? {
          id: selectedStrategy.id,
          name: selectedStrategy.strategy_name || null,
          version: selectedStrategy.version || 1,
        }
      : null,
    personalStrategySnapshot,
    chartDetection,
    visualReview,
    dateDecision,
    dashboard: {
      strengths: dashboardFeedback?.strengths || [],
      weaknesses: dashboardFeedback?.weaknesses || [],
      mistakes: dashboardFeedback?.aiMistakeDetectionHub || [],
      setupQuality: dashboardFeedback?.setupQuality || null,
      entryAccuracy: dashboardFeedback?.entryAccuracy || null,
      riskManagement: dashboardFeedback?.riskManagement || null,
      contextCheck: dashboardFeedback?.contextCheck || null,
    },
    marketReference: {
      ok: Boolean(marketReference?.ok),
      error: marketReference?.error || "",
      symbol: marketReference?.symbol || "",
      timezone: marketReference?.timezone || "UTC",
      interval: marketReference?.interval || "",
      weekRange: marketReference?.weekRange || null,
      directionalBias: marketReference?.directionalBias || null,
      profile: marketReference?.profile || null,
      csaAreas: Array.isArray(marketReference?.csaAreas)
        ? marketReference.csaAreas.slice(0, 30)
        : [],
    },
  };
}

async function saveCompletedReview({
  user,
  file,
  submittedInstrument,
  timeframe,
  mode,
  submittedNotes,
  chartDateText,
  analysis,
  chartDetection,
  visualReview,
  marketReference,
  dashboardFeedback,
  dateDecision,
  analysisFramework = "csa",
  selectedStrategy = null,
  personalStrategySnapshot = null,
}) {
  if (!user) {
    return {
      savedToJournal: false,
      saveReason: "No authenticated user access token was sent.",
      reviewId: null,
      chartImagePath: null,
    };
  }

  if (!supabaseAdmin) {
    throw new Error("Supabase backend variables are missing.");
  }

  const timestamp = Date.now();
  const objectPath = `${user.id}/${timestamp}-${safeStorageFilename(file.originalname)}`;
  let uploaded = false;
  let reviewId = null;

  try {
    const uploadResult = await supabaseAdmin.storage
      .from("chart-images")
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype || "image/png",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadResult.error) throw uploadResult.error;
    uploaded = true;

    const setupScore = Number(dashboardFeedback?.setupQualityScore || 0);
    const entryScore = Number(dashboardFeedback?.entryAccuracyScore || 0);
    const riskScore = Number(dashboardFeedback?.riskManagementScore || 0);
    const overallScore = Math.round((setupScore + entryScore + riskScore) / 3);

    const directionalBias =
      marketReference?.directionalBias?.bias ||
      visualReview?.plainMarketDirection ||
      "Not available";

    const keyAreas = Array.isArray(marketReference?.csaAreas)
      ? marketReference.csaAreas.slice(0, 30)
      : [];

    const rawAiResponse = compactRawAiResponse({
      analysis,
      chartDetection,
      visualReview,
      marketReference,
      dashboardFeedback,
      dateDecision,
      analysisFramework,
      selectedStrategy,
      personalStrategySnapshot,
    });

    const reviewInsert = await supabaseAdmin
      .from("chart_reviews")
      .insert({
        user_id: user.id,
        instrument: submittedInstrument,
        timeframe,
        review_type: mode === "pre-trade" ? "pre_trade" : "post_trade",
        chart_image_path: objectPath,
        user_notes: submittedNotes || null,
        csa_directional_bias: directionalBias,
        market_structure_summary:
          visualReview?.visualSummary ||
          marketReference?.directionalBias?.higherTimeframeView ||
          null,
        key_areas_of_interest: keyAreas,
        overall_score: overallScore,
        strategy_score: setupScore,
        risk_management_score: riskScore,
        trade_management_score: null,
        execution_score: entryScore,
        ai_summary: analysis,
        correction_plan:
          visualReview?.coachVerdict ||
          visualReview?.mainWarning ||
          dashboardFeedback?.setupQuality?.summary ||
          null,
        raw_ai_response: rawAiResponse,
        trade_date: chartDateText || null,
        analysis_framework: analysisFramework,
        strategy_id:
          analysisFramework === "personal_strategy"
            ? selectedStrategy?.id || null
            : null,
        strategy_name_snapshot:
          analysisFramework === "personal_strategy"
            ? personalStrategySnapshot?.strategyName || null
            : null,
        strategy_version:
          analysisFramework === "personal_strategy"
            ? personalStrategySnapshot?.version || 1
            : null,
        strategy_snapshot:
          analysisFramework === "personal_strategy"
            ? personalStrategySnapshot
            : null,
        strategy_match_score:
          analysisFramework === "personal_strategy"
            ? visualReview?.strategyMatchScore ?? null
            : null,
        strategy_rules_followed:
          analysisFramework === "personal_strategy"
            ? visualReview?.strategyRulesFollowed || []
            : [],
        strategy_rules_violated:
          analysisFramework === "personal_strategy"
            ? visualReview?.strategyRulesViolated || []
            : [],
        strategy_missing_information:
          analysisFramework === "personal_strategy"
            ? visualReview?.strategyMissingInformation || []
            : [],
        strategy_verdict:
          analysisFramework === "personal_strategy"
            ? visualReview?.strategyVerdict || null
            : null,
      })
      .select("id")
      .single();

    if (reviewInsert.error) throw reviewInsert.error;
    reviewId = reviewInsert.data.id;

    const feedbackRows = [];

    (dashboardFeedback?.strengths || []).forEach((feedbackText, index) => {
      feedbackRows.push({
        review_id: reviewId,
        user_id: user.id,
        feedback_type: "strength",
        category: "Chart review",
        feedback_text: String(feedbackText),
        display_order: index,
      });
    });

    (dashboardFeedback?.weaknesses || []).forEach((feedbackText, index) => {
      feedbackRows.push({
        review_id: reviewId,
        user_id: user.id,
        feedback_type: "weakness",
        category: "Chart review",
        feedback_text: String(feedbackText),
        display_order: index,
      });
    });

    if (feedbackRows.length) {
      const feedbackInsert = await supabaseAdmin
        .from("review_feedback")
        .insert(feedbackRows);

      if (feedbackInsert.error) throw feedbackInsert.error;
    }

    const usageInsert = await supabaseAdmin.from("usage_records").insert({
      user_id: user.id,
      review_id: reviewId,
      action_type: "chart_review",
    });

    if (usageInsert.error) throw usageInsert.error;

    const mistakeItems = Array.isArray(dashboardFeedback?.aiMistakeDetectionHub)
      ? dashboardFeedback.aiMistakeDetectionHub
      : [];

    if (mistakeItems.length) {
      const tagsResult = await supabaseAdmin
        .from("mistake_tags")
        .select("id, tag_name");

      if (tagsResult.error) throw tagsResult.error;

      const tagRows = tagsResult.data || [];
      const reviewMistakes = [];

      mistakeItems.forEach((item) => {
        const title = String(item?.title || item || "").trim();
        const normalizedTitle = normalizeMistakeTitle(title);
        if (!normalizedTitle) return;

        const matchedTag = tagRows.find((tag) => {
          const normalizedTag = normalizeMistakeTitle(tag.tag_name);
          return (
            normalizedTag === normalizedTitle ||
            normalizedTag.includes(normalizedTitle) ||
            normalizedTitle.includes(normalizedTag)
          );
        });

        if (!matchedTag) return;

        if (
          !reviewMistakes.some(
            (row) => row.mistake_tag_id === matchedTag.id
          )
        ) {
          reviewMistakes.push({
            review_id: reviewId,
            user_id: user.id,
            mistake_tag_id: matchedTag.id,
            coach_comment:
              visualReview?.mainWarning ||
              visualReview?.coachVerdict ||
              null,
          });
        }
      });

      if (reviewMistakes.length) {
        const mistakeInsert = await supabaseAdmin
          .from("review_mistakes")
          .insert(reviewMistakes);

        if (mistakeInsert.error) throw mistakeInsert.error;
      }
    }

    return {
      savedToJournal: true,
      saveReason: "Analysis and chart were saved successfully.",
      reviewId,
      chartImagePath: objectPath,
    };
  } catch (error) {
    console.error("Supabase review save error:", error);

    // Best-effort cleanup prevents incomplete journal entries.
    if (reviewId) {
      await supabaseAdmin.from("chart_reviews").delete().eq("id", reviewId);
    }
    if (uploaded) {
      await supabaseAdmin.storage.from("chart-images").remove([objectPath]);
    }

    throw new Error(`The analysis completed, but saving to the journal failed: ${error.message}`);
  }
}


const CHART_DETECTION_PROMPT = `
You are CSA Coach's chart screenshot validator. Return ONLY valid JSON.

A valid trading chart screenshot must show a clear, directly readable financial chart with visible candles/bars/line movement, a readable price scale, and a readable time/date axis.

The trading chart must be the main subject of the uploaded image. Reject screenshots where the chart is only a small nested element inside another webpage, mobile screen, dashboard, social-media post, document, presentation, analytics page, or application screenshot.

Invalid/insufficient images:
- photos, logos, documents, rooms, screenshots with no financial chart
- screenshots of webpages, dashboards, phones, documents, or applications where a small chart appears inside a larger interface
- images where the actual chart occupies less than about 60% of the useful image area
- images where candles, price scale, time axis, symbol, or timeframe are too small to read reliably
- blank charts, loading charts, charts where no candle/line movement is visible
- charts with fewer than about 15 visible candles/bars/points
- heavily cropped, blurry, compressed, or zoomed-out screenshots that prevent reliable chart review

Important decision rule:
- A tiny chart inside a large screenshot is NOT a valid chart upload, even if some candles are technically visible.
- Do not accept a nested chart merely because the user-selected instrument and timeframe were supplied.
- When uncertain whether the chart itself is large and readable enough, mark isTradingChart=false.

Important:
- Take your time to inspect the top-left chart header, chart title, symbol label, and timeframe label before returning JSON.
- Do NOT copy the selected instrument or selected timeframe from the user input unless the same instrument/timeframe is clearly visible on the uploaded chart image.
- If the uploaded chart instrument is not clearly readable, set detectedInstrument=null. Do not guess.
- If the uploaded chart timeframe is not clearly readable, set detectedTimeframe=null. Do not guess.
- Be practical. If a chart clearly has visible price movement, do not mark it insufficient just because the exact selected date is hard to read.
- If the selected date is clearly far after the latest visible chart date, set selectedDateVisible=false and provide latestVisibleDate.
- If the date axis is hard to read, set dateConfidence="low" instead of blocking the chart.
- Only mark hasUsablePriceData=false when the chart is truly blank/unclear/cropped/loading or has almost no price movement.
- Do not comment on strategies such as trendlines, channels, indicators, Fibonacci, or moving averages in this step. This step only validates the chart and detects basic context.

Entry trigger rule:
Only return visibleTrigger if there is real confirmation such as engulfing, pin bar, hammer, doji rejection, inside bar break, lower high/higher low, breakout/breakdown, retest-and-hold, or clean break-and-hold.
Bounce, pullback, reaction, retracement, ranging, or consolidation alone is not a trigger.

Return exactly this JSON shape:
{
  "isTradingChart": true,
  "chartValidityReason": "brief reason",
  "hasUsablePriceData": true,
  "visibleCandleCount": 80,
  "chartDataQuality": "usable",
  "chartOccupancyPercent": 85,
  "isNestedChart": false,
  "isChartReadableAtCurrentSize": true,
  "selectedDateVisible": true,
  "insufficientDataReason": null,
  "detectedInstrument": "GBPUSD or null",
  "detectedTimeframe": "H1 or M5 or H4 or D1 or W1 or MN or null",
  "latestVisibleDate": "YYYY-MM-DD or null",
  "dateConfidence": "high or medium or low",
  "visibleTrigger": "brief trigger description or null",
  "triggerDirection": "bullish or bearish or neutral or null",
  "triggerConfidence": "high or medium or low",
  "notes": "brief note"
}`;

const CONFIRMED_TRIGGER_WORDS = [
  "engulfing", "pin bar", "pinbar", "hammer", "doji", "inside bar", "lower high",
  "higher low", "breakout", "breakdown", "break-and-hold", "break and hold",
  "head and shoulders", "quasimodo", "channel", "flag", "triangle", "rejection"
];

const CONTEXT_ONLY_TRIGGER_WORDS = [
  "bounce", "bouncing", "pullback", "pull back", "retracement", "retrace",
  "consolidation", "consolidating", "reaction", "range", "ranging", "moving away"
];

function normalizeSymbol(input = "") {
  const raw = String(input).trim().toUpperCase().replace(/\s+/g, "");
  const map = {
    EURUSD: "EUR/USD", GBPUSD: "GBP/USD", EURCHF: "EUR/CHF", EURGBP: "EUR/GBP",
    GBPJPY: "GBP/JPY", USDJPY: "USD/JPY", USDCHF: "USD/CHF", USDCAD: "USD/CAD",
    AUDUSD: "AUD/USD", NZDUSD: "NZD/USD", XAUUSD: "XAU/USD", GOLD: "XAU/USD",
    BTCUSD: "BTC/USD", BTCUSDT: "BTC/USD",
  };
  if (map[raw]) return map[raw];
  if (raw.includes("/")) return raw;
  if (raw.length === 6) return `${raw.slice(0, 3)}/${raw.slice(3)}`;
  return raw || "";
}

function comparableInstrument(input = "") {
  const raw = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  if (raw.includes("GOLD")) return "XAUUSD";
  if (raw.includes("BTCUSDT")) return "BTCUSD";
  const known = [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
    "EURCHF", "EURGBP", "GBPJPY", "XAUUSD", "BTCUSD"
  ];
  return known.find((symbol) => raw.includes(symbol)) || normalizeSymbol(raw).replace(/[^A-Z0-9]/g, "");
}

function comparableTimeframe(input = "") {
  const raw = String(input).trim().toUpperCase().replace(/\s+/g, "");
  const cleaned = raw.replace(/[^A-Z0-9]/g, "");
  if (!raw || raw === "NOTPROVIDED" || raw === "NOTDETECTED" || raw === "NULL") return "";
  const map = {
    "1": "M1", "1M": "M1", M1: "M1", "1MIN": "M1",
    "5": "M5", "5M": "M5", M5: "M5", "5MIN": "M5",
    "15": "M15", "15M": "M15", M15: "M15", "15MIN": "M15",
    "30": "M30", "30M": "M30", M30: "M30", "30MIN": "M30",
    "60": "H1", "60M": "H1", "1H": "H1", H1: "H1",
    "240": "H4", "240M": "H4", "4H": "H4", H4: "H4",
    D: "D1", "1D": "D1", D1: "D1", DAILY: "D1",
    W: "W1", "1W": "W1", W1: "W1", WEEKLY: "W1",
    MN: "MN", MTH: "MN", MONTH: "MN", MONTHLY: "MN", "1MO": "MN", "1MON": "MN", "1MONTH": "MN",
  };
  return map[raw] || map[cleaned] || cleaned;
}

function normalizeTimeframe(input = "") {
  const tf = comparableTimeframe(input);
  const map = { M1: "1min", M5: "5min", M15: "15min", M30: "30min", H1: "1h", H4: "4h", D1: "1day", W1: "1week", MN: "1month" };
  return map[tf] || "1h";
}

function normalizeAnalysisType(input = "") {
  const raw = String(input).trim().toLowerCase();
  if (raw.includes("pre") || raw.includes("before")) return "pre-trade";
  return "post-trade";
}

function hasStrongInstrumentMismatch({ selectedInstrument, detectedInstrument }) {
  const selected = comparableInstrument(selectedInstrument);
  const detected = comparableInstrument(detectedInstrument);
  if (!selected || !detected) return false;
  if (selected.length < 6 || detected.length < 6) return false;
  return selected !== detected;
}

function hasStrongTimeframeMismatch({ selectedTimeframe, detectedTimeframe }) {
  const selected = comparableTimeframe(selectedTimeframe);
  const detected = comparableTimeframe(detectedTimeframe);
  if (!selected || !detected) return false;
  return selected !== detected;
}

function isDetectedInstrumentUsable(detectedInstrument = "") {
  const detected = comparableInstrument(detectedInstrument);
  return Boolean(detected && detected.length >= 6);
}

function isDetectedTimeframeUsable(detectedTimeframe = "") {
  const detected = comparableTimeframe(detectedTimeframe);
  return Boolean(detected && ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"].includes(detected));
}

function getChartContextVerificationProblem({ chartDetection, submittedInstrument, timeframe }) {
  if (!submittedInstrument || submittedInstrument === "Not provided") {
    return { hasProblem: true, errorType: "selected_instrument_missing", error: "Please select the chart instrument before running diagnostics." };
  }
  if (!timeframe || timeframe === "Not provided") {
    return { hasProblem: true, errorType: "selected_timeframe_missing", error: "Please select the chart timeframe before running diagnostics." };
  }

  const instrumentOk = isDetectedInstrumentUsable(chartDetection?.detectedInstrument);
  const timeframeOk = isDetectedTimeframeUsable(chartDetection?.detectedTimeframe);

  if (!instrumentOk && !timeframeOk) {
    return {
      hasProblem: true,
      errorType: "chart_context_unverified",
      error: "The uploaded chart instrument and timeframe could not be clearly verified from the image.",
    };
  }
  if (!instrumentOk) {
    return {
      hasProblem: true,
      errorType: "chart_instrument_unverified",
      error: "The uploaded chart instrument could not be clearly verified from the image.",
    };
  }
  if (!timeframeOk) {
    return {
      hasProblem: true,
      errorType: "chart_timeframe_unverified",
      error: "The uploaded chart timeframe could not be clearly verified from the image.",
    };
  }

  return { hasProblem: false };
}

function parseISODateOnly(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateOnly(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
function safeNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function candleDateOnly(datetimeValue = "") { return String(datetimeValue).slice(0, 10); }

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 100) return n.toFixed(3);
  if (Math.abs(n) >= 10) return n.toFixed(4);
  return n.toFixed(5);
}

function stripCodeFence(text = "") {
  return String(text).replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
}

function extractJsonObject(text = "") {
  const cleaned = stripCodeFence(text);
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function clampScore(value, min = 0, max = 100) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(min, Math.min(max, Math.round(num))) : min;
}

function scoreLabel(score) {
  if (score >= 85) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Weak";
  return "Poor";
}

function makeSimpleMistake(title, severity = "REVIEW") {
  const cleanTitle = String(title || "").trim() || "Review setup";
  const cleanSeverity = String(severity || "REVIEW").trim().toUpperCase();
  return { title: cleanTitle, severity: cleanSeverity, tag: cleanSeverity, label: cleanSeverity, detail: "", correction: "", summary: "" };
}

function normalizeArrayOfStrings(value = [], fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => {
    if (typeof item === "string") return item.trim();
    if (item && typeof item === "object") return String(item.title || item.summary || item.detail || "").trim();
    return "";
  }).filter(Boolean);
}

function normalizeVisualMistakeItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (typeof item === "string") return makeSimpleMistake(item, "REVIEW");
    return makeSimpleMistake(item?.title || item?.mistake || item?.name || "", item?.tag || item?.severity || item?.label || "REVIEW");
  }).filter((item) => item.title && item.title !== "Review setup").slice(0, 5);
}

function sanitizeVisibleTrigger(trigger, confidence = "low") {
  const text = String(trigger || "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const hasConfirmedWord = CONFIRMED_TRIGGER_WORDS.some((word) => lower.includes(word));
  const hasContextOnlyWord = CONTEXT_ONLY_TRIGGER_WORDS.some((word) => lower.includes(word));
  const isLowConfidence = String(confidence || "low").toLowerCase() === "low";
  if (isLowConfidence) return null;
  if (hasContextOnlyWord && !hasConfirmedWord) return null;
  if (!hasConfirmedWord) return null;
  return text;
}

function getCleanBreakTolerance(symbol = "") {
  const compact = comparableInstrument(symbol);
  if (compact.includes("JPY")) return 0.02;
  if (compact.includes("XAU")) return 0.2;
  if (compact.includes("BTC")) return 20;
  return 0.0002;
}

function compareHighWithTolerance(currentHigh, previousHigh, symbol = "") {
  const current = Number(currentHigh), previous = Number(previousHigh), tolerance = getCleanBreakTolerance(symbol);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { cleanBreak: false, difference: null, tolerance, label: "unavailable" };
  const difference = current - previous;
  if (difference > tolerance) return { cleanBreak: true, difference, tolerance, label: "clean higher high" };
  if (Math.abs(difference) <= tolerance) return { cleanBreak: false, difference, tolerance, label: "equal high / retest of previous high" };
  return { cleanBreak: false, difference, tolerance, label: "failed to break previous high" };
}

function compareLowWithTolerance(currentLow, previousLow, symbol = "") {
  const current = Number(currentLow), previous = Number(previousLow), tolerance = getCleanBreakTolerance(symbol);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { cleanBreak: false, difference: null, tolerance, label: "unavailable" };
  const difference = previous - current;
  if (difference > tolerance) return { cleanBreak: true, difference, tolerance, label: "clean lower low" };
  if (Math.abs(previous - current) <= tolerance) return { cleanBreak: false, difference, tolerance, label: "equal low / retest of previous low" };
  return { cleanBreak: false, difference, tolerance, label: "held above previous low" };
}

function getSupportedCsaTimeframeProfile(timeframe = "H1") {
  const tf = comparableTimeframe(timeframe) || "H1";
  if (["M1", "M5", "M15", "M30", "H1"].includes(tf)) {
    return { selectedTimeframe: tf, interval: normalizeTimeframe(tf), structureMode: "daily-in-week", structureLabel: "Daily highs/lows inside the selected Monday-to-Friday week", sourceUnitSingular: "day", sourceUnitPlural: "daily levels", firstPeriodText: "Monday high/low creates first support and resistance.", startPriceLabel: "Monday open", currentPriceLabel: "latest close for selected week", rangeKind: "week", breakdownTitle: "Monday-to-Friday CSA Breakdown" };
  }
  if (tf === "H4") return { selectedTimeframe: tf, interval: "4h", structureMode: "weekly-in-month", structureLabel: "Weekly highs/lows inside the selected calendar month", sourceUnitSingular: "week", sourceUnitPlural: "weekly levels", firstPeriodText: "First week high/low creates first support and resistance.", startPriceLabel: "first week open", currentPriceLabel: "latest close for selected month", rangeKind: "month", breakdownTitle: "Weekly CSA Breakdown For Selected Month" };
  if (tf === "D1") return { selectedTimeframe: tf, interval: "1day", structureMode: "monthly-in-year", structureLabel: "Monthly highs/lows inside the selected calendar year", sourceUnitSingular: "month", sourceUnitPlural: "monthly levels", firstPeriodText: "First month high/low creates first support and resistance.", startPriceLabel: "first month open", currentPriceLabel: "latest close for selected year", rangeKind: "year", breakdownTitle: "Monthly CSA Breakdown For Selected Year" };
  if (tf === "W1") return { selectedTimeframe: tf, interval: "1week", structureMode: "quarterly-in-year", structureLabel: "Quarterly highs/lows inside the selected calendar year", sourceUnitSingular: "quarter", sourceUnitPlural: "quarterly levels", firstPeriodText: "First quarter high/low creates first support and resistance.", startPriceLabel: "first quarter open", currentPriceLabel: "latest close for selected year", rangeKind: "year", breakdownTitle: "Quarterly CSA Breakdown For Selected Year" };
  if (tf === "MN") return { selectedTimeframe: tf, interval: "1month", structureMode: "yearly-in-multi-year", structureLabel: "Yearly highs/lows across selected year plus previous 4 years", sourceUnitSingular: "year", sourceUnitPlural: "yearly levels", firstPeriodText: "First year high/low creates first support and resistance.", startPriceLabel: "first year open", currentPriceLabel: "latest close for selected multi-year range", rangeKind: "multi-year range", breakdownTitle: "Yearly CSA Breakdown For Monthly Chart" };
  return getSupportedCsaTimeframeProfile("H1");
}

function getMonthName(monthIndex) {
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, monthIndex, 1)));
}
function getQuarterLabel(monthIndex) { return monthIndex <= 2 ? "Q1" : monthIndex <= 5 ? "Q2" : monthIndex <= 8 ? "Q3" : "Q4"; }
function weekdayNameFromDate(dateString) { return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${dateString}T00:00:00.000Z`)); }

function getWeekRangeForDate(chartDate, useFullWeek = false) {
  const day = chartDate.getUTCDay();
  const monday = addDays(chartDate, day === 0 ? -6 : 1 - day);
  const friday = addDays(monday, 4);
  const end = useFullWeek ? friday : chartDate < friday ? chartDate : friday;
  return { start: monday, end, final: friday, startDate: formatDateOnly(monday), endDate: formatDateOnly(end), finalDate: formatDateOnly(friday) };
}

function getMonthRangeForDate(chartDate, useFullMonth = false) {
  const year = chartDate.getUTCFullYear(), month = chartDate.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const final = new Date(Date.UTC(year, month + 1, 0));
  const end = useFullMonth ? final : chartDate < final ? chartDate : final;
  return { start, end, final, startDate: formatDateOnly(start), endDate: formatDateOnly(end), finalDate: formatDateOnly(final) };
}

function getYearRangeForDate(chartDate, useFullYear = false) {
  const year = chartDate.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const final = new Date(Date.UTC(year, 11, 31));
  const end = useFullYear ? final : chartDate < final ? chartDate : final;
  return { start, end, final, startDate: formatDateOnly(start), endDate: formatDateOnly(end), finalDate: formatDateOnly(final) };
}

function getMultiYearRangeForDate(chartDate, yearsBack = 4, useFullFinalYear = false) {
  const year = chartDate.getUTCFullYear();
  const start = new Date(Date.UTC(year - yearsBack, 0, 1));
  const final = new Date(Date.UTC(year, 11, 31));
  const end = useFullFinalYear ? final : chartDate < final ? chartDate : final;
  return { start, end, final, startDate: formatDateOnly(start), endDate: formatDateOnly(end), finalDate: formatDateOnly(final) };
}

function getStructureRangeForProfile(chartDate, profile, analysisType = "post-trade") {
  // IMPORTANT: Always stop at the selected chart/trade date.
  // Do not use candles after the selected date to judge the current setup.
  // Example: if the selected date is Tuesday, the review must not use Wednesday-Friday data.
  const useFull = false;
  if (profile.structureMode === "daily-in-week") return getWeekRangeForDate(chartDate, useFull);
  if (profile.structureMode === "weekly-in-month") return getMonthRangeForDate(chartDate, useFull);
  if (["monthly-in-year", "quarterly-in-year"].includes(profile.structureMode)) return getYearRangeForDate(chartDate, useFull);
  if (profile.structureMode === "yearly-in-multi-year") return getMultiYearRangeForDate(chartDate, 4, useFull);
  return getWeekRangeForDate(chartDate, useFull);
}

function getPeriodKeyAndLabel(date, profile) {
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  if (profile.structureMode === "daily-in-week") { const dateOnly = formatDateOnly(date); return { key: dateOnly, label: weekdayNameFromDate(dateOnly), date: dateOnly }; }
  if (profile.structureMode === "weekly-in-month") {
    const monthStart = new Date(Date.UTC(year, month, 1));
    const weekNumber = Math.ceil((date.getUTCDate() + monthStart.getUTCDay()) / 7);
    return { key: `${year}-${String(month + 1).padStart(2, "0")}-W${weekNumber}`, label: `Week ${weekNumber}`, date: formatDateOnly(date) };
  }
  if (profile.structureMode === "monthly-in-year") return { key: `${year}-${String(month + 1).padStart(2, "0")}`, label: getMonthName(month), date: `${year}-${String(month + 1).padStart(2, "0")}-01` };
  if (profile.structureMode === "quarterly-in-year") { const q = getQuarterLabel(month); return { key: `${year}-${q}`, label: q, date: `${year}-${q}` }; }
  if (profile.structureMode === "yearly-in-multi-year") return { key: String(year), label: String(year), date: `${year}-01-01` };
  const dateOnly = formatDateOnly(date);
  return { key: dateOnly, label: dateOnly, date: dateOnly };
}

function getOutputSizeForInterval(interval) {
  const map = { "1min": "5000", "5min": "5000", "15min": "3000", "30min": "2000", "1h": "1000", "4h": "500", "1day": "400", "1week": "300", "1month": "120" };
  return map[interval] || "1000";
}

function buildStructureLevelsFromCandles(candles, structureRange, profile) {
  const grouped = new Map();
  candles.forEach((bar) => {
    const dateOnly = candleDateOnly(bar.datetime);
    if (!dateOnly) return;
    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return;
    if (dateOnly < structureRange.startDate || dateOnly > structureRange.endDate) return;
    if (profile.structureMode === "daily-in-week") { const dayNum = date.getUTCDay(); if (dayNum < 1 || dayNum > 5) return; }
    const open = safeNumber(bar.open), high = safeNumber(bar.high), low = safeNumber(bar.low), close = safeNumber(bar.close);
    if ([open, high, low, close].some((v) => v === null)) return;
    const period = getPeriodKeyAndLabel(date, profile);
    if (!grouped.has(period.key)) {
      grouped.set(period.key, { key: period.key, date: period.date, day: period.label, periodLabel: period.label, open, high, low, close, candleCount: 1 });
    } else {
      const existing = grouped.get(period.key);
      existing.high = Math.max(existing.high, high);
      existing.low = Math.min(existing.low, low);
      existing.close = close;
      existing.candleCount += 1;
    }
  });
  return Array.from(grouped.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function buildCsaAreas(levels = [], symbol = "", profile = getSupportedCsaTimeframeProfile("H1")) {
  const areas = [];
  levels.forEach((period, index) => {
    const label = period.periodLabel || period.day || period.key;
    if (index === 0) {
      areas.push({ day: label, period: label, date: period.date, type: "resistance", price: period.high, priceText: formatPrice(period.high) });
      areas.push({ day: label, period: label, date: period.date, type: "support", price: period.low, priceText: formatPrice(period.low) });
      return;
    }
    const previous = levels[index - 1];
    const highComparison = compareHighWithTolerance(period.high, previous.high, symbol);
    const lowComparison = compareLowWithTolerance(period.low, previous.low, symbol);
    areas.push({ day: label, period: label, date: period.date, type: highComparison.cleanBreak ? "resistance" : "supply", price: period.high, priceText: formatPrice(period.high), comparison: highComparison });
    areas.push({ day: label, period: label, date: period.date, type: lowComparison.cleanBreak ? "support" : "demand", price: period.low, priceText: formatPrice(period.low), comparison: lowComparison });
  });
  return areas;
}


function calculateCsaDirectionalBias(levels = [], symbol = "", profile = getSupportedCsaTimeframeProfile("H1")) {
  if (!Array.isArray(levels) || levels.length < 2) {
    return {
      bias: "Insufficient data",
      biasCode: "insufficient",
      confidence: "low",
      traderBias: "Not enough market data to form a reliable direction.",
      higherTimeframeView: "Not enough market data to compare the key highs, lows, and closes.",
      timeframeView: "Not enough chart data.",
      reason: `At least two ${profile.sourceUnitPlural} are needed.`,
      periodStartPrice: null,
      presentPrice: null,
      periodHigh: null,
      periodLow: null,
      priceMove: null,
      movePercentOfRange: null,
      highBreakCount: 0,
      lowBreakCount: 0,
      risingCloses: 0,
      fallingCloses: 0,
      rangeScore: 0,
    };
  }

  const first = levels[0];
  const last = levels[levels.length - 1];
  const periodStartPrice = Number(first.open);
  const presentPrice = Number(last.close);
  const periodHigh = Math.max(...levels.map((item) => Number(item.high)));
  const periodLow = Math.min(...levels.map((item) => Number(item.low)));
  const fullRange = Math.max(Math.abs(periodHigh - periodLow), getCleanBreakTolerance(symbol));
  const priceMove = presentPrice - periodStartPrice;
  const movePercentOfRange = Math.abs(priceMove) / fullRange;

  const anchorHigh = Number(first.high);
  const anchorLow = Number(first.low);
  const anchorRange = Math.max(Math.abs(anchorHigh - anchorLow), getCleanBreakTolerance(symbol));
  const anchorPositionPercent = Number.isFinite(presentPrice) && Number.isFinite(anchorHigh) && Number.isFinite(anchorLow)
    ? ((presentPrice - anchorLow) / anchorRange) * 100
    : null;
  const anchorLabel = first.periodLabel || first.day || first.key || "the first key range";
  let rangePositionNote = "Price position inside the first key range is not clear.";
  if (Number.isFinite(anchorPositionPercent)) {
    if (presentPrice > anchorHigh + getCleanBreakTolerance(symbol)) {
      rangePositionNote = `Price is above ${anchorLabel} resistance around ${formatPrice(anchorHigh)}, which shows bullish breakout pressure.`;
    } else if (presentPrice < anchorLow - getCleanBreakTolerance(symbol)) {
      rangePositionNote = `Price is below ${anchorLabel} support around ${formatPrice(anchorLow)}, which shows bearish breakout pressure.`;
    } else if (anchorPositionPercent >= 61.8) {
      rangePositionNote = `Price is in the upper part of ${anchorLabel}'s range, closer to resistance around ${formatPrice(anchorHigh)}.`;
    } else if (anchorPositionPercent <= 38.2) {
      rangePositionNote = `Price is in the lower part of ${anchorLabel}'s range, closer to support around ${formatPrice(anchorLow)}.`;
    } else {
      rangePositionNote = `Price is around the middle of ${anchorLabel}'s range, between support around ${formatPrice(anchorLow)} and resistance around ${formatPrice(anchorHigh)}.`;
    }
  }

  let highBreakCount = 0;
  let lowBreakCount = 0;
  let risingCloses = 0;
  let fallingCloses = 0;
  let insideOrOverlapCount = 0;

  for (let i = 1; i < levels.length; i += 1) {
    const highBreak = compareHighWithTolerance(levels[i].high, levels[i - 1].high, symbol).cleanBreak;
    const lowBreak = compareLowWithTolerance(levels[i].low, levels[i - 1].low, symbol).cleanBreak;

    if (highBreak) highBreakCount += 1;
    if (lowBreak) lowBreakCount += 1;
    if (!highBreak && !lowBreak) insideOrOverlapCount += 1;

    if (Number(levels[i].close) > Number(levels[i - 1].close)) risingCloses += 1;
    if (Number(levels[i].close) < Number(levels[i - 1].close)) fallingCloses += 1;
  }

  let bullishScore = 0;
  let bearishScore = 0;
  let rangeScore = 0;

  if (priceMove > 0) bullishScore += 1;
  if (priceMove < 0) bearishScore += 1;

  if (movePercentOfRange >= 0.55 && priceMove > 0) bullishScore += 2;
  if (movePercentOfRange >= 0.55 && priceMove < 0) bearishScore += 2;
  if (movePercentOfRange < 0.35) rangeScore += 2;

  if (highBreakCount > lowBreakCount) bullishScore += 1.5;
  if (lowBreakCount > highBreakCount) bearishScore += 1.5;
  if (highBreakCount === lowBreakCount) rangeScore += 1;

  if (risingCloses > fallingCloses) bullishScore += 1;
  if (fallingCloses > risingCloses) bearishScore += 1;
  if (Math.abs(risingCloses - fallingCloses) <= 1) rangeScore += 1;

  if (insideOrOverlapCount >= Math.max(1, Math.floor((levels.length - 1) / 2))) rangeScore += 1.5;

  const nearHigh = (periodHigh - presentPrice) / fullRange <= 0.25;
  const nearLow = (presentPrice - periodLow) / fullRange <= 0.25;
  if (nearHigh && priceMove > 0) bullishScore += 0.75;
  if (nearLow && priceMove < 0) bearishScore += 0.75;
  if (!nearHigh && !nearLow) rangeScore += 0.75;

  let bias = "Range-bound";
  let biasCode = "range";
  let traderBias = "The bigger-picture view is mostly sideways.";
  let confidence = "medium";

  const scoreDifference = Math.abs(bullishScore - bearishScore);

  if (rangeScore >= Math.max(bullishScore, bearishScore) || scoreDifference < 1.25) {
    if (bearishScore > bullishScore + 0.25) {
      bias = "Range-bound with bearish pressure";
      biasCode = "range_bearish";
      traderBias = "The bigger-picture view is mostly sideways, but sellers have slightly more pressure.";
    } else if (bullishScore > bearishScore + 0.25) {
      bias = "Range-bound with bullish pressure";
      biasCode = "range_bullish";
      traderBias = "The bigger-picture view is mostly sideways, but buyers have slightly more pressure.";
    }
    confidence = rangeScore >= 3 ? "medium" : "low";
  } else if (bullishScore > bearishScore) {
    bias = scoreDifference >= 3 && movePercentOfRange >= 0.45 ? "Bullish" : "Slightly bullish";
    biasCode = scoreDifference >= 3 && movePercentOfRange >= 0.45 ? "bullish" : "slightly_bullish";
    traderBias = bias === "Bullish"
      ? "The bigger-picture view is bullish."
      : "The bigger-picture view leans bullish, but it is not a clean one-way move.";
    confidence = scoreDifference >= 3 ? "high" : "medium";
  } else {
    bias = scoreDifference >= 3 && movePercentOfRange >= 0.45 ? "Bearish" : "Slightly bearish";
    biasCode = scoreDifference >= 3 && movePercentOfRange >= 0.45 ? "bearish" : "slightly_bearish";
    traderBias = bias === "Bearish"
      ? "The bigger-picture view is bearish."
      : "The bigger-picture view leans bearish, but it is not a clean one-way move.";
    confidence = scoreDifference >= 3 ? "high" : "medium";
  }

  if (String(biasCode || "").includes("range") && Number.isFinite(anchorPositionPercent)) {
    if (anchorPositionPercent <= 38.2) {
      bias = "Range-bound with bearish pressure";
      biasCode = "range_bearish";
      traderBias = "The bigger-picture view is mostly sideways, but price is trading in the lower part of the first key range, so sellers have pressure for now.";
    } else if (anchorPositionPercent >= 61.8) {
      bias = "Range-bound with bullish pressure";
      biasCode = "range_bullish";
      traderBias = "The bigger-picture view is mostly sideways, but price is trading in the upper part of the first key range, so buyers have pressure for now.";
    }
  }

  const structureLabelForUsers =
    profile.structureMode === "daily-in-week"
      ? "this week's daily highs, lows, and closes"
      : profile.structureMode === "weekly-in-month"
      ? "this month's weekly highs, lows, and closes"
      : profile.structureMode === "monthly-in-year"
      ? "this year's monthly highs, lows, and closes"
      : profile.structureMode === "quarterly-in-year"
      ? "this year's quarterly highs, lows, and closes"
      : "the higher-timeframe highs, lows, and closes";

  const higherTimeframeView =
    `${traderBias} This is based on ${structureLabelForUsers}. ` +
    `Price opened around ${formatPrice(periodStartPrice)} and is now around ${formatPrice(presentPrice)}. ` +
    `The high of the reviewed period is ${formatPrice(periodHigh)} and the low is ${formatPrice(periodLow)}. ` +
    `${rangePositionNote} ` +
    `Daily/period closes were mixed: ${risingCloses} higher close(s), ${fallingCloses} lower close(s).`;

  const timeframeView =
    `The uploaded ${profile.selectedTimeframe || ""} chart should be read as the execution view. ` +
    `A short-term move on the uploaded chart can be bullish or bearish, but it should still be compared with the bigger-picture view above.`;

  return {
    bias,
    biasCode,
    confidence,
    traderBias,
    higherTimeframeView,
    timeframeView,
    periodStartPrice,
    presentPrice,
    periodHigh,
    periodLow,
    priceMove,
    movePercentOfRange,
    resistanceCount: highBreakCount,
    supportCount: lowBreakCount,
    risingCloses,
    fallingCloses,
    highBreakCount,
    lowBreakCount,
    bullishScore,
    bearishScore,
    rangeScore,
    anchorHigh,
    anchorLow,
    anchorLabel,
    anchorPositionPercent,
    rangePositionNote,
    reason: higherTimeframeView,
  };
}

async function fetchTwelveDataStructureLevels({ symbol, chartDate, timeframe = "H1", timezone = "UTC", analysisType = "post-trade" }) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const profile = getSupportedCsaTimeframeProfile(timeframe);
  const empty = (error, range = null) => ({ ok: false, error, dailyLevels: [], csaAreas: [], directionalBias: calculateCsaDirectionalBias([], symbol, profile), rawCandleCount: 0, weekRange: range, symbol, timezone, interval: profile.interval, profile });
  if (!apiKey) return empty("TWELVE_DATA_API_KEY is missing on the server.");
  if (!symbol) return empty("Instrument/pair is missing or unsupported.");
  if (!chartDate) return empty("Final visible chart date is missing.");
  const structureRange = getStructureRangeForProfile(chartDate, profile, analysisType);
  const params = new URLSearchParams({ symbol, interval: profile.interval, start_date: `${structureRange.startDate} 00:00:00`, end_date: `${structureRange.endDate} 23:59:59`, timezone, order: "ASC", outputsize: getOutputSizeForInterval(profile.interval), apikey: apiKey });
  const response = await fetch(`${TWELVE_DATA_BASE_URL}?${params.toString()}`);
  const data = await response.json();
  if (!response.ok || data.status === "error" || !Array.isArray(data.values)) return { ...empty(data.message || data.error || `Twelve Data request failed with status ${response.status}.`, structureRange), twelveDataStatus: data.status || "unknown" };
  const rawCandles = data.values || [];
  const dailyLevels = buildStructureLevelsFromCandles(rawCandles, structureRange, profile);
  const csaAreas = buildCsaAreas(dailyLevels, symbol, profile);
  const directionalBias = calculateCsaDirectionalBias(dailyLevels, symbol, profile);
  return { ok: dailyLevels.length > 0, error: dailyLevels.length > 0 ? "" : `No usable ${profile.sourceUnitPlural} were returned.`, dailyLevels, csaAreas, directionalBias, rawCandleCount: rawCandles.length, weekRange: structureRange, symbol, timezone, interval: profile.interval, profile };
}

function areaBrokenByCloseLater(area, levels = [], symbol = "") {
  if (!area || !Array.isArray(levels)) return false;
  const level = Number(area.price), tol = getCleanBreakTolerance(symbol);
  if (!Number.isFinite(level)) return false;
  const laterPeriods = levels.filter((item) => String(item.date || "") > String(area.date || ""));
  if (area.type === "supply" || area.type === "resistance") return laterPeriods.some((item) => Number(item.close) > level + tol);
  if (area.type === "demand" || area.type === "support") return laterPeriods.some((item) => Number(item.close) < level - tol);
  return false;
}

function filterValidAreas(areaList = [], levels = [], symbol = "") { return areaList.filter((area) => !areaBrokenByCloseLater(area, levels, symbol)); }
function filterBrokenAreas(areaList = [], levels = [], symbol = "") { return areaList.filter((area) => areaBrokenByCloseLater(area, levels, symbol)); }
function splitAreas(areas = []) { return { resistanceAreas: areas.filter((a) => a.type === "resistance"), supportAreas: areas.filter((a) => a.type === "support"), supplyAreas: areas.filter((a) => a.type === "supply"), demandAreas: areas.filter((a) => a.type === "demand") }; }
function areaLabel(area) { const period = area?.day || area?.period || area?.date || "Unknown period"; return `${period} ${area?.type || "area"} around ${area?.priceText || formatPrice(Number(area?.price))}`; }

function describeFailedArea(area) {
  const label = areaLabel(area);
  if (area.type === "support") return `${label} failed because price later closed below it.`;
  if (area.type === "demand") return `${label} failed because price later closed below demand.`;
  if (area.type === "resistance") return `${label} failed because price later closed above it.`;
  if (area.type === "supply") return `${label} failed because price later closed above supply.`;
  return `${label} failed because price closed through it.`;
}

function buildFailedAreas({ supportAreas = [], resistanceAreas = [], supplyAreas = [], demandAreas = [], levels = [], symbol = "" }) {
  const mapArea = (area, failedType, mistakeLabel, newRole) => ({ ...area, failedType, mistakeLabel, newRole, explanation: describeFailedArea(area) });
  return [
    ...filterBrokenAreas(supportAreas, levels, symbol).map((area) => mapArea(area, "failed_support", "Failed support area", "Can become resistance if retested from below")),
    ...filterBrokenAreas(demandAreas, levels, symbol).map((area) => mapArea(area, "failed_demand", "Failed demand area", "Invalid as demand until reclaimed")),
    ...filterBrokenAreas(resistanceAreas, levels, symbol).map((area) => mapArea(area, "failed_resistance", "Failed resistance area", "Can become support if retested from above")),
    ...filterBrokenAreas(supplyAreas, levels, symbol).map((area) => mapArea(area, "failed_supply", "Failed supply area", "Invalid as supply until price loses it again")),
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.failedType || "").localeCompare(String(b.failedType || "")));
}

function listAreas(areaList = [], label = "area", max = 3) {
  if (!Array.isArray(areaList) || !areaList.length) return "- None identified.";
  return [...areaList].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, max).map((area) => `- ${area.day} ${label}: ${area.priceText}`).join("\n");
}

function listFailedAreas(failedAreas = [], max = 6) {
  if (!Array.isArray(failedAreas) || !failedAreas.length) return "- None detected.";
  return failedAreas.slice(0, max).map((area) => `- ${area.mistakeLabel}: ${area.explanation}`).join("\n");
}

function simpleFailedAreaTitle(area) {
  const type = String(area?.type || "area").toLowerCase();
  if (type === "support") return "Failed support area";
  if (type === "demand") return "Failed demand area";
  if (type === "resistance") return "Failed resistance area";
  if (type === "supply") return "Failed supply area";
  return "Failed CSA area";
}

function buildFrameworkMistakeHub({ failedAreas = [], hasConfirmedTrigger = false, rejectedContext = null, mixedBias = false, marketOk = true, entryAccuracyScore = 0, riskManagementScore = 0 }) {
  const items = [];
  const add = (title, tag) => { if (title && !items.some((item) => item.title.toLowerCase() === String(title).toLowerCase())) items.push(makeSimpleMistake(title, tag)); };
  if (!marketOk) add("Market data unavailable", "DATA ISSUE");
  if (!hasConfirmedTrigger) add("No visible trigger", "REVIEW");
  if (rejectedContext && !hasConfirmedTrigger) add("Context only, no trigger", "DISCIPLINE");
  if (mixedBias) add("Unclear structure", "STRUCTURAL");
  failedAreas.slice(0, 4).forEach((area) => add(simpleFailedAreaTitle(area), "STRUCTURAL"));
  if (Number(entryAccuracyScore) > 0 && Number(entryAccuracyScore) < 50) add("Entry evidence weak", "WARNING");
  if (Number(riskManagementScore) > 0 && Number(riskManagementScore) < 55) add("Risk evidence unclear", "REVIEW");
  if (!items.length) add("No major mistake detected", "REVIEW");
  return items.slice(0, 5);
}

async function detectChartContextFromImage({ imageBase64, mimeType, submittedInstrument = "", selectedTimeframe = "", selectedDateText = "", analysisType = "post-trade" }) {
  const fallback = (reason) => ({ ok: false, isTradingChart: false, chartValidityReason: reason, hasUsablePriceData: false, visibleCandleCount: 0, chartDataQuality: "unclear", chartOccupancyPercent: 0, isNestedChart: false, isChartReadableAtCurrentSize: false, selectedDateVisible: false, insufficientDataReason: reason, detectedInstrument: null, detectedTimeframe: null, latestVisibleDate: null, dateConfidence: "low", visibleTrigger: null, rejectedTriggerContext: null, triggerDirection: null, triggerConfidence: "low", notes: reason, raw: "" });
  if (!process.env.OPENAI_API_KEY) return fallback("OPENAI_API_KEY is missing.");

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        { role: "system", content: CHART_DETECTION_PROMPT },
        { role: "user", content: [
          { type: "input_text", text: `Inspect this uploaded chart image.\nSelected instrument: ${submittedInstrument || "not provided"}\nSelected timeframe: ${selectedTimeframe || "not provided"}\nSelected chart/trade date: ${selectedDateText || "not provided"}\nAnalysis type: ${analysisType || "post-trade"}\nReturn only JSON.` },
          { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}` },
        ]},
      ],
      max_output_tokens: 700,
    });

    const parsed = extractJsonObject(response.output_text || "");
    if (!parsed) return fallback("Chart validation did not return usable JSON.");
    const isTradingChart = parsed?.isTradingChart === true;
    const rawTrigger = parsed?.visibleTrigger || null;
    const triggerConfidence = parsed?.triggerConfidence || "low";
    const cleanTrigger = sanitizeVisibleTrigger(rawTrigger, triggerConfidence);
    const visibleCandleCount = Number.isFinite(Number(parsed?.visibleCandleCount)) ? Number(parsed.visibleCandleCount) : 0;
    const quality = isTradingChart ? parsed?.chartDataQuality || "usable" : "unclear";

    return {
      ok: true,
      isTradingChart,
      chartValidityReason: parsed?.chartValidityReason || (isTradingChart ? "The uploaded image appears to be a valid trading chart." : "The uploaded image does not appear to be a valid financial trading chart."),
      hasUsablePriceData: isTradingChart ? parsed?.hasUsablePriceData !== false : false,
      visibleCandleCount,
      chartDataQuality: quality,
      chartOccupancyPercent: Number.isFinite(Number(parsed?.chartOccupancyPercent))
        ? Math.max(0, Math.min(100, Number(parsed.chartOccupancyPercent)))
        : 0,
      isNestedChart: parsed?.isNestedChart === true,
      isChartReadableAtCurrentSize: parsed?.isChartReadableAtCurrentSize === true,
      selectedDateVisible: isTradingChart ? parsed?.selectedDateVisible === true : false,
      insufficientDataReason: parsed?.insufficientDataReason || (!isTradingChart ? "The uploaded image is not a financial trading chart." : null),
      detectedInstrument: isTradingChart ? parsed?.detectedInstrument || null : null,
      detectedTimeframe: isTradingChart ? parsed?.detectedTimeframe || null : null,
      latestVisibleDate: isTradingChart ? parsed?.latestVisibleDate || null : null,
      dateConfidence: isTradingChart ? parsed?.dateConfidence || "low" : "low",
      visibleTrigger: isTradingChart ? cleanTrigger : null,
      rejectedTriggerContext: isTradingChart && rawTrigger && !cleanTrigger ? rawTrigger : null,
      triggerDirection: isTradingChart && cleanTrigger ? parsed?.triggerDirection || null : null,
      triggerConfidence: isTradingChart && cleanTrigger ? triggerConfidence : "low",
      notes: parsed?.notes || "",
      raw: response.output_text || "",
    };
  } catch (error) {
    console.error("Chart detection error:", error);
    return fallback(`Chart validation failed: ${error.message}`);
  }
}

function isUploadedChartDataUsable(chartDetection, selectedDateText = "") {
  if (!chartDetection?.isTradingChart) return false;

  const quality = String(chartDetection.chartDataQuality || "").toLowerCase();
  if (["blank", "insufficient", "unreadable", "nested"].includes(quality)) return false;

  if (chartDetection.isNestedChart === true) return false;
  if (chartDetection.isChartReadableAtCurrentSize === false) return false;

  const occupancy = Number(chartDetection.chartOccupancyPercent || 0);
  if (Number.isFinite(occupancy) && occupancy > 0 && occupancy < 60) return false;

  if (chartDetection.hasUsablePriceData === false) return false;

  const candles = Number(chartDetection.visibleCandleCount || 0);
  if (Number.isFinite(candles) && candles > 0 && candles < 15) return false;

  return true;
}

function getDaysBetweenDates(earlierDate, laterDate) {
  if (!earlierDate || !laterDate) return null;
  const earlier = Date.UTC(earlierDate.getUTCFullYear(), earlierDate.getUTCMonth(), earlierDate.getUTCDate());
  const later = Date.UTC(laterDate.getUTCFullYear(), laterDate.getUTCMonth(), laterDate.getUTCDate());
  const diff = Math.round((later - earlier) / 86400000);
  return Number.isFinite(diff) ? diff : null;
}

function getAllowedFutureDateGapDays(timeframe = "") {
  const tf = comparableTimeframe(timeframe);
  if (["M1", "M5", "M15", "M30", "H1"].includes(tf)) return 3;
  if (tf === "H4") return 10;
  if (tf === "D1") return 45;
  if (tf === "W1") return 120;
  if (tf === "MN") return 400;
  return 3;
}

function getSelectedDateMismatch(chartDetection, selectedDate, timeframe = "") {
  if (!selectedDate || !chartDetection?.latestVisibleDate) return { hasMismatch: false };
  const latestVisibleDate = parseISODateOnly(chartDetection.latestVisibleDate);
  if (!latestVisibleDate) return { hasMismatch: false };
  const daysAfterLatestVisible = getDaysBetweenDates(latestVisibleDate, selectedDate);
  const allowedGapDays = getAllowedFutureDateGapDays(timeframe);
  const confidence = String(chartDetection.dateConfidence || "low").toLowerCase();
  const hasMismatch = ["high", "medium"].includes(confidence) && Number.isFinite(daysAfterLatestVisible) && daysAfterLatestVisible > allowedGapDays;
  return { hasMismatch, selectedDateText: formatDateOnly(selectedDate), latestVisibleDateText: formatDateOnly(latestVisibleDate), daysAfterLatestVisible, allowedGapDays, dateConfidence: confidence || "low", reason: hasMismatch ? `Selected date is ${daysAfterLatestVisible} day(s) after the latest visible chart date, beyond the allowed ${allowedGapDays} day(s).` : "Selected date is not clearly beyond the latest visible chart date." };
}

function isUsableChartDateDetection(detection) {
  if (!detection || !detection.latestVisibleDate) return false;
  if (!parseISODateOnly(detection.latestVisibleDate)) return false;
  const confidence = String(detection.dateConfidence || "").toLowerCase();
  return confidence === "high" || confidence === "medium";
}

function chooseFinalChartDate({ selectedDate, detection }) {
  const detectedDate = isUsableChartDateDetection(detection) ? parseISODateOnly(detection.latestVisibleDate) : null;
  if (selectedDate) return { finalDate: selectedDate, finalDateText: formatDateOnly(selectedDate), selectedDateText: formatDateOnly(selectedDate), detectedDateText: detectedDate ? formatDateOnly(detectedDate) : null, source: "user-selected-date", reason: "User-selected chart/trade date was used." };
  if (detectedDate) return { finalDate: detectedDate, finalDateText: formatDateOnly(detectedDate), selectedDateText: null, detectedDateText: formatDateOnly(detectedDate), source: "chart-detected-date", reason: "No user-selected date was provided, so the chart-detected latest visible date was used." };
  return { finalDate: null, finalDateText: "Not provided", selectedDateText: null, detectedDateText: null, source: "missing-date", reason: "No usable date was available." };
}


function buildCsaFrameworkSummaryForVision(marketReference = {}) {
  const profile = marketReference?.profile || {};
  const levels = Array.isArray(marketReference?.dailyLevels) ? marketReference.dailyLevels : [];
  const areas = Array.isArray(marketReference?.csaAreas) ? marketReference.csaAreas : [];
  const bias = marketReference?.directionalBias || {};

  const levelLines = levels.slice(0, 12).map((level) => {
    const label = level.periodLabel || level.day || level.key || level.date;
    return `- ${label}: open ${formatPrice(level.open)}, high ${formatPrice(level.high)}, low ${formatPrice(level.low)}, close ${formatPrice(level.close)}`;
  });

  const areaLines = areas.slice(0, 20).map((area) => {
    const userType =
      area.type === "resistance" || area.type === "supply"
        ? "possible selling area"
        : "possible buying area";
    return `- ${area.day || area.period || area.date}: ${userType} around ${area.priceText || formatPrice(area.price)}`;
  });

  return [
    `Internal structure source: ${profile.structureLabel || "Not available"}`,
    `Reviewed range: ${marketReference?.weekRange ? `${marketReference.weekRange.startDate} to ${marketReference.weekRange.endDate}` : "Not available"}`,
    `Bigger-picture direction: ${bias.bias || "Not available"} (${bias.confidence || "low"} confidence)`,
    `Plain-language direction note: ${bias.higherTimeframeView || bias.reason || "Not available"}`,
    "",
    "Key highs/lows/closes:",
    levelLines.length ? levelLines.join("\n") : "- No levels available.",
    "",
    "Important support/resistance areas, stated in simple language:",
    areaLines.length ? areaLines.join("\n") : "- No areas available.",
  ].join("\n");
}

function visualFallback(reason) {
  return {
    ok: false,
    frameworkMatch: "not reviewed",
    visualChartStyle: "not reviewed",
    csaLevelVisibility: "not reviewed",
    chartMarkingStatus: "unclear",
    visibleMarkedLevels: [],
    csaSimilarities: [],
    csaDifferences: [],
    chartSpecificStrengths: [],
    chartSpecificWeaknesses: [reason],
    simpleMistakeHub: [],
    setupQualityScore: null,
    entryAccuracyScore: null,
    riskManagementScore: null,
    visualSummary: reason,
    chartMarkupAssessment: "",
    entryEvidence: "",
    riskEvidence: "",
    raw: "",
  };
}

function isBadVisualReview(parsed) {
  const text = [parsed?.visualSummary, parsed?.chartMarkupAssessment, parsed?.entryEvidence, parsed?.riskEvidence, ...(Array.isArray(parsed?.chartSpecificWeaknesses) ? parsed.chartSpecificWeaknesses : [])].join(" ").toLowerCase();
  return text.includes("insufficient chart data") || text.includes("uploaded image appears to be a trading chart, but") || text.includes("not enough visible price data");
}


async function compareUploadedChartWithCsaFramework({
  imageBase64,
  mimeType,
  marketReference,
  chartDetection,
  submittedInstrument = "",
  timeframe = "",
  analysisType = "post-trade",
  submittedNotes = "",
  analysisFramework = "csa",
  personalStrategySnapshot = null,
}) {
  if (!process.env.OPENAI_API_KEY) return visualFallback("OPENAI_API_KEY is missing.");
  if (!marketReference?.ok) return visualFallback("Market structure was unavailable, so visual comparison could not be completed.");
  if (!imageBase64) return visualFallback("Uploaded chart image was not available for visual comparison.");

  const prompt = `
You are CSA Coach's beginner-friendly trade review assistant.
Return ONLY valid JSON. Do not use markdown.

Your job:
- FIRST classify the uploaded chart as MARKED, UNMARKED, or UNCLEAR before giving any feedback.
- Then review the uploaded chart using the internal support/resistance framework below.
- The main purpose is to compare what is visibly marked on the uploaded chart with the internal support/resistance areas and identify similarities and differences.

STRICT MARKED/UNMARKED RULE:
- MARKED means the uploaded image clearly contains user-drawn support/resistance evidence such as horizontal lines, rectangles, shaded zones, or labels that identify trading levels.
- UNMARKED means there is no clear user-drawn support/resistance evidence.
- Do NOT treat grid lines, current-price lines, bid/ask lines, order lines, crosshair lines, chart borders, session separators, or AI/backend-calculated levels as user-marked support/resistance.
- Before claiming that support or resistance is visible, describe the exact visible object that proves it.
- If no such object can be identified, the chart MUST be classified as UNMARKED.
- For an UNMARKED chart, explicitly say: "There is no visible evidence of user-marked support or resistance on this chart."
- After that, explain the important areas calculated by the internal framework using simple wording such as: "However, the main areas to watch are support around X and resistance around Y."
- Never list "support and resistance are clearly marked" as a strength on an unmarked chart.
- For a MARKED chart, compare the visible user-marked areas with the internal areas:
  - Similarities: where the user's marked area matches or closely overlaps the internal area.
  - Differences: missing areas, inaccurate placement, levels that do not align, or key framework areas not marked.
- If the chart is unclear, do not guess. Use UNCLEAR and state what cannot be verified.
- The user is likely a beginner. Use very simple trading language.
- The backend can use the internal method, but user-facing fields must NOT say "CSA", "framework", "daily high/low logic", "supply/demand classification", or other internal method words.
- Do not mention trendlines, channels, Fibonacci, indicators, or moving averages. They are outside this review. Ignore them unless they hide price.
- Explain only what matters to a beginner:
  1. Is the bigger picture bullish, bearish, or ranging?
  2. What is the selected ${timeframe} chart doing right now?
  3. Should the trader wait, buy, sell, or avoid chasing?
  4. Where exactly should price return before a better setup forms? Always include support/resistance and the price level.
  5. Is there a clear entry confirmation?
  6. Is stop loss/target visible enough to judge?
- The internal range-position check may use the first key high/low as a deep-pullback guide, but user-facing wording should stay simple.
- Do not mention Fibonacci, retracement percentages, 61.8, 50%, or technical confluence in user-facing feedback.
- When there are two possible entry areas, explain which one is better in beginner language: the closer area may be possible but may offer poor reward, while the deeper pullback area may be better because it gives price more room to move.
- Entry confirmation must match the trade direction: for a sell setup, wait for price to approach resistance and reject; for a buy setup, wait for price to approach support and hold.
- Do not write awkward phrases like "hold below support" or "hold above resistance." If support is broken, call it "previous support" and explain that a better sell entry needs a pullback and rejection from that area. If resistance is broken, call it "previous resistance" and explain that a better buy entry needs a pullback and hold from that area.
- A failed support/resistance area should be explained under market structure or best area to watch, not as the main warning.
- Main warning should focus on the trader's mistake to avoid: chasing price, selling too close to support, buying too close to resistance, entering without confirmation, or poor reward-to-risk.
- CSA is mainly a trend-trading strategy. If there is no clean trend yet, do not force a buy or sell. Give both sides: buy at support if it holds, or sell at resistance if it rejects.
- Never write incomplete advice like "wait for price to drop back" without saying the exact support/resistance area and price.
- Keep all user-facing answers short, plain, and useful.
- Return no more than 4 major strengths and no more than 4 major weaknesses.
- Each comment must contain one separate point only.
- Do not repeat the same idea using different wording.
- "No clear entry confirmation" means no valid entry trigger is visible.
- "Stop loss and target are not shown" is a separate risk-management issue.
- Do not write "no visible entry, stop loss, or target" as one combined weakness.
- A sideways, mixed, or unclear trend is market context, not automatically a weakness.
- Only call a middle-of-range entry a weakness when a visible or user-described entry was actually taken there.
- Internal level events such as "Monday resistance failed" or "Tuesday support broke" are market facts, not weaknesses.
- Framework support and resistance prices are guidance, not weaknesses.
- Use simple wording that a completely new trader can understand.
- Use the same wording for the same visible condition each time.
- Two different-looking charts must receive different strengths, weaknesses, mistake hub items, scores, and short-term chart direction.
- Do not invent entries, stop loss, targets, or mistakes if they are not visible.
- If stop loss or target is not visible, say "Stop loss and target are not shown, so the trade risk cannot be judged."
- If the bigger-picture view and uploaded chart timeframe disagree, state both clearly.
  Example: "The bigger picture is slightly bearish, but the ${timeframe} chart is pushing up short-term."
- Do not give financial advice or guaranteed predictions. This is only chart feedback.

Internal support/resistance framework:
${buildCsaFrameworkSummaryForVision(marketReference)}

Selected context:
- Instrument: ${submittedInstrument}
- Timeframe uploaded/selected: ${timeframe}
- Mode: ${analysisType}
- User notes: ${submittedNotes || "None"}

${analysisFramework === "personal_strategy" ? buildPersonalStrategyPrompt(personalStrategySnapshot) : ""}

Initial image validation:
- Detected instrument: ${chartDetection?.detectedInstrument || "not detected"}
- Detected timeframe: ${chartDetection?.detectedTimeframe || "not detected"}
- Latest visible date: ${chartDetection?.latestVisibleDate || "not detected"}
- Detected trigger: ${chartDetection?.visibleTrigger || "none confirmed"}

Return exactly this JSON shape:
{
  "frameworkMatch": "strong | partial | weak | not enough evidence",
  "visualChartStyle": "clear support/resistance | clean price action | marked chart | unmarked chart | unclear",
  "csaLevelVisibility": "clear | partial | not marked | unclear",
  "chartMarkingStatus": "marked | unmarked | unclear",
  "visibleMarkedLevels": [
    {
      "type": "support | resistance | zone | label",
      "description": "exact visible object proving the chart is marked",
      "approximatePrice": "price or null"
    }
  ],
  "csaSimilarities": ["simple similarity between visible chart markings and internal areas"],
  "csaDifferences": ["simple difference, missing area, or mismatch"],
  "shortTermDirection": "bullish | bearish | range-bound | range-bound with bullish pressure | range-bound with bearish pressure | unclear",
  "quickVerdict": "one very simple sentence saying wait, avoid chasing, or setup looks acceptable",
  "plainMarketDirection": "one simple sentence combining bigger-picture direction and ${timeframe} chart direction",
  "whatThisMeans": "one simple sentence explaining what the trader should understand from the chart",
  "timeframeSummary": "one simple sentence describing what the uploaded ${timeframe} chart is doing",
  "bestAreaToWatch": "one simple sentence saying exactly where price should return before a better setup, including support/resistance and price level",
  "visualSummary": "2 short beginner-friendly sentences. Mention bigger-picture direction and uploaded timeframe direction if different.",
  "chartMarkupAssessment": "simple comment about whether the important support/resistance areas are clear; do not mention trendlines/channels/indicators",
  "entryEvidence": "what entry evidence is visible, or 'No visible entry evidence'",
  "riskEvidence": "what stop-loss, target, or risk evidence is visible, or 'Stop loss and target are not shown, so the trade risk cannot be judged.'",
  "mainWarning": "one simple warning the trader should remember",
  "coachVerdict": "one short final verdict in beginner language",
  "chartSpecificStrengths": ["simple strength visible on this chart"],
  "chartSpecificWeaknesses": ["simple weakness visible on this chart"],
  "simpleMistakeHub": [
    { "title": "short mistake title", "tag": "HIGH RISK | WARNING | STRUCTURAL | MATH FLAW | DISCIPLINE | REVIEW" }
  ],
  "setupQualityScore": 50,
  "entryAccuracyScore": 50,
  "riskManagementScore": 50,
  "strategyMatchScore": 0,
  "strategyRulesFollowed": ["short rule followed"],
  "strategyRulesViolated": ["short rule violated"],
  "strategyMissingInformation": ["missing information"],
  "strategyVerdict": "Valid strategy setup | Partially follows strategy | Does not follow strategy | Not enough evidence"
}`;

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: prompt },
        { role: "user", content: [
          { type: "input_text", text: "Review this uploaded chart in simple beginner trader language using the internal support/resistance framework. Return only the required JSON." },
          { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}` },
        ]},
      ],
      max_output_tokens: 1500,
    });

    const parsed = extractJsonObject(response.output_text || "");
    if (!parsed || isBadVisualReview(parsed)) return visualFallback("Visual comparison was inconclusive, so market-structure fallback was used.");

    return {
      ok: true,
      frameworkMatch: parsed.frameworkMatch || "not enough evidence",
      visualChartStyle: parsed.visualChartStyle || "unclear",
      csaLevelVisibility: parsed.csaLevelVisibility || "unclear",
      chartMarkingStatus: ["marked", "unmarked", "unclear"].includes(
        String(parsed.chartMarkingStatus || "").toLowerCase()
      )
        ? String(parsed.chartMarkingStatus).toLowerCase()
        : String(parsed.csaLevelVisibility || "").toLowerCase() === "not marked"
        ? "unmarked"
        : "unclear",
      visibleMarkedLevels: Array.isArray(parsed.visibleMarkedLevels)
        ? parsed.visibleMarkedLevels.slice(0, 12)
        : [],
      csaSimilarities: normalizeArrayOfStrings(parsed.csaSimilarities, []).slice(0, 8),
      csaDifferences: normalizeArrayOfStrings(parsed.csaDifferences, []).slice(0, 8),
      shortTermDirection: parsed.shortTermDirection || "unclear",
      quickVerdict: String(parsed.quickVerdict || "").trim(),
      plainMarketDirection: String(parsed.plainMarketDirection || "").trim(),
      whatThisMeans: String(parsed.whatThisMeans || "").trim(),
      timeframeSummary: String(parsed.timeframeSummary || "").trim(),
      bestAreaToWatch: String(parsed.bestAreaToWatch || "").trim(),
      mainWarning: String(parsed.mainWarning || "").trim(),
      coachVerdict: String(parsed.coachVerdict || "").trim(),
      chartSpecificStrengths: normalizeArrayOfStrings(parsed.chartSpecificStrengths, []),
      chartSpecificWeaknesses: normalizeArrayOfStrings(parsed.chartSpecificWeaknesses, []),
      simpleMistakeHub: normalizeVisualMistakeItems(parsed.simpleMistakeHub),
      setupQualityScore: Number.isFinite(Number(parsed.setupQualityScore)) ? clampScore(Number(parsed.setupQualityScore)) : null,
      entryAccuracyScore: Number.isFinite(Number(parsed.entryAccuracyScore)) ? clampScore(Number(parsed.entryAccuracyScore)) : null,
      riskManagementScore: Number.isFinite(Number(parsed.riskManagementScore)) ? clampScore(Number(parsed.riskManagementScore)) : null,
      strategyMatchScore:
        analysisFramework === "personal_strategy" && Number.isFinite(Number(parsed.strategyMatchScore))
          ? clampScore(Number(parsed.strategyMatchScore))
          : null,
      strategyRulesFollowed:
        analysisFramework === "personal_strategy"
          ? normalizeArrayOfStrings(parsed.strategyRulesFollowed, [])
          : [],
      strategyRulesViolated:
        analysisFramework === "personal_strategy"
          ? normalizeArrayOfStrings(parsed.strategyRulesViolated, [])
          : [],
      strategyMissingInformation:
        analysisFramework === "personal_strategy"
          ? normalizeArrayOfStrings(parsed.strategyMissingInformation, [])
          : [],
      strategyVerdict:
        analysisFramework === "personal_strategy"
          ? String(parsed.strategyVerdict || "Not enough evidence").trim()
          : null,
      visualSummary: String(parsed.visualSummary || "").trim(),
      chartMarkupAssessment: String(parsed.chartMarkupAssessment || "").trim(),
      entryEvidence: String(parsed.entryEvidence || "").trim(),
      riskEvidence: String(parsed.riskEvidence || "").trim(),
      raw: response.output_text || "",
    };
  } catch (error) {
    console.error("Visual trade review error:", error);
    return visualFallback(`Visual trade review failed: ${error.message}`);
  }
}

function shouldUseVisualScore(score, marketOk) {
  const n = Number(score);
  if (!Number.isFinite(n)) return false;
  if (marketOk && n < 20) return false;
  return true;
}


function getChartMarkingStatus(visualReview = null) {
  const explicit = String(visualReview?.chartMarkingStatus || "").toLowerCase();
  if (["marked", "unmarked", "unclear"].includes(explicit)) return explicit;

  const visibility = String(visualReview?.csaLevelVisibility || "").toLowerCase();
  const style = String(visualReview?.visualChartStyle || "").toLowerCase();

  if (visibility === "not marked" || style.includes("unmarked")) return "unmarked";
  if (
    ["clear", "partial"].includes(visibility) ||
    style.includes("marked chart") ||
    style.includes("clear support")
  ) {
    return "marked";
  }
  return "unclear";
}

function isUnsupportedMarkedLevelClaim(text = "") {
  const value = String(text || "").toLowerCase();
  return (
    /support.*(marked|drawn|visible|shown|clear)/i.test(value) ||
    /resistance.*(marked|drawn|visible|shown|clear)/i.test(value) ||
    /(marked|drawn|visible|shown|clear).*(support|resistance|level|zone)/i.test(value)
  );
}

function normalizeFeedbackText(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function feedbackCategory(text = "") {
  const value = normalizeFeedbackText(text);

  if (
    /(no visible evidence|not marked|not drawn|no clear).*(support|resistance|level|zone)/.test(value) ||
    /(support|resistance|level|zone).*(not marked|not drawn|no clear|missing)/.test(value)
  ) return "levels_not_marked";

  if (
    /(no clear|not detected|missing).*(confirmation|trigger)/.test(value) ||
    /(confirmation|trigger).*(not clear|not visible|missing)/.test(value)
  ) return "entry_confirmation_missing";

  if (
    /(no visible|missing|not shown|cannot judge).*(stop loss|target|take profit|risk)/.test(value) ||
    /(stop loss|target|take profit|risk).*(not visible|missing|not shown|cannot be judged)/.test(value)
  ) return "risk_plan_missing";

  if (
    value.includes("entered in the middle of the range") ||
    value.includes("entry was taken in the middle of the range") ||
    value.includes("trade was taken in the middle of the range")
  ) return "middle_range_entry";

  if (
    value.includes("chart") &&
    (value.includes("unclear") || value.includes("too small") || value.includes("not readable"))
  ) return "chart_quality";

  return "";
}

function isFrameworkGuidanceNotWeakness(text = "") {
  const value = normalizeFeedbackText(text);
  return (
    value.startsWith("however the framework areas") ||
    value.includes("framework areas to watch") ||
    value.includes("areas to watch are support") ||
    value.includes("main areas to watch are support")
  );
}

function isMarketStructureFactNotWeakness(text = "") {
  const value = normalizeFeedbackText(text);
  const mentionsPeriod =
    /\b(monday|tuesday|wednesday|thursday|friday|week|month|quarter)\b/.test(value);
  const describesLevelEvent =
    value.includes("resistance failed") ||
    value.includes("support failed") ||
    value.includes("price later closed above") ||
    value.includes("price later closed below") ||
    value.includes("broke resistance") ||
    value.includes("broke support") ||
    value.includes("converted to support") ||
    value.includes("converted to resistance");
  return mentionsPeriod && describesLevelEvent;
}

function isActualWeakness(text = "") {
  const value = normalizeFeedbackText(text);
  if (!value) return false;
  if (isFrameworkGuidanceNotWeakness(value)) return false;
  if (isMarketStructureFactNotWeakness(value)) return false;
  if (feedbackCategory(value)) return true;

  return (
    value.includes("chasing") ||
    value.includes("too close to support") ||
    value.includes("too close to resistance") ||
    value.includes("poor risk") ||
    value.includes("risk is too") ||
    value.includes("entry is late") ||
    value.includes("setup is unclear") ||
    value.includes("trade plan is unclear") ||
    value.includes("against the bigger picture") ||
    value.includes("does not match")
  );
}

function simpleBeginnerFeedback(text = "") {
  let value = String(text || "").trim();
  if (!value) return "";

  value = value
    .replace(/\bconfluence\b/gi, "supporting evidence")
    .replace(/\binvalidation\b/gi, "the point where the setup is no longer valid")
    .replace(/\bdirectional bias\b/gi, "market direction")
    .replace(/\bmarket structure\b/gi, "price movement")
    .replace(/\brisk-to-reward\b/gi, "risk compared with possible reward");

  const sentences = value.match(/[^.!?]+[.!?]?/g) || [value];
  return sentences.slice(0, 2).join(" ").trim();
}

function removeDuplicateFeedback(items = [], limit = 4) {
  const seenExact = new Set();
  const seenCategories = new Set();
  const result = [];

  for (const originalItem of items) {
    const item = simpleBeginnerFeedback(originalItem);
    const normalized = normalizeFeedbackText(item);
    if (!normalized || seenExact.has(normalized)) continue;

    const category = feedbackCategory(item);
    if (category && seenCategories.has(category)) continue;

    seenExact.add(normalized);
    if (category) seenCategories.add(category);
    result.push(item);

    if (result.length >= limit) break;
  }

  return result;
}

function buildDashboardFeedback({
  marketReference,
  chartDetection,
  visualReview = null,
  submittedInstrument,
  timeframe,
  selectedDateText,
  detectedDateText,
  setupScore = 0,
}) {
  const profile =
    marketReference?.profile || getSupportedCsaTimeframeProfile(timeframe);
  const bias =
    marketReference?.directionalBias ||
    calculateCsaDirectionalBias(
      [],
      marketReference?.symbol || submittedInstrument,
      profile
    );

  const marketOk = Boolean(marketReference?.ok);
  const visualOk = Boolean(visualReview?.ok);
  const hasConfirmedTrigger = Boolean(chartDetection?.visibleTrigger);
  const chartMarkingStatus = getChartMarkingStatus(visualReview);

  const frameworkStrengths = [];
  const frameworkWeaknesses = [];

  if (chartDetection?.hasUsablePriceData) {
    frameworkStrengths.push(
      "The chart is clear enough to review the recent price movement."
    );
  }

  if (
    isDetectedInstrumentUsable(chartDetection?.detectedInstrument) &&
    isDetectedTimeframeUsable(chartDetection?.detectedTimeframe)
  ) {
    frameworkStrengths.push(
      "The instrument and timeframe are visible and match the selected chart details."
    );
  }

  if (marketOk) {
    frameworkStrengths.push(
      `The bigger-picture market direction was checked. Current view: ${bias.bias}.`
    );
  }

  if (!hasConfirmedTrigger) {
    frameworkWeaknesses.push(
      "No clear entry confirmation is visible on the chart."
    );
  }

  const riskEvidence = String(visualReview?.riskEvidence || "").trim();
  const riskEvidenceLower = riskEvidence.toLowerCase();
  const hasVisibleRiskPlan =
    riskEvidence &&
    !riskEvidenceLower.includes("not shown") &&
    !riskEvidenceLower.includes("not visible") &&
    !riskEvidenceLower.includes("cannot be judged") &&
    !riskEvidenceLower.includes("no visible");

  if (!hasVisibleRiskPlan) {
    frameworkWeaknesses.push(
      "Stop loss and target are not shown, so the trade risk cannot be judged."
    );
  }

  let visualStrengths = visualOk
    ? normalizeArrayOfStrings(visualReview.chartSpecificStrengths, [])
    : [];

  let visualWeaknesses = visualOk
    ? normalizeArrayOfStrings(visualReview.chartSpecificWeaknesses, [])
    : [];

  if (chartMarkingStatus === "unmarked") {
    visualStrengths = visualStrengths.filter(
      (item) => !isUnsupportedMarkedLevelClaim(item)
    );

    visualWeaknesses = visualWeaknesses.filter(
      (item) => feedbackCategory(item) !== "levels_not_marked"
    );

    visualWeaknesses.unshift(
      "There is no visible evidence of user-marked support or resistance on this chart."
    );
  }

  if (chartMarkingStatus === "marked") {
    normalizeArrayOfStrings(visualReview?.csaSimilarities, [])
      .slice(0, 2)
      .forEach((item) =>
        visualStrengths.push(`Framework similarity: ${item}`)
      );

    normalizeArrayOfStrings(visualReview?.csaDifferences, [])
      .slice(0, 2)
      .forEach((item) =>
        visualWeaknesses.push(`Framework difference: ${item}`)
      );
  }

  const strengths = removeDuplicateFeedback(
    [...frameworkStrengths, ...visualStrengths],
    4
  );

  const weaknesses = removeDuplicateFeedback(
    [
      ...visualWeaknesses.filter(isActualWeakness),
      ...frameworkWeaknesses.filter(isActualWeakness),
    ],
    4
  );

  const setupQualityScore = clampScore(
    Number.isFinite(Number(visualReview?.setupQualityScore))
      ? visualReview.setupQualityScore
      : setupScore
  );

  const entryAccuracyScore = clampScore(
    Number.isFinite(Number(visualReview?.entryAccuracyScore))
      ? visualReview.entryAccuracyScore
      : hasConfirmedTrigger
      ? 60
      : 30
  );

  const riskManagementScore = clampScore(
    Number.isFinite(Number(visualReview?.riskManagementScore))
      ? visualReview.riskManagementScore
      : hasVisibleRiskPlan
      ? 60
      : 30
  );

  return {
    strengths,
    weaknesses,
    aiMistakeDetectionHub: normalizeVisualMistakeItems(
      visualReview?.simpleMistakeHub || []
    ).slice(0, 4),
    setupQualityScore,
    entryAccuracyScore,
    riskManagementScore,
    setupQuality: {
      score: setupQualityScore,
      label: scoreLabel(setupQualityScore),
      summary:
        visualReview?.visualSummary ||
        "The setup was checked against the CSA framework.",
    },
    entryAccuracy: {
      score: entryAccuracyScore,
      label: scoreLabel(entryAccuracyScore),
      summary: hasConfirmedTrigger
        ? `Visible confirmation: ${chartDetection.visibleTrigger}.`
        : "No clear entry confirmation is visible on the chart.",
    },
    riskManagement: {
      score: riskManagementScore,
      label: scoreLabel(riskManagementScore),
      summary: hasVisibleRiskPlan
        ? riskEvidence
        : "Stop loss and target are not shown, so the trade risk cannot be judged.",
    },
    contextCheck: {
      selectedInstrument: submittedInstrument,
      selectedTimeframe: timeframe,
      selectedDate: selectedDateText,
      detectedInstrument: chartDetection?.detectedInstrument || null,
      detectedTimeframe: chartDetection?.detectedTimeframe || null,
      detectedDate: detectedDateText || null,
      chartMarkingStatus,
      csaLevelVisibility:
        visualReview?.csaLevelVisibility || "Not reviewed",
      visibleMarkedLevels: visualReview?.visibleMarkedLevels || [],
      csaSimilarities: visualReview?.csaSimilarities || [],
      csaDifferences: visualReview?.csaDifferences || [],
      chartContextScore: 100,
      status: "Chart verified",
    },
  };
}

function getBiasGroup(biasCode = "") {
  const code = String(biasCode || "").toLowerCase();

  if (code === "bullish" || code === "slightly_bullish") {
    return "bullish";
  }

  if (code === "bearish" || code === "slightly_bearish") {
    return "bearish";
  }

  if (code === "range_bullish") {
    return "range_bullish";
  }

  if (code === "range_bearish") {
    return "range_bearish";
  }

  return "range";
}

function buildBeginnerTrendPlan({ levels = [], areas = [], bias = {}, symbol = "", profile = getSupportedCsaTimeframeProfile("H1") }) {
  const currentPrice = Number(bias.presentPrice);
  const biasGroup = getBiasGroup(bias.biasCode);
  const initialStatus = getInitialRangeStatus(levels, symbol, profile);
  const initial = getInitialRangeAreas(levels, profile);

  // Core CSA trend-trading rule:
  // Until the first key high/low closes broken, do not use smaller internal levels
  // as the main entry areas. The active areas remain the first high and first low.
  // For H1/M15/M30/M5/M1 this means Monday high = resistance and Monday low = support.
  const useInitialRangeOnly = initialStatus.hasInitialRange && initialStatus.isStillInsideInitialRange;

  const buyCandidates = useInitialRangeOnly ? [] : getRankedEntryAreas({ areas, levels, symbol, direction: "buy", currentPrice, profile });
  const sellCandidates = useInitialRangeOnly ? [] : getRankedEntryAreas({ areas, levels, symbol, direction: "sell", currentPrice, profile });

  const buyArea = useInitialRangeOnly
    ? { label: initial.label, type: "support", price: initial.support, priceText: formatPrice(initial.support) }
    : (buyCandidates[0] || getNearestAreaForDirection({ areas, levels, symbol, direction: "buy", currentPrice, profile }));

  const sellArea = useInitialRangeOnly
    ? { label: initial.label, type: "resistance", price: initial.resistance, priceText: formatPrice(initial.resistance) }
    : (sellCandidates[0] || getNearestAreaForDirection({ areas, levels, symbol, direction: "sell", currentPrice, profile }));

  const nearestBuyArea = getNearestCandidate(buyCandidates, currentPrice);
  const nearestSellArea = getNearestCandidate(sellCandidates, currentPrice);
  const buyAreaComparison = formatAreaComparison({ direction: "buy", nearestArea: nearestBuyArea, betterArea: buyArea, symbol });
  const sellAreaComparison = formatAreaComparison({ direction: "sell", nearestArea: nearestSellArea, betterArea: sellArea, symbol });

  const initialSupportText = initialStatus.supportText || formatPrice(initial.support);
  const initialResistanceText = initialStatus.resistanceText || formatPrice(initial.resistance);
  const buyPriceText = buyArea.priceText || formatPrice(buyArea.price);
  const sellPriceText = sellArea.priceText || formatPrice(sellArea.price);

  let quickVerdict = "Wait for price to reach a clear area before taking action.";
  let whatThisMeans = "The safest plan is to wait for price to reach support or resistance, then look for a clear reaction.";
  let bestAreaToWatch = `Buy only if price drops to support around ${initialSupportText} and holds. Sell only if price rises to resistance around ${initialResistanceText} and rejects.`;
  let mainWarning = "Do not trade in the middle of the range. Wait for price to reach a clear support or resistance area first.";
  let coachVerdict = "This is a wait setup until price reaches one of the key areas and shows a clear reaction.";
  let preferredTrendSetup = "The preferred trend-trading setup is breakout, pullback, and retest.";

  if (useInitialRangeOnly) {
    quickVerdict = `Wait. Price is still inside ${initial.label}'s range.`;
    whatThisMeans = `${initialStatus.rangeMessage} This is not the preferred trend-trading setup yet.`;
    bestAreaToWatch = `For now, the only main areas are ${initial.label} support around ${initialSupportText} and ${initial.label} resistance around ${initialResistanceText}. A buy is only a possible rejection from support; a sell is only a possible rejection from resistance.`;
    mainWarning = `Do not use smaller internal levels as the main entry area yet. Wait for a close above ${initialResistanceText} or below ${initialSupportText}, then wait for a pullback/retest.`;
    coachVerdict = `Not recommended as a trend trade yet. Price needs to close above ${initial.label}'s high around ${initialResistanceText} or close below ${initial.label}'s low around ${initialSupportText} before the cleaner trend setup forms.`;
    preferredTrendSetup = `Preferred setup: close above ${initialResistanceText} then retest for buys, or close below ${initialSupportText} then retest for sells. Until then, only possible rejection trades exist at those two levels.`;
  } else if (biasGroup === "bullish") {
    quickVerdict = `Bullish plan: wait for price to pull back to support around ${buyPriceText} before considering a buy.`;
    whatThisMeans = `The better buy idea is not to chase price now, but to wait for price to drop back to support around ${buyPriceText} and hold.`;
    bestAreaToWatch = buyAreaComparison || `For a buy, wait for price to drop back to support around ${buyPriceText} and then show a clear bullish candle or strong rejection from that area.`;
    mainWarning = `Do not buy in the middle. Wait for the better support area around ${buyPriceText} or a fresh breakout-and-hold before considering a buy.`;
    coachVerdict = `The cleaner plan is to look for buys only after price holds the better support area around ${buyPriceText}.`;
  } else if (biasGroup === "bearish") {
    quickVerdict = `Bearish plan: wait for price to rise back to resistance around ${sellPriceText} before considering a sell.`;
    whatThisMeans = `The better sell idea is not to chase price now, but to wait for price to pull back up to resistance around ${sellPriceText} and reject.`;
    bestAreaToWatch = sellAreaComparison || `For a sell, wait for price to rise back to resistance around ${sellPriceText} and then show a clear bearish candle or strong rejection from that area.`;
    mainWarning = `Do not sell after price has already dropped. Wait for the better resistance area around ${sellPriceText} or a fresh breakdown-and-hold before considering a sell.`;
    coachVerdict = `The cleaner plan is to look for sells only after price rejects the better resistance area around ${sellPriceText}.`;
  } else if (biasGroup === "range_bullish") {
    quickVerdict = `No clean trend yet, but buyers have pressure. Buy only if price drops to support around ${initialSupportText} and holds.`;
    whatThisMeans = `Price is still inside the main range, so support around ${initialSupportText} and resistance around ${initialResistanceText} are the key areas for now.`;
    bestAreaToWatch = `Buy only if price drops to support around ${initialSupportText} and holds. Sell only if price rises to resistance around ${initialResistanceText} and rejects.`;
    mainWarning = `The market has not fully opened up yet. Do not chase; wait for support around ${initialSupportText} or resistance around ${initialResistanceText}.`;
    coachVerdict = `For now, treat this as a range with bullish pressure until price clearly closes above ${initialResistanceText} or below ${initialSupportText}.`;
  } else if (biasGroup === "range_bearish") {
    quickVerdict = `No clean trend yet, but sellers have pressure. Sell only if price rises to resistance around ${initialResistanceText} and rejects.`;
    whatThisMeans = `Price is still inside the main range, so support around ${initialSupportText} and resistance around ${initialResistanceText} are the key areas for now.`;
    bestAreaToWatch = `Buy only if price drops to support around ${initialSupportText} and holds. Sell only if price rises to resistance around ${initialResistanceText} and rejects.`;
    mainWarning = `The market has not fully opened up yet. Do not chase; wait for support around ${initialSupportText} or resistance around ${initialResistanceText}.`;
    coachVerdict = `For now, treat this as a range with bearish pressure until price clearly closes below ${initialSupportText} or above ${initialResistanceText}.`;
  }

  return {
    biasGroup,
    useInitialRangeOnly,
    initialRangeStatus: initialStatus,
    initialSupport: initial.support,
    initialResistance: initial.resistance,
    initialSupportText,
    initialResistanceText,
    buyArea,
    sellArea,
    nearestBuyArea,
    nearestSellArea,
    buyAreaComparison,
    sellAreaComparison,
    quickVerdict,
    whatThisMeans,
    bestAreaToWatch,
    mainWarning,
    coachVerdict,
    preferredTrendSetup,
  };
}


function extractPriceTextFromText(text = "") {
  const matches = String(text).match(/\b\d+(?:\.\d+)?\b/g);
  if (!matches || !matches.length) return "";
  return matches[matches.length - 1];
}

function buildVisibleTriggerConfirmation({ trigger = "", trendPlan = {} }) {
  const text = String(trigger || "").trim();
  if (!text) return "";

  const lower = text.toLowerCase();
  const biasGroup = String(trendPlan?.biasGroup || "").toLowerCase();
  const sellPriceText = extractPriceTextFromText(text) || trendPlan?.sellArea?.priceText || trendPlan?.initialResistanceText || "the resistance area";
  const buyPriceText = extractPriceTextFromText(text) || trendPlan?.buyArea?.priceText || trendPlan?.initialSupportText || "the support area";

  const isBearishBreak = /breakdown|break down|broke below|break below|closed below|close below|hold below|held below/.test(lower);
  const isBullishBreak = /breakout|break out|broke above|break above|closed above|close above|hold above|held above/.test(lower);

  // Do not describe a broken support as "hold below support" in user-facing text.
  // Once support has broken and price stays below it, explain it as previous support
  // and guide the trader to wait for a pullback/rejection instead of chasing.
  if (isBearishBreak || (biasGroup.includes("bearish") && lower.includes("below") && lower.includes("support"))) {
    return `No fresh sell confirmation is visible yet. Price has already broken below previous support around ${sellPriceText}, so the better sell confirmation would be a pullback toward that area and a rejection from it.`;
  }

  // Same idea for bullish breaks: once resistance has broken and price stays above it,
  // explain it as previous resistance and guide the trader to wait for a pullback/hold.
  if (isBullishBreak || (biasGroup.includes("bullish") && lower.includes("above") && lower.includes("resistance"))) {
    return `No fresh buy confirmation is visible yet. Price has already broken above previous resistance around ${buyPriceText}, so the better buy confirmation would be a pullback toward that area and a hold from it.`;
  }

  return `A possible confirmation is visible: ${text}`;
}

function buildEntryConfirmationText({ trendPlan = {}, chartDetection = null, visualReview = null }) {
  const biasGroup = String(trendPlan?.biasGroup || "").toLowerCase();
  const sellPriceText = trendPlan?.sellArea?.priceText || trendPlan?.initialResistanceText || "the resistance area";
  const buyPriceText = trendPlan?.buyArea?.priceText || trendPlan?.initialSupportText || "the support area";

  const hasVisibleTrigger = Boolean(chartDetection?.visibleTrigger);
  if (hasVisibleTrigger) {
    return buildVisibleTriggerConfirmation({ trigger: chartDetection.visibleTrigger, trendPlan });
  }

  // Do not let the visual model say "wait for support" during a sell-focused setup
  // or "wait for resistance" during a buy-focused setup. Entry confirmation should
  // match the active trade idea.
  if (biasGroup === "bearish" || biasGroup === "range_bearish") {
    return `No visible sell confirmation yet. A better sell setup would be if price pulls back toward resistance around ${sellPriceText} and rejects from there.`;
  }

  if (biasGroup === "bullish" || biasGroup === "range_bullish") {
    return `No visible buy confirmation yet. A better buy setup would be if price pulls back toward support around ${buyPriceText} and holds from there.`;
  }

  if (trendPlan?.useInitialRangeOnly) {
    return `No clear entry confirmation is visible yet. Wait for price to reach ${trendPlan.initialSupportText || buyPriceText} support or ${trendPlan.initialResistanceText || sellPriceText} resistance and show a clear reaction.`;
  }

  const visualText = String(visualReview?.entryEvidence || "").trim();
  if (visualText && !/support first|resistance first|hold below support|below support/i.test(visualText)) return visualText;

  return "No clear entry confirmation is visible yet. Wait for price to reach a clear support or resistance area first.";
}

function buildChartMarkingComparisonText({
  visualReview,
  trendPlan,
}) {
  const markingStatus = getChartMarkingStatus(visualReview);

  if (markingStatus === "marked") {
    const similarities = normalizeArrayOfStrings(
      visualReview?.csaSimilarities,
      []
    ).slice(0, 2);
    const differences = normalizeArrayOfStrings(
      visualReview?.csaDifferences,
      []
    ).slice(0, 2);

    const similarityText = similarities.length
      ? `Similarities: ${similarities.join(" ")}`
      : "No clear similarity with the framework areas was confirmed.";

    const differenceText = differences.length
      ? `Differences: ${differences.join(" ")}`
      : "No major difference was confirmed from the visible markings.";

    return `Marked chart. ${similarityText} ${differenceText}`;
  }

  if (markingStatus === "unmarked") {
    return `Unmarked chart. There is no visible evidence of user-marked support or resistance on this chart. However, the framework areas to watch are support around ${trendPlan.initialSupportText} and resistance around ${trendPlan.initialResistanceText}.`;
  }

  return `Chart markings are unclear. User-marked support and resistance could not be verified. The framework areas to watch are support around ${trendPlan.initialSupportText} and resistance around ${trendPlan.initialResistanceText}.`;
}

function buildDeterministicCsaAnalysis({ marketReference, dateDecision, chartDetection, visualReview = null, submittedInstrument, normalizedSymbol, timeframe }) {
  const profile = marketReference?.profile || getSupportedCsaTimeframeProfile(timeframe);

  if (!marketReference || !marketReference.ok) {
    return `COACH VERDICT

Quick Verdict:
- I could not review this chart properly because the market data was not available.

Market Direction:
- Not enough data to judge the bigger-picture direction.

What This Means:
- Check that the selected instrument, timeframe, and date are correct, then run the review again.

Overall Setup Score:
- 0/10`;
  }

  const levels = marketReference.dailyLevels || [];
  const areas = marketReference.csaAreas || [];
  const bias = marketReference.directionalBias || calculateCsaDirectionalBias(levels, normalizedSymbol, profile);
  const { resistanceAreas, supportAreas, supplyAreas, demandAreas } = splitAreas(areas);
  const failedAreas = buildFailedAreas({ supportAreas, resistanceAreas, supplyAreas, demandAreas, levels, symbol: normalizedSymbol });
  const trendPlan = buildBeginnerTrendPlan({ levels, areas, bias, symbol: normalizedSymbol, profile });

  const overallScore =
    Number.isFinite(Number(visualReview?.setupQualityScore)) && Number(visualReview.setupQualityScore) >= 20
      ? Math.max(1, Math.round(Number(visualReview.setupQualityScore) / 10))
      : failedAreas.length
      ? 5
      : String(bias.biasCode || "").includes("range")
      ? 6
      : 7;

  const directionSummary = visualReview?.plainMarketDirection
    ? visualReview.plainMarketDirection
    : visualReview?.shortTermDirection && visualReview.shortTermDirection !== "unclear"
    ? `The bigger picture is ${String(bias.bias || "").toLowerCase()}, while the ${timeframe} chart is ${visualReview.shortTermDirection}.`
    : `The bigger picture is ${String(bias.bias || "").toLowerCase()}. The ${timeframe} chart direction is not clear enough to judge.`;

  const quickVerdict = trendPlan.quickVerdict;
  const bestAreaToWatch = trendPlan.bestAreaToWatch;
  const entryConfirmation = buildEntryConfirmationText({
    trendPlan,
    chartDetection,
    visualReview,
  });
  const mainWarning = trendPlan.mainWarning;
  const markingComparison = buildChartMarkingComparisonText({
    visualReview,
    trendPlan,
  });

  const supportText = listAreas([...supportAreas, ...demandAreas], "support area", 3);
  const resistanceText = listAreas([...resistanceAreas, ...supplyAreas], "resistance area", 3);

  return `COACH VERDICT

Quick Verdict:
- ${quickVerdict}

Chart Marking & Framework Comparison:
- ${markingComparison}

Market Direction:
- ${directionSummary}

Key Areas & Trade Plan:
- ${bestAreaToWatch}
- Preferred setup: ${trendPlan.preferredTrendSetup || "Breakout, pullback, and retest."}

Entry, Stop Loss & Target:
- ${entryConfirmation}
- ${visualReview?.riskEvidence || "Stop loss and target are not shown, so the trade risk cannot be judged."}

Main Warning:
- ${mainWarning}

Overall Setup Score:
- ${overallScore}/10

READ_MORE_DETAILS:

Bigger Picture:
- ${bias.higherTimeframeView || bias.reason}
- Pullback quality note: ${bias.rangePositionNote || "Not available."}

Trend Trading Plan:
- Main support to watch: ${trendPlan.initialSupportText}
- Main resistance to watch: ${trendPlan.initialResistanceText}
- Buy plan: wait for price to drop to the better support area around ${(trendPlan.buyArea?.priceText || trendPlan.initialSupportText)} and hold before considering a buy.
- Sell plan: wait for price to rise to the better resistance area around ${(trendPlan.sellArea?.priceText || trendPlan.initialResistanceText)} and reject before considering a sell.${trendPlan.sellAreaComparison ? `
- Sell area comparison: ${trendPlan.sellAreaComparison}` : ""}${trendPlan.buyAreaComparison ? `
- Buy area comparison: ${trendPlan.buyAreaComparison}` : ""}

Uploaded Chart:
- ${visualReview?.visualSummary || "The uploaded chart was reviewed using the main support and resistance areas."}
- ${visualReview?.timeframeSummary || "Short-term direction was not clear enough to judge."}

Key Areas To Watch:
Support areas:
${supportText}

Resistance areas:
${resistanceText}

Trade Management:
- If already in a trade, protect the position when price reaches the first trouble area.
- If price does not move away cleanly from entry, reduce risk or wait for a better setup.

Review Details:
- Selected instrument: ${submittedInstrument}
- Selected timeframe: ${timeframe}
- Final date used: ${dateDecision?.finalDateText || "Not provided"}
- Latest visible chart date: ${chartDetection?.latestVisibleDate || "Not detected"}
- Chart data quality: ${chartDetection?.chartDataQuality || "unclear"}
- Reviewed high: ${formatPrice(bias.periodHigh)}
- Reviewed low: ${formatPrice(bias.periodLow)}
- Higher closes: ${bias.risingCloses ?? "N/A"}
- Lower closes: ${bias.fallingCloses ?? "N/A"}
- Direction confidence: ${bias.confidence}

Failed Areas:
${listFailedAreas(failedAreas)}

Technical Structure Summary:
${buildSimpleStructureBreakdown(levels, normalizedSymbol)}`;
}

function buildInvalidChartAnalysis({ submittedInstrument, timeframe, chartDetection }) {
  return `Upload The Chart Itself

This image is not clear enough for a reliable CSA review.

What to upload:
- The trading chart should fill most of the image.
- Candles or price movement must be clearly visible.
- The price scale and time axis must be readable.
- The instrument and timeframe should be visible.
- Do not upload a screenshot of a webpage, phone screen, dashboard, document, or another app containing a small chart.

Reason:
${chartDetection?.chartValidityReason || chartDetection?.insufficientDataReason || "The uploaded image could not be verified as a clear trading chart."}`;
}
function buildInsufficientChartDataAnalysis({ submittedInstrument, timeframe, selectedDateText, chartDetection }) {
  return `Insufficient Chart Data\n\nThe uploaded image appears to be a trading chart, but it does not show enough usable visible price data for CSA Coach to review the setup.\n\nSelected:\n- Instrument: ${submittedInstrument || "Not provided"}\n- Timeframe: ${timeframe || "Not provided"}\n- Selected chart/trade date: ${selectedDateText || "Not provided"}\n\nAI image check:\n- Chart data quality: ${chartDetection?.chartDataQuality || "unclear"}\n- Visible candle count: ${chartDetection?.visibleCandleCount ?? "Not detected"}\n- Reason: ${chartDetection?.insufficientDataReason || "The chart does not show enough usable price movement."}`;
}
function buildDateMismatchAnalysis({ selectedDateText, chartDetection, dateMismatch }) {
  return `Selected Date Not Visible On Chart\n\nSelected date: ${selectedDateText || "Not provided"}\nLatest visible chart date: ${dateMismatch?.latestVisibleDateText || chartDetection?.latestVisibleDate || "Not detected"}\nReason: ${dateMismatch?.reason || "Selected date was not confirmed on the uploaded chart."}\n\nUpload a chart where the selected chart/trade date is visible, or change the selected date.`;
}
function buildInstrumentMismatchAnalysis({ selectedInstrument, detectedInstrument, selectedTimeframe, detectedTimeframe }) {
  return `Chart Context Mismatch\n\nSelected Instrument:\n${selectedInstrument || "Not provided"}\n\nDetected Chart Instrument:\n${detectedInstrument || "Not detected"}\n\nSelected Timeframe:\n${selectedTimeframe || "Not provided"}\n\nDetected Chart Timeframe:\n${detectedTimeframe || "Not detected"}`;
}
function buildTimeframeMismatchAnalysis({ selectedInstrument, detectedInstrument, selectedTimeframe, detectedTimeframe }) {
  return `Chart Timeframe Mismatch\n\nSelected Instrument:\n${selectedInstrument || "Not provided"}\n\nDetected Chart Instrument:\n${detectedInstrument || "Not detected"}\n\nSelected Timeframe:\n${selectedTimeframe || "Not provided"}\n\nDetected Chart Timeframe:\n${detectedTimeframe || "Not detected"}`;
}


function buildUnverifiedChartContextAnalysis({ selectedInstrument, detectedInstrument, selectedTimeframe, detectedTimeframe, error }) {
  return `Chart Context Could Not Be Verified

${error || "The uploaded chart context could not be clearly verified."}

Selected:
- Instrument: ${selectedInstrument || "Not provided"}
- Timeframe: ${selectedTimeframe || "Not provided"}

Detected from uploaded chart:
- Instrument: ${detectedInstrument || "Not detected"}
- Timeframe: ${detectedTimeframe || "Not detected"}

Please upload a clearer chart where the instrument and timeframe are visible, or correct the selected pair/timeframe before running diagnostics again.`;
}

function buildStoppedDashboard({ errorType, error, submittedInstrument, timeframe, chartDetection, selectedTimeframeProfile }) {
  return buildDashboardAliases({
    strengths: ["Chart context validation was completed before the review was stopped."],
    weaknesses: [error, chartDetection?.insufficientDataReason || chartDetection?.chartValidityReason || "Analysis stopped."],
    contextCheck: { selectedInstrument: submittedInstrument || "Not provided", selectedTimeframe: timeframe || "Not provided", detectedInstrument: chartDetection?.detectedInstrument || "Not detected", detectedTimeframe: chartDetection?.detectedTimeframe || "Not detected", detectedLatestVisibleDate: chartDetection?.latestVisibleDate || "Not detected", status: "Analysis stopped", structureUsed: selectedTimeframeProfile?.structureLabel || "Not available", chartValidation: chartDetection?.isTradingChart ? "Valid trading chart" : "Invalid or unverified chart", chartDataQuality: chartDetection?.chartDataQuality || "unclear", visibleCandleCount: chartDetection?.visibleCandleCount || 0, chartContextScore: 0, chartContextLabel: "Not verified", chartContextSummary: error, visualFrameworkMatch: "Not reviewed", visualChartStyle: "Not reviewed", csaLevelVisibility: "Not reviewed" },
    setupQuality: { score: 0, label: "Stopped", summary: error },
    entryAccuracy: { score: 0, label: "Stopped", summary: error },
    riskManagement: { score: 0, label: "Stopped", summary: error },
    aiMistakeDetectionHub: [makeSimpleMistake(errorType, "HIGH RISK")],
    failedAreas: [],
  });
}


function buildStarterCoachSummary({
  bias,
  dashboardFeedback,
  visualReview,
}) {
  const strengths = (dashboardFeedback?.strengths || []).slice(0, 3);
  const weaknesses = (dashboardFeedback?.weaknesses || []).slice(0, 3);
  const directionalBias =
    bias?.bias ||
    visualReview?.plainMarketDirection ||
    "Not available";

  const correctionAction =
    visualReview?.coachVerdict ||
    visualReview?.mainWarning ||
    dashboardFeedback?.setupQuality?.summary ||
    "Review the setup against the CSA Framework before the next entry.";

  return [
    "COACH VERDICT:",
    correctionAction,
    "",
    "DIRECTIONAL BIAS:",
    String(directionalBias),
    "",
    "WHAT YOU DID WELL:",
    ...(strengths.length ? strengths.map((item) => `- ${item}`) : ["- No clear strength was confirmed."]),
    "",
    "WHAT TO IMPROVE:",
    ...(weaknesses.length ? weaknesses.map((item) => `- ${item}`) : ["- No specific weakness was confirmed."]),
    "",
    "NEXT ACTION:",
    correctionAction,
  ].join("\n");
}

function applyPlanToAnalysisResponse({
  responseBody,
  entitlement,
  bias,
  dashboardFeedback,
  visualReview,
}) {
  if (entitlement?.effectivePlan !== "starter") {
    return responseBody;
  }

  const starterSummary = buildStarterCoachSummary({
    bias,
    dashboardFeedback,
    visualReview,
  });

  const strengths = (dashboardFeedback?.strengths || []).slice(0, 3);
  const weaknesses = (dashboardFeedback?.weaknesses || []).slice(0, 3);

  return {
    ...responseBody,
    analysis: starterSummary,
    summary: starterSummary,
    coachAdvice: [starterSummary],
    strengths,
    whatYouDidWell: strengths,
    weaknesses,
    whatCostYouProfit: weaknesses,
    mistakes: [],
    mistakeHub: [],
    mistakeDetectionHub: [],
    aiMistakeDetectionHub: [],
    journalTags: ["starter-review", "directional-bias", "setup-score"],
    visualReview: null,
    marketReference: responseBody.marketReference
      ? {
          ok: responseBody.marketReference.ok,
          error: responseBody.marketReference.error,
          symbol: responseBody.marketReference.symbol,
          timezone: responseBody.marketReference.timezone,
          interval: responseBody.marketReference.interval,
          directionalBias: responseBody.marketReference.directionalBias,
          profile: responseBody.marketReference.profile
            ? {
                selectedTimeframe: responseBody.marketReference.profile.selectedTimeframe,
                structureMode: responseBody.marketReference.profile.structureMode,
                structureLabel: responseBody.marketReference.profile.structureLabel,
              }
            : null,
        }
      : null,
    starterRestricted: true,
    lockedFeatures: [
      "fullAnalysis",
      "mistakeDetectionHub",
      "mistakeTracking",
      "advancedDashboard",
      "weeklyFocus",
    ],
    upgradeMessage:
      "Upgrade to Pro for the full detailed analysis, mistake tracking, unlimited journal history, weekly focus, and advanced analytics.",
  };
}

function stoppedResponse({ res, errorType, error, analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile }) {
  const stoppedDashboard = buildStoppedDashboard({ errorType, error, submittedInstrument, timeframe, chartDetection, selectedTimeframeProfile });
  return res.status(200).json({
    success: false,
    analysisStopped: true,
    shouldSaveToJournal: false,
    savedToJournal: false,
    saveReason: "Invalid or insufficient chart uploads are not saved.",
    errorType,
    error,
    analysis,
    summary: analysis,
    selectedPair: submittedInstrument,
    selectedTimeframe: timeframe,
    detectedPair: chartDetection?.detectedInstrument || "Not detected", detectedTimeframe: chartDetection?.detectedTimeframe || "Not detected", detectedLatestVisibleDate: chartDetection?.latestVisibleDate || "Not detected",
    contextStatus: "Analysis stopped before market-data-backed CSA feedback was generated.", grade: "--", confidence: 0, structureScore: 0, executionScore: 0, riskScore: 0, chartContextScore: 0, chartContextLabel: "Not verified", chartContextSummary: error,
    ...stoppedDashboard,
    coachAdvice: [analysis], journalTags: [errorType, "analysis-stopped"], chartDetection, visualReview: null,
    marketReference: { ok: false, error, symbol: normalizedSymbol, timezone, interval: normalizeTimeframe(timeframe), rawCandleCount: 0, weekRange: null, dailyLevels: [], csaAreas: [], directionalBias: calculateCsaDirectionalBias([], normalizedSymbol, selectedTimeframeProfile), profile: selectedTimeframeProfile },
  });
}

app.get("/", (req, res) => res.json({ status: "ok", message: "CSA Coach backend is running" }));
app.get("/health", (req, res) => res.json({ ok: true, service: "csa-coach-backend", time: new Date().toISOString() }));


app.get("/account-entitlements", async (req, res) => {
  try {
    const requestAuth = await getRequestUser(req);
    const entitlement = await getUserPlanEntitlement(requestAuth.user.id);
    return res.json({ success: true, entitlement });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      error: error.message,
      errorType: error.errorType || "entitlement_lookup_failed",
    });
  }
});



app.get("/strategies", async (req, res) => {
  try {
    const requestAuth = await getRequestUser(req);
    const entitlement = await getUserPlanEntitlement(requestAuth.user.id);
    const strategyDb = createUserScopedSupabase(requestAuth.accessToken);

    const result = await strategyDb
      .from("user_strategies")
      .select(`
        *,
        strategy_rules (
          id,
          rule_category,
          rule_text,
          importance,
          display_order,
          is_active
        )
      `)
      .eq("user_id", requestAuth.user.id)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    if (result.error) throw result.error;

    return res.json({
      success: true,
      strategyLimit: entitlement.strategyLimit,
      strategyCount: (result.data || []).length,
      strategies: result.data || [],
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      success: false,
      error: error.message,
      errorType: error.errorType || "strategy_list_failed",
    });
  }
});

app.get("/strategies/:id", async (req, res) => {
  try {
    const requestAuth = await getRequestUser(req);
    const strategyDb = createUserScopedSupabase(requestAuth.accessToken);
    const strategy = await getOwnedStrategy(requestAuth.user.id, req.params.id, strategyDb);

    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: "Strategy not found.",
        errorType: "strategy_not_found",
      });
    }

    return res.json({
      success: true,
      strategy,
      strategySnapshot: strategySnapshot(strategy),
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      success: false,
      error: error.message,
      errorType: error.errorType || "strategy_lookup_failed",
    });
  }
});

app.post("/strategies", async (req, res) => {
  let stage = "authentication";

  try {
    const requestAuth = await getRequestUser(req);

    stage = "entitlement";
    const entitlement = await getUserPlanEntitlement(requestAuth.user.id);
    const strategyLimit = Number(entitlement.strategyLimit || 0);

    if (strategyLimit < 1) {
      return res.status(403).json({
        success: false,
        error: "Personal strategies are available on Pro and Elite.",
        errorType: "personal_strategy_not_available",
      });
    }

    /*
      Strategy ownership is checked manually below. The backend admin client is
      intentionally used here because the server has already verified the
      Supabase access token and user ID. This avoids RLS/session-header
      inconsistencies while still preventing one user from writing for another.
    */
    stage = "count_existing_strategies";
    const currentStrategiesResult = await supabaseAdmin
      .from("user_strategies")
      .select("id")
      .eq("user_id", requestAuth.user.id)
      .eq("is_archived", false);

    if (currentStrategiesResult.error) {
      const countError = new Error(
        currentStrategiesResult.error.message ||
        "The current strategy count could not be checked."
      );
      countError.code = currentStrategiesResult.error.code;
      countError.details = currentStrategiesResult.error.details;
      countError.hint = currentStrategiesResult.error.hint;
      throw countError;
    }

    const currentCount = Array.isArray(currentStrategiesResult.data)
      ? currentStrategiesResult.data.length
      : 0;

    if (currentCount >= strategyLimit) {
      return res.status(403).json({
        success: false,
        error:
          entitlement.effectivePlan === "pro"
            ? "The Pro plan allows one personal strategy."
            : `Your plan allows up to ${strategyLimit} personal strategies.`,
        errorType: "strategy_limit_reached",
      });
    }

    stage = "validate_strategy";
    const payload = sanitizeStrategyPayload(req.body);
    const rules = sanitizeStrategyRules(req.body?.rules);

    stage = "insert_strategy";
    const strategyId = crypto.randomUUID();

    const insertResult = await supabaseAdmin
      .from("user_strategies")
      .insert({
        id: strategyId,
        user_id: requestAuth.user.id,
        ...payload,
      });

    if (insertResult.error) {
      const dbError = new Error(
        insertResult.error.message ||
        "Supabase rejected the strategy insert."
      );
      dbError.code = insertResult.error.code;
      dbError.details = insertResult.error.details;
      dbError.hint = insertResult.error.hint;
      throw dbError;
    }

    let rulesWarning = null;

    if (rules.length) {
      stage = "insert_strategy_rules";
      const rulesInsert = await supabaseAdmin
        .from("strategy_rules")
        .insert(
          rules.map((rule) => ({
            ...rule,
            strategy_id: strategyId,
            user_id: requestAuth.user.id,
          }))
        );

      if (rulesInsert.error) {
        rulesWarning =
          rulesInsert.error.message ||
          "Structured rules could not be saved.";
        console.warn(
          "Strategy saved, but structured rules were skipped:",
          rulesWarning
        );
      }
    }

    stage = "load_saved_strategy";
    const strategyResult = await supabaseAdmin
      .from("user_strategies")
      .select("*")
      .eq("id", strategyId)
      .eq("user_id", requestAuth.user.id)
      .single();

    if (strategyResult.error || !strategyResult.data) {
      throw new Error(
        strategyResult.error?.message ||
        "The strategy was created but could not be loaded."
      );
    }

    const ruleResult = await supabaseAdmin
      .from("strategy_rules")
      .select(`
        id,
        rule_category,
        rule_text,
        importance,
        display_order,
        is_active
      `)
      .eq("strategy_id", strategyId)
      .eq("user_id", requestAuth.user.id)
      .order("display_order", { ascending: true });

    const strategy = {
      ...strategyResult.data,
      strategy_rules: ruleResult.error ? [] : (ruleResult.data || []),
    };

    return res.status(201).json({
      success: true,
      strategy,
      strategyCount: currentCount + 1,
      strategyLimit,
      warning: rulesWarning,
    });
  } catch (error) {
    const duplicate = error?.code === "23505";

    console.error("Strategy creation failed:", {
      stage,
      name: error?.name || null,
      message: error?.message || null,
      code: error?.code || null,
      details: error?.details || null,
      hint: error?.hint || null,
      stack: error?.stack || null,
    });

    return res
      .status(duplicate ? 409 : Number(error?.statusCode) || 500)
      .json({
        success: false,
        error: duplicate
          ? "You already have a strategy with this name."
          : error?.message ||
            `The strategy could not be saved during ${stage}.`,
        errorType: duplicate
          ? "duplicate_strategy_name"
          : error?.errorType || "strategy_create_failed",
        stage,
      });
  }
});

app.put("/strategies/:id", async (req, res) => {
  try {
    const requestAuth = await getRequestUser(req);
    const strategyDb = createUserScopedSupabase(requestAuth.accessToken);
    const existing = await getOwnedStrategy(
      requestAuth.user.id,
      req.params.id,
      strategyDb
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Strategy not found.",
        errorType: "strategy_not_found",
      });
    }

    const payload = sanitizeStrategyPayload(req.body);
    const rules = sanitizeStrategyRules(req.body?.rules);

    const updated = await strategyDb
      .from("user_strategies")
      .update({
        ...payload,
        version: Number(existing.version || 1) + 1,
      })
      .eq("id", existing.id)
      .eq("user_id", requestAuth.user.id)
      .select("*")
      .single();

    if (updated.error) throw updated.error;

    if (Array.isArray(req.body?.rules)) {
      const deleted = await strategyDb
        .from("strategy_rules")
        .delete()
        .eq("strategy_id", existing.id)
        .eq("user_id", requestAuth.user.id);

      if (deleted.error) throw deleted.error;

      if (rules.length) {
        const insertedRules = await strategyDb
          .from("strategy_rules")
          .insert(rules.map((rule) => ({
            ...rule,
            strategy_id: existing.id,
            user_id: requestAuth.user.id,
          })));

        if (insertedRules.error) throw insertedRules.error;
      }
    }

    const strategy = await getOwnedStrategy(
      requestAuth.user.id,
      existing.id,
      strategyDb
    );
    return res.json({ success: true, strategy });
  } catch (error) {
    const duplicate = error?.code === "23505";
    return res.status(duplicate ? 409 : Number(error?.statusCode) || 500).json({
      success: false,
      error: duplicate ? "You already have a strategy with this name." : error.message,
      errorType: duplicate ? "duplicate_strategy_name" : error.errorType || "strategy_update_failed",
    });
  }
});

app.delete("/strategies/:id", async (req, res) => {
  try {
    const requestAuth = await getRequestUser(req);
    const strategyDb = createUserScopedSupabase(requestAuth.accessToken);
    const strategy = await getOwnedStrategy(
      requestAuth.user.id,
      req.params.id,
      strategyDb
    );

    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: "Strategy not found.",
        errorType: "strategy_not_found",
      });
    }

    const archived = await strategyDb
      .from("user_strategies")
      .update({ is_active: false, is_archived: true })
      .eq("id", strategy.id)
      .eq("user_id", requestAuth.user.id);

    if (archived.error) throw archived.error;

    return res.json({ success: true, deletedStrategyId: strategy.id });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      success: false,
      error: error.message,
      errorType: error.errorType || "strategy_delete_failed",
    });
  }
});


app.post("/create-checkout-session", async (req, res) => {
  try {
    requireStripeConfigured();

    const requestAuth = await getRequestUser(req);
    const requestedPlan = String(req.body?.plan || "").toLowerCase();

    if (!["pro", "elite"].includes(requestedPlan)) {
      return res.status(400).json({
        success: false,
        error: "Choose either the Pro or Elite plan.",
        errorType: "invalid_plan",
      });
    }

    const selectedPriceId =
      requestedPlan === "pro"
        ? STRIPE_PRO_PRICE_ID
        : STRIPE_ELITE_PRICE_ID;

    const profileResult = await supabaseAdmin
      .from("profiles")
      .select(`
        id,
        email,
        full_name,
        subscription_plan,
        subscription_status,
        stripe_customer_id,
        stripe_subscription_id,
        trial_used
      `)
      .eq("id", requestAuth.user.id)
      .single();

    if (profileResult.error || !profileResult.data) {
      const error = new Error("Your CSA Coach profile could not be found.");
      error.statusCode = 403;
      throw error;
    }

    const profile = profileResult.data;

    if (
      profile.stripe_subscription_id &&
      ["active", "trialing", "past_due", "incomplete"].includes(
        String(profile.subscription_status || "").toLowerCase()
      )
    ) {
      return res.status(409).json({
        success: false,
        error:
          "You already have a Stripe subscription. Open Account settings to manage or change it.",
        errorType: "subscription_already_exists",
      });
    }

    let customerId = profile.stripe_customer_id || "";

    if (customerId) {
      const existingSubscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 10,
      });

      const blockingSubscription = existingSubscriptions.data.find((subscription) =>
        ["active", "trialing", "past_due", "incomplete", "unpaid", "paused"].includes(
          subscription.status
        )
      );

      if (blockingSubscription) {
        await updateProfileFromStripeSubscription(blockingSubscription);
        return res.status(409).json({
          success: false,
          error:
            "You already have a Stripe subscription. Open Account settings to manage it.",
          errorType: "subscription_already_exists",
        });
      }
    } else {
      const customer = await stripe.customers.create({
        email: requestAuth.user.email || profile.email || undefined,
        name: profile.full_name || undefined,
        metadata: {
          supabase_user_id: requestAuth.user.id,
        },
      });

      customerId = customer.id;

      const customerUpdate = await supabaseAdmin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", requestAuth.user.id);

      if (customerUpdate.error) throw customerUpdate.error;
    }

    const trialEligible = profile.trial_used !== true;

    const subscriptionData = {
      metadata: {
        supabase_user_id: requestAuth.user.id,
        plan_code: requestedPlan,
      },
    };

    if (trialEligible) {
      subscriptionData.trial_period_days = 7;
      subscriptionData.trial_settings = {
        end_behavior: {
          missing_payment_method: "cancel",
        },
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: requestAuth.user.id,
      line_items: [
        {
          price: selectedPriceId,
          quantity: 1,
        },
      ],
      payment_method_collection: "always",
      allow_promotion_codes: true,
      success_url: `${FRONTEND_URL}?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}?billing=cancelled`,
      metadata: {
        supabase_user_id: requestAuth.user.id,
        plan_code: requestedPlan,
        trial_eligible: trialEligible ? "true" : "false",
      },
      subscription_data: subscriptionData,
    });

    return res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
      trialEligible,
      trialDays: trialEligible ? 7 : 0,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    console.error("Create checkout session error:", error);
    return res.status(statusCode).json({
      success: false,
      error:
        process.env.NODE_ENV === "production" && statusCode >= 500
          ? "Stripe Checkout could not be started."
          : error.message,
      errorType: error.errorType || "checkout_session_failed",
      details: error.message,
    });
  }
});

app.post("/create-billing-portal-session", async (req, res) => {
  try {
    requireStripeConfigured();

    const requestAuth = await getRequestUser(req);

    const profileResult = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", requestAuth.user.id)
      .single();

    if (profileResult.error || !profileResult.data?.stripe_customer_id) {
      return res.status(404).json({
        success: false,
        error: "No Stripe billing account is connected to this profile yet.",
        errorType: "billing_customer_not_found",
      });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profileResult.data.stripe_customer_id,
      return_url: FRONTEND_URL,
    });

    return res.json({
      success: true,
      url: portalSession.url,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    console.error("Create billing portal error:", error);
    return res.status(statusCode).json({
      success: false,
      error:
        statusCode >= 500
          ? "The billing portal could not be opened."
          : error.message,
      errorType: error.errorType || "billing_portal_failed",
      details: error.message,
    });
  }
});

app.get("/journal-reviews", async (req, res) => {
  try {
    const requestAuth = await getRequestUser(req);
    const entitlement = await getUserPlanEntitlement(requestAuth.user.id);

    let query = supabaseAdmin
      .from("chart_reviews")
      .select("*")
      .eq("user_id", requestAuth.user.id)
      .order("created_at", { ascending: false });

    if (Number(entitlement.journalLimit) > 0) {
      query = query.limit(Number(entitlement.journalLimit));
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json({
      success: true,
      reviews: data || [],
      entitlement,
      visibleReviewLimit: entitlement.journalLimit,
      olderReviewsPreserved:
        entitlement.effectivePlan === "starter",
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      error:
        [401, 403].includes(statusCode)
          ? error.message
          : "Your journal could not be loaded.",
      errorType: error.errorType || "journal_load_failed",
      details: error.message,
    });
  }
});

app.get("/test-twelve", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol || "GBP/USD");
    const timeframe = req.query.timeframe || "H1";
    const date = req.query.date || "2026-07-15";
    const timezone = req.query.timezone || "UTC";
    const analysisType = normalizeAnalysisType(req.query.analysisType || "post-trade");
    const chartDate = parseISODateOnly(date);
    if (!chartDate) return res.status(400).json({ ok: false, error: "Invalid date. Use YYYY-MM-DD format." });
    const result = await fetchTwelveDataStructureLevels({ symbol, chartDate, timeframe, timezone, analysisType });
    return res.json(result);
  } catch (error) {
    console.error("test-twelve error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});


app.get("/sample-analysis", (req, res) => {
  return res.json({
    success: true,
    isSample: true,
    selectedPair: "GBPUSD",
    selectedTimeframe: "H1",
    selectedDate: "2026-07-09",
    analysisType: "post-trade",
    detectedPair: "GBPUSD",
    detectedTimeframe: "H1",
    detectedLatestVisibleDate: "2026-07-09",
    contextStatus: "Sample chart context verified for demonstration.",
    grade: "B+",
    confidence: 82,
    structureScore: 86,
    executionScore: 74,
    riskScore: 78,
    chartContextScore: 100,
    chartContextLabel: "Verified sample",
    chartContextSummary: "The sample instrument and timeframe match the demonstration chart.",
    strengths: [
      "The chart is reviewed around clearly defined CSA support and resistance areas.",
      "Price respected the lower support area before moving toward resistance.",
      "The trader avoided chasing price in the middle of the range."
    ],
    weaknesses: [
      "No fresh entry confirmation is visible at the current resistance area.",
      "A new entry here would offer limited room before nearby resistance.",
      "Stop loss and target placement still need to be confirmed before execution."
    ],
    mistakes: [
      { title: "Entering before confirmation", severity: "High" },
      { title: "Trading too close to resistance", severity: "Review" },
      { title: "Risk plan not confirmed", severity: "Review" }
    ],
    summary: "COACH VERDICT:\nWAIT. Price has reached a resistance area after a bullish move, but there is no fresh confirmed trigger yet.\n\nWHAT THE CHART DOES WELL:\n- Support and resistance areas are clear.\n- The move from support toward resistance is easy to judge.\n\nMAIN RISK:\n- Entering now could mean buying directly into resistance or selling without confirmation.\n\nNEXT ACTION:\nWait for either a clean break-and-hold above resistance followed by a retest, or a clear bearish rejection before considering the next setup.\n\nREAD_MORE_DETAILS:\nThis sample is designed to demonstrate the dashboard experience. It is not live market analysis and should not be treated as a trade signal.",
    analysis: "COACH VERDICT:\nWAIT. Price is at resistance without a fresh confirmed trigger.",
    setupQuality: { score: 86, label: "Good", summary: "The structure and location are clear." },
    entryAccuracy: { score: 74, label: "Fair", summary: "The next entry still needs confirmation." },
    riskManagement: { score: 78, label: "Good", summary: "Risk can be planned, but SL and target are not confirmed." },
    chartContext: { score: 100, label: "Verified sample", summary: "Sample context is internally matched." },
    mistakePattern: [
      { title: "Entering before confirmation", severity: "High" },
      { title: "Trading too close to resistance", severity: "Review" },
      { title: "Risk plan not confirmed", severity: "Review" }
    ],
    todaysLesson: "Do not force an entry simply because price has reached an important area. Wait for confirmation.",
    riskComment: "A valid setup still requires a clear invalidation point and enough room to the next target."
  });
});

app.post("/analyze-chart", upload.single("chart"), async (req, res) => {
  try {
    const requestAuth = await getRequestUser(req);
    const entitlement = await getUserPlanEntitlement(requestAuth.user.id);
    assertAnalysisAllowed(entitlement);

    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: "OPENAI_API_KEY is missing on the server." });
    if (!req.file) return res.status(400).json({ success: false, error: "No chart image uploaded." });

    const {
      timeframe = "Not provided",
      instrument = "",
      pair = "",
      selectedPair = "",
      analysisType = "post-trade",
      notes = "",
      userNotes = "",
      chartDate = "",
      tradeDate = "",
      timezone = "UTC",
      analysisFramework = "csa",
      strategyId = "",
    } = req.body;
    const submittedInstrument = instrument || pair || selectedPair || "Not provided";
    const submittedNotes = notes || userNotes || "";
    const normalizedSymbol = normalizeSymbol(submittedInstrument);
    const mode = normalizeAnalysisType(analysisType);
    const selectedTimeframeProfile = getSupportedCsaTimeframeProfile(timeframe);
    const selectedStrategy = await resolveSelectedStrategy({
      userId: requestAuth.user.id,
      entitlement,
      analysisFramework,
      strategyId,
    });
    const imageBase64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/png";
    const selectedDate = parseISODateOnly(chartDate || tradeDate);

    const chartDetection = await detectChartContextFromImage({ imageBase64, mimeType, submittedInstrument, selectedTimeframe: timeframe, selectedDateText: chartDate || tradeDate || "", analysisType: mode });

    if (!chartDetection.isTradingChart) {
      const analysis = buildInvalidChartAnalysis({ submittedInstrument, timeframe, chartDetection });
      return stoppedResponse({ res, errorType: "invalid_chart_image", error: "Uploaded image is not a valid trading chart.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    if (!isUploadedChartDataUsable(chartDetection, chartDate || tradeDate || "")) {
      const analysis = buildInsufficientChartDataAnalysis({ submittedInstrument, timeframe, selectedDateText: chartDate || tradeDate || "", chartDetection });
      return stoppedResponse({ res, errorType: "insufficient_chart_data", error: "Uploaded chart does not have enough visible price data for review.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    const dateMismatch = getSelectedDateMismatch(chartDetection, selectedDate, timeframe);
    if (dateMismatch.hasMismatch) {
      const analysis = buildDateMismatchAnalysis({ selectedDateText: chartDate || tradeDate || "", chartDetection, dateMismatch });
      return stoppedResponse({ res, errorType: "selected_date_not_visible", error: "Selected chart/trade date is not visible or reasonably covered by the uploaded chart.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    const verificationProblem = getChartContextVerificationProblem({ chartDetection, submittedInstrument, timeframe });
    if (verificationProblem.hasProblem) {
      const analysis = buildUnverifiedChartContextAnalysis({
        selectedInstrument: submittedInstrument,
        detectedInstrument: chartDetection.detectedInstrument,
        selectedTimeframe: timeframe,
        detectedTimeframe: chartDetection.detectedTimeframe,
        error: verificationProblem.error,
      });
      return stoppedResponse({
        res,
        errorType: verificationProblem.errorType,
        error: verificationProblem.error,
        analysis,
        submittedInstrument,
        timeframe,
        chartDetection,
        normalizedSymbol,
        timezone,
        selectedTimeframeProfile,
      });
    }

    const instrumentMismatch = hasStrongInstrumentMismatch({ selectedInstrument: normalizedSymbol || submittedInstrument, detectedInstrument: chartDetection.detectedInstrument });
    if (instrumentMismatch) {
      const analysis = buildInstrumentMismatchAnalysis({ selectedInstrument: submittedInstrument, detectedInstrument: chartDetection.detectedInstrument, selectedTimeframe: timeframe, detectedTimeframe: chartDetection.detectedTimeframe });
      return stoppedResponse({ res, errorType: "instrument_mismatch", error: "Selected instrument does not match uploaded chart.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    const timeframeMismatch = hasStrongTimeframeMismatch({ selectedTimeframe: timeframe, detectedTimeframe: chartDetection.detectedTimeframe });
    if (timeframeMismatch) {
      const analysis = buildTimeframeMismatchAnalysis({ selectedInstrument: submittedInstrument, detectedInstrument: chartDetection.detectedInstrument, selectedTimeframe: timeframe, detectedTimeframe: chartDetection.detectedTimeframe });
      return stoppedResponse({ res, errorType: "timeframe_mismatch", error: "Selected timeframe does not match uploaded chart timeframe.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    const dateDecision = chooseFinalChartDate({ selectedDate, detection: chartDetection, analysisType: mode });
    const marketReference = await fetchTwelveDataStructureLevels({ symbol: normalizedSymbol, chartDate: dateDecision.finalDate, timeframe, timezone: timezone || "UTC", analysisType: mode });
    const visualReview = await compareUploadedChartWithCsaFramework({
      imageBase64,
      mimeType,
      marketReference,
      chartDetection,
      submittedInstrument,
      timeframe,
      analysisType: mode,
      submittedNotes,
      analysisFramework: selectedStrategy.analysisFramework,
      personalStrategySnapshot: selectedStrategy.snapshot,
    });
    const baseAnalysis = buildDeterministicCsaAnalysis({
      marketReference,
      dateDecision,
      chartDetection,
      visualReview,
      submittedInstrument,
      normalizedSymbol,
      timeframe,
    });

    const analysis =
      selectedStrategy.analysisFramework === "personal_strategy"
        ? `${baseAnalysis}

PERSONAL STRATEGY REVIEW

Strategy:
- ${selectedStrategy.snapshot.strategyName}

Strategy Match Score:
- ${visualReview?.strategyMatchScore ?? "Not enough evidence"}%

Strategy Verdict:
- ${visualReview?.strategyVerdict || "Not enough evidence"}

Rules Followed:
${(visualReview?.strategyRulesFollowed || []).length
  ? visualReview.strategyRulesFollowed.map((item) => `- ${item}`).join("\n")
  : "- No rule was clearly confirmed."}

Rules Violated:
${(visualReview?.strategyRulesViolated || []).length
  ? visualReview.strategyRulesViolated.map((item) => `- ${item}`).join("\n")
  : "- No clear rule violation was confirmed."}

Missing Information:
${(visualReview?.strategyMissingInformation || []).length
  ? visualReview.strategyMissingInformation.map((item) => `- ${item}`).join("\n")
  : "- Nothing important was missing."}`
        : baseAnalysis;
    const bias = marketReference.directionalBias || calculateCsaDirectionalBias([], normalizedSymbol, selectedTimeframeProfile);
    const setupScoreMatch = String(analysis).match(/Overall Setup Score:\s*\n- (\d+)\/10/i);
    const setupScore = setupScoreMatch ? Number(setupScoreMatch[1]) : 0;

    const dashboardFeedback = buildDashboardFeedback({ marketReference, chartDetection, visualReview, submittedInstrument, timeframe, selectedDateText: chartDate || tradeDate || "Not provided", detectedDateText: chartDetection.latestVisibleDate || "Not detected", setupScore });
    const dashboardAliases = buildDashboardAliases(dashboardFeedback);
    const structureLabel = marketReference.profile?.structureLabel || selectedTimeframeProfile.structureLabel || "CSA structure levels";

    const journalSave = await saveCompletedReview({
      user: requestAuth.user,
      file: req.file,
      submittedInstrument,
      timeframe,
      mode,
      submittedNotes,
      chartDateText: chartDate || tradeDate || null,
      analysis,
      chartDetection,
      visualReview,
      marketReference,
      dashboardFeedback,
      dateDecision,
      analysisFramework: selectedStrategy.analysisFramework,
      selectedStrategy: selectedStrategy.strategy,
      personalStrategySnapshot: selectedStrategy.snapshot,
    });

    const updatedEntitlement = {
      ...entitlement,
      analysesUsed: entitlement.analysesUsed + 1,
      analysesRemaining: Math.max(0, entitlement.analysesRemaining - 1),
    };

    const responseBody = {
      success: true,
      entitlement: updatedEntitlement,
      savedToJournal: journalSave.savedToJournal,
      saveReason: journalSave.saveReason,
      reviewId: journalSave.reviewId,
      chartImagePath: journalSave.chartImagePath,
      analysis,
      summary: analysis,
      selectedPair: submittedInstrument,
      selectedTimeframe: timeframe,
      selectedDate: chartDate || tradeDate || "Not provided",
      analysisType: mode,
      analysisFramework: selectedStrategy.analysisFramework,
      selectedStrategy:
        selectedStrategy.analysisFramework === "personal_strategy"
          ? {
              id: selectedStrategy.strategy.id,
              name: selectedStrategy.strategy.strategy_name,
              version: selectedStrategy.strategy.version || 1,
            }
          : null,
      strategyAssessment:
        selectedStrategy.analysisFramework === "personal_strategy"
          ? {
              strategyMatchScore: visualReview?.strategyMatchScore ?? null,
              rulesFollowed: visualReview?.strategyRulesFollowed || [],
              rulesViolated: visualReview?.strategyRulesViolated || [],
              missingInformation: visualReview?.strategyMissingInformation || [],
              verdict: visualReview?.strategyVerdict || null,
            }
          : null,
      detectedPair: chartDetection.detectedInstrument || normalizedSymbol || "Not available",
      detectedTimeframe: chartDetection.detectedTimeframe || timeframe,
      detectedLatestVisibleDate: chartDetection.latestVisibleDate || "Not detected",
      finalDateUsed: dateDecision.finalDateText,
      dateDecision,
      csaDirectionalBias: bias,
      contextStatus: marketReference.ok ? `Market-data-backed CSA setup review completed using ${structureLabel} and visual chart comparison.` : `Setup review completed without market data: ${marketReference.error}`,
      grade: dashboardFeedback.setupQualityScore >= 85 ? "A" : dashboardFeedback.setupQualityScore >= 75 ? "B" : dashboardFeedback.setupQualityScore >= 60 ? "C" : dashboardFeedback.setupQualityScore >= 40 ? "D" : "F",
      confidence: dashboardFeedback.setupQualityScore,
      structureScore: dashboardFeedback.scores.setupQuality,
      executionScore: dashboardFeedback.scores.entryAccuracy,
      riskScore: dashboardFeedback.scores.riskManagement,
      chartContextScore: dashboardAliases.chartContextScore,
      chartContextLabel: dashboardAliases.chartContextLabel,
      chartContextSummary: dashboardAliases.chartContextSummary,
      ...dashboardAliases,
      coachAdvice: [analysis],
      journalTags: ["setup review", "directional bias", "entry area", "visual csa comparison", "uploaded chart comparison", "risk reward", marketReference.profile?.selectedTimeframe || selectedTimeframeProfile.selectedTimeframe, marketReference.profile?.structureMode || selectedTimeframeProfile.structureMode, marketReference.ok ? "market-data-backed" : "vision-only fallback", visualReview?.frameworkMatch || "visual-not-reviewed", bias.biasCode || "bias-unavailable"],
      visualReview,
      chartDetection,
      marketReference: { ok: marketReference.ok, error: marketReference.error, symbol: marketReference.symbol, timezone: marketReference.timezone, interval: marketReference.interval, rawCandleCount: marketReference.rawCandleCount, weekRange: marketReference.weekRange, dailyLevels: marketReference.dailyLevels, csaAreas: marketReference.csaAreas, directionalBias: marketReference.directionalBias, profile: marketReference.profile, structureMode: marketReference.profile?.structureMode, structureLabel: marketReference.profile?.structureLabel, cleanBreakTolerance: getCleanBreakTolerance(normalizedSymbol) },
    };

    return res.json(
      applyPlanToAnalysisResponse({
        responseBody,
        entitlement: updatedEntitlement,
        bias,
        dashboardFeedback,
        visualReview,
      })
    );
  } catch (error) {
    console.error("CSA Coach analyze error:", error);
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      error:
        [401, 403, 429].includes(statusCode)
          ? error.message
          : "Something went wrong while analyzing or saving the chart.",
      errorType: error.errorType || null,
      details: error.message,
    });
  }
});

process.on("uncaughtException", (error) => console.error("Uncaught exception:", error));
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`CSA Coach backend running on port ${PORT}`));
