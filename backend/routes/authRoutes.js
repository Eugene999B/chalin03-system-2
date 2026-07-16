const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { getEffectivePermissions } = require("../security/permissionCatalog");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");
const {
  createSession,
  revokeAllUserSessions,
  revokeSession,
} = require("../services/accountSessionService");
const {
  GENERIC_RECOVERY_REQUEST_MESSAGE,
  recordFailedLoginAttempt,
  recoverAccountWithOtp,
  requestRecoveryOtp,
} = require("../services/accountRecoveryService");

const router = express.Router();

const tableColumnCache = {};

const DEFAULT_WORKSPACE_CODE = "spare_parts";
const WORKSPACE_CODES = new Set([
  "spare_parts",
  "mining",
  "equipment_hire",
]);
const AUTH_FAILURE_MESSAGE = "Invalid username or password.";
const MAX_FAILED_LOGIN_ATTEMPTS = 3;

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function normalizeWorkspaceCode(value) {
  const cleaned = cleanText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!cleaned) {
    return DEFAULT_WORKSPACE_CODE;
  }

  if (cleaned === "hire" || cleaned === "equipment") {
    return "equipment_hire";
  }

  return WORKSPACE_CODES.has(cleaned) ? cleaned : null;
}

function cleanNumber(value, fallback = null) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }

  return number;
}

function safeTableName(tableName) {
  const cleanName = String(tableName || "").trim();

  if (!/^[a-zA-Z0-9_]+$/.test(cleanName)) {
    throw new Error("Invalid table name.");
  }

  return cleanName;
}

async function getTableColumns(tableName) {
  const cleanName = safeTableName(tableName);

  if (tableColumnCache[cleanName]) {
    return tableColumnCache[cleanName];
  }

  try {
    const [columns] = await pool.query(`SHOW COLUMNS FROM \`${cleanName}\``);
    const columnSet = new Set(columns.map((column) => column.Field));
    tableColumnCache[cleanName] = columnSet;
    return columnSet;
  } catch {
    const emptySet = new Set();
    tableColumnCache[cleanName] = emptySet;
    return emptySet;
  }
}

async function tableExists(tableName) {
  const columns = await getTableColumns(tableName);
  return columns.size > 0;
}

function boolValue(value) {
  return value === true || Number(value || 0) === 1;
}

function createToken(user, branch, workspace, sessionId) {
  const branchCode = branch?.branch_code || branch?.code || null;
  const branchName = branch?.name || branch?.branch_name || null;
  const branchLocation = branch?.location || branch?.branch_location || null;

  return jwt.sign(
    {
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      role: user.role,
      workspace_code: workspace?.code || DEFAULT_WORKSPACE_CODE,
      business_unit_id: workspace?.id || null,
      business_unit_name: workspace?.name || "Spare Parts",
      workspace_role:
        user.workspace_role ||
        user.access_role ||
        (workspace?.code === DEFAULT_WORKSPACE_CODE ? user.role : null),
      branch_id: branch?.id || null,
      branch_code: branchCode,
      branch_name: branchName,
      branch_location: branchLocation,
      can_access_all_branches:
        workspace?.code === DEFAULT_WORKSPACE_CODE
          ? boolValue(user.can_access_all_branches)
          : false,
      must_change_password: boolValue(user.must_change_password),
      session_id: sessionId,
      token_version: Number(user.token_version || 0),
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
}

async function buildUserSelectByWhere(whereSql, params) {
  const userColumns = await getTableColumns("users");

  const phoneSql = userColumns.has("phone") ? "phone" : "NULL AS phone";
  const defaultBranchSql = userColumns.has("default_branch_id")
    ? "default_branch_id"
    : "1 AS default_branch_id";
  const allBranchesSql = userColumns.has("can_access_all_branches")
    ? "can_access_all_branches"
    : "0 AS can_access_all_branches";
  const activeSql = userColumns.has("is_active")
    ? "is_active"
    : "1 AS is_active";
  const mustChangePasswordSql = userColumns.has("must_change_password")
    ? "must_change_password"
    : "0 AS must_change_password";
  const passwordChangedAtSql = userColumns.has("password_changed_at")
    ? "password_changed_at"
    : "NULL AS password_changed_at";
  const createdAtSql = userColumns.has("created_at")
    ? "created_at"
    : "NULL AS created_at";
  const failedLoginSql = userColumns.has("failed_login_attempts")
    ? "failed_login_attempts"
    : "0 AS failed_login_attempts";
  const lockedUntilSql = userColumns.has("locked_until")
    ? "locked_until"
    : "NULL AS locked_until";
  const permanentLockSql = userColumns.has("is_login_locked")
    ? "is_login_locked"
    : "0 AS is_login_locked";
  const loginLockedAtSql = userColumns.has("login_locked_at")
    ? "login_locked_at"
    : "NULL AS login_locked_at";
  const loginLockReasonSql = userColumns.has("login_lock_reason")
    ? "login_lock_reason"
    : "NULL AS login_lock_reason";
  const lastFailedLoginAtSql = userColumns.has("last_failed_login_at")
    ? "last_failed_login_at"
    : "NULL AS last_failed_login_at";
  const lastFailedLoginIpSql = userColumns.has("last_failed_login_ip")
    ? "last_failed_login_ip"
    : "NULL AS last_failed_login_ip";
  const lastLoginAtSql = userColumns.has("last_login_at")
    ? "last_login_at"
    : "NULL AS last_login_at";
  const lastLoginIpSql = userColumns.has("last_login_ip")
    ? "last_login_ip"
    : "NULL AS last_login_ip";
  const tokenVersionSql = userColumns.has("token_version")
    ? "token_version"
    : "0 AS token_version";

  const [users] = await pool.query(
    `SELECT
      id,
      full_name,
      username,
      password_hash,
      role,
      ${phoneSql},
      ${defaultBranchSql},
      ${allBranchesSql},
      ${activeSql},
      ${mustChangePasswordSql},
      ${passwordChangedAtSql},
      ${createdAtSql},
      ${failedLoginSql},
      ${lockedUntilSql},
      ${permanentLockSql},
      ${loginLockedAtSql},
      ${loginLockReasonSql},
      ${lastFailedLoginAtSql},
      ${lastFailedLoginIpSql},
      ${lastLoginAtSql},
      ${lastLoginIpSql},
      ${tokenVersionSql}
     FROM users
     ${whereSql}
     LIMIT 1`,
    params
  );

  return users;
}

async function getBranchById(branchId) {
  if (!branchId) {
    return null;
  }

  const branchColumns = await getTableColumns("branches");

  if (branchColumns.size === 0) {
    return null;
  }

  const branchCodeSql = branchColumns.has("branch_code")
    ? "branch_code"
    : branchColumns.has("code")
    ? "code AS branch_code"
    : "CONCAT('BR-', id) AS branch_code";

  const nameSql = branchColumns.has("name")
    ? "name"
    : branchColumns.has("branch_name")
    ? "branch_name AS name"
    : "CONCAT('Branch ', id) AS name";

  const locationSql = branchColumns.has("location")
    ? "location"
    : branchColumns.has("branch_location")
    ? "branch_location AS location"
    : "NULL AS location";

  const phoneSql = branchColumns.has("phone")
    ? "phone"
    : branchColumns.has("branch_phone")
    ? "branch_phone AS phone"
    : "NULL AS phone";

  const headOfficeSql = branchColumns.has("is_head_office")
    ? "is_head_office"
    : "0 AS is_head_office";

  const activeSql = branchColumns.has("is_active")
    ? "is_active"
    : "1 AS is_active";
  const activeWhere = branchColumns.has("is_active")
    ? "AND is_active = TRUE"
    : "";

  const [branches] = await pool.query(
    `SELECT
      id,
      ${branchCodeSql},
      ${nameSql},
      ${locationSql},
      ${phoneSql},
      ${headOfficeSql},
      ${activeSql}
     FROM branches
     WHERE id = ?
     ${activeWhere}
     LIMIT 1`,
    [branchId]
  );

  return branches.length > 0 ? branches[0] : null;
}

async function getDefaultBranchForUser(user) {
  const defaultBranchId = cleanNumber(user.default_branch_id, 1);
  const defaultBranch = await getBranchById(defaultBranchId);

  if (defaultBranch) {
    return defaultBranch;
  }

  return getBranchById(1);
}

async function userCanAccessBranch(user, branchId) {
  if (!branchId) {
    return false;
  }

  if (boolValue(user.can_access_all_branches)) {
    return true;
  }

  const defaultBranchId = cleanNumber(user.default_branch_id, 1);

  if (Number(branchId) === Number(defaultBranchId)) {
    return true;
  }

  const accessTableExists = await tableExists("user_branch_access");

  if (!accessTableExists) {
    return false;
  }

  const [accessRows] = await pool.query(
    `SELECT user_id, branch_id
     FROM user_branch_access
     WHERE user_id = ?
     AND branch_id = ?
     LIMIT 1`,
    [user.id, branchId]
  );

  return accessRows.length > 0;
}

async function resolveLoginBranch(user, requestedBranchId) {
  const selectedBranchId =
    cleanNumber(requestedBranchId, null) ||
    cleanNumber(user.default_branch_id, null) ||
    1;

  const branch = await getBranchById(selectedBranchId);

  if (!branch) {
    return {
      ok: false,
      statusCode: 400,
      message: "Selected store was not found or is not active.",
      branch: null,
    };
  }

  const canAccess = await userCanAccessBranch(user, branch.id);

  if (!canAccess) {
    return {
      ok: false,
      statusCode: 403,
      message: "You are not allowed to login to the selected store.",
      branch: null,
    };
  }

  return {
    ok: true,
    statusCode: 200,
    message: "Store selected.",
    branch,
  };
}

async function getBusinessUnitByCode(workspaceCode) {
  const normalizedCode = normalizeWorkspaceCode(workspaceCode);

  if (!normalizedCode) {
    return null;
  }

  const businessUnitsExist = await tableExists("business_units");

  if (!businessUnitsExist) {
    if (normalizedCode === DEFAULT_WORKSPACE_CODE) {
      return {
        id: null,
        code: DEFAULT_WORKSPACE_CODE,
        name: "Spare Parts",
        is_enabled: true,
      };
    }

    return null;
  }

  const [rows] = await pool.query(
    `SELECT id, code, name, description, is_enabled
     FROM business_units
     WHERE code = ?
     LIMIT 1`,
    [normalizedCode]
  );

  if (rows.length === 0 || !boolValue(rows[0].is_enabled)) {
    return null;
  }

  return rows[0];
}

async function userCanAccessWorkspace(user, workspace) {
  if (!workspace) {
    return false;
  }

  const role = cleanText(user.role).toLowerCase();

  // Administrators manage all enabled business workspaces.
  if (role === "admin") {
    return true;
  }

  if (role === "cashier" && workspace.code !== DEFAULT_WORKSPACE_CODE) {
    return false;
  }

  if (workspace.code === DEFAULT_WORKSPACE_CODE) {
    return true;
  }

  const accessTableExists = await tableExists("user_business_access");

  if (!accessTableExists || !workspace.id) {
    return false;
  }

  const [rows] = await pool.query(
    `SELECT id
     FROM user_business_access
     WHERE user_id = ?
       AND business_unit_id = ?
       AND can_access = TRUE
     LIMIT 1`,
    [user.id, workspace.id]
  );

  return rows.length > 0;
}

async function resolveWorkspaceAccess(user, workspace) {
  if (!workspace) {
    return {
      canAccess: false,
      workspaceRole: null,
    };
  }

  const role = cleanText(user.role).toLowerCase();

  if (role === "admin") {
    return {
      canAccess: true,
      workspaceRole:
        workspace.code === DEFAULT_WORKSPACE_CODE ? "admin" : "group_admin",
    };
  }

  if (workspace.code === DEFAULT_WORKSPACE_CODE) {
    return {
      canAccess: true,
      workspaceRole: role,
    };
  }

  if (role === "cashier") {
    return {
      canAccess: false,
      workspaceRole: null,
    };
  }

  const accessTableExists = await tableExists("user_business_access");

  if (!accessTableExists || !workspace.id) {
    return {
      canAccess: false,
      workspaceRole: null,
    };
  }

  const [rows] = await pool.query(
    `SELECT access_role
     FROM user_business_access
     WHERE user_id = ?
       AND business_unit_id = ?
       AND can_access = TRUE
     LIMIT 1`,
    [user.id, workspace.id]
  );

  if (rows.length === 0) {
    return {
      canAccess: false,
      workspaceRole: null,
    };
  }

  return {
    canAccess: true,
    workspaceRole: cleanText(rows[0].access_role, 80).toLowerCase(),
  };
}

async function resolveLoginWorkspace(user, requestedWorkspaceCode) {
  const workspaceCode = normalizeWorkspaceCode(requestedWorkspaceCode);

  if (!workspaceCode) {
    return {
      ok: false,
      statusCode: 400,
      message: "The selected business workspace is invalid.",
      workspace: null,
    };
  }

  const workspace = await getBusinessUnitByCode(workspaceCode);

  if (!workspace) {
    return {
      ok: false,
      statusCode: 503,
      message:
        workspaceCode === DEFAULT_WORKSPACE_CODE
          ? "Spare Parts workspace is not available."
          : "This business workspace has not been enabled in the database.",
      workspace: null,
    };
  }

  const access = await resolveWorkspaceAccess(user, workspace);

  if (!access.canAccess) {
    return {
      ok: false,
      statusCode: 403,
      message: `Your account does not have access to ${workspace.name}.`,
      workspace: null,
    };
  }

  return {
    ok: true,
    statusCode: 200,
    message: "Workspace selected.",
    workspace,
    workspaceRole: access.workspaceRole,
  };
}

function buildUserResponse(user, branch, workspace) {
  const isSpareParts = workspace?.code === DEFAULT_WORKSPACE_CODE;
  const activeBranch = isSpareParts ? branch : null;
  const workspaceRole =
    user.workspace_role ||
    user.access_role ||
    (isSpareParts ? user.role : null);
  const branchCode =
    activeBranch?.branch_code || activeBranch?.code || null;
  const branchName =
    activeBranch?.name || activeBranch?.branch_name || null;
  const branchLocation =
    activeBranch?.location || activeBranch?.branch_location || null;

  return {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    workspace_role: workspaceRole,
    phone: user.phone,
    workspace_code: workspace?.code || DEFAULT_WORKSPACE_CODE,
    business_unit_id: workspace?.id || null,
    business_unit_name: workspace?.name || "Spare Parts",
    active_workspace: {
      id: workspace?.id || null,
      code: workspace?.code || DEFAULT_WORKSPACE_CODE,
      name: workspace?.name || "Spare Parts",
    },
    default_branch_id: isSpareParts ? user.default_branch_id : null,
    can_access_all_branches: isSpareParts
      ? boolValue(user.can_access_all_branches)
      : false,
    must_change_password: boolValue(user.must_change_password),
    password_changed_at: user.password_changed_at || null,
    branch_id: activeBranch?.id || null,
    branch_code: branchCode,
    branch_name: branchName,
    branch_location: branchLocation,
    branch_phone: activeBranch?.phone || null,
    effective_permissions: getEffectivePermissions({
      ...user,
      workspace_code: workspace?.code || DEFAULT_WORKSPACE_CODE,
      workspace_role: workspaceRole,
    }),
    selected_branch: activeBranch
      ? {
          id: activeBranch.id,
          branch_id: activeBranch.id,
          code: branchCode,
          branch_code: branchCode,
          name: branchName,
          branch_name: branchName,
          location: branchLocation,
          branch_location: branchLocation,
          phone: activeBranch.phone,
          is_head_office: boolValue(activeBranch.is_head_office),
        }
      : null,
  };
}

async function writeActivityLog(branchId, userId, action, details) {
  await writeAuditEvent({
    branchId: branchId || null,
    userId: userId || null,
    action,
    actionType: action,
    outcome: String(action || "").includes("FAIL") ? "failure" : "success",
    severity: String(action || "").includes("LOCK") ? "warning" : "info",
    details,
  });
}

function requestIp(req) {
  return String(
    req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || ""
  )
    .split(",")[0]
    .trim()
    .slice(0, 50);
}

function lockedUntilDate(user) {
  if (!user?.locked_until) return null;
  const date = new Date(user.locked_until);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLoginLocked(user) {
  if (boolValue(user?.is_login_locked)) {
    return true;
  }

  const lockedUntil = lockedUntilDate(user);
  return lockedUntil ? lockedUntil.getTime() > Date.now() : false;
}

function strongPasswordError(password) {
  const text = String(password || "");

  if (text.length < 8) {
    return "Password must be at least 8 characters long.";
  }

  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text)) {
    return "Password must include both uppercase and lowercase letters.";
  }

  if (!/\d/.test(text)) {
    return "Password must include at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(text)) {
    return "Password must include at least one symbol.";
  }

  return "";
}

async function recordSuccessfulLogin(req, user) {
  const userColumns = await getTableColumns("users");
  const updateFields = [];
  const updateParams = [];

  if (userColumns.has("failed_login_attempts")) {
    updateFields.push("failed_login_attempts = 0");
  }

  if (userColumns.has("locked_until")) {
    updateFields.push("locked_until = NULL");
  }

  if (userColumns.has("is_login_locked")) {
    updateFields.push("is_login_locked = FALSE");
  }

  if (userColumns.has("login_locked_at")) {
    updateFields.push("login_locked_at = NULL");
  }

  if (userColumns.has("login_lock_reason")) {
    updateFields.push("login_lock_reason = NULL");
  }

  if (userColumns.has("last_login_at")) {
    updateFields.push("last_login_at = NOW()");
  }

  if (userColumns.has("last_login_ip")) {
    updateFields.push("last_login_ip = ?");
    updateParams.push(requestIp(req));
  }

  if (updateFields.length > 0) {
    await pool.query(
      `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`,
      [...updateParams, user.id]
    );
  }
}

async function sendPasswordChangedSecuritySmsAlert({ user, branch, workspace }) {
  try {
    const branchId = branch?.id || user?.default_branch_id || 1;

    const { businessName, branch: alertBranch } =
      await buildOwnerAlertContext(branchId);

    const branchCode =
      alertBranch?.code || branch?.branch_code || branch?.code || "STORE";

    const branchName =
      alertBranch?.name ||
      branch?.name ||
      branch?.branch_name ||
      "Selected Store";

    const accessContext =
      workspace?.code && workspace.code !== DEFAULT_WORKSPACE_CODE
        ? workspace.name
        : `${branchName} (${branchCode})`;

    const message = `${businessName}: Security alert. Password changed for user ${
      user.full_name || user.username
    } (${user.username}) in ${accessContext} on ${formatSecurityDateTime()}. If this was not expected, review the account immediately.`;

    await sendOwnerSmsAlert({
      branchId,
      message,
      smsType: "security_alert",
      sentBy: user.id,
    });
  } catch (error) {
    console.warn("Password change SMS alert skipped:", error.message);
  }
}

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const username = cleanText(req.body.username);
    const password = req.body.password;
    const workspaceCode = normalizeWorkspaceCode(req.body.workspace_code);
    const branchId = cleanNumber(req.body.branch_id, null);

    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message: "Username and password are required.",
      });
    }

    if (!workspaceCode) {
      return res.status(400).json({
        status: "error",
        message: "Please choose a valid business workspace.",
      });
    }

    if (workspaceCode === DEFAULT_WORKSPACE_CODE && !branchId) {
      return res.status(400).json({
        status: "error",
        message: "Please choose a Spare Parts store before logging in.",
      });
    }

    if (workspaceCode !== DEFAULT_WORKSPACE_CODE && branchId) {
      return res.status(400).json({
        status: "error",
        message:
          "Spare Parts stores cannot be used for Mining Operations or Equipment Hire.",
      });
    }

    const users = await buildUserSelectByWhere(`WHERE username = ?`, [
      username,
    ]);

    if (users.length === 0) {
      return res.status(401).json({
        status: "error",
        message: AUTH_FAILURE_MESSAGE,
      });
    }

    const user = users[0];

    if (isLoginLocked(user)) {
      await writeAuditEvent({
        req,
        userId: user.id,
        branchId: user.default_branch_id || null,
        action: "LOGIN_BLOCKED_ACCOUNT_LOCKED",
        actionType: "security.account.login_blocked",
        outcome: "blocked",
        severity: "critical",
        entityType: "user",
        entityId: user.id,
        details:
          "Login blocked because the account is locked.",
        metadata: {
          failed_login_attempts:
            Number(user.failed_login_attempts || 0),
          login_locked_at: user.login_locked_at || null,
          login_lock_reason:
            user.login_lock_reason || null,
        },
      });

      return res.status(423).json({
        status: "error",
        code: "ACCOUNT_LOCKED",
        message:
          "This account is locked. Use Forgot Password for SMS recovery or contact the original System Administrator.",
      });
    }

    if (!boolValue(user.is_active)) {
      return res.status(403).json({
        status: "error",
        message: AUTH_FAILURE_MESSAGE,
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      const failure = await recordFailedLoginAttempt({
        req,
        user,
      });

      if (failure.locked) {
        return res.status(423).json({
          status: "error",
          code: "ACCOUNT_LOCKED",
          message:
            "This account is locked. Use Forgot Password for SMS recovery or contact the original System Administrator.",
        });
      }

      return res.status(401).json({
        status: "error",
        message: AUTH_FAILURE_MESSAGE,
      });
    }

    const workspaceResult = await resolveLoginWorkspace(user, workspaceCode);

    if (!workspaceResult.ok) {
      return res.status(workspaceResult.statusCode).json({
        status: "error",
        message: workspaceResult.message,
      });
    }

    const workspace = workspaceResult.workspace;
    user.workspace_role = workspaceResult.workspaceRole;
    let selectedBranch = null;

    if (workspace.code === DEFAULT_WORKSPACE_CODE) {
      const branchResult = await resolveLoginBranch(user, branchId);

      if (!branchResult.ok) {
        return res.status(branchResult.statusCode).json({
          status: "error",
          message: branchResult.message,
        });
      }

      selectedBranch = branchResult.branch;
    }

    const session = await createSession({
      userId: user.id,
      req,
      workspaceCode: workspace.code,
      branchId: selectedBranch?.id || null,
    });

    const token = createToken(
      user,
      selectedBranch,
      workspace,
      session.sessionId
    );

    const loginContext = selectedBranch
      ? `${workspace.name} — ${selectedBranch.name}`
      : workspace.name;

    await writeActivityLog(
      selectedBranch?.id || null,
      user.id,
      session.replacedSessionCount > 0
        ? "LOGIN_SESSION_REPLACED"
        : "LOGIN",
      session.replacedSessionCount > 0
        ? `${user.username} logged in to ${loginContext}; the previous device session was revoked`
        : `${user.username} logged in successfully to ${loginContext}`
    );

    await recordSuccessfulLogin(req, user);

    return res.json({
      status: "success",
      message: `Login successful. Opening ${workspace.name}.`,
      token,
      workspace: {
        id: workspace.id || null,
        code: workspace.code,
        name: workspace.name,
      },
      user: buildUserResponse(user, selectedBranch, workspace),
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while logging in.",
    });
  }
});

// POST /api/auth/logout
router.post("/logout", requireAuth, async (req, res) => {
  try {
    await revokeSession({
      userId: req.user.id,
      sessionId: req.user.session_id,
      reason: "logout",
    });

    await writeAuditEvent({
      req,
      userId: req.user.id,
      branchId: req.user.branch_id || null,
      action: "LOGOUT",
      actionType: "auth.logout",
      outcome: "success",
      severity: "info",
      entityType: "user",
      entityId: req.user.id,
      details: "User logged out and the active server session was revoked.",
    });

    return res.json({
      status: "success",
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Logout error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while logging out.",
    });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  try {
    const users = await buildUserSelectByWhere(`WHERE id = ?`, [req.user.id]);

    if (users.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    const user = users[0];

    if (!boolValue(user.is_active)) {
      return res.status(403).json({
        status: "error",
        message: "This account has been disabled. Please contact the administrator.",
      });
    }

    const workspaceCode =
      normalizeWorkspaceCode(req.user.workspace_code) ||
      DEFAULT_WORKSPACE_CODE;
    const workspaceResult = await resolveLoginWorkspace(user, workspaceCode);

    if (!workspaceResult.ok) {
      return res.status(workspaceResult.statusCode).json({
        status: "error",
        message: workspaceResult.message,
      });
    }

    const workspace = workspaceResult.workspace;
    user.workspace_role = workspaceResult.workspaceRole;
    let selectedBranch = null;

    if (workspace.code === DEFAULT_WORKSPACE_CODE) {
      if (req.user.branch_id) {
        selectedBranch = await getBranchById(req.user.branch_id);
      }

      if (!selectedBranch) {
        selectedBranch = await getDefaultBranchForUser(user);
      }

      if (!selectedBranch) {
        return res.status(400).json({
          status: "error",
          message: "Your Spare Parts session does not have an active store.",
        });
      }

      const canAccess = await userCanAccessBranch(user, selectedBranch.id);

      if (!canAccess) {
        return res.status(403).json({
          status: "error",
          message: "You no longer have access to the selected store.",
        });
      }
    }

    return res.json({
      status: "success",
      workspace: {
        id: workspace.id || null,
        code: workspace.code,
        name: workspace.name,
      },
      user: buildUserResponse(user, selectedBranch, workspace),
    });
  } catch (error) {
    console.error("Me route error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching user profile.",
    });
  }
});

// POST /api/auth/change-password
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({
        status: "error",
        message:
          "Current password, new password and confirm password are required.",
      });
    }

    const passwordPolicyError = strongPasswordError(new_password);

    if (passwordPolicyError) {
      return res.status(400).json({
        status: "error",
        message: passwordPolicyError,
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        status: "error",
        message: "New password and confirm password do not match.",
      });
    }

    const users = await buildUserSelectByWhere(`WHERE id = ?`, [req.user.id]);

    if (users.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "User account not found.",
      });
    }

    const user = users[0];

    if (!boolValue(user.is_active)) {
      return res.status(403).json({
        status: "error",
        message: "This account has been disabled.",
      });
    }

    const currentPasswordMatches = await bcrypt.compare(
      current_password,
      user.password_hash
    );

    if (!currentPasswordMatches) {
      return res.status(401).json({
        status: "error",
        message: "Current password is incorrect.",
      });
    }

    const sameAsOldPassword = await bcrypt.compare(
      new_password,
      user.password_hash
    );

    if (sameAsOldPassword) {
      return res.status(400).json({
        status: "error",
        message: "New password must be different from current password.",
      });
    }

    const newPasswordHash = await bcrypt.hash(new_password, 10);
    const userColumns = await getTableColumns("users");
    const updateFields = ["password_hash = ?"];
    const updateParams = [newPasswordHash];

    if (userColumns.has("must_change_password")) {
      updateFields.push("must_change_password = FALSE");
    }

    if (userColumns.has("password_changed_at")) {
      updateFields.push("password_changed_at = CURRENT_TIMESTAMP");
    }

    if (userColumns.has("token_version")) {
      updateFields.push("token_version = token_version + 1");
    }

    await pool.query(
      `UPDATE users
       SET ${updateFields.join(",\n           ")}
       WHERE id = ?`,
      [...updateParams, user.id]
    );

    await revokeAllUserSessions(user.id, "password_changed");

    const workspaceCode =
      normalizeWorkspaceCode(req.user.workspace_code) ||
      DEFAULT_WORKSPACE_CODE;
    const workspace =
      (await getBusinessUnitByCode(workspaceCode)) ||
      (await getBusinessUnitByCode(DEFAULT_WORKSPACE_CODE));

    const selectedBranch =
      workspace?.code === DEFAULT_WORKSPACE_CODE
        ? (await getBranchById(req.user.branch_id)) ||
          (await getDefaultBranchForUser(user))
        : null;

    await writeActivityLog(
      selectedBranch?.id || null,
      user.id,
      "CHANGE_PASSWORD",
      `${user.username} changed account password in ${
        workspace?.name || "Chalin 03"
      }`
    );

    await sendPasswordChangedSecuritySmsAlert({
      user,
      branch:
        selectedBranch ||
        (await getDefaultBranchForUser(user)),
      workspace,
    });

    const updatedUser = {
      ...user,
      must_change_password: false,
      password_changed_at: new Date(),
      workspace_role: req.user.workspace_role || user.workspace_role,
      token_version: userColumns.has("token_version")
        ? Number(user.token_version || 0) + 1
        : Number(user.token_version || 0),
    };
    return res.json({
      status: "success",
      message: "Password changed successfully.",
      user: buildUserResponse(updatedUser, selectedBranch, workspace),
    });
  } catch (error) {
    console.error("Change password error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while changing password.",
    });
  }
});

// POST /api/auth/forgot-password
// Compatibility endpoint for the existing Login page.
async function requestRecoveryOtpHandler(req, res) {
  try {
    await requestRecoveryOtp({
      req,
      username: req.body.username,
    });

    return res.json({
      status: "success",
      message: GENERIC_RECOVERY_REQUEST_MESSAGE,
    });
  } catch (error) {
    console.error(
      "Password recovery OTP request error:",
      error
    );

    return res.status(error.statusCode || 500).json({
      status: "error",
      code: error.code || "RECOVERY_REQUEST_FAILED",
      message:
        error.statusCode && error.statusCode < 500
          ? error.message
          : "Password recovery is temporarily unavailable.",
    });
  }
}

router.post(
  "/forgot-password",
  requestRecoveryOtpHandler
);

router.post(
  "/recovery/request-otp",
  requestRecoveryOtpHandler
);

// POST /api/auth/recovery/reset-password
router.post(
  "/recovery/reset-password",
  async (req, res) => {
    try {
      const result = await recoverAccountWithOtp({
        req,
        username: req.body.username,
        otp: req.body.otp,
        newPassword: req.body.new_password,
        confirmPassword: req.body.confirm_password,
      });

      return res.json({
        status: "success",
        message: result.message,
      });
    } catch (error) {
      console.error(
        "Password recovery reset error:",
        error.code || error.message
      );

      return res
        .status(error.statusCode || 500)
        .json({
          status: "error",
          code:
            error.code ||
            "PASSWORD_RECOVERY_FAILED",
          message:
            error.statusCode && error.statusCode < 500
              ? error.message
              : "Password recovery could not be completed.",
        });
    }
  }
);

module.exports = router;
