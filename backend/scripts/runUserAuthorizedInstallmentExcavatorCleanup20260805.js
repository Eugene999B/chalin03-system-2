const mysql = require("mysql2/promise");
require("dotenv").config();

const {
  connectionOptions,
  resolveExecutionMode,
  safeIdentifier,
  verifyDatabaseIdentity,
} = require("./runUserAuthorizedInstallmentRestartReset20260805");

const CLEANUP_RECORD =
  "20260805_user_authorized_installment_finance_excavator_cleanup";
const PREVIOUS_RESET_RECORD =
  "20260805_user_authorized_equipment_installment_restart_reset";
const CLEANUP_LOCK = "chalin03:eq-fin:excavator-clean:20260805";
const CLEANUP_DESCRIPTION =
  "One-time retirement of pre-reset Installment Finance excavators and Finance-only media so the machine register restarts cleanly without deleting shared fleet history.";

const REGISTER_ACTION = "EQUIPMENT_FINANCE_MACHINE_REGISTERED";
const REGISTER_ACTION_TYPE = "equipment.finance.machine.register";
const HIDDEN_ACTION = "EQUIPMENT_FINANCE_MACHINE_RESET_HIDDEN";
const HIDDEN_ACTION_TYPE = "equipment.finance.machine.reset_hidden";
const DELETED_ACTION = "EQUIPMENT_FINANCE_MACHINE_RESET_RETIRED";
const DELETED_ACTION_TYPE = "equipment.finance.machine.reset_retired";

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row?.table_count || 0) === 1;
}

async function tableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function ensureMigrationLedger(connection) {
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
}

async function migrationApplied(connection, migrationName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS applied_count
       FROM schema_migrations
      WHERE migration_name = ?`,
    [migrationName]
  );
  return Number(row?.applied_count || 0) > 0;
}

async function financeRegisteredAssets(connection) {
  const activityColumns = await tableColumns(connection, "activity_log");
  for (const required of [
    "action",
    "action_type",
    "workspace_code",
    "entity_type",
    "entity_id",
    "created_at",
  ]) {
    if (!activityColumns.has(required)) {
      throw new Error(
        `Installment excavator cleanup requires activity_log.${required}.`
      );
    }
  }

  const [rows] = await connection.query(
    `SELECT DISTINCT asset.id, asset.asset_code, asset.asset_name,
            asset.operational_purpose, asset.sale_status, asset.is_active,
            MIN(registration.created_at) AS finance_registered_at
       FROM activity_log registration
       INNER JOIN fleet_assets asset
         ON asset.id = CAST(registration.entity_id AS UNSIGNED)
      WHERE registration.entity_type = 'fleet_asset'
        AND registration.entity_id REGEXP '^[0-9]+$'
        AND (
          registration.action_type = ?
          OR registration.action = ?
        )
        AND (
          registration.workspace_code = 'equipment_installment_finance'
          OR registration.workspace_code IS NULL
        )
      GROUP BY asset.id, asset.asset_code, asset.asset_name,
               asset.operational_purpose, asset.sale_status, asset.is_active
      ORDER BY asset.id`,
    [REGISTER_ACTION_TYPE, REGISTER_ACTION]
  );

  return rows
    .map((row) => ({ ...row, id: positiveId(row.id) }))
    .filter((row) => row.id);
}

async function referencingForeignKeys(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS child_table,
            COLUMN_NAME AS child_column
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME = 'fleet_assets'
        AND REFERENCED_COLUMN_NAME = 'id'
      ORDER BY TABLE_NAME, COLUMN_NAME`
  );
  return rows;
}

async function countByReference(connection, tableName, columnName, assetId) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS row_count
       FROM ${safeIdentifier(tableName)}
      WHERE ${safeIdentifier(columnName)} = ?`,
    [assetId]
  );
  return Number(row?.row_count || 0);
}

async function meterUsage(connection, assetId) {
  if (!(await tableExists(connection, "fleet_meter_readings"))) {
    return { financeRows: 0, nonFinanceRows: 0 };
  }

  const columns = await tableColumns(connection, "fleet_meter_readings");
  if (!columns.has("source_type")) {
    const total = await countByReference(
      connection,
      "fleet_meter_readings",
      "asset_id",
      assetId
    );
    return { financeRows: 0, nonFinanceRows: total };
  }

  const [[row]] = await connection.query(
    `SELECT
       SUM(CASE WHEN source_type = 'finance_machine_register' THEN 1 ELSE 0 END)
         AS finance_rows,
       SUM(CASE WHEN COALESCE(source_type, '') <> 'finance_machine_register'
                THEN 1 ELSE 0 END) AS non_finance_rows
       FROM fleet_meter_readings
      WHERE asset_id = ?`,
    [assetId]
  );

  return {
    financeRows: Number(row?.finance_rows || 0),
    nonFinanceRows: Number(row?.non_finance_rows || 0),
  };
}

async function classifyAssetUsage(connection, assetId, foreignKeys) {
  const sharedReferences = [];
  const financeEvidence = [];

  for (const foreignKey of foreignKeys) {
    const tableName = foreignKey.child_table;
    const columnName = foreignKey.child_column;

    if (tableName === "equipment_media") {
      const rows = await countByReference(
        connection,
        tableName,
        columnName,
        assetId
      );
      if (rows) financeEvidence.push({ table: tableName, rows });
      continue;
    }

    if (tableName === "fleet_meter_readings") {
      const usage = await meterUsage(connection, assetId);
      if (usage.financeRows) {
        financeEvidence.push({
          table: tableName,
          rows: usage.financeRows,
          reason: "finance_opening_meter",
        });
      }
      if (usage.nonFinanceRows) {
        sharedReferences.push({
          table: tableName,
          rows: usage.nonFinanceRows,
          reason: "non_finance_meter_history",
        });
      }
      continue;
    }

    const rows = await countByReference(
      connection,
      tableName,
      columnName,
      assetId
    );
    if (rows) {
      sharedReferences.push({
        table: tableName,
        rows,
        reason: "linked_business_or_control_history",
      });
    }
  }

  return {
    removable: sharedReferences.length === 0,
    sharedReferences,
    financeEvidence,
  };
}

function retainedPurpose(sharedReferences) {
  const names = sharedReferences.map((entry) =>
    String(entry.table || "").toLowerCase()
  );
  return names.some((name) => name.startsWith("mining_"))
    ? "company_operations"
    : "hire_only";
}

async function scrubFinanceMedia(connection, assetId) {
  if (!(await tableExists(connection, "equipment_media"))) return 0;
  const columns = await tableColumns(connection, "equipment_media");
  const assignments = [];
  const params = [];

  function set(column, expression, valueProvided = false, value = null) {
    if (!columns.has(column)) return;
    assignments.push(`${safeIdentifier(column)} = ${expression}`);
    if (valueProvided) params.push(value);
  }

  set("file_url", "?", true, "");
  set("storage_key", "NULL");
  set("thumbnail_url", "NULL");
  set("file_name", "NULL");
  set("mime_type", "NULL");
  set("file_size_bytes", "NULL");
  set("caption", "?", true, "Retired during authorized Installment Finance restart.");
  set("is_primary", "FALSE");
  set("archived_at", "COALESCE(archived_at, NOW())");
  set("archive_reason", "?", true, "Authorized Installment Finance restart cleanup");

  if (!assignments.length) return 0;
  params.push(assetId);
  const [result] = await connection.query(
    `UPDATE equipment_media
        SET ${assignments.join(", ")}
      WHERE asset_id = ?`,
    params
  );
  return Number(result.affectedRows || 0);
}

async function removeFinanceOpeningMeters(connection, assetId) {
  if (!(await tableExists(connection, "fleet_meter_readings"))) return 0;
  const columns = await tableColumns(connection, "fleet_meter_readings");
  if (!columns.has("source_type")) return 0;
  const [result] = await connection.query(
    `DELETE FROM fleet_meter_readings
      WHERE asset_id = ?
        AND source_type = 'finance_machine_register'`,
    [assetId]
  );
  return Number(result.affectedRows || 0);
}

async function retireUnsharedFinanceAsset(connection, asset) {
  const columns = await tableColumns(connection, "fleet_assets");
  const assignments = [];

  if (columns.has("is_active")) assignments.push("is_active = FALSE");
  if (columns.has("sale_status")) assignments.push("sale_status = 'cancelled'");
  if (columns.has("sale_reserved_until")) {
    assignments.push("sale_reserved_until = NULL");
  }
  if (columns.has("main_image_url")) assignments.push("main_image_url = NULL");
  if (columns.has("current_status")) {
    assignments.push(
      "current_status = CASE WHEN current_status IN ('sold','reserved') THEN 'available' ELSE current_status END"
    );
  }
  if (columns.has("notes")) {
    assignments.push(
      "notes = CONCAT_WS(' | ', NULLIF(notes, ''), 'Retired by authorized Installment Finance restart cleanup.')"
    );
  }

  if (!assignments.length) {
    throw new Error("fleet_assets has no safe retirement columns.");
  }

  const [result] = await connection.query(
    `UPDATE fleet_assets
        SET ${assignments.join(", ")}
      WHERE id = ?`,
    [asset.id]
  );
  if (Number(result.affectedRows || 0) !== 1) {
    throw new Error(`Finance excavator ${asset.id} could not be retired exactly once.`);
  }

  return {
    media_rows_scrubbed: await scrubFinanceMedia(connection, asset.id),
    finance_meter_rows_removed: await removeFinanceOpeningMeters(
      connection,
      asset.id
    ),
    fleet_asset_rows_retired: 1,
  };
}

async function preserveSharedAssetOutsideFinance(
  connection,
  asset,
  sharedReferences
) {
  const columns = await tableColumns(connection, "fleet_assets");
  const assignments = [];
  const params = [];
  const purpose = retainedPurpose(sharedReferences);

  if (columns.has("operational_purpose")) {
    assignments.push("operational_purpose = ?");
    params.push(purpose);
  }
  if (columns.has("sale_status")) {
    assignments.push(
      "sale_status = CASE WHEN sale_status IN ('available','reserved','installment_active','cancelled') THEN 'not_for_sale' ELSE sale_status END"
    );
  }
  if (columns.has("sale_reserved_until")) {
    assignments.push("sale_reserved_until = NULL");
  }

  if (assignments.length) {
    params.push(asset.id);
    await connection.query(
      `UPDATE fleet_assets
          SET ${assignments.join(", ")}
        WHERE id = ?`,
      params
    );
  }

  return purpose;
}

async function visibleRegisteredAssetCount(connection) {
  const [[row]] = await connection.query(
    `SELECT COUNT(DISTINCT asset.id) AS visible_count
       FROM activity_log registration
       INNER JOIN fleet_assets asset
         ON asset.id = CAST(registration.entity_id AS UNSIGNED)
       INNER JOIN schema_migrations cleanup
         ON cleanup.migration_name = ?
      WHERE registration.entity_type = 'fleet_asset'
        AND registration.entity_id REGEXP '^[0-9]+$'
        AND asset.is_active = TRUE
        AND (
          registration.action_type = ?
          OR registration.action = ?
        )
        AND (
          registration.workspace_code = 'equipment_installment_finance'
          OR registration.workspace_code IS NULL
        )
        AND registration.created_at >= cleanup.applied_at`,
    [CLEANUP_RECORD, REGISTER_ACTION_TYPE, REGISTER_ACTION]
  );
  return Number(row?.visible_count || 0);
}

async function runUserAuthorizedInstallmentExcavatorCleanup20260805({
  connection = null,
  environment = process.env,
} = {}) {
  if (resolveExecutionMode(environment) !== "execute_once") {
    return {
      status: "skipped",
      reason: "Installment excavator cleanup runs only in production.",
    };
  }

  const ownsConnection = !connection;
  const db = connection || (await mysql.createConnection(connectionOptions(environment)));
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const databaseName = await verifyDatabaseIdentity(db, environment);
    await ensureMigrationLedger(db);

    const [[lockRow]] = await db.query("SELECT GET_LOCK(?, 60) AS acquired", [
      CLEANUP_LOCK,
    ]);
    if (Number(lockRow?.acquired || 0) !== 1) {
      throw new Error("Could not acquire the Installment excavator cleanup lock.");
    }
    lockAcquired = true;

    if (await migrationApplied(db, CLEANUP_RECORD)) {
      const visibleCount = await visibleRegisteredAssetCount(db);
      return {
        status: "skipped",
        reason: "Installment Finance excavator cleanup was already completed.",
        cleanup_record: CLEANUP_RECORD,
        visible_finance_excavators: visibleCount,
      };
    }

    if (!(await migrationApplied(db, PREVIOUS_RESET_RECORD))) {
      throw new Error(
        "The Installment Finance operational reset must complete before excavators are retired."
      );
    }

    await db.beginTransaction();
    transactionStarted = true;

    const candidates = await financeRegisteredAssets(db);
    const foreignKeys = await referencingForeignKeys(db);
    const retiredAssets = [];
    const retainedSharedAssets = [];

    for (const asset of candidates) {
      const usage = await classifyAssetUsage(db, asset.id, foreignKeys);
      if (usage.removable) {
        const evidence = await retireUnsharedFinanceAsset(db, asset);
        retiredAssets.push({
          id: asset.id,
          asset_code: asset.asset_code,
          asset_name: asset.asset_name,
          evidence,
        });
      } else {
        const purpose = await preserveSharedAssetOutsideFinance(
          db,
          asset,
          usage.sharedReferences
        );
        retainedSharedAssets.push({
          id: asset.id,
          asset_code: asset.asset_code,
          asset_name: asset.asset_name,
          retained_purpose: purpose,
          shared_references: usage.sharedReferences,
        });
      }
    }

    const markerDescription = `${CLEANUP_DESCRIPTION} Retired ${retiredAssets.length}; preserved outside Finance ${retainedSharedAssets.length}.`;
    await db.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)`,
      [CLEANUP_RECORD, markerDescription]
    );

    const visibleCount = await visibleRegisteredAssetCount(db);
    if (visibleCount !== 0) {
      throw new Error(
        `${visibleCount} pre-reset Finance excavator(s) would still be visible after cleanup.`
      );
    }

    await db.commit();
    transactionStarted = false;

    const result = {
      status: "success",
      mode: "production_one_time_installment_excavator_retirement",
      database: databaseName,
      cleanup_record: CLEANUP_RECORD,
      candidates: candidates.length,
      retired_assets: retiredAssets,
      retained_shared_assets: retainedSharedAssets,
      visible_finance_excavators: visibleCount,
      preserved: [
        "Spare Parts",
        "Mining Operations history",
        "Equipment Hire history",
        "shared Fleet foreign-key history",
        "users, permissions and settings",
        "system audit history",
      ],
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await db.rollback();
      } catch (_rollbackError) {
        // Preserve the original cleanup failure.
      }
    }
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await db.query("SELECT RELEASE_LOCK(?)", [CLEANUP_LOCK]);
      } catch (_releaseError) {
        // Closing the connection also releases the advisory lock.
      }
    }
    if (ownsConnection) await db.end();
  }
}

if (require.main === module) {
  runUserAuthorizedInstallmentExcavatorCleanup20260805().catch((error) => {
    console.error("One-time Installment Finance excavator cleanup failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  CLEANUP_DESCRIPTION,
  CLEANUP_LOCK,
  CLEANUP_RECORD,
  DELETED_ACTION,
  DELETED_ACTION_TYPE,
  HIDDEN_ACTION,
  HIDDEN_ACTION_TYPE,
  PREVIOUS_RESET_RECORD,
  REGISTER_ACTION,
  REGISTER_ACTION_TYPE,
  classifyAssetUsage,
  financeRegisteredAssets,
  retainedPurpose,
  runUserAuthorizedInstallmentExcavatorCleanup20260805,
  visibleRegisteredAssetCount,
};
