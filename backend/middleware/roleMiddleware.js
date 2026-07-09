const AUDITOR_READ_ONLY_PREFIXES = [
  "/api/customer-statement",
  "/api/customer-statements",
  "/api/reports",
  "/api/audit-signoffs",
  "/api/accounting-intelligence",
  "/api/exports",
];

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function getCleanPath(req) {
  return String(req.originalUrl || req.url || "").split("?")[0];
}

function canAuditorReadThisRoute(req) {
  const role = normalizeRole(req.user?.role);

  if (role !== "auditor") {
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

    // Auditor accounts are read-only and are only allowed to open accounting,
    // audit, reports, customer statements and export/report routes.
    // They cannot create, edit, approve, delete, restore, clear, sell or adjust.
    if (canAuditorReadThisRoute(req)) {
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
