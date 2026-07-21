const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  buildOwnerAlertContext,
  formatMoney,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");
const { writeAuditEvent } = require("../services/auditTrailService");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const { validateStockAdjustmentRequest } = require("../validation/operationsRequestValidators");
const {
  MOVEMENT_TYPES,
  calculateStockAfter,
  movementLabel,
  normalizeMovementType,
  validateMovementCompatibility,
} = require("../services/stockMovementService");

const router = express.Router();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return null;
  }

  return branchId;
}

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

function toSafeLimit(value, fallback = 50) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }

  return Math.min(number, 200);
}

function toOptionalMoney(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return toMoney(value);
}

function toMovementDate(value) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) {
    return new Date().toISOString().slice(0, 10);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
    return null;
  }

  const parsed = new Date(`${cleanValue}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10) === cleanValue
    ? cleanValue
    : null;
}


async function safeStockLedgerQuery(label, sql, params) {
  try {
    const [rows] = await pool.query(sql, params);

    return {
      rows,
      warning: null,
    };
  } catch (error) {
    console.warn(`Stock ledger ${label} query skipped:`, error.message);

    return {
      rows: [],
      warning: `${label} records skipped: ${error.message}`,
    };
  }
}

function toLedgerNumber(value) {
  const number = Number(value || 0);

  if (Number.isNaN(number)) {
    return 0;
  }

  return number;
}

function nullIfEmpty(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return value;
}

async function logActivity(branchId, userId, action, details) {
  await writeAuditEvent({
    branchId: branchId || null,
    userId: userId || null,
    action,
    details,
    workspaceCode: "spare_parts",
    entityType: "product",
    actionType: action,
    outcome: "success",
    severity: action.includes("DELETE") ? "critical" : "notice",
  });
}

function requireSelectedBranch(req, res) {
  const branchId = getBranchId(req);

  if (!branchId) {
    res.status(400).json({
      status: "error",
      message:
        "No store was selected. Please logout and login again through a store.",
    });

    return null;
  }

  return branchId;
}

async function sendProductDeletedSecuritySmsAlert({
  product,
  deletedByUser,
  branchId,
}) {
  try {
    const { businessName, branch } = await buildOwnerAlertContext(branchId);

    const deletedBy =
      deletedByUser?.full_name || deletedByUser?.username || "Admin";

    const productName = product?.name || "Unknown product";
    const productBarcode = product?.barcode || "-";
    const productCategory = product?.category || "-";
    const productSize = product?.size || "-";
    const productQuantity = Number(product?.quantity || 0);
    const productSellingPrice = formatMoney(product?.selling_price);

    const message = `${businessName}: Security alert. Product deleted: ${productName}. Category: ${productCategory}. Size: ${productSize}. Barcode: ${productBarcode}. Qty before delete: ${productQuantity}. Selling price: GHS ${productSellingPrice}. Store: ${branch.name} (${branch.code}). Deleted by ${deletedBy} on ${formatSecurityDateTime()}.`;

    await sendOwnerSmsAlert({
      branchId,
      message,
      smsType: "security_alert",
      sentBy: deletedByUser?.id || null,
    });
  } catch (error) {
    console.warn("Product deleted SMS alert skipped:", error.message);
  }
}

// GET /api/products
router.get("/", requireAuth, async (req, res) => {
  try {
    const branchId = requireSelectedBranch(req, res);

    if (!branchId) {
      return;
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
        created_at,
        updated_at
      FROM products
      WHERE is_active = TRUE
      AND branch_id = ?
    `;

    const params = [branchId];

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
      branch_id: branchId,
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
    const branchId = requireSelectedBranch(req, res);

    if (!branchId) {
      return;
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
        CASE
          WHEN quantity = 0 THEN 'out_of_stock'
          WHEN quantity <= low_stock_threshold THEN 'low_stock'
          ELSE 'ok'
        END AS stock_status,
        GREATEST((low_stock_threshold * 2) - quantity, 0) AS suggested_restock_quantity,
        GREATEST((low_stock_threshold * 2) - quantity, 0) * cost_price AS estimated_restock_cost
       FROM products
       WHERE is_active = TRUE
       AND branch_id = ?
       AND quantity <= low_stock_threshold
       ORDER BY quantity ASC, name ASC`,
      [branchId]
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
      branch_id: branchId,
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

// GET /api/products/stock-adjustments/recent
// IMPORTANT: This route must stay before /:id routes.
router.get(
  "/stock-adjustments/recent",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = requireSelectedBranch(req, res);

      if (!branchId) {
        return;
      }

      const limit = toSafeLimit(req.query.limit, 50);

      const [adjustments] = await pool.query(
        `SELECT
          sa.id,
          sa.branch_id,
          sa.product_id,
          sa.adjustment_type,
          sa.movement_type,
          sa.quantity,
          sa.old_quantity,
          sa.new_quantity,
          sa.reason,
          sa.source_name,
          sa.reference_number,
          sa.unit_cost,
          sa.cost_price_before,
          sa.cost_price_after,
          sa.movement_date,
          sa.notes,
          sa.adjusted_at,

          b.branch_code,
          b.name AS branch_name,

          p.name AS product_name,
          p.barcode,
          p.category,
          p.size,

          u.full_name AS adjusted_by_name

         FROM stock_adjustments sa
         LEFT JOIN branches b ON b.id = sa.branch_id
         LEFT JOIN products p ON p.id = sa.product_id
         LEFT JOIN users u ON sa.adjusted_by = u.id
         WHERE sa.branch_id = ?
         ORDER BY sa.adjusted_at DESC, sa.id DESC
         LIMIT ?`,
        [branchId, limit]
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        count: adjustments.length,
        adjustments,
      });
    } catch (error) {
      console.error("Get recent stock adjustments error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while fetching recent stock adjustment records.",
      });
    }
  }
);


// GET /api/products/:id/stock-ledger
router.get(
  "/:id/stock-ledger",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = requireSelectedBranch(req, res);

      if (!branchId) {
        return;
      }

      const { id } = req.params;

      const [productRows] = await pool.query(
        `SELECT
          id,
          branch_id,
          name,
          size,
          category,
          barcode,
          quantity,
          created_at
         FROM products
         WHERE id = ?
         AND branch_id = ?
         LIMIT 1`,
        [id, branchId]
      );

      if (productRows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Product not found in this store.",
        });
      }

      const product = productRows[0];
      const warnings = [];
      const ledger = [];

      function addWarning(warning) {
        if (warning) {
          warnings.push(warning);
        }
      }

      function addLedgerEntry(entry) {
        ledger.push({
          date: entry.date || null,
          movement_type: entry.movement_type || "Movement",
          reference: entry.reference || "",
          details: entry.details || "",
          change_quantity: toLedgerNumber(entry.change_quantity),
          quantity_before:
            entry.quantity_before === undefined ? null : entry.quantity_before,
          quantity_after:
            entry.quantity_after === undefined ? null : entry.quantity_after,
          recorded_by: entry.recorded_by || "",
          source: entry.source || "",
          sort_id: Number(entry.sort_id || 0),
        });
      }

      const adjustmentResult = await safeStockLedgerQuery(
        "stock adjustments",
        `SELECT
          sa.id,
          sa.adjustment_type,
          sa.movement_type,
          sa.quantity,
          sa.old_quantity,
          sa.new_quantity,
          sa.reason,
          sa.source_name,
          sa.reference_number,
          sa.unit_cost,
          sa.movement_date,
          sa.notes,
          sa.adjusted_at,
          u.full_name AS adjusted_by_name
         FROM stock_adjustments sa
         LEFT JOIN users u ON sa.adjusted_by = u.id
         WHERE sa.product_id = ?
         AND sa.branch_id = ?
         ORDER BY sa.adjusted_at ASC, sa.id ASC`,
        [id, branchId]
      );

      addWarning(adjustmentResult.warning);

      adjustmentResult.rows.forEach((adjustment) => {
        const oldQuantity = toLedgerNumber(adjustment.old_quantity);
        const newQuantity = toLedgerNumber(adjustment.new_quantity);
        const changeQuantity = newQuantity - oldQuantity;

        const movementType = normalizeMovementType(
          adjustment.movement_type,
          adjustment.adjustment_type === "increase"
            ? MOVEMENT_TYPES.CORRECTION_INCREASE
            : adjustment.adjustment_type === "decrease"
              ? MOVEMENT_TYPES.CORRECTION_DECREASE
              : MOVEMENT_TYPES.PHYSICAL_COUNT
        );
        const detailParts = [adjustment.reason, adjustment.notes]
          .map((value) => String(value || "").trim())
          .filter(Boolean);

        if (adjustment.source_name) {
          detailParts.push(`Source: ${adjustment.source_name}`);
        }

        if (adjustment.unit_cost !== null && adjustment.unit_cost !== undefined) {
          detailParts.push(`Unit cost: GHS ${Number(adjustment.unit_cost).toFixed(2)}`);
        }

        addLedgerEntry({
          date: adjustment.movement_date || adjustment.adjusted_at,
          movement_type: movementLabel(movementType),
          reference: adjustment.reference_number || `ADJ-${adjustment.id}`,
          details: detailParts.join(" • "),
          change_quantity: changeQuantity,
          quantity_before: oldQuantity,
          quantity_after: newQuantity,
          recorded_by: adjustment.adjusted_by_name || "",
          source: "stock_adjustments",
          sort_id: adjustment.id,
        });
      });

      const salesByProductIdResult = await safeStockLedgerQuery(
        "sales by product ID",
        `SELECT
          si.id,
          si.sale_id,
          si.quantity,
          si.product_name,
          s.receipt_number,
          s.customer_name,
          s.customer_phone,
          s.created_at,
          u.full_name AS staff_name
         FROM sale_items si
         INNER JOIN sales s ON si.sale_id = s.id
         LEFT JOIN users u ON s.staff_id = u.id
         WHERE s.branch_id = ?
         AND si.product_id = ?
         AND COALESCE(s.is_voided, 0) = 0
         AND COALESCE(s.sale_status, 'completed') != 'cancelled'
         ORDER BY s.created_at ASC, si.id ASC`,
        [branchId, id]
      );

      addWarning(salesByProductIdResult.warning);

      let salesRows = salesByProductIdResult.rows;

      if (salesRows.length === 0) {
        const salesByNameResult = await safeStockLedgerQuery(
          "sales by product name",
          `SELECT
            si.id,
            si.sale_id,
            si.quantity,
            si.product_name,
            s.receipt_number,
            s.customer_name,
            s.customer_phone,
            s.created_at,
            u.full_name AS staff_name
           FROM sale_items si
           INNER JOIN sales s ON si.sale_id = s.id
           LEFT JOIN users u ON s.staff_id = u.id
           WHERE s.branch_id = ?
           AND si.product_name = ?
           AND COALESCE(s.is_voided, 0) = 0
           AND COALESCE(s.sale_status, 'completed') != 'cancelled'
           ORDER BY s.created_at ASC, si.id ASC`,
          [branchId, product.name]
        );

        addWarning(salesByNameResult.warning);
        salesRows = salesByNameResult.rows;
      }

      salesRows.forEach((saleItem) => {
        const quantity = toLedgerNumber(saleItem.quantity);

        addLedgerEntry({
          date: saleItem.created_at,
          movement_type: "Sale",
          reference: saleItem.receipt_number || `SALE-${saleItem.sale_id}`,
          details: `Sold to ${
            saleItem.customer_name || saleItem.customer_phone || "Walk-in Customer"
          }`,
          change_quantity: -quantity,
          recorded_by: saleItem.staff_name || "",
          source: "sale_items",
          sort_id: saleItem.id,
        });
      });

      const purchaseByProductIdResult = await safeStockLedgerQuery(
        "purchases by product ID",
        `SELECT
          pi.id,
          pi.purchase_id,
          pi.quantity,
          pi.product_name,
          p.invoice_number,
          p.purchase_date,
          p.created_at,
          s.name AS supplier_name,
          u.full_name AS created_by_name
         FROM purchase_items pi
         INNER JOIN purchases p ON pi.purchase_id = p.id
         LEFT JOIN suppliers s
          ON p.supplier_id = s.id
          AND s.branch_id = p.branch_id
         LEFT JOIN users u ON p.created_by = u.id
         WHERE p.branch_id = ?
         AND pi.product_id = ?
         ORDER BY p.purchase_date ASC, pi.id ASC`,
        [branchId, id]
      );

      addWarning(purchaseByProductIdResult.warning);

      let purchaseRows = purchaseByProductIdResult.rows;

      if (purchaseRows.length === 0) {
        const purchaseByNameResult = await safeStockLedgerQuery(
          "purchases by product name",
          `SELECT
            pi.id,
            pi.purchase_id,
            pi.quantity,
            pi.product_name,
            p.invoice_number,
            p.purchase_date,
            p.created_at,
            s.name AS supplier_name,
            u.full_name AS created_by_name
           FROM purchase_items pi
           INNER JOIN purchases p ON pi.purchase_id = p.id
           LEFT JOIN suppliers s
            ON p.supplier_id = s.id
            AND s.branch_id = p.branch_id
           LEFT JOIN users u ON p.created_by = u.id
           WHERE p.branch_id = ?
           AND pi.product_name = ?
           ORDER BY p.purchase_date ASC, pi.id ASC`,
          [branchId, product.name]
        );

        addWarning(purchaseByNameResult.warning);
        purchaseRows = purchaseByNameResult.rows;
      }

      purchaseRows.forEach((purchaseItem) => {
        const quantity = toLedgerNumber(purchaseItem.quantity);

        addLedgerEntry({
          date: purchaseItem.purchase_date || purchaseItem.created_at,
          movement_type: "Purchase",
          reference:
            purchaseItem.invoice_number || `PUR-${purchaseItem.purchase_id}`,
          details: `Purchased from ${purchaseItem.supplier_name || "Supplier"}`,
          change_quantity: quantity,
          recorded_by: purchaseItem.created_by_name || "",
          source: "purchase_items",
          sort_id: purchaseItem.id,
        });
      });

      const returnsResult = await safeStockLedgerQuery(
        "returns",
        `SELECT
          r.id,
          r.quantity,
          r.reason,
          r.returned_at,
          s.receipt_number,
          s.customer_name,
          s.customer_phone
         FROM returns r
         LEFT JOIN sales s
          ON r.sale_id = s.id
          AND s.branch_id = r.branch_id
         WHERE r.branch_id = ?
         AND r.product_id = ?
         ORDER BY r.returned_at ASC, r.id ASC`,
        [branchId, id]
      );

      addWarning(returnsResult.warning);

      returnsResult.rows.forEach((returnItem) => {
        const quantity = toLedgerNumber(returnItem.quantity);

        addLedgerEntry({
          date: returnItem.returned_at,
          movement_type: "Return",
          reference: returnItem.receipt_number || `RET-${returnItem.id}`,
          details:
            returnItem.reason ||
            `Returned by ${
              returnItem.customer_name || returnItem.customer_phone || "Customer"
            }`,
          change_quantity: quantity,
          recorded_by: "",
          source: "returns",
          sort_id: returnItem.id,
        });
      });

      const transferOutResult = await safeStockLedgerQuery(
        "stock transfer out",
        `SELECT
          sti.id,
          sti.transfer_id,
          sti.dispatched_quantity,
          sti.received_quantity,
          st.transfer_number,
          st.status,
          st.dispatched_at,
          st.received_at,
          st.created_at,
          tb.branch_code AS to_branch_code,
          tb.name AS to_branch_name,
          u.full_name AS dispatched_by_name
         FROM stock_transfer_items sti
         INNER JOIN stock_transfers st ON sti.transfer_id = st.id
         LEFT JOIN branches tb ON tb.id = st.to_branch_id
         LEFT JOIN users u ON st.dispatched_by = u.id
         WHERE st.from_branch_id = ?
         AND sti.source_product_id = ?
         AND st.status IN ('dispatched', 'received')
         ORDER BY COALESCE(st.dispatched_at, st.created_at) ASC, sti.id ASC`,
        [branchId, id]
      );

      addWarning(transferOutResult.warning);

      transferOutResult.rows.forEach((transferItem) => {
        const quantity =
          toLedgerNumber(transferItem.dispatched_quantity) ||
          toLedgerNumber(transferItem.received_quantity);

        addLedgerEntry({
          date: transferItem.dispatched_at || transferItem.created_at,
          movement_type: "Transfer Out",
          reference:
            transferItem.transfer_number || `TRF-${transferItem.transfer_id}`,
          details: `Transferred to ${
            transferItem.to_branch_code ||
            transferItem.to_branch_name ||
            "another store"
          }`,
          change_quantity: -quantity,
          recorded_by: transferItem.dispatched_by_name || "",
          source: "stock_transfer_items",
          sort_id: transferItem.id,
        });
      });

      const transferInResult = await safeStockLedgerQuery(
        "stock transfer in",
        `SELECT
          sti.id,
          sti.transfer_id,
          sti.dispatched_quantity,
          sti.received_quantity,
          st.transfer_number,
          st.status,
          st.dispatched_at,
          st.received_at,
          st.created_at,
          fb.branch_code AS from_branch_code,
          fb.name AS from_branch_name,
          u.full_name AS received_by_name
         FROM stock_transfer_items sti
         INNER JOIN stock_transfers st ON sti.transfer_id = st.id
         LEFT JOIN branches fb ON fb.id = st.from_branch_id
         LEFT JOIN users u ON st.received_by = u.id
         WHERE st.to_branch_id = ?
         AND sti.destination_product_id = ?
         AND st.status = 'received'
         ORDER BY COALESCE(st.received_at, st.created_at) ASC, sti.id ASC`,
        [branchId, id]
      );

      addWarning(transferInResult.warning);

      transferInResult.rows.forEach((transferItem) => {
        const quantity =
          toLedgerNumber(transferItem.received_quantity) ||
          toLedgerNumber(transferItem.dispatched_quantity);

        addLedgerEntry({
          date: transferItem.received_at || transferItem.created_at,
          movement_type: "Transfer In",
          reference:
            transferItem.transfer_number || `TRF-${transferItem.transfer_id}`,
          details: `Received from ${
            transferItem.from_branch_code ||
            transferItem.from_branch_name ||
            "another store"
          }`,
          change_quantity: quantity,
          recorded_by: transferItem.received_by_name || "",
          source: "stock_transfer_items",
          sort_id: transferItem.id,
        });
      });

      ledger.sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;

        if (dateA !== dateB) {
          return dateA - dateB;
        }

        return a.sort_id - b.sort_id;
      });

      const currentQuantity = toLedgerNumber(product.quantity);
      const totalChange = ledger.reduce(
        (sum, entry) => sum + toLedgerNumber(entry.change_quantity),
        0
      );

      const openingQuantity = currentQuantity - totalChange;
      let runningQuantity = openingQuantity;

      const ledgerWithRunningStock = ledger.map((entry) => {
        const quantityBefore =
          entry.quantity_before === null
            ? runningQuantity
            : toLedgerNumber(entry.quantity_before);

        const quantityAfter =
          entry.quantity_after === null
            ? quantityBefore + toLedgerNumber(entry.change_quantity)
            : toLedgerNumber(entry.quantity_after);

        runningQuantity = quantityAfter;

        return {
          ...entry,
          quantity_before: quantityBefore,
          quantity_after: quantityAfter,
        };
      });

      const summary = {
        opening_quantity: openingQuantity,
        current_quantity: currentQuantity,
        total_purchase_quantity: purchaseRows.reduce(
          (sum, item) => sum + toLedgerNumber(item.quantity),
          0
        ),
        total_sales_quantity: salesRows.reduce(
          (sum, item) => sum + toLedgerNumber(item.quantity),
          0
        ),
        total_returns_quantity: returnsResult.rows.reduce(
          (sum, item) => sum + toLedgerNumber(item.quantity),
          0
        ),
        total_transfer_out_quantity: transferOutResult.rows.reduce(
          (sum, item) =>
            sum +
            (toLedgerNumber(item.dispatched_quantity) ||
              toLedgerNumber(item.received_quantity)),
          0
        ),
        total_transfer_in_quantity: transferInResult.rows.reduce(
          (sum, item) =>
            sum +
            (toLedgerNumber(item.received_quantity) ||
              toLedgerNumber(item.dispatched_quantity)),
          0
        ),
        total_adjustment_increase_quantity: adjustmentResult.rows
          .filter(
            (item) =>
              toLedgerNumber(item.new_quantity) -
                toLedgerNumber(item.old_quantity) >
              0
          )
          .reduce(
            (sum, item) =>
              sum +
              (toLedgerNumber(item.new_quantity) -
                toLedgerNumber(item.old_quantity)),
            0
          ),
        total_adjustment_decrease_quantity: Math.abs(
          adjustmentResult.rows
            .filter(
              (item) =>
                toLedgerNumber(item.new_quantity) -
                  toLedgerNumber(item.old_quantity) <
                0
            )
            .reduce(
              (sum, item) =>
                sum +
                (toLedgerNumber(item.new_quantity) -
                  toLedgerNumber(item.old_quantity)),
              0
            )
        ),
        total_movement_records: ledgerWithRunningStock.length,
      };

      return res.json({
        status: "success",
        branch_id: branchId,
        product,
        summary,
        count: ledgerWithRunningStock.length,
        warnings,
        ledger: ledgerWithRunningStock.reverse(),
      });
    } catch (error) {
      console.error("Get stock ledger error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while fetching the stock movement ledger.",
      });
    }
  }
);

// GET /api/products/:id/stock-adjustments
router.get(
  "/:id/stock-adjustments",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = requireSelectedBranch(req, res);

      if (!branchId) {
        return;
      }

      const { id } = req.params;

      const [productRows] = await pool.query(
        `SELECT id, branch_id, name, quantity
         FROM products
         WHERE id = ?
         AND branch_id = ?
         LIMIT 1`,
        [id, branchId]
      );

      if (productRows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Product not found in this store.",
        });
      }

      const [adjustments] = await pool.query(
        `SELECT
          sa.id,
          sa.branch_id,
          sa.product_id,
          sa.adjustment_type,
          sa.movement_type,
          sa.quantity,
          sa.old_quantity,
          sa.new_quantity,
          sa.reason,
          sa.source_name,
          sa.reference_number,
          sa.unit_cost,
          sa.cost_price_before,
          sa.cost_price_after,
          sa.movement_date,
          sa.notes,
          sa.adjusted_at,
          u.full_name AS adjusted_by_name
         FROM stock_adjustments sa
         LEFT JOIN users u ON sa.adjusted_by = u.id
         WHERE sa.product_id = ?
         AND sa.branch_id = ?
         ORDER BY sa.adjusted_at DESC, sa.id DESC`,
        [id, branchId]
      );

      return res.json({
        status: "success",
        branch_id: branchId,
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
    const branchId = requireSelectedBranch(req, res);

    if (!branchId) {
      return;
    }

    const { id } = req.params;

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
        created_at,
        updated_at
       FROM products
       WHERE id = ?
       AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    if (products.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Product not found in this store.",
      });
    }

    return res.json({
      status: "success",
      branch_id: branchId,
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
    const connection = await pool.getConnection();

    try {
      const branchId = requireSelectedBranch(req, res);

      if (!branchId) {
        return;
      }

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
          message: "Opening quantity must be a whole number and cannot be negative.",
        });
      }

      if (lowStockThreshold === null) {
        return res.status(400).json({
          status: "error",
          message:
            "Low-stock threshold must be a whole number and cannot be negative.",
        });
      }

      await connection.beginTransaction();

      const [result] = await connection.query(
        `INSERT INTO products (
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
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
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

      if (productQuantity > 0) {
        await connection.query(
          `INSERT INTO stock_adjustments (
            branch_id,
            product_id,
            adjustment_type,
            movement_type,
            quantity,
            old_quantity,
            new_quantity,
            reason,
            unit_cost,
            cost_price_before,
            cost_price_after,
            movement_date,
            notes,
            adjusted_by
          )
          VALUES (?, ?, 'set', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            branchId,
            result.insertId,
            MOVEMENT_TYPES.OPENING_BALANCE,
            productQuantity,
            productQuantity,
            "Opening quantity recorded when product was created",
            costPrice,
            costPrice,
            costPrice,
            new Date().toISOString().slice(0, 10),
            "System-created opening balance record",
            req.user.id,
          ]
        );
      }

      await writeAuditEvent({
        connection,
        branchId,
        userId: req.user.id,
        action: "CREATE_PRODUCT",
        details: `Created product "${cleanName}" with opening quantity ${productQuantity}`,
        workspaceCode: "spare_parts",
        entityType: "product",
        entityId: String(result.insertId),
        actionType: "CREATE_PRODUCT",
        outcome: "success",
        severity: "notice",
      });

      await connection.commit();

      const [products] = await pool.query(
        `SELECT * FROM products WHERE id = ? AND branch_id = ? LIMIT 1`,
        [result.insertId, branchId]
      );

      return res.status(201).json({
        status: "success",
        message:
          productQuantity > 0
            ? "Product created successfully with an opening stock record."
            : "Product created successfully.",
        branch_id: branchId,
        product: products[0],
      });
    } catch (error) {
      await connection.rollback();
      console.error("Create product error:", error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message: "A product with this barcode already exists in this store.",
        });
      }

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while creating the product.",
      });
    } finally {
      connection.release();
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
      const branchId = requireSelectedBranch(req, res);

      if (!branchId) {
        return;
      }

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
        `SELECT * FROM products WHERE id = ? AND branch_id = ? LIMIT 1`,
        [id, branchId]
      );

      if (existingProducts.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Product not found in this store.",
        });
      }

      const existingProduct = existingProducts[0];

      if (!name || !name.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Product name is required.",
        });
      }

      const cleanName = name.trim();
      const costPrice = toMoney(cost_price);
      const sellingPrice = toMoney(selling_price);
      const lowStockThreshold = toNonNegativeInt(Number(low_stock_threshold));

      if (
        costPrice === null ||
        sellingPrice === null ||
        lowStockThreshold === null
      ) {
        return res.status(400).json({
          status: "error",
          message: "Please check price and low-stock threshold values.",
        });
      }

      if (quantity !== undefined && quantity !== null && quantity !== "") {
        const submittedQuantity = toNonNegativeInt(Number(quantity));

        if (
          submittedQuantity === null ||
          submittedQuantity !== Number(existingProduct.quantity || 0)
        ) {
          return res.status(409).json({
            status: "error",
            code: "STOCK_CHANGE_REQUIRES_MOVEMENT",
            message:
              "Product details cannot directly change stock. Use Receive / Restock for new stock or Adjust Stock for a correction.",
            current_quantity: Number(existingProduct.quantity || 0),
          });
        }
      }

      await pool.query(
        `UPDATE products
         SET
          name = ?,
          size = ?,
          category = ?,
          cost_price = ?,
          selling_price = ?,
          low_stock_threshold = ?,
          barcode = ?,
          image_url = ?,
          is_active = ?
         WHERE id = ?
         AND branch_id = ?`,
        [
          cleanName,
          nullIfEmpty(size),
          nullIfEmpty(category),
          costPrice,
          sellingPrice,
          lowStockThreshold,
          nullIfEmpty(barcode),
          nullIfEmpty(image_url),
          is_active === false ? false : true,
          id,
          branchId,
        ]
      );

      await logActivity(
        branchId,
        req.user.id,
        "UPDATE_PRODUCT_DETAILS",
        `Updated details for product "${cleanName}" with ID ${id}; stock remained ${Number(
          existingProduct.quantity || 0
        )}`
      );

      const [products] = await pool.query(
        `SELECT * FROM products WHERE id = ? AND branch_id = ? LIMIT 1`,
        [id, branchId]
      );

      return res.json({
        status: "success",
        message: "Product details updated successfully. Stock was not changed.",
        branch_id: branchId,
        product: products[0],
      });
    } catch (error) {
      console.error("Update product error:", error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message: "A product with this barcode already exists in this store.",
        });
      }

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while updating the product.",
      });
    }
  }
);

// POST /api/products/:id/restock
router.post(
  "/:id/restock",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const branchId = requireSelectedBranch(req, res);

      if (!branchId) {
        return;
      }

      const { id } = req.params;
      const {
        quantity,
        source_name,
        reference_number,
        unit_cost,
        movement_date,
        notes,
        update_cost_price,
      } = req.body;

      const receivedQuantity = toNonNegativeInt(Number(quantity));
      const receivedUnitCost = toOptionalMoney(unit_cost);
      const receivedDate = toMovementDate(movement_date);
      const cleanSource = String(source_name || "").trim();
      const cleanReference = String(reference_number || "").trim();
      const cleanNotes = String(notes || "").trim();

      if (!receivedQuantity || receivedQuantity <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Restock quantity must be a whole number greater than zero.",
        });
      }

      if (!cleanSource) {
        return res.status(400).json({
          status: "error",
          message: "Supplier or stock source is required for a restock.",
        });
      }

      if (unit_cost !== undefined && unit_cost !== null && unit_cost !== "" && receivedUnitCost === null) {
        return res.status(400).json({
          status: "error",
          message: "Unit cost must be a valid number and cannot be negative.",
        });
      }

      if (!receivedDate) {
        return res.status(400).json({
          status: "error",
          message: "Movement date must use YYYY-MM-DD format.",
        });
      }

      await connection.beginTransaction();

      const [products] = await connection.query(
        `SELECT id, branch_id, name, quantity, cost_price
         FROM products
         WHERE id = ?
         AND branch_id = ?
         AND is_active = TRUE
         LIMIT 1
         FOR UPDATE`,
        [id, branchId]
      );

      if (products.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "Product not found in this store.",
        });
      }

      const product = products[0];
      const oldQuantity = Number(product.quantity || 0);
      const newQuantity = oldQuantity + receivedQuantity;
      const oldCostPrice = Number(product.cost_price || 0);
      const shouldUpdateCost = update_cost_price === true || update_cost_price === "true";
      const newCostPrice =
        shouldUpdateCost && receivedUnitCost !== null
          ? Number(receivedUnitCost)
          : oldCostPrice;

      await connection.query(
        `UPDATE products
         SET quantity = ?, cost_price = ?
         WHERE id = ? AND branch_id = ?`,
        [newQuantity, newCostPrice.toFixed(2), id, branchId]
      );

      const [movementResult] = await connection.query(
        `INSERT INTO stock_adjustments (
          branch_id,
          product_id,
          adjustment_type,
          movement_type,
          quantity,
          old_quantity,
          new_quantity,
          reason,
          source_name,
          reference_number,
          unit_cost,
          cost_price_before,
          cost_price_after,
          movement_date,
          notes,
          adjusted_by
        )
        VALUES (?, ?, 'increase', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          id,
          MOVEMENT_TYPES.QUICK_RESTOCK,
          receivedQuantity,
          oldQuantity,
          newQuantity,
          `Received ${receivedQuantity} unit(s) from ${cleanSource}`,
          cleanSource,
          cleanReference || null,
          receivedUnitCost,
          oldCostPrice,
          newCostPrice,
          receivedDate,
          cleanNotes || null,
          req.user.id,
        ]
      );

      await writeAuditEvent({
        connection,
        branchId,
        userId: req.user.id,
        action: "RESTOCK_PRODUCT",
        details: `Received ${receivedQuantity} unit(s) of "${product.name}" from ${cleanSource}. Stock ${oldQuantity} to ${newQuantity}. Reference: ${cleanReference || "-"}`,
        workspaceCode: "spare_parts",
        entityType: "product",
        entityId: String(id),
        actionType: "RESTOCK_PRODUCT",
        outcome: "success",
        severity: "notice",
        metadata: {
          movement_id: movementResult.insertId,
          source_name: cleanSource,
          reference_number: cleanReference || null,
          unit_cost: receivedUnitCost,
          movement_date: receivedDate,
          old_quantity: oldQuantity,
          new_quantity: newQuantity,
        },
      });

      await connection.commit();

      const [updatedProducts] = await pool.query(
        `SELECT * FROM products WHERE id = ? AND branch_id = ? LIMIT 1`,
        [id, branchId]
      );

      return res.status(201).json({
        status: "success",
        message: `${receivedQuantity} unit(s) received and recorded successfully.`,
        branch_id: branchId,
        movement: {
          id: movementResult.insertId,
          movement_type: MOVEMENT_TYPES.QUICK_RESTOCK,
          movement_label: movementLabel(MOVEMENT_TYPES.QUICK_RESTOCK),
          source_name: cleanSource,
          reference_number: cleanReference || null,
          unit_cost: receivedUnitCost,
          movement_date: receivedDate,
          old_quantity: oldQuantity,
          new_quantity: newQuantity,
        },
        product: updatedProducts[0],
      });
    } catch (error) {
      await connection.rollback();
      console.error("Restock product error:", error);

      return res.status(500).json({
        status: "error",
        message: error.message || "Something went wrong while receiving stock.",
      });
    } finally {
      connection.release();
    }
  }
);

// PATCH /api/products/:id/stock-adjustment
router.patch(
  "/:id/stock-adjustment",
  requireAuth,
  requireRole("admin", "manager"),
  validateRequest(validateStockAdjustmentRequest),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const branchId = requireSelectedBranch(req, res);

      if (!branchId) {
        return;
      }

      const { id } = req.validated.params;
      const {
        adjustment_type,
        movement_type,
        quantity,
        reason,
        reference_number,
        movement_date,
        notes,
      } = req.validated.body;

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

      let cleanMovementType;

      try {
        cleanMovementType = validateMovementCompatibility(
          adjustment_type,
          movement_type ||
            (adjustment_type === "increase"
              ? MOVEMENT_TYPES.CORRECTION_INCREASE
              : adjustment_type === "decrease"
                ? MOVEMENT_TYPES.CORRECTION_DECREASE
                : MOVEMENT_TYPES.PHYSICAL_COUNT)
        );
      } catch (validationError) {
        return res.status(400).json({
          status: "error",
          message: validationError.message,
        });
      }

      const cleanReason = reason.trim();
      const cleanReference = String(reference_number || "").trim();
      const cleanNotes = String(notes || "").trim();
      const cleanMovementDate = toMovementDate(movement_date);

      if (!cleanMovementDate) {
        return res.status(400).json({
          status: "error",
          message: "Movement date must use YYYY-MM-DD format.",
        });
      }

      await connection.beginTransaction();

      const [products] = await connection.query(
        `SELECT id, branch_id, name, quantity, cost_price
         FROM products
         WHERE id = ?
         AND branch_id = ?
         AND is_active = TRUE
         LIMIT 1
         FOR UPDATE`,
        [id, branchId]
      );

      if (products.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Product not found in this store.",
        });
      }

      const product = products[0];
      const oldQuantity = Number(product.quantity || 0);
      let newQuantity;

      try {
        newQuantity = calculateStockAfter({
          currentQuantity: oldQuantity,
          adjustmentType: adjustment_type,
          quantity: adjustmentQuantity,
        });
      } catch (calculationError) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message: calculationError.message,
        });
      }

      await connection.query(
        `UPDATE products
         SET quantity = ?
         WHERE id = ?
         AND branch_id = ?`,
        [newQuantity, id, branchId]
      );

      const [adjustmentResult] = await connection.query(
        `INSERT INTO stock_adjustments (
          branch_id,
          product_id,
          adjustment_type,
          movement_type,
          quantity,
          old_quantity,
          new_quantity,
          reason,
          reference_number,
          cost_price_before,
          cost_price_after,
          movement_date,
          notes,
          adjusted_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          id,
          adjustment_type,
          cleanMovementType,
          adjustmentQuantity,
          oldQuantity,
          newQuantity,
          cleanReason,
          cleanReference || null,
          Number(product.cost_price || 0),
          Number(product.cost_price || 0),
          cleanMovementDate,
          cleanNotes || null,
          req.user.id,
        ]
      );

      await writeAuditEvent({
        connection,
        branchId,
        userId: req.user.id,
        action: "STOCK_ADJUSTMENT",
        details: `${movementLabel(cleanMovementType)} for "${product.name}": ${oldQuantity} to ${newQuantity}. Reason: ${cleanReason}`,
        workspaceCode: "spare_parts",
        entityType: "product",
        entityId: String(id),
        actionType: "STOCK_ADJUSTMENT",
        outcome: "success",
        severity: "notice",
        metadata: {
          movement_id: adjustmentResult.insertId,
          movement_type: cleanMovementType,
          adjustment_type,
          old_quantity: oldQuantity,
          new_quantity: newQuantity,
          reference_number: cleanReference || null,
        },
      });

      await connection.commit();

      const [updatedProducts] = await pool.query(
        `SELECT * FROM products WHERE id = ? AND branch_id = ? LIMIT 1`,
        [id, branchId]
      );

      return res.json({
        status: "success",
        message: `${movementLabel(cleanMovementType)} recorded successfully.`,
        branch_id: branchId,
        old_quantity: oldQuantity,
        new_quantity: newQuantity,
        adjustment: {
          id: adjustmentResult.insertId,
          branch_id: branchId,
          product_id: Number(id),
          adjustment_type,
          movement_type: cleanMovementType,
          movement_label: movementLabel(cleanMovementType),
          quantity: adjustmentQuantity,
          old_quantity: oldQuantity,
          new_quantity: newQuantity,
          reason: cleanReason,
          reference_number: cleanReference || null,
          movement_date: cleanMovementDate,
          notes: cleanNotes || null,
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
          "Something went wrong while adjusting stock. Make sure the stock movement migration has been applied.",
      });
    } finally {
      connection.release();
    }
  }
);

// DELETE /api/products/:id
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const branchId = requireSelectedBranch(req, res);

    if (!branchId) {
      return;
    }

    const { id } = req.params;

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
        is_active
       FROM products
       WHERE id = ?
       AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    if (products.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Product not found in this store.",
      });
    }

    const productToDelete = products[0];

    await pool.query(
      `UPDATE products
       SET is_active = FALSE
       WHERE id = ?
       AND branch_id = ?`,
      [id, branchId]
    );

    await logActivity(
      branchId,
      req.user.id,
      "DELETE_PRODUCT",
      `Soft-deleted product "${productToDelete.name}" with ID ${id}`
    );

    await sendProductDeletedSecuritySmsAlert({
      product: productToDelete,
      deletedByUser: req.user,
      branchId,
    });

    return res.json({
      status: "success",
      message: "Product deleted successfully.",
      branch_id: branchId,
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
