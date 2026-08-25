const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const { requestContext } = require("../middleware/requestContext");

test("Legacy Release 3F Installment API is explicitly retired", () => {
  let status = null;
  let payload = null;
  let reachedNextMiddleware = false;
  const req = {
    path: "/api/installments/agreements",
    method: "GET",
    headers: {},
  };
  const res = {
    setHeader() {},
    status(code) {
      status = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };

  requestContext(req, res, () => {
    reachedNextMiddleware = true;
  });

  assert.equal(reachedNextMiddleware, false);
  assert.equal(status, 410);
  assert.equal(payload?.code, "LEGACY_INSTALLMENT_API_RETIRED");
});

test("Professional Equipment Installment Finance remains the active server-side Finance route", () => {
  const server = read("backend/server.js");
  const professionalRoutes = read("backend/routes/equipmentFinanceProfessionalRoutes.js");
  const finalLifecycleRoutes = read("backend/routes/equipmentFinanceFinalLifecycleRoutes.js");

  assert.match(server, /equipmentCatalogueRoutes/);
  assert.match(server, /\/api\/equipment-catalogue/);
  assert.match(professionalRoutes, /\/professional\/notification-settings/);
  assert.match(finalLifecycleRoutes, /finance-lifecycle/);
});

test("Legacy installment implementation remains source-only and is not used by the Professional reminder engine", () => {
  const reminder = read("backend/services/equipmentFinanceReminderEngine.js");
  assert.doesNotMatch(reminder, /installmentReminderService/);
  assert.match(reminder, /equipmentInstallmentSchedule/);
});

console.log("Legacy Installment retirement contract passed.");
