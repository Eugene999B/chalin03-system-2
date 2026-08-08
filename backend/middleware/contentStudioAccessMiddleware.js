"use strict";

const {
  hydrateContentStudioSession,
  scopeForContentStudioRequest,
} = require("../services/contentStudioAccessService");
const {
  isOriginalSystemAdministrator,
} = require("../security/systemAdminIdentity");

async function requireContentStudioSession(req, res, next) {
  try {
    const hydrated = await hydrateContentStudioSession(req.user);
    if (!hydrated.ok) {
      return res.status(403).json({
        status: "error",
        code: hydrated.code || "CONTENT_STUDIO_ACCESS_DENIED",
        message: hydrated.message || "Content Studio access is denied.",
        request_id: req.requestId || null,
      });
    }

    req.user = hydrated.user;
    req.contentStudioAccess = hydrated;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireContentStudioRouteScope(req, res, next) {
  if (isOriginalSystemAdministrator(req.user)) return next();

  const requiredScope = scopeForContentStudioRequest(req);
  const scopes = new Set(req.user?.content_studio_scopes || []);

  if (scopes.has(requiredScope)) return next();

  return res.status(403).json({
    status: "error",
    code: "CONTENT_STUDIO_SCOPE_DENIED",
    message: "Your Content Studio role cannot open this section.",
    required_scope: requiredScope,
    request_id: req.requestId || null,
  });
}

function requireContentStudioOwner(req, res, next) {
  if (isOriginalSystemAdministrator(req.user)) return next();

  return res.status(403).json({
    status: "error",
    code: "CONTENT_STUDIO_OWNER_REQUIRED",
    message: "Only the original System Administrator can manage Content Studio accounts.",
    request_id: req.requestId || null,
  });
}

module.exports = {
  requireContentStudioOwner,
  requireContentStudioRouteScope,
  requireContentStudioSession,
};
