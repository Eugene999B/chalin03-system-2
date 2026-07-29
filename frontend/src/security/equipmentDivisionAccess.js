export const EQUIPMENT_DIVISIONS = Object.freeze({
  HIRE: "hire",
  FINANCE: "finance",
});

export const HIRE_WORKSPACE_ROLES = Object.freeze([
  "manager",
  "hire_officer",
  "dispatcher",
  "fleet_officer",
  "accountant",
  "auditor",
]);

export const FINANCE_WORKSPACE_ROLES = Object.freeze([
  "finance_manager",
  "credit_officer",
  "collections_officer",
  "finance_accountant",
  "finance_auditor",
]);

const HIRE_ROLE_SET = new Set(HIRE_WORKSPACE_ROLES);
const FINANCE_ROLE_SET = new Set(FINANCE_WORKSPACE_ROLES);
const FINANCE_WORK_ROLE_SET = new Set([
  "finance_manager",
  "credit_officer",
  "collections_officer",
  "finance_accountant",
]);

function normalized(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function enabled(value) {
  return [true, 1, "1", "true"].includes(value);
}

export function equipmentWorkspaceRole(user = {}) {
  return normalized(user.workspace_role || user.access_role || user.role);
}

export function isEquipmentAdministrator(user = {}) {
  return enabled(user.is_original_system_administrator);
}

export function canAccessEquipmentDivision(user = {}, division) {
  if (isEquipmentAdministrator(user)) return true;
  if (normalized(user.workspace_code) !== "equipment_hire") return false;

  const workspaceRole = equipmentWorkspaceRole(user);
  if (division === EQUIPMENT_DIVISIONS.HIRE) return HIRE_ROLE_SET.has(workspaceRole);
  if (division === EQUIPMENT_DIVISIONS.FINANCE) {
    return FINANCE_ROLE_SET.has(workspaceRole);
  }
  return false;
}

export function ensureFinanceUiCompatibilityPermissions(user = {}) {
  if (!canAccessEquipmentDivision(user, EQUIPMENT_DIVISIONS.FINANCE)) return [];

  const current = Array.isArray(user.effective_permissions)
    ? user.effective_permissions
    : [];
  const permissions = new Set(current);

  // Existing Finance pages use fleet permission names internally. Add them only
  // to the authenticated Finance interface. The backend independently rejects
  // Finance roles on Hire APIs and rejects Finance catalogue writes.
  permissions.add("fleet.assets.view");
  if (
    isEquipmentAdministrator(user) ||
    FINANCE_WORK_ROLE_SET.has(equipmentWorkspaceRole(user))
  ) {
    permissions.add("fleet.assets.manage");
  }

  const resolved = [...permissions].sort();
  if (Array.isArray(user.effective_permissions)) {
    user.effective_permissions.splice(0, user.effective_permissions.length, ...resolved);
    return user.effective_permissions;
  }

  user.effective_permissions = resolved;
  return user.effective_permissions;
}

export function equipmentDivisionForUser(user = {}) {
  const hire = canAccessEquipmentDivision(user, EQUIPMENT_DIVISIONS.HIRE);
  const finance = canAccessEquipmentDivision(user, EQUIPMENT_DIVISIONS.FINANCE);
  if (hire && finance) return "both";
  if (hire) return EQUIPMENT_DIVISIONS.HIRE;
  if (finance) return EQUIPMENT_DIVISIONS.FINANCE;
  return null;
}
