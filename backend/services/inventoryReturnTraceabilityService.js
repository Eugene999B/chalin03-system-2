const {
  TRACEABILITY_STATES,
  TRACKING_MODES,
  UNIT_STATUSES,
  assertUnitTransition,
  normalizeUnitCode,
} = require("./inventoryTraceabilityService");
const { appendUnitEvent } = require("./inventoryTraceabilityRepositoryService");

function returnTraceabilityError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeReturnUnitSelection(values) {
  if (!Array.isArray(values)) return [];
  const normalized = values.map((value) => normalizeUnitCode(value));
  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length) {
    throw returnTraceabilityError(
      "The same physical unit ID cannot appear more than once in a return.",
      400,
      "TRACEABILITY_DUPLICATE_RETURN_UNIT"
    );
  }
  return unique;
}

function returnUnitIdsRequired(product) {
  return (
    String(product?.inventory_tracking_mode || "").toLowerCase() ===
      TRACKING_MODES.SERIALIZED &&
    String(product?.inventory_traceability_state || "").toLowerCase() ===
      TRACEABILITY_STATES.ENFORCED
  );
}

async function lockReturnUnitSelection(
  connection,
  { branchId, saleId, product, quantity, unitCodes }
) {
  const required = returnUnitIdsRequired(product);
  const cleanQuantity = Number(quantity);
  const codes = normalizeReturnUnitSelection(unitCodes);

  if (!required) {
    if (codes.length > 0) {
      throw returnTraceabilityError(
        "Physical unit IDs are only accepted here for enforced serialized returns.",
        409,
        "TRACEABILITY_RETURN_UNIT_IDS_NOT_REQUIRED"
      );
    }
    return { required: false, unit_codes: [], units: [] };
  }

  if (codes.length !== cleanQuantity) {
    throw returnTraceabilityError(
      `${product.name || "This serialized product"} requires exactly ${cleanQuantity} returned physical unit ID${cleanQuantity === 1 ? "" : "s"}.`,
      409,
      "TRACEABILITY_RETURN_UNIT_COUNT_MISMATCH"
    );
  }

  const placeholders = codes.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT
       id,
       unit_code,
       product_id,
       current_branch_id,
       status,
       sale_id,
       sale_item_id,
       return_id
     FROM inventory_units
     WHERE unit_code IN (${placeholders})
     ORDER BY id ASC
     FOR UPDATE`,
    codes
  );

  if (rows.length !== codes.length) {
    const found = new Set(rows.map((row) => row.unit_code));
    const missing = codes.filter((code) => !found.has(code));
    throw returnTraceabilityError(
      `Returned physical unit ${missing.join(", ")} was not found.`,
      404,
      "TRACEABILITY_RETURN_UNIT_NOT_FOUND"
    );
  }

  const byCode = new Map(rows.map((row) => [row.unit_code, row]));
  const ordered = codes.map((code) => byCode.get(code));
  for (const unit of ordered) {
    if (Number(unit.product_id) !== Number(product.id)) {
      throw returnTraceabilityError(
        `${unit.unit_code} belongs to another product and cannot be returned against ${product.name || "this item"}.`,
        409,
        "TRACEABILITY_RETURN_UNIT_WRONG_PRODUCT"
      );
    }
    if (Number(unit.current_branch_id) !== Number(branchId)) {
      throw returnTraceabilityError(
        `${unit.unit_code} belongs to another store. Resolve its location before recording the return.`,
        409,
        "TRACEABILITY_RETURN_UNIT_WRONG_STORE"
      );
    }
    if (Number(unit.sale_id) !== Number(saleId)) {
      throw returnTraceabilityError(
        `${unit.unit_code} was not sold on this receipt.`,
        409,
        "TRACEABILITY_RETURN_UNIT_WRONG_SALE"
      );
    }
    if (unit.status !== UNIT_STATUSES.SOLD || unit.return_id) {
      throw returnTraceabilityError(
        `${unit.unit_code} cannot be returned because its current status is ${unit.status || "unknown"}.`,
        409,
        unit.return_id
          ? "TRACEABILITY_RETURN_UNIT_ALREADY_RETURNED"
          : "TRACEABILITY_RETURN_UNIT_NOT_SOLD"
      );
    }
    assertUnitTransition(unit.status, UNIT_STATUSES.RETURNED_QUARANTINE);
  }

  return { required: true, unit_codes: codes, units: ordered };
}

async function markReturnUnitsQuarantined(
  connection,
  {
    branchId,
    returnId,
    saleId,
    productId,
    unitCodes,
    actorUserId,
    reason,
    requestId = null,
  }
) {
  const codes = normalizeReturnUnitSelection(unitCodes);
  if (codes.length === 0) return [];

  const results = [];
  for (const code of codes) {
    const [rows] = await connection.query(
      `SELECT id, unit_code, status, sale_id, product_id, current_branch_id, return_id
       FROM inventory_units
       WHERE unit_code = ?
       LIMIT 1
       FOR UPDATE`,
      [code]
    );
    const unit = rows[0];
    if (
      !unit ||
      Number(unit.product_id) !== Number(productId) ||
      Number(unit.current_branch_id) !== Number(branchId) ||
      Number(unit.sale_id) !== Number(saleId) ||
      unit.status !== UNIT_STATUSES.SOLD ||
      unit.return_id
    ) {
      throw returnTraceabilityError(
        `${code} changed after return verification. The return was not committed; scan the physical units again.`,
        409,
        "TRACEABILITY_RETURN_UNIT_COMMIT_CONFLICT"
      );
    }

    assertUnitTransition(unit.status, UNIT_STATUSES.RETURNED_QUARANTINE);
    const [updateResult] = await connection.query(
      `UPDATE inventory_units
       SET status = ?,
           return_id = ?,
           last_verified_by = ?,
           last_verified_at = NOW(),
           status_changed_at = NOW()
       WHERE id = ?
         AND status = ?
         AND sale_id = ?
         AND return_id IS NULL`,
      [
        UNIT_STATUSES.RETURNED_QUARANTINE,
        Number(returnId),
        actorUserId || null,
        unit.id,
        UNIT_STATUSES.SOLD,
        Number(saleId),
      ]
    );
    if (Number(updateResult.affectedRows || 0) !== 1) {
      throw returnTraceabilityError(
        `${code} changed while the return was being saved. No partial return was committed.`,
        409,
        "TRACEABILITY_RETURN_UNIT_COMMIT_CONFLICT"
      );
    }

    await appendUnitEvent(connection, {
      unitId: unit.id,
      branchId,
      eventType: "return_received_quarantine",
      fromStatus: UNIT_STATUSES.SOLD,
      toStatus: UNIT_STATUSES.RETURNED_QUARANTINE,
      sourceType: "return",
      sourceId: Number(returnId),
      actorUserId: actorUserId || null,
      reason: reason || "Physical serialized unit returned",
      requestId,
      metadata: {
        sale_id: Number(saleId),
        return_id: Number(returnId),
        product_id: Number(productId),
        unit_code: code,
      },
    });

    results.push({
      id: unit.id,
      unit_code: code,
      status: UNIT_STATUSES.RETURNED_QUARANTINE,
      return_id: Number(returnId),
    });
  }
  return results;
}

module.exports = {
  lockReturnUnitSelection,
  markReturnUnitsQuarantined,
  normalizeReturnUnitSelection,
  returnUnitIdsRequired,
};
