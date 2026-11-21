"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const target = path.resolve(__dirname, "../middleware/authMiddleware.js");
const source = fs.readFileSync(target, "utf8");

function loadAuthWithDatabase(query, verify) {
  const original = Module._load;
  try {
    Module._load = function intercept(request, parent, isMain) {
      if (parent?.filename === target) {
        if (request === "../config/db") return { pool: { query } };
        if (request === "jsonwebtoken") return { verify };
        if (request === "../services/accountSessionService") {
          return { validateSession: async () => ({ ok: true, session: { session_id: "test-session" } }) };
        }
        if (request === "../services/permissionOverrideService") {
          return { resolveEffectivePermissions: async () => [] };
        }
        if (request === "../services/categoryIsolationService") {
          return { validateUserCategoryAccess: async () => ({ ok: true, workspaceCode: "spare_parts", workspaceRole: "admin" }) };
        }
        if (request === "./sparePartsBranchContextMiddleware") {
          return { requireSparePartsBranchContext: (req, res, next) => next() };
        }
        if (request === "../security/systemAdminIdentity") {
          return { isOriginalSystemAdministrator: () => false };
        }
      }
      return original.apply(this, arguments);
    };
    delete require.cache[target];
    return require(target);
  } finally {
    Module._load = original;
    delete require.cache[target];
  }
}

function response() {
  return {
    code: 200, body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("invalid or expired JWT remains a real 401; database is not consulted", async () => {
  let queried = false;
  const auth = loadAuthWithDatabase(
    async () => { queried = true; throw new Error("should not query"); },
    () => { throw new Error("jwt expired"); }
  );
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "synthetic-test-not-a-secret";
  try {
    const res = response();
    await auth.requireAuth({ headers: { authorization: "Bearer fake" } }, res, () => {});
    assert.equal(res.code, 401);
    assert.equal(res.body.code, "INVALID_TOKEN");
    assert.equal(queried, false);
  } finally {
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test("MySQL connection timeout must never masquerade as an invalid JWT", async () => {
  let calls = 0;
  const auth = loadAuthWithDatabase(
    async () => {
      calls += 1;
      const error = new Error("temporary MySQL timeout");
      error.code = "ETIMEDOUT";
      throw error;
    },
    () => ({ id: 17, session_id: "synthetic" })
  );
  const oldSecret = process.env.JWT_SECRET;
  const oldError = console.error;
  process.env.JWT_SECRET = "synthetic-test-not-a-secret";
  console.error = () => {};
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = response();
      let nextCalled = false;
      await auth.requireAuth(
        { headers: { authorization: "Bearer valid-synthetic" } },
        res,
        () => { nextCalled = true; }
      );
      assert.equal(res.code, 503);
      assert.equal(res.body.code, "AUTH_VERIFICATION_UNAVAILABLE");
      assert.equal(nextCalled, false, "failed DB verification cannot grant protected access");
    }
    assert.ok(calls >= 2, "schema lookup must retry after transient outages");
  } finally {
    console.error = oldError;
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test("temporary schema lookup failures are not cached as permanent absent columns", () => {
  assert.doesNotMatch(source, /catch\s*\{\s*tableColumnCache\.set\(cacheKey, false\)/);
  assert.match(source, /throw error;\s*\}\s*\}\s*async function loadUserSecurityState/);
});
