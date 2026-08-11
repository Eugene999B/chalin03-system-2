const express = require("express");

const { requireRole } = require("../middleware/roleMiddleware");
const {
  closeCustodyHandover,
  createBlindCountSession,
  createCustodyHandover,
  getCountSession,
  listCountSessions,
  listInvestigations,
  recordQuantityObservation,
  recordSerializedObservation,
  resolveInvestigation,
  submitBlindCountSession,
  verifyCustodyHandoverUnit,
} = require("../services/inventoryLossDetectionService");

const router = express.Router();

function branchId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error("Select a store before using Inventory Loss Control.");
    error.statusCode = 400;
    error.code = "LOSS_CONTROL_BRANCH_REQUIRED";
    throw error;
  }
  return id;
}

function roleOf(req) {
  return String(req.user?.role || "").trim().toLowerCase();
}

function sendError(res, error, fallback) {
  const statusCode = Number(error.statusCode || 500);
  if (statusCode >= 500) console.error(fallback, error);
  return res.status(statusCode).json({
    status: "error",
    code: error.code || "INVENTORY_LOSS_CONTROL_ERROR",
    message: statusCode >= 500 ? fallback : error.message,
  });
}

router.get("/counts", requireRole("admin", "manager"), async (req, res) => {
  try {
    const sessions = await listCountSessions({
      branchId: branchId(req),
      limit: req.query.limit,
    });
    return res.json({ status: "success", sessions });
  } catch (error) {
    return sendError(res, error, "Unable to load inventory count sessions.");
  }
});

router.post("/counts", requireRole("admin", "manager"), async (req, res) => {
  try {
    const session = await createBlindCountSession({
      branchId: branchId(req),
      productIds: req.body.product_ids,
      createdBy: req.user.id,
      countType: req.body.count_type,
      selectionMethod: req.body.selection_method,
      reason: req.body.reason,
      areaLabel: req.body.area_label,
      notes: req.body.notes,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Blind count opened. Expected quantities and exact expected IDs are frozen but hidden until submission.",
      session,
    });
  } catch (error) {
    return sendError(res, error, "Unable to create blind inventory count.");
  }
});

router.get("/counts/:sessionId", requireRole("admin", "manager"), async (req, res) => {
  try {
    const session = await getCountSession({
      branchId: branchId(req),
      sessionId: req.params.sessionId,
    });
    return res.json({ status: "success", session });
  } catch (error) {
    return sendError(res, error, "Unable to load blind inventory count.");
  }
});

router.post("/counts/:sessionId/unit-observations", requireRole("admin", "manager"), async (req, res) => {
  try {
    const observation = await recordSerializedObservation({
      branchId: branchId(req),
      sessionId: req.params.sessionId,
      value: req.body.value,
      observedBy: req.user.id,
      deviceNote: req.body.device_note,
    });
    const messages = {
      accepted: "Physical unit accepted into the blind count.",
      duplicate: "This physical unit was already observed; duplicate evidence was recorded but it will not count twice.",
      unexpected: "The unit exists but was not in the frozen expected set. It has been recorded as an exception for review.",
      wrong_store: "The scanned unit is physically here but the system assigns it to another store. The location discrepancy has been recorded.",
    };
    return res.status(observation.validation_status === "accepted" ? 201 : 200).json({
      status: "success",
      message: messages[observation.validation_status] || "Inventory observation recorded.",
      observation,
    });
  } catch (error) {
    return sendError(res, error, "Unable to record physical unit observation.");
  }
});

router.post("/counts/:sessionId/quantity-observations", requireRole("admin", "manager"), async (req, res) => {
  try {
    const observation = await recordQuantityObservation({
      branchId: branchId(req),
      sessionId: req.params.sessionId,
      productId: req.body.product_id,
      quantity: req.body.quantity,
      observedBy: req.user.id,
      deviceNote: req.body.device_note,
    });
    return res.status(201).json({
      status: "success",
      message: `Physical quantity ${observation.quantity_observed} recorded. A later recount can be entered before submission; the latest accepted quantity is used.`,
      observation,
    });
  } catch (error) {
    return sendError(res, error, "Unable to record physical quantity observation.");
  }
});

router.post("/counts/:sessionId/submit", requireRole("admin", "manager"), async (req, res) => {
  try {
    const result = await submitBlindCountSession({
      branchId: branchId(req),
      sessionId: req.params.sessionId,
      submittedBy: req.user.id,
    });
    return res.json({
      status: "success",
      message:
        "Blind count submitted against its frozen starting snapshot. Missing and unexpected identities are now investigation evidence; stock was not silently adjusted.",
      result,
    });
  } catch (error) {
    return sendError(res, error, "Unable to submit blind inventory count.");
  }
});

router.get("/investigations", requireRole("admin", "manager"), async (req, res) => {
  try {
    const investigations = await listInvestigations({
      branchId: branchId(req),
      status: req.query.status || null,
      limit: req.query.limit,
    });
    return res.json({
      status: "success",
      policy: {
        evidence_not_accusation: true,
        automatic_worker_blame: false,
        automatic_stock_adjustment: false,
      },
      investigations,
    });
  } catch (error) {
    return sendError(res, error, "Unable to load inventory investigations.");
  }
});

router.post("/investigations/:investigationId/resolve", requireRole("admin", "manager"), async (req, res) => {
  try {
    if (String(req.body.resolution_category || "").toLowerCase() === "confirmed_loss" && roleOf(req) !== "admin") {
      return res.status(403).json({
        status: "error",
        code: "CONFIRMED_LOSS_ADMIN_REQUIRED",
        message: "Only an administrator can classify an investigation as confirmed loss.",
      });
    }
    const investigation = await resolveInvestigation({
      branchId: branchId(req),
      investigationId: req.params.investigationId,
      resolvedBy: req.user.id,
      resolutionCategory: req.body.resolution_category,
      resolutionNotes: req.body.resolution_notes,
    });
    return res.json({
      status: "success",
      message:
        "Investigation evidence resolved. This action does not adjust stock or assign disciplinary fault automatically.",
      investigation,
    });
  } catch (error) {
    return sendError(res, error, "Unable to resolve inventory investigation.");
  }
});

router.post("/handovers", requireRole("admin", "manager"), async (req, res) => {
  try {
    const handover = await createCustodyHandover({
      branchId: branchId(req),
      outgoingUserId: req.body.outgoing_user_id,
      incomingUserId: req.body.incoming_user_id,
      unitCodes: req.body.unit_codes,
      createdBy: req.user.id,
      areaLabel: req.body.area_label,
      notes: req.body.notes,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Custody handover opened. Incoming custody will not change until every expected physical unit is independently verified.",
      handover,
    });
  } catch (error) {
    return sendError(res, error, "Unable to create inventory custody handover.");
  }
});

router.post(
  "/handovers/:handoverId/verify-unit",
  requireRole("admin", "manager", "cashier"),
  async (req, res) => {
    try {
      const result = await verifyCustodyHandoverUnit({
        branchId: branchId(req),
        handoverId: req.params.handoverId,
        value: req.body.value,
        verifiedBy: req.user.id,
      });
      return res.json({ status: "success", result });
    } catch (error) {
      return sendError(res, error, "Unable to verify custody handover unit.");
    }
  }
);

router.post("/handovers/:handoverId/close", requireRole("admin", "manager"), async (req, res) => {
  try {
    const result = await closeCustodyHandover({
      branchId: branchId(req),
      handoverId: req.params.handoverId,
      closedBy: req.user.id,
    });
    return res.json({
      status: "success",
      message:
        result.status === "closed"
          ? "Custody handover closed with zero variance; verified units moved to the incoming custodian."
          : "Custody handover closed with a variance. Custody was not transferred; investigate the missing or exceptional units.",
      result,
    });
  } catch (error) {
    return sendError(res, error, "Unable to close inventory custody handover.");
  }
});

module.exports = router;
