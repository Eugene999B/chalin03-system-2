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
const { writeAuditEvent } = require("../services/auditTrailService");
const { normalizedPhoneForStorage } = require("../services/loginIdentityService");
const {
  resetAccountBySystemAdministrator,
} = require("../services/accountRecoveryService");
const {
  revokeAllUserSessions,
} = require("../services/accountSessionService");
const {
  secureDeactivateUser,
} = require("../services/userIdentityPreservationService");

const router = express.Router();

const SYSTEM_ADMIN_ID = Number(process.env.SYSTEM_ADMIN_USER_ID || 1);
const SYSTEM_ADMIN_USERNAME = String(
  process.env.SYSTEM_ADMIN_USERNAME || "admin"
).toLowerCase();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

async function logActivity(userId, branchId, action, details) {
  await writeAuditEvent({
    userId: userId || null,
    branchId: branchId || null,
    action,
    details,
    workspaceCode: "spare_parts",
    entityType: "user",
    actionType: action,
    outcome: "success",
    severity:
      action.includes("PASSWORD") || action.includes("DEACTIVATE")
        ? "critical"
        : "notice",
  });
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function cleanBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
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

function isOriginalSystemAdministrator(user) {
  return (
    Number(user?.id) === SYSTEM_ADMIN_ID &&
    String(user?.username || "").toLowerCase() === SYSTEM_ADMIN_USERNAME &&
    String(user?.role || "").toLowerCase() === "admin"
  );
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );

  return rows.length > 0;
}

async function columnExists(connection, tableName, columnName) {
  try {
    const [columns] = await connection.query(
      `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
      [columnName]
    );

    return columns.length > 0;
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE") {
      return false;
    }

    throw error;
  }
}

async function activeAdminCountExcluding(connection, userId) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS active_admins
     FROM users
     WHERE role = 'admin'
       AND is_active = TRUE
       AND id <> ?`,
    [userId]
  );

  return Number(rows[0]?.active_admins || 0);
}

async function ensureColumn(connection, tableName, columnName, columnDefinition) {
  const exists = await columnExists(connection, tableName, columnName);

  if (!exists) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${columnDefinition}`);
  }
}


async function ensureUserRoleSupportsAuditor(connection = pool) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM users LIKE 'role'`);

  if (columns.length === 0) {
    return;
  }

  const roleColumn = columns[0];
  const roleType = String(roleColumn.Type || "").toLowerCase();

  // Live MySQL can have role as ENUM('admin','manager','cashier').
  // If we insert "auditor" before expanding the enum, MySQL throws:
  // Data truncated for column 'role'.
  if (roleType.startsWith("enum(")) {
    if (!roleType.includes("'auditor'") || !roleType.includes("'staff'")) {
      await connection.query(`
        ALTER TABLE users
        MODIFY role ENUM('admin', 'manager', 'staff', 'cashier', 'auditor') NOT NULL DEFAULT 'cashier'
      `);
    }

    return;
  }

  const varcharMatch = roleType.match(/varchar\((\d+)\)/);

  if (varcharMatch && Number(varcharMatch[1]) < 30) {
    await connection.query(`
      ALTER TABLE users
      MODIFY role VARCHAR(30) NOT NULL DEFAULT 'cashier'
    `);
  }
}

async function ensureUserBranchSetup(connection = pool) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_branch_access (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      branch_id INT NOT NULL,
      can_access BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_branch_access (user_id, branch_id),
      INDEX idx_user_branch_access_user (user_id),
      INDEX idx_user_branch_access_branch (branch_id),
      INDEX idx_user_branch_access_active (can_access)
    )
  `);

  // Older live databases may already have user_branch_access without these
  // newer columns. CREATE TABLE IF NOT EXISTS will not add missing columns,
  // so we repair the existing table before any SELECT uses uba.can_access.
  await ensureColumn(
    connection,
    "user_branch_access",
    "can_access",
    "can_access BOOLEAN NOT NULL DEFAULT TRUE AFTER branch_id"
  );

  await ensureColumn(
    connection,
    "user_branch_access",
    "created_at",
    "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER can_access"
  );

  await ensureColumn(
    connection,
    "user_branch_access",
    "updated_at",
    "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at"
  );

  await ensureColumn(
    connection,
    "users",
    "default_branch_id",
    "default_branch_id INT NULL AFTER role"
  );

  await ensureColumn(
    connection,
    "users",
    "can_access_all_branches",
    "can_access_all_branches BOOLEAN NOT NULL DEFAULT FALSE AFTER default_branch_id"
  );

  await ensureColumn(
    connection,
    "users",
    "phone",
    "phone VARCHAR(30) NULL AFTER can_access_all_branches"
  );

  await ensureColumn(
    connection,
    "users",
    "is_active",
    "is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER phone"
  );

  await ensureColumn(
    connection,
    "users",
    "created_at",
    "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER is_active"
  );

  await ensureColumn(
    connection,
    "users",
    "updated_at",
    "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at"
  );

  await ensureUserRoleSupportsAuditor(connection);
}

async function getBranchColumnMap(connection = pool) {
  if (!(await tableExists(connection, "branches"))) {
    return null;
  }

  const [columns] = await connection.query(`SHOW COLUMNS FROM branches`);
  const columnNames = columns.map((column) => column.Field);

  const pickColumn = (...names) => {
    return names.find((name) => columnNames.includes(name)) || null;
  };

  return {
    code: pickColumn("code", "branch_code", "store_code"),
    name: pickColumn("name", "branch_name", "store_name"),
    location: pickColumn("location", "branch_location", "store_location"),
    isActive: pickColumn("is_active", "active"),
  };
}

function branchColumnExpression(map, alias, key, fallbackSql) {
  if (!map || !map[key]) {
    return fallbackSql;
  }

  return `${alias}.\`${map[key]}\``;
}

function buildBranchDetailsSelect(map, alias = "b") {
  const codeExpression = branchColumnExpression(map, alias, "code", "NULL");
  const nameExpression = branchColumnExpression(
    map,
    alias,
    "name",
    `CONCAT('Store ', ${alias}.id)`
  );
  const locationExpression = branchColumnExpression(map, alias, "location", "NULL");

  return `
    ${codeExpression} AS code,
    ${nameExpression} AS name,
    ${locationExpression} AS location
  `;
}


async function getAllBranchIds(connection = pool) {
  if (!(await tableExists(connection, "branches"))) {
    return [1];
  }

  const branchMap = await getBranchColumnMap(connection);
  const activeWhere = branchMap?.isActive
    ? `WHERE \`${branchMap.isActive}\` = TRUE`
    : "";

  const [branches] = await connection.query(
    `SELECT id
     FROM branches
     ${activeWhere}
     ORDER BY id ASC`
  );

  if (branches.length === 0) {
    return [1];
  }

  return branches.map((branch) => Number(branch.id));
}

function normalizeBranchIds(rawBranchIds, fallbackBranchId) {
  const source = Array.isArray(rawBranchIds) ? rawBranchIds : [];

  const branchIds = source
    .map((branchId) => Number(branchId))
    .filter((branchId) => Number.isInteger(branchId) && branchId > 0);

  const uniqueBranchIds = [...new Set(branchIds)];

  if (uniqueBranchIds.length > 0) {
    return uniqueBranchIds;
  }

  return [fallbackBranchId];
}

async function setUserBranchAccess(
  connection,
  userId,
  branchIds,
  canAccessAllBranches
) {
  await ensureUserBranchSetup(connection);

  const finalBranchIds = canAccessAllBranches
    ? await getAllBranchIds(connection)
    : branchIds;

  await connection.query(
    `DELETE FROM user_branch_access
     WHERE user_id = ?`,
    [userId]
  );

  for (const branchId of finalBranchIds) {
    await connection.query(
      `INSERT INTO user_branch_access (user_id, branch_id, can_access)
       VALUES (?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
        can_access = TRUE,
        updated_at = CURRENT_TIMESTAMP`,
      [userId, branchId]
    );
  }

  const defaultBranchId = finalBranchIds[0] || null;

  await connection.query(
    `UPDATE users
     SET default_branch_id = ?,
         can_access_all_branches = ?
     WHERE id = ?`,
    [defaultBranchId, canAccessAllBranches ? 1 : 0, userId]
  );
}

async function getUserBranches(userId) {
  await ensureUserBranchSetup(pool);

  if (!(await tableExists(pool, "branches"))) {
    const [branches] = await pool.query(
      `SELECT
        uba.branch_id,
        uba.can_access,
        NULL AS code,
        CONCAT('Store ', uba.branch_id) AS name,
        NULL AS location
       FROM user_branch_access uba
       WHERE uba.user_id = ?
       AND uba.can_access = TRUE
       ORDER BY uba.branch_id ASC`,
      [userId]
    );

    return branches;
  }

  const branchMap = await getBranchColumnMap(pool);
  const branchDetailsSelect = buildBranchDetailsSelect(branchMap, "b");
  const orderColumn = branchMap?.name ? `b.\`${branchMap.name}\`` : "uba.branch_id";

  const [branches] = await pool.query(
    `SELECT
      uba.branch_id,
      uba.can_access,
      ${branchDetailsSelect}
     FROM user_branch_access uba
     LEFT JOIN branches b ON uba.branch_id = b.id
     WHERE uba.user_id = ?
     AND uba.can_access = TRUE
     ORDER BY ${orderColumn} ASC, uba.branch_id ASC`,
    [userId]
  );

  return branches;
}

async function getUserById(userId) {
  await ensureUserBranchSetup(pool);

  const [users] = await pool.query(
    `SELECT
      id,
      full_name,
      username,
      role,
      default_branch_id,
      can_access_all_branches,
      phone,
      is_active,
      failed_login_attempts,
      is_login_locked,
      login_locked_at,
      login_lock_reason,
      last_failed_login_at,
      last_failed_login_ip,
      primary_workspace_code,
      category_assignment_status,
      category_conflict_reason,
      created_at,
      updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  if (users.length === 0) {
    return null;
  }

  const user = users[0];
  user.branches = await getUserBranches(user.id);

  return user;
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
    const createdUsername = createdUser?.username || "-";
    const createdRole = createdUser?.role || "-";

    const accessText = accessAllBranches
      ? "Access: all stores"
      : `Access store IDs: ${(selectedBranchIds || []).join(", ")}`;

    const message = `${businessName}: Security alert. New user account created: ${createdUserName} (${createdUsername}), role ${createdRole}. ${accessText}. Created by ${creatorName} at ${branch.name} (${branch.code}) on ${formatSecurityDateTime()}.`;

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
    failed_login_attempts:
      Number(user.failed_login_attempts || 0),
    is_login_locked:
      Boolean(user.is_login_locked),
    login_locked_at:
      user.login_locked_at || null,
    login_lock_reason:
      user.login_lock_reason || null,
    last_failed_login_at:
      user.last_failed_login_at || null,
    last_failed_login_ip:
      user.last_failed_login_ip || null,
    created_at: user.created_at,
    updated_at: user.updated_at,
    primary_workspace_code: user.primary_workspace_code || "spare_parts",
    category_assignment_status: user.category_assignment_status || "assigned",
    category_conflict_reason: user.category_conflict_reason || null,
    branches: user.branches || [],
  };
}

// GET /api/users
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await ensureUserBranchSetup(pool);

    const [users] = await pool.query(
      `SELECT
        id,
        full_name,
        username,
        role,
        default_branch_id,
        can_access_all_branches,
        phone,
        is_active,
        failed_login_attempts,
        is_login_locked,
        login_locked_at,
        login_lock_reason,
        last_failed_login_at,
        last_failed_login_ip,
        primary_workspace_code,
        category_assignment_status,
        category_conflict_reason,
        created_at,
        updated_at
       FROM users
       WHERE primary_workspace_code = 'spare_parts'
          OR (id = ? AND username = ? AND role = 'admin')
       ORDER BY created_at DESC`,
      [SYSTEM_ADMIN_ID, SYSTEM_ADMIN_USERNAME]
    );

    const userIds = users.map((user) => user.id);
    const branchesByUserId = new Map();

    if (userIds.length > 0) {
      const placeholders = userIds.map(() => "?").join(",");

      let branchRows = [];

      if (await tableExists(pool, "branches")) {
        const branchMap = await getBranchColumnMap(pool);
        const branchDetailsSelect = buildBranchDetailsSelect(branchMap, "b");
        const orderColumn = branchMap?.name
          ? `b.\`${branchMap.name}\``
          : "uba.branch_id";

        const [rows] = await pool.query(
          `SELECT
            uba.user_id,
            uba.branch_id,
            uba.can_access,
            ${branchDetailsSelect}
           FROM user_branch_access uba
           LEFT JOIN branches b ON uba.branch_id = b.id
           WHERE uba.user_id IN (${placeholders})
           AND uba.can_access = TRUE
           ORDER BY ${orderColumn} ASC, uba.branch_id ASC`,
          userIds
        );

        branchRows = rows;
      } else {
        const [rows] = await pool.query(
          `SELECT
            uba.user_id,
            uba.branch_id,
            uba.can_access,
            NULL AS code,
            CONCAT('Store ', uba.branch_id) AS name,
            NULL AS location
           FROM user_branch_access uba
           WHERE uba.user_id IN (${placeholders})
           AND uba.can_access = TRUE
           ORDER BY uba.branch_id ASC`,
          userIds
        );

        branchRows = rows;
      }

      for (const branch of branchRows) {
        if (!branchesByUserId.has(branch.user_id)) {
          branchesByUserId.set(branch.user_id, []);
        }

        branchesByUserId.get(branch.user_id).push({
          branch_id: branch.branch_id,
          can_access: Boolean(branch.can_access),
          code: branch.code,
          name: branch.name,
          location: branch.location,
        });
      }
    }

    const usersWithBranches = users.map((user) =>
      normalizeUserRow({
        ...user,
        branches: branchesByUserId.get(user.id) || [],
      })
    );

    return res.json({
      status: "success",
      count: usersWithBranches.length,
      users: usersWithBranches,
    });
  } catch (error) {
    console.error("Get users error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching users.",
    });
  }
});

// POST /api/users
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await ensureUserBranchSetup(connection);

    const branchId = getBranchId(req);

    const {
      full_name,
      username,
      password,
      role,
      phone,
      branch_ids,
      can_access_all_branches,
    } = req.body;

    const allowedRoles = ["admin", "manager", "cashier", "auditor"];

    const cleanFullName = cleanText(full_name);
    const cleanUsername = cleanText(username);
    const cleanPhone = cleanText(phone);
    const normalizedLoginPhone = normalizedPhoneForStorage(cleanPhone);
    const cleanRole = cleanText(role).toLowerCase();
    const accessAllBranches =
      cleanBoolean(can_access_all_branches) || cleanRole === "admin";

    if (cleanPhone && !normalizedLoginPhone) {
      return res.status(400).json({
        status: "error",
        message:
          "Enter a valid Ghana phone number such as 0241234567 or +233241234567.",
      });
    }

    if (!cleanFullName || !cleanUsername || !password || !cleanRole) {
      return res.status(400).json({
        status: "error",
        message: "Full name, username, password and role are required.",
      });
    }

    if (!allowedRoles.includes(cleanRole)) {
      return res.status(400).json({
        status: "error",
        message: "Role must be admin, manager, cashier, or auditor.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 6 characters.",
      });
    }

    const selectedBranchIds = normalizeBranchIds(branch_ids, branchId);
    const passwordHash = await bcrypt.hash(password, 10);

    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO users (
        full_name,
        username,
        password_hash,
        role,
        default_branch_id,
        can_access_all_branches,
        phone,
        is_active,
        primary_workspace_code,
        category_assignment_status,
        category_assignment_reviewed_at,
        category_assignment_reviewed_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, 'spare_parts', 'assigned', NOW(), ?)`,
      [
        cleanFullName,
        cleanUsername,
        passwordHash,
        cleanRole,
        selectedBranchIds[0],
        accessAllBranches ? 1 : 0,
        cleanPhone || null,
        req.user.id,
      ]
    );

    await setUserBranchAccess(
      connection,
      result.insertId,
      selectedBranchIds,
      accessAllBranches
    );

    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [
        branchId,
        req.user.id,
        "CREATE_USER",
        `Created user "${cleanUsername}" with role "${cleanRole}"`,
      ]
    );

    await connection.commit();

    const createdUser = await getUserById(result.insertId);

    await sendNewUserCreatedSecuritySmsAlert({
      createdUser,
      createdByUser: req.user,
      branchId,
      selectedBranchIds,
      accessAllBranches,
    });

    return res.status(201).json({
      status: "success",
      message: "User created successfully.",
      user: normalizeUserRow(createdUser),
    });
  } catch (error) {
    await connection.rollback();

    console.error("Create user error:", error);

    if (error.code === "ER_DUP_ENTRY") {
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

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while creating user.",
    });
  } finally {
    connection.release();
  }
});

// PUT /api/users/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await ensureUserBranchSetup(connection);

    const branchId = getBranchId(req);
    const { id } = req.params;

    const {
      full_name,
      username,
      role,
      phone,
      is_active,
      password,
      branch_ids,
      can_access_all_branches,
    } = req.body;

    const allowedRoles = ["admin", "manager", "staff", "cashier", "auditor"];

    const cleanFullName = cleanText(full_name);
    const cleanUsername = cleanText(username);
    const cleanPhone = cleanText(phone);
    const normalizedLoginPhone = normalizedPhoneForStorage(cleanPhone);
    const cleanRole = cleanText(role).toLowerCase();

    if (cleanPhone && !normalizedLoginPhone) {
      return res.status(400).json({
        status: "error",
        message:
          "Enter a valid Ghana phone number such as 0241234567 or +233241234567.",
      });
    }

    if (!cleanFullName || !cleanUsername || !cleanRole) {
      return res.status(400).json({
        status: "error",
        message: "Full name, username and role are required.",
      });
    }

    if (!allowedRoles.includes(cleanRole)) {
      return res.status(400).json({
        status: "error",
        message: "Role must be admin, manager, staff, cashier, or auditor.",
      });
    }

    const existingUser = await getUserById(id);

    if (!existingUser) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    if (
      !isOriginalSystemAdministrator(existingUser) &&
      String(existingUser.primary_workspace_code || "") !== "spare_parts"
    ) {
      return res.status(409).json({
        status: "error",
        message: "This user belongs to another independent business category.",
      });
    }

    if (isOriginalSystemAdministrator(existingUser)) {
      const requester = await getUserById(req.user.id);

      if (!isOriginalSystemAdministrator(requester)) {
        return res.status(403).json({
          status: "error",
          message:
            "Only the original System Administrator can edit the original System Administrator account.",
        });
      }
    }

    const preserveExistingBranchAccess = cleanRole === "staff";
    const accessAllBranches = preserveExistingBranchAccess
      ? cleanBoolean(existingUser.can_access_all_branches)
      : cleanBoolean(can_access_all_branches) ||
        cleanRole === "admin" ||
        isOriginalSystemAdministrator(existingUser);

    const selectedBranchIds = preserveExistingBranchAccess
      ? []
      : normalizeBranchIds(branch_ids, branchId);
    const nextDefaultBranchId = preserveExistingBranchAccess
      ? existingUser.default_branch_id || null
      : selectedBranchIds[0] || null;

    await connection.beginTransaction();

    if (password && password.trim() !== "") {
      if (password.length < 6) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "Password must be at least 6 characters.",
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      await connection.query(
        `UPDATE users
         SET full_name = ?,
             username = ?,
             role = ?,
             default_branch_id = ?,
             can_access_all_branches = ?,
             phone = ?,
             is_active = ?,
             password_hash = ?
         WHERE id = ?`,
        [
          cleanFullName,
          cleanUsername,
          cleanRole,
          nextDefaultBranchId,
          accessAllBranches ? 1 : 0,
          cleanPhone || null,
          is_active === false ? false : true,
          passwordHash,
          id,
        ]
      );
    } else {
      await connection.query(
        `UPDATE users
         SET full_name = ?,
             username = ?,
             role = ?,
             default_branch_id = ?,
             can_access_all_branches = ?,
             phone = ?,
             is_active = ?
         WHERE id = ?`,
        [
          cleanFullName,
          cleanUsername,
          cleanRole,
          nextDefaultBranchId,
          accessAllBranches ? 1 : 0,
          cleanPhone || null,
          is_active === false ? false : true,
          id,
        ]
      );
    }

    if (!preserveExistingBranchAccess) {
      await setUserBranchAccess(
        connection,
        Number(id),
        selectedBranchIds,
        accessAllBranches
      );
    }

    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [
        branchId,
        req.user.id,
        "UPDATE_USER",
        `Updated user "${cleanUsername}" with ID ${id}`,
      ]
    );

    await connection.commit();

    const updatedUser = await getUserById(id);

    return res.json({
      status: "success",
      message: "User updated successfully.",
      user: normalizeUserRow(updatedUser),
    });
  } catch (error) {
    await connection.rollback();

    console.error("Update user error:", error);

    if (error.code === "ER_DUP_ENTRY") {
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

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while updating user.",
    });
  } finally {
    connection.release();
  }
});

// PATCH /api/users/:id/reset-password
router.patch(
  "/:id/reset-password",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const {
        password,
        confirm_password,
      } = req.body;

      if (!password || !confirm_password) {
        return res.status(400).json({
          status: "error",
          message:
            "New password and confirm password are required.",
        });
      }

      if (password !== confirm_password) {
        return res.status(400).json({
          status: "error",
          message:
            "New password and confirm password do not match.",
        });
      }

      const result =
        await resetAccountBySystemAdministrator({
          req,
          targetUserId: req.params.id,
          newPassword: password,
        });

      return res.json({
        status: "success",
        message: result.message,
      });
    } catch (error) {
      console.error(
        "Reset user password error:",
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
              : "Something went wrong while resetting the user account.",
        });
    }
  }
);
// PATCH /api/users/:id/toggle-status
router.patch(
  "/:id/toggle-status",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const targetUserId = Number(req.params.id);

      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Invalid user ID.",
        });
      }

      if (targetUserId === Number(req.user.id)) {
        return res.status(400).json({
          status: "error",
          message: "You cannot disable your own account while logged in.",
        });
      }

      const user = await getUserById(targetUserId);

      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found.",
        });
      }

      if (isOriginalSystemAdministrator(user)) {
        return res.status(403).json({
          status: "error",
          message: "The original System Administrator account cannot be disabled.",
        });
      }

      const newStatus = !user.is_active;

      if (
        !newStatus &&
        String(user.role || "").toLowerCase() === "admin" &&
        (await activeAdminCountExcluding(pool, user.id)) < 1
      ) {
        return res.status(400).json({
          status: "error",
          message: "At least one active administrator must remain.",
        });
      }

      const updateFields = ["is_active = ?"];
      const updateParams = [newStatus];

      if (!newStatus && (await columnExists(pool, "users", "token_version"))) {
        updateFields.push("token_version = token_version + 1");
      }

      await pool.query(
        `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`,
        [...updateParams, targetUserId]
      );

      const revokedSessionCount = newStatus
        ? 0
        : await revokeAllUserSessions(targetUserId, "account_disabled");

      await logActivity(
        req.user.id,
        branchId,
        newStatus ? "ACTIVATE_USER" : "DEACTIVATE_USER",
        newStatus
          ? `Activated user "${user.username}" while retaining assigned access.`
          : `Disabled user "${user.username}" and revoked ${revokedSessionCount} active session(s); assigned access was retained for controlled reactivation.`
      );

      return res.json({
        status: "success",
        code: newStatus ? "USER_ACTIVATED" : "USER_DISABLED",
        message: newStatus
          ? "User account activated successfully. Assigned access remains available."
          : "User account disabled successfully. Active sessions were revoked and historical records remain linked.",
        is_active: newStatus,
        revoked_session_count: revokedSessionCount,
      });
    } catch (error) {
      console.error("Toggle user status error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while changing user status.",
      });
    }
  }
);

// DELETE /api/users/:id — compatibility endpoint for secure offboarding
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    const branchId = getBranchId(req);
    const targetUserId = Number(req.params.id);

    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID.",
      });
    }

    const requester = await getUserById(req.user.id);

    if (!isOriginalSystemAdministrator(requester)) {
      return res.status(403).json({
        status: "error",
        message:
          "Only the original System Administrator can securely offboard user accounts.",
      });
    }

    if (targetUserId === Number(req.user.id)) {
      return res.status(400).json({
        status: "error",
        message: "You cannot securely offboard your own account while logged in.",
      });
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const [targetRows] = await connection.query(
      `SELECT id, full_name, username, role, is_active, token_version
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [targetUserId]
    );
    const targetUser = targetRows[0];

    if (!targetUser) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    if (isOriginalSystemAdministrator(targetUser)) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(403).json({
        status: "error",
        message:
          "The original System Administrator account cannot be securely offboarded.",
      });
    }

    if (
      String(targetUser.role || "").toLowerCase() === "admin" &&
      Number(targetUser.is_active || 0) === 1 &&
      (await activeAdminCountExcluding(connection, targetUserId)) < 1
    ) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({
        status: "error",
        message: "At least one active administrator must remain.",
      });
    }

    const result = await secureDeactivateUser(connection, {
      targetUserId,
      actorUserId: req.user.id,
      reason:
        "Secure offboarding requested by the original System Administrator; historical identity retained.",
    });

    await writeAuditEvent({
      connection,
      req,
      userId: req.user.id,
      branchId,
      workspaceCode: "spare_parts",
      action: "SECURE_OFFBOARD_USER",
      actionType: "user.secure_offboard",
      outcome: "success",
      severity: "critical",
      entityType: "user",
      entityId: targetUserId,
      details: `Securely offboarded user "${targetUser.username}" (ID ${targetUserId}) without deleting the identity or clearing historical attribution.`,
      metadata: result.revocation_summary,
    });

    await connection.commit();
    transactionStarted = false;

    return res.json({
      status: "success",
      code: "USER_DEACTIVATED_PRESERVED",
      message: `User account "${targetUser.username}" was securely offboarded. Login, sessions and assigned access were revoked while historical business and audit records remain linked to the retained identity.`,
      user: {
        id: targetUserId,
        username: targetUser.username,
        is_active: false,
        identity_preserved: true,
      },
      revocation_summary: result.revocation_summary,
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original secure-offboarding error.
      }
    }

    console.error("Secure offboard user error:", error);

    return res.status(error.statusCode || 500).json({
      status: "error",
      code: error.code || "USER_SECURE_OFFBOARD_FAILED",
      message:
        error.statusCode && error.statusCode < 500
          ? error.message
          : "Something went wrong while securely offboarding the user account.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
