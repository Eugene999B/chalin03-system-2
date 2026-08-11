"use strict";

const fs = require("node:fs");
const path = require("node:path");

const AUDIT_SECURITY_SOURCE_BASE_COMMIT =
  "a5bf2e60e27f87e28b028bbaf193146e5eeb76ea";

const AUDIT_SECURITY_RUNTIME_FILES = Object.freeze([
  "services/auditTrailService.js",
  "routes/activityRoutes.js",
  "routes/auditSignoffRoutes.js",
  "routes/auditUnlockRequestRoutes.js",
  "services/operationalApprovalService.js",
  "services/sharedControlService.js",
  "services/aiActionProposalService.js",
]);

const AUDIT_SECURITY_EXPERT_PACK = Object.freeze({
  key: "audit_controls_security",
  title: "Audit, Controls, Security & Approval Intelligence",
  version: "2026-08-11-source-derived-v1",
  authority: "verified_current_source_contract",
  reviewed_source_lineage:
    "chalin-one audit trail, activity review, protected corrections, shared controls and governed AI actions",
  verified_release_commit: AUDIT_SECURITY_SOURCE_BASE_COMMIT,
  source_paths: Object.freeze([
    "backend/services/auditTrailService.js",
    "backend/routes/activityRoutes.js",
    "backend/routes/auditSignoffRoutes.js",
    "backend/routes/auditUnlockRequestRoutes.js",
    "backend/services/operationalApprovalService.js",
    "backend/services/sharedControlService.js",
    "backend/services/aiActionProposalService.js",
    "backend/security/permissionCatalog.js",
  ]),
  facts: Object.freeze([
    Object.freeze({
      key: "central_audit_evidence",
      statement:
        "CHALIN records important business and security events in the central activity audit trail with actor/context, action, outcome, severity and optional entity/request evidence when the installed schema supports those columns. Audit metadata is sanitized before storage so secret-like fields such as passwords, tokens, API keys and database credentials are redacted.",
      source_basis: Object.freeze([
        "auditTrailService.writeAuditEvent",
        "auditTrailService.sanitizeMetadata",
      ]),
    }),
    Object.freeze({
      key: "audit_visibility_is_scoped",
      statement:
        "Audit activity visibility is permission- and workspace-scoped. The original System Administrator can review enterprise-wide activity, while other users are constrained to authorized Spare Parts branches, Mining sites or Equipment Hire locations according to their active workspace and access records.",
      source_basis: Object.freeze([
        "activityRoutes.loadUserScope",
        "permissionCatalog audit.view",
        "sharedControlService.evidenceScopeFilter",
      ]),
    }),
    Object.freeze({
      key: "activity_categories_are_control_views",
      statement:
        "The activity history classifies events into authentication, sales, products/inventory, daily closing, debts/payments, expenses/purchases, returns, users/access, audit/security, backup/export, Mining, Equipment Hire and other-system categories. Categories organize investigation; a category count is not itself evidence that wrongdoing occurred.",
      source_basis: Object.freeze([
        "activityRoutes.ACTIVITY_CATEGORIES",
        "activityRoutes.activityCategorySql",
      ]),
    }),
    Object.freeze({
      key: "audit_signoff_is_period_control",
      statement:
        "Audit sign-off is a protected period-review workflow with draft, reviewed, approved or rejected states and checklist coverage across sales, expenses, debts, stock, warnings, reports, purchases, returns, transfers, SMS, stock ledger, backup and maintenance. An approved sign-off is preserved review evidence; it is not permission to silently alter historical source records.",
      source_basis: Object.freeze([
        "auditSignoffRoutes AUDIT_SCHEMA_REQUIREMENTS",
        "auditSignoffRoutes period-status controls",
      ]),
    }),
    Object.freeze({
      key: "unlock_requests_are_exception_governance",
      statement:
        "Protected audit unlock requests exist for corrections or exceptional actions across sales, debts, expenses, purchases, returns, stock, transfers, stock ledger, SMS, backup/restore, maintenance, reports/exports and audit sign-off/re-approval. Request/review history is evidence of an exception process, not automatic proof that the underlying record was wrong or malicious.",
      source_basis: Object.freeze([
        "auditUnlockRequestRoutes.ALLOWED_REQUEST_AREAS",
        "auditUnlockRequestRoutes review workflow",
      ]),
    }),
    Object.freeze({
      key: "operational_approval_integrity",
      statement:
        "Protected operational approvals for return/refund, sale edit and sale void use canonical payload hashing, duplicate-pending-request prevention, expiry, review/execution state and audit events. Approval evidence does not authorize a different payload than the one reviewed.",
      source_basis: Object.freeze([
        "operationalApprovalService.hashPayload",
        "operationalApprovalService.createOperationalRequest",
        "operationalApprovalService audit events",
      ]),
    }),
    Object.freeze({
      key: "backup_restore_is_high_control",
      statement:
        "Backup download, validation and restore are separate business permissions, and backup/restore/export activity is treated as an audit control category. A restore or clear-data event is operationally significant and should be reviewed with its authorization and outcome evidence; the event alone is not proof of data loss or compromise.",
      source_basis: Object.freeze([
        "permissionCatalog backup.download/backup.validate/backup.restore",
        "activityRoutes backup_export category",
        "auditUnlockRequestRoutes backup_restore/maintenance areas",
      ]),
    }),
    Object.freeze({
      key: "shared_control_evidence",
      statement:
        "CHALIN separately records shared-control evidence for governed views, exports and documents with workspace/context, control area, action type and sanitized metadata. Group-wide shared-control evidence is reserved for the original System Administrator; normal users remain workspace/context scoped.",
      source_basis: Object.freeze([
        "sharedControlService.writeSharedControlEvidence",
        "sharedControlService.evidenceScopeFilter",
      ]),
    }),
    Object.freeze({
      key: "ai_action_governance_is_auditable",
      statement:
        "Governed AI actions use registered definitions, risk ceilings, business permissions, payload hashing, evidence, review modes, exact confirmation where required, status transitions and audit events. Risk-5 actions remain protected System Administrator actions; the AI model is not given direct database-write authority.",
      source_basis: Object.freeze([
        "aiActionProposalService.assertDefinitionAuthority",
        "aiActionProposalService.createActionProposal",
        "aiActionProposalService payload integrity checks",
      ]),
    }),
    Object.freeze({
      key: "failure_or_high_severity_is_signal_not_verdict",
      statement:
        "A failed outcome, high-severity event, unlock request, rejected sign-off or approval failure is an investigation signal. Aggregate control evidence cannot by itself establish fraud, malicious intent, financial loss or security compromise; the underlying event, actor authorization, source record and surrounding timeline must be reviewed.",
      source_basis: Object.freeze([
        "activityRoutes outcome/severity fields",
        "auditSignoffRoutes period statuses",
        "auditUnlockRequestRoutes statuses",
      ]),
    }),
  ]),
  workflows: Object.freeze([
    Object.freeze({
      key: "event_to_investigation",
      path: "Business/Security Event -> Sanitized Audit Evidence -> Scope/Category/Outcome Review -> Source Record Investigation",
      interpretation:
        "Use audit events to locate what changed and where to investigate. Do not treat an event count or severity label as a guilt/fraud verdict.",
    }),
    Object.freeze({
      key: "period_assurance",
      path: "Operational Records -> Audit Review Checklist -> Draft/Reviewed/Approved or Rejected Sign-Off -> Preserved Period Evidence",
      interpretation:
        "Sign-off records management review of a period; later correction remains a separately governed exception rather than silent history rewriting.",
    }),
    Object.freeze({
      key: "protected_correction",
      path: "Locked/Protected Record -> Unlock/Approval Request -> Independent Review -> Exact Approved Action -> Audit Evidence",
      interpretation:
        "The reviewed request and payload define the authorized exception. Approval for one action must not be generalized to another record or payload.",
    }),
    Object.freeze({
      key: "backup_recovery_control",
      path: "Backup -> Validation -> Protected Restore/Recovery -> Verification -> Audit Evidence",
      interpretation:
        "Backup existence, validation and restore are distinct controls. A successful backup is not proof of a successful restore until recovery/verification evidence exists.",
    }),
    Object.freeze({
      key: "ai_action_control",
      path: "AI Proposal -> Risk/Permission Check -> Review -> Exact Confirmation when required -> Named Executor -> Receipt/Audit",
      interpretation:
        "AI reasoning may prepare a governed action, but only registered server-side executors can perform approved changes under the risk ladder and permission model.",
    }),
  ]),
  diagnostic_questions: Object.freeze([
    "Are failed or high-severity audit events increasing in the selected period?",
    "Are authentication/security failures concentrated enough to require account or access review?",
    "Were user/role/permission changes made, and do they align with authorized access administration?",
    "Are protected unlock/approval requests pending, rejected or repeatedly failing?",
    "Are audit sign-offs still draft/rejected or missing important checklist review?",
    "Did backup, restore, export or maintenance events occur, and is there matching authorization/outcome evidence?",
    "Are governed AI action proposals failing, pending review or reaching high risk levels?",
    "Is the user treating an audit/security signal as proof of fraud or loss without the underlying evidence?",
    "Does the requested audit view stay inside the login's authorized branch/site/Hire-location scope?",
  ]),
  reasoning_rules: Object.freeze([
    "Never expose secret-like audit metadata; the audit service redacts it and AI diagnostics should remain aggregate-only.",
    "Treat failed/high-severity events, unlocks and rejected controls as investigation signals, not proof of fraud, malicious intent or financial loss.",
    "Keep audit visibility inside the authenticated workspace/context unless the original System Administrator explicitly uses authorized enterprise scope.",
    "Treat backup creation, validation and restore verification as separate controls.",
    "Treat an approved sign-off as preserved review evidence, not permission to rewrite source history silently.",
    "Treat an operational approval as authorization only for the reviewed payload/action.",
    "Risk-5 AI actions remain original-System-Administrator governed; audit reasoning never bypasses action confirmation or business permissions.",
    "For current control status, use governed live audit diagnostics rather than this static expert pack.",
  ]),
  boundaries: Object.freeze({
    audit_metadata_secrets_are_redacted: true,
    normal_audit_visibility_is_workspace_context_scoped: true,
    original_system_administrator_may_use_enterprise_audit_scope: true,
    failure_or_high_severity_is_not_proof_of_wrongdoing: true,
    signoff_does_not_authorize_silent_history_rewrite: true,
    unlock_or_approval_is_payload_specific: true,
    backup_validation_and_restore_are_distinct_controls: true,
    ai_actions_remain_governed_by_risk_and_permissions: true,
    expert_pack_is_product_knowledge_not_live_audit_data: true,
  }),
});

function runtimePath(relative) {
  return path.resolve(__dirname, "..", relative);
}

function auditSecurityRuntimeAvailability() {
  const files = AUDIT_SECURITY_RUNTIME_FILES.map((relative) =>
    Object.freeze({
      path: `backend/${relative}`,
      present: fs.existsSync(runtimePath(relative)),
    })
  );
  const presentCount = files.filter((item) => item.present).length;
  const total = files.length;
  return Object.freeze({
    status:
      presentCount === total
        ? "available_in_current_source_tree"
        : presentCount === 0
          ? "not_present_in_current_source_tree"
          : "partially_present_in_current_source_tree",
    present_file_count: presentCount,
    expected_file_count: total,
    files: Object.freeze(files),
    warning:
      presentCount === total
        ? null
        : "The verified Audit/Controls/Security expert contract is not fully present in this source tree. Explain only the verified design and do not claim missing live diagnostics are executable here.",
  });
}

function isAuditSecurityExpertPrompt(value) {
  const text = String(value ?? "").trim().slice(0, 16000);
  if (!text) return false;
  if (/\b(?:audit trail|audit activity|audit sign[- ]?off|audit unlock|security event|security audit|access audit|backup restore|backup validation|operational approval|approval centre|approval center|shared control|risk[- ]?5|ai action governance|who changed|who approved)\b/i.test(text)) {
    return true;
  }
  const auditAnchor = /\b(?:audit|security|control|approval|permission|access|backup|restore|unlock|signoff|sign-off)\b/i.test(text);
  const auditTopic = /\b(?:activity|event|history|failed|failure|severity|change|changed|review|approve|approved|reject|rejected|export|evidence|fraud|suspicious|anomaly|risk)\b/i.test(text);
  return auditAnchor && auditTopic;
}

function getAuditSecurityExpertPack({ includeAvailability = true } = {}) {
  return Object.freeze({
    ...AUDIT_SECURITY_EXPERT_PACK,
    deployment_availability: includeAvailability
      ? auditSecurityRuntimeAvailability()
      : null,
  });
}

module.exports = {
  AUDIT_SECURITY_EXPERT_PACK,
  AUDIT_SECURITY_RUNTIME_FILES,
  AUDIT_SECURITY_SOURCE_BASE_COMMIT,
  auditSecurityRuntimeAvailability,
  getAuditSecurityExpertPack,
  isAuditSecurityExpertPrompt,
  runtimePath,
};
