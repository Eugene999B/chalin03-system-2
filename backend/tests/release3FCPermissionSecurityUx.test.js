const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  applyPermissionOverrides,
  buildPermissionDescriptors,
  validateOverridePolicy,
} = require("../services/permissionOverrideService");

const ROOT = path.resolve(__dirname, "..", "..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Release 3F-C explicit deny overrides role and explicit allow", () => {
  const result = applyPermissionOverrides(
    ["workspace.view", "spare_parts.sell"],
    [
      { permission_code: "installments.view", effect: "allow" },
      { permission_code: "spare_parts.sell", effect: "allow" },
      { permission_code: "spare_parts.sell", effect: "deny" },
    ]
  );

  assert.deepEqual(result, ["installments.view", "workspace.view"]);
});

test("Release 3F-C permission catalog labels every code and protects the immutable owner", () => {
  const descriptors = buildPermissionDescriptors("spare_parts");
  const permissionManager = descriptors.find(
    (item) => item.code === "users.permissions.manage"
  );
  const sparePartsSale = descriptors.find(
    (item) => item.code === "spare_parts.sell"
  );
  const securityAdmin = descriptors.find(
    (item) => item.code === "security.admin"
  );

  assert.ok(permissionManager);
  assert.equal(permissionManager.category, "Users and Permissions");
  assert.equal(permissionManager.owner_protected, true);
  assert.equal(sparePartsSale.owner_protected, true);
  assert.equal(securityAdmin, undefined);

  const protectedOwnerResult = validateOverridePolicy({
    targetUser: { id: 1, username: "admin", role: "admin" },
    permissionCode: "spare_parts.sell",
    effect: "deny",
    workspaceCode: "spare_parts",
  });
  assert.equal(protectedOwnerResult.code, "OWNER_PERMISSION_IMMUTABLE");
});

test("Release 3F-C blocks every override for original administrator", () => {
  for (const effect of ["allow", "deny"]) {
    const result = validateOverridePolicy({
      targetUser: { id: 1, username: "admin", role: "admin" },
      permissionCode: "spare_parts.sell",
      effect,
      workspaceCode: "spare_parts",
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "OWNER_PERMISSION_IMMUTABLE");
  }
});

test("Release 3F-C blocks protected administration grants to non-admin users", () => {
  const result = validateOverridePolicy({
    targetUser: { id: 9, username: "cashier", role: "cashier" },
    permissionCode: "users.permissions.manage",
    effect: "allow",
    workspaceCode: "spare_parts",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "ADMIN_PERMISSION_PROTECTED");
});

test("Release 3F-C migration is additive and creates only control tables", () => {
  const migration = read(
    "database/migrations/20260718_release3fc_user_permissions_security_messages.sql"
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_permission_overrides/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS security_event_dismissals/);
  assert.match(migration, /release3fc_user_permissions_security_messages/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM users|DELETE FROM activity_log/i);
});

test("Release 3F-C API requires protected actions, reason and session control", () => {
  const routes = read("backend/routes/userPermissionRoutes.js");

  assert.match(routes, /requirePermission\("users\.permissions\.manage"\)/);
  assert.match(routes, /requireProtectedAction/);
  assert.match(routes, /reason\.length < 8/);
  assert.match(routes, /permission_override_changed/);
  assert.match(routes, /token_version = COALESCE\(token_version, 0\) \+ 1/);
  assert.match(routes, /reset-permission/);
  assert.match(routes, /reset-all/);
});

test("Release 3F-C Security Centre deletes only the message view, not audit evidence", () => {
  const routes = read("backend/routes/release2FinalRoutes.js");
  const page = read("frontend/src/pages/Release2FinalControlPage.jsx");

  assert.match(routes, /security\/events\/dismiss/);
  assert.match(routes, /security_event_dismissals/);
  assert.match(routes, /evidence_deleted: false/);
  assert.doesNotMatch(routes, /DELETE FROM activity_log/);
  assert.match(page, /Delete message/);
  assert.match(page, /underlying audit evidence will remain protected/i);
});

test("Release 3F-C active login component clears and resists password autofill", () => {
  const loginEntry = read("frontend/src/pages/LoginPage.jsx");
  const loginPage = read("frontend/src/pages/LoginPageGroupOperations.jsx");

  assert.match(loginEntry, /LoginPageGroupOperations/);
  assert.match(loginPage, /function clearPasswordField/);
  assert.match(loginPage, /window\.addEventListener\("pageshow", clearPasswordField\)/);
  assert.match(loginPage, /autoComplete="off"/);
  assert.match(loginPage, /autoComplete="new-password"/);
  assert.match(loginPage, /readOnly=\{!passwordUnlocked\}/);
  assert.match(loginPage, /data-lpignore="true"/);
  assert.doesNotMatch(loginPage, /name="chalin03_login_password"/);
});

test("Release 3F-C frontend registers the permission manager route and sidebar", () => {
  const app = read("frontend/src/App.jsx");
  const layout = read("frontend/src/components/Layout.jsx");
  const page = read("frontend/src/pages/UserPermissionManagerPage.jsx");

  assert.match(app, /path="user-permissions"/);
  assert.match(app, /users\.permissions\.manage/);
  assert.match(layout, /title: "User Permissions"/);
  assert.match(page, /Explicit deny overrides/);
  assert.match(page, /Reset all to role defaults/);
  assert.match(page, /X-Protected-Action-Token/);
});

test("Release 3F-C controls are included by the exact dynamic backup contract", () => {
  const backupRoutes = read("backend/routes/backupRoutes.js");
  const backupSafety = read("backend/services/backupSafetyService.js");
  const system = read("backend/routes/systemRoutes.js");
  const systemPage = read("frontend/src/pages/SystemOperationsPage.jsx");

  assert.match(backupRoutes, /getAllBaseTables/);
  assert.match(backupRoutes, /information_schema\.TABLES/);
  assert.match(backupSafety, /currentIncludedTables/);
  assert.match(backupSafety, /Backup is missing current required tables/);
  assert.doesNotMatch(backupRoutes, /const PREFERRED_TABLE_ORDER/);
  assert.match(system, /permissionControlStatus/);
  assert.match(systemPage, /Open User Permission Manager/);
  assert.match(systemPage, /Delegated System Administrator/);
});
