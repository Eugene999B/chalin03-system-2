"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  verifyChalinOneAiChatReadiness,
} = require("../scripts/verifyChalinOneAiChatReadiness");

function secret(label) {
  return `${label}_${"x".repeat(80)}`;
}

function safeEnv(overrides = {}) {
  return {
    NODE_ENV: "staging",
    RAILWAY_ENVIRONMENT_NAME: "staging",
    CHALIN_ONE_STAGING_CONFIRM: "CHALIN_ONE_STAGING_PREVIEW_ONLY",
    FRONTEND_URL: "https://chalin-one-preview.pages.dev",
    CHALIN_ONE_STAGING_API_URL: "https://chalin-one-staging.up.railway.app",
    DB_HOST: "mysql-staging.railway.internal",
    DB_NAME: "chalin_one_staging",
    JWT_SECRET: secret("jwt"),
    BACKUP_SIGNING_SECRET: secret("backup"),
    ACCOUNT_RECOVERY_OTP_SECRET: secret("recovery"),
    OWNER_MFA_ENCRYPTION_KEY: secret("mfa"),
    PUBLIC_FORM_IP_HASH_SECRET: secret("public_form"),
    CHALIN_ONE_STAGING_AUTHOR_USER_ID: "1",
    CHALIN_ONE_STAGING_REVIEWER_USER_ID: "2",
    CHALIN_ONE_STAGING_PUBLISHER_USER_ID: "3",
    FEATURE_PUBLIC_WEBSITE: "true",
    FEATURE_CONTENT_STUDIO: "true",
    FEATURE_AI_ENABLED: "true",
    FEATURE_CHALIN_COPILOT: "true",
    FEATURE_CHALIN_EXECUTIVE: "true",
    FEATURE_CHALIN_GUIDE: "true",
    FEATURE_CUSTOMER_PORTAL: "false",
    FEATURE_SUPPLIER_PORTAL: "false",
    FEATURE_APPLICANT_PORTAL: "false",
    FEATURE_AI_ACTIONS: "false",
    FEATURE_AI_SCHEDULED_JOBS: "false",
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "staging-provider-secret-abcdefghijklmnopqrstuvwxyz-123456",
    AI_ALLOW_MOCK_PROVIDER: "false",
    SMS_ENABLED: "false",
    SMS_PROVIDER: "mock",
    INSTALLMENT_SMS_REMINDERS_ENABLED: "false",
    PUBLIC_MEDIA_STORAGE_PROVIDER: "local",
    PUBLIC_MEDIA_LOCAL_ROOT: "/tmp/chalin-one-staging-media",
    CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "false",
    CHALIN_ONE_ALLOW_AI_SCHEMA_MIGRATION: "false",
    CHALIN_ONE_ALLOW_AI_ACTION_SCHEMA_MIGRATION: "false",
    CHALIN_ONE_ALLOW_AI_SCHEDULED_SCHEMA_MIGRATION: "false",
    CHALIN_ONE_ALLOW_PUBLIC_GUIDE_SCHEMA_MIGRATION: "false",
    CHALIN_ONE_ALLOW_PORTAL_SECURITY_SCHEMA_MIGRATION: "false",
    CHALIN_ONE_ALLOW_DOCUMENT_INTELLIGENCE_SCHEMA_MIGRATION: "false",
    ...overrides,
  };
}

test("staging chat readiness accepts isolated read-only GPT-5.6 conversation configuration", () => {
  const env = safeEnv();
  const result = verifyChalinOneAiChatReadiness(env);
  assert.equal(result.safe, true);
  assert.equal(result.provider, "openai");
  assert.equal(result.provider_ready, true);
  assert.equal(result.provider_secret_configured, true);
  assert.equal(result.provider_secret_exposed, false);
  assert.equal(result.provider_side_storage_enabled, false);
  assert.equal(result.copilot_model, "gpt-5.6");
  assert.equal(result.executive_model, "gpt-5.6");
  assert.equal(result.execution_authority, "read_recommend_prepare_only");
  assert.ok(result.disabled_features.includes("FEATURE_AI_ACTIONS"));
  assert.ok(result.disabled_features.includes("FEATURE_AI_SCHEDULED_JOBS"));

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /staging-provider-secret/i);
  assert.doesNotMatch(serialized, /OPENAI_API_KEY/i);
});

test("staging chat readiness fails closed when provider or secret is not ready", () => {
  assert.throws(
    () => verifyChalinOneAiChatReadiness(safeEnv({ AI_PROVIDER: "disabled" })),
    (error) => error.code === "CHALIN_ONE_FULL_STAGING_PROVIDER_REQUIRED"
  );
  assert.throws(
    () => verifyChalinOneAiChatReadiness(safeEnv({ OPENAI_API_KEY: "" })),
    (error) => error.code === "AI_OPENAI_API_KEY_REQUIRED"
  );
  assert.throws(
    () => verifyChalinOneAiChatReadiness(safeEnv({ AI_PROVIDER: "mock" })),
    (error) =>
      [
        "CHALIN_ONE_FULL_STAGING_MOCK_PROVIDER_BLOCKED",
        "CHALIN_ONE_FULL_STAGING_PROVIDER_REQUIRED",
      ].includes(error.code)
  );
});

test("staging chat readiness keeps mutations, schedules and production hosts blocked", () => {
  assert.throws(
    () => verifyChalinOneAiChatReadiness(safeEnv({ FEATURE_AI_ACTIONS: "true" })),
    /must remain disabled/i
  );
  assert.throws(
    () =>
      verifyChalinOneAiChatReadiness(
        safeEnv({ FEATURE_AI_SCHEDULED_JOBS: "true" })
      ),
    /must remain disabled/i
  );
  assert.throws(
    () => verifyChalinOneAiChatReadiness(safeEnv({ FRONTEND_URL: "https://chalin03.com" })),
    /live Chalin 03 host/i
  );
});

test("AI status and staff gateway use readiness and a visible governed chat entry", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const routes = fs.readFileSync(path.join(repoRoot, "backend/routes/aiRoutes.js"), "utf8");
  const gateway = fs.readFileSync(
    path.join(repoRoot, "frontend/src/components/ChalinOneGatewayLinks.jsx"),
    "utf8"
  );

  assert.match(routes, /getAiProviderReadiness/);
  assert.doesNotMatch(routes, /configured:\s*providerKey\s*!==\s*["']disabled["']/);
  assert.match(gateway, /useFeatureFlags/);
  assert.match(gateway, /flags\?\.aiEnabled === true/);
  assert.match(gateway, /permissions\.has\("workspace\.view"\)/);
  assert.match(gateway, /href="\/intelligence"/);
  assert.match(gateway, />\s*CHALIN AI\s*</);
});
