const express = require("express");

const topDebtAccountMergeRoutes = require("./topDebtAccountMergeRoutes");
const legacyCustomerDebtConsolidationRoutes = require("./legacyCustomerDebtConsolidationRoutes");
const customerIdentityMaintenanceRoutes = require("./customerIdentityMaintenanceRoutes");
const {
  getCustomerFeatureControls,
  getFeatureDisabledMessage,
} = require("../services/customerFeatureControlService");

const router = express.Router();

// Customer identity maintenance is mounted before legacy /:customerId routes.
router.use(customerIdentityMaintenanceRoutes);

async function guardCustomerMergeFeature(req, res, next) {
  const mergePaths = new Set(["/merge", "/merge-preview", "/merge-accounts"]);
  if (!mergePaths.has(req.path)) return next();

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
    return res.status(500).json({ status: "error", message: "Could not verify the customer merge feature state." });
  }
}

router.use(guardCustomerMergeFeature);
router.use(topDebtAccountMergeRoutes);
router.use(legacyCustomerDebtConsolidationRoutes);

module.exports = router;
