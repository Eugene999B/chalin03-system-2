"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { normalizeLoginIdentity } = require("../services/loginIdentityService");
const { createSession, revokeAllUserSessions } = require("../services/accountSessionService");
const {
  recordFailedLoginAttempt,
  strongPasswordError,
} = require("../services/accountRecoveryService");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  CONTENT_STUDIO_WORKSPACE_CODE,
  CONTENT_STUDIO_WORKSPACE_NAME,
  loadContentStudioAccess,
} = require("../services/contentStudioAccessService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

const router = express.Router();
const AUTH_FAILURE_MESSAGE = "Invalid username or password.";

function clean(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function boolValue(value) {
  return value === true || Number(value || 0) === 1;
}

function locked(user) {
  if (boolValue(user?.is_login_locked)) return true;
  if (!user?.locked_until) return false;
  const until = new Date(user.locked_until);
  return !Number.isNaN(until.getTime()) && until.getTime() > Date.now();
}

async function findUser(identifier) {
  const identity = normalizeLoginIdentity(identifier);
  if (!identity.identifier) return { identity, user: null };

  const column = identity.method === "phone" ? "login_phone_normalized" : "username";
  const value = identity.method === "phone" ? identity.normalizedPhone : identity.identifier;
  const [rows] = await pool.query(
    `SELECT id, full_name, username, password_hash, role, phone,
            default_branch_id, can_access_all_branches, is_active,
            must_change_password, password_changed_at, token_version,
            failed_login_attempts, locked_until, is_login_locked,
            login_locked_at, login_lock_reason
       FROM users
      WHERE ${column} = ?
      LIMIT 1`,
    [value]
  );
  return { identity, user: rows[0] || null };
}

async function loadCurrentUser(userId) {
  const [rows] = await pool.query(
    `SELECT id, full_name, username, password_hash, role, phone,
            default_branch_id, can_access_all_branches, is_active,
            must_change_password, password_changed_at, token_version,
            failed_login_attempts, locked_until, is_login_locked,
            login_locked_at, login_lock_reason
       FROM users
      WHERE id = ?
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function createStudioToken(user, access, sessionId, loginMethod) {
  return jwt.sign(
    {
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      role: user.role,
      login_method: loginMethod || "username",
      workspace_code: CONTENT_STUDIO_WORKSPACE_CODE,
      business_unit_id: null,
      business_unit_name: CONTENT_STUDIO_WORKSPACE_NAME,
      workspace_role: access.role_code,
      branch_id: null,
      branch_code: null,
      branch_name: null,
      branch_location: null,
      can_access_all_branches: false,
      must_change_password: boolValue(user.must_change_password),
      session_id: sessionId,
      token_version: Number(user.token_version || 0),
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function studioUserResponse(user, access, loginMethod = "username") {
  return {
    id: Number(user.id),
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    login_method: loginMethod,
    workspace_code: CONTENT_STUDIO_WORKSPACE_CODE,
    workspace_role: access.role_code,
    business_unit_id: null,
    business_unit_name: CONTENT_STUDIO_WORKSPACE_NAME,
    active_workspace: {
      id: null,
      code: CONTENT_STUDIO_WORKSPACE_CODE,
      name: CONTENT_STUDIO_WORKSPACE_NAME,
    },
    branch_id: null,
    branch_code: null,
    branch_name: null,
    branch_location: null,
    can_access_all_branches: false,
    must_change_password: boolValue(user.must_change_password),
    password_changed_at: user.password_changed_at || null,
    effective_permissions: access.permissions,
    content_studio_role: access.role_code,
    content_studio_role_name: access.role_name,
    content_studio_scopes: access.scopes,
    content_studio_access_mode: access.access_mode,
    is_content_studio_owner: Boolean(access.owner),
    is_original_system_administrator: isOriginalSystemAdministrator(user),
  };
}

async function recordSuccessfulStudioLogin(req, user) {
  const ip = clean(
    String(req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "").split(",")[0],
    50
  );
  await pool.query(
    `UPDATE users
        SET failed_login_attempts = 0,
            locked_until = NULL,
            is_login_locked = FALSE,
            login_locked_at = NULL,
            login_lock_reason = NULL,
            last_login_at = NOW(),
            last_login_ip = ?
      WHERE id = ?`,
    [ip || null, user.id]
  );
}

router.post("/login", async (req, res) => {
  try {
    const identifier = clean(req.body?.identifier || req.body?.username, 120);
    const password = String(req.body?.password || "");

    if (!identifier || !password) {
      return res.status(400).json({
        status: "error",
        code: "LOGIN_FIELDS_REQUIRED",
        message: "Username or phone number and password are required.",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(503).json({
        status: "error",
        code: "JWT_SECRET_MISSING",
        message: "Authentication is not configured.",
      });
    }

    const { identity, user } = await findUser(identifier);
    if (!user || !boolValue(user.is_active)) {
      return res.status(401).json({ status: "error", message: AUTH_FAILURE_MESSAGE });
    }

    if (locked(user)) {
      return res.status(423).json({
        status: "error",
        code: "ACCOUNT_LOCKED",
        message: "This account is locked. Contact the System Administrator or use the approved recovery process.",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      const failure = await recordFailedLoginAttempt({ req, user });
      return res.status(failure.locked ? 423 : 401).json({
        status: "error",
        code: failure.locked ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
        message: failure.locked
          ? "Account blocked after three unsuccessful login attempts."
          : `Incorrect password. ${Math.max(Number(failure.attempts_remaining || 0), 0)} login attempt${Number(failure.attempts_remaining || 0) === 1 ? "" : "s"} remaining before the account is blocked.`,
        attempts_remaining: failure.attempts_remaining,
      });
    }

    const access = await loadContentStudioAccess(user);
    if (!access.ok) {
      await writeAuditEvent({
        req,
        userId: user.id,
        action: "CONTENT_STUDIO_LOGIN_DENIED",
        actionType: "content_studio.auth.denied",
        outcome: "blocked",
        severity: "warning",
        entityType: "user",
        entityId: user.id,
        details: "Valid account credentials were supplied but active Content Studio access was not assigned.",
      });
      return res.status(403).json({
        status: "error",
        code: access.code || "CONTENT_STUDIO_ACCESS_DENIED",
        message: access.message || "This account does not have Content Studio access.",
      });
    }

    const session = await createSession({
      userId: user.id,
      req,
      workspaceCode: CONTENT_STUDIO_WORKSPACE_CODE,
      branchId: null,
      loginMethod: identity.method,
      deviceEvidence: req.body?.device_evidence || {},
    });
    const token = createStudioToken(user, access, session.sessionId, identity.method);
    await recordSuccessfulStudioLogin(req, user);

    await writeAuditEvent({
      req,
      userId: user.id,
      action: "CONTENT_STUDIO_LOGIN",
      actionType: "content_studio.auth.login",
      outcome: "success",
      severity: "info",
      entityType: "user",
      entityId: user.id,
      details: `User logged in to Content Studio as ${access.role_name}.`,
      metadata: {
        content_studio_role: access.role_code,
        access_mode: access.access_mode,
        owner: Boolean(access.owner),
      },
    });

    return res.json({
      status: "success",
      message: "Login successful. Opening Content Studio.",
      token,
      workspace: {
        id: null,
        code: CONTENT_STUDIO_WORKSPACE_CODE,
        name: CONTENT_STUDIO_WORKSPACE_NAME,
      },
      user: studioUserResponse(user, access, identity.method),
    });
  } catch (error) {
    console.error("Content Studio login error:", error);
    return res.status(500).json({
      status: "error",
      message: "Content Studio login could not be completed safely.",
    });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await loadCurrentUser(req.user.id);
    if (!user || !boolValue(user.is_active)) {
      return res.status(403).json({
        status: "error",
        code: "ACCOUNT_DISABLED",
        message: "This account is disabled.",
      });
    }
    const access = await loadContentStudioAccess(user);
    if (!access.ok) {
      return res.status(403).json({
        status: "error",
        code: access.code || "CONTENT_STUDIO_ACCESS_DENIED",
        message: access.message,
      });
    }
    return res.json({
      status: "success",
      workspace: {
        id: null,
        code: CONTENT_STUDIO_WORKSPACE_CODE,
        name: CONTENT_STUDIO_WORKSPACE_NAME,
      },
      user: studioUserResponse(user, access, req.user.login_method || "username"),
    });
  } catch (error) {
    console.error("Content Studio profile error:", error);
    return res.status(500).json({ status: "error", message: "Content Studio profile could not be loaded." });
  }
});

router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.current_password || "");
    const newPassword = String(req.body?.new_password || "");
    const confirmPassword = String(req.body?.confirm_password || "");
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ status: "error", message: "Current password, new password and confirmation are required." });
    }
    const policyError = strongPasswordError(newPassword);
    if (policyError) return res.status(400).json({ status: "error", message: policyError });
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ status: "error", message: "New password and confirmation do not match." });
    }

    const user = await loadCurrentUser(req.user.id);
    if (!user || !boolValue(user.is_active)) {
      return res.status(403).json({ status: "error", message: "This account is disabled." });
    }
    const currentMatches = await bcrypt.compare(currentPassword, user.password_hash);
    if (!currentMatches) {
      return res.status(400).json({ status: "error", code: "CURRENT_PASSWORD_INCORRECT", message: "Current password is incorrect." });
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      return res.status(400).json({ status: "error", message: "New password must be different from the current password." });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      `UPDATE users
          SET password_hash = ?, must_change_password = FALSE,
              password_changed_at = NOW(), token_version = COALESCE(token_version, 0) + 1
        WHERE id = ?`,
      [hash, user.id]
    );
    await revokeAllUserSessions(user.id, "content_studio_password_changed");
    await writeAuditEvent({
      req,
      userId: user.id,
      action: "CONTENT_STUDIO_PASSWORD_CHANGED",
      actionType: "content_studio.auth.password_changed",
      outcome: "success",
      severity: "notice",
      entityType: "user",
      entityId: user.id,
      details: "Content Studio account password changed; all sessions were revoked.",
    });
    return res.json({
      status: "success",
      message: "Password changed successfully. Sign in to Content Studio again.",
      reauthentication_required: true,
    });
  } catch (error) {
    console.error("Content Studio password change error:", error);
    return res.status(500).json({ status: "error", message: "Password change could not be completed safely." });
  }
});

module.exports = router;
