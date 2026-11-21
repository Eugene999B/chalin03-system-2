const { pool } = require("../config/db");
const {
  EQUIPMENT_DIVISIONS,
  hasEquipmentDivisionAccess,
} = require("../security/equipmentDivisionAccess");

const EQUIPMENT_HIRE_WORKSPACE = "equipment_hire";
const FINANCE_DIVISION_HEADER = "installment_finance";

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

function requestPath(req) {
  return String(req.originalUrl || req.url || req.path || "/")
    .split("?")[0]
    .toLowerCase();
}

function financeSalesPath(req) {
  const path = requestPath(req);
  const marker = "/api/equipment-catalogue/sales";
  const index = path.indexOf(marker);
  if (index < 0) return null;
  return path.slice(index + marker.length) || "/";
}

function isFinanceDivisionRequest(req) {
  const division = cleanText(req.headers["x-chalin03-division"], 80).toLowerCase();
  const authorised = hasEquipmentDivisionAccess(
    req.user || {},
    EQUIPMENT_DIVISIONS.FINANCE
  );
  if (!authorised) return false;

  return (
    financeSalesPath(req) !== null ||
    (division === FINANCE_DIVISION_HEADER &&
      requestPath(req).startsWith("/api/equipment-catalogue"))
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

async function locationFromRecord(connection, tableName, recordId) {
  const allowedTables = new Set([
    "equipment_sales_enquiries",
    "equipment_sales_quotations",
    "equipment_credit_applications",
    "equipment_sale_agreements",
    "fleet_assets",
  ]);
  if (!allowedTables.has(tableName) || !positiveId(recordId)) return null;

  const [rows] = await connection.query(
    `SELECT hire_location_id FROM ${tableName} WHERE id = ? LIMIT 1`,
    [recordId]
  );
  return positiveId(rows[0]?.hire_location_id);
}

async function resolveFinanceRecordLocation(req, connection = pool) {
  const path = financeSalesPath(req);
  if (path === null) return null;

  const method = String(req.method || "GET").toUpperCase();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  let match;

  if (method === "POST" && path === "/credit-applications") {
    const quotationId = positiveId(
      body.quotation_id || body.application?.quotation_id
    );
    return locationFromRecord(connection, "equipment_sales_quotations", quotationId);
  }

  match = path.match(/^\/credit-applications\/(\d+)(?:\/|$)/);
  if (match) {
    return locationFromRecord(
      connection,
      "equipment_credit_applications",
      match[1]
    );
  }

  match = path.match(/^\/agreement-activations\/(\d+)(?:\/|$)/);
  if (match) {
    return locationFromRecord(
      connection,
      "equipment_credit_applications",
      match[1]
    );
  }

  match = path.match(/^\/deposit-reservations\/(\d+)(?:\/|$)/);
  if (match) {
    return locationFromRecord(connection, "equipment_sale_agreements", match[1]);
  }

  match = path.match(/^\/finance-lifecycle\/accounts\/(\d+)(?:\/|$)/);
  if (match) {
    return locationFromRecord(connection, "equipment_sale_agreements", match[1]);
  }

  match = path.match(/^\/installment-command\/agreements\/(\d+)(?:\/|$)/);
  if (match) {
    return locationFromRecord(connection, "equipment_sale_agreements", match[1]);
  }

  match = path.match(/^\/agreements\/(\d+)(?:\/|$)/);
  if (match) {
    return locationFromRecord(connection, "equipment_sale_agreements", match[1]);
  }

  match = path.match(/^\/quotations\/(\d+)(?:\/|$)/);
  if (match) {
    return locationFromRecord(connection, "equipment_sales_quotations", match[1]);
  }

  match = path.match(/^\/enquiries\/(\d+)(?:\/|$)/);
  if (match) {
    return locationFromRecord(connection, "equipment_sales_enquiries", match[1]);
  }

  if (method === "POST" && path === "/quotations") {
    return locationFromRecord(connection, "fleet_assets", body.asset_id);
  }

  const agreementId = positiveId(body.agreement_id);
  if (agreementId) {
    return locationFromRecord(connection, "equipment_sale_agreements", agreementId);
  }

  const assetId = positiveId(body.asset_id);
  if (assetId) {
    return locationFromRecord(connection, "fleet_assets", assetId);
  }

  const explicitOriginId = positiveId(body.equipment_origin_location_id);
  if (explicitOriginId) return explicitOriginId;

  return null;
}

async function resolveIndependentFinanceScope(
  req,
  { connection = pool, requireSelection = false } = {}
) {
  const path = financeSalesPath(req);
  const method = String(req.method || "GET").toUpperCase();

  // Finance is company-wide. A controlled agreement is its own scope
  // reference, so a missing hire_location_id must not block Finance
  // lifecycle mutations such as collections, delivery, or ownership.
  const lifecycleMatch = path?.match(
    /^\/finance-lifecycle\/accounts\/(\d+)(?:\/|$)/
  );
  if (lifecycleMatch) {
    const agreementId = positiveId(lifecycleMatch[1]);
    if (agreementId) {
      const [rows] = await connection.query(
        `SELECT id
         FROM equipment_sale_agreements
         WHERE id = ?
         LIMIT 1`,
        [agreementId]
      );
      if (rows.length) {
        return {
          locationId: null,
          location: null,
          allLocations: true,
          automaticAccess: true,
          independentFinance: true,
          equipmentOriginReference: true,
          financeRecordReference: agreementId,
        };
      }
    }
  }

  const locationId = await resolveFinanceRecordLocation(req, connection);

  if (locationId) {
    return {
      locationId,
      location: null,
      allLocations: false,
      automaticAccess: true,
      independentFinance: true,
      equipmentOriginReference: true,
    };
  }

  if (method === "GET" || !requireSelection) {
    return {
      locationId: null,
      location: null,
      allLocations: true,
      automaticAccess: true,
      independentFinance: true,
      equipmentOriginReference: false,
    };
  }

  throw new HireLocationScopeError(
    400,
    path === "/enquiries"
      ? "Create Finance work from a selected machine or controlled Finance document. A Hire location is not used for Finance enquiries."
      : "The Finance action could not resolve its machine or document reference. Refresh the controlled Finance record and try again.",
    "FINANCE_RECORD_SCOPE_REQUIRED"
  );
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

  if (isFinanceDivisionRequest(req)) {
    return resolveIndependentFinanceScope(req, {
      connection,
      requireSelection,
    });
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
  if (!scope?.locationId || scope?.independentFinance) return;

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
  FINANCE_DIVISION_HEADER,
  HireLocationScopeError,
  positiveId,
  requestedHireLocationId,
  isFinanceDivisionRequest,
  resolveFinanceRecordLocation,
  resolveIndependentFinanceScope,
  resolveHireLocationScope,
  appendHireLocationFilter,
  hireLocationWhere,
  assertRecordInHireLocation,
  sendHireLocationScopeError,
};