const express = require("express");

const { pool } = require("../config/db");
const legacySaleRoutes = require("./saleRoutes");

const router = express.Router();

function branchId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function positiveProductIds(items) {
  return [
    ...new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => Number(item?.product_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];
}

async function serializedMutationConflict({ saleId, storeId, requestedItems = [] }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [linkedUnits] = await connection.query(
      `SELECT u.id, u.unit_code, u.product_id, p.name AS product_name
       FROM inventory_units u
       LEFT JOIN products p ON p.id = u.product_id
       WHERE u.sale_id = ?
       ORDER BY u.id ASC
       LIMIT 1
       FOR UPDATE`,
      [saleId]
    );
    if (linkedUnits[0]) {
      await connection.rollback();
      return {
        reason: "linked_identity",
        product_id: Number(linkedUnits[0].product_id || 0) || null,
        product_name: linkedUnits[0].product_name || null,
        unit_code: linkedUnits[0].unit_code || null,
      };
    }

    const [existingSerialized] = await connection.query(
      `SELECT p.id, p.name, p.inventory_tracking_mode, p.inventory_traceability_state
       FROM sale_items si
       INNER JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ?
         AND p.branch_id = ?
         AND p.inventory_tracking_mode = 'serialized'
       ORDER BY p.id ASC
       LIMIT 1
       FOR UPDATE`,
      [saleId, storeId]
    );
    if (existingSerialized[0]) {
      await connection.rollback();
      return {
        reason: "existing_serialized_product",
        product_id: Number(existingSerialized[0].id),
        product_name: existingSerialized[0].name,
      };
    }

    const requestedProductIds = positiveProductIds(requestedItems);
    if (requestedProductIds.length > 0) {
      const placeholders = requestedProductIds.map(() => "?").join(", ");
      const [requestedSerialized] = await connection.query(
        `SELECT id, name, inventory_tracking_mode, inventory_traceability_state
         FROM products
         WHERE branch_id = ?
           AND id IN (${placeholders})
           AND inventory_tracking_mode = 'serialized'
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE`,
        [storeId, ...requestedProductIds]
      );
      if (requestedSerialized[0]) {
        await connection.rollback();
        return {
          reason: "requested_serialized_product",
          product_id: Number(requestedSerialized[0].id),
          product_name: requestedSerialized[0].name,
        };
      }
    }

    await connection.rollback();
    return null;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

function mutationBlockedResponse(res, conflict, action) {
  const editing = action === "edit";
  const productText = conflict?.product_name
    ? ` ${conflict.product_name}`
    : " This sale";
  return res.status(409).json({
    status: "error",
    code: editing
      ? "SERIALIZED_SALE_EDIT_REQUIRES_EXACT_RETURN"
      : "SERIALIZED_SALE_VOID_REQUIRES_EXACT_RETURN",
    message: editing
      ? `${productText} is protected by serialized physical-ID history. The legacy sale editor cannot change its quantities or line items. Record any physical reversal through Returns so the exact sold IDs move to quarantine, then make any separate accounting correction through the controlled workflow.`
      : `${productText} is protected by serialized physical-ID history. A quantity-only sale void would restore stock on paper while leaving the exact units sold. Use Returns to verify the exact physical IDs and move them to quarantine instead.`,
    serialized_identity_preserved: true,
    stock_mutated: false,
    product_id: conflict?.product_id || null,
    unit_code: conflict?.unit_code || null,
  });
}

router.put("/:id", async (req, res, next) => {
  try {
    const storeId = branchId(req);
    const saleId = Number(req.params.id);
    if (!storeId || !Number.isInteger(saleId) || saleId <= 0) return next();

    const conflict = await serializedMutationConflict({
      saleId,
      storeId,
      requestedItems: req.body?.items,
    });
    if (conflict) return mutationBlockedResponse(res, conflict, "edit");
    return next();
  } catch (error) {
    console.error("Serialized sale edit guard failed:", error);
    return res.status(500).json({
      status: "error",
      code: "SERIALIZED_SALE_EDIT_GUARD_FAILED",
      message:
        "The sale could not be checked safely for serialized physical identities. No edit was allowed.",
    });
  }
});

router.patch("/:id/void", async (req, res, next) => {
  try {
    const storeId = branchId(req);
    const saleId = Number(req.params.id);
    if (!storeId || !Number.isInteger(saleId) || saleId <= 0) return next();

    const conflict = await serializedMutationConflict({ saleId, storeId });
    if (conflict) return mutationBlockedResponse(res, conflict, "void");
    return next();
  } catch (error) {
    console.error("Serialized sale void guard failed:", error);
    return res.status(500).json({
      status: "error",
      code: "SERIALIZED_SALE_VOID_GUARD_FAILED",
      message:
        "The sale could not be checked safely for serialized physical identities. No void was allowed.",
    });
  }
});

// New sales and all read-only/ordinary sale routes continue through the
// established implementation. Only mutation paths that could detach aggregate
// quantity from physical serialized identity are intercepted above.
router.use(legacySaleRoutes);

module.exports = router;
