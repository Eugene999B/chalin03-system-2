const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("delegated System Administrator can operate across Chalin03 businesses", () => {
  const category = read("services/categoryIsolationService.js");
  const permissions = read("services/permissionOverrideService.js");
  const equipment = read("security/equipmentDivisionAccess.js");
  const bootstrap = read("scripts/bootstrapRequestedSystemAdministrator.js");

  assert.match(category, /isDelegatedSystemAdministrator/);
  assert.match(category, /hasDelegatedCapability/);
  assert.match(category, /primary_workspace_code:\s*"\*"/);

  assert.match(permissions, /hasDelegatedCapability/);
  assert.match(permissions, /return uniquePermissions\(ALL_PERMISSIONS\)/);

  assert.match(equipment, /primary_workspace_code/);
  assert.match(equipment, /=== "\*"/);

  assert.match(bootstrap, /must_change_password = TRUE/);
  assert.match(bootstrap, /login_phone_normalized/);
  assert.match(bootstrap, /can_access_all_branches = TRUE/);
  assert.match(bootstrap, /category_assignment_status = 'system_admin'/);
  assert.match(bootstrap, /grantDelegatedAuthority/);
  assert.match(bootstrap, /manage_administrators:\s*true/);
  assert.match(bootstrap, /backup_restore:\s*true/);
  assert.doesNotMatch(
    bootstrap,
    /REQUESTED_SYSTEM_ADMIN_TEMP_PASSWORD\s*=\s*["'][^"']+["']/
  );
});

test("System Administrator login phone is separate from boss and receipt phones", () => {
  const settings = read("routes/settingsRoutes.js");
  const usersPage = read("../frontend/src/pages/UsersSettingsPage.jsx");

  assert.match(settings, /system-admin-login-phone/);
  assert.match(settings, /normalizedPhoneForStorage/);
  assert.match(settings, /UPDATE_SYSTEM_ADMIN_LOGIN_PHONE/);
  assert.match(settings, /Owner Security Alert Phone/);
  assert.match(settings, /Business Phone \/ Receipt MoMo Number/);

  assert.match(usersPage, /Protected System Administrator Login/);
  assert.match(usersPage, /System Administrator Login Phone/);
  assert.match(usersPage, /\/settings\/system-admin-login-phone/);
  assert.match(usersPage, /Owner Security Alert Phone/);
  assert.match(usersPage, /Business Phone \/ Receipt MoMo Number/);
});
