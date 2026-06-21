const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

async function logActivity(userId, action, details) {
  await pool.query(
    `INSERT INTO activity_log (user_id, action, details)
     VALUES (?, ?, ?)`,
    [userId || null, action, details]
  );
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

    if (!full_name || !username || !password || !role) {
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
      [full_name, username, passwordHash, role, phone || null]
    );

    await logActivity(
      req.user.id,
      "CREATE_USER",
      `Created user "${username}" with role "${role}"`
    );

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
      [result.insertId]
    );

    return res.status(201).json({
      status: "success",
      message: "User created successfully.",
      user: users[0],
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

    if (!full_name || !username || !role) {
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

    const [existingUsers] = await pool.query(
      `SELECT id, username FROM users WHERE id = ? LIMIT 1`,
      [id]
    );

    if (existingUsers.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
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
          full_name,
          username,
          role,
          phone || null,
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
          full_name,
          username,
          role,
          phone || null,
          is_active === false ? false : true,
          id,
        ]
      );
    }

    await logActivity(
      req.user.id,
      "UPDATE_USER",
      `Updated user "${username}" with ID ${id}`
    );

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
      [id]
    );

    return res.json({
      status: "success",
      message: "User updated successfully.",
      user: users[0],
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

      const [users] = await pool.query(
        `SELECT id, username, is_active
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [id]
      );

      if (users.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "User not found.",
        });
      }

      const user = users[0];
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

module.exports = router;