from pathlib import Path
import re


def replace_exact(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise SystemExit(f"{label} was not found exactly once.")
    return source.replace(old, new, 1)


def replace_pattern(
    source: str, pattern: re.Pattern[str], replacement: str, label: str
) -> str:
    updated, count = pattern.subn(replacement, source, count=1)
    if count != 1:
        raise SystemExit(f"{label} was not found exactly once.")
    return updated


def main() -> None:
    route_path = Path("backend/routes/userRoutes.js")
    frontend_path = Path("frontend/src/pages/UsersSettingsPage.jsx")
    service_path = Path("backend/services/userIdentityPreservationService.js")
    test_path = Path("backend/tests/userIdentityPreservation.test.js")

    route_source = route_path.read_text(encoding="utf-8")
    frontend_source = frontend_path.read_text(encoding="utf-8")

    route_source = replace_exact(
        route_source,
        '''const {
  resetAccountBySystemAdministrator,
} = require("../services/accountRecoveryService");''',
        '''const {
  resetAccountBySystemAdministrator,
} = require("../services/accountRecoveryService");
const {
  revokeAllUserSessions,
} = require("../services/accountSessionService");
const {
  secureDeactivateUser,
} = require("../services/userIdentityPreservationService");''',
        "User-route security service imports",
    )

    route_source = replace_pattern(
        route_source,
        re.compile(
            r'async function setUserReferenceToNull\([\s\S]*?\nfunction normalizeUserRow\(user\) \{',
            re.M,
        ),
        "function normalizeUserRow(user) {",
        "Dangerous user-reference clearing helpers",
    )

    toggle_route = '''// PATCH /api/users/:id/toggle-status
router.patch(
  "/:id/toggle-status",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const targetUserId = Number(req.params.id);

      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Invalid user ID.",
        });
      }

      if (targetUserId === Number(req.user.id)) {
        return res.status(400).json({
          status: "error",
          message: "You cannot disable your own account while logged in.",
        });
      }

      const user = await getUserById(targetUserId);

      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found.",
        });
      }

      if (isOriginalSystemAdministrator(user)) {
        return res.status(403).json({
          status: "error",
          message: "The original System Administrator account cannot be disabled.",
        });
      }

      const newStatus = !user.is_active;

      if (
        !newStatus &&
        String(user.role || "").toLowerCase() === "admin" &&
        (await activeAdminCountExcluding(pool, user.id)) < 1
      ) {
        return res.status(400).json({
          status: "error",
          message: "At least one active administrator must remain.",
        });
      }

      const updateFields = ["is_active = ?"];
      const updateParams = [newStatus];

      if (!newStatus && (await columnExists(pool, "users", "token_version"))) {
        updateFields.push("token_version = token_version + 1");
      }

      await pool.query(
        `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`,
        [...updateParams, targetUserId]
      );

      const revokedSessionCount = newStatus
        ? 0
        : await revokeAllUserSessions(targetUserId, "account_disabled");

      await logActivity(
        req.user.id,
        branchId,
        newStatus ? "ACTIVATE_USER" : "DEACTIVATE_USER",
        newStatus
          ? `Activated user "${user.username}" while retaining assigned access.`
          : `Disabled user "${user.username}" and revoked ${revokedSessionCount} active session(s); assigned access was retained for controlled reactivation.`
      );

      return res.json({
        status: "success",
        code: newStatus ? "USER_ACTIVATED" : "USER_DISABLED",
        message: newStatus
          ? "User account activated successfully. Assigned access remains available."
          : "User account disabled successfully. Active sessions were revoked and historical records remain linked.",
        is_active: newStatus,
        revoked_session_count: revokedSessionCount,
      });
    } catch (error) {
      console.error("Toggle user status error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while changing user status.",
      });
    }
  }
);

// DELETE /api/users/:id — compatibility endpoint for secure offboarding
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    const branchId = getBranchId(req);
    const targetUserId = Number(req.params.id);

    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID.",
      });
    }

    const requester = await getUserById(req.user.id);

    if (!isOriginalSystemAdministrator(requester)) {
      return res.status(403).json({
        status: "error",
        message:
          "Only the original System Administrator can securely offboard user accounts.",
      });
    }

    if (targetUserId === Number(req.user.id)) {
      return res.status(400).json({
        status: "error",
        message: "You cannot securely offboard your own account while logged in.",
      });
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const [targetRows] = await connection.query(
      `SELECT id, full_name, username, role, is_active, token_version
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [targetUserId]
    );
    const targetUser = targetRows[0];

    if (!targetUser) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    if (isOriginalSystemAdministrator(targetUser)) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(403).json({
        status: "error",
        message:
          "The original System Administrator account cannot be securely offboarded.",
      });
    }

    if (
      String(targetUser.role || "").toLowerCase() === "admin" &&
      Number(targetUser.is_active || 0) === 1 &&
      (await activeAdminCountExcluding(connection, targetUserId)) < 1
    ) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({
        status: "error",
        message: "At least one active administrator must remain.",
      });
    }

    const result = await secureDeactivateUser(connection, {
      targetUserId,
      actorUserId: req.user.id,
      reason:
        "Secure offboarding requested by the original System Administrator; historical identity retained.",
    });

    await writeAuditEvent({
      connection,
      req,
      userId: req.user.id,
      branchId,
      workspaceCode: "spare_parts",
      action: "SECURE_OFFBOARD_USER",
      actionType: "user.secure_offboard",
      outcome: "success",
      severity: "critical",
      entityType: "user",
      entityId: targetUserId,
      details: `Securely offboarded user "${targetUser.username}" (ID ${targetUserId}) without deleting the identity or clearing historical attribution.`,
      metadata: result.revocation_summary,
    });

    await connection.commit();
    transactionStarted = false;

    return res.json({
      status: "success",
      code: "USER_DEACTIVATED_PRESERVED",
      message: `User account "${targetUser.username}" was securely offboarded. Login, sessions and assigned access were revoked while historical business and audit records remain linked to the retained identity.`,
      user: {
        id: targetUserId,
        username: targetUser.username,
        is_active: false,
        identity_preserved: true,
      },
      revocation_summary: result.revocation_summary,
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original secure-offboarding error.
      }
    }

    console.error("Secure offboard user error:", error);

    return res.status(error.statusCode || 500).json({
      status: "error",
      code: error.code || "USER_SECURE_OFFBOARD_FAILED",
      message:
        error.statusCode && error.statusCode < 500
          ? error.message
          : "Something went wrong while securely offboarding the user account.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;'''

    route_source = replace_pattern(
        route_source,
        re.compile(
            r'// PATCH /api/users/:id/toggle-status[\s\S]*?\nmodule\.exports = router;',
            re.M,
        ),
        toggle_route,
        "User status and deletion route block",
    )

    frontend_source = replace_exact(
        frontend_source,
        'const [deletingUserId, setDeletingUserId] = useState("");',
        'const [offboardingUserId, setOffboardingUserId] = useState("");',
        "Offboarding state",
    )
    frontend_source = replace_pattern(
    frontend_source,
    re.compile(
        r'Review account status, store access, reset passwords, disable staff\s+accounts and protect the original system administrator\.'
    ),
    "Review account status, store access, reset passwords, temporarily\n               disable staff or securely offboard them while preserving historical identity.",
    "Staff-user section description",
)

    frontend_source = replace_pattern(
        frontend_source,
        re.compile(
            r'\{canDeleteThisUser\(user\) && \([\s\S]*?\n                              \)\}',
            re.M,
        ),
        '''{canSecurelyOffboardUser(user) && (
                                <button
                                  type="button"
                                  className="users-small-button danger"
                                  onClick={() => secureOffboardUser(user)}
                                  disabled={
                                    Number(offboardingUserId) === Number(user.id)
                                  }
                                  title="Deactivate the account, revoke every assigned access path and session, and preserve historical attribution."
                                >
                                  {Number(offboardingUserId) === Number(user.id)
                                    ? "Offboarding..."
                                    : "Secure Offboard"}
                                </button>
                              )}''',
        "Delete-account button",
    )

    service_source = r'''function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error("Unsafe database identifier.");
  }
  return identifier;
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [safeIdentifier(tableName)]
  );
  return rows.length > 0;
}

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [safeIdentifier(tableName), safeIdentifier(columnName)]
  );
  return rows.length > 0;
}

async function revokeAccessTable(connection, tableName, userId) {
  if (!(await tableExists(connection, tableName))) return 0;
  if (!(await columnExists(connection, tableName, "user_id"))) return 0;
  if (!(await columnExists(connection, tableName, "can_access"))) return 0;

  const updates = ["`can_access` = FALSE"];
  if (await columnExists(connection, tableName, "is_default")) {
    updates.push("`is_default` = FALSE");
  }
  if (await columnExists(connection, tableName, "is_primary")) {
    updates.push("`is_primary` = FALSE");
  }

  const safeTable = safeIdentifier(tableName);
  const [result] = await connection.query(
    `UPDATE \`${safeTable}\`
     SET ${updates.join(", ")}
     WHERE user_id = ?`,
    [userId]
  );
  return Number(result.affectedRows || 0);
}

async function revokePermissionOverrides(
  connection,
  { userId, actorUserId, reason }
) {
  const tableName = "user_permission_overrides";
  if (!(await tableExists(connection, tableName))) return 0;
  if (!(await columnExists(connection, tableName, "revoked_at"))) return 0;

  const updates = ["revoked_at = COALESCE(revoked_at, NOW())"];
  const params = [];
  if (await columnExists(connection, tableName, "revoked_by")) {
    updates.push("revoked_by = COALESCE(revoked_by, ?)");
    params.push(actorUserId || null);
  }
  if (await columnExists(connection, tableName, "revocation_reason")) {
    updates.push("revocation_reason = COALESCE(revocation_reason, ?)");
    params.push(cleanText(reason) || "User securely offboarded.");
  }

  const [result] = await connection.query(
    `UPDATE user_permission_overrides
     SET ${updates.join(", ")}
     WHERE user_id = ?
       AND revoked_at IS NULL`,
    [...params, userId]
  );
  return Number(result.affectedRows || 0);
}

async function revokeSessions(connection, userId) {
  const tableName = "auth_sessions";
  if (!(await tableExists(connection, tableName))) return 0;
  if (!(await columnExists(connection, tableName, "revoked_at"))) return 0;

  const updates = ["revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())"];
  if (await columnExists(connection, tableName, "revocation_reason")) {
    updates.push(
      "revocation_reason = COALESCE(revocation_reason, 'account_securely_offboarded')"
    );
  }

  const [result] = await connection.query(
    `UPDATE auth_sessions
     SET ${updates.join(", ")}
     WHERE user_id = ?
       AND revoked_at IS NULL`,
    [userId]
  );
  return Number(result.affectedRows || 0);
}

async function secureDeactivateUser(
  connection,
  { targetUserId, actorUserId, reason }
) {
  const userId = Number(targetUserId);
  if (!Number.isInteger(userId) || userId <= 0) {
    const error = new Error("Invalid user ID.");
    error.statusCode = 400;
    error.code = "INVALID_USER_ID";
    throw error;
  }

  const [users] = await connection.query(
    `SELECT id, full_name, username, role, is_active, token_version
     FROM users
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  const user = users[0];
  if (!user) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    error.code = "USER_NOT_FOUND";
    throw error;
  }

  const updateFields = ["is_active = FALSE"];
  if (await columnExists(connection, "users", "token_version")) {
    updateFields.push("token_version = token_version + 1");
  }
  if (await columnExists(connection, "users", "can_access_all_branches")) {
    updateFields.push("can_access_all_branches = FALSE");
  }
  if (await columnExists(connection, "users", "default_branch_id")) {
    updateFields.push("default_branch_id = NULL");
  }

  await connection.query(
    `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`,
    [userId]
  );

  const accessTables = [
    "user_branch_access",
    "user_business_access",
    "user_mining_site_access",
    "user_hire_location_access",
  ];
  const accessRevocations = {};
  for (const tableName of accessTables) {
    accessRevocations[tableName] = await revokeAccessTable(
      connection,
      tableName,
      userId
    );
  }

  const permissionOverrideCount = await revokePermissionOverrides(connection, {
    userId,
    actorUserId,
    reason,
  });
  const sessionCount = await revokeSessions(connection, userId);

  return {
    user: {
      id: Number(user.id),
      full_name: user.full_name || null,
      username: user.username || null,
      role: user.role || null,
      was_active: Number(user.is_active || 0) === 1,
    },
    revocation_summary: {
      identity_preserved: true,
      historical_references_preserved: true,
      access_rows_revoked: accessRevocations,
      permission_overrides_revoked: permissionOverrideCount,
      sessions_revoked: sessionCount,
    },
  };
}

module.exports = {
  columnExists,
  revokeAccessTable,
  secureDeactivateUser,
  tableExists,
};
'''

    test_source = r'''const assert = require("node:assert/strict");
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
'''

    route_path.write_text(route_source, encoding="utf-8")
    frontend_path.write_text(frontend_source, encoding="utf-8")
    service_path.write_text(service_source, encoding="utf-8")
    test_path.write_text(test_source, encoding="utf-8")


if __name__ == "__main__":
    main()
