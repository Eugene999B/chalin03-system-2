const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const {
  EQUIPMENT_DIVISIONS,
  DUAL_DIVISION_ROLES,
  HIRE_WORKSPACE_ROLES,
  FINANCE_WORKSPACE_ROLES,
  hasEquipmentDivisionAccess,
  requiredEquipmentDivisionForRequest,
  applyEquipmentDivisionCompatibilityPermissions,
} = require("../security/equipmentDivisionAccess");

const hireUser = {
  id: 21,
  username: "hire.officer",
  role: "staff",
  workspace_code: "equipment_hire",
  workspace_role: "hire_officer",
  effective_permissions: ["fleet.assets.view"],
};
const financeUser = {
  id: 22,
  username: "credit.officer",
  role: "staff",
  workspace_code: "equipment_hire",
  workspace_role: "credit_officer",
  effective_permissions: [],
};
const financeManager = {
  id: 23,
  username: "finance.manager",
  role: "manager",
  workspace_code: "equipment_hire",
  workspace_role: "finance_manager",
  effective_permissions: [],
};
const dualAccountant = {
  id: 24,
  username: "equipment.accountant",
  role: "staff",
  workspace_code: "equipment_hire",
  workspace_role: "equipment_business_accountant",
  effective_permissions: [],
};
const dualAuditor = {
  id: 25,
  username: "equipment.auditor",
  role: "auditor",
  workspace_code: "equipment_hire",
  workspace_role: "equipment_business_auditor",
  effective_permissions: [],
};
const systemAdministrator = {
  id: 1,
  username: "admin",
  role: "admin",
  workspace_code: "equipment_hire",
  workspace_role: "group_admin",
  effective_permissions: [],
  is_original_system_administrator: true,
};

test("ordinary Hire and Finance roles remain isolated while approved dual roles span both", () => {
  assert.deepEqual(
    [...DUAL_DIVISION_ROLES].sort(),
    [
      "equipment_business_accountant",
      "equipment_business_auditor",
      "equipment_business_manager",
    ]
  );

  for (const role of HIRE_WORKSPACE_ROLES) {
    if (DUAL_DIVISION_ROLES.has(role)) continue;
    assert.equal(FINANCE_WORKSPACE_ROLES.has(role), false, `${role} crossed divisions`);
  }
  for (const role of FINANCE_WORKSPACE_ROLES) {
    if (DUAL_DIVISION_ROLES.has(role)) continue;
    assert.equal(HIRE_WORKSPACE_ROLES.has(role), false, `${role} crossed divisions`);
  }

  assert.equal(hasEquipmentDivisionAccess(hireUser, EQUIPMENT_DIVISIONS.HIRE), true);
  assert.equal(hasEquipmentDivisionAccess(hireUser, EQUIPMENT_DIVISIONS.FINANCE), false);
  assert.equal(hasEquipmentDivisionAccess(financeUser, EQUIPMENT_DIVISIONS.FINANCE), true);
  assert.equal(hasEquipmentDivisionAccess(financeUser, EQUIPMENT_DIVISIONS.HIRE), false);

  for (const user of [dualAccountant, dualAuditor]) {
    assert.equal(hasEquipmentDivisionAccess(user, EQUIPMENT_DIVISIONS.HIRE), true);
    assert.equal(hasEquipmentDivisionAccess(user, EQUIPMENT_DIVISIONS.FINANCE), true);
    assert.equal(hasEquipmentDivisionAccess(user, EQUIPMENT_DIVISIONS.BOTH), true);
  }

  assert.equal(hasEquipmentDivisionAccess(systemAdministrator, EQUIPMENT_DIVISIONS.HIRE), true);
  assert.equal(hasEquipmentDivisionAccess(systemAdministrator, EQUIPMENT_DIVISIONS.FINANCE), true);
});

test("API paths still require their own Equipment division", () => {
  assert.equal(
    requiredEquipmentDivisionForRequest({
      baseUrl: "/api/equipment-hire",
      path: "/contracts",
      method: "GET",
    }),
    EQUIPMENT_DIVISIONS.HIRE
  );
  assert.equal(
    requiredEquipmentDivisionForRequest({
      baseUrl: "/api/hire-commercial",
      path: "/rate-cards",
      method: "POST",
    }),
    EQUIPMENT_DIVISIONS.HIRE
  );
  assert.equal(
    requiredEquipmentDivisionForRequest({
      baseUrl: "/api/equipment-catalogue",
      path: "/sales/credit-applications",
      method: "GET",
    }),
    EQUIPMENT_DIVISIONS.FINANCE
  );
  assert.equal(
    requiredEquipmentDivisionForRequest({
      baseUrl: "/api/equipment-catalogue",
      path: "/assets/9",
      method: "PUT",
      user: hireUser,
    }),
    EQUIPMENT_DIVISIONS.HIRE
  );
  assert.equal(
    requiredEquipmentDivisionForRequest({
      baseUrl: "/api/equipment-catalogue",
      path: "/assets/9",
      method: "PUT",
      user: dualAccountant,
    }),
    EQUIPMENT_DIVISIONS.FINANCE,
    "approved dual accountant may maintain the shared machine register"
  );
  assert.equal(
    requiredEquipmentDivisionForRequest({
      baseUrl: "/api/equipment-catalogue",
      path: "/assets",
      method: "GET",
      user: financeUser,
    }),
    null,
    "shared equipment identity remains reference-readable"
  );
});

test("Finance compatibility permissions never unlock Hire APIs or auditor writes", () => {
  const readRequest = {
    baseUrl: "/api/equipment-catalogue",
    path: "/assets",
    method: "GET",
    user: { ...financeUser, effective_permissions: [] },
  };
  applyEquipmentDivisionCompatibilityPermissions(readRequest);
  assert.deepEqual(readRequest.user.effective_permissions, ["fleet.assets.view"]);

  const financeWriteRequest = {
    baseUrl: "/api/equipment-catalogue",
    path: "/sales/credit-applications",
    method: "POST",
    user: { ...financeManager, effective_permissions: [] },
  };
  applyEquipmentDivisionCompatibilityPermissions(financeWriteRequest);
  assert.deepEqual(financeWriteRequest.user.effective_permissions, [
    "fleet.assets.manage",
    "fleet.assets.view",
  ]);

  const sharedRegisterRequest = {
    baseUrl: "/api/equipment-catalogue",
    path: "/assets",
    method: "POST",
    user: { ...dualAccountant, effective_permissions: [] },
  };
  applyEquipmentDivisionCompatibilityPermissions(sharedRegisterRequest);
  assert.deepEqual(sharedRegisterRequest.user.effective_permissions, [
    "fleet.assets.manage",
    "fleet.assets.view",
  ]);

  const auditorWriteRequest = {
    baseUrl: "/api/equipment-catalogue",
    path: "/sales/credit-applications",
    method: "POST",
    user: { ...dualAuditor, effective_permissions: [] },
  };
  applyEquipmentDivisionCompatibilityPermissions(auditorWriteRequest);
  assert.deepEqual(auditorWriteRequest.user.effective_permissions, ["fleet.assets.view"]);

  const hireRequest = {
    baseUrl: "/api/equipment-hire",
    path: "/contracts",
    method: "GET",
    user: { ...financeManager, effective_permissions: [] },
  };
  applyEquipmentDivisionCompatibilityPermissions(hireRequest);
  assert.deepEqual(hireRequest.user.effective_permissions, []);
});

test("staff administration exposes controlled dual assignments and revokes sessions", () => {
  const category = read("backend", "services", "categoryIsolationService.js");
  const adminRoute = read("backend", "routes", "equipmentDivisionAdminRoutes.js");
  const roleTemplates = read(
    "backend",
    "security",
    "equipmentBusinessRoleTemplates.js"
  );
  const contextRoute = read("backend", "routes", "workspaceContextRoutes.js");
  const manager = read(
    "frontend",
    "src",
    "components",
    "EquipmentDivisionStaffManager.jsx"
  );

  assert.match(category, /EQUIPMENT_DIVISION_ACCESS_DENIED/);
  assert.match(category, /requiredEquipmentDivisionForRequest/);
  assert.match(category, /applyEquipmentDivisionCompatibilityPermissions/);
  assert.match(adminRoute, /Only the protected System Administrator/);
  assert.match(adminRoute, /dual_roles_require_explicit_approval: true/);
  assert.match(roleTemplates, /equipment_business_manager/);
  assert.match(roleTemplates, /equipment_business_accountant/);
  assert.match(roleTemplates, /equipment_business_auditor/);
  assert.match(roleTemplates, /division:\s*EQUIPMENT_DIVISIONS\.BOTH/);
  assert.match(adminRoute, /revokeUserSessions/);
  assert.match(adminRoute, /EQUIPMENT_STAFF_DIVISION_ASSIGNED/);
  assert.match(contextRoute, /router\.use\("\/equipment-divisions", equipmentDivisionAdminRoutes\)/);
  assert.match(manager, /Hire \+ Finance/);
  assert.match(manager, /roles\.both/);
  assert.match(manager, /Every API[\s\S]*exact action permission/);
});
