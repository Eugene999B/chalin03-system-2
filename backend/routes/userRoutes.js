const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

const SYSTEM_ADMIN_ID = Number(process.env.SYSTEM_ADMIN_USER_ID || 1);
const SYSTEM_ADMIN_USERNAME = String(
  process.env.SYSTEM_ADMIN_USERNAME || "admin"
).toLowerCase();

async function logActivity(userId, action, details) {
  await pool.query(
    `INSERT INTO activity_log (user_id, action, details)
     VALUES (?, ?, ?)`,
    [userId || null, action, details]
  );
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function isOriginalSystemAdministrator(user) {
  return (
    Number(user?.id) === SYSTEM_ADMIN_ID &&
    String(user?.username || "").toLowerCase() === SYSTEM_ADMIN_USERNAME &&
    String(user?.role || "").toLowerCase() === "admin"
  );
}

async function getUserById(userId) {
  const [users] = await pool.query(
    `SELECT
      id,
      full_name,
      username,
      role,
      phone,
      is_active,
      created_at,
      updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  return users.length > 0 ? users[0] : null;
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
    { table: "purchase_payments", columns: ["received_by"] },
    { table: "purchases", columns: ["created_by"] },
    { table: "daily_closings", columns: ["closed_by"] },
    { table: "stock_adjustments", columns: ["adjusted_by", "approved_by"] },
    { table: "sms_log", columns: ["sent_by"] },
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
}

// GET /api/users
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT
        id,
        full_name,
        username,
        role,
        phone,
        is_active,
        created_at,
        updated_at
       FROM users
       ORDER BY created_at DESC`
    );

    return res.json({
      status: "success",
      count: users.length,
      users,
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
  try {
    const { full_name, username, password, role, phone } = req.body;

    const allowedRoles = ["admin", "manager", "cashier"];

    const cleanFullName = cleanText(full_name);
    const cleanUsername = cleanText(username);
    const cleanPhone = cleanText(phone);

    if (!cleanFullName || !cleanUsername || !password || !role) {
      return res.status(400).json({
        status: "error",
        message: "Full name, username, password and role are required.",
      });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        status: "error",
        message: "Role must be admin, manager, or cashier.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 6 characters.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users (
        full_name,
        username,
        password_hash,
        role,
        phone,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, TRUE)`,
      [cleanFullName, cleanUsername, passwordHash, role, cleanPhone || null]
    );

    await logActivity(
      req.user.id,
      "CREATE_USER",
      `Created user "${cleanUsername}" with role "${role}"`
    );

    const createdUser = await getUserById(result.insertId);

    return res.status(201).json({
      status: "success",
      message: "User created successfully.",
      user: createdUser,
    });
  } catch (error) {
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
  }
});

// PUT /api/users/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, username, role, phone, is_active, password } = req.body;

    const allowedRoles = ["admin", "manager", "cashier"];

    const cleanFullName = cleanText(full_name);
    const cleanUsername = cleanText(username);
    const cleanPhone = cleanText(phone);

    if (!cleanFullName || !cleanUsername || !role) {
      return res.status(400).json({
        status: "error",
        message: "Full name, username and role are required.",
      });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        status: "error",
        message: "Role must be admin, manager, or cashier.",
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

    if (password && password.trim() !== "") {
      if (password.length < 6) {
        return res.status(400).json({
          status: "error",
          message: "Password must be at least 6 characters.",
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      await pool.query(
        `UPDATE users
         SET full_name = ?,
             username = ?,
             role = ?,
             phone = ?,
             is_active = ?,
             password_hash = ?
         WHERE id = ?`,
        [
          cleanFullName,
          cleanUsername,
          role,
          cleanPhone || null,
          is_active === false ? false : true,
          passwordHash,
          id,
        ]
      );
    } else {
      await pool.query(
        `UPDATE users
         SET full_name = ?,
             username = ?,
             role = ?,
             phone = ?,
             is_active = ?
         WHERE id = ?`,
        [
          cleanFullName,
          cleanUsername,
          role,
          cleanPhone || null,
          is_active === false ? false : true,
          id,
        ]
      );
    }

    await logActivity(
      req.user.id,
      "UPDATE_USER",
      `Updated user "${cleanUsername}" with ID ${id}`
    );

    const updatedUser = await getUserById(id);

    return res.json({
      status: "success",
      message: "User updated successfully.",
      user: updatedUser,
    });
  } catch (error) {
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
  }
});

// PATCH /api/users/:id/reset-password
router.patch(
  "/:id/reset-password",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { password, confirm_password } = req.body;

      if (!password || !confirm_password) {
        return res.status(400).json({
          status: "error",
          message: "New password and confirm password are required.",
        });
      }

      if (String(password).length < 6) {
        return res.status(400).json({
          status: "error",
          message: "New password must be at least 6 characters long.",
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

      await pool.query(
        `UPDATE users
         SET password_hash = ?
         WHERE id = ?`,
        [passwordHash, id]
      );

      await logActivity(
        req.user.id,
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

      await pool.query(`UPDATE users SET is_active = ? WHERE id = ?`, [
        newStatus,
        id,
      ]);

      await logActivity(
        req.user.id,
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

    await connection.beginTransaction();

    await clearUserReferencesBeforeDelete(connection, targetUserId);

    await connection.query(`DELETE FROM users WHERE id = ?`, [targetUserId]);

    await connection.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`,
      [
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