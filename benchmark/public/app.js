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

function normalizeStructuralType(value) {
  const type = String(value || "structure").trim().toLowerCase();
  if (type.includes("converted support")) return "converted support";
  if (type.includes("converted resistance")) return "converted resistance";
  if (type.includes("demand")) return "demand";
  if (type.includes("supply")) return "supply";
  if (type.includes("support")) return "support";
  if (type.includes("resistance")) return "resistance";
  return "structure";
}

function structuralPriceText(candidate, precision) {
  const low = Number(candidate?.zoneLow);
  const high = Number(candidate?.zoneHigh);
  const center = Number(candidate?.price ?? candidate?.authoritativeCenter);
  if (Number.isFinite(low) && Number.isFinite(high) && high > low) {
    return `${low.toFixed(precision)}–${high.toFixed(precision)}`;
  }
  return Number.isFinite(center) ? center.toFixed(precision) : "price unreadable";
}

function structuralCandidateKey(candidate) {
  const type = normalizeStructuralType(candidate?.areaType ?? candidate?.type);
  const low = Number(candidate?.zoneLow);
  const high = Number(candidate?.zoneHigh);
  const center = Number(candidate?.price ?? candidate?.authoritativeCenter);
  return [type, Number.isFinite(low) ? low : "", Number.isFinite(high) ? high : "", Number.isFinite(center) ? center : ""].join(":");
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
    const selectorDiagnostics = item.analysis?.analysisFacts?.selectorDiagnostics || {};
    const diagnosticEntries = selectorDiagnostics.selectedEntries || [];
    const fibonacci = selectorDiagnostics.fibonacci || {};
    const structuralCandidates = (() => {
      const candidates = Array.isArray(selectorDiagnostics.structuralCandidates)
        ? selectorDiagnostics.structuralCandidates
        : [];
      const references = Array.isArray(item.analysis?.analysisFacts?.structuralReferenceAreas)
        ? item.analysis.analysisFacts.structuralReferenceAreas.map((reference) => ({
            ...reference,
            price: reference?.authoritativeCenter ?? reference?.price,
            sourceKind: reference?.referenceOnly ? "additional structural reference" : reference?.sourceKind,
          }))
        : [];
      const seen = new Set();
      return [...candidates, ...references].filter((candidate) => {
        const key = structuralCandidateKey(candidate);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })();
    const structureAuditHtml = (() => {
      const precisionSeed = structuralCandidates.find((candidate) =>
        Number.isFinite(Number(candidate?.price ?? candidate?.authoritativeCenter))
      );
      const precisionValue = Number(precisionSeed?.price ?? precisionSeed?.authoritativeCenter);
      const precision = Math.min(6, Math.max(2, String(precisionValue).split(".")[1]?.length || 2));
      if (!structuralCandidates.length) {
        return `<details class="structure-audit" open><summary>S/R and S/D level audit</summary><p>No support, resistance, supply or demand level was returned. This chart requires review.</p></details>`;
      }
      const selectedKeys = new Set(diagnosticEntries.map(structuralCandidateKey));
      const rows = structuralCandidates.map((candidate) => {
        const type = normalizeStructuralType(candidate?.areaType ?? candidate?.type);
        const source = [candidate?.sourceKind, candidate?.sourceDate].filter(Boolean).join(" · ");
        const selected = selectedKeys.has(structuralCandidateKey(candidate));
        const state = selected ? "qualified entry" : "structural reference";
        return `<li class="structure-level ${escapeHtml(type.replace(/\s+/g, "-"))}"><span class="structure-line" aria-hidden="true"></span><span><b>${escapeHtml(type)}</b> ${escapeHtml(structuralPriceText(candidate, precision))}<small>${escapeHtml(source || state)} · ${escapeHtml(state)}</small></span></li>`;
      }).join("");
      const detectedTypes = [...new Set(structuralCandidates.map((candidate) => normalizeStructuralType(candidate?.areaType ?? candidate?.type)))];
      return `<details class="structure-audit" open><summary>S/R and S/D level audit — ${structuralCandidates.length} detected</summary><p class="structure-summary">Detected: ${escapeHtml(detectedTypes.join(", "))}. These levels remain visible even when Fibonacci verification prevents entry selection.</p><ul class="structure-levels">${rows}</ul></details>`;
    })();
    const periodInventory = Array.isArray(selectorDiagnostics.periodInventory)
      ? selectorDiagnostics.periodInventory
      : Array.isArray(selectorDiagnostics.periodDayInventory)
      ? selectorDiagnostics.periodDayInventory
      : [];
    const periodInventoryAuditHtml = (() => {
      if (!periodInventory.length) {
        return `<details class="period-audit" open><summary>D1/W1 candle high-low inventory</summary><p>The required timeframe-specific candle inventory was not returned. This chart requires review before S/R, S/D or entry selection can be accepted.</p></details>`;
      }
      const seed = periodInventory.find((period) => Number.isFinite(Number(period?.high)));
      const precision = Math.min(6, Math.max(2, String(seed?.high || "").split(".")[1]?.length || 2));
      const rows = periodInventory.map((period, index) => `<tr><th>${escapeHtml(period.periodLabel || `Period ${index + 1}`)}</th><td>${escapeHtml(period.sourceUnit || "")}</td><td>${Number(period.high).toFixed(precision)}</td><td>${Number(period.low).toFixed(precision)}</td></tr>`).join("");
      return `<details class="period-audit" open><summary>D1/W1 candle high-low inventory — ${periodInventory.length} period${periodInventory.length === 1 ? "" : "s"}</summary><table class="period-inventory"><thead><tr><th>Period</th><th>Source</th><th>High</th><th>Low</th></tr></thead><tbody>${rows}</tbody></table></details>`;
    })();
    const fibLabelForEntry = (entry, index) => {
      const diagnostic = diagnosticEntries.find((candidate) => Number(candidate?.executionOrder) === index + 1) || {};
      const matches = Array.isArray(diagnostic?.fibonacciMatches) ? diagnostic.fibonacciMatches : [];
      const labels = [...new Set(matches.map((match) => {
        const ratio = Number(match?.ratio);
        const explicitLabel = String(match?.label || "").trim();
        const label = explicitLabel.toLowerCase().startsWith("between ")
          ? explicitLabel
          : Number.isFinite(ratio)
          ? (ratio === 0.5 ? "50%" : `${(ratio * 100).toFixed(1)}%`)
          : explicitLabel.replace(/\.0(?=%)/, "");
        const price = Number(match?.price);
        const precision = String(entry?.levelText || entry?.center || "").split(".")[1]?.length;
        const formattedPrice = Number.isFinite(price)
          ? Number.isInteger(precision) && precision > 0 && precision <= 6
            ? price.toFixed(precision)
            : String(price)
          : "";
        return label && formattedPrice ? `${label} @ ${formattedPrice}` : label;
      }).filter(Boolean))];
      return entry && labels.length ? ` · Fib: ${labels.join(" / ")}` : "";
    };
    const fibAuditHtml = (() => {
      const high = Number(fibonacci.swingHigh);
      const low = Number(fibonacci.swingLow);
      const range = high - low;
      if (!Number.isFinite(high) || !Number.isFinite(low) || !(range > 0)) {
        return `<details class="fib-audit"><summary>Fibonacci selection audit</summary><p>Current-period high/low could not be read. No-entry output must be reviewed, not accepted.</p></details>`;
      }
      const levels = direction === "bearish"
        ? [["38.2%", low + range * 0.382], ["50%", low + range * 0.5], ["61.8%", low + range * 0.618]]
        : [["38.2%", high - range * 0.382], ["50%", high - range * 0.5], ["61.8%", high - range * 0.618]];
      const precision = Math.min(6, Math.max(2, String(entries[0]?.levelText || high).split(".")[1]?.length || 2));
      const candidates = structuralCandidates;
      const selectedPrices = new Set(diagnosticEntries.map((candidate) => Number(candidate?.authoritativeCenter ?? candidate?.resolvedEntryPrice)).filter(Number.isFinite));
      const candidateRows = candidates.length
        ? candidates.map((candidate) => {
            const price = Number(candidate?.price ?? candidate?.authoritativeCenter);
            const state = selectedPrices.has(price) ? "selected" : "not selected";
            const source = [candidate?.sourceDay, candidate?.sourceKind, candidate?.sourceDate].filter(Boolean).join(" · ");
            return `<li>${escapeHtml(source || "source not read")} — ${escapeHtml(String(candidate?.areaType || "structure"))} ${Number.isFinite(price) ? price.toFixed(precision) : "unreadable"} — ${state}</li>`;
          }).join("")
        : "<li>No structural candidates were returned.</li>";
      return `<details class="fib-audit"><summary>Fibonacci selection audit</summary><p>Frame: ${escapeHtml(String(fibonacci.source || "current period"))}; high ${high.toFixed(precision)}, low ${low.toFixed(precision)}.</p><p>Fib: ${levels.map(([label, price]) => `${label} ${price.toFixed(precision)}`).join(" · ")}</p><p><b>Every structural candidate</b></p><ul>${candidateRows}</ul></details>`;
    })();
    const fibFrameSummary = (() => {
      const high = Number(fibonacci.swingHigh);
      const low = Number(fibonacci.swingLow);
      if (!Number.isFinite(high) || !Number.isFinite(low) || !(high > low)) return "Current-period high/low not verified";
      const precision = Math.min(6, Math.max(2, String(entries[0]?.levelText || high).split(".")[1]?.length || 2));
      return `${String(fibonacci.source || "current period").replace(/^uploaded_chart_visible_current_/, "current ").replace(/_high_low$/, "")} · high ${high.toFixed(precision)} · low ${low.toFixed(precision)}`;
    })();
    const findingsHtml = item.mode === "automatic" && item.status !== "error"
      ? `<div class="auto-findings"><span><b>Chart:</b> ${escapeHtml(detectedInstrument)} ${escapeHtml(detectedTimeframe)}</span><span><b>Bias:</b> ${escapeHtml(direction)}</span><span><b>Fib frame:</b> ${escapeHtml(fibFrameSummary)}</span><span><b>Entry 1:</b> ${escapeHtml(entries[0] ? `${entries[0].center} (${entries[0].areaType || "area"})${fibLabelForEntry(entries[0], 0)}` : "No valid entry")}</span><span><b>Entry 2:</b> ${escapeHtml(entries[1] ? `${entries[1].center} (${entries[1].areaType || "area"})${fibLabelForEntry(entries[1], 1)}` : "Not selected")}</span><span><b>Entry 3:</b> ${escapeHtml(entries[2] ? `${entries[2].center} (${entries[2].areaType || "area"})${fibLabelForEntry(entries[2], 2)}` : "Not selected")}</span></div>`
      : "";
    const checkHtml = checks.map((check) => `<li class="${check.passed ? "pass" : "fail"}">${check.passed ? "✓" : "✕"} ${escapeHtml(check.label)}${!check.passed || check.id === "automatic_fibonacci_confluence" ? ` — ${escapeHtml(check.details)}` : ""}</li>`).join("");
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
    return `<article class="result ${item.status}"><div class="result-top"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.fileName)} · ${(item.durationMs / 1000).toFixed(1)}s</p></div><span class="badge">${escapeHtml(statusLabel)}</span></div><p>${headline}</p>${baselineHtml}${findingsHtml}${periodInventoryAuditHtml}${structureAuditHtml}${fibAuditHtml}${checkHtml ? `<ul class="checks">${checkHtml}</ul>` : ""}<details><summary>Full analysis response</summary><pre>${escapeHtml(JSON.stringify(item.analysis, null, 2))}</pre></details></article>`;
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
