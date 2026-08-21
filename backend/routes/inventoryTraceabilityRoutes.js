const express = require("express");

const inventoryTraceabilityCoreRoutes = require("./inventoryTraceabilityCoreRoutes");
const inventoryTraceabilityReceivingRoutes = require("./inventoryTraceabilityReceivingRoutes");
const inventoryLossDetectionRoutes = require("./inventoryLossDetectionRoutes");
const inventorySaleScanRoutes = require("./inventorySaleScanRoutes");
const inventorySaleCatalogueRoutes = require("./inventorySaleCatalogueRoutes");
const inventoryReturnScanRoutes = require("./inventoryReturnScanRoutes");
const inventoryReturnQuarantineRoutes = require("./inventoryReturnQuarantineRoutes");
const inventoryTransferTraceabilityRoutes = require("./inventoryTransferTraceabilityRoutes");

const router = express.Router();

const RESERVED_LABEL_SOURCE_TYPES = new Set([
  "purchase",
  "supplier_delivery",
  "restock",
  "transfer",
  "transfer_receipt",
  "transfer_received",
]);

// The generic Setup & Labels endpoint is only for reconciling stock that
// already exists in the selected store. Purchase provenance is created by the
// purchase-linked Serialized Receiving workflow, while transferred units keep
// their existing physical identity. Do not allow a free-text source label to
// impersonate those authoritative workflows.
router.post("/products/:productId/label-batches", (req, res, next) => {
  const sourceType = String(req.body?.source_type || "opening_reconciliation")
    .trim()
    .toLowerCase();

  if (RESERVED_LABEL_SOURCE_TYPES.has(sourceType)) {
    return res.status(409).json({
      status: "error",
      code: "TRACEABILITY_CONTROLLED_SOURCE_WORKFLOW_REQUIRED",
      message:
        sourceType === "purchase" || sourceType === "supplier_delivery"
          ? "Purchase-linked labels must be prepared from Serialized Receiving so the exact recorded purchase line is preserved as provenance."
          : sourceType.startsWith("transfer")
            ? "Transferred serialized stock keeps its existing physical IDs and must be received through Serialized Stock Transfer controls."
            : "Enforced serialized stock cannot be added through a generic restock label source. Record the supplier purchase and use Serialized Receiving.",
    });
  }

  if (sourceType !== "opening_reconciliation") {
    return res.status(400).json({
      status: "error",
      code: "TRACEABILITY_LABEL_SOURCE_INVALID",
      message:
        "Generic label generation is only for existing-stock reconciliation. Use the dedicated receiving or transfer workflow for new stock.",
    });
  }

  req.body.source_type = "opening_reconciliation";
  req.body.source_id = null;
  req.body.source_item_id = null;
  return next();
});

router.use("/receiving", inventoryTraceabilityReceivingRoutes);
router.use("/loss-control", inventoryLossDetectionRoutes);
router.use("/sale-products", inventorySaleCatalogueRoutes);
router.use("/sale-scan", inventorySaleScanRoutes);
router.use("/return-scan", inventoryReturnScanRoutes);
router.use("/return-quarantine", inventoryReturnQuarantineRoutes);
router.use("/transfer-control", inventoryTransferTraceabilityRoutes);
router.use(inventoryTraceabilityCoreRoutes);

module.exports = router;
