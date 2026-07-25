const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  clearTablesTransactionally,
  resolveMaintenanceClearAvailability,
} = require("../services/maintenanceResetService");

const router = express.Router();

const CONFIRMATION_TEXT = "CLEAR CHALIN03 TEST DATA";

const SYSTEM_ADMIN_USER_ID = Number(process.env.SYSTEM_ADMIN_USER_ID || 1);
const SYSTEM_ADMIN_USERNAME = process.env.SYSTEM_ADMIN_USERNAME || "admin";

/*
  IMPORTANT:
  This maintenance route is intentionally SYSTEM-WIDE.

  It is for clearing test/business data before real operation starts.
  It clears records for all stores, not only the selected store.

  Protected tables are kept:
  - branches and group business units/locations
  - users and branch/business access
  - settings

  Newly included business data areas:
  - stock transfers and transfer items
  - stock adjustments
  - stock movement ledger source records are cleared through their source tables
  - accounting/audit intelligence tables when they exist
  - shared fleet, meter, fuel, maintenance, and inspection records
  - mining sites, daily logs, production, equipment, fuel, expenses, and incidents
  - WhatsApp/receipt notification logs when they exist
*/

const TABLES_TO_CLEAR = [
  // Communication and notification logs.
  "sms_log",
  "whatsapp_log",
  "whatsapp_logs",
  "whatsapp_receipt_log",
  "whatsapp_receipt_logs",
  "notification_log",
  "notification_logs",
  "receipt_links",

  // Activity and audit/accounting generated records.
  "activity_log",
  "audit_reapproval_log",
  "audit_unlock_requests",
  "audit_signoffs",
  "audit_findings",
  "accounting_findings",
  "accounting_snapshots",
  "accounting_ledger_entries",
  "accounting_ledger_history",
  "accounting_intelligence_findings",
  "accounting_intelligence_snapshots",
  "accounting_intelligence_ledger_history",
  "monthly_accounting_snapshots",

  // Debt records.
  "debt_payments",
  "debts",

  // Returns and sales records.
  "returns",
  "sale_items",
  "sales",

  // Purchase and supplier payment records.
  "purchase_payments",
  "purchase_items",
  "purchases",

  // Store closing and expenses.
  "expenses",
  "daily_closings",

  // Stock transfers must be cleared before products.
  "stock_transfer_items",
  "stock_transfers",

  // Stock adjustment records.
  "stock_adjustments",

  // Equipment Hire records must be cleared before Shared Fleet assets.
  "hire_return_inspections",
  "hire_payments",
  "hire_invoice_lines",
  "hire_invoices",
  "hire_work_logs",
  "hire_dispatches",
  "hire_contract_assets",
  "hire_contracts",
  "hire_quotations",
  "hire_enquiries",
  "hire_customers",

  // Mining operational records must be cleared before mining sites and fleet assets.
  "mining_incidents",
  "mining_expenses",
  "mining_fuel_logs",
  "mining_equipment_logs",
  "mining_production_records",
  "mining_daily_logs",
  "mining_sites",

  // Shared fleet operational records.
  "fleet_meter_readings",
  "fleet_fuel_logs",
  "fleet_maintenance_records",
  "fleet_inspections",
  "fleet_assets",

  // Master business records. These are cleared only before real operation starts.
  "customers",
  "suppliers",
  "products",
];

const PROTECTED_TABLES = [
  "branches",
  "business_units",
  "business_locations",
  "users",
  "user_branch_access",
  "user_business_access",
  "user_mining_site_access",
  "user_hire_location_access",
  "settings",
  "sms_templates",
  "business_settings",
  "backup_history",
  "restore_history",
];

function getBranchId(req) {
  const branchId = Number(
    req.user?.branch_id || req.user?.default_branch_id || 1
  );

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function clearAvailability() {
  return resolveMaintenanceClearAvailability(process.env);
}

function isClearEnabled() {
  return clearAvailability().enabled;
}

async function getExistingTables(connection = pool) {
  const [rows] = await connection.query("SHOW TABLES");

  return rows.map((row) => Object.values(row)[0]);
}

async function getTableColumns(connection, tableName) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);

  return columns.map((column) => column.Field);
}

async function getTableCounts(tableNames, connection = pool) {
  const counts = {};

  for (const tableName of tableNames) {
    const [rows] = await connection.query(
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

async function insertClearActivityLog(connection, req) {
  const existingTables = await getExistingTables(connection);

  if (!existingTables.includes("activity_log")) {
    return { inserted: false, reason: "activity_log_missing" };
  }

  const columns = await getTableColumns(connection, "activity_log");
  const columnSet = new Set(columns);

  if (columnSet.has("branch_id")) {
    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [
        getBranchId(req),
        req.systemAdmin.id,
        "CLEAR_NON_PRODUCTION_TEST_DATA",
        `${req.systemAdmin.username} transactionally cleared disposable non-production test data for the whole multi-store system`,
      ]
    );
  } else {
    await connection.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`,
      [
        req.systemAdmin.id,
        "CLEAR_NON_PRODUCTION_TEST_DATA",
        `${req.systemAdmin.username} transactionally cleared disposable non-production test data for the whole system`,
      ]
    );
  }

  return { inserted: true };
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

      const protectedTables = PROTECTED_TABLES.filter((tableName) =>
        existingTables.includes(tableName)
      );

      const missingOptionalTables = TABLES_TO_CLEAR.filter(
        (tableName) => !existingTables.includes(tableName)
      );

      const counts = await getTableCounts(availableTables);

      return res.json({
        status: "success",
        message: "Business/test data summary loaded.",
        selected_branch_id: getBranchId(req),
        clear_scope: "full_system_all_stores",
        protected_tables: protectedTables,
        tables_to_clear: availableTables,
        missing_optional_tables: missingOptionalTables,
        counts,
        confirmation_required: CONFIRMATION_TEXT,
        clear_enabled: isClearEnabled(),
        production_permanently_blocked:
          clearAvailability().production_permanently_blocked,
        clear_environment: clearAvailability().environment,
        clear_enablement_code: clearAvailability().code,
        system_admin_only: true,
        note:
          "Stock movement ledger has no separate table in the current system. It is rebuilt from sales, purchases, returns, stock transfers and stock adjustments.",
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
      const availability = clearAvailability();

      if (!availability.enabled) {
        return res.status(403).json({
          status: "error",
          code: availability.code,
          message: availability.message,
          production_permanently_blocked:
            availability.production_permanently_blocked,
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

      const existingTables = await getExistingTables(connection);
      const availableTables = TABLES_TO_CLEAR.filter((tableName) =>
        existingTables.includes(tableName)
      );
      const protectedTables = PROTECTED_TABLES.filter((tableName) =>
        existingTables.includes(tableName)
      );
      const missingOptionalTables = TABLES_TO_CLEAR.filter(
        (tableName) => !existingTables.includes(tableName)
      );
      const beforeCounts = await getTableCounts(availableTables, connection);

      const resetResult = await clearTablesTransactionally(
        connection,
        availableTables,
        {
          beforeCommit: async ({ connection: transactionConnection }) => {
            const zeroCounts = await getTableCounts(
              availableTables,
              transactionConnection
            );
            const unclearedTables = Object.entries(zeroCounts)
              .filter(([, count]) => Number(count || 0) !== 0)
              .map(([tableName]) => tableName);

            if (unclearedTables.length > 0) {
              const error = new Error(
                `Transactional reset verification failed for: ${unclearedTables.join(", ")}.`
              );
              error.code = "MAINTENANCE_RESET_VERIFICATION_FAILED";
              throw error;
            }

            const auditResult = await insertClearActivityLog(
              transactionConnection,
              req
            );
            const afterCounts = await getTableCounts(
              availableTables,
              transactionConnection
            );

            return {
              zero_counts_before_audit: zeroCounts,
              after_counts: afterCounts,
              audit_log: auditResult,
            };
          },
        }
      );

      return res.json({
        status: "success",
        code: "NON_PRODUCTION_TEST_DATA_RESET_COMPLETED",
        message:
          "Disposable non-production test data was cleared transactionally across all workspaces. Production remains permanently blocked.",
        clear_scope: "full_system_all_stores_non_production_only",
        protected_tables: protectedTables,
        cleared_tables: availableTables,
        missing_optional_tables: missingOptionalTables,
        clear_results: resetResult.clear_results,
        before_counts: beforeCounts,
        after_counts: resetResult.before_commit_result.after_counts,
        production_permanently_blocked: true,
        note:
          "Only transaction-compatible DELETE statements were used. No implicit-commit schema operation or sequence reset was executed.",
      });
    } catch (error) {
      console.error("Transactional non-production test reset error:", error);

      return res.status(500).json({
        status: "error",
        code: error.code || "NON_PRODUCTION_TEST_RESET_FAILED",
        message:
          "The non-production test reset failed and the transaction was rolled back. Review the backend log before retrying.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
