"use strict";

const {
  AI_PERSONAS,
  getAiPermissionSnapshot,
  hasEveryAiPermission,
  normalizeAiPersona,
} = require("../security/aiPermissionCatalog");

function aiPermissionDenied(res, req, permissions, code = "AI_PERMISSION_DENIED") {
  return res.status(403).json({
    status: "error",
    code,
    message: "You do not have permission to use this CHALIN ONE intelligence capability.",
    required_permissions: permissions,
    request_id: req.requestId || null,
  });
}

function requireAiPermission(...permissions) {
  const required = permissions.flat().filter(Boolean);

  return function aiPermissionMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        status: "error",
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication required.",
        request_id: req.requestId || null,
      });
    }

    if (required.length === 0 || hasEveryAiPermission(req.user, required)) {
      req.aiPermissionSnapshot = getAiPermissionSnapshot(req.user);
      return next();
    }

    return aiPermissionDenied(res, req, required);
  };
}

function personaPermission(persona) {
  if (persona === AI_PERSONAS.COPILOT) return "ai.use";
  if (persona === AI_PERSONAS.EXECUTIVE) return "ai.executive.use";
  return null;
}

function requireAiPersona(personaValue) {
  const persona = normalizeAiPersona(personaValue);
  if (!persona || persona === AI_PERSONAS.GUIDE) {
    throw new Error("Staff AI persona middleware requires Copilot or Executive.");
  }
  const permission = personaPermission(persona);

  return function aiPersonaMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        status: "error",
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication required.",
        request_id: req.requestId || null,
      });
    }

    if (!hasEveryAiPermission(req.user, [permission])) {
      return aiPermissionDenied(
        res,
        req,
        [permission],
        "AI_PERSONA_ACCESS_DENIED"
      );
    }

    req.aiPersona = persona;
    req.aiPermissionSnapshot = getAiPermissionSnapshot(req.user);
    return next();
  };
}

module.exports = {
  aiPermissionDenied,
  personaPermission,
  requireAiPermission,
  requireAiPersona,
};
