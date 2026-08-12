const { pool } = require("../config/db");
const {
  UNIT_STATUSES,
  assertUnitTransition,
  normalizeUnitCode,
} = require("./inventoryTraceabilityService");
const { appendUnitEvent } = require("./inventoryTraceabilityRepositoryService");

const QUARANTINE_OUTCOMES = Object.freeze({
  RESTOCK: "restock",
  DAMAGED: "damaged",
  WRITTEN_OFF: "written_off",
});

function quarantineError(message, statusCode = 400, code = "RETURN_QUARANTINE_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function positiveInt(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw quarantineError(`${fieldName} must be a positive whole number.`, 400, "INVALID_QUARANTINE_NUMBER");
  }
  return number;
}

function normalizeOutcome(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (!Object.values(QUARANTINE_OUTCOMES).includes(clean)) {
    throw quarantineError("Inspection outcome must be restock, damaged or written_off.", 400, "INVALID_QUARANTINE_OUTCOME");
  }
  return clean;
}

function cleanNotes(value) {
  const notes = String(value || "").trim();
  if (notes.length < 8) {
    throw quarantineError("Inspection notes must explain what was checked and why this outcome is correct.", 400, "QUARANTINE_INSPECTION_NOTES_REQUIRED");
  }
  return notes.slice(0, 1000);
}

function outcomeStatus(outcome) {
  if (outcome === QUARANTINE_OUTCOMES.RESTOCK) return UNIT_STATUSES.ACTIVE;
  if (outcome === QUARANTINE_OUTCOMES.DAMAGED) return UNIT_STATUSES.DAMAGED;
  return UNIT_STATUSES.WRITTEN_OFF;
}

async function listReturnQuarantine({ branchId, limit = 100 }) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanLimit = Math.min(250, Math.max(1, Number(limit) || 100));
  const [rows] = await pool.query(
    `SELECT
       u.id,
       u.unit_code,
       u.product_id,
       u.status,
       u.return_id,
       u.sale_id,
       u.sale_item_id,
       u.status_changed_at,
       u.last_verified_at,
       p.name AS product_name,
       p.size,
       p.category,
       p.inventory_product_code,
       p.inventory_risk_tier,
       r.reason AS return_reason,
       r.return_type,
       r.refund_amount,
       r.refund_method,
       r.created_at AS returned_at,
       s.receipt_number,
       s.customer_name,
       s.customer_phone
     FROM inventory_units u
     INNER JOIN products p ON p.id = u.product_id
     LEFT JOIN returns r ON r.id = u.return_id
     LEFT JOIN sales s ON s.id = u.sale_id
     WHERE u.current_branch_id = ?
       AND u.status = 'returned_quarantine'
     ORDER BY
       FIELD(p.inventory_risk_tier, 'critical', 'high', 'elevated', 'standard'),
       u.status_changed_at ASC,
       u.id ASC
     LIMIT ?`,
    [cleanBranchId, cleanLimit]
  );
  return rows;
}

async function inspectReturnQuarantine({
  branchId,
  unitCode,
  outcome,
  inspectedBy,
  notes,
  requestId = null,
}) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanInspector = positiveInt(inspectedBy, "inspectedBy");
  const cleanCode = normalizeUnitCode(unitCode);
  const cleanOutcome = normalizeOutcome(outcome);
  const cleanNotes = cleanNotesValue(notes);
  const targetStatus = outcomeStatus(cleanOutcome);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT
         u.id, u.unit_code, u.product_id, u.current_branch_id,
         u.status, u.return_id, u.sale_id,
         p.name AS product_name, p.quantity AS product_quantity
       FROM inventory_units u
       INNER JOIN products p ON p.id = u.product_id
       WHERE u.unit_code = ? AND u.current_branch_id = ?
       LIMIT 1
       FOR UPDATE`,
      [cleanCode, cleanBranchId]
    );
    const unit = rows[0];
    if (!unit) {
      throw quarantineError("Returned physical unit was not found in this store.", 404, "QUARANTINE_UNIT_NOT_FOUND");
    }
    if (unit.status !== UNIT_STATUSES.RETURNED_QUARANTINE) {
      throw quarantineError(
        `${cleanCode} is no longer awaiting return inspection; current status is ${unit.status}.`,
        409,
        "QUARANTINE_UNIT_NOT_PENDING"
      );
    }
    assertUnitTransition(unit.status, targetStatus);

    if (cleanOutcome === QUARANTINE_OUTCOMES.WRITTEN_OFF) {
      const [quantityResult] = await connection.query(
        `UPDATE products
         SET quantity = quantity - 1
         WHERE id = ? AND branch_id = ? AND quantity > 0`,
        [unit.product_id, cleanBranchId]
      );
      if (Number(quantityResult.affectedRows || 0) !== 1) {
        throw quarantineError(
          "Physical inventory quantity could not be reduced safely for this write-off.",
          409,
          "QUARANTINE_WRITEOFF_QUANTITY_CONFLICT"
        );
      }
    }

    const [updateResult] = await connection.query(
      `UPDATE inventory_units
       SET status = ?,
           last_verified_by = ?,
           last_verified_at = NOW(),
           status_changed_at = NOW()
       WHERE id = ? AND status = 'returned_quarantine'`,
      [targetStatus, cleanInspector, unit.id]
    );
    if (Number(updateResult.affectedRows || 0) !== 1) {
      throw quarantineError(
        "The returned unit changed during inspection. Refresh and inspect it again.",
        409,
        "QUARANTINE_INSPECTION_CONFLICT"
      );
    }

    await appendUnitEvent(connection, {
      unitId: unit.id,
      branchId: cleanBranchId,
      eventType: "return_quarantine_inspected",
      fromStatus: UNIT_STATUSES.RETURNED_QUARANTINE,
      toStatus: targetStatus,
      sourceType: "return_inspection",
      sourceId: unit.return_id || null,
      actorUserId: cleanInspector,
      reason: cleanNotes,
      requestId,
      metadata: {
        inspection_outcome: cleanOutcome,
        return_id: unit.return_id || null,
        sale_id: unit.sale_id || null,
        product_id: unit.product_id,
        product_name: unit.product_name,
        aggregate_quantity_changed: cleanOutcome === QUARANTINE_OUTCOMES.WRITTEN_OFF,
      },
    });

    await connection.commit();
    return {
      unit_code: cleanCode,
      product_id: unit.product_id,
      product_name: unit.product_name,
      previous_status: UNIT_STATUSES.RETURNED_QUARANTINE,
      status: targetStatus,
      outcome: cleanOutcome,
      sellable: targetStatus === UNIT_STATUSES.ACTIVE,
      aggregate_quantity_changed: cleanOutcome === QUARANTINE_OUTCOMES.WRITTEN_OFF,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

function cleanNotesValue(value) {
  return cleanNotes(value);
}

module.exports = {
  QUARANTINE_OUTCOMES,
  inspectReturnQuarantine,
  listReturnQuarantine,
  normalizeOutcome,
  outcomeStatus,
};
