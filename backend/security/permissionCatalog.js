const { isOriginalSystemAdministrator } = require("./systemAdminIdentity");
const {
  CONTENT_STUDIO_PERMISSIONS,
} = require("./contentStudioPermissionCatalog");

const WORKSPACES = Object.freeze({
  SPARE_PARTS: "spare_parts",
  MINING: "mining",
  EQUIPMENT_HIRE: "equipment_hire",
});

const CORE_PERMISSIONS = Object.freeze([
  "workspace.view",
  "workspace.admin",
  "users.manage",
  "users.permissions.manage",
  "audit.view",
  "audit.export",
  "backup.download",
  "backup.validate",
  "backup.restore",
  "system.diagnostics",
  "security.admin",
  "security.view",
  "workers.view",
  "workers.sensitive.view",
  "workers.manage",
  "workers.documents.view",
  "workers.documents.manage",
  "workers.deactivate",
  "executive.operations.view",
  "notifications.view",
  "notifications.sync",
  "notifications.manage",
  "notifications.escalate",
  "shared.control.view",
  "shared.documents.view",
  "shared.reports.view",
  "shared.reports.export",
  "shared.audit.view",
  "spare_parts.read",
  "spare_parts.sell",
  "spare_parts.manage",
  "spare_parts.audit",
  "installments.view",
  "installments.manage",
  "installments.collect",
  "installments.remind",
  "installments.export",
  "installments.settings",
]);

const PAYROLL_PERMISSIONS = Object.freeze([
  "payroll.view",
  "payroll.manage",
  "payroll.prepare",
  "payroll.approve",
  "payroll.pay",
  "payroll.payslip.issue",
  "payroll.adjust",
  "payroll.audit",
]);

const MINING_PERMISSIONS = Object.freeze([
  "mining.sites.view",
  "mining.sites.manage",
  "mining.daily_logs.view",
  "mining.daily_logs.create",
  "mining.daily_logs.approve",
  "mining.production.view",
  "mining.production.create",
  "mining.production.approve",
  "mining.equipment_logs.view",
  "mining.equipment_logs.create",
  "mining.equipment_logs.approve",
  "mining.fuel.view",
  "mining.fuel.manage",
  "mining.expenses.view",
  "mining.expenses.manage",
  "mining.expenses.approve",
  "mining.incidents.view",
  "mining.incidents.manage",
  "mining.reports.view",
  "mining.stockpiles.view",
  "mining.stockpiles.manage",
  "mining.dispatch.view",
  "mining.dispatch.manage",
  "mining.dispatch.approve",
  "mining.fuel_control.view",
  "mining.fuel_control.manage",
  "mining.fuel_control.approve",
  "mining.workforce.view",
  "mining.workforce.manage",
  "mining.workforce.approve",
  "mining.closing.view",
  "mining.closing.manage",
  "mining.closing.approve",
]);

const FLEET_PERMISSIONS = Object.freeze([
  "fleet.assets.view",
  "fleet.assets.manage",
  "fleet.meter.manage",
  "fleet.fuel.manage",
  "fleet.maintenance.manage",
  "fleet.inspections.manage",
]);

const HIRE_PERMISSIONS = Object.freeze([
  "hire.customers.view",
  "hire.customers.manage",
  "hire.enquiries.view",
  "hire.enquiries.manage",
  "hire.quotations.view",
  "hire.quotations.manage",
  "hire.quotations.approve",
  "hire.contracts.view",
  "hire.contracts.manage",
  "hire.contracts.close_operational",
  "hire.dispatch.view",
  "hire.dispatch.manage",
  "hire.work_logs.view",
  "hire.work_logs.manage",
  "hire.work_logs.approve",
  "hire.invoices.view",
  "hire.invoices.manage",
  "hire.payments.view",
  "hire.payments.manage",
  "hire.contracts.close_financial",
  "hire.returns.view",
  "hire.returns.manage",
  "hire.reports.view",
  "hire.commercial.view",
  "hire.commercial.manage",
  "hire.commercial.approve",
  "hire.commercial.evidence",
  "hire.commercial.damage",
]);

const ALL_PERMISSIONS = Object.freeze([
  ...CORE_PERMISSIONS,
  ...MINING_PERMISSIONS,
  ...FLEET_PERMISSIONS,
  ...HIRE_PERMISSIONS,
  ...CONTENT_STUDIO_PERMISSIONS,
  ...PAYROLL_PERMISSIONS,
  "operations.documents.view",
  "operations.documents.manage",
  "sms.manage",
  "exports.download",
]);

const CATEGORY_SHARED_PERMISSIONS = Object.freeze([
  "workspace.view",
  "workspace.admin",
  "users.manage",
  "users.permissions.manage",
  "audit.view",
  "audit.export",
  "workers.view",
  "workers.sensitive.view",
  "workers.manage",
  "workers.documents.view",
  "workers.documents.manage",
  "workers.deactivate",
  "notifications.view",
  "notifications.sync",
  "notifications.manage",
  "notifications.escalate",
  "shared.control.view",
  "shared.documents.view",
  "shared.reports.view",
  "shared.reports.export",
  "shared.audit.view",
  "exports.download",
  ...CONTENT_STUDIO_PERMISSIONS,
]);

const SPARE_PARTS_CATEGORY_PERMISSIONS = Object.freeze([
  ...CATEGORY_SHARED_PERMISSIONS,
  ...PAYROLL_PERMISSIONS,
  "spare_parts.read",
  "spare_parts.sell",
  "spare_parts.manage",
  "spare_parts.audit",
  "installments.view",
  "installments.manage",
  "installments.collect",
  "installments.remind",
  "installments.export",
  "installments.settings",
  "sms.manage",
]);

const MINING_CATEGORY_PERMISSIONS = Object.freeze([
  ...CATEGORY_SHARED_PERMISSIONS,
  ...PAYROLL_PERMISSIONS,
  ...MINING_PERMISSIONS,
  ...FLEET_PERMISSIONS,
  "operations.documents.view",
  "operations.documents.manage",
]);

const HIRE_CATEGORY_PERMISSIONS = Object.freeze([
  ...CATEGORY_SHARED_PERMISSIONS,
  ...PAYROLL_PERMISSIONS,
  ...HIRE_PERMISSIONS,
  ...FLEET_PERMISSIONS,
  "operations.documents.view",
  "operations.documents.manage",
]);

const WORKSPACE_PERMISSION_CATALOG = Object.freeze({
  [WORKSPACES.SPARE_PARTS]: SPARE_PARTS_CATEGORY_PERMISSIONS,
  [WORKSPACES.MINING]: MINING_CATEGORY_PERMISSIONS,
  [WORKSPACES.EQUIPMENT_HIRE]: HIRE_CATEGORY_PERMISSIONS,
});

const ADMIN_GRANTS = Object.freeze([...ALL_PERMISSIONS]);

const CROSS_CUTTING_GRANTS = Object.freeze({
  manager: ["workers.view"],
  auditor: [
    "security.view",
    "workers.view",
    "executive.operations.view",
    "backup.validate",
  ],
});

const SPARE_PARTS_GRANTS = Object.freeze({
  admin: [
    "workspace.view",
    "workspace.admin",
    "users.manage",
    "users.permissions.manage",
    "audit.view",
    "audit.export",
    "backup.download",
    "backup.validate",
    "backup.restore",
    "system.diagnostics",
    "security.admin",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
    "spare_parts.read",
    "spare_parts.sell",
    "spare_parts.manage",
    "spare_parts.audit",
    "installments.view",
    "installments.manage",
    "installments.collect",
    "installments.remind",
    "installments.export",
    "installments.settings",
    "sms.manage",
    "exports.download",
  ],
  manager: [
    "workspace.view",
    "audit.view",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
    "spare_parts.read",
    "spare_parts.sell",
    "spare_parts.manage",
    "spare_parts.audit",
    "installments.view",
    "installments.manage",
    "installments.collect",
    "installments.remind",
    "installments.export",
    "sms.manage",
    "exports.download",
  ],
  cashier: [
    "workspace.view",
    "spare_parts.read",
    "spare_parts.sell",
    "installments.view",
    "installments.collect",
  ],
  auditor: [
    "workspace.view",
    "audit.view",
    "audit.export",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
    "spare_parts.read",
    "spare_parts.audit",
    "installments.view",
    "installments.export",
    "exports.download",
  ],
  staff: ["workspace.view", "spare_parts.read"],
});

const MINING_ROLE_GRANTS = Object.freeze({
  manager: [
    "workspace.view",
    "mining.sites.view",
    "mining.sites.manage",
    "mining.daily_logs.view",
    "mining.daily_logs.create",
    "mining.daily_logs.approve",
    "mining.production.view",
    "mining.production.create",
    "mining.production.approve",
    "mining.equipment_logs.view",
    "mining.equipment_logs.create",
    "mining.equipment_logs.approve",
    "mining.fuel.view",
    "mining.fuel.manage",
    "mining.expenses.view",
    "mining.expenses.manage",
    "mining.expenses.approve",
    "mining.incidents.view",
    "mining.incidents.manage",
    "mining.reports.view",
    "mining.stockpiles.view",
    "mining.stockpiles.manage",
    "mining.dispatch.view",
    "mining.dispatch.manage",
    "mining.dispatch.approve",
    "mining.fuel_control.view",
    "mining.fuel_control.manage",
    "mining.fuel_control.approve",
    "mining.workforce.view",
    "mining.workforce.manage",
    "mining.workforce.approve",
    "mining.closing.view",
    "mining.closing.manage",
    "mining.closing.approve",
    "fleet.assets.view",
    "fleet.assets.manage",
    "fleet.meter.manage",
    "fleet.fuel.manage",
    "fleet.maintenance.manage",
    "fleet.inspections.manage",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
    "operations.documents.view",
    "operations.documents.manage",
    "exports.download",
  ],
  site_supervisor: [
    "workspace.view",
    "mining.sites.view",
    "mining.daily_logs.view",
    "mining.daily_logs.create",
    "mining.daily_logs.approve",
    "mining.production.view",
    "mining.production.create",
    "mining.production.approve",
    "mining.equipment_logs.view",
    "mining.equipment_logs.create",
    "mining.equipment_logs.approve",
    "mining.fuel.view",
    "mining.expenses.view",
    "mining.incidents.view",
    "mining.incidents.manage",
    "mining.reports.view",
    "mining.stockpiles.view",
    "mining.stockpiles.manage",
    "mining.dispatch.view",
    "mining.dispatch.manage",
    "mining.dispatch.approve",
    "mining.fuel_control.view",
    "mining.fuel_control.manage",
    "mining.fuel_control.approve",
    "mining.workforce.view",
    "mining.workforce.manage",
    "mining.workforce.approve",
    "mining.closing.view",
    "mining.closing.manage",
    "mining.closing.approve",
    "fleet.assets.view",
    "fleet.meter.manage",
    "fleet.inspections.manage",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "operations.documents.view",
    "exports.download",
  ],
  equipment_operator: [
    "workspace.view",
    "mining.sites.view",
    "mining.equipment_logs.view",
    "mining.equipment_logs.create",
    "mining.fuel_control.view",
    "mining.workforce.view",
    "fleet.assets.view",
    "fleet.meter.manage",
    "fleet.inspections.manage",
  ],
  site_clerk: [
    "workspace.view",
    "mining.sites.view",
    "mining.daily_logs.view",
    "mining.daily_logs.create",
    "mining.production.view",
    "mining.production.create",
    "mining.fuel.view",
    "mining.fuel.manage",
    "mining.incidents.view",
    "mining.incidents.manage",
    "mining.reports.view",
    "mining.stockpiles.view",
    "mining.stockpiles.manage",
    "mining.dispatch.view",
    "mining.dispatch.manage",
    "mining.fuel_control.view",
    "mining.fuel_control.manage",
    "mining.workforce.view",
    "mining.workforce.manage",
    "mining.closing.view",
    "mining.closing.manage",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "operations.documents.view",
  ],
  accountant: [
    "workspace.view",
    "mining.sites.view",
    "mining.daily_logs.view",
    "mining.production.view",
    "mining.equipment_logs.view",
    "mining.fuel.view",
    "mining.expenses.view",
    "mining.expenses.manage",
    "mining.expenses.approve",
    "mining.reports.view",
    "mining.stockpiles.view",
    "mining.dispatch.view",
    "mining.fuel_control.view",
    "mining.fuel_control.approve",
    "mining.workforce.view",
    "mining.closing.view",
    "mining.closing.approve",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
    "operations.documents.view",
    "exports.download",
  ],
  auditor: [
    "workspace.view",
    "audit.view",
    "audit.export",
    "mining.sites.view",
    "mining.daily_logs.view",
    "mining.production.view",
    "mining.equipment_logs.view",
    "mining.fuel.view",
    "mining.expenses.view",
    "mining.incidents.view",
    "mining.reports.view",
    "mining.stockpiles.view",
    "mining.dispatch.view",
    "mining.fuel_control.view",
    "mining.workforce.view",
    "mining.closing.view",
    "fleet.assets.view",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
    "operations.documents.view",
    "exports.download",
  ],
});

const HIRE_ROLE_GRANTS = Object.freeze({
  manager: [
    "workspace.view",
    "hire.customers.view",
    "hire.customers.manage",
    "hire.enquiries.view",
    "hire.enquiries.manage",
    "hire.quotations.view",
    "hire.quotations.manage",
    "hire.quotations.approve",
    "hire.contracts.view",
    "hire.contracts.manage",
    "hire.contracts.close_operational",
    "hire.dispatch.view",
    "hire.dispatch.manage",
    "hire.work_logs.view",
    "hire.work_logs.manage",
    "hire.work_logs.approve",
    "hire.invoices.view",
    "hire.invoices.manage",
    "hire.payments.view",
    "hire.payments.manage",
    "hire.contracts.close_financial",
    "hire.returns.view",
    "hire.returns.manage",
    "hire.reports.view",
    "hire.commercial.view",
    "hire.commercial.manage",
    "hire.commercial.approve",
    "hire.commercial.evidence",
    "hire.commercial.damage",
    "fleet.assets.view",
    "fleet.assets.manage",
    "fleet.meter.manage",
    "fleet.fuel.manage",
    "fleet.maintenance.manage",
    "fleet.inspections.manage",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
    "operations.documents.view",
    "operations.documents.manage",
    "exports.download",
  ],
  hire_officer: [
    "workspace.view",
    "hire.customers.view",
    "hire.customers.manage",
    "hire.enquiries.view",
    "hire.enquiries.manage",
    "hire.quotations.view",
    "hire.quotations.manage",
    "hire.contracts.view",
    "hire.contracts.manage",
    "hire.reports.view",
    "hire.commercial.view",
    "hire.commercial.manage",
    "hire.commercial.evidence",
    "hire.commercial.damage",
    "fleet.assets.view",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "operations.documents.view",
  ],
  dispatcher: [
    "workspace.view",
    "hire.customers.view",
    "hire.enquiries.view",
    "hire.quotations.view",
    "hire.contracts.view",
    "hire.dispatch.view",
    "hire.dispatch.manage",
    "hire.work_logs.view",
    "hire.work_logs.manage",
    "hire.returns.view",
    "hire.returns.manage",
    "hire.contracts.close_operational",
    "hire.commercial.view",
    "hire.commercial.evidence",
    "hire.commercial.damage",
    "fleet.assets.view",
    "fleet.meter.manage",
    "fleet.inspections.manage",
  ],
  fleet_officer: [
    "workspace.view",
    "fleet.assets.view",
    "fleet.assets.manage",
    "fleet.meter.manage",
    "fleet.fuel.manage",
    "fleet.maintenance.manage",
    "fleet.inspections.manage",
    "hire.contracts.view",
    "hire.dispatch.view",
    "hire.work_logs.view",
    "hire.returns.view",
    "hire.commercial.view",
    "hire.commercial.evidence",
    "hire.commercial.damage",
  ],
  accountant: [
    "workspace.view",
    "hire.customers.view",
    "hire.enquiries.view",
    "hire.quotations.view",
    "hire.contracts.view",
    "hire.dispatch.view",
    "hire.work_logs.view",
    "hire.invoices.view",
    "hire.invoices.manage",
    "hire.payments.view",
    "hire.payments.manage",
    "hire.contracts.close_financial",
    "hire.reports.view",
    "hire.commercial.view",
    "hire.commercial.manage",
    "hire.commercial.approve",
    "hire.commercial.evidence",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
    "operations.documents.view",
    "exports.download",
  ],
  auditor: [
    "workspace.view",
    "audit.view",
    "audit.export",
    "hire.customers.view",
    "hire.enquiries.view",
    "hire.quotations.view",
    "hire.contracts.view",
    "hire.dispatch.view",
    "hire.work_logs.view",
    "hire.invoices.view",
    "hire.payments.view",
    "hire.returns.view",
    "hire.reports.view",
    "hire.commercial.view",
    "fleet.assets.view",
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
    "operations.documents.view",
    "exports.download",
  ],
});

const WORKSPACE_ROLE_GRANTS = Object.freeze({
  [WORKSPACES.MINING]: MINING_ROLE_GRANTS,
  [WORKSPACES.EQUIPMENT_HIRE]: HIRE_ROLE_GRANTS,
});

function normalizeCode(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (cleaned === "hire" || cleaned === "equipment") {
    return WORKSPACES.EQUIPMENT_HIRE;
  }

  return cleaned || WORKSPACES.SPARE_PARTS;
}

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function uniquePermissions(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function getEffectivePermissions(session = {}) {
  const globalRole = normalizeRole(session.role);
  const workspaceCode = normalizeCode(
    session.workspace_code || session.active_workspace?.code
  );
  const workspaceRole = normalizeRole(
    session.workspace_role || session.access_role || globalRole
  );

  if (isOriginalSystemAdministrator(session)) {
    return ADMIN_GRANTS;
  }

  if (globalRole === "admin") {
    const categoryAdminShared = CATEGORY_SHARED_PERMISSIONS;

    if (workspaceCode === WORKSPACES.SPARE_PARTS) {
      return uniquePermissions([
        ...SPARE_PARTS_GRANTS.admin,
        ...categoryAdminShared,
      ]).filter((permission) =>
        SPARE_PARTS_CATEGORY_PERMISSIONS.includes(permission)
      );
    }

    const roleGrants = WORKSPACE_ROLE_GRANTS[workspaceCode] || {};
    return uniquePermissions([
      ...(roleGrants.manager || []),
      ...categoryAdminShared,
    ]).filter((permission) =>
      (WORKSPACE_PERMISSION_CATALOG[workspaceCode] || []).includes(permission)
    );
  }

  function notificationGrants(baseGrants) {
    const extra = [];
    if (baseGrants.includes("workspace.view")) {
      extra.push("notifications.view");
    }
    if (
      globalRole === "manager" ||
      ["manager", "site_supervisor", "accountant"].includes(workspaceRole)
    ) {
      extra.push("notifications.sync");
    }
    if (globalRole === "manager" || workspaceRole === "manager") {
      extra.push("notifications.manage");
    }
    return extra;
  }

  if (workspaceCode === WORKSPACES.SPARE_PARTS) {
    const grants = [
      ...(SPARE_PARTS_GRANTS[globalRole] || []),
      ...(CROSS_CUTTING_GRANTS[globalRole] || []),
    ];
    return uniquePermissions([...grants, ...notificationGrants(grants)]).filter(
      (permission) => SPARE_PARTS_CATEGORY_PERMISSIONS.includes(permission)
    );
  }

  if (globalRole === "cashier") {
    return [];
  }

  const roleGrants = WORKSPACE_ROLE_GRANTS[workspaceCode] || {};
  const grants = [
    ...(roleGrants[workspaceRole] ||
      (globalRole === "auditor" ? roleGrants.auditor : []) ||
      []),
    ...(CROSS_CUTTING_GRANTS[globalRole] || []),
  ];

  return uniquePermissions([...grants, ...notificationGrants(grants)]).filter(
    (permission) =>
      (WORKSPACE_PERMISSION_CATALOG[workspaceCode] || []).includes(permission)
  );
}

function hasPermission(session, permission) {
  if (!permission) return true;
  const permissions = new Set(
    session?.effective_permissions || getEffectivePermissions(session)
  );
  return permissions.has(permission);
}

function hasEveryPermission(session, permissions) {
  return permissions.every((permission) => hasPermission(session, permission));
}

function hasAnyPermission(session, permissions) {
  return permissions.some((permission) => hasPermission(session, permission));
}

function permissionsForWorkspace(workspaceCode) {
  const code = normalizeCode(workspaceCode);
  return [...(WORKSPACE_PERMISSION_CATALOG[code] || [])];
}

function isPermissionAllowedForWorkspace(permissionCode, workspaceCode) {
  return permissionsForWorkspace(workspaceCode).includes(
    String(permissionCode || "").trim()
  );
}

function getPublicPermissionCatalog() {
  return {
    workspaces: WORKSPACES,
    permissions: ALL_PERMISSIONS,
    content_studio_permissions: CONTENT_STUDIO_PERMISSIONS,
    spare_parts_roles: SPARE_PARTS_GRANTS,
    mining_roles: MINING_ROLE_GRANTS,
    equipment_hire_roles: HIRE_ROLE_GRANTS,
    workspace_permissions: WORKSPACE_PERMISSION_CATALOG,
  };
}

module.exports = {
  WORKSPACES,
  ALL_PERMISSIONS,
  MINING_PERMISSIONS,
  FLEET_PERMISSIONS,
  HIRE_PERMISSIONS,
  CONTENT_STUDIO_PERMISSIONS,
  PAYROLL_PERMISSIONS,
  CATEGORY_SHARED_PERMISSIONS,
  SPARE_PARTS_CATEGORY_PERMISSIONS,
  MINING_CATEGORY_PERMISSIONS,
  HIRE_CATEGORY_PERMISSIONS,
  WORKSPACE_PERMISSION_CATALOG,
  permissionsForWorkspace,
  isPermissionAllowedForWorkspace,
  normalizeCode,
  normalizeRole,
  getEffectivePermissions,
  hasPermission,
  hasEveryPermission,
  hasAnyPermission,
  getPublicPermissionCatalog,
};
