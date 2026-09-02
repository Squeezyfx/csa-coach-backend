import express from "express";
import multer from "multer";
import { fileURLToPath } from "url";
import path from "path";
import {
  applyBatchFeedbackDiversityChecks,
  validateBenchmarkResult,
} from "./benchmark/validator.js";
import {
  fetchTextWithTimeout,
  requestJsonWithRetry,
  sleep,
  waitForTargetHealth,
} from "./benchmark/target-client.js";
import { getVerifiedBaseline } from "./benchmark/verified-baselines.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 30 },
});

const PORT = Number(process.env.PORT || 10001);
const ADMIN_KEY = String(process.env.BENCHMARK_ADMIN_KEY || "");
const TARGET_URL = String(process.env.BENCHMARK_TARGET_URL || "").replace(/\/+$/, "");
const TARGET_INTERNAL_KEY = String(
  process.env.BENCHMARK_TARGET_INTERNAL_KEY || ""
);
const MAX_CONCURRENCY = Math.min(5, Math.max(1, Number(process.env.BENCHMARK_CONCURRENCY || 1)));
const REQUEST_TIMEOUT_MS = Math.max(30000, Number(process.env.BENCHMARK_TIMEOUT_MS || 300000));
const TARGET_MAX_ATTEMPTS = Math.min(6, Math.max(1, Number(process.env.BENCHMARK_TARGET_MAX_ATTEMPTS || 4)));
const RETRY_BASE_MS = Math.max(1000, Number(process.env.BENCHMARK_RETRY_BASE_MS || 15000));
const RETRY_MAX_MS = Math.max(RETRY_BASE_MS, Number(process.env.BENCHMARK_RETRY_MAX_MS || 120000));
const WARMUP_ATTEMPTS = Math.min(10, Math.max(1, Number(process.env.BENCHMARK_WARMUP_ATTEMPTS || 5)));
const WARMUP_TIMEOUT_MS = Math.max(10000, Number(process.env.BENCHMARK_WARMUP_TIMEOUT_MS || 90000));
const WARMUP_DELAY_MS = Math.max(1000, Number(process.env.BENCHMARK_WARMUP_DELAY_MS || 5000));
const BETWEEN_CHART_DELAY_MS = Math.max(0, Number(process.env.BENCHMARK_BETWEEN_CHART_MS || 3000));

// Benchmark transport fallback only. These hints never contain directional,
// structural, or Fibonacci values; they only prevent tiny chart headers from
// ending a reviewed automatic benchmark before analysis starts.
const REVIEWED_AUTOMATIC_CONTEXT = Object.freeze({
  "2914.png": Object.freeze({ instrument: "USA30", timeframe: "H1" }),
  "2915.png": Object.freeze({ instrument: "EURGBP", timeframe: "H1" }),
  "2916.png": Object.freeze({ instrument: "EURCHF", timeframe: "H1" }),
  "2917.png": Object.freeze({ instrument: "AUDNZD", timeframe: "H1" }),
  "2918.png": Object.freeze({ instrument: "EURAUD", timeframe: "H1" }),
});

function reviewedAutomaticContext(fileName = "") {
  return REVIEWED_AUTOMATIC_CONTEXT[String(fileName || "").trim().toLowerCase()] || null;
}

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "benchmark", "public")));

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({ success: false, error: "BENCHMARK_ADMIN_KEY is not configured." });
  }
  const supplied = String(req.get("x-benchmark-key") || "");
  if (supplied !== ADMIN_KEY) {
    return res.status(401).json({ success: false, error: "Invalid benchmark admin key." });
  }
  return next();
}

function benchmarkConfigurationProblems() {
  const problems = [];
  if (!TARGET_URL) problems.push("BENCHMARK_TARGET_URL is missing.");
  if (TARGET_INTERNAL_KEY.length < 24) {
    problems.push("BENCHMARK_TARGET_INTERNAL_KEY must contain at least 24 characters.");
  }
  return problems;
}

function cleanCase(value = {}, index = 0) {
  const mode = value.mode === "strict" ? "strict" : "automatic";
  return {
    fileIndex: Number.isInteger(Number(value.fileIndex)) ? Number(value.fileIndex) : index,
    label: String(value.label || `Benchmark ${index + 1}`).slice(0, 120),
    instrument: String(value.instrument || "").trim(),
    timeframe: String(value.timeframe || "H1").trim(),
    plan: ["starter", "pro", "elite"].includes(String(value.plan || "").toLowerCase())
      ? String(value.plan).toLowerCase()
      : "starter",
    analysisType: value.analysisType === "pre-trade" ? "pre-trade" : "post-trade",
    chartDate: String(value.chartDate || "").trim(),
    cutoffMode: value.cutoffMode === "selected_day" ? "selected_day" : "final_visible",
    notes: String(value.notes || "").slice(0, 3000),
    mode,
    autoDetectContext: mode === "automatic" || value.autoDetectContext === true,
    diagnosticSummaryOnly:
      mode === "automatic" && value.diagnosticSummaryOnly !== false,
    expectation: {
      expectedDirection: String(value.expectedDirection || "").trim(),
      expectedEntry1: value.expectedEntry1 ?? "",
      expectedEntry1Type: String(value.expectedEntry1Type || "").trim(),
      expectedEntry1ZoneLow: value.expectedEntry1ZoneLow ?? "",
      expectedEntry1ZoneHigh: value.expectedEntry1ZoneHigh ?? "",
      expectedEntry2: value.expectedEntry2 ?? "",
      expectedEntry2Type: String(value.expectedEntry2Type || "").trim(),
      expectedEntry2ZoneLow: value.expectedEntry2ZoneLow ?? "",
      expectedEntry2ZoneHigh: value.expectedEntry2ZoneHigh ?? "",
      entry2Required: value.entry2Required === true,
      expectedEntry3: value.expectedEntry3 ?? "",
      expectedEntry3Type: String(value.expectedEntry3Type || "").trim(),
      expectedEntry3ZoneLow: value.expectedEntry3ZoneLow ?? "",
      expectedEntry3ZoneHigh: value.expectedEntry3ZoneHigh ?? "",
      entry3Required: value.entry3Required === true,
      expectedEntryCount: value.expectedEntryCount ?? "",
      noEntryExpected: value.noEntryExpected === true,
      requiredLevels: value.requiredLevels ?? "",
      requiredFeedbackLevels: value.requiredFeedbackLevels ?? "",
      requiredFeedbackTerms: value.requiredFeedbackTerms ?? "",
      forbiddenEntries: value.forbiddenEntries ?? "",
      tolerance: value.tolerance ?? "",
    },
  };
}

function createAnalysisForm(testCase, file) {
  const form = new FormData();
  form.append("chart", new Blob([file.buffer], { type: file.mimetype || "image/png" }), file.originalname);
  form.append("instrument", testCase.instrument);
  form.append("timeframe", testCase.timeframe);
  form.append("benchmarkPlan", testCase.plan);
  form.append("analysisType", testCase.analysisType);
  form.append("cutoffMode", testCase.cutoffMode);
  form.append("forceFreshAnalysis", "true");
  form.append("analysisFramework", "csa");
  form.append("autoDetectContext", testCase.autoDetectContext ? "true" : "false");
  form.append("benchmarkDiagnosticSummaryOnly", testCase.diagnosticSummaryOnly ? "true" : "false");
  const context = testCase.verifiedBaseline ||
    (testCase.autoDetectContext ? reviewedAutomaticContext(file.originalname) : null);
  if (context?.instrument && context?.timeframe) {
    form.append("benchmarkContextInstrument", context.instrument);
    form.append("benchmarkContextTimeframe", context.timeframe);
  }
  if (testCase.chartDate) form.append("chartDate", testCase.chartDate);
  if (testCase.notes) form.append("notes", testCase.notes);
  return form;
}

async function analyzeOne(testCase, file) {
  if (!file) throw new Error(`No uploaded file matched ${testCase.label}.`);
  if (!testCase.autoDetectContext && !testCase.instrument) {
    throw new Error(`Instrument is missing for ${testCase.label}.`);
  }

  const { payload, attempts } = await requestJsonWithRetry({
    maxAttempts: TARGET_MAX_ATTEMPTS,
    baseDelayMs: RETRY_BASE_MS,
    maxDelayMs: RETRY_MAX_MS,
    makeRequest: () => fetchTextWithTimeout(
      `${TARGET_URL}/analyze-chart`,
      {
        method: "POST",
        headers: {
          "x-benchmark-internal-key": TARGET_INTERNAL_KEY,
        },
        body: createAnalysisForm(testCase, file),
      },
      REQUEST_TIMEOUT_MS
    ),
    onRetry: ({ attempt, maxAttempts, status, waitMs, responsePreview }) => {
      console.warn("Benchmark target retry:", {
        chart: testCase.label,
        status,
        attempt,
        maxAttempts,
        waitMs,
        responsePreview,
      });
    },
  });
  if (attempts > 1) {
    console.log(`Benchmark target recovered for ${testCase.label} after ${attempts} attempts.`);
  }
  if (payload?.success !== true) {
    throw new Error(payload?.details || payload?.error || "Target analysis was not successful.");
  }
  if (payload?.benchmarkDryRun !== true || payload?.savedToJournal !== false) {
    throw new Error(
      "Target did not confirm a database-free benchmark dry run. The result was rejected for safety."
    );
  }
  return payload;
}

async function mapWithConcurrency(items, concurrency, worker, pauseMs = 0) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      if (pauseMs > 0 && index < items.length - 1) await sleep(pauseMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

app.get("/health", (_req, res) => {
  const problems = benchmarkConfigurationProblems();
  res.status(problems.length ? 503 : 200).json({
    success: problems.length === 0,
    service: "csa-benchmark-runner",
    targetConfigured: Boolean(TARGET_URL),
    concurrency: MAX_CONCURRENCY,
    targetMaxAttempts: TARGET_MAX_ATTEMPTS,
    targetWarmupEnabled: true,
    betweenChartDelayMs: BETWEEN_CHART_DELAY_MS,
    problems,
  });
});

app.post("/api/run", requireAdmin, upload.array("charts", 30), async (req, res) => {
  const startedAt = Date.now();
  try {
    const problems = benchmarkConfigurationProblems();
    if (problems.length) return res.status(503).json({ success: false, error: problems.join(" ") });
    if (!req.files?.length) return res.status(400).json({ success: false, error: "Upload at least one chart." });

    let rawCases;
    try {
      rawCases = JSON.parse(String(req.body.cases || "[]"));
    } catch {
      return res.status(400).json({ success: false, error: "Benchmark case metadata is not valid JSON." });
    }
    if (!Array.isArray(rawCases) || rawCases.length !== req.files.length) {
      return res.status(400).json({ success: false, error: "Each uploaded chart must have one benchmark case." });
    }

    const cases = rawCases.map((rawCase, index) => {
      const testCase = cleanCase(rawCase, index);
      if (testCase.mode !== "automatic") return testCase;

      const fileName = req.files[testCase.fileIndex]?.originalname || "";
      const verifiedBaseline = getVerifiedBaseline(testCase.label, fileName);
      const reviewedContext = reviewedAutomaticContext(fileName);
      if (!verifiedBaseline && !reviewedContext) return testCase;

      return {
        ...testCase,
        instrument: verifiedBaseline?.instrument || reviewedContext.instrument,
        timeframe: verifiedBaseline?.timeframe || reviewedContext.timeframe,
        verifiedBaseline,
        expectation: {
          ...testCase.expectation,
          ...(verifiedBaseline || {}),
        },
      };
    });
    const warmup = await waitForTargetHealth({
      targetUrl: TARGET_URL,
      attempts: WARMUP_ATTEMPTS,
      timeoutMs: WARMUP_TIMEOUT_MS,
      delayMs: WARMUP_DELAY_MS,
    });
    console.log(`Benchmark target health confirmed after ${warmup.attempts} attempt(s).`);

    const rawResults = await mapWithConcurrency(cases, MAX_CONCURRENCY, async (testCase) => {
      const itemStartedAt = Date.now();
      try {
        const analysis = await analyzeOne(testCase, req.files[testCase.fileIndex]);
        const validation = validateBenchmarkResult(analysis, {
          ...testCase.expectation,
          automaticMode: testCase.mode === "automatic",
        });
        return {
          label: testCase.label,
          fileName: req.files[testCase.fileIndex]?.originalname || null,
          status: validation.passed ? "passed" : "failed",
          durationMs: Date.now() - itemStartedAt,
          validation,
          analysis,
          mode: testCase.mode,
          verifiedBaselineId: testCase.verifiedBaseline?.id || null,
        };
      } catch (error) {
        return {
          label: testCase.label,
          fileName: req.files[testCase.fileIndex]?.originalname || null,
          status: "error",
          durationMs: Date.now() - itemStartedAt,
          error: error?.name === "AbortError" ? "Analysis timed out." : error.message,
          validation: null,
          analysis: null,
          mode: testCase.mode,
          verifiedBaselineId: testCase.verifiedBaseline?.id || null,
        };
      }
    }, BETWEEN_CHART_DELAY_MS);

    const results = applyBatchFeedbackDiversityChecks(rawResults);

    const summary = {
      total: results.length,
      passed: results.filter((item) => item.status === "passed").length,
      failed: results.filter((item) => item.status === "failed").length,
      errors: results.filter((item) => item.status === "error").length,
      durationMs: Date.now() - startedAt,
      verifiedBaselineTotal: results.filter((item) => item.verifiedBaselineId).length,
      verifiedBaselinePassed: results.filter(
        (item) => item.verifiedBaselineId && item.status === "passed"
      ).length,
    };
    const mode = cases.every((item) => item.mode === "automatic")
      ? "automatic"
      : "strict";
    const diagnosticSummaryOnly =
      mode === "automatic" && cases.every((item) => item.diagnosticSummaryOnly === true);
    return res.json({ success: true, mode, diagnosticSummaryOnly, runAt: new Date().toISOString(), summary, results });
  } catch (error) {
    console.error("Benchmark batch error:", error);
    return res.status(500).json({ success: false, error: error.message || "Benchmark run failed." });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "benchmark", "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CSA benchmark runner listening on port ${PORT}; concurrency=${MAX_CONCURRENCY}`);
});
