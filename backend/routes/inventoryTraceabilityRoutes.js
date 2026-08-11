const express = require("express");

const inventoryTraceabilityCoreRoutes = require("./inventoryTraceabilityCoreRoutes");
const inventoryTraceabilityReceivingRoutes = require("./inventoryTraceabilityReceivingRoutes");
const inventoryLossDetectionRoutes = require("./inventoryLossDetectionRoutes");
const inventorySaleScanRoutes = require("./inventorySaleScanRoutes");
const inventorySaleCatalogueRoutes = require("./inventorySaleCatalogueRoutes");
const inventoryReturnScanRoutes = require("./inventoryReturnScanRoutes");

const router = express.Router();

router.use("/receiving", inventoryTraceabilityReceivingRoutes);
router.use("/loss-control", inventoryLossDetectionRoutes);
router.use("/sale-products", inventorySaleCatalogueRoutes);
router.use("/sale-scan", inventorySaleScanRoutes);
router.use("/return-scan", inventoryReturnScanRoutes);
router.use(inventoryTraceabilityCoreRoutes);

module.exports = router;
