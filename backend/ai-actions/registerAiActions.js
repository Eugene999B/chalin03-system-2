"use strict";

const { aiActionRegistry } = require("../services/aiActionRegistry");

const ALL_OPERATIONAL_WORKSPACES = Object.freeze([
  "spare_parts",
  "mining",
  "equipment_hire",
]);

function registerIfMissing(definition) {
  return aiActionRegistry.get(definition.key) || aiActionRegistry.register(definition);
}

function registerBuiltInAiActions() {
  registerIfMissing({
    key: "intelligence.conversation.rename",
    version: "1",
    title: "Rename intelligence conversation",
    description:
      "Rename an owned CHALIN Intelligence conversation without changing business records.",
    risk_level: 3,
    personas: ["copilot", "executive"],
    allowed_workspaces: ALL_OPERATIONAL_WORKSPACES,
    required_permissions: ["ai.conversations.manage"],
    required_business_permissions: [],
    evidence_required: false,
    review_mode: "auto",
    confirmation_mode: "none",
    executor_key: "intelligence.conversation.rename",
    input_schema: {
      type: "object",
      required: ["conversation_key", "title"],
      properties: {
        conversation_key: { type: "string", maxLength: 100 },
        title: { type: "string", minLength: 1, maxLength: 180 },
      },
      additionalProperties: false,
    },
  });

  registerIfMissing({
    key: "communications.sms.send",
    version: "1",
    title: "Send an outbound SMS",
    description:
      "Send one deliberate outbound SMS to a validated Ghana phone number. The action is proposal-first and requires explicit confirmation before any provider submission.",
    risk_level: 3,
    personas: ["copilot", "executive"],
    allowed_workspaces: ALL_OPERATIONAL_WORKSPACES,
    required_permissions: ["ai.use"],
    required_business_permissions: ["sms.manage"],
    evidence_required: false,
    review_mode: "auto",
    confirmation_mode: "explicit",
    executor_key: "communications.sms.send",
    maximum_expiry_hours: 4,
    input_schema: {
      type: "object",
      required: ["to", "message"],
      properties: {
        to: { type: "string", minLength: 9, maxLength: 30 },
        message: { type: "string", minLength: 1, maxLength: 480 },
        recipient_label: { type: ["string", "null"], maxLength: 180 },
      },
      additionalProperties: false,
    },
  });

  registerIfMissing({
    key: "spare_parts.debt_reminder.send",
    version: "1",
    title: "Send a customer debt-reminder SMS",
    description:
      "Send one governed debt reminder using the live customer debt record and saved Debt Reminder Settings. The business service rechecks active debt, phone validity, provider readiness, minimum spacing and 7/30-day anti-spam limits immediately before sending.",
    risk_level: 4,
    personas: ["copilot", "executive"],
    allowed_workspaces: ["spare_parts"],
    required_permissions: ["ai.read_sensitive"],
    required_business_permissions: ["installments.remind", "sms.manage"],
    evidence_required: false,
    review_mode: "independent",
    confirmation_mode: "explicit",
    executor_key: "spare_parts.debt_reminder.send",
    maximum_expiry_hours: 4,
    input_schema: {
      type: "object",
      required: ["branch_id", "customer_id"],
      properties: {
        branch_id: { type: "integer", minimum: 1 },
        customer_id: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
  });

  registerIfMissing({
    key: "system.user.deactivate",
    version: "1",
    title: "Securely deactivate user",
    description:
      "Risk-5 secure offboarding: deactivate an account while preserving identity/history and revoking workspace access, permission overrides and active sessions.",
    risk_level: 5,
    personas: ["copilot", "executive"],
    allowed_workspaces: ALL_OPERATIONAL_WORKSPACES,
    required_permissions: ["ai.read_sensitive"],
    required_business_permissions: ["users.manage", "security.admin"],
    evidence_required: true,
    review_mode: "system_admin",
    confirmation_mode: "risk5_exact",
    system_admin_only: true,
    executor_key: "system.user.deactivate",
    maximum_expiry_hours: 4,
    input_schema: {
      type: "object",
      required: ["target_user_id", "reason"],
      properties: {
        target_user_id: { type: "integer", minimum: 1 },
        reason: { type: "string", minLength: 1, maxLength: 500 },
      },
      additionalProperties: false,
    },
  });

  return aiActionRegistry.list();
}

module.exports = {
  ALL_OPERATIONAL_WORKSPACES,
  registerBuiltInAiActions,
  registerIfMissing,
};