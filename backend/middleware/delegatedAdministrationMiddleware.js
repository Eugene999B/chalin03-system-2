const { pool } = require("../config/db");
const {
  isOriginalSystemAdministrator,
} = require("../security/systemAdminIdentity");
const {
  hasDelegatedCapability,
  loadUser,
} = require("../services/delegatedAdministrationService");

function capabilityLabel(capabilityCode) {
  return String(capabilityCode || "delegated authority")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function requireDelegatedCapability(capabilityCode) {
  return async function delegatedCapabilityMiddleware(req, res, next) {
    try {
      const requester = await loadUser(req.user?.id);

      if (!requester) {
        return res.status(401).json({
          status: "error",
          code: "USER_NOT_FOUND",
          message: "Your user account could not be verified.",
        });
      }

      if (isOriginalSystemAdministrator(requester)) {
        req.verifiedSystemAdministrator = requester;
        return next();
      }

      const allowed = await hasDelegatedCapability(
        requester,
        capabilityCode
      );

      if (!allowed) {
        return res.status(403).json({
          status: "error",
          code: "DELEGATED_ADMIN_AUTHORITY_REQUIRED",
          capability: capabilityCode,
          message:
            `${capabilityLabel(capabilityCode)} requires an active owner-approved ` +
            "Delegated System Administrator authority.",
        });
      }

      req.delegatedSystemAdministrator = requester;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireDelegatedCapabilityForAdministrator(capabilityCode) {
  const strictGate = requireDelegatedCapability(capabilityCode);

  return async function delegatedAdministratorCapabilityMiddleware(req, res, next) {
    try {
      const requester = await loadUser(req.user?.id);
      if (!requester) {
        return res.status(401).json({
          status: "error",
          code: "USER_NOT_FOUND",
          message: "Your user account could not be verified.",
        });
      }

      if (
        isOriginalSystemAdministrator(requester) ||
        String(requester.role || "").trim().toLowerCase() !== "admin"
      ) {
        return next();
      }

      return strictGate(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

async function targetUserForRequest(req) {
  const targetUserId = Number(req.params?.id || req.params?.userId || 0);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return null;
  }
  return loadUser(targetUserId, pool);
}

async function delegatedUserAdministrationGate(req, res, next) {
  try {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    const requester = await loadUser(req.user?.id);
    if (!requester) {
      return res.status(401).json({
        status: "error",
        code: "USER_NOT_FOUND",
        message: "Your user account could not be verified.",
      });
    }

    if (isOriginalSystemAdministrator(requester)) {
      req.verifiedSystemAdministrator = requester;
      return next();
    }

    if (!(await hasDelegatedCapability(requester, "manage_users"))) {
      return res.status(403).json({
        status: "error",
        code: "DELEGATED_USER_MANAGEMENT_REQUIRED",
        message:
          "Only the original owner or an active Delegated System Administrator with staff-management authority can change user accounts.",
      });
    }

    const targetUser = await targetUserForRequest(req);
    const requestedRole = String(req.body?.role || "").trim().toLowerCase();
    const affectsAdministrator =
      requestedRole === "admin" ||
      String(targetUser?.role || "").trim().toLowerCase() === "admin";

    if (
      affectsAdministrator &&
      !(await hasDelegatedCapability(requester, "manage_administrators"))
    ) {
      return res.status(403).json({
        status: "error",
        code: "DELEGATED_ADMIN_MANAGEMENT_REQUIRED",
        message:
          "The owner has not authorized this Delegated System Administrator to manage other Administrator accounts.",
      });
    }

    if (targetUser && isOriginalSystemAdministrator(targetUser)) {
      return res.status(403).json({
        status: "error",
        code: "ORIGINAL_OWNER_PROTECTED",
        message:
          "The original System Administrator cannot be deleted, disabled, demoted, reset or changed by a delegated Administrator.",
      });
    }

    req.delegatedSystemAdministrator = requester;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  delegatedUserAdministrationGate,
  requireDelegatedCapability,
  requireDelegatedCapabilityForAdministrator,
};
