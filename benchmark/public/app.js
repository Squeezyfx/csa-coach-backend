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
const batchOverview = document.querySelector("#batchOverview");
const diagnosticSummaryOnly = document.querySelector("#diagnosticSummaryOnly");
const diagnosticOption = document.querySelector("#diagnosticOption");
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
  diagnosticOption.hidden = benchmarkMode !== "automatic";
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
    diagnosticSummaryOnly:
      benchmarkMode === "automatic" && diagnosticSummaryOnly.checked,
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

function compactNumber(value, precisionSeed) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const decimals = Math.min(6, Math.max(2, String(precisionSeed ?? value).split(".")[1]?.length || 2));
  return number.toFixed(decimals);
}

function renderBatchOverview(run) {
  const rows = run.results.map((item) => {
    const analysis = item.analysis || {};
    const facts = analysis.analysisFacts || {};
    const diagnostics = facts.selectorDiagnostics || {};
    const audit = diagnostics.transparencyAudit || {};
    const allPeriods = Array.isArray(audit.periodStructureAudit) ? audit.periodStructureAudit : [];
    const periods = allPeriods.filter(period => period.highVerified === true && period.lowVerified === true);
    const entries = Array.isArray(diagnostics.selectedEntries) ? diagnostics.selectedEntries : [];
    const fib = diagnostics.fibonacci || {};
    const biasCode = String(analysis.csaDirectionalBias?.biasCode || "").toLowerCase();
    const provisional = analysis.csaDirectionalBias?.provisional === true || audit.fibonacciAudit?.verified === false;
    const structuralBias = ["bullish", "bearish", "range"].includes(biasCode) ? `${biasCode}${provisional ? " (provisional)" : ""}` : "unverified";
    const headlineBias = String(facts.direction || item.validation?.direction || "unknown").toLowerCase();
    const phase = analysis.csaDirectionalBias?.cutoffPhase?.phase || facts.historicalPhase?.phase || "not resolved";
    const seed = entries[0]?.levelText || fib.swingHigh || facts.currentPrice;
    const range = Number(fib.swingHigh) - Number(fib.swingLow);
    const fibLevels = Number.isFinite(range) && range > 0
      ? biasCode === "bearish"
        ? [Number(fib.swingLow) + range * .382, Number(fib.swingLow) + range * .5, Number(fib.swingLow) + range * .618]
        : [Number(fib.swingHigh) - range * .382, Number(fib.swingHigh) - range * .5, Number(fib.swingHigh) - range * .618]
      : [];
    const periodText = periods.length
      ? periods.map((period) => {
          const highStatus = period.highVerified === false ? "estimate—not selectable" : period.highRole || "verified extreme";
          const lowStatus = period.lowVerified === false ? "estimate—not selectable" : period.lowRole || "verified extreme";
          return `${period.period}: H ${compactNumber(period.high, seed)} (${highStatus}), L ${compactNumber(period.low, seed)} (${lowStatus})`;
        }).join(" · ")
      : allPeriods.length ? "Period prices unverified — estimates retained in Export JSON" : "No verified period inventory";
    const entryText = entries.length
      ? entries.map((entry, index) => {
          const match = Array.isArray(entry.fibonacciMatches) ? entry.fibonacciMatches[0] : null;
          const fibText = match ? `; ${match.label || "Fib"} @ ${compactNumber(match.price, seed)}` : "";
          const zoneLow = Number(entry.zoneLow);
          const zoneHigh = Number(entry.zoneHigh);
          const hasZoneRange = Number.isFinite(zoneLow) && Number.isFinite(zoneHigh) && zoneHigh > zoneLow;
          const displayedPrice = hasZoneRange
            ? `${compactNumber(zoneLow, seed)}–${compactNumber(zoneHigh, seed)}`
            : compactNumber(entry.resolvedEntryPrice ?? entry.authoritativeCenter, seed);
          return `E${index + 1} ${entry.sourceKind || entry.sourcePeriod || "—"} ${entry.areaType || "area"} ${displayedPrice}${fibText}`;
        }).join(" · ")
      : "No selected entry";
    const flags = [];
    const dataMatch = audit.inventoryAuthority?.dataMatch;
    const providerFailure = audit.inventoryAuthority?.providerFailure;
    if (dataMatch?.status === "matched_reference") flags.push("Provider reference; not broker-exact");
    if (providerFailure) flags.push(`Data: ${providerFailure.category} — ${providerFailure.reason}`);
    if (audit.fibonacciAudit?.verified === false) flags.push("Fib frame unverified—no entries permitted");
    if (structuralBias === "unverified") flags.push("bias unverified");
    if (structuralBias !== "unverified" && headlineBias !== biasCode) flags.push(`headline says ${headlineBias}`);
    if (!(Number(fib.swingHigh) > Number(fib.swingLow))) flags.push("Fib frame missing");
    if (item.status !== "passed") flags.push("validation review");
    const conflictCount = Array.isArray(audit.provenanceConflicts)
      ? audit.provenanceConflicts.filter((conflict) => conflict?.requiresReview === true).length
      : 0;
    if (conflictCount) flags.push(`${conflictCount} price conflict${conflictCount === 1 ? "" : "s"}`);
    return `<tr class="${flags.length ? "overview-review" : "overview-clear"}"><th>${escapeHtml(`${facts.instrument || analysis.detectedPair || "Unknown"} ${facts.timeframe || analysis.detectedTimeframe || ""}`)}</th><td><b>${escapeHtml(structuralBias)}</b><small>${escapeHtml(String(phase).replaceAll("_", " "))}</small></td><td>${escapeHtml(compactNumber(facts.currentPrice, seed))}</td><td>${escapeHtml(Number(fib.swingHigh) > Number(fib.swingLow) ? `H ${compactNumber(fib.swingHigh, seed)} / L ${compactNumber(fib.swingLow, seed)}` : "Not verified")}<small>${escapeHtml(fibLevels.length ? `38.2 ${compactNumber(fibLevels[0], seed)} · 50 ${compactNumber(fibLevels[1], seed)} · 61.8 ${compactNumber(fibLevels[2], seed)}` : "")}</small></td><td class="overview-periods">${escapeHtml(periodText)}</td><td>${escapeHtml(entryText)}</td><td>${escapeHtml(flags.length ? flags.join("; ") : "clear")}</td></tr>`;
  }).join("");
  const guidance = run.diagnosticSummaryOnly
    ? "Credit-saving view: complete troubleshooting data remains available through Export JSON."
    : "Structural bias and current phase are separated. Expand a chart below only when a row needs investigation.";
  batchOverview.innerHTML = `<div class="overview-heading"><div><h3>Batch diagnosis summary</h3><p>${escapeHtml(guidance)}</p></div><label><input id="reviewOnly" type="checkbox"> Show review rows only</label></div><div class="audit-table-wrap"><table class="overview-table"><thead><tr><th>Chart</th><th>Structural bias / phase</th><th>Current</th><th>Fib frame / levels</th><th>Period highs & lows</th><th>Entries</th><th>Review flags</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  batchOverview.querySelector("#reviewOnly")?.addEventListener("change", (event) => {
    batchOverview.querySelectorAll("tbody tr").forEach((row) => {
      row.hidden = event.target.checked && !row.classList.contains("overview-review");
    });
  });
}

function renderRun(run) {
  resultsPanel.hidden = false;
  const automatic = run.mode === "automatic" || run.results.every((item) => item.mode === "automatic");
  document.querySelector("#resultsHeading").textContent = automatic ? "3. Automatic batch report" : "3. Regression report";
  document.querySelector("#summaryText").textContent = automatic
    ? `Analysed ${run.summary.total} chart${run.summary.total === 1 ? "" : "s"} independently in ${(run.summary.durationMs / 1000).toFixed(1)} seconds. ${run.diagnosticSummaryOnly ? "Credit-saving diagnostic mode skipped full AI coaching and retained the structural audit." : "Full feedback mode generated the customer-facing review."} Verified charts are compared with saved accuracy baselines; new charts still require human review.`
    : `Completed ${new Date(run.runAt).toLocaleString()} in ${(run.summary.durationMs / 1000).toFixed(1)} seconds.`;
  document.querySelector("#summaryCards").innerHTML = [
    summaryCard("Total", run.summary.total), summaryCard(automatic ? "Accepted" : "Passed", run.summary.passed),
    summaryCard(automatic ? "Needs review" : "Failed", run.summary.failed), summaryCard("Errors", run.summary.errors),
  ].join("");
  renderBatchOverview(run);
  document.querySelector("#resultCards").innerHTML = run.diagnosticSummaryOnly ? "" : run.results.map((item) => {
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
    const transparencyAudit = selectorDiagnostics.transparencyAudit || {};
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
      const auditedRows = Array.isArray(transparencyAudit.periodStructureAudit)
        ? transparencyAudit.periodStructureAudit
        : [];
      const authority = transparencyAudit.inventoryAuthority || {};
      const endpoint = authority.finalVisibleCandle || {};
      const authorityText = authority.selectedSource || "not reported";
      const endpointText = [endpoint.high, endpoint.low, endpoint.close].every((value) => Number.isFinite(Number(value)))
        ? `Final candle header: high ${Number(endpoint.high).toFixed(precision)}, low ${Number(endpoint.low).toFixed(precision)}, close ${Number(endpoint.close).toFixed(precision)}.`
        : "Final candle header OHLC was not fully readable.";
      const rows = periodInventory.map((period, index) => {
        const label = period.periodLabel || `Period ${index + 1}`;
        const audit = auditedRows.find((row) => String(row?.period) === String(label)) || {};
        const highRole = audit.highOriginalRole && audit.highRole && audit.highOriginalRole !== audit.highRole
          ? `${audit.highOriginalRole} → ${audit.highRole}`
          : audit.highRole || "not classified";
        const lowRole = audit.lowOriginalRole && audit.lowRole && audit.lowOriginalRole !== audit.lowRole
          ? `${audit.lowOriginalRole} → ${audit.lowRole}`
          : audit.lowRole || "not classified";
        const auditedHighRole = audit.highVerified === false ? "estimate—not selectable" : highRole;
        const auditedLowRole = audit.lowVerified === false ? "estimate—not selectable" : lowRole;
        return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(period.date || "")}</td><td>${Number(period.high).toFixed(precision)}</td><td>${escapeHtml(auditedHighRole)}</td><td>${Number(period.low).toFixed(precision)}</td><td>${escapeHtml(auditedLowRole)}</td><td>${escapeHtml(audit.source || period.source || period.sourceUnit || "")}</td></tr>`;
      }).join("");
      return `<details class="period-audit" open><summary>D1/W1/MN candle high-low and structure inventory — ${periodInventory.length} period${periodInventory.length === 1 ? "" : "s"}</summary><p>Each high and low remains tied to its own higher-timeframe candle and structural classification.</p><p><b>Inventory authority:</b> ${escapeHtml(authorityText)} · chart verified: ${authority.focusedInventoryVerified === true ? "yes" : "no"} · market verified: ${authority.marketInventoryVerified === true ? "yes" : "no"}. ${escapeHtml(endpointText)}</p><div class="audit-table-wrap"><table class="period-inventory"><thead><tr><th>Period</th><th>Date</th><th>High</th><th>High role</th><th>Low</th><th>Low role</th><th>Price source</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
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
      const auditedCandidates = Array.isArray(transparencyAudit.candidateEvaluationAudit)
        ? transparencyAudit.candidateEvaluationAudit
        : [];
      const candidateRows = auditedCandidates.length
        ? auditedCandidates.map((candidate) => {
            const price = Number(candidate?.price);
            const fibPrice = Number(candidate?.nearestFibPrice);
            const fibRatio = Number(candidate?.nearestFibRatio);
            const nearestFib = Number.isFinite(fibRatio) && Number.isFinite(fibPrice)
              ? `${fibRatio === 0.5 ? "50.0" : (fibRatio * 100).toFixed(1)}% @ ${fibPrice.toFixed(precision)}`
              : "none";
            const result = candidate?.qualified === true
              ? "QUALIFIED"
              : `REJECTED: ${(candidate?.rejectionReasons || []).join("; ") || "failed selection gate"}`;
            return `<tr><td>${escapeHtml(candidate?.period || "—")}</td><td>${escapeHtml(candidate?.extreme || "—")}</td><td>${escapeHtml(candidate?.structuralRole || "structure")}</td><td>${Number.isFinite(price) ? price.toFixed(precision) : "unreadable"}</td><td>${escapeHtml(nearestFib)}</td><td>${candidate?.insideAcceptedBand === true ? "yes" : "no"}</td><td>${escapeHtml(candidate?.provenance || "not verified")}</td><td class="${candidate?.qualified === true ? "audit-pass" : "audit-fail"}">${escapeHtml(result)}</td></tr>`;
          }).join("")
        : `<tr><td colspan="8">No evaluated structural candidates were returned.</td></tr>`;
      const fibFrame = transparencyAudit.fibonacciAudit || {};
      const bandLow = Number(fibFrame.acceptedBandLow);
      const bandHigh = Number(fibFrame.acceptedBandHigh);
      const bandText = Number.isFinite(bandLow) && Number.isFinite(bandHigh)
        ? `${bandLow.toFixed(precision)}–${bandHigh.toFixed(precision)}`
        : "not available";
      return `<details class="fib-audit" open><summary>Fibonacci range and candidate selection audit</summary><p><b>Fib prices used:</b> high ${high.toFixed(precision)}, low ${low.toFixed(precision)} · source: ${escapeHtml(String(fibonacci.source || "current period"))}</p><p><b>Calculated retracement:</b> ${levels.map(([label, price]) => `${label} ${price.toFixed(precision)}`).join(" · ")} · accepted structure band ${escapeHtml(bandText)}</p><div class="audit-table-wrap"><table class="candidate-audit"><thead><tr><th>Period</th><th>Extreme</th><th>S/R or S/D</th><th>Price</th><th>Nearest Fib</th><th>Inside 38.2–61.8</th><th>Provenance</th><th>Decision</th></tr></thead><tbody>${candidateRows}</tbody></table></div></details>`;
    })();
    const entryDecisionAuditHtml = (() => {
      const decisions = Array.isArray(transparencyAudit.entryDecisionAudit)
        ? transparencyAudit.entryDecisionAudit
        : [];
      if (!decisions.length) return "";
      const seed = decisions.find((decision) => Number.isFinite(Number(decision?.price)));
      const precision = Math.min(6, Math.max(2, String(seed?.price || "").split(".")[1]?.length || 2));
      const rows = decisions.map((decision) => {
        if (decision?.selected !== true) {
          return `<tr><th>Entry ${Number(decision?.entry || 0)}</th><td colspan="7">Not selected — ${escapeHtml(decision?.reason || "no qualifying area")}</td></tr>`;
        }
        const price = Number(decision.price);
        const fibRatio = Number(decision.nearestFibRatio);
        const fibPrice = Number(decision.nearestFibPrice);
        const fibText = Number.isFinite(fibRatio) && Number.isFinite(fibPrice)
          ? `${fibRatio === 0.5 ? "50.0" : (fibRatio * 100).toFixed(1)}% @ ${fibPrice.toFixed(precision)}`
          : decision.confluenceRule || "inside accepted band";
        return `<tr><th>Entry ${Number(decision.entry)}</th><td>${escapeHtml(decision.period || "—")}</td><td>${escapeHtml(decision.extreme || "—")}</td><td>${escapeHtml(decision.structuralRole || "—")}</td><td>${Number.isFinite(price) ? price.toFixed(precision) : "—"}</td><td>${escapeHtml(fibText)}</td><td>${escapeHtml(decision.confluenceRule || "")}</td><td>${escapeHtml(decision.provenance || "")}</td></tr>`;
      }).join("");
      return `<details class="entry-audit" open><summary>Entry 1–3 decision audit</summary><div class="audit-table-wrap"><table><thead><tr><th>Entry</th><th>Period</th><th>Extreme</th><th>Structural role</th><th>Price</th><th>Nearest Fib</th><th>Confluence rule</th><th>Price source</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
    })();
    const provenanceConflictHtml = (() => {
      const conflicts = Array.isArray(transparencyAudit.provenanceConflicts)
        ? transparencyAudit.provenanceConflicts
        : [];
      if (!conflicts.length) return `<details class="provenance-audit"><summary>Price-source conflicts — none</summary><p>No conflicting or unverified structural price was found.</p></details>`;
      const rows = conflicts.map((conflict) => {
        const values = conflict.extreme === "count"
          ? `chart ${conflict.chartCount}, market ${conflict.marketCount}`
          : Number.isFinite(Number(conflict.chartPrice)) && Number.isFinite(Number(conflict.marketPrice))
          ? `${conflict.extreme}: chart ${conflict.chartPrice}, market ${conflict.marketPrice}`
          : String(conflict.claimedPrice ?? conflict.conflictingFrameworkPrice ?? "unknown price");
        return `<li><b>${escapeHtml(conflict.period || conflict.claimedSource || "Unverified source")}</b> — ${escapeHtml(values)} — ${escapeHtml(conflict.resolution || "rejected")}</li>`;
      }).join("");
      return `<details class="provenance-audit" open><summary>Price-source conflicts — ${conflicts.length}</summary><p>These values were exposed instead of silently entering the selector.</p><ul>${rows}</ul></details>`;
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
    return `<article class="result ${item.status}"><div class="result-top"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.fileName)} · ${(item.durationMs / 1000).toFixed(1)}s</p></div><span class="badge">${escapeHtml(statusLabel)}</span></div><p>${headline}</p>${baselineHtml}${findingsHtml}${periodInventoryAuditHtml}${structureAuditHtml}${fibAuditHtml}${entryDecisionAuditHtml}${provenanceConflictHtml}${checkHtml ? `<ul class="checks">${checkHtml}</ul>` : ""}<details><summary>Full analysis response</summary><pre>${escapeHtml(JSON.stringify(item.analysis, null, 2))}</pre></details></article>`;
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
