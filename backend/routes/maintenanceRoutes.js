const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

const CONFIRMATION_TEXT = "CLEAR CHALIN03 TEST DATA";

const SYSTEM_ADMIN_USER_ID = Number(process.env.SYSTEM_ADMIN_USER_ID || 1);
const SYSTEM_ADMIN_USERNAME = process.env.SYSTEM_ADMIN_USERNAME || "admin";

const TABLES_TO_CLEAR = [
  "sms_log",
  "activity_log",

  "debt_payments",
  "debts",

  "sale_items",
  "sales",

  "purchase_payments",
  "purchase_items",
  "purchases",

  "returns",
  "expenses",
  "daily_closings",

  "stock_adjustments",

  "customers",
  "suppliers",
  "products",
];

function isClearEnabled() {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return process.env.ALLOW_CLEAR_BUSINESS_DATA === "true";
}

async function getExistingTables() {
  const [rows] = await pool.query("SHOW TABLES");

  return rows.map((row) => Object.values(row)[0]);
}

async function getTableCounts(tableNames) {
  const counts = {};

  for (const tableName of tableNames) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total_count FROM \`${tableName}\``
    );

    counts[tableName] = Number(rows[0]?.total_count || 0);
  }

  return counts;
}

async function getCurrentSystemAdmin(req) {
  const [users] = await pool.query(
    `SELECT id, full_name, username, password_hash, role, is_active
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [req.user.id]
  );

  if (users.length === 0) {
    return null;
  }

  return users[0];
}

async function requireSystemAdministrator(req, res, next) {
  try {
    const user = await getCurrentSystemAdmin(req);

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "User account not found.",
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        status: "error",
        message: "This account has been disabled.",
      });
    }

    const isSystemAdmin =
      Number(user.id) === SYSTEM_ADMIN_USER_ID &&
      user.username === SYSTEM_ADMIN_USERNAME &&
      user.role === "admin";

    if (!isSystemAdmin) {
      return res.status(403).json({
        status: "error",
        message:
          "Only the main System Administrator account can clear business data.",
      });
    }

    req.systemAdmin = user;

    return next();
  } catch (error) {
    console.error("System administrator check error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while checking system administrator access.",
    });
  }
}

// GET /api/maintenance/business-data-summary
router.get(
  "/business-data-summary",
  requireAuth,
  requireSystemAdministrator,
  async (req, res) => {
    try {
      const existingTables = await getExistingTables();

      const availableTables = TABLES_TO_CLEAR.filter((tableName) =>
        existingTables.includes(tableName)
      );

      const counts = await getTableCounts(availableTables);

      return res.json({
        status: "success",
        message: "Business/test data summary loaded.",
        protected_tables: ["users", "settings"],
        tables_to_clear: availableTables,
        counts,
        confirmation_required: CONFIRMATION_TEXT,
        clear_enabled: isClearEnabled(),
        system_admin_only: true,
      });
    } catch (error) {
      console.error("Business data summary error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while loading business data summary.",
      });
    }
  }
);

// DELETE /api/maintenance/clear-business-data
router.delete(
  "/clear-business-data",
  requireAuth,
  requireSystemAdministrator,
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const { confirmation, system_admin_password } = req.body;

      if (!isClearEnabled()) {
        return res.status(403).json({
          status: "error",
          message:
            "Clear business data is disabled in production. Set ALLOW_CLEAR_BUSINESS_DATA=true in Railway only when you are ready to clear test data.",
        });
      }

      if (!system_admin_password) {
        return res.status(400).json({
          status: "error",
          message: "System Administrator password is required.",
        });
      }

      const passwordMatches = await bcrypt.compare(
        system_admin_password,
        req.systemAdmin.password_hash
      );

      if (!passwordMatches) {
        return res.status(401).json({
          status: "error",
          message: "System Administrator password is incorrect.",
        });
      }

      if (confirmation !== CONFIRMATION_TEXT) {
        return res.status(400).json({
          status: "error",
          message: `Invalid confirmation text. Type exactly: ${CONFIRMATION_TEXT}`,
        });
      }

      const existingTables = await getExistingTables();

      const availableTables = TABLES_TO_CLEAR.filter((tableName) =>
        existingTables.includes(tableName)
      );

      const beforeCounts = await getTableCounts(availableTables);

      await connection.query("SET FOREIGN_KEY_CHECKS = 0");

      for (const tableName of availableTables) {
        await connection.query(`TRUNCATE TABLE \`${tableName}\``);
      }

      await connection.query("SET FOREIGN_KEY_CHECKS = 1");

      if (existingTables.includes("activity_log")) {
        await pool.query(
          `INSERT INTO activity_log (user_id, action, details)
           VALUES (?, ?, ?)`,
          [
            req.systemAdmin.id,
            "CLEAR_BUSINESS_DATA",
            `${req.systemAdmin.username} cleared test/business data before real operation`,
          ]
        );
      }

      const afterCounts = await getTableCounts(availableTables);

      return res.json({
        status: "success",
        message:
          "Business/test data cleared successfully. Users and settings were kept.",
        protected_tables: ["users", "settings"],
        cleared_tables: availableTables,
        before_counts: beforeCounts,
        after_counts: afterCounts,
      });
    } catch (error) {
      try {
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      } catch (resetError) {
        console.error("Failed to reset foreign key checks:", resetError);
      }

      console.error("Clear business data error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while clearing business/test data.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;