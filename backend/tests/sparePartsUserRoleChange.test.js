"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backend = fs.readFileSync(path.join(__dirname, "../routes/userRoutes.js"), "utf8");
const page = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/UsersSettingsPage.jsx"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

function roleHandler() {
  const start = backend.indexOf('// PATCH /api/users/:id/role');
  const end = backend.indexOf('// PUT /api/users/:id', start);
  assert.ok(start >= 0 && end > start, "Dedicated user-role endpoint is registered");
  return backend.slice(start, end);
}

test("Role changes require authenticated admin and the central delegated authority gate", () => {
  const source = roleHandler();
  assert.match(source, /router\.patch\("\/:id\/role", requireAuth, requireRole\("admin"\)/);
  assert.match(server, /"\/api\/users",[\s\S]*?delegatedUserAdministrationGate,[\s\S]*?userRoutes/);
  assert.match(source, /Set\(\["admin", "manager", "cashier", "auditor", "staff"\]\)/);
  assert.match(source, /targetUserId === Number\(req\.user\?\.id\)/);
});

test("Role changes protect the original owner, category isolation and privilege elevation", () => {
  const source = roleHandler();
  assert.match(source, /isOriginalSystemAdministrator\(target\)/);
  assert.match(source, /targetUserId === SYSTEM_ADMIN_ID/);
  assert.match(source, /target\.primary_workspace_code/);
  assert.match(source, /target\.category_assignment_status/);
  assert.match(source, /newRole === "admin" && !originalOwner/);
  assert.match(source, /activeAdminCountExcluding\(connection, targetUserId\)/);
});

test("Role changes are atomic, audited and invalidate affected staff sessions", () => {
  const source = roleHandler();
  assert.match(source, /await connection\.beginTransaction\(\)/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /token_version = token_version \+ 1/);
  assert.match(source, /CHANGE_USER_ROLE/);
  assert.match(source, /await connection\.commit\(\)/);
  assert.match(source, /revokeAllUserSessions\(targetUserId, "role_changed"\)/);
  assert.match(source, /can_access_all_branches = CASE WHEN \? THEN FALSE/);
  assert.match(source, /DELETE FROM user_branch_access/);
  assert.doesNotMatch(source, /UPDATE (?:sales|payments|products|equipment_sale_payments)/);
});

test("Each ordinary user has a Change Role control, a save button and re-login notice", () => {
  assert.match(page, /htmlFor=\{\x60role-for-user-\$\{user\.id\}\x60\}/);
  assert.match(page, /Change Role/);
  assert.match(page, /Save Role/);
  assert.match(page, /roleDraftByUser\[user\.id\]/);
  assert.match(page, /axiosClient\.patch\(\x60\/users\/\$\{user\.id\}\/role\x60/);
  assert.match(page, /user must sign in again|they must sign in again/i);
  assert.match(page, /isOriginalSystemAdministrator\(user\)/);
  assert.match(page, /String\(user\.primary_workspace_code \|\| ""\) !== "spare_parts"/);
});
