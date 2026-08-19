const fileInput = document.querySelector("#chartFiles");
const rows = document.querySelector("#caseRows");
const template = document.querySelector("#caseTemplate");
const casePanel = document.querySelector("#casePanel");
const resultsPanel = document.querySelector("#resultsPanel");
const runButton = document.querySelector("#runButton");
const clearButton = document.querySelector("#clearButton");
const exportButton = document.querySelector("#exportButton");
const runStatus = document.querySelector("#runStatus");
const adminKey = document.querySelector("#adminKey");
let files = [];
let lastRun = null;

adminKey.value = sessionStorage.getItem("csaBenchmarkAdminKey") || "";
adminKey.addEventListener("change", () => sessionStorage.setItem("csaBenchmarkAdminKey", adminKey.value));

function field(row, name) { return row.querySelector(`[data-field="${name}"]`); }

fileInput.addEventListener("change", () => {
  files = Array.from(fileInput.files || []);
  rows.innerHTML = "";
  files.forEach((file, index) => {
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.index = index;
    row.querySelector("[data-file-name]").textContent = file.name;
    field(row, "label").value = file.name.replace(/\.[^.]+$/, "");
    rows.appendChild(row);
  });
  casePanel.hidden = files.length === 0;
  resultsPanel.hidden = true;
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
    expectedEntry2: field(row, "expectedEntry2").value,
    entry2Required: field(row, "entry2Required").checked,
    requiredLevels: field(row, "requiredLevels").value,
    requiredFeedbackLevels: field(row, "requiredFeedbackLevels").value,
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
  document.querySelector("#summaryText").textContent = `Completed ${new Date(run.runAt).toLocaleString()} in ${(run.summary.durationMs / 1000).toFixed(1)} seconds.`;
  document.querySelector("#summaryCards").innerHTML = [
    summaryCard("Total", run.summary.total), summaryCard("Passed", run.summary.passed),
    summaryCard("Failed", run.summary.failed), summaryCard("Errors", run.summary.errors),
  ].join("");
  document.querySelector("#resultCards").innerHTML = run.results.map((item) => {
    const checks = item.validation?.checks || [];
    const failures = checks.filter((check) => !check.passed);
    const headline = item.status === "error"
      ? escapeHtml(item.error)
      : `${item.validation.score}% · ${failures.length} failed check${failures.length === 1 ? "" : "s"}`;
    const checkHtml = checks.map((check) => `<li class="${check.passed ? "pass" : "fail"}">${check.passed ? "✓" : "✕"} ${escapeHtml(check.label)}${check.passed ? "" : ` — ${escapeHtml(check.details)}`}</li>`).join("");
    return `<article class="result ${item.status}"><div class="result-top"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.fileName)} · ${(item.durationMs / 1000).toFixed(1)}s</p></div><span class="badge">${escapeHtml(item.status)}</span></div><p>${headline}</p>${checkHtml ? `<ul class="checks">${checkHtml}</ul>` : ""}<details><summary>Full analysis response</summary><pre>${escapeHtml(JSON.stringify(item.analysis, null, 2))}</pre></details></article>`;
  }).join("");
  resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

runButton.addEventListener("click", async () => {
  if (!adminKey.value) return alert("Enter the benchmark admin key.");
  const cases = collectCases();
  if (cases.some((item) => !item.instrument.trim())) return alert("Enter an instrument for every chart.");
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

exportButton.addEventListener("click", () => {
  if (!lastRun) return;
  const blob = new Blob([JSON.stringify(lastRun, null, 2)], { type:"application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `csa-benchmark-${lastRun.runAt.slice(0,19).replace(/[:T]/g,"-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});
