const express = require("express");

const topDebtAccountMergeRoutes = require("./topDebtAccountMergeRoutes");
const legacyCustomerDebtConsolidationRoutes = require("./legacyCustomerDebtConsolidationRoutes");

const router = express.Router();

// The authoritative top Debt Desk account merge is mounted first so it can
// accept both saved customer keys and receipt-level legacy keys. The preserved
// legacy router remains available for older reports and compatibility routes.
router.use(topDebtAccountMergeRoutes);
router.use(legacyCustomerDebtConsolidationRoutes);

module.exports = router;
