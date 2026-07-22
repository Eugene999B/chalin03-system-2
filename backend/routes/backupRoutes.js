const express = require("express");
const crypto = require("crypto");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");
const { writeAuditEvent } = require("../services/auditTrailService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const {
  validateBackupDryRunRequest,
  validateBackupRestoreRequest,
} = require("../validation/requestValidators");

const router = express.Router();

/*
  IMPORTANT:
  Backup and restore are intentionally SYSTEM-WIDE.

  We do NOT separate backup by selected store because a real backup must be able
  to restore the whole business system: branches, users, store access, products,
  stock transfers, stock movement source records, sales, debts, audit records,
  settings, SMS logs, and activity logs.

  Store-separated downloads for boss/accounting are handled by exportRoutes.js.

  This route backs up the clean current table contract only:
  final canonical application tables plus schema_migrations. Old compatibility aliases are
  intentionally skipped so they cannot duplicate restored business records.
*/

const RESTORE_CONFIRMATION_TEXT = "RESTORE_FULL_SYSTEM_BACKUP";
const BACKUP_MANIFEST_VERSION = "chalin03-equipment-sales-foundation-v1";
const LEGACY_ALIAS_TABLES = new Set(["stores", "user_store_access", "activity_logs"]);

function requireOriginalSystemAdministrator(req, res, next) {
  if (!isOriginalSystemAdministrator(req.user)) {
    return res.status(403).json({
      status: "error",
      code: "SYSTEM_ADMINISTRATOR_REQUIRED",
      message:
        "Only the original System Administrator can download, validate or restore a full-system backup.",
    });
  }

  return next();
}

const PREFERRED_TABLE_ORDER = [
  "branches",
  "schema_migrations",
  "users",
  "user_branch_access",
  "user_permission_overrides",
  "business_units",
  "business_locations",
  "user_business_access",
  "user_category_assignment_conflicts",
  "worker_profiles",
  "worker_assignments",
  "worker_family_members",
  "worker_emergency_contacts",
  "worker_documents",
  "worker_licenses",
  "worker_property_assignments",
  "worker_status_history",
  "worker_profile_change_history",
  "worker_private_files",
  "worker_print_history",
  "worker_hr_letters",
  "standalone_hr_documents",
  "document_signature_settings",
  "worker_category_assignment_conflicts",
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
  "sale_change_history",
  "debts",
  "debt_payments",
  "returns",
  "expenses",
  "sms_log",
  "activity_log",
  "security_event_dismissals",
  "application_error_log",
  "settings",
  "daily_closings",
  "daily_closing_revisions",
  "audit_signoffs",
  "audit_unlock_requests",
  "audit_reapproval_log",
  "stock_transfers",
  "stock_transfer_items",
  "fleet_assets",
  "fleet_meter_readings",
  "fleet_fuel_logs",
  "fleet_maintenance_records",
  "fleet_inspections",
  "mining_sites",
  "user_mining_site_access",
  "user_hire_location_access",
  "mining_daily_logs",
  "mining_production_records",
  "mining_equipment_logs",
  "mining_fuel_logs",
  "mining_expenses",
  "mining_incidents",
  "mining_stockpiles",
  "mining_dispatches",
  "mining_stockpile_movements",
  "mining_fuel_tanks",
  "mining_fuel_transactions",
  "mining_fuel_reconciliations",
  "mining_contractors",
  "mining_shift_crews",
  "mining_shift_crew_members",
  "mining_site_closings",
  "hire_customers",
  "hire_enquiries",
  "hire_quotations",
  "hire_contracts",
  "hire_contract_assets",
  "hire_dispatches",
  "hire_work_logs",
  "hire_invoices",
  "hire_invoice_lines",
  "hire_payments",
  "hire_return_inspections",
  "hire_rate_cards",
  "hire_quotation_items",
  "hire_contract_items",
  "hire_contract_amendments",
  "hire_deposit_transactions",
  "hire_commercial_approvals",
  "hire_evidence_files",
  "hire_damage_assessments",
  "notification_rules",
  "notifications",
  "notification_user_states",
  "notification_escalations",
  "notification_sync_runs",
  "shared_control_evidence",
  "installment_settings",
  "installment_sequences",
  "installment_agreements",
  "installment_agreement_items",
  "installment_schedule",
  "installment_payments",
  "installment_payment_allocations",
  "installment_reschedules",
  "installment_reminder_log",
  "equipment_media",
  "equipment_sales_enquiries",
  "equipment_sales_quotations",
  "equipment_sales_quotation_items",
  "equipment_sale_agreements",
  "equipment_asset_sale_locks",
  "equipment_installment_schedule",
  "equipment_sale_payments",
  "equipment_sale_payment_allocations",
  "equipment_deliveries",
  "equipment_ownership_transfers",
  "equipment_sales_reminder_log",
  "equipment_legacy_installment_migrations",
];

const DATE_ONLY_COLUMNS = new Set([
  "due_date",
  "expense_date",
  "purchase_date",
  "closing_date",
  "period_start",
  "period_end",
  "review_date",
  "registration_expiry",
  "insurance_expiry",
  "acquisition_date",
  "log_date",
  "work_date",
  "shift_date",
  "enquiry_date",
  "expected_purchase_date",
  "requested_start_date",
  "expected_end_date",
  "start_date",
  "actual_end_date",
  "validity_date",
  "quotation_date",
  "invoice_date",
  "effective_from",
  "effective_to",
  "effective_date",
  "previous_end_date",
  "proposed_end_date",
  "first_due_date",
  "next_due_date",
  "final_due_date",
  "new_first_due_date",
  "old_next_due_date",
  "transfer_date",
]);

const DATE_TIME_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "deleted_at",
  "returned_at",
  "sent_at",
  "paid_at",
  "adjusted_at",
  "closed_at",
  "verified_at",
  "stale_detected_at",
  "voided_at",
  "reviewed_at",
  "reapproved_at",
  "requested_at",
  "approved_at",
  "dispatched_at",
  "received_at",
  "cancelled_at",
  "rejected_at",
  "logged_at",
  "resolved_at",
  "inspection_datetime",
  "completed_at",
  "reported_at",
  "log_datetime",
  "reading_datetime",
  "production_datetime",
  "incident_datetime",
  "movement_datetime",
  "transaction_datetime",
  "reconciliation_datetime",
  "dispatch_datetime",
  "payment_date",
  "return_datetime",
  "assigned_from",
  "assigned_to",
  "issued_at",
  "transaction_date",
  "captured_at",
  "decided_at",
  "settled_at",
  "delivered_at",
  "delivery_datetime",
  "sale_reserved_until",
  "sold_at",
  "archived_at",
  "scheduled_for",
  "locked_at",
  "expires_at",
  "released_at",
  "fully_paid_at",
  "revoked_at",
  "migrated_at",
]);

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function isSafeIdentifier(value) {
  return /^[a-zA-Z0-9_]+$/.test(String(value || ""));
}

function safeTableName(tableName) {
  if (!isSafeIdentifier(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }

  return `\`${tableName}\``;
}

function formatMysqlDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeValue(columnName, value) {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    if (DATE_ONLY_COLUMNS.has(columnName)) {
      return value.toISOString().slice(0, 10);
    }

    return formatMysqlDateTime(value);
  }

  if (typeof value === "string" && value.includes("T")) {
    if (DATE_ONLY_COLUMNS.has(columnName)) {
      return value.slice(0, 10);
    }

    if (DATE_TIME_COLUMNS.has(columnName)) {
      return formatMysqlDateTime(value);
    }
  }

  return value;
}

function normalizeRestoreRow(tableName, row) {
  const normalized = { ...row };

  if (tableName === "branches") {
    const branchCode =
      normalized.code || normalized.branch_code || normalized.store_code || null;
    normalized.code = branchCode;
    normalized.branch_code = branchCode;
  }

  if (tableName === "users") {
    normalized.must_change_password =
      normalized.must_change_password === undefined
        ? false
        : normalized.must_change_password;
    normalized.password_changed_at =
      normalized.password_changed_at === undefined
        ? null
        : normalized.password_changed_at;
    normalized.created_by =
      normalized.created_by === undefined ? null : normalized.created_by;
  }

  if (tableName === "sales" && normalized.amount_tendered === undefined) {
    const legacyPaid = Number(normalized.amount_paid || 0);
    const total = Number(normalized.total || 0);

    normalized.amount_tendered = legacyPaid;
    normalized.amount_paid = Number(Math.min(legacyPaid, total).toFixed(2));
    normalized.change_due = Number(Math.max(legacyPaid - total, 0).toFixed(2));
    normalized.balance = Number(Math.max(total - normalized.amount_paid, 0).toFixed(2));
  }

  return normalized;
}

function orderTables(tableNames) {
  const uniqueTables = Array.from(new Set(tableNames)).filter(isSafeIdentifier);
  const tableSet = new Set(uniqueTables);

  return PREFERRED_TABLE_ORDER.filter(
    (tableName) => tableSet.has(tableName) && !LEGACY_ALIAS_TABLES.has(tableName)
  );
}

async function getExistingTables(connection) {
  const [rows] = await connection.query("SHOW TABLES");

  const tableNames = rows
    .map((row) => Object.values(row)[0])
    .filter(isSafeIdentifier);

  return orderTables(tableNames);
}

async function tableExists(connection, tableName) {
  if (!isSafeIdentifier(tableName)) {
    return false;
  }

  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );

  return rows.length > 0;
}

async function getTableColumns(connection, tableName) {
  const [columns] = await connection.query(
    `SHOW COLUMNS FROM ${safeTableName(tableName)}`
  );

  return columns.map((column) => column.Field).filter(isSafeIdentifier);
}

async function getTableCounts(connection, tableNames) {
  const counts = {};

  for (const tableName of tableNames) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS total_count FROM ${safeTableName(tableName)}`
    );

    counts[tableName] = Number(rows[0]?.total_count || 0);
  }

  return counts;
}

function stableBackupChecksum(backup) {
  const checksumPayload = JSON.stringify({
    backup_type: backup.backup_type,
    included_tables: backup.included_tables,
    table_counts: backup.table_counts,
    tables: backup.tables,
  });

  return crypto.createHash("sha256").update(checksumPayload).digest("hex");
}

async function validateBackupForRestore(connection, backup) {
  const errors = [];
  const warnings = [];

  if (
    !backup ||
    backup.backup_type !== "full_system_backup" ||
    !backup.tables ||
    typeof backup.tables !== "object"
  ) {
    errors.push("Invalid full-system backup file.");
    return { valid: false, errors, warnings, tablesToRestore: [] };
  }

  const existingTables = await getExistingTables(connection);
  const restoreTables = existingTables.filter(
    (tableName) => tableName !== "schema_migrations"
  );
  const backupTableNames = Object.keys(backup.tables).filter(isSafeIdentifier);
  const tablesToRestore = restoreTables.filter((tableName) =>
    Array.isArray(backup.tables[tableName])
  );

  if (tablesToRestore.length === 0) {
    errors.push("Backup does not contain matching canonical tables for this system.");
  }

  const missingTables = restoreTables.filter(
    (tableName) => !Array.isArray(backup.tables[tableName])
  );

  if (missingTables.length > 0) {
    warnings.push(
      `Backup does not contain these current canonical tables: ${missingTables.join(", ")}.`
    );
  }

  const unsupportedTables = backupTableNames.filter(
    (tableName) => !restoreTables.includes(tableName)
  );

  if (unsupportedTables.length > 0) {
    warnings.push(
      `Backup contains unsupported or legacy tables that will not be restored: ${unsupportedTables.join(", ")}.`
    );
  }

  for (const tableName of tablesToRestore) {
    const rows = backup.tables[tableName];
    if (!Array.isArray(rows)) {
      errors.push(`Table ${tableName} is not an array.`);
      continue;
    }

    const seenIds = new Set();
    for (const row of rows) {
      if (!row || typeof row !== "object") {
        errors.push(`Table ${tableName} contains a non-object row.`);
        break;
      }

      if (row.id !== undefined && row.id !== null) {
        const id = String(row.id);
        if (seenIds.has(id)) {
          errors.push(`Table ${tableName} contains duplicate id ${id}.`);
          break;
        }
        seenIds.add(id);
      }
    }
  }

  if (backup.checksum_sha256) {
    const actualChecksum = stableBackupChecksum({
      ...backup,
      checksum_sha256: undefined,
      manifest: undefined,
    });

    if (actualChecksum !== backup.checksum_sha256) {
      errors.push("Backup checksum does not match the backup contents.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    existingTables,
    restoreTables,
    tablesToRestore,
    unsupportedTables,
    missingTables,
  };
}

async function insertRows(connection, tableName, rows) {
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return;
  }

  if (!(await tableExists(connection, tableName))) {
    return;
  }

  const tableColumns = await getTableColumns(connection, tableName);
  const allowedColumns = new Set(tableColumns);
  const normalizedRows = rows.map((row) => normalizeRestoreRow(tableName, row));

  const columns = Object.keys(normalizedRows[0]).filter(
    (column) => isSafeIdentifier(column) && allowedColumns.has(column)
  );

  if (columns.length === 0) {
    return;
  }

  const escapedColumns = columns.map((column) => `\`${column}\``).join(", ");
  const placeholders = columns.map(() => "?").join(", ");

  const sql = `INSERT INTO ${safeTableName(
    tableName
  )} (${escapedColumns}) VALUES (${placeholders})`;

  for (const row of normalizedRows) {
    const values = columns.map((column) => normalizeValue(column, row[column]));
    await connection.query(sql, values);
  }
}

async function resetAutoIncrement(connection, tableName) {
  const columns = await getTableColumns(connection, tableName);

  if (!columns.includes("id")) {
    return;
  }

  const [rows] = await connection.query(
    `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ${safeTableName(tableName)}`
  );
  const nextId = Math.max(1, Number(rows[0]?.next_id || 1));

  await connection.query(
    `ALTER TABLE ${safeTableName(tableName)} AUTO_INCREMENT = ${nextId}`
  );
}

async function safeInsertRestoreActivity(connection, branchId, userId, backupCreatedAt) {
  try {
    await writeAuditEvent({
      connection,
      userId: userId || null,
      branchId: branchId || 1,
      action: "RESTORE_BACKUP",
      details: `Database restored from backup created at ${
        backupCreatedAt || "unknown time"
      }`,
      workspaceCode: "spare_parts",
      entityType: "backup",
      actionType: "RESTORE_BACKUP",
      outcome: "success",
      severity: "critical",
      metadata: {
        backup_created_at: backupCreatedAt || null,
      },
    });
  } catch (error) {
    console.warn("Could not write restore activity log:", error.message);
  }
}

async function safeInsertBackupActivity({
  connection,
  branchId,
  userId,
  backupCreatedAt,
  tableCount,
  skippedTableCount,
  totalRecordCount,
}) {
  try {
    const details = `Created full system backup at ${backupCreatedAt}. Tables included: ${tableCount}. Skipped tables: ${skippedTableCount}. Total records: ${totalRecordCount}.`;

    await writeAuditEvent({
      connection,
      userId: userId || null,
      branchId: branchId || 1,
      action: "CREATE_BACKUP",
      details,
      workspaceCode: "spare_parts",
      entityType: "backup",
      actionType: "CREATE_BACKUP",
      outcome: "success",
      severity: "critical",
      metadata: {
        backup_created_at: backupCreatedAt,
        table_count: tableCount,
        skipped_table_count: skippedTableCount,
        total_record_count: totalRecordCount,
      },
    });
  } catch (error) {
    console.warn("Could not write backup activity log:", error.message);
  }
}

async function sendBackupCreatedSecuritySmsAlert({
  branchId,
  createdByUser,
  backupCreatedAt,
  tableCount,
  skippedTableCount,
  totalRecordCount,
}) {
  try {
    const { businessName, branch } = await buildOwnerAlertContext(branchId);

    const createdBy =
      createdByUser?.full_name || createdByUser?.username || "Admin";

    const message = `${businessName}: Security alert. Full system backup created/downloaded for ${branch.name} (${branch.code}). Tables included: ${tableCount}. Skipped tables: ${skippedTableCount}. Records: ${totalRecordCount}. Created by ${createdBy} on ${formatSecurityDateTime(
      backupCreatedAt
    )}. Keep backup file private.`;

    await sendOwnerSmsAlert({
      branchId,
      message,
      smsType: "security_alert",
      sentBy: createdByUser?.id || null,
    });
  } catch (error) {
    console.warn("Backup created SMS alert skipped:", error.message);
  }
}

// GET /api/backups/download
router.get("/download", requireAuth, requireOriginalSystemAdministrator, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const branchId = getBranchId(req);
    const existingTables = await getExistingTables(connection);
    const backupCreatedAt = new Date().toISOString();

    const initialCounts = await getTableCounts(connection, existingTables);
    const initialTotalRecordCount = Object.values(initialCounts).reduce(
      (sum, count) => sum + Number(count || 0),
      0
    );

    await safeInsertBackupActivity({
      connection,
      branchId,
      userId: req.user?.id || null,
      backupCreatedAt,
      tableCount: existingTables.length,
      skippedTableCount: 0,
      totalRecordCount: initialTotalRecordCount,
    });

    const finalCounts = await getTableCounts(connection, existingTables);
    const finalTotalRecordCount = Object.values(finalCounts).reduce(
      (sum, count) => sum + Number(count || 0),
      0
    );

    await sendBackupCreatedSecuritySmsAlert({
      branchId,
      createdByUser: req.user,
      backupCreatedAt,
      tableCount: existingTables.length,
      skippedTableCount: 0,
      totalRecordCount: finalTotalRecordCount,
    });

    const backup = {
      app: "Chalin 03 Group Operations Platform",
      version: BACKUP_MANIFEST_VERSION,
      backup_type: "full_system_backup",
      selected_branch_id_when_created: branchId,
      created_at: backupCreatedAt,
      warning:
        "This backup contains all branches, business records, users, branch access records, settings, logs, and password hashes. Keep it private.",
      notes: [
        "This is a full-system backup, not a selected-store export.",
        "Stock Movement Ledger does not have one separate table; it is rebuilt from sales, purchases, returns, stock adjustments, and stock transfers.",
        "Shared fleet equipment, meter, fuel, maintenance, inspection, equipment sales, installments, deliveries, ownership transfers and media records are included when they exist.",
        "Use Exports for accountant/boss reports. Use Backups only for system recovery.",
      ],
      included_tables: existingTables,
      skipped_tables: [],
      table_counts: finalCounts,
      total_record_count: finalTotalRecordCount,
      tables: {},
    };

    for (const tableName of existingTables) {
      const [rows] = await connection.query(
        `SELECT * FROM ${safeTableName(tableName)}`
      );

      backup.tables[tableName] = rows;
    }

    backup.checksum_sha256 = stableBackupChecksum(backup);
    backup.manifest = {
      manifest_version: BACKUP_MANIFEST_VERSION,
      created_at: backupCreatedAt,
      app_version: BACKUP_MANIFEST_VERSION,
      canonical_table_count: existingTables.length,
      canonical_tables: existingTables,
      table_counts: finalCounts,
      checksum_algorithm: "sha256",
      checksum_sha256: backup.checksum_sha256,
    };

    const timestamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replaceAll(".", "-");

    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="chalin03-full-system-backup-${timestamp}.json"`
    );

    return res.json(backup);
  } catch (error) {
    console.error("Download backup error:", error);

    return res.status(500).json({
      status: "error",
      message: error.message || "Something went wrong while creating backup.",
    });
  } finally {
    connection.release();
  }
});

// POST /api/backups/restore/dry-run
router.post(
  "/restore/dry-run",
  requireAuth,
  requireOriginalSystemAdministrator,
  validateRequest(validateBackupDryRunRequest),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const backup = req.validated.backup;
      const report = await validateBackupForRestore(connection, backup);

      return res.status(report.valid ? 200 : 400).json({
        status: report.valid ? "success" : "error",
        message: report.valid
          ? "Backup dry-run validation completed."
          : "Backup dry-run validation failed.",
        dry_run: true,
        valid: report.valid,
        errors: report.errors,
        warnings: report.warnings,
        restore_tables: report.tablesToRestore,
        missing_tables: report.missingTables,
        unsupported_tables: report.unsupportedTables,
        checksum_sha256: backup?.checksum_sha256 || null,
      });
    } catch (error) {
      console.error("Restore dry-run error:", error);
      return res.status(500).json({
        status: "error",
        message: "The restore dry run could not be completed safely.",
      });
    } finally {
      connection.release();
    }
  }
);

// POST /api/backups/restore
router.post(
  "/restore",
  requireAuth,
  requireOriginalSystemAdministrator,
  validateRequest(validateBackupRestoreRequest),
  async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    const branchId = getBranchId(req);
    const { backup, confirmation } = req.validated;

    if (String(process.env.ALLOW_WEB_RESTORE || "").toLowerCase() !== "true") {
      return res.status(403).json({
        status: "error",
        message:
          "Web restore is disabled. Set ALLOW_WEB_RESTORE=true only for an approved local restore window.",
      });
    }

    if (confirmation !== RESTORE_CONFIRMATION_TEXT) {
      return res.status(400).json({
        status: "error",
        message:
          "Restore confirmation is required. Type RESTORE_FULL_SYSTEM_BACKUP before restoring.",
      });
    }

    const validation = await validateBackupForRestore(connection, backup);

    if (!validation.valid) {
      return res.status(400).json({
        status: "error",
        message: "Backup validation failed. No restore was started.",
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    const restoreTables = validation.restoreTables;
    const backupTablesToInsert = validation.tablesToRestore;

    await connection.beginTransaction();
    transactionStarted = true;
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    // A full-system restore replaces the complete canonical business state.
    // Tables absent from an older backup are intentionally cleared so newer
    // Mining/Hire records are not mixed with an older Spare Parts recovery.
    for (const tableName of [...restoreTables].reverse()) {
      await connection.query(`DELETE FROM ${safeTableName(tableName)}`);
    }

    for (const tableName of backupTablesToInsert) {
      await insertRows(connection, tableName, backup.tables[tableName]);
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    await safeInsertRestoreActivity(connection, branchId, req.user?.id || null, backup.created_at);

    const afterCounts = await getTableCounts(connection, restoreTables);
    const totalRestoredRecords = Object.values(afterCounts).reduce(
      (sum, count) => sum + Number(count || 0),
      0
    );

    await connection.commit();
    transactionStarted = false;

    // ALTER TABLE causes an implicit commit in MySQL, so AUTO_INCREMENT repair
    // is deliberately performed only after the transactional data restore.
    const autoIncrementWarnings = [];

    for (const tableName of restoreTables) {
      try {
        await resetAutoIncrement(connection, tableName);
      } catch (error) {
        autoIncrementWarnings.push(tableName);
        console.warn(`Could not reset AUTO_INCREMENT for ${tableName}:`, error.message);
      }
    }

    return res.json({
      status: "success",
      message:
        "Backup restored successfully. Please logout and login again to refresh the system.",
      restore_scope: "full_system_all_stores",
      cleared_tables: restoreTables,
      restored_tables: backupTablesToInsert,
      restored_table_counts: afterCounts,
      total_restored_records: totalRestoredRecords,
      auto_increment_warnings: autoIncrementWarnings,
      skipped_tables: Object.keys(backup.tables).filter(
        (tableName) =>
          !backupTablesToInsert.includes(tableName) || LEGACY_ALIAS_TABLES.has(tableName)
      ),
      ignored_alias_tables: Object.keys(backup.tables).filter((tableName) =>
        LEGACY_ALIAS_TABLES.has(tableName)
      ),
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Restore rollback failed:", rollbackError);
      }
    }

    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch (foreignKeyError) {
      console.error("Failed to re-enable foreign key checks:", foreignKeyError);
    }

    console.error("Restore backup error:", error);

    return res.status(500).json({
      status: "error",
      message:
        "The full-system restore could not be completed. No success was reported. Keep the system closed and review the backend log.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
