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
         p.id,
         p.branch_id,
         p.name,
         p.size,
         p.category,
         p.cost_price,
         p.selling_price,
         p.quantity AS system_quantity,
         CASE
           WHEN p.inventory_tracking_mode = 'serialized'
            AND p.inventory_traceability_state = 'enforced'
           THEN (
             SELECT COUNT(*)
             FROM inventory_units u
             WHERE u.product_id = p.id
               AND u.current_branch_id = p.branch_id
               AND u.status = 'active'
           )
           ELSE p.quantity
         END AS quantity,
         p.low_stock_threshold,
         p.barcode,
         p.image_url,
         p.is_active,
         p.inventory_tracking_mode,
         p.inventory_product_code,
         p.inventory_risk_tier,
         p.inventory_traceability_state,
         p.inventory_traceability_configured_at,
         p.created_at,
         p.updated_at
       FROM products p
       WHERE p.branch_id = ? AND p.is_active = TRUE
       ORDER BY p.name ASC`,
      [branchId]
    );

    return res.json({
      status: "success",
      branch_id: branchId,
      count: products.length,
      products,
      inventory_traceability_policy: {
        serialized_checkout_requires_unit_ids_only_when_enforced: true,
        enforced_serialized_quantity_means_active_sellable_identities: true,
        system_quantity_retained_separately: true,
        returned_quarantine_is_not_sellable: true,
        setup_mode_remains_backward_compatible: true,
        final_unit_validation_inside_sale_transaction: true,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
