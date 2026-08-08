"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const { pool } = require("../config/db");
const { executeSqlScript } = require("./sqlScriptRunner");
const {
  RAILWAY_STAGING_ISOLATION_CONFIRMATION,
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");
const {
  ensureChalinOneStagingOperationalBaseline,
} = require("./ensureChalinOneStagingOperationalBaseline");
const {
  runStagingSeed,
} = require("./seedChalinOneStagingContent");
const {
  runStagingNavigationHierarchySeed,
} = require("./seedChalinOneStagingNavigationHierarchy");

const COMPLETION_MARKER = "chalin_one_full_staging_completion_v1";
const LOCK_NAME = "chalin03:chalin-one:full-staging-completion:v1";
const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const BASE_SCHEMA_PATH = path.join(REPOSITORY_ROOT, "database", "schema.sql");
const REFERENCE_SEED_PATH = path.join(
  REPOSITORY_ROOT,
  "database",
  "seed_reference_data.sql"
);
const MIGRATION_ROOT = path.join(REPOSITORY_ROOT, "database", "migrations");

const MIGRATIONS = Object.freeze([
  Object.freeze({
    record: "20260805_chalin_one_public_content_foundation",
    file: "20260805_chalin_one_public_content_foundation.sql",
    verify: "20260805_chalin_one_public_content_foundation_verify.sql",
  }),
  Object.freeze({
    record: "20260806_chalin_one_ai_foundation",
    file: "20260806_chalin_one_ai_foundation.sql",
    verify: "20260806_chalin_one_ai_foundation_verify.sql",
  }),
  Object.freeze({
    record: "20260806_chalin_one_ai_action_governance",
    file: "20260806_chalin_one_ai_action_governance.sql",
    verify: "20260806_chalin_one_ai_action_governance_verify.sql",
  }),
  Object.freeze({
    record: "20260806_chalin_one_ai_scheduled_governance",
    file: "20260806_chalin_one_ai_scheduled_governance.sql",
    verify: "20260806_chalin_one_ai_scheduled_governance_verify.sql",
  }),
  Object.freeze({
    record: "20260806_chalin_one_public_guide_foundation",
    file: "20260806_chalin_one_public_guide_foundation.sql",
    verify: "20260806_chalin_one_public_guide_foundation_verify.sql",
  }),
  Object.freeze({
    record: "20260806_chalin_one_portal_security_foundation",
    file: "20260806_chalin_one_portal_security_foundation.sql",
    verify: "20260806_chalin_one_portal_security_foundation_verify.sql",
  }),
  Object.freeze({
    record: "20260807_chalin_one_document_intelligence",
    file: "20260807_chalin_one_document_intelligence.sql",
    verify: "20260807_chalin_one_document_intelligence_verify.sql",
  }),
]);

const GOVERNANCE_USERS = Object.freeze([
  Object.freeze({
    idEnv: "CHALIN_ONE_STAGING_AUTHOR_USER_ID",
    usernameEnv: "SYSTEM_ADMIN_USERNAME",
    passwordEnv: "CHALIN_ONE_STAGING_ADMIN_PASSWORD",
    fallbackUsername: "admin",
    fullName: "CHALIN ONE Staging Administrator",
    role: "admin",
    allBranches: 1,
  }),
  Object.freeze({
    idEnv: "CHALIN_ONE_STAGING_REVIEWER_USER_ID",
    passwordEnv: "CHALIN_ONE_STAGING_REVIEWER_PASSWORD",
    fallbackUsername: "chalin-one-reviewer",
    fullName: "CHALIN ONE Staging Reviewer",
    role: "manager",
    allBranches: 0,
  }),
  Object.freeze({
    idEnv: "CHALIN_ONE_STAGING_PUBLISHER_USER_ID",
    passwordEnv: "CHALIN_ONE_STAGING_PUBLISHER_PASSWORD",
    fallbackUsername: "chalin-one-publisher",
    fullName: "CHALIN ONE Staging Publisher",
    role: "admin",
    allBranches: 1,
  }),
]);

class ChalinOneFullStagingCompletionError extends Error {
  constructor(message, code = "CHALIN_ONE_FULL_STAGING_COMPLETION_FAILED") {
    super(message);
    this.name = "ChalinOneFullStagingCompletionError";
    this.code = code;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new ChalinOneFullStagingCompletionError(
      `${label} must be a positive integer.`,
      "CHALIN_ONE_FULL_STAGING_GOVERNANCE_USER_ID_INVALID"
    );
  }
  return number;
}

function readRequiredFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new ChalinOneFullStagingCompletionError(
      `Required staging database source file is missing: ${filePath}`,
      "CHALIN_ONE_FULL_STAGING_SOURCE_FILE_MISSING"
    );
  }
  return fs.readFileSync(filePath, "utf8");
}

function createdTableNames(sql) {
  const names = new Set();
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_]+))/gi;
  let match;
  while ((match = pattern.exec(String(sql || "")))) {
    const name = clean(match[1] || match[2]);
    if (name) names.add(name);
  }
  return [...names];
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row?.present || 0) === 1;
}

async function assertTablesExist(connection, tableNames, label) {
  const missing = [];
  for (const tableName of tableNames) {
    if (!(await tableExists(connection, tableName))) missing.push(tableName);
  }
  if (missing.length > 0) {
    throw new ChalinOneFullStagingCompletionError(
      `${label} is incomplete. Missing tables: ${missing.join(", ")}.`,
      "CHALIN_ONE_FULL_STAGING_TABLES_MISSING"
    );
  }
}

async function migrationRecorded(connection, record) {
  const [rows] = await connection.query(
    `SELECT migration_name
       FROM schema_migrations
      WHERE migration_name = ?
      LIMIT 1`,
    [record]
  );
  return Boolean(rows[0]);
}

function assertDedicatedRailwayStaging(env = process.env) {
  const verified = validateFullStagingEnvironment(env, { mode: "runtime" });
  const railwayEnvironment = clean(
    env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT
  ).toLowerCase();
  const databaseHost = clean(env.DB_HOST || env.MYSQLHOST || env.MYSQL_HOST);

  if (railwayEnvironment !== "staging") {
    throw new ChalinOneFullStagingCompletionError(
      "Full staging completion may run only in the Railway staging environment.",
      "CHALIN_ONE_FULL_STAGING_RAILWAY_ENVIRONMENT_REQUIRED"
    );
  }
  if (!/\.railway\.internal$/i.test(databaseHost)) {
    throw new ChalinOneFullStagingCompletionError(
      "Full staging completion requires the dedicated internal Railway MySQL host.",
      "CHALIN_ONE_FULL_STAGING_INTERNAL_DB_REQUIRED"
    );
  }
  if (
    clean(env.CHALIN_ONE_STAGING_DATABASE_ISOLATION) !==
    RAILWAY_STAGING_ISOLATION_CONFIRMATION
  ) {
    throw new ChalinOneFullStagingCompletionError(
      "Full staging completion requires the exact dedicated Railway staging database isolation token.",
      "CHALIN_ONE_FULL_STAGING_DATABASE_ISOLATION_REQUIRED"
    );
  }

  return verified;
}

async function acquireLock(connection) {
  const [[row]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
    LOCK_NAME,
  ]);
  if (Number(row?.acquired || 0) !== 1) {
    throw new ChalinOneFullStagingCompletionError(
      "Could not acquire the CHALIN ONE full staging completion lock.",
      "CHALIN_ONE_FULL_STAGING_LOCK_UNAVAILABLE"
    );
  }
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
  } catch {
    // Closing the connection releases the advisory lock as well.
  }
}

async function verifyBaseSchema(connection) {
  const sql = readRequiredFile(BASE_SCHEMA_PATH);
  const tables = createdTableNames(sql);
  if (tables.length < 50) {
    throw new ChalinOneFullStagingCompletionError(
      `Clean master schema discovery returned only ${tables.length} tables.`,
      "CHALIN_ONE_FULL_STAGING_BASE_SCHEMA_SOURCE_INVALID"
    );
  }
  await assertTablesExist(connection, tables, "Clean master schema");
  return tables;
}

async function applyMigration(connection, migration) {
  const sql = readRequiredFile(path.join(MIGRATION_ROOT, migration.file));
  const verifySql = readRequiredFile(path.join(MIGRATION_ROOT, migration.verify));
  const expectedTables = createdTableNames(sql);
  const recorded = await migrationRecorded(connection, migration.record);

  if (!recorded) {
    console.log(`CHALIN ONE staging migration applying: ${migration.record}.`);
    await executeSqlScript(
      connection,
      sql,
      `CHALIN ONE staging migration ${migration.record}`
    );
  } else {
    console.log(`CHALIN ONE staging migration already recorded: ${migration.record}.`);
  }

  if (!(await migrationRecorded(connection, migration.record))) {
    throw new ChalinOneFullStagingCompletionError(
      `Migration ${migration.record} did not create its schema_migrations record.`,
      "CHALIN_ONE_FULL_STAGING_MIGRATION_RECORD_MISSING"
    );
  }

  await assertTablesExist(
    connection,
    expectedTables,
    `Migration ${migration.record}`
  );
  await executeSqlScript(
    connection,
    verifySql,
    `CHALIN ONE staging verification ${migration.record}`
  );

  return Object.freeze({
    record: migration.record,
    applied: !recorded,
    table_count: expectedTables.length,
    tables: expectedTables,
  });
}

function governanceIdentity(spec, env = process.env) {
  const id = positiveId(env[spec.idEnv], spec.idEnv);
  const username = clean(
    spec.usernameEnv ? env[spec.usernameEnv] : spec.fallbackUsername
  ) || spec.fallbackUsername;
  const password = String(env[spec.passwordEnv] || "");
  if (password && password.length < 16) {
    throw new ChalinOneFullStagingCompletionError(
      `${spec.passwordEnv} must contain at least 16 characters when configured.`,
      "CHALIN_ONE_FULL_STAGING_GOVERNANCE_PASSWORD_WEAK"
    );
  }
  return Object.freeze({ ...spec, id, username, password });
}

async function userByIdOrUsername(connection, id, username) {
  const [rows] = await connection.query(
    `SELECT id, username, password_hash, role, is_active, token_version
       FROM users
      WHERE id = ? OR username = ?
      ORDER BY id`,
    [id, username]
  );
  return rows;
}

async function ensureGovernanceUser(connection, identity) {
  const matches = await userByIdOrUsername(
    connection,
    identity.id,
    identity.username
  );
  const idMatch = matches.find((row) => Number(row.id) === identity.id);
  const usernameMatch = matches.find(
    (row) => clean(row.username).toLowerCase() === identity.username.toLowerCase()
  );

  if (idMatch && clean(idMatch.username).toLowerCase() !== identity.username.toLowerCase()) {
    throw new ChalinOneFullStagingCompletionError(
      `Governance user ID ${identity.id} already belongs to ${idMatch.username}.`,
      "CHALIN_ONE_FULL_STAGING_GOVERNANCE_ID_CONFLICT"
    );
  }
  if (usernameMatch && Number(usernameMatch.id) !== identity.id) {
    throw new ChalinOneFullStagingCompletionError(
      `Governance username ${identity.username} already belongs to user ID ${usernameMatch.id}.`,
      "CHALIN_ONE_FULL_STAGING_GOVERNANCE_USERNAME_CONFLICT"
    );
  }

  let generatedCredential = false;
  let password = identity.password;
  if (!password && !idMatch) {
    password = crypto.randomBytes(48).toString("base64url");
    generatedCredential = true;
  }

  if (!idMatch) {
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.query(
      `INSERT INTO users
        (id, full_name, username, password_hash, role, phone, default_branch_id,
         can_access_all_branches, is_active, must_change_password, token_version,
         created_by)
       VALUES (?, ?, ?, ?, ?, NULL, 1, ?, TRUE, ?, 0, NULL)`,
      [
        identity.id,
        identity.fullName,
        identity.username,
        passwordHash,
        identity.role,
        identity.allBranches,
        generatedCredential ? 1 : 0,
      ]
    );
  } else {
    let passwordChanged = false;
    if (identity.password) {
      passwordChanged = !(await bcrypt.compare(
        identity.password,
        String(idMatch.password_hash || "")
      ));
    }

    if (passwordChanged) {
      const passwordHash = await bcrypt.hash(identity.password, 12);
      await connection.query(
        `UPDATE users
            SET full_name = ?, password_hash = ?, role = ?, default_branch_id = 1,
                can_access_all_branches = ?, is_active = TRUE,
                must_change_password = FALSE, password_changed_at = NOW(),
                token_version = COALESCE(token_version, 0) + 1
          WHERE id = ?`,
        [
          identity.fullName,
          passwordHash,
          identity.role,
          identity.allBranches,
          identity.id,
        ]
      );
      if (await tableExists(connection, "auth_sessions")) {
        await connection.query(
          `UPDATE auth_sessions
              SET revoked_at = COALESCE(revoked_at, NOW()),
                  revocation_reason = COALESCE(
                    revocation_reason,
                    'chalin_one_staging_credential_rotation'
                  )
            WHERE user_id = ? AND revoked_at IS NULL`,
          [identity.id]
        );
      }
    } else {
      await connection.query(
        `UPDATE users
            SET full_name = ?, role = ?, default_branch_id = 1,
                can_access_all_branches = ?, is_active = TRUE
          WHERE id = ?`,
        [
          identity.fullName,
          identity.role,
          identity.allBranches,
          identity.id,
        ]
      );
    }
  }

  return Object.freeze({
    id: identity.id,
    username: identity.username,
    role: identity.role,
    credential_from_environment: Boolean(identity.password),
    generated_unreported_credential: generatedCredential,
  });
}

async function ensureGovernanceUsers(connection, env = process.env) {
  const identities = GOVERNANCE_USERS.map((spec) => governanceIdentity(spec, env));
  if (new Set(identities.map((item) => item.id)).size !== identities.length) {
    throw new ChalinOneFullStagingCompletionError(
      "Author, reviewer and publisher IDs must be different.",
      "CHALIN_ONE_FULL_STAGING_GOVERNANCE_USERS_NOT_DISTINCT"
    );
  }
  if (
    positiveId(env.SYSTEM_ADMIN_USER_ID || identities[0].id, "SYSTEM_ADMIN_USER_ID") !==
    identities[0].id
  ) {
    throw new ChalinOneFullStagingCompletionError(
      "SYSTEM_ADMIN_USER_ID must match CHALIN_ONE_STAGING_AUTHOR_USER_ID in isolated staging.",
      "CHALIN_ONE_FULL_STAGING_SYSTEM_ADMIN_MISMATCH"
    );
  }

  const results = [];
  for (const identity of identities) {
    results.push(await ensureGovernanceUser(connection, identity));
  }

  const [rows] = await connection.query(
    `SELECT id, username, role, is_active
       FROM users
      WHERE id IN (?, ?, ?)
      ORDER BY id`,
    identities.map((item) => item.id)
  );
  if (rows.length !== 3 || rows.some((row) => Number(row.is_active) !== 1)) {
    throw new ChalinOneFullStagingCompletionError(
      "All three CHALIN ONE staging governance users must exist and be active.",
      "CHALIN_ONE_FULL_STAGING_GOVERNANCE_USERS_VERIFY_FAILED"
    );
  }

  return results;
}

async function applyReferenceData(connection) {
  const sql = readRequiredFile(REFERENCE_SEED_PATH);
  await executeSqlScript(connection, sql, "CHALIN ONE staging reference seed");

  const [units] = await connection.query(
    `SELECT id, code, name, is_enabled
       FROM business_units
      WHERE code IN ('spare_parts', 'mining', 'equipment_hire')
      ORDER BY id`
  );
  if (units.length !== 3 || units.some((unit) => Number(unit.is_enabled) !== 1)) {
    throw new ChalinOneFullStagingCompletionError(
      "Spare Parts, Mining and Equipment Hire business units were not seeded correctly.",
      "CHALIN_ONE_FULL_STAGING_BUSINESS_UNITS_VERIFY_FAILED"
    );
  }
  return units;
}

async function ensureAdminBranchAccess(connection, adminId) {
  for (const branchId of [1, 2]) {
    await connection.query(
      `INSERT INTO user_branch_access
        (user_id, branch_id, access_role, is_primary, can_access)
       VALUES (?, ?, 'admin', ?, TRUE)
       ON DUPLICATE KEY UPDATE
         access_role = 'admin',
         is_primary = VALUES(is_primary),
         can_access = TRUE`,
      [adminId, branchId, branchId === 1 ? 1 : 0]
    );
  }
}

function legacySeedCompatibilityEnvironment(env = process.env) {
  return {
    ...env,
    DB_NAME: "chalin_one_staging_full_seed_overlay",
    FEATURE_AI_ENABLED: "false",
    FEATURE_CHALIN_COPILOT: "false",
    FEATURE_CHALIN_EXECUTIVE: "false",
    FEATURE_CHALIN_GUIDE: "false",
    FEATURE_CUSTOMER_PORTAL: "false",
    FEATURE_SUPPLIER_PORTAL: "false",
    FEATURE_APPLICANT_PORTAL: "false",
    FEATURE_AI_ACTIONS: "false",
    FEATURE_AI_SCHEDULED_JOBS: "false",
    CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "false",
    CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM: "",
  };
}

async function seedGovernedPublicContent(env = process.env) {
  const compatibilityEnv = legacySeedCompatibilityEnvironment(env);
  const content = await runStagingSeed({
    dryRun: false,
    env: compatibilityEnv,
  });
  const navigation = await runStagingNavigationHierarchySeed({
    dryRun: false,
    env: compatibilityEnv,
  });
  return Object.freeze({ content, navigation });
}

async function completionMarker(connection) {
  await connection.query(
    `INSERT INTO schema_migrations (migration_name, description)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description)`,
    [
      COMPLETION_MARKER,
      "Verified full CHALIN ONE schema, governance identities, operational reference data and staging content",
    ]
  );
}

async function countTables(connection) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'`
  );
  return Number(row?.table_count || 0);
}

async function completeChalinOneFullStagingDatabase({ env = process.env } = {}) {
  const safety = assertDedicatedRailwayStaging(env);
  const connection = await pool.getConnection();
  let locked = false;
  try {
    await acquireLock(connection);
    locked = true;

    const [[identity]] = await connection.query(
      "SELECT DATABASE() AS database_name"
    );
    const databaseName = clean(identity?.database_name);
    if (!databaseName) {
      throw new ChalinOneFullStagingCompletionError(
        "The staging database connection has no selected database.",
        "CHALIN_ONE_FULL_STAGING_DATABASE_NOT_SELECTED"
      );
    }

    const baseTables = await verifyBaseSchema(connection);
    const migrationReports = [];
    for (const migration of MIGRATIONS) {
      migrationReports.push(await applyMigration(connection, migration));
    }

    await ensureChalinOneStagingOperationalBaseline();
    const governanceUsers = await ensureGovernanceUsers(connection, env);
    const businessUnits = await applyReferenceData(connection);
    await ensureAdminBranchAccess(connection, governanceUsers[0].id);

    const seeded = await seedGovernedPublicContent(env);
    await completionMarker(connection);

    const tableCount = await countTables(connection);
    const expectedTables = new Set(baseTables);
    for (const report of migrationReports) {
      for (const tableName of report.tables) expectedTables.add(tableName);
    }
    await assertTablesExist(
      connection,
      [...expectedTables],
      "Final CHALIN ONE staging schema"
    );

    const result = Object.freeze({
      safe: true,
      database: databaseName,
      table_count: tableCount,
      expected_table_count: expectedTables.size,
      base_table_count: baseTables.length,
      migrations: migrationReports.map((report) => ({
        record: report.record,
        applied: report.applied,
        table_count: report.table_count,
      })),
      governance_users: governanceUsers,
      business_units: businessUnits.map((unit) => ({
        id: Number(unit.id),
        code: unit.code,
        name: unit.name,
      })),
      staging_content_created: seeded.content.created?.length || 0,
      staging_content_skipped: seeded.content.skipped?.length || 0,
      navigation_created: seeded.navigation.created?.length || 0,
      navigation_skipped: seeded.navigation.skipped?.length || 0,
      frontend_host: safety.frontend_host,
      api_host: safety.api_host,
      admin_login_ready: governanceUsers[0].credential_from_environment,
      admin_username: governanceUsers[0].username,
      admin_password_variable: GOVERNANCE_USERS[0].passwordEnv,
      completion_marker: COMPLETION_MARKER,
    });

    console.log("CHALIN ONE full staging database completion verified safely.");
    console.log(JSON.stringify(result, null, 2));
    if (!result.admin_login_ready) {
      console.log(
        `CHALIN ONE staging admin exists but its generated bootstrap credential was intentionally not printed. Set ${result.admin_password_variable} in Railway staging to choose a login password.`
      );
    }
    return result;
  } finally {
    if (locked) await releaseLock(connection);
    connection.release();
  }
}

if (require.main === module) {
  completeChalinOneFullStagingDatabase()
    .catch((error) => {
      console.error(
        `CHALIN ONE full staging database completion failed: ${error.message}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}

module.exports = {
  COMPLETION_MARKER,
  GOVERNANCE_USERS,
  LOCK_NAME,
  MIGRATIONS,
  ChalinOneFullStagingCompletionError,
  applyMigration,
  applyReferenceData,
  assertDedicatedRailwayStaging,
  completeChalinOneFullStagingDatabase,
  createdTableNames,
  ensureGovernanceUsers,
  legacySeedCompatibilityEnvironment,
  verifyBaseSchema,
};
