"use strict";

const {
  loadArrearsHealth,
  loadCashFlowHealth,
  loadPortfolioHealth,
} = require("./aiEquipmentFinanceIntelligenceService");

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function countValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function percent(numerator, denominator) {
  const base = Number(denominator || 0);
  if (!Number.isFinite(base) || base <= 0) return null;
  return Number(((Number(numerator || 0) / base) * 100).toFixed(2));
}

function diagnosticDriver({
  key,
  category,
  severity,
  effect,
  explanation,
  evidence = {},
}) {
  return Object.freeze({
    key,
    category,
    severity,
    effect,
    explanation,
    evidence: Object.freeze({ ...evidence }),
  });
}

function agingBucket(arrears = {}, key) {
  return (arrears.aging || []).find((row) => row.bucket === key) || {
    bucket: key,
    accounts: 0,
    arrears: 0,
    outstanding: 0,
    missed_lines: 0,
  };
}

function buildEquipmentFinancePerformanceDiagnostics({
  portfolio = {},
  arrears = {},
  cashflow = {},
} = {}) {
  const summary = portfolio.summary || {};
  const applications = portfolio.applications || {};
  const inventory = portfolio.sales_inventory || {};
  const arrearsSummary = arrears.summary || {};
  const cashTotals = cashflow.totals || {};

  const portfolioOutstanding = numberValue(summary.outstanding_balance);
  const arrearsAmount = numberValue(arrearsSummary.arrears || summary.overdue_balance);
  const collected = numberValue(cashTotals.collected_amount);
  const openSchedule = numberValue(cashTotals.expected_open_schedule_amount);
  const reconciliationAttention = countValue(summary.reconciliation_attention_count);
  const underReview = countValue(applications.under_review_count);
  const changesRequested = countValue(applications.changes_requested_count);
  const kycPending = countValue(applications.kyc_pending_count);
  const manualReview = countValue(applications.affordability_manual_review_count);
  const highRisk = countValue(applications.high_risk_count);
  const approvedApplications = countValue(applications.approved_count);
  const availableForSale = countValue(inventory.available_for_sale);
  const saleCapableAssets = countValue(inventory.sale_capable_assets);
  const heldForFinance = countValue(inventory.held_for_finance);
  const maintenanceOrBreakdown = countValue(inventory.maintenance_or_breakdown);

  const over90 = agingBucket(arrears, "over_90");
  const days61To90 = agingBucket(arrears, "61_90");
  const agedArrears = numberValue(
    Number(over90.arrears || 0) + Number(days61To90.arrears || 0)
  );
  const agedAccounts = countValue(over90.accounts) + countValue(days61To90.accounts);

  const view = Object.freeze({
    agreement_count: countValue(summary.agreement_count),
    active_agreements: countValue(summary.active_count),
    completed_agreements: countValue(summary.completed_count),
    overdue_agreements: countValue(summary.overdue_count),
    portfolio_value: numberValue(summary.portfolio_value),
    deposits_received: numberValue(summary.deposits_received),
    lifetime_collections: numberValue(summary.lifetime_collections),
    portfolio_outstanding_balance: portfolioOutstanding,
    portfolio_overdue_balance: numberValue(summary.overdue_balance),
    average_paid_percent: numberValue(summary.average_paid_percent),
    period_payment_count: countValue(summary.period_payment_count),
    period_collections: numberValue(summary.period_collections),
    reconciliation_attention_count: reconciliationAttention,
    arrears_accounts: countValue(arrearsSummary.accounts),
    calculated_arrears: arrearsAmount,
    arrears_accounts_outstanding: numberValue(arrearsSummary.outstanding),
    arrears_share_of_portfolio_outstanding_percent: percent(
      arrearsAmount,
      portfolioOutstanding
    ),
    aged_61_plus_arrears: agedArrears,
    aged_61_plus_accounts: agedAccounts,
    over_90_arrears: numberValue(over90.arrears),
    over_90_accounts: countValue(over90.accounts),
    selected_period_collections: collected,
    selected_period_open_schedule_amount: openSchedule,
    collection_to_open_schedule_ratio_percent:
      cashTotals.collection_vs_open_schedule_percent == null
        ? null
        : numberValue(cashTotals.collection_vs_open_schedule_percent),
    application_count: countValue(applications.application_count),
    applications_under_review: underReview,
    applications_changes_requested: changesRequested,
    approved_applications: approvedApplications,
    kyc_pending_applications: kycPending,
    affordability_manual_review_applications: manualReview,
    high_or_critical_risk_applications: highRisk,
    sale_capable_assets: saleCapableAssets,
    available_for_sale_assets: availableForSale,
    assets_held_for_finance: heldForFinance,
    sale_assets_maintenance_or_breakdown: maintenanceOrBreakdown,
  });

  const drivers = [];

  if (arrearsAmount > 0 || view.arrears_accounts > 0) {
    drivers.push(
      diagnosticDriver({
        key: "arrears_pressure",
        category: "collections",
        severity: "danger",
        effect: "delinquency_and_cash_pressure",
        explanation:
          `${view.arrears_accounts} Finance account(s) have GHS ${arrearsAmount.toFixed(2)} of calculated past-due schedule obligations. This is arrears evidence; it is not the same as the full outstanding portfolio balance and is not a certified credit-loss amount.`,
        evidence: {
          arrears_accounts: view.arrears_accounts,
          calculated_arrears: arrearsAmount,
          portfolio_outstanding_balance: portfolioOutstanding,
          arrears_share_of_portfolio_outstanding_percent:
            view.arrears_share_of_portfolio_outstanding_percent,
        },
      })
    );
  }

  if (agedArrears > 0 || agedAccounts > 0) {
    drivers.push(
      diagnosticDriver({
        key: "aged_arrears_pressure",
        category: "collections",
        severity: "danger",
        effect: "recovery_priority_pressure",
        explanation:
          `${agedAccounts} account(s) carry GHS ${agedArrears.toFixed(2)} of arrears in the 61-90 or over-90-day buckets. Older aging raises collection/recovery priority, but the aggregate does not prove final default or unrecoverable loss.`,
        evidence: {
          aged_61_plus_accounts: agedAccounts,
          aged_61_plus_arrears: agedArrears,
          over_90_accounts: view.over_90_accounts,
          over_90_arrears: view.over_90_arrears,
        },
      })
    );
  }

  if (reconciliationAttention > 0) {
    drivers.push(
      diagnosticDriver({
        key: "reconciliation_integrity_pressure",
        category: "data_integrity",
        severity: "danger",
        effect: "portfolio_confidence_pressure",
        explanation:
          `${reconciliationAttention} Finance agreement(s) require reconciliation attention. Until agreement, schedule, payment and allocation evidence reconcile, management should treat affected portfolio conclusions with reduced confidence.`,
        evidence: { reconciliation_attention_count: reconciliationAttention },
      })
    );
  }

  if (openSchedule > collected && openSchedule > 0) {
    drivers.push(
      diagnosticDriver({
        key: "collection_to_schedule_pressure",
        category: "cash_conversion",
        severity: "warning",
        effect: "period_cash_conversion_pressure",
        explanation:
          `Selected-period collections are GHS ${collected.toFixed(2)} versus GHS ${openSchedule.toFixed(2)} of currently open scheduled amounts. This comparison can signal cash-conversion pressure, but it is not automatically an on-time collection rate because the two aggregates are not guaranteed to be a matched due/payment cohort.`,
        evidence: {
          collected_amount: collected,
          expected_open_schedule_amount: openSchedule,
          collection_to_open_schedule_ratio_percent:
            view.collection_to_open_schedule_ratio_percent,
        },
      })
    );
  }

  if (underReview > 0 || changesRequested > 0 || manualReview > 0) {
    drivers.push(
      diagnosticDriver({
        key: "origination_review_backlog",
        category: "origination",
        severity: "review",
        effect: "application_conversion_pressure",
        explanation:
          `${underReview} application(s) are under review, ${changesRequested} await requested changes and ${manualReview} require affordability manual review. These are origination-control states, not active Finance agreements.`,
        evidence: {
          applications_under_review: underReview,
          applications_changes_requested: changesRequested,
          affordability_manual_review_applications: manualReview,
        },
      })
    );
  }

  if (kycPending > 0) {
    drivers.push(
      diagnosticDriver({
        key: "kyc_readiness_pressure",
        category: "origination_control",
        severity: "warning",
        effect: "activation_readiness_pressure",
        explanation:
          `${kycPending} application(s) have KYC not yet verified. KYC readiness is an activation control and must not be bypassed by interpreting application pipeline counts as booked agreements.`,
        evidence: { kyc_pending_applications: kycPending },
      })
    );
  }

  if (highRisk > 0) {
    drivers.push(
      diagnosticDriver({
        key: "high_risk_origination_pressure",
        category: "credit_risk",
        severity: "warning",
        effect: "credit_review_pressure",
        explanation:
          `${highRisk} credit application(s) are currently classified high or critical risk. This is a review/risk signal, not proof that those applicants will default.`,
        evidence: { high_or_critical_risk_applications: highRisk },
      })
    );
  }

  if (approvedApplications > 0 && availableForSale === 0) {
    drivers.push(
      diagnosticDriver({
        key: "approved_demand_asset_constraint",
        category: "asset_fulfillment",
        severity: "warning",
        effect: "activation_or_delivery_capacity_pressure",
        explanation:
          `${approvedApplications} application(s) are approved while no sale-capable asset is currently marked available for sale. Review exact asset commitments and shared Hire/Finance conflict controls before promising activation or delivery.`,
        evidence: {
          approved_applications: approvedApplications,
          available_for_sale_assets: availableForSale,
          sale_capable_assets: saleCapableAssets,
          assets_held_for_finance: heldForFinance,
        },
      })
    );
  }

  if (maintenanceOrBreakdown > 0) {
    drivers.push(
      diagnosticDriver({
        key: "sale_asset_readiness_pressure",
        category: "asset_fulfillment",
        severity: "warning",
        effect: "delivery_readiness_pressure",
        explanation:
          `${maintenanceOrBreakdown} sale-capable asset(s) are in maintenance or breakdown status. This can constrain Finance fulfillment/delivery readiness, but the aggregate does not prove which approved application, if any, is affected.`,
        evidence: {
          sale_assets_maintenance_or_breakdown: maintenanceOrBreakdown,
          sale_capable_assets: saleCapableAssets,
        },
      })
    );
  }

  if (drivers.length === 0) {
    drivers.push(
      diagnosticDriver({
        key: "no_material_pressure_in_current_aggregate",
        category: "current_snapshot",
        severity: "information",
        effect: "no_flagged_aggregate_issue",
        explanation:
          "The current governed Finance aggregates did not trigger a material deterministic pressure signal. This does not prove every agreement or application is problem-free; a specific case still requires its ordinary authenticated Finance evidence.",
        evidence: {
          agreement_count: view.agreement_count,
          application_count: view.application_count,
          portfolio_outstanding_balance: portfolioOutstanding,
        },
      })
    );
  }

  return Object.freeze({
    scope: Object.freeze({
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
      hire_location_selection_required: false,
      date_from:
        cashflow.scope?.date_from || portfolio.scope?.date_from || null,
      date_to:
        cashflow.scope?.date_to || portfolio.scope?.date_to || arrears.scope?.as_of || null,
      arrears_as_of: arrears.scope?.as_of || null,
    }),
    performance_view: view,
    aging: Object.freeze((arrears.aging || []).map((row) => Object.freeze({ ...row }))),
    drivers: Object.freeze(drivers),
    certainty: Object.freeze({
      company_wide_finance_scope: true,
      customer_rows_exposed: false,
      application_approval_is_not_agreement_activation: true,
      outstanding_balance_is_not_arrears: true,
      arrears_is_past_due_schedule_evidence: true,
      collection_to_open_schedule_ratio_is_not_automatic_on_time_rate: true,
      portfolio_value_is_not_cash_or_profit: true,
      payments_are_collections_not_profit: true,
      reconciliation_attention_is_integrity_signal: true,
      shared_asset_counts_do_not_authorize_delivery_or_transfer: true,
      has_complete_finance_cost_evidence: false,
      has_certified_finance_profit_or_yield_evidence: false,
      warning:
        "This diagnostic explains Equipment Finance origination, portfolio, collections, arrears, reconciliation and asset-readiness pressure from confidential aggregate evidence. It does not expose customer rows and does not provide a complete accounting cost, impairment, profit, margin or investment-yield calculation.",
    }),
    generated_at:
      portfolio.generated_at || cashflow.generated_at || arrears.generated_at || new Date().toISOString(),
    customer_rows_exposed: false,
    execution_authority: "read_only",
  });
}

async function loadEquipmentFinancePerformanceDiagnostics({
  input = {},
  portfolioLoader = loadPortfolioHealth,
  arrearsLoader = loadArrearsHealth,
  cashflowLoader = loadCashFlowHealth,
} = {}) {
  const arrearsInput = input?.end_date
    ? { end_date: input.end_date }
    : {};
  const [portfolio, arrears, cashflow] = await Promise.all([
    portfolioLoader({ input }),
    arrearsLoader({ input: arrearsInput }),
    cashflowLoader({ input }),
  ]);
  return buildEquipmentFinancePerformanceDiagnostics({
    portfolio,
    arrears,
    cashflow,
  });
}

module.exports = {
  agingBucket,
  buildEquipmentFinancePerformanceDiagnostics,
  countValue,
  loadEquipmentFinancePerformanceDiagnostics,
  numberValue,
  percent,
};
