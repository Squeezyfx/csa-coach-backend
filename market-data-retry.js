// One failed market data request used to leave a review with no chart and with levels guessed from the
// screenshot (USDCAD H1, 28 Nov 2026), and nothing recorded why. A passing failure is now tried again and
// then asked of the backup provider.

// Only failures that can pass on their own. A rejected key, a missing symbol or no history would fail again.
const PASSING_FAILURES = new Set(["provider_error", "rate_limit"]);

export const isPassingFailure = (reference) => reference?.ok === false && PASSING_FAILURES.has(reference.failureCategory);

export async function fetchMarketReferenceReliably({
  fetchPrimary,
  fetchBackup = null,
  waits = [700, 2000],
  slowMs = 15000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}) {
  const started = now();
  let reference = await fetchPrimary();
  // A request that already took long (a timeout) is not repeated: the trader is waiting.
  for (let attempt = 0; attempt < waits.length && isPassingFailure(reference) && now() - started < slowMs; attempt += 1) {
    await sleep(waits[attempt]);
    log("[market-data] trying again, attempt " + (attempt + 2));
    reference = await fetchPrimary();
    if (reference?.ok) log("[market-data] succeeded on attempt " + (attempt + 2));
  }
  if (!isPassingFailure(reference) || !fetchBackup) return reference;
  let backup = null;
  try {
    backup = await fetchBackup();
  } catch (error) {
    backup = { ok: false, error: error?.message || String(error) };
  }
  log("[market-data] backup provider " + (backup?.ok ? "supplied the data" : "also failed: " + (backup?.error || "no data")));
  // Marked, so the review can tell the trader: the backup's levels can differ a little.
  return backup?.ok ? { ...backup, providerDiagnostics: { ...(backup.providerDiagnostics || {}), backupUsed: true } } : reference;
}

export const usedBackupData = (reference) => reference?.ok === true && reference.providerDiagnostics?.backupUsed === true;

// A review made during a data fault is not kept for re-use: running the same chart again must try the data again.
export const isDataFault = (reference) => usedBackupData(reference) || isPassingFailure(reference);

// No data from either source: the review stops rather than guess a direction from the screenshot. An
// instrument that has no data feed at all (or none for that far back, or on this data plan) is not a fault and
// is reviewed from the chart as before. NO_DATA_STOP=off turns the stop off.
const FAULTS = new Set(["provider_error", "rate_limit", "authentication"]);

// A 400 means the provider refused the request itself (an instrument it does not carry), so "try again" would
// never work.
export const shouldStopForMissingData = (reference) =>
  reference?.ok === false && FAULTS.has(reference.failureCategory) && !/\(400\)/.test(String(reference.error || ""));

export const NO_DATA_MESSAGE = "Market data is unavailable right now, so no review was made. This did not count against your reviews and nothing was saved. Please try again a little later.";

export const BACKUP_DATA_NOTE ="Our main price source was unavailable for this review, so a backup source was used. Levels may differ a little, so check them on your own chart.";
