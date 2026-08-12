const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  listSerializedPurchaseReceivingQueue,
  preparePurchaseItemLabelBatch,
} = require("../services/inventoryReceivingTraceabilityService");

const router = express.Router();

function branchId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error("Select a store before using serialized receiving.");
    error.statusCode = 400;
    error.code = "TRACEABILITY_BRANCH_REQUIRED";
    throw error;
  }
  return id;
}

function sendError(res, error, fallback) {
  const statusCode = Number(error.statusCode || 500);
  if (statusCode >= 500) console.error(fallback, error);
  return res.status(statusCode).json({
    status: "error",
    code: error.code || "INVENTORY_RECEIVING_TRACEABILITY_ERROR",
    message: statusCode >= 500 ? fallback : error.message,
    existing_batch: error.existingBatch || undefined,
  });
}

router.use(requireAuth, requireRole("admin", "manager"));

// GET /api/inventory-traceability/receiving/purchase-items
router.get("/purchase-items", async (req, res) => {
  try {
    const items = await listSerializedPurchaseReceivingQueue(undefined, {
      branchId: branchId(req),
      limit: req.query.limit,
    });
    return res.json({
      status: "success",
      count: items.length,
      items,
    });
  } catch (error) {
    return sendError(res, error, "Unable to load serialized receiving queue.");
  }
});

// POST /api/inventory-traceability/receiving/purchase-items/:purchaseItemId/label-batch
router.post("/purchase-items/:purchaseItemId/label-batch", async (req, res) => {
  try {
    const result = await preparePurchaseItemLabelBatch({
      req,
      branchId: branchId(req),
      purchaseItemId: req.params.purchaseItemId,
      createdBy: req.user.id,
      notes: req.body.notes,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Purchase identities generated from the exact supplier purchase quantity. Print, attach and verify the labels before treating the new units as identity-covered stock.",
      ...result,
    });
  } catch (error) {
    return sendError(res, error, "Unable to prepare serialized purchase labels.");
  }
});

module.exports = router;
