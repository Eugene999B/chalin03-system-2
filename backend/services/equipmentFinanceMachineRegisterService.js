const crypto = require("crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  assertProfessionalSchema,
  listProfessionalMachines,
  ProfessionalFinanceError,
} = require("./equipmentFinanceProfessionalService");

const PHOTO_TYPES = new Set([
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
  "registration",
  "insurance",
  "ownership",
  "other",
]);
const PURPOSES = new Set(["sale_only", "sale_or_hire"]);
const CONDITIONS = new Set(["excellent", "good", "fair", "damaged", "under_inspection"]);
const OWNERSHIP_TYPES = new Set(["company_owned", "leased", "consignment", "customer_owned"]);
const METER_TYPES = new Set(["hour_meter", "odometer"]);
const MAX_PHOTO_BYTES = 48 * 1024;

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 1000) {
  return cleanText(value, maxLength) || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Number(number.toFixed(2)) : undefined;
}

function nonNegativeInteger(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function enumValue(value, allowed, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  return allowed.has(normalized) ? normalized : undefined;
}

function dateValue(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function decodePhoto(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!match) {
    throw new ProfessionalFinanceError(400, "Each machine photo must be a JPEG, PNG or WebP image.");
  }
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) {
    throw new ProfessionalFinanceError(
      400,
      "A machine photo is too large. Capture it again so Chalin can resize it safely."
    );
  }
  const normalized = `data:${mimeType};base64,${buffer.toString("base64")}`;
  if (Buffer.byteLength(normalized, "utf8") > 65535) {
    throw new ProfessionalFinanceError(400, "A machine photo exceeds the protected storage limit.");
  }
  return {
    data_url: normalized,
    mime_type: mimeType,
    file_size_bytes: buffer.length,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function normalizePhotos(input = []) {
  if (!Array.isArray(input)) {
    throw new ProfessionalFinanceError(400, "Machine pictures must be submitted as a list.");
  }
  if (input.length > 20) {
    throw new ProfessionalFinanceError(400, "A machine can receive at most 20 pictures in one save.");
  }
  const photos = input
    .filter((item) => item && item.data_url)
    .map((item, index) => {
      const evidenceType = enumValue(item.evidence_type, PHOTO_TYPES, index === 0 ? "main" : "other");
      if (!evidenceType) throw new ProfessionalFinanceError(400, "Choose a valid machine picture type.");
      const image = decodePhoto(item.data_url);
      return {
        ...image,
        evidence_type: evidenceType,
        caption: nullableText(item.caption, 500),
        file_name: nullableText(item.file_name, 255) || `excavator-${evidenceType}.webp`,
        is_primary: Boolean(item.is_primary || evidenceType === "main"),
        sort_order: index,
      };
    });
  if (photos.length && !photos.some((item) => item.is_primary)) photos[0].is_primary = true;
  let primarySeen = false;
  for (const photo of photos) {
    if (photo.is_primary && !primarySeen) primarySeen = true;
    else if (photo.is_primary) photo.is_primary = false;
  }
  return photos;
}

function normalizeMachine(input, { partial = false } = {}) {
  const output = {};
  const errors = [];
  const textFields = [
    ["asset_code", 50, "Equipment code"],
    ["asset_name", 150, "Equipment name"],
    ["asset_type", 60, "Equipment type"],
    ["equipment_category", 80, "Equipment category"],
    ["make", 100, "Make"],
    ["model", 100, "Model"],
    ["serial_number", 120, "Serial number"],
    ["chassis_number", 120, "Chassis number"],
    ["engine_number", 120, "Engine number"],
    ["registration_number", 120, "Registration/number plate"],
    ["colour", 60, "Colour"],
    ["capacity_description", 120, "Capacity"],
    ["supplier_name", 150, "Supplier"],
    ["acquisition_reference", 120, "Acquisition reference"],
    ["customs_reference", 150, "Customs reference"],
    ["title_document_reference", 150, "Title document reference"],
    ["insurance_reference", 150, "Insurance reference"],
    ["fuel_type", 50, "Fuel type"],
    ["notes", 5000, "Notes"],
  ];
  for (const [key, maxLength, label] of textFields) {
    if (partial && input[key] === undefined) continue;
    const value = key === "asset_code"
      ? cleanText(input[key], maxLength).toUpperCase()
      : nullableText(input[key], maxLength);
    output[key] = value;
    if (!partial && ["asset_code", "asset_name", "asset_type", "make", "model"].includes(key) && !value) {
      errors.push(`${label} is required.`);
    }
  }

  if (!partial || input.model_year !== undefined) {
    const year = nonNegativeInteger(input.model_year, null);
    const maxYear = new Date().getUTCFullYear() + 1;
    if (year !== null && (year === undefined || year < 1950 || year > maxYear)) {
      errors.push(`Model year must be between 1950 and ${maxYear}.`);
    }
    output.model_year = year === undefined ? null : year;
  }

  for (const [key, allowed, fallback, label] of [
    ["operational_purpose", PURPOSES, "sale_only", "sale purpose"],
    ["condition_status", CONDITIONS, "good", "condition"],
    ["ownership_type", OWNERSHIP_TYPES, "company_owned", "ownership type"],
    ["meter_type", METER_TYPES, "hour_meter", "meter type"],
  ]) {
    if (partial && input[key] === undefined) continue;
    const value = enumValue(input[key], allowed, fallback);
    if (value === undefined) errors.push(`Choose a valid ${label}.`);
    output[key] = value;
  }

  for (const [key, fallback, label] of [
    ["current_meter", 0, "Current meter"],
    ["acquisition_cost", 0, "Acquisition cost"],
    ["target_selling_price", 0, "Target selling price"],
    ["minimum_selling_price", 0, "Minimum selling price"],
  ]) {
    if (partial && input[key] === undefined) continue;
    const value = nonNegativeNumber(input[key], fallback);
    if (value === undefined) errors.push(`${label} must be zero or greater.`);
    output[key] = value === undefined ? null : value;
  }

  for (const [key, label] of [
    ["acquisition_date", "Acquisition date"],
    ["insurance_expiry", "Insurance expiry"],
    ["registration_expiry", "Registration expiry"],
  ]) {
    if (partial && input[key] === undefined) continue;
    const value = dateValue(input[key]);
    if (value === undefined) errors.push(`${label} must use YYYY-MM-DD.`);
    output[key] = value === undefined ? null : value;
  }

  if (!partial) {
    if (!output.serial_number && !output.chassis_number) {
      errors.push("Enter at least a serial number or chassis number.");
    }
    if (Number(output.target_selling_price || 0) <= 0) {
      errors.push("Target selling price must be greater than zero.");
    }
  }
  if (
    output.minimum_selling_price !== undefined &&
    output.target_selling_price !== undefined &&
    Number(output.minimum_selling_price || 0) > Number(output.target_selling_price || 0)
  ) {
    errors.push("Minimum selling price cannot exceed the target selling price.");
  }
  return { output, errors };
}

async function machineLocations() {
  const [rows] = await pool.query(
    `SELECT location.id, location.code, location.name, location.address, location.phone
     FROM business_locations location
     INNER JOIN business_units unit ON unit.id = location.business_unit_id
     WHERE unit.code = 'equipment_hire'
       AND unit.is_enabled = TRUE
       AND location.is_active = TRUE
     ORDER BY location.name`
  );
  return rows;
}

async function locationRecord(connection, locationId) {
  if (!locationId) return null;
  const [rows] = await connection.query(
    `SELECT location.id, location.code, location.name, location.address, location.phone
     FROM business_locations location
     INNER JOIN business_units unit ON unit.id = location.business_unit_id
     WHERE location.id = ? AND unit.code = 'equipment_hire'
       AND unit.is_enabled = TRUE AND location.is_active = TRUE
     LIMIT 1`,
    [locationId]
  );
  if (!rows.length) throw new ProfessionalFinanceError(400, "Choose a valid equipment yard/location.");
  return rows[0];
}

async function assertUnique(connection, assetId, machine) {
  for (const key of [
    "asset_code",
    "serial_number",
    "chassis_number",
    "engine_number",
    "registration_number",
  ]) {
    const value = machine[key];
    if (!value) continue;
    const params = [value];
    const except = assetId ? "AND id <> ?" : "";
    if (assetId) params.push(assetId);
    const [rows] = await connection.query(
      `SELECT id FROM fleet_assets WHERE \`${key}\` = ? ${except} LIMIT 1 FOR UPDATE`,
      params
    );
    if (rows.length) {
      throw new ProfessionalFinanceError(
        409,
        `Another machine already uses this ${key.replaceAll("_", " ")}.`
      );
    }
  }
}

async function addPhotos(connection, assetId, locationId, photos, userId) {
  if (!photos.length) return [];
  const inserted = [];
  for (const photo of photos) {
    if (photo.is_primary) {
      await connection.query(
        "UPDATE equipment_media SET is_primary = FALSE WHERE asset_id = ? AND archived_at IS NULL",
        [assetId]
      );
    }
    const [result] = await connection.query(
      `INSERT INTO equipment_media (
         asset_id, hire_location_id, media_category, evidence_type,
         file_url, storage_key, thumbnail_url, file_name, mime_type,
         file_size_bytes, caption, is_primary, sort_order, captured_at, created_by
       ) VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        assetId,
        locationId || null,
        photo.evidence_type,
        photo.data_url,
        `database-data-url:${photo.checksum}`,
        photo.data_url,
        photo.file_name,
        photo.mime_type,
        photo.file_size_bytes,
        photo.caption,
        photo.is_primary,
        photo.sort_order,
        userId || null,
      ]
    );
    inserted.push(result.insertId);
    if (photo.is_primary) {
      await connection.query(
        "UPDATE fleet_assets SET main_image_url = ?, updated_by = ? WHERE id = ?",
        [photo.data_url, userId || null, assetId]
      );
    }
  }
  return inserted;
}

async function createFinanceMachine({ input, userId, req }) {
  await assertProfessionalSchema();
  const { output: machine, errors } = normalizeMachine(input || {});
  const photos = normalizePhotos(input?.photos || []);
  if (!photos.some((photo) => photo.is_primary)) {
    errors.push("Capture a full main excavator photo before saving the machine.");
  }
  if (errors.length) throw new ProfessionalFinanceError(400, errors.join(" "));
  const locationId = positiveId(input?.equipment_origin_location_id || input?.hire_location_id);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const location = await locationRecord(connection, locationId);
    await assertUnique(connection, null, machine);
    const [result] = await connection.query(
      `INSERT INTO fleet_assets (
         asset_code, asset_name, asset_type, equipment_category,
         make, model, model_year, serial_number, chassis_number, engine_number,
         registration_number, colour, capacity_description, condition_status,
         ownership_type, operational_purpose, current_status, sale_status,
         current_location, hire_location_id, meter_type, current_meter, fuel_type,
         insurance_expiry, registration_expiry, acquisition_date, acquisition_cost,
         target_selling_price, minimum_selling_price, standard_hire_rate,
         supplier_name, acquisition_reference, customs_reference,
         title_document_reference, insurance_reference, notes, is_active,
         created_by, updated_by
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 'available',
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, TRUE, ?, ?
       )`,
      [
        machine.asset_code,
        machine.asset_name,
        machine.asset_type,
        machine.equipment_category,
        machine.make,
        machine.model,
        machine.model_year,
        machine.serial_number,
        machine.chassis_number,
        machine.engine_number,
        machine.registration_number,
        machine.colour,
        machine.capacity_description,
        machine.condition_status,
        machine.ownership_type,
        machine.operational_purpose,
        location?.name || nullableText(input?.current_location, 255),
        locationId || null,
        machine.meter_type,
        machine.current_meter,
        machine.fuel_type,
        machine.insurance_expiry,
        machine.registration_expiry,
        machine.acquisition_date,
        machine.acquisition_cost,
        machine.target_selling_price,
        machine.minimum_selling_price,
        machine.supplier_name,
        machine.acquisition_reference,
        machine.customs_reference,
        machine.title_document_reference,
        machine.insurance_reference,
        machine.notes,
        userId || null,
        userId || null,
      ]
    );
    await addPhotos(connection, result.insertId, locationId, photos, userId);
    if (Number(machine.current_meter || 0) > 0) {
      await connection.query(
        `INSERT INTO fleet_meter_readings (
           asset_id, reading_value, reading_datetime, source_type, notes, recorded_by
         ) VALUES (?, ?, NOW(), 'finance_machine_register',
           'Opening meter recorded in Installment Finance Machine Register.', ?)`,
        [result.insertId, machine.current_meter, userId || null]
      );
    }
    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_FINANCE_MACHINE_REGISTERED",
      actionType: "equipment.finance.machine.register",
      entityType: "fleet_asset",
      entityId: result.insertId,
      workspaceCode: "equipment_installment_finance",
      hireLocationId: locationId || null,
      severity: "notice",
      details: `Registered ${machine.asset_code} - ${machine.asset_name} for Installment Finance.`,
      metadata: {
        operational_purpose: machine.operational_purpose,
        photo_count: photos.length,
        target_selling_price: machine.target_selling_price,
      },
    });
    await connection.commit();
    const machines = await listProfessionalMachines({ search: machine.asset_code, limit: 10 });
    return machines.find((item) => Number(item.id) === Number(result.insertId)) || null;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function updateFinanceMachine({ assetId, input, userId, req }) {
  await assertProfessionalSchema();
  const id = positiveId(assetId);
  if (!id) throw new ProfessionalFinanceError(400, "Choose a valid machine.");
  const { output: machine, errors } = normalizeMachine(input || {}, { partial: true });
  const photos = normalizePhotos(input?.photos || []);
  if (errors.length) throw new ProfessionalFinanceError(400, errors.join(" "));
  if (!Object.keys(machine).length && !photos.length && input?.equipment_origin_location_id === undefined) {
    throw new ProfessionalFinanceError(400, "Provide machine details or pictures to update.");
  }
  const locationId = input?.equipment_origin_location_id === undefined
    ? undefined
    : positiveId(input.equipment_origin_location_id);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT asset.*,
              (SELECT COUNT(*) FROM hire_contract_assets hire_asset
               WHERE hire_asset.asset_id = asset.id
                 AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count,
              (SELECT COUNT(*) FROM equipment_asset_sale_locks sale_lock
               WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL) AS active_sale_lock_count
       FROM fleet_assets asset WHERE asset.id = ? LIMIT 1 FOR UPDATE`,
      [id]
    );
    const existing = rows[0];
    if (!existing) throw new ProfessionalFinanceError(404, "Machine was not found.");
    if (["sold", "cancelled"].includes(existing.sale_status)) {
      throw new ProfessionalFinanceError(409, "Sold or cancelled machine evidence cannot be edited here.");
    }
    if (Number(existing.active_hire_count || 0) > 0 && machine.operational_purpose === "sale_only") {
      throw new ProfessionalFinanceError(409, "An active Hire machine cannot be changed to sale-only.");
    }
    await assertUnique(connection, id, machine);

    const updates = { ...machine, updated_by: userId || null };
    if (locationId !== undefined) {
      const location = await locationRecord(connection, locationId);
      updates.hire_location_id = locationId || null;
      updates.current_location = location?.name || null;
    }
    const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
    if (entries.length) {
      await connection.query(
        `UPDATE fleet_assets SET ${entries.map(([key]) => `\`${key}\` = ?`).join(", ")}
         WHERE id = ?`,
        [...entries.map(([, value]) => value), id]
      );
    }
    const effectiveLocationId = locationId === undefined ? existing.hire_location_id : locationId;
    await addPhotos(connection, id, effectiveLocationId, photos, userId);
    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_FINANCE_MACHINE_UPDATED",
      actionType: "equipment.finance.machine.update",
      entityType: "fleet_asset",
      entityId: id,
      workspaceCode: "equipment_installment_finance",
      hireLocationId: effectiveLocationId || null,
      severity: "notice",
      details: `Updated ${existing.asset_code} - ${existing.asset_name} in the Finance Machine Register.`,
      metadata: { changed_fields: Object.keys(machine), added_photo_count: photos.length },
    });
    await connection.commit();
    const machines = await listProfessionalMachines({ search: machine.asset_code || existing.asset_code, limit: 20 });
    return machines.find((item) => Number(item.id) === id) || null;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  createFinanceMachine,
  machineLocations,
  updateFinanceMachine,
};
