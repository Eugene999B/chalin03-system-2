const {
  getEffectivePermissions,
  hasAnyPermission,
  hasEveryPermission,
  normalizeCode,
} = require("../security/permissionCatalog");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { resolveEffectivePermissions } = require("../services/permissionOverrideService");

async function attachEffectivePermissions(req, res, next) {
  try {
    if (req.user) {
      req.user.effective_permissions = await resolveEffectivePermissions(req.user);
    }

    next();
  } catch (error) {
    next(error);
  }
}

function permissionDenied(res, req, permissions) {
  return res.status(403).json({
    status: "error",
    code: "PERMISSION_DENIED",
    message: "You do not have permission to perform this action.",
    request_id: req.requestId || null,
    required_permissions: permissions,
  });
}

function requirePermission(...permissions) {
  const required = permissions.flat().filter(Boolean);

  return function permissionMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        status: "error",
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication required.",
        request_id: req.requestId || null,
      });
    }

    // Defense in depth: the protected owner account cannot be blocked by a
    // stale token permission list or a historical override row.
    if (isOriginalSystemAdministrator(req.user)) {
      return next();
    }

    req.user.effective_permissions =
      req.user.effective_permissions || getEffectivePermissions(req.user);

    if (hasEveryPermission(req.user, required)) {
      return next();
    }

    return permissionDenied(res, req, required);
  };
}

function requireAnyPermission(...permissions) {
  const required = permissions.flat().filter(Boolean);

  return function anyPermissionMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        status: "error",
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication required.",
        request_id: req.requestId || null,
      });
    }

    // Keep the original System Administrator fail-open for permission checks
    // after identity has already been verified by requireAuth.
    if (isOriginalSystemAdministrator(req.user)) {
      return next();
    }

    req.user.effective_permissions =
      req.user.effective_permissions || getEffectivePermissions(req.user);

    if (required.length === 0 || hasAnyPermission(req.user, required)) {
      return next();
    }

    return permissionDenied(res, req, required);
  };
}

function cleanPath(req) {
  return String(req.path || req.originalUrl || "")
    .split("?")[0]
    .toLowerCase();
}

function isMethod(req, method) {
  return String(req.method || "").toUpperCase() === method;
}

function miningPermissionForRequest(req) {
  const path = cleanPath(req);

  if (isMethod(req, "GET")) {
    if (path.startsWith("/dashboard")) return "workspace.view";
    if (path.startsWith("/sites")) return "mining.sites.view";
    if (path.startsWith("/daily-logs")) return "mining.daily_logs.view";
    if (path.startsWith("/production")) return "mining.production.view";
    if (path.startsWith("/equipment-logs")) return "mining.equipment_logs.view";
    if (path.startsWith("/fuel-logs")) return "mining.fuel.view";
    if (path.startsWith("/expenses")) return "mining.expenses.view";
    if (path.startsWith("/incidents")) return "mining.incidents.view";
    return "mining.reports.view";
  }

  if (path.startsWith("/sites")) return "mining.sites.manage";
  if (path.includes("/approve") && path.startsWith("/daily-logs")) {
    return "mining.daily_logs.approve";
  }
  if (path.includes("/approve") && path.startsWith("/production")) {
    return "mining.production.approve";
  }
  if (path.includes("/approve") && path.startsWith("/equipment-logs")) {
    return "mining.equipment_logs.approve";
  }
  if (path.includes("/approve") && path.startsWith("/expenses")) {
    return "mining.expenses.approve";
  }
  if (path.startsWith("/daily-logs")) return "mining.daily_logs.create";
  if (path.startsWith("/production")) return "mining.production.create";
  if (path.startsWith("/equipment-logs")) return "mining.equipment_logs.create";
  if (path.startsWith("/fuel-logs")) return "mining.fuel.manage";
  if (path.startsWith("/expenses")) return "mining.expenses.manage";
  if (path.startsWith("/incidents")) return "mining.incidents.manage";

  return "mining.reports.view";
}

function hirePermissionForRequest(req) {
  const path = cleanPath(req);

  if (isMethod(req, "GET")) {
    if (path.startsWith("/dashboard")) return "workspace.view";
    if (path.startsWith("/customers")) return "hire.customers.view";
    if (path.startsWith("/enquiries")) return "hire.enquiries.view";
    if (path.startsWith("/availability")) return "fleet.assets.view";
    if (path.startsWith("/quotations")) return "hire.quotations.view";
    if (path.startsWith("/contracts")) return "hire.contracts.view";
    if (path.startsWith("/contract-assets")) return "hire.contracts.view";
    if (path.startsWith("/dispatches")) return "hire.dispatch.view";
    if (path.startsWith("/work-logs")) return "hire.work_logs.view";
    if (path.startsWith("/billable-work-logs")) return "hire.work_logs.view";
    if (path.startsWith("/finance-summary")) return "hire.reports.view";
    if (path.startsWith("/invoices")) return "hire.invoices.view";
    if (path.startsWith("/payments")) return "hire.payments.view";
    if (path.startsWith("/returns")) return "hire.returns.view";
    return "hire.reports.view";
  }

  if (path.startsWith("/customers")) return "hire.customers.manage";
  if (path.startsWith("/enquiries")) return "hire.enquiries.manage";
  if (path.includes("/approve") && path.startsWith("/work-logs")) {
    return "hire.work_logs.approve";
  }
  if (path.includes("/status") && path.startsWith("/quotations")) {
    return "hire.quotations.approve";
  }
  if (path.includes("/close") && path.startsWith("/contracts")) {
    const closeType = String(req.body?.close_type || req.body?.closure_type || "")
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    return closeType.includes("financial")
      ? "hire.contracts.close_financial"
      : "hire.contracts.close_operational";
  }
  if (path.startsWith("/quotations")) return "hire.quotations.manage";
  if (path.startsWith("/contracts")) return "hire.contracts.manage";
  if (path.startsWith("/contract-assets")) return "hire.contracts.manage";
  if (path.startsWith("/dispatches")) return "hire.dispatch.manage";
  if (path.startsWith("/work-logs")) return "hire.work_logs.manage";
  if (path.startsWith("/invoices")) return "hire.invoices.manage";
  if (path.startsWith("/payments")) return "hire.payments.manage";
  if (path.startsWith("/returns")) return "hire.returns.manage";

  return "hire.reports.view";
}

function fleetPermissionForRequest(req) {
  const path = cleanPath(req);

  if (isMethod(req, "GET")) {
    return "fleet.assets.view";
  }

  if (path.includes("/meter-readings")) return "fleet.meter.manage";
  if (path.includes("/fuel-logs")) return "fleet.fuel.manage";
  if (path.includes("/maintenance")) return "fleet.maintenance.manage";
  if (path.includes("/inspections")) return "fleet.inspections.manage";
  return "fleet.assets.manage";
}

function routePermissionForWorkspace(workspaceCode, req) {
  const code = normalizeCode(workspaceCode);

  if (code === "mining") {
    return miningPermissionForRequest(req);
  }

  if (code === "equipment_hire") {
    return hirePermissionForRequest(req);
  }

  if (code === "fleet") {
    return fleetPermissionForRequest(req);
  }

  return null;
}

function requireWorkspaceRoutePermission(workspaceCode) {
  return function workspaceRoutePermission(req, res, next) {
    const permission = routePermissionForWorkspace(workspaceCode, req);

    if (!permission) {
      return next();
    }

    return requirePermission(permission)(req, res, next);
  };
}

module.exports = {
  attachEffectivePermissions,
  requirePermission,
  requireAnyPermission,
  routePermissionForWorkspace,
  requireWorkspaceRoutePermission,
};