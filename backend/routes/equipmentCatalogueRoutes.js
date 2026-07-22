const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  resolveHireLocationScope,
  appendHireLocationFilter,
  assertRecordInHireLocation,
  sendHireLocationScopeError,
} = require("../services/hireLocationScope");

const router = express.Router();

const ASSET_STATUSES = new Set([
  "available",
  "assigned_mining",
  "assigned_hire",
  "mobilizing",
  "working",
  "idle",
  "maintenance",
  "breakdown",
  "retired",
  "sold",
]);
const CONDITION_STATUSES = new Set([
  "new",
  "excellent",
  "good",
  "fair",
  "poor",
  "damaged",
  "under_inspection",
]);
const OPERATIONAL_PURPOSES = new Set([
  "hire_only",
  "sale_only",
  "sale_or_hire",
  "company_operations",
]);
const SALE_STATUSES = new Set([
  "not_for_sale",
  "available",
  "reserved",
  "installment_active",
  "sold",
  "cancelled",
]);
const OWNERSHIP_TYPES = new Set([
  "company_owned",
  "leased",
  "financed",
  "third_party",
  "other",
]);
const METER_TYPES = new Set(["hour_meter", "odometer"]);
const MEDIA_CATEGORIES = new Set(["photo", "video", "document"]);
const EVIDENCE_TYPES = new Set([
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
const ACTIVE_HIRE_STATUSES = ["assigned", "dispatched", "active"];
const ACTIVE_SALE_LOCK_STATUSES = ["reserved", "installment_active", "sold"];

function cleanText(value, maxLength = 255) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value, fallback = null, decimals = 2) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Number(number.toFixed(decimals));
}

function nonNegativeInteger(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function optionalBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  const cleaned = cleanText(value, 10).toLowerCase();
  if (["true", "yes", "on"].includes(cleaned)) return true;
  if (["false", "no", "off"].includes(cleaned)) return false;
  return null;
}

function optionalDate(value) {
  const text = cleanText(value, 20);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function optionalDateTime(value) {
  const text = cleanText(value, 50);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function optionalUrl(value, maxLength = 3000) {
  const text = cleanText(value, maxLength);
  if (!text) return null;

  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    return parsed.toString().slice(0, maxLength);
  } catch {
    return undefined;
  }
}

function isEquipmentFoundationError(error) {
  return [
    "ER_NO_SUCH_TABLE",
    "ER_BAD_FIELD_ERROR",
    "ER_SP_DOES_NOT_EXIST",
  ].includes(error?.code);
}

function sendEquipmentFoundationError(res, error) {
  if (!isEquipmentFoundationError(error)) return false;

  res.status(503).json({
    status: "error",
    code: "EQUIPMENT_SALES_FOUNDATION_REQUIRED",
    message:
      "The Equipment Sales & Hire foundation migration has not been applied to this database.",
  });
  return true;
}

function normalizeEnum(value, allowed, fallback = null) {
  const cleaned = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (!cleaned) return fallback;
  return allowed.has(cleaned) ? cleaned : undefined;
}

function normalizeAssetPayload(body, { partial = false } = {}) {
  const payload = {};
  const errors = [];

  function setRequiredText(column, source, maxLength, label, transform = (value) => value) {
    if (partial && source === undefined) return;
    const cleaned = transform(cleanText(source, maxLength));
    if (!cleaned) errors.push(`${label} is required.`);
    payload[column] = cleaned;
  }

  function setOptionalText(column, source, maxLength) {
    if (partial && source === undefined) return;
    payload[column] = nullableText(source, maxLength);
  }

  setRequiredText(
    "asset_code",
    body.asset_code,
    50,
    "Equipment code",
    (value) => value.toUpperCase()
  );
  setRequiredText("asset_name", body.asset_name, 150, "Equipment name");
  setRequiredText(
    "asset_type",
    body.asset_type,
    60,
    "Equipment type",
    (value) => value.replace(/\s+/g, " ")
  );

  setOptionalText("equipment_category", body.equipment_category, 80);
  setOptionalText("make", body.make, 100);
  setOptionalText("model", body.model, 100);
  setOptionalText("serial_number", body.serial_number, 120);
  setOptionalText("chassis_number", body.chassis_number, 120);
  setOptionalText("engine_number", body.engine_number, 120);
  setOptionalText("registration_number", body.registration_number, 80);
  setOptionalText("colour", body.colour, 60);
  setOptionalText("capacity_description", body.capacity_description, 120);
  setOptionalText("supplier_name", body.supplier_name, 150);
  setOptionalText("acquisition_reference", body.acquisition_reference, 120);
  setOptionalText("assigned_operator_name", body.assigned_operator_name, 150);
  setOptionalText("fuel_type", body.fuel_type, 50);
  setOptionalText("notes", body.notes, 5000);

  if (!partial || body.model_year !== undefined) {
    const modelYear = nonNegativeInteger(body.model_year, null);
    const maximumYear = new Date().getUTCFullYear() + 1;
    if (
      body.model_year !== undefined &&
      body.model_year !== "" &&
      (modelYear === null || modelYear < 1950 || modelYear > maximumYear)
    ) {
      errors.push(`Model year must be between 1950 and ${maximumYear}.`);
    }
    payload.model_year = modelYear;
  }

  for (const [column, source, allowed, fallback, label] of [
    ["condition_status", body.condition_status, CONDITION_STATUSES, "good", "condition"],
    [
      "operational_purpose",
      body.operational_purpose,
      OPERATIONAL_PURPOSES,
      "hire_only",
      "operating purpose",
    ],
    ["current_status", body.current_status, ASSET_STATUSES, "available", "equipment status"],
    ["sale_status", body.sale_status, SALE_STATUSES, "not_for_sale", "sale status"],
    ["ownership_type", body.ownership_type, OWNERSHIP_TYPES, "company_owned", "ownership type"],
    ["meter_type", body.meter_type, METER_TYPES, "hour_meter", "meter type"],
  ]) {
    if (partial && source === undefined) continue;
    const normalized = normalizeEnum(source, allowed, fallback);
    if (normalized === undefined) errors.push(`Invalid ${label}.`);
    payload[column] = normalized;
  }

  for (const [column, source, fallback, label] of [
    ["current_meter", body.current_meter, 0, "Current meter"],
    ["service_interval", body.service_interval, null, "Service interval"],
    ["next_service_meter", body.next_service_meter, null, "Next service meter"],
    ["acquisition_cost", body.acquisition_cost, 0, "Acquisition cost"],
    ["target_selling_price", body.target_selling_price, 0, "Target selling price"],
    ["standard_hire_rate", body.standard_hire_rate, 0, "Standard hire rate"],
  ]) {
    if (partial && source === undefined) continue;
    const number = nonNegativeNumber(source, fallback);
    if (number === null && source !== undefined && source !== null && source !== "") {
      errors.push(`${label} must be zero or greater.`);
    }
    payload[column] = number;
  }

  for (const [column, source, label] of [
    ["insurance_expiry", body.insurance_expiry, "Insurance expiry"],
    ["registration_expiry", body.registration_expiry, "Registration expiry"],
    ["acquisition_date", body.acquisition_date, "Acquisition date"],
  ]) {
    if (partial && source === undefined) continue;
    const date = optionalDate(source);
    if (date === undefined) errors.push(`${label} must be a valid YYYY-MM-DD date.`);
    payload[column] = date;
  }

  if (!partial || body.sale_reserved_until !== undefined) {
    const dateTime = optionalDateTime(body.sale_reserved_until);
    if (dateTime === undefined) {
      errors.push("Sale reservation expiry must be a valid date and time.");
    }
    payload.sale_reserved_until = dateTime;
  }

  if (!partial || body.main_image_url !== undefined) {
    const imageUrl = optionalUrl(body.main_image_url);
    if (imageUrl === undefined) {
      errors.push("Main image URL must use http or https.");
    }
    payload.main_image_url = imageUrl;
  }

  const purpose = payload.operational_purpose;
  const saleStatus = payload.sale_status;
  const currentStatus = payload.current_status;

  if (
    purpose &&
    ["hire_only", "company_operations"].includes(purpose) &&
    saleStatus &&
    saleStatus !== "not_for_sale"
  ) {
    errors.push("Hire-only or company equipment must use the not-for-sale status.");
  }

  if (
    purpose &&
    ["sale_only", "sale_or_hire"].includes(purpose) &&
    saleStatus === "not_for_sale"
  ) {
    payload.sale_status = "available";
  }

  if (currentStatus === "sold" && payload.sale_status !== "sold") {
    errors.push("A sold operating status requires the sold sale status.");
  }

  return { payload, errors };
}

function buildDynamicUpdate(tableName, payload, whereColumn = "id") {
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
  if (!entries.length) return null;

  return {
    sql: `UPDATE ${tableName} SET ${entries
      .map(([column]) => `\`${column}\` = ?`)
      .join(", ")} WHERE \`${whereColumn}\` = ?`,
    values: entries.map(([, value]) => value),
  };
}

async function attachHireLocationScope(req, res, next) {
  try {
    req.hireLocationScope = await resolveHireLocationScope(req, {
      requireSelection: false,
    });
    return next();
  } catch (error) {
    if (sendHireLocationScopeError(res, error)) return;
    return next(error);
  }
}

function requireSelectedLocation(req, res, next) {
  if (!req.hireLocationScope?.locationId) {
    return res.status(400).json({
      status: "error",
      code: "HIRE_LOCATION_REQUIRED",
      message: "Choose an Equipment Hire location before changing equipment records.",
    });
  }
  return next();
}

async function getAssetById(assetId, scope, connection = pool, { forUpdate = false } = {}) {
  const params = [assetId];
  const locationSql = scope?.locationId ? "AND fa.hire_location_id = ?" : "";
  if (scope?.locationId) params.push(scope.locationId);

  const [rows] = await connection.query(
    `SELECT
       fa.*,
       bl.code AS hire_location_code,
       bl.name AS hire_location_name,
       bl.address AS hire_location_address,
       creator.full_name AS created_by_name,
       updater.full_name AS updated_by_name,
       easl.lock_status AS active_sale_lock_status,
       easl.agreement_id AS active_sale_agreement_id,
       easl.expires_at AS active_sale_lock_expires_at,
       (
         SELECT COUNT(*)
         FROM hire_contract_assets hca
         WHERE hca.asset_id = fa.id
           AND hca.status IN ('assigned', 'dispatched', 'active')
       ) AS active_hire_assignment_count
     FROM fleet_assets fa
     LEFT JOIN business_locations bl ON bl.id = fa.hire_location_id
     LEFT JOIN users creator ON creator.id = fa.created_by
     LEFT JOIN users updater ON updater.id = fa.updated_by
     LEFT JOIN equipment_asset_sale_locks easl
       ON easl.asset_id = fa.id
      AND easl.released_at IS NULL
     WHERE fa.id = ?
       ${locationSql}
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    params
  );

  return rows[0] || null;
}

async function audit(req, connection, action, assetId, details, metadata = {}) {
  await writeAuditEvent({
    connection,
    req,
    action,
    details,
    workspaceCode: "equipment_hire",
    hireLocationId: req.hireLocationScope?.locationId || null,
    entityType: "fleet_asset",
    entityId: assetId,
    actionType: action,
    outcome: "success",
    severity: action.includes("ARCHIVE") || action.includes("PURPOSE") ? "notice" : "info",
    metadata,
  });
}

router.use(requireAuth, attachHireLocationScope);

router.get(
  "/summary",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const where = ["fa.is_active = TRUE"];
      const params = [];
      appendHireLocationFilter(where, params, "fa", req.hireLocationScope);

      const [rows] = await pool.query(
        `SELECT
           COUNT(*) AS total_assets,
           SUM(CASE WHEN fa.operational_purpose = 'hire_only' THEN 1 ELSE 0 END) AS hire_only_assets,
           SUM(CASE WHEN fa.operational_purpose = 'sale_only' THEN 1 ELSE 0 END) AS sale_only_assets,
           SUM(CASE WHEN fa.operational_purpose = 'sale_or_hire' THEN 1 ELSE 0 END) AS sale_or_hire_assets,
           SUM(CASE WHEN fa.operational_purpose = 'company_operations' THEN 1 ELSE 0 END) AS company_assets,
           SUM(CASE WHEN fa.sale_status = 'available' THEN 1 ELSE 0 END) AS available_for_sale,
           SUM(CASE WHEN fa.sale_status IN ('reserved', 'installment_active') THEN 1 ELSE 0 END) AS sale_reserved_assets,
           SUM(CASE WHEN fa.current_status IN ('available', 'idle') THEN 1 ELSE 0 END) AS operationally_available,
           SUM(CASE WHEN fa.current_status IN ('maintenance', 'breakdown') THEN 1 ELSE 0 END) AS unavailable_assets,
           SUM(CASE WHEN fa.main_image_url IS NOT NULL AND fa.main_image_url <> '' THEN 1 ELSE 0 END) AS assets_with_main_image,
           COALESCE(SUM(fa.acquisition_cost), 0) AS total_acquisition_cost,
           COALESCE(SUM(CASE WHEN fa.sale_status = 'available' THEN fa.target_selling_price ELSE 0 END), 0) AS available_sale_value
         FROM fleet_assets fa
         WHERE ${where.join(" AND ")}`,
        params
      );

      return res.json({
        status: "success",
        hire_location: req.hireLocationScope?.location || null,
        all_locations: Boolean(req.hireLocationScope?.allLocations),
        summary: rows[0] || {},
      });
    } catch (error) {
      console.error("Equipment catalogue summary error:", error);
      if (sendEquipmentFoundationError(res, error)) return;
      return res.status(500).json({
        status: "error",
        message: "Could not load the equipment catalogue summary.",
      });
    }
  }
);

router.get(
  "/reference",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const where = ["fa.is_active = TRUE"];
      const params = [];
      appendHireLocationFilter(where, params, "fa", req.hireLocationScope);

      const [rows] = await pool.query(
        `SELECT DISTINCT
           fa.asset_type,
           fa.equipment_category,
           fa.make,
           fa.model
         FROM fleet_assets fa
         WHERE ${where.join(" AND ")}
         ORDER BY fa.asset_type, fa.make, fa.model`,
        params
      );

      return res.json({
        status: "success",
        asset_types: [...new Set(rows.map((row) => row.asset_type).filter(Boolean))],
        equipment_categories: [
          ...new Set(rows.map((row) => row.equipment_category).filter(Boolean)),
        ],
        makes: [...new Set(rows.map((row) => row.make).filter(Boolean))],
        models: [...new Set(rows.map((row) => row.model).filter(Boolean))],
        purposes: [...OPERATIONAL_PURPOSES],
        conditions: [...CONDITION_STATUSES],
        sale_statuses: [...SALE_STATUSES],
        media_categories: [...MEDIA_CATEGORIES],
        evidence_types: [...EVIDENCE_TYPES],
      });
    } catch (error) {
      console.error("Equipment reference data error:", error);
      if (sendEquipmentFoundationError(res, error)) return;
      return res.status(500).json({
        status: "error",
        message: "Could not load equipment reference values.",
      });
    }
  }
);

router.get(
  "/assets",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const search = cleanText(req.query.search, 120);
      const purpose = normalizeEnum(req.query.purpose, OPERATIONAL_PURPOSES, null);
      const saleStatus = normalizeEnum(req.query.sale_status, SALE_STATUSES, null);
      const currentStatus = normalizeEnum(req.query.current_status, ASSET_STATUSES, null);
      const condition = normalizeEnum(req.query.condition_status, CONDITION_STATUSES, null);
      const includeInactive = optionalBoolean(req.query.include_inactive, false);
      const page = Math.max(1, positiveId(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(10, positiveId(req.query.page_size) || 30));
      const offset = (page - 1) * pageSize;

      if (
        purpose === undefined ||
        saleStatus === undefined ||
        currentStatus === undefined ||
        condition === undefined ||
        includeInactive === null
      ) {
        return res.status(400).json({
          status: "error",
          message: "One or more equipment filters are invalid.",
        });
      }

      const where = [];
      const params = [];
      if (!includeInactive) where.push("fa.is_active = TRUE");
      appendHireLocationFilter(where, params, "fa", req.hireLocationScope);

      if (search) {
        const value = `%${search}%`;
        where.push(`(
          fa.asset_code LIKE ? OR fa.asset_name LIKE ? OR fa.asset_type LIKE ?
          OR fa.equipment_category LIKE ? OR fa.make LIKE ? OR fa.model LIKE ?
          OR fa.serial_number LIKE ? OR fa.chassis_number LIKE ?
          OR fa.engine_number LIKE ? OR fa.registration_number LIKE ?
        )`);
        params.push(...Array(10).fill(value));
      }
      if (purpose) {
        where.push("fa.operational_purpose = ?");
        params.push(purpose);
      }
      if (saleStatus) {
        where.push("fa.sale_status = ?");
        params.push(saleStatus);
      }
      if (currentStatus) {
        where.push("fa.current_status = ?");
        params.push(currentStatus);
      }
      if (condition) {
        where.push("fa.condition_status = ?");
        params.push(condition);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total FROM fleet_assets fa ${whereSql}`,
        params
      );
      const [assets] = await pool.query(
        `SELECT
           fa.*,
           bl.code AS hire_location_code,
           bl.name AS hire_location_name,
           easl.lock_status AS active_sale_lock_status,
           easl.agreement_id AS active_sale_agreement_id,
           (
             SELECT COUNT(*)
             FROM hire_contract_assets hca
             WHERE hca.asset_id = fa.id
               AND hca.status IN ('assigned', 'dispatched', 'active')
           ) AS active_hire_assignment_count,
           (
             SELECT COUNT(*)
             FROM equipment_media em
             WHERE em.asset_id = fa.id
               AND em.archived_at IS NULL
           ) AS media_count
         FROM fleet_assets fa
         LEFT JOIN business_locations bl ON bl.id = fa.hire_location_id
         LEFT JOIN equipment_asset_sale_locks easl
           ON easl.asset_id = fa.id
          AND easl.released_at IS NULL
         ${whereSql}
         ORDER BY
           CASE fa.current_status
             WHEN 'available' THEN 1
             WHEN 'idle' THEN 2
             WHEN 'working' THEN 3
             WHEN 'maintenance' THEN 4
             WHEN 'breakdown' THEN 5
             WHEN 'retired' THEN 6
             WHEN 'sold' THEN 7
             ELSE 8
           END,
           fa.asset_name,
           fa.asset_code
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      const total = Number(countRows[0]?.total || 0);
      return res.json({
        status: "success",
        hire_location: req.hireLocationScope?.location || null,
        all_locations: Boolean(req.hireLocationScope?.allLocations),
        count: assets.length,
        total,
        page,
        page_size: pageSize,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
        assets,
      });
    } catch (error) {
      console.error("Equipment catalogue list error:", error);
      if (sendEquipmentFoundationError(res, error)) return;
      return res.status(500).json({
        status: "error",
        message: "Could not load the equipment catalogue.",
      });
    }
  }
);

router.get(
  "/assets/:id",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const assetId = positiveId(req.params.id);
      if (!assetId) {
        return res.status(400).json({ status: "error", message: "Invalid equipment ID." });
      }

      const asset = await getAssetById(assetId, req.hireLocationScope);
      if (!asset) {
        return res.status(404).json({
          status: "error",
          message: "Equipment record was not found in the selected location.",
        });
      }

      const [media] = await pool.query(
        `SELECT
           em.*,
           creator.full_name AS created_by_name,
           archiver.full_name AS archived_by_name
         FROM equipment_media em
         LEFT JOIN users creator ON creator.id = em.created_by
         LEFT JOIN users archiver ON archiver.id = em.archived_by
         WHERE em.asset_id = ?
         ORDER BY em.archived_at IS NOT NULL, em.is_primary DESC, em.sort_order, em.id`,
        [assetId]
      );

      return res.json({
        status: "success",
        asset,
        media,
        safeguards: {
          active_hire: Number(asset.active_hire_assignment_count || 0) > 0,
          active_sale_lock: Boolean(asset.active_sale_lock_status),
          can_enter_sale:
            Number(asset.active_hire_assignment_count || 0) === 0 &&
            ["sale_only", "sale_or_hire"].includes(asset.operational_purpose) &&
            !["sold", "cancelled"].includes(asset.sale_status),
          can_enter_hire:
            !asset.active_sale_lock_status &&
            asset.operational_purpose !== "sale_only" &&
            !["reserved", "installment_active", "sold"].includes(asset.sale_status),
        },
      });
    } catch (error) {
      console.error("Equipment catalogue detail error:", error);
      if (sendEquipmentFoundationError(res, error)) return;
      return res.status(500).json({
        status: "error",
        message: "Could not load the equipment record.",
      });
    }
  }
);

router.post(
  "/assets",
  requirePermission("fleet.assets.manage"),
  requireSelectedLocation,
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      const { payload, errors } = normalizeAssetPayload(req.body);
      if (errors.length) {
        return res.status(400).json({ status: "error", message: errors.join(" ") });
      }

      if (payload.current_status === "sold" || payload.sale_status === "sold") {
        return res.status(400).json({
          status: "error",
          message: "New equipment cannot be registered as sold. Complete a sale and ownership transfer instead.",
        });
      }

      await connection.beginTransaction();
      transactionStarted = true;

      const identityChecks = [
        ["asset_code", payload.asset_code],
        ["serial_number", payload.serial_number],
        ["chassis_number", payload.chassis_number],
        ["engine_number", payload.engine_number],
      ].filter(([, value]) => value);

      for (const [column, value] of identityChecks) {
        const [duplicates] = await connection.query(
          `SELECT id FROM fleet_assets WHERE \`${column}\` = ? LIMIT 1 FOR UPDATE`,
          [value]
        );
        if (duplicates.length) {
          await connection.rollback();
          transactionStarted = false;
          return res.status(409).json({
            status: "error",
            message: `Another equipment record already uses this ${column.replaceAll("_", " ")}.`,
          });
        }
      }

      const locationName =
        payload.current_location ||
        req.hireLocationScope.location?.name ||
        req.hireLocationScope.location?.address ||
        null;

      const [result] = await connection.query(
        `INSERT INTO fleet_assets (
           asset_code, asset_name, asset_type, equipment_category,
           make, model, model_year, serial_number, chassis_number, engine_number,
           registration_number, colour, capacity_description, condition_status,
           ownership_type, operational_purpose, current_status, sale_status,
           current_location, hire_location_id, assigned_operator_name,
           meter_type, current_meter, fuel_type, service_interval, next_service_meter,
           insurance_expiry, registration_expiry, acquisition_date, acquisition_cost,
           target_selling_price, standard_hire_rate, supplier_name,
           acquisition_reference, main_image_url, sale_reserved_until,
           notes, is_active, created_by, updated_by
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?
         )`,
        [
          payload.asset_code,
          payload.asset_name,
          payload.asset_type,
          payload.equipment_category,
          payload.make,
          payload.model,
          payload.model_year,
          payload.serial_number,
          payload.chassis_number,
          payload.engine_number,
          payload.registration_number,
          payload.colour,
          payload.capacity_description,
          payload.condition_status,
          payload.ownership_type,
          payload.operational_purpose,
          payload.current_status,
          payload.sale_status,
          locationName,
          req.hireLocationScope.locationId,
          payload.assigned_operator_name,
          payload.meter_type,
          payload.current_meter,
          payload.fuel_type,
          payload.service_interval,
          payload.next_service_meter,
          payload.insurance_expiry,
          payload.registration_expiry,
          payload.acquisition_date,
          payload.acquisition_cost,
          payload.target_selling_price,
          payload.standard_hire_rate,
          payload.supplier_name,
          payload.acquisition_reference,
          payload.main_image_url,
          payload.sale_reserved_until,
          payload.notes,
          req.user?.id || null,
          req.user?.id || null,
        ]
      );

      if (Number(payload.current_meter || 0) > 0) {
        await connection.query(
          `INSERT INTO fleet_meter_readings (
             asset_id, reading_value, reading_datetime, source_type, notes, recorded_by
           ) VALUES (?, ?, NOW(), 'opening_register',
             'Opening meter recorded when equipment was added to Equipment Sales & Hire.', ?)` ,
          [result.insertId, payload.current_meter, req.user?.id || null]
        );
      }

      if (payload.main_image_url) {
        await connection.query(
          `INSERT INTO equipment_media (
             asset_id, hire_location_id, media_category, evidence_type,
             file_url, caption, is_primary, sort_order, created_by
           ) VALUES (?, ?, 'photo', 'main', ?, 'Main equipment image', TRUE, 0, ?)`,
          [
            result.insertId,
            req.hireLocationScope.locationId,
            payload.main_image_url,
            req.user?.id || null,
          ]
        );
      }

      await audit(
        req,
        connection,
        "EQUIPMENT_CATALOGUE_ASSET_CREATED",
        result.insertId,
        `Created ${payload.asset_code} - ${payload.asset_name} for ${req.hireLocationScope.location?.name || "the selected Equipment Hire location"}.`,
        {
          operational_purpose: payload.operational_purpose,
          sale_status: payload.sale_status,
          current_status: payload.current_status,
        }
      );

      await connection.commit();
      transactionStarted = false;

      const asset = await getAssetById(
        result.insertId,
        req.hireLocationScope
      );
      return res.status(201).json({
        status: "success",
        message: "Equipment added to the shared Sales & Hire catalogue.",
        asset,
      });
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      console.error("Equipment catalogue create error:", error);
      if (sendEquipmentFoundationError(res, error)) return;
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message: "The equipment code or identity number is already in use.",
        });
      }
      return res.status(500).json({
        status: "error",
        message: "Could not create the equipment record.",
      });
    } finally {
      connection.release();
    }
  }
);

router.put(
  "/assets/:id",
  requirePermission("fleet.assets.manage"),
  requireSelectedLocation,
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      const assetId = positiveId(req.params.id);
      if (!assetId) {
        return res.status(400).json({ status: "error", message: "Invalid equipment ID." });
      }

      const { payload, errors } = normalizeAssetPayload(req.body, { partial: true });
      if (errors.length) {
        return res.status(400).json({ status: "error", message: errors.join(" ") });
      }
      if (!Object.keys(payload).length) {
        return res.status(400).json({
          status: "error",
          message: "Provide at least one equipment field to update.",
        });
      }

      await connection.beginTransaction();
      transactionStarted = true;
      const existing = await getAssetById(assetId, req.hireLocationScope, connection, {
        forUpdate: true,
      });
      if (!existing) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({
          status: "error",
          message: "Equipment record was not found in the selected location.",
        });
      }
      assertRecordInHireLocation(
        req.hireLocationScope,
        existing.hire_location_id,
        "Equipment record"
      );

      const activeHire = Number(existing.active_hire_assignment_count || 0) > 0;
      const activeSaleLock = Boolean(existing.active_sale_lock_status);
      const nextPurpose = payload.operational_purpose ?? existing.operational_purpose;
      const nextSaleStatus = payload.sale_status ?? existing.sale_status;
      const nextCurrentStatus = payload.current_status ?? existing.current_status;

      if (
        activeHire &&
        (nextPurpose === "sale_only" ||
          ["reserved", "installment_active", "sold"].includes(nextSaleStatus))
      ) {
        return res.status(409).json({
          status: "error",
          code: "EQUIPMENT_ACTIVE_ON_HIRE",
          message:
            "This equipment is active on Hire and cannot be changed to sale-only, reserved, installment-active or sold.",
        });
      }

      if (
        activeSaleLock &&
        (nextPurpose === "hire_only" ||
          ["assigned_hire", "mobilizing", "working"].includes(nextCurrentStatus) ||
          nextSaleStatus === "not_for_sale")
      ) {
        return res.status(409).json({
          status: "error",
          code: "EQUIPMENT_ACTIVE_SALE_LOCK",
          message:
            "This equipment has an active sale reservation or agreement and cannot be moved back into Hire operations.",
        });
      }

      if (nextCurrentStatus === "sold" && nextSaleStatus !== "sold") {
        return res.status(400).json({
          status: "error",
          message: "A sold operating status requires a completed equipment sale.",
        });
      }

      for (const [column, value] of [
        ["asset_code", payload.asset_code],
        ["serial_number", payload.serial_number],
        ["chassis_number", payload.chassis_number],
        ["engine_number", payload.engine_number],
      ].filter(([, value]) => value)) {
        const [duplicates] = await connection.query(
          `SELECT id FROM fleet_assets
           WHERE \`${column}\` = ? AND id <> ? LIMIT 1 FOR UPDATE`,
          [value, assetId]
        );
        if (duplicates.length) {
          return res.status(409).json({
            status: "error",
            message: `Another equipment record already uses this ${column.replaceAll("_", " ")}.`,
          });
        }
      }

      const oldMeter = Number(existing.current_meter || 0);
      if (
        payload.current_meter !== undefined &&
        payload.current_meter !== null &&
        Number(payload.current_meter) < oldMeter
      ) {
        return res.status(400).json({
          status: "error",
          message:
            "The current meter cannot be reduced here. Use a controlled meter correction with an audit reason.",
        });
      }

      payload.updated_by = req.user?.id || null;
      const update = buildDynamicUpdate("fleet_assets", payload);
      await connection.query(update.sql, [...update.values, assetId]);

      if (
        payload.current_meter !== undefined &&
        Number(payload.current_meter) > oldMeter
      ) {
        await connection.query(
          `INSERT INTO fleet_meter_readings (
             asset_id, reading_value, reading_datetime, source_type, notes, recorded_by
           ) VALUES (?, ?, NOW(), 'equipment_catalogue_edit',
             'Meter increased while the Equipment Sales & Hire record was edited.', ?)` ,
          [assetId, payload.current_meter, req.user?.id || null]
        );
      }

      await audit(
        req,
        connection,
        "EQUIPMENT_CATALOGUE_ASSET_UPDATED",
        assetId,
        `Updated ${existing.asset_code} - ${existing.asset_name}.`,
        {
          changed_fields: Object.keys(payload).filter((field) => field !== "updated_by"),
          previous_purpose: existing.operational_purpose,
          next_purpose: nextPurpose,
          previous_sale_status: existing.sale_status,
          next_sale_status: nextSaleStatus,
        }
      );

      await connection.commit();
      transactionStarted = false;
      const asset = await getAssetById(assetId, req.hireLocationScope);
      return res.json({
        status: "success",
        message: "Equipment record updated.",
        asset,
      });
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      console.error("Equipment catalogue update error:", error);
      if (sendHireLocationScopeError(res, error)) return;
      if (sendEquipmentFoundationError(res, error)) return;
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message: "The equipment code or identity number is already in use.",
        });
      }
      return res.status(500).json({
        status: "error",
        message: "Could not update the equipment record.",
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/assets/:id/media",
  requirePermission("fleet.assets.manage"),
  requireSelectedLocation,
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      const assetId = positiveId(req.params.id);
      if (!assetId) {
        return res.status(400).json({ status: "error", message: "Invalid equipment ID." });
      }

      const mediaCategory = normalizeEnum(
        req.body.media_category,
        MEDIA_CATEGORIES,
        "photo"
      );
      const evidenceType = normalizeEnum(
        req.body.evidence_type,
        EVIDENCE_TYPES,
        "other"
      );
      const fileUrl = optionalUrl(req.body.file_url);
      const thumbnailUrl = optionalUrl(req.body.thumbnail_url);
      const fileSize = nonNegativeInteger(req.body.file_size_bytes, null);
      const isPrimary = optionalBoolean(req.body.is_primary, evidenceType === "main");
      const sortOrder = nonNegativeInteger(req.body.sort_order, 0);

      const errors = [];
      if (mediaCategory === undefined) errors.push("Invalid media category.");
      if (evidenceType === undefined) errors.push("Invalid evidence type.");
      if (!fileUrl || fileUrl === undefined) errors.push("A valid http or https file URL is required.");
      if (thumbnailUrl === undefined) errors.push("Thumbnail URL must use http or https.");
      if (fileSize === null && req.body.file_size_bytes !== undefined && req.body.file_size_bytes !== "") {
        errors.push("File size must be zero or greater.");
      }
      if (isPrimary === null) errors.push("Primary-image flag is invalid.");
      if (isPrimary && mediaCategory !== "photo") {
        errors.push("Only a photo can be the primary equipment image.");
      }
      if (errors.length) {
        return res.status(400).json({ status: "error", message: errors.join(" ") });
      }

      await connection.beginTransaction();
      transactionStarted = true;
      const asset = await getAssetById(assetId, req.hireLocationScope, connection, {
        forUpdate: true,
      });
      if (!asset) {
        return res.status(404).json({
          status: "error",
          message: "Equipment record was not found in the selected location.",
        });
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assetId,
          req.hireLocationScope.locationId,
          mediaCategory,
          evidenceType,
          fileUrl,
          nullableText(req.body.storage_key, 500),
          thumbnailUrl,
          nullableText(req.body.file_name, 255),
          nullableText(req.body.mime_type, 120),
          fileSize,
          nullableText(req.body.caption, 500),
          Boolean(isPrimary),
          sortOrder,
          optionalDateTime(req.body.captured_at),
          req.user?.id || null,
        ]
      );

      if (isPrimary) {
        await connection.query(
          `UPDATE fleet_assets SET main_image_url = ?, updated_by = ? WHERE id = ?`,
          [fileUrl, req.user?.id || null, assetId]
        );
      }

      await audit(
        req,
        connection,
        "EQUIPMENT_MEDIA_ADDED",
        assetId,
        `Added ${evidenceType.replaceAll("_", " ")} ${mediaCategory} to ${asset.asset_code}.`,
        { media_id: result.insertId, evidence_type: evidenceType, is_primary: isPrimary }
      );

      await connection.commit();
      transactionStarted = false;
      const [rows] = await pool.query(
        `SELECT * FROM equipment_media WHERE id = ? LIMIT 1`,
        [result.insertId]
      );
      return res.status(201).json({
        status: "success",
        message: isPrimary
          ? "Equipment picture added and selected as the main image."
          : "Equipment media added.",
        media: rows[0] || null,
      });
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      console.error("Equipment media create error:", error);
      if (sendEquipmentFoundationError(res, error)) return;
      return res.status(500).json({
        status: "error",
        message: "Could not add equipment media.",
      });
    } finally {
      connection.release();
    }
  }
);

router.patch(
  "/assets/:id/media/:mediaId/primary",
  requirePermission("fleet.assets.manage"),
  requireSelectedLocation,
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      const assetId = positiveId(req.params.id);
      const mediaId = positiveId(req.params.mediaId);
      if (!assetId || !mediaId) {
        return res.status(400).json({
          status: "error",
          message: "Invalid equipment or media ID.",
        });
      }

      await connection.beginTransaction();
      transactionStarted = true;
      const asset = await getAssetById(assetId, req.hireLocationScope, connection, {
        forUpdate: true,
      });
      if (!asset) {
        return res.status(404).json({
          status: "error",
          message: "Equipment record was not found in the selected location.",
        });
      }

      const [mediaRows] = await connection.query(
        `SELECT * FROM equipment_media
         WHERE id = ? AND asset_id = ? AND media_category = 'photo'
           AND archived_at IS NULL
         LIMIT 1 FOR UPDATE`,
        [mediaId, assetId]
      );
      if (!mediaRows.length) {
        return res.status(404).json({
          status: "error",
          message: "Active equipment photo was not found.",
        });
      }

      await connection.query(
        `UPDATE equipment_media SET is_primary = FALSE
         WHERE asset_id = ? AND archived_at IS NULL`,
        [assetId]
      );
      await connection.query(
        `UPDATE equipment_media SET is_primary = TRUE WHERE id = ?`,
        [mediaId]
      );
      await connection.query(
        `UPDATE fleet_assets SET main_image_url = ?, updated_by = ? WHERE id = ?`,
        [mediaRows[0].file_url, req.user?.id || null, assetId]
      );

      await audit(
        req,
        connection,
        "EQUIPMENT_MEDIA_PRIMARY_CHANGED",
        assetId,
        `Selected a new main image for ${asset.asset_code}.`,
        { media_id: mediaId }
      );
      await connection.commit();
      transactionStarted = false;

      return res.json({
        status: "success",
        message: "Main equipment image updated.",
        media_id: mediaId,
        main_image_url: mediaRows[0].file_url,
      });
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      console.error("Equipment primary media error:", error);
      if (sendEquipmentFoundationError(res, error)) return;
      return res.status(500).json({
        status: "error",
        message: "Could not change the main equipment image.",
      });
    } finally {
      connection.release();
    }
  }
);

router.patch(
  "/assets/:id/media/:mediaId/archive",
  requirePermission("fleet.assets.manage"),
  requireSelectedLocation,
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      const assetId = positiveId(req.params.id);
      const mediaId = positiveId(req.params.mediaId);
      const reason = nullableText(req.body.reason, 500);
      if (!assetId || !mediaId) {
        return res.status(400).json({
          status: "error",
          message: "Invalid equipment or media ID.",
        });
      }
      if (!reason) {
        return res.status(400).json({
          status: "error",
          message: "An archive reason is required.",
        });
      }

      await connection.beginTransaction();
      transactionStarted = true;
      const asset = await getAssetById(assetId, req.hireLocationScope, connection, {
        forUpdate: true,
      });
      if (!asset) {
        return res.status(404).json({
          status: "error",
          message: "Equipment record was not found in the selected location.",
        });
      }

      const [mediaRows] = await connection.query(
        `SELECT * FROM equipment_media
         WHERE id = ? AND asset_id = ? AND archived_at IS NULL
         LIMIT 1 FOR UPDATE`,
        [mediaId, assetId]
      );
      if (!mediaRows.length) {
        return res.status(404).json({
          status: "error",
          message: "Active equipment media was not found.",
        });
      }

      const media = mediaRows[0];
      await connection.query(
        `UPDATE equipment_media
         SET archived_at = NOW(), archived_by = ?, archive_reason = ?, is_primary = FALSE
         WHERE id = ?`,
        [req.user?.id || null, reason, mediaId]
      );

      let replacementImageUrl = asset.main_image_url;
      if (media.is_primary) {
        const [replacementRows] = await connection.query(
          `SELECT id, file_url
           FROM equipment_media
           WHERE asset_id = ? AND media_category = 'photo'
             AND archived_at IS NULL AND id <> ?
           ORDER BY evidence_type = 'main' DESC, sort_order, id
           LIMIT 1 FOR UPDATE`,
          [assetId, mediaId]
        );

        replacementImageUrl = replacementRows[0]?.file_url || null;
        if (replacementRows.length) {
          await connection.query(
            `UPDATE equipment_media SET is_primary = TRUE WHERE id = ?`,
            [replacementRows[0].id]
          );
        }
        await connection.query(
          `UPDATE fleet_assets SET main_image_url = ?, updated_by = ? WHERE id = ?`,
          [replacementImageUrl, req.user?.id || null, assetId]
        );
      }

      await audit(
        req,
        connection,
        "EQUIPMENT_MEDIA_ARCHIVED",
        assetId,
        `Archived equipment media for ${asset.asset_code}. Reason: ${reason}`,
        { media_id: mediaId, was_primary: Boolean(media.is_primary) }
      );
      await connection.commit();
      transactionStarted = false;

      return res.json({
        status: "success",
        message: "Equipment media archived. The evidence record remains in the audit history.",
        media_id: mediaId,
        main_image_url: replacementImageUrl,
      });
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      console.error("Equipment media archive error:", error);
      if (sendEquipmentFoundationError(res, error)) return;
      return res.status(500).json({
        status: "error",
        message: "Could not archive the equipment media.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
