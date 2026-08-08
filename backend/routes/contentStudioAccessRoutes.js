"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const {
  requireContentStudioOwner,
} = require("../middleware/contentStudioAccessMiddleware");
const {
  listContentStudioRoles,
} = require("../services/contentStudioAccessService");
const {
  normalizedPhoneForStorage,
} = require("../services/loginIdentityService");
const {
  resetAccountBySystemAdministrator,
  strongPasswordError,
} = require("../services/accountRecoveryService");
const {
  revokeAllUserSessions,
} = require("../services/accountSessionService");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  SYSTEM_ADMIN_ID,
  SYSTEM_ADMIN_USERNAME,
} = require("../security/systemAdminIdentity");

const router = express.Router();
router.use(requireContentStudioOwner);

function clean(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function boolValue(value) {
  return value === true || Number(value || 0) === 1 || value === "true" || value === "1";
}

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
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

async function activeRoleByCode(connection, roleCode) {
  const [rows] = await connection.query(
    `SELECT id, role_code, name, description
       FROM content_studio_roles
      WHERE role_code = ?
        AND is_active = TRUE
      LIMIT 1`,
    [clean(roleCode, 80).toLowerCase()]
  );
  return rows[0] || null;
}

async function setDedicatedStudioIdentity(connection, userId) {
  if (await columnExists(connection, "users", "primary_workspace_code")) {
    await connection.query(
      `UPDATE users
          SET primary_workspace_code = NULL
        WHERE id = ?`,
      [userId]
    );
  }
  if (await columnExists(connection, "users", "category_assignment_status")) {
    await connection.query(
      `UPDATE users
          SET category_assignment_status = 'unassigned',
              category_conflict_reason = NULL
        WHERE id = ?`,
      [userId]
    );
  }
}

async function listAccounts() {
  const [rows] = await pool.query(
    `SELECT
       u.id,
       u.full_name,
       u.username,
       u.phone,
       u.role AS global_role,
       u.is_active AS user_active,
       u.must_change_password,
       u.last_login_at,
       a.access_mode,
       a.is_active AS access_active,
       r.role_code,
       r.name AS role_name,
       r.description AS role_description,
       a.created_at,
       a.updated_at
     FROM content_studio_user_access a
     INNER JOIN users u ON u.id = a.user_id
     INNER JOIN content_studio_roles r ON r.id = a.role_id
     ORDER BY u.full_name, u.username`
  );

  return [
    {
      id: SYSTEM_ADMIN_ID,
      full_name: "System Administrator",
      username: SYSTEM_ADMIN_USERNAME,
      global_role: "admin",
      role_code: "content_administrator",
      role_name: "System Administrator / Studio Owner",
      access_mode: "owner",
      user_active: true,
      access_active: true,
      protected_owner: true,
      must_change_password: false,
    },
    ...rows.map((row) => ({
      ...row,
      id: Number(row.id),
      user_active: boolValue(row.user_active),
      access_active: boolValue(row.access_active),
      must_change_password: boolValue(row.must_change_password),
      protected_owner: false,
    })),
  ];
}

router.get("/roles", async (_req, res, next) => {
  try {
    return res.json({ status: "success", data: await listContentStudioRoles() });
  } catch (error) {
    return next(error);
  }
});

router.get("/accounts", async (_req, res, next) => {
  try {
    return res.json({ status: "success", data: await listAccounts() });
  } catch (error) {
    return next(error);
  }
});

router.post("/accounts", async (req, res, next) => {
  const fullName = clean(req.body?.full_name, 150);
  const username = clean(req.body?.username, 80);
  const phone = clean(req.body?.phone, 30) || null;
  const password = String(req.body?.temporary_password || req.body?.password || "");
  const roleCode = clean(req.body?.role_code, 80).toLowerCase();

  if (!fullName || !username || !password || !roleCode) {
    return res.status(400).json({
      status: "error",
      code: "CONTENT_STUDIO_ACCOUNT_FIELDS_REQUIRED",
      message: "Full name, username, temporary password and Content Studio role are required.",
    });
  }
  const passwordError = strongPasswordError(password);
  if (passwordError) {
    return res.status(400).json({ status: "error", code: "PASSWORD_POLICY_FAILED", message: passwordError });
  }
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(username)) {
    return res.status(400).json({
      status: "error",
      code: "CONTENT_STUDIO_USERNAME_INVALID",
      message: "Username must be 3-80 characters and use only letters, numbers, dots, underscores or hyphens.",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const role = await activeRoleByCode(connection, roleCode);
    if (!role) {
      await connection.rollback();
      return res.status(400).json({ status: "error", code: "CONTENT_STUDIO_ROLE_INVALID", message: "Choose a valid active Content Studio role." });
    }

    const [existing] = await connection.query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`,
      [username]
    );
    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({ status: "error", code: "USERNAME_ALREADY_EXISTS", message: "That username already belongs to another account." });
    }

    const normalizedPhone = phone ? normalizedPhoneForStorage(phone) : null;
    if (normalizedPhone && (await columnExists(connection, "users", "login_phone_normalized"))) {
      const [phoneRows] = await connection.query(
        `SELECT id FROM users WHERE login_phone_normalized = ? LIMIT 1`,
        [normalizedPhone]
      );
      if (phoneRows.length) {
        await connection.rollback();
        return res.status(409).json({ status: "error", code: "PHONE_ALREADY_EXISTS", message: "That phone number already belongs to another account." });
      }
    }

    const hash = await bcrypt.hash(password, 12);
    const [insertResult] = await connection.query(
      `INSERT INTO users
        (full_name, username, password_hash, role, phone, default_branch_id,
         can_access_all_branches, is_active, must_change_password, token_version, created_by)
       VALUES (?, ?, ?, 'staff', ?, NULL, FALSE, TRUE, TRUE, 0, ?)`,
      [fullName, username, hash, phone, req.user.id]
    );
    const userId = Number(insertResult.insertId);

    if (normalizedPhone && (await columnExists(connection, "users", "login_phone_normalized"))) {
      await connection.query(
        `UPDATE users SET login_phone_normalized = ? WHERE id = ?`,
        [normalizedPhone, userId]
      );
    }
    await setDedicatedStudioIdentity(connection, userId);

    await connection.query(
      `INSERT INTO content_studio_user_access
        (user_id, role_id, access_mode, is_active, created_by, updated_by)
       VALUES (?, ?, 'studio_only', TRUE, ?, ?)`,
      [userId, role.id, req.user.id, req.user.id]
    );

    await connection.commit();

    await writeAuditEvent({
      req,
      userId: req.user.id,
      action: "CONTENT_STUDIO_ACCOUNT_CREATED",
      actionType: "content_studio.access.account_created",
      outcome: "success",
      severity: "notice",
      entityType: "user",
      entityId: userId,
      details: "Original System Administrator created a dedicated Content Studio-only account.",
      metadata: { target_username: username, content_studio_role: role.role_code, operational_access_created: false },
    });

    return res.status(201).json({
      status: "success",
      data: { id: userId, full_name: fullName, username, role_code: role.role_code, role_name: role.name, access_mode: "studio_only", must_change_password: true },
      message: "Content Studio-only account created. No operational business access was assigned.",
    });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    return next(error);
  } finally {
    connection.release();
  }
});

router.patch("/accounts/:userId", async (req, res, next) => {
  const userId = Number(req.params.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId === SYSTEM_ADMIN_ID) {
    return res.status(400).json({ status: "error", code: "CONTENT_STUDIO_ACCOUNT_INVALID", message: "Choose a dedicated Content Studio account." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT a.id, a.role_id, a.is_active, u.username
         FROM content_studio_user_access a
         INNER JOIN users u ON u.id = a.user_id
        WHERE a.user_id = ?
        LIMIT 1
        FOR UPDATE`,
      [userId]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ status: "error", code: "CONTENT_STUDIO_ACCOUNT_NOT_FOUND", message: "Content Studio account not found." });
    }

    let roleId = rows[0].role_id;
    let roleCode = null;
    if (req.body?.role_code !== undefined) {
      const role = await activeRoleByCode(connection, req.body.role_code);
      if (!role) {
        await connection.rollback();
        return res.status(400).json({ status: "error", code: "CONTENT_STUDIO_ROLE_INVALID", message: "Choose a valid active Content Studio role." });
      }
      roleId = role.id;
      roleCode = role.role_code;
    }
    const active = req.body?.is_active === undefined ? boolValue(rows[0].is_active) : boolValue(req.body.is_active);

    await connection.query(
      `UPDATE content_studio_user_access
          SET role_id = ?, is_active = ?, updated_by = ?
        WHERE user_id = ?`,
      [roleId, active ? 1 : 0, req.user.id, userId]
    );
    await connection.query(
      `UPDATE users SET is_active = ? WHERE id = ?`,
      [active ? 1 : 0, userId]
    );
    await connection.commit();

    await revokeAllUserSessions(userId, active ? "content_studio_role_changed" : "content_studio_access_disabled");
    await writeAuditEvent({
      req,
      userId: req.user.id,
      action: active ? "CONTENT_STUDIO_ACCOUNT_UPDATED" : "CONTENT_STUDIO_ACCOUNT_DISABLED",
      actionType: active ? "content_studio.access.account_updated" : "content_studio.access.account_disabled",
      outcome: "success",
      severity: active ? "notice" : "warning",
      entityType: "user",
      entityId: userId,
      details: active ? "Content Studio role or account state was updated." : "Dedicated Content Studio account was disabled and sessions revoked.",
      metadata: { target_username: rows[0].username, role_code: roleCode, active },
    });
    return res.json({ status: "success", message: active ? "Content Studio account updated. Existing sessions were revoked." : "Content Studio account disabled. Existing sessions were revoked." });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    return next(error);
  } finally {
    connection.release();
  }
});

router.post("/accounts/:userId/reset-password", async (req, res, next) => {
  const userId = Number(req.params.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId === SYSTEM_ADMIN_ID) {
    return res.status(400).json({ status: "error", code: "CONTENT_STUDIO_ACCOUNT_INVALID", message: "Choose a dedicated Content Studio account." });
  }
  const [rows] = await pool.query(
    `SELECT a.user_id
       FROM content_studio_user_access a
      WHERE a.user_id = ?
      LIMIT 1`,
    [userId]
  );
  if (!rows.length) {
    return res.status(404).json({ status: "error", code: "CONTENT_STUDIO_ACCOUNT_NOT_FOUND", message: "Content Studio account not found." });
  }
  try {
    const result = await resetAccountBySystemAdministrator({
      req,
      targetUserId: userId,
      newPassword: String(req.body?.temporary_password || req.body?.password || ""),
    });
    return res.json({ status: "success", message: result.message });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
