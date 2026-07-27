from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path, old, new):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "backend/routes/authRoutes.js",
    '''const {
  createSession,
  revokeAllUserSessions,
  revokeSession,
} = require("../services/accountSessionService");
''',
    '''const {
  createSession,
  revokeSession,
} = require("../services/accountSessionService");
const {
  changePasswordAtomically,
} = require("../services/passwordChangeService");
''',
)

replace_once(
    "backend/routes/authRoutes.js",
    '''    if (!currentPasswordMatches) {
      return res.status(401).json({
        status: "error",
        message: "Current password is incorrect.",
      });
    }
''',
    '''    if (!currentPasswordMatches) {
      return res.status(400).json({
        status: "error",
        code: "CURRENT_PASSWORD_INCORRECT",
        message: "Current password is incorrect.",
      });
    }
''',
)

replace_once(
    "backend/routes/authRoutes.js",
    '''    await pool.query(
      `UPDATE users
       SET ${updateFields.join(",\\n           ")}
       WHERE id = ?`,
      [...updateParams, user.id]
    );

    await revokeAllUserSessions(user.id, "password_changed");
''',
    '''    await changePasswordAtomically({
      userId: user.id,
      expectedPasswordHash: user.password_hash,
      newPasswordHash,
      userColumns,
    });
''',
)

replace_once(
    "backend/routes/authRoutes.js",
    '''    await writeActivityLog(
      selectedBranch?.id || null,
      user.id,
      "CHANGE_PASSWORD",
      `${user.username} changed account password in ${
        workspace?.name || "Chalin 03"
      }`
    );
''',
    '''    try {
      await writeActivityLog(
        selectedBranch?.id || null,
        user.id,
        "CHANGE_PASSWORD",
        `${user.username} changed account password in ${
          workspace?.name || "Chalin 03"
        }`
      );
    } catch (auditError) {
      console.error(
        "Password changed but the security audit entry could not be written:",
        auditError.message
      );
    }
''',
)

replace_once(
    "backend/routes/authRoutes.js",
    '''  } catch (error) {
    console.error("Change password error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while changing password.",
    });
  }
});
''',
    '''  } catch (error) {
    console.error("Change password error:", error);
    const statusCode = Number(error.statusCode || 500);

    return res.status(statusCode).json({
      status: "error",
      code: error.code || "PASSWORD_CHANGE_FAILED",
      message:
        statusCode < 500
          ? error.message
          : "Something went wrong while changing password.",
    });
  }
});
''',
)

replace_once(
    "frontend/src/api/axiosClient.js",
    '''    const isTemporaryProfileFailure =
      requestPath === "/auth/me" &&
      Boolean(activeToken) &&
      requestToken === activeToken &&
      Boolean(cachedUser) &&
      (statusCode === undefined || statusCode === 0 || statusCode === 400 || statusCode >= 500);
''',
    '''    const isTemporaryProfileFailure =
      requestPath === "/auth/me" &&
      Boolean(activeToken) &&
      requestToken === activeToken &&
      Boolean(cachedUser) &&
      (statusCode === undefined || statusCode === 0 || statusCode === 400 || statusCode >= 500);
    const isChangePasswordCredentialFailure =
      requestPath === "/auth/change-password" &&
      statusCode === 401 &&
      (errorCode === "CURRENT_PASSWORD_INCORRECT" ||
        errorMessage === "Current password is incorrect.");
''',
)

replace_once(
    "frontend/src/api/axiosClient.js",
    '''    if (statusCode === 401 && !isOwnerRecoveryRequest && !isOwnerRecoveryPage) {
''',
    '''    if (
      statusCode === 401 &&
      !isOwnerRecoveryRequest &&
      !isOwnerRecoveryPage &&
      !isChangePasswordCredentialFailure
    ) {
''',
)

service = r'''const { pool } = require("../config/db");

function passwordChangeError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function boolValue(value) {
  return value === true || Number(value || 0) === 1;
}

async function changePasswordAtomically({
  userId,
  expectedPasswordHash,
  newPasswordHash,
  userColumns,
  poolRef = pool,
}) {
  const connection = await poolRef.getConnection();

  try {
    await connection.beginTransaction();

    const [users] = await connection.query(
      `SELECT id, password_hash, is_active
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [userId]
    );

    if (users.length === 0) {
      throw passwordChangeError(
        "User account not found.",
        404,
        "PASSWORD_CHANGE_USER_NOT_FOUND"
      );
    }

    const lockedUser = users[0];

    if (!boolValue(lockedUser.is_active)) {
      throw passwordChangeError(
        "This account has been disabled.",
        403,
        "PASSWORD_CHANGE_ACCOUNT_DISABLED"
      );
    }

    if (lockedUser.password_hash !== expectedPasswordHash) {
      throw passwordChangeError(
        "The account password changed while this request was being processed. Login again and retry.",
        409,
        "PASSWORD_CHANGED_DURING_REQUEST"
      );
    }

    const updateFields = ["password_hash = ?"];
    const updateParams = [newPasswordHash];

    if (userColumns.has("must_change_password")) {
      updateFields.push("must_change_password = FALSE");
    }

    if (userColumns.has("password_changed_at")) {
      updateFields.push("password_changed_at = CURRENT_TIMESTAMP");
    }

    if (userColumns.has("token_version")) {
      updateFields.push("token_version = token_version + 1");
    }

    const [passwordResult] = await connection.query(
      `UPDATE users
       SET ${updateFields.join(",\n           ")}
       WHERE id = ?
         AND password_hash = ?`,
      [...updateParams, userId, expectedPasswordHash]
    );

    if (Number(passwordResult.affectedRows || 0) !== 1) {
      throw passwordChangeError(
        "The account password changed while this request was being processed. Login again and retry.",
        409,
        "PASSWORD_CHANGED_DURING_REQUEST"
      );
    }

    const [sessionResult] = await connection.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
           revocation_reason = COALESCE(revocation_reason, 'password_changed')
       WHERE user_id = ?
         AND revoked_at IS NULL`,
      [userId]
    );

    await connection.commit();

    return {
      userId,
      revokedSessionCount: Number(sessionResult.affectedRows || 0),
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original password-change failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  changePasswordAtomically,
  passwordChangeError,
};
'''
(ROOT / "backend/services/passwordChangeService.js").write_text(service, encoding="utf-8")

backend_test = r'''const test = require("node:test");
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
'''
(ROOT / "backend/tests/passwordChangeContract.test.js").write_text(backend_test, encoding="utf-8")

frontend_test = r'''import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const axiosClient = read("src", "api", "axiosClient.js");
const passwordPage = read("src", "pages", "ChangePasswordPage.jsx");
const authRoutes = read("..", "backend", "routes", "authRoutes.js");
const service = read("..", "backend", "services", "passwordChangeService.js");

const checks = [
  [
    /requestPath === "\/auth\/change-password"[\s\S]*?CURRENT_PASSWORD_INCORRECT/,
    axiosClient,
    "change-password credential failures are classified separately",
  ],
  [
    /!isChangePasswordCredentialFailure/,
    axiosClient,
    "credential mismatch cannot clear the active browser session",
  ],
  [
    /code: "CURRENT_PASSWORD_INCORRECT"/,
    authRoutes,
    "backend returns a stable current-password validation code",
  ],
  [
    /res\.status\(400\)/,
    authRoutes,
    "wrong current password is a validation error rather than authentication expiry",
  ],
  [
    /changePasswordAtomically/,
    authRoutes,
    "route uses the atomic password/session service",
  ],
  [
    /beginTransaction\(\)[\s\S]*?UPDATE users[\s\S]*?UPDATE auth_sessions[\s\S]*?commit\(\)/,
    service,
    "password update and session revocation share one transaction",
  ],
  [
    /requestError\.response\?\.data\?\.message/,
    passwordPage,
    "the password page displays the server validation message",
  ],
];

for (const [pattern, source, description] of checks) {
  if (!pattern.test(source)) {
    console.error(`Password change regression failed: ${description}`);
    process.exit(1);
  }
}

console.log("Password change session regression checks passed.");
'''
(ROOT / "frontend/scripts/passwordChangeSessionTests.mjs").write_text(frontend_test, encoding="utf-8")

replace_once(
    "frontend/package.json",
    'node scripts/workspaceFinalCompletionTests.mjs"',
    'node scripts/workspaceFinalCompletionTests.mjs && node scripts/passwordChangeSessionTests.mjs"',
)

print("Applied atomic password-change and browser-session fixes.")
