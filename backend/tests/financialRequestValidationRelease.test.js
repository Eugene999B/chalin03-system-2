const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROUTE_EXPECTATIONS = [
  {
    file: "saleRoutes.js",
    validator: "validateSaleCreateRequest",
    route: 'router.post("/", requireAuth, validateRequest(validateSaleCreateRequest)',
  },
  {
    file: "returnRoutes.js",
    validator: "validateReturnCreateRequest",
    route: "validateRequest(validateReturnCreateRequest)",
  },
  {
    file: "purchaseRoutes.js",
    validator: "validatePurchasePaymentRequest",
    route: "validateRequest(validatePurchasePaymentRequest)",
  },
  {
    file: "installmentRoutes.js",
    validator: "validateInstallmentPaymentRequest",
    route: "validateRequest(validateInstallmentPaymentRequest)",
  },
];

test("critical financial write routes retain centralized validation", () => {
  const routesDirectory = path.join(__dirname, "..", "routes");

  for (const expectation of ROUTE_EXPECTATIONS) {
    const source = fs.readFileSync(
      path.join(routesDirectory, expectation.file),
      "utf8"
    );

    assert.match(source, new RegExp(expectation.validator));
    assert.ok(
      source.includes(expectation.route),
      `${expectation.file} must retain ${expectation.validator}`
    );
    assert.match(source, /req\.validated/);
  }
});
