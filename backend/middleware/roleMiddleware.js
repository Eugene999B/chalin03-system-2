const {
  canAccessSparePartsUserSettings,
} = require("../services/sparePartsUserSettingsAccessService");

const AUDITOR_FULL_AUDIT_PREFIXES = [
  "/api/audit-signoffs",
  "/api/accounting-intelligence",
  "/api/exports",
];

const AUDITOR_READ_ONLY_PREFIXES = [
  "/api/customer-statement",
  "/api/customer-statements",
  "/api/reports",
];

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function getCleanPath(req) {
  return String(req.originalUrl || req.url || "").split("?")[0];
}

function isAuditor(req) {
  return normalizeRole(req.user?.role) === "auditor";
}

function userRoles(req) {
  return [
    normalizeRole(req.user?.role),
    normalizeRole(req.user?.workspace_role),
  ].filter(Boolean);
}

function isUserSettingsApi(req) {
  return getCleanPath(req).startsWith("/api/users");
}

async function enforceSparePartsUserSettingsAccess(req, res, next) {
  if (!isUserSettingsApi(req)) return next();

  try {
    const allowed = await canAccessSparePartsUserSettings(req.user);
    if (allowed) return next();

    return res.status(403).json({
      status: "error",
      code: "SPARE_PARTS_USER_SETTINGS_SYSTEM_ADMIN_ONLY",
      message:
        "User Settings are currently restricted to the System Administrator for Spare Parts.",
    });
  } catch (error) {
    console.error("Spare Parts User Settings access check failed:", error);
    return res.status(503).json({
      status: "error",
      code: "SPARE_PARTS_USER_SETTINGS_ACCESS_CHECK_FAILED",
      message: "User Settings access could not be verified safely.",
    });
  }
}

function canAuditorUseFullAuditRoute(req) {
  if (!isAuditor(req)) {
    return false;
  }

  const cleanPath = getCleanPath(req);

  return AUDITOR_FULL_AUDIT_PREFIXES.some((prefix) =>
    cleanPath.startsWith(prefix)
  );
}

function canAuditorReadOnlyRoute(req) {
  if (!isAuditor(req)) {
    return false;
  }

  if (String(req.method || "").toUpperCase() !== "GET") {
    return false;
  }

  const cleanPath = getCleanPath(req);

  return AUDITOR_READ_ONLY_PREFIXES.some((prefix) =>
    cleanPath.startsWith(prefix)
  );
}

function requireRole(...allowedRoles) {
  const normalizedAllowedRoles = allowedRoles.map((role) => normalizeRole(role));

  return async function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required.",
      });
    }

    await enforceSparePartsUserSettingsAccess(req, res, () => {});
    if (res.headersSent) return;

    const currentRoles = userRoles(req);

    if (currentRoles.some((role) => normalizedAllowedRoles.includes(role))) {
      return next();
    }

    // Auditor accounts have boss-approved working access to the audit area:
    // - Audit Sign-Offs: can create/update/delete/approve where the route supports it
    // - Accounting Intelligence: can open and run accounting intelligence endpoints
    // - Exports: can download/export audit and management records
    if (canAuditorUseFullAuditRoute(req)) {
      return next();
    }

    // Auditor accounts can still view supporting reports/customer statements,
    // but cannot change records through those supporting routes.
    if (canAuditorReadOnlyRoute(req)) {
      return next();
    }

    return res.status(403).json({
      status: "error",
      message: "You do not have permission to perform this action.",
    });
  };
}

module.exports = {
  requireRole,
};
