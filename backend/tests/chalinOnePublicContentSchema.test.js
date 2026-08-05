"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  validateAdditiveMigration,
  validateVerifySql,
} = require("../scripts/verifyMigrationSafety");

const repoRoot = path.resolve(__dirname, "../..");
const migrationPath =
  "database/migrations/20260805_chalin_one_public_content_foundation.sql";
const verifyPath =
  "database/migrations/20260805_chalin_one_public_content_foundation_verify.sql";

const migration = fs.readFileSync(path.join(repoRoot, migrationPath), "utf8");
const verification = fs.readFileSync(path.join(repoRoot, verifyPath), "utf8");

const REQUIRED_TABLES = Object.freeze([
  "public_media_folders",
  "public_media_assets",
  "public_site_settings",
  "public_pages",
  "public_page_versions",
  "public_page_sections",
  "public_navigation_items",
  "public_news_categories",
  "public_news_articles",
  "public_announcements",
  "public_business_divisions",
  "public_leadership_profiles",
  "public_projects",
  "public_project_media",
  "public_equipment_catalogue",
  "public_testimonials",
  "public_locations",
  "public_company_statistics",
  "public_job_vacancies",
  "public_tenders",
  "public_faqs",
  "public_forms",
  "public_form_fields",
  "public_form_submissions",
  "public_form_submission_files",
  "public_content_versions",
  "public_content_approvals",
  "public_content_audit_log",
]);

function extractCreatedTableNames(sql) {
  return Array.from(
    sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)/gi),
    (match) => match[1].toLowerCase()
  );
}

test("public content migration passes the enforced additive migration policy", () => {
  const errors = [];

  validateAdditiveMigration({
    repoRoot,
    filePath: migrationPath,
    content: migration,
    errors,
  });

  assert.deepEqual(errors, []);
  assert.match(migration, /CHALIN 03 PRODUCTION MIGRATION/i);
  assert.match(migration, /ADDITIVE MIGRATION ONLY/i);
  assert.match(migration, /BACKUP REQUIRED/i);
  assert.match(
    migration,
    /20260805_chalin_one_public_content_foundation/
  );
});

test("public content migration creates the complete isolated table set", () => {
  const createdTables = new Set(extractCreatedTableNames(migration));

  for (const tableName of REQUIRED_TABLES) {
    assert.ok(createdTables.has(tableName), `Missing table ${tableName}`);
  }

  assert.equal(
    REQUIRED_TABLES.filter((tableName) => createdTables.has(tableName)).length,
    REQUIRED_TABLES.length
  );
});

test("all public content tables are additive InnoDB utf8mb4 tables", () => {
  for (const tableName of REQUIRED_TABLES) {
    const tablePattern = new RegExp(
      `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tableName}\\s*\\([\\s\\S]*?\\)\\s*ENGINE=InnoDB\\s+DEFAULT\\s+CHARSET=utf8mb4`,
      "i"
    );

    assert.match(migration, tablePattern, `${tableName} must use InnoDB/utf8mb4`);
  }
});

test("page builder preserves published pages while newer versions are edited", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public_pages/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public_page_versions/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public_page_sections/i);
  assert.match(migration, /version_number INT UNSIGNED NOT NULL/i);
  assert.match(migration, /version_status ENUM\('draft',[\s\S]*?'published'/i);
  assert.match(migration, /UNIQUE KEY uq_pub_page_version \(page_id, version_number\)/i);
  assert.match(migration, /FOREIGN KEY \(page_version_id\)[\s\S]*?ON DELETE CASCADE/i);
});

test("public media and private submission uploads have separate security boundaries", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public_media_assets/i);
  assert.match(migration, /visibility ENUM\('public', 'private', 'restricted'\)/i);
  assert.match(migration, /processing_status ENUM\('pending', 'ready', 'failed', 'quarantined', 'archived'\)/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public_form_submission_files/i);
  assert.match(migration, /security_status ENUM\('pending', 'clean', 'rejected', 'quarantined'\)/i);

  const submissionFilesBlock = migration.match(
    /CREATE TABLE IF NOT EXISTS public_form_submission_files[\s\S]*?ENGINE=InnoDB/i
  )?.[0];

  assert.ok(submissionFilesBlock);
  assert.doesNotMatch(submissionFilesBlock, /public_url/i);
});

test("public submissions preserve consent and avoid storing a plain IP address", () => {
  const submissionBlock = migration.match(
    /CREATE TABLE IF NOT EXISTS public_form_submissions[\s\S]*?ENGINE=InnoDB/i
  )?.[0];

  assert.ok(submissionBlock);
  assert.match(submissionBlock, /consent_given/i);
  assert.match(submissionBlock, /consent_text_version/i);
  assert.match(submissionBlock, /consent_at/i);
  assert.match(submissionBlock, /ip_hash CHAR\(64\)/i);
  assert.doesNotMatch(submissionBlock, /ip_address/i);
  assert.match(submissionBlock, /ON DELETE RESTRICT/i);
});

test("approval and audit tables preserve human authorization evidence", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public_content_versions/i);
  assert.match(migration, /snapshot_json JSON NOT NULL/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public_content_approvals/i);
  assert.match(migration, /approval_status ENUM\('pending', 'approved', 'rejected', 'cancelled', 'expired'\)/i);
  assert.match(migration, /execution_token CHAR\(64\)/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public_content_audit_log/i);
  assert.match(migration, /before_json JSON NULL/i);
  assert.match(migration, /after_json JSON NULL/i);
  assert.match(migration, /metadata_json JSON NULL/i);
});

test("staff actor references preserve history when a user is removed", () => {
  const userReferences = Array.from(
    migration.matchAll(/FOREIGN KEY \([a-z0-9_]+\) REFERENCES users\(id\) ON DELETE SET NULL/gi)
  );

  assert.ok(userReferences.length >= 25);
  assert.doesNotMatch(
    migration,
    /FOREIGN KEY \([a-z0-9_]+\) REFERENCES users\(id\) ON DELETE CASCADE/i
  );
});

test("verification SQL is read-only and checks every required table", () => {
  const errors = [];
  validateVerifySql({ filePath: verifyPath, content: verification, errors });
  assert.deepEqual(errors, []);

  for (const tableName of REQUIRED_TABLES) {
    assert.match(verification, new RegExp(tableName, "i"));
  }

  assert.match(verification, /information_schema\.tables/i);
  assert.match(verification, /information_schema\.columns/i);
  assert.match(verification, /information_schema\.statistics/i);
  assert.match(verification, /information_schema\.referential_constraints/i);
});
