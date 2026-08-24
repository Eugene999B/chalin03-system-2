const crypto = require("crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  resolveHireLocationScope,
  sendHireLocationScopeError,
} = require("../services/hireLocationScope");
const {
  ensureEquipmentSalesSchema,
} = require("../services/equipmentSalesSchemaService");
const equipmentSalesRoutes = require("../routes/equipmentSalesRoutes");
const equipmentFinanceIndependentRoutes = require("../routes/equipmentFinanceIndependentRoutes");

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
const VALID_EVIDENCE_TYPES = new Set([
  "main",
  "front",
  "rear",
  "left_side",
  "right_side",
  "cabin",
  "engine",
  "serial_plate",
  "chassis_plate",
  "attachment",
  "inspection",
  "damage",
  "delivery",
  "return",
  "registration",
  "insurance",
  "ownership",
  "other",
]);
const ALLOWED_PHOTO_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_PROTECTED_PHOTO_BYTES = 192 * 1024;

let foundationPromise = null;

function normalizeEnum(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return ["true", "yes", "on"].includes(cleanText(value, 10).toLowerCase());
}

function userHasPermission(req, permission) {
  const permissions = Array.isArray(req.user?.effective_permissions)
    ? req.user.effective_permissions
    : [];
  const role = cleanText(req.user?.role, 80).toLowerCase();

  return (
    permissions.includes(permission) ||
    ["admin", "administrator", "system_administrator", "super_admin"].includes(role)
  );
}

function sendValidationError(res, message, code, statusCode = 400) {
  return res.status(statusCode).json({
    status: "error",
    code,
    message,
  });
}

function isAssetCreateOrEdit(req) {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return false;
  return /^\/assets(?:\/\d+)?\/?$/.test(req.path);
}

function securePhotoUploadMatch(req) {
  if (req.method !== "POST") return null;
  const match = req.path.match(/^\/assets\/(\d+)\/media\/?$/);
  if (!match) return null;
  const fileUrl = String(req.body?.file_url || "");
  return fileUrl.startsWith("data:image/") ? match : null;
}

function isEquipmentSalesRequest(req) {
  return /^\/sales(?:\/|$)/.test(String(req.path || ""));
}

function isDepositReservationRequest(req) {
  const values = [req.path, req.originalUrl, req.url]
    .map((value) => String(value || "").split("?")[0]);

  return values.some(
    (value) =>
      /^\/sales\/deposit-reservations(?:\/|$)/.test(value) ||
      /\/api\/equipment-catalogue\/sales\/deposit-reservations(?:\/|$)/.test(value) ||
      /\/equipment-catalogue\/sales\/deposit-reservations(?:\/|$)/.test(value)
  );
}

async function ensureFoundationOnce() {
  if (!foundationPromise) {
    foundationPromise = ensureEquipmentSalesSchema().catch((error) => {
      foundationPromise = null;
      throw error;
    });
  }
  return foundationPromise;
}

function dispatchEquipmentSalesRouter(req, res, next) {
  const originalUrl = req.url;
  req.url = req.url.replace(/^\/sales(?=\/|\?|$)/, "") || "/";

  return equipmentFinanceIndependentRoutes(req, res, (independentError) => {
    if (independentError) {
      req.url = originalUrl;
      return next(independentError);
    }

    return equipmentSalesRoutes(req, res, (error) => {
      req.url = originalUrl;
      return next(error);
    });
  });
}

function decodeProtectedPhoto(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)$/i
  );

  if (!match) {
    const error = new Error("The protected equipment picture is invalid.");
    error.code = "INVALID_EQUIPMENT_PHOTO";
    throw error;
  }

  const mimeType = match[1].toLowerCase();
  if (!mimeType.startsWith("image/")) {
    const error = new Error("Choose a supported image picture.");
    error.code = "INVALID_EQUIPMENT_PHOTO_TYPE";
    throw error;
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    const error = new Error("The protected equipment picture is empty.");
    error.code = "EMPTY_EQUIPMENT_PHOTO";
    throw error;
  }
  if (buffer.length > MAX_PROTECTED_PHOTO_BYTES) {
    const error = new Error(
      "The prepared equipment picture is too large. Choose it again so Chalin can compress it."
    );
    error.code = "EQUIPMENT_PHOTO_TOO_LARGE";
    throw error;
  }

  const normalizedDataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  if (Buffer.byteLength(normalizedDataUrl, "utf8") > 300000) {
    const error = new Error(
      "The protected equipment picture exceeds safe storage size."
    );
    error.code = "EQUIPMENT_PHOTO_STORAGE_LIMIT";
    throw error;
  }

  return {
    buffer,
    mimeType,
    dataUrl: normalizedDataUrl,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
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

async function handleSecurePhotoUpload(req, res, match) {
  if (!userHasPermission(req, "fleet.assets.manage")) {
    return sendValidationError(
      res,
      "Your account cannot add equipment pictures.",
      "FLEET_ASSET_MANAGE_PERMISSION_REQUIRED",
      403
    );
  }

  let scope;
  try {
    scope = await resolveHireLocationScope(req, { requireSelection: true });
  } catch (error) {
    if (sendHireLocationScopeError(res, error)) return undefined;
    throw error;
  }

  const assetId = Number(match[1]);
  const evidenceType = normalizeEnum(req.body?.evidence_type) || "other";
  const isPrimary = parseBoolean(req.body?.is_primary, evidenceType === "main");
  const caption = cleanText(req.body?.caption, 500) || null;
  const fileName = cleanText(req.body?.file_name, 255) || "equipment-photo.webp";

  if (!Number.isInteger(assetId) || assetId <= 0) {
    return sendValidationError(res, "Invalid equipment ID.", "INVALID_EQUIPMENT_ID");
  }
  if (!VALID_EVIDENCE_TYPES.has(evidenceType)) {
    return sendValidationError(
      res,
      "Choose a valid equipment picture type.",
      "INVALID_EQUIPMENT_EVIDENCE_TYPE"
    );
  }

  let upload;
  try {
    upload = decodeProtectedPhoto(req.body?.file_url);
  } catch (error) {
    return sendValidationError(
      res,
      error.message,
      error.code || "INVALID_EQUIPMENT_PHOTO"
    );
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [assetRows] = await connection.query(
      `SELECT id, asset_code, asset_name, hire_location_id
       FROM fleet_assets
       WHERE id = ? AND hire_location_id = ? AND is_active = TRUE
       LIMIT 1 FOR UPDATE`,
      [assetId, scope.locationId]
    );
    const asset = assetRows[0];
    if (!asset) {
      await connection.rollback();
      return sendValidationError(
        res,
        "Equipment record was not found in the selected Hire location.",
        "EQUIPMENT_NOT_FOUND",
        404
      );
    }

    if (isPrimary) {
      await connection.query(
        `UPDATE equipment_media
         SET is_primary = FALSE
         WHERE asset_id = ? AND archived_at IS NULL`,
        [assetId]
      );
    }

    const [result] = await connection.query(
      `INSERT INTO equipment_media (
         asset_id, hire_location_id, media_category, evidence_type,
         file_url, storage_key, thumbnail_url, file_name, mime_type,
         file_size_bytes, caption, is_primary, sort_order, captured_at, created_by
       ) VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), ?)`,
      [
        assetId,
        scope.locationId,
        evidenceType,
        upload.dataUrl,
        `database-data-url:${upload.checksum}`,
        upload.dataUrl,
        fileName,
        upload.mimeType,
        upload.buffer.length,
        caption,
        isPrimary,
        req.user?.id || null,
      ]
    );

    if (isPrimary) {
      await connection.query(
        `UPDATE fleet_assets
         SET main_image_url = ?, updated_by = ?
         WHERE id = ?`,
        [upload.dataUrl, req.user?.id || null, assetId]
      );
    }

    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_SECURE_PHOTO_UPLOADED",
      actionType: "equipment.photo.secure_upload",
      entityType: "fleet_asset",
      entityId: assetId,
      workspaceCode: "equipment_hire",
      hireLocationId: scope.locationId,
      severity: "notice",
      outcome: "success",
      details: `Protected ${evidenceType.replaceAll("_", " ")} picture added to ${asset.asset_code} - ${asset.asset_name}.`,
      metadata: {
        media_id: result.insertId,
        checksum_sha256: upload.checksum,
        file_size_bytes: upload.buffer.length,
        mime_type: upload.mimeType,
        is_primary: isPrimary,
      },
    });

    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: isPrimary
        ? "Equipment picture saved securely and selected as the main image."
        : "Equipment picture saved securely.",
      media: {
        id: result.insertId,
        asset_id: assetId,
        hire_location_id: scope.locationId,
        media_category: "photo",
        evidence_type: evidenceType,
        file_url: upload.dataUrl,
        thumbnail_url: upload.dataUrl,
        file_name: fileName,
        mime_type: upload.mimeType,
        file_size_bytes: upload.buffer.length,
        caption,
        is_primary: isPrimary,
        checksum_sha256: upload.checksum,
      },
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    console.error("Secure equipment photo upload error:", error);
    return res.status(500).json({
      status: "error",
      code: "EQUIPMENT_SECURE_PHOTO_UPLOAD_FAILED",
      message: "The equipment picture could not be stored securely.",
    });
  } finally {
    connection.release();
  }
}

async function enforceEquipmentCatalogueWriteIntegrity(req, res, next) {
  if (isDepositReservationRequest(req)) {
    return dispatchEquipmentSalesRouter(req, res, next);
  }

  try {
    await ensureFoundationOnce();
  } catch (error) {
    console.error("Equipment Sales foundation preparation failed:", error);
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_SALES_FOUNDATION_STARTUP_FAILED",
      message:
        "Equipment Sales could not be prepared safely. Existing Hire and Spare Parts operations remain available.",
    });
  }

  if (isEquipmentSalesRequest(req)) {
    return dispatchEquipmentSalesRouter(req, res, next);
  }

  const uploadMatch = securePhotoUploadMatch(req);
  if (uploadMatch) {
    return handleSecurePhotoUpload(req, res, uploadMatch);
  }

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
