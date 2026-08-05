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
  "One-time removal of excavators registered through Installment Finance so the complete Finance process can restart with a clean machine register.";

const REGISTER_ACTION = "EQUIPMENT_FINANCE_MACHINE_REGISTERED";
const REGISTER_ACTION_TYPE = "equipment.finance.machine.register";
const HIDDEN_ACTION = "EQUIPMENT_FINANCE_MACHINE_RESET_HIDDEN";
const HIDDEN_ACTION_TYPE = "equipment.finance.machine.reset_hidden";
const DELETED_ACTION = "EQUIPMENT_FINANCE_MACHINE_RESET_DELETED";
const DELETED_ACTION_TYPE = "equipment.finance.machine.reset_deleted";

const SAFE_DIRECT_CHILDREN = new Set([
  "equipment_media",
  "fleet_meter_readings",
]);

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
  const columns = await tableColumns(connection, "activity_log");
  for (const required of [
    "action",
    "action_type",
    "workspace_code",
    "entity_type",
    "entity_id",
  ]) {
    if (!columns.has(required)) {
      throw new Error(
        `Installment excavator cleanup requires activity_log.${required}.`
      );
    }
  }

  const [rows] = await connection.query(
    `SELECT DISTINCT asset.id, asset.asset_code, asset.asset_name,
            asset.operational_purpose, asset.sale_status
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

async function nonFinanceMeterCount(connection, assetId) {
  if (!(await tableExists(connection, "fleet_meter_readings"))) return 0;
  const columns = await tableColumns(connection, "fleet_meter_readings");
  if (!columns.has("source_type")) {
    return countByReference(
      connection,
      "fleet_meter_readings",
      "asset_id",
      assetId
    );
  }
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS row_count
       FROM fleet_meter_readings
      WHERE asset_id = ?
        AND COALESCE(source_type, '') <> 'finance_machine_register'`,
    [assetId]
  );
  return Number(row?.row_count || 0);
}

async function classifyAssetUsage(connection, assetId, foreignKeys) {
  const sharedReferences = [];
  const financeEvidence = [];

  for (const foreignKey of foreignKeys) {
    const tableName = foreignKey.child_table;
    const columnName = foreignKey.child_column;
    const count = await countByReference(
      connection,
      tableName,
      columnName,
      assetId
    );
    if (!count) continue;

    if (tableName === "equipment_media") {
      financeEvidence.push({ table: tableName, rows: count });
      continue;
    }

    if (tableName === "fleet_meter_readings") {
      const nonFinanceCount = await nonFinanceMeterCount(connection, assetId);
      if (nonFinanceCount > 0) {
        sharedReferences.push({
          table: tableName,
          rows: nonFinanceCount,
          reason: "non_finance_meter_history",
        });
      } else {
        financeEvidence.push({ table: tableName, rows: count });
      }
      continue;
    }

    if (!SAFE_DIRECT_CHILDREN.has(tableName)) {
      sharedReferences.push({
        table: tableName,
        rows: count,
        reason: "non_finance_or_unclassified_business_history",
      });
    }
  }

  return {
    removable: sharedReferences.length === 0,
    sharedReferences,
    financeEvidence,
  };
}

async function deleteFinanceAssetEvidence(connection, assetId) {
  const deleted = {};

  if (await tableExists(connection, "equipment_media")) {
    const [result] = await connection.query(
      "DELETE FROM equipment_media WHERE asset_id = ?",
      [assetId]
    );
    deleted.equipment_media = Number(result.affectedRows || 0);
  }

  if (await tableExists(connection, "fleet_meter_readings")) {
    const columns = await tableColumns(connection, "fleet_meter_readings");
    if (columns.has("source_type")) {
      const [result] = await connection.query(
        `DELETE FROM fleet_meter_readings
          WHERE asset_id = ?
            AND source_type = 'finance_machine_register'`,
        [assetId]
      );
      deleted.fleet_meter_readings = Number(result.affectedRows || 0);
    }
  }

  const [assetResult] = await connection.query(
    "DELETE FROM fleet_assets WHERE id = ?",
    [assetId]
  );
  if (Number(assetResult.affectedRows || 0) !== 1) {
    throw new Error(`Finance excavator ${assetId} could not be deleted exactly once.`);
  }
  deleted.fleet_assets = 1;
  return deleted;
}

function retainedPurpose(sharedReferences) {
  const names = sharedReferences.map((entry) => entry.table.toLowerCase());
  return names.some((name) => name.startsWith("mining_"))
    ? "company_operations"
    : "hire_only";
}

async function hideSharedAssetFromFinance(
  connection,
  asset,
  sharedReferences
) {
  const purpose = retainedPurpose(sharedReferences);
  await connection.query(
    `UPDATE fleet_assets
        SET operational_purpose = ?,
            sale_status = CASE
              WHEN sale_status IN ('available','reserved','installment_active','cancelled')
                THEN 'not_for_sale'
              ELSE sale_status
            END,
            sale_reserved_until = NULL
      WHERE id = ?`,
    [purpose, asset.id]
  );

  await insertAuditEvent(connection, {
    action: HIDDEN_ACTION,
    action_type: HIDDEN_ACTION_TYPE,
    entity_type: "fleet_asset",
    entity_id: String(asset.id),
    workspace_code: "equipment_installment_finance",
    severity: "notice",
    details: `Removed ${asset.asset_code || asset.id} - ${
      asset.asset_name || "excavator"
    } from Installment Finance visibility while preserving linked business history.`,
    metadata_json: JSON.stringify({
      retained_purpose: purpose,
      shared_references: sharedReferences,
    }),
  });

  return purpose;
}

async function insertAuditEvent(connection, values) {
  const columns = await tableColumns(connection, "activity_log");
  const row = {
    action: values.action,
    details: values.details,
    workspace_code: values.workspace_code,
    entity_type: values.entity_type,
    entity_id: values.entity_id,
    action_type: values.action_type,
    outcome: "success",
    severity: values.severity || "info",
    metadata_json: values.metadata_json || null,
  };
  const entries = Object.entries(row).filter(([column]) => columns.has(column));
  if (!entries.length) return null;
  const [result] = await connection.query(
    `INSERT INTO activity_log (
       ${entries.map(([column]) => safeIdentifier(column)).join(", ")}
     ) VALUES (${entries.map(() => "?").join(", ")})`,
    entries.map(([, value]) => value)
  );
  return Number(result.insertId || 0) || null;
}

async function visibleRegisteredAssetCount(connection) {
  const [[row]] = await connection.query(
    `SELECT COUNT(DISTINCT asset.id) AS visible_count
       FROM activity_log registration
       INNER JOIN fleet_assets asset
         ON asset.id = CAST(registration.entity_id AS UNSIGNED)
      WHERE registration.entity_type = 'fleet_asset'
        AND registration.entity_id REGEXP '^[0-9]+$'
        AND (
          registration.action_type = ?
          OR registration.action = ?
        )
        AND NOT EXISTS (
          SELECT 1
            FROM activity_log hidden
           WHERE hidden.entity_type = 'fleet_asset'
             AND hidden.entity_id = registration.entity_id
             AND (
               hidden.action_type = ?
               OR hidden.action = ?
             )
        )`,
    [
      REGISTER_ACTION_TYPE,
      REGISTER_ACTION,
      HIDDEN_ACTION_TYPE,
      HIDDEN_ACTION,
    ]
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
      return {
        status: "skipped",
        reason: "Installment Finance excavator cleanup was already completed.",
        cleanup_record: CLEANUP_RECORD,
      };
    }

    if (!(await migrationApplied(db, PREVIOUS_RESET_RECORD))) {
      throw new Error(
        "The Installment Finance operational reset must complete before excavators are removed."
      );
    }

    await db.beginTransaction();
    transactionStarted = true;

    const candidates = await financeRegisteredAssets(db);
    const foreignKeys = await referencingForeignKeys(db);
    const deletedAssets = [];
    const retainedSharedAssets = [];

    for (const asset of candidates) {
      const usage = await classifyAssetUsage(db, asset.id, foreignKeys);
      if (usage.removable) {
        const deleted = await deleteFinanceAssetEvidence(db, asset.id);
        await insertAuditEvent(db, {
          action: DELETED_ACTION,
          action_type: DELETED_ACTION_TYPE,
          entity_type: "fleet_asset",
          entity_id: String(asset.id),
          workspace_code: "equipment_installment_finance",
          severity: "notice",
          details: `Deleted ${asset.asset_code || asset.id} - ${
            asset.asset_name || "excavator"
          } from the user-authorized Installment Finance restart data.`,
          metadata_json: JSON.stringify({ deleted }),
        });
        deletedAssets.push({
          id: asset.id,
          asset_code: asset.asset_code,
          asset_name: asset.asset_name,
          deleted,
        });
      } else {
        const purpose = await hideSharedAssetFromFinance(
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

    const visibleCount = await visibleRegisteredAssetCount(db);
    if (visibleCount !== 0) {
      throw new Error(
        `${visibleCount} Finance-registered excavator(s) would still be visible after cleanup.`
      );
    }

    await db.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)`,
      [CLEANUP_RECORD, CLEANUP_DESCRIPTION]
    );

    await insertAuditEvent(db, {
      action: "EQUIPMENT_FINANCE_EXCAVATOR_RESTART_CLEANUP_COMPLETED",
      action_type: "equipment.finance.excavator.restart_cleanup.completed",
      entity_type: "system",
      entity_id: CLEANUP_RECORD,
      workspace_code: "equipment_installment_finance",
      severity: "notice",
      details: `Completed the user-authorized Installment Finance excavator cleanup: ${deletedAssets.length} deleted and ${retainedSharedAssets.length} preserved outside Finance.`,
      metadata_json: JSON.stringify({
        deleted_assets: deletedAssets,
        retained_shared_assets: retainedSharedAssets,
        visible_finance_excavators: visibleCount,
      }),
    });

    await db.commit();
    transactionStarted = false;

    const result = {
      status: "success",
      mode: "production_one_time_installment_excavator_cleanup",
      database: databaseName,
      cleanup_record: CLEANUP_RECORD,
      candidates: candidates.length,
      deleted_assets: deletedAssets,
      retained_shared_assets: retainedSharedAssets,
      visible_finance_excavators: visibleCount,
      preserved: [
        "Spare Parts",
        "Mining Operations history",
        "Equipment Hire history",
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
