const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const serviceSource = read("services/inventoryReturnQuarantineService.js");
const routeSource = read("routes/inventoryReturnQuarantineRoutes.js");
const compositeSource = read("routes/inventoryTraceabilityRoutes.js");
const saleCatalogueSource = read("routes/inventorySaleCatalogueRoutes.js");

const {
  QUARANTINE_OUTCOMES,
  normalizeOutcome,
  outcomeStatus,
} = require("../services/inventoryReturnQuarantineService");

test("return quarantine exposes only three controlled inspection outcomes", () => {
  assert.deepEqual(Object.values(QUARANTINE_OUTCOMES), [
    "restock",
    "damaged",
    "written_off",
  ]);
  assert.equal(normalizeOutcome("RESTOCK"), "restock");
  assert.equal(outcomeStatus("restock"), "active");
  assert.equal(outcomeStatus("damaged"), "damaged");
  assert.equal(outcomeStatus("written_off"), "written_off");
});

test("quarantine list exposes receipt and return evidence without marking units sellable", () => {
  assert.match(serviceSource, /u\.status = 'returned_quarantine'/);
  assert.match(serviceSource, /r\.reason AS return_reason/);
  assert.match(serviceSource, /s\.receipt_number/);
  assert.match(saleCatalogueSource, /u\.status = 'active'/);
  assert.match(saleCatalogueSource, /returned_quarantine_is_not_sellable: true/);
});

test("inspection requires an atomic returned-quarantine state transition and append-only event", () => {
  assert.match(serviceSource, /FOR UPDATE/);
  assert.match(serviceSource, /assertUnitTransition\(unit\.status, targetStatus\)/);
  assert.match(serviceSource, /WHERE id = \? AND status = 'returned_quarantine'/);
  assert.match(serviceSource, /return_quarantine_inspected/);
  assert.match(serviceSource, /appendUnitEvent/);
  assert.match(serviceSource, /QUARANTINE_INSPECTION_CONFLICT/);
});

test("restock and damaged outcomes retain aggregate inventory while write-off reduces it by exactly one", () => {
  const writeoffBlock = serviceSource.slice(
    serviceSource.indexOf("if (cleanOutcome === QUARANTINE_OUTCOMES.WRITTEN_OFF)"),
    serviceSource.indexOf("const [updateResult]")
  );
  assert.match(writeoffBlock, /SET quantity = quantity - 1/);
  assert.match(writeoffBlock, /quantity > 0/);
  assert.doesNotMatch(serviceSource.slice(0, serviceSource.indexOf("if (cleanOutcome === QUARANTINE_OUTCOMES.WRITTEN_OFF)")), /quantity = quantity - 1/);
});

test("write-off is administrator-only at the API boundary", () => {
  assert.match(routeSource, /outcome === "written_off" && roleOf\(req\) !== "admin"/);
  assert.match(routeSource, /RETURN_QUARANTINE_WRITEOFF_ADMIN_REQUIRED/);
  assert.match(routeSource, /written_off_requires_admin: true/);
});

test("return quarantine API is mounted under the existing traceability boundary", () => {
  assert.match(compositeSource, /inventoryReturnQuarantineRoutes/);
  assert.match(compositeSource, /router\.use\("\/return-quarantine", inventoryReturnQuarantineRoutes\)/);
});
