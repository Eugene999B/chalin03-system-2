const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

// GET /api/activity-log
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const branchId = getBranchId(req);

    const search = cleanText(req.query.search);
    const action = cleanText(req.query.action);
    const from = cleanText(req.query.from);
    const to = cleanText(req.query.to);

    const params = [branchId];
    let whereClause = "WHERE al.branch_id = ?";

    if (search) {
      whereClause += ` AND (
        al.action LIKE ?
        OR al.details LIKE ?
        OR u.full_name LIKE ?
        OR u.username LIKE ?
        OR b.name LIKE ?
        OR b.location LIKE ?
      )`;

      const searchValue = `%${search}%`;
      params.push(
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue
      );
    }

    if (action) {
      whereClause += ` AND al.action = ?`;
      params.push(action);
    }

    if (from) {
      whereClause += ` AND DATE(al.created_at) >= ?`;
      params.push(from);
    }

    if (to) {
      whereClause += ` AND DATE(al.created_at) <= ?`;
      params.push(to);
    }

    const [logs] = await pool.query(
      `SELECT
        al.id,
        al.branch_id,
        al.user_id,
        al.action,
        al.details,
        al.created_at,
        u.full_name,
        u.username,
        u.role,
        b.name AS branch_name,
        b.location AS branch_location
       FROM activity_log al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN branches b ON al.branch_id = b.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT 300`,
      params
    );

    const [summaryRows] = await pool.query(
      `SELECT
        COUNT(*) AS total_logs,
        COUNT(DISTINCT al.user_id) AS active_users
       FROM activity_log al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN branches b ON al.branch_id = b.id
       ${whereClause}`,
      params
    );

    const [actions] = await pool.query(
      `SELECT
        action,
        COUNT(*) AS count
       FROM activity_log
       WHERE branch_id = ?
       GROUP BY action
       ORDER BY action ASC`,
      [branchId]
    );

    return res.json({
      status: "success",
      branch_id: branchId,
      count: logs.length,
      summary: {
        total_logs: Number(summaryRows[0].total_logs || 0),
        active_users: Number(summaryRows[0].active_users || 0),
      },
      actions,
      logs,
    });
  } catch (error) {
    console.error("Get activity log error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching activity log.",
    });
  }
});

module.exports = router;
