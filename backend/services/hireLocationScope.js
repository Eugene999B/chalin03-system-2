const { pool } = require("../config/db");

const EQUIPMENT_HIRE_WORKSPACE = "equipment_hire";

class HireLocationScopeError extends Error {
  constructor(statusCode, message, code = "HIRE_LOCATION_SCOPE_ERROR") {
    super(message);
    this.name = "HireLocationScopeError";
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

function requestedHireLocationId(req) {
  return positiveId(
    req.headers["x-chalin03-context-id"] ||
      req.body?.hire_location_id ||
      req.query?.hire_location_id
  );
}

async function findHireLocation(locationId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT
       bl.id,
       bl.code,
       bl.name,
       bl.location_type,
       bl.address,
       bl.phone,
       bl.is_active,
       bu.id AS business_unit_id,
       bu.code AS business_unit_code,
       bu.name AS business_unit_name
     FROM business_locations bl
     INNER JOIN business_units bu
       ON bu.id = bl.business_unit_id
     WHERE bl.id = ?
       AND bu.code = ?
       AND bu.is_enabled = TRUE
       AND bl.is_active = TRUE
     LIMIT 1`,
    [locationId, EQUIPMENT_HIRE_WORKSPACE]
  );

  return rows[0] || null;
}

async function userHasHireLocationAccess(
  userId,
  locationId,
  connection = pool
) {
  const [rows] = await connection.query(
    `SELECT id
     FROM user_hire_location_access
     WHERE user_id = ?
       AND location_id = ?
       AND can_access = TRUE
     LIMIT 1`,
    [userId, locationId]
  );

  return rows.length > 0;
}

async function resolveHireLocationScope(
  req,
  { connection = pool, requireSelection = false } = {}
) {
  if (workspaceCode(req) !== EQUIPMENT_HIRE_WORKSPACE) {
    throw new HireLocationScopeError(
      403,
      "Equipment Hire records are available only inside the Equipment Hire workspace.",
      "WRONG_WORKSPACE"
    );
  }

  const role = userRole(req);
  const isAdmin = role === "admin";
  const locationId = requestedHireLocationId(req);

  if (!locationId) {
    if (isAdmin && !requireSelection) {
      return {
        locationId: null,
        location: null,
        allLocations: true,
        automaticAccess: true,
      };
    }

    throw new HireLocationScopeError(
      400,
      "Choose an Equipment Hire location before continuing.",
      "HIRE_LOCATION_REQUIRED"
    );
  }

  const location = await findHireLocation(locationId, connection);

  if (!location) {
    throw new HireLocationScopeError(
      404,
      "The selected Equipment Hire location was not found or is inactive.",
      "HIRE_LOCATION_NOT_FOUND"
    );
  }

  if (!isAdmin) {
    const allowed = await userHasHireLocationAccess(
      req.user?.id,
      locationId,
      connection
    );

    if (!allowed) {
      throw new HireLocationScopeError(
        403,
        "Your account is not assigned to the selected Equipment Hire location.",
        "HIRE_LOCATION_ACCESS_DENIED"
      );
    }
  }

  return {
    locationId,
    location,
    allLocations: false,
    automaticAccess: isAdmin,
  };
}

function appendHireLocationFilter(
  where,
  params,
  alias,
  scope,
  column = "hire_location_id"
) {
  if (!scope?.locationId) return;

  const prefix = alias ? `${alias}.` : "";
  where.push(`${prefix}${column} = ?`);
  params.push(scope.locationId);
}

function hireLocationWhere(scope, alias, column = "hire_location_id") {
  if (!scope?.locationId) {
    return { sql: "", params: [] };
  }

  const prefix = alias ? `${alias}.` : "";
  return {
    sql: `${prefix}${column} = ?`,
    params: [scope.locationId],
  };
}

function assertRecordInHireLocation(scope, recordLocationId, label = "Record") {
  if (!scope?.locationId) return;

  if (Number(recordLocationId) !== Number(scope.locationId)) {
    throw new HireLocationScopeError(
      404,
      `${label} was not found in the selected Equipment Hire location.`,
      "HIRE_RECORD_OUTSIDE_LOCATION"
    );
  }
}

function sendHireLocationScopeError(res, error) {
  if (!(error instanceof HireLocationScopeError)) return false;

  res.status(error.statusCode).json({
    status: "error",
    code: error.code,
    message: error.message,
  });
  return true;
}

module.exports = {
  EQUIPMENT_HIRE_WORKSPACE,
  HireLocationScopeError,
  positiveId,
  requestedHireLocationId,
  resolveHireLocationScope,
  appendHireLocationFilter,
  hireLocationWhere,
  assertRecordInHireLocation,
  sendHireLocationScopeError,
};
