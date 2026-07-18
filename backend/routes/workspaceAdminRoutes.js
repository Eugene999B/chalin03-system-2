const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { normalizedPhoneForStorage } = require("../services/loginIdentityService");
const {
  resetAccountBySystemAdministrator,
} = require("../services/accountRecoveryService");
const {
  normalizeCategory,
} = require("../services/categoryIsolationService");
const {
  isOriginalSystemAdministrator,
} = require("../security/systemAdminIdentity");

const router = express.Router();

const MANAGED_WORKSPACES = new Set(["mining", "equipment_hire"]);
const GLOBAL_ROLES = new Set(["admin", "manager", "staff", "auditor", "cashier"]);
const ASSIGNABLE_ROLES = new Set(["manager", "staff", "auditor"]);
const WORKSPACE_ROLES = {
  mining: new Set([
    "manager",
    "site_supervisor",
    "equipment_operator",
    "site_clerk",
    "accountant",
    "auditor",
  ]),
  equipment_hire: new Set([
    "manager",
    "hire_officer",
    "dispatcher",
    "fleet_officer",
    "accountant",
    "auditor",
  ]),
};
const WORKSPACE_DEFAULT_ROLE = {
  mining: "site_clerk",
  equipment_hire: "hire_officer",
};
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

function normalizeRole(value) {
  return cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
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

function uniquePositiveIds(values) {
  if (!Array.isArray(values)) return [];

  return [...new Set(values.map((value) => positiveId(value)).filter(Boolean))];
}

function clientError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function strongPasswordError(password) {
  const text = String(password || "");

  if (text.length < 8) return "Password must be at least 8 characters long.";
  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text)) {
    return "Password must include uppercase and lowercase letters.";
  }
  if (!/\d/.test(text)) return "Password must include at least one number.";
  if (!/[^A-Za-z0-9]/.test(text)) {
    return "Password must include at least one symbol.";
  }

  return "";
}

async function columnExists(db, tableName, columnName) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  return rows.length > 0;
}

function activeWorkspaceCode(req) {
  return cleanText(req.user?.workspace_code, 50).toLowerCase();
}

function workspaceRoleSet(workspace) {
  return WORKSPACE_ROLES[workspace.code] || new Set();
}

function defaultWorkspaceRole(workspace, globalRole) {
  const role = normalizeRole(globalRole);
  const roles = workspaceRoleSet(workspace);

  if (roles.has(role)) {
    return role;
  }

  return WORKSPACE_DEFAULT_ROLE[workspace.code] || "manager";
}

function validateGlobalRole(role) {
  const cleanRole = normalizeRole(role);

  if (!GLOBAL_ROLES.has(cleanRole)) {
    throw clientError(
      400,
      "Global account class must be admin, manager, staff, auditor or cashier."
    );
  }

  if (cleanRole === "cashier") {
    throw clientError(
      400,
      "Cashier accounts are Spare Parts-only and cannot be assigned to Mining or Equipment Hire."
    );
  }

  return cleanRole;
}

function validateWorkspaceRole(workspace, requestedRole, globalRole) {
  const role = normalizeRole(requestedRole);
  const roles = workspaceRoleSet(workspace);

  if (!role) {
    return defaultWorkspaceRole(workspace, globalRole);
  }

  if (!roles.has(role)) {
    throw clientError(
      400,
      workspace.code === "mining"
        ? "Choose a valid Mining workspace role."
        : "Choose a valid Equipment Hire workspace role."
    );
  }

  return role;
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
    await writeAuditEvent({
      req,
      action,
      details,
      workspaceCode: req.user?.workspace_code || null,
      entityType: "workspace_access",
      entityId: req.params?.userId || null,
      actionType: action,
      outcome: "success",
      severity:
        action.includes("PASSWORD") ||
        action.includes("STATUS") ||
        action.includes("REVOKE")
          ? "critical"
          : "notice",
    });
  } catch (error) {
    console.warn("Workspace administration activity log skipped:", error.message);
  }
}

async function getUserById(db, userId) {
  const [users] = await db.query(
    `SELECT
       id,
       full_name,
       username,
       role,
       phone,
       default_branch_id,
       can_access_all_branches,
       is_active,
       must_change_password,
       password_changed_at,
       failed_login_attempts,
       is_login_locked,
       login_locked_at,
       login_lock_reason,
       last_failed_login_at,
       last_failed_login_ip,
       created_by,
       created_at,
       updated_at,
       primary_workspace_code,
       category_assignment_status,
       category_conflict_reason
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  return users[0] || null;
}

async function ensureAdminChangeIsSafe(db, req, user, nextRole, nextIsActive) {
  if (
    Number(user.id) === Number(req.user?.id) &&
    (!nextIsActive || normalizeRole(nextRole) !== "admin")
  ) {
    throw clientError(
      400,
      "You cannot deactivate or demote your own current administrator session."
    );
  }

  const currentRole = normalizeRole(user.role);
  const nextCleanRole = normalizeRole(nextRole);

  if (currentRole !== "admin") {
    return;
  }

  if (nextCleanRole === "admin" && nextIsActive) {
    return;
  }

  const [rows] = await db.query(
    `SELECT COUNT(*) AS active_admins
     FROM users
     WHERE role = 'admin'
       AND is_active = TRUE
       AND id <> ?`,
    [user.id]
  );

  if (Number(rows[0]?.active_admins || 0) < 1) {
    throw clientError(400, "At least one active administrator must remain.");
  }
}

async function loadWorkspaceUsers(workspace) {
  const [users] = await pool.query(
    `SELECT
       u.id,
       u.full_name,
       u.username,
       u.role,
       u.phone,
       u.is_active,
       u.must_change_password,
       u.password_changed_at,
       u.failed_login_attempts,
       u.is_login_locked,
       u.login_locked_at,
       u.login_lock_reason,
       u.last_failed_login_at,
       u.last_failed_login_ip,
       u.created_at,
       u.updated_at,
       u.primary_workspace_code,
       u.category_assignment_status,
       u.category_conflict_reason,
       uba.id AS access_id,
       uba.access_role,
       uba.can_access,
       uba.is_default,
       uba.updated_at AS access_updated_at
     FROM users u
     LEFT JOIN user_business_access uba
       ON uba.user_id = u.id
      AND uba.business_unit_id = ?
     WHERE u.primary_workspace_code = ?
        OR (u.id = ? AND u.username = ? AND u.role = 'admin')
     ORDER BY
       FIELD(u.role, 'admin', 'manager', 'staff', 'auditor', 'cashier'),
       u.full_name,
       u.username`,
    [
      workspace.id,
      workspace.code,
      Number(process.env.SYSTEM_ADMIN_USER_ID || 1),
      String(process.env.SYSTEM_ADMIN_USERNAME || "admin").trim(),
    ]
  );

  return users.map((user) => {
    const role = normalizeRole(user.role);
    const automaticAccess = isOriginalSystemAdministrator(user);
    const assignable = ASSIGNABLE_ROLES.has(role);
    const workspaceRole =
      cleanText(user.access_role, 50) ||
      (automaticAccess ? "group_admin" : defaultWorkspaceRole(workspace, role));

    return {
      ...user,
      role,
      workspace_role: workspaceRole,
      automatic_access: automaticAccess,
      assignable,
      effective_access: automaticAccess || booleanValue(user.can_access),
      can_access: automaticAccess ? true : booleanValue(user.can_access),
      must_change_password:
        booleanValue(user.must_change_password),
      failed_login_attempts:
        Number(user.failed_login_attempts || 0),
      is_login_locked:
        booleanValue(user.is_login_locked),
      login_locked_at:
        user.login_locked_at || null,
      login_lock_reason:
        user.login_lock_reason || null,
      last_failed_login_at:
        user.last_failed_login_at || null,
      last_failed_login_ip:
        user.last_failed_login_ip || null,
      access_reason: automaticAccess
        ? "The original System Administrator has protected access across categories."
        : assignable
        ? "Access is controlled by the workspace administrator."
        : "This global account class is not supported in Mining or Hire workspaces.",
    };
  });
}

async function loadEligibleCentralUsers(workspace) {
  const [users] = await pool.query(
    `SELECT
       u.id,
       u.full_name,
       u.username,
       u.role,
       u.phone,
       u.is_active,
       u.must_change_password,
       u.created_at,
       u.updated_at,
       u.primary_workspace_code,
       u.category_assignment_status,
       uba.can_access,
       uba.access_role
     FROM users u
     LEFT JOIN user_business_access uba
       ON uba.user_id = u.id
      AND uba.business_unit_id = ?
     WHERE u.role IN ('manager', 'staff', 'auditor', 'admin')
       AND u.primary_workspace_code = ?
       AND u.category_assignment_status = 'assigned'
       AND (uba.id IS NULL OR uba.can_access = FALSE)
     ORDER BY u.full_name, u.username`,
    [workspace.id, workspace.code]
  );

  return users.map((user) => ({
    ...user,
    role: normalizeRole(user.role),
    workspace_role:
      cleanText(user.access_role, 50) ||
      defaultWorkspaceRole(workspace, user.role),
    can_access: booleanValue(user.can_access),
    must_change_password: booleanValue(user.must_change_password),
  }));
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

async function validateContextSelection(db, workspace, rawContextIds, rawDefaultId) {
  const contextIds = uniquePositiveIds(rawContextIds);
  const defaultContextId = positiveId(rawDefaultId);

  if (defaultContextId && !contextIds.includes(defaultContextId)) {
    throw clientError(
      400,
      workspace.code === "mining"
        ? "The default Mining site must also be assigned."
        : "The default Hire location must also be assigned."
    );
  }

  if (contextIds.length === 0) {
    if (defaultContextId) {
      throw clientError(400, "Choose at least one assignment before setting a default.");
    }

    return { contextIds, defaultContextId: null, contextLabels: new Map() };
  }

  const placeholders = contextIds.map(() => "?").join(", ");
  const contextLabels = new Map();
  let rows = [];

  if (workspace.code === "mining") {
    [rows] = await db.query(
      `SELECT id, site_code AS code, site_name AS name
       FROM mining_sites
       WHERE id IN (${placeholders})
         AND is_active = TRUE
         AND status = 'active'`,
      contextIds
    );
  } else {
    [rows] = await db.query(
      `SELECT id, code, name
       FROM business_locations
       WHERE id IN (${placeholders})
         AND business_unit_id = ?
         AND is_active = TRUE`,
      [...contextIds, workspace.id]
    );
  }

  rows.forEach((row) => {
    contextLabels.set(Number(row.id), `${row.code || row.id} - ${row.name || "Unnamed"}`);
  });

  if (rows.length !== contextIds.length) {
    throw clientError(
      400,
      workspace.code === "mining"
        ? "Only active Mining sites can be assigned."
        : "Only active Equipment Hire locations can be assigned."
    );
  }

  if (defaultContextId && !contextLabels.has(defaultContextId)) {
    throw clientError(
      400,
      workspace.code === "mining"
        ? "The default Mining site must be active."
        : "The default Hire location must be active."
    );
  }

  return { contextIds, defaultContextId, contextLabels };
}

async function loadExistingContextAssignments(db, workspace, userId) {
  if (workspace.code === "mining") {
    const [assignments] = await db.query(
      `SELECT
         uma.site_id AS context_id,
         uma.can_access,
         uma.is_default,
         ms.site_code AS code,
         ms.site_name AS name
       FROM user_mining_site_access uma
       INNER JOIN mining_sites ms ON ms.id = uma.site_id
       WHERE uma.user_id = ?`,
      [userId]
    );

    return assignments;
  }

  const [assignments] = await db.query(
    `SELECT
       uhla.location_id AS context_id,
       uhla.can_access,
       uhla.is_default,
       bl.code,
       bl.name
     FROM user_hire_location_access uhla
     INNER JOIN business_locations bl ON bl.id = uhla.location_id
     WHERE uhla.user_id = ?
       AND bl.business_unit_id = ?`,
    [userId, workspace.id]
  );

  return assignments;
}

async function disableWorkspaceContexts(db, workspace, userId) {
  if (workspace.code === "mining") {
    await db.query(
      `UPDATE user_mining_site_access
       SET can_access = FALSE,
           is_default = FALSE,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [userId]
    );
    return;
  }

  await db.query(
    `UPDATE user_hire_location_access uhla
     INNER JOIN business_locations bl ON bl.id = uhla.location_id
     SET uhla.can_access = FALSE,
         uhla.is_default = FALSE,
         uhla.updated_at = CURRENT_TIMESTAMP
     WHERE uhla.user_id = ?
       AND bl.business_unit_id = ?`,
    [userId, workspace.id]
  );
}

async function syncWorkspaceContexts(
  db,
  workspace,
  userId,
  rawContextIds,
  rawDefaultId,
  actorId
) {
  const { contextIds, defaultContextId, contextLabels } =
    await validateContextSelection(db, workspace, rawContextIds, rawDefaultId);
  const before = await loadExistingContextAssignments(db, workspace, userId);
  const beforeActive = new Set(
    before
      .filter((assignment) => booleanValue(assignment.can_access))
      .map((assignment) => Number(assignment.context_id))
  );
  const beforeDefault =
    before.find(
      (assignment) =>
        booleanValue(assignment.can_access) && booleanValue(assignment.is_default)
    )?.context_id || null;

  await disableWorkspaceContexts(db, workspace, userId);

  if (contextIds.length > 0) {
    const definition = contextAccessDefinition(workspace);

    for (const contextId of contextIds) {
      await db.query(
        `INSERT INTO \`${definition.table}\` (
           user_id,
           \`${definition.foreignKey}\`,
           can_access,
           is_default,
           created_by
         ) VALUES (?, ?, TRUE, ?, ?)
         ON DUPLICATE KEY UPDATE
           can_access = TRUE,
           is_default = VALUES(is_default),
           created_by = VALUES(created_by),
           updated_at = CURRENT_TIMESTAMP`,
        [userId, contextId, Number(contextId) === Number(defaultContextId), actorId]
      );
    }
  }

  const nextActive = new Set(contextIds.map(Number));

  return {
    added: contextIds.filter((contextId) => !beforeActive.has(Number(contextId))),
    removed: [...beforeActive].filter((contextId) => !nextActive.has(Number(contextId))),
    default_changed: Number(beforeDefault || 0) !== Number(defaultContextId || 0),
    default_context_id: defaultContextId,
    contextLabels,
  };
}

async function upsertWorkspaceAccess(
  db,
  workspace,
  userId,
  workspaceRole,
  canAccess,
  actorId
) {
  await db.query(
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
       updated_at = CURRENT_TIMESTAMP`,
    [userId, workspace.id, workspaceRole, canAccess, actorId]
  );
}

async function contextBelongsToWorkspace(workspace, contextId, requireActive = false) {
  if (workspace.code === "mining") {
    const activeSql = requireActive
      ? "AND is_active = TRUE AND status = 'active'"
      : "";
    const [rows] = await pool.query(
      `SELECT id
       FROM mining_sites
       WHERE id = ?
       ${activeSql}
       LIMIT 1`,
      [contextId]
    );

    return rows.length > 0;
  }

  const activeSql = requireActive ? "AND is_active = TRUE" : "";
  const [rows] = await pool.query(
    `SELECT id
     FROM business_locations
     WHERE id = ?
       AND business_unit_id = ?
       ${activeSql}
     LIMIT 1`,
    [contextId, workspace.id]
  );

  return rows.length > 0;
}

function sendRouteError(res, error, fallbackMessage) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      status: "error",
      message: error.message,
    });
  }

  if (error?.code === "ER_DUP_ENTRY") {
    const duplicatePhone = String(error.message || "").includes(
      "uq_users_login_phone_normalized"
    );

    return res.status(409).json({
      status: "error",
      message: duplicatePhone
        ? "This phone number is already attached to another login account."
        : "This username already exists.",
    });
  }

  if (error?.code === "ER_NO_SUCH_TABLE" || error?.code === "ER_BAD_FIELD_ERROR") {
    return res.status(503).json({
      status: "error",
      message:
        "Stage 6A account administration columns are missing. Run the safe Stage 6A migration.",
    });
  }

  return res.status(500).json({
    status: "error",
    message: fallbackMessage,
  });
}

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
       uhla.id,
       uhla.user_id,
       uhla.location_id AS context_id,
       uhla.can_access,
       uhla.is_default,
       uhla.created_by,
       uhla.created_at,
       uhla.updated_at
     FROM user_hire_location_access uhla
     INNER JOIN business_locations bl ON bl.id = uhla.location_id
     WHERE bl.business_unit_id = ?`,
    [workspace.id]
  );

  return {
    context_type: "hire_location",
    contexts,
    assignments,
    users,
  };
}

router.use(requireAuth, requireRole("admin"));

// GET /api/workspace-admin/overview
router.get("/overview", async (req, res) => {
  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    const users = await loadWorkspaceUsers(workspace);
    const eligibleUsers = await loadEligibleCentralUsers(workspace);
    const locations =
      workspace.code === "equipment_hire"
        ? await loadHireLocations(workspace.id)
        : [];
    const sites = workspace.code === "mining" ? await loadMiningSites() : [];

    return res.json({
      status: "success",
      workspace,
      users,
      eligible_users: eligibleUsers,
      workspace_roles: [...workspaceRoleSet(workspace)],
      global_roles: ["admin", "manager", "staff", "auditor"],
      locations,
      sites,
      summary: {
        total_users: users.length,
        assigned_users: users.filter((user) => user.effective_access).length,
        assignable_users: users.filter((user) => user.assignable).length,
        eligible_users: eligibleUsers.length,
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
    return sendRouteError(res, error, "Could not load workspace administration.");
  }
});

// POST /api/workspace-admin/staff
router.post("/staff", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    const fullName = cleanText(req.body.full_name, 150);
    const username = cleanText(req.body.username, 80);
    const phone = nullableText(req.body.phone, 30);
    const normalizedLoginPhone = normalizedPhoneForStorage(phone);
    const temporaryPassword = String(req.body.temporary_password || "");
    const globalRole = validateGlobalRole(req.body.global_role || req.body.role || "staff");
    const workspaceRole = validateWorkspaceRole(
      workspace,
      req.body.workspace_role,
      globalRole
    );
    const isActive =
      req.body.is_active === undefined ? true : booleanValue(req.body.is_active);
    const mustChangePassword =
      req.body.force_password_change === undefined
        ? true
        : booleanValue(req.body.force_password_change);

    if (phone && !normalizedLoginPhone) {
      throw clientError(
        400,
        "Enter a valid Ghana phone number such as 0241234567 or +233241234567."
      );
    }

    if (!fullName || !username || !temporaryPassword) {
      throw clientError(400, "Full name, username and temporary password are required.");
    }

    const temporaryPasswordPolicyError = strongPasswordError(temporaryPassword);

    if (temporaryPasswordPolicyError) {
      throw clientError(400, temporaryPasswordPolicyError);
    }

    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const passwordChangedAt = mustChangePassword ? null : new Date();

    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO users (
         full_name,
         username,
         password_hash,
         role,
         phone,
         default_branch_id,
         can_access_all_branches,
         is_active,
         must_change_password,
         password_changed_at,
         primary_workspace_code,
         category_assignment_status,
         category_assignment_reviewed_at,
         category_assignment_reviewed_by,
         created_by
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'assigned', NOW(), ?, ?)`,
      [
        fullName,
        username,
        passwordHash,
        globalRole,
        phone,
        globalRole === "admin",
        isActive,
        mustChangePassword,
        passwordChangedAt,
        workspace.code,
        req.user.id,
        req.user.id,
      ]
    );

    await upsertWorkspaceAccess(
      connection,
      workspace,
      result.insertId,
      workspaceRole,
      true,
      req.user.id
    );

    const contextChanges = await syncWorkspaceContexts(
      connection,
      workspace,
      result.insertId,
      req.body.context_ids,
      req.body.default_context_id,
      req.user.id
    );

    await connection.commit();

    await logActivity(
      req,
      "CREATE_WORKSPACE_STAFF_USER",
      `Created ${workspace.name} account ${username} as ${globalRole}/${workspaceRole}`
    );

    if (contextChanges.added.length > 0) {
      await logActivity(
        req,
        "ASSIGN_WORKSPACE_CONTEXT_ACCESS",
        `Assigned ${workspace.name} contexts ${contextChanges.added.join(", ")} to ${username}`
      );
    }

    const createdUser = await getUserById(pool, result.insertId);

    return res.status(201).json({
      status: "success",
      message: `${workspace.name} staff account created successfully.`,
      user: {
        id: createdUser.id,
        full_name: createdUser.full_name,
        username: createdUser.username,
        role: createdUser.role,
        phone: createdUser.phone,
        is_active: booleanValue(createdUser.is_active),
        must_change_password: booleanValue(createdUser.must_change_password),
      },
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failures after a connection error.
    }

    console.error("Create workspace staff user error:", error);
    return sendRouteError(res, error, "Could not create workspace staff account.");
  } finally {
    connection.release();
  }
});

// POST /api/workspace-admin/staff/existing
router.post("/staff/existing", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    const userId = positiveId(req.body.user_id || req.body.existing_user_id);

    if (!userId) {
      throw clientError(400, "Choose an existing central user.");
    }

    const user = await getUserById(connection, userId);

    if (!user) {
      throw clientError(404, "User account not found.");
    }

    if (isOriginalSystemAdministrator(user)) {
      throw clientError(
        400,
        "The original System Administrator already has protected access across categories."
      );
    }

    if (user.category_assignment_status === "conflict_review") {
      throw clientError(
        409,
        "Resolve this user's category conflict in User Permission Manager first."
      );
    }

    if (normalizeCategory(user.primary_workspace_code) !== workspace.code) {
      throw clientError(
        409,
        `This user belongs to ${user.primary_workspace_code || "another category"} and cannot be added to ${workspace.name}.`
      );
    }

    const globalRole = validateGlobalRole(user.role);
    const workspaceRole = validateWorkspaceRole(
      workspace,
      req.body.workspace_role,
      globalRole
    );

    await connection.beginTransaction();

    await upsertWorkspaceAccess(
      connection,
      workspace,
      user.id,
      workspaceRole,
      true,
      req.user.id
    );

    const contextChanges = await syncWorkspaceContexts(
      connection,
      workspace,
      user.id,
      req.body.context_ids,
      req.body.default_context_id,
      req.user.id
    );

    await connection.commit();

    await logActivity(
      req,
      "GRANT_WORKSPACE_ACCESS",
      `Granted ${workspace.name} access to existing user ${user.username} as ${workspaceRole}`
    );

    if (contextChanges.added.length > 0) {
      await logActivity(
        req,
        "ASSIGN_WORKSPACE_CONTEXT_ACCESS",
        `Assigned ${workspace.name} contexts ${contextChanges.added.join(", ")} to ${user.username}`
      );
    }

    return res.status(201).json({
      status: "success",
      message: `${user.full_name || user.username} added to ${workspace.name}.`,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failures after a connection error.
    }

    console.error("Add existing workspace staff user error:", error);
    return sendRouteError(res, error, "Could not add existing user to workspace.");
  } finally {
    connection.release();
  }
});

// PUT /api/workspace-admin/staff/:userId
router.put("/staff/:userId", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    const userId = positiveId(req.params.userId);

    if (!userId) {
      throw clientError(400, "Invalid user ID.");
    }

    const user = await getUserById(connection, userId);

    if (!user) {
      throw clientError(404, "User account not found.");
    }

    if (
      !isOriginalSystemAdministrator(user) &&
      normalizeCategory(user.primary_workspace_code) !== workspace.code
    ) {
      throw clientError(409, "This worker belongs to a different independent business category.");
    }

    const fullName = cleanText(req.body.full_name || user.full_name, 150);
    const username = cleanText(req.body.username || user.username, 80);
    const phone =
      req.body.phone === undefined ? user.phone || null : nullableText(req.body.phone, 30);
    const normalizedLoginPhone = normalizedPhoneForStorage(phone);
    const globalRole = validateGlobalRole(
      req.body.global_role || req.body.role || user.role
    );
    const workspaceRole = validateWorkspaceRole(
      workspace,
      req.body.workspace_role,
      globalRole
    );
    const isActive =
      req.body.is_active === undefined ? booleanValue(user.is_active) : booleanValue(req.body.is_active);
    const canAccess =
      req.body.can_access === undefined ? true : booleanValue(req.body.can_access);
    const mustChangePassword =
      req.body.must_change_password === undefined
        ? booleanValue(user.must_change_password)
        : booleanValue(req.body.must_change_password);

    if (phone && !normalizedLoginPhone) {
      throw clientError(
        400,
        "Enter a valid Ghana phone number such as 0241234567 or +233241234567."
      );
    }

    if (!fullName || !username) {
      throw clientError(400, "Full name and username are required.");
    }

    await ensureAdminChangeIsSafe(connection, req, user, globalRole, isActive);

    await connection.beginTransaction();

    await connection.query(
      `UPDATE users
       SET full_name = ?,
           username = ?,
           role = ?,
           phone = ?,
           is_active = ?,
           must_change_password = ?
       WHERE id = ?`,
      [
        fullName,
        username,
        globalRole,
        phone,
        isActive,
        mustChangePassword,
        user.id,
      ]
    );

    await upsertWorkspaceAccess(
      connection,
      workspace,
      user.id,
      workspaceRole,
      canAccess,
      req.user.id
    );

    let contextChanges = {
      added: [],
      removed: [],
      default_changed: false,
      default_context_id: null,
    };

    if (canAccess) {
      contextChanges = await syncWorkspaceContexts(
        connection,
        workspace,
        user.id,
        req.body.context_ids,
        req.body.default_context_id,
        req.user.id
      );
    } else {
      await disableWorkspaceContexts(connection, workspace, user.id);
    }

    await connection.commit();

    await logActivity(
      req,
      "UPDATE_WORKSPACE_STAFF_USER",
      `Updated ${workspace.name} account ${username} as ${globalRole}/${workspaceRole}`
    );

    if (canAccess) {
      if (contextChanges.added.length > 0) {
        await logActivity(
          req,
          "ASSIGN_WORKSPACE_CONTEXT_ACCESS",
          `Assigned ${workspace.name} contexts ${contextChanges.added.join(", ")} to ${username}`
        );
      }

      if (contextChanges.removed.length > 0) {
        await logActivity(
          req,
          "REVOKE_WORKSPACE_CONTEXT_ACCESS",
          `Removed ${workspace.name} contexts ${contextChanges.removed.join(", ")} from ${username}`
        );
      }

      if (contextChanges.default_changed) {
        await logActivity(
          req,
          "SET_DEFAULT_WORKSPACE_CONTEXT",
          `Updated ${workspace.name} default context for ${username} to ${
            contextChanges.default_context_id || "none"
          }`
        );
      }
    }

    return res.json({
      status: "success",
      message: `${workspace.name} staff account updated successfully.`,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failures after a connection error.
    }

    console.error("Update workspace staff user error:", error);
    return sendRouteError(res, error, "Could not update workspace staff account.");
  } finally {
    connection.release();
  }
});

// PATCH /api/workspace-admin/staff/:userId/password
router.patch(
  "/staff/:userId/password",
  async (req, res) => {
    try {
      const userId = positiveId(
        req.params.userId
      );

      const temporaryPassword = String(
        req.body.temporary_password || ""
      );

      if (!userId) {
        throw clientError(
          400,
          "Invalid user ID."
        );
      }

      if (!temporaryPassword) {
        throw clientError(
          400,
          "Temporary password is required."
        );
      }

      const result =
        await resetAccountBySystemAdministrator({
          req,
          targetUserId: userId,
          newPassword: temporaryPassword,
        });

      return res.json({
        status: "success",
        message: result.message,
        must_change_password: true,
      });
    } catch (error) {
      console.error(
        "Reset workspace staff password error:",
        error.code || error.message
      );

      return res
        .status(error.statusCode || 500)
        .json({
          status: "error",
          code:
            error.code ||
            "ACCOUNT_RESET_FAILED",
          message:
            error.statusCode && error.statusCode < 500
              ? error.message
              : "Could not reset the user account.",
        });
    }
  }
);
// PATCH /api/workspace-admin/staff/:userId/status
router.patch("/staff/:userId/status", async (req, res) => {
  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    const userId = positiveId(req.params.userId);

    if (!userId) {
      throw clientError(400, "Invalid user ID.");
    }

    const user = await getUserById(pool, userId);

    if (!user) {
      throw clientError(404, "User account not found.");
    }

    const isActive =
      req.body.is_active === undefined
        ? !booleanValue(user.is_active)
        : booleanValue(req.body.is_active);

    await ensureAdminChangeIsSafe(pool, req, user, user.role, isActive);

    const updateFields = ["is_active = ?"];
    const updateParams = [isActive];

    if (!isActive && (await columnExists(pool, "users", "token_version"))) {
      updateFields.push("token_version = token_version + 1");
    }

    await pool.query(
      `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`,
      [...updateParams, user.id]
    );

    await logActivity(
      req,
      isActive ? "ACTIVATE_WORKSPACE_STAFF_USER" : "DEACTIVATE_WORKSPACE_STAFF_USER",
      `${isActive ? "Activated" : "Deactivated"} ${workspace.name} user ${user.username}`
    );

    return res.json({
      status: "success",
      message: isActive
        ? "User account activated successfully."
        : "User account deactivated successfully.",
      is_active: isActive,
    });
  } catch (error) {
    console.error("Toggle workspace staff status error:", error);
    return sendRouteError(res, error, "Could not update user account status.");
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
      throw clientError(400, "Invalid user ID.");
    }

    const user = await getUserById(connection, userId);

    if (!user) {
      throw clientError(404, "User account not found.");
    }

    const role = normalizeRole(user.role);

    if (isOriginalSystemAdministrator(user)) {
      throw clientError(
        400,
        "The original System Administrator has protected access across categories."
      );
    }

    if (normalizeCategory(user.primary_workspace_code) !== workspace.code) {
      throw clientError(
        409,
        "This user belongs to a different independent business category."
      );
    }

    validateGlobalRole(role);

    const workspaceRole = validateWorkspaceRole(
      workspace,
      req.body.workspace_role || req.body.access_role,
      role
    );

    await connection.beginTransaction();

    await upsertWorkspaceAccess(
      connection,
      workspace,
      user.id,
      workspaceRole,
      canAccess,
      req.user.id
    );

    if (!canAccess) {
      await disableWorkspaceContexts(connection, workspace, user.id);

      if (await columnExists(connection, "users", "token_version")) {
        await connection.query(
          `UPDATE users
           SET token_version = token_version + 1
           WHERE id = ?`,
          [user.id]
        );
      }
    }

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
    return sendRouteError(res, error, "Could not update workspace access.");
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
        req.body.is_active === undefined ? true : booleanValue(req.body.is_active),
      ]
    );

    await logActivity(
      req,
      "CREATE_HIRE_LOCATION",
      `Created Equipment Hire ${locationType} ${code} - ${name}`
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
      `Updated Equipment Hire ${locationType} ${code} - ${name}`
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

// GET /api/workspace-admin/context-access
router.get("/context-access", async (req, res) => {
  try {
    const workspace = await getActiveWorkspace(req, res);
    if (!workspace) return;

    const users = await loadWorkspaceUsers(workspace);
    const overview = await loadContextAccessOverview(workspace, users);

    return res.json({
      status: "success",
      workspace,
      ...overview,
    });
  } catch (error) {
    console.error("Workspace context-access overview error:", error);
    return sendRouteError(
      res,
      error,
      "Could not load site or location staff assignments."
    );
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
      throw clientError(400, "Invalid user, site or location ID.");
    }

    const user = await getUserById(connection, userId);

    if (!user) {
      throw clientError(404, "User account not found.");
    }

    const role = normalizeRole(user.role);

    if (role === "admin") {
      throw clientError(
        400,
        "Administrator accounts already have automatic access to every active site or location."
      );
    }

    validateGlobalRole(role);

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
      throw clientError(
        400,
        "Grant workspace access to this account before assigning a site or location."
      );
    }

    if (!(await contextBelongsToWorkspace(workspace, contextId, canAccess))) {
      throw clientError(
        404,
        workspace.code === "mining"
          ? "Active Mining site not found."
          : "Active Equipment Hire location not found."
      );
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
      context_type: workspace.code === "mining" ? "mining_site" : "hire_location",
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failures after a connection error.
    }

    console.error("Update workspace context access error:", error);
    return sendRouteError(res, error, "Could not update site or location access.");
  } finally {
    connection.release();
  }
});

module.exports = router;
