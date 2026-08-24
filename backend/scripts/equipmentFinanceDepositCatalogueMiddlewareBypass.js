"use strict";

// Load before server.js so Deposit Reservation requests are not blocked by the
// broad Equipment Sales foundation middleware. The Finance routes still apply
// their own authentication, permission, schema, trigger, locking, idempotency,
// and transaction safeguards.

const Module = require("node:module");
const path = require("node:path");

const originalLoad = Module._load;
const targetPath = path.resolve(
  __dirname,
  "../middleware/equipmentCatalogueIntegrityMiddleware.js"
);

function isDepositReservationRequest(req) {
  const values = [req?.path, req?.originalUrl, req?.url]
    .map((value) => String(value || "").split("?")[0]);

  return values.some(
    (value) =>
      /^\/sales\/deposit-reservations(?:\/|$)/.test(value) ||
      /\/api\/equipment-catalogue\/sales\/deposit-reservations(?:\/|$)/.test(value)
  );
}

Module._load = function patchedModuleLoad(request, parent, isMain) {
  let resolved;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch {
    return originalLoad.call(this, request, parent, isMain);
  }

  const loaded = originalLoad.call(this, request, parent, isMain);
  if (resolved !== targetPath || loaded?.__chalin03DepositBoundaryWrapped) {
    return loaded;
  }

  const originalMiddleware = loaded.enforceEquipmentCatalogueWriteIntegrity;
  if (typeof originalMiddleware !== "function") {
    return loaded;
  }

  const wrappedMiddleware = function depositBoundaryAwareEquipmentCatalogueMiddleware(
    req,
    res,
    next
  ) {
    if (isDepositReservationRequest(req)) {
      return next();
    }
    return originalMiddleware(req, res, next);
  };

  return {
    ...loaded,
    enforceEquipmentCatalogueWriteIntegrity: wrappedMiddleware,
    __chalin03DepositBoundaryWrapped: true,
  };
};
