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
  "services/aiCustomerCommercialIntelligenceService.js",
  "ai-tools/customerCommercialTools.js",
  "routes/customerStatementWorkspaceRoutes.js",
  "routes/accountingIntelligenceRoutes.js",
]);

const CUSTOMER_ACCOUNTING_EXPERT_PACK = Object.freeze({
  key: "customers_accounting_collections",
  title: "Customers, Receivables, Accounting & Collections Intelligence",
  version: "2026-08-11-source-derived-v2",
  authority: "verified_current_source_contract",
  reviewed_source_lineage: "chalin-one Spare Parts customer, accounting, collections, statement and identity runtime",
  verified_release_commit: CUSTOMER_ACCOUNTING_SOURCE_BASE_COMMIT,
  source_paths: Object.freeze([
    "backend/services/accountingIntelligenceService.js",
    "backend/routes/accountingIntelligenceRoutes.js",
    "backend/services/aiSparePartsIntelligenceService.js",
    "backend/ai-tools/sparePartsTools.js",
    "backend/services/aiCustomerIdentityIntelligenceService.js",
    "backend/ai-tools/customerIdentityTools.js",
    "backend/services/aiCustomerCommercialIntelligenceService.js",
    "backend/ai-tools/customerCommercialTools.js",
    "backend/routes/customerStatementWorkspaceRoutes.js",
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
      key: "customer_contribution_definition",
      statement:
        "The governed customer commercial ranking defines customer contribution as valid non-void sales value in the selected branch/date period. It is a revenue-contribution ranking, not customer profit, margin or lifetime value. Branch-period sales are the denominator for contribution share.",
      source_basis: Object.freeze([
        "aiCustomerCommercialIntelligenceService.loadTopCustomers",
        "customerStatementWorkspaceRoutes valid-sale and customer summary contracts",
      ]),
    }),
    Object.freeze({
      key: "customer_current_debt_separate_from_period_sales",
      statement:
        "A customer's current outstanding debt is loaded separately from selected-period sales contribution. The commercial 360 can show period sales alongside current open and overdue debt, but these measures must not be added or treated as the same time-basis metric.",
      source_basis: Object.freeze([
        "aiCustomerCommercialIntelligenceService.currentDebtForIdentity",
        "aiCustomerCommercialIntelligenceService.loadCustomerAccount",
        "customerStatementWorkspaceRoutes debt balance contract",
      ]),
    }),
    Object.freeze({
      key: "customer_exact_identity_only",
      statement:
        "Customer commercial 360 resolves a customer by exact customer ID or exact name/phone reference. It does not fuzzy-select a person. Multiple exact identities are returned as ambiguous candidates for clarification, and phone numbers are masked in AI evidence.",
      source_basis: Object.freeze([
        "aiCustomerCommercialIntelligenceService.exactCustomerCandidates",
        "customerCommercialTools exact_identity_resolution_only evidence metadata",
      ]),
    }),
    Object.freeze({
      key: "customer_commercial_sensitive_read",
      statement:
        "Customer commercial 360 is a read-only Risk-1 observation path with a separate sensitive-data gate. It requires ai.read_sensitive plus Spare Parts audit authority, remains branch-scoped, masks phone numbers and has no customer merge, debt mutation or sales-write authority.",
      source_basis: Object.freeze([
        "customerCommercialTools required permissions and Risk-1 registration",
        "aiCustomerCommercialIntelligenceService execution_authority",
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
        "Governed Spare Parts collections intelligence exposes branch-scoped aggregate debt count, debt balance, debt payments, sales paid/balance, collection rate and aging without customer identities, phone numbers or individual debt rows. Customer-level questions use the separately permissioned sensitive commercial 360 path.",
      source_basis: Object.freeze([
        "aiSparePartsIntelligenceService.buildCollectionsHealth",
        "sparePartsTools collections evidence",
        "customerCommercialTools",
      ]),
    }),
    Object.freeze({
      key: "customer_identity_separate_authority",
      statement:
        "Duplicate-customer intelligence is a separate sensitive Risk-2 suggestion-only path. It can return masked-phone identity suggestions for authorized users but does not merge customers or gain write authority from accounting/collections diagnostics or customer commercial reads.",
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
      key: "customer_contribution_to_360",
      path: "Valid Branch Sales -> Customer Contribution Ranking -> Exact Customer Identity -> Selected-Period Purchases + Current Debt",
      interpretation:
        "Rank by valid sales value only. Once a customer is selected, keep the activity period and current receivable snapshot explicit; contribution is not profit and current debt is not added to sales.",
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
        "Commercial/customer reads do not merge identities. Duplicate matching remains sensitive and suggestion-only; AI does not merge customer records.",
    }),
    Object.freeze({
      key: "collections_performance",
      path: "Period Sales Balance + Active Debt + Aging + Debt Payments + Collection Rate + Ledger Integrity -> Collections Diagnosis",
      interpretation:
        "Diagnose cash conversion, receivable accumulation, debt aging and accounting-confidence issues separately without double-counting balances.",
    }),
  ]),
  diagnostic_questions: Object.freeze([
    "Which customer contributed the most valid sales value in the selected period, and what share of branch sales did that represent?",
    "For that exact customer, what is the current outstanding and overdue debt, and what did they buy in the selected activity period?",
    "What share of selected-period sales was actually collected, and what balance remains on those sales?",
    "Is active debt increasing faster than debt payments are reducing it?",
    "Which aging bucket contains the oldest outstanding receivable exposure?",
    "Are period sales balance and current debt balance being mistakenly added together even though they can overlap?",
    "Are later debt payments being mistaken for new sales/revenue?",
    "Does the management ledger show a material debit/credit difference that needs source-record review?",
    "Are supplier purchase balances being mixed with customer receivables?",
    "Is a profit conclusion being made despite the current non-statutory ledger/reliable-COGS warning?",
    "Does the question require aggregate collections evidence or separately permissioned sensitive customer-level evidence?",
  ]),
  reasoning_rules: Object.freeze([
    "Define customer contribution as valid sales value in the selected branch/date period unless the user explicitly asks for another supported ranking basis.",
    "Never call the highest-sales customer the most profitable customer unless reliable customer-level cost evidence exists.",
    "Keep selected-period customer sales and current open debt on separate time bases; do not add them together.",
    "Resolve customer commercial reads by exact identity only; return ambiguity instead of fuzzy-guessing a person.",
    "Mask customer phone numbers in AI evidence and require the sensitive-read plus Spare Parts audit permission gates for customer-level commercial evidence.",
    "Never add selected-period sales balance and current active debt balance without evidence they are disjoint; they may overlap.",
    "Never treat a later debt payment as a second sale or new revenue.",
    "Treat collection rate as cash-conversion evidence, not automatic profit/loss.",
    "Treat debt aging as collection-priority/risk evidence, not automatic bad-debt write-off.",
    "Keep customer receivables separate from supplier purchase/payable balances.",
    "Treat the current management ledger and P&L as management intelligence, not certified statutory accounting or certified profit.",
    "For live aggregate collections/accounting questions, use governed branch-scoped Spare Parts evidence.",
    "For customer-level commercial questions, use the separately governed sensitive customer 360 path; aggregate collections diagnostics must not expose names, phones or individual debt rows.",
    "Never merge customer records from AI suggestion output or commercial-read output.",
  ]),
  boundaries: Object.freeze({
    customer_contribution_is_valid_sales_value_not_profit: true,
    customer_current_debt_is_separate_from_period_sales: true,
    customer_commercial_identity_resolution_is_exact_only: true,
    customer_commercial_phone_numbers_are_masked: true,
    customer_commercial_read_requires_sensitive_authority: true,
    customer_commercial_read_has_no_write_or_merge_authority: true,
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
  if (/\b(?:customer debt|customer debts|customer receivable|customer receivables|accounts receivable|debt aging|debt collection|collections accounting|accounting intelligence|management ledger|customer accounting|credit sales?|debt payment|top customer|top customers|customer contribution|customer purchase history|customer commercial|customer 360)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:which|what)\s+customer\b[\s\S]{0,80}\b(?:contributed|bought|purchased|spent|owes?|owing|debt|sales?)\b/i.test(text)) {
    return true;
  }
  const customerAnchor = /\b(?:customer|debt|debtor|receivable|collection|credit sale|accounting|ledger)\b/i.test(text);
  const accountingTopic = /\b(?:balance|payment|aging|collection|receivable|credit|ledger|profit|accounting|duplicate|identity|contribution|purchase|bought|owes?|owing|sales?)\b/i.test(text);
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
