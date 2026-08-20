const express = require("express");

const {
  correctStockLedgerSummary,
} = require("./stockLedgerSummaryService");

const INSTALL_FLAG = Symbol.for(
  "chalin03.stockLedgerSummaryBootstrapInstalled"
);

function isStockLedgerRequest(req) {
  if (req.method !== "GET") {
    return false;
  }

  const segments = String(req.path || "")
    .split("/")
    .filter(Boolean);

  return segments.length === 2 && segments[1] === "stock-ledger";
}

function correctStockLedgerResponse(req, res, next) {
  if (!isStockLedgerRequest(req)) {
    return next();
  }

  const originalJson = res.json.bind(res);

  res.json = function sendCorrectedStockLedger(payload) {
    return originalJson(correctStockLedgerSummary(payload));
  };

  return next();
}

function installStockLedgerSummaryBootstrap() {
  if (globalThis[INSTALL_FLAG]) {
    return false;
  }

  const resolved = require.resolve("../routes/productRoutes");
  const originalRouter = require(resolved);
  const wrapper = express.Router();

  wrapper.use(correctStockLedgerResponse);
  wrapper.use(originalRouter);

  if (!require.cache[resolved]) {
    throw new Error("Could not prepare Products stock-ledger summary wrapper.");
  }

  require.cache[resolved].exports = wrapper;

  Object.defineProperty(globalThis, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return true;
}

installStockLedgerSummaryBootstrap();

module.exports = {
  correctStockLedgerResponse,
  installStockLedgerSummaryBootstrap,
  isStockLedgerRequest,
};
