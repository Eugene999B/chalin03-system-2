const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

function getUserId(req) {
  return Number(req.user?.id || req.user?.user_id || 0);
}

function getUserRole(req) {
  return String(req.user?.role || "").toLowerCase();
}

function isAdmin(req) {
  return getUserRole(req) === "admin";
}

// PUBLIC: used on login page before user logs in
// GET /api/branches/public
router.get("/public", async (req, res) => {
  try {
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
       WHERE is_active = TRUE
       ORDER BY is_head_office DESC, id ASC`
    );

    return res.json({
      status: "success",
      count: branches.length,
      branches,
    });
  } catch (error) {
    console.error("Get public branches error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while loading stores.",
    });
  }
});

// PRIVATE: branches current user can access
// GET /api/branches/my-branches
router.get("/my-branches", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);

    const [userRows] = await pool.query(
      `SELECT id, can_access_all_branches
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    let branches = [];

    if (userRows[0].can_access_all_branches) {
      const [allBranches] = await pool.query(
        `SELECT
          id,
          branch_code,
          name,
          location,
          phone,
          is_head_office,
          is_active
         FROM branches
         WHERE is_active = TRUE
         ORDER BY is_head_office DESC, id ASC`
      );

      branches = allBranches;
    } else {
      const [allowedBranches] = await pool.query(
        `SELECT
          b.id,
          b.branch_code,
          b.name,
          b.location,
          b.phone,
          b.is_head_office,
          b.is_active,
          uba.is_primary,
          uba.access_role
         FROM user_branch_access uba
         JOIN branches b ON uba.branch_id = b.id
         WHERE uba.user_id = ?
         AND b.is_active = TRUE
         ORDER BY uba.is_primary DESC, b.id ASC`,
        [userId]
      );

      branches = allowedBranches;
    }

    return res.json({
      status: "success",
      count: branches.length,
      branches,
    });
  } catch (error) {
    console.error("Get my branches error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while loading your stores.",
    });
  }
});

// ADMIN ONLY: create future stores easily
// POST /api/branches
router.post("/", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({
        status: "error",
        message: "Only admin can create stores.",
      });
    }

    const branchCode = String(req.body.branch_code || "").trim().toUpperCase();
    const name = String(req.body.name || "").trim();
    const location = String(req.body.location || "").trim();
    const phone = String(req.body.phone || "").trim();
    const managerName = String(req.body.manager_name || "").trim();

    if (!branchCode || !name) {
      return res.status(400).json({
        status: "error",
        message: "Store code and store name are required.",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO branches (
        branch_code,
        name,
        location,
        phone,
        manager_name,
        is_head_office,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, FALSE, TRUE)`,
      [branchCode, name, location || null, phone || null, managerName || null]
    );

    await pool.query(
      `INSERT INTO settings (
        branch_id,
        business_name,
        branch_name,
        business_address,
        business_phone,
        owner_phone,
        receipt_prefix,
        tax_rate,
        debt_reminder_days,
        daily_summary_time,
        receipt_footer
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, 7, '18:00:00', 'Thank You For Coming')`,
      [
        result.insertId,
        "Chalin 03 Company Limited",
        name,
        location || "",
        phone || "0249469080 / 0249995510",
        "0543421127",
        `CHL-${branchCode.slice(0, 6)}`,
      ]
    );

    return res.status(201).json({
      status: "success",
      message: "Store created successfully.",
      branch: {
        id: result.insertId,
        branch_code: branchCode,
        name,
        location,
        phone,
        manager_name: managerName,
      },
    });
  } catch (error) {
    console.error("Create branch error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        status: "error",
        message: "A store with this code already exists.",
      });
    }

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while creating store.",
    });
  }
});

module.exports = router;