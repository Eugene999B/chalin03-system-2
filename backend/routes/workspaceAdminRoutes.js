const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

const MANAGED_WORKSPACES = new Set(["mining", "equipment_hire"]);
const ASSIGNABLE_ROLES = new Set(["manager", "auditor"]);
const LOCATION_TYPES = new Set([
  "office",
  "yard",
  "depot",
  "workshop",
  "parking",
  "other",
]);

function cleanText(value, maxLength = 255) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  const cleaned = cleanText(value, maxLength);
  return cleaned || null;
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
    `SELECT id, code, name, description, is_enabled
     FROM business_units
     WHERE code = ? AND is_enabled = TRUE
     LIMIT 1`,
    [code]
  );

  return rows[0] || null;
}

async function getActiveWorkspace(req, res) {
  const code = activeWorkspaceCode(req);

  if (!MANAGED_WORKSPACES.has(code)) {
    res.status(403).json({
      status: "error",
      message:
        "Workspace administration is available only inside Mining Operations or Equipment Hire.",
    });
    return null;
  }

  const workspace = await getBusinessUnit(code);

  if (!workspace) {
    res.status(503).json({
      status: "error",
      message: "The active business workspace is not enabled in the database.",
    });
    return null;
  }

  return workspace;
}

async function logActivity(req, action, details) {
  try {
    await pool.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (NULL, ?, ?, ?)`,
      [req.user?.id || null, action, details]
    );
  } catch (error) {
    console.warn("Workspace administration activity log skipped:", error.message);
  }
}

async function loadWorkspaceUsers(workspaceId) {
  const [users] = await pool.query(
    `SELECT
       u.id,
       u.full_name,
       u.username,
       u.role,
       u.phone,
       u.is_active,
       uba.id AS access_id,
       uba.access_role,
       uba.can_access,
       uba.is_default,
       uba.updated_at AS access_updated_at
     FROM users u
     LEFT JOIN user_business_access uba
       ON uba.user_id = u.id
      AND uba.business_unit_id = ?
     ORDER BY
       FIELD(u.role, 'admin', 'manager', 'auditor', 'cashier'),
       u.full_name,
       u.username`,
    [workspaceId]
  );

  return users.map((user) => {
    const role = cleanText(user.role, 50).toLowerCase();
    const automaticAccess = role === "admin";
    const assignable = ASSIGNABLE_ROLES.has(role);

    return {
      ...user,
      automatic_access: automaticAccess,
      assignable,
      effective_access: automaticAccess || booleanValue(user.can_access),
      access_reason: automaticAccess
        ? "Group administrators have automatic access."
        : assignable
        ? "Access is controlled by the workspace administrator."
        : "This account role is not supported in operational Mining or Hire workspaces.",
    };
  });
}

async function loadHireLocations(workspaceId) {
  const [locations] = await pool.query(
    `SELECT
       id,
       business_unit_id,
       code,
       name,
       location_type,
       address,
       phone,
       is_active,
       created_at,
       updated_at
     FROM business_locations
     WHERE business_unit_id = ?
     ORDER BY is_active DESC, name, code`,
    [workspaceId]
  );

  return locations;
}

async function loadMiningSites() {
  const [sites] = await pool.query(
    `SELECT
       id,
       site_code,
       site_name,
       location,
       material_type,
       production_unit,
       daily_target,
       manager_name,
       manager_phone,
       status,
       is_active,
       created_at,
       updated_at
     FROM mining_sites
     ORDER BY is_active DESC, site_name, site_code`
  );

  return sites;
}

router.use(requireAuth, requireRole("admin"));

// GET /api/workspace-admin/overview
router.get("/overview", async (req, res) => {
  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    const users = await loadWorkspaceUsers(workspace.id);
    const locations =
      workspace.code === "equipment_hire"
        ? await loadHireLocations(workspace.id)
        : [];
    const sites = workspace.code === "mining" ? await loadMiningSites() : [];

    return res.json({
      status: "success",
      workspace,
      users,
      locations,
      sites,
      summary: {
        total_users: users.length,
        assigned_users: users.filter((user) => user.effective_access).length,
        assignable_users: users.filter((user) => user.assignable).length,
        active_locations: locations.filter((location) =>
          booleanValue(location.is_active)
        ).length,
        active_sites: sites.filter(
          (site) => booleanValue(site.is_active) && site.status === "active"
        ).length,
      },
    });
  } catch (error) {
    console.error("Workspace administration overview error:", error);

    if (error?.code === "ER_NO_SUCH_TABLE") {
      return res.status(503).json({
        status: "error",
        message:
          "Workspace administration tables are missing. Run the complete local master schema in chalin03_db.",
      });
    }

    return res.status(500).json({
      status: "error",
      message: "Could not load workspace administration.",
    });
  }
});

// PUT /api/workspace-admin/users/:userId/access
router.put("/users/:userId/access", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    const userId = positiveId(req.params.userId);
    const canAccess = booleanValue(req.body.can_access);

    if (!userId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID.",
      });
    }

    const [users] = await connection.query(
      `SELECT id, full_name, username, role, is_active
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "User account not found.",
      });
    }

    const user = users[0];
    const role = cleanText(user.role, 50).toLowerCase();

    if (role === "admin") {
      return res.status(400).json({
        status: "error",
        message:
          "Administrator accounts have automatic access to every enabled business workspace.",
      });
    }

    if (!ASSIGNABLE_ROLES.has(role)) {
      return res.status(400).json({
        status: "error",
        message:
          "Only manager and auditor accounts can currently be assigned to Mining or Equipment Hire.",
      });
    }

    if (!booleanValue(user.is_active) && canAccess) {
      return res.status(400).json({
        status: "error",
        message: "Activate the user account before granting workspace access.",
      });
    }

    await connection.beginTransaction();

    await connection.query(
      `INSERT INTO user_business_access (
         user_id,
         business_unit_id,
         access_role,
         can_access,
         is_default,
         created_by
       ) VALUES (?, ?, ?, ?, FALSE, ?)
       ON DUPLICATE KEY UPDATE
         access_role = VALUES(access_role),
         can_access = VALUES(can_access),
         is_default = FALSE,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, workspace.id, role, canAccess, req.user.id]
    );

    await connection.commit();

    await logActivity(
      req,
      canAccess ? "GRANT_WORKSPACE_ACCESS" : "REVOKE_WORKSPACE_ACCESS",
      `${canAccess ? "Granted" : "Revoked"} ${workspace.name} access for ${
        user.full_name || user.username
      } (${user.username})`
    );

    return res.json({
      status: "success",
      message: canAccess
        ? `${workspace.name} access granted successfully.`
        : `${workspace.name} access revoked successfully.`,
      user_id: userId,
      workspace_code: workspace.code,
      can_access: canAccess,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failures after a connection error.
    }

    console.error("Update workspace access error:", error);

    return res.status(500).json({
      status: "error",
      message: "Could not update workspace access.",
    });
  } finally {
    connection.release();
  }
});

// POST /api/workspace-admin/locations
router.post("/locations", async (req, res) => {
  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    if (workspace.code !== "equipment_hire") {
      return res.status(400).json({
        status: "error",
        message:
          "Business locations on this page are reserved for Equipment Hire bases, yards and workshops.",
      });
    }

    const code = cleanText(req.body.code, 50)
      .toUpperCase()
      .replace(/\s+/g, "-");
    const name = cleanText(req.body.name, 150);
    const locationType = cleanText(req.body.location_type, 50).toLowerCase();

    if (!code || !name) {
      return res.status(400).json({
        status: "error",
        message: "Location code and name are required.",
      });
    }

    if (!/^[A-Z0-9_-]+$/.test(code)) {
      return res.status(400).json({
        status: "error",
        message:
          "Location code may contain only letters, numbers, hyphens and underscores.",
      });
    }

    if (!LOCATION_TYPES.has(locationType)) {
      return res.status(400).json({
        status: "error",
        message: "Choose a valid Equipment Hire location type.",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO business_locations (
         business_unit_id,
         code,
         name,
         location_type,
         address,
         phone,
         is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        workspace.id,
        code,
        name,
        locationType,
        nullableText(req.body.address, 255),
        nullableText(req.body.phone, 50),
        req.body.is_active === undefined
          ? true
          : booleanValue(req.body.is_active),
      ]
    );

    await logActivity(
      req,
      "CREATE_HIRE_LOCATION",
      `Created Equipment Hire ${locationType} ${code} — ${name}`
    );

    const [locations] = await pool.query(
      `SELECT * FROM business_locations WHERE id = ? LIMIT 1`,
      [result.insertId]
    );

    return res.status(201).json({
      status: "success",
      message: "Equipment Hire location created successfully.",
      location: locations[0],
    });
  } catch (error) {
    console.error("Create Equipment Hire location error:", error);

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        status: "error",
        message: "An Equipment Hire location with this code already exists.",
      });
    }

    return res.status(500).json({
      status: "error",
      message: "Could not create Equipment Hire location.",
    });
  }
});

// PUT /api/workspace-admin/locations/:locationId
router.put("/locations/:locationId", async (req, res) => {
  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    if (workspace.code !== "equipment_hire") {
      return res.status(400).json({
        status: "error",
        message:
          "Business locations on this page are reserved for Equipment Hire bases, yards and workshops.",
      });
    }

    const locationId = positiveId(req.params.locationId);
    const code = cleanText(req.body.code, 50)
      .toUpperCase()
      .replace(/\s+/g, "-");
    const name = cleanText(req.body.name, 150);
    const locationType = cleanText(req.body.location_type, 50).toLowerCase();

    if (!locationId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid location ID.",
      });
    }

    if (!code || !name) {
      return res.status(400).json({
        status: "error",
        message: "Location code and name are required.",
      });
    }

    if (!/^[A-Z0-9_-]+$/.test(code)) {
      return res.status(400).json({
        status: "error",
        message:
          "Location code may contain only letters, numbers, hyphens and underscores.",
      });
    }

    if (!LOCATION_TYPES.has(locationType)) {
      return res.status(400).json({
        status: "error",
        message: "Choose a valid Equipment Hire location type.",
      });
    }

    const [existing] = await pool.query(
      `SELECT id
       FROM business_locations
       WHERE id = ? AND business_unit_id = ?
       LIMIT 1`,
      [locationId, workspace.id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Equipment Hire location not found.",
      });
    }

    await pool.query(
      `UPDATE business_locations
       SET code = ?,
           name = ?,
           location_type = ?,
           address = ?,
           phone = ?,
           is_active = ?
       WHERE id = ? AND business_unit_id = ?`,
      [
        code,
        name,
        locationType,
        nullableText(req.body.address, 255),
        nullableText(req.body.phone, 50),
        booleanValue(req.body.is_active),
        locationId,
        workspace.id,
      ]
    );

    await logActivity(
      req,
      "UPDATE_HIRE_LOCATION",
      `Updated Equipment Hire ${locationType} ${code} — ${name}`
    );

    const [locations] = await pool.query(
      `SELECT * FROM business_locations WHERE id = ? LIMIT 1`,
      [locationId]
    );

    return res.json({
      status: "success",
      message: "Equipment Hire location updated successfully.",
      location: locations[0],
    });
  } catch (error) {
    console.error("Update Equipment Hire location error:", error);

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        status: "error",
        message: "An Equipment Hire location with this code already exists.",
      });
    }

    return res.status(500).json({
      status: "error",
      message: "Could not update Equipment Hire location.",
    });
  }
});

async function loadContextAccessOverview(workspace, users) {
  if (workspace.code === "mining") {
    const [contexts] = await pool.query(
      `SELECT
         id,
         site_code AS code,
         site_name AS name,
         location,
         status,
         is_active
       FROM mining_sites
       ORDER BY is_active DESC, site_name, site_code`
    );

    const [assignments] = await pool.query(
      `SELECT
         id,
         user_id,
         site_id AS context_id,
         can_access,
         is_default,
         created_by,
         created_at,
         updated_at
       FROM user_mining_site_access`
    );

    return {
      context_type: "mining_site",
      contexts,
      assignments,
      users,
    };
  }

  const [contexts] = await pool.query(
    `SELECT
       id,
       code,
       name,
       address AS location,
       location_type,
       is_active
     FROM business_locations
     WHERE business_unit_id = ?
     ORDER BY is_active DESC, name, code`,
    [workspace.id]
  );

  const [assignments] = await pool.query(
    `SELECT
       id,
       user_id,
       location_id AS context_id,
       can_access,
       is_default,
       created_by,
       created_at,
       updated_at
     FROM user_hire_location_access`
  );

  return {
    context_type: "hire_location",
    contexts,
    assignments,
    users,
  };
}

function contextAccessDefinition(workspace) {
  if (workspace.code === "mining") {
    return {
      table: "user_mining_site_access",
      foreignKey: "site_id",
      contextName: "Mining site",
    };
  }

  return {
    table: "user_hire_location_access",
    foreignKey: "location_id",
    contextName: "Equipment Hire location",
  };
}

async function contextBelongsToWorkspace(workspace, contextId) {
  if (workspace.code === "mining") {
    const [rows] = await pool.query(
      `SELECT id
       FROM mining_sites
       WHERE id = ?
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
     LIMIT 1`,
    [contextId, workspace.id]
  );

  return rows.length > 0;
}

// GET /api/workspace-admin/context-access
router.get("/context-access", async (req, res) => {
  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    const users = await loadWorkspaceUsers(workspace.id);
    const overview = await loadContextAccessOverview(workspace, users);

    return res.json({
      status: "success",
      workspace,
      ...overview,
    });
  } catch (error) {
    console.error("Workspace context-access overview error:", error);

    if (error?.code === "ER_NO_SUCH_TABLE") {
      return res.status(503).json({
        status: "error",
        message:
          "Site/location assignment tables are missing. Run the Part 4A migration in chalin03_db.",
      });
    }

    return res.status(500).json({
      status: "error",
      message: "Could not load site or location staff assignments.",
    });
  }
});

// PUT /api/workspace-admin/users/:userId/contexts/:contextId
router.put("/users/:userId/contexts/:contextId", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    const userId = positiveId(req.params.userId);
    const contextId = positiveId(req.params.contextId);
    const canAccess = booleanValue(req.body.can_access);
    const isDefault = canAccess && booleanValue(req.body.is_default);

    if (!userId || !contextId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user, site or location ID.",
      });
    }

    const [users] = await connection.query(
      `SELECT id, full_name, username, role, is_active
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "User account not found.",
      });
    }

    const user = users[0];
    const role = cleanText(user.role, 50).toLowerCase();

    if (!ASSIGNABLE_ROLES.has(role)) {
      return res.status(400).json({
        status: "error",
        message:
          "Only manager and auditor accounts can receive specific Mining-site or Hire-location assignments.",
      });
    }

    if (!booleanValue(user.is_active) && canAccess) {
      return res.status(400).json({
        status: "error",
        message: "Activate the account before assigning a site or location.",
      });
    }

    const [businessAccessRows] = await connection.query(
      `SELECT can_access
       FROM user_business_access
       WHERE user_id = ?
         AND business_unit_id = ?
       LIMIT 1`,
      [userId, workspace.id]
    );

    if (
      canAccess &&
      (businessAccessRows.length === 0 ||
        !booleanValue(businessAccessRows[0].can_access))
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "Grant workspace access to this account before assigning a site or location.",
      });
    }

    if (!(await contextBelongsToWorkspace(workspace, contextId))) {
      return res.status(404).json({
        status: "error",
        message:
          workspace.code === "mining"
            ? "Mining site not found."
            : "Equipment Hire location not found.",
      });
    }

    const definition = contextAccessDefinition(workspace);

    await connection.beginTransaction();

    if (isDefault) {
      await connection.query(
        `UPDATE \`${definition.table}\`
         SET is_default = FALSE
         WHERE user_id = ?`,
        [userId]
      );
    }

    await connection.query(
      `INSERT INTO \`${definition.table}\` (
         user_id,
         \`${definition.foreignKey}\`,
         can_access,
         is_default,
         created_by
       ) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         can_access = VALUES(can_access),
         is_default = VALUES(is_default),
         created_by = VALUES(created_by),
         updated_at = CURRENT_TIMESTAMP`,
      [userId, contextId, canAccess, isDefault, req.user.id]
    );

    await connection.commit();

    await logActivity(
      req,
      canAccess ? "GRANT_WORKSPACE_CONTEXT_ACCESS" : "REVOKE_WORKSPACE_CONTEXT_ACCESS",
      `${canAccess ? "Granted" : "Revoked"} ${definition.contextName} ${contextId} access for ${
        user.full_name || user.username
      } (${user.username})${isDefault ? " and made it the default" : ""}`
    );

    return res.json({
      status: "success",
      message: canAccess
        ? `${definition.contextName} access assigned successfully.`
        : `${definition.contextName} access revoked successfully.`,
      user_id: userId,
      context_id: contextId,
      can_access: canAccess,
      is_default: isDefault,
      context_type:
        workspace.code === "mining" ? "mining_site" : "hire_location",
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failures after a connection error.
    }

    console.error("Update workspace context access error:", error);

    if (error?.code === "ER_NO_SUCH_TABLE") {
      return res.status(503).json({
        status: "error",
        message:
          "Site/location assignment tables are missing. Run the Part 4A migration in chalin03_db.",
      });
    }

    return res.status(500).json({
      status: "error",
      message: "Could not update site or location access.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
