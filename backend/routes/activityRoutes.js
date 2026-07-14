const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/permissionMiddleware");
const { rowsToCsv } = require("../utils/csvSafety");

const router = express.Router();

function cleanText(value, maxLength = 255) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function positiveInt(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function getActivityColumns() {
  try {
    const [columns] = await pool.query("SHOW COLUMNS FROM activity_log");
    return new Set(columns.map((column) => column.Field));
  } catch {
    return new Set();
  }
}

function selectColumn(columns, columnName, fallbackSql = `NULL AS ${columnName}`) {
  return columns.has(columnName) ? `al.${columnName}` : fallbackSql;
}

function addFilter({ where, params }, condition, value) {
  const cleanValue = cleanText(value);
  if (!cleanValue) return;
  where.push(condition);
  params.push(cleanValue);
}

async function loadUserScope(req, columns) {
  const role = String(req.user?.role || "").toLowerCase();
  const workspaceCode = String(req.user?.workspace_code || "spare_parts")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (role === "admin") {
    return { where: ["1 = 1"], params: [] };
  }

  if (workspaceCode === "spare_parts") {
    if (Boolean(req.user?.can_access_all_branches)) {
      return {
        where: columns.has("workspace_code")
          ? ["(al.workspace_code IS NULL OR al.workspace_code = 'spare_parts')"]
          : ["1 = 1"],
        params: [],
      };
    }

    const [rows] = await pool.query(
      `SELECT branch_id
       FROM user_branch_access
       WHERE user_id = ? AND can_access = 1`,
      [req.user.id]
    );
    const branchIds = [
      ...new Set(
        rows
          .map((row) => positiveInt(row.branch_id))
          .concat(positiveInt(req.user.branch_id), positiveInt(req.user.default_branch_id))
          .filter(Boolean)
      ),
    ];

    if (branchIds.length === 0 || !columns.has("branch_id")) {
      return { where: ["1 = 0"], params: [] };
    }

    return {
      where: [
        columns.has("workspace_code")
          ? "(al.workspace_code IS NULL OR al.workspace_code = 'spare_parts')"
          : "1 = 1",
        `al.branch_id IN (${branchIds.map(() => "?").join(", ")})`,
      ],
      params: branchIds,
    };
  }

  if (workspaceCode === "mining") {
    if (!columns.has("workspace_code") || !columns.has("mining_site_id")) {
      return { where: ["1 = 0"], params: [] };
    }

    const [rows] = await pool.query(
      `SELECT site_id
       FROM user_mining_site_access
       WHERE user_id = ? AND can_access = 1`,
      [req.user.id]
    );
    const siteIds = [...new Set(rows.map((row) => positiveInt(row.site_id)).filter(Boolean))];

    if (siteIds.length === 0) {
      return { where: ["1 = 0"], params: [] };
    }

    return {
      where: [
        "al.workspace_code = 'mining'",
        `al.mining_site_id IN (${siteIds.map(() => "?").join(", ")})`,
      ],
      params: siteIds,
    };
  }

  if (workspaceCode === "equipment_hire") {
    if (!columns.has("workspace_code") || !columns.has("hire_location_id")) {
      return { where: ["1 = 0"], params: [] };
    }

    const [rows] = await pool.query(
      `SELECT location_id
       FROM user_hire_location_access
       WHERE user_id = ? AND can_access = 1`,
      [req.user.id]
    );
    const locationIds = [
      ...new Set(rows.map((row) => positiveInt(row.location_id)).filter(Boolean)),
    ];

    if (locationIds.length === 0) {
      return { where: ["1 = 0"], params: [] };
    }

    return {
      where: [
        "al.workspace_code = 'equipment_hire'",
        `al.hire_location_id IN (${locationIds.map(() => "?").join(", ")})`,
      ],
      params: locationIds,
    };
  }

  return {
    where: ["al.user_id = ?"],
    params: [req.user.id],
  };
}

function buildAuditFilters(req, columns, scope) {
  const where = [...scope.where];
  const params = [...scope.params];

  addFilter({ where, params }, "DATE(al.created_at) >= ?", req.query.from);
  addFilter({ where, params }, "DATE(al.created_at) <= ?", req.query.to);
  addFilter({ where, params }, "al.action = ?", req.query.action);
  addFilter({ where, params }, "u.role = ?", req.query.role);
  addFilter({ where, params }, "al.user_id = ?", positiveInt(req.query.user_id));

  if (columns.has("workspace_code")) {
    addFilter({ where, params }, "al.workspace_code = ?", req.query.workspace);
  }

  if (columns.has("business_unit_id")) {
    addFilter(
      { where, params },
      "al.business_unit_id = ?",
      positiveInt(req.query.business_unit_id)
    );
  }

  if (columns.has("mining_site_id")) {
    addFilter(
      { where, params },
      "al.mining_site_id = ?",
      positiveInt(req.query.mining_site_id || req.query.site_id)
    );
  }

  if (columns.has("hire_location_id")) {
    addFilter(
      { where, params },
      "al.hire_location_id = ?",
      positiveInt(req.query.hire_location_id || req.query.location_id)
    );
  }

  if (columns.has("entity_type")) {
    addFilter({ where, params }, "al.entity_type = ?", req.query.entity_type);
  }

  if (columns.has("entity_id")) {
    addFilter({ where, params }, "al.entity_id = ?", req.query.entity_id);
  }

  if (columns.has("action_type")) {
    addFilter({ where, params }, "al.action_type = ?", req.query.action_type);
  }

  if (columns.has("outcome")) {
    addFilter({ where, params }, "al.outcome = ?", req.query.outcome);
  }

  if (columns.has("severity")) {
    addFilter({ where, params }, "al.severity = ?", req.query.severity);
  }

  if (columns.has("request_id")) {
    addFilter({ where, params }, "al.request_id = ?", req.query.request_id);
  }

  const branchId = positiveInt(req.query.branch_id);
  if (branchId && columns.has("branch_id")) {
    where.push("al.branch_id = ?");
    params.push(branchId);
  }

  const search = cleanText(req.query.search, 120);
  if (search) {
    const searchParts = [
      "al.action LIKE ?",
      "al.details LIKE ?",
      "u.full_name LIKE ?",
      "u.username LIKE ?",
      "u.role LIKE ?",
      "b.name LIKE ?",
      "b.location LIKE ?",
    ];

    if (columns.has("entity_type")) searchParts.push("al.entity_type LIKE ?");
    if (columns.has("entity_id")) searchParts.push("al.entity_id LIKE ?");
    if (columns.has("request_id")) searchParts.push("al.request_id LIKE ?");
    if (columns.has("metadata_json")) searchParts.push("al.metadata_json LIKE ?");

    where.push(`(${searchParts.join(" OR ")})`);
    const value = `%${search}%`;
    params.push(...searchParts.map(() => value));
  }

  return {
    whereSql: `WHERE ${where.join(" AND ")}`,
    params,
  };
}

function buildAuditSelect(columns) {
  return `SELECT
    al.id,
    ${selectColumn(columns, "branch_id")},
    ${selectColumn(columns, "user_id")},
    al.action,
    al.details,
    ${selectColumn(columns, "ip_address")},
    al.created_at,
    ${selectColumn(columns, "workspace_code")},
    ${selectColumn(columns, "business_unit_id")},
    ${selectColumn(columns, "mining_site_id")},
    ${selectColumn(columns, "hire_location_id")},
    ${selectColumn(columns, "entity_type")},
    ${selectColumn(columns, "entity_id")},
    ${selectColumn(columns, "action_type")},
    ${selectColumn(columns, "outcome", "'success' AS outcome")},
    ${selectColumn(columns, "severity", "'info' AS severity")},
    ${selectColumn(columns, "request_id")},
    ${selectColumn(columns, "user_agent")},
    ${selectColumn(columns, "metadata_json")},
    u.full_name,
    u.username,
    u.role,
    b.code AS branch_code,
    b.name AS branch_name,
    b.location AS branch_location`;
}

async function loadAuditRows(req, { exportMode = false } = {}) {
  const columns = await getActivityColumns();
  const scope = await loadUserScope(req, columns);
  const { whereSql, params } = buildAuditFilters(req, columns, scope);
  const limit = exportMode ? 5000 : Math.min(positiveInt(req.query.limit, 50), 200);
  const page = Math.max(positiveInt(req.query.page, 1), 1);
  const offset = exportMode ? 0 : (page - 1) * limit;

  const [logs] = await pool.query(
    `${buildAuditSelect(columns)}
     FROM activity_log al
     LEFT JOIN users u ON al.user_id = u.id
     LEFT JOIN branches b ON al.branch_id = b.id
     ${whereSql}
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [[summary]] = await pool.query(
    `SELECT
       COUNT(*) AS total_logs,
       COUNT(DISTINCT al.user_id) AS active_users
     FROM activity_log al
     LEFT JOIN users u ON al.user_id = u.id
     LEFT JOIN branches b ON al.branch_id = b.id
     ${whereSql}`,
    params
  );

  const [actions] = await pool.query(
    `SELECT al.action, COUNT(*) AS count
     FROM activity_log al
     LEFT JOIN users u ON al.user_id = u.id
     LEFT JOIN branches b ON al.branch_id = b.id
     ${whereSql}
     GROUP BY al.action
     ORDER BY al.action ASC
     LIMIT 300`,
    params
  );

  return {
    logs,
    actions,
    summary: {
      total_logs: Number(summary?.total_logs || 0),
      active_users: Number(summary?.active_users || 0),
    },
    pagination: {
      page,
      limit,
      total: Number(summary?.total_logs || 0),
      total_pages: Math.max(
        1,
        Math.ceil(Number(summary?.total_logs || 0) / Math.max(limit, 1))
      ),
    },
  };
}

router.use(requireAuth);

router.get(
  "/export.csv",
  requirePermission("audit.export"),
  async (req, res, next) => {
    try {
      const { logs } = await loadAuditRows(req, { exportMode: true });
      const csv = rowsToCsv(
        [
          { key: "created_at", label: "Created At" },
          { key: "workspace_code", label: "Workspace" },
          { key: "branch_code", label: "Branch" },
          { key: "username", label: "Username" },
          { key: "role", label: "Role" },
          { key: "action", label: "Action" },
          { key: "action_type", label: "Action Type" },
          { key: "entity_type", label: "Entity Type" },
          { key: "entity_id", label: "Entity ID" },
          { key: "outcome", label: "Outcome" },
          { key: "severity", label: "Severity" },
          { key: "request_id", label: "Request ID" },
          { key: "details", label: "Details" },
        ],
        logs
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="chalin03-audit-trail-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(csv);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/",
  requireAnyPermission("audit.view", "spare_parts.audit"),
  async (req, res, next) => {
    try {
      const result = await loadAuditRows(req);

      return res.json({
        status: "success",
        ...result,
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.__private = {
  buildAuditFilters,
  loadUserScope,
};

module.exports = router;
