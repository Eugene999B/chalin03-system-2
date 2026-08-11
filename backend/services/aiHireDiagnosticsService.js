"use strict";

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return Number(asNumber(value).toFixed(2));
}

function percent(numerator, denominator) {
  const base = asNumber(denominator);
  if (base <= 0) return null;
  return Number(((asNumber(numerator) / base) * 100).toFixed(2));
}

function driver({ key, category, severity, effect, explanation, evidence = {} }) {
  return Object.freeze({
    key,
    category,
    severity,
    effect,
    explanation,
    evidence: Object.freeze({ ...evidence }),
  });
}

function buildHirePerformanceDiagnostics(intelligence = {}) {
  const scope = intelligence.scope || {};
  const fleet = intelligence.fleet || {};
  const pipeline = intelligence.pipeline || {};
  const work = intelligence.work || {};
  const receivables = intelligence.receivables || {};
  const returns = intelligence.returns || {};

  const totalAssets = asNumber(fleet.total_assets);
  const availableAssets = asNumber(fleet.available_assets);
  const maintenanceAssets = asNumber(fleet.maintenance_assets);
  const assetsOnHire = asNumber(fleet.assets_on_hire);
  const activeContracts = asNumber(pipeline.active_contracts);
  const activeEnquiries = asNumber(pipeline.active_enquiries);
  const openQuotationValue = money(pipeline.open_quotation_value);
  const approvedUninvoiced = asNumber(work.approved_uninvoiced_work_logs);
  const unapprovedLogs = asNumber(work.unapproved_logs);
  const breakdownHours = money(work.breakdown_hours_30d);
  const billableHours = money(work.billable_hours_30d);
  const invoicedAmount = money(receivables.invoiced_amount);
  const paidAmount = money(receivables.paid_amount);
  const outstandingAmount = money(receivables.outstanding_amount);
  const overdueAmount = money(receivables.overdue_amount);
  const overdueInvoices = asNumber(receivables.overdue_invoices);
  const returnsDue = asNumber(returns.returns_due_or_incomplete);
  const returnedPendingClosure = asNumber(pipeline.returned_pending_closure);
  const readyForClosure = asNumber(returns.contracts_ready_for_closure);
  const closedWithBalance = asNumber(pipeline.closed_with_balance);

  const performanceView = Object.freeze({
    total_assets: totalAssets,
    available_assets: availableAssets,
    assets_on_hire: assetsOnHire,
    maintenance_or_breakdown_assets: maintenanceAssets,
    fleet_availability_percent: percent(availableAssets, totalAssets),
    fleet_on_hire_percent: percent(assetsOnHire, totalAssets),
    fleet_maintenance_percent: percent(maintenanceAssets, totalAssets),
    active_enquiries: activeEnquiries,
    total_quotations: asNumber(pipeline.total_quotations),
    approved_or_accepted_quotations: asNumber(pipeline.approved_quotations),
    open_quotation_value: openQuotationValue,
    active_contracts: activeContracts,
    billable_hours_30d: billableHours,
    breakdown_hours_30d: breakdownHours,
    approved_uninvoiced_work_logs: approvedUninvoiced,
    unapproved_work_logs: unapprovedLogs,
    invoiced_amount: invoicedAmount,
    paid_amount: paidAmount,
    outstanding_amount: outstandingAmount,
    overdue_amount: overdueAmount,
    overdue_invoices: overdueInvoices,
    collection_rate_percent: Number(asNumber(receivables.collection_rate).toFixed(2)),
    overdue_share_of_outstanding_percent: percent(overdueAmount, outstandingAmount),
    returns_due_or_incomplete: returnsDue,
    returned_pending_closure: returnedPendingClosure,
    contracts_ready_for_closure: readyForClosure,
    closed_with_balance: closedWithBalance,
  });

  const drivers = [];

  if (activeContracts > 0 && assetsOnHire === 0) {
    drivers.push(
      driver({
        key: "contract_asset_mismatch",
        category: "execution_control",
        severity: "danger",
        effect: "contract_execution_risk",
        explanation:
          "Active Hire contracts exist but no active Hire asset assignments were counted. Review contract-to-equipment assignment/dispatch evidence before treating the contracts as operationally active.",
        evidence: { active_contracts: activeContracts, assets_on_hire: assetsOnHire },
      })
    );
  }

  if (maintenanceAssets > 0) {
    drivers.push(
      driver({
        key: "fleet_maintenance_pressure",
        category: "fleet_capacity",
        severity: "warning",
        effect: "capacity_and_service_pressure",
        explanation:
          `${maintenanceAssets} fleet asset(s) are in maintenance or breakdown status. This reduces immediately usable capacity and can pressure dispatch/service performance, but it does not by itself prove financial loss.`,
        evidence: {
          total_assets: totalAssets,
          maintenance_or_breakdown_assets: maintenanceAssets,
          fleet_maintenance_percent: performanceView.fleet_maintenance_percent,
        },
      })
    );
  }

  if (breakdownHours > 0) {
    drivers.push(
      driver({
        key: "recorded_breakdown_hours",
        category: "fleet_reliability",
        severity: "warning",
        effect: "billable_capacity_pressure",
        explanation:
          `${breakdownHours} breakdown hour(s) were recorded in the current 30-day Hire work aggregate. Breakdown time can reduce billable capacity, but the aggregate does not prove a specific repair cause or profit impact.`,
        evidence: { breakdown_hours_30d: breakdownHours, billable_hours_30d: billableHours },
      })
    );
  }

  if (approvedUninvoiced > 0) {
    drivers.push(
      driver({
        key: "approved_uninvoiced_work",
        category: "billing_conversion",
        severity: "warning",
        effect: "billing_lag_and_control_risk",
        explanation:
          `${approvedUninvoiced} approved work log(s) have no linked invoice line. This is a billing-review signal; it must not be reported as confirmed lost revenue without contract/rate/invoice evidence.`,
        evidence: { approved_uninvoiced_work_logs: approvedUninvoiced },
      })
    );
  }

  if (unapprovedLogs > 0) {
    drivers.push(
      driver({
        key: "unapproved_work_logs",
        category: "work_control",
        severity: "review",
        effect: "billing_readiness_pressure",
        explanation:
          `${unapprovedLogs} work log(s) remain draft. Until work evidence is approved, billing completeness and contract-performance conclusions should remain provisional.`,
        evidence: { unapproved_work_logs: unapprovedLogs },
      })
    );
  }

  if (overdueAmount > 0 || overdueInvoices > 0) {
    drivers.push(
      driver({
        key: "overdue_receivables_pressure",
        category: "collections",
        severity: "danger",
        effect: "cash_conversion_pressure",
        explanation:
          `${overdueInvoices} invoice(s) are overdue with GHS ${overdueAmount.toFixed(2)} outstanding. This is receivables/cash-collection pressure, not evidence that the underlying Hire work was unprofitable.`,
        evidence: {
          overdue_invoices: overdueInvoices,
          overdue_amount: overdueAmount,
          overdue_share_of_outstanding_percent:
            performanceView.overdue_share_of_outstanding_percent,
        },
      })
    );
  } else if (outstandingAmount > 0) {
    drivers.push(
      driver({
        key: "outstanding_receivables",
        category: "collections",
        severity: "review",
        effect: "cash_conversion_pressure",
        explanation:
          `GHS ${outstandingAmount.toFixed(2)} remains outstanding on non-void Hire invoices. Outstanding balance is receivable evidence; it is not the same as revenue, cash or profit.`,
        evidence: { outstanding_amount: outstandingAmount },
      })
    );
  }

  if (closedWithBalance > 0) {
    drivers.push(
      driver({
        key: "financial_closure_risk",
        category: "contract_closure",
        severity: "danger",
        effect: "closure_and_receivable_control_risk",
        explanation:
          `${closedWithBalance} contract(s) carry a closed/closure state while still having an outstanding financial balance signal. Review financial closure evidence before presenting them as fully settled.`,
        evidence: { closed_with_balance: closedWithBalance },
      })
    );
  }

  if (returnsDue > 0) {
    drivers.push(
      driver({
        key: "return_completion_pressure",
        category: "asset_return",
        severity: "warning",
        effect: "asset_turnaround_and_closure_pressure",
        explanation:
          `${returnsDue} contract asset return(s) are due or incomplete. Delayed return/inspection can hold up asset availability and contract closure review.`,
        evidence: { returns_due_or_incomplete: returnsDue },
      })
    );
  }

  if (returnedPendingClosure > 0 || readyForClosure > 0) {
    drivers.push(
      driver({
        key: "closure_backlog",
        category: "contract_closure",
        severity: "review",
        effect: "administrative_and_control_backlog",
        explanation:
          `${returnedPendingClosure} returned contract(s) are pending closure and ${readyForClosure} contract(s) appear ready for closure review. Returned equipment is not by itself proof of complete operational and financial settlement.`,
        evidence: {
          returned_pending_closure: returnedPendingClosure,
          contracts_ready_for_closure: readyForClosure,
        },
      })
    );
  }

  if (openQuotationValue > 0) {
    drivers.push(
      driver({
        key: "open_commercial_pipeline",
        category: "demand_pipeline",
        severity: "information",
        effect: "potential_future_commercial_value",
        explanation:
          `The current open/non-inactive quotation aggregate carries GHS ${openQuotationValue.toFixed(2)} of pipeline value. This is potential commercial value and must not be reported as invoiced revenue, collected cash or profit.`,
        evidence: {
          open_quotation_value: openQuotationValue,
          active_enquiries: activeEnquiries,
          total_quotations: asNumber(pipeline.total_quotations),
        },
      })
    );
  }

  if (
    drivers.length === 0 &&
    totalAssets > 0 &&
    invoicedAmount >= 0
  ) {
    drivers.push(
      driver({
        key: "no_material_pressure_in_current_aggregate",
        category: "current_snapshot",
        severity: "information",
        effect: "no_flagged_aggregate_issue",
        explanation:
          "The current governed aggregate did not expose a material Hire pressure under the deterministic checks. This does not prove the location is problem-free; transaction-level investigation may still be required for a specific complaint.",
        evidence: {
          total_assets: totalAssets,
          active_contracts: activeContracts,
          outstanding_amount: outstandingAmount,
        },
      })
    );
  }

  return Object.freeze({
    scope: Object.freeze({ ...scope }),
    performance_view: performanceView,
    drivers: Object.freeze(drivers),
    certainty: Object.freeze({
      quotation_value_is_pipeline_not_realized_revenue: true,
      invoiced_amount_is_billed_value_not_cash: true,
      payments_are_cash_collection_not_profit: true,
      approved_uninvoiced_work_is_not_automatic_lost_revenue: true,
      fleet_capacity_signals_are_not_direct_financial_loss: true,
      equipment_return_is_not_automatic_financial_closure: true,
      has_complete_hire_cost_evidence: false,
      has_certified_hire_profit_evidence: false,
      warning:
        "This diagnostic explains Equipment Hire commercial and operating pressure from governed aggregate evidence. The current Hire snapshot does not provide a complete cost model or certified profit calculation, so do not infer profit from quotations, invoices, payments, receivables or fleet activity alone.",
    }),
    generated_at: intelligence.generated_at || new Date().toISOString(),
    execution_authority: "read_only",
  });
}

module.exports = {
  asNumber,
  buildHirePerformanceDiagnostics,
  money,
  percent,
};
