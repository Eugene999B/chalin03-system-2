"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function filesIn(relativeDirectory) {
  const directory = path.join(repoRoot, relativeDirectory);
  return fs.existsSync(directory)
    ? fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(relativeDirectory, entry.name))
    : [];
}

const requiredFiles = Object.freeze([
  "backend/security/aiPermissionCatalog.js",
  "backend/middleware/aiPermissionMiddleware.js",
  "backend/services/aiPermissionService.js",
  "backend/services/aiSafetyService.js",
  "backend/services/aiProviderService.js",
  "backend/services/aiToolRegistry.js",
  "backend/services/aiEvidenceService.js",
  "backend/services/aiCostControlService.js",
  "backend/services/aiAuditService.js",
  "backend/services/aiUsageService.js",
  "backend/services/aiConversationService.js",
  "backend/services/aiKnowledgeService.js",
  "backend/services/aiFeedbackService.js",
  "backend/services/aiOrchestratorService.js",
  "backend/routes/aiRoutes.js",
  "backend/routes/aiKnowledgeRoutes.js",
  "backend/ai-tools/foundationTools.js",
  "database/migrations/20260806_chalin_one_ai_foundation.sql",
  "database/migrations/20260806_chalin_one_ai_foundation_verify.sql",
  "backend/scripts/runChalinOneAiFoundationMigration.js",
  "frontend/src/chalin-one/ai/aiApi.js",
  "frontend/src/chalin-one/ai/ChalinIntelligenceWorkspace.jsx",
  "frontend/src/chalin-one/ai/chalinIntelligence.css",
]);

test("secure AI foundation inventory remains complete", () => {
  const missing = requiredFiles.filter(
    (relativePath) => !fs.existsSync(path.join(repoRoot, relativePath))
  );
  assert.deepEqual(missing, []);
});

test("registered AI tool modules cannot import database or raw transport modules", () => {
  const toolFiles = filesIn("backend/ai-tools");
  assert.equal(toolFiles.length > 0, true);
  for (const file of toolFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /config\/db|mysql2|\bpool\s*\.|\bconnection\s*\.|\.query\s*\(|child_process|\bexec\s*\(|\bspawn\s*\(/i,
      file
    );
  }
});

test("provider foundation has no direct HTTP client or credential literal", () => {
  const providerFiles = filesIn("backend/services").filter((file) =>
    /aiProvider/i.test(file)
  );
  for (const file of providerFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\bfetch\s*\(|axios|https\.request|http\.request|api[_-]?key\s*[:=]\s*["'][^"']+/i,
      file
    );
  }
});

test("AI routes never expose environment values or provider credentials", () => {
  const routeFiles = filesIn("backend/routes").filter((file) =>
    /^ai.*Routes\.js$/i.test(path.basename(file))
  );
  for (const file of routeFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /process\.env\[[^\]]+\]|process\.env\.(?:DB_|JWT_|.*SECRET|.*TOKEN|.*PASSWORD|.*API_KEY)/i,
      file
    );
    assert.match(source, /no-store|Cache-Control/);
  }
});

test("AI migrations remain additive and excluded from ordinary startup", () => {
  const migration = read(
    "database/migrations/20260806_chalin_one_ai_foundation.sql"
  );
  const packageJson = JSON.parse(read("backend/package.json"));
  assert.doesNotMatch(
    migration,
    /DROP\s+(?:TABLE|DATABASE)|TRUNCATE|DELETE\s+FROM|RENAME\s+TABLE/i
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /runChalinOneAiFoundationMigration|migrate:chalin-one:ai-foundation/
  );
});

test("frontend AI source has no provider networking, secret access or unsafe rendering; storage is limited to chat continuity", () => {
  const frontendFiles = [
    "frontend/src/chalin-one/ai/aiApi.js",
    "frontend/src/chalin-one/ai/ChalinIntelligenceWorkspace.jsx",
    "frontend/src/chalin-one/ai/AiProviderControlLauncher.jsx",
  ];
  for (const file of frontendFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /(?:process\.env|import\.meta\.env)\.(?:OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|ANTHROPIC_API_KEY)/i,
      file
    );
    assert.doesNotMatch(
      source,
      /api\.openai\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com|Authorization\s*:|Bearer\s+|\bfetch\s*\(/i,
      file
    );
    assert.doesNotMatch(
      source,
      /dangerouslySetInnerHTML|\beval\s*\(|new Function/i,
      file
    );
  }

  const api = read("frontend/src/chalin-one/ai/aiApi.js");
  const control = read("frontend/src/chalin-one/ai/AiProviderControlLauncher.jsx");
  const workspace = read("frontend/src/chalin-one/ai/ChalinIntelligenceWorkspace.jsx");

  // Network/provider control code may never persist browser state.
  assert.doesNotMatch(api, /localStorage|sessionStorage/);
  assert.doesNotMatch(control, /localStorage|sessionStorage/);

  // The chat workspace may persist only fixed continuity state: an opaque
  // conversation key and a tab-scoped unsent draft. Never provider credentials.
  assert.match(workspace, /ACTIVE_CHAT_PREFIX = "chalin03_ai_active_chat_v1"/);
  assert.match(workspace, /DRAFT_PREFIX = "chalin03_ai_draft_v1"/);
  assert.equal((workspace.match(/\blocalStorage\./g) || []).length, 3);
  assert.equal((workspace.match(/\bsessionStorage\./g) || []).length, 3);
  assert.match(workspace, /localStorage\.setItem\([\s\S]{0,120}activeChatStorageKey/);
  assert.match(workspace, /sessionStorage\.setItem\(key, draft\)/);
  assert.doesNotMatch(
    workspace,
    /(?:localStorage|sessionStorage)\.(?:setItem|getItem|removeItem)\(\s*["'`](?:token|password|secret|api[_-]?key|authorization|bearer)/i
  );
});
