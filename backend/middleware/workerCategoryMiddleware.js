const { pool } = require("../config/db");
const { normalizeCategory } = require("../services/categoryIsolationService");

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

const requireWorkerCategoryRecord = asyncHandler(async (req, res, next) => {
  const workspaceCode = normalizeCategory(req.user?.workspace_code);

  if (!workspaceCode) {
    return res.status(403).json({
      status: "error",
      code: "WORKER_CATEGORY_CONTEXT_REQUIRED",
      message: "Choose a valid business category before opening worker profiles.",
    });
  }

  // Mounted at /workers and /workers-expanded. The first remaining path segment
  // is a worker ID only for detail/child-record operations; lists and creates
  // continue and apply their own category filter.
  const match = String(req.path || "").match(/^\/(\d+)(?:\/|$)/);
  if (!match) {
    req.workerWorkspaceCode = workspaceCode;
    return next();
  }

  const workerId = Number(match[1]);
  const [rows] = await pool.query(
    `SELECT id, workspace_code
     FROM worker_profiles
     WHERE id = ?
     LIMIT 1`,
    [workerId]
  );

  const worker = rows[0];
  if (!worker) {
    return res.status(404).json({
      status: "error",
      message: "Worker profile not found.",
    });
  }

  if (!normalizeCategory(worker.workspace_code)) {
    return res.status(409).json({
      status: "error",
      code: "WORKER_CATEGORY_ASSIGNMENT_CONFLICT",
      message:
        "This worker profile has conflicting category assignments. The original System Administrator must resolve it before the profile can be opened.",
    });
  }

  if (normalizeCategory(worker.workspace_code) !== workspaceCode) {
    return res.status(404).json({
      status: "error",
      code: "WORKER_CATEGORY_ACCESS_DENIED",
      message: "Worker profile not found in this business category.",
    });
  }

  req.workerWorkspaceCode = workspaceCode;
  req.workerCategoryRecord = worker;
  return next();
});

module.exports = { requireWorkerCategoryRecord };
