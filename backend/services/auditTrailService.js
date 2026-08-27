const { pool } = require("../config/db");

const tableColumnCache = new Map();
const SECRET_KEY_PATTERN =
  /(password|password_hash|token|jwt|secret|api[_-]?key|connection|database_url|db_password)/i;

function cleanText(value, maxLength = 255) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function safeJson(value) {
  if (value === undefined || value === null) return null;

  try {
    return JSON.stringify(sanitizeMetadata(value)).slice(0, 16000);
  } catch {
    return JSON.stringify({ note: "metadata_not_serializable" });
  }
}

function sanitizeMetadata(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key)
          ? "[REDACTED]"
          : sanitizeMetadata(entry),
      ])
    );
  }

  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}...`;
  }

  return value;
}

async function getTableColumns(connectionOrPool, tableName) {
  if (tableColumnCache.has(tableName)) {
    return tableColumnCache.get(tableName);
  }

  try {
    const [columns] = await connectionOrPool.query(`SHOW COLUMNS FROM \`${tableName}\``);
    const columnSet = new Set(columns.map((column) => column.Field));
    tableColumnCache.set(tableName, columnSet);
    return columnSet;
  } catch {
    const empty = new Set();
    tableColumnCache.set(tableName, empty);
    return empty;
  }
}

function getRequestAuditContext(req) {
  const workspaceCode =
    req?.user?.workspace_code || req?.headers?.["x-chalin03-workspace"] || null;
  const contextId = req?.headers?.["x-chalin03-context-id"] || null;

  return {
    request_id: req?.requestId || null,
    user_agent: req?.headers?.["user-agent"] || null,
    ip_address:
      req?.ip ||
      req?.headers?.["x-forwarded-for"] ||
      req?.socket?.remoteAddress ||
      null,
    workspace_code: workspaceCode,
    business_unit_id: req?.user?.business_unit_id || null,
    mining_site_id:
      req?.miningSiteScope?.siteId ||
      (workspaceCode === "mining" ? contextId : null) ||
      null,
    hire_location_id:
      req?.hireLocationScope?.locationId ||
      (workspaceCode === "equipment_hire" ? contextId : null) ||
      null,
  };
}

async function writeAuditEvent(options = {}, legacyOptions = null) {
  // The established API accepts one options object. A few older Finance routes
  // still call writeAuditEvent(connection, options) from inside transactions.
  // Preserve that call shape so their audit write uses the SAME transaction
  // connection rather than silently falling back to the global pool.
  const normalizedOptions =
    legacyOptions && typeof legacyOptions === "object"
      ? { ...legacyOptions, connection: options }
      : options || {};

  const {
    connection = pool,
    req = null,
    userId = null,
    branchId = null,
    action,
    details,
    workspaceCode = null,
    businessUnitId = null,
    miningSiteId = null,
    hireLocationId = null,
    entityType = null,
    entityId = null,
    actionType = null,
    outcome = "success",
    severity = "info",
    metadata = null,
  } = normalizedOptions;

  const columns = await getTableColumns(connection, "activity_log");

  if (columns.size === 0) {
    return null;
  }

  const requestContext = getRequestAuditContext(req);
  const row = {
    branch_id: branchId ?? req?.user?.branch_id ?? req?.user?.default_branch_id ?? null,
    user_id: userId ?? req?.user?.id ?? null,
    action: cleanText(action || actionType || "AUDIT_EVENT", 150),
    details: cleanText(details || action || actionType || "Audit event", 2000),
    ip_address: cleanText(requestContext.ip_address, 50),
    workspace_code: cleanText(workspaceCode || requestContext.workspace_code, 50),
    business_unit_id: businessUnitId || requestContext.business_unit_id || null,
    mining_site_id: miningSiteId || requestContext.mining_site_id || null,
    hire_location_id: hireLocationId || requestContext.hire_location_id || null,
    entity_type: cleanText(entityType, 80),
    entity_id: cleanText(entityId, 80),
    action_type: cleanText(actionType || action, 100),
    outcome: cleanText(outcome, 40) || "success",
    severity: cleanText(severity, 40) || "info",
    request_id: cleanText(requestContext.request_id, 100),
    user_agent: cleanText(requestContext.user_agent, 500),
    metadata_json: safeJson(metadata),
  };

  const availableEntries = Object.entries(row).filter(([column]) =>
    columns.has(column)
  );

  if (availableEntries.length === 0) {
    return null;
  }

  const columnNames = availableEntries.map(([column]) => `\`${column}\``);
  const placeholders = availableEntries.map(() => "?");
  const params = availableEntries.map(([, value]) => value);

  const [result] = await connection.query(
    `INSERT INTO activity_log (${columnNames.join(", ")})
     VALUES (${placeholders.join(", ")})`,
    params
  );
  return Number(result?.insertId || 0) || null;
}

module.exports = {
  writeAuditEvent,
  sanitizeMetadata,
  getRequestAuditContext,
  getTableColumns,
};