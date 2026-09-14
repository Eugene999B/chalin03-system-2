const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OWNER_PROTECTED_PERMISSIONS,
  resolveEffectivePermissions,
  validateOverridePolicy,
} = require("../services/permissionOverrideService");
const {
  requireAnyPermission,
  requirePermission,
} = require("../middleware/permissionMiddleware");

const OWNER = Object.freeze({
  id: 1,
  username: "admin",
  role: "admin",
  workspace_code: "spare_parts",
  workspace_role: "admin",
});

test("original System Administrator keeps every permission without querying overrides", async () => {
  const connection = {
    async query() {
      throw new Error("Owner permission resolution must not query override storage.");
    },
  };

  const permissions = await resolveEffectivePermissions(OWNER, { connection });

  for (const permission of [
    "spare_parts.read",
    "spare_parts.sell",
    "spare_parts.manage",
    "users.manage",
    "users.permissions.manage",
    "backup.download",
    "backup.restore",
    "security.admin",
    "security.view",
    "system.diagnostics",
    "mining.production.approve",
    "hire.payments.manage",
  ]) {
    assert.equal(permissions.includes(permission), true, permission);
  }
});

test("every permission is protected from owner overrides", () => {
  assert.equal(OWNER_PROTECTED_PERMISSIONS.includes("spare_parts.sell"), true);
  assert.equal(OWNER_PROTECTED_PERMISSIONS.includes("backup.restore"), true);

  for (const effect of ["allow", "deny"]) {
    const result = validateOverridePolicy({
      targetUser: OWNER,
      permissionCode: "spare_parts.sell",
      effect,
      workspaceCode: "spare_parts",
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "OWNER_PERMISSION_IMMUTABLE");
  }
});

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("permission middleware cannot block the verified owner identity", () => {
  for (const middleware of [
    requirePermission("backup.restore"),
    requireAnyPermission("security.admin", "system.diagnostics"),
  ]) {
    const req = { user: { ...OWNER, effective_permissions: [] } };
    const res = responseRecorder();
    let passed = false;

    middleware(req, res, () => {
      passed = true;
    });

    assert.equal(passed, true);
    assert.equal(res.payload, null);
  }
});

test("ordinary administrators remain permission controlled", () => {
  const req = {
    user: {
      id: 9,
      username: "branch-admin",
      role: "admin",
      workspace_code: "spare_parts",
      effective_permissions: [],
    },
  };
  const res = responseRecorder();
  let passed = false;

  requirePermission("backup.restore")(req, res, () => {
    passed = true;
  });

  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.code, "PERMISSION_DENIED");
});
