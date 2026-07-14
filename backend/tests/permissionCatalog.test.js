const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getEffectivePermissions,
  hasPermission,
} = require("../security/permissionCatalog");

test("group admin has full operational and system permissions", () => {
  const permissions = getEffectivePermissions({
    role: "admin",
    workspace_code: "mining",
    workspace_role: "group_admin",
  });

  assert.equal(permissions.includes("users.manage"), true);
  assert.equal(permissions.includes("backup.restore"), true);
  assert.equal(permissions.includes("mining.production.approve"), true);
  assert.equal(permissions.includes("hire.payments.manage"), true);
});

test("cashier remains Spare Parts-only", () => {
  const sparePartsPermissions = getEffectivePermissions({
    role: "cashier",
    workspace_code: "spare_parts",
  });
  const miningPermissions = getEffectivePermissions({
    role: "cashier",
    workspace_code: "mining",
    workspace_role: "site_clerk",
  });

  assert.equal(sparePartsPermissions.includes("spare_parts.sell"), true);
  assert.equal(miningPermissions.length, 0);
});

test("mining site clerk can create draft operations but cannot approve", () => {
  const session = {
    role: "staff",
    workspace_code: "mining",
    workspace_role: "site_clerk",
  };

  assert.equal(hasPermission(session, "mining.daily_logs.create"), true);
  assert.equal(hasPermission(session, "mining.production.create"), true);
  assert.equal(hasPermission(session, "mining.production.approve"), false);
  assert.equal(hasPermission(session, "users.manage"), false);
});

test("hire accountant can post payments but cannot dispatch equipment", () => {
  const session = {
    role: "staff",
    workspace_code: "equipment_hire",
    workspace_role: "accountant",
  };

  assert.equal(hasPermission(session, "hire.payments.manage"), true);
  assert.equal(hasPermission(session, "hire.invoices.manage"), true);
  assert.equal(hasPermission(session, "hire.dispatch.manage"), false);
});

test("fleet officer cannot gain Hire finance permissions", () => {
  const session = {
    role: "staff",
    workspace_code: "equipment_hire",
    workspace_role: "fleet_officer",
  };

  assert.equal(hasPermission(session, "fleet.assets.manage"), true);
  assert.equal(hasPermission(session, "hire.payments.manage"), false);
  assert.equal(hasPermission(session, "hire.invoices.manage"), false);
});

test("mining equipment operator can work with assigned equipment but cannot manage assets or approvals", () => {
  const session = {
    role: "staff",
    workspace_code: "mining",
    workspace_role: "equipment_operator",
  };

  assert.equal(hasPermission(session, "mining.equipment_logs.view"), true);
  assert.equal(hasPermission(session, "mining.equipment_logs.create"), true);
  assert.equal(hasPermission(session, "fleet.assets.view"), true);
  assert.equal(hasPermission(session, "fleet.meter.manage"), true);
  assert.equal(hasPermission(session, "fleet.inspections.manage"), true);
  assert.equal(hasPermission(session, "fleet.assets.manage"), false);
  assert.equal(hasPermission(session, "mining.equipment_logs.approve"), false);
  assert.equal(hasPermission(session, "mining.production.approve"), false);
});

test("site supervisor can record Fleet meter and inspection actions without full Fleet asset management", () => {
  const session = {
    role: "staff",
    workspace_code: "mining",
    workspace_role: "site_supervisor",
  };

  assert.equal(hasPermission(session, "fleet.assets.view"), true);
  assert.equal(hasPermission(session, "fleet.meter.manage"), true);
  assert.equal(hasPermission(session, "fleet.inspections.manage"), true);
  assert.equal(hasPermission(session, "fleet.assets.manage"), false);
});

test("hire officer can view availability but cannot dispatch, invoice or pay", () => {
  const session = {
    role: "staff",
    workspace_code: "equipment_hire",
    workspace_role: "hire_officer",
  };

  assert.equal(hasPermission(session, "fleet.assets.view"), true);
  assert.equal(hasPermission(session, "hire.contracts.manage"), true);
  assert.equal(hasPermission(session, "hire.dispatch.manage"), false);
  assert.equal(hasPermission(session, "hire.invoices.manage"), false);
  assert.equal(hasPermission(session, "hire.payments.manage"), false);
});

test("dispatcher can dispatch and return equipment but cannot invoice or pay", () => {
  const session = {
    role: "staff",
    workspace_code: "equipment_hire",
    workspace_role: "dispatcher",
  };

  assert.equal(hasPermission(session, "hire.dispatch.manage"), true);
  assert.equal(hasPermission(session, "hire.returns.manage"), true);
  assert.equal(hasPermission(session, "hire.invoices.manage"), false);
  assert.equal(hasPermission(session, "hire.payments.manage"), false);
});

test("hire accountant can invoice, pay and financially close but cannot dispatch", () => {
  const session = {
    role: "staff",
    workspace_code: "equipment_hire",
    workspace_role: "accountant",
  };

  assert.equal(hasPermission(session, "hire.invoices.manage"), true);
  assert.equal(hasPermission(session, "hire.payments.manage"), true);
  assert.equal(hasPermission(session, "hire.contracts.close_financial"), true);
  assert.equal(hasPermission(session, "hire.dispatch.manage"), false);
  assert.equal(hasPermission(session, "hire.contracts.close_operational"), false);
});

test("cashier is denied all Mining, Hire and Fleet permissions", () => {
  const cashier = {
    role: "cashier",
    workspace_code: "equipment_hire",
    workspace_role: "manager",
  };
  const permissions = getEffectivePermissions(cashier);

  assert.deepEqual(
    permissions.filter(
      (permission) =>
        permission.startsWith("mining.") ||
        permission.startsWith("hire.") ||
        permission.startsWith("fleet.")
    ),
    []
  );
});

test("auditors remain read-only in Mining and Equipment Hire", () => {
  const miningAuditor = {
    role: "auditor",
    workspace_code: "mining",
    workspace_role: "auditor",
  };
  const hireAuditor = {
    role: "auditor",
    workspace_code: "equipment_hire",
    workspace_role: "auditor",
  };

  assert.equal(hasPermission(miningAuditor, "mining.sites.view"), true);
  assert.equal(hasPermission(miningAuditor, "mining.expenses.view"), true);
  assert.equal(hasPermission(miningAuditor, "mining.expenses.manage"), false);
  assert.equal(hasPermission(miningAuditor, "fleet.assets.manage"), false);
  assert.equal(hasPermission(hireAuditor, "hire.contracts.view"), true);
  assert.equal(hasPermission(hireAuditor, "hire.payments.view"), true);
  assert.equal(hasPermission(hireAuditor, "hire.payments.manage"), false);
  assert.equal(hasPermission(hireAuditor, "hire.dispatch.manage"), false);
});
