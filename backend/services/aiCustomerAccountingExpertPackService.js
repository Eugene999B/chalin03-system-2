"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CUSTOMER_ACCOUNTING_SOURCE_BASE_COMMIT = "75d27aaea3d89fea1005292dbfc65453c8544003";

const CUSTOMER_ACCOUNTING_RUNTIME_FILES = Object.freeze([
  "services/accountingIntelligenceService.js",
  "services/aiSparePartsIntelligenceService.js",
  "ai-tools/sparePartsTools.js",
  "services/aiCustomerIdentityIntelligenceService.js",
  "ai-tools/customerIdentityTools.js",
  "routes/accountingIntelligenceRoutes.js",
]);

const CUSTOMER_ACCOUNTING_EXPERT_PACK = Object.freeze({
  key: "customers_accounting_collections",
  title: "Customers, Receivables, Accounting & Collections Intelligence",
  version: "2026-08-11-source-derived-v1",
  authority: "verified_current_source_contract",
  reviewed_source_lineage: "chalin-one Spare Parts customer, accounting, collections and identity runtime",
  verified_release_commit: CUSTOMER_ACCOUNTING_SOURCE_BASE_COMMIT,
  source_paths: Object.freeze([
    "backend/services/accountingIntelligenceService.js",
    "backend/routes/accountingIntelligenceRoutes.js",
    "backend/services/aiSparePartsIntelligenceService.js",
    "backend/ai-tools/sparePartsTools.js",
    "backend/services/aiCustomerIdentityIntelligenceService.js",
    "backend/ai-tools/customerIdentityTools.js",
  ]),
  facts: Object.freeze([
    Object.freeze({
      key: "customer_sale_receivable_chain",
      statement:
        "In Spare Parts accounting, a sale can create both collected cash and an unpaid balance. Credit or mixed sales increase receivable exposure; later debt payments reduce receivables and improve cash collection but are not a second sale or new revenue event.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.getSalesSummary",
        "accountingIntelligenceService.getDebtSummary",
        "accountingIntelligenceService.buildLedger",
        "aiSparePartsIntelligenceService causal map",
      ]),
    }),
    Object.freeze({
      key: "period_balance_vs_current_debt",
      statement:
        "Selected-period sales balance and current active debt balance are related but different views. Period sales balance measures unpaid value on sales in the selected window, while current debt balance is the active receivable/debt position. They can overlap and must not be blindly added together as separate debt or revenue amounts.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.getSalesSummary",
        "accountingIntelligenceService.getDebtSummary",
        "aiSparePartsIntelligenceService.buildCollectionsHealth",
      ]),
    }),
    Object.freeze({
      key: "debt_aging_control",
      statement:
        "Debt aging is a collection-priority signal. Older balances increase collection risk and should be reviewed by age bucket, but an aging bucket does not by itself prove bad-debt write-off or accounting loss.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.getDebtSummary",
        "accountingIntelligenceService.buildAuditFlags",
      ]),
    }),
    Object.freeze({
      key: "collection_rate_boundary",
      statement:
        "Sales collection rate compares recorded amount paid with recorded sales value for the selected period. A weak collection rate is a cash-conversion/receivables problem; it is not automatically lost profit because a valid receivable can remain collectible.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.getSalesSummary",
        "aiSparePartsIntelligenceService.buildPerformanceDiagnostics",
      ]),
    }),
    Object.freeze({
      key: "management_ledger_boundary",
      statement:
        "Advanced Accounting Intelligence builds a management ledger from operational records. It is explicitly not a certified statutory ledger; stock adjustments, returns and transfer quantities are review/control signals and true statutory accounting requires accountant-reviewed journal and cost rules.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.buildLedger",
      ]),
    }),
    Object.freeze({
      key: "profit_estimate_boundary",
      statement:
        "The current Spare Parts profit-and-loss view reports a management estimate before reliable stock cost. Purchases are an inventory/cash/payables signal, not certified period COGS, so purchases must not be subtracted from sales as if every purchased item was sold in the same period.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.buildProfitAndLoss",
        "aiSparePartsIntelligenceService.buildPerformanceDiagnostics",
      ]),
    }),
    Object.freeze({
      key: "returns_accounting_boundary",
      statement:
        "Returns and refunds create cash, stock and contra-income review effects. The current management estimate does not prove every return is automatically reflected in certified profit, so the original sale and stock correction should be reviewed before a profit conclusion.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.buildLedger",
        "aiSparePartsIntelligenceService.buildPerformanceDiagnostics",
      ]),
    }),
    Object.freeze({
      key: "supplier_balance_boundary",
      statement:
        "Purchase balances represent supplier-payable/cash-commitment pressure. Supplier balances are not customer receivables and should remain separate from customer debt and collections analysis.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.getPurchaseSummary",
        "accountingIntelligenceService.buildAuditFlags",
      ]),
    }),
    Object.freeze({
      key: "aggregate_collections_privacy",
      statement:
        "Governed Spare Parts collections intelligence exposes branch-scoped aggregate debt count, debt balance, debt payments, sales paid/balance, collection rate and aging without customer identities, phone numbers or individual debt rows.",
      source_basis: Object.freeze([
        "aiSparePartsIntelligenceService.buildCollectionsHealth",
        "sparePartsTools collections evidence",
      ]),
    }),
    Object.freeze({
      key: "customer_identity_separate_authority",
      statement:
        "Duplicate-customer intelligence is a separate sensitive Risk-2 suggestion-only path. It can return masked-phone identity suggestions for authorized users but does not merge customers or gain write authority from accounting/collections diagnostics.",
      source_basis: Object.freeze([
        "ai-tools/customerIdentityTools.js",
      ]),
    }),
  ]),
  workflows: Object.freeze([
    Object.freeze({
      key: "sale_to_receivable",
      path: "Customer -> Sale -> Amount Paid + Unpaid Balance -> Receivable/Debt",
      interpretation:
        "Separate recognized sale value from cash collected and unpaid receivable. Do not count the same unpaid balance twice across period-sales and active-debt views.",
    }),
    Object.freeze({
      key: "receivable_to_collection",
      path: "Active Debt -> Aging/Follow-up -> Debt Payment -> Lower Receivable + Higher Cash",
      interpretation:
        "A later debt payment is collection of an existing receivable, not a second sale. Aging prioritizes follow-up but is not automatic write-off evidence.",
    }),
    Object.freeze({
      key: "management_accounting",
      path: "Sales + Collections + Expenses + Purchases + Returns + Stock Controls -> Management Ledger/P&L/Audit Review",
      interpretation:
        "Use the ledger and P&L as management intelligence with explicit cost/control limits, not as a certified statutory ledger or certified profit statement.",
    }),
    Object.freeze({
      key: "identity_governance",
      path: "Customer Identity Records -> Sensitive Duplicate Suggestions -> Human Review -> Separately Authorized Merge Workflow",
      interpretation:
        "Accounting diagnostics stay aggregate. Identity matching remains sensitive and suggestion-only; AI does not merge customer records.",
    }),
    Object.freeze({
      key: "collections_performance",
      path: "Period Sales Balance + Active Debt + Aging + Debt Payments + Collection Rate + Ledger Integrity -> Collections Diagnosis",
      interpretation:
        "Diagnose cash conversion, receivable accumulation, debt aging and accounting-confidence issues separately without double-counting balances.",
    }),
  ]),
  diagnostic_questions: Object.freeze([
    "What share of selected-period sales was actually collected, and what balance remains on those sales?",
    "Is active debt increasing faster than debt payments are reducing it?",
    "Which aging bucket contains the oldest outstanding receivable exposure?",
    "Are period sales balance and current debt balance being mistakenly added together even though they can overlap?",
    "Are later debt payments being mistaken for new sales/revenue?",
    "Does the management ledger show a material debit/credit difference that needs source-record review?",
    "Are supplier purchase balances being mixed with customer receivables?",
    "Is a profit conclusion being made despite the current non-statutory ledger/reliable-COGS warning?",
    "Does the question require aggregate collections evidence or sensitive customer-level identity evidence?",
  ]),
  reasoning_rules: Object.freeze([
    "Never add selected-period sales balance and current active debt balance without evidence they are disjoint; they may overlap.",
    "Never treat a later debt payment as a second sale or new revenue.",
    "Treat collection rate as cash-conversion evidence, not automatic profit/loss.",
    "Treat debt aging as collection-priority/risk evidence, not automatic bad-debt write-off.",
    "Keep customer receivables separate from supplier purchase/payable balances.",
    "Treat the current management ledger and P&L as management intelligence, not certified statutory accounting or certified profit.",
    "For live aggregate collections/accounting questions, use governed branch-scoped Spare Parts evidence.",
    "For customer identity questions, require the separately governed sensitive path; aggregate collections diagnostics must not expose names, phones or individual debt rows.",
    "Never merge customer records from AI suggestion output.",
  ]),
  boundaries: Object.freeze({
    period_sales_balance_may_overlap_current_debt_balance: true,
    debt_payment_is_not_new_sale: true,
    collection_rate_is_cash_conversion_not_profit: true,
    aging_is_not_automatic_writeoff: true,
    supplier_payables_are_not_customer_receivables: true,
    management_ledger_is_not_certified_statutory_ledger: true,
    current_profit_view_is_not_certified_profit: true,
    aggregate_collections_has_no_customer_identity: true,
    duplicate_customer_tool_is_sensitive_suggestion_only: true,
    expert_pack_is_product_knowledge_not_live_customer_data: true,
  }),
});

function runtimePath(relative) {
  return path.resolve(__dirname, "..", relative);
}

function customerAccountingRuntimeAvailability() {
  const files = CUSTOMER_ACCOUNTING_RUNTIME_FILES.map((relative) =>
    Object.freeze({
      path: `backend/${relative}`,
      present: fs.existsSync(runtimePath(relative)),
    })
  );
  const presentCount = files.filter((item) => item.present).length;
  const total = files.length;
  return Object.freeze({
    status:
      presentCount === total
        ? "available_in_current_source_tree"
        : presentCount === 0
          ? "not_present_in_current_source_tree"
          : "partially_present_in_current_source_tree",
    present_file_count: presentCount,
    expected_file_count: total,
    files: Object.freeze(files),
    warning:
      presentCount === total
        ? null
        : "The verified customer/accounting/collections contract is not fully present in this source tree. Explain only the verified design and do not claim missing live diagnostics are executable here.",
  });
}

function isCustomerAccountingExpertPrompt(value) {
  const text = String(value ?? "").trim().slice(0, 16000);
  if (!text) return false;
  if (/\b(?:customer debt|customer debts|customer receivable|customer receivables|accounts receivable|debt aging|debt collection|collections accounting|accounting intelligence|management ledger|customer accounting|credit sales?|debt payment)\b/i.test(text)) {
    return true;
  }
  const customerAnchor = /\b(?:customer|debt|debtor|receivable|collection|credit sale|accounting|ledger)\b/i.test(text);
  const accountingTopic = /\b(?:balance|payment|aging|collection|receivable|credit|ledger|profit|accounting|duplicate|identity)\b/i.test(text);
  return customerAnchor && accountingTopic;
}

function getCustomerAccountingExpertPack({ includeAvailability = true } = {}) {
  return Object.freeze({
    ...CUSTOMER_ACCOUNTING_EXPERT_PACK,
    deployment_availability: includeAvailability ? customerAccountingRuntimeAvailability() : null,
  });
}

module.exports = {
  CUSTOMER_ACCOUNTING_EXPERT_PACK,
  CUSTOMER_ACCOUNTING_RUNTIME_FILES,
  CUSTOMER_ACCOUNTING_SOURCE_BASE_COMMIT,
  customerAccountingRuntimeAvailability,
  getCustomerAccountingExpertPack,
  isCustomerAccountingExpertPrompt,
  runtimePath,
};
