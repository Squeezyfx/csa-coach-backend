import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverSource = readFileSync(
  fileURLToPath(new URL("../server.js", import.meta.url)),
  "utf8"
);

test("focused automatic fallback inventories D1 candles for H1", () => {
  assert.match(serverSource, /treat each D1 candle inside the visible current trading week/);
  assert.match(serverSource, /Return Monday, Tuesday, Wednesday, Thursday and Friday separately/);
});

test("focused automatic fallback inventories W1 candles for H4", () => {
  assert.match(serverSource, /For H4, treat each W1 candle inside the visible current calendar month/);
  assert.match(serverSource, /Return W1, W2, W3, W4 and W5 when present/);
  assert.match(serverSource, /Do not skip, merge or renumber inventory periods/);
});

test("period inventory remains separate from the Fibonacci frame", () => {
  assert.match(serverSource, /This Fibonacci frame qualifies structure but does not replace the individual D1\/W1 inventory/);
  assert.match(serverSource, /currentPeriodHigh/);
  assert.match(serverSource, /periodInventory/);
});
