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
    /ai/i.test(path.basename(file))
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

test("frontend AI source contains no provider SDK, secret storage or unsafe rendering", () => {
  const frontendFiles = [
    "frontend/src/chalin-one/ai/aiApi.js",
    "frontend/src/chalin-one/ai/ChalinIntelligenceWorkspace.jsx",
  ];
  for (const file of frontendFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /OpenAI|Anthropic|Gemini|api[_-]?key|localStorage|sessionStorage|dangerouslySetInnerHTML|\beval\s*\(|new Function/i,
      file
    );
  }
});
