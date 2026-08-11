const express = require("express");

const productInventoryListRoutes = require("./productInventoryListRoutes");
const productCoreRoutes = require("./productCoreRoutes");

const router = express.Router();

// The traceability-aware catalogue handles GET / first and preserves every
// legacy product mutation/report endpoint through the byte-for-byte core router.
router.use(productInventoryListRoutes);
router.use(productCoreRoutes);

module.exports = router;
