"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  buildAuditDrivers,
  loadAuditSecurityIntelligence,
  normalizeAuditWindow,
  resolveAuditScope,
} = require("../services/aiAuditSecurityIntelligenceService");
const {
  expertPacksForPrompt,
  getExpertPack,
} = require("../services/aiExpertPackService");
const {
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
  productKnowledgeInstruction,
} = require("../services/aiProductKnowledgeService");
const {
  registerAuditSecurityAiTools,
} = require("../ai-tools/auditSecurityTools");
const {
  LocalAuditSecurityGovernedProvider,
  auditSecurityToolInput,
  composeAuditSecurityAnswer,
  composeAuditSecurityProductAnswer,
  shouldUseAuditSecurityTool,
} = require("../ai-providers/localAuditSecurityGovernedProvider");

const repoRoot = path.resolve(__dirname, "../..");
const toolSource = fs.readFileSync(
  path.join(repoRoot, "backend", "ai-tools", "auditSecurityTools.js"),
  "utf8"
);
const providerRegistrationSource = fs.readFileSync(
  path.join(repoRoot, "backend", "ai-providers", "registerAiProviders.js"),
  "utf8"
);

function normalContext(overrides = {}) {
  return {
    actor: { id: 9, role: "auditor", username: "auditor" },
    authority: {
      original_system_administrator: false,
      cross_workspace: false,
    },
    scope: {
      persona: "copilot",
      workspace_code: "spare_parts",
      branch_id: 4,
      mining_site_id: null,
      hire_location_id: null,
    },
    ...overrides,
  };
}

function originalAdminContext() {
  return {
    actor: { id: 1, role: "admin", username: "admin" },
    authority: {
      original_system_administrator: true,
      cross_workspace: true,
    },
    scope: {
      persona: "executive",
      workspace_code: "spare_parts",
      branch_id: 4,
      mining_site_id: null,
      hire_location_id: null,
    },
  };
}

function fixture() {
  const activity = {
    available: true,
    summary: {
      total_events: 20,
      failed_events: 3,
      high_or_critical_events: 2,
      warning_events: 4,
    },
    groups: [
      {
        key: "authentication",
        event_count: 5,
        failed_events: 2,
        high_or_critical_events: 1,
        last_event_at: "2026-08-11T12:00:00.000Z",
      },
      {
        key: "users_access",
        event_count: 2,
        failed_events: 0,
        high_or_critical_events: 0,
        last_event_at: "2026-08-11T11:00:00.000Z",
      },
      {
        key: "backup_recovery_export",
        event_count: 2,
        failed_events: 1,
        high_or_critical_events: 0,
        last_event_at: "2026-08-10T10:00:00.000Z",
      },
    ],
  };
  const signoffs = {
    available: true,
    total: 3,
    statuses: { draft: 1, approved: 1, rejected: 1 },
  };
  const unlocks = {
    available: true,
    total: 4,
    statuses: { pending: 1, rejected: 1, approved: 2 },
    execution: { failed: 1, not_applicable: 3 },
  };
  const aiActions = {
    available: true,
    total: 3,
    statuses: { pending_review: 1, failed: 1, executed: 1 },
    risk_levels: { "3": 1, "5": 2 },
  };
  return {
    scope: {
      mode: "workspace_context",
      workspace_code: "spare_parts",
      branch_id: 4,
      mining_site_id: null,
      hire_location_id: null,
      original_system_administrator: false,
      start_date: "2026-08-01",
      end_date: "2026-08-11",
      days: 11,
    },
    activity,
    shared_control_evidence: {
      available: true,
      total: 4,
      areas: [{ control_area: "audit", action_type: "view", event_count: 4 }],
    },
    audit_signoffs: signoffs,
    protected_unlocks_and_approvals: unlocks,
    ai_action_governance: aiActions,
    drivers: buildAuditDrivers({ activity, signoffs, unlocks, aiActions }),
    privacy: {
      aggregate_only: true,
      actor_rows_exposed: false,
      usernames_exposed: false,
      ip_addresses_exposed: false,
      raw_details_exposed: false,
      raw_metadata_exposed: false,
      secret_like_metadata_redacted_at_audit_write: true,
    },
    certainty: {
      failed_event_is_not_proof_of_wrongdoing: true,
      high_severity_is_not_proof_of_compromise: true,
      unlock_or_approval_event_is_not_proof_source_record_was_wrong: true,
      backup_event_is_not_proof_restore_was_verified: true,
      absence_of_aggregate_signal_is_not_proof_of_absence: true,
      risk5_counts_do_not_bypass_system_admin_governance: true,
      warning:
        "Audit/control aggregates prioritize investigation. They do not establish fraud, malicious intent, security compromise or financial loss without the underlying authorized event/source evidence.",
    },
    generated_at: "2026-08-11T14:00:00.000Z",
    execution_authority: "read_only",
  };
}

function fakeAuditConnection() {
  const columns = {
    activity_log: [
      "action",
      "created_at",
      "entity_type",
      "outcome",
      "severity",
      "workspace_code",
      "branch_id",
      "mining_site_id",
      "hire_location_id",
      "user_id",
      "details",
      "ip_address",
      "metadata_json",
    ],
    shared_control_evidence: [
      "workspace_code",
      "branch_id",
      "mining_site_id",
      "hire_location_id",
      "created_at",
      "control_area",
      "action_type",
    ],
    audit_signoffs: ["created_at", "branch_id", "period_status"],
    audit_unlock_requests: [
      "created_at",
      "branch_id",
      "status",
      "execution_status",
    ],
    ai_action_proposals: [
      "created_at",
      "workspace_code",
      "branch_id",
      "mining_site_id",
      "hire_location_id",
      "proposal_status",
      "risk_level",
    ],
  };

  return {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      const show = text.match(/^SHOW COLUMNS FROM `([^`]+)`/i);
      if (show) {
        return [
          (columns[show[1]] || []).map((Field) => ({ Field })),
        ];
      }
      if (/FROM activity_log/i.test(text)) {
        assert.doesNotMatch(text, /SELECT[^;]*(?:user_id|details|ip_address|metadata_json)/i);
        return [[
          {
            action: "LOGIN_FAILED",
            entity_type: "session",
            outcome: "failed",
            severity: "high",
            workspace_code: "spare_parts",
            event_count: 2,
            last_event_at: "2026-08-11T12:00:00.000Z",
          },
          {
            action: "USER_PERMISSION_UPDATED",
            entity_type: "user",
            outcome: "success",
            severity: "info",
            workspace_code: "spare_parts",
            event_count: 1,
            last_event_at: "2026-08-11T11:00:00.000Z",
          },
          {
            action: "BACKUP_RESTORE_FAILED",
            entity_type: "backup",
            outcome: "failed",
            severity: "warning",
            workspace_code: "spare_parts",
            event_count: 1,
            last_event_at: "2026-08-10T10:00:00.000Z",
          },
        ]];
      }
      if (/FROM shared_control_evidence/i.test(text)) {
        return [[
          { control_area: "audit", action_type: "view", event_count: 4 },
        ]];
      }
      if (/FROM audit_signoffs/i.test(text)) {
        return [[
          { status: "draft", count: 1 },
          { status: "approved", count: 1 },
        ]];
      }
      if (/FROM audit_unlock_requests/i.test(text)) {
        return [[
          { status: "pending", execution_status: "not_applicable", count: 1 },
          { status: "approved", execution_status: "failed", count: 1 },
        ]];
      }
      if (/FROM ai_action_proposals/i.test(text)) {
        return [[
          { status: "pending_review", risk_level: 5, count: 1 },
          { status: "failed", risk_level: 3, count: 1 },
        ]];
      }
      throw new Error(`Unexpected query: ${text.slice(0, 200)}`);
    },
  };
}

test("Audit Controls expert pack captures control and verdict boundaries", () => {
  const pack = getExpertPack("audit_controls_security");
  assert.equal(pack.key, "audit_controls_security");
  assert.equal(pack.deployment_availability.status, "available_in_current_source_tree");
  assert.equal(pack.boundaries.audit_metadata_secrets_are_redacted, true);
  assert.equal(pack.boundaries.normal_audit_visibility_is_workspace_context_scoped, true);
  assert.equal(pack.boundaries.original_system_administrator_may_use_enterprise_audit_scope, true);
  assert.equal(pack.boundaries.failure_or_high_severity_is_not_proof_of_wrongdoing, true);
  assert.equal(pack.boundaries.unlock_or_approval_is_payload_specific, true);
  assert.equal(pack.boundaries.backup_validation_and_restore_are_distinct_controls, true);
  assert.ok(pack.facts.some((fact) => fact.key === "ai_action_governance_is_auditable"));
  assert.ok(pack.workflows.some((workflow) => workflow.key === "protected_correction"));
});

test("Audit expert selection is domain-specific and combines with Payroll when relevant", () => {
  const audit = expertPacksForPrompt("How does audit sign-off work in CHALIN?");
  assert.deepEqual(audit.map((pack) => pack.key), ["audit_controls_security"]);

  const mining = expertPacksForPrompt("How does Mining production work in CHALIN?");
  assert.equal(mining.some((pack) => pack.key === "audit_controls_security"), false);

  const combined = expertPacksForPrompt(
    "How are Payroll approval and audit controls governed in CHALIN?"
  );
  assert.equal(combined.some((pack) => pack.key === "people_employment_payroll"), true);
  assert.equal(combined.some((pack) => pack.key === "audit_controls_security"), true);
});

test("static audit help stays product-safe while live audit activity is governed", () => {
  const staticPrompt = "How does audit sign-off work in CHALIN?";
  assert.equal(isLikelyLiveRecordRequest(staticPrompt), false);
  assert.equal(isChalinProductKnowledgeTurn(staticPrompt), true);
  const instruction = productKnowledgeInstruction(staticPrompt);
  assert.match(instruction, /Audit, Controls, Security & Approval Intelligence/);
  assert.match(instruction, /not proof of fraud/i);

  for (const prompt of [
    "What is the current audit activity in CHALIN?",
    "What security controls failed today in CHALIN?",
    "Who changed permissions today in CHALIN?",
  ]) {
    assert.equal(isLikelyLiveRecordRequest(prompt), true, prompt);
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
  }
});

test("audit scope enforces context for normal users and enterprise mode for original System Administrator", () => {
  assert.deepEqual(
    resolveAuditScope(normalContext(), {}),
    {
      mode: "workspace_context",
      workspace_code: "spare_parts",
      branch_id: 4,
      mining_site_id: null,
      hire_location_id: null,
      original_system_administrator: false,
    }
  );

  assert.throws(
    () =>
      resolveAuditScope(
        normalContext({
          scope: {
            persona: "copilot",
            workspace_code: "spare_parts",
            branch_id: null,
            mining_site_id: null,
            hire_location_id: null,
          },
        }),
        {}
      ),
    (error) => error.code === "AI_AUDIT_CONTEXT_REQUIRED"
  );
  assert.throws(
    () => resolveAuditScope(normalContext(), { group_mode: true }),
    (error) => error.code === "AI_AUDIT_ENTERPRISE_SCOPE_DENIED"
  );
  assert.deepEqual(
    resolveAuditScope(originalAdminContext(), { group_mode: true }),
    {
      mode: "enterprise",
      workspace_code: null,
      branch_id: null,
      mining_site_id: null,
      hire_location_id: null,
      original_system_administrator: true,
    }
  );
});

test("audit window defaults to 30 days and rejects oversized requests", () => {
  const now = new Date("2026-08-11T14:00:00.000Z");
  assert.deepEqual(normalizeAuditWindow({}, now), {
    start_date: "2026-07-13",
    end_date: "2026-08-11",
    days: 30,
  });
  assert.throws(
    () =>
      normalizeAuditWindow(
        { start_date: "2025-01-01", end_date: "2026-08-11" },
        now
      ),
    (error) => error.code === "AI_AUDIT_WINDOW_TOO_LARGE"
  );
});

test("audit drivers treat failures, severity and approvals as investigation signals rather than verdicts", () => {
  const output = fixture();
  const byKey = new Map(output.drivers.map((driver) => [driver.key, driver]));
  assert.equal(byKey.get("failed_control_events").effect, "control_review_required");
  assert.equal(byKey.get("high_severity_events").effect, "priority_investigation_signal");
  assert.equal(byKey.get("authentication_control_pressure").effect, "access_security_review");
  assert.equal(byKey.get("user_access_changes").effect, "permission_change_review");
  assert.equal(byKey.get("backup_restore_export_activity").effect, "recovery_or_data_movement_review");
  assert.equal(byKey.get("protected_exception_pressure").effect, "protected_correction_review");
  assert.equal(byKey.get("audit_signoff_backlog").effect, "period_review_incomplete");
  assert.equal(byKey.get("governed_ai_action_activity").effect, "ai_action_control_review");
  assert.match(byKey.get("high_severity_events").explanation, /not proof/i);
  assert.match(byKey.get("protected_exception_pressure").explanation, /not proof/i);
});

test("live audit service returns aggregate-only secret-free scoped control evidence", async () => {
  const output = await loadAuditSecurityIntelligence({
    context: normalContext(),
    input: { start_date: "2026-08-01", end_date: "2026-08-11" },
    connection: fakeAuditConnection(),
    now: new Date("2026-08-11T14:00:00.000Z"),
  });
  assert.equal(output.scope.workspace_code, "spare_parts");
  assert.equal(output.scope.branch_id, 4);
  assert.equal(output.activity.summary.total_events, 4);
  assert.equal(output.activity.summary.failed_events, 3);
  assert.equal(output.activity.summary.high_or_critical_events, 2);
  assert.equal(output.shared_control_evidence.total, 4);
  assert.equal(output.audit_signoffs.total, 2);
  assert.equal(output.protected_unlocks_and_approvals.total, 2);
  assert.equal(output.ai_action_governance.total, 2);
  assert.equal(output.privacy.aggregate_only, true);
  assert.equal(output.privacy.actor_rows_exposed, false);
  assert.equal(output.privacy.usernames_exposed, false);
  assert.equal(output.privacy.ip_addresses_exposed, false);
  assert.equal(output.privacy.raw_details_exposed, false);
  assert.equal(output.privacy.raw_metadata_exposed, false);
  const serialized = JSON.stringify(output);
  assert.doesNotMatch(serialized, /password|api[_-]?key|jwt|192\.168|actor_name|username/i);
});

test("audit tool is Risk-1, audit-gated, confidential and exposes no actor/detail rows", async () => {
  const registry = new AiToolRegistry();
  registerAuditSecurityAiTools(registry, { loader: async () => fixture() });
  const tools = registry.list({ persona: "copilot", workspace: "spare_parts" });
  const definition = tools.find((tool) => tool.key === "system.audit_controls_health");
  assert.ok(definition);
  assert.equal(definition.risk_level, 1);
  assert.deepEqual(definition.required_permissions, ["ai.use", "ai.read", "ai.audit.view"]);
  assert.deepEqual(definition.required_business_permissions, ["audit.view"]);
  assert.deepEqual(definition.allowed_workspaces, ["spare_parts", "mining", "equipment_hire"]);
  assert.match(definition.description, /no actor rows, usernames, IP addresses, raw details or metadata/i);

  const output = await registry.get(definition.key).handler({ input: {}, context: normalContext() });
  assert.equal(output.execution_authority, "read_only");
  assert.equal(output.evidence[0].classification, "confidential");
  assert.equal(output.evidence[0].metadata.aggregate_only, true);
  assert.equal(output.evidence[0].metadata.actor_rows_exposed, false);
  assert.equal(output.evidence[0].metadata.ip_addresses_exposed, false);
});

test("audit AI tool handler contains no direct SQL or database access", () => {
  assert.doesNotMatch(
    toolSource,
    /config\/db|mysql2|\bpool\s*\.|\bconnection\s*\.|\.query\s*\(|\bSELECT\s+|\bINSERT\s+INTO\b|\bUPDATE\s+|\bDELETE\s+FROM\b/i
  );
  assert.match(toolSource, /loadAuditSecurityIntelligence/);
  assert.match(toolSource, /execution_authority: "read_only"/);
});

test("Local audit layer selects scoped diagnostics and sends enterprise intent to server authority", async () => {
  const tool = {
    key: "system.audit_controls_health",
    title: "Audit, controls and security health",
    risk_level: 1,
  };
  const selected = shouldUseAuditSecurityTool({
    messages: [{ role: "user", content: "What security controls failed today?" }],
    tools: [tool],
    providerContext: { workspace_code: "spare_parts" },
  });
  assert.equal(selected.tool.key, tool.key);
  assert.match(selected.input.start_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(selected.input.start_date, selected.input.end_date);
  assert.equal(Object.hasOwn(selected.input, "group_mode"), false);

  const enterpriseInput = auditSecurityToolInput([
    { role: "user", content: "Show whole-system audit controls today" },
  ]);
  assert.equal(enterpriseInput.group_mode, true);
  assert.match(enterpriseInput.start_date, /^\d{4}-\d{2}-\d{2}$/);

  const provider = new LocalAuditSecurityGovernedProvider();
  const call = await provider.generate({
    messages: [{ role: "user", content: "What security controls failed today?" }],
    tools: [tool],
    provider_context: { workspace_code: "spare_parts" },
  });
  assert.equal(call.finish_reason, "local_read_only_tool");
  assert.equal(call.tool_calls[0].tool_key, tool.key);
});

test("Local audit synthesis is readable, privacy-minimized and avoids guilt verdicts", () => {
  const answer = composeAuditSecurityAnswer({
    citation: "E1",
    heading: "CHALIN audit, controls and security health",
    excerpt: JSON.stringify(fixture()),
  });
  assert.match(answer, /aggregate audited event/i);
  assert.match(answer, /Control activity by family/i);
  assert.match(answer, /Main evidence-backed control signals/i);
  assert.match(answer, /do not establish fraud|do not prove fraud/i);
  assert.match(answer, /no actor rows, usernames, IP addresses/i);
  assert.match(answer, /\[E1\]/);
  assert.doesNotMatch(answer, /fraud was committed|account was compromised/i);
});

test("Local audit product explanation preserves control and scope boundaries", () => {
  const answer = composeAuditSecurityProductAnswer();
  assert.match(answer, /control system, not just a log viewer/i);
  assert.match(answer, /secret-like metadata is redacted/i);
  assert.match(answer, /not proof of fraud, compromise or financial loss/i);
  assert.match(answer, /enterprise-wide audit scope is reserved for the original System Administrator/i);
});

test("provider registration keeps Audit wrapper as the Local top layer", () => {
  assert.match(providerRegistrationSource, /LocalAuditSecurityGovernedProvider/);
  assert.match(providerRegistrationSource, /new LocalAuditSecurityGovernedProvider\(\)/);
});
