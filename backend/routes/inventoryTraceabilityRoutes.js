const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  RISK_TIERS,
  TRACEABILITY_STATES,
  TRACKING_MODES,
  buildSignedLabelPayload,
  normalizeUnitCode,
  verifySignedLabelPayload,
} = require("../services/inventoryTraceabilityService");
const {
  activateLabelBatch,
  configureProductTraceability,
  createSerializedLabelBatch,
  getProductTraceabilitySummary,
  getUnitTraceability,
  markLabelBatchPrinted,
  positiveInt,
  withTransaction,
} = require("../services/inventoryTraceabilityRepositoryService");

const router = express.Router();

function branchId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error("Select a store before using Inventory Traceability.");
    error.statusCode = 400;
    error.code = "TRACEABILITY_BRANCH_REQUIRED";
    throw error;
  }
  return id;
}

function cleanText(value, max = 5000) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function sendError(res, error, fallback) {
  const statusCode = Number(error.statusCode || 500);
  if (statusCode >= 500) console.error(fallback, error);
  return res.status(statusCode).json({
    status: "error",
    code: error.code || "INVENTORY_TRACEABILITY_ERROR",
    message: statusCode >= 500 ? fallback : error.message,
  });
}

router.use(requireAuth);

// GET /api/inventory-traceability/overview
router.get("/overview", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const [productRows] = await pool.query(
      `SELECT
         inventory_tracking_mode,
         inventory_traceability_state,
         inventory_risk_tier,
         COUNT(*) AS product_count,
         COALESCE(SUM(quantity), 0) AS system_quantity
       FROM products
       WHERE branch_id = ? AND is_active = TRUE
       GROUP BY inventory_tracking_mode, inventory_traceability_state, inventory_risk_tier`,
      [storeId]
    );
    const [unitRows] = await pool.query(
      `SELECT status, COUNT(*) AS unit_count
       FROM inventory_units
       WHERE current_branch_id = ?
       GROUP BY status`,
      [storeId]
    );
    const [batchRows] = await pool.query(
      `SELECT status, COUNT(*) AS batch_count
       FROM inventory_label_batches
       WHERE branch_id = ?
       GROUP BY status`,
      [storeId]
    );

    return res.json({
      status: "success",
      branch_id: storeId,
      products: productRows,
      units: unitRows,
      label_batches: batchRows,
      tracking_modes: Object.values(TRACKING_MODES),
      traceability_states: Object.values(TRACEABILITY_STATES),
      risk_tiers: Object.values(RISK_TIERS),
    });
  } catch (error) {
    return sendError(res, error, "Unable to load Inventory Traceability overview.");
  }
});

// GET /api/inventory-traceability/products
router.get("/products", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const [products] = await pool.query(
      `SELECT
         p.id,
         p.name,
         p.size,
         p.category,
         p.quantity,
         p.barcode,
         p.inventory_tracking_mode,
         p.inventory_product_code,
         p.inventory_risk_tier,
         p.inventory_traceability_state,
         p.inventory_traceability_configured_at,
         COUNT(u.id) AS identity_count,
         SUM(CASE WHEN u.status = 'active' THEN 1 ELSE 0 END) AS active_identity_count,
         SUM(CASE WHEN u.status = 'label_pending' THEN 1 ELSE 0 END) AS pending_identity_count,
         SUM(CASE WHEN u.status = 'missing' THEN 1 ELSE 0 END) AS missing_identity_count
       FROM products p
       LEFT JOIN inventory_units u
         ON u.product_id = p.id
        AND u.current_branch_id = p.branch_id
       WHERE p.branch_id = ? AND p.is_active = TRUE
       GROUP BY p.id
       ORDER BY
         FIELD(p.inventory_risk_tier, 'critical', 'high', 'elevated', 'standard'),
         p.name ASC`,
      [storeId]
    );

    return res.json({ status: "success", branch_id: storeId, products });
  } catch (error) {
    return sendError(res, error, "Unable to load traceability products.");
  }
});

// GET /api/inventory-traceability/products/:productId
router.get("/products/:productId", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const summary = await getProductTraceabilitySummary(pool, {
      branchId: storeId,
      productId: positiveInt(req.params.productId, "productId"),
    });
    const [batches] = await pool.query(
      `SELECT
         id, batch_code, source_type, source_id, source_item_id,
         expected_quantity, generated_quantity, activated_quantity,
         voided_quantity, status, label_format, created_at, printed_at,
         verified_at, activated_at, notes
       FROM inventory_label_batches
       WHERE branch_id = ? AND product_id = ?
       ORDER BY created_at DESC, id DESC`,
      [storeId, summary.id]
    );
    return res.json({ status: "success", product: summary, label_batches: batches });
  } catch (error) {
    return sendError(res, error, "Unable to load product traceability details.");
  }
});

// PUT /api/inventory-traceability/products/:productId/config
router.put("/products/:productId/config", requireRole("admin"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const product = await withTransaction(async (connection) => {
      const configured = await configureProductTraceability(connection, {
        branchId: storeId,
        productId: positiveInt(req.params.productId, "productId"),
        trackingMode: req.body.tracking_mode,
        traceabilityState: req.body.traceability_state,
        productCode: req.body.product_code,
        riskTier: req.body.risk_tier || RISK_TIERS.STANDARD,
        configuredBy: req.user.id,
      });
      await writeAuditEvent({
        connection,
        req,
        branchId: storeId,
        userId: req.user.id,
        action: "CONFIGURE_INVENTORY_TRACEABILITY",
        details: `Configured ${configured.name} as ${configured.inventory_tracking_mode}/${configured.inventory_traceability_state} with risk ${configured.inventory_risk_tier}.`,
        workspaceCode: "spare_parts",
        entityType: "product",
        entityId: configured.id,
        actionType: "inventory_traceability_configured",
        outcome: "success",
        severity: configured.inventory_risk_tier === RISK_TIERS.CRITICAL ? "high" : "notice",
        metadata: {
          tracking_mode: configured.inventory_tracking_mode,
          product_code: configured.inventory_product_code,
          risk_tier: configured.inventory_risk_tier,
          traceability_state: configured.inventory_traceability_state,
        },
      });
      return configured;
    });
    return res.json({ status: "success", message: "Traceability configuration saved.", product });
  } catch (error) {
    return sendError(res, error, "Unable to configure product traceability.");
  }
});

// POST /api/inventory-traceability/products/:productId/label-batches
router.post("/products/:productId/label-batches", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const batch = await withTransaction(async (connection) => {
      const created = await createSerializedLabelBatch(connection, {
        branchId: storeId,
        productId: positiveInt(req.params.productId, "productId"),
        expectedQuantity: req.body.expected_quantity,
        sourceType: req.body.source_type || "opening_reconciliation",
        sourceId: req.body.source_id,
        sourceItemId: req.body.source_item_id,
        createdBy: req.user.id,
        notes: req.body.notes,
      });
      await writeAuditEvent({
        connection,
        req,
        branchId: storeId,
        userId: req.user.id,
        action: "GENERATE_INVENTORY_LABEL_BATCH",
        details: `Generated ${created.generated_quantity} serialized identities in batch ${created.batch_code}.`,
        workspaceCode: "spare_parts",
        entityType: "inventory_label_batch",
        entityId: created.id,
        actionType: "inventory_label_batch_generated",
        outcome: "success",
        severity: "high",
        metadata: {
          product_id: created.product_id,
          expected_quantity: created.expected_quantity,
          generated_quantity: created.generated_quantity,
        },
      });
      return created;
    });
    return res.status(201).json({
      status: "success",
      message: "Label identities generated. They are not active stock until physically attached and confirmed.",
      batch,
    });
  } catch (error) {
    return sendError(res, error, "Unable to generate serialized label batch.");
  }
});

// GET /api/inventory-traceability/label-batches/:batchId
router.get("/label-batches/:batchId", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const batchId = positiveInt(req.params.batchId, "batchId");
    const [batches] = await pool.query(
      `SELECT lb.*, p.name AS product_name, p.inventory_product_code
       FROM inventory_label_batches lb
       INNER JOIN products p ON p.id = lb.product_id
       WHERE lb.id = ? AND lb.branch_id = ?
       LIMIT 1`,
      [batchId, storeId]
    );
    if (batches.length === 0) {
      return res.status(404).json({ status: "error", code: "TRACEABILITY_BATCH_NOT_FOUND", message: "Label batch not found." });
    }
    const [units] = await pool.query(
      `SELECT id, unit_code, status, activated_at, last_verified_at
       FROM inventory_units
       WHERE label_batch_id = ? AND current_branch_id = ?
       ORDER BY id ASC`,
      [batchId, storeId]
    );
    return res.json({ status: "success", batch: batches[0], units });
  } catch (error) {
    return sendError(res, error, "Unable to load label batch.");
  }
});

// GET /api/inventory-traceability/label-batches/:batchId/labels
router.get("/label-batches/:batchId/labels", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const batchId = positiveInt(req.params.batchId, "batchId");
    const [rows] = await pool.query(
      `SELECT u.id, u.unit_code, u.status, lb.batch_code, lb.product_id, p.name AS product_name
       FROM inventory_units u
       INNER JOIN inventory_label_batches lb ON lb.id = u.label_batch_id
       INNER JOIN products p ON p.id = u.product_id
       WHERE u.label_batch_id = ? AND lb.branch_id = ?
       ORDER BY u.id ASC`,
      [batchId, storeId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ status: "error", code: "TRACEABILITY_BATCH_NOT_FOUND", message: "Label batch has no identities in this store." });
    }
    const labels = rows.map((row) => ({
      ...row,
      qr_payload: buildSignedLabelPayload(row.unit_code),
    }));
    return res.json({ status: "success", batch_code: rows[0].batch_code, labels });
  } catch (error) {
    return sendError(res, error, "Unable to prepare signed inventory labels.");
  }
});

// POST /api/inventory-traceability/label-batches/:batchId/printed
router.post("/label-batches/:batchId/printed", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const batch = await withTransaction((connection) => markLabelBatchPrinted(connection, {
      branchId: storeId,
      batchId: positiveInt(req.params.batchId, "batchId"),
      printFormat: req.body.print_format,
      copies: req.body.copies || 1,
      printedBy: req.user.id,
      approvedBy: req.body.approved_by,
      reason: req.body.reason,
    }));
    return res.json({ status: "success", message: "Label print event recorded.", batch });
  } catch (error) {
    return sendError(res, error, "Unable to record label printing.");
  }
});

// POST /api/inventory-traceability/label-batches/:batchId/activate
router.post("/label-batches/:batchId/activate", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const batch = await withTransaction(async (connection) => {
      const activated = await activateLabelBatch(connection, {
        branchId: storeId,
        batchId: positiveInt(req.params.batchId, "batchId"),
        activeUnitCodes: req.body.active_unit_codes,
        voidUnitCodes: req.body.void_unit_codes || [],
        verifiedBy: req.user.id,
        notes: req.body.notes,
      });
      await writeAuditEvent({
        connection,
        req,
        branchId: storeId,
        userId: req.user.id,
        action: "ACTIVATE_INVENTORY_LABEL_BATCH",
        details: `Activated ${activated.activated_quantity} identity labels and voided ${activated.voided_quantity} unused labels in ${activated.batch_code}.`,
        workspaceCode: "spare_parts",
        entityType: "inventory_label_batch",
        entityId: activated.id,
        actionType: "inventory_label_batch_activated",
        outcome: "success",
        severity: "high",
        metadata: {
          activated_quantity: activated.activated_quantity,
          voided_quantity: activated.voided_quantity,
          identity_gap: activated.product.identity_gap,
          ready_for_serialized_enforcement: activated.product.ready_for_serialized_enforcement,
        },
      });
      return activated;
    });
    return res.json({
      status: "success",
      message: batch.product.ready_for_serialized_enforcement
        ? "Physical labels confirmed. Product identities now reconcile with system quantity; an administrator may enable enforcement separately."
        : "Physical labels confirmed, but identity quantity does not yet reconcile with system stock. Keep the product in setup and reconcile the difference.",
      batch,
    });
  } catch (error) {
    return sendError(res, error, "Unable to activate label batch.");
  }
});

// POST /api/inventory-traceability/scan/verify
router.post("/scan/verify", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const input = cleanText(req.body.value, 200);
    const signed = input?.startsWith("C03U1|")
      ? verifySignedLabelPayload(input)
      : { valid: true, unitCode: normalizeUnitCode(input), reason: null };
    if (!signed.valid) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_INVENTORY_LABEL",
        message: `The scanned inventory label is invalid (${signed.reason}).`,
      });
    }
    const traceability = await getUnitTraceability(pool, {
      branchId: storeId,
      unitCode: signed.unitCode,
    });
    return res.json({
      status: "success",
      label_signature_valid: input?.startsWith("C03U1|") ? true : null,
      ...traceability,
    });
  } catch (error) {
    return sendError(res, error, "Unable to verify inventory identity.");
  }
});

// GET /api/inventory-traceability/units/:unitCode
router.get("/units/:unitCode", requireRole("admin", "manager"), async (req, res) => {
  try {
    const traceability = await getUnitTraceability(pool, {
      branchId: branchId(req),
      unitCode: req.params.unitCode,
    });
    return res.json({ status: "success", ...traceability });
  } catch (error) {
    return sendError(res, error, "Unable to find inventory unit.");
  }
});

module.exports = router;
