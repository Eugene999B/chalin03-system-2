function cleanText(value, maxLength = 500) {
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
