"use strict";

const { pool } = require("../config/db");

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return Number(asNumber(value).toFixed(2));
}

function hireError(message, code = "AI_HIRE_INTELLIGENCE_FAILED", statusCode = 500) {
  const error = new Error(message);
  error.name = "AiHireIntelligenceError";
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function agingBucketSql(alias = "hi") {
  return `CASE
    WHEN ${alias}.balance <= 0 OR ${alias}.status IN ('paid', 'void') THEN 'settled'
    WHEN ${alias}.due_date IS NULL OR ${alias}.due_date >= CURDATE() THEN 'current'
    WHEN DATEDIFF(CURDATE(), ${alias}.due_date) BETWEEN 1 AND 30 THEN '1_30'
    WHEN DATEDIFF(CURDATE(), ${alias}.due_date) BETWEEN 31 AND 60 THEN '31_60'
    WHEN DATEDIFF(CURDATE(), ${alias}.due_date) BETWEEN 61 AND 90 THEN '61_90'
    ELSE 'over_90'
  END`;
}

function buildAlerts({ fleet, pipeline, work, receivables, returns }) {
  const alerts = [];
  function add(severity, key, message) {
    alerts.push({ severity, key, message });
  }

  if (fleet.maintenance_assets > 0) {
    add("warning", "maintenance_assets", `${fleet.maintenance_assets} fleet asset(s) are in maintenance or breakdown status.`);
  }
  if (work.unapproved_logs > 0) {
    add("review", "unapproved_work_logs", `${work.unapproved_logs} work log(s) are still draft.`);
  }
  if (work.approved_uninvoiced_work_logs > 0) {
    add("warning", "uninvoiced_work", `${work.approved_uninvoiced_work_logs} approved work log(s) are not yet invoiced.`);
  }
  if (receivables.overdue_invoices > 0) {
    add("danger", "overdue_invoices", `${receivables.overdue_invoices} invoice(s) are overdue with GHS ${receivables.overdue_amount} outstanding.`);
  }
  if (returns.returns_due_or_incomplete > 0) {
    add("warning", "returns_due", `${returns.returns_due_or_incomplete} contract asset return(s) are due or incomplete.`);
  }
  if (returns.contracts_ready_for_closure > 0) {
    add("review", "closure_ready", `${returns.contracts_ready_for_closure} contract(s) appear ready for operational closure review.`);
  }
  if (pipeline.active_contracts > 0 && fleet.assets_on_hire === 0) {
    add("warning", "contract_asset_mismatch", "Active contracts exist but no active hire asset assignments were counted.");
  }
  return alerts;
}

async function loadHireIntelligence({ context, connection = pool } = {}) {
  const locationId = Number(context?.scope?.hire_location_id || 0);
  if (!Number.isInteger(locationId) || locationId <= 0) {
    throw hireError("Choose an authorized Equipment Hire location before requesting Hire intelligence.", "AI_HIRE_LOCATION_SCOPE_REQUIRED", 409);
  }

  try {
    const agingBucket = agingBucketSql("hi");
    const [
      [locationRows],
      [fleetRows],
      [assetHireRows],
      [enquiryRows],
      [quotationRows],
      [contractRows],
      [workRows],
      [invoiceRows],
      [agingRows],
      [returnRows],
      [readyClosureRows],
    ] = await Promise.all([
      connection.query(
        `SELECT bl.id, bl.code, bl.name, bl.location_type, bl.address,
                bu.code AS business_unit_code, bu.name AS business_unit_name
         FROM business_locations bl
         INNER JOIN business_units bu ON bu.id = bl.business_unit_id
         WHERE bl.id = ? AND bl.is_active = TRUE
           AND bu.code = 'equipment_hire' AND bu.is_enabled = TRUE
         LIMIT 1`,
        [locationId]
      ),
      connection.query(
        `SELECT COUNT(*) AS total_assets,
                COALESCE(SUM(CASE WHEN current_status IN ('available', 'idle') THEN 1 ELSE 0 END), 0) AS available_assets,
                COALESCE(SUM(CASE WHEN current_status IN ('maintenance', 'breakdown') THEN 1 ELSE 0 END), 0) AS maintenance_assets
         FROM fleet_assets
         WHERE is_active = TRUE AND hire_location_id = ?`,
        [locationId]
      ),
      connection.query(
        `SELECT COUNT(DISTINCT hca.asset_id) AS assets_on_hire,
                COALESCE(SUM(CASE WHEN hca.status = 'returned' THEN 1 ELSE 0 END), 0) AS returned_asset_assignments
         FROM hire_contract_assets hca
         INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
         WHERE hc.hire_location_id = ?
           AND hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
           AND hca.status IN ('assigned', 'dispatched', 'active', 'returned')`,
        [locationId]
      ),
      connection.query(
        `SELECT COUNT(*) AS total_enquiries,
                COALESCE(SUM(CASE WHEN status IN ('open', 'quoted') THEN 1 ELSE 0 END), 0) AS active_enquiries,
                COALESCE(SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END), 0) AS won_enquiries,
                COALESCE(SUM(CASE WHEN status IN ('lost', 'cancelled') THEN 1 ELSE 0 END), 0) AS inactive_enquiries
         FROM hire_enquiries
         WHERE hire_location_id = ?`,
        [locationId]
      ),
      connection.query(
        `SELECT COUNT(*) AS total_quotations,
                COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_quotations,
                COALESCE(SUM(CASE WHEN status IN ('approved', 'accepted') THEN 1 ELSE 0 END), 0) AS approved_quotations,
                COALESCE(SUM(CASE WHEN status IN ('rejected', 'expired') THEN 1 ELSE 0 END), 0) AS inactive_quotations,
                COALESCE(SUM(CASE WHEN status NOT IN ('rejected', 'expired') THEN total_amount ELSE 0 END), 0) AS open_quotation_value
         FROM hire_quotations
         WHERE hire_location_id = ?`,
        [locationId]
      ),
      connection.query(
        `SELECT COUNT(*) AS total_contracts,
                COALESCE(SUM(CASE WHEN status IN ('confirmed', 'mobilizing', 'active', 'suspended') THEN 1 ELSE 0 END), 0) AS active_contracts,
                COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_contracts,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_contracts,
                COALESCE(SUM(CASE WHEN operational_status = 'returned_pending_closure' THEN 1 ELSE 0 END), 0) AS returned_pending_closure,
                COALESCE(SUM(CASE WHEN financial_status = 'outstanding' THEN 1 ELSE 0 END), 0) AS closed_with_balance
         FROM hire_contracts
         WHERE hire_location_id = ?`,
        [locationId]
      ),
      connection.query(
        `SELECT COUNT(*) AS work_logs,
                COALESCE(SUM(CASE WHEN work_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN billable_hours ELSE 0 END), 0) AS billable_hours_30d,
                COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS unapproved_logs,
                COALESCE(SUM(CASE WHEN work_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN breakdown_hours ELSE 0 END), 0) AS breakdown_hours_30d,
                COALESCE(SUM(CASE WHEN hwl.status = 'approved' AND hil.id IS NULL THEN 1 ELSE 0 END), 0) AS approved_uninvoiced_work_logs
         FROM hire_work_logs hwl
         LEFT JOIN hire_invoice_lines hil ON hil.work_log_id = hwl.id
         WHERE hwl.hire_location_id = ?`,
        [locationId]
      ),
      connection.query(
        `SELECT COUNT(*) AS invoices,
                COALESCE(SUM(CASE WHEN status <> 'void' THEN total_amount ELSE 0 END), 0) AS invoiced_amount,
                COALESCE(SUM(CASE WHEN status <> 'void' THEN amount_paid ELSE 0 END), 0) AS paid_amount,
                COALESCE(SUM(CASE WHEN status <> 'void' THEN balance ELSE 0 END), 0) AS outstanding_amount,
                COALESCE(SUM(CASE WHEN status <> 'void' AND balance > 0 THEN 1 ELSE 0 END), 0) AS outstanding_invoices,
                COALESCE(SUM(CASE WHEN status <> 'void' AND balance > 0 AND due_date < CURDATE() THEN 1 ELSE 0 END), 0) AS overdue_invoices,
                COALESCE(SUM(CASE WHEN status <> 'void' AND balance > 0 AND due_date < CURDATE() THEN balance ELSE 0 END), 0) AS overdue_amount
         FROM hire_invoices
         WHERE hire_location_id = ?`,
        [locationId]
      ),
      connection.query(
        `SELECT ${agingBucket} AS bucket,
                COUNT(*) AS invoice_count,
                COALESCE(SUM(hi.balance), 0) AS balance
         FROM hire_invoices hi
         WHERE hi.hire_location_id = ?
           AND hi.status <> 'void' AND hi.balance > 0
         GROUP BY bucket`,
        [locationId]
      ),
      connection.query(
        `SELECT COUNT(DISTINCT hca.id) AS returns_due_or_incomplete
         FROM hire_contract_assets hca
         INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
         WHERE hc.hire_location_id = ?
           AND hca.status IN ('assigned', 'dispatched', 'active')
           AND hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
           AND (hca.assigned_to < NOW() OR (hc.expected_end_date IS NOT NULL AND hc.expected_end_date < CURDATE()))`,
        [locationId]
      ),
      connection.query(
        `SELECT COUNT(*) AS contracts_ready_for_closure
         FROM hire_contracts hc
         WHERE hc.hire_location_id = ?
           AND hc.status NOT IN ('completed', 'cancelled')
           AND EXISTS (SELECT 1 FROM hire_contract_assets hca WHERE hca.contract_id = hc.id AND hca.status = 'returned')
           AND NOT EXISTS (SELECT 1 FROM hire_contract_assets hca WHERE hca.contract_id = hc.id AND hca.status IN ('assigned', 'dispatched', 'active'))
           AND NOT EXISTS (SELECT 1 FROM hire_work_logs hwl WHERE hwl.contract_id = hc.id AND hwl.status = 'draft')
           AND NOT EXISTS (
             SELECT 1 FROM hire_work_logs hwl
             LEFT JOIN hire_invoice_lines hil ON hil.work_log_id = hwl.id
             WHERE hwl.contract_id = hc.id AND hwl.status = 'approved' AND hil.id IS NULL
           )`,
        [locationId]
      ),
    ]);

    const location = locationRows[0];
    if (!location) {
      throw hireError("The selected Equipment Hire location is unavailable.", "AI_HIRE_LOCATION_NOT_FOUND", 404);
    }

    const fleetBase = fleetRows[0] || {};
    const assetHire = assetHireRows[0] || {};
    const fleet = Object.freeze({
      total_assets: Number(fleetBase.total_assets || 0),
      available_assets: Number(fleetBase.available_assets || 0),
      maintenance_assets: Number(fleetBase.maintenance_assets || 0),
      assets_on_hire: Number(assetHire.assets_on_hire || 0),
      returned_asset_assignments: Number(assetHire.returned_asset_assignments || 0),
    });

    const enquiries = enquiryRows[0] || {};
    const quotations = quotationRows[0] || {};
    const contracts = contractRows[0] || {};
    const pipeline = Object.freeze({
      total_enquiries: Number(enquiries.total_enquiries || 0),
      active_enquiries: Number(enquiries.active_enquiries || 0),
      won_enquiries: Number(enquiries.won_enquiries || 0),
      inactive_enquiries: Number(enquiries.inactive_enquiries || 0),
      total_quotations: Number(quotations.total_quotations || 0),
      draft_quotations: Number(quotations.draft_quotations || 0),
      approved_quotations: Number(quotations.approved_quotations || 0),
      inactive_quotations: Number(quotations.inactive_quotations || 0),
      open_quotation_value: money(quotations.open_quotation_value),
      total_contracts: Number(contracts.total_contracts || 0),
      active_contracts: Number(contracts.active_contracts || 0),
      draft_contracts: Number(contracts.draft_contracts || 0),
      completed_contracts: Number(contracts.completed_contracts || 0),
      returned_pending_closure: Number(contracts.returned_pending_closure || 0),
      closed_with_balance: Number(contracts.closed_with_balance || 0),
    });

    const workBase = workRows[0] || {};
    const work = Object.freeze({
      work_logs: Number(workBase.work_logs || 0),
      billable_hours_30d: money(workBase.billable_hours_30d),
      breakdown_hours_30d: money(workBase.breakdown_hours_30d),
      unapproved_logs: Number(workBase.unapproved_logs || 0),
      approved_uninvoiced_work_logs: Number(workBase.approved_uninvoiced_work_logs || 0),
    });

    const invoice = invoiceRows[0] || {};
    const aging = {
      current: { invoice_count: 0, balance: 0 },
      "1_30": { invoice_count: 0, balance: 0 },
      "31_60": { invoice_count: 0, balance: 0 },
      "61_90": { invoice_count: 0, balance: 0 },
      over_90: { invoice_count: 0, balance: 0 },
    };
    agingRows.forEach((row) => {
      if (!aging[row.bucket]) return;
      aging[row.bucket] = {
        invoice_count: Number(row.invoice_count || 0),
        balance: money(row.balance),
      };
    });

    const receivables = Object.freeze({
      invoices: Number(invoice.invoices || 0),
      invoiced_amount: money(invoice.invoiced_amount),
      paid_amount: money(invoice.paid_amount),
      outstanding_amount: money(invoice.outstanding_amount),
      outstanding_invoices: Number(invoice.outstanding_invoices || 0),
      overdue_invoices: Number(invoice.overdue_invoices || 0),
      overdue_amount: money(invoice.overdue_amount),
      collection_rate: asNumber(invoice.invoiced_amount) > 0
        ? Number(((asNumber(invoice.paid_amount) / asNumber(invoice.invoiced_amount)) * 100).toFixed(2))
        : 0,
      aging: Object.freeze(aging),
    });

    const returns = Object.freeze({
      returns_due_or_incomplete: Number(returnRows[0]?.returns_due_or_incomplete || 0),
      contracts_ready_for_closure: Number(readyClosureRows[0]?.contracts_ready_for_closure || 0),
    });

    return Object.freeze({
      scope: Object.freeze({
        workspace_code: "equipment_hire",
        hire_location_id: locationId,
        hire_location_code: location.code || null,
        hire_location_name: location.name || null,
        location_type: location.location_type || null,
        address: location.address || null,
      }),
      fleet,
      pipeline,
      work,
      receivables,
      returns,
      alerts: Object.freeze(buildAlerts({ fleet, pipeline, work, receivables, returns })),
      generated_at: new Date().toISOString(),
      execution_authority: "read_only",
    });
  } catch (error) {
    if (String(error?.code || "").startsWith("AI_")) throw error;
    throw hireError("Equipment Hire intelligence could not be loaded safely.");
  }
}

function buildOperationsSnapshot(intelligence) {
  return {
    scope: intelligence.scope,
    fleet: intelligence.fleet,
    pipeline: intelligence.pipeline,
    work: intelligence.work,
    receivables: intelligence.receivables,
    returns: intelligence.returns,
    alerts: intelligence.alerts,
    generated_at: intelligence.generated_at,
  };
}

function buildFleetHealth(intelligence) {
  return {
    scope: intelligence.scope,
    fleet: intelligence.fleet,
    work: intelligence.work,
    contracts: {
      active_contracts: intelligence.pipeline.active_contracts,
      returned_pending_closure: intelligence.pipeline.returned_pending_closure,
    },
    returns: intelligence.returns,
    alerts: intelligence.alerts.filter((item) => [
      "maintenance_assets",
      "unapproved_work_logs",
      "uninvoiced_work",
      "returns_due",
      "closure_ready",
      "contract_asset_mismatch",
    ].includes(item.key)),
    generated_at: intelligence.generated_at,
  };
}

function buildReceivablesHealth(intelligence) {
  return {
    scope: intelligence.scope,
    receivables: intelligence.receivables,
    commercial_pipeline: {
      open_quotation_value: intelligence.pipeline.open_quotation_value,
      active_contracts: intelligence.pipeline.active_contracts,
      closed_with_balance: intelligence.pipeline.closed_with_balance,
    },
    alerts: intelligence.alerts.filter((item) => ["overdue_invoices", "uninvoiced_work"].includes(item.key)),
    generated_at: intelligence.generated_at,
  };
}

module.exports = {
  buildFleetHealth,
  buildOperationsSnapshot,
  buildReceivablesHealth,
  loadHireIntelligence,
};