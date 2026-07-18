const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { getPublicPermissionCatalog } = require("../security/permissionCatalog");
const { getSmsConfig } = require("../services/smsService");

const router = express.Router();
const startedAt = Date.now();

const EXPECTED_TABLES = Object.freeze([
  "branches",
  "schema_migrations",
  "users",
  "user_branch_access",
  "user_permission_overrides",
  "business_units",
  "business_locations",
  "user_business_access",
  "products",
  "sales",
  "sale_items",
  "debts",
  "activity_log",
  "security_event_dismissals",
  "settings",
  "stock_transfers",
  "fleet_assets",
  "mining_sites",
  "user_mining_site_access",
  "user_hire_location_access",
  "mining_daily_logs",
  "mining_production_records",
  "mining_equipment_logs",
  "hire_customers",
  "hire_enquiries",
  "hire_quotations",
  "hire_contracts",
  "hire_dispatches",
  "hire_work_logs",
  "hire_invoices",
  "hire_payments",
  "hire_return_inspections",
]);

function appVersion() {
  return process.env.APP_VERSION || "final-local-6b-6f";
}

async function databaseStatus() {
  const started = Date.now();
  const [dbRows] = await pool.query("SELECT DATABASE() AS database_name");
  const [tableRows] = await pool.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`
  );
  const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME));
  const missingTables = EXPECTED_TABLES.filter((table) => !existingTables.has(table));

  return {
    reachable: true,
    database_name: dbRows[0]?.database_name || null,
    query_latency_ms: Date.now() - started,
    expected_table_count: EXPECTED_TABLES.length,
    missing_tables: missingTables,
  };
}

async function recentErrorCounts() {
  try {
    const [rows] = await pool.query(
      `SELECT status_code, COUNT(*) AS count
       FROM application_error_log
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       GROUP BY status_code
       ORDER BY status_code`
    );
    return rows;
  } catch {
    return [];
  }
}

async function permissionControlStatus() {
  try {
    const [[overrideCounts], [dismissalCounts]] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) AS total_override_records,
           SUM(revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())) AS active_overrides,
           SUM(revoked_at IS NULL AND effect = 'deny' AND (expires_at IS NULL OR expires_at > NOW())) AS active_denies,
           SUM(revoked_at IS NULL AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)) AS expiring_within_7_days
         FROM user_permission_overrides`
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total_dismissal_records,
           SUM(restored_at IS NULL) AS messages_hidden_from_security_centre
         FROM security_event_dismissals`
      ),
    ]);

    return {
      overrides: overrideCounts[0] || {},
      security_messages: dismissalCounts[0] || {},
    };
  } catch {
    return {
      overrides: {},
      security_messages: {},
    };
  }
}

async function workspaceAvailability() {
  try {
    const [rows] = await pool.query(
      `SELECT code, name, is_enabled
       FROM business_units
       ORDER BY display_order, name`
    );
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      enabled: Boolean(Number(row.is_enabled)),
    }));
  } catch {
    return [];
  }
}

function missingConfigNames() {
  return ["JWT_SECRET", "DB_HOST", "DB_USER", "DB_NAME"].filter(
    (name) => !process.env[name] && !process.env[name.replace("DB_", "MYSQL")]
  );
}

router.get("/health", (req, res) => {
  res.json({
    status: "success",
    service: "Chalin 03 Group Operations Platform",
    version: appVersion(),
    uptime_seconds: Math.floor(process.uptime()),
    time: new Date().toISOString(),
    request_id: req.requestId || null,
  });
});

router.get("/readiness", async (req, res) => {
  try {
    const db = await databaseStatus();
    const ready = db.reachable && db.missing_tables.length === 0;

    return res.status(ready ? 200 : 503).json({
      status: ready ? "success" : "degraded",
      ready,
      version: appVersion(),
      checks: {
        database: db.reachable ? "ready" : "degraded",
        schema: db.missing_tables.length === 0 ? "ready" : "degraded",
        configuration: missingConfigNames().length === 0 ? "ready" : "degraded",
      },
      request_id: req.requestId || null,
    });
  } catch (error) {
    return res.status(503).json({
      status: "error",
      ready: false,
      message: "Database readiness check failed.",
      request_id: req.requestId || null,
    });
  }
});

router.get(
  "/system/diagnostics",
  requireAuth,
  requirePermission("system.diagnostics"),
  async (req, res) => {
    try {
      const [db, workspaces, errors, permissionControls] = await Promise.all([
        databaseStatus(),
        workspaceAvailability(),
        recentErrorCounts(),
        permissionControlStatus(),
      ]);
      const smsConfig = getSmsConfig();

      return res.json({
        status: "success",
        diagnostics: {
          app: "Chalin 03 Group Operations Platform",
          version: appVersion(),
          environment: process.env.NODE_ENV || "development",
          uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
          node_version: process.version,
          database: db,
          enabled_workspaces: workspaces,
          missing_configuration: missingConfigNames(),
          backup: {
            web_restore_enabled:
              String(process.env.ALLOW_WEB_RESTORE || "").toLowerCase() === "true",
            manifest_version: "chalin03-final-local-6b-6f-v1",
          },
          sms: {
            enabled: Boolean(smsConfig.enabled),
            provider: smsConfig.provider || "mock",
            sender_id_configured: Boolean(smsConfig.senderId),
            api_key_configured: Boolean(smsConfig.arkeselApiKey),
          },
          recent_error_counts: errors,
          permission_controls: permissionControls,
          permission_catalog: getPublicPermissionCatalog(),
        },
        request_id: req.requestId || null,
      });
    } catch (error) {
      return res.status(503).json({
        status: "error",
        message: "Diagnostics could not be loaded safely.",
        request_id: req.requestId || null,
      });
    }
  }
);

module.exports = router;
