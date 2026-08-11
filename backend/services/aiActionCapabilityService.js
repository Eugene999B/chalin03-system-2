"use strict";

const { isFeatureEnabled } = require("./featureFlagService");
const { resolveAiCapabilityProfile } = require("./aiCapabilityService");
const { aiActionRegistry } = require("./aiActionRegistry");
const { assertDefinitionAuthority } = require("./aiActionProposalService");

function clean(value, maximum = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function phaseAllowed({ definition, user, persona, workspaceCode, phase }) {
  try {
    assertDefinitionAuthority({
      definition,
      user,
      persona,
      workspaceCode,
      phase,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveActionCapabilities({
  user,
  persona = "copilot",
  scope = {},
  registry = aiActionRegistry,
} = {}) {
  const workspaceCode = scope?.workspace_code || user?.workspace_code || null;
  const authority = resolveAiCapabilityProfile({ user, scope });
  const actionFeatureEnabled = isFeatureEnabled("aiActions");

  const actions = registry
    .list({ persona, workspace: workspaceCode })
    .map((definition) => {
      const canPropose = phaseAllowed({
        definition,
        user,
        persona,
        workspaceCode,
        phase: "propose",
      });
      const canReview = phaseAllowed({
        definition,
        user,
        persona,
        workspaceCode,
        phase: "review",
      });
      const canExecute = phaseAllowed({
        definition,
        user,
        persona,
        workspaceCode,
        phase: "execute",
      });
      return Object.freeze({
        key: definition.key,
        title: definition.title,
        description: definition.description,
        risk_level: definition.risk_level,
        review_mode: definition.review_mode,
        confirmation_mode: definition.confirmation_mode,
        system_admin_only: definition.system_admin_only,
        execution_available: definition.execution_available === true,
        can_propose: canPropose,
        can_review: canReview,
        can_execute: canExecute,
      });
    })
    .filter(
      (action) => action.can_propose || action.can_review || action.can_execute
    );

  return Object.freeze({
    feature_enabled: actionFeatureEnabled,
    authority,
    action_count: actions.length,
    actions: Object.freeze(actions),
  });
}

function capabilityAnswer(snapshot = {}) {
  const authority = snapshot.authority || {};
  const actions = Array.isArray(snapshot.actions) ? snapshot.actions : [];
  const risk = Number(authority.risk_ceiling || 1);
  const scopeText =
    authority.scope_mode === "enterprise_superuser"
      ? "enterprise-wide"
      : authority.active_workspace
        ? `${authority.active_workspace} workspace`
        : "the current authorized workspace";

  const lines = [
    `Your current CHALIN login gives me a Risk Level ${risk} ceiling with ${scopeText} authority.`,
  ];

  if (authority.original_system_administrator) {
    lines.push(
      "You are the protected System Administrator, so I can reason across registered CHALIN business modules and use Risk Levels 1–5 where a governed capability has been implemented."
    );
  } else {
    lines.push(
      "I remain limited by this login's AI permissions, ordinary business permissions, workspace/location scope and each action's risk level."
    );
  }

  if (!snapshot.feature_enabled) {
    lines.push(
      "Governed write execution is currently disabled by the AI Actions feature flag, so I can still read, analyze, generate documents and explain/prepare supported work, but I will not claim a business write executed."
    );
  }

  if (actions.length) {
    lines.push("Implemented governed actions available to this login:");
    for (const action of actions) {
      const verbs = [
        action.can_propose ? "propose" : null,
        action.can_review ? "review" : null,
        action.can_execute ? "execute" : null,
      ].filter(Boolean);
      lines.push(
        `- ${action.title} — Risk ${action.risk_level}; ${verbs.join(" / ") || "view only"}${action.system_admin_only ? "; System Administrator only" : ""}.`
      );
    }
  } else {
    lines.push(
      "No governed write action is currently exposed to this login in the active workspace. Read/analyze/document capabilities may still be available."
    );
  }

  lines.push(
    "If a capability is not implemented yet, I should tell you that clearly rather than pretending I performed it."
  );
  return lines.join("\n");
}

function isCapabilityQuestion(message) {
  const text = clean(message, 2000).toLowerCase();
  if (!text) return false;
  return /^(?:what can you do|what can i do with you|what are you able to do|what are you allowed to do|show (?:me )?(?:my|your) capabilities|show (?:me )?(?:my|your) actions|what actions can you (?:do|perform|execute)|what can chalin (?:do|perform) for me)[?.!\s]*$/i.test(
    text
  );
}

module.exports = {
  capabilityAnswer,
  clean,
  isCapabilityQuestion,
  phaseAllowed,
  resolveActionCapabilities,
};
