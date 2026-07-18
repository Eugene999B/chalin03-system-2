const { pool } = require("../config/db");
const {
  isOriginalSystemAdministrator,
  SYSTEM_ADMIN_ID,
  SYSTEM_ADMIN_USERNAME,
} = require("../security/systemAdminIdentity");

const DELEGATED_PERMISSION_PREFIX = "delegated_admin.";
const DELEGATED_CAPABILITIES = Object.freeze([
  {
    code: "enabled",
    permissionCode: `${DELEGATED_PERMISSION_PREFIX}enabled`,
    label: "Delegated System Administrator",
    description:
      "Marks this Administrator as an owner-approved delegated System Administrator.",
  },
  {
    code: "manage_users",
    permissionCode: `${DELEGATED_PERMISSION_PREFIX}manage_users`,
    label: "Manage staff accounts",
    description:
      "Create, edit, activate, disable and reset non-owner staff accounts.",
  },
  {
    code: "manage_permissions",
    permissionCode: `${DELEGATED_PERMISSION_PREFIX}manage_permissions`,
    label: "Manage user permissions",
    description:
      "Use the User Permission Manager inside the delegated Administrator's assigned business category.",
  },
  {
    code: "manage_administrators",
    permissionCode: `${DELEGATED_PERMISSION_PREFIX}manage_administrators`,
    label: "Manage other Administrators",
    description:
      "Create or change other delegated Administrator accounts. The original owner remains protected.",
  },
  {
    code: "backup_download",
    permissionCode: `${DELEGATED_PERMISSION_PREFIX}backup_download`,
    label: "Download full-system backups",
    description:
      "Create and download protected full-system recovery backups when the matching page permission is also granted.",
  },
  {
    code: "backup_validate",
    permissionCode: `${DELEGATED_PERMISSION_PREFIX}backup_validate`,
    label: "Validate backup files",
    description:
      "Run backup compatibility and checksum validation without changing production data.",
  },
  {
    code: "backup_restore",
    permissionCode: `${DELEGATED_PERMISSION_PREFIX}backup_restore`,
    label: "Restore approved backups",
    description:
      "Perform a protected restore only during an explicitly enabled restore window.",
  },
  {
    code: "audit_view",
    permissionCode: `${DELEGATED_PERMISSION_PREFIX}audit_view`,
    label: "View audit evidence",
    description:
      "Open the Activity Log and security evidence for the delegated Administrator's authorized scope.",
  },
  {
    code: "system_operations",
    permissionCode: `${DELEGATED_PERMISSION_PREFIX}system_operations`,
    label: "Use System Operations",
    description:
      "View health, readiness, database and protected configuration diagnostics.",
  },
]);

const CAPABILITY_BY_CODE = new Map(
  DELEGATED_CAPABILITIES.map((item) => [item.code, item])
);
const CAPABILITY_BY_PERMISSION = new Map(
  DELEGATED_CAPABILITIES.map((item) => [item.permissionCode, item])
);
const DELEGATED_PERMISSION_CODES = Object.freeze(
  DELEGATED_CAPABILITIES.map((item) => item.permissionCode)
);
const WORKSPACE_CODES = new Set([
  "spare_parts",
  "mining",
  "equipment_hire",
]);

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeWorkspace(value) {
  const workspace = cleanText(value, 50).toLowerCase().replace(/[\s-]+/g, "_");
  return WORKSPACE_CODES.has(workspace) ? workspace : "spare_parts";
}

function booleanValue(value) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    String(value || "").trim().toLowerCase() === "true"
  );
}

function capabilitySelection(rawCapabilities = {}) {
  const selected = {};

  for (const capability of DELEGATED_CAPABILITIES) {
    selected[capability.code] = booleanValue(rawCapabilities[capability.code]);
  }

  const hasOperationalCapability = DELEGATED_CAPABILITIES.some(
    (capability) => capability.code !== "enabled" && selected[capability.code]
  );
  selected.enabled = selected.enabled || hasOperationalCapability;

  if (selected.manage_administrators) {
    selected.manage_users = true;
    selected.manage_permissions = true;
  }

  if (selected.backup_restore) {
    selected.backup_download = true;
    selected.backup_validate = true;
  }

  return selected;
}

function permissionCodesForSelection(selection = {}) {
  return DELEGATED_CAPABILITIES.filter((capability) => selection[capability.code]).map(
    (capability) => capability.permissionCode
  );
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

async function tableExists(connection = pool) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'user_permission_overrides'
     LIMIT 1`
  );
  return rows.length > 0;
}

async function assertDelegatedStorageReady(connection = pool) {
  if (!(await tableExists(connection))) {
    const error = new Error(
      "Delegated administration requires the Release 3F-C user_permission_overrides table."
    );
    error.statusCode = 503;
    error.code = "DELEGATED_ADMIN_STORAGE_NOT_READY";
    throw error;
  }
}

async function loadUser(userId, connection = pool, lock = false) {
  const [rows] = await connection.query(
    `SELECT
       id,
       full_name,
       username,
       role,
       phone,
       is_active,
       token_version,
       primary_workspace_code,
       category_assignment_status,
       created_at,
       updated_at
     FROM users
     WHERE id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [userId]
  );
  return rows[0] || null;
}

function publicUser(user = {}) {
  return {
    id: Number(user.id),
    full_name: user.full_name || null,
    username: user.username || null,
    role: user.role || null,
    phone: user.phone || null,
    is_active: Boolean(Number(user.is_active)),
    primary_workspace_code: user.primary_workspace_code || null,
    category_assignment_status: user.category_assignment_status || null,
    is_original_system_administrator: isOriginalSystemAdministrator(user),
  };
}

async function loadActiveDelegatedRows(userId, connection = pool) {
  await assertDelegatedStorageReady(connection);
  const [rows] = await connection.query(
    `SELECT
       upo.id,
       upo.user_id,
       upo.workspace_code,
       upo.permission_code,
       upo.effect,
       upo.reason,
       upo.expires_at,
       upo.created_by,
       upo.created_at,
       upo.updated_at
     FROM user_permission_overrides upo
     WHERE upo.user_id = ?
       AND upo.permission_code IN (${placeholders(DELEGATED_PERMISSION_CODES)})
       AND upo.effect = 'allow'
       AND upo.revoked_at IS NULL
       AND (upo.expires_at IS NULL OR upo.expires_at > NOW())
     ORDER BY upo.id ASC`,
    [userId, ...DELEGATED_PERMISSION_CODES]
  );
  return rows;
}

function capabilityStateFromRows(rows = []) {
  const activeCodes = new Set(rows.map((row) => String(row.permission_code || "")));
  const state = {};

  for (const capability of DELEGATED_CAPABILITIES) {
    state[capability.code] = activeCodes.has(capability.permissionCode);
  }

  return state;
}

async function delegatedAuthorityForUser(userOrId, connection = pool) {
  const user =
    typeof userOrId === "object" && userOrId !== null
      ? userOrId
      : await loadUser(Number(userOrId), connection);

  if (!user) {
    return {
      user: null,
      is_original_system_administrator: false,
      is_delegated_system_administrator: false,
      capabilities: capabilityStateFromRows([]),
      active_overrides: [],
      expires_at: null,
    };
  }

  if (isOriginalSystemAdministrator(user)) {
    return {
      user: publicUser(user),
      is_original_system_administrator: true,
      is_delegated_system_administrator: false,
      capabilities: Object.fromEntries(
        DELEGATED_CAPABILITIES.map((capability) => [capability.code, true])
      ),
      active_overrides: [],
      expires_at: null,
    };
  }

  const rows = await loadActiveDelegatedRows(user.id, connection);
  const capabilities = capabilityStateFromRows(rows);
  const expiries = rows
    .map((row) => (row.expires_at ? new Date(row.expires_at) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()));
  const earliestExpiry = expiries.length
    ? new Date(Math.min(...expiries.map((date) => date.getTime()))).toISOString()
    : null;

  return {
    user: publicUser(user),
    is_original_system_administrator: false,
    is_delegated_system_administrator: Boolean(capabilities.enabled),
    capabilities,
    active_overrides: rows,
    expires_at: earliestExpiry,
  };
}

async function hasDelegatedCapability(user, capabilityCode, connection = pool) {
  if (isOriginalSystemAdministrator(user)) {
    return true;
  }

  const capability = CAPABILITY_BY_CODE.get(capabilityCode);
  if (!capability) {
    return false;
  }

  if (String(user?.role || "").trim().toLowerCase() !== "admin") {
    return false;
  }

  const authority = await delegatedAuthorityForUser(user, connection);
  return Boolean(
    authority.is_delegated_system_administrator &&
      authority.capabilities[capability.code]
  );
}

async function revokeActiveDelegatedRows({
  connection,
  userId,
  actorUserId,
  reason,
}) {
  await assertDelegatedStorageReady(connection);
  const [result] = await connection.query(
    `UPDATE user_permission_overrides
     SET revoked_at = COALESCE(revoked_at, NOW()),
         revoked_by = COALESCE(revoked_by, ?),
         revocation_reason = COALESCE(revocation_reason, ?)
     WHERE user_id = ?
       AND permission_code IN (${placeholders(DELEGATED_PERMISSION_CODES)})
       AND revoked_at IS NULL`,
    [
      actorUserId,
      cleanText(reason, 500) || "Delegated authority replaced or revoked.",
      userId,
      ...DELEGATED_PERMISSION_CODES,
    ]
  );
  return Number(result.affectedRows || 0);
}

async function grantDelegatedAuthority({
  connection,
  targetUser,
  actorUserId,
  capabilities,
  reason,
  expiresAt = null,
}) {
  await assertDelegatedStorageReady(connection);
  const selection = capabilitySelection(capabilities);
  const permissionCodes = permissionCodesForSelection(selection);
  const cleanReason = cleanText(reason, 500);
  const workspaceCode = normalizeWorkspace(targetUser.primary_workspace_code);

  if (!selection.enabled || permissionCodes.length < 2) {
    const error = new Error(
      "Choose at least one delegated administration authority."
    );
    error.statusCode = 400;
    error.code = "DELEGATED_ADMIN_CAPABILITY_REQUIRED";
    throw error;
  }

  await revokeActiveDelegatedRows({
    connection,
    userId: targetUser.id,
    actorUserId,
    reason: `Superseded: ${cleanReason}`,
  });

  for (const permissionCode of permissionCodes) {
    await connection.query(
      `INSERT INTO user_permission_overrides (
         user_id,
         workspace_code,
         permission_code,
         effect,
         reason,
         expires_at,
         created_by,
         created_at,
         updated_at,
         revoked_at,
         revoked_by,
         revocation_reason
       ) VALUES (?, ?, ?, 'allow', ?, ?, ?, NOW(), NOW(), NULL, NULL, NULL)`,
      [
        targetUser.id,
        workspaceCode,
        permissionCode,
        cleanReason,
        expiresAt,
        actorUserId,
      ]
    );
  }

  return delegatedAuthorityForUser(targetUser, connection);
}

async function delegatedAdministrationOverview(requester, connection = pool) {
  await assertDelegatedStorageReady(connection);
  const requesterAuthority = await delegatedAuthorityForUser(requester, connection);
  const canManage = isOriginalSystemAdministrator(requester);

  let candidates = [];
  let authorities = [];
  let history = [];

  if (canManage) {
    const [candidateRows] = await connection.query(
      `SELECT
         id,
         full_name,
         username,
         role,
         phone,
         is_active,
         primary_workspace_code,
         category_assignment_status,
         created_at,
         updated_at
       FROM users
       WHERE LOWER(role) = 'admin'
         AND is_active = TRUE
         AND NOT (id = ? AND LOWER(username) = LOWER(?))
       ORDER BY full_name, username`,
      [SYSTEM_ADMIN_ID, SYSTEM_ADMIN_USERNAME]
    );
    candidates = candidateRows.map(publicUser);

    const [activeRows] = await connection.query(
      `SELECT
         upo.id,
         upo.user_id,
         upo.workspace_code,
         upo.permission_code,
         upo.reason,
         upo.expires_at,
         upo.created_at,
         target.full_name,
         target.username,
         target.role,
         target.phone,
         target.is_active,
         target.primary_workspace_code,
         creator.full_name AS created_by_name,
         creator.username AS created_by_username
       FROM user_permission_overrides upo
       INNER JOIN users target ON target.id = upo.user_id
       LEFT JOIN users creator ON creator.id = upo.created_by
       WHERE upo.permission_code IN (${placeholders(DELEGATED_PERMISSION_CODES)})
         AND upo.effect = 'allow'
         AND upo.revoked_at IS NULL
         AND (upo.expires_at IS NULL OR upo.expires_at > NOW())
       ORDER BY upo.user_id, upo.id`,
      DELEGATED_PERMISSION_CODES
    );

    const grouped = new Map();
    for (const row of activeRows) {
      if (!grouped.has(row.user_id)) {
        grouped.set(row.user_id, {
          user: publicUser({ ...row, id: row.user_id }),
          capabilities: capabilityStateFromRows([]),
          active_overrides: [],
          reason: row.reason || null,
          expires_at: row.expires_at || null,
          created_at: row.created_at || null,
          created_by_name: row.created_by_name || row.created_by_username || null,
        });
      }
      const item = grouped.get(row.user_id);
      item.active_overrides.push(row);
      const capability = CAPABILITY_BY_PERMISSION.get(row.permission_code);
      if (capability) item.capabilities[capability.code] = true;
      if (row.expires_at) {
        const current = item.expires_at ? new Date(item.expires_at) : null;
        const candidate = new Date(row.expires_at);
        if (!current || candidate.getTime() < current.getTime()) {
          item.expires_at = row.expires_at;
        }
      }
    }
    authorities = [...grouped.values()].filter(
      (item) => item.capabilities.enabled
    );

    const [historyRows] = await connection.query(
      `SELECT
         upo.id,
         upo.user_id,
         upo.workspace_code,
         upo.permission_code,
         upo.effect,
         upo.reason,
         upo.expires_at,
         upo.created_at,
         upo.updated_at,
         upo.revoked_at,
         upo.revocation_reason,
         target.full_name,
         target.username,
         creator.full_name AS created_by_name,
         creator.username AS created_by_username,
         revoker.full_name AS revoked_by_name,
         revoker.username AS revoked_by_username
       FROM user_permission_overrides upo
       INNER JOIN users target ON target.id = upo.user_id
       LEFT JOIN users creator ON creator.id = upo.created_by
       LEFT JOIN users revoker ON revoker.id = upo.revoked_by
       WHERE upo.permission_code IN (${placeholders(DELEGATED_PERMISSION_CODES)})
       ORDER BY upo.id DESC
       LIMIT 200`,
      DELEGATED_PERMISSION_CODES
    );
    history = historyRows;
  } else if (requesterAuthority.is_delegated_system_administrator) {
    authorities = [requesterAuthority];
  }

  return {
    can_manage: canManage,
    viewer: requesterAuthority,
    candidates,
    active_authorities: authorities,
    history,
    capability_catalog: DELEGATED_CAPABILITIES,
    policy: {
      original_owner_permanently_protected: true,
      password_confirmation_required: true,
      reason_required: true,
      expiry_supported: true,
      sessions_revoked_after_change: true,
      category_isolation_preserved: true,
      backup_restore_requires_separate_restore_window: true,
    },
  };
}

async function delegatedAuthorityCounts(connection = pool) {
  await assertDelegatedStorageReady(connection);
  const [rows] = await connection.query(
    `SELECT
       COUNT(DISTINCT CASE
         WHEN permission_code = ?
          AND effect = 'allow'
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
         THEN user_id END) AS active_delegated_administrators,
       COUNT(CASE
         WHEN permission_code LIKE ?
          AND revoked_at IS NULL
          AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
         THEN 1 END) AS delegated_rules_expiring_within_7_days,
       COUNT(CASE
         WHEN permission_code LIKE ?
          AND revoked_at IS NOT NULL
         THEN 1 END) AS revoked_delegated_rules
     FROM user_permission_overrides`,
    [
      `${DELEGATED_PERMISSION_PREFIX}enabled`,
      `${DELEGATED_PERMISSION_PREFIX}%`,
      `${DELEGATED_PERMISSION_PREFIX}%`,
    ]
  );
  return rows[0] || {};
}

module.exports = {
  DELEGATED_CAPABILITIES,
  DELEGATED_PERMISSION_CODES,
  DELEGATED_PERMISSION_PREFIX,
  assertDelegatedStorageReady,
  capabilitySelection,
  delegatedAdministrationOverview,
  delegatedAuthorityCounts,
  delegatedAuthorityForUser,
  grantDelegatedAuthority,
  hasDelegatedCapability,
  loadUser,
  publicUser,
  revokeActiveDelegatedRows,
};
