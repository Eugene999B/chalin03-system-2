const { isOriginalSystemAdministrator } = require("./systemAdminIdentity");

const EQUIPMENT_DIVISIONS = Object.freeze({
  HIRE: "hire",
  FINANCE: "finance",
});

const ADMIN_ROLES = new Set([
  "admin",
  "administrator",
  "system_administrator",
  "super_admin",
]);

const HIRE_WORKSPACE_ROLES = new Set([
  "manager",
  "hire_officer",
  "dispatcher",
  "fleet_officer",
  "accountant",
  "auditor",
]);

const FINANCE_WORKSPACE_ROLES = new Set([
  "finance_manager",
  "credit_officer",
  "collections_officer",
  "finance_accountant",
  "finance_auditor",
]);

const FINANCE_WRITE_ROLES = new Set([
  "finance_manager",
  "credit_officer",
  "collections_officer",
  "finance_accountant",
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
  return isOriginalSystemAdministrator(user) || ADMIN_ROLES.has(normalizeCode(user.role));
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

    // The master equipment register may be viewed by either division. Only Hire
    // staff may change it; Finance receives a reference-only view.
    if (method !== "GET") {
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
  const financeSalesRequest = /^\/sales(?:\/|$)/.test(path);
  const financeWriteAllowed =
    financeSalesRequest &&
    method !== "GET" &&
    (isEquipmentAdministrator(req.user) || FINANCE_WRITE_ROLES.has(workspaceRoleFor(req.user)));

  if (financeWriteAllowed) permissions.push("fleet.assets.manage");
  addRequestPermissions(req, permissions);
}

function divisionAccessDeniedMessage(division) {
  return division === EQUIPMENT_DIVISIONS.FINANCE
    ? "This staff account belongs to Equipment Hire Operations and cannot open Installment Finance work. Assign a Finance-only role before access is allowed."
    : "This staff account belongs to Equipment Installment Finance and cannot open Hire jobs, contracts, dispatch, invoices or returns. Assign a Hire-only role before access is allowed.";
}

module.exports = {
  EQUIPMENT_DIVISIONS,
  HIRE_WORKSPACE_ROLES,
  FINANCE_WORKSPACE_ROLES,
  FINANCE_WRITE_ROLES,
  workspaceRoleFor,
  isEquipmentAdministrator,
  hasEquipmentDivisionAccess,
  requiredEquipmentDivisionForRequest,
  applyEquipmentDivisionCompatibilityPermissions,
  divisionAccessDeniedMessage,
};
