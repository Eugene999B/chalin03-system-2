const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  MiningSiteScopeError,
  assertMiningWorkspace,
  resolveMiningSiteScope,
  assertRecordInMiningSite,
  sendMiningSiteScopeError,
} = require("../services/miningSiteScope");

const router = express.Router();

const READ_ROLES = ["admin", "manager", "auditor"];
const WRITE_ROLES = ["admin", "manager"];

const SITE_STATUSES = new Set(["active", "paused", "closed"]);
const LOG_STATUSES = new Set(["draft", "submitted", "approved"]);
const SHIFT_CODES = new Set(["day", "night", "morning", "afternoon", "custom"]);
const FUEL_TYPES = new Set([
  "receipt",
  "issue",
  "adjustment_in",
  "adjustment_out",
]);
const INCIDENT_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const INCIDENT_STATUSES = new Set([
  "open",
  "investigating",
  "resolved",
  "closed",
]);

function cleanText(value, maxLength = 255) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  const cleaned = cleanText(value, maxLength);
  return cleaned || null;
}

function toPositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function toNonNegativeNumber(value, fallback = null, decimals = 2) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Number(number.toFixed(decimals));
}

function toPositiveNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Number(number.toFixed(decimals));
}

function toDateOnly(value, fallback = null) {
  const cleaned = cleanText(value, 20);
  if (!cleaned) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
}

function toDateTime(value, fallback = null) {
  const cleaned = cleanText(value, 50);
  if (!cleaned) return fallback;
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 0);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function isMissingMiningTableError(error) {
  return error?.code === "ER_NO_SUCH_TABLE" || error?.errno === 1146;
}

function sendMiningSetupError(res, error) {
  if (!isMissingMiningTableError(error)) return false;

  res.status(503).json({
    status: "error",
    code: "MINING_DATABASE_SETUP_REQUIRED",
    message:
      "The Mining database migration has not been applied yet. Run database/migrations/003_add_mining_operations.sql in the local database first.",
  });

  return true;
}

function sendDuplicateError(res, error, message) {
  if (error?.code !== "ER_DUP_ENTRY") return false;
  res.status(409).json({ status: "error", message });
  return true;
}

async function logActivity(connectionOrPool, req, action, details) {
  try {
    await connectionOrPool.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [getBranchId(req), req.user?.id || null, action, details]
    );
  } catch (error) {
    console.warn("Mining activity log skipped:", error.message);
  }
}

async function getSite(siteId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT * FROM mining_sites WHERE id = ? LIMIT 1`,
    [siteId]
  );
  return rows[0] || null;
}

async function validateDailyLogForSite(
  dailyLogId,
  siteId,
  connection = pool
) {
  if (!dailyLogId) return null;

  const [rows] = await connection.query(
    `SELECT id, site_id, status
     FROM mining_daily_logs
     WHERE id = ?
     LIMIT 1`,
    [dailyLogId]
  );

  if (!rows.length) {
    throw new MiningSiteScopeError(
      400,
      "The selected daily log was not found.",
      "MINING_DAILY_LOG_NOT_FOUND"
    );
  }

  if (Number(rows[0].site_id) !== Number(siteId)) {
    throw new MiningSiteScopeError(
      400,
      "The selected daily log belongs to a different Mining site.",
      "MINING_DAILY_LOG_SITE_MISMATCH"
    );
  }

  return rows[0];
}

function buildSiteDateFilters(req, dateColumn, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const siteId = req.miningSiteScope?.siteId || toPositiveInt(req.query.site_id);
  const from = toDateOnly(req.query.from);
  const to = toDateOnly(req.query.to);
  const where = [];
  const params = [];

  if (siteId) {
    where.push(`${prefix}site_id = ?`);
    params.push(siteId);
  }

  if (from) {
    where.push(`DATE(${prefix}${dateColumn}) >= ?`);
    params.push(from);
  }

  if (to) {
    where.push(`DATE(${prefix}${dateColumn}) <= ?`);
    params.push(to);
  }

  return { where, params, siteId, from, to };
}

async function approveMiningRecord(
  req,
  res,
  { table, idColumn = "id", label, activityAction }
) {
  const recordId = toPositiveInt(req.params.id);

  if (!recordId) {
    return res.status(400).json({
      status: "error",
      message: `Invalid ${label.toLowerCase()} ID.`,
    });
  }

  const [rows] = await pool.query(
    `SELECT record.${idColumn} AS id, record.site_id, record.status,
            ms.site_code
     FROM \`${table}\` record
     INNER JOIN mining_sites ms ON ms.id = record.site_id
     WHERE record.${idColumn} = ?
     LIMIT 1`,
    [recordId]
  );

  if (!rows.length) {
    return res.status(404).json({
      status: "error",
      message: `${label} not found.`,
    });
  }

  assertRecordInMiningSite(
    req.miningSiteScope,
    rows[0].site_id,
    label
  );

  await pool.query(
    `UPDATE \`${table}\`
     SET status = 'approved',
         approved_by = ?,
         approved_at = NOW()
     WHERE ${idColumn} = ?`,
    [req.user.id, recordId]
  );

  await logActivity(
    pool,
    req,
    activityAction,
    `Approved ${label.toLowerCase()} ${recordId} for ${rows[0].site_code}`
  );

  return res.json({
    status: "success",
    message: `${label} approved successfully.`,
  });
}

router.use(requireAuth);

router.use(async (req, res, next) => {
  try {
    assertMiningWorkspace(req);

    // Site administration is independent of the currently selected site.
    // Administrators manage all sites, while other roles see assigned sites.
    if (req.path === "/sites" || req.path.startsWith("/sites/")) {
      return next();
    }

    const requireSelection = req.method !== "GET";
    const scope = await resolveMiningSiteScope(req, { requireSelection });

    if (
      requireSelection &&
      req.body?.site_id &&
      Number(req.body.site_id) !== Number(scope.siteId)
    ) {
      throw new MiningSiteScopeError(
        403,
        "The record site must match the Mining site selected in the workspace.",
        "MINING_SITE_MISMATCH"
      );
    }

    req.miningSiteScope = scope;
    return next();
  } catch (error) {
    if (sendMiningSiteScopeError(res, error)) return;
    console.error("Mining site scope middleware error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not validate the selected Mining site.",
    });
  }
});

// GET /api/mining/dashboard
router.get(
  "/dashboard",
  requireRole(...READ_ROLES),
  async (req, res) => {
    try {
      const siteId = req.miningSiteScope?.siteId || toPositiveInt(req.query.site_id);
      const siteClause = siteId ? "AND site_id = ?" : "";
      const siteParams = siteId ? [siteId] : [];

      const [[siteSummary], [dailySummary], [equipmentSummary], [fuelSummary], [expenseSummary], [incidentSummary], [productionByUnit], [sitePerformance], [recentLogs], [recentIncidents]] =
        await Promise.all([
          pool.query(
            `SELECT
               COUNT(*) AS total_sites,
               SUM(CASE WHEN is_active = TRUE AND status = 'active' THEN 1 ELSE 0 END) AS active_sites,
               SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused_sites
             FROM mining_sites
             WHERE 1 = 1 ${siteId ? "AND id = ?" : ""}`,
            siteParams
          ),
          pool.query(
            `SELECT
               COUNT(*) AS daily_logs_today,
               SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_logs_today,
               COALESCE(SUM(workforce_count), 0) AS workforce_today
             FROM mining_daily_logs
             WHERE log_date = CURDATE() ${siteClause}`,
            siteParams
          ),
          pool.query(
            `SELECT
               COUNT(DISTINCT asset_id) AS equipment_used_today,
               COALESCE(SUM(working_hours), 0) AS working_hours_today,
               COALESCE(SUM(idle_hours), 0) AS idle_hours_today,
               COALESCE(SUM(breakdown_hours), 0) AS breakdown_hours_today
             FROM mining_equipment_logs
             WHERE work_date = CURDATE() ${siteClause}`,
            siteParams
          ),
          pool.query(
            `SELECT
               COALESCE(SUM(CASE WHEN transaction_type = 'issue' THEN quantity_litres ELSE 0 END), 0) AS fuel_issued_today,
               COALESCE(SUM(CASE WHEN transaction_type IN ('receipt', 'adjustment_in') THEN quantity_litres ELSE 0 END), 0) AS fuel_received_today,
               COALESCE(SUM(CASE
                 WHEN transaction_type IN ('receipt', 'adjustment_in') THEN quantity_litres
                 WHEN transaction_type IN ('issue', 'adjustment_out') THEN -quantity_litres
                 ELSE 0 END), 0) AS fuel_net_movement_today
             FROM mining_fuel_logs
             WHERE DATE(log_datetime) = CURDATE() ${siteClause}`,
            siteParams
          ),
          pool.query(
            `SELECT
               COUNT(*) AS expenses_today_count,
               COALESCE(SUM(amount), 0) AS expenses_today
             FROM mining_expenses
             WHERE expense_date = CURDATE() ${siteClause}`,
            siteParams
          ),
          pool.query(
            `SELECT
               SUM(CASE WHEN status IN ('open', 'investigating') THEN 1 ELSE 0 END) AS open_incidents,
               SUM(CASE WHEN severity IN ('high', 'critical') AND status <> 'closed' THEN 1 ELSE 0 END) AS serious_open_incidents
             FROM mining_incidents
             WHERE 1 = 1 ${siteClause}`,
            siteParams
          ),
          pool.query(
            `SELECT
               unit,
               COALESCE(SUM(quantity), 0) AS total_quantity,
               COUNT(*) AS record_count
             FROM mining_production_records
             WHERE DATE(production_datetime) = CURDATE() ${siteClause}
             GROUP BY unit
             ORDER BY total_quantity DESC`,
            siteParams
          ),
          pool.query(
            `SELECT
               ms.id AS site_id,
               ms.site_code,
               ms.site_name,
               ms.production_unit,
               ms.daily_target,
               COALESCE(SUM(CASE WHEN DATE(mpr.production_datetime) = CURDATE() THEN mpr.quantity ELSE 0 END), 0) AS today_quantity,
               CASE
                 WHEN ms.daily_target IS NULL OR ms.daily_target <= 0 THEN NULL
                 ELSE ROUND(
                   COALESCE(SUM(CASE WHEN DATE(mpr.production_datetime) = CURDATE() THEN mpr.quantity ELSE 0 END), 0)
                   / ms.daily_target * 100,
                   1
                 )
               END AS target_percent
             FROM mining_sites ms
             LEFT JOIN mining_production_records mpr ON mpr.site_id = ms.id
             WHERE ms.is_active = TRUE ${siteId ? "AND ms.id = ?" : ""}
             GROUP BY ms.id
             ORDER BY ms.site_name ASC`,
            siteParams
          ),
          pool.query(
            `SELECT mdl.*, ms.site_code, ms.site_name,
                    creator.full_name AS created_by_name,
                    approver.full_name AS approved_by_name
             FROM mining_daily_logs mdl
             INNER JOIN mining_sites ms ON ms.id = mdl.site_id
             LEFT JOIN users creator ON creator.id = mdl.created_by
             LEFT JOIN users approver ON approver.id = mdl.approved_by
             WHERE 1 = 1 ${siteId ? "AND mdl.site_id = ?" : ""}
             ORDER BY mdl.log_date DESC, mdl.id DESC
             LIMIT 8`,
            siteParams
          ),
          pool.query(
            `SELECT mi.*, ms.site_code, ms.site_name
             FROM mining_incidents mi
             INNER JOIN mining_sites ms ON ms.id = mi.site_id
             WHERE 1 = 1 ${siteId ? "AND mi.site_id = ?" : ""}
             ORDER BY mi.incident_datetime DESC, mi.id DESC
             LIMIT 8`,
            siteParams
          ),
        ]);

      return res.json({
        status: "success",
        summary: {
          ...(siteSummary[0] || {}),
          ...(dailySummary[0] || {}),
          ...(equipmentSummary[0] || {}),
          ...(fuelSummary[0] || {}),
          ...(expenseSummary[0] || {}),
          ...(incidentSummary[0] || {}),
        },
        production_by_unit: productionByUnit,
        site_performance: sitePerformance,
        recent_daily_logs: recentLogs,
        recent_incidents: recentIncidents,
      });
    } catch (error) {
      console.error("Mining dashboard error:", error);
      if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
      return res.status(500).json({
        status: "error",
        message: "Something went wrong while loading the Mining dashboard.",
      });
    }
  }
);

// GET /api/mining/sites
router.get("/sites", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const includeInactive = cleanText(req.query.include_inactive, 10) === "true";
    const search = cleanText(req.query.search, 120);
    const where = [];
    const params = [];
    const role = cleanText(req.user?.role, 50).toLowerCase();

    if (role !== "admin") {
      where.push(`EXISTS (
        SELECT 1
        FROM user_mining_site_access access
        WHERE access.site_id = ms.id
          AND access.user_id = ?
          AND access.can_access = TRUE
      )`);
      params.push(req.user.id);
    }

    if (!includeInactive) where.push("ms.is_active = TRUE");
    if (search) {
      const value = `%${search}%`;
      where.push(`(
        ms.site_code LIKE ? OR ms.site_name LIKE ? OR ms.location LIKE ?
        OR ms.material_type LIKE ? OR ms.manager_name LIKE ?
      )`);
      params.push(value, value, value, value, value);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [sites] = await pool.query(
      `SELECT ms.*, creator.full_name AS created_by_name
       FROM mining_sites ms
       LEFT JOIN users creator ON creator.id = ms.created_by
       ${whereClause}
       ORDER BY ms.is_active DESC, ms.site_name ASC`,
      params
    );

    return res.json({ status: "success", count: sites.length, sites });
  } catch (error) {
    console.error("Get mining sites error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while loading mining sites.",
    });
  }
});

// POST /api/mining/sites
router.post("/sites", requireRole("admin"), async (req, res) => {
  try {
    const siteCode = cleanText(req.body.site_code, 50).toUpperCase();
    const siteName = cleanText(req.body.site_name, 150);
    const productionUnit = cleanText(req.body.production_unit, 40) || "tonnes";
    const status = cleanText(req.body.status, 30).toLowerCase() || "active";
    const dailyTarget = toNonNegativeNumber(req.body.daily_target, null, 3);

    if (!siteCode || !siteName) {
      return res.status(400).json({
        status: "error",
        message: "Site code and site name are required.",
      });
    }
    if (!SITE_STATUSES.has(status)) {
      return res.status(400).json({ status: "error", message: "Invalid site status." });
    }
    if (req.body.daily_target !== "" && req.body.daily_target != null && dailyTarget === null) {
      return res.status(400).json({ status: "error", message: "Daily target must be zero or greater." });
    }

    const [result] = await pool.query(
      `INSERT INTO mining_sites (
         site_code, site_name, location, material_type, production_unit,
         daily_target, manager_name, manager_phone, status, notes,
         is_active, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
      [
        siteCode,
        siteName,
        nullableText(req.body.location, 255),
        nullableText(req.body.material_type, 100),
        productionUnit,
        dailyTarget,
        nullableText(req.body.manager_name, 150),
        nullableText(req.body.manager_phone, 40),
        status,
        nullableText(req.body.notes, 3000),
        req.user.id,
        req.user.id,
      ]
    );

    await logActivity(
      pool,
      req,
      "CREATE_MINING_SITE",
      `Created mining site ${siteCode} — ${siteName}`
    );

    return res.status(201).json({
      status: "success",
      message: "Mining site created successfully.",
      site: await getSite(result.insertId),
    });
  } catch (error) {
    console.error("Create mining site error:", error);
    if (sendDuplicateError(res, error, "A mining site with this code already exists.")) return;
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not create mining site." });
  }
});

// PUT /api/mining/sites/:id
router.put("/sites/:id", requireRole("admin"), async (req, res) => {
  try {
    const siteId = toPositiveInt(req.params.id);
    if (!siteId) return res.status(400).json({ status: "error", message: "Invalid site ID." });

    const existing = await getSite(siteId);
    if (!existing) return res.status(404).json({ status: "error", message: "Mining site not found." });

    const siteCode = cleanText(req.body.site_code, 50).toUpperCase();
    const siteName = cleanText(req.body.site_name, 150);
    const productionUnit = cleanText(req.body.production_unit, 40) || "tonnes";
    const status = cleanText(req.body.status, 30).toLowerCase() || "active";
    const dailyTarget = toNonNegativeNumber(req.body.daily_target, null, 3);
    const isActive = req.body.is_active === false || req.body.is_active === 0 ? 0 : 1;

    if (!siteCode || !siteName) {
      return res.status(400).json({ status: "error", message: "Site code and site name are required." });
    }
    if (!SITE_STATUSES.has(status)) {
      return res.status(400).json({ status: "error", message: "Invalid site status." });
    }
    if (req.body.daily_target !== "" && req.body.daily_target != null && dailyTarget === null) {
      return res.status(400).json({ status: "error", message: "Daily target must be zero or greater." });
    }

    await pool.query(
      `UPDATE mining_sites SET
         site_code = ?, site_name = ?, location = ?, material_type = ?,
         production_unit = ?, daily_target = ?, manager_name = ?, manager_phone = ?,
         status = ?, notes = ?, is_active = ?, updated_by = ?
       WHERE id = ?`,
      [
        siteCode,
        siteName,
        nullableText(req.body.location, 255),
        nullableText(req.body.material_type, 100),
        productionUnit,
        dailyTarget,
        nullableText(req.body.manager_name, 150),
        nullableText(req.body.manager_phone, 40),
        status,
        nullableText(req.body.notes, 3000),
        isActive,
        req.user.id,
        siteId,
      ]
    );

    await logActivity(
      pool,
      req,
      "UPDATE_MINING_SITE",
      `Updated mining site ${siteCode} — ${siteName}`
    );

    return res.json({
      status: "success",
      message: "Mining site updated successfully.",
      site: await getSite(siteId),
    });
  } catch (error) {
    console.error("Update mining site error:", error);
    if (sendDuplicateError(res, error, "A mining site with this code already exists.")) return;
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not update mining site." });
  }
});

// GET /api/mining/daily-logs
router.get("/daily-logs", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const filter = buildSiteDateFilters(req, "log_date", "mdl");
    const status = cleanText(req.query.status, 30).toLowerCase();
    if (status) {
      filter.where.push("mdl.status = ?");
      filter.params.push(status);
    }
    const whereClause = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";

    const [logs] = await pool.query(
      `SELECT mdl.*, ms.site_code, ms.site_name,
              creator.full_name AS created_by_name,
              approver.full_name AS approved_by_name
       FROM mining_daily_logs mdl
       INNER JOIN mining_sites ms ON ms.id = mdl.site_id
       LEFT JOIN users creator ON creator.id = mdl.created_by
       LEFT JOIN users approver ON approver.id = mdl.approved_by
       ${whereClause}
       ORDER BY mdl.log_date DESC, FIELD(mdl.shift_code, 'night', 'afternoon', 'day', 'morning', 'custom'), mdl.id DESC
       LIMIT 250`,
      filter.params
    );

    return res.json({ status: "success", count: logs.length, daily_logs: logs });
  } catch (error) {
    console.error("Get mining daily logs error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load mining daily logs." });
  }
});

// POST /api/mining/daily-logs
router.post("/daily-logs", requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const siteId = req.miningSiteScope?.siteId || toPositiveInt(req.body.site_id);
    const logDate = toDateOnly(req.body.log_date);
    const shiftCode = cleanText(req.body.shift_code, 30).toLowerCase() || "day";
    const workforceCount = toNonNegativeNumber(req.body.workforce_count, 0, 0);
    const status = cleanText(req.body.status, 30).toLowerCase() || "draft";

    if (!siteId || !logDate) {
      return res.status(400).json({ status: "error", message: "Site and log date are required." });
    }
    if (!SHIFT_CODES.has(shiftCode)) {
      return res.status(400).json({ status: "error", message: "Invalid shift." });
    }
    if (!LOG_STATUSES.has(status)) {
      return res.status(400).json({ status: "error", message: "Invalid daily-log status." });
    }
    if (workforceCount === null) {
      return res.status(400).json({ status: "error", message: "Workforce count must be zero or greater." });
    }
    const site = await getSite(siteId);
    if (!site) return res.status(404).json({ status: "error", message: "Mining site not found." });

    const [result] = await pool.query(
      `INSERT INTO mining_daily_logs (
         site_id, log_date, shift_code, supervisor_name, weather_conditions,
         workforce_count, opening_notes, closing_notes, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        siteId,
        logDate,
        shiftCode,
        nullableText(req.body.supervisor_name, 150),
        nullableText(req.body.weather_conditions, 150),
        workforceCount,
        nullableText(req.body.opening_notes, 3000),
        nullableText(req.body.closing_notes, 3000),
        status,
        req.user.id,
      ]
    );

    await logActivity(
      pool,
      req,
      "CREATE_MINING_DAILY_LOG",
      `Created ${shiftCode} daily log for ${site.site_code} on ${logDate}`
    );

    return res.status(201).json({
      status: "success",
      message: "Mining daily log saved successfully.",
      daily_log_id: result.insertId,
    });
  } catch (error) {
    console.error("Create mining daily log error:", error);
    if (sendDuplicateError(res, error, "A daily log already exists for this site, date and shift.")) return;
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not save mining daily log." });
  }
});

// PATCH /api/mining/daily-logs/:id/approve
router.patch("/daily-logs/:id/approve", requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const logId = toPositiveInt(req.params.id);
    if (!logId) return res.status(400).json({ status: "error", message: "Invalid daily-log ID." });

    const [rows] = await pool.query(
      `SELECT mdl.*, ms.site_code FROM mining_daily_logs mdl
       INNER JOIN mining_sites ms ON ms.id = mdl.site_id
       WHERE mdl.id = ? LIMIT 1`,
      [logId]
    );
    if (!rows.length) return res.status(404).json({ status: "error", message: "Daily log not found." });

    assertRecordInMiningSite(
      req.miningSiteScope,
      rows[0].site_id,
      "Daily log"
    );

    await pool.query(
      `UPDATE mining_daily_logs
       SET status = 'approved', approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [req.user.id, logId]
    );

    await logActivity(
      pool,
      req,
      "APPROVE_MINING_DAILY_LOG",
      `Approved mining daily log ${logId} for ${rows[0].site_code}`
    );

    return res.json({ status: "success", message: "Daily log approved successfully." });
  } catch (error) {
    console.error("Approve mining daily log error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not approve daily log." });
  }
});

// GET /api/mining/production
router.get("/production", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const filter = buildSiteDateFilters(req, "production_datetime", "mpr");
    const whereClause = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const [records] = await pool.query(
      `SELECT mpr.*, ms.site_code, ms.site_name,
              creator.full_name AS created_by_name,
              approver.full_name AS approved_by_name
       FROM mining_production_records mpr
       INNER JOIN mining_sites ms ON ms.id = mpr.site_id
       LEFT JOIN users creator ON creator.id = mpr.created_by
       LEFT JOIN users approver ON approver.id = mpr.approved_by
       ${whereClause}
       ORDER BY mpr.production_datetime DESC, mpr.id DESC
       LIMIT 300`,
      filter.params
    );
    return res.json({ status: "success", count: records.length, production_records: records });
  } catch (error) {
    console.error("Get mining production error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load production records." });
  }
});

// POST /api/mining/production
router.post("/production", requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const siteId = req.miningSiteScope?.siteId || toPositiveInt(req.body.site_id);
    const dailyLogId = toPositiveInt(req.body.daily_log_id);
    const productionDateTime = toDateTime(req.body.production_datetime);
    const quantity = toPositiveNumber(req.body.quantity, 3);
    const unit = cleanText(req.body.unit, 40);

    if (!siteId || !productionDateTime || !quantity || !unit) {
      return res.status(400).json({
        status: "error",
        message: "Site, production date/time, quantity and unit are required.",
      });
    }
    const site = await getSite(siteId);
    if (!site) return res.status(404).json({ status: "error", message: "Mining site not found." });

    await validateDailyLogForSite(dailyLogId, siteId);

    const [result] = await pool.query(
      `INSERT INTO mining_production_records (
         site_id, daily_log_id, production_datetime, work_area, material_type,
         quantity, unit, grade_quality, destination, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        siteId,
        dailyLogId,
        productionDateTime,
        nullableText(req.body.work_area, 150),
        nullableText(req.body.material_type, 100) || site.material_type,
        quantity,
        unit,
        nullableText(req.body.grade_quality, 120),
        nullableText(req.body.destination, 180),
        nullableText(req.body.notes, 3000),
        req.user.id,
      ]
    );

    await logActivity(
      pool,
      req,
      "CREATE_MINING_PRODUCTION",
      `Recorded ${quantity} ${unit} production at ${site.site_code}`
    );

    return res.status(201).json({
      status: "success",
      message: "Production record saved successfully.",
      production_record_id: result.insertId,
    });
  } catch (error) {
    console.error("Create mining production error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not save production record." });
  }
});

// GET /api/mining/equipment-logs
router.get("/equipment-logs", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const filter = buildSiteDateFilters(req, "work_date", "mel");
    const assetId = toPositiveInt(req.query.asset_id);
    if (assetId) {
      filter.where.push("mel.asset_id = ?");
      filter.params.push(assetId);
    }
    const whereClause = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const [logs] = await pool.query(
      `SELECT mel.*, ms.site_code, ms.site_name,
              fa.asset_code, fa.asset_name, fa.asset_type,
              creator.full_name AS created_by_name,
              approver.full_name AS approved_by_name
       FROM mining_equipment_logs mel
       INNER JOIN mining_sites ms ON ms.id = mel.site_id
       INNER JOIN fleet_assets fa ON fa.id = mel.asset_id
       LEFT JOIN users creator ON creator.id = mel.created_by
       LEFT JOIN users approver ON approver.id = mel.approved_by
       ${whereClause}
       ORDER BY mel.work_date DESC, mel.id DESC
       LIMIT 300`,
      filter.params
    );
    return res.json({ status: "success", count: logs.length, equipment_logs: logs });
  } catch (error) {
    console.error("Get mining equipment logs error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load equipment logs." });
  }
});

// POST /api/mining/equipment-logs
router.post("/equipment-logs", requireRole(...WRITE_ROLES), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const siteId = req.miningSiteScope?.siteId || toPositiveInt(req.body.site_id);
    const dailyLogId = toPositiveInt(req.body.daily_log_id);
    const assetId = toPositiveInt(req.body.asset_id);
    const workDate = toDateOnly(req.body.work_date);
    const shiftCode = cleanText(req.body.shift_code, 30).toLowerCase() || "day";
    const startMeter = toNonNegativeNumber(req.body.start_meter, null);
    const endMeter = toNonNegativeNumber(req.body.end_meter, null);
    const idleHours = toNonNegativeNumber(req.body.idle_hours, 0);
    const breakdownHours = toNonNegativeNumber(req.body.breakdown_hours, 0);
    const fuelLitres = toNonNegativeNumber(req.body.fuel_litres, 0);
    let workingHours = toNonNegativeNumber(req.body.working_hours, null);

    if (!siteId || !assetId || !workDate || startMeter === null || endMeter === null) {
      return res.status(400).json({
        status: "error",
        message: "Site, equipment, work date, start meter and end meter are required.",
      });
    }
    if (!SHIFT_CODES.has(shiftCode)) {
      return res.status(400).json({ status: "error", message: "Invalid shift." });
    }
    if (endMeter < startMeter) {
      return res.status(400).json({ status: "error", message: "End meter cannot be below start meter." });
    }
    if ([idleHours, breakdownHours, fuelLitres].some((value) => value === null)) {
      return res.status(400).json({ status: "error", message: "Hours and fuel must be zero or greater." });
    }
    if (workingHours === null) workingHours = Number((endMeter - startMeter).toFixed(2));

    await connection.beginTransaction();

    const site = await getSite(siteId, connection);
    if (!site) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Mining site not found." });
    }

    await validateDailyLogForSite(dailyLogId, siteId, connection);

    const [assets] = await connection.query(
      `SELECT id, asset_code, asset_name, current_meter, is_active
       FROM fleet_assets WHERE id = ? LIMIT 1 FOR UPDATE`,
      [assetId]
    );
    if (!assets.length || !assets[0].is_active) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Active fleet equipment not found." });
    }
    const asset = assets[0];
    if (endMeter < Number(asset.current_meter || 0)) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: `End meter cannot be below the equipment's current meter (${asset.current_meter}).`,
      });
    }

    const [result] = await connection.query(
      `INSERT INTO mining_equipment_logs (
         site_id, daily_log_id, asset_id, work_date, shift_code, operator_name,
         start_meter, end_meter, working_hours, idle_hours, breakdown_hours,
         fuel_litres, task_description, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        siteId,
        dailyLogId,
        assetId,
        workDate,
        shiftCode,
        nullableText(req.body.operator_name, 150),
        startMeter,
        endMeter,
        workingHours,
        idleHours,
        breakdownHours,
        fuelLitres,
        nullableText(req.body.task_description, 3000),
        req.user.id,
      ]
    );

    await connection.query(
      `INSERT INTO fleet_meter_readings (
         asset_id, reading_value, reading_datetime, source_type, notes, recorded_by
       ) VALUES (?, ?, ?, 'mining_shift', ?, ?)`,
      [
        assetId,
        endMeter,
        `${workDate} 23:59:00`,
        `Mining shift at ${site.site_code}; log ${result.insertId}`,
        req.user.id,
      ]
    );

    const nextStatus = breakdownHours > 0 && workingHours === 0 ? "breakdown" : "assigned_mining";
    await connection.query(
      `UPDATE fleet_assets
       SET current_meter = GREATEST(current_meter, ?),
           current_status = ?, current_location = ?, assigned_operator_name = ?, updated_by = ?
       WHERE id = ?`,
      [
        endMeter,
        nextStatus,
        site.site_name,
        nullableText(req.body.operator_name, 150),
        req.user.id,
        assetId,
      ]
    );

    await logActivity(
      connection,
      req,
      "CREATE_MINING_EQUIPMENT_LOG",
      `Recorded ${asset.asset_code} mining shift at ${site.site_code}; ${workingHours} working hours`
    );

    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Equipment shift log saved and Fleet meter updated.",
      equipment_log_id: result.insertId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create mining equipment log error:", error);
    if (sendDuplicateError(res, error, "This equipment already has a log for the selected site, date and shift.")) return;
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not save equipment shift log." });
  } finally {
    connection.release();
  }
});

// GET /api/mining/fuel-logs
router.get("/fuel-logs", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const filter = buildSiteDateFilters(req, "log_datetime", "mfl");
    const transactionType = cleanText(req.query.transaction_type, 30).toLowerCase();
    if (transactionType) {
      filter.where.push("mfl.transaction_type = ?");
      filter.params.push(transactionType);
    }
    const whereClause = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const [logs] = await pool.query(
      `SELECT mfl.*, ms.site_code, ms.site_name,
              fa.asset_code, fa.asset_name,
              creator.full_name AS created_by_name
       FROM mining_fuel_logs mfl
       INNER JOIN mining_sites ms ON ms.id = mfl.site_id
       LEFT JOIN fleet_assets fa ON fa.id = mfl.asset_id
       LEFT JOIN users creator ON creator.id = mfl.created_by
       ${whereClause}
       ORDER BY mfl.log_datetime DESC, mfl.id DESC
       LIMIT 300`,
      filter.params
    );

    return res.json({ status: "success", count: logs.length, fuel_logs: logs });
  } catch (error) {
    console.error("Get mining fuel logs error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load mining fuel logs." });
  }
});

// POST /api/mining/fuel-logs
router.post("/fuel-logs", requireRole(...WRITE_ROLES), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const siteId = req.miningSiteScope?.siteId || toPositiveInt(req.body.site_id);
    const assetId = toPositiveInt(req.body.asset_id);
    const logDateTime = toDateTime(req.body.log_datetime);
    const transactionType = cleanText(req.body.transaction_type, 30).toLowerCase();
    const quantity = toPositiveNumber(req.body.quantity_litres);
    const meterReading = toNonNegativeNumber(req.body.meter_reading, null);
    const unitCost = toNonNegativeNumber(req.body.unit_cost, 0);
    let totalCost = toNonNegativeNumber(req.body.total_cost, null);

    if (!siteId || !logDateTime || !quantity || !FUEL_TYPES.has(transactionType)) {
      return res.status(400).json({
        status: "error",
        message: "Site, date/time, transaction type and litres are required.",
      });
    }
    if (req.body.meter_reading !== "" && req.body.meter_reading != null && meterReading === null) {
      return res.status(400).json({ status: "error", message: "Meter reading must be zero or greater." });
    }
    if (unitCost === null || totalCost === null && req.body.total_cost !== "" && req.body.total_cost != null) {
      return res.status(400).json({ status: "error", message: "Fuel costs must be zero or greater." });
    }
    if (totalCost === null) totalCost = Number((quantity * unitCost).toFixed(2));

    await connection.beginTransaction();
    const site = await getSite(siteId, connection);
    if (!site) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Mining site not found." });
    }

    let asset = null;
    if (assetId) {
      const [assetRows] = await connection.query(
        `SELECT id, asset_code, asset_name FROM fleet_assets WHERE id = ? AND is_active = TRUE LIMIT 1`,
        [assetId]
      );
      asset = assetRows[0] || null;
      if (!asset) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "Active fleet equipment not found." });
      }
    }

    const [result] = await connection.query(
      `INSERT INTO mining_fuel_logs (
         site_id, asset_id, log_datetime, transaction_type, quantity_litres,
         storage_name, supplier_or_source, recipient_name, meter_reading,
         unit_cost, total_cost, reference_number, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        siteId,
        assetId,
        logDateTime,
        transactionType,
        quantity,
        nullableText(req.body.storage_name, 120),
        nullableText(req.body.supplier_or_source, 150),
        nullableText(req.body.recipient_name, 150),
        meterReading,
        unitCost,
        totalCost,
        nullableText(req.body.reference_number, 120),
        nullableText(req.body.notes, 3000),
        req.user.id,
      ]
    );

    if (transactionType === "issue" && asset) {
      await connection.query(
        `INSERT INTO fleet_fuel_logs (
           asset_id, log_datetime, quantity_litres, meter_reading,
           supplier_or_source, reference_number, cost_amount, notes, recorded_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assetId,
          logDateTime,
          quantity,
          meterReading,
          nullableText(req.body.supplier_or_source, 150) || site.site_name,
          nullableText(req.body.reference_number, 120),
          totalCost,
          `Mining fuel issue at ${site.site_code}; mining log ${result.insertId}`,
          req.user.id,
        ]
      );
    }

    await logActivity(
      connection,
      req,
      "CREATE_MINING_FUEL_LOG",
      `Recorded ${transactionType} of ${quantity} litres at ${site.site_code}${asset ? ` for ${asset.asset_code}` : ""}`
    );

    await connection.commit();
    return res.status(201).json({
      status: "success",
      message:
        transactionType === "issue" && asset
          ? "Fuel issue saved and added to the Fleet fuel history."
          : "Mining fuel transaction saved successfully.",
      fuel_log_id: result.insertId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create mining fuel log error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not save mining fuel transaction." });
  } finally {
    connection.release();
  }
});

// GET /api/mining/expenses
router.get("/expenses", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const filter = buildSiteDateFilters(req, "expense_date", "me");
    const whereClause = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const [expenses] = await pool.query(
      `SELECT me.*, ms.site_code, ms.site_name,
              creator.full_name AS created_by_name,
              approver.full_name AS approved_by_name
       FROM mining_expenses me
       INNER JOIN mining_sites ms ON ms.id = me.site_id
       LEFT JOIN users creator ON creator.id = me.created_by
       LEFT JOIN users approver ON approver.id = me.approved_by
       ${whereClause}
       ORDER BY me.expense_date DESC, me.id DESC
       LIMIT 300`,
      filter.params
    );
    return res.json({ status: "success", count: expenses.length, expenses });
  } catch (error) {
    console.error("Get mining expenses error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load mining expenses." });
  }
});

// POST /api/mining/expenses
router.post("/expenses", requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const siteId = req.miningSiteScope?.siteId || toPositiveInt(req.body.site_id);
    const expenseDate = toDateOnly(req.body.expense_date);
    const category = cleanText(req.body.category, 80);
    const amount = toPositiveNumber(req.body.amount);

    if (!siteId || !expenseDate || !category || !amount) {
      return res.status(400).json({
        status: "error",
        message: "Site, expense date, category and amount are required.",
      });
    }
    const site = await getSite(siteId);
    if (!site) return res.status(404).json({ status: "error", message: "Mining site not found." });

    const [result] = await pool.query(
      `INSERT INTO mining_expenses (
         site_id, expense_date, category, description, amount,
         payment_method, reference_number, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        siteId,
        expenseDate,
        category,
        nullableText(req.body.description, 3000),
        amount,
        nullableText(req.body.payment_method, 40),
        nullableText(req.body.reference_number, 120),
        req.user.id,
      ]
    );

    await logActivity(
      pool,
      req,
      "CREATE_MINING_EXPENSE",
      `Recorded ${category} expense of GHS ${amount.toFixed(2)} at ${site.site_code}`
    );

    return res.status(201).json({
      status: "success",
      message: "Mining expense saved successfully.",
      expense_id: result.insertId,
    });
  } catch (error) {
    console.error("Create mining expense error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not save mining expense." });
  }
});

// PATCH /api/mining/production/:id/approve
router.patch("/production/:id/approve", requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    return await approveMiningRecord(req, res, {
      table: "mining_production_records",
      label: "Production record",
      activityAction: "APPROVE_MINING_PRODUCTION",
    });
  } catch (error) {
    console.error("Approve mining production error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({
      status: "error",
      message: "Could not approve production record.",
    });
  }
});

// PATCH /api/mining/equipment-logs/:id/approve
router.patch("/equipment-logs/:id/approve", requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    return await approveMiningRecord(req, res, {
      table: "mining_equipment_logs",
      label: "Equipment log",
      activityAction: "APPROVE_MINING_EQUIPMENT_LOG",
    });
  } catch (error) {
    console.error("Approve mining equipment log error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({
      status: "error",
      message: "Could not approve equipment log.",
    });
  }
});

// PATCH /api/mining/expenses/:id/approve
router.patch("/expenses/:id/approve", requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    return await approveMiningRecord(req, res, {
      table: "mining_expenses",
      label: "Mining expense",
      activityAction: "APPROVE_MINING_EXPENSE",
    });
  } catch (error) {
    console.error("Approve mining expense error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({
      status: "error",
      message: "Could not approve mining expense.",
    });
  }
});

// GET /api/mining/incidents
router.get("/incidents", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const filter = buildSiteDateFilters(req, "incident_datetime", "mi");
    const status = cleanText(req.query.status, 30).toLowerCase();
    if (status) {
      filter.where.push("mi.status = ?");
      filter.params.push(status);
    }
    const whereClause = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const [incidents] = await pool.query(
      `SELECT mi.*, ms.site_code, ms.site_name,
              creator.full_name AS created_by_name,
              closer.full_name AS closed_by_name
       FROM mining_incidents mi
       INNER JOIN mining_sites ms ON ms.id = mi.site_id
       LEFT JOIN users creator ON creator.id = mi.created_by
       LEFT JOIN users closer ON closer.id = mi.closed_by
       ${whereClause}
       ORDER BY FIELD(mi.status, 'open', 'investigating', 'resolved', 'closed'),
                FIELD(mi.severity, 'critical', 'high', 'medium', 'low'),
                mi.incident_datetime DESC
       LIMIT 300`,
      filter.params
    );
    return res.json({ status: "success", count: incidents.length, incidents });
  } catch (error) {
    console.error("Get mining incidents error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load mining incidents." });
  }
});

// POST /api/mining/incidents
router.post("/incidents", requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const siteId = req.miningSiteScope?.siteId || toPositiveInt(req.body.site_id);
    const incidentDateTime = toDateTime(req.body.incident_datetime);
    const incidentType = cleanText(req.body.incident_type, 80);
    const severity = cleanText(req.body.severity, 30).toLowerCase() || "low";
    const description = cleanText(req.body.description, 5000);

    if (!siteId || !incidentDateTime || !incidentType || !description) {
      return res.status(400).json({
        status: "error",
        message: "Site, incident date/time, type and description are required.",
      });
    }
    if (!INCIDENT_SEVERITIES.has(severity)) {
      return res.status(400).json({ status: "error", message: "Invalid incident severity." });
    }
    const site = await getSite(siteId);
    if (!site) return res.status(404).json({ status: "error", message: "Mining site not found." });

    const [result] = await pool.query(
      `INSERT INTO mining_incidents (
         site_id, incident_datetime, incident_type, severity, exact_area,
         people_involved, description, immediate_action, corrective_action,
         responsible_officer, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [
        siteId,
        incidentDateTime,
        incidentType,
        severity,
        nullableText(req.body.exact_area, 150),
        nullableText(req.body.people_involved, 3000),
        description,
        nullableText(req.body.immediate_action, 3000),
        nullableText(req.body.corrective_action, 3000),
        nullableText(req.body.responsible_officer, 150),
        req.user.id,
      ]
    );

    await logActivity(
      pool,
      req,
      "CREATE_MINING_INCIDENT",
      `Recorded ${severity} ${incidentType} incident at ${site.site_code}`
    );

    return res.status(201).json({
      status: "success",
      message: "Mining incident saved successfully.",
      incident_id: result.insertId,
    });
  } catch (error) {
    console.error("Create mining incident error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not save mining incident." });
  }
});

// PATCH /api/mining/incidents/:id/status
router.patch("/incidents/:id/status", requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const incidentId = toPositiveInt(req.params.id);
    const status = cleanText(req.body.status, 30).toLowerCase();
    if (!incidentId || !INCIDENT_STATUSES.has(status)) {
      return res.status(400).json({ status: "error", message: "Valid incident ID and status are required." });
    }

    const [rows] = await pool.query(
      `SELECT mi.id, mi.site_id, mi.incident_type, ms.site_code
       FROM mining_incidents mi
       INNER JOIN mining_sites ms ON ms.id = mi.site_id
       WHERE mi.id = ? LIMIT 1`,
      [incidentId]
    );
    if (!rows.length) return res.status(404).json({ status: "error", message: "Incident not found." });

    assertRecordInMiningSite(
      req.miningSiteScope,
      rows[0].site_id,
      "Incident"
    );

    const closed = status === "closed";
    await pool.query(
      `UPDATE mining_incidents
       SET status = ?, corrective_action = COALESCE(?, corrective_action),
           closed_by = ?, closed_at = ?
       WHERE id = ?`,
      [
        status,
        nullableText(req.body.corrective_action, 3000),
        closed ? req.user.id : null,
        closed ? new Date().toISOString().slice(0, 19).replace("T", " ") : null,
        incidentId,
      ]
    );

    await logActivity(
      pool,
      req,
      "UPDATE_MINING_INCIDENT_STATUS",
      `Changed ${rows[0].incident_type} incident ${incidentId} at ${rows[0].site_code} to ${status}`
    );

    return res.json({ status: "success", message: "Incident status updated successfully." });
  } catch (error) {
    console.error("Update mining incident error:", error);
    if (sendMiningSiteScopeError(res, error)) return;
    if (sendMiningSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not update incident status." });
  }
});

module.exports = router;
