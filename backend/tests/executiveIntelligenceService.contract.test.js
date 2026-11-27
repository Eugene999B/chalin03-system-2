const test = require("node:test");
const assert = require("node:assert/strict");

const { buildAudienceMessage } = require("../services/executiveIntelligenceService");

function sampleIntelligence() {
  return {
    range: { from: "2026-08-01", to: "2026-08-28" },
    scope: "Spare Parts + Installment Finance",
    spare_parts: {
      revenue: 120000,
      sales_count: 24,
      payments_received: 90000,
      collection_rate: 75,
      uncollected_sales_value: 30000,
      expenses: 18000,
      expense_ratio: 15,
      estimated_operating_result: 72000,
      low_stock_count: 4,
      out_of_stock_count: 1,
      stock_retail_at_low_stock: 10000,
      overdue_debt_balance: 18000,
      overdue_debt_accounts: 3,
      voided_sales_count: 2,
      voided_sales_value: 5000,
      voided_sales_value_rate: 4.2,
    },
    installment_finance: {
      active_accounts: 8,
      outstanding_amount: 250000,
      overdue_amount: 40000,
      overdue_accounts: 2,
      critical_risk_accounts: 1,
      high_risk_accounts: 2,
      due_next_7_days: 30000,
      due_next_7_days_share: 12,
      reversals_in_period: 1,
    },
    actions: [
      {
        severity: "critical",
        title: "High-risk financed machines need executive review",
        detail: "One account is in the critical risk band.",
        action: "Review the account and recovery decision today.",
      },
    ],
  };
}

test("executive briefing stays within Spare Parts and Installment Finance", () => {
  const message = buildAudienceMessage(sampleIntelligence(), "executive");
  assert.match(message, /Spare Parts/);
  assert.match(message, /Installment Finance/);
  assert.match(message, /critical/i);
  assert.match(message, /uncollected/i);
  assert.doesNotMatch(message, /Mining|Fleet|Hire/);
});

test("auditor briefing treats suspicious-looking activity as review signals, not accusations", () => {
  const message = buildAudienceMessage(sampleIntelligence(), "auditor");
  assert.match(message, /review indicators, not accusations/i);
  assert.match(message, /voided sale/i);
  assert.match(message, /reversal\/refund/i);
  assert.match(message, /transaction evidence/i);
});

test("manager briefing contains concrete next actions", () => {
  const message = buildAudienceMessage(sampleIntelligence(), "manager");
  assert.match(message, /Management decisions/i);
  assert.match(message, /Review the account and recovery decision today/i);
  assert.match(message, /cash conversion/i);
});
