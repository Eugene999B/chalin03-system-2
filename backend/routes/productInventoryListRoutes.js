const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

function branchId(req) {
  const id = Number(req.user?.branch_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const storeId = branchId(req);
    if (!storeId) {
      return res.status(400).json({
        status: "error",
        message: "No store was selected. Please logout and login again through a store.",
      });
    }

    const { search, category, lowStock } = req.query;
    let sql = `
      SELECT
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
      WHERE is_active = TRUE
        AND branch_id = ?
    `;
    const params = [storeId];

    if (search) {
      sql += `
        AND (
          name LIKE ?
          OR category LIKE ?
          OR size LIKE ?
          OR barcode LIKE ?
          OR inventory_product_code LIKE ?
        )
      `;
      const searchValue = `%${String(search).trim()}%`;
      params.push(searchValue, searchValue, searchValue, searchValue, searchValue);
    }
    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }
    if (lowStock === "true") {
      sql += ` AND quantity <= low_stock_threshold`;
    }
    sql += ` ORDER BY name ASC`;

    const [products] = await pool.query(sql, params);
    return res.json({
      status: "success",
      branch_id: storeId,
      count: products.length,
      products,
      inventory_traceability_policy: {
        serialized_checkout_requires_unit_ids_only_when_enforced: true,
        setup_mode_remains_backward_compatible: true,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
