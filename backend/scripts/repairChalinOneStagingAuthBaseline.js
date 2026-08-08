"use strict";

const bcrypt = require("bcryptjs");
require("dotenv").config();

const { pool } = require("../config/db");
const {
  RAILWAY_STAGING_ISOLATION_CONFIRMATION,
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");

const LOCK_NAME = "chalin03:chalin-one:staging-auth-baseline:v1";
const MIGRATION_NAME = "chalin_one_staging_auth_baseline_v1";

class ChalinOneStagingAuthBaselineError extends Error {
  constructor(message, code = "CHALIN_ONE_STAGING_AUTH_BASELINE_FAILED") {
    super(message);
    this.name = "ChalinOneStagingAuthBaselineError";
    this.code = code;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function assertStagingOnly(env = process.env) {
  validateFullStagingEnvironment(env, { mode: "runtime" });

  const railwayEnvironment = clean(
    env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT
  ).toLowerCase();
  if (railwayEnvironment !== "staging") {
    throw new ChalinOneStagingAuthBaselineError(
      "Authentication baseline repair may run only in Railway staging.",
      "CHALIN_ONE_STAGING_AUTH_RAILWAY_STAGING_REQUIRED"
    );
  }

  const host = clean(env.DB_HOST || env.MYSQLHOST || env.MYSQL_HOST);
  if (!/\.railway\.internal$/i.test(host)) {
    throw new ChalinOneStagingAuthBaselineError(
      "Authentication baseline repair requires the dedicated internal Railway staging MySQL host.",
      "CHALIN_ONE_STAGING_AUTH_INTERNAL_DB_REQUIRED"
    );
  }

  if (
    clean(env.CHALIN_ONE_STAGING_DATABASE_ISOLATION) !==
    RAILWAY_STAGING_ISOLATION_CONFIRMATION
  ) {
    throw new ChalinOneStagingAuthBaselineError(
      "Authentication baseline repair requires the exact CHALIN ONE staging database isolation token.",
      "CHALIN_ONE_STAGING_AUTH_ISOLATION_REQUIRED"
    );
  }
}

function safeIdentifier(value, label) {
  const text = clean(value);
  if (!/^[A-Za-z0-9_]+$/.test(text)) {
    throw new ChalinOneStagingAuthBaselineError(
      `Unsafe ${label}.`,
      "CHALIN_ONE_STAGING_AUTH_IDENTIFIER_INVALID"
    );
  }
  return text;
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

async function columnExists(connection, tableName, columnName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(row?.present || 0) === 1;
}

async function indexExists(connection, tableName, indexName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  return Number(row?.present || 0) > 0;
}

async function addColumnIfMissing(
  connection,
  tableName,
  columnName,
  definition
) {
  if (await columnExists(connection, tableName, columnName)) return false;
  const table = safeIdentifier(tableName, "table name");
  const column = safeIdentifier(columnName, "column name");
  await connection.query(
    `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`
  );
  return true;
}

async function addIndexIfMissing(
  connection,
  tableName,
  indexName,
  columnsSql
) {
  if (await indexExists(connection, tableName, indexName)) return false;
  const table = safeIdentifier(tableName, "table name");
  const index = safeIdentifier(indexName, "index name");
  await connection.query(
    `ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (${columnsSql})`
  );
  return true;
}

async function ensureUsersAuthColumns(connection) {
  if (!(await tableExists(connection, "users"))) {
    throw new ChalinOneStagingAuthBaselineError(
      "The users table is missing from the dedicated staging database.",
      "CHALIN_ONE_STAGING_AUTH_USERS_TABLE_MISSING"
    );
  }

  const definitions = [
    ["password_changed_at", "DATETIME NULL"],
    ["failed_login_attempts", "INT NOT NULL DEFAULT 0"],
    ["locked_until", "DATETIME NULL"],
    ["is_login_locked", "BOOLEAN NOT NULL DEFAULT FALSE"],
    ["login_locked_at", "DATETIME NULL"],
    ["login_lock_reason", "VARCHAR(120) NULL"],
    ["last_failed_login_at", "DATETIME NULL"],
    ["last_failed_login_ip", "VARCHAR(50) NULL"],
    ["last_login_at", "DATETIME NULL"],
    ["last_login_ip", "VARCHAR(50) NULL"],
    ["token_version", "INT NOT NULL DEFAULT 0"],
  ];

  const added = [];
  for (const [columnName, definition] of definitions) {
    if (await addColumnIfMissing(connection, "users", columnName, definition)) {
      added.push(`users.${columnName}`);
    }
  }

  await addIndexIfMissing(
    connection,
    "users",
    "idx_users_login_locked",
    "`is_login_locked`, `login_locked_at`"
  );
  await addIndexIfMissing(
    connection,
    "users",
    "idx_users_last_failed_login",
    "`last_failed_login_at`"
  );
  await addIndexIfMissing(
    connection,
    "users",
    "idx_user_token_version",
    "`token_version`"
  );

  return added;
}

async function ensureAuthSessionsTable(connection) {
  if (!(await tableExists(connection, "auth_sessions"))) {
    await connection.query(`
      CREATE TABLE auth_sessions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_id CHAR(64) NOT NULL,
        user_id INT NOT NULL,
        workspace_code VARCHAR(50) NULL,
        branch_id INT NULL,
        ip_address VARCHAR(50) NULL,
        user_agent VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME NULL,
        revocation_reason VARCHAR(80) NULL,
        replaced_by_session_id CHAR(64) NULL,
        UNIQUE KEY uq_auth_sessions_session_id (session_id),
        KEY idx_auth_sessions_user_active (user_id, revoked_at, expires_at),
        KEY idx_auth_sessions_last_seen (last_seen_at),
        KEY idx_auth_sessions_expires (expires_at),
        CONSTRAINT fk_auth_sessions_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    return ["auth_sessions"];
  }

  const definitions = [
    ["session_id", "CHAR(64) NULL"],
    ["user_id", "INT NULL"],
    ["workspace_code", "VARCHAR(50) NULL"],
    ["branch_id", "INT NULL"],
    ["ip_address", "VARCHAR(50) NULL"],
    ["user_agent", "VARCHAR(255) NULL"],
    ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
    ["last_seen_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
    ["expires_at", "DATETIME NULL"],
    ["revoked_at", "DATETIME NULL"],
    ["revocation_reason", "VARCHAR(80) NULL"],
    ["replaced_by_session_id", "CHAR(64) NULL"],
  ];

  const added = [];
  for (const [columnName, definition] of definitions) {
    if (
      await addColumnIfMissing(
        connection,
        "auth_sessions",
        columnName,
        definition
      )
    ) {
      added.push(`auth_sessions.${columnName}`);
    }
  }

  await addIndexIfMissing(
    connection,
    "auth_sessions",
    "idx_auth_sessions_user_active",
    "`user_id`, `revoked_at`, `expires_at`"
  );
  await addIndexIfMissing(
    connection,
    "auth_sessions",
    "idx_auth_sessions_last_seen",
    "`last_seen_at`"
  );
  await addIndexIfMissing(
    connection,
    "auth_sessions",
    "idx_auth_sessions_expires",
    "`expires_at`"
  );

  return added;
}

async function ensurePasswordRecoveryTable(connection) {
  if (await tableExists(connection, "password_recovery_otps")) return false;
  await connection.query(`
    CREATE TABLE password_recovery_otps (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      otp_hash CHAR(64) NOT NULL,
      otp_salt CHAR(32) NOT NULL,
      request_ip VARCHAR(50) NULL,
      request_user_agent VARCHAR(255) NULL,
      attempts_used INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 5,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME NULL,
      invalidated_at DATETIME NULL,
      invalidation_reason VARCHAR(80) NULL,
      sms_log_id BIGINT NULL,
      KEY idx_password_recovery_user_created (user_id, created_at),
      KEY idx_password_recovery_user_active (
        user_id, consumed_at, invalidated_at, expires_at
      ),
      KEY idx_password_recovery_ip_created (request_ip, created_at),
      KEY idx_password_recovery_expiry (expires_at),
      CONSTRAINT fk_password_recovery_otp_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  return true;
}

function adminCredential(env = process.env) {
  const id = Number(
    env.SYSTEM_ADMIN_USER_ID || env.CHALIN_ONE_STAGING_AUTHOR_USER_ID || 1
  );
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ChalinOneStagingAuthBaselineError(
      "The staging System Administrator user ID must be a positive integer.",
      "CHALIN_ONE_STAGING_AUTH_ADMIN_ID_INVALID"
    );
  }

  const username =
    clean(env.SYSTEM_ADMIN_USERNAME || env.ADMIN_USERNAME) || "admin";
  const password = String(
    env.CHALIN_ONE_STAGING_ADMIN_PASSWORD || env.ADMIN_PASSWORD || ""
  );

  if (password && password.length < 16) {
    throw new ChalinOneStagingAuthBaselineError(
      "The configured staging administrator password must contain at least 16 characters.",
      "CHALIN_ONE_STAGING_AUTH_ADMIN_PASSWORD_WEAK"
    );
  }

  return { id, username, password };
}

async function rotateAdminCredentialIfConfigured(connection, env = process.env) {
  const admin = adminCredential(env);
  if (!admin.password) {
    return {
      id: admin.id,
      username: admin.username,
      password_source: "existing_database_hash",
      rotated: false,
    };
  }

  const [rows] = await connection.query(
    `SELECT id, username, password_hash
       FROM users
      WHERE id = ? OR username = ?
      ORDER BY id
      LIMIT 2`,
    [admin.id, admin.username]
  );

  const idMatch = rows.find((row) => Number(row.id) === admin.id);
  const usernameMatch = rows.find(
    (row) => clean(row.username).toLowerCase() === admin.username.toLowerCase()
  );

  if (idMatch && clean(idMatch.username).toLowerCase() !== admin.username.toLowerCase()) {
    throw new ChalinOneStagingAuthBaselineError(
      `Staging administrator ID ${admin.id} belongs to a different username.`,
      "CHALIN_ONE_STAGING_AUTH_ADMIN_ID_CONFLICT"
    );
  }
  if (usernameMatch && Number(usernameMatch.id) !== admin.id) {
    throw new ChalinOneStagingAuthBaselineError(
      `Staging administrator username ${admin.username} belongs to a different user ID.`,
      "CHALIN_ONE_STAGING_AUTH_ADMIN_USERNAME_CONFLICT"
    );
  }

  if (!idMatch) {
    const passwordHash = await bcrypt.hash(admin.password, 12);
    await connection.query(
      `INSERT INTO users
        (id, full_name, username, password_hash, role, default_branch_id,
         can_access_all_branches, is_active, must_change_password, token_version)
       VALUES (?, 'CHALIN ONE Staging Administrator', ?, ?, 'admin', 1, 1, 1, 0, 0)`,
      [admin.id, admin.username, passwordHash]
    );
    return {
      id: admin.id,
      username: admin.username,
      password_source: env.CHALIN_ONE_STAGING_ADMIN_PASSWORD
        ? "CHALIN_ONE_STAGING_ADMIN_PASSWORD"
        : "ADMIN_PASSWORD",
      rotated: true,
    };
  }

  const alreadyMatches = await bcrypt.compare(
    admin.password,
    String(idMatch.password_hash || "")
  );
  if (!alreadyMatches) {
    const passwordHash = await bcrypt.hash(admin.password, 12);
    await connection.query(
      `UPDATE users
          SET password_hash = ?, role = 'admin', is_active = 1,
              default_branch_id = 1, can_access_all_branches = 1,
              must_change_password = 0,
              password_changed_at = NOW(),
              token_version = COALESCE(token_version, 0) + 1
        WHERE id = ?`,
      [passwordHash, admin.id]
    );
    await connection.query(
      `UPDATE auth_sessions
          SET revoked_at = COALESCE(revoked_at, NOW()),
              revocation_reason = COALESCE(
                revocation_reason,
                'chalin_one_staging_admin_credential_rotation'
              )
        WHERE user_id = ? AND revoked_at IS NULL`,
      [admin.id]
    );
  }

  return {
    id: admin.id,
    username: admin.username,
    password_source: env.CHALIN_ONE_STAGING_ADMIN_PASSWORD
      ? "CHALIN_ONE_STAGING_ADMIN_PASSWORD"
      : "ADMIN_PASSWORD",
    rotated: !alreadyMatches,
  };
}

async function recordBaseline(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      migration_name VARCHAR(150) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      description TEXT NULL,
      INDEX idx_schema_migration_name (migration_name),
      INDEX idx_schema_migration_applied_at (applied_at)
    )
  `);
  await connection.query(
    `INSERT INTO schema_migrations (migration_name, description)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description)`,
    [
      MIGRATION_NAME,
      "Repairs the isolated CHALIN ONE staging login/session compatibility baseline without changing business records",
    ]
  );
}

async function acquireLock(connection) {
  const [[row]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
    LOCK_NAME,
  ]);
  if (Number(row?.acquired || 0) !== 1) {
    throw new ChalinOneStagingAuthBaselineError(
      "Could not acquire the staging authentication baseline lock.",
      "CHALIN_ONE_STAGING_AUTH_LOCK_UNAVAILABLE"
    );
  }
}

async function repairChalinOneStagingAuthBaseline({ env = process.env } = {}) {
  assertStagingOnly(env);
  const connection = await pool.getConnection();
  let locked = false;

  try {
    await acquireLock(connection);
    locked = true;

    const userColumnsAdded = await ensureUsersAuthColumns(connection);
    const sessionColumnsAdded = await ensureAuthSessionsTable(connection);
    const recoveryTableCreated = await ensurePasswordRecoveryTable(connection);
    const administrator = await rotateAdminCredentialIfConfigured(connection, env);
    await recordBaseline(connection);

    const result = {
      safe: true,
      migration: MIGRATION_NAME,
      user_columns_added: userColumnsAdded,
      session_repairs: sessionColumnsAdded,
      password_recovery_table_created: recoveryTableCreated,
      administrator,
    };

    console.log("CHALIN ONE staging authentication baseline is ready.");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (locked) {
      await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]).catch(() => {});
    }
    connection.release();
  }
}

if (require.main === module) {
  repairChalinOneStagingAuthBaseline()
    .catch((error) => {
      console.error(
        `CHALIN ONE staging authentication baseline failed: ${error.message}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}

module.exports = {
  ChalinOneStagingAuthBaselineError,
  MIGRATION_NAME,
  adminCredential,
  repairChalinOneStagingAuthBaseline,
};
