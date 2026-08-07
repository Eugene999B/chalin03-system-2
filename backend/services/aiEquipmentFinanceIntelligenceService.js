"use strict";

const { pool } = require("../config/db");
const {
  getArrearsReport,
  getCashFlowReport,
  getPortfolioDashboard,
} = require("./equipmentFinancePhaseSixService");

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function positiveCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function financeError(
  message,
  code = "AI_EQUIPMENT_FINANCE_INTELLIGENCE_FAILED",
  statusCode = 500
) {
  const error = new Error(message);
  error.name = "AiEquipmentFinanceIntelligenceError";
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw financeError(
      "Finance intelligence dates must use YYYY-MM-DD.",
      "AI_EQUIPMENT_FINANCE_DATE_INVALID",
      400
    );
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw financeError(
      "Finance intelligence dates must use valid calendar dates.",
      "AI_EQUIPMENT_FINANCE_DATE_INVALID",
      400
    );
  }
  return text;
}

function inputDates(input = {}) {
  const dateFrom = normalizeDate(input.start_date || input.date_from);
  const dateTo = normalizeDate(input.end_date || input.date_to || input.as_of);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { dateFrom: dateTo, dateTo: dateFrom };
  }
  return { dateFrom, dateTo };
}

async function loadApplicationPipeline(connection = pool) {
  const [rows] = await connection.query(
    `SELECT
       COUNT(*) AS application_count,
       COALESCE(SUM(CASE WHEN application_status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_count,
       COALESCE(SUM(CASE WHEN application_status = 'submitted' THEN 1 ELSE 0 END), 0) AS submitted_count,
       COALESCE(SUM(CASE WHEN application_status = 'under_review' THEN 1 ELSE 0 END), 0) AS under_review_count,
       COALESCE(SUM(CASE WHEN application_status = 'changes_requested' THEN 1 ELSE 0 END), 0) AS changes_requested_count,
       COALESCE(SUM(CASE WHEN application_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
       COALESCE(SUM(CASE WHEN application_status = 'declined' THEN 1 ELSE 0 END), 0) AS declined_count,
       COALESCE(SUM(CASE WHEN application_status = 'withdrawn' THEN 1 ELSE 0 END), 0) AS withdrawn_count,
       COALESCE(SUM(CASE WHEN kyc_status = 'verified' THEN 1 ELSE 0 END), 0) AS kyc_verified_count,
       COALESCE(SUM(CASE WHEN kyc_status IN ('not_started', 'incomplete', 'complete') THEN 1 ELSE 0 END), 0) AS kyc_pending_count,
       COALESCE(SUM(CASE WHEN affordability_status = 'eligible' THEN 1 ELSE 0 END), 0) AS affordability_eligible_count,
       COALESCE(SUM(CASE WHEN affordability_status = 'manual_review' THEN 1 ELSE 0 END), 0) AS affordability_manual_review_count,
       COALESCE(SUM(CASE WHEN risk_band IN ('high', 'critical') THEN 1 ELSE 0 END), 0) AS high_risk_count
     FROM equipment_credit_applications`
  );
  const row = rows[0] || {};
  return Object.freeze({
    application_count: positiveCount(row.application_count),
    draft_count: positiveCount(row.draft_count),
    submitted_count: positiveCount(row.submitted_count),
    under_review_count: positiveCount(row.under_review_count),
    changes_requested_count: positiveCount(row.changes_requested_count),
    approved_count: positiveCount(row.approved_count),
    declined_count: positiveCount(row.declined_count),
    withdrawn_count: positiveCount(row.withdrawn_count),
    kyc_verified_count: positiveCount(row.kyc_verified_count),
    kyc_pending_count: positiveCount(row.kyc_pending_count),
    affordability_eligible_count: positiveCount(row.affordability_eligible_count),
    affordability_manual_review_count: positiveCount(row.affordability_manual_review_count),
    high_risk_count: positiveCount(row.high_risk_count),
  });
}

async function loadSalesInventory(connection = pool) {
  const [rows] = await connection.query(
    `SELECT
       COUNT(*) AS sale_capable_assets,
       COALESCE(SUM(CASE WHEN sale_status = 'available' THEN 1 ELSE 0 END), 0) AS available_for_sale,
       COALESCE(SUM(CASE WHEN sale_status IN ('reserved', 'application_hold', 'agreement_hold') THEN 1 ELSE 0 END), 0) AS held_for_finance,
       COALESCE(SUM(CASE WHEN sale_status IN ('sold', 'completed') THEN 1 ELSE 0 END), 0) AS sold_assets,
       COALESCE(SUM(CASE WHEN current_status IN ('maintenance', 'breakdown') THEN 1 ELSE 0 END), 0) AS maintenance_or_breakdown
     FROM fleet_assets
     WHERE is_active = TRUE
       AND operational_purpose IN ('sale_only', 'sale_or_hire')`
  );
  const row = rows[0] || {};
  return Object.freeze({
    sale_capable_assets: positiveCount(row.sale_capable_assets),
    available_for_sale: positiveCount(row.available_for_sale),
    held_for_finance: positiveCount(row.held_for_finance),
    sold_assets: positiveCount(row.sold_assets),
    maintenance_or_breakdown: positiveCount(row.maintenance_or_breakdown),
  });
}

function portfolioAlerts(summary = {}, applications = {}, salesInventory = {}) {
  const alerts = [];
  function add(severity, key, message) {
    alerts.push({ severity, key, message });
  }
  if (positiveCount(summary.overdue_count) > 0) {
    add(
      "danger",
      "overdue_accounts",
      `${positiveCount(summary.overdue_count)} installment account(s) are overdue with GHS ${numberValue(summary.overdue_balance)} overdue.`
    );
  }
  if (positiveCount(summary.reconciliation_attention_count) > 0) {
    add(
      "danger",
      "reconciliation_attention",
      `${positiveCount(summary.reconciliation_attention_count)} agreement(s) require reconciliation attention.`
    );
  }
  if (positiveCount(applications.under_review_count) > 0) {
    add(
      "review",
      "applications_under_review",
      `${positiveCount(applications.under_review_count)} credit application(s) are under review.`
    );
  }
  if (positiveCount(applications.changes_requested_count) > 0) {
    add(
      "warning",
      "application_changes",
      `${positiveCount(applications.changes_requested_count)} application(s) are waiting for requested changes.`
    );
  }
  if (positiveCount(applications.high_risk_count) > 0) {
    add(
      "warning",
      "high_risk_applications",
      `${positiveCount(applications.high_risk_count)} application(s) are currently classified high or critical risk.`
    );
  }
  if (positiveCount(salesInventory.available_for_sale) === 0 && positiveCount(salesInventory.sale_capable_assets) > 0) {
    add("warning", "no_available_sale_assets", "No sale-capable equipment is currently marked available for a new Finance sale.");
  }
  return Object.freeze(alerts);
}

function safePortfolio(dashboard, applications, salesInventory) {
  return Object.freeze({
    scope: Object.freeze({
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
      hire_location_selection_required: false,
      date_from: dashboard.period?.date_from || null,
      date_to: dashboard.period?.date_to || null,
    }),
    summary: Object.freeze({ ...(dashboard.summary || {}) }),
    statuses: Object.freeze((dashboard.statuses || []).map((row) => Object.freeze({ ...row }))),
    aging: Object.freeze((dashboard.aging || []).map((row) => Object.freeze({ ...row }))),
    upcoming: Object.freeze((dashboard.upcoming || []).map((row) => Object.freeze({ ...row }))),
    applications,
    sales_inventory: salesInventory,
    alerts: portfolioAlerts(dashboard.summary, applications, salesInventory),
    customer_rows_exposed: false,
    generated_at: new Date().toISOString(),
  });
}

async function loadPortfolioHealth({ input = {}, connection = pool } = {}) {
  const dates = inputDates(input);
  try {
    const [dashboard, applications, salesInventory] = await Promise.all([
      getPortfolioDashboard({ dateFrom: dates.dateFrom, dateTo: dates.dateTo }),
      loadApplicationPipeline(connection),
      loadSalesInventory(connection),
    ]);
    return safePortfolio(dashboard, applications, salesInventory);
  } catch (error) {
    if (String(error?.code || "").startsWith("AI_")) throw error;
    throw financeError("Equipment Finance portfolio intelligence could not be loaded safely.");
  }
}

function aggregateArrearsRows(rows = []) {
  const buckets = new Map([
    ["1_30", { bucket: "1_30", accounts: 0, arrears: 0, outstanding: 0, missed_lines: 0 }],
    ["31_60", { bucket: "31_60", accounts: 0, arrears: 0, outstanding: 0, missed_lines: 0 }],
    ["61_90", { bucket: "61_90", accounts: 0, arrears: 0, outstanding: 0, missed_lines: 0 }],
    ["over_90", { bucket: "over_90", accounts: 0, arrears: 0, outstanding: 0, missed_lines: 0 }],
  ]);
  for (const row of rows) {
    const bucket = buckets.get(row.aging_bucket) || buckets.get("over_90");
    bucket.accounts += 1;
    bucket.arrears += Number(row.calculated_arrears || 0);
    bucket.outstanding += Number(row.outstanding_balance || 0);
    bucket.missed_lines += positiveCount(row.missed_lines);
  }
  return Object.freeze(
    [...buckets.values()]
      .map((row) => Object.freeze({
        ...row,
        arrears: numberValue(row.arrears),
        outstanding: numberValue(row.outstanding),
      }))
      .filter((row) => row.accounts > 0)
  );
}

async function loadArrearsHealth({ input = {} } = {}) {
  const { dateTo } = inputDates(input);
  try {
    const report = await getArrearsReport({ dateTo });
    const aging = aggregateArrearsRows(report.arrears || []);
    return Object.freeze({
      scope: Object.freeze({
        workspace_code: "equipment_hire",
        equipment_division: "finance",
        finance_scope: "company_wide",
        as_of: report.as_of,
      }),
      summary: Object.freeze({ ...(report.summary || {}) }),
      aging,
      oldest_bucket: aging.length ? aging[aging.length - 1].bucket : null,
      customer_rows_exposed: false,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    if (String(error?.code || "").startsWith("AI_")) throw error;
    throw financeError("Equipment Finance arrears intelligence could not be loaded safely.");
  }
}

async function loadCashFlowHealth({ input = {} } = {}) {
  const dates = inputDates(input);
  try {
    const report = await getCashFlowReport({ dateFrom: dates.dateFrom, dateTo: dates.dateTo });
    const actualTotal = (report.actual || []).reduce(
      (sum, row) => sum + Number(row.collected_amount || 0),
      0
    );
    const expectedTotal = (report.expected || []).reduce(
      (sum, row) => sum + Number(row.expected_amount || 0),
      0
    );
    return Object.freeze({
      scope: Object.freeze({
        workspace_code: "equipment_hire",
        equipment_division: "finance",
        finance_scope: "company_wide",
        date_from: report.period?.date_from || null,
        date_to: report.period?.date_to || null,
      }),
      totals: Object.freeze({
        collected_amount: numberValue(actualTotal),
        expected_open_schedule_amount: numberValue(expectedTotal),
        collection_vs_open_schedule_percent:
          expectedTotal > 0 ? numberValue((actualTotal / expectedTotal) * 100) : null,
      }),
      monthly_collections: Object.freeze((report.actual || []).map((row) => Object.freeze({ ...row }))),
      monthly_expected: Object.freeze((report.expected || []).map((row) => Object.freeze({ ...row }))),
      payment_methods: Object.freeze((report.payment_methods || []).map((row) => Object.freeze({ ...row }))),
      customer_rows_exposed: false,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    if (String(error?.code || "").startsWith("AI_")) throw error;
    throw financeError("Equipment Finance cash-flow intelligence could not be loaded safely.");
  }
}

async function loadSalesPipelineHealth({ connection = pool } = {}) {
  try {
    const [applications, salesInventory] = await Promise.all([
      loadApplicationPipeline(connection),
      loadSalesInventory(connection),
    ]);
    return Object.freeze({
      scope: Object.freeze({
        workspace_code: "equipment_hire",
        equipment_division: "finance",
        finance_scope: "company_wide",
      }),
      applications,
      sales_inventory: salesInventory,
      alerts: portfolioAlerts({}, applications, salesInventory),
      customer_rows_exposed: false,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    if (String(error?.code || "").startsWith("AI_")) throw error;
    throw financeError("Equipment Finance sales pipeline intelligence could not be loaded safely.");
  }
}

module.exports = {
  aggregateArrearsRows,
  inputDates,
  loadApplicationPipeline,
  loadArrearsHealth,
  loadCashFlowHealth,
  loadPortfolioHealth,
  loadSalesInventory,
  loadSalesPipelineHealth,
  portfolioAlerts,
  safePortfolio,
};