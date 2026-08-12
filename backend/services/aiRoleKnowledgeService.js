"use strict";

const {
  getPublicPermissionCatalog,
} = require("../security/permissionCatalog");

const ROLE_QUERY_PATTERN = /\b(?:role|roles|permission|permissions|access|allowed|authority|authorities|can\s+(?:an?|the)?\s*\w+\s+(?:do|access|view|edit|manage|approve|sell|collect)|what\s+(?:can|does)\s+(?:an?|the)?\s*\w+)\b/i;

const WORKSPACE_MATCHERS = Object.freeze([
  Object.freeze({
    key: "spare_parts",
    label: "Spare Parts",
    pattern: /\b(?:spare\s+parts|parts\s+store|main\s+store|store\s+operations?)\b/i,
    catalog_key: "spare_parts_roles",
  }),
  Object.freeze({
    key: "mining",
    label: "Mining Operations",
    pattern: /\b(?:mining|mine|mining\s+operations?)\b/i,
    catalog_key: "mining_roles",
  }),
  Object.freeze({
    key: "equipment_hire",
    label: "Equipment Hire",
    pattern: /\b(?:equipment\s+hire|hire\s+operations?|hire\s+workspace)\b/i,
    catalog_key: "equipment_hire_roles",
  }),
]);

const ROLE_ALIASES = Object.freeze([
  Object.freeze({ key: "site_supervisor", pattern: /\bsite\s+supervisor\b/i }),
  Object.freeze({ key: "equipment_operator", pattern: /\bequipment\s+operator\b/i }),
  Object.freeze({ key: "site_clerk", pattern: /\bsite\s+clerk\b/i }),
  Object.freeze({ key: "hire_officer", pattern: /\bhire\s+officer\b/i }),
  Object.freeze({ key: "fleet_officer", pattern: /\bfleet\s+officer\b/i }),
  Object.freeze({ key: "auditor", pattern: /\bauditor\b/i }),
  Object.freeze({ key: "accountant", pattern: /\baccountant\b/i }),
  Object.freeze({ key: "dispatcher", pattern: /\bdispatcher\b/i }),
  Object.freeze({ key: "cashier", pattern: /\bcashier\b/i }),
  Object.freeze({ key: "manager", pattern: /\bmanager\b/i }),
  Object.freeze({ key: "admin", pattern: /\b(?:admin|administrator)\b/i }),
  Object.freeze({ key: "staff", pattern: /\bstaff\b/i }),
]);

const WRITE_AUTHORITY_PATTERN = /(?:\.manage$|\.create$|\.approve$|\.sell$|\.collect$|\.remind$|\.settings$|\.pay$|\.issue$|\.adjust$|\.prepare$|\.restore$|\.deactivate$|\.close_|\.damage$|\.evidence$|users\.manage$|workspace\.admin$|security\.admin$)/i;

const CRITICAL_WRITE_PERMISSIONS = Object.freeze({
  spare_parts: Object.freeze([
    "spare_parts.sell",
    "spare_parts.manage",
    "installments.manage",
    "installments.collect",
    "installments.remind",
    "installments.settings",
    "payroll.manage",
    "payroll.prepare",
    "payroll.approve",
    "payroll.pay",
    "users.manage",
    "workspace.admin",
  ]),
  mining: Object.freeze([
    "mining.sites.manage",
    "mining.daily_logs.create",
    "mining.daily_logs.approve",
    "mining.production.create",
    "mining.production.approve",
    "mining.fuel.manage",
    "mining.expenses.manage",
    "mining.expenses.approve",
    "payroll.manage",
    "payroll.approve",
    "users.manage",
    "workspace.admin",
  ]),
  equipment_hire: Object.freeze([
    "hire.customers.manage",
    "hire.quotations.manage",
    "hire.quotations.approve",
    "hire.contracts.manage",
    "hire.dispatch.manage",
    "hire.invoices.manage",
    "hire.payments.manage",
    "hire.returns.manage",
    "payroll.manage",
    "payroll.approve",
    "users.manage",
    "workspace.admin",
  ]),
});

const ROLE_LIVE_IDENTITY_PATTERN = /(?:\b(?:my|mine|logged[- ]in|current\s+user|this\s+user|this\s+account|my\s+account)\b[\s\S]{0,80}\b(?:role|permissions?|access|authority|capabilities)\b)|(?:\b(?:role|permissions?|access|authority|capabilities)\b[\s\S]{0,80}\b(?:my|mine|logged[- ]in|current\s+user|this\s+user|this\s+account|my\s+account)\b)|(?:\b(?:user|account)\s*(?:#\s*\d+|@\w+|\d+)\b[\s\S]{0,80}\b(?:role|permissions?|access|authority)\b)|(?:\b(?:what\s+can\s+i\s+do|what\s+am\s+i\s+allowed\s+to\s+do)\b[\s\S]{0,80}\b(?:right\s+now|currently|with\s+this\s+(?:login|account))\b)/i;

function clean(value, maximum = 12000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function labelRole(value) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function matchWorkspace(text) {
  return WORKSPACE_MATCHERS.find((workspace) => workspace.pattern.test(text)) || null;
}

function matchRole(text) {
  return ROLE_ALIASES.find((role) => role.pattern.test(text)) || null;
}

function isLiveEffectiveRoleRequest(value) {
  const text = clean(value);
  return Boolean(text && ROLE_LIVE_IDENTITY_PATTERN.test(text));
}

function prioritizedMissingWriteAuthority(workspaceKey, workspacePermissions, grants) {
  const absent = workspacePermissions.filter(
    (permission) =>
      WRITE_AUTHORITY_PATTERN.test(permission) && !grants.includes(permission)
  );
  const critical = (CRITICAL_WRITE_PERMISSIONS[workspaceKey] || []).filter(
    (permission) => absent.includes(permission)
  );
  return [...critical, ...absent.filter((permission) => !critical.includes(permission))];
}

function roleKnowledgeForPrompt(value) {
  const text = clean(value);
  if (!text || isLiveEffectiveRoleRequest(text)) return null;
  if (!ROLE_QUERY_PATTERN.test(text)) return null;

  const workspace = matchWorkspace(text);
  const role = matchRole(text);
  if (!workspace || !role) return null;

  const catalog = getPublicPermissionCatalog();
  const roleCatalog = catalog?.[workspace.catalog_key] || {};
  const grants = Array.isArray(roleCatalog?.[role.key])
    ? [...roleCatalog[role.key]]
    : null;
  if (!grants) return null;

  const writable = grants.filter((permission) => WRITE_AUTHORITY_PATTERN.test(permission));
  const readAuditExport = grants.filter(
    (permission) => !WRITE_AUTHORITY_PATTERN.test(permission)
  );
  const workspacePermissions = Array.isArray(catalog?.workspace_permissions?.[workspace.key])
    ? catalog.workspace_permissions[workspace.key]
    : [];
  const absentWriteAuthority = prioritizedMissingWriteAuthority(
    workspace.key,
    workspacePermissions,
    grants
  );

  return Object.freeze({
    workspace_key: workspace.key,
    workspace_label: workspace.label,
    role_key: role.key,
    role_label: labelRole(role.key),
    granted_permissions: Object.freeze(grants),
    read_audit_export_permissions: Object.freeze(readAuditExport),
    write_authority_permissions: Object.freeze(writable),
    absent_write_authority_permissions: Object.freeze(absentWriteAuthority),
    role_template_read_only: writable.length === 0,
    authority: "current_source_permission_catalog",
    source_of_truth_for_named_role_template: true,
    source_of_truth_for_specific_users_effective_access: false,
  });
}

function renderRoleKnowledgeForPrompt(value) {
  const role = roleKnowledgeForPrompt(value);
  if (!role) return "";

  const granted = role.granted_permissions.join(", ") || "none";
  const writes = role.write_authority_permissions.join(", ") || "none";
  const absentWrites = role.absent_write_authority_permissions.slice(0, 18).join(", ") || "none";

  return [
    "Verified CHALIN role-authority source for this question:",
    `- Workspace: ${role.workspace_label} (${role.workspace_key})`,
    `- Role template: ${role.role_label} (${role.role_key})`,
    `- Exact workspace-role grants: ${granted}`,
    `- Explicit write/operational authority granted by this role template: ${writes}`,
    `- Important write/operational permissions in this workspace that this role template does not grant: ${absentWrites}`,
    `- Read-only role template: ${role.role_template_read_only ? "yes" : "no"}`,
    "Answer from this CHALIN source-derived role template. Translate permission codes into clear business language. Do not say 'typically', 'usually', or invent generic industry responsibilities that are not supported by the grants above.",
    "Do not confuse a static role template with a specific person's effective access. If the user asks what a named/logged-in person can do right now, require governed live account/scope evidence instead of using this static template.",
  ].join("\n");
}

module.exports = {
  CRITICAL_WRITE_PERMISSIONS,
  ROLE_LIVE_IDENTITY_PATTERN,
  ROLE_QUERY_PATTERN,
  WRITE_AUTHORITY_PATTERN,
  WORKSPACE_MATCHERS,
  isLiveEffectiveRoleRequest,
  prioritizedMissingWriteAuthority,
  roleKnowledgeForPrompt,
  renderRoleKnowledgeForPrompt,
};
