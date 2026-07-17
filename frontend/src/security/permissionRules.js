export const MINING_VIEW_PERMISSIONS = Object.freeze([
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
]);

export const HIRE_VIEW_PERMISSIONS = Object.freeze([
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
]);

export const MINING_SECTION_PERMISSIONS = Object.freeze({
  overview: { any: MINING_VIEW_PERMISSIONS },
  sites: { all: ["mining.sites.view"] },
  daily: { all: ["mining.daily_logs.view"] },
  production: { all: ["mining.production.view"] },
  equipment: { all: ["mining.equipment_logs.view"] },
  fuel: { all: ["mining.fuel.view"] },
  expenses: { all: ["mining.expenses.view"] },
  incidents: { all: ["mining.incidents.view"] },
  control: { any: ["mining.stockpiles.view", "mining.dispatch.view", "mining.fuel_control.view", "mining.workforce.view", "mining.closing.view"] },
  fleet: { all: ["fleet.assets.view"] },
  documents: { all: ["operations.documents.view"] },
  administration: { all: ["workspace.admin"] },
});

export const HIRE_SECTION_PERMISSIONS = Object.freeze({
  overview: { any: HIRE_VIEW_PERMISSIONS },
  customers: { all: ["hire.customers.view"] },
  enquiries: { all: ["hire.enquiries.view"] },
  availability: { all: ["fleet.assets.view"] },
  quotations: { all: ["hire.quotations.view"] },
  contracts: { all: ["hire.contracts.view"] },
  operations: { any: ["hire.dispatch.view", "hire.work_logs.view"] },
  finance: { any: ["hire.invoices.view", "hire.payments.view"] },
  returns: { all: ["hire.returns.view"] },
  reports: { all: ["hire.reports.view"] },
  fleet: { all: ["fleet.assets.view"] },
  documents: { all: ["operations.documents.view"] },
  administration: { all: ["workspace.admin"] },
});

export const MINING_ACTION_PERMISSIONS = Object.freeze({
  sites: {
    create: "mining.sites.manage",
    edit: "mining.sites.manage",
  },
  daily: {
    create: "mining.daily_logs.create",
    approve: "mining.daily_logs.approve",
  },
  production: {
    create: "mining.production.create",
    approve: "mining.production.approve",
  },
  equipment: {
    create: "mining.equipment_logs.create",
    approve: "mining.equipment_logs.approve",
  },
  fuel: {
    create: "mining.fuel.manage",
  },
  expenses: {
    create: "mining.expenses.manage",
    approve: "mining.expenses.approve",
  },
  incidents: {
    create: "mining.incidents.manage",
    approve: "mining.incidents.manage",
  },
});

export const HIRE_ACTION_PERMISSIONS = Object.freeze({
  customer: "hire.customers.manage",
  enquiry: "hire.enquiries.manage",
  quotation: "hire.quotations.manage",
  quotationApprove: "hire.quotations.approve",
  contract: "hire.contracts.manage",
  assignment: "hire.contracts.manage",
  dispatch: "hire.dispatch.manage",
  work_log: "hire.work_logs.manage",
  workLogApprove: "hire.work_logs.approve",
  invoice: "hire.invoices.manage",
  payment: "hire.payments.manage",
  return: "hire.returns.manage",
  operationalClose: "hire.contracts.close_operational",
  financialClose: "hire.contracts.close_financial",
});

export const FLEET_ACTION_PERMISSIONS = Object.freeze({
  asset: "fleet.assets.manage",
  status: "fleet.assets.manage",
  meter: "fleet.meter.manage",
  fuel: "fleet.fuel.manage",
  maintenance: "fleet.maintenance.manage",
  inspection: "fleet.inspections.manage",
});

export function normalizePermissions(value) {
  return new Set(Array.isArray(value) ? value.filter(Boolean) : []);
}

export function hasPermission(permissions, permission) {
  if (!permission) return true;
  return normalizePermissions(permissions).has(permission);
}

export function hasEveryPermission(permissions, required = []) {
  return required.every((permission) => hasPermission(permissions, permission));
}

export function hasAnyPermission(permissions, required = []) {
  return required.length === 0
    ? true
    : required.some((permission) => hasPermission(permissions, permission));
}

export function canAccessRule(permissions, rule = {}) {
  return (
    hasEveryPermission(permissions, rule.all || []) &&
    hasAnyPermission(permissions, rule.any || [])
  );
}

export function canUseMiningAction(permissions, section, action) {
  return hasPermission(permissions, MINING_ACTION_PERMISSIONS[section]?.[action]);
}

export function canUseHireAction(permissions, action) {
  return hasPermission(permissions, HIRE_ACTION_PERMISSIONS[action]);
}

export function canUseFleetAction(permissions, action) {
  return hasPermission(permissions, FLEET_ACTION_PERMISSIONS[action]);
}
