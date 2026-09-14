const { isOriginalSystemAdministrator } = require("./systemAdminIdentity");

const EQUIPMENT_DIVISIONS = Object.freeze({
  HIRE: "hire",
  FINANCE: "finance",
  BOTH: "both",
});

const DUAL_DIVISION_ROLES = new Set([
  "equipment_business_manager",
  "equipment_business_accountant",
  "equipment_business_auditor",
]);

const HIRE_WORKSPACE_ROLES = new Set([
  "manager",
  "hire_officer",
  "dispatcher",
  "fleet_officer",
  "accountant",
  "auditor",
  ...DUAL_DIVISION_ROLES,
]);

const FINANCE_WORKSPACE_ROLES = new Set([
  "finance_manager",
  "credit_officer",
  "collections_officer",
  "finance_accountant",
  "finance_auditor",
  ...DUAL_DIVISION_ROLES,
]);

const FINANCE_WRITE_ROLES = new Set([
  "finance_manager",
  "credit_officer",
  "collections_officer",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);

const SHARED_REGISTER_WRITE_ROLES = new Set([
  "finance_manager",
  "equipment_business_manager",
  "equipment_business_accountant",
]);

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function workspaceRoleFor(user = {}) {
  return normalizeCode(user.workspace_role || user.access_role || user.role);
}

function isEquipmentAdministrator(user = {}) {
  return isOriginalSystemAdministrator(user);
}

function hasEquipmentDivisionAccess(user = {}, division) {
  if (isEquipmentAdministrator(user)) return true;
  if (normalizeCode(user.workspace_code) !== "equipment_hire") return false;

  const workspaceRole = workspaceRoleFor(user);
  if (division === EQUIPMENT_DIVISIONS.HIRE) {
    return HIRE_WORKSPACE_ROLES.has(workspaceRole);
  }
  if (division === EQUIPMENT_DIVISIONS.FINANCE) {
    return FINANCE_WORKSPACE_ROLES.has(workspaceRole);
  }
  if (division === EQUIPMENT_DIVISIONS.BOTH) {
    return DUAL_DIVISION_ROLES.has(workspaceRole);
  }
  return false;
}

function normalizedRequestPath(req = {}) {
  return String(req.path || req.originalUrl || "/")
    .split("?")[0]
    .toLowerCase();
}

function normalizedBaseUrl(req = {}) {
  return String(req.baseUrl || "")
    .split("?")[0]
    .replace(/\/$/, "")
    .toLowerCase();
}

function requiredEquipmentDivisionForRequest(req = {}) {
  const baseUrl = normalizedBaseUrl(req);
  const path = normalizedRequestPath(req);
  const method = String(req.method || "GET").toUpperCase();

  if (baseUrl === "/api/equipment-hire" || baseUrl === "/api/hire-commercial") {
    return EQUIPMENT_DIVISIONS.HIRE;
  }

  if (baseUrl === "/api/equipment-catalogue") {
    if (/^\/sales(?:\/|$)/.test(path)) {
      return EQUIPMENT_DIVISIONS.FINANCE;
    }

    // The master equipment register is shared evidence. Hire roles and
    // specifically authorised Finance/dual roles may maintain it; all other
    // Finance roles retain reference-only access.
    if (method !== "GET") {
      const role = workspaceRoleFor(req.user);
      if (SHARED_REGISTER_WRITE_ROLES.has(role)) {
        return hasEquipmentDivisionAccess(req.user, EQUIPMENT_DIVISIONS.FINANCE)
          ? EQUIPMENT_DIVISIONS.FINANCE
          : EQUIPMENT_DIVISIONS.HIRE;
      }
      return EQUIPMENT_DIVISIONS.HIRE;
    }
  }

  return null;
}

function addRequestPermissions(req, permissions) {
  const current = Array.isArray(req.user?.effective_permissions)
    ? req.user.effective_permissions
    : [];
  req.user.effective_permissions = [...new Set([...current, ...permissions])].sort();
}

function applyEquipmentDivisionCompatibilityPermissions(req = {}) {
  if (!req.user || !hasEquipmentDivisionAccess(req.user, EQUIPMENT_DIVISIONS.FINANCE)) {
    return;
  }

  const baseUrl = normalizedBaseUrl(req);
  const path = normalizedRequestPath(req);
  const method = String(req.method || "GET").toUpperCase();
  if (baseUrl !== "/api/equipment-catalogue") return;

  const permissions = ["fleet.assets.view"];
  const role = workspaceRoleFor(req.user);
  const financeSalesRequest = /^\/sales(?:\/|$)/.test(path);
  const sharedRegisterWrite =
    !financeSalesRequest && method !== "GET" && SHARED_REGISTER_WRITE_ROLES.has(role);
  const financeWriteAllowed =
    method !== "GET" &&
    (isEquipmentAdministrator(req.user) ||
      (financeSalesRequest && FINANCE_WRITE_ROLES.has(role)) ||
      sharedRegisterWrite);

  if (financeWriteAllowed) permissions.push("fleet.assets.manage");
  addRequestPermissions(req, permissions);
}

function divisionAccessDeniedMessage(division) {
  return division === EQUIPMENT_DIVISIONS.FINANCE
    ? "This staff account has not been assigned to Installment Finance. Assign a Finance or dual Equipment Business role before access is allowed."
    : "This staff account has not been assigned to Equipment Hire Operations. Assign a Hire or dual Equipment Business role before access is allowed.";
}

module.exports = {
  EQUIPMENT_DIVISIONS,
  DUAL_DIVISION_ROLES,
  HIRE_WORKSPACE_ROLES,
  FINANCE_WORKSPACE_ROLES,
  FINANCE_WRITE_ROLES,
  SHARED_REGISTER_WRITE_ROLES,
  workspaceRoleFor,
  isEquipmentAdministrator,
  hasEquipmentDivisionAccess,
  requiredEquipmentDivisionForRequest,
  applyEquipmentDivisionCompatibilityPermissions,
  divisionAccessDeniedMessage,
};
