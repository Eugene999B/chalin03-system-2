"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { pool } = require("../config/db");
const {
  CRITICAL_EXISTING_TABLES,
  EXPECTED_TABLES,
  MIGRATION_RECORD,
} = require("./runChalinOnePublicContentFoundationMigration");
const {
  validateStagingEnvironment,
} = require("./verifyChalinOneStagingEnvironment");
const {
  getContentStudioDashboard,
} = require("../services/contentStudioPageService");
const {
  getPublicBootstrap,
  getPublicFormBySlug,
  getPublicPageBySlug,
} = require("../services/publicContentService");

const DEFAULT_OUTPUT = path.resolve(
  __dirname,
  "../artifacts/chalin-one-release-evidence.json"
);
const ACCEPTANCE_DATABASE_PATTERN =
  /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i;
const PUBLICATION_TABLES = Object.freeze([
  "public_pages",
  "public_navigation_items",
  "public_news_articles",
  "public_announcements",
  "public_leadership_profiles",
  "public_business_divisions",
  "public_projects",
  "public_equipment_catalogue",
  "public_testimonials",
  "public_locations",
  "public_company_statistics",
  "public_job_vacancies",
  "public_tenders",
  "public_faqs",
  "public_forms",
]);

class ChalinOneReleaseEvidenceError extends Error {
  constructor(message, code = "CHALIN_ONE_RELEASE_EVIDENCE_FAILED") {
    super(message);
    this.name = "ChalinOneReleaseEvidenceError";
    this.code = code;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function numeric(value) {
  return Number(value || 0);
}

function assertEvidenceEnvironment(env = process.env, databaseName = "") {
  const nodeEnvironment = clean(env.NODE_ENV).toLowerCase();
  if (
    nodeEnvironment === "test" &&
    ACCEPTANCE_DATABASE_PATTERN.test(databaseName)
  ) {
    return Object.freeze({
      mode: "acceptance",
      database_name: databaseName,
      safe: true,
    });
  }

  const staging = validateStagingEnvironment(env, { mode: "runtime" });
  if (staging.database_name !== databaseName) {
    throw new ChalinOneReleaseEvidenceError(
      "The connected database does not match the database approved by the staging safety verifier.",
      "CHALIN_ONE_RELEASE_EVIDENCE_DATABASE_MISMATCH"
    );
  }
  return Object.freeze({
    ...staging,
    mode: "staging",
  });
}

async function tableNames() {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS table_name
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()`
  );
  return new Set(rows.map((row) => row.table_name));
}

async function publicationCounts(existingTables) {
  const result = {};
  for (const table of PUBLICATION_TABLES) {
    if (!existingTables.has(table)) continue;
    const [rows] = await pool.query(
      `SELECT publication_status AS status, COUNT(*) AS count
         FROM \`${table}\`
        GROUP BY publication_status
        ORDER BY publication_status`
    );
    result[table] = Object.fromEntries(
      rows.map((row) => [row.status, numeric(row.count)])
    );
  }
  return result;
}

async function versionCounts(existingTables) {
  const result = {};
  for (const table of ["public_page_versions", "public_content_versions"]) {
    if (!existingTables.has(table)) continue;
    const [rows] = await pool.query(
      `SELECT version_status AS status, COUNT(*) AS count
         FROM \`${table}\`
        GROUP BY version_status
        ORDER BY version_status`
    );
    result[table] = Object.fromEntries(
      rows.map((row) => [row.status, numeric(row.count)])
    );
  }
  return result;
}

async function criticalBusinessCounts(existingTables) {
  const result = {};
  for (const table of CRITICAL_EXISTING_TABLES) {
    if (!existingTables.has(table)) {
      result[table] = null;
      continue;
    }
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS row_count FROM \`${table}\``
    );
    result[table] = numeric(row?.row_count);
  }
  return result;
}

async function approvalEvidence(existingTables) {
  if (!existingTables.has("public_content_approvals")) return null;
  const [[summary]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(approval_status = 'pending') AS pending,
       SUM(approval_status = 'approved') AS approved,
       SUM(approval_status = 'rejected') AS rejected,
       SUM(approval_status = 'pending' AND requested_by = assigned_to)
         AS pending_self_assigned,
       SUM(approval_status = 'approved' AND requested_by = decided_by)
         AS approved_self_decisions,
       SUM(approval_status IN ('approved','rejected')
           AND (decided_by IS NULL OR decided_at IS NULL))
         AS decisions_missing_evidence,
       SUM(approval_status = 'pending'
           AND page_version_id IS NULL
           AND content_version_id IS NULL)
         AS pending_without_exact_version
     FROM public_content_approvals`
  );
  return Object.fromEntries(
    Object.entries(summary || {}).map(([key, value]) => [key, numeric(value)])
  );
}

async function mediaEvidence(existingTables) {
  if (!existingTables.has("public_media_assets")) return null;
  const [[summary]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(is_active = 1) AS active,
       SUM(is_active = 1 AND visibility = 'public') AS active_public,
       SUM(is_active = 1 AND visibility = 'public'
           AND processing_status <> 'ready') AS public_not_ready,
       SUM(processing_status = 'quarantined') AS quarantined,
       SUM(is_active = 1 AND media_type = 'image'
           AND (alt_text IS NULL OR TRIM(alt_text) = '')) AS images_missing_alt_text
     FROM public_media_assets`
  );
  return Object.fromEntries(
    Object.entries(summary || {}).map(([key, value]) => [key, numeric(value)])
  );
}

async function publicIntegrity(existingTables) {
  const result = {
    published_homepages: 0,
    published_pages_without_published_version: 0,
    published_navigation: 0,
    published_forms: 0,
    active_public_settings: 0,
    draft_page_leaks: 0,
    draft_form_leaks: 0,
  };

  if (existingTables.has("public_pages")) {
    const [[home]] = await pool.query(
      `SELECT COUNT(*) AS count
         FROM public_pages
        WHERE publication_status = 'published' AND is_homepage = 1`
    );
    result.published_homepages = numeric(home?.count);

    const [[missingVersion]] = await pool.query(
      `SELECT COUNT(*) AS count
         FROM public_pages page
        WHERE page.publication_status = 'published'
          AND NOT EXISTS (
            SELECT 1
              FROM public_page_versions version
             WHERE version.page_id = page.id
               AND version.version_status = 'published'
          )`
    );
    result.published_pages_without_published_version = numeric(
      missingVersion?.count
    );

    const [draftPages] = await pool.query(
      `SELECT slug
         FROM public_pages
        WHERE publication_status <> 'published'
        ORDER BY id
        LIMIT 10`
    );
    for (const page of draftPages) {
      if (await getPublicPageBySlug(page.slug)) result.draft_page_leaks += 1;
    }
  }

  if (existingTables.has("public_navigation_items")) {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS count
         FROM public_navigation_items
        WHERE publication_status = 'published' AND is_visible = 1`
    );
    result.published_navigation = numeric(row?.count);
  }

  if (existingTables.has("public_forms")) {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS count
         FROM public_forms
        WHERE publication_status = 'published'`
    );
    result.published_forms = numeric(row?.count);

    const [draftForms] = await pool.query(
      `SELECT slug
         FROM public_forms
        WHERE publication_status <> 'published'
        ORDER BY id
        LIMIT 10`
    );
    for (const form of draftForms) {
      if (await getPublicFormBySlug(form.slug)) result.draft_form_leaks += 1;
    }
  }

  if (existingTables.has("public_site_settings")) {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS count
         FROM public_site_settings
        WHERE is_public = 1 AND is_active = 1`
    );
    result.active_public_settings = numeric(row?.count);
  }

  return result;
}

function releaseGates({ migrationApplied, missingTables, approvals, media, integrity }) {
  const gates = {
    migration_record_present: migrationApplied,
    all_expected_tables_present: missingTables.length === 0,
    no_pending_self_assigned_approvals:
      numeric(approvals?.pending_self_assigned) === 0,
    no_approved_self_decisions:
      numeric(approvals?.approved_self_decisions) === 0,
    decisions_have_evidence:
      numeric(approvals?.decisions_missing_evidence) === 0,
    pending_approvals_target_exact_versions:
      numeric(approvals?.pending_without_exact_version) === 0,
    public_media_ready: numeric(media?.public_not_ready) === 0,
    exactly_one_published_homepage: integrity.published_homepages === 1,
    published_pages_have_versions:
      integrity.published_pages_without_published_version === 0,
    published_navigation_present: integrity.published_navigation > 0,
    published_public_form_present: integrity.published_forms > 0,
    public_settings_present: integrity.active_public_settings > 0,
    no_draft_page_leak: integrity.draft_page_leaks === 0,
    no_draft_form_leak: integrity.draft_form_leaks === 0,
  };
  return {
    gates,
    release_ready: Object.values(gates).every(Boolean),
  };
}

async function generateReleaseEvidence({
  env = process.env,
  outputPath = DEFAULT_OUTPUT,
  writeFile = true,
} = {}) {
  const [[databaseRow]] = await pool.query(
    "SELECT DATABASE() AS database_name, UTC_TIMESTAMP() AS database_time"
  );
  const databaseName = clean(databaseRow?.database_name);
  const environment = assertEvidenceEnvironment(env, databaseName);
  const existingTables = await tableNames();
  const missingTables = EXPECTED_TABLES.filter(
    (table) => !existingTables.has(table)
  );
  const [[migrationRow]] = await pool.query(
    `SELECT migration_name, applied_at
       FROM schema_migrations
      WHERE migration_name = ?
      LIMIT 1`,
    [MIGRATION_RECORD]
  );

  const [
    publications,
    versions,
    businessCounts,
    approvals,
    media,
    integrity,
    dashboard,
    bootstrap,
  ] = await Promise.all([
    publicationCounts(existingTables),
    versionCounts(existingTables),
    criticalBusinessCounts(existingTables),
    approvalEvidence(existingTables),
    mediaEvidence(existingTables),
    publicIntegrity(existingTables),
    getContentStudioDashboard(),
    getPublicBootstrap(),
  ]);

  const gateResult = releaseGates({
    migrationApplied: Boolean(migrationRow),
    missingTables,
    approvals,
    media,
    integrity,
  });

  const report = Object.freeze({
    report: "CHALIN ONE Release Candidate Evidence",
    generated_at: new Date().toISOString(),
    commit_sha:
      clean(env.RAILWAY_GIT_COMMIT_SHA) ||
      clean(env.GITHUB_SHA) ||
      clean(env.COMMIT_SHA) ||
      null,
    environment,
    database: {
      name: databaseName,
      time: databaseRow?.database_time || null,
      migration_record: migrationRow || null,
      expected_table_count: EXPECTED_TABLES.length,
      missing_tables: missingTables,
      critical_business_row_counts: businessCounts,
    },
    content: {
      publication_counts: publications,
      version_counts: versions,
      approvals,
      media,
      public_integrity: integrity,
      dashboard,
      public_bootstrap: {
        settings_count: Object.keys(bootstrap?.settings || {}).length,
        navigation_count: Array.isArray(bootstrap?.navigation)
          ? bootstrap.navigation.length
          : 0,
        announcement_count: Array.isArray(bootstrap?.announcements)
          ? bootstrap.announcements.length
          : 0,
        division_count: Array.isArray(bootstrap?.divisions)
          ? bootstrap.divisions.length
          : 0,
        statistic_count: Array.isArray(bootstrap?.statistics)
          ? bootstrap.statistics.length
          : 0,
      },
    },
    ...gateResult,
  });

  if (writeFile) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  return report;
}

function outputArgument(argv = process.argv.slice(2)) {
  const value = argv.find((item) => item.startsWith("--output="));
  return value ? path.resolve(value.slice("--output=".length)) : DEFAULT_OUTPUT;
}

if (require.main === module) {
  const outputPath = outputArgument();
  generateReleaseEvidence({ outputPath })
    .then((report) => {
      console.log(
        report.release_ready
          ? "CHALIN ONE release evidence passed every automated gate."
          : "CHALIN ONE release evidence contains incomplete or failed gates."
      );
      console.log(`Evidence report: ${outputPath}`);
      if (!report.release_ready) process.exitCode = 2;
    })
    .catch((error) => {
      console.error(`CHALIN ONE release evidence failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}

module.exports = {
  ACCEPTANCE_DATABASE_PATTERN,
  ChalinOneReleaseEvidenceError,
  DEFAULT_OUTPUT,
  PUBLICATION_TABLES,
  approvalEvidence,
  assertEvidenceEnvironment,
  criticalBusinessCounts,
  generateReleaseEvidence,
  mediaEvidence,
  outputArgument,
  publicIntegrity,
  publicationCounts,
  releaseGates,
  tableNames,
  versionCounts,
};
