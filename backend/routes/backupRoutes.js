const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");

const router = express.Router();

/*
  IMPORTANT:
  Backup and restore are intentionally SYSTEM-WIDE.

  We do NOT separate backup by selected store because a real backup must be able
  to restore the whole business system: branches, users, store access, products,
  stock transfers, stock movement source records, sales, debts, audit records,
  settings, SMS logs, and activity logs.

  Store-separated downloads for boss/accounting are handled by exportRoutes.js.

  This route now uses a preferred table order plus automatic table discovery.
  That means new current/future tables can be included in the backup without
  forgetting to update this route again.
*/

const PREFERRED_TABLE_ORDER = [
  // Core identity / configuration tables.
  "branches",
  "users",
  "user_branch_access",
  "settings",

  // Supplier, product, and inventory foundation.
  "suppliers",
  "products",
  "stock_adjustments",

  // Store-to-store transfer workflow.
  "stock_transfers",
  "stock_transfer_items",

  // Customers, sales, debts, and returns.
  "customers",
  "sales",
  "sale_items",
  "debts",
  "debt_payments",
  "returns",

  // Expenses, purchases, and daily closing.
  "expenses",
  "purchases",
  "purchase_items",
  "purchase_payments",
  "daily_closings",

  // Audit/accounting foundation.
  "audit_signoffs",
  "audit_unlock_requests",
  "audit_reapproval_log",

  // Optional accounting intelligence tables if they exist.
  "accounting_intelligence_snapshots",
  "accounting_intelligence_findings",
  "accounting_ledger_history",
  "accounting_snapshots",
  "accounting_findings",
  "accounting_ledger_entries",
  "monthly_accounting_snapshots",
  "audit_findings",

  // Communication and system logs.
  "sms_log",
  "activity_log",
];

const DATE_ONLY_COLUMNS = new Set([
  "due_date",
  "expense_date",
  "purchase_date",
  "closing_date",
  "period_start",
  "period_end",
  "review_date",
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

function orderTables(tableNames) {
  const uniqueTables = Array.from(new Set(tableNames)).filter(isSafeIdentifier);
  const tableSet = new Set(uniqueTables);

  const preferred = PREFERRED_TABLE_ORDER.filter((tableName) =>
    tableSet.has(tableName)
  );

  const remaining = uniqueTables
    .filter((tableName) => !PREFERRED_TABLE_ORDER.includes(tableName))
    .sort((a, b) => a.localeCompare(b));

  return [...preferred, ...remaining];
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

async function insertRows(connection, tableName, rows) {
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return;
  }

  if (!(await tableExists(connection, tableName))) {
    return;
  }

  const tableColumns = await getTableColumns(connection, tableName);
  const allowedColumns = new Set(tableColumns);

  const columns = Object.keys(rows[0]).filter(
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

  for (const row of rows) {
    const values = columns.map((column) => normalizeValue(column, row[column]));
    await connection.query(sql, values);
  }
}

async function safeInsertRestoreActivity(connection, branchId, backupCreatedAt) {
  try {
    if (!(await tableExists(connection, "activity_log"))) {
      return;
    }

    const columns = await getTableColumns(connection, "activity_log");
    const columnSet = new Set(columns);

    if (columnSet.has("branch_id")) {
      await connection.query(
        `INSERT INTO activity_log (branch_id, user_id, action, details)
         VALUES (?, ?, ?, ?)`,
        [
          branchId || 1,
          null,
          "RESTORE_BACKUP",
          `Database restored from backup created at ${
            backupCreatedAt || "unknown time"
          }`,
        ]
      );

      return;
    }

    await connection.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`,
      [
        null,
        "RESTORE_BACKUP",
        `Database restored from backup created at ${
          backupCreatedAt || "unknown time"
        }`,
      ]
    );
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
    if (!(await tableExists(connection, "activity_log"))) {
      return;
    }

    const columns = await getTableColumns(connection, "activity_log");
    const columnSet = new Set(columns);

    const details = `Created full system backup at ${backupCreatedAt}. Tables included: ${tableCount}. Skipped tables: ${skippedTableCount}. Total records: ${totalRecordCount}.`;

    if (columnSet.has("branch_id")) {
      await connection.query(
        `INSERT INTO activity_log (branch_id, user_id, action, details)
         VALUES (?, ?, ?, ?)`,
        [branchId || 1, userId || null, "CREATE_BACKUP", details]
      );

      return;
    }

    await connection.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`,
      [userId || null, "CREATE_BACKUP", details]
    );
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
router.get("/download", requireAuth, requireRole("admin"), async (req, res) => {
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
      app: "Chalin 03 Sales & Inventory Management System",
      version: "multi-store-stock-ledger",
      backup_type: "full_system_backup",
      selected_branch_id_when_created: branchId,
      created_at: backupCreatedAt,
      warning:
        "This backup contains all stores, business records, users, store access records, settings, logs, and password hashes. Keep it private.",
      notes: [
        "This is a full-system backup, not a selected-store export.",
        "Stock Movement Ledger does not have one separate table; it is rebuilt from sales, purchases, returns, stock adjustments, and stock transfers.",
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

    const timestamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replaceAll(".", "-");

    res.setHeader("Content-Type", "application/json");
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

// POST /api/backups/restore
router.post("/restore", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const branchId = getBranchId(req);
    const backup = req.body;

    if (!backup || !backup.tables || typeof backup.tables !== "object") {
      return res.status(400).json({
        status: "error",
        message: "Invalid backup file.",
      });
    }

    const existingTables = await getExistingTables(connection);
    const restoreTables = existingTables.filter((tableName) =>
      Array.isArray(backup.tables[tableName])
    );

    if (restoreTables.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Backup does not contain any matching tables for this system.",
      });
    }

    await connection.beginTransaction();

    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const tableName of [...restoreTables].reverse()) {
      await connection.query(`DELETE FROM ${safeTableName(tableName)}`);
    }

    for (const tableName of restoreTables) {
      await insertRows(connection, tableName, backup.tables[tableName]);
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");

    await safeInsertRestoreActivity(connection, branchId, backup.created_at);

    const afterCounts = await getTableCounts(connection, restoreTables);
    const totalRestoredRecords = Object.values(afterCounts).reduce(
      (sum, count) => sum + Number(count || 0),
      0
    );

    await connection.commit();

    return res.json({
      status: "success",
      message:
        "Backup restored successfully. Please logout and login again to refresh the system.",
      restore_scope: "full_system_all_stores",
      restored_tables: restoreTables,
      restored_table_counts: afterCounts,
      total_restored_records: totalRestoredRecords,
      skipped_tables: existingTables.filter(
        (tableName) => !restoreTables.includes(tableName)
      ),
    });
  } catch (error) {
    await connection.rollback();

    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch (foreignKeyError) {
      console.error("Failed to re-enable foreign key checks:", foreignKeyError);
    }

    console.error("Restore backup error:", error);

    return res.status(500).json({
      status: "error",
      message: error.message || "Something went wrong while restoring backup.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
