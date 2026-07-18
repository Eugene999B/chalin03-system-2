const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  getEffectivePermissions,
  getPublicPermissionCatalog,
} = require("../security/permissionCatalog");
const {
  buildPermissionDescriptors,
  isOriginalSystemAdministrator,
  loadActivePermissionOverrides,
  normalizeWorkspace,
  resolveEffectivePermissions,
  validateOverridePolicy,
} = require("../services/permissionOverrideService");
const { writeAuditEvent } = require("../services/auditTrailService");
const release2FinalRoutes = require("./release2FinalRoutes");

const router = express.Router();
const { requireProtectedAction, appendLedger } = release2FinalRoutes;

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function booleanValue(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase()
  );
}

function parseExpiry(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (date.getTime() <= Date.now()) return undefined;
  return date;
}

async function loadTargetUser(userId, connection = pool, lock = false) {
  const [rows] = await connection.query(
    `SELECT
       id,
       full_name,
       username,
       role,
       phone,
       is_active,
       default_branch_id,
       can_access_all_branches,
       token_version,
       created_at,
       updated_at
     FROM users
     WHERE id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [userId]
  );

  return rows[0] || null;
}

async function loadWorkspaceRole(user, workspaceCode, connection = pool) {
  const workspace = normalizeWorkspace(workspaceCode);

  if (workspace === "spare_parts" || workspace === "*") {
    return String(user.role || "").trim().toLowerCase();
  }

  const [rows] = await connection.query(
    `SELECT uba.access_role
     FROM user_business_access uba
     INNER JOIN business_units bu
       ON bu.id = uba.business_unit_id
     WHERE uba.user_id = ?
       AND bu.code = ?
       AND uba.can_access = TRUE
     LIMIT 1`,
    [user.id, workspace]
  );

  return rows[0]?.access_role || user.role;
}

async function targetSession(user, workspaceCode, connection = pool) {
  const workspace = normalizeWorkspace(workspaceCode);
  return {
    ...user,
    workspace_code: workspace === "*" ? "spare_parts" : workspace,
    workspace_role: await loadWorkspaceRole(user, workspace, connection),
  };
}

async function permissionState(user, workspaceCode) {
  const workspace = normalizeWorkspace(workspaceCode);
  const session = await targetSession(user, workspace);
  const roleDefaults = getEffectivePermissions(session);
  const overrides = await loadActivePermissionOverrides({
    userId: user.id,
    workspaceCode: workspace,
  });
  const effectivePermissions = await resolveEffectivePermissions(session, {
    workspaceCode: workspace,
  });

  const allowSet = new Set(
    overrides
      .filter((item) => item.effect === "allow")
      .map((item) => item.permission_code)
  );
  const denySet = new Set(
    overrides
      .filter((item) => item.effect === "deny")
      .map((item) => item.permission_code)
  );

  return {
    workspace_code: workspace,
    workspace_role: session.workspace_role,
    role_default_permissions: roleDefaults,
    active_overrides: overrides,
    explicit_allows: [...allowSet].sort(),
    explicit_denies: [...denySet].sort(),
    effective_permissions: effectivePermissions,
  };
}

async function permissionHistory(userId, workspaceCode) {
  const workspace = normalizeWorkspace(workspaceCode);
  const [rows] = await pool.query(
    `SELECT
       upo.id,
       upo.workspace_code,
       upo.permission_code,
       upo.effect,
       upo.reason,
       upo.expires_at,
       upo.created_at,
       upo.updated_at,
       upo.revoked_at,
       upo.revocation_reason,
       creator.full_name AS created_by_name,
       creator.username AS created_by_username,
       revoker.full_name AS revoked_by_name,
       revoker.username AS revoked_by_username
     FROM user_permission_overrides upo
     LEFT JOIN users creator
       ON creator.id = upo.created_by
     LEFT JOIN users revoker
       ON revoker.id = upo.revoked_by
     WHERE upo.user_id = ?
       AND upo.workspace_code IN (?, '*')
     ORDER BY upo.id DESC
     LIMIT 100`,
    [userId, workspace]
  );

  return rows;
}

async function revokeTargetAccess(connection, userId, reason) {
  await connection.query(
    `UPDATE users
     SET token_version = COALESCE(token_version, 0) + 1
     WHERE id = ?`,
    [userId]
  );

  const [result] = await connection.query(
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, NOW()),
         revocation_reason = COALESCE(revocation_reason, ?)
     WHERE user_id = ?
       AND revoked_at IS NULL`,
    [reason, userId]
  );

  return Number(result.affectedRows || 0);
}

router.use(requireAuth, requirePermission("users.permissions.manage"));

router.get(
  "/catalog",
  asyncHandler(async (req, res) => {
    return res.json({
      status: "success",
      permissions: buildPermissionDescriptors(),
      role_catalog: getPublicPermissionCatalog(),
      workspace_options: [
        { code: "spare_parts", label: "Spare Parts" },
        { code: "mining", label: "Mining Operations" },
        { code: "equipment_hire", label: "Equipment Hire" },
      ],
      policy: {
        deny_overrides_allow: true,
        reason_required: true,
        protected_action_required: true,
        expiry_supported: true,
        owner_security_protected: true,
      },
    });
  })
);

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.username,
         u.role,
         u.phone,
         u.is_active,
         u.token_version,
         u.created_at,
         GROUP_CONCAT(
           DISTINCT CONCAT(bu.code, ':', uba.access_role)
           ORDER BY bu.display_order
           SEPARATOR '|'
         ) AS workspace_roles
       FROM users u
       LEFT JOIN user_business_access uba
         ON uba.user_id = u.id
        AND uba.can_access = TRUE
       LEFT JOIN business_units bu
         ON bu.id = uba.business_unit_id
       GROUP BY
         u.id,
         u.full_name,
         u.username,
         u.role,
         u.phone,
         u.is_active,
         u.token_version,
         u.created_at
       ORDER BY u.full_name, u.username`
    );

    return res.json({
      status: "success",
      users: rows.map((row) => ({
        ...row,
        is_active: Boolean(Number(row.is_active)),
        is_original_system_administrator: isOriginalSystemAdministrator(row),
        workspace_roles: String(row.workspace_roles || "")
          .split("|")
          .filter(Boolean)
          .map((entry) => {
            const [code, role] = entry.split(":");
            return { code, role };
          }),
      })),
    });
  })
);

router.get(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const userId = positiveInteger(req.params.userId);
    const workspaceCode = normalizeWorkspace(req.query.workspace_code);

    if (!userId) {
      return res.status(400).json({
        status: "error",
        message: "Choose a valid user.",
      });
    }

    const user = await loadTargetUser(userId);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User account was not found.",
      });
    }

    return res.json({
      status: "success",
      user: {
        ...user,
        is_active: Boolean(Number(user.is_active)),
        is_original_system_administrator: isOriginalSystemAdministrator(user),
      },
      permission_state: await permissionState(user, workspaceCode),
      history: await permissionHistory(userId, workspaceCode),
    });
  })
);

router.post(
  "/users/:userId/override",
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const userId = positiveInteger(req.params.userId);
    const permissionCode = cleanText(req.body.permission_code, 120);
    const workspaceCode = normalizeWorkspace(req.body.workspace_code);
    const effect = cleanText(req.body.effect, 20).toLowerCase();
    const reason = cleanText(req.body.reason, 500);
    const expiresAt = parseExpiry(req.body.expires_at);
    const revokeSessions = booleanValue(req.body.revoke_sessions, true);

    if (!userId) {
      return res.status(400).json({ status: "error", message: "Choose a valid user." });
    }
    if (reason.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Enter a clear reason of at least 8 characters.",
      });
    }
    if (expiresAt === undefined) {
      return res.status(400).json({
        status: "error",
        message: "The permission expiry must be a valid future date and time.",
      });
    }

    const connection = await pool.getConnection();
    let targetUser;
    let revokedSessionCount = 0;

    try {
      await connection.beginTransaction();
      targetUser = await loadTargetUser(userId, connection, true);

      if (!targetUser) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "User account was not found.",
        });
      }

      const policy = validateOverridePolicy({
        targetUser,
        permissionCode,
        effect,
      });

      if (!policy.ok) {
        await connection.rollback();
        return res.status(policy.statusCode).json({
          status: "error",
          code: policy.code,
          message: policy.message,
        });
      }

      await connection.query(
        `UPDATE user_permission_overrides
         SET revoked_at = NOW(),
             revoked_by = ?,
             revocation_reason = 'replaced_by_new_override'
         WHERE user_id = ?
           AND workspace_code = ?
           AND permission_code = ?
           AND revoked_at IS NULL`,
        [req.user.id, userId, workspaceCode, permissionCode]
      );

      const [insertResult] = await connection.query(
        `INSERT INTO user_permission_overrides (
           user_id,
           workspace_code,
           permission_code,
           effect,
           reason,
           expires_at,
           created_by,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          userId,
          workspaceCode,
          permissionCode,
          policy.effect,
          reason,
          expiresAt,
          req.user.id,
        ]
      );

      if (revokeSessions) {
        revokedSessionCount = await revokeTargetAccess(
          connection,
          userId,
          "permission_override_changed"
        );
      }

      await connection.commit();

      await writeAuditEvent({
        req,
        userId: req.user.id,
        action: "USER_PERMISSION_OVERRIDE_CHANGED",
        actionType: "security.permission_override.changed",
        outcome: "success",
        severity: "warning",
        entityType: "user_permission_override",
        entityId: insertResult.insertId,
        details: `${policy.effect.toUpperCase()} ${permissionCode} for ${targetUser.username} in ${workspaceCode}.`,
        metadata: {
          target_user_id: userId,
          target_username: targetUser.username,
          workspace_code: workspaceCode,
          permission_code: permissionCode,
          effect: policy.effect,
          expires_at: expiresAt,
          reason,
          sessions_revoked: revokedSessionCount,
        },
      });

      await appendLedger({
        req,
        actorUserId: req.user.id,
        targetUserId: userId,
        actionCode: "USER_PERMISSION_OVERRIDE_CHANGED",
        outcome: "success",
        severity: "warning",
        payload: {
          workspace_code: workspaceCode,
          permission_code: permissionCode,
          effect: policy.effect,
          expires_at: expiresAt,
          sessions_revoked: revokedSessionCount,
        },
      });

      return res.json({
        status: "success",
        message: `${policy.effect === "allow" ? "Allowed" : "Restricted"} ${permissionCode} for ${targetUser.full_name || targetUser.username}.`,
        sessions_revoked: revokedSessionCount,
        permission_state: await permissionState(targetUser, workspaceCode),
        history: await permissionHistory(userId, workspaceCode),
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Keep the original error.
      }
      throw error;
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/users/:userId/reset-permission",
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const userId = positiveInteger(req.params.userId);
    const permissionCode = cleanText(req.body.permission_code, 120);
    const workspaceCode = normalizeWorkspace(req.body.workspace_code);
    const reason = cleanText(req.body.reason, 500);
    const revokeSessions = booleanValue(req.body.revoke_sessions, true);

    if (!userId || !permissionCode) {
      return res.status(400).json({
        status: "error",
        message: "Choose a valid user and permission.",
      });
    }
    if (reason.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Enter a clear reason of at least 8 characters.",
      });
    }

    const connection = await pool.getConnection();
    let targetUser;
    let revokedSessionCount = 0;
    let affectedRows = 0;

    try {
      await connection.beginTransaction();
      targetUser = await loadTargetUser(userId, connection, true);
      if (!targetUser) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "User account was not found." });
      }

      const [result] = await connection.query(
        `UPDATE user_permission_overrides
         SET revoked_at = NOW(),
             revoked_by = ?,
             revocation_reason = ?
         WHERE user_id = ?
           AND workspace_code = ?
           AND permission_code = ?
           AND revoked_at IS NULL`,
        [req.user.id, reason, userId, workspaceCode, permissionCode]
      );
      affectedRows = Number(result.affectedRows || 0);

      if (affectedRows > 0 && revokeSessions) {
        revokedSessionCount = await revokeTargetAccess(
          connection,
          userId,
          "permission_override_reset"
        );
      }

      await connection.commit();

      await writeAuditEvent({
        req,
        userId: req.user.id,
        action: "USER_PERMISSION_OVERRIDE_RESET",
        actionType: "security.permission_override.reset",
        outcome: "success",
        severity: "info",
        entityType: "user",
        entityId: userId,
        details: `Reset ${permissionCode} to role default for ${targetUser.username} in ${workspaceCode}.`,
        metadata: {
          workspace_code: workspaceCode,
          permission_code: permissionCode,
          reason,
          previous_overrides_revoked: affectedRows,
          sessions_revoked: revokedSessionCount,
        },
      });

      return res.json({
        status: "success",
        message: `${permissionCode} now follows the role default.`,
        sessions_revoked: revokedSessionCount,
        permission_state: await permissionState(targetUser, workspaceCode),
        history: await permissionHistory(userId, workspaceCode),
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Keep the original error.
      }
      throw error;
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/users/:userId/reset-all",
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const userId = positiveInteger(req.params.userId);
    const workspaceCode = normalizeWorkspace(req.body.workspace_code);
    const reason = cleanText(req.body.reason, 500);
    const revokeSessions = booleanValue(req.body.revoke_sessions, true);

    if (!userId) {
      return res.status(400).json({ status: "error", message: "Choose a valid user." });
    }
    if (reason.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Enter a clear reason of at least 8 characters.",
      });
    }

    const connection = await pool.getConnection();
    let targetUser;
    let revokedSessionCount = 0;
    let affectedRows = 0;

    try {
      await connection.beginTransaction();
      targetUser = await loadTargetUser(userId, connection, true);
      if (!targetUser) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "User account was not found." });
      }

      const [result] = await connection.query(
        `UPDATE user_permission_overrides
         SET revoked_at = NOW(),
             revoked_by = ?,
             revocation_reason = ?
         WHERE user_id = ?
           AND workspace_code = ?
           AND revoked_at IS NULL`,
        [req.user.id, reason, userId, workspaceCode]
      );
      affectedRows = Number(result.affectedRows || 0);

      if (affectedRows > 0 && revokeSessions) {
        revokedSessionCount = await revokeTargetAccess(
          connection,
          userId,
          "permission_overrides_reset_all"
        );
      }

      await connection.commit();

      await writeAuditEvent({
        req,
        userId: req.user.id,
        action: "USER_PERMISSION_OVERRIDES_RESET_ALL",
        actionType: "security.permission_override.reset_all",
        outcome: "success",
        severity: "warning",
        entityType: "user",
        entityId: userId,
        details: `Reset all ${workspaceCode} permission overrides for ${targetUser.username}.`,
        metadata: {
          workspace_code: workspaceCode,
          reason,
          overrides_revoked: affectedRows,
          sessions_revoked: revokedSessionCount,
        },
      });

      await appendLedger({
        req,
        actorUserId: req.user.id,
        targetUserId: userId,
        actionCode: "USER_PERMISSION_OVERRIDES_RESET_ALL",
        outcome: "success",
        severity: "warning",
        payload: {
          workspace_code: workspaceCode,
          overrides_revoked: affectedRows,
          sessions_revoked: revokedSessionCount,
        },
      });

      return res.json({
        status: "success",
        message: `All ${workspaceCode} overrides now follow role defaults.`,
        sessions_revoked: revokedSessionCount,
        permission_state: await permissionState(targetUser, workspaceCode),
        history: await permissionHistory(userId, workspaceCode),
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Keep the original error.
      }
      throw error;
    } finally {
      connection.release();
    }
  })
);

module.exports = router;
