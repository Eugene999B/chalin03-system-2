const express = require("express");

const { pool } = require("../config/db");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  normalizeUnitCode,
  verifySignedLabelPayload,
} = require("../services/inventoryTraceabilityService");

const router = express.Router();

function selectedBranchId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clean(value) {
  return String(value ?? "").trim();
}

router.post("/verify", requireRole("admin", "manager", "cashier"), async (req, res) => {
  try {
    const branchId = selectedBranchId(req);
    if (!branchId) {
      return res.status(400).json({
        status: "error",
        code: "SALE_SCAN_BRANCH_REQUIRED",
        message: "Select a store before scanning a physical sale unit.",
      });
    }

    const input = clean(req.body?.value);
    if (!input) {
      return res.status(400).json({
        status: "error",
        code: "SALE_SCAN_VALUE_REQUIRED",
        message: "Scan or enter the physical inventory unit ID.",
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
         p.name AS product_name,
         p.inventory_tracking_mode,
         p.inventory_traceability_state
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
        code: "TRACEABILITY_SALE_UNIT_NOT_FOUND",
        message: `Physical inventory unit ${unitCode} does not exist.`,
      });
    }

    return res.json({
      status: "success",
      label_signature_valid: signedLabel ? true : null,
      unit: {
        id: unit.id,
        unit_code: unit.unit_code,
        product_id: unit.product_id,
        product_name: unit.product_name,
        current_branch_id: unit.current_branch_id,
        same_store: Number(unit.current_branch_id) === branchId,
        status: unit.status,
        already_sold: Boolean(unit.sale_id || unit.sale_item_id || unit.status === "sold"),
        inventory_tracking_mode: unit.inventory_tracking_mode,
        inventory_traceability_state: unit.inventory_traceability_state,
      },
      policy: {
        cashier_forensic_history_exposed: false,
        final_sale_validation_happens_inside_sale_transaction: true,
      },
    });
  } catch (error) {
    const statusCode = Number(error.statusCode || 500);
    if (statusCode >= 500) console.error("Serialized sale scan error:", error);
    return res.status(statusCode).json({
      status: "error",
      code: error.code || "SERIALIZED_SALE_SCAN_ERROR",
      message: statusCode >= 500 ? "Unable to verify physical sale unit." : error.message,
    });
  }
});

module.exports = router;
