const { pool } = require("../config/db");
const {
  ALL_PERMISSIONS,
  getEffectivePermissions,
  isPermissionAllowedForWorkspace,
  normalizeCode,
  permissionsForWorkspace,
} = require("../security/permissionCatalog");
const {
  isOriginalSystemAdministrator,
} = require("../security/systemAdminIdentity");

const WORKSPACE_CODES = new Set([
  "spare_parts",
  "mining",
  "equipment_hire",
]);

const OWNER_PROTECTED_PERMISSIONS = Object.freeze([
  "workspace.admin",
  "users.manage",
  "users.permissions.manage",
  "security.admin",
  "security.view",
  "system.diagnostics",
  "backup.download",
  "backup.validate",
  "backup.restore",
]);

const ADMIN_ONLY_GRANTS = Object.freeze([
  "workspace.admin",
  "users.manage",
  "users.permissions.manage",
  "security.admin",
  "system.diagnostics",
  "backup.restore",
]);

let warnedMissingTable = false;

function normalizeWorkspace(value) {
  const cleaned = normalizeCode(value || "spare_parts");
  return WORKSPACE_CODES.has(cleaned) ? cleaned : "spare_parts";
}

function normalizeEffect(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase();
  return cleaned === "allow" || cleaned === "deny" ? cleaned : null;
}

function isKnownPermission(permissionCode) {
  return ALL_PERMISSIONS.includes(String(permissionCode || "").trim());
}


function applyPermissionOverrides(basePermissions = [], overrides = []) {
  const allowed = new Set(basePermissions.filter(Boolean));
  const denied = new Set();

  for (const override of overrides) {
    const permissionCode = String(override.permission_code || "").trim();
    const effect = normalizeEffect(override.effect);

    if (!permissionCode || !effect) continue;

    if (effect === "allow") {
      allowed.add(permissionCode);
    } else {
      denied.add(permissionCode);
    }
  }

  for (const permissionCode of denied) {
    allowed.delete(permissionCode);
  }

  return [...allowed].sort();
}

async function loadActivePermissionOverrides({
  userId,
  workspaceCode,
  connection = pool,
}) {
  if (!userId) return [];

  const workspace = normalizeWorkspace(workspaceCode);

  try {
    const [rows] = await connection.query(
      `SELECT
         id,
         user_id,
         workspace_code,
         permission_code,
         effect,
         reason,
         expires_at,
         created_by,
         created_at,
         updated_at
       FROM user_permission_overrides
       WHERE user_id = ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
         AND workspace_code = ?
       ORDER BY id ASC`,
      [userId, workspace]
    );

    return rows;
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE") {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn(
          "Permission overrides are unavailable until the Release 3F-C migration is applied."
        );
      }
      return [];
    }

    throw error;
  }
}

async function resolveEffectivePermissions(session = {}, options = {}) {
  const basePermissions = getEffectivePermissions(session);
  const overrides = await loadActivePermissionOverrides({
    userId: session.id,
    workspaceCode:
      options.workspaceCode ||
      session.workspace_code ||
      session.active_workspace?.code,
    connection: options.connection || pool,
  });

  return applyPermissionOverrides(basePermissions, overrides);
}

function validateOverridePolicy({ targetUser, permissionCode, effect, workspaceCode }) {
  if (!isKnownPermission(permissionCode)) {
    return {
      ok: false,
      statusCode: 400,
      code: "UNKNOWN_PERMISSION",
      message: "The selected permission does not exist in the current catalog.",
    };
  }

  const normalizedEffect = normalizeEffect(effect);
  if (!normalizedEffect) {
    return {
      ok: false,
      statusCode: 400,
      code: "INVALID_PERMISSION_EFFECT",
      message: "Choose either Allow or Deny.",
    };
  }

  if (
    normalizedEffect === "deny" &&
    isOriginalSystemAdministrator(targetUser) &&
    OWNER_PROTECTED_PERMISSIONS.includes(permissionCode)
  ) {
    return {
      ok: false,
      statusCode: 409,
      code: "OWNER_PERMISSION_PROTECTED",
      message:
        "This owner-security permission cannot be denied for the original System Administrator.",
    };
  }

  const workspace = normalizeWorkspace(workspaceCode);
  if (!isPermissionAllowedForWorkspace(permissionCode, workspace)) {
    return {
      ok: false,
      statusCode: 409,
      code: "CROSS_CATEGORY_PERMISSION_BLOCKED",
      message:
        "This permission belongs to a different independent business category.",
    };
  }

  if (
    normalizedEffect === "allow" &&
    ADMIN_ONLY_GRANTS.includes(permissionCode) &&
    String(targetUser.role || "").trim().toLowerCase() !== "admin"
  ) {
    return {
      ok: false,
      statusCode: 409,
      code: "ADMIN_PERMISSION_PROTECTED",
      message:
        "This protected administration permission can only be granted to an Administrator account.",
    };
  }

  return {
    ok: true,
    effect: normalizedEffect,
  };
}

function permissionCategory(permissionCode) {
  const prefix = String(permissionCode || "").split(".")[0];
  const labels = {
    workspace: "Workspace Administration",
    users: "Users and Permissions",
    audit: "Audit and Evidence",
    backup: "Backup and Restore",
    system: "System Operations",
    security: "Security Centre",
    workers: "Workers and Staff",
    executive: "Executive Operations",
    notifications: "Notifications",
    shared: "Shared Controls",
    spare_parts: "Spare Parts",
    installments: "Installment Sales",
    mining: "Mining Operations",
    fleet: "Fleet and Equipment",
    hire: "Equipment Hire",
    operations: "Operational Documents",
    sms: "SMS",
    exports: "Exports",
  };

  return labels[prefix] || "Other";
}

function humanizePermission(permissionCode) {
  return String(permissionCode || "")
    .replaceAll("_", " ")
    .replaceAll(".", " › ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildPermissionDescriptors(workspaceCode = "spare_parts") {
  const allowed = new Set(permissionsForWorkspace(workspaceCode));
  return ALL_PERMISSIONS.filter((permissionCode) => allowed.has(permissionCode)).map((permissionCode) => ({
    code: permissionCode,
    label: humanizePermission(permissionCode),
    category: permissionCategory(permissionCode),
    owner_protected: OWNER_PROTECTED_PERMISSIONS.includes(permissionCode),
    admin_only_grant: ADMIN_ONLY_GRANTS.includes(permissionCode),
  })).sort((a, b) =>
    `${a.category}:${a.label}`.localeCompare(`${b.category}:${b.label}`)
  );
}

module.exports = {
  ADMIN_ONLY_GRANTS,
  OWNER_PROTECTED_PERMISSIONS,
  applyPermissionOverrides,
  buildPermissionDescriptors,
  isKnownPermission,
  isOriginalSystemAdministrator,
  loadActivePermissionOverrides,
  normalizeEffect,
  normalizeWorkspace,
  resolveEffectivePermissions,
  validateOverridePolicy,
};
