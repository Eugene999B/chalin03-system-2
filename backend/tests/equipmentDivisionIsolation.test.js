const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const {
  EQUIPMENT_DIVISIONS,
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
const systemAdministrator = {
  id: 1,
  username: "admin",
  role: "admin",
  workspace_code: "equipment_hire",
  workspace_role: "group_admin",
  effective_permissions: [],
};

test("Hire and Finance role families are non-overlapping", () => {
  for (const role of HIRE_WORKSPACE_ROLES) {
    assert.equal(FINANCE_WORKSPACE_ROLES.has(role), false, `${role} crossed divisions`);
  }
  assert.equal(hasEquipmentDivisionAccess(hireUser, EQUIPMENT_DIVISIONS.HIRE), true);
  assert.equal(hasEquipmentDivisionAccess(hireUser, EQUIPMENT_DIVISIONS.FINANCE), false);
  assert.equal(hasEquipmentDivisionAccess(financeUser, EQUIPMENT_DIVISIONS.FINANCE), true);
  assert.equal(hasEquipmentDivisionAccess(financeUser, EQUIPMENT_DIVISIONS.HIRE), false);
  assert.equal(hasEquipmentDivisionAccess(systemAdministrator, EQUIPMENT_DIVISIONS.HIRE), true);
  assert.equal(hasEquipmentDivisionAccess(systemAdministrator, EQUIPMENT_DIVISIONS.FINANCE), true);
});

test("API paths require their own Equipment division", () => {
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
    }),
    EQUIPMENT_DIVISIONS.HIRE
  );
  assert.equal(
    requiredEquipmentDivisionForRequest({
      baseUrl: "/api/equipment-catalogue",
      path: "/assets",
      method: "GET",
    }),
    null,
    "shared equipment identity must be reference-only"
  );
});

test("Finance compatibility permissions are request-local and never unlock Hire APIs", () => {
  const readRequest = {
    baseUrl: "/api/equipment-catalogue",
    path: "/assets",
    method: "GET",
    user: { ...financeUser, effective_permissions: [] },
  };
  applyEquipmentDivisionCompatibilityPermissions(readRequest);
  assert.deepEqual(readRequest.user.effective_permissions, ["fleet.assets.view"]);

  const writeRequest = {
    baseUrl: "/api/equipment-catalogue",
    path: "/sales/credit-applications",
    method: "POST",
    user: { ...financeManager, effective_permissions: [] },
  };
  applyEquipmentDivisionCompatibilityPermissions(writeRequest);
  assert.deepEqual(writeRequest.user.effective_permissions, [
    "fleet.assets.manage",
    "fleet.assets.view",
  ]);

  const hireRequest = {
    baseUrl: "/api/equipment-hire",
    path: "/contracts",
    method: "GET",
    user: { ...financeManager, effective_permissions: [] },
  };
  applyEquipmentDivisionCompatibilityPermissions(hireRequest);
  assert.deepEqual(hireRequest.user.effective_permissions, []);
});

test("category and staff administration sources enforce the hard boundary", () => {
  const category = read("backend", "services", "categoryIsolationService.js");
  const adminRoute = read("backend", "routes", "equipmentDivisionAdminRoutes.js");
  const contextRoute = read("backend", "routes", "workspaceContextRoutes.js");

  assert.match(category, /EQUIPMENT_DIVISION_ACCESS_DENIED/);
  assert.match(category, /requiredEquipmentDivisionForRequest/);
  assert.match(category, /applyEquipmentDivisionCompatibilityPermissions/);
  assert.match(adminRoute, /Only the protected System Administrator/);
  assert.match(adminRoute, /ordinary_staff_may_access_both: false/);
  assert.match(adminRoute, /revokeUserSessions/);
  assert.match(adminRoute, /EQUIPMENT_STAFF_DIVISION_ASSIGNED/);
  assert.match(contextRoute, /router\.use\("\/equipment-divisions", equipmentDivisionAdminRoutes\)/);
});
