const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("user offboarding preserves historical identity and removes physical deletion", () => {
  const routeSource = read("backend/routes/userRoutes.js");
  const serviceSource = read(
    "backend/services/userIdentityPreservationService.js"
  );
  const frontendSource = read("frontend/src/pages/UsersSettingsPage.jsx");

  assert.doesNotMatch(routeSource, /DELETE\s+FROM\s+users/i);
  assert.doesNotMatch(routeSource, /clearUserReferencesBeforeDelete/);
  assert.doesNotMatch(routeSource, /setUserReferenceToNull/);
  assert.doesNotMatch(routeSource, /Permanently deleted user/i);
  assert.match(routeSource, /USER_DEACTIVATED_PRESERVED/);
  assert.match(routeSource, /SECURE_OFFBOARD_USER/);
  assert.match(routeSource, /secureDeactivateUser/);
  assert.match(routeSource, /revokeAllUserSessions/);

  assert.match(serviceSource, /identity_preserved: true/);
  assert.match(serviceSource, /historical_references_preserved: true/);
  assert.match(serviceSource, /user_branch_access/);
  assert.match(serviceSource, /user_business_access/);
  assert.match(serviceSource, /user_mining_site_access/);
  assert.match(serviceSource, /user_hire_location_access/);
  assert.match(serviceSource, /user_permission_overrides/);
  assert.match(serviceSource, /auth_sessions/);
  assert.doesNotMatch(serviceSource, /DELETE\s+FROM/i);
  assert.doesNotMatch(serviceSource, /SET\s+[`A-Za-z0-9_]*user_id[`A-Za-z0-9_]*\s*=\s*NULL/i);

  assert.doesNotMatch(frontendSource, /deleteUserAccount/);
  assert.doesNotMatch(frontendSource, /Delete Account/);
  assert.doesNotMatch(frontendSource, /permanently delete/i);
  assert.match(frontendSource, /Secure Offboard/);
  assert.match(frontendSource, /OFFBOARD \$\{user\.username\}/);
  assert.match(frontendSource, /preserv(?:e|ing) historical/i);
});

test("temporary disable revokes sessions without erasing assigned access", () => {
  const routeSource = read("backend/routes/userRoutes.js");
  const toggleStart = routeSource.indexOf("// PATCH /api/users/:id/toggle-status");
  const offboardStart = routeSource.indexOf(
    "// DELETE /api/users/:id — compatibility endpoint for secure offboarding"
  );
  assert.notEqual(toggleStart, -1);
  assert.notEqual(offboardStart, -1);
  const toggleSection = routeSource.slice(toggleStart, offboardStart);

  assert.match(toggleSection, /revokeAllUserSessions/);
  assert.match(toggleSection, /account_disabled/);
  assert.match(toggleSection, /assigned access was retained/);
  assert.doesNotMatch(toggleSection, /user_branch_access/);
  assert.doesNotMatch(toggleSection, /user_business_access/);
});
