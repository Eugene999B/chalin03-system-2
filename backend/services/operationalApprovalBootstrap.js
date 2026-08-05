const express = require("express");
const rateLimit = require("express-rate-limit");

const dbModule = require("../config/db");
const {
  operationalApprovalExecutionMiddleware,
} = require("../middleware/operationalApprovalExecutionMiddleware");
const operationalApprovalRoutes = require("../routes/operationalApprovalRoutes");
const {
  runOperationalApprovalCentreStartup,
} = require("../scripts/runOperationalApprovalCentreStartup");

const DATABASE_STARTUP_FLAG = Symbol.for(
  "chalin03.operationalApprovalDatabaseStartupInstalled"
);
const ROUTE_BOOTSTRAP_FLAG = Symbol.for(
  "chalin03.operationalApprovalRouteBootstrapInstalled"
);

const protectedRouteExecutionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "PROTECTED_ROUTE_RATE_LIMITED",
    message:
      "Too many protected business requests were received from this device. Wait briefly before trying again.",
  },
});

const approvalReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "APPROVAL_CENTRE_READ_RATE_LIMITED",
    message: "Too many Approval Centre refreshes were attempted. Wait briefly.",
  },
});

const approvalRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "APPROVAL_REQUEST_RATE_LIMITED",
    message:
      "Too many protected-action requests were submitted. Wait briefly before trying again.",
  },
});

const approvalDecisionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "APPROVAL_DECISION_RATE_LIMITED",
    message:
      "Too many administrator approval decisions were attempted. Wait briefly before trying again.",
  },
});

function buildOperationalApprovalRateLimitRouter() {
  const limiterRouter = express.Router();

  limiterRouter.get("/operational", approvalReadLimiter);
  limiterRouter.post(
    [
      "/operational/return-refund",
      "/operational/sale-edit/:saleId",
      "/operational/sale-void/:saleId",
    ],
    approvalRequestLimiter
  );
  limiterRouter.post(
    ["/operational/:id/approve", "/operational/:id/reject"],
    approvalDecisionLimiter
  );
  limiterRouter.patch("/:id/review", approvalDecisionLimiter);

  return limiterRouter;
}

function installDatabaseStartupGate() {
  if (dbModule[DATABASE_STARTUP_FLAG]) return false;

  const originalTestDatabaseConnection = dbModule.testDatabaseConnection;
  let migrationPromise = null;

  dbModule.testDatabaseConnection = async function testApprovalReadyDatabase(
    ...args
  ) {
    const result = await originalTestDatabaseConnection(...args);

    if (!migrationPromise) {
      migrationPromise = runOperationalApprovalCentreStartup();
    }

    await migrationPromise;
    return result;
  };

  Object.defineProperty(dbModule, DATABASE_STARTUP_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return true;
}

function replaceCachedRouter(modulePath, buildWrapper) {
  const resolved = require.resolve(modulePath);
  const originalRouter = require(resolved);
  const wrapper = buildWrapper(originalRouter);

  if (!require.cache[resolved]) {
    throw new Error(`Could not prepare approval wrapper for ${modulePath}.`);
  }

  require.cache[resolved].exports = wrapper;
}

function installOperationalApprovalRoutes() {
  if (globalThis[ROUTE_BOOTSTRAP_FLAG]) return false;

  replaceCachedRouter("../routes/saleRoutes", (originalRouter) => {
    const wrapper = express.Router();
    wrapper.use(
      protectedRouteExecutionLimiter,
      operationalApprovalExecutionMiddleware
    );
    wrapper.use(originalRouter);
    return wrapper;
  });

  replaceCachedRouter("../routes/returnRoutes", (originalRouter) => {
    const wrapper = express.Router();
    wrapper.use(
      protectedRouteExecutionLimiter,
      operationalApprovalExecutionMiddleware
    );
    wrapper.use(originalRouter);
    return wrapper;
  });

  replaceCachedRouter("../routes/auditUnlockRequestRoutes", (originalRouter) => {
    const wrapper = express.Router();
    wrapper.use(buildOperationalApprovalRateLimitRouter());
    wrapper.use(operationalApprovalRoutes);
    wrapper.use(originalRouter);
    return wrapper;
  });

  Object.defineProperty(globalThis, ROUTE_BOOTSTRAP_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return true;
}

installDatabaseStartupGate();
installOperationalApprovalRoutes();

console.log("Operational Approval Centre route protection loaded.");

module.exports = {
  buildOperationalApprovalRateLimitRouter,
  installDatabaseStartupGate,
  installOperationalApprovalRoutes,
};
