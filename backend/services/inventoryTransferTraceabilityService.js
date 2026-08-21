const { pool } = require("../config/db");
const {
  UNIT_STATUSES,
  assertUnitTransition,
  normalizeUnitCode,
  secureRandomToken,
  verifySignedLabelPayload,
} = require("./inventoryTraceabilityService");
const { appendUnitEvent } = require("./inventoryTraceabilityRepositoryService");

const OPEN_INVESTIGATION_STATUSES = Object.freeze([
  "open",
  "reviewing",
  "awaiting_evidence",
]);

function transferError(
  message,
  statusCode = 400,
  code = "INVENTORY_TRANSFER_TRACEABILITY_ERROR"
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function positiveInt(value, fieldName = "value") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw transferError(
      `${fieldName} must be a positive whole number.`,
      400,
      "INVALID_TRANSFER_TRACEABILITY_NUMBER"
    );
  }
  return number;
}

function cleanText(value, maxLength = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizedScan(value) {
  const raw = cleanText(value, 240);
  if (!raw) {
    throw transferError(
      "Scan or enter a physical inventory ID.",
      400,
      "TRANSFER_UNIT_ID_REQUIRED"
    );
  }

  if (raw.startsWith("C03U1|")) {
    const signed = verifySignedLabelPayload(raw);
    if (!signed.valid) {
      throw transferError(
        `The inventory label signature is invalid (${signed.reason}).`,
        400,
        "INVALID_TRANSFER_UNIT_LABEL"
      );
    }
    return { unitCode: signed.unitCode, signed: true };
  }

  return { unitCode: normalizeUnitCode(raw), signed: false };
}

function uniqueUnitCodes(values) {
  const codes = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const decoded = normalizedScan(value);
    if (seen.has(decoded.unitCode)) {
      throw transferError(
        `Physical ID ${decoded.unitCode} was scanned more than once.`,
        409,
        "DUPLICATE_TRANSFER_UNIT_ID"
      );
    }
    seen.add(decoded.unitCode);
    codes.push(decoded.unitCode);
  }

  return codes;
}

function requiresSerializedIdentity(item) {
  return (
    String(item?.source_tracking_mode || "").toLowerCase() === "serialized" &&
    String(item?.source_traceability_state || "").toLowerCase() === "enforced"
  );
}

function riskSeverity(value) {
  const risk = String(value || "standard").toLowerCase();
  if (risk === "critical") return "critical";
  if (risk === "high") return "high";
  return "review";
}

function compactBranchCode(value) {
  return (
    String(value || "STORE")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8) || "STORE"
  );
}

function investigationCode(branchCode, now = new Date()) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${compactBranchCode(branchCode)}-${date}-${String(
    secureRandomToken(6)
  ).toUpperCase()}`;
}

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function loadTransfer(connection, transferId, forUpdate = false) {
  const id = positiveInt(transferId, "transferId");
  const [rows] = await connection.query(
    `SELECT
       st.*,
       fb.branch_code AS from_branch_code,
       fb.name AS from_branch_name,
       tb.branch_code AS to_branch_code,
       tb.name AS to_branch_name
     FROM stock_transfers st
     INNER JOIN branches fb ON fb.id = st.from_branch_id
     INNER JOIN branches tb ON tb.id = st.to_branch_id
     WHERE st.id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [id]
  );

  if (!rows[0]) {
    throw transferError(
      "Stock transfer was not found.",
      404,
      "TRACEABLE_TRANSFER_NOT_FOUND"
    );
  }

  return rows[0];
}

async function loadTransferItems(connection, transferId, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT
       sti.*,
       sp.name AS source_product_name,
       sp.quantity AS current_source_quantity,
       sp.inventory_tracking_mode AS source_tracking_mode,
       sp.inventory_traceability_state AS source_traceability_state,
       sp.inventory_product_code AS source_inventory_product_code,
       sp.inventory_risk_tier AS source_inventory_risk_tier,
       dp.name AS destination_product_name,
       dp.quantity AS current_destination_quantity,
       dp.inventory_tracking_mode AS destination_tracking_mode,
       dp.inventory_traceability_state AS destination_traceability_state,
       dp.inventory_product_code AS destination_inventory_product_code
     FROM stock_transfer_items sti
     INNER JOIN products sp ON sp.id = sti.source_product_id
     LEFT JOIN products dp ON dp.id = sti.destination_product_id
     WHERE sti.transfer_id = ?
     ORDER BY sti.id ASC${forUpdate ? " FOR UPDATE" : ""}`,
    [positiveInt(transferId, "transferId")]
  );
  return rows;
}

async function identityCounts(connection, transferId) {
  const [rows] = await connection.query(
    `SELECT
       transfer_item_id,
       COUNT(*) AS dispatched_identity_count,
       SUM(CASE WHEN receipt_status = 'received' THEN 1 ELSE 0 END) AS received_identity_count,
       SUM(CASE WHEN receipt_status = 'missing' THEN 1 ELSE 0 END) AS missing_identity_count,
       SUM(CASE WHEN receipt_status IN ('pending', 'missing') THEN 1 ELSE 0 END) AS outstanding_identity_count
     FROM inventory_transfer_units
     WHERE transfer_id = ?
     GROUP BY transfer_item_id`,
    [positiveInt(transferId, "transferId")]
  );

  return new Map(rows.map((row) => [Number(row.transfer_item_id), row]));
}

async function getTransferIdentityPlan({ transferId }) {
  const connection = await pool.getConnection();
  try {
    const transfer = await loadTransfer(connection, transferId, false);
    const items = await loadTransferItems(connection, transfer.id, false);
    const counts = await identityCounts(connection, transfer.id);

    const plannedItems = items.map((item) => {
      const itemCounts = counts.get(Number(item.id)) || {};
      return {
        id: item.id,
        transfer_id: transfer.id,
        source_product_id: item.source_product_id,
        destination_product_id: item.destination_product_id || null,
        product_name: item.product_name || item.source_product_name,
        requested_quantity: Number(item.requested_quantity || 0),
        dispatched_quantity:
          item.dispatched_quantity === null || item.dispatched_quantity === undefined
            ? null
            : Number(item.dispatched_quantity),
        received_quantity:
          item.received_quantity === null || item.received_quantity === undefined
            ? null
            : Number(item.received_quantity),
        tracking_mode: item.source_tracking_mode || "quantity",
        traceability_state: item.source_traceability_state || "off",
        inventory_product_code: item.source_inventory_product_code || null,
        inventory_risk_tier: item.source_inventory_risk_tier || "standard",
        serialized_identity_required: requiresSerializedIdentity(item),
        dispatched_identity_count: Number(
          itemCounts.dispatched_identity_count || 0
        ),
        received_identity_count: Number(itemCounts.received_identity_count || 0),
        missing_identity_count: Number(itemCounts.missing_identity_count || 0),
        outstanding_identity_count: Number(
          itemCounts.outstanding_identity_count || 0
        ),
      };
    });

    return {
      transfer: {
        id: transfer.id,
        transfer_number: transfer.transfer_number,
        status: transfer.status,
        from_branch_id: transfer.from_branch_id,
        from_branch_code: transfer.from_branch_code,
        from_branch_name: transfer.from_branch_name,
        to_branch_id: transfer.to_branch_id,
        to_branch_code: transfer.to_branch_code,
        to_branch_name: transfer.to_branch_name,
      },
      serialized_identity_required: plannedItems.some(
        (item) => item.serialized_identity_required
      ),
      expected_ids_hidden_until_physically_scanned: true,
      partial_receipt_creates_investigations: true,
      items: plannedItems,
    };
  } finally {
    connection.release();
  }
}

async function assertLegacyQuantityTransferAllowed(connection, { transferId }) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS serialized_count
     FROM stock_transfer_items sti
     INNER JOIN products p ON p.id = sti.source_product_id
     WHERE sti.transfer_id = ?
       AND p.inventory_tracking_mode = 'serialized'
       AND p.inventory_traceability_state = 'enforced'`,
    [positiveInt(transferId, "transferId")]
  );

  if (Number(rows[0]?.serialized_count || 0) > 0) {
    throw transferError(
      "This transfer contains enforced serialized inventory. Scan the exact physical IDs and use the serialized transfer workflow.",
      409,
      "SERIALIZED_TRANSFER_IDENTITY_WORKFLOW_REQUIRED"
    );
  }

  return true;
}

async function findDestinationProduct(connection, item, toBranchId) {
  if (item.destination_product_id) {
    const [direct] = await connection.query(
      `SELECT * FROM products
       WHERE id = ? AND branch_id = ?
       LIMIT 1 FOR UPDATE`,
      [item.destination_product_id, toBranchId]
    );
    if (direct[0]) return direct[0];
  }

  const barcode = cleanText(item.barcode, 255);
  if (barcode) {
    const [barcodeRows] = await connection.query(
      `SELECT * FROM products
       WHERE branch_id = ? AND barcode = ?
       LIMIT 1 FOR UPDATE`,
      [toBranchId, barcode]
    );
    if (barcodeRows[0]) return barcodeRows[0];
  }

  const [nameRows] = await connection.query(
    `SELECT * FROM products
     WHERE branch_id = ?
       AND LOWER(name) = LOWER(?)
       AND IFNULL(category, '') = ?
       AND IFNULL(size, '') = ?
     LIMIT 1 FOR UPDATE`,
    [
      toBranchId,
      item.product_name || item.source_product_name,
      cleanText(item.category, 255) || "",
      cleanText(item.size, 255) || "",
    ]
  );
  return nameRows[0] || null;
}

async function createDestinationProductCopy(connection, sourceProduct, toBranchId) {
  const [columns] = await connection.query("SHOW COLUMNS FROM products");
  const allowedFields = columns.map((column) => column.Field);
  const skip = new Set([
    "id",
    "quantity",
    "branch_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ]);
  const fields = [];
  const values = [];

  const push = (field, value) => {
    if (allowedFields.includes(field) && !fields.includes(field)) {
      fields.push(field);
      values.push(value);
    }
  };

  push("branch_id", toBranchId);
  push("quantity", 0);
  for (const field of allowedFields) {
    if (!skip.has(field) && sourceProduct[field] !== undefined) {
      push(field, sourceProduct[field]);
    }
  }

  const placeholders = fields.map(() => "?").join(", ");
  try {
    const [result] = await connection.query(
      `INSERT INTO products (${fields.join(", ")}) VALUES (${placeholders})`,
      values
    );
    const [rows] = await connection.query(
      `SELECT * FROM products WHERE id = ? LIMIT 1 FOR UPDATE`,
      [result.insertId]
    );
    return rows[0] || null;
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw transferError(
        "The destination product could not be created because a matching product or barcode already exists. Reconcile the destination product first.",
        409,
        "TRANSFER_DESTINATION_PRODUCT_DUPLICATE"
      );
    }
    throw error;
  }
}

async function destinationProductForItem(
  connection,
  { item, sourceProduct, transfer }
) {
  let destinationProduct = await findDestinationProduct(
    connection,
    item,
    transfer.to_branch_id
  );
  if (!destinationProduct) {
    destinationProduct = await createDestinationProductCopy(
      connection,
      sourceProduct,
      transfer.to_branch_id
    );
  }
  if (!destinationProduct) {
    throw transferError(
      `Could not find or create a destination product for ${
        item.product_name || item.source_product_name
      }.`,
      409,
      "TRANSFER_DESTINATION_PRODUCT_REQUIRED"
    );
  }

  if (requiresSerializedIdentity(item)) {
    const sourceCode = cleanText(sourceProduct.inventory_product_code, 16);
    const destinationCode = cleanText(destinationProduct.inventory_product_code, 16);
    if (
      destinationProduct.inventory_tracking_mode !== "serialized" ||
      destinationProduct.inventory_traceability_state !== "enforced" ||
      !sourceCode ||
      sourceCode !== destinationCode
    ) {
      throw transferError(
        `${item.product_name || item.source_product_name} is serialized at the source, but the destination product does not have the same enforced traceability code. Reconcile the destination product before receiving this transfer.`,
        409,
        "TRANSFER_DESTINATION_TRACEABILITY_MISMATCH"
      );
    }
  }

  return destinationProduct;
}

async function verifyTransferUnitScan({
  transferId,
  transferItemId,
  phase,
  value,
}) {
  const cleanTransferId = positiveInt(transferId, "transferId");
  const cleanItemId = positiveInt(transferItemId, "transferItemId");
  const cleanPhase = String(phase || "").trim().toLowerCase();
  if (!["dispatch", "receive"].includes(cleanPhase)) {
    throw transferError(
      "Transfer scan phase must be dispatch or receive.",
      400,
      "INVALID_TRANSFER_SCAN_PHASE"
    );
  }
  const decoded = normalizedScan(value);
  const connection = await pool.getConnection();

  try {
    const transfer = await loadTransfer(connection, cleanTransferId, false);
    const items = await loadTransferItems(connection, cleanTransferId, false);
    const item = items.find((row) => Number(row.id) === cleanItemId);
    if (!item) {
      throw transferError(
        "This transfer item was not found.",
        404,
        "TRACEABLE_TRANSFER_ITEM_NOT_FOUND"
      );
    }
    if (!requiresSerializedIdentity(item)) {
      throw transferError(
        "This transfer item does not require exact serialized IDs.",
        409,
        "TRANSFER_ITEM_NOT_SERIALIZED_ENFORCED"
      );
    }

    if (cleanPhase === "dispatch") {
      if (transfer.status !== "approved") {
        throw transferError(
          "Only approved transfers can accept dispatch scans.",
          409,
          "TRANSFER_NOT_APPROVED_FOR_SCAN"
        );
      }
      const [units] = await connection.query(
        `SELECT id, unit_code, product_id, current_branch_id, status, transfer_id
         FROM inventory_units
         WHERE unit_code = ?
         LIMIT 1`,
        [decoded.unitCode]
      );
      const unit = units[0];
      if (!unit) {
        throw transferError(
          "The scanned inventory unit does not exist.",
          404,
          "TRANSFER_UNIT_NOT_FOUND"
        );
      }
      if (
        Number(unit.product_id) !== Number(item.source_product_id) ||
        Number(unit.current_branch_id) !== Number(transfer.from_branch_id)
      ) {
        throw transferError(
          "The scanned unit does not belong to this source-store transfer item.",
          409,
          "TRANSFER_UNIT_WRONG_PRODUCT_OR_STORE"
        );
      }
      if (unit.status !== UNIT_STATUSES.ACTIVE || unit.transfer_id) {
        throw transferError(
          `Physical ID ${unit.unit_code} is ${unit.status} and cannot be dispatched.`,
          409,
          "TRANSFER_UNIT_NOT_ACTIVE"
        );
      }
      return {
        transfer_id: cleanTransferId,
        transfer_item_id: cleanItemId,
        unit_code: unit.unit_code,
        phase: cleanPhase,
        accepted: true,
        signed_label: decoded.signed,
      };
    }

    if (transfer.status !== "dispatched") {
      throw transferError(
        "Only dispatched transfers can accept receiving scans.",
        409,
        "TRANSFER_NOT_DISPATCHED_FOR_SCAN"
      );
    }
    const [rows] = await connection.query(
      `SELECT
         itu.id,
         itu.unit_code_snapshot,
         itu.receipt_status,
         u.status,
         u.transfer_id,
         u.current_branch_id
       FROM inventory_transfer_units itu
       INNER JOIN inventory_units u ON u.id = itu.unit_id
       WHERE itu.transfer_id = ?
         AND itu.transfer_item_id = ?
         AND itu.unit_code_snapshot = ?
       LIMIT 1`,
      [cleanTransferId, cleanItemId, decoded.unitCode]
    );
    const row = rows[0];
    if (!row) {
      throw transferError(
        "The scanned unit was not dispatched on this transfer item.",
        409,
        "TRANSFER_RECEIPT_UNIT_UNEXPECTED"
      );
    }
    if (row.receipt_status === "received") {
      throw transferError(
        `Physical ID ${row.unit_code_snapshot} has already been received.`,
        409,
        "TRANSFER_RECEIPT_UNIT_ALREADY_RECEIVED"
      );
    }
    if (
      row.status !== UNIT_STATUSES.IN_TRANSIT ||
      Number(row.transfer_id) !== cleanTransferId
    ) {
      throw transferError(
        "The scanned unit changed state after dispatch and cannot be received through this transfer.",
        409,
        "TRANSFER_RECEIPT_UNIT_STATE_CHANGED"
      );
    }
    return {
      transfer_id: cleanTransferId,
      transfer_item_id: cleanItemId,
      unit_code: row.unit_code_snapshot,
      phase: cleanPhase,
      accepted: true,
      signed_label: decoded.signed,
      prior_receipt_status: row.receipt_status,
    };
  } finally {
    connection.release();
  }
}

function requestItemsById(items) {
  const map = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const itemId = positiveInt(raw?.transfer_item_id, "transfer_item_id");
    if (map.has(itemId)) {
      throw transferError(
        `Transfer item ${itemId} was supplied more than once.`,
        409,
        "DUPLICATE_TRANSFER_ITEM_INPUT"
      );
    }
    map.set(itemId, {
      transfer_item_id: itemId,
      unit_codes: uniqueUnitCodes(raw?.unit_ids || []),
    });
  }
  return map;
}

async function loadSourceProductForUpdate(connection, item, fromBranchId) {
  const [rows] = await connection.query(
    `SELECT * FROM products
     WHERE id = ? AND branch_id = ?
     LIMIT 1 FOR UPDATE`,
    [item.source_product_id, fromBranchId]
  );
  if (!rows[0]) {
    throw transferError(
      `${item.product_name || item.source_product_name} was not found in the source store.`,
      404,
      "TRANSFER_SOURCE_PRODUCT_NOT_FOUND"
    );
  }
  return rows[0];
}

async function safeActivity(connection, {
  actorUserId,
  action,
  details,
  branchId,
}) {
  try {
    await connection.query(
      `INSERT INTO activity_log (user_id, action, details, branch_id)
       VALUES (?, ?, ?, ?)`,
      [actorUserId || null, action, JSON.stringify(details || {}), branchId || null]
    );
  } catch (error) {
    console.warn("Transfer traceability activity log skipped:", error.message);
  }
}

async function dispatchTransferWithIdentities({
  transferId,
  actorUserId,
  items,
  dispatchNote = null,
  requestId = null,
}) {
  const cleanTransferId = positiveInt(transferId, "transferId");
  const cleanActor = positiveInt(actorUserId, "actorUserId");
  const requested = requestItemsById(items);

  return withTransaction(async (connection) => {
    const transfer = await loadTransfer(connection, cleanTransferId, true);
    if (transfer.status !== "approved") {
      throw transferError(
        "Only approved transfers can be dispatched.",
        409,
        "TRANSFER_NOT_APPROVED"
      );
    }

    const transferItems = await loadTransferItems(connection, cleanTransferId, true);
    if (transferItems.length === 0) {
      throw transferError("This transfer has no items.", 409, "TRANSFER_ITEMS_REQUIRED");
    }
    if (!transferItems.some(requiresSerializedIdentity)) {
      throw transferError(
        "This transfer does not contain enforced serialized inventory. Use the standard quantity dispatch action.",
        409,
        "SERIALIZED_TRANSFER_WORKFLOW_NOT_REQUIRED"
      );
    }

    const allScannedCodes = new Set();
    for (const item of transferItems) {
      const sourceProduct = await loadSourceProductForUpdate(
        connection,
        item,
        transfer.from_branch_id
      );
      const transferQuantity = Number(item.requested_quantity || 0);
      const beforeQuantity = Number(sourceProduct.quantity || 0);
      if (beforeQuantity < transferQuantity) {
        throw transferError(
          `${sourceProduct.name} has only ${beforeQuantity} in the source store. Cannot dispatch ${transferQuantity}.`,
          409,
          "TRANSFER_SOURCE_QUANTITY_CHANGED"
        );
      }

      let dispatchUnits = [];
      if (requiresSerializedIdentity(item)) {
        const input = requested.get(Number(item.id));
        if (!input || input.unit_codes.length !== transferQuantity) {
          throw transferError(
            `${sourceProduct.name} requires exactly ${transferQuantity} scanned physical ID${
              transferQuantity === 1 ? "" : "s"
            } before dispatch.`,
            409,
            "TRANSFER_DISPATCH_EXACT_IDS_REQUIRED"
          );
        }
        for (const code of input.unit_codes) {
          if (allScannedCodes.has(code)) {
            throw transferError(
              `Physical ID ${code} appears on more than one transfer line.`,
              409,
              "TRANSFER_UNIT_REUSED_ACROSS_ITEMS"
            );
          }
          allScannedCodes.add(code);
        }

        const placeholders = input.unit_codes.map(() => "?").join(", ");
        const [unitRows] = await connection.query(
          `SELECT * FROM inventory_units
           WHERE unit_code IN (${placeholders})
           ORDER BY id ASC
           FOR UPDATE`,
          input.unit_codes
        );
        if (unitRows.length !== input.unit_codes.length) {
          throw transferError(
            `${sourceProduct.name}: one or more scanned physical IDs do not exist.`,
            404,
            "TRANSFER_DISPATCH_UNIT_NOT_FOUND"
          );
        }
        const byCode = new Map(unitRows.map((unit) => [unit.unit_code, unit]));
        dispatchUnits = input.unit_codes.map((code) => byCode.get(code));
        for (const unit of dispatchUnits) {
          if (
            Number(unit.product_id) !== Number(item.source_product_id) ||
            Number(unit.current_branch_id) !== Number(transfer.from_branch_id)
          ) {
            throw transferError(
              `${unit.unit_code} does not belong to ${sourceProduct.name} in the source store.`,
              409,
              "TRANSFER_DISPATCH_UNIT_WRONG_SOURCE"
            );
          }
          if (unit.status !== UNIT_STATUSES.ACTIVE || unit.transfer_id) {
            throw transferError(
              `${unit.unit_code} is ${unit.status} and is not available for transfer dispatch.`,
              409,
              "TRANSFER_DISPATCH_UNIT_NOT_ACTIVE"
            );
          }
          assertUnitTransition(unit.status, UNIT_STATUSES.IN_TRANSIT);
        }
      }

      const afterQuantity = beforeQuantity - transferQuantity;
      await connection.query(
        `UPDATE products SET quantity = ? WHERE id = ? AND branch_id = ?`,
        [afterQuantity, sourceProduct.id, transfer.from_branch_id]
      );
      await connection.query(
        `UPDATE stock_transfer_items
         SET dispatched_quantity = ?, source_quantity_before = ?, source_quantity_after = ?
         WHERE id = ? AND transfer_id = ?`,
        [
          transferQuantity,
          beforeQuantity,
          afterQuantity,
          item.id,
          cleanTransferId,
        ]
      );

      for (const unit of dispatchUnits) {
        await connection.query(
          `UPDATE inventory_units
           SET status = ?, current_branch_id = ?, transfer_id = ?,
               current_location = ?, custody_user_id = NULL,
               last_verified_by = ?, last_verified_at = NOW(),
               status_changed_at = NOW()
           WHERE id = ?`,
          [
            UNIT_STATUSES.IN_TRANSIT,
            transfer.to_branch_id,
            cleanTransferId,
            `In transit ${transfer.from_branch_code} → ${transfer.to_branch_code}`,
            cleanActor,
            unit.id,
          ]
        );
        await connection.query(
          `INSERT INTO inventory_transfer_units (
             transfer_id, transfer_item_id, unit_id, unit_code_snapshot,
             source_product_id, from_branch_id, to_branch_id,
             dispatch_status, receipt_status, dispatched_by, dispatched_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_transit', 'pending', ?, NOW())`,
          [
            cleanTransferId,
            item.id,
            unit.id,
            unit.unit_code,
            item.source_product_id,
            transfer.from_branch_id,
            transfer.to_branch_id,
            cleanActor,
          ]
        );
        await appendUnitEvent(connection, {
          unitId: unit.id,
          branchId: transfer.from_branch_id,
          eventType: "transfer_dispatched",
          fromStatus: UNIT_STATUSES.ACTIVE,
          toStatus: UNIT_STATUSES.IN_TRANSIT,
          sourceType: "stock_transfer",
          sourceId: cleanTransferId,
          actorUserId: cleanActor,
          reason: cleanText(dispatchNote, 500),
          requestId: cleanText(requestId, 100),
          metadata: {
            transfer_item_id: item.id,
            unit_code: unit.unit_code,
            from_branch_id: transfer.from_branch_id,
            to_branch_id: transfer.to_branch_id,
          },
        });
      }
    }

    await connection.query(
      `UPDATE stock_transfers
       SET status = 'dispatched', dispatched_by = ?, dispatch_note = ?, dispatched_at = NOW()
       WHERE id = ?`,
      [cleanActor, cleanText(dispatchNote, 2000), cleanTransferId]
    );
    await safeActivity(connection, {
      actorUserId: cleanActor,
      action: "stock_transfer_serialized_dispatched",
      branchId: transfer.from_branch_id,
      details: {
        transfer_id: cleanTransferId,
        transfer_number: transfer.transfer_number,
        exact_identity_count: allScannedCodes.size,
      },
    });

    return {
      transfer_id: cleanTransferId,
      transfer_number: transfer.transfer_number,
      status: "dispatched",
      exact_identity_count: allScannedCodes.size,
      source_stock_reduced: true,
    };
  });
}

async function openTransferShortageInvestigation(
  connection,
  { transfer, item, mapping, actorUserId, lastEventId }
) {
  const [existing] = await connection.query(
    `SELECT id, investigation_code
     FROM inventory_loss_investigations
     WHERE unit_id = ?
       AND investigation_type = 'transfer_shortage'
       AND status IN (${OPEN_INVESTIGATION_STATUSES.map(() => "?").join(", ")})
     LIMIT 1 FOR UPDATE`,
    [mapping.unit_id, ...OPEN_INVESTIGATION_STATUSES]
  );
  if (existing[0]) return existing[0];

  let code = null;
  let insertedId = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    code = investigationCode(transfer.to_branch_code);
    try {
      const [result] = await connection.query(
        `INSERT INTO inventory_loss_investigations (
           investigation_code, branch_id, product_id, unit_id,
           investigation_type, severity, status, discovered_at,
           last_known_event_id, last_known_at, opened_by,
           resolution_notes
         ) VALUES (?, ?, ?, ?, 'transfer_shortage', ?, 'open', NOW(), ?, NOW(), ?, ?)`,
        [
          code,
          transfer.to_branch_id,
          item.source_product_id,
          mapping.unit_id,
          riskSeverity(item.source_inventory_risk_tier),
          lastEventId || null,
          actorUserId,
          `Physical ID ${mapping.unit_code_snapshot} was dispatched on transfer ${transfer.transfer_number} but was not observed during receiving.`,
        ]
      );
      insertedId = result.insertId;
      break;
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY" || attempt === 7) throw error;
    }
  }
  return { id: insertedId, investigation_code: code };
}

async function resolveTransferShortageIfFound(
  connection,
  { unitId, actorUserId, transferNumber }
) {
  await connection.query(
    `UPDATE inventory_loss_investigations
     SET status = 'resolved', resolution_category = 'found',
         resolution_notes = ?, resolved_by = ?, resolved_at = NOW()
     WHERE unit_id = ?
       AND investigation_type = 'transfer_shortage'
       AND status IN (${OPEN_INVESTIGATION_STATUSES.map(() => "?").join(", ")})`,
    [
      `Physical unit was later received against transfer ${transferNumber}.`,
      actorUserId,
      unitId,
      ...OPEN_INVESTIGATION_STATUSES,
    ]
  );
}

async function receiveTransferWithIdentities({
  transferId,
  actorUserId,
  items,
  receiveNote = null,
  requestId = null,
}) {
  const cleanTransferId = positiveInt(transferId, "transferId");
  const cleanActor = positiveInt(actorUserId, "actorUserId");
  const requested = requestItemsById(items);

  return withTransaction(async (connection) => {
    const transfer = await loadTransfer(connection, cleanTransferId, true);
    if (transfer.status !== "dispatched") {
      throw transferError(
        "Only dispatched transfers can be received.",
        409,
        "TRANSFER_NOT_DISPATCHED"
      );
    }

    const transferItems = await loadTransferItems(connection, cleanTransferId, true);
    if (!transferItems.some(requiresSerializedIdentity)) {
      throw transferError(
        "This transfer does not contain enforced serialized inventory. Use the standard quantity receive action.",
        409,
        "SERIALIZED_TRANSFER_WORKFLOW_NOT_REQUIRED"
      );
    }

    let newlyReceivedIdentityCount = 0;
    let newlyMissingIdentityCount = 0;

    for (const item of transferItems) {
      const sourceProduct = await loadSourceProductForUpdate(
        connection,
        item,
        transfer.from_branch_id
      );
      const destinationProduct = await destinationProductForItem(connection, {
        item,
        sourceProduct,
        transfer,
      });
      const currentReceived = Number(item.received_quantity || 0);
      const dispatchedQuantity = Number(
        item.dispatched_quantity || item.requested_quantity || 0
      );

      if (!requiresSerializedIdentity(item)) {
        const remaining = Math.max(0, dispatchedQuantity - currentReceived);
        if (remaining > 0) {
          const beforeQuantity = Number(destinationProduct.quantity || 0);
          const afterQuantity = beforeQuantity + remaining;
          await connection.query(
            `UPDATE products SET quantity = ? WHERE id = ? AND branch_id = ?`,
            [afterQuantity, destinationProduct.id, transfer.to_branch_id]
          );
          await connection.query(
            `UPDATE stock_transfer_items
             SET destination_product_id = ?,
                 received_quantity = COALESCE(received_quantity, 0) + ?,
                 destination_quantity_before = COALESCE(destination_quantity_before, ?),
                 destination_quantity_after = ?
             WHERE id = ? AND transfer_id = ?`,
            [
              destinationProduct.id,
              remaining,
              beforeQuantity,
              afterQuantity,
              item.id,
              cleanTransferId,
            ]
          );
        }
        continue;
      }

      const input = requested.get(Number(item.id));
      if (!input) {
        throw transferError(
          `${item.product_name || sourceProduct.name}: receiving requires a physical scan list for this serialized transfer line. Send an explicit empty list only when zero units physically arrived.`,
          409,
          "TRANSFER_RECEIPT_SCAN_LIST_REQUIRED"
        );
      }

      const [mappings] = await connection.query(
        `SELECT itu.*, u.status AS unit_status, u.transfer_id AS current_transfer_id,
                u.product_id AS current_product_id, u.current_branch_id
         FROM inventory_transfer_units itu
         INNER JOIN inventory_units u ON u.id = itu.unit_id
         WHERE itu.transfer_id = ? AND itu.transfer_item_id = ?
         ORDER BY itu.id ASC
         FOR UPDATE`,
        [cleanTransferId, item.id]
      );
      if (mappings.length !== dispatchedQuantity) {
        throw transferError(
          `${item.product_name || sourceProduct.name}: transfer identity evidence is incomplete. Expected ${dispatchedQuantity} dispatched IDs but found ${mappings.length}.`,
          409,
          "TRANSFER_IDENTITY_EVIDENCE_INCOMPLETE"
        );
      }

      const mappingByCode = new Map(
        mappings.map((mapping) => [mapping.unit_code_snapshot, mapping])
      );
      const receiveMappings = [];
      for (const code of input.unit_codes) {
        const mapping = mappingByCode.get(code);
        if (!mapping) {
          throw transferError(
            `Physical ID ${code} was not dispatched on ${item.product_name || sourceProduct.name} for this transfer.`,
            409,
            "TRANSFER_RECEIPT_UNIT_UNEXPECTED"
          );
        }
        if (mapping.receipt_status === "received") {
          throw transferError(
            `Physical ID ${code} was already received on this transfer.`,
            409,
            "TRANSFER_RECEIPT_UNIT_ALREADY_RECEIVED"
          );
        }
        if (
          mapping.unit_status !== UNIT_STATUSES.IN_TRANSIT ||
          Number(mapping.current_transfer_id) !== cleanTransferId
        ) {
          throw transferError(
            `Physical ID ${code} changed state after dispatch and requires investigation before receiving.`,
            409,
            "TRANSFER_RECEIPT_UNIT_STATE_CHANGED"
          );
        }
        assertUnitTransition(mapping.unit_status, UNIT_STATUSES.ACTIVE);
        receiveMappings.push(mapping);
      }

      const outstandingBefore = mappings.filter(
        (mapping) => mapping.receipt_status !== "received"
      );
      const notObserved = outstandingBefore.filter(
        (mapping) => !input.unit_codes.includes(mapping.unit_code_snapshot)
      );
      if (notObserved.length > 0 && (cleanText(receiveNote, 2000) || "").length < 8) {
        throw transferError(
          `${item.product_name || sourceProduct.name}: ${notObserved.length} dispatched physical ID${
            notObserved.length === 1 ? " was" : "s were"
          } not observed. Enter a receiving note of at least 8 characters describing the shortage.`,
          409,
          "TRANSFER_VARIANCE_NOTE_REQUIRED"
        );
      }

      if (receiveMappings.length > 0) {
        const beforeQuantity = Number(destinationProduct.quantity || 0);
        const afterQuantity = beforeQuantity + receiveMappings.length;
        await connection.query(
          `UPDATE products SET quantity = ? WHERE id = ? AND branch_id = ?`,
          [afterQuantity, destinationProduct.id, transfer.to_branch_id]
        );
        await connection.query(
          `UPDATE stock_transfer_items
           SET destination_product_id = ?,
               received_quantity = COALESCE(received_quantity, 0) + ?,
               destination_quantity_before = COALESCE(destination_quantity_before, ?),
               destination_quantity_after = ?
           WHERE id = ? AND transfer_id = ?`,
          [
            destinationProduct.id,
            receiveMappings.length,
            beforeQuantity,
            afterQuantity,
            item.id,
            cleanTransferId,
          ]
        );
      } else {
        await connection.query(
          `UPDATE stock_transfer_items
           SET destination_product_id = COALESCE(destination_product_id, ?),
               received_quantity = COALESCE(received_quantity, 0),
               destination_quantity_before = COALESCE(destination_quantity_before, ?),
               destination_quantity_after = COALESCE(destination_quantity_after, ?)
           WHERE id = ? AND transfer_id = ?`,
          [
            destinationProduct.id,
            Number(destinationProduct.quantity || 0),
            Number(destinationProduct.quantity || 0),
            item.id,
            cleanTransferId,
          ]
        );
      }

      for (const mapping of receiveMappings) {
        await connection.query(
          `UPDATE inventory_units
           SET product_id = ?, status = ?, current_branch_id = ?,
               current_location = ?, custody_user_id = ?,
               last_verified_by = ?, last_verified_at = NOW(),
               status_changed_at = NOW()
           WHERE id = ?`,
          [
            destinationProduct.id,
            UNIT_STATUSES.ACTIVE,
            transfer.to_branch_id,
            `${transfer.to_branch_code} — ${transfer.to_branch_name}`,
            cleanActor,
            cleanActor,
            mapping.unit_id,
          ]
        );
        await connection.query(
          `UPDATE inventory_transfer_units
           SET destination_product_id = ?, dispatch_status = 'received',
               receipt_status = 'received', received_by = ?, received_at = NOW(),
               receipt_note = ?
           WHERE id = ?`,
          [
            destinationProduct.id,
            cleanActor,
            cleanText(receiveNote, 500),
            mapping.id,
          ]
        );
        await appendUnitEvent(connection, {
          unitId: mapping.unit_id,
          branchId: transfer.to_branch_id,
          eventType: "transfer_received",
          fromStatus: UNIT_STATUSES.IN_TRANSIT,
          toStatus: UNIT_STATUSES.ACTIVE,
          sourceType: "stock_transfer",
          sourceId: cleanTransferId,
          actorUserId: cleanActor,
          reason: cleanText(receiveNote, 500),
          requestId: cleanText(requestId, 100),
          metadata: {
            transfer_item_id: item.id,
            unit_code: mapping.unit_code_snapshot,
            destination_product_id: destinationProduct.id,
            from_branch_id: transfer.from_branch_id,
            to_branch_id: transfer.to_branch_id,
          },
        });
        await resolveTransferShortageIfFound(connection, {
          unitId: mapping.unit_id,
          actorUserId: cleanActor,
          transferNumber: transfer.transfer_number,
        });
        newlyReceivedIdentityCount += 1;
      }

      for (const mapping of notObserved) {
        if (mapping.receipt_status === "pending") {
          await connection.query(
            `UPDATE inventory_transfer_units
             SET receipt_status = 'missing', receipt_note = ?
             WHERE id = ?`,
            [cleanText(receiveNote, 500), mapping.id]
          );
          const event = await appendUnitEvent(connection, {
            unitId: mapping.unit_id,
            branchId: transfer.to_branch_id,
            eventType: "transfer_receipt_missing",
            fromStatus: UNIT_STATUSES.IN_TRANSIT,
            toStatus: UNIT_STATUSES.IN_TRANSIT,
            sourceType: "stock_transfer",
            sourceId: cleanTransferId,
            actorUserId: cleanActor,
            reason: cleanText(receiveNote, 500),
            requestId: cleanText(requestId, 100),
            metadata: {
              transfer_item_id: item.id,
              unit_code: mapping.unit_code_snapshot,
              from_branch_id: transfer.from_branch_id,
              to_branch_id: transfer.to_branch_id,
              stock_mutated: false,
              worker_fault_assigned: false,
            },
          });
          await openTransferShortageInvestigation(connection, {
            transfer,
            item,
            mapping,
            actorUserId: cleanActor,
            lastEventId: event.id,
          });
          newlyMissingIdentityCount += 1;
        }
      }
    }

    const [outstandingRows] = await connection.query(
      `SELECT COUNT(*) AS outstanding
       FROM stock_transfer_items
       WHERE transfer_id = ?
         AND COALESCE(received_quantity, 0) < COALESCE(dispatched_quantity, requested_quantity, 0)`,
      [cleanTransferId]
    );
    const outstanding = Number(outstandingRows[0]?.outstanding || 0);
    const completed = outstanding === 0;

    await connection.query(
      `UPDATE stock_transfers
       SET status = ?, received_by = ?, receive_note = ?,
           received_at = CASE WHEN ? = 1 THEN NOW() ELSE received_at END
       WHERE id = ?`,
      [
        completed ? "received" : "dispatched",
        cleanActor,
        cleanText(receiveNote, 2000),
        completed ? 1 : 0,
        cleanTransferId,
      ]
    );

    await safeActivity(connection, {
      actorUserId: cleanActor,
      action: completed
        ? "stock_transfer_serialized_received"
        : "stock_transfer_serialized_partial_receipt",
      branchId: transfer.to_branch_id,
      details: {
        transfer_id: cleanTransferId,
        transfer_number: transfer.transfer_number,
        newly_received_identity_count: newlyReceivedIdentityCount,
        newly_missing_identity_count: newlyMissingIdentityCount,
        transfer_complete: completed,
      },
    });

    return {
      transfer_id: cleanTransferId,
      transfer_number: transfer.transfer_number,
      status: completed ? "received" : "dispatched",
      transfer_complete: completed,
      newly_received_identity_count: newlyReceivedIdentityCount,
      newly_missing_identity_count: newlyMissingIdentityCount,
      shortages_open_investigations: newlyMissingIdentityCount > 0,
      destination_stock_increased_only_for_observed_units: true,
    };
  });
}

module.exports = {
  assertLegacyQuantityTransferAllowed,
  dispatchTransferWithIdentities,
  getTransferIdentityPlan,
  receiveTransferWithIdentities,
  requiresSerializedIdentity,
  verifyTransferUnitScan,
};
