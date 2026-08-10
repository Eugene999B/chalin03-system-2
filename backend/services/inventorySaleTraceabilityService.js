const {
  TRACEABILITY_STATES,
  TRACKING_MODES,
  UNIT_STATUSES,
  normalizeUnitCode,
} = require("./inventoryTraceabilityService");
const {
  appendUnitEvent,
  positiveInt,
} = require("./inventoryTraceabilityRepositoryService");

function traceabilityError(message, statusCode, code, metadata = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.metadata = metadata;
  return error;
}

function normalizeUnitSelection(values) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) {
    throw traceabilityError(
      "Serialized unit IDs must be provided as a list.",
      400,
      "TRACEABILITY_UNIT_LIST_REQUIRED"
    );
  }
  const codes = values.map(normalizeUnitCode);
  const unique = [...new Set(codes)];
  if (unique.length !== codes.length) {
    throw traceabilityError(
      "The same physical inventory unit cannot appear twice in one sale item.",
      400,
      "TRACEABILITY_DUPLICATE_UNIT_IN_ITEM"
    );
  }
  return unique;
}

function productTracking(product) {
  return {
    mode: String(product?.inventory_tracking_mode || TRACKING_MODES.QUANTITY).toLowerCase(),
    state: String(product?.inventory_traceability_state || TRACEABILITY_STATES.OFF).toLowerCase(),
  };
}

async function lockSaleUnitSelection(
  connection,
  {
    branchId,
    product,
    quantity,
    unitCodes,
    seenUnitCodes = new Set(),
  }
) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanProductId = positiveInt(product?.id, "productId");
  const cleanQuantity = positiveInt(quantity, "quantity");
  const selectedCodes = normalizeUnitSelection(unitCodes);
  const tracking = productTracking(product);

  if (tracking.mode !== TRACKING_MODES.SERIALIZED) {
    if (selectedCodes.length > 0) {
      throw traceabilityError(
        `${product?.name || "This product"} is not unit-serialized and must not receive physical unit IDs in the sale request.`,
        400,
        "TRACEABILITY_UNIT_IDS_NOT_ALLOWED"
      );
    }
    return {
      required: false,
      product_id: cleanProductId,
      unit_codes: [],
      units: [],
    };
  }

  const required = tracking.state === TRACEABILITY_STATES.ENFORCED;
  if (required && selectedCodes.length !== cleanQuantity) {
    throw traceabilityError(
      `${product?.name || "Serialized product"} requires exactly ${cleanQuantity} physical unit ID${cleanQuantity === 1 ? "" : "s"} before the sale can be completed.`,
      409,
      "TRACEABILITY_SALE_UNIT_COUNT_MISMATCH",
      {
        product_id: cleanProductId,
        quantity: cleanQuantity,
        selected_count: selectedCodes.length,
      }
    );
  }

  // During setup, unit IDs are optional so the owner can test the workflow before
  // switching the product to enforced. When provided, they are still fully validated
  // and committed to the exact sale.
  if (selectedCodes.length === 0) {
    return {
      required,
      product_id: cleanProductId,
      unit_codes: [],
      units: [],
    };
  }

  for (const code of selectedCodes) {
    if (seenUnitCodes.has(code)) {
      throw traceabilityError(
        `Physical unit ${code} was selected more than once in this sale.`,
        400,
        "TRACEABILITY_DUPLICATE_UNIT_IN_SALE"
      );
    }
    seenUnitCodes.add(code);
  }

  const placeholders = selectedCodes.map(() => "?").join(", ");
  const [units] = await connection.query(
    `SELECT
       u.id,
       u.unit_code,
       u.product_id,
       u.current_branch_id,
       u.status,
       u.sale_id,
       u.sale_item_id,
       p.name AS product_name
     FROM inventory_units u
     INNER JOIN products p ON p.id = u.product_id
     WHERE u.unit_code IN (${placeholders})
     ORDER BY u.unit_code ASC
     FOR UPDATE`,
    selectedCodes
  );

  const byCode = new Map(units.map((unit) => [unit.unit_code, unit]));
  for (const code of selectedCodes) {
    const unit = byCode.get(code);
    if (!unit) {
      throw traceabilityError(
        `Physical inventory unit ${code} does not exist.`,
        404,
        "TRACEABILITY_SALE_UNIT_NOT_FOUND",
        { unit_code: code, product_id: cleanProductId }
      );
    }
    if (Number(unit.product_id) !== cleanProductId) {
      throw traceabilityError(
        `Physical unit ${code} belongs to ${unit.product_name || "another product"}, not ${product?.name || "the selected product"}.`,
        409,
        "TRACEABILITY_SALE_UNIT_WRONG_PRODUCT",
        { unit_code: code, expected_product_id: cleanProductId, actual_product_id: Number(unit.product_id) }
      );
    }
    if (Number(unit.current_branch_id) !== cleanBranchId) {
      throw traceabilityError(
        `Physical unit ${code} is not currently held by this store.`,
        409,
        "TRACEABILITY_SALE_UNIT_WRONG_STORE",
        { unit_code: code, current_branch_id: Number(unit.current_branch_id) }
      );
    }
    if (unit.status !== UNIT_STATUSES.ACTIVE) {
      throw traceabilityError(
        `Physical unit ${code} cannot be sold because its current status is ${unit.status}.`,
        409,
        "TRACEABILITY_SALE_UNIT_NOT_ACTIVE",
        { unit_code: code, status: unit.status }
      );
    }
    if (unit.sale_id || unit.sale_item_id) {
      throw traceabilityError(
        `Physical unit ${code} is already linked to a sale and cannot be sold again.`,
        409,
        "TRACEABILITY_SALE_UNIT_ALREADY_SOLD",
        { unit_code: code, sale_id: unit.sale_id, sale_item_id: unit.sale_item_id }
      );
    }
  }

  return {
    required,
    product_id: cleanProductId,
    unit_codes: selectedCodes,
    units: selectedCodes.map((code) => byCode.get(code)),
  };
}

async function lockSaleTraceabilitySelections(connection, { branchId, saleItems }) {
  const seenUnitCodes = new Set();
  const selections = new Map();

  for (const item of saleItems) {
    const selection = await lockSaleUnitSelection(connection, {
      branchId,
      product: item,
      quantity: item.quantity,
      unitCodes: item.unit_ids,
      seenUnitCodes,
    });
    selections.set(Number(item.product_id || item.id), selection);
  }

  return selections;
}

async function markSaleUnitsSold(
  connection,
  {
    branchId,
    saleId,
    saleItemId,
    productId,
    unitCodes,
    actorUserId,
    receiptNumber,
    customerName,
    requestId = null,
  }
) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanSaleId = positiveInt(saleId, "saleId");
  const cleanSaleItemId = positiveInt(saleItemId, "saleItemId");
  const cleanProductId = positiveInt(productId, "productId");
  const cleanActorUserId = positiveInt(actorUserId, "actorUserId");
  const selectedCodes = normalizeUnitSelection(unitCodes);

  if (selectedCodes.length === 0) return [];

  const placeholders = selectedCodes.map(() => "?").join(", ");
  const [units] = await connection.query(
    `SELECT id, unit_code, status, product_id, current_branch_id
     FROM inventory_units
     WHERE unit_code IN (${placeholders})
     ORDER BY unit_code ASC
     FOR UPDATE`,
    selectedCodes
  );
  const byCode = new Map(units.map((unit) => [unit.unit_code, unit]));
  const results = [];

  for (const code of selectedCodes) {
    const unit = byCode.get(code);
    if (
      !unit ||
      Number(unit.product_id) !== cleanProductId ||
      Number(unit.current_branch_id) !== cleanBranchId ||
      unit.status !== UNIT_STATUSES.ACTIVE
    ) {
      throw traceabilityError(
        `Physical unit ${code} changed state before sale completion. Refresh the item and scan it again.`,
        409,
        "TRACEABILITY_SALE_UNIT_STATE_CHANGED",
        { unit_code: code }
      );
    }

    const [updateResult] = await connection.query(
      `UPDATE inventory_units
       SET status = ?,
           sale_id = ?,
           sale_item_id = ?,
           custody_user_id = NULL,
           status_changed_at = NOW()
       WHERE id = ?
         AND status = ?
         AND product_id = ?
         AND current_branch_id = ?`,
      [
        UNIT_STATUSES.SOLD,
        cleanSaleId,
        cleanSaleItemId,
        unit.id,
        UNIT_STATUSES.ACTIVE,
        cleanProductId,
        cleanBranchId,
      ]
    );
    if (Number(updateResult.affectedRows || 0) !== 1) {
      throw traceabilityError(
        `Physical unit ${code} could not be locked to this sale.`,
        409,
        "TRACEABILITY_SALE_UNIT_COMMIT_CONFLICT",
        { unit_code: code }
      );
    }

    const event = await appendUnitEvent(connection, {
      unitId: unit.id,
      branchId: cleanBranchId,
      eventType: "sale_completed",
      fromStatus: UNIT_STATUSES.ACTIVE,
      toStatus: UNIT_STATUSES.SOLD,
      sourceType: "sale",
      sourceId: cleanSaleId,
      actorUserId: cleanActorUserId,
      requestId,
      reason: `Sold on receipt ${receiptNumber || cleanSaleId}.`,
      metadata: {
        sale_id: cleanSaleId,
        sale_item_id: cleanSaleItemId,
        product_id: cleanProductId,
        unit_code: code,
        receipt_number: receiptNumber || null,
        customer_name: customerName || null,
      },
    });

    results.push({
      unit_id: unit.id,
      unit_code: code,
      sale_id: cleanSaleId,
      sale_item_id: cleanSaleItemId,
      event_hash: event.event_hash,
    });
  }

  return results;
}

async function listSaleUnitAssignments(connection, { branchId, saleId }) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanSaleId = positiveInt(saleId, "saleId");
  const [rows] = await connection.query(
    `SELECT
       u.id AS unit_id,
       u.unit_code,
       u.product_id,
       u.sale_item_id,
       u.status,
       p.name AS product_name
     FROM inventory_units u
     INNER JOIN products p ON p.id = u.product_id
     WHERE u.sale_id = ?
       AND u.current_branch_id = ?
     ORDER BY u.sale_item_id ASC, u.unit_code ASC`,
    [cleanSaleId, cleanBranchId]
  );
  return rows;
}

module.exports = {
  listSaleUnitAssignments,
  lockSaleTraceabilitySelections,
  lockSaleUnitSelection,
  markSaleUnitsSold,
  normalizeUnitSelection,
  productTracking,
};
