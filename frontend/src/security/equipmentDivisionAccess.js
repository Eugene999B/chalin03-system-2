export const EQUIPMENT_DIVISIONS = Object.freeze({
  HIRE: "hire",
  FINANCE: "finance",
  BOTH: "both",
});

export const DUAL_DIVISION_ROLES = Object.freeze([
  "equipment_business_manager",
  "equipment_business_accountant",
  "equipment_business_auditor",
]);

export const HIRE_WORKSPACE_ROLES = Object.freeze([
  "manager",
  "hire_officer",
  "dispatcher",
  "fleet_officer",
  "accountant",
  "auditor",
  ...DUAL_DIVISION_ROLES,
]);

export const FINANCE_WORKSPACE_ROLES = Object.freeze([
  "finance_manager",
  "credit_officer",
  "collections_officer",
  "finance_accountant",
  "finance_auditor",
  ...DUAL_DIVISION_ROLES,
]);

const HIRE_ROLE_SET = new Set(HIRE_WORKSPACE_ROLES);
const FINANCE_ROLE_SET = new Set(FINANCE_WORKSPACE_ROLES);
const DUAL_ROLE_SET = new Set(DUAL_DIVISION_ROLES);
const FINANCE_WORK_ROLE_SET = new Set([
  "finance_manager",
  "credit_officer",
  "collections_officer",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const SHARED_REGISTER_WRITE_ROLE_SET = new Set([
  "finance_manager",
  "equipment_business_manager",
  "equipment_business_accountant",
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
  if (division === EQUIPMENT_DIVISIONS.BOTH) return DUAL_ROLE_SET.has(workspaceRole);
  return false;
}

// This frontend guard improves navigation only; the backend independently rejects
// every request that lacks the exact division and action permission.
export function ensureFinanceUiCompatibilityPermissions(user = {}, pathname = "") {
  if (!canAccessEquipmentDivision(user, EQUIPMENT_DIVISIONS.FINANCE)) return [];

  const current = Array.isArray(user.effective_permissions)
    ? user.effective_permissions
    : [];
  const permissions = new Set(current);
  const role = equipmentWorkspaceRole(user);

  permissions.add("fleet.assets.view");
  permissions.delete("fleet.assets.manage");

  const financeCatalogueOnly = String(pathname || "").startsWith(
    "/equipment-installment-finance/catalogue"
  );
  const sharedRegisterWrite =
    financeCatalogueOnly && SHARED_REGISTER_WRITE_ROLE_SET.has(role);
  if (
    sharedRegisterWrite ||
    (!financeCatalogueOnly &&
      (isEquipmentAdministrator(user) || FINANCE_WORK_ROLE_SET.has(role)))
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
  if (hire && finance) return EQUIPMENT_DIVISIONS.BOTH;
  if (hire) return EQUIPMENT_DIVISIONS.HIRE;
  if (finance) return EQUIPMENT_DIVISIONS.FINANCE;
  return null;
}
