const express = require("express");

const { pool } = require("../config/db");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  normalizeUnitCode,
  verifySignedLabelPayload,
} = require("../services/inventoryTraceabilityService");
const {
  reconcileAutomaticIdentityCoverage,
} = require("../services/inventoryIdentityStudioConstants");
const {
  withTransaction,
} = require("../services/inventoryTraceabilityRepositoryService");

const router = express.Router();

function selectedBranchId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clean(value) {
  return String(value ?? "").trim();
}

function productPayload(row) {
  return {
    id: Number(row.product_id || row.id),
    name: row.product_name || row.name,
    size: row.product_size || row.size || null,
    category: row.product_category || row.category || null,
    barcode: row.barcode || null,
    selling_price: Number(row.selling_price || 0),
    quantity: Number(row.product_quantity ?? row.quantity ?? 0),
    low_stock_threshold: Number(row.low_stock_threshold || 0),
    inventory_tracking_mode: row.inventory_tracking_mode || "quantity",
    inventory_traceability_state: row.inventory_traceability_state || "off",
    inventory_product_code: row.inventory_product_code || null,
  };
}

async function resolveExactUnit(branchId, input) {
  let unitCode;
  let signedLabel = false;
  if (input.startsWith("C03U1|")) {
    const verification = verifySignedLabelPayload(input);
    if (!verification.valid) {
      const error = new Error(`The scanned inventory label is invalid (${verification.reason}).`);
      error.statusCode = 400;
      error.code = "INVALID_INVENTORY_LABEL";
      throw error;
    }
    unitCode = verification.unitCode;
    signedLabel = true;
  } else {
    try {
      unitCode = normalizeUnitCode(input);
    } catch {
      return null;
    }
  }

  const [rows] = await pool.query(
    `SELECT
       u.id,
       u.unit_code,
       u.product_id,
       u.current_branch_id,
       u.status,
       u.sale_id,
       u.sale_item_id,
       p.name AS product_name,
       p.size AS product_size,
       p.category AS product_category,
       p.barcode,
       p.selling_price,
       p.quantity AS product_quantity,
       p.low_stock_threshold,
       p.inventory_tracking_mode,
       p.inventory_traceability_state,
       p.inventory_product_code
     FROM inventory_units u
     INNER JOIN products p ON p.id = u.product_id
     WHERE u.unit_code = ?
     LIMIT 1`,
    [unitCode]
  );
  const unit = rows[0];
  if (!unit) {
    const error = new Error(`Physical inventory unit ${unitCode} does not exist.`);
    error.statusCode = 404;
    error.code = "TRACEABILITY_SALE_UNIT_NOT_FOUND";
    throw error;
  }

  const sameStore = Number(unit.current_branch_id) === branchId;
  const alreadySold = Boolean(unit.sale_id || unit.sale_item_id || unit.status === "sold");
  const saleReady = sameStore && unit.status === "active" && !alreadySold;

  return {
    status: "success",
    scan_type: "exact_unit",
    label_signature_valid: signedLabel ? true : null,
    sale_ready: saleReady,
    blocking_reason: !sameStore
      ? "wrong_store"
      : alreadySold
        ? "already_sold"
        : unit.status !== "active"
          ? `status_${unit.status}`
          : null,
    product: productPayload(unit),
    unit: {
      id: unit.id,
      unit_code: unit.unit_code,
      product_id: unit.product_id,
      product_name: unit.product_name,
      current_branch_id: unit.current_branch_id,
      same_store: sameStore,
      status: unit.status,
      already_sold: alreadySold,
      inventory_tracking_mode: unit.inventory_tracking_mode,
      inventory_traceability_state: unit.inventory_traceability_state,
    },
    policy: {
      cashier_forensic_history_exposed: false,
      final_sale_validation_happens_inside_sale_transaction: true,
    },
  };
}

async function resolveProductBarcode(branchId, input) {
  const [rows] = await pool.query(
    `SELECT
       id,
       name,
       size,
       category,
       barcode,
       selling_price,
       quantity,
       low_stock_threshold,
       inventory_tracking_mode,
       inventory_traceability_state,
       inventory_product_code
     FROM products
     WHERE branch_id = ?
       AND is_active = TRUE
       AND barcode = ?
     LIMIT 1`,
    [branchId, input]
  );
  const product = rows[0];
  if (!product) return null;

  const enforced =
    String(product.inventory_tracking_mode || "").toLowerCase() === "serialized" &&
    String(product.inventory_traceability_state || "").toLowerCase() === "enforced";

  return {
    status: "success",
    scan_type: "product_barcode",
    sale_ready: Number(product.quantity || 0) > 0 && !enforced,
    blocking_reason:
      Number(product.quantity || 0) <= 0
        ? "out_of_stock"
        : enforced
          ? "exact_id_required"
          : null,
    product: productPayload(product),
    unit: null,
    policy: {
      product_barcode_is_not_an_exact_physical_identity: true,
      exact_id_required_when_enforced: true,
    },
  };
}

// One-time/backfill safety for products that existed before automatic IDs became the
// Chalin One default. Only an Admin or Manager can create this historical coverage.
router.post(
  "/sync-automatic-identities",
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = selectedBranchId(req);
      if (!branchId) {
        return res.status(400).json({
          status: "error",
          code: "AUTOMATIC_ID_SYNC_BRANCH_REQUIRED",
          message: "Select a store before reconciling automatic stock IDs.",
        });
      }

      const [products] = await pool.query(
        `SELECT id
         FROM products
         WHERE branch_id = ? AND is_active = TRUE
         ORDER BY id ASC`,
        [branchId]
      );

      let automaticIdsCreated = 0;
      let productsChanged = 0;
      for (const product of products) {
        const result = await withTransaction((connection) =>
          reconcileAutomaticIdentityCoverage(connection, {
            branchId,
            productId: Number(product.id),
            actorUserId: req.user.id,
            notes: "Automatic identity backfill for existing Chalin One stock.",
          })
        );
        if (Number(result.generated_quantity || 0) > 0) productsChanged += 1;
        automaticIdsCreated += Number(result.generated_quantity || 0);
      }

      return res.json({
        status: "success",
        message: automaticIdsCreated
          ? `${automaticIdsCreated} missing stock ID(s) were created automatically for existing products.`
          : "All existing product quantities already have automatic stock IDs.",
        products_checked: products.length,
        products_changed: productsChanged,
        automatic_ids_created: automaticIdsCreated,
      });
    } catch (error) {
      const statusCode = Number(error.statusCode || 500);
      if (statusCode >= 500) console.error("Automatic stock-ID sync error:", error);
      return res.status(statusCode).json({
        status: "error",
        code: error.code || "AUTOMATIC_STOCK_ID_SYNC_ERROR",
        message: statusCode >= 500
          ? "Unable to reconcile automatic stock IDs for existing products."
          : error.message,
      });
    }
  }
);

router.post("/verify", requireRole("admin", "manager", "cashier"), async (req, res) => {
  try {
    const branchId = selectedBranchId(req);
    if (!branchId) {
      return res.status(400).json({
        status: "error",
        code: "SALE_SCAN_BRANCH_REQUIRED",
        message: "Select a store before scanning a sale item.",
      });
    }

    const input = clean(req.body?.value);
    if (!input) {
      return res.status(400).json({
        status: "error",
        code: "SALE_SCAN_VALUE_REQUIRED",
        message: "Scan a CHALIN ID, product barcode, or enter the exact ID.",
      });
    }

    const exact = await resolveExactUnit(branchId, input);
    if (exact) return res.json(exact);

    const barcode = await resolveProductBarcode(branchId, input);
    if (barcode) return res.json(barcode);

    return res.status(404).json({
      status: "error",
      code: "AUTONOMOUS_SALE_SCAN_NOT_FOUND",
      message: "This scan did not match an exact CHALIN stock ID or a product barcode in the selected store.",
    });
  } catch (error) {
    const statusCode = Number(error.statusCode || 500);
    if (statusCode >= 500) console.error("Autonomous sale scan error:", error);
    return res.status(statusCode).json({
      status: "error",
      code: error.code || "AUTONOMOUS_SALE_SCAN_ERROR",
      message: statusCode >= 500 ? "Unable to resolve this sale scan." : error.message,
    });
  }
});

module.exports = router;
