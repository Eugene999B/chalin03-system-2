const EQUIPMENT_DIVISIONS = Object.freeze({
  HIRE: "hire",
  FINANCE: "finance",
  BOTH: "both",
});

function unique(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

const COMMON_VIEW = Object.freeze([
  "workspace.view",
  "workers.view",
  "notifications.view",
]);

const WORKFORCE_MANAGER = Object.freeze([
  "workers.view",
  "workers.sensitive.view",
  "workers.manage",
  "workers.documents.view",
  "workers.documents.manage",
  "workers.deactivate",
]);

const WORKFORCE_AUDIT = Object.freeze([
  "workers.view",
  "workers.documents.view",
]);

const SHARED_VIEW = Object.freeze([
  "shared.control.view",
  "shared.documents.view",
  "shared.reports.view",
  "operations.documents.view",
]);

const SHARED_MANAGEMENT = Object.freeze([
  ...SHARED_VIEW,
  "shared.reports.export",
  "shared.audit.view",
  "operations.documents.manage",
  "exports.download",
]);

const HIRE_MANAGER_PERMISSIONS = Object.freeze([
  ...COMMON_VIEW,
  ...WORKFORCE_MANAGER,
  ...SHARED_MANAGEMENT,
  "notifications.sync",
  "notifications.manage",
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
]);

const HIRE_ACCOUNTANT_PERMISSIONS = Object.freeze([
  ...COMMON_VIEW,
  ...WORKFORCE_AUDIT,
  ...SHARED_MANAGEMENT,
  "notifications.sync",
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
  "fleet.assets.view",
]);

const HIRE_AUDITOR_PERMISSIONS = Object.freeze([
  ...COMMON_VIEW,
  ...WORKFORCE_AUDIT,
  ...SHARED_MANAGEMENT,
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
]);

const FINANCE_MANAGER_PERMISSIONS = Object.freeze([
  ...COMMON_VIEW,
  ...WORKFORCE_MANAGER,
  ...SHARED_MANAGEMENT,
  "audit.view",
  "notifications.sync",
  "notifications.manage",
  "fleet.assets.view",
  "fleet.assets.manage",
]);

const FINANCE_ACCOUNTANT_PERMISSIONS = Object.freeze([
  ...COMMON_VIEW,
  ...WORKFORCE_AUDIT,
  ...SHARED_MANAGEMENT,
  "audit.view",
  "notifications.sync",
  "fleet.assets.view",
  "fleet.assets.manage",
]);

const FINANCE_AUDITOR_PERMISSIONS = Object.freeze([
  ...COMMON_VIEW,
  ...WORKFORCE_AUDIT,
  ...SHARED_MANAGEMENT,
  "audit.view",
  "audit.export",
  "fleet.assets.view",
]);

const ROLE_TEMPLATES = Object.freeze({
  manager: {
    label: "Hire Manager",
    division: EQUIPMENT_DIVISIONS.HIRE,
    global_role: "manager",
    description: "Runs Hire operations, staff records, equipment, contracts, billing and returns.",
    permissions: HIRE_MANAGER_PERMISSIONS,
  },
  hire_officer: {
    label: "Hire Officer",
    division: EQUIPMENT_DIVISIONS.HIRE,
    global_role: "staff",
    description: "Handles Hire customers, enquiries, quotations and contract preparation.",
    permissions: unique([
      ...COMMON_VIEW,
      ...SHARED_VIEW,
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
    ]),
  },
  dispatcher: {
    label: "Hire Dispatcher",
    division: EQUIPMENT_DIVISIONS.HIRE,
    global_role: "staff",
    description: "Controls dispatch, job cards, operational closeout and return inspections.",
    permissions: unique([
      ...COMMON_VIEW,
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
    ]),
  },
  fleet_officer: {
    label: "Fleet Officer",
    division: EQUIPMENT_DIVISIONS.HIRE,
    global_role: "staff",
    description: "Maintains the machine register, meters, fuel, inspections and service records.",
    permissions: unique([
      ...COMMON_VIEW,
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
    ]),
  },
  accountant: {
    label: "Hire Accountant",
    division: EQUIPMENT_DIVISIONS.HIRE,
    global_role: "staff",
    description: "Controls Hire invoices, payments, financial closeout and management reports.",
    permissions: HIRE_ACCOUNTANT_PERMISSIONS,
  },
  auditor: {
    label: "Hire Auditor",
    division: EQUIPMENT_DIVISIONS.HIRE,
    global_role: "auditor",
    description: "Reads Hire evidence, workforce records, reports and audit history without operational editing.",
    permissions: HIRE_AUDITOR_PERMISSIONS,
  },
  finance_manager: {
    label: "Finance Manager",
    division: EQUIPMENT_DIVISIONS.FINANCE,
    global_role: "manager",
    description: "Runs applications, approvals, agreements, collections and Finance workforce records.",
    permissions: FINANCE_MANAGER_PERMISSIONS,
  },
  credit_officer: {
    label: "Credit Officer",
    division: EQUIPMENT_DIVISIONS.FINANCE,
    global_role: "staff",
    description: "Prepares customer KYC, affordability evidence and credit applications for independent approval.",
    permissions: unique([
      ...COMMON_VIEW,
      ...SHARED_VIEW,
      "workers.documents.view",
      "fleet.assets.view",
      "fleet.assets.manage",
    ]),
  },
  collections_officer: {
    label: "Collections Officer",
    division: EQUIPMENT_DIVISIONS.FINANCE,
    global_role: "staff",
    description: "Records controlled collections work, arrears follow-up and customer promises.",
    permissions: unique([
      ...COMMON_VIEW,
      ...SHARED_MANAGEMENT,
      "fleet.assets.view",
      "fleet.assets.manage",
    ]),
  },
  finance_accountant: {
    label: "Finance Accountant",
    division: EQUIPMENT_DIVISIONS.FINANCE,
    global_role: "staff",
    description: "Controls payment evidence, balances, statements, settlement and Finance reports.",
    permissions: FINANCE_ACCOUNTANT_PERMISSIONS,
  },
  finance_auditor: {
    label: "Finance Auditor",
    division: EQUIPMENT_DIVISIONS.FINANCE,
    global_role: "auditor",
    description: "Reviews Finance applications, accounts, documents and audit evidence without operational editing.",
    permissions: FINANCE_AUDITOR_PERMISSIONS,
  },
  equipment_business_manager: {
    label: "Equipment Business Manager",
    division: EQUIPMENT_DIVISIONS.BOTH,
    global_role: "manager",
    description: "Approved dual role with management access to Hire and Installment Finance.",
    permissions: unique([
      ...HIRE_MANAGER_PERMISSIONS,
      ...FINANCE_MANAGER_PERMISSIONS,
    ]),
  },
  equipment_business_accountant: {
    label: "Equipment Business Accountant",
    division: EQUIPMENT_DIVISIONS.BOTH,
    global_role: "staff",
    description: "Approved dual role for Hire and Finance accounts, evidence and reports.",
    permissions: unique([
      ...HIRE_ACCOUNTANT_PERMISSIONS,
      ...FINANCE_ACCOUNTANT_PERMISSIONS,
    ]),
  },
  equipment_business_auditor: {
    label: "Equipment Business Auditor",
    division: EQUIPMENT_DIVISIONS.BOTH,
    global_role: "auditor",
    description: "Approved read-only dual role for Hire and Finance audit oversight.",
    permissions: unique([
      ...HIRE_AUDITOR_PERMISSIONS,
      ...FINANCE_AUDITOR_PERMISSIONS,
    ]),
  },
});

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function roleTemplate(role) {
  return ROLE_TEMPLATES[normalizeRole(role)] || null;
}

function permissionsForEquipmentRole(role) {
  return [...(roleTemplate(role)?.permissions || [])];
}

function divisionForEquipmentRole(role) {
  return roleTemplate(role)?.division || null;
}

function globalRoleForEquipmentRole(role) {
  return roleTemplate(role)?.global_role || "staff";
}

function publicEquipmentRoleTemplates() {
  return Object.entries(ROLE_TEMPLATES).map(([code, template]) => ({
    code,
    label: template.label,
    division: template.division,
    global_role: template.global_role,
    description: template.description,
    permissions: [...template.permissions],
    permission_count: template.permissions.length,
  }));
}

function equipmentRoleDefaultPermissions(session = {}) {
  const workspace = String(
    session.workspace_code || session.primary_workspace_code || ""
  )
    .trim()
    .toLowerCase();
  if (workspace !== "equipment_hire") return [];
  return permissionsForEquipmentRole(
    session.workspace_role || session.access_role || session.role
  );
}

module.exports = {
  EQUIPMENT_DIVISIONS,
  ROLE_TEMPLATES,
  divisionForEquipmentRole,
  equipmentRoleDefaultPermissions,
  globalRoleForEquipmentRole,
  normalizeRole,
  permissionsForEquipmentRole,
  publicEquipmentRoleTemplates,
  roleTemplate,
};