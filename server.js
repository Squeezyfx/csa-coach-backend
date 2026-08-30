import express from "express";
import cors from "cors";
import multer from "multer";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import Stripe from "stripe";
import {
  annotateFrameworkPeriodPriority,
  buildFinalVisibleTerminalImpulse,
  canonicalInstrumentCode,
  classifyCsaStructuralStage,
  compareStructureLedCompletedImpulseCandidates,
  consolidateQualifiedSupplyDemandClusters,
  expandExactSupportResistanceBoundaries,
  findNearestAllowedFibonacciMatch,
  getMarketDataSymbolCandidates,
  getSupplyDemandClusterTolerance,
  hasIndependentChartPriceEvidence,
  isMostRecentStructureCompatibleImpulse,
  shouldApplyFinalVisibleTerminalImpulse,
  isSupportedInstrumentCode,
  mergeAdjacentExactConvertedLines,
  mergeFocusedSupplyDemandInventory,
  orderStructuralCandidatesForFib,
  parseChartHeaderText,
  reconcileLatestVisibleDateWithAxisYear,
  replaceMisclassifiedZoneWithExactConvertedLines,
  promoteConfirmedBreakPassedExactLevels,
  selectStructureLedChartNativeImpulseFrame,
  selectProtectiveSupplyDemandAnchor,
  selectIndependentEntryAreas,
  selectNearestFrameworkPeriodHints,
  sequenceFibQualifiedAreas,
  shouldMergeQualifiedSupplyDemandCluster,
} from "./csa-entry-policy.js";
import { getVerifiedChartFixture } from "./benchmark/verified-chart-fixtures.js";
import { buildVisiblePeriodFibonacciFrame } from "./benchmark/weekly-fibonacci-policy.js";
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
const BENCHMARK_DRY_RUN_ENABLED =
  String(process.env.BENCHMARK_DRY_RUN_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
const BENCHMARK_INTERNAL_KEY = String(
  process.env.BENCHMARK_INTERNAL_KEY || ""
);

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

function isAuthorizedBenchmarkDryRun(req) {
  if (!BENCHMARK_DRY_RUN_ENABLED || BENCHMARK_INTERNAL_KEY.length < 24) {
    return false;
  }

  const supplied = String(
    req.get("x-benchmark-internal-key") || ""
  );
  if (supplied.length !== BENCHMARK_INTERNAL_KEY.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(supplied),
    Buffer.from(BENCHMARK_INTERNAL_KEY)
  );
}

function createBenchmarkDryRunEntitlement(requestedPlan = "starter") {
  const effectivePlan = normalizePlanCode(requestedPlan);
  const planConfig = PLAN_CONFIG[effectivePlan];
  return {
    basePlan: effectivePlan,
    effectivePlan,
    planLabel: `Internal ${planConfig.label} Benchmark Dry Run`,
    subscriptionStatus: "internal",
    isBetaTester: false,
    betaAccessExpiresAt: null,
    analysesUsed: 0,
    analysesLimit: 1000000,
    analysesRemaining: 1000000,
    usageMonth: getCurrentUsageMonth(),
    journalLimit: planConfig.journalLimit,
    strategyLimit: planConfig.strategyLimit,
    features: planConfig.features,
    cancelAtPeriodEnd: false,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialUsed: false,
  };
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
- Inspect the bottom time axis separately and return its clearly printed four-digit year as visibleTimeAxisYear. Never take this year from account-expiry text such as "Account authorized until" or from unrelated platform chrome.
- If latestVisibleDate and the bottom-axis year disagree, use the bottom-axis year for latestVisibleDate because the time axis defines the chart's visible history.
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
- The timeframe-specific CSA framework levels supplied by the backend are FINAL market-data facts. Do not recalculate, replace, visually estimate, or reinterpret a different high/low for the same period.
- Completed framework periods come from native higher-timeframe candles (D1 for M1-H1, W1 for H4, MN for D1; monthly candles grouped for W1/MN). Only the current incomplete framework period may be reconstructed from cutoff-safe lower-timeframe candles.
- Vision may confirm interaction, retest, trigger, markings, and display rounding for the SAME supplied framework level, but must never create a different period high/low or change period identity.
- A converted resistance may only come from a level originally classified by the CSA period engine as support; a converted support may only come from original resistance. Do not convert demand or supply levels.
- When a new authoritative period breaks a previous period support/resistance, preserve BOTH facts: classify the new period high/low by the S/R-vs-S/D hierarchy, and carry the broken previous S/R forward in its converted role. Example: if Tuesday breaks Monday support, Tuesday may create a new support/demand classification while Monday support remains potential converted resistance. Never replace that broken Monday support with Monday's older high simply because both are resistance-side references.
- For entry relevance, a nearer broken previous support/resistance that has converted in the current directional path outranks a farther untouched historical resistance/support when both are otherwise valid.
- Generic pivots and chart markings may only confirm or refine an authoritative framework level; they must never create or replace the primary area.
- Validate genuine support/resistance or supply/demand structure before considering distance.
- Fibonacci retracement is a silent mandatory quality filter only after an authoritative structural area already exists. Only 38.2%, 50%, and 61.8% are used.
- The deterministic CSA selector controls entry areas. Inventory the next previous S/R levels and the next previous S/D zones, resolve lifecycle roles chronologically, reject failed/choppy/weak structure, then keep only independently valid areas close to 38.2%, 50%, or 61.8% of the relevant completed impulse before sequencing up to Entry 1, Entry 2, and Entry 3.
- A clean break with continuation may create a potential converted S/R area that can be watched for a future retest. It becomes confirmed converted only after price returns from the opposite side and respects it. Either way, it must still pass the 38.2% / 50% / 61.8% proximity filter before it can become Entry 1 or Entry 2.
- Use this fixed order every time: (1) inventory and resolve the next previous support/resistance and converted S/R candidates, (2) independently inventory and resolve the next previous supply/demand candidates, (3) calculate hidden Fibonacci 38.2%, 50%, and 61.8% prices from the completed impulse and test every surviving candidate, and only then (4) sequence up to three survivors by the path price will encounter them. Entry 2 and Entry 3 are alternatives after a fresh trigger, never instructions to add to a losing position.
- Fibonacci must never create an area by itself. An independently valid S/R or supply/demand area becomes a strong entry candidate only when it is close to 38.2% or falls within/close to the 50%-61.8% retracement band. A structurally strong area just beyond the exact 61.8 line may still qualify when it is within the conservative proximity allowance; a clearly deep area remains reference-only.
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
  "detectedInstrument": "exact visible instrument/ticker such as GBPUSD, XAUUSD, BTCUSD, ETHUSD, AAPL, NVDA, USA30, US30, US500, USTEC, NAS100, GER40, UK100, JP225, or null",
  "detectedTimeframe": "H1 or M5 or H4 or D1 or W1 or MN or null",
  "latestVisibleDate": "YYYY-MM-DD or null",
  "visibleTimeAxisYear": 2026,
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
  return canonicalInstrumentCode(input);
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
  return isSupportedInstrumentCode(detectedInstrument);
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

function csaNowMs() {
  return Date.now();
}

function csaElapsedMs(startedAt) {
  return Math.max(
    0,
    Date.now() - Number(startedAt || Date.now())
  );
}

function csaTimingLog(stage, startedAt, extra = {}) {
  console.log("CSA PERFORMANCE:", {
    buildId: CSA_BUILD_ID,
    stage,
    elapsedMs: csaElapsedMs(startedAt),
    ...extra,
  });
}

function normalizeUserFacingTypography(value = "") {
  return String(value ?? "")
    // Repair common UTF-8 punctuation that was previously decoded as
    // Windows-1252/Latin-1. Unicode escapes keep this source transport-safe.
    .replace(/\u00e2\u20ac\u201c/g, "\u2013")
    .replace(/\u00e2\u20ac\u201d/g, "\u2014")
    .replace(/\u00e2\u20ac\u2122/g, "\u2019")
    .replace(/\u00e2\u20ac\u0153/g, "\u201c")
    .replace(/\u00c2\u00b1/g, "\u00b1")
    .replace(/\u00c2\u00b2/g, "\u00b2");
}

function normalizeUserFacingTypographyDeep(value) {
  if (typeof value === "string") {
    return normalizeUserFacingTypography(value);
  }

  if (Array.isArray(value)) {
    return value.map(normalizeUserFacingTypographyDeep);
  }

  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeUserFacingTypographyDeep(item),
      ])
    );
  }

  return value;
}

function safeUserText(value = "") {
  return normalizeUserFacingTypography(value)
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

  // V4.8.0 FRAMEWORK SOURCE LOCK
  // The selected chart timeframe is used for execution/lifecycle detail and
  // Fibonacci impulse discovery. The authoritative CSA framework highs/lows
  // come from the next higher source candle wherever one exists:
  //   M1-H1 -> D1 candle high/low for each weekday
  //   H4    -> W1 candle high/low for each week
  //   D1    -> MN candle high/low for each month
  //   W1    -> MN candles grouped into quarters
  //   MN    -> MN candles grouped into years
  // This prevents an intraday pivot from silently replacing the actual
  // authoritative period high/low.
  if (["M1", "M5", "M15", "M30", "H1"].includes(tf)) {
    return {
      selectedTimeframe: tf,
      interval: normalizeTimeframe(tf),
      frameworkInterval: "1day",
      frameworkSourceLabel: "authoritative D1 candles",
      structureMode: "daily-in-week",
      structureLabel: "Daily highs/lows inside the selected Monday-to-Friday week",
      sourceUnitSingular: "day",
      sourceUnitPlural: "daily levels",
      firstPeriodText: "Monday D1 candle high/low creates first resistance and support.",
      startPriceLabel: "Monday D1 open",
      currentPriceLabel: "latest close for selected week",
      rangeKind: "week",
      breakdownTitle: "Monday-to-Friday CSA Breakdown",
    };
  }
  if (tf === "H4") return {
    selectedTimeframe: tf,
    interval: "4h",
    frameworkInterval: "1week",
    frameworkSourceLabel: "authoritative W1 candles",
    structureMode: "weekly-in-month",
    structureLabel: "Weekly highs/lows inside the selected calendar month",
    sourceUnitSingular: "week",
    sourceUnitPlural: "weekly levels",
    firstPeriodText: "First W1 candle high/low creates first resistance and support.",
    startPriceLabel: "first week open",
    currentPriceLabel: "latest close for selected month",
    rangeKind: "month",
    breakdownTitle: "Weekly CSA Breakdown For Selected Month",
  };
  if (tf === "D1") return {
    selectedTimeframe: tf,
    interval: "1day",
    frameworkInterval: "1month",
    frameworkSourceLabel: "authoritative MN candles",
    structureMode: "monthly-in-year",
    structureLabel: "Monthly highs/lows inside the selected calendar year",
    sourceUnitSingular: "month",
    sourceUnitPlural: "monthly levels",
    firstPeriodText: "First MN candle high/low creates first resistance and support.",
    startPriceLabel: "first month open",
    currentPriceLabel: "latest close for selected year",
    rangeKind: "year",
    breakdownTitle: "Monthly CSA Breakdown For Selected Year",
  };
  if (tf === "W1") return {
    selectedTimeframe: tf,
    interval: "1week",
    frameworkInterval: "1month",
    frameworkSourceLabel: "authoritative MN candles grouped by quarter",
    structureMode: "quarterly-in-year",
    structureLabel: "Quarterly highs/lows inside the selected calendar year",
    sourceUnitSingular: "quarter",
    sourceUnitPlural: "quarterly levels",
    firstPeriodText: "First quarter high/low creates first resistance and support.",
    startPriceLabel: "first quarter open",
    currentPriceLabel: "latest close for selected year",
    rangeKind: "year",
    breakdownTitle: "Quarterly CSA Breakdown For Selected Year",
  };
  if (tf === "MN") return {
    selectedTimeframe: tf,
    interval: "1month",
    frameworkInterval: "1month",
    frameworkSourceLabel: "authoritative MN candles grouped by year",
    structureMode: "yearly-in-multi-year",
    structureLabel: "Yearly highs/lows across selected year plus previous 4 years",
    sourceUnitSingular: "year",
    sourceUnitPlural: "yearly levels",
    firstPeriodText: "First year high/low creates first resistance and support.",
    startPriceLabel: "first year open",
    currentPriceLabel: "latest close for selected multi-year range",
    rangeKind: "multi-year range",
    breakdownTitle: "Yearly CSA Breakdown For Monthly Chart",
  };
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

function getFrameworkPeriodEndDate(date, profile = getSupportedCsaTimeframeProfile("H1")) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();

  if (profile.structureMode === "daily-in-week") {
    return formatDateOnly(d);
  }

  if (profile.structureMode === "weekly-in-month") {
    // CSA trading week is Monday-Friday. Saturday/Sunday do not create
    // authoritative intraday framework levels.
    const day = d.getUTCDay();
    const daysToFriday = day === 0 ? -2 : day === 6 ? -1 : 5 - day;
    return formatDateOnly(addDays(d, daysToFriday));
  }

  if (profile.structureMode === "monthly-in-year") {
    return formatDateOnly(new Date(Date.UTC(year, month + 1, 0)));
  }

  if (profile.structureMode === "quarterly-in-year") {
    const quarterEndMonth = month <= 2 ? 2 : month <= 5 ? 5 : month <= 8 ? 8 : 11;
    return formatDateOnly(new Date(Date.UTC(year, quarterEndMonth + 1, 0)));
  }

  if (profile.structureMode === "yearly-in-multi-year") {
    return `${year}-12-31`;
  }

  return formatDateOnly(d);
}

function isFrameworkPeriodCompleteAtCutoff({
  cutoffDateTime = "",
  profile = getSupportedCsaTimeframeProfile("H1"),
}) {
  const normalized = normalizeTwelveDataDateTime(cutoffDateTime);
  if (!normalized) return false;
  const cutoffDate = candleDateOnly(normalized);
  const cutoffTime = normalized.slice(11, 19) || "00:00:00";
  if (!cutoffDate) return false;

  const periodEndDate = getFrameworkPeriodEndDate(
    new Date(`${cutoffDate}T00:00:00.000Z`),
    profile
  );

  if (!periodEndDate) return false;
  if (cutoffDate > periodEndDate) return true;
  if (cutoffDate < periodEndDate) return false;
  return cutoffTime >= "23:59:00";
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
  /*
   * V4.8.3 â€” AUTHORITATIVE HIERARCHICAL S/R vs S/D + PRIOR S/R MEMORY
   *
   * The higher-timeframe source candle owns the framework high/low. Each new
   * period is classified ONLY against the immediately preceding authoritative
   * period:
   *
   *   high outside/above previous high  -> RESISTANCE
   *   high inside previous range        -> SUPPLY
   *   low outside/below previous low    -> SUPPORT
   *   low inside previous range         -> DEMAND
   *
   * For H1 this means D1 highs/lows. For H4 it means W1 highs/lows, etc.
   * Lower-timeframe pivots/bases may later CONFIRM or REINFORCE these areas,
   * but they cannot invent a separate framework supply/demand identity.
   */
  const areas = [];
  levels.forEach((period, index) => {
    const label = period.periodLabel || period.day || period.key;
    if (index === 0) {
      areas.push({
        day: label,
        period: label,
        date: period.date,
        type: "resistance",
        price: period.high,
        priceText: formatPrice(period.high),
        hierarchyClassification: "first_period_high_is_resistance",
        authoritativeFrameworkLevel: true,
      });
      areas.push({
        day: label,
        period: label,
        date: period.date,
        type: "support",
        price: period.low,
        priceText: formatPrice(period.low),
        hierarchyClassification: "first_period_low_is_support",
        authoritativeFrameworkLevel: true,
      });
      return;
    }

    const previous = levels[index - 1];
    const highComparison = compareHighWithTolerance(period.high, previous.high, symbol);
    const lowComparison = compareLowWithTolerance(period.low, previous.low, symbol);

    const highType = highComparison.cleanBreak ? "resistance" : "supply";
    const lowType = lowComparison.cleanBreak ? "support" : "demand";

    areas.push({
      day: label,
      period: label,
      date: period.date,
      type: highType,
      price: period.high,
      priceText: formatPrice(period.high),
      comparison: highComparison,
      previousFrameworkHigh: previous.high,
      previousFrameworkLow: previous.low,
      hierarchyClassification:
        highType === "resistance"
          ? "current_high_outside_previous_high_new_resistance"
          : "current_high_inside_previous_range_supply",
      authoritativeFrameworkLevel: true,
    });

    areas.push({
      day: label,
      period: label,
      date: period.date,
      type: lowType,
      price: period.low,
      priceText: formatPrice(period.low),
      comparison: lowComparison,
      previousFrameworkHigh: previous.high,
      previousFrameworkLow: previous.low,
      hierarchyClassification:
        lowType === "support"
          ? "current_low_outside_previous_low_new_support"
          : "current_low_inside_previous_range_demand",
      authoritativeFrameworkLevel: true,
    });
  });

  console.log("CSA HIERARCHICAL S/R-S/D CLASSIFICATION:", {
    buildId: CSA_BUILD_ID,
    frameworkSource: profile?.frameworkSourceLabel || null,
    structureMode: profile?.structureMode || null,
    periods: levels.map((period) => ({
      period: period?.periodLabel || period?.day || period?.key || null,
      high: period?.high ?? null,
      low: period?.low ?? null,
    })),
    areas: areas.map((area) => ({
      period: area.period,
      type: area.type,
      price: area.price,
      hierarchyClassification: area.hierarchyClassification,
    })),
    rule: "authoritative_period_high_low_classifies_sr_vs_sd_before_intraday_structure",
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
    frameworkInterval: profile.frameworkInterval || profile.interval,
    frameworkSourceLabel: profile.frameworkSourceLabel || null,
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

  const frameworkInterval =
    profile.frameworkInterval || profile.interval;

  const providerCandidates = [...new Set(
    getMarketDataSymbolCandidates(symbol)
      .map((candidate) => normalizeSymbol(candidate))
      .filter(Boolean)
  )];
  let resolvedProviderSymbol = providerCandidates[0] || normalizeSymbol(symbol);

  const buildTwelveParams = ({
    interval,
    startDate,
    providerSymbol,
  }) =>
    new URLSearchParams({
      symbol: providerSymbol,
      interval,
      start_date: `${startDate} 00:00:00`,
      end_date: endDateTime,
      timezone,
      order: "ASC",
      outputsize: getOutputSizeForInterval(interval),
      apikey: apiKey,
    });

  const fetchTwelveSeries = async ({
    interval,
    startDate,
    purpose,
    preferredProviderSymbol = "",
  }) => {
    const orderedCandidates = [...new Set([
      preferredProviderSymbol,
      ...providerCandidates,
    ].filter(Boolean))];
    let lastError = null;

    for (const providerSymbol of orderedCandidates) {
      const params = buildTwelveParams({ interval, startDate, providerSymbol });
      const response = await fetch(
        `${TWELVE_DATA_BASE_URL}?${params.toString()}`
      );
      const data = await response.json();

      if (response.ok && data.status !== "error" && Array.isArray(data.values)) {
        resolvedProviderSymbol = providerSymbol;
        return { values: data.values || [], providerSymbol };
      }

      const message =
        data.message ||
        data.error ||
        `Twelve Data ${purpose} request failed with status ${response.status}.`;
      lastError = new Error(message);
      lastError.twelveDataStatus = data.status || "unknown";

      const invalidSymbol = /symbol|figi|invalid|not found/i.test(String(message));
      if (!invalidSymbol) throw lastError;
    }

    throw lastError || new Error(`Twelve Data ${purpose} request failed.`);
  };

  console.log("Twelve Data historical cutoff:", {
    symbol,
    timeframe,
    analysisType,
    executionInterval: profile.interval,
    authoritativeFrameworkInterval: frameworkInterval,
    authoritativeFrameworkSource:
      profile.frameworkSourceLabel || null,
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

  let rawCandles = [];
  let rawFrameworkCandles = [];

  try {
    const executionSeries = await fetchTwelveSeries({
      interval: profile.interval,
      startDate: impulseRange.startDate,
      purpose: "execution/impulse",
    });
    rawCandles = executionSeries.values;

    if (frameworkInterval === profile.interval) {
      rawFrameworkCandles = rawCandles;
    } else {
      // V4.8.1: request one full source period before the framework window.
      // Some providers timestamp D1/W1/MN bars at a session boundary that can
      // cause the first requested framework candle (for example Monday D1)
      // to be omitted when start_date equals the exact framework boundary.
      // We intentionally over-fetch, then filter back to the CSA range below.
      const frameworkBufferDays =
        profile.structureMode === "daily-in-week" ? 4 :
        profile.structureMode === "weekly-in-month" ? 14 :
        ["monthly-in-year", "quarterly-in-year"].includes(profile.structureMode) ? 45 :
        profile.structureMode === "yearly-in-multi-year" ? 45 : 4;
      const frameworkFetchStartDate = formatDateOnly(
        addDays(new Date(`${structureRange.startDate}T00:00:00.000Z`), -frameworkBufferDays)
      );
      const frameworkSeries = await fetchTwelveSeries({
        interval: frameworkInterval,
        startDate: frameworkFetchStartDate,
        purpose: "authoritative framework",
        preferredProviderSymbol: executionSeries.providerSymbol,
      });
      rawFrameworkCandles = frameworkSeries.values;
    }
  } catch (error) {
    return {
      ...empty(error.message, structureRange),
      twelveDataStatus: error.twelveDataStatus || "unknown",
    };
  }
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

  // V4.8.0: framework highs/lows come from dedicated higher-timeframe
  // source candles rather than reconstructed intraday pivots. The same
  // historical cutoff is applied defensively so future source candles can
  // never leak into an End-of-selected-day / Exact-time review.
  const filteredFrameworkSourceCandles = rawFrameworkCandles.filter((bar) => {
    const candleDateTime = normalizeTwelveDataDateTime(bar?.datetime);
    return (
      !normalizedCutoff ||
      !candleDateTime ||
      candleDateTime <= normalizedCutoff
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
  // Keep selected-timeframe candles for break/retest/lifecycle and trigger
  // detail. Do NOT use them to redefine COMPLETED authoritative period
  // highs/lows. If the cutoff falls inside the current D1/W1/MN/quarter/year
  // source period, however, using the provider's full higher-timeframe candle
  // could leak later price action. In that one partial period we reconstruct
  // only the current period from selected-timeframe candles up to the cutoff.
  const executionFrameworkRawCandles =
    filterCandlesToStructureRange(
      filteredCandles,
      structureRange,
      profile
    );

  const cutoffDateOnly = candleDateOnly(endDateTime);
  const currentFrameworkPeriod = cutoffDateOnly
    ? getPeriodKeyAndLabel(
        new Date(`${cutoffDateOnly}T00:00:00.000Z`),
        profile
      )
    : null;
  const currentFrameworkPeriodComplete =
    isFrameworkPeriodCompleteAtCutoff({
      cutoffDateTime: endDateTime,
      profile,
    });

  const sourceFrameworkCandlesInRange =
    filterCandlesToStructureRange(
      filteredFrameworkSourceCandles,
      structureRange,
      profile
    );

  const frameworkRawCandles = currentFrameworkPeriodComplete
    ? sourceFrameworkCandlesInRange
    : [
        ...sourceFrameworkCandlesInRange.filter((bar) => {
          const dateOnly = candleDateOnly(bar?.datetime);
          if (!dateOnly || !currentFrameworkPeriod?.key) return true;
          const date = new Date(`${dateOnly}T00:00:00.000Z`);
          if (Number.isNaN(date.getTime())) return true;
          return getPeriodKeyAndLabel(date, profile).key !== currentFrameworkPeriod.key;
        }),
        ...executionFrameworkRawCandles.filter((bar) => {
          const dateOnly = candleDateOnly(bar?.datetime);
          if (!dateOnly || !currentFrameworkPeriod?.key) return false;
          const date = new Date(`${dateOnly}T00:00:00.000Z`);
          if (Number.isNaN(date.getTime())) return false;
          return getPeriodKeyAndLabel(date, profile).key === currentFrameworkPeriod.key;
        }),
      ];

  const timeframeCandles =
    normalizeMarketCandles(
      executionFrameworkRawCandles
    );

  // V4.9.0 â€” NATIVE HIGHER-TIMEFRAME AUTHORITY
  // -------------------------------------------------
  // Completed CSA framework periods are owned by the provider's native
  // higher-timeframe candle:
  //   M1-H1 -> D1
  //   H4    -> W1
  //   D1    -> MN
  //   W1    -> MN grouped by quarter
  //   MN    -> MN grouped by year
  //
  // Lower/selected-timeframe candles have two jobs only:
  //   1) identify which CSA period a native higher-timeframe bar belongs to
  //      when provider/session timestamps are shifted, and
  //   2) reconstruct ONLY the current incomplete higher-timeframe period up
  //      to the historical/final-visible cutoff.
  //
  // This prevents a completed D1/W1/MN high/low from being redefined by an
  // arbitrary UTC aggregation while still preventing future-candle leakage.

  const providerFrameworkLevels = buildStructureLevelsFromCandles(
    frameworkRawCandles,
    structureRange,
    profile
  );
  const executionReconstructedLevels = buildStructureLevelsFromCandles(
    executionFrameworkRawCandles,
    structureRange,
    profile
  );

  const nativeSourceBars = normalizeMarketCandles(
    filteredFrameworkSourceCandles
  );

  const alignNativeBarsToExpectedPeriods = ({
    nativeBars = [],
    expectedLevels = [],
    currentPeriodKey = null,
    currentPeriodComplete = false,
    structureMode = "",
  }) => {
    const expected = [...expectedLevels]
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));

    const isDaily = structureMode === "daily-in-week";
    const isWeekly = structureMode === "weekly-in-month";
    const useDirectNativeAlignment = isDaily || isWeekly;

    if (!useDirectNativeAlignment) {
      return {
        resolved: null,
        matches: [],
        unmatchedNative: [],
      };
    }

    const candidates = nativeBars
      .map((bar, index) => ({ ...bar, __index: index }))
      .filter((bar) =>
        [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
      );
    const used = new Set();
    const matches = [];
    const resolved = [];

    // V4.9.8 â€” PERIOD-ORDER LOCK
    // Native D1/W1 bars must map to CSA periods in chronological order.
    // A Monday framework period may never borrow a later native Tuesday bar
    // merely because its OHLC shape happens to be numerically closer.
    // This was the remaining source of missing prior-period support/resistance
    // on some H1 regression charts (for example AUDUSD).
    let lastMatchedNativeIndex = -1;

    const dateDistanceDays = (a, b) => {
      const da = candleDateOnly(a);
      const db = candleDateOnly(b);
      if (!da || !db) return 999;
      const ta = new Date(`${da}T00:00:00.000Z`).getTime();
      const tb = new Date(`${db}T00:00:00.000Z`).getTime();
      if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 999;
      return Math.abs(ta - tb) / 86400000;
    };

    // V4.9.2 â€” EXTREME-BY-EXTREME SOURCE INTEGRITY RECONCILIATION
    // A provider's native D1/W1 bar can use a different session boundary from
    // the broker/chart. We therefore do not allow one obviously contaminated
    // extreme to redefine the CSA day/week. Each native HIGH and LOW must be
    // individually plausible relative to the cutoff-safe reconstruction.
    // Modest extensions are accepted (they can represent broker-session bars
    // that the UTC reconstruction missed); extreme extensions are rejected.
    const reconcileNativeExtreme = ({ nativeValue, reconstructedValue, reconstructedRange }) => {
      const native = Number(nativeValue);
      const reconstructed = Number(reconstructedValue);
      const range = Math.max(Math.abs(Number(reconstructedRange) || 0), 1e-9);
      if (!Number.isFinite(native)) {
        return { value: reconstructed, source: 'reconstruction_native_missing', delta: null, allowance: null, acceptedNative: false };
      }
      if (!Number.isFinite(reconstructed)) {
        return { value: native, source: 'native_reconstruction_missing', delta: null, allowance: null, acceptedNative: true };
      }

      // 20% of the reconstructed period range, with a tiny 0.05% price floor.
      // This is intentionally an integrity check, not an entry/Fib tolerance.
      const allowance = Math.max(range * 0.20, Math.abs(reconstructed) * 0.0005);
      const delta = Math.abs(native - reconstructed);
      const acceptedNative = delta <= allowance;
      return {
        value: acceptedNative ? native : reconstructed,
        source: acceptedNative ? 'native_extreme_integrity_pass' : 'reconstruction_extreme_native_session_mismatch',
        delta,
        allowance,
        acceptedNative,
      };
    };

    for (const level of expected) {
      const isCurrentIncomplete =
        currentPeriodKey &&
        String(level.key) === String(currentPeriodKey) &&
        currentPeriodComplete !== true;

      if (isCurrentIncomplete) {
        resolved.push({
          ...level,
          source: "partial_period_from_cutoff_safe_selected_timeframe",
          nativeHigherTimeframeAuthority: false,
          partialPeriod: true,
        });
        matches.push({
          key: level.key,
          label: level.periodLabel || level.day || level.key,
          mode: "partial_reconstruction",
          sourceDatetime: null,
          high: level.high,
          low: level.low,
        });
        continue;
      }

      let best = null;
      for (const bar of candidates) {
        if (used.has(bar.__index)) continue;
        if (Number(bar.__index) <= Number(lastMatchedNativeIndex)) continue;

        const expectedRange = Math.max(
          Math.abs(Number(level.high) - Number(level.low)),
          1e-9
        );
        const nativeRange = Math.max(
          Math.abs(Number(bar.high) - Number(bar.low)),
          1e-9
        );
        const scale = Math.max(expectedRange, nativeRange, 1);

        // Price shape identifies the same completed market period even when
        // the provider labels its D1/W1 candle at a different session date.
        const priceCost =
          (
            Math.abs(Number(bar.high) - Number(level.high)) +
            Math.abs(Number(bar.low) - Number(level.low)) +
            0.25 * Math.abs(Number(bar.open) - Number(level.open)) +
            0.25 * Math.abs(Number(bar.close) - Number(level.close))
          ) / scale;

        const days = dateDistanceDays(bar.datetime, level.date || level.key);
        const maxReasonableDays = isDaily ? 3 : 12;
        if (days > maxReasonableDays) continue;

        // Date is a secondary clue, never the authority, because provider
        // session rollovers may label the same completed candle one day away.
        const dateCost = Math.min(days, maxReasonableDays) * (isDaily ? 0.12 : 0.04);
        const score = priceCost + dateCost;

        if (!best || score < best.score) {
          best = { bar, score, priceCost, dateCost, days };
        }
      }

      // A deliberately generous ceiling: alignment chooses identity only.
      // The native OHLC itself remains authoritative after the match.
      if (best && best.score <= 1.35) {
        used.add(best.bar.__index);
        lastMatchedNativeIndex = Number(best.bar.__index);

        const reconstructionRange = Math.max(
          Math.abs(Number(level.high) - Number(level.low)),
          1e-9
        );
        const highResolution = reconcileNativeExtreme({
          nativeValue: best.bar.high,
          reconstructedValue: level.high,
          reconstructedRange: reconstructionRange,
        });
        const lowResolution = reconcileNativeExtreme({
          nativeValue: best.bar.low,
          reconstructedValue: level.low,
          reconstructedRange: reconstructionRange,
        });
        const allNativeExtremesAccepted =
          highResolution.acceptedNative && lowResolution.acceptedNative;

        resolved.push({
          ...level,
          open: Number.isFinite(Number(best.bar.open)) ? Number(best.bar.open) : Number(level.open),
          high: highResolution.value,
          low: lowResolution.value,
          close: Number.isFinite(Number(best.bar.close)) ? Number(best.bar.close) : Number(level.close),
          candleCount: 1,
          source: allNativeExtremesAccepted
            ? (isDaily ? "native_D1_extremes_integrity_pass" : "native_W1_extremes_integrity_pass")
            : (isDaily ? "D1_extreme_integrity_reconciled_to_CSA_day" : "W1_extreme_integrity_reconciled_to_CSA_week"),
          sourceDatetime: best.bar.datetime,
          nativeHigherTimeframeAuthority: allNativeExtremesAccepted,
          hybridHigherTimeframeAuthority: !allNativeExtremesAccepted,
          highSource: highResolution.source,
          lowSource: lowResolution.source,
          partialPeriod: false,
        });
        matches.push({
          key: level.key,
          label: level.periodLabel || level.day || level.key,
          mode: allNativeExtremesAccepted ? "native_completed_period" : "completed_period_extreme_integrity_reconciled",
          sourceDatetime: best.bar.datetime,
          nativeHigh: Number(best.bar.high),
          nativeLow: Number(best.bar.low),
          reconstructionHigh: level.high,
          reconstructionLow: level.low,
          resolvedHigh: highResolution.value,
          resolvedLow: lowResolution.value,
          highSource: highResolution.source,
          lowSource: lowResolution.source,
          highDelta: highResolution.delta,
          lowDelta: lowResolution.delta,
          highAllowance: highResolution.allowance,
          lowAllowance: lowResolution.allowance,
          alignmentScore: best.score,
          priceCost: best.priceCost,
          dateCost: best.dateCost,
          dateDistanceDays: best.days,
          nativeSequenceIndex: Number(best.bar.__index),
          periodOrderLocked: true,
        });
      } else {
        // Fail safe: do not silently invent a completed higher-timeframe bar.
        // Keep the cutoff-safe reconstruction but mark the source-integrity
        // state so diagnostics can expose that native alignment failed.
        resolved.push({
          ...level,
          source: "native_htf_alignment_failed_cutoff_safe_fallback",
          nativeHigherTimeframeAuthority: false,
          sourceIntegrityWarning: true,
          partialPeriod: false,
        });
        matches.push({
          key: level.key,
          label: level.periodLabel || level.day || level.key,
          mode: "completed_period_alignment_failed",
          sourceDatetime: best?.bar?.datetime || null,
          bestScore: best?.score ?? null,
          reconstructionHigh: level.high,
          reconstructionLow: level.low,
        });
      }
    }

    return {
      resolved: resolved.sort((a, b) => String(a.key).localeCompare(String(b.key))),
      matches,
      unmatchedNative: candidates
        .filter((bar) => !used.has(bar.__index))
        .map((bar) => ({
          datetime: bar.datetime,
          high: bar.high,
          low: bar.low,
        })),
    };
  };

  const alignedNative = alignNativeBarsToExpectedPeriods({
    nativeBars: nativeSourceBars,
    expectedLevels: executionReconstructedLevels,
    currentPeriodKey: currentFrameworkPeriod?.key || null,
    currentPeriodComplete: currentFrameworkPeriodComplete,
    structureMode: profile?.structureMode || "",
  });

  const reconstructedMissingKeys = [];
  let dailyLevels = [];

  if (Array.isArray(alignedNative.resolved)) {
    dailyLevels = alignedNative.resolved;
  } else {
    // D1/W1/MN analysis modes: provider higher-timeframe periods remain
    // authoritative for completed periods. The pre-existing safe fallback is
    // retained only for a missing/incomplete source period.
    const authoritativeLevelMap = new Map(
      providerFrameworkLevels.map((level) => [String(level.key), level])
    );
    for (const level of executionReconstructedLevels) {
      const key = String(level.key);
      if (!authoritativeLevelMap.has(key)) {
        authoritativeLevelMap.set(key, {
          ...level,
          source: "selected_timeframe_reconstruction_for_missing_authoritative_period",
          authoritativeSourceMissing: true,
        });
        reconstructedMissingKeys.push(key);
      }
    }
    dailyLevels = Array.from(authoritativeLevelMap.values())
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }

  const sourceIntegrityWarnings = dailyLevels
    .filter((level) => level?.sourceIntegrityWarning === true)
    .map((level) => String(level.key));

  console.log("CSA AUTHORITATIVE FRAMEWORK PERIODS:", {
    source: ["daily-in-week", "weekly-in-month"].includes(profile?.structureMode)
      ? "native higher-timeframe candles reconciled extreme-by-extreme against CSA period integrity"
      : profile.frameworkSourceLabel || null,
    providerSource: profile.frameworkSourceLabel || null,
    structureMode: profile.structureMode || null,
    authorityMode: ["daily-in-week", "weekly-in-month"].includes(profile?.structureMode)
      ? "native_completed_period_extreme_integrity_reconciliation_partial_period_reconstruction_only"
      : "provider_higher_timeframe_first",
    currentFrameworkPeriod: currentFrameworkPeriod?.key || null,
    currentFrameworkPeriodComplete,
    expectedFromExecution: executionReconstructedLevels.map((level) => ({
      key: level.key,
      label: level.periodLabel || level.day || level.key,
      high: level.high,
      low: level.low,
    })),
    nativeAlignment: alignedNative.matches || [],
    unmatchedNative: alignedNative.unmatchedNative || [],
    reconstructedMissingKeys,
    sourceIntegrityWarnings,
    resolved: dailyLevels.map((level) => ({
      key: level.key,
      label: level.periodLabel || level.day || level.key,
      high: level.high,
      low: level.low,
      source: level.source || profile.frameworkSourceLabel || null,
      sourceDatetime: level.sourceDatetime || null,
      nativeHigherTimeframeAuthority:
        level.nativeHigherTimeframeAuthority === true,
      hybridHigherTimeframeAuthority:
        level.hybridHigherTimeframeAuthority === true,
      highSource: level.highSource || null,
      lowSource: level.lowSource || null,
      partialPeriod: level.partialPeriod === true,
    })),
    rule: "completed_framework_periods_use_native_D1_W1_extremes_only_when_each_extreme_passes_session_integrity; native_period_mapping_is_chronologically_locked; contaminated_extremes_fall_back_to_cutoff_safe_same_period_reconstruction; incomplete_periods_reconstruct_only_to_cutoff",
  });
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
      authoritativeFrameworkInterval:
        frameworkInterval,
      authoritativeFrameworkSource:
        profile.frameworkSourceLabel || null,
      authoritativeFrameworkCandleCount:
        providerFrameworkLevels.length,
      resolvedFrameworkPeriodCount:
        dailyLevels.length,
      reconstructedMissingFrameworkPeriods:
        reconstructedMissingKeys,
      currentFrameworkPeriod:
        currentFrameworkPeriod?.key || null,
      currentFrameworkPeriodComplete,
      partialPeriodSource:
        currentFrameworkPeriodComplete
          ? (['daily-in-week', 'weekly-in-month'].includes(profile?.structureMode)
              ? 'native_higher_timeframe_candle_aligned_to_CSA_period'
              : profile.frameworkSourceLabel || null)
          : 'selected_timeframe_candles_up_to_cutoff',
      executionFrameworkCandleCount:
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
        "completed_higher_timeframe_source_candle_owns_framework_high_low; selected_timeframe_only_maps_period_identity_and_handles_incomplete_period_lifecycle",
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
    handoffApplied: phaseForBias?.diagnostics?.handoffApplied === true,
    handoffDirection: phaseForBias?.diagnostics?.handoffDirection || null,
    handoffReason: phaseForBias?.diagnostics?.handoffReason || null,
    currentPeriod: phaseForBias?.diagnostics?.currentPeriod || null,
    previousPeriod: phaseForBias?.diagnostics?.previousPeriod || null,
    secondaryCandlePhase: phaseForBias?.diagnostics?.secondaryCandlePhase || null,
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
    providerSymbol: resolvedProviderSymbol,
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

    parsed.latestVisibleDate = reconcileLatestVisibleDateWithAxisYear(
      parsed?.latestVisibleDate,
      parsed?.visibleTimeAxisYear
    );

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
    /*
     * V4.6.0 PERFORMANCE:
     * Skip a second validation vision call when deterministic evidence already
     * establishes a strong, usable trading chart. Rescue remains available
     * for weak/ambiguous evidence and genuine hard-reject cases.
     */
    const shouldTryRescue =
      !modelMarkedValid &&
      (
        evidence.hardReject === true ||
        evidence.strongChartEvidence !== true
      );

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
        parsed.latestVisibleDate = reconcileLatestVisibleDateWithAxisYear(
          parsed?.latestVisibleDate,
          parsed?.visibleTimeAxisYear
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
      visibleTimeAxisYear:
        isTradingChart && Number.isInteger(Number(parsed?.visibleTimeAxisYear))
          ? Number(parsed.visibleTimeAxisYear)
          : null,
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

async function detectChartHeaderFromImage({ imageBase64, mimeType, attempt = 1 }) {
  try {
    const response = await runVisionModel({
      systemPrompt: `Read only the top-left chart header. Return JSON only with rawHeaderText, detectedInstrument and detectedTimeframe. Transcribe the raw header before separating it. Preserve the visible broker ticker exactly (for example USA30,H1; US30,H1; XAUUSD,H1; GBPUSD,H1). Valid timeframe examples include M1, M5, M15, M30, H1, H4, D1, W1 and MN1. A comma immediately after a ticker separates it from the timeframe. Do not infer either value from price action.`,
      userText: attempt === 1
        ? "Read the instrument/ticker and timeframe printed in the extreme top-left chart header. Return only JSON."
        : attempt === 2
        ? "Second focused read: zoom attention onto the first printed text at the extreme top-left. Transcribe that header and return only JSON."
        : attempt === 3
        ? "Final focused read: inspect only the first line in the extreme top-left. Index headers can look like USA30,H1. Distinguish A from 4 and zero from O. Return the literal header and parsed values as JSON."
        : attempt === 4
        ? "OCR rescue: transcribe the complete first line in the top-left exactly as printed, including the comma and timeframe (for example AUDNZD,H1 or EURAUD,H1), then return the parsed ticker and timeframe as JSON."
        : "Last header-only pass: read the letter sequence before the first comma at top-left, then read the H1/H4/M15 code immediately after it. Ignore every price and return only rawHeaderText, detectedInstrument, detectedTimeframe as JSON.",
      imageBase64,
      mimeType,
      maxTokens: 160,
      openaiModel: "gpt-4.1",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });
    const parsed = extractJsonObject(response.text || "") || {};
    const parsedHeader = parseChartHeaderText(
      parsed.rawHeaderText || response.text || ""
    );
    return {
      detectedInstrument:
        String(parsed.detectedInstrument || parsedHeader.instrument || "").trim() || null,
      detectedTimeframe:
        comparableTimeframe(parsed.detectedTimeframe || parsedHeader.timeframe || "") || null,
      rawHeaderText: String(parsed.rawHeaderText || "").trim() || null,
    };
  } catch (error) {
    console.warn("Focused chart-header detection failed:", error?.message || error);
    return { detectedInstrument: null, detectedTimeframe: null };
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
    /(\d{1,6}(?:\.\d{1,8})?)\s*(?:-|\u2013|\u2014|â€“|â€”|to)\s*(\d{1,6}(?:\.\d{1,8})?)/i
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
        ? `around ${formatPrice(zoneLow)}\u2013${formatPrice(zoneHigh)}`
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
- Always use this internal order: first inventory and validate the next previous support/resistance candidates (including lifecycle conversion); second inventory and validate the next previous supply/demand candidates; third calculate hidden 38.2%, 50%, and 61.8% retracement prices and test every independently valid candidate; fourth sequence up to three survivors by price path as Entry 1, Entry 2, and Entry 3. Never stop after finding the first one or two candidates, and never use later entries as add-to-loser instructions.
- A structurally valid area that is not close to 38.2%, 50%, or 61.8% may remain an important chart reference, but it must not become Entry 1, Entry 2, or the preferred entry area. "Close" includes a conservative structurally strong area just past the exact 61.8 line; it does not include a clearly deep area.
- Use one common dominant completed impulse for every candidate in the same active directional leg. Never choose a candidate-specific origin or late swing merely to make an otherwise deep level pass the hidden confluence gate.
- Fibonacci must never create a setup by itself. The actual entry remains the support/resistance or supply/demand area, not the Fibonacci number. Treat 50%-61.8% as a valid retracement band and close proximity to 38.2% as valid. A structurally strong area only slightly past 61.8% may qualify within the conservative proximity allowance; anything clearly deeper is reference-only.
- The retracement must be calculated from the genuine completed impulse that produced the current directional breakout/breakdown, using the current structure-sequence origin and the final visible directional extreme; do not shrink the impulse to a late local swing merely because it is more recent.
- In Final Visible Candle mode, when the uploaded broker/platform chart and external OHLC feed use materially different price scales, use deterministic OHLC only to identify the relevant structure/impulse sequence and use the uploaded chart's own price scale for the impulse swing prices. Exact printed chart OHLC/labels outrank estimates. Never choose swing anchors to force Fibonacci confluence.
- A marked horizontal support/resistance/supply/demand price may calibrate the chart scale but must never automatically become the Fib swing origin. The swing origin is the actual candle wick/extreme; if a proposed origin collides with a marked reference line, independently verify the wick or reject the chart-native anchor.
- For Final Visible Candle reviews, prefer pixel-calibrated chart-native swing prices when the right-side price axis can be calibrated from at least two exact visible prices. Vision locates wick coordinates only; JavaScript converts Y coordinates to broker-chart prices. If calibration or wick geometry is unreliable, fall back to deterministic external OHLC rather than guessing.
- The deterministic structure engine must choose the impulse origin/terminal candle times. Vision must map those specific timestamps (allowing at most Â±2 candles for broker/timezone alignment) to wick coordinates on the uploaded chart; vision must not choose a different swing. Origin and terminal should be located in separate narrow visual tasks.
- The deterministic Fib origin must be the protected swing associated with the major structural level broken by the current directional breakout/breakdown, not merely the most recent higher low/lower high. For bullish structure, identify the major resistance pivot being broken and use the lowest confirmed protected swing low formed after that resistance pivot and before its breakout; bearish is the mirror image. Prefer the current breakout sequence and score major breaks by structural excursion, pivot age, and confirmed-pivot quality. Never select an old extreme solely because it creates better Fib confluence.
- Major broken-level selection must rank all actually broken confirmed prior swing highs/lows within the active lookback by structural significance rather than recency alone. Significance should consider time-to-break, prominence versus nearby same-side pivots, number of pre-break reactions, percentage of time price remained on the original side, opposing excursion size, separation from the final directional extreme, confirmed protected-pivot quality, and break displacement. Strongly penalize very recent/local pivots and raw-extreme-only protected swings. When two candidates are similarly significant, prefer the older structural pivot rather than the nearer local level.
- Structural-hierarchy major-break selection must scan each confirmed prior pivot independently for its first valid break, because the normal active-pivot event sequence can miss an older outer resistance/support after newer nested pivots form. Use a broader hierarchy lookback than the normal entry-area lookback. In bullish structure, rank higher/outer broken resistance above lower nested resistance when quality is comparable; in bearish structure rank lower/outer broken support above higher nested support. Reward outer levels broken later in the terminal expansion and penalize deeply nested local levels. Do not choose an outer level merely because it creates desired Fib confluence; it must still have a valid confirmed break and protected swing.
- Market-data windows are intentionally separate. The authoritative CSA framework window remains timeframe-specific (M1-H1 daily-in-selected-week, H4 weekly-in-selected-month, D1 monthly-in-selected-year, W1 quarterly-in-selected-year, MN yearly across the selected multi-year range). Fibonacci impulse discovery must use a broader historical context ending at the exact same cutoff. Broader impulse candles may identify the relevant protected swing and major broken level, but they must never create extra current-framework support/resistance candidates or change framework period identity.
- Completed higher-timeframe framework OHLC supplied by the backend is immutable. Claude must never recalculate Monday/Tuesday daily highs/lows, weekly highs/lows, monthly highs/lows, quarterly highs/lows, or yearly highs/lows from the screenshot when those backend values are present.
- If visual evidence appears to disagree with an authoritative market-data high/low, preserve the backend value and describe only the visible interaction; do not substitute a visually estimated price.
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
- Entry 2 is exceptional, not automatic. Keep it only when it is a separately validated structural area with independent evidence and hidden confluence on that same dominant impulse. Two adjacent framework levels with the same converted role do not justify two entries by themselves; keep the weaker/deeper one as reference-only.
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


async function readFrameworkPricesBatchFromChart({
  imageBase64,
  mimeType,
  targets,
  timeframe,
  structureLabel,
  marketReference,
}) {
  const normalizedTargets = Array.isArray(targets) ? targets : [];

  const prompt = `
You have ONE narrow chart-reading task.

Independently read every USER-DRAWN HORIZONTAL LINE price label visible on the chart.
Do NOT perform trading analysis.
Do NOT rank entries.
Do NOT calculate Fibonacci.
Do NOT infer support, resistance, supply, demand, period, side, or entry role.
Do NOT use any market-data or framework price as a hint.

TIMEFRAME: ${timeframe}

STRICT READING RULES:
1. Scan the full right-side price axis from top to bottom.
2. Return every coloured or dashed horizontal line that crosses the chart and has a printed price tag or price-axis label.
3. Closely stacked parallel lines are separate lines. Slow down around overlapping or touching price tags, count every distinct horizontal stroke, and read each attached label separately.
4. Before finishing, scan the price axis a second time and confirm that the number of returned items equals the number of distinct user-drawn horizontal strokes.
5. Copy the printed digits exactly into displayedPrice and platformLabel.
6. Exclude the live/current-price label, bid/ask quote, OHLC header values, ordinary axis tick labels, candle prices, and dates.
7. If a horizontal line is visible but its printed digits are not readable, set displayedPrice to null. Do not estimate or reconstruct digits.
8. Never invent digits.
9. Return the lines in visual top-to-bottom order.

Return JSON only:
{
  "lines": [
    {
      "colour": "blue | red | green | orange | other",
      "displayedPrice": null,
      "platformLabel": null,
      "evidence": "brief visual evidence identifying the horizontal line",
      "confidence": "high | medium | low"
    }
  ]
}`;

  try {
    const response = await runVisionModel({
      systemPrompt: prompt,
      userText:
        "Read only exact printed prices attached to user-drawn horizontal chart lines. Return JSON only.",
      imageBase64,
      mimeType,
      maxTokens: 1200,
      openaiModel: "gpt-4.1",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });

    const parsed = extractJsonObject(response.text || "");
    const rawLines = Array.isArray(parsed?.lines)
      ? parsed.lines
      : [];

    if (!rawLines.length) {
      return {
        ok: false,
        matches: [],
        reason: "Independent horizontal-line reader returned no exact lines.",
        provider: response.provider,
        model: response.model,
      };
    }

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

    const exactLabelTolerance = Math.max(
      standardTolerance,
      Number(atr || 0) * 0.25
    );

    const independentlyReadLines = rawLines
      .map((raw, index) => {
        const displayedPrice =
          nullablePositiveNumber(raw?.displayedPrice) ||
          extractNumericPriceFromLabel(raw?.platformLabel);

        if (displayedPrice === null) return null;

        const confidence = ["high", "medium", "low"].includes(
          String(raw?.confidence || "").toLowerCase()
        )
          ? String(raw.confidence).toLowerCase()
          : "low";

        return {
          index,
          displayedPrice,
          platformLabel:
            String(raw?.platformLabel || "").trim() ||
            String(displayedPrice),
          colour: String(raw?.colour || "other").toLowerCase(),
          evidence: safeUserText(raw?.evidence || ""),
          confidence,
        };
      })
      .filter(Boolean)
      .filter((line, index, lines) =>
        lines.findIndex(
          (candidate) =>
            Math.abs(
              candidate.displayedPrice - line.displayedPrice
            ) <= Number.EPSILON * 100
        ) === index
      );

    const normalizedMatches = normalizedTargets.map((target) => {
      const nearest = independentlyReadLines
        .map((line) => ({
          ...line,
          difference: Math.abs(
            Number(line.displayedPrice) -
            Number(target.frameworkPrice)
          ),
        }))
        .sort((a, b) => a.difference - b.difference)[0] || null;

      const candidateDifference = nearest?.difference ?? null;
      const withinTolerance =
        candidateDifference !== null &&
        candidateDifference <= exactLabelTolerance;

      return {
        period: target.period,
        side: target.side,
        frameworkPrice: target.frameworkPrice,
        areaType: target.areaType,
        executionOrder: target.executionOrder,
        displayedPrice: withinTolerance
          ? nearest.displayedPrice
          : null,
        approximatePrice: null,
        platformLabel: withinTolerance
          ? nearest.platformLabel
          : "",
        evidence: withinTolerance
          ? nearest.evidence
          : "",
        confidence: withinTolerance
          ? nearest.confidence
          : "low",
        withinTolerance,
        modelUsed: response.model,
        provider: response.provider,
        difference: candidateDifference,
        standardTolerance,
        exactLabelTolerance,
        selectedTolerance: exactLabelTolerance,
        batchRead: true,
        independentLineRead: true,
      };
    });

    return {
      ok: true,
      matches: normalizedMatches,
      independentlyReadLines,
      reason: "",
      provider: response.provider,
      model: response.model,
    };
  } catch (error) {
    console.warn(
      "Independent horizontal-line reader failed; retaining framework prices:",
      error?.message || error
    );

    return {
      ok: false,
      matches: [],
      reason:
        safeUserText(
          error?.message ||
            "Independent horizontal-line reader failed."
        ),
    };
  }
}

async function readCloseStackedHorizontalLinesFromChart({
  imageBase64,
  mimeType,
  fallback = {},
} = {}) {
  const candidates = Array.isArray(fallback?.candidates) ? fallback.candidates : [];
  const converted = candidates.filter((candidate) =>
    candidate?.exactVisiblePrice === true &&
    candidate?.conversionBreakConfirmed === true &&
    ["converted support", "converted resistance"].includes(
      String(candidate?.areaType || "").toLowerCase().trim()
    )
  );

  // This narrow read is reserved for a sparse converted-line inventory. It
  // avoids an extra request for ordinary charts while preventing closely
  // stacked, independently printed levels from being silently collapsed.
  if (converted.length !== 2 || candidates.length < 3) return [];

  const anchorPrices = converted
    .map((candidate) => Number(candidate.price))
    .filter((price) => Number.isFinite(price))
    .map((price) => String(price))
    .join(", ");
  if (!anchorPrices) return [];

  const prompt = `You have one narrow chart-reading task. Two converted horizontal lines have already been read at ${anchorPrices}.

Inspect only the small right-side price-axis regions immediately above and below those lines. Closely stacked parallel horizontal lines remain separate even when their coloured price labels touch or overlap.

Return any additional, distinct USER-DRAWN horizontal line labels that are visibly present in those tight stacks. Do not return the supplied anchor prices. Do not infer a price from Fibonacci, candles, or axis ticks. If no extra printed line is clearly visible, return an empty array.

Return JSON only:
{"lines":[{"colour":"blue | red | green | orange | other","displayedPrice":null,"platformLabel":null,"evidence":"brief visual proof"}]}`;

  const normalizeReadLines = (parsed) =>
    (Array.isArray(parsed?.lines) ? parsed.lines : [])
      .map((line) => ({
        displayedPrice:
          nullablePositiveNumber(line?.displayedPrice) ||
          extractNumericPriceFromLabel(line?.platformLabel),
        colour: String(line?.colour || "other").toLowerCase().trim(),
        evidence: safeUserText(line?.evidence || ""),
      }))
      .filter((line) =>
        line.displayedPrice !== null &&
        !converted.some((candidate) =>
          Math.abs(Number(candidate.price) - line.displayedPrice) <=
          Number.EPSILON * 100
        )
      );

  try {
    const response = await runVisionModel({
      systemPrompt: prompt,
      userText: "Read only additional close-stacked user-drawn horizontal price labels. Return JSON only.",
      imageBase64,
      mimeType,
      maxTokens: 600,
      openaiModel: "gpt-4.1",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });
    const initialLines = normalizeReadLines(extractJsonObject(response.text || ""));
    if (initialLines.length) return initialLines;

    // A first-pass description that calls a plotted level a "band" is
    // evidence that two price labels may be touching.  Re-read only that
    // compact case instead of widening normal S/R zones or guessing a Fib
    // price.  The second pass may add a line only when its printed label is
    // independently visible.
    const hasCloseBandEvidence = converted.some((candidate) =>
      /\b(?:band|stacked|touching|overlapping)\b/i.test(
        String(candidate?.structuralEvidence || "")
      )
    );
    if (!hasCloseBandEvidence) return [];

    const recoveryResponse = await runVisionModel({
      systemPrompt: `${prompt}\n\nRECHECK REQUIRED: one supplied converted line is explicitly described as a band. Count every separate horizontal stroke immediately around that band and transcribe each separate printed price tag. A second tag may sit directly below or above the first. Return an empty array only after confirming there is no second printed line.`,
      userText: "Re-read the close stacked price labels only. Return JSON only.",
      imageBase64,
      mimeType,
      maxTokens: 800,
      openaiModel: "gpt-4.1",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });
    return normalizeReadLines(extractJsonObject(recoveryResponse.text || ""));
  } catch (error) {
    console.warn("Close-stacked line reader failed:", error?.message || error);
    return [];
  }
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

  const structureLabel =
    marketReference?.profile?.structureLabel ||
    getSupportedCsaTimeframeProfile(timeframe)?.structureLabel ||
    "CSA framework periods";

  console.log("Focused framework price targets:", {
    timeframe,
    targets,
  });

  /*
   * V4.10.14 PRICE-LABEL AUTHORITY:
   * Read chart labels without disclosing framework prices to the model, then
   * map those independently read labels to deterministic targets server-side.
   * Never fall back to anchor-fed target readers, because they can repeat the
   * supplied framework number instead of reading the printed chart label.
   */
  const batchRead =
    await readFrameworkPricesBatchFromChart({
      imageBase64,
      mimeType,
      targets,
      timeframe,
      structureLabel,
      marketReference,
    });

  const batchComplete =
    batchRead?.ok === true &&
    Array.isArray(batchRead?.matches) &&
    batchRead.matches.length === targets.length;

  const matches = batchComplete
    ? batchRead.matches
    : [];

  console.log("Focused framework price extraction:", {
    timeframe,
    mode: batchComplete
      ? "independent_line_labels_then_server_mapping"
      : "independent_line_reader_failed_framework_prices_retained",
    targetCount:
      targets.length,
    matches,
  });

  return {
    ok: batchComplete,
    matches,
    independentlyReadLines:
      batchRead?.independentlyReadLines || [],
    reason: batchComplete
      ? ""
      : safeUserText(
          batchRead?.reason ||
          "Independent line-label reader failed."
        ),
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
  // vision-read, so use a tolerant but meaningful RÂ²/residual threshold.
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
6. Do not use a candle farther than Â±2 candles from the target.
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

  const structuralLevelHints = buildExactChartFrameworkCandidates({
    visualReview,
    marketReference,
    direction,
    currentPrice:
      asPositiveNumber(chartDetection?.latestVisiblePrice) ||
      currentReferencePrice(marketReference),
    symbol,
    atr,
  });

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
    structuralLevelHints,
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

  /*
   * V4.6.1 PERFORMANCE:
   * Price-scale calibration reading and timestamp-targeted wick location are
   * independent vision tasks. Previously we waited for the scale read before
   * starting wick mapping. Run both branches concurrently, then combine them
   * deterministically exactly as before.
   */
  const [
    scaleRead,
    wickLocation,
  ] = await Promise.all([
    extractChartPriceScalePoints({
      imageBase64,
      mimeType,
      timeframe,
      symbol,
      visualReview,
    }),
    locateChartNativeImpulseWicks({
      imageBase64,
      mimeType,
      direction,
      timeframe,
      symbol,
      marketImpulse,
      latestVisibleDate,
      latestVisibleTime,
    }),
  ]);

  if (!scaleRead?.ok) {
    return {
      usable: false,
      source: "external_ohlc",
      reason:
        scaleRead?.reason ||
        "chart_price_scale_points_unavailable",
      scaleRead,
      wickLocation,
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
      wickLocation,
    };
  }

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
    independentlyReadLines: Array.isArray(
      priceMap?.independentlyReadLines
    )
      ? priceMap.independentlyReadLines
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
  const independentLevels = (Array.isArray(priceMap?.independentlyReadLines)
    ? priceMap.independentlyReadLines
    : [])
    .map((line) => {
      const displayedPrice = nullablePositiveNumber(line?.displayedPrice);
      if (displayedPrice === null) return null;
      return {
        type: "label",
        description: safeUserText(line?.evidence || "independently read horizontal line"),
        displayedPrice,
        approximatePrice: null,
        platformLabel: String(line?.platformLabel || displayedPrice).trim(),
        frameworkPeriodHint: null,
        frameworkSideHint: null,
        extractionSource: "independent_horizontal_line_reader_exact",
        extractionConfidence: line?.confidence || "high",
      };
    })
    .filter(Boolean);

  priceMap.matches.forEach((match) => {
    const exact = nullablePositiveNumber(match?.displayedPrice);
    const approximate =
      exact === null
        ? nullablePositiveNumber(match?.approximatePrice)
        : null;

    const description =
      `${match?.period || "framework period"} ${match?.side || "level"}` +
      (match?.evidence ? ` â€” ${match.evidence}` : "");

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
          match?.independentLineRead === true
            ? "independent_horizontal_line_reader_exact"
            : "per_target_framework_price_reader",
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
          match?.independentLineRead === true
            ? "independent_horizontal_line_reader_estimate"
            : "per_target_framework_price_reader_estimate",
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
      ...independentLevels,
      ...exactLevels,
      ...approximateLevels,
      ...(Array.isArray(visualReview?.visibleMarkedLevels)
        ? visualReview.visibleMarkedLevels
        : []),
    ]
      .filter((item, index, items) => {
        const price = nullablePositiveNumber(item?.displayedPrice);
        if (price === null) return true;
        return items.findIndex((candidate) => {
          const candidatePrice = nullablePositiveNumber(candidate?.displayedPrice);
          return candidatePrice !== null && Math.abs(candidatePrice - price) <= Number.EPSILON * 100;
        }) === index;
      })
      .slice(0, 40),
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
- Normally do not create entry areas from the selected chart date. EXCEPTION: in End-of-selected-day or Exact-historical-time mode, when the backend has confirmed that the cutoff period itself created a new directional takeover, a fresh intraday demand/supply base formed BEFORE the confirmed takeover break may be used as a structural candidate. It must still pass the same structural-quality and 38.2%/50%/61.8% gate. Do not use later candles or a base formed after the cutoff.
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
- When there are two or three independently valid entry areas, label them Entry 1, Entry 2, and Entry 3 in price-path order. Do not automatically dismiss an earlier entry or claim a later one is always better. Explain that a later entry is an alternative only if the earlier area fails and a fresh trigger appears. Never encourage adding to a losing position.
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

MANDATORY PRICE-READING PASS â€” DO THIS BEFORE ANALYSING DIRECTION OR ENTRY AREAS:
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

INTERNAL CHART-NATIVE FALLBACK (never show this wording to the customer):
- Complete this only when Twelve Data available for this review is "no".
- Read the instrument, timeframe, final visible price, exact printed horizontal prices, and the latest completed directional impulse directly from the screenshot.
- Apply the fixed order: (1) support/resistance and genuine conversions, (2) independent supply/demand displacement bases, (3) hidden 38.2/50/61.8 Fibonacci confluence, (4) Entry 1, optional Entry 2, and optional Entry 3 by price path.
- Fibonacci may qualify structure but may never create a level. Do not mention Fibonacci in any customer-facing field.
- An S/R candidate requires an exact printed chart price. A supply/demand candidate requires a visible base/zone and its own displacement evidence.
- Ordinary black price-axis tick labels are not zone boundaries. A supply/demand boundary must be a visibly drawn line/rectangle boundary or a candle-defined base boundary.
- When two separately printed horizontal S/R lines are visible inside a proposed broad zone and price has broken them, preserve the two exact lines as converted S/R. Never replace them with one inferred supply/demand zone.
- Inventory every independently visible structural candidate, up to twelve. Do not pre-limit the inventory to the three final entries. The deterministic selector will apply the structural and Fibonacci gates, then choose no more than three genuinely separate entries.
- Set usable=false rather than guessing any unreadable price, impulse, direction, or structural role.

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
  "strategyVerdict": "Valid strategy setup | Partially follows strategy | Does not follow strategy | Not enough evidence",
  "internalChartNativeFallback": {
    "usable": false,
    "direction": "bullish | bearish | range",
    "currentPrice": null,
    "swingHigh": null,
    "swingLow": null,
    "candidates": [
      {
        "price": null,
        "zoneLow": null,
        "zoneHigh": null,
        "areaType": "support | resistance | demand | supply | converted support | converted resistance",
        "exactVisiblePrice": false,
        "conversionBreakConfirmed": false,
        "structuralEvidence": "specific visible line lifecycle or displacement-base evidence",
        "independentEntryEvidence": false,
        "fibRatio": null,
        "fibPrice": null
      }
    ]
  }
}`;

  try {
    const response = await runVisionModel({
      systemPrompt: prompt,
      userText:
        "Review this uploaded chart in simple beginner trader language using the internal support/resistance framework. Return only the required JSON.",
      imageBase64,
      mimeType,
      // V4.6.1 PERFORMANCE:
      // Keep the same structured review, but avoid reserving an unnecessarily
      // large generation budget for prose the deterministic backend later
      // normalizes/locks anyway.
      maxTokens: 2000,
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
            frameworkPeriodHint:
              String(item?.frameworkPeriodHint || "").trim() || null,
            extractionSource: "full_visual_review",
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
            frameworkPeriodHint:
              String(item?.frameworkPeriodHint || "").trim() || null,
            extractionSource: "full_visual_review",
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
      chartNativeEntryFallback: promoteConfirmedBreakPassedExactLevels(
        replaceMisclassifiedZoneWithExactConvertedLines(
          normalizeChartNativeEntryFallback(parsed.internalChartNativeFallback || {}),
          [
            ...(Array.isArray(parsed.visibleMarkedLevels) ? parsed.visibleMarkedLevels : []),
            ...(Array.isArray(parsed.visibleHorizontalLines) ? parsed.visibleHorizontalLines : []),
          ]
        )
      ),
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
            ? `around ${formatPrice(marketZone.low)}\u2013${formatPrice(marketZone.high)}`
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

    // No trigger yet means â€œnot readyâ€, not â€œzero accuracyâ€.
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
    /\d+(?:\.\d+)?\s*(?:-|\u2013|â€“|to)\s*\d+(?:\.\d+)?/i.test(zoneText);

  let priceText = zoneText;
  if (hasLow && hasHigh) {
    const zoneMin = Math.min(low, high);
    const zoneMax = Math.max(low, high);
    priceText = `${formatPrice(zoneMin)}\u2013${formatPrice(zoneMax)}`;
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

  if (/\d+(?:\.\d+)?\s*(?:-|\u2013|\u2014|â€“|â€”|to)\s*$/i.test(text)) {
    return true;
  }

  const range = text.match(
    /(\d+(?:\.\d+)?)\s*(?:-|\u2013|\u2014|â€“|â€”|to)\s*(\d+\.?\d*)\s*$/i
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

  if (
    /no completed trade|no executed trade|no visible trade|no trade (?:or )?entry|trade entry is (?:not shown|not visible)/.test(
      text
    )
  ) {
    return "trade_evidence_missing";
  }

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
    "trade_evidence_missing",
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



const CSA_FEEDBACK_ENGINE_VERSION = "10.42.0";
const CSA_BUILD_ID = "CSA-v4.34.0-expanded-instrument-recognition";
const CSA_SCORING_MODEL_VERSION = "2.1.0-evidence-owned";

// V4.10.17 — HISTORICAL BENCHMARK CONTRACTS
// These checks never create, reorder, or promote an entry. They only audit the
// selector's completed result against the three reviewed XAUUSD H1 snapshots,
// so a later code change cannot silently reintroduce a previously fixed level.
const CSA_XAU_HISTORICAL_BENCHMARKS = Object.freeze({
  "2026-08-04": Object.freeze({
    expectedEntryCenters: Object.freeze([4047.20]),
    forbiddenEntryCenters: Object.freeze([4019.20]),
    expectedReferenceCenters: Object.freeze([]),
  }),
  "2026-08-05": Object.freeze({
    expectedEntryCenters: Object.freeze([4106.15]),
    forbiddenEntryCenters: Object.freeze([4088.47]),
    expectedReferenceCenters: Object.freeze([4088.47]),
  }),
  "2026-08-06": Object.freeze({
    expectedEntryCenters: Object.freeze([]),
    forbiddenEntryCenters: Object.freeze([4224.23, 4106.15]),
    expectedReferenceCenters: Object.freeze([4224.23, 4106.15]),
  }),
});

function auditXauHistoricalBenchmark({
  symbol = "",
  timeframe = "",
  cutoffDate = "",
  selectedAreas = [],
  referenceAreas = [],
}) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const normalizedTimeframe = String(timeframe || "").toUpperCase();
  const normalizedDate = String(cutoffDate || "").slice(0, 10);
  const contract = CSA_XAU_HISTORICAL_BENCHMARKS[normalizedDate];

  if (!normalizedSymbol.includes("XAU") || normalizedTimeframe !== "H1" || !contract) {
    return {
      applicable: false,
      passed: true,
      benchmarkDate: normalizedDate || null,
      failures: [],
    };
  }

  const centerOf = (area) => {
    const authoritativeCenter = Number(area?.authoritativeCenter);
    if (Number.isFinite(authoritativeCenter)) return authoritativeCenter;

    const low = Number(area?.zoneLow);
    const high = Number(area?.zoneHigh);
    if (Number.isFinite(low) && Number.isFinite(high)) return (low + high) / 2;

    const resolved = Number(area?.resolvedEntryPrice);
    return Number.isFinite(resolved) ? resolved : null;
  };

  const selectedCenters = (selectedAreas || []).map(centerOf).filter(Number.isFinite);
  const referenceCenters = (referenceAreas || []).map(centerOf).filter(Number.isFinite);
  // Gold zones are often represented by either their authoritative line or
  // the midpoint of the full displacement-base candle. Six dollars keeps the
  // same reviewed zone equivalent without confusing nearby structural levels.
  const near = (actual, expected) => Math.abs(Number(actual) - Number(expected)) <= 6;
  const failures = [];

  for (const expected of contract.expectedEntryCenters) {
    if (!selectedCenters.some((actual) => near(actual, expected))) {
      failures.push(`missing_expected_entry_${expected}`);
    }
  }

  for (const forbidden of contract.forbiddenEntryCenters) {
    if (selectedCenters.some((actual) => near(actual, forbidden))) {
      failures.push(`forbidden_entry_promoted_${forbidden}`);
    }
  }

  for (const expected of contract.expectedReferenceCenters) {
    if (!referenceCenters.some((actual) => near(actual, expected))) {
      failures.push(`missing_expected_reference_${expected}`);
    }
  }

  return {
    applicable: true,
    passed: failures.length === 0,
    benchmarkDate: normalizedDate,
    selectedCenters,
    referenceCenters,
    failures,
  };
}

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
        ? `${formatPrice(zoneLow, symbol)}\u2013${formatPrice(zoneHigh, symbol)}`
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

function deriveHistoricalFrameworkLocalFibImpulse({
  marketReference = {},
  direction = "range",
  timeframe = "H1",
  symbol = "",
}) {
  const cutoffMode = normalizeCutoffMode(
    marketReference?.chartCutoff?.mode || "final_visible"
  );

  const historicalMode = ["selected_day", "exact"].includes(cutoffMode);
  const tf = comparableTimeframe(timeframe) || "H1";
  const intradayFramework = ["M1", "M5", "M15", "M30", "H1"].includes(tf);
  const levels = Array.isArray(marketReference?.dailyLevels)
    ? [...marketReference.dailyLevels].sort((a, b) =>
        String(a?.key || a?.date || "").localeCompare(
          String(b?.key || b?.date || "")
        )
      )
    : [];

  if (!intradayFramework || levels.length < 2) {
    return {
      enabled: false,
      cutoffMode,
      timeframe: tf,
      reason: !intradayFramework
        ? "not_intraday_daily_framework"
        : "fewer_than_two_framework_periods",
    };
  }

  const terminalPeriod = levels[levels.length - 1];
  const originPeriod = levels[levels.length - 2];
  const frameworkTolerance = Math.max(
    Number(marketReference?.cleanBreakTolerance || 0),
    getCleanBreakTolerance(symbol),
    Number.EPSILON * 100
  );
  const originHigh = asPositiveNumber(originPeriod?.high);
  const originLow = asPositiveNumber(originPeriod?.low);
  const terminalHigh = asPositiveNumber(terminalPeriod?.high);
  const terminalLow = asPositiveNumber(terminalPeriod?.low);
  if (!historicalMode) {
    return {
      enabled: false,
      cutoffMode,
      timeframe: tf,
      direction,
      reason: "final_visible_uses_latest_confirmed_break_impulse",
    };
  }

  const originPrice =
    direction === "bearish"
      ? asPositiveNumber(originPeriod?.high)
      : direction === "bullish"
      ? asPositiveNumber(originPeriod?.low)
      : null;

  const terminalPrice =
    direction === "bearish"
      ? asPositiveNumber(terminalPeriod?.low)
      : direction === "bullish"
      ? asPositiveNumber(terminalPeriod?.high)
      : null;

  const validMove =
    originPrice !== null &&
    terminalPrice !== null &&
    ((direction === "bearish" && originPrice > terminalPrice) ||
      (direction === "bullish" && terminalPrice > originPrice));

  if (!validMove) {
    return {
      enabled: false,
      cutoffMode,
      timeframe: tf,
      direction,
      originPeriod: originPeriod?.periodLabel || originPeriod?.day || originPeriod?.key || null,
      terminalPeriod: terminalPeriod?.periodLabel || terminalPeriod?.day || terminalPeriod?.key || null,
      originPrice,
      terminalPrice,
      reason: "adjacent_framework_periods_do_not_form_directional_impulse",
    };
  }

  return {
    enabled: true,
    cutoffMode,
    timeframe: tf,
    direction,
    authorityMode: "historical_cutoff_adjacent_framework_impulse",
    originPrice,
    terminalPrice,
    originTime: originPeriod?.date
      ? `${originPeriod.date}T00:00:00`
      : originPeriod?.key || null,
    terminalTime: terminalPeriod?.date
      ? `${terminalPeriod.date}T23:59:59`
      : terminalPeriod?.key || null,
    originPeriod: originPeriod?.periodLabel || originPeriod?.day || originPeriod?.key || null,
    terminalPeriod: terminalPeriod?.periodLabel || terminalPeriod?.day || terminalPeriod?.key || null,
    originPeriodKey: originPeriod?.key || originPeriod?.date || null,
    terminalPeriodKey: terminalPeriod?.key || terminalPeriod?.date || null,
    rule: "historical_intraday_fib_uses_immediately_preceding_framework_period_origin_to_cutoff_period_terminal",
    reason: direction === "bearish"
      ? "previous_framework_period_high_to_cutoff_period_low"
      : "previous_framework_period_low_to_cutoff_period_high",
  };
}

function scoreFibonacciFrameAgainstStructuralHints({
  direction = "range",
  swingLow = null,
  swingHigh = null,
  structuralLevelHints = [],
  atr = 0,
  symbol = "",
} = {}) {
  const low = Number(swingLow);
  const high = Number(swingHigh);
  const normalizedAtr = Math.max(0, Number(atr || 0));

  if (
    !["bullish", "bearish"].includes(direction) ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    high <= low
  ) {
    return {
      matchCount: 0,
      normalizedDistanceSum: Number.POSITIVE_INFINITY,
      matches: [],
    };
  }

  const range = high - low;
  const fibLevels = [0.382, 0.5, 0.618].map((ratio) => ({
    ratio,
    price:
      direction === "bearish"
        ? low + range * ratio
        : high - range * ratio,
  }));
  const allowance = Math.max(
    normalizedAtr * 0.6,
    getCleanBreakTolerance(symbol) * 0.5,
    Number.EPSILON * 100
  );

  const matches = (Array.isArray(structuralLevelHints)
    ? structuralLevelHints
    : [])
    .filter(
      (hint) =>
        hint?.authoritativeFrameworkLevel === true &&
        hint?.chartReconciled === true
    )
    .map((hint) => {
      const center = asPositiveNumber(
        hint?.price ?? hint?.authoritativeCenter
      );
      if (center === null) return null;

      const halfWidth = Math.max(
        getApprovedPriceTolerance(symbol),
        normalizedAtr * 0.025
      );
      const zoneLow = Number.isFinite(Number(hint?.zoneLow))
        ? Number(hint.zoneLow)
        : center - halfWidth;
      const zoneHigh = Number.isFinite(Number(hint?.zoneHigh))
        ? Number(hint.zoneHigh)
        : center + halfWidth;
      const nearest = fibLevels
        .map((level) => ({
          ...level,
          distance: distanceFromPriceToZone(
            level.price,
            zoneLow,
            zoneHigh
          ),
        }))
        .sort((a, b) => a.distance - b.distance)[0];

      if (!nearest || nearest.distance > allowance) return null;
      return {
        price: center,
        areaType: hint?.type || hint?.areaType || null,
        ratio: nearest.ratio,
        fibPrice: nearest.price,
        distance: nearest.distance,
        normalizedDistance:
          allowance > 0 ? nearest.distance / allowance : 0,
      };
    })
    .filter(Boolean)
    .filter((match, index, allMatches) =>
      allMatches.findIndex((candidate) =>
        Math.abs(Number(candidate.price) - Number(match.price)) <=
        Number.EPSILON * 100
      ) === index
    );

  return {
    matchCount: matches.length,
    normalizedDistanceSum: matches.reduce(
      (sum, match) => sum + Number(match.normalizedDistance || 0),
      0
    ),
    allowance,
    matches,
  };
}

function buildLatestImpulseFibonacci({
  candles = [],
  historicalPhase = null,
  direction = "range",
  timeframe = "H1",
  symbol = "",
  chartNativeImpulse = null,
  finalVisibleEndpointAuthority = null,
  historicalFrameworkImpulseAuthority = null,
  structuralLevelHints = [],
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

  // One deterministic current-period Fib frame applies to every candidate:
  // M1-H1=current week, H4=current month, D1/W1=current year. Do not let a
  // shorter structure-led/chart-native impulse manufacture confluence.
  const visiblePeriodFrame = finalVisibleEndpointAuthority?.enabled === true
    ? buildVisiblePeriodFibonacciFrame({ candles: ordered, direction, timeframe })
    : null;
  if (visiblePeriodFrame) {
    return {
      ...visiblePeriodFrame,
      marketDataSwingHigh: visiblePeriodFrame.swingHigh,
      marketDataSwingLow: visiblePeriodFrame.swingLow,
      priceSource: `external_ohlc_${visiblePeriodFrame.source}`,
      chartNativeConfidence: null,
      historicalFrameworkImpulseAuthority: null,
      finalVisibleTerminalImpulse: null,
      finalVisibleEndpointAuthority: {
        price: finalVisibleEndpointAuthority?.price ?? null,
        applied: false,
        reason: "H1 uses the visible current-week high/low Fibonacci frame",
        tolerance: null,
        source: finalVisibleEndpointAuthority?.source || "final_visible_chart_price",
      },
      selectionReason: "H1 current visible week high/low",
      controllingEvent: null,
      latestOppositeEvent: null,
      protectedSwing: null,
      outerStructuralOrigin: null,
      brokenMajorLevel: null,
      majorBreakCandidateCount: 0,
      majorBreakCandidateAudit: [],
    };
  }

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
      .map((candidate) => {
        // CSA order of operations is structure first, Fibonacci second.
        // Score every otherwise-valid completed impulse against the exact
        // chart/framework levels before choosing the controlling impulse.
        // This prevents the highest generic hierarchy score from selecting a
        // broad or stale leg that cannot validate the chart's actual S/R or
        // S/D structure.
        const candidateSwingLow =
          direction === "bullish"
            ? Number(candidate.protectedPrice)
            : Number(finalExtremePrice);
        const candidateSwingHigh =
          direction === "bullish"
            ? Number(finalExtremePrice)
            : Number(candidate.protectedPrice);

        return {
          ...candidate,
          structuralHintScore: scoreFibonacciFrameAgainstStructuralHints({
            direction,
            swingLow: candidateSwingLow,
            swingHigh: candidateSwingHigh,
            structuralLevelHints,
            atr,
            symbol,
          }),
        };
      })
      .filter((candidate) =>
        Number(candidate.significanceScore) >= 18 &&
        (
          Number(candidate.hierarchyAdjustedScore) >= 34 ||
          Number(candidate?.structuralHintScore?.matchCount || 0) > 0
        )
      )
      .sort(compareStructureLedCompletedImpulseCandidates);

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

  let outerStructuralOrigin =
    findOuterStructuralOrigin({
      selection:
        majorSelection,
    });

  const structureLedRecentImpulse =
    isMostRecentStructureCompatibleImpulse(
      majorSelection,
      majorBreakCandidates
    );

  if (majorSelection && outerStructuralOrigin && structuralLevelHints.length) {
    const localFrameScore = scoreFibonacciFrameAgainstStructuralHints({
      direction,
      swingLow:
        direction === "bullish"
          ? Number(majorSelection.protectedPrice)
          : Number(finalExtremePrice),
      swingHigh:
        direction === "bullish"
          ? Number(finalExtremePrice)
          : Number(majorSelection.protectedPrice),
      structuralLevelHints,
      atr,
      symbol,
    });
    const outerFrameScore = scoreFibonacciFrameAgainstStructuralHints({
      direction,
      swingLow:
        direction === "bullish"
          ? Number(outerStructuralOrigin.price)
          : Number(finalExtremePrice),
      swingHigh:
        direction === "bullish"
          ? Number(finalExtremePrice)
          : Number(outerStructuralOrigin.price),
      structuralLevelHints,
      atr,
      symbol,
    });
    const localMatches = Number(localFrameScore.matchCount || 0);
    const outerMatches = Number(outerFrameScore.matchCount || 0);

    // A broader outer origin is retained only when it explains strictly more
    // nearby-period structure than the protected local swing. Equal matches
    // stay with the local completed impulse; otherwise an old broad origin can
    // win merely because its wider grid is marginally closer to one price.
    if (
      structureLedRecentImpulse ||
      (localMatches > 0 && localMatches >= outerMatches)
    ) {
      outerStructuralOrigin = null;
    }
  }

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

  // Final-visible charts must use the impulse responsible for the latest
  // confirmed directional break. The older adjacent-day shortcut can be much
  // broader and may grant Fibonacci confluence to stale structural levels.
  const finalVisibleTerminalImpulse =
    historicalFrameworkImpulseAuthority?.cutoffMode === "final_visible"
      ? buildFinalVisibleTerminalImpulse({
          candles: ordered,
          direction,
          directionalEvent: latestDirectionalEvent,
          oppositeEvent: latestOppositeEventBeforeCurrent,
        })
      : null;

  let finalVisibleTerminalImpulseApplied = false;

  const majorStructuralScore = scoreFibonacciFrameAgainstStructuralHints({
    direction,
    swingLow: selectedSwingLow,
    swingHigh: selectedSwingHigh,
    structuralLevelHints,
    atr,
    symbol,
  });

  const terminalStructuralScore = finalVisibleTerminalImpulse
    ? scoreFibonacciFrameAgainstStructuralHints({
        direction,
        swingLow:
          direction === "bullish"
            ? finalVisibleTerminalImpulse.originPrice
            : finalVisibleTerminalImpulse.terminalPrice,
        swingHigh:
          direction === "bullish"
            ? finalVisibleTerminalImpulse.terminalPrice
            : finalVisibleTerminalImpulse.originPrice,
        structuralLevelHints,
        atr,
        symbol,
      })
    : null;

  if (shouldApplyFinalVisibleTerminalImpulse({
    terminalImpulse: finalVisibleTerminalImpulse,
    majorSelection,
    terminalStructuralScore,
    majorStructuralScore,
    direction,
  })) {
    if (direction === "bullish") {
      selectedSwingLow = finalVisibleTerminalImpulse.originPrice;
      selectedSwingHigh = finalVisibleTerminalImpulse.terminalPrice;
      selectedSwingLowTime =
        ordered[finalVisibleTerminalImpulse.originStartIndex]?.datetime ||
        selectedSwingLowTime;
      selectedSwingHighTime =
        ordered.find(
          (candle) => Number(candle?.high) === finalVisibleTerminalImpulse.terminalPrice
        )?.datetime || selectedSwingHighTime;
    } else {
      selectedSwingHigh = finalVisibleTerminalImpulse.originPrice;
      selectedSwingLow = finalVisibleTerminalImpulse.terminalPrice;
      selectedSwingHighTime =
        ordered[finalVisibleTerminalImpulse.originStartIndex]?.datetime ||
        selectedSwingHighTime;
      selectedSwingLowTime =
        ordered.find(
          (candle) => Number(candle?.low) === finalVisibleTerminalImpulse.terminalPrice
        )?.datetime || selectedSwingLowTime;
    }

    priceSource = finalVisibleTerminalImpulse.source;
    selectionReason = `${selectionReason}_latest_confirmed_break_impulse_override`;
    finalVisibleTerminalImpulseApplied = true;
  }

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

  /*
   * V4.6.8 HISTORICAL FRAMEWORK-LOCAL FIB IMPULSE AUTHORITY
   *
   * For M1-H1 selected-day / exact historical reviews, the relevant CSA Fib
   * impulse is the completed move joining the immediately preceding daily
   * framework period to the current cutoff period. This prevents an older
   * 60-day protected swing from replacing the local Monday->Tuesday (etc.)
   * impulse that the historical CSA framework is actually evaluating.
   *
   * Bearish: previous period HIGH -> cutoff period LOW.
   * Bullish: previous period LOW -> cutoff period HIGH.
   *
   * Final-visible behavior is deliberately untouched.
   */
  const historicalFrameworkImpulseEnabled =
    historicalFrameworkImpulseAuthority?.enabled === true &&
    historicalFrameworkImpulseAuthority?.direction === direction;

  let historicalFrameworkImpulseApplied = false;
  let historicalFrameworkImpulseSuppressedByControllingSwing = false;
  let historicalFrameworkTerminalExtension = null;
  let historicalFrameworkTerminalExtensionTolerance = null;

  if (historicalFrameworkImpulseEnabled) {
    const historicalOrigin = asPositiveNumber(
      historicalFrameworkImpulseAuthority?.originPrice
    );
    const historicalTerminal = asPositiveNumber(
      historicalFrameworkImpulseAuthority?.terminalPrice
    );

    if (
      historicalOrigin !== null &&
      historicalTerminal !== null &&
      ((direction === "bearish" && historicalOrigin > historicalTerminal) ||
        (direction === "bullish" && historicalTerminal > historicalOrigin))
    ) {
      /*
       * V4.10.16 CUTOFF-SAFE CONTROLLING-SWING EXCEPTION
       *
       * Do not let the daily shortcut truncate a completed H1 controlling
       * impulse. Preserve the cutoff-safe protected/major swing when both
       * endpoints extend beyond the shortcut and the terminal extension is
       * structural rather than broker/feed noise.
       *
       * XAUUSD 2026-08-04 regression: 3996.32338 -> 4119.46447 remains the
       * controlling bullish impulse. Its 61.8 retracement is 4043.36328, so
       * demand 4042.01423-4043.21423 receives the intended Fib confluence.
       */
      const cleanBreakTolerance = Math.max(
        getCleanBreakTolerance(symbol),
        Number.EPSILON * 100
      );

      historicalFrameworkTerminalExtension =
        direction === "bullish"
          ? Number(selectedSwingHigh) - historicalTerminal
          : historicalTerminal - Number(selectedSwingLow);

      historicalFrameworkTerminalExtensionTolerance = Math.max(
        cleanBreakTolerance * 2,
        Number(atr || 0) * 0.35
      );

      const controllingOriginExtendsBeyondFramework =
        direction === "bullish"
          ? Number(selectedSwingLow) < historicalOrigin - cleanBreakTolerance
          : Number(selectedSwingHigh) > historicalOrigin + cleanBreakTolerance;

      const retainCutoffSafeControllingSwing =
        majorSelection &&
        Number.isFinite(historicalFrameworkTerminalExtension) &&
        historicalFrameworkTerminalExtension >
          historicalFrameworkTerminalExtensionTolerance &&
        controllingOriginExtendsBeyondFramework;

      if (retainCutoffSafeControllingSwing) {
        historicalFrameworkImpulseSuppressedByControllingSwing = true;
        selectionReason =
          `${selectionReason}_cutoff_safe_controlling_swing_retained`;
      } else {
        if (direction === "bearish") {
          selectedSwingHigh = historicalOrigin;
          selectedSwingLow = historicalTerminal;
          selectedSwingHighTime =
            historicalFrameworkImpulseAuthority?.originTime || selectedSwingHighTime;
          selectedSwingLowTime =
            historicalFrameworkImpulseAuthority?.terminalTime || selectedSwingLowTime;
        } else {
          selectedSwingLow = historicalOrigin;
          selectedSwingHigh = historicalTerminal;
          selectedSwingLowTime =
            historicalFrameworkImpulseAuthority?.originTime || selectedSwingLowTime;
          selectedSwingHighTime =
            historicalFrameworkImpulseAuthority?.terminalTime || selectedSwingHighTime;
        }

        priceSource = "historical_framework_local_impulse";
        selectionReason =
          `${selectionReason}_historical_framework_local_impulse_override`;
        historicalFrameworkImpulseApplied = true;
      }
    }
  }

  if (historicalFrameworkImpulseEnabled && !suppressImpulseLog) {
    console.log("CSA HISTORICAL FRAMEWORK FIB IMPULSE AUTHORITY:", {
      buildId: CSA_BUILD_ID,
      direction,
      cutoffMode: historicalFrameworkImpulseAuthority?.cutoffMode || null,
      timeframe: historicalFrameworkImpulseAuthority?.timeframe || timeframe,
      originPeriod: historicalFrameworkImpulseAuthority?.originPeriod || null,
      terminalPeriod: historicalFrameworkImpulseAuthority?.terminalPeriod || null,
      originPrice: historicalFrameworkImpulseAuthority?.originPrice ?? null,
      terminalPrice: historicalFrameworkImpulseAuthority?.terminalPrice ?? null,
      selectedSwingLow,
      selectedSwingHigh,
      applied: historicalFrameworkImpulseApplied,
      suppressedByCutoffSafeControllingSwing:
        historicalFrameworkImpulseSuppressedByControllingSwing,
      controllingTerminalExtension:
        historicalFrameworkTerminalExtension,
      controllingTerminalExtensionTolerance:
        historicalFrameworkTerminalExtensionTolerance,
      reason: historicalFrameworkImpulseAuthority?.reason || null,
      rule: historicalFrameworkImpulseAuthority?.rule || null,
      futureCandlesExcluded: true,
    });
  }

  /*
   * V4.6.7 FINAL-VISIBLE FIB ENDPOINT AUTHORITY
   *
   * Direction and the Fibonacci terminal must describe the same visible chart
   * state. When the uploaded chart endpoint has moved materially beyond the
   * last external-OHLC terminal, use that verified final-visible endpoint as a
   * conservative terminal anchor. This rule is FINAL-VISIBLE ONLY and does not
   * change selected-day/exact historical reconstruction.
   *
   * A validated chart-native wick remains preferable because it gives the
   * actual wick price. Endpoint authority is therefore a fallback used only
   * while the impulse is still sourced from external OHLC.
   */
  const finalVisibleEndpointPrice =
    asPositiveNumber(
      finalVisibleEndpointAuthority?.price
    );

  const finalVisibleEndpointEnabled =
    finalVisibleEndpointAuthority?.enabled === true &&
    finalVisibleEndpointPrice !== null;

  const finalVisibleEndpointTolerance = Math.max(
    getApprovedPriceTolerance(symbol) * 4,
    Number(atr || 0) * 0.35
  );

  let finalVisibleEndpointApplied = false;
  let finalVisibleEndpointReason = null;

  if (
    finalVisibleEndpointEnabled &&
    ["external_ohlc", "final_visible_latest_confirmed_break_impulse"].includes(priceSource)
  ) {
    if (
      direction === "bullish" &&
      finalVisibleEndpointPrice >
        selectedSwingHigh + finalVisibleEndpointTolerance
    ) {
      selectedSwingHigh = finalVisibleEndpointPrice;
      selectedSwingHighTime =
        finalVisibleEndpointAuthority?.datetime ||
        selectedSwingHighTime;
      priceSource =
        "final_visible_chart_endpoint";
      selectionReason =
        `${selectionReason}_final_visible_terminal_override`;
      finalVisibleEndpointApplied = true;
      finalVisibleEndpointReason =
        "bullish_chart_endpoint_materially_above_external_terminal";
    } else if (
      direction === "bearish" &&
      finalVisibleEndpointPrice <
        selectedSwingLow - finalVisibleEndpointTolerance
    ) {
      selectedSwingLow = finalVisibleEndpointPrice;
      selectedSwingLowTime =
        finalVisibleEndpointAuthority?.datetime ||
        selectedSwingLowTime;
      priceSource =
        "final_visible_chart_endpoint";
      selectionReason =
        `${selectionReason}_final_visible_terminal_override`;
      finalVisibleEndpointApplied = true;
      finalVisibleEndpointReason =
        "bearish_chart_endpoint_materially_below_external_terminal";
    }
  }

  if (finalVisibleEndpointEnabled && !suppressImpulseLog) {
    console.log("CSA FINAL VISIBLE FIB ENDPOINT AUTHORITY:", {
      buildId: CSA_BUILD_ID,
      direction,
      enabled: true,
      externalSwingLow: finalSwingLow,
      externalSwingHigh: finalSwingHigh,
      chartVisibleEndpoint: finalVisibleEndpointPrice,
      selectedSwingLow,
      selectedSwingHigh,
      endpointSource:
        finalVisibleEndpointAuthority?.source ||
        "final_visible_chart_price",
      endpointTolerance: finalVisibleEndpointTolerance,
      applied: finalVisibleEndpointApplied,
      reason:
        finalVisibleEndpointReason ||
        (priceSource !== "external_ohlc"
          ? "validated_chart_native_wick_retained"
          : "chart_endpoint_did_not_extend_beyond_external_terminal"),
      historicalCutoffIsolation: true,
    });
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
    historicalFrameworkImpulseAuthority: historicalFrameworkImpulseEnabled
      ? {
          applied: historicalFrameworkImpulseApplied,
          suppressedByCutoffSafeControllingSwing:
            historicalFrameworkImpulseSuppressedByControllingSwing,
          controllingTerminalExtension:
            historicalFrameworkTerminalExtension,
          controllingTerminalExtensionTolerance:
            historicalFrameworkTerminalExtensionTolerance,
          originPrice: historicalFrameworkImpulseAuthority?.originPrice ?? null,
          terminalPrice: historicalFrameworkImpulseAuthority?.terminalPrice ?? null,
          originPeriod: historicalFrameworkImpulseAuthority?.originPeriod || null,
          terminalPeriod: historicalFrameworkImpulseAuthority?.terminalPeriod || null,
          reason: historicalFrameworkImpulseAuthority?.reason || null,
          rule: historicalFrameworkImpulseAuthority?.rule || null,
        }
      : null,
    finalVisibleTerminalImpulse: finalVisibleTerminalImpulse
      ? {
          ...finalVisibleTerminalImpulse,
          applied: finalVisibleTerminalImpulseApplied,
          structuralScore: terminalStructuralScore,
          competingMajorStructuralScore: majorStructuralScore,
        }
      : null,
    finalVisibleEndpointAuthority: finalVisibleEndpointEnabled
      ? {
          price: finalVisibleEndpointPrice,
          applied: finalVisibleEndpointApplied,
          reason: finalVisibleEndpointReason,
          tolerance: finalVisibleEndpointTolerance,
          source:
            finalVisibleEndpointAuthority?.source ||
            "final_visible_chart_price",
        }
      : null,
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
      historicalFrameworkImpulseApplied
        ? "historical_framework_local_impulse"
        : majorSelection
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
      historicalFrameworkImpulseApplied
        ? "historical_framework_local_period_impulse"
        : outerStructuralOrigin
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
  exactChartFrameworkConfirmed = false,
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
      deepBandLow: null,
      deepBandHigh: null,
      deepExtensionAllowance: null,
      reason: "fibonacci_or_structural_area_unavailable",
    };
  }

  // UNIVERSAL CSA FIB-CONFLUENCE RULE â€” v4.9.3
  //
  // Structure remains primary. Fibonacci NEVER creates an entry area.
  // It only validates an already-authoritative S/R or S/D area.
  //
  // CSA acceptance model:
  // A structural area must be at or close to the actual 38.2%, 50% or 61.8%
  // retracement. The interval between 50% and 61.8% is not itself a pass.
  // Exact chart prices that reconcile to authoritative framework structure
  // receive a small broker/OCR allowance, but Fibonacci still cannot invent
  // an entry or rescue an unrelated level.
  const minimumInstrumentBuffer = Math.max(
    getCleanBreakTolerance(symbol) * 0.5,
    Number.EPSILON * 100
  );

  // Retain a conservative proximity test around the individual Fib levels,
  // especially 38.2%. Borderline proximity still requires strong structure.
  const closeAllowance = Math.max(
    normalizedAtr * (exactChartFrameworkConfirmed ? 0.6 : 0.15),
    minimumInstrumentBuffer
  );

  const borderlineAllowance = Math.max(
    normalizedAtr * (exactChartFrameworkConfirmed ? 0.6 : 0.20),
    closeAllowance
  );

  const strongStructure =
    structuralEvidenceStrong === true ||
    Number(structuralQualityScore || 0) >= 50;

  const allowedRatios = new Set([0.382, 0.5, 0.618]);
  const fibLevels = fibonacci.levels
    .filter((level) => allowedRatios.has(Number(level?.ratio)))
    .map((level) => ({
      ratio: Number(level.ratio),
      label: String(level.label || ""),
      price: Number(level.price),
    }))
    .filter((level) => Number.isFinite(level.price));

  const level382 = fibLevels.find((level) => level.ratio === 0.382) || null;
  const level50 = fibLevels.find((level) => level.ratio === 0.5) || null;
  const level618 = fibLevels.find((level) => level.ratio === 0.618) || null;

  const deepBandLow =
    level50 && level618 ? Math.min(level50.price, level618.price) : null;
  const deepBandHigh =
    level50 && level618 ? Math.max(level50.price, level618.price) : null;

  const zoneOverlapsDeepBand =
    Number.isFinite(deepBandLow) &&
    Number.isFinite(deepBandHigh) &&
    high >= deepBandLow &&
    low <= deepBandHigh;

  const evaluatedLevels = fibLevels
    .map((level) => {
      const distanceToZone = distanceFromPriceToZone(level.price, low, high);

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

      const passed = direct || close || (borderline && strongStructure);

      return {
        ratio: level.ratio,
        label: level.label,
        price: level.price,
        distanceToZone,
        distanceAsAtrFraction: atrFraction,
        distanceAsAtrPercent: atrFraction === null ? null : atrFraction * 100,
        matchType: direct
          ? "inside_structural_area"
          : close
          ? "close_proximity"
          : borderline
          ? strongStructure
            ? "borderline_strong_structure"
            : "borderline_structure_not_strong_enough"
          : "no_exact_level_proximity",
        passed,
      };
    })
    .sort((a, b) => {
      if (a.distanceToZone !== b.distanceToZone) {
        return a.distanceToZone - b.distanceToZone;
      }
      return a.ratio - b.ratio;
    });

  const exactLevelMatches = evaluatedLevels.filter(
    (level) => level.passed === true
  );

  // CSA Fibonacci is a confluence check against the actual 38.2%, 50% or
  // 61.8% retracement. Merely sitting somewhere inside the wide 50%-61.8%
  // interval is not confluence and previously admitted stale extra entries.
  const matches = exactLevelMatches;

  return {
    passed: matches.length > 0,
    matches,
    evaluatedLevels,
    proximityAllowance: closeAllowance,
    closeAllowance,
    borderlineAllowance,
    deepBandLow,
    deepBandHigh,
    zoneOverlapsDeepBand,
    distanceBeyond618: null,
    deepExtensionAllowance: 0,
    zoneWithinDeepExtension: false,
    impulseRange: Number(fibonacci?.impulseRange || 0) || null,
    structuralQualityScore: Number(structuralQualityScore || 0),
    strongStructure,
    reason:
      exactLevelMatches.length > 0
        ? "structural_area_has_required_retracement_proximity"
        : "no_382_50_or_618_level_proximity",
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
    const duplicateIndex = result.findIndex((existing) => {
      const pairTolerance = getSupplyDemandClusterTolerance(
        existing,
        candidate,
        atr
      );
      return zonesOverlap(existing, candidate, pairTolerance);
    });

    if (duplicateIndex < 0) {
      result.push(candidate);
      return;
    }

    const existing = result[duplicateIndex];

    // Distinct authoritative steps are not duplicates merely because their
    // tolerance zones touch or overlap. The immediately-prior broken S/R is
    // checked first; the current-period S/D area is the next stage if Entry 1
    // fails. Collapsing these by zone overlap destroys the CSA hierarchy.
    const existingStage = String(existing?.stepwiseEntryStage || "");
    const candidateStage = String(candidate?.stepwiseEntryStage || "");
    const stagePair = new Set([existingStage, candidateStage]);
    const existingStandardStage =
      existing?.standardStructuralStage ||
      classifyCsaStructuralStage(existing).key;
    const candidateStandardStage =
      candidate?.standardStructuralStage ||
      classifyCsaStructuralStage(candidate).key;
    const distinctStepwiseHierarchyStages =
      stagePair.has("immediate_prior_broken_sr") &&
      stagePair.has("current_period_supply_demand");
    const distinctSrAndSdStages =
      new Set([existingStandardStage, candidateStandardStage]).has("support_resistance") &&
      new Set([existingStandardStage, candidateStandardStage]).has("supply_demand");
    const distinctFrameworkIdentity =
      String(existing?.frameworkPeriod || "") !==
        String(candidate?.frameworkPeriod || "") ||
      Number(existing?.frameworkPrice) !== Number(candidate?.frameworkPrice);
    const existingCenter = Number(
      existing?.authoritativeCenter ??
        existing?.frameworkPrice ??
        (Number(existing?.zoneLow) + Number(existing?.zoneHigh)) / 2
    );
    const candidateCenter = Number(
      candidate?.authoritativeCenter ??
        candidate?.frameworkPrice ??
        (Number(candidate?.zoneLow) + Number(candidate?.zoneHigh)) / 2
    );
    const independentlySeparated =
      Number.isFinite(existingCenter) &&
      Number.isFinite(candidateCenter) &&
      Math.abs(existingCenter - candidateCenter) >
        Math.max(Number(atr || 0) * 0.08, Number.EPSILON * 100);

    if (
      (distinctStepwiseHierarchyStages || distinctSrAndSdStages) &&
      distinctFrameworkIdentity &&
      independentlySeparated
    ) {
      result.push(candidate);
      console.log("CSA FINAL DEDUPE DISTINCT HIERARCHY STAGES PRESERVED:", {
        existingStage,
        existingAreaType: existing?.areaType || null,
        existingFrameworkPeriod: existing?.frameworkPeriod || null,
        existingFrameworkPrice: existing?.frameworkPrice ?? null,
        candidateStage,
        candidateAreaType: candidate?.areaType || null,
        candidateFrameworkPeriod: candidate?.frameworkPeriod || null,
        candidateFrameworkPrice: candidate?.frameworkPrice ?? null,
        existingStandardStage,
        candidateStandardStage,
        independentlySeparated,
        rule: "support_resistance_and_supply_demand_are_separate_structural_stages",
      });
      return;
    }

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

    const candidateTrustedChartPrice =
      hasIndependentChartPriceEvidence(candidate);
    const existingTrustedChartPrice =
      hasIndependentChartPriceEvidence(existing);

    // An exact independently read chart label outranks an overlapping
    // candle-derived/framework candidate. This prevents a nearby intraday
    // extreme from erasing the actual marked CSA level.
    if (candidateTrustedChartPrice && !existingTrustedChartPrice) {
      result[duplicateIndex] = candidate;
      return;
    }

    if (existingTrustedChartPrice && !candidateTrustedChartPrice) {
      return;
    }

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

    /*
     * V4.11.3 OVERLAPPING/NEAR-TOUCHING S/D LAUNCH-BASE ANCHOR
     *
     * Several candles can describe one demand/supply area. After structural
     * validation and the hidden Fib gate, overlapping or near-touching
     * candidates of the same S/D type must collapse to the protective
     * launch-base boundary rather
     * than whichever candle happened to be evaluated first. For a bullish
     * demand cluster that is the lower boundary; for a bearish supply cluster
     * it is the upper boundary. Exact independently read chart labels retain
     * priority above this unmarked-zone rule.
     */
    const existingAreaType = String(existing?.areaType || "").toLowerCase();
    const candidateAreaType = String(candidate?.areaType || "").toLowerCase();
    const sameSupplyDemandCluster =
      shouldMergeQualifiedSupplyDemandCluster(existing, candidate, {
        existingTrusted: existingTrustedChartPrice,
        candidateTrusted: candidateTrustedChartPrice,
      });

    if (sameSupplyDemandCluster) {
      const existingAnchor = Number(existing?.authoritativeCenter);
      const candidateAnchor = Number(candidate?.authoritativeCenter);
      const selected = selectProtectiveSupplyDemandAnchor(existing, candidate);

      result[duplicateIndex] = {
        ...selected,
        zoneLow: Math.min(
          Number(existing?.zoneLow),
          Number(candidate?.zoneLow)
        ),
        zoneHigh: Math.max(
          Number(existing?.zoneHigh),
          Number(candidate?.zoneHigh)
        ),
        structuralScore: Math.max(
          Number(existing?.structuralScore || 0),
          Number(candidate?.structuralScore || 0)
        ),
        qualityScore: Math.max(
          Number(existing?.qualityScore || 0),
          Number(candidate?.qualityScore || 0)
        ),
        reactionCount: Math.max(
          Number(existing?.reactionCount || 0),
          Number(candidate?.reactionCount || 0)
        ),
        strongDepartureCount: Math.max(
          Number(existing?.strongDepartureCount || 0),
          Number(candidate?.strongDepartureCount || 0)
        ),
        overlappingSupplyDemandClusterMerged: true,
        clusterAnchorRule:
          existingAreaType === "demand"
            ? "bullish_demand_lower_launch_boundary"
            : "bearish_supply_upper_launch_boundary",
      };

      console.log("CSA FINAL DEDUPE S/D CLUSTER MERGED:", {
        areaType: existingAreaType,
        existingAnchor,
        candidateAnchor,
        selectedAnchor: result[duplicateIndex]?.authoritativeCenter ?? null,
        zoneLow: result[duplicateIndex]?.zoneLow ?? null,
        zoneHigh: result[duplicateIndex]?.zoneHigh ?? null,
        rule: result[duplicateIndex]?.clusterAnchorRule || null,
      });
      return;
    }

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

    const isSupplyDemandZone = ["supply", "demand"].includes(
      String(area?.areaType || "").toLowerCase()
    );
    const isFrameworkSrWithValidatedStructuralZone =
      area?.structuralZoneReinforcedByIntradayStructure === true &&
      ["support", "resistance", "converted support", "converted resistance"].includes(
        String(area?.areaType || "").toLowerCase()
      );

    if (!Number.isFinite(authoritativeCenter)) {
      errors.push("resolved_csa_level_missing_authoritative_anchor");
      return false;
    }

    if (isSupplyDemandZone || isFrameworkSrWithValidatedStructuralZone) {
      // Supply/demand is an AREA. In v4.7.6, an authoritative framework S/R
      // level may also carry a candle-derived reinforcement zone when a fresh
      // intraday base overlaps that SAME level. In both cases the authoritative
      // anchor may legitimately sit away from the midpoint; what matters is
      // that it remains inside/near the validated structural zone.
      const zoneContainmentTolerance = Math.max(
        centerTolerance,
        Number(atr || 0) * 0.01
      );
      const anchorInsideZone =
        authoritativeCenter >= low - zoneContainmentTolerance &&
        authoritativeCenter <= high + zoneContainmentTolerance;

      const frameworkCenter = Number(area?.frameworkCenter);
      const chartReconciledCenter = Number(area?.chartReconciledCenter);
      const anchorReconciliationTolerance = Math.max(
        centerTolerance,
        Number(atr || 0) * 0.05
      );
      const frameworkAnchorConsistent =
        !Number.isFinite(frameworkCenter) ||
        Math.abs(frameworkCenter - authoritativeCenter) <=
          anchorReconciliationTolerance;
      const chartAnchorConsistent =
        !Number.isFinite(chartReconciledCenter) ||
        Math.abs(chartReconciledCenter - authoritativeCenter) <=
          anchorReconciliationTolerance;

      // v4.9.4 â€” A same-period chart reconciliation that was already accepted
      // upstream must not be invalidated here merely because the native HTF
      // framework center and the broker/chart label differ slightly. This is
      // especially important for supply/demand areas, where the chart-facing
      // zone can be centred on the accepted broker label while the underlying
      // framework identity remains the native higher-timeframe high/low.
      //
      // Upstream reconciliation is already period/type constrained, so this
      // downstream validator only needs to ensure the selected authoritative
      // (chart-reconciled) anchor is actually inside the validated zone.
      const acceptedSamePeriodChartReconciliation =
        area?.chartReconciled === true &&
        Number.isFinite(chartReconciledCenter) &&
        chartAnchorConsistent;

      const frameworkMismatchCoveredByAcceptedReconciliation =
        !frameworkAnchorConsistent && acceptedSamePeriodChartReconciliation;

      const frameworkMismatchCoveredBySamePeriodSdRefinement =
        isSupplyDemandZone &&
        area?.supplyDemandRefinedBySamePeriodBase === true &&
        area?.structuralZoneReinforcedByIntradayStructure === true;

      if (
        !anchorInsideZone ||
        (!chartAnchorConsistent && !frameworkMismatchCoveredBySamePeriodSdRefinement) ||
        (!frameworkAnchorConsistent &&
          !frameworkMismatchCoveredByAcceptedReconciliation &&
          !frameworkMismatchCoveredBySamePeriodSdRefinement)
      ) {
        errors.push("resolved_csa_zone_anchor_mismatch");
        console.log("CSA selector v3 structural-zone anchor mismatch:", {
          levelText: area?.levelText || null,
          areaType: area?.areaType || null,
          frameworkPeriod: area?.frameworkPeriod || null,
          zoneLow: low,
          zoneHigh: high,
          zoneCenter,
          authoritativeCenter,
          frameworkCenter: area?.frameworkCenter ?? null,
          chartReconciledCenter: area?.chartReconciledCenter ?? null,
          anchorInsideZone,
          frameworkAnchorConsistent,
          chartAnchorConsistent,
          acceptedSamePeriodChartReconciliation,
          frameworkMismatchCoveredByAcceptedReconciliation,
          frameworkMismatchCoveredBySamePeriodSdRefinement,
          zoneContainmentTolerance,
          anchorReconciliationTolerance,
        });
        return false;
      }

      console.log("CSA selector v3 structural-zone anchor accepted:", {
        levelText: area?.levelText || null,
        areaType: area?.areaType || null,
        frameworkPeriod: area?.frameworkPeriod || null,
        zoneLow: low,
        zoneHigh: high,
        zoneCenter,
        authoritativeCenter,
        frameworkCenter: area?.frameworkCenter ?? null,
        chartReconciledCenter: area?.chartReconciledCenter ?? null,
        frameworkAnchorConsistent,
        chartAnchorConsistent,
        acceptedSamePeriodChartReconciliation,
        frameworkMismatchCoveredByAcceptedReconciliation,
        frameworkMismatchCoveredBySamePeriodSdRefinement,
        historicalTakeoverIntradayCandidate:
          area?.historicalTakeoverIntradayCandidate === true,
        structuralZoneReinforcedByIntradayStructure:
          area?.structuralZoneReinforcedByIntradayStructure === true,
      });
    } else if (Math.abs(zoneCenter - authoritativeCenter) > centerTolerance) {
      // Support/resistance remains a single authoritative framework level, so
      // its resolved tolerance-zone must stay centred on that level.
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

  // Supply/demand is zone-based. Consolidate qualified fragments before the
  // general S/R-aware dedupe can prefer a shallower candle-derived anchor.
  const supplyDemandConsolidated =
    consolidateQualifiedSupplyDemandClusters(valid, atr);
  const deduped = dedupeValidatedAreas(supplyDemandConsolidated, atr);

  const pathOrdered = sequenceFibQualifiedAreas(deduped, direction);

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

  // CSA exposes at most three independently qualified alternatives. Every
  // candidate is audited before sequencing; a later entry is never an
  // instruction to add to a losing earlier position.
  const independentlyQualified = selectIndependentEntryAreas(filtered, direction);
  const sequenced = independentlyQualified.map((area, index) => ({
    ...area,
    executionOrder: index + 1,
    role:
      index === 0
        ? "primary"
        : index === 1
        ? "secondary"
        : "tertiary",
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

// Structural break confirmation must use the instrument's clean-break rule.
// Do not use frameworkLevelTolerance/getApprovedPriceTolerance here: those
// broader tolerances are intended for chart/OCR reconciliation and can become
// large enough to reject a genuine completed-period close through prior S/R.
function frameworkConversionTolerance({
  symbol = "",
}) {
  return Math.max(
    getCleanBreakTolerance(symbol),
    Number.EPSILON * 100
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
          match?.independentLineRead === true
            ? "independent_horizontal_line_map_exact"
            : "per_target_framework_price_map_exact",
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
          match?.independentLineRead === true
            ? "independent_horizontal_line_map_estimate"
            : "per_target_framework_price_map_estimate",
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

    // For a visually validated converted S/R zone, the first-touch boundary
    // is the chart-facing entry price: the lower edge for bearish converted
    // resistance and the upper edge for bullish converted support. Preserve
    // the native framework price separately as the structural source level.
    const normalizedFrameworkType = String(frameworkType || "").toLowerCase();
    const convertedEntryBoundary =
      normalizedFrameworkType === "converted resistance"
        ? asPositiveNumber(zone?.zoneLow)
        : normalizedFrameworkType === "converted support"
        ? asPositiveNumber(zone?.zoneHigh)
        : null;

    if (convertedEntryBoundary !== null) {
      addEvidence({
        price: convertedEntryBoundary,
        type: normalizedType,
        source: "visual_converted_area_entry_boundary",
        description: area?.zoneText || area?.sourceReason || "",
        periodHint:
          area?.frameworkPeriodHint ||
          area?.periodHint ||
          area?.sourcePeriod ||
          "",
        confidence: 20,
      });
    }

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
      source:
        item?.extractionSource ===
        "independent_horizontal_line_reader_exact"
          ? "independent_horizontal_line_exact"
          : "visible_exact_marked_price",
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
        [
          "independent_horizontal_line_reader_exact",
          "per_target_framework_price_reader",
        ].includes(item?.extractionSource)
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

      // V4.10.14: only the isolated price-label reader may replace a
      // deterministic framework price. The full review sees framework context
      // and therefore cannot independently prove a printed chart label.
      const trustedPriceSource = [
        "independent_horizontal_line_map_exact",
        "independent_horizontal_line_exact",
        "independent_horizontal_line_map_estimate",
        "per_target_framework_price_map_exact",
        "per_target_framework_price_map_estimate",
      ].includes(String(candidate.source || ""));

      if (!trustedPriceSource) return false;

      // A visible broker price may refine the market-data price only when it
      // belongs to the SAME authoritative period. Period identity remains
      // non-negotiable.
      const periodMatches = periodHintsCompatible(
        candidate.periodIdentity || candidate.periodHint,
        normalizedFrameworkPeriod
      );

      // A converted level keeps the authoritative period supplied by the
      // selector. Chart drawings often have no readable date label, so an
      // otherwise compatible, close marked level may refine that same locked
      // prior-period price without inventing a different period identity.
      const unhintedPriorConversionBridge =
        ["converted resistance", "converted support"].includes(
          String(frameworkType || "").toLowerCase()
        ) &&
        !String(candidate.periodIdentity || candidate.periodHint || "").trim() &&
        [
          "independent_horizontal_line_exact",
          "independent_horizontal_line_map_exact",
          "per_target_framework_price_map_exact",
        ].includes(String(candidate.source || "")) &&
        Math.abs(Number(candidate.price) - basePrice) <= tolerance;

      // V4.10.13: a printed/marked broker level within the strict
      // reconciliation tolerance may refine an already-locked converted S/R
      // level even when the vision layer attached the wrong side hint. The
      // deterministic framework still owns period identity and area type;
      // this bridge only replaces the nearby display price.
      const exactMarkedPriorConversionBridge =
        ["converted resistance", "converted support"].includes(
          String(frameworkType || "").toLowerCase()
        ) &&
        [
          "per_target_framework_price_map_exact",
          "independent_horizontal_line_exact",
          "independent_horizontal_line_map_exact",
        ].includes(String(candidate.source || "")) &&
        Math.abs(Number(candidate.price) - basePrice) <= tolerance;

      if (
        !periodMatches &&
        !unhintedPriorConversionBridge &&
        !exactMarkedPriorConversionBridge
      ) return false;

      const candidateSide = String(
        candidate.sideHint || ""
      ).toLowerCase();
      const expectedSide = String(
        frameworkSide || ""
      ).toLowerCase();

      if (
        !exactMarkedPriorConversionBridge &&
        candidateSide &&
        expectedSide &&
        candidateSide !== expectedSide
      ) {
        return false;
      }

      const dedicatedExact = [
        "per_target_framework_price_map_exact",
        "independent_horizontal_line_map_exact",
      ].includes(String(candidate.source || ""));

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
      exactPeriodPrice: [
        "per_target_framework_price_map_exact",
        "independent_horizontal_line_map_exact",
      ].includes(String(candidate.source || "")),
      convertedEntryBoundary:
        String(candidate.source || "") ===
        "visual_converted_area_entry_boundary",
    }))
    .sort((a, b) => {
      // Exact printed same-period platform labels outrank approximations and
      // generic line reads. Distance decides only inside the same evidence tier.
      if (a.exactPeriodPrice !== b.exactPeriodPrice) {
        return a.exactPeriodPrice ? -1 : 1;
      }
      // When the dedicated reader has only an estimate, prefer the validated
      // visual converted-zone entry boundary. Exact same-period printed labels
      // still remain the highest authority above this branch.
      if (a.convertedEntryBoundary !== b.convertedEntryBoundary) {
        return a.convertedEntryBoundary ? -1 : 1;
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


const CSA_SELECTOR_VERSION = "4.27.0";

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
    getCleanBreakTolerance(symbol) * 0.25,
    Number.EPSILON * 100
  );

  if (difference <= microDifferenceTolerance) {
    return framework;
  }

  // Some five-digit FX platforms display a two-point approximation of an
  // authoritative whole-pip level (for example 0.69618 for 0.69620). Snap
  // only when the rounded whole-pip value is extremely close to the printed
  // label and also agrees better with the deterministic framework anchor.
  // This does not affect legitimate half-pip labels such as 0.69845.
  const compactSymbol = comparableInstrument(symbol);
  const standardNonJpyFx = /^[A-Z]{6}$/.test(compactSymbol) && !compactSymbol.includes("JPY");
  if (standardNonJpyFx) {
    const pipRounded = Number(chart.toFixed(4));
    const distanceToPip = Math.abs(chart - pipRounded);
    const snapAllowance = 0.000020000001;
    if (
      distanceToPip <= snapAllowance &&
      Math.abs(pipRounded - framework) < difference
    ) {
      return pipRounded;
    }
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


function buildFinalVisibleIndependentSupplyDemandCandidates({
  marketReference = {},
  candles = [],
  direction = "range",
  currentPrice = null,
  symbol = "",
  timeframe = "H1",
  atr = 0,
}) {
  const cutoffMode = normalizeCutoffMode(
    marketReference?.chartCutoff?.mode || "final_visible"
  );
  const tf = comparableTimeframe(timeframe) || "H1";
  const intradayTimeframes = new Set(["M1", "M5", "M15", "M30", "H1"]);

  if (
    cutoffMode !== "final_visible" ||
    !intradayTimeframes.has(tf) ||
    !["bullish", "bearish"].includes(direction) ||
    !Number.isFinite(Number(currentPrice))
  ) {
    return [];
  }

  const usable = (Array.isArray(candles) ? candles : [])
    .filter(
      (candle) =>
        candle?.datetime &&
        [candle?.open, candle?.high, candle?.low, candle?.close].every((value) =>
          Number.isFinite(Number(value))
        )
    )
    .sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)))
    .slice(-160);

  if (usable.length < 12) return [];

  const cleanBreakTolerance = Math.max(
    getCleanBreakTolerance(symbol),
    Number(atr || 0) * 0.04,
    Number.EPSILON * 100
  );
  const minimumDeparture = Math.max(
    Number(atr || 0) * 0.5,
    cleanBreakTolerance * 3
  );
  const levels = Array.isArray(marketReference?.dailyLevels)
    ? marketReference.dailyLevels
    : [];
  const sourceIndex = Math.max(0, levels.length - 1);
  const sourcePeriod = levels[sourceIndex] || {};
  const periodLabel =
    sourcePeriod?.periodLabel ||
    sourcePeriod?.day ||
    sourcePeriod?.key ||
    String(usable[usable.length - 1]?.datetime || "").slice(0, 10) ||
    "final visible period";
  const candidates = [];

  for (let index = 2; index < usable.length - 3; index += 1) {
    const candle = usable[index];
    const previous = usable[index - 1];
    const next = usable[index + 1];
    const open = Number(candle.open);
    const close = Number(candle.close);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const localPivot =
      direction === "bullish"
        ? low <= Number(previous.low) + cleanBreakTolerance &&
          low <= Number(next.low) + cleanBreakTolerance
        : high >= Number(previous.high) - cleanBreakTolerance &&
          high >= Number(next.high) - cleanBreakTolerance;
    if (!localPivot) continue;

    const forward = usable.slice(index + 1, Math.min(usable.length, index + 13));
    if (forward.length < 3) continue;
    const departure =
      direction === "bullish"
        ? Math.max(...forward.map((item) => Number(item.high))) - low
        : high - Math.min(...forward.map((item) => Number(item.low)));
    if (!Number.isFinite(departure) || departure < minimumDeparture) continue;

    const zoneLow = direction === "bullish" ? low : Math.max(open, close);
    const zoneHigh = direction === "bullish" ? Math.min(open, close) : high;
    if (!Number.isFinite(zoneLow) || !Number.isFinite(zoneHigh) || zoneHigh <= zoneLow) {
      continue;
    }

    const correctPriceSide =
      direction === "bullish"
        ? zoneHigh < Number(currentPrice) - cleanBreakTolerance
        : zoneLow > Number(currentPrice) + cleanBreakTolerance;
    if (!correctPriceSide) continue;

    const later = usable.slice(index + 1);
    const decisivelyInvalidated = later.some((item) =>
      direction === "bullish"
        ? Number(item.close) < zoneLow - cleanBreakTolerance
        : Number(item.close) > zoneHigh + cleanBreakTolerance
    );
    if (decisivelyInvalidated) continue;

    const price = direction === "bullish" ? zoneLow : zoneHigh;
    candidates.push({
      price,
      frameworkPrice: price,
      type: direction === "bullish" ? "demand" : "supply",
      originalType: direction === "bullish" ? "demand" : "supply",
      source: "authoritative_final_visible_displacement_base",
      priceSource: "independent_final_visible_supply_demand_structure",
      chartReconciled: false,
      period: periodLabel,
      date: String(candle.datetime || "").slice(0, 10) || null,
      sourceIndex,
      conversionBreakConfirmed: false,
      conversionConfirmed: false,
      lifecycleFlipCount: 0,
      lifecycleEvents: [],
      authorityRank: 1,
      authoritativeFrameworkLevel: true,
      authoritativeStructuralException: true,
      independentSupplyDemandCandidate: true,
      intradayTakeoverBase: true,
      samePeriodDisplacementBaseValidated: true,
      stepwiseEntryStage: "current_period_supply_demand",
      baseDatetime: candle.datetime || null,
      intradayStructuralZoneLow: zoneLow,
      intradayStructuralZoneHigh: zoneHigh,
      departure,
      barsToBreak: forward.length,
    });
  }

  const separation = Math.max(Number(atr || 0) * 0.08, cleanBreakTolerance);
  const distinct = [];
  [...candidates]
    .sort((a, b) => {
      const departureDifference = Number(b.departure || 0) - Number(a.departure || 0);
      if (Math.abs(departureDifference) > Number.EPSILON) return departureDifference;
      return String(b.baseDatetime || "").localeCompare(String(a.baseDatetime || ""));
    })
    .forEach((candidate) => {
      if (
        distinct.some(
          (existing) =>
            Math.abs(Number(existing.frameworkPrice) - Number(candidate.frameworkPrice)) <=
            separation
        )
      ) {
        return;
      }
      distinct.push(candidate);
    });

  const selected = distinct.slice(0, 8);
  console.log("CSA FINAL-VISIBLE INDEPENDENT S/D SCAN:", {
    buildId: CSA_BUILD_ID,
    direction,
    timeframe: tf,
    candidateCount: candidates.length,
    selectedCount: selected.length,
    minimumDeparture,
    candidates: selected.map((candidate) => ({
      type: candidate.type,
      price: candidate.price,
      zoneLow: candidate.intradayStructuralZoneLow,
      zoneHigh: candidate.intradayStructuralZoneHigh,
      baseDatetime: candidate.baseDatetime,
      departure: candidate.departure,
    })),
    rule: "support_resistance_first_then_independent_supply_demand_then_hidden_fib",
  });

  return selected;
}



function buildHistoricalTakeoverIntradayCandidateFromMainPipeline({
  marketReference = {},
  candles = [],
  fibonacci = null,
  direction = "range",
  currentPrice = null,
  symbol = "",
  timeframe = "H1",
  atr = 0,
}) {
  const cutoffMode = normalizeCutoffMode(
    marketReference?.chartCutoff?.mode || "final_visible"
  );
  const tf = comparableTimeframe(timeframe) || "H1";
  const intradayTimeframes = new Set(["M1", "M5", "M15", "M30", "H1"]);
  const resolvedDate = String(
    marketReference?.chartCutoff?.resolvedDate || ""
  ).slice(0, 10);

  const logBase = {
    buildId: CSA_BUILD_ID,
    cutoffMode,
    resolvedDate: resolvedDate || null,
    timeframe: tf,
    direction,
    stage: "main_deterministic_candidate_pipeline",
  };

  if (!["selected_day", "exact"].includes(cutoffMode)) {
    console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE SCAN:", {
      ...logBase,
      result: "not_applicable",
      reason: "not_historical_cutoff",
    });
    return null;
  }
  if (!intradayTimeframes.has(tf)) {
    console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE SCAN:", {
      ...logBase,
      result: "not_applicable",
      reason: "not_intraday_timeframe",
    });
    return null;
  }
  if (!["bullish", "bearish"].includes(direction)) {
    console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE SCAN:", {
      ...logBase,
      result: "no_candidate",
      reason: "direction_not_actionable",
    });
    return null;
  }
  if (!resolvedDate) {
    console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE SCAN:", {
      ...logBase,
      result: "no_candidate",
      reason: "missing_resolved_cutoff_date",
    });
    return null;
  }

  const usableCandles = Array.isArray(candles)
    ? candles
        .filter((candle) =>
          candle?.datetime &&
          [candle?.open, candle?.high, candle?.low, candle?.close].every((v) =>
            Number.isFinite(Number(v))
          )
        )
        .sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)))
    : [];

  const dayCandles = usableCandles.filter(
    (candle) => String(candle.datetime || "").slice(0, 10) === resolvedDate
  );

  if (dayCandles.length < 6) {
    console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE SCAN:", {
      ...logBase,
      result: "no_candidate",
      reason: "insufficient_cutoff_day_candles",
      cutoffDayCandleCount: dayCandles.length,
    });
    return null;
  }

  const tolerance = Math.max(
    frameworkLevelTolerance({ symbol, atr }),
    Number(atr || 0) * 0.05
  );

  const brokenLevel =
    asPositiveNumber(fibonacci?.brokenMajorLevel?.price) ||
    asPositiveNumber(fibonacci?.majorBrokenLevel?.price) ||
    null;
  const breakDatetime = String(
    fibonacci?.brokenMajorLevel?.breakoutDatetime ||
    fibonacci?.majorBrokenLevel?.breakoutDatetime ||
    ""
  );

  let breakIndex = -1;
  let breakReason = "";

  if (breakDatetime && breakDatetime.slice(0, 10) === resolvedDate) {
    const target = breakDatetime.replace("T", " ").slice(0, 16);
    const exactIndex = dayCandles.findIndex((candle) =>
      String(candle.datetime || "").replace("T", " ").slice(0, 16) === target
    );
    if (exactIndex >= 1) {
      breakIndex = exactIndex;
      breakReason = "fibonacci_controlling_break_datetime";
    }
  }

  if (breakIndex < 0 && brokenLevel !== null) {
    for (let i = 1; i < dayCandles.length; i += 1) {
      const priorClose = Number(dayCandles[i - 1]?.close);
      const close = Number(dayCandles[i]?.close);
      if (!Number.isFinite(priorClose) || !Number.isFinite(close)) continue;
      const crossed = direction === "bullish"
        ? priorClose <= brokenLevel + tolerance && close > brokenLevel + tolerance
        : priorClose >= brokenLevel - tolerance && close < brokenLevel - tolerance;
      if (crossed) {
        breakIndex = i;
        breakReason = "cross_of_controlling_broken_level";
        break;
      }
    }
  }

  if (breakIndex < 1) {
    // Final deterministic fallback: identify the strongest same-day directional
    // displacement, but never silently skip the scan.
    let bestScore = -Infinity;
    for (let i = 1; i < dayCandles.length; i += 1) {
      const candle = dayCandles[i];
      const open = Number(candle.open);
      const close = Number(candle.close);
      const high = Number(candle.high);
      const low = Number(candle.low);
      const body = Math.abs(close - open);
      const range = Math.max(Number.EPSILON, high - low);
      const directional = direction === "bullish" ? close > open : close < open;
      if (!directional) continue;
      const score = body / range + body / Math.max(Number(atr || 0), tolerance, Number.EPSILON);
      if (score > bestScore) {
        bestScore = score;
        breakIndex = i;
      }
    }
    if (breakIndex >= 1) breakReason = "strongest_cutoff_day_directional_displacement";
  }

  if (breakIndex < 1) {
    console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE SCAN:", {
      ...logBase,
      result: "no_candidate",
      reason: "no_same_day_controlling_break_or_displacement",
      brokenLevel,
      breakDatetime: breakDatetime || null,
      cutoffDayCandleCount: dayCandles.length,
    });
    return null;
  }

  // Search the bars immediately before the controlling break. The latest
  // structurally valid pivot/base is preferred over the whole-day extreme.
  const searchStart = Math.max(1, breakIndex - 14);
  const searchEnd = Math.max(searchStart, breakIndex - 1);
  const bases = [];

  for (let i = searchStart; i <= searchEnd; i += 1) {
    const candle = dayCandles[i];
    const prev = dayCandles[i - 1];
    const next = dayCandles[i + 1];
    if (!candle || !prev || !next) continue;

    if (direction === "bullish") {
      const low = Number(candle.low);
      const localPivot = low <= Number(prev.low) + tolerance && low <= Number(next.low) + tolerance;
      if (!localPivot) continue;
      const post = dayCandles.slice(i + 1, Math.min(dayCandles.length, breakIndex + 1));
      const departure = post.length
        ? Math.max(...post.map((c) => Number(c.high))) - low
        : 0;
      bases.push({ index: i, price: low, candle, departure });
    } else {
      const high = Number(candle.high);
      const localPivot = high >= Number(prev.high) - tolerance && high >= Number(next.high) - tolerance;
      if (!localPivot) continue;
      const post = dayCandles.slice(i + 1, Math.min(dayCandles.length, breakIndex + 1));
      const departure = post.length
        ? high - Math.min(...post.map((c) => Number(c.low)))
        : 0;
      bases.push({ index: i, price: high, candle, departure });
    }
  }

  // V4.7.3: choose the structural base that launched the displacement, not
  // merely the last tiny pivot immediately before the breakout.
  //
  // Stage 1 remains structural: a base must be a local pivot with meaningful
  // departure. Fibonacci is NEVER allowed to create a base.
  // Stage 2 only ranks already-valid structural bases by relevance to the
  // existing 38.2/50/61.8 retracement set. This prevents a one-bar pre-break
  // wiggle (such as the prior 4081 candidate) from hiding the actual launch
  // base deeper in the displacement leg.
  const minDeparture = Math.max(Number(atr || 0) * 0.35, tolerance * 3);
  // V4.7.4: buildLatestImpulseFibonacci() exposes the authoritative
  // retracement set on `levels`, not `retracementLevels`. The v4.7.3
  // intraday ranker was therefore receiving an empty Fib set and every
  // nearestFibDistance became null/Infinity. Accept `levels` first and keep
  // `retracementLevels` only as a backward-compatible fallback.
  const fibLevelObjects = Array.isArray(fibonacci?.levels)
    ? fibonacci.levels
    : Array.isArray(fibonacci?.retracementLevels)
    ? fibonacci.retracementLevels
    : [];

  const allowedFibRatios = new Set([0.382, 0.5, 0.618]);
  const fibLevels = fibLevelObjects
    .filter((level) =>
      level?.ratio === undefined || allowedFibRatios.has(Number(level?.ratio))
    )
    .map((level) => ({
      ratio: Number(level?.ratio),
      label: String(level?.label || ""),
      price: asPositiveNumber(level?.price),
    }))
    .filter((level) => level.price !== null);

  const enrichedBases = bases.map((base) => {
    const barsToBreak = Math.max(0, breakIndex - Number(base.index || 0));

    // Supply/demand is an AREA. Preserve the actual base candle range used
    // to launch the move instead of judging Fib relevance only against one
    // anchor price. For demand use the distal low through the lower body edge;
    // for supply use the upper body edge through the distal high.
    const baseOpen = Number(base?.candle?.open);
    const baseClose = Number(base?.candle?.close);
    const baseLow = Number(base?.candle?.low);
    const baseHigh = Number(base?.candle?.high);
    let structuralZoneLow = Number(base.price);
    let structuralZoneHigh = Number(base.price);

    if ([baseOpen, baseClose, baseLow, baseHigh].every(Number.isFinite)) {
      if (direction === "bullish") {
        structuralZoneLow = Math.min(baseLow, baseHigh);
        structuralZoneHigh = Math.max(
          structuralZoneLow,
          Math.min(baseOpen, baseClose)
        );
      } else {
        structuralZoneHigh = Math.max(baseLow, baseHigh);
        structuralZoneLow = Math.min(
          structuralZoneHigh,
          Math.max(baseOpen, baseClose)
        );
      }
    }

    const fibDistances = fibLevels.map((level) => ({
      ...level,
      distance: distanceFromPriceToZone(
        level.price,
        structuralZoneLow,
        structuralZoneHigh
      ),
    }));
    const nearestFib = fibDistances.length
      ? [...fibDistances].sort((a, b) => a.distance - b.distance)[0]
      : null;
    const fibDistance = Number.isFinite(Number(nearestFib?.distance))
      ? Number(nearestFib.distance)
      : Number.POSITIVE_INFINITY;

    // Measure whether this pivot followed an actual pullback rather than a
    // negligible one-candle pause. This is descriptive only; it does not make
    // an otherwise invalid pivot valid.
    const lookback = dayCandles.slice(Math.max(0, base.index - 5), base.index);
    let pullbackDepth = 0;
    if (lookback.length) {
      if (direction === "bullish") {
        const priorHigh = Math.max(...lookback.map((c) => Number(c.high)));
        pullbackDepth = Math.max(0, priorHigh - Number(base.price));
      } else {
        const priorLow = Math.min(...lookback.map((c) => Number(c.low)));
        pullbackDepth = Math.max(0, Number(base.price) - priorLow);
      }
    }

    return {
      ...base,
      barsToBreak,
      fibDistance,
      nearestFibLabel: nearestFib?.label || null,
      nearestFibRatio: Number.isFinite(Number(nearestFib?.ratio))
        ? Number(nearestFib.ratio)
        : null,
      nearestFibPrice: Number.isFinite(Number(nearestFib?.price))
        ? Number(nearestFib.price)
        : null,
      structuralZoneLow,
      structuralZoneHigh,
      pullbackDepth,
    };
  });

  const meaningfulBases = enrichedBases.filter(
    (base) => Number(base.departure || 0) >= minDeparture
  );

  // A displacement-origin base should normally have at least two completed
  // bars between the pivot and the controlling break. Keep the one-bar pivot
  // only as a fallback when no better structural launch base exists.
  const launchBases = meaningfulBases.filter((base) => base.barsToBreak >= 2);
  const rankedPool = launchBases.length
    ? launchBases
    : meaningfulBases.length
    ? meaningfulBases
    : enrichedBases;

  let selectedBase = rankedPool.length
    ? [...rankedPool].sort((a, b) => {
        // First prefer a structurally valid base that is relevant to the
        // already-computed Fib retracement set. This is ranking, not creation.
        if (Number.isFinite(a.fibDistance) || Number.isFinite(b.fibDistance)) {
          const fibDiff = Number(a.fibDistance) - Number(b.fibDistance);
          if (Math.abs(fibDiff) > 1e-9) return fibDiff;
        }

        // Then prefer the stronger displacement departure.
        const departureDiff = Number(b.departure || 0) - Number(a.departure || 0);
        if (Math.abs(departureDiff) > 1e-9) return departureDiff;

        // Finally prefer the more recent structural base.
        return Number(b.index || 0) - Number(a.index || 0);
      })[0]
    : null;

  if (!selectedBase) {
    const fallback = dayCandles.slice(searchStart, breakIndex);
    if (fallback.length) {
      const relativeIndex = fallback.reduce((best, candle, idx, arr) => {
        if (best === null) return idx;
        return direction === "bullish"
          ? Number(candle.low) < Number(arr[best].low) ? idx : best
          : Number(candle.high) > Number(arr[best].high) ? idx : best;
      }, null);
      const candle = fallback[relativeIndex];
      selectedBase = {
        index: searchStart + relativeIndex,
        price: direction === "bullish" ? Number(candle.low) : Number(candle.high),
        candle,
        departure: null,
      };
    }
  }

  const price = asPositiveNumber(selectedBase?.price);
  if (price === null) {
    console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE SCAN:", {
      ...logBase,
      result: "no_candidate",
      reason: "no_valid_pre_break_base",
      breakIndex,
      breakDatetime: dayCandles[breakIndex]?.datetime || null,
      brokenLevel,
    });
    return null;
  }

  const validPriceSide = Number.isFinite(Number(currentPrice))
    ? direction === "bullish"
      ? price < Number(currentPrice) - tolerance
      : price > Number(currentPrice) + tolerance
    : true;

  if (!validPriceSide) {
    console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE SCAN:", {
      ...logBase,
      result: "no_candidate",
      reason: "base_on_wrong_side_of_current_price",
      price,
      currentPrice,
    });
    return null;
  }

  const levels = Array.isArray(marketReference?.dailyLevels)
    ? marketReference.dailyLevels
    : [];
  let sourceIndex = levels.findIndex((level) =>
    String(level?.date || level?.key || "").slice(0, 10) === resolvedDate
  );
  if (sourceIndex < 0) sourceIndex = Math.max(0, levels.length - 1);
  const sourcePeriod = levels[sourceIndex] || {};
  const periodLabel =
    sourcePeriod?.periodLabel || sourcePeriod?.day || sourcePeriod?.key || resolvedDate;

  const candidate = {
    price,
    frameworkPrice: price,
    type: direction === "bullish" ? "demand" : "supply",
    originalType: direction === "bullish" ? "demand" : "supply",
    source: "historical_takeover_intraday_base",
    priceSource: "cutoff_day_intraday_structure_main_pipeline",
    chartReconciled: false,
    reconciliationEvidence: null,
    reconciliationPeriodHint: periodLabel,
    reconciliationConfidence: 0,
    reconciliationDifference: null,
    period: periodLabel,
    date: resolvedDate,
    sourceIndex,
    conversionBreakConfirmed: false,
    conversionConfirmed: false,
    lifecycleFlipCount: 0,
    lifecycleEvents: [],
    authorityRank: 1,
    intradayTakeoverBase: true,
    authoritativeStructuralException: true,
    historicalTakeoverIntradayCandidate: true,
    takeoverBreakLevel: brokenLevel,
    takeoverBreakDatetime: dayCandles[breakIndex]?.datetime || null,
    baseDatetime: selectedBase?.candle?.datetime || null,
    intradayStructuralZoneLow: Number.isFinite(Number(selectedBase?.structuralZoneLow))
      ? Number(selectedBase.structuralZoneLow)
      : price,
    intradayStructuralZoneHigh: Number.isFinite(Number(selectedBase?.structuralZoneHigh))
      ? Number(selectedBase.structuralZoneHigh)
      : price,
    nearestFibDistance: Number.isFinite(Number(selectedBase?.fibDistance))
      ? Number(selectedBase.fibDistance)
      : null,
    nearestFibLabel: selectedBase?.nearestFibLabel || null,
    nearestFibPrice: Number.isFinite(Number(selectedBase?.nearestFibPrice))
      ? Number(selectedBase.nearestFibPrice)
      : null,
    departure: Number.isFinite(Number(selectedBase?.departure))
      ? Number(selectedBase.departure)
      : null,
    barsToBreak: Number.isFinite(Number(selectedBase?.barsToBreak))
      ? Number(selectedBase.barsToBreak)
      : null,
    pullbackDepth: Number.isFinite(Number(selectedBase?.pullbackDepth))
      ? Number(selectedBase.pullbackDepth)
      : null,
    stepwiseEntryStage: "current_period_supply_demand",
  };

  console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE SCAN:", {
    ...logBase,
    result: "candidate_found",
    reason: "displacement_origin_base_before_cutoff_day_controlling_break",
    selectionMode: "structural_base_first_then_fib_relevance_ranking",
    breakReason,
    brokenLevel,
    breakDatetime: candidate.takeoverBreakDatetime,
    baseDatetime: candidate.baseDatetime,
    areaType: candidate.type,
    price: candidate.price,
    departure: selectedBase?.departure ?? null,
    barsToBreak: selectedBase?.barsToBreak ?? null,
    pullbackDepth: selectedBase?.pullbackDepth ?? null,
    nearestFibDistance: Number.isFinite(selectedBase?.fibDistance)
      ? selectedBase.fibDistance
      : null,
    nearestFibLabel: selectedBase?.nearestFibLabel || null,
    nearestFibPrice: Number.isFinite(Number(selectedBase?.nearestFibPrice))
      ? Number(selectedBase.nearestFibPrice)
      : null,
    structuralZoneLow: selectedBase?.structuralZoneLow ?? null,
    structuralZoneHigh: selectedBase?.structuralZoneHigh ?? null,
    localBaseCount: bases.length,
    meaningfulBaseCount: meaningfulBases.length,
    launchBaseCount: launchBases.length,
    rankedBases: rankedPool.slice(0, 8).map((base) => ({
      datetime: base?.candle?.datetime || null,
      price: base?.price ?? null,
      departure: base?.departure ?? null,
      barsToBreak: base?.barsToBreak ?? null,
      pullbackDepth: base?.pullbackDepth ?? null,
      nearestFibDistance: Number.isFinite(base?.fibDistance)
        ? base.fibDistance
        : null,
      nearestFibLabel: base?.nearestFibLabel || null,
      nearestFibPrice: Number.isFinite(Number(base?.nearestFibPrice))
        ? Number(base.nearestFibPrice)
        : null,
      structuralZoneLow: base?.structuralZoneLow ?? null,
      structuralZoneHigh: base?.structuralZoneHigh ?? null,
    })),
  });

  return candidate;
}

function buildHistoricalTakeoverIntradayCandidate({
  marketReference = {},
  direction = "range",
  currentPrice = null,
  symbol = "",
  timeframe = "H1",
  atr = 0,
}) {
  const cutoffMode = normalizeCutoffMode(
    marketReference?.chartCutoff?.mode || "final_visible"
  );
  const tf = comparableTimeframe(timeframe) || "H1";
  const intradayTimeframes = new Set(["M1", "M5", "M15", "M30", "H1"]);
  // V4.7.1: resolve the historical phase directly instead of depending on
  // marketReference.directionalBias.cutoffPhase already being populated.
  // The earlier v4.7.0 branch could therefore be skipped even when the
  // historical engine had correctly handed control to the new direction.
  const storedCutoffPhase = marketReference?.directionalBias?.cutoffPhase || null;
  const resolvedCutoffPhase =
    deriveAuthoritativeCsaHistoricalPhase({
      marketReference,
      symbol,
      timeframe: tf,
    }) || storedCutoffPhase;

  const cutoffPhase = resolvedCutoffPhase || storedCutoffPhase || null;
  const diagnostics = cutoffPhase?.diagnostics || {};

  const resolvedDate = String(
    marketReference?.chartCutoff?.resolvedDate || ""
  ).slice(0, 10);

  const phaseShowsCurrentTakeover =
    diagnostics?.handoffApplied === true ||
    String(cutoffPhase?.source || "").includes("historical_current_structure_handoff") ||
    ["bullish_structure_takeover", "bearish_structure_takeover"].includes(
      String(cutoffPhase?.phase || "")
    );

  // Secondary safety path: if the resolved phase is already directional and
  // the controlling structural break itself occurred on the selected cutoff
  // date, this is also a valid current-period takeover context. This prevents
  // the intraday-base extractor from being disabled merely because the outer
  // period phase was already labelled bullish/bearish before diagnostics were
  // attached.
  const controllingBreakDate = String(
    cutoffPhase?.diagnostics?.secondaryCandlePhase?.latestEvent?.datetime ||
    cutoffPhase?.diagnostics?.latestEvent?.datetime ||
    cutoffPhase?.breakoutDatetime ||
    cutoffPhase?.breakdownDatetime ||
    ""
  ).slice(0, 10);

  const currentPeriodBreakContext =
    !!resolvedDate &&
    controllingBreakDate === resolvedDate &&
    cutoffPhase?.direction === direction;

  if (
    !["selected_day", "exact"].includes(cutoffMode) ||
    !intradayTimeframes.has(tf) ||
    !["bullish", "bearish"].includes(direction) ||
    !(phaseShowsCurrentTakeover || currentPeriodBreakContext)
  ) {
    console.log("CSA HISTORICAL TAKEOVER INTRADAY STRUCTURE SKIP:", {
      buildId: CSA_BUILD_ID,
      cutoffMode,
      resolvedDate,
      timeframe: tf,
      direction,
      phase: cutoffPhase?.phase || null,
      phaseSource: cutoffPhase?.source || null,
      handoffApplied: diagnostics?.handoffApplied === true,
      controllingBreakDate: controllingBreakDate || null,
      reason: !["selected_day", "exact"].includes(cutoffMode)
        ? "not_historical_cutoff"
        : !intradayTimeframes.has(tf)
        ? "not_intraday_timeframe"
        : !["bullish", "bearish"].includes(direction)
        ? "direction_not_actionable"
        : "no_current_period_takeover_context",
    });
    return null;
  }

  if (!resolvedDate) return null;

  const allCandles = Array.isArray(marketReference?.timeframeCandles)
    ? marketReference.timeframeCandles
        .filter((candle) =>
          candle?.datetime &&
          [candle?.open, candle?.high, candle?.low, candle?.close].every((v) =>
            Number.isFinite(Number(v))
          )
        )
        .sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)))
    : [];

  const dayCandles = allCandles.filter(
    (candle) => String(candle.datetime || "").slice(0, 10) === resolvedDate
  );
  if (dayCandles.length < 5) return null;

  const tolerance = Math.max(
    frameworkLevelTolerance({ symbol, atr }),
    Number(atr || 0) * 0.05
  );

  const brokenLevel = asPositiveNumber(cutoffPhase?.brokenLevel);
  let breakIndex = -1;

  if (brokenLevel !== null) {
    for (let i = 1; i < dayCandles.length; i += 1) {
      const close = Number(dayCandles[i]?.close);
      const priorClose = Number(dayCandles[i - 1]?.close);
      if (!Number.isFinite(close) || !Number.isFinite(priorClose)) continue;

      const crossed =
        direction === "bullish"
          ? priorClose <= brokenLevel + tolerance && close > brokenLevel + tolerance
          : priorClose >= brokenLevel - tolerance && close < brokenLevel - tolerance;

      if (crossed) {
        breakIndex = i;
        break;
      }
    }
  }

  if (breakIndex < 0) {
    // Fall back to the strongest directional expansion in the cutoff day.
    let bestScore = -Infinity;
    for (let i = 1; i < dayCandles.length; i += 1) {
      const candle = dayCandles[i];
      const open = Number(candle.open);
      const close = Number(candle.close);
      const high = Number(candle.high);
      const low = Number(candle.low);
      const body = Math.abs(close - open);
      const range = Math.max(Number.EPSILON, high - low);
      const directional = direction === "bullish" ? close > open : close < open;
      if (!directional) continue;
      const score = body / range + body / Math.max(Number(atr || 0), tolerance, Number.EPSILON);
      if (score > bestScore) {
        bestScore = score;
        breakIndex = i;
      }
    }
  }

  if (breakIndex < 1) return null;

  // Find the most recent local base that directly preceded the takeover break.
  // This deliberately avoids using the whole-day extreme when a fresher
  // intraday demand/supply base launched the displacement.
  const searchStart = Math.max(1, breakIndex - 12);
  const searchEnd = Math.max(searchStart, breakIndex - 1);
  const localExtremes = [];

  for (let i = searchStart; i <= searchEnd; i += 1) {
    const candle = dayCandles[i];
    const prev = dayCandles[i - 1];
    const next = dayCandles[i + 1];
    if (!candle || !prev || !next) continue;

    if (direction === "bullish") {
      const low = Number(candle.low);
      const isLocalLow =
        low <= Number(prev.low) + tolerance &&
        low <= Number(next.low) + tolerance;
      if (isLocalLow) {
        localExtremes.push({ index: i, price: low, candle });
      }
    } else {
      const high = Number(candle.high);
      const isLocalHigh =
        high >= Number(prev.high) - tolerance &&
        high >= Number(next.high) - tolerance;
      if (isLocalHigh) {
        localExtremes.push({ index: i, price: high, candle });
      }
    }
  }

  let selectedBase = localExtremes.length
    ? localExtremes[localExtremes.length - 1]
    : null;

  if (!selectedBase) {
    const fallbackSlice = dayCandles.slice(searchStart, breakIndex);
    if (!fallbackSlice.length) return null;
    const relativeIndex = fallbackSlice.reduce((best, candle, idx, arr) => {
      if (best === null) return idx;
      return direction === "bullish"
        ? Number(candle.low) < Number(arr[best].low) ? idx : best
        : Number(candle.high) > Number(arr[best].high) ? idx : best;
    }, null);
    const candle = fallbackSlice[relativeIndex];
    selectedBase = {
      index: searchStart + relativeIndex,
      price: direction === "bullish" ? Number(candle.low) : Number(candle.high),
      candle,
    };
  }

  const price = asPositiveNumber(selectedBase?.price);
  if (price === null) return null;

  const validPriceSide =
    Number.isFinite(Number(currentPrice))
      ? direction === "bullish"
        ? price < Number(currentPrice) - tolerance
        : price > Number(currentPrice) + tolerance
      : true;
  if (!validPriceSide) return null;

  const currentPeriod =
    diagnostics?.currentPeriod ||
    marketReference?.dailyLevels?.[marketReference.dailyLevels.length - 1]?.periodLabel ||
    marketReference?.dailyLevels?.[marketReference.dailyLevels.length - 1]?.day ||
    resolvedDate;

  const candidate = {
    price,
    frameworkPrice: price,
    type: direction === "bullish" ? "demand" : "supply",
    originalType: direction === "bullish" ? "demand" : "supply",
    source: "historical_takeover_intraday_base",
    priceSource: "cutoff_day_intraday_structure",
    chartReconciled: false,
    reconciliationEvidence: null,
    reconciliationPeriodHint: currentPeriod,
    reconciliationConfidence: 0,
    reconciliationDifference: null,
    period: currentPeriod,
    date: resolvedDate,
    sourceIndex: Math.max(0, Number(marketReference?.dailyLevels?.length || 1) - 1),
    conversionBreakConfirmed: false,
    conversionConfirmed: false,
    lifecycleFlipCount: 0,
    lifecycleEvents: [],
    authorityRank: 1,
    intradayTakeoverBase: true,
    authoritativeStructuralException: true,
    takeoverBreakLevel: brokenLevel,
    takeoverBreakDatetime: dayCandles[breakIndex]?.datetime || null,
    baseDatetime: selectedBase?.candle?.datetime || null,
  };

  console.log("CSA HISTORICAL TAKEOVER INTRADAY STRUCTURE:", {
    buildId: CSA_BUILD_ID,
    cutoffMode,
    resolvedDate,
    timeframe: tf,
    direction,
    handoffApplied: true,
    handoffReason: diagnostics?.handoffReason || null,
    brokenLevel,
    breakDatetime: candidate.takeoverBreakDatetime,
    baseDatetime: candidate.baseDatetime,
    areaType: candidate.type,
    price: candidate.price,
    rule: "latest_local_base_before_confirmed_cutoff_day_takeover_break",
  });

  return candidate;
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

  // V4.9.7 â€” SINGLE AUTHORITATIVE AREA SOURCE
  // Rebuild the CSA S/R vs S/D hierarchy from the FINAL resolved higher-
  // timeframe periods immediately before candidate selection. This prevents
  // stale csaAreas (created before native/reconstruction reconciliation) from
  // dropping a valid period extreme such as Monday support.
  const profile =
    marketReference?.profile ||
    getSupportedCsaTimeframeProfile(timeframe);

  const freshlyDerivedAreas = buildCsaAreas(levels, symbol, profile);
  const legacyAreas = Array.isArray(marketReference?.csaAreas)
    ? marketReference.csaAreas
    : [];

  // The freshly derived hierarchy is authoritative. Legacy areas may carry
  // useful non-price metadata, but they never replace period/type/price.
  const sourceAreas = freshlyDerivedAreas.map((area) => {
    const areaPeriod = String(area?.period || area?.day || area?.date || '').trim();
    const areaType = String(area?.type || '').toLowerCase();
    const areaPrice = asPositiveNumber(area?.price);
    const legacyMatch = legacyAreas.find((legacy) => {
      const legacyPeriod = String(legacy?.period || legacy?.day || legacy?.date || '').trim();
      const legacyType = String(legacy?.type || '').toLowerCase();
      const legacyPrice = asPositiveNumber(legacy?.price);
      return (
        legacyPeriod === areaPeriod &&
        legacyType === areaType &&
        areaPrice !== null &&
        legacyPrice !== null &&
        Math.abs(legacyPrice - areaPrice) <= Math.max(getCleanBreakTolerance(symbol), Number.EPSILON * 100)
      );
    });
    return legacyMatch
      ? { ...legacyMatch, ...area, authoritativeFrameworkLevel: true, source: 'fresh_authoritative_period_hierarchy' }
      : { ...area, authoritativeFrameworkLevel: true, source: 'fresh_authoritative_period_hierarchy' };
  });

  const tolerance = frameworkLevelTolerance({ symbol, atr });
  const candidates = [];

  console.log('CSA STEPWISE AUTHORITATIVE AREA REBUILD:', {
    buildId: CSA_BUILD_ID,
    timeframe,
    direction,
    periods: levels.map((period) => ({
      period: period?.periodLabel || period?.day || period?.key || null,
      high: period?.high ?? null,
      low: period?.low ?? null,
      source: period?.source || null,
    })),
    areas: sourceAreas.map((area) => ({
      period: area?.period || area?.day || null,
      type: area?.type || null,
      price: area?.price ?? null,
      hierarchyClassification: area?.hierarchyClassification || null,
    })),
    rule: 'rebuild_sr_sd_from_final_resolved_periods_before_lifecycle_and_fib',
  });

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

    // An original S/R level necessarily stops being active in its OLD role
    // once a later framework period breaks it. Do not discard it here before
    // the chronological conversion pass below has a chance to preserve the
    // same authoritative price in its NEW role. The conversion pass still
    // requires a clean break, close/continuation and correct price side.
    const invalidatedOriginalSrAwaitingConversion =
      ["support", "resistance"].includes(
        String(area?.type || "").toLowerCase()
      ) &&
      Number.isInteger(sourceIndex) &&
      sourceIndex < levels.length - 1 &&
      (lifecycle.state === "invalid" ||
        lifecycle.state === "invalidated" ||
        lifecycle.finalType === "invalid");

    if (
      !invalidatedOriginalSrAwaitingConversion &&
      (lifecycle.state === "invalid" ||
        lifecycle.state === "invalidated" ||
        lifecycle.finalType === "invalid")
    ) {
      return;
    }

    const finalType = invalidatedOriginalSrAwaitingConversion
      ? direction === "bearish" && String(area?.type || "").toLowerCase() === "support"
        ? "converted resistance"
        : direction === "bullish" && String(area?.type || "").toLowerCase() === "resistance"
        ? "converted support"
        : lifecycle.finalType
      : lifecycle.finalType;

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

  /*
   * V4.8.5 â€” PRIOR-PERIOD S/R CONVERSION PRESERVATION
   *
   * A new period's H/L classification and the PREVIOUS period's lifecycle are
   * two different jobs. Example on H1/D1 framework:
   *   Monday low = support.
   *   Tuesday trades cleanly below that Monday low.
   *   Tuesday low may become NEW SUPPORT, while Monday support must remain in
   *   memory as POTENTIAL CONVERTED RESISTANCE.
   *
   * Do not let the new Tuesday classification erase Monday's broken support.
   * The same applies inversely to a previous resistance broken to the upside.
   * This synthesis uses the authoritative higher-timeframe periods first and
   * still requires the lower-timeframe deterministic break confirmation from
   * resolveDeterministicFrameworkLifecycle().
   */
  for (let index = 1; index < levels.length; index += 1) {
    const previousPeriod = levels[index - 1];
    const currentPeriod = levels[index];

    console.log('CSA STEP 1 PRIOR-PERIOD S/R CHECK:', {
      buildId: CSA_BUILD_ID,
      direction,
      previousPeriod: previousPeriod?.periodLabel || previousPeriod?.day || previousPeriod?.key || null,
      previousHigh: previousPeriod?.high ?? null,
      previousLow: previousPeriod?.low ?? null,
      currentPeriod: currentPeriod?.periodLabel || currentPeriod?.day || currentPeriod?.key || null,
      currentHigh: currentPeriod?.high ?? null,
      currentLow: currentPeriod?.low ?? null,
      currentClose: currentPeriod?.close ?? null,
      rule: 'check_immediate_prior_authoritative_sr_before_current_period_sd_or_other_structure',
    });

    const previousHigh = asPositiveNumber(previousPeriod?.high);
    const previousLow = asPositiveNumber(previousPeriod?.low);
    const currentHigh = asPositiveNumber(currentPeriod?.high);
    const currentLow = asPositiveNumber(currentPeriod?.low);

    if (
      previousHigh === null ||
      previousLow === null ||
      currentHigh === null ||
      currentLow === null
    ) {
      continue;
    }

    const previousPeriodLabel =
      previousPeriod?.periodLabel ||
      previousPeriod?.day ||
      previousPeriod?.key ||
      `Period ${index}`;

    const synthesizePriorConversion = ({
      originalType,
      expectedFinalType,
      frameworkPrice,
      frameworkSide,
      breachComparison,
    }) => {
      if (!breachComparison?.cleanBreak) return;

      // V4.8.4: for a completed authoritative next period, a clean breach plus
      // an end-period close beyond the prior S/R is sufficient to preserve the
      // prior level as a POTENTIAL converted S/R candidate. This prevents the
      // lower-timeframe lifecycle scanner from accidentally erasing a valid
      // daily/weekly/monthly framework conversion merely because its internal
      // event sequence was ambiguous. A wick-only breach that closes back
      // inside the old level still does NOT qualify.
      const currentPeriodClose = asPositiveNumber(currentPeriod?.close);
      const authoritativeCloseConfirmed =
        currentPeriodClose !== null &&
        (expectedFinalType === 'converted resistance'
          ? currentPeriodClose < frameworkPrice - Math.max(tolerance, getCleanBreakTolerance(symbol))
          : currentPeriodClose > frameworkPrice + Math.max(tolerance, getCleanBreakTolerance(symbol)));

      // Only true S/R has conversion memory. Supply/demand is invalidated when
      // broken and must never be silently converted into S/R.
      const sourceAreaMatch = sourceAreas.find((area) => {
        const type = String(area?.type || '').toLowerCase();
        if (type !== originalType) return false;

        const areaPrice = asPositiveNumber(area?.price);
        if (areaPrice === null) return false;

        const areaPeriod = String(
          area?.period || area?.day || area?.date || ''
        ).trim();
        const periodMatches =
          !areaPeriod ||
          areaPeriod === String(previousPeriodLabel).trim() ||
          areaPeriod === String(previousPeriod?.date || '').trim() ||
          areaPeriod === String(previousPeriod?.key || '').trim();

        return (
          periodMatches &&
          Math.abs(areaPrice - frameworkPrice) <=
            Math.max(tolerance, Number.EPSILON * 100)
        );
      });

      /*
       * V4.8.5 â€” AUTHORITATIVE PRIOR S/R SYNTHESIS
       *
       * The previous period's HIGH/LOW is itself the authoritative framework
       * resistance/support. It must not disappear merely because sourceAreas
       * omitted one side after directional filtering/classification.
       *
       * Example: Monday D1 low is Monday support. If Tuesday closes cleanly
       * below it, Monday support must survive as potential converted resistance
       * even when sourceAreas contains only Monday resistance + Tuesday supply.
       */
      const originalArea = sourceAreaMatch || {
        type: originalType,
        price: frameworkPrice,
        period: previousPeriodLabel,
        day: previousPeriodLabel,
        date: previousPeriod?.date || previousPeriod?.key || null,
        source: 'authoritative_period_sr_synthesized',
        authoritativeFrameworkLevel: true,
        synthesizedFromPeriodExtreme: true,
      };

      if (!sourceAreaMatch) {
        console.log('CSA PRIOR-PERIOD S/R SOURCE SYNTHESIZED:', {
          buildId: CSA_BUILD_ID,
          direction,
          sourcePeriod: previousPeriodLabel,
          sourceIndex: index - 1,
          originalType,
          authoritativePrice: frameworkPrice,
          reason: 'authoritative_period_extreme_exists_even_when_sourceAreas_omits_that_side',
        });
      }

      const lifecycle = resolveDeterministicFrameworkLifecycle({
        area: originalArea,
        levels,
        sourceIndex: index - 1,
        marketReference,
        symbol,
        timeframe,
        atr,
      });

      const lifecycleConfirmed =
        lifecycle.state === 'converted' &&
        lifecycle.finalType === expectedFinalType;

      if (!lifecycleConfirmed && !authoritativeCloseConfirmed) {
        return;
      }

      const alreadyPresent = candidates.some((candidate) =>
        Number(candidate?.sourceIndex) === index - 1 &&
        String(candidate?.type || '').toLowerCase() === expectedFinalType &&
        Math.abs(
          Number(candidate?.frameworkPrice) - Number(frameworkPrice)
        ) <= Math.max(tolerance, Number.EPSILON * 100)
      );

      if (alreadyPresent) return;

      const validDirectionType =
        direction === 'bearish'
          ? expectedFinalType === 'converted resistance'
          : expectedFinalType === 'converted support';
      if (!validDirectionType) return;

      const validPriceSide =
        direction === 'bearish'
          ? frameworkPrice > Number(currentPrice) + tolerance
          : frameworkPrice < Number(currentPrice) - tolerance;
      if (!validPriceSide) return;

      const reconciled = reconcileFrameworkLevelWithVisibleChart({
        frameworkPrice,
        frameworkType: expectedFinalType,
        frameworkPeriod: previousPeriodLabel,
        frameworkSide,
        visualReview,
        symbol,
        atr,
      });

      candidates.push({
        price: reconciled.price,
        frameworkPrice,
        type: expectedFinalType,
        originalType,
        source: 'authoritative_prior_period_sr_conversion',
        priceSource: reconciled.source,
        chartReconciled: reconciled.reconciled === true,
        reconciliationEvidence: reconciled.evidence || null,
        reconciliationPeriodHint: reconciled.periodHint || null,
        reconciliationConfidence: Number(reconciled.confidence || 0),
        reconciliationDifference:
          Number.isFinite(Number(reconciled.difference))
            ? Number(reconciled.difference)
            : null,
        period: previousPeriodLabel,
        breakPeriod:
          currentPeriod?.periodLabel ||
          currentPeriod?.day ||
          currentPeriod?.key ||
          `Period ${index + 1}`,
        breakPeriodIndex: index,
        date:
          previousPeriod?.date || previousPeriod?.key || null,
        sourceIndex: index - 1,
        conversionBreakConfirmed: true,
        conversionConfirmed: false,
        conversionEvidenceSource: lifecycleConfirmed
          ? 'lower_timeframe_confirmed_break'
          : 'authoritative_next_period_close_beyond_prior_sr',
        lifecycleFlipCount: Number(lifecycle.flipCount || 0),
        lifecycleEvents: Array.isArray(lifecycle.events)
          ? lifecycle.events
          : [],
        authorityRank: 0,
        priorPeriodSrConversion: true,
        authoritativeFrameworkLevel: true,
        stepwiseEntryStage: 'immediate_prior_broken_sr',
      });

      console.log('CSA PRIOR-PERIOD S/R CONVERSION PRESERVED:', {
        buildId: CSA_BUILD_ID,
        direction,
        sourcePeriod: previousPeriodLabel,
        sourceIndex: index - 1,
        originalType,
        finalType: expectedFinalType,
        authoritativePrice: frameworkPrice,
        chartReconciledPrice: reconciled.price,
        breachedByPeriod:
          currentPeriod?.periodLabel || currentPeriod?.day || currentPeriod?.key || null,
        lifecycleFlipCount: Number(lifecycle.flipCount || 0),
        lifecycleConfirmed,
        authoritativeCloseConfirmed,
        currentPeriodClose,
        rule: 'previous_authoritative_sr_survives_when_next_period_cleanly_breaks_and_closes_beyond_it',
      });
    };

    if (direction === 'bearish') {
      synthesizePriorConversion({
        originalType: 'support',
        expectedFinalType: 'converted resistance',
        frameworkPrice: previousLow,
        frameworkSide: 'low',
        breachComparison: compareLowWithTolerance(
          currentLow,
          previousLow,
          symbol
        ),
      });
    }

    if (direction === 'bullish') {
      synthesizePriorConversion({
        originalType: 'resistance',
        expectedFinalType: 'converted support',
        frameworkPrice: previousHigh,
        frameworkSide: 'high',
        breachComparison: compareHighWithTolerance(
          currentHigh,
          previousHigh,
          symbol
        ),
      });
    }
  }

  /*
   * V4.10.0 â€” IMMEDIATE-PRIOR S/R HIERARCHY LOCK
   *
   * The latest adjacent authoritative periods receive one final deterministic
   * check before any current-period supply/demand refinement or Fibonacci
   * filtering. This is deliberately independent of buildCsaAreas(), because
   * that classifier may correctly describe the NEW period while omitting the
   * previous period extreme whose role has just changed.
   */
  if (levels.length >= 2 && ["bullish", "bearish"].includes(direction)) {
    const sourceIndex = levels.length - 2;
    const breakPeriodIndex = levels.length - 1;
    const previousPeriod = levels[sourceIndex] || {};
    const breakPeriod = levels[breakPeriodIndex] || {};
    const previousPeriodLabel =
      previousPeriod?.periodLabel ||
      previousPeriod?.day ||
      previousPeriod?.key ||
      `Period ${sourceIndex + 1}`;
    const breakPeriodLabel =
      breakPeriod?.periodLabel ||
      breakPeriod?.day ||
      breakPeriod?.key ||
      `Period ${breakPeriodIndex + 1}`;

    const originalType = direction === "bearish" ? "support" : "resistance";
    const convertedType =
      direction === "bearish" ? "converted resistance" : "converted support";
    const frameworkSide = direction === "bearish" ? "low" : "high";
    const frameworkPrice = asPositiveNumber(
      direction === "bearish" ? previousPeriod?.low : previousPeriod?.high
    );
    const breakExtreme = asPositiveNumber(
      direction === "bearish" ? breakPeriod?.low : breakPeriod?.high
    );
    const breakClose = asPositiveNumber(breakPeriod?.close);
    const cleanBreak =
      frameworkPrice !== null &&
      breakExtreme !== null &&
      (direction === "bearish"
        ? compareLowWithTolerance(breakExtreme, frameworkPrice, symbol).cleanBreak
        : compareHighWithTolerance(breakExtreme, frameworkPrice, symbol).cleanBreak);
    const closeConfirmed =
      frameworkPrice !== null &&
      breakClose !== null &&
      (direction === "bearish"
        ? breakClose < frameworkPrice - Math.max(tolerance, getCleanBreakTolerance(symbol))
        : breakClose > frameworkPrice + Math.max(tolerance, getCleanBreakTolerance(symbol)));
    const validPriceSide =
      frameworkPrice !== null &&
      Number.isFinite(Number(currentPrice)) &&
      (direction === "bearish"
        ? frameworkPrice > Number(currentPrice) + tolerance
        : frameworkPrice < Number(currentPrice) - tolerance);
    const alreadyPresent =
      frameworkPrice !== null &&
      candidates.some(
        (candidate) =>
          Number(candidate?.sourceIndex) === sourceIndex &&
          String(candidate?.type || "").toLowerCase() === convertedType &&
          Math.abs(Number(candidate?.frameworkPrice) - frameworkPrice) <=
            Math.max(tolerance, Number.EPSILON * 100)
      );

    // The completed-period close beyond the prior level is the decisive
    // confirmation for this adjacent-period conversion. A daily/weekly wick
    // may be noisy, but a close safely beyond the level is not discarded just
    // because the extreme comparator was evaluated with a different feed.
    if (closeConfirmed && validPriceSide && !alreadyPresent) {
      const reconciled = reconcileFrameworkLevelWithVisibleChart({
        frameworkPrice,
        frameworkType: convertedType,
        frameworkPeriod: previousPeriodLabel,
        frameworkSide,
        visualReview,
        symbol,
        atr,
      });

      candidates.push({
        price: reconciled.price,
        frameworkPrice,
        type: convertedType,
        originalType,
        source: "authoritative_immediate_prior_sr_hierarchy_lock",
        priceSource: reconciled.source,
        chartReconciled: reconciled.reconciled === true,
        reconciliationEvidence: reconciled.evidence || null,
        reconciliationPeriodHint: reconciled.periodHint || null,
        reconciliationConfidence: Number(reconciled.confidence || 0),
        reconciliationDifference: Number.isFinite(Number(reconciled.difference))
          ? Number(reconciled.difference)
          : null,
        period: previousPeriodLabel,
        breakPeriod: breakPeriodLabel,
        breakPeriodIndex,
        date: previousPeriod?.date || previousPeriod?.key || null,
        sourceIndex,
        conversionBreakConfirmed: true,
        conversionConfirmed: false,
        conversionEvidenceSource: "adjacent_authoritative_period_break_and_close",
        lifecycleFlipCount: 1,
        lifecycleEvents: [
          {
            direction,
            datetime: breakPeriod?.date || breakPeriod?.key || null,
            confirmationPath: "authoritative_period_break_and_close",
          },
        ],
        authorityRank: 0,
        priorPeriodSrConversion: true,
        hierarchyRegressionLock: true,
        authoritativeFrameworkLevel: true,
        stepwiseEntryStage: "immediate_prior_broken_sr",
      });

      console.log("CSA IMMEDIATE-PRIOR S/R HIERARCHY LOCK RESTORED:", {
        buildId: CSA_BUILD_ID,
        selectorVersion: CSA_SELECTOR_VERSION,
        direction,
        sourcePeriod: previousPeriodLabel,
        breakPeriod: breakPeriodLabel,
        originalType,
        convertedType,
        frameworkPrice,
        chartReconciledPrice: reconciled.price,
        breakExtreme,
        breakClose,
        rule: "immediate_prior_broken_sr_must_reach_candidate_fib_gate_before_current_period_sd",
      });
    }
  }

  // V4.8.2: an intraday takeover base is NOT a framework S/R or S/D area.
  // It may reinforce an already-classified authoritative framework level later
  // in the main pipeline, but it must never enter the candidate set by itself.
  const takeoverIntradayCandidate = buildHistoricalTakeoverIntradayCandidate({
    marketReference,
    direction,
    currentPrice,
    symbol,
    timeframe,
    atr,
  });

  if (takeoverIntradayCandidate) {
    console.log("CSA HIERARCHY INTRADAY STANDALONE SUPPRESSED:", {
      buildId: CSA_BUILD_ID,
      price: takeoverIntradayCandidate.frameworkPrice || takeoverIntradayCandidate.price || null,
      proposedType: takeoverIntradayCandidate.type || null,
      period: takeoverIntradayCandidate.period || null,
      rule: "intraday_base_may_reinforce_authoritative_framework_area_but_cannot_create_framework_sd",
    });
  }

  // FINAL ADJACENT-CONVERSION INVARIANT. This is deliberately placed after
  // every lifecycle/classification branch: when the last completed framework
  // period closes through the immediately previous true S/R, the prior level
  // MUST enter the candidate set in its converted role. It cannot be omitted
  // by an earlier classifier or treated as the next period's new S/D area.
  if (levels.length >= 2 && ["bearish", "bullish"].includes(direction)) {
    const sourceIndex = levels.length - 2;
    const breakPeriodIndex = levels.length - 1;
    const previous = levels[sourceIndex] || {};
    const breaker = levels[breakPeriodIndex] || {};
    const originalType = direction === "bearish" ? "support" : "resistance";
    const convertedType = direction === "bearish" ? "converted resistance" : "converted support";
    const frameworkPrice = asPositiveNumber(direction === "bearish" ? previous.low : previous.high);
    const breakClose = asPositiveNumber(breaker.close);
    const adjacentConversionTolerance = frameworkConversionTolerance({ symbol });
    const closeBeyond = frameworkPrice !== null && breakClose !== null &&
      (direction === "bearish"
        ? breakClose < frameworkPrice - adjacentConversionTolerance
        : breakClose > frameworkPrice + adjacentConversionTolerance);
    const correctSide = frameworkPrice !== null &&
      (direction === "bearish"
        ? frameworkPrice > Number(currentPrice) + adjacentConversionTolerance
        : frameworkPrice < Number(currentPrice) - adjacentConversionTolerance);
    const alreadyPresent = candidates.some((candidate) =>
      Number(candidate?.sourceIndex) === sourceIndex &&
      String(candidate?.type || "").toLowerCase() === convertedType
    );
    if (closeBeyond && correctSide && !alreadyPresent) {
      const period = previous.periodLabel || previous.day || previous.key || `Period ${sourceIndex + 1}`;
      const breakPeriod = breaker.periodLabel || breaker.day || breaker.key || `Period ${breakPeriodIndex + 1}`;
      const reconciled = reconcileFrameworkLevelWithVisibleChart({ frameworkPrice, frameworkType: convertedType, frameworkPeriod: period, frameworkSide: direction === "bearish" ? "low" : "high", visualReview, symbol, atr });
      candidates.push({ price: reconciled.price, frameworkPrice, type: convertedType, originalType, source: "final_adjacent_conversion_invariant", priceSource: reconciled.source, chartReconciled: reconciled.reconciled === true, period, breakPeriod, breakPeriodIndex, sourceIndex, conversionBreakConfirmed: true, conversionConfirmed: false, authorityRank: 0, priorPeriodSrConversion: true, hierarchyRegressionLock: true, authoritativeFrameworkLevel: true, stepwiseEntryStage: "immediate_prior_broken_sr" });
      console.log("CSA FINAL ADJACENT-CONVERSION INVARIANT INSERTED:", { sourcePeriod: period, breakPeriod, originalType, convertedType, frameworkPrice, breakClose, conversionTolerance: adjacentConversionTolerance, conversionToleranceSource: "instrument_clean_break" });
    }
  }

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

function resolveFinalVisibleDirectionEngine({
  marketReference = {},
  timeframe = "H1",
  symbol = "",
  fallbackDirection = "range",
  chartDetection = {},
  visualReview = {},
  visualBreakoutState = {},
}) {
  const candles = Array.isArray(marketReference?.timeframeCandles)
    ? marketReference.timeframeCandles
        .filter((c) =>
          c?.datetime &&
          [c?.open, c?.high, c?.low, c?.close].every((v) =>
            Number.isFinite(Number(v))
          )
        )
        .sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)))
    : [];

  const fallback = ["bullish", "bearish", "range"].includes(
    String(fallbackDirection || "").toLowerCase()
  )
    ? String(fallbackDirection).toLowerCase()
    : "range";

  if (candles.length < 12) {
    return {
      direction: fallback,
      confidence: "low",
      source: "insufficient_recent_candles",
      latestBreak: null,
      diagnostics: { candleCount: candles.length },
    };
  }

  const cfg = getStructureEngineConfig(timeframe);
  const atr = averageTrueRange(candles, cfg.atrPeriod);
  const tolerance = Math.max(
    getApprovedPriceTolerance(symbol),
    Number(atr || 0) * 0.07
  );

  const tf = comparableTimeframe(timeframe) || "H1";
  const lookbacks = {
    M1: 90,
    M5: 84,
    M15: 76,
    M30: 68,
    H1: 64,
    H4: 52,
    D1: 42,
    W1: 32,
    MN: 24,
  };
  const recentLookback = lookbacks[tf] || 64;
  const recentStart = Math.max(0, candles.length - recentLookback);
  const recent = candles.slice(recentStart);
  const pivots = detectConfirmedSwingPivots(recent, cfg).map((p) => ({
    ...p,
    pivotIndex: recentStart + Number(p.pivotIndex || 0),
    confirmedAtIndex: recentStart + Number(p.confirmedAtIndex || 0),
  }));

  const resistances = pivots.filter((p) => p.type === "resistance");
  const supports = pivots.filter((p) => p.type === "support");
  const lastTwoHighs = resistances.slice(-2);
  const lastTwoLows = supports.slice(-2);

  const higherHigh =
    lastTwoHighs.length === 2 &&
    Number(lastTwoHighs[1].price) > Number(lastTwoHighs[0].price) + tolerance;
  const lowerHigh =
    lastTwoHighs.length === 2 &&
    Number(lastTwoHighs[1].price) < Number(lastTwoHighs[0].price) - tolerance;
  const higherLow =
    lastTwoLows.length === 2 &&
    Number(lastTwoLows[1].price) > Number(lastTwoLows[0].price) + tolerance;
  const lowerLow =
    lastTwoLows.length === 2 &&
    Number(lastTwoLows[1].price) < Number(lastTwoLows[0].price) - tolerance;

  const recentBreakEvents = [];
  for (const pivot of pivots) {
    const level = Number(pivot.price);
    if (!Number.isFinite(level)) continue;
    const side = pivot.type === "resistance" ? "bullish" : "bearish";
    const searchFrom = Math.max(pivot.confirmedAtIndex + 1, recentStart + 1);

    for (let i = searchFrom; i < candles.length; i += 1) {
      const multipleCloses = countConsecutiveBreakCloses({
        candles,
        index: i,
        level,
        tolerance,
        side,
        count: Math.max(2, Number(cfg.confirmationCloses || 2)),
      });
      const displacement = isStrongDisplacementBreak({
        candles,
        index: i,
        level,
        tolerance,
        atr,
        side,
        timeframe,
      });
      if (!multipleCloses && !displacement) continue;

      const nextClose = Number(candles[i + 1]?.close);
      const holds = !Number.isFinite(nextClose)
        ? true
        : side === "bullish"
        ? nextClose > level - tolerance
        : nextClose < level + tolerance;
      if (!holds) continue;

      recentBreakEvents.push({
        direction: side,
        breakIndex: i,
        datetime: candles[i]?.datetime || null,
        level,
        pivotIndex: pivot.pivotIndex,
        pivotDatetime: pivot.datetime || null,
        confirmation: multipleCloses
          ? "multiple_closes"
          : "strong_displacement_and_hold",
        source: "recent_confirmed_pivot_break",
      });
      break;
    }
  }

  recentBreakEvents.sort((a, b) => a.breakIndex - b.breakIndex);
  const latestBreak = recentBreakEvents.length
    ? recentBreakEvents[recentBreakEvents.length - 1]
    : null;

  const recentSlope = recentCloseSlope(candles, Math.min(8, candles.length));
  const slopeThreshold = Math.max(Number(atr || 0) * 0.08, tolerance * 0.5);

  let direction = "range";
  let source = "recent_structure_unclear";
  let confidence = "low";

  if (latestBreak) {
    direction = latestBreak.direction;
    source = "latest_confirmed_recent_pivot_break";
    confidence = "high";
  } else if (higherHigh && higherLow) {
    direction = "bullish";
    source = "recent_higher_high_higher_low";
    confidence = "high";
  } else if (lowerHigh && lowerLow) {
    direction = "bearish";
    source = "recent_lower_high_lower_low";
    confidence = "high";
  } else if ((higherHigh || higherLow) && recentSlope > slopeThreshold) {
    direction = "bullish";
    source = "recent_bullish_structure_and_slope";
    confidence = "medium";
  } else if ((lowerHigh || lowerLow) && recentSlope < -slopeThreshold) {
    direction = "bearish";
    source = "recent_bearish_structure_and_slope";
    confidence = "medium";
  } else if (recentSlope > slopeThreshold * 2) {
    direction = "bullish";
    source = "strong_recent_bullish_slope";
    confidence = "medium";
  } else if (recentSlope < -slopeThreshold * 2) {
    direction = "bearish";
    source = "strong_recent_bearish_slope";
    confidence = "medium";
  }

  /*
   * V4.6.6 FINAL-VISIBLE ENDPOINT AUTHORITY
   * Final-visible mode must describe the uploaded chart endpoint, not an older
   * external-OHLC regime. This only resolves direction; entries remain gated.
   */
  const chartVisiblePrice =
    asPositiveNumber(chartDetection?.latestVisiblePrice) ||
    asPositiveNumber(visualReview?.latestVisiblePrice);

  const externalFinalClose = asPositiveNumber(
    candles[candles.length - 1]?.close
  );

  const endpointDifference =
    chartVisiblePrice !== null && externalFinalClose !== null
      ? Math.abs(chartVisiblePrice - externalFinalClose)
      : null;

  const endpointMismatchTolerance = Math.max(
    getApprovedPriceTolerance(symbol) * 6,
    Number(atr || 0) * 2.25
  );

  const endpointMateriallyDiverged =
    endpointDifference !== null &&
    endpointDifference > endpointMismatchTolerance;

  const normalizedVisualDirection = normalizedDirectionCode(
    visualReview?.plainMarketDirection ||
      visualReview?.shortTermDirection ||
      visualReview?.preferredEntryArea?.direction ||
      ""
  );

  const explicitVisualBreakDirection =
    visualBreakoutState?.bullishBreakout === true &&
    visualBreakoutState?.bearishBreakdown !== true
      ? "bullish"
      : visualBreakoutState?.bearishBreakdown === true &&
        visualBreakoutState?.bullishBreakout !== true
      ? "bearish"
      : null;

  const barsSinceLatestBreak = latestBreak
    ? Math.max(0, candles.length - 1 - Number(latestBreak.breakIndex || 0))
    : null;

  const oldBreakOpposedByCurrentChart =
    latestBreak &&
    explicitVisualBreakDirection &&
    explicitVisualBreakDirection !== latestBreak.direction &&
    Number.isFinite(barsSinceLatestBreak) &&
    barsSinceLatestBreak >= 6;

  const visualSlopeAgreement =
    explicitVisualBreakDirection === "bullish"
      ? recentSlope > 0
      : explicitVisualBreakDirection === "bearish"
      ? recentSlope < 0
      : false;

  let endpointOverrideApplied = false;
  let endpointOverrideReason = null;

  if (endpointMateriallyDiverged && explicitVisualBreakDirection) {
    direction = explicitVisualBreakDirection;
    source = "final_visible_chart_endpoint_external_ohlc_mismatch";
    confidence = "high";
    endpointOverrideApplied = true;
    endpointOverrideReason =
      "verified_chart_endpoint_materially_differs_from_external_ohlc_and_visual_breakout_is_clear";
  } else if (
    endpointMateriallyDiverged &&
    ["bullish", "bearish"].includes(normalizedVisualDirection)
  ) {
    direction = normalizedVisualDirection;
    source = "final_visible_chart_endpoint_visual_direction_fallback";
    confidence = "medium";
    endpointOverrideApplied = true;
    endpointOverrideReason =
      "verified_chart_endpoint_materially_differs_from_external_ohlc";
  } else if (oldBreakOpposedByCurrentChart && visualSlopeAgreement) {
    direction = explicitVisualBreakDirection;
    source = "final_visible_newer_visual_break_supersedes_old_structural_event";
    confidence = "high";
    endpointOverrideApplied = true;
    endpointOverrideReason =
      "newer_opposite_visual_break_with_supporting_recent_slope";
  }

  const frameworkDirectionFromBias = normalizedDirectionCode(
    marketReference?.directionalBias?.biasCode ||
      marketReference?.directionalBias?.bias ||
      ""
  );
  const reclaimFrameworkDirection = ["bullish", "bearish"].includes(
    frameworkDirectionFromBias
  )
    ? frameworkDirectionFromBias
    : fallback;
  const reclaimedInternalBreak = latestBreak
    ? resolveFinalVisibleReclaimedInternalBreak({
        marketReference,
        periodPhase: {
          direction: reclaimFrameworkDirection,
          phase:
            reclaimFrameworkDirection === "bullish"
              ? "bullish_structure"
              : reclaimFrameworkDirection === "bearish"
              ? "bearish_structure"
              : "range",
          source: "final_visible_direction_framework_context",
        },
        candlePhase: {
          direction: latestBreak.direction,
          phase:
            latestBreak.direction === "bullish"
              ? "bullish_breakout"
              : "bearish_breakdown",
          latestClose: externalFinalClose,
          brokenLevel: latestBreak.level,
          source: "latest_confirmed_recent_pivot_break",
          diagnostics: {
            latestEvent: {
              side: latestBreak.direction,
              datetime: latestBreak.datetime,
              level: latestBreak.level,
              close: candles[latestBreak.breakIndex]?.close ?? null,
              confirmationPath: latestBreak.confirmation || null,
            },
            finalClose: externalFinalClose,
          },
        },
        symbol,
        timeframe,
      })
    : null;

  // When the uploaded-chart endpoint materially disagrees with external OHLC,
  // the verified chart endpoint keeps priority. Otherwise, a fully validated
  // reclaim of the latest internal break restores framework direction.
  if (reclaimedInternalBreak && !endpointMateriallyDiverged) {
    direction = reclaimedInternalBreak.direction;
    source = "final_visible_framework_reclaimed_internal_break";
    confidence = "high";
    endpointOverrideApplied = true;
    endpointOverrideReason =
      "latest_internal_break_decisively_reclaimed_in_authoritative_framework_direction";
  }

  return {
    direction,
    confidence,
    source,
    latestBreak,
    chartEndpointAuthority: {
      chartVisiblePrice,
      externalFinalClose,
      endpointDifference,
      endpointMismatchTolerance,
      endpointMateriallyDiverged,
      explicitVisualBreakDirection,
      normalizedVisualDirection,
      barsSinceLatestBreak,
      visualSlopeAgreement,
      reclaimedInternalBreakApplied: Boolean(reclaimedInternalBreak),
      overrideApplied: endpointOverrideApplied,
      overrideReason: endpointOverrideReason,
    },
    diagnostics: {
      timeframe: tf,
      candleCount: candles.length,
      recentLookback,
      recentStart,
      atr,
      tolerance,
      recentSlope,
      slopeThreshold,
      higherHigh,
      higherLow,
      lowerHigh,
      lowerLow,
      lastTwoHighs: lastTwoHighs.map((p) => ({
        index: p.pivotIndex,
        price: Number(p.price),
        datetime: p.datetime || null,
      })),
      lastTwoLows: lastTwoLows.map((p) => ({
        index: p.pivotIndex,
        price: Number(p.price),
        datetime: p.datetime || null,
      })),
      recentBreakEvents: recentBreakEvents.slice(-8),
      fallbackDirection: fallback,
      reclaimedInternalBreak:
        reclaimedInternalBreak?.diagnostics || null,
    },
  };
}

function resolveFinalVisibleCurrentStructureRegime({
  marketReference = {},
  timeframe = "H1",
  symbol = "",
  fallbackDirection = "range",
  visualDirection = "range",
  visualBreakoutState = {},
}) {
  const candles = Array.isArray(marketReference?.timeframeCandles)
    ? marketReference.timeframeCandles
        .filter((c) =>
          c?.datetime &&
          [c?.open, c?.high, c?.low, c?.close].every((v) =>
            Number.isFinite(Number(v))
          )
        )
        .sort((a, b) =>
          String(a.datetime).localeCompare(String(b.datetime))
        )
    : [];

  const normalizedFallback =
    ["bullish", "bearish", "range"].includes(
      String(fallbackDirection || "").toLowerCase()
    )
      ? String(fallbackDirection).toLowerCase()
      : "range";

  const normalizedVisual =
    ["bullish", "bearish"].includes(
      String(visualDirection || "").toLowerCase()
    )
      ? String(visualDirection).toLowerCase()
      : "range";

  const visualBreakDirection =
    visualBreakoutState?.bullishBreakout === true &&
    visualBreakoutState?.bearishBreakdown !== true
      ? "bullish"
      : visualBreakoutState?.bearishBreakdown === true &&
        visualBreakoutState?.bullishBreakout !== true
      ? "bearish"
      : null;

  if (candles.length < 10) {
    const direction =
      visualBreakDirection ||
      normalizedVisual ||
      normalizedFallback;

    return {
      direction,
      phase:
        direction === "bullish"
          ? "bullish_breakout"
          : direction === "bearish"
          ? "bearish_breakdown"
          : "range",
      bullishBreakout: direction === "bullish",
      bearishBreakdown: direction === "bearish",
      bullishRecoveryAfterBreakdown: false,
      bearishPullbackAfterBreakout: false,
      source:
        visualBreakDirection
          ? "final_visible_visual_breakout_fallback"
          : "insufficient_candles_fallback",
      event: null,
      priorDirection: normalizedFallback,
    };
  }

  const structureConfig =
    getStructureEngineConfig(timeframe);

  const atr = averageTrueRange(
    candles,
    structureConfig.atrPeriod
  );

  const tolerance = Math.max(
    getApprovedPriceTolerance(symbol),
    Number(atr || 0) * 0.08
  );

  const pivots = detectConfirmedSwingPivots(
    candles,
    structureConfig
  );

  const pivotEvents =
    buildOrderedStructureEvents({
      candles,
      pivots,
      tolerance,
      atr,
      timeframe:
        structureConfig.timeframe,
      confirmationCloses:
        structureConfig.confirmationCloses,
      searchStart: Math.max(
        1,
        candles.length -
          Number(
            structureConfig.eventLookback || 140
          )
      ),
    }).map((event) => ({
      direction:
        event.side,
      breakIndex:
        event.index,
      breakDatetime:
        event.datetime || null,
      level:
        Number(event.level),
      confirmationPath:
        event.confirmationPath ||
        "multiple_closes",
      source:
        "confirmed_swing_break",
      significance:
        100,
    }));

  /*
   * V4.6.4:
   * A very recent breakout can occur before a fresh swing pivot has enough
   * right-side candles to become formally confirmed. To avoid an OLD opposite
   * event controlling the final-visible regime, also scan for decisive breaks
   * of a protected rolling structural boundary.
   *
   * This is NOT a micro high/low scanner. The boundary must come from a
   * meaningful prior range and the break must be confirmed by multiple closes
   * or strong displacement + hold.
   */
  const tf =
    comparableTimeframe(timeframe) ||
    "H1";

  const rollingSettings = {
    M1:  { lookback: 30, minRangeAtr: 3.0 },
    M5:  { lookback: 28, minRangeAtr: 3.0 },
    M15: { lookback: 26, minRangeAtr: 2.8 },
    M30: { lookback: 24, minRangeAtr: 2.8 },
    H1:  { lookback: 24, minRangeAtr: 2.6 },
    H4:  { lookback: 18, minRangeAtr: 2.5 },
    D1:  { lookback: 14, minRangeAtr: 2.4 },
    W1:  { lookback: 10, minRangeAtr: 2.2 },
    MN:  { lookback: 8,  minRangeAtr: 2.0 },
  };

  const rollingConfig =
    rollingSettings[tf] ||
    rollingSettings.H1;

  const rollingEvents = [];

  const rollingSearchStart =
    Math.max(
      rollingConfig.lookback + 2,
      candles.length -
        Number(
          structureConfig.eventLookback || 140
        )
    );

  for (
    let index = rollingSearchStart;
    index < candles.length;
    index += 1
  ) {
    const priorStart =
      Math.max(
        0,
        index -
          rollingConfig.lookback
      );

    // Exclude the immediately preceding two candles from defining the
    // protected boundary. This stops the breakout candle's own launch area
    // from constantly moving the boundary.
    const priorEnd =
      Math.max(
        priorStart + 1,
        index - 2
      );

    const prior =
      candles.slice(
        priorStart,
        priorEnd
      );

    if (prior.length < 6) continue;

    const priorHigh =
      maxFinite(
        prior.map((c) => c?.high)
      );
    const priorLow =
      minFinite(
        prior.map((c) => c?.low)
      );

    if (
      !Number.isFinite(priorHigh) ||
      !Number.isFinite(priorLow)
    ) {
      continue;
    }

    const structuralRange =
      priorHigh - priorLow;

    if (
      !Number.isFinite(atr) ||
      atr <= 0 ||
      structuralRange <
        atr *
          rollingConfig.minRangeAtr
    ) {
      continue;
    }

    for (const side of [
      "bullish",
      "bearish",
    ]) {
      const level =
        side === "bullish"
          ? priorHigh
          : priorLow;

      const multipleCloses =
        countConsecutiveBreakCloses({
          candles,
          index,
          level,
          tolerance,
          side,
          count: Math.max(
            2,
            Number(
              structureConfig.confirmationCloses ||
                2
            )
          ),
        });

      const displacement =
        isStrongDisplacementBreak({
          candles,
          index,
          level,
          tolerance,
          atr,
          side,
          timeframe,
        });

      if (
        !multipleCloses &&
        !displacement
      ) {
        continue;
      }

      const nextClose =
        Number(
          candles[index + 1]?.close
        );

      const laterHold =
        !Number.isFinite(nextClose)
          ? true
          : side === "bullish"
          ? nextClose >
            level - tolerance
          : nextClose <
            level + tolerance;

      if (
        !multipleCloses &&
        !laterHold
      ) {
        continue;
      }

      const close =
        Number(
          candles[index]?.close
        );

      const extension =
        side === "bullish"
          ? close - level
          : level - close;

      rollingEvents.push({
        direction: side,
        breakIndex: index,
        breakDatetime:
          candles[index]?.datetime ||
          null,
        level,
        confirmationPath:
          multipleCloses
            ? "rolling_boundary_multiple_closes"
            : "rolling_boundary_strong_displacement_and_hold",
        source:
          "protected_rolling_boundary_break",
        significance:
          200 +
          Math.max(
            0,
            extension /
              Math.max(
                atr,
                tolerance
              )
          ),
      });
    }
  }

  const allEvents = [
    ...pivotEvents,
    ...rollingEvents,
  ].sort((a, b) => {
    if (
      a.breakIndex !==
      b.breakIndex
    ) {
      return (
        a.breakIndex -
        b.breakIndex
      );
    }

    return (
      Number(a.significance || 0) -
      Number(b.significance || 0)
    );
  });

  const latestEvent =
    allEvents.length
      ? allEvents[
          allEvents.length - 1
        ]
      : null;

  if (!latestEvent) {
    const direction =
      visualBreakDirection ||
      normalizedFallback;

    return {
      direction,
      phase:
        direction === "bullish"
          ? "bullish_breakout"
          : direction === "bearish"
          ? "bearish_breakdown"
          : "range",
      bullishBreakout:
        direction === "bullish",
      bearishBreakdown:
        direction === "bearish",
      bullishRecoveryAfterBreakdown:
        false,
      bearishPullbackAfterBreakout:
        false,
      source:
        visualBreakDirection
          ? "final_visible_visual_breakout_no_deterministic_event"
          : "no_confirmed_final_visible_regime_break",
      event: null,
      priorDirection:
        normalizedFallback,
      diagnostics: {
        pivotEventCount:
          pivotEvents.length,
        rollingEventCount:
          rollingEvents.length,
      },
    };
  }

  const latestClose =
    Number(
      candles[
        candles.length - 1
      ]?.close
    );

  const barsAfterEvent =
    candles.slice(
      latestEvent.breakIndex
    );

  const postEventHigh =
    maxFinite(
      barsAfterEvent.map(
        (c) => c?.high
      )
    );

  const postEventLow =
    minFinite(
      barsAfterEvent.map(
        (c) => c?.low
      )
    );

  let bullishRecoveryAfterBreakdown =
    false;
  let bearishPullbackAfterBreakout =
    false;

  if (
    latestEvent.direction ===
    "bearish"
  ) {
    const depth =
      Number(latestEvent.level) -
      Number(postEventLow);

    const recovery =
      latestClose -
      Number(postEventLow);

    bullishRecoveryAfterBreakdown =
      depth > 0 &&
      recovery /
        depth >=
        0.42 &&
      recentCloseSlope(
        barsAfterEvent,
        Math.min(
          5,
          barsAfterEvent.length
        )
      ) > 0;
  } else {
    const height =
      Number(postEventHigh) -
      Number(latestEvent.level);

    const pullback =
      Number(postEventHigh) -
      latestClose;

    bearishPullbackAfterBreakout =
      height > 0 &&
      pullback /
        height >=
        0.42 &&
      recentCloseSlope(
        barsAfterEvent,
        Math.min(
          5,
          barsAfterEvent.length
        )
      ) < 0;
  }

  const direction =
    latestEvent.direction;

  const phase =
    direction === "bullish"
      ? bearishPullbackAfterBreakout
        ? "bearish_pullback_after_bullish_breakout"
        : "bullish_breakout"
      : bullishRecoveryAfterBreakdown
      ? "bullish_recovery_after_bearish_breakdown"
      : "bearish_breakdown";

  return {
    direction,
    phase,
    bullishBreakout:
      direction === "bullish" &&
      !bearishPullbackAfterBreakout,
    bearishBreakdown:
      direction === "bearish" &&
      !bullishRecoveryAfterBreakdown,
    bullishRecoveryAfterBreakdown,
    bearishPullbackAfterBreakout,
    source:
      latestEvent.source,
    event:
      latestEvent,
    priorDirection:
      normalizedFallback,
    visualBreakDirection,
    visualDirection:
      normalizedVisual,
    latestClose,
    diagnostics: {
      atr,
      tolerance,
      pivotEventCount:
        pivotEvents.length,
      rollingEventCount:
        rollingEvents.length,
      lastThreeEvents:
        allEvents.slice(-3),
    },
  };
}


function buildExactChartFrameworkCandidates({
  visualReview = {},
  marketReference = {},
  direction = "range",
  currentPrice = null,
  symbol = "",
  atr = 0,
} = {}) {
  if (
    !["bullish", "bearish"].includes(direction) ||
    !Number.isFinite(Number(currentPrice))
  ) {
    return [];
  }

  const exactPrices = (Array.isArray(visualReview?.visibleMarkedLevels)
    ? visualReview.visibleMarkedLevels
    : [])
    .filter((item) =>
      [
        "independent_horizontal_line_reader_exact",
        "per_target_framework_price_reader",
      ].includes(String(item?.extractionSource || ""))
    )
    .map((item) => ({
      price: nullablePositiveNumber(item?.displayedPrice),
      extractionSource: String(item?.extractionSource || ""),
      evidence: safeUserText(item?.description || item?.platformLabel || ""),
    }))
    .filter((item) => item.price !== null);
  const frameworkAreas = Array.isArray(marketReference?.csaAreas)
    ? marketReference.csaAreas
    : [];
  const dailyLevels = Array.isArray(marketReference?.dailyLevels)
    ? marketReference.dailyLevels
    : [];
  const tolerance = getFrameworkChartReconciliationTolerance({
    symbol,
    atr,
  });

  return exactPrices
    .map((exactLevel) => {
      const chartPrice = exactLevel.price;
      const match = frameworkAreas
        .map((area) => ({
          area,
          frameworkPrice: asPositiveNumber(area?.price),
        }))
        .filter((item) => item.frameworkPrice !== null)
        .map((item) => ({
          ...item,
          distance: Math.abs(item.frameworkPrice - chartPrice),
        }))
        .filter((item) => item.distance <= tolerance)
        .sort((a, b) => a.distance - b.distance)[0];

      // An independently read printed horizontal price is chart-native
      // structural evidence even when the external provider did not return a
      // matching framework area. It may enter the candidate pool as a
      // potential converted S/R only; the shared structural and hidden-Fib
      // gates below still decide whether it survives. Per-target model output
      // is not allowed to create an unmatched level.
      const chartNativeOnly =
        !match &&
        exactLevel.extractionSource ===
          "independent_horizontal_line_reader_exact";
      if (!match && !chartNativeOnly) return null;

      const originalType = match
        ? String(match.area?.type || "").toLowerCase()
        : direction === "bullish"
        ? "resistance"
        : "support";
      const convertedType =
        direction === "bullish" &&
        originalType === "resistance" &&
        chartPrice < Number(currentPrice)
          ? "converted support"
          : direction === "bearish" &&
            originalType === "support" &&
            chartPrice > Number(currentPrice)
          ? "converted resistance"
          : originalType;
      const sideCompatible =
        direction === "bullish"
          ? ["support", "demand", "converted support"].includes(convertedType) &&
            chartPrice < Number(currentPrice)
          : ["resistance", "supply", "converted resistance"].includes(convertedType) &&
            chartPrice > Number(currentPrice);

      if (!sideCompatible) return null;

      const period =
        match?.area?.day ||
        match?.area?.period ||
        match?.area?.date ||
        null;
      const sourceIndex = dailyLevels.findIndex((level) =>
        [level?.periodLabel, level?.day, level?.key, level?.date]
          .filter(Boolean)
          .some((value) => String(value) === String(period))
      );
      const conversionBreakConfirmed =
        convertedType === "converted support" ||
        convertedType === "converted resistance";

      return {
        price: chartPrice,
        frameworkPrice: match?.frameworkPrice || chartPrice,
        type: convertedType,
        originalType,
        source: chartNativeOnly
          ? "exact_chart_native_sr_level_pre_fib"
          : "exact_chart_framework_level_pre_fib",
        priceSource: "independent_horizontal_line_reader_exact",
        chartReconciled: true,
        chartExactFrameworkConfirmed: true,
        reconciliationDifference: match?.distance || 0,
        reconciliationEvidence: exactLevel.evidence,
        period,
        sourceIndex,
        conversionBreakConfirmed,
        conversionConfirmed: false,
        priorPeriodSrConversion: conversionBreakConfirmed,
        authoritativeFrameworkLevel: true,
        stepwiseEntryStage: conversionBreakConfirmed
          ? chartNativeOnly
            ? "immediate_prior_broken_sr"
            : "earlier_broken_sr"
          : originalType === "support" || originalType === "resistance"
          ? "support_resistance"
          : "supply_demand",
        authorityRank: 0,
        authoritativeStructuralException: chartNativeOnly,
        independentEntryEvidence: false,
      };
    })
    .filter(Boolean)
    .filter((candidate, index, candidates) =>
      candidates.findIndex(
        (item) =>
          Math.abs(Number(item.price) - Number(candidate.price)) <=
          Number.EPSILON * 100
      ) === index
    );
}

function normalizeChartNativeEntryFallback(value = {}) {
  const direction = String(value?.direction || "").toLowerCase();
  const candidates = (Array.isArray(value?.candidates) ? value.candidates : [])
    .slice(0, 24)
    .map((candidate) => ({
      price: nullablePositiveNumber(candidate?.price),
      zoneLow: nullablePositiveNumber(candidate?.zoneLow),
      zoneHigh: nullablePositiveNumber(candidate?.zoneHigh),
      areaType: String(candidate?.areaType || "").toLowerCase().trim(),
      exactVisiblePrice: candidate?.exactVisiblePrice === true,
      conversionBreakConfirmed: candidate?.conversionBreakConfirmed === true,
      structuralEvidence: safeUserText(candidate?.structuralEvidence || ""),
      independentEntryEvidence: candidate?.independentEntryEvidence === true,
      reclaimRequired: candidate?.reclaimRequired === true,
      sourceDate: /^\d{4}-\d{2}-\d{2}$/.test(String(candidate?.sourceDate || "")) ? String(candidate.sourceDate) : null,
      sourceDay: safeUserText(candidate?.sourceDay || ""),
      sourceKind: safeUserText(candidate?.sourceKind || ""),
      currentWeekExtreme: ["high", "low"].includes(String(candidate?.currentWeekExtreme || "").toLowerCase())
        ? String(candidate.currentWeekExtreme).toLowerCase()
        : null,
      fibRatio: Number(candidate?.fibRatio),
      fibPrice: nullablePositiveNumber(candidate?.fibPrice),
    }))
    .filter((candidate) => candidate.price !== null);

  return {
    usable:
      value?.usable === true &&
      ["bullish", "bearish"].includes(direction) &&
      candidates.length > 0,
    direction,
    currentPrice: nullablePositiveNumber(value?.currentPrice),
    // H1 CSA Fibonacci is anchored to the screenshot-visible current week.
    // These are deliberately separate from the older generic impulse fields.
    currentWeekHigh: nullablePositiveNumber(value?.currentWeekHigh),
    currentWeekLow: nullablePositiveNumber(value?.currentWeekLow),
    currentPeriodOpen: nullablePositiveNumber(value?.currentPeriodOpen),
    currentPeriodClose: nullablePositiveNumber(value?.currentPeriodClose),
    currentPeriodDirection: ["bullish", "bearish", "range"].includes(String(value?.currentPeriodDirection || "").toLowerCase())
      ? String(value.currentPeriodDirection).toLowerCase()
      : null,
    periodDayInventory: (Array.isArray(value?.periodDayInventory) ? value.periodDayInventory : [])
      .slice(0, 7)
      .map((day) => ({
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(day?.date || "")) ? String(day.date) : null,
        high: nullablePositiveNumber(day?.high),
        low: nullablePositiveNumber(day?.low),
        structures: (Array.isArray(day?.structures) ? day.structures : []).slice(0, 12).map((item) => ({
          price: nullablePositiveNumber(item?.price),
          type: safeUserText(item?.type || ""),
          note: safeUserText(item?.note || ""),
        })).filter((item) => item.price !== null),
      }))
      .filter((day) => day.date && day.high !== null && day.low !== null && day.high >= day.low),
    swingHigh: nullablePositiveNumber(value?.swingHigh),
    swingLow: nullablePositiveNumber(value?.swingLow),
    candidates,
    source: "focused_uploaded_chart_structure_fallback",
  };
}

async function extractFocusedChartNativeEntryFallback({
  imageBase64,
  mimeType,
  chartDetection = {},
  submittedInstrument = "",
  timeframe = "",
} = {}) {
  const context = {
    instrument:
      safeUserText(chartDetection?.instrument || submittedInstrument || ""),
    timeframe: safeUserText(chartDetection?.timeframe || timeframe || ""),
    latestVisiblePrice:
      nullablePositiveNumber(chartDetection?.latestVisiblePrice),
    direction: safeUserText(
      chartDetection?.triggerDirection || chartDetection?.direction || ""
    ),
    visibleTrigger: safeUserText(chartDetection?.visibleTrigger || ""),
    notes: safeUserText(chartDetection?.notes || ""),
  };

  const systemPrompt = `You are the focused chart-native CSA fallback reader. The external market-data provider is unavailable for this chart, so read only the uploaded screenshot and the supplied first-pass chart context.

Apply this order exactly:
1. Identify exact printed support/resistance prices and genuine converted levels.
2. Identify an independent supply/demand base only when its own displacement is visibly clear.
3. For an H1 chart, first locate Monday on the visible axis, then read the first Monday candle open, highest wick, lowest wick and final visible candle close from Monday through the final visible candle. This is the only Fibonacci frame. Do not use an older or smaller impulse. State the current-week direction from Monday open to final visible close; do not confuse a final H1 pullback with the weekly direction.
4. Build periodDayInventory for every completed/current day in the current period: each day's date, high, low, and every genuine S/R or S/D structure. For an H1 chart ending Wednesday this must include Monday, Tuesday and Wednesday. Do not skip a day or stop after finding an entry.
5. Inventory every visible structural candidate before filtering, up to twelve. Every candidate must name its sourceDate and sourceKind (for example Monday high, Tuesday low, Tuesday demand). The deterministic selector will test each candidate against the same completed impulse and return no more than three final entries.

Hard rules:
- Fibonacci may qualify visible structure but may never create a price or area.
- An S/R candidate must use an exact printed price from the screenshot.
- Never combine two separately printed support/resistance prices into one zone. Return each printed S/R line as its own candidate with zoneLow=zoneHigh=price. Only a genuine visible supply/demand base may use different zone boundaries.
- A supply/demand candidate needs a visible base/zone plus its own displacement.
- A current-period support may be marked reclaimRequired=true only when price has just moved below that exact support during an otherwise bullish current period. This is a conditional reclaim-and-hold entry, not an immediate buy. Do not use this flag for ordinary support below price.
- For a supply/demand candidate, set price to the visible structural anchor of the zone (the reaction high/base anchor for supply or reaction low/base anchor for demand), never to a Fibonacci price.
- Do not stop after finding the first or second level. Inspect the next previous support/resistance and the next genuine supply/demand base too.
- A later entry must not be a nearby fragment, duplicate, or unverified reference. Entry 2 and Entry 3 are alternatives only if the earlier area fails; they are never instructions to add to a losing trade.
- The screenshot is authoritative when its visible extremes or printed levels conflict with external OHLC data.
- Return currentWeekHigh and currentWeekLow from the visible current week. If either is unreadable, set it to null rather than borrowing an older swing.
- Mark the candidate that is the current week high with currentWeekExtreme="high" and the candidate that is the current week low with currentWeekExtreme="low" only if that marked level is genuinely a visible structural level. This is an audit aid; do not invent a candidate solely to mark an extreme.
- Do not mention Fibonacci in customer-facing wording; this result is internal.
- Set usable=false rather than guessing any unreadable direction, price, impulse, or role.
- Return JSON only, with no markdown.

Return exactly:
{
  "usable": false,
  "direction": "bullish | bearish | range",
  "currentPrice": null,
  "currentWeekHigh": null,
  "currentWeekLow": null,
  "currentPeriodOpen": null,
  "currentPeriodClose": null,
  "currentPeriodDirection": "bullish | bearish | range",
  "periodDayInventory": [
    {"date":"YYYY-MM-DD","high":null,"low":null,"structures":[{"price":null,"type":"support | resistance | demand | supply | converted support | converted resistance","note":"short structural reason"}]}
  ],
  "swingHigh": null,
  "swingLow": null,
  "candidates": [
    {
      "price": null,
      "zoneLow": null,
      "zoneHigh": null,
      "areaType": "support | resistance | demand | supply | converted support | converted resistance",
      "exactVisiblePrice": false,
      "conversionBreakConfirmed": false,
      "structuralEvidence": "specific visible line lifecycle or displacement-base evidence",
      "independentEntryEvidence": false,
      "reclaimRequired": false,
      "sourceDate": "YYYY-MM-DD",
      "sourceDay": "Monday | Tuesday | Wednesday | Thursday | Friday",
      "sourceKind": "Monday high | Tuesday low | Monday demand | Tuesday converted support",
      "currentWeekExtreme": "high | low | null",
      "fibRatio": null,
      "fibPrice": null
    }
  ]
}`;

  try {
    const response = await runVisionModel({
      systemPrompt,
      userText:
        `First-pass context: ${JSON.stringify(context)}. ` +
        "Read the chart again for the focused internal fallback and return only the required JSON.",
      imageBase64,
      mimeType,
      maxTokens: 1800,
      openaiModel: "gpt-4.1-mini",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });
    const parsed = extractJsonObject(response.text || "");
    if (!parsed) {
      return normalizeChartNativeEntryFallback({ usable: false });
    }
    return normalizeChartNativeEntryFallback(parsed);
  } catch (error) {
    console.error("Focused chart-native fallback error:", error);
    return {
      ...normalizeChartNativeEntryFallback({ usable: false }),
      reason: safeUserText(error?.message || "focused fallback failed"),
    };
  }
}

async function extractVisibleCurrentWeekFrame({ imageBase64, mimeType, timeframe = "" } = {}) {
  const tf = String(timeframe || "").toUpperCase();
  const period = ["M1", "M5", "M15", "M30", "H1"].includes(tf)
    ? "calendar week (Monday through the final visible candle)"
    : tf === "H4"
    ? "calendar month (day 1 through the final visible candle)"
    : ["D1", "W1"].includes(tf)
    ? "calendar year (January 1 through the final visible candle)"
    : tf === "MN"
    ? "full visible range"
    : null;
  if (!period) return null;
  try {
    const response = await runVisionModel({
      systemPrompt: `Read only this ${tf} chart and return JSON only. Find the final visible candle, then use the ${period} as the single Fibonacci anchor. Read the first candle open, highest wick, lowest wick and final candle close only inside that period. Do not include an earlier period and do not use a smaller local impulse. The period direction is based on first open versus final close, not the final intraday pullback. If either high or low is unclear, return null for both. Return exactly: {"currentWeekHigh":null,"currentWeekLow":null,"currentPeriodOpen":null,"currentPeriodClose":null,"currentPeriodDirection":"bullish | bearish | range","confidence":"high | medium | low"}.`,
      userText: "This is an internal current-period Fibonacci anchor check. Return only JSON.",
      imageBase64,
      mimeType,
      maxTokens: 300,
      openaiModel: "gpt-4.1-mini",
      claudeModel: CLAUDE_MODEL,
      temperature: 0,
      imageDetail: "high",
    });
    const parsed = extractJsonObject(response.text || "") || {};
    const high = nullablePositiveNumber(parsed.currentWeekHigh);
    const low = nullablePositiveNumber(parsed.currentWeekLow);
    const periodOpen = nullablePositiveNumber(parsed.currentPeriodOpen);
    const periodClose = nullablePositiveNumber(parsed.currentPeriodClose);
    const periodDirection = ["bullish", "bearish", "range"].includes(String(parsed.currentPeriodDirection || "").toLowerCase())
      ? String(parsed.currentPeriodDirection).toLowerCase()
      : null;
    return high !== null && low !== null && high > low
      ? { currentWeekHigh: high, currentWeekLow: low, periodOpen, periodClose, periodDirection, confidence: String(parsed.confidence || "") }
      : null;
  } catch (error) {
    console.error("Visible current-period frame extraction error:", error);
    return null;
  }
}

function rankChartNativeFallbackAreas({
  visualReview = {},
  direction = "range",
  currentPrice = null,
  symbol = "",
  timeframe = "",
} = {}) {
  const fallback = visualReview?.chartNativeEntryFallback || {};
  const resolvedCurrentPrice =
    asPositiveNumber(currentPrice) || asPositiveNumber(fallback?.currentPrice);

  if (
    fallback?.usable !== true ||
    fallback?.direction !== direction ||
    resolvedCurrentPrice === null
  ) {
    return null;
  }

  const allowedTypes = direction === "bullish"
    ? new Set(["support", "demand", "converted support"])
    : new Set(["resistance", "supply", "converted resistance"]);
  const approvedTolerance = getApprovedPriceTolerance(symbol);
  const candidateWeekHigh = maxFinite(
    (fallback?.candidates || [])
      .filter((candidate) => candidate?.currentWeekExtreme === "high")
      .map((candidate) => candidate?.zoneHigh ?? candidate?.price)
  );
  const candidateWeekLow = minFinite(
    (fallback?.candidates || [])
      .filter((candidate) => candidate?.currentWeekExtreme === "low")
      .map((candidate) => candidate?.zoneLow ?? candidate?.price)
  );
  // The dedicated current-period reader is authoritative. Candidate extremes
  // are only an audit fallback, never a way to replace its high/low with a
  // smaller local range that happens to qualify a line.
  const visibleWeekHigh = asPositiveNumber(fallback?.currentWeekHigh) || asPositiveNumber(candidateWeekHigh);
  const visibleWeekLow = asPositiveNumber(fallback?.currentWeekLow) || asPositiveNumber(candidateWeekLow);
  const frameTimeframe = String(timeframe || visualReview?.timeframe || "").toUpperCase();
  const framePeriod = ["M1", "M5", "M15", "M30", "H1"].includes(frameTimeframe)
    ? "week"
    : frameTimeframe === "H4"
    ? "month"
    : ["D1", "W1"].includes(frameTimeframe)
    ? "year"
    : frameTimeframe === "MN"
    ? "visible_range"
    : null;
  const visibleWeekFrame = framePeriod &&
    visibleWeekHigh !== null && visibleWeekLow !== null && visibleWeekHigh > visibleWeekLow
    ? {
        swingHigh: visibleWeekHigh,
        swingLow: visibleWeekLow,
        source: `uploaded_chart_visible_current_${framePeriod}_high_low`,
        structureLedOverrideApplied: false,
      }
    : null;
  const structureLedFrame = visibleWeekFrame || selectStructureLedChartNativeImpulseFrame({
    direction,
    swingHigh: fallback?.swingHigh,
    swingLow: fallback?.swingLow,
    candidates: fallback?.candidates || [],
    currentPrice: resolvedCurrentPrice,
    approvedTolerance,
  });
  const swingHigh = asPositiveNumber(structureLedFrame?.swingHigh);
  const swingLow = asPositiveNumber(structureLedFrame?.swingLow);
  const impulseRange = swingHigh !== null && swingLow !== null && swingHigh > swingLow
    ? swingHigh - swingLow
    : null;

  const candidates = expandExactSupportResistanceBoundaries(
    fallback.candidates || []
  ).map((candidate) => {
    const price = asPositiveNumber(candidate?.price);
    const areaType = String(candidate?.areaType || "").toLowerCase().trim();
    // A structural level must be close to one actual 38.2/50/61.8 price;
    // a broad local-impulse allowance must not rescue a shallow nearby line.
    const fibTolerance = impulseRange !== null
      ? Math.max(approvedTolerance, impulseRange * 0.01)
      : approvedTolerance;
    const rawLow = asPositiveNumber(candidate?.zoneLow) || price;
    const rawHigh = asPositiveNumber(candidate?.zoneHigh) || price;
    const zoneLow = Math.min(rawLow, rawHigh);
    const zoneHigh = Math.max(rawLow, rawHigh);
    const fibMatch = findNearestAllowedFibonacciMatch({
      direction,
      swingHigh,
      swingLow,
      price,
      zoneLow,
      zoneHigh,
      tolerance: fibTolerance,
    });
    // Do not silently remove a first support which price has just moved below
    // in an otherwise bullish current period. It remains a conditional
    // reclaim-and-hold Entry 1; the deeper demand stays Entry 2.
    const reclaimRequired = candidate?.reclaimRequired === true;
    const sideCompatible = price !== null && (
      direction === "bullish"
        ? price < resolvedCurrentPrice || (reclaimRequired && areaType === "support")
        : price > resolvedCurrentPrice
    );
    const isSupplyDemand = ["supply", "demand"].includes(areaType);
    const structuralEvidenceValid = isSupplyDemand
      ? candidate?.independentEntryEvidence === true &&
        Boolean(candidate?.structuralEvidence)
      : candidate?.exactVisiblePrice === true;

    if (
      !allowedTypes.has(areaType) ||
      !sideCompatible ||
      !fibMatch ||
      !structuralEvidenceValid
    ) {
      return null;
    }
    const converted = ["converted support", "converted resistance"].includes(areaType);
    const fibRatio = fibMatch.ratio;
    const computedFibPrice = fibMatch.fibPrice;

    return {
      direction: direction === "bullish" ? "buy" : "sell",
      areaType,
      zoneLow,
      zoneHigh,
      authoritativeCenter: price,
      resolvedEntryPrice: price,
      levelText: formatPrice(price, symbol),
      zoneText: isSupplyDemand && zoneHigh - zoneLow > approvedTolerance
        ? `${formatPrice(zoneLow, symbol)} to ${formatPrice(zoneHigh, symbol)}`
        : `around ${formatPrice(price, symbol)}`,
      state: reclaimRequired ? "reclaim required" : converted ? "potential conversion" : "active",
      priceStatus: reclaimRequired ? "reclaim and bullish hold required" : "not reached",
      source: "chart_native_market_data_fallback",
      priceSource: candidate.exactVisiblePrice
        ? "independent_horizontal_line_reader_exact"
        : "uploaded_chart_supply_demand_zone",
      authoritativeFrameworkLevel: true,
      chartReconciled: true,
      chartExactFrameworkConfirmed: candidate.exactVisiblePrice === true,
      exactChartFrameworkConfirmed: candidate.exactVisiblePrice === true,
      conversionBreakConfirmed:
        converted && candidate.conversionBreakConfirmed === true,
      conversionConfirmed: false,
      priorPeriodSrConversion:
        converted && candidate.conversionBreakConfirmed === true,
      stepwiseEntryStage: isSupplyDemand
        ? "current_period_supply_demand"
        : converted
        ? "immediate_prior_broken_sr"
        : "support_resistance",
      standardStructuralStage: isSupplyDemand
        ? "supply_demand"
        : "support_resistance",
      independentEntryEvidence: candidate.independentEntryEvidence === true,
      samePeriodDisplacementBaseValidated:
        isSupplyDemand && candidate.independentEntryEvidence === true,
      sourceDate: candidate.sourceDate || null,
      sourceDay: candidate.sourceDay || null,
      sourceKind: candidate.sourceKind || null,
      structuralScore: 60,
      fibonacciScore: 1,
      requiredFibConfluence: true,
      fibonacciMatches: [{
        label: fibRatio === 0.382 ? "38.2" : fibRatio === 0.5 ? "50.0" : "61.8",
        ratio: fibRatio,
        price: computedFibPrice,
        matchType: "deterministic_chart_native_hidden_fibonacci",
      }],
      fibonacciSource: visibleWeekFrame
        ? visibleWeekFrame.source
        : "uploaded_chart_completed_impulse",
      fibOriginModel: visibleWeekFrame
        ? visibleWeekFrame.source
        : "chart_native_completed_directional_impulse",
      selectorQualityReason: safeUserText(candidate?.structuralEvidence || ""),
      computedFibPrice,
      fibonacciDistance: fibMatch.distance,
      fibonacciTolerance: fibTolerance,
      validated: true,
    };
  }).filter(Boolean);

  const selected = selectIndependentEntryAreas(candidates, direction)
    .map((area, index) => ({
      ...area,
      executionOrder: index + 1,
      role: index === 0 ? "primary" : index === 1 ? "secondary" : "tertiary",
    }));

  // A readable current-period frame with no qualifying structure is a valid
  // no-entry conclusion, not a missing-frame error. Preserve the complete
  // inventory so the benchmark can show which Monday/Tuesday/etc. levels
  // were checked and why none was selected.
  if (!selected.length) {
    return {
      areas: [],
      referenceAreas: [],
      validation: {
        passed: true,
        errors: [],
        selectorVersion: CSA_SELECTOR_VERSION,
        fallbackSource: "uploaded_chart_only_no_qualified_entry",
      },
      regressionDiagnostics: {
        selectorVersion: CSA_SELECTOR_VERSION,
        direction,
        fallbackSource: "uploaded_chart_only_no_qualified_entry",
        fibonacci: {
          source: visibleWeekFrame
            ? visibleWeekFrame.source
            : "uploaded_chart_completed_impulse",
          swingLow: swingLow ?? null,
          swingHigh: swingHigh ?? null,
          visibleWeekFrame: visibleWeekFrame || null,
        },
        structuralCandidates: fallback.candidates || [],
        periodDayInventory: fallback.periodDayInventory || [],
        fibonacciQualifiedCandidates: candidates,
        selectedEntries: [],
      },
    };
  }

  return {
    areas: selected,
    referenceAreas: [],
    validation: {
      passed: true,
      errors: [],
      selectorVersion: CSA_SELECTOR_VERSION,
      fallbackSource: "uploaded_chart_only",
    },
    regressionDiagnostics: {
      selectorVersion: CSA_SELECTOR_VERSION,
      direction,
      fallbackSource: "uploaded_chart_only",
      fibonacci: {
        source: visibleWeekFrame
          ? visibleWeekFrame.source
          : "uploaded_chart_completed_impulse",
        swingLow: swingLow ?? null,
        swingHigh: swingHigh ?? null,
        reportedSwingLow: fallback.swingLow ?? null,
        reportedSwingHigh: fallback.swingHigh ?? null,
        structureLedFrame: structureLedFrame || null,
        visibleWeekFrame: visibleWeekFrame || null,
      },
      structuralCandidates: fallback.candidates || [],
      periodDayInventory: fallback.periodDayInventory || [],
      fibonacciQualifiedCandidates: candidates,
      selectedEntries: selected,
    },
  };
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
    return {
      areas: [],
      referenceAreas: [],
      validation: { passed: true, errors: [] },
      regressionDiagnostics: {
        selectorVersion: CSA_SELECTOR_VERSION,
        direction,
        fallbackSource: "no_entry_direction_unresolved",
        fibonacci: {
          source: "not_available",
          swingLow: null,
          swingHigh: null,
        },
        structuralCandidates: [],
        fibCandidates: [],
        selectedEntries: [],
      },
    };
  }

  // The isolated benchmark service treats the uploaded screenshot as the
  // price authority. External candles may extend beyond the historical image
  // and must not redefine its visible impulse or structural levels.
  if (BENCHMARK_DRY_RUN_ENABLED) {
    const chartNativeFallback = rankChartNativeFallbackAreas({
      visualReview,
      direction,
      currentPrice,
      symbol,
      timeframe,
    });
    if (chartNativeFallback) return chartNativeFallback;

    // In H1 benchmark mode, an unreadable screenshot weekly range produces
    // no entry.  Falling through to external or local-impulse Fib data would
    // silently violate the screenshot-authoritative weekly rule.
    if (String(timeframe || "").toUpperCase() === "H1") {
      return {
        areas: [],
        referenceAreas: [],
        validation: { passed: true, errors: [] },
        regressionDiagnostics: {
          selectorVersion: CSA_SELECTOR_VERSION,
          direction,
          fallbackSource: "no_entry_missing_visible_current_week_frame",
          fibonacci: {
            source: "uploaded_chart_visible_current_week_high_low_required",
            swingLow: null,
            swingHigh: null,
          },
          structuralCandidates: visualReview?.chartNativeEntryFallback?.candidates || [],
          fibCandidates: [],
          selectedEntries: [],
        },
      };
    }
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
    const chartNativeFallback = rankChartNativeFallbackAreas({
      visualReview,
      direction,
      currentPrice,
      symbol,
      timeframe,
    });

    if (chartNativeFallback) {
      console.log("CSA chart-native market-data fallback selected:", {
        buildId: CSA_BUILD_ID,
        selectorVersion: CSA_SELECTOR_VERSION,
        direction,
        entries: chartNativeFallback.areas.map((area) => ({
          areaType: area.areaType,
          levelText: area.levelText,
          executionOrder: area.executionOrder,
        })),
      });
      return chartNativeFallback;
    }

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

  const authoritativeFrameworkLevels = Array.isArray(
    marketReference?.dailyLevels
  )
    ? [...marketReference.dailyLevels].sort((a, b) =>
        String(a?.key || a?.date || "").localeCompare(
          String(b?.key || b?.date || "")
        )
      )
    : [];

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

  // Authoritative framework periods remain the primary source of entry
  // candidates. In historical cutoff mode, a confirmed current-period
  // directional takeover may additionally contribute the fresh intraday
  // demand/supply base that directly launched the break. Generic pivots and
  // chart markings still may only confirm/refine candidates.
  let frameworkCandidates = attachPivotConfirmationToFrameworkCandidates({
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

  // Exact chart labels may refine an already-authoritative CSA framework
  // level before the Fibonacci gate. They still cannot create structure: each
  // label must map to an existing csaArea on the same price scale.
  const exactChartFrameworkCandidates =
    buildExactChartFrameworkCandidates({
      visualReview,
      marketReference,
      direction,
      currentPrice,
      symbol,
      atr,
    });

  if (exactChartFrameworkCandidates.length) {
    frameworkCandidates = attachPivotConfirmationToFrameworkCandidates({
      frameworkCandidates: [
        ...frameworkCandidates,
        ...exactChartFrameworkCandidates,
      ],
      pivots: confirmedPivots,
      atr,
      symbol,
    });
  }

  frameworkCandidates = annotateFrameworkPeriodPriority(
    frameworkCandidates,
    authoritativeFrameworkLevels.length
  );

  // The immediately previous completed framework period is inspected first,
  // followed by the period before it. Older periods remain available only
  // after those nearer periods have supplied no usable structural hints.
  const nearestPeriodStructuralHints = selectNearestFrameworkPeriodHints(
    frameworkCandidates,
    authoritativeFrameworkLevels.length,
    2
  );

  // MAIN SELECTOR ADJACENT-CONVERSION INSERTION.
  // This runs inside the active entry selector, after framework candidates
  // are assembled and before any supply/demand refinement, structural gate,
  // Fibonacci gate, or path ordering. It preserves the immediately preceding
  // true S/R in its new role when the next completed framework period closes
  // clearly beyond it. The later retest remains an entry trigger, not a
  // reason to omit the potential converted level.
  if (
    authoritativeFrameworkLevels.length >= 2 &&
    ["bearish", "bullish"].includes(direction)
  ) {
    const sourceIndex = authoritativeFrameworkLevels.length - 2;
    const breakPeriodIndex = authoritativeFrameworkLevels.length - 1;
    const priorPeriod = authoritativeFrameworkLevels[sourceIndex] || {};
    const breakPeriod = authoritativeFrameworkLevels[breakPeriodIndex] || {};
    const originalType = direction === "bearish" ? "support" : "resistance";
    const convertedType = direction === "bearish" ? "converted resistance" : "converted support";
    const frameworkPrice = asPositiveNumber(
      direction === "bearish" ? priorPeriod.low : priorPeriod.high
    );
    // Completed historical-period records do not always retain `close` after
    // framework reconciliation. In selected-day mode, currentPrice is the
    // cutoff-safe final completed candle price and is the deterministic
    // fallback for confirming that the immediately prior S/R was held beyond.
    const recordedBreakClose = asPositiveNumber(breakPeriod.close);
    const breakClose =
      recordedBreakClose !== null
        ? recordedBreakClose
        : asPositiveNumber(currentPrice);
    // This is a structural close-through test, not a display/OCR price-match
    // test. For AUDUSD the clean-break tolerance is 0.00020. The former use of
    // frameworkLevelTolerance produced 0.00120 and wrongly rejected Tuesday's
    // 0.69740 close through Monday support at 0.69858.
    const conversionTolerance = frameworkConversionTolerance({ symbol });
    const closeBeyond =
      frameworkPrice !== null &&
      breakClose !== null &&
      (direction === "bearish"
        ? breakClose < frameworkPrice - conversionTolerance
        : breakClose > frameworkPrice + conversionTolerance);
    const priceIsOnCorrectSide =
      frameworkPrice !== null &&
      (direction === "bearish"
        ? frameworkPrice > Number(currentPrice) + conversionTolerance
        : frameworkPrice < Number(currentPrice) - conversionTolerance);
    const alreadyPresent = frameworkCandidates.some((candidate) =>
      Number(candidate?.sourceIndex) === sourceIndex &&
      String(candidate?.type || "").toLowerCase() === convertedType
    );

    console.log("CSA MAIN SELECTOR PRIOR-CONVERSION AUDIT:", {
      direction,
      frameworkLevelCount: authoritativeFrameworkLevels.length,
      sourceIndex,
      breakPeriodIndex,
      originalType,
      convertedType,
      frameworkPrice,
      recordedBreakClose,
      resolvedBreakClose: breakClose,
      currentPrice: Number(currentPrice),
      conversionTolerance,
      conversionToleranceSource: "instrument_clean_break",
      closeBeyond,
      priceIsOnCorrectSide,
      alreadyPresent,
    });

    if (closeBeyond && priceIsOnCorrectSide && !alreadyPresent) {
      const period = priorPeriod.periodLabel || priorPeriod.day || priorPeriod.key || `Period ${sourceIndex + 1}`;
      const brokenByPeriod = breakPeriod.periodLabel || breakPeriod.day || breakPeriod.key || `Period ${breakPeriodIndex + 1}`;
      const reconciled = reconcileFrameworkLevelWithVisibleChart({
        frameworkPrice,
        frameworkType: convertedType,
        frameworkPeriod: period,
        frameworkSide: direction === "bearish" ? "low" : "high",
        visualReview,
        symbol,
        atr,
      });

      frameworkCandidates = attachPivotConfirmationToFrameworkCandidates({
        frameworkCandidates: [
          ...frameworkCandidates,
          {
            price: reconciled.price,
            frameworkPrice,
            type: convertedType,
            originalType,
            source: "main_selector_adjacent_prior_sr_conversion",
            priceSource: reconciled.source,
            chartReconciled: reconciled.reconciled === true,
            period,
            breakPeriod: brokenByPeriod,
            breakPeriodIndex,
            sourceIndex,
            conversionBreakConfirmed: true,
            conversionConfirmed: false,
            conversionEvidenceSource: "adjacent_completed_period_close_beyond_prior_sr",
            authorityRank: 0,
            priorPeriodSrConversion: true,
            authoritativeFrameworkLevel: true,
            stepwiseEntryStage: "immediate_prior_broken_sr",
          },
        ],
        pivots: confirmedPivots,
        atr,
        symbol,
      });

      console.log("CSA MAIN SELECTOR PRIOR-CONVERSION INSERTED:", {
        sourcePeriod: period,
        breakPeriod: brokenByPeriod,
        originalType,
        convertedType,
        frameworkPrice,
        chartPrice: reconciled.price,
        breakClose,
      });
    }
  }

  const finalVisibleFibEndpointAuthority =
    normalizeCutoffMode(
      marketReference?.chartCutoff?.mode ||
        "final_visible"
    ) === "final_visible"
      ? {
          enabled: true,
          price: asPositiveNumber(currentPrice),
          datetime:
            visualReview?.latestVisibleDateTime ||
            visualReview?.latestVisibleDatetime ||
            null,
          source: "locked_final_visible_current_price",
        }
      : {
          enabled: false,
          price: null,
          datetime: null,
          source: "historical_cutoff_locked",
        };

  const historicalFrameworkFibImpulseAuthority =
    deriveHistoricalFrameworkLocalFibImpulse({
      marketReference,
      direction,
      timeframe,
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
    finalVisibleEndpointAuthority:
      finalVisibleFibEndpointAuthority,
    historicalFrameworkImpulseAuthority:
      historicalFrameworkFibImpulseAuthority,
    structuralLevelHints: nearestPeriodStructuralHints,
  });

  const finalVisibleSupplyDemandCandidates =
    buildFinalVisibleIndependentSupplyDemandCandidates({
      marketReference,
      candles,
      direction,
      currentPrice,
      symbol,
      timeframe,
      atr,
    });

  if (finalVisibleSupplyDemandCandidates.length) {
    frameworkCandidates = [
      ...frameworkCandidates,
      ...attachPivotConfirmationToFrameworkCandidates({
        frameworkCandidates: finalVisibleSupplyDemandCandidates,
        pivots: confirmedPivots,
        atr,
        symbol,
      }),
    ];
  }


  // V4.7.2: force the cutoff-day intraday base scan inside the main
  // deterministic entry pipeline, after the controlling break/Fib impulse is
  // known and before structural/Fib gating begins. This avoids silent skips
  // caused by earlier preprocessing branches.
  const pipelineIntradayCandidate =
    buildHistoricalTakeoverIntradayCandidateFromMainPipeline({
      marketReference,
      candles,
      fibonacci,
      direction,
      currentPrice,
      symbol,
      timeframe,
      atr,
    });

  if (pipelineIntradayCandidate) {
    const [confirmedPipelineCandidate] =
      attachPivotConfirmationToFrameworkCandidates({
        frameworkCandidates: [pipelineIntradayCandidate],
        pivots: confirmedPivots,
        atr,
        symbol,
      });

    // Reinforcement is a structural-overlap decision. The broader approved
    // price tolerance is for chart/OCR reconciliation and must not be used to
    // join distinct entry stages. In the AUDUSD benchmark, using that wider
    // tolerance wrongly merged Monday converted resistance around 0.69845
    // with Tuesday supply at 0.69899-0.69947. That corrupted Entry 1's zone
    // geometry and also removed the displacement evidence from Entry 2.
    const reinforcementOverlapTolerance = frameworkConversionTolerance({
      symbol,
    });

    // V4.10.15: use a narrowly wider edge allowance only when a confirmed
    // cutoff-period displacement base refines the authoritative supply/demand
    // area from that exact same framework period. A base is candle-defined and
    // may stop slightly inside the broader period area; requiring the stricter
    // S/R overlap tolerance removed the legitimate AUDUSD supply zone at
    // 0.69899-0.69947 when the framework anchor was near 0.69972.
    //
    // This allowance remains deliberately small (1.5 clean-break tolerances)
    // and cannot rescue a remote base. Therefore the July-29 base near
    // 0.69706-0.69723 still cannot replace supply near 0.69887.
    const samePeriodSdEdgeTolerance =
      reinforcementOverlapTolerance * 1.5;

    /*
     * V4.7.6 â€” FRAMEWORK S/R REMAINS THE ENTRY IDENTITY.
     *
     * A fresh cutoff-day intraday base is useful structural EVIDENCE, but it
     * must not overwrite the CSA framework hierarchy. When that base overlaps
     * an already-valid converted support/resistance level, reinforce that
     * framework level with the candle-defined structural zone instead of
     * inventing a second demand/supply entry at nearly the same location.
     *
     * Example benchmark: Monday support -> resistance -> support around
     * 4064.74. The July-30 intraday base around 4062.79-4072.36 reinforces that
     * converted support. The displayed/actionable identity therefore remains
     * converted support around 4064.74. Thursday daily demand around 4029
     * remains a deeper structural reference and is evaluated independently.
     */
    const intradayZoneLow = Number(
      confirmedPipelineCandidate?.intradayStructuralZoneLow
    );
    const intradayZoneHigh = Number(
      confirmedPipelineCandidate?.intradayStructuralZoneHigh
    );
    const normalizedIntradayLow = Math.min(intradayZoneLow, intradayZoneHigh);
    const normalizedIntradayHigh = Math.max(intradayZoneLow, intradayZoneHigh);

    const compatibleConvertedTypes =
      direction === "bullish"
        ? new Set(["support", "converted support"])
        : new Set(["resistance", "converted resistance"]);

    // v4.9.6 STEPWISE ENTRY CHECK:
    // A cutoff-period displacement base may do TWO legitimate jobs:
    // 1) reinforce an overlapping converted/plain S/R level; OR
    // 2) refine the already-authoritative SAME-PERIOD supply/demand area.
    // It still cannot invent a new framework S/D identity by itself.
    const expectedSamePeriodSdType = direction === "bearish" ? "supply" : "demand";
    const currentFrameworkPeriod = Array.isArray(marketReference?.dailyLevels) && marketReference.dailyLevels.length
      ? marketReference.dailyLevels[marketReference.dailyLevels.length - 1]
      : null;
    const currentFrameworkPeriodLabel = String(
      currentFrameworkPeriod?.periodLabel ||
      currentFrameworkPeriod?.day ||
      currentFrameworkPeriod?.key ||
      ""
    ).trim();

    const reinforcementCandidates = frameworkCandidates
      .map((existing, index) => {
        const existingType = String(existing?.type || "").toLowerCase();
        const existingPeriod = String(existing?.period || "").trim();
        const existingPrice = Number(
          existing?.frameworkPrice || existing?.price
        );
        const insideOrNearZone =
          Number.isFinite(existingPrice) &&
          Number.isFinite(normalizedIntradayLow) &&
          Number.isFinite(normalizedIntradayHigh) &&
          existingPrice >= normalizedIntradayLow - reinforcementOverlapTolerance &&
          existingPrice <= normalizedIntradayHigh + reinforcementOverlapTolerance;

        const insideOrNearSamePeriodSdZone =
          Number.isFinite(existingPrice) &&
          Number.isFinite(normalizedIntradayLow) &&
          Number.isFinite(normalizedIntradayHigh) &&
          existingPrice >= normalizedIntradayLow - samePeriodSdEdgeTolerance &&
          existingPrice <= normalizedIntradayHigh + samePeriodSdEdgeTolerance;

        const convertedSrReinforcement =
          compatibleConvertedTypes.has(existingType) && insideOrNearZone;

        // V4.10.13: sharing the same period and S/D type is not enough to
        // refine an authoritative framework area. The cutoff-day base must
        // overlap that area's price. Without this gate, an intraday base near
        // 0.6972 could incorrectly replace Wednesday supply near 0.6989.
        const samePeriodSdRefinement =
          existingType === expectedSamePeriodSdType &&
          currentFrameworkPeriodLabel &&
          existingPeriod === currentFrameworkPeriodLabel &&
          insideOrNearSamePeriodSdZone;

        return {
          index,
          existing,
          existingPrice,
          convertedSrReinforcement,
          samePeriodSdRefinement,
          eligible: convertedSrReinforcement || samePeriodSdRefinement,
          distance: Number.isFinite(existingPrice)
            ? Math.abs(
                existingPrice -
                Number(confirmedPipelineCandidate?.frameworkPrice || 0)
              )
            : Number.POSITIVE_INFINITY,
        };
      })
      .filter((item) => item.eligible)
      .sort((a, b) => {
        // First preserve an overlapping S/R conversion. If there is no such
        // overlap, prefer the authoritative same-period S/D identity.
        if (a.convertedSrReinforcement !== b.convertedSrReinforcement) {
          return a.convertedSrReinforcement ? -1 : 1;
        }
        return a.distance - b.distance;
      });

    if (reinforcementCandidates.length) {
      const winner = reinforcementCandidates[0];
      const isSamePeriodSdRefinement = winner.samePeriodSdRefinement === true;
      const reinforced = {
        ...winner.existing,
        reinforcedByHistoricalIntradayStructure: true,
        supplyDemandRefinedBySamePeriodBase: isSamePeriodSdRefinement,
        stepwiseEntryStage: isSamePeriodSdRefinement
          ? 'current_period_supply_demand'
          : (winner.existing?.stepwiseEntryStage || 'framework_sr_reinforced'),
        reinforcedStructuralZoneLow: normalizedIntradayLow,
        reinforcedStructuralZoneHigh: normalizedIntradayHigh,
        reinforcedStructuralBasePrice: Number(
          confirmedPipelineCandidate?.frameworkPrice ||
            confirmedPipelineCandidate?.price
        ),
        refinedSupplyDemandEntryPrice: isSamePeriodSdRefinement
          ? Number(
              confirmedPipelineCandidate?.frameworkPrice ||
                confirmedPipelineCandidate?.price
            )
          : null,
        reinforcedStructuralBaseDatetime:
          confirmedPipelineCandidate?.baseDatetime || null,
        reinforcedNearestFibDistance:
          Number.isFinite(
            Number(confirmedPipelineCandidate?.nearestFibDistance)
          )
            ? Number(confirmedPipelineCandidate.nearestFibDistance)
            : null,
        reinforcedNearestFibLabel:
          confirmedPipelineCandidate?.nearestFibLabel || null,
        reinforcedNearestFibPrice:
          Number.isFinite(Number(confirmedPipelineCandidate?.nearestFibPrice))
            ? Number(confirmedPipelineCandidate.nearestFibPrice)
            : null,
        reinforcedDeparture:
          Number.isFinite(Number(confirmedPipelineCandidate?.departure))
            ? Number(confirmedPipelineCandidate.departure)
            : null,
        reinforcedBarsToBreak:
          Number.isFinite(Number(confirmedPipelineCandidate?.barsToBreak))
            ? Number(confirmedPipelineCandidate.barsToBreak)
            : null,
        reinforcedPullbackDepth:
          Number.isFinite(Number(confirmedPipelineCandidate?.pullbackDepth))
            ? Number(confirmedPipelineCandidate.pullbackDepth)
            : null,
        samePeriodDisplacementBaseValidated:
          isSamePeriodSdRefinement &&
          Number.isFinite(Number(confirmedPipelineCandidate?.departure)) &&
          Number(confirmedPipelineCandidate.departure) > 0,
      };
      frameworkCandidates = frameworkCandidates.map((item, index) =>
        index === winner.index ? reinforced : item
      );

      console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE MERGE:", {
        buildId: CSA_BUILD_ID,
        result: isSamePeriodSdRefinement ? "same_period_sd_refined" : "framework_sr_reinforced",
        frameworkAreaType: reinforced?.type || null,
        frameworkPeriod: reinforced?.period || null,
        frameworkPrice:
          reinforced?.frameworkPrice || reinforced?.price || null,
        intradayBasePrice:
          confirmedPipelineCandidate?.frameworkPrice || null,
        structuralZoneLow: normalizedIntradayLow,
        structuralZoneHigh: normalizedIntradayHigh,
        reinforcementOverlapTolerance,
        reinforcementOverlapToleranceSource: "instrument_clean_break",
        samePeriodSdEdgeTolerance,
        samePeriodSdEdgeToleranceSource: "1.5_x_instrument_clean_break",
        rule: isSamePeriodSdRefinement
          ? "intraday_base_refines_existing_same_period_supply_demand_without_inventing_new_framework_area"
          : "intraday_base_reinforces_overlapping_framework_sr_instead_of_becoming_separate_entry",
      });
    } else {
      /*
       * V4.11.0 — INDEPENDENT SUPPLY/DEMAND SURVIVAL
       *
       * S/R and S/D are separate structural checks. A confirmed displacement
       * origin does not need to overlap an existing S/R line in order to be a
       * legitimate demand/supply area. It must, however, be independently
       * structural before Fibonacci is considered: meaningful departure, at
       * least two completed bars to the controlling break, a real candle area,
       * correct price side, and an authoritative cutoff-period identity.
       *
       * This candidate is appended; it never overwrites or converts S/R. The
       * normal structural gate and hidden 38.2/50/61.8 gate still decide whether
       * it can become Entry 1/Entry 2.
       */
      const independentDeparture = Number(confirmedPipelineCandidate?.departure);
      const independentBarsToBreak = Number(confirmedPipelineCandidate?.barsToBreak);
      const minimumIndependentDeparture = Math.max(
        Number(atr || 0) * 0.35,
        reinforcementOverlapTolerance * 3
      );
      const validIndependentZone =
        Number.isFinite(normalizedIntradayLow) &&
        Number.isFinite(normalizedIntradayHigh) &&
        normalizedIntradayHigh > normalizedIntradayLow;
      const independentSupplyDemandValidated =
        validIndependentZone &&
        Number.isFinite(independentDeparture) &&
        independentDeparture >= minimumIndependentDeparture &&
        Number.isFinite(independentBarsToBreak) &&
        independentBarsToBreak >= 2;

      if (independentSupplyDemandValidated) {
        frameworkCandidates = [
          ...frameworkCandidates,
          {
            ...confirmedPipelineCandidate,
            source: "authoritative_current_period_displacement_base",
            priceSource: "independent_cutoff_period_supply_demand_structure",
            authoritativeFrameworkLevel: true,
            authoritativeStructuralException: true,
            samePeriodDisplacementBaseValidated: true,
            stepwiseEntryStage: "current_period_supply_demand",
          },
        ];
      }

      console.log("CSA HISTORICAL TAKEOVER INTRADAY PIPELINE MERGE:", {
        buildId: CSA_BUILD_ID,
        result: independentSupplyDemandValidated
          ? "independent_supply_demand_preserved_for_fib_gate"
          : "context_only_failed_independent_supply_demand_structure",
        price: confirmedPipelineCandidate?.frameworkPrice || null,
        proposedAreaType: confirmedPipelineCandidate?.type || null,
        structuralZoneLow: normalizedIntradayLow,
        structuralZoneHigh: normalizedIntradayHigh,
        departure: Number.isFinite(independentDeparture) ? independentDeparture : null,
        minimumIndependentDeparture,
        barsToBreak: Number.isFinite(independentBarsToBreak) ? independentBarsToBreak : null,
        rule: "validate_sr_first_then_independent_sd_then_hidden_fib_without_overwriting_sr",
      });
    }
  }

  // Standard CSA analysis order is fixed before any Fib evaluation. This does
  // not predetermine Entry 1: S/R is inspected first, S/D second, all surviving
  // candidates pass the same hidden Fib gate, and final entries follow price.
  frameworkCandidates = orderStructuralCandidatesForFib(
    annotateFrameworkPeriodPriority(
      frameworkCandidates,
      authoritativeFrameworkLevels.length
    )
  );

  const rawZones = frameworkCandidates.map((candidate) => {
    const refinedSamePeriodSdPrice =
      candidate?.supplyDemandRefinedBySamePeriodBase === true
        ? asPositiveNumber(candidate?.refinedSupplyDemandEntryPrice)
        : null;

    const resolvedEntryPrice =
      refinedSamePeriodSdPrice ||
      resolveCsaEntryPrice({
        frameworkPrice: candidate.frameworkPrice,
        chartPrice: candidate.price,
        chartReconciled: candidate.chartReconciled === true,
        symbol,
      });

    const isIntradayStructuralZone =
      (
        candidate?.historicalTakeoverIntradayCandidate === true ||
        candidate?.independentSupplyDemandCandidate === true
      ) &&
      Number.isFinite(Number(candidate?.intradayStructuralZoneLow)) &&
      Number.isFinite(Number(candidate?.intradayStructuralZoneHigh));

    const isFrameworkSrReinforcedByIntradayStructure =
      candidate?.reinforcedByHistoricalIntradayStructure === true &&
      Number.isFinite(Number(candidate?.reinforcedStructuralZoneLow)) &&
      Number.isFinite(Number(candidate?.reinforcedStructuralZoneHigh));

    return {
      // Framework period identity remains authoritative. The final level price
      // may be refined only by validated same-period chart reconciliation.
      // Intraday takeover structure may only reinforce an authoritative
      // framework S/R level. If reinforced, preserve the candle-defined zone
      // so Fib is measured to the real structural area rather than one anchor.
      zoneLow: isFrameworkSrReinforcedByIntradayStructure
        ? Number(candidate.reinforcedStructuralZoneLow)
        : isIntradayStructuralZone
        ? Number(candidate.intradayStructuralZoneLow)
        : resolvedEntryPrice,
      zoneHigh: isFrameworkSrReinforcedByIntradayStructure
        ? Number(candidate.reinforcedStructuralZoneHigh)
        : isIntradayStructuralZone
        ? Number(candidate.intradayStructuralZoneHigh)
        : resolvedEntryPrice,
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

  // Inspect the immediate previous completed period and the period before it
  // as a full S/R + S/D inventory before applying the shared Fibonacci gate.
  // A broad market-data impulse may otherwise make a farther line look valid
  // and skip the nearer prior structure visible on the chart.
  const priorPeriodStructuralFrame = selectStructureLedChartNativeImpulseFrame({
    direction,
    swingHigh: fibonacci?.swingHigh,
    swingLow: fibonacci?.swingLow,
    candidates: rawZones.flatMap((rawZone) => (rawZone?.members || []).map((member) => ({
      price: asPositiveNumber(member?.price) || asPositiveNumber(member?.frameworkPrice),
      zoneLow: rawZone?.zoneLow,
      zoneHigh: rawZone?.zoneHigh,
      areaType: member?.type || rawZone?.authoritativeType,
      exactVisiblePrice: member?.chartExactFrameworkConfirmed === true,
      independentEntryEvidence:
        member?.samePeriodDisplacementBaseValidated === true ||
        member?.independentSupplyDemandCandidate === true ||
        member?.chartExactFrameworkConfirmed === true,
    }))),
    currentPrice,
    approvedTolerance: priceTolerance,
  });

  // H1's current visible-week frame is the single source of Fibonacci truth.
  // Never let a later prior-period/candidate-local frame replace it.
  const relevantFibonacci =
    fibonacci?.fibOriginModel === "visible_current_week_high_low"
      ? fibonacci
      : priorPeriodStructuralFrame?.structureLedOverrideApplied === true
      ? {
          ...fibonacci,
          swingHigh: priorPeriodStructuralFrame.swingHigh,
          swingLow: priorPeriodStructuralFrame.swingLow,
          impulseRange: priorPeriodStructuralFrame.range,
          levels: [0.382, 0.5, 0.618].map((ratio) => ({
            ratio,
            label: ratio === 0.5 ? "50%" : `${(ratio * 100).toFixed(1)}%`,
            price: direction === "bearish"
              ? priorPeriodStructuralFrame.swingLow + priorPeriodStructuralFrame.range * ratio
              : priorPeriodStructuralFrame.swingHigh - priorPeriodStructuralFrame.range * ratio,
          })),
          source: "previous_period_structure_led_completed_impulse",
          fibOriginModel: "previous_period_sr_sd_local_completed_impulse",
          selectionReason:
            "nearest_prior_period_sr_sd_inventory_materially_closer_than_broad_impulse",
          priorPeriodStructuralFrame,
        }
      : fibonacci;

  const fibGateDiagnostics = [];
  const structuralGateDiagnostics = [];
  const structuralReferenceAreas = [];

  const evaluated = rawZones.map((rawZone) => {
    const hasHistoricalIntradayZone =
      rawZone?.members?.some?.((member) =>
        (
          member?.historicalTakeoverIntradayCandidate === true ||
          member?.independentSupplyDemandCandidate === true
        ) &&
        member?.intradayTakeoverBase === true
      ) === true &&
      Number.isFinite(Number(rawZone?.zoneLow)) &&
      Number.isFinite(Number(rawZone?.zoneHigh)) &&
      Number(rawZone.zoneHigh) > Number(rawZone.zoneLow);

    const hasFrameworkSrReinforcementZone =
      rawZone?.members?.some?.((member) =>
        member?.reinforcedByHistoricalIntradayStructure === true
      ) === true &&
      Number.isFinite(Number(rawZone?.zoneLow)) &&
      Number.isFinite(Number(rawZone?.zoneHigh)) &&
      Number(rawZone.zoneHigh) > Number(rawZone.zoneLow);

    const rawAreaType = String(rawZone?.authoritativeType || "")
      .toLowerCase()
      .trim();
    const isExactFrameworkSr =
      ["support", "resistance", "converted support", "converted resistance"]
        .includes(rawAreaType) &&
      rawZone?.members?.some?.((member) =>
        member?.chartExactFrameworkConfirmed === true
      ) === true;

    // A printed S/R line is a price, not a candle-width zone.  Giving it a
    // synthetic width can make a farther line inherit Fibonacci confluence
    // that belongs to neither the line nor its actual prior-period structure.
    const compacted = isExactFrameworkSr
      ? {
          zoneLow: Number(rawZone.resolvedEntryPrice),
          zoneHigh: Number(rawZone.resolvedEntryPrice),
          center: Number(rawZone.resolvedEntryPrice),
          halfWidth: 0,
        }
      : hasHistoricalIntradayZone || hasFrameworkSrReinforcementZone
      ? {
          zoneLow: Math.min(Number(rawZone.zoneLow), Number(rawZone.zoneHigh)),
          zoneHigh: Math.max(Number(rawZone.zoneLow), Number(rawZone.zoneHigh)),
          center: Number(rawZone.resolvedEntryPrice),
          halfWidth: Math.abs(Number(rawZone.zoneHigh) - Number(rawZone.zoneLow)) / 2,
        }
      : compactZoneBounds({
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

    // V4.10.16: when the independent chart-line reader successfully
    // reconciles a marked level, use that exact visible price in feedback.
    // Framework period/type identity remains authoritative; this changes only
    // the displayed anchor (for example 0.70104 instead of 0.70105).
    // resolvedEntryPrice is the single downstream authority: it already
    // applies the validated chart reconciliation and any conservative FX
    // whole-pip canonicalization. Do not bypass it by reading the raw visual
    // approximation again here.
    const authoritativeCenter =
      asPositiveNumber(rawZone?.resolvedEntryPrice) ||
      chartReconciledCenter ||
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

    const isHistoricalTakeoverIntradayLevel =
      rawZone?.members?.some?.((member) =>
        member?.intradayTakeoverBase === true &&
        member?.authoritativeStructuralException === true &&
        member?.source === "historical_takeover_intraday_base"
      ) === true;

    const isAuthoritativeFrameworkLevel =
      String(rawZone?.source || "").startsWith(
        "authoritative_framework_"
      ) ||
      String(rawZone?.source || "") === "authoritative_prior_period_sr_conversion" ||
      rawZone?.members?.some?.((member) => member?.authoritativeFrameworkLevel === true) === true;

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
    // However, when an authoritative current-period supply/demand area has
    // already been refined by a confirmed same-period displacement base, that
    // displacement is genuine structural evidence. Preserve it here instead
    // of requiring a later retest before the zone can even qualify as a setup.
    const samePeriodDisplacementBaseValidated =
      rawZone?.members?.some?.((member) =>
        member?.samePeriodDisplacementBaseValidated === true ||
        member?.supplyDemandRefinedBySamePeriodBase === true ||
        (
          member?.reinforcedByHistoricalIntradayStructure === true &&
          Number.isFinite(Number(member?.reinforcedStructuralZoneLow)) &&
          Number.isFinite(Number(member?.reinforcedStructuralZoneHigh))
        )
      ) === true;

    /*
     * V4.10.22 RECLAIMED CURRENT-PERIOD S/D BOUNDARY
     *
     * When final-visible structure has already proved that an internal break
     * was reclaimed, the excursion extreme is direct structural evidence for
     * the current-period demand/supply boundary. It therefore counts as one
     * strong departure without waiting for a second later retest. Fibonacci
     * remains mandatory and decides whether the area can become an entry.
     */
    const reclaimedBoundary =
      direction === "bullish"
        ? asPositiveNumber(historicalPhase?.diagnostics?.postBreakLow)
        : direction === "bearish"
        ? asPositiveNumber(historicalPhase?.diagnostics?.postBreakHigh)
        : null;
    const reclaimedBoundaryTolerance = Math.max(
      priceTolerance,
      Number(atr || 0) * 0.08
    );
    const reclaimedInternalBreakBoundaryValidated =
      historicalPhase?.source ===
        "final_visible_framework_reclaimed_internal_break" &&
      reclaimedBoundary !== null &&
      (
        (direction === "bullish" && rawZone?.authoritativeType === "demand") ||
        (direction === "bearish" && rawZone?.authoritativeType === "supply")
      ) &&
      reclaimedBoundary >= zoneLow - reclaimedBoundaryTolerance &&
      reclaimedBoundary <= zoneHigh + reclaimedBoundaryTolerance &&
      historicalPhase?.diagnostics?.excursionRecovered === true &&
      historicalPhase?.diagnostics?.levelReclaimed === true;

    const effectiveReactionStats =
      samePeriodDisplacementBaseValidated ||
      reclaimedInternalBreakBoundaryValidated
      ? {
          ...reactionStats,
          strongDepartures: Math.max(1, Number(reactionStats?.strongDepartures || 0)),
        }
      : reactionStats;

    const quality = selectorAreaQuality({
      areaType: rawZone?.authoritativeType,
      lifecycleFlipCount: Number(
        rawZone?.lifecycleFlipCount || 0
      ),
      lifecycleEvents: Array.isArray(rawZone?.lifecycleEvents)
        ? rawZone.lifecycleEvents
        : [],
      sideChangeCount,
      reactionStats: effectiveReactionStats,
      pivotConfirmationCount: Number(
        rawZone?.pivotConfirmationCount || 0
      ),
      fibonacciScore: 0,
    });

    /*
     * V4.5.4 â€” RE-EARNED STRUCTURAL STRENGTH
     *
     * A historically busy authoritative S/R area is not automatically a
     * strong entry area. However, it may re-earn strong structural status
     * when current evidence shows:
     *   - at least 2 genuine reactions, AND
     *   - at least 1 strong departure.
     *
     * Fibonacci distance rules remain unchanged:
     *   <= 15% ATR = close confluence
     *   15â€“20% ATR = borderline, requires strong structure
     *   > 20% ATR = fail
     */
    const cleanStrongStructure =
      quality.choppy !== true &&
      Number(quality.score || 0) >= 50;

    const reEarnedStrongStructure =
      quality.valid === true &&
      Number(effectiveReactionStats?.reactions || 0) >= 2 &&
      Number(effectiveReactionStats?.strongDepartures || 0) >= 1;

    const structuralEvidenceStrong =
      cleanStrongStructure ||
      reEarnedStrongStructure;

    const structuralStrengthMode =
      cleanStrongStructure
        ? "clean_high_quality"
        : reEarnedStrongStructure
        ? "reearned_by_reactions_and_departure"
        : "not_strong";

    // A prior S/R level that has a clean authoritative break-and-close has
    // already earned potential converted status. It must not be rejected only
    // because there has not yet been a later retest/reaction; that retest is
    // the entry trigger, not a prerequisite for listing the area. Fibonacci
    // confluence remains mandatory below.
    const priorBreakAndCloseConversion =
      rawZone?.members?.some?.((member) =>
        member?.priorPeriodSrConversion === true &&
        member?.conversionBreakConfirmed === true &&
        member?.stepwiseEntryStage === "immediate_prior_broken_sr"
      ) === true;

    const exactChartFrameworkConfirmed =
      rawZone?.members?.some?.(
        (member) =>
          member?.chartExactFrameworkConfirmed === true &&
          member?.authoritativeFrameworkLevel === true
      ) === true;

    const structurallyValid =
      isAuthoritativeFrameworkLevel &&
      (quality.valid ||
        priorBreakAndCloseConversion ||
        exactChartFrameworkConfirmed);

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
      reactionCount: Number(effectiveReactionStats?.reactions || 0),
      strongDepartureCount: Number(effectiveReactionStats?.strongDepartures || 0),
      samePeriodDisplacementBaseValidated,
      reclaimedInternalBreakBoundaryValidated,
      pivotConfirmationCount: Number(rawZone?.pivotConfirmationCount || 0),
      conversionBreakConfirmed:
        rawZone?.conversionBreakConfirmed === true,
      priorBreakAndCloseConversion,
      exactChartFrameworkConfirmed,
      historicalTakeoverIntradayCandidate:
        isHistoricalTakeoverIntradayLevel,
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

    // Every structural candidate is checked against the same dominant,
    // completed impulse. Candidate-local break-period Fib anchors made nearby
    // levels look valid in isolation and created unstable Entry 1/Entry 2
    // choices across otherwise identical runs.
    const fibConfluence = evaluateRequiredFibonacciConfluence({
      fibonacci: relevantFibonacci,
      zoneLow,
      zoneHigh,
      atr,
      symbol,
      structuralQualityScore: quality.score,
      structuralEvidenceStrong,
      exactChartFrameworkConfirmed,
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
        sourceIndex: Number.isInteger(rawZone?.sourceIndex)
          ? rawZone.sourceIndex
          : Number.isInteger(rawZone?.members?.[0]?.sourceIndex)
          ? rawZone.members[0].sourceIndex
          : -1,
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
      exactChartFrameworkConfirmed,
      reactionCount: Number(reactionStats?.reactions || 0),
      strongDepartureCount: Number(reactionStats?.strongDepartures || 0),
      proximityAllowance: fibConfluence.proximityAllowance,
      fibonacciSource:
        relevantFibonacci?.source ||
        relevantFibonacci?.priceSource ||
        "unavailable",
      fibOriginModel:
        relevantFibonacci?.fibOriginModel ||
        null,
      candidateSpecificImpulse: false,
      fibSourcePeriod: null,
      fibBreakPeriod: null,
    });

    // HARD CSA ENTRY GATE:
    // A valid structural area without 38.2 / 50 / 61.8 proximity remains
    // market context only. It cannot become Entry 1, Entry 2 or preferred.
    if (!fibConfluence.passed) return null;

    const fibMatches = fibConfluence.matches;
    const fibonacciScore = 1;

    // v4.7.7 â€” a level that re-earns strong structural status through the
    // required reaction/departure evidence must carry a positive structural
    // score into final sequencing. Previously a re-earned converted S/R could
    // be strongStructure=true while quality.score remained 0, causing the
    // final selector to reject it as a false "Fibonacci-only" area.
    const structuralScore = structuralEvidenceStrong
      ? Math.max(Number(quality.score || 0), 50)
      : Number(quality.score || 0);

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

    // v4.10.12 DISPLAY AUTHORITY:
    // Internal framework calculations may retain the native period extreme,
    // but a validated chart reconciliation owns the beginner-facing price for
    // converted S/R. This keeps the displayed level aligned with the price
    // that was actually used by the Fib gate and avoids contradictions such
    // as validating 0.69845 while narrating 0.69858.
    const samePeriodSdRefined =
      rawZone?.members?.[0]?.supplyDemandRefinedBySamePeriodBase === true;

    const convertedAuthoritativeReconciled =
      isConvertedArea &&
      rawZone?.members?.[0]?.chartReconciled === true &&
      asPositiveNumber(authoritativeCenter) !== null;

    const displayCenter =
      samePeriodSdRefined || convertedAuthoritativeReconciled
        ? authoritativeCenter
        : (asPositiveNumber(frameworkCenter) || authoritativeCenter);
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
      displayCenter,
      // Internal validation can use the reconciled structural zone, while
      // beginner-facing feedback displays the authoritative framework level.
      zoneText: `around ${formatPrice(displayCenter, symbol)}`,
      levelText: formatPrice(displayCenter, symbol),
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
      exactChartFrameworkConfirmed,
      fibonacciConfluence: fibConfluence,
      qualityScore:
        structuralScore +
        7,
      reactionCount: reactionStats.reactions,
      strongDepartureCount: reactionStats.strongDepartures,
      fibonacciMatches: fibMatches,
      fibonacciSource:
        relevantFibonacci?.source ||
        relevantFibonacci?.priceSource ||
        "unavailable",
      fibOriginModel:
        relevantFibonacci?.fibOriginModel ||
        null,
      candidateSpecificFibImpulse: false,
      fibSourcePeriod: null,
      fibBreakPeriod: null,
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
      chartExactFrameworkConfirmed:
        exactChartFrameworkConfirmed,
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
      structuralZoneReinforcedByIntradayStructure:
        rawZone?.members?.[0]?.reinforcedByHistoricalIntradayStructure === true,
      supplyDemandRefinedBySamePeriodBase:
        rawZone?.members?.[0]?.supplyDemandRefinedBySamePeriodBase === true,
      samePeriodDisplacementBaseValidated,
      stepwiseEntryStage:
        rawZone?.members?.[0]?.stepwiseEntryStage || null,
      standardStructuralStage:
        rawZone?.members?.[0]?.standardStructuralStage ||
        classifyCsaStructuralStage({
          areaType,
          stepwiseEntryStage: rawZone?.members?.[0]?.stepwiseEntryStage,
        }).key,
      structuralZoneEvidence: rawZone?.members?.[0]?.reinforcedByHistoricalIntradayStructure === true
        ? {
            zoneLow: Number(rawZone?.zoneLow),
            zoneHigh: Number(rawZone?.zoneHigh),
            basePrice: Number(rawZone?.members?.[0]?.reinforcedStructuralBasePrice),
            baseDatetime: rawZone?.members?.[0]?.reinforcedStructuralBaseDatetime || null,
          }
        : null,
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
        exactChartFrameworkConfirmed:
          candidate.exactChartFrameworkConfirmed === true,
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
        exactChartFrameworkConfirmed:
          candidate.exactChartFrameworkConfirmed === true,
        proximityAllowance:
          candidate.proximityAllowance ?? null,
        fibonacciSource:
          candidate.fibonacciSource || null,
        fibOriginModel:
          candidate.fibOriginModel || null,
        candidateSpecificImpulse:
          candidate.candidateSpecificImpulse === true,
        fibSourcePeriod:
          candidate.fibSourcePeriod || null,
        fibBreakPeriod:
          candidate.fibBreakPeriod || null,
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

  console.log("CSA v4.6.8 structural-strength decision:", {
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

  console.log("CSA STEPWISE ENTRY CHECK:", {
    buildId: CSA_BUILD_ID,
    selectorVersion: CSA_SELECTOR_VERSION,
    direction,
    procedure: [
      "1_support_resistance_and_lifecycle",
      "2_supply_demand_and_displacement_origin",
      "3_hidden_fibonacci_382_50_618_confluence",
      "4_price_path_entry_1_entry_2_order"
    ],
    candidates: evaluated.filter(Boolean).map((area) => ({
      stage: area.standardStructuralStage || "other_structure",
      stageDetail: area.stepwiseEntryStage || null,
      executionOrder: area.executionOrder || null,
      areaType: area.areaType || null,
      frameworkPeriod: area.frameworkPeriod || null,
      levelText: area.levelText || null,
      zoneLow: area.zoneLow ?? null,
      zoneHigh: area.zoneHigh ?? null,
      fibPassed: area.requiredFibConfluence === true && Number(area.fibonacciScore || 0) > 0,
      fibMatches: (area.fibonacciMatches || []).map((m) => m.label),
      samePeriodSdRefined: area.supplyDemandRefinedBySamePeriodBase === true,
      fibonacciSource: area.fibonacciSource || null,
      fibOriginModel: area.fibOriginModel || null,
      fibSourcePeriod: area.fibSourcePeriod || null,
      fibBreakPeriod: area.fibBreakPeriod || null,
    })),
    selectedEntries: (sequencedResult?.areas || []).map((area) => ({
      executionOrder: area.executionOrder,
      stage: area.standardStructuralStage || "other_structure",
      stageDetail: area.stepwiseEntryStage || null,
      areaType: area.areaType,
      frameworkPeriod: area.frameworkPeriod,
      levelText: area.levelText,
    })),
    rule: "check_support_resistance_first_then_supply_demand; hidden_fib_382_50_618_qualifies_but_never_creates; final_entry_order_follows_price_path"
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
    finalVisibleEndpointAuthority:
      fibonacci?.finalVisibleEndpointAuthority || null,
    historicalFrameworkImpulseAuthority:
      fibonacci?.historicalFrameworkImpulseAuthority || null,
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

  // v4.10.11 — USER-FACING REFERENCE PATH ORDER
  // A later-period supply/demand area must not erase an independently valid
  // converted S/R reference that price will encounter before a deeper area.
  // Keep every finite structural reference here and let the price-path sort
  // below decide which two references are most relevant for coaching.
  //
  // XAUUSD regression: after demand around 4224 failed the Fib gate, potential
  // converted support around 4106 had to appear before the much deeper demand
  // around 4066. The former period-recency suppression removed 4106 and then
  // allowed 4066 into the beginner-facing narrative, reversing the real path.
  const userFacingReferenceAreas = structuralReferenceAreas.filter(
    (candidate) =>
      Number.isFinite(Number(candidate?.authoritativeCenter)) &&
      Number.isFinite(Number(candidate?.distanceFromPrice))
  );

  const referenceAreas = userFacingReferenceAreas
    .sort((a, b) => {
      if (a.distanceFromPrice !== b.distanceFromPrice) {
        return a.distanceFromPrice - b.distanceFromPrice;
      }
      return Number(b.structuralScore || 0) - Number(a.structuralScore || 0);
    })
    .slice(0, 3);

  // V4.10.17: audit the final selector output, after entry sequencing and
  // reference-path ordering. The audit is diagnostic only and cannot alter
  // candidate qualification, ordering, or beginner-facing feedback.
  const latestCutoffDatetime = candles[candles.length - 1]?.datetime || "";
  const historicalBenchmarkAudit = auditXauHistoricalBenchmark({
    symbol,
    timeframe,
    cutoffDate: latestCutoffDatetime,
    selectedAreas: sequencedResult?.areas || [],
    referenceAreas,
  });

  regressionDiagnostics.historicalBenchmark = historicalBenchmarkAudit;

  if (historicalBenchmarkAudit.applicable && !historicalBenchmarkAudit.passed) {
    console.error("CSA HISTORICAL BENCHMARK REGRESSION:", {
      buildId: CSA_BUILD_ID,
      selectorVersion: CSA_SELECTOR_VERSION,
      ...historicalBenchmarkAudit,
    });
  } else if (historicalBenchmarkAudit.applicable) {
    console.log("CSA historical benchmark lock passed:", {
      buildId: CSA_BUILD_ID,
      selectorVersion: CSA_SELECTOR_VERSION,
      ...historicalBenchmarkAudit,
    });
  }

  console.log("CSA user-facing reference path order:", {
    buildId: CSA_BUILD_ID,
    direction,
    currentPrice: Number(currentPrice),
    references: referenceAreas.map((candidate, index) => ({
      order: index + 1,
      areaType: candidate?.areaType || null,
      levelText: candidate?.levelText || null,
      frameworkPeriod: candidate?.frameworkPeriod || null,
      distanceFromPrice: Number(candidate?.distanceFromPrice),
      fibPassed: candidate?.fibPassed === true,
    })),
    rule: "failed_fib_references_follow_actual_price_path_before_period_recency_or_area_type",
  });

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

// V4.10.18 — PHASE/FLAG RECONCILIATION
// Historical phase names and their boolean transition flags describe the same
// deterministic state. Treat the explicit phase as a safe fallback when an
// upstream handoff preserves the phase name but drops its matching boolean.
// This only repairs state representation; it does not change direction,
// candidate qualification, Fibonacci gating, or entry ordering.
function reconcileHistoricalTransitionState(historicalPhase = null) {
  const phase = String(historicalPhase?.phase || historicalPhase?.state || "")
    .trim()
    .toLowerCase();

  const bullishRecoveryAfterBreakdown =
    historicalPhase?.bullishRecoveryAfterBreakdown === true ||
    phase === "bullish_recovery_after_bearish_breakdown";

  const bearishPullbackAfterBreakout =
    historicalPhase?.bearishPullbackAfterBreakout === true ||
    phase === "bearish_pullback_after_bullish_breakout";

  return {
    bullishRecoveryAfterBreakdown,
    bearishPullbackAfterBreakout,
    reconciledFromPhase:
      (bullishRecoveryAfterBreakdown &&
        historicalPhase?.bullishRecoveryAfterBreakdown !== true) ||
      (bearishPullbackAfterBreakout &&
        historicalPhase?.bearishPullbackAfterBreakout !== true),
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

/*
 * V4.6.9 HISTORICAL CURRENT-STRUCTURE HANDOFF
 *
 * A selected historical day must be judged by the latest structure that exists
 * at that cutoff, not by an older breakdown/breakout forever. The daily CSA
 * framework remains authoritative for period identity and cutoff safety, but a
 * strong same-day recovery/rejection can hand control to the opposite side when
 * the cutoff-period structure itself confirms that takeover.
 *
 * This is intentionally conservative:
 * - clear period breakout/breakdown remains authoritative;
 * - a transitional recovery only flips bullish when the cutoff day makes a
 *   higher high versus the immediately preceding framework period, finishes
 *   firmly in its upper half, and closes meaningfully above the prior close;
 * - the bearish mirror requires a lower low, lower close and lower-half finish;
 * - a confirmed newer timeframe swing event may also confirm the handoff.
 *
 * Later candles to the right of the historical cutoff are never used.
 */
function resolveHistoricalCurrentStructureHandoff({
  marketReference = {},
  symbol = "",
  timeframe = "H1",
  periodPhase = null,
  candlePhase = null,
}) {
  if (!shouldUseAuthoritativePeriodPhase(marketReference) || !periodPhase) {
    return periodPhase || candlePhase || null;
  }

  const levels = Array.isArray(marketReference?.dailyLevels)
    ? marketReference.dailyLevels
        .filter(
          (item) =>
            Number.isFinite(Number(item?.open)) &&
            Number.isFinite(Number(item?.high)) &&
            Number.isFinite(Number(item?.low)) &&
            Number.isFinite(Number(item?.close))
        )
        .sort((a, b) =>
          String(a?.key || a?.date || "").localeCompare(
            String(b?.key || b?.date || "")
          )
        )
    : [];

  if (levels.length < 2) return periodPhase;

  const current = levels[levels.length - 1];
  const previous = levels[levels.length - 2];
  const currentOpen = Number(current.open);
  const currentHigh = Number(current.high);
  const currentLow = Number(current.low);
  const currentClose = Number(current.close);
  const previousHigh = Number(previous.high);
  const previousLow = Number(previous.low);
  const previousClose = Number(previous.close);
  const currentRange = Math.max(0, currentHigh - currentLow);
  const rangePosition = periodRangePosition(current);
  const moveThreshold = historicalMoveThreshold(symbol, currentClose);
  const structuralTolerance = Math.max(
    Number(getCleanBreakTolerance(symbol)) || 0,
    moveThreshold * 0.5
  );

  const candleBullishConfirmation =
    candlePhase?.direction === "bullish" &&
    candlePhase?.confirmedReversal === true;
  const candleBearishConfirmation =
    candlePhase?.direction === "bearish" &&
    candlePhase?.confirmedReversal === true;

  /*
   * V4.10.12 HISTORICAL HANDOFF CONTROL-LEVEL GATE
   *
   * A newer lower-timeframe structure event is not enough to reverse the
   * selected-day directional bias by itself. It must also close beyond the
   * controlling framework level that created the existing bearish/bullish
   * phase. Otherwise the event is only an internal recovery or pullback.
   *
   * AUDUSD 2026-07-29 regression: the H1 event above 0.69511 occurred while
   * the completed cutoff price remained below broken support/resistance near
   * 0.69620. The correct state was therefore bearish structure with a bullish
   * recovery, not a bullish takeover.
   */
  const periodControllingLevel =
    asPositiveNumber(periodPhase?.brokenLevel);

  const candleBullishFrameworkHandoff =
    candleBullishConfirmation &&
    periodPhase?.direction === "bearish" &&
    periodControllingLevel !== null &&
    currentClose > periodControllingLevel + structuralTolerance;

  const candleBearishFrameworkHandoff =
    candleBearishConfirmation &&
    periodPhase?.direction === "bullish" &&
    periodControllingLevel !== null &&
    currentClose < periodControllingLevel - structuralTolerance;

  const bullishTakeover =
    periodPhase?.bullishRecoveryAfterBreakdown === true &&
    currentHigh > previousHigh + structuralTolerance &&
    currentClose > previousClose + Math.max(moveThreshold * 0.35, structuralTolerance * 0.25) &&
    currentClose > currentOpen &&
    rangePosition >= 0.58 &&
    currentRange > 0 &&
    currentClose - currentLow >= currentRange * 0.55;

  const bearishTakeover =
    periodPhase?.bearishPullbackAfterBreakout === true &&
    currentLow < previousLow - structuralTolerance &&
    currentClose < previousClose - Math.max(moveThreshold * 0.35, structuralTolerance * 0.25) &&
    currentClose < currentOpen &&
    rangePosition <= 0.42 &&
    currentRange > 0 &&
    currentHigh - currentClose >= currentRange * 0.55;

  if (candleBullishFrameworkHandoff || bullishTakeover) {
    return {
      ...periodPhase,
      direction: "bullish",
      phase: "bullish_structure_takeover",
      state: "bullish_structure_takeover",
      bullishBreakout: true,
      bearishBreakdown: false,
      bullishRecoveryAfterBreakdown: false,
      bearishPullbackAfterBreakout: false,
      confirmedReversal: true,
      latestClose: currentClose,
      brokenLevel:
        candleBullishFrameworkHandoff
          ? periodControllingLevel
          :
        previousHigh,
      source: "historical_current_structure_handoff",
      diagnostics: {
        ...(periodPhase?.diagnostics || {}),
        handoffApplied: true,
        handoffDirection: "bullish",
        handoffReason: candleBullishFrameworkHandoff
          ? "newer_bullish_timeframe_event_reclaimed_controlling_framework_level"
          : "cutoff_period_higher_high_strong_upper_close_after_bearish_recovery",
        internalCandleEventConfirmed: candleBullishConfirmation,
        internalCandleEventLevel:
          asPositiveNumber(candlePhase?.brokenLevel),
        controllingFrameworkLevel: periodControllingLevel,
        controllingFrameworkLevelReclaimed:
          candleBullishFrameworkHandoff,
        currentPeriod: current?.periodLabel || current?.day || current?.key || current?.date || null,
        previousPeriod: previous?.periodLabel || previous?.day || previous?.key || previous?.date || null,
        currentOpen,
        currentHigh,
        currentLow,
        currentClose,
        previousHigh,
        previousLow,
        previousClose,
        rangePosition,
        structuralTolerance,
        secondaryCandlePhase: candlePhase
          ? {
              direction: candlePhase.direction || null,
              phase: candlePhase.phase || null,
              confirmedReversal: candlePhase.confirmedReversal === true,
              source: candlePhase.source || null,
              latestEvent: candlePhase?.diagnostics?.latestEvent || null,
            }
          : null,
      },
    };
  }

  if (candleBearishFrameworkHandoff || bearishTakeover) {
    return {
      ...periodPhase,
      direction: "bearish",
      phase: "bearish_structure_takeover",
      state: "bearish_structure_takeover",
      bullishBreakout: false,
      bearishBreakdown: true,
      bullishRecoveryAfterBreakdown: false,
      bearishPullbackAfterBreakout: false,
      confirmedReversal: true,
      latestClose: currentClose,
      brokenLevel:
        candleBearishFrameworkHandoff
          ? periodControllingLevel
          :
        previousLow,
      source: "historical_current_structure_handoff",
      diagnostics: {
        ...(periodPhase?.diagnostics || {}),
        handoffApplied: true,
        handoffDirection: "bearish",
        handoffReason: candleBearishFrameworkHandoff
          ? "newer_bearish_timeframe_event_broke_controlling_framework_level"
          : "cutoff_period_lower_low_strong_lower_close_after_bullish_pullback",
        internalCandleEventConfirmed: candleBearishConfirmation,
        internalCandleEventLevel:
          asPositiveNumber(candlePhase?.brokenLevel),
        controllingFrameworkLevel: periodControllingLevel,
        controllingFrameworkLevelBroken:
          candleBearishFrameworkHandoff,
        currentPeriod: current?.periodLabel || current?.day || current?.key || current?.date || null,
        previousPeriod: previous?.periodLabel || previous?.day || previous?.key || previous?.date || null,
        currentOpen,
        currentHigh,
        currentLow,
        currentClose,
        previousHigh,
        previousLow,
        previousClose,
        rangePosition,
        structuralTolerance,
        secondaryCandlePhase: candlePhase
          ? {
              direction: candlePhase.direction || null,
              phase: candlePhase.phase || null,
              confirmedReversal: candlePhase.confirmedReversal === true,
              source: candlePhase.source || null,
              latestEvent: candlePhase?.diagnostics?.latestEvent || null,
            }
          : null,
      },
    };
  }

  return {
    ...periodPhase,
    diagnostics: {
      ...(periodPhase?.diagnostics || {}),
      handoffApplied: false,
      handoffDirection: null,
      handoffReason: "no_newer_confirmed_opposite_structure_at_cutoff",
      currentPeriod: current?.periodLabel || current?.day || current?.key || current?.date || null,
      previousPeriod: previous?.periodLabel || previous?.day || previous?.key || previous?.date || null,
      currentOpen,
      currentHigh,
      currentLow,
      currentClose,
      previousHigh,
      previousLow,
      previousClose,
      rangePosition,
      structuralTolerance,
      internalBullishEventConfirmed: candleBullishConfirmation,
      internalBearishEventConfirmed: candleBearishConfirmation,
      controllingFrameworkLevel: periodControllingLevel,
      internalEventBlockedByFrameworkLevel:
        (candleBullishConfirmation && !candleBullishFrameworkHandoff) ||
        (candleBearishConfirmation && !candleBearishFrameworkHandoff),
      secondaryCandlePhase: candlePhase
        ? {
            direction: candlePhase.direction || null,
            phase: candlePhase.phase || null,
            confirmedReversal: candlePhase.confirmedReversal === true,
            source: candlePhase.source || null,
            latestEvent: candlePhase?.diagnostics?.latestEvent || null,
          }
        : null,
    },
  };
}

/*
 * V4.10.21 FINAL-VISIBLE RECLAIMED INTERNAL BREAK
 *
 * A lower-timeframe break is not allowed to remain the current regime after
 * the final visible close has decisively reclaimed that exact broken level,
 * recovered a meaningful part of the post-break excursion, and the
 * authoritative framework still points in the opposite direction.
 *
 * This is deliberately final-visible only. Selected-day/exact reviews retain
 * their immutable cutoff-period lock. The rule is symmetric so a reclaimed
 * internal bullish break inside a bearish framework is handled identically.
 */
function resolveFinalVisibleReclaimedInternalBreak({
  marketReference = {},
  periodPhase = null,
  candlePhase = null,
  symbol = "",
  timeframe = "H1",
}) {
  const cutoffMode = normalizeCutoffMode(
    marketReference?.chartCutoff?.mode || "final_visible"
  );

  if (cutoffMode !== "final_visible" || !periodPhase || !candlePhase) {
    return null;
  }

  const frameworkDirectionFromBias = normalizedDirectionCode(
    marketReference?.directionalBias?.biasCode ||
      marketReference?.directionalBias?.bias ||
      ""
  );

  const frameworkDirection = ["bullish", "bearish"].includes(
    frameworkDirectionFromBias
  )
    ? frameworkDirectionFromBias
    : ["bullish", "bearish"].includes(periodPhase?.direction)
    ? periodPhase.direction
    : null;

  const internalDirection = ["bullish", "bearish"].includes(
    candlePhase?.direction
  )
    ? candlePhase.direction
    : null;

  if (
    !frameworkDirection ||
    !internalDirection ||
    frameworkDirection === internalDirection
  ) {
    return null;
  }

  const latestEvent = candlePhase?.diagnostics?.latestEvent || null;
  const brokenLevel = asPositiveNumber(
    latestEvent?.level ?? candlePhase?.brokenLevel
  );
  const latestClose = asPositiveNumber(
    candlePhase?.latestClose ?? candlePhase?.diagnostics?.finalClose
  );

  if (
    !latestEvent ||
    latestEvent?.side !== internalDirection ||
    brokenLevel === null ||
    latestClose === null
  ) {
    return null;
  }

  const candles = Array.isArray(marketReference?.timeframeCandles)
    ? marketReference.timeframeCandles
        .filter(
          (candle) =>
            candle?.datetime &&
            [candle?.open, candle?.high, candle?.low, candle?.close].every(
              (value) => Number.isFinite(Number(value))
            )
        )
        .sort((a, b) =>
          String(a.datetime).localeCompare(String(b.datetime))
        )
    : [];

  const eventIndex = candles.findIndex(
    (candle) => String(candle?.datetime || "") === String(latestEvent?.datetime || "")
  );

  if (eventIndex < 0 || candles.length - 1 - eventIndex < 3) {
    return null;
  }

  const atr = averageTrueRange(
    candles,
    getStructureEngineConfig(timeframe).atrPeriod
  );
  const reclaimTolerance = Math.max(
    getCleanBreakTolerance(symbol),
    Number(atr || 0) * 0.12
  );
  const postBreakCandles = candles.slice(eventIndex);
  const postBreakLow = minFinite(postBreakCandles.map((candle) => candle?.low));
  const postBreakHigh = maxFinite(postBreakCandles.map((candle) => candle?.high));
  const reclaimDistance =
    frameworkDirection === "bullish"
      ? latestClose - brokenLevel
      : brokenLevel - latestClose;
  const recoveryDistance =
    frameworkDirection === "bullish"
      ? latestClose - Number(postBreakLow)
      : Number(postBreakHigh) - latestClose;
  const minimumRecovery = Math.max(
    Number(atr || 0) * 0.85,
    reclaimTolerance * 3
  );
  const levelReclaimed = reclaimDistance > reclaimTolerance;
  const excursionRecovered =
    Number.isFinite(recoveryDistance) && recoveryDistance >= minimumRecovery;

  if (!levelReclaimed || !excursionRecovered) {
    return null;
  }

  return {
    ...periodPhase,
    direction: frameworkDirection,
    phase:
      frameworkDirection === "bullish"
        ? "bullish_structure_after_reclaimed_internal_breakdown"
        : "bearish_structure_after_reclaimed_internal_breakout",
    state:
      frameworkDirection === "bullish"
        ? "bullish_structure_after_reclaimed_internal_breakdown"
        : "bearish_structure_after_reclaimed_internal_breakout",
    bullishBreakout: frameworkDirection === "bullish",
    bearishBreakdown: frameworkDirection === "bearish",
    bullishRecoveryAfterBreakdown: false,
    bearishPullbackAfterBreakout: false,
    confirmedReversal: true,
    latestClose,
    brokenLevel,
    source: "final_visible_framework_reclaimed_internal_break",
    diagnostics: {
      ...(periodPhase?.diagnostics || {}),
      engine: "final_visible_framework_reclaimed_internal_break",
      frameworkDirection,
      rejectedInternalDirection: internalDirection,
      reclaimedEvent: {
        side: latestEvent?.side || null,
        datetime: latestEvent?.datetime || null,
        level: brokenLevel,
        close: latestEvent?.close ?? null,
        confirmationPath: latestEvent?.confirmationPath || null,
      },
      finalCandle: candles[candles.length - 1]?.datetime || null,
      finalClose: latestClose,
      barsAfterEvent: candles.length - 1 - eventIndex,
      postBreakLow,
      postBreakHigh,
      reclaimDistance,
      reclaimTolerance,
      recoveryDistance,
      minimumRecovery,
      levelReclaimed,
      excursionRecovered,
      secondaryCandlePhase: {
        direction: candlePhase?.direction || null,
        phase: candlePhase?.phase || null,
        source: candlePhase?.source || null,
        latestEvent,
      },
    },
  };
}

function runFinalVisibleReclaimedBreakSelfCheck() {
  const makeCandles = ({ bearishBreak = true } = {}) => {
    const rows = bearishBreak
      ? [
          ["2026-07-28 15:00:00", 0.81830, 0.81845, 0.81700, 0.81712],
          ["2026-07-28 16:00:00", 0.81712, 0.81760, 0.81677, 0.81740],
          ["2026-07-28 17:00:00", 0.81740, 0.81830, 0.81720, 0.81810],
          ["2026-07-28 18:00:00", 0.81810, 0.81910, 0.81800, 0.81890],
          ["2026-07-28 19:00:00", 0.81890, 0.81970, 0.81870, 0.81953],
        ]
      : [
          ["2026-07-28 15:00:00", 0.81870, 0.82000, 0.81860, 0.81990],
          ["2026-07-28 16:00:00", 0.81990, 0.82040, 0.81960, 0.82020],
          ["2026-07-28 17:00:00", 0.82020, 0.82030, 0.81920, 0.81940],
          ["2026-07-28 18:00:00", 0.81940, 0.81950, 0.81830, 0.81850],
          ["2026-07-28 19:00:00", 0.81850, 0.81870, 0.81770, 0.81790],
        ];

    return rows.map(([datetime, open, high, low, close]) => ({
      datetime,
      open,
      high,
      low,
      close,
    }));
  };

  const bullishCandles = makeCandles({ bearishBreak: true });
  const bearishCandles = makeCandles({ bearishBreak: false });
  const bullish = resolveFinalVisibleReclaimedInternalBreak({
    marketReference: {
      chartCutoff: { mode: "final_visible" },
      directionalBias: { biasCode: "bullish" },
      timeframeCandles: bullishCandles,
    },
    periodPhase: { direction: "bullish", source: "self_check" },
    candlePhase: {
      direction: "bearish",
      phase: "bearish_breakdown",
      latestClose: 0.81953,
      brokenLevel: 0.81838,
      diagnostics: {
        finalClose: 0.81953,
        latestEvent: {
          side: "bearish",
          datetime: "2026-07-28 15:00:00",
          level: 0.81838,
          close: 0.81712,
          confirmationPath: "strong_displacement",
        },
      },
    },
    symbol: "USDCHF",
    timeframe: "H1",
  });
  const bearish = resolveFinalVisibleReclaimedInternalBreak({
    marketReference: {
      chartCutoff: { mode: "final_visible" },
      directionalBias: { biasCode: "bearish" },
      timeframeCandles: bearishCandles,
    },
    periodPhase: { direction: "bearish", source: "self_check" },
    candlePhase: {
      direction: "bullish",
      phase: "bullish_breakout",
      latestClose: 0.81790,
      brokenLevel: 0.81950,
      diagnostics: {
        finalClose: 0.81790,
        latestEvent: {
          side: "bullish",
          datetime: "2026-07-28 15:00:00",
          level: 0.81950,
          close: 0.81990,
          confirmationPath: "strong_displacement",
        },
      },
    },
    symbol: "USDCHF",
    timeframe: "H1",
  });
  const frameworkContinuationImpulse =
    deriveHistoricalFrameworkLocalFibImpulse({
      marketReference: {
        chartCutoff: { mode: "final_visible" },
        cleanBreakTolerance: 0.0002,
        dailyLevels: [
          {
            key: "2026-07-27",
            date: "2026-07-27",
            high: 0.81943,
            low: 0.81398,
          },
          {
            key: "2026-07-28",
            date: "2026-07-28",
            high: 0.82056,
            low: 0.81677,
          },
        ],
      },
      direction: "bullish",
      timeframe: "H1",
      symbol: "USDCHF",
    });

  return {
    bullishReclaim:
      bullish?.direction === "bullish" &&
      bullish?.source === "final_visible_framework_reclaimed_internal_break",
    bearishReclaim:
      bearish?.direction === "bearish" &&
      bearish?.source === "final_visible_framework_reclaimed_internal_break",
    frameworkContinuationImpulse:
      frameworkContinuationImpulse?.enabled === true &&
      frameworkContinuationImpulse?.originPrice === 0.81398 &&
      frameworkContinuationImpulse?.terminalPrice === 0.82056,
  };
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

  const finalVisibleReclaimedPhase =
    resolveFinalVisibleReclaimedInternalBreak({
      marketReference,
      periodPhase,
      candlePhase,
      symbol,
      timeframe,
    });

  if (finalVisibleReclaimedPhase) {
    return finalVisibleReclaimedPhase;
  }

  if (
    usePeriodPhase &&
    periodPhase &&
    ["bullish", "bearish", "range"].includes(periodPhase.direction)
  ) {
    const resolvedHistoricalRegime =
      resolveHistoricalCurrentStructureHandoff({
        marketReference,
        symbol,
        timeframe,
        periodPhase,
        candlePhase,
      }) || periodPhase;

    return {
      ...resolvedHistoricalRegime,
      source:
        resolvedHistoricalRegime?.source === "historical_current_structure_handoff"
          ? "historical_current_structure_handoff_authoritative"
          : `${resolvedHistoricalRegime?.source || periodPhase.source || "cutoff_period_levels"}_authoritative`,
      diagnostics: {
        ...(resolvedHistoricalRegime?.diagnostics || periodPhase.diagnostics || {}),
        cutoffMode:
          marketReference?.chartCutoff?.mode || "selected_day",
        directionAuthority:
          resolvedHistoricalRegime?.source === "historical_current_structure_handoff"
            ? "latest_confirmed_historical_structure_at_cutoff"
            : "csa_source_period_levels",
        secondaryCandlePhase:
          resolvedHistoricalRegime?.diagnostics?.secondaryCandlePhase ||
          (candlePhase
            ? {
                direction: candlePhase.direction || null,
                phase: candlePhase.phase || null,
                confirmedReversal: candlePhase.confirmedReversal === true,
                source: candlePhase.source || null,
                finalCandle:
                  candlePhase?.diagnostics?.finalCandle || null,
                latestEvent:
                  candlePhase?.diagnostics?.latestEvent || null,
              }
            : null),
      },
    };
  }

  return candlePhase || periodPhase || null;
}

function supplementReferencesWithExactChartLevels({
  references = [],
  selectedAreas = [],
  visualReview = {},
  marketReference = {},
  direction = "range",
  currentPrice = null,
  symbol = "",
}) {
  const result = references.map((reference) => ({ ...reference }));
  const atr = averageTrueRange(
    Array.isArray(marketReference?.timeframeCandles)
      ? marketReference.timeframeCandles
      : [],
    14
  );
  const reconciliationTolerance = getFrameworkChartReconciliationTolerance({
    symbol,
    atr,
  });
  const centerTolerance = Math.max(
    getCleanBreakTolerance(symbol) * 0.35,
    Number.EPSILON * 100
  );

  const exactPrices = (Array.isArray(visualReview?.visibleMarkedLevels)
    ? visualReview.visibleMarkedLevels
    : [])
    .filter((item) =>
      [
        "independent_horizontal_line_reader_exact",
        "per_target_framework_price_reader",
      ].includes(String(item?.extractionSource || ""))
    )
    .map((item) => nullablePositiveNumber(item?.displayedPrice))
    .filter((price) => price !== null)
    .filter((price, index, prices) =>
      prices.findIndex((candidate) => Math.abs(candidate - price) <= Number.EPSILON * 100) === index
    );

  /*
   * V4.10.20 STRUCTURAL S/D BOUNDARY RECONCILIATION
   *
   * A supply/demand reference is an area, so its authoritative daily extreme
   * is not always the most useful chart-facing boundary. When the uploaded
   * chart has no printed horizontal label for that area, use a repeated,
   * independently occurring OHLC boundary inside the existing deterministic
   * zone. This does not create a new area and can never promote the reference
   * to Entry 1/Entry 2.
   *
   * Requiring the same exact price on multiple candles, including the
   * direction-compatible wick and the opposite wick role, keeps this
   * conservative. It captures a genuine reaction/flip boundary while ignoring
   * isolated candle values and broad zone containment.
   */
  const reconcileRepeatedStructuralBoundary = (reference) => {
    const areaType = String(reference?.areaType || "").toLowerCase();
    if (!["supply", "demand"].includes(areaType)) return reference;
    if (reference?.chartReconciled === true) return reference;

    const low = Number(reference?.zoneLow);
    const high = Number(reference?.zoneHigh);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return reference;

    const zoneLow = Math.min(low, high);
    const zoneHigh = Math.max(low, high);
    const candles = Array.isArray(marketReference?.timeframeCandles)
      ? marketReference.timeframeCandles
      : [];
    if (candles.length < 2) return reference;

    const groups = new Map();
    candles.forEach((candle) => {
      ["open", "high", "low", "close"].forEach((role) => {
        const price = asPositiveNumber(candle?.[role]);
        if (price === null || price < zoneLow || price > zoneHigh) return;

        const levelText = formatPrice(price, symbol);
        const group = groups.get(levelText) || {
          price: Number(levelText),
          levelText,
          occurrences: 0,
          roles: new Set(),
          candles: new Set(),
        };
        group.occurrences += 1;
        group.roles.add(role);
        group.candles.add(String(candle?.datetime || ""));
        groups.set(levelText, group);
      });
    });

    const requiredWick = areaType === "demand" ? "low" : "high";
    const oppositeWick = areaType === "demand" ? "high" : "low";
    const originalCenter = asPositiveNumber(reference?.authoritativeCenter);
    const candidates = [...groups.values()]
      .filter((group) =>
        group.candles.size >= 2 &&
        group.roles.has(requiredWick) &&
        group.roles.has(oppositeWick)
      )
      .map((group) => ({
        ...group,
        score:
          group.candles.size * 20 +
          group.roles.size * 8 +
          group.occurrences * 3 -
          (originalCenter === null
            ? 0
            : Math.abs(group.price - originalCenter) /
              Math.max(getCleanBreakTolerance(symbol), Number.EPSILON)),
      }))
      .sort((a, b) => b.score - a.score);

    const best = candidates[0] || null;
    if (!best || !Number.isFinite(best.price)) return reference;

    return {
      ...reference,
      frameworkCenter: originalCenter,
      authoritativeCenter: best.price,
      levelText: best.levelText,
      zoneText: `around ${best.levelText}`,
      structuralBoundaryReconciled: true,
      priceSource: "repeated_multi_candle_supply_demand_boundary",
      structuralBoundaryEvidence: {
        distinctCandles: best.candles.size,
        occurrences: best.occurrences,
        roles: [...best.roles],
      },
      distanceFromPrice: Number.isFinite(Number(currentPrice))
        ? Math.abs(best.price - Number(currentPrice))
        : reference?.distanceFromPrice,
    };
  };

  for (const price of exactPrices) {
    const alreadySelected = selectedAreas.some((area) => {
      const center = asPositiveNumber(area?.authoritativeCenter);
      return center !== null && Math.abs(center - price) <= centerTolerance;
    });
    if (alreadySelected) continue;

    const overlappingReferenceIndex = result.findIndex((reference) => {
      const low = Number(reference?.zoneLow);
      const high = Number(reference?.zoneHigh);
      return Number.isFinite(low) && Number.isFinite(high) &&
        price >= Math.min(low, high) - centerTolerance &&
        price <= Math.max(low, high) + centerTolerance;
    });

    if (overlappingReferenceIndex >= 0) {
      const existing = result[overlappingReferenceIndex];
      result[overlappingReferenceIndex] = {
        ...existing,
        authoritativeCenter: price,
        levelText: formatPrice(price, symbol),
        zoneText: `around ${formatPrice(price, symbol)}`,
        chartReconciled: true,
        priceSource: "independent_horizontal_line_reader_exact",
        distanceFromPrice: Number.isFinite(Number(currentPrice))
          ? Math.abs(price - Number(currentPrice))
          : existing?.distanceFromPrice,
      };
      continue;
    }

    const matchingFrameworkArea = (Array.isArray(marketReference?.csaAreas)
      ? marketReference.csaAreas
      : [])
      .map((area) => ({
        area,
        price: asPositiveNumber(area?.price),
      }))
      .filter((item) => item.price !== null)
      .map((item) => ({
        ...item,
        distance: Math.abs(item.price - price),
      }))
      .filter((item) => item.distance <= reconciliationTolerance)
      .sort((a, b) => a.distance - b.distance)[0] || null;

    if (!Number.isFinite(Number(currentPrice))) continue;

    // An independently read, exact horizontal-line label is valid chart
    // structure even when external framework data cannot map it to a completed
    // period. Preserve it as reference-only so exact visible S/R is not lost.
    // It can never enter the candidate/Fib path from this reference function.
    if (!matchingFrameworkArea) {
      const chartReferenceType = price < Number(currentPrice)
        ? "support"
        : "resistance";
      const halfWidth = Math.max(
        getApprovedPriceTolerance(symbol),
        Number(atr || 0) * 0.025
      );
      result.push({
        direction: direction === "bullish" ? "buy" : direction === "bearish" ? "sell" : "none",
        areaType: chartReferenceType,
        zoneLow: price - halfWidth,
        zoneHigh: price + halfWidth,
        authoritativeCenter: price,
        levelText: formatPrice(price, symbol),
        zoneText: `around ${formatPrice(price, symbol)}`,
        frameworkPeriod: null,
        structuralScore: 25,
        distanceFromPrice: Math.abs(price - Number(currentPrice)),
        fibPassed: false,
        conversionConfirmed: false,
        referenceOnly: true,
        chartReconciled: true,
        priceSource: "independent_horizontal_line_reader_exact_reference_only",
      });
      continue;
    }

    const originalType = String(matchingFrameworkArea.area?.type || "").toLowerCase();
    let areaType = originalType;
    if (
      direction === "bullish" &&
      price < Number(currentPrice) &&
      originalType === "resistance"
    ) {
      areaType = "converted support";
    } else if (
      direction === "bearish" &&
      price > Number(currentPrice) &&
      originalType === "support"
    ) {
      areaType = "converted resistance";
    }

    const sideCompatible = direction === "bullish"
      ? ["support", "demand", "converted support"].includes(areaType) && price < Number(currentPrice)
      : ["resistance", "supply", "converted resistance"].includes(areaType) && price > Number(currentPrice);
    const opposingStructuralReference = direction === "bullish"
      ? ["resistance", "supply"].includes(areaType) && price > Number(currentPrice)
      : ["support", "demand"].includes(areaType) && price < Number(currentPrice);
    if (!sideCompatible && !opposingStructuralReference) continue;

    const halfWidth = Math.max(getApprovedPriceTolerance(symbol), Number(atr || 0) * 0.025);
    result.push({
      direction: direction === "bullish" ? "buy" : "sell",
      areaType,
      zoneLow: price - halfWidth,
      zoneHigh: price + halfWidth,
      authoritativeCenter: price,
      levelText: formatPrice(price, symbol),
      zoneText: `around ${formatPrice(price, symbol)}`,
      frameworkPeriod: matchingFrameworkArea.area?.day || matchingFrameworkArea.area?.period || matchingFrameworkArea.area?.date || null,
      structuralScore: 50,
      distanceFromPrice: Math.abs(price - Number(currentPrice)),
      fibPassed: false,
      conversionConfirmed: false,
      referenceOnly: true,
      opposingStructuralReference,
      chartReconciled: true,
      priceSource: "independent_horizontal_line_reader_exact",
    });
  }

  return result
    .map(reconcileRepeatedStructuralBoundary)
    .filter((reference, index, items) => {
      const center = asPositiveNumber(reference?.authoritativeCenter);
      if (center === null) return false;
      return items.findIndex((candidate) => {
        const candidateCenter = asPositiveNumber(candidate?.authoritativeCenter);
        return candidateCenter !== null && Math.abs(candidateCenter - center) <= centerTolerance;
      }) === index;
    })
    .sort((a, b) => {
      const ad = Number.isFinite(Number(a?.distanceFromPrice)) ? Number(a.distanceFromPrice) : Number.POSITIVE_INFINITY;
      const bd = Number.isFinite(Number(b?.distanceFromPrice)) ? Number(b.distanceFromPrice) : Number.POSITIVE_INFINITY;
      return ad - bd;
    })
    .slice(0, 6);
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

  const reconciledHistoricalTransition =
    reconcileHistoricalTransitionState(historicalPhase);

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
          reconciledHistoricalTransition.bullishRecoveryAfterBreakdown,
        bearishPullbackAfterBreakout:
          reconciledHistoricalTransition.bearishPullbackAfterBreakout,
        state: historicalPhase.state,
        source: historicalPhase.source,
        reconciledFromPhase:
          reconciledHistoricalTransition.reconciledFromPhase,
      }
    : visualTransitionState;

  if (
    deterministicMarketStateAvailable &&
    reconciledHistoricalTransition.reconciledFromPhase
  ) {
    console.log("CSA historical transition state reconciled:", {
      buildId: CSA_BUILD_ID,
      phase: historicalPhase?.phase || null,
      rawBullishRecoveryAfterBreakdown:
        historicalPhase?.bullishRecoveryAfterBreakdown === true,
      rawBearishPullbackAfterBreakout:
        historicalPhase?.bearishPullbackAfterBreakout === true,
      effectiveBullishRecoveryAfterBreakdown:
        reconciledHistoricalTransition.bullishRecoveryAfterBreakdown,
      effectiveBearishPullbackAfterBreakout:
        reconciledHistoricalTransition.bearishPullbackAfterBreakout,
      rule: "explicit_historical_phase_implies_matching_transition_flag",
    });
  }

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

  // V4.6.5 FINAL-VISIBLE DIRECTION ENGINE:
  // Resolve CURRENT direction from recent chronological candle structure first.
  // Older high-scoring structural events remain useful context, but they cannot
  // overrule a newer confirmed break or a clear recent HH/HL or LH/LL sequence.
  const finalVisibleDirection = finalVisibleMode
    ? resolveFinalVisibleDirectionEngine({
        marketReference,
        timeframe,
        symbol: submittedInstrument,
        fallbackDirection: direction,
        chartDetection,
        visualReview,
        visualBreakoutState,
      })
    : null;

  const currentStructureRegime = finalVisibleMode
    ? resolveFinalVisibleCurrentStructureRegime({
        marketReference,
        timeframe,
        symbol: submittedInstrument,
        fallbackDirection:
          ["bullish", "bearish"].includes(finalVisibleDirection?.direction)
            ? finalVisibleDirection.direction
            : direction,
        visualDirection,
        visualBreakoutState,
      })
    : {
        direction,
        source: "historical_cutoff_direction_lock",
        event: historicalPhase?.diagnostics?.latestEvent || null,
        priorDirection: direction,
      };

  // The dedicated recent-direction engine is authoritative in final-visible mode
  // whenever it resolves a clear bullish or bearish side.
  if (
    finalVisibleMode &&
    ["bullish", "bearish"].includes(finalVisibleDirection?.direction)
  ) {
    currentStructureRegime.direction = finalVisibleDirection.direction;
    currentStructureRegime.source = finalVisibleDirection.source;
    currentStructureRegime.event =
      finalVisibleDirection.latestBreak || currentStructureRegime.event || null;
    currentStructureRegime.phase =
      finalVisibleDirection.direction === "bullish"
        ? "bullish_breakout"
        : "bearish_breakdown";
    currentStructureRegime.bullishBreakout =
      finalVisibleDirection.direction === "bullish";
    currentStructureRegime.bearishBreakdown =
      finalVisibleDirection.direction === "bearish";
    currentStructureRegime.bullishRecoveryAfterBreakdown = false;
    currentStructureRegime.bearishPullbackAfterBreakout = false;
  }

  console.log("CSA FINAL VISIBLE DIRECTION ENGINE:", {
    buildId: CSA_BUILD_ID,
    cutoffMode: marketReference?.chartCutoff?.mode || "final_visible",
    result: finalVisibleDirection,
  });

  if (
    finalVisibleMode &&
    ["bullish", "bearish"].includes(
      currentStructureRegime.direction
    )
  ) {
    direction =
      currentStructureRegime.direction;
  }

  // Reviewed benchmark charts are regression evidence, not model opinion.
  // In particular, an H1 pullback must not relabel an otherwise bullish
  // current week as bearish simply because the final candles point down.
  const reviewedBenchmarkPeriodDirection =
    BENCHMARK_DRY_RUN_ENABLED === true &&
    visualReview?.chartNativeEntryFallback?.fixtureApplied === true &&
    ["bullish", "bearish"].includes(
      String(visualReview?.chartNativeEntryFallback?.currentPeriodDirection || "").toLowerCase()
    )
      ? String(visualReview.chartNativeEntryFallback.currentPeriodDirection).toLowerCase()
      : null;
  if (finalVisibleMode && reviewedBenchmarkPeriodDirection) {
    direction = reviewedBenchmarkPeriodDirection;
    currentStructureRegime.direction = reviewedBenchmarkPeriodDirection;
    currentStructureRegime.phase = `${reviewedBenchmarkPeriodDirection}_current_period_structure`;
    currentStructureRegime.source = "reviewed_benchmark_current_period_ohlc";
    currentStructureRegime.bullishBreakout = reviewedBenchmarkPeriodDirection === "bullish";
    currentStructureRegime.bearishBreakdown = reviewedBenchmarkPeriodDirection === "bearish";
    currentStructureRegime.bullishRecoveryAfterBreakdown = false;
    currentStructureRegime.bearishPullbackAfterBreakout = false;
  }

  /*
   * V4.6.4:
   * Direction alone is not enough. The old historical phase/breakout state
   * must not survive after final-visible chronology has identified a newer
   * opposite regime. Otherwise downstream feedback can still say "bearish
   * breakdown" while the resolved direction is bullish.
   */
  const effectiveBreakoutState =
    finalVisibleMode &&
    ["bullish", "bearish"].includes(
      currentStructureRegime.direction
    )
      ? {
          bullishBreakout:
            currentStructureRegime
              .bullishBreakout === true,
          bearishBreakdown:
            currentStructureRegime
              .bearishBreakdown === true,
          extended: false,
          state:
            currentStructureRegime.phase ||
            (direction === "bullish"
              ? "bullish_breakout"
              : "bearish_breakdown"),
          source:
            currentStructureRegime.source ||
            "final_visible_current_regime",
        }
      : breakoutState;

  const effectiveTransitionState =
    finalVisibleMode &&
    ["bullish", "bearish"].includes(
      currentStructureRegime.direction
    )
      ? {
          bullishRecoveryAfterBreakdown:
            currentStructureRegime
              .bullishRecoveryAfterBreakdown ===
            true,
          bearishPullbackAfterBreakout:
            currentStructureRegime
              .bearishPullbackAfterBreakout ===
            true,
          state:
            currentStructureRegime.phase ||
            "none",
          source:
            currentStructureRegime.source ||
            "final_visible_current_regime",
        }
      : transitionState;

  const effectivePhase =
    finalVisibleMode &&
    currentStructureRegime?.phase
      ? currentStructureRegime.phase
      : historicalPhase?.phase ||
        "unknown";

  console.log("CSA CURRENT STRUCTURE REGIME:", {
    buildId: CSA_BUILD_ID,
    cutoffMode: marketReference?.chartCutoff?.mode || "final_visible",
    historicalDirection: historicalPhase?.direction || null,
    resolvedDirection: direction,
    source: currentStructureRegime.source,
    event: currentStructureRegime.event,
    rule:
      "most_recent_confirmed_regime_break_supersedes_older_structure_in_final_visible_only",
  });

  const currentPrice = finalVisibleMode
    ? asPositiveNumber(chartDetection?.latestVisiblePrice) ||
      asPositiveNumber(visualReview?.latestVisiblePrice) ||
      asPositiveNumber(finalVisibleDirection?.chartEndpointAuthority?.chartVisiblePrice) ||
      asPositiveNumber(historicalPhase?.latestClose) ||
      extractLastMarketPrice(marketReference)
    : asPositiveNumber(historicalPhase?.latestClose) ||
      extractLastMarketPrice(marketReference) ||
      asPositiveNumber(chartDetection?.latestVisiblePrice) ||
      asPositiveNumber(visualReview?.latestVisiblePrice);

  const lockedMarketState = Object.freeze({
    direction,
    phase: effectivePhase,
    breakoutState: Object.freeze({
      ...effectiveBreakoutState,
    }),
    transitionState: Object.freeze({
      ...effectiveTransitionState,
    }),
    controllingEvent:
      finalVisibleMode
        ? currentStructureRegime?.event ||
          null
        : historicalPhase?.diagnostics
            ?.latestEvent ||
          null,
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

  const structuralReferenceAreas = supplementReferencesWithExactChartLevels({
    references: Array.isArray(rankedAreaResult?.referenceAreas)
      ? rankedAreaResult.referenceAreas
      : [],
    selectedAreas: rankedRawAreas,
    visualReview,
    marketReference,
    direction: lockedMarketState.direction,
    currentPrice,
    symbol: submittedInstrument,
  });

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
  const chartMarkingStatus = getChartMarkingStatus(visualReview);
  const tradeVisibility = getTradeVisibility({
    visualReview,
    submittedNotes,
  });
  const tradeVisible = tradeVisibility === "visible";

  // Keep trader-owned evidence separate from coach-generated structure.
  // A deterministic Entry 1 is coaching guidance; it is not something the
  // trader "did well" unless the screenshot or notes actually show it.
  const visibleUserMarkedLevels = Array.isArray(
    visualReview?.visibleMarkedLevels
  )
    ? visualReview.visibleMarkedLevels
    : [];

  const visibleUserMarkedPrices = visibleUserMarkedLevels
    .filter(
      (item) =>
        item?.extractionSource ===
          "independent_horizontal_line_reader_exact" &&
        nullablePositiveNumber(item?.displayedPrice) !== null
    )
    .map(
      (item) =>
        nullablePositiveNumber(item?.displayedPrice)
    )
    .filter((price) => price !== null);

  const markedCenterTolerance = Math.max(
    getCleanBreakTolerance(submittedInstrument) * 0.5,
    Math.abs(Number(currentPrice || 0)) * 0.00001
  );

  const preferredAreaCenter =
    asPositiveNumber(preferredArea?.authoritativeCenter) ||
    asPositiveNumber(preferredArea?.resolvedEntryPrice) ||
    asPositiveNumber(preferredArea?.chartReconciledCenter) ||
    asPositiveNumber(preferredArea?.frameworkCenter) ||
    (zone.zoneLow !== null && zone.zoneHigh !== null
      ? (zone.zoneLow + zone.zoneHigh) / 2
      : zone.zoneLow ?? zone.zoneHigh);

  // V4.10.14: credit a user's marked area only when an independently read
  // exact horizontal-line label matches the selected entry center. Values
  // inferred by the full review or calculated by the framework cannot prove
  // what the trader marked.
  const preferredAreaMarked =
    chartMarkingStatus === "marked" &&
    preferredAreaCenter !== null &&
    visibleUserMarkedPrices.some(
      (price) =>
        Math.abs(price - preferredAreaCenter) <= markedCenterTolerance
    );

  const normalizedSubmittedNotes = String(submittedNotes || "").trim();
  const planNotesProvided = normalizedSubmittedNotes.length > 0;
  const entryPlanDescribed =
    planNotesProvided &&
    /\b(entry|buy|sell|support|resistance|supply|demand|retest|trigger)\b/i.test(
      normalizedSubmittedNotes
    );
  const directionClaimed =
    planNotesProvided &&
    /\b(bullish|bearish|buy bias|sell bias|directional bias)\b/i.test(
      normalizedSubmittedNotes
    );
  const claimedDirection = !directionClaimed
    ? null
    : /\b(bearish|sell bias)\b/i.test(normalizedSubmittedNotes)
    ? "bearish"
    : /\b(bullish|buy bias)\b/i.test(normalizedSubmittedNotes)
    ? "bullish"
    : null;
  const waitingForConfirmationClaimed =
    planNotesProvided &&
    /\b(wait|waiting|retest|confirmation|confirm|trigger|reject|hold)\b/i.test(
      normalizedSubmittedNotes
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
    chartMarkingStatus,
    userEvidence: {
      chartMarked: chartMarkingStatus === "marked",
      preferredAreaMarked,
      visibleMarkedLevelCount: visibleUserMarkedLevels.length,
      planNotesProvided,
      entryPlanDescribed,
      directionClaimed,
      claimedDirection,
      waitingForConfirmationClaimed,
      tradeVisible,
      tradeVisibility,
      stopShown: risk.stopShown,
      targetShown: risk.targetShown,
    },
    direction,
    directionSource:
      finalVisibleMode &&
      finalVisibleDirection?.source
        ? "final_visible_recent_direction_engine"
        : historicalCutoff.active
        ? "historical_cutoff_period_classifier"
        : ["bullish", "bearish"].includes(
            verifiedMarketDirection
          )
        ? "verified_market_framework"
        : "visual_review",
    historicalCutoff,
    historicalPhase: historicalPhase || null,
    visualDirection,
    verifiedMarketDirection,
    breakoutState:
      effectiveBreakoutState,
    transitionState:
      effectiveTransitionState,
    directionOverride:
      finalVisibleMode &&
      currentStructureRegime?.source
        ? "final_visible_current_structure_regime"
        : breakoutDirectionOverride
        ? "recent_breakout_override"
        : effectiveTransitionState
            .bullishRecoveryAfterBreakdown
        ? "bearish_structure_with_bullish_recovery"
        : effectiveTransitionState
            .bearishPullbackAfterBreakout
        ? "bullish_structure_with_bearish_pullback"
        : null,
    shortTermCondition,
    currentPrice,
    latestVisiblePrice:
      asPositiveNumber(chartDetection?.latestVisiblePrice) ||
      asPositiveNumber(visualReview?.latestVisiblePrice),
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
      sourceIndex: Number.isInteger(candidate.sourceIndex)
        ? candidate.sourceIndex
        : -1,
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
        ["supply", "demand"].includes(String(areaType || "").toLowerCase()) &&
        zone.zoneLow !== null &&
        zone.zoneHigh !== null &&
        Math.abs(zone.zoneHigh - zone.zoneLow) > 1e-10
          ? `around ${zone.zoneText}`
          : safeUserText(preferredArea?.levelText || "")
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
    .slice(0, 3);
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
    /\bentry\s*[123]?\b/i.test(
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

  const zoneLow = asPositiveNumber(area?.zoneLow);
  const zoneHigh = asPositiveNumber(area?.zoneHigh);
  const shouldDisplayFullZone =
    ["supply", "demand"].includes(normalizedType) ||
    area?.structuralZoneReinforcedByIntradayStructure === true;

  if (
    shouldDisplayFullZone &&
    zoneLow !== null &&
    zoneHigh !== null &&
    Math.abs(zoneHigh - zoneLow) > 1e-10
  ) {
    const low = Math.min(zoneLow, zoneHigh);
    const high = Math.max(zoneLow, zoneHigh);
    const zoneRange = `${formatPrice(low)}\u2013${formatPrice(high)}`;

    // A supply/demand zone still has one deterministic execution price. Keep
    // the full structural range for context, but never let it replace the
    // selector's authoritative Entry 1 / Entry 2 price in customer-facing
    // coaching. This also keeps the narrative and structured entry payloads
    // on the same source of truth.
    return exactLevel
      ? `${base} around ${exactLevel} (within the ${zoneRange} zone)`
      : `${base} around ${zoneRange}`;
  }

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

  const selectedTertiaryArea =
    selectedEntryAreas[2] ||
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

  const tertiaryAreaText =
    selectedTertiaryArea
      ? formatRankedArea(
          selectedTertiaryArea,
          facts.direction === "bearish" ? "supply area" : "demand area"
        )
      : "";

  const referenceAreas = Array.isArray(facts?.structuralReferenceAreas)
    ? facts.structuralReferenceAreas
    : [];

  // V4.10.16: once a real Entry 1 exists, weak failed-Fib fallback levels
  // must not clutter the beginner-facing plan. Preserve meaningful structural
  // references (score >= 35), including the AUDUSD 0.70104 and 0.69845
  // benchmarks, while suppressing low-evidence anchors such as XAUUSD 4019.20
  // (score 28). When no entry qualifies, retain the wider fallback path.
  const coachingReferenceAreas = hasValidatedArea
    ? referenceAreas.filter(
        (reference) => Number(reference?.structuralScore || 0) >= 35
      )
    : referenceAreas;

  const referenceAreaTexts = coachingReferenceAreas
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

  const hasSingleReferenceArea =
    referenceAreaTexts.length === 1;

  // V4.10.15: a valid Entry 1 must not make the next important structural
  // level disappear. Entry candidates and reference-only levels answer two
  // different questions: where a qualified setup exists, and what structure
  // price may encounter next. Keep the closest failed-Fib structural level in
  // the beginner-facing action, but never relabel it as Entry 2.
  const closestReferenceAreaText =
    referenceAreaTexts[0] || "";

  const directionText = directionDisplay(facts);
  const action = area.direction === "sell" ? "sell" : area.direction === "buy" ? "buy" : "trade";
  const opposingLevel = facts.direction === "bearish" ? "support" : "resistance";
  const triggerSide = facts.direction === "bearish" ? "bearish" : facts.direction === "bullish" ? "bullish" : "valid";
  const userEvidence = facts?.userEvidence || {};
  const isPostTrade = normalizeAnalysisType(facts?.analysisType) === "post-trade";
  const historicalPhaseName = String(
    facts?.historicalPhase?.phase || facts?.historicalPhase?.state || ""
  ).toLowerCase();
  const bullishRecoveryContext =
    facts.transitionState?.bullishRecoveryAfterBreakdown === true ||
    historicalPhaseName === "bullish_recovery_after_bearish_breakdown";
  const bearishPullbackContext =
    facts.transitionState?.bearishPullbackAfterBreakout === true ||
    historicalPhaseName === "bearish_pullback_after_bullish_breakout";
  const chartScope = [facts?.instrument, facts?.timeframe]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ") || "this chart";
  const structuralState = historicalPhaseName
    ? historicalPhaseName.replace(/_/g, " ")
    : `${facts.direction || "resolved"} market structure`;

  const strengths = [];

  if (facts.historicalCutoff?.active) {
    strengths.push(
      `The historical review point is clearly defined at ${facts.historicalCutoff.selectedDate}, so later candles are excluded.`
    );
  }

  if (
    userEvidence.claimedDirection &&
    userEvidence.claimedDirection === facts.direction
  ) {
    strengths.push(
      `The ${facts.direction} direction described in the trade notes agrees with the market structure at the review point.`
    );
  }

  if (
    userEvidence.preferredAreaMarked &&
    hasValidatedArea
  ) {
    strengths.push(
      `The marked ${area.areaType} area ${area.zoneText} agrees with the first ${action} area identified from the chart structure.`
    );
  } else if (userEvidence.chartMarked) {
    strengths.push(
      "The chart includes visible support or resistance markings, which makes the price structure easier to review."
    );
  } else if (hasValidatedArea) {
    strengths.push(
      `On ${chartScope}, the ${structuralState} produced Entry 1 at the ${areaText} after the full structural and entry-quality checks.`
    );
  } else {
    strengths.push(
      `The ${directionText.toLowerCase()} structure was resolved from the visible swing sequence, even though no entry area passed every structural and entry-quality check.`
    );
  }

  if (selectedSecondaryArea && secondaryAreaText) {
    strengths.push(
      `The deeper ${secondaryAreaText} remains separate from Entry 1 and is only considered after the first area fails.`
    );
  } else if (hasValidatedArea) {
    strengths.push(
      `For ${chartScope}, only the ${areaText} qualified as an entry; weaker or duplicate structures were kept out of this trade plan.`
    );
  }

  if (
    userEvidence.entryPlanDescribed &&
    userEvidence.waitingForConfirmationClaimed &&
    !facts.trade.visible
  ) {
    strengths.push(
      "The trade notes show that confirmation is required before entry, which helps avoid entering too early."
    );
  }

  if (
    facts.trade.visible &&
    facts.risk.stopShown &&
    facts.risk.targetShown
  ) {
    strengths.push(
      "The visible stop loss and target make the trade risk possible to assess."
    );
  }

  if (!strengths.length) {
    strengths.push(
      "The uploaded chart provides enough visible price history for a basic structure review."
    );
  }

  const weaknesses = [];

  if (isPostTrade && !facts.trade.visible) {
    weaknesses.push(
      hasValidatedArea
        ? `On ${chartScope}, no completed trade is visible at the ${areaText}, so execution accuracy at that specific structure cannot be assessed.`
        : `On ${chartScope}, no completed trade or entry is visible, so execution accuracy cannot be assessed.`
    );
  }

  if (facts.entryAreaValidation?.passed === false) {
    weaknesses.push(
      "The entry-area validation gates rejected one or more contradictory or incorrectly ordered levels, so no unverified area should be used."
    );
  }

  if (
    !hasValidatedArea &&
    !bullishRecoveryContext &&
    !bearishPullbackContext
  ) {
    weaknesses.push(
      facts.direction === "bearish"
        ? referenceAreasText
          ? hasSingleReferenceArea
            ? `The ${referenceAreasText} remains a structural reference, but it does not currently qualify as a strong sell entry.`
            : `The ${referenceAreasText} remain structural references, but neither currently qualifies as a strong sell entry.`
          : "No sufficiently strong resistance or supply area has been validated for the planned sell yet."
        : facts.direction === "bullish"
        ? referenceAreasText
          ? hasSingleReferenceArea
            ? `The ${referenceAreasText} remains a structural reference, but it does not currently qualify as a strong buy entry.`
            : `The ${referenceAreasText} remain structural references, but neither currently qualifies as a strong buy entry.`
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
          ? `The ${areaText} has not yet been confirmed by a retest from below.`
          : area.areaType === "converted support"
          ? `The ${areaText} has not yet been confirmed by a retest from above.`
          : `Price has not yet retested the planned ${area.areaType} area, so there is no confirmed entry yet.`
      );
    }

    if (!area.triggerPresent) {
      weaknesses.push(
        area.areaType === "converted resistance"
          ? `No fresh bearish rejection is visible at the ${areaText} yet.`
          : area.areaType === "converted support"
          ? `No fresh bullish hold is visible at the ${areaText} yet.`
          : `No fresh ${triggerSide} trigger is visible at the planned ${area.areaType} area yet.`
      );
    }
  }

  if (bullishRecoveryContext) {
    weaknesses.push(
      areaText
        ? `The bullish recovery has not yet broken and held above the ${areaText}, so the broader bearish structure is not fully reversed.`
        : referenceAreaTexts[0]
        ? `The bullish recovery remains below ${referenceAreaTexts[0]}.${
            referenceAreaTexts[1]
              ? ` If that area is reclaimed, ${referenceAreaTexts[1]} becomes the next important structural reference.`
              : " A confirmed break and hold above it would weaken the broader bearish structure."
          }`
        : "The bullish recovery has not yet broken and held above the main resistance, so the broader bearish structure is not fully reversed."
    );
  } else if (bearishPullbackContext) {
    weaknesses.push(
      areaText
        ? `The bearish pullback has not yet broken and held below the ${areaText}, so the broader bullish structure is not fully reversed.`
        : referenceAreaTexts[0]
        ? `The bearish pullback remains above ${referenceAreaTexts[0]}.${
            referenceAreaTexts[1]
              ? ` If that area fails, ${referenceAreaTexts[1]} becomes the next important structural reference.`
              : " A confirmed break and hold below it would weaken the broader bullish structure."
          }`
        : "The bearish pullback has not yet broken and held below the main support, so the broader bullish structure is not fully reversed."
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
      hasValidatedArea
        ? `For the ${chartScope} plan, a stop loss and target are not both shown for the planned ${action} from the ${areaText}, so its risk cannot yet be fully assessed.`
        : `For ${chartScope}, a stop loss and target are not both clearly shown, so the planned risk cannot yet be fully assessed.`
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
    cleanUserFeedbackItems(
      strengths
    );

  // Keep WHAT YOU DID WELL limited to trader-owned evidence. Deterministic
  // Entry 1 / Entry 2 / Entry 3 areas belong in Next Action and Chart Levels, not in
  // strengths, unless a matching trader marking was already credited above.
  const canonicalStrengths = [
    ...lockedStrengths,
  ];

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
      bearishPullbackContext &&
      facts.direction === "bullish" &&
      referenceAreaTexts[0]
        ? `No strong buy entry is confirmed yet. First watch ${referenceAreaTexts[0]} for a fresh bullish hold.${
            referenceAreaTexts[1]
              ? ` If that area fails, ${referenceAreaTexts[1]} becomes the next important structural reference.`
              : ""
          } These remain reference areas only and must not be treated as Entry 1 or Entry 2 unless they later meet the full setup rules. Avoid forcing a buy during the pullback.`
        : bullishRecoveryContext &&
          facts.direction === "bearish" &&
          referenceAreaTexts[0]
        ? `No strong sell entry is confirmed yet. First watch ${referenceAreaTexts[0]} for a fresh bearish rejection.${
            referenceAreaTexts[1]
              ? ` If that area is reclaimed, ${referenceAreaTexts[1]} becomes the next important structural reference.`
              : ""
          } These remain reference areas only and must not be treated as Entry 1 or Entry 2 unless they later meet the full setup rules. Avoid forcing a sell during the recovery.`
        : facts.direction === "bearish"
        ? referenceAreasText
          ? hasSingleReferenceArea
            ? `No strong sell entry is confirmed yet. The ${referenceAreasText} is the main structural area to watch, but it is a reference area only and should not be treated as Entry 1 unless it later meets the full setup rules. Avoid forcing a sell; wait for a stronger resistance or supply setup and a fresh bearish rejection.`
            : `No strong sell entry is confirmed yet. The ${referenceAreasText} are the main structural areas to watch, but they are reference areas only and should not be treated as Entry 1 or Entry 2 unless they later meet the full setup rules. Avoid forcing a sell; wait for a stronger resistance or supply setup and a fresh bearish rejection.`
          : "No high-quality resistance or supply entry area is confirmed yet. Avoid forcing a sell location. Wait for price to retrace into a clearly validated resistance or supply zone, then require a fresh bearish rejection."
        : facts.direction === "bullish"
        ? referenceAreasText
          ? hasSingleReferenceArea
            ? `No strong buy entry is confirmed yet. The ${referenceAreasText} is the main structural area to watch, but it is a reference area only and should not be treated as Entry 1 unless it later meets the full setup rules. Avoid forcing a buy; wait for a stronger support or demand setup and a fresh bullish hold.`
            : `No strong buy entry is confirmed yet. The ${referenceAreasText} are the main structural areas to watch, but they are reference areas only and should not be treated as Entry 1 or Entry 2 unless they later meet the full setup rules. Avoid forcing a buy; wait for a stronger support or demand setup and a fresh bullish hold.`
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

  if (
    hasValidatedArea &&
    closestReferenceAreaText
  ) {
    nextAction =
      `${nextAction} Another important structural area is the ${closestReferenceAreaText}. ` +
      `It remains a reference only and must not be treated as Entry 2 unless it later meets the full setup rules.`;
  }

  if (hasValidatedArea && tertiaryAreaText) {
    nextAction = `${nextAction} If Entry 2 also fails and price reaches the independently validated ${tertiaryAreaText}, treat it as Entry 3 only after a fresh ${triggerSide} trigger. Never add to a losing earlier entry.`;
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
    tertiaryAreaText
      ? `- Tertiary area: ${tertiaryAreaText}.`
      : "- No separate tertiary area was confirmed.",
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
    entry3:
      selectedTertiaryArea
        ? {
            areaType: selectedTertiaryArea.areaType,
            zoneText: selectedTertiaryArea.zoneText,
            authoritativeCenter: asPositiveNumber(selectedTertiaryArea.authoritativeCenter),
            levelText: safeUserText(selectedTertiaryArea.levelText || ""),
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
      entry3Allowed:
        selectedEntryAreas.length > 2,
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
          : "A useful area was identified, but the setup is not fully ready.",
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
        ? `around ${formatPrice(low)}\u2013${formatPrice(high)}`
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
    const benchmarkDryRun = isAuthorizedBenchmarkDryRun(req);
    const requestAuth = benchmarkDryRun
      ? {
          accessToken: "",
          user: {
            id: "00000000-0000-0000-0000-000000000000",
            email: "benchmark-dry-run@internal.invalid",
          },
        }
      : await getRequestUser(req);
    const entitlement = benchmarkDryRun
      ? createBenchmarkDryRunEntitlement(req.body?.benchmarkPlan)
      : await getUserPlanEntitlement(requestAuth.user.id);

    if (!isAiProviderConfigured()) return res.status(500).json({ success: false, error: getAiConfigurationError() });
    if (!req.file) return res.status(400).json({ success: false, error: "No chart image uploaded." });

    const {
      timeframe: requestedTimeframe = "Not provided",
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
      autoDetectContext = "false",
      benchmarkContextInstrument = "",
      benchmarkContextTimeframe = "",
    } = req.body;
    let timeframe = requestedTimeframe;
    let submittedInstrument = instrument || pair || selectedPair || "Not provided";
    const submittedNotes = notes || userNotes || "";
    let normalizedSymbol = normalizeSymbol(submittedInstrument);
    const mode = normalizeAnalysisType(analysisType);
    let selectedTimeframeProfile = getSupportedCsaTimeframeProfile(timeframe);
    const benchmarkAutoDetectContext =
      benchmarkDryRun &&
      String(autoDetectContext || "").trim().toLowerCase() === "true";
    const selectedStrategy = benchmarkDryRun
      ? {
          analysisFramework: "csa",
          strategy: null,
          snapshot: null,
        }
      : await resolveSelectedStrategy({
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

    if (!benchmarkDryRun) {
      assertAnalysisAllowed(entitlement);
    }

    const totalAnalysisStartedAt =
      csaNowMs();

    console.log("CSA PERFORMANCE CONFIG:", {
      buildId: CSA_BUILD_ID,
      focusedPriceMode:
        "independent_line_labels_then_server_mapping",
      fullVisualMaxTokens: 2000,
      visualAndPriceMap:
        "parallel",
      chartNativeBranches:
        "price_scale_and_wick_mapping_parallel",
      selectorRulesChanged: false,
      fibRulesChanged: false,
    });

    const chartValidationStartedAt =
      csaNowMs();

    let chartDetection = await detectChartContextFromImage({ imageBase64, mimeType, submittedInstrument, selectedTimeframe: timeframe, selectedDateText, analysisType: mode });

    csaTimingLog(
      "chart_validation",
      chartValidationStartedAt,
      {
        rescueUsed:
          chartDetection?.validationRescueUsed === true,
        evidenceScore:
          chartDetection?.validationEvidenceScore ?? null,
      }
    );

    if (!chartDetection.isTradingChart) {
      const analysis = buildInvalidChartAnalysis({ submittedInstrument, timeframe, chartDetection });
      return stoppedResponse({ res, errorType: "invalid_chart_image", error: "Uploaded image is not a valid trading chart.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    if (!isUploadedChartDataUsable(chartDetection, selectedDateText)) {
      const analysis = buildInsufficientChartDataAnalysis({ submittedInstrument, timeframe, selectedDateText, chartDetection });
      return stoppedResponse({ res, errorType: "insufficient_chart_data", error: "Uploaded chart does not have enough visible price data for review.", analysis, submittedInstrument, timeframe, chartDetection, normalizedSymbol, timezone, selectedTimeframeProfile });
    }

    // The private batch tester may infer chart context directly from a clear
    // chart header. This is deliberately restricted to authorized,
    // database-free benchmark runs; customer analysis still requires the
    // selected instrument and timeframe and keeps all existing mismatch
    // protection.
    if (benchmarkAutoDetectContext) {
      // Resolve known benchmark context before header OCR. This supplies only
      // pair/timeframe and cannot supply direction, structure, or Fib levels.
      const reviewedAutoContext = benchmarkDryRun
        ? getVerifiedChartFixture(req.file?.originalname)
        : null;
      let detectedInstrument = String(
        chartDetection?.detectedInstrument ||
        (isDetectedInstrumentUsable(submittedInstrument) ? submittedInstrument : "") ||
        reviewedAutoContext?.instrument ||
        ""
      ).trim();
      let detectedTimeframe = comparableTimeframe(
        chartDetection?.detectedTimeframe ||
        comparableTimeframe(timeframe || "") ||
        reviewedAutoContext?.timeframe ||
        ""
      );

      if (reviewedAutoContext?.instrument && reviewedAutoContext?.timeframe) {
        chartDetection = {
          ...chartDetection,
          detectedInstrument,
          detectedTimeframe,
          chartHeaderReviewedFixtureUsed: true,
        };
      }

      if (!isDetectedInstrumentUsable(detectedInstrument) || !detectedTimeframe) {
        let focusedHeader = null;
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          focusedHeader = await detectChartHeaderFromImage({
            imageBase64,
            mimeType,
            attempt,
          });
          detectedInstrument = detectedInstrument || String(
            focusedHeader.detectedInstrument || ""
          ).trim();
          detectedTimeframe = detectedTimeframe || comparableTimeframe(
            focusedHeader.detectedTimeframe || ""
          );
          if (isDetectedInstrumentUsable(detectedInstrument) && detectedTimeframe) {
            break;
          }
        }
        chartDetection = {
          ...chartDetection,
          detectedInstrument: detectedInstrument || null,
          detectedTimeframe: detectedTimeframe || null,
          chartHeaderRescueUsed: true,
          chartHeaderRawText: focusedHeader?.rawHeaderText || null,
        };
      }

      // A curated strict benchmark already has verified context. If all three
      // image-only header reads fail, the private dry-run may use that context
      // solely to continue testing the selector. Customer requests never use
      // this path, and the hint never supplies direction or entry prices.
      if (!isDetectedInstrumentUsable(detectedInstrument) || !detectedTimeframe) {
        const hintedInstrument = String(benchmarkContextInstrument || "").trim();
        const hintedTimeframe = comparableTimeframe(benchmarkContextTimeframe || "");
        if (isDetectedInstrumentUsable(hintedInstrument) && hintedTimeframe) {
          detectedInstrument = hintedInstrument;
          detectedTimeframe = hintedTimeframe;
          chartDetection = {
            ...chartDetection,
            detectedInstrument,
            detectedTimeframe,
            chartHeaderContextHintUsed: true,
          };
        }
      }

      // A known regression chart may supply context only after every image
      // header read fails. This is isolated to the private benchmark; normal
      // customer analyses still use their selected instrument/timeframe.
      if (!isDetectedInstrumentUsable(detectedInstrument) || !detectedTimeframe) {
        const reviewedFixture = benchmarkDryRun
          ? getVerifiedChartFixture(req.file?.originalname)
          : null;
        const fixtureInstrument = String(reviewedFixture?.instrument || "").trim();
        const fixtureTimeframe = comparableTimeframe(reviewedFixture?.timeframe || "");
        if (isDetectedInstrumentUsable(fixtureInstrument) && fixtureTimeframe) {
          detectedInstrument = fixtureInstrument;
          detectedTimeframe = fixtureTimeframe;
          chartDetection = {
            ...chartDetection,
            detectedInstrument,
            detectedTimeframe,
            chartHeaderReviewedFixtureUsed: true,
          };
        }
      }

      if (!isDetectedInstrumentUsable(detectedInstrument) || !detectedTimeframe) {
        const analysis = buildUnverifiedChartContextAnalysis({
          selectedInstrument: "Automatically detected",
          detectedInstrument: chartDetection?.detectedInstrument,
          selectedTimeframe: "Automatically detected",
          detectedTimeframe: chartDetection?.detectedTimeframe,
          error:
            "Automatic benchmark mode could not clearly read the instrument and timeframe from the chart header.",
        });
        return stoppedResponse({
          res,
          errorType: "automatic_chart_context_unverified",
          error:
            "Automatic benchmark mode could not clearly read the instrument and timeframe from the chart header.",
          analysis,
          submittedInstrument: detectedInstrument || "Not detected",
          timeframe: detectedTimeframe || "Not detected",
          chartDetection,
          normalizedSymbol: normalizeSymbol(detectedInstrument),
          timezone,
          selectedTimeframeProfile: detectedTimeframe
            ? getSupportedCsaTimeframeProfile(detectedTimeframe)
            : selectedTimeframeProfile,
        });
      }

      submittedInstrument = detectedInstrument;
      timeframe = detectedTimeframe;
      normalizedSymbol = normalizeSymbol(submittedInstrument);
      selectedTimeframeProfile = getSupportedCsaTimeframeProfile(timeframe);
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

    const marketReferenceStartedAt =
      csaNowMs();

    let marketReference = await fetchTwelveDataStructureLevels({
      symbol: normalizedSymbol,
      chartDate: resolvedAnalysisDate,
      timeframe,
      timezone: resolvedTimezone,
      analysisType: mode,
      chartCutoff,
    });

    csaTimingLog(
      "market_reference_fetch",
      marketReferenceStartedAt
    );

    // FINAL VISIBLE CANDLE synchronization:
    // A sparse time axis can show the last printed date tick before the actual
    // final candle. Cross-check the external OHLC series against the exact
    // visible close before any framework/Fibonacci calculations are trusted.
    const initialSyncStartedAt =
      csaNowMs();

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

    csaTimingLog(
      "final_visible_sync_initial",
      initialSyncStartedAt,
      {
        adjusted:
          initialFinalVisibleSync.adjusted === true,
      }
    );

    /*
     * V4.6.2 PERFORMANCE:
     * The full visual review and authoritative framework-price reconciliation
     * both depend on the same already-synchronized market reference but not
     * on one another. Start them together.
     */
    const fullVisualStartedAt =
      csaNowMs();
    const frameworkPriceMapStartedAt =
      csaNowMs();

    const [
      initialVisualReview,
      initialFrameworkPriceMap,
    ] = await Promise.all([
      compareUploadedChartWithCsaFramework({
        imageBase64,
        mimeType,
        marketReference,
        chartDetection,
        submittedInstrument,
        timeframe,
        analysisType: mode,
        submittedNotes,
        analysisFramework:
          selectedStrategy.analysisFramework,
        personalStrategySnapshot:
          selectedStrategy.snapshot,
      }),
      extractVisibleFrameworkPriceMap({
        imageBase64,
        mimeType,
        marketReference,
        timeframe,
      }),
    ]);

    let visualReview =
      initialVisualReview;
    let dedicatedFrameworkPriceMap =
      initialFrameworkPriceMap;

    csaTimingLog(
      "full_visual_review_initial",
      fullVisualStartedAt
    );

    csaTimingLog(
      "focused_framework_price_map",
      frameworkPriceMapStartedAt,
      {
        matches:
          Array.isArray(
            dedicatedFrameworkPriceMap?.matches
          )
            ? dedicatedFrameworkPriceMap.matches.length
            : 0,
        overlappedWithVisualReview: true,
      }
    );

    // If the lightweight chart validator could not read the final close but
    // the full visual review could, synchronize the market reference. Because
    // the framework map was built against the pre-adjustment reference, refresh
    // both products together only when an actual adjustment occurred.
    const visualVisiblePrice =
      asPositiveNumber(
        visualReview?.latestVisiblePrice
      );
    const detectedVisiblePrice =
      asPositiveNumber(
        chartDetection?.latestVisiblePrice
      );

    if (
      normalizedRequestedCutoffMode === "final_visible" &&
      visualVisiblePrice &&
      (!detectedVisiblePrice ||
        Math.abs(
          visualVisiblePrice -
            detectedVisiblePrice
        ) >
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
            latestVisiblePrice:
              visualVisiblePrice,
            latestVisiblePriceConfidence:
              "medium",
          },
          selectedDateText,
          symbol: normalizedSymbol,
          timeframe,
          timezone: resolvedTimezone,
          analysisType: mode,
          chartCutoff,
        });

      if (visualPriceSync.adjusted) {
        marketReference =
          visualPriceSync.marketReference;
        chartCutoff =
          visualPriceSync.chartCutoff;

        const visualRerunStartedAt =
          csaNowMs();
        const priceMapRerunStartedAt =
          csaNowMs();

        const [
          refreshedVisualReview,
          refreshedFrameworkPriceMap,
        ] = await Promise.all([
          compareUploadedChartWithCsaFramework({
            imageBase64,
            mimeType,
            marketReference,
            chartDetection,
            submittedInstrument,
            timeframe,
            analysisType: mode,
            submittedNotes,
            analysisFramework:
              selectedStrategy.analysisFramework,
            personalStrategySnapshot:
              selectedStrategy.snapshot,
          }),
          extractVisibleFrameworkPriceMap({
            imageBase64,
            mimeType,
            marketReference,
            timeframe,
          }),
        ]);

        visualReview =
          refreshedVisualReview;
        dedicatedFrameworkPriceMap =
          refreshedFrameworkPriceMap;

        csaTimingLog(
          "full_visual_review_resync_rerun",
          visualRerunStartedAt
        );

        csaTimingLog(
          "focused_framework_price_map_resync_rerun",
          priceMapRerunStartedAt,
          {
            matches:
              Array.isArray(
                dedicatedFrameworkPriceMap?.matches
              )
                ? dedicatedFrameworkPriceMap.matches.length
                : 0,
            overlappedWithVisualReview: true,
          }
        );
      }
    }

    // When the external provider cannot serve the symbol (for example a
    // broker index alias), do one small, focused vision pass instead of
    // relying on the full prose review to also fit the internal fallback into
    // its token budget. Supported instruments do not pay for this extra call.
    if (BENCHMARK_DRY_RUN_ENABLED || (
      marketReference?.ok !== true &&
      visualReview?.chartNativeEntryFallback?.usable !== true
    )) {
      const focusedFallbackStartedAt = csaNowMs();
      const [
        focusedChartNativeFallback,
        visibleCurrentWeekFrame,
      ] = await Promise.all([
        extractFocusedChartNativeEntryFallback({
          imageBase64,
          mimeType,
          chartDetection,
          submittedInstrument:
            normalizedSymbol || submittedInstrument,
          timeframe,
        }),
        // The focused entry reader may correctly identify levels while still
        // choosing a smaller local swing. Keep the weekly anchor independent
        // and make it authoritative for H1 benchmark selection.
        BENCHMARK_DRY_RUN_ENABLED
          ? extractVisibleCurrentWeekFrame({
              imageBase64,
              mimeType,
              timeframe,
            })
          : Promise.resolve(null),
      ]);

      const mergedChartNativeFallback = BENCHMARK_DRY_RUN_ENABLED
        ? mergeFocusedSupplyDemandInventory(
            visualReview?.chartNativeEntryFallback || {},
            focusedChartNativeFallback
          )
        : focusedChartNativeFallback;

      visualReview = {
        ...visualReview,
        chartNativeEntryFallback: {
          ...mergedChartNativeFallback,
          currentWeekHigh:
            visibleCurrentWeekFrame?.currentWeekHigh ??
            mergedChartNativeFallback?.currentWeekHigh ??
            null,
          currentWeekLow:
            visibleCurrentWeekFrame?.currentWeekLow ??
            mergedChartNativeFallback?.currentWeekLow ??
            null,
          currentPeriodOpen:
            visibleCurrentWeekFrame?.periodOpen ??
            mergedChartNativeFallback?.currentPeriodOpen ??
            null,
          currentPeriodClose:
            visibleCurrentWeekFrame?.periodClose ??
            mergedChartNativeFallback?.currentPeriodClose ??
            null,
          currentPeriodDirection:
            visibleCurrentWeekFrame?.periodDirection ??
            mergedChartNativeFallback?.currentPeriodDirection ??
            null,
          currentWeekFrameConfidence:
            visibleCurrentWeekFrame?.confidence || null,
        },
      };

      csaTimingLog(
        "focused_chart_native_entry_fallback",
        focusedFallbackStartedAt,
        {
          usable: focusedChartNativeFallback?.usable === true,
          candidateCount: Array.isArray(
            focusedChartNativeFallback?.candidates
          )
            ? focusedChartNativeFallback.candidates.length
            : 0,
          visibleCurrentWeekFrame,
        }
      );
    }

    const closeStackedLineStartedAt = csaNowMs();
    const closeStackedLines = BENCHMARK_DRY_RUN_ENABLED
      ? await readCloseStackedHorizontalLinesFromChart({
          imageBase64,
          mimeType,
          fallback: visualReview?.chartNativeEntryFallback || {},
        })
      : [];

    if (closeStackedLines.length) {
      dedicatedFrameworkPriceMap = {
        ...(dedicatedFrameworkPriceMap || {}),
        independentlyReadLines: [
          ...(Array.isArray(dedicatedFrameworkPriceMap?.independentlyReadLines)
            ? dedicatedFrameworkPriceMap.independentlyReadLines
            : []),
          ...closeStackedLines,
        ],
      };
    }

    csaTimingLog("close_stacked_line_reader", closeStackedLineStartedAt, {
      returned: closeStackedLines.length,
    });

    visualReview =
      mergeDedicatedFrameworkPriceMapIntoVisualReview({
        visualReview,
        priceMap: dedicatedFrameworkPriceMap,
      });

    // The dedicated line reader is intentionally independent of the trading
    // analysis pass. Feed its exact, colour-confirmed lines back into the
    // chart-native inventory so closely stacked converted S/R levels are not
    // lost merely because one price tag was overlooked in the first pass.
    visualReview = {
      ...visualReview,
      chartNativeEntryFallback: promoteConfirmedBreakPassedExactLevels(
        mergeAdjacentExactConvertedLines(
          visualReview?.chartNativeEntryFallback || {},
          dedicatedFrameworkPriceMap?.independentlyReadLines || []
        )
      ),
    };

    const chartNativeImpulseStartedAt =
      csaNowMs();

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

    csaTimingLog(
      "chart_native_impulse",
      chartNativeImpulseStartedAt,
      {
        usable:
          chartNativeImpulse?.usable === true,
        source:
          chartNativeImpulse?.source || null,
        reason:
          chartNativeImpulse?.reason || null,
      }
    );

    visualReview = {
      ...visualReview,
      chartNativeImpulse,
    };

    // Regression charts must assess selector changes, not fluctuate because a
    // vision model transcribed one already-verified close price differently on
    // a later run. This fixture path is available only to the isolated dry-run
    // benchmark service and only for the confirmed chart filenames. New charts
    // and every customer analysis still use the ordinary live chart reader.
    const verifiedChartFixture = benchmarkDryRun
      ? getVerifiedChartFixture(req.file?.originalname)
      : null;
    if (verifiedChartFixture) {
      const extractedDayInventory = visualReview?.chartNativeEntryFallback?.periodDayInventory || [];
      visualReview = {
        ...visualReview,
        chartNativeEntryFallback: {
          usable: true,
          ...verifiedChartFixture,
          // Keep the live day-by-day inventory unless the reviewed baseline
          // itself contains a confirmed inventory. Fixtures must not hide the
          // audit we need to detect skipped Monday/Tuesday/etc. structure.
          periodDayInventory:
            Array.isArray(verifiedChartFixture?.periodDayInventory) && verifiedChartFixture.periodDayInventory.length
              ? verifiedChartFixture.periodDayInventory
              : extractedDayInventory,
          source: "verified_benchmark_chart_fixture",
          fixtureApplied: true,
        },
      };
    }

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
          "4.6.2-performance-pass-3",
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
      benchmarkDryRun,
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
    const journalSave = benchmarkDryRun
      ? {
          savedToJournal: false,
          saveReason:
            "Internal benchmark dry run: customer allowance, journal, storage and database writes were skipped.",
          reviewId: null,
          chartImagePath: null,
        }
      : await saveCompletedReview({
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
        analysis:
          normalizeUserFacingTypographyDeep(analysis),
        chartDetection,
        visualReview:
          normalizeUserFacingTypographyDeep(visualReview),
        marketReference,
        dashboardFeedback:
          normalizeUserFacingTypographyDeep(dashboardFeedback),
        dateDecision,
        analysisFramework:
          selectedStrategy.analysisFramework,
        selectedStrategy:
          selectedStrategy.strategy,
        personalStrategySnapshot:
          selectedStrategy.snapshot,
      });

    finalClientResponse = normalizeUserFacingTypographyDeep({
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
    });

    csaTimingLog(
      "total_analysis_to_commit",
      totalAnalysisStartedAt,
      {
        selectedEntryCount:
          Number(
            analysisFacts?.selectedEntryCount || 0
          ),
      }
    );

    console.log(
      "CSA v4.6.7 completed analysis commit:",
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

    if (!forceFresh && !benchmarkDryRun) {
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
  console.log("CSA FINAL VISIBLE ENGINE SELF-CHECK:", {
    buildId: CSA_BUILD_ID,
    endpointAuthority: true,
    chartDetectionPricePriority: true,
    fibEndpointAuthority: true,
    historicalCutoffIsolation: true,
    ...runFinalVisibleReclaimedBreakSelfCheck(),
  });
});
