"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
const source = fs.readFileSync(
  path.join(repoRoot, "backend/ai-providers/localGovernedProvider.js"),
  "utf8"
);

test("CHALIN Local live planning remains provider-local, allowlisted and read-only", () => {
  assert.match(source, /LOCAL_LIVE_TOOL_KEYS/);
  assert.match(source, /Number\(tool\?\.risk_level \|\| 0\) !== 1/);
  assert.match(source, /chooseLocalReadTool/);
  assert.match(source, /tool_calls:\s*\[localToolCall\(selectedTool, messages\)\]/);
  assert.match(source, /input:\s*inferredDateInput\(messages\)/);
  assert.doesNotMatch(source, /config\/db|mysql2|pool\.|connection\.|\.query\s*\(/i);
  assert.doesNotMatch(source, /\bfetch\s*\(|axios|https\.request|http\.request/i);
  assert.doesNotMatch(source, /INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i);
});