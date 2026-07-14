const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
} = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

const READ_ROLES = [
  "admin",
  "manager",
  "auditor",
  "site_supervisor",
  "equipment_operator",
  "dispatcher",
  "fleet_officer",
];
const WRITE_ROLES = [
  "admin",
  "manager",
  "site_supervisor",
  "equipment_operator",
  "dispatcher",
  "fleet_officer",
];

const ALLOWED_STATUSES = new Set([
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

const ALLOWED_METER_TYPES = new Set(["hour_meter", "odometer"]);
const ALLOWED_OWNERSHIP_TYPES = new Set([
  "company_owned",
  "leased",
  "financed",
  "third_party",
  "other",
]);

function cleanText(value, maxLength = 255) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  const cleaned = cleanText(value, maxLength);
  return cleaned || null;
}

function toPositiveInt(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

function toNonNegativeNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return Number(number.toFixed(2));
}

function toDateTime(value, fallback = null) {
  const cleaned = cleanText(value, 40);

  if (!cleaned) {
    return fallback;
  }

  const date = new Date(cleaned);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 19).replace("T", " ");
}

function toDate(value) {
  const cleaned = cleanText(value, 20);

  if (!cleaned) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 0);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return null;
  }

  return branchId;
}

function isMissingFleetTableError(error) {
  return error?.code === "ER_NO_SUCH_TABLE" || error?.errno === 1146;
}

function sendFleetSetupError(res, error) {
  if (!isMissingFleetTableError(error)) {
    return false;
  }

  res.status(503).json({
    status: "error",
    code: "FLEET_DATABASE_SETUP_REQUIRED",
    message:
      "The Fleet database migration has not been applied yet. Ask the system administrator to run the Phase 2 fleet migration.",
  });

  return true;
}

async function logActivity(req, action, details) {
  try {
    await writeAuditEvent({
      req,
      action,
      details,
      workspaceCode: req.user?.workspace_code || "fleet",
      entityType: "fleet_asset",
      entityId: req.params?.id || req.params?.assetId || null,
      actionType: action,
      outcome: "success",
      severity:
        action.includes("ARCHIVE") ||
        action.includes("STATUS") ||
        action.includes("MAINTENANCE")
          ? "notice"
          : "info",
      metadata: {
        route: req.originalUrl,
        method: req.method,
      },
    });
  } catch (error) {
    console.warn("Fleet activity log skipped:", error.message);
  }
}

async function getAssetById(assetId) {
  const [rows] = await pool.query(
    `SELECT
       fa.*,
       creator.full_name AS created_by_name,
       updater.full_name AS updated_by_name
     FROM fleet_assets fa
     LEFT JOIN users creator ON creator.id = fa.created_by
     LEFT JOIN users updater ON updater.id = fa.updated_by
     WHERE fa.id = ?
     LIMIT 1`,
    [assetId]
  );

  return rows[0] || null;
}

function validateAssetPayload(body, { partial = false } = {}) {
  const payload = {};
  const errors = [];

  const assetCode = cleanText(body.asset_code, 50).toUpperCase();
  const assetName = cleanText(body.asset_name, 150);
  const assetType = cleanText(body.asset_type, 60).toLowerCase();
  const currentStatus = cleanText(body.current_status, 40).toLowerCase();
  const meterType = cleanText(body.meter_type, 30).toLowerCase();
  const ownershipType = cleanText(body.ownership_type, 40).toLowerCase();

  if (!partial || body.asset_code !== undefined) {
    if (!assetCode) errors.push("Asset code is required.");
    payload.asset_code = assetCode;
  }

  if (!partial || body.asset_name !== undefined) {
    if (!assetName) errors.push("Asset name is required.");
    payload.asset_name = assetName;
  }

  if (!partial || body.asset_type !== undefined) {
    if (!assetType) errors.push("Asset type is required.");
    payload.asset_type = assetType;
  }

  if (!partial || body.current_status !== undefined) {
    const safeStatus = currentStatus || "available";
    if (!ALLOWED_STATUSES.has(safeStatus)) {
      errors.push("Invalid equipment status.");
    }
    payload.current_status = safeStatus;
  }

  if (!partial || body.meter_type !== undefined) {
    const safeMeterType = meterType || "hour_meter";
    if (!ALLOWED_METER_TYPES.has(safeMeterType)) {
      errors.push("Invalid meter type.");
    }
    payload.meter_type = safeMeterType;
  }

  if (!partial || body.ownership_type !== undefined) {
    const safeOwnership = ownershipType || "company_owned";
    if (!ALLOWED_OWNERSHIP_TYPES.has(safeOwnership)) {
      errors.push("Invalid ownership type.");
    }
    payload.ownership_type = safeOwnership;
  }

  const currentMeter = toNonNegativeNumber(body.current_meter, 0);
  if ((!partial || body.current_meter !== undefined) && currentMeter === null) {
    errors.push("Current meter must be zero or greater.");
  }
  if (!partial || body.current_meter !== undefined) {
    payload.current_meter = currentMeter;
  }

  const serviceInterval = toNonNegativeNumber(body.service_interval, null);
  if (body.service_interval !== undefined && serviceInterval === null && body.service_interval !== "") {
    errors.push("Service interval must be zero or greater.");
  }
  if (!partial || body.service_interval !== undefined) {
    payload.service_interval = serviceInterval;
  }

  const nextServiceMeter = toNonNegativeNumber(body.next_service_meter, null);
  if (body.next_service_meter !== undefined && nextServiceMeter === null && body.next_service_meter !== "") {
    errors.push("Next service meter must be zero or greater.");
  }
  if (!partial || body.next_service_meter !== undefined) {
    payload.next_service_meter = nextServiceMeter;
  }

  const insuranceExpiry = toDate(body.insurance_expiry);
  if (body.insurance_expiry && insuranceExpiry === null) {
    errors.push("Insurance expiry must be a valid date.");
  }

  const registrationExpiry = toDate(body.registration_expiry);
  if (body.registration_expiry && registrationExpiry === null) {
    errors.push("Registration expiry must be a valid date.");
  }

  Object.assign(payload, {
    make: nullableText(body.make, 100),
    model: nullableText(body.model, 100),
    serial_number: nullableText(body.serial_number, 120),
    registration_number: nullableText(body.registration_number, 80),
    current_location: nullableText(body.current_location, 180),
    assigned_operator_name: nullableText(body.assigned_operator_name, 150),
    fuel_type: nullableText(body.fuel_type, 50),
    insurance_expiry: insuranceExpiry,
    registration_expiry: registrationExpiry,
    notes: nullableText(body.notes, 3000),
  });

  return { payload, errors };
}

router.use(requireAuth);

// GET /api/fleet/summary
router.get(
  "/summary",
  requireAuth,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT
           COUNT(*) AS total_assets,
           SUM(CASE WHEN current_status = 'available' THEN 1 ELSE 0 END) AS available_assets,
           SUM(CASE WHEN current_status IN ('assigned_mining', 'working') THEN 1 ELSE 0 END) AS mining_or_working_assets,
           SUM(CASE WHEN current_status = 'assigned_hire' THEN 1 ELSE 0 END) AS hired_assets,
           SUM(CASE WHEN current_status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance_assets,
           SUM(CASE WHEN current_status = 'breakdown' THEN 1 ELSE 0 END) AS breakdown_assets,
           SUM(CASE
             WHEN next_service_meter IS NOT NULL AND current_meter >= next_service_meter
             THEN 1 ELSE 0 END) AS service_due_assets,
           SUM(CASE
             WHEN (insurance_expiry IS NOT NULL AND insurance_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
               OR (registration_expiry IS NOT NULL AND registration_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
             THEN 1 ELSE 0 END) AS documents_expiring_soon
         FROM fleet_assets
         WHERE is_active = TRUE`
      );

      return res.json({
        status: "success",
        summary: rows[0] || {},
      });
    } catch (error) {
      console.error("Fleet summary error:", error);
      if (sendFleetSetupError(res, error)) return;

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while loading the fleet summary.",
      });
    }
  }
);

// GET /api/fleet/assets
router.get(
  "/assets",
  requireAuth,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const search = cleanText(req.query.search, 120);
      const status = cleanText(req.query.status, 40).toLowerCase();
      const type = cleanText(req.query.type, 60).toLowerCase();
      const includeInactive = cleanText(req.query.include_inactive, 10) === "true";

      const params = [];
      const where = [];

      if (!includeInactive) {
        where.push("fa.is_active = TRUE");
      }

      if (search) {
        const searchValue = `%${search}%`;
        where.push(`(
          fa.asset_code LIKE ?
          OR fa.asset_name LIKE ?
          OR fa.asset_type LIKE ?
          OR fa.make LIKE ?
          OR fa.model LIKE ?
          OR fa.serial_number LIKE ?
          OR fa.registration_number LIKE ?
          OR fa.current_location LIKE ?
          OR fa.assigned_operator_name LIKE ?
        )`);
        params.push(
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue
        );
      }

      if (status) {
        where.push("fa.current_status = ?");
        params.push(status);
      }

      if (type) {
        where.push("fa.asset_type = ?");
        params.push(type);
      }

      const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const [assets] = await pool.query(
        `SELECT
           fa.*,
           CASE
             WHEN fa.next_service_meter IS NOT NULL AND fa.current_meter >= fa.next_service_meter
             THEN TRUE ELSE FALSE
           END AS service_due,
           CASE
             WHEN (fa.insurance_expiry IS NOT NULL AND fa.insurance_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
               OR (fa.registration_expiry IS NOT NULL AND fa.registration_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
             THEN TRUE ELSE FALSE
           END AS document_expiry_warning
         FROM fleet_assets fa
         ${whereClause}
         ORDER BY
           FIELD(fa.current_status, 'breakdown', 'maintenance', 'working', 'assigned_hire', 'assigned_mining', 'mobilizing', 'available', 'idle', 'retired', 'sold'),
           fa.asset_name ASC`,
        params
      );

      const [typeRows] = await pool.query(
        `SELECT DISTINCT asset_type
         FROM fleet_assets
         WHERE is_active = TRUE
         AND asset_type IS NOT NULL
         AND asset_type <> ''
         ORDER BY asset_type ASC`
      );

      return res.json({
        status: "success",
        count: assets.length,
        assets,
        asset_types: typeRows.map((row) => row.asset_type),
      });
    } catch (error) {
      console.error("Get fleet assets error:", error);
      if (sendFleetSetupError(res, error)) return;

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while loading the equipment register.",
      });
    }
  }
);

// GET /api/fleet/assets/:id
router.get(
  "/assets/:id",
  requireAuth,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const assetId = toPositiveInt(req.params.id);

      if (!assetId) {
        return res.status(400).json({ status: "error", message: "Invalid asset ID." });
      }

      const asset = await getAssetById(assetId);

      if (!asset) {
        return res.status(404).json({ status: "error", message: "Equipment record not found." });
      }

      const [meterReadings] = await pool.query(
        `SELECT fmr.*, u.full_name AS recorded_by_name
         FROM fleet_meter_readings fmr
         LEFT JOIN users u ON u.id = fmr.recorded_by
         WHERE fmr.asset_id = ?
         ORDER BY fmr.reading_datetime DESC, fmr.id DESC
         LIMIT 20`,
        [assetId]
      );

      const [fuelLogs] = await pool.query(
        `SELECT ffl.*, u.full_name AS recorded_by_name
         FROM fleet_fuel_logs ffl
         LEFT JOIN users u ON u.id = ffl.recorded_by
         WHERE ffl.asset_id = ?
         ORDER BY ffl.log_datetime DESC, ffl.id DESC
         LIMIT 20`,
        [assetId]
      );

      const [maintenanceRecords] = await pool.query(
        `SELECT fmr.*, creator.full_name AS created_by_name
         FROM fleet_maintenance_records fmr
         LEFT JOIN users creator ON creator.id = fmr.created_by
         WHERE fmr.asset_id = ?
         ORDER BY fmr.reported_at DESC, fmr.id DESC
         LIMIT 20`,
        [assetId]
      );

      const [inspections] = await pool.query(
        `SELECT fi.*, creator.full_name AS created_by_name
         FROM fleet_inspections fi
         LEFT JOIN users creator ON creator.id = fi.created_by
         WHERE fi.asset_id = ?
         ORDER BY fi.inspection_datetime DESC, fi.id DESC
         LIMIT 20`,
        [assetId]
      );

      return res.json({
        status: "success",
        asset,
        meter_readings: meterReadings,
        fuel_logs: fuelLogs,
        maintenance_records: maintenanceRecords,
        inspections,
      });
    } catch (error) {
      console.error("Get fleet asset details error:", error);
      if (sendFleetSetupError(res, error)) return;

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while loading equipment details.",
      });
    }
  }
);

// POST /api/fleet/assets
router.post(
  "/assets",
  requireAuth,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const { payload, errors } = validateAssetPayload(req.body);

      if (errors.length) {
        return res.status(400).json({ status: "error", message: errors.join(" ") });
      }

      const [duplicateRows] = await pool.query(
        `SELECT id FROM fleet_assets WHERE asset_code = ? LIMIT 1`,
        [payload.asset_code]
      );

      if (duplicateRows.length) {
        return res.status(409).json({
          status: "error",
          message: "An equipment record with this asset code already exists.",
        });
      }

      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        const [result] = await connection.query(
          `INSERT INTO fleet_assets (
             asset_code,
             asset_name,
             asset_type,
             make,
             model,
             serial_number,
             registration_number,
             ownership_type,
             current_status,
             current_location,
             assigned_operator_name,
             meter_type,
             current_meter,
             fuel_type,
             service_interval,
             next_service_meter,
             insurance_expiry,
             registration_expiry,
             notes,
             created_by,
             updated_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            payload.asset_code,
            payload.asset_name,
            payload.asset_type,
            payload.make,
            payload.model,
            payload.serial_number,
            payload.registration_number,
            payload.ownership_type,
            payload.current_status,
            payload.current_location,
            payload.assigned_operator_name,
            payload.meter_type,
            payload.current_meter,
            payload.fuel_type,
            payload.service_interval,
            payload.next_service_meter,
            payload.insurance_expiry,
            payload.registration_expiry,
            payload.notes,
            req.user?.id || null,
            req.user?.id || null,
          ]
        );

        if (Number(payload.current_meter || 0) > 0) {
          await connection.query(
            `INSERT INTO fleet_meter_readings (
               asset_id,
               reading_value,
               reading_datetime,
               source_type,
               notes,
               recorded_by
             ) VALUES (?, ?, NOW(), 'opening_register', 'Opening meter recorded when equipment was registered.', ?)`,
            [result.insertId, payload.current_meter, req.user?.id || null]
          );
        }

        await connection.commit();

        const asset = await getAssetById(result.insertId);

        await logActivity(
          req,
          "FLEET_ASSET_CREATED",
          `Created equipment ${payload.asset_code} - ${payload.asset_name}. Status: ${payload.current_status}.`
        );

        return res.status(201).json({
          status: "success",
          message: "Equipment added to the shared fleet register.",
          asset,
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error("Create fleet asset error:", error);
      if (sendFleetSetupError(res, error)) return;

      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message: "An equipment record with the same asset code already exists.",
        });
      }

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while creating the equipment record.",
      });
    }
  }
);

// PUT /api/fleet/assets/:id
router.put(
  "/assets/:id",
  requireAuth,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const assetId = toPositiveInt(req.params.id);

      if (!assetId) {
        return res.status(400).json({ status: "error", message: "Invalid asset ID." });
      }

      const existing = await getAssetById(assetId);

      if (!existing) {
        return res.status(404).json({ status: "error", message: "Equipment record not found." });
      }

      const { payload, errors } = validateAssetPayload(req.body);

      if (errors.length) {
        return res.status(400).json({ status: "error", message: errors.join(" ") });
      }

      if (Number(payload.current_meter) < Number(existing.current_meter || 0)) {
        return res.status(400).json({
          status: "error",
          message:
            "The current meter cannot be reduced from the edit form. Use Add Meter Reading with an administrator correction reason.",
        });
      }

      const [duplicateRows] = await pool.query(
        `SELECT id FROM fleet_assets WHERE asset_code = ? AND id <> ? LIMIT 1`,
        [payload.asset_code, assetId]
      );

      if (duplicateRows.length) {
        return res.status(409).json({
          status: "error",
          message: "Another equipment record already uses this asset code.",
        });
      }

      await pool.query(
        `UPDATE fleet_assets
         SET
           asset_code = ?,
           asset_name = ?,
           asset_type = ?,
           make = ?,
           model = ?,
           serial_number = ?,
           registration_number = ?,
           ownership_type = ?,
           current_status = ?,
           current_location = ?,
           assigned_operator_name = ?,
           meter_type = ?,
           current_meter = ?,
           fuel_type = ?,
           service_interval = ?,
           next_service_meter = ?,
           insurance_expiry = ?,
           registration_expiry = ?,
           notes = ?,
           updated_by = ?
         WHERE id = ?`,
        [
          payload.asset_code,
          payload.asset_name,
          payload.asset_type,
          payload.make,
          payload.model,
          payload.serial_number,
          payload.registration_number,
          payload.ownership_type,
          payload.current_status,
          payload.current_location,
          payload.assigned_operator_name,
          payload.meter_type,
          payload.current_meter,
          payload.fuel_type,
          payload.service_interval,
          payload.next_service_meter,
          payload.insurance_expiry,
          payload.registration_expiry,
          payload.notes,
          req.user?.id || null,
          assetId,
        ]
      );

      if (Number(payload.current_meter) > Number(existing.current_meter || 0)) {
        await pool.query(
          `INSERT INTO fleet_meter_readings (
             asset_id,
             reading_value,
             reading_datetime,
             source_type,
             notes,
             recorded_by
           ) VALUES (?, ?, NOW(), 'asset_edit', 'Meter increased while equipment record was edited.', ?)`,
          [assetId, payload.current_meter, req.user?.id || null]
        );
      }

      const asset = await getAssetById(assetId);

      await logActivity(
        req,
        "FLEET_ASSET_UPDATED",
        `Updated equipment ${asset.asset_code} - ${asset.asset_name}. Status: ${asset.current_status}.`
      );

      return res.json({
        status: "success",
        message: "Equipment record updated successfully.",
        asset,
      });
    } catch (error) {
      console.error("Update fleet asset error:", error);
      if (sendFleetSetupError(res, error)) return;

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while updating the equipment record.",
      });
    }
  }
);

// PATCH /api/fleet/assets/:id/status
router.patch(
  "/assets/:id/status",
  requireAuth,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const assetId = toPositiveInt(req.params.id);
      const status = cleanText(req.body.status, 40).toLowerCase();
      const location = nullableText(req.body.current_location, 180);
      const operatorName = nullableText(req.body.assigned_operator_name, 150);
      const reason = nullableText(req.body.reason, 1000);

      if (!assetId) {
        return res.status(400).json({ status: "error", message: "Invalid asset ID." });
      }

      if (!ALLOWED_STATUSES.has(status)) {
        return res.status(400).json({ status: "error", message: "Invalid equipment status." });
      }

      const existing = await getAssetById(assetId);

      if (!existing) {
        return res.status(404).json({ status: "error", message: "Equipment record not found." });
      }

      await pool.query(
        `UPDATE fleet_assets
         SET current_status = ?, current_location = ?, assigned_operator_name = ?, updated_by = ?
         WHERE id = ?`,
        [status, location, operatorName, req.user?.id || null, assetId]
      );

      const asset = await getAssetById(assetId);

      await logActivity(
        req,
        "FLEET_STATUS_CHANGED",
        `Changed ${asset.asset_code} status from ${existing.current_status} to ${status}. Location: ${location || "Not set"}. Reason: ${reason || "Not supplied"}.`
      );

      return res.json({
        status: "success",
        message: "Equipment status updated successfully.",
        asset,
      });
    } catch (error) {
      console.error("Update fleet status error:", error);
      if (sendFleetSetupError(res, error)) return;

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while updating equipment status.",
      });
    }
  }
);

// POST /api/fleet/assets/:id/meter-readings
router.post(
  "/assets/:id/meter-readings",
  requireAuth,
  requirePermission("fleet.meter.manage"),
  async (req, res) => {
    let connection;

    try {
      connection = await pool.getConnection();

      const assetId = toPositiveInt(req.params.id);
      const readingValue = toNonNegativeNumber(req.body.reading_value, null);
      const readingDateTime = toDateTime(req.body.reading_datetime, new Date().toISOString());
      const sourceType = nullableText(req.body.source_type, 50) || "manual";
      const notes = nullableText(req.body.notes, 1000);
      const correctionReason = nullableText(req.body.correction_reason, 1000);

      if (!assetId || readingValue === null || !readingDateTime) {
        return res.status(400).json({
          status: "error",
          message: "Asset, meter reading and valid date/time are required.",
        });
      }

      await connection.beginTransaction();

      const [assetRows] = await connection.query(
        `SELECT * FROM fleet_assets WHERE id = ? FOR UPDATE`,
        [assetId]
      );
      const asset = assetRows[0];

      if (!asset) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "Equipment record not found." });
      }

      const isCorrection = readingValue < Number(asset.current_meter || 0);
      const userRole = cleanText(req.user?.role, 30).toLowerCase();

      if (isCorrection && userRole !== "admin") {
        await connection.rollback();
        return res.status(403).json({
          status: "error",
          message: "Only an administrator can record a lower meter correction.",
        });
      }

      if (isCorrection && !correctionReason) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message: "A correction reason is required when reducing a meter reading.",
        });
      }

      await connection.query(
        `INSERT INTO fleet_meter_readings (
           asset_id,
           reading_value,
           reading_datetime,
           source_type,
           notes,
           is_correction,
           correction_reason,
           recorded_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assetId,
          readingValue,
          readingDateTime,
          sourceType,
          notes,
          isCorrection,
          correctionReason,
          req.user?.id || null,
        ]
      );

      await connection.query(
        `UPDATE fleet_assets
         SET current_meter = ?, updated_by = ?
         WHERE id = ?`,
        [readingValue, req.user?.id || null, assetId]
      );

      await connection.commit();

      await logActivity(
        req,
        isCorrection ? "FLEET_METER_CORRECTED" : "FLEET_METER_RECORDED",
        `${asset.asset_code} meter changed from ${asset.current_meter} to ${readingValue}. ${correctionReason || notes || ""}`
      );

      return res.status(201).json({
        status: "success",
        message: isCorrection
          ? "Meter correction recorded with an audit trail."
          : "Meter reading recorded successfully.",
      });
    } catch (error) {
      await connection.rollback();
      console.error("Create meter reading error:", error);
      if (sendFleetSetupError(res, error)) return;

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while recording the meter reading.",
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
);

// POST /api/fleet/assets/:id/fuel-logs
router.post(
  "/assets/:id/fuel-logs",
  requireAuth,
  requirePermission("fleet.fuel.manage"),
  async (req, res) => {
    try {
      const assetId = toPositiveInt(req.params.id);
      const quantityLitres = toNonNegativeNumber(req.body.quantity_litres, null);
      const meterReading = toNonNegativeNumber(req.body.meter_reading, null);
      const logDateTime = toDateTime(req.body.log_datetime, new Date().toISOString());
      const supplierOrSource = nullableText(req.body.supplier_or_source, 150);
      const referenceNumber = nullableText(req.body.reference_number, 120);
      const costAmount = toNonNegativeNumber(req.body.cost_amount, 0);
      const notes = nullableText(req.body.notes, 1000);

      if (!assetId || quantityLitres === null || quantityLitres <= 0 || !logDateTime) {
        return res.status(400).json({
          status: "error",
          message: "Asset, fuel quantity above zero and valid date/time are required.",
        });
      }

      const asset = await getAssetById(assetId);
      if (!asset) {
        return res.status(404).json({ status: "error", message: "Equipment record not found." });
      }

      if (meterReading !== null && meterReading < Number(asset.current_meter || 0)) {
        return res.status(400).json({
          status: "error",
          message: "Fuel log meter cannot be lower than the current equipment meter.",
        });
      }

      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        await connection.query(
          `INSERT INTO fleet_fuel_logs (
             asset_id,
             log_datetime,
             quantity_litres,
             meter_reading,
             supplier_or_source,
             reference_number,
             cost_amount,
             notes,
             recorded_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            assetId,
            logDateTime,
            quantityLitres,
            meterReading,
            supplierOrSource,
            referenceNumber,
            costAmount,
            notes,
            req.user?.id || null,
          ]
        );

        if (meterReading !== null && meterReading > Number(asset.current_meter || 0)) {
          await connection.query(
            `INSERT INTO fleet_meter_readings (
               asset_id,
               reading_value,
               reading_datetime,
               source_type,
               notes,
               recorded_by
             ) VALUES (?, ?, ?, 'fuel_log', 'Meter captured during fuel entry.', ?)`,
            [assetId, meterReading, logDateTime, req.user?.id || null]
          );

          await connection.query(
            `UPDATE fleet_assets SET current_meter = ?, updated_by = ? WHERE id = ?`,
            [meterReading, req.user?.id || null, assetId]
          );
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await logActivity(
        req,
        "FLEET_FUEL_RECORDED",
        `Recorded ${quantityLitres} litres for ${asset.asset_code}. Cost: GHS ${Number(costAmount || 0).toFixed(2)}.`
      );

      return res.status(201).json({
        status: "success",
        message: "Fuel entry recorded successfully.",
      });
    } catch (error) {
      console.error("Create fuel log error:", error);
      if (sendFleetSetupError(res, error)) return;

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while recording fuel.",
      });
    }
  }
);

// POST /api/fleet/assets/:id/maintenance
router.post(
  "/assets/:id/maintenance",
  requireAuth,
  requirePermission("fleet.maintenance.manage"),
  async (req, res) => {
    try {
      const assetId = toPositiveInt(req.params.id);
      const maintenanceType = cleanText(req.body.maintenance_type, 50).toLowerCase();
      const status = cleanText(req.body.status, 30).toLowerCase() || "open";
      const description = cleanText(req.body.description, 2000);
      const reportedAt = toDateTime(req.body.reported_at, new Date().toISOString());
      const completedAt = toDateTime(req.body.completed_at, null);
      const meterReading = toNonNegativeNumber(req.body.meter_reading, null);
      const technician = nullableText(req.body.technician, 150);
      const costAmount = toNonNegativeNumber(req.body.cost_amount, 0);
      const nextServiceMeter = toNonNegativeNumber(req.body.next_service_meter, null);
      const notes = nullableText(req.body.notes, 1200);

      if (!assetId || !maintenanceType || !description || !reportedAt) {
        return res.status(400).json({
          status: "error",
          message: "Maintenance type, description and valid reported date/time are required.",
        });
      }

      if (!["open", "in_progress", "completed", "cancelled"].includes(status)) {
        return res.status(400).json({ status: "error", message: "Invalid maintenance status." });
      }

      const asset = await getAssetById(assetId);
      if (!asset) {
        return res.status(404).json({ status: "error", message: "Equipment record not found." });
      }

      await pool.query(
        `INSERT INTO fleet_maintenance_records (
           asset_id,
           maintenance_type,
           status,
           reported_at,
           completed_at,
           meter_reading,
           description,
           technician,
           cost_amount,
           next_service_meter,
           notes,
           created_by,
           updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assetId,
          maintenanceType,
          status,
          reportedAt,
          completedAt,
          meterReading,
          description,
          technician,
          costAmount,
          nextServiceMeter,
          notes,
          req.user?.id || null,
          req.user?.id || null,
        ]
      );

      let newAssetStatus = asset.current_status;
      if (["open", "in_progress"].includes(status)) {
        newAssetStatus = maintenanceType === "breakdown" ? "breakdown" : "maintenance";
      } else if (status === "completed" && ["maintenance", "breakdown"].includes(asset.current_status)) {
        newAssetStatus = "available";
      }

      await pool.query(
        `UPDATE fleet_assets
         SET current_status = ?,
             next_service_meter = COALESCE(?, next_service_meter),
             current_meter = CASE
               WHEN ? IS NOT NULL AND ? >= current_meter THEN ?
               ELSE current_meter
             END,
             updated_by = ?
         WHERE id = ?`,
        [
          newAssetStatus,
          nextServiceMeter,
          meterReading,
          meterReading,
          meterReading,
          req.user?.id || null,
          assetId,
        ]
      );

      await logActivity(
        req,
        "FLEET_MAINTENANCE_RECORDED",
        `${asset.asset_code}: ${maintenanceType} record created. Status: ${status}. Cost: GHS ${Number(costAmount || 0).toFixed(2)}.`
      );

      return res.status(201).json({
        status: "success",
        message: "Maintenance record saved successfully.",
      });
    } catch (error) {
      console.error("Create maintenance record error:", error);
      if (sendFleetSetupError(res, error)) return;

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while recording maintenance.",
      });
    }
  }
);

// POST /api/fleet/assets/:id/inspections
router.post(
  "/assets/:id/inspections",
  requireAuth,
  requirePermission("fleet.inspections.manage"),
  async (req, res) => {
    try {
      const assetId = toPositiveInt(req.params.id);
      const inspectionType = cleanText(req.body.inspection_type, 50).toLowerCase();
      const inspectionDateTime = toDateTime(req.body.inspection_datetime, new Date().toISOString());
      const meterReading = toNonNegativeNumber(req.body.meter_reading, null);
      const conditionStatus = cleanText(req.body.condition_status, 30).toLowerCase();
      const findings = nullableText(req.body.findings, 2000);
      const actionRequired = nullableText(req.body.action_required, 1500);
      const inspectedByName = nullableText(req.body.inspected_by_name, 150);

      if (!assetId || !inspectionType || !inspectionDateTime || !conditionStatus) {
        return res.status(400).json({
          status: "error",
          message: "Inspection type, condition and valid date/time are required.",
        });
      }

      if (!["good", "attention", "unsafe", "out_of_service"].includes(conditionStatus)) {
        return res.status(400).json({ status: "error", message: "Invalid inspection condition." });
      }

      const asset = await getAssetById(assetId);
      if (!asset) {
        return res.status(404).json({ status: "error", message: "Equipment record not found." });
      }

      await pool.query(
        `INSERT INTO fleet_inspections (
           asset_id,
           inspection_type,
           inspection_datetime,
           meter_reading,
           condition_status,
           findings,
           action_required,
           inspected_by_name,
           created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assetId,
          inspectionType,
          inspectionDateTime,
          meterReading,
          conditionStatus,
          findings,
          actionRequired,
          inspectedByName,
          req.user?.id || null,
        ]
      );

      if (["unsafe", "out_of_service"].includes(conditionStatus)) {
        await pool.query(
          `UPDATE fleet_assets SET current_status = 'maintenance', updated_by = ? WHERE id = ?`,
          [req.user?.id || null, assetId]
        );
      }

      await logActivity(
        req,
        "FLEET_INSPECTION_RECORDED",
        `${asset.asset_code}: ${inspectionType} inspection recorded as ${conditionStatus}.`
      );

      return res.status(201).json({
        status: "success",
        message: "Inspection record saved successfully.",
      });
    } catch (error) {
      console.error("Create fleet inspection error:", error);
      if (sendFleetSetupError(res, error)) return;

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while recording the inspection.",
      });
    }
  }
);

// PATCH /api/fleet/assets/:id/active
router.patch(
  "/assets/:id/active",
  requireAuth,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const assetId = toPositiveInt(req.params.id);
      const isActive = Boolean(req.body.is_active);
      const reason = nullableText(req.body.reason, 1000);

      if (!assetId) {
        return res.status(400).json({ status: "error", message: "Invalid asset ID." });
      }

      const asset = await getAssetById(assetId);
      if (!asset) {
        return res.status(404).json({ status: "error", message: "Equipment record not found." });
      }

      if (!reason) {
        return res.status(400).json({
          status: "error",
          message: "A reason is required when activating or archiving equipment.",
        });
      }

      await pool.query(
        `UPDATE fleet_assets SET is_active = ?, updated_by = ? WHERE id = ?`,
        [isActive, req.user?.id || null, assetId]
      );

      await logActivity(
        req,
        isActive ? "FLEET_ASSET_REACTIVATED" : "FLEET_ASSET_ARCHIVED",
        `${asset.asset_code} ${isActive ? "reactivated" : "archived"}. Reason: ${reason}.`
      );

      return res.json({
        status: "success",
        message: isActive
          ? "Equipment record reactivated successfully."
          : "Equipment record archived successfully.",
      });
    } catch (error) {
      console.error("Archive fleet asset error:", error);
      if (sendFleetSetupError(res, error)) return;

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while changing equipment activity status.",
      });
    }
  }
);

module.exports = router;
