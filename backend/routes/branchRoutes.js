const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  BranchSchemaReadinessError,
  assertBranchSchemaReady,
} = require("../services/branchSchemaReadinessService");

const router = express.Router();

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function cleanBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return value === true || value === 1 || value === "1" || value === "true";
}

function sendBranchError(res, error, fallbackMessage) {
  if (error instanceof BranchSchemaReadinessError) {
    return res.status(503).json({
      status: "error",
      code: error.code,
      message:
        "Store information is temporarily unavailable because the approved database schema is not ready.",
    });
  }

  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      status: "error",
      code: "DUPLICATE_BRANCH_CODE",
      message: "This store code already exists.",
    });
  }

  return res.status(500).json({
    status: "error",
    message: fallbackMessage,
  });
}

function normalizeBranch(row) {
  const code = row.code || row.branch_code || "";

  return {
    id: row.id,
    code,
    branch_code: code,
    name: row.name,
    branch_name: row.name,
    location: row.location || "",
    branch_location: row.location || "",
    phone: row.phone || "",
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getBranches({ includeInactive = false } = {}) {
  await assertBranchSchemaReady(pool);

  const whereClause = includeInactive ? "" : "WHERE is_active = TRUE";

  const [branches] = await pool.query(
    `SELECT
       id,
       code,
       branch_code,
       name,
       location,
       phone,
       is_active,
       created_at,
       updated_at
     FROM branches
     ${whereClause}
     ORDER BY name ASC, id ASC`
  );

  return branches.map(normalizeBranch);
}

// GET /api/branches/public
// Public because the login page must load stores before the user has a token.
// This route is deliberately read-only: database migrations must be applied by
// the controlled deployment process, never by an unauthenticated request.
router.get("/public", async (_req, res) => {
  try {
    const branches = await getBranches({ includeInactive: false });

    return res.json({
      status: "success",
      count: branches.length,
      branches,
      stores: branches,
    });
  } catch (error) {
    console.error("Get public branches error:", {
      code: error?.code,
      message: error?.message,
      missing_columns: error?.missingColumns,
    });

    return sendBranchError(
      res,
      error,
      "Something went wrong while loading stores."
    );
  }
});

// GET /api/branches
router.get("/", requireAuth, async (req, res) => {
  try {
    const includeInactive =
      String(req.query.include_inactive || "").toLowerCase() === "true" &&
      String(req.user?.role || "").toLowerCase() === "admin";

    const branches = await getBranches({ includeInactive });

    return res.json({
      status: "success",
      count: branches.length,
      branches,
      stores: branches,
    });
  } catch (error) {
    console.error("Get branches error:", {
      code: error?.code,
      message: error?.message,
      missing_columns: error?.missingColumns,
    });

    return sendBranchError(
      res,
      error,
      "Something went wrong while loading stores."
    );
  }
});

// POST /api/branches
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await assertBranchSchemaReady(pool);

    const code = cleanText(req.body.code || req.body.branch_code)
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 30);

    const name = cleanText(req.body.name || req.body.branch_name);
    const location = cleanText(req.body.location || req.body.branch_location);
    const phone = cleanText(req.body.phone);
    const isActive = cleanBoolean(req.body.is_active, true);

    if (!code || !name) {
      return res.status(400).json({
        status: "error",
        message: "Store code and store name are required.",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO branches (code, branch_code, name, location, phone, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, code, name, location || null, phone || null, isActive ? 1 : 0]
    );

    const [rows] = await pool.query(
      `SELECT
         id,
         code,
         branch_code,
         name,
         location,
         phone,
         is_active,
         created_at,
         updated_at
       FROM branches
       WHERE id = ?
       LIMIT 1`,
      [result.insertId]
    );

    return res.status(201).json({
      status: "success",
      message: "Store created successfully.",
      branch: normalizeBranch(rows[0]),
    });
  } catch (error) {
    console.error("Create branch error:", {
      code: error?.code,
      message: error?.message,
      missing_columns: error?.missingColumns,
    });

    return sendBranchError(
      res,
      error,
      "Something went wrong while creating store."
    );
  }
});

// PUT /api/branches/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await assertBranchSchemaReady(pool);

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid store ID.",
      });
    }

    const code = cleanText(req.body.code || req.body.branch_code)
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 30);

    const name = cleanText(req.body.name || req.body.branch_name);
    const location = cleanText(req.body.location || req.body.branch_location);
    const phone = cleanText(req.body.phone);
    const isActive = cleanBoolean(req.body.is_active, true);

    if (!code || !name) {
      return res.status(400).json({
        status: "error",
        message: "Store code and store name are required.",
      });
    }

    const [result] = await pool.query(
      `UPDATE branches
       SET
         code = ?,
         branch_code = ?,
         name = ?,
         location = ?,
         phone = ?,
         is_active = ?
       WHERE id = ?`,
      [code, code, name, location || null, phone || null, isActive ? 1 : 0, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: "error",
        message: "Store not found.",
      });
    }

    const [rows] = await pool.query(
      `SELECT
         id,
         code,
         branch_code,
         name,
         location,
         phone,
         is_active,
         created_at,
         updated_at
       FROM branches
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    return res.json({
      status: "success",
      message: "Store updated successfully.",
      branch: normalizeBranch(rows[0]),
    });
  } catch (error) {
    console.error("Update branch error:", {
      code: error?.code,
      message: error?.message,
      missing_columns: error?.missingColumns,
    });

    return sendBranchError(
      res,
      error,
      "Something went wrong while updating store."
    );
  }
});

module.exports = router;
