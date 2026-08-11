"use strict";

const {
  buildCollectionsHealth,
} = require("./aiSparePartsIntelligenceService");

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((asNumber(value) + Number.EPSILON) * factor) / factor;
}

function normalizedBucketName(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function oldDebtAging(aging = []) {
  const rows = Array.isArray(aging) ? aging : [];
  return rows.reduce(
    (accumulator, row) => {
      const name = normalizedBucketName(row?.bucket);
      const isOld = /(?:61|90|over|above|older|120|180)/.test(name);
      if (!isOld) return accumulator;
      accumulator.count += asNumber(row?.count);
      accumulator.total += asNumber(row?.total);
      return accumulator;
    },
    { count: 0, total: 0 }
  );
}

function buildCustomerAccountingCollectionsDiagnostics(intelligence = {}, context = {}) {
  const collectionsHealth = buildCollectionsHealth(intelligence, context);
  const collections = collectionsHealth.collections || {};
  const sales = intelligence.sales || {};
  const debts = intelligence.debts || {};
  const purchases = intelligence.purchases || {};
  const pnl = intelligence.profit_and_loss || {};
  const audit = intelligence.audit || {};

  const salesTotal = asNumber(collections.sales_total);
  const salesPaid = asNumber(collections.sales_paid);
  const periodSalesBalance = asNumber(collections.sales_balance);
  const activeDebtBalance = asNumber(collections.total_debt_balance);
  const newDebtAmount = asNumber(collections.new_debt_amount);
  const debtPayments = asNumber(collections.debt_payments);
  const collectionRate = asNumber(collections.collection_rate);
  const activeDebtCount = asNumber(collections.active_debt_count);
  const oldDebt = oldDebtAging(collections.aging);
  const supplierBalance = asNumber(purchases.balance);
  const estimatedNet = asNumber(pnl.estimated_net_before_stock_cost);

  const periodBalanceShare = salesTotal > 0
    ? round((periodSalesBalance / salesTotal) * 100)
    : 0;
  const debtPaymentCoverage = newDebtAmount > 0
    ? round((debtPayments / newDebtAmount) * 100)
    : null;
  const oldDebtShare = activeDebtBalance > 0
    ? round((oldDebt.total / activeDebtBalance) * 100)
    : 0;

  const drivers = [];
  function addDriver({ key, category, severity = "info", effect, explanation, evidence }) {
    drivers.push(Object.freeze({ key, category, severity, effect, explanation, evidence }));
  }

  if (salesTotal > 0 && collectionRate < 90) {
    addDriver({
      key: "period_collection_pressure",
      category: "cash_conversion",
      severity: collectionRate < 70 ? "danger" : "warning",
      effect: "cash_conversion_pressure",
      explanation: `The selected-period sales collection rate is ${round(collectionRate)}%, with GHS ${round(periodSalesBalance).toFixed(2)} still unpaid on sales in the period. This is receivables/cash-conversion pressure, not automatic lost profit.`,
      evidence: {
        sales_total: round(salesTotal),
        sales_paid: round(salesPaid),
        period_sales_balance: round(periodSalesBalance),
        collection_rate: round(collectionRate),
        period_sales_balance_share_percent: periodBalanceShare,
      },
    });
  }

  if (activeDebtBalance > 0) {
    addDriver({
      key: "active_receivables_pressure",
      category: "receivables",
      severity: oldDebtShare >= 30 ? "danger" : "warning",
      effect: "working_cash_and_credit_risk",
      explanation: `${activeDebtCount} active debt record(s) carry GHS ${round(activeDebtBalance).toFixed(2)} of current receivable exposure. This current debt position can overlap selected-period sales balance and must not be blindly added to it as a second independent debt amount.`,
      evidence: {
        active_debt_count: activeDebtCount,
        total_debt_balance: round(activeDebtBalance),
        period_sales_balance: round(periodSalesBalance),
        balances_may_overlap: true,
      },
    });
  }

  if (newDebtAmount > 0 && debtPayments < newDebtAmount) {
    addDriver({
      key: "new_debt_outpacing_debt_payments",
      category: "collections",
      severity: debtPaymentCoverage != null && debtPaymentCoverage < 50 ? "danger" : "warning",
      effect: "receivable_accumulation_pressure",
      explanation: `New debt created in the selected period is GHS ${round(newDebtAmount).toFixed(2)}, while debt payments are GHS ${round(debtPayments).toFixed(2)}${debtPaymentCoverage == null ? "" : ` (${debtPaymentCoverage}% of new debt)`}. Later debt payments reduce receivables and improve cash; they are not new sales.`,
      evidence: {
        new_debt_amount: round(newDebtAmount),
        debt_payments: round(debtPayments),
        debt_payment_to_new_debt_reference_percent: debtPaymentCoverage,
      },
    });
  }

  if (oldDebt.count > 0 || oldDebt.total > 0) {
    addDriver({
      key: "aged_receivables_pressure",
      category: "aging",
      severity: oldDebtShare >= 30 ? "danger" : "warning",
      effect: "collection_priority_pressure",
      explanation: `${oldDebt.count} aged debt record(s) total GHS ${round(oldDebt.total).toFixed(2)} in the older configured aging buckets${activeDebtBalance > 0 ? `, ${oldDebtShare}% of current active debt balance` : ""}. Aging prioritizes collection follow-up but does not by itself prove bad-debt write-off or accounting loss.`,
      evidence: {
        older_debt_count: oldDebt.count,
        older_debt_total: round(oldDebt.total),
        older_debt_share_percent: oldDebtShare,
      },
    });
  }

  if (debtPayments > 0) {
    addDriver({
      key: "debt_collection_activity",
      category: "collections",
      severity: "info",
      effect: "cash_and_receivable_improvement",
      explanation: `GHS ${round(debtPayments).toFixed(2)} of debt payments were recorded in the selected period. These are collections against existing receivables and must not be counted again as new sales revenue.`,
      evidence: { debt_payments: round(debtPayments) },
    });
  }

  if (supplierBalance > 0) {
    addDriver({
      key: "supplier_payable_commitment",
      category: "payables",
      severity: "review",
      effect: "cash_commitment_separate_from_customer_receivables",
      explanation: `GHS ${round(supplierBalance).toFixed(2)} of purchase balance is recorded. This is supplier-payable/cash-commitment pressure and must remain separate from customer debt/receivables.`,
      evidence: { purchase_balance: round(supplierBalance) },
    });
  }

  const auditScore = asNumber(audit.audit_score);
  if (auditScore > 0 && auditScore < 80) {
    addDriver({
      key: "accounting_control_review",
      category: "accounting_confidence",
      severity: auditScore < 60 ? "danger" : "warning",
      effect: "management_evidence_confidence_pressure",
      explanation: `The current accounting audit score is ${round(auditScore)}. Resolve accounting/control flags before relying on management estimates as clean evidence. The management ledger and P&L remain non-statutory intelligence rather than certified accounts.`,
      evidence: {
        audit_score: round(auditScore),
        audit_status: String(audit.audit_status || "unknown").slice(0, 60),
      },
    });
  }

  if (drivers.length === 0) {
    addDriver({
      key: "no_major_collections_exception",
      category: "overall",
      severity: "info",
      effect: "no_obvious_aggregate_driver",
      explanation: "The current branch/date aggregate does not show a major configured customer-collections exception. A deeper conclusion may require another period for comparison or separately authorized customer-level evidence.",
      evidence: {
        sales_total: round(salesTotal),
        collection_rate: round(collectionRate),
        active_debt_count: activeDebtCount,
        total_debt_balance: round(activeDebtBalance),
      },
    });
  }

  const severityOrder = { danger: 0, warning: 1, review: 2, info: 3 };
  drivers.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  return {
    scope: collectionsHealth.scope,
    performance_view: {
      sales_total: round(salesTotal),
      sales_paid: round(salesPaid),
      period_sales_balance: round(periodSalesBalance),
      period_sales_balance_share_percent: periodBalanceShare,
      collection_rate: round(collectionRate),
      active_debt_count: activeDebtCount,
      total_debt_balance: round(activeDebtBalance),
      new_debt_amount: round(newDebtAmount),
      debt_payments: round(debtPayments),
      debt_payment_to_new_debt_reference_percent: debtPaymentCoverage,
      aging: collections.aging || [],
      older_debt_count: oldDebt.count,
      older_debt_total: round(oldDebt.total),
      older_debt_share_percent: oldDebtShare,
      supplier_purchase_balance: round(supplierBalance),
      management_net_estimate_before_reliable_cogs: round(estimatedNet),
      audit_score: round(auditScore),
      audit_status: String(audit.audit_status || "unknown").slice(0, 60),
    },
    drivers,
    causal_map: {
      sale_to_receivable: "sale -> amount paid + unpaid period balance -> receivable/debt",
      collection: "existing receivable/debt -> debt payment -> lower receivable + higher cash; no second sale",
      aging: "older unpaid balance -> higher follow-up priority/collection risk; not automatic write-off",
      accounting: "operational records -> management ledger/P&L/audit review; not certified statutory accounts",
      identity: "aggregate accounting does not expose customer identity; duplicate matching is separately sensitive and suggestion-only",
    },
    certainty: {
      customer_identity_included: false,
      phone_numbers_included: false,
      individual_debt_rows_included: false,
      period_sales_balance_may_overlap_current_debt_balance: true,
      balances_must_not_be_double_counted: true,
      debt_payment_is_not_new_sale: true,
      collection_rate_is_cash_conversion_not_profit: true,
      aging_is_not_automatic_writeoff: true,
      supplier_payables_are_not_customer_receivables: true,
      management_ledger_is_not_certified_statutory_ledger: true,
      certified_profit_available: false,
      warning: String(
        pnl.warning ||
          "This is branch-scoped aggregate customer/accounting/collections intelligence. Do not double-count period sales balance with current debt, do not count debt payments as new sales, and do not present the management ledger/P&L estimate as certified statutory accounts or certified profit."
      ).slice(0, 1000),
    },
    recommendations: collectionsHealth.recommendations || [],
    generated_at: collectionsHealth.generated_at || new Date().toISOString(),
  };
}

module.exports = {
  buildCustomerAccountingCollectionsDiagnostics,
  oldDebtAging,
  round,
};
