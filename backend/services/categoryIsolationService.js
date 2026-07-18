const { pool } = require("../config/db");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

const CATEGORY_CODES = Object.freeze([
  "spare_parts",
  "mining",
  "equipment_hire",
]);

const CATEGORY_LABELS = Object.freeze({
  spare_parts: "Spare Parts",
  mining: "Mining Operations",
  equipment_hire: "Equipment Hire",
});

function normalizeCategory(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (cleaned === "hire" || cleaned === "equipment") {
    return "equipment_hire";
  }

  return CATEGORY_CODES.includes(cleaned) ? cleaned : null;
}

function categoryLabel(value) {
  return CATEGORY_LABELS[normalizeCategory(value)] || "business category";
}

async function loadUserCategoryState(user, connection = pool) {
  if (!user?.id) {
    return {
      primary_workspace_code: null,
      category_assignment_status: "unassigned",
      conflict_reason: null,
      is_system_administrator: false,
    };
  }

  if (isOriginalSystemAdministrator(user)) {
    return {
      primary_workspace_code: "*",
      category_assignment_status: "system_admin",
      conflict_reason: null,
      is_system_administrator: true,
    };
  }

  try {
    const [rows] = await connection.query(
      `SELECT
         primary_workspace_code,
         category_assignment_status,
         category_conflict_reason
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [user.id]
    );

    const row = rows[0] || {};
    return {
      primary_workspace_code: normalizeCategory(row.primary_workspace_code),
      category_assignment_status:
        String(row.category_assignment_status || "unassigned").trim().toLowerCase(),
      conflict_reason: row.category_conflict_reason || null,
      is_system_administrator: false,
    };
  } catch (error) {
    if (error.code !== "ER_BAD_FIELD_ERROR") {
      throw error;
    }

    // Compatibility before the additive Release 3F-C2 migration is installed.
    const [rows] = await connection.query(
      `SELECT bu.code
       FROM user_business_access uba
       INNER JOIN business_units bu ON bu.id = uba.business_unit_id
       WHERE uba.user_id = ?
         AND uba.can_access = TRUE
         AND bu.code IN ('mining', 'equipment_hire')
       ORDER BY bu.display_order, bu.code`,
      [user.id]
    );

    if (rows.length > 1) {
      return {
        primary_workspace_code: null,
        category_assignment_status: "conflict_review",
        conflict_reason: "Multiple active business categories require review.",
        is_system_administrator: false,
      };
    }

    return {
      primary_workspace_code: rows[0]?.code || "spare_parts",
      category_assignment_status: "assigned",
      conflict_reason: null,
      is_system_administrator: false,
    };
  }
}

async function validateUserCategoryAccess({
  user,
  workspaceCode,
  connection = pool,
}) {
  const requested = normalizeCategory(workspaceCode);

  if (!requested) {
    return {
      ok: false,
      statusCode: 400,
      code: "INVALID_BUSINESS_CATEGORY",
      message: "Choose a valid business category.",
    };
  }

  const state = await loadUserCategoryState(user, connection);

  if (state.is_system_administrator) {
    return { ok: true, state, workspaceCode: requested };
  }

  if (
    state.category_assignment_status === "conflict_review" ||
    !state.primary_workspace_code
  ) {
    return {
      ok: false,
      statusCode: 409,
      code: "CATEGORY_ASSIGNMENT_CONFLICT",
      message:
        "This account has conflicting business-category assignments. The System Administrator must choose one category in User Permission Manager before login can continue.",
      state,
    };
  }

  if (state.primary_workspace_code !== requested) {
    return {
      ok: false,
      statusCode: 403,
      code: "CATEGORY_ACCESS_DENIED",
      message: `This worker account belongs to ${categoryLabel(
        state.primary_workspace_code
      )} and cannot open ${categoryLabel(requested)}.`,
      state,
    };
  }

  if (requested !== "spare_parts") {
    const [rows] = await connection.query(
      `SELECT uba.access_role
       FROM user_business_access uba
       INNER JOIN business_units bu ON bu.id = uba.business_unit_id
       WHERE uba.user_id = ?
         AND bu.code = ?
         AND uba.can_access = TRUE
       LIMIT 1`,
      [user.id, requested]
    );

    if (!rows.length) {
      return {
        ok: false,
        statusCode: 403,
        code: "CATEGORY_ACCESS_NOT_ASSIGNED",
        message: `This account has not been assigned to ${categoryLabel(requested)}.`,
        state,
      };
    }

    return {
      ok: true,
      state,
      workspaceCode: requested,
      workspaceRole: rows[0].access_role || null,
    };
  }

  return {
    ok: true,
    state,
    workspaceCode: requested,
    workspaceRole: String(user.role || "staff").trim().toLowerCase(),
  };
}

async function getBusinessUnitId(workspaceCode, connection = pool) {
  const code = normalizeCategory(workspaceCode);
  if (!code || code === "spare_parts") return null;

  const [rows] = await connection.query(
    `SELECT id
     FROM business_units
     WHERE code = ?
     LIMIT 1`,
    [code]
  );

  return rows[0]?.id || null;
}

function requireWorkspaceCategory(...allowedWorkspaceCodes) {
  const allowed = new Set(
    allowedWorkspaceCodes.map(normalizeCategory).filter(Boolean)
  );

  return function categoryBoundary(req, res, next) {
    if (isOriginalSystemAdministrator(req.user)) {
      return next();
    }

    const activeWorkspace = normalizeCategory(req.user?.workspace_code);

    if (!activeWorkspace || !allowed.has(activeWorkspace)) {
      return res.status(403).json({
        status: "error",
        code: "WORKSPACE_BOUNDARY_VIOLATION",
        message:
          "This API belongs to a different independent business category. Switch business and login to the correct category.",
      });
    }

    return next();
  };
}

async function revokeUserSessions(connection, userId, reason) {
  await connection.query(
    `UPDATE users
     SET token_version = COALESCE(token_version, 0) + 1
     WHERE id = ?`,
    [userId]
  );

  const [result] = await connection.query(
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, NOW()),
         revocation_reason = COALESCE(revocation_reason, ?)
     WHERE user_id = ?
       AND revoked_at IS NULL`,
    [reason, userId]
  );

  return Number(result.affectedRows || 0);
}

module.exports = {
  CATEGORY_CODES,
  CATEGORY_LABELS,
  categoryLabel,
  getBusinessUnitId,
  loadUserCategoryState,
  normalizeCategory,
  requireWorkspaceCategory,
  revokeUserSessions,
  validateUserCategoryAccess,
};
