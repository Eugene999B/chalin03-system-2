"use strict";

const { aiToolRegistry } = require("../services/aiToolRegistry");
const {
  loadAuditSecurityIntelligence,
} = require("../services/aiAuditSecurityIntelligenceService");

let registered = false;

const DATE_PROPERTIES = Object.freeze({
  start_date: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Optional inclusive audit-period start date in YYYY-MM-DD format.",
  },
  end_date: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Optional inclusive audit-period end date in YYYY-MM-DD format.",
  },
});

function auditSecurityEvidence(output = {}) {
  const scope = output.scope || {};
  const scopeRef =
    scope.mode === "enterprise"
      ? "enterprise"
      : scope.branch_id
        ? `branch:${scope.branch_id}`
        : scope.mining_site_id
          ? `mining-site:${scope.mining_site_id}`
          : scope.hire_location_id
            ? `hire-location:${scope.hire_location_id}`
            : `workspace:${scope.workspace_code || "unknown"}`;

  return [
    {
      source_type: "audit_controls_snapshot",
      source_ref: `audit-controls:${scopeRef}:${scope.start_date || "from"}:${scope.end_date || "to"}`,
      source_version: "live-read-only-v1",
      label: "CHALIN audit, controls and security health",
      excerpt_text: JSON.stringify(output).slice(0, 16000),
      as_of_at: output.generated_at,
      classification: "confidential",
      workspace_code: scope.workspace_code || "enterprise",
      metadata: {
        scope_mode: scope.mode || "workspace_context",
        workspace_code: scope.workspace_code || null,
        branch_id: scope.branch_id || null,
        mining_site_id: scope.mining_site_id || null,
        hire_location_id: scope.hire_location_id || null,
        aggregate_only: true,
        actor_rows_exposed: false,
        usernames_exposed: false,
        ip_addresses_exposed: false,
        raw_details_exposed: false,
        raw_metadata_exposed: false,
        execution_authority: "read_only",
      },
    },
  ];
}

function registerAuditSecurityAiTools(
  registry = aiToolRegistry,
  { loader = loadAuditSecurityIntelligence } = {}
) {
  if (registered && registry === aiToolRegistry) return registry.list();

  registry.register({
    key: "system.audit_controls_health",
    version: "1",
    title: "Audit, controls and security health",
    description:
      "Returns aggregate read-only audit/control health for the authorized workspace context, including failed/high-severity activity, authentication and access-change signals, backup/restore/export activity, protected approvals/unlocks, audit sign-offs, shared-control evidence and governed AI-action status. It exposes no actor rows, usernames, IP addresses, raw details or metadata. Enterprise group mode is enforced server-side for the original System Administrator only.",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.read", "ai.audit.view"],
    required_business_permissions: ["audit.view"],
    allowed_workspaces: ["spare_parts", "mining", "equipment_hire"],
    scope_requirements: {},
    evidence_required: true,
    max_input_bytes: 1800,
    max_output_bytes: 100000,
    timeout_ms: 15000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...DATE_PROPERTIES,
        group_mode: {
          type: "boolean",
          description:
            "Original System Administrator only. When true, return enterprise-wide aggregate audit/control health instead of the active workspace/context.",
        },
      },
    },
    handler: async ({ input, context }) => {
      const output = await loader({ context, input });
      return {
        ...output,
        evidence: auditSecurityEvidence(output),
        execution_authority: "read_only",
      };
    },
  });

  if (registry === aiToolRegistry) registered = true;
  return registry.list();
}

module.exports = {
  DATE_PROPERTIES,
  auditSecurityEvidence,
  registerAuditSecurityAiTools,
};
