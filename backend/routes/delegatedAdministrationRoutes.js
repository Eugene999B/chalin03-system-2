const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
} = require("../middleware/permissionMiddleware");
const {
  isOriginalSystemAdministrator,
} = require("../security/systemAdminIdentity");
const {
  writeAuditEvent,
} = require("../services/auditTrailService");
const {
  revokeAllUserSessions,
} = require("../services/accountSessionService");
const {
  capabilitySelection,
  delegatedAdministrationOverview,
  delegatedAuthorityForUser,
  grantDelegatedAuthority,
  loadUser,
  revokeActiveDelegatedRows,
} = require("../services/delegatedAdministrationService");
const release2FinalRoutes = require("./release2FinalRoutes");

const { requireProtectedAction, appendLedger } = release2FinalRoutes;
const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseExpiry(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    return undefined;
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function requireOriginalOwner(req, res, next) {
  try {
    const requester = await loadUser(req.user?.id);
    if (!requester || !isOriginalSystemAdministrator(requester)) {
      return res.status(403).json({
        status: "error",
        code: "ORIGINAL_SYSTEM_ADMINISTRATOR_REQUIRED",
        message:
          "Only the original System Administrator can grant or revoke delegated administration authority.",
      });
    }
    req.originalSystemAdministrator = requester;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.get(
  "/overview",
  requireAuth,
  requirePermission("system.diagnostics"),
  asyncHandler(async (req, res) => {
    const requester = await loadUser(req.user.id);
    const overview = await delegatedAdministrationOverview(requester);

    return res.json({
      status: "success",
      delegated_administration: overview,
      request_id: req.requestId || null,
    });
  })
);

router.put(
  "/authorities/:userId",
  requireAuth,
  requirePermission("system.diagnostics"),
  requireOriginalOwner,
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const targetUserId = positiveInteger(req.params.userId);
    const reason = cleanText(req.body?.reason, 500);
    const expiresAt = parseExpiry(req.body?.expires_at);
    const capabilities = capabilitySelection(req.body?.capabilities || {});

    if (!targetUserId) {
      return res.status(400).json({
        status: "error",
        message: "Choose a valid Administrator account.",
      });
    }

    if (reason.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Enter a clear delegation reason of at least 8 characters.",
      });
    }

    if (req.body?.expires_at && expiresAt === undefined) {
      return res.status(400).json({
        status: "error",
        message: "Choose a future expiry date and time, or leave expiry blank.",
      });
    }

    const connection = await pool.getConnection();
    let targetUser;
    let authority;
    let sessionsRevoked = 0;

    try {
      await connection.beginTransaction();
      targetUser = await loadUser(targetUserId, connection, true);

      if (!targetUser) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "The selected user account was not found.",
        });
      }

      if (isOriginalSystemAdministrator(targetUser)) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          code: "ORIGINAL_OWNER_PROTECTED",
          message:
            "The original System Administrator is permanently protected and does not require delegated authority.",
        });
      }

      if (String(targetUser.role || "").trim().toLowerCase() !== "admin") {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message:
            "Delegated System Administrator authority can only be assigned to an Administrator account.",
        });
      }

      if (!Boolean(Number(targetUser.is_active))) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "Activate the Administrator account before delegating authority.",
        });
      }

      authority = await grantDelegatedAuthority({
        connection,
        targetUser,
        actorUserId: req.user.id,
        capabilities,
        reason,
        expiresAt,
      });

      await connection.query(
        `UPDATE users
         SET token_version = COALESCE(token_version, 0) + 1
         WHERE id = ?`,
        [targetUser.id]
      );

      await connection.commit();
      sessionsRevoked = await revokeAllUserSessions(
        targetUser.id,
        "delegated_administration_changed"
      );
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original error.
      }
      throw error;
    } finally {
      connection.release();
    }

    await writeAuditEvent({
      req,
      action: "DELEGATED_ADMIN_AUTHORITY_GRANTED",
      actionType: "security.delegated_admin.granted",
      outcome: "success",
      severity: "critical",
      entityType: "user",
      entityId: targetUser.id,
      details: `${targetUser.username} received delegated System Administrator authority.`,
      metadata: {
        reason,
        expires_at: expiresAt,
        capabilities: authority.capabilities,
        sessions_revoked: sessionsRevoked,
        original_owner_protected: true,
      },
    });

    await appendLedger({
      req,
      actorUserId: req.user.id,
      targetUserId: targetUser.id,
      actionCode: "DELEGATED_ADMIN_AUTHORITY_GRANTED",
      outcome: "success",
      severity: "critical",
      entityType: "user",
      entityId: targetUser.id,
      payload: {
        reason,
        expires_at: expiresAt,
        capabilities: authority.capabilities,
        sessions_revoked: sessionsRevoked,
        original_owner_protected: true,
      },
    });

    return res.json({
      status: "success",
      message:
        `${targetUser.full_name || targetUser.username} is now an owner-approved ` +
        "Delegated System Administrator. Their previous sessions were ended so the new authority applies on the next login.",
      authority,
      sessions_revoked: sessionsRevoked,
    });
  })
);

router.post(
  "/authorities/:userId/revoke",
  requireAuth,
  requirePermission("system.diagnostics"),
  requireOriginalOwner,
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const targetUserId = positiveInteger(req.params.userId);
    const reason = cleanText(req.body?.reason, 500);

    if (!targetUserId) {
      return res.status(400).json({
        status: "error",
        message: "Choose a valid delegated Administrator account.",
      });
    }

    if (reason.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Enter a clear revocation reason of at least 8 characters.",
      });
    }

    const connection = await pool.getConnection();
    let targetUser;
    let revokedRules = 0;
    let sessionsRevoked = 0;

    try {
      await connection.beginTransaction();
      targetUser = await loadUser(targetUserId, connection, true);

      if (!targetUser) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "The selected user account was not found.",
        });
      }

      if (isOriginalSystemAdministrator(targetUser)) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          code: "ORIGINAL_OWNER_PROTECTED",
          message:
            "The original System Administrator is permanently protected and cannot be revoked.",
        });
      }

      revokedRules = await revokeActiveDelegatedRows({
        connection,
        userId: targetUser.id,
        actorUserId: req.user.id,
        reason,
      });

      await connection.query(
        `UPDATE users
         SET token_version = COALESCE(token_version, 0) + 1
         WHERE id = ?`,
        [targetUser.id]
      );

      await connection.commit();
      sessionsRevoked = await revokeAllUserSessions(
        targetUser.id,
        "delegated_administration_revoked"
      );
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original error.
      }
      throw error;
    } finally {
      connection.release();
    }

    const authority = await delegatedAuthorityForUser(targetUser);

    await writeAuditEvent({
      req,
      action: "DELEGATED_ADMIN_AUTHORITY_REVOKED",
      actionType: "security.delegated_admin.revoked",
      outcome: "success",
      severity: "critical",
      entityType: "user",
      entityId: targetUser.id,
      details: `${targetUser.username}'s delegated System Administrator authority was revoked.`,
      metadata: {
        reason,
        revoked_rules: revokedRules,
        sessions_revoked: sessionsRevoked,
        original_owner_protected: true,
      },
    });

    await appendLedger({
      req,
      actorUserId: req.user.id,
      targetUserId: targetUser.id,
      actionCode: "DELEGATED_ADMIN_AUTHORITY_REVOKED",
      outcome: "success",
      severity: "critical",
      entityType: "user",
      entityId: targetUser.id,
      payload: {
        reason,
        revoked_rules: revokedRules,
        sessions_revoked: sessionsRevoked,
        original_owner_protected: true,
      },
    });

    return res.json({
      status: "success",
      message:
        `${targetUser.full_name || targetUser.username}'s delegated authority was revoked. ` +
        "Their active sessions were ended immediately.",
      authority,
      revoked_rules: revokedRules,
      sessions_revoked: sessionsRevoked,
    });
  })
);

module.exports = router;
