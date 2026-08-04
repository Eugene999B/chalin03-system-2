const express = require("express");

const {
  operationalApprovalExecutionMiddleware,
} = require("../middleware/operationalApprovalExecutionMiddleware");
const operationalApprovalRoutes = require("../routes/operationalApprovalRoutes");

function replaceCachedRouter(modulePath, buildWrapper) {
  const resolved = require.resolve(modulePath);
  const originalRouter = require(resolved);
  const wrapper = buildWrapper(originalRouter);

  if (!require.cache[resolved]) {
    throw new Error(`Could not prepare approval wrapper for ${modulePath}.`);
  }
  require.cache[resolved].exports = wrapper;
}

replaceCachedRouter("../routes/saleRoutes", (originalRouter) => {
  const wrapper = express.Router();
  wrapper.use(operationalApprovalExecutionMiddleware);
  wrapper.use(originalRouter);
  return wrapper;
});

replaceCachedRouter("../routes/returnRoutes", (originalRouter) => {
  const wrapper = express.Router();
  wrapper.use(operationalApprovalExecutionMiddleware);
  wrapper.use(originalRouter);
  return wrapper;
});

replaceCachedRouter("../routes/auditUnlockRequestRoutes", (originalRouter) => {
  const wrapper = express.Router();
  wrapper.use(operationalApprovalRoutes);
  wrapper.use(originalRouter);
  return wrapper;
});

console.log("Operational Approval Centre route protection loaded.");
