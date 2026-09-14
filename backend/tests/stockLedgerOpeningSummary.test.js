const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  correctStockLedgerSummary,
} = require("../services/stockLedgerSummaryService");

test("opening balance is shown as opening stock instead of adjustment increase", () => {
  const payload = {
    status: "success",
    summary: {
      opening_quantity: 0,
      current_quantity: 8,
      total_adjustment_increase_quantity: 10,
      total_adjustment_decrease_quantity: 0,
      total_sales_quantity: 2,
    },
    ledger: [
      {
        movement_type: "Sale",
        source: "sale_items",
        change_quantity: -2,
      },
      {
        movement_type: "Opening Balance",
        source: "stock_adjustments",
        change_quantity: 10,
      },
    ],
  };

  const result = correctStockLedgerSummary(payload);

  assert.equal(result.summary.opening_quantity, 10);
  assert.equal(result.summary.total_adjustment_increase_quantity, 0);
  assert.equal(result.summary.current_quantity, 8);
  assert.equal(result.summary.total_sales_quantity, 2);
  assert.notStrictEqual(result, payload);
  assert.equal(payload.summary.opening_quantity, 0);
});

test("ordinary stock corrections remain separate from opening balance", () => {
  const payload = {
    status: "success",
    summary: {
      opening_quantity: 5,
      current_quantity: 9,
      total_adjustment_increase_quantity: 7,
      total_adjustment_decrease_quantity: 3,
    },
    ledger: [
      {
        movement_type: "Opening Balance",
        source: "stock_adjustments",
        change_quantity: 5,
      },
      {
        movement_type: "Correction Increase",
        source: "stock_adjustments",
        change_quantity: 2,
      },
      {
        movement_type: "Correction Decrease",
        source: "stock_adjustments",
        change_quantity: -3,
      },
    ],
  };

  const result = correctStockLedgerSummary(payload);

  assert.equal(result.summary.opening_quantity, 10);
  assert.equal(result.summary.total_adjustment_increase_quantity, 2);
  assert.equal(result.summary.total_adjustment_decrease_quantity, 3);
  assert.equal(result.summary.current_quantity, 9);
});

test("stock ledger responses without opening balance remain unchanged", () => {
  const payload = {
    status: "success",
    summary: {
      opening_quantity: 4,
      current_quantity: 6,
      total_adjustment_increase_quantity: 2,
      total_adjustment_decrease_quantity: 0,
    },
    ledger: [
      {
        movement_type: "Correction Increase",
        source: "stock_adjustments",
        change_quantity: 2,
      },
    ],
  };

  assert.strictEqual(correctStockLedgerSummary(payload), payload);
});

test("startup preload installs the stock-ledger summary wrapper", () => {
  const root = path.resolve(__dirname, "../..");
  const preload = fs.readFileSync(
    path.join(root, "backend/services/exportWorkbookSafetyBootstrap.js"),
    "utf8"
  );
  const bootstrap = fs.readFileSync(
    path.join(root, "backend/services/stockLedgerSummaryBootstrap.js"),
    "utf8"
  );

  assert.match(preload, /require\("\.\/stockLedgerSummaryBootstrap"\)/);
  assert.match(
    bootstrap,
    /segments\.length === 2 && segments\[1\] === "stock-ledger"/
  );
  assert.match(bootstrap, /correctStockLedgerSummary\(payload\)/);
  assert.doesNotMatch(
    bootstrap,
    /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE TABLE)\b/i
  );
});
