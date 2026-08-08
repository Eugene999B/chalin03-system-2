"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../..");
function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const migration = read("database/migrations/20260808_chalin_one_content_studio_identity.sql");
const verifier = read("database/migrations/20260808_chalin_one_content_studio_identity_verify.sql");
const authMiddleware = read("backend/middleware/authMiddleware.js");
const studioMiddleware = read("backend/middleware/contentStudioAccessMiddleware.js");
const studioAccess = read("backend/services/contentStudioAccessService.js");
const studioAuthRoutes = read("backend/routes/contentStudioAuthRoutes.js");
const studioAccessRoutes = read("backend/routes/contentStudioAccessRoutes.js");
const studioRoutes = read("backend/routes/contentStudioRoutes.js");
const systemRoutes = read("backend/routes/systemRoutes.js");
const permissionOverrides = read("backend/services/permissionOverrideService.js");
const bootstrap = read("backend/scripts/bootstrapChalinOneStaging.js");
const migrationRunner = read("backend/scripts/runChalinOneContentStudioIdentityMigration.js");

const ROLE_CODES = [
  "content_administrator",
  "editor",
  "news_editor",
  "media_manager",
  "reviewer",
  "publisher",
];

const TABLES = [
  "content_studio_roles",
  "content_studio_role_permissions",
  "content_studio_role_scopes",
  "content_studio_user_access",
];

test("Content Studio identity migration is additive and does not assign operational users", () => {
  assert.match(migration, /ADDITIVE MIGRATION ONLY/i);
  assert.match(migration, /BACKUP REQUIRED/i);
  for (const table of TABLES) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(verifier, new RegExp(table));
  }
  for (const role of ROLE_CODES) assert.match(migration, new RegExp(`'${role}'`));
  assert.match(migration, /access_mode ENUM\('studio_only', 'hybrid'\)/);
  assert.match(migration, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /20260808_chalin_one_content_studio_identity/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+content_studio_user_access\s*\([^)]*\)\s*SELECT/i);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|DATABASE)\b|\bTRUNCATE\b|\bDELETE\s+FROM\s+users\b/i);
});

test("Content Studio migration runner is gated to isolated databases", () => {
  assert.match(migrationRunner, /20260808_CHALIN_ONE_CONTENT_STUDIO_IDENTITY/);
  assert.match(migrationRunner, /CHALIN_ONE_ALLOW_CONTENT_STUDIO_IDENTITY_MIGRATION/);
  assert.match(migrationRunner, /CHALIN03_SIGNED_BACKUP_CONFIRMED/);
  assert.match(migrationRunner, /CHALIN03_SQL_BACKUP_CONFIRMED/);
  assert.match(migrationRunner, /SAFE_NON_PRODUCTION_DATABASE/);
  assert.match(migrationRunner, /acceptance\|staging\|development/);
  assert.match(migrationRunner, /Non-production Content Studio identity migration may target only isolated CHALIN ONE acceptance, staging or development databases/);
  assert.match(migrationRunner, /GET_LOCK/);
  assert.match(migrationRunner, /RELEASE_LOCK/);
});

test("Content Studio session is an API-whitelisted authentication domain", () => {
  assert.match(authMiddleware, /CONTENT_STUDIO_SESSION_BOUNDARY/);
  assert.match(authMiddleware, /contentStudioPathAllowedForSession/);
  assert.match(authMiddleware, /hydrateContentStudioSession/);
  assert.match(authMiddleware, /CONTENT_STUDIO_WORKSPACE_CODE/);
  assert.match(authMiddleware, /function trustedMatchedRequestPath/);
  assert.match(authMiddleware, /req\.baseUrl/);
  assert.match(authMiddleware, /req\.path/);
  assert.doesNotMatch(authMiddleware, /req\.originalUrl|req\.url/);
  assert.match(studioAccess, /const CONTENT_STUDIO_WORKSPACE_CODE = "content_studio"/);
  assert.match(studioAccess, /function scopeForContentStudioRequest/);
  assert.match(studioAccess, /req\?\.path/);
  assert.doesNotMatch(studioAccess, /req\?\.originalUrl|req\?\.url/);
  assert.match(studioAccess, /\/api\/content-studio-auth\/me/);
  assert.match(studioAccess, /\/api\/content-studio-auth\/change-password/);
  assert.match(studioAccess, /\/api\/auth\/logout/);
  assert.match(studioAccess, /\/api\/features\/staff/);
  assert.match(studioAccess, /path\.startsWith\("\/api\/content-studio\/"\)/);
  assert.doesNotMatch(studioAccess, /\/api\/(?:sales|products|mining|hire|backups|reports|workers)/);
});

test("Content Studio login is separate from operational Staff login", () => {
  assert.match(systemRoutes, /"\/content-studio-auth\/login", loginLimiter/);
  assert.match(systemRoutes, /requireContentStudioSession/);
  assert.match(systemRoutes, /"\/content-studio"[\s\S]*requireAuth[\s\S]*requireContentStudioSession/);
  assert.match(studioAuthRoutes, /workspaceCode: CONTENT_STUDIO_WORKSPACE_CODE/);
  assert.match(studioAuthRoutes, /workspace_code: CONTENT_STUDIO_WORKSPACE_CODE/);
  assert.match(studioAuthRoutes, /business_unit_id: null/);
  assert.match(studioAuthRoutes, /branch_id: null/);
  assert.match(studioAuthRoutes, /loadContentStudioAccess/);
  assert.match(studioAuthRoutes, /recordFailedLoginAttempt/);
  assert.match(studioAuthRoutes, /revokeAllUserSessions/);
});

test("Studio role scope and owner boundaries remain enforced before manager routes", () => {
  assert.match(studioMiddleware, /requireContentStudioRouteScope/);
  assert.match(studioMiddleware, /CONTENT_STUDIO_SCOPE_DENIED/);
  assert.match(studioMiddleware, /requireContentStudioOwner/);
  assert.match(studioMiddleware, /CONTENT_STUDIO_OWNER_REQUIRED/);
  assert.match(studioRoutes, /router\.use\(requireContentStudioRouteScope\)/);
  assert.match(studioRoutes, /router\.use\("\/access", contentStudioAccessRoutes\)/);
  assert.match(studioAccessRoutes, /router\.use\(requireContentStudioOwner\)/);
  assert.match(studioAccessRoutes, /'staff'/);
  assert.match(studioAccessRoutes, /'studio_only'/);
  assert.match(studioAccessRoutes, /default_branch_id[\s\S]*NULL/);
  assert.match(studioAccessRoutes, /can_access_all_branches[\s\S]*FALSE/);
  assert.match(studioAccessRoutes, /must_change_password[\s\S]*TRUE/);
});

test("operational permissions cannot recreate Content Studio access", () => {
  assert.match(permissionOverrides, /CONTENT_STUDIO_PERMISSION_SET/);
  assert.match(permissionOverrides, /operationalOnly/);
  assert.match(permissionOverrides, /CONTENT_STUDIO_PERMISSION_DOMAIN_SEPARATE/);
  assert.match(permissionOverrides, /Content Studio access is managed only through the Content Studio role system/);
  assert.match(permissionOverrides, /return operationalOnly\(applyPermissionOverrides/);
});

test("staging reviewer and publisher are converted to dedicated Studio-only governance identities", () => {
  assert.match(bootstrap, /\[reviewerId, "reviewer"\]/);
  assert.match(bootstrap, /\[publisherId, "publisher"\]/);
  assert.match(bootstrap, /access_mode, is_active/);
  assert.match(bootstrap, /'studio_only'/);
  assert.match(bootstrap, /SET role = 'staff'/);
  assert.match(bootstrap, /default_branch_id = NULL/);
  assert.match(bootstrap, /disableLegacyBranchAccess/);
  assert.match(bootstrap, /disableLegacyBusinessAccess/);
  assert.match(bootstrap, /category_assignment_status = 'unassigned'/);
});
