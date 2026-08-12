const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  dispatchTransferWithIdentities,
  getTransferIdentityPlan,
  receiveTransferWithIdentities,
  verifyTransferUnitScan,
} = require("../services/inventoryTransferTraceabilityService");

const router = express.Router();

function roleOf(req) {
  return String(req.user?.role || "").trim().toLowerCase();
}

function selectedBranchId(req) {
  const value = Number(
    req.user?.branch_id ||
      req.user?.default_branch_id ||
      req.user?.selected_branch_id ||
      req.headers["x-branch-id"] ||
      0
  );
  return Number.isInteger(value) && value > 0 ? value : null;
}

function canAccessAllBranches(req) {
  if (roleOf(req) === "admin") return true;
  return (
    req.user?.can_access_all_branches === true ||
    req.user?.canAccessAllBranches === true ||
    Number(req.user?.can_access_all_branches || 0) === 1 ||
    Number(req.user?.canAccessAllBranches || 0) === 1
  );
}

function assertTransferAccess(req, plan, phase = "view") {
  const branchId = selectedBranchId(req);
  if (!branchId) {
    const error = new Error("Select a store before managing serialized stock transfers.");
    error.statusCode = 400;
    error.code = "TRANSFER_TRACEABILITY_BRANCH_REQUIRED";
    throw error;
  }

  const fromBranchId = Number(plan.transfer.from_branch_id);
  const toBranchId = Number(plan.transfer.to_branch_id);

  if (phase === "dispatch") {
    if (branchId !== fromBranchId) {
      const error = new Error(
        "Dispatch must be performed while signed into the transfer source store. Select the source store before scanning or dispatching these physical units."
      );
      error.statusCode = 403;
      error.code = "TRANSFER_DISPATCH_SOURCE_STORE_REQUIRED";
      throw error;
    }
    return;
  }

  if (phase === "receive") {
    if (branchId !== toBranchId) {
      const error = new Error(
        "Receiving must be performed while signed into the transfer destination store. Select the destination store before scanning or receiving these physical units."
      );
      error.statusCode = 403;
      error.code = "TRANSFER_RECEIVE_DESTINATION_STORE_REQUIRED";
      throw error;
    }
    return;
  }

  if (canAccessAllBranches(req)) return;

  if (![fromBranchId, toBranchId].includes(branchId)) {
    const error = new Error(
      "You can only view serialized transfers connected to your selected store."
    );
    error.statusCode = 403;
    error.code = "TRANSFER_TRACEABILITY_BRANCH_FORBIDDEN";
    throw error;
  }
}

function sendError(res, error, fallback) {
  const statusCode = Number(error.statusCode || 500);
  if (statusCode >= 500) console.error(fallback, error);
  return res.status(statusCode).json({
    status: "error",
    code: error.code || "INVENTORY_TRANSFER_TRACEABILITY_ERROR",
    message: statusCode >= 500 ? fallback : error.message,
  });
}

async function writeSecondaryAudit(event) {
  try {
    await writeAuditEvent(event);
    return true;
  } catch (error) {
    console.error(
      "Serialized transfer secondary audit write failed after the authoritative inventory transaction committed:",
      error
    );
    return false;
  }
}

async function bindTransferShortagesToDestinationProducts({ transferId, destinationBranchId }) {
  const cleanTransferId = Number(transferId);
  const cleanDestinationBranchId = Number(destinationBranchId);
  if (
    !Number.isInteger(cleanTransferId) ||
    cleanTransferId <= 0 ||
    !Number.isInteger(cleanDestinationBranchId) ||
    cleanDestinationBranchId <= 0
  ) {
    throw new Error("Invalid transfer identity while binding shortage investigation products.");
  }

  await pool.query(
    `UPDATE inventory_loss_investigations i
     INNER JOIN inventory_transfer_units itu
       ON itu.unit_id = i.unit_id
      AND itu.transfer_id = ?
     INNER JOIN stock_transfer_items sti
       ON sti.id = itu.transfer_item_id
      AND sti.transfer_id = itu.transfer_id
     SET i.product_id = sti.destination_product_id
     WHERE i.branch_id = ?
       AND i.investigation_type = 'transfer_shortage'
       AND sti.destination_product_id IS NOT NULL
       AND i.product_id <> sti.destination_product_id`,
    [cleanTransferId, cleanDestinationBranchId]
  );
}

router.use(requireAuth);
router.use(requireRole("admin", "manager"));

router.get("/:transferId/plan", async (req, res) => {
  try {
    const plan = await getTransferIdentityPlan({ transferId: req.params.transferId });
    assertTransferAccess(req, plan, "view");
    return res.json({ status: "success", ...plan });
  } catch (error) {
    return sendError(res, error, "Unable to load serialized transfer identity controls.");
  }
});

router.post("/:transferId/items/:transferItemId/scan", async (req, res) => {
  try {
    const phase = String(req.body?.phase || "").trim().toLowerCase();
    if (!["dispatch", "receive"].includes(phase)) {
      return res.status(400).json({
        status: "error",
        code: "TRANSFER_SCAN_PHASE_REQUIRED",
        message: "Transfer scan phase must be dispatch or receive.",
      });
    }
    const plan = await getTransferIdentityPlan({ transferId: req.params.transferId });
    assertTransferAccess(req, plan, phase);
    const result = await verifyTransferUnitScan({
      transferId: req.params.transferId,
      transferItemId: req.params.transferItemId,
      phase,
      value: req.body?.value,
    });
    return res.json({
      status: "success",
      message:
        result.phase === "dispatch"
          ? "Physical ID verified for dispatch."
          : "Physical ID verified against this dispatched transfer.",
      result,
    });
  } catch (error) {
    return sendError(res, error, "Unable to verify the transfer physical ID.");
  }
});

router.post("/:transferId/dispatch", async (req, res) => {
  try {
    const plan = await getTransferIdentityPlan({ transferId: req.params.transferId });
    assertTransferAccess(req, plan, "dispatch");
    const result = await dispatchTransferWithIdentities({
      transferId: req.params.transferId,
      actorUserId: req.user.id,
      items: req.body?.items,
      dispatchNote: req.body?.dispatch_note,
      requestId: req.requestId || req.id || null,
    });

    const secondaryAuditRecorded = await writeSecondaryAudit({
      req,
      branchId: plan.transfer.from_branch_id,
      userId: req.user.id,
      action: "DISPATCH_SERIALIZED_STOCK_TRANSFER",
      details: `Dispatched transfer ${plan.transfer.transfer_number} with ${result.exact_identity_count} exact physical ID(s).`,
      workspaceCode: "spare_parts",
      entityType: "stock_transfer",
      entityId: result.transfer_id,
      actionType: "serialized_transfer_dispatched",
      outcome: "success",
      severity: "notice",
      metadata: {
        transfer_number: result.transfer_number,
        exact_identity_count: result.exact_identity_count,
        source_stock_reduced: true,
      },
    });

    const updated = await getTransferIdentityPlan({ transferId: req.params.transferId });
    return res.json({
      status: "success",
      message:
        "Transfer dispatched. Source quantity was reduced and every enforced serialized unit is now recorded in transit.",
      result,
      secondary_audit_recorded: secondaryAuditRecorded,
      ...updated,
    });
  } catch (error) {
    return sendError(res, error, "Unable to dispatch the serialized stock transfer.");
  }
});

router.post("/:transferId/receive", async (req, res) => {
  try {
    const plan = await getTransferIdentityPlan({ transferId: req.params.transferId });
    assertTransferAccess(req, plan, "receive");
    const result = await receiveTransferWithIdentities({
      transferId: req.params.transferId,
      actorUserId: req.user.id,
      items: req.body?.items,
      receiveNote: req.body?.receive_note,
      requestId: req.requestId || req.id || null,
    });

    // The transfer service resolves the destination product before opening any
    // shortage evidence. Bind every shortage case to that destination product
    // immediately after the authoritative transaction so destination-store
    // investigations never point at a source-store product row.
    await bindTransferShortagesToDestinationProducts({
      transferId: result.transfer_id,
      destinationBranchId: plan.transfer.to_branch_id,
    });

    const secondaryAuditRecorded = await writeSecondaryAudit({
      req,
      branchId: plan.transfer.to_branch_id,
      userId: req.user.id,
      action: "RECEIVE_SERIALIZED_STOCK_TRANSFER",
      details: result.transfer_complete
        ? `Received transfer ${plan.transfer.transfer_number}; exact serialized receipt is complete.`
        : `Recorded a partial physical receipt for transfer ${plan.transfer.transfer_number}; shortages remain under investigation.`,
      workspaceCode: "spare_parts",
      entityType: "stock_transfer",
      entityId: result.transfer_id,
      actionType: result.transfer_complete
        ? "serialized_transfer_received"
        : "serialized_transfer_receipt_variance",
      outcome: "success",
      severity: result.newly_missing_identity_count > 0 ? "high" : "notice",
      metadata: {
        transfer_number: result.transfer_number,
        transfer_complete: result.transfer_complete,
        newly_received_identity_count: result.newly_received_identity_count,
        newly_missing_identity_count: result.newly_missing_identity_count,
        destination_stock_increased_only_for_observed_units: true,
        shortage_product_scope: "destination_product",
      },
    });

    const updated = await getTransferIdentityPlan({ transferId: req.params.transferId });
    return res.json({
      status: "success",
      message: result.transfer_complete
        ? "Transfer received. Destination stock increased only for the physical IDs actually verified."
        : "Partial receipt recorded. Missing dispatched IDs remain in transit and have investigation evidence; destination stock increased only for verified arrivals.",
      result,
      secondary_audit_recorded: secondaryAuditRecorded,
      ...updated,
    });
  } catch (error) {
    return sendError(res, error, "Unable to receive the serialized stock transfer.");
  }
});

module.exports = router;
