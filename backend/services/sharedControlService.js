const { pool } = require("../config/db");
const {
  getEffectivePermissions,
  normalizeCode,
  normalizeRole,
} = require("../security/permissionCatalog");
const { sanitizeMetadata } = require("./auditTrailService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function activeWorkspaceCode(req) {
  return normalizeCode(
    req.user?.workspace_code ||
      req.user?.active_workspace?.code ||
      req.headers["x-chalin03-workspace"] ||
      "spare_parts"
  );
}

function isCompatibilityError(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code);
}

function requestContext(req, overrides = {}) {
  const workspaceCode = normalizeCode(
    overrides.workspaceCode || activeWorkspaceCode(req)
  );

  const branchId =
    workspaceCode === "spare_parts"
      ? positiveId(
          overrides.branchId ||
            req.user?.branch_id ||
            req.user?.default_branch_id ||
            req.headers["x-chalin03-branch-id"]
        )
      : null;

  const miningSiteId =
    workspaceCode === "mining"
      ? positiveId(
          overrides.miningSiteId ||
            req.headers["x-chalin03-context-id"] ||
            req.query?.site_id ||
            req.body?.site_id
        )
      : null;

  const hireLocationId =
    workspaceCode === "equipment_hire"
      ? positiveId(
          overrides.hireLocationId ||
            req.headers["x-chalin03-context-id"] ||
            req.query?.hire_location_id ||
            req.body?.hire_location_id
        )
      : null;

  const contextType =
    workspaceCode === "spare_parts"
      ? "branch"
      : workspaceCode === "mining"
      ? "mining_site"
      : workspaceCode === "equipment_hire"
      ? "hire_location"
      : "group";

  const contextId = branchId || miningSiteId || hireLocationId || null;

  return {
    workspaceCode,
    branchId,
    miningSiteId,
    hireLocationId,
    contextType,
    contextId,
  };
}

async function writeSharedControlEvidence({
  req,
  controlArea = "shared_control",
  actionType = "view",
  documentType = null,
  documentId = null,
  documentNumber = null,
  exportFormat = null,
  description = "",
  metadata = null,
  workspaceCode = null,
  branchId = null,
  miningSiteId = null,
  hireLocationId = null,
} = {}) {
  if (!req) return false;

  const context = requestContext(req, {
    workspaceCode,
    branchId,
    miningSiteId,
    hireLocationId,
  });

  let safeMetadata = null;
  if (metadata) {
    try {
      safeMetadata = JSON.stringify(sanitizeMetadata(metadata)).slice(0, 12000);
    } catch {
      safeMetadata = JSON.stringify({ note: "metadata_not_serializable" });
    }
  }

  try {
    await pool.query(
      `INSERT INTO shared_control_evidence (
         request_id,
         user_id,
         workspace_code,
         branch_id,
         mining_site_id,
         hire_location_id,
         context_type,
         context_id,
         control_area,
         action_type,
         document_type,
         document_id,
         document_number,
         export_format,
         description,
         metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanText(req.requestId, 120) || null,
        positiveId(req.user?.id),
        context.workspaceCode,
        context.branchId,
        context.miningSiteId,
        context.hireLocationId,
        context.contextType,
        context.contextId,
        cleanText(controlArea, 60) || "shared_control",
        cleanText(actionType, 40) || "view",
        cleanText(documentType, 80) || null,
        positiveId(documentId),
        cleanText(documentNumber, 180) || null,
        cleanText(exportFormat, 20) || null,
        cleanText(description, 1000) || null,
        safeMetadata,
      ]
    );

    return true;
  } catch (error) {
    if (isCompatibilityError(error)) return false;
    console.warn("Shared control evidence logging skipped:", error.message);
    return false;
  }
}

function evidenceScopeFilter(req, { groupMode = false } = {}) {
  const context = requestContext(req);
  const role = normalizeRole(req.user?.role);
  const permissions = new Set(
    req.user?.effective_permissions || getEffectivePermissions(req.user || {})
  );

  const canUseGroupMode =
    groupMode && isOriginalSystemAdministrator(req.user);

  if (canUseGroupMode) {
    return {
      ...context,
      groupMode: true,
      scopeLabel: "Authorized group-wide evidence",
    };
  }

  return {
    ...context,
    groupMode: false,
    scopeLabel:
      context.workspaceCode === "spare_parts"
        ? context.branchId
          ? `Spare Parts branch ${context.branchId}`
          : "Spare Parts authorized branches"
        : context.workspaceCode === "mining"
        ? context.miningSiteId
          ? `Mining site ${context.miningSiteId}`
          : "Authorized Mining sites"
        : context.hireLocationId
        ? `Hire location ${context.hireLocationId}`
        : "Authorized Hire locations",
  };
}

function appendScopeWhere(where, params, scope, alias = "sce") {
  if (scope.groupMode) return;

  where.push(`${alias}.workspace_code = ?`);
  params.push(scope.workspaceCode);

  if (scope.workspaceCode === "spare_parts" && scope.branchId) {
    where.push(`${alias}.branch_id = ?`);
    params.push(scope.branchId);
  }

  if (scope.workspaceCode === "mining") {
    if (scope.miningSiteId) {
      where.push(`${alias}.mining_site_id = ?`);
      params.push(scope.miningSiteId);
    }

    if (normalizeRole(scope.role) !== "admin") {
      where.push(
        `(${alias}.mining_site_id IS NULL OR EXISTS (
          SELECT 1
          FROM user_mining_site_access umsa
          WHERE umsa.user_id = ?
            AND umsa.site_id = ${alias}.mining_site_id
            AND umsa.can_access = TRUE
        ))`
      );
      params.push(scope.userId);
    }
  }

  if (scope.workspaceCode === "equipment_hire") {
    if (scope.hireLocationId) {
      where.push(`${alias}.hire_location_id = ?`);
      params.push(scope.hireLocationId);
    }

    if (normalizeRole(scope.role) !== "admin") {
      where.push(
        `(${alias}.hire_location_id IS NULL OR EXISTS (
          SELECT 1
          FROM user_hire_location_access uhla
          WHERE uhla.user_id = ?
            AND uhla.location_id = ${alias}.hire_location_id
            AND uhla.can_access = TRUE
        ))`
      );
      params.push(scope.userId);
    }
  }
}

function dateOnly(value) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function loadSharedControlEvidence(req, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
  const scope = evidenceScopeFilter(req, {
    groupMode: Boolean(options.groupMode),
  });
  scope.userId = positiveId(req.user?.id);
  scope.role = normalizeRole(req.user?.role);

  const where = [];
  const params = [];
  appendScopeWhere(where, params, scope);

  const from = dateOnly(options.from);
  const to = dateOnly(options.to);
  const area = cleanText(options.controlArea, 60);
  const action = cleanText(options.actionType, 40);
  const search = cleanText(options.search, 120);

  if (from) {
    where.push("DATE(sce.created_at) >= ?");
    params.push(from);
  }
  if (to) {
    where.push("DATE(sce.created_at) <= ?");
    params.push(to);
  }
  if (area) {
    where.push("sce.control_area = ?");
    params.push(area);
  }
  if (action) {
    where.push("sce.action_type = ?");
    params.push(action);
  }
  if (search) {
    const term = `%${search}%`;
    where.push(`(
      sce.document_number LIKE ? OR
      sce.document_type LIKE ? OR
      sce.description LIKE ? OR
      u.username LIKE ? OR
      u.full_name LIKE ?
    )`);
    params.push(term, term, term, term, term);
  }

  try {
    const [rows] = await pool.query(
      `SELECT
         sce.id,
         sce.request_id,
         sce.workspace_code,
         sce.branch_id,
         sce.mining_site_id,
         sce.hire_location_id,
         sce.context_type,
         sce.context_id,
         sce.control_area,
         sce.action_type,
         sce.document_type,
         sce.document_id,
         sce.document_number,
         sce.export_format,
         sce.description,
         sce.created_at,
         u.username,
         u.full_name,
         u.role
       FROM shared_control_evidence sce
       LEFT JOIN users u ON u.id = sce.user_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY sce.created_at DESC, sce.id DESC
       LIMIT ?`,
      [...params, limit]
    );

    return { rows, scope, available: true };
  } catch (error) {
    if (isCompatibilityError(error)) {
      return { rows: [], scope, available: false };
    }
    throw error;
  }
}

function buildSharedRoleAssurance(req) {
  const context = requestContext(req);
  const role = normalizeRole(req.user?.role);
  const workspaceRole = normalizeRole(
    req.user?.workspace_role || req.user?.access_role || role
  );
  const permissions =
    req.user?.effective_permissions || getEffectivePermissions(req.user || {});
  const permissionSet = new Set(permissions);

  const canManageBusinessRecords = [...permissionSet].some((permission) =>
    /\.(manage|create|approve)$/.test(permission)
  );

  return {
    user: {
      id: positiveId(req.user?.id),
      username: cleanText(req.user?.username, 120),
      full_name: cleanText(req.user?.full_name, 180),
      global_role: role,
      workspace_role: workspaceRole,
    },
    scope: {
      workspace_code: context.workspaceCode,
      branch_id: context.branchId,
      mining_site_id: context.miningSiteId,
      hire_location_id: context.hireLocationId,
      context_type: context.contextType,
      context_id: context.contextId,
      location_isolation_enforced: ["mining", "equipment_hire"].includes(
        context.workspaceCode
      ),
    },
    capabilities: {
      shared_control_view: permissionSet.has("shared.control.view"),
      documents_view: permissionSet.has("shared.documents.view"),
      reports_view: permissionSet.has("shared.reports.view"),
      reports_export: permissionSet.has("shared.reports.export"),
      audit_evidence_view: permissionSet.has("shared.audit.view"),
      audit_export: permissionSet.has("audit.export"),
      group_executive_view: permissionSet.has("executive.operations.view"),
      read_only: role === "auditor" || !canManageBusinessRecords,
    },
    effective_permissions: [...permissionSet].sort(),
  };
}

module.exports = {
  activeWorkspaceCode,
  requestContext,
  writeSharedControlEvidence,
  loadSharedControlEvidence,
  buildSharedRoleAssurance,
  isCompatibilityError,
};
