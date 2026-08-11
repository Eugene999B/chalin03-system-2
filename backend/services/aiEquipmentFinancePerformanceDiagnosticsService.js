"use strict";

const {
  loadArrearsHealth,
  loadCashFlowHealth,
  loadPortfolioHealth,
  loadSalesPipelineHealth,
} = require("./aiEquipmentFinanceIntelligenceService");

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((asNumber(value) + Number.EPSILON) * factor) / factor;
}

function agingBucket(rows = [], key) {
  return (Array.isArray(rows) ? rows : []).find(
    (row) => String(row?.bucket || row?.aging_bucket || "") === key
  ) || {};
}

function buildEquipmentFinancePerformanceDiagnostics({
  portfolio = {},
  arrears = {},
  cashflow = {},
  salesPipeline = {},
} = {}) {
  const summary = portfolio.summary || {};
  const applications = portfolio.applications || salesPipeline.applications || {};
  const salesInventory = portfolio.sales_inventory || salesPipeline.sales_inventory || {};
  const arrearsSummary = arrears.summary || {};
  const cashTotals = cashflow.totals || {};

  const outstandingBalance = asNumber(summary.outstanding_balance);
  const overdueBalance = asNumber(summary.overdue_balance);
  const overdueShare = outstandingBalance > 0
    ? round((overdueBalance / outstandingBalance) * 100)
    : 0;
  const portfolioValue = asNumber(summary.portfolio_value);
  const outstandingShare = portfolioValue > 0
    ? round((outstandingBalance / portfolioValue) * 100)
    : 0;
  const saleCapableAssets = asNumber(salesInventory.sale_capable_assets);
  const maintenanceAssets = asNumber(salesInventory.maintenance_or_breakdown);
  const maintenanceShare = saleCapableAssets > 0
    ? round((maintenanceAssets / saleCapableAssets) * 100)
    : null;
  const over90 = agingBucket(arrears.aging, "over_90");
  const over90Arrears = asNumber(over90.arrears || over90.overdue_amount);
  const over90Accounts = asNumber(over90.accounts || over90.agreements);
  const cashReference = cashTotals.collection_vs_open_schedule_percent == null
    ? null
    : asNumber(cashTotals.collection_vs_open_schedule_percent);

  const drivers = [];
  function addDriver({ key, category, severity = "info", effect, explanation, evidence }) {
    drivers.push(Object.freeze({ key, category, severity, effect, explanation, evidence }));
  }

  if (asNumber(summary.reconciliation_attention_count) > 0) {
    addDriver({
      key: "reconciliation_attention",
      category: "ledger_integrity",
      severity: "danger",
      effect: "balance_reliability_pressure",
      explanation: `${asNumber(summary.reconciliation_attention_count)} Finance agreement(s) require reconciliation attention. Resolve ledger/schedule/payment mismatches before treating derived balances as clean management evidence.`,
      evidence: {
        reconciliation_attention_count: asNumber(summary.reconciliation_attention_count),
      },
    });
  }

  if (asNumber(summary.overdue_count) > 0 || overdueBalance > 0) {
    addDriver({
      key: "overdue_portfolio_pressure",
      category: "arrears",
      severity: overdueShare >= 25 ? "danger" : "warning",
      effect: "delinquency_pressure",
      explanation: `${asNumber(summary.overdue_count)} Finance account(s) are overdue with GHS ${round(overdueBalance).toFixed(2)} overdue${outstandingBalance > 0 ? `, equal to ${overdueShare}% of current outstanding balance` : ""}. Overdue is delinquent exposure within outstanding balance and must not be added to outstanding as a second balance.`,
      evidence: {
        overdue_count: asNumber(summary.overdue_count),
        overdue_balance: round(overdueBalance),
        outstanding_balance: round(outstandingBalance),
        overdue_share_of_outstanding_percent: overdueShare,
      },
    });
  }

  if (over90Accounts > 0 || over90Arrears > 0) {
    addDriver({
      key: "aged_arrears_pressure",
      category: "arrears",
      severity: "danger",
      effect: "old_debt_collection_pressure",
      explanation: `${over90Accounts} Finance account(s) have arrears in the over-90-day bucket with GHS ${round(over90Arrears).toFixed(2)} calculated arrears. This is the oldest aggregate delinquency signal and should be prioritized for controlled collections review.`,
      evidence: {
        over_90_accounts: over90Accounts,
        over_90_arrears: round(over90Arrears),
      },
    });
  }

  if (cashReference != null && asNumber(cashTotals.expected_open_schedule_amount) > 0 && cashReference < 80) {
    addDriver({
      key: "cash_conversion_reference_pressure",
      category: "collections",
      severity: cashReference < 60 ? "danger" : "warning",
      effect: "cash_conversion_pressure",
      explanation: `Actual Finance collections are ${round(cashReference)}% of the open scheduled-amount reference for the selected period. This is a cash-conversion reference only, not a certified accounting collection rate, revenue margin or profit measure.`,
      evidence: {
        collected_amount: round(cashTotals.collected_amount),
        expected_open_schedule_amount: round(cashTotals.expected_open_schedule_amount),
        collection_vs_open_schedule_percent: round(cashReference),
      },
    });
  }

  if (asNumber(applications.under_review_count) > 0) {
    addDriver({
      key: "application_review_backlog",
      category: "credit_pipeline",
      severity: "review",
      effect: "credit_conversion_timing_pressure",
      explanation: `${asNumber(applications.under_review_count)} credit application(s) are under review. This is a decision-pipeline backlog signal, not evidence that those applications should be approved.`,
      evidence: {
        under_review_count: asNumber(applications.under_review_count),
      },
    });
  }

  if (asNumber(applications.changes_requested_count) > 0) {
    addDriver({
      key: "application_changes_backlog",
      category: "credit_pipeline",
      severity: "warning",
      effect: "application_completion_pressure",
      explanation: `${asNumber(applications.changes_requested_count)} credit application(s) are waiting for requested changes, which can delay the credit-decision pipeline without implying an approval outcome.`,
      evidence: {
        changes_requested_count: asNumber(applications.changes_requested_count),
      },
    });
  }

  if (asNumber(applications.kyc_pending_count) > 0) {
    addDriver({
      key: "kyc_completion_pressure",
      category: "credit_control",
      severity: "review",
      effect: "application_readiness_pressure",
      explanation: `${asNumber(applications.kyc_pending_count)} credit application(s) have KYC not yet verified. KYC completion is a control/readiness signal and must not be bypassed to improve conversion numbers.`,
      evidence: {
        kyc_pending_count: asNumber(applications.kyc_pending_count),
        kyc_verified_count: asNumber(applications.kyc_verified_count),
      },
    });
  }

  if (asNumber(applications.affordability_manual_review_count) > 0) {
    addDriver({
      key: "affordability_manual_review",
      category: "credit_control",
      severity: "review",
      effect: "manual_credit_review_pressure",
      explanation: `${asNumber(applications.affordability_manual_review_count)} application(s) require manual affordability review. This is a credit-control workload signal, not permission for AI to approve or override affordability decisions.`,
      evidence: {
        affordability_manual_review_count: asNumber(applications.affordability_manual_review_count),
      },
    });
  }

  if (asNumber(applications.high_risk_count) > 0) {
    addDriver({
      key: "high_risk_application_exposure",
      category: "credit_risk",
      severity: "warning",
      effect: "credit_risk_pressure",
      explanation: `${asNumber(applications.high_risk_count)} application(s) are classified high or critical risk. This is aggregate credit-risk exposure and does not identify or automatically decline any customer.`,
      evidence: {
        high_risk_count: asNumber(applications.high_risk_count),
      },
    });
  }

  if (saleCapableAssets > 0 && asNumber(salesInventory.available_for_sale) === 0) {
    addDriver({
      key: "no_available_sale_assets",
      category: "sales_inventory",
      severity: "warning",
      effect: "equipment_conversion_constraint",
      explanation: `There are ${saleCapableAssets} active sale-capable asset(s) but none currently marked available for a new Finance sale. Review held-for-Finance, sold and maintenance/breakdown states before treating weak conversion as a demand problem.`,
      evidence: {
        sale_capable_assets: saleCapableAssets,
        available_for_sale: asNumber(salesInventory.available_for_sale),
        held_for_finance: asNumber(salesInventory.held_for_finance),
        sold_assets: asNumber(salesInventory.sold_assets),
        maintenance_or_breakdown: maintenanceAssets,
      },
    });
  }

  if (maintenanceShare != null && maintenanceAssets > 0 && maintenanceShare >= 20) {
    addDriver({
      key: "sale_inventory_maintenance_pressure",
      category: "sales_inventory",
      severity: maintenanceShare >= 35 ? "danger" : "warning",
      effect: "sale_inventory_readiness_pressure",
      explanation: `${maintenanceAssets} sale-capable asset(s), ${maintenanceShare}% of the active sale-capable fleet count, are in maintenance/breakdown status. This can constrain equipment availability but does not prove credit-demand weakness or Finance profit loss.`,
      evidence: {
        sale_capable_assets: saleCapableAssets,
        maintenance_or_breakdown: maintenanceAssets,
        maintenance_share_percent: maintenanceShare,
      },
    });
  }

  if (drivers.length === 0) {
    addDriver({
      key: "no_major_aggregate_exception",
      category: "overall",
      severity: "info",
      effect: "no_obvious_aggregate_driver",
      explanation: "The current company-wide Finance aggregates do not show a major configured exception. A deeper root-cause answer would require another period for comparison or separately authorized detail beyond these aggregate tools.",
      evidence: {
        agreement_count: asNumber(summary.agreement_count),
        portfolio_value: round(portfolioValue),
        outstanding_balance: round(outstandingBalance),
        overdue_balance: round(overdueBalance),
      },
    });
  }

  const severityOrder = { danger: 0, warning: 1, review: 2, info: 3 };
  drivers.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  return {
    scope: {
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
      hire_location_selection_required: false,
      date_from: portfolio.scope?.date_from || cashflow.scope?.date_from || null,
      date_to: portfolio.scope?.date_to || cashflow.scope?.date_to || arrears.scope?.as_of || null,
    },
    performance_view: {
      agreement_count: asNumber(summary.agreement_count),
      active_count: asNumber(summary.active_count),
      completed_count: asNumber(summary.completed_count),
      overdue_count: asNumber(summary.overdue_count),
      portfolio_value: round(portfolioValue),
      deposits_received: round(summary.deposits_received),
      lifetime_collections: round(summary.lifetime_collections),
      period_collections: round(summary.period_collections),
      outstanding_balance: round(outstandingBalance),
      outstanding_share_of_portfolio_percent: outstandingShare,
      overdue_balance: round(overdueBalance),
      overdue_share_of_outstanding_percent: overdueShare,
      average_paid_percent: round(summary.average_paid_percent),
      reconciliation_attention_count: asNumber(summary.reconciliation_attention_count),
      arrears_accounts: asNumber(arrearsSummary.accounts),
      calculated_arrears: round(arrearsSummary.arrears),
      arrears_aging: Array.isArray(arrears.aging) ? arrears.aging : [],
      cash_collected_amount: round(cashTotals.collected_amount),
      expected_open_schedule_amount: round(cashTotals.expected_open_schedule_amount),
      collection_vs_open_schedule_percent: cashReference == null ? null : round(cashReference),
      application_count: asNumber(applications.application_count),
      submitted_applications: asNumber(applications.submitted_count),
      applications_under_review: asNumber(applications.under_review_count),
      application_changes_requested: asNumber(applications.changes_requested_count),
      approved_applications: asNumber(applications.approved_count),
      declined_applications: asNumber(applications.declined_count),
      kyc_pending_applications: asNumber(applications.kyc_pending_count),
      affordability_manual_review_applications: asNumber(applications.affordability_manual_review_count),
      high_risk_applications: asNumber(applications.high_risk_count),
      sale_capable_assets: saleCapableAssets,
      available_for_sale: asNumber(salesInventory.available_for_sale),
      held_for_finance: asNumber(salesInventory.held_for_finance),
      sold_assets: asNumber(salesInventory.sold_assets),
      maintenance_or_breakdown_assets: maintenanceAssets,
      sale_inventory_maintenance_share_percent: maintenanceShare,
    },
    drivers,
    causal_map: {
      credit_pipeline: "application status, KYC, affordability review and aggregate risk",
      sales_inventory: "sale-capable availability, held-for-Finance and maintenance/breakdown state",
      portfolio: "agreement value, paid state, outstanding balance and account lifecycle",
      collections: "actual cash collections against open scheduled-obligation reference",
      arrears: "past-due schedule obligations and aging",
      ledger_integrity: "reconciliation consistency across agreements, schedules and payments",
    },
    certainty: {
      customer_rows_exposed: false,
      finance_scope_is_company_wide: true,
      hire_location_selection_required: false,
      approved_application_is_not_activated_agreement: true,
      partial_deposit_is_not_machine_reservation: true,
      deposits_are_part_of_payment_state_and_must_not_be_double_counted: true,
      overdue_is_part_of_outstanding_exposure: true,
      collection_vs_open_schedule_is_reference_not_certified_accounting_rate: true,
      portfolio_and_collections_are_not_certified_profit: true,
      warning:
        "This diagnostic explains Equipment Installment Finance performance from governed company-wide aggregates. It separates credit pipeline, sale inventory, portfolio, collections, arrears and reconciliation. It does not expose customer rows, double-count deposits/collections or overdue/outstanding balances, and it does not calculate certified Finance profit or margin from portfolio aggregates.",
    },
    generated_at:
      portfolio.generated_at || arrears.generated_at || cashflow.generated_at || salesPipeline.generated_at || new Date().toISOString(),
  };
}

async function loadEquipmentFinancePerformanceDiagnostics({ input = {} } = {}) {
  const [portfolio, arrears, cashflow, salesPipeline] = await Promise.all([
    loadPortfolioHealth({ input }),
    loadArrearsHealth({ input }),
    loadCashFlowHealth({ input }),
    loadSalesPipelineHealth({ input }),
  ]);
  return buildEquipmentFinancePerformanceDiagnostics({
    portfolio,
    arrears,
    cashflow,
    salesPipeline,
  });
}

module.exports = {
  agingBucket,
  buildEquipmentFinancePerformanceDiagnostics,
  loadEquipmentFinancePerformanceDiagnostics,
  round,
};
