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
const { aiToolRegistry } = require("../services/aiToolRegistry");
const {
  archiveConversation,
  getConversationDetails,
  listConversations,
  renameConversation,
} = require("../services/aiConversationService");
const {
  createFeedback,
  listFeedback,
} = require("../services/aiFeedbackService");
const { runAiConversationTurn } = require("../services/aiOrchestratorService");
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
      const details = await getConversationDetails({
        conversationKey: req.params.conversationKey,
        userId: req.user.id,
      });
      if (details.conversation.persona !== persona) {
        return res.status(404).json({
          status: "error",
          code: "AI_CONVERSATION_NOT_FOUND",
          message: "AI conversation not found.",
          request_id: req.requestId || null,
        });
      }
      return success(res, req, details);
    })
  );

  personaRoutes.patch(
    "/conversations/:conversationKey",
    requireAiPermission("ai.conversations.manage"),
    asyncHandler(async (req, res) => {
      const details = await getConversationDetails({
        conversationKey: req.params.conversationKey,
        userId: req.user.id,
        messageLimit: 1,
      });
      if (details.conversation.persona !== persona) {
        return res.status(404).json({
          status: "error",
          code: "AI_CONVERSATION_NOT_FOUND",
          message: "AI conversation not found.",
          request_id: req.requestId || null,
        });
      }
      await renameConversation({
        conversationKey: req.params.conversationKey,
        userId: req.user.id,
        title: req.body.title,
      });
      return success(res, req, { updated: true });
    })
  );

  personaRoutes.post(
    "/conversations/:conversationKey/archive",
    requireAiPermission("ai.conversations.manage"),
    asyncHandler(async (req, res) => {
      const details = await getConversationDetails({
        conversationKey: req.params.conversationKey,
        userId: req.user.id,
        messageLimit: 1,
      });
      if (details.conversation.persona !== persona) {
        return res.status(404).json({
          status: "error",
          code: "AI_CONVERSATION_NOT_FOUND",
          message: "AI conversation not found.",
          request_id: req.requestId || null,
        });
      }
      await archiveConversation({
        conversationKey: req.params.conversationKey,
        userId: req.user.id,
      });
      return success(res, req, { archived: true });
    })
  );

  personaRoutes.post(
    "/chat",
    requireAiPermission("ai.use", "ai.conversations.manage"),
    asyncHandler(async (req, res) =>
      success(
        res,
        req,
        await runAiConversationTurn({
          req,
          persona,
          conversationKey: req.body.conversation_key || null,
          message: req.body.message,
        })
      )
    )
  );

  return personaRoutes;
}

router.get(
  "/status",
  requireAiPermission("ai.use"),
  asyncHandler(async (req, res) => {
    const flags = getFeatureSnapshot();
    const provider = getAiProviderReadiness(process.env);
    const providerControl = await getProviderControlSnapshot();
    return success(res, req, {
      flags,
      provider,
      provider_control: {
        ...providerControl,
        can_manage: isOriginalSystemAdministrator(req.user),
      },
      permissions: getAiPermissionSnapshot(req.user),
      execution_authority: flags.aiActions
        ? "approved_low_risk_actions_only"
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
      userId: req.user.id,
    });
    return success(res, req, {
      updated: true,
      profile,
      control: await getProviderControlSnapshot(),
    });
  })
);

router.use("/copilot", personaRouter("copilot", "chalinCopilot"));
router.use("/executive", personaRouter("executive", "chalinExecutive"));
router.use("/knowledge", aiKnowledgeRoutes);

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
