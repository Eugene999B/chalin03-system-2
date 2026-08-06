"use strict";

const { isOriginalSystemAdministrator } = require("./systemAdminIdentity");
const { normalizeCode, normalizeRole } = require("./permissionCatalog");

const AI_PERSONAS = Object.freeze({
  COPILOT: "copilot",
  EXECUTIVE: "executive",
  GUIDE: "guide",
});

const AI_PERMISSIONS = Object.freeze([
  "ai.use",
  "ai.tools.view",
  "ai.conversations.view",
  "ai.conversations.manage",
  "ai.feedback.create",
  "ai.knowledge.view",
  "ai.knowledge.manage",
  "ai.knowledge.review",
  "ai.knowledge.publish",
  "ai.audit.view",
  "ai.usage.view",
  "ai.usage.manage",
  "ai.executive.use",
  "ai.actions.propose",
  "ai.actions.review",
  "ai.actions.execute",
]);

const AI_WORKSPACE_PERMISSIONS = Object.freeze([
  "ai.use",
  "ai.tools.view",
  "ai.conversations.view",
  "ai.conversations.manage",
  "ai.feedback.create",
  "ai.knowledge.view",
  "ai.audit.view",
  "ai.usage.view",
]);

const AI_ADMIN_PERMISSIONS = Object.freeze([
  ...AI_WORKSPACE_PERMISSIONS,
  "ai.knowledge.manage",
  "ai.knowledge.review",
  "ai.knowledge.publish",
  "ai.usage.manage",
]);

const AI_ROLE_GRANTS = Object.freeze({
  admin: AI_ADMIN_PERMISSIONS,
  manager: Object.freeze([
    "ai.use",
    "ai.tools.view",
    "ai.conversations.view",
    "ai.conversations.manage",
    "ai.feedback.create",
    "ai.knowledge.view",
    "ai.usage.view",
  ]),
  auditor: Object.freeze([
    "ai.use",
    "ai.tools.view",
    "ai.conversations.view",
    "ai.feedback.create",
    "ai.knowledge.view",
    "ai.audit.view",
    "ai.usage.view",
  ]),
});

const SUPPORTED_AI_WORKSPACES = Object.freeze([
  "spare_parts",
  "mining",
  "equipment_hire",
]);

function normalizeAiPermission(value) {
  const permission = String(value || "").trim().toLowerCase();
  return AI_PERMISSIONS.includes(permission) ? permission : null;
}

function normalizeAiPersona(value) {
  const persona = String(value || "").trim().toLowerCase();
  return Object.values(AI_PERSONAS).includes(persona) ? persona : null;
}

function normalizeAiWorkspace(value) {
  const workspace = normalizeCode(value);
  return SUPPORTED_AI_WORKSPACES.includes(workspace) ? workspace : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function explicitAiPermissions(user = {}) {
  return (Array.isArray(user.effective_permissions)
    ? user.effective_permissions
    : []
  )
    .map(normalizeAiPermission)
    .filter(Boolean);
}

function getEffectiveAiPermissions(user = {}) {
  if (isOriginalSystemAdministrator(user)) {
    return AI_PERMISSIONS;
  }

  const role = normalizeRole(user.role);
  const workspaceRole = normalizeRole(
    user.workspace_role || user.access_role || role
  );
  const workspace = normalizeAiWorkspace(
    user.workspace_code || user.active_workspace?.code
  );

  if (!workspace) {
    return unique(explicitAiPermissions(user));
  }

  const roleGrants =
    role === "admin"
      ? AI_ADMIN_PERMISSIONS
      : AI_ROLE_GRANTS[workspaceRole] || AI_ROLE_GRANTS[role] || [];

  const effective = unique([...roleGrants, ...explicitAiPermissions(user)]);

  // Executive and action permissions are never inferred from a normal role.
  return effective.filter(
    (permission) =>
      ![
        "ai.executive.use",
        "ai.actions.propose",
        "ai.actions.review",
        "ai.actions.execute",
      ].includes(permission) || explicitAiPermissions(user).includes(permission)
  );
}

function hasAiPermission(user, permission) {
  const normalized = normalizeAiPermission(permission);
  if (!normalized) return false;
  return getEffectiveAiPermissions(user).includes(normalized);
}

function hasEveryAiPermission(user, permissions) {
  return permissions.every((permission) => hasAiPermission(user, permission));
}

function hasAnyAiPermission(user, permissions) {
  return permissions.some((permission) => hasAiPermission(user, permission));
}

function getAiPermissionSnapshot(user = {}) {
  return Object.freeze({
    workspace: normalizeAiWorkspace(
      user.workspace_code || user.active_workspace?.code
    ),
    role: normalizeRole(user.role),
    workspace_role: normalizeRole(
      user.workspace_role || user.access_role || user.role
    ),
    original_system_administrator: isOriginalSystemAdministrator(user),
    permissions: getEffectiveAiPermissions(user),
  });
}

module.exports = {
  AI_ADMIN_PERMISSIONS,
  AI_PERMISSIONS,
  AI_PERSONAS,
  AI_ROLE_GRANTS,
  AI_WORKSPACE_PERMISSIONS,
  SUPPORTED_AI_WORKSPACES,
  explicitAiPermissions,
  getAiPermissionSnapshot,
  getEffectiveAiPermissions,
  hasAiPermission,
  hasAnyAiPermission,
  hasEveryAiPermission,
  normalizeAiPermission,
  normalizeAiPersona,
  normalizeAiWorkspace,
};
