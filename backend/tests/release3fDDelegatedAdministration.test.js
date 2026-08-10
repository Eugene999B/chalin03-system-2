const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Release 3F-D keeps both production domains in the explicit CORS allowlist", () => {
  const server = read("backend/server.js");
  assert.match(server, /"https:\/\/chalin03\.com"/);
  assert.match(server, /"https:\/\/www\.chalin03\.com"/);
  assert.match(server, /process\.env\.FRONTEND_URL/);
  assert.match(server, /process\.env\.FRONTEND_URL_ALT/);
});

test("Release 3F-D protects high-risk administration behind owner delegation", () => {
  const server = read("backend/server.js");
  const middleware = read(
    "backend/middleware/delegatedAdministrationMiddleware.js"
  );
  assert.match(server, /requireDelegatedCapability\("system_operations"\)/);
  assert.match(server, /requireDelegatedCapability\("manage_permissions"\)/);
  assert.match(server, /delegatedUserAdministrationGate/);
  assert.match(middleware, /ORIGINAL_OWNER_PROTECTED/);
  assert.match(middleware, /manage_administrators/);
});

test("Release 3F-D reuses audited permission overrides for delegated authority", () => {
  const service = read(
    "backend/services/delegatedAdministrationService.js"
  );
  assert.match(service, /DELEGATED_PERMISSION_PREFIX = "delegated_admin\."/);
  assert.match(service, /user_permission_overrides/);
  assert.match(service, /reason/);
  assert.match(service, /expires_at/);
  assert.match(service, /revoked_at/);
  assert.match(service, /original_system_administrator/);
});

test("Release 3F-D delegation changes require password confirmation and revoke sessions", () => {
  const routes = read("backend/routes/delegatedAdministrationRoutes.js");
  assert.match(routes, /requireProtectedAction/);
  assert.match(routes, /token_version = COALESCE\(token_version, 0\) \+ 1/);
  assert.match(routes, /revokeAllUserSessions/);
  assert.match(routes, /ORIGINAL_OWNER_PROTECTED/);
  assert.match(routes, /appendLedger/);
});

test("Release 3F-D delegated restore validates owner identity and clears old sessions", () => {
  const routes = read("backend/routes/delegatedBackupRoutes.js");
  assert.match(routes, /configuredOwnerPresent/);
  assert.match(routes, /requesterPresent/);
  assert.match(routes, /ALLOW_WEB_RESTORE/);
  assert.match(routes, /RESTORE_FULL_SYSTEM_BACKUP/);
  assert.match(routes, /EPHEMERAL_SECURITY_TABLES/);
  assert.match(routes, /DELEGATED_FULL_BACKUP_RESTORED/);
});

test("Release 3F-D System Operations exposes Railway and delegated authority evidence", () => {
  const routes = read("backend/routes/systemRoutes.js");
  const page = read("frontend/src/pages/SystemOperationsPage.jsx");
  assert.match(routes, /RAILWAY_GIT_COMMIT_SHA/);
  assert.match(routes, /delegatedAuthorityCounts/);
  assert.match(routes, /canonical_frontend: "https:\/\/chalin03\.com"/);
  assert.match(page, /Delegated System Administrator/);
  assert.match(page, /\/delegated-administration\/authorities/);
  assert.match(page, /X-Protected-Action-Token/);
});

test("Release 3F-D Backup page requires protected validation before restore", () => {
  const page = read("frontend/src/pages/BackupPage.jsx");
  assert.match(page, /\/release2-final\/security\/unlock/);
  assert.match(page, /backupRequestUrl\("\/restore\/dry-run"\)/);
  assert.match(page, /const validation = await validateSelectedBackup\(\)/);
  assert.match(page, /if \(!validation\?\.report\?\.valid\) return/);
  assert.match(page, /backupRequestUrl\("\/restore"\)/);
  assert.match(page, /RESTORE_FULL_SYSTEM_BACKUP/);
  assert.match(page, /X-Protected-Action-Token/);
});