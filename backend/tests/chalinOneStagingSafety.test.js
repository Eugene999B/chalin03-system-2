"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ChalinOneStagingSafetyError,
  MIGRATION_CONFIRMATION,
  STAGING_CONFIRMATION,
  validateStagingEnvironment,
} = require("../scripts/verifyChalinOneStagingEnvironment");
const {
  STAGING_SEED_MANIFEST,
  validateManifest,
} = require("../scripts/seedChalinOneStagingContent");
const {
  ChalinOneStagingSmokeError,
  safeRedirectTarget,
} = require("../scripts/runChalinOneStagingSmokeTests");

function safeEnvironment(overrides = {}) {
  return {
    NODE_ENV: "staging",
    CHALIN_ONE_STAGING_CONFIRM: STAGING_CONFIRMATION,
    DB_HOST: "127.0.0.1",
    DB_NAME: "chalin_one_staging_ci",
    FRONTEND_URL: "https://preview.example-chalin03.com",
    CHALIN_ONE_STAGING_API_URL:
      "https://api-preview.example-chalin03.com",
    FEATURE_PUBLIC_WEBSITE: "true",
    FEATURE_CONTENT_STUDIO: "true",
    FEATURE_AI_ENABLED: "false",
    FEATURE_CHALIN_COPILOT: "false",
    FEATURE_CHALIN_EXECUTIVE: "false",
    FEATURE_CHALIN_GUIDE: "false",
    FEATURE_CUSTOMER_PORTAL: "false",
    FEATURE_SUPPLIER_PORTAL: "false",
    FEATURE_APPLICANT_PORTAL: "false",
    FEATURE_AI_ACTIONS: "false",
    FEATURE_AI_SCHEDULED_JOBS: "false",
    PUBLIC_MEDIA_STORAGE_PROVIDER: "local",
    PUBLIC_MEDIA_LOCAL_ROOT: "./tmp/chalin-one-staging-media",
    PUBLIC_FORM_IP_HASH_SECRET: "s".repeat(80),
    CHALIN_ONE_STAGING_AUTHOR_USER_ID: "11",
    CHALIN_ONE_STAGING_REVIEWER_USER_ID: "12",
    CHALIN_ONE_STAGING_PUBLISHER_USER_ID: "13",
    CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "false",
    CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM: "",
    ...overrides,
  };
}

function rejectsWithCode(callback, code) {
  assert.throws(callback, (error) => {
    assert.equal(error instanceof ChalinOneStagingSafetyError, true);
    assert.equal(error.code, code);
    return true;
  });
}

function rejectsSmokeWithCode(callback, code) {
  assert.throws(callback, (error) => {
    assert.equal(error instanceof ChalinOneStagingSmokeError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test("safe Release B staging runtime is accepted", () => {
  const result = validateStagingEnvironment(safeEnvironment(), {
    mode: "runtime",
  });
  assert.equal(result.safe, true);
  assert.equal(result.database_name, "chalin_one_staging_ci");
  assert.equal(result.users.author, 11);
  assert.equal(result.users.reviewer, 12);
  assert.equal(result.users.publisher, 13);
  assert.equal(result.media.provider, "local");
});

test("production environment, database and public hosts are blocked", () => {
  rejectsWithCode(
    () =>
      validateStagingEnvironment(
        safeEnvironment({ NODE_ENV: "production" })
      ),
    "CHALIN_ONE_STAGING_NODE_ENV_REQUIRED"
  );
  rejectsWithCode(
    () =>
      validateStagingEnvironment(
        safeEnvironment({ DB_NAME: "chalin03_db" })
      ),
    "CHALIN_ONE_STAGING_DATABASE_NOT_ISOLATED"
  );
  rejectsWithCode(
    () =>
      validateStagingEnvironment(
        safeEnvironment({ FRONTEND_URL: "https://chalin03.com" })
      ),
    "CHALIN_ONE_STAGING_PRODUCTION_HOST_BLOCKED"
  );
  rejectsWithCode(
    () =>
      validateStagingEnvironment(
        safeEnvironment({ RAILWAY_ENVIRONMENT_NAME: "production" })
      ),
    "CHALIN_ONE_STAGING_RAILWAY_PRODUCTION_BLOCKED"
  );
});

test("staging keeps future AI and portal releases disabled", () => {
  rejectsWithCode(
    () =>
      validateStagingEnvironment(
        safeEnvironment({ FEATURE_AI_ENABLED: "true" })
      ),
    "CHALIN_ONE_STAGING_FUTURE_FEATURE_ENABLED"
  );
  rejectsWithCode(
    () =>
      validateStagingEnvironment(
        safeEnvironment({ FEATURE_CUSTOMER_PORTAL: "true" })
      ),
    "CHALIN_ONE_STAGING_FUTURE_FEATURE_ENABLED"
  );
});

test("author, reviewer and publisher must remain independent", () => {
  rejectsWithCode(
    () =>
      validateStagingEnvironment(
        safeEnvironment({
          CHALIN_ONE_STAGING_REVIEWER_USER_ID: "11",
        })
      ),
    "CHALIN_ONE_STAGING_INDEPENDENT_REVIEW_REQUIRED"
  );
});

test("migration gates are one-time and mode-specific", () => {
  rejectsWithCode(
    () =>
      validateStagingEnvironment(
        safeEnvironment({
          CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "true",
          CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM:
            MIGRATION_CONFIRMATION,
        }),
        { mode: "runtime" }
      ),
    "CHALIN_ONE_STAGING_MIGRATION_GATE_LEFT_OPEN"
  );

  const migration = validateStagingEnvironment(
    safeEnvironment({
      CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM:
        MIGRATION_CONFIRMATION,
    }),
    { mode: "migration" }
  );
  assert.equal(migration.mode, "migration");
});

test("media storage must be visibly isolated", () => {
  rejectsWithCode(
    () =>
      validateStagingEnvironment(
        safeEnvironment({ PUBLIC_MEDIA_LOCAL_ROOT: "./storage/public-media" })
      ),
    "CHALIN_ONE_STAGING_MEDIA_NOT_ISOLATED"
  );
  rejectsWithCode(
    () =>
      validateStagingEnvironment(
        safeEnvironment({
          PUBLIC_MEDIA_STORAGE_PROVIDER: "r2",
          CLOUDFLARE_R2_BUCKET: "chalin03-public-media",
          CLOUDFLARE_R2_ACCOUNT_ID: "account",
          CLOUDFLARE_R2_ACCESS_KEY_ID: "key",
          CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret",
          PUBLIC_MEDIA_PUBLIC_BASE_URL:
            "https://media-preview.example-chalin03.com",
        })
      ),
    "CHALIN_ONE_STAGING_R2_BUCKET_NOT_ISOLATED"
  );
});

test("staging smoke accepts only same-origin canonical redirects", () => {
  assert.equal(
    safeRedirectTarget("https://preview.example-chalin03.com/website", {
      status: 308,
      location: "/website/",
    }),
    "https://preview.example-chalin03.com/website/"
  );
  assert.equal(
    safeRedirectTarget("https://preview.example-chalin03.com/website", {
      status: 200,
      location: "/other",
    }),
    null
  );
  rejectsSmokeWithCode(
    () =>
      safeRedirectTarget("https://preview.example-chalin03.com/website", {
        status: 302,
        location: "https://chalin03.com/website/",
      }),
    "CHALIN_ONE_STAGING_SMOKE_CROSS_ORIGIN_REDIRECT"
  );
  rejectsSmokeWithCode(
    () =>
      safeRedirectTarget("https://preview.example-chalin03.com/website", {
        status: 301,
        location: "",
      }),
    "CHALIN_ONE_STAGING_SMOKE_REDIRECT_LOCATION_MISSING"
  );
});

test("staging seed manifest is complete, valid and draft-only", () => {
  const summary = validateManifest();
  assert.deepEqual(summary, {
    pages: 3,
    divisions: 5,
    statistics: 1,
    faqs: 3,
    forms: 1,
    navigation: 13,
    settings: 7,
    total: 33,
  });

  const encoded = JSON.stringify(STAGING_SEED_MANIFEST);
  assert.doesNotMatch(
    encoded,
    /publication_status|version_status|approved_by|published_by|approval_status/
  );
  assert.equal(
    STAGING_SEED_MANIFEST.pages.some(
      (page) => page.page_key === "home" && page.is_homepage === true
    ),
    true
  );
  assert.deepEqual(
    STAGING_SEED_MANIFEST.divisions.map((division) => division.division_key),
    [
      "spare_parts",
      "mining_operations",
      "equipment_hire",
      "equipment_sales",
      "installment_finance",
    ]
  );
});

test("seed implementation uses governed services and contains no destructive SQL", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../scripts/seedChalinOneStagingContent.js"),
    "utf8"
  );
  assert.match(source, /createPageDraft/);
  assert.match(source, /createFormDraft/);
  assert.match(source, /createEntityDraft/);
  assert.match(source, /createNavigationDraft/);
  assert.match(source, /upsertSiteSetting/);
  assert.match(source, /existingId/);
  assert.doesNotMatch(
    source,
    /DROP\s+(?:TABLE|DATABASE)|TRUNCATE|DELETE\s+FROM|UPDATE\s+public_/i
  );
});

test("staging smoke follows bounded redirects without exposing the body", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../scripts/runChalinOneStagingSmokeTests.js"),
    "utf8"
  );
  assert.match(source, /requestWithSafeRedirects/);
  assert.match(source, /SAFE_REDIRECT_STATUSES/);
  assert.match(source, /Math\.min\(Number\(options\.maxRedirects\), 5\)/);
  assert.match(source, /CHALIN_ONE_STAGING_SMOKE_TOO_MANY_REDIRECTS/);
  assert.match(source, /redirect_count: website\.redirects\.length/);
  assert.doesNotMatch(source, /redirect:\s*"follow"/);
});

test("staging environment template cannot be mistaken for production", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../.env.chalin-one-staging.example"),
    "utf8"
  );
  assert.match(source, /NODE_ENV=staging/);
  assert.match(source, /DB_NAME=chalin_one_staging/);
  assert.match(source, /FEATURE_PUBLIC_WEBSITE=true/);
  assert.match(source, /FEATURE_CONTENT_STUDIO=true/);
  assert.match(source, /FEATURE_AI_ENABLED=false/);
  assert.match(source, /CHALIN_ONE_STAGING_PREVIEW_ONLY/);
  assert.doesNotMatch(source, /DB_NAME=chalin03_db/);
});
