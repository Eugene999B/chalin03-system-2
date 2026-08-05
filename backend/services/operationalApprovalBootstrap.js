const express = require("express");

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
  installDatabaseStartupGate,
  installOperationalApprovalRoutes,
};
