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

async function setUserReferenceToNull(connection, tableName, columnName, userId) {
  const exists = await columnExists(connection, tableName, columnName);

  if (!exists) {
    return;
  }

  await connection.query(
    `UPDATE \`${tableName}\`
     SET \`${columnName}\` = NULL
     WHERE \`${columnName}\` = ?`,
    [userId]
  );
}

async function clearUserReferencesBeforeDelete(connection, userId) {
  const references = [
    { table: "sales", columns: ["staff_id", "voided_by"] },
    { table: "returns", columns: ["returned_by"] },
    { table: "expenses", columns: ["recorded_by"] },
    { table: "debt_payments", columns: ["received_by"] },
    { table: "purchase_payments", columns: ["paid_by", "received_by"] },
    { table: "purchases", columns: ["created_by"] },
    { table: "daily_closings", columns: ["closed_by"] },
    { table: "stock_adjustments", columns: ["adjusted_by", "approved_by"] },
    { table: "sms_log", columns: ["sent_by"] },
    { table: "audit_signoffs", columns: ["created_by", "approved_by"] },
    { table: "audit_unlock_requests", columns: ["requested_by", "reviewed_by"] },
    { table: "audit_reapproval_log", columns: ["reapproved_by"] },
    { table: "activity_log", columns: ["user_id"] },
  ];

  for (const reference of references) {
    for (const column of reference.columns) {
      await setUserReferenceToNull(
        connection,
        reference.table,
        column,
        userId
      );
    }
  }

  if (await tableExists(connection, "user_branch_access")) {
    await connection.query(
      `DELETE FROM user_branch_access
       WHERE user_id = ?`,
      [userId]
    );
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
    created_at: user.created_at,
    updated_at: user.updated_at,
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
        created_at,
        updated_at
       FROM users
       ORDER BY created_at DESC`
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
    const cleanRole = cleanText(role).toLowerCase();
    const accessAllBranches =
      cleanBoolean(can_access_all_branches) || cleanRole === "admin";

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
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        cleanFullName,
        cleanUsername,
        passwordHash,
        cleanRole,
        selectedBranchIds[0],
        accessAllBranches ? 1 : 0,
        cleanPhone || null,
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
      return res.status(409).json({
        status: "error",
        message: "This username already exists.",
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
    const cleanRole = cleanText(role).toLowerCase();

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
      return res.status(409).json({
        status: "error",
        message: "This username already exists.",
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
      const branchId = getBranchId(req);
      const { id } = req.params;
      const { password, confirm_password } = req.body;

      if (!password || !confirm_password) {
        return res.status(400).json({
          status: "error",
          message: "New password and confirm password are required.",
        });
      }

      const passwordPolicyError = strongPasswordError(password);

      if (passwordPolicyError) {
        return res.status(400).json({
          status: "error",
          message: passwordPolicyError,
        });
      }

      if (password !== confirm_password) {
        return res.status(400).json({
          status: "error",
          message: "New password and confirm password do not match.",
        });
      }

      const user = await getUserById(id);

      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found.",
        });
      }

      if (isOriginalSystemAdministrator(user)) {
        const requester = await getUserById(req.user.id);

        if (!isOriginalSystemAdministrator(requester)) {
          return res.status(403).json({
            status: "error",
            message:
              "Only the original System Administrator can reset the original System Administrator password.",
          });
        }
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const updateFields = ["password_hash = ?"];
      const updateParams = [passwordHash];

      if (await columnExists(pool, "users", "must_change_password")) {
        updateFields.push("must_change_password = TRUE");
      }

      if (await columnExists(pool, "users", "password_changed_at")) {
        updateFields.push("password_changed_at = NULL");
      }

      if (await columnExists(pool, "users", "token_version")) {
        updateFields.push("token_version = token_version + 1");
      }

      await pool.query(
        `UPDATE users
         SET ${updateFields.join(", ")}
         WHERE id = ?`,
        [...updateParams, id]
      );

      await logActivity(
        req.user.id,
        branchId,
        "RESET_USER_PASSWORD",
        `Reset password for user "${user.username}" with ID ${user.id}`
      );

      return res.json({
        status: "success",
        message: `Password reset successfully for ${user.full_name}. Tell the user to login and change it immediately.`,
      });
    } catch (error) {
      console.error("Reset user password error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while resetting user password.",
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
      const { id } = req.params;

      if (Number(id) === Number(req.user.id)) {
        return res.status(400).json({
          status: "error",
          message: "You cannot disable your own account while logged in.",
        });
      }

      const user = await getUserById(id);

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
        [...updateParams, id]
      );

      await logActivity(
        req.user.id,
        branchId,
        "TOGGLE_USER_STATUS",
        `${newStatus ? "Activated" : "Disabled"} user "${user.username}"`
      );

      return res.json({
        status: "success",
        message: newStatus
          ? "User account activated successfully."
          : "User account disabled successfully.",
        is_active: newStatus,
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

// DELETE /api/users/:id
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const branchId = getBranchId(req);
    const { id } = req.params;
    const targetUserId = Number(id);

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
          "Only the original System Administrator can permanently delete user accounts.",
      });
    }

    if (targetUserId === Number(req.user.id)) {
      return res.status(400).json({
        status: "error",
        message: "You cannot delete your own account while logged in.",
      });
    }

    const targetUser = await getUserById(targetUserId);

    if (!targetUser) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    if (isOriginalSystemAdministrator(targetUser)) {
      return res.status(403).json({
        status: "error",
        message: "The original System Administrator account cannot be deleted.",
      });
    }

    const [managedWorkspaceRows] = await connection.query(
      `SELECT
         uba.id,
         bu.code
       FROM user_business_access uba
       INNER JOIN business_units bu ON bu.id = uba.business_unit_id
       WHERE uba.user_id = ?
         AND bu.code IN ('mining', 'equipment_hire')
       LIMIT 1`,
      [targetUserId]
    );

    if (
      String(targetUser.role || "").toLowerCase() === "staff" ||
      managedWorkspaceRows.length > 0
    ) {
      return res.status(409).json({
        status: "error",
        message:
          "Mining and Equipment Hire staff accounts must be deactivated or have workspace access revoked. They cannot be permanently deleted because historical records must remain linked.",
      });
    }

    await connection.beginTransaction();

    await clearUserReferencesBeforeDelete(connection, targetUserId);

    await connection.query(`DELETE FROM users WHERE id = ?`, [targetUserId]);

    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [
        branchId,
        req.user.id,
        "DELETE_USER",
        `Permanently deleted user "${targetUser.username}" with role "${targetUser.role}" and ID ${targetUser.id}`,
      ]
    );

    await connection.commit();

    return res.json({
      status: "success",
      message: `User account "${targetUser.username}" deleted permanently.`,
    });
  } catch (error) {
    await connection.rollback();

    console.error("Delete user error:", error);

    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(409).json({
        status: "error",
        message:
          "This user account is connected to business records and could not be deleted. Disable the account instead, or contact the developer to update the linked records safely.",
      });
    }

    return res.status(500).json({
      status: "error",
      message: error.message || "Something went wrong while deleting user.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
