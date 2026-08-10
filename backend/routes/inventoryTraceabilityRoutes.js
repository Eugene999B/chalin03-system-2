const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  RISK_TIERS,
  TRACEABILITY_STATES,
  TRACKING_MODES,
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
const {
  buildInventoryLabelPdf,
} = require("../services/inventoryLabelDocumentService");

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

function roleOf(req) {
  return String(req.user?.role || "").trim().toLowerCase();
}

function traceabilityError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
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

async function loadPrintableBatch(storeId, batchId) {
  const [batches] = await pool.query(
    `SELECT
       lb.id,
       lb.batch_code,
       lb.branch_id,
       lb.product_id,
       lb.status,
       lb.created_by,
       lb.printed_by,
       lb.printed_at,
       p.name AS product_name,
       p.size AS product_size,
       p.inventory_product_code,
       b.branch_code,
       b.name AS branch_name
     FROM inventory_label_batches lb
     INNER JOIN products p ON p.id = lb.product_id
     INNER JOIN branches b ON b.id = lb.branch_id
     WHERE lb.id = ? AND lb.branch_id = ?
     LIMIT 1`,
    [batchId, storeId]
  );
  if (batches.length === 0) {
    throw traceabilityError(
      "Label batch not found in the selected store.",
      404,
      "TRACEABILITY_BATCH_NOT_FOUND"
    );
  }

  const [units] = await pool.query(
    `SELECT id, unit_code, status
     FROM inventory_units
     WHERE label_batch_id = ?
       AND current_branch_id = ?
       AND status = 'label_pending'
     ORDER BY id ASC`,
    [batchId, storeId]
  );
  if (units.length === 0) {
    throw traceabilityError(
      "This batch has no pending physical identities available for label printing.",
      409,
      "TRACEABILITY_NO_PRINTABLE_UNITS"
    );
  }

  return { batch: batches[0], units };
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
         COALESCE(SUM(CASE WHEN u.status = 'active' THEN 1 ELSE 0 END), 0) AS active_identity_count,
         COALESCE(SUM(CASE WHEN u.status = 'label_pending' THEN 1 ELSE 0 END), 0) AS pending_identity_count,
         COALESCE(SUM(CASE WHEN u.status = 'missing' THEN 1 ELSE 0 END), 0) AS missing_identity_count
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
         lb.id,
         lb.batch_code,
         lb.source_type,
         lb.source_id,
         lb.source_item_id,
         lb.expected_quantity,
         lb.generated_quantity,
         lb.activated_quantity,
         lb.voided_quantity,
         lb.status,
         lb.label_format,
         lb.created_at,
         lb.printed_at,
         lb.verified_at,
         lb.activated_at,
         lb.notes,
         (SELECT COUNT(*) FROM inventory_label_print_events pe WHERE pe.label_batch_id = lb.id) AS print_event_count
       FROM inventory_label_batches lb
       WHERE lb.branch_id = ? AND lb.product_id = ?
       ORDER BY lb.created_at DESC, lb.id DESC`,
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
      message: "Label identities generated. They are not active stock until physically attached and independently confirmed.",
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
      `SELECT
         lb.*,
         p.name AS product_name,
         p.inventory_product_code,
         (SELECT COUNT(*) FROM inventory_label_print_events pe WHERE pe.label_batch_id = lb.id) AS print_event_count
       FROM inventory_label_batches lb
       INNER JOIN products p ON p.id = lb.product_id
       WHERE lb.id = ? AND lb.branch_id = ?
       LIMIT 1`,
      [batchId, storeId]
    );
    if (batches.length === 0) {
      return res.status(404).json({
        status: "error",
        code: "TRACEABILITY_BATCH_NOT_FOUND",
        message: "Label batch not found.",
      });
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
// Deliberately returns only human-readable IDs. Signed QR payloads are generated
// exclusively inside the audited PDF print operation below.
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
      return res.status(404).json({
        status: "error",
        code: "TRACEABILITY_BATCH_NOT_FOUND",
        message: "Label batch has no identities in this store.",
      });
    }
    return res.json({
      status: "success",
      batch_code: rows[0].batch_code,
      labels: rows,
      note: "Signed QR payloads are not exposed through the API. Use the controlled print action.",
    });
  } catch (error) {
    return sendError(res, error, "Unable to load inventory label identities.");
  }
});

// POST /api/inventory-traceability/label-batches/:batchId/print
// Initial print: admin or manager. Reprint: admin only + mandatory reason.
router.post("/label-batches/:batchId/print", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const batchId = positiveInt(req.params.batchId, "batchId");
    const format = req.body.print_format || "a4";
    const reason = cleanText(req.body.reason, 500);
    const { batch, units } = await loadPrintableBatch(storeId, batchId);
    const document = await buildInventoryLabelPdf({
      batch,
      units,
      format,
    });

    const printResult = await withTransaction(async (connection) => {
      const [batchLockRows] = await connection.query(
        `SELECT id, status, created_by, printed_by
         FROM inventory_label_batches
         WHERE id = ? AND branch_id = ?
         LIMIT 1 FOR UPDATE`,
        [batchId, storeId]
      );
      if (batchLockRows.length === 0) {
        throw traceabilityError(
          "Label batch not found in the selected store.",
          404,
          "TRACEABILITY_BATCH_NOT_FOUND"
        );
      }
      const [printRows] = await connection.query(
        `SELECT COUNT(*) AS print_count
         FROM inventory_label_print_events
         WHERE label_batch_id = ? AND branch_id = ?`,
        [batchId, storeId]
      );
      const printCount = Number(printRows[0]?.print_count || 0);
      const isReprint = printCount > 0;
      if (isReprint && roleOf(req) !== "admin") {
        throw traceabilityError(
          "Only a System Administrator can reprint inventory identity labels.",
          403,
          "TRACEABILITY_REPRINT_ADMIN_REQUIRED"
        );
      }
      if (isReprint && (!reason || reason.length < 8)) {
        throw traceabilityError(
          "A clear reprint reason of at least 8 characters is required.",
          400,
          "TRACEABILITY_REPRINT_REASON_REQUIRED"
        );
      }

      const recorded = await markLabelBatchPrinted(connection, {
        branchId: storeId,
        batchId,
        printFormat: document.format,
        copies: 1,
        printedBy: req.user.id,
        approvedBy: isReprint ? req.user.id : null,
        reason: isReprint ? reason : reason || "Initial controlled label print",
      });
      await writeAuditEvent({
        connection,
        req,
        branchId: storeId,
        userId: req.user.id,
        action: isReprint ? "REPRINT_INVENTORY_LABEL_BATCH" : "PRINT_INVENTORY_LABEL_BATCH",
        details: `${isReprint ? "Reprinted" : "Printed"} ${document.label_count} identity labels for ${batch.batch_code} as ${document.format}.`,
        workspaceCode: "spare_parts",
        entityType: "inventory_label_batch",
        entityId: batchId,
        actionType: isReprint ? "inventory_label_batch_reprinted" : "inventory_label_batch_printed",
        outcome: "success",
        severity: isReprint ? "high" : "notice",
        metadata: {
          product_id: batch.product_id,
          label_count: document.label_count,
          print_format: document.format,
          reprint: isReprint,
          prior_print_count: printCount,
          reason: isReprint ? reason : null,
        },
      });
      return { ...recorded, reprint: isReprint, prior_print_count: printCount };
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${document.file_name.replace(/[^A-Za-z0-9_.-]/g, "_")}"`
    );
    res.setHeader("X-Inventory-Label-Count", String(document.label_count));
    res.setHeader("X-Inventory-Label-Reprint", printResult.reprint ? "true" : "false");
    return res.send(document.buffer);
  } catch (error) {
    return sendError(res, error, "Unable to generate controlled inventory labels.");
  }
});

// Legacy acknowledgement endpoint is deliberately disabled. A print record must
// come from the server-side PDF generation action above.
router.post("/label-batches/:batchId/printed", requireRole("admin", "manager"), async (_req, res) => {
  return res.status(410).json({
    status: "error",
    code: "TRACEABILITY_USE_CONTROLLED_PRINT",
    message: "Use the controlled label Print action so the PDF and audit evidence are created together.",
  });
});

// POST /api/inventory-traceability/label-batches/:batchId/activate
router.post("/label-batches/:batchId/activate", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const batchId = positiveInt(req.params.batchId, "batchId");
    const batch = await withTransaction(async (connection) => {
      const [controlRows] = await connection.query(
        `SELECT
           lb.id,
           lb.created_by,
           lb.printed_by,
           lb.status,
           (SELECT COUNT(*) FROM inventory_label_print_events pe WHERE pe.label_batch_id = lb.id) AS print_event_count
         FROM inventory_label_batches lb
         WHERE lb.id = ? AND lb.branch_id = ?
         LIMIT 1 FOR UPDATE`,
        [batchId, storeId]
      );
      if (controlRows.length === 0) {
        throw traceabilityError(
          "Label batch not found in the selected store.",
          404,
          "TRACEABILITY_BATCH_NOT_FOUND"
        );
      }
      const control = controlRows[0];
      if (Number(control.print_event_count || 0) <= 0) {
        throw traceabilityError(
          "Print the controlled physical labels before confirming attachment and activation.",
          409,
          "TRACEABILITY_PRINT_REQUIRED_BEFORE_ACTIVATION"
        );
      }
      if (
        roleOf(req) !== "admin" &&
        [Number(control.created_by), Number(control.printed_by)].includes(Number(req.user.id))
      ) {
        throw traceabilityError(
          "A manager who generated or printed this batch cannot independently verify its physical attachment. Ask another authorized manager or the System Administrator to verify it.",
          403,
          "TRACEABILITY_INDEPENDENT_VERIFICATION_REQUIRED"
        );
      }

      const activated = await activateLabelBatch(connection, {
        branchId: storeId,
        batchId,
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
          independent_verification: roleOf(req) === "admin" ? "admin_override_allowed" : "separate_manager",
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
