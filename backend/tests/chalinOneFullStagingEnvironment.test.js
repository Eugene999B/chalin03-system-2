"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ChalinOneFullStagingSafetyError,
  validateFullStagingEnvironment,
} = require("../scripts/verifyChalinOneFullStagingEnvironment");

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
    AI_PROVIDER: "disabled",
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

test("full CHALIN ONE staging accepts isolated Website + AI runtime", () => {
  const result = validateFullStagingEnvironment(safeEnv());
  assert.equal(result.safe, true);
  assert.equal(result.database_name, "chalin_one_staging");
  assert.equal(result.ai_provider, "disabled");
});

test("provider acceptance requires a real non-mock provider", () => {
  assert.throws(
    () => validateFullStagingEnvironment(safeEnv(), { mode: "provider" }),
    (error) =>
      error instanceof ChalinOneFullStagingSafetyError &&
      error.code === "CHALIN_ONE_FULL_STAGING_PROVIDER_REQUIRED"
  );

  const result = validateFullStagingEnvironment(
    safeEnv({ AI_PROVIDER: "openai" }),
    { mode: "provider" }
  );
  assert.equal(result.ai_provider, "openai");
});

test("full staging fails closed on production hosts, DB names and risky feature flags", () => {
  assert.throws(
    () => validateFullStagingEnvironment(safeEnv({ FRONTEND_URL: "https://chalin03.com" })),
    /live Chalin 03 host/
  );
  assert.throws(
    () => validateFullStagingEnvironment(safeEnv({ DB_NAME: "railway" })),
    /database name must match/i
  );
  assert.throws(
    () => validateFullStagingEnvironment(safeEnv({ FEATURE_AI_ACTIONS: "true" })),
    /must remain disabled/i
  );
  assert.throws(
    () => validateFullStagingEnvironment(safeEnv({ CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "true" })),
    /Migration gates must be closed/i
  );
});

test("staging deployment manifests preserve branch and production isolation guards", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const railway = fs.readFileSync(
    path.join(repoRoot, "deploy/chalin-one/railway.staging.json"),
    "utf8"
  );
  const cloudflareGuard = fs.readFileSync(
    path.join(repoRoot, "frontend/scripts/verifyChalinOneStagingBuildEnv.mjs"),
    "utf8"
  );

  assert.match(railway, /verifyChalinOneFullStagingEnvironment\.js --mode=runtime/);
  assert.match(railway, /healthcheckPath"\s*:\s*"\/"/);
  assert.match(cloudflareGuard, /CF_PAGES_BRANCH/);
  assert.match(cloudflareGuard, /chalin-one/);
  assert.match(cloudflareGuard, /api\.chalin03\.com/);
  assert.match(cloudflareGuard, /VITE_API_URL/);
});
