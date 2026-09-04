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

async function checkSparePartsUserSettingsAccess(req, res) {
  if (!isUserSettingsApi(req)) return true;

  try {
    const allowed = await canAccessSparePartsUserSettings(req.user);
    if (allowed) return true;

    res.status(403).json({
      status: "error",
      code: "SPARE_PARTS_USER_SETTINGS_SYSTEM_ADMIN_ONLY",
      message:
        "User Settings are currently restricted to the System Administrator for Spare Parts.",
    });
    return false;
  } catch (error) {
    console.error("Spare Parts User Settings access check failed:", error);
    res.status(503).json({
      status: "error",
      code: "SPARE_PARTS_USER_SETTINGS_ACCESS_CHECK_FAILED",
      message: "User Settings access could not be verified safely.",
    });
    return false;
  }
}

function canAuditorUseFullAuditRoute(req) {
  if (!isAuditor(req)) return false;
  const cleanPath = getCleanPath(req);
  return AUDITOR_FULL_AUDIT_PREFIXES.some((prefix) => cleanPath.startsWith(prefix));
}

function canAuditorReadOnlyRoute(req) {
  if (!isAuditor(req)) return false;
  if (String(req.method || "").toUpperCase() !== "GET") return false;
  const cleanPath = getCleanPath(req);
  return AUDITOR_READ_ONLY_PREFIXES.some((prefix) => cleanPath.startsWith(prefix));
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

    if (!(await checkSparePartsUserSettingsAccess(req, res))) return;

    const currentRoles = userRoles(req);

    if (currentRoles.some((role) => normalizedAllowedRoles.includes(role))) {
      return next();
    }

    if (canAuditorUseFullAuditRoute(req)) return next();
    if (canAuditorReadOnlyRoute(req)) return next();

    return res.status(403).json({
      status: "error",
      message: "You do not have permission to perform this action.",
    });
  };
}

module.exports = {
  requireRole,
};
