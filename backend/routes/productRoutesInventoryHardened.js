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

function isEnforcedSerialized(product) {
  return (
    String(product?.inventory_tracking_mode || "").toLowerCase() === "serialized" &&
    String(product?.inventory_traceability_state || "").toLowerCase() === "enforced"
  );
}

function sendSerializedMutationBlocked(res, product, action) {
  const restock = action === "restock";
  return res.status(409).json({
    status: "error",
    code: restock
      ? "SERIALIZED_RESTOCK_REQUIRES_CONTROLLED_RECEIVING"
      : "SERIALIZED_STOCK_ADJUSTMENT_REQUIRES_EXACT_IDS",
    message: restock
      ? `${product.name} uses enforced physical-ID tracking. Record the supplier purchase and prepare its exact identities in Serialized Receiving instead of changing quantity through Quick Restock.`
      : `${product.name} uses enforced physical-ID tracking. Quantity-only stock adjustment is blocked because it would separate system stock from the exact physical-unit ledger. Use the traceability investigation / exact-ID workflow for the correction.`,
    product_id: Number(product.id),
    inventory_tracking_mode: product.inventory_tracking_mode,
    inventory_traceability_state: product.inventory_traceability_state,
  });
}

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
      if (isEnforcedSerialized(product)) {
        await connection.rollback();
        transactionStarted = false;
        return sendSerializedMutationBlocked(res, product, "restock");
      }

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

      await writeAuditEvent({
        connection,
        branchId: storeId,
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
      transactionStarted = false;
      const [updatedProducts] = await pool.query(`SELECT * FROM products WHERE id = ? AND branch_id = ? LIMIT 1`, [id, storeId]);
      return res.status(201).json({
        status: "success",
        message: `${receivedQuantity} unit(s) received and recorded successfully.`,
        branch_id: storeId,
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
      console.error("Hardened restock product error:", error);
      return res.status(500).json({ status: "error", message: error.message || "Something went wrong while receiving stock." });
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
      if (isEnforcedSerialized(product)) {
        await connection.rollback();
        transactionStarted = false;
        return sendSerializedMutationBlocked(res, product, "adjustment");
      }

      const oldQuantity = Number(product.quantity || 0);
      let newQuantity;
      try {
        newQuantity = calculateStockAfter({ currentQuantity: oldQuantity, adjustmentType: adjustment_type, quantity: adjustmentQuantity });
      } catch (calculationError) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(400).json({ status: "error", message: calculationError.message });
      }

      await connection.query(`UPDATE products SET quantity = ? WHERE id = ? AND branch_id = ?`, [newQuantity, id, storeId]);
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
        },
      });

      await connection.commit();
      transactionStarted = false;
      const [updatedProducts] = await pool.query(`SELECT * FROM products WHERE id = ? AND branch_id = ? LIMIT 1`, [id, storeId]);
      return res.json({
        status: "success",
        message: `${movementLabel(cleanMovementType)} recorded successfully.`,
        branch_id: storeId,
        old_quantity: oldQuantity,
        new_quantity: newQuantity,
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
      return res.status(500).json({
        status: "error",
        message: error.message || "Something went wrong while adjusting stock. Make sure the stock movement migration has been applied.",
      });
    } finally {
      connection.release();
    }
  }
);

router.use(legacyProductRoutes);

module.exports = router;
