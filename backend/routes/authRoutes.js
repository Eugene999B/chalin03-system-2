const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function cleanNumber(value, fallback = null) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }

  return number;
}

function createToken(user, branch) {
  return jwt.sign(
    {
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      role: user.role,
      branch_id: branch?.id || null,
      branch_code: branch?.branch_code || null,
      branch_name: branch?.name || null,
      branch_location: branch?.location || null,
      can_access_all_branches: Boolean(user.can_access_all_branches),
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
}

async function getBranchById(branchId) {
  if (!branchId) {
    return null;
  }

  const [branches] = await pool.query(
    `SELECT
      id,
      branch_code,
      name,
      location,
      phone,
      is_head_office,
      is_active
     FROM branches
     WHERE id = ?
     AND is_active = TRUE
     LIMIT 1`,
    [branchId]
  );

  return branches.length > 0 ? branches[0] : null;
}

async function getDefaultBranchForUser(user) {
  const defaultBranchId = cleanNumber(user.default_branch_id, 1);
  const defaultBranch = await getBranchById(defaultBranchId);

  if (defaultBranch) {
    return defaultBranch;
  }

  return getBranchById(1);
}

async function userCanAccessBranch(user, branchId) {
  if (!branchId) {
    return false;
  }

  if (user.can_access_all_branches) {
    return true;
  }

  const [accessRows] = await pool.query(
    `SELECT user_id, branch_id
     FROM user_branch_access
     WHERE user_id = ?
     AND branch_id = ?
     LIMIT 1`,
    [user.id, branchId]
  );

  return accessRows.length > 0;
}

async function resolveLoginBranch(user, requestedBranchId) {
  const selectedBranchId =
    cleanNumber(requestedBranchId, null) ||
    cleanNumber(user.default_branch_id, null) ||
    1;

  const branch = await getBranchById(selectedBranchId);

  if (!branch) {
    return {
      ok: false,
      statusCode: 400,
      message: "Selected store was not found or is not active.",
      branch: null,
    };
  }

  const canAccess = await userCanAccessBranch(user, branch.id);

  if (!canAccess) {
    return {
      ok: false,
      statusCode: 403,
      message: "You are not allowed to login to the selected store.",
      branch: null,
    };
  }

  return {
    ok: true,
    statusCode: 200,
    message: "Store selected.",
    branch,
  };
}

function buildUserResponse(user, branch) {
  return {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    phone: user.phone,
    default_branch_id: user.default_branch_id,
    can_access_all_branches: Boolean(user.can_access_all_branches),
    branch_id: branch?.id || null,
    branch_code: branch?.branch_code || null,
    branch_name: branch?.name || null,
    branch_location: branch?.location || null,
    branch_phone: branch?.phone || null,
    selected_branch: branch
      ? {
          id: branch.id,
          branch_code: branch.branch_code,
          name: branch.name,
          location: branch.location,
          phone: branch.phone,
          is_head_office: Boolean(branch.is_head_office),
        }
      : null,
  };
}

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const username = cleanText(req.body.username);
    const password = req.body.password;
    const branchId = cleanNumber(req.body.branch_id, null);

    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message: "Username and password are required.",
      });
    }

    if (!branchId) {
      return res.status(400).json({
        status: "error",
        message: "Please choose a store before logging in.",
      });
    }

    const [users] = await pool.query(
      `SELECT
        id,
        full_name,
        username,
        password_hash,
        role,
        phone,
        default_branch_id,
        can_access_all_branches,
        is_active
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

    const branchResult = await resolveLoginBranch(user, branchId);

    if (!branchResult.ok) {
      return res.status(branchResult.statusCode).json({
        status: "error",
        message: branchResult.message,
      });
    }

    const selectedBranch = branchResult.branch;
    const token = createToken(user, selectedBranch);

    await pool.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [
        selectedBranch.id,
        user.id,
        "LOGIN",
        `${user.username} logged in successfully to ${selectedBranch.name}`,
      ]
    );

    return res.json({
      status: "success",
      message: "Login successful.",
      token,
      user: buildUserResponse(user, selectedBranch),
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
      `SELECT
        id,
        full_name,
        username,
        role,
        phone,
        default_branch_id,
        can_access_all_branches,
        is_active,
        created_at
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

    const user = users[0];

    let selectedBranch = null;

    if (req.user.branch_id) {
      selectedBranch = await getBranchById(req.user.branch_id);
    }

    if (!selectedBranch) {
      selectedBranch = await getDefaultBranchForUser(user);
    }

    return res.json({
      status: "success",
      user: buildUserResponse(user, selectedBranch),
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
        message:
          "Current password, new password and confirm password are required.",
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
      `SELECT
        id,
        full_name,
        username,
        password_hash,
        role,
        phone,
        default_branch_id,
        can_access_all_branches,
        is_active
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

    const selectedBranch =
      (await getBranchById(req.user.branch_id)) ||
      (await getDefaultBranchForUser(user));

    await pool.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [
        selectedBranch?.id || null,
        user.id,
        "CHANGE_PASSWORD",
        `${user.username} changed account password`,
      ]
    );

    const token = createToken(user, selectedBranch);

    return res.json({
      status: "success",
      message: "Password changed successfully.",
      token,
      user: buildUserResponse(user, selectedBranch),
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
    const username = cleanText(req.body.username);

    if (username) {
      const [users] = await pool.query(
        `SELECT id, username, default_branch_id
         FROM users
         WHERE username = ?
         LIMIT 1`,
        [username]
      );

      if (users.length > 0) {
        await pool.query(
          `INSERT INTO activity_log (branch_id, user_id, action, details)
           VALUES (?, ?, ?, ?)`,
          [
            users[0].default_branch_id || null,
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