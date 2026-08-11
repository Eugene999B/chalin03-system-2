"use strict";

const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  getAiPermissionSnapshot,
  hasAiPermission,
} = require("../security/aiPermissionCatalog");

const AI_MAX_RISK_LEVEL = 5;

const ENTERPRISE_CAPABILITY_MODULES = Object.freeze([
  "spare_parts",
  "mining",
  "equipment_hire",
  "equipment_installment_finance",
  "customers_accounting",
  "people_employment_payroll",
  "content_studio",
  "public_website",
  "audit_security",
  "chalin_intelligence",
  "system_administration",
]);

function clampRiskLevel(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(1, Math.min(AI_MAX_RISK_LEVEL, number));
}

function resolveAiRiskCeiling(user = {}) {
  if (isOriginalSystemAdministrator(user)) return 5;
  if (hasAiPermission(user, "ai.actions.execute")) return 4;
  if (
    hasAiPermission(user, "ai.actions.review") ||
    hasAiPermission(user, "ai.actions.propose")
  ) {
    return 3;
  }
  if (hasAiPermission(user, "ai.read")) return 2;
  return 1;
}

function actionAuthorityForRisk(riskLevel) {
  const risk = clampRiskLevel(riskLevel);
  if (risk === 1) return "observe";
  if (risk === 2) return "analyze_generate";
  if (risk === 3) return "prepare_propose";
  if (risk === 4) return "controlled_execute";
  return "critical_enterprise_execute";
}

function allowedRiskLevels(ceiling) {
  const safeCeiling = clampRiskLevel(ceiling);
  return Object.freeze(
    Array.from({ length: safeCeiling }, (_, index) => index + 1)
  );
}

function resolveAiCapabilityProfile({ user = {}, scope = null } = {}) {
  const permissionSnapshot = getAiPermissionSnapshot(user);
  const originalSystemAdministrator = isOriginalSystemAdministrator(user);
  const riskCeiling = resolveAiRiskCeiling(user);
  const crossWorkspace =
    originalSystemAdministrator || hasAiPermission(user, "ai.executive.use");
  const activeWorkspace =
    scope?.workspace_code || permissionSnapshot.workspace || null;

  const modules = originalSystemAdministrator
    ? ENTERPRISE_CAPABILITY_MODULES
    : Object.freeze(
        [...new Set([activeWorkspace, "chalin_intelligence"].filter(Boolean))]
      );

  return Object.freeze({
    actor: Object.freeze({
      id: Number(user?.id) || null,
      username: String(user?.username || "").trim().slice(0, 120) || null,
      role: String(user?.role || "").trim().toLowerCase().slice(0, 80) || null,
      workspace_role:
        String(
          user?.workspace_role || user?.access_role || user?.role || ""
        )
          .trim()
          .toLowerCase()
          .slice(0, 80) || null,
    }),
    original_system_administrator: originalSystemAdministrator,
    scope_mode: originalSystemAdministrator
      ? "enterprise_superuser"
      : crossWorkspace
        ? "authorized_cross_workspace"
        : "workspace_scoped",
    active_workspace: activeWorkspace,
    cross_workspace: crossWorkspace,
    enterprise_registered_surface_access: originalSystemAdministrator,
    sensitive_data_access: hasAiPermission(user, "ai.read_sensitive"),
    risk_ceiling: riskCeiling,
    allowed_risk_levels: allowedRiskLevels(riskCeiling),
    highest_authority: actionAuthorityForRisk(riskCeiling),
    can_propose_actions: hasAiPermission(user, "ai.actions.propose"),
    can_review_actions: hasAiPermission(user, "ai.actions.review"),
    can_execute_actions: hasAiPermission(user, "ai.actions.execute"),
    modules,
    permissions: permissionSnapshot.permissions,
  });
}

function assertAiRiskAuthorized(user = {}, riskLevel = 1) {
  const requestedRisk = clampRiskLevel(riskLevel);
  const ceiling = resolveAiRiskCeiling(user);

  if (requestedRisk > ceiling) {
    const error = new Error(
      requestedRisk === 5
        ? "Risk Level 5 CHALIN actions are reserved for the original System Administrator."
        : `The current login is authorized through AI Risk Level ${ceiling}, but this tool requires Risk Level ${requestedRisk}.`
    );
    error.name = "AiPermissionError";
    error.code =
      requestedRisk === 5
        ? "AI_RISK5_SYSTEM_ADMIN_REQUIRED"
        : "AI_RISK_LEVEL_DENIED";
    error.statusCode = 403;
    error.details = Object.freeze({
      requested_risk_level: requestedRisk,
      risk_ceiling: ceiling,
    });
    throw error;
  }

  return true;
}

function capabilityPromptBlock(profile = {}) {
  const modules = Array.isArray(profile.modules) ? profile.modules.join(", ") : "";
  return [
    "CHALIN authenticated capability context:",
    `- Login role: ${profile.actor?.role || "unknown"}.`,
    `- Workspace role: ${profile.actor?.workspace_role || "unknown"}.`,
    `- Authority scope: ${profile.scope_mode || "workspace_scoped"}.`,
    `- Active workspace: ${profile.active_workspace || "none"}.`,
    `- Maximum authorized AI risk level: ${clampRiskLevel(profile.risk_ceiling || 1)}.`,
    `- Cross-workspace reasoning: ${profile.cross_workspace === true ? "allowed" : "not allowed"}.`,
    `- Sensitive-data access: ${profile.sensitive_data_access === true ? "allowed when a governed tool and business permission also allow it" : "not allowed"}.`,
    modules ? `- Registered capability modules visible to this authority profile: ${modules}.` : "",
    "- Authority never proves a business fact. Use governed evidence for factual claims and approved business services for actions.",
    "- Never tell the original System Administrator to ask an administrator for an authority that this profile explicitly grants; instead explain whether the requested governed capability exists yet.",
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  AI_MAX_RISK_LEVEL,
  ENTERPRISE_CAPABILITY_MODULES,
  actionAuthorityForRisk,
  allowedRiskLevels,
  assertAiRiskAuthorized,
  capabilityPromptBlock,
  clampRiskLevel,
  resolveAiCapabilityProfile,
  resolveAiRiskCeiling,
};
