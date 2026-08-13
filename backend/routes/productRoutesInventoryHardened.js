const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const { validateStockAdjustmentRequest } = require("../validation/operationsRequestValidators");
const {
  MOVEMENT_TYPES,
  calculateStockAfter,
  movementLabel,
  validateMovementCompatibility,
} = require("../services/stockMovementService");
const {
  createAutomaticIdentityBatches,
  reconcileAutomaticIdentityCoverage,
} = require("../services/inventoryIdentityStudioConstants");

const legacyProductRoutes = require("./productRoutes");

const router = express.Router();

function branchId(req) {
  const id = Number(req.user?.branch_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function requireSelectedBranch(req, res) {
  const id = branchId(req);
  if (!id) {
    res.status(400).json({
      status: "error",
      message: "No store was selected. Please logout and login again through a store.",
    });
    return null;
  }
  return id;
}

function toMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number.toFixed(2);
}

function toOptionalMoney(value) {
  if (value === undefined || value === null || value === "") return null;
  return toMoney(value);
}

function toNonNegativeInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function toMovementDate(value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) return null;
  const parsed = new Date(`${cleanValue}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === cleanValue ? cleanValue : null;
}

function nullIfEmpty(value) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function isSerializedProduct(product) {
  return String(product?.inventory_tracking_mode || "").toLowerCase() === "serialized";
}

function sendSerializedDecreaseBlocked(res, product) {
  return res.status(409).json({
    status: "error",
    code: "SERIALIZED_STOCK_ADJUSTMENT_REQUIRES_EXACT_IDS",
    message: `${product.name} has automatic physical-unit identities. A quantity decrease must identify which exact unit left, was damaged, is missing or was written off. Use the traceability investigation / exact-ID workflow for the correction.`,
    product_id: Number(product.id),
    inventory_tracking_mode: product.inventory_tracking_mode,
    inventory_traceability_state: product.inventory_traceability_state,
  });
}

// Chalin One automatic identity policy: every newly created product is immediately
// given a serialized identity profile and one internal ID for every opening-stock unit.
router.post(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      const storeId = requireSelectedBranch(req, res);
      if (!storeId) return;

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

      if (!name || !String(name).trim()) {
        return res.status(400).json({ status: "error", message: "Product name is required." });
      }

      const cleanName = String(name).trim();
      const costPrice = toMoney(cost_price);
      const sellingPrice = toMoney(selling_price);
      const productQuantity = toNonNegativeInt(Number(quantity ?? 0));
      const lowStockThreshold = toNonNegativeInt(Number(low_stock_threshold ?? 5));

      if (costPrice === null) {
        return res.status(400).json({ status: "error", message: "Cost price must be a valid number and cannot be negative." });
      }
      if (sellingPrice === null) {
        return res.status(400).json({ status: "error", message: "Selling price must be a valid number and cannot be negative." });
      }
      if (productQuantity === null) {
        return res.status(400).json({ status: "error", message: "Opening quantity must be a whole number and cannot be negative." });
      }
      if (lowStockThreshold === null) {
        return res.status(400).json({ status: "error", message: "Low-stock threshold must be a whole number and cannot be negative." });
      }

      await connection.beginTransaction();
      transactionStarted = true;

      const [result] = await connection.query(
        `INSERT INTO products (
          branch_id, name, size, category, cost_price, selling_price, quantity,
          low_stock_threshold, barcode, image_url, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          storeId,
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
            branch_id, product_id, adjustment_type, movement_type, quantity,
            old_quantity, new_quantity, reason, unit_cost, cost_price_before,
            cost_price_after, movement_date, notes, adjusted_by
          ) VALUES (?, ?, 'set', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            storeId,
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

      const identityResult = await reconcileAutomaticIdentityCoverage(connection, {
        branchId: storeId,
        productId: result.insertId,
        actorUserId: req.user.id,
        notes: "Automatic IDs created with product opening stock.",
      });

      await writeAuditEvent({
        connection,
        branchId: storeId,
        userId: req.user.id,
        action: "CREATE_PRODUCT",
        details: `Created product "${cleanName}" with opening quantity ${productQuantity} and ${identityResult.generated_quantity} automatic stock ID(s).`,
        workspaceCode: "spare_parts",
        entityType: "product",
        entityId: String(result.insertId),
        actionType: "CREATE_PRODUCT",
        outcome: "success",
        severity: "notice",
        metadata: {
          automatic_identity_tracking: true,
          automatic_ids_created: identityResult.generated_quantity,
        },
      });

      await connection.commit();
      transactionStarted = false;

      const [products] = await pool.query(
        `SELECT * FROM products WHERE id = ? AND branch_id = ? LIMIT 1`,
        [result.insertId, storeId]
      );

      return res.status(201).json({
        status: "success",
        message: productQuantity > 0
          ? `Product created successfully. ${identityResult.generated_quantity} stock ID(s) were created automatically.`
          : "Product created successfully. Automatic identity tracking is ready for its first stock.",
        branch_id: storeId,
        automatic_ids_created: identityResult.generated_quantity,
        product: products[0],
      });
    } catch (error) {
      if (transactionStarted) {
        try { await connection.rollback(); } catch { /* preserve original */ }
      }
      console.error("Automatic-ID create product error:", error);
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ status: "error", message: "A product with this barcode already exists in this store." });
      }
      return res.status(Number(error.statusCode || 500)).json({
        status: "error",
        code: error.code || "AUTOMATIC_PRODUCT_IDENTITY_CREATE_ERROR",
        message: Number(error.statusCode || 500) >= 500
          ? "Something went wrong while creating the product and its automatic stock IDs."
          : error.message,
      });
    } finally {
      connection.release();
    }
  }
);

// Restocking is one atomic operation: first reconcile any legacy opening-stock gap,
// then add quantity and create brand-new IDs for exactly the newly received units.
router.post(
  "/:id/restock",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      const storeId = requireSelectedBranch(req, res);
      if (!storeId) return;

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
        return res.status(400).json({ status: "error", message: "Restock quantity must be a whole number greater than zero." });
      }
      if (!cleanSource) {
        return res.status(400).json({ status: "error", message: "Supplier or stock source is required for a restock." });
      }
      if (unit_cost !== undefined && unit_cost !== null && unit_cost !== "" && receivedUnitCost === null) {
        return res.status(400).json({ status: "error", message: "Unit cost must be a valid number and cannot be negative." });
      }
      if (!receivedDate) {
        return res.status(400).json({ status: "error", message: "Movement date must use YYYY-MM-DD format." });
      }

      await connection.beginTransaction();
      transactionStarted = true;

      const [products] = await connection.query(
        `SELECT id, branch_id, name, size, quantity, cost_price,
                inventory_tracking_mode, inventory_traceability_state
         FROM products
         WHERE id = ? AND branch_id = ? AND is_active = TRUE
         LIMIT 1 FOR UPDATE`,
        [id, storeId]
      );
      if (products.length === 0) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({ status: "error", message: "Product not found in this store." });
      }

      const product = products[0];
      const priorIdentityResult = await reconcileAutomaticIdentityCoverage(connection, {
        branchId: storeId,
        productId: Number(id),
        actorUserId: req.user.id,
        notes: "Automatic reconciliation before restock.",
      });

      const oldQuantity = Number(product.quantity || 0);
      const newQuantity = oldQuantity + receivedQuantity;
      const oldCostPrice = Number(product.cost_price || 0);
      const shouldUpdateCost = update_cost_price === true || update_cost_price === "true";
      const newCostPrice = shouldUpdateCost && receivedUnitCost !== null ? Number(receivedUnitCost) : oldCostPrice;

      await connection.query(
        `UPDATE products SET quantity = ?, cost_price = ? WHERE id = ? AND branch_id = ?`,
        [newQuantity, newCostPrice.toFixed(2), id, storeId]
      );

      const [movementResult] = await connection.query(
        `INSERT INTO stock_adjustments (
           branch_id, product_id, adjustment_type, movement_type,
           quantity, old_quantity, new_quantity, reason, source_name,
           reference_number, unit_cost, cost_price_before, cost_price_after,
           movement_date, notes, adjusted_by
         ) VALUES (?, ?, 'increase', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          storeId, id, MOVEMENT_TYPES.QUICK_RESTOCK, receivedQuantity, oldQuantity,
          newQuantity, `Received ${receivedQuantity} unit(s) from ${cleanSource}`,
          cleanSource, cleanReference || null, receivedUnitCost, oldCostPrice,
          newCostPrice, receivedDate, cleanNotes || null, req.user.id,
        ]
      );

      const identityBatches = await createAutomaticIdentityBatches(connection, {
        branchId: storeId,
        productId: Number(id),
        actorUserId: req.user.id,
        quantity: receivedQuantity,
        sourceType: "restock",
        sourceId: movementResult.insertId,
        notes: `Automatic IDs for restock from ${cleanSource}${cleanReference ? ` (${cleanReference})` : ""}.`,
      });
      const newIdsCreated = identityBatches.reduce(
        (sum, batch) => sum + Number(batch.generated_quantity || 0),
        0
      );

      await writeAuditEvent({
        connection,
        branchId: storeId,
        userId: req.user.id,
        action: "RESTOCK_PRODUCT",
        details: `Received ${receivedQuantity} unit(s) of "${product.name}" from ${cleanSource}. Stock ${oldQuantity} to ${newQuantity}. ${newIdsCreated} new stock ID(s) created automatically.`,
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
          legacy_ids_reconciled: priorIdentityResult.generated_quantity,
          new_automatic_ids_created: newIdsCreated,
        },
      });

      await connection.commit();
      transactionStarted = false;
      const [updatedProducts] = await pool.query(
        `SELECT * FROM products WHERE id = ? AND branch_id = ? LIMIT 1`,
        [id, storeId]
      );
      return res.status(201).json({
        status: "success",
        message: `${receivedQuantity} unit(s) received. ${newIdsCreated} new stock ID(s) were created automatically and are ready for one-click label printing.`,
        branch_id: storeId,
        automatic_ids_created: newIdsCreated,
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
      if (transactionStarted) {
        try { await connection.rollback(); } catch { /* preserve original */ }
      }
      console.error("Automatic-ID restock product error:", error);
      return res.status(Number(error.statusCode || 500)).json({
        status: "error",
        code: error.code || "AUTOMATIC_RESTOCK_IDENTITY_ERROR",
        message: Number(error.statusCode || 500) >= 500
          ? "Something went wrong while receiving stock and creating its automatic IDs."
          : error.message,
      });
    } finally {
      connection.release();
    }
  }
);

router.patch(
  "/:id/stock-adjustment",
  requireAuth,
  requireRole("admin", "manager"),
  validateRequest(validateStockAdjustmentRequest),
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      const storeId = requireSelectedBranch(req, res);
      if (!storeId) return;

      const { id } = req.validated.params;
      const { adjustment_type, movement_type, quantity, reason, reference_number, movement_date, notes } = req.validated.body;
      if (!["increase", "decrease", "set"].includes(adjustment_type)) {
        return res.status(400).json({ status: "error", message: "Adjustment type must be increase, decrease, or set." });
      }
      const adjustmentQuantity = toNonNegativeInt(Number(quantity));
      if (adjustmentQuantity === null) {
        return res.status(400).json({ status: "error", message: "Quantity must be a whole number and cannot be negative." });
      }
      if (adjustment_type !== "set" && adjustmentQuantity <= 0) {
        return res.status(400).json({ status: "error", message: "Increase or decrease quantity must be greater than zero." });
      }
      if (!reason || !reason.trim()) {
        return res.status(400).json({ status: "error", message: "Reason is required for stock adjustment." });
      }

      let cleanMovementType;
      try {
        cleanMovementType = validateMovementCompatibility(
          adjustment_type,
          movement_type || (adjustment_type === "increase" ? MOVEMENT_TYPES.CORRECTION_INCREASE : adjustment_type === "decrease" ? MOVEMENT_TYPES.CORRECTION_DECREASE : MOVEMENT_TYPES.PHYSICAL_COUNT)
        );
      } catch (validationError) {
        return res.status(400).json({ status: "error", message: validationError.message });
      }

      const cleanReason = reason.trim();
      const cleanReference = String(reference_number || "").trim();
      const cleanNotes = String(notes || "").trim();
      const cleanMovementDate = toMovementDate(movement_date);
      if (!cleanMovementDate) {
        return res.status(400).json({ status: "error", message: "Movement date must use YYYY-MM-DD format." });
      }

      await connection.beginTransaction();
      transactionStarted = true;
      const [products] = await connection.query(
        `SELECT id, branch_id, name, quantity, cost_price,
                inventory_tracking_mode, inventory_traceability_state
         FROM products
         WHERE id = ? AND branch_id = ? AND is_active = TRUE
         LIMIT 1 FOR UPDATE`,
        [id, storeId]
      );
      if (products.length === 0) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({ status: "error", message: "Product not found in this store." });
      }

      const product = products[0];
      const identityCoverage = await reconcileAutomaticIdentityCoverage(connection, {
        branchId: storeId,
        productId: Number(id),
        actorUserId: req.user.id,
        notes: "Automatic reconciliation before stock adjustment.",
      });

      const oldQuantity = Number(product.quantity || 0);
      let newQuantity;
      try {
        newQuantity = calculateStockAfter({ currentQuantity: oldQuantity, adjustmentType: adjustment_type, quantity: adjustmentQuantity });
      } catch (calculationError) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(400).json({ status: "error", message: calculationError.message });
      }

      if (isSerializedProduct(identityCoverage.product) && newQuantity < oldQuantity) {
        await connection.rollback();
        transactionStarted = false;
        return sendSerializedDecreaseBlocked(res, identityCoverage.product);
      }

      await connection.query(
        `UPDATE products SET quantity = ? WHERE id = ? AND branch_id = ?`,
        [newQuantity, id, storeId]
      );
      const [adjustmentResult] = await connection.query(
        `INSERT INTO stock_adjustments (
           branch_id, product_id, adjustment_type, movement_type,
           quantity, old_quantity, new_quantity, reason, reference_number,
           cost_price_before, cost_price_after, movement_date, notes, adjusted_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          storeId, id, adjustment_type, cleanMovementType, adjustmentQuantity,
          oldQuantity, newQuantity, cleanReason, cleanReference || null,
          Number(product.cost_price || 0), Number(product.cost_price || 0),
          cleanMovementDate, cleanNotes || null, req.user.id,
        ]
      );

      const increase = Math.max(0, newQuantity - oldQuantity);
      let automaticIdsCreated = 0;
      if (increase > 0) {
        const batches = await createAutomaticIdentityBatches(connection, {
          branchId: storeId,
          productId: Number(id),
          actorUserId: req.user.id,
          quantity: increase,
          sourceType: "stock_adjustment",
          sourceId: adjustmentResult.insertId,
          notes: `Automatic IDs for stock increase: ${cleanReason}`,
        });
        automaticIdsCreated = batches.reduce(
          (sum, batch) => sum + Number(batch.generated_quantity || 0),
          0
        );
      }

      await writeAuditEvent({
        connection,
        branchId: storeId,
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
          automatic_ids_created: automaticIdsCreated,
        },
      });

      await connection.commit();
      transactionStarted = false;
      const [updatedProducts] = await pool.query(
        `SELECT * FROM products WHERE id = ? AND branch_id = ? LIMIT 1`,
        [id, storeId]
      );
      return res.json({
        status: "success",
        message: automaticIdsCreated
          ? `${movementLabel(cleanMovementType)} recorded. ${automaticIdsCreated} new stock ID(s) were created automatically.`
          : `${movementLabel(cleanMovementType)} recorded successfully.`,
        branch_id: storeId,
        old_quantity: oldQuantity,
        new_quantity: newQuantity,
        automatic_ids_created: automaticIdsCreated,
        adjustment: {
          id: adjustmentResult.insertId,
          branch_id: storeId,
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
      if (transactionStarted) {
        try { await connection.rollback(); } catch { /* preserve original */ }
      }
      console.error("Hardened stock adjustment error:", error);
      return res.status(Number(error.statusCode || 500)).json({
        status: "error",
        code: error.code || "AUTOMATIC_STOCK_IDENTITY_ADJUSTMENT_ERROR",
        message: Number(error.statusCode || 500) >= 500
          ? "Something went wrong while adjusting stock."
          : error.message,
      });
    } finally {
      connection.release();
    }
  }
);

router.use(legacyProductRoutes);

module.exports = router;