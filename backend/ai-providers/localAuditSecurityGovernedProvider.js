"use strict";

const {
  LOCAL_MODEL_KEY,
  evidenceFromMessages,
  inferredDateInput,
  latestUserQuestion,
  parseEvidenceJson,
  recentUserContext,
} = require("./localGovernedProvider");
const {
  LocalCustomerAccountingGovernedProvider,
} = require("./localCustomerAccountingGovernedProvider");

const AUDIT_SECURITY_TOOL_KEY = "system.audit_controls_health";
const AUDIT_SECURITY_HEADING = /chalin audit, controls and security health/i;
const AUDIT_SECURITY_PRODUCT_PATTERN = /\b(?:audit trail|audit activity|audit sign[- ]?off|audit unlock|security event|security audit|access audit|backup restore|backup validation|operational approval|approval centre|approval center|shared control|risk[- ]?5|ai action governance|who changed|who approved)\b/i;
const AUDIT_SECURITY_CAUSAL_PATTERN = /\b(?:audit controls?|security controls?|security health|audit health|failed controls?|failed security|high[- ]severity|suspicious activity|access changes?|permission changes?|backup restore activity|restore activity|unlock requests?|sign[- ]?off backlog|approval failures?|ai action governance|risk[- ]?5 activity|what failed|what needs audit attention|control pressure)\b/i;
const ENTERPRISE_AUDIT_PATTERN = /\b(?:whole[- ]system|enterprise[- ]wide|group[- ]wide|company[- ]wide|across all (?:workspaces|businesses|operations))\b/i;

function clean(value, maximum = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function composeAuditSecurityProductAnswer() {
  return [
    "CHALIN audit/security is a control system, not just a log viewer. Important business and security events are written to a centralized audit trail with scope, action, outcome, severity and request/entity context where supported; secret-like metadata is redacted before storage.",
    "",
    "Control workflows then add stronger assurance around sensitive changes: audit sign-off preserves period review, unlock requests govern protected corrections, operational approvals hash the reviewed payload and prevent a different action from borrowing that approval, backup/restore uses separate permissions, and governed AI actions retain the Risk ladder, review, exact-confirmation and audit boundaries.",
    "",
    "A failed event, high severity, rejected sign-off, unlock request or approval failure is an investigation signal—not proof of fraud, compromise or financial loss. Normal audit visibility stays inside the authorized branch/site/Hire location; enterprise-wide audit scope is reserved for the original System Administrator.",
  ].join("\n");
}

function composeAuditSecurityAnswer(item) {
  const data = parseEvidenceJson(item?.excerpt);
  if (!data?.activity || !Array.isArray(data?.drivers)) return null;
  const scope = data.scope || {};
  const summary = data.activity.summary || {};
  const scopeText =
    scope.mode === "enterprise"
      ? " across the enterprise"
      : scope.workspace_code
        ? ` in ${clean(scope.workspace_code, 60).replace(/_/g, " ")}`
        : "";
  const period = scope.start_date && scope.end_date
    ? scope.start_date === scope.end_date
      ? ` on ${scope.start_date}`
      : ` from ${scope.start_date} to ${scope.end_date}`
    : "";
  const groupLines = (data.activity.groups || []).slice(0, 7).map((group) =>
    `- ${clean(group.key, 100).replace(/_/g, " ")}: ${Number(group.event_count || 0).toLocaleString("en-GH")} event(s), ${Number(group.failed_events || 0).toLocaleString("en-GH")} failed, ${Number(group.high_or_critical_events || 0).toLocaleString("en-GH")} high/critical. [${item.citation}]`
  );
  const driverLines = data.drivers.slice(0, 7).map((driver, index) => {
    const title = clean(driver.key || driver.category || "driver", 120).replace(/_/g, " ");
    const explanation = clean(driver.explanation || "", 850);
    return `${index + 1}. ${title}: ${explanation} [${item.citation}]`;
  });
  const signoffs = data.audit_signoffs || {};
  const unlocks = data.protected_unlocks_and_approvals || {};
  const aiActions = data.ai_action_governance || {};

  return [
    `The live CHALIN audit/control diagnosis${scopeText}${period} covers ${Number(summary.total_events || 0).toLocaleString("en-GH")} aggregate audited event(s): ${Number(summary.failed_events || 0).toLocaleString("en-GH")} non-success outcome(s), ${Number(summary.high_or_critical_events || 0).toLocaleString("en-GH")} high/critical event(s), and ${Number(summary.warning_events || 0).toLocaleString("en-GH")} warning/medium event(s). [${item.citation}]`,
    groupLines.length ? ["Control activity by family:", ...groupLines].join("\n") : "No categorized activity rows were available for this aggregate.",
    `Protected-control summary: ${Number(signoffs.total || 0)} audit sign-off record(s), ${Number(unlocks.total || 0)} unlock/approval request(s), ${Number(data.shared_control_evidence?.total || 0)} shared-control evidence event(s), and ${Number(aiActions.total || 0)} governed AI action proposal(s) in the selected scope/period. [${item.citation}]`,
    "Main evidence-backed control signals:",
    ...driverLines,
    `Interpretation boundary: ${clean(data?.certainty?.warning || "Audit/control aggregates prioritize investigation; they do not prove fraud, compromise or financial loss without underlying evidence.", 950)} [${item.citation}]`,
    `Privacy boundary: aggregate-only; no actor rows, usernames, IP addresses, raw audit details or raw metadata were exposed to this AI evidence. [${item.citation}]`,
  ].join("\n\n");
}

function offeredAuditSecurityTool(tools = []) {
  return (Array.isArray(tools) ? tools : []).find((tool) =>
    clean(tool?.key, 180).toLowerCase() === AUDIT_SECURITY_TOOL_KEY &&
    Number(tool?.risk_level || 0) === 1
  ) || null;
}

function auditSecurityToolInput(messages = [], providerContext = {}) {
  const question = recentUserContext(messages) || latestUserQuestion(messages);
  const input = { ...inferredDateInput(messages) };
  if (
    ENTERPRISE_AUDIT_PATTERN.test(question) &&
    providerContext?.authority?.original_system_administrator === true
  ) {
    input.group_mode = true;
  }
  return Object.freeze(input);
}

function shouldUseAuditSecurityTool({ messages = [], tools = [], providerContext = {} } = {}) {
  if (
    providerContext?.public_safe_social_turn === true ||
    providerContext?.public_safe_system_turn === true ||
    providerContext?.public_safe_general_turn === true ||
    evidenceFromMessages(messages).length > 0
  ) {
    return null;
  }
  const question = recentUserContext(messages) || latestUserQuestion(messages);
  if (!AUDIT_SECURITY_CAUSAL_PATTERN.test(question)) return null;
  const tool = offeredAuditSecurityTool(tools);
  if (!tool) return null;
  return Object.freeze({
    tool,
    input: auditSecurityToolInput(messages, providerContext),
  });
}

function localAuditSecurityToolCall(resolved = {}) {
  return Object.freeze({
    id: "local_system_audit_controls_health",
    tool_key: clean(resolved?.tool?.key, 180).toLowerCase(),
    input: Object.freeze({ ...(resolved?.input || {}) }),
  });
}

class LocalAuditSecurityGovernedProvider extends LocalCustomerAccountingGovernedProvider {
  async generate({ messages = [], tools = [], provider_context = {} } = {}) {
    if (provider_context?.public_safe_system_turn === true) {
      const question = latestUserQuestion(messages);
      if (AUDIT_SECURITY_PRODUCT_PATTERN.test(question)) {
        const text = composeAuditSecurityProductAnswer();
        return {
          text,
          model_key: LOCAL_MODEL_KEY,
          input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
          output_tokens: Math.ceil(text.length / 4),
          cost_micros: 0,
          finish_reason: "stop",
          tool_calls: [],
          provider_store_enabled: false,
        };
      }
    }

    const auditRead = shouldUseAuditSecurityTool({
      messages,
      tools,
      providerContext: provider_context,
    });
    if (auditRead) {
      const text = `Checking the approved ${clean(auditRead.tool.title || auditRead.tool.key, 180)} evidence before answering.`;
      return {
        text,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cost_micros: 0,
        finish_reason: "local_read_only_tool",
        tool_calls: [localAuditSecurityToolCall(auditRead)],
        provider_store_enabled: false,
      };
    }

    const evidence = evidenceFromMessages(messages);
    const auditEvidence = evidence.find((item) => AUDIT_SECURITY_HEADING.test(item.heading));
    const auditAnswer = composeAuditSecurityAnswer(auditEvidence);
    if (auditAnswer) {
      return {
        text: auditAnswer,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(auditAnswer.length / 4),
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    }

    return super.generate({ messages, tools, provider_context });
  }
}

module.exports = {
  AUDIT_SECURITY_CAUSAL_PATTERN,
  AUDIT_SECURITY_HEADING,
  AUDIT_SECURITY_PRODUCT_PATTERN,
  AUDIT_SECURITY_TOOL_KEY,
  ENTERPRISE_AUDIT_PATTERN,
  LocalAuditSecurityGovernedProvider,
  auditSecurityToolInput,
  composeAuditSecurityAnswer,
  composeAuditSecurityProductAnswer,
  localAuditSecurityToolCall,
  offeredAuditSecurityTool,
  shouldUseAuditSecurityTool,
};
