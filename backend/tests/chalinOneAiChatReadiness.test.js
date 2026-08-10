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
    AI_PROVIDER: "local",
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

test("staging chat readiness accepts CHALIN Local with no paid provider or API key", () => {
  const result = verifyChalinOneAiChatReadiness(safeEnv());
  assert.equal(result.safe, true);
  assert.equal(result.provider, "local");
  assert.equal(result.provider_ready, true);
  assert.equal(result.zero_cost_mode, true);
  assert.equal(result.billing_required, false);
  assert.equal(result.external_network_required, false);
  assert.equal(result.provider_secret_configured, false);
  assert.equal(result.provider_secret_exposed, false);
  assert.equal(result.copilot_model, "chalin-local-governed-v1");
  assert.equal(result.executive_model, "chalin-local-governed-v1");
  assert.equal(result.execution_authority, "read_recommend_prepare_only");
});

test("staging chat readiness accepts configured Gemini Free without treating it as private-data approval", () => {
  const result = verifyChalinOneAiChatReadiness(
    safeEnv({
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "staging-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
      GEMINI_SERVICE_TIER: "free",
    })
  );
  assert.equal(result.provider, "gemini");
  assert.equal(result.provider_ready, true);
  assert.equal(result.zero_cost_mode, true);
  assert.equal(result.service_tier, "free");
  assert.equal(result.public_only_when_unpaid, true);
  assert.equal(result.external_network_required, true);
  assert.equal(result.provider_secret_configured, true);
  assert.equal(result.provider_secret_exposed, false);
  assert.equal(result.copilot_model, "gemini-2.5-flash");
  assert.equal(result.executive_model, "gemini-2.5-flash");
  assert.equal(result.copilot_reasoning_effort, "provider_managed");

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /staging-gemini-secret/i);
  assert.doesNotMatch(serialized, /GEMINI_API_KEY/i);
});

test("staging chat readiness still accepts isolated GPT-5.6 when explicitly configured later", () => {
  const env = safeEnv({
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "staging-provider-secret-abcdefghijklmnopqrstuvwxyz-123456",
  });
  const result = verifyChalinOneAiChatReadiness(env);
  assert.equal(result.provider, "openai");
  assert.equal(result.provider_ready, true);
  assert.equal(result.zero_cost_mode, false);
  assert.equal(result.billing_required, true);
  assert.equal(result.copilot_model, "gpt-5.6");
  assert.equal(result.executive_model, "gpt-5.6");

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /staging-provider-secret/i);
  assert.doesNotMatch(serialized, /OPENAI_API_KEY/i);
});

test("staging chat readiness fails closed when selected external provider secret is missing", () => {
  assert.throws(
    () => verifyChalinOneAiChatReadiness(safeEnv({ AI_PROVIDER: "gemini" })),
    (error) => error.code === "AI_GEMINI_API_KEY_REQUIRED"
  );
  assert.throws(
    () => verifyChalinOneAiChatReadiness(safeEnv({ AI_PROVIDER: "openai" })),
    (error) => error.code === "AI_OPENAI_API_KEY_REQUIRED"
  );
  assert.throws(
    () => verifyChalinOneAiChatReadiness(safeEnv({ AI_PROVIDER: "disabled" })),
    (error) => error.code === "CHALIN_ONE_FULL_STAGING_PROVIDER_REQUIRED"
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

test("AI status, provider control and staff gateway keep governed access boundaries", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const routes = fs.readFileSync(path.join(repoRoot, "backend/routes/aiRoutes.js"), "utf8");
  const gateway = fs.readFileSync(
    path.join(repoRoot, "frontend/src/components/ChalinOneGatewayLinks.jsx"),
    "utf8"
  );

  assert.match(routes, /getAiProviderReadiness/);
  assert.match(routes, /getProviderControlSnapshot/);
  assert.match(routes, /updateProviderProfile/);
  assert.match(routes, /isOriginalSystemAdministrator/);
  assert.match(routes, /\/provider-control\/\:persona/);
  assert.doesNotMatch(routes, /OPENAI_API_KEY\s*=|GEMINI_API_KEY\s*=/);
  assert.match(gateway, /useFeatureFlags/);
  assert.match(gateway, /flags\?\.aiEnabled === true/);
  assert.match(gateway, /permissions\.has\("workspace\.view"\)/);
  assert.match(gateway, /href="\/intelligence"/);
  assert.match(gateway, />\s*CHALIN AI\s*</);
});
