const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const templates = read(
  "backend",
  "security",
  "equipmentBusinessRoleTemplates.js"
);
const overrides = read(
  "backend",
  "services",
  "permissionOverrideService.js"
);
const divisionAdmin = read(
  "backend",
  "routes",
  "equipmentDivisionAdminRoutes.js"
);
const contextRouter = read(
  "backend",
  "routes",
  "workspaceContextRoutes.js"
);
const workerProfiles = read(
  "backend",
  "routes",
  "workerProfileExpansionRoutes.js"
);
const workerPrint = read(
  "backend",
  "routes",
  "workerPrintRoutes.js"
);

test("Phase 2 defines Hire, Finance and approved dual role templates", () => {
  for (const role of [
    "manager",
    "hire_officer",
    "dispatcher",
    "fleet_officer",
    "accountant",
    "auditor",
    "finance_manager",
    "credit_officer",
    "collections_officer",
    "finance_accountant",
    "finance_auditor",
    "equipment_business_manager",
    "equipment_business_accountant",
    "equipment_business_auditor",
  ]) {
    assert.match(templates, new RegExp(`${role}:\\s*\\{`));
  }

  assert.match(templates, /division:\s*EQUIPMENT_DIVISIONS\.HIRE/);
  assert.match(templates, /division:\s*EQUIPMENT_DIVISIONS\.FINANCE/);
  assert.match(templates, /division:\s*EQUIPMENT_DIVISIONS\.BOTH/);
  assert.match(templates, /workers\.manage/);
  assert.match(templates, /workers\.documents\.manage/);
  assert.match(templates, /fleet\.assets\.manage/);
});

test("role defaults are resolved before protected allow and deny overrides", () => {
  assert.match(overrides, /equipmentRoleDefaultPermissions/);
  assert.match(overrides, /function roleDefaultPermissions/);
  assert.match(overrides, /\.\.\.getEffectivePermissions\(session\)/);
  assert.match(overrides, /\.\.\.equipmentRoleDefaultPermissions/);
  assert.match(overrides, /const basePermissions = roleDefaultPermissions/);
  assert.match(overrides, /return applyPermissionOverrides\(basePermissions, overrides\)/);
  assert.match(overrides, /for \(const permissionCode of denied\)[\s\S]*allowed\.delete/);
});

test("System Administrator can create staff logins and exact division assignments", () => {
  assert.match(contextRouter, /router\.use\("\/equipment-divisions", equipmentDivisionAdminRoutes\)/);
  assert.match(divisionAdmin, /router\.use\(requireSystemAdministrator\)/);
  assert.match(divisionAdmin, /router\.post\("\/staff"/);
  assert.match(divisionAdmin, /bcrypt\.hash\(temporaryPassword, 10\)/);
  assert.match(divisionAdmin, /must_change_password/);
  assert.match(divisionAdmin, /primary_workspace_code, category_assignment_status/);
  assert.match(divisionAdmin, /'equipment_hire', 'assigned'/);
  assert.match(divisionAdmin, /user_business_access/);
  assert.match(divisionAdmin, /user_hire_location_access/);
  assert.match(divisionAdmin, /template\.division === EQUIPMENT_DIVISIONS\.FINANCE/);
  assert.match(divisionAdmin, /disableLocations\(connection, targetUserId\)/);
  assert.match(divisionAdmin, /revokeUserSessions/);
  assert.match(divisionAdmin, /EQUIPMENT_STAFF_LOGIN_CREATED/);
  assert.match(divisionAdmin, /EQUIPMENT_STAFF_DIVISION_ASSIGNED/);
});

test("worker profiles, ID cards and private employment documents remain protected", () => {
  assert.match(workerProfiles, /\/workers-expanded/);
  assert.match(workerProfiles, /allocateWorkerIdentity/);
  assert.match(workerProfiles, /reissue-id-card/);
  assert.match(workerProfiles, /worker_private_files/);
  assert.match(workerProfiles, /checksum_sha256/);
  assert.match(workerProfiles, /requirePermission\("workers\.documents\.view"\)/);
  assert.match(workerPrint, /buildExactCr80CardPdf/);
  assert.match(workerPrint, /buildA4ProofCardPdf/);
  assert.match(workerPrint, /OFFICIAL PERSONNEL IDENTIFICATION/);
  assert.match(workerPrint, /Private Document Register/);
});