const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
}

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message: "Username and password are required.",
      });
    }

    const [users] = await pool.query(
      `SELECT id, full_name, username, password_hash, role, phone, is_active
       FROM users
       WHERE username = ?
       LIMIT 1`,
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({
        status: "error",
        message: "Invalid username or password.",
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({
        status: "error",
        message: "This account has been disabled.",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({
        status: "error",
        message: "Invalid username or password.",
      });
    }

    const token = createToken(user);

    await pool.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`,
      [user.id, "LOGIN", `${user.username} logged in successfully`]
    );

    return res.json({
      status: "success",
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        role: user.role,
        phone: user.phone,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while logging in.",
    });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT id, full_name, username, role, phone, is_active, created_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    return res.json({
      status: "success",
      user: users[0],
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
        message: "Current password, new password and confirm password are required.",
      });
    }

    if (String(new_password).length < 6) {
      return res.status(400).json({
        status: "error",
        message: "New password must be at least 6 characters long.",
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        status: "error",
        message: "New password and confirm password do not match.",
      });
    }

    const [users] = await pool.query(
      `SELECT id, full_name, username, password_hash, role, phone, is_active
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "User account not found.",
      });
    }

    const user = users[0];

    if (!user.is_active) {
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

    await pool.query(
      `UPDATE users
       SET password_hash = ?
       WHERE id = ?`,
      [newPasswordHash, user.id]
    );

    await pool.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`,
      [user.id, "CHANGE_PASSWORD", `${user.username} changed account password`]
    );

    const token = createToken(user);

    return res.json({
      status: "success",
      message: "Password changed successfully.",
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        role: user.role,
        phone: user.phone,
      },
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
router.post("/forgot-password", async (req, res) => {
  try {
    const { username } = req.body;

    if (username) {
      const [users] = await pool.query(
        `SELECT id, username
         FROM users
         WHERE username = ?
         LIMIT 1`,
        [username]
      );

      if (users.length > 0) {
        await pool.query(
          `INSERT INTO activity_log (user_id, action, details)
           VALUES (?, ?, ?)`,
          [
            users[0].id,
            "FORGOT_PASSWORD_REQUEST",
            `${users[0].username} requested password reset help`,
          ]
        );
      }
    }

    return res.json({
      status: "success",
      message:
        "Please contact the admin to reset your password. After admin resets it, login and change it from your account.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while requesting password reset help.",
    });
  }
});

module.exports = router;