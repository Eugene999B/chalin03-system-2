"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  STAGING_CONFIRMATION,
} = require("../scripts/verifyChalinOneStagingEnvironment");
const {
  STAGING_NAVIGATION_HIERARCHY,
  runStagingNavigationHierarchySeed,
  validateHierarchyManifest,
} = require("../scripts/seedChalinOneStagingNavigationHierarchy");

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

test("staging hierarchy manifest contains controlled header and footer children", () => {
  assert.deepEqual(validateHierarchyManifest(), {
    navigation_children: 7,
    header_children: 5,
    footer_children: 2,
  });
  assert.deepEqual(
    STAGING_NAVIGATION_HIERARCHY.filter(
      (item) => item.parent_key === "header_divisions"
    ).map((item) => item.navigation_key),
    [
      "header_division_spare_parts",
      "header_division_mining",
      "header_division_hire",
      "header_division_sales",
      "header_division_finance",
    ]
  );
  assert.deepEqual(
    STAGING_NAVIGATION_HIERARCHY.filter(
      (item) => item.parent_key === "footer_about"
    ).map((item) => item.navigation_key),
    ["footer_company_leadership", "footer_company_news"]
  );
});

test("hierarchy dry run validates staging without opening the database", async () => {
  const report = await runStagingNavigationHierarchySeed({
    dryRun: true,
    env: safeEnvironment(),
  });
  assert.equal(report.dry_run, true);
  assert.equal(report.staging.safe, true);
  assert.equal(report.staging.database_name, "chalin_one_staging_ci");
  assert.equal(report.manifest.navigation_children, 7);
});

test("hierarchy seed is draft-only idempotent and non-destructive by contract", () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      "../scripts/seedChalinOneStagingNavigationHierarchy.js"
    ),
    "utf8"
  );
  assert.match(source, /validateStagingEnvironment\(env, \{ mode: "seed" \}\)/);
  assert.match(source, /createNavigationDraft/);
  assert.match(source, /navigationItemId\(item\.navigation_key\)/);
  assert.match(source, /navigationItemId\(item\.parent_key\)/);
  assert.match(source, /CHALIN_ONE_STAGING_NAVIGATION_PARENT_MISSING/);
  assert.doesNotMatch(
    source,
    /publishNavigationVersion|decideNavigationApproval|submitNavigationVersion/
  );
  assert.doesNotMatch(
    source,
    /DROP\s+(?:TABLE|DATABASE)|TRUNCATE|DELETE\s+FROM|UPDATE\s+public_/i
  );
});

test("package staging seed always runs flat content before hierarchy children", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
  );
  assert.equal(
    packageJson.scripts["seed:chalin-one:staging"],
    "node scripts/seedChalinOneStagingContent.js && node scripts/seedChalinOneStagingNavigationHierarchy.js"
  );
  assert.equal(
    packageJson.scripts["seed:chalin-one:staging:dry-run"],
    "node scripts/seedChalinOneStagingContent.js --dry-run && node scripts/seedChalinOneStagingNavigationHierarchy.js --dry-run"
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /seedChalinOneStagingNavigationHierarchy/
  );
});
