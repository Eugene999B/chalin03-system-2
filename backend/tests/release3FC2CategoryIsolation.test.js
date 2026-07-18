const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  getEffectivePermissions,
  permissionsForWorkspace,
} = require("../security/permissionCatalog");
const {
  isOriginalSystemAdministrator,
} = require("../security/systemAdminIdentity");
const {
  getBusinessUnitId,
  normalizeCategory,
} = require("../services/categoryIsolationService");

const ROOT = path.resolve(__dirname, "..", "..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function extractArray(source, variableName) {
  const match = source.match(
    new RegExp(`const ${variableName} = \\[([\\s\\S]*?)\\n\\];`)
  );
  assert.ok(match, `${variableName} must exist`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

test("Release 3F-C2 protects exactly one original cross-category System Administrator", () => {
  assert.equal(
    isOriginalSystemAdministrator({ id: 1, username: "admin", role: "admin" }),
    true
  );
  assert.equal(
    isOriginalSystemAdministrator({ id: 2, username: "admin", role: "admin" }),
    false
  );
  assert.equal(
    isOriginalSystemAdministrator({ id: 1, username: "other", role: "admin" }),
    false
  );

  const originalPermissions = getEffectivePermissions({
    id: 1,
    username: "admin",
    role: "admin",
    workspace_code: "mining",
  });
  assert.equal(originalPermissions.includes("spare_parts.sell"), true);
  assert.equal(originalPermissions.includes("mining.production.approve"), true);
  assert.equal(originalPermissions.includes("hire.payments.manage"), true);
});

test("Release 3F-C2 category administrators receive no other category or global owner controls", () => {
  const miningAdmin = getEffectivePermissions({
    id: 11,
    username: "mine-admin",
    role: "admin",
    workspace_code: "mining",
    workspace_role: "manager",
  });

  assert.equal(miningAdmin.includes("mining.production.approve"), true);
  assert.equal(miningAdmin.includes("users.permissions.manage"), true);
  assert.equal(miningAdmin.includes("hire.payments.manage"), false);
  assert.equal(miningAdmin.includes("spare_parts.sell"), false);
  assert.equal(miningAdmin.includes("backup.restore"), false);
  assert.equal(miningAdmin.includes("security.admin"), false);
  assert.equal(miningAdmin.includes("executive.operations.view"), false);

  const miningCatalog = permissionsForWorkspace("mining");
  assert.equal(miningCatalog.includes("hire.payments.manage"), false);
  assert.equal(miningCatalog.includes("spare_parts.sell"), false);
  assert.equal(miningCatalog.includes("backup.restore"), false);
});

test("Release 3F-C2 safe migration preserves ambiguous assignments for explicit review", () => {
  const migration = read(
    "database/migrations/20260718_release3fc2_category_isolation_guides_receipts_workers.sql"
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_category_assignment_conflicts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS worker_category_assignment_conflicts/);
  assert.match(migration, /category_assignment_status[\s\S]*'conflict_review'/);
  assert.match(migration, /Access was preserved but login is blocked/i);
  assert.match(migration, /role = 'admin'[\s\S]*id = 1[\s\S]*LOWER\(username\) = 'admin'/);
  assert.doesNotMatch(
    migration,
    /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM\s+(?:users|worker_profiles|user_business_access)/i
  );
});

test("Release 3F-C2 permission API isolates user lists, targets, resets and conflict review", () => {
  const routes = read("backend/routes/userPermissionRoutes.js");

  assert.match(routes, /requesterCanViewTarget/);
  assert.match(routes, /requesterCanManageTarget/);
  assert.match(routes, /CATEGORY_ASSIGNMENT_REVIEW_REQUIRED/);
  assert.match(routes, /u\.category_assignment_status = 'assigned'/);
  assert.match(routes, /can_review_conflicts: false/);
  assert.match(routes, /Only the original System Administrator can resolve category conflicts/);
  assert.match(routes, /revokeUserSessions|revokeTargetAccess/);
});

test("Release 3F-C2 login and API middleware enforce the selected category", () => {
  const auth = read("backend/routes/authRoutes.js");
  const categoryService = read("backend/services/categoryIsolationService.js");
  const middleware = read("backend/middleware/workerCategoryMiddleware.js");
  const server = read("backend/server.js");

  assert.match(auth, /validateUserCategoryAccess/);
  assert.match(categoryService, /CATEGORY_ASSIGNMENT_CONFLICT/);
  assert.match(auth, /is_original_system_administrator/);
  assert.match(middleware, /WORKER_CATEGORY_ACCESS_DENIED|WORKER_CATEGORY_CONFLICT/);
  assert.match(server, /requireWorkspaceCategory\("spare_parts"\)/);
  assert.match(server, /requireWorkspaceCategory\("mining"\)/);
  assert.match(server, /requireWorkspaceCategory\("equipment_hire"\)/);
});

test("Release 3F-C2 worker profiles and linked users are category-scoped", () => {
  const workers = read("backend/routes/workerProfileExpansionRoutes.js");
  const legacyWorkers = read("backend/routes/release2FinalRoutes.js");

  assert.match(workers, /wp\.workspace_code = \?/);
  assert.match(workers, /primary_workspace_code = \?/);
  assert.match(workers, /workerExists\(workerId, req\)/);
  assert.match(workers, /business_unit_id/);
  assert.match(legacyWorkers, /wp\.workspace_code = \?/);
  assert.match(legacyWorkers, /normalizeCategory\(req\.user\?\.workspace_code\)/);
});

test("Release 3F-C2 Spare Parts uses no business unit id for worker isolation", async () => {
  let queried = false;
  const connection = {
    query: async () => {
      queried = true;
      return [[{ id: 99 }]];
    },
  };

  assert.equal(normalizeCategory("Spare Parts"), "spare_parts");
  assert.equal(await getBusinessUnitId("spare_parts", connection), null);
  assert.equal(queried, false);
  assert.equal(await getBusinessUnitId("mining", connection), 99);
  assert.equal(queried, true);
});

test("Release 3F-C2 receipts use each store Business Phone as its MoMo number", () => {
  const receipt = read("backend/routes/receiptRoutes.js");
  const sales = read("backend/routes/saleRoutes.js");
  const settingsPage = read("frontend/src/pages/UsersSettingsPage.jsx");

  assert.match(receipt, /const momoNumber = settings\.business_phone/);
  assert.match(sales, /momo_number: settings\.business_phone/);
  assert.match(settingsPage, /Business Phone \/ Receipt MoMo Number/);
  assert.match(settingsPage, /Shown on this store.*receipt as telephone and MoMo number/s);
});

test("Release 3F-C2 has distinct category guides and corrected Equipment Hire icons", () => {
  const spareGuide = read("docs/SPARE_PARTS_USER_GUIDE.md");
  const miningGuide = read("docs/MINING_OPERATIONS_GUIDE.md");
  const hireGuide = read("docs/EQUIPMENT_HIRE_GUIDE.md");
  const spareHelp = read("frontend/src/pages/HelpPage.jsx");
  const help = read("frontend/src/pages/WorkspaceHelpPage.jsx");
  const app = read("frontend/src/App.jsx");
  const hireLayout = read("frontend/src/layouts/EquipmentHireLayout.jsx");

  assert.match(spareGuide, /Spare Parts/i);
  assert.match(spareGuide, /Business Phone.*MoMo/is);
  assert.match(miningGuide, /Mining Operations/i);
  assert.match(hireGuide, /Equipment Hire/i);
  assert.match(spareHelp, /Spare Parts/);
  assert.match(help, /mining/);
  assert.match(help, /equipment_hire/);
  assert.match(app, /<HelpPage \/>/);
  assert.match(app, /WorkspaceHelpPage workspace="mining"/);
  assert.match(app, /WorkspaceHelpPage workspace="equipment_hire"/);
  assert.match(hireLayout, /icon="🏗️"/);
  assert.doesNotMatch(hireLayout, /\\u\{/);
});

test("Release 3F-C2 full-system backup covers permissions, conflicts and independent workers", () => {
  const backupSource = read("backend/routes/backupRoutes.js");
  const resetSource = read("backend/scripts/resetDatabaseFromBackup.js");
  const verifySource = read("backend/scripts/verifyRestoredDatabase.js");

  const backupTables = extractArray(backupSource, "PREFERRED_TABLE_ORDER");
  const resetTables = extractArray(resetSource, "CANONICAL_TABLES");
  const verifyTables = extractArray(verifySource, "APPLICATION_TABLES");
  const required = [
    "user_permission_overrides",
    "user_category_assignment_conflicts",
    "worker_profiles",
    "worker_assignments",
    "worker_documents",
    "worker_category_assignment_conflicts",
    "security_event_dismissals",
  ];

  for (const table of required) {
    assert.equal(backupTables.includes(table), true, `${table} missing from backup`);
    assert.equal(resetTables.includes(table), true, `${table} missing from reset`);
    assert.equal(verifyTables.includes(table), true, `${table} missing from verification`);
  }

  assert.ok(backupTables.indexOf("worker_profiles") < backupTables.indexOf("worker_category_assignment_conflicts"));
});

test("Release 3F-C2 group-wide views are original-System-Administrator only", () => {
  const executive = read("backend/routes/groupExecutiveRoutes.js");
  const notifications = read("backend/services/notificationService.js");
  const shared = read("backend/services/sharedControlService.js");
  const activity = read("backend/routes/activityRoutes.js");
  const layout = read("frontend/src/components/Layout.jsx");

  assert.match(executive, /isOriginalSystemAdministrator/);
  assert.match(notifications, /isOriginalSystemAdministrator/);
  assert.match(shared, /isOriginalSystemAdministrator/);
  assert.match(activity, /isOriginalSystemAdministrator/);
  assert.match(layout, /is_original_system_administrator/);
  assert.match(layout, /isSystemAdministrator/);
});
