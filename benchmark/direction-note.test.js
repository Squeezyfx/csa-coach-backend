import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The direction note is sent to the page and saved with the journal, so it must not say that days' (or weeks') highs,
// lows or closes are what the review is built on.
test("the direction note does not say how it is worked out", () => {
  const server = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.doesNotMatch(server, /daily highs, lows|weekly highs, lows|Daily\/period closes|high of the reviewed period/);
  const note = server.slice(server.indexOf("const higherTimeframeView ="), server.indexOf("const timeframeView ="));
  assert.match(note, /\$\{traderBias\} Price is now around/);
  const range = server.slice(server.indexOf("let rangePositionNote ="), server.indexOf("let highBreakCount = 0;"));
  assert.doesNotMatch(range, /\$\{anchorLabel\}/);
});
