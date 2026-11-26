import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A debug route with no sign-in returned every period's high and low and used market data credits.
test("there is no open test route that returns market levels", () => {
  const server = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.doesNotMatch(server, /app\.(get|post)\(\s*["']\/test/);
  assert.match(server, /app\.get\("\/sample-analysis"/);
  assert.match(server, /app\.get\("\/journal-reviews"/);
});
