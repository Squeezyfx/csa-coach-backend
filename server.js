import express from "express";
import cors from "cors";
import multer from "multer";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
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


const AI_PROVIDER = String(process.env.AI_PROVIDER || "openai")
  .trim()
  .toLowerCase();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

function getActiveAiProvider() {
  return AI_PROVIDER === "claude" ? "claude" : "openai";
}

function isAiProviderConfigured() {
  return getActiveAiProvider() === "claude"
    ? Boolean(anthropic)
    : Boolean(openai);
}

function getAiConfigurationError() {
  if (getActiveAiProvider() === "claude" && !anthropic) {
    return "ANTHROPIC_API_KEY is missing on the server.";
  }
  if (getActiveAiProvider() === "openai" && !openai) {
    return "OPENAI_API_KEY is missing on the server.";
  }
  return "";
}

function getAnthropicText(message) {
  return Array.isArray(message?.content)
    ? message.content
        .filter((block) => block?.type === "text")
        .map((block) => String(block.text || ""))
        .join("\n")
        .trim()
    : "";
}

/**
 * Provider-neutral image + text request.
 *
 * The rest of the CSA backend continues to own:
 * - Twelve Data calculations
 * - deterministic framework logic
 * - approved-price validation
 * - Supabase / Stripe / journal behavior
 *
 * The model is used only for the same visual interpretation work the
 * OpenAI calls were already doing.
 */
async function runVisionModel({
  systemPrompt,
  userText,
  imageBase64,
  mimeType,
  maxTokens = 1200,
  openaiModel = "gpt-4.1",
  claudeModel = CLAUDE_MODEL,
  temperature = 0,
  imageDetail = "high",
}) {
  const provider = getActiveAiProvider();

  if (provider === "claude") {
    if (!anthropic) {
      throw new Error("ANTHROPIC_API_KEY is missing on the server.");
    }

    const response = await anthropic.messages.create({
      model: claudeModel,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userText,
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: imageBase64,
              },
            },
          ],
        },
      ],
    });

    return {
      provider,
      model: claudeModel,
      text: getAnthropicText(response),
      raw: response,
    };
  }

  if (!openai) {
    throw new Error("OPENAI_API_KEY is missing on the server.");
  }

  const response = await openai.responses.create({
    model: openaiModel,
    input: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: userText,
          },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${imageBase64}`,
            ...(imageDetail ? { detail: imageDetail } : {}),
          },
        ],
      },
    ],
    max_output_tokens: maxTokens,
    temperature,
  });

  return {
    provider,
    model: openaiModel,
    text: response.output_text || "",
    raw: response,
  };
}

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
      "FRONTEND_URL is not valid. Enter only the full https:// URL of the GoHighLevel page connected to this Render service."
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
    dateDecision: {
      ...dateDecision,
      selectedDateAdjusted: dateDecision?.selectedDateAdjusted === true,
    },
    dashboard: {
      strengths: dashboardFeedback?.strengths || [],
      weaknesses: dashboardFeedback?.weaknesses || [],
      mistakes: dashboardFeedback?.aiMistakeDetectionHub || [],
      setupQuality: dashboardFeedback?.setupQuality || null,
      entryAccuracy: dashboardFeedback?.entryAccuracy || null,
      riskManagement:
        dashboardFeedback?.riskManagement || null,
      displayLabels:
        dashboardFeedback?.displayLabels || null,
      scoreDisplay:
        dashboardFeedback?.scoreDisplay || null,
      overallDisplayLabel:
        dashboardFeedback?.overallDisplayLabel ||
        dashboardFeedback?.displayLabels?.overall ||
        "Overall Grade",
      setupQualityDisplayLabel:
        dashboardFeedback?.setupQualityDisplayLabel ||
        dashboardFeedback?.displayLabels?.setupQuality ||
        "Setup Quality",
      entryAccuracyDisplayLabel:
        dashboardFeedback?.entryAccuracyDisplayLabel ||
        dashboardFeedback?.displayLabels?.entryAccuracy ||
        "Entry Accuracy",
      riskManagementDisplayLabel:
        dashboardFeedback?.riskManagementDisplayLabel ||
        dashboardFeedback?.displayLabels?.riskManagement ||
        "Risk Management",
      contextCheck:
        dashboardFeedback?.contextCheck || null,
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
      approvedAreas: buildApprovedMarketAreas(marketReference),
      chartCutoff: marketReference?.chartCutoff || null,
      rawCandleCount: Number(marketReference?.rawCandleCount || 0),
      filteredCandleCount: Number(marketReference?.filteredCandleCount || 0),
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

Your job is to decide whether the uploaded image contains a usable financial trading chart.

ACCEPT a chart when the overall visual evidence clearly shows a financial price chart. Strong evidence includes:
- candles, bars, or clear plotted price movement;
- a visible or reasonably inferable price scale on the side;
- a visible or reasonably inferable time/date axis along the bottom;
- the chart is the main subject of the uploaded image;
- there are about 15 or more visible candles/bars/points;
- chart-platform context such as a symbol/timeframe header, price labels, order lines, grid, or chart drawings.

Do not require every single feature to be perfectly readable. A normal chart may still be usable when one label, axis, or header is unclear.

Normal chart-platform content is allowed and must NOT cause rejection:
- MetaTrader, TradingView, cTrader, broker-platform, or other chart headers;
- toolbars, tabs, price labels, bid/ask lines, order lines, indicators, grids;
- support/resistance lines, supply/demand zones, rectangles, trendlines, Fibonacci, arrows, text notes, or other chart drawings;
- a small amount of surrounding platform interface;
- a screenshot where the chart occupies roughly 25% or more of the useful image and is still clearly the main analytical object.

REJECT only when:
- there is no financial trading chart;
- the chart is genuinely a tiny secondary object inside a much larger unrelated webpage, phone screen, social post, document, presentation, or dashboard;
- candles and price movement cannot be read;
- the price scale or time axis is missing or unreadable;
- the chart is blank, loading, heavily blurred, severely cropped, or has fewer than about 15 visible candles/bars/points.

Important decision rules:
- Do not reject a normal trading-platform screenshot simply because it contains borders, toolbars, indicators, drawings, or annotations.
- Do not classify a full MetaTrader, TradingView, cTrader, or broker chart as a nested chart merely because native platform controls, headers, account text, menus, tabs, indicators, or borders are visible.
- "Nested chart" means the trading chart is only a small object inside an unrelated outer page/screen. A full chart window from a trading platform is NOT nested.
- If the chart is clearly the main content and price movement, price scale, and time axis are readable, mark isTradingChart=true.
- When uncertain but there is substantial chart evidence, prefer isTradingChart=true and use medium or low confidence for uncertain details.
- Never reject solely because one of these is unclear: exact symbol, exact timeframe, exact date, exact final candle time, exact final price, or one axis label.
- Use isTradingChart=false only when the image is genuinely not usable as a trading chart.

Important:
- Take your time to inspect the top-left chart header, chart title, symbol label, and timeframe label before returning JSON.
- Do NOT copy the selected instrument or selected timeframe from the user input unless the same instrument/timeframe is clearly visible on the uploaded chart image.
- If the uploaded chart instrument is not clearly readable, set detectedInstrument=null. Do not guess.
- If the uploaded chart timeframe is not clearly readable, set detectedTimeframe=null. Do not guess.
- Be practical. If a chart clearly has visible price movement, do not mark it insufficient just because the exact selected date is hard to read.
- If the selected date is clearly far after the latest visible chart date, set selectedDateVisible=false and provide latestVisibleDate.
- Inspect the far-right side of the time axis and the latest visible candle. When readable, return the latest visible candle time in 24-hour HH:mm format.
- latestVisibleTime must describe where the uploaded screenshot stops, not the current time and not a later market time.
- Read the final visible candle CLOSE price from the chart header or final printed price label when it is clearly visible. Return it as latestVisiblePrice. Prefer an exact printed/header close over a visual estimate.
- latestVisiblePrice must describe the final candle visible in the uploaded screenshot, not a later external-data price. If the exact final close cannot be read confidently, return null rather than guessing.
- If the final candle time cannot be read confidently, set latestVisibleTime=null and latestVisibleTimeConfidence="low". Never guess.
- If the date axis is hard to read, set dateConfidence="low" instead of blocking the chart.
- Only mark hasUsablePriceData=false when the chart is truly blank, unreadable, severely cropped, loading, or has almost no price movement.
- Do not comment on strategies such as trendlines, channels, indicators, Fibonacci, or moving averages in this step. This step only validates the chart and detects basic context.

Entry trigger rule:
Only return visibleTrigger if there is real confirmation such as engulfing, pin bar, hammer, doji rejection, inside bar break, lower high/higher low, breakout/breakdown, retest-and-hold, or clean break-and-hold.
Bounce, pullback, reaction, retracement, ranging, or consolidation alone is not a trigger.

AREA RANKING RULES:
- The deterministic OHLC market direction and phase supplied by the backend are immutable. Do not rewrite them.
- When the review uses End of selected day or Exact historical time, ignore any later candles visible to the right of that cutoff when describing direction, breakout state, entry readiness, strengths, weaknesses, or next action. Those later candles are outside the review.
- Identify up to 3 active entry areas that agree with the locked directional bias.
- The timeframe-specific CSA framework levels are authoritative: M1-H1 daily, H4 weekly, D1 monthly, W1 quarterly, MN yearly/multi-year.
- A converted resistance may only come from a level originally classified by the CSA period engine as support; a converted support may only come from original resistance. Do not convert demand or supply levels.
- Generic pivots and chart markings may only confirm or refine an authoritative framework level; they must never create or replace the primary area.
- Validate genuine support/resistance or supply/demand structure before considering distance.
- Fibonacci retracement is a silent mandatory quality filter only after an authoritative structural area already exists. Only 38.2%, 50%, and 61.8% are used.
- The deterministic CSA selector controls entry areas. Build candidates only from the timeframe's authoritative source periods, resolve each level's current lifecycle role chronologically, reject failed/choppy/weak levels, then keep only structural areas in close proximity to 38.2%, 50%, or 61.8% of the relevant completed impulse before sequencing Entry 1 and Entry 2.
- A clean break with continuation may create a potential converted S/R area that can be watched for a future retest. It becomes confirmed converted only after price returns from the opposite side and respects it. Either way, it must still pass the 38.2% / 50% / 61.8% proximity filter before it can become Entry 1 or Entry 2.
- Fibonacci must never create an area by itself. An independently valid S/R or supply/demand area becomes a strong entry candidate only when it is close to 38.2%, 50%, or 61.8%.
- Preserve the true area type: converted resistance/support, resistance/support, or supply/demand.
- Use the timeframe-framework high or low to identify the correct structural period first.
- If the uploaded chart clearly shows the matching broker level within a reasonable ATR-scaled tolerance, reconcile the final displayed price to that visible chart level.
- An exact displayedPrice/platform price label has priority over every approximate visual estimate. Approximate prices may be used only when no exact printed price is readable.
- The chart price may adjust only the displayed price of the already-selected framework period; it must never cause the engine to switch to a different day/week/month/quarter/year.
- Period identity is mandatory for reconciliation: a January chart level can only reconcile the January framework record, a June chart level can only reconcile June, and the same rule applies to days, weeks, quarters and years.
- Pivots, reactions and Fibonacci may confirm the chosen period/level but must never replace it.
- Keep zones compact and tied to the authoritative framework price; do not merge unrelated levels into a wide band.
- Reject any secondary sell area below the primary sell area, or any secondary buy area above the primary buy area.
- First require independent structural validity, then require 38.2% / 50% / 61.8% proximity. Sequence only the surviving strong areas by the order price would reach them.
- For a bearish plan, a broken support below an older supply zone may become potential converted resistance, but it becomes a strong primary sell area only if it also passes the 38.2% / 50% / 61.8% proximity filter.
- For a bullish plan, a broken resistance above an older demand zone may become potential converted support, but it becomes a strong primary buy area only if it also passes the 38.2% / 50% / 61.8% proximity filter.
- Keep a farther supply/demand zone as a secondary area when it remains valid.
- Do not include an invalidated area as an active entry area.
- Each area must have a state: active, potential conversion, confirmed conversion, or invalidated.
- The primary and secondary areas must use visible/approved prices only.

Return exactly this JSON shape:
{
  "isTradingChart": true,
  "chartValidityReason": "brief reason",
  "validationConfidence": "high or medium or low",
  "hasVisiblePriceMovement": true,
  "hasPriceScale": true,
  "hasTimeAxis": true,
  "chartIsMainSubject": true,
  "chartPlatformDetected": true,
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
  "latestVisibleTime": "HH:mm in 24-hour time or null",
  "latestVisibleTimeConfidence": "high or medium or low",
  "latestVisiblePrice": 1.23456,
  "latestVisiblePriceConfidence": "high or medium or low",
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

function nullablePositiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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

function safeUserText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
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
  // V4.1: the market-data request now serves TWO jobs:
  // 1) a narrow authoritative CSA framework window, and
  // 2) a broader impulse-history window.
  // Keep these limits comfortably below provider maximums while allowing
  // enough historical candles for the broader impulse scan.
  const map = {
    "1min": "5000",
    "5min": "5000",
    "15min": "5000",
    "30min": "5000",
    "1h": "3000",
    "4h": "2500",
    "1day": "2200",
    "1week": "900",
    "1month": "300",
  };

  return map[interval] || "1500";
}

function getImpulseContextRangeForProfile(
  chartDate,
  profile = getSupportedCsaTimeframeProfile("H1")
) {
  // IMPORTANT:
  // This range is ONLY for major-structure / Fib impulse discovery.
  // It must never redefine the authoritative CSA framework periods.
  //
  // The lookback is deliberately timeframe-specific so that:
  // - intraday charts can see the larger move that produced a breakout,
  // - higher timeframes receive proportionately broader history,
  // - the same final historical cutoff remains authoritative.
  const tf = comparableTimeframe(
    profile?.selectedTimeframe || "H1"
  ) || "H1";

  const lookbackDaysByTimeframe = {
    M1: 3,
    M5: 14,
    M15: 45,
    M30: 90,
    H1: 60,
    H4: 365,
    D1: 365 * 5,
    W1: 365 * 12,
    MN: 365 * 15,
  };

  const lookbackDays =
    Number(
      lookbackDaysByTimeframe[tf] || 60
    );

  const end =
    new Date(
      Date.UTC(
        chartDate.getUTCFullYear(),
        chartDate.getUTCMonth(),
        chartDate.getUTCDate()
      )
    );

  const start =
    addDays(end, -lookbackDays);

  return {
    start,
    end,
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
    lookbackDays,
    purpose: "impulse_context_only",
  };
}

function filterCandlesToStructureRange(
  candles = [],
  structureRange = null,
  profile = getSupportedCsaTimeframeProfile("H1")
) {
  if (
    !Array.isArray(candles) ||
    !structureRange?.startDate ||
    !structureRange?.endDate
  ) {
    return [];
  }

  return candles.filter((bar) => {
    const dateOnly =
      candleDateOnly(bar?.datetime);

    if (!dateOnly) return false;

    if (
      dateOnly <
        structureRange.startDate ||
      dateOnly >
        structureRange.endDate
    ) {
      return false;
    }

    if (
      profile?.structureMode ===
      "daily-in-week"
    ) {
      const date =
        new Date(
          `${dateOnly}T00:00:00.000Z`
        );

      if (
        Number.isNaN(
          date.getTime()
        )
      ) {
        return false;
      }

      const dayNum =
        date.getUTCDay();

      if (
        dayNum < 1 ||
        dayNum > 5
      ) {
        return false;
      }
    }

    return true;
  });
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



function buildApprovedMarketAreas(marketReference = null) {
  const areas = Array.isArray(marketReference?.csaAreas)
    ? marketReference.csaAreas
    : [];

  const seen = new Set();

  return areas
    .filter((area) => Number.isFinite(Number(area?.price)))
    .map((area, index) => {
      const price = Number(area.price);
      const type = String(area.type || "").toLowerCase();
      const key = `${type}:${price}`;

      if (seen.has(key)) return null;
      seen.add(key);

      return {
        id: `AREA_${index + 1}`,
        type,
        price,
        priceText: area.priceText || formatPrice(price),
        date: area.date || null,
        source: "twelve_data",
        confidence: "high",
      };
    })
    .filter(Boolean);
}

function getFrameworkChartReconciliationTolerance({
  symbol = "",
  atr = 0,
}) {
  // This tolerance is deliberately much tighter than the broad "approved
  // market price" tolerance. It is only for matching one already-selected
  // framework level to the SAME visible chart level.
  //
  // Examples for normal non-JPY FX:
  // - 0.69858 -> 0.69845 is acceptable.
  // - 0.69634 -> 0.69618/0.69620 is acceptable.
  // - 0.69634 -> 0.69845 is far too large and must be rejected.
  return Math.max(
    getCleanBreakTolerance(symbol) * 1.5,
    Number(atr || 0) * 0.08
  );
}

function getApprovedPriceTolerance(symbol = "") {
  const base = getCleanBreakTolerance(symbol);
  const compact = comparableInstrument(symbol);

  if (compact.includes("BTC")) return Math.max(base * 3, 50);
  if (compact.includes("XAU")) return Math.max(base * 3, 0.6);
  if (compact.includes("JPY")) return Math.max(base * 3, 0.06);
  return Math.max(base * 3, 0.0006);
}

function isPriceApproved(price, approvedAreas = [], symbol = "") {
  const value = Number(price);
  if (!Number.isFinite(value)) return false;

  const tolerance = getApprovedPriceTolerance(symbol);

  return approvedAreas.some(
    (area) =>
      Number.isFinite(Number(area?.price)) &&
      Math.abs(Number(area.price) - value) <= tolerance
  );
}

function sanitizeUserFacingPriceText(
  value,
  approvedAreas = [],
  symbol = "",
  fallback = "the confirmed area"
) {
  const textValue = String(value || "").trim();
  if (!textValue) return textValue;

  return textValue.replace(
    /\b\d{1,6}(?:\.\d{1,8})\b/g,
    (match) => {
      const numeric = Number(match);

      // Keep non-price values such as scores, ratios, years, and counts.
      if (!Number.isFinite(numeric)) return match;
      if (/^\d{4}$/.test(match) && numeric >= 1900 && numeric <= 2200) return match;
      if (numeric >= 0 && numeric <= 100 && !match.includes(".")) return match;

      return isPriceApproved(numeric, approvedAreas, symbol)
        ? match
        : fallback;
    }
  );
}

function sanitizeVisualReviewMarketPrices({
  visualReview = null,
  marketReference = null,
  symbol = "",
}) {
  if (!visualReview) return visualReview;

  const approvedAreas = buildApprovedMarketAreas(marketReference);
  const safeText = (value) =>
    sanitizeUserFacingPriceText(value, approvedAreas, symbol);

  return {
    ...visualReview,
    quickVerdict: safeText(visualReview.quickVerdict),
    plainMarketDirection: safeText(visualReview.plainMarketDirection),
    whatThisMeans: safeText(visualReview.whatThisMeans),
    timeframeSummary: safeText(visualReview.timeframeSummary),
    bestAreaToWatch: safeText(visualReview.bestAreaToWatch),
    visualSummary: safeText(visualReview.visualSummary),
    chartMarkupAssessment: safeText(visualReview.chartMarkupAssessment),
    tradeVisibilityReason: safeText(visualReview.tradeVisibilityReason),
    entryEvidence: safeText(visualReview.entryEvidence),
    riskEvidence: safeText(visualReview.riskEvidence),
    mainWarning: safeText(visualReview.mainWarning),
    coachVerdict: safeText(visualReview.coachVerdict),
    csaSimilarities: normalizeArrayOfStrings(
      visualReview.csaSimilarities,
      []
    ).map(safeText),
    csaDifferences: normalizeArrayOfStrings(
      visualReview.csaDifferences,
      []
    ).map(safeText),
    chartSpecificStrengths: normalizeArrayOfStrings(
      visualReview.chartSpecificStrengths,
      []
    ).map(safeText),
    chartSpecificWeaknesses: normalizeArrayOfStrings(
      visualReview.chartSpecificWeaknesses,
      []
    ).map(safeText),
    visibleMarkedLevels: Array.isArray(visualReview.visibleMarkedLevels)
      ? visualReview.visibleMarkedLevels.slice(0, 12).map((item) => ({
          type: String(item?.type || "").toLowerCase(),
          description: safeUserText(item?.description || ""),
          displayedPrice:
            nullablePositiveNumber(item?.displayedPrice) ||
            extractNumericPriceFromLabel(item?.platformLabel) ||
            extractNumericPriceFromLabel(item?.description),
          approximatePrice: nullablePositiveNumber(item?.approximatePrice),
          platformLabel: String(item?.platformLabel || "").trim(),
          frameworkPeriodHint: safeUserText(
            item?.frameworkPeriodHint ||
            item?.periodHint ||
            item?.sourcePeriod ||
            ""
          ),
          frameworkSideHint: safeUserText(
            item?.frameworkSideHint || ""
          ),
          extractionSource: safeUserText(
            item?.extractionSource || ""
          ),
          extractionConfidence: safeUserText(
            item?.extractionConfidence || ""
          ),
        }))
      : [],
    visibleHorizontalLines: Array.isArray(visualReview.visibleHorizontalLines)
      ? visualReview.visibleHorizontalLines.slice(0, 16).map((item) => ({
          colour: String(item?.colour || "other").toLowerCase(),
          description: safeUserText(item?.description || ""),
          displayedPrice:
            nullablePositiveNumber(item?.displayedPrice) ||
            extractNumericPriceFromLabel(item?.platformLabel) ||
            extractNumericPriceFromLabel(item?.description),
          approximatePrice: nullablePositiveNumber(item?.approximatePrice),
          platformLabel: String(item?.platformLabel || "").trim(),
          frameworkPeriodHint: safeUserText(
            item?.frameworkPeriodHint ||
            item?.periodHint ||
            item?.sourcePeriod ||
            ""
          ),
          frameworkSideHint: safeUserText(
            item?.frameworkSideHint || ""
          ),
          extractionSource: safeUserText(
            item?.extractionSource || ""
          ),
          extractionConfidence: safeUserText(
            item?.extractionConfidence || ""
          ),
        }))
      : [],
    activeEntryAreas: Array.isArray(visualReview.activeEntryAreas)
      ? visualReview.activeEntryAreas.slice(0, 5)
      : [],
    preferredEntryArea:
      visualReview.preferredEntryArea && typeof visualReview.preferredEntryArea === "object"
        ? {
            ...visualReview.preferredEntryArea,
            direction: String(visualReview.preferredEntryArea.direction || "none").toLowerCase(),
            areaType: String(visualReview.preferredEntryArea.areaType || "none").toLowerCase(),
            zoneLow: Number.isFinite(Number(visualReview.preferredEntryArea.zoneLow))
              ? Number(visualReview.preferredEntryArea.zoneLow)
              : null,
            zoneHigh: Number.isFinite(Number(visualReview.preferredEntryArea.zoneHigh))
              ? Number(visualReview.preferredEntryArea.zoneHigh)
              : null,
            zoneText: String(visualReview.preferredEntryArea.zoneText || "").trim(),
            priceStatus: String(visualReview.preferredEntryArea.priceStatus || "unclear").toLowerCase(),
            triggerPresent: visualReview.preferredEntryArea.triggerPresent === true,
            triggerDescription: String(visualReview.preferredEntryArea.triggerDescription || "").trim(),
          }
        : null,
  };
}

function removeWeekdayNamesFromUserText(value = "") {
  return String(value || "")
    .replace(/\bMonday(?:'s)?\b/gi, "the first key range")
    .replace(/\b(?:Tuesday|Wednesday|Thursday|Friday)(?:'s)?\b/gi, "an earlier period")
    .replace(/\s{2,}/g, " ")
    .trim();
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


function isIntradayCsaTimeframe(timeframe = "") {
  return ["M1", "M5", "M15", "M30", "H1", "H4"].includes(
    comparableTimeframe(timeframe)
  );
}

function previousDateText(dateText = "") {
  const parsed = parseISODateOnly(dateText);
  if (!parsed) return null;
  return formatDateOnly(addDays(parsed, -1));
}

function normalizeCutoffMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["selected_day", "end_of_day", "day"].includes(normalized)) {
    return "selected_day";
  }
  if (["exact", "exact_time", "specific_time"].includes(normalized)) {
    return "exact";
  }
  return "final_visible";
}

function normalizeCutoffTime(value = "") {
  const text = String(value || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "";
}

function normalizeRequestedTimezone({
  timezone = "",
  timezoneMode = "",
  browserTimezone = "",
}) {
  const mode = String(timezoneMode || "").trim().toLowerCase();
  const explicit = String(timezone || "").trim();
  const browser = String(browserTimezone || "").trim();

  if (mode === "utc") return "UTC";
  if (mode === "device" && browser) return browser;
  if (mode === "custom" && explicit) return explicit;
  if (explicit && explicit !== "chart") return explicit;
  if (browser) return browser;
  return "UTC";
}

function resolveTwelveDataChartCutoff({
  chartDetection = null,
  dateDecision = null,
  selectedDateText = "",
  cutoffMode = "final_visible",
  cutoffTime = "",
  timeframe = "H1",
  analysisType = "post-trade",
}) {
  const mode = normalizeCutoffMode(cutoffMode);
  const detectedDate = String(chartDetection?.latestVisibleDate || "").trim();
  const detectedDateConfidence = String(
    chartDetection?.dateConfidence || "low"
  ).toLowerCase();
  const detectedTime = String(
    chartDetection?.latestVisibleTime || ""
  ).trim();
  const detectedTimeConfidence = String(
    chartDetection?.latestVisibleTimeConfidence || "low"
  ).toLowerCase();

  const usableDetectedDate =
    /^\d{4}-\d{2}-\d{2}$/.test(detectedDate) &&
    ["high", "medium"].includes(detectedDateConfidence);

  const usableDetectedTime =
    /^([01]\d|2[0-3]):[0-5]\d$/.test(detectedTime) &&
    ["high", "medium"].includes(detectedTimeConfidence);

  const selected =
    /^\d{4}-\d{2}-\d{2}$/.test(String(selectedDateText || "").trim())
      ? String(selectedDateText).trim()
      : dateDecision?.selectedDateText || dateDecision?.finalDateText || null;

  if (mode === "exact") {
    const exactTime = normalizeCutoffTime(cutoffTime);
    if (!selected || !exactTime) {
      return {
        endDateTime: null,
        resolvedDate: selected || null,
        source: "invalid-exact-cutoff",
        mode,
        precision: "invalid",
        exactVisibleCutoff: false,
        allowMarketDirectionalBias: false,
        reason:
          "Exact historical mode requires both a valid date and a valid time.",
      };
    }

    return {
      endDateTime: `${selected} ${exactTime}:59`,
      resolvedDate: selected,
      source: "user-exact-date-time",
      mode,
      precision: "exact",
      exactVisibleCutoff: true,
      allowMarketDirectionalBias: true,
      reason:
        "The market review was limited to the exact historical date and time selected by the user.",
    };
  }

  if (mode === "selected_day") {
    if (!selected) {
      return {
        endDateTime: null,
        resolvedDate: null,
        source: "missing-selected-day",
        mode,
        precision: "invalid",
        exactVisibleCutoff: false,
        allowMarketDirectionalBias: false,
        reason: "No selected chart date was available.",
      };
    }

    return {
      endDateTime: `${selected} 23:59:59`,
      resolvedDate: selected,
      source: "user-selected-day-end-utc",
      mode,
      precision: "day",
      timezone: "UTC",
      dayBoundary: "UTC",
      exactVisibleCutoff: false,
      allowMarketDirectionalBias: true,
      reason:
        "The review uses the final completed candle available on the selected trading day using a stable UTC day boundary.",
    };
  }

  // Default beginner-friendly mode: analyse exactly where the screenshot ends.
  if (usableDetectedDate && usableDetectedTime) {
    return {
      endDateTime: `${detectedDate} ${detectedTime}:59`,
      resolvedDate: detectedDate,
      source: "chart-final-visible-candle",
      mode: "final_visible",
      precision: "exact-visible",
      exactVisibleCutoff: true,
      allowMarketDirectionalBias: true,
      reason:
        "The review was stopped at the final date and time visible on the uploaded chart.",
    };
  }

  if (usableDetectedDate) {
    return {
      endDateTime: `${detectedDate} 23:59:59`,
      resolvedDate: detectedDate,
      source: "chart-final-visible-day-fallback",
      mode: "final_visible",
      precision: "day",
      exactVisibleCutoff: false,
      allowMarketDirectionalBias: true,
      reason:
        "The final candle time was not readable, so the review uses the end of the final date visible on the chart.",
    };
  }

  if (selected) {
    return {
      endDateTime: `${selected} 23:59:59`,
      resolvedDate: selected,
      source: "selected-day-fallback",
      mode: "final_visible",
      precision: "day",
      exactVisibleCutoff: false,
      allowMarketDirectionalBias: true,
      reason:
        "The final visible date could not be read reliably, so the review uses the end of the selected chart date.",
    };
  }

  return {
    endDateTime: null,
    resolvedDate: null,
    source: "missing-cutoff",
    mode: "final_visible",
    precision: "invalid",
    exactVisibleCutoff: false,
    allowMarketDirectionalBias: false,
    reason: "No reliable historical cutoff could be established.",
  };
}

function normalizeTwelveDataDateTime(value = "") {
  const text = String(value || "").trim().replace("T", " ");
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return `${text}:00`;
  return text.slice(0, 19);
}

async function fetchTwelveDataStructureLevels({
  symbol,
  chartDate,
  timeframe = "H1",
  timezone = "UTC",
  analysisType = "post-trade",
  chartCutoff = null,
}) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const profile = getSupportedCsaTimeframeProfile(timeframe);

  const empty = (error, range = null) => ({
    ok: false,
    error,
    dailyLevels: [],
    timeframeCandles: [],
    impulseCandles: [],
    csaAreas: [],
    directionalBias: calculateCsaDirectionalBias([], symbol, profile),
    rawCandleCount: 0,
    filteredCandleCount: 0,
    weekRange: range,
    symbol,
    timezone,
    interval: profile.interval,
    profile,
    chartCutoff: chartCutoff || null,
  });

  if (!apiKey) return empty("TWELVE_DATA_API_KEY is missing on the server.");
  if (!symbol) return empty("Instrument/pair is missing or unsupported.");
  if (!chartDate) return empty("Final visible chart date is missing.");

  const structureRange =
    getStructureRangeForProfile(
      chartDate,
      profile,
      analysisType
    );

  const impulseRange =
    getImpulseContextRangeForProfile(
      chartDate,
      profile
    );

  const endDateTime =
    chartCutoff?.endDateTime ||
    `${structureRange.endDate} 23:59:59`;

  if (!endDateTime) {
    return empty(
      "A safe Twelve Data cutoff could not be established for this chart.",
      structureRange
    );
  }

  const params = new URLSearchParams({
    symbol,
    interval: profile.interval,
    start_date: `${impulseRange.startDate} 00:00:00`,
    end_date: endDateTime,
    timezone,
    order: "ASC",
    outputsize: getOutputSizeForInterval(profile.interval),
    apikey: apiKey,
  });

  console.log("Twelve Data historical cutoff:", {
    symbol,
    timeframe,
    analysisType,
    frameworkStartDate:
      `${structureRange.startDate} 00:00:00`,
    impulseStartDate:
      `${impulseRange.startDate} 00:00:00`,
    impulseLookbackDays:
      impulseRange.lookbackDays,
    endDate: endDateTime,
    cutoffSource: chartCutoff?.source || "legacy-date-end",
    cutoffTimezone: timezone,
    dayBoundary: chartCutoff?.dayBoundary || timezone,
    exactVisibleCutoff: chartCutoff?.exactVisibleCutoff === true,
    allowMarketDirectionalBias:
      chartCutoff?.allowMarketDirectionalBias !== false,
  });

  const response = await fetch(
    `${TWELVE_DATA_BASE_URL}?${params.toString()}`
  );
  const data = await response.json();

  if (
    !response.ok ||
    data.status === "error" ||
    !Array.isArray(data.values)
  ) {
    return {
      ...empty(
        data.message ||
          data.error ||
          `Twelve Data request failed with status ${response.status}.`,
        structureRange
      ),
      twelveDataStatus: data.status || "unknown",
    };
  }

  const rawCandles = data.values || [];
  const normalizedCutoff = normalizeTwelveDataDateTime(endDateTime);

  // Defence in depth: discard anything later than the screenshot cutoff
  // even if the provider returns an extra candle.
  const filteredCandles = rawCandles.filter((bar) => {
    const candleDateTime = normalizeTwelveDataDateTime(bar?.datetime);
    return (
      !normalizedCutoff ||
      !candleDateTime ||
      candleDateTime <= normalizedCutoff
    );
  });

  const excludedCandles = rawCandles.filter((bar) => {
    const candleDateTime = normalizeTwelveDataDateTime(bar?.datetime);
    return Boolean(
      normalizedCutoff &&
      candleDateTime &&
      candleDateTime > normalizedCutoff
    );
  });

  const sortedIncludedDateTimes = filteredCandles
    .map((bar) => normalizeTwelveDataDateTime(bar?.datetime))
    .filter(Boolean)
    .sort();

  const sortedExcludedDateTimes = excludedCandles
    .map((bar) => normalizeTwelveDataDateTime(bar?.datetime))
    .filter(Boolean)
    .sort();

  const lastIncludedCandle =
    sortedIncludedDateTimes.length > 0
      ? sortedIncludedDateTimes[sortedIncludedDateTimes.length - 1]
      : null;

  const firstExcludedCandle =
    sortedExcludedDateTimes.length > 0
      ? sortedExcludedDateTimes[0]
      : null;

  const normalizeMarketCandles = (
    candles = []
  ) =>
    candles
      .map((bar) => ({
        datetime:
          String(
            bar?.datetime || ""
          ),
        open:
          Number(bar?.open),
        high:
          Number(bar?.high),
        low:
          Number(bar?.low),
        close:
          Number(bar?.close),
      }))
      .filter(
        (bar) =>
          bar.datetime &&
          Number.isFinite(bar.open) &&
          Number.isFinite(bar.high) &&
          Number.isFinite(bar.low) &&
          Number.isFinite(bar.close)
      )
      .sort((a, b) =>
        a.datetime.localeCompare(
          b.datetime
        )
      );

  // BROAD history: used only by the deterministic major-structure /
  // Fibonacci impulse selector and broker-price mapping for that same swing.
  const impulseCandles =
    normalizeMarketCandles(
      filteredCandles
    );

  // NARROW authoritative framework history: used by CSA daily/weekly/monthly
  // period levels, historical direction, conversion lifecycle and structural
  // candidate quality. This preserves the existing CSA timeframe rules.
  const frameworkRawCandles =
    filterCandlesToStructureRange(
      filteredCandles,
      structureRange,
      profile
    );

  const timeframeCandles =
    normalizeMarketCandles(
      frameworkRawCandles
    );

  const dailyLevels =
    buildStructureLevelsFromCandles(
      frameworkRawCandles,
      structureRange,
      profile
    );
  const csaAreas =
    buildCsaAreas(
      dailyLevels,
      symbol,
      profile
    );

  console.log(
    "CSA market-data windows:",
    {
      symbol,
      timeframe,
      frameworkMode:
        profile?.structureMode ||
        null,
      frameworkStartDate:
        structureRange.startDate,
      frameworkEndDate:
        structureRange.endDate,
      frameworkCandleCount:
        timeframeCandles.length,
      impulseStartDate:
        impulseRange.startDate,
      impulseEndDate:
        candleDateOnly(
          endDateTime
        ) ||
        structureRange.endDate,
      impulseLookbackDays:
        impulseRange.lookbackDays,
      impulseCandleCount:
        impulseCandles.length,
      sameCutoff:
        true,
      rule:
        "framework_window_authoritative_impulse_window_context_only",
    }
  );

  const baseDirectionalBias =
    chartCutoff?.allowMarketDirectionalBias === false
      ? {
          ...calculateCsaDirectionalBias([], symbol, profile),
          bias: "Use uploaded chart",
          biasCode: "chart_primary",
          confidence: "low",
          traderBias:
            "The uploaded chart controls direction because the final visible intraday time could not be verified safely.",
          higherTimeframeView:
            "Twelve Data was restricted to avoid using candles formed after the screenshot.",
          timeframeView:
            "Use the price action visible on the uploaded chart for the review direction and setup status.",
          reason:
            chartCutoff?.reason ||
            "Later same-day market data was excluded.",
        }
      : calculateCsaDirectionalBias(dailyLevels, symbol, profile);

  const phaseForBias =
    deriveAuthoritativeCsaHistoricalPhase({
      marketReference: {
        dailyLevels,
        timeframeCandles,
        directionalBias: baseDirectionalBias,
        chartCutoff,
        profile,
      },
      symbol,
      timeframe,
    });

  const directionalBias =
    shouldUseAuthoritativePeriodPhase({ chartCutoff }) &&
    phaseForBias &&
    ["bullish", "bearish", "range"].includes(phaseForBias.direction)
      ? {
          ...baseDirectionalBias,
          bias:
            phaseForBias.direction === "bullish"
              ? "Bullish"
              : phaseForBias.direction === "bearish"
              ? "Bearish"
              : "Range-bound",
          biasCode: phaseForBias.direction,
          confidence:
            phaseForBias.direction === "range" ? "medium" : "high",
          traderBias:
            phaseForBias.direction === "bullish"
              ? "The historical CSA structure is bullish at the selected cutoff."
              : phaseForBias.direction === "bearish"
              ? "The historical CSA structure is bearish at the selected cutoff."
              : "The historical CSA structure is range-bound at the selected cutoff.",
          reason:
            `Historical direction is locked to the ${profile.sourceUnitPlural} available by the selected cutoff. ` +
            `Candles after ${chartCutoff?.resolvedDate || "the cutoff"} are excluded.`,
          cutoffPhase: phaseForBias,
        }
      : baseDirectionalBias;

  console.log("CSA historical direction lock:", {
    cutoffMode: chartCutoff?.mode || null,
    resolvedDate: chartCutoff?.resolvedDate || null,
    timeframe,
    structureMode: profile?.structureMode || null,
    sourcePeriods: profile?.sourceUnitPlural || null,
    direction: phaseForBias?.direction || null,
    phase: phaseForBias?.phase || null,
    phaseSource: phaseForBias?.source || null,
    lastIncludedCandle,
    firstExcludedCandle,
  });

  const approvedAreas = buildApprovedMarketAreas({ csaAreas });

  return {
    ok: dailyLevels.length > 0,
    error:
      dailyLevels.length > 0
        ? ""
        : `No usable ${profile.sourceUnitPlural} were returned before the chart cutoff.`,
    dailyLevels,
    timeframeCandles,
    impulseCandles,
    csaAreas,
    approvedAreas,
    directionalBias,
    rawCandleCount:
      rawCandles.length,
    filteredCandleCount:
      filteredCandles.length,
    frameworkCandleCount:
      timeframeCandles.length,
    impulseCandleCount:
      impulseCandles.length,
    weekRange:
      structureRange,
    impulseRange,
    symbol,
    timezone,
    interval: profile.interval,
    profile,
    chartCutoff: {
      ...chartCutoff,
      endDateTime,
      normalizedCutoff,
      lastIncludedCandle,
      firstExcludedCandle,
      includedCandleCount: filteredCandles.length,
      excludedCandleCount: excludedCandles.length,
    },
  };
}

function getLastTimeframeCandle(marketReference = null) {
  const candles = Array.isArray(marketReference?.timeframeCandles)
    ? marketReference.timeframeCandles
    : [];
  return candles.length ? candles[candles.length - 1] : null;
}

function getFinalVisiblePriceSyncTolerance({
  marketReference = null,
  symbol = "",
  targetPrice = null,
}) {
  const candles = Array.isArray(marketReference?.timeframeCandles)
    ? marketReference.timeframeCandles
    : [];
  const atr = averageTrueRange(candles, 14);
  const price = Number(targetPrice);

  return Math.max(
    Number.isFinite(atr) ? atr * 0.25 : 0,
    getCleanBreakTolerance(symbol) * 2,
    closePriceTolerance(symbol, Number.isFinite(price) ? price : 0),
    Number.EPSILON * 100
  );
}

function findBestCandleForVisibleClose({
  candles = [],
  targetPrice = null,
  tolerance = 0,
}) {
  const target = Number(targetPrice);
  if (!Array.isArray(candles) || !candles.length || !Number.isFinite(target)) {
    return null;
  }

  const candidates = candles
    .map((candle, index) => {
      const close = Number(candle?.close);
      const high = Number(candle?.high);
      const low = Number(candle?.low);
      const closeDistance = Number.isFinite(close)
        ? Math.abs(close - target)
        : Infinity;
      const targetInsideRange =
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        target >= Math.min(low, high) - tolerance * 0.10 &&
        target <= Math.max(low, high) + tolerance * 0.10;

      return {
        candle,
        index,
        closeDistance,
        targetInsideRange,
        acceptable:
          closeDistance <= tolerance ||
          (targetInsideRange && closeDistance <= tolerance * 1.5),
      };
    })
    .filter((item) => item.acceptable)
    .sort((a, b) => {
      if (a.closeDistance !== b.closeDistance) {
        return a.closeDistance - b.closeDistance;
      }
      // If the same price occurred more than once, prefer the later candle.
      return b.index - a.index;
    });

  return candidates.length ? candidates[0] : null;
}

async function synchronizeFinalVisibleMarketReference({
  marketReference = null,
  chartDetection = null,
  selectedDateText = "",
  symbol = "",
  timeframe = "H1",
  timezone = "UTC",
  analysisType = "post-trade",
  chartCutoff = null,
}) {
  const normalizedMode = normalizeCutoffMode(chartCutoff?.mode || "final_visible");
  const visiblePrice = asPositiveNumber(chartDetection?.latestVisiblePrice);
  const priceConfidence = String(
    chartDetection?.latestVisiblePriceConfidence || "low"
  ).toLowerCase();

  const unchanged = (reason, extra = {}) => ({
    marketReference,
    chartCutoff,
    adjusted: false,
    reason,
    diagnostics: {
      visiblePrice,
      priceConfidence,
      ...extra,
    },
  });

  if (normalizedMode !== "final_visible") {
    return unchanged("not_final_visible_mode");
  }

  if (!visiblePrice || !["high", "medium"].includes(priceConfidence)) {
    return unchanged("no_reliable_final_visible_price");
  }

  const initialCandles = Array.isArray(marketReference?.timeframeCandles)
    ? marketReference.timeframeCandles
    : [];
  const lastCandle = getLastTimeframeCandle(marketReference);
  const lastClose = asPositiveNumber(lastCandle?.close);
  const initialTolerance = getFinalVisiblePriceSyncTolerance({
    marketReference,
    symbol,
    targetPrice: visiblePrice,
  });
  const initialMismatch =
    lastClose === null ? null : Math.abs(lastClose - visiblePrice);

  if (
    lastClose !== null &&
    Number.isFinite(initialMismatch) &&
    initialMismatch <= initialTolerance
  ) {
    return unchanged("market_close_matches_final_visible_price", {
      lastMarketCandle: lastCandle?.datetime || null,
      lastMarketClose: lastClose,
      tolerance: initialTolerance,
      mismatch: initialMismatch,
    });
  }

  // First search the candles already fetched. This fixes the opposite problem:
  // the date is correct but an end-of-day fallback included candles after the
  // screenshot's final visible candle.
  let searchReference = marketReference;
  let match = findBestCandleForVisibleClose({
    candles: initialCandles,
    targetPrice: visiblePrice,
    tolerance: initialTolerance,
  });
  let searchSource = "initial_market_reference";

  // If the visible price is not present in the initial series, the chart's
  // rightmost printed date may simply be the last axis tick, while later
  // candles extend into the next calendar day. In Final Visible mode only,
  // use the user's selected chart date as a tightly bounded search horizon.
  if (!match) {
    const currentResolvedDate = parseISODateOnly(chartCutoff?.resolvedDate || "");
    const selectedDate = parseISODateOnly(selectedDateText || "");
    const gapDays =
      currentResolvedDate && selectedDate
        ? getDaysBetweenDates(currentResolvedDate, selectedDate)
        : null;
    const allowedGapDays = getAllowedFutureDateGapDays(timeframe);

    const canExtendSearch =
      selectedDate &&
      Number.isFinite(gapDays) &&
      gapDays >= 0 &&
      gapDays <= allowedGapDays;

    if (canExtendSearch) {
      const extendedCutoff = {
        ...(chartCutoff || {}),
        endDateTime: `${formatDateOnly(selectedDate)} 23:59:59`,
        resolvedDate: formatDateOnly(selectedDate),
        source: "final-visible-price-sync-search",
        mode: "final_visible",
        precision: "price-search-window",
        exactVisibleCutoff: false,
        allowMarketDirectionalBias: true,
        reason:
          "The final visible screenshot price did not exist before the detected right-edge date, so the selected chart date was used only as a bounded search horizon for the matching candle.",
      };

      const extendedReference = await fetchTwelveDataStructureLevels({
        symbol,
        chartDate: selectedDate,
        timeframe,
        timezone,
        analysisType,
        chartCutoff: extendedCutoff,
      });

      const extendedTolerance = getFinalVisiblePriceSyncTolerance({
        marketReference: extendedReference,
        symbol,
        targetPrice: visiblePrice,
      });

      const extendedMatch = findBestCandleForVisibleClose({
        candles: extendedReference?.timeframeCandles || [],
        targetPrice: visiblePrice,
        tolerance: extendedTolerance,
      });

      if (extendedMatch) {
        searchReference = extendedReference;
        match = extendedMatch;
        searchSource = "bounded_selected_date_extension";
      }
    }
  }

  if (!match?.candle?.datetime) {
    console.log("Final visible price synchronization:", {
      adjusted: false,
      reason: "matching_candle_not_found",
      visiblePrice,
      priceConfidence,
      detectedVisibleDate: chartDetection?.latestVisibleDate || null,
      detectedVisibleTime: chartDetection?.latestVisibleTime || null,
      selectedDateText: selectedDateText || null,
      lastMarketCandle: lastCandle?.datetime || null,
      lastMarketClose: lastClose,
      initialMismatch,
      initialTolerance,
    });
    return unchanged("matching_candle_not_found", {
      lastMarketCandle: lastCandle?.datetime || null,
      lastMarketClose: lastClose,
      tolerance: initialTolerance,
      mismatch: initialMismatch,
    });
  }

  const matchedDateTime = normalizeTwelveDataDateTime(match.candle.datetime);
  const matchedDate = candleDateOnly(matchedDateTime);
  const matchedDateObject = parseISODateOnly(matchedDate);

  if (!matchedDateTime || !matchedDateObject) {
    return unchanged("matched_candle_datetime_invalid");
  }

  const exactCutoff = {
    ...(chartCutoff || {}),
    endDateTime: matchedDateTime,
    resolvedDate: matchedDate,
    source: "chart-final-visible-price-synchronized",
    mode: "final_visible",
    precision: "price-synchronized",
    exactVisibleCutoff: true,
    allowMarketDirectionalBias: true,
    visiblePrice,
    matchedMarketClose: Number(match.candle.close),
    matchedMarketCandle: matchedDateTime,
    reason:
      "The external OHLC series was synchronized to the final visible screenshot close before structure, lifecycle and Fibonacci calculations were performed.",
  };

  const synchronizedReference = await fetchTwelveDataStructureLevels({
    symbol,
    chartDate: matchedDateObject,
    timeframe,
    timezone,
    analysisType,
    chartCutoff: exactCutoff,
  });

  const synchronizedLast = getLastTimeframeCandle(synchronizedReference);
  const synchronizedClose = asPositiveNumber(synchronizedLast?.close);
  const synchronizedTolerance = getFinalVisiblePriceSyncTolerance({
    marketReference: synchronizedReference,
    symbol,
    targetPrice: visiblePrice,
  });
  const synchronizedMismatch =
    synchronizedClose === null
      ? null
      : Math.abs(synchronizedClose - visiblePrice);

  const verified =
    synchronizedClose !== null &&
    Number.isFinite(synchronizedMismatch) &&
    synchronizedMismatch <= synchronizedTolerance;

  console.log("Final visible price synchronization:", {
    adjusted: verified,
    searchSource,
    visiblePrice,
    priceConfidence,
    detectedVisibleDate: chartDetection?.latestVisibleDate || null,
    detectedVisibleTime: chartDetection?.latestVisibleTime || null,
    selectedDateText: selectedDateText || null,
    originalCutoff: chartCutoff?.endDateTime || null,
    originalLastMarketCandle: lastCandle?.datetime || null,
    originalLastMarketClose: lastClose,
    matchedMarketCandle: matchedDateTime,
    matchedMarketClose: Number(match.candle.close),
    synchronizedLastMarketCandle: synchronizedLast?.datetime || null,
    synchronizedLastMarketClose: synchronizedClose,
    synchronizedMismatch,
    synchronizedTolerance,
  });

  if (!verified) {
    return unchanged("synchronized_close_failed_verification", {
      matchedMarketCandle: matchedDateTime,
      matchedMarketClose: Number(match.candle.close),
      synchronizedLastMarketClose: synchronizedClose,
      synchronizedMismatch,
      synchronizedTolerance,
    });
  }

  return {
    marketReference: synchronizedReference,
    chartCutoff: exactCutoff,
    adjusted: true,
    reason: "final_visible_price_synchronized",
    diagnostics: {
      searchSource,
      visiblePrice,
      priceConfidence,
      matchedMarketCandle: matchedDateTime,
      matchedMarketClose: Number(match.candle.close),
      synchronizedLastMarketClose: synchronizedClose,
      synchronizedMismatch,
      synchronizedTolerance,
    },
  };
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

const CHART_VALIDATION_RESCUE_PROMPT = `
You are a second-pass financial chart verifier.

Return ONLY valid JSON.

Decide only whether the uploaded image contains a usable financial trading chart.
Do NOT perform trading analysis.

A chart should PASS when the image clearly contains substantial plotted financial price movement such as candles, bars, or a price line and the chart is the main analytical object.

Normal MetaTrader, TradingView, cTrader, broker-platform, or desktop chart-window content is allowed:
- headers;
- account text;
- toolbars;
- tabs;
- grid;
- indicators;
- horizontal levels;
- drawings;
- price labels;
- bid/ask lines.

Do NOT call a normal trading-platform chart "nested" merely because platform chrome is visible.

Only FAIL when:
- there is no financial price chart;
- the price chart is genuinely tiny inside an unrelated outer page/dashboard/document;
- price movement is unreadable or essentially absent;
- the image is blank/loading/severely corrupted.

Do not require the exact symbol, timeframe, date, or final price to be readable in order to verify that it is a chart.

Return exactly:
{
  "isTradingChart": true,
  "validationConfidence": "high or medium or low",
  "hasVisiblePriceMovement": true,
  "hasPriceScale": true,
  "hasTimeAxis": true,
  "chartIsMainSubject": true,
  "chartPlatformDetected": true,
  "hasUsablePriceData": true,
  "visibleCandleCount": 50,
  "chartOccupancyPercent": 80,
  "isNestedChart": false,
  "isChartReadableAtCurrentSize": true,
  "chartDataQuality": "usable",
  "reason": "brief reason"
}
`;

function optionalBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function buildChartValidationEvidence(parsed = {}) {
  const visibleCandleCount =
    Number.isFinite(Number(parsed?.visibleCandleCount))
      ? Math.max(0, Number(parsed.visibleCandleCount))
      : 0;

  const occupancy =
    Number.isFinite(Number(parsed?.chartOccupancyPercent))
      ? Math.max(0, Math.min(100, Number(parsed.chartOccupancyPercent)))
      : 0;

  const hasVisiblePriceMovement =
    optionalBoolean(parsed?.hasVisiblePriceMovement);
  const hasPriceScale =
    optionalBoolean(parsed?.hasPriceScale);
  const hasTimeAxis =
    optionalBoolean(parsed?.hasTimeAxis);
  const chartIsMainSubject =
    optionalBoolean(parsed?.chartIsMainSubject);
  const chartPlatformDetected =
    optionalBoolean(parsed?.chartPlatformDetected);
  const hasUsablePriceData =
    optionalBoolean(parsed?.hasUsablePriceData);
  const isReadable =
    optionalBoolean(parsed?.isChartReadableAtCurrentSize);
  const isNested =
    optionalBoolean(parsed?.isNestedChart);

  const quality =
    String(parsed?.chartDataQuality || "").trim().toLowerCase();

  let score = 0;
  const reasons = [];

  if (hasVisiblePriceMovement === true) {
    score += 3;
    reasons.push("visible_price_movement");
  }

  if (visibleCandleCount >= 15) {
    score += 3;
    reasons.push("enough_visible_bars");
  } else if (visibleCandleCount >= 8) {
    score += 1;
    reasons.push("some_visible_bars");
  }

  if (hasPriceScale === true) {
    score += 2;
    reasons.push("price_scale");
  }

  if (hasTimeAxis === true) {
    score += 2;
    reasons.push("time_axis");
  }

  if (chartIsMainSubject === true) {
    score += 2;
    reasons.push("main_subject");
  }

  if (chartPlatformDetected === true) {
    score += 1;
    reasons.push("trading_platform_context");
  }

  if (hasUsablePriceData === true) {
    score += 2;
    reasons.push("usable_price_data");
  }

  if (isReadable === true) {
    score += 2;
    reasons.push("readable");
  }

  if (occupancy >= 25) {
    score += 1;
    reasons.push("sufficient_occupancy");
  }

  if (parsed?.detectedInstrument) {
    score += 1;
    reasons.push("instrument_visible");
  }

  if (parsed?.detectedTimeframe) {
    score += 1;
    reasons.push("timeframe_visible");
  }

  if (parsed?.latestVisibleDate) {
    score += 1;
    reasons.push("date_axis_context");
  }

  if (
    Number.isFinite(Number(parsed?.latestVisiblePrice)) &&
    Number(parsed.latestVisiblePrice) > 0
  ) {
    score += 1;
    reasons.push("visible_price_value");
  }

  const explicitSevereQuality =
    ["blank", "loading", "corrupt", "corrupted", "unreadable"]
      .includes(quality);

  const genuinelyTinyNestedChart =
    isNested === true &&
    chartIsMainSubject === false &&
    occupancy > 0 &&
    occupancy < 25;

  const strongChartEvidence =
    score >= 8 ||
    (
      visibleCandleCount >= 15 &&
      (
        hasVisiblePriceMovement === true ||
        hasUsablePriceData === true
      ) &&
      (
        hasPriceScale === true ||
        hasTimeAxis === true ||
        isReadable === true ||
        occupancy >= 25 ||
        Boolean(parsed?.detectedInstrument) ||
        Boolean(parsed?.detectedTimeframe)
      )
    );

  const hardReject =
    genuinelyTinyNestedChart ||
    (
      explicitSevereQuality &&
      !strongChartEvidence
    ) ||
    (
      hasVisiblePriceMovement === false &&
      visibleCandleCount === 0 &&
      hasUsablePriceData === false &&
      score < 4
    );

  return {
    score,
    reasons,
    visibleCandleCount,
    occupancy,
    hasVisiblePriceMovement,
    hasPriceScale,
    hasTimeAxis,
    chartIsMainSubject,
    chartPlatformDetected,
    hasUsablePriceData,
    isReadable,
    isNested,
    quality,
    strongChartEvidence,
    genuinelyTinyNestedChart,
    hardReject,
  };
}

function mergeChartValidationPasses(first = {}, rescue = {}) {
  const preferBoolean = (firstValue, rescueValue) => {
    if (rescueValue === true) return true;
    if (firstValue === true) return true;
    if (rescueValue === false && firstValue === false) return false;
    if (rescueValue !== undefined) return rescueValue;
    return firstValue;
  };

  return {
    ...first,
    isTradingChart:
      first?.isTradingChart === true ||
      rescue?.isTradingChart === true,
    validationConfidence:
      rescue?.validationConfidence ||
      first?.validationConfidence ||
      "low",
    hasVisiblePriceMovement:
      preferBoolean(
        first?.hasVisiblePriceMovement,
        rescue?.hasVisiblePriceMovement
      ),
    hasPriceScale:
      preferBoolean(first?.hasPriceScale, rescue?.hasPriceScale),
    hasTimeAxis:
      preferBoolean(first?.hasTimeAxis, rescue?.hasTimeAxis),
    chartIsMainSubject:
      preferBoolean(first?.chartIsMainSubject, rescue?.chartIsMainSubject),
    chartPlatformDetected:
      preferBoolean(first?.chartPlatformDetected, rescue?.chartPlatformDetected),
    hasUsablePriceData:
      preferBoolean(first?.hasUsablePriceData, rescue?.hasUsablePriceData),
    isNestedChart:
      rescue?.isNestedChart === false
        ? false
        : first?.isNestedChart,
    isChartReadableAtCurrentSize:
      preferBoolean(
        first?.isChartReadableAtCurrentSize,
        rescue?.isChartReadableAtCurrentSize
      ),
    visibleCandleCount:
      Math.max(
        Number(first?.visibleCandleCount || 0),
        Number(rescue?.visibleCandleCount || 0)
      ),
    chartOccupancyPercent:
      Math.max(
        Number(first?.chartOccupancyPercent || 0),
        Number(rescue?.chartOccupancyPercent || 0)
      ),
    chartDataQuality:
      rescue?.chartDataQuality ||
      first?.chartDataQuality ||
      "usable",
  };
}

async function runChartValidationRescue({ imageBase64, mimeType }) {
  try {
    const response = await runVisionModel({
      systemPrompt: CHART_VALIDATION_RESCUE_PROMPT,
      userText:
        "Verify whether this uploaded image is a usable financial trading chart. Return only JSON.",
      imageBase64,
      mimeType,
      maxTokens: 350,
      openaiModel: "gpt-4.1",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });

    return extractJsonObject(response.text || "") || null;
  } catch (error) {
    console.error("Chart validation rescue error:", error);
    return null;
  }
}

async function detectChartContextFromImage({ imageBase64, mimeType, submittedInstrument = "", selectedTimeframe = "", selectedDateText = "", analysisType = "post-trade" }) {
  const fallback = (reason) => ({
    ok: false,
    isTradingChart: false,
    chartValidityReason: reason,
    validationConfidence: "low",
    hasVisiblePriceMovement: null,
    hasPriceScale: null,
    hasTimeAxis: null,
    chartIsMainSubject: null,
    chartPlatformDetected: null,
    hasUsablePriceData: false,
    visibleCandleCount: 0,
    chartDataQuality: "unclear",
    chartOccupancyPercent: 0,
    isNestedChart: false,
    isChartReadableAtCurrentSize: false,
    selectedDateVisible: false,
    insufficientDataReason: reason,
    detectedInstrument: null,
    detectedTimeframe: null,
    latestVisibleDate: null,
    latestVisibleTime: null,
    latestVisibleTimeConfidence: "low",
    latestVisiblePrice: null,
    latestVisiblePriceConfidence: "low",
    dateConfidence: "low",
    visibleTrigger: null,
    rejectedTriggerContext: null,
    triggerDirection: null,
    triggerConfidence: "low",
    notes: reason,
    raw: "",
    validationEvidenceScore: 0,
    validationRescueUsed: false,
    validationHardReject: true,
  });
  if (!isAiProviderConfigured()) return fallback(getAiConfigurationError());

  try {
    const response = await runVisionModel({
      systemPrompt: CHART_DETECTION_PROMPT,
      userText: `Inspect this uploaded chart image.\nSelected instrument: ${submittedInstrument || "not provided"}\nSelected timeframe: ${selectedTimeframe || "not provided"}\nSelected chart/trade date: ${selectedDateText || "not provided"}\nAnalysis type: ${analysisType || "post-trade"}\nReturn only JSON.`,
      imageBase64,
      mimeType,
      maxTokens: 700,
      openaiModel: "gpt-4.1",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });

    let parsed =
      extractJsonObject(response.text || "");

    if (!parsed) {
      return fallback(
        "Chart validation did not return usable JSON."
      );
    }

    let evidence =
      buildChartValidationEvidence(parsed);

    const modelMarkedValid =
      parsed?.isTradingChart === true;

    let rescueUsed = false;
    let rescueParsed = null;

    /*
     * V4.5.2:
     * If the first pass rejects the image but there is still plausible
     * chart evidence, run one focused chart-only verification pass.
     */
    const shouldTryRescue =
      !modelMarkedValid;

    if (shouldTryRescue) {
      rescueParsed =
        await runChartValidationRescue({
          imageBase64,
          mimeType,
        });

      if (rescueParsed) {
        rescueUsed = true;
        parsed =
          mergeChartValidationPasses(
            parsed,
            rescueParsed
          );
        evidence =
          buildChartValidationEvidence(
            parsed
          );
      }
    }

    const visibleCandleCount =
      evidence.visibleCandleCount;

    const occupancy =
      evidence.occupancy;

    const rescueModelMarkedValid =
      rescueParsed?.isTradingChart ===
      true;

    const rescuedByEvidence =
      !modelMarkedValid &&
      !rescueModelMarkedValid &&
      evidence.strongChartEvidence &&
      !evidence.hardReject;

    const isTradingChart =
      !evidence.hardReject &&
      (
        modelMarkedValid ||
        rescueModelMarkedValid ||
        rescuedByEvidence
      );

    const rawTrigger = parsed?.visibleTrigger || null;
    const triggerConfidence =
      parsed?.triggerConfidence || "low";

    const cleanTrigger = sanitizeVisibleTrigger(
      rawTrigger,
      triggerConfidence
    );

    const rawQuality =
      String(
        parsed?.chartDataQuality || ""
      )
        .trim()
        .toLowerCase();

    const quality =
      isTradingChart
        ? (
            ["blank", "loading", "corrupt", "corrupted"].includes(rawQuality)
              ? "usable"
              : rawQuality || "usable"
          )
        : rawQuality || "unclear";

    const normalizedReadable =
      isTradingChart
        ? (
            parsed?.isChartReadableAtCurrentSize === false
              ? evidence.strongChartEvidence
              : true
          )
        : false;

    const normalizedNested =
      isTradingChart &&
      evidence.strongChartEvidence &&
      (
        evidence.chartIsMainSubject === true ||
        occupancy >= 25
      )
        ? false
        : parsed?.isNestedChart === true;

    const normalizedUsablePriceData =
      isTradingChart
        ? (
            parsed?.hasUsablePriceData === false
              ? evidence.strongChartEvidence
              : true
          )
        : false;

    console.log(
      "CSA v4.5.2 chart validation:",
      {
        buildId: CSA_BUILD_ID,
        modelMarkedValid,
        rescueUsed,
        rescueModelMarkedValid,
        rescuedByEvidence,
        isTradingChart,
        evidenceScore: evidence.score,
        evidenceReasons: evidence.reasons,
        strongChartEvidence:
          evidence.strongChartEvidence,
        hardReject: evidence.hardReject,
        visibleCandleCount,
        occupancy,
        hasVisiblePriceMovement:
          evidence.hasVisiblePriceMovement,
        hasPriceScale:
          evidence.hasPriceScale,
        hasTimeAxis:
          evidence.hasTimeAxis,
        chartIsMainSubject:
          evidence.chartIsMainSubject,
        chartPlatformDetected:
          evidence.chartPlatformDetected,
        rawHasUsablePriceData:
          parsed?.hasUsablePriceData,
        normalizedUsablePriceData,
        rawIsNestedChart:
          parsed?.isNestedChart,
        normalizedNested,
        rawReadable:
          parsed?.isChartReadableAtCurrentSize,
        normalizedReadable,
        detectedInstrument:
          parsed?.detectedInstrument,
        detectedTimeframe:
          parsed?.detectedTimeframe,
        latestVisibleDate:
          parsed?.latestVisibleDate || null,
        latestVisibleTime:
          parsed?.latestVisibleTime || null,
        latestVisiblePrice:
          Number.isFinite(
            Number(parsed?.latestVisiblePrice)
          )
            ? Number(parsed.latestVisiblePrice)
            : null,
        reason:
          parsed?.chartValidityReason ||
          rescueParsed?.reason ||
          null,
      }
    );

    return {
      ok: true,
      isTradingChart,
      chartValidityReason:
        isTradingChart &&
        !modelMarkedValid
          ? (
              rescueParsed?.reason ||
              "The uploaded image contains sufficient evidence of a usable financial trading chart."
            )
          : (
              parsed?.chartValidityReason ||
              rescueParsed?.reason ||
              (
                isTradingChart
                  ? "The uploaded image contains sufficient evidence of a usable financial trading chart."
                  : "The uploaded image could not be verified as a usable financial trading chart."
              )
            ),
      validationConfidence:
        parsed?.validationConfidence ||
        rescueParsed?.validationConfidence ||
        (
          evidence.score >= 10
            ? "high"
            : evidence.score >= 7
            ? "medium"
            : "low"
        ),
      validationEvidenceScore:
        evidence.score,
      validationEvidenceReasons:
        evidence.reasons,
      validationRescueUsed:
        rescueUsed,
      validationHardReject:
        evidence.hardReject,
      hasVisiblePriceMovement:
        evidence.hasVisiblePriceMovement,
      hasPriceScale:
        evidence.hasPriceScale,
      hasTimeAxis:
        evidence.hasTimeAxis,
      chartIsMainSubject:
        evidence.chartIsMainSubject,
      chartPlatformDetected:
        evidence.chartPlatformDetected,
      hasUsablePriceData:
        normalizedUsablePriceData,
      visibleCandleCount,
      chartDataQuality: quality,
      chartOccupancyPercent: occupancy,
      isNestedChart:
        normalizedNested,
      isChartReadableAtCurrentSize:
        normalizedReadable,
      selectedDateVisible: isTradingChart ? parsed?.selectedDateVisible === true : false,
      insufficientDataReason: parsed?.insufficientDataReason || (!isTradingChart ? "The uploaded image is not a financial trading chart." : null),
      detectedInstrument: isTradingChart ? parsed?.detectedInstrument || null : null,
      detectedTimeframe: isTradingChart ? parsed?.detectedTimeframe || null : null,
      latestVisibleDate: isTradingChart ? parsed?.latestVisibleDate || null : null,
      latestVisibleTime:
        isTradingChart && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(parsed?.latestVisibleTime || ""))
          ? String(parsed.latestVisibleTime)
          : null,
      latestVisibleTimeConfidence:
        isTradingChart
          ? String(parsed?.latestVisibleTimeConfidence || "low").toLowerCase()
          : "low",
      latestVisiblePrice:
        isTradingChart && Number.isFinite(Number(parsed?.latestVisiblePrice)) && Number(parsed.latestVisiblePrice) > 0
          ? Number(parsed.latestVisiblePrice)
          : null,
      latestVisiblePriceConfidence:
        isTradingChart
          ? String(parsed?.latestVisiblePriceConfidence || "low").toLowerCase()
          : "low",
      dateConfidence: isTradingChart ? parsed?.dateConfidence || "low" : "low",
      visibleTrigger: isTradingChart ? cleanTrigger : null,
      rejectedTriggerContext: isTradingChart && rawTrigger && !cleanTrigger ? rawTrigger : null,
      triggerDirection: isTradingChart && cleanTrigger ? parsed?.triggerDirection || null : null,
      triggerConfidence: isTradingChart && cleanTrigger ? triggerConfidence : "low",
      notes: parsed?.notes || "",
      raw: response.text || "",
    };
  } catch (error) {
    console.error("Chart detection error:", error);
    return fallback(`Chart validation failed: ${error.message}`);
  }
}

function isUploadedChartDataUsable(
  chartDetection,
  selectedDateText = ""
) {
  if (!chartDetection?.isTradingChart) {
    return false;
  }

  if (
    chartDetection?.validationHardReject === true
  ) {
    return false;
  }

  const quality =
    String(chartDetection.chartDataQuality || "")
      .trim()
      .toLowerCase();

  const evidenceScore =
    Number(
      chartDetection?.validationEvidenceScore || 0
    );

  const strongEvidence =
    evidenceScore >= 8;

  if (
    [
      "blank",
      "loading",
      "corrupt",
      "corrupted",
      "unreadable",
      "nested",
      "insufficient",
    ].includes(quality) &&
    !strongEvidence
  ) {
    return false;
  }

  if (
    chartDetection.isNestedChart === true &&
    !strongEvidence
  ) {
    return false;
  }

  if (
    chartDetection.isChartReadableAtCurrentSize === false &&
    !strongEvidence
  ) {
    return false;
  }

  const occupancy =
    Number(chartDetection.chartOccupancyPercent || 0);

  if (
    Number.isFinite(occupancy) &&
    occupancy > 0 &&
    occupancy < 20 &&
    !strongEvidence
  ) {
    return false;
  }

  if (
    chartDetection.hasUsablePriceData === false &&
    !strongEvidence
  ) {
    return false;
  }

  const candles =
    Number(chartDetection.visibleCandleCount || 0);

  if (
    Number.isFinite(candles) &&
    candles > 0 &&
    candles < 8 &&
    !strongEvidence
  ) {
    return false;
  }

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

function chooseFinalChartDate({
  selectedDate,
  detection,
  analysisType = "post-trade",
  cutoffMode = "final_visible",
}) {
  const detectedDate = isUsableChartDateDetection(detection)
    ? parseISODateOnly(detection.latestVisibleDate)
    : null;

  const selectedDateText = selectedDate
    ? formatDateOnly(selectedDate)
    : null;
  const detectedDateText = detectedDate
    ? formatDateOnly(detectedDate)
    : null;

  const isPostTrade =
    String(analysisType || "").toLowerCase() === "post-trade";
  const normalizedMode = normalizeCutoffMode(cutoffMode);

  // FINAL VISIBLE CANDLE is authoritative when the user selects it.
  // The manually selected Chart/Trade Date is only a fallback in this mode.
  if (normalizedMode === "final_visible" && detectedDate) {
    return {
      finalDate: detectedDate,
      finalDateText: detectedDateText,
      selectedDateText,
      detectedDateText,
      source: "chart-final-visible-date",
      selectedDateAdjusted:
        Boolean(selectedDateText) && selectedDateText !== detectedDateText,
      reason:
        "Final visible candle mode was selected, so the chart's detected final visible date controls the review.",
    };
  }

  // In selected-day / exact-time modes, a post-trade screenshot must never
  // allow a user-selected date later than the uploaded chart itself.
  if (
    normalizedMode !== "final_visible" &&
    isPostTrade &&
    selectedDate &&
    detectedDate &&
    selectedDate.getTime() > detectedDate.getTime()
  ) {
    return {
      finalDate: detectedDate,
      finalDateText: detectedDateText,
      selectedDateText,
      detectedDateText,
      source: "chart-visible-date-clamped",
      selectedDateAdjusted: true,
      reason:
        `The selected date ${selectedDateText} is later than the chart's final visible date ${detectedDateText}. ` +
        "The review was therefore limited to the uploaded chart.",
    };
  }

  if (selectedDate) {
    return {
      finalDate: selectedDate,
      finalDateText: selectedDateText,
      selectedDateText,
      detectedDateText,
      source:
        normalizedMode === "exact"
          ? "user-exact-date"
          : "user-selected-date",
      selectedDateAdjusted: false,
      reason:
        normalizedMode === "exact"
          ? "The selected chart date is being used with the requested exact historical time."
          : "The selected chart/trade date was used.",
    };
  }

  if (detectedDate) {
    return {
      finalDate: detectedDate,
      finalDateText: detectedDateText,
      selectedDateText: null,
      detectedDateText,
      source: "chart-detected-date",
      selectedDateAdjusted: false,
      reason:
        "No user-selected date was available, so the chart's final visible date was used.",
    };
  }

  return {
    finalDate: null,
    finalDateText: "Not provided",
    selectedDateText: null,
    detectedDateText: null,
    source: "missing-date",
    selectedDateAdjusted: false,
    reason: "No usable chart date was available.",
  };
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
    visibleHorizontalLines: [],
    csaSimilarities: [],
    csaDifferences: [],
    csaAnchorMatch: "not_checked",
    chartSpecificStrengths: [],
    chartSpecificWeaknesses: [],
    simpleMistakeHub: [],
    setupQualityScore: null,
    entryAccuracyScore: null,
    riskManagementScore: null,
    visualSummary: "",
    chartMarkupAssessment: "",
    entryEvidence: "",
    riskEvidence: "",
    preferredEntryArea: null,
    convertedLevelAssessment: "",
    mainWarning: "",
    coachVerdict: "",
    visualQualityWarning: "",
    internalError: String(reason || ""),
    raw: "",
  };
}

function isBadVisualReview(parsed) {
  const text = [parsed?.visualSummary, parsed?.chartMarkupAssessment, parsed?.entryEvidence, parsed?.riskEvidence, ...(Array.isArray(parsed?.chartSpecificWeaknesses) ? parsed.chartSpecificWeaknesses : [])].join(" ").toLowerCase();
  return text.includes("insufficient chart data") || text.includes("uploaded image appears to be a trading chart, but") || text.includes("not enough visible price data");
}


function extractVisibleZoneRange(text = "") {
  const value = String(text || "").replace(/,/g, "");
  const rangeMatch = value.match(
    /(\d{1,6}(?:\.\d{1,8})?)\s*(?:-|–|—|to)\s*(\d{1,6}(?:\.\d{1,8})?)/i
  );

  if (!rangeMatch) return { low: null, high: null };

  const first = Number(rangeMatch[1]);
  const second = Number(rangeMatch[2]);

  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return { low: null, high: null };
  }

  return {
    low: Math.min(first, second),
    high: Math.max(first, second),
  };
}

function normalizePreferredEntryAreaFromVisual(parsed = {}) {
  const raw =
    parsed?.preferredEntryArea &&
    typeof parsed.preferredEntryArea === "object"
      ? parsed.preferredEntryArea
      : {};

  const evidenceText = [
    raw.zoneText,
    parsed.bestAreaToWatch,
    parsed.coachVerdict,
    parsed.mainWarning,
    parsed.visualSummary,
    ...(Array.isArray(parsed.chartSpecificStrengths)
      ? parsed.chartSpecificStrengths
      : []),
    ...(Array.isArray(parsed.chartSpecificWeaknesses)
      ? parsed.chartSpecificWeaknesses
      : []),
  ]
    .filter(Boolean)
    .join(" ");

  const lowerEvidence = evidenceText.toLowerCase();

  let direction = String(raw.direction || "").toLowerCase();
  if (!["buy", "sell", "none"].includes(direction)) direction = "";
  if (!direction) {
    if (/\bsell\b|\bbearish\b/.test(lowerEvidence)) direction = "sell";
    else if (/\bbuy\b|\bbullish\b/.test(lowerEvidence)) direction = "buy";
    else direction = "none";
  }

  let areaType = String(raw.areaType || "").toLowerCase();
  const validAreaTypes = new Set([
    "support",
    "resistance",
    "demand",
    "supply",
    "converted support",
    "converted resistance",
    "none",
  ]);

  if (!validAreaTypes.has(areaType)) areaType = "";
  if (!areaType) {
    if (/converted resistance/.test(lowerEvidence)) {
      areaType = "converted resistance";
    } else if (/converted support/.test(lowerEvidence)) {
      areaType = "converted support";
    } else if (/\bsupply\b/.test(lowerEvidence)) {
      areaType = "supply";
    } else if (/\bdemand\b/.test(lowerEvidence)) {
      areaType = "demand";
    } else if (/\bresistance\b/.test(lowerEvidence)) {
      areaType = "resistance";
    } else if (/\bsupport\b/.test(lowerEvidence)) {
      areaType = "support";
    } else {
      areaType = "none";
    }
  }

  let zoneLow = Number.isFinite(Number(raw.zoneLow))
    ? Number(raw.zoneLow)
    : null;
  let zoneHigh = Number.isFinite(Number(raw.zoneHigh))
    ? Number(raw.zoneHigh)
    : null;

  const recoveredRange = extractVisibleZoneRange(
    raw.zoneText || parsed.bestAreaToWatch || evidenceText
  );

  if (zoneLow === null && recoveredRange.low !== null) {
    zoneLow = recoveredRange.low;
  }
  if (zoneHigh === null && recoveredRange.high !== null) {
    zoneHigh = recoveredRange.high;
  }

  if (
    Number.isFinite(zoneLow) &&
    Number.isFinite(zoneHigh) &&
    zoneLow > zoneHigh
  ) {
    [zoneLow, zoneHigh] = [zoneHigh, zoneLow];
  }

  let priceStatus = String(raw.priceStatus || "").toLowerCase();
  const validStatuses = new Set([
    "not reached",
    "approaching",
    "inside",
    "reacted",
    "moved away",
    "unclear",
  ]);

  if (!validStatuses.has(priceStatus)) priceStatus = "";
  if (!priceStatus) {
    if (/has not (?:yet )?(?:reached|retested)|not (?:yet )?(?:reached|retested)/.test(lowerEvidence)) {
      priceStatus = "not reached";
    } else if (/\bapproaching\b|\bnear(?:ing)?\b/.test(lowerEvidence)) {
      priceStatus = "approaching";
    } else if (/\binside\b|\bwithin the zone\b/.test(lowerEvidence)) {
      priceStatus = "inside";
    } else if (/\breacted\b|\brejected\b|\bheld\b/.test(lowerEvidence)) {
      priceStatus = "reacted";
    } else if (/\bmoved away\b|\balready moved\b/.test(lowerEvidence)) {
      priceStatus = "moved away";
    } else {
      priceStatus = "unclear";
    }
  }

  const triggerDescription = safeUserText(
    raw.triggerDescription || parsed.entryEvidence || ""
  );

  const triggerPresent =
    raw.triggerPresent === true &&
    !/no visible|no fresh|not visible|not yet|none/i.test(triggerDescription);

  const zoneText = safeUserText(
    raw.zoneText ||
      (zoneLow !== null && zoneHigh !== null
        ? `around ${formatPrice(zoneLow)}–${formatPrice(zoneHigh)}`
        : parsed.bestAreaToWatch || "")
  );

  const hasUsefulArea =
    direction !== "none" ||
    areaType !== "none" ||
    zoneLow !== null ||
    zoneHigh !== null ||
    Boolean(zoneText);

  if (!hasUsefulArea) return null;

  return {
    direction,
    areaType,
    zoneLow,
    zoneHigh,
    zoneText,
    priceStatus,
    areaVisuallyReached: raw.areaVisuallyReached === true,
    areaReachEvidence: String(raw.areaReachEvidence || "").trim(),
    areaReachPrice: nullablePositiveNumber(raw.areaReachPrice),
    areaReachTime: String(raw.areaReachTime || "").trim(),
    triggerPresent,
    triggerAtAreaVisible: raw.triggerAtAreaVisible === true,
    triggerEvidence: String(raw.triggerEvidence || "").trim(),
    triggerEvidenceTime: String(raw.triggerEvidenceTime || "").trim(),
    triggerDescription,
  };
}


function normalizeActiveEntryAreasFromVisual(parsed = {}) {
  const rawAreas = Array.isArray(parsed?.activeEntryAreas)
    ? parsed.activeEntryAreas
    : [];

  const normalized = rawAreas
    .slice(0, 6)
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;

      const area = normalizePreferredEntryAreaFromVisual({
        preferredEntryArea: raw,
        bestAreaToWatch: raw.zoneText || raw.sourceReason || "",
        coachVerdict: raw.sourceReason || "",
        mainWarning: "",
        visualSummary: "",
        chartSpecificStrengths: [],
        chartSpecificWeaknesses: [],
        entryEvidence: raw.triggerEvidence || raw.triggerDescription || "",
      });

      if (!area) return null;

      const stateText = String(raw.state || "active").toLowerCase();
      const state =
        /confirmed/.test(stateText)
          ? "confirmed_conversion"
          : /potential/.test(stateText)
          ? "potential_conversion"
          : /invalid/.test(stateText)
          ? "invalidated"
          : "active";

      return {
        ...area,
        state,
        sourceReason: safeUserText(raw.sourceReason || ""),
      };
    })
    .filter(Boolean);

  const preferred = normalizePreferredEntryAreaFromVisual(parsed);
  if (preferred) {
    normalized.push({
      ...preferred,
      state: "active",
      sourceReason: safeUserText(parsed.bestAreaToWatch || ""),
    });
  }

  const seen = new Set();

  return normalized.filter((area) => {
    const low = Number.isFinite(Number(area.zoneLow)) ? Number(area.zoneLow) : null;
    const high = Number.isFinite(Number(area.zoneHigh)) ? Number(area.zoneHigh) : null;
    const key = `${area.direction}|${area.areaType}|${low}|${high}|${area.zoneText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}



const CSA_FRAMEWORK_VERSION = "1.0";

const CSA_FRAMEWORK_RULES_V1 = `
CSA FRAMEWORK VERSION ${CSA_FRAMEWORK_VERSION}

CORE REVIEW ORDER
1. Confirm chart readability, instrument, timeframe, review mode, selected date, and whether a trade is actually visible.
2. Classify the chart as marked, unmarked, or unclear.
3. Determine the bigger-picture direction and the uploaded-timeframe direction.
4. Identify support, resistance, supply, and demand.
5. Check for valid breaks, false breaks, and potential or confirmed converted levels.
6. Rank the valid entry areas and state whether price has not reached, is approaching, is inside, has reacted from, or has moved away from each area.
7. Check for a fresh entry trigger.
8. Recommend one clear stop-loss location at the setup invalidation point.
9. Use the next opposing support or resistance as the first target.
10. Give evidence-based strengths, improvements, one precise next action, and fair scores.

MARKET DIRECTION
- Bullish evidence includes higher highs, higher lows, support holding, resistance breaking with continued movement, confirmed resistance-to-support conversion, or clear buyer control from demand.
- Bearish evidence includes lower highs, lower lows, resistance holding, support breaking with continued movement, confirmed support-to-resistance conversion, or clear seller control from supply.
- Use range/unclear when price repeatedly crosses nearby levels, structure is mixed, or neither side has clear control.
- Direction must be based on structure and level behaviour, not one candle.
- A correct direction does not mean an immediate entry is available.

SUPPORT, RESISTANCE, SUPPLY, AND DEMAND
- Treat levels as areas, not exact price points.
- Support/resistance gives the broader structure. Newer reactions may form more precise demand/supply areas inside that structure.
- A supply or demand zone can be valid from its edge, middle, or deeper portion. Price does not need to touch one exact number.
- A touch of the zone edge counts as a retest when a valid trigger appears.
- If an edge entry fails but the wider zone remains intact, a fresh setup deeper in the same zone can still be valid after a new trigger.

BREAKS, FALSE BREAKS, AND CONVERTED LEVELS
- A valid break requires a clear move through the level followed by continued movement showing control.
- A wick through a level that closes back on the original side is normally a false break.
- Stage 1: broken level. Stage 2: potential converted level after clear continuation. Stage 3: confirmed converted level after price returns from the opposite side and respects it.
- Before a retest, say the broken level may act in the new role. Do not call it confirmed.
- If price repeatedly crosses the area, describe it as ranging or unconfirmed rather than cleanly converted.

FIBONACCI
- Use Fibonacci only as a silent internal entry-quality filter after a genuine support/resistance or supply/demand area has already been identified.
- Only the 38.2%, 50%, and 61.8% retracement levels are used for this entry filter.
- A structural area is a strong entry area only when that support/resistance or supply/demand area is in close proximity to at least one of those retracement levels.
- A structurally valid area that is not close to 38.2%, 50%, or 61.8% may remain an important chart reference, but it must not become Entry 1, Entry 2, or the preferred entry area.
- Fibonacci must never create a setup by itself. The actual entry remains the support/resistance or supply/demand area, not the Fibonacci number.
- The retracement must be calculated from the genuine completed impulse that produced the current directional breakout/breakdown, using the current structure-sequence origin and the final visible directional extreme; do not shrink the impulse to a late local swing merely because it is more recent.
- In Final Visible Candle mode, when the uploaded broker/platform chart and external OHLC feed use materially different price scales, use deterministic OHLC only to identify the relevant structure/impulse sequence and use the uploaded chart's own price scale for the impulse swing prices. Exact printed chart OHLC/labels outrank estimates. Never choose swing anchors to force Fibonacci confluence.
- A marked horizontal support/resistance/supply/demand price may calibrate the chart scale but must never automatically become the Fib swing origin. The swing origin is the actual candle wick/extreme; if a proposed origin collides with a marked reference line, independently verify the wick or reject the chart-native anchor.
- For Final Visible Candle reviews, prefer pixel-calibrated chart-native swing prices when the right-side price axis can be calibrated from at least two exact visible prices. Vision locates wick coordinates only; JavaScript converts Y coordinates to broker-chart prices. If calibration or wick geometry is unreliable, fall back to deterministic external OHLC rather than guessing.
- The deterministic structure engine must choose the impulse origin/terminal candle times. Vision must map those specific timestamps (allowing at most ±2 candles for broker/timezone alignment) to wick coordinates on the uploaded chart; vision must not choose a different swing. Origin and terminal should be located in separate narrow visual tasks.
- The deterministic Fib origin must be the protected swing associated with the major structural level broken by the current directional breakout/breakdown, not merely the most recent higher low/lower high. For bullish structure, identify the major resistance pivot being broken and use the lowest confirmed protected swing low formed after that resistance pivot and before its breakout; bearish is the mirror image. Prefer the current breakout sequence and score major breaks by structural excursion, pivot age, and confirmed-pivot quality. Never select an old extreme solely because it creates better Fib confluence.
- Major broken-level selection must rank all actually broken confirmed prior swing highs/lows within the active lookback by structural significance rather than recency alone. Significance should consider time-to-break, prominence versus nearby same-side pivots, number of pre-break reactions, percentage of time price remained on the original side, opposing excursion size, separation from the final directional extreme, confirmed protected-pivot quality, and break displacement. Strongly penalize very recent/local pivots and raw-extreme-only protected swings. When two candidates are similarly significant, prefer the older structural pivot rather than the nearer local level.
- Structural-hierarchy major-break selection must scan each confirmed prior pivot independently for its first valid break, because the normal active-pivot event sequence can miss an older outer resistance/support after newer nested pivots form. Use a broader hierarchy lookback than the normal entry-area lookback. In bullish structure, rank higher/outer broken resistance above lower nested resistance when quality is comparable; in bearish structure rank lower/outer broken support above higher nested support. Reward outer levels broken later in the terminal expansion and penalize deeply nested local levels. Do not choose an outer level merely because it creates desired Fib confluence; it must still have a valid confirmed break and protected swing.
- Market-data windows are intentionally separate. The authoritative CSA framework window remains timeframe-specific (M1-H1 daily-in-selected-week, H4 weekly-in-selected-month, D1 monthly-in-selected-year, W1 quarterly-in-selected-year, MN yearly across the selected multi-year range). Fibonacci impulse discovery must use a broader historical context ending at the exact same cutoff. Broader impulse candles may identify the relevant protected swing and major broken level, but they must never create extra current-framework support/resistance candidates or change framework period identity.
- When the same authoritative framework period/side has an exact printed broker/platform price label, that exact chart label may refine the market-data framework price; never borrow a price from a different period or side.
- Do not mention Fibonacci, retracement percentages, 38.2%, 50%, or 61.8% in normal beginner-facing feedback. You may simply say one structural area is stronger or offers a cleaner opportunity.

ENTRY AREA AND TIMING
- Prefer entries that agree with direction and occur at support, resistance, supply, demand, or a valid converted level.
- Avoid buying directly under resistance, selling directly above support, entering in the middle, or chasing after price has already moved.
- Clearly distinguish: not reached, approaching, inside, reacted, or moved away.
- If price has not retested the area, say so. Never imply a rejection or trigger has already happened.

ENTRY 1 AND ENTRY 2
- More than one structural area can exist, but only areas that pass the mandatory 38.2% / 50% / 61.8% internal proximity filter may be treated as strong entry areas.
- Entry 1 is the first strong Fib-confluent structural area price is likely to reach.
- Entry 2 is the next strong Fib-confluent structural area if one exists.
- A nearer structural level that fails the internal Fibonacci proximity filter remains a market reference only and must not be promoted to Entry 1 merely because price will reach it first.
- Do not automatically call Entry 2 superior or tell the trader to skip Entry 1. Price may react from Entry 1 and never reach Entry 2.
- Entry 2 should generally be considered if Entry 1 fails and a fresh trigger appears.
- Do not encourage adding to a losing Entry 1 position. An advanced add-on is outside the default beginner recommendation.

ENTRY CONFIRMATION
- Preferred approach: wait for a visible candlestick or market-structure trigger after price reaches a valid area.
- Pending orders are possible but riskier and should not be the default beginner recommendation.
- Valid triggers include bullish/bearish engulfing, pin bar, hammer, rejection candle, doji plus confirmed break, inside-bar break, higher low, lower high, short-term structure break, break-and-hold, retest-and-hold, head and shoulders, inverse head and shoulders, or Quasimodo.
- Bounce, pullback, retracement, reaction, ranging, consolidation, or merely touching the zone is not a trigger by itself.

STOP LOSS
- Recommend one simple stop based on where the setup is invalidated.
- Choose from beyond the trigger structure, beyond the zone, or beyond the structural swing according to visible evidence.
- A trigger-based stop is tighter but easier to knock out; a zone/structure stop gives more room but needs a smaller lot size.
- Put alternatives only in a short More details explanation, not in the main beginner instruction.

TARGET AND TRADE MANAGEMENT
- First target is normally the next opposing support or resistance.
- Further targets require a clear break and hold beyond the first target.
- Only assess breakeven, partial close, trailing stop, or other management when visible or described.

RISK MANAGEMENT
- Consider stop distance, lot size, account risk, room to first target, and reward-to-risk.
- A wider stop requires a smaller position size to keep account risk unchanged.
- Do not invent a distant target to make reward-to-risk look better.

EVIDENCE AND FEEDBACK
- Never invent an entry, trigger, stop, target, trade, or mistake.
- For pre-trade analysis, absence of a trigger is a valid current limitation: say the setup is not ready yet.
- For post-trade analysis with no visible/described trade, do not criticise how an entry or stop was executed. You may still state that no current trigger or risk plan is visible when reviewing the chart plan.
- If no stop is shown, say the invalidation point and risk cannot be assessed; do not say the stop was badly placed.
- Give at most 4 distinct strengths and 4 distinct improvements. Do not repeat the same issue.
- Keep feedback simple, specific, beginner-friendly, and based on visible evidence.
- End with one practical next action and include an approved price whenever one is available.
`;


function buildFocusedFrameworkPriceTargets(
  marketReference = {},
  timeframe = ""
) {
  const symbol =
    marketReference?.symbol ||
    marketReference?.normalizedSymbol ||
    "";

  const historicalPhase =
    deriveAuthoritativeCsaHistoricalPhase({
      marketReference,
      symbol,
      timeframe,
    });

  const direction =
    historicalPhase &&
    ["bullish", "bearish"].includes(historicalPhase.direction)
      ? historicalPhase.direction
      : null;

  const currentPrice =
    asPositiveNumber(historicalPhase?.latestClose) ||
    extractLastMarketPrice(marketReference);

  if (!direction || currentPrice === null) return [];

  const candles = Array.isArray(marketReference?.timeframeCandles)
    ? marketReference.timeframeCandles
    : [];

  const atr = averageTrueRange(
    candles,
    getStructureEngineConfig(timeframe).atrPeriod
  );

  // IMPORTANT:
  // The dedicated price reader must run BEFORE the Fib gate and therefore
  // must not depend on rankRawEntryAreas(), because that function already
  // requires Fib confluence. Otherwise a broker/platform price can never be
  // reconciled when the market-data price initially misses Fib.
  const structuralCandidates = buildAuthoritativeFrameworkCandidates({
    marketReference,
    visualReview: {},
    direction,
    currentPrice,
    symbol,
    timeframe,
    atr,
  });

  const pathOrdered = [...structuralCandidates]
    .filter((candidate) => {
      const price = asPositiveNumber(candidate?.frameworkPrice);
      if (price === null) return false;

      return direction === "bullish"
        ? price < Number(currentPrice)
        : price > Number(currentPrice);
    })
    .sort((a, b) =>
      direction === "bullish"
        ? Number(b.frameworkPrice) - Number(a.frameworkPrice)
        : Number(a.frameworkPrice) - Number(b.frameworkPrice)
    )
    .slice(0, 6);

  return pathOrdered
    .map((candidate, index) => {
      const period = String(candidate?.period || "").trim();
      const frameworkPrice =
        asPositiveNumber(candidate?.frameworkPrice);

      if (!period || frameworkPrice === null) return null;

      const areaType = String(candidate?.type || "").toLowerCase();

      const side =
        ["converted resistance", "support", "demand"].includes(areaType)
          ? "low"
          : ["converted support", "resistance", "supply"].includes(areaType)
          ? "high"
          : "";

      if (!side) return null;

      return {
        period,
        side,
        frameworkPrice,
        areaType,
        executionOrder: index + 1,
      };
    })
    .filter(Boolean);
}

async function readSingleFrameworkPriceFromChart({
  imageBase64,
  mimeType,
  target,
  timeframe,
  structureLabel,
  marketReference,
}) {
  const prompt = `
You have ONE narrow visual task.

Read the chart-visible price for one already-selected CSA framework level.

TIMEFRAME: ${timeframe}
FRAMEWORK RULE: ${structureLabel}
TARGET PERIOD: ${target.period}
TARGET SIDE: ${target.side}
TARGET ROLE: ${target.areaType}
MARKET-DATA REFERENCE PRICE: ${target.frameworkPrice}

Instructions:
1. Find the exact TARGET PERIOD on the chart time axis.
2. Find only the TARGET SIDE for that same period.
3. If a horizontal line/marked level belonging to that target is visible, follow that exact line to the right-side price axis.
4. Carefully read the small printed price label for that line when one is present.
5. If there is no marked line but the matching period high/low is clear, estimate it from the visible price scale only when confident.
6. Never use a level from another period.
7. Never swap high and low.
8. Treat the MARKET-DATA REFERENCE PRICE as a strong location anchor. The correct chart-visible level should be near that reference price.
9. If the line you find is materially far from the MARKET-DATA REFERENCE PRICE, do NOT use it. Return null rather than borrowing a different period's line.
10. Never invent digits.
11. If the exact printed price cannot be read, displayedPrice must be null.
12. If the price can be estimated with useful confidence, put it in approximatePrice; otherwise null.

Return JSON only:
{
  "period": "${target.period}",
  "side": "${target.side}",
  "displayedPrice": null,
  "approximatePrice": null,
  "platformLabel": null,
  "evidence": null,
  "confidence": "high | medium | low"
}`;

  const runModel = async (openaiModel, detail = "high") => {
    const response = await runVisionModel({
      systemPrompt: prompt,
      userText: `Read only the ${target.period} ${target.side} shown on this chart. Return JSON only.`,
      imageBase64,
      mimeType,
      maxTokens: 500,
      openaiModel,
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: detail,
    });

    return {
      parsed: extractJsonObject(response.text || ""),
      provider: response.provider,
      model: response.model,
    };
  };

  let parsed = null;
  let modelUsed =
    getActiveAiProvider() === "claude" ? CLAUDE_MODEL : "gpt-4.1";

  try {
    const result = await runModel("gpt-4.1", "high");
    parsed = result.parsed;
    modelUsed = result.model;
  } catch (error) {
    console.warn(
      "Primary dedicated price reader failed; trying fallback:",
      error?.message || error
    );
  }

  if (!parsed) {
    try {
      const result = await runModel("gpt-4.1-mini", "high");
      parsed = result.parsed;
      modelUsed = result.model;
    } catch (error) {
      console.warn(
        "Fallback dedicated price reader failed:",
        error?.message || error
      );
      return {
        period: target.period,
        side: target.side,
        frameworkPrice: target.frameworkPrice,
        areaType: target.areaType,
        executionOrder: target.executionOrder,
        displayedPrice: null,
        approximatePrice: null,
        platformLabel: "",
        evidence: "",
        confidence: "low",
        withinTolerance: false,
        modelUsed,
        error: safeUserText(error?.message || "Price reader failed."),
      };
    }
  }

  const displayedPrice =
    nullablePositiveNumber(parsed?.displayedPrice) ||
    extractNumericPriceFromLabel(parsed?.platformLabel);

  const approximatePrice =
    displayedPrice === null
      ? nullablePositiveNumber(parsed?.approximatePrice)
      : null;

  const confidence = ["high", "medium", "low"].includes(
    String(parsed?.confidence || "").toLowerCase()
  )
    ? String(parsed.confidence).toLowerCase()
    : "low";

  const candidatePrice = displayedPrice || approximatePrice;

  const atr = averageTrueRange(
    Array.isArray(marketReference?.timeframeCandles)
      ? marketReference.timeframeCandles
      : [],
    getStructureEngineConfig(timeframe).atrPeriod
  );

  const standardTolerance =
    getFrameworkChartReconciliationTolerance({
      symbol: marketReference?.symbol || "",
      atr,
    });

  // Exact broker/platform labels deserve a wider same-period allowance than
  // visual estimates because data feeds can differ materially on gold,
  // crypto, indices and individual stocks. This is safe here because the
  // model is reading ONE authoritative period and ONE side only.
  const exactLabelTolerance = Math.max(
    standardTolerance,
    Number(atr || 0) * 0.25
  );

  const selectedTolerance =
    displayedPrice !== null
      ? exactLabelTolerance
      : standardTolerance;

  const candidateDifference =
    candidatePrice !== null
      ? Math.abs(
          Number(candidatePrice) -
          Number(target.frameworkPrice)
        )
      : null;

  const withinTolerance =
    candidateDifference !== null &&
    candidateDifference <= selectedTolerance;

  if (candidatePrice !== null && !withinTolerance) {
    console.log("Focused framework price rejected as too far:", {
      period: target.period,
      side: target.side,
      areaType: target.areaType,
      frameworkPrice: target.frameworkPrice,
      candidatePrice,
      difference: candidateDifference,
      standardTolerance,
      exactLabelTolerance,
      selectedTolerance,
      exactPrintedLabel: displayedPrice !== null,
    });
  }

  return {
    period: target.period,
    side: target.side,
    frameworkPrice: target.frameworkPrice,
    areaType: target.areaType,
    executionOrder: target.executionOrder,
    displayedPrice:
      withinTolerance && displayedPrice !== null
        ? displayedPrice
        : null,
    approximatePrice:
      withinTolerance && displayedPrice === null
        ? approximatePrice
        : null,
    platformLabel: String(parsed?.platformLabel || "").trim(),
    evidence: safeUserText(parsed?.evidence || ""),
    confidence,
    withinTolerance,
    modelUsed,
    difference: candidateDifference,
    standardTolerance,
    exactLabelTolerance,
    selectedTolerance,
  };
}

async function extractVisibleFrameworkPriceMap({
  imageBase64,
  mimeType,
  marketReference,
  timeframe = "",
}) {
  if (!isAiProviderConfigured() || !imageBase64) {
    return {
      ok: false,
      matches: [],
      reason: imageBase64
        ? getAiConfigurationError()
        : "Missing chart image.",
    };
  }

  const targets = buildFocusedFrameworkPriceTargets(
    marketReference,
    timeframe
  );

  if (!targets.length) {
    return {
      ok: false,
      matches: [],
      reason:
        "No focused framework entry areas were available for price reconciliation.",
    };
  }

  const structureLabel =
    marketReference?.profile?.structureLabel ||
    getSupportedCsaTimeframeProfile(timeframe)?.structureLabel ||
    "CSA framework periods";

  console.log("Focused framework price targets:", {
    timeframe,
    targets,
  });

  const matches = [];

  // Read each important level separately. This is intentionally sequential:
  // accuracy is more important here than saving one model call.
  for (const target of targets) {
    const match = await readSingleFrameworkPriceFromChart({
      imageBase64,
      mimeType,
      target,
      timeframe,
      structureLabel,
      marketReference,
    });

    matches.push(match);
  }

  console.log("Per-target framework price extraction:", {
    timeframe,
    matches,
  });

  return {
    ok: true,
    matches,
    reason: "",
  };
}



function normalizeChartCoordinate1000(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  // Accept either 0..1 normalized coordinates or the requested 0..1000
  // coordinate system. Internally we keep everything on 0..1000.
  const normalized =
    numeric >= 0 && numeric <= 1.2
      ? numeric * 1000
      : numeric;

  if (normalized < 0 || normalized > 1000) return null;

  return normalized;
}

function fitChartPixelPriceCalibration({
  points = [],
  atr = 0,
  symbol = "",
}) {
  const cleaned = (Array.isArray(points) ? points : [])
    .map((point, index) => {
      const price = nullablePositiveNumber(point?.price);
      const y = normalizeChartCoordinate1000(
        point?.y1000 ?? point?.y ?? point?.yNormalized
      );

      const confidence = ["high", "medium", "low"].includes(
        String(point?.confidence || "").toLowerCase()
      )
        ? String(point.confidence).toLowerCase()
        : "low";

      if (
        price === null ||
        y === null ||
        confidence === "low"
      ) {
        return null;
      }

      return {
        index,
        price,
        y,
        label: String(point?.label || "").trim(),
        kind: String(point?.kind || "").trim(),
        confidence,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);

  // Remove near-duplicate visual points. Keep the higher-confidence point.
  const deduped = [];

  for (const point of cleaned) {
    const existingIndex = deduped.findIndex(
      (existing) =>
        Math.abs(existing.y - point.y) <= 1.5 ||
        Math.abs(existing.price - point.price) <=
          Math.max(
            getApprovedPriceTolerance(symbol) * 0.05,
            Number.EPSILON * 100
          )
    );

    if (existingIndex < 0) {
      deduped.push(point);
      continue;
    }

    const existing = deduped[existingIndex];
    const rank = { high: 3, medium: 2, low: 1 };

    if (
      (rank[point.confidence] || 0) >
      (rank[existing.confidence] || 0)
    ) {
      deduped[existingIndex] = point;
    }
  }

  if (deduped.length < 2) {
    return {
      usable: false,
      reason: "fewer_than_two_price_scale_points",
      pointsUsed: deduped,
      pointsRejected: [],
    };
  }

  const fit = (items) => {
    const n = items.length;
    const meanY =
      items.reduce((sum, item) => sum + item.y, 0) / n;
    const meanPrice =
      items.reduce((sum, item) => sum + item.price, 0) / n;

    let covariance = 0;
    let varianceY = 0;

    for (const item of items) {
      covariance +=
        (item.y - meanY) * (item.price - meanPrice);
      varianceY += Math.pow(item.y - meanY, 2);
    }

    if (!Number.isFinite(varianceY) || varianceY <= 0) {
      return null;
    }

    const slope = covariance / varianceY;
    const intercept = meanPrice - slope * meanY;

    const residuals = items.map((item) => {
      const predicted = intercept + slope * item.y;
      return {
        ...item,
        predicted,
        residual: Math.abs(item.price - predicted),
      };
    });

    const ssResidual = residuals.reduce(
      (sum, item) =>
        sum + Math.pow(item.price - item.predicted, 2),
      0
    );

    const ssTotal = items.reduce(
      (sum, item) =>
        sum + Math.pow(item.price - meanPrice, 2),
      0
    );

    const rSquared =
      ssTotal > 0 ? 1 - ssResidual / ssTotal : 1;

    return {
      slope,
      intercept,
      residuals,
      rSquared,
      maxResidual: Math.max(
        ...residuals.map((item) => item.residual)
      ),
    };
  };

  let pointsUsed = [...deduped];
  let pointsRejected = [];
  let fitted = fit(pointsUsed);

  if (!fitted) {
    return {
      usable: false,
      reason: "price_scale_fit_failed",
      pointsUsed,
      pointsRejected,
    };
  }

  const initialPriceSpan =
    Math.max(...pointsUsed.map((item) => item.price)) -
    Math.min(...pointsUsed.map((item) => item.price));

  const initialResidualAllowance = Math.max(
    Number(atr || 0) * 0.12,
    initialPriceSpan * 0.012,
    Math.abs(fitted.slope) * 4,
    getApprovedPriceTolerance(symbol) * 0.2,
    Number.EPSILON * 100
  );

  // With 4+ points, allow one obvious coordinate-reading outlier to be
  // removed, but only when doing so materially improves the linear scale.
  if (
    pointsUsed.length >= 4 &&
    fitted.maxResidual > initialResidualAllowance
  ) {
    const worst = [...fitted.residuals].sort(
      (a, b) => b.residual - a.residual
    )[0];

    const candidatePoints = pointsUsed.filter(
      (item) => item.index !== worst.index
    );

    const candidateFit = fit(candidatePoints);

    if (
      candidateFit &&
      candidateFit.rSquared > fitted.rSquared &&
      candidateFit.maxResidual < fitted.maxResidual
    ) {
      pointsRejected.push({
        ...worst,
        rejectionReason:
          "single_geometric_outlier_removed",
      });

      pointsUsed = candidatePoints;
      fitted = candidateFit;
    }
  }

  const yValues = pointsUsed.map((item) => item.y);
  const prices = pointsUsed.map((item) => item.price);

  const ySpan = Math.max(...yValues) - Math.min(...yValues);
  const priceSpan = Math.max(...prices) - Math.min(...prices);

  const residualAllowance = Math.max(
    Number(atr || 0) * 0.12,
    priceSpan * 0.012,
    Math.abs(fitted.slope) * 4,
    getApprovedPriceTolerance(symbol) * 0.2,
    Number.EPSILON * 100
  );

  // On a normal trading chart, price decreases as image Y increases.
  const directionCorrect = fitted.slope < 0;

  // Price-axis points should be substantially vertically separated.
  const spreadAdequate =
    ySpan >= 80 &&
    priceSpan > 0;

  // Exact price scale should be very close to linear. Coordinates are
  // vision-read, so use a tolerant but meaningful R²/residual threshold.
  const fitQualityGood =
    fitted.rSquared >= 0.985 &&
    fitted.maxResidual <= residualAllowance;

  // Also require the observed points to be monotonic from top to bottom.
  let monotonicViolations = 0;

  for (let index = 1; index < pointsUsed.length; index += 1) {
    if (
      Number(pointsUsed[index].price) >=
      Number(pointsUsed[index - 1].price)
    ) {
      monotonicViolations += 1;
    }
  }

  const monotonic =
    monotonicViolations === 0;

  const usable =
    pointsUsed.length >= 2 &&
    directionCorrect &&
    spreadAdequate &&
    fitQualityGood &&
    monotonic;

  return {
    usable,
    reason: usable
      ? "validated_linear_chart_price_scale"
      : !directionCorrect
      ? "price_scale_direction_invalid"
      : !spreadAdequate
      ? "price_scale_points_not_spread_enough"
      : !monotonic
      ? "price_scale_points_not_monotonic"
      : "price_scale_fit_quality_too_low",
    slope: fitted.slope,
    intercept: fitted.intercept,
    rSquared: fitted.rSquared,
    maxResidual: fitted.maxResidual,
    residualAllowance,
    ySpan,
    priceSpan,
    monotonicViolations,
    pointsUsed: fitted.residuals,
    pointsRejected,
    minCalibrationY: Math.min(...yValues),
    maxCalibrationY: Math.max(...yValues),
    minCalibrationPrice: Math.min(...prices),
    maxCalibrationPrice: Math.max(...prices),
    pricePer1000Y: Math.abs(fitted.slope) * 1000,
  };
}

function priceFromChartY(calibration, yValue) {
  const y = normalizeChartCoordinate1000(yValue);

  if (
    !calibration?.usable ||
    y === null ||
    !Number.isFinite(Number(calibration?.slope)) ||
    !Number.isFinite(Number(calibration?.intercept))
  ) {
    return null;
  }

  const price =
    Number(calibration.intercept) +
    Number(calibration.slope) * y;

  return asPositiveNumber(price);
}

async function extractChartPriceScalePoints({
  imageBase64,
  mimeType,
  timeframe = "H1",
  symbol = "",
  visualReview = {},
}) {
  if (!isAiProviderConfigured() || !imageBase64) {
    return {
      ok: false,
      points: [],
      reason: imageBase64
        ? getAiConfigurationError()
        : "missing_chart_image",
    };
  }

  const visiblePrice =
    asPositiveNumber(visualReview?.latestVisiblePrice);

  const prompt = `
You have ONE narrow geometric chart-reading task.

INSTRUMENT: ${symbol}
TIMEFRAME: ${timeframe}
VISIBLE FINAL PRICE WHEN AVAILABLE: ${visiblePrice ?? "unknown"}

TASK:
Build calibration points for the chart's vertical PRICE scale.

Read 4 to 8 clearly visible numeric price labels from the RIGHT-SIDE price axis, spread from near the top to near the bottom of the actual chart plot.

You may also use a clearly printed colored horizontal-line price label on the right edge because its Y position corresponds exactly to that printed price.

For EACH calibration point return:
- the exact printed numeric price
- the vertical center position of that exact label/line on the FULL uploaded image
- Y must use a 0..1000 coordinate system:
  0 = very top edge of the full image
  1000 = very bottom edge of the full image
- confidence
- whether it is a normal axis tick or a horizontal-line label

CRITICAL RULES:
1. Read ONLY exact printed prices. Do not estimate a price from candle height.
2. Never invent digits.
3. Prefer labels that are vertically well separated.
4. Do not return dates/times from the bottom axis.
5. Do not return OHLC header numbers unless they are physically located on the right-side vertical price axis.
6. The Y coordinate must correspond to the vertical center of the printed price/line.
7. Return at least 3 points if possible. If fewer than 2 exact prices are readable, return an empty points array.
8. This task is ONLY price-scale calibration. Do not identify support, resistance, entries, trends, or Fibonacci.

Return JSON only:
{
  "points": [
    {
      "price": null,
      "y1000": null,
      "label": null,
      "kind": "axis_tick | horizontal_line_label",
      "confidence": "high | medium | low"
    }
  ],
  "confidence": "high | medium | low"
}`;

  try {
    const response = await runVisionModel({
      systemPrompt: prompt,
      userText:
        "Read exact right-axis price labels and their 0..1000 Y coordinates. Return JSON only.",
      imageBase64,
      mimeType,
      maxTokens: 900,
      openaiModel: "gpt-4.1",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });

    const parsed = extractJsonObject(response.text || "");

    const points = Array.isArray(parsed?.points)
      ? parsed.points
          .map((point) => ({
            price: nullablePositiveNumber(point?.price),
            y1000: normalizeChartCoordinate1000(
              point?.y1000
            ),
            label: String(point?.label || "").trim(),
            kind: String(point?.kind || "").trim(),
            confidence: String(
              point?.confidence || ""
            ).toLowerCase(),
          }))
          .filter(
            (point) =>
              point.price !== null &&
              point.y1000 !== null
          )
      : [];

    const result = {
      ok: points.length >= 2,
      points,
      confidence: String(
        parsed?.confidence || "low"
      ).toLowerCase(),
      modelUsed: response.model,
      provider: response.provider,
      reason:
        points.length >= 2
          ? ""
          : "fewer_than_two_exact_price_axis_points",
    };

    console.log(
      "CSA chart price-scale points:",
      result
    );

    return result;
  } catch (error) {
    console.warn(
      "CSA chart price-scale extraction failed:",
      error?.message || error
    );

    return {
      ok: false,
      points: [],
      reason: "price_scale_reader_failed",
      error: safeUserText(
        error?.message || "Unknown calibration error"
      ),
    };
  }
}


function getChartTargetWickSpec({
  direction = "",
  role = "",
}) {
  const normalizedDirection =
    String(direction || "").toLowerCase();

  const normalizedRole =
    String(role || "").toLowerCase();

  if (
    !["bullish", "bearish"].includes(
      normalizedDirection
    ) ||
    !["origin", "terminal"].includes(
      normalizedRole
    )
  ) {
    return null;
  }

  if (normalizedDirection === "bullish") {
    return {
      wickSide:
        normalizedRole === "origin"
          ? "low"
          : "high",
      description:
        normalizedRole === "origin"
          ? "LOWEST wick tip of the targeted bullish origin candle"
          : "HIGHEST wick tip of the targeted bullish terminal candle",
    };
  }

  return {
    wickSide:
      normalizedRole === "origin"
        ? "high"
        : "low",
    description:
      normalizedRole === "origin"
        ? "HIGHEST wick tip of the targeted bearish origin candle"
        : "LOWEST wick tip of the targeted bearish terminal candle",
  };
}

async function locateTimestampTargetedChartWick({
  imageBase64,
  mimeType,
  direction,
  role,
  targetTime = "",
  timeframe = "H1",
  symbol = "",
  latestVisibleDate = "",
  latestVisibleTime = "",
}) {
  const spec = getChartTargetWickSpec({
    direction,
    role,
  });

  if (
    !spec ||
    !isAiProviderConfigured() ||
    !imageBase64 ||
    !String(targetTime || "").trim()
  ) {
    return {
      ok: false,
      role,
      targetTime:
        String(targetTime || "").trim(),
      reason:
        !String(targetTime || "").trim()
          ? "deterministic_target_time_missing"
          : "targeted_wick_locator_unavailable",
    };
  }

  const prompt = `
You have ONE narrow chart-coordinate task.

INSTRUMENT: ${symbol}
TIMEFRAME: ${timeframe}
LOCKED DIRECTION: ${direction}
TARGET ROLE: ${role}
DETERMINISTIC TARGET CANDLE/TIME: ${targetTime}
FINAL VISIBLE DATE: ${latestVisibleDate || "not reliably printed"}
FINAL VISIBLE TIME: ${latestVisibleTime || "not reliably printed"}

The backend has ALREADY chosen which candle matters.
You must NOT choose a different swing or a different setup.

TASK:
Locate the candle on the uploaded chart that corresponds to the deterministic target time above, allowing only a very small broker/time-label mismatch, and return the coordinate of the ${spec.description}.

COORDINATE SYSTEM:
- FULL uploaded image
- X = 0 at left edge, 1000 at right edge
- Y = 0 at top edge, 1000 at bottom edge

MANDATORY RULES:
1. Return a coordinate for the TARGETED candle only. Do not decide which swing is important.
2. Use the bottom time axis, candle spacing, nearby printed date/time labels, and the visible chart sequence to map the target time to the candle.
3. If the exact target timestamp is not printed, infer its candle position from neighboring time labels and regular ${timeframe} candle spacing.
4. You may shift at most 2 candles left or right if the broker chart timezone/session alignment differs slightly from the external-data timestamp.
5. Report that shift as candleOffsetFromTarget:
   -2, -1, 0, 1, or 2.
6. Do not use a candle farther than ±2 candles from the target.
7. Return the ACTUAL candle-wick tip, not the body, not the close, not a horizontal S/R line, and not a price-axis label.
8. Ignore horizontal support/resistance/supply/demand lines when locating the wick tip. Follow the wick through/beyond any line that crosses the candle.
9. Return COORDINATES ONLY. Do not estimate or return a price.
10. Do not calculate Fibonacci.
11. Do not choose a different candle because it creates better confluence.
12. If the targeted candle cannot be located with at least MEDIUM confidence, return null coordinates.
13. The target time is authoritative for candle identity; the screenshot is authoritative for wick geometry.
14. For terminal-role mapping, do not automatically use the last visible candle unless it corresponds to the target time.

Return JSON only:
{
  "role": "${role}",
  "targetTime": "${targetTime}",
  "matchedChartTime": null,
  "candleOffsetFromTarget": null,
  "wickX1000": null,
  "wickY1000": null,
  "wickSide": "${spec.wickSide}",
  "evidence": null,
  "confidence": "high | medium | low"
}`;

  try {
    const response = await runVisionModel({
      systemPrompt: prompt,
      userText:
        `Locate only the ${role} target candle and its ${spec.wickSide} wick tip. Return 0..1000 coordinates only.`,
      imageBase64,
      mimeType,
      maxTokens: 500,
      openaiModel: "gpt-4.1",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });

    const parsed =
      extractJsonObject(response.text || "");

    const x = normalizeChartCoordinate1000(
      parsed?.wickX1000
    );

    const y = normalizeChartCoordinate1000(
      parsed?.wickY1000
    );

    const confidence = String(
      parsed?.confidence || "low"
    ).toLowerCase();

    const rawOffset =
      Number(parsed?.candleOffsetFromTarget);

    const candleOffsetFromTarget =
      Number.isInteger(rawOffset) &&
      rawOffset >= -2 &&
      rawOffset <= 2
        ? rawOffset
        : null;

    const coordinatesPresent =
      x !== null &&
      y !== null;

    const confidenceUsable =
      ["high", "medium"].includes(confidence);

    const offsetUsable =
      candleOffsetFromTarget !== null;

    const ok =
      coordinatesPresent &&
      confidenceUsable &&
      offsetUsable;

    const result = {
      ok,
      role,
      targetTime:
        String(targetTime || "").trim(),
      matchedChartTime: safeUserText(
        parsed?.matchedChartTime || ""
      ),
      candleOffsetFromTarget,
      x,
      y,
      wickSide: spec.wickSide,
      evidence: safeUserText(
        parsed?.evidence || ""
      ),
      confidence,
      modelUsed: response.model,
      provider: response.provider,
      reason: ok
        ? ""
        : !coordinatesPresent
        ? "targeted_wick_coordinates_missing"
        : !confidenceUsable
        ? "targeted_wick_low_confidence"
        : !offsetUsable
        ? "targeted_wick_offset_missing_or_out_of_range"
        : "targeted_wick_validation_failed",
    };

    console.log(
      "CSA timestamp-targeted wick coordinate:",
      result
    );

    return result;
  } catch (error) {
    console.warn(
      "CSA timestamp-targeted wick locator failed:",
      error?.message || error
    );

    return {
      ok: false,
      role,
      targetTime:
        String(targetTime || "").trim(),
      reason: "targeted_wick_locator_failed",
      error: safeUserText(
        error?.message ||
          "Unknown targeted wick locator error"
      ),
    };
  }
}

async function locateChartNativeImpulseWicks({
  imageBase64,
  mimeType,
  direction,
  timeframe = "H1",
  symbol = "",
  marketImpulse = null,
  latestVisibleDate = "",
  latestVisibleTime = "",
}) {
  if (
    !isAiProviderConfigured() ||
    !imageBase64 ||
    !["bullish", "bearish"].includes(
      direction
    )
  ) {
    return {
      ok: false,
      reason:
        "timestamp_targeted_wick_mapping_unavailable",
    };
  }

  const targetOriginTime =
    direction === "bullish"
      ? String(
          marketImpulse?.swingLowTime || ""
        ).trim()
      : String(
          marketImpulse?.swingHighTime || ""
        ).trim();

  const targetTerminalTime =
    direction === "bullish"
      ? String(
          marketImpulse?.swingHighTime || ""
        ).trim()
      : String(
          marketImpulse?.swingLowTime || ""
        ).trim();

  if (
    !targetOriginTime ||
    !targetTerminalTime
  ) {
    const result = {
      ok: false,
      direction,
      targetOriginTime,
      targetTerminalTime,
      reason:
        "deterministic_impulse_target_times_missing",
    };

    console.log(
      "CSA chart-native wick coordinates:",
      result
    );

    return result;
  }

  // Independent calls are intentional. Each vision task has ONE candle and
  // ONE wick to find, which is much easier and more consistent than asking
  // the model to interpret both ends of the impulse at once.
  const [
    originTarget,
    terminalTarget,
  ] = await Promise.all([
    locateTimestampTargetedChartWick({
      imageBase64,
      mimeType,
      direction,
      role: "origin",
      targetTime: targetOriginTime,
      timeframe,
      symbol,
      latestVisibleDate,
      latestVisibleTime,
    }),
    locateTimestampTargetedChartWick({
      imageBase64,
      mimeType,
      direction,
      role: "terminal",
      targetTime: targetTerminalTime,
      timeframe,
      symbol,
      latestVisibleDate,
      latestVisibleTime,
    }),
  ]);

  const coordinatesPresent =
    originTarget?.x !== null &&
    originTarget?.x !== undefined &&
    originTarget?.y !== null &&
    originTarget?.y !== undefined &&
    terminalTarget?.x !== null &&
    terminalTarget?.x !== undefined &&
    terminalTarget?.y !== null &&
    terminalTarget?.y !== undefined;

  const bothTargetsUsable =
    originTarget?.ok === true &&
    terminalTarget?.ok === true;

  const chronologyValid =
    coordinatesPresent
      ? Number(terminalTarget.x) -
          Number(originTarget.x) >= 10
      : null;

  const ok =
    bothTargetsUsable &&
    chronologyValid === true;

  let reason = "";

  if (!bothTargetsUsable) {
    reason =
      originTarget?.ok !== true &&
      terminalTarget?.ok !== true
        ? "origin_and_terminal_target_mapping_failed"
        : originTarget?.ok !== true
        ? `origin_target_mapping_failed:${
            originTarget?.reason ||
            "unknown"
          }`
        : `terminal_target_mapping_failed:${
            terminalTarget?.reason ||
            "unknown"
          }`;
  } else if (
    chronologyValid !== true
  ) {
    reason =
      coordinatesPresent
        ? "targeted_wick_coordinates_fail_chronology"
        : "targeted_wick_coordinates_missing";
  }

  const result = {
    ok,
    originX:
      originTarget?.x ?? null,
    originY:
      originTarget?.y ?? null,
    terminalX:
      terminalTarget?.x ?? null,
    terminalY:
      terminalTarget?.y ?? null,
    originEvidence:
      originTarget?.evidence || "",
    terminalEvidence:
      terminalTarget?.evidence || "",
    originConfidence:
      originTarget?.confidence || "low",
    terminalConfidence:
      terminalTarget?.confidence || "low",
    confidence:
      originTarget?.confidence === "high" &&
      terminalTarget?.confidence === "high"
        ? "high"
        : bothTargetsUsable
        ? "medium"
        : "low",
    targetOriginTime,
    targetTerminalTime,
    originMatchedChartTime:
      originTarget?.matchedChartTime || "",
    terminalMatchedChartTime:
      terminalTarget?.matchedChartTime || "",
    originCandleOffset:
      originTarget?.candleOffsetFromTarget ??
      null,
    terminalCandleOffset:
      terminalTarget?.candleOffsetFromTarget ??
      null,
    chronologyValid,
    originTarget,
    terminalTarget,
    modelUsed:
      originTarget?.modelUsed ||
      terminalTarget?.modelUsed ||
      null,
    provider:
      originTarget?.provider ||
      terminalTarget?.provider ||
      null,
    reason,
  };

  console.log(
    "CSA chart-native wick coordinates:",
    result
  );

  return result;
}


async function extractChartNativeImpulseAnchors({
  imageBase64,
  mimeType,
  marketReference,
  chartDetection = {},
  visualReview = {},
  priceMap = null,
  timeframe = "H1",
  symbol = "",
}) {
  const cutoffMode = normalizeCutoffMode(
    marketReference?.chartCutoff?.mode || "final_visible"
  );

  // Historical selected-day / exact-time reviews remain fully locked to
  // deterministic cutoff-filtered OHLC. This prevents future visible candles
  // from affecting a historical Fib swing.
  if (cutoffMode !== "final_visible") {
    return {
      usable: false,
      source: "external_ohlc",
      reason:
        "pixel_chart_native_impulse_disabled_for_historical_cutoff",
    };
  }

  if (!isAiProviderConfigured() || !imageBase64) {
    return {
      usable: false,
      source: "external_ohlc",
      reason: imageBase64
        ? getAiConfigurationError()
        : "missing_chart_image",
    };
  }

  const historicalPhase =
    deriveAuthoritativeCsaHistoricalPhase({
      marketReference,
      symbol,
      timeframe,
    });

  const direction =
    historicalPhase &&
    ["bullish", "bearish"].includes(
      historicalPhase.direction
    )
      ? historicalPhase.direction
      : null;

  if (!direction) {
    return {
      usable: false,
      source: "external_ohlc",
      reason:
        "no_locked_direction_for_pixel_chart_native_impulse",
    };
  }

  const candles =
    Array.isArray(
      marketReference?.impulseCandles
    ) &&
    marketReference.impulseCandles.length
      ? marketReference.impulseCandles
      : Array.isArray(
          marketReference
            ?.timeframeCandles
        )
      ? marketReference.timeframeCandles
      : [];

  const atr = averageTrueRange(
    candles,
    getStructureEngineConfig(timeframe).atrPeriod
  );

  // Deterministic market-data structure remains responsible for deciding
  // WHICH impulse matters. The uploaded image is used only to move the two
  // swing prices onto the user's broker/platform scale.
  const marketImpulse = buildLatestImpulseFibonacci({
    candles,
    historicalPhase,
    direction,
    timeframe,
    symbol,
    chartNativeImpulse: null,
    suppressImpulseLog: true,
  });

  if (!marketImpulse) {
    return {
      usable: false,
      source: "external_ohlc",
      reason:
        "deterministic_impulse_locator_unavailable",
    };
  }

  const scaleRead = await extractChartPriceScalePoints({
    imageBase64,
    mimeType,
    timeframe,
    symbol,
    visualReview,
  });

  if (!scaleRead?.ok) {
    return {
      usable: false,
      source: "external_ohlc",
      reason:
        scaleRead?.reason ||
        "chart_price_scale_points_unavailable",
      scaleRead,
    };
  }

  const calibration = fitChartPixelPriceCalibration({
    points: scaleRead.points,
    atr,
    symbol,
  });

  console.log(
    "CSA chart price-scale calibration:",
    calibration
  );

  if (!calibration?.usable) {
    return {
      usable: false,
      source: "external_ohlc",
      reason:
        calibration?.reason ||
        "chart_price_scale_calibration_invalid",
      calibration,
    };
  }

  const latestVisibleDate =
    String(
      chartDetection?.latestVisibleDate ||
      marketReference?.chartCutoff?.latestVisibleDate ||
      ""
    ).trim();

  const latestVisibleTime =
    String(
      chartDetection?.latestVisibleTime || ""
    ).trim();

  const wickLocation =
    await locateChartNativeImpulseWicks({
      imageBase64,
      mimeType,
      direction,
      timeframe,
      symbol,
      marketImpulse,
      latestVisibleDate,
      latestVisibleTime,
    });

  if (!wickLocation?.ok) {
    return {
      usable: false,
      source: "external_ohlc",
      reason:
        wickLocation?.reason ||
        "chart_native_wick_coordinates_unavailable",
      calibration,
      wickLocation,
    };
  }

  const originPrice = priceFromChartY(
    calibration,
    wickLocation.originY
  );

  const terminalPrice = priceFromChartY(
    calibration,
    wickLocation.terminalY
  );

  if (
    originPrice === null ||
    terminalPrice === null
  ) {
    return {
      usable: false,
      source: "external_ohlc",
      reason:
        "pixel_to_price_conversion_failed",
      calibration,
      wickLocation,
    };
  }

  const chartSwingLow =
    direction === "bullish"
      ? originPrice
      : terminalPrice;

  const chartSwingHigh =
    direction === "bullish"
      ? terminalPrice
      : originPrice;

  if (
    !Number.isFinite(chartSwingLow) ||
    !Number.isFinite(chartSwingHigh) ||
    chartSwingHigh <= chartSwingLow
  ) {
    return {
      usable: false,
      source: "external_ohlc",
      reason:
        "pixel_calibrated_anchor_order_invalid",
      calibration,
      wickLocation,
      originPrice,
      terminalPrice,
    };
  }

  const chartRange =
    chartSwingHigh - chartSwingLow;

  const marketRange =
    Number(marketImpulse?.impulseRange || 0);

  const rangeRatio =
    marketRange > 0
      ? chartRange / marketRange
      : null;

  const visibleClose =
    asPositiveNumber(
      visualReview?.latestVisiblePrice
    ) ||
    asPositiveNumber(
      chartDetection?.latestVisiblePrice
    );

  // Allow the wick to sit outside the vertical range covered by selected
  // axis labels, but reject extreme extrapolation. 20% of the calibrated
  // Y-span is enough for top/bottom labels that don't reach the plot edge.
  const calibrationYSpan =
    Number(calibration?.ySpan || 0);

  const yExtrapolationAllowance =
    Math.max(25, calibrationYSpan * 0.2);

  const originWithinScaleReach =
    wickLocation.originY >=
      Number(calibration.minCalibrationY) -
        yExtrapolationAllowance &&
    wickLocation.originY <=
      Number(calibration.maxCalibrationY) +
        yExtrapolationAllowance;

  const terminalWithinScaleReach =
    wickLocation.terminalY >=
      Number(calibration.minCalibrationY) -
        yExtrapolationAllowance &&
    wickLocation.terminalY <=
      Number(calibration.maxCalibrationY) +
        yExtrapolationAllowance;

  // Broad comparison to the deterministic data-feed swing. We deliberately
  // allow meaningful broker/feed differences, but reject a completely
  // different geometric swing.
  const broadAnchorTolerance = Math.max(
    Number(atr || 0) * 3,
    marketRange > 0
      ? marketRange * 0.28
      : 0,
    getApprovedPriceTolerance(symbol) * 12
  );

  const externalLowDifference =
    Math.abs(
      chartSwingLow -
      Number(marketImpulse.swingLow)
    );

  const externalHighDifference =
    Math.abs(
      chartSwingHigh -
      Number(marketImpulse.swingHigh)
    );

  const rangePlausible =
    rangeRatio === null ||
    (rangeRatio >= 0.5 && rangeRatio <= 1.8);

  const anchorsPlausible =
    externalLowDifference <=
      broadAnchorTolerance &&
    externalHighDifference <=
      broadAnchorTolerance;

  const terminalVsVisibleClose =
    visibleClose !== null
      ? Math.abs(chartSwingHigh - visibleClose)
      : null;

  // For a bullish final-visible chart, terminal high should be reasonably
  // near/above the visible close; bearish uses the analogous terminal low.
  const terminalClosePlausible =
    visibleClose === null ||
    (
      direction === "bullish"
        ? (
            chartSwingHigh >=
              visibleClose -
                Math.max(
                  Number(atr || 0) * 0.2,
                  chartRange * 0.015
                ) &&
            terminalVsVisibleClose <=
              Math.max(
                Number(atr || 0) * 1.25,
                chartRange * 0.08
              )
          )
        : (
            chartSwingLow <=
              visibleClose +
                Math.max(
                  Number(atr || 0) * 0.2,
                  chartRange * 0.015
                ) &&
            Math.abs(
              chartSwingLow - visibleClose
            ) <=
              Math.max(
                Number(atr || 0) * 1.25,
                chartRange * 0.08
              )
          )
    );

  // Horizontal framework prices may calibrate/validate the chart, but they
  // must not become swing anchors. A pixel-derived origin that lands almost
  // exactly on an exact framework label is suspicious unless its wick
  // coordinate is clearly independent of that level.
  const exactReferenceLevels =
    Array.isArray(priceMap?.matches)
      ? priceMap.matches
          .filter(
            (match) =>
              match?.withinTolerance === true &&
              nullablePositiveNumber(
                match?.displayedPrice
              ) !== null
          )
          .map((match) => ({
            period: String(
              match?.period || ""
            ),
            side: String(match?.side || ""),
            role: String(
              match?.areaType || ""
            ),
            price:
              nullablePositiveNumber(
                match?.displayedPrice
              ),
          }))
          .filter(
            (item) => item.price !== null
          )
      : [];

  const originReferenceCollisionTolerance =
    Math.max(
      Number(atr || 0) * 0.025,
      Math.abs(
        Number(calibration.slope)
      ) * 3,
      getApprovedPriceTolerance(symbol) * 0.35,
      Number.EPSILON * 100
    );

  const nearestOriginReference =
    exactReferenceLevels.length
      ? exactReferenceLevels
          .map((reference) => ({
            ...reference,
            distance: Math.abs(
              originPrice -
              Number(reference.price)
            ),
          }))
          .sort(
            (a, b) =>
              a.distance - b.distance
          )[0] || null
      : null;

  const originReferenceCollision =
    nearestOriginReference !== null &&
    nearestOriginReference.distance <=
      originReferenceCollisionTolerance;

  // Coordinate-based extraction already avoids using the line itself.
  // Still reject suspicious exact collisions because they often signal that
  // the locator returned the line's Y rather than the wick tip.
  const originIndependentOfReference =
    !originReferenceCollision;

  const usable =
    rangePlausible &&
    anchorsPlausible &&
    terminalClosePlausible &&
    originWithinScaleReach &&
    terminalWithinScaleReach &&
    originIndependentOfReference;

  const confidence =
    wickLocation.originConfidence === "high" &&
    wickLocation.terminalConfidence === "high" &&
    calibration.rSquared >= 0.995
      ? "high"
      : "medium";

  const result = {
    usable,
    direction,
    swingLow: chartSwingLow,
    swingHigh: chartSwingHigh,
    swingLowTime:
      direction === "bullish"
        ? marketImpulse?.swingLowTime || null
        : marketImpulse?.swingLowTime || null,
    swingHighTime:
      direction === "bullish"
        ? marketImpulse?.swingHighTime || null
        : marketImpulse?.swingHighTime || null,
    originPrice,
    terminalPrice,
    originPriceSource:
      "pixel_calibrated_chart_scale",
    terminalPriceSource:
      "pixel_calibrated_chart_scale",
    originEvidence:
      wickLocation.originEvidence || "",
    terminalEvidence:
      wickLocation.terminalEvidence || "",
    confidence,
    source: usable
      ? "uploaded_chart_pixel_calibration"
      : "external_ohlc",
    reason: usable
      ? "validated_pixel_calibrated_chart_native_impulse"
      : originReferenceCollision
      ? "pixel_origin_collides_with_framework_reference"
      : !originWithinScaleReach ||
        !terminalWithinScaleReach
      ? "wick_coordinate_too_far_outside_calibrated_scale"
      : !rangePlausible
      ? "pixel_impulse_range_not_plausible"
      : !anchorsPlausible
      ? "pixel_impulse_too_far_from_structure_locator"
      : !terminalClosePlausible
      ? "pixel_terminal_inconsistent_with_final_visible_price"
      : "pixel_chart_native_impulse_failed_validation",
    validation: {
      chartRange,
      marketRange:
        marketRange || null,
      rangeRatio,
      atr: Number(atr || 0),
      broadAnchorTolerance,
      externalLowDifference,
      externalHighDifference,
      rangePlausible,
      anchorsPlausible,
      terminalVsVisibleClose,
      terminalClosePlausible,
      originWithinScaleReach,
      terminalWithinScaleReach,
      yExtrapolationAllowance,
      visibleClose,
      originReferenceCollision,
      originReferenceCollisionTolerance,
      nearestOriginReference,
    },
    calibration,
    wickLocation,
    targetedWickMapping: {
      targetOriginTime:
        wickLocation?.targetOriginTime || null,
      targetTerminalTime:
        wickLocation?.targetTerminalTime || null,
      originMatchedChartTime:
        wickLocation?.originMatchedChartTime || null,
      terminalMatchedChartTime:
        wickLocation?.terminalMatchedChartTime || null,
      originCandleOffset:
        wickLocation?.originCandleOffset ?? null,
      terminalCandleOffset:
        wickLocation?.terminalCandleOffset ?? null,
      chronologyValid:
        wickLocation?.chronologyValid ?? null,
    },
    exactReferenceLevels,
    modelUsed: wickLocation.modelUsed,
    provider: wickLocation.provider,
  };

  console.log(
    "CSA chart-native impulse extraction:",
    result
  );

  return result;
}

function mergeDedicatedFrameworkPriceMapIntoVisualReview({
  visualReview = {},
  priceMap = null,
}) {
  const diagnostics = {
    extractionOk: Boolean(priceMap?.ok),
    exactMatchCount: 0,
    approximateMatchCount: 0,
    matches: Array.isArray(priceMap?.matches)
      ? priceMap.matches
      : [],
    reason: safeUserText(priceMap?.reason || ""),
  };

  if (!priceMap?.ok || !Array.isArray(priceMap.matches)) {
    return {
      ...visualReview,
      frameworkPriceMapDiagnostics: diagnostics,
    };
  }

  const exactLevels = [];
  const approximateLevels = [];

  priceMap.matches.forEach((match) => {
    const exact = nullablePositiveNumber(match?.displayedPrice);
    const approximate =
      exact === null
        ? nullablePositiveNumber(match?.approximatePrice)
        : null;

    const description =
      `${match?.period || "framework period"} ${match?.side || "level"}` +
      (match?.evidence ? ` — ${match.evidence}` : "");

    if (exact !== null) {
      exactLevels.push({
        type: "label",
        description,
        displayedPrice: exact,
        approximatePrice: null,
        platformLabel:
          String(match?.platformLabel || "").trim() ||
          String(exact),
        frameworkPeriodHint: match?.period || null,
        frameworkSideHint: match?.side || null,
        extractionSource:
          "per_target_framework_price_reader",
        extractionConfidence:
          match?.confidence || "high",
      });
      return;
    }

    if (approximate !== null) {
      approximateLevels.push({
        type: "label",
        description,
        displayedPrice: null,
        approximatePrice: approximate,
        platformLabel:
          String(match?.platformLabel || "").trim(),
        frameworkPeriodHint: match?.period || null,
        frameworkSideHint: match?.side || null,
        extractionSource:
          "per_target_framework_price_reader_estimate",
        extractionConfidence:
          match?.confidence || "medium",
      });
    }
  });

  diagnostics.exactMatchCount = exactLevels.length;
  diagnostics.approximateMatchCount =
    approximateLevels.length;

  return {
    ...visualReview,
    visibleMarkedLevels: [
      ...exactLevels,
      ...approximateLevels,
      ...(Array.isArray(visualReview?.visibleMarkedLevels)
        ? visualReview.visibleMarkedLevels
        : []),
    ].slice(0, 40),
    frameworkPriceMapDiagnostics: diagnostics,
  };
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
  if (!isAiProviderConfigured()) return visualFallback(getAiConfigurationError());
  if (!imageBase64) return visualFallback("Uploaded chart image was not available for visual comparison.");

  // The screenshot is the primary evidence. Twelve Data is optional supporting
  // context and must never prevent the uploaded chart from being reviewed.
  const marketReferenceAvailable = Boolean(marketReference?.ok);

  const prompt = `
You are CSA Coach's beginner-friendly trade review assistant.
Return ONLY valid JSON. Do not use markdown.

Your job:
- FIRST classify the uploaded chart as MARKED, UNMARKED, or UNCLEAR before giving any feedback.
- Then review the uploaded chart using the internal support/resistance framework below.
- The main purpose is to compare what is visibly marked on the uploaded chart with the internal support/resistance areas and identify similarities and differences.

${CSA_FRAMEWORK_RULES_V1}

STRICT MARKED/UNMARKED RULE:
- For M1, M5, M15, M30, and H1 charts, the internal method starts with Monday's high as resistance and Monday's low as support.
- On those timeframes, any clear horizontal lines near the calculated Monday high and Monday low must be treated as possible framework markings and compared with those prices before classifying the chart.
- A visible blue, red, green, orange, or other coloured horizontal line must not be ignored merely because it is unlabelled.
- If two visible horizontal lines align with Monday's high and Monday's low within normal chart-reading tolerance, classify the chart as MARKED and record that match as a strength.
- Only treat a horizontal line as a current-price, bid/ask, or order line when its platform label or position clearly proves that purpose and it does not align with the calculated Monday high or low.
- MARKED means the uploaded image clearly contains user-drawn support/resistance evidence such as horizontal lines, rectangles, shaded zones, or labels that identify trading levels.
- UNMARKED means there is no clear user-drawn support/resistance evidence.
- Do NOT treat grid lines, current-price lines, bid/ask lines, order lines, crosshair lines, chart borders, session separators, or AI/backend-calculated levels as user-marked support/resistance.
- Before claiming that support or resistance is visible, describe the exact visible object that proves it.
- If no such object can be identified, the chart MUST be classified as UNMARKED.
- For an UNMARKED chart, explicitly say: "There is no visible evidence of user-marked support or resistance on this chart."
- After that, explain the important areas calculated by the internal framework using simple wording such as: "However, the main areas to watch are support around X and resistance around Y."
- Never list "support and resistance are clearly marked" as a strength on an unmarked chart.
- For a marked chart, explain the result in one very simple sentence.
- Do not use the words "marked chart", "similarities", "differences", "framework comparison", "internal areas", "Monday's high", or "Monday's low" in user-facing feedback.
- State visible levels simply, for example: "There is a resistance correctly marked around X and a support correctly marked around Y."
- Always check whether any support or resistance level has broken and held on the other side, whether the chart is marked, unmarked, or unclear.
- Update the level's current role in Chart Levels instead of describing only its original role.
- If resistance has broken and price has held above it, explain that it should now act as support.
- If support has broken and price has held below it, explain that it should now act as resistance.
- For a bullish Main Warning, name the next earlier resistance price that would need a fresh breakout-and-hold.
- For a bearish Main Warning, name the next earlier support price that would need a fresh breakdown-and-hold.
- Never write only "a fresh breakout-and-hold" or "a fresh breakdown-and-hold" without naming the level when one is available.
- Do not repeat the same pullback, rejection, or retest instruction under both Key Areas & Trade Plan and Entry Confirmation.
- Entry Confirmation should only state whether a clear buy or sell confirmation is visible.
- Starter-plan Next Action must include the exact support or resistance price whenever market data provides one.
- Do not say only "wait for support" or "wait for resistance"; say "support around X" or "resistance around X".
- For unmarked charts, strengths should explain what useful chart information is still visible, such as enough price history to identify direction and key areas. Avoid vague statements such as only saying that the direction was checked.
- Do not add a separate Market Direction section when the Quick Verdict already states the bullish, bearish, or range plan.
- Do not use support, resistance, supply, or demand created on the selected chart date when giving entry areas or a trade plan. Use only earlier completed days or periods.
- If the chart is unclear, do not guess. Use UNCLEAR and state what cannot be verified.
- The user is likely a beginner. Use very simple trading language.
- The backend can use the internal method, but user-facing fields must NOT say "CSA", "framework", or "daily high/low logic". Simple terms such as support, resistance, supply area, and demand area are allowed when they help the beginner understand the setup.
- Do not discuss trendlines, channels, indicators, or moving averages unless the selected personal strategy requires them. Use Fibonacci only as silent internal confluence and do not mention Fibonacci in normal beginner-facing feedback.
- Explain only what matters to a beginner:
  1. Is the bigger picture bullish, bearish, or ranging?
  2. What is the selected ${timeframe} chart doing right now?
  3. Should the trader wait, buy, sell, or avoid chasing?
  4. Where exactly should price return before a better setup forms? Always include support/resistance and the price level.
  5. Is there a clear entry confirmation?
  6. Is stop loss/target visible enough to judge?
- The internal range-position check may use the first key high/low as a deep-pullback guide, but user-facing wording should stay simple.
- Do not mention Fibonacci, retracement percentages, 61.8, 50%, or technical confluence in user-facing feedback.
- When there are two valid entry areas, label them Entry 1 and Entry 2 when useful. Do not automatically dismiss Entry 1 or claim Entry 2 is always better. Explain that Entry 1 may react first, while Entry 2 may remain valid if Entry 1 fails and a fresh trigger appears. Do not encourage adding to a losing Entry 1 position.
- Entry confirmation must match the trade direction: for a sell setup, wait for price to approach resistance and reject; for a buy setup, wait for price to approach support and hold.
- Use staged converted-level wording. After a clear break and continuation, call the level potential resistance/support. Call it confirmed converted resistance/support only after price returns from the opposite side and respects it. A wick that closes back on the original side is normally a false break.
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
- Do not assume that a trade was taken merely because the selected mode is post-trade review.
- First decide whether a trade is actually visible from entry markers, order lines, stop loss, take profit, position labels, or clear user notes describing a completed entry.
- If no trade is visible and the notes do not describe a taken trade, set tradeVisibility="not_visible".
- When tradeVisibility="not_visible", do not claim a trade was badly entered or managed. In pre-trade mode, you may still state that price has not reached the area, no trigger is visible, or stop/target planning is missing. In post-trade mode without a described trade, assess only the visible chart plan and missing information, not execution quality.
- If a trade is visible but stop loss or target is missing, say "Stop loss and target are not shown, so the trade risk cannot be judged."
- If the bigger-picture view and uploaded chart timeframe disagree, state both clearly.
  Example: "The bigger picture is slightly bearish, but the ${timeframe} chart is pushing up short-term."
- Distinguish a genuine range from a transition/recovery phase:
  - bearish structure + strong bullish recovery that has not broken the main resistance = "bullish recovery after bearish breakdown";
  - bullish structure + strong bearish pullback that has not broken the main support = "bearish pullback after bullish breakout";
  - only use "range-bound" when neither side has a decisive recent break, recovery, or structural advantage.
- A strong recovery from a deep low is not automatically bullish. It remains a transition until price clearly breaks and holds above the key resistance.
- A strong drop from a high is not automatically bearish. It remains a transition until price clearly breaks and holds below the key support.
- Do not give financial advice or guaranteed predictions. This is only chart feedback.

EVIDENCE AND PRICE RULE:
- For historical direction, market phase, breakout/breakdown state, and converted support/resistance, the cutoff-filtered market data is authoritative whenever it is available.
- The uploaded screenshot is authoritative only for trader markings, visible entry/stop/target evidence, annotations, and trade-management evidence.
- Never use candles visible after the resolved cutoff to change the historical direction or market phase.
- Screenshot evidence may describe a short-term reaction, but it must not overwrite the deterministic cutoff-filtered market facts.
- Twelve Data available for this review: ${marketReferenceAvailable ? "yes" : "no"}.
- A clearly printed chart price may be used as an exact visible price.
- When a visible supply or demand rectangle has readable upper and lower boundaries, return the full approximate range in zoneLow, zoneHigh, and zoneText. Introduce it as "around" and treat it as an area rather than an exact order price.
- Do not discard a visible zone merely because its boundaries are not in the approved Twelve Data list.
- Approved supporting market prices, when available:
${JSON.stringify(buildApprovedMarketAreas(marketReference), null, 2)}
- If no readable range or approved price is available, refer to "the marked supply area", "the marked demand area", "the confirmed support area", or "the confirmed resistance area" without inventing a number.
- Never create, transpose, or silently substitute a price.

Optional internal support/resistance context:
${marketReferenceAvailable ? buildCsaFrameworkSummaryForVision(marketReference) : "Twelve Data structure was unavailable or deliberately restricted. Review the uploaded screenshot independently."}

Selected context:
- Instrument: ${submittedInstrument}
- Timeframe uploaded/selected: ${timeframe}
- If this timeframe is M1 through H1, compare visible horizontal lines specifically with Monday's calculated high and low before deciding marked or unmarked.
- Mode: ${analysisType}
- User notes: ${submittedNotes || "None"}

${analysisFramework === "personal_strategy" ? buildPersonalStrategyPrompt(personalStrategySnapshot) : ""}

Initial image validation:
- Detected instrument: ${chartDetection?.detectedInstrument || "not detected"}
- Detected timeframe: ${chartDetection?.detectedTimeframe || "not detected"}
- Latest visible date: ${chartDetection?.latestVisibleDate || "not detected"}
- Latest visible time: ${chartDetection?.latestVisibleTime || "not detected"}
- Twelve Data cutoff: ${marketReference?.chartCutoff?.endDateTime || "not available"}
- Cutoff rule: ${marketReference?.chartCutoff?.reason || "The uploaded chart remains the primary source of truth."}
- Detected trigger: ${chartDetection?.visibleTrigger || "none confirmed"}

MANDATORY PRICE-READING PASS — DO THIS BEFORE ANALYSING DIRECTION OR ENTRY AREAS:
- Inspect the chart's price axis, every horizontal line, rectangle boundary, and any printed platform price label.
- When a price is visibly printed beside a line/level/zone boundary, copy that exact printed number into displayedPrice. Do not replace it with an estimate.
- Also copy the exact visible label text into platformLabel.
- approximatePrice is only a fallback when the line is visible but no exact printed price can be read.
- Return every clearly visible relevant horizontal level, even when you are not yet certain whether it is support, resistance, supply, demand, or a converted level.
- For every returned visible level, identify the framework period that created it from the chart's time axis and structure: for D1 use the source month (for example "January 2026" or "June 2026"), for H4 use the source week, for M1-H1 use the source trading day, for W1 use the source quarter, and for MN use the source year. Put this in frameworkPeriodHint.
- Do not infer or invent a displayedPrice. If the digits are not readable, use null.
- If the source period cannot be identified confidently, set frameworkPeriodHint to null rather than guessing.
- The later CSA engine will decide which day/week/month/quarter/year the level belongs to. Your job here is to faithfully capture the chart-visible prices.

CSA ENTRY-ZONE RULES:
- Supply and demand are zones, not single price points.
- When a rectangle or shaded zone is visible, return zoneLow and zoneHigh when its boundaries are clearly readable.
- Do not replace a visible supply/demand zone with the nearest single Twelve Data level.
- For a bearish setup, prefer the nearest valid supply or converted-resistance zone above current price.
- For a bullish setup, prefer the nearest valid demand or converted-support zone below current price.
- State whether price has not reached, is approaching, is inside, has reacted from, or has moved away from the area.
- A wick through a level that closes back on the original side is normally a false break.
- A broken support/resistance level is only confirmed as converted after an opposite-side retest and hold/rejection.
- Never say an exact entry price is required when the chart clearly shows a valid zone.
- If price has not reached the planned area, say no trigger exists there yet.
- Treat chart annotations, arrows, labels, and written trade ideas as the trader's claims, not as proof that price actually reached an area or formed a trigger.
- Mark areaVisuallyReached true only when candle highs/lows/bodies visibly enter or touch the planned zone.
- When areaVisuallyReached is true, also provide areaReachPrice as the actual visible candle price that touched/entered the zone and areaReachTime as the visible candle date/time or chart-position description. Without both, areaVisuallyReached must be false.
- Mark triggerAtAreaVisible true only when a valid trigger is visibly formed at the planned area after price reaches it.
- When triggerAtAreaVisible is true, provide triggerEvidenceTime and identify the exact trigger candle/pattern. Without this, triggerAtAreaVisible must be false.
- Read latestVisiblePrice from the final visible candle/header where possible. Do not substitute a later external-data close.
- Mark stopLossVisible and targetVisible true only when the chart visibly shows the actual stop-loss and target levels for the reviewed trade. Text discussing stop loss or target without a plotted level is not enough.

OUTPUT PRIORITY RULES:
- chartSpecificStrengths and chartSpecificWeaknesses must describe the actual visible setup before generic validation comments.
- Do not use "the chart has enough history", "the instrument is visible", or "the timeframe is visible" as a main strength when a marked direction, zone, support, resistance, trigger status, or risk issue can be described.
- If a marked supply/demand area exists, mention it in chartSpecificStrengths.
- If price has not retested that area, mention it directly in chartSpecificWeaknesses.
- If no trigger exists at that area, state this as a separate weakness.
- If stop loss, account risk, or target is not shown, state that the risk plan cannot be fully assessed.
- Do not say a sell or buy level is undefined when a visible zone is marked.

SCORING RULES:
- A readable pre-trade or post-trade chart with no visible executed trade is still a plan review, not an automatic failure.
- Correct direction and a sensible marked area must not receive 0 for setup quality.
- Missing trigger lowers readiness but does not make entry accuracy 0.
- Missing stop/target lowers risk management but does not make it 0.

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
      "displayedPrice": "exact numeric price copied from the visible chart/platform label when readable, otherwise null",
      "platformLabel": "exact visible price/line label text when readable, otherwise null",
      "frameworkPeriodHint": "source CSA period identified from chart time-axis/structure, e.g. January 2026, week of 2026-07-20, 2026-07-28, Q2 2026, or 2025; null if uncertain",
      "approximatePrice": "fallback visual estimate only when no exact printed price is readable, otherwise null"
    }
  ],
  "visibleHorizontalLines": [
    {
      "colour": "blue | red | green | orange | other",
      "description": "every clearly visible horizontal line, even if its purpose is uncertain",
      "displayedPrice": "exact numeric price copied from the visible price-axis/line label when readable, otherwise null",
      "approximatePrice": "fallback visual estimate only when no exact printed price is readable, otherwise null",
      "platformLabel": "exact visible line/price label text or null",
      "frameworkPeriodHint": "source CSA period identified from chart time-axis/structure; null if uncertain"
    }
  ],
  "csaSimilarities": ["simple similarity between visible chart markings and internal areas"],
  "csaDifferences": ["simple difference, missing area, or mismatch"],
  "shortTermDirection": "bullish | bearish | range-bound | range-bound with bullish pressure | range-bound with bearish pressure | unclear",
  "marketPhase": "trend | bullish breakout | bearish breakdown | bullish recovery after bearish breakdown | bearish pullback after bullish breakout | consolidation | range | unclear",
  "quickVerdict": "one very simple sentence saying wait, avoid chasing, or setup looks acceptable",
  "plainMarketDirection": "one simple sentence combining bigger-picture direction and ${timeframe} chart direction",
  "whatThisMeans": "one simple sentence explaining what the trader should understand from the chart",
  "timeframeSummary": "one simple sentence describing what the uploaded ${timeframe} chart is doing",
  "bestAreaToWatch": "one simple sentence saying where price should return before a better setup. Use a supply/demand ZONE when visible; do not force one exact price.",
  "activeEntryAreas": [
    {
      "direction": "buy | sell",
      "areaType": "support | resistance | demand | supply | converted support | converted resistance",
      "zoneLow": null,
      "zoneHigh": null,
      "zoneText": "full visible/approved area range",
      "state": "active | potential conversion | confirmed conversion | invalidated",
      "sourceReason": "brief reason this area exists",
      "priceStatus": "not reached | approaching | inside | reacted | moved away | unclear",
      "areaVisuallyReached": false,
      "areaReachEvidence": null,
      "areaReachPrice": null,
      "areaReachTime": null,
      "triggerPresent": false,
      "triggerAtAreaVisible": false,
      "triggerEvidence": null,
      "triggerEvidenceTime": null,
      "triggerDescription": null
    }
  ],
  "preferredEntryArea": {
    "direction": "buy | sell | none",
    "areaType": "support | resistance | demand | supply | converted support | converted resistance | none",
    "zoneLow": "lower boundary from a printed price, approved market data, or a clearly visible approximate zone boundary; otherwise null",
    "zoneHigh": "upper boundary from a printed price, approved market data, or a clearly visible approximate zone boundary; otherwise null",
    "zoneText": "beginner-friendly area description. When a visible supply or demand rectangle exists, return the approximate full range and use the word around",
    "priceStatus": "not reached | approaching | inside | reacted | moved away | unclear",
    "areaVisuallyReached": false,
    "areaReachEvidence": "describe the candle body/wick that visibly entered the zone, or null",
    "areaReachPrice": null,
    "areaReachTime": null,
    "triggerPresent": false,
    "triggerAtAreaVisible": false,
    "triggerEvidence": "name the valid candle/structure trigger visibly formed at the zone, or null",
    "triggerEvidenceTime": null,
    "triggerDescription": "visible trigger at the planned area or null"
  },
  "latestVisiblePrice": null,
  "stopLossVisible": false,
  "targetVisible": false,
  "annotationClaimsOnly": false,
  "convertedLevelAssessment": "brief beginner-friendly statement about any broken level and whether an opposite-side retest confirmed conversion, or null",
  "visualSummary": "2 short beginner-friendly sentences. Mention bigger-picture direction and uploaded timeframe direction if different.",
  "chartMarkupAssessment": "simple comment about whether the important support/resistance areas are clear; do not mention trendlines/channels/indicators",
  "tradeVisibility": "visible | not_visible | unclear",
  "tradeVisibilityReason": "brief evidence for the decision",
  "entryEvidence": "what entry evidence is visible, or 'No visible entry evidence'",
  "riskEvidence": "what stop-loss, target, or risk evidence is visible, or 'No visible trade risk information'",
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
    const response = await runVisionModel({
      systemPrompt: prompt,
      userText:
        "Review this uploaded chart in simple beginner trader language using the internal support/resistance framework. Return only the required JSON.",
      imageBase64,
      mimeType,
      maxTokens: 3200,
      openaiModel: "gpt-4.1-mini",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });

    const parsed = extractJsonObject(response.text || "");
    if (!parsed) {
      return visualFallback("The visual response could not be parsed as JSON.");
    }

    const visualQualityWarning = isBadVisualReview(parsed)
      ? "The visual response contained a low-confidence phrase, but all usable chart fields were preserved."
      : "";

    const normalizedPreferredEntryArea =
      normalizePreferredEntryAreaFromVisual(parsed);
    const normalizedActiveEntryAreas =
      normalizeActiveEntryAreasFromVisual(parsed);

    console.log("Visual review structured output:", {
      marketReferenceAvailable,
      shortTermDirection: parsed.shortTermDirection || null,
      chartMarkingStatus: parsed.chartMarkingStatus || null,
      visibleMarkedLevels: Array.isArray(parsed.visibleMarkedLevels)
        ? parsed.visibleMarkedLevels.slice(0, 12)
        : [],
      visibleHorizontalLines: Array.isArray(parsed.visibleHorizontalLines)
        ? parsed.visibleHorizontalLines.slice(0, 16)
        : [],
      preferredEntryArea: normalizedPreferredEntryArea,
      visualQualityWarning,
    });

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
        ? parsed.visibleMarkedLevels.slice(0, 12).map((item) => ({
            type: String(item?.type || "").toLowerCase(),
            description: safeUserText(item?.description || ""),
            displayedPrice:
              nullablePositiveNumber(item?.displayedPrice) ||
              extractNumericPriceFromLabel(item?.platformLabel) ||
              extractNumericPriceFromLabel(item?.description),
            approximatePrice: nullablePositiveNumber(item?.approximatePrice),
            platformLabel: String(item?.platformLabel || "").trim(),
          }))
        : [],
      visibleHorizontalLines: Array.isArray(parsed.visibleHorizontalLines)
        ? parsed.visibleHorizontalLines.slice(0, 16).map((item) => ({
            colour: String(item?.colour || "other").toLowerCase(),
            description: safeUserText(item?.description || ""),
            displayedPrice:
              nullablePositiveNumber(item?.displayedPrice) ||
              extractNumericPriceFromLabel(item?.platformLabel) ||
              extractNumericPriceFromLabel(item?.description),
            approximatePrice: nullablePositiveNumber(item?.approximatePrice),
            platformLabel: String(item?.platformLabel || "").trim(),
          }))
        : [],
      csaSimilarities: normalizeArrayOfStrings(parsed.csaSimilarities, []).map(safeUserText).slice(0, 8),
      csaDifferences: normalizeArrayOfStrings(parsed.csaDifferences, []).map(safeUserText).slice(0, 8),
      shortTermDirection: parsed.shortTermDirection || "unclear",
      quickVerdict: safeUserText(parsed.quickVerdict),
      plainMarketDirection: safeUserText(parsed.plainMarketDirection),
      whatThisMeans: safeUserText(parsed.whatThisMeans),
      timeframeSummary: safeUserText(parsed.timeframeSummary),
      bestAreaToWatch: safeUserText(parsed.bestAreaToWatch),
      activeEntryAreas: normalizedActiveEntryAreas,
      preferredEntryArea: normalizedPreferredEntryArea,
      convertedLevelAssessment: safeUserText(parsed.convertedLevelAssessment),
      mainWarning: safeUserText(parsed.mainWarning),
      coachVerdict: safeUserText(parsed.coachVerdict),
      chartSpecificStrengths: normalizeArrayOfStrings(parsed.chartSpecificStrengths, []).map(safeUserText),
      chartSpecificWeaknesses: normalizeArrayOfStrings(parsed.chartSpecificWeaknesses, []).map(safeUserText),
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
      visualSummary: safeUserText(parsed.visualSummary),
      chartMarkupAssessment: safeUserText(parsed.chartMarkupAssessment),
      tradeVisibility: ["visible", "not_visible", "unclear"].includes(
        String(parsed.tradeVisibility || "").toLowerCase()
      )
        ? String(parsed.tradeVisibility).toLowerCase()
        : "unclear",
      tradeVisibilityReason: String(
        parsed.tradeVisibilityReason || ""
      ).trim(),
      entryEvidence: safeUserText(parsed.entryEvidence),
      riskEvidence: safeUserText(parsed.riskEvidence),
      visualQualityWarning,
      raw: response.text || "",
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


function parseApproximateMarkedPrice(value) {
  if (value === null || value === undefined) return null;

  const cleaned = String(value)
    .replace(/,/g, "")
    .match(/-?\d+(?:\.\d+)?/);

  if (!cleaned) return null;
  const numberValue = Number(cleaned[0]);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getMondayCsaAnchorLevels(marketReference = null) {
  const areas = Array.isArray(marketReference?.csaAreas)
    ? marketReference.csaAreas
    : [];

  if (!areas.length) {
    return { support: null, resistance: null };
  }

  const mondayAreas = areas.filter((area) =>
    String(area?.day || area?.period || "")
      .toLowerCase()
      .includes("monday")
  );

  const source = mondayAreas.length >= 2 ? mondayAreas : areas.slice(0, 2);

  return {
    resistance:
      source.find(
        (area) => String(area?.type || "").toLowerCase() === "resistance"
      ) || null,
    support:
      source.find(
        (area) => String(area?.type || "").toLowerCase() === "support"
      ) || null,
  };
}

function getVisibleHorizontalLineCandidates(visualReview = null) {
  const raw = [
    ...(Array.isArray(visualReview?.visibleHorizontalLines)
      ? visualReview.visibleHorizontalLines
      : []),
    ...(Array.isArray(visualReview?.visibleMarkedLevels)
      ? visualReview.visibleMarkedLevels
      : []),
  ];

  const seen = new Set();

  return raw
    .map((item) => {
      const price = parseApproximateMarkedPrice(item?.approximatePrice);
      const description = String(item?.description || "").trim();
      const colour = String(item?.colour || "").trim();
      const platformLabel = String(item?.platformLabel || "").trim();
      const key = `${price ?? "null"}|${description.toLowerCase()}|${colour.toLowerCase()}`;

      if (seen.has(key)) return null;
      seen.add(key);

      return {
        price,
        description,
        colour,
        platformLabel,
      };
    })
    .filter(Boolean);
}

function resolveIntradayCsaChartMarking({
  visualReview = null,
  marketReference = null,
  timeframe = "",
  symbol = "",
}) {
  const baseStatus = getChartMarkingStatus(visualReview);

  if (!isIntradayCsaTimeframe(timeframe) || !marketReference?.ok) {
    return {
      ...visualReview,
      chartMarkingStatus: baseStatus,
      csaAnchorMatch: "not_checked",
    };
  }

  const anchors = getMondayCsaAnchorLevels(marketReference);
  const mondayHigh = Number(anchors.resistance?.price);
  const mondayLow = Number(anchors.support?.price);

  if (!Number.isFinite(mondayHigh) || !Number.isFinite(mondayLow)) {
    return {
      ...visualReview,
      chartMarkingStatus: baseStatus,
      csaAnchorMatch: "not_available",
    };
  }

  const candidates = getVisibleHorizontalLineCandidates(visualReview);
  const tolerance = getCleanBreakTolerance(symbol || marketReference?.symbol) * 4;

  const resistanceMatch = candidates.find(
    (line) =>
      Number.isFinite(line.price) &&
      Math.abs(line.price - mondayHigh) <= tolerance
  );

  const supportMatch = candidates.find(
    (line) =>
      Number.isFinite(line.price) &&
      Math.abs(line.price - mondayLow) <= tolerance
  );

  const similarities = normalizeArrayOfStrings(
    visualReview?.csaSimilarities,
    []
  ).filter(
    (item) =>
      !/no visible evidence|not marked|could not be verified/i.test(item)
  );

  const differences = normalizeArrayOfStrings(
    visualReview?.csaDifferences,
    []
  ).filter(
    (item) =>
      !/no visible evidence|not marked|could not be verified/i.test(item)
  );

  const strengths = normalizeArrayOfStrings(
    visualReview?.chartSpecificStrengths,
    []
  ).filter((item) => !isUnsupportedMarkedLevelClaim(item));

  const weaknesses = normalizeArrayOfStrings(
    visualReview?.chartSpecificWeaknesses,
    []
  ).filter(
    (item) =>
      feedbackCategory(item) !== "levels_not_marked" &&
      !/no visible evidence of user-marked support or resistance/i.test(item)
  );

  if (resistanceMatch && supportMatch) {
    const matchText =
      `There is a resistance correctly marked around ${formatPrice(mondayHigh)}, ` +
      `and a support correctly marked around ${formatPrice(mondayLow)}.`;

    return {
      ...visualReview,
      chartMarkingStatus: "marked",
      csaLevelVisibility: "clear",
      visualChartStyle: "marked chart",
      csaAnchorMatch: "full",
      csaSimilarities: [matchText, ...similarities].slice(0, 8),
      csaDifferences: differences,
      chartSpecificStrengths: [
        "The resistance and support levels are marked correctly.",
        ...strengths,
      ].slice(0, 4),
      chartSpecificWeaknesses: weaknesses.slice(0, 4),
    };
  }

  if (resistanceMatch || supportMatch) {
    const matchedText = resistanceMatch
      ? `There is a resistance correctly marked around ${formatPrice(mondayHigh)}.`
      : `There is a support correctly marked around ${formatPrice(mondayLow)}.`;

    const missingText = resistanceMatch
      ? `A support line was not clearly matched around ${formatPrice(mondayLow)}.`
      : `A resistance line was not clearly matched around ${formatPrice(mondayHigh)}.`;

    return {
      ...visualReview,
      chartMarkingStatus: "marked",
      csaLevelVisibility: "partial",
      visualChartStyle: "marked chart",
      csaAnchorMatch: "partial",
      csaSimilarities: [matchedText, ...similarities].slice(0, 8),
      csaDifferences: [missingText, ...differences].slice(0, 8),
      chartSpecificStrengths: [matchedText, ...strengths].slice(0, 4),
      chartSpecificWeaknesses: [missingText, ...weaknesses].slice(0, 4),
    };
  }

  return {
    ...visualReview,
    chartMarkingStatus: baseStatus,
    csaAnchorMatch: "none",
  };
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

function notesDescribeTakenTrade(notes = "") {
  const value = String(notes || "").toLowerCase().trim();
  if (!value) return false;

  return (
    /\b(i|we)\s+(entered|bought|sold|closed|exited|took|placed|moved)\b/.test(value) ||
    /\b(entry|stop loss|take profit|target)\s+(was|at|placed|set|moved)\b/.test(value) ||
    /\btrade\s+(was|is|closed|taken|entered)\b/.test(value)
  );
}

function getTradeVisibility({
  visualReview = null,
  submittedNotes = "",
}) {
  const explicit = String(
    visualReview?.tradeVisibility || ""
  ).toLowerCase();

  if (explicit === "visible") return "visible";
  if (explicit === "not_visible") return "not_visible";

  if (notesDescribeTakenTrade(submittedNotes)) return "visible";

  const evidenceText = [
    visualReview?.entryEvidence,
    visualReview?.riskEvidence,
    visualReview?.chartMarkupAssessment,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const positiveEvidence =
    /\b(entry marker|buy order|sell order|open position|position line|stop loss line|take profit line|trade label|closed trade)\b/.test(
      evidenceText
    );

  const negativeEvidence =
    /\b(no visible entry|no trade visible|no visible trade|not shown|not visible)\b/.test(
      evidenceText
    );

  if (positiveEvidence && !negativeEvidence) return "visible";
  return "not_visible";
}

function assumesTradeWasTaken(text = "") {
  const value = normalizeFeedbackText(text);

  return (
    value.includes("before the trade was taken") ||
    value.includes("when the trade was taken") ||
    value.includes("the trade was entered") ||
    value.includes("the entry was taken") ||
    value.includes("entry was taken") ||
    value.includes("the trader entered") ||
    value.includes("the trader bought") ||
    value.includes("the trader sold")
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


function extractNumericPricesFromText(value = "") {
  const matches = String(value || "")
    .replace(/,/g, "")
    .match(/\b\d{1,6}(?:\.\d{1,8})\b/g);

  if (!matches) return [];

  return matches
    .map(Number)
    .filter((price) => Number.isFinite(price) && price > 0);
}

function visibleMarkedPriceCandidates(visualReview = null) {
  const items = [
    ...(Array.isArray(visualReview?.visibleMarkedLevels)
      ? visualReview.visibleMarkedLevels
      : []),
    ...(Array.isArray(visualReview?.visibleHorizontalLines)
      ? visualReview.visibleHorizontalLines
      : []),
  ];

  const candidates = [];

  items.forEach((item) => {
    const text = [
      item?.type,
      item?.description,
      item?.platformLabel,
      item?.label,
      item?.role,
    ]
      .filter(Boolean)
      .join(" ");

    const lower = text.toLowerCase();

    const prices = [
      ...extractNumericPricesFromText(item?.platformLabel),
      ...extractNumericPricesFromText(item?.description),
      ...extractNumericPricesFromText(item?.label),
    ];

    if (Number.isFinite(Number(item?.approximatePrice))) {
      prices.push(Number(item.approximatePrice));
    }

    const type =
      /\bsupply\b/.test(lower)
        ? "supply"
        : /\bdemand\b/.test(lower)
        ? "demand"
        : /\bresistance\b/.test(lower)
        ? "resistance"
        : /\bsupport\b/.test(lower)
        ? "support"
        : "unknown";

    prices.forEach((price) => {
      candidates.push({
        price,
        type,
        text,
        exactVisibleLabel:
          extractNumericPricesFromText(item?.platformLabel).includes(price) ||
          extractNumericPricesFromText(item?.description).includes(price),
      });
    });
  });

  return candidates.filter(
    (candidate, index, array) =>
      array.findIndex(
        (other) =>
          Math.abs(other.price - candidate.price) < 1e-10 &&
          other.type === candidate.type
      ) === index
  );
}

function currentReferencePrice(marketReference = null) {
  const levels = Array.isArray(marketReference?.dailyLevels)
    ? marketReference.dailyLevels
    : [];

  const last = levels[levels.length - 1];
  const close = Number(last?.close);
  return Number.isFinite(close) ? close : null;
}

function closePriceTolerance(symbol = "", price = 0) {
  const compact = comparableInstrument(symbol);

  if (compact.includes("BTC")) return 150;
  if (compact.includes("XAU")) return 1.5;
  if (compact.includes("JPY")) return 0.15;
  if (price >= 100) return 0.15;

  return 0.0012;
}

function buildZoneFromCandidates({
  candidates = [],
  direction = "none",
  currentPrice = null,
  symbol = "",
}) {
  const wantsSell = direction === "sell";
  const acceptedTypes = wantsSell
    ? new Set(["supply", "resistance", "unknown"])
    : new Set(["demand", "support", "unknown"]);

  let filtered = candidates.filter((candidate) => {
    if (!acceptedTypes.has(candidate.type)) return false;
    if (!Number.isFinite(currentPrice)) return true;

    return wantsSell
      ? candidate.price > currentPrice
      : candidate.price < currentPrice;
  });

  filtered = filtered.sort((a, b) =>
    wantsSell ? a.price - b.price : b.price - a.price
  );

  if (!filtered.length) return null;

  const first = filtered[0];
  const tolerance = closePriceTolerance(symbol, first.price);

  const nearby = filtered
    .filter((candidate) => Math.abs(candidate.price - first.price) <= tolerance)
    .slice(0, 4);

  const prices = nearby.map((item) => item.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);

  return {
    low,
    high,
    type:
      nearby.some((item) => item.type === "supply")
        ? "supply"
        : nearby.some((item) => item.type === "demand")
        ? "demand"
        : wantsSell
        ? "resistance"
        : "support",
    exactVisible:
      nearby.length > 0 && nearby.every((item) => item.exactVisibleLabel),
  };
}

function buildZoneFromMarketAreas({
  marketReference = null,
  direction = "none",
}) {
  const currentPrice = currentReferencePrice(marketReference);
  const areas = Array.isArray(marketReference?.csaAreas)
    ? marketReference.csaAreas
    : [];

  const wantsSell = direction === "sell";
  const acceptedTypes = wantsSell
    ? new Set(["supply", "resistance"])
    : new Set(["demand", "support"]);

  const eligible = areas
    .filter((area) => {
      const price = Number(area?.price);
      if (!Number.isFinite(price) || !acceptedTypes.has(String(area?.type || "").toLowerCase())) {
        return false;
      }

      if (!Number.isFinite(currentPrice)) return true;
      return wantsSell ? price > currentPrice : price < currentPrice;
    })
    .sort((a, b) =>
      wantsSell
        ? Number(a.price) - Number(b.price)
        : Number(b.price) - Number(a.price)
    );

  if (!eligible.length) return null;

  const first = eligible[0];
  const tolerance = closePriceTolerance(
    marketReference?.symbol || "",
    Number(first.price)
  );

  const nearby = eligible
    .filter(
      (area) =>
        Math.abs(Number(area.price) - Number(first.price)) <= tolerance
    )
    .slice(0, 3);

  const prices = nearby.map((area) => Number(area.price));
  return {
    low: Math.min(...prices),
    high: Math.max(...prices),
    type:
      nearby.some((area) => String(area.type).toLowerCase() === "supply")
        ? "supply"
        : nearby.some((area) => String(area.type).toLowerCase() === "demand")
        ? "demand"
        : wantsSell
        ? "resistance"
        : "support",
    exactVisible: false,
  };
}

function inferReviewDirection(visualReview = null, marketReference = null) {
  const text = [
    visualReview?.shortTermDirection,
    visualReview?.plainMarketDirection,
    visualReview?.quickVerdict,
    visualReview?.bestAreaToWatch,
    visualReview?.coachVerdict,
    visualReview?.mainWarning,
    ...(Array.isArray(visualReview?.chartSpecificStrengths)
      ? visualReview.chartSpecificStrengths
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\bsell\b|\bbearish\b/.test(text)) return "sell";
  if (/\bbuy\b|\bbullish\b/.test(text)) return "buy";

  const bias = String(
    marketReference?.directionalBias?.bias || ""
  ).toLowerCase();

  if (/bearish/.test(bias)) return "sell";
  if (/bullish/.test(bias)) return "buy";

  return "none";
}

function enrichVisualReviewForFinalFeedback({
  visualReview = null,
  marketReference = null,
  symbol = "",
}) {
  if (!visualReview) return visualReview;

  const direction = inferReviewDirection(visualReview, marketReference);
  const currentPrice = currentReferencePrice(marketReference);
  const markedCandidates = visibleMarkedPriceCandidates(visualReview);

  let preferredArea =
    visualReview.preferredEntryArea &&
    typeof visualReview.preferredEntryArea === "object"
      ? { ...visualReview.preferredEntryArea }
      : null;

  const preferredRangeText = String(preferredArea?.zoneText || "").trim();
  const preferredRange = extractVisibleZoneRange(preferredRangeText);

  const preferredHasUsefulZone =
    preferredArea &&
    (
      (
        Number.isFinite(Number(preferredArea.zoneLow)) &&
        Number.isFinite(Number(preferredArea.zoneHigh))
      ) ||
      (
        preferredRange.low !== null &&
        preferredRange.high !== null
      )
    );

  if (
    preferredArea &&
    preferredRange.low !== null &&
    preferredRange.high !== null
  ) {
    preferredArea.zoneLow = preferredRange.low;
    preferredArea.zoneHigh = preferredRange.high;
  }

  if (!preferredHasUsefulZone && ["buy", "sell"].includes(direction)) {
    const visualZone = buildZoneFromCandidates({
      candidates: markedCandidates,
      direction,
      currentPrice,
      symbol,
    });

    const marketZone =
      visualZone ||
      buildZoneFromMarketAreas({
        marketReference,
        direction,
      });

    if (marketZone) {
      preferredArea = {
        direction,
        areaType: marketZone.type,
        zoneLow: marketZone.low,
        zoneHigh: marketZone.high,
        zoneText:
          Math.abs(marketZone.high - marketZone.low) > 1e-10
            ? `around ${formatPrice(marketZone.low)}–${formatPrice(marketZone.high)}`
            : `around ${formatPrice(marketZone.low)}`,
        priceStatus:
          Number.isFinite(currentPrice) &&
          (direction === "sell"
            ? currentPrice < marketZone.low
            : currentPrice > marketZone.high)
            ? "not reached"
            : "unclear",
        triggerPresent: false,
        triggerDescription: "",
        recoveredFrom:
          visualZone ? "visible-chart-markings" : "historical-market-areas",
      };
    }
  }

  if (preferredArea && !["buy", "sell"].includes(String(preferredArea.direction || ""))) {
    preferredArea.direction = direction;
  }

  const strengths = cleanUserFeedbackItems(
    visualReview.chartSpecificStrengths
  ).filter(
    (item) =>
      !/chart has enough price history|instrument and timeframe|chart is clear enough/i.test(
        String(item || "")
      )
  );

  const weaknesses = cleanUserFeedbackItems(
    visualReview.chartSpecificWeaknesses
  ).filter(
    (item) =>
      !/sell level is not defined|buy level is not defined|visual trade review failed|referenceerror|is not defined/i.test(
        String(item || "")
      )
  );

  if (preferredArea && String(preferredArea.areaType || "") !== "none") {
    const areaType = String(preferredArea.areaType || "entry");
    const zoneText = String(preferredArea.zoneText || "").trim();

    strengths.unshift(
      zoneText
        ? `The ${areaType} area ${zoneText} gives a clear ${
            preferredArea.direction === "sell" ? "sell" : "buy"
          } location to monitor.`
        : `The marked ${areaType} area gives a clear ${
            preferredArea.direction === "sell" ? "sell" : "buy"
          } location to monitor.`
    );

    if (
      ["not reached", "approaching"].includes(
        String(preferredArea.priceStatus || "").toLowerCase()
      )
    ) {
      weaknesses.unshift(
        `Price has not yet retested the planned ${areaType} area, so the setup is not confirmed.`
      );
    }

    if (preferredArea.triggerPresent !== true) {
      weaknesses.push(
        `No fresh ${
          preferredArea.direction === "sell" ? "bearish" : "bullish"
        } trigger is visible at the planned area yet.`
      );
    }
  }

  const riskText = String(visualReview.riskEvidence || "").toLowerCase();
  if (
    /not shown|not visible|no visible|cannot be judged/.test(riskText) &&
    !weaknesses.some((item) => /stop loss|risk|target/i.test(item))
  ) {
    weaknesses.push(
      "A stop loss and target are not clearly shown, so the planned risk cannot yet be assessed."
    );
  }

  let bestAreaToWatch = String(visualReview.bestAreaToWatch || "").trim();

  if (preferredArea && ["buy", "sell"].includes(preferredArea.direction)) {
    const areaType = String(preferredArea.areaType || "entry");
    const zoneText = String(preferredArea.zoneText || "").trim();

    bestAreaToWatch =
      preferredArea.direction === "sell"
        ? `Wait for price to retrace towards the ${areaType} area${
            zoneText ? ` ${zoneText}` : ""
          } and show a clear bearish trigger before considering a sell. Do not chase a sell while price remains close to support.`
        : `Wait for price to return towards the ${areaType} area${
            zoneText ? ` ${zoneText}` : ""
          } and show a clear bullish trigger before considering a buy. Do not chase a buy while price remains close to resistance.`;
  }

  return {
    ...visualReview,
    preferredEntryArea: preferredArea,
    bestAreaToWatch,
    chartSpecificStrengths: removeDuplicateFeedback(strengths, 4),
    chartSpecificWeaknesses: removeDuplicateFeedback(weaknesses, 4),
  };
}


function buildDashboardFeedback({
  marketReference,
  chartDetection,
  visualReview = null,
  submittedInstrument,
  timeframe,
  selectedDateText,
  detectedDateText,
  submittedNotes = "",
  setupScore = 0,
  analysisType = "post-trade",
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
  const tradeVisibility = getTradeVisibility({
    visualReview,
    submittedNotes,
  });
  const hasVisibleTrade = tradeVisibility === "visible";

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

  if (hasVisibleTrade && !hasConfirmedTrigger) {
    frameworkWeaknesses.push(
      "No clear entry confirmation is visible for the trade."
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
      hasVisibleTrade
        ? "Stop loss and target are not shown, so the trade risk cannot be judged."
        : "A stop loss and target are not clearly shown, so the planned risk cannot yet be assessed."
    );
  }

  let visualStrengths = visualOk
    ? normalizeArrayOfStrings(visualReview.chartSpecificStrengths, [])
    : [];

  let visualWeaknesses = visualOk
    ? normalizeArrayOfStrings(visualReview.chartSpecificWeaknesses, [])
    : [];

  if (!hasVisibleTrade) {
    visualWeaknesses = visualWeaknesses.filter((item) => {
      if (assumesTradeWasTaken(item)) return false;
      if (feedbackCategory(item) === "middle_range_entry") return false;

      // In pre-trade mode, these are valid readiness checks even when no trade exists.
      if (normalizeAnalysisType(analysisType) === "pre-trade") return true;

      // In post-trade mode with no visible/described trade, avoid judging execution,
      // but keep plan-readiness issues such as a missing stop/target plan.
      return feedbackCategory(item) !== "entry_confirmation_missing";
    });
  }

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
        visualStrengths.push(item)
      );

    normalizeArrayOfStrings(visualReview?.csaDifferences, [])
      .slice(0, 2)
      .forEach((item) =>
        visualWeaknesses.push(item)
      );
  }

  const preferredArea = visualReview?.preferredEntryArea;
  const preferredDirection = String(preferredArea?.direction || "").toLowerCase();
  const preferredType = String(preferredArea?.areaType || "").toLowerCase();
  const preferredStatus = String(preferredArea?.priceStatus || "").toLowerCase();

  if (preferredArea && preferredType && preferredType !== "none") {
    visualStrengths.unshift(
      `The marked ${preferredType} area gives a clear ${preferredDirection === "sell" ? "sell" : preferredDirection === "buy" ? "buy" : "trade"} location to monitor.`
    );
  }

  if (["not reached", "approaching"].includes(preferredStatus)) {
    visualWeaknesses.unshift(
      `Price has not yet retested the planned ${preferredType || "entry"} area, so the setup is not confirmed.`
    );
  }

  if (preferredArea && preferredArea.triggerPresent !== true) {
    visualWeaknesses.push(
      `No fresh ${preferredDirection === "sell" ? "bearish" : preferredDirection === "buy" ? "bullish" : "entry"} trigger is visible at the planned area yet.`
    );
  }

  visualWeaknesses = visualWeaknesses.filter((item) =>
    !/sell level is not defined|buy level is not defined|exact .* level is not defined|visual trade review failed|referenceerror|is not defined/i.test(String(item || ""))
  );

  const strengths = removeDuplicateFeedback(
    [
      ...visualStrengths,
      ...frameworkStrengths.filter((item) =>
        /market direction|support|resistance|supply|demand|entry area|bearish|bullish/i.test(item)
      ),
      ...(visualStrengths.length
        ? []
        : frameworkStrengths.filter(
            (item) =>
              !/instrument and timeframe are visible|chart is clear enough|chart has enough price history/i.test(
                String(item || "")
              )
          )),
    ],
    4
  );

  const weaknesses = removeDuplicateFeedback(
    [
      ...visualWeaknesses.filter(isActualWeakness),
      ...frameworkWeaknesses.filter(isActualWeakness),
    ],
    4
  );

  const isPreTrade = normalizeAnalysisType(analysisType) === "pre-trade";
  const hasUsefulMarkedPlan =
    chartMarkingStatus === "marked" &&
    (normalizeArrayOfStrings(visualReview?.csaSimilarities, []).length > 0 ||
      normalizeArrayOfStrings(visualReview?.chartSpecificStrengths, []).some(
        (item) => /support|resistance|supply|demand|entry area|sell area|buy area/i.test(item)
      ));
  const hasPlannedArea = Boolean(
    String(visualReview?.bestAreaToWatch || "").trim() ||
      String(visualReview?.coachVerdict || "").trim()
  );

  let setupQualityScore = clampScore(
    Number.isFinite(Number(visualReview?.setupQualityScore))
      ? visualReview.setupQualityScore
      : setupScore
  );
  let entryAccuracyScore = clampScore(
    Number.isFinite(Number(visualReview?.entryAccuracyScore))
      ? visualReview.entryAccuracyScore
      : hasConfirmedTrigger
      ? 60
      : 30
  );
  let riskManagementScore = clampScore(
    Number.isFinite(Number(visualReview?.riskManagementScore))
      ? visualReview.riskManagementScore
      : hasVisibleRiskPlan
      ? 60
      : 30
  );

  // A chart with no visible executed trade is a plan/readiness review, not an automatic failure.
  // Apply this protection even when the user accidentally selects post-trade mode.
  if (!hasVisibleTrade) {
    if (hasUsefulMarkedPlan || hasPlannedArea) setupQualityScore = Math.max(setupQualityScore, 60);
    else setupQualityScore = Math.max(setupQualityScore, isPreTrade ? 45 : 40);

    // No trigger yet means “not ready”, not “zero accuracy”.
    entryAccuracyScore = Math.max(entryAccuracyScore, hasConfirmedTrigger ? 65 : 45);

    // Missing SL/TP reduces the score, but does not erase the quality of the plan.
    riskManagementScore = Math.max(riskManagementScore, hasVisibleRiskPlan ? 65 : 35);
  }

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
      summary: !hasVisibleTrade
        ? "No trade entry is visible, so entry quality was not judged."
        : hasConfirmedTrigger
        ? `Visible confirmation: ${chartDetection.visibleTrigger}.`
        : "No clear entry confirmation is visible for the trade.",
    },
    riskManagement: {
      score: riskManagementScore,
      label: scoreLabel(riskManagementScore),
      summary: !hasVisibleTrade
        ? "No trade is visible, so stop loss and target placement were not judged."
        : hasVisibleRiskPlan
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
      detectedLatestVisibleDate:
        detectedDateText || chartDetection?.latestVisibleDate || null,
      chartMarkingStatus,
      tradeVisibility,
      tradeVisibilityReason:
        visualReview?.tradeVisibilityReason || "",
      csaAnchorMatch: visualReview?.csaAnchorMatch || "not_checked",
      csaLevelVisibility:
        visualReview?.csaLevelVisibility || "Not reviewed",
      visibleMarkedLevels: visualReview?.visibleMarkedLevels || [],
      csaSimilarities: visualReview?.csaSimilarities || [],
      csaDifferences: visualReview?.csaDifferences || [],
      chartContextScore: 100,
      chartContextLabel: "Verified",
      chartContextSummary:
        "The selected instrument and timeframe were checked against the uploaded chart.",
      status: "Reviewed",
    },

    // Backward-compatible fields used by the response builder and dashboard.
    chartContextCheck: {
      selectedInstrument: submittedInstrument,
      selectedTimeframe: timeframe,
      selectedDate: selectedDateText,
      detectedInstrument: chartDetection?.detectedInstrument || null,
      detectedTimeframe: chartDetection?.detectedTimeframe || null,
      detectedDate: detectedDateText || null,
      detectedLatestVisibleDate:
        detectedDateText || chartDetection?.latestVisibleDate || null,
      chartMarkingStatus,
      tradeVisibility,
      tradeVisibilityReason:
        visualReview?.tradeVisibilityReason || "",
      csaAnchorMatch: visualReview?.csaAnchorMatch || "not_checked",
      csaLevelVisibility:
        visualReview?.csaLevelVisibility || "Not reviewed",
      visibleMarkedLevels: visualReview?.visibleMarkedLevels || [],
      csaSimilarities: visualReview?.csaSimilarities || [],
      csaDifferences: visualReview?.csaDifferences || [],
      chartContextScore: 100,
      chartContextLabel: "Verified",
      chartContextSummary:
        "The selected instrument and timeframe were checked against the uploaded chart.",
      status: "Reviewed",
    },
    scores: {
      setupQuality: setupQualityScore,
      entryAccuracy: entryAccuracyScore,
      riskManagement: riskManagementScore,
    },
    failedAreas: [],
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

function getFirstAnchorLabel(profile = getSupportedCsaTimeframeProfile("H1")) {
  if (profile.structureMode === "daily-in-week") return "Monday";
  if (profile.structureMode === "weekly-in-month") return "the first week";
  if (profile.structureMode === "monthly-in-year") return "the first month";
  if (profile.structureMode === "quarterly-in-year") return "the first quarter";
  if (profile.structureMode === "yearly-in-multi-year") return "the first year";
  return "the first key range";
}

function getInitialRangeAreas(
  levels = [],
  profile = getSupportedCsaTimeframeProfile("H1")
) {
  const first = Array.isArray(levels) && levels.length ? levels[0] : null;
  const label = first?.periodLabel || first?.day || getFirstAnchorLabel(profile);

  return {
    label,
    support:
      first && Number.isFinite(Number(first.low))
        ? Number(first.low)
        : null,
    resistance:
      first && Number.isFinite(Number(first.high))
        ? Number(first.high)
        : null,
  };
}

function getInitialRangeStatus(
  levels = [],
  symbol = "",
  profile = getSupportedCsaTimeframeProfile("H1")
) {
  const initial = getInitialRangeAreas(levels, profile);
  const tolerance = getCleanBreakTolerance(symbol);
  const support = Number(initial.support);
  const resistance = Number(initial.resistance);

  const status = {
    ...initial,
    supportText: formatPrice(support),
    resistanceText: formatPrice(resistance),
    hasInitialRange:
      Number.isFinite(support) && Number.isFinite(resistance),
    wickAboveHigh: false,
    wickBelowLow: false,
    closeAboveHigh: false,
    closeBelowLow: false,
    isStillInsideInitialRange: false,
    breakoutDirection: "none",
    rangeMessage: "",
  };

  if (!status.hasInitialRange) {
    status.rangeMessage =
      "The first key support/resistance range is not available.";
    return status;
  }

  if (!Array.isArray(levels) || levels.length < 2) {
    status.isStillInsideInitialRange = true;
    status.rangeMessage = `${initial.label} resistance around ${status.resistanceText} and ${initial.label} support around ${status.supportText} are the only active areas for now.`;
    return status;
  }

  const laterLevels = levels.slice(1);

  status.wickAboveHigh = laterLevels.some(
    (item) => Number(item.high) > resistance + tolerance
  );
  status.wickBelowLow = laterLevels.some(
    (item) => Number(item.low) < support - tolerance
  );
  status.closeAboveHigh = laterLevels.some(
    (item) => Number(item.close) > resistance + tolerance
  );
  status.closeBelowLow = laterLevels.some(
    (item) => Number(item.close) < support - tolerance
  );
  status.isStillInsideInitialRange =
    !status.closeAboveHigh && !status.closeBelowLow;

  if (status.closeAboveHigh) status.breakoutDirection = "up";
  if (status.closeBelowLow) {
    status.breakoutDirection =
      status.breakoutDirection === "up" ? "both" : "down";
  }

  status.rangeMessage = status.isStillInsideInitialRange
    ? `Price has not closed above ${initial.label} high around ${status.resistanceText} or below ${initial.label} low around ${status.supportText} yet. For now, those remain the only main rejection areas.`
    : status.breakoutDirection === "up"
    ? `Price has closed above ${initial.label} resistance around ${status.resistanceText}. The better trend setup is to wait for a pullback/retest of that broken resistance as support.`
    : status.breakoutDirection === "down"
    ? `Price has closed below ${initial.label} support around ${status.supportText}. The better trend setup is to wait for a pullback/retest of that broken support as resistance.`
    : `Price has moved outside ${initial.label}'s range. Wait for a clear retest before judging the next setup.`;

  return status;
}

function buildDashboardAliases(dashboardFeedback = {}) {
  const contextCheck = dashboardFeedback.contextCheck || dashboardFeedback.chartContextCheck || {};
  const setupQuality = dashboardFeedback.setupQuality || { score: 0, label: "Unavailable", summary: "Setup quality was not calculated." };
  const entryAccuracy = dashboardFeedback.entryAccuracy || { score: 0, label: "Unavailable", summary: "Entry accuracy was not calculated." };
  const riskManagement = dashboardFeedback.riskManagement || { score: 0, label: "Unavailable", summary: "Risk management was not calculated." };
  const strengths = Array.isArray(dashboardFeedback.strengths) && dashboardFeedback.strengths.length ? dashboardFeedback.strengths : ["CSA Coach completed the review."];
  const weaknesses = Array.isArray(dashboardFeedback.weaknesses) && dashboardFeedback.weaknesses.length
    ? dashboardFeedback.weaknesses
    : ["Price has not yet confirmed a complete entry setup. Wait for the planned area, trigger, stop loss, and target to be clear."];
  const aiMistakeDetectionHub = Array.isArray(dashboardFeedback.aiMistakeDetectionHub) && dashboardFeedback.aiMistakeDetectionHub.length ? dashboardFeedback.aiMistakeDetectionHub : [makeSimpleMistake("No major mistake detected", "REVIEW")];
  const failedAreas = Array.isArray(dashboardFeedback.failedAreas) ? dashboardFeedback.failedAreas : [];
  return {
    strengths, weaknesses,
    chartContextCheck: contextCheck, contextCheck, chartContext: contextCheck, chartContextStatus: contextCheck.status || "Not available",
    selectedContext: { instrument: contextCheck.selectedInstrument || "Not provided", timeframe: contextCheck.selectedTimeframe || "Not provided", date: contextCheck.selectedDate || "Not provided" },
    detectedContext: { instrument: contextCheck.detectedInstrument || "Not detected", timeframe: contextCheck.detectedTimeframe || "Not detected", latestVisibleDate: contextCheck.detectedLatestVisibleDate || "Not detected" },
    setupQuality, setupQualityScore: setupQuality.score, setupQualityLabel: setupQuality.label, setupQualitySummary: setupQuality.summary,
    entryAccuracy, entryAccuracyScore: entryAccuracy.score, entryAccuracyLabel: entryAccuracy.label, entryAccuracySummary: entryAccuracy.summary,
    riskManagement, riskManagementScore: riskManagement.score, riskManagementLabel: riskManagement.label, riskManagementSummary: riskManagement.summary,
    chartContextScore: Number(contextCheck.chartContextScore ?? (contextCheck.status === "Reviewed" ? 100 : 0)), chartContextLabel: contextCheck.chartContextLabel || (contextCheck.status === "Reviewed" ? "Verified" : "Not verified"), chartContextSummary: contextCheck.chartContextSummary || "Checks whether the selected pair/timeframe matches the uploaded chart before analysis.",
    aiMistakeDetectionHub, mistakeDetectionHub: aiMistakeDetectionHub, mistakeHub: aiMistakeDetectionHub, mistakes: aiMistakeDetectionHub,
    failedAreas,
    dashboard: { strengths, weaknesses, chartContextCheck: contextCheck, contextCheck, setupQuality, entryAccuracy, riskManagement, aiMistakeDetectionHub, mistakes: aiMistakeDetectionHub, failedAreas },
    dashboardCards: { strengths, weaknesses, chartContextCheck: contextCheck, setupQuality, entryAccuracy, riskManagement, aiMistakeDetectionHub, failedAreas },
  };
}

function buildSimpleStructureBreakdown(levels = [], normalizedSymbol = "") {
  if (!levels.length) return "- No structure data available.";
  return levels.map((period, index) => {
    const label = period.periodLabel || period.day || period.key;
    if (index === 0) return `${label}:\n- High ${formatPrice(period.high)} = first resistance.\n- Low ${formatPrice(period.low)} = first support.`;
    const previous = levels[index - 1];
    const highComparison = compareHighWithTolerance(period.high, previous.high, normalizedSymbol);
    const lowComparison = compareLowWithTolerance(period.low, previous.low, normalizedSymbol);
    return `${label}:\n- ${highComparison.cleanBreak ? "High broke previous high = resistance." : "High failed to break previous high = supply."}\n- ${lowComparison.cleanBreak ? "Low broke previous low = support." : "Low held/retested previous low = demand."}`;
  }).join("\n\n");
}

function getPeriodExtremes(levels = [], symbol = "") {
  const highs = Array.isArray(levels) ? levels.map((item) => Number(item.high)).filter(Number.isFinite) : [];
  const lows = Array.isArray(levels) ? levels.map((item) => Number(item.low)).filter(Number.isFinite) : [];
  const high = highs.length ? Math.max(...highs) : null;
  const low = lows.length ? Math.min(...lows) : null;
  const range = Number.isFinite(high) && Number.isFinite(low)
    ? Math.max(Math.abs(high - low), getCleanBreakTolerance(symbol))
    : getCleanBreakTolerance(symbol);
  return { high, low, range };
}

function entryRoleForArea(area, direction = "sell", levels = [], symbol = "") {
  const type = String(area?.type || "").toLowerCase();
  const broken = isAreaBrokenIntoOppositeRole(area, levels, symbol);

  if (direction === "sell") {
    if (type === "resistance" || type === "supply") return { usable: !broken, role: "resistance", flip: false };
    if ((type === "support" || type === "demand") && broken) return { usable: true, role: "resistance", flip: true };
    return { usable: false, role: "resistance", flip: false };
  }

  if (type === "support" || type === "demand") return { usable: !broken, role: "support", flip: false };
  if ((type === "resistance" || type === "supply") && broken) return { usable: true, role: "support", flip: true };
  return { usable: false, role: "support", flip: false };
}

function isAreaBrokenIntoOppositeRole(area, levels = [], symbol = "") {
  return Boolean(area && areaBrokenByCloseLater(area, levels, symbol));
}

function isMeaningfullyDifferentArea(a, b, symbol = "") {
  if (!a || !b) return false;
  const tolerance = getCleanBreakTolerance(symbol) * 2;
  return Math.abs(Number(a.price) - Number(b.price)) > tolerance;
}

function buildEntryCandidate(area, { direction = "sell", levels = [], symbol = "", currentPrice = null }) {
  const price = Number(area?.price);
  const current = Number(currentPrice);
  if (!Number.isFinite(price)) return null;

  const tolerance = getCleanBreakTolerance(symbol);
  if (Number.isFinite(current)) {
    if (direction === "sell" && price < current - tolerance) return null;
    if (direction === "buy" && price > current + tolerance) return null;
  }

  const roleInfo = entryRoleForArea(area, direction, levels, symbol);
  if (!roleInfo.usable) return null;

  const extremes = getPeriodExtremes(levels, symbol);
  const range = extremes.range || getCleanBreakTolerance(symbol);
  const distanceFromCurrent = Number.isFinite(current) ? Math.abs(price - current) : null;
  const distancePercent = Number.isFinite(distanceFromCurrent) ? distanceFromCurrent / range : 0.25;
  const levelPosition = Number.isFinite(extremes.high) && Number.isFinite(extremes.low)
    ? (price - extremes.low) / range
    : null;

  let score = 0;
  if (roleInfo.flip) score += 3;
  if (distancePercent >= 0.12) score += 2;
  if (distancePercent >= 0.22) score += 1;
  if (distancePercent < 0.08) score -= 3;

  // Internal deep-pullback guide only. Do not expose this as Fibonacci or percentages to users.
  if (Number.isFinite(levelPosition)) {
    if (direction === "sell") {
      if (levelPosition >= 0.50 && levelPosition <= 0.82) score += 3;
      else if (levelPosition >= 0.38 && levelPosition < 0.50) score += 1;
      else if (levelPosition < 0.25) score -= 2;
    } else {
      if (levelPosition >= 0.18 && levelPosition <= 0.50) score += 3;
      else if (levelPosition > 0.50 && levelPosition <= 0.62) score += 1;
      else if (levelPosition > 0.75) score -= 2;
    }
  }

  return {
    label: area.day || area.period || area.date || "key area",
    originalType: area.type,
    type: roleInfo.role,
    price,
    priceText: area.priceText || formatPrice(price),
    isFlipArea: roleInfo.flip,
    distanceFromCurrent,
    distancePercent,
    levelPosition,
    score,
    sourceArea: area,
  };
}

function getRankedEntryAreas({ areas = [], levels = [], symbol = "", direction = "sell", currentPrice = null, profile = getSupportedCsaTimeframeProfile("H1") }) {
  const candidates = [];
  const seen = new Set();

  for (const area of areas) {
    const candidate = buildEntryCandidate(area, { direction, levels, symbol, currentPrice });
    if (!candidate) continue;
    const key = `${candidate.type}-${candidate.priceText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }

  const initial = getInitialRangeAreas(levels, profile);
  if (direction === "sell" && Number.isFinite(Number(initial.resistance))) {
    candidates.push({
      label: initial.label,
      originalType: "resistance",
      type: "resistance",
      price: Number(initial.resistance),
      priceText: formatPrice(initial.resistance),
      isFlipArea: false,
      distanceFromCurrent: Number.isFinite(Number(currentPrice)) ? Math.abs(Number(initial.resistance) - Number(currentPrice)) : null,
      distancePercent: 0.2,
      levelPosition: null,
      score: 1,
      sourceArea: null,
    });
  }

  if (direction === "buy" && Number.isFinite(Number(initial.support))) {
    candidates.push({
      label: initial.label,
      originalType: "support",
      type: "support",
      price: Number(initial.support),
      priceText: formatPrice(initial.support),
      isFlipArea: false,
      distanceFromCurrent: Number.isFinite(Number(currentPrice)) ? Math.abs(Number(initial.support) - Number(currentPrice)) : null,
      distancePercent: 0.2,
      levelPosition: null,
      score: 1,
      sourceArea: null,
    });
  }

  return candidates
    .filter((candidate) => Number.isFinite(Number(candidate.price)))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ad = Number.isFinite(a.distanceFromCurrent) ? a.distanceFromCurrent : Infinity;
      const bd = Number.isFinite(b.distanceFromCurrent) ? b.distanceFromCurrent : Infinity;
      return ad - bd;
    });
}

function getNearestCandidate(candidates = [], currentPrice = null) {
  const current = Number(currentPrice);
  if (!Number.isFinite(current) || !Array.isArray(candidates) || !candidates.length) return null;
  return [...candidates].sort((a, b) => Math.abs(Number(a.price) - current) - Math.abs(Number(b.price) - current))[0] || null;
}

function formatAreaComparison({ direction = "sell", nearestArea = null, betterArea = null, symbol = "" }) {
  if (!nearestArea || !betterArea || !isMeaningfullyDifferentArea(nearestArea, betterArea, symbol)) return "";
  const action = direction === "sell" ? "sell" : "buy";
  const role = direction === "sell" ? "resistance" : "support";
  const roomText = direction === "sell" ? "more room to fall" : "more room to rise";
  const rejectText = direction === "sell" ? "rejects from there" : "holds from there";
  const nearText = nearestArea.priceText || formatPrice(nearestArea.price);
  const betterText = betterArea.priceText || formatPrice(betterArea.price);
  return `${role[0].toUpperCase() + role.slice(1)} around ${nearText} is a possible ${action} area, but it is very close to current price, so the reward may be limited. A better ${action} area is around ${betterText} because it gives price ${roomText} if it ${rejectText}.`;
}

function getNearestAreaForDirection({ areas = [], levels = [], symbol = "", direction = "buy", currentPrice = null, profile = getSupportedCsaTimeframeProfile("H1") }) {
  const initial = getInitialRangeAreas(levels, profile);
  const ranked = getRankedEntryAreas({ areas, levels, symbol, direction, currentPrice, profile });
  if (ranked.length) return ranked[0];

  if (direction === "buy") {
    return { label: initial.label, type: "support", price: initial.support, priceText: formatPrice(initial.support) };
  }

  return { label: initial.label, type: "resistance", price: initial.resistance, priceText: formatPrice(initial.resistance) };
}

function excludeSameDayAreas(areas = [], selectedDateText = "") {
  const selectedDate = String(selectedDateText || "").slice(0, 10);
  if (!selectedDate) return Array.isArray(areas) ? areas : [];

  return (Array.isArray(areas) ? areas : []).filter(
    (area) => String(area?.date || "").slice(0, 10) !== selectedDate
  );
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

  // Always rank every valid buying and selling area.
  // The first range remains an important anchor, but it must not hide a later
  // supply/demand area that offers the better entry location.
  const buyCandidates = getRankedEntryAreas({
    areas,
    levels,
    symbol,
    direction: "buy",
    currentPrice,
    profile,
  });
  const sellCandidates = getRankedEntryAreas({
    areas,
    levels,
    symbol,
    direction: "sell",
    currentPrice,
    profile,
  });

  const buyArea =
    buyCandidates[0] ||
    getNearestAreaForDirection({
      areas,
      levels,
      symbol,
      direction: "buy",
      currentPrice,
      profile,
    }) ||
    {
      label: "the first key range",
      type: "support",
      price: initial.support,
      priceText: formatPrice(initial.support),
    };

  const sellArea =
    sellCandidates[0] ||
    getNearestAreaForDirection({
      areas,
      levels,
      symbol,
      direction: "sell",
      currentPrice,
      profile,
    }) ||
    {
      label: "the first key range",
      type: "resistance",
      price: initial.resistance,
      priceText: formatPrice(initial.resistance),
    };

  const nearestBuyArea = getNearestCandidate(buyCandidates, currentPrice);
  const nearestSellArea = getNearestCandidate(sellCandidates, currentPrice);
  const buyAreaComparison = formatAreaComparison({ direction: "buy", nearestArea: nearestBuyArea, betterArea: buyArea, symbol });
  const sellAreaComparison = formatAreaComparison({ direction: "sell", nearestArea: nearestSellArea, betterArea: sellArea, symbol });

  const initialSupportText = initialStatus.supportText || formatPrice(initial.support);
  const initialResistanceText = initialStatus.resistanceText || formatPrice(initial.resistance);
  const buyPriceText = buyArea.priceText || formatPrice(buyArea.price);
  const sellPriceText = sellArea.priceText || formatPrice(sellArea.price);

  const lowerSupportCandidates = buyCandidates
    .filter(
      (candidate) =>
        Number.isFinite(Number(candidate?.price)) &&
        Number(candidate.price) < currentPrice
    )
    .sort(
      (a, b) =>
        Math.abs(currentPrice - Number(a.price)) -
        Math.abs(currentPrice - Number(b.price))
    );

  const nextSupportArea = lowerSupportCandidates[0] || null;
  const nextSupportText = nextSupportArea
    ? nextSupportArea.priceText || formatPrice(nextSupportArea.price)
    : null;

  const higherResistanceCandidates = sellCandidates
    .filter(
      (candidate) =>
        Number.isFinite(Number(candidate?.price)) &&
        Number(candidate.price) > currentPrice
    )
    .sort(
      (a, b) =>
        Math.abs(Number(a.price) - currentPrice) -
        Math.abs(Number(b.price) - currentPrice)
    );

  const nextResistanceArea = higherResistanceCandidates[0] || null;
  const nextResistanceText = nextResistanceArea
    ? nextResistanceArea.priceText ||
      formatPrice(nextResistanceArea.price)
    : null;

  let quickVerdict = "Wait for price to reach a clear area before taking action.";
  let whatThisMeans = "The safest plan is to wait for price to reach support or resistance, then look for a clear reaction.";
  let bestAreaToWatch = `Buy only if price drops to support around ${initialSupportText} and holds. Sell only if price rises to resistance around ${initialResistanceText} and rejects.`;
  let mainWarning = "Do not trade in the middle of the range. Wait for price to reach a clear support or resistance area first.";
  let coachVerdict = "This is a wait setup until price reaches one of the key areas and shows a clear reaction.";
  let preferredTrendSetup = "The preferred trend-trading setup is breakout, pullback, and retest.";

  if (useInitialRangeOnly && biasGroup === "range") {
    quickVerdict = "Wait. Price is still moving inside the main range.";
    whatThisMeans = "The market has not produced a clean directional break, so entries should be taken only from a confirmed edge of the range.";
    bestAreaToWatch = `The main buying area is around ${buyPriceText}, while the main selling area is around ${sellPriceText}. Wait for confirmation at either area.`;
    mainWarning = "Do not enter in the middle of the range or chase price after it has already moved.";
    coachVerdict = "This remains a wait setup until price reaches a confirmed buying or selling area.";
    preferredTrendSetup = "Wait for price to reach a confirmed area and show a clear rejection or break-and-hold.";
  } else if (biasGroup === "bullish") {
    quickVerdict = `Bullish plan: wait for price to pull back to support around ${buyPriceText} before considering a buy.`;
    whatThisMeans = `The better buy idea is not to chase price now, but to wait for price to drop back to support around ${buyPriceText} and hold.`;
    bestAreaToWatch = buyAreaComparison || `For a buy, wait for price to drop back to support around ${buyPriceText} and then show a clear bullish candle or strong rejection from that area.`;
    mainWarning = nextResistanceText
      ? `Do not buy in the middle. Wait for the better support area around ${buyPriceText} or a fresh breakout-and-hold of ${nextResistanceText} resistance before considering a buy.`
      : `Do not buy in the middle. Wait for the better support area around ${buyPriceText} or a fresh breakout-and-hold of the next resistance before considering a buy.`;
    coachVerdict = `The cleaner plan is to look for buys only after price holds the better support area around ${buyPriceText}.`;
  } else if (biasGroup === "bearish") {
    quickVerdict = `Bearish plan: wait for price to rise back to resistance around ${sellPriceText} before considering a sell.`;
    whatThisMeans = `The better sell idea is not to chase price now, but to wait for price to pull back up to resistance around ${sellPriceText} and reject.`;
    bestAreaToWatch = sellAreaComparison || `For a sell, wait for price to rise back to resistance around ${sellPriceText} and then show a clear bearish candle or strong rejection from that area.`;
    mainWarning = nextSupportText
      ? `Do not sell after price has already dropped. Wait for the better resistance area around ${sellPriceText} or a fresh breakdown-and-hold of ${nextSupportText} support before considering a sell.`
      : `Do not sell after price has already dropped. Wait for the better resistance area around ${sellPriceText} or a fresh breakdown-and-hold of the next support before considering a sell.`;
    coachVerdict = `The cleaner plan is to look for sells only after price rejects the better resistance area around ${sellPriceText}.`;
  } else if (biasGroup === "range_bullish") {
    quickVerdict = `No clean trend yet, but buyers have pressure. Buy only if price drops to support around ${initialSupportText} and holds.`;
    whatThisMeans = `Price is still inside the main range, so support around ${initialSupportText} and resistance around ${initialResistanceText} are the key areas for now.`;
    bestAreaToWatch = `Buy only if price drops to support around ${initialSupportText} and holds. Sell only if price rises to resistance around ${initialResistanceText} and rejects.`;
    mainWarning = `The market has not fully opened up yet. Do not chase; wait for support around ${initialSupportText} or resistance around ${initialResistanceText}.`;
    coachVerdict = `For now, treat this as a range with bullish pressure until price clearly closes above ${initialResistanceText} or below ${initialSupportText}.`;
  } else if (biasGroup === "range_bearish") {
    quickVerdict = `Bearish pressure remains, but price is consolidating. Wait for price to rise to the better selling area around ${sellPriceText}.`;
    whatThisMeans = `The broader pressure favours sellers, but price is currently close to support, so selling now would mean chasing the move.`;
    bestAreaToWatch = sellAreaComparison || `Wait for price to return to the supply or resistance area around ${sellPriceText} and show a clear bearish trigger before considering a sell.`;
    mainWarning = nextSupportText
      ? `Do not sell while price is close to support around ${nextSupportText}. Wait for the better selling area around ${sellPriceText}.`
      : `Do not chase the sell while price is already low. Wait for the better selling area around ${sellPriceText}.`;
    coachVerdict = `The cleaner plan is to wait for a bearish trigger from the better supply or resistance area around ${sellPriceText}.`;
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
    nextSupportArea,
    nextSupportText,
    nextResistanceArea,
    nextResistanceText,
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
    return "No clear sell confirmation is visible yet.";
  }

  if (biasGroup === "bullish" || biasGroup === "range_bullish") {
    return "No clear buy confirmation is visible yet.";
  }

  if (trendPlan?.useInitialRangeOnly) {
    return "No clear entry confirmation is visible yet.";
  }

  const visualText = String(visualReview?.entryEvidence || "").trim();
  if (visualText && !/support first|resistance first|hold below support|below support/i.test(visualText)) return visualText;

  return "No clear entry confirmation is visible yet.";
}

function buildChartMarkingComparisonText({
  visualReview,
  trendPlan,
}) {
  const markingStatus = getChartMarkingStatus(visualReview);
  const anchorMatch = String(
    visualReview?.csaAnchorMatch || ""
  ).toLowerCase();

  const initialStatus = trendPlan?.initialRangeStatus || {};
  const supportHasFlipped =
    initialStatus.breakoutDirection === "down" ||
    initialStatus.breakoutDirection === "both" ||
    initialStatus.closeBelowLow === true;

  const resistanceHasFlipped =
    initialStatus.breakoutDirection === "up" ||
    initialStatus.breakoutDirection === "both" ||
    initialStatus.closeAboveHigh === true;

  if (anchorMatch === "full") {
    if (resistanceHasFlipped && supportHasFlipped) {
      return `There is a resistance correctly marked around ${trendPlan.initialResistanceText}, which has now broken and should act as support, and a support correctly marked around ${trendPlan.initialSupportText}, which has now broken and should act as resistance.`;
    }

    if (resistanceHasFlipped) {
      return `There is a resistance correctly marked around ${trendPlan.initialResistanceText}, which has now broken and should act as support, and a support correctly marked around ${trendPlan.initialSupportText}.`;
    }

    if (supportHasFlipped) {
      return `There is a resistance correctly marked around ${trendPlan.initialResistanceText}, and a support correctly marked around ${trendPlan.initialSupportText}, which has now broken and should act as resistance.`;
    }

    return `There is a resistance correctly marked around ${trendPlan.initialResistanceText}, and a support correctly marked around ${trendPlan.initialSupportText}.`;
  }

  if (anchorMatch === "partial") {
    const firstMatch = normalizeArrayOfStrings(
      visualReview?.csaSimilarities,
      []
    )[0];

    if (/resistance/i.test(firstMatch || "")) {
      if (resistanceHasFlipped) {
        return `There is a resistance correctly marked around ${trendPlan.initialResistanceText}, which has now broken and should act as support.`;
      }

      return `There is a resistance correctly marked around ${trendPlan.initialResistanceText}.`;
    }

    if (/support/i.test(firstMatch || "")) {
      if (supportHasFlipped) {
        return `There is a support correctly marked around ${trendPlan.initialSupportText}, which has now broken and should act as resistance.`;
      }

      return `There is a support correctly marked around ${trendPlan.initialSupportText}.`;
    }

    return "One key level is marked correctly, but the other level could not be confirmed.";
  }

  if (markingStatus === "marked") {
    return "Support and resistance lines are visible, but their exact prices could not be confirmed.";
  }

  if (markingStatus === "unmarked") {
    if (resistanceHasFlipped && supportHasFlipped) {
      return `No support or resistance lines are marked. The main areas to watch are support around ${trendPlan.initialSupportText}, which has now broken and should act as resistance, and resistance around ${trendPlan.initialResistanceText}, which has now broken and should act as support.`;
    }

    if (resistanceHasFlipped) {
      return `No support or resistance lines are marked. The main areas to watch are support around ${trendPlan.initialSupportText} and resistance around ${trendPlan.initialResistanceText}, which has now broken and should act as support.`;
    }

    if (supportHasFlipped) {
      return `No support or resistance lines are marked. The main areas to watch are support around ${trendPlan.initialSupportText}, which has now broken and should act as resistance, and resistance around ${trendPlan.initialResistanceText}.`;
    }

    return `No support or resistance lines are marked. The main areas to watch are support around ${trendPlan.initialSupportText} and resistance around ${trendPlan.initialResistanceText}.`;
  }

  if (resistanceHasFlipped && supportHasFlipped) {
    return `The chart levels could not be confirmed clearly. The main areas to watch are support around ${trendPlan.initialSupportText}, which has now broken and should act as resistance, and resistance around ${trendPlan.initialResistanceText}, which has now broken and should act as support.`;
  }

  if (resistanceHasFlipped) {
    return `The chart levels could not be confirmed clearly. The main areas to watch are support around ${trendPlan.initialSupportText} and resistance around ${trendPlan.initialResistanceText}, which has now broken and should act as support.`;
  }

  if (supportHasFlipped) {
    return `The chart levels could not be confirmed clearly. The main areas to watch are support around ${trendPlan.initialSupportText}, which has now broken and should act as resistance, and resistance around ${trendPlan.initialResistanceText}.`;
  }

  return `The chart levels could not be confirmed clearly. The main areas to watch are support around ${trendPlan.initialSupportText} and resistance around ${trendPlan.initialResistanceText}.`;
}

function buildDeterministicCsaAnalysis({ marketReference, dateDecision, chartDetection, visualReview = null, submittedInstrument, normalizedSymbol, timeframe }) {
  const profile = marketReference?.profile || getSupportedCsaTimeframeProfile(timeframe);

  if (!marketReference || !marketReference.ok) {
    return `Quick Verdict:
- I could not review this chart properly because the market data was not available.

What This Means:
- Check that the selected instrument, timeframe, and date are correct, then run the review again.

Overall Setup Score:
- 0/10`;
  }

  const levels = marketReference.dailyLevels || [];
  const allAreas = marketReference.csaAreas || [];
  const selectedDateText =
    dateDecision?.finalDateText ||
    dateDecision?.selectedDateText ||
    "";

  // Use only levels created before the selected date.
  const areas = excludeSameDayAreas(allAreas, selectedDateText);

  const bias =
    marketReference.directionalBias ||
    calculateCsaDirectionalBias(
      levels,
      normalizedSymbol,
      profile
    );

  const {
    resistanceAreas,
    supportAreas,
    supplyAreas,
    demandAreas,
  } = splitAreas(areas);

  const failedAreas = buildFailedAreas({
    supportAreas,
    resistanceAreas,
    supplyAreas,
    demandAreas,
    levels,
    symbol: normalizedSymbol,
  });

  const trendPlan = buildBeginnerTrendPlan({
    levels,
    areas,
    bias,
    symbol: normalizedSymbol,
    profile,
  });

  const overallScore =
    Number.isFinite(Number(visualReview?.setupQualityScore)) && Number(visualReview.setupQualityScore) >= 20
      ? Math.max(1, Math.round(Number(visualReview.setupQualityScore) / 10))
      : failedAreas.length
      ? 5
      : String(bias.biasCode || "").includes("range")
      ? 6
      : 7;

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

  return `Quick Verdict:
- ${quickVerdict}

Chart Levels:
- ${markingComparison}

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


function formatPreferredEntryZone(visualReview = null, directionalBias = "") {
  const area = visualReview?.preferredEntryArea;
  if (!area || typeof area !== "object") return "";

  const low = Number(area.zoneLow);
  const high = Number(area.zoneHigh);
  const hasLow = Number.isFinite(low);
  const hasHigh = Number.isFinite(high);
  const areaType = String(area.areaType || "area").toLowerCase();
  const direction = String(area.direction || "").toLowerCase();
  const status = String(area.priceStatus || "unclear").toLowerCase();
  const zoneText = String(area.zoneText || "").trim();

  const zoneTextHasRange =
    /\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?/i.test(zoneText);

  let priceText = zoneText;
  if (hasLow && hasHigh) {
    const zoneMin = Math.min(low, high);
    const zoneMax = Math.max(low, high);
    priceText = `${formatPrice(zoneMin)}–${formatPrice(zoneMax)}`;
  } else if (zoneTextHasRange) {
    priceText = zoneText;
  } else if (hasLow) {
    priceText = formatPrice(low);
  } else if (hasHigh) {
    priceText = formatPrice(high);
  }

  const bearish = /bearish/.test(String(directionalBias).toLowerCase()) || direction === "sell";
  const bullish = /bullish/.test(String(directionalBias).toLowerCase()) || direction === "buy";
  const namedArea = areaType && areaType !== "none" ? areaType : bearish ? "supply area" : bullish ? "demand area" : "planned area";
  const cleanedPriceText = String(priceText || "")
    .replace(/^\s*(?:the\s+)?(?:supply|demand|support|resistance|converted support|converted resistance)\s+(?:area|zone)?\s*(?:around|near|at)?\s*/i, "")
    .trim();
  const location = cleanedPriceText
    ? `${namedArea} around ${cleanedPriceText}`
    : `the ${namedArea}`;

  if (bearish) {
    if (["not reached", "approaching", "unclear"].includes(status)) {
      return `Wait for price to retrace towards the ${location} and show a clear bearish trigger before considering a sell. Do not chase the move while price remains close to support.`;
    }
    if (status === "inside") {
      return `Price is now inside the ${location}. Wait for a clear bearish trigger before considering a sell.`;
    }
    if (status === "reacted") {
      return `Price has reacted from the ${location}. Only consider the sell if the bearish trigger is still fresh and the first support target leaves enough room.`;
    }
  }

  if (bullish) {
    if (["not reached", "approaching", "unclear"].includes(status)) {
      return `Wait for price to return to the ${location} and show a clear bullish trigger before considering a buy. Do not chase the move while price remains close to resistance.`;
    }
    if (status === "inside") {
      return `Price is now inside the ${location}. Wait for a clear bullish trigger before considering a buy.`;
    }
    if (status === "reacted") {
      return `Price has reacted from the ${location}. Only consider the buy if the bullish trigger is still fresh and the first resistance target leaves enough room.`;
    }
  }

  return priceText ? `Watch the ${location} and wait for a fresh confirmation trigger.` : "";
}


function containsMalformedPriceRange(value = "") {
  const text = String(value || "").trim();

  if (/\d+(?:\.\d+)?\s*(?:-|–|—|to)\s*$/i.test(text)) {
    return true;
  }

  const range = text.match(
    /(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+\.?\d*)\s*$/i
  );

  if (!range) return false;

  const right = String(range[2] || "").trim();

  if (/^\d+\.$/.test(right)) {
    return true;
  }

  return !Number.isFinite(Number(right));
}

function isIncompleteFeedbackSentence(value = "") {
  const text = String(value || "").trim();

  if (!text) return true;
  if (containsMalformedPriceRange(text)) return true;

  return /(?:\bto|\band|\bor|\baround|\bnear|\bat|\bfrom|\bbetween)\s*$/i.test(
    text
  );
}

function cleanUserFeedbackItems(items = []) {
  return normalizeArrayOfStrings(items, [])
    .map((item) =>
      removeWeekdayNamesFromUserText(
        String(item || "").replace(/\s+/g, " ").trim()
      )
    )
    .filter((item) => !isIncompleteFeedbackSentence(item));
}


function feedbackMeaningKey(value = "") {
  const text = String(value || "").toLowerCase();

  if (/has not yet (?:retested|reached)|not yet (?:retested|reached)/.test(text)) {
    return "area_not_retested";
  }

  if (
    /no fresh .*trigger|no .*trigger is visible|confirmed entry trigger|no entry trigger|trigger has not formed/.test(
      text
    )
  ) {
    return "trigger_missing";
  }

  if (/stop loss|target|planned risk|risk cannot/.test(text)) {
    return "risk_plan_missing";
  }

  if (
    /converted resistance|converted support|confirmed as resistance|confirmed as support|retest from below|retest from above|broken support|broken resistance/.test(
      text
    )
  ) {
    return "converted_level_unconfirmed";
  }

  if (
    /supply area|demand area|resistance area|support area/.test(text) &&
    /clear .*location|marked|sell location|buy location|monitor/.test(text)
  ) {
    return "marked_entry_area";
  }

  if (/market direction|bearish|bullish/.test(text)) {
    return "direction";
  }

  if (/enough price history|instrument and timeframe|chart is clear enough/.test(text)) {
    return "generic_validation";
  }

  return normalizeMistakeTitle(text);
}

function removeSemanticFeedbackDuplicates(items = [], limit = 4) {
  const result = [];
  const seen = new Set();

  for (const rawItem of cleanUserFeedbackItems(items)) {
    const item = String(rawItem || "").trim();
    if (!item) continue;

    const key = feedbackMeaningKey(item);
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(item);

    if (result.length >= limit) break;
  }

  return result;
}

function prioritizeStarterStrengths(items = [], preferredArea = null) {
  const hasSpecificArea = Boolean(
    preferredArea &&
    String(preferredArea.areaType || "").toLowerCase() !== "none"
  );

  const direction = String(preferredArea?.direction || "").toLowerCase();
  const areaType = String(preferredArea?.areaType || "entry");
  const zoneText = String(preferredArea?.zoneText || "").trim();

  const canonicalItems = [];

  if (direction === "sell") {
    canonicalItems.push("The bearish market direction is identified correctly.");
  } else if (direction === "buy") {
    canonicalItems.push("The bullish market direction is identified correctly.");
  }

  if (hasSpecificArea) {
    canonicalItems.push(
      [
        `The marked ${areaType} area`,
        zoneText,
        `gives a clear ${
          direction === "sell" ? "sell" : direction === "buy" ? "buy" : "trade"
        } location to monitor.`,
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    );

    canonicalItems.push(
      "The important support and resistance areas are visible and can be used to judge where price is trading."
    );

    if (direction === "sell") {
      canonicalItems.push(
        "The plan avoids chasing a sell while price remains close to support."
      );
    } else if (direction === "buy") {
      canonicalItems.push(
        "The plan avoids chasing a buy while price remains close to resistance."
      );
    }
  }

  const filtered = cleanUserFeedbackItems(items).filter((item) => {
    const meaning = feedbackMeaningKey(item);

    if (hasSpecificArea && meaning === "generic_validation") return false;
    if (hasSpecificArea && meaning === "marked_entry_area") return false;
    if (direction && meaning === "direction") return false;

    return true;
  });

  return removeSemanticFeedbackDuplicates(
    [...canonicalItems, ...filtered],
    4
  );
}

function prioritizeStarterWeaknesses(items = []) {
  const cleaned = cleanUserFeedbackItems(items);
  const result = [];
  const seen = new Set();

  const preferredOrder = [
    "area_not_retested",
    "trigger_missing",
    "risk_plan_missing",
    "converted_level_unconfirmed",
  ];

  for (const key of preferredOrder) {
    const matchedItem = cleaned.find(
      (item) => feedbackMeaningKey(item) === key
    );

    if (matchedItem && !seen.has(key)) {
      seen.add(key);
      result.push(matchedItem);
    }
  }

  for (const item of cleaned) {
    const key = feedbackMeaningKey(item);

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(item);

    if (result.length >= 4) break;
  }

  return result.slice(0, 4);
}



const CSA_FEEDBACK_ENGINE_VERSION = "9.5.5";
const CSA_BUILD_ID = "CSA-v4.5.5-strength-init-order-fix";
const CSA_SCORING_MODEL_VERSION = "2.0.0-evidence-aware";

const ANALYSIS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ANALYSIS_CACHE_MAX_ITEMS = 100;
const completedAnalysisCache = new Map();

function createAnalysisFingerprint({
  userId,
  fileBuffer,
  instrument,
  timeframe,
  analysisType,
  chartDate,
  timezone,
  cutoffMode,
  cutoffTime,
  timezoneMode,
  browserTimezone,
  analysisFramework,
  strategyId,
  plan,
}) {
  const hash = crypto.createHash("sha256");
  hash.update(String(userId || ""));
  hash.update("|");
  hash.update(String(instrument || "").trim().toUpperCase());
  hash.update("|");
  hash.update(String(timeframe || "").trim().toUpperCase());
  hash.update("|");
  hash.update(String(analysisType || "").trim().toLowerCase());
  hash.update("|");
  hash.update(String(chartDate || "").trim());
  hash.update("|");
  hash.update(String(timezone || "UTC").trim());
  hash.update("|");
  hash.update(String(cutoffMode || "final_visible").trim().toLowerCase());
  hash.update("|");
  hash.update(String(cutoffTime || "").trim());
  hash.update("|");
  hash.update(String(timezoneMode || "").trim().toLowerCase());
  hash.update("|");
  hash.update(String(browserTimezone || "").trim());
  hash.update("|");
  hash.update(String(analysisFramework || "csa").trim().toLowerCase());
  hash.update("|");
  hash.update(String(strategyId || "").trim());
  hash.update("|");
  hash.update(String(plan || "starter").trim().toLowerCase());
  hash.update("|");
  hash.update(CSA_FEEDBACK_ENGINE_VERSION);
  hash.update("|");

  if (Buffer.isBuffer(fileBuffer)) {
    hash.update(fileBuffer);
  }

  return hash.digest("hex");
}

function getCachedCompletedAnalysis(fingerprint) {
  const cached = completedAnalysisCache.get(fingerprint);
  if (!cached) return null;

  if (Date.now() - cached.createdAt > ANALYSIS_CACHE_TTL_MS) {
    completedAnalysisCache.delete(fingerprint);
    return null;
  }

  return JSON.parse(JSON.stringify(cached.response));
}

function cacheCompletedAnalysis(fingerprint, response) {
  if (!fingerprint || !response) return;

  if (completedAnalysisCache.size >= ANALYSIS_CACHE_MAX_ITEMS) {
    const oldestKey = completedAnalysisCache.keys().next().value;
    if (oldestKey) completedAnalysisCache.delete(oldestKey);
  }

  completedAnalysisCache.set(fingerprint, {
    createdAt: Date.now(),
    response: JSON.parse(JSON.stringify(response)),
  });
}

function asPositiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizedDirectionCode(value = "") {
  const text = String(value || "").toLowerCase();
  if (/sell|bearish|downtrend|lower high|lower low/.test(text)) return "bearish";
  if (/buy|bullish|uptrend|higher high|higher low/.test(text)) return "bullish";
  return "range";
}

function normalizedAreaType(value = "", direction = "range") {
  const text = String(value || "").toLowerCase().trim();

  if (/converted resistance/.test(text)) return "converted resistance";
  if (/converted support/.test(text)) return "converted support";
  if (/supply/.test(text)) return "supply";
  if (/demand/.test(text)) return "demand";
  if (/resistance/.test(text)) return "resistance";
  if (/support/.test(text)) return "support";

  return direction === "bearish"
    ? "supply"
    : direction === "bullish"
    ? "demand"
    : "entry";
}

function areaDirectionMatches(areaType, direction) {
  if (direction === "bearish") {
    return ["supply", "resistance", "converted resistance"].includes(areaType);
  }
  if (direction === "bullish") {
    return ["demand", "support", "converted support"].includes(areaType);
  }
  return true;
}

function normalizePriceStatus(value = "") {
  const text = String(value || "").toLowerCase();

  if (/invalid|failed|broken through|breakout through|breakdown through/.test(text)) return "invalidated";
  if (/moved away|completed|missed/.test(text)) return "moved_away";
  if (/reacted|rejected|held|respected/.test(text)) return "reacted";
  if (/inside|within|at the zone|in the zone/.test(text)) return "inside";
  if (/approach|near/.test(text)) return "approaching";
  if (/not reached|not retested|has not reached|has not retested/.test(text)) return "not_reached";

  return "unclear";
}

function normalizeLevelState(value = "") {
  const text = String(value || "").toLowerCase();

  if (/failed conversion|conversion failed/.test(text)) return "failed_conversion";
  if (/confirmed.*support|confirmed.*resistance|retest.*held|retest.*reject/.test(text)) {
    return "confirmed_conversion";
  }
  if (/potential|not confirmed|unconfirmed|needs a retest|retest from below|retest from above/.test(text)) {
    return "potential_conversion";
  }
  if (/broken support|broken resistance|broke support|broke resistance/.test(text)) {
    return "broken";
  }
  if (/invalid|failed|broken through/.test(text)) return "invalidated";

  return "intact";
}

function extractLastMarketPrice(marketReference) {
  const sourceGroups = [
    marketReference?.timeframeCandles,
    marketReference?.candles,
    marketReference?.dailyLevels,
  ];

  for (const source of sourceGroups) {
    if (!Array.isArray(source) || !source.length) continue;

    const ordered = [...source].sort((a, b) =>
      String(a?.datetime || a?.date || a?.key || "").localeCompare(
        String(b?.datetime || b?.date || b?.key || "")
      )
    );

    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const close = asPositiveNumber(ordered[index]?.close);
      if (close !== null) return close;
    }
  }

  return null;
}

function normalizeZone(preferredArea = {}, symbol = "") {
  let zoneLow = asPositiveNumber(preferredArea?.zoneLow);
  let zoneHigh = asPositiveNumber(preferredArea?.zoneHigh);
  const rawZoneText = String(preferredArea?.zoneText || "").replace(/\s+/g, " ").trim();
  const recovered = extractVisibleZoneRange(rawZoneText);

  if (zoneLow === null && recovered.low !== null) zoneLow = recovered.low;
  if (zoneHigh === null && recovered.high !== null) zoneHigh = recovered.high;

  if (zoneLow !== null && zoneHigh !== null && zoneLow > zoneHigh) {
    [zoneLow, zoneHigh] = [zoneHigh, zoneLow];
  }

  if (zoneLow === 0) zoneLow = null;
  if (zoneHigh === 0) zoneHigh = null;

  let zoneText = "";

  if (zoneLow !== null && zoneHigh !== null) {
    zoneText =
      Math.abs(zoneHigh - zoneLow) > 1e-10
        ? `${formatPrice(zoneLow, symbol)}–${formatPrice(zoneHigh, symbol)}`
        : `${formatPrice(zoneLow, symbol)}`;
  } else if (zoneLow !== null || zoneHigh !== null) {
    zoneText = formatPrice(zoneLow ?? zoneHigh, symbol);
  }

  return { zoneLow, zoneHigh, zoneText };
}

function inferRiskVisibility(visualReview = {}) {
  const riskText = String(visualReview?.riskEvidence || "").toLowerCase();

  const stopShown =
    visualReview?.stopLossVisible === true ||
    visualReview?.stopShown === true ||
    visualReview?.stopLossShown === true ||
    /(?:actual|plotted|marked|visible)\s+stop[- ]?loss|stop[- ]?loss\s+(?:line|level)\s+(?:is\s+)?(?:shown|visible|marked)/i.test(
      riskText
    );

  const targetShown =
    visualReview?.targetVisible === true ||
    visualReview?.targetShown === true ||
    visualReview?.takeProfitShown === true ||
    /(?:actual|plotted|marked|visible)\s+(?:target|take profit)|(?:target|take profit)\s+(?:line|level)\s+(?:is\s+)?(?:shown|visible|marked)/i.test(
      riskText
    );

  return { stopShown, targetShown };
}

function inferConfluence(visualReview = {}) {
  const combined = [
    visualReview?.visualSummary,
    visualReview?.bestAreaToWatch,
    visualReview?.entryEvidence,
    visualReview?.chartLevels,
    visualReview?.convertedLevelAssessment,
    ...(Array.isArray(visualReview?.chartSpecificStrengths)
      ? visualReview.chartSpecificStrengths
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const periodLevel = /earlier period|previous period|daily high|daily low|weekly high|weekly low|monthly high|monthly low|support|resistance/.test(combined);
  const supplyDemand = /supply|demand/.test(combined);
  const convertedLevel = /converted|broken support|broken resistance|former support|former resistance/.test(combined);
  const fibonacci = /fib|38\.2|50(?:\.0)?|61\.8/.test(combined);
  const structure = /higher high|higher low|lower high|lower low|trend|structure|bullish|bearish/.test(combined);

  const count = [periodLevel, supplyDemand, convertedLevel, fibonacci, structure].filter(Boolean).length;

  return {
    periodLevel,
    supplyDemand,
    convertedLevel,
    fibonacci,
    structure,
    count,
    strength: count >= 4 ? "high" : count >= 2 ? "medium" : "low",
  };
}


function priceTouchesZone(price, zoneLow, zoneHigh) {
  const p = asPositiveNumber(price);
  const low = asPositiveNumber(zoneLow);
  const high = asPositiveNumber(zoneHigh);

  if (p === null || low === null || high === null) return false;

  const lower = Math.min(low, high);
  const upper = Math.max(low, high);
  const tolerance = Math.max((upper - lower) * 0.08, upper * 0.00003);

  return p >= lower - tolerance && p <= upper + tolerance;
}

function hasSpecificVisibleTime(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;

  return (
    /\b\d{1,2}:\d{2}\b/.test(text) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(text) ||
    /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i.test(text) ||
    /\b(?:final|last|rightmost)\s+(?:visible\s+)?candle\b/i.test(text)
  );
}


function areaCenter(area = {}) {
  const low = asPositiveNumber(area.zoneLow);
  const high = asPositiveNumber(area.zoneHigh);
  if (low !== null && high !== null) return (low + high) / 2;
  return low ?? high;
}

function getAreaEngineConfig(timeframe = "H1") {
  const tf = comparableTimeframe(timeframe) || "H1";
  const configs = {
    M1:  { pivotLeft: 3, pivotRight: 3, lookback: 260, reactionBars: 8 },
    M5:  { pivotLeft: 3, pivotRight: 3, lookback: 230, reactionBars: 8 },
    M15: { pivotLeft: 3, pivotRight: 3, lookback: 200, reactionBars: 7 },
    M30: { pivotLeft: 3, pivotRight: 3, lookback: 180, reactionBars: 7 },
    H1:  { pivotLeft: 3, pivotRight: 3, lookback: 160, reactionBars: 6 },
    H4:  { pivotLeft: 2, pivotRight: 2, lookback: 120, reactionBars: 5 },
    D1:  { pivotLeft: 2, pivotRight: 2, lookback: 100, reactionBars: 4 },
    W1:  { pivotLeft: 1, pivotRight: 1, lookback: 80, reactionBars: 3 },
    MN:  { pivotLeft: 1, pivotRight: 1, lookback: 60, reactionBars: 2 },
  };
  return { timeframe: tf, ...(configs[tf] || configs.H1) };
}

function buildLatestImpulseFibonacci({
  candles = [],
  historicalPhase = null,
  direction = "range",
  timeframe = "H1",
  symbol = "",
  chartNativeImpulse = null,
  suppressImpulseLog = false,
}) {
  if (!Array.isArray(candles) || candles.length < 10) {
    return null;
  }

  if (!["bullish", "bearish"].includes(direction)) {
    return null;
  }

  const ordered = candles
    .filter(
      (candle) =>
        candle?.datetime &&
        Number.isFinite(Number(candle?.open)) &&
        Number.isFinite(Number(candle?.high)) &&
        Number.isFinite(Number(candle?.low)) &&
        Number.isFinite(Number(candle?.close))
    )
    .sort((a, b) =>
      String(a.datetime).localeCompare(String(b.datetime))
    );

  if (ordered.length < 10) return null;

  const structureConfig =
    getStructureEngineConfig(timeframe);

  const areaConfig =
    getAreaEngineConfig(timeframe);

  const atr = averageTrueRange(
    ordered,
    structureConfig.atrPeriod
  );

  const breakTolerance = Math.max(
    getCleanBreakTolerance(symbol),
    Number(atr || 0) * 0.12
  );

  const pivots = detectConfirmedSwingPivots(
    ordered,
    structureConfig
  );

  const searchStart = Math.max(
    1,
    ordered.length -
      Number(
        structureConfig.eventLookback ||
        areaConfig.lookback ||
        160
      )
  );

  const events = buildOrderedStructureEvents({
    candles: ordered,
    pivots,
    tolerance: breakTolerance,
    atr,
    timeframe: structureConfig.timeframe,
    confirmationCloses:
      structureConfig.confirmationCloses,
    searchStart,
  });

  const expectedSide =
    direction === "bullish"
      ? "bullish"
      : "bearish";

  const oppositeSide =
    direction === "bullish"
      ? "bearish"
      : "bullish";

  const expectedBrokenPivotType =
    direction === "bullish"
      ? "resistance"
      : "support";

  const expectedProtectedPivotType =
    direction === "bullish"
      ? "support"
      : "resistance";

  const extremaIndex = ({
    startIndex = 0,
    endIndex = ordered.length - 1,
    field = "high",
    mode = "max",
  }) => {
    let selectedIndex = -1;
    let selectedValue =
      mode === "min"
        ? Number.POSITIVE_INFINITY
        : Number.NEGATIVE_INFINITY;

    const start = Math.max(
      0,
      Number(startIndex || 0)
    );

    const end = Math.min(
      ordered.length - 1,
      Number.isFinite(Number(endIndex))
        ? Number(endIndex)
        : ordered.length - 1
    );

    for (
      let index = start;
      index <= end;
      index += 1
    ) {
      const value =
        Number(ordered[index]?.[field]);

      if (!Number.isFinite(value)) continue;

      if (
        (mode === "min" &&
          value < selectedValue) ||
        (mode === "max" &&
          value > selectedValue)
      ) {
        selectedValue = value;
        selectedIndex = index;
      }
    }

    return {
      index: selectedIndex,
      value:
        selectedIndex >= 0 &&
        Number.isFinite(selectedValue)
          ? selectedValue
          : null,
    };
  };

  const latestDirectionalEvent =
    [...events]
      .reverse()
      .find(
        (event) =>
          event.side === expectedSide
      ) || null;

  const latestOppositeEventBeforeCurrent =
    latestDirectionalEvent
      ? [...events]
          .reverse()
          .find(
            (event) =>
              event.side === oppositeSide &&
              Number(event.index) <
                Number(
                  latestDirectionalEvent.index
                )
          ) || null
      : null;

  // ==============================================================
  // V3.8 MAJOR-BREAK SIGNIFICANCE MODEL
  //
  // Goal:
  // Do NOT assume the latest broken pivot is the major level.
  // Instead, identify prior confirmed swing highs/lows that the current
  // directional expansion actually broke, score them for structural
  // significance, and then use the protected swing associated with the
  // highest-quality major break.
  //
  // Bullish:
  //   major broken resistance -> protected swing low -> final high
  //
  // Bearish:
  //   major broken support -> protected swing high -> final low
  // ==============================================================

  const currentPrice =
    Number(
      ordered[
        ordered.length - 1
      ]?.close
    );

  const finalExtreme =
    direction === "bullish"
      ? extremaIndex({
          startIndex:
            Math.max(
              0,
              ordered.length -
                Number(
                  areaConfig.lookback ||
                  structureConfig.eventLookback ||
                  160
                )
            ),
          endIndex:
            ordered.length - 1,
          field: "high",
          mode: "max",
        })
      : extremaIndex({
          startIndex:
            Math.max(
              0,
              ordered.length -
                Number(
                  areaConfig.lookback ||
                  structureConfig.eventLookback ||
                  160
                )
            ),
          endIndex:
            ordered.length - 1,
          field: "low",
          mode: "min",
        });

  const finalExtremePrice =
    Number(finalExtreme?.value);

  const finalExtremeIndex =
    Number(finalExtreme?.index);

  // Structural hierarchy needs a much broader window than ordinary
  // entry-area detection. A major resistance/support may have formed many
  // sessions before the final breakout while several nested local pivots form
  // inside the range afterward.
  const candidateLookbackBars =
    Math.min(
      ordered.length,
      Math.max(
        Math.ceil(
          Number(
            areaConfig.lookback ||
            structureConfig.eventLookback ||
            160
          ) * 2.2
        ),
        Math.ceil(
          Number(
            structureConfig.eventLookback ||
            140
          ) * 2.6
        ),
        Math.ceil(
          Number(
            structureConfig.recoveryBars ||
            18
          ) * 12
        )
      )
    );

  const candidateStartIndex =
    Math.max(
      0,
      ordered.length -
        candidateLookbackBars
    );

  // buildOrderedStructureEvents() intentionally tracks the latest ACTIVE
  // support/resistance. That is correct for directional phase, but it can miss
  // the later break of an older outer structural pivot after newer nested
  // pivots have formed. Major-break selection therefore scans EACH candidate
  // pivot independently for its first confirmed break.
  const findFirstIndependentPivotBreak = ({
    pivot,
  }) => {
    const pivotIndex =
      Number(pivot?.pivotIndex);

    const confirmedAtIndex =
      Number(pivot?.confirmedAtIndex);

    const pivotPrice =
      Number(pivot?.price);

    if (
      !Number.isFinite(pivotIndex) ||
      !Number.isFinite(confirmedAtIndex) ||
      !Number.isFinite(pivotPrice)
    ) {
      return null;
    }

    const scanStart =
      Math.max(
        confirmedAtIndex + 1,
        pivotIndex + 1
      );

    const scanEnd =
      Math.min(
        ordered.length - 1,
        finalExtremeIndex
      );

    for (
      let index = scanStart;
      index <= scanEnd;
      index += 1
    ) {
      const standardConfirmed =
        countConsecutiveBreakCloses({
          candles: ordered,
          index,
          level: pivotPrice,
          tolerance:
            breakTolerance,
          side:
            expectedSide,
          count:
            structureConfig.confirmationCloses,
        });

      const displacementConfirmed =
        isStrongDisplacementBreak({
          candles: ordered,
          index,
          level: pivotPrice,
          tolerance:
            breakTolerance,
          atr,
          side:
            expectedSide,
          timeframe:
            structureConfig.timeframe,
        });

      if (
        standardConfirmed ||
        displacementConfirmed
      ) {
        return {
          side:
            expectedSide,
          index,
          datetime:
            ordered[index]?.datetime ||
            null,
          level:
            pivotPrice,
          pivotIndex,
          pivotDatetime:
            pivot?.datetime ||
            ordered[pivotIndex]?.datetime ||
            null,
          close:
            Number(
              ordered[index]?.close
            ),
          high:
            Number(
              ordered[index]?.high
            ),
          low:
            Number(
              ordered[index]?.low
            ),
          confirmationPath:
            displacementConfirmed
              ? "strong_displacement"
              : "multiple_closes",
          breakScanSource:
            "independent_per_pivot",
        };
      }
    }

    return null;
  };

  const priorMajorPivots =
    pivots
      .filter(
        (pivot) =>
          pivot.type ===
            expectedBrokenPivotType &&
          Number(pivot.pivotIndex) >=
            candidateStartIndex &&
          Number(pivot.pivotIndex) <
            finalExtremeIndex
      )
      .map((pivot) => {
        const pivotIndex =
          Number(pivot.pivotIndex);

        const pivotPrice =
          Number(pivot.price);

        const confirmedAtIndex =
          Number(
            pivot.confirmedAtIndex
          );

        if (
          !Number.isFinite(pivotIndex) ||
          !Number.isFinite(pivotPrice) ||
          !Number.isFinite(
            confirmedAtIndex
          )
        ) {
          return null;
        }

        // Identify the FIRST clean break of THIS pivot independently.
        // Do not rely on the active-pivot event list here, because a newer
        // nested pivot can become "active" while the older outer structural
        // level is still intact and waiting to be broken.
        const breakEvent =
          findFirstIndependentPivotBreak({
            pivot,
          });

        if (!breakEvent) {
          return null;
        }

        const breakIndex =
          Number(breakEvent.index);

        if (
          !Number.isFinite(breakIndex) ||
          breakIndex <= pivotIndex ||
          breakIndex >
            finalExtremeIndex
        ) {
          return null;
        }

        // Protected swing must form after the major pivot and before its
        // breakout. Prefer confirmed opposite pivots. Only use a raw
        // interval extreme if no confirmed protected pivot exists.
        const protectedPivots =
          pivots.filter(
            (candidate) =>
              candidate.type ===
                expectedProtectedPivotType &&
              Number(
                candidate.pivotIndex
              ) >
                pivotIndex &&
              Number(
                candidate.confirmedAtIndex
              ) <
                breakIndex
          );

        let protectedPivot =
          null;

        let protectedPrice =
          null;

        let protectedIndex =
          null;

        let protectedSource =
          "confirmed_pivot";

        if (
          protectedPivots.length
        ) {
          protectedPivot =
            [...protectedPivots].sort(
              (a, b) =>
                direction === "bullish"
                  ? Number(a.price) -
                    Number(b.price)
                  : Number(b.price) -
                    Number(a.price)
            )[0] || null;

          protectedPrice =
            Number(
              protectedPivot?.price
            );

          protectedIndex =
            Number(
              protectedPivot?.pivotIndex
            );
        }

        if (
          !Number.isFinite(
            protectedPrice
          ) ||
          !Number.isFinite(
            protectedIndex
          )
        ) {
          const fallback =
            direction === "bullish"
              ? extremaIndex({
                  startIndex:
                    pivotIndex + 1,
                  endIndex:
                    breakIndex - 1,
                  field: "low",
                  mode: "min",
                })
              : extremaIndex({
                  startIndex:
                    pivotIndex + 1,
                  endIndex:
                    breakIndex - 1,
                  field: "high",
                  mode: "max",
                });

          protectedPrice =
            Number(fallback?.value);

          protectedIndex =
            Number(fallback?.index);

          protectedSource =
            "raw_extreme_fallback";
        }

        if (
          !Number.isFinite(
            protectedPrice
          ) ||
          !Number.isFinite(
            protectedIndex
          ) ||
          protectedIndex <=
            pivotIndex ||
          protectedIndex >=
            breakIndex
        ) {
          return null;
        }

        // ------------------------------------------------------------
        // STRUCTURAL SIGNIFICANCE FEATURES
        // ------------------------------------------------------------

        const excursion =
          direction === "bullish"
            ? pivotPrice -
              protectedPrice
            : protectedPrice -
              pivotPrice;

        const excursionAtr =
          Number(atr || 0) > 0
            ? excursion /
              Number(atr)
            : excursion;

        // 1) Age / persistence:
        // How long this level remained structurally relevant before breaking.
        const barsUntilBreak =
          breakIndex -
          pivotIndex;

        const ageScore =
          Math.min(
            34,
            Math.max(
              0,
              barsUntilBreak
            ) * 0.22
          );

        // 2) Prominence:
        // Compare the pivot with neighboring confirmed same-side pivots.
        const neighborWindow =
          Math.max(
            12,
            Math.ceil(
              Number(
                structureConfig.swingWindow ||
                4
              ) * 8
            )
          );

        const nearbySameSide =
          pivots.filter(
            (other) =>
              other !== pivot &&
              other.type ===
                expectedBrokenPivotType &&
              Math.abs(
                Number(
                  other.pivotIndex
                ) -
                  pivotIndex
              ) <=
                neighborWindow
          );

        let prominence =
          0;

        if (nearbySameSide.length) {
          const neighborReference =
            direction === "bullish"
              ? Math.max(
                  ...nearbySameSide.map(
                    (item) =>
                      Number(item.price)
                  )
                )
              : Math.min(
                  ...nearbySameSide.map(
                    (item) =>
                      Number(item.price)
                  )
                );

          prominence =
            direction === "bullish"
              ? pivotPrice -
                neighborReference
              : neighborReference -
                pivotPrice;
        }

        const prominenceAtr =
          Number(atr || 0) > 0
            ? prominence /
              Number(atr)
            : prominence;

        const prominenceScore =
          Math.max(
            0,
            prominenceAtr
          ) * 12;

        // 3) Reaction history:
        // Count substantial approaches/rejections around the pivot BEFORE
        // breakout. Multiple reactions imply the market treated the level
        // as important.
        const reactionTolerance =
          Math.max(
            breakTolerance * 1.5,
            Number(atr || 0) * 0.18
          );

        let reactionCount = 0;
        let lastReactionIndex =
          -99999;

        for (
          let index =
            Math.max(
              pivotIndex + 1,
              candidateStartIndex
            );
          index <
            breakIndex;
          index += 1
        ) {
          const candle =
            ordered[index];

          const touched =
            direction === "bullish"
              ? Math.abs(
                  Number(
                    candle?.high
                  ) -
                    pivotPrice
                ) <=
                reactionTolerance
              : Math.abs(
                  Number(
                    candle?.low
                  ) -
                    pivotPrice
                ) <=
                reactionTolerance;

          if (
            touched &&
            index -
              lastReactionIndex >=
              Math.max(
                3,
                Number(
                  structureConfig.swingWindow ||
                  4
                )
              )
          ) {
            reactionCount += 1;
            lastReactionIndex =
              index;
          }
        }

        const reactionScore =
          Math.min(
            28,
            reactionCount * 7
          );

        // 4) Time spent on the original side of the major level:
        // A major resistance is more meaningful if price spent a substantial
        // period beneath it before breaking; vice versa for bearish support.
        let originalSideCount =
          0;

        const originalSideStart =
          Math.max(
            pivotIndex + 1,
            candidateStartIndex
          );

        const originalSideBars =
          Math.max(
            1,
            breakIndex -
              originalSideStart
          );

        for (
          let index =
            originalSideStart;
          index <
            breakIndex;
          index += 1
        ) {
          const close =
            Number(
              ordered[index]?.close
            );

          if (
            direction === "bullish"
              ? close <
                pivotPrice -
                  breakTolerance
              : close >
                pivotPrice +
                  breakTolerance
          ) {
            originalSideCount += 1;
          }
        }

        const originalSideRatio =
          originalSideCount /
          originalSideBars;

        const originalSideScore =
          Math.max(
            0,
            Math.min(
              18,
              originalSideRatio *
                18
            )
          );

        // 5) Structural excursion:
        // Bigger opposing excursion after the pivot and before the breakout
        // implies a more significant pivot.
        const excursionScore =
          Math.max(
            0,
            excursionAtr
          ) * 10;

        // 6) Break quality:
        const displacementBonus =
          String(
            breakEvent
              ?.confirmationPath ||
              ""
          ) ===
          "strong_displacement"
            ? 7
            : 0;

        // 7) Confirmed protected swing:
        const confirmedProtectedBonus =
          protectedSource ===
          "confirmed_pivot"
            ? 10
            : 0;

        // 8) Separation from final extreme:
        // We want the major broken level to be materially below the final
        // bullish high / above the final bearish low, otherwise it is merely
        // a small local level near the endpoint.
        const terminalSeparation =
          direction === "bullish"
            ? finalExtremePrice -
              pivotPrice
            : pivotPrice -
              finalExtremePrice;

        const terminalSeparationAtr =
          Number(atr || 0) > 0
            ? terminalSeparation /
              Number(atr)
            : terminalSeparation;

        const terminalSeparationScore =
          Math.min(
            24,
            Math.max(
              0,
              terminalSeparationAtr
            ) * 4
          );

        // 9) Very-local-pivot penalty:
        // Explicitly penalize pivots that formed only shortly before the
        // breakout. This is what stops a recent 4105-type local level from
        // outranking an older structurally important July swing high.
        const veryLocalPenalty =
          barsUntilBreak <
          Math.max(
            8,
            Math.ceil(
              Number(
                structureConfig.recoveryBars ||
                18
              ) * 0.7
            )
          )
            ? 24
            : barsUntilBreak <
              Math.max(
                14,
                Number(
                  structureConfig.recoveryBars ||
                  18
                )
              )
            ? 12
            : 0;

        // 10) Raw-fallback penalty:
        const rawFallbackPenalty =
          protectedSource ===
          "raw_extreme_fallback"
            ? 12
            : 0;

        const significanceScore =
          ageScore +
          prominenceScore +
          reactionScore +
          originalSideScore +
          excursionScore +
          displacementBonus +
          confirmedProtectedBonus +
          terminalSeparationScore -
          veryLocalPenalty -
          rawFallbackPenalty;

        return {
          pivot,
          pivotIndex,
          pivotPrice,
          pivotDatetime:
            pivot?.datetime ||
            ordered[
              pivotIndex
            ]?.datetime ||
            null,
          breakEvent,
          breakIndex,
          breakoutDatetime:
            breakEvent?.datetime ||
            ordered[
              breakIndex
            ]?.datetime ||
            null,
          protectedPivot,
          protectedPrice,
          protectedIndex,
          protectedDatetime:
            protectedPivot?.datetime ||
            ordered[
              protectedIndex
            ]?.datetime ||
            null,
          protectedSource,
          excursion,
          excursionAtr,
          barsUntilBreak,
          prominence,
          prominenceAtr,
          reactionCount,
          originalSideRatio,
          terminalSeparation,
          terminalSeparationAtr,
          displacementBonus,
          confirmedProtectedBonus,
          veryLocalPenalty,
          rawFallbackPenalty,
          significanceScore,
        };
      })
      .filter(Boolean)
      .filter(
        (candidate) =>
          Number.isFinite(
            Number(
              candidate.excursion
            )
          ) &&
          Number(
            candidate.excursion
          ) >
            Math.max(
              Number(atr || 0) *
                0.35,
              breakTolerance
            ) &&
          Number(
            candidate.terminalSeparation
          ) >
            Math.max(
              Number(atr || 0) *
                0.45,
              breakTolerance
            )
      );

  // ------------------------------------------------------------
  // STRUCTURAL HIERARCHY ENRICHMENT
  //
  // Among valid broken pivots, bullish structure should prefer the OUTER /
  // higher resistance that capped price, while bearish structure should
  // prefer the OUTER / lower support. We also reward levels broken later in
  // the terminal expansion and penalize deeply nested local levels.
  // ------------------------------------------------------------

  const candidatePrices =
    priorMajorPivots
      .map(
        (candidate) =>
          Number(
            candidate.pivotPrice
          )
      )
      .filter(Number.isFinite);

  const candidateBreakIndices =
    priorMajorPivots
      .map(
        (candidate) =>
          Number(
            candidate.breakIndex
          )
      )
      .filter(Number.isFinite);

  const outermostPivotPrice =
    candidatePrices.length
      ? direction === "bullish"
        ? Math.max(
            ...candidatePrices
          )
        : Math.min(
            ...candidatePrices
          )
      : null;

  const innermostPivotPrice =
    candidatePrices.length
      ? direction === "bullish"
        ? Math.min(
            ...candidatePrices
          )
        : Math.max(
            ...candidatePrices
          )
      : null;

  const hierarchyPriceSpan =
    Number.isFinite(
      Number(outermostPivotPrice)
    ) &&
    Number.isFinite(
      Number(innermostPivotPrice)
    )
      ? Math.abs(
          Number(
            outermostPivotPrice
          ) -
          Number(
            innermostPivotPrice
          )
        )
      : 0;

  const earliestCandidateBreak =
    candidateBreakIndices.length
      ? Math.min(
          ...candidateBreakIndices
        )
      : null;

  const latestCandidateBreak =
    candidateBreakIndices.length
      ? Math.max(
          ...candidateBreakIndices
        )
      : null;

  const breakIndexSpan =
    Number.isFinite(
      Number(
        earliestCandidateBreak
      )
    ) &&
    Number.isFinite(
      Number(
        latestCandidateBreak
      )
    )
      ? Math.max(
          1,
          Number(
            latestCandidateBreak
          ) -
          Number(
            earliestCandidateBreak
          )
        )
      : 1;

  const hierarchyRankedPivots =
    priorMajorPivots.map(
      (candidate) => {
        const pivotPrice =
          Number(
            candidate.pivotPrice
          );

        const breakIndex =
          Number(
            candidate.breakIndex
          );

        // 1.0 means the outer structural ceiling/floor among candidates.
        const hierarchyPosition =
          hierarchyPriceSpan >
            0
            ? direction ===
              "bullish"
              ? (
                  pivotPrice -
                  Number(
                    innermostPivotPrice
                  )
                ) /
                hierarchyPriceSpan
              : (
                  Number(
                    innermostPivotPrice
                  ) -
                  pivotPrice
                ) /
                hierarchyPriceSpan
            : 1;

        const hierarchyScore =
          Math.max(
            0,
            Math.min(
              1,
              hierarchyPosition
            )
          ) * 48;

        // Levels broken later in the current terminal expansion are more
        // likely to be the outer barrier; lower nested levels tend to break
        // earlier as price climbs/falls toward the true major level.
        const lateBreakPosition =
          Number.isFinite(
            Number(
              earliestCandidateBreak
            )
          ) &&
          Number.isFinite(
            breakIndex
          )
            ? (
                breakIndex -
                Number(
                  earliestCandidateBreak
                )
              ) /
              breakIndexSpan
            : 0;

        const lateBreakScore =
          Math.max(
            0,
            Math.min(
              1,
              lateBreakPosition
            )
          ) * 26;

        const barsFromBreakToTerminal =
          Number.isFinite(
            finalExtremeIndex
          ) &&
          Number.isFinite(
            breakIndex
          )
            ? Math.max(
                0,
                finalExtremeIndex -
                breakIndex
              )
            : null;

        const terminalBreakScore =
          barsFromBreakToTerminal ===
          null
            ? 0
            : Math.max(
                0,
                20 -
                  barsFromBreakToTerminal *
                    0.35
              );

        const nestedDepth =
          Number.isFinite(
            Number(
              outermostPivotPrice
            )
          )
            ? direction ===
              "bullish"
              ? Number(
                  outermostPivotPrice
                ) -
                pivotPrice
              : pivotPrice -
                Number(
                  outermostPivotPrice
                )
            : 0;

        const nestedDepthAtr =
          Number(atr || 0) >
            0
            ? nestedDepth /
              Number(atr)
            : nestedDepth;

        const nestedLevelPenalty =
          Math.min(
            38,
            Math.max(
              0,
              nestedDepthAtr
            ) * 5.5
          );

        // If a candidate is close to the outermost structural pivot, avoid
        // over-penalizing small broker/feed differences between nearby highs.
        const nearOutermost =
          Math.abs(
            nestedDepth
          ) <=
          Math.max(
            Number(atr || 0) *
              0.35,
            breakTolerance * 2
          );

        const effectiveNestedPenalty =
          nearOutermost
            ? 0
            : nestedLevelPenalty;

        const hierarchyAdjustedScore =
          Number(
            candidate.significanceScore ||
            0
          ) +
          hierarchyScore +
          lateBreakScore +
          terminalBreakScore -
          effectiveNestedPenalty;

        return {
          ...candidate,
          hierarchyPosition,
          hierarchyScore,
          lateBreakPosition,
          lateBreakScore,
          barsFromBreakToTerminal,
          terminalBreakScore,
          nestedDepth,
          nestedDepthAtr,
          nestedLevelPenalty:
            effectiveNestedPenalty,
          hierarchyAdjustedScore,
          outermostPivotPrice:
            Number.isFinite(
              Number(
                outermostPivotPrice
              )
            )
              ? Number(
                  outermostPivotPrice
                )
              : null,
        };
      }
    );

  // "Major" candidates must clear a quality floor, then are ranked by the
  // hierarchy-adjusted score rather than the v3.8 base significance alone.
  const majorBreakCandidates =
    hierarchyRankedPivots
      .filter(
        (candidate) =>
          Number(
            candidate.significanceScore
          ) >= 18 &&
          Number(
            candidate.hierarchyAdjustedScore
          ) >= 34
      )
      .sort((a, b) => {
        const adjustedDifference =
          Number(
            b.hierarchyAdjustedScore
          ) -
          Number(
            a.hierarchyAdjustedScore
          );

        if (
          Math.abs(
            adjustedDifference
          ) > 3
        ) {
          return adjustedDifference;
        }

        // When hierarchy-adjusted scores are close, explicitly prefer the
        // outer structural ceiling/floor before considering recency.
        if (
          Number(
            b.hierarchyPosition
          ) !==
          Number(
            a.hierarchyPosition
          )
        ) {
          return (
            Number(
              b.hierarchyPosition
            ) -
            Number(
              a.hierarchyPosition
            )
          );
        }

        if (
          Number(
            b.breakIndex
          ) !==
          Number(
            a.breakIndex
          )
        ) {
          return (
            Number(
              b.breakIndex
            ) -
            Number(
              a.breakIndex
            )
          );
        }

        // Final tie-break toward the older pivot.
        return (
          Number(
            a.pivotIndex
          ) -
          Number(
            b.pivotIndex
          )
        );
      });

  const majorSelection =
    majorBreakCandidates[0] ||
    null;

  // ==============================================================
  // V4.5 OUTER STRUCTURAL IMPULSE ORIGIN
  //
  // The protected swing that forms AFTER a major resistance/support
  // pivot is useful for lifecycle analysis, but it is not always the
  // correct Fibonacci origin.
  //
  // Example in a bullish structure:
  //   outer swing low -> major resistance forms -> range/retests ->
  //   major resistance eventually breaks -> final high
  //
  // If we use only the later internal higher low after the resistance
  // formed, the Fib grid becomes too shallow. V4.5 therefore searches
  // BEFORE the major broken pivot for the intact outer swing that
  // launched the move into that pivot.
  //
  // The search is bounded by the most recent opposite structural event
  // before the major pivot so we do not blindly select an unrelated,
  // much older chart extreme.
  // ==============================================================

  const findOuterStructuralOrigin = ({
    selection,
  }) => {
    if (!selection) {
      return null;
    }

    const pivotIndex =
      Number(
        selection.pivotIndex
      );

    const breakIndex =
      Number(
        selection.breakIndex
      );

    const localProtectedIndex =
      Number(
        selection.protectedIndex
      );

    const localProtectedPrice =
      Number(
        selection.protectedPrice
      );

    if (
      !Number.isFinite(pivotIndex) ||
      !Number.isFinite(breakIndex) ||
      !Number.isFinite(
        localProtectedPrice
      ) ||
      pivotIndex <= 0 ||
      breakIndex <= pivotIndex
    ) {
      return null;
    }

    const priorOppositeEvent =
      [...events]
        .reverse()
        .find(
          (event) =>
            event.side ===
              oppositeSide &&
            Number(
              event.index
            ) <
              pivotIndex
        ) ||
      null;

    const fallbackOriginLookback =
      Math.max(
        Number(
          structureConfig
            .recoveryBars ||
            18
        ) * 6,
        Math.ceil(
          Number(
            structureConfig
              .eventLookback ||
              areaConfig.lookback ||
              160
          ) * 0.75
        )
      );

    const originSearchStart =
      Math.max(
        candidateStartIndex,
        priorOppositeEvent
          ? Math.max(
              0,
              Number(
                priorOppositeEvent
                  .index
              )
            )
          : Math.max(
              0,
              pivotIndex -
                fallbackOriginLookback
            )
      );

    // CRITICAL V4.5 RULE:
    // The outer origin must already exist when the major broken barrier
    // forms. Therefore the search ends at the major pivot, not at the
    // eventual breakout. This prevents a later internal higher low /
    // lower high from replacing the true outer impulse origin.
    const originSearchEnd =
      Math.max(
        originSearchStart,
        pivotIndex
      );

    const rawOrigin =
      direction === "bullish"
        ? extremaIndex({
            startIndex:
              originSearchStart,
            endIndex:
              originSearchEnd,
            field: "low",
            mode: "min",
          })
        : extremaIndex({
            startIndex:
              originSearchStart,
            endIndex:
              originSearchEnd,
            field: "high",
            mode: "max",
          });

    const rawOriginIndex =
      Number(
        rawOrigin?.index
      );

    const rawOriginPrice =
      Number(
        rawOrigin?.value
      );

    const confirmedOriginPivots =
      pivots
        .filter(
          (pivot) =>
            pivot.type ===
              expectedProtectedPivotType &&
            Number(
              pivot.pivotIndex
            ) >=
              originSearchStart &&
            Number(
              pivot.pivotIndex
            ) <=
              originSearchEnd
        )
        .sort(
          (a, b) =>
            direction ===
            "bullish"
              ? Number(a.price) -
                Number(b.price)
              : Number(b.price) -
                Number(a.price)
        );

    const confirmedOriginPivot =
      confirmedOriginPivots[0] ||
      null;

    const confirmedOriginPrice =
      asPositiveNumber(
        confirmedOriginPivot
          ?.price
      );

    const confirmedOriginIndex =
      Number.isFinite(
        Number(
          confirmedOriginPivot
            ?.pivotIndex
        )
      )
        ? Number(
            confirmedOriginPivot
              .pivotIndex
          )
        : null;

    // Prefer the actual wick extreme when it is consistent with the
    // structural search window. Fibonacci swing anchors are extremes,
    // while confirmed pivots remain useful validation evidence.
    let selectedOriginPrice =
      Number.isFinite(
        rawOriginPrice
      )
        ? rawOriginPrice
        : confirmedOriginPrice;

    let selectedOriginIndex =
      Number.isFinite(
        rawOriginIndex
      )
        ? rawOriginIndex
        : confirmedOriginIndex;

    let selectedOriginSource =
      Number.isFinite(
        rawOriginPrice
      )
        ? "outer_raw_extreme_pre_major_pivot"
        : confirmedOriginPrice !==
          null
        ? "outer_confirmed_pivot_pre_major_pivot"
        : null;

    if (
      !Number.isFinite(
        selectedOriginPrice
      ) ||
      !Number.isFinite(
        selectedOriginIndex
      )
    ) {
      return null;
    }

    // The candidate must be meaningfully more "outer" than the later
    // local protected swing. Tiny differences are broker/feed noise and
    // should not alter the Fib grid.
    const minimumOuterExtension =
      Math.max(
        Number(atr || 0) *
          0.18,
        breakTolerance *
          1.25
      );

    const outerExtension =
      direction === "bullish"
        ? localProtectedPrice -
          selectedOriginPrice
        : selectedOriginPrice -
          localProtectedPrice;

    const meaningfullyOuter =
      outerExtension >=
      minimumOuterExtension;

    if (!meaningfullyOuter) {
      return null;
    }

    // The outer swing must remain structurally intact from the time it
    // forms through the major breakout. Use closes for invalidation so a
    // small wick through the level does not automatically destroy the
    // structural origin.
    const invalidationTolerance =
      Math.max(
        breakTolerance *
          1.25,
        Number(atr || 0) *
          0.10
      );

    let invalidated =
      false;

    let invalidatedAt =
      null;

    for (
      let index =
        selectedOriginIndex + 1;
      index <=
        Math.min(
          breakIndex,
          ordered.length - 1
        );
      index += 1
    ) {
      const close =
        Number(
          ordered[index]?.close
        );

      if (
        !Number.isFinite(close)
      ) {
        continue;
      }

      const brokeOrigin =
        direction === "bullish"
          ? close <
            selectedOriginPrice -
              invalidationTolerance
          : close >
            selectedOriginPrice +
              invalidationTolerance;

      if (brokeOrigin) {
        invalidated = true;
        invalidatedAt =
          ordered[index]
            ?.datetime ||
          null;
        break;
      }
    }

    if (invalidated) {
      return null;
    }

    // Ensure the selected origin genuinely participates in the leg that
    // formed the major barrier. This avoids using an old extreme that has
    // no practical relationship with the controlling structure.
    const barsFromOriginToPivot =
      pivotIndex -
      selectedOriginIndex;

    const minimumStructureSpan =
      Math.max(
        2,
        Number(
          structureConfig
            .swingWindow ||
            4
        )
      );

    if (
      barsFromOriginToPivot <
      minimumStructureSpan
    ) {
      return null;
    }

    const majorPivotPrice =
      Number(
        selection.pivotPrice
      );

    const originToMajorRange =
      direction === "bullish"
        ? majorPivotPrice -
          selectedOriginPrice
        : selectedOriginPrice -
          majorPivotPrice;

    if (
      !Number.isFinite(
        originToMajorRange
      ) ||
      originToMajorRange <=
        Math.max(
          Number(atr || 0) *
            0.75,
          breakTolerance * 3
        )
    ) {
      return null;
    }

    return {
      type:
        direction === "bullish"
          ? "outer_structural_low"
          : "outer_structural_high",
      price:
        selectedOriginPrice,
      index:
        selectedOriginIndex,
      datetime:
        ordered[
          selectedOriginIndex
        ]?.datetime ||
        null,
      source:
        selectedOriginSource,
      confirmedPivotPrice:
        confirmedOriginPrice,
      confirmedPivotIndex:
        confirmedOriginIndex,
      confirmedPivotDatetime:
        confirmedOriginPivot
          ?.datetime ||
        null,
      priorOppositeEvent:
        priorOppositeEvent
          ? {
              side:
                priorOppositeEvent
                  .side,
              index:
                Number(
                  priorOppositeEvent
                    .index
                ),
              datetime:
                priorOppositeEvent
                  .datetime ||
                null,
              level:
                Number(
                  priorOppositeEvent
                    .level
                ),
            }
          : null,
      searchStartIndex:
        originSearchStart,
      searchEndIndex:
        originSearchEnd,
      localProtectedPrice:
        localProtectedPrice,
      localProtectedIndex:
        Number.isFinite(
          localProtectedIndex
        )
          ? localProtectedIndex
          : null,
      outerExtension:
        outerExtension,
      minimumOuterExtension:
        minimumOuterExtension,
      invalidationTolerance:
        invalidationTolerance,
      barsFromOriginToPivot:
        barsFromOriginToPivot,
      originToMajorRange:
        originToMajorRange,
      structurallyIntact:
        true,
    };
  };

  const outerStructuralOrigin =
    findOuterStructuralOrigin({
      selection:
        majorSelection,
    });

  let controllingEvent =
    majorSelection?.breakEvent ||
    latestDirectionalEvent ||
    null;

  let selectionReason =
    majorSelection
      ? direction === "bullish"
        ? "major_broken_resistance_with_protected_swing_low"
        : "major_broken_support_with_protected_swing_high"
      : "major_break_unavailable_fallback";

  let swingLowResult =
    null;

  let swingHighResult =
    null;

  if (majorSelection) {
    if (
      direction ===
      "bullish"
    ) {
      swingLowResult =
        outerStructuralOrigin
          ? {
              index:
                outerStructuralOrigin
                  .index,
              value:
                outerStructuralOrigin
                  .price,
            }
          : {
              index:
                majorSelection
                  .protectedIndex,
              value:
                majorSelection
                  .protectedPrice,
            };

      swingHighResult =
        extremaIndex({
          startIndex:
            majorSelection
              .breakIndex,
          endIndex:
            ordered.length - 1,
          field: "high",
          mode: "max",
        });

      if (
        outerStructuralOrigin
      ) {
        selectionReason =
          "major_broken_resistance_with_outer_structural_swing_low";
      }
    } else {
      swingHighResult =
        outerStructuralOrigin
          ? {
              index:
                outerStructuralOrigin
                  .index,
              value:
                outerStructuralOrigin
                  .price,
            }
          : {
              index:
                majorSelection
                  .protectedIndex,
              value:
                majorSelection
                  .protectedPrice,
            };

      swingLowResult =
        extremaIndex({
          startIndex:
            majorSelection
              .breakIndex,
          endIndex:
            ordered.length - 1,
          field: "low",
          mode: "min",
        });

      if (
        outerStructuralOrigin
      ) {
        selectionReason =
          "major_broken_support_with_outer_structural_swing_high";
      }
    }
  } else if (
    latestDirectionalEvent
  ) {
    // Fallback is deliberately BROADER than v3.7's local-protected-swing
    // behavior. If no major pivot passes significance, search broadly around
    // the current directional sequence instead of anchoring to a late local
    // higher low/lower high.
    const fallbackStart =
      Math.max(
        0,
        Number(
          latestDirectionalEvent
            .index
        ) -
          candidateLookbackBars
      );

    if (
      direction ===
      "bullish"
    ) {
      swingLowResult =
        extremaIndex({
          startIndex:
            fallbackStart,
          endIndex:
            Number(
              latestDirectionalEvent
                .index
            ),
          field: "low",
          mode: "min",
        });

      swingHighResult =
        extremaIndex({
          startIndex:
            Number(
              latestDirectionalEvent
                .index
            ),
          endIndex:
            ordered.length - 1,
          field: "high",
          mode: "max",
        });

      selectionReason =
        "major_break_unavailable_broad_bullish_fallback";
    } else {
      swingHighResult =
        extremaIndex({
          startIndex:
            fallbackStart,
          endIndex:
            Number(
              latestDirectionalEvent
                .index
            ),
          field: "high",
          mode: "max",
        });

      swingLowResult =
        extremaIndex({
          startIndex:
            Number(
              latestDirectionalEvent
                .index
            ),
          endIndex:
            ordered.length - 1,
          field: "low",
          mode: "min",
        });

      selectionReason =
        "major_break_unavailable_broad_bearish_fallback";
    }
  } else {
    return null;
  }

  const preliminarySwingHigh =
    Number(
      swingHighResult?.value
    );

  const preliminarySwingLow =
    Number(
      swingLowResult?.value
    );

  if (
    !Number.isFinite(
      preliminarySwingHigh
    ) ||
    !Number.isFinite(
      preliminarySwingLow
    ) ||
    preliminarySwingHigh <=
      preliminarySwingLow
  ) {
    return null;
  }

  if (
    direction === "bullish" &&
    Number(
      swingLowResult?.index
    ) >=
      Number(
        swingHighResult?.index
      )
  ) {
    return null;
  }

  if (
    direction === "bearish" &&
    Number(
      swingHighResult?.index
    ) >=
      Number(
        swingLowResult?.index
      )
  ) {
    return null;
  }

  const finalSwingHigh =
    preliminarySwingHigh;

  const finalSwingLow =
    preliminarySwingLow;

  let selectedSwingHigh =
    finalSwingHigh;

  let selectedSwingLow =
    finalSwingLow;

  let selectedSwingHighTime =
    ordered[
      swingHighResult.index
    ]?.datetime ||
    null;

  let selectedSwingLowTime =
    ordered[
      swingLowResult.index
    ]?.datetime ||
    null;

  let priceSource =
    "external_ohlc";

  let chartNativeConfidence =
    null;

  const chartNativeDirection =
    String(
      chartNativeImpulse?.direction ||
      ""
    ).toLowerCase();

  const chartNativeLow =
    asPositiveNumber(
      chartNativeImpulse?.swingLow
    );

  const chartNativeHigh =
    asPositiveNumber(
      chartNativeImpulse?.swingHigh
    );

  if (
    chartNativeImpulse?.usable ===
      true &&
    chartNativeDirection ===
      direction &&
    chartNativeLow !== null &&
    chartNativeHigh !== null &&
    chartNativeHigh >
      chartNativeLow
  ) {
    selectedSwingLow =
      chartNativeLow;

    selectedSwingHigh =
      chartNativeHigh;

    selectedSwingLowTime =
      chartNativeImpulse
        ?.swingLowTime ||
      selectedSwingLowTime;

    selectedSwingHighTime =
      chartNativeImpulse
        ?.swingHighTime ||
      selectedSwingHighTime;

    priceSource =
      chartNativeImpulse?.source ||
      "uploaded_chart_pixel_calibration";

    chartNativeConfidence =
      chartNativeImpulse
        ?.confidence ||
      null;

    selectionReason =
      `${selectionReason}_chart_native_price_scale`;
  }

  console.log(
    "CSA v4.5 Fibonacci structural origin:",
    {
      buildId: CSA_BUILD_ID,
      direction,
      majorBrokenLevel:
        majorSelection
          ? Number(
              majorSelection
                .pivotPrice
            )
          : null,
      localProtectedSwing:
        majorSelection
          ? {
              price:
                Number(
                  majorSelection
                    .protectedPrice
                ),
              datetime:
                majorSelection
                  .protectedDatetime ||
                null,
              index:
                Number(
                  majorSelection
                    .protectedIndex
                ),
              source:
                majorSelection
                  .protectedSource ||
                null,
            }
          : null,
      outerStructuralOrigin:
        outerStructuralOrigin ||
        null,
      selectedSwingLow,
      selectedSwingHigh,
      selectedSwingLowTime,
      selectedSwingHighTime,
      priceSource,
      selectionReason,
      rule:
        "outer_intact_pre_major_pivot_origin_preferred_over_later_internal_protected_swing",
    }
  );

  const range =
    selectedSwingHigh -
    selectedSwingLow;

  if (
    !Number.isFinite(range) ||
    range <= 0
  ) {
    return null;
  }

  const ratios =
    [0.382, 0.5, 0.618];

  const majorBrokenLevel =
    majorSelection
      ? {
          price:
            Number(
              majorSelection
                .pivotPrice
            ),
          pivotDatetime:
            majorSelection
              .pivotDatetime ||
            null,
          pivotIndex:
            Number(
              majorSelection
                .pivotIndex
            ),
          breakoutDatetime:
            majorSelection
              .breakoutDatetime ||
            null,
          breakoutIndex:
            Number(
              majorSelection
                .breakIndex
            ),
          significanceScore:
            Number(
              majorSelection
                .significanceScore
            ),
          hierarchyAdjustedScore:
            Number(
              majorSelection
                .hierarchyAdjustedScore
            ),
          hierarchyPosition:
            Number(
              majorSelection
                .hierarchyPosition
            ),
          hierarchyScore:
            Number(
              majorSelection
                .hierarchyScore
            ),
          lateBreakScore:
            Number(
              majorSelection
                .lateBreakScore
            ),
          terminalBreakScore:
            Number(
              majorSelection
                .terminalBreakScore
            ),
          nestedLevelPenalty:
            Number(
              majorSelection
                .nestedLevelPenalty
            ),
          outermostPivotPrice:
            Number(
              majorSelection
                .outermostPivotPrice
            ),
          barsUntilBreak:
            Number(
              majorSelection
                .barsUntilBreak
            ),
          reactionCount:
            Number(
              majorSelection
                .reactionCount
            ),
          prominenceAtr:
            Number(
              majorSelection
                .prominenceAtr
            ),
          excursionAtr:
            Number(
              majorSelection
                .excursionAtr
            ),
          originalSideRatio:
            Number(
              majorSelection
                .originalSideRatio
            ),
          terminalSeparationAtr:
            Number(
              majorSelection
                .terminalSeparationAtr
            ),
          confirmationPath:
            majorSelection
              .breakEvent
              ?.confirmationPath ||
            null,
        }
      : null;

  const protectedSwing =
    majorSelection
      ? {
          type:
            direction === "bullish"
              ? "protected_low"
              : "protected_high",
          price:
            Number(
              majorSelection
                .protectedPrice
            ),
          datetime:
            majorSelection
              .protectedDatetime ||
            null,
          index:
            Number(
              majorSelection
                .protectedIndex
            ),
          source:
            majorSelection
              .protectedSource,
        }
      : null;

  const result = {
    direction,
    swingHigh:
      selectedSwingHigh,
    swingLow:
      selectedSwingLow,
    swingHighTime:
      selectedSwingHighTime,
    swingLowTime:
      selectedSwingLowTime,
    marketDataSwingHigh:
      finalSwingHigh,
    marketDataSwingLow:
      finalSwingLow,
    priceSource,
    chartNativeConfidence,
    impulseRange:
      range,
    levels:
      ratios.map(
        (ratio) => ({
          ratio,
          label:
            ratio === 0.5
              ? "50%"
              : `${(
                  ratio * 100
                ).toFixed(1)}%`,
          price:
            direction === "bearish"
              ? selectedSwingLow +
                range * ratio
              : selectedSwingHigh -
                range * ratio,
        })
      ),
    source:
      majorSelection
        ? "major_break_significance_protected_swing_impulse"
        : "broad_fallback_structure_impulse",
    selectionReason,
    controllingEvent:
      controllingEvent
        ? {
            side:
              controllingEvent.side,
            datetime:
              controllingEvent
                .datetime ||
              null,
            level:
              Number(
                controllingEvent.level
              ),
            index:
              Number(
                controllingEvent.index
              ),
            pivotIndex:
              Number.isFinite(
                Number(
                  controllingEvent
                    .pivotIndex
                )
              )
                ? Number(
                    controllingEvent
                      .pivotIndex
                  )
                : null,
            pivotDatetime:
              controllingEvent
                .pivotDatetime ||
              null,
          }
        : null,
    latestOppositeEvent:
      latestOppositeEventBeforeCurrent
        ? {
            side:
              latestOppositeEventBeforeCurrent
                .side,
            datetime:
              latestOppositeEventBeforeCurrent
                .datetime ||
              null,
            level:
              Number(
                latestOppositeEventBeforeCurrent
                  .level
              ),
            index:
              Number(
                latestOppositeEventBeforeCurrent
                  .index
              ),
          }
        : null,
    protectedSwing,
    outerStructuralOrigin:
      outerStructuralOrigin ||
      null,
    fibOriginModel:
      outerStructuralOrigin
        ? "outer_structural_pre_major_pivot"
        : majorSelection
        ? "local_protected_swing_fallback"
        : "broad_structure_fallback",
    brokenMajorLevel:
      majorBrokenLevel,
    majorBreakCandidateCount:
      majorBreakCandidates.length,
    majorBreakCandidateAudit:
      majorBreakCandidates
        .slice(0, 8)
        .map(
          (candidate) => ({
            pivotPrice:
              candidate
                .pivotPrice,
            pivotDatetime:
              candidate
                .pivotDatetime,
            breakoutDatetime:
              candidate
                .breakoutDatetime,
            protectedPrice:
              candidate
                .protectedPrice,
            protectedDatetime:
              candidate
                .protectedDatetime,
            protectedSource:
              candidate
                .protectedSource,
            selectedAsControllingMajor:
              candidate ===
              majorSelection,
            fibOuterOrigin:
              candidate ===
                majorSelection
                ? outerStructuralOrigin ||
                  null
                : null,
            significanceScore:
              candidate
                .significanceScore,
            hierarchyAdjustedScore:
              candidate
                .hierarchyAdjustedScore,
            hierarchyPosition:
              candidate
                .hierarchyPosition,
            hierarchyScore:
              candidate
                .hierarchyScore,
            lateBreakScore:
              candidate
                .lateBreakScore,
            terminalBreakScore:
              candidate
                .terminalBreakScore,
            nestedDepthAtr:
              candidate
                .nestedDepthAtr,
            nestedLevelPenalty:
              candidate
                .nestedLevelPenalty,
            outermostPivotPrice:
              candidate
                .outermostPivotPrice,
            breakScanSource:
              candidate
                .breakEvent
                ?.breakScanSource ||
              null,
            barsUntilBreak:
              candidate
                .barsUntilBreak,
            reactionCount:
              candidate
                .reactionCount,
            prominenceAtr:
              candidate
                .prominenceAtr,
            excursionAtr:
              candidate
                .excursionAtr,
            originalSideRatio:
              candidate
                .originalSideRatio,
            terminalSeparationAtr:
              candidate
                .terminalSeparationAtr,
            veryLocalPenalty:
              candidate
                .veryLocalPenalty,
            rawFallbackPenalty:
              candidate
                .rawFallbackPenalty,
          })
        ),
    atr:
      Number(atr || 0),
    breakTolerance,
  };

  if (!suppressImpulseLog) {
    console.log(
      "CSA major-break significance:",
      {
        direction:
          result.direction,
        selectedMajorBreak:
          result.brokenMajorLevel,
        protectedSwing:
          result.protectedSwing,
        terminal:
          direction === "bullish"
            ? {
                type:
                  "final_high",
                price:
                  result.swingHigh,
                datetime:
                  result.swingHighTime,
              }
            : {
                type:
                  "final_low",
                price:
                  result.swingLow,
                datetime:
                  result.swingLowTime,
              },
        selectionReason:
          result.selectionReason,
        candidateCount:
          result.majorBreakCandidateCount,
        candidateAudit:
          result.majorBreakCandidateAudit,
      }
    );

    console.log(
      "CSA protected impulse:",
      {
        direction:
          result.direction,
        brokenMajorLevel:
          result.brokenMajorLevel,
        protectedSwing:
          result.protectedSwing,
        terminal:
          direction === "bullish"
            ? {
                type:
                  "final_high",
                price:
                  result.swingHigh,
                datetime:
                  result.swingHighTime,
              }
            : {
                type:
                  "final_low",
                price:
                  result.swingLow,
                datetime:
                  result.swingLowTime,
              },
        marketDataSwingLow:
          result.marketDataSwingLow,
        marketDataSwingHigh:
          result.marketDataSwingHigh,
        priceSource:
          result.priceSource,
        chartNativeConfidence:
          result.chartNativeConfidence,
        impulseRange:
          result.impulseRange,
        selectionReason:
          result.selectionReason,
        retracementLevels:
          result.levels,
      }
    );

    console.log(
      "CSA relevant impulse:",
      {
        direction:
          result.direction,
        swingLow:
          result.swingLow,
        swingLowTime:
          result.swingLowTime,
        swingHigh:
          result.swingHigh,
        swingHighTime:
          result.swingHighTime,
        marketDataSwingLow:
          result.marketDataSwingLow,
        marketDataSwingHigh:
          result.marketDataSwingHigh,
        priceSource:
          result.priceSource,
        chartNativeConfidence:
          result.chartNativeConfidence,
        impulseRange:
          result.impulseRange,
        selectionReason:
          result.selectionReason,
        controllingEvent:
          result.controllingEvent,
        protectedSwing:
          result.protectedSwing,
        brokenMajorLevel:
          result.brokenMajorLevel,
        retracementLevels:
          result.levels,
        chartNativeTargeting:
          chartNativeImpulse
            ?.targetedWickMapping ||
          chartNativeImpulse
            ?.wickLocation
            ? {
                targetOriginTime:
                  chartNativeImpulse
                    ?.wickLocation
                    ?.targetOriginTime ||
                  chartNativeImpulse
                    ?.targetedWickMapping
                    ?.targetOriginTime ||
                  null,
                targetTerminalTime:
                  chartNativeImpulse
                    ?.wickLocation
                    ?.targetTerminalTime ||
                  chartNativeImpulse
                    ?.targetedWickMapping
                    ?.targetTerminalTime ||
                  null,
                originCandleOffset:
                  chartNativeImpulse
                    ?.wickLocation
                    ?.originCandleOffset ??
                  chartNativeImpulse
                    ?.targetedWickMapping
                    ?.originCandleOffset ??
                  null,
                terminalCandleOffset:
                  chartNativeImpulse
                    ?.wickLocation
                    ?.terminalCandleOffset ??
                  chartNativeImpulse
                    ?.targetedWickMapping
                    ?.terminalCandleOffset ??
                  null,
              }
            : null,
      }
    );
  }

  return result;
}

function distanceFromPriceToZone(price, zoneLow, zoneHigh) {
  const value = Number(price);
  const low = Math.min(Number(zoneLow), Number(zoneHigh));
  const high = Math.max(Number(zoneLow), Number(zoneHigh));

  if (
    !Number.isFinite(value) ||
    !Number.isFinite(low) ||
    !Number.isFinite(high)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  if (value < low) return low - value;
  if (value > high) return value - high;
  return 0;
}

function evaluateRequiredFibonacciConfluence({
  fibonacci = null,
  zoneLow = null,
  zoneHigh = null,
  atr = 0,
  symbol = "",
  structuralQualityScore = 0,
  structuralEvidenceStrong = false,
}) {
  const low = Number(zoneLow);
  const high = Number(zoneHigh);
  const normalizedAtr = Math.max(0, Number(atr || 0));

  if (
    !fibonacci ||
    !Array.isArray(fibonacci.levels) ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    low >= high
  ) {
    return {
      passed: false,
      matches: [],
      evaluatedLevels: [],
      proximityAllowance: null,
      closeAllowance: null,
      borderlineAllowance: null,
      reason: "fibonacci_or_structural_area_unavailable",
    };
  }

  // UNIVERSAL CSA FIB-CONFLUENCE RULE
  //
  // The structural S/R or S/D area is primary.
  // Fibonacci only confirms strength; it never creates an entry area.
  //
  // 1) Fib inside the structural area -> direct confluence -> PASS.
  // 2) Fib outside but within 15% of ATR from the nearest zone edge
  //    -> close confluence -> PASS.
  // 3) Fib between 15% and 20% of ATR from the nearest zone edge
  //    -> borderline confluence -> PASS only when structure is very strong.
  // 4) Beyond 20% ATR -> no confluence -> FAIL.
  //
  // This scales naturally across forex, JPY pairs, gold, stocks, indices,
  // crypto and other instruments without hard-coded pip/dollar distances.
  const minimumInstrumentBuffer = Math.max(
    getCleanBreakTolerance(symbol) * 0.5,
    Number.EPSILON * 100
  );

  const closeAllowance = Math.max(
    normalizedAtr * 0.15,
    minimumInstrumentBuffer
  );

  const borderlineAllowance = Math.max(
    normalizedAtr * 0.20,
    closeAllowance
  );

  const strongStructure =
    structuralEvidenceStrong === true ||
    Number(structuralQualityScore || 0) >= 50;

  const allowedRatios = new Set([0.382, 0.5, 0.618]);

  const evaluatedLevels = fibonacci.levels
    .filter((level) => allowedRatios.has(Number(level?.ratio)))
    .map((level) => {
      const distanceToZone = distanceFromPriceToZone(
        level?.price,
        low,
        high
      );

      const atrFraction =
        normalizedAtr > 0 && Number.isFinite(distanceToZone)
          ? distanceToZone / normalizedAtr
          : null;

      const direct = distanceToZone === 0;
      const close =
        !direct &&
        Number.isFinite(distanceToZone) &&
        distanceToZone <= closeAllowance;

      const borderline =
        !direct &&
        !close &&
        Number.isFinite(distanceToZone) &&
        distanceToZone <= borderlineAllowance;

      const passed =
        direct ||
        close ||
        (borderline && strongStructure);

      return {
        ratio: Number(level.ratio),
        label: String(level.label || ""),
        price: Number(level.price),
        distanceToZone,
        distanceAsAtrFraction: atrFraction,
        distanceAsAtrPercent:
          atrFraction === null ? null : atrFraction * 100,
        matchType: direct
          ? "inside_structural_area"
          : close
          ? "close_proximity"
          : borderline
          ? strongStructure
            ? "borderline_strong_structure"
            : "borderline_structure_not_strong_enough"
          : "no_confluence",
        passed,
      };
    })
    .sort((a, b) => {
      if (a.distanceToZone !== b.distanceToZone) {
        return a.distanceToZone - b.distanceToZone;
      }
      return a.ratio - b.ratio;
    });

  const matches = evaluatedLevels.filter(
    (level) => level.passed === true
  );

  return {
    passed: matches.length > 0,
    matches,
    evaluatedLevels,
    proximityAllowance: closeAllowance,
    closeAllowance,
    borderlineAllowance,
    structuralQualityScore: Number(structuralQualityScore || 0),
    strongStructure,
    reason:
      matches.length > 0
        ? "structural_area_has_required_retracement_proximity"
        : "no_382_50_618_proximity",
  };
}

function countZoneReactions({
  candles = [],
  zoneLow,
  zoneHigh,
  atr = 0,
  tolerance = 0,
  reactionBars = 5,
}) {
  if (!Array.isArray(candles) || !candles.length) {
    return { touches: 0, reactions: 0, strongDepartures: 0 };
  }

  const lowBoundary = Math.min(Number(zoneLow), Number(zoneHigh)) - tolerance;
  const highBoundary = Math.max(Number(zoneLow), Number(zoneHigh)) + tolerance;

  if (!Number.isFinite(lowBoundary) || !Number.isFinite(highBoundary)) {
    return { touches: 0, reactions: 0, strongDepartures: 0 };
  }

  const touchIndexes = [];
  candles.forEach((candle, index) => {
    const high = Number(candle?.high);
    const low = Number(candle?.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return;
    if (high >= lowBoundary && low <= highBoundary) touchIndexes.push(index);
  });

  const clusters = [];
  touchIndexes.forEach((index) => {
    const latest = clusters[clusters.length - 1];
    if (!latest || index - latest.end > 2) {
      clusters.push({ start: index, end: index });
    } else {
      latest.end = index;
    }
  });

  const departureThreshold = Math.max(
    Number(atr || 0) * 0.50,
    (highBoundary - lowBoundary) * 1.25,
    tolerance * 3
  );

  let reactions = 0;
  let strongDepartures = 0;

  clusters.forEach((cluster) => {
    const later = candles.slice(
      cluster.end + 1,
      Math.min(candles.length, cluster.end + 1 + reactionBars)
    );

    let maxDeparture = 0;
    later.forEach((candle) => {
      const high = Number(candle?.high);
      const low = Number(candle?.low);
      if (Number.isFinite(high)) {
        maxDeparture = Math.max(maxDeparture, high - highBoundary);
      }
      if (Number.isFinite(low)) {
        maxDeparture = Math.max(maxDeparture, lowBoundary - low);
      }
    });

    if (maxDeparture >= departureThreshold) reactions += 1;
    if (maxDeparture >= departureThreshold * 1.7) strongDepartures += 1;
  });

  return {
    touches: clusters.length,
    reactions,
    strongDepartures,
  };
}

function clusterStructuralPrices({
  prices = [],
  clusterDistance = 0,
}) {
  const sorted = prices
    .filter((item) => Number.isFinite(Number(item?.price)))
    .sort((a, b) => Number(a.price) - Number(b.price));

  const clusters = [];

  sorted.forEach((item) => {
    const current = clusters[clusters.length - 1];

    if (
      !current ||
      Number(item.price) - Number(current.high) > clusterDistance
    ) {
      clusters.push({
        low: Number(item.price),
        high: Number(item.price),
        members: [item],
      });
      return;
    }

    current.low = Math.min(current.low, Number(item.price));
    current.high = Math.max(current.high, Number(item.price));
    current.members.push(item);
  });

  return clusters;
}

function classifyValidatedArea({
  direction,
  zoneLow,
  zoneHigh,
  rawZone,
  historicalPhase,
  reactionStats,
  atr,
}) {
  const authoritativeType = String(
    rawZone?.authoritativeType || ""
  ).toLowerCase();

  if (
    [
      "converted resistance",
      "converted support",
      "resistance",
      "support",
      "supply",
      "demand",
    ].includes(authoritativeType)
  ) {
    return authoritativeType;
  }

  const brokenLevel = asPositiveNumber(historicalPhase?.brokenLevel);
  const conversionTolerance = Math.max(
    Number(atr || 0) * 0.12,
    Math.abs(Number(zoneHigh) - Number(zoneLow)) * 0.75
  );

  const brokenLevelInside =
    brokenLevel !== null &&
    brokenLevel >= Number(zoneLow) - conversionTolerance &&
    brokenLevel <= Number(zoneHigh) + conversionTolerance;

  if (direction === "bearish" && brokenLevelInside) {
    return "converted resistance";
  }

  if (direction === "bullish" && brokenLevelInside) {
    return "converted support";
  }

  const memberTypes = new Set(
    (rawZone?.members || [])
      .map((member) => String(member?.type || "").toLowerCase())
      .filter(Boolean)
  );

  if (direction === "bearish") {
    if (memberTypes.has("supply")) return "supply";
    if (
      reactionStats.strongDepartures >= 1 &&
      reactionStats.reactions <= 1
    ) {
      return "supply";
    }
    return "resistance";
  }

  if (memberTypes.has("demand")) return "demand";
  if (
    reactionStats.strongDepartures >= 1 &&
    reactionStats.reactions <= 1
  ) {
    return "demand";
  }
  return "support";
}

function compactZoneBounds({
  rawLow,
  rawHigh,
  members = [],
  atr = 0,
  priceTolerance = 0,
  preferredCenter = null,
}) {
  const authoritativeMember =
    members.find((member) =>
      String(member?.source || "").startsWith("authoritative_framework_")
    ) || members[0] || null;

  const authoritativePrice = Number(
    authoritativeMember?.frameworkPrice ?? authoritativeMember?.price
  );

  const resolvedPreferredCenter = asPositiveNumber(preferredCenter);

  const fallbackCenter =
    Number.isFinite(Number(rawLow)) && Number.isFinite(Number(rawHigh))
      ? (Number(rawLow) + Number(rawHigh)) / 2
      : Number.isFinite(Number(rawLow))
      ? Number(rawLow)
      : Number.isFinite(Number(rawHigh))
      ? Number(rawHigh)
      : null;

  // If a same-period chart price has passed reconciliation, use that
  // resolved CSA level consistently everywhere downstream. Otherwise keep
  // the deterministic framework price.
  const center =
    resolvedPreferredCenter !== null
      ? resolvedPreferredCenter
      : Number.isFinite(authoritativePrice)
      ? authoritativePrice
      : fallbackCenter;

  if (!Number.isFinite(center)) {
    return {
      zoneLow: null,
      zoneHigh: null,
      center: null,
      halfWidth: null,
    };
  }

  // Keep the resolved CSA level at the centre. Period identity remains
  // deterministic; only a validated same-period chart reconciliation may
  // refine the final price used for the entry.
  const halfWidth = Math.max(
    priceTolerance,
    Number(atr || 0) * 0.025
  );

  return {
    zoneLow: center - halfWidth,
    zoneHigh: center + halfWidth,
    center,
    halfWidth,
  };
}

function zonesOverlap(a, b, tolerance = 0) {
  return (
    Number(a.zoneHigh) + tolerance >= Number(b.zoneLow) &&
    Number(b.zoneHigh) + tolerance >= Number(a.zoneLow)
  );
}

function dedupeValidatedAreas(areas = [], atr = 0) {
  const result = [];
  const tolerance = Math.max(Number(atr || 0) * 0.08, 0);

  areas.forEach((candidate) => {
    const duplicateIndex = result.findIndex((existing) =>
      zonesOverlap(existing, candidate, tolerance)
    );

    if (duplicateIndex < 0) {
      result.push(candidate);
      return;
    }

    const existing = result[duplicateIndex];
    const candidateReconciled =
      candidate?.chartReconciled === true;
    const existingReconciled =
      existing?.chartReconciled === true;

    const candidateDifference = Number.isFinite(
      Number(candidate?.reconciliationDifference)
    )
      ? Number(candidate.reconciliationDifference)
      : Number.POSITIVE_INFINITY;

    const existingDifference = Number.isFinite(
      Number(existing?.reconciliationDifference)
    )
      ? Number(existing.reconciliationDifference)
      : Number.POSITIVE_INFINITY;

    // For overlapping strong levels, prefer the candidate whose same-period
    // chart reading agrees most closely with its framework price.
    if (candidateReconciled && !existingReconciled) {
      result[duplicateIndex] = candidate;
      return;
    }

    if (
      candidateReconciled &&
      existingReconciled &&
      candidateDifference + Number.EPSILON < existingDifference
    ) {
      result[duplicateIndex] = candidate;
      return;
    }

    if (
      candidateReconciled &&
      existingReconciled &&
      existingDifference + Number.EPSILON < candidateDifference
    ) {
      return;
    }

    const candidatePriority =
      Number(candidate.structuralScore || 0) +
      Number(candidate.fibonacciScore || 0) * 4;
    const existingPriority =
      Number(existing.structuralScore || 0) +
      Number(existing.fibonacciScore || 0) * 4;

    if (candidatePriority > existingPriority) {
      result[duplicateIndex] = candidate;
    }
  });

  return result;
}

function validateAndSequenceEntryAreas({
  areas = [],
  direction = "range",
  currentPrice = null,
  atr = 0,
}) {
  const errors = [];

  const valid = areas.filter((area) => {
    const low = Number(area?.zoneLow);
    const high = Number(area?.zoneHigh);

    // Final hard guard: only deterministic strong areas that already passed
    // the 38.2 / 50 / 61.8 proximity gate are allowed into sequencing.
    if (
      area?.requiredFibConfluence !== true ||
      Number(area?.fibonacciScore || 0) <= 0
    ) {
      console.log("CSA selector v3 rejected non-confluent structural area:", {
        areaType: area?.areaType || null,
        levelText: area?.levelText || null,
        frameworkPeriod: area?.frameworkPeriod || null,
      });
      return false;
    }

    if (area?.authoritativeFrameworkLevel !== true) {
      errors.push("non_framework_area_rejected");
      return false;
    }

    if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) {
      errors.push("invalid_zone_bounds");
      return false;
    }

    const authoritativeCenter = Number(area?.authoritativeCenter);

    const zoneCenter = (low + high) / 2;
    const centerTolerance = Math.max(
      Number(atr || 0) * 0.001,
      Number.EPSILON * 100
    );

    if (
      !Number.isFinite(authoritativeCenter) ||
      Math.abs(zoneCenter - authoritativeCenter) > centerTolerance
    ) {
      errors.push("resolved_csa_level_not_zone_center");
      console.log("CSA selector v3 zone-center mismatch:", {
        levelText: area?.levelText || null,
        frameworkPeriod: area?.frameworkPeriod || null,
        zoneCenter,
        authoritativeCenter,
        frameworkCenter: area?.frameworkCenter ?? null,
        chartReconciledCenter: area?.chartReconciledCenter ?? null,
        difference: Math.abs(zoneCenter - authoritativeCenter),
        tolerance: centerTolerance,
      });
      return false;
    }

    if (direction === "bearish") {
      if (
        !["resistance", "converted resistance", "supply"].includes(
          area.areaType
        )
      ) {
        errors.push("bearish_area_type_conflict");
        return false;
      }

      if (low <= Number(currentPrice)) {
        errors.push("sell_area_not_above_price");
        return false;
      }
    }

    if (direction === "bullish") {
      if (
        !["support", "converted support", "demand"].includes(
          area.areaType
        )
      ) {
        errors.push("bullish_area_type_conflict");
        return false;
      }

      if (high >= Number(currentPrice)) {
        errors.push("buy_area_not_below_price");
        return false;
      }
    }

    if (
      Number(area.structuralScore || 0) <= 0 &&
      Number(area.fibonacciScore || 0) > 0
    ) {
      errors.push("fibonacci_only_area");
      return false;
    }

    return true;
  });

  const deduped = dedupeValidatedAreas(valid, atr);

  const pathOrdered = [...deduped].sort((a, b) => {
    if (direction === "bearish") {
      return Number(a.zoneLow) - Number(b.zoneLow);
    }

    return Number(b.zoneHigh) - Number(a.zoneHigh);
  });

  const rejectedDominated = [];

  const filtered = pathOrdered.filter((candidate, index) => {
    const farther = pathOrdered.slice(index + 1);

    if (
      shouldBypassNearerPlainArea({
        candidate,
        strongerFartherAreas: farther,
      })
    ) {
      rejectedDominated.push({
        areaType: candidate.areaType,
        levelText: candidate.levelText,
        frameworkPeriod: candidate.frameworkPeriod,
        qualityScore: candidate.qualityScore,
        lifecycleFlipCount: candidate.lifecycleFlipCount,
        sideChangeCount: candidate.sideChangeCount,
        fibonacciScore: candidate.fibonacciScore,
        reactionCount: candidate.reactionCount,
        strongDepartureCount: candidate.strongDepartureCount,
      });
      return false;
    }

    return true;
  });

  const sequenced = filtered.slice(0, 3).map((area, index) => ({
    ...area,
    executionOrder: index + 1,
    role:
      index === 0
        ? "primary"
        : index === 1
        ? "secondary"
        : "alternative",
  }));

  for (let index = 1; index < sequenced.length; index += 1) {
    const previous = sequenced[index - 1];
    const current = sequenced[index];

    if (
      direction === "bearish" &&
      Number(current.zoneLow) <= Number(previous.zoneLow)
    ) {
      errors.push("secondary_sell_area_not_higher");
    }

    if (
      direction === "bullish" &&
      Number(current.zoneHigh) >= Number(previous.zoneHigh)
    ) {
      errors.push("secondary_buy_area_not_lower");
    }
  }

  console.log("CSA selector v2 final areas:", {
    selectorVersion: CSA_SELECTOR_VERSION,
    direction,
    currentPrice,
    rejectedDominated,
    areas: sequenced.map((area) => ({
      role: area.role,
      areaType: area.areaType,
      levelText: area.levelText,
      authoritativeCenter: area.authoritativeCenter,
      frameworkCenter: area.frameworkCenter,
      chartReconciledCenter: area.chartReconciledCenter,
      frameworkPeriod: area.frameworkPeriod,
      qualityScore: area.qualityScore,
      reactionCount: area.reactionCount,
      strongDepartureCount: area.strongDepartureCount,
      fibonacciScore: area.fibonacciScore,
      lifecycleFlipCount: area.lifecycleFlipCount,
      sideChangeCount: area.sideChangeCount,
    })),
  });

  return {
    areas: sequenced,
    validation: {
      passed: errors.length === 0,
      errors: [...new Set(errors)],
      selectorVersion: CSA_SELECTOR_VERSION,
      rejectedDominated,
    },
  };
}


function frameworkLevelTolerance({
  symbol = "",
  atr = 0,
}) {
  return Math.max(
    getApprovedPriceTolerance(symbol) * 2,
    Number(atr || 0) * 0.05
  );
}

function periodLevelBreakEvidence({
  levels = [],
  sourceIndex,
  levelPrice,
  direction,
  tolerance,
}) {
  const later = levels.slice(sourceIndex + 1);
  if (!later.length) {
    return {
      broken: false,
      heldBeyond: false,
      breakIndex: -1,
      breakPeriod: null,
    };
  }

  let breakIndex = -1;

  for (let index = 0; index < later.length; index += 1) {
    const period = later[index];
    const close = Number(period?.close);
    if (!Number.isFinite(close)) continue;

    const broke =
      direction === "bearish"
        ? close < Number(levelPrice) - tolerance
        : close > Number(levelPrice) + tolerance;

    if (broke) {
      breakIndex = index;
      break;
    }
  }

  if (breakIndex < 0) {
    return {
      broken: false,
      heldBeyond: false,
      breakIndex: -1,
      breakPeriod: null,
    };
  }

  const afterBreak = later.slice(breakIndex);
  const latestClose = Number(levels[levels.length - 1]?.close);

  const continuationCount = afterBreak.filter((period) => {
    const close = Number(period?.close);
    if (!Number.isFinite(close)) return false;

    return direction === "bearish"
      ? close < Number(levelPrice) - tolerance * 0.35
      : close > Number(levelPrice) + tolerance * 0.35;
  }).length;

  const heldBeyond =
    Number.isFinite(latestClose) &&
    (
      direction === "bearish"
        ? latestClose < Number(levelPrice) - tolerance * 0.35
        : latestClose > Number(levelPrice) + tolerance * 0.35
    ) &&
    continuationCount >= 1;

  return {
    broken: true,
    heldBeyond,
    breakIndex: sourceIndex + 1 + breakIndex,
    breakPeriod: later[breakIndex] || null,
  };
}


function extractNumericPriceFromLabel(value = "") {
  const text = String(value || "").replace(/,/g, "");
  const matches = text.match(/\b\d+(?:\.\d+)?\b/g) || [];

  const candidates = matches
    .map((match) => Number(match))
    .filter((number) => Number.isFinite(number) && number > 0);

  return candidates.length ? candidates[candidates.length - 1] : null;
}

function collectVisibleChartPriceEvidence({
  visualReview = {},
  frameworkType = "",
  symbol = "",
}) {
  const evidence = [];

  const addEvidence = ({
    price,
    type = "",
    source = "",
    description = "",
    periodHint = "",
    sideHint = "",
    confidence = 1,
  }) => {
    const numericPrice = asPositiveNumber(price);
    if (numericPrice === null) return;

    evidence.push({
      price: numericPrice,
      type: String(type || "").toLowerCase(),
      source,
      description: safeUserText(description || ""),
      periodHint: safeUserText(periodHint || ""),
      periodIdentity:
        normalizeFrameworkPeriodIdentity(periodHint),
      sideHint: safeUserText(sideHint || ""),
      confidence,
    });
  };

  // Highest-priority evidence comes straight from the dedicated
  // per-target reader. It cannot be lost by later array trimming.
  (Array.isArray(
    visualReview?.frameworkPriceMapDiagnostics?.matches
  )
    ? visualReview.frameworkPriceMapDiagnostics.matches
    : []
  ).forEach((match) => {
    const exact =
      nullablePositiveNumber(match?.displayedPrice);
    const approximate =
      exact === null
        ? nullablePositiveNumber(match?.approximatePrice)
        : null;

    if (exact !== null) {
      addEvidence({
        price: exact,
        type: "label",
        source:
          "per_target_framework_price_map_exact",
        description:
          match?.platformLabel ||
          match?.evidence ||
          `${match?.period || ""} ${match?.side || ""}`,
        periodHint: match?.period || "",
        sideHint: match?.side || "",
        confidence: 50,
      });
      return;
    }

    if (approximate !== null) {
      addEvidence({
        price: approximate,
        type: "label",
        source:
          "per_target_framework_price_map_estimate",
        description:
          match?.evidence ||
          `${match?.period || ""} ${match?.side || ""}`,
        periodHint: match?.period || "",
        sideHint: match?.side || "",
        confidence:
          String(match?.confidence || "").toLowerCase() ===
          "high"
            ? 32
            : String(match?.confidence || "").toLowerCase() ===
              "medium"
            ? 24
            : 16,
      });
    }
  });

  [
    ...(Array.isArray(visualReview?.activeEntryAreas)
      ? visualReview.activeEntryAreas
      : []),
    ...(visualReview?.preferredEntryArea
      ? [visualReview.preferredEntryArea]
      : []),
  ].forEach((area) => {
    const normalizedType = String(
      normalizedAreaType(
        area?.areaType,
        /support|demand/i.test(frameworkType) ? "bullish" : "bearish"
      ) || ""
    ).toLowerCase();

    const zone = normalizeZone(area, symbol);
    const center = areaCenter(zone);

    addEvidence({
      price: center,
      type: normalizedType,
      source: "visual_area",
      description: area?.zoneText || area?.sourceReason || "",
      periodHint:
        area?.frameworkPeriodHint ||
        area?.periodHint ||
        area?.sourcePeriod ||
        "",
      confidence: 4,
    });
  });

  (Array.isArray(visualReview?.visibleMarkedLevels)
    ? visualReview.visibleMarkedLevels
    : []
  ).forEach((item) => {
    const exactPrice =
      nullablePositiveNumber(item?.displayedPrice) ||
      extractNumericPriceFromLabel(item?.platformLabel);

    addEvidence({
      price: exactPrice,
      type: String(item?.type || "").toLowerCase(),
      source: "visible_exact_marked_price",
      description:
        item?.platformLabel ||
        item?.description ||
        "",
      periodHint:
        item?.frameworkPeriodHint ||
        item?.periodHint ||
        item?.sourcePeriod ||
        "",
      sideHint: item?.frameworkSideHint || "",
      confidence:
        item?.extractionSource ===
        "per_target_framework_price_reader"
          ? 30
          : 10,
    });

    if (exactPrice === null) {
      addEvidence({
        price: item?.approximatePrice,
        type: String(item?.type || "").toLowerCase(),
        source: "visible_marked_level_estimate",
        description: item?.description || "",
        periodHint:
          item?.frameworkPeriodHint ||
          item?.periodHint ||
          item?.sourcePeriod ||
          "",
        sideHint: item?.frameworkSideHint || "",
        confidence:
          item?.extractionSource ===
          "per_target_framework_price_reader_estimate"
            ? 18
            : 4,
      });
    }
  });

  (Array.isArray(visualReview?.visibleHorizontalLines)
    ? visualReview.visibleHorizontalLines
    : []
  ).forEach((item) => {
    const exactPrice =
      nullablePositiveNumber(item?.displayedPrice) ||
      extractNumericPriceFromLabel(item?.platformLabel);

    addEvidence({
      price: exactPrice,
      type: "line",
      source: "visible_exact_platform_price",
      description:
        item?.platformLabel ||
        item?.description ||
        `visible ${item?.colour || ""} line`,
      periodHint:
        item?.frameworkPeriodHint ||
        item?.periodHint ||
        item?.sourcePeriod ||
        "",
      confidence: 12,
    });

    if (exactPrice === null) {
      addEvidence({
        price: item?.approximatePrice,
        type: "line",
        source: "visible_horizontal_line_estimate",
        description:
          item?.description ||
          `visible ${item?.colour || ""} line`,
        periodHint:
          item?.frameworkPeriodHint ||
          item?.periodHint ||
          item?.sourcePeriod ||
          "",
        confidence: 3,
      });
    }
  });

  return evidence;
}


function normalizeFrameworkPeriodIdentity(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";

  const monthMap = [
    ["january", "01"], ["jan", "01"],
    ["february", "02"], ["feb", "02"],
    ["march", "03"], ["mar", "03"],
    ["april", "04"], ["apr", "04"],
    ["may", "05"],
    ["june", "06"], ["jun", "06"],
    ["july", "07"], ["jul", "07"],
    ["august", "08"], ["aug", "08"],
    ["september", "09"], ["sep", "09"], ["sept", "09"],
    ["october", "10"], ["oct", "10"],
    ["november", "11"], ["nov", "11"],
    ["december", "12"], ["dec", "12"],
  ];

  const yearMatch = text.match(/\b(20\d{2}|19\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : "";

  for (const [name, number] of monthMap) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) {
      return year ? `${year}-${number}` : `month-${number}`;
    }
  }

  const isoMonth = text.match(/\b(20\d{2}|19\d{2})[-/](0?[1-9]|1[0-2])\b/);
  if (isoMonth) {
    return `${isoMonth[1]}-${String(isoMonth[2]).padStart(2, "0")}`;
  }

  const quarter = text.match(/\bq([1-4])\b/i);
  if (quarter) return year ? `${year}-q${quarter[1]}` : `q${quarter[1]}`;

  const week = text.match(/\b(?:week|wk)\s*([0-5]?\d)\b/i);
  if (week) return year ? `${year}-w${String(week[1]).padStart(2, "0")}` : `w${String(week[1]).padStart(2, "0")}`;

  const dateMatch = text.match(/\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/);
  if (dateMatch) return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

  return text.replace(/\s+/g, " ");
}

function frameworkPeriodIdentityFromRecord(period = {}) {
  return normalizeFrameworkPeriodIdentity(
    period?.periodLabel ||
    period?.day ||
    period?.date ||
    period?.key ||
    ""
  );
}

function periodHintsCompatible(candidateHint = "", frameworkHint = "") {
  const candidate = normalizeFrameworkPeriodIdentity(candidateHint);
  const framework = normalizeFrameworkPeriodIdentity(frameworkHint);

  if (!candidate || !framework) return false;
  if (candidate === framework) return true;

  // Allow "January" to match "January 2026" when the visible chart does not
  // print the year, but never allow one named month/week/quarter to match another.
  const candidateMonth = candidate.match(/(?:\d{4}-|month-)(\d{2})$/);
  const frameworkMonth = framework.match(/(?:\d{4}-|month-)(\d{2})$/);
  if (candidateMonth && frameworkMonth) {
    return candidateMonth[1] === frameworkMonth[1];
  }

  const candidateQuarter = candidate.match(/(?:\d{4}-)?q([1-4])$/);
  const frameworkQuarter = framework.match(/(?:\d{4}-)?q([1-4])$/);
  if (candidateQuarter && frameworkQuarter) {
    return candidateQuarter[1] === frameworkQuarter[1];
  }

  return false;
}

function reconcileFrameworkLevelWithVisibleChart({
  frameworkPrice,
  frameworkType,
  frameworkPeriod = "",
  frameworkSide = "",
  visualReview = {},
  symbol = "",
  atr = 0,
}) {
  const basePrice = asPositiveNumber(frameworkPrice);
  if (basePrice === null) {
    return {
      price: null,
      source: "framework_data",
      reconciled: false,
    };
  }

  const tolerance = getFrameworkChartReconciliationTolerance({
    symbol,
    atr,
  });

  const typeCompatible = (candidateType) => {
    const type = String(candidateType || "").toLowerCase();

    if (type === "line" || type === "zone" || type === "label" || !type) {
      return true;
    }

    if (frameworkType === "converted resistance") {
      return ["converted resistance", "resistance", "support"].includes(type);
    }

    if (frameworkType === "converted support") {
      return ["converted support", "support", "resistance"].includes(type);
    }

    if (frameworkType === "supply") {
      return ["supply", "resistance"].includes(type);
    }

    if (frameworkType === "demand") {
      return ["demand", "support"].includes(type);
    }

    if (frameworkType === "resistance") {
      return ["resistance", "supply"].includes(type);
    }

    if (frameworkType === "support") {
      return ["support", "demand"].includes(type);
    }

    return true;
  };

  const normalizedFrameworkPeriod =
    normalizeFrameworkPeriodIdentity(frameworkPeriod);

  const dedicatedExactTolerance = Math.max(
    tolerance,
    Number(atr || 0) * 0.25
  );

  const evidence = collectVisibleChartPriceEvidence({
    visualReview,
    frameworkType,
    symbol,
  })
    .filter((candidate) => {
      if (!typeCompatible(candidate.type)) return false;

      // A visible broker price may refine the market-data price only when it
      // belongs to the SAME authoritative period. Period identity remains
      // non-negotiable.
      const periodMatches = periodHintsCompatible(
        candidate.periodIdentity || candidate.periodHint,
        normalizedFrameworkPeriod
      );

      if (!periodMatches) return false;

      const candidateSide = String(
        candidate.sideHint || ""
      ).toLowerCase();
      const expectedSide = String(
        frameworkSide || ""
      ).toLowerCase();

      if (
        candidateSide &&
        expectedSide &&
        candidateSide !== expectedSide
      ) {
        return false;
      }

      const dedicatedExact =
        String(candidate.source || "") ===
        "per_target_framework_price_map_exact";

      const allowedTolerance = dedicatedExact
        ? dedicatedExactTolerance
        : tolerance;

      return (
        Math.abs(Number(candidate.price) - basePrice) <=
        allowedTolerance
      );
    })
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(Number(candidate.price) - basePrice),
      exactPeriodPrice:
        String(candidate.source || "") ===
        "per_target_framework_price_map_exact",
    }))
    .sort((a, b) => {
      // Exact printed same-period platform labels outrank approximations and
      // generic line reads. Distance decides only inside the same evidence tier.
      if (a.exactPeriodPrice !== b.exactPeriodPrice) {
        return a.exactPeriodPrice ? -1 : 1;
      }
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      return b.confidence - a.confidence;
    });

  if (!evidence.length) {
    console.log("Framework reconciliation fallback:", {
      frameworkPeriod,
      frameworkSide,
      frameworkType,
      frameworkPrice: basePrice,
      tolerance,
      reason:
        "No same-period/same-side chart price survived validation.",
    });

    return {
      price: basePrice,
      source: "framework_data",
      reconciled: false,
      difference: 0,
      evidence: null,
    };
  }

  const selected = evidence[0];

  console.log("Framework reconciliation selected:", {
    frameworkPeriod,
    frameworkSide,
    frameworkType,
    frameworkPrice: basePrice,
    chartPrice: Number(selected.price),
    source: selected.source,
    periodHint: selected.periodHint || null,
    sideHint: selected.sideHint || null,
    confidence: selected.confidence,
    difference: selected.distance,
    tolerance,
    dedicatedExactTolerance,
    exactPeriodPrice: selected.exactPeriodPrice === true,
  });

  return {
    price: Number(selected.price),
    source: selected.source,
    reconciled: true,
    frameworkPrice: basePrice,
    difference: selected.distance,
    evidence: selected.description || null,
    periodHint: selected.periodHint || null,
    frameworkPeriod: frameworkPeriod || null,
    confidence: selected.confidence,
  };
}


const CSA_SELECTOR_VERSION = "4.1.0";

function resolveCsaEntryPrice({
  frameworkPrice = null,
  chartPrice = null,
  chartReconciled = false,
  symbol = "",
}) {
  const framework = asPositiveNumber(frameworkPrice);
  const chart = asPositiveNumber(chartPrice);

  if (framework === null) return chart;
  if (!chartReconciled || chart === null) return framework;

  const difference = Math.abs(chart - framework);

  // Keep the framework value when the difference is only a tiny broker/feed
  // variation. For normal non-JPY FX this is roughly 0.3 pip.
  const microDifferenceTolerance = Math.max(
    getCleanBreakTolerance(symbol) * 0.15,
    Number.EPSILON * 100
  );

  if (difference <= microDifferenceTolerance) {
    return framework;
  }

  // A meaningful same-period visual reconciliation may refine the entry price.
  // Period identity is still controlled by the deterministic framework.
  return chart;
}

function frameworkAreaSide(type = "") {
  const normalized = String(type || "").toLowerCase();

  if (
    ["resistance", "supply", "converted support"].includes(normalized)
  ) {
    return "high";
  }

  if (
    ["support", "demand", "converted resistance"].includes(normalized)
  ) {
    return "low";
  }

  return "";
}

function findFrameworkAreaPeriodIndex({
  area = {},
  levels = [],
  tolerance = 0,
}) {
  const areaPeriod = String(
    area?.period ||
    area?.day ||
    area?.date ||
    ""
  ).trim();

  const areaPrice = asPositiveNumber(area?.price);
  const originalType = String(area?.type || "").toLowerCase();

  return levels.findIndex((period) => {
    const label = String(
      period?.periodLabel ||
      period?.day ||
      period?.date ||
      period?.key ||
      ""
    ).trim();

    const samePeriod =
      !areaPeriod ||
      areaPeriod === label ||
      areaPeriod === String(period?.date || "").trim() ||
      areaPeriod === String(period?.key || "").trim();

    if (!samePeriod) return false;
    if (areaPrice === null) return true;

    const expected =
      ["resistance", "supply"].includes(originalType)
        ? asPositiveNumber(period?.high)
        : asPositiveNumber(period?.low);

    return (
      expected !== null &&
      Math.abs(expected - areaPrice) <= tolerance
    );
  });
}

function getCandlesAfterFrameworkPeriod({
  marketReference = {},
  levels = [],
  sourceIndex = -1,
  timeframe = "H1",
}) {
  const candles = Array.isArray(marketReference?.timeframeCandles)
    ? marketReference.timeframeCandles
        .filter(
          (candle) =>
            candle?.datetime &&
            Number.isFinite(Number(candle?.open)) &&
            Number.isFinite(Number(candle?.high)) &&
            Number.isFinite(Number(candle?.low)) &&
            Number.isFinite(Number(candle?.close))
        )
        .sort((a, b) =>
          String(a.datetime).localeCompare(String(b.datetime))
        )
    : [];

  if (
    !candles.length ||
    !Array.isArray(levels) ||
    sourceIndex < 0 ||
    sourceIndex >= levels.length
  ) {
    return [];
  }

  const profile =
    marketReference?.profile ||
    getSupportedCsaTimeframeProfile(timeframe);

  const indexByPeriodKey = new Map(
    levels.map((period, index) => [
      String(period?.key || period?.date || ""),
      index,
    ])
  );

  return candles.filter((candle) => {
    const dateOnly = candleDateOnly(candle.datetime);
    if (!dateOnly) return false;

    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return false;

    const period = getPeriodKeyAndLabel(date, profile);
    const candlePeriodIndex = indexByPeriodKey.get(
      String(period?.key || "")
    );

    return (
      Number.isInteger(candlePeriodIndex) &&
      candlePeriodIndex > sourceIndex
    );
  });
}

function findConfirmedLevelBreakEvent({
  candles = [],
  levelPrice = null,
  direction = "bearish",
  startIndex = 0,
  tolerance = 0,
  timeframe = "H1",
}) {
  if (
    !Array.isArray(candles) ||
    !candles.length ||
    !Number.isFinite(Number(levelPrice))
  ) {
    return null;
  }

  const config = getStructureEngineConfig(timeframe);
  const atr = averageTrueRange(candles, config.atrPeriod);

  for (
    let index = Math.max(0, Number(startIndex || 0));
    index < candles.length;
    index += 1
  ) {
    const closesConfirmed = countConsecutiveBreakCloses({
      candles,
      index,
      level: Number(levelPrice),
      tolerance,
      side: direction,
      count: config.confirmationCloses,
    });

    const displacementConfirmed = isStrongDisplacementBreak({
      candles,
      index,
      level: Number(levelPrice),
      tolerance,
      atr,
      side: direction,
      timeframe,
    });

    if (closesConfirmed || displacementConfirmed) {
      return {
        index,
        datetime: candles[index]?.datetime || null,
        direction,
        confirmationPath: displacementConfirmed
          ? "strong_displacement"
          : "multiple_closes",
      };
    }
  }

  return null;
}

function resolveDeterministicFrameworkLifecycle({
  area = {},
  levels = [],
  sourceIndex = -1,
  marketReference = {},
  symbol = "",
  timeframe = "H1",
  atr = 0,
}) {
  const originalType = String(area?.type || "").toLowerCase();
  const levelPrice = asPositiveNumber(area?.price);

  if (
    levelPrice === null ||
    !["support", "resistance", "supply", "demand"].includes(
      originalType
    )
  ) {
    return {
      state: "invalid",
      finalType: "invalid",
      flipCount: 0,
      events: [],
    };
  }

  const laterCandles = getCandlesAfterFrameworkPeriod({
    marketReference,
    levels,
    sourceIndex,
    timeframe,
  });

  const tolerance = Math.max(
    frameworkLevelTolerance({ symbol, atr }),
    Number(atr || 0) * 0.06
  );

  if (!laterCandles.length) {
    return {
      state: "active",
      finalType: originalType,
      flipCount: 0,
      events: [],
    };
  }

  const initialBreakDirection =
    ["support", "demand"].includes(originalType)
      ? "bearish"
      : "bullish";

  // Supply/demand is an origin zone. A clean break through it invalidates
  // the old zone; it does not automatically become converted S/R.
  if (["supply", "demand"].includes(originalType)) {
    const breakEvent = findConfirmedLevelBreakEvent({
      candles: laterCandles,
      levelPrice,
      direction: initialBreakDirection,
      startIndex: 0,
      tolerance,
      timeframe,
    });

    return breakEvent
      ? {
          state: "invalidated",
          finalType: "invalid",
          flipCount: 1,
          events: [breakEvent],
        }
      : {
          state: "active",
          finalType: originalType,
          flipCount: 0,
          events: [],
        };
  }

  // Support/resistance has memory. Confirmed breaks toggle the role.
  const events = [];
  let expectedDirection = initialBreakDirection;
  let searchFrom = 0;

  while (searchFrom < laterCandles.length && events.length < 8) {
    const event = findConfirmedLevelBreakEvent({
      candles: laterCandles,
      levelPrice,
      direction: expectedDirection,
      startIndex: searchFrom,
      tolerance,
      timeframe,
    });

    if (!event) break;

    events.push(event);
    expectedDirection =
      expectedDirection === "bullish"
        ? "bearish"
        : "bullish";
    searchFrom = event.index + 1;
  }

  if (!events.length) {
    return {
      state: "active",
      finalType: originalType,
      flipCount: 0,
      events: [],
    };
  }

  const latestDirection = events[events.length - 1].direction;

  return {
    state: "converted",
    finalType:
      latestDirection === "bullish"
        ? "converted support"
        : "converted resistance",
    flipCount: events.length,
    events,
  };
}

function countLevelSideChanges({
  candles = [],
  levelPrice = null,
  tolerance = 0,
}) {
  if (
    !Array.isArray(candles) ||
    !candles.length ||
    !Number.isFinite(Number(levelPrice))
  ) {
    return 0;
  }

  const states = [];

  candles.forEach((candle) => {
    const close = Number(candle?.close);
    if (!Number.isFinite(close)) return;

    let state = 0;
    if (close > Number(levelPrice) + tolerance) state = 1;
    if (close < Number(levelPrice) - tolerance) state = -1;
    if (state === 0) return;

    if (!states.length || states[states.length - 1] !== state) {
      states.push(state);
    }
  });

  return Math.max(0, states.length - 1);
}

function selectorAreaQuality({
  areaType = "",
  lifecycleFlipCount = 0,
  lifecycleEvents = [],
  sideChangeCount = 0,
  reactionStats = {},
  pivotConfirmationCount = 0,
  fibonacciScore = 0,
}) {
  const type = String(areaType || "").toLowerCase();
  const reactions = Number(reactionStats?.reactions || 0);
  const departures = Number(reactionStats?.strongDepartures || 0);
  const pivots = Number(pivotConfirmationCount || 0);
  const flips = Number(lifecycleFlipCount || 0);
  const sideChanges = Number(sideChangeCount || 0);

  const conversionType =
    ["converted resistance", "converted support"].includes(type);

  const lifecycleEventList = Array.isArray(lifecycleEvents)
    ? lifecycleEvents
    : [];

  const latestLifecycleEvent =
    lifecycleEventList.length > 0
      ? lifecycleEventList[lifecycleEventList.length - 1]
      : null;

  const latestBreakClean =
    !conversionType ||
    (
      latestLifecycleEvent &&
      ["strong_displacement", "multiple_closes"].includes(
        String(latestLifecycleEvent?.confirmationPath || "")
      )
    );

  // A level can legitimately change role twice over time.
  // Two clean chronological role changes are not automatically ranging/chop.
  const cleanConversion =
    conversionType &&
    flips <= 2 &&
    latestBreakClean;

  let score =
    ["supply", "demand"].includes(type)
      ? 34
      : ["converted resistance", "converted support"].includes(type)
      ? 36
      : 28;

  score += reactions * 7;
  score += departures * 9;
  score += pivots * 3;
  score += Number(fibonacciScore || 0) * 7;

  // The first clean conversion is useful evidence. Repeated back-and-forth
  // crossing is chop and must reduce entry quality.
  if (cleanConversion) score += 6;
  score -= Math.max(0, flips - 1) * 14;
  score -= Math.max(0, sideChanges - 1) * 7;

  const choppy =
    flips >= 3 ||
    sideChanges >= 4 ||
    (
      flips >= 2 &&
      sideChanges >= 3 &&
      reactions < 2 &&
      departures < 1
    );

  let valid = true;
  let reason = "validated";

  if (["supply", "demand"].includes(type)) {
    valid =
      departures >= 1 ||
      reactions >= 2 ||
      (reactions >= 1 && (pivots >= 1 || fibonacciScore > 0));

    if (!valid) reason = "weak_supply_demand";
  } else if (cleanConversion) {
    valid = true;
  } else if (
    ["converted resistance", "converted support"].includes(type)
  ) {
    // Repeatedly flipped S/R remains useful context, but not automatically
    // a trade area. It must re-earn quality after the latest flip.
    valid =
      !choppy ||
      (
        reactions >= 2 &&
        (departures >= 1 || fibonacciScore >= 2)
      );

    if (!valid) reason = "choppy_converted_level";
  } else {
    // Plain support/resistance candidates reaching this function already come
    // from authoritative timeframe framework highs/lows and have survived the
    // deterministic lifecycle invalidation checks. Do not require an extra
    // reaction/pivot merely to remain a valid structural reference.
    // The mandatory 38.2 / 50 / 61.8 gate later decides whether the valid
    // structural level is strong enough to become an entry.
    valid = !choppy;

    if (!valid) reason = "choppy_plain_sr";
  }

  return {
    valid,
    score: Math.max(0, score),
    choppy,
    reason,
  };
}

function shouldBypassNearerPlainArea({
  candidate = {},
  strongerFartherAreas = [],
}) {
  const type = String(candidate?.areaType || "").toLowerCase();

  // Once an area has passed the mandatory structural + 38.2/50/61.8 gate,
  // preserve it in path order. Entry 1 is the first strong area price is
  // likely to reach; Entry 2 is the next strong area.
  if (candidate?.requiredFibConfluence === true) {
    return false;
  }

  // A clean converted level is not skipped simply because another area
  // scores higher. This protects the D1 converted-resistance benchmark.
  if (
    ["converted resistance", "converted support"].includes(type) &&
    Number(candidate?.lifecycleFlipCount || 0) <= 1
  ) {
    return false;
  }

  const candidateScore = Number(candidate?.qualityScore || 0);

  return strongerFartherAreas.some((other) => {
    const otherScore = Number(other?.qualityScore || 0);
    const otherFib = Number(other?.fibonacciScore || 0);
    const otherDepartures = Number(other?.strongDepartureCount || 0);
    const otherReactions = Number(other?.reactionCount || 0);

    const independentlyStrong =
      otherDepartures >= 1 ||
      otherReactions >= 2 ||
      [
        "supply",
        "demand",
        "converted resistance",
        "converted support",
      ].includes(String(other?.areaType || "").toLowerCase());

    return (
      independentlyStrong &&
      otherScore >= candidateScore + 12 &&
      (
        otherFib >= 2 ||
        otherDepartures >= 1 ||
        otherReactions >= 2
      )
    );
  });
}

function buildAuthoritativeFrameworkCandidates({
  marketReference = {},
  visualReview = {},
  direction = "range",
  currentPrice = null,
  symbol = "",
  timeframe = "H1",
  atr = 0,
}) {
  const levels = Array.isArray(marketReference?.dailyLevels)
    ? [...marketReference.dailyLevels].sort((a, b) =>
        String(a?.key || a?.date || "").localeCompare(
          String(b?.key || b?.date || "")
        )
      )
    : [];

  const sourceAreas = Array.isArray(marketReference?.csaAreas)
    ? marketReference.csaAreas
    : [];

  const tolerance = frameworkLevelTolerance({ symbol, atr });
  const candidates = [];

  sourceAreas.forEach((area) => {
    const frameworkPrice = asPositiveNumber(area?.price);
    if (frameworkPrice === null) return;

    const sourceIndex = findFrameworkAreaPeriodIndex({
      area,
      levels,
      tolerance,
    });

    if (sourceIndex < 0) return;

    const lifecycle = resolveDeterministicFrameworkLifecycle({
      area,
      levels,
      sourceIndex,
      marketReference,
      symbol,
      timeframe,
      atr,
    });

    if (
      lifecycle.state === "invalid" ||
      lifecycle.state === "invalidated" ||
      lifecycle.finalType === "invalid"
    ) {
      return;
    }

    const finalType = lifecycle.finalType;

    const validDirectionType =
      direction === "bearish"
        ? ["resistance", "supply", "converted resistance"].includes(
            finalType
          )
        : ["support", "demand", "converted support"].includes(
            finalType
          );

    if (!validDirectionType) return;

    const validPriceSide =
      direction === "bearish"
        ? frameworkPrice > Number(currentPrice) + tolerance
        : frameworkPrice < Number(currentPrice) - tolerance;

    if (!validPriceSide) return;

    const sourcePeriod = levels[sourceIndex];
    const periodLabel =
      sourcePeriod?.periodLabel ||
      sourcePeriod?.day ||
      sourcePeriod?.key ||
      area?.period ||
      area?.day ||
      `Period ${sourceIndex + 1}`;

    const frameworkSide = frameworkAreaSide(finalType);

    const reconciled = reconcileFrameworkLevelWithVisibleChart({
      frameworkPrice,
      frameworkType: finalType,
      frameworkPeriod: periodLabel,
      frameworkSide,
      visualReview,
      symbol,
      atr,
    });

    candidates.push({
      price: reconciled.price,
      frameworkPrice,
      type: finalType,
      originalType: String(area?.type || "").toLowerCase(),
      source:
        lifecycle.state === "converted"
          ? "authoritative_framework_conversion"
          : frameworkSide === "high"
          ? "authoritative_framework_high"
          : "authoritative_framework_low",
      priceSource: reconciled.source,
      chartReconciled: reconciled.reconciled === true,
      reconciliationEvidence: reconciled.evidence || null,
      reconciliationPeriodHint: reconciled.periodHint || null,
      reconciliationConfidence: Number(reconciled.confidence || 0),
      reconciliationDifference:
        Number.isFinite(Number(reconciled.difference))
          ? Number(reconciled.difference)
          : null,
      period: periodLabel,
      date: sourcePeriod?.date || sourcePeriod?.key || area?.date || null,
      sourceIndex,
      conversionBreakConfirmed:
        lifecycle.state === "converted" &&
        ["converted resistance", "converted support"].includes(finalType),
      conversionConfirmed: false,
      lifecycleFlipCount: Number(lifecycle.flipCount || 0),
      lifecycleEvents: Array.isArray(lifecycle.events)
        ? lifecycle.events
        : [],
      authorityRank:
        lifecycle.state === "converted" ? 1 : 2,
    });
  });

  // Do not collapse nearby levels from different authoritative periods here.
  // Each distinct framework level must reach structural + Fibonacci validation
  // before any overlap/deduplication decision is made.
  const unique = [];

  candidates.forEach((candidate) => {
    const duplicateIndex = unique.findIndex((existing) =>
      Number(existing.sourceIndex) === Number(candidate.sourceIndex) &&
      String(existing.originalType || "") ===
        String(candidate.originalType || "") &&
      Math.abs(
        Number(existing.frameworkPrice) -
        Number(candidate.frameworkPrice)
      ) <= Math.max(Number.EPSILON * 100, tolerance * 0.02)
    );

    if (duplicateIndex < 0) {
      unique.push(candidate);
      return;
    }

    const existing = unique[duplicateIndex];

    const existingDiff = Number.isFinite(
      Number(existing.reconciliationDifference)
    )
      ? Number(existing.reconciliationDifference)
      : Number.POSITIVE_INFINITY;

    const candidateDiff = Number.isFinite(
      Number(candidate.reconciliationDifference)
    )
      ? Number(candidate.reconciliationDifference)
      : Number.POSITIVE_INFINITY;

    if (
      candidate.chartReconciled === true &&
      (
        existing.chartReconciled !== true ||
        candidateDiff < existingDiff
      )
    ) {
      unique[duplicateIndex] = candidate;
    }
  });

  unique.sort(
    (a, b) =>
      Number(a.frameworkPrice) - Number(b.frameworkPrice)
  );

  console.log("CSA selector v2 framework candidates:", {
    selectorVersion: CSA_SELECTOR_VERSION,
    timeframe,
    direction,
    candidates: unique.map((candidate) => ({
      period: candidate.period,
      originalType: candidate.originalType,
      finalType: candidate.type,
      frameworkPrice: candidate.frameworkPrice,
      chartPrice: candidate.price,
      chartReconciled: candidate.chartReconciled === true,
      reconciliationDifference: candidate.reconciliationDifference,
      flipCount: candidate.lifecycleFlipCount,
      conversionBreakConfirmed:
        candidate.conversionBreakConfirmed === true,
      conversionConfirmed: candidate.conversionConfirmed === true,
    })),
  });

  return unique;
}
function attachPivotConfirmationToFrameworkCandidates({
  frameworkCandidates = [],
  pivots = [],
  atr = 0,
  symbol = "",
}) {
  const tolerance = Math.max(
    getApprovedPriceTolerance(symbol) * 3,
    Number(atr || 0) * 0.12
  );

  return frameworkCandidates.map((candidate) => {
    const matchingPivots = pivots.filter(
      (pivot) =>
        Number.isFinite(Number(pivot?.price)) &&
        Math.abs(Number(pivot.price) - Number(candidate.price)) <= tolerance
    );

    return {
      ...candidate,
      pivotConfirmationCount: matchingPivots.length,
      confirmingPivotPrices: matchingPivots.map((pivot) =>
        Number(pivot.price)
      ),
    };
  });
}

function rankRawEntryAreas({
  visualReview = {},
  marketReference = {},
  historicalPhase = null,
  direction = "range",
  currentPrice = null,
  symbol = "",
  timeframe = "H1",
}) {
  if (!["bullish", "bearish"].includes(direction)) {
    return { areas: [], validation: { passed: true, errors: [] } };
  }

  const candles =
    Array.isArray(
      marketReference
        ?.timeframeCandles
    )
      ? marketReference
          .timeframeCandles
          .filter(
            (candle) =>
              candle?.datetime &&
              Number.isFinite(
                Number(candle?.open)
              ) &&
              Number.isFinite(
                Number(candle?.high)
              ) &&
              Number.isFinite(
                Number(candle?.low)
              ) &&
              Number.isFinite(
                Number(candle?.close)
              )
          )
          .sort((a, b) =>
            String(
              a.datetime
            ).localeCompare(
              String(
                b.datetime
              )
            )
          )
      : [];

  const impulseCandles =
    Array.isArray(
      marketReference
        ?.impulseCandles
    ) &&
    marketReference
      .impulseCandles
      .length
      ? marketReference
          .impulseCandles
          .filter(
            (candle) =>
              candle?.datetime &&
              Number.isFinite(
                Number(candle?.open)
              ) &&
              Number.isFinite(
                Number(candle?.high)
              ) &&
              Number.isFinite(
                Number(candle?.low)
              ) &&
              Number.isFinite(
                Number(candle?.close)
              )
          )
          .sort((a, b) =>
            String(
              a.datetime
            ).localeCompare(
              String(
                b.datetime
              )
            )
          )
      : candles;

  if (
    !candles.length ||
    !impulseCandles.length ||
    !Number.isFinite(
      Number(currentPrice)
    )
  ) {
    return {
      areas: [],
      validation: {
        passed: false,
        errors: ["missing_cutoff_filtered_market_data"],
      },
    };
  }

  const config = getAreaEngineConfig(timeframe);
  const recentCandles = candles.slice(-config.lookback);
  const atr = averageTrueRange(
    candles,
    getStructureEngineConfig(timeframe).atrPeriod
  );
  const priceTolerance = getApprovedPriceTolerance(symbol);

  const sideGap = Math.max(
    priceTolerance,
    Number(atr || 0) * 0.06
  );

  // Narrower clustering prevents unrelated levels from becoming one wide area.
  const clusterDistance = Math.max(
    priceTolerance * 3,
    Number(atr || 0) * 0.22
  );

  const pivotConfig = {
    pivotLeft: config.pivotLeft,
    pivotRight: config.pivotRight,
  };

  const confirmedPivots = detectConfirmedSwingPivots(
    candles,
    pivotConfig
  );

  // Authoritative framework periods are the only source allowed to create
  // entry candidates. Generic pivots and chart markings may confirm/refine
  // them, but may not replace them.
  const frameworkCandidates = attachPivotConfirmationToFrameworkCandidates({
    frameworkCandidates: buildAuthoritativeFrameworkCandidates({
      marketReference,
      visualReview,
      direction,
      currentPrice,
      symbol,
      timeframe,
      atr,
    }),
    pivots: confirmedPivots,
    atr,
    symbol,
  });

  const fibonacci =
    buildLatestImpulseFibonacci({
    candles: impulseCandles,
    historicalPhase,
    direction,
    timeframe,
    symbol,
    chartNativeImpulse:
      visualReview?.chartNativeImpulse || null,
  });

  const rawZones = frameworkCandidates.map((candidate) => {
    const resolvedEntryPrice = resolveCsaEntryPrice({
      frameworkPrice: candidate.frameworkPrice,
      chartPrice: candidate.price,
      chartReconciled: candidate.chartReconciled === true,
      symbol,
    });

    return {
      // Framework period identity remains authoritative. The final level price
      // may be refined only by validated same-period chart reconciliation.
      zoneLow: resolvedEntryPrice,
      zoneHigh: resolvedEntryPrice,
      resolvedEntryPrice,
      members: [candidate],
      source: candidate.source,
      authoritativeType: candidate.type,
      conversionBreakConfirmed:
        candidate.conversionBreakConfirmed === true,
      conversionConfirmed: candidate.conversionConfirmed === true,
      lifecycleFlipCount: Number(candidate.lifecycleFlipCount || 0),
      lifecycleEvents: Array.isArray(candidate.lifecycleEvents)
        ? candidate.lifecycleEvents
        : [],
      sourceIndex: Number.isInteger(candidate.sourceIndex)
        ? candidate.sourceIndex
        : -1,
      period: candidate.period || null,
      breakPeriod: candidate.breakPeriod || null,
      pivotConfirmationCount: Number(
        candidate.pivotConfirmationCount || 0
      ),
    };
  });

  const fibGateDiagnostics = [];
  const structuralGateDiagnostics = [];
  const structuralReferenceAreas = [];

  const evaluated = rawZones.map((rawZone) => {
    const compacted = compactZoneBounds({
      rawLow: rawZone.zoneLow,
      rawHigh: rawZone.zoneHigh,
      members: rawZone.members,
      atr,
      priceTolerance,
      preferredCenter: rawZone.resolvedEntryPrice,
    });

    const zoneLow = compacted.zoneLow;
    const zoneHigh = compacted.zoneHigh;

    const frameworkCenter =
      asPositiveNumber(rawZone?.members?.[0]?.frameworkPrice) ||
      compacted.center;

    const chartReconciledCenter =
      asPositiveNumber(rawZone?.members?.[0]?.price) ||
      compacted.center;

    const authoritativeCenter =
      asPositiveNumber(rawZone?.resolvedEntryPrice) ||
      frameworkCenter;

    const reactionTolerance = Math.max(
      priceTolerance,
      Number(atr || 0) * 0.08
    );

    const reactionStats = countZoneReactions({
      candles: recentCandles,
      zoneLow,
      zoneHigh,
      atr,
      tolerance: reactionTolerance,
      reactionBars: config.reactionBars,
    });

    const distinctSources = new Set(
      (rawZone.members || []).map((member) => member.source)
    ).size;
    const memberCount = (rawZone.members || []).length;

    const isAuthoritativeFrameworkLevel =
      String(rawZone?.source || "").startsWith(
        "authoritative_framework_"
      );

    const isConfirmedConversion =
      rawZone?.authoritativeType === "converted resistance" ||
      rawZone?.authoritativeType === "converted support";

    const candidatePrice = Number(
      rawZone?.members?.[0]?.frameworkPrice ||
      rawZone?.members?.[0]?.price
    );

    const laterCandles = getCandlesAfterFrameworkPeriod({
      marketReference,
      levels: Array.isArray(marketReference?.dailyLevels)
        ? marketReference.dailyLevels
        : [],
      sourceIndex: Number(rawZone?.sourceIndex ?? -1),
      timeframe,
    });

    const sideChangeCount = countLevelSideChanges({
      candles: laterCandles,
      levelPrice: candidatePrice,
      tolerance: Math.max(
        priceTolerance,
        Number(atr || 0) * 0.06
      ),
    });

    // Structural validity is deliberately assessed WITHOUT Fibonacci.
    // Fibonacci is not allowed to rescue or create a weak level.
    const quality = selectorAreaQuality({
      areaType: rawZone?.authoritativeType,
      lifecycleFlipCount: Number(
        rawZone?.lifecycleFlipCount || 0
      ),
      lifecycleEvents: Array.isArray(rawZone?.lifecycleEvents)
        ? rawZone.lifecycleEvents
        : [],
      sideChangeCount,
      reactionStats,
      pivotConfirmationCount: Number(
        rawZone?.pivotConfirmationCount || 0
      ),
      fibonacciScore: 0,
    });

    /*
     * V4.5.4 — RE-EARNED STRUCTURAL STRENGTH
     *
     * A historically busy authoritative S/R area is not automatically a
     * strong entry area. However, it may re-earn strong structural status
     * when current evidence shows:
     *   - at least 2 genuine reactions, AND
     *   - at least 1 strong departure.
     *
     * Fibonacci distance rules remain unchanged:
     *   <= 15% ATR = close confluence
     *   15–20% ATR = borderline, requires strong structure
     *   > 20% ATR = fail
     */
    const cleanStrongStructure =
      quality.choppy !== true &&
      Number(quality.score || 0) >= 50;

    const reEarnedStrongStructure =
      quality.valid === true &&
      Number(reactionStats?.reactions || 0) >= 2 &&
      Number(reactionStats?.strongDepartures || 0) >= 1;

    const structuralEvidenceStrong =
      cleanStrongStructure ||
      reEarnedStrongStructure;

    const structuralStrengthMode =
      cleanStrongStructure
        ? "clean_high_quality"
        : reEarnedStrongStructure
        ? "reearned_by_reactions_and_departure"
        : "not_strong";

    const structurallyValid =
      isAuthoritativeFrameworkLevel &&
      quality.valid;

    structuralGateDiagnostics.push({
      frameworkPrice:
        asPositiveNumber(rawZone?.members?.[0]?.frameworkPrice) ||
        authoritativeCenter,
      chartReconciledPrice:
        asPositiveNumber(rawZone?.members?.[0]?.price),
      areaType: rawZone?.authoritativeType || null,
      frameworkPeriod:
        rawZone?.period ||
        rawZone?.members?.[0]?.period ||
        null,
      lifecycleFlipCount: Number(rawZone?.lifecycleFlipCount || 0),
      sideChangeCount,
      reactionCount: Number(reactionStats?.reactions || 0),
      strongDepartureCount: Number(reactionStats?.strongDepartures || 0),
      pivotConfirmationCount: Number(rawZone?.pivotConfirmationCount || 0),
      conversionBreakConfirmed:
        rawZone?.conversionBreakConfirmed === true,
      structurallyValid,
      qualityReason: quality.reason,
      qualityScore: quality.score,
      choppy: quality.choppy,
      cleanStrongStructure,
      reEarnedStrongStructure,
      structuralEvidenceStrong,
      structuralStrengthMode,
    });

    if (!structurallyValid) return null;

    const areaType = classifyValidatedArea({
      direction,
      zoneLow,
      zoneHigh,
      rawZone,
      historicalPhase,
      reactionStats,
      atr,
    });

    const fibConfluence = evaluateRequiredFibonacciConfluence({
      fibonacci,
      zoneLow,
      zoneHigh,
      atr,
      symbol,
      structuralQualityScore: quality.score,
      structuralEvidenceStrong,
    });

    if (
      areaDirectionMatches(areaType, direction) &&
      fibConfluence.passed !== true
    ) {
      const nearestFib =
        Array.isArray(fibConfluence.evaluatedLevels) &&
        fibConfluence.evaluatedLevels.length
          ? fibConfluence.evaluatedLevels[0]
          : null;

      structuralReferenceAreas.push({
        direction: direction === "bearish" ? "sell" : "buy",
        areaType,
        zoneLow,
        zoneHigh,
        authoritativeCenter,
        levelText: formatPrice(authoritativeCenter, symbol),
        zoneText: `around ${formatPrice(authoritativeCenter, symbol)}`,
        frameworkPeriod:
          rawZone?.period ||
          rawZone?.members?.[0]?.period ||
          null,
        structuralScore: Number(quality.score || 0),
        distanceFromPrice:
          Math.abs(authoritativeCenter - Number(currentPrice)),
        fibPassed: false,
        nearestFibLabel: nearestFib?.label || null,
        nearestFibPrice:
          Number.isFinite(Number(nearestFib?.price))
            ? Number(nearestFib.price)
            : null,
        fibDistance:
          Number.isFinite(Number(nearestFib?.distanceToZone))
            ? Number(nearestFib.distanceToZone)
            : null,
        fibDistanceAsAtrPercent:
          Number.isFinite(Number(nearestFib?.distanceAsAtrPercent))
            ? Number(nearestFib.distanceAsAtrPercent)
            : null,
        conversionConfirmed:
          rawZone?.members?.[0]?.conversionConfirmed === true,
        referenceOnly: true,
      });
    }

    fibGateDiagnostics.push({
      frameworkPrice:
        asPositiveNumber(rawZone?.members?.[0]?.frameworkPrice) ||
        authoritativeCenter,
      chartReconciledPrice:
        asPositiveNumber(rawZone?.members?.[0]?.price),
      areaType: rawZone?.authoritativeType || null,
      frameworkPeriod:
        rawZone?.period ||
        rawZone?.members?.[0]?.period ||
        null,
      zoneLow,
      zoneHigh,
      resolvedEntryPrice: authoritativeCenter,
      frameworkCenter,
      chartReconciledCenter,
      passed: fibConfluence.passed === true,
      matchedLevels: fibConfluence.matches.map((match) => ({
        label: match.label,
        ratio: match.ratio,
        price: match.price,
        matchType: match.matchType,
        distanceToZone: match.distanceToZone,
        distanceAsAtrPercent: match.distanceAsAtrPercent,
      })),
      evaluatedFibLevels: fibConfluence.evaluatedLevels.map((match) => ({
        label: match.label,
        ratio: match.ratio,
        price: match.price,
        matchType: match.matchType,
        passed: match.passed,
        distanceToZone: match.distanceToZone,
        distanceAsAtrPercent: match.distanceAsAtrPercent,
      })),
      closeAllowance: fibConfluence.closeAllowance,
      borderlineAllowance: fibConfluence.borderlineAllowance,
      structuralQualityScore: fibConfluence.structuralQualityScore,
      strongStructure: fibConfluence.strongStructure,
      structuralStrengthMode,
      reEarnedStrongStructure,
      reactionCount: Number(reactionStats?.reactions || 0),
      strongDepartureCount: Number(reactionStats?.strongDepartures || 0),
      proximityAllowance: fibConfluence.proximityAllowance,
    });

    // HARD CSA ENTRY GATE:
    // A valid structural area without 38.2 / 50 / 61.8 proximity remains
    // market context only. It cannot become Entry 1, Entry 2 or preferred.
    if (!fibConfluence.passed) return null;

    const fibMatches = fibConfluence.matches;
    const fibonacciScore = 1;
    const structuralScore = quality.score;

    const brokenLevel = asPositiveNumber(historicalPhase?.brokenLevel);
    const conversionTolerance = Math.max(
      Number(atr || 0) * 0.12,
      Math.abs(zoneHigh - zoneLow) * 0.75
    );

    const isConvertedArea =
      ["converted resistance", "converted support"].includes(areaType);

    const conversionBreakConfirmed =
      !isConvertedArea ||
      rawZone?.conversionBreakConfirmed === true ||
      (
        brokenLevel !== null &&
        brokenLevel >= zoneLow - conversionTolerance &&
        brokenLevel <= zoneHigh + conversionTolerance &&
        (
          historicalPhase?.bearishBreakdown === true ||
          historicalPhase?.bullishBreakout === true ||
          historicalPhase?.phase === "bearish_structure" ||
          historicalPhase?.phase === "bullish_structure"
        )
      );

    const conversionConfirmed =
      !isConvertedArea ||
      rawZone?.conversionConfirmed === true;

    const center = authoritativeCenter;
    const distance = Math.abs(center - Number(currentPrice));

    return {
      direction: direction === "bearish" ? "sell" : "buy",
      areaType,
      zoneLow,
      zoneHigh,
      authoritativeCenter,
      frameworkCenter,
      chartReconciledCenter,
      // Keep the internal zone bounds for validation, but present the
      // authoritative framework level simply as "around X" to the user.
      zoneText: `around ${formatPrice(authoritativeCenter, symbol)}`,
      levelText: formatPrice(authoritativeCenter, symbol),
      state:
        isConvertedArea
          ? conversionConfirmed
            ? "confirmed conversion"
            : conversionBreakConfirmed
            ? "potential conversion"
            : "active"
          : "active",
      source: rawZone.source,
      sourceReason:
        `${areaType} validated by ${reactionStats.reactions} separated reaction(s)` +
        (reactionStats.strongDepartures
          ? ` and ${reactionStats.strongDepartures} strong departure(s).`
          : "."),
      distance,
      structuralScore,
      fibonacciScore,
      requiredFibConfluence: true,
      fibonacciConfluence: fibConfluence,
      qualityScore:
        structuralScore +
        7,
      reactionCount: reactionStats.reactions,
      strongDepartureCount: reactionStats.strongDepartures,
      fibonacciMatches: fibMatches,
      lifecycleFlipCount: Number(
        rawZone?.lifecycleFlipCount || 0
      ),
      lifecycleEvents: Array.isArray(rawZone?.lifecycleEvents)
        ? rawZone.lifecycleEvents
        : [],
      sideChangeCount,
      selectorQualityReason: quality.reason,
      selectorChoppy: quality.choppy,
      validated: true,
      conversionBreakConfirmed,
      conversionConfirmed,
      brokenLevel:
        ["converted resistance", "converted support"].includes(areaType)
          ? (
              asPositiveNumber(rawZone?.members?.[0]?.frameworkPrice) ||
              brokenLevel
            )
          : null,
      frameworkPeriod:
        rawZone?.period ||
        rawZone?.members?.[0]?.period ||
        null,
      breakPeriod:
        rawZone?.breakPeriod ||
        rawZone?.members?.[0]?.breakPeriod ||
        null,
      frameworkPrice:
        asPositiveNumber(rawZone?.members?.[0]?.frameworkPrice),
      priceSource:
        safeUserText(rawZone?.members?.[0]?.priceSource || "framework_data"),
      chartReconciled:
        rawZone?.members?.[0]?.chartReconciled === true,
      reconciliationEvidence:
        safeUserText(
          rawZone?.members?.[0]?.reconciliationEvidence || ""
        ),
      reconciliationPeriodHint:
        safeUserText(
          rawZone?.members?.[0]?.reconciliationPeriodHint || ""
        ),
      reconciliationConfidence:
        Number(rawZone?.members?.[0]?.reconciliationConfidence || 0),
      reconciliationDifference:
        Number.isFinite(
          Number(rawZone?.members?.[0]?.reconciliationDifference)
        )
          ? Number(rawZone.members[0].reconciliationDifference)
          : null,
      authoritativeFrameworkLevel: true,
      conversionSourceRule:
        ["converted resistance", "converted support"].includes(areaType)
          ? "original_csa_support_or_resistance_only"
          : "not_applicable",
    };
  });

  const sequencedResult = validateAndSequenceEntryAreas({
    areas: evaluated.filter(Boolean),
    direction,
    currentPrice,
    atr,
  });

  const regressionDiagnostics = {
    selectorVersion: CSA_SELECTOR_VERSION,
    direction,
    dataWindows: {
      framework: {
        startDate:
          marketReference
            ?.weekRange
            ?.startDate ||
          null,
        endDate:
          marketReference
            ?.weekRange
            ?.endDate ||
          null,
        candleCount:
          candles.length,
      },
      impulse: {
        startDate:
          marketReference
            ?.impulseRange
            ?.startDate ||
          null,
        endDate:
          marketReference
            ?.impulseRange
            ?.endDate ||
          null,
        lookbackDays:
          marketReference
            ?.impulseRange
            ?.lookbackDays ||
          null,
        candleCount:
          impulseCandles.length,
      },
      sameHistoricalCutoff:
        true,
    },
    fibonacci: {
      priceSource:
        fibonacci?.priceSource || "external_ohlc",
      chartNativeConfidence:
        fibonacci?.chartNativeConfidence || null,
      pixelCalibrationUsed:
        fibonacci?.priceSource ===
        "uploaded_chart_pixel_calibration",
      swingLow:
        fibonacci?.swingLow ?? null,
      swingHigh:
        fibonacci?.swingHigh ?? null,
      swingLowTime:
        fibonacci?.swingLowTime || null,
      swingHighTime:
        fibonacci?.swingHighTime || null,
      marketDataSwingLow:
        fibonacci?.marketDataSwingLow ?? null,
      marketDataSwingHigh:
        fibonacci?.marketDataSwingHigh ?? null,
      protectedSwing:
        fibonacci?.protectedSwing || null,
      outerStructuralOrigin:
        fibonacci
          ?.outerStructuralOrigin ||
        null,
      fibOriginModel:
        fibonacci
          ?.fibOriginModel ||
        null,
      brokenMajorLevel:
        fibonacci?.brokenMajorLevel || null,
      majorBreakCandidateCount:
        Number(
          fibonacci?.majorBreakCandidateCount || 0
        ),
      retracementLevels:
        Array.isArray(fibonacci?.levels)
          ? fibonacci.levels.map((level) => ({
              label: level.label,
              ratio: level.ratio,
              price: level.price,
            }))
          : [],
      selectionReason:
        fibonacci?.selectionReason || null,
      source:
        fibonacci?.source || null,
    },
    structuralCandidates:
      structuralGateDiagnostics.map((candidate) => ({
        frameworkPrice:
          candidate.frameworkPrice ?? null,
        chartReconciledPrice:
          candidate.chartReconciledPrice ?? null,
        areaType:
          candidate.areaType || null,
        frameworkPeriod:
          candidate.frameworkPeriod || null,
        structurallyValid:
          candidate.structurallyValid === true,
        qualityReason:
          candidate.qualityReason || null,
        qualityScore:
          Number(candidate.qualityScore || 0),
        lifecycleFlipCount:
          Number(candidate.lifecycleFlipCount || 0),
        sideChangeCount:
          Number(candidate.sideChangeCount || 0),
        reactionCount:
          Number(candidate.reactionCount || 0),
        strongDepartureCount:
          Number(candidate.strongDepartureCount || 0),
        conversionBreakConfirmed:
          candidate.conversionBreakConfirmed === true,
      })),
    fibCandidates:
      fibGateDiagnostics.map((candidate) => ({
        frameworkPrice:
          candidate.frameworkPrice ?? null,
        chartReconciledPrice:
          candidate.chartReconciledPrice ?? null,
        areaType:
          candidate.areaType || null,
        frameworkPeriod:
          candidate.frameworkPeriod || null,
        zoneLow:
          candidate.zoneLow ?? null,
        zoneHigh:
          candidate.zoneHigh ?? null,
        resolvedEntryPrice:
          candidate.resolvedEntryPrice ?? null,
        passed:
          candidate.passed === true,
        matchedLevels:
          Array.isArray(candidate.matchedLevels)
            ? candidate.matchedLevels
            : [],
        evaluatedFibLevels:
          Array.isArray(candidate.evaluatedFibLevels)
            ? candidate.evaluatedFibLevels
            : [],
        closeAllowance:
          candidate.closeAllowance ?? null,
        borderlineAllowance:
          candidate.borderlineAllowance ?? null,
        structuralQualityScore:
          candidate.structuralQualityScore ?? null,
        strongStructure:
          candidate.strongStructure === true,
        proximityAllowance:
          candidate.proximityAllowance ?? null,
      })),
    selectedEntries:
      (sequencedResult?.areas || []).map((area) => ({
        executionOrder:
          Number(area.executionOrder || 0),
        direction:
          area.direction || null,
        areaType:
          area.areaType || null,
        levelText:
          area.levelText || null,
        authoritativeCenter:
          area.authoritativeCenter ?? null,
        frameworkCenter:
          area.frameworkCenter ?? null,
        chartReconciledCenter:
          area.chartReconciledCenter ?? null,
        frameworkPeriod:
          area.frameworkPeriod || null,
        state:
          area.state || null,
        conversionConfirmed:
          area.conversionConfirmed === true,
        fibonacciMatches:
          (area.fibonacciMatches || []).map((match) => ({
            label:
              match.label || null,
            price:
              match.price ?? null,
            matchType:
              match.matchType || null,
          })),
      })),
  };

  console.log("CSA v4.5.5 structural-strength decision:", {
    buildId: CSA_BUILD_ID,
    direction,
    initializationOrder: "strength_before_structural_diagnostics",
    rule:
      "15_20pct_atr_borderline_requires_clean_or_reearned_strong_structure",
    fibCandidates: fibGateDiagnostics.map((candidate) => ({
      level:
        candidate.resolvedEntryPrice ??
        candidate.frameworkPrice ??
        null,
      areaType: candidate.areaType || null,
      frameworkPeriod: candidate.frameworkPeriod || null,
      passed: candidate.passed === true,
      structuralQualityScore:
        candidate.structuralQualityScore ?? null,
      structuralStrengthMode:
        candidate.structuralStrengthMode || null,
      reEarnedStrongStructure:
        candidate.reEarnedStrongStructure === true,
      reactionCount:
        candidate.reactionCount ?? null,
      strongDepartureCount:
        candidate.strongDepartureCount ?? null,
      matchedLevels:
        candidate.matchedLevels || [],
      evaluatedFibLevels:
        candidate.evaluatedFibLevels || [],
      closeAllowance:
        candidate.closeAllowance ?? null,
      borderlineAllowance:
        candidate.borderlineAllowance ?? null,
    })),
    selectedEntries:
      (sequencedResult?.areas || []).map((area) => ({
        executionOrder:
          Number(area.executionOrder || 0),
        levelText: area.levelText || null,
        areaType: area.areaType || null,
        structuralStrengthMode:
          area.structuralStrengthMode || null,
        fibonacciMatches:
          area.fibonacciMatches || [],
      })),
  });

  console.log("CSA regression snapshot:", regressionDiagnostics);

  console.log("CSA selector v3 structural gate:", {
    selectorVersion: CSA_SELECTOR_VERSION,
    direction,
    candidates: structuralGateDiagnostics,
  });

  console.log("CSA selector v3 Fibonacci entry gate:", {
    selectorVersion: CSA_SELECTOR_VERSION,
    fibProximityModel: "adaptive_atr_15_20_percent_reearned_structure",
    impulseModel: "structural_hierarchy_outer_break_with_protected_swing_and_timestamp_targeted_pixel_wicks",
    frameworkPriceModel: "same_period_exact_chart_label_priority",
    direction,
    fibonacciPriceSource:
      fibonacci?.priceSource || "external_ohlc",
    chartNativeConfidence:
      fibonacci?.chartNativeConfidence || null,
    pixelCalibrationUsed:
      fibonacci?.priceSource ===
      "uploaded_chart_pixel_calibration",
    wickMappingModel:
      "timestamp_targeted_independent_origin_terminal",
    protectedSwing:
      fibonacci?.protectedSwing || null,
    outerStructuralOrigin:
      fibonacci
        ?.outerStructuralOrigin ||
      null,
    fibOriginModel:
      fibonacci
        ?.fibOriginModel ||
      null,
    brokenMajorLevel:
      fibonacci?.brokenMajorLevel || null,
    majorBreakCandidateCount:
      Number(
        fibonacci?.majorBreakCandidateCount || 0
      ),
    majorBreakSelectionModel:
      "independent_pivot_break_scan_plus_outer_structural_hierarchy",
    marketDataSwingLow:
      fibonacci?.marketDataSwingLow ?? null,
    marketDataSwingHigh: fibonacci?.marketDataSwingHigh ?? null,
    swingLow: fibonacci?.swingLow ?? null,
    swingHigh: fibonacci?.swingHigh ?? null,
    retracementLevels: Array.isArray(fibonacci?.levels)
      ? fibonacci.levels.map((level) => ({
          label: level.label,
          ratio: level.ratio,
          price: level.price,
        }))
      : [],
    candidates: fibGateDiagnostics,
    selectedEntries: (sequencedResult?.areas || []).map((area) => ({
      executionOrder: area.executionOrder,
      areaType: area.areaType,
      levelText: area.levelText,
      authoritativeCenter: area.authoritativeCenter,
      frameworkCenter: area.frameworkCenter,
      chartReconciledCenter: area.chartReconciledCenter,
      chartReconciled: area.chartReconciled === true,
      reconciliationDifference: area.reconciliationDifference,
      frameworkPeriod: area.frameworkPeriod,
      fibonacciMatches: (area.fibonacciMatches || []).map((match) => ({
        label: match.label,
        price: match.price,
        matchType: match.matchType,
      })),
    })),
  });

  const referenceAreas = structuralReferenceAreas
    .sort((a, b) => {
      if (a.distanceFromPrice !== b.distanceFromPrice) {
        return a.distanceFromPrice - b.distanceFromPrice;
      }
      return Number(b.structuralScore || 0) - Number(a.structuralScore || 0);
    })
    .slice(0, 3);

  return {
    ...sequencedResult,
    referenceAreas,
    regressionDiagnostics,
  };
}

function normalizeBreakoutState(visualReview = {}, chartDetection = {}) {
  const combined = [
    visualReview?.visualSummary,
    visualReview?.plainMarketDirection,
    visualReview?.shortTermDirection,
    visualReview?.entryEvidence,
    visualReview?.mainWarning,
    visualReview?.coachVerdict,
    chartDetection?.visibleTrigger,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const bullishBreakout =
    /bullish breakout|breakout above|broke above|clean break above|strong bullish continuation|bullish continuation/.test(combined);

  const bearishBreakdown =
    /bearish breakdown|breakdown below|broke below|clean break below|strong bearish continuation|bearish continuation/.test(combined);

  const extended =
    /extended|already moved|already rallied|already dropped|close to resistance|near resistance|close to support|near support/.test(combined);

  return {
    bullishBreakout,
    bearishBreakdown,
    extended,
    state: bullishBreakout
      ? "bullish_breakout"
      : bearishBreakdown
      ? "bearish_breakdown"
      : "none",
  };
}

function breakoutOverridesRange({
  verifiedMarketDirection,
  visualDirection,
  breakoutState,
}) {
  if (
    breakoutState?.bullishBreakout &&
    verifiedMarketDirection === "range" &&
    ["range", "bullish"].includes(visualDirection)
  ) {
    return "bullish";
  }

  if (
    breakoutState?.bearishBreakdown &&
    verifiedMarketDirection === "range" &&
    ["range", "bearish"].includes(visualDirection)
  ) {
    return "bearish";
  }

  return null;
}


function normalizeTransitionState(visualReview = {}, chartDetection = {}) {
  const explicitPhase = String(visualReview?.marketPhase || "")
    .trim()
    .toLowerCase();

  const combined = [
    explicitPhase,
    visualReview?.visualSummary,
    visualReview?.plainMarketDirection,
    visualReview?.shortTermDirection,
    visualReview?.whatThisMeans,
    visualReview?.entryEvidence,
    visualReview?.mainWarning,
    visualReview?.coachVerdict,
    chartDetection?.visibleTrigger,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const bullishRecovery =
    /bullish recovery after bearish breakdown|strong bullish recovery|sharp bullish recovery|recovery from (?:the )?(?:low|support)|rebounded strongly|strong rebound/.test(
      combined
    );

  const bearishPullback =
    /bearish pullback after bullish breakout|strong bearish pullback|sharp bearish pullback|pullback from (?:the )?(?:high|resistance)|sold off sharply|strong rejection lower/.test(
      combined
    );

  const priorBearishBreak =
    /bearish breakdown|breakdown below|broke below|clean break below|lower low|deep low/.test(
      combined
    );

  const priorBullishBreak =
    /bullish breakout|breakout above|broke above|clean break above|higher high|new high/.test(
      combined
    );

  const bullishRecoveryAfterBreakdown =
    bullishRecovery &&
    (priorBearishBreak ||
      explicitPhase === "bullish recovery after bearish breakdown");

  const bearishPullbackAfterBreakout =
    bearishPullback &&
    (priorBullishBreak ||
      explicitPhase === "bearish pullback after bullish breakout");

  return {
    bullishRecoveryAfterBreakdown,
    bearishPullbackAfterBreakout,
    state: bullishRecoveryAfterBreakdown
      ? "bullish_recovery_after_bearish_breakdown"
      : bearishPullbackAfterBreakout
      ? "bearish_pullback_after_bullish_breakout"
      : "none",
  };
}


function normalizeDateOnlyValue(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return match ? match[1] : null;
}

function isSelectedDateBeforeVisibleEnd({
  selectedDate,
  latestVisibleDate,
}) {
  const selected = normalizeDateOnlyValue(selectedDate);
  const visible = normalizeDateOnlyValue(latestVisibleDate);

  return Boolean(selected && visible && selected < visible);
}

function getHistoricalCutoffState({
  analysisType = "post-trade",
  selectedDate = "",
  chartDetection = {},
  marketReference = {},
}) {
  const latestVisibleDate =
    normalizeDateOnlyValue(chartDetection?.latestVisibleDate) ||
    normalizeDateOnlyValue(marketReference?.chartCutoff?.latestVisibleDate) ||
    null;

  const selectedDateOnly = normalizeDateOnlyValue(selectedDate);
  const active = isSelectedDateBeforeVisibleEnd({
    selectedDate: selectedDateOnly,
    latestVisibleDate,
  });

  return {
    active,
    mode: String(analysisType || "").toLowerCase() === "pre-trade"
      ? "pre_trade_decision_cutoff"
      : "post_trade_historical_cutoff",
    selectedDate: selectedDateOnly,
    latestVisibleDate,
    reason: active
      ? "The selected historical date is earlier than the final date visible in the screenshot."
      : null,
  };
}

function historicalMoveThreshold(symbol = "", referencePrice = 0) {
  const tolerance = getCleanBreakTolerance(symbol);
  const price = Number(referencePrice);

  if (!Number.isFinite(price) || price <= 0) {
    return tolerance * 3;
  }

  const compact = comparableInstrument(symbol);

  if (compact.includes("XAU")) return Math.max(tolerance * 3, price * 0.0012);
  if (compact.includes("BTC")) return Math.max(tolerance * 3, price * 0.004);
  if (compact.includes("JPY")) return Math.max(tolerance * 3, price * 0.0007);

  return Math.max(tolerance * 3, price * 0.0007);
}

function periodRangePosition(period = {}) {
  const high = Number(period?.high);
  const low = Number(period?.low);
  const close = Number(period?.close);

  if (
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    high <= low
  ) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, (close - low) / (high - low)));
}

function maxFinite(values = []) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function minFinite(values = []) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : null;
}

function priorPeriodBoundary(levels = [], currentIndex, side = "high") {
  if (!Array.isArray(levels) || currentIndex <= 0) return null;

  const prior = levels.slice(0, currentIndex);
  return side === "low"
    ? minFinite(prior.map((item) => item?.low))
    : maxFinite(prior.map((item) => item?.high));
}

function periodBreakState({
  levels = [],
  index,
  symbol = "",
}) {
  const current = levels[index];

  if (!current || index <= 0) {
    return {
      bullishBreakout: false,
      bearishBreakdown: false,
      priorResistance: null,
      priorSupport: null,
    };
  }

  const priorResistance = priorPeriodBoundary(levels, index, "high");
  const priorSupport = priorPeriodBoundary(levels, index, "low");
  const tolerance = getCleanBreakTolerance(symbol);

  const high = Number(current.high);
  const low = Number(current.low);
  const close = Number(current.close);

  return {
    bullishBreakout:
      Number.isFinite(priorResistance) &&
      Number.isFinite(high) &&
      Number.isFinite(close) &&
      high > priorResistance + tolerance &&
      close > priorResistance + tolerance * 0.25,
    bearishBreakdown:
      Number.isFinite(priorSupport) &&
      Number.isFinite(low) &&
      Number.isFinite(close) &&
      low < priorSupport - tolerance &&
      close < priorSupport - tolerance * 0.25,
    priorResistance,
    priorSupport,
  };
}


function findMostRecentStructuralBreak({
  levels = [],
  beforeIndex,
  symbol = "",
  side = "bearish",
  maxLookback = 5,
}) {
  if (!Array.isArray(levels) || beforeIndex <= 0) return null;

  const startIndex = Math.max(1, beforeIndex - maxLookback);

  for (let index = beforeIndex; index >= startIndex; index -= 1) {
    const state = periodBreakState({ levels, index, symbol });

    if (side === "bearish" && state.bearishBreakdown) {
      return {
        index,
        level: state.priorSupport,
        period: levels[index],
      };
    }

    if (side === "bullish" && state.bullishBreakout) {
      return {
        index,
        level: state.priorResistance,
        period: levels[index],
      };
    }
  }

  return null;
}


function candleTrueRange(candle = {}, previousClose = null) {
  const high = Number(candle?.high);
  const low = Number(candle?.low);
  const close = Number(previousClose);

  if (!Number.isFinite(high) || !Number.isFinite(low)) return 0;
  if (!Number.isFinite(close)) return Math.max(0, high - low);

  return Math.max(
    high - low,
    Math.abs(high - close),
    Math.abs(low - close)
  );
}

function averageTrueRange(candles = [], period = 14) {
  if (!Array.isArray(candles) || candles.length < 2) return 0;

  const start = Math.max(1, candles.length - period);
  const ranges = [];

  for (let index = start; index < candles.length; index += 1) {
    ranges.push(
      candleTrueRange(candles[index], candles[index - 1]?.close)
    );
  }

  if (!ranges.length) return 0;
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function rollingBoundary(candles = [], endIndex, lookback, side = "high") {
  const start = Math.max(0, endIndex - lookback);
  const subset = candles.slice(start, endIndex);

  if (!subset.length) return null;

  return side === "low"
    ? minFinite(subset.map((candle) => candle?.low))
    : maxFinite(subset.map((candle) => candle?.high));
}

function recentCloseSlope(candles = [], count = 5) {
  const recent = candles.slice(-Math.max(2, count));
  if (recent.length < 2) return 0;

  const first = Number(recent[0]?.close);
  const last = Number(recent[recent.length - 1]?.close);

  return Number.isFinite(first) && Number.isFinite(last)
    ? last - first
    : 0;
}

function getStructureEngineConfig(timeframe = "H1") {
  const tf = comparableTimeframe(timeframe) || "H1";

  const configs = {
    M1:  { pivotLeft: 3, pivotRight: 3, atrPeriod: 20, eventLookback: 220, recoveryBars: 30, confirmationCloses: 2 },
    M5:  { pivotLeft: 3, pivotRight: 3, atrPeriod: 18, eventLookback: 200, recoveryBars: 26, confirmationCloses: 2 },
    M15: { pivotLeft: 3, pivotRight: 3, atrPeriod: 16, eventLookback: 180, recoveryBars: 22, confirmationCloses: 2 },
    M30: { pivotLeft: 3, pivotRight: 3, atrPeriod: 16, eventLookback: 160, recoveryBars: 20, confirmationCloses: 2 },
    H1:  { pivotLeft: 3, pivotRight: 3, atrPeriod: 14, eventLookback: 140, recoveryBars: 18, confirmationCloses: 2 },
    H4:  { pivotLeft: 2, pivotRight: 2, atrPeriod: 14, eventLookback: 110, recoveryBars: 14, confirmationCloses: 2 },
    D1:  { pivotLeft: 2, pivotRight: 2, atrPeriod: 14, eventLookback: 90,  recoveryBars: 10, confirmationCloses: 2 },
    W1:  { pivotLeft: 1, pivotRight: 1, atrPeriod: 12, eventLookback: 70,  recoveryBars: 8,  confirmationCloses: 1 },
    MN:  { pivotLeft: 1, pivotRight: 1, atrPeriod: 12, eventLookback: 60,  recoveryBars: 6,  confirmationCloses: 1 },
  };

  return { timeframe: tf, ...(configs[tf] || configs.H1) };
}

function detectConfirmedSwingPivots(candles = [], config = {}) {
  const left = Math.max(1, Number(config.pivotLeft || 2));
  const right = Math.max(1, Number(config.pivotRight || 2));
  const pivots = [];

  for (let index = left; index < candles.length - right; index += 1) {
    const high = Number(candles[index]?.high);
    const low = Number(candles[index]?.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;

    let isHigh = true;
    let isLow = true;

    for (let offset = 1; offset <= left; offset += 1) {
      isHigh = isHigh && high > Number(candles[index - offset]?.high);
      isLow = isLow && low < Number(candles[index - offset]?.low);
    }

    for (let offset = 1; offset <= right; offset += 1) {
      isHigh = isHigh && high >= Number(candles[index + offset]?.high);
      isLow = isLow && low <= Number(candles[index + offset]?.low);
    }

    // The pivot only becomes usable after the right-side confirmation bars.
    const confirmedAtIndex = index + right;

    if (isHigh) {
      pivots.push({
        type: "resistance",
        pivotIndex: index,
        confirmedAtIndex,
        price: high,
        datetime: candles[index]?.datetime || null,
      });
    }

    if (isLow) {
      pivots.push({
        type: "support",
        pivotIndex: index,
        confirmedAtIndex,
        price: low,
        datetime: candles[index]?.datetime || null,
      });
    }
  }

  return pivots.sort(
    (a, b) =>
      a.confirmedAtIndex - b.confirmedAtIndex ||
      a.pivotIndex - b.pivotIndex
  );
}

function countConsecutiveBreakCloses({
  candles = [],
  index,
  level,
  tolerance,
  side,
  count = 2,
}) {
  const required = Math.max(1, Number(count || 1));
  if (index - required + 1 < 0) return false;

  for (let offset = 0; offset < required; offset += 1) {
    const close = Number(candles[index - offset]?.close);
    if (!Number.isFinite(close)) return false;

    if (side === "bullish" && close <= level + tolerance) return false;
    if (side === "bearish" && close >= level - tolerance) return false;
  }

  return true;
}


function isStrongDisplacementBreak({
  candles = [],
  index,
  level,
  tolerance,
  atr,
  side,
  timeframe = "H1",
}) {
  const candle = candles[index];
  if (!candle) return false;

  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);

  if (![open, high, low, close, level].every(Number.isFinite)) {
    return false;
  }

  const range = Math.max(0, high - low);
  const body = Math.abs(close - open);

  if (range <= 0 || !Number.isFinite(atr) || atr <= 0) {
    return false;
  }

  const tf = comparableTimeframe(timeframe) || "H1";

  // Higher timeframes need to recognise decisive displacement promptly,
  // while lower timeframes use stricter body/extension requirements.
  const settings = {
    M1:  { bodyAtr: 1.10, extensionAtr: 0.42, closeExtreme: 0.82 },
    M5:  { bodyAtr: 1.05, extensionAtr: 0.40, closeExtreme: 0.80 },
    M15: { bodyAtr: 1.00, extensionAtr: 0.38, closeExtreme: 0.79 },
    M30: { bodyAtr: 0.95, extensionAtr: 0.36, closeExtreme: 0.78 },
    H1:  { bodyAtr: 0.90, extensionAtr: 0.34, closeExtreme: 0.77 },
    H4:  { bodyAtr: 0.80, extensionAtr: 0.30, closeExtreme: 0.75 },
    D1:  { bodyAtr: 0.78, extensionAtr: 0.28, closeExtreme: 0.74 },
    W1:  { bodyAtr: 0.75, extensionAtr: 0.26, closeExtreme: 0.72 },
    MN:  { bodyAtr: 0.72, extensionAtr: 0.24, closeExtreme: 0.70 },
  };

  const config = settings[tf] || settings.H1;
  const extensionRequired = Math.max(
    tolerance * 2,
    atr * config.extensionAtr
  );

  if (side === "bullish") {
    const closePosition =
      range > 0 ? (close - low) / range : 0;

    return (
      close > open &&
      body >= atr * config.bodyAtr &&
      close > level + extensionRequired &&
      closePosition >= config.closeExtreme
    );
  }

  const closePositionFromLow =
    range > 0 ? (high - close) / range : 0;

  return (
    close < open &&
    body >= atr * config.bodyAtr &&
    close < level - extensionRequired &&
    closePositionFromLow >= config.closeExtreme
  );
}

function buildOrderedStructureEvents({
  candles = [],
  pivots = [],
  tolerance = 0,
  atr = 0,
  timeframe = "H1",
  confirmationCloses = 2,
  searchStart = 0,
}) {
  const events = [];
  const brokenPivotKeys = new Set();

  for (let index = Math.max(1, searchStart); index < candles.length; index += 1) {
    const usablePivots = pivots.filter(
      (pivot) =>
        pivot.confirmedAtIndex < index &&
        pivot.pivotIndex < index
    );

    const activeSupport = usablePivots
      .filter((pivot) => pivot.type === "support")
      .sort((a, b) => b.pivotIndex - a.pivotIndex)[0] || null;

    const activeResistance = usablePivots
      .filter((pivot) => pivot.type === "resistance")
      .sort((a, b) => b.pivotIndex - a.pivotIndex)[0] || null;

    if (activeSupport) {
      const pivotKey = `support:${activeSupport.pivotIndex}:${activeSupport.price}`;
      const standardConfirmed = countConsecutiveBreakCloses({
        candles,
        index,
        level: Number(activeSupport.price),
        tolerance,
        side: "bearish",
        count: confirmationCloses,
      });

      const displacementConfirmed = isStrongDisplacementBreak({
        candles,
        index,
        level: Number(activeSupport.price),
        tolerance,
        atr,
        side: "bearish",
        timeframe,
      });

      const confirmed = standardConfirmed || displacementConfirmed;

      if (confirmed && !brokenPivotKeys.has(pivotKey)) {
        events.push({
          side: "bearish",
          index,
          datetime: candles[index]?.datetime || null,
          level: Number(activeSupport.price),
          pivotIndex: activeSupport.pivotIndex,
          pivotDatetime: activeSupport.datetime,
          close: Number(candles[index]?.close),
          high: Number(candles[index]?.high),
          low: Number(candles[index]?.low),
          confirmationPath: displacementConfirmed
            ? "strong_displacement"
            : "multiple_closes",
        });
        brokenPivotKeys.add(pivotKey);
      }
    }

    if (activeResistance) {
      const pivotKey = `resistance:${activeResistance.pivotIndex}:${activeResistance.price}`;
      const standardConfirmed = countConsecutiveBreakCloses({
        candles,
        index,
        level: Number(activeResistance.price),
        tolerance,
        side: "bullish",
        count: confirmationCloses,
      });

      const displacementConfirmed = isStrongDisplacementBreak({
        candles,
        index,
        level: Number(activeResistance.price),
        tolerance,
        atr,
        side: "bullish",
        timeframe,
      });

      const confirmed = standardConfirmed || displacementConfirmed;

      if (confirmed && !brokenPivotKeys.has(pivotKey)) {
        events.push({
          side: "bullish",
          index,
          datetime: candles[index]?.datetime || null,
          level: Number(activeResistance.price),
          pivotIndex: activeResistance.pivotIndex,
          pivotDatetime: activeResistance.datetime,
          close: Number(candles[index]?.close),
          high: Number(candles[index]?.high),
          low: Number(candles[index]?.low),
          confirmationPath: displacementConfirmed
            ? "strong_displacement"
            : "multiple_closes",
        });
        brokenPivotKeys.add(pivotKey);
      }
    }
  }

  return events.sort((a, b) => a.index - b.index);
}

function deriveHistoricalPhaseFromTimeframeCandles({
  marketReference = {},
  symbol = "",
  timeframe = "H1",
}) {
  const candles = Array.isArray(marketReference?.timeframeCandles)
    ? marketReference.timeframeCandles
        .filter(
          (candle) =>
            candle?.datetime &&
            Number.isFinite(Number(candle?.open)) &&
            Number.isFinite(Number(candle?.high)) &&
            Number.isFinite(Number(candle?.low)) &&
            Number.isFinite(Number(candle?.close))
        )
        .sort((a, b) =>
          String(a.datetime).localeCompare(String(b.datetime))
        )
    : [];

  const config = getStructureEngineConfig(timeframe);
  const minimumCandles =
    config.pivotLeft + config.pivotRight + config.confirmationCloses + 8;

  if (candles.length < minimumCandles) return null;

  const latestIndex = candles.length - 1;
  const latest = candles[latestIndex];
  const latestClose = Number(latest.close);
  const atr = averageTrueRange(candles, config.atrPeriod);
  const baseTolerance = getCleanBreakTolerance(symbol);

  // ATR makes the same engine scale correctly from M1 through monthly charts.
  // The fixed symbol tolerance prevents tiny floating-point moves becoming breaks.
  const breakTolerance = Math.max(
    baseTolerance,
    atr * 0.12
  );

  const pivots = detectConfirmedSwingPivots(candles, config);
  const searchStart = Math.max(
    1,
    candles.length - Number(config.eventLookback || 140)
  );

  const events = buildOrderedStructureEvents({
    candles,
    pivots,
    tolerance: breakTolerance,
    atr,
    timeframe: config.timeframe,
    confirmationCloses: config.confirmationCloses,
    searchStart,
  });

  if (!events.length) return null;

  // Event order is authoritative. An older breakout can never override a newer
  // breakdown, and an older breakdown can never override a newer breakout.
  const latestEvent = events[events.length - 1];
  const latestBullishEvent =
    [...events].reverse().find((event) => event.side === "bullish") || null;
  const latestBearishEvent =
    [...events].reverse().find((event) => event.side === "bearish") || null;

  const barsAfterEvent = candles.slice(latestEvent.index);
  const postEventLow = minFinite(
    barsAfterEvent.map((candle) => candle?.low)
  );
  const postEventHigh = maxFinite(
    barsAfterEvent.map((candle) => candle?.high)
  );

  const recoveryWindow = candles.slice(
    Math.max(latestEvent.index, candles.length - config.recoveryBars)
  );
  const closeSlope = recentCloseSlope(
    recoveryWindow,
    Math.min(5, recoveryWindow.length)
  );

  const eventDiagnostics = {
    engine: "confirmed_swing_event_sequence",
    timeframe: config.timeframe,
    breakTolerance,
    atr,
    latestEvent: {
      side: latestEvent.side,
      datetime: latestEvent.datetime,
      level: latestEvent.level,
      close: latestEvent.close,
      confirmationPath: latestEvent.confirmationPath || "multiple_closes",
    },
    latestBullishEvent: latestBullishEvent
      ? {
          datetime: latestBullishEvent.datetime,
          level: latestBullishEvent.level,
          close: latestBullishEvent.close,
        }
      : null,
    latestBearishEvent: latestBearishEvent
      ? {
          datetime: latestBearishEvent.datetime,
          level: latestBearishEvent.level,
          close: latestBearishEvent.close,
        }
      : null,
    eventCount: events.length,
    finalCandle: latest.datetime || null,
    finalClose: latestClose,
  };

  if (latestEvent.side === "bearish") {
    const breakdownDepth =
      Number(latestEvent.level) - Number(postEventLow);
    const recoveryDistance =
      latestClose - Number(postEventLow);
    const recoveryRatio =
      breakdownDepth > 0 ? recoveryDistance / breakdownDepth : 0;

    const recoveryStrong =
      recoveryWindow.length >= 3 &&
      recoveryDistance >= Math.max(atr * 1.6, breakTolerance * 4) &&
      recoveryRatio >= 0.42 &&
      closeSlope > Math.max(atr * 0.20, breakTolerance);

    // A recovery becomes a confirmed bullish reversal only after a newer
    // bullish structure event exists. Price merely returning above the broken
    // support does not erase the controlling bearish breakdown.
    const newerBullishReversal =
      latestBullishEvent &&
      latestBullishEvent.index > latestEvent.index;

    if (newerBullishReversal) {
      return {
        direction: "bullish",
        phase: "bullish_breakout",
        state: "bullish_breakout",
        bullishBreakout: true,
        bearishBreakdown: false,
        bullishRecoveryAfterBreakdown: false,
        bearishPullbackAfterBreakout: false,
        confirmedReversal: true,
        latestClose,
        brokenLevel: latestBullishEvent.level,
        source: "cutoff_timeframe_swing_events",
        diagnostics: eventDiagnostics,
      };
    }

    if (recoveryStrong) {
      return {
        direction: "bearish",
        phase: "bullish_recovery_after_bearish_breakdown",
        state: "bullish_recovery_after_bearish_breakdown",
        bullishBreakout: false,
        bearishBreakdown: false,
        bullishRecoveryAfterBreakdown: true,
        bearishPullbackAfterBreakout: false,
        confirmedReversal: false,
        latestClose,
        brokenLevel: latestEvent.level,
        recoveryFrom: postEventLow,
        recoveryRatio,
        source: "cutoff_timeframe_swing_events",
        diagnostics: eventDiagnostics,
      };
    }

    return {
      direction: "bearish",
      phase: "bearish_breakdown",
      state: "bearish_breakdown",
      bullishBreakout: false,
      bearishBreakdown: true,
      bullishRecoveryAfterBreakdown: false,
      bearishPullbackAfterBreakout: false,
      confirmedReversal: true,
      latestClose,
      brokenLevel: latestEvent.level,
      source: "cutoff_timeframe_swing_events",
      diagnostics: eventDiagnostics,
    };
  }

  const breakoutHeight =
    Number(postEventHigh) - Number(latestEvent.level);
  const pullbackDistance =
    Number(postEventHigh) - latestClose;
  const pullbackRatio =
    breakoutHeight > 0 ? pullbackDistance / breakoutHeight : 0;

  const pullbackStrong =
    recoveryWindow.length >= 3 &&
    pullbackDistance >= Math.max(atr * 1.6, breakTolerance * 4) &&
    pullbackRatio >= 0.42 &&
    closeSlope < -Math.max(atr * 0.20, breakTolerance);

  const newerBearishReversal =
    latestBearishEvent &&
    latestBearishEvent.index > latestEvent.index;

  if (newerBearishReversal) {
    return {
      direction: "bearish",
      phase: "bearish_breakdown",
      state: "bearish_breakdown",
      bullishBreakout: false,
      bearishBreakdown: true,
      bullishRecoveryAfterBreakdown: false,
      bearishPullbackAfterBreakout: false,
      confirmedReversal: true,
      latestClose,
      brokenLevel: latestBearishEvent.level,
      source: "cutoff_timeframe_swing_events",
      diagnostics: eventDiagnostics,
    };
  }

  if (pullbackStrong) {
    return {
      direction: "bullish",
      phase: "bearish_pullback_after_bullish_breakout",
      state: "bearish_pullback_after_bullish_breakout",
      bullishBreakout: false,
      bearishBreakdown: false,
      bullishRecoveryAfterBreakdown: false,
      bearishPullbackAfterBreakout: true,
      confirmedReversal: false,
      latestClose,
      brokenLevel: latestEvent.level,
      pullbackFrom: postEventHigh,
      pullbackRatio,
      source: "cutoff_timeframe_swing_events",
      diagnostics: eventDiagnostics,
    };
  }

  return {
    direction: "bullish",
    phase: "bullish_breakout",
    state: "bullish_breakout",
    bullishBreakout: true,
    bearishBreakdown: false,
    bullishRecoveryAfterBreakdown: false,
    bearishPullbackAfterBreakout: false,
    confirmedReversal: true,
    latestClose,
    brokenLevel: latestEvent.level,
    source: "cutoff_timeframe_swing_events",
    diagnostics: eventDiagnostics,
  };
}

function deriveHistoricalPhaseFromLevels({
  marketReference = {},
  symbol = "",
}) {
  const levels = Array.isArray(marketReference?.dailyLevels)
    ? marketReference.dailyLevels
        .filter(
          (item) =>
            Number.isFinite(Number(item?.open)) &&
            Number.isFinite(Number(item?.high)) &&
            Number.isFinite(Number(item?.low)) &&
            Number.isFinite(Number(item?.close))
        )
        .sort((a, b) => String(a?.key || a?.date || "").localeCompare(
          String(b?.key || b?.date || "")
        ))
    : [];

  if (levels.length < 2) {
    const fallbackDirection = normalizedDirectionCode(
      marketReference?.directionalBias?.biasCode ||
        marketReference?.directionalBias?.bias ||
        ""
    );

    return {
      direction: fallbackDirection,
      phase: "insufficient_period_data",
      state: "none",
      bullishBreakout: false,
      bearishBreakdown: false,
      bullishRecoveryAfterBreakdown: false,
      bearishPullbackAfterBreakout: false,
      confirmedReversal: false,
      latestClose: extractLastMarketPrice(marketReference),
      brokenLevel: null,
      source: "cutoff_period_levels_fallback",
    };
  }

  const currentIndex = levels.length - 1;
  const current = levels[currentIndex];
  const previous = levels[currentIndex - 1];
  const currentBreak = periodBreakState({
    levels,
    index: currentIndex,
    symbol,
  });
  const previousBreak = periodBreakState({
    levels,
    index: currentIndex - 1,
    symbol,
  });

  const recentBearishBreak = findMostRecentStructuralBreak({
    levels,
    beforeIndex: currentIndex - 1,
    symbol,
    side: "bearish",
    maxLookback: 5,
  });

  const recentBullishBreak = findMostRecentStructuralBreak({
    levels,
    beforeIndex: currentIndex - 1,
    symbol,
    side: "bullish",
    maxLookback: 5,
  });

  const currentClose = Number(current.close);
  const previousClose = Number(previous.close);
  const currentOpen = Number(current.open);
  const previousLow = Number(previous.low);
  const previousHigh = Number(previous.high);
  const moveThreshold = historicalMoveThreshold(symbol, currentClose);
  const rangePosition = periodRangePosition(current);
  const currentLow = Number(current.low);
  const currentHigh = Number(current.high);
  const currentRange =
    Number.isFinite(currentHigh) && Number.isFinite(currentLow)
      ? Math.max(0, currentHigh - currentLow)
      : 0;
  const recoveryFromLow =
    Number.isFinite(currentClose) && Number.isFinite(currentLow)
      ? currentClose - currentLow
      : 0;
  const rejectionFromHigh =
    Number.isFinite(currentHigh) && Number.isFinite(currentClose)
      ? currentHigh - currentClose
      : 0;

  // A close beyond the earlier structure confirms a new directional break.
  if (currentBreak.bullishBreakout) {
    return {
      direction: "bullish",
      phase: "bullish_breakout",
      state: "bullish_breakout",
      bullishBreakout: true,
      bearishBreakdown: false,
      bullishRecoveryAfterBreakdown: false,
      bearishPullbackAfterBreakout: false,
      confirmedReversal: true,
      latestClose: currentClose,
      brokenLevel: currentBreak.priorResistance,
      source: "cutoff_period_levels",
    };
  }

  // A candle can break support intraperiod and still finish as a strong
  // recovery. In that case, classify the phase as transitional rather than
  // treating the close as simple bearish continuation.
  const samePeriodBullishRecovery =
    currentBreak.bearishBreakdown &&
    currentClose > currentOpen &&
    rangePosition >= 0.55 &&
    recoveryFromLow >= Math.max(moveThreshold * 1.5, currentRange * 0.45) &&
    !currentBreak.bullishBreakout;

  const priorBreakBullishRecovery =
    Boolean(recentBearishBreak) &&
    currentIndex - recentBearishBreak.index <= 5 &&
    currentClose > Number(recentBearishBreak.period?.close) + moveThreshold &&
    rangePosition >= 0.55 &&
    recoveryFromLow >= Math.max(moveThreshold, currentRange * 0.35) &&
    !currentBreak.bullishBreakout;

  const bullishRecovery =
    samePeriodBullishRecovery || priorBreakBullishRecovery;

  if (bullishRecovery) {
    return {
      direction: "bearish",
      phase: "bullish_recovery_after_bearish_breakdown",
      state: "bullish_recovery_after_bearish_breakdown",
      bullishBreakout: false,
      bearishBreakdown: false,
      bullishRecoveryAfterBreakdown: true,
      bearishPullbackAfterBreakout: false,
      confirmedReversal: false,
      latestClose: currentClose,
      brokenLevel:
        recentBearishBreak?.level ??
        currentBreak.priorSupport ??
        previousBreak.priorSupport ??
        minFinite(levels.slice(0, currentIndex).map((item) => item?.low)),
      recoveryFrom: currentLow,
      recoveryResistance: currentBreak.priorResistance,
      recoveryEvidence: samePeriodBullishRecovery
        ? "same_period_break_and_recovery"
        : "recovery_after_recent_breakdown",
      source: "cutoff_period_levels",
    };
  }

  if (currentBreak.bearishBreakdown) {
    return {
      direction: "bearish",
      phase: "bearish_breakdown",
      state: "bearish_breakdown",
      bullishBreakout: false,
      bearishBreakdown: true,
      bullishRecoveryAfterBreakdown: false,
      bearishPullbackAfterBreakout: false,
      confirmedReversal: true,
      latestClose: currentClose,
      brokenLevel: currentBreak.priorSupport,
      source: "cutoff_period_levels",
    };
  }

  // The opposite transitional state is handled symmetrically.
  const samePeriodBearishPullback =
    currentBreak.bullishBreakout &&
    currentClose < currentOpen &&
    rangePosition <= 0.45 &&
    rejectionFromHigh >= Math.max(moveThreshold * 1.5, currentRange * 0.45) &&
    !currentBreak.bearishBreakdown;

  const priorBreakBearishPullback =
    Boolean(recentBullishBreak) &&
    currentIndex - recentBullishBreak.index <= 5 &&
    currentClose < Number(recentBullishBreak.period?.close) - moveThreshold &&
    rangePosition <= 0.45 &&
    rejectionFromHigh >= Math.max(moveThreshold, currentRange * 0.35) &&
    !currentBreak.bearishBreakdown;

  const bearishPullback =
    samePeriodBearishPullback || priorBreakBearishPullback;

  if (bearishPullback) {
    return {
      direction: "bullish",
      phase: "bearish_pullback_after_bullish_breakout",
      state: "bearish_pullback_after_bullish_breakout",
      bullishBreakout: false,
      bearishBreakdown: false,
      bullishRecoveryAfterBreakdown: false,
      bearishPullbackAfterBreakout: true,
      confirmedReversal: false,
      latestClose: currentClose,
      brokenLevel:
        recentBullishBreak?.level ??
        currentBreak.priorResistance ??
        previousBreak.priorResistance ??
        maxFinite(levels.slice(0, currentIndex).map((item) => item?.high)),
      pullbackFrom: currentHigh,
      pullbackEvidence: samePeriodBearishPullback
        ? "same_period_break_and_pullback"
        : "pullback_after_recent_breakout",
      pullbackSupport: currentBreak.priorSupport,
      source: "cutoff_period_levels",
    };
  }

  // When no new break or transition exists, use the completed period closes,
  // not the future candles visible to the right of the selected date.
  const firstClose = Number(levels[0].close);
  const netMove = currentClose - firstClose;
  const direction =
    netMove > moveThreshold
      ? "bullish"
      : netMove < -moveThreshold
      ? "bearish"
      : "range";

  return {
    direction,
    phase:
      direction === "bullish"
        ? "bullish_structure"
        : direction === "bearish"
        ? "bearish_structure"
        : "range",
    state: "none",
    bullishBreakout: false,
    bearishBreakdown: false,
    bullishRecoveryAfterBreakdown: false,
    bearishPullbackAfterBreakout: false,
    confirmedReversal: false,
    latestClose: currentClose,
    brokenLevel: null,
    source: "cutoff_period_levels",
  };
}

function shouldUseAuthoritativePeriodPhase(marketReference = {}) {
  const cutoffMode = normalizeCutoffMode(
    marketReference?.chartCutoff?.mode || ""
  );

  return ["selected_day", "exact"].includes(cutoffMode);
}

function deriveAuthoritativeCsaHistoricalPhase({
  marketReference = {},
  symbol = "",
  timeframe = "H1",
}) {
  const periodPhase = deriveHistoricalPhaseFromLevels({
    marketReference,
    symbol,
  });

  const candlePhase = deriveHistoricalPhaseFromTimeframeCandles({
    marketReference,
    symbol,
    timeframe,
  });

  const usePeriodPhase =
    shouldUseAuthoritativePeriodPhase(marketReference);

  if (
    usePeriodPhase &&
    periodPhase &&
    ["bullish", "bearish", "range"].includes(periodPhase.direction)
  ) {
    return {
      ...periodPhase,
      source: `${periodPhase.source || "cutoff_period_levels"}_authoritative`,
      diagnostics: {
        ...(periodPhase.diagnostics || {}),
        cutoffMode:
          marketReference?.chartCutoff?.mode || "selected_day",
        directionAuthority: "csa_source_period_levels",
        secondaryCandlePhase: candlePhase
          ? {
              direction: candlePhase.direction || null,
              phase: candlePhase.phase || null,
              source: candlePhase.source || null,
              finalCandle:
                candlePhase?.diagnostics?.finalCandle || null,
            }
          : null,
      },
    };
  }

  return candlePhase || periodPhase || null;
}

function buildValidatedAnalysisFacts({
  visualReview = {},
  marketReference = {},
  chartDetection = {},
  bias = {},
  submittedInstrument = "",
  timeframe = "",
  analysisType = "post-trade",
  selectedDate = "",
  submittedNotes = "",
}) {
  const fallbackPreferredArea =
    visualReview?.preferredEntryArea &&
    typeof visualReview.preferredEntryArea === "object"
      ? visualReview.preferredEntryArea
      : {};

  const historicalCutoff = getHistoricalCutoffState({
    analysisType,
    selectedDate,
    chartDetection,
    marketReference,
  });

  const verifiedMarketDirection =
    normalizedDirectionCode(
      bias?.biasCode ||
      bias?.bias ||
      marketReference?.directionalBias?.biasCode ||
      marketReference?.directionalBias?.bias ||
      ""
    );

  const visualDirection =
    normalizedDirectionCode(
      fallbackPreferredArea?.direction ||
      visualReview?.plainMarketDirection ||
      visualReview?.shortTermDirection ||
      ""
    );

  // The verified historical framework controls the broader directional bias.
  // Visual review may describe a short-term range or pullback, but it must not
  // turn a verified bullish/bearish structure into a range-bound verdict.
  const visualBreakoutState = normalizeBreakoutState(
    visualReview,
    chartDetection
  );

  const visualTransitionState = normalizeTransitionState(
    visualReview,
    chartDetection
  );

  const historicalPhase =
    deriveAuthoritativeCsaHistoricalPhase({
      marketReference,
      symbol: submittedInstrument,
      timeframe,
    });

  const deterministicMarketStateAvailable =
    historicalPhase &&
    ["bullish", "bearish", "range"].includes(historicalPhase.direction);

  const historicalPeriodDirectionLocked =
    shouldUseAuthoritativePeriodPhase(marketReference) &&
    deterministicMarketStateAvailable;

  const breakoutState = deterministicMarketStateAvailable
    ? {
        bullishBreakout: historicalPhase.bullishBreakout === true,
        bearishBreakdown: historicalPhase.bearishBreakdown === true,
        extended: false,
        state: historicalPhase.state,
        source: historicalPhase.source,
      }
    : visualBreakoutState;

  const transitionState = deterministicMarketStateAvailable
    ? {
        bullishRecoveryAfterBreakdown:
          historicalPhase.bullishRecoveryAfterBreakdown === true,
        bearishPullbackAfterBreakout:
          historicalPhase.bearishPullbackAfterBreakout === true,
        state: historicalPhase.state,
        source: historicalPhase.source,
      }
    : visualTransitionState;

  const breakoutDirectionOverride = deterministicMarketStateAvailable
    ? null
    : breakoutOverridesRange({
        verifiedMarketDirection,
        visualDirection,
        breakoutState,
      });

  let direction = deterministicMarketStateAvailable
    ? historicalPhase.direction
    : breakoutDirectionOverride
    ? breakoutDirectionOverride
    : ["bullish", "bearish"].includes(verifiedMarketDirection)
    ? verifiedMarketDirection
    : visualDirection;

  // Transitional recoveries keep the original structural side until the
  // opposing key level is clearly broken and held.
  if (
    transitionState.bullishRecoveryAfterBreakdown &&
    !breakoutState.bullishBreakout
  ) {
    direction = "bearish";
  } else if (
    transitionState.bearishPullbackAfterBreakout &&
    !breakoutState.bearishBreakdown
  ) {
    direction = "bullish";
  }

  // In End-of-selected-day / Exact historical mode, the CSA source-period
  // structure is immutable. Later candles visible in the uploaded screenshot
  // and visual-model descriptions must not flip the historical direction.
  if (historicalPeriodDirectionLocked) {
    direction = historicalPhase.direction;
  }

  const finalVisibleMode =
    normalizeCutoffMode(marketReference?.chartCutoff?.mode || "final_visible") ===
    "final_visible";

  const currentPrice = finalVisibleMode
    ? asPositiveNumber(visualReview?.latestVisiblePrice) ||
      asPositiveNumber(historicalPhase?.latestClose) ||
      extractLastMarketPrice(marketReference)
    : asPositiveNumber(historicalPhase?.latestClose) ||
      extractLastMarketPrice(marketReference) ||
      asPositiveNumber(visualReview?.latestVisiblePrice);

  const lockedMarketState = Object.freeze({
    direction,
    phase: historicalPhase?.phase || "unknown",
    breakoutState: Object.freeze({ ...breakoutState }),
    transitionState: Object.freeze({ ...transitionState }),
    controllingEvent:
      historicalPhase?.diagnostics?.latestEvent || null,
  });

  const rankedAreaResult = rankRawEntryAreas({
    visualReview,
    marketReference,
    historicalPhase,
    direction: lockedMarketState.direction,
    currentPrice,
    symbol: submittedInstrument,
    timeframe,
  });

  const rankedRawAreas = Array.isArray(rankedAreaResult?.areas)
    ? rankedAreaResult.areas
    : [];

  const structuralReferenceAreas =
    Array.isArray(rankedAreaResult?.referenceAreas)
      ? rankedAreaResult.referenceAreas
      : [];

  const entryAreaValidation =
    rankedAreaResult?.validation || {
      passed: false,
      errors: ["missing_area_validation_result"],
    };

  const preferredArea = rankedRawAreas[0] || {};
  const secondaryRawArea = rankedRawAreas[1] || null;
  const areaType = normalizedAreaType(preferredArea?.areaType, direction);
  const zone = normalizeZone(preferredArea, submittedInstrument);
  let priceStatus = normalizePriceStatus(preferredArea?.priceStatus);
  const combinedAreaEvidence = [
    preferredArea?.priceStatus,
    visualReview?.entryEvidence,
    visualReview?.bestAreaToWatch,
    visualReview?.coachVerdict,
    visualReview?.mainWarning,
  ]
    .filter(Boolean)
    .join(" ");

  if (priceStatus === "unclear") {
    priceStatus = normalizePriceStatus(combinedAreaEvidence);
  }

  const currentPriceInsideZone =
    currentPrice !== null &&
    zone.zoneLow !== null &&
    zone.zoneHigh !== null &&
    currentPrice >= zone.zoneLow &&
    currentPrice <= zone.zoneHigh;

  const areaReachEvidence = String(
    preferredArea?.areaReachEvidence || ""
  ).trim();
  const areaReachPrice = asPositiveNumber(preferredArea?.areaReachPrice);
  const areaReachTime = String(preferredArea?.areaReachTime || "").trim();
  const annotationOnlyEvidence =
    /annotation|label|arrow|text says|marked as|planned|retest here|entry here/i;
  const candleReachEvidence =
    /candle|wick|body|high|low|closed|entered|touched|traded into/i;

  const areaReachVisuallyProven =
    historicalCutoff.active
      ? false
      : preferredArea?.areaVisuallyReached === true &&
        candleReachEvidence.test(areaReachEvidence) &&
        !annotationOnlyEvidence.test(areaReachEvidence) &&
        priceTouchesZone(areaReachPrice, zone.zoneLow, zone.zoneHigh) &&
        hasSpecificVisibleTime(areaReachTime);

  // Market-reference price can be later than the screenshot's exact final
  // intraday candle when the chart time is unreadable. It must not prove that
  // the planned area was reached. Only candle-based evidence extracted from
  // the screenshot may confirm a retest.
  let areaRetested = areaReachVisuallyProven;

  // A boolean supplied by the model is not enough. The model must also give
  // candle-based visual evidence. Labels, arrows, written trade ideas and a
  // Twelve Data close inside the zone are not treated as proof.
  if (!areaRetested) {
    if (
      direction === "bearish" &&
      currentPrice !== null &&
      zone.zoneLow !== null &&
      currentPrice < zone.zoneLow
    ) {
      priceStatus = priceStatus === "approaching" ? "approaching" : "not_reached";
    } else if (
      direction === "bullish" &&
      currentPrice !== null &&
      zone.zoneHigh !== null &&
      currentPrice > zone.zoneHigh
    ) {
      priceStatus = priceStatus === "approaching" ? "approaching" : "not_reached";
    } else if (["reacted", "moved_away"].includes(priceStatus)) {
      priceStatus = "unclear";
    }
  }

  const triggerDescription = String(
    preferredArea?.triggerDescription ||
      visualReview?.entryConfirmation ||
      visualReview?.entryEvidence ||
      ""
  ).trim();
  const triggerEvidence = String(
    preferredArea?.triggerEvidence || ""
  ).trim();

  const invalidTriggerWords =
    /bounce|pullback|retracement|reaction|ranging|consolidation|touch(?:ed|ing)?|merely touching|no clear|not visible|not yet/i;
  const validTriggerEvidence =
    /engulf|pin bar|hammer|doji|inside bar|lower high|higher low|break(?:out|down)|retest[- ]and[- ]hold|break[- ]and[- ]hold|head and shoulders|quasimodo/i;

  const triggerEvidenceTime = String(
    preferredArea?.triggerEvidenceTime || ""
  ).trim();

  let triggerPresent =
    !historicalCutoff.active &&
    preferredArea?.triggerPresent === true &&
    preferredArea?.triggerAtAreaVisible === true &&
    areaRetested &&
    hasSpecificVisibleTime(triggerEvidenceTime) &&
    validTriggerEvidence.test(`${triggerEvidence} ${triggerDescription}`) &&
    !annotationOnlyEvidence.test(`${triggerEvidence} ${triggerDescription}`) &&
    !invalidTriggerWords.test(`${triggerEvidence} ${triggerDescription}`);

  if (!areaRetested || priceStatus === "invalidated") triggerPresent = false;

  const convertedText = String(
    visualReview?.convertedLevelAssessment || ""
  ).replace(/\s+/g, " ").trim();

  const convertedLevelDetected =
    /broken support|broken resistance|converted support|converted resistance|former support|former resistance|retest from below|retest from above/i.test(
      convertedText
    );

  const convertedLevelState = convertedLevelDetected
    ? normalizeLevelState(convertedText)
    : "not_detected";

  const areaFailureEvidence = [
    preferredArea?.priceStatus,
    visualReview?.mainWarning,
    visualReview?.coachVerdict,
    visualReview?.entryEvidence,
    visualReview?.convertedLevelAssessment,
    ...(Array.isArray(visualReview?.chartSpecificWeaknesses)
      ? visualReview.chartSpecificWeaknesses
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const areaInvalidated =
    priceStatus === "invalidated" ||
    /area.*failed|zone.*failed|broke through (?:the )?(?:supply|demand|support|resistance)|decisive (?:breakout|breakdown)|close(?:d)? decisively beyond|invalidated/.test(
      areaFailureEvidence
    );

  const lifecycleStatus = areaInvalidated
    ? "invalidated"
    : priceStatus === "moved_away"
    ? "moved_away"
    : triggerPresent
    ? "triggered"
    : priceStatus === "reacted"
    ? "respected"
    : priceStatus === "inside"
    ? "retested"
    : priceStatus === "approaching"
    ? "approaching"
    : "identified";

  const risk = inferRiskVisibility(visualReview);
  const tradeVisible =
    visualReview?.tradeVisible === true ||
    visualReview?.entryShown === true ||
    /entry.*(shown|visible|marked|taken)|trade.*(shown|visible|taken)/i.test(
      `${visualReview?.entryEvidence || ""} ${submittedNotes || ""}`
    );

  const tradeOutcomeText = [
    visualReview?.tradeOutcome,
    visualReview?.coachVerdict,
    visualReview?.mainWarning,
    submittedNotes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const tradeOutcome =
    /stop(?:ped)? out|stop loss hit|lost|loss/.test(tradeOutcomeText)
      ? "loss"
      : /take profit|target hit|winner|profit/.test(tradeOutcomeText)
      ? "win"
      : tradeVisible
      ? "open_or_unknown"
      : "not_applicable";

  const shortTermText = String(
    visualReview?.shortTermDirection ||
      visualReview?.plainMarketDirection ||
      visualReview?.visualSummary ||
      ""
  ).toLowerCase();

  const shortTermCondition =
    /consolidat|range|sideways/.test(shortTermText)
      ? "consolidation"
      : /bounce/.test(shortTermText)
      ? "bounce"
      : /pullback|retracement|correction/.test(shortTermText)
      ? "pullback"
      : "trend";

  return {
    engineVersion: CSA_FEEDBACK_ENGINE_VERSION,
    instrument: submittedInstrument,
    timeframe,
    analysisType,
    chartMarkingStatus: String(
      visualReview?.chartMarkingStatus ||
        visualReview?.markingStatus ||
        "unclear"
    ).toLowerCase(),
    direction,
    directionSource: historicalCutoff.active
      ? "historical_cutoff_period_classifier"
      : ["bullish", "bearish"].includes(verifiedMarketDirection)
      ? "verified_market_framework"
      : "visual_review",
    historicalCutoff,
    historicalPhase: historicalPhase || null,
    visualDirection,
    verifiedMarketDirection,
    breakoutState,
    transitionState,
    directionOverride:
      breakoutDirectionOverride
        ? "recent_breakout_override"
        : transitionState.bullishRecoveryAfterBreakdown
        ? "bearish_structure_with_bullish_recovery"
        : transitionState.bearishPullbackAfterBreakout
        ? "bullish_structure_with_bearish_pullback"
        : null,
    shortTermCondition,
    currentPrice,
    latestVisiblePrice: asPositiveNumber(visualReview?.latestVisiblePrice),
    structuralReferenceAreas: structuralReferenceAreas.map((candidate) => ({
      direction: candidate.direction,
      areaType: candidate.areaType,
      zoneLow: candidate.zoneLow,
      zoneHigh: candidate.zoneHigh,
      zoneText: candidate.zoneText,
      authoritativeCenter: asPositiveNumber(candidate.authoritativeCenter),
      levelText: safeUserText(candidate.levelText || ""),
      frameworkPeriod: candidate.frameworkPeriod || null,
      structuralScore: Number(candidate.structuralScore || 0),
      fibPassed: false,
      nearestFibLabel: candidate.nearestFibLabel || null,
      nearestFibPrice: asPositiveNumber(candidate.nearestFibPrice),
      fibDistance:
        Number.isFinite(Number(candidate.fibDistance))
          ? Number(candidate.fibDistance)
          : null,
      fibDistanceAsAtrPercent:
        Number.isFinite(Number(candidate.fibDistanceAsAtrPercent))
          ? Number(candidate.fibDistanceAsAtrPercent)
          : null,
      conversionConfirmed:
        candidate.conversionConfirmed === true,
      referenceOnly: true,
    })),
    selectedEntryAreas:
      rankedRawAreas.map(
        (candidate, index) => ({
          executionOrder:
            Number(
              candidate.executionOrder ||
                index + 1
            ),
          direction:
            candidate.direction,
          areaType:
            candidate.areaType,
          zoneLow:
            candidate.zoneLow,
          zoneHigh:
            candidate.zoneHigh,
          zoneText:
            safeUserText(
              candidate.levelText || ""
            )
              ? `around ${safeUserText(
                  candidate.levelText || ""
                )}`
              : candidate.zoneText,
          authoritativeCenter:
            asPositiveNumber(
              candidate.authoritativeCenter
            ),
          levelText:
            safeUserText(
              candidate.levelText || ""
            ),
          conversionConfirmed:
            candidate
              .conversionConfirmed === true,
        })
      ),
    selectedEntryCount:
      rankedRawAreas.length,
    activeEntryAreas: rankedRawAreas.map((candidate, index) => ({
      rank: candidate.executionOrder || index + 1,
      role: candidate.role || (index === 0 ? "primary" : index === 1 ? "secondary" : "alternative"),
      direction: candidate.direction,
      areaType: candidate.areaType,
      zoneLow: candidate.zoneLow,
      zoneHigh: candidate.zoneHigh,
      zoneText:
        safeUserText(candidate.levelText || "")
          ? `around ${safeUserText(candidate.levelText || "")}`
          : candidate.zoneText,
      authoritativeCenter: asPositiveNumber(candidate.authoritativeCenter),
      frameworkCenter: asPositiveNumber(candidate.frameworkCenter),
      chartReconciledCenter: asPositiveNumber(candidate.chartReconciledCenter),
      levelText: safeUserText(candidate.levelText || ""),
      state: candidate.state,
      sourceReason: safeUserText(candidate.sourceReason || ""),
      distanceFromPrice:
        Number.isFinite(Number(candidate.distance))
          ? Number(candidate.distance)
          : null,
      structuralScore: Number(candidate.structuralScore || 0),
      fibonacciScore: Number(candidate.fibonacciScore || 0),
      requiredFibConfluence:
        candidate.requiredFibConfluence === true,
      executionOrder: Number(candidate.executionOrder || index + 1),
      conversionConfirmed: candidate.conversionConfirmed === true,
    })),
    selectorDiagnostics:
      rankedAreaResult?.regressionDiagnostics || null,
    entryAreaValidation: {
      ...entryAreaValidation,
      frameworkMode:
        marketReference?.profile?.structureMode || null,
      frameworkLabel:
        marketReference?.profile?.structureLabel || null,
      authoritativeLevelsOnly: true,
    },
    secondaryEntryArea: secondaryRawArea
      ? {
          direction: secondaryRawArea.direction,
          areaType: secondaryRawArea.areaType,
          zoneLow: secondaryRawArea.zoneLow,
          zoneHigh: secondaryRawArea.zoneHigh,
          zoneText:
            safeUserText(secondaryRawArea.levelText || "")
              ? `around ${safeUserText(secondaryRawArea.levelText)}`
              : secondaryRawArea.zoneText,
          state: secondaryRawArea.state,
          sourceReason: safeUserText(secondaryRawArea.sourceReason || ""),
          executionOrder: Number(secondaryRawArea.executionOrder || 2),
          conversionConfirmed: secondaryRawArea.conversionConfirmed === true,
          authoritativeCenter: asPositiveNumber(
            secondaryRawArea.authoritativeCenter
          ),
          levelText: safeUserText(secondaryRawArea.levelText || ""),
        }
      : null,
    preferredEntryArea: {
      validated:
        preferredArea?.validated === true &&
        zone.zoneLow !== null &&
        zone.zoneHigh !== null,
      direction:
        direction === "bearish"
          ? "sell"
          : direction === "bullish"
          ? "buy"
          : "none",
      areaType,
      zoneLow: zone.zoneLow,
      zoneHigh: zone.zoneHigh,
      zoneText:
        safeUserText(preferredArea?.levelText || "")
          ? `around ${safeUserText(preferredArea.levelText)}`
          : safeUserText(preferredArea?.zoneText || zone.zoneText),
      priceStatus,
      areaRetested,
      areaReachEvidence: areaRetested ? areaReachEvidence : "",
      areaReachPrice: areaRetested ? areaReachPrice : null,
      areaReachTime: areaRetested ? areaReachTime : "",
      marketReferenceInsideZone: currentPriceInsideZone,
      triggerPresent,
      triggerEvidence: triggerPresent ? triggerEvidence : "",
      triggerEvidenceTime: triggerPresent ? triggerEvidenceTime : "",
      triggerDescription: triggerPresent ? triggerDescription : "",
      lifecycleStatus,
      invalidated: areaInvalidated,
      directionMatch:
        preferredArea?.validated === true &&
        areaDirectionMatches(areaType, direction),
      structuralScore: Number(preferredArea?.structuralScore || 0),
      fibonacciScore: Number(preferredArea?.fibonacciScore || 0),
      requiredFibConfluence:
        preferredArea?.requiredFibConfluence === true,
      fibonacciMatches: Array.isArray(preferredArea?.fibonacciMatches)
        ? preferredArea.fibonacciMatches
        : [],
      reactionCount: Number(preferredArea?.reactionCount || 0),
      executionOrder: Number(preferredArea?.executionOrder || 1),
      conversionConfirmed: preferredArea?.conversionConfirmed === true,
      brokenLevel: asPositiveNumber(preferredArea?.brokenLevel),
      authoritativeCenter: asPositiveNumber(
        preferredArea?.authoritativeCenter
      ),
      levelText: safeUserText(preferredArea?.levelText || ""),
    },
    convertedLevel: {
      detected: convertedLevelDetected,
      state: convertedLevelState,
      assessment: convertedLevelDetected ? convertedText : "",
    },
    confluence: {
      fibonacci:
        Number(preferredArea?.fibonacciScore || 0) > 0,
      fibonacciMatches: Array.isArray(preferredArea?.fibonacciMatches)
        ? preferredArea.fibonacciMatches
        : [],
      structuralScore: Number(preferredArea?.structuralScore || 0),
      count:
        Number(preferredArea?.reactionCount || 0) +
        (Number(preferredArea?.fibonacciScore || 0) > 0 ? 1 : 0),
      strength:
        Number(preferredArea?.fibonacciScore || 0) > 0 &&
        Number(preferredArea?.structuralScore || 0) >= 18
          ? "high"
          : Number(preferredArea?.structuralScore || 0) >= 12
          ? "medium"
          : "low",
    },
    risk: {
      stopShown: risk.stopShown,
      targetShown: risk.targetShown,
      assessable: risk.stopShown && risk.targetShown,
    },
    trade: {
      visible: tradeVisible,
      outcome: tradeOutcome,
    },
    chartCutoff: {
      latestVisibleDate: chartDetection?.latestVisibleDate || null,
      latestVisibleTime: chartDetection?.latestVisibleTime || null,
      source: marketReference?.chartCutoff?.source || null,
    },
    confidence: String(visualReview?.confidence || "medium").toLowerCase(),
  };
}

function getCanonicalSelectedEntryAreas(facts = {}) {
  const raw =
    Array.isArray(facts?.activeEntryAreas)
      ? facts.activeEntryAreas
      : [];

  return raw
    .filter((area) => {
      if (!area || typeof area !== "object") {
        return false;
      }

      const direction =
        String(
          area?.direction || ""
        ).toLowerCase();

      const hasPrice =
        Number.isFinite(
          Number(
            area?.authoritativeCenter
          )
        ) ||
        Boolean(
          safeUserText(
            area?.levelText || ""
          )
        );

      return (
        ["buy", "sell"].includes(
          direction
        ) &&
        hasPrice
      );
    })
    .sort((a, b) => {
      const ao =
        Number(
          a?.executionOrder ??
            a?.rank ??
            999
        );

      const bo =
        Number(
          b?.executionOrder ??
            b?.rank ??
            999
        );

      return ao - bo;
    })
    .slice(0, 2);
}

function extractNarrativePriceNumbers(
  text = ""
) {
  return (
    String(text || "")
      .match(
        /\b\d+(?:\.\d+)?\b/g
      ) || []
  )
    .map(Number)
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value > 0
    );
}

function entryNarrativePriceMatchesArea(
  price,
  area
) {
  const target =
    asPositiveNumber(
      area?.authoritativeCenter
    );

  if (
    !Number.isFinite(
      Number(price)
    ) ||
    !Number.isFinite(target)
  ) {
    return false;
  }

  const tolerance =
    Math.max(
      Math.abs(target) * 0.000001,
      0.000001
    );

  return (
    Math.abs(
      Number(price) -
        target
    ) <= tolerance
  );
}

function narrativeReferencesSelectedEntry(
  text = "",
  selectedEntries = []
) {
  const normalized =
    String(text || "");

  const numbers =
    extractNarrativePriceNumbers(
      normalized
    );

  if (!numbers.length) {
    return false;
  }

  return numbers.some((price) =>
    selectedEntries.some((area) =>
      entryNarrativePriceMatchesArea(
        price,
        area
      )
    )
  );
}

function isRawEntryRecommendationClaim(
  text = ""
) {
  return (
    /\bentry\s*[12]?\b/i.test(
      text
    ) ||
    /\bsecondary\b/i.test(
      text
    ) ||
    /\bfallback\b/i.test(
      text
    ) ||
    /\bpreferred\s+(?:entry|buy|sell|setup|area|location)\b/i.test(
      text
    ) ||
    /\b(?:buy|sell)\s+(?:area|location|zone)\b/i.test(
      text
    ) ||
    /\b(?:first|second)\s+(?:buy|sell|entry)\s+(?:area|location|zone)\b/i.test(
      text
    ) ||
    /\bconsider(?:ing)?\s+(?:a\s+)?(?:buy|sell)\b/i.test(
      text
    )
  );
}

function sanitizeRawEntryNarrativeItems({
  items = [],
  facts = {},
}) {
  const selectedEntries =
    getCanonicalSelectedEntryAreas(
      facts
    );

  return normalizeArrayOfStrings(
    items,
    []
  ).filter((item) => {
    const text =
      String(item || "").trim();

    if (!text) {
      return false;
    }

    // Raw Claude/legacy entry recommendations are never authoritative.
    // Controlled feedback below will re-add only the deterministic
    // selected Entry 1 / Entry 2 statements.
    if (
      isRawEntryRecommendationClaim(
        text
      )
    ) {
      return false;
    }

    // Extra guard: if a sentence somehow calls an unselected price a
    // buy/sell entry location, remove it.
    if (
      /\b(?:buy|sell)\b/i.test(
        text
      ) &&
      /\b(?:entry|area|location|zone)\b/i.test(
        text
      )
    ) {
      const prices =
        extractNarrativePriceNumbers(
          text
        );

      if (
        prices.length &&
        !narrativeReferencesSelectedEntry(
          text,
          selectedEntries
        )
      ) {
        return false;
      }
    }

    return true;
  });
}

function applySelectedEntryNarrativeLockToVisualReview({
  visualReview = null,
  facts = null,
}) {
  if (!visualReview || !facts) {
    return visualReview;
  }

  const selectedEntries =
    getCanonicalSelectedEntryAreas(
      facts
    );

  const lockedStrengths =
    sanitizeRawEntryNarrativeItems({
      items:
        visualReview
          ?.chartSpecificStrengths ||
        [],
      facts,
    });

  const lockedSimilarities =
    sanitizeRawEntryNarrativeItems({
      items:
        visualReview
          ?.csaSimilarities ||
        [],
      facts,
    });

  const lockedDifferences =
    sanitizeRawEntryNarrativeItems({
      items:
        visualReview
          ?.csaDifferences ||
        [],
      facts,
    });

  const selectedEntrySummary =
    selectedEntries.map(
      (area, index) => ({
        executionOrder:
          Number(
            area?.executionOrder ||
              area?.rank ||
              index + 1
          ),
        areaType:
          String(
            area?.areaType ||
              "area"
          ),
        levelText:
          safeUserText(
            area?.levelText || ""
          ),
        authoritativeCenter:
          asPositiveNumber(
            area?.authoritativeCenter
          ),
      })
    );

  console.log(
    "CSA selected-entry narrative lock:",
    {
      engineVersion:
        CSA_FEEDBACK_ENGINE_VERSION,
      selectedEntryCount:
        selectedEntrySummary.length,
      selectedEntries:
        selectedEntrySummary,
      rawStrengthCount:
        normalizeArrayOfStrings(
          visualReview
            ?.chartSpecificStrengths,
          []
        ).length,
      lockedStrengthCount:
        lockedStrengths.length,
      entry2Allowed:
        selectedEntrySummary.length > 1,
      rule:
        "only_deterministic_selected_entries_may_be_promoted_as_entry_areas",
    }
  );

  return {
    ...visualReview,
    chartSpecificStrengths:
      lockedStrengths,
    csaSimilarities:
      lockedSimilarities,
    csaDifferences:
      lockedDifferences,
    deterministicEntryNarrativeLock: {
      active: true,
      selectedEntryCount:
        selectedEntrySummary.length,
      selectedEntries:
        selectedEntrySummary,
      entry2Allowed:
        selectedEntrySummary.length > 1,
      rule:
        "selected_entries_are_single_source_of_truth",
    },
  };
}

function formatRankedArea(area, fallbackType = "entry") {
  if (!area) return "";

  const rawType = String(area.areaType || fallbackType);
  const normalizedType = rawType.toLowerCase();

  const base =
    normalizedType === "converted support" &&
    area?.conversionConfirmed !== true
      ? "potential converted support"
      : normalizedType === "converted resistance" &&
        area?.conversionConfirmed !== true
      ? "potential converted resistance"
      : rawType;

  const exactLevel =
    safeUserText(area.levelText || "") ||
    (
      Number.isFinite(Number(area.authoritativeCenter))
        ? formatPrice(area.authoritativeCenter)
        : ""
    );

  if (exactLevel) return `${base} around ${exactLevel}`;
  return area.zoneText ? `${base} ${String(area.zoneText).replace(/^around\\s+/i, "around ")}` : `marked ${base}`;
}

function areaDisplay(facts) {
  const area = facts.preferredEntryArea;
  return formatRankedArea(
    area,
    facts.direction === "bearish" ? "supply area" : "demand area"
  );
}

function secondaryAreaDisplay(facts) {
  const selectedEntries =
    getCanonicalSelectedEntryAreas(
      facts
    );

  const secondary =
    selectedEntries.length > 1
      ? selectedEntries[1]
      : null;

  return formatRankedArea(
    secondary,
    facts.direction === "bearish"
      ? "supply area"
      : "demand area"
  );
}

function applyDeterministicEntryPlanToVisualReview({
  visualReview = null,
  facts = null,
}) {
  if (!visualReview || !facts) return visualReview;

  const deterministicAreas = Array.isArray(facts?.activeEntryAreas)
    ? facts.activeEntryAreas
    : [];

  const preferred = facts?.preferredEntryArea || {};
  const hasPreferred =
    preferred?.validated === true &&
    ["buy", "sell"].includes(String(preferred?.direction || "").toLowerCase()) &&
    Number.isFinite(Number(preferred?.zoneLow)) &&
    Number.isFinite(Number(preferred?.zoneHigh));

  const activeEntryAreas = deterministicAreas.map((area, index) => ({
    rank: Number(area?.rank || area?.executionOrder || index + 1),
    role:
      area?.role ||
      (index === 0 ? "primary" : index === 1 ? "secondary" : "alternative"),
    direction: String(area?.direction || "none").toLowerCase(),
    areaType: String(area?.areaType || "none").toLowerCase(),
    zoneLow: Number.isFinite(Number(area?.zoneLow))
      ? Number(area.zoneLow)
      : null,
    zoneHigh: Number.isFinite(Number(area?.zoneHigh))
      ? Number(area.zoneHigh)
      : null,
    zoneText:
      safeUserText(area?.levelText || "")
        ? `around ${safeUserText(area.levelText)}`
        : String(area?.zoneText || "").trim(),
    authoritativeCenter: asPositiveNumber(area?.authoritativeCenter),
    levelText: safeUserText(area?.levelText || ""),
    state: String(area?.state || "active").toLowerCase(),
    sourceReason: safeUserText(area?.sourceReason || ""),
    priceStatus: "not reached",
    areaVisuallyReached: false,
    areaReachEvidence: null,
    areaReachPrice: null,
    areaReachTime: null,
    triggerPresent: false,
    triggerAtAreaVisible: false,
    triggerEvidence: null,
    triggerEvidenceTime: null,
    triggerDescription: null,
  }));

  const preferredEntryArea = hasPreferred
    ? {
        direction: String(preferred.direction).toLowerCase(),
        areaType: String(preferred.areaType || "none").toLowerCase(),
        zoneLow: Number(preferred.zoneLow),
        zoneHigh: Number(preferred.zoneHigh),
        zoneText:
          safeUserText(preferred.levelText || "")
            ? `around ${safeUserText(preferred.levelText)}`
            : String(preferred.zoneText || "").trim(),
        authoritativeCenter: asPositiveNumber(preferred.authoritativeCenter),
        levelText: safeUserText(preferred.levelText || ""),
        priceStatus: String(preferred.priceStatus || "not_reached")
          .replace(/_/g, " ")
          .toLowerCase(),
        areaVisuallyReached: preferred.areaRetested === true,
        areaReachEvidence:
          preferred.areaRetested === true
            ? safeUserText(preferred.areaReachEvidence || "")
            : null,
        areaReachPrice:
          preferred.areaRetested === true
            ? asPositiveNumber(preferred.areaReachPrice)
            : null,
        areaReachTime:
          preferred.areaRetested === true
            ? safeUserText(preferred.areaReachTime || "")
            : null,
        triggerPresent: preferred.triggerPresent === true,
        triggerAtAreaVisible: preferred.triggerPresent === true,
        triggerEvidence:
          preferred.triggerPresent === true
            ? safeUserText(preferred.triggerEvidence || "")
            : null,
        triggerEvidenceTime:
          preferred.triggerPresent === true
            ? safeUserText(preferred.triggerEvidenceTime || "")
            : null,
        triggerDescription:
          preferred.triggerPresent === true
            ? safeUserText(preferred.triggerDescription || "")
            : null,
      }
    : {
        direction: "none",
        areaType: "none",
        zoneLow: null,
        zoneHigh: null,
        zoneText: "",
        priceStatus: "unclear",
        areaVisuallyReached: false,
        areaReachEvidence: null,
        areaReachPrice: null,
        areaReachTime: null,
        triggerPresent: false,
        triggerAtAreaVisible: false,
        triggerEvidence: null,
        triggerEvidenceTime: null,
        triggerDescription: null,
      };

  const preferredExactText =
    safeUserText(preferred.levelText || "") ||
    (
      Number.isFinite(Number(preferred.authoritativeCenter))
        ? formatPrice(preferred.authoritativeCenter)
        : ""
    );

  const preferredText = hasPreferred
    ? preferredExactText
      ? `${preferred.areaType} around ${preferredExactText}`
      : `${preferred.areaType} ${String(preferred.zoneText || "").replace(/^around\s+/i, "")}`
          .replace(/\s+/g, " ")
          .trim()
    : "";

  const secondaryVisualArea =
    activeEntryAreas.length > 1 ? activeEntryAreas[1] : null;

  const secondaryVisualText = secondaryVisualArea
    ? `${secondaryVisualArea.areaType} ${
        safeUserText(secondaryVisualArea.levelText || "")
          ? `around ${safeUserText(secondaryVisualArea.levelText)}`
          : String(secondaryVisualArea.zoneText || "").trim()
      }`
        .replace(/\s+/g, " ")
        .trim()
    : "";

  const bestAreaToWatch = hasPreferred
    ? preferred.direction === "sell"
      ? `Entry 1 is ${preferredText}. Wait for a fresh bearish trigger there before considering a sell.` +
        (secondaryVisualText
          ? ` If Entry 1 fails, Entry 2 is ${secondaryVisualText}; wait for a new bearish trigger there and do not add to a losing Entry 1.`
          : "")
      : `Entry 1 is ${preferredText}. Wait for a fresh bullish trigger there before considering a buy.` +
        (secondaryVisualText
          ? ` If Entry 1 fails, Entry 2 is ${secondaryVisualText}; wait for a new bullish trigger there and do not add to a losing Entry 1.`
          : "")
    : facts.direction === "bearish"
    ? "No strong resistance or supply entry area has passed the internal quality checks yet."
    : facts.direction === "bullish"
    ? "No strong support or demand entry area has passed the internal quality checks yet."
    : "No strong entry area has been confirmed yet.";

  const coachVerdict = hasPreferred
    ? preferred.direction === "sell"
      ? `Entry 1 is ${preferredText}. Wait for a fresh bearish trigger there and avoid chasing price.` +
        (secondaryVisualText
          ? ` If Entry 1 fails, Entry 2 is ${secondaryVisualText}; require a new bearish trigger before considering it.`
          : "")
      : `Entry 1 is ${preferredText}. Wait for a fresh bullish trigger there and avoid chasing price.` +
        (secondaryVisualText
          ? ` If Entry 1 fails, Entry 2 is ${secondaryVisualText}; require a new bullish trigger before considering it.`
          : "")
    : "No strong entry area is confirmed yet, so avoid forcing a trade.";

  return {
    ...visualReview,
    activeEntryAreas,
    preferredEntryArea,
    bestAreaToWatch,
    coachVerdict,
  };
}


function directionDisplay(facts) {
  if (
    facts.historicalCutoff?.active &&
    facts.historicalPhase?.phase === "bearish_breakdown"
  ) {
    return "Bearish after a strong breakdown";
  }

  if (
    facts.historicalCutoff?.active &&
    facts.historicalPhase?.phase ===
      "bullish_recovery_after_bearish_breakdown"
  ) {
    return "Bearish structure with a strong bullish recovery";
  }

  if (
    facts.historicalCutoff?.active &&
    facts.historicalPhase?.phase === "bullish_breakout"
  ) {
    return "Bullish after a strong breakout";
  }

  if (
    facts.historicalCutoff?.active &&
    facts.historicalPhase?.phase ===
      "bearish_pullback_after_bullish_breakout"
  ) {
    return "Bullish structure with a strong bearish pullback";
  }

  if (facts.direction === "bearish") {
    if (facts.transitionState?.bullishRecoveryAfterBreakdown) {
      return "Bearish structure with a strong bullish recovery";
    }

    if (facts.breakoutState?.bearishBreakdown) {
      return facts.breakoutState.extended
        ? "Bearish after a strong breakdown, with price approaching support"
        : "Bearish after a strong breakdown";
    }

    return facts.shortTermCondition === "consolidation"
      ? "Bearish with short-term consolidation"
      : facts.shortTermCondition === "pullback"
      ? "Bearish with a short-term pullback"
      : "Bearish";
  }

  if (facts.direction === "bullish") {
    if (facts.transitionState?.bearishPullbackAfterBreakout) {
      return "Bullish structure with a strong bearish pullback";
    }

    if (facts.breakoutState?.bullishBreakout) {
      return facts.breakoutState.extended
        ? "Bullish after a strong breakout, with price approaching resistance"
        : "Bullish after a strong breakout";
    }

    return facts.shortTermCondition === "consolidation"
      ? "Bullish with short-term consolidation"
      : facts.shortTermCondition === "pullback"
      ? "Bullish with a short-term pullback"
      : "Bullish";
  }

  return "Range-bound";
}

function controlledScores(facts) {
  const tradeVisible =
    facts?.trade?.visible === true;

  const area =
    facts?.preferredEntryArea || {};

  const hasValidatedArea =
    area?.validated === true &&
    area?.directionMatch === true;

  // Setup quality is always assessable from the chart plan.
  let setup =
    facts.direction === "range"
      ? 52
      : 66;

  if (hasValidatedArea) {
    setup += 6;
  } else {
    setup -= 8;
  }

  if (
    facts?.confluence?.strength === "high"
  ) {
    setup += 8;
  } else if (
    facts?.confluence?.strength === "medium"
  ) {
    setup += 4;
  }

  if (area?.invalidated) {
    setup -= 22;
  } else if (
    area?.lifecycleStatus === "respected"
  ) {
    setup += 8;
  } else if (
    area?.lifecycleStatus === "triggered"
  ) {
    setup += 12;
  }

  if (!area?.areaRetested) {
    setup = Math.min(setup, 68);
  }

  // Entry Accuracy becomes Entry Readiness when no executed
  // trade is clearly visible.
  let entry;

  if (tradeVisible) {
    entry = 58;

    if (area?.areaRetested) {
      entry += 12;
    }

    if (area?.triggerPresent) {
      entry += 20;
    }

    if (!area?.areaRetested) {
      entry = Math.min(entry, 45);
    }

    if (!area?.triggerPresent) {
      entry = Math.min(entry, 55);
    }

    if (
      !area?.areaRetested &&
      !area?.triggerPresent
    ) {
      entry = Math.min(entry, 45);
    }

    if (area?.invalidated) {
      entry -= 20;
    }
  } else {
    entry =
      hasValidatedArea
        ? 58
        : 52;

    if (area?.areaRetested) {
      entry += 8;
    }

    if (area?.triggerPresent) {
      entry += 14;
    }

    if (
      area?.lifecycleStatus === "respected"
    ) {
      entry += 4;
    }

    if (area?.invalidated) {
      entry -= 12;
    }

    if (!hasValidatedArea) {
      entry = Math.min(entry, 55);
    }

    // Waiting for confirmation at a valid area is disciplined
    // behavior, not a bad executed entry.
    if (
      hasValidatedArea &&
      !area?.triggerPresent
    ) {
      entry = Math.max(entry, 58);
    }

    entry = Math.min(entry, 78);
  }

  // Risk Management becomes Risk-Plan Completeness when no
  // executed trade is visible.
  let risk;

  if (tradeVisible) {
    risk = 35;

    if (facts?.risk?.stopShown) {
      risk += 25;
    }

    if (facts?.risk?.targetShown) {
      risk += 25;
    }

    if (facts?.risk?.assessable) {
      risk += 10;
    }
  } else {
    const stopShown =
      facts?.risk?.stopShown === true;

    const targetShown =
      facts?.risk?.targetShown === true;

    if (stopShown && targetShown) {
      risk = 74;
    } else if (stopShown || targetShown) {
      risk = 62;
    } else {
      risk = 55;
    }
  }

  setup = Math.max(
    0,
    Math.min(100, Math.round(setup))
  );

  entry = Math.max(
    0,
    Math.min(100, Math.round(entry))
  );

  risk = Math.max(
    0,
    Math.min(100, Math.round(risk))
  );

  // Executed trade: equal weighting.
  // No visible trade: weight what is actually observable.
  const overall =
    tradeVisible
      ? Math.round(
          (setup + entry + risk) / 3
        )
      : Math.round(
          setup * 0.55 +
          entry * 0.30 +
          risk * 0.15
        );

  return {
    setupQuality: setup,
    entryAccuracy: entry,
    riskManagement: risk,
    overall,
    assessmentMode:
      tradeVisible
        ? "executed_trade"
        : "setup_readiness",
    entryMetricMode:
      tradeVisible
        ? "execution_accuracy"
        : "entry_readiness",
    riskMetricMode:
      tradeVisible
        ? "executed_trade_risk"
        : "risk_plan_completeness",
    weights:
      tradeVisible
        ? {
            setupQuality: 1 / 3,
            entryAccuracy: 1 / 3,
            riskManagement: 1 / 3,
          }
        : {
            setupQuality: 0.55,
            entryAccuracy: 0.30,
            riskManagement: 0.15,
          },
  };
}

function controlledScoreLabel(score) {
  return score >= 85
    ? "Excellent"
    : score >= 75
    ? "Good"
    : score >= 60
    ? "Fair"
    : score >= 40
    ? "Needs work"
    : "Weak";
}

function gradeFromControlledScore(score) {
  return score >= 85 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
}

function buildEvidenceAwareDisplayLabels(scoreContext = {}) {
  const tradeVisible =
    scoreContext?.tradeVisible === true;

  return {
    overall:
      tradeVisible
        ? "Overall Grade"
        : "Overall Setup Readiness",
    setupQuality:
      "Setup Quality",
    entryAccuracy:
      tradeVisible
        ? "Entry Accuracy"
        : "Entry Readiness",
    riskManagement:
      tradeVisible
        ? "Risk Management"
        : "Risk Plan",
    assessmentMode:
      tradeVisible
        ? "Executed Trade"
        : "Setup Readiness",
  };
}

function buildControlledFeedback({
  facts,
  plan = "starter",
  analysisFramework = "csa",
  personalStrategyAssessment = null,
}) {
  const selectedEntryAreas =
    getCanonicalSelectedEntryAreas(
      facts
    );

  const selectedPrimaryArea =
    selectedEntryAreas[0] ||
    null;

  const selectedSecondaryArea =
    selectedEntryAreas[1] ||
    null;

  const area =
    facts.preferredEntryArea;

  const hasValidatedArea =
    facts.entryAreaValidation?.passed !== false &&
    area?.validated === true &&
    area?.areaType &&
    area.areaType !== "none" &&
    Number.isFinite(Number(area?.zoneLow)) &&
    Number.isFinite(Number(area?.zoneHigh)) &&
    selectedPrimaryArea !== null;
  const areaText =
    hasValidatedArea
      ? areaDisplay(facts)
      : "";

  const secondaryAreaText =
    selectedSecondaryArea
      ? formatRankedArea(
          selectedSecondaryArea,
          facts.direction === "bearish"
            ? "supply area"
            : "demand area"
        )
      : "";

  const referenceAreas = Array.isArray(facts?.structuralReferenceAreas)
    ? facts.structuralReferenceAreas
    : [];

  const referenceAreaTexts = referenceAreas
    .slice(0, 2)
    .map((reference) =>
      formatRankedArea(
        reference,
        facts.direction === "bearish"
          ? "resistance area"
          : "support area"
      )
    )
    .filter(Boolean);

  const referenceAreasText =
    referenceAreaTexts.length === 1
      ? referenceAreaTexts[0]
      : referenceAreaTexts.length >= 2
      ? `${referenceAreaTexts[0]} and ${referenceAreaTexts[1]}`
      : "";

  const directionText = directionDisplay(facts);
  const action = area.direction === "sell" ? "sell" : area.direction === "buy" ? "buy" : "trade";
  const opposingLevel = facts.direction === "bearish" ? "support" : "resistance";
  const triggerSide = facts.direction === "bearish" ? "bearish" : facts.direction === "bullish" ? "bullish" : "valid";

  const strengths = [];

  if (facts.historicalCutoff?.active) {
    strengths.push(
      `The analysis is restricted to market information available up to ${facts.historicalCutoff.selectedDate}.`
    );
  }

  if (facts.direction === "bearish") {
    strengths.push(
      facts.transitionState?.bullishRecoveryAfterBreakdown
        ? "The earlier bearish breakdown and the strong bullish recovery are identified separately."
        : facts.breakoutState?.bearishBreakdown
        ? "The strong bearish breakdown and continuation are identified correctly."
        : "The bearish market direction is identified correctly."
    );
  } else if (facts.direction === "bullish") {
    strengths.push(
      facts.transitionState?.bearishPullbackAfterBreakout
        ? "The earlier bullish breakout and the strong bearish pullback are identified separately."
        : facts.breakoutState?.bullishBreakout
        ? "The strong bullish breakout and continuation are identified correctly."
        : "The bullish market direction is identified correctly."
    );
  } else {
    strengths.push("The chart correctly shows that price is currently range-bound.");
  }

  if (!hasValidatedArea) {
    strengths.push(
      "The analysis avoids forcing a weak or contradictory entry area."
    );
  }

  if (facts.confluence.strength === "high") {
    strengths.push(
      "The planned area is supported by several matching chart factors, which improves its quality."
    );
  } else {
    strengths.push(
      "The important support and resistance areas are visible and can be used to judge where price is trading."
    );
  }

  if (facts.direction === "bearish") {
    strengths.push(
      "The plan avoids chasing a sell while price remains close to support."
    );
  } else if (facts.direction === "bullish") {
    strengths.push(
      "The plan avoids chasing a buy while price remains close to resistance."
    );
  } else {
    strengths.push(
      "The plan waits for price to reach a better area instead of entering in the middle."
    );
  }

  const weaknesses = [];

  if (facts.entryAreaValidation?.passed === false) {
    weaknesses.push(
      "The entry-area validation gates rejected one or more contradictory or incorrectly ordered levels, so no unverified area should be used."
    );
  }

  if (!hasValidatedArea) {
    weaknesses.push(
      facts.direction === "bearish"
        ? referenceAreasText
          ? `The nearby ${referenceAreasText} remain structural references, but neither currently qualifies as a strong sell entry.`
          : "No sufficiently strong resistance or supply area has been validated for the planned sell yet."
        : facts.direction === "bullish"
        ? referenceAreasText
          ? `The nearby ${referenceAreasText} remain structural references, but neither currently qualifies as a strong buy entry.`
          : "No sufficiently strong support or demand area has been validated for the planned buy yet."
        : "No sufficiently strong entry area has been validated yet."
    );
  } else if (area.invalidated) {
    weaknesses.push(
      `The previous ${area.areaType} area has failed and should no longer be used for the original ${action} idea.`
    );
  } else {
    if (!area.areaRetested) {
      weaknesses.push(
        area.areaType === "converted resistance"
          ? "The broken support has not yet been confirmed as resistance through a retest from below."
          : area.areaType === "converted support"
          ? "The broken resistance has not yet been confirmed as support through a retest from above."
          : `Price has not yet retested the planned ${area.areaType} area, so there is no confirmed entry yet.`
      );
    }

    if (!area.triggerPresent) {
      weaknesses.push(
        area.areaType === "converted resistance"
          ? "No fresh bearish rejection is visible at the potential resistance area yet."
          : area.areaType === "converted support"
          ? "No fresh bullish hold is visible at the potential support area yet."
          : `No fresh ${triggerSide} trigger is visible at the planned ${area.areaType} area yet.`
      );
    }
  }

  if (facts.transitionState?.bullishRecoveryAfterBreakdown) {
    weaknesses.push(
      "The bullish recovery has not yet broken and held above the main resistance, so the broader bearish structure is not fully reversed."
    );
  } else if (facts.transitionState?.bearishPullbackAfterBreakout) {
    weaknesses.push(
      "The bearish pullback has not yet broken and held below the main support, so the broader bullish structure is not fully reversed."
    );
  }

  if (
    facts.breakoutState?.extended &&
    facts.direction === "bullish"
  ) {
    weaknesses.push(
      "Price is already close to resistance after the sharp bullish move, so buying now may offer poor risk-to-reward."
    );
  } else if (
    facts.breakoutState?.extended &&
    facts.direction === "bearish"
  ) {
    weaknesses.push(
      "Price is already close to support after the sharp bearish move, so selling now may offer poor risk-to-reward."
    );
  }

  if (!facts.risk.assessable) {
    weaknesses.push(
      "A stop loss and target are not both clearly shown, so the planned risk cannot yet be fully assessed."
    );
  }

  if (
    facts.convertedLevel.detected &&
    ["broken", "potential_conversion"].includes(facts.convertedLevel.state)
  ) {
    weaknesses.push(
      facts.convertedLevel.assessment ||
        "The broken level still needs an opposite-side retest before its new role is confirmed."
    );
  }

  const lockedStrengths =
    sanitizeRawEntryNarrativeItems({
      items:
        cleanUserFeedbackItems(
          strengths
        ),
      facts,
    });

  // Re-add only the canonical deterministic entry statements after
  // removing any raw/legacy recommendation-like wording.
  const canonicalStrengths = [
    ...lockedStrengths,
  ];

  if (
    hasValidatedArea &&
    !area.invalidated
  ) {
    const canonicalPrimaryText =
      area.areaType ===
        "converted resistance"
        ? area.conversionConfirmed
          ? `The broken support ${area.zoneText} has been confirmed as converted resistance and is the first sell area to monitor.`
          : `The broken support ${area.zoneText} is a potential converted resistance and is the first sell area to monitor if price retests it from below.`
        : area.areaType ===
          "converted support"
        ? area.conversionConfirmed
          ? `The broken resistance ${area.zoneText} has been confirmed as converted support and is the first buy area to monitor.`
          : `The broken resistance ${area.zoneText} is a potential converted support and is the first buy area to monitor if price retests it from above.`
        : `Entry 1 is the ${areaText}; this is the first ${action} area to monitor.`;

    canonicalStrengths.push(
      canonicalPrimaryText
    );
  }

  if (secondaryAreaText) {
    canonicalStrengths.push(
      `Entry 2 is the ${secondaryAreaText}; consider it only if Entry 1 fails and a fresh ${triggerSide} trigger appears there.`
    );
  }

  const finalStrengths =
    removeSemanticFeedbackDuplicates(
      cleanUserFeedbackItems(
        canonicalStrengths
      ),
      4
    );
  let finalWeaknesses = prioritizeStarterWeaknesses(
    removeSemanticFeedbackDuplicates(cleanUserFeedbackItems(weaknesses), 4)
  );

  if (!finalWeaknesses.length) {
    finalWeaknesses = [
      "No major weakness was confirmed from the visible information, but the entry, stop loss, and target should remain clearly marked."
    ];
  }

  let nextAction;

  if (!hasValidatedArea) {
    nextAction =
      facts.direction === "bearish"
        ? referenceAreasText
          ? `No strong sell entry is confirmed yet. The ${referenceAreasText} are the main structural areas to watch, but they are reference areas only and should not be treated as Entry 1 or Entry 2 unless they later meet the full setup rules. Avoid forcing a sell; wait for a stronger resistance or supply setup and a fresh bearish rejection.`
          : "No high-quality resistance or supply entry area is confirmed yet. Avoid forcing a sell location. Wait for price to retrace into a clearly validated resistance or supply zone, then require a fresh bearish rejection."
        : facts.direction === "bullish"
        ? referenceAreasText
          ? `No strong buy entry is confirmed yet. The ${referenceAreasText} are the main structural areas to watch, but they are reference areas only and should not be treated as Entry 1 or Entry 2 unless they later meet the full setup rules. Avoid forcing a buy; wait for a stronger support or demand setup and a fresh bullish hold.`
          : "No high-quality support or demand entry area is confirmed yet. Avoid forcing a buy location. Wait for price to return into a clearly validated support or demand zone, then require a fresh bullish hold."
        : "No high-quality entry area is confirmed yet. Wait for a clearly validated support or resistance zone and a fresh trigger.";
  } else if (
    facts.transitionState?.bullishRecoveryAfterBreakdown &&
    !area.invalidated
  ) {
    nextAction =
      `Treat this as a transition, not a confirmed bullish trend. Wait to see whether the recovery rejects from the ${areaText} or breaks and holds above it. Avoid buying after the sharp recovery and avoid selling without a clear bearish rejection.`;
  } else if (
    facts.transitionState?.bearishPullbackAfterBreakout &&
    !area.invalidated
  ) {
    nextAction =
      `Treat this as a transition, not a confirmed bearish trend. Wait to see whether the pullback holds at the ${areaText} or breaks and holds below it. Avoid selling after the sharp drop and avoid buying without a clear bullish hold.`;
  } else if (
    facts.breakoutState?.bullishBreakout &&
    facts.breakoutState?.extended &&
    !area.invalidated
  ) {
    nextAction =
      `Do not chase the current bullish move near resistance. Entry 1 is the ${areaText}; wait for price to pull back there and show a fresh bullish hold before considering a buy.` +
      (secondaryAreaText
        ? ` If Entry 1 fails by breaking below and holding, Entry 2 is the ${secondaryAreaText}; only consider it after a new bullish trigger appears there. Do not add to a losing Entry 1.`
        : "") +
      ` Alternatively, wait for a clean breakout and hold above the upper resistance before looking for continuation.`;
  } else if (
    facts.breakoutState?.bearishBreakdown &&
    facts.breakoutState?.extended &&
    !area.invalidated
  ) {
    nextAction =
      `Do not chase the current bearish move near support. Entry 1 is the ${areaText}; wait for price to retrace there and show a fresh bearish rejection before considering a sell.` +
      (secondaryAreaText
        ? ` If Entry 1 fails by breaking above and holding, Entry 2 is the ${secondaryAreaText}; only consider it after a new bearish trigger appears there. Do not add to a losing Entry 1.`
        : "") +
      ` Alternatively, wait for a clean breakdown and hold below the lower support before looking for continuation.`;
  } else if (area.invalidated) {
    if (facts.direction === "bearish") {
      nextAction =
        `Do not reuse the failed ${area.areaType} area for another sell. Wait for a new supply or confirmed resistance area to form, then require a fresh bearish trigger before considering the next setup.`;
    } else if (facts.direction === "bullish") {
      nextAction =
        `Do not reuse the failed ${area.areaType} area for another buy. Wait for a new demand or confirmed support area to form, then require a fresh bullish trigger before considering the next setup.`;
    } else {
      nextAction =
        "The previous area has failed. Wait for a new support or resistance area and a fresh valid trigger before considering another trade.";
    }
  } else if (facts.direction === "bearish") {
    nextAction =
      `Entry 1 is the ${areaText}. Wait for price to retrace there and show a fresh bearish rejection before considering a sell.` +
      (secondaryAreaText
        ? ` If Entry 1 fails by breaking above and holding, Entry 2 is the ${secondaryAreaText}. Only consider Entry 2 after a new bearish trigger appears there, and do not add to a losing Entry 1.`
        : "") +
      ` Make sure there is enough room to the next support for a reasonable risk-to-reward ratio. Do not chase a sell while price remains close to support.`;
  } else if (facts.direction === "bullish") {
    nextAction =
      `Entry 1 is the ${areaText}. Wait for price to return there and show a fresh bullish hold before considering a buy.` +
      (secondaryAreaText
        ? ` If Entry 1 fails by breaking below and holding, Entry 2 is the ${secondaryAreaText}. Only consider Entry 2 after a new bullish trigger appears there, and do not add to a losing Entry 1.`
        : "") +
      ` Make sure there is enough room to the next resistance for a reasonable risk-to-reward ratio. Do not chase a buy while price remains close to resistance.`;
  } else {
    nextAction =
      "Wait for price to reach a clearly defined support or resistance area and show a valid trigger before considering a trade. Avoid entering in the middle of the range.";
  }

  if (facts.historicalCutoff?.active) {
    nextAction =
      `${nextAction} This review excludes candles formed after ${facts.historicalCutoff.selectedDate}.`;
  }

  const scores =
    controlledScores(facts);

  const scoreContext = {
    scoringModelVersion:
      CSA_SCORING_MODEL_VERSION,
    tradeVisible:
      facts?.trade?.visible === true,
    assessmentMode:
      scores.assessmentMode,
    entryMetricMode:
      scores.entryMetricMode,
    riskMetricMode:
      scores.riskMetricMode,
    weights:
      scores.weights,
  };

  const displayLabels =
    buildEvidenceAwareDisplayLabels(
      scoreContext
    );

  const starterSections = [
    "DIRECTIONAL BIAS:",
    directionText,
    "",
    "WHAT YOU DID WELL:",
    ...finalStrengths.map((item) => `- ${item}`),
    "",
    "WHAT TO IMPROVE:",
    ...finalWeaknesses.map((item) => `- ${item}`),
    "",
    "NEXT ACTION:",
    nextAction,
  ];

  const proSections = [
    ...starterSections,
    "",
    "CHART LEVELS:",
    hasValidatedArea
      ? `- Primary area: ${areaText}.`
      : referenceAreasText
      ? `- Structural reference areas: ${referenceAreasText}. These are not validated entries yet.`
      : "- No validated primary entry area was confirmed.",
    secondaryAreaText
      ? `- Secondary area: ${secondaryAreaText}.`
      : "- No separate secondary area was confirmed.",
    `- Area status: ${area.lifecycleStatus.replace(/_/g, " ")}.`,
    facts.convertedLevel.detected
      ? `- Converted level: ${facts.convertedLevel.state.replace(/_/g, " ")}.`
      : "- No converted level was confirmed from the available evidence.",
    "",
    "SETUP READINESS:",
    `- Area reached: ${area.areaRetested ? "Yes" : "No"}.`,
    `- Valid trigger present: ${area.triggerPresent ? "Yes" : "No"}.`,
    `- Stop shown: ${facts.risk.stopShown ? "Yes" : "No"}.`,
    `- Target shown: ${facts.risk.targetShown ? "Yes" : "No"}.`,
    "",
    "RISK & TRADE MANAGEMENT:",
    facts.risk.assessable
      ? "- The visible stop and target allow the planned risk to be reviewed."
      : "- Add a clear invalidation point, target and position-risk plan before execution.",
    "- First target should normally be the next opposing support or resistance area.",
  ];

  const eliteSections = [
    ...proSections,
    "",
    "ADVANCED COACHING:",
    `- Confluence strength: ${facts.confluence.strength}.`,
    `- Area lifecycle: ${area.lifecycleStatus.replace(/_/g, " ")}.`,
    facts.trade.visible
      ? `- Trade outcome: ${facts.trade.outcome.replace(/_/g, " ")}.`
      : "- No executed trade was clearly visible, so outcome quality was not judged.",
    analysisFramework === "personal_strategy" && personalStrategyAssessment
      ? `- Personal strategy match: ${
          personalStrategyAssessment.strategyMatchScore ?? "Not enough evidence"
        }%.`
      : "- Personal strategy comparison was not selected for this review.",
  ];

  const analysis =
    plan === "elite"
      ? eliteSections.join("\n")
      : plan === "pro"
      ? proSections.join("\n")
      : starterSections.join("\n");

  return {
    engineVersion: CSA_FEEDBACK_ENGINE_VERSION,
    plan,
    analysis,
    directionalBias: directionText,
    strengths: finalStrengths,
    weaknesses: finalWeaknesses,
    nextAction,
    entry1: hasValidatedArea
      ? {
          areaType: area.areaType,
          zoneText: area.zoneText,
          authoritativeCenter: asPositiveNumber(area.authoritativeCenter),
          levelText: safeUserText(area.levelText || ""),
        }
      : null,
    entry2:
      selectedSecondaryArea
        ? {
            areaType:
              selectedSecondaryArea.areaType,
            zoneText:
              selectedSecondaryArea.zoneText,
            authoritativeCenter:
              asPositiveNumber(
                selectedSecondaryArea
                  .authoritativeCenter
              ),
            levelText:
              safeUserText(
                selectedSecondaryArea
                  .levelText || ""
              ),
          }
        : null,
    narrativeLock: {
      version:
        "1.0.0-selected-entry-single-source",
      selectedEntryCount:
        selectedEntryAreas.length,
      selectedEntries:
        selectedEntryAreas.map(
          (entry, index) => ({
            executionOrder:
              Number(
                entry?.executionOrder ||
                  entry?.rank ||
                  index + 1
              ),
            areaType:
              entry?.areaType || null,
            levelText:
              safeUserText(
                entry?.levelText || ""
              ),
            authoritativeCenter:
              asPositiveNumber(
                entry?.authoritativeCenter
              ),
          })
        ),
      entry2Allowed:
        selectedEntryAreas.length > 1,
      rule:
        "unselected_structural_levels_are_context_only",
    },
    scores,
    scoreContext,
    displayLabels,
    overallDisplayLabel:
      displayLabels.overall,
    setupQualityDisplayLabel:
      displayLabels.setupQuality,
    entryAccuracyDisplayLabel:
      displayLabels.entryAccuracy,
    riskManagementDisplayLabel:
      displayLabels.riskManagement,
    setupQuality: {
      displayLabel:
        displayLabels.setupQuality,
      score:
        scores.setupQuality,
      label:
        controlledScoreLabel(
          scores.setupQuality
        ),
      summary:
        area.invalidated
          ? "The previous area has failed and the setup must be rebuilt."
          : area.triggerPresent
          ? "The location and trigger are aligned."
          : "The plan has a useful area, but the setup is not fully ready.",
    },
    entryAccuracy: {
      displayLabel:
        displayLabels.entryAccuracy,
      score:
        scores.entryAccuracy,
      label:
        controlledScoreLabel(
          scores.entryAccuracy
        ),
      summary:
        facts?.trade?.visible === true
          ? area.triggerPresent
            ? "A valid trigger is visible at the planned area."
            : "The visible entry still needs stronger confirmation at the planned area."
          : area.triggerPresent
          ? "No executed trade is clearly visible; this score reflects entry readiness, and a valid trigger is visible at the planned area."
          : "No executed trade is clearly visible; this score reflects entry readiness rather than execution accuracy.",
      assessmentMode:
        scores.entryMetricMode,
    },
    riskManagement: {
      displayLabel:
        displayLabels.riskManagement,
      score:
        scores.riskManagement,
      label:
        controlledScoreLabel(
          scores.riskManagement
        ),
      summary:
        facts?.trade?.visible === true
          ? facts.risk.assessable
            ? "The stop and target are visible enough to review risk."
            : "The stop and target are not both visible, so executed-trade risk is incomplete."
          : facts.risk.assessable
          ? "No executed trade is clearly visible; the stop and target make the planned risk assessable."
          : "No executed trade is clearly visible; this score reflects risk-plan completeness, not realized trade management.",
      assessmentMode:
        scores.riskMetricMode,
    },
    grade:
      gradeFromControlledScore(
        scores.overall
      ),
    overallDisplayLabel:
      displayLabels.overall,
    overallAssessmentModeLabel:
      displayLabels.assessmentMode,
    confidence:
      scores.overall,
    scoreDisplay: {
      overall: {
        label:
          displayLabels.overall,
        score:
          scores.overall,
        grade:
          gradeFromControlledScore(
            scores.overall
          ),
      },
      setupQuality: {
        key: "setupQuality",
        label:
          displayLabels.setupQuality,
        score:
          scores.setupQuality,
      },
      entryMetric: {
        key: "entryAccuracy",
        label:
          displayLabels.entryAccuracy,
        score:
          scores.entryAccuracy,
      },
      riskMetric: {
        key: "riskManagement",
        label:
          displayLabels.riskManagement,
        score:
          scores.riskManagement,
      },
    },
  };
}

function applyControlledFeedbackToDashboard(
  legacyDashboard = {},
  controlled = {}
) {
  return {
    ...legacyDashboard,
    strengths:
      controlled.strengths,
    weaknesses:
      controlled.weaknesses,
    setupQuality:
      controlled.setupQuality,
    entryAccuracy:
      controlled.entryAccuracy,
    riskManagement:
      controlled.riskManagement,
    setupQualityScore:
      controlled.scores.setupQuality,
    entryAccuracyScore:
      controlled.scores.entryAccuracy,
    riskManagementScore:
      controlled.scores.riskManagement,
    scoreContext:
      controlled.scoreContext || null,
    displayLabels:
      controlled.displayLabels || null,
    scoreDisplay:
      controlled.scoreDisplay || null,
    overallDisplayLabel:
      controlled.overallDisplayLabel ||
      controlled.displayLabels?.overall ||
      "Overall Grade",
    setupQualityDisplayLabel:
      controlled.setupQualityDisplayLabel ||
      controlled.displayLabels?.setupQuality ||
      "Setup Quality",
    entryAccuracyDisplayLabel:
      controlled.entryAccuracyDisplayLabel ||
      controlled.displayLabels?.entryAccuracy ||
      "Entry Accuracy",
    riskManagementDisplayLabel:
      controlled.riskManagementDisplayLabel ||
      controlled.displayLabels?.riskManagement ||
      "Risk Management",
    scores: {
      setupQuality:
        controlled.scores.setupQuality,
      entryAccuracy:
        controlled.scores.entryAccuracy,
      riskManagement:
        controlled.scores.riskManagement,
    },
  };
}

function buildStarterCoachSummary(options = {}) {
  const {
    bias = null,
    dashboardFeedback = null,
    visualReview = null,
    marketReference = null,
  } = options;

  const preferredArea =
    visualReview?.preferredEntryArea &&
    typeof visualReview.preferredEntryArea === "object"
      ? visualReview.preferredEntryArea
      : null;

  const visualDirection = String(
    visualReview?.shortTermDirection ||
      visualReview?.plainMarketDirection ||
      ""
  ).toLowerCase();

  const preferredDirection = String(
    preferredArea?.direction || ""
  ).toLowerCase();

  const backendDirection = String(
    bias?.bias || marketReference?.directionalBias?.bias || ""
  ).toLowerCase();

  let directionCode = "range";

  if (preferredDirection === "sell") {
    directionCode = "bearish";
  } else if (preferredDirection === "buy") {
    directionCode = "bullish";
  } else if (/bearish/.test(visualDirection)) {
    directionCode = "bearish";
  } else if (/bullish/.test(visualDirection)) {
    directionCode = "bullish";
  } else if (/bearish/.test(backendDirection)) {
    directionCode = "bearish";
  } else if (/bullish/.test(backendDirection)) {
    directionCode = "bullish";
  }

  const hasShortTermPause =
    /range|consolidat|bounce|pullback|sideways/.test(visualDirection);

  const directionalBias =
    directionCode === "bearish"
      ? hasShortTermPause
        ? "Bearish with short-term consolidation"
        : "Bearish"
      : directionCode === "bullish"
      ? hasShortTermPause
        ? "Bullish with short-term consolidation"
        : "Bullish"
      : "Range-bound";

  const areaTypeRaw = String(preferredArea?.areaType || "").toLowerCase();

  const areaType =
    areaTypeRaw && areaTypeRaw !== "none"
      ? areaTypeRaw
      : directionCode === "bearish"
      ? "supply"
      : directionCode === "bullish"
      ? "demand"
      : "entry";

  const nullablePositiveNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0
      ? numberValue
      : null;
  };

  let zoneLow = nullablePositiveNumber(preferredArea?.zoneLow);
  let zoneHigh = nullablePositiveNumber(preferredArea?.zoneHigh);

  let zoneText = String(preferredArea?.zoneText || "")
    .replace(/\s+/g, " ")
    .trim();

  const recoveredZoneRange = extractVisibleZoneRange(zoneText);

  if (zoneLow === null && recoveredZoneRange.low !== null) {
    zoneLow = recoveredZoneRange.low;
  }

  if (zoneHigh === null && recoveredZoneRange.high !== null) {
    zoneHigh = recoveredZoneRange.high;
  }

  if (zoneLow !== null && zoneHigh !== null) {
    const low = Math.min(zoneLow, zoneHigh);
    const high = Math.max(zoneLow, zoneHigh);

    zoneText =
      Math.abs(high - low) > 1e-10
        ? `around ${formatPrice(low)}–${formatPrice(high)}`
        : `around ${formatPrice(low)}`;
  }

  zoneText = removeWeekdayNamesFromUserText(zoneText)
    .replace(
      /^\s*(?:the\s+)?(?:marked\s+)?(?:supply|demand|support|resistance|converted support|converted resistance)\s+(?:area|zone)?\s*(?:around|near|at)?\s*/i,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  if (
    containsMalformedPriceRange(zoneText) ||
    /\b0(?:\.0+)?\b/.test(zoneText) ||
    /earlier period high|earlier period low/i.test(zoneText)
  ) {
    zoneText = "";
  }

  const areaLabel = zoneText
    ? `${areaType} area around ${zoneText.replace(/^around\s+/i, "")}`
    : `marked ${areaType} area`;

  const levels = Array.isArray(marketReference?.dailyLevels)
    ? marketReference.dailyLevels
    : [];

  const latestLevel = levels[levels.length - 1];
  const currentPrice = nullablePositiveNumber(latestLevel?.close);

  const priceStatus = String(
    preferredArea?.priceStatus || ""
  ).toLowerCase();

  let areaRetested =
    ["inside", "reacted", "moved away"].includes(priceStatus);

  if (directionCode === "bearish") {
    if (
      currentPrice !== null &&
      zoneLow !== null &&
      currentPrice < zoneLow
    ) {
      areaRetested = false;
    } else if (
      ["not reached", "approaching", "unclear"].includes(priceStatus)
    ) {
      areaRetested = false;
    }
  } else if (directionCode === "bullish") {
    if (
      currentPrice !== null &&
      zoneHigh !== null &&
      currentPrice > zoneHigh
    ) {
      areaRetested = false;
    } else if (
      ["not reached", "approaching", "unclear"].includes(priceStatus)
    ) {
      areaRetested = false;
    }
  }

  // A trigger only counts when price has actually reached the planned area.
  const triggerPresent =
    areaRetested && preferredArea?.triggerPresent === true;

  const riskEvidence = String(
    visualReview?.riskEvidence || ""
  ).toLowerCase();

  const stopOrTargetMissing =
    !riskEvidence ||
    /not shown|not visible|no visible|cannot be judged|cannot be assessed/.test(
      riskEvidence
    );

  const convertedLevelText = removeWeekdayNamesFromUserText(
    String(visualReview?.convertedLevelAssessment || "")
      .replace(/\s+/g, " ")
      .trim()
  );

  const strengths = [];

  if (directionCode === "bearish") {
    strengths.push("The bearish market direction is identified correctly.");
  } else if (directionCode === "bullish") {
    strengths.push("The bullish market direction is identified correctly.");
  } else {
    strengths.push("The chart correctly shows that price is currently range-bound.");
  }

  if (preferredArea) {
    strengths.push(
      `The marked ${areaLabel.replace(/^marked\s+/i, "")} gives a clear ${
        directionCode === "bearish"
          ? "sell"
          : directionCode === "bullish"
          ? "buy"
          : "trade"
      } location to monitor.`
    );
  }

  strengths.push(
    "The important support and resistance areas are visible and can be used to judge where price is trading."
  );

  if (directionCode === "bearish") {
    strengths.push(
      "The plan avoids chasing a sell while price remains close to support."
    );
  } else if (directionCode === "bullish") {
    strengths.push(
      "The plan avoids chasing a buy while price remains close to resistance."
    );
  } else {
    strengths.push(
      "The plan waits for price to reach a better area instead of entering in the middle."
    );
  }

  const weaknesses = [];

  if (!areaRetested) {
    weaknesses.push(
      `Price has not yet retested the planned ${areaType} area, so there is no confirmed entry yet.`
    );
  }

  if (!triggerPresent) {
    weaknesses.push(
      `No fresh ${
        directionCode === "bearish"
          ? "bearish"
          : directionCode === "bullish"
          ? "bullish"
          : "entry"
      } trigger is visible at the planned ${areaType} area yet.`
    );
  }

  if (stopOrTargetMissing) {
    weaknesses.push(
      "A stop loss and target are not clearly shown, so the planned risk cannot yet be assessed."
    );
  }

  const convertedLevelWasActuallyDetected =
    Boolean(convertedLevelText) &&
    /broken support|broken resistance|converted support|converted resistance|retest from below|retest from above|confirmed as support|confirmed as resistance/i.test(
      convertedLevelText
    );

  if (
    convertedLevelWasActuallyDetected &&
    /not confirmed|has not been confirmed|unconfirmed|needs a retest|retest from below|retest from above/i.test(
      convertedLevelText
    )
  ) {
    weaknesses.push(convertedLevelText);
  }

  const finalStrengths = cleanUserFeedbackItems(strengths).slice(0, 4);
  const finalWeaknesses = cleanUserFeedbackItems(weaknesses).slice(0, 4);

  let correctionAction;

  if (directionCode === "bearish") {
    correctionAction =
      `Wait for price to retrace towards the ${areaLabel} and show a clear bearish trigger before considering a sell. ` +
      "Make sure there is enough room to the next support for a reasonable risk-to-reward ratio. " +
      "Do not chase a sell while price remains close to support.";
  } else if (directionCode === "bullish") {
    correctionAction =
      `Wait for price to return towards the ${areaLabel} and show a clear bullish trigger before considering a buy. ` +
      "Make sure there is enough room to the next resistance for a reasonable risk-to-reward ratio. " +
      "Do not chase a buy while price remains close to resistance.";
  } else {
    correctionAction =
      "Wait for price to reach a clearly marked support or resistance area and show a valid entry trigger before considering a trade. Avoid entering in the middle of the range.";
  }

  correctionAction = removeWeekdayNamesFromUserText(correctionAction);

  if (
    containsMalformedPriceRange(correctionAction) ||
    /\b0(?:\.0+)?\b/.test(correctionAction)
  ) {
    correctionAction =
      directionCode === "bearish"
        ? "Wait for price to retrace towards the marked supply or resistance area and show a clear bearish trigger before considering a sell. Make sure there is enough space to the next support for a reasonable risk-to-reward ratio. Do not chase a sell while price remains close to support."
        : directionCode === "bullish"
        ? "Wait for price to return towards the marked demand or support area and show a clear bullish trigger before considering a buy. Make sure there is enough space to the next resistance for a reasonable risk-to-reward ratio. Do not chase a buy while price remains close to resistance."
        : "Wait for price to reach a clearly marked support or resistance area and show a valid entry trigger before considering a trade.";
  }

  return [
    "DIRECTIONAL BIAS:",
    directionalBias,
    "",
    "WHAT YOU DID WELL:",
    ...finalStrengths.map((item) => `- ${item}`),
    "",
    "WHAT TO IMPROVE:",
    ...finalWeaknesses.map((item) => `- ${item}`),
    "",
    "NEXT ACTION:",
    correctionAction,
  ].join("\n");
}

function extractStarterSummarySections(summary = "") {
  const text = String(summary || "");

  const strengthsMatch = text.match(
    /WHAT YOU DID WELL:\s*([\s\S]*?)\s*WHAT TO IMPROVE:/i
  );
  const weaknessesMatch = text.match(
    /WHAT TO IMPROVE:\s*([\s\S]*?)\s*NEXT ACTION:/i
  );

  const parseBullets = (block = "") =>
    block
      .split("\n")
      .map((line) => line.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);

  return {
    strengths: parseBullets(strengthsMatch?.[1] || "").slice(0, 4),
    weaknesses: parseBullets(weaknessesMatch?.[1] || "").slice(0, 4),
  };
}

function evidenceSafeMistakeHub(
  items = [],
  tradeVisible = false
) {
  if (tradeVisible) {
    return Array.isArray(items)
      ? items
      : [];
  }

  // If no executed trade is visible, prospective readiness
  // issues must not be presented as mistakes already made.
  const blockedTitles =
    new Set([
      "no visible trigger",
      "context only, no trigger",
      "entry evidence weak",
      "risk evidence unclear",
    ]);

  const filtered =
    (Array.isArray(items)
      ? items
      : []
    ).filter((item) => {
      const title =
        String(item?.title || "")
          .trim()
          .toLowerCase();

      return !blockedTitles.has(title);
    });

  return filtered.length
    ? filtered.slice(0, 5)
    : [
        makeSimpleMistake(
          "No executed-trade mistake confirmed",
          "REVIEW"
        ),
      ];
}

function applyPlanToAnalysisResponse({
  responseBody,
  entitlement,
}) {
  const controlled =
    responseBody?.finalFeedback &&
    typeof responseBody.finalFeedback === "object"
      ? responseBody.finalFeedback
      : null;

  if (!controlled) return responseBody;

  const plan =
    normalizePlanCode(
      entitlement?.effectivePlan ||
        controlled.plan ||
        "starter"
    );

  const tradeVisible =
    controlled?.scoreContext
      ?.tradeVisible === true;

  const sourceMistakes =
    responseBody?.aiMistakeDetectionHub ||
    responseBody?.mistakeDetectionHub ||
    responseBody?.mistakeHub ||
    responseBody?.mistakes ||
    responseBody?.dashboard
      ?.aiMistakeDetectionHub ||
    [];

  const safeMistakes =
    evidenceSafeMistakeHub(
      sourceMistakes,
      tradeVisible
    );

  const base = {
    ...responseBody,
    analysis: controlled.analysis,
    summary: controlled.analysis,
    coachAdvice: [controlled.analysis],
    strengths: controlled.strengths,
    whatYouDidWell: controlled.strengths,
    weaknesses: controlled.weaknesses,
    whatCostYouProfit: controlled.weaknesses,
    setupQuality: controlled.setupQuality,
    entryAccuracy: controlled.entryAccuracy,
    riskManagement: controlled.riskManagement,
    setupQualityScore: controlled.scores.setupQuality,
    entryAccuracyScore: controlled.scores.entryAccuracy,
    riskManagementScore: controlled.scores.riskManagement,
    structureScore: controlled.scores.setupQuality,
    executionScore: controlled.scores.entryAccuracy,
    riskScore: controlled.scores.riskManagement,
    confidence:
      controlled.confidence,
    grade:
      controlled.grade,
    scoreContext:
      controlled.scoreContext || null,
    displayLabels:
      controlled.displayLabels || null,
    scoreDisplay:
      controlled.scoreDisplay || null,
    overallDisplayLabel:
      controlled.overallDisplayLabel ||
      controlled.displayLabels?.overall ||
      "Overall Grade",
    setupQualityDisplayLabel:
      controlled.setupQualityDisplayLabel ||
      controlled.displayLabels?.setupQuality ||
      "Setup Quality",
    entryAccuracyDisplayLabel:
      controlled.entryAccuracyDisplayLabel ||
      controlled.displayLabels?.entryAccuracy ||
      "Entry Accuracy",
    riskManagementDisplayLabel:
      controlled.riskManagementDisplayLabel ||
      controlled.displayLabels?.riskManagement ||
      "Risk Management",
    mistakes:
      safeMistakes,
    mistakeHub:
      safeMistakes,
    mistakeDetectionHub:
      safeMistakes,
    aiMistakeDetectionHub:
      safeMistakes,
    dashboard: {
      ...(responseBody.dashboard || {}),
      strengths:
        controlled.strengths,
      weaknesses:
        controlled.weaknesses,
      setupQuality:
        controlled.setupQuality,
      entryAccuracy:
        controlled.entryAccuracy,
      riskManagement:
        controlled.riskManagement,
      scoreContext:
        controlled.scoreContext || null,
      displayLabels:
        controlled.displayLabels || null,
      scoreDisplay:
        controlled.scoreDisplay || null,
      overallDisplayLabel:
        controlled.overallDisplayLabel ||
        controlled.displayLabels?.overall ||
        "Overall Grade",
      setupQualityDisplayLabel:
        controlled.setupQualityDisplayLabel ||
        controlled.displayLabels?.setupQuality ||
        "Setup Quality",
      entryAccuracyDisplayLabel:
        controlled.entryAccuracyDisplayLabel ||
        controlled.displayLabels?.entryAccuracy ||
        "Entry Accuracy",
      riskManagementDisplayLabel:
        controlled.riskManagementDisplayLabel ||
        controlled.displayLabels?.riskManagement ||
        "Risk Management",
      mistakes:
        safeMistakes,
      mistakeHub:
        safeMistakes,
      mistakeDetectionHub:
        safeMistakes,
      aiMistakeDetectionHub:
        safeMistakes,
    },
  };

  if (plan !== "starter") {
    return {
      ...base,
      starterRestricted: false,
      lockedFeatures: [],
    };
  }

  return {
    ...base,
    mistakes: [],
    mistakeHub: [],
    mistakeDetectionHub: [],
    aiMistakeDetectionHub: [],
    journalTags: [
      "starter-review",
      "directional-bias",
      "setup-score",
      CSA_FEEDBACK_ENGINE_VERSION,
    ],
    visualReview: null,
    starterRestricted: true,
    lockedFeatures: [
      "fullAnalysis",
      "mistakeDetectionHub",
      "mistakeTracking",
      "advancedDashboard",
      "weeklyFocus",
    ],
    upgradeMessage:
      "Upgrade to Pro for deeper setup-readiness, risk, level-lifecycle and mistake analysis.",
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

app.get("/", (req, res) =>
  res.json({
    status: "ok",
    message: "CSA Coach backend is running",
    aiProvider: getActiveAiProvider(),
    aiModel:
      getActiveAiProvider() === "claude"
        ? CLAUDE_MODEL
        : "OpenAI models configured by each analysis task",
    aiConfigured: isAiProviderConfigured(),
  })
);
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    service: "csa-coach-claude-test",
    aiProvider: getActiveAiProvider(),
    aiModel:
      getActiveAiProvider() === "claude"
        ? CLAUDE_MODEL
        : "openai",
    aiConfigured: isAiProviderConfigured(),
    frontendUrl: FRONTEND_URL,
    time: new Date().toISOString(),
  })
);


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
      buildId: CSA_BUILD_ID,
      feedbackEngineVersion: CSA_FEEDBACK_ENGINE_VERSION,
      selectorVersion: CSA_SELECTOR_VERSION,
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
      buildId: CSA_BUILD_ID,
      feedbackEngineVersion:
        CSA_FEEDBACK_ENGINE_VERSION,
      selectorVersion:
        CSA_SELECTOR_VERSION,
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
    summary: "WAIT. Price has reached a resistance area after a bullish move, but there is no fresh confirmed trigger yet.\n\nWHAT THE CHART DOES WELL:\n- Support and resistance areas are clear.\n- The move from support toward resistance is easy to judge.\n\nMAIN RISK:\n- Entering now could mean buying directly into resistance or selling without confirmation.\n\nNEXT ACTION:\nWait for either a clean break-and-hold above resistance followed by a retest, or a clear bearish rejection before considering the next setup.\n\nREAD_MORE_DETAILS:\nThis sample is designed to demonstrate the dashboard experience. It is not live market analysis and should not be treated as a trade signal.",
    analysis: "WAIT. Price is at resistance without a fresh confirmed trigger.",
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

    if (!isAiProviderConfigured()) return res.status(500).json({ success: false, error: getAiConfigurationError() });
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
      cutoffMode = "final_visible",
      cutoffTime = "",
      timezoneMode = "device",
      browserTimezone = "",
      timezone = "",
      forceFreshAnalysis = "",
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
    const selectedDateText = chartDate || tradeDate || "";
    const selectedDate = parseISODateOnly(selectedDateText);
    const normalizedRequestedCutoffMode = normalizeCutoffMode(cutoffMode);
    const forceFresh =
      String(forceFreshAnalysis || "").trim().toLowerCase() === "true";

    // Selected-day reviews use a stable UTC day boundary.
    // Never allow the browser/device timezone to silently move the cutoff
    // into the previous or next trading day.
    const resolvedTimezone =
      normalizedRequestedCutoffMode === "selected_day"
        ? "UTC"
        : normalizeRequestedTimezone({
            timezone,
            timezoneMode,
            browserTimezone,
          });

    const analysisFingerprint = createAnalysisFingerprint({
      userId: requestAuth.user.id,
      fileBuffer: req.file.buffer,
      instrument: submittedInstrument,
      timeframe,
      analysisType: mode,
      chartDate: selectedDateText,
      timezone: resolvedTimezone,
      cutoffMode: normalizedRequestedCutoffMode,
      cutoffTime,
      timezoneMode:
        normalizedRequestedCutoffMode === "selected_day"
          ? "utc"
          : timezoneMode,
      browserTimezone:
        normalizedRequestedCutoffMode === "selected_day"
          ? ""
          : browserTimezone,
      analysisFramework: selectedStrategy.analysisFramework,
      strategyId:
        selectedStrategy.analysisFramework === "personal_strategy"
          ? selectedStrategy.strategy?.id || strategyId || ""
          : "",
      plan: entitlement.effectivePlan,
    });

    const cachedCompletedAnalysis = forceFresh
      ? null
      : getCachedCompletedAnalysis(analysisFingerprint);

    if (cachedCompletedAnalysis) {
      cachedCompletedAnalysis.entitlement = entitlement;
      cachedCompletedAnalysis.cacheHit = true;
      cachedCompletedAnalysis.analysisFingerprint = analysisFingerprint;
      cachedCompletedAnalysis.savedToJournal = false;
      cachedCompletedAnalysis.saveReason =
        "Identical chart and analysis inputs reused the previous completed result.";
      return res.json(cachedCompletedAnalysis);
    }

    assertAnalysisAllowed(entitlement);

    const chartDetection = await detectChartContextFromImage({ imageBase64, mimeType, submittedInstrument, selectedTimeframe: timeframe, selectedDateText, analysisType: mode });

    if (!chartDetection.isTradingChart) {
      const analysis = buildInvalidChartAnalysis({ submittedInstrument, timeframe, chartDetection });
      return stoppedResponse({ res, errorType: "invalid_chart_image", error: "Uploaded image is not a valid trading chart.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    if (!isUploadedChartDataUsable(chartDetection, selectedDateText)) {
      const analysis = buildInsufficientChartDataAnalysis({ submittedInstrument, timeframe, selectedDateText, chartDetection });
      return stoppedResponse({ res, errorType: "insufficient_chart_data", error: "Uploaded chart does not have enough visible price data for review.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    const dateMismatch =
      normalizedRequestedCutoffMode === "final_visible"
        ? { hasMismatch: false }
        : getSelectedDateMismatch(chartDetection, selectedDate, timeframe);

    if (dateMismatch.hasMismatch) {
      const analysis = buildDateMismatchAnalysis({ selectedDateText, chartDetection, dateMismatch });
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

    const dateDecision = chooseFinalChartDate({
      selectedDate,
      detection: chartDetection,
      analysisType: mode,
      cutoffMode: normalizedRequestedCutoffMode,
    });

    console.log("Chart date decision:", {
      cutoffMode: normalizedRequestedCutoffMode,
      selectedDate: dateDecision.selectedDateText,
      detectedVisibleDate: dateDecision.detectedDateText,
      finalAnalysisDate: dateDecision.finalDateText,
      selectedDateAdjusted: dateDecision.selectedDateAdjusted === true,
      source: dateDecision.source,
      reason: dateDecision.reason,
    });

    let chartCutoff = resolveTwelveDataChartCutoff({
      chartDetection,
      dateDecision,
      selectedDateText,
      cutoffMode: normalizedRequestedCutoffMode,
      cutoffTime,
      timeframe,
      analysisType: mode,
    });

    chartCutoff.timezone = resolvedTimezone;
    chartCutoff.dayBoundary =
      chartCutoff.mode === "selected_day"
        ? "UTC"
        : chartCutoff.dayBoundary || resolvedTimezone;

    if (!chartCutoff.endDateTime || !chartCutoff.resolvedDate) {
      return res.status(400).json({
        success: false,
        stopped: true,
        errorType: "invalid_historical_cutoff",
        error: chartCutoff.reason,
        chartCutoff,
      });
    }

    const resolvedAnalysisDate = parseISODateOnly(chartCutoff.resolvedDate);

    let marketReference = await fetchTwelveDataStructureLevels({
      symbol: normalizedSymbol,
      chartDate: resolvedAnalysisDate,
      timeframe,
      timezone: resolvedTimezone,
      analysisType: mode,
      chartCutoff,
    });

    // FINAL VISIBLE CANDLE synchronization:
    // A sparse time axis can show the last printed date tick before the actual
    // final candle. Cross-check the external OHLC series against the exact
    // visible close before any framework/Fibonacci calculations are trusted.
    const initialFinalVisibleSync =
      await synchronizeFinalVisibleMarketReference({
        marketReference,
        chartDetection,
        selectedDateText,
        symbol: normalizedSymbol,
        timeframe,
        timezone: resolvedTimezone,
        analysisType: mode,
        chartCutoff,
      });

    if (initialFinalVisibleSync.adjusted) {
      marketReference = initialFinalVisibleSync.marketReference;
      chartCutoff = initialFinalVisibleSync.chartCutoff;
    }

    let visualReview = await compareUploadedChartWithCsaFramework({
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

    // If the lightweight chart validator could not read the final close but
    // the full visual review could, perform the same synchronization now and
    // rerun the visual comparison against the corrected market reference.
    const visualVisiblePrice = asPositiveNumber(visualReview?.latestVisiblePrice);
    const detectedVisiblePrice = asPositiveNumber(chartDetection?.latestVisiblePrice);

    if (
      normalizedRequestedCutoffMode === "final_visible" &&
      visualVisiblePrice &&
      (!detectedVisiblePrice ||
        Math.abs(visualVisiblePrice - detectedVisiblePrice) >
          getFinalVisiblePriceSyncTolerance({
            marketReference,
            symbol: normalizedSymbol,
            targetPrice: visualVisiblePrice,
          }))
    ) {
      const visualPriceSync =
        await synchronizeFinalVisibleMarketReference({
          marketReference,
          chartDetection: {
            ...chartDetection,
            latestVisiblePrice: visualVisiblePrice,
            latestVisiblePriceConfidence: "medium",
          },
          selectedDateText,
          symbol: normalizedSymbol,
          timeframe,
          timezone: resolvedTimezone,
          analysisType: mode,
          chartCutoff,
        });

      if (visualPriceSync.adjusted) {
        marketReference = visualPriceSync.marketReference;
        chartCutoff = visualPriceSync.chartCutoff;

        visualReview = await compareUploadedChartWithCsaFramework({
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
      }
    }

    const dedicatedFrameworkPriceMap =
      await extractVisibleFrameworkPriceMap({
        imageBase64,
        mimeType,
        marketReference,
        timeframe,
      });

    visualReview =
      mergeDedicatedFrameworkPriceMapIntoVisualReview({
        visualReview,
        priceMap: dedicatedFrameworkPriceMap,
      });

    const chartNativeImpulse =
      await extractChartNativeImpulseAnchors({
        imageBase64,
        mimeType,
        marketReference,
        chartDetection,
        visualReview,
        priceMap: dedicatedFrameworkPriceMap,
        timeframe,
        symbol: normalizedSymbol || submittedInstrument,
      });

    visualReview = {
      ...visualReview,
      chartNativeImpulse,
    };

    visualReview = resolveIntradayCsaChartMarking({
      visualReview,
      marketReference,
      timeframe,
      symbol: normalizedSymbol || submittedInstrument,
    });

    visualReview = sanitizeVisualReviewMarketPrices({
      visualReview,
      marketReference,
      symbol: normalizedSymbol || submittedInstrument,
    });

    visualReview = enrichVisualReviewForFinalFeedback({
      visualReview,
      marketReference,
      symbol: normalizedSymbol || submittedInstrument,
    });

    console.log("Final enriched visual review:", {
      direction: visualReview?.preferredEntryArea?.direction || null,
      areaType: visualReview?.preferredEntryArea?.areaType || null,
      zoneLow: visualReview?.preferredEntryArea?.zoneLow ?? null,
      zoneHigh: visualReview?.preferredEntryArea?.zoneHigh ?? null,
      zoneText: visualReview?.preferredEntryArea?.zoneText || null,
      priceStatus: visualReview?.preferredEntryArea?.priceStatus || null,
      triggerPresent:
        visualReview?.preferredEntryArea?.triggerPresent === true,
      strengths: visualReview?.chartSpecificStrengths || [],
      weaknesses: visualReview?.chartSpecificWeaknesses || [],
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

    const cleanedBaseAnalysis = removeWeekdayNamesFromUserText(baseAnalysis);

    let analysis =
      selectedStrategy.analysisFramework === "personal_strategy"
        ? `${cleanedBaseAnalysis}

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
        : cleanedBaseAnalysis;
    const bias = marketReference.directionalBias || calculateCsaDirectionalBias([], normalizedSymbol, selectedTimeframeProfile);
    const setupScoreMatch = String(analysis).match(/Overall Setup Score:\s*\n- (\d+)\/10/i);
    const setupScore = setupScoreMatch ? Number(setupScoreMatch[1]) : 0;

    const analysisFacts = buildValidatedAnalysisFacts({
      visualReview,
      marketReference,
      chartDetection,
      bias,
      submittedInstrument,
      timeframe,
      analysisType: mode,
      selectedDate: chartCutoff.resolvedDate || selectedDateText || "",
      submittedNotes,
    });

    // Replace any model-suggested entry areas with the deterministic CSA
    // selector result before saving or returning the visual review. This keeps
    // Claude's visual observations useful while preventing it from promoting a
    // structurally valid but non-confluent level as Entry 1 / Entry 2.
    visualReview =
      applyDeterministicEntryPlanToVisualReview({
        visualReview,
        facts: analysisFacts,
      });

    // V4.4: raw Claude/legacy wording can describe structure, but it
    // cannot promote an unselected level as a buy/sell location.
    visualReview =
      applySelectedEntryNarrativeLockToVisualReview({
        visualReview,
        facts: analysisFacts,
      });

    // Build the legacy/dashboard compatibility layer only AFTER the
    // deterministic entry plan and narrative lock have been applied.
    // This prevents stale model-suggested "secondary buy/sell area"
    // language from leaking back into dashboard aliases.
    const legacyDashboardFeedback =
      buildDashboardFeedback({
        marketReference,
        chartDetection,
        visualReview,
        submittedInstrument,
        timeframe,
        selectedDateText:
          chartCutoff.resolvedDate ||
          selectedDateText ||
          "Not provided",
        detectedDateText:
          chartDetection
            .latestVisibleDate ||
          "Not detected",
        submittedNotes,
        setupScore,
        analysisType: mode,
      });

    const finalFeedback = buildControlledFeedback({
      facts: analysisFacts,
      plan: entitlement?.effectivePlan || "starter",
      analysisFramework: selectedStrategy.analysisFramework,
      personalStrategyAssessment:
        selectedStrategy.analysisFramework === "personal_strategy"
          ? {
              strategyMatchScore: visualReview?.strategyMatchScore ?? null,
              rulesFollowed: visualReview?.strategyRulesFollowed || [],
              rulesViolated: visualReview?.strategyRulesViolated || [],
              missingInformation: visualReview?.strategyMissingInformation || [],
              verdict: visualReview?.strategyVerdict || null,
            }
          : null,
    });

    analysis = finalFeedback.analysis;

    const dashboardFeedback = applyControlledFeedbackToDashboard(
      legacyDashboardFeedback,
      finalFeedback
    );
    const dashboardAliases = buildDashboardAliases(dashboardFeedback);
    const structureLabel =
      marketReference.profile?.structureLabel ||
      selectedTimeframeProfile.structureLabel ||
      "CSA structure levels";

    // V4.5.3: keep Fibonacci diagnostics in the correct route scope.
    const selectorAudit =
      analysisFacts
        ?.selectorDiagnostics
        ?.fibonacci ||
      null;

    // Build and validate the client response BEFORE writing the journal
    // or usage record. A late response-construction bug must not consume
    // an analysis allowance.
    const updatedEntitlement = {
      ...entitlement,
      analysesUsed:
        entitlement.analysesUsed + 1,
      analysesRemaining:
        Math.max(
          0,
          entitlement.analysesRemaining - 1
        ),
    };

    const responseBody = {
      success: true,
      entitlement: updatedEntitlement,
      savedToJournal: false,
      saveReason: null,
      reviewId: null,
      chartImagePath: null,
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
      analysisFacts,
      regressionSnapshot: {
        engineVersion:
          "4.5.5-strength-init-order-fix",
        instrument: submittedInstrument,
        timeframe,
        analysisType: mode,
        cutoffMode: chartCutoff.mode,
        resolvedCutoff: chartCutoff.endDateTime,
        direction:
          analysisFacts?.direction || null,
        selector:
          analysisFacts?.selectorDiagnostics || null,
        entries: {
          entry1:
            finalFeedback?.entry1 ||
            null,
          entry2:
            finalFeedback?.entry2 ||
            null,
        },
        chartValidation: {
          isTradingChart:
            chartDetection?.isTradingChart === true,
          confidence:
            chartDetection?.validationConfidence || null,
          evidenceScore:
            Number(
              chartDetection?.validationEvidenceScore || 0
            ),
          rescueUsed:
            chartDetection?.validationRescueUsed === true,
          hardReject:
            chartDetection?.validationHardReject === true,
          quality:
            chartDetection?.chartDataQuality || null,
          candleCount:
            Number(chartDetection?.visibleCandleCount || 0),
          occupancy:
            Number(chartDetection?.chartOccupancyPercent || 0),
        },
        fibOrigin: {
          source:
            "analysisFacts.selectorDiagnostics.fibonacci",
          model:
            selectorAudit
              ?.fibOriginModel ||
            null,
          protectedSwing:
            selectorAudit
              ?.protectedSwing ||
            null,
          outerStructuralOrigin:
            selectorAudit
              ?.outerStructuralOrigin ||
            null,
          swingLow:
            selectorAudit
              ?.swingLow ??
            null,
          swingHigh:
            selectorAudit
              ?.swingHigh ??
            null,
          selectionReason:
            selectorAudit
              ?.selectionReason ||
            null,
        },
        narrativeLock:
          finalFeedback
            ?.narrativeLock ||
          visualReview
            ?.deterministicEntryNarrativeLock ||
          null,
        scoring: {
          modelVersion:
            CSA_SCORING_MODEL_VERSION,
          context:
            finalFeedback?.scoreContext ||
            null,
          displayLabels:
            finalFeedback?.displayLabels ||
            null,
          scoreDisplay:
            finalFeedback?.scoreDisplay ||
            null,
          overallDisplayLabel:
            finalFeedback?.overallDisplayLabel ||
            finalFeedback?.displayLabels?.overall ||
            null,
          setupQuality:
            finalFeedback?.scores
              ?.setupQuality ?? null,
          entryAccuracy:
            finalFeedback?.scores
              ?.entryAccuracy ?? null,
          riskManagement:
            finalFeedback?.scores
              ?.riskManagement ?? null,
          overall:
            finalFeedback?.scores
              ?.overall ?? null,
          grade:
            finalFeedback?.grade || null,
        },
      },
      finalFeedback,
      feedbackEngineVersion: CSA_FEEDBACK_ENGINE_VERSION,
      buildId: CSA_BUILD_ID,
      selectorVersion: CSA_SELECTOR_VERSION,
      cutoffMode: chartCutoff.mode,
      cutoffPrecision: chartCutoff.precision,
      resolvedCutoff: chartCutoff.endDateTime,
      resolvedCutoffTimezone: resolvedTimezone,
      cutoffSource: chartCutoff.source,
      cutoffReason: chartCutoff.reason,
      forceFreshAnalysis: forceFresh,
      cutoffDiagnostics: {
        engineVersion: CSA_FEEDBACK_ENGINE_VERSION,
        cutoffMode: chartCutoff.mode,
        resolvedCutoff: chartCutoff.endDateTime,
        timezone: resolvedTimezone,
        dayBoundary: chartCutoff.dayBoundary || resolvedTimezone,
        lastIncludedCandle:
          marketReference?.chartCutoff?.lastIncludedCandle || null,
        firstExcludedCandle:
          marketReference?.chartCutoff?.firstExcludedCandle || null,
        includedCandleCount:
          Number(marketReference?.chartCutoff?.includedCandleCount || 0),
        excludedCandleCount:
          Number(marketReference?.chartCutoff?.excludedCandleCount || 0),
        structureEngine:
          analysisFacts?.historicalPhase?.diagnostics || null,
      },
      dashboard: dashboardFeedback,
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
      chartValidationAudit: {
        buildId: CSA_BUILD_ID,
        isTradingChart:
          chartDetection?.isTradingChart === true,
        confidence:
          chartDetection?.validationConfidence || null,
        evidenceScore:
          Number(chartDetection?.validationEvidenceScore || 0),
        rescueUsed:
          chartDetection?.validationRescueUsed === true,
        hardReject:
          chartDetection?.validationHardReject === true,
        visibleCandleCount:
          Number(chartDetection?.visibleCandleCount || 0),
        occupancy:
          Number(chartDetection?.chartOccupancyPercent || 0),
      },
      marketReference: { ok: marketReference.ok, error: marketReference.error, symbol: marketReference.symbol, timezone: marketReference.timezone, interval: marketReference.interval, rawCandleCount: marketReference.rawCandleCount, filteredCandleCount: marketReference.filteredCandleCount, frameworkCandleCount: marketReference.frameworkCandleCount, impulseCandleCount: marketReference.impulseCandleCount, weekRange: marketReference.weekRange, impulseRange: marketReference.impulseRange, dailyLevels: marketReference.dailyLevels, timeframeCandles: marketReference.timeframeCandles, impulseCandles: marketReference.impulseCandles, csaAreas: marketReference.csaAreas, directionalBias: marketReference.directionalBias, profile: marketReference.profile, structureMode: marketReference.profile?.structureMode, structureLabel: marketReference.profile?.structureLabel, cleanBreakTolerance: getCleanBreakTolerance(normalizedSymbol) },
    };

    // Shape the complete response first. If this throws, nothing has yet
    // been written to chart_reviews or usage_records.
    let finalClientResponse =
      applyPlanToAnalysisResponse({
        responseBody: {
          ...responseBody,
          cacheHit: false,
          analysisFingerprint,
        },
        entitlement:
          updatedEntitlement,
      });

    // Commit journal + usage only after analysis and response construction
    // have both completed successfully.
    const journalSave =
      await saveCompletedReview({
        user:
          requestAuth.user,
        file:
          req.file,
        submittedInstrument,
        timeframe,
        mode,
        submittedNotes,
        chartDateText:
          chartCutoff.resolvedDate ||
          selectedDateText ||
          null,
        analysis,
        chartDetection,
        visualReview,
        marketReference,
        dashboardFeedback,
        dateDecision,
        analysisFramework:
          selectedStrategy.analysisFramework,
        selectedStrategy:
          selectedStrategy.strategy,
        personalStrategySnapshot:
          selectedStrategy.snapshot,
      });

    finalClientResponse = {
      ...finalClientResponse,
      savedToJournal:
        journalSave.savedToJournal,
      saveReason:
        journalSave.saveReason,
      reviewId:
        journalSave.reviewId,
      chartImagePath:
        journalSave.chartImagePath,
      entitlement:
        updatedEntitlement,
    };

    console.log(
      "CSA v4.5.3 completed analysis commit:",
      {
        buildId:
          CSA_BUILD_ID,
        reviewId:
          journalSave.reviewId,
        usageCommitted:
          journalSave.savedToJournal ===
          true,
        analysesUsed:
          updatedEntitlement
            .analysesUsed,
        analysesRemaining:
          updatedEntitlement
            .analysesRemaining,
        selectedEntryCount:
          Number(
            analysisFacts
              ?.selectedEntryCount ||
              0
          ),
        entry1:
          finalFeedback
            ?.entry1 ||
          null,
        entry2:
          finalFeedback
            ?.entry2 ||
          null,
      }
    );

    if (!forceFresh) {
      cacheCompletedAnalysis(
        analysisFingerprint,
        finalClientResponse
      );
    }

    return res.json(
      finalClientResponse
    );
  } catch (error) {
    console.error(
      "CSA Coach analyze error:",
      {
        buildId:
          CSA_BUILD_ID,
        feedbackEngineVersion:
          CSA_FEEDBACK_ENGINE_VERSION,
        selectorVersion:
          CSA_SELECTOR_VERSION,
        name:
          error?.name ||
          "Error",
        message:
          error?.message ||
          String(error),
        stack:
          error?.stack ||
          null,
      }
    );
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
app.listen(PORT, "0.0.0.0", () => {
  console.log(`CSA Coach backend running on port ${PORT}`);
  console.log("CSA BUILD:", {
    buildId: CSA_BUILD_ID,
    feedbackEngineVersion: CSA_FEEDBACK_ENGINE_VERSION,
    selectorVersion: CSA_SELECTOR_VERSION,
    cleanBuild: true,
  });
});
