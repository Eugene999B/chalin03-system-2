const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("../services/auditTrailService");
const { revokeUserSessions } = require("../services/categoryIsolationService");
const { normalizedPhoneForStorage } = require("../services/loginIdentityService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  EQUIPMENT_DIVISIONS,
  divisionForEquipmentRole,
  globalRoleForEquipmentRole,
  normalizeRole,
  publicEquipmentRoleTemplates,
  roleTemplate,
} = require("../security/equipmentBusinessRoleTemplates");

const router = express.Router();
const ROLE_TEMPLATES = publicEquipmentRoleTemplates();
const ROLE_CODES = new Set(ROLE_TEMPLATES.map((item) => item.code));

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  return cleanText(value, maxLength) || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function uniquePositiveIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(positiveId).filter(Boolean))];
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return [true, 1, "1", "true", "yes", "on"].includes(value);
}

function strongPasswordError(password) {
  const text = String(password || "");
  if (text.length < 8) return "Temporary password must be at least 8 characters long.";
  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text)) {
    return "Temporary password must include uppercase and lowercase letters.";
  }
  if (!/\d/.test(text)) return "Temporary password must include at least one number.";
  if (!/[^A-Za-z0-9]/.test(text)) {
    return "Temporary password must include at least one symbol.";
  }
  return "";
}

function divisionLabel(division) {
  if (division === EQUIPMENT_DIVISIONS.BOTH) {
    return "Equipment Hire and Installment Finance";
  }
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
        "Only the protected System Administrator can create staff logins, assign Hire or Finance roles, or change dual-division access.",
    });
  }
  return next();
}

function clientError(statusCode, message, code = "EQUIPMENT_WORKFORCE_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function equipmentBusinessUnit(connection = pool) {
  const [rows] = await connection.query(
    `SELECT id, code, name
     FROM business_units
     WHERE code = 'equipment_hire'
       AND is_enabled = TRUE
     LIMIT 1`
  );
  if (!rows.length) {
    throw clientError(
      503,
      "The Equipment Business unit is not enabled.",
      "EQUIPMENT_BUSINESS_NOT_READY"
    );
  }
  return rows[0];
}

async function activeLocations(connection = pool) {
  const unit = await equipmentBusinessUnit(connection);
  const [rows] = await connection.query(
    `SELECT id, code, name, location_type, address, phone, is_active
     FROM business_locations
     WHERE business_unit_id = ?
       AND is_active = TRUE
     ORDER BY name, code`,
    [unit.id]
  );
  return rows;
}

async function validateLocations(connection, locationIds, defaultLocationId) {
  const ids = uniquePositiveIds(locationIds);
  const defaultId = positiveId(defaultLocationId);
  if (defaultId && !ids.includes(defaultId)) {
    throw clientError(400, "The default Hire location must also be selected.");
  }
  if (!ids.length) return { ids, defaultId: null };

  const unit = await equipmentBusinessUnit(connection);
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT id
     FROM business_locations
     WHERE business_unit_id = ?
       AND is_active = TRUE
       AND id IN (${placeholders})`,
    [unit.id, ...ids]
  );
  if (rows.length !== ids.length) {
    throw clientError(400, "Only active Equipment Hire locations can be assigned.");
  }
  return { ids, defaultId };
}

async function syncLocations(
  connection,
  userId,
  locationIds,
  defaultLocationId,
  actorId
) {
  const { ids, defaultId } = await validateLocations(
    connection,
    locationIds,
    defaultLocationId
  );

  await connection.query(
    `UPDATE user_hire_location_access
     SET can_access = FALSE,
         is_default = FALSE,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [userId]
  );

  for (const locationId of ids) {
    await connection.query(
      `INSERT INTO user_hire_location_access (
         user_id, location_id, can_access, is_default, created_by
       ) VALUES (?, ?, TRUE, ?, ?)
       ON DUPLICATE KEY UPDATE
         can_access = TRUE,
         is_default = VALUES(is_default),
         created_by = VALUES(created_by),
         updated_at = CURRENT_TIMESTAMP`,
      [userId, locationId, Number(locationId) === Number(defaultId), actorId]
    );
  }

  return { location_ids: ids, default_location_id: defaultId };
}

async function disableLocations(connection, userId) {
  await connection.query(
    `UPDATE user_hire_location_access
     SET can_access = FALSE,
         is_default = FALSE,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [userId]
  );
}

async function loadStaff() {
  const unit = await equipmentBusinessUnit();
  const [rows] = await pool.query(
    `SELECT
       u.id,
       u.full_name,
       u.username,
       u.phone,
       u.role AS global_role,
       u.is_active,
       u.must_change_password,
       u.created_at,
       u.updated_at,
       uba.access_role AS workspace_role,
       uba.can_access,
       uba.updated_at AS division_updated_at,
       wp.id AS worker_profile_id,
       wp.employee_number,
       wp.job_title,
       wp.department,
       wp.employment_status,
       wp.id_card_expiry_date,
       GROUP_CONCAT(
         DISTINCT CASE WHEN uhla.can_access = TRUE THEN bl.id END
         ORDER BY bl.name SEPARATOR ','
       ) AS location_ids,
       GROUP_CONCAT(
         DISTINCT CASE WHEN uhla.can_access = TRUE THEN CONCAT(bl.code, ' - ', bl.name) END
         ORDER BY bl.name SEPARATOR '|'
       ) AS location_labels,
       MAX(CASE WHEN uhla.can_access = TRUE AND uhla.is_default = TRUE THEN bl.id END)
         AS default_location_id
     FROM users u
     LEFT JOIN user_business_access uba
       ON uba.user_id = u.id
      AND uba.business_unit_id = ?
     LEFT JOIN worker_profiles wp
       ON wp.user_id = u.id
      AND wp.workspace_code = 'equipment_hire'
     LEFT JOIN user_hire_location_access uhla
       ON uhla.user_id = u.id
     LEFT JOIN business_locations bl
       ON bl.id = uhla.location_id
      AND bl.business_unit_id = ?
     WHERE u.primary_workspace_code = 'equipment_hire'
       AND u.category_assignment_status = 'assigned'
       AND NOT (u.id = ? AND LOWER(u.username) = LOWER(?) AND u.role = 'admin')
     GROUP BY
       u.id, u.full_name, u.username, u.phone, u.role, u.is_active,
       u.must_change_password, u.created_at, u.updated_at,
       uba.access_role, uba.can_access, uba.updated_at,
       wp.id, wp.employee_number, wp.job_title, wp.department,
       wp.employment_status, wp.id_card_expiry_date
     ORDER BY u.is_active DESC, u.full_name, u.username`,
    [
      unit.id,
      unit.id,
      Number(process.env.SYSTEM_ADMIN_USER_ID || 1),
      String(process.env.SYSTEM_ADMIN_USERNAME || "admin").trim(),
    ]
  );

  return rows.map((row) => {
    const workspaceRole = normalizeRole(row.workspace_role);
    return {
      ...row,
      workspace_role: workspaceRole || null,
      division: divisionForEquipmentRole(workspaceRole),
      role_template: roleTemplate(workspaceRole),
      can_access: Boolean(Number(row.can_access)),
      is_active: Boolean(Number(row.is_active)),
      must_change_password: Boolean(Number(row.must_change_password)),
      location_ids: String(row.location_ids || "")
        .split(",")
        .map(Number)
        .filter(Boolean),
      location_labels: String(row.location_labels || "")
        .split("|")
        .filter(Boolean),
      default_location_id: positiveId(row.default_location_id),
      worker_profile_linked: Boolean(row.worker_profile_id),
    };
  });
}

function roleGroups() {
  return {
    hire: ROLE_TEMPLATES.filter((item) => item.division === EQUIPMENT_DIVISIONS.HIRE),
    finance: ROLE_TEMPLATES.filter(
      (item) => item.division === EQUIPMENT_DIVISIONS.FINANCE
    ),
    both: ROLE_TEMPLATES.filter((item) => item.division === EQUIPMENT_DIVISIONS.BOTH),
  };
}

async function overviewPayload() {
  const [staff, locations] = await Promise.all([loadStaff(), activeLocations()]);
  const now = new Date();
  const expiryBoundary = new Date(now);
  expiryBoundary.setDate(expiryBoundary.getDate() + 60);

  return {
    staff,
    locations,
    role_templates: ROLE_TEMPLATES,
    roles: roleGroups(),
    summary: {
      staff_logins: staff.length,
      active_logins: staff.filter((item) => item.is_active && item.can_access).length,
      hire_staff: staff.filter((item) => item.division === EQUIPMENT_DIVISIONS.HIRE).length,
      finance_staff: staff.filter(
        (item) => item.division === EQUIPMENT_DIVISIONS.FINANCE
      ).length,
      dual_staff: staff.filter((item) => item.division === EQUIPMENT_DIVISIONS.BOTH).length,
      linked_worker_profiles: staff.filter((item) => item.worker_profile_linked).length,
      logins_without_worker_profiles: staff.filter(
        (item) => !item.worker_profile_linked
      ).length,
      id_cards_expiring_within_60_days: staff.filter((item) => {
        if (!item.id_card_expiry_date) return false;
        const expiry = new Date(item.id_card_expiry_date);
        return expiry >= now && expiry <= expiryBoundary;
      }).length,
    },
    policy: {
      staff_login_creation: "system_administrator_only",
      role_defaults_apply_before_overrides: true,
      explicit_deny_overrides_role_allow: true,
      permission_override_authority: "protected_system_administrator",
      finance_location_selection_required: false,
      hire_locations_apply_only_to_hire_and_dual_roles: true,
      dual_roles_require_explicit_approval: true,
      role_changes_revoke_active_sessions: true,
      worker_profiles_and_logins_are_linked_but_independent_records: true,
    },
  };
}

function sendError(res, error, fallback) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code || "EQUIPMENT_WORKFORCE_ERROR",
      message: error.message,
    });
  }
  if (error?.code === "ER_DUP_ENTRY") {
    const phoneDuplicate = String(error.message || "").includes(
      "uq_users_login_phone_normalized"
    );
    return res.status(409).json({
      status: "error",
      code: "DUPLICATE_STAFF_LOGIN",
      message: phoneDuplicate
        ? "This phone number is already attached to another login account."
        : "This username or linked staff record already exists.",
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ status: "error", message: fallback });
}

router.use(requireSystemAdministrator);

router.get("/overview", async (_req, res) => {
  try {
    return res.json({ status: "success", ...(await overviewPayload()) });
  } catch (error) {
    return sendError(res, error, "Could not load Equipment Business workforce administration.");
  }
});

router.get("/role-templates", (_req, res) =>
  res.json({
    status: "success",
    role_templates: ROLE_TEMPLATES,
    roles: roleGroups(),
  })
);

router.get("/staff", async (_req, res) => {
  try {
    const data = await overviewPayload();
    return res.json({
      status: "success",
      staff: data.staff,
      locations: data.locations,
      role_templates: data.role_templates,
      roles: data.roles,
      summary: data.summary,
      policy: data.policy,
    });
  } catch (error) {
    return sendError(res, error, "Could not load Equipment division staff assignments.");
  }
});

router.post("/staff", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const fullName = cleanText(req.body?.full_name, 180);
    const username = cleanText(req.body?.username, 80);
    const phone = nullableText(req.body?.phone, 40);
    const normalizedPhone = normalizedPhoneForStorage(phone);
    const temporaryPassword = String(req.body?.temporary_password || "");
    const workspaceRole = normalizeRole(req.body?.workspace_role || req.body?.role);
    const template = roleTemplate(workspaceRole);

    if (!fullName || !username || !temporaryPassword || !template) {
      throw clientError(
        400,
        "Full name, username, temporary password and a valid Equipment Business role are required."
      );
    }
    if (phone && !normalizedPhone) {
      throw clientError(400, "Enter a valid Ghana phone number.");
    }
    const passwordError = strongPasswordError(temporaryPassword);
    if (passwordError) throw clientError(400, passwordError);

    const isActive = booleanValue(req.body?.is_active, true);
    const forcePasswordChange = booleanValue(req.body?.force_password_change, true);
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const unit = await equipmentBusinessUnit(connection);
    const locationsAllowed = template.division !== EQUIPMENT_DIVISIONS.FINANCE;

    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO users (
         full_name, username, password_hash, role, phone,
         default_branch_id, can_access_all_branches, is_active,
         must_change_password, password_changed_at,
         primary_workspace_code, category_assignment_status,
         category_assignment_reviewed_at, category_assignment_reviewed_by,
         created_by
       ) VALUES (?, ?, ?, ?, ?, NULL, FALSE, ?, ?, ?,
                 'equipment_hire', 'assigned', NOW(), ?, ?)`,
      [
        fullName,
        username,
        passwordHash,
        globalRoleForEquipmentRole(workspaceRole),
        phone,
        isActive,
        forcePasswordChange,
        forcePasswordChange ? null : new Date(),
        req.user.id,
        req.user.id,
      ]
    );

    await connection.query(
      `INSERT INTO user_business_access (
         user_id, business_unit_id, access_role, can_access, is_default, created_by
       ) VALUES (?, ?, ?, TRUE, FALSE, ?)`,
      [result.insertId, unit.id, workspaceRole, req.user.id]
    );

    const locationAssignment = locationsAllowed
      ? await syncLocations(
          connection,
          result.insertId,
          req.body?.location_ids,
          req.body?.default_location_id,
          req.user.id
        )
      : { location_ids: [], default_location_id: null };

    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_STAFF_LOGIN_CREATED",
      actionType: "equipment.staff.login.created",
      entityType: "user",
      entityId: result.insertId,
      workspaceCode: "equipment_hire",
      severity: "critical",
      outcome: "success",
      details: `${fullName} was created as ${template.label} for ${divisionLabel(
        template.division
      )}.`,
      metadata: {
        workspace_role: workspaceRole,
        division: template.division,
        force_password_change: forcePasswordChange,
        location_ids: locationAssignment.location_ids,
        worker_profile_pending: true,
      },
    });

    await connection.commit();
    return res.status(201).json({
      status: "success",
      message: `${fullName}'s staff login was created. The temporary password must be changed at first login. Create or link the worker profile from Staff & Workforce next.`,
      user: {
        id: result.insertId,
        full_name: fullName,
        username,
        phone,
        workspace_role: workspaceRole,
        division: template.division,
        global_role: globalRoleForEquipmentRole(workspaceRole),
        must_change_password: forcePasswordChange,
        location_ids: locationAssignment.location_ids,
        default_location_id: locationAssignment.default_location_id,
      },
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }
    return sendError(res, error, "Could not create the Equipment Business staff login.");
  } finally {
    connection.release();
  }
});

router.put("/staff/:userId", async (req, res) => {
  const targetUserId = positiveId(req.params.userId);
  const workspaceRole = normalizeRole(req.body?.workspace_role || req.body?.role);
  const template = roleTemplate(workspaceRole);

  if (!targetUserId || !ROLE_CODES.has(workspaceRole) || !template) {
    return res.status(400).json({
      status: "error",
      message: "Choose a valid Hire, Finance or approved dual Equipment Business role.",
    });
  }

  const requestedDivision = normalizeRole(req.body?.division);
  if (requestedDivision && requestedDivision !== template.division) {
    return res.status(400).json({
      status: "error",
      message: "The selected role does not belong to the selected division scope.",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.query(
      `SELECT id, full_name, username, role, is_active,
              primary_workspace_code, category_assignment_status
       FROM users
       WHERE id = ?
       LIMIT 1 FOR UPDATE`,
      [targetUserId]
    );
    const user = users[0];
    if (!user) throw clientError(404, "Staff account not found.");
    if (isOriginalSystemAdministrator(user)) {
      throw clientError(
        409,
        "The protected System Administrator supervises both divisions and cannot be reassigned."
      );
    }
    if (
      normalizeRole(user.primary_workspace_code) !== "equipment_hire" ||
      normalizeRole(user.category_assignment_status) !== "assigned"
    ) {
      throw clientError(409, "This account does not belong to Equipment Business.");
    }

    const unit = await equipmentBusinessUnit(connection);
    const [beforeRows] = await connection.query(
      `SELECT access_role, can_access
       FROM user_business_access
       WHERE user_id = ? AND business_unit_id = ?
       LIMIT 1`,
      [targetUserId, unit.id]
    );
    const beforeRole = normalizeRole(beforeRows[0]?.access_role);
    const beforeDivision = divisionForEquipmentRole(beforeRole);

    await connection.query(
      `UPDATE users
       SET role = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [globalRoleForEquipmentRole(workspaceRole), targetUserId]
    );
    await connection.query(
      `INSERT INTO user_business_access (
         user_id, business_unit_id, access_role, can_access, is_default, created_by
       ) VALUES (?, ?, ?, TRUE, FALSE, ?)
       ON DUPLICATE KEY UPDATE
         access_role = VALUES(access_role),
         can_access = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [targetUserId, unit.id, workspaceRole, req.user.id]
    );

    let locationAssignment = null;
    if (template.division === EQUIPMENT_DIVISIONS.FINANCE) {
      await disableLocations(connection, targetUserId);
      locationAssignment = { location_ids: [], default_location_id: null };
    } else if (Array.isArray(req.body?.location_ids)) {
      locationAssignment = await syncLocations(
        connection,
        targetUserId,
        req.body.location_ids,
        req.body.default_location_id,
        req.user.id
      );
    }

    const revokedSessions = await revokeUserSessions(
      connection,
      targetUserId,
      `Equipment assignment changed to ${template.division}`
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
      details: `${user.full_name || user.username} was assigned as ${template.label} for ${divisionLabel(
        template.division
      )}.`,
      metadata: {
        before_role: beforeRole || null,
        before_division: beforeDivision,
        after_role: workspaceRole,
        after_division: template.division,
        location_assignment: locationAssignment,
        revoked_sessions: revokedSessions,
        role_defaults_apply_before_overrides: true,
      },
    });

    await connection.commit();
    return res.json({
      status: "success",
      message: `${user.full_name || user.username} can now access ${divisionLabel(
        template.division
      )} as ${template.label}. Existing sessions were revoked so the new role applies at the next login.`,
      assignment: {
        user_id: targetUserId,
        division: template.division,
        workspace_role: workspaceRole,
        global_role: globalRoleForEquipmentRole(workspaceRole),
        location_assignment: locationAssignment,
        revoked_sessions: revokedSessions,
      },
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    return sendError(res, error, "Could not update the Equipment staff assignment.");
  } finally {
    connection.release();
  }
});

module.exports = router;