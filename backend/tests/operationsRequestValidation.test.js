const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  validateExpenseCreateRequest,
  validatePurchaseCreateRequest,
  validateStockAdjustmentRequest,
  validateStockTransferActionRequest,
  validateStockTransferCreateRequest,
} = require("../validation/operationsRequestValidators");

function errorCodes(result) {
  return new Set((result.errors || []).map((error) => error.code));
}

test("purchase creation validator sanitizes the current frontend payload", () => {
  const result = validatePurchaseCreateRequest({
    body: {
      supplier_id: "12",
      invoice_number: " INV-2026-19 ",
      purchase_date: "2026-07-21",
      amount_paid: 50,
      notes: " New delivery ",
      items: [
        {
          product_id: 7,
          product_name: "Brake Pad",
          quantity: 3,
          cost_price: 25,
          line_total: 75,
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    body: {
      supplier_id: 12,
      invoice_number: "INV-2026-19",
      purchase_date: "2026-07-21",
      amount_paid: 50,
      notes: "New delivery",
      items: [{ product_id: 7, quantity: 3, cost_price: 25 }],
    },
  });
});

test("purchase creation validator rejects duplicate products and malformed money", () => {
  const result = validatePurchaseCreateRequest({
    body: {
      supplier_id: null,
      invoice_number: "",
      purchase_date: "2026-02-30",
      amount_paid: "1e3",
      notes: "",
      branch_id: 99,
      items: [
        { product_id: 7, quantity: 1, cost_price: 10 },
        { product_id: 7, quantity: 2, cost_price: "4.999" },
      ],
    },
  });

  assert.equal(result.ok, false);
  const codes = errorCodes(result);
  assert.ok(codes.has("INVALID_PURCHASE_DATE"));
  assert.ok(codes.has("INVALID_AMOUNT_PAID"));
  assert.ok(codes.has("DUPLICATE_PRODUCT"));
  assert.ok(codes.has("INVALID_COST_PRICE"));
  assert.ok(codes.has("UNKNOWN_FIELD"));
});

test("purchase creation validator rejects payment above calculated total", () => {
  const result = validatePurchaseCreateRequest({
    body: {
      purchase_date: "2026-07-21",
      amount_paid: 100,
      items: [{ product_id: 7, quantity: 2, cost_price: 20 }],
    },
  });

  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("AMOUNT_PAID_EXCEEDS_TOTAL"));
});

test("expense validator sanitizes today's sales receipt expense", () => {
  const result = validateExpenseCreateRequest({
    body: {
      category: " Fuel ",
      description: "Delivery fuel",
      amount: 75.5,
      payment_method: "cash",
      funding_source: "today_sales_receipts",
      affects_daily_closing: true,
      closing_treatment_note: "",
      expense_date: "2026-07-21",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.body.category, "Fuel");
  assert.equal(result.value.body.amount, 75.5);
  assert.equal(result.value.body.affects_daily_closing, true);
});

test("expense validator rejects coerced booleans, invalid dates and exponent amounts", () => {
  const result = validateExpenseCreateRequest({
    body: {
      category: "Fuel",
      description: "",
      amount: "1e3",
      payment_method: "cash",
      funding_source: "today_sales_receipts",
      affects_daily_closing: "true",
      closing_treatment_note: "",
      expense_date: "tomorrow",
    },
  });

  assert.equal(result.ok, false);
  const codes = errorCodes(result);
  assert.ok(codes.has("INVALID_EXPENSE_AMOUNT"));
  assert.ok(codes.has("INVALID_AFFECTS_DAILY_CLOSING"));
  assert.ok(codes.has("INVALID_EXPENSE_DATE"));
});

test("expense validator enforces funding and closing treatment rules", () => {
  const result = validateExpenseCreateRequest({
    body: {
      category: "Supplier credit",
      amount: 30,
      payment_method: "cash",
      funding_source: "unpaid_credit",
      affects_daily_closing: false,
      closing_treatment_note: "",
      expense_date: "2026-07-21",
    },
  });

  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("INVALID_UNPAID_CREDIT_METHOD"));
});

test("stock adjustment validator sanitizes current frontend payload", () => {
  const result = validateStockAdjustmentRequest({
    params: { id: "7" },
    body: {
      adjustment_type: "decrease",
      movement_type: "damaged",
      quantity: 2,
      reason: " Damaged during handling ",
      reference_number: " ADJ-22 ",
      movement_date: "2026-07-21",
      notes: " Supervisor checked ",
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    params: { id: 7 },
    body: {
      adjustment_type: "decrease",
      movement_type: "damaged",
      quantity: 2,
      reason: "Damaged during handling",
      reference_number: "ADJ-22",
      movement_date: "2026-07-21",
      notes: "Supervisor checked",
    },
  });
});

test("stock adjustment validator rejects incompatible and unknown movement types", () => {
  const incompatible = validateStockAdjustmentRequest({
    params: { id: 7 },
    body: {
      adjustment_type: "increase",
      movement_type: "damaged",
      quantity: 2,
      reason: "Correction",
      movement_date: "2026-07-21",
    },
  });
  const unknown = validateStockAdjustmentRequest({
    params: { id: 7 },
    body: {
      adjustment_type: "decrease",
      movement_type: "mystery",
      quantity: 2,
      reason: "Correction",
      movement_date: "2026-07-21",
    },
  });

  assert.equal(incompatible.ok, false);
  assert.ok(errorCodes(incompatible).has("INCOMPATIBLE_STOCK_MOVEMENT"));
  assert.equal(unknown.ok, false);
  assert.ok(errorCodes(unknown).has("INVALID_STOCK_MOVEMENT_TYPE"));
});

test("stock transfer validator sanitizes the current frontend payload", () => {
  const result = validateStockTransferCreateRequest({
    body: {
      from_branch_id: 1,
      to_branch_id: 2,
      request_note: " Move for customer demand ",
      items: [
        {
          source_product_id: 7,
          requested_quantity: 4,
          item_note: "Urgent",
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    body: {
      from_branch_id: 1,
      to_branch_id: 2,
      request_note: "Move for customer demand",
      items: [
        {
          source_product_id: 7,
          requested_quantity: 4,
          item_note: "Urgent",
        },
      ],
    },
  });
});

test("stock transfer validator accepts legacy aliases but rejects conflicts", () => {
  const valid = validateStockTransferCreateRequest({
    body: {
      from_branch_id: "1",
      to_branch_id: "2",
      note: "Legacy request",
      items: [{ product_id: 9, quantity: 2, note: "Legacy item" }],
    },
  });
  const conflict = validateStockTransferCreateRequest({
    body: {
      from_branch_id: 1,
      to_branch_id: 2,
      request_note: "First",
      note: "Second",
      items: [
        {
          source_product_id: 9,
          product_id: 10,
          requested_quantity: 2,
        },
      ],
    },
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.value.body.items[0].source_product_id, 9);
  assert.equal(conflict.ok, false);
  assert.ok(errorCodes(conflict).has("CONFLICTING_ALIASES"));
});

test("stock transfer validator rejects same stores and duplicate products", () => {
  const result = validateStockTransferCreateRequest({
    body: {
      from_branch_id: 1,
      to_branch_id: 1,
      items: [
        { source_product_id: 7, requested_quantity: 1 },
        { source_product_id: 7, requested_quantity: 2 },
      ],
    },
  });

  assert.equal(result.ok, false);
  const codes = errorCodes(result);
  assert.ok(codes.has("SAME_TRANSFER_BRANCH"));
  assert.ok(codes.has("DUPLICATE_TRANSFER_PRODUCT"));
});

test("all stock transfer actions sanitize IDs and matching note aliases", () => {
  for (const [action, noteKey] of Object.entries({
    approve: "approval_note",
    reject: "reject_note",
    dispatch: "dispatch_note",
    receive: "receive_note",
    cancel: "cancel_note",
  })) {
    const validator = validateStockTransferActionRequest(action);
    const result = validator({
      params: { id: "44" },
      body: { [noteKey]: " Checked ", note: " Checked " },
    });

    assert.equal(result.ok, true, action);
    assert.equal(result.value.params.id, 44, action);
    assert.equal(result.value.body[noteKey], "Checked", action);
    assert.equal(result.value.body.note, "Checked", action);
  }
});

test("stock transfer actions reject invalid IDs, conflicts and unknown fields", () => {
  const validator = validateStockTransferActionRequest("dispatch");
  const result = validator({
    params: { id: "not-an-id" },
    body: {
      dispatch_note: "One",
      note: "Two",
      branch_id: 9,
    },
  });

  assert.equal(result.ok, false);
  const codes = errorCodes(result);
  assert.ok(codes.has("INVALID_TRANSFER_ID"));
  assert.ok(codes.has("CONFLICTING_ALIASES"));
  assert.ok(codes.has("UNKNOWN_FIELD"));
});

test("route contract keeps centralized validation on all targeted write routes", () => {
  const root = path.join(__dirname, "..");
  const purchaseSource = fs.readFileSync(path.join(root, "routes", "purchaseRoutes.js"), "utf8");
  const expenseSource = fs.readFileSync(path.join(root, "routes", "expenseRoutes.js"), "utf8");
  const productSource = fs.readFileSync(path.join(root, "routes", "productRoutes.js"), "utf8");
  const transferSource = fs.readFileSync(path.join(root, "routes", "stockTransferRoutes.js"), "utf8");

  assert.match(purchaseSource, /validateRequest\(validatePurchaseCreateRequest\)/);
  assert.match(expenseSource, /validateRequest\(validateExpenseCreateRequest\)/);
  assert.match(productSource, /validateRequest\(validateStockAdjustmentRequest\)/);
  assert.match(transferSource, /validateRequest\(validateStockTransferCreateRequest\)/);

  for (const action of ["approve", "reject", "dispatch", "receive", "cancel"]) {
    assert.match(
      transferSource,
      new RegExp(`validateRequest\\(validateStockTransferActionRequest\\("${action}"\\)\\)`)
    );
  }

  assert.match(purchaseSource, /req\.validated\.body/);
  assert.match(expenseSource, /req\.validated\.body/);
  assert.match(productSource, /req\.validated\.params/);
  assert.match(transferSource, /req\.validated\.params/);
});
