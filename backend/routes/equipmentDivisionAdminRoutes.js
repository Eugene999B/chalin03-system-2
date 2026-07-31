const express = require("express");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("../services/auditTrailService");
const { revokeUserSessions } = require("../services/categoryIsolationService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  EQUIPMENT_DIVISIONS,
  DUAL_DIVISION_ROLES,
  HIRE_WORKSPACE_ROLES,
  FINANCE_WORKSPACE_ROLES,
} = require("../security/equipmentDivisionAccess");

const router = express.Router();
const HIRE_ROLES = new Set(HIRE_WORKSPACE_ROLES);
const FINANCE_ROLES = new Set(FINANCE_WORKSPACE_ROLES);
const DUAL_ROLES = new Set(DUAL_DIVISION_ROLES);
const ALL_DIVISION_ROLES = new Set([...HIRE_ROLES, ...FINANCE_ROLES]);

function normalized(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function divisionForRole(role) {
  if (DUAL_ROLES.has(role)) return EQUIPMENT_DIVISIONS.BOTH;
  if (HIRE_ROLES.has(role)) return EQUIPMENT_DIVISIONS.HIRE;
  if (FINANCE_ROLES.has(role)) return EQUIPMENT_DIVISIONS.FINANCE;
  return null;
}

function globalRoleForDivisionRole(role, currentRole) {
  if (normalized(currentRole) === "admin") return "admin";
  if (["manager", "finance_manager", "equipment_business_manager"].includes(role)) {
    return "manager";
  }
  if (["auditor", "finance_auditor", "equipment_business_auditor"].includes(role)) {
    return "auditor";
  }
  return "staff";
}

function divisionLabel(division) {
  if (division === EQUIPMENT_DIVISIONS.BOTH) return "Equipment Hire and Installment Finance";
  return division === EQUIPMENT_DIVISIONS.HIRE
    ? "Equipment Hire"
    : "Installment Finance";
}

function requireSystemAdministrator(req, res, next) {
  if (!isOriginalSystemAdministrator(req.user)) {
    return res.status(403).json({
      status: "error",
      code: "EQUIPMENT_DIVISION_ADMIN_REQUIRED",
      message:
        "Only the protected System Administrator can assign Equipment Hire, Installment Finance or approved dual-division roles.",
    });
  }
  return next();
}

router.use(requireSystemAdministrator);

router.get("/staff", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.username,
         u.phone,
         u.role AS global_role,
         u.is_active,
         u.must_change_password,
         uba.access_role AS workspace_role,
         uba.can_access,
         uba.updated_at AS division_updated_at
       FROM users u
       INNER JOIN business_units bu
         ON bu.code = 'equipment_hire'
        AND bu.is_enabled = TRUE
       LEFT JOIN user_business_access uba
         ON uba.user_id = u.id
        AND uba.business_unit_id = bu.id
       WHERE u.primary_workspace_code = 'equipment_hire'
         AND u.category_assignment_status = 'assigned'
         AND NOT (u.id = ? AND u.username = ? AND u.role = 'admin')
       ORDER BY u.is_active DESC, u.full_name, u.username`,
      [
        Number(process.env.SYSTEM_ADMIN_USER_ID || 1),
        String(process.env.SYSTEM_ADMIN_USERNAME || "admin").trim(),
      ]
    );

    const staff = rows.map((row) => {
      const role = normalized(row.workspace_role);
      return {
        ...row,
        workspace_role: role || null,
        division: divisionForRole(role),
        can_access: Boolean(row.can_access),
        is_active: Boolean(row.is_active),
        must_change_password: Boolean(row.must_change_password),
      };
    });

    return res.json({
      status: "success",
      staff,
      roles: {
        hire: [...HIRE_ROLES].filter((role) => !DUAL_ROLES.has(role)),
        finance: [...FINANCE_ROLES].filter((role) => !DUAL_ROLES.has(role)),
        both: [...DUAL_ROLES],
      },
      policy: {
        authorised_dual_staff_may_access_both: true,
        system_administrator_may_supervise_both: true,
        action_permissions_remain_separate: true,
        shared_machine_register_write_roles: [
          "finance_manager",
          "equipment_business_manager",
          "equipment_business_accountant",
        ],
      },
    });
  } catch (error) {
    console.error("Equipment division staff list failed:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load Equipment division staff assignments.",
    });
  }
});

router.put("/staff/:userId", async (req, res) => {
  const targetUserId = positiveId(req.params.userId);
  const workspaceRole = normalized(req.body?.workspace_role || req.body?.role);
  const requestedDivision = normalized(req.body?.division);
  const roleDivision = divisionForRole(workspaceRole);

  if (!targetUserId || !ALL_DIVISION_ROLES.has(workspaceRole) || !roleDivision) {
    return res.status(400).json({
      status: "error",
      message: "Choose a valid Hire, Finance or approved dual Equipment Business role.",
    });
  }

  if (requestedDivision && requestedDivision !== roleDivision) {
    return res.status(400).json({
      status: "error",
      message: "The selected role does not belong to the selected Equipment division scope.",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [users] = await connection.query(
      `SELECT
         id, full_name, username, role, is_active,
         primary_workspace_code, category_assignment_status
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [targetUserId]
    );
    const user = users[0];
    if (!user) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Staff account not found." });
    }
    if (isOriginalSystemAdministrator(user)) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "The protected System Administrator supervises both divisions and cannot be reassigned.",
      });
    }
    if (
      normalized(user.primary_workspace_code) !== "equipment_hire" ||
      normalized(user.category_assignment_status) !== "assigned"
    ) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "This account does not belong to the Equipment Business category.",
      });
    }

    const [businessUnits] = await connection.query(
      `SELECT id
       FROM business_units
       WHERE code = 'equipment_hire' AND is_enabled = TRUE
       LIMIT 1`
    );
    const businessUnitId = Number(businessUnits[0]?.id || 0);
    if (!businessUnitId) throw new Error("Equipment Business unit is not enabled.");

    const [beforeRows] = await connection.query(
      `SELECT access_role, can_access
       FROM user_business_access
       WHERE user_id = ? AND business_unit_id = ?
       LIMIT 1`,
      [targetUserId, businessUnitId]
    );
    const beforeRole = normalized(beforeRows[0]?.access_role);
    const beforeDivision = divisionForRole(beforeRole);
    const nextGlobalRole = globalRoleForDivisionRole(workspaceRole, user.role);

    await connection.query(
      `UPDATE users
       SET role = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextGlobalRole, targetUserId]
    );
    await connection.query(
      `INSERT INTO user_business_access (
         user_id, business_unit_id, access_role, can_access, is_default, created_by
       ) VALUES (?, ?, ?, TRUE, FALSE, ?)
       ON DUPLICATE KEY UPDATE
         access_role = VALUES(access_role),
         can_access = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [targetUserId, businessUnitId, workspaceRole, req.user.id]
    );

    const revokedSessions = await revokeUserSessions(
      connection,
      targetUserId,
      `Equipment assignment changed to ${roleDivision}`
    );

    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_STAFF_DIVISION_ASSIGNED",
      actionType: "equipment.staff.division.assign",
      entityType: "user",
      entityId: targetUserId,
      workspaceCode: "equipment_hire",
      severity: "critical",
      outcome: "success",
      details: `${user.full_name || user.username} was assigned as ${workspaceRole} for ${divisionLabel(roleDivision)}.`,
      metadata: {
        before_role: beforeRole || null,
        before_division: beforeDivision,
        after_role: workspaceRole,
        after_division: roleDivision,
        revoked_sessions: revokedSessions,
        authorised_dual_staff_may_access_both: true,
      },
    });

    await connection.commit();

    return res.json({
      status: "success",
      message: `${user.full_name || user.username} can now access ${divisionLabel(roleDivision)} under the ${workspaceRole.replaceAll("_", " ")} role. Existing sessions were revoked so the new permissions apply at the next login.`,
      assignment: {
        user_id: targetUserId,
        division: roleDivision,
        workspace_role: workspaceRole,
        global_role: nextGlobalRole,
        revoked_sessions: revokedSessions,
      },
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    console.error("Equipment division staff assignment failed:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not update the Equipment staff division assignment.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
