const { pool } = require("../config/db");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function selectedBranchId(req) {
  return (
    positiveId(req.user?.branch_id) ||
    positiveId(req.user?.selected_branch_id) ||
    positiveId(req.user?.selected_branch?.id) ||
    positiveId(req.headers?.["x-chalin03-branch-id"]) ||
    positiveId(req.headers?.["x-branch-id"])
  );
}

async function userCanAccessBranch(req, branchId) {
  if (isOriginalSystemAdministrator(req.user)) return true;

  const [rows] = await pool.query(
    `SELECT
       u.id,
       u.default_branch_id,
       u.can_access_all_branches,
       EXISTS (
         SELECT 1
         FROM user_branch_access uba
         WHERE uba.user_id = u.id
           AND uba.branch_id = ?
           AND uba.can_access = TRUE
       ) AS has_explicit_access
     FROM users u
     WHERE u.id = ?
       AND u.is_active = TRUE
     LIMIT 1`,
    [branchId, req.user?.id]
  );

  const user = rows[0];
  if (!user) return false;

  return (
    Number(user.can_access_all_branches || 0) === 1 ||
    Number(user.default_branch_id || 0) === Number(branchId) ||
    Number(user.has_explicit_access || 0) === 1
  );
}

async function requireSparePartsBranchContext(req, res, next) {
  try {
    const branchId = selectedBranchId(req);

    if (!branchId) {
      return res.status(400).json({
        status: "error",
        code: "STORE_CONTEXT_REQUIRED",
        message:
          "No active Spare Parts store is selected. Logout, choose the correct store and login again before continuing.",
      });
    }

    const [[branchRows], canAccess] = await Promise.all([
      pool.query(
        `SELECT id, code, branch_code, name, location, is_active
         FROM branches
         WHERE id = ?
         LIMIT 1`,
        [branchId]
      ),
      userCanAccessBranch(req, branchId),
    ]);

    const branch = branchRows[0];
    if (!branch || Number(branch.is_active || 0) !== 1) {
      return res.status(400).json({
        status: "error",
        code: "STORE_CONTEXT_INVALID",
        message: "The selected Spare Parts store is missing or inactive.",
      });
    }

    if (!canAccess) {
      return res.status(403).json({
        status: "error",
        code: "STORE_ACCESS_DENIED",
        message: "Your account is not authorised for the selected Spare Parts store.",
      });
    }

    req.user.branch_id = branchId;
    req.user.branch_code = branch.branch_code || branch.code || null;
    req.user.branch_name = branch.name || null;
    req.user.branch_location = branch.location || null;
    req.sparePartsBranch = branch;

    return next();
  } catch (error) {
    console.error("Spare Parts store-context validation failed:", error);
    return res.status(500).json({
      status: "error",
      code: "STORE_CONTEXT_CHECK_FAILED",
      message: "The selected Spare Parts store could not be verified safely.",
    });
  }
}

module.exports = {
  requireSparePartsBranchContext,
  selectedBranchId,
  userCanAccessBranch,
};
