"use strict";

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((asNumber(value) + Number.EPSILON) * factor) / factor;
}

function buildHirePerformanceDiagnostics(intelligence = {}) {
  const scope = intelligence.scope || {};
  const fleet = intelligence.fleet || {};
  const pipeline = intelligence.pipeline || {};
  const work = intelligence.work || {};
  const receivables = intelligence.receivables || {};
  const returns = intelligence.returns || {};

  const totalAssets = asNumber(fleet.total_assets);
  const maintenanceAssets = asNumber(fleet.maintenance_assets);
  const maintenanceShare = totalAssets > 0
    ? round((maintenanceAssets / totalAssets) * 100)
    : null;

  const billableHours = asNumber(work.billable_hours_30d);
  const breakdownHours = asNumber(work.breakdown_hours_30d);
  const recordedHoursReference = billableHours + breakdownHours;
  const breakdownShareReference = recordedHoursReference > 0
    ? round((breakdownHours / recordedHoursReference) * 100)
    : null;

  const invoicedAmount = asNumber(receivables.invoiced_amount);
  const paidAmount = asNumber(receivables.paid_amount);
  const collectionRate = invoicedAmount > 0
    ? round((paidAmount / invoicedAmount) * 100)
    : 0;

  const drivers = [];
  function addDriver({ key, category, severity = "info", effect, explanation, evidence }) {
    drivers.push(Object.freeze({ key, category, severity, effect, explanation, evidence }));
  }

  if (maintenanceAssets > 0) {
    addDriver({
      key: "fleet_maintenance_pressure",
      category: "fleet_readiness",
      severity: maintenanceShare != null && maintenanceShare >= 30 ? "danger" : "warning",
      effect: "availability_pressure",
      explanation: `${maintenanceAssets} active fleet asset(s) are recorded in maintenance or breakdown status${maintenanceShare == null ? "" : `, representing ${maintenanceShare}% of the active fleet count`}. This can constrain availability, but the aggregate status count does not prove the mechanical cause or lost revenue.`,
      evidence: {
        total_assets: totalAssets,
        maintenance_assets: maintenanceAssets,
        maintenance_share_percent: maintenanceShare,
      },
    });
  }

  if (asNumber(pipeline.active_contracts) > 0 && asNumber(fleet.assets_on_hire) === 0) {
    addDriver({
      key: "active_contract_asset_mismatch",
      category: "fleet_control",
      severity: "warning",
      effect: "contract_delivery_review",
      explanation: `${asNumber(pipeline.active_contracts)} active contract(s) exist but no active Hire asset assignments were counted. Review contract mobilization, assignment and return state before assuming the fleet is deployed correctly.`,
      evidence: {
        active_contracts: asNumber(pipeline.active_contracts),
        assets_on_hire: asNumber(fleet.assets_on_hire),
      },
    });
  }

  if (breakdownShareReference != null && breakdownShareReference >= 20) {
    addDriver({
      key: "recorded_breakdown_hour_pressure",
      category: "fleet_readiness",
      severity: breakdownShareReference >= 35 ? "danger" : "warning",
      effect: "work_capacity_pressure",
      explanation: `Breakdown hours are ${breakdownShareReference}% of the current 30-day billable-plus-breakdown hour reference. This is a downtime-pressure signal only; it is not a certified fleet-utilization percentage because scheduled capacity hours are not present in this aggregate.`,
      evidence: {
        billable_hours_30d: billableHours,
        breakdown_hours_30d: breakdownHours,
        breakdown_share_reference_percent: breakdownShareReference,
      },
    });
  }

  if (asNumber(work.unapproved_logs) > 0) {
    addDriver({
      key: "draft_work_log_backlog",
      category: "work_control",
      severity: "review",
      effect: "billing_timing_pressure",
      explanation: `${asNumber(work.unapproved_logs)} Hire work log(s) remain draft. Draft work can delay the approved evidence needed for downstream invoicing and should be reviewed before concluding that billing is complete.`,
      evidence: { unapproved_work_logs: asNumber(work.unapproved_logs) },
    });
  }

  if (asNumber(work.approved_uninvoiced_work_logs) > 0) {
    addDriver({
      key: "approved_uninvoiced_work",
      category: "billing_control",
      severity: "warning",
      effect: "billing_completeness_pressure",
      explanation: `${asNumber(work.approved_uninvoiced_work_logs)} approved work log(s) are not linked to invoice lines. This is a billing-completeness/timing risk, not proof of a known revenue loss amount from the aggregate count alone.`,
      evidence: {
        approved_uninvoiced_work_logs: asNumber(work.approved_uninvoiced_work_logs),
      },
    });
  }

  if (asNumber(receivables.overdue_invoices) > 0) {
    addDriver({
      key: "overdue_receivables_pressure",
      category: "cash_conversion",
      severity: asNumber(receivables.overdue_amount) > 0 ? "danger" : "warning",
      effect: "collection_pressure",
      explanation: `${asNumber(receivables.overdue_invoices)} invoice(s) are overdue with GHS ${round(receivables.overdue_amount).toFixed(2)} outstanding. This is a cash-conversion and credit-control signal; it does not by itself establish Hire profit or loss.`,
      evidence: {
        overdue_invoices: asNumber(receivables.overdue_invoices),
        overdue_amount: round(receivables.overdue_amount),
      },
    });
  }

  if (invoicedAmount > 0 && collectionRate < 80) {
    addDriver({
      key: "weak_collection_rate",
      category: "cash_conversion",
      severity: collectionRate < 60 ? "danger" : "warning",
      effect: "cash_conversion_pressure",
      explanation: `Recorded payments are ${collectionRate}% of non-void invoiced amount in the current Hire snapshot. Collections explain cash conversion and receivables exposure, not profitability by themselves.`,
      evidence: {
        invoiced_amount: round(invoicedAmount),
        paid_amount: round(paidAmount),
        outstanding_amount: round(receivables.outstanding_amount),
        collection_rate: collectionRate,
      },
    });
  }

  if (asNumber(pipeline.draft_quotations) > 0) {
    addDriver({
      key: "draft_quotation_backlog",
      category: "commercial_pipeline",
      severity: "review",
      effect: "conversion_timing_pressure",
      explanation: `${asNumber(pipeline.draft_quotations)} quotation(s) remain draft. This can indicate a commercial preparation/approval backlog, but open quotation value is pipeline exposure rather than recognized revenue.`,
      evidence: {
        draft_quotations: asNumber(pipeline.draft_quotations),
        approved_quotations: asNumber(pipeline.approved_quotations),
        open_quotation_value: round(pipeline.open_quotation_value),
      },
    });
  }

  if (asNumber(returns.returns_due_or_incomplete) > 0) {
    addDriver({
      key: "return_cycle_backlog",
      category: "asset_return_control",
      severity: "warning",
      effect: "asset_release_pressure",
      explanation: `${asNumber(returns.returns_due_or_incomplete)} contract asset return(s) are due or incomplete. This can delay equipment release, inspection and lifecycle completion without proving a financial loss amount.`,
      evidence: {
        returns_due_or_incomplete: asNumber(returns.returns_due_or_incomplete),
      },
    });
  }

  if (
    asNumber(returns.contracts_ready_for_closure) > 0 ||
    asNumber(pipeline.returned_pending_closure) > 0
  ) {
    addDriver({
      key: "closure_backlog",
      category: "contract_control",
      severity: "review",
      effect: "lifecycle_completeness_pressure",
      explanation: `${asNumber(returns.contracts_ready_for_closure)} contract(s) appear ready for closure and ${asNumber(pipeline.returned_pending_closure)} contract(s) are recorded as returned pending closure. Review operational and financial completion before treating these contracts as fully closed.`,
      evidence: {
        contracts_ready_for_closure: asNumber(returns.contracts_ready_for_closure),
        returned_pending_closure: asNumber(pipeline.returned_pending_closure),
      },
    });
  }

  if (asNumber(pipeline.closed_with_balance) > 0) {
    addDriver({
      key: "closed_contract_balance",
      category: "financial_control",
      severity: "warning",
      effect: "post_closure_receivable_pressure",
      explanation: `${asNumber(pipeline.closed_with_balance)} contract(s) are recorded with outstanding financial status. Operational completion and financial settlement should be reviewed as separate controls.`,
      evidence: { closed_with_balance: asNumber(pipeline.closed_with_balance) },
    });
  }

  if (drivers.length === 0) {
    addDriver({
      key: "no_major_aggregate_exception",
      category: "overall",
      severity: "info",
      effect: "no_obvious_aggregate_driver",
      explanation: "The current location-scoped Hire aggregate does not show a major configured exception. A deeper root-cause answer would require comparison with another period or more detailed authorized operational evidence.",
      evidence: {
        total_assets: totalAssets,
        active_contracts: asNumber(pipeline.active_contracts),
        invoiced_amount: round(invoicedAmount),
        outstanding_amount: round(receivables.outstanding_amount),
      },
    });
  }

  const severityOrder = { danger: 0, warning: 1, review: 2, info: 3 };
  drivers.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  return {
    scope,
    performance_view: {
      total_assets: totalAssets,
      available_assets: asNumber(fleet.available_assets),
      maintenance_assets: maintenanceAssets,
      maintenance_share_percent: maintenanceShare,
      assets_on_hire: asNumber(fleet.assets_on_hire),
      returned_asset_assignments: asNumber(fleet.returned_asset_assignments),
      active_enquiries: asNumber(pipeline.active_enquiries),
      draft_quotations: asNumber(pipeline.draft_quotations),
      approved_quotations: asNumber(pipeline.approved_quotations),
      open_quotation_value: round(pipeline.open_quotation_value),
      active_contracts: asNumber(pipeline.active_contracts),
      draft_contracts: asNumber(pipeline.draft_contracts),
      returned_pending_closure: asNumber(pipeline.returned_pending_closure),
      closed_with_balance: asNumber(pipeline.closed_with_balance),
      billable_hours_30d: billableHours,
      breakdown_hours_30d: breakdownHours,
      breakdown_share_reference_percent: breakdownShareReference,
      unapproved_work_logs: asNumber(work.unapproved_logs),
      approved_uninvoiced_work_logs: asNumber(work.approved_uninvoiced_work_logs),
      invoiced_amount: round(invoicedAmount),
      paid_amount: round(paidAmount),
      outstanding_amount: round(receivables.outstanding_amount),
      overdue_invoices: asNumber(receivables.overdue_invoices),
      overdue_amount: round(receivables.overdue_amount),
      collection_rate: collectionRate,
      aging: receivables.aging || {},
      returns_due_or_incomplete: asNumber(returns.returns_due_or_incomplete),
      contracts_ready_for_closure: asNumber(returns.contracts_ready_for_closure),
    },
    drivers,
    causal_map: {
      commercial_pipeline: "enquiries, quotation status and open quotation pipeline value",
      fleet_readiness: "fleet availability, maintenance/breakdown status and Hire assignments",
      work_control: "draft work logs, approved work and 30-day billable/breakdown hours",
      billing_control: "approved work not yet linked to invoice lines",
      cash_conversion: "invoiced, paid, outstanding, overdue and aging evidence",
      lifecycle_control: "returns, asset release and contract closure state",
    },
    certainty: {
      has_hire_billing_evidence: true,
      has_hire_cash_collection_evidence: true,
      has_operating_cost_evidence: false,
      has_certified_hire_profit_or_margin_evidence: false,
      open_quotation_value_is_pipeline_not_revenue: true,
      paid_amount_is_cash_collection_not_profit: true,
      approved_uninvoiced_count_is_not_known_revenue_loss: true,
      fleet_assignment_counts_are_not_time_based_utilization: true,
      breakdown_share_reference_is_not_certified_utilization: true,
      warning:
        "This diagnostic explains Equipment Hire performance from governed location aggregates. It separates pipeline, fleet readiness, work/billing controls, receivables and lifecycle backlog. It does not calculate certified Hire profit or margin because operating-cost evidence is not present, and it does not convert fleet assignment counts into a time-based utilization percentage.",
    },
    generated_at: intelligence.generated_at || new Date().toISOString(),
  };
}

module.exports = {
  buildHirePerformanceDiagnostics,
  round,
};
