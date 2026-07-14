import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HIRE_SECTION_PERMISSIONS,
  MINING_SECTION_PERMISSIONS,
  canAccessRule,
  canUseFleetAction,
  canUseHireAction,
  canUseMiningAction,
} from "../src/security/permissionRules.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { getEffectivePermissions } = require(
  join(root, "../backend/security/permissionCatalog.js")
);

function permissions(workspaceCode, workspaceRole, globalRole = "staff") {
  return getEffectivePermissions({
    role: globalRole,
    workspace_code: workspaceCode,
    workspace_role: workspaceRole,
  });
}

function canOpen(permissionsList, rule) {
  return canAccessRule(permissionsList, rule);
}

const miningSupervisor = permissions("mining", "site_supervisor");
assert.equal(canOpen(miningSupervisor, MINING_SECTION_PERMISSIONS.daily), true);
assert.equal(canUseMiningAction(miningSupervisor, "daily", "approve"), true);
assert.equal(canUseMiningAction(miningSupervisor, "sites", "create"), false);

const equipmentOperator = permissions("mining", "equipment_operator");
assert.equal(canOpen(equipmentOperator, MINING_SECTION_PERMISSIONS.equipment), true);
assert.equal(canUseMiningAction(equipmentOperator, "equipment", "create"), true);
assert.equal(canOpen(equipmentOperator, MINING_SECTION_PERMISSIONS.daily), false);

const siteClerk = permissions("mining", "site_clerk");
assert.equal(canOpen(siteClerk, MINING_SECTION_PERMISSIONS.production), true);
assert.equal(canUseMiningAction(siteClerk, "daily", "create"), true);
assert.equal(canUseMiningAction(siteClerk, "daily", "approve"), false);

const miningAccountant = permissions("mining", "accountant");
assert.equal(canOpen(miningAccountant, MINING_SECTION_PERMISSIONS.expenses), true);
assert.equal(canUseMiningAction(miningAccountant, "expenses", "approve"), true);
assert.equal(canUseMiningAction(miningAccountant, "equipment", "create"), false);

const hireOfficer = permissions("equipment_hire", "hire_officer");
assert.equal(canOpen(hireOfficer, HIRE_SECTION_PERMISSIONS.customers), true);
assert.equal(canUseHireAction(hireOfficer, "quotation"), true);
assert.equal(canUseHireAction(hireOfficer, "dispatch"), false);
assert.equal(canUseHireAction(hireOfficer, "payment"), false);

const dispatcher = permissions("equipment_hire", "dispatcher");
assert.equal(canOpen(dispatcher, HIRE_SECTION_PERMISSIONS.operations), true);
assert.equal(canUseHireAction(dispatcher, "dispatch"), true);
assert.equal(canUseHireAction(dispatcher, "payment"), false);

const fleetOfficer = permissions("equipment_hire", "fleet_officer");
assert.equal(canOpen(fleetOfficer, HIRE_SECTION_PERMISSIONS.fleet), true);
assert.equal(canUseFleetAction(fleetOfficer, "asset"), true);
assert.equal(canUseHireAction(fleetOfficer, "payment"), false);

const hireAccountant = permissions("equipment_hire", "accountant");
assert.equal(canOpen(hireAccountant, HIRE_SECTION_PERMISSIONS.finance), true);
assert.equal(canUseHireAction(hireAccountant, "invoice"), true);
assert.equal(canUseHireAction(hireAccountant, "payment"), true);
assert.equal(canUseHireAction(hireAccountant, "dispatch"), false);

const miningAuditor = permissions("mining", "auditor", "auditor");
assert.equal(canOpen(miningAuditor, MINING_SECTION_PERMISSIONS.overview), true);
assert.equal(miningAuditor.includes("audit.view"), true);
assert.equal(canUseMiningAction(miningAuditor, "daily", "create"), false);

const cashierMining = permissions("mining", "cashier", "cashier");
const cashierHire = permissions("equipment_hire", "cashier", "cashier");
assert.equal(canOpen(cashierMining, MINING_SECTION_PERMISSIONS.overview), false);
assert.equal(canOpen(cashierHire, HIRE_SECTION_PERMISSIONS.overview), false);

console.log("PASS - frontend permission routing and action tests completed.");
