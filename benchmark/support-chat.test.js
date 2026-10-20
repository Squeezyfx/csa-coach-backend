import test from "node:test";
import assert from "node:assert/strict";
import {
  guideForAssistant,
  buildSystemPrompt,
  cleanHistory,
  buildMessages,
  dailyCap,
  capReached,
  startOfUtcDay,
  SUPPORT_LIMITS,
} from "../support-chat.js";

const guide = "# Guide\nintro **[OWNER TO FILL]** text\n## Part A. Rules\nbe kind\n## Part B. Product\nfacts\n## Part C. Notes for the build\nsecret build notes";

test("the guide for the assistant drops the build notes and owner markers", () => {
  const text = guideForAssistant(guide);
  assert.ok(text.includes("be kind"));
  assert.ok(text.includes("facts"));
  assert.ok(!text.includes("secret build notes"));
  assert.ok(!text.includes("OWNER TO FILL"));
});

test("the system prompt carries the guide, the format rules and the account facts", () => {
  const prompt = buildSystemPrompt({
    guideText: guide,
    account: { planLabel: "Pro", analysesUsed: 3, analysesLimit: 40, betaTester: false },
  });
  assert.ok(prompt.includes("facts"));
  assert.ok(prompt.includes("under about 120 words"));
  assert.ok(prompt.includes("<review_data>"));
  assert.ok(prompt.includes("Plan: Pro"));
  assert.ok(prompt.includes("3 used of 40"));
  assert.ok(!prompt.includes("beta tester"));
});

test("history keeps the last turns, starts with the person and is shortened", () => {
  const long = "x".repeat(5000);
  const history = [
    { role: "assistant", content: "hello" },
    { role: "user", content: "q1" },
    { role: "assistant", content: long },
    { role: "user", content: "q2" },
    { role: "bogus", content: "ignore me" },
    { role: "assistant", content: "a2" },
    { role: "user", content: "q3" },
    { role: "assistant", content: "a3" },
  ];
  const cleaned = cleanHistory(history);
  assert.equal(cleaned[0].role, "user");
  assert.ok(cleaned.length <= SUPPORT_LIMITS.maxHistoryItems);
  assert.ok(cleaned.every((row) => row.content.length <= SUPPORT_LIMITS.maxHistoryItemChars));
  assert.ok(!cleaned.some((row) => row.content === "ignore me"));
});

test("a review is attached as data and the question is limited", () => {
  const messages = buildMessages({
    question: "Explain this. " + "y".repeat(2000),
    history: [],
    reviewText: "DIRECTIONAL BIAS:\nBullish",
  });
  const last = messages[messages.length - 1];
  assert.equal(last.role, "user");
  assert.ok(last.content.includes("<review_data>"));
  assert.ok(last.content.includes("Bullish"));
  assert.ok(last.content.split("\n")[0].length <= SUPPORT_LIMITS.maxQuestionChars);
});

test("the daily limit uses the setting or 20, and counts from the start of the UTC day", () => {
  assert.equal(dailyCap({}), 20);
  assert.equal(dailyCap({ SUPPORT_DAILY_CAP: "5" }), 5);
  assert.equal(dailyCap({ SUPPORT_DAILY_CAP: "oops" }), 20);
  assert.equal(capReached(19, 20), false);
  assert.equal(capReached(20, 20), true);
  assert.equal(startOfUtcDay(new Date("2026-10-20T15:30:00Z")), "2026-10-20T00:00:00.000Z");
});
