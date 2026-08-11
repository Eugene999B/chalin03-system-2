"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SPARE_PARTS_SOURCE_BASE_COMMIT = "f4d447eef028c62a2f3034d0de1bde4aa98ed34e";

const SPARE_PARTS_RUNTIME_FILES = Object.freeze([
  "services/accountingIntelligenceService.js",
  "services/aiSparePartsIntelligenceService.js",
  "ai-tools/sparePartsTools.js",
]);

const SPARE_PARTS_EXPERT_PACK = Object.freeze({
  key: "spare_parts_operations",
  title: "Spare Parts Operations & Commercial Intelligence",
  version: "2026-08-11-source-derived-v1",
  authority: "verified_current_source_contract",
  reviewed_source_lineage: "chalin-one Spare Parts accounting/intelligence runtime",
  verified_release_commit: SPARE_PARTS_SOURCE_BASE_COMMIT,
  source_paths: Object.freeze([
    "backend/services/accountingIntelligenceService.js",
    "backend/services/aiSparePartsIntelligenceService.js",
    "backend/ai-tools/sparePartsTools.js",
    "backend/ai-tools/customerIdentityTools.js",
  ]),
  facts: Object.freeze([
    Object.freeze({
      key: "sale_payment_debt_chain",
      statement:
        "A Spare Parts sale creates revenue and records how much was paid versus left as balance. The sales collection rate is total paid divided by total sales. Outstanding customer debt is tracked separately in debts, and later debt payments reduce receivables and improve cash collection without creating a second sale.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.getSalesSummary",
        "accountingIntelligenceService.getDebtSummary",
        "accountingIntelligenceService.getDebtPaymentTotal",
      ]),
    }),
    Object.freeze({
      key: "inventory_valuation",
      statement:
        "Inventory health is branch-scoped and derives product quantity, low/negative stock signals, estimated stock cost value from quantity multiplied by the available cost-price field, and estimated retail value from quantity multiplied by the selling-price field.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.getStockSummary",
        "aiSparePartsIntelligenceService.buildInventoryHealth",
      ]),
    }),
    Object.freeze({
      key: "stock_movement_sources",
      statement:
        "CHALIN does not treat the Stock Movement Ledger as an independent source table. It is reconstructed from sales, purchases, returns, stock adjustments and stock transfers; investigations should therefore trace those source records when stock does not balance.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.buildReviewSummary.stock_movement_ledger_note",
        "accountingIntelligenceService.buildAccountingIntelligence stock_movement_ledger_note",
      ]),
    }),
    Object.freeze({
      key: "purchases_are_not_cogs",
      statement:
        "Purchases are an inventory-acquisition and supplier/cash signal. The current management accounting layer does not equate period purchases with certified cost of goods sold; true profit requires reliable cost history and COGS rules.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.buildLedger",
        "accountingIntelligenceService.buildProfitAndLoss",
        "accountingIntelligenceService.buildRecommendations improve true profit tracking",
      ]),
    }),
    Object.freeze({
      key: "profit_estimate_boundary",
      statement:
        "The current management P&L computes gross sales, discounts, net sales, operating expenses, an estimated net figure before stock cost, and a conservative cash position. It explicitly warns that this is not true profit until reliable COGS is available.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.buildProfitAndLoss",
      ]),
    }),
    Object.freeze({
      key: "returns_and_refunds",
      statement:
        "Returns/refunds are review signals that affect cash and stock and appear as contra-income/review signals in the management ledger. On this source lineage, the estimated P&L must not be described as automatically subtracting every return/refund; returns should be reviewed separately against the original sale and stock correction.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.buildLedger Returns / Refund Signals",
        "accountingIntelligenceService.buildReviewSummary returns",
        "accountingIntelligenceService.buildProfitAndLoss",
      ]),
    }),
    Object.freeze({
      key: "collections_vs_profit",
      statement:
        "Collection rate and debt aging primarily explain cash conversion and receivables risk, not accounting profit by themselves. Low collections can leave the business cash-poor even when sales revenue is high.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.getSalesSummary.collection_rate",
        "accountingIntelligenceService.getDebtSummary.aging",
        "accountingIntelligenceService.buildLedger Accounts Receivable",
      ]),
    }),
    Object.freeze({
      key: "stock_control_risk",
      statement:
        "Manual stock decreases/sets, damaged/lost adjustments, dispatched-but-not-received transfers, quantity mismatches and negative stock are control signals that can indicate shrinkage, timing or data-quality problems and should be investigated before trusting performance conclusions.",
      source_basis: Object.freeze([
        "accountingIntelligenceService.getStockAdjustmentSummary",
        "accountingIntelligenceService.getStockTransferSummary",
        "accountingIntelligenceService.buildAuditFlags",
      ]),
    }),
    Object.freeze({
      key: "branch_scoped_live_intelligence",
      statement:
        "Spare Parts AI live intelligence is branch-scoped, date-bounded and aggregate by default. The operations snapshot exposes sales, collections, inventory, expenses, purchases, returns and audit health without raw customer rows; sensitive customer identity analysis uses a separate governed tool and remains suggestion-only.",
      source_basis: Object.freeze([
        "aiSparePartsIntelligenceService.buildScopedAccountingRequest",
        "sparePartsTools.spare_parts.operations_snapshot",
        "customerIdentityTools.spare_parts.duplicate_customer_suggestions",
      ]),
    }),
  ]),
  workflows: Object.freeze([
    Object.freeze({
      key: "customer_to_cash",
      path: "Customer -> Sale -> Payment and/or Balance -> Debt -> Debt Payment -> Receivables/Cash",
      interpretation:
        "A sale is revenue activity; later debt collection is cash/receivables movement and must not be counted as another sale.",
    }),
    Object.freeze({
      key: "product_to_margin",
      path: "Product -> Purchase/Cost History -> Stock -> Sale -> Revenue -> COGS requirement -> Margin/Profit",
      interpretation:
        "Revenue alone cannot establish true profit. Reliable product cost history and COGS rules are required before claiming a certified margin or profit figure.",
    }),
    Object.freeze({
      key: "return_reversal",
      path: "Original Sale -> Return/Refund -> Cash Reversal Signal -> Stock Correction -> Contra-Income Review",
      interpretation:
        "A return should remain linked conceptually to the original sale and its stock/cash reversal evidence rather than being treated as a new independent sale event.",
    }),
    Object.freeze({
      key: "stock_control",
      path: "Purchase/Sale/Return -> Stock -> Adjustment/Transfer -> Physical/Branch Availability -> Audit Signals",
      interpretation:
        "Stock changes must reconcile through their source movements; manual adjustments and transfer mismatches are investigation signals.",
    }),
    Object.freeze({
      key: "branch_performance",
      path: "Sales + Discounts + Expenses + Returns + Collections/Debt + Purchases/Stock + Control Signals -> Management Performance Diagnosis",
      interpretation:
        "Separate revenue/profit pressure from cash-flow pressure, stock availability and data-quality/control risk before recommending action.",
    }),
  ]),
  diagnostic_questions: Object.freeze([
    "Are sales genuinely low, or are discounts reducing net sales?",
    "Are operating expenses unusually high relative to sales?",
    "Are returns/refunds materially reversing sales cash or stock?",
    "Is low collection rate creating a cash-flow problem even if revenue is acceptable?",
    "Is outstanding or aged debt preventing sales from converting into cash?",
    "Are purchases consuming cash because stock is being rebuilt, and are those purchases being incorrectly mistaken for COGS?",
    "Is stock availability limiting sales, or are low/negative stock records a data-quality problem?",
    "Are manual adjustments, transfer mismatches or dispatched-not-received transfers creating shrinkage/control risk?",
    "Is the user asking for true profit when the current source lineage only has a management estimate before reliable COGS?",
  ]),
  reasoning_rules: Object.freeze([
    "Never equate sales with profit.",
    "Never equate purchases with cost of goods sold unless reliable COGS evidence is explicitly available.",
    "Separate profit/revenue pressure from cash-flow/collection pressure.",
    "Treat returns/refunds as reversal signals that require original-sale and stock/cash review.",
    "Treat stock adjustments and transfer mismatches as control/data-quality signals before assuming commercial causes.",
    "For a live branch/date question, use governed live tools; do not answer from this static expert pack alone.",
    "State when a conclusion is a management estimate rather than certified accounting profit.",
  ]),
  boundaries: Object.freeze({
    aggregate_live_tools_are_branch_scoped: true,
    customer_identity_is_separate_sensitive_boundary: true,
    purchases_are_not_certified_cogs: true,
    current_profit_is_management_estimate_before_reliable_cogs: true,
    expert_pack_is_product_knowledge_not_live_business_data: true,
  }),
});

function runtimePath(relative) {
  return path.resolve(__dirname, "..", relative);
}

function sparePartsRuntimeAvailability() {
  const files = SPARE_PARTS_RUNTIME_FILES.map((relative) =>
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
        : "The verified Spare Parts expert contract is not fully present in this source tree. Explain only the verified design and do not claim missing live diagnostics are executable here.",
  });
}

function isSparePartsExpertPrompt(value) {
  const text = String(value ?? "").trim().slice(0, 16000);
  if (!text) return false;
  if (
    /\b(?:spare parts|stock adjustment|stock transfer|daily closing|customer debt|credit sale|low stock|negative stock)\b/i.test(
      text
    )
  ) {
    return true;
  }
  const operationalTopic = /\b(?:stock|inventory|sales?|sold|selling|purchase|supplier|collections?|returns?|refunds?|profit|margin|receivables?)\b/i.test(
    text
  );
  const sparePartsAnchor = /\b(?:store|branch|parts?|product|supplier|customer|inventory|stock)\b/i.test(
    text
  );
  return operationalTopic && sparePartsAnchor;
}

function getSparePartsExpertPack({ includeAvailability = true } = {}) {
  return Object.freeze({
    ...SPARE_PARTS_EXPERT_PACK,
    deployment_availability: includeAvailability
      ? sparePartsRuntimeAvailability()
      : null,
  });
}

module.exports = {
  SPARE_PARTS_EXPERT_PACK,
  SPARE_PARTS_RUNTIME_FILES,
  SPARE_PARTS_SOURCE_BASE_COMMIT,
  getSparePartsExpertPack,
  isSparePartsExpertPrompt,
  runtimePath,
  sparePartsRuntimeAvailability,
};
