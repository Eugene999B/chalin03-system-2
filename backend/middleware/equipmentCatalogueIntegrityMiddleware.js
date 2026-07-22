const { pool } = require("../config/db");

const HIRE_PURPOSES = new Set(["hire_only", "company_operations"]);
const SALE_PURPOSES = new Set(["sale_only", "sale_or_hire"]);
const VALID_PURPOSES = new Set([...HIRE_PURPOSES, ...SALE_PURPOSES]);
const VALID_SALE_STATUSES = new Set([
  "not_for_sale",
  "available",
  "reserved",
  "installment_active",
  "sold",
  "cancelled",
]);

function normalizeEnum(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function sendValidationError(res, message, code) {
  return res.status(400).json({
    status: "error",
    code,
    message,
  });
}

function isAssetCreateOrEdit(req) {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return false;
  return /^\/assets(?:\/\d+)?\/?$/.test(req.path);
}

async function loadExistingAsset(req) {
  const match = req.path.match(/^\/assets\/(\d+)\/?$/);
  if (!match) return null;

  const assetId = Number(match[1]);
  if (!Number.isInteger(assetId) || assetId <= 0) return null;

  const [rows] = await pool.query(
    `SELECT id, operational_purpose, sale_status, current_status
     FROM fleet_assets
     WHERE id = ?
     LIMIT 1`,
    [assetId]
  );

  return rows[0] || null;
}

async function enforceEquipmentCatalogueWriteIntegrity(req, res, next) {
  if (!isAssetCreateOrEdit(req)) return next();

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    req.body = body;

    const existing = await loadExistingAsset(req);
    const requestedPurpose = normalizeEnum(body.operational_purpose);
    const requestedSaleStatus = normalizeEnum(body.sale_status);
    const requestedCurrentStatus = normalizeEnum(body.current_status);

    if (requestedPurpose && !VALID_PURPOSES.has(requestedPurpose)) return next();
    if (requestedSaleStatus && !VALID_SALE_STATUSES.has(requestedSaleStatus)) return next();

    if (requestedSaleStatus === "sold" || requestedCurrentStatus === "sold") {
      return sendValidationError(
        res,
        "Equipment cannot be marked sold from the catalogue editor. Complete the controlled sale, final settlement and ownership-transfer workflow instead.",
        "CONTROLLED_EQUIPMENT_SALE_REQUIRED"
      );
    }

    const nextPurpose =
      requestedPurpose || normalizeEnum(existing?.operational_purpose) || "hire_only";
    let nextSaleStatus =
      requestedSaleStatus || normalizeEnum(existing?.sale_status) || "not_for_sale";

    if (requestedPurpose && HIRE_PURPOSES.has(nextPurpose)) {
      body.sale_status = "not_for_sale";
      nextSaleStatus = "not_for_sale";
    }

    if (
      requestedPurpose &&
      SALE_PURPOSES.has(nextPurpose) &&
      ["not_for_sale", "cancelled"].includes(nextSaleStatus)
    ) {
      body.sale_status = "available";
      nextSaleStatus = "available";
    }

    if (HIRE_PURPOSES.has(nextPurpose) && nextSaleStatus !== "not_for_sale") {
      return sendValidationError(
        res,
        "Hire-only and company-operation equipment must remain not for sale.",
        "EQUIPMENT_PURPOSE_SALE_STATUS_CONFLICT"
      );
    }

    if (SALE_PURPOSES.has(nextPurpose) && nextSaleStatus === "not_for_sale") {
      return sendValidationError(
        res,
        "Sale-only or sale-or-hire equipment must be available, reserved or under an approved sale workflow.",
        "EQUIPMENT_PURPOSE_SALE_STATUS_CONFLICT"
      );
    }

    return next();
  } catch (error) {
    console.error("Equipment catalogue integrity middleware error:", error);
    return res.status(500).json({
      status: "error",
      code: "EQUIPMENT_CATALOGUE_INTEGRITY_CHECK_FAILED",
      message: "The equipment status safety check could not be completed.",
    });
  }
}

module.exports = {
  enforceEquipmentCatalogueWriteIntegrity,
};
