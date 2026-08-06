"use strict";

const {
  AI_PERSONAS,
  getAiPermissionSnapshot,
  hasEveryAiPermission,
  normalizeAiPersona,
  normalizeAiWorkspace,
} = require("../security/aiPermissionCatalog");

class AiPermissionError extends Error {
  constructor(message, { code = "AI_PERMISSION_DENIED", statusCode = 403, details = [] } = {}) {
    super(message);
    this.name = "AiPermissionError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function contextHeader(req) {
  return req?.headers?.["x-chalin03-context-id"] || null;
}

function resolveAiScope({ req = null, user = req?.user || {}, persona = "copilot" } = {}) {
  const normalizedPersona = normalizeAiPersona(persona);
  if (!normalizedPersona) {
    throw new AiPermissionError("Invalid CHALIN ONE intelligence persona.", {
      code: "AI_PERSONA_INVALID",
      statusCode: 400,
    });
  }

  if (normalizedPersona === AI_PERSONAS.GUIDE) {
    return Object.freeze({
      persona: AI_PERSONAS.GUIDE,
      user_id: null,
      workspace_code: null,
      branch_id: null,
      mining_site_id: null,
      hire_location_id: null,
      visibility: "public_session",
      permission_snapshot: Object.freeze({ permissions: [] }),
    });
  }

  if (!user?.id) {
    throw new AiPermissionError("Authentication is required for staff intelligence.", {
      code: "AUTHENTICATION_REQUIRED",
      statusCode: 401,
    });
  }

  const permissionSnapshot = getAiPermissionSnapshot(user);
  const workspace = normalizeAiWorkspace(user.workspace_code);
  if (!workspace) {
    throw new AiPermissionError(
      "Choose a supported CHALIN ONE workspace before using staff intelligence.",
      { code: "AI_WORKSPACE_REQUIRED", statusCode: 409 }
    );
  }

  const sharedContextId = positiveInteger(contextHeader(req));
  const branchId = positiveInteger(
    req?.branchScope?.branchId || user.branch_id || user.default_branch_id
  );
  const miningSiteId = positiveInteger(
    req?.miningSiteScope?.siteId || (workspace === "mining" ? sharedContextId : null)
  );
  const hireLocationId = positiveInteger(
    req?.hireLocationScope?.locationId ||
      (workspace === "equipment_hire" ? sharedContextId : null)
  );

  return Object.freeze({
    persona: normalizedPersona,
    user_id: Number(user.id),
    workspace_code: workspace,
    branch_id: workspace === "spare_parts" ? branchId : null,
    mining_site_id: workspace === "mining" ? miningSiteId : null,
    hire_location_id:
      workspace === "equipment_hire" ? hireLocationId : null,
    visibility:
      normalizedPersona === AI_PERSONAS.EXECUTIVE ? "executive" : "private",
    permission_snapshot: permissionSnapshot,
  });
}

function assertPermissions(user, requiredPermissions = []) {
  const required = [...new Set(requiredPermissions.filter(Boolean))];
  if (!hasEveryAiPermission(user, required)) {
    throw new AiPermissionError(
      "The current account does not have the required AI permissions.",
      { code: "AI_TOOL_PERMISSION_DENIED", details: required }
    );
  }
  return true;
}

function assertWorkspaceAllowed(scope, allowedWorkspaces = []) {
  if (!allowedWorkspaces.length) return true;
  if (!allowedWorkspaces.includes(scope.workspace_code)) {
    throw new AiPermissionError(
      "This intelligence tool is not available in the active workspace.",
      {
        code: "AI_TOOL_WORKSPACE_DENIED",
        details: {
          active_workspace: scope.workspace_code,
          allowed_workspaces: allowedWorkspaces,
        },
      }
    );
  }
  return true;
}

function assertRequiredLocationScope(scope, requirements = {}) {
  if (requirements.branch === true && !scope.branch_id) {
    throw new AiPermissionError(
      "Choose an authorized Spare Parts branch before using this tool.",
      { code: "AI_BRANCH_SCOPE_REQUIRED", statusCode: 409 }
    );
  }
  if (requirements.mining_site === true && !scope.mining_site_id) {
    throw new AiPermissionError(
      "Choose an authorized mining site before using this tool.",
      { code: "AI_MINING_SITE_SCOPE_REQUIRED", statusCode: 409 }
    );
  }
  if (requirements.hire_location === true && !scope.hire_location_id) {
    throw new AiPermissionError(
      "Choose an authorized Equipment Hire location before using this tool.",
      { code: "AI_HIRE_LOCATION_SCOPE_REQUIRED", statusCode: 409 }
    );
  }
  return true;
}

function buildToolExecutionContext({ req, persona, tool }) {
  const scope = resolveAiScope({ req, persona });
  assertPermissions(req.user, tool.required_permissions || []);
  assertWorkspaceAllowed(scope, tool.allowed_workspaces || []);
  assertRequiredLocationScope(scope, tool.scope_requirements || {});

  // Handlers receive a minimized immutable context, never req, res, pool,
  // connection or SQL access.
  return Object.freeze({
    request_id: req.requestId || null,
    actor: Object.freeze({
      id: scope.user_id,
      username: String(req.user?.username || "").slice(0, 120) || null,
      role: String(req.user?.role || "").slice(0, 80) || null,
    }),
    scope,
    permissions: Object.freeze([
      ...(scope.permission_snapshot?.permissions || []),
    ]),
    tool: Object.freeze({
      key: tool.key,
      version: tool.version,
      risk_level: tool.risk_level,
    }),
  });
}

module.exports = {
  AiPermissionError,
  assertPermissions,
  assertRequiredLocationScope,
  assertWorkspaceAllowed,
  buildToolExecutionContext,
  contextHeader,
  positiveInteger,
  resolveAiScope,
};
