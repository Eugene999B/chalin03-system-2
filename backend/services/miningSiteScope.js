const { pool } = require("../config/db");

const MINING_WORKSPACE = "mining";

class MiningSiteScopeError extends Error {
  constructor(statusCode, message, code = "MINING_SITE_SCOPE_ERROR") {
    super(message);
    this.name = "MiningSiteScopeError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 100) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function userRole(req) {
  return cleanText(req.user?.role, 50).toLowerCase();
}

function workspaceCode(req) {
  return cleanText(
    req.user?.workspace_code || req.headers["x-chalin03-workspace"],
    50
  ).toLowerCase();
}

function requestedMiningSiteId(req) {
  return positiveId(
    req.headers["x-chalin03-context-id"] ||
      req.body?.site_id ||
      req.query?.site_id
  );
}

async function findMiningSite(siteId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT
       id,
       site_code,
       site_name,
       location,
       material_type,
       production_unit,
       daily_target,
       status,
       is_active
     FROM mining_sites
     WHERE id = ?
       AND is_active = TRUE
       AND status = 'active'
     LIMIT 1`,
    [siteId]
  );

  return rows[0] || null;
}

async function userHasMiningSiteAccess(userId, siteId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT id
     FROM user_mining_site_access
     WHERE user_id = ?
       AND site_id = ?
       AND can_access = TRUE
     LIMIT 1`,
    [userId, siteId]
  );

  return rows.length > 0;
}

function assertMiningWorkspace(req) {
  if (workspaceCode(req) !== MINING_WORKSPACE) {
    throw new MiningSiteScopeError(
      403,
      "Mining records are available only inside the Mining Operations workspace.",
      "WRONG_WORKSPACE"
    );
  }
}

async function resolveMiningSiteScope(
  req,
  { connection = pool, requireSelection = false } = {}
) {
  assertMiningWorkspace(req);

  const role = userRole(req);
  const isAdmin = role === "admin";
  const siteId = requestedMiningSiteId(req);

  if (!siteId) {
    if (isAdmin && !requireSelection) {
      return {
        siteId: null,
        site: null,
        allSites: true,
        automaticAccess: true,
      };
    }

    throw new MiningSiteScopeError(
      400,
      "Choose a Mining site before continuing.",
      "MINING_SITE_REQUIRED"
    );
  }

  const site = await findMiningSite(siteId, connection);

  if (!site) {
    throw new MiningSiteScopeError(
      404,
      "The selected Mining site was not found, is inactive, or is not operational.",
      "MINING_SITE_NOT_FOUND"
    );
  }

  if (!isAdmin) {
    const allowed = await userHasMiningSiteAccess(
      req.user?.id,
      siteId,
      connection
    );

    if (!allowed) {
      throw new MiningSiteScopeError(
        403,
        "Your account is not assigned to the selected Mining site.",
        "MINING_SITE_ACCESS_DENIED"
      );
    }
  }

  return {
    siteId,
    site,
    allSites: false,
    automaticAccess: isAdmin,
  };
}

function appendMiningSiteFilter(
  where,
  params,
  alias,
  scope,
  column = "site_id"
) {
  if (!scope?.siteId) return;

  const prefix = alias ? `${alias}.` : "";
  where.push(`${prefix}${column} = ?`);
  params.push(scope.siteId);
}

function miningSiteWhere(scope, alias, column = "site_id") {
  if (!scope?.siteId) {
    return { sql: "", params: [] };
  }

  const prefix = alias ? `${alias}.` : "";
  return {
    sql: `${prefix}${column} = ?`,
    params: [scope.siteId],
  };
}

function assertRecordInMiningSite(scope, recordSiteId, label = "Record") {
  if (!scope?.siteId) return;

  if (Number(recordSiteId) !== Number(scope.siteId)) {
    throw new MiningSiteScopeError(
      404,
      `${label} was not found in the selected Mining site.`,
      "MINING_RECORD_OUTSIDE_SITE"
    );
  }
}

function sendMiningSiteScopeError(res, error) {
  if (!(error instanceof MiningSiteScopeError)) return false;

  res.status(error.statusCode).json({
    status: "error",
    code: error.code,
    message: error.message,
  });
  return true;
}

module.exports = {
  MINING_WORKSPACE,
  MiningSiteScopeError,
  positiveId,
  requestedMiningSiteId,
  assertMiningWorkspace,
  resolveMiningSiteScope,
  appendMiningSiteFilter,
  miningSiteWhere,
  assertRecordInMiningSite,
  sendMiningSiteScopeError,
};
