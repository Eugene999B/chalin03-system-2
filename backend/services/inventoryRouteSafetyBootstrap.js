/*
  CHALIN ONE inventory route safety and automatic identity bootstrap.

  The shared server keeps importing the established product, purchase and sale routers.
  During Inventory Traceability startup this installer prepends the Chalin One guards
  and automatic identity handlers to those same router objects before I/O begins.
*/

const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const { validatePurchaseCreateRequest } = require("../validation/operationsRequestValidators");
const {
  createAutomaticIdentityBatches,
  reconcileAutomaticIdentityCoverage,
} = require("./inventoryIdentityStudioConstants");

const INSTALL_FLAG = Symbol.for("chalin03.inventoryRouteSafetyInstalled");

function guardLayers(wrapper) {
  // Each hardened wrapper ends with router.use(legacyRouter). We need only the
  // guard layers; the original router already owns its established route stack.
  return wrapper.stack.slice(0, -1);
}

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Number(number.toFixed(2));
}

function getPaymentStatus(totalAmount, amountPaid) {
  if (amountPaid <= 0) return "unpaid";
  if (amountPaid >= totalAmount) return "paid";
  return "partial";
}

function selectedBranchId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function buildAutomaticPurchaseRouter(legacyPurchaseRoutes) {
  const router = express.Router();

  router.post(
    "/",
    requireAuth,
    requireRole("admin", "manager"),
    validateRequest(validatePurchaseCreateRequest),
    async (req, res) => {
      const connection = await pool.getConnection();
      let transactionStarted = false;
      try {
        const branchId = selectedBranchId(req);
        if (!branchId) {
          return res.status(400).json({
            status: "error",
            message: "Select a store before recording a purchase.",
          });
        }

        const {
          supplier_id,
          invoice_number,
          purchase_date,
          amount_paid,
          notes,
          items,
        } = req.validated.body;

        if (!purchase_date) {
          return res.status(400).json({ status: "error", message: "Purchase date is required." });
        }
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ status: "error", message: "At least one purchase item is required." });
        }

        await connection.beginTransaction();
        transactionStarted = true;

        const supplierId = supplier_id ? Number(supplier_id) : null;
        if (supplierId) {
          const [suppliers] = await connection.query(
            `SELECT id FROM suppliers
             WHERE id = ? AND branch_id = ? AND is_active = TRUE
             LIMIT 1`,
            [supplierId, branchId]
          );
          if (suppliers.length === 0) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(404).json({ status: "error", message: "Supplier not found in the selected store." });
          }
        }

        let totalAmount = 0;
        const cleanItems = [];
        for (const item of items) {
          const productId = Number(item.product_id);
          const quantity = Number(item.quantity);
          const costPrice = toNonNegativeNumber(item.cost_price);
          if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(400).json({
              status: "error",
              message: "Each item must have product and quantity greater than zero.",
            });
          }
          if (costPrice === null) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(400).json({ status: "error", message: "Each item must have a valid cost price." });
          }

          const [products] = await connection.query(
            `SELECT id, branch_id, name, size, quantity,
                    inventory_tracking_mode, inventory_traceability_state
             FROM products
             WHERE id = ? AND branch_id = ? AND is_active = TRUE
             LIMIT 1 FOR UPDATE`,
            [productId, branchId]
          );
          if (products.length === 0) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(404).json({
              status: "error",
              message: `Product with ID ${productId} was not found in the selected store.`,
            });
          }

          const lineTotal = Number((quantity * costPrice).toFixed(2));
          totalAmount += lineTotal;
          cleanItems.push({
            product_id: productId,
            product_name: products[0].name,
            quantity,
            cost_price: costPrice,
            line_total: lineTotal,
          });
        }

        totalAmount = Number(totalAmount.toFixed(2));
        const cleanAmountPaid = toNonNegativeNumber(amount_paid || 0);
        if (cleanAmountPaid === null) {
          await connection.rollback();
          transactionStarted = false;
          return res.status(400).json({ status: "error", message: "Amount paid must be a valid number." });
        }
        if (cleanAmountPaid > totalAmount) {
          await connection.rollback();
          transactionStarted = false;
          return res.status(400).json({ status: "error", message: "Amount paid cannot be greater than purchase total." });
        }

        const balance = Number((totalAmount - cleanAmountPaid).toFixed(2));
        const paymentStatus = getPaymentStatus(totalAmount, cleanAmountPaid);
        const [purchaseResult] = await connection.query(
          `INSERT INTO purchases (
            branch_id, supplier_id, invoice_number, purchase_date, total_cost,
            total_amount, amount_paid, balance, payment_status, notes, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            branchId,
            supplierId,
            cleanNullableText(invoice_number),
            purchase_date,
            totalAmount,
            totalAmount,
            cleanAmountPaid,
            balance,
            paymentStatus,
            cleanNullableText(notes),
            req.user.id,
          ]
        );
        const purchaseId = purchaseResult.insertId;

        if (cleanAmountPaid > 0) {
          await connection.query(
            `INSERT INTO purchase_payments (
              branch_id, purchase_id, amount, payment_method, paid_by, notes
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              branchId,
              purchaseId,
              cleanAmountPaid,
              "cash",
              req.user.id,
              "Initial amount paid when purchase was recorded",
            ]
          );
        }

        let automaticIdsCreated = 0;
        for (const item of cleanItems) {
          await reconcileAutomaticIdentityCoverage(connection, {
            branchId,
            productId: item.product_id,
            actorUserId: req.user.id,
            notes: "Automatic reconciliation before supplier purchase receipt.",
          });

          const [itemResult] = await connection.query(
            `INSERT INTO purchase_items (
              purchase_id, product_id, product_name, quantity, cost_price, line_total
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              purchaseId,
              item.product_id,
              item.product_name,
              item.quantity,
              item.cost_price,
              item.line_total,
            ]
          );

          await connection.query(
            `UPDATE products
             SET quantity = quantity + ?, cost_price = ?
             WHERE id = ? AND branch_id = ?`,
            [item.quantity, item.cost_price, item.product_id, branchId]
          );

          const batches = await createAutomaticIdentityBatches(connection, {
            branchId,
            productId: item.product_id,
            actorUserId: req.user.id,
            quantity: item.quantity,
            sourceType: "purchase",
            sourceId: purchaseId,
            sourceItemId: itemResult.insertId,
            notes: `Automatic IDs for purchase ${cleanText(invoice_number) || `#${purchaseId}`}.`,
          });
          automaticIdsCreated += batches.reduce(
            (sum, batch) => sum + Number(batch.generated_quantity || 0),
            0
          );
        }

        await connection.query(
          `INSERT INTO activity_log (branch_id, user_id, action, details)
           VALUES (?, ?, ?, ?)`,
          [
            branchId,
            req.user.id,
            "CREATE_PURCHASE",
            `Recorded purchase worth GHS ${totalAmount.toFixed(2)} with ${automaticIdsCreated} automatic stock ID(s).`,
          ]
        );

        await connection.commit();
        transactionStarted = false;

        return res.status(201).json({
          status: "success",
          message: `Purchase recorded successfully. Stock was updated and ${automaticIdsCreated} new stock ID(s) were created automatically.`,
          automatic_ids_created: automaticIdsCreated,
          purchase: {
            id: purchaseId,
            branch_id: branchId,
            total_cost: totalAmount,
            total_amount: totalAmount,
            amount_paid: cleanAmountPaid,
            balance,
            payment_status: paymentStatus,
          },
        });
      } catch (error) {
        if (transactionStarted) {
          try { await connection.rollback(); } catch { /* preserve original */ }
        }
        console.error("Automatic-ID purchase error:", error);
        return res.status(Number(error.statusCode || 500)).json({
          status: "error",
          code: error.code || "AUTOMATIC_PURCHASE_IDENTITY_ERROR",
          message: Number(error.statusCode || 500) >= 500
            ? "Something went wrong while recording the purchase and creating its stock IDs."
            : error.message,
        });
      } finally {
        connection.release();
      }
    }
  );

  router.use(legacyPurchaseRoutes);
  return router;
}

function installInventoryRouteSafety() {
  if (globalThis[INSTALL_FLAG]) return false;

  const productRoutes = require("../routes/productRoutes");
  const purchaseRoutes = require("../routes/purchaseRoutes");
  const saleRoutes = require("../routes/saleRoutes");
  const originalProductStack = productRoutes.stack.slice();
  const originalPurchaseStack = purchaseRoutes.stack.slice();
  const originalSaleStack = saleRoutes.stack.slice();

  const hardenedProductRoutes = require("../routes/productRoutesInventoryHardened");
  const hardenedSaleRoutes = require("../routes/saleRoutesInventoryHardened");
  const hardenedPurchaseRoutes = buildAutomaticPurchaseRouter(purchaseRoutes);

  productRoutes.stack = [
    ...guardLayers(hardenedProductRoutes),
    ...originalProductStack,
  ];
  purchaseRoutes.stack = [
    ...guardLayers(hardenedPurchaseRoutes),
    ...originalPurchaseStack,
  ];
  saleRoutes.stack = [
    ...guardLayers(hardenedSaleRoutes),
    ...originalSaleStack,
  ];

  Object.defineProperty(globalThis, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return true;
}

module.exports = {
  INSTALL_FLAG,
  installInventoryRouteSafety,
};
