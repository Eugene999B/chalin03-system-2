"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  AiSparePartsIntelligenceError,
  buildCollectionsHealth,
  buildInventoryHealth,
  buildOperationsSnapshot,
  buildScopedAccountingRequest,
  normalizeDateWindow,
} = require("../services/aiSparePartsIntelligenceService");
const {
  registerSparePartsAiTools,
} = require("../ai-tools/sparePartsTools");

const repoRoot = path.resolve(__dirname, "../..");
const toolSource = fs.readFileSync(
  path.join(repoRoot, "backend/ai-tools/sparePartsTools.js"),
  "utf8"
);
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/aiSparePartsIntelligenceService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/aiRoutes.js"),
  "utf8"
);

const context = Object.freeze({
  actor: Object.freeze({ id: 9, role: "staff", username: "acceptance" }),
  scope: Object.freeze({
    persona: "copilot",
    workspace_code: "spare_parts",
    branch_id: 7,
  }),
});

const intelligence = Object.freeze({
  scope: {
    branch_code: "MAIN",
    branch_name: "Main Store",
    start_date: "2026-08-01",
    end_date: "2026-08-07",
    days: 7,
  },
  sales: {
    transaction_count: 12,
    total_sales: 5000,
    total_paid: 4200,
    total_balance: 800,
    total_discount: 50,
    average_sale: 416.67,
    collection_rate: 84,
    cash_total: 2000,
    momo_total: 1200,
    bank_total: 1000,
    credit_total: 800,
    mixed_total: 0,
  },
  debts: {
    active_debt_count: 4,
    total_debt_balance: 1800,
    new_debt_amount: 700,
    debt_payments: 400,
    aging: [
      { bucket: "0-7 days", count: 2, total: 600 },
      { bucket: "60+ days", count: 2, total: 1200 },
    ],
    customers: [{ name: "MUST NOT LEAK", phone: "0240000000" }],
  },
  stock: {
    product_count: 90,
    total_quantity: 840,
    low_stock_count: 3,
    negative_stock_count: 1,
    estimated_stock_cost_value: 25000,
    estimated_stock_retail_value: 37000,
    low_stock_items: [
      { id: 12, name: "Oil Filter", quantity: 2, low_stock_threshold: 5 },
    ],
  },
  expenses: { expense_count: 3, total_expenses: 450 },
  purchases: {
    purchase_count: 2,
    total_purchases: 1900,
    amount_paid: 1400,
    balance: 500,
  },
  returns: { return_count: 1, total_return_amount: 200 },
  stock_adjustments: {
    adjustment_count: 2,
    decrease_count: 1,
    set_count: 1,
    damaged_count: 0,
    lost_count: 0,
  },
  stock_transfers: {
    transfer_count: 2,
    dispatched_not_received_count: 1,
    quantity_mismatch_count: 0,
  },
  profit_and_loss: {
    gross_sales: 5000,
    discounts: 50,
    net_sales: 4950,
    operating_expenses: 450,
    estimated_net_before_stock_cost: 4500,
    conservative_cash_position: 2350,
    warning: "True profit requires reliable cost of goods sold.",
  },
  audit: {
    audit_score: 82,
    audit_status: "healthy",
    flags: [
      {
        severity: "warning",
        category: "Stock",
        title: "Low stock",
        detail: "Three items need replenishment.",
        recommended_action: "Review reorder quantities.",
      },
    ],
  },
  recommendations: [
    {
      priority: "high",
      title: "Create debt follow-up list",
      action: "Review old balances and record payments promptly.",
    },
  ],
  generated_at: "2026-08-07T15:00:00.000Z",
});

test("date window accepts valid dates, swaps reversed dates and limits one year", () => {
  assert.deepEqual(normalizeDateWindow({ start_date: "2026-08-07", end_date: "2026-08-01" }), {
    start_date: "2026-08-01",
    end_date: "2026-08-07",
  });
  assert.throws(
    () => normalizeDateWindow({ start_date: "2025-01-01", end_date: "2026-08-07" }),
    (error) =>
      error instanceof AiSparePartsIntelligenceError &&
      error.code === "AI_SPARE_PARTS_WINDOW_TOO_LARGE"
  );
  assert.throws(
    () => normalizeDateWindow({ start_date: "07/08/2026" }),
    (error) => error.code === "AI_SPARE_PARTS_DATE_INVALID"
  );
});

test("scoped accounting request is forced to the authorized Spare Parts branch", () => {
  const request = buildScopedAccountingRequest(context, {
    start_date: "2026-08-01",
    end_date: "2026-08-07",
    branch_id: 999,
  });
  assert.equal(request.query.branch_id, 7);
  assert.equal(request.user.branch_id, 7);
  assert.equal(request.user.default_branch_id, 7);
  assert.equal(request.query.start_date, "2026-08-01");
  assert.equal(request.query.end_date, "2026-08-07");
});

test("aggregate snapshots expose business intelligence without customer identities", () => {
  const operations = buildOperationsSnapshot(intelligence, context);
  const inventory = buildInventoryHealth(intelligence, context);
  const collections = buildCollectionsHealth(intelligence, context);

  assert.equal(operations.scope.branch_id, 7);
  assert.equal(operations.sales.total_sales, 5000);
  assert.equal(operations.inventory.low_stock_count, 3);
  assert.equal(inventory.inventory.low_stock_items[0].name, "Oil Filter");
  assert.equal(collections.collections.total_debt_balance, 1800);
  assert.equal(collections.collections.aging.length, 2);
  assert.equal(operations.privacy.customer_identity_included, false);
  assert.equal(collections.privacy.customer_identity_included, false);

  const serialized = JSON.stringify({ operations, inventory, collections });
  assert.doesNotMatch(serialized, /MUST NOT LEAK|0240000000/);
});

test("Spare Parts AI tools register as read-only branch-scoped R1 tools", () => {
  const registry = new AiToolRegistry();
  registerSparePartsAiTools(registry, {
    loader: async () => ({ intelligence, context }),
  });
  const tools = registry.list({ persona: "copilot", workspace: "spare_parts" });
  assert.deepEqual(
    tools.map((tool) => tool.key),
    [
      "spare_parts.collections_health",
      "spare_parts.customer_accounting_collections_diagnostics",
      "spare_parts.inventory_health",
      "spare_parts.operations_snapshot",
      "spare_parts.performance_diagnostics",
    ]
  );
  for (const tool of tools) {
    assert.equal(tool.risk_level, 1);
    assert.equal(tool.scope_requirements.branch, true);
    assert.deepEqual(tool.allowed_workspaces, ["spare_parts"]);
    assert.deepEqual(tool.required_permissions, ["ai.use", "ai.read"]);
    assert.equal(tool.evidence_required, true);
  }
});

test("tool handlers return aggregate evidence and no execution authority", async () => {
  const registry = new AiToolRegistry();
  registerSparePartsAiTools(registry, {
    loader: async () => ({ intelligence, context }),
  });
  for (const key of [
    "spare_parts.operations_snapshot",
    "spare_parts.performance_diagnostics",
    "spare_parts.inventory_health",
    "spare_parts.collections_health",
  ]) {
    const output = await registry.get(key).handler({ input: {}, context });
    assert.equal(output.execution_authority, "read_only");
    assert.equal(output.evidence.length, 1);
    assert.equal(output.evidence[0].classification, "internal");
    assert.equal(output.evidence[0].workspace_code, "spare_parts");
    assert.equal(output.evidence[0].metadata.branch_id, 7);
    assert.equal(output.evidence[0].metadata.aggregate_only, true);
  }
});

test("AI tool layer contains no direct database or SQL access", () => {
  assert.doesNotMatch(
    toolSource,
    /config\/db|mysql2|\bpool\s*\.|\bconnection\s*\.|\.query\s*\(|\bSELECT\s+|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/i
  );
  assert.match(serviceSource, /buildAccountingIntelligence/);
  assert.doesNotMatch(serviceSource, /config\/db|mysql2/);
});

test("main staff AI router registers Spare Parts intelligence tools", () => {
  assert.match(routeSource, /registerSparePartsAiTools/);
  assert.match(routeSource, /registerFoundationAiTools\(\)/);
  assert.match(routeSource, /registerSparePartsAiTools\(\)/);
});
