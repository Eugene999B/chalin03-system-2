const fs = require("node:fs");
const mysql = require("mysql2/promise");
require("dotenv").config();

const CLEANUP_MARKER = "20260726_mining_trial_data_cleanup";
const CLEANUP_LOCK = "chalin03:mining-trial-cleanup:20260726";
const STATUS_PATH =
  process.env.CHALIN03_MINING_CLEANUP_STATUS_PATH ||
  "/tmp/chalin03-mining-trial-cleanup-status.json";

// This flag is deliberately true only in the one-time cleanup release. The
// follow-up release removes this startup hook after production verification.
const CLEANUP_EXECUTION_ENABLED = true;

const SENTINEL_TABLES = Object.freeze([
  "branches",
  "users",
  "user_branch_access",
  "settings",
  "products",
  "stock_adjustments",
  "suppliers",
  "purchases",
  "purchase_items",
  "purchase_payments",
  "customers",
  "sales",
  "sale_items",
  "sale_payment_allocations",
  "debts",
  "debt_payments",
  "returns",
  "expenses",
  "daily_closings",
  "audit_signoffs",
  "audit_unlock_requests",
  "stock_transfers",
  "sms_log",
  "business_locations",
  "user_hire_location_access",
  "hire_customers",
  "hire_enquiries",
  "hire_quotations",
  "hire_contracts",
  "hire_contract_assets",
  "hire_dispatches",
  "hire_work_logs",
  "hire_invoices",
  "hire_payments",
  "hire_return_inspections",
  "fleet_assets",
  "fleet_meter_readings",
  "fleet_fuel_logs",
  "fleet_maintenance_records",
  "fleet_inspections",
]);

const WORKSPACE_ONLY_CLEANUP_TABLES = Object.freeze([
  "notifications",
  "notification_sync_runs",
  "shared_control_evidence",
  "activity_log",
  "worker_assignments",
]);

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function safeIdentifier(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(text)) {
    throw new Error(`Unsafe database identifier: ${text}`);
  }
  return `\`${text}\``;
}

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

  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(env.DB_SSL_REJECT_UNAUTHORIZED || "true")
        .trim()
        .toLowerCase()
    ),
  };
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
    timezone: "Z",
  };
}

function writeStatus(status, details = {}) {
  const payload = {
    marker: CLEANUP_MARKER,
    status,
    recorded_at: new Date().toISOString(),
    ...details,
  };
  try {
    fs.writeFileSync(STATUS_PATH, `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    console.warn("Mining cleanup status file warning:", error.message);
  }
  return payload;
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND TABLE_TYPE = 'BASE TABLE'
     LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function countTable(connection, tableName, where = "", params = []) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total_count
     FROM ${safeIdentifier(tableName)}${where ? ` WHERE ${where}` : ""}`,
    params
  );
  return Number(rows[0]?.total_count || 0);
}

async function sentinelSnapshot(connection) {
  const snapshot = {};
  for (const tableName of SENTINEL_TABLES) {
    if (await tableExists(connection, tableName)) {
      snapshot[tableName] = await countTable(connection, tableName);
    }
  }

  if (
    (await tableExists(connection, "worker_profiles")) &&
    (await columnExists(connection, "worker_profiles", "workspace_code"))
  ) {
    snapshot.worker_profiles_non_mining = await countTable(
      connection,
      "worker_profiles",
      "COALESCE(workspace_code, '') <> 'mining'"
    );
  }

  return snapshot;
}

function assertSameSentinels(before, after) {
  const changed = [];
  for (const [name, count] of Object.entries(before)) {
    if (Number(after[name]) !== Number(count)) {
      changed.push(`${name}: ${count} -> ${after[name]}`);
    }
  }
  if (changed.length) {
    throw new Error(
      `Cleanup touched protected Spare Parts, Equipment Hire or shared sentinel data: ${changed.join(
        ", "
      )}.`
    );
  }
}

async function miningTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME LIKE 'mining=_%' ESCAPE '='
     ORDER BY TABLE_NAME`
  );
  return rows.map((row) => String(row.TABLE_NAME));
}

async function foreignKeysForTables(connection, tableNames) {
  if (!tableNames.length) return [];
  const placeholders = tableNames.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT
       kcu.TABLE_NAME AS child_table,
       kcu.COLUMN_NAME AS child_column,
       kcu.REFERENCED_TABLE_NAME AS parent_table,
       kcu.REFERENCED_COLUMN_NAME AS parent_column,
       COALESCE(rc.DELETE_RULE, 'RESTRICT') AS delete_rule
     FROM information_schema.KEY_COLUMN_USAGE kcu
     LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      AND rc.TABLE_NAME = kcu.TABLE_NAME
     WHERE kcu.REFERENCED_TABLE_SCHEMA = DATABASE()
       AND kcu.REFERENCED_TABLE_NAME IN (${placeholders})
     ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME`,
    tableNames
  );
  return rows.map((row) => ({
    child_table: String(row.child_table),
    child_column: String(row.child_column),
    parent_table: String(row.parent_table),
    parent_column: String(row.parent_column),
    delete_rule: String(row.delete_rule || "RESTRICT").toUpperCase(),
  }));
}

function buildDeleteOrder(tableNames, foreignKeys) {
  const target = new Set(tableNames);
  const childrenByParent = new Map(
    tableNames.map((table) => [table, new Set()])
  );

  for (const key of foreignKeys) {
    if (!target.has(key.child_table) || !target.has(key.parent_table)) continue;
    if (key.child_table === key.parent_table) {
      throw new Error(
        `Mining cleanup cannot automatically order self-referencing table ${key.child_table}.`
      );
    }
    childrenByParent.get(key.parent_table).add(key.child_table);
  }

  const temporary = new Set();
  const permanent = new Set();
  const order = [];

  function visit(tableName) {
    if (permanent.has(tableName)) return;
    if (temporary.has(tableName)) {
      throw new Error(
        `Mining cleanup found a foreign-key cycle at ${tableName}.`
      );
    }
    temporary.add(tableName);
    for (const child of childrenByParent.get(tableName) || []) visit(child);
    temporary.delete(tableName);
    permanent.add(tableName);
    order.push(tableName);
  }

  for (const tableName of [...tableNames].sort()) visit(tableName);
  return order;
}

async function deleteWorkspaceRows(connection, tableName, report) {
  if (!(await tableExists(connection, tableName))) return;
  const hasWorkspace = await columnExists(
    connection,
    tableName,
    "workspace_code"
  );
  const hasMiningSite = await columnExists(
    connection,
    tableName,
    "mining_site_id"
  );
  if (!hasWorkspace && !hasMiningSite) return;

  const clauses = [];
  if (hasWorkspace) clauses.push("workspace_code = 'mining'");
  if (hasMiningSite) clauses.push("mining_site_id IS NOT NULL");
  const [result] = await connection.query(
    `DELETE FROM ${safeIdentifier(tableName)} WHERE ${clauses.join(" OR ")}`
  );
  report[tableName] =
    (report[tableName] || 0) + Number(result.affectedRows || 0);
}

async function deleteSharedMiningRows(connection, report) {
  if (await tableExists(connection, "user_mining_site_access")) {
    const [result] = await connection.query(
      "DELETE FROM user_mining_site_access"
    );
    report.user_mining_site_access = Number(result.affectedRows || 0);
  }

  const [siteScopedTables] = await connection.query(
    `SELECT DISTINCT TABLE_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND COLUMN_NAME = 'mining_site_id'
       AND TABLE_NAME NOT LIKE 'mining=_%' ESCAPE '='`
  );
  for (const row of siteScopedTables) {
    await deleteWorkspaceRows(connection, String(row.TABLE_NAME), report);
  }

  for (const tableName of WORKSPACE_ONLY_CLEANUP_TABLES) {
    await deleteWorkspaceRows(connection, tableName, report);
  }

  if (
    (await tableExists(connection, "worker_profiles")) &&
    (await columnExists(connection, "worker_profiles", "workspace_code"))
  ) {
    const [result] = await connection.query(
      `DELETE FROM worker_profiles
       WHERE workspace_code = 'mining'`
    );
    report.worker_profiles_mining = Number(result.affectedRows || 0);
  }
}

async function externalBlockingReferences(connection, tableNames, foreignKeys) {
  const target = new Set(tableNames);
  const blockers = [];
  for (const key of foreignKeys) {
    if (target.has(key.child_table)) continue;
    const count = await countTable(
      connection,
      key.child_table,
      `${safeIdentifier(key.child_column)} IS NOT NULL`
    );
    if (count > 0) blockers.push({ ...key, count });
  }
  return blockers;
}

async function runMiningTrialCleanup() {
  if (!CLEANUP_EXECUTION_ENABLED) {
    writeStatus("disabled");
    return;
  }

  if (!isProduction()) {
    writeStatus("skipped_non_production");
    return;
  }

  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const [[databaseRow]] = await connection.query(
      "SELECT DATABASE() AS database_name"
    );
    const databaseName = String(databaseRow?.database_name || "").trim();
    if (!databaseName) throw new Error("No production database is selected.");

    const expectedDatabase = String(
      process.env.CHALIN03_EXPECTED_DATABASE || ""
    ).trim();
    if (expectedDatabase && expectedDatabase !== databaseName) {
      throw new Error(
        `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
      );
    }

    const [[lockRow]] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [CLEANUP_LOCK]
    );
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the Mining trial cleanup lock.");
    }

    if (!(await tableExists(connection, "schema_migrations"))) {
      throw new Error("schema_migrations is missing; cleanup refused.");
    }

    const [markerRows] = await connection.query(
      `SELECT migration_name
       FROM schema_migrations
       WHERE migration_name = ?
       LIMIT 1`,
      [CLEANUP_MARKER]
    );
    if (markerRows.length) {
      writeStatus("already_complete", { database_name: databaseName });
      console.log("Mining trial cleanup already completed.");
      return;
    }

    const tables = await miningTables(connection);
    if (!tables.includes("mining_sites")) {
      throw new Error("mining_sites was not found; cleanup refused.");
    }

    const foreignKeys = await foreignKeysForTables(connection, tables);
    const deleteOrder = buildDeleteOrder(tables, foreignKeys);
    const beforeSentinels = await sentinelSnapshot(connection);
    const deletedRows = {};

    await connection.beginTransaction();
    transactionStarted = true;

    await deleteSharedMiningRows(connection, deletedRows);

    const blockers = await externalBlockingReferences(
      connection,
      tables,
      foreignKeys
    );
    if (blockers.length) {
      throw new Error(
        `Mining cleanup found protected external references: ${blockers
          .map(
            (item) =>
              `${item.child_table}.${item.child_column}=${item.count} (${item.delete_rule})`
          )
          .join(", ")}.`
      );
    }

    for (const tableName of deleteOrder) {
      const [result] = await connection.query(
        `DELETE FROM ${safeIdentifier(tableName)}`
      );
      deletedRows[tableName] = Number(result.affectedRows || 0);
    }

    for (const tableName of tables) {
      const remaining = await countTable(connection, tableName);
      if (remaining !== 0) {
        throw new Error(
          `Mining cleanup verification failed: ${tableName} still has ${remaining} row(s).`
        );
      }
    }

    if (
      (await tableExists(connection, "user_mining_site_access")) &&
      (await countTable(connection, "user_mining_site_access")) !== 0
    ) {
      throw new Error(
        "Mining cleanup verification failed: user_mining_site_access is not empty."
      );
    }

    const afterSentinels = await sentinelSnapshot(connection);
    assertSameSentinels(beforeSentinels, afterSentinels);

    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [
        CLEANUP_MARKER,
        "One-time System Administrator-authorized removal of Mining trial operational data. Spare Parts, Equipment Hire, users, locations and shared fleet assets were protected by sentinel verification.",
      ]
    );

    await connection.commit();
    transactionStarted = false;

    const totalDeleted = Object.values(deletedRows).reduce(
      (sum, value) => sum + Number(value || 0),
      0
    );
    const status = writeStatus("complete", {
      database_name: databaseName,
      mining_table_count: tables.length,
      deleted_row_count: totalDeleted,
      spare_parts_and_hire_sentinels_verified: true,
    });

    console.log(
      `Mining trial cleanup completed. Tables: ${tables.length}. Rows removed: ${totalDeleted}.`
    );
    console.log(JSON.stringify(status));
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original failure.
      }
    }
    writeStatus("failed", {
      error: String(error.message || error).slice(0, 800),
    });
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [
          CLEANUP_LOCK,
        ]);
      } catch {
        // Connection close will release the advisory lock.
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runMiningTrialCleanup().catch((error) => {
    console.error("Mining trial cleanup failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  CLEANUP_LOCK,
  CLEANUP_MARKER,
  SENTINEL_TABLES,
  buildDeleteOrder,
  getSslConfig,
  isProduction,
  runMiningTrialCleanup,
};
