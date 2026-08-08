"use strict";

const { pool } = require("../config/db");
const {
  CONTENT_STUDIO_PERMISSIONS,
} = require("../security/contentStudioPermissionCatalog");
const {
  isOriginalSystemAdministrator,
} = require("../security/systemAdminIdentity");

const CONTENT_STUDIO_WORKSPACE_CODE = "content_studio";
const CONTENT_STUDIO_WORKSPACE_NAME = "Content Studio";
const CONTENT_STUDIO_OWNER_ROLE = "content_administrator";
const CONTENT_STUDIO_ALL_SCOPES = Object.freeze([
  "dashboard",
  "pages",
  "newsroom",
  "company",
  "media",
  "forms",
  "submissions",
  "navigation",
  "settings",
  "access",
]);

const CONTENT_STUDIO_SCOPE_PREFIXES = Object.freeze([
  ["/access", "access"],
  ["/settings", "settings"],
  ["/navigation", "navigation"],
  ["/media", "media"],
  ["/forms", "forms"],
  ["/submissions", "submissions"],
  ["/newsroom", "newsroom"],
  ["/company-info", "company"],
  ["/portfolio", "company"],
  ["/pages", "pages"],
  ["/approvals", "pages"],
  ["/dashboard", "dashboard"],
]);

function clean(value) {
  return String(value ?? "").trim();
}

function boolValue(value) {
  return value === true || Number(value || 0) === 1;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

async function tableExists(tableName, connection = pool) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

function ownerAccess(user) {
  return {
    ok: true,
    owner: true,
    workspace_code: CONTENT_STUDIO_WORKSPACE_CODE,
    workspace_name: CONTENT_STUDIO_WORKSPACE_NAME,
    role_code: CONTENT_STUDIO_OWNER_ROLE,
    role_name: "Content Administrator",
    access_mode: "hybrid",
    permissions: [...CONTENT_STUDIO_PERMISSIONS],
    scopes: [...CONTENT_STUDIO_ALL_SCOPES],
  };
}

async function loadContentStudioAccess(user, connection = pool) {
  if (!user?.id) {
    return {
      ok: false,
      code: "CONTENT_STUDIO_AUTH_REQUIRED",
      message: "Content Studio authentication is required.",
    };
  }

  if (isOriginalSystemAdministrator(user)) {
    return ownerAccess(user);
  }

  if (!(await tableExists("content_studio_user_access", connection))) {
    return {
      ok: false,
      code: "CONTENT_STUDIO_ACCESS_NOT_READY",
      message: "Content Studio access is not configured yet.",
    };
  }

  const [rows] = await connection.query(
    `SELECT
       a.user_id,
       a.access_mode,
       a.is_active AS access_active,
       r.id AS role_id,
       r.role_code,
       r.name AS role_name,
       r.description AS role_description,
       r.is_active AS role_active
     FROM content_studio_user_access a
     INNER JOIN content_studio_roles r ON r.id = a.role_id
     WHERE a.user_id = ?
     LIMIT 1`,
    [user.id]
  );

  const access = rows[0];
  if (!access || !boolValue(access.access_active) || !boolValue(access.role_active)) {
    return {
      ok: false,
      code: "CONTENT_STUDIO_ACCESS_DENIED",
      message: "This account does not have active Content Studio access.",
    };
  }

  const [[permissionRows], [scopeRows]] = await Promise.all([
    connection.query(
      `SELECT permission_code
         FROM content_studio_role_permissions
        WHERE role_id = ?
        ORDER BY permission_code`,
      [access.role_id]
    ),
    connection.query(
      `SELECT scope_code
         FROM content_studio_role_scopes
        WHERE role_id = ?
        ORDER BY scope_code`,
      [access.role_id]
    ),
  ]);

  const permissions = unique(
    permissionRows
      .map((row) => clean(row.permission_code))
      .filter((permission) => CONTENT_STUDIO_PERMISSIONS.includes(permission))
  );
  const scopes = unique(scopeRows.map((row) => clean(row.scope_code)));

  if (!permissions.includes("public_content.view")) {
    return {
      ok: false,
      code: "CONTENT_STUDIO_ROLE_INVALID",
      message: "The assigned Content Studio role cannot open the Studio.",
    };
  }

  return {
    ok: true,
    owner: false,
    workspace_code: CONTENT_STUDIO_WORKSPACE_CODE,
    workspace_name: CONTENT_STUDIO_WORKSPACE_NAME,
    role_id: Number(access.role_id),
    role_code: clean(access.role_code),
    role_name: clean(access.role_name),
    role_description: clean(access.role_description),
    access_mode: clean(access.access_mode) || "studio_only",
    permissions,
    scopes,
  };
}

function scopeForContentStudioRequest(req) {
  const path = clean(req?.path || "/").toLowerCase();

  for (const [prefix, scope] of CONTENT_STUDIO_SCOPE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return scope;
  }

  return "dashboard";
}

function isContentStudioSession(user = {}) {
  return clean(user.workspace_code).toLowerCase() === CONTENT_STUDIO_WORKSPACE_CODE;
}

async function hydrateContentStudioSession(user, connection = pool) {
  if (!isContentStudioSession(user)) {
    return {
      ok: false,
      code: "CONTENT_STUDIO_SESSION_REQUIRED",
      message: "Open Content Studio with a Content Studio session.",
    };
  }

  const access = await loadContentStudioAccess(user, connection);
  if (!access.ok) return access;

  return {
    ...access,
    user: {
      ...user,
      workspace_code: CONTENT_STUDIO_WORKSPACE_CODE,
      workspace_role: access.role_code,
      business_unit_id: null,
      business_unit_name: CONTENT_STUDIO_WORKSPACE_NAME,
      branch_id: null,
      branch_code: null,
      branch_name: null,
      branch_location: null,
      can_access_all_branches: false,
      effective_permissions: access.permissions,
      content_studio_role: access.role_code,
      content_studio_role_name: access.role_name,
      content_studio_scopes: access.scopes,
      content_studio_access_mode: access.access_mode,
      is_content_studio_owner: Boolean(access.owner),
    },
  };
}

function contentStudioPathAllowedForSession(trustedPath = "") {
  const path = clean(trustedPath).toLowerCase();
  return (
    path === "/api/content-studio-auth/me" ||
    path === "/api/content-studio-auth/change-password" ||
    path === "/api/auth/logout" ||
    path === "/api/features/staff" ||
    path === "/api/content-studio" ||
    path.startsWith("/api/content-studio/")
  );
}

async function listContentStudioRoles(connection = pool) {
  const [rows] = await connection.query(
    `SELECT id, role_code, name, description, sort_order, is_system_role, is_active
       FROM content_studio_roles
      WHERE is_active = TRUE
      ORDER BY sort_order, name`
  );

  const roles = [];
  for (const row of rows) {
    const [[permissionRows], [scopeRows]] = await Promise.all([
      connection.query(
        `SELECT permission_code
           FROM content_studio_role_permissions
          WHERE role_id = ?
          ORDER BY permission_code`,
        [row.id]
      ),
      connection.query(
        `SELECT scope_code
           FROM content_studio_role_scopes
          WHERE role_id = ?
          ORDER BY scope_code`,
        [row.id]
      ),
    ]);
    roles.push({
      id: Number(row.id),
      role_code: row.role_code,
      name: row.name,
      description: row.description || "",
      sort_order: Number(row.sort_order || 0),
      is_system_role: boolValue(row.is_system_role),
      permissions: permissionRows.map((entry) => entry.permission_code),
      scopes: scopeRows.map((entry) => entry.scope_code),
    });
  }
  return roles;
}

module.exports = {
  CONTENT_STUDIO_ALL_SCOPES,
  CONTENT_STUDIO_OWNER_ROLE,
  CONTENT_STUDIO_SCOPE_PREFIXES,
  CONTENT_STUDIO_WORKSPACE_CODE,
  CONTENT_STUDIO_WORKSPACE_NAME,
  contentStudioPathAllowedForSession,
  hydrateContentStudioSession,
  isContentStudioSession,
  listContentStudioRoles,
  loadContentStudioAccess,
  ownerAccess,
  scopeForContentStudioRequest,
};
