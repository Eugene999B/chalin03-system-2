const express = require("express");

const { pool } = require("../config/db");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  normalizeUnitCode,
  verifySignedLabelPayload,
} = require("../services/inventoryTraceabilityService");

const router = express.Router();

function branchId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.post("/verify", requireRole("admin", "manager"), async (req, res) => {
  try {
    const storeId = branchId(req);
    const saleId = positiveId(req.body?.sale_id);
    const productId = positiveId(req.body?.product_id);
    const input = String(req.body?.value || "").trim();
    if (!storeId || !saleId || !productId || !input) {
      return res.status(400).json({
        status: "error",
        code: "RETURN_SCAN_DETAILS_REQUIRED",
        message: "Store, receipt, product and physical unit ID are required for return verification.",
      });
    }

    let unitCode;
    let signedLabel = false;
    if (input.startsWith("C03U1|")) {
      const verification = verifySignedLabelPayload(input);
      if (!verification.valid) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_INVENTORY_LABEL",
          message: `The scanned inventory label is invalid (${verification.reason}).`,
        });
      }
      unitCode = verification.unitCode;
      signedLabel = true;
    } else {
      unitCode = normalizeUnitCode(input);
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
         u.return_id,
         p.name AS product_name
       FROM inventory_units u
       INNER JOIN products p ON p.id = u.product_id
       WHERE u.unit_code = ?
       LIMIT 1`,
      [unitCode]
    );
    const unit = rows[0];
    if (!unit) {
      return res.status(404).json({
        status: "error",
        code: "TRACEABILITY_RETURN_UNIT_NOT_FOUND",
        message: `Physical inventory unit ${unitCode} does not exist.`,
      });
    }

    const sameStore = Number(unit.current_branch_id) === storeId;
    const sameSale = Number(unit.sale_id) === saleId;
    const sameProduct = Number(unit.product_id) === productId;
    const sold = unit.status === "sold" && !unit.return_id;

    return res.json({
      status: "success",
      label_signature_valid: signedLabel ? true : null,
      eligible: sameStore && sameSale && sameProduct && sold,
      unit: {
        id: unit.id,
        unit_code: unit.unit_code,
        product_id: unit.product_id,
        product_name: unit.product_name,
        status: unit.status,
        same_store: sameStore,
        same_sale: sameSale,
        same_product: sameProduct,
        already_returned: Boolean(unit.return_id || unit.status === "returned_quarantine"),
      },
      policy: {
        return_requires_exact_sold_identity: true,
        return_destination: "returned_quarantine",
        forensic_history_exposed: false,
      },
    });
  } catch (error) {
    const statusCode = Number(error.statusCode || 500);
    if (statusCode >= 500) console.error("Serialized return scan error:", error);
    return res.status(statusCode).json({
      status: "error",
      code: error.code || "SERIALIZED_RETURN_SCAN_ERROR",
      message: statusCode >= 500 ? "Unable to verify returned physical unit." : error.message,
    });
  }
});

module.exports = router;
