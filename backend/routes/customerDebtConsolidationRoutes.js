const express = require("express");

const topDebtAccountMergeRoutes = require("./topDebtAccountMergeRoutes");
const legacyCustomerDebtConsolidationRoutes = require("./legacyCustomerDebtConsolidationRoutes");
const customerIdentityMaintenanceRoutes = require("./customerIdentityMaintenanceRoutes");
const {
  getCustomerFeatureControls,
  getFeatureDisabledMessage,
} = require("../services/customerFeatureControlService");

const router = express.Router();

// Keep customer identity maintenance endpoints ahead of the legacy customer
// detail route so /customer/:id/identity is never mistaken for /:customerId.
router.use(customerIdentityMaintenanceRoutes);

async function guardCustomerMergeFeature(req, res, next) {
  const mergePaths = new Set(["/merge", "/merge-preview", "/merge-accounts"]);
  if (!mergePaths.has(req.path)) {
    return next();
  }

  try {
    const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);
    const controls = await getCustomerFeatureControls(branchId);

    if (!controls.customer_merge_enabled) {
      return res.status(403).json({
        status: "error",
        code: "CUSTOMER_MERGE_DISABLED",
        message: getFeatureDisabledMessage("customer_merge"),
      });
    }

    return next();
  } catch (error) {
    console.error("Customer merge feature guard error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not verify the customer merge feature state.",
    });
  }
}

// The authoritative top Debt Desk account merge is mounted first so it can
// accept both saved customer keys and receipt-level legacy keys. The preserved
// legacy router remains available for older reports and compatibility routes.
router.use(guardCustomerMergeFeature);
router.use(topDebtAccountMergeRoutes);
router.use(legacyCustomerDebtConsolidationRoutes);

module.exports = router;
