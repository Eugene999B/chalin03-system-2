const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  TRACKING_MODES,
  TRACEABILITY_STATES,
} = require("./inventoryTraceabilityService");
const {
  createSerializedLabelBatch,
  positiveInt,
  withTransaction,
} = require("./inventoryTraceabilityRepositoryService");

function cleanText(value, max = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

async function listSerializedPurchaseReceivingQueue(connection = pool, { branchId, limit = 100 } = {}) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
  const [rows] = await connection.query(
    `SELECT
       pi.id AS purchase_item_id,
       pi.purchase_id,
       pi.product_id,
       pi.product_name,
       pi.quantity AS purchased_quantity,
       pi.cost_price,
       p.quantity AS current_system_quantity,
       p.inventory_tracking_mode,
       p.inventory_traceability_state,
       p.inventory_product_code,
       p.inventory_risk_tier,
       pu.invoice_number,
       pu.purchase_date,
       pu.created_at AS purchase_created_at,
       s.name AS supplier_name,
       lb.id AS label_batch_id,
       lb.batch_code,
       lb.status AS label_batch_status,
       lb.generated_quantity,
       lb.activated_quantity,
       lb.voided_quantity,
       lb.created_at AS label_batch_created_at
     FROM purchase_items pi
     INNER JOIN purchases pu
       ON pu.id = pi.purchase_id
      AND pu.branch_id = ?
     INNER JOIN products p
       ON p.id = pi.product_id
      AND p.branch_id = pu.branch_id
     LEFT JOIN suppliers s
       ON s.id = pu.supplier_id
      AND s.branch_id = pu.branch_id
     LEFT JOIN inventory_label_batches lb
       ON lb.branch_id = pu.branch_id
      AND lb.source_type = 'purchase'
      AND lb.source_id = pu.id
      AND lb.source_item_id = pi.id
     WHERE p.inventory_tracking_mode = 'serialized'
       AND p.inventory_traceability_state = 'setup'
     ORDER BY
       CASE WHEN lb.id IS NULL THEN 0 ELSE 1 END ASC,
       pu.purchase_date DESC,
       pi.id DESC
     LIMIT ?`,
    [cleanBranchId, cleanLimit]
  );

  return rows.map((row) => ({
    ...row,
    purchased_quantity: Number(row.purchased_quantity || 0),
    current_system_quantity: Number(row.current_system_quantity || 0),
    generated_quantity: Number(row.generated_quantity || 0),
    activated_quantity: Number(row.activated_quantity || 0),
    voided_quantity: Number(row.voided_quantity || 0),
    identity_work_status: !row.label_batch_id
      ? "needs_labels"
      : row.label_batch_status === "activated"
        ? Number(row.activated_quantity || 0) === Number(row.purchased_quantity || 0)
          ? "complete"
          : "quantity_exception"
        : "batch_in_progress",
  }));
}

async function preparePurchaseItemLabelBatch({
  req,
  branchId,
  purchaseItemId,
  createdBy,
  notes = null,
}) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanPurchaseItemId = positiveInt(purchaseItemId, "purchaseItemId");
  const cleanCreatedBy = positiveInt(createdBy, "createdBy");

  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT
         pi.id AS purchase_item_id,
         pi.purchase_id,
         pi.product_id,
         pi.product_name,
         pi.quantity,
         pi.cost_price,
         pu.invoice_number,
         pu.purchase_date,
         s.name AS supplier_name,
         p.inventory_tracking_mode,
         p.inventory_traceability_state,
         p.inventory_product_code
       FROM purchase_items pi
       INNER JOIN purchases pu
         ON pu.id = pi.purchase_id
        AND pu.branch_id = ?
       INNER JOIN products p
         ON p.id = pi.product_id
        AND p.branch_id = pu.branch_id
       LEFT JOIN suppliers s
         ON s.id = pu.supplier_id
        AND s.branch_id = pu.branch_id
       WHERE pi.id = ?
       LIMIT 1
       FOR UPDATE`,
      [cleanBranchId, cleanPurchaseItemId]
    );

    if (rows.length === 0) {
      const error = new Error("Purchase item not found in the selected store.");
      error.statusCode = 404;
      error.code = "TRACEABILITY_PURCHASE_ITEM_NOT_FOUND";
      throw error;
    }

    const item = rows[0];
    if (item.inventory_tracking_mode !== TRACKING_MODES.SERIALIZED) {
      const error = new Error("This purchase item is not configured for serialized unit tracking.");
      error.statusCode = 409;
      error.code = "TRACEABILITY_PURCHASE_NOT_SERIALIZED";
      throw error;
    }
    if (item.inventory_traceability_state !== TRACEABILITY_STATES.SETUP) {
      const error = new Error("Serialized receiving labels can only be prepared while the product is in traceability setup.");
      error.statusCode = 409;
      error.code = "TRACEABILITY_PURCHASE_SETUP_REQUIRED";
      throw error;
    }

    const [existingRows] = await connection.query(
      `SELECT id, batch_code, status
       FROM inventory_label_batches
       WHERE branch_id = ?
         AND source_type = 'purchase'
         AND source_id = ?
         AND source_item_id = ?
       LIMIT 1
       FOR UPDATE`,
      [cleanBranchId, item.purchase_id, item.purchase_item_id]
    );
    if (existingRows.length > 0) {
      const error = new Error(
        `This purchase item already has controlled label batch ${existingRows[0].batch_code}. Open the existing batch instead of generating duplicate identities.`
      );
      error.statusCode = 409;
      error.code = "TRACEABILITY_PURCHASE_BATCH_EXISTS";
      error.existingBatch = existingRows[0];
      throw error;
    }

    const batch = await createSerializedLabelBatch(connection, {
      branchId: cleanBranchId,
      productId: item.product_id,
      expectedQuantity: Number(item.quantity),
      sourceType: "purchase",
      sourceId: item.purchase_id,
      sourceItemId: item.purchase_item_id,
      createdBy: cleanCreatedBy,
      notes:
        cleanText(notes, 5000) ||
        `Serialized receiving for purchase ${item.invoice_number || `#${item.purchase_id}`} from ${item.supplier_name || "supplier"}.`,
    });

    await writeAuditEvent({
      connection,
      req,
      branchId: cleanBranchId,
      userId: cleanCreatedBy,
      action: "PREPARE_PURCHASE_SERIALIZED_LABELS",
      details: `Prepared ${batch.generated_quantity} physical identities for purchase item ${item.product_name} from ${item.invoice_number || `purchase #${item.purchase_id}`}.`,
      workspaceCode: "spare_parts",
      entityType: "purchase_item",
      entityId: item.purchase_item_id,
      actionType: "purchase_serialized_labels_prepared",
      outcome: "success",
      severity: "high",
      metadata: {
        purchase_id: item.purchase_id,
        purchase_item_id: item.purchase_item_id,
        product_id: item.product_id,
        quantity: Number(item.quantity),
        label_batch_id: batch.id,
        label_batch_code: batch.batch_code,
      },
    });

    return {
      purchase: {
        id: item.purchase_id,
        invoice_number: item.invoice_number,
        purchase_date: item.purchase_date,
        supplier_name: item.supplier_name,
      },
      purchase_item: {
        id: item.purchase_item_id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: Number(item.quantity),
        cost_price: Number(item.cost_price || 0),
      },
      batch,
    };
  });
}

module.exports = {
  listSerializedPurchaseReceivingQueue,
  preparePurchaseItemLabelBatch,
};
