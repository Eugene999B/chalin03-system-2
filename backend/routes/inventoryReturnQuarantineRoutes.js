const express = require("express");

const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  inspectReturnQuarantine,
  listReturnQuarantine,
} = require("../services/inventoryReturnQuarantineService");

const router = express.Router();

function branchId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error("Select a store before inspecting returned serialized inventory.");
    error.statusCode = 400;
    error.code = "RETURN_QUARANTINE_BRANCH_REQUIRED";
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
    code: error.code || "RETURN_QUARANTINE_ERROR",
    message: statusCode >= 500 ? fallback : error.message,
  });
}

router.get("/", requireRole("admin", "manager"), async (req, res) => {
  try {
    const units = await listReturnQuarantine({
      branchId: branchId(req),
      limit: req.query.limit,
    });
    return res.json({
      status: "success",
      count: units.length,
      policy: {
        quarantine_is_not_sellable: true,
        restock_requires_inspection: true,
        written_off_reduces_system_quantity: true,
        written_off_requires_admin: true,
      },
      units,
    });
  } catch (error) {
    return sendError(res, error, "Unable to load returned inventory quarantine.");
  }
});

router.post("/:unitCode/inspect", requireRole("admin", "manager"), async (req, res) => {
  try {
    const outcome = String(req.body?.outcome || "").trim().toLowerCase();
    if (outcome === "written_off" && roleOf(req) !== "admin") {
      return res.status(403).json({
        status: "error",
        code: "RETURN_QUARANTINE_WRITEOFF_ADMIN_REQUIRED",
        message: "Only an administrator can write off a returned physical inventory unit.",
      });
    }

    const storeId = branchId(req);
    const result = await inspectReturnQuarantine({
      branchId: storeId,
      unitCode: req.params.unitCode,
      outcome,
      inspectedBy: req.user.id,
      notes: req.body?.notes,
      requestId: req.requestId || req.id || null,
    });

    await writeAuditEvent({
      req,
      branchId: storeId,
      userId: req.user.id,
      action: "INSPECT_RETURNED_SERIALIZED_UNIT",
      details: `Inspected returned unit ${result.unit_code}; outcome ${result.outcome}, status ${result.status}.`,
      workspaceCode: "spare_parts",
      entityType: "inventory_unit",
      entityId: result.unit_code,
      actionType: "returned_inventory_inspected",
      outcome: "success",
      severity: result.outcome === "written_off" ? "high" : "notice",
      metadata: {
        product_id: result.product_id,
        previous_status: result.previous_status,
        next_status: result.status,
        inspection_outcome: result.outcome,
        sellable: result.sellable,
        aggregate_quantity_changed: result.aggregate_quantity_changed,
      },
    });

    const messages = {
      restock: "Inspection complete. This exact returned unit is active and sellable again.",
      damaged: "Inspection complete. This exact unit remains inventory but is marked damaged and not sellable.",
      written_off: "Inspection complete. This exact unit is written off and physical inventory quantity was reduced by one.",
    };
    return res.json({
      status: "success",
      message: messages[result.outcome] || "Return quarantine inspection completed.",
      result,
    });
  } catch (error) {
    return sendError(res, error, "Unable to inspect returned serialized inventory.");
  }
});

module.exports = router;
