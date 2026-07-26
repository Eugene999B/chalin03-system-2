const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const mining = read("backend", "routes", "miningRoutes.js");
const miningControl = read("backend", "routes", "miningControlRoutes.js");
const hire = read("backend", "routes", "equipmentHireRoutes.js");
const hireCommercial = read("backend", "routes", "hireCommercialRoutes.js");
const equipmentSales = read("backend", "routes", "equipmentSalesRoutes.js");
const equipmentSalesFinal = read(
  "backend",
  "routes",
  "equipmentSalesFinalizationRoutes.js"
);
const notifications = read("backend", "services", "notificationService.js");
const scheduler = read(
  "backend",
  "services",
  "notificationSchedulerService.js"
);
const server = read("backend", "server.js");

function expectRoute(source, method, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(source, new RegExp(`router\\.${method}\\(\\s*[\"']${escaped}[\"']`));
}

test("Mining core workflow remains reachable", () => {
  for (const [method, route] of [
    ["post", "/sites"],
    ["post", "/daily-logs"],
    ["post", "/production"],
    ["post", "/equipment-logs"],
    ["post", "/fuel-logs"],
    ["post", "/expenses"],
    ["post", "/incidents"],
  ]) expectRoute(mining, method, route);

  for (const [method, route] of [
    ["post", "/stockpiles"],
    ["post", "/stockpile-movements"],
    ["post", "/dispatches"],
    ["patch", "/dispatches/:id/approve"],
    ["post", "/fuel-tanks"],
    ["post", "/fuel-transactions"],
    ["post", "/fuel-reconciliations"],
    ["post", "/crews"],
    ["post", "/closings"],
  ]) expectRoute(miningControl, method, route);
});

test("Mining corrections preserve controlled evidence", () => {
  expectRoute(mining, "delete", "/sites/:id");
  expectRoute(miningControl, "patch", "/dispatches/:id/cancel");
  expectRoute(miningControl, "patch", "/fuel-reconciliations/:id/approve");
  assert.match(miningControl, /adjustment_in/);
  assert.match(miningControl, /adjustment_out/);
  assert.match(miningControl, /writeAuditEvent/);
  assert.doesNotMatch(miningControl, /FOREIGN_KEY_CHECKS/i);
});

test("Equipment Hire workflow and correction routes remain reachable", () => {
  for (const [method, route] of [
    ["post", "/customers"],
    ["post", "/enquiries"],
    ["post", "/quotations"],
    ["post", "/contracts"],
    ["post", "/contracts/:id/assets"],
    ["post", "/dispatches"],
    ["post", "/work-logs"],
    ["post", "/invoices"],
    ["post", "/payments"],
    ["post", "/returns"],
    ["patch", "/invoices/:id/void"],
    ["patch", "/contracts/:id/close"],
    ["patch", "/contracts/:id/financial-close"],
  ]) expectRoute(hire, method, route);

  expectRoute(hireCommercial, "post", "/contracts/:id/amendments");
  expectRoute(hireCommercial, "patch", "/amendments/:id/approve");
  expectRoute(hireCommercial, "post", "/damage-assessments");
  expectRoute(hireCommercial, "patch", "/damage-assessments/:id/settle");
});

test("Equipment Sales finalization and reminders remain reachable", () => {
  expectRoute(equipmentSales, "post", "/agreements/:id/payments");
  expectRoute(equipmentSales, "post", "/agreements/:id/delivery");
  expectRoute(equipmentSales, "post", "/agreements/:id/ownership-transfer");
  expectRoute(equipmentSalesFinal, "post", "/reminders/run");
});

test("automatic workspace notifications cover Mining and Hire risks", () => {
  for (const rule of [
    "mining.stockpile_low",
    "mining.fuel_tank_low",
    "mining.dispatch_pending",
    "mining.fuel_variance",
    "hire.invoice_overdue",
    "hire.contract_overdue",
    "hire.deposit_pending",
    "hire.damage_open",
    "hire.work_log_pending",
  ]) assert.match(notifications, new RegExp(rule.replaceAll(".", "\\.")));

  assert.match(scheduler, /runNotificationSync/);
  assert.match(scheduler, /workspace: "group"/);
  assert.match(scheduler, /MIN_INTERVAL_MINUTES = 5/);
  assert.match(server, /startNotificationSyncScheduler\(\)/);
});

test("final Mining and Hire source contains no unfinished markers", () => {
  for (const source of [
    mining,
    miningControl,
    hire,
    hireCommercial,
    equipmentSales,
    equipmentSalesFinal,
    notifications,
    scheduler,
  ]) assert.doesNotMatch(source, /\b(?:TODO|FIXME|TBD)\b/i);
});
