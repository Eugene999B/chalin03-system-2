const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

function toMoney(value) {
  const number = Number(value);

  if (Number.isNaN(number) || number < 0) {
    return null;
  }

  return number.toFixed(2);
}

function toNonNegativeInt(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 0) {
    return null;
  }

  return number;
}

function nullIfEmpty(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return value;
}

async function logActivity(userId, action, details) {
  await pool.query(
    `INSERT INTO activity_log (user_id, action, details)
     VALUES (?, ?, ?)`,
    [userId || null, action, details]
  );
}

// GET /api/products
router.get("/", requireAuth, async (req, res) => {
  try {
    const { search, category, lowStock } = req.query;

    let sql = `
      SELECT
        id,
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
        created_at,
        updated_at
      FROM products
      WHERE is_active = TRUE
    `;

    const params = [];

    if (search) {
      sql += `
        AND (
          name LIKE ?
          OR category LIKE ?
          OR size LIKE ?
          OR barcode LIKE ?
        )
      `;

      const searchValue = `%${search}%`;
      params.push(searchValue, searchValue, searchValue, searchValue);
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
      count: products.length,
      products,
    });
  } catch (error) {
    console.error("Get products error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching products.",
    });
  }
});


// GET /api/products/low-stock
router.get("/low-stock", requireAuth, async (req, res) => {
  try {
    const [products] = await pool.query(
      `SELECT
        id,
        name,
        size,
        category,
        cost_price,
        selling_price,
        quantity,
        low_stock_threshold,
        barcode,
        image_url,
        CASE
          WHEN quantity = 0 THEN 'out_of_stock'
          WHEN quantity <= low_stock_threshold THEN 'low_stock'
          ELSE 'ok'
        END AS stock_status,
        GREATEST((low_stock_threshold * 2) - quantity, 0) AS suggested_restock_quantity,
        GREATEST((low_stock_threshold * 2) - quantity, 0) * cost_price AS estimated_restock_cost
       FROM products
       WHERE is_active = TRUE
       AND quantity <= low_stock_threshold
       ORDER BY quantity ASC, name ASC`
    );

    const outOfStockCount = products.filter(
      (product) => Number(product.quantity || 0) === 0
    ).length;

    const lowStockCount = products.length - outOfStockCount;

    const estimatedRestockCost = products.reduce(
      (sum, product) => sum + Number(product.estimated_restock_cost || 0),
      0
    );

    return res.json({
      status: "success",
      count: products.length,
      out_of_stock_count: outOfStockCount,
      low_stock_count: lowStockCount,
      estimated_restock_cost: Number(estimatedRestockCost.toFixed(2)),
      products,
    });
  } catch (error) {
    console.error("Low stock products error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching low-stock products.",
    });
  }
});

// GET /api/products/:id/stock-adjustments
router.get(
  "/:id/stock-adjustments",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const [productRows] = await pool.query(
        `SELECT id, name, quantity
         FROM products
         WHERE id = ?
         LIMIT 1`,
        [id]
      );

      if (productRows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Product not found.",
        });
      }

      const [adjustments] = await pool.query(
        `SELECT
          sa.id,
          sa.product_id,
          sa.adjustment_type,
          sa.quantity,
          sa.old_quantity,
          sa.new_quantity,
          sa.reason,
          sa.adjusted_at,
          u.full_name AS adjusted_by_name
         FROM stock_adjustments sa
         LEFT JOIN users u ON sa.adjusted_by = u.id
         WHERE sa.product_id = ?
         ORDER BY sa.adjusted_at DESC, sa.id DESC`,
        [id]
      );

      return res.json({
        status: "success",
        product: productRows[0],
        count: adjustments.length,
        adjustments,
      });
    } catch (error) {
      console.error("Get stock adjustments error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while fetching stock adjustments.",
      });
    }
  }
);

// GET /api/products/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [products] = await pool.query(
      `SELECT
        id,
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
        created_at,
        updated_at
       FROM products
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    if (products.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Product not found.",
      });
    }

    return res.json({
      status: "success",
      product: products[0],
    });
  } catch (error) {
    console.error("Get single product error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching the product.",
    });
  }
});

// POST /api/products
router.post(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const {
        name,
        size,
        category,
        cost_price,
        selling_price,
        quantity,
        low_stock_threshold,
        barcode,
        image_url,
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Product name is required.",
        });
      }

      const cleanName = name.trim();
      const costPrice = toMoney(cost_price);
      const sellingPrice = toMoney(selling_price);
      const productQuantity = toNonNegativeInt(Number(quantity ?? 0));
      const lowStockThreshold = toNonNegativeInt(
        Number(low_stock_threshold ?? 5)
      );

      if (costPrice === null) {
        return res.status(400).json({
          status: "error",
          message: "Cost price must be a valid number and cannot be negative.",
        });
      }

      if (sellingPrice === null) {
        return res.status(400).json({
          status: "error",
          message:
            "Selling price must be a valid number and cannot be negative.",
        });
      }

      if (productQuantity === null) {
        return res.status(400).json({
          status: "error",
          message: "Quantity must be a whole number and cannot be negative.",
        });
      }

      if (lowStockThreshold === null) {
        return res.status(400).json({
          status: "error",
          message:
            "Low-stock threshold must be a whole number and cannot be negative.",
        });
      }

      const [result] = await pool.query(
        `INSERT INTO products (
          name,
          size,
          category,
          cost_price,
          selling_price,
          quantity,
          low_stock_threshold,
          barcode,
          image_url,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cleanName,
          nullIfEmpty(size),
          nullIfEmpty(category),
          costPrice,
          sellingPrice,
          productQuantity,
          lowStockThreshold,
          nullIfEmpty(barcode),
          nullIfEmpty(image_url),
          req.user.id,
        ]
      );

      await logActivity(
        req.user.id,
        "CREATE_PRODUCT",
        `Created product "${cleanName}" with quantity ${productQuantity}`
      );

      const [products] = await pool.query(
        `SELECT * FROM products WHERE id = ? LIMIT 1`,
        [result.insertId]
      );

      return res.status(201).json({
        status: "success",
        message: "Product created successfully.",
        product: products[0],
      });
    } catch (error) {
      console.error("Create product error:", error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message: "A product with this barcode already exists.",
        });
      }

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while creating the product.",
      });
    }
  }
);

// PUT /api/products/:id
router.put(
  "/:id",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const {
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
      } = req.body;

      const [existingProducts] = await pool.query(
        `SELECT * FROM products WHERE id = ? LIMIT 1`,
        [id]
      );

      if (existingProducts.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Product not found.",
        });
      }

      if (!name || !name.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Product name is required.",
        });
      }

      const cleanName = name.trim();
      const costPrice = toMoney(cost_price);
      const sellingPrice = toMoney(selling_price);
      const productQuantity = toNonNegativeInt(Number(quantity));
      const lowStockThreshold = toNonNegativeInt(Number(low_stock_threshold));

      if (
        costPrice === null ||
        sellingPrice === null ||
        productQuantity === null ||
        lowStockThreshold === null
      ) {
        return res.status(400).json({
          status: "error",
          message: "Please check price, quantity and low-stock values.",
        });
      }

      await pool.query(
        `UPDATE products
         SET
          name = ?,
          size = ?,
          category = ?,
          cost_price = ?,
          selling_price = ?,
          quantity = ?,
          low_stock_threshold = ?,
          barcode = ?,
          image_url = ?,
          is_active = ?
         WHERE id = ?`,
        [
          cleanName,
          nullIfEmpty(size),
          nullIfEmpty(category),
          costPrice,
          sellingPrice,
          productQuantity,
          lowStockThreshold,
          nullIfEmpty(barcode),
          nullIfEmpty(image_url),
          is_active === false ? false : true,
          id,
        ]
      );

      await logActivity(
        req.user.id,
        "UPDATE_PRODUCT",
        `Updated product "${cleanName}" with ID ${id}`
      );

      const [products] = await pool.query(
        `SELECT * FROM products WHERE id = ? LIMIT 1`,
        [id]
      );

      return res.json({
        status: "success",
        message: "Product updated successfully.",
        product: products[0],
      });
    } catch (error) {
      console.error("Update product error:", error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message: "A product with this barcode already exists.",
        });
      }

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while updating the product.",
      });
    }
  }
);

// PATCH /api/products/:id/stock-adjustment
router.patch(
  "/:id/stock-adjustment",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const { id } = req.params;
      const { adjustment_type, quantity, reason } = req.body;

      if (!["increase", "decrease", "set"].includes(adjustment_type)) {
        return res.status(400).json({
          status: "error",
          message: "Adjustment type must be increase, decrease, or set.",
        });
      }

      const adjustmentQuantity = toNonNegativeInt(Number(quantity));

      if (adjustmentQuantity === null) {
        return res.status(400).json({
          status: "error",
          message: "Quantity must be a whole number and cannot be negative.",
        });
      }

      if (adjustment_type !== "set" && adjustmentQuantity <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Increase or decrease quantity must be greater than zero.",
        });
      }

      if (!reason || !reason.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Reason is required for stock adjustment.",
        });
      }

      const cleanReason = reason.trim();

      await connection.beginTransaction();

      const [products] = await connection.query(
        `SELECT id, name, quantity
         FROM products
         WHERE id = ?
         AND is_active = TRUE
         LIMIT 1
         FOR UPDATE`,
        [id]
      );

      if (products.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Product not found.",
        });
      }

      const product = products[0];
      const oldQuantity = Number(product.quantity || 0);

      let newQuantity = oldQuantity;

      if (adjustment_type === "increase") {
        newQuantity = oldQuantity + adjustmentQuantity;
      }

      if (adjustment_type === "decrease") {
        newQuantity = oldQuantity - adjustmentQuantity;
      }

      if (adjustment_type === "set") {
        newQuantity = adjustmentQuantity;
      }

      if (newQuantity < 0) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "Stock cannot be less than zero.",
        });
      }

      await connection.query(
        `UPDATE products
         SET quantity = ?
         WHERE id = ?`,
        [newQuantity, id]
      );

      const [adjustmentResult] = await connection.query(
        `INSERT INTO stock_adjustments (
          product_id,
          adjustment_type,
          quantity,
          old_quantity,
          new_quantity,
          reason,
          adjusted_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          adjustment_type,
          adjustmentQuantity,
          oldQuantity,
          newQuantity,
          cleanReason,
          req.user.id,
        ]
      );

      await connection.query(
        `INSERT INTO activity_log (user_id, action, details)
         VALUES (?, ?, ?)`,
        [
          req.user.id,
          "STOCK_ADJUSTMENT",
          `Product "${product.name}" stock changed from ${oldQuantity} to ${newQuantity}. Reason: ${cleanReason}`,
        ]
      );

      await connection.commit();

      const [updatedProducts] = await pool.query(
        `SELECT * FROM products WHERE id = ? LIMIT 1`,
        [id]
      );

      return res.json({
        status: "success",
        message: "Stock adjusted successfully.",
        old_quantity: oldQuantity,
        new_quantity: newQuantity,
        adjustment: {
          id: adjustmentResult.insertId,
          product_id: Number(id),
          adjustment_type,
          quantity: adjustmentQuantity,
          old_quantity: oldQuantity,
          new_quantity: newQuantity,
          reason: cleanReason,
          adjusted_by: req.user.id,
        },
        product: updatedProducts[0],
      });
    } catch (error) {
      await connection.rollback();

      console.error("Stock adjustment error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while adjusting stock. Make sure the stock_adjustments table exists.",
      });
    } finally {
      connection.release();
    }
  }
);

// DELETE /api/products/:id
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;

    const [products] = await pool.query(
      `SELECT id, name FROM products WHERE id = ? LIMIT 1`,
      [id]
    );

    if (products.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Product not found.",
      });
    }

    await pool.query(
      `UPDATE products
       SET is_active = FALSE
       WHERE id = ?`,
      [id]
    );

    await logActivity(
      req.user.id,
      "DELETE_PRODUCT",
      `Soft-deleted product "${products[0].name}" with ID ${id}`
    );

    return res.json({
      status: "success",
      message: "Product deleted successfully.",
    });
  } catch (error) {
    console.error("Delete product error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while deleting the product.",
    });
  }
});

module.exports = router;