const express = require("express");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/permissionMiddleware");
const {
  MiningSiteScopeError,
  assertMiningWorkspace,
  resolveMiningSiteScope,
  assertRecordInMiningSite,
  sendMiningSiteScopeError,
} = require("../services/miningSiteScope");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

const REQUIRED_TABLES = [
  "mining_stockpiles",
  "mining_stockpile_movements",
  "mining_dispatches",
  "mining_fuel_tanks",
  "mining_fuel_transactions",
  "mining_fuel_reconciliations",
  "mining_contractors",
  "mining_shift_crews",
  "mining_shift_crew_members",
  "mining_site_closings",
];

const STOCKPILE_MOVEMENT_TYPES = new Set([
  "production",
  "transfer",
  "adjustment_in",
  "adjustment_out",
]);
const FUEL_TRANSACTION_TYPES = new Set([
  "receipt",
  "issue",
  "transfer",
  "adjustment_in",
  "adjustment_out",
]);
const SHIFT_CODES = new Set([
  "day",
  "night",
  "morning",
  "afternoon",
  "custom",
]);
const CLOSING_TYPES = new Set(["daily", "weekly", "monthly", "period"]);

function appError(message, statusCode = 400, code = "MINING_CONTROL_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  const cleaned = cleanText(value, maxLength);
  return cleaned || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value, field, decimals = 3) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw appError(`${field} must be a valid non-negative number.`);
  }
  return Number(number.toFixed(decimals));
}

function positiveNumber(value, field, decimals = 3) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw appError(`${field} must be greater than zero.`);
  }
  return Number(number.toFixed(decimals));
}

function dateOnly(value, field = "Date") {
  const cleaned = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw appError(`${field} must use YYYY-MM-DD.`);
  }
  return cleaned;
}

function dateTime(value, field = "Date and time") {
  const cleaned = cleanText(value, 50);
  const date = cleaned ? new Date(cleaned) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw appError(`${field} is invalid.`);
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function booleanValue(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function isMissingTableError(error) {
  return error?.code === "ER_NO_SUCH_TABLE" || error?.errno === 1146;
}

function sendError(res, error, fallback) {
  if (sendMiningSiteScopeError(res, error)) return;

  if (isMissingTableError(error) || error?.code === "MINING_CONTROL_MIGRATION_REQUIRED") {
    res.status(503).json({
      status: "error",
      code: "MINING_CONTROL_MIGRATION_REQUIRED",
      message:
        "Release 3B Mining Control is not installed. Apply database/migrations/20260717_release3b_mining_operations_control.sql.",
    });
    return;
  }

  if (error?.code === "ER_DUP_ENTRY") {
    res.status(409).json({
      status: "error",
      code: "DUPLICATE_RECORD",
      message: "A record with the same code, number or period already exists.",
    });
    return;
  }

  const statusCode = Number(error?.statusCode || 500);
  res.status(statusCode).json({
    status: "error",
    code: error?.code || "MINING_CONTROL_ERROR",
    message: statusCode >= 500 ? fallback : error.message,
  });
}

async function ensureTables(connection = pool) {
  const placeholders = REQUIRED_TABLES.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    REQUIRED_TABLES
  );
  const present = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
  if (missing.length) {
    throw appError(
      `Release 3B migration is required. Missing: ${missing.join(", ")}.`,
      503,
      "MINING_CONTROL_MIGRATION_REQUIRED"
    );
  }
}

async function audit(req, action, details, entityType, entityId, connection = pool) {
  try {
    await writeAuditEvent({
      connection,
      req,
      action,
      details,
      workspaceCode: "mining",
      miningSiteId: req.miningSiteScope?.siteId || null,
      entityType,
      entityId: entityId || null,
      actionType: action,
      outcome: "success",
      severity: action.includes("APPROVE") ? "notice" : "info",
      metadata: {
        route: req.originalUrl,
        method: req.method,
      },
    });
  } catch (error) {
    console.warn("Mining Control audit skipped:", error.message);
  }
}

async function lockStockpile(connection, stockpileId, siteId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM mining_stockpiles
     WHERE id = ? AND site_id = ?
     LIMIT 1
     FOR UPDATE`,
    [stockpileId, siteId]
  );
  if (!rows.length) {
    throw appError("The selected stockpile was not found in this Mining site.", 404);
  }
  return rows[0];
}

async function lockFuelTank(connection, tankId, siteId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM mining_fuel_tanks
     WHERE id = ? AND site_id = ?
     LIMIT 1
     FOR UPDATE`,
    [tankId, siteId]
  );
  if (!rows.length) {
    throw appError("The selected fuel tank was not found in this Mining site.", 404);
  }
  return rows[0];
}

async function insertStockpileMovement(connection, {
  movementNumber,
  movementGroupNumber = null,
  siteId,
  stockpileId,
  relatedStockpileId = null,
  dispatchId = null,
  productionRecordId = null,
  movementType,
  direction,
  quantity,
  balanceBefore,
  balanceAfter,
  unit,
  movementDatetime,
  externalReference = null,
  evidenceReference = null,
  explanation = null,
  userId = null,
}) {
  const [result] = await connection.query(
    `INSERT INTO mining_stockpile_movements (
       movement_number, movement_group_number, site_id, stockpile_id,
       related_stockpile_id, dispatch_id, production_record_id,
       movement_type, direction, quantity, balance_before, balance_after,
       unit, movement_datetime, external_reference, evidence_reference,
       explanation, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      movementNumber,
      movementGroupNumber,
      siteId,
      stockpileId,
      relatedStockpileId,
      dispatchId,
      productionRecordId,
      movementType,
      direction,
      quantity,
      balanceBefore,
      balanceAfter,
      unit,
      movementDatetime,
      externalReference,
      evidenceReference,
      explanation,
      userId,
    ]
  );
  return result.insertId;
}

async function insertFuelTransaction(connection, {
  transactionNumber,
  transferGroupNumber = null,
  siteId,
  tankId,
  relatedTankId = null,
  assetId = null,
  transactionType,
  direction,
  transactionDatetime,
  quantity,
  balanceBefore,
  balanceAfter,
  unitCost = 0,
  meterReading = null,
  supplierOrSource = null,
  recipientName = null,
  referenceNumber = null,
  evidenceReference = null,
  notes = null,
  userId = null,
}) {
  const totalCost = Number((quantity * unitCost).toFixed(2));
  const [result] = await connection.query(
    `INSERT INTO mining_fuel_transactions (
       transaction_number, transfer_group_number, site_id, tank_id,
       related_tank_id, asset_id, transaction_type, direction,
       transaction_datetime, quantity_litres, balance_before_litres,
       balance_after_litres, unit_cost, total_cost, meter_reading,
       supplier_or_source, recipient_name, reference_number,
       evidence_reference, notes, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transactionNumber,
      transferGroupNumber,
      siteId,
      tankId,
      relatedTankId,
      assetId,
      transactionType,
      direction,
      transactionDatetime,
      quantity,
      balanceBefore,
      balanceAfter,
      unitCost,
      totalCost,
      meterReading,
      supplierOrSource,
      recipientName,
      referenceNumber,
      evidenceReference,
      notes,
      userId,
    ]
  );
  return result.insertId;
}

router.use(requireAuth);
router.use(async (req, res, next) => {
  try {
    assertMiningWorkspace(req);
    const scope = await resolveMiningSiteScope(req, { requireSelection: true });
    if (req.body?.site_id && Number(req.body.site_id) !== Number(scope.siteId)) {
      throw new MiningSiteScopeError(
        403,
        "The record site must match the selected Mining site.",
        "MINING_SITE_MISMATCH"
      );
    }
    req.miningSiteScope = scope;
    await ensureTables();
    next();
  } catch (error) {
    sendError(res, error, "Could not validate the Mining Control request.");
  }
});

// GET /api/mining-control/dashboard
router.get(
  "/dashboard",
  requireAnyPermission(
    "mining.stockpiles.view",
    "mining.dispatch.view",
    "mining.fuel_control.view",
    "mining.workforce.view",
    "mining.closing.view"
  ),
  async (req, res) => {
    try {
      const siteId = req.miningSiteScope.siteId;
      const from = cleanText(req.query.from, 20) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
      const to = cleanText(req.query.to, 20) || new Date().toISOString().slice(0, 10);

      const [
        [stockpileRows],
        [dispatchRows],
        [fuelRows],
        [crewRows],
        [closingRows],
        [productionRows],
        [expenseRows],
        [equipmentRows],
        [incidentRows],
      ] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS stockpile_count,
                  COALESCE(SUM(current_quantity), 0) AS stockpile_quantity,
                  SUM(CASE WHEN current_quantity <= minimum_quantity THEN 1 ELSE 0 END) AS low_stockpiles
           FROM mining_stockpiles WHERE site_id = ? AND status = 'active'`,
          [siteId]
        ),
        pool.query(
          `SELECT COUNT(*) AS dispatch_count,
                  COALESCE(SUM(CASE WHEN status = 'approved' THEN quantity ELSE 0 END), 0) AS dispatched_quantity,
                  SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS pending_dispatches
           FROM mining_dispatches
           WHERE site_id = ? AND DATE(dispatch_datetime) BETWEEN ? AND ?`,
          [siteId, from, to]
        ),
        pool.query(
          `SELECT COUNT(*) AS tank_count,
                  COALESCE(SUM(current_balance_litres), 0) AS fuel_balance_litres,
                  SUM(CASE WHEN current_balance_litres <= minimum_level_litres THEN 1 ELSE 0 END) AS low_tanks
           FROM mining_fuel_tanks WHERE site_id = ? AND status = 'active'`,
          [siteId]
        ),
        pool.query(
          `SELECT COUNT(*) AS crew_count,
                  COALESCE(SUM(actual_headcount), 0) AS crew_headcount,
                  SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS pending_crews
           FROM mining_shift_crews
           WHERE site_id = ? AND shift_date BETWEEN ? AND ?`,
          [siteId, from, to]
        ),
        pool.query(
          `SELECT COUNT(*) AS closing_count,
                  SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS pending_closings
           FROM mining_site_closings
           WHERE site_id = ? AND period_end BETWEEN ? AND ?`,
          [siteId, from, to]
        ),
        pool.query(
          `SELECT COALESCE(SUM(quantity), 0) AS production_quantity
           FROM mining_production_records
           WHERE site_id = ? AND DATE(production_datetime) BETWEEN ? AND ?`,
          [siteId, from, to]
        ),
        pool.query(
          `SELECT COALESCE(SUM(amount), 0) AS operating_cost
           FROM mining_expenses
           WHERE site_id = ? AND expense_date BETWEEN ? AND ?`,
          [siteId, from, to]
        ),
        pool.query(
          `SELECT COALESCE(SUM(working_hours), 0) AS working_hours,
                  COALESCE(SUM(idle_hours), 0) AS idle_hours,
                  COALESCE(SUM(breakdown_hours), 0) AS breakdown_hours
           FROM mining_equipment_logs
           WHERE site_id = ? AND work_date BETWEEN ? AND ?`,
          [siteId, from, to]
        ),
        pool.query(
          `SELECT SUM(CASE WHEN status IN ('open', 'investigating') THEN 1 ELSE 0 END) AS open_incidents,
                  SUM(CASE WHEN severity IN ('high', 'critical') AND status <> 'closed' THEN 1 ELSE 0 END) AS serious_incidents
           FROM mining_incidents WHERE site_id = ?`,
          [siteId]
        ),
      ]);

      const summary = {
        ...(stockpileRows[0] || {}),
        ...(dispatchRows[0] || {}),
        ...(fuelRows[0] || {}),
        ...(crewRows[0] || {}),
        ...(closingRows[0] || {}),
        ...(productionRows[0] || {}),
        ...(expenseRows[0] || {}),
        ...(equipmentRows[0] || {}),
        ...(incidentRows[0] || {}),
      };
      const production = Number(summary.production_quantity || 0);
      const cost = Number(summary.operating_cost || 0);
      const hours = Number(summary.working_hours || 0);
      summary.cost_per_unit = production > 0 ? Number((cost / production).toFixed(2)) : null;
      summary.utilization_percent = hours + Number(summary.idle_hours || 0) + Number(summary.breakdown_hours || 0) > 0
        ? Number((hours / (hours + Number(summary.idle_hours || 0) + Number(summary.breakdown_hours || 0)) * 100).toFixed(2))
        : null;

      res.json({ status: "success", period: { from, to }, summary });
    } catch (error) {
      sendError(res, error, "Could not load the Mining Control dashboard.");
    }
  }
);

// GET /api/mining-control/reference-data
router.get(
  "/reference-data",
  requireAnyPermission(
    "mining.stockpiles.view",
    "mining.dispatch.view",
    "mining.fuel_control.view",
    "mining.workforce.view",
    "mining.closing.view"
  ),
  async (req, res) => {
    try {
      const siteId = req.miningSiteScope.siteId;
      const [[stockpiles], [tanks], [contractors], [workers], [assets]] = await Promise.all([
        pool.query(
          `SELECT * FROM mining_stockpiles WHERE site_id = ? AND status = 'active' ORDER BY stockpile_name`,
          [siteId]
        ),
        pool.query(
          `SELECT * FROM mining_fuel_tanks WHERE site_id = ? AND status = 'active' ORDER BY tank_name`,
          [siteId]
        ),
        pool.query(
          `SELECT * FROM mining_contractors WHERE site_id = ? AND status = 'active' ORDER BY contractor_name`,
          [siteId]
        ),
        pool.query(
          `SELECT DISTINCT wp.id, wp.employee_number, wp.full_name, wp.job_title,
                  wp.employment_status,
                  MIN(CASE WHEN wl.expiry_date IS NOT NULL THEN wl.expiry_date END) AS nearest_license_expiry,
                  SUM(CASE WHEN wpa.status = 'issued' AND LOWER(wpa.property_type) LIKE '%ppe%' THEN 1 ELSE 0 END) AS ppe_items
           FROM worker_profiles wp
           INNER JOIN worker_assignments wa ON wa.worker_id = wp.id
           LEFT JOIN worker_licenses wl ON wl.worker_id = wp.id AND wl.status = 'valid'
           LEFT JOIN worker_property_assignments wpa ON wpa.worker_id = wp.id
           WHERE wa.workspace_code = 'mining'
             AND wa.context_id = ?
             AND wa.is_active = TRUE
             AND wp.employment_status = 'active'
           GROUP BY wp.id
           ORDER BY wp.full_name`,
          [siteId]
        ),
        pool.query(
          `SELECT id, asset_code, asset_name, make, model, current_meter
           FROM fleet_assets
           WHERE is_active = TRUE
           ORDER BY asset_code`,
          []
        ),
      ]);
      res.json({ status: "success", stockpiles, tanks, contractors, workers, assets });
    } catch (error) {
      sendError(res, error, "Could not load Mining Control reference data.");
    }
  }
);

// GET /api/mining-control/stockpiles
router.get("/stockpiles", requirePermission("mining.stockpiles.view"), async (req, res) => {
  try {
    const [stockpiles] = await pool.query(
      `SELECT ms.*, creator.full_name AS created_by_name,
              CASE WHEN ms.current_quantity <= ms.minimum_quantity THEN TRUE ELSE FALSE END AS is_low
       FROM mining_stockpiles ms
       LEFT JOIN users creator ON creator.id = ms.created_by
       WHERE ms.site_id = ?
       ORDER BY ms.status = 'active' DESC, ms.stockpile_name`,
      [req.miningSiteScope.siteId]
    );
    res.json({ status: "success", stockpiles });
  } catch (error) {
    sendError(res, error, "Could not load stockpiles.");
  }
});

// POST /api/mining-control/stockpiles
router.post("/stockpiles", requirePermission("mining.stockpiles.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const siteId = req.miningSiteScope.siteId;
    const code = cleanText(req.body.stockpile_code, 60).toUpperCase();
    const name = cleanText(req.body.stockpile_name, 160);
    const unit = cleanText(req.body.unit || req.miningSiteScope.site?.production_unit || "tonnes", 40);
    const opening = nonNegativeNumber(req.body.opening_quantity, "Opening quantity");
    const minimum = nonNegativeNumber(req.body.minimum_quantity, "Minimum quantity");
    const capacity = req.body.capacity_quantity === "" || req.body.capacity_quantity == null
      ? null
      : positiveNumber(req.body.capacity_quantity, "Capacity quantity");
    if (!code || !name) throw appError("Stockpile code and name are required.");
    if (capacity != null && opening > capacity) throw appError("Opening quantity cannot exceed capacity.");

    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO mining_stockpiles (
         site_id, stockpile_code, stockpile_name, material_type, grade_quality,
         unit, physical_location, capacity_quantity, minimum_quantity,
         opening_quantity, current_quantity, notes, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        siteId,
        code,
        name,
        nullableText(req.body.material_type, 120),
        nullableText(req.body.grade_quality, 120),
        unit,
        nullableText(req.body.physical_location, 255),
        capacity,
        minimum,
        opening,
        opening,
        nullableText(req.body.notes, 4000),
        req.user.id,
        req.user.id,
      ]
    );

    if (opening > 0) {
      const movementNumber = await nextDocumentNumber("MSTK", { userId: req.user.id });
      await insertStockpileMovement(connection, {
        movementNumber,
        siteId,
        stockpileId: result.insertId,
        movementType: "opening",
        direction: "in",
        quantity: opening,
        balanceBefore: 0,
        balanceAfter: opening,
        unit,
        movementDatetime: new Date().toISOString().slice(0, 19).replace("T", " "),
        externalReference: nullableText(req.body.opening_reference, 160),
        explanation: "Opening stockpile balance",
        userId: req.user.id,
      });
    }

    await connection.commit();
    await audit(req, "MINING_STOCKPILE_CREATE", `Created stockpile ${code} - ${name}.`, "mining_stockpile", result.insertId);
    res.status(201).json({ status: "success", message: "Stockpile created successfully.", stockpile_id: result.insertId });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    sendError(res, error, "Could not create the stockpile.");
  } finally {
    connection.release();
  }
});

// GET /api/mining-control/stockpile-movements
router.get("/stockpile-movements", requirePermission("mining.stockpiles.view"), async (req, res) => {
  try {
    const [movements] = await pool.query(
      `SELECT m.*, s.stockpile_code, s.stockpile_name,
              rs.stockpile_code AS related_stockpile_code,
              u.full_name AS created_by_name
       FROM mining_stockpile_movements m
       INNER JOIN mining_stockpiles s ON s.id = m.stockpile_id
       LEFT JOIN mining_stockpiles rs ON rs.id = m.related_stockpile_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.site_id = ?
       ORDER BY m.movement_datetime DESC, m.id DESC
       LIMIT 500`,
      [req.miningSiteScope.siteId]
    );
    res.json({ status: "success", movements });
  } catch (error) {
    sendError(res, error, "Could not load stockpile movements.");
  }
});

// POST /api/mining-control/stockpile-movements
router.post("/stockpile-movements", requirePermission("mining.stockpiles.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const siteId = req.miningSiteScope.siteId;
    const type = cleanText(req.body.movement_type, 40).toLowerCase();
    if (!STOCKPILE_MOVEMENT_TYPES.has(type)) throw appError("Invalid stockpile movement type.");
    const sourceId = positiveId(req.body.stockpile_id);
    const destinationId = positiveId(req.body.destination_stockpile_id);
    const productionRecordId = positiveId(req.body.production_record_id);
    const quantity = positiveNumber(req.body.quantity, "Quantity");
    const movementAt = dateTime(req.body.movement_datetime);
    if (!sourceId) throw appError("Choose a stockpile.");

    await connection.beginTransaction();

    if (type === "transfer") {
      if (!destinationId || destinationId === sourceId) throw appError("Choose a different destination stockpile.");
      const orderedIds = [sourceId, destinationId].sort((a, b) => a - b);
      const [lockedRows] = await connection.query(
        `SELECT * FROM mining_stockpiles
         WHERE site_id = ? AND id IN (?, ?)
         ORDER BY id FOR UPDATE`,
        [siteId, orderedIds[0], orderedIds[1]]
      );
      const source = lockedRows.find((row) => Number(row.id) === sourceId);
      const destination = lockedRows.find((row) => Number(row.id) === destinationId);
      if (!source || !destination) throw appError("One of the selected stockpiles was not found.", 404);
      if (source.unit !== destination.unit) throw appError("Stockpile transfer units must match.");
      if (Number(source.current_quantity) < quantity) throw appError("Transfer exceeds the available stockpile balance.", 409, "INSUFFICIENT_STOCKPILE_BALANCE");
      if (destination.capacity_quantity != null && Number(destination.current_quantity) + quantity > Number(destination.capacity_quantity)) {
        throw appError("Transfer would exceed the destination stockpile capacity.", 409);
      }
      const groupNumber = await nextDocumentNumber("MSTK", { userId: req.user.id });
      const outNumber = await nextDocumentNumber("MSTK", { userId: req.user.id });
      const inNumber = await nextDocumentNumber("MSTK", { userId: req.user.id });
      const sourceBefore = Number(source.current_quantity);
      const destinationBefore = Number(destination.current_quantity);
      const sourceAfter = Number((sourceBefore - quantity).toFixed(3));
      const destinationAfter = Number((destinationBefore + quantity).toFixed(3));
      await connection.query(`UPDATE mining_stockpiles SET current_quantity = ?, updated_by = ? WHERE id = ?`, [sourceAfter, req.user.id, sourceId]);
      await connection.query(`UPDATE mining_stockpiles SET current_quantity = ?, updated_by = ? WHERE id = ?`, [destinationAfter, req.user.id, destinationId]);
      await insertStockpileMovement(connection, {
        movementNumber: outNumber,
        movementGroupNumber: groupNumber,
        siteId,
        stockpileId: sourceId,
        relatedStockpileId: destinationId,
        movementType: "transfer_out",
        direction: "out",
        quantity,
        balanceBefore: sourceBefore,
        balanceAfter: sourceAfter,
        unit: source.unit,
        movementDatetime: movementAt,
        externalReference: nullableText(req.body.external_reference, 160),
        evidenceReference: nullableText(req.body.evidence_reference, 500),
        explanation: nullableText(req.body.explanation, 4000),
        userId: req.user.id,
      });
      await insertStockpileMovement(connection, {
        movementNumber: inNumber,
        movementGroupNumber: groupNumber,
        siteId,
        stockpileId: destinationId,
        relatedStockpileId: sourceId,
        movementType: "transfer_in",
        direction: "in",
        quantity,
        balanceBefore: destinationBefore,
        balanceAfter: destinationAfter,
        unit: destination.unit,
        movementDatetime: movementAt,
        externalReference: nullableText(req.body.external_reference, 160),
        evidenceReference: nullableText(req.body.evidence_reference, 500),
        explanation: nullableText(req.body.explanation, 4000),
        userId: req.user.id,
      });
      await connection.commit();
      await audit(req, "MINING_STOCKPILE_TRANSFER", `Transferred ${quantity} ${source.unit} from ${source.stockpile_code} to ${destination.stockpile_code}.`, "mining_stockpile", sourceId);
      return res.status(201).json({ status: "success", message: "Stockpile transfer posted successfully.", movement_group_number: groupNumber });
    }

    const stockpile = await lockStockpile(connection, sourceId, siteId);
    if (productionRecordId) {
      const [productionRows] = await connection.query(
        `SELECT id, site_id, quantity, unit FROM mining_production_records WHERE id = ? LIMIT 1`,
        [productionRecordId]
      );
      if (!productionRows.length || Number(productionRows[0].site_id) !== siteId) {
        throw appError("The selected production record was not found in this site.", 404);
      }
    }
    const direction = type === "production" || type === "adjustment_in" ? "in" : "out";
    const before = Number(stockpile.current_quantity);
    const after = Number((before + (direction === "in" ? quantity : -quantity)).toFixed(3));
    if (after < 0) throw appError("Movement exceeds the available stockpile balance.", 409, "INSUFFICIENT_STOCKPILE_BALANCE");
    if (stockpile.capacity_quantity != null && after > Number(stockpile.capacity_quantity)) {
      throw appError("Movement would exceed the stockpile capacity.", 409);
    }
    const movementNumber = await nextDocumentNumber("MSTK", { userId: req.user.id });
    await connection.query(`UPDATE mining_stockpiles SET current_quantity = ?, updated_by = ? WHERE id = ?`, [after, req.user.id, sourceId]);
    await insertStockpileMovement(connection, {
      movementNumber,
      siteId,
      stockpileId: sourceId,
      productionRecordId,
      movementType: type,
      direction,
      quantity,
      balanceBefore: before,
      balanceAfter: after,
      unit: stockpile.unit,
      movementDatetime: movementAt,
      externalReference: nullableText(req.body.external_reference, 160),
      evidenceReference: nullableText(req.body.evidence_reference, 500),
      explanation: nullableText(req.body.explanation, 4000),
      userId: req.user.id,
    });
    await connection.commit();
    await audit(req, "MINING_STOCKPILE_MOVEMENT", `Posted ${type} movement ${movementNumber}.`, "mining_stockpile", sourceId);
    res.status(201).json({ status: "success", message: "Stockpile movement posted successfully.", movement_number: movementNumber });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    sendError(res, error, "Could not post the stockpile movement.");
  } finally {
    connection.release();
  }
});

// GET /api/mining-control/dispatches
router.get("/dispatches", requirePermission("mining.dispatch.view"), async (req, res) => {
  try {
    const [dispatches] = await pool.query(
      `SELECT d.*, s.stockpile_code, s.stockpile_name,
              creator.full_name AS created_by_name,
              approver.full_name AS approved_by_name
       FROM mining_dispatches d
       INNER JOIN mining_stockpiles s ON s.id = d.stockpile_id
       LEFT JOIN users creator ON creator.id = d.created_by
       LEFT JOIN users approver ON approver.id = d.approved_by
       WHERE d.site_id = ?
       ORDER BY d.dispatch_datetime DESC, d.id DESC
       LIMIT 500`,
      [req.miningSiteScope.siteId]
    );
    res.json({ status: "success", dispatches });
  } catch (error) {
    sendError(res, error, "Could not load Mining dispatches.");
  }
});

// POST /api/mining-control/dispatches
router.post("/dispatches", requirePermission("mining.dispatch.manage"), async (req, res) => {
  try {
    const siteId = req.miningSiteScope.siteId;
    const stockpileId = positiveId(req.body.stockpile_id);
    const quantity = positiveNumber(req.body.quantity, "Dispatch quantity");
    const destination = cleanText(req.body.destination, 255);
    if (!stockpileId || !destination) throw appError("Stockpile and destination are required.");
    const [stockpiles] = await pool.query(`SELECT * FROM mining_stockpiles WHERE id = ? AND site_id = ? LIMIT 1`, [stockpileId, siteId]);
    const stockpile = stockpiles[0];
    if (!stockpile) throw appError("Stockpile not found in this site.", 404);
    if (Number(stockpile.current_quantity) < quantity) throw appError("Dispatch exceeds the current stockpile balance.", 409, "INSUFFICIENT_STOCKPILE_BALANCE");
    const dispatchNumber = await nextDocumentNumber("MDSP", { userId: req.user.id });
    const netWeight = req.body.net_weight === "" || req.body.net_weight == null ? null : nonNegativeNumber(req.body.net_weight, "Net weight");
    const grossWeight = req.body.gross_weight === "" || req.body.gross_weight == null ? null : nonNegativeNumber(req.body.gross_weight, "Gross weight");
    const tareWeight = req.body.tare_weight === "" || req.body.tare_weight == null ? null : nonNegativeNumber(req.body.tare_weight, "Tare weight");
    const [result] = await pool.query(
      `INSERT INTO mining_dispatches (
         dispatch_number, site_id, stockpile_id, dispatch_datetime, quantity,
         unit, customer_name, destination, receiver_name, receiver_phone,
         haulage_company, vehicle_registration, driver_name, driver_phone,
         weighbridge_ticket, gross_weight, tare_weight, net_weight,
         evidence_reference, notes, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
      [
        dispatchNumber,
        siteId,
        stockpileId,
        dateTime(req.body.dispatch_datetime),
        quantity,
        stockpile.unit,
        nullableText(req.body.customer_name, 180),
        destination,
        nullableText(req.body.receiver_name, 180),
        nullableText(req.body.receiver_phone, 40),
        nullableText(req.body.haulage_company, 180),
        nullableText(req.body.vehicle_registration, 80),
        nullableText(req.body.driver_name, 180),
        nullableText(req.body.driver_phone, 40),
        nullableText(req.body.weighbridge_ticket, 120),
        grossWeight,
        tareWeight,
        netWeight,
        nullableText(req.body.evidence_reference, 500),
        nullableText(req.body.notes, 4000),
        req.user.id,
      ]
    );
    await audit(req, "MINING_DISPATCH_SUBMIT", `Submitted Mining dispatch ${dispatchNumber}.`, "mining_dispatch", result.insertId);
    res.status(201).json({ status: "success", message: "Dispatch submitted for independent approval.", dispatch_id: result.insertId, dispatch_number: dispatchNumber });
  } catch (error) {
    sendError(res, error, "Could not create the Mining dispatch.");
  }
});

// PATCH /api/mining-control/dispatches/:id/approve
router.patch("/dispatches/:id/approve", requirePermission("mining.dispatch.approve"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const siteId = req.miningSiteScope.siteId;
    const dispatchId = positiveId(req.params.id);
    if (!dispatchId) throw appError("Invalid dispatch ID.");
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT * FROM mining_dispatches WHERE id = ? LIMIT 1 FOR UPDATE`, [dispatchId]);
    const dispatch = rows[0];
    if (!dispatch) throw appError("Dispatch not found.", 404);
    assertRecordInMiningSite(req.miningSiteScope, dispatch.site_id, "Dispatch");
    if (dispatch.status !== "submitted") throw appError("Only submitted dispatches can be approved.", 409);
    if (Number(dispatch.created_by) === Number(req.user.id)) {
      throw appError("Independent approval is required. The creator cannot approve this dispatch.", 403, "INDEPENDENT_APPROVAL_REQUIRED");
    }
    const stockpile = await lockStockpile(connection, dispatch.stockpile_id, siteId);
    const before = Number(stockpile.current_quantity);
    const quantity = Number(dispatch.quantity);
    if (before < quantity) throw appError("Available stockpile balance is no longer sufficient for this dispatch.", 409, "INSUFFICIENT_STOCKPILE_BALANCE");
    const after = Number((before - quantity).toFixed(3));
    const movementNumber = await nextDocumentNumber("MSTK", { userId: req.user.id });
    await connection.query(`UPDATE mining_stockpiles SET current_quantity = ?, updated_by = ? WHERE id = ?`, [after, req.user.id, stockpile.id]);
    const movementId = await insertStockpileMovement(connection, {
      movementNumber,
      siteId,
      stockpileId: stockpile.id,
      dispatchId,
      movementType: "dispatch",
      direction: "out",
      quantity,
      balanceBefore: before,
      balanceAfter: after,
      unit: stockpile.unit,
      movementDatetime: dispatch.dispatch_datetime,
      externalReference: dispatch.dispatch_number,
      evidenceReference: dispatch.evidence_reference,
      explanation: `Approved dispatch to ${dispatch.destination}`,
      userId: req.user.id,
    });
    await connection.query(
      `UPDATE mining_dispatches
       SET status = 'approved', movement_id = ?, approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [movementId, req.user.id, dispatchId]
    );
    await connection.commit();
    await audit(req, "MINING_DISPATCH_APPROVE", `Approved Mining dispatch ${dispatch.dispatch_number}.`, "mining_dispatch", dispatchId);
    res.json({ status: "success", message: "Dispatch approved and stockpile balance updated.", movement_number: movementNumber });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    sendError(res, error, "Could not approve the Mining dispatch.");
  } finally {
    connection.release();
  }
});

// PATCH /api/mining-control/dispatches/:id/cancel
router.patch("/dispatches/:id/cancel", requirePermission("mining.dispatch.manage"), async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    const reason = cleanText(req.body.reason, 500);
    if (!id || reason.length < 5) throw appError("Enter a clear cancellation reason.");
    const [rows] = await pool.query(`SELECT * FROM mining_dispatches WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length) throw appError("Dispatch not found.", 404);
    assertRecordInMiningSite(req.miningSiteScope, rows[0].site_id, "Dispatch");
    if (rows[0].status !== "submitted") throw appError("Only submitted dispatches can be cancelled.", 409);
    await pool.query(
      `UPDATE mining_dispatches
       SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW(), cancellation_reason = ?
       WHERE id = ?`,
      [req.user.id, reason, id]
    );
    await audit(req, "MINING_DISPATCH_CANCEL", `Cancelled Mining dispatch ${rows[0].dispatch_number}.`, "mining_dispatch", id);
    res.json({ status: "success", message: "Dispatch cancelled successfully." });
  } catch (error) {
    sendError(res, error, "Could not cancel the Mining dispatch.");
  }
});

// GET /api/mining-control/dispatches/:id/pdf
router.get("/dispatches/:id/pdf", requirePermission("mining.dispatch.view"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.*, s.stockpile_code, s.stockpile_name, ms.site_code, ms.site_name, ms.location,
              creator.full_name AS prepared_by_name, approver.full_name AS approved_by_name
       FROM mining_dispatches d
       INNER JOIN mining_stockpiles s ON s.id = d.stockpile_id
       INNER JOIN mining_sites ms ON ms.id = d.site_id
       LEFT JOIN users creator ON creator.id = d.created_by
       LEFT JOIN users approver ON approver.id = d.approved_by
       WHERE d.id = ? LIMIT 1`,
      [positiveId(req.params.id)]
    );
    const record = rows[0];
    if (!record) throw appError("Dispatch not found.", 404);
    assertRecordInMiningSite(req.miningSiteScope, record.site_id, "Dispatch");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${record.dispatch_number}.pdf"`);
    const doc = new PDFDocument({ size: "A4", margin: 46, info: { Title: `Mining Dispatch ${record.dispatch_number}` } });
    doc.pipe(res);
    doc.fontSize(18).font("Helvetica-Bold").text("CHALIN 03 COMPANY LIMITED", { align: "center" });
    doc.fontSize(11).font("Helvetica").text("MINING MATERIAL DISPATCH NOTE", { align: "center" });
    doc.moveDown(1.2);
    const lines = [
      ["Dispatch Number", record.dispatch_number],
      ["Status", cleanText(record.status).toUpperCase()],
      ["Mining Site", `${record.site_code} — ${record.site_name}`],
      ["Site Location", record.location || "—"],
      ["Stockpile", `${record.stockpile_code} — ${record.stockpile_name}`],
      ["Dispatch Date", new Date(record.dispatch_datetime).toLocaleString("en-GH")],
      ["Quantity", `${record.quantity} ${record.unit}`],
      ["Customer", record.customer_name || "—"],
      ["Destination", record.destination || "—"],
      ["Receiver", record.receiver_name || "—"],
      ["Receiver Phone", record.receiver_phone || "—"],
      ["Haulage Company", record.haulage_company || "—"],
      ["Vehicle", record.vehicle_registration || "—"],
      ["Driver", record.driver_name || "—"],
      ["Driver Phone", record.driver_phone || "—"],
      ["Weighbridge Ticket", record.weighbridge_ticket || "—"],
      ["Gross / Tare / Net", `${record.gross_weight || "—"} / ${record.tare_weight || "—"} / ${record.net_weight || "—"}`],
      ["Evidence Reference", record.evidence_reference || "—"],
      ["Prepared By", record.prepared_by_name || "—"],
      ["Approved By", record.approved_by_name || "Pending approval"],
    ];
    for (const [label, value] of lines) {
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(9).text(label, 46, y, { width: 130 });
      doc.font("Helvetica").fontSize(9).text(String(value), 180, y, { width: 365 });
      doc.moveDown(0.55);
      if (doc.y > 730) doc.addPage();
    }
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Notes");
    doc.font("Helvetica").text(record.notes || "No additional notes.");
    doc.moveDown(2);
    doc.text("Prepared signature: __________________________");
    doc.moveDown(1.2);
    doc.text("Approved signature: __________________________");
    doc.moveDown(1.2);
    doc.text("Receiver signature: __________________________");
    doc.end();
  } catch (error) {
    if (!res.headersSent) sendError(res, error, "Could not generate the dispatch note.");
  }
});

// GET /api/mining-control/fuel-tanks
router.get("/fuel-tanks", requirePermission("mining.fuel_control.view"), async (req, res) => {
  try {
    const [tanks] = await pool.query(
      `SELECT t.*, CASE WHEN t.current_balance_litres <= t.minimum_level_litres THEN TRUE ELSE FALSE END AS is_low
       FROM mining_fuel_tanks t WHERE t.site_id = ? ORDER BY t.status = 'active' DESC, t.tank_name`,
      [req.miningSiteScope.siteId]
    );
    res.json({ status: "success", tanks });
  } catch (error) {
    sendError(res, error, "Could not load fuel tanks.");
  }
});

// POST /api/mining-control/fuel-tanks
router.post("/fuel-tanks", requirePermission("mining.fuel_control.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const siteId = req.miningSiteScope.siteId;
    const code = cleanText(req.body.tank_code, 60).toUpperCase();
    const name = cleanText(req.body.tank_name, 160);
    const capacity = positiveNumber(req.body.capacity_litres, "Tank capacity", 2);
    const opening = nonNegativeNumber(req.body.opening_balance_litres, "Opening balance", 2);
    const minimum = nonNegativeNumber(req.body.minimum_level_litres, "Minimum level", 2);
    if (!code || !name) throw appError("Tank code and name are required.");
    if (opening > capacity) throw appError("Opening fuel balance cannot exceed tank capacity.");
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO mining_fuel_tanks (
         site_id, tank_code, tank_name, fuel_type, physical_location,
         capacity_litres, minimum_level_litres, opening_balance_litres,
         current_balance_litres, notes, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [siteId, code, name, cleanText(req.body.fuel_type || "diesel", 60), nullableText(req.body.physical_location, 255), capacity, minimum, opening, opening, nullableText(req.body.notes, 4000), req.user.id, req.user.id]
    );
    if (opening > 0) {
      const number = await nextDocumentNumber("MFUE", { userId: req.user.id });
      await insertFuelTransaction(connection, {
        transactionNumber: number,
        siteId,
        tankId: result.insertId,
        transactionType: "opening",
        direction: "in",
        transactionDatetime: new Date().toISOString().slice(0, 19).replace("T", " "),
        quantity: opening,
        balanceBefore: 0,
        balanceAfter: opening,
        referenceNumber: nullableText(req.body.opening_reference, 160),
        notes: "Opening tank balance",
        userId: req.user.id,
      });
    }
    await connection.commit();
    await audit(req, "MINING_FUEL_TANK_CREATE", `Created fuel tank ${code} - ${name}.`, "mining_fuel_tank", result.insertId);
    res.status(201).json({ status: "success", message: "Fuel tank created successfully.", tank_id: result.insertId });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    sendError(res, error, "Could not create the fuel tank.");
  } finally { connection.release(); }
});

// GET /api/mining-control/fuel-transactions
router.get("/fuel-transactions", requirePermission("mining.fuel_control.view"), async (req, res) => {
  try {
    const [transactions] = await pool.query(
      `SELECT ft.*, t.tank_code, t.tank_name, rt.tank_code AS related_tank_code,
              fa.asset_code, fa.asset_name, u.full_name AS created_by_name
       FROM mining_fuel_transactions ft
       INNER JOIN mining_fuel_tanks t ON t.id = ft.tank_id
       LEFT JOIN mining_fuel_tanks rt ON rt.id = ft.related_tank_id
       LEFT JOIN fleet_assets fa ON fa.id = ft.asset_id
       LEFT JOIN users u ON u.id = ft.created_by
       WHERE ft.site_id = ?
       ORDER BY ft.transaction_datetime DESC, ft.id DESC
       LIMIT 500`,
      [req.miningSiteScope.siteId]
    );
    res.json({ status: "success", transactions });
  } catch (error) {
    sendError(res, error, "Could not load fuel transactions.");
  }
});

// POST /api/mining-control/fuel-transactions
router.post("/fuel-transactions", requirePermission("mining.fuel_control.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const siteId = req.miningSiteScope.siteId;
    const type = cleanText(req.body.transaction_type, 40).toLowerCase();
    if (!FUEL_TRANSACTION_TYPES.has(type)) throw appError("Invalid fuel transaction type.");
    const tankId = positiveId(req.body.tank_id);
    const relatedTankId = positiveId(req.body.destination_tank_id);
    const quantity = positiveNumber(req.body.quantity_litres, "Fuel quantity", 2);
    const at = dateTime(req.body.transaction_datetime);
    const assetId = positiveId(req.body.asset_id);
    const unitCost = nonNegativeNumber(req.body.unit_cost, "Unit cost", 2);
    if (!tankId) throw appError("Choose a fuel tank.");
    if (type === "issue" && !assetId && !cleanText(req.body.recipient_name, 180)) {
      throw appError("Fuel issues require an equipment asset or recipient name.");
    }
    await connection.beginTransaction();

    if (type === "transfer") {
      if (!relatedTankId || relatedTankId === tankId) throw appError("Choose a different destination fuel tank.");
      const ids = [tankId, relatedTankId].sort((a, b) => a - b);
      const [rows] = await connection.query(
        `SELECT * FROM mining_fuel_tanks WHERE site_id = ? AND id IN (?, ?) ORDER BY id FOR UPDATE`,
        [siteId, ids[0], ids[1]]
      );
      const source = rows.find((row) => Number(row.id) === tankId);
      const destination = rows.find((row) => Number(row.id) === relatedTankId);
      if (!source || !destination) throw appError("One of the selected tanks was not found.", 404);
      if (source.fuel_type !== destination.fuel_type) throw appError("Fuel transfers require matching fuel types.");
      if (Number(source.current_balance_litres) < quantity) throw appError("Transfer exceeds the available fuel balance.", 409, "INSUFFICIENT_FUEL_BALANCE");
      if (Number(destination.current_balance_litres) + quantity > Number(destination.capacity_litres)) throw appError("Transfer would exceed destination tank capacity.", 409);
      const group = await nextDocumentNumber("MFUE", { userId: req.user.id });
      const outNumber = await nextDocumentNumber("MFUE", { userId: req.user.id });
      const inNumber = await nextDocumentNumber("MFUE", { userId: req.user.id });
      const sourceBefore = Number(source.current_balance_litres);
      const destinationBefore = Number(destination.current_balance_litres);
      const sourceAfter = Number((sourceBefore - quantity).toFixed(2));
      const destinationAfter = Number((destinationBefore + quantity).toFixed(2));
      await connection.query(`UPDATE mining_fuel_tanks SET current_balance_litres = ?, updated_by = ? WHERE id = ?`, [sourceAfter, req.user.id, tankId]);
      await connection.query(`UPDATE mining_fuel_tanks SET current_balance_litres = ?, updated_by = ? WHERE id = ?`, [destinationAfter, req.user.id, relatedTankId]);
      await insertFuelTransaction(connection, {
        transactionNumber: outNumber,
        transferGroupNumber: group,
        siteId,
        tankId,
        relatedTankId,
        transactionType: "transfer_out",
        direction: "out",
        transactionDatetime: at,
        quantity,
        balanceBefore: sourceBefore,
        balanceAfter: sourceAfter,
        unitCost,
        referenceNumber: nullableText(req.body.reference_number, 160),
        evidenceReference: nullableText(req.body.evidence_reference, 500),
        notes: nullableText(req.body.notes, 4000),
        userId: req.user.id,
      });
      await insertFuelTransaction(connection, {
        transactionNumber: inNumber,
        transferGroupNumber: group,
        siteId,
        tankId: relatedTankId,
        relatedTankId: tankId,
        transactionType: "transfer_in",
        direction: "in",
        transactionDatetime: at,
        quantity,
        balanceBefore: destinationBefore,
        balanceAfter: destinationAfter,
        unitCost,
        referenceNumber: nullableText(req.body.reference_number, 160),
        evidenceReference: nullableText(req.body.evidence_reference, 500),
        notes: nullableText(req.body.notes, 4000),
        userId: req.user.id,
      });
      await connection.commit();
      await audit(req, "MINING_FUEL_TRANSFER", `Transferred ${quantity} litres between fuel tanks.`, "mining_fuel_tank", tankId);
      return res.status(201).json({ status: "success", message: "Fuel transfer posted successfully.", transfer_group_number: group });
    }

    const tank = await lockFuelTank(connection, tankId, siteId);
    const direction = type === "receipt" || type === "adjustment_in" ? "in" : "out";
    const before = Number(tank.current_balance_litres);
    const after = Number((before + (direction === "in" ? quantity : -quantity)).toFixed(2));
    if (after < 0) throw appError("Fuel issue exceeds the available tank balance.", 409, "INSUFFICIENT_FUEL_BALANCE");
    if (after > Number(tank.capacity_litres)) throw appError("Fuel receipt would exceed tank capacity.", 409);
    const number = await nextDocumentNumber("MFUE", { userId: req.user.id });
    await connection.query(`UPDATE mining_fuel_tanks SET current_balance_litres = ?, updated_by = ? WHERE id = ?`, [after, req.user.id, tankId]);
    await insertFuelTransaction(connection, {
      transactionNumber: number,
      siteId,
      tankId,
      assetId,
      transactionType: type,
      direction,
      transactionDatetime: at,
      quantity,
      balanceBefore: before,
      balanceAfter: after,
      unitCost,
      meterReading: req.body.meter_reading === "" || req.body.meter_reading == null ? null : nonNegativeNumber(req.body.meter_reading, "Meter reading", 2),
      supplierOrSource: nullableText(req.body.supplier_or_source, 180),
      recipientName: nullableText(req.body.recipient_name, 180),
      referenceNumber: nullableText(req.body.reference_number, 160),
      evidenceReference: nullableText(req.body.evidence_reference, 500),
      notes: nullableText(req.body.notes, 4000),
      userId: req.user.id,
    });
    await connection.commit();
    await audit(req, "MINING_FUEL_TRANSACTION", `Posted fuel ${type} ${number}.`, "mining_fuel_tank", tankId);
    res.status(201).json({ status: "success", message: "Fuel transaction posted successfully.", transaction_number: number });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    sendError(res, error, "Could not post the fuel transaction.");
  } finally { connection.release(); }
});

// GET /api/mining-control/fuel-reconciliations
router.get("/fuel-reconciliations", requirePermission("mining.fuel_control.view"), async (req, res) => {
  try {
    const [reconciliations] = await pool.query(
      `SELECT r.*, t.tank_code, t.tank_name,
              creator.full_name AS created_by_name, approver.full_name AS approved_by_name
       FROM mining_fuel_reconciliations r
       INNER JOIN mining_fuel_tanks t ON t.id = r.tank_id
       LEFT JOIN users creator ON creator.id = r.created_by
       LEFT JOIN users approver ON approver.id = r.approved_by
       WHERE r.site_id = ?
       ORDER BY r.reconciliation_datetime DESC, r.id DESC
       LIMIT 300`,
      [req.miningSiteScope.siteId]
    );
    res.json({ status: "success", reconciliations });
  } catch (error) {
    sendError(res, error, "Could not load fuel reconciliations.");
  }
});

// POST /api/mining-control/fuel-reconciliations
router.post("/fuel-reconciliations", requirePermission("mining.fuel_control.manage"), async (req, res) => {
  try {
    const siteId = req.miningSiteScope.siteId;
    const tankId = positiveId(req.body.tank_id);
    const physical = nonNegativeNumber(req.body.physical_balance_litres, "Physical fuel balance", 2);
    if (!tankId) throw appError("Choose a fuel tank.");
    const [tanks] = await pool.query(`SELECT * FROM mining_fuel_tanks WHERE id = ? AND site_id = ? LIMIT 1`, [tankId, siteId]);
    const tank = tanks[0];
    if (!tank) throw appError("Fuel tank not found.", 404);
    if (physical > Number(tank.capacity_litres)) throw appError("Physical balance cannot exceed tank capacity.");
    const expected = Number(tank.current_balance_litres);
    const variance = Number((physical - expected).toFixed(2));
    const variancePercent = expected > 0 ? Number((variance / expected * 100).toFixed(4)) : 0;
    const number = await nextDocumentNumber("MFRC", { userId: req.user.id });
    const [result] = await pool.query(
      `INSERT INTO mining_fuel_reconciliations (
         reconciliation_number, site_id, tank_id, reconciliation_datetime,
         expected_balance_litres, physical_balance_litres, variance_litres,
         variance_percent, dip_reference, evidence_reference, explanation,
         status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
      [number, siteId, tankId, dateTime(req.body.reconciliation_datetime), expected, physical, variance, variancePercent, nullableText(req.body.dip_reference, 160), nullableText(req.body.evidence_reference, 500), nullableText(req.body.explanation, 4000), req.user.id]
    );
    await audit(req, "MINING_FUEL_RECONCILIATION_SUBMIT", `Submitted fuel reconciliation ${number} with variance ${variance} litres.`, "mining_fuel_reconciliation", result.insertId);
    res.status(201).json({ status: "success", message: "Fuel reconciliation submitted for independent approval.", reconciliation_id: result.insertId, reconciliation_number: number, variance_litres: variance });
  } catch (error) {
    sendError(res, error, "Could not submit the fuel reconciliation.");
  }
});

// PATCH /api/mining-control/fuel-reconciliations/:id/approve
router.patch("/fuel-reconciliations/:id/approve", requirePermission("mining.fuel_control.approve"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const id = positiveId(req.params.id);
    const siteId = req.miningSiteScope.siteId;
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT * FROM mining_fuel_reconciliations WHERE id = ? LIMIT 1 FOR UPDATE`, [id]);
    const record = rows[0];
    if (!record) throw appError("Fuel reconciliation not found.", 404);
    assertRecordInMiningSite(req.miningSiteScope, record.site_id, "Fuel reconciliation");
    if (record.status !== "submitted") throw appError("Only submitted fuel reconciliations can be approved.", 409);
    if (Number(record.created_by) === Number(req.user.id)) throw appError("Independent approval is required. The creator cannot approve this reconciliation.", 403, "INDEPENDENT_APPROVAL_REQUIRED");
    const tank = await lockFuelTank(connection, record.tank_id, siteId);
    const before = Number(tank.current_balance_litres);
    const physical = Number(record.physical_balance_litres);
    if (physical > Number(tank.capacity_litres)) throw appError("Physical balance exceeds tank capacity.", 409);
    let adjustmentId = null;
    const adjustment = Number((physical - before).toFixed(2));
    if (Math.abs(adjustment) >= 0.01) {
      const number = await nextDocumentNumber("MFUE", { userId: req.user.id });
      adjustmentId = await insertFuelTransaction(connection, {
        transactionNumber: number,
        siteId,
        tankId: tank.id,
        transactionType: adjustment >= 0 ? "reconciliation_adjustment_in" : "reconciliation_adjustment_out",
        direction: adjustment >= 0 ? "in" : "out",
        transactionDatetime: new Date().toISOString().slice(0, 19).replace("T", " "),
        quantity: Math.abs(adjustment),
        balanceBefore: before,
        balanceAfter: physical,
        referenceNumber: record.reconciliation_number,
        evidenceReference: record.evidence_reference,
        notes: record.explanation,
        userId: req.user.id,
      });
    }
    await connection.query(`UPDATE mining_fuel_tanks SET current_balance_litres = ?, updated_by = ? WHERE id = ?`, [physical, req.user.id, tank.id]);
    await connection.query(
      `UPDATE mining_fuel_reconciliations
       SET status = 'approved', adjustment_transaction_id = ?, approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [adjustmentId, req.user.id, id]
    );
    await connection.commit();
    await audit(req, "MINING_FUEL_RECONCILIATION_APPROVE", `Approved fuel reconciliation ${record.reconciliation_number}.`, "mining_fuel_reconciliation", id);
    res.json({ status: "success", message: "Fuel reconciliation approved and tank balance aligned to the physical count." });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    sendError(res, error, "Could not approve the fuel reconciliation.");
  } finally { connection.release(); }
});

// GET /api/mining-control/fuel-consumption
router.get("/fuel-consumption", requirePermission("mining.fuel_control.view"), async (req, res) => {
  try {
    const siteId = req.miningSiteScope.siteId;
    const from = cleanText(req.query.from, 20) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = cleanText(req.query.to, 20) || new Date().toISOString().slice(0, 10);
    const [rows] = await pool.query(
      `SELECT fa.id AS asset_id, fa.asset_code, fa.asset_name,
              COALESCE(fuel.fuel_litres, 0) AS fuel_litres,
              COALESCE(hours.working_hours, 0) AS working_hours,
              CASE WHEN COALESCE(hours.working_hours, 0) > 0
                   THEN ROUND(COALESCE(fuel.fuel_litres, 0) / hours.working_hours, 3)
                   ELSE NULL END AS litres_per_hour
       FROM fleet_assets fa
       LEFT JOIN (
         SELECT asset_id, SUM(quantity_litres) AS fuel_litres
         FROM mining_fuel_transactions
         WHERE site_id = ? AND direction = 'out' AND transaction_type = 'issue'
           AND DATE(transaction_datetime) BETWEEN ? AND ?
         GROUP BY asset_id
       ) fuel ON fuel.asset_id = fa.id
       LEFT JOIN (
         SELECT asset_id, SUM(working_hours) AS working_hours
         FROM mining_equipment_logs
         WHERE site_id = ? AND work_date BETWEEN ? AND ?
         GROUP BY asset_id
       ) hours ON hours.asset_id = fa.id
       WHERE fuel.asset_id IS NOT NULL OR hours.asset_id IS NOT NULL
       ORDER BY litres_per_hour DESC, fa.asset_code`,
      [siteId, from, to, siteId, from, to]
    );
    const siteAverage = rows.reduce((sum, row) => sum + Number(row.fuel_litres || 0), 0) /
      Math.max(rows.reduce((sum, row) => sum + Number(row.working_hours || 0), 0), 1);
    const threshold = Number(req.query.alert_percent || 30);
    const consumption = rows.map((row) => ({
      ...row,
      abnormal: row.litres_per_hour != null && siteAverage > 0 && Number(row.litres_per_hour) > siteAverage * (1 + threshold / 100),
    }));
    res.json({ status: "success", period: { from, to }, site_average_litres_per_hour: Number(siteAverage.toFixed(3)), consumption });
  } catch (error) {
    sendError(res, error, "Could not calculate equipment fuel consumption.");
  }
});

// GET /api/mining-control/contractors
router.get("/contractors", requirePermission("mining.workforce.view"), async (req, res) => {
  try {
    const [contractors] = await pool.query(`SELECT * FROM mining_contractors WHERE site_id = ? ORDER BY status = 'active' DESC, contractor_name`, [req.miningSiteScope.siteId]);
    res.json({ status: "success", contractors });
  } catch (error) { sendError(res, error, "Could not load contractors."); }
});

// POST /api/mining-control/contractors
router.post("/contractors", requirePermission("mining.workforce.manage"), async (req, res) => {
  try {
    const code = cleanText(req.body.contractor_code, 60).toUpperCase();
    const name = cleanText(req.body.contractor_name, 180);
    if (!code || !name) throw appError("Contractor code and name are required.");
    const [result] = await pool.query(
      `INSERT INTO mining_contractors (
         site_id, contractor_code, contractor_name, registration_number,
         service_type, contact_person, phone, email, address,
         agreement_reference, notes, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.miningSiteScope.siteId, code, name, nullableText(req.body.registration_number, 120), nullableText(req.body.service_type, 120), nullableText(req.body.contact_person, 180), nullableText(req.body.phone, 40), nullableText(req.body.email, 180), nullableText(req.body.address, 255), nullableText(req.body.agreement_reference, 500), nullableText(req.body.notes, 4000), req.user.id, req.user.id]
    );
    await audit(req, "MINING_CONTRACTOR_CREATE", `Created Mining contractor ${code} - ${name}.`, "mining_contractor", result.insertId);
    res.status(201).json({ status: "success", message: "Contractor created successfully.", contractor_id: result.insertId });
  } catch (error) { sendError(res, error, "Could not create the contractor."); }
});

// GET /api/mining-control/crews
router.get("/crews", requirePermission("mining.workforce.view"), async (req, res) => {
  try {
    const [crews] = await pool.query(
      `SELECT c.*, supervisor.full_name AS supervisor_name,
              contractor.contractor_name, creator.full_name AS created_by_name,
              approver.full_name AS approved_by_name,
              COUNT(member.id) AS member_count
       FROM mining_shift_crews c
       LEFT JOIN worker_profiles supervisor ON supervisor.id = c.supervisor_worker_id
       LEFT JOIN mining_contractors contractor ON contractor.id = c.contractor_id
       LEFT JOIN users creator ON creator.id = c.created_by
       LEFT JOIN users approver ON approver.id = c.approved_by
       LEFT JOIN mining_shift_crew_members member ON member.crew_id = c.id
       WHERE c.site_id = ?
       GROUP BY c.id
       ORDER BY c.shift_date DESC, c.id DESC
       LIMIT 300`,
      [req.miningSiteScope.siteId]
    );
    const crewIds = crews.map((crew) => crew.id);
    let members = [];
    if (crewIds.length) {
      const placeholders = crewIds.map(() => "?").join(",");
      [members] = await pool.query(
        `SELECT m.*, wp.employee_number, wp.full_name
         FROM mining_shift_crew_members m
         LEFT JOIN worker_profiles wp ON wp.id = m.worker_id
         WHERE m.crew_id IN (${placeholders})
         ORDER BY m.crew_id, COALESCE(wp.full_name, m.external_worker_name)`,
        crewIds
      );
    }
    const memberMap = new Map();
    for (const member of members) {
      if (!memberMap.has(member.crew_id)) memberMap.set(member.crew_id, []);
      memberMap.get(member.crew_id).push(member);
    }
    res.json({ status: "success", crews: crews.map((crew) => ({ ...crew, members: memberMap.get(crew.id) || [] })) });
  } catch (error) { sendError(res, error, "Could not load shift crews."); }
});

// POST /api/mining-control/crews
router.post("/crews", requirePermission("mining.workforce.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const siteId = req.miningSiteScope.siteId;
    const shiftCode = cleanText(req.body.shift_code || "day", 30).toLowerCase();
    if (!SHIFT_CODES.has(shiftCode)) throw appError("Invalid shift code.");
    const members = Array.isArray(req.body.members) ? req.body.members.slice(0, 250) : [];
    const workerIds = [...new Set(members.map((member) => positiveId(member.worker_id)).filter(Boolean))];
    if (workerIds.length) {
      const placeholders = workerIds.map(() => "?").join(",");
      const [assigned] = await connection.query(
        `SELECT DISTINCT wa.worker_id
         FROM worker_assignments wa
         WHERE wa.workspace_code = 'mining' AND wa.context_id = ? AND wa.is_active = TRUE
           AND wa.worker_id IN (${placeholders})`,
        [siteId, ...workerIds]
      );
      const allowed = new Set(assigned.map((row) => Number(row.worker_id)));
      const outside = workerIds.filter((id) => !allowed.has(id));
      if (outside.length) throw appError("One or more selected workers are not actively assigned to this Mining site.", 403, "WORKER_SITE_ASSIGNMENT_REQUIRED");
    }
    const crewNumber = await nextDocumentNumber("MCRW", { userId: req.user.id });
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO mining_shift_crews (
         crew_number, site_id, shift_date, shift_code, supervisor_worker_id,
         contractor_id, work_area, planned_headcount, actual_headcount,
         ppe_confirmed, licence_confirmed, toolbox_talk_confirmed,
         attendance_confirmed, notes, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
      [crewNumber, siteId, dateOnly(req.body.shift_date, "Shift date"), shiftCode, positiveId(req.body.supervisor_worker_id), positiveId(req.body.contractor_id), nullableText(req.body.work_area, 180), nonNegativeNumber(req.body.planned_headcount || members.length, "Planned headcount", 0), members.length, booleanValue(req.body.ppe_confirmed), booleanValue(req.body.licence_confirmed), booleanValue(req.body.toolbox_talk_confirmed), booleanValue(req.body.attendance_confirmed), nullableText(req.body.notes, 4000), req.user.id]
    );
    for (const member of members) {
      const workerId = positiveId(member.worker_id);
      const externalName = nullableText(member.external_worker_name, 180);
      if (!workerId && !externalName) continue;
      await connection.query(
        `INSERT INTO mining_shift_crew_members (
           crew_id, worker_id, external_worker_name, role_or_task,
           attendance_status, ppe_status, licence_status, hours_worked, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, workerId, externalName, nullableText(member.role_or_task, 160), cleanText(member.attendance_status || "present", 30), cleanText(member.ppe_status || "confirmed", 30), cleanText(member.licence_status || "not_required", 30), nonNegativeNumber(member.hours_worked, "Hours worked", 2), nullableText(member.notes, 500)]
      );
    }
    await connection.commit();
    await audit(req, "MINING_CREW_SUBMIT", `Submitted shift crew ${crewNumber} with ${members.length} members.`, "mining_shift_crew", result.insertId);
    res.status(201).json({ status: "success", message: "Shift crew submitted for approval.", crew_id: result.insertId, crew_number: crewNumber });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    sendError(res, error, "Could not create the shift crew.");
  } finally { connection.release(); }
});

// PATCH /api/mining-control/crews/:id/approve
router.patch("/crews/:id/approve", requirePermission("mining.workforce.approve"), async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    const [rows] = await pool.query(`SELECT * FROM mining_shift_crews WHERE id = ? LIMIT 1`, [id]);
    const crew = rows[0];
    if (!crew) throw appError("Shift crew not found.", 404);
    assertRecordInMiningSite(req.miningSiteScope, crew.site_id, "Shift crew");
    if (crew.status !== "submitted") throw appError("Only submitted shift crews can be approved.", 409);
    if (Number(crew.created_by) === Number(req.user.id)) throw appError("Independent approval is required. The creator cannot approve this crew.", 403, "INDEPENDENT_APPROVAL_REQUIRED");
    await pool.query(`UPDATE mining_shift_crews SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`, [req.user.id, id]);
    await audit(req, "MINING_CREW_APPROVE", `Approved shift crew ${crew.crew_number}.`, "mining_shift_crew", id);
    res.json({ status: "success", message: "Shift crew approved successfully." });
  } catch (error) { sendError(res, error, "Could not approve the shift crew."); }
});

// GET /api/mining-control/workforce-warnings
router.get("/workforce-warnings", requirePermission("mining.workforce.view"), async (req, res) => {
  try {
    const siteId = req.miningSiteScope.siteId;
    const [warnings] = await pool.query(
      `SELECT wp.id AS worker_id, wp.employee_number, wp.full_name, wp.job_title,
              wl.license_type, wl.license_number, wl.expiry_date,
              CASE
                WHEN wl.expiry_date < CURDATE() THEN 'expired'
                WHEN wl.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN 'expiring'
                ELSE 'valid'
              END AS warning_type
       FROM worker_profiles wp
       INNER JOIN worker_assignments wa ON wa.worker_id = wp.id
       INNER JOIN worker_licenses wl ON wl.worker_id = wp.id AND wl.status = 'valid'
       WHERE wa.workspace_code = 'mining' AND wa.context_id = ? AND wa.is_active = TRUE
         AND wl.expiry_date IS NOT NULL
         AND wl.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)
       ORDER BY wl.expiry_date, wp.full_name`,
      [siteId]
    );
    res.json({ status: "success", warnings });
  } catch (error) { sendError(res, error, "Could not load workforce warnings."); }
});

// GET /api/mining-control/closings
router.get("/closings", requirePermission("mining.closing.view"), async (req, res) => {
  try {
    const [closings] = await pool.query(
      `SELECT c.*, creator.full_name AS created_by_name, approver.full_name AS approved_by_name
       FROM mining_site_closings c
       LEFT JOIN users creator ON creator.id = c.created_by
       LEFT JOIN users approver ON approver.id = c.approved_by
       WHERE c.site_id = ?
       ORDER BY c.period_end DESC, c.id DESC
       LIMIT 300`,
      [req.miningSiteScope.siteId]
    );
    res.json({ status: "success", closings });
  } catch (error) { sendError(res, error, "Could not load Mining site closings."); }
});

// POST /api/mining-control/closings
router.post("/closings", requirePermission("mining.closing.manage"), async (req, res) => {
  try {
    const type = cleanText(req.body.closing_type || "daily", 30).toLowerCase();
    if (!CLOSING_TYPES.has(type)) throw appError("Invalid closing type.");
    const start = dateOnly(req.body.period_start, "Period start");
    const end = dateOnly(req.body.period_end, "Period end");
    if (start > end) throw appError("Period start cannot be after period end.");
    const number = await nextDocumentNumber("MSCL", { userId: req.user.id });
    const [result] = await pool.query(
      `INSERT INTO mining_site_closings (
         closing_number, site_id, closing_type, period_start, period_end,
         production_complete, stockpile_reconciled, fuel_reconciled,
         equipment_logs_complete, workforce_confirmed, expenses_recorded,
         incidents_reviewed, corrective_actions_reviewed,
         management_notes, exceptions_notes, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
      [number, req.miningSiteScope.siteId, type, start, end, booleanValue(req.body.production_complete), booleanValue(req.body.stockpile_reconciled), booleanValue(req.body.fuel_reconciled), booleanValue(req.body.equipment_logs_complete), booleanValue(req.body.workforce_confirmed), booleanValue(req.body.expenses_recorded), booleanValue(req.body.incidents_reviewed), booleanValue(req.body.corrective_actions_reviewed), nullableText(req.body.management_notes, 4000), nullableText(req.body.exceptions_notes, 4000), req.user.id]
    );
    await audit(req, "MINING_SITE_CLOSE_SUBMIT", `Submitted Mining site closing ${number} for ${start} to ${end}.`, "mining_site_closing", result.insertId);
    res.status(201).json({ status: "success", message: "Mining site closing submitted for independent approval.", closing_id: result.insertId, closing_number: number });
  } catch (error) { sendError(res, error, "Could not submit the Mining site closing."); }
});

// PATCH /api/mining-control/closings/:id/approve
router.patch("/closings/:id/approve", requirePermission("mining.closing.approve"), async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    const [rows] = await pool.query(`SELECT * FROM mining_site_closings WHERE id = ? LIMIT 1`, [id]);
    const closing = rows[0];
    if (!closing) throw appError("Mining site closing not found.", 404);
    assertRecordInMiningSite(req.miningSiteScope, closing.site_id, "Mining site closing");
    if (closing.status !== "submitted") throw appError("Only submitted Mining site closings can be approved.", 409);
    if (Number(closing.created_by) === Number(req.user.id)) throw appError("Independent approval is required. The creator cannot approve this closing.", 403, "INDEPENDENT_APPROVAL_REQUIRED");
    await pool.query(`UPDATE mining_site_closings SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`, [req.user.id, id]);
    await audit(req, "MINING_SITE_CLOSE_APPROVE", `Approved Mining site closing ${closing.closing_number}.`, "mining_site_closing", id);
    res.json({ status: "success", message: "Mining site closing approved successfully." });
  } catch (error) { sendError(res, error, "Could not approve the Mining site closing."); }
});

// GET /api/mining-control/intelligence
router.get("/intelligence", requirePermission("mining.closing.view"), async (req, res) => {
  try {
    const siteId = req.miningSiteScope.siteId;
    const from = dateOnly(req.query.from || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), "From date");
    const to = dateOnly(req.query.to || new Date().toISOString().slice(0, 10), "To date");
    const [[production], [expense], [fuel], [equipment], [incidents], [dispatch], [corrective]] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(quantity),0) quantity, COUNT(*) records FROM mining_production_records WHERE site_id=? AND DATE(production_datetime) BETWEEN ? AND ?`, [siteId, from, to]),
      pool.query(`SELECT COALESCE(SUM(amount),0) amount, COUNT(*) records FROM mining_expenses WHERE site_id=? AND expense_date BETWEEN ? AND ?`, [siteId, from, to]),
      pool.query(`SELECT COALESCE(SUM(CASE WHEN direction='out' AND transaction_type='issue' THEN quantity_litres ELSE 0 END),0) issued_litres FROM mining_fuel_transactions WHERE site_id=? AND DATE(transaction_datetime) BETWEEN ? AND ?`, [siteId, from, to]),
      pool.query(`SELECT COALESCE(SUM(working_hours),0) working_hours, COALESCE(SUM(idle_hours),0) idle_hours, COALESCE(SUM(breakdown_hours),0) breakdown_hours FROM mining_equipment_logs WHERE site_id=? AND work_date BETWEEN ? AND ?`, [siteId, from, to]),
      pool.query(`SELECT COUNT(*) incidents, SUM(CASE WHEN severity IN ('high','critical') THEN 1 ELSE 0 END) serious_incidents FROM mining_incidents WHERE site_id=? AND DATE(incident_datetime) BETWEEN ? AND ?`, [siteId, from, to]),
      pool.query(`SELECT COALESCE(SUM(quantity),0) dispatched_quantity, COUNT(*) dispatch_count FROM mining_dispatches WHERE site_id=? AND status='approved' AND DATE(dispatch_datetime) BETWEEN ? AND ?`, [siteId, from, to]),
      pool.query(`SELECT SUM(CASE WHEN corrective_action IS NOT NULL AND corrective_action <> '' AND status <> 'closed' THEN 1 ELSE 0 END) open_corrective_actions FROM mining_incidents WHERE site_id=?`, [siteId]),
    ]);
    const produced = Number(production[0]?.quantity || 0);
    const cost = Number(expense[0]?.amount || 0);
    const fuelLitres = Number(fuel[0]?.issued_litres || 0);
    const workingHours = Number(equipment[0]?.working_hours || 0);
    const totalEquipmentHours = workingHours + Number(equipment[0]?.idle_hours || 0) + Number(equipment[0]?.breakdown_hours || 0);
    res.json({
      status: "success",
      period: { from, to },
      intelligence: {
        production_quantity: produced,
        operating_cost: cost,
        cost_per_production_unit: produced > 0 ? Number((cost / produced).toFixed(2)) : null,
        fuel_issued_litres: fuelLitres,
        fuel_per_production_unit: produced > 0 ? Number((fuelLitres / produced).toFixed(3)) : null,
        working_hours: workingHours,
        equipment_utilization_percent: totalEquipmentHours > 0 ? Number((workingHours / totalEquipmentHours * 100).toFixed(2)) : null,
        breakdown_hours: Number(equipment[0]?.breakdown_hours || 0),
        incidents: Number(incidents[0]?.incidents || 0),
        serious_incidents: Number(incidents[0]?.serious_incidents || 0),
        dispatched_quantity: Number(dispatch[0]?.dispatched_quantity || 0),
        dispatch_count: Number(dispatch[0]?.dispatch_count || 0),
        open_corrective_actions: Number(corrective[0]?.open_corrective_actions || 0),
      },
    });
  } catch (error) { sendError(res, error, "Could not load Mining intelligence."); }
});

module.exports = router;
