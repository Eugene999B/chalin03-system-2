const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

/*
  IMPORTANT:
  Backup and restore are intentionally SYSTEM-WIDE.

  We do NOT separate backup by selected store because a real backup must be able
  to restore the whole business system: branches, users, store access, products,
  sales, debts, audit records, settings, and logs.

  Store-separated downloads for boss/accounting are handled by exportRoutes.js.
*/

const TABLES = [
  "branches",
  "users",
  "user_branch_access",
  "settings",

  "suppliers",
  "products",
  "stock_adjustments",

  "customers",
  "sales",
  "sale_items",
  "debts",
  "debt_payments",

  "returns",
  "expenses",

  "purchases",
  "purchase_items",
  "purchase_payments",

  "daily_closings",

  "audit_signoffs",
  "audit_unlock_requests",
  "audit_reapproval_log",

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
  "returned_at",
  "sent_at",
  "paid_at",
  "adjusted_at",
  "closed_at",
  "voided_at",
  "reviewed_at",
  "reapproved_at",
]);

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
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

function safeTableName(tableName) {
  if (!TABLES.includes(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }

  return `\`${tableName}\``;
}

async function tableExists(connection, tableName) {
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

async function getExistingTables(connection) {
  const existingTables = [];

  for (const tableName of TABLES) {
    if (await tableExists(connection, tableName)) {
      existingTables.push(tableName);
    }
  }

  return existingTables;
}

async function getTableColumns(connection, tableName) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM ${safeTableName(tableName)}`);
  return columns.map((column) => column.Field);
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

  const columns = Object.keys(rows[0]).filter((column) =>
    allowedColumns.has(column)
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

// GET /api/backups/download
router.get("/download", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const branchId = getBranchId(req);
    const existingTables = await getExistingTables(connection);

    const backup = {
      app: "Chalin 03 Sales & Inventory Management System",
      version: "multi-store",
      backup_type: "full_system_backup",
      selected_branch_id_when_created: branchId,
      created_at: new Date().toISOString(),
      warning:
        "This backup contains all stores, business records, users, access records, and password hashes. Keep it private.",
      tables: {},
      skipped_tables: TABLES.filter((tableName) => !existingTables.includes(tableName)),
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
      message: "Something went wrong while creating backup.",
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

    await connection.commit();

    return res.json({
      status: "success",
      message:
        "Backup restored successfully. Please logout and login again to refresh the system.",
      restored_tables: restoreTables,
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
