"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  BASE_SCHEMA_CONFIRMATION,
  ChalinOneStagingBaseSchemaSafetyError,
  bootstrapChalinOneFreshStagingDatabase,
  validateFreshStagingBootstrapEnvironment,
} = require("../scripts/bootstrapChalinOneFreshStagingDatabase");

function secret(label) {
  return `${label}_${"x".repeat(80)}`;
}

function safeEnv(overrides = {}) {
  return {
    NODE_ENV: "staging",
    RAILWAY_ENVIRONMENT_NAME: "staging",
    CHALIN_ONE_STAGING_CONFIRM: "CHALIN_ONE_STAGING_PREVIEW_ONLY",
    CHALIN_ONE_STAGING_DATABASE_ISOLATION: "RAILWAY_DEDICATED_STAGING_MYSQL",
    CHALIN_ONE_STAGING_BASE_SCHEMA_CONFIRM: BASE_SCHEMA_CONFIRMATION,
    FRONTEND_URL: "https://chalin-one-staging-preview.pages.dev",
    CHALIN_ONE_STAGING_API_URL: "https://chalin03-system-2-staging.up.railway.app",
    DB_HOST: "mysql.railway.internal",
    DB_PORT: "3306",
    DB_USER: "staging-user",
    DB_PASSWORD: "staging-password",
    DB_NAME: "railway",
    DB_SSL: "false",
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

test("fresh staging bootstrap accepts only the dedicated internal Railway staging database", () => {
  const result = validateFreshStagingBootstrapEnvironment(safeEnv());
  assert.equal(result.safe, true);
  assert.equal(result.database, "railway");
  assert.equal(result.host, "mysql.railway.internal");
});

test("fresh staging bootstrap requires the exact one-time confirmation", () => {
  assert.throws(
    () =>
      validateFreshStagingBootstrapEnvironment(
        safeEnv({ CHALIN_ONE_STAGING_BASE_SCHEMA_CONFIRM: "" })
      ),
    (error) =>
      error instanceof ChalinOneStagingBaseSchemaSafetyError &&
      error.code === "CHALIN_ONE_STAGING_BASE_SCHEMA_CONFIRMATION_REQUIRED"
  );
});

test("fresh staging bootstrap rejects public DB hosts and production-like DB names", () => {
  assert.throws(
    () => validateFreshStagingBootstrapEnvironment(safeEnv({ DB_HOST: "mysql.example.com" })),
    /database host is internal/i
  );

  assert.throws(
    () => validateFreshStagingBootstrapEnvironment(safeEnv({ DB_NAME: "chalin_production" })),
    /production-like database name/i
  );
});

test("fresh staging bootstrap refuses an existing unmarked database", async () => {
  const fakeConnection = {
    async query(sql) {
      const text = String(sql);
      if (/SELECT DATABASE\(\)/i.test(text)) {
        return [[{ database_name: "railway" }]];
      }
      if (/information_schema\.TABLES/i.test(text)) {
        return [[{ TABLE_NAME: "users" }]];
      }
      if (/schema_migrations WHERE migration_name/i.test(text)) {
        return [[{ present: 0 }]];
      }
      throw new Error(`Unexpected query in test: ${text}`);
    },
    async end() {},
  };

  await assert.rejects(
    () =>
      bootstrapChalinOneFreshStagingDatabase({
        env: safeEnv(),
        connectionFactory: async () => fakeConnection,
      }),
    (error) =>
      error instanceof ChalinOneStagingBaseSchemaSafetyError &&
      error.code === "CHALIN_ONE_STAGING_BASE_SCHEMA_DATABASE_NOT_EMPTY"
  );
});

test("bootstrap is wired to the repository clean master schema containing audit_unlock_requests", () => {
  const schema = fs.readFileSync(
    path.resolve(__dirname, "../../database/schema.sql"),
    "utf8"
  );
  assert.match(schema, /CREATE\s+TABLE\s+audit_unlock_requests/i);
});
