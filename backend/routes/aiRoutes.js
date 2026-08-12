"use strict";

const express = require("express");

const {
  requireAiPermission,
  requireAiPersona,
} = require("../middleware/aiPermissionMiddleware");
const {
  requireFeature,
  getFeatureSnapshot,
} = require("../services/featureFlagService");
const {
  getAiPermissionSnapshot,
  hasAiPermission,
  hasEveryAiPermission,
} = require("../security/aiPermissionCatalog");
const { hasEveryPermission } = require("../security/permissionCatalog");
const { hasEquipmentDivisionAccess } = require("../security/equipmentDivisionAccess");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { getAiProviderReadiness } = require("../services/aiProviderReadinessService");
const {
  getProviderControlSnapshot,
  updateProviderProfile,
} = require("../services/aiProviderPolicyService");
const {
  createContextualAiProvider,
} = require("../services/aiContextualProviderService");
const {
  isChalinProductKnowledgeTurn,
} = require("../services/aiProductKnowledgeService");
const { aiToolRegistry } = require("../services/aiToolRegistry");
const {
  CONVERSATION_ROLLOVER_CHARACTER_LIMIT,
  CONVERSATION_ROLLOVER_MESSAGE_LIMIT,
  archiveConversation,
  deleteConversation,
  getConversationDetails,
  listConversations,
  renameConversation,
  rolloverConversationIfNeeded,
} = require("../services/aiConversationService");
const {
  buildClarificationRequest,
  runClarificationTurn,
} = require("../services/aiClarificationService");
const {
  createFeedback,
  listFeedback,
} = require("../services/aiFeedbackService");
const { runAiConversationTurn } = require("../services/aiOrchestratorService");
const {
  processConversationalAction,
} = require("../services/aiConversationalActionService");
const { listUsageSummary } = require("../services/aiUsageService");
const { resolveAiScope } = require("../services/aiPermissionService");
const { registerFoundationAiTools } = require("../ai-tools/foundationTools");
const { registerSparePartsAiTools } = require("../ai-tools/sparePartsTools");
const {
  registerCustomerIdentityAiTools,
} = require("../ai-tools/customerIdentityTools");
const { registerMiningAiTools } = require("../ai-tools/miningTools");
const { registerHireAiTools } = require("../ai-tools/hireTools");
const {
  registerEquipmentFinanceAiTools,
} = require("../ai-tools/equipmentFinanceTools");
const {
  registerBuiltInAiProviders,
} = require("../ai-providers/registerAiProviders");
const aiKnowledgeRoutes = require("./aiKnowledgeRoutes");
const aiDocumentRoutes = require("./aiDocumentRoutes");
const aiActionRoutes = require("./aiActionRoutes");

registerBuiltInAiProviders();
registerFoundationAiTools();
registerSparePartsAiTools();
registerCustomerIdentityAiTools();
registerMiningAiTools();
registerHireAiTools();
registerEquipmentFinanceAiTools();

const router = express.Router();

function asyncHandler(handler) {
  return function wrappedAiHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function noStore(res) {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

function success(res, req, data, statusCode = 200) {
  noStore(res);
  return res.status(statusCode).json({
    status: "success",
    data,
    request_id: req.requestId || null,
  });
}

function canCrossWorkspace(user) {
  return (
    isOriginalSystemAdministrator(user) ||
    hasAiPermission(user, "ai.executive.use")
  );
}

function usageWorkspace(req) {
  if (canCrossWorkspace(req.user)) {
    return String(req.query.workspace_code || "").trim() || null;
  }
  return String(req.user?.workspace_code || "").trim() || null;
}

function hasToolDivisionAccess(user, tool) {
  return (
    !tool.required_equipment_division ||
    hasEquipmentDivisionAccess(user, tool.required_equipment_division)
  );
}

function requireOriginalAdministrator(req, res, next) {
  if (isOriginalSystemAdministrator(req.user)) return next();
  noStore(res);
  return res.status(403).json({
    status: "error",
    code: "AI_PROVIDER_POLICY_SYSTEM_ADMIN_REQUIRED",
    message: "Only the original System Administrator can change AI provider policy.",
    request_id: req.requestId || null,
  });
}

function conversationRolloverNotice(rollover) {
  if (!rollover?.rolled_over) return "";
  const title = String(rollover.title || "the continuation chat").trim();
  return `This conversation reached its reasoning limit, so I started a fresh continuation: “${title}”. I carried forward only a small continuity capsule to keep the discussion accurate. Any earlier live figures are historical context and will be re-checked before I treat them as current.`;
}

function withConversationRollover(result, rollover) {
  if (!rollover?.rolled_over) return result;
  const notice = conversationRolloverNotice(rollover);
  return Object.freeze({
    ...result,
    answer: notice ? `${notice}\n\n${result.answer || ""}`.trim() : result.answer,
    conversation_rollover: Object.freeze({
      occurred: true,
      reason: rollover.reason,
      previous_conversation_key: rollover.previous_conversation_key,
      conversation_key: rollover.conversation_key,
      title: rollover.title,
      notice,
      previous_message_count: rollover.usage?.message_count || 0,
      previous_character_count: rollover.usage?.character_count || 0,
    }),
  });
}

async function runPersonaChat({ req, persona }) {
  const contextKey = String(req.body.context_key || "").trim() || null;
  const message = String(req.body.message || "");
  const productKnowledgeTurn = isChalinProductKnowledgeTurn(message);
  const scope = resolveAiScope({ req, persona });
  const rollover = await rolloverConversationIfNeeded({
    conversationKey: req.body.conversation_key || null,
    userId: req.user.id,
    persona,
    scope,
  });
  const conversationKey = rollover.conversation_key || req.body.conversation_key || null;
  const clarification = buildClarificationRequest({ prompt: message });

  if (clarification) {
    const clarified = await runClarificationTurn({
      req,
      persona,
      scope,
      conversationKey,
      message,
      clarification,
    });
    return withConversationRollover(clarified, rollover);
  }

  let contextual = null;

  // Context buttons should supply live business evidence only when the question
  // actually needs operational context. Product/system/IT/marketing/advisory
  // questions must first reach the general reasoning route; otherwise a context
  // card can force a random live snapshot before the assistant understands the
  // question.
  if (contextKey && !productKnowledgeTurn) {
    contextual = await createContextualAiProvider({
      contextKey,
      req,
      persona,
    });
  }

  const baseResult = withConversationRollover(
    await runAiConversationTurn({
      req,
      persona,
      conversationKey,
      message,
      provider: contextual?.provider || null,
    }),
    rollover
  );

  const result = await processConversationalAction({
    req,
    persona,
    message,
    conversationKey: baseResult.conversation_key || conversationKey,
    assistantMessageKey: baseResult.message_key,
    result: baseResult,
  });

  if (!contextual) {
    return productKnowledgeTurn && contextKey
      ? Object.freeze({
          ...result,
          context: Object.freeze({
            key: contextKey,
            server_owned_preload: false,
            bypass_reason: "product_or_advisory_reasoning",
          }),
        })
      : result;
  }

  return Object.freeze({
    ...result,
    context: Object.freeze({
      key: contextual.profile.key,
      title: contextual.profile.title,
      purpose: contextual.profile.purpose,
      classification: contextual.profile.classification,
      provider_selected: contextual.selection.selected_provider,
      provider_effective: contextual.selection.effective_provider,
      provider_reason_code: contextual.selection.reason_code,
      full_context_active: contextual.selection.full_context_active === true,
      server_owned_preload: true,
    }),
  });
}

async function assertOwnedPersonaConversation(req, persona, messageLimit = 1) {
  const details = await getConversationDetails({
    conversationKey: req.params.conversationKey,
    userId: req.user.id,
    messageLimit,
  });
  if (details.conversation.persona !== persona) {
    const error = new Error("AI conversation not found.");
    error.name = "AiConversationError";
    error.code = "AI_CONVERSATION_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  return details;
}

function personaRouter(persona, featureKey) {
  const personaRoutes = express.Router();
  personaRoutes.use(requireFeature(featureKey), requireAiPersona(persona));

  personaRoutes.get(
    "/tools",
    requireAiPermission("ai.tools.view"),
    asyncHandler(async (req, res) => {
      const scope = resolveAiScope({ req, persona });
      const tools = aiToolRegistry
        .list({ persona, workspace: scope.workspace_code })
        .filter(
          (tool) =>
            hasEveryAiPermission(req.user, tool.required_permissions) &&
            hasEveryPermission(req.user, tool.required_business_permissions || []) &&
            hasToolDivisionAccess(req.user, tool)
        );
      return success(res, req, tools);
    })
  );

  personaRoutes.get(
    "/conversations",
    requireAiPermission("ai.conversations.view"),
    asyncHandler(async (req, res) =>
      success(
        res,
        req,
        await listConversations({
          userId: req.user.id,
          persona,
          workspaceCode: req.user.workspace_code,
          status: req.query.status || "active",
          limit: req.query.limit,
          offset: req.query.offset,
        })
      )
    )
  );

  personaRoutes.get(
    "/conversations/:conversationKey",
    requireAiPermission("ai.conversations.view"),
    asyncHandler(async (req, res) => {
      const details = await assertOwnedPersonaConversation(req, persona, 500);
      return success(res, req, details);
    })
  );

  personaRoutes.patch(
    "/conversations/:conversationKey",
    requireAiPermission("ai.conversations.manage"),
    asyncHandler(async (req, res) => {
      await assertOwnedPersonaConversation(req, persona, 1);
      await renameConversation({
        conversationKey: req.params.conversationKey,
        userId: req.user.id,
        title: req.body.title,
      });
      const details = await getConversationDetails({
        conversationKey: req.params.conversationKey,
        userId: req.user.id,
        messageLimit: 1,
      });
      return success(res, req, {
        updated: true,
        conversation: details.conversation,
      });
    })
  );

  personaRoutes.post(
    "/conversations/:conversationKey/archive",
    requireAiPermission("ai.conversations.manage"),
    asyncHandler(async (req, res) => {
      await assertOwnedPersonaConversation(req, persona, 1);
      await archiveConversation({
        conversationKey: req.params.conversationKey,
        userId: req.user.id,
      });
      return success(res, req, { archived: true });
    })
  );

  personaRoutes.delete(
    "/conversations/:conversationKey",
    requireAiPermission("ai.conversations.manage"),
    asyncHandler(async (req, res) => {
      await assertOwnedPersonaConversation(req, persona, 1);
      await deleteConversation({
        conversationKey: req.params.conversationKey,
        userId: req.user.id,
      });
      return success(res, req, { deleted: true });
    })
  );

  personaRoutes.post(
    "/chat",
    requireAiPermission("ai.use", "ai.conversations.manage"),
    asyncHandler(async (req, res) =>
      success(res, req, await runPersonaChat({ req, persona }))
    )
  );

  return personaRoutes;
}

router.get(
  "/status",
  requireAiPermission("ai.use"),
  asyncHandler(async (req, res) => {
    const flags = getFeatureSnapshot();
    const providerControl = await getProviderControlSnapshot();
    const copilotSelection = providerControl?.profiles?.copilot?.selection || {};
    const provider = {
      ...getAiProviderReadiness(
        process.env,
        copilotSelection.effective_provider || copilotSelection.selected_provider || null
      ),
      model_key: copilotSelection.effective_model || null,
      selected_key: copilotSelection.selected_provider || null,
      selected_model: copilotSelection.selected_model || null,
      policy_reason_code: copilotSelection.reason_code || null,
      full_context_requested: copilotSelection.full_context_requested === true,
      full_context_active: copilotSelection.full_context_active === true,
    };
    return success(res, req, {
      flags,
      provider,
      provider_control: {
        ...providerControl,
        can_manage: isOriginalSystemAdministrator(req.user),
      },
      permissions: getAiPermissionSnapshot(req.user),
      conversation_limits: {
        message_limit: CONVERSATION_ROLLOVER_MESSAGE_LIMIT,
        character_limit: CONVERSATION_ROLLOVER_CHARACTER_LIMIT,
        rollover_mode: "automatic_continuation",
      },
      execution_authority: flags.aiActions
        ? "reviewed_risk_aware_actions"
        : "read_recommend_prepare_only",
      ai_actions_enabled: flags.aiActions === true,
    });
  })
);

router.get(
  "/provider-control",
  requireAiPermission("ai.use"),
  asyncHandler(async (req, res) =>
    success(res, req, {
      ...(await getProviderControlSnapshot()),
      can_manage: isOriginalSystemAdministrator(req.user),
    })
  )
);

router.put(
  "/provider-control/:persona",
  requireAiPermission("ai.use"),
  requireOriginalAdministrator,
  asyncHandler(async (req, res) => {
    const profile = await updateProviderProfile({
      persona: req.params.persona,
      providerKey: req.body.provider_key,
      modelKey: req.body.model_key,
      fullContextAccess: req.body.full_context_access === true,
      userId: req.user.id,
    });
    return success(res, req, {
      updated: true,
      profile: {
        profile_key: profile.profile_key,
        provider_key: profile.provider_key,
        model_key: profile.model_key,
        profile_status: profile.profile_status,
        full_context_requested:
          profile.configuration?.system_admin_full_context === true,
      },
      control: await getProviderControlSnapshot(),
    });
  })
);

router.use("/copilot", personaRouter("copilot", "chalinCopilot"));
router.use("/executive", personaRouter("executive", "chalinExecutive"));
router.use("/knowledge", aiKnowledgeRoutes);
router.use("/documents", aiDocumentRoutes);
router.use("/actions", aiActionRoutes);

router.post(
  "/feedback",
  requireAiPermission("ai.feedback.create"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createFeedback({
        conversationKey: req.body.conversation_key,
        messageKey: req.body.message_key,
        rating: req.body.rating,
        comment: req.body.comment,
        correction: req.body.correction,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.get(
  "/feedback",
  requireAiPermission("ai.audit.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listFeedback({
        status: req.query.status,
        rating: req.query.rating,
        limit: req.query.limit,
      })
    )
  )
);

router.get(
  "/usage",
  requireAiPermission("ai.usage.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listUsageSummary({
        workspaceCode: usageWorkspace(req),
        userId: req.query.mine === "true" ? req.user.id : null,
        days: req.query.days,
      })
    )
  )
);

router.use((error, req, res, next) => {
  const code = String(error?.code || "");
  if (
    !code.startsWith("AI_") &&
    !String(error?.name || "").startsWith("Ai")
  ) {
    return next(error);
  }
  noStore(res);
  return res.status(Number(error.statusCode) || 400).json({
    status: "error",
    code: code || "AI_REQUEST_FAILED",
    message:
      error.message ||
      "CHALIN ONE intelligence request failed safely.",
    details: error.details || [],
    request_id: req.requestId || null,
  });
});

module.exports = router;