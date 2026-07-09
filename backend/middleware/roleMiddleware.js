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

  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required.",
      });
    }

    const currentRole = normalizeRole(req.user.role);

    if (normalizedAllowedRoles.includes(currentRole)) {
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
