const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

const TABLES = [
  "users",
  "settings",
  "suppliers",
  "products",
  "customers",
  "sales",
  "sale_items",
  "debts",
  "debt_payments",
  "returns",
  "expenses",
  "purchases",
  "purchase_items",
  "sms_log",
  "activity_log",
];

const DATE_ONLY_COLUMNS = new Set([
  "due_date",
  "expense_date",
  "purchase_date",
]);

const DATE_TIME_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "returned_at",
  "sent_at",
  "paid_at",
]);

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

async function insertRows(connection, tableName, rows) {
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const columns = Object.keys(rows[0]);

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

// GET /api/backups/download
router.get("/download", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const backup = {
      app: "Chalin 03 Sales & Inventory Management System",
      created_at: new Date().toISOString(),
      warning:
        "This backup contains business records and password hashes. Keep it private.",
      tables: {},
    };

    for (const tableName of TABLES) {
      const [rows] = await pool.query(`SELECT * FROM ${safeTableName(tableName)}`);
      backup.tables[tableName] = rows;
    }

    const timestamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replaceAll(".", "-");

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="chalin03-backup-${timestamp}.json"`
    );

    return res.json(backup);
  } catch (error) {
    console.error("Download backup error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while creating backup.",
    });
  }
});

// POST /api/backups/restore
router.post("/restore", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const backup = req.body;

    if (!backup || !backup.tables || typeof backup.tables !== "object") {
      return res.status(400).json({
        status: "error",
        message: "Invalid backup file.",
      });
    }

    for (const tableName of TABLES) {
      if (!Array.isArray(backup.tables[tableName])) {
        return res.status(400).json({
          status: "error",
          message: `Backup is missing table: ${tableName}`,
        });
      }
    }

    await connection.beginTransaction();

    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const tableName of [...TABLES].reverse()) {
      await connection.query(`DELETE FROM ${safeTableName(tableName)}`);
    }

    for (const tableName of TABLES) {
      await insertRows(connection, tableName, backup.tables[tableName]);
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");

    await connection.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`,
      [
        null,
        "RESTORE_BACKUP",
        `Database restored from backup created at ${
          backup.created_at || "unknown time"
        }`,
      ]
    );

    await connection.commit();

    return res.json({
      status: "success",
      message:
        "Backup restored successfully. Please logout and login again to refresh the system.",
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
      message: "Something went wrong while restoring backup.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;