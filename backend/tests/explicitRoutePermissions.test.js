const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

function source(relativePath) {
  return readFileSync(join(__dirname, "..", relativePath), "utf8");
}

function hasRoutePermission(text, method, path, permission) {
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedPermission = permission.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `router\\.${method}\\(\\s*["']${escapedPath}["'][\\s\\S]*?requirePermission\\(\\s*["']${escapedPermission}["']`
  );
  return pattern.test(text);
}

test("Mining routes use explicit permission guards for each endpoint pattern", () => {
  const mining = source("routes/miningRoutes.js");

  assert.match(mining, /router\.get\(\s*"\/dashboard"[\s\S]*requireAnyPermission/);
  assert.equal(hasRoutePermission(mining, "get", "/sites", "mining.sites.view"), true);
  assert.equal(hasRoutePermission(mining, "post", "/sites", "mining.sites.manage"), true);
  assert.equal(hasRoutePermission(mining, "put", "/sites/:id", "mining.sites.manage"), true);
  assert.equal(hasRoutePermission(mining, "get", "/daily-logs", "mining.daily_logs.view"), true);
  assert.equal(hasRoutePermission(mining, "post", "/daily-logs", "mining.daily_logs.create"), true);
  assert.equal(hasRoutePermission(mining, "patch", "/daily-logs/:id/approve", "mining.daily_logs.approve"), true);
  assert.equal(hasRoutePermission(mining, "get", "/production", "mining.production.view"), true);
  assert.equal(hasRoutePermission(mining, "post", "/production", "mining.production.create"), true);
  assert.equal(hasRoutePermission(mining, "patch", "/production/:id/approve", "mining.production.approve"), true);
  assert.equal(hasRoutePermission(mining, "get", "/equipment-logs", "mining.equipment_logs.view"), true);
  assert.equal(hasRoutePermission(mining, "post", "/equipment-logs", "mining.equipment_logs.create"), true);
  assert.equal(hasRoutePermission(mining, "patch", "/equipment-logs/:id/approve", "mining.equipment_logs.approve"), true);
  assert.equal(hasRoutePermission(mining, "get", "/fuel-logs", "mining.fuel.view"), true);
  assert.equal(hasRoutePermission(mining, "post", "/fuel-logs", "mining.fuel.manage"), true);
  assert.equal(hasRoutePermission(mining, "get", "/expenses", "mining.expenses.view"), true);
  assert.equal(hasRoutePermission(mining, "post", "/expenses", "mining.expenses.manage"), true);
  assert.equal(hasRoutePermission(mining, "patch", "/expenses/:id/approve", "mining.expenses.approve"), true);
  assert.equal(hasRoutePermission(mining, "get", "/incidents", "mining.incidents.view"), true);
  assert.equal(hasRoutePermission(mining, "post", "/incidents", "mining.incidents.manage"), true);
  assert.equal(hasRoutePermission(mining, "patch", "/incidents/:id/status", "mining.incidents.manage"), true);
  assert.doesNotMatch(mining, /requireRole|requireWorkspaceRoutePermission/);
});

test("Equipment Hire routes use explicit permission guards for each endpoint pattern", () => {
  const hire = source("routes/equipmentHireRoutes.js");

  assert.match(hire, /router\.get\(\s*"\/dashboard"[\s\S]*requireAnyPermission/);
  assert.equal(hasRoutePermission(hire, "get", "/reports", "hire.reports.view"), true);
  assert.equal(hasRoutePermission(hire, "get", "/availability", "fleet.assets.view"), true);
  assert.equal(hasRoutePermission(hire, "get", "/customers", "hire.customers.view"), true);
  assert.equal(hasRoutePermission(hire, "post", "/customers", "hire.customers.manage"), true);
  assert.equal(hasRoutePermission(hire, "get", "/enquiries", "hire.enquiries.view"), true);
  assert.equal(hasRoutePermission(hire, "post", "/enquiries", "hire.enquiries.manage"), true);
  assert.equal(hasRoutePermission(hire, "post", "/enquiries/:id/convert-to-quotation", "hire.enquiries.manage"), true);
  assert.equal(hasRoutePermission(hire, "get", "/quotations", "hire.quotations.view"), true);
  assert.equal(hasRoutePermission(hire, "post", "/quotations", "hire.quotations.manage"), true);
  assert.equal(hasRoutePermission(hire, "post", "/quotations/:id/convert-to-contract", "hire.quotations.manage"), true);
  assert.equal(hasRoutePermission(hire, "patch", "/quotations/:id/status", "hire.quotations.approve"), true);
  assert.equal(hasRoutePermission(hire, "get", "/contracts", "hire.contracts.view"), true);
  assert.equal(hasRoutePermission(hire, "post", "/contracts", "hire.contracts.manage"), true);
  assert.equal(hasRoutePermission(hire, "patch", "/contracts/:id/status", "hire.contracts.manage"), true);
  assert.equal(hasRoutePermission(hire, "patch", "/contracts/:id/close", "hire.contracts.close_operational"), true);
  assert.equal(hasRoutePermission(hire, "patch", "/contracts/:id/financial-close", "hire.contracts.close_financial"), true);
  assert.equal(hasRoutePermission(hire, "get", "/contract-assets", "hire.contracts.view"), true);
  assert.equal(hasRoutePermission(hire, "post", "/contracts/:id/assets", "hire.contracts.manage"), true);
  assert.equal(hasRoutePermission(hire, "delete", "/contract-assets/:id", "hire.contracts.manage"), true);
  assert.equal(hasRoutePermission(hire, "get", "/dispatches", "hire.dispatch.view"), true);
  assert.equal(hasRoutePermission(hire, "post", "/dispatches", "hire.dispatch.manage"), true);
  assert.equal(hasRoutePermission(hire, "get", "/work-logs", "hire.work_logs.view"), true);
  assert.equal(hasRoutePermission(hire, "post", "/work-logs", "hire.work_logs.manage"), true);
  assert.equal(hasRoutePermission(hire, "patch", "/work-logs/:id/approve", "hire.work_logs.approve"), true);
  assert.equal(hasRoutePermission(hire, "get", "/finance-summary", "hire.reports.view"), true);
  assert.equal(hasRoutePermission(hire, "get", "/billable-work-logs", "hire.work_logs.view"), true);
  assert.equal(hasRoutePermission(hire, "get", "/invoices", "hire.invoices.view"), true);
  assert.equal(hasRoutePermission(hire, "post", "/invoices", "hire.invoices.manage"), true);
  assert.equal(hasRoutePermission(hire, "get", "/payments", "hire.payments.view"), true);
  assert.equal(hasRoutePermission(hire, "post", "/payments", "hire.payments.manage"), true);
  assert.equal(hasRoutePermission(hire, "get", "/returns", "hire.returns.view"), true);
  assert.equal(hasRoutePermission(hire, "post", "/returns", "hire.returns.manage"), true);
  assert.doesNotMatch(hire, /requireRole|requireWorkspaceRoutePermission/);
});

test("Fleet routes use explicit permission guards for nested asset actions", () => {
  const fleet = source("routes/fleetRoutes.js");

  assert.equal(hasRoutePermission(fleet, "get", "/summary", "fleet.assets.view"), true);
  assert.equal(hasRoutePermission(fleet, "get", "/assets", "fleet.assets.view"), true);
  assert.equal(hasRoutePermission(fleet, "get", "/assets/:id", "fleet.assets.view"), true);
  assert.equal(hasRoutePermission(fleet, "post", "/assets", "fleet.assets.manage"), true);
  assert.equal(hasRoutePermission(fleet, "put", "/assets/:id", "fleet.assets.manage"), true);
  assert.equal(hasRoutePermission(fleet, "patch", "/assets/:id/status", "fleet.assets.manage"), true);
  assert.equal(hasRoutePermission(fleet, "patch", "/assets/:id/active", "fleet.assets.manage"), true);
  assert.equal(hasRoutePermission(fleet, "post", "/assets/:id/meter-readings", "fleet.meter.manage"), true);
  assert.equal(hasRoutePermission(fleet, "post", "/assets/:id/fuel-logs", "fleet.fuel.manage"), true);
  assert.equal(hasRoutePermission(fleet, "post", "/assets/:id/maintenance", "fleet.maintenance.manage"), true);
  assert.equal(hasRoutePermission(fleet, "post", "/assets/:id/inspections", "fleet.inspections.manage"), true);
  assert.doesNotMatch(fleet, /requireRole|requireWorkspaceRoutePermission/);
});
