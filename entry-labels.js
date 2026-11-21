// Beginner-friendly names for the entry areas: "Buy 1" / "Sell 1" instead of "Entry 1", so the direction of the
// trade is clear at a glance. Display only: the engine, its logs and the saved structured numbers keep using
// entry1 / entry2 / entry3. With no clear direction the old "Entry N" wording stays.

// "bullish"/"buy" -> "Buy", "bearish"/"sell" -> "Sell", anything else -> "Entry".
export function entryWordForDirection(direction) {
  const text = String(direction || "").toLowerCase();
  if (/sell|bearish|short/.test(text)) return "Sell";
  if (/buy|bullish|long/.test(text)) return "Buy";
  return "Entry";
}

// "Entry 2" -> "Buy 2". Only the numbered label: "Entry area", "Your entry" and "entry zone" are untouched.
export function relabelEntries(text, word) {
  if (typeof text !== "string" || !word || word === "Entry") return text;
  return text.replace(/\bEntry ([123])\b/g, `${word} $1`);
}

export function relabelEntriesDeep(value, word) {
  if (!word || word === "Entry") return value;
  if (typeof value === "string") return relabelEntries(value, word);
  if (Array.isArray(value)) return value.map((item) => relabelEntriesDeep(item, word));
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relabelEntriesDeep(item, word)]));
  }
  return value;
}

// The parts of a review response that the trader reads. Engine diagnostics, the saved facts and the model's own
// notes are left alone, so nothing that reads them can be affected.
export const CUSTOMER_TEXT_KEYS = ["analysis", "summary", "coachAdvice", "finalFeedback", "dashboard", "cleanChart"];

export function relabelCustomerText(body, word, keys = CUSTOMER_TEXT_KEYS) {
  if (!body || typeof body !== "object" || !word || word === "Entry") return body;
  const out = { ...body };
  for (const key of keys) {
    if (key in out) out[key] = relabelEntriesDeep(out[key], word);
  }
  return out;
}
