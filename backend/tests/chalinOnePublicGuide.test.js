"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  GUIDE_SYSTEM_INSTRUCTION,
  MAX_SESSION_MESSAGES,
  SESSION_TTL_MINUTES,
  guideKey,
  ipHash,
  publicGuideMessages,
  requiresPrivateHandoff,
  tokenHash,
} = require("../services/publicGuideService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/publicGuideService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/publicGuideRoutes.js"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    repoRoot,
    "database/migrations/20260806_chalin_one_public_guide_foundation.sql"
  ),
  "utf8"
);

test("public Guide session identifiers are opaque, bounded and hashed", () => {
  const key = guideKey("gd");
  assert.match(key, /^gd_[a-f0-9]{32}$/);
  assert.equal(key.length <= 40, true);
  assert.match(tokenHash("raw-session-token"), /^[a-f0-9]{64}$/);
  assert.notEqual(tokenHash("raw-session-token"), "raw-session-token");
  assert.equal(SESSION_TTL_MINUTES, 30);
  assert.equal(MAX_SESSION_MESSAGES, 30);
});

test("public Guide IP evidence is HMAC-hashed and requires a real secret", () => {
  const first = ipHash("127.0.0.1", {
    PUBLIC_FORM_IP_HASH_SECRET: "s".repeat(64),
  });
  const second = ipHash("127.0.0.1", {
    PUBLIC_FORM_IP_HASH_SECRET: "t".repeat(64),
  });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.throws(() =>
    ipHash("127.0.0.1", { PUBLIC_FORM_IP_HASH_SECRET: "weak" })
  );
});

test("private customer, staff and financial lookup requests require human handoff", () => {
  for (const message of [
    "Check my debt balance",
    "Show my payment receipt",
    "Find the customer statement",
    "Verify my finance application",
    "I want to upload my Ghana card",
  ]) {
    assert.equal(requiresPrivateHandoff(message), true, message);
  }
  assert.equal(
    requiresPrivateHandoff("What equipment hire services are publicly available?"),
    false
  );
});

test("Guide provider messages use only published evidence and no tools", () => {
  assert.match(GUIDE_SYSTEM_INSTRUCTION, /published public evidence/i);
  assert.match(GUIDE_SYSTEM_INSTRUCTION, /never infer private/i);
  const messages = publicGuideMessages({
    history: [
      { role: "user", content: "Earlier public question" },
      { role: "assistant", content: "Earlier public answer" },
    ],
    question: "What services are available?",
    evidence: [
      {
        source_type: "knowledge.faq",
        source_ref: "services",
        source_version: "1",
        label: "Services FAQ",
        excerpt_text: "Approved public services information.",
        classification: "public",
      },
    ],
  });
  assert.equal(messages.at(-1).role, "user");
  assert.match(messages[1].content, /\[E1\]/);
  assert.doesNotMatch(JSON.stringify(messages), /customer_id|staff_id|debt_id/);
});

test("Guide service calls public knowledge persona and zero registered tools", () => {
  assert.match(serviceSource, /persona: "guide"/);
  assert.match(serviceSource, /tools: \[\]/);
  assert.match(serviceSource, /createPublicFormSubmission/);
  assert.match(serviceSource, /session_status = 'closed'/);
  assert.doesNotMatch(serviceSource, /aiToolRegistry|config\/db.*SELECT/i);
});

test("Guide routes are anonymous, rate-limited and no-store", () => {
  assert.match(routeSource, /express-rate-limit/);
  assert.match(routeSource, /sessionLimiter/);
  assert.match(routeSource, /messageLimiter/);
  assert.match(routeSource, /handoffLimiter/);
  assert.match(routeSource, /x-chalin-guide-session/);
  assert.match(routeSource, /no-store, private/);
  assert.doesNotMatch(routeSource, /requireAuth|Authorization|Bearer/);
});

test("public Guide migration is additive and stores no raw IP or token", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ai_public_guide_sessions/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ai_public_guide_messages/);
  assert.match(migrationSource, /token_sha256/);
  assert.match(migrationSource, /ip_hash/);
  assert.doesNotMatch(migrationSource, /\bip_address\b|\bsession_token\b/);
  assert.doesNotMatch(
    migrationSource,
    /DROP\s+(?:TABLE|DATABASE)|TRUNCATE|DELETE\s+FROM|RENAME\s+TABLE/i
  );
});
