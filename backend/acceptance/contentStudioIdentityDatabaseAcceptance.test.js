"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  EXPECTED_ROLES,
  EXPECTED_TABLES,
  RELEASE_CONFIRMATION,
  runChalinOneContentStudioIdentityMigration,
} = require("../scripts/runChalinOneContentStudioIdentityMigration");

function migrationEnv() {
  return {
    ...process.env,
    CHALIN_ONE_ALLOW_CONTENT_STUDIO_IDENTITY_MIGRATION: "true",
    CHALIN_ONE_CONTENT_STUDIO_IDENTITY_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
  };
}

test(
  "Content Studio identity migration is additive, idempotent and seeds isolated governance roles",
  { timeout: 120000 },
  async () => {
    const [[databaseRow]] = await pool.query("SELECT DATABASE() AS database_name");
    assert.match(
      String(databaseRow?.database_name || ""),
      /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i
    );

    const [[legacyUsersBefore]] = await pool.query("SELECT COUNT(*) AS total FROM users");
    const [[legacyProductsBefore]] = await pool.query("SELECT COUNT(*) AS total FROM products");

    const first = await runChalinOneContentStudioIdentityMigration({ env: migrationEnv() });
    const second = await runChalinOneContentStudioIdentityMigration({ env: migrationEnv() });

    assert.equal(first.verified_table_count, EXPECTED_TABLES.length);
    assert.equal(second.verified_table_count, EXPECTED_TABLES.length);
    assert.equal(first.verified_role_count, EXPECTED_ROLES.length);
    assert.equal(second.verified_role_count, EXPECTED_ROLES.length);

    const placeholders = EXPECTED_TABLES.map(() => "?").join(",");
    const [tables] = await pool.query(
      `SELECT TABLE_NAME AS table_name
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${placeholders})`,
      EXPECTED_TABLES
    );
    assert.deepEqual(
      new Set(tables.map((row) => row.table_name)),
      new Set(EXPECTED_TABLES)
    );

    const [roles] = await pool.query(
      `SELECT role_code, name, is_active
         FROM content_studio_roles
        ORDER BY sort_order, role_code`
    );
    assert.deepEqual(
      roles.map((row) => row.role_code),
      EXPECTED_ROLES
    );
    assert.equal(roles.every((row) => Number(row.is_active) === 1), true);

    const [roleViews] = await pool.query(
      `SELECT r.role_code, COUNT(*) AS total
         FROM content_studio_roles r
         INNER JOIN content_studio_role_permissions rp ON rp.role_id = r.id
        WHERE rp.permission_code = 'public_content.view'
        GROUP BY r.id, r.role_code`
    );
    assert.equal(roleViews.length, EXPECTED_ROLES.length);
    assert.equal(roleViews.every((row) => Number(row.total) === 1), true);

    const [newsScopes] = await pool.query(
      `SELECT rs.scope_code
         FROM content_studio_roles r
         INNER JOIN content_studio_role_scopes rs ON rs.role_id = r.id
        WHERE r.role_code = 'news_editor'
        ORDER BY rs.scope_code`
    );
    assert.deepEqual(
      newsScopes.map((row) => row.scope_code),
      ["dashboard", "media", "newsroom"]
    );

    const [mediaScopes] = await pool.query(
      `SELECT rs.scope_code
         FROM content_studio_roles r
         INNER JOIN content_studio_role_scopes rs ON rs.role_id = r.id
        WHERE r.role_code = 'media_manager'
        ORDER BY rs.scope_code`
    );
    assert.deepEqual(
      mediaScopes.map((row) => row.scope_code),
      ["dashboard", "media"]
    );

    const [[ownerDelegation]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM content_studio_role_scopes rs
         INNER JOIN content_studio_roles r ON r.id = rs.role_id
        WHERE rs.scope_code = 'access'`
    );
    assert.equal(Number(ownerDelegation.total), 0, "Team & Access must not be delegated by role seed");

    const [[accessRows]] = await pool.query(
      "SELECT COUNT(*) AS total FROM content_studio_user_access"
    );
    assert.equal(
      Number(accessRows.total),
      0,
      "The migration must not silently turn legacy operational users into Studio users"
    );

    const [[legacyUsersAfter]] = await pool.query("SELECT COUNT(*) AS total FROM users");
    const [[legacyProductsAfter]] = await pool.query("SELECT COUNT(*) AS total FROM products");
    assert.equal(Number(legacyUsersAfter.total), Number(legacyUsersBefore.total));
    assert.equal(Number(legacyProductsAfter.total), Number(legacyProductsBefore.total));

    const [[migrationRecord]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM schema_migrations
        WHERE migration_name = '20260808_chalin_one_content_studio_identity'`
    );
    assert.equal(Number(migrationRecord.total), 1);
  }
);

test.after(async () => {
  await pool.end();
});
