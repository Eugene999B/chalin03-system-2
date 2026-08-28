const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateSaleCreateRequest,
} = require("../validation/financialRequestValidators");

function baseSale(overrides = {}) {
  return {
    customer_id: null,
    customer_name: "Appiah Eugene",
    customer_phone: "0244000000",
    customer_location: "Dunkwa",
    payment_type: "cash",
    amount_tendered: 100,
    amount_paid: 100,
    discount_amount: 0,
    payment_allocations: { cash: 0, momo: 0, bank: 0, other: 0 },
    installment_plan: null,
    items: [{ product_id: 7, quantity: 1 }],
    ...overrides,
  };
}

test("new customers must have at least two names", () => {
  const result = validateSaleCreateRequest({
    body: baseSale({ customer_name: "Appiah", payment_type: "cash" }),
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(
      (error) => error.code === "CUSTOMER_NAME_REQUIRES_TWO_NAMES"
    )
  );
});

test("credit sales require a customer phone number", () => {
  const result = validateSaleCreateRequest({
    body: baseSale({
      customer_name: "Appiah Eugene",
      customer_phone: "",
      payment_type: "credit",
    }),
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(
      (error) => error.code === "CREDIT_CUSTOMER_PHONE_REQUIRED"
    )
  );
});

test("credit sales accept two-or-more names and a phone number", () => {
  const result = validateSaleCreateRequest({
    body: baseSale({
      customer_name: "Appiah Eugene Kofi",
      customer_phone: "0244000000",
      payment_type: "credit",
    }),
  });

  assert.equal(result.ok, true);
});

test("existing customers can still use their saved identity without a new-name error", () => {
  const result = validateSaleCreateRequest({
    body: baseSale({
      customer_id: 42,
      customer_name: "Legacy",
      customer_phone: "0244000000",
      payment_type: "cash",
    }),
  });

  assert.equal(result.ok, true);
});
