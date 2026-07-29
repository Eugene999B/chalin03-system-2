const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const equipmentDivisionAdminRoutes = require("./equipmentDivisionAdminRoutes");

const router = express.Router();

const MANAGED_WORKSPACES = new Set(["mining", "equipment_hire"]);

function cleanText(value, maxLength = 100) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function booleanValue(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function activeWorkspaceCode(req) {
  return cleanText(req.user?.workspace_code, 50).toLowerCase();
}

async function getBusinessUnit(code) {
  const [rows] = await pool.query(
    `SELECT id, code, name, is_enabled
     FROM business_units
     WHERE code = ? AND is_enabled = TRUE
     LIMIT 1`,
    [code]
  );

  return rows[0] || null;
}

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS table_count
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND TABLE_TYPE = 'BASE TABLE'`,
    [tableName]
  );

  return Number(rows[0]?.table_count || 0) > 0;
}

async function getWorkspaceDefinition(req, res) {
  const code = activeWorkspaceCode(req);

  if (!MANAGED_WORKSPACES.has(code)) {
    res.status(403).json({
      status: "error",
      message:
        "Site and location selection is available only inside Mining Operations or Equipment Business.",
    });
    return null;
  }

  const businessUnit = await getBusinessUnit(code);

  if (!businessUnit) {
    res.status(503).json({
      status: "error",
      message: "The active business workspace is not enabled.",
    });
    return null;
  }

  if (code === "mining") {
    return {
      code,
      businessUnit,
      contextType: "mining_site",
      accessTable: "user_mining_site_access",
      foreignKey: "site_id",
      requiredTable: "mining_sites",
    };
  }

  return {
    code,
    businessUnit,
    contextType: "hire_location",
    accessTable: "user_hire_location_access",
    foreignKey: "location_id",
    requiredTable: "business_locations",
  };
}

async function ensureContextTables(definition, res) {
  const requiredTables = [definition.requiredTable, definition.accessTable];

  for (const tableName of requiredTables) {
    if (!(await tableExists(tableName))) {
      res.status(503).json({
        status: "error",
        message:
          "Workspace location-access tables are missing. Run the Part 4A local migration in chalin03_db.",
        missing_table: tableName,
      });
      return false;
    }
  }

  return true;
}

async function loadMiningOptions(userId, isAdmin) {
  const joinType = isAdmin ? "LEFT JOIN" : "INNER JOIN";
  const accessFilter = isAdmin ? "" : "AND access.can_access = TRUE";

  const [rows] = await pool.query(
    `SELECT
       site.id,
       site.site_code AS code,
       site.site_name AS name,
       site.location,
       'mining_site' AS context_type,
       site.status,
       site.is_active,
       COALESCE(access.can_access, ?) AS can_access,
       COALESCE(access.is_default, FALSE) AS is_default
     FROM mining_sites site
     ${joinType} user_mining_site_access access
       ON access.site_id = site.id
      AND access.user_id = ?
      ${accessFilter}
     WHERE site.is_active = TRUE
       AND site.status = 'active'
     ORDER BY
       COALESCE(access.is_default, FALSE) DESC,
       site.site_name,
       site.site_code`,
    [isAdmin ? 1 : 0, userId]
  );

  return rows;
}

async function loadHireOptions(userId, businessUnitId, isAdmin) {
  const joinType = isAdmin ? "LEFT JOIN" : "INNER JOIN";
  const accessFilter = isAdmin ? "" : "AND access.can_access = TRUE";

  const [rows] = await pool.query(
    `SELECT
       location.id,
       location.code,
       location.name,
       location.address AS location,
       location.location_type,
       'hire_location' AS context_type,
       location.is_active,
       COALESCE(access.can_access, ?) AS can_access,
       COALESCE(access.is_default, FALSE) AS is_default
     FROM business_locations location
     ${joinType} user_hire_location_access access
       ON access.location_id = location.id
      AND access.user_id = ?
      ${accessFilter}
     WHERE location.business_unit_id = ?
       AND location.is_active = TRUE
     ORDER BY
       COALESCE(access.is_default, FALSE) DESC,
       location.name,
       location.code`,
    [isAdmin ? 1 : 0, userId, businessUnitId]
  );

  return rows;
}

async function loadOptions(definition, user) {
  const isAdmin = cleanText(user?.role, 50).toLowerCase() === "admin";

  if (definition.code === "mining") {
    return loadMiningOptions(user.id, isAdmin);
  }

  return loadHireOptions(user.id, definition.businessUnit.id, isAdmin);
}

async function contextIsActive(definition, contextId) {
  if (definition.code === "mining") {
    const [rows] = await pool.query(
      `SELECT id
       FROM mining_sites
       WHERE id = ?
         AND is_active = TRUE
         AND status = 'active'
       LIMIT 1`,
      [contextId]
    );

    return rows.length > 0;
  }

  const [rows] = await pool.query(
    `SELECT id
     FROM business_locations
     WHERE id = ?
       AND business_unit_id = ?
       AND is_active = TRUE
     LIMIT 1`,
    [contextId, definition.businessUnit.id]
  );

  return rows.length > 0;
}

async function userCanAccessContext(definition, user, contextId) {
  const isAdmin = cleanText(user?.role, 50).toLowerCase() === "admin";

  if (isAdmin) {
    return contextIsActive(definition, contextId);
  }

  const [rows] = await pool.query(
    `SELECT id
     FROM \`${definition.accessTable}\`
     WHERE user_id = ?
       AND \`${definition.foreignKey}\` = ?
       AND can_access = TRUE
     LIMIT 1`,
    [user.id, contextId]
  );

  return rows.length > 0 && (await contextIsActive(definition, contextId));
}

async function logActivity(req, action, details) {
  try {
    await pool.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (NULL, ?, ?, ?)`,
      [req.user?.id || null, action, details]
    );
  } catch (error) {
    console.warn("Workspace context activity log skipped:", error.message);
  }
}

router.use(requireAuth);
router.use("/equipment-divisions", equipmentDivisionAdminRoutes);

// GET /api/workspace-context/options
router.get("/options", async (req, res) => {
  try {
    const definition = await getWorkspaceDefinition(req, res);
    if (!definition) return;

    if (!(await ensureContextTables(definition, res))) return;

    const options = await loadOptions(definition, req.user);
    const defaultOption =
      options.find((option) => booleanValue(option.is_default)) ||
      (options.length === 1 ? options[0] : null);

    return res.json({
      status: "success",
      workspace: {
        id: definition.businessUnit.id,
        code: definition.businessUnit.code,
        name: definition.businessUnit.name,
      },
      context_type: definition.contextType,
      options,
      default_context_id: defaultOption?.id || null,
      requires_selection: options.length > 1 && !defaultOption,
      automatic_access:
        cleanText(req.user?.role, 50).toLowerCase() === "admin",
      message:
        options.length === 0
          ? definition.code === "mining"
            ? "No active Mining site is available for this account."
            : "No active Equipment location is available for this account."
          : "Workspace locations loaded successfully.",
    });
  } catch (error) {
    console.error("Workspace context options error:", error);

    return res.status(500).json({
      status: "error",
      message: "Could not load the workspace site or location list.",
    });
  }
});

// PUT /api/workspace-context/default/:contextId
router.put("/default/:contextId", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const definition = await getWorkspaceDefinition(req, res);
    if (!definition) return;

    if (!(await ensureContextTables(definition, res))) return;

    const contextId = positiveId(req.params.contextId);

    if (!contextId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid site or location ID.",
      });
    }

    if (!(await userCanAccessContext(definition, req.user, contextId))) {
      return res.status(403).json({
        status: "error",
        message:
          "You cannot select this site or location because it is not assigned to your account.",
      });
    }

    await connection.beginTransaction();

    await connection.query(
      `UPDATE \`${definition.accessTable}\`
       SET is_default = FALSE
       WHERE user_id = ?`,
      [req.user.id]
    );

    await connection.query(
      `INSERT INTO \`${definition.accessTable}\` (
         user_id,
         \`${definition.foreignKey}\`,
         can_access,
         is_default,
         created_by
       ) VALUES (?, ?, TRUE, TRUE, ?)
       ON DUPLICATE KEY UPDATE
         can_access = TRUE,
         is_default = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, contextId, req.user.id]
    );

    await connection.commit();

    await logActivity(
      req,
      "SET_WORKSPACE_DEFAULT_CONTEXT",
      `Set ${definition.contextType} ${contextId} as the default context for ${req.user.username}`
    );

    return res.json({
      status: "success",
      message:
        definition.code === "mining"
          ? "Default Mining site updated successfully."
          : "Default Equipment location updated successfully.",
      context_id: contextId,
      context_type: definition.contextType,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback errors after a connection failure.
    }

    console.error("Set workspace default context error:", error);

    return res.status(500).json({
      status: "error",
      message: "Could not update the default site or location.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
