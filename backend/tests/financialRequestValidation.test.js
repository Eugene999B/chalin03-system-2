const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  validateInstallmentPaymentRequest,
  validatePurchasePaymentRequest,
  validateReturnCreateRequest,
  validateSaleCreateRequest,
} = require("../validation/financialRequestValidators");

function validSale(overrides = {}) {
  return {
    customer_name: "Walk-in Customer",
    customer_phone: "",
    customer_location: "",
    payment_type: "cash",
    amount_tendered: 100,
    amount_paid: 100,
    discount_amount: 0,
    payment_allocations: {
      cash: "",
      momo: "",
      bank: "",
      other: "",
    },
    installment_plan: null,
    items: [{ product_id: 7, quantity: 2 }],
    ...overrides,
  };
}

test("sale validator sanitizes the current cash-sale frontend payload", () => {
  const result = validateSaleCreateRequest({ body: validSale() });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.body.items, [{ product_id: 7, quantity: 2 }]);
  assert.equal(result.value.body.payment_type, "cash");
  assert.equal(result.value.body.discount_amount, 0);
  assert.deepEqual(result.value.body.payment_allocations, {
    cash: 0,
    momo: 0,
    bank: 0,
    other: 0,
  });
});

test("sale validator rejects duplicate products, exponent money and unknown fields", () => {
  const result = validateSaleCreateRequest({
    body: validSale({
      amount_tendered: "1e3",
      items: [
        { product_id: 7, quantity: 1 },
        { product_id: 7, quantity: 2 },
      ],
      branch_id: 99,
    }),
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "INVALID_AMOUNT_TENDERED"));
  assert.ok(result.errors.some((error) => error.code === "DUPLICATE_PRODUCT"));
  assert.ok(result.errors.some((error) => error.code === "UNKNOWN_FIELD"));
});

test("sale validator accepts the current installment-sale plan", () => {
  const result = validateSaleCreateRequest({
    body: validSale({
      customer_name: "Ama Mensah",
      customer_phone: "0244000000",
      payment_type: "installment",
      amount_tendered: 100,
      amount_paid: 100,
      installment_plan: {
        frequency: "monthly",
        installment_count: 3,
        first_due_date: "2026-08-21",
        grace_days: 3,
        delivery_policy: "immediate",
        late_charge_type: "none",
        late_charge_value: 0,
        guarantor_name: "",
        guarantor_phone: "",
        guarantor_location: "",
        terms_accepted: true,
        notes: "",
        custom_due_dates_text: "",
        custom_due_dates: [],
        customer_phone: "0244000000",
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.body.installment_plan.installment_count, 3);
  assert.equal(result.value.body.installment_plan.terms_accepted, true);
});

test("sale validator rejects invalid installment controls instead of silently defaulting", () => {
  const result = validateSaleCreateRequest({
    body: validSale({
      customer_name: "Ama Mensah",
      customer_phone: "0244000000",
      payment_type: "installment",
      installment_plan: {
        frequency: "daily",
        installment_count: 0,
        first_due_date: "not-a-date",
        grace_days: 500,
        delivery_policy: "unknown",
        late_charge_type: "compound",
        late_charge_value: "1e2",
        terms_accepted: "yes",
      },
    }),
  });

  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("INVALID_INSTALLMENT_FREQUENCY"));
  assert.ok(codes.has("INVALID_INSTALLMENT_COUNT"));
  assert.ok(codes.has("INVALID_FIRST_DUE_DATE"));
  assert.ok(codes.has("INVALID_GRACE_DAYS"));
  assert.ok(codes.has("INVALID_DELIVERY_POLICY"));
  assert.ok(codes.has("INVALID_LATE_CHARGE_TYPE"));
  assert.ok(codes.has("INVALID_LATE_CHARGE_VALUE"));
  assert.ok(codes.has("INSTALLMENT_TERMS_REQUIRED"));
});

test("return validator sanitizes the current stock-only frontend payload", () => {
  const result = validateReturnCreateRequest({
    body: {
      sale_id: 10,
      product_id: 7,
      quantity: 1,
      reason: "Wrong item",
      return_type: "stock_only",
      refund_amount: 0,
      refund_method: "none",
      refund_reference: "",
      approver_username: "",
      approver_password: "",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.body.return_type, "stock_only");
  assert.equal(result.value.body.refund_amount, 0);
  assert.equal(result.value.body.refund_method, "none");
});

test("return validator rejects invalid return types instead of converting them to stock-only", () => {
  const result = validateReturnCreateRequest({
    body: {
      sale_id: 10,
      product_id: 7,
      quantity: 1,
      reason: "Wrong item",
      return_type: "exchange",
      refund_amount: 0,
      refund_method: "none",
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "INVALID_RETURN_TYPE"));
});

test("financial refunds require method-specific evidence and an independent approver", () => {
  const result = validateReturnCreateRequest({
    body: {
      sale_id: 10,
      product_id: 7,
      quantity: 1,
      reason: "Damaged",
      return_type: "refund",
      refund_amount: 20,
      refund_method: "momo",
      refund_reference: "",
      approver_username: "",
      approver_password: "",
    },
  });

  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("REFUND_REFERENCE_REQUIRED"));
  assert.ok(codes.has("REFUND_APPROVER_REQUIRED"));
});

test("purchase payment validator preserves cash default and sanitizes notes", () => {
  const result = validatePurchasePaymentRequest({
    params: { id: "14" },
    body: { amount: "50.25", notes: " Supplier balance " },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    params: { id: 14 },
    body: {
      amount: 50.25,
      payment_method: "cash",
      notes: "Supplier balance",
    },
  });
});

test("purchase payment validator rejects unknown methods, fields and exponent amounts", () => {
  const result = validatePurchasePaymentRequest({
    params: { id: "14" },
    body: {
      amount: "1e3",
      payment_method: "crypto",
      branch_id: 2,
    },
  });

  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("INVALID_PAYMENT_AMOUNT"));
  assert.ok(codes.has("INVALID_PURCHASE_PAYMENT_METHOD"));
  assert.ok(codes.has("UNKNOWN_FIELD"));
});

test("installment collection validator sanitizes the current frontend payload", () => {
  const result = validateInstallmentPaymentRequest({
    params: { agreementId: "22" },
    body: {
      amount: "125.00",
      payment_method: " MoMo ",
      payment_reference: " TX-123 ",
      notes: " Counter payment ",
      send_sms: false,
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    params: { agreementId: 22 },
    body: {
      amount: 125,
      payment_method: "momo",
      payment_reference: "TX-123",
      notes: "Counter payment",
      send_sms: false,
    },
  });
});

test("installment collection validator rejects malformed IDs, methods and booleans", () => {
  const result = validateInstallmentPaymentRequest({
    params: { agreementId: "1 OR 1=1" },
    body: {
      amount: "1e3",
      payment_method: "crypto",
      send_sms: "false",
    },
  });

  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("INVALID_AGREEMENT_ID"));
  assert.ok(codes.has("INVALID_INSTALLMENT_PAYMENT_AMOUNT"));
  assert.ok(codes.has("INVALID_INSTALLMENT_PAYMENT_METHOD"));
  assert.ok(codes.has("INVALID_SEND_SMS"));
});

test("all four financial routes use centralized validation before transactions", () => {
  const routesDir = path.join(__dirname, "..", "routes");
  const saleSource = fs.readFileSync(path.join(routesDir, "saleRoutes.js"), "utf8");
  const returnSource = fs.readFileSync(path.join(routesDir, "returnRoutes.js"), "utf8");
  const purchaseSource = fs.readFileSync(path.join(routesDir, "purchaseRoutes.js"), "utf8");
  const installmentSource = fs.readFileSync(
    path.join(routesDir, "installmentRoutes.js"),
    "utf8"
  );

  assert.match(saleSource, /validateRequest\(validateSaleCreateRequest\)/);
  assert.match(saleSource, /req\.validated\.body/);
  assert.match(returnSource, /validateRequest\(validateReturnCreateRequest\)/);
  assert.match(returnSource, /req\.validated\.body/);
  assert.match(
    purchaseSource,
    /validateRequest\(validatePurchasePaymentRequest\)/
  );
  assert.match(purchaseSource, /req\.validated\.params/);
  assert.match(
    installmentSource,
    /validateRequest\(validateInstallmentPaymentRequest\)/
  );
  assert.match(installmentSource, /req\.validated\.body/);
});
