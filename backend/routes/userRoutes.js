const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");
const {
  SYSTEM_ADMIN_ID,
  SYSTEM_ADMIN_USERNAME,
  isOriginalSystemAdministrator,
} = require("../security/systemAdminIdentity");
const {
  resetAccountBySystemAdministrator,
} = require("../services/accountRecoveryService");
const {
  activeAdminCountExcluding,
} = require("../services/categoryIsolationService");
const { normalizePhoneForLogin } = require("../services/phoneIdentityService");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  ensureUserAdministrationSchema,
} = require("../services/userAdministrationSchemaService");

const router = express.Router();
const SPARE_PARTS_ROLES = new Set(["admin", "manager", "cashier", "auditor"]);
const EDITABLE_ROLES = new Set(["admin", "manager", "staff", "cashier", "auditor"]);

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function getBranchId(req) {
  return positiveId(req.user?.branch_id || req.user?.default_branch_id);
}

function strongPasswordError(password) {
  const value = String(password || "");
  if (value.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(value)) return "Password must contain an uppercase letter.";
  if (!/[a-z]/.test(value)) return "Password must contain a lowercase letter.";
  if (!/[0-9]/.test(value)) return "Password must contain a number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must contain a symbol.";
  return null;
}

function sendSchemaError(res, error, fallbackMessage) {
  if (error?.code === "USER_ADMINISTRATION_SCHEMA_NOT_READY") {
    return res.status(503).json({
      status: "error",
      code: error.code,
      message:
        "User administration is unavailable because the approved database migration is incomplete.",
      missing_tables: error.missingTables || [],
      missing_columns: error.missingColumns || [],
      invalid_columns: error.invalidColumns || [],
    });
  }

  return res.status(Number(error?.statusCode || 500)).json({
    status: "error",
    code: error?.code || "USER_ADMINISTRATION_FAILED",
    message:
      Number(error?.statusCode || 500) < 500 ? error.message : fallbackMessage,
  });
}

async function activeBranches(connection = pool, lock = false) {
  const [rows] = await connection.query(
    `SELECT id, code, branch_code, name, location, phone, is_active
     FROM branches
     WHERE is_active = TRUE
     ORDER BY name ASC, id ASC${lock ? " FOR UPDATE" : ""}`
  );
  return rows;
}

async function resolveBranchIds(
  connection,
  rawBranchIds,
  fallbackBranchId,
  accessAllBranches
) {
  const branches = await activeBranches(connection, true);
  if (!branches.length) {
    const error = new Error("At least one active Spare Parts store is required.");
    error.code = "ACTIVE_BRANCH_REQUIRED";
    error.statusCode = 503;
    throw error;
  }

  const activeIds = new Set(branches.map((branch) => Number(branch.id)));
  if (accessAllBranches) return branches.map((branch) => Number(branch.id));

  const requested = Array.from(
    new Set(
      (Array.isArray(rawBranchIds) ? rawBranchIds : [])
        .map(positiveId)
        .filter(Boolean)
    )
  );
  const selected = requested.length
    ? requested
    : fallbackBranchId
      ? [fallbackBranchId]
      : [];
  const invalid = selected.filter((branchId) => !activeIds.has(branchId));
  if (!selected.length || invalid.length) {
    const error = new Error(
      invalid.length
        ? `Selected store IDs are invalid or inactive: ${invalid.join(", ")}.`
        : "Choose at least one active Spare Parts store."
    );
    error.code = "INVALID_BRANCH_ASSIGNMENT";
    error.statusCode = 400;
    throw error;
  }
  return selected;
}

async function setUserBranchAccess(
  connection,
  userId,
  branchIds,
  canAccessAllBranches
) {
  await connection.query(
    `DELETE FROM user_branch_access WHERE user_id = ?`,
    [userId]
  );

  for (const branchId of branchIds) {
    await connection.query(
      `INSERT INTO user_branch_access (user_id, branch_id, can_access)
       VALUES (?, ?, TRUE)`,
      [userId, branchId]
    );
  }

  await connection.query(
    `UPDATE users
     SET default_branch_id = ?,
         can_access_all_branches = ?
     WHERE id = ?`,
    [branchIds[0] || null, canAccessAllBranches ? 1 : 0, userId]
  );
}

async function getUserBranches(userId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT
       uba.branch_id,
       uba.can_access,
       b.code,
       b.branch_code,
       b.name,
       b.location,
       b.phone
     FROM user_branch_access uba
     INNER JOIN branches b ON b.id = uba.branch_id
     WHERE uba.user_id = ?
       AND uba.can_access = TRUE
       AND b.is_active = TRUE
     ORDER BY b.name ASC, b.id ASC`,
    [userId]
  );
  return rows.map((row) => ({
    branch_id: Number(row.branch_id),
    can_access: Boolean(row.can_access),
    code: row.code || row.branch_code,
    name: row.name,
    location: row.location,
    phone: row.phone,
  }));
}

async function getUserById(userId, connection = pool) {
  const id = positiveId(userId);
  if (!id) return null;
  await ensureUserAdministrationSchema(connection);

  const [rows] = await connection.query(
    `SELECT
       id, full_name, username, role, default_branch_id,
       can_access_all_branches, phone, is_active,
       failed_login_attempts, is_login_locked, login_locked_at,
       login_lock_reason, last_failed_login_at, last_failed_login_ip,
       token_version, primary_workspace_code, category_assignment_status,
       category_conflict_reason, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  return {
    ...rows[0],
    branches: await getUserBranches(id, connection),
  };
}

function normalizeUserRow(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    default_branch_id: user.default_branch_id,
    can_access_all_branches: Boolean(user.can_access_all_branches),
    phone: user.phone,
    is_active: Boolean(user.is_active),
    failed_login_attempts: Number(user.failed_login_attempts || 0),
    is_login_locked: Boolean(user.is_login_locked),
    login_locked_at: user.login_locked_at || null,
    login_lock_reason: user.login_lock_reason || null,
    last_failed_login_at: user.last_failed_login_at || null,
    last_failed_login_ip: user.last_failed_login_ip || null,
    created_at: user.created_at,
    updated_at: user.updated_at,
    primary_workspace_code: user.primary_workspace_code || "spare_parts",
    category_assignment_status: user.category_assignment_status || "assigned",
    category_conflict_reason: user.category_conflict_reason || null,
    branches: user.branches || [],
  };
}

async function auditUserAction(
  connection,
  req,
  action,
  targetUserId,
  details,
  metadata = {}
) {
  await writeAuditEvent({
    connection,
    req,
    action,
    actionType: `user.${action.toLowerCase()}`,
    entityType: "user",
    entityId: targetUserId,
    workspaceCode: "spare_parts",
    branchId: getBranchId(req),
    severity: "critical",
    outcome: "success",
    details,
    metadata,
  });
}

async function sendNewUserCreatedSecuritySmsAlert({
  createdUser,
  createdByUser,
  branchId,
  selectedBranchIds,
  accessAllBranches,
}) {
  try {
    const { businessName, branch } = await buildOwnerAlertContext(branchId);
    const creatorName =
      createdByUser?.full_name || createdByUser?.username || "Admin";
    const createdUserName =
      createdUser?.full_name || createdUser?.username || "New user";
    const accessText = accessAllBranches
      ? "Access: all stores"
      : `Access store IDs: ${(selectedBranchIds || []).join(", ")}`;
    const message = `${businessName}: Security alert. New user account created: ${createdUserName} (${createdUser?.username || "-"}), role ${createdUser?.role || "-"}. ${accessText}. Created by ${creatorName} at ${branch.name} (${branch.code}) on ${formatSecurityDateTime()}.`;

    await sendOwnerSmsAlert({
      branchId,
      message,
      smsType: "security_alert",
      sentBy: createdByUser?.id || null,
    });
  } catch (error) {
    console.warn("New user SMS alert skipped:", error.message);
  }
}

router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await ensureUserAdministrationSchema(pool);
    const [users] = await pool.query(
      `SELECT
         id, full_name, username, role, default_branch_id,
         can_access_all_branches, phone, is_active,
         failed_login_attempts, is_login_locked, login_locked_at,
         login_lock_reason, last_failed_login_at, last_failed_login_ip,
         primary_workspace_code, category_assignment_status,
         category_conflict_reason, created_at, updated_at
       FROM users
       WHERE primary_workspace_code = 'spare_parts'
          OR (id = ? AND username = ? AND role = 'admin')
       ORDER BY created_at DESC`,
      [SYSTEM_ADMIN_ID, SYSTEM_ADMIN_USERNAME]
    );

    const ids = users.map((user) => Number(user.id));
    const branchesByUser = new Map(ids.map((id) => [id, []]));
    if (ids.length) {
      const [branchRows] = await pool.query(
        `SELECT
           uba.user_id, uba.branch_id, uba.can_access,
           b.code, b.branch_code, b.name, b.location, b.phone
         FROM user_branch_access uba
         INNER JOIN branches b ON b.id = uba.branch_id
         WHERE uba.user_id IN (${ids.map(() => "?").join(", ")})
           AND uba.can_access = TRUE
         ORDER BY b.name ASC, b.id ASC`,
        ids
      );
      for (const row of branchRows) {
        branchesByUser.get(Number(row.user_id))?.push({
          branch_id: Number(row.branch_id),
          can_access: Boolean(row.can_access),
          code: row.code || row.branch_code,
          name: row.name,
          location: row.location,
          phone: row.phone,
        });
      }
    }

    const result = users.map((user) =>
      normalizeUserRow({
        ...user,
        branches: branchesByUser.get(Number(user.id)) || [],
      })
    );
    return res.json({ status: "success", count: result.length, users: result });
  } catch (error) {
    console.error("Get users error:", error);
    return sendSchemaError(res, error, "Something went wrong while fetching users.");
  }
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await ensureUserAdministrationSchema(connection);
    const branchId = getBranchId(req);
    if (!branchId) {
      const error = new Error("Choose a valid Spare Parts store first.");
      error.code = "VALID_BRANCH_REQUIRED";
      error.statusCode = 400;
      throw error;
    }

    const fullName = cleanText(req.body.full_name, 150);
    const username = cleanText(req.body.username, 80);
    const password = String(req.body.password || "");
    const role = cleanText(req.body.role, 30).toLowerCase();
    const phoneText = cleanText(req.body.phone, 40);
    const normalizedPhone = phoneText ? normalizePhoneForLogin(phoneText) : null;
    if (!fullName || !username || !password || !role) {
      const error = new Error("Full name, username, password and role are required.");
      error.code = "USER_FIELDS_REQUIRED";
      error.statusCode = 400;
      throw error;
    }
    if (!SPARE_PARTS_ROLES.has(role)) {
      const error = new Error("Role must be admin, manager, cashier, or auditor.");
      error.code = "INVALID_SPARE_PARTS_ROLE";
      error.statusCode = 400;
      throw error;
    }
    if (phoneText && !normalizedPhone) {
      const error = new Error(
        "Enter a valid Ghana phone number such as 0241234567 or +233241234567."
      );
      error.code = "INVALID_LOGIN_PHONE";
      error.statusCode = 400;
      throw error;
    }
    const passwordError = strongPasswordError(password);
    if (passwordError) {
      const error = new Error(passwordError);
      error.code = "WEAK_PASSWORD";
      error.statusCode = 400;
      throw error;
    }

    const accessAll = cleanBoolean(req.body.can_access_all_branches) || role === "admin";
    await connection.beginTransaction();
    transactionStarted = true;
    const branchIds = await resolveBranchIds(
      connection,
      req.body.branch_ids,
      branchId,
      accessAll
    );
    const passwordHash = await bcrypt.hash(password, 12);
    const [insertResult] = await connection.query(
      `INSERT INTO users (
         full_name, username, password_hash, role, phone,
         default_branch_id, can_access_all_branches, is_active,
         primary_workspace_code, category_assignment_status,
         category_assignment_reviewed_at, category_assignment_reviewed_by,
         must_change_password, password_changed_at, token_version, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE,
         'spare_parts', 'assigned', NOW(), ?, TRUE, NOW(), 0, ?)`,
      [
        fullName,
        username,
        passwordHash,
        role,
        normalizedPhone,
        branchIds[0],
        accessAll ? 1 : 0,
        req.user.id,
        req.user.id,
      ]
    );
    await setUserBranchAccess(
      connection,
      insertResult.insertId,
      branchIds,
      accessAll
    );
    await auditUserAction(
      connection,
      req,
      "CREATE_USER",
      insertResult.insertId,
      `Created Spare Parts user ${username}.`,
      { role, branch_ids: branchIds, can_access_all_branches: accessAll }
    );
    await connection.commit();
    transactionStarted = false;

    const createdUser = await getUserById(insertResult.insertId);
    await sendNewUserCreatedSecuritySmsAlert({
      createdUser,
      createdByUser: req.user,
      branchId,
      selectedBranchIds: branchIds,
      accessAllBranches: accessAll,
    });
    return res.status(201).json({
      status: "success",
      message:
        "User created successfully. The user must change the temporary password after login.",
      user: normalizeUserRow(createdUser),
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original failure.
      }
    }
    console.error("Create user error:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        status: "error",
        code: "DUPLICATE_USER_IDENTITY",
        message: String(error.message || "").includes("phone")
          ? "This phone number is already attached to another login account."
          : "This username already exists.",
      });
    }
    return sendSchemaError(res, error, "Something went wrong while creating user.");
  } finally {
    connection.release();
  }
});

router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await ensureUserAdministrationSchema(connection);
    const targetId = positiveId(req.params.id);
    const branchId = getBranchId(req);
    if (!targetId || !branchId) {
      const error = new Error("Choose a valid user and Spare Parts store.");
      error.code = "VALID_USER_AND_BRANCH_REQUIRED";
      error.statusCode = 400;
      throw error;
    }

    const existingUser = await getUserById(targetId);
    if (!existingUser) {
      const error = new Error("User not found.");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    if (
      !isOriginalSystemAdministrator(existingUser) &&
      String(existingUser.primary_workspace_code || "") !== "spare_parts"
    ) {
      const error = new Error(
        "This user belongs to another independent business category."
      );
      error.code = "USER_CATEGORY_MISMATCH";
      error.statusCode = 409;
      throw error;
    }

    const requester = await getUserById(req.user.id);
    if (
      isOriginalSystemAdministrator(existingUser) &&
      !isOriginalSystemAdministrator(requester)
    ) {
      const error = new Error(
        "Only the original System Administrator can edit that protected account."
      );
      error.code = "ORIGINAL_OWNER_PROTECTED";
      error.statusCode = 403;
      throw error;
    }

    const fullName = cleanText(req.body.full_name, 150);
    const username = cleanText(req.body.username, 80);
    const role = cleanText(req.body.role, 30).toLowerCase();
    const phoneText = cleanText(req.body.phone, 40);
    const normalizedPhone = phoneText ? normalizePhoneForLogin(phoneText) : null;
    const password = String(req.body.password || "");
    if (!fullName || !username || !role) {
      const error = new Error("Full name, username and role are required.");
      error.code = "USER_FIELDS_REQUIRED";
      error.statusCode = 400;
      throw error;
    }
    if (!EDITABLE_ROLES.has(role)) {
      const error = new Error(
        "Role must be admin, manager, staff, cashier, or auditor."
      );
      error.code = "INVALID_USER_ROLE";
      error.statusCode = 400;
      throw error;
    }
    if (phoneText && !normalizedPhone) {
      const error = new Error("Enter a valid Ghana login phone number.");
      error.code = "INVALID_LOGIN_PHONE";
      error.statusCode = 400;
      throw error;
    }
    if (password) {
      const passwordError = strongPasswordError(password);
      if (passwordError) {
        const error = new Error(passwordError);
        error.code = "WEAK_PASSWORD";
        error.statusCode = 400;
        throw error;
      }
    }

    const owner = isOriginalSystemAdministrator(existingUser);
    const nextRole = owner ? "admin" : role;
    const nextUsername = owner ? SYSTEM_ADMIN_USERNAME : username;
    const nextActive = owner ? true : req.body.is_active !== false;
    const preserveBranchAccess = nextRole === "staff";
    const accessAll = owner
      ? true
      : preserveBranchAccess
        ? Boolean(existingUser.can_access_all_branches)
        : cleanBoolean(req.body.can_access_all_branches) || nextRole === "admin";

    await connection.beginTransaction();
    transactionStarted = true;
    const branchIds = preserveBranchAccess
      ? existingUser.branches.map((branch) => Number(branch.branch_id))
      : await resolveBranchIds(
          connection,
          req.body.branch_ids,
          branchId,
          accessAll
        );
    if (!branchIds.length) {
      const error = new Error("The user must retain at least one valid store.");
      error.code = "USER_BRANCH_ACCESS_REQUIRED";
      error.statusCode = 400;
      throw error;
    }

    const updateFields = [
      "full_name = ?",
      "username = ?",
      "role = ?",
      "phone = ?",
      "is_active = ?",
      "default_branch_id = ?",
      "can_access_all_branches = ?",
      "token_version = COALESCE(token_version, 0) + 1",
    ];
    const updateParams = [
      fullName,
      nextUsername,
      nextRole,
      normalizedPhone,
      nextActive ? 1 : 0,
      branchIds[0],
      accessAll ? 1 : 0,
    ];
    if (password) {
      updateFields.push(
        "password_hash = ?",
        "must_change_password = TRUE",
        "password_changed_at = NOW()"
      );
      updateParams.push(await bcrypt.hash(password, 12));
    }
    updateParams.push(targetId);
    await connection.query(
      `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`,
      updateParams
    );

    if (!preserveBranchAccess) {
      await setUserBranchAccess(connection, targetId, branchIds, accessAll);
    }
    await auditUserAction(
      connection,
      req,
      "UPDATE_USER",
      targetId,
      `Updated user ${nextUsername}; existing sessions were invalidated.`,
      {
        role: nextRole,
        is_active: nextActive,
        branch_ids: branchIds,
        can_access_all_branches: accessAll,
        password_reset: Boolean(password),
      }
    );
    await connection.commit();
    transactionStarted = false;

    const updatedUser = await getUserById(targetId);
    return res.json({
      status: "success",
      message: "User updated successfully. Existing sessions were signed out.",
      user: normalizeUserRow(updatedUser),
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original failure.
      }
    }
    console.error("Update user error:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        status: "error",
        code: "DUPLICATE_USER_IDENTITY",
        message: String(error.message || "").includes("phone")
          ? "This phone number is already attached to another login account."
          : "This username already exists.",
      });
    }
    return sendSchemaError(res, error, "Something went wrong while updating user.");
  } finally {
    connection.release();
  }
});

router.patch(
  "/:id/reset-password",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      await ensureUserAdministrationSchema(pool);
      const password = String(req.body.password || "");
      const confirmation = String(req.body.confirm_password || "");
      if (!password || !confirmation) {
        return res.status(400).json({
          status: "error",
          code: "PASSWORD_CONFIRMATION_REQUIRED",
          message: "New password and confirm password are required.",
        });
      }
      if (password !== confirmation) {
        return res.status(400).json({
          status: "error",
          code: "PASSWORD_CONFIRMATION_MISMATCH",
          message: "New password and confirm password do not match.",
        });
      }
      const passwordError = strongPasswordError(password);
      if (passwordError) {
        return res.status(400).json({
          status: "error",
          code: "WEAK_PASSWORD",
          message: passwordError,
        });
      }

      const result = await resetAccountBySystemAdministrator({
        req,
        targetUserId: req.params.id,
        newPassword: password,
      });
      return res.json({ status: "success", message: result.message });
    } catch (error) {
      console.error("Reset user password error:", error.code || error.message);
      return sendSchemaError(
        res,
        error,
        "Something went wrong while resetting the user account."
      );
    }
  }
);

router.patch(
  "/:id/toggle-status",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      await ensureUserAdministrationSchema(connection);
      const targetId = positiveId(req.params.id);
      if (!targetId) {
        const error = new Error("Invalid user ID.");
        error.code = "INVALID_USER_ID";
        error.statusCode = 400;
        throw error;
      }
      if (targetId === Number(req.user.id)) {
        const error = new Error("You cannot disable your own active session.");
        error.code = "SELF_DISABLE_NOT_ALLOWED";
        error.statusCode = 400;
        throw error;
      }

      const user = await getUserById(targetId);
      if (!user) {
        const error = new Error("User not found.");
        error.code = "USER_NOT_FOUND";
        error.statusCode = 404;
        throw error;
      }
      if (isOriginalSystemAdministrator(user)) {
        const error = new Error(
          "The original System Administrator account cannot be disabled."
        );
        error.code = "ORIGINAL_OWNER_PROTECTED";
        error.statusCode = 403;
        throw error;
      }

      const newStatus = !Boolean(user.is_active);
      if (
        !newStatus &&
        String(user.role || "").toLowerCase() === "admin" &&
        (await activeAdminCountExcluding(connection, user.id)) < 1
      ) {
        const error = new Error("At least one active administrator must remain.");
        error.code = "LAST_ADMIN_REQUIRED";
        error.statusCode = 400;
        throw error;
      }

      await connection.beginTransaction();
      transactionStarted = true;
      await connection.query(
        `UPDATE users
         SET is_active = ?,
             token_version = COALESCE(token_version, 0) + 1
         WHERE id = ?`,
        [newStatus ? 1 : 0, targetId]
      );
      await auditUserAction(
        connection,
        req,
        "TOGGLE_USER_STATUS",
        targetId,
        `${newStatus ? "Activated" : "Disabled"} user ${user.username}; existing sessions were invalidated.`,
        { is_active: newStatus }
      );
      await connection.commit();
      transactionStarted = false;

      return res.json({
        status: "success",
        message: newStatus
          ? "User account activated successfully."
          : "User account disabled and existing sessions signed out.",
        is_active: newStatus,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original failure.
        }
      }
      console.error("Toggle user status error:", error);
      return sendSchemaError(
        res,
        error,
        "Something went wrong while changing user status."
      );
    } finally {
      connection.release();
    }
  }
);

// Historical users must remain linked to business and audit records. Permanent
// deletion is retired; deactivate the account or revoke workspace access instead.
router.delete("/:id", requireAuth, requireRole("admin"), (_req, res) =>
  res.status(410).json({
    status: "error",
    code: "PERMANENT_USER_DELETION_RETIRED",
    message:
      "Permanent user deletion is unavailable. Disable the account or revoke its workspace and store access so historical records remain attributable.",
  })
);

module.exports = router;
