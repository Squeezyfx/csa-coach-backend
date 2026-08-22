import { strictFixtureFromAutomaticResult } from "./fixture-promotion.js";

const fileInput = document.querySelector("#chartFiles");
const rows = document.querySelector("#caseRows");
const template = document.querySelector("#caseTemplate");
const casePanel = document.querySelector("#casePanel");
const resultsPanel = document.querySelector("#resultsPanel");
const runButton = document.querySelector("#runButton");
const saveButton = document.querySelector("#saveButton");
const clearButton = document.querySelector("#clearButton");
const exportButton = document.querySelector("#exportButton");
const promoteButton = document.querySelector("#promoteButton");
const runStatus = document.querySelector("#runStatus");
const adminKey = document.querySelector("#adminKey");
let files = [];
let lastRun = null;
let benchmarkMode = "automatic";

const fixtureFields = [
  "label", "instrument", "timeframe", "plan", "analysisType", "cutoffMode",
  "chartDate", "expectedDirection", "expectedEntry1", "expectedEntry1Type",
  "expectedEntry1ZoneLow", "expectedEntry1ZoneHigh", "expectedEntry2",
  "expectedEntry2Type", "expectedEntry2ZoneLow", "expectedEntry2ZoneHigh",
  "entry2Required", "expectedEntry3", "expectedEntry3Type",
  "expectedEntry3ZoneLow", "expectedEntry3ZoneHigh", "entry3Required",
  "noEntryExpected", "requiredLevels",
  "requiredFeedbackLevels", "requiredFeedbackTerms", "forbiddenEntries",
  "tolerance", "notes",
];

adminKey.value = sessionStorage.getItem("csaBenchmarkAdminKey") || "";
adminKey.addEventListener("change", () => sessionStorage.setItem("csaBenchmarkAdminKey", adminKey.value));

function field(row, name) { return row.querySelector(`[data-field="${name}"]`); }

function isZoneType(value) {
  return ["demand", "supply"].includes(String(value || "").toLowerCase());
}

function syncZoneFields(row, entryNumber) {
  const type = field(row, `expectedEntry${entryNumber}Type`).value;
  const group = row.querySelector(`[data-zone-group="${entryNumber}"]`);
  group.hidden = !isZoneType(type);
}

function fixtureKey(file) {
  return `csaBenchmarkFixture:${file.name}:${file.size}`;
}

function restoreFixture(row, file) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(fixtureKey(file)) || "null"); } catch {}
  if (!saved) return;
  fixtureFields.forEach((name) => {
    const input = field(row, name);
    if (!input || saved[name] === undefined) return;
    if (input.type === "checkbox") input.checked = saved[name] === true;
    else input.value = saved[name];
  });
}

function fixtureFromRow(row) {
  const saved = {};
  fixtureFields.forEach((name) => {
    const input = field(row, name);
    if (!input) return;
    saved[name] = input.type === "checkbox" ? input.checked : input.value;
  });
  return saved;
}

function applyFixtureToRow(row, saved) {
  fixtureFields.forEach((name) => {
    const input = field(row, name);
    if (!input || saved[name] === undefined) return;
    if (input.type === "checkbox") input.checked = saved[name] === true;
    else input.value = saved[name];
  });
  [1, 2, 3].forEach((entryNumber) => syncZoneFields(row, entryNumber));
}

function setMode(mode) {
  benchmarkMode = mode === "strict" ? "strict" : "automatic";
  document.querySelectorAll('input[name="benchmarkMode"]').forEach((input) => {
    input.checked = input.value === benchmarkMode;
    input.closest(".mode-option").classList.toggle("selected", input.checked);
  });
  casePanel.classList.toggle("automatic-mode", benchmarkMode === "automatic");
  document.querySelector("#caseHeading").textContent = benchmarkMode === "automatic"
    ? "2. Review selected charts"
    : "2. Define the verified expected results";
  document.querySelector("#caseDescription").textContent = benchmarkMode === "automatic"
    ? "No expected values are required. The engine reads the chart and checks support/resistance, supply/demand, hidden Fibonacci confluence and entry order."
    : "Use strict mode for known charts. Saved values are restored automatically when the same chart file is selected again.";
  document.querySelector("#resultsHeading").textContent = benchmarkMode === "automatic"
    ? "3. Automatic batch report"
    : "3. Regression report";
  runButton.textContent = benchmarkMode === "automatic"
    ? "Analyse all charts"
    : "Run strict benchmarks";
  saveButton.hidden = benchmarkMode !== "strict";
  promoteButton.hidden = true;
  resultsPanel.hidden = true;
}

document.querySelectorAll('input[name="benchmarkMode"]').forEach((input) => {
  input.addEventListener("change", () => setMode(input.value));
});

fileInput.addEventListener("change", () => {
  files = Array.from(fileInput.files || []);
  rows.innerHTML = "";
  files.forEach((file, index) => {
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.index = index;
    row.querySelector("[data-file-name]").textContent = file.name;
    field(row, "label").value = file.name.replace(/\.[^.]+$/, "");
    restoreFixture(row, file);
    [1, 2, 3].forEach((entryNumber) => {
      field(row, `expectedEntry${entryNumber}Type`).addEventListener("change", () =>
        syncZoneFields(row, entryNumber)
      );
      syncZoneFields(row, entryNumber);
    });
    rows.appendChild(row);
  });
  casePanel.hidden = files.length === 0;
  resultsPanel.hidden = true;
});

saveButton.addEventListener("click", () => {
  if (!files.length) return;
  Array.from(rows.querySelectorAll("tr")).forEach((row, index) => {
    const saved = fixtureFromRow(row);
    localStorage.setItem(fixtureKey(files[index]), JSON.stringify(saved));
  });
  runStatus.textContent = "Expected values saved in this browser.";
  setTimeout(() => { if (runStatus.textContent.startsWith("Expected")) runStatus.textContent = ""; }, 2500);
});

clearButton.addEventListener("click", () => {
  files = [];
  rows.innerHTML = "";
  fileInput.value = "";
  casePanel.hidden = true;
  resultsPanel.hidden = true;
  lastRun = null;
});

function collectCases() {
  return Array.from(rows.querySelectorAll("tr")).map((row, index) => ({
    mode: benchmarkMode,
    autoDetectContext: benchmarkMode === "automatic",
    fileIndex: index,
    label: field(row, "label").value,
    instrument: field(row, "instrument").value,
    timeframe: field(row, "timeframe").value,
    plan: field(row, "plan").value,
    analysisType: field(row, "analysisType").value,
    cutoffMode: field(row, "cutoffMode").value,
    chartDate: field(row, "chartDate").value,
    expectedDirection: field(row, "expectedDirection").value,
    expectedEntry1: field(row, "expectedEntry1").value,
    expectedEntry1Type: field(row, "expectedEntry1Type").value,
    expectedEntry1ZoneLow: field(row, "expectedEntry1ZoneLow").value,
    expectedEntry1ZoneHigh: field(row, "expectedEntry1ZoneHigh").value,
    expectedEntry2: field(row, "expectedEntry2").value,
    expectedEntry2Type: field(row, "expectedEntry2Type").value,
    expectedEntry2ZoneLow: field(row, "expectedEntry2ZoneLow").value,
    expectedEntry2ZoneHigh: field(row, "expectedEntry2ZoneHigh").value,
    entry2Required: field(row, "entry2Required").checked,
    expectedEntry3: field(row, "expectedEntry3").value,
    expectedEntry3Type: field(row, "expectedEntry3Type").value,
    expectedEntry3ZoneLow: field(row, "expectedEntry3ZoneLow").value,
    expectedEntry3ZoneHigh: field(row, "expectedEntry3ZoneHigh").value,
    entry3Required: field(row, "entry3Required").checked,
    noEntryExpected: field(row, "noEntryExpected").checked,
    requiredLevels: field(row, "requiredLevels").value,
    requiredFeedbackLevels: field(row, "requiredFeedbackLevels").value,
    requiredFeedbackTerms: field(row, "requiredFeedbackTerms").value,
    forbiddenEntries: field(row, "forbiddenEntries").value,
    tolerance: field(row, "tolerance").value,
    notes: field(row, "notes").value,
  }));
}

function summaryCard(label, value) {
  return `<div class="summary-card"><strong>${value}</strong><span>${label}</span></div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));
}

function renderRun(run) {
  resultsPanel.hidden = false;
  const automatic = run.mode === "automatic" || run.results.every((item) => item.mode === "automatic");
  document.querySelector("#resultsHeading").textContent = automatic ? "3. Automatic batch report" : "3. Regression report";
  document.querySelector("#summaryText").textContent = automatic
    ? `Analysed ${run.summary.total} chart${run.summary.total === 1 ? "" : "s"} independently in ${(run.summary.durationMs / 1000).toFixed(1)} seconds. Verified charts are compared with their saved accuracy baselines; new charts are labelled rule-valid only and still require human review.`
    : `Completed ${new Date(run.runAt).toLocaleString()} in ${(run.summary.durationMs / 1000).toFixed(1)} seconds.`;
  document.querySelector("#summaryCards").innerHTML = [
    summaryCard("Total", run.summary.total), summaryCard(automatic ? "Accepted" : "Passed", run.summary.passed),
    summaryCard(automatic ? "Needs review" : "Failed", run.summary.failed), summaryCard("Errors", run.summary.errors),
  ].join("");
  document.querySelector("#resultCards").innerHTML = run.results.map((item) => {
    const checks = item.validation?.checks || [];
    const failures = checks.filter((check) => !check.passed);
    const headline = item.status === "error"
      ? escapeHtml(item.error)
      : `${item.validation.score}% · ${failures.length} failed check${failures.length === 1 ? "" : "s"}`;
    const detectedInstrument = item.analysis?.chartDetection?.detectedInstrument || "Not detected";
    const detectedTimeframe = item.analysis?.chartDetection?.detectedTimeframe || "Not detected";
    const direction = item.validation?.direction || "unknown";
    const entries = item.validation?.selectedEntries || [];
    const findingsHtml = item.mode === "automatic" && item.status !== "error"
      ? `<div class="auto-findings"><span><b>Chart:</b> ${escapeHtml(detectedInstrument)} ${escapeHtml(detectedTimeframe)}</span><span><b>Bias:</b> ${escapeHtml(direction)}</span><span><b>Entry 1:</b> ${escapeHtml(entries[0] ? `${entries[0].center} (${entries[0].areaType || "area"})` : "No valid entry")}</span><span><b>Entry 2:</b> ${escapeHtml(entries[1] ? `${entries[1].center} (${entries[1].areaType || "area"})` : "Not selected")}</span><span><b>Entry 3:</b> ${escapeHtml(entries[2] ? `${entries[2].center} (${entries[2].areaType || "area"})` : "Not selected")}</span></div>`
      : "";
    const checkHtml = checks.map((check) => `<li class="${check.passed ? "pass" : "fail"}">${check.passed ? "✓" : "✕"} ${escapeHtml(check.label)}${check.passed ? "" : ` — ${escapeHtml(check.details)}`}</li>`).join("");
    const statusLabel = item.mode === "automatic"
      ? item.status === "passed"
        ? item.verifiedBaselineId ? "baseline match" : "rule-valid"
        : item.status === "failed"
        ? item.verifiedBaselineId ? "baseline mismatch" : "needs review"
        : item.status
      : item.status;
    const baselineHtml = item.verifiedBaselineId
      ? `<p class="baseline-note">Compared with verified baseline ${escapeHtml(item.verifiedBaselineId)}.</p>`
      : `<p class="baseline-note">Rule checks only; accuracy has not yet been verified.</p>`;
    return `<article class="result ${item.status}"><div class="result-top"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.fileName)} · ${(item.durationMs / 1000).toFixed(1)}s</p></div><span class="badge">${escapeHtml(statusLabel)}</span></div><p>${headline}</p>${baselineHtml}${findingsHtml}${checkHtml ? `<ul class="checks">${checkHtml}</ul>` : ""}<details><summary>Full analysis response</summary><pre>${escapeHtml(JSON.stringify(item.analysis, null, 2))}</pre></details></article>`;
  }).join("");
  promoteButton.hidden = !(
    automatic &&
    run.results.length === files.length &&
    run.results.every((item) => item.status === "passed")
  );
  resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

promoteButton.addEventListener("click", () => {
  if (!lastRun || lastRun.mode !== "automatic") return;
  if (lastRun.results.length !== files.length || lastRun.results.some((item) => item.status !== "passed")) {
    return alert("Every automatic result must be consistent before this batch can be saved as strict benchmarks.");
  }
  if (!confirm("Save these reviewed automatic results as strict regression benchmarks? You can edit any value before running the strict test.")) return;

  const rowList = Array.from(rows.querySelectorAll("tr"));
  lastRun.results.forEach((item, index) => {
    const fixture = strictFixtureFromAutomaticResult(item, fixtureFromRow(rowList[index]));
    applyFixtureToRow(rowList[index], fixture);
    localStorage.setItem(fixtureKey(files[index]), JSON.stringify(fixture));
  });

  setMode("strict");
  runStatus.textContent = `${files.length} strict benchmark${files.length === 1 ? "" : "s"} saved. Review the populated values, then run the strict regression.`;
  casePanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

runButton.addEventListener("click", async () => {
  if (!adminKey.value) return alert("Enter the benchmark admin key.");
  const cases = collectCases();
  if (benchmarkMode === "strict" && cases.some((item) => !item.instrument.trim())) return alert("Enter an instrument for every chart in strict regression mode.");
  for (const item of benchmarkMode === "strict" ? cases : []) {
    for (const entryNumber of [1, 2, 3]) {
      const low = item[`expectedEntry${entryNumber}ZoneLow`];
      const high = item[`expectedEntry${entryNumber}ZoneHigh`];
      if (Boolean(low) !== Boolean(high)) {
        return alert(`Enter both zone boundaries for Entry ${entryNumber}, or leave both blank.`);
      }
      if (low && Number(low) >= Number(high)) {
        return alert(`Entry ${entryNumber} zone lower boundary must be below its upper boundary.`);
      }
    }
  }
  if (benchmarkMode === "strict" && cases.some((item) => item.noEntryExpected && (item.expectedEntry1 || item.expectedEntry2 || item.entry2Required || item.expectedEntry3 || item.entry3Required))) {
    return alert("A chart marked 'No valid entry expected' cannot also require an entry.");
  }
  sessionStorage.setItem("csaBenchmarkAdminKey", adminKey.value);
  const body = new FormData();
  files.forEach((file) => body.append("charts", file));
  body.append("cases", JSON.stringify(cases));
  runButton.disabled = true;
  runStatus.textContent = `Running ${files.length} chart${files.length === 1 ? "" : "s"}…`;
  try {
    const response = await fetch("/api/run", { method:"POST", headers:{ "x-benchmark-key": adminKey.value }, body });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error || "Benchmark run failed.");
    lastRun = payload;
    renderRun(payload);
  } catch (error) {
    alert(error.message);
  } finally {
    runButton.disabled = false;
    runStatus.textContent = "";
  }
});

setMode("automatic");

exportButton.addEventListener("click", () => {
  if (!lastRun) return;
  const blob = new Blob([JSON.stringify(lastRun, null, 2)], { type:"application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `csa-benchmark-${lastRun.runAt.slice(0,19).replace(/[:T]/g,"-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});
