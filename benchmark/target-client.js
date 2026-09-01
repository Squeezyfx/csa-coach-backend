const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export function parseRetryAfterMs(value, nowMs = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAt = Date.parse(raw);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - nowMs);
}

export function compactResponsePreview(value, maxLength = 320) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  if (!compact) return "empty response body";
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength)}…`
    : compact;
}

export async function fetchTextWithTimeout(
  url,
  options = {},
  timeoutMs = 300000,
  fetchImpl = fetch
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 300000));
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  try {
    return { parsed: true, payload: JSON.parse(text) };
  } catch {
    return { parsed: false, payload: null };
  }
}

function targetError(response, text, payload, parsed, attempts) {
  const status = Number(response?.status || 0);
  if (parsed) {
    const message = payload?.details || payload?.error || `Analysis failed with HTTP ${status}.`;
    return new Error(`${message}${attempts > 1 ? ` (after ${attempts} attempts)` : ""}`);
  }

  const contentType = String(response?.headers?.get?.("content-type") || "unknown");
  return new Error(
    `Target returned non-JSON content (HTTP ${status}, content-type ${contentType})` +
      `${attempts > 1 ? ` after ${attempts} attempts` : ""}. ` +
      `Response preview: ${compactResponsePreview(text)}`
  );
}

export async function requestJsonWithRetry({
  makeRequest,
  maxAttempts = 4,
  baseDelayMs = 15000,
  maxDelayMs = 120000,
  sleepImpl = sleep,
  onRetry = () => {},
}) {
  const attemptsAllowed = Math.max(1, Math.floor(Number(maxAttempts) || 1));

  for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
    const { response, text } = await makeRequest(attempt);
    const { parsed, payload } = parseJson(text);

    if (response.ok && parsed) {
      return { response, payload, attempts: attempt };
    }

    const retryable = RETRYABLE_HTTP_STATUSES.has(Number(response.status));
    if (!retryable || attempt >= attemptsAllowed) {
      throw targetError(response, text, payload, parsed, attempt);
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const exponentialDelay = Math.min(
      Math.max(0, Number(maxDelayMs) || 0),
      Math.max(0, Number(baseDelayMs) || 0) * 2 ** (attempt - 1)
    );
    const waitMs = retryAfterMs ?? exponentialDelay;
    onRetry({
      attempt,
      nextAttempt: attempt + 1,
      maxAttempts: attemptsAllowed,
      status: response.status,
      waitMs,
      responsePreview: compactResponsePreview(text),
    });
    await sleepImpl(waitMs);
  }

  throw new Error("Target request retry loop ended unexpectedly.");
}

export async function waitForTargetHealth({
  targetUrl,
  attempts = 5,
  timeoutMs = 90000,
  delayMs = 5000,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  const attemptsAllowed = Math.max(1, Math.floor(Number(attempts) || 1));
  let lastProblem = "No health response received.";

  for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
    try {
      const { response, text } = await fetchTextWithTimeout(
        `${String(targetUrl || "").replace(/\/+$/, "")}/health`,
        { method: "GET", headers: { accept: "application/json" } },
        timeoutMs,
        fetchImpl
      );
      const { parsed, payload } = parseJson(text);
      const healthy =
        response.ok &&
        parsed &&
        (payload?.ok === true || payload?.success === true);
      if (healthy) return { attempts: attempt, payload };

      lastProblem = `HTTP ${response.status}: ${compactResponsePreview(text)}`;
    } catch (error) {
      lastProblem = error?.name === "AbortError"
        ? "health check timed out"
        : String(error?.message || error);
    }

    if (attempt < attemptsAllowed) await sleepImpl(delayMs);
  }

  throw new Error(
    `The staging analysis service did not become healthy after ${attemptsAllowed} attempts. ` +
      `Last response: ${lastProblem}`
  );
}
