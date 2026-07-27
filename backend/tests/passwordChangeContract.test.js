const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  changePasswordAtomically,
} = require("../services/passwordChangeService");

const authRoutes = fs.readFileSync(
  path.join(__dirname, "..", "routes", "authRoutes.js"),
  "utf8"
);

function fakePool({ failSessionRevocation = false, lockedHash = "old-hash" } = {}) {
  const events = [];
  const connection = {
    async beginTransaction() {
      events.push("begin");
    },
    async query(sql) {
      if (sql.includes("SELECT id, password_hash")) {
        events.push("lock-user");
        return [[{ id: 7, password_hash: lockedHash, is_active: 1 }]];
      }
      if (sql.includes("UPDATE users")) {
        events.push("update-password");
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("UPDATE auth_sessions")) {
        events.push("revoke-sessions");
        if (failSessionRevocation) throw new Error("session write failed");
        return [{ affectedRows: 3 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async commit() {
      events.push("commit");
    },
    async rollback() {
      events.push("rollback");
    },
    release() {
      events.push("release");
    },
  };
  return {
    events,
    poolRef: { async getConnection() { return connection; } },
  };
}

test("password and session revocation commit together", async () => {
  const { events, poolRef } = fakePool();
  const result = await changePasswordAtomically({
    userId: 7,
    expectedPasswordHash: "old-hash",
    newPasswordHash: "new-hash",
    userColumns: new Set(["must_change_password", "password_changed_at", "token_version"]),
    poolRef,
  });

  assert.equal(result.revokedSessionCount, 3);
  assert.deepEqual(events, [
    "begin",
    "lock-user",
    "update-password",
    "revoke-sessions",
    "commit",
    "release",
  ]);
});

test("session revocation failure rolls back the password update", async () => {
  const { events, poolRef } = fakePool({ failSessionRevocation: true });

  await assert.rejects(
    changePasswordAtomically({
      userId: 7,
      expectedPasswordHash: "old-hash",
      newPasswordHash: "new-hash",
      userColumns: new Set(["token_version"]),
      poolRef,
    }),
    /session write failed/
  );

  assert.deepEqual(events, [
    "begin",
    "lock-user",
    "update-password",
    "revoke-sessions",
    "rollback",
    "release",
  ]);
});

test("a concurrent password change fails closed", async () => {
  const { events, poolRef } = fakePool({ lockedHash: "different-hash" });

  await assert.rejects(
    changePasswordAtomically({
      userId: 7,
      expectedPasswordHash: "old-hash",
      newPasswordHash: "new-hash",
      userColumns: new Set(),
      poolRef,
    }),
    (error) => error.code === "PASSWORD_CHANGED_DURING_REQUEST"
  );

  assert.deepEqual(events, ["begin", "lock-user", "rollback", "release"]);
});

test("wrong current password is validation, not session expiry", () => {
  assert.match(authRoutes, /code: "CURRENT_PASSWORD_INCORRECT"/);
  assert.match(
    authRoutes,
    /if \(!currentPasswordMatches\) \{[\s\S]*?res\.status\(400\)/
  );
  assert.match(authRoutes, /changePasswordAtomically\(\{/);
  assert.doesNotMatch(
    authRoutes,
    /if \(!currentPasswordMatches\) \{[\s\S]*?res\.status\(401\)/
  );
});
