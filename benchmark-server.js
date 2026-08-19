import express from "express";
import multer from "multer";
import { fileURLToPath } from "url";
import path from "path";
import { validateBenchmarkResult } from "./benchmark/validator.js";

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
const MAX_CONCURRENCY = Math.min(5, Math.max(1, Number(process.env.BENCHMARK_CONCURRENCY || 3)));
const REQUEST_TIMEOUT_MS = Math.max(30000, Number(process.env.BENCHMARK_TIMEOUT_MS || 300000));

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
    expectation: {
      expectedDirection: String(value.expectedDirection || "").trim(),
      expectedEntry1: value.expectedEntry1 ?? "",
      expectedEntry2: value.expectedEntry2 ?? "",
      entry2Required: value.entry2Required === true,
      requiredLevels: value.requiredLevels ?? "",
      requiredFeedbackLevels: value.requiredFeedbackLevels ?? "",
      forbiddenEntries: value.forbiddenEntries ?? "",
      tolerance: value.tolerance ?? "",
    },
  };
}

async function analyzeOne(testCase, file) {
  if (!file) throw new Error(`No uploaded file matched ${testCase.label}.`);
  if (!testCase.instrument) throw new Error(`Instrument is missing for ${testCase.label}.`);

  const form = new FormData();
  form.append("chart", new Blob([file.buffer], { type: file.mimetype || "image/png" }), file.originalname);
  form.append("instrument", testCase.instrument);
  form.append("timeframe", testCase.timeframe);
  form.append("benchmarkPlan", testCase.plan);
  form.append("analysisType", testCase.analysisType);
  form.append("cutoffMode", testCase.cutoffMode);
  form.append("forceFreshAnalysis", "true");
  form.append("analysisFramework", "csa");
  if (testCase.chartDate) form.append("chartDate", testCase.chartDate);
  if (testCase.notes) form.append("notes", testCase.notes);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${TARGET_URL}/analyze-chart`, {
      method: "POST",
      headers: {
        "x-benchmark-internal-key": TARGET_INTERNAL_KEY,
      },
      body: form,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Target returned non-JSON content (HTTP ${response.status}).`);
    }
    if (!response.ok || payload?.success !== true) {
      throw new Error(payload?.details || payload?.error || `Analysis failed with HTTP ${response.status}.`);
    }
    if (payload?.benchmarkDryRun !== true || payload?.savedToJournal !== false) {
      throw new Error(
        "Target did not confirm a database-free benchmark dry run. The result was rejected for safety."
      );
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
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

    const cases = rawCases.map(cleanCase);
    const results = await mapWithConcurrency(cases, MAX_CONCURRENCY, async (testCase) => {
      const itemStartedAt = Date.now();
      try {
        const analysis = await analyzeOne(testCase, req.files[testCase.fileIndex]);
        const validation = validateBenchmarkResult(analysis, testCase.expectation);
        return {
          label: testCase.label,
          fileName: req.files[testCase.fileIndex]?.originalname || null,
          status: validation.passed ? "passed" : "failed",
          durationMs: Date.now() - itemStartedAt,
          validation,
          analysis,
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
        };
      }
    });

    const summary = {
      total: results.length,
      passed: results.filter((item) => item.status === "passed").length,
      failed: results.filter((item) => item.status === "failed").length,
      errors: results.filter((item) => item.status === "error").length,
      durationMs: Date.now() - startedAt,
    };
    return res.json({ success: true, runAt: new Date().toISOString(), summary, results });
  } catch (error) {
    console.error("Benchmark batch error:", error);
    return res.status(500).json({ success: false, error: error.message || "Benchmark run failed." });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "benchmark", "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CSA benchmark runner listening on port ${PORT}; concurrency=${MAX_CONCURRENCY}`);
});
