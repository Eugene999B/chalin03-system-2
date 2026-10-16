const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_LOCK = "chalin03:spare-parts:operational-approval-centre:v1";
const REQUIRED_COLUMNS = [
  ["approval_kind", "VARCHAR(60) NULL"],
  ["entity_type", "VARCHAR(60) NULL"],
  ["entity_id", "BIGINT UNSIGNED NULL"],
  ["approval_amount", "DECIMAL(15,2) NOT NULL DEFAULT 0.00"],
  ["approval_payload_json", "JSON NULL"],
  ["approval_payload_hash", "CHAR(64) NULL"],
  ["expires_at", "DATETIME NULL"],
  ["execution_status", "VARCHAR(30) NOT NULL DEFAULT 'not_required'"],
  ["execution_token_hash", "CHAR(64) NULL"],
  ["executed_at", "DATETIME NULL"],
  ["execution_result_json", "JSON NULL"],
  ["execution_error", "TEXT NULL"],
  ["notification_id", "BIGINT UNSIGNED NULL"],
];

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${
        fallbackName ? ` or ${fallbackName}` : ""
      }.`
    );
  }
  return value;
}

function getSslConfig(env = process.env) {
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") {
    return undefined;
  }

  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }

  const disabled = ["0", "false", "no", "off"].includes(
    String(env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
  );
  return { rejectUnauthorized: !disabled };
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: getSslConfig(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();

  if (!databaseName) {
    throw new Error("The approval-centre migration is not connected to a database.");
  }

  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    if (!expected) {
      throw new Error(
        "Set CHALIN03_EXPECTED_DATABASE before applying the production approval-centre migration."
      );
    }
    if (databaseName !== expected) {
      throw new Error(
        `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
      );
    }
  }

  return databaseName;
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS present
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
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

async function ensureBaseTable(connection) {
  if (await tableExists(connection, "audit_unlock_requests")) return;

  throw new Error(
    "The existing audit_unlock_requests table is missing. Apply the approved base schema before the operational approval-centre migration."
  );
}

async function addMissingColumns(connection) {
  for (const [columnName, definition] of REQUIRED_COLUMNS) {
    if (await columnExists(connection, "audit_unlock_requests", columnName)) {
      continue;
    }

    await connection.query(
      `ALTER TABLE audit_unlock_requests ADD COLUMN \`${columnName}\` ${definition}`
    );
  }
}

async function addMissingIndexes(connection) {
  const indexes = [
    [
      "idx_audit_unlock_operational_status",
      "approval_kind, execution_status, status, branch_id, created_at",
    ],
    [
      "idx_audit_unlock_operational_entity",
      "approval_kind, entity_type, entity_id, branch_id",
    ],
    [
      "idx_audit_unlock_operational_requester",
      "requested_by, approval_kind, status, created_at",
    ],
  ];

  for (const [indexName, columns] of indexes) {
    if (await indexExists(connection, "audit_unlock_requests", indexName)) {
      continue;
    }

    await connection.query(
      `ALTER TABLE audit_unlock_requests ADD INDEX \`${indexName}\` (${columns})`
    );
  }
}

async function verifyMigration(connection) {
  const missingColumns = [];
  for (const [columnName] of REQUIRED_COLUMNS) {
    if (!(await columnExists(connection, "audit_unlock_requests", columnName))) {
      missingColumns.push(columnName);
    }
  }

  if (missingColumns.length > 0) {
    throw new Error(
      `Approval-centre migration verification failed. Missing columns: ${missingColumns.join(
        ", "
      )}.`
    );
  }
}

async function runOperationalApprovalCentreStartup() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lockRow]] = await connection.query(
      "SELECT GET_LOCK(?, 45) AS acquired",
      [MIGRATION_LOCK]
    );
    lockAcquired = Number(lockRow?.acquired || 0) === 1;

    if (!lockAcquired) {
      throw new Error("Could not acquire the operational approval-centre migration lock.");
    }

    await ensureBaseTable(connection);
    await addMissingColumns(connection);
    await addMissingIndexes(connection);
    await verifyMigration(connection);

    console.log(
      `Operational Approval Centre schema verified on ${databaseName}.`
    );
  } finally {
    if (lockAcquired) {
      await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]).catch(() => {});
    }
    await connection.end();
  }
}

if (require.main === module) {
  runOperationalApprovalCentreStartup().catch((error) => {
    console.error("Operational Approval Centre startup migration failed:", error);
    process.exit(1);
  });
}

module.exports = { runOperationalApprovalCentreStartup };
