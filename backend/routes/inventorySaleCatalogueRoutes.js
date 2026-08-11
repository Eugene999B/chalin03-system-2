const express = require("express");

const { pool } = require("../config/db");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

function selectedBranchId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/", requireRole("admin", "manager", "cashier"), async (req, res, next) => {
  try {
    const branchId = selectedBranchId(req);
    if (!branchId) {
      return res.status(400).json({
        status: "error",
        message: "No store was selected. Please logout and login again through a store.",
      });
    }

    const [products] = await pool.query(
      `SELECT
         id,
         branch_id,
         name,
         size,
         category,
         cost_price,
         selling_price,
         quantity,
         low_stock_threshold,
         barcode,
         image_url,
         is_active,
         inventory_tracking_mode,
         inventory_product_code,
         inventory_risk_tier,
         inventory_traceability_state,
         inventory_traceability_configured_at,
         created_at,
         updated_at
       FROM products
       WHERE branch_id = ? AND is_active = TRUE
       ORDER BY name ASC`,
      [branchId]
    );

    return res.json({
      status: "success",
      branch_id: branchId,
      count: products.length,
      products,
      inventory_traceability_policy: {
        serialized_checkout_requires_unit_ids_only_when_enforced: true,
        setup_mode_remains_backward_compatible: true,
        final_unit_validation_inside_sale_transaction: true,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
