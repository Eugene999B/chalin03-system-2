const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

// GET /api/activity-log
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { search, action, from, to } = req.query;

    const params = [];
    let whereClause = "WHERE 1 = 1";

    if (search) {
      whereClause += ` AND (
        al.action LIKE ?
        OR al.details LIKE ?
        OR u.full_name LIKE ?
        OR u.username LIKE ?
      )`;

      const searchValue = `%${search}%`;
      params.push(searchValue, searchValue, searchValue, searchValue);
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
        al.user_id,
        al.action,
        al.details,
        al.created_at,
        u.full_name,
        u.username,
        u.role
       FROM activity_log al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT 300`,
      params
    );

    const [summaryRows] = await pool.query(
      `SELECT
        COUNT(*) AS total_logs,
        COUNT(DISTINCT user_id) AS active_users
       FROM activity_log al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}`,
      params
    );

    const [actions] = await pool.query(
      `SELECT
        action,
        COUNT(*) AS count
       FROM activity_log
       GROUP BY action
       ORDER BY action ASC`
    );

    return res.json({
      status: "success",
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