const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  installFinanceImageCompatibility,
  normalizePhotoPayload,
} = require("../services/equipmentFinanceImageCompatibilityService");

// Install before the professional routes module is loaded by the parent router,
// so signatures and issued document downloads also receive PDF-safe images.
installFinanceImageCompatibility();

const {
  createFinanceMachine,
  machineLocations,
  updateFinanceMachine,
} = require("../services/equipmentFinanceMachineRegisterService");
const {
  listProfessionalMachines,
} = require("../services/equipmentFinanceProfessionalService");

const router = express.Router();

const EDIT_TEXT_FIELDS = new Set([
  "asset_code", "asset_name", "asset_type", "equipment_category", "make", "model",
  "serial_number", "chassis_number", "engine_number", "registration_number", "colour",
  "capacity_description", "supplier_name", "acquisition_reference", "customs_reference",
  "title_document_reference", "insurance_reference", "fuel_type", "notes",
]);
const EDIT_ENUM_FIELDS = {
  operational_purpose: new Set(["sale_only", "sale_or_hire"]),
  condition_status: new Set(["excellent", "good", "fair", "damaged", "under_inspection"]),
  ownership_type: new Set(["company_owned", "leased", "consignment", "customer_owned"]),
  meter_type: new Set(["hour_meter", "odometer"]),
};
const EDIT_NUMBER_FIELDS = new Set([
  "model_year", "current_meter", "acquisition_cost", "target_selling_price",
  "minimum_selling_price", "standard_hire_rate",
]);
const EDIT_DATE_FIELDS = new Set(["acquisition_date", "insurance_expiry", "registration_expiry"]);

function userId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanEditPayload(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const output = {};

  for (const field of EDIT_TEXT_FIELDS) {
    if (source[field] === undefined) continue;
    output[field] = String(source[field] ?? "").trim();
  }

  for (const [field, allowed] of Object.entries(EDIT_ENUM_FIELDS)) {
    if (source[field] === undefined || source[field] === null || source[field] === "") continue;
    const normalized = String(source[field]).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (allowed.has(normalized)) output[field] = normalized;
  }

  for (const field of EDIT_NUMBER_FIELDS) {
    if (source[field] === undefined || source[field] === null || source[field] === "") continue;
    const text = typeof source[field] === "string" ? source[field].replace(/,/g, "").trim() : source[field];
    const number = Number(text);
    if (Number.isFinite(number) && number >= 0) output[field] = number;
  }

  for (const field of EDIT_DATE_FIELDS) {
    if (source[field] === undefined || source[field] === null || source[field] === "") continue;
    const text = String(source[field]).trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) output[field] = text;
  }

  if (source.equipment_origin_location_id !== undefined) {
    const locationId = positiveId(source.equipment_origin_location_id);
    if (locationId) output.equipment_origin_location_id = locationId;
  }

  if (Array.isArray(source.photos)) output.photos = source.photos;
  return output;
}

function mergeWithExistingMachine(existing, cleaned, originalInput) {
  const merged = { ...cleaned };
  const fields = [
    ...EDIT_TEXT_FIELDS,
    ...Object.keys(EDIT_ENUM_FIELDS),
    ...EDIT_NUMBER_FIELDS,
    ...EDIT_DATE_FIELDS,
  ];
  for (const field of fields) {
    if (merged[field] !== undefined) continue;
    if (existing[field] !== undefined && existing[field] !== null) merged[field] = existing[field];
  }
  if (merged.model_year === undefined && existing.model_year !== undefined) merged.model_year = existing.model_year;
  if (merged.equipment_origin_location_id === undefined && existing.hire_location_id != null) {
    merged.equipment_origin_location_id = existing.hire_location_id;
  }
  if (!Array.isArray(merged.photos) && Array.isArray(originalInput?.photos)) merged.photos = originalInput.photos;
  return merged;
}

function sendError(res, error, fallback) {
  return res.status(Number(error.statusCode || 500)).json({
    status: "error",
    code: error.code || "EQUIPMENT_FINANCE_MACHINE_REGISTER_ERROR",
    message: error.message || fallback,
    ...(error.readiness ? { readiness: error.readiness } : {}),
  });
}

async function assertMachineStillEditable(assetId) {
  const id = positiveId(assetId);
  if (!id) {
    const error = new Error("Choose a valid excavator.");
    error.statusCode = 400;
    error.code = "INVALID_FINANCE_MACHINE";
    throw error;
  }
  const [rows] = await pool.query(
    `SELECT asset.id, asset.asset_code, asset.sale_status,
            (SELECT COUNT(*) FROM equipment_credit_applications application
             WHERE application.asset_id = asset.id
               AND application.application_status NOT IN ('declined','withdrawn')) AS active_application_count,
            (SELECT COUNT(*) FROM equipment_asset_sale_locks sale_lock
             WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL) AS active_sale_lock_count,
            (SELECT COUNT(*) FROM equipment_sale_agreements agreement
             WHERE agreement.asset_id = asset.id
               AND agreement.agreement_status NOT IN ('cancelled','completed')) AS active_agreement_count
     FROM fleet_assets asset
     WHERE asset.id = ?
     LIMIT 1`,
    [id]
  );
  const machine = rows[0];
  if (!machine) {
    const error = new Error("Excavator was not found.");
    error.statusCode = 404;
    error.code = "FINANCE_MACHINE_NOT_FOUND";
    throw error;
  }
  if (
    machine.sale_status !== "available" ||
    Number(machine.active_application_count || 0) > 0 ||
    Number(machine.active_sale_lock_count || 0) > 0 ||
    Number(machine.active_agreement_count || 0) > 0
  ) {
    const error = new Error(
      "This excavator has entered an installment application, reservation or agreement. Its protected identity and pricing can no longer be edited from the register."
    );
    error.statusCode = 409;
    error.code = "FINANCE_MACHINE_EDIT_LOCKED";
    throw error;
  }
  return machine;
}

router.get("/", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    const machines = await listProfessionalMachines({
      search: req.query.search,
      status: req.query.status,
      limit: req.query.limit,
    });
    return res.json({
      status: "success",
      count: machines.length,
      machines,
      image_policy: {
        crop: false,
        object_fit: "contain",
        protected_photo_limit_bytes: 48128,
        stored_formats: ["image/jpeg", "image/png"],
        legacy_webp_download_compatibility: true,
      },
    });
  } catch (error) {
    return sendError(res, error, "Could not load the Finance Machine Register.");
  }
});

router.get("/locations", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    const locations = await machineLocations();
    return res.json({ status: "success", locations });
  } catch (error) {
    return sendError(res, error, "Could not load equipment yards/locations.");
  }
});

router.post("/", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const input = await normalizePhotoPayload(req.body || {});
    const machine = await createFinanceMachine({
      input,
      userId: userId(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Excavator registered with its complete identity and uncropped, document-compatible photo evidence.",
      machine,
    });
  } catch (error) {
    return sendError(res, error, "Could not register the Finance machine.");
  }
});

router.put("/:assetId", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const existing = await assertMachineStillEditable(req.params.assetId);
    const cleanedPayload = cleanEditPayload(req.body || {});
    const mergedPayload = mergeWithExistingMachine(existing, cleanedPayload, req.body || {});
    const input = await normalizePhotoPayload(mergedPayload);
    const machine = await updateFinanceMachine({
      assetId: req.params.assetId,
      input,
      userId: userId(req),
      req,
    });
    return res.json({
      status: "success",
      message: "Finance machine identity and photo evidence updated.",
      machine,
    });
  } catch (error) {
    return sendError(res, error, "Could not update the Finance machine.");
  }
});

module.exports = router;
module.exports.assertMachineStillEditable = assertMachineStillEditable;
