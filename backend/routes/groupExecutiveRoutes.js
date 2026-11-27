const express = require("express");
const ExcelJS = require("../services/excelJsCompat");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  loadGroupCommandCentreSummary,
} = require("../services/groupCommandCentreService");
const {
  buildExecutiveIntelligence,
} = require("../services/executiveIntelligenceService");
const { writeSharedControlEvidence } = require("../services/sharedControlService");

const router = express.Router();

function dateOnly(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function firstDayOfMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getDateRange(req) {
  const from = dateOnly(req.query.from) || firstDayOfMonth();
  const to = dateOnly(req.query.to) || today();

  return from <= to ? { from, to } : { from: to, to: from };
}

function positiveId(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function currentBranchId(req) {
  return positiveId(
    req.user?.branch_id ||
      req.user?.default_branch_id ||
      req.user?.selected_branch?.id,
    1
  );
}

function canAccessAllBranches(req) {
  return (
    req.user?.can_access_all_branches === true ||
    Number(req.user?.can_access_all_branches || 0) === 1
  );
}

function resolveBranchScope(req) {
  const requestedAll = String(req.query.branch_scope || "").toLowerCase() === "all";
  const allBranches = requestedAll && canAccessAllBranches(req);

  return {
    all: allBranches,
    branchId: currentBranchId(req),
    requestedAll,
    canAccessAll: canAccessAllBranches(req),
  };
}

function isMissingTableError(error) {
  return error?.code === "ER_NO_SUCH_TABLE" || Number(error?.errno) === 1146;
}

function sendSetupError(res, error) {
  if (!isMissingTableError(error)) return false;

  res.status(503).json({
    status: "error",
    code: "GROUP_EXECUTIVE_DATABASE_SETUP_REQUIRED",
    message:
      "One or more Fleet, Mining or Equipment Hire tables are missing. Run the complete Chalin 03 master schema before opening Group Executive Control.",
    technical_message: error.message,
  });

  return true;
}

function mergeRowsByBranch(branches, salesRows, expenseRows, debtRows, stockRows) {
  const sales = new Map(salesRows.map((row) => [Number(row.branch_id), row]));
  const expenses = new Map(
    expenseRows.map((row) => [Number(row.branch_id), row])
  );
  const debts = new Map(debtRows.map((row) => [Number(row.branch_id), row]));
  const stocks = new Map(stockRows.map((row) => [Number(row.branch_id), row]));

  return branches.map((branch) => {
    const id = Number(branch.id);
    const sale = sales.get(id) || {};
    const expense = expenses.get(id) || {};
    const debt = debts.get(id) || {};
    const stock = stocks.get(id) || {};

    return {
      id,
      branch_code: branch.branch_code,
      branch_name: branch.name,
      location: branch.location,
      sales_count: numeric(sale.sales_count),
      sales_total: numeric(sale.sales_total),
      sales_received: numeric(sale.sales_received),
      sales_balance: numeric(sale.sales_balance),
      expenses_total: numeric(expense.expenses_total),
      expense_count: numeric(expense.expense_count),
      debt_balance: numeric(debt.debt_balance),
      debt_accounts: numeric(debt.debt_accounts),
      product_count: numeric(stock.product_count),
      quantity_total: numeric(stock.quantity_total),
      stock_value_cost: numeric(stock.stock_value_cost),
      stock_value_selling: numeric(stock.stock_value_selling),
      low_stock_count: numeric(stock.low_stock_count),
      estimated_store_margin:
        numeric(sale.sales_total) - numeric(expense.expenses_total),
    };
  });
}

function totalsFromBranches(branchRows) {
  return branchRows.reduce(
    (totals, row) => {
      Object.keys(totals).forEach((key) => {
        totals[key] += numeric(row[key]);
      });
      return totals;
    },
    {
      sales_count: 0,
      sales_total: 0,
      sales_received: 0,
      sales_balance: 0,
      expenses_total: 0,
      expense_count: 0,
      debt_balance: 0,
      debt_accounts: 0,
      product_count: 0,
      quantity_total: 0,
      stock_value_cost: 0,
      stock_value_selling: 0,
      low_stock_count: 0,
      estimated_store_margin: 0,
    }
  );
}

function buildRecommendations(summary) {
  const recommendations = [];
  const add = (priority, area, title, detail, path) => {
    recommendations.push({ priority, area, title, detail, path });
  };

  if (summary.spare_parts.low_stock_count > 0) {
    add(
      "high",
      "Spare Parts",
      "Review low-stock products",
      `${summary.spare_parts.low_stock_count} product record(s) are at or below their restock level.`,
      "/low-stock"
    );
  }

  if (summary.spare_parts.debt_balance > 0) {
    add(
      "medium",
      "Spare Parts",
      "Follow up outstanding store debt",
      `Current spare-parts debt is GHS ${summary.spare_parts.debt_balance.toFixed(
        2
      )}.`,
      "/debts"
    );
  }

  if (summary.cash_control.changed_after_close_count > 0) {
    add(
      "critical",
      "Cash Control",
      "Reconcile records changed after closing",
      `${summary.cash_control.changed_after_close_count} Daily Closing record(s) changed after submission and require management reconciliation.`,
      "/daily-closing"
    );
  }

  if (summary.cash_control.awaiting_verification_count > 0) {
    add(
      "high",
      "Cash Control",
      "Complete independent closing verification",
      `${summary.cash_control.awaiting_verification_count} submitted closing(s) are awaiting an independent manager check.`,
      "/daily-closing"
    );
  }

  if (summary.cash_control.variance_count > 0) {
    add(
      "high",
      "Cash Control",
      "Review Daily Closing variances",
      `${summary.cash_control.variance_count} closing(s) contain a shortage or excess. Total absolute variance is GHS ${summary.cash_control.absolute_variance.toFixed(2)}.`,
      "/daily-closing"
    );
  }

  if (summary.hire.overdue_balance > 0) {
    add(
      "high",
      "Equipment Hire",
      "Collect overdue hire invoices",
      `${summary.hire.overdue_invoice_count} overdue invoice(s) total GHS ${summary.hire.overdue_balance.toFixed(
        2
      )}.`,
      "/equipment-hire-operations"
    );
  }

  if (summary.hire.unapproved_work_logs > 0) {
    add(
      "medium",
      "Equipment Hire",
      "Approve pending job cards",
      `${summary.hire.unapproved_work_logs} work log(s) are still awaiting approval.`,
      "/equipment-hire-operations"
    );
  }

  if (summary.mining.open_incidents > 0) {
    add(
      summary.mining.serious_open_incidents > 0 ? "critical" : "high",
      "Mining",
      "Resolve open mining incidents",
      `${summary.mining.open_incidents} incident(s) remain open, including ${summary.mining.serious_open_incidents} serious case(s).`,
      "/mining"
    );
  }

  if (summary.mining.unapproved_daily_logs > 0) {
    add(
      "medium",
      "Mining",
      "Approve outstanding daily logs",
      `${summary.mining.unapproved_daily_logs} mining daily log(s) are not yet approved.`,
      "/mining"
    );
  }

  if (summary.fleet.service_due_count > 0) {
    add(
      "high",
      "Fleet",
      "Service equipment that is due",
      `${summary.fleet.service_due_count} fleet asset(s) have reached or passed the next service meter.`,
      "/fleet-assets"
    );
  }

  if (summary.fleet.expiring_document_count > 0) {
    add(
      "high",
      "Fleet",
      "Renew expiring fleet documents",
      `${summary.fleet.expiring_document_count} asset document(s) expire within 30 days or are already expired.`,
      "/fleet-assets"
    );
  }

  if (summary.fleet.open_maintenance_count > 0) {
    add(
      "medium",
      "Fleet",
      "Close open maintenance jobs",
      `${summary.fleet.open_maintenance_count} maintenance or breakdown record(s) remain open.`,
      "/fleet-assets"
    );
  }

  if (recommendations.length === 0) {
    add(
      "low",
      "Group",
      "No urgent exception detected",
      "Continue recording complete daily logs, approvals, payments, expenses and equipment readings.",
      "/group-executive-control"
    );
  }

  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return recommendations.sort(
    (left, right) => rank[left.priority] - rank[right.priority]
  );
}

async function loadGroupSummary(req) {
  const { from, to } = getDateRange(req);
  const scope = resolveBranchScope(req);

  const branchFilter = scope.all ? "" : "AND branch_id = ?";
  const branchParams = scope.all ? [] : [scope.branchId];
  const branchSelectWhere = scope.all ? "" : "WHERE id = ?";
  const branchSelectParams = scope.all ? [] : [scope.branchId];

  const [
    [branchRows],
    [salesRows],
    [expenseRows],
    [debtRows],
    [stockRows],
    [productionByUnit],
    [miningCostRows],
    [miningHoursRows],
    [miningIncidentRows],
    [miningDailyLogRows],
    [miningSiteRows],
    [hireInvoiceRows],
    [hirePaymentRows],
    [hireContractRows],
    [hireWorkRows],
    [hireCustomerRows],
    [fleetSummaryRows],
    [fleetStatusRows],
    [fleetServiceRows],
    [fleetDocumentRows],
    [fleetMaintenanceRows],
    [fleetUtilizationRows],
    [lowStockRows],
    [overdueInvoiceRows],
    [seriousIncidentRows],
    [pendingDailyLogRows],
    [pendingWorkLogRows],
    [cashControlRows],
    [closingAlertRows],
    [financialTrendRows],
  ] = await Promise.all([
    pool.query(
      `SELECT id, branch_code, name, location
       FROM branches
       ${branchSelectWhere}
       ORDER BY is_head_office DESC, id ASC`,
      branchSelectParams
    ),
    pool.query(
      `SELECT branch_id,
              COUNT(*) AS sales_count,
              COALESCE(SUM(total), 0) AS sales_total,
              COALESCE(SUM(amount_paid), 0) AS sales_received,
              COALESCE(SUM(balance), 0) AS sales_balance
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?
         AND is_voided = 0
         AND sale_status = 'completed'
         ${branchFilter}
       GROUP BY branch_id`,
      [from, to, ...branchParams]
    ),
    pool.query(
      `SELECT branch_id,
              COUNT(*) AS expense_count,
              COALESCE(SUM(amount), 0) AS expenses_total
       FROM expenses
       WHERE expense_date BETWEEN ? AND ?
         ${branchFilter}
       GROUP BY branch_id`,
      [from, to, ...branchParams]
    ),
    pool.query(
      `SELECT branch_id,
              COUNT(*) AS debt_accounts,
              COALESCE(SUM(balance), 0) AS debt_balance
       FROM debts
       WHERE balance > 0
         AND status <> 'paid'
         ${branchFilter}
       GROUP BY branch_id`,
      branchParams
    ),
    pool.query(
      `SELECT branch_id,
              COUNT(*) AS product_count,
              COALESCE(SUM(quantity), 0) AS quantity_total,
              COALESCE(SUM(quantity * cost_price), 0) AS stock_value_cost,
              COALESCE(SUM(quantity * selling_price), 0) AS stock_value_selling,
              COALESCE(SUM(CASE WHEN quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) AS low_stock_count
       FROM products
       WHERE is_active = TRUE
         ${branchFilter}
       GROUP BY branch_id`,
      branchParams
    ),
    pool.query(
      `SELECT unit,
              COALESCE(SUM(quantity), 0) AS quantity
       FROM mining_production_records
       WHERE DATE(production_datetime) BETWEEN ? AND ?
       GROUP BY unit
       ORDER BY unit ASC`,
      [from, to]
    ),
    pool.query(
      `SELECT
         COALESCE((SELECT SUM(amount)
                   FROM mining_expenses
                   WHERE expense_date BETWEEN ? AND ?), 0) AS expenses_total,
         COALESCE((SELECT SUM(total_cost)
                   FROM mining_fuel_logs
                   WHERE DATE(log_datetime) BETWEEN ? AND ?
                     AND LOWER(transaction_type) = 'issue'), 0) AS fuel_cost,
         COALESCE((SELECT SUM(quantity_litres)
                   FROM mining_fuel_logs
                   WHERE DATE(log_datetime) BETWEEN ? AND ?
                     AND LOWER(transaction_type) = 'issue'), 0) AS fuel_litres`,
      [from, to, from, to, from, to]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(working_hours), 0) AS working_hours,
         COALESCE(SUM(idle_hours), 0) AS idle_hours,
         COALESCE(SUM(breakdown_hours), 0) AS breakdown_hours,
         COUNT(DISTINCT asset_id) AS active_assets
       FROM mining_equipment_logs
       WHERE work_date BETWEEN ? AND ?`,
      [from, to]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status NOT IN ('closed', 'resolved') THEN 1 ELSE 0 END), 0) AS open_incidents,
         COALESCE(SUM(CASE WHEN status NOT IN ('closed', 'resolved')
                                AND LOWER(severity) IN ('high', 'critical', 'serious')
                           THEN 1 ELSE 0 END), 0) AS serious_open_incidents,
         COUNT(*) AS period_incidents
       FROM mining_incidents
       WHERE DATE(incident_datetime) BETWEEN ? AND ?`,
      [from, to]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN LOWER(status) <> 'approved' THEN 1 ELSE 0 END), 0) AS unapproved_daily_logs,
         COUNT(*) AS daily_log_count
       FROM mining_daily_logs
       WHERE log_date BETWEEN ? AND ?`,
      [from, to]
    ),
    pool.query(
      `SELECT ms.id,
              ms.site_code,
              ms.site_name,
              ms.location,
              ms.status,
              ms.production_unit,
              ms.daily_target,
              COALESCE(pr.production_quantity, 0) AS production_quantity,
              COALESCE(el.working_hours, 0) AS working_hours,
              COALESCE(me.expenses_total, 0) AS expenses_total
       FROM mining_sites ms
       LEFT JOIN (
         SELECT site_id, SUM(quantity) AS production_quantity
         FROM mining_production_records
         WHERE DATE(production_datetime) BETWEEN ? AND ?
         GROUP BY site_id
       ) pr ON pr.site_id = ms.id
       LEFT JOIN (
         SELECT site_id, SUM(working_hours) AS working_hours
         FROM mining_equipment_logs
         WHERE work_date BETWEEN ? AND ?
         GROUP BY site_id
       ) el ON el.site_id = ms.id
       LEFT JOIN (
         SELECT site_id, SUM(amount) AS expenses_total
         FROM mining_expenses
         WHERE expense_date BETWEEN ? AND ?
         GROUP BY site_id
       ) me ON me.site_id = ms.id
       WHERE ms.is_active = TRUE
       ORDER BY ms.site_name ASC`,
      [from, to, from, to, from, to]
    ),
    pool.query(
      `SELECT
         COUNT(*) AS invoice_count,
         COALESCE(SUM(total_amount), 0) AS invoiced_total,
         COALESCE(SUM(amount_paid), 0) AS invoice_paid,
         COALESCE(SUM(balance), 0) AS invoice_balance,
         COALESCE(SUM(CASE WHEN balance > 0
                                AND due_date IS NOT NULL
                                AND due_date < CURDATE()
                                AND LOWER(status) NOT IN ('paid', 'void')
                           THEN 1 ELSE 0 END), 0) AS overdue_invoice_count,
         COALESCE(SUM(CASE WHEN balance > 0
                                AND due_date IS NOT NULL
                                AND due_date < CURDATE()
                                AND LOWER(status) NOT IN ('paid', 'void')
                           THEN balance ELSE 0 END), 0) AS overdue_balance
       FROM hire_invoices
       WHERE invoice_date BETWEEN ? AND ?`,
      [from, to]
    ),
    pool.query(
      `SELECT COUNT(*) AS payment_count,
              COALESCE(SUM(amount), 0) AS payments_total
       FROM hire_payments
       WHERE DATE(payment_date) BETWEEN ? AND ?`,
      [from, to]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN LOWER(status) IN ('confirmed', 'mobilizing', 'active', 'suspended') THEN 1 ELSE 0 END), 0) AS active_contracts,
         COUNT(*) AS contract_count,
         COALESCE(SUM(deposit_received), 0) AS deposits_received
       FROM hire_contracts
       WHERE start_date <= ?
         AND (expected_end_date IS NULL OR expected_end_date >= ?)`,
      [to, from]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(billable_hours), 0) AS billable_hours,
         COALESCE(SUM(idle_hours), 0) AS idle_hours,
         COALESCE(SUM(breakdown_hours), 0) AS breakdown_hours,
         COALESCE(SUM(CASE WHEN LOWER(status) <> 'approved' THEN 1 ELSE 0 END), 0) AS unapproved_work_logs,
         COUNT(DISTINCT asset_id) AS active_assets
       FROM hire_work_logs
       WHERE work_date BETWEEN ? AND ?`,
      [from, to]
    ),
    pool.query(
      `SELECT c.id,
              c.customer_code,
              c.customer_name,
              c.phone,
              COALESCE(SUM(CASE WHEN i.invoice_date BETWEEN ? AND ? THEN i.total_amount ELSE 0 END), 0) AS invoiced_total,
              COALESCE(SUM(CASE WHEN i.invoice_date BETWEEN ? AND ? THEN i.amount_paid ELSE 0 END), 0) AS paid_total,
              COALESCE(SUM(CASE WHEN i.invoice_date BETWEEN ? AND ? THEN i.balance ELSE 0 END), 0) AS balance_total
       FROM hire_customers c
       LEFT JOIN hire_invoices i ON i.customer_id = c.id
       WHERE c.is_active = TRUE
       GROUP BY c.id, c.customer_code, c.customer_name, c.phone
       ORDER BY invoiced_total DESC, c.customer_name ASC
       LIMIT 25`,
      [from, to, from, to, from, to]
    ),
    pool.query(
      `SELECT
         COUNT(*) AS total_assets,
         COALESCE(SUM(CASE WHEN LOWER(current_status) IN ('available', 'idle') THEN 1 ELSE 0 END), 0) AS available_assets,
         COALESCE(SUM(CASE WHEN LOWER(current_status) IN ('working', 'assigned_mining', 'assigned_hire', 'mobilizing') THEN 1 ELSE 0 END), 0) AS assigned_assets,
         COALESCE(SUM(CASE WHEN LOWER(current_status) IN ('maintenance', 'breakdown') THEN 1 ELSE 0 END), 0) AS unavailable_assets
       FROM fleet_assets
       WHERE is_active = TRUE`
    ),
    pool.query(
      `SELECT current_status, COUNT(*) AS asset_count
       FROM fleet_assets
       WHERE is_active = TRUE
       GROUP BY current_status
       ORDER BY asset_count DESC, current_status ASC`
    ),
    pool.query(
      `SELECT id, asset_code, asset_name, current_meter, next_service_meter,
              current_status, current_location
       FROM fleet_assets
       WHERE is_active = TRUE
         AND next_service_meter IS NOT NULL
         AND current_meter >= next_service_meter
       ORDER BY (current_meter - next_service_meter) DESC
       LIMIT 25`
    ),
    pool.query(
      `SELECT id, asset_code, asset_name, insurance_expiry, registration_expiry,
              current_status, current_location
       FROM fleet_assets
       WHERE is_active = TRUE
         AND (
           (insurance_expiry IS NOT NULL AND insurance_expiry <= DATE_ADD(CURDATE(), INTERVAL 30 DAY))
           OR
           (registration_expiry IS NOT NULL AND registration_expiry <= DATE_ADD(CURDATE(), INTERVAL 30 DAY))
         )
       ORDER BY LEAST(
         COALESCE(insurance_expiry, '9999-12-31'),
         COALESCE(registration_expiry, '9999-12-31')
       ) ASC
       LIMIT 25`
    ),
    pool.query(
      `SELECT COUNT(*) AS open_maintenance_count,
              COALESCE(SUM(cost_amount), 0) AS open_maintenance_cost
       FROM fleet_maintenance_records
       WHERE LOWER(status) NOT IN ('completed', 'closed', 'resolved')`
    ),
    pool.query(
      `SELECT fa.id,
              fa.asset_code,
              fa.asset_name,
              fa.current_status,
              fa.current_location,
              COALESCE(m.working_hours, 0) AS mining_working_hours,
              COALESCE(h.billable_hours, 0) AS hire_billable_hours,
              COALESCE(m.breakdown_hours, 0) + COALESCE(h.breakdown_hours, 0) AS breakdown_hours
       FROM fleet_assets fa
       LEFT JOIN (
         SELECT asset_id,
                SUM(working_hours) AS working_hours,
                SUM(breakdown_hours) AS breakdown_hours
         FROM mining_equipment_logs
         WHERE work_date BETWEEN ? AND ?
         GROUP BY asset_id
       ) m ON m.asset_id = fa.id
       LEFT JOIN (
         SELECT asset_id,
                SUM(billable_hours) AS billable_hours,
                SUM(breakdown_hours) AS breakdown_hours
         FROM hire_work_logs
         WHERE work_date BETWEEN ? AND ?
         GROUP BY asset_id
       ) h ON h.asset_id = fa.id
       WHERE fa.is_active = TRUE
       ORDER BY (COALESCE(m.working_hours, 0) + COALESCE(h.billable_hours, 0)) DESC,
                fa.asset_name ASC
       LIMIT 30`,
      [from, to, from, to]
    ),
    pool.query(
      `SELECT p.id, p.name AS product_name, p.quantity, p.low_stock_threshold AS low_stock_level,
              b.branch_code, b.name AS branch_name
       FROM products p
       INNER JOIN branches b ON b.id = p.branch_id
       WHERE p.is_active = TRUE
         AND p.quantity <= p.low_stock_threshold
         ${scope.all ? "" : "AND p.branch_id = ?"}
       ORDER BY (p.low_stock_threshold - p.quantity) DESC, p.name ASC
       LIMIT 20`,
      branchParams
    ),
    pool.query(
      `SELECT i.id, i.invoice_number, i.due_date, i.balance,
              c.customer_name, hc.contract_number
       FROM hire_invoices i
       INNER JOIN hire_customers c ON c.id = i.customer_id
       INNER JOIN hire_contracts hc ON hc.id = i.contract_id
       WHERE i.balance > 0
         AND i.due_date IS NOT NULL
         AND i.due_date < CURDATE()
         AND LOWER(i.status) NOT IN ('paid', 'void')
       ORDER BY i.due_date ASC, i.balance DESC
       LIMIT 20`
    ),
    pool.query(
      `SELECT mi.id, mi.incident_datetime, mi.incident_type, mi.severity,
              mi.status, ms.site_name
       FROM mining_incidents mi
       INNER JOIN mining_sites ms ON ms.id = mi.site_id
       WHERE LOWER(mi.status) NOT IN ('closed', 'resolved')
       ORDER BY FIELD(LOWER(mi.severity), 'critical', 'serious', 'high', 'medium', 'low'),
                mi.incident_datetime ASC
       LIMIT 20`
    ),
    pool.query(
      `SELECT dl.id, dl.log_date, dl.shift_code, dl.status, ms.site_name
       FROM mining_daily_logs dl
       INNER JOIN mining_sites ms ON ms.id = dl.site_id
       WHERE LOWER(dl.status) <> 'approved'
       ORDER BY dl.log_date ASC
       LIMIT 20`
    ),
    pool.query(
      `SELECT wl.id, wl.work_date, wl.status, wl.billable_hours,
              hc.contract_number, c.customer_name, fa.asset_code, fa.asset_name
       FROM hire_work_logs wl
       INNER JOIN hire_contracts hc ON hc.id = wl.contract_id
       INNER JOIN hire_customers c ON c.id = hc.customer_id
       INNER JOIN fleet_assets fa ON fa.id = wl.asset_id
       WHERE LOWER(wl.status) <> 'approved'
       ORDER BY wl.work_date ASC
       LIMIT 20`
    ),
    pool.query(
      `SELECT
         SUM(closing_count) AS closing_count,
         SUM(variance_count) AS variance_count,
         SUM(shortage_count) AS shortage_count,
         COALESCE(SUM(shortage_total), 0) AS shortage_total,
         COALESCE(SUM(absolute_variance), 0) AS absolute_variance,
         SUM(awaiting_verification_count) AS awaiting_verification_count,
         SUM(changed_after_close_count) AS changed_after_close_count,
         SUM(legacy_unconfirmed_count) AS legacy_unconfirmed_count,
         SUM(protected_sale_change_count) AS protected_sale_change_count,
         SUM(protected_void_count) AS protected_void_count,
         SUM(refund_count) AS refund_count,
         COALESCE(SUM(refund_total), 0) AS refund_total,
         MAX(latest_closing_date) AS latest_closing_date
       FROM (
         SELECT
           COUNT(*) AS closing_count,
           SUM(CASE WHEN ABS(dc.difference_total) >= 0.01 THEN 1 ELSE 0 END) AS variance_count,
           SUM(CASE WHEN dc.difference_total < -0.009 THEN 1 ELSE 0 END) AS shortage_count,
           COALESCE(SUM(CASE WHEN dc.difference_total < -0.009 THEN ABS(dc.difference_total) ELSE 0 END), 0) AS shortage_total,
           COALESCE(SUM(ABS(dc.difference_total)), 0) AS absolute_variance,
           SUM(CASE WHEN dc.counted_confirmed = 1 AND dc.verification_status <> 'verified' THEN 1 ELSE 0 END) AS awaiting_verification_count,
           SUM(CASE WHEN dc.stale_after_close = 1 THEN 1 ELSE 0 END) AS changed_after_close_count,
           SUM(CASE WHEN dc.counted_confirmed = 0 THEN 1 ELSE 0 END) AS legacy_unconfirmed_count,
           0 AS protected_sale_change_count,
           0 AS protected_void_count,
           0 AS refund_count,
           0 AS refund_total,
           MAX(dc.closing_date) AS latest_closing_date
         FROM daily_closings dc
         WHERE dc.closing_date BETWEEN ? AND ?
           ${scope.all ? "" : "AND dc.branch_id = ?"}

         UNION ALL

         SELECT
           0, 0, 0, 0, 0, 0, 0, 0,
           COUNT(*) AS protected_sale_change_count,
           SUM(CASE WHEN sch.change_type = 'void' THEN 1 ELSE 0 END) AS protected_void_count,
           0, 0, NULL
         FROM sale_change_history sch
         WHERE DATE(sch.created_at) BETWEEN ? AND ?
           ${scope.all ? "" : "AND sch.branch_id = ?"}

         UNION ALL

         SELECT
           0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
           SUM(CASE WHEN r.refund_amount > 0 THEN 1 ELSE 0 END) AS refund_count,
           COALESCE(SUM(CASE WHEN r.refund_amount > 0 THEN r.refund_amount ELSE 0 END), 0) AS refund_total,
           NULL
         FROM returns r
         WHERE DATE(r.returned_at) BETWEEN ? AND ?
           ${scope.all ? "" : "AND r.branch_id = ?"}
       ) control_totals`,
      [
        from,
        to,
        ...branchParams,
        from,
        to,
        ...branchParams,
        from,
        to,
        ...branchParams,
      ]
    ),
    pool.query(
      `SELECT
         dc.id,
         dc.closing_date,
         dc.difference_total,
         dc.verification_status,
         dc.stale_after_close,
         dc.counted_confirmed,
         b.branch_code,
         b.name AS branch_name
       FROM daily_closings dc
       INNER JOIN branches b ON b.id = dc.branch_id
       WHERE dc.closing_date BETWEEN ? AND ?
         AND (
           ABS(dc.difference_total) >= 0.01
           OR dc.stale_after_close = 1
           OR dc.verification_status <> 'verified'
           OR dc.counted_confirmed = 0
         )
         ${scope.all ? "" : "AND dc.branch_id = ?"}
       ORDER BY
         dc.stale_after_close DESC,
         ABS(dc.difference_total) DESC,
         dc.closing_date DESC
       LIMIT 25`,
      [from, to, ...branchParams]
    ),
    pool.query(
      `SELECT
         activity_date,
         COALESCE(SUM(spare_sales), 0) AS spare_sales,
         COALESCE(SUM(spare_received), 0) AS spare_received,
         COALESCE(SUM(spare_expenses), 0) AS spare_expenses,
         COALESCE(SUM(hire_invoiced), 0) AS hire_invoiced,
         COALESCE(SUM(hire_received), 0) AS hire_received,
         COALESCE(SUM(mining_cost), 0) AS mining_cost
       FROM (
         SELECT DATE(s.created_at) AS activity_date,
                SUM(s.total) AS spare_sales,
                SUM(s.amount_paid) AS spare_received,
                0 AS spare_expenses, 0 AS hire_invoiced, 0 AS hire_received, 0 AS mining_cost
         FROM sales s
         WHERE DATE(s.created_at) BETWEEN ? AND ?
           AND s.is_voided = 0
           AND s.sale_status = 'completed'
           ${scope.all ? "" : "AND s.branch_id = ?"}
         GROUP BY DATE(s.created_at)

         UNION ALL

         SELECT e.expense_date, 0, 0, SUM(e.amount), 0, 0, 0
         FROM expenses e
         WHERE e.expense_date BETWEEN ? AND ?
           ${scope.all ? "" : "AND e.branch_id = ?"}
         GROUP BY e.expense_date

         UNION ALL

         SELECT hi.invoice_date, 0, 0, 0, SUM(hi.total_amount), 0, 0
         FROM hire_invoices hi
         WHERE hi.invoice_date BETWEEN ? AND ?
         GROUP BY hi.invoice_date

         UNION ALL

         SELECT DATE(hp.payment_date), 0, 0, 0, 0, SUM(hp.amount), 0
         FROM hire_payments hp
         WHERE DATE(hp.payment_date) BETWEEN ? AND ?
         GROUP BY DATE(hp.payment_date)

         UNION ALL

         SELECT me.expense_date, 0, 0, 0, 0, 0, SUM(me.amount)
         FROM mining_expenses me
         WHERE me.expense_date BETWEEN ? AND ?
         GROUP BY me.expense_date

         UNION ALL

         SELECT DATE(mf.log_datetime), 0, 0, 0, 0, 0, SUM(mf.total_cost)
         FROM mining_fuel_logs mf
         WHERE DATE(mf.log_datetime) BETWEEN ? AND ?
           AND LOWER(mf.transaction_type) = 'issue'
         GROUP BY DATE(mf.log_datetime)
       ) daily_activity
       GROUP BY activity_date
       ORDER BY activity_date ASC`,
      [
        from,
        to,
        ...branchParams,
        from,
        to,
        ...branchParams,
        from,
        to,
        from,
        to,
        from,
        to,
        from,
        to,
      ]
    ),
  ]);

  const branchComparison = mergeRowsByBranch(
    branchRows,
    salesRows,
    expenseRows,
    debtRows,
    stockRows
  );
  const spareParts = totalsFromBranches(branchComparison);

  const miningCosts = miningCostRows[0] || {};
  const miningHours = miningHoursRows[0] || {};
  const miningIncidents = miningIncidentRows[0] || {};
  const miningLogs = miningDailyLogRows[0] || {};
  const hireInvoices = hireInvoiceRows[0] || {};
  const hirePayments = hirePaymentRows[0] || {};
  const hireContracts = hireContractRows[0] || {};
  const hireWork = hireWorkRows[0] || {};
  const fleetSummary = fleetSummaryRows[0] || {};
  const fleetMaintenance = fleetMaintenanceRows[0] || {};

  const mining = {
    active_sites: miningSiteRows.filter(
      (site) => String(site.status || "").toLowerCase() === "active"
    ).length,
    production_by_unit: productionByUnit.map((row) => ({
      unit: row.unit,
      quantity: numeric(row.quantity),
    })),
    expenses_total: numeric(miningCosts.expenses_total),
    fuel_cost: numeric(miningCosts.fuel_cost),
    fuel_litres: numeric(miningCosts.fuel_litres),
    operating_cost:
      numeric(miningCosts.expenses_total) + numeric(miningCosts.fuel_cost),
    working_hours: numeric(miningHours.working_hours),
    idle_hours: numeric(miningHours.idle_hours),
    breakdown_hours: numeric(miningHours.breakdown_hours),
    active_assets: numeric(miningHours.active_assets),
    open_incidents: numeric(miningIncidents.open_incidents),
    serious_open_incidents: numeric(
      miningIncidents.serious_open_incidents
    ),
    period_incidents: numeric(miningIncidents.period_incidents),
    daily_log_count: numeric(miningLogs.daily_log_count),
    unapproved_daily_logs: numeric(miningLogs.unapproved_daily_logs),
  };

  const hire = {
    invoice_count: numeric(hireInvoices.invoice_count),
    invoiced_total: numeric(hireInvoices.invoiced_total),
    invoice_paid: numeric(hireInvoices.invoice_paid),
    invoice_balance: numeric(hireInvoices.invoice_balance),
    overdue_invoice_count: numeric(hireInvoices.overdue_invoice_count),
    overdue_balance: numeric(hireInvoices.overdue_balance),
    payment_count: numeric(hirePayments.payment_count),
    payments_total: numeric(hirePayments.payments_total),
    active_contracts: numeric(hireContracts.active_contracts),
    contract_count: numeric(hireContracts.contract_count),
    deposits_received: numeric(hireContracts.deposits_received),
    billable_hours: numeric(hireWork.billable_hours),
    idle_hours: numeric(hireWork.idle_hours),
    breakdown_hours: numeric(hireWork.breakdown_hours),
    unapproved_work_logs: numeric(hireWork.unapproved_work_logs),
    active_assets: numeric(hireWork.active_assets),
  };

  const fleet = {
    total_assets: numeric(fleetSummary.total_assets),
    available_assets: numeric(fleetSummary.available_assets),
    assigned_assets: numeric(fleetSummary.assigned_assets),
    unavailable_assets: numeric(fleetSummary.unavailable_assets),
    service_due_count: fleetServiceRows.length,
    expiring_document_count: fleetDocumentRows.length,
    open_maintenance_count: numeric(
      fleetMaintenance.open_maintenance_count
    ),
    open_maintenance_cost: numeric(
      fleetMaintenance.open_maintenance_cost
    ),
    status_breakdown: fleetStatusRows.map((row) => ({
      status: row.current_status,
      asset_count: numeric(row.asset_count),
    })),
  };

  const cashControlSource = cashControlRows[0] || {};
  const cashControl = {
    closing_count: numeric(cashControlSource.closing_count),
    variance_count: numeric(cashControlSource.variance_count),
    shortage_count: numeric(cashControlSource.shortage_count),
    shortage_total: numeric(cashControlSource.shortage_total),
    absolute_variance: numeric(cashControlSource.absolute_variance),
    awaiting_verification_count: numeric(
      cashControlSource.awaiting_verification_count
    ),
    changed_after_close_count: numeric(
      cashControlSource.changed_after_close_count
    ),
    legacy_unconfirmed_count: numeric(
      cashControlSource.legacy_unconfirmed_count
    ),
    protected_sale_change_count: numeric(
      cashControlSource.protected_sale_change_count
    ),
    protected_void_count: numeric(cashControlSource.protected_void_count),
    refund_count: numeric(cashControlSource.refund_count),
    refund_total: numeric(cashControlSource.refund_total),
    latest_closing_date: cashControlSource.latest_closing_date || null,
  };

  const financialTrend = financialTrendRows.map((row) => {
    const spareSales = numeric(row.spare_sales);
    const spareReceived = numeric(row.spare_received);
    const spareExpenses = numeric(row.spare_expenses);
    const hireInvoiced = numeric(row.hire_invoiced);
    const hireReceived = numeric(row.hire_received);
    const miningCost = numeric(row.mining_cost);
    const recordedRevenue = spareSales + hireInvoiced;
    const cashReceived = spareReceived + hireReceived;
    const operatingCost = spareExpenses + miningCost;

    return {
      date: row.activity_date,
      spare_sales: spareSales,
      spare_received: spareReceived,
      spare_expenses: spareExpenses,
      hire_invoiced: hireInvoiced,
      hire_received: hireReceived,
      mining_cost: miningCost,
      recorded_revenue: recordedRevenue,
      cash_received: cashReceived,
      operating_cost: operatingCost,
      indicative_result: recordedRevenue - operatingCost,
    };
  });

  const alertItems = [
    ...closingAlertRows.map((row) => {
      const stale = Number(row.stale_after_close || 0) === 1;
      const legacy = Number(row.counted_confirmed || 0) !== 1;
      const difference = numeric(row.difference_total);
      const hasVariance = Math.abs(difference) >= 0.01;
      const severity = stale ? "critical" : hasVariance ? "high" : "medium";
      const reasons = [];
      if (stale) reasons.push("changed after closing");
      if (hasVariance) reasons.push(`variance GHS ${difference.toFixed(2)}`);
      if (legacy) reasons.push("legacy count not confirmed");
      if (row.verification_status !== "verified") {
        reasons.push(`verification ${row.verification_status || "submitted"}`);
      }

      return {
        severity,
        category: "Daily Closing",
        title: `${row.branch_code} — ${String(row.closing_date || "").slice(0, 10)}`,
        detail: reasons.join(" • "),
        path: "/daily-closing",
      };
    }),
    ...seriousIncidentRows.map((row) => ({
      severity: ["critical", "serious", "high"].includes(
        String(row.severity || "").toLowerCase()
      )
        ? "critical"
        : "high",
      category: "Mining Incident",
      title: `${row.site_name}: ${row.incident_type}`,
      detail: `${row.severity} severity • ${row.status} • ${String(
        row.incident_datetime || ""
      ).slice(0, 10)}`,
      path: "/mining",
    })),
    ...overdueInvoiceRows.map((row) => ({
      severity: "high",
      category: "Overdue Hire Invoice",
      title: `${row.invoice_number} — ${row.customer_name}`,
      detail: `Balance GHS ${numeric(row.balance).toFixed(2)} • Due ${String(
        row.due_date || ""
      ).slice(0, 10)} • Contract ${row.contract_number}`,
      path: "/equipment-hire-operations",
    })),
    ...fleetServiceRows.map((row) => ({
      severity: "high",
      category: "Fleet Service",
      title: `${row.asset_code} — ${row.asset_name}`,
      detail: `Current meter ${numeric(row.current_meter).toFixed(
        2
      )}; service due at ${numeric(row.next_service_meter).toFixed(2)}.`,
      path: "/fleet-assets",
    })),
    ...fleetDocumentRows.map((row) => ({
      severity: "high",
      category: "Fleet Document",
      title: `${row.asset_code} — ${row.asset_name}`,
      detail: `Insurance: ${String(row.insurance_expiry || "Not set").slice(
        0,
        10
      )}; registration: ${String(
        row.registration_expiry || "Not set"
      ).slice(0, 10)}.`,
      path: "/fleet-assets",
    })),
    ...lowStockRows.map((row) => ({
      severity: numeric(row.quantity) <= 0 ? "critical" : "medium",
      category: "Low Stock",
      title: `${row.product_name} — ${row.branch_code}`,
      detail: `Quantity ${numeric(row.quantity)}; restock level ${numeric(
        row.low_stock_level
      )}.`,
      path: "/low-stock",
    })),
    ...pendingDailyLogRows.map((row) => ({
      severity: "medium",
      category: "Mining Approval",
      title: `${row.site_name} daily log`,
      detail: `${String(row.log_date || "").slice(0, 10)} • ${
        row.shift_code
      } shift • ${row.status}`,
      path: "/mining",
    })),
    ...pendingWorkLogRows.map((row) => ({
      severity: "medium",
      category: "Hire Approval",
      title: `${row.contract_number} — ${row.asset_code}`,
      detail: `${row.customer_name} • ${String(row.work_date || "").slice(
        0,
        10
      )} • ${numeric(row.billable_hours).toFixed(2)} billable hours.`,
      path: "/equipment-hire-operations",
    })),
  ];

  const summary = {
    generated_at: new Date().toISOString(),
    period: { from, to },
    branch_scope: {
      mode: scope.all ? "all" : "selected",
      branch_id: scope.all ? null : scope.branchId,
      can_access_all_branches: scope.canAccessAll,
      requested_all: scope.requestedAll,
    },
    business_scope: {
      label: "All Chalin 03 businesses",
      businesses: [
        "Spare Parts",
        "Equipment Installment Finance",
        "Mining Operations",
        "Equipment Hire",
      ],
      support_units: ["Fleet & Maintenance"],
      spare_parts_filter:
        scope.all ? "All Spare Parts stores" : "Selected Spare Parts store",
    },
    spare_parts: spareParts,
    mining,
    hire,
    fleet,
    cash_control: cashControl,
    financial_trend: financialTrend,
    branch_comparison: branchComparison,
    mining_sites: miningSiteRows.map((row) => ({
      ...row,
      daily_target: numeric(row.daily_target),
      production_quantity: numeric(row.production_quantity),
      working_hours: numeric(row.working_hours),
      expenses_total: numeric(row.expenses_total),
    })),
    hire_customers: hireCustomerRows.map((row) => ({
      ...row,
      invoiced_total: numeric(row.invoiced_total),
      paid_total: numeric(row.paid_total),
      balance_total: numeric(row.balance_total),
    })),
    fleet_utilization: fleetUtilizationRows.map((row) => ({
      ...row,
      mining_working_hours: numeric(row.mining_working_hours),
      hire_billable_hours: numeric(row.hire_billable_hours),
      breakdown_hours: numeric(row.breakdown_hours),
      total_productive_hours:
        numeric(row.mining_working_hours) + numeric(row.hire_billable_hours),
    })),
    alerts: alertItems.slice(0, 60),
    alert_counts: alertItems.reduce(
      (counts, alert) => {
        counts.total += 1;
        counts[alert.severity] = (counts[alert.severity] || 0) + 1;
        return counts;
      },
      { total: 0, critical: 0, high: 0, medium: 0, low: 0 }
    ),
  };

  const recordedRevenue =
    summary.spare_parts.sales_total + summary.hire.invoiced_total;
  const cashReceived =
    summary.spare_parts.sales_received + summary.hire.payments_total;
  const operatingCost =
    summary.spare_parts.expenses_total + summary.mining.operating_cost;
  const outstandingReceivables =
    summary.spare_parts.debt_balance + summary.hire.invoice_balance;

  summary.group = {
    recorded_revenue: recordedRevenue,
    cash_received: cashReceived,
    operating_cost: operatingCost,
    outstanding_receivables: outstandingReceivables,
    indicative_balance: recordedRevenue - operatingCost,
    collection_rate:
      recordedRevenue > 0 ? (cashReceived / recordedRevenue) * 100 : 0,
    cost_ratio:
      recordedRevenue > 0 ? (operatingCost / recordedRevenue) * 100 : 0,
    receivable_ratio:
      recordedRevenue > 0
        ? (outstandingReceivables / recordedRevenue) * 100
        : 0,
  };

  let financeIntelligence = null;
  try {
    const intelligence = await buildExecutiveIntelligence({ from, to });
    financeIntelligence = intelligence?.installment_finance || null;
  } catch (error) {
    console.warn(
      "Group executive Installment Finance intelligence unavailable:",
      error.message
    );
  }

  summary.installment_finance = financeIntelligence || {
    active_accounts: 0,
    financed_amount: 0,
    collected_amount: 0,
    outstanding_amount: 0,
    overdue_amount: 0,
    overdue_accounts: 0,
    defaulted_accounts: 0,
    critical_risk_accounts: 0,
    high_risk_accounts: 0,
    due_today_accounts: 0,
    due_next_7_days: 0,
    due_next_30_days: 0,
    collection_rate: 0,
    portfolio_at_risk_rate: 0,
    overdue_share_of_outstanding: 0,
    payments_in_period: 0,
    payments_amount_in_period: 0,
    reversals_in_period: 0,
    reversed_amount_in_period: 0,
    urgent_accounts: [],
    signals: [],
  };

  summary.business_activity = {
    spare_parts:
      numeric(summary.spare_parts.sales_total) > 0 ||
      numeric(summary.spare_parts.expenses_total) > 0 ||
      numeric(summary.spare_parts.debt_balance) > 0,
    installment_finance:
      numeric(summary.installment_finance.active_accounts) > 0 ||
      numeric(summary.installment_finance.payments_in_period) > 0 ||
      numeric(summary.installment_finance.outstanding_amount) > 0,
    mining:
      numeric(summary.mining.working_hours) > 0 ||
      numeric(summary.mining.operating_cost) > 0 ||
      numeric(summary.mining.open_incidents) > 0,
    equipment_hire:
      numeric(summary.hire.invoiced_total) > 0 ||
      numeric(summary.hire.payments_total) > 0 ||
      numeric(summary.hire.active_contracts) > 0,
  };

  const financeAlerts = (summary.installment_finance.signals || []).map(
    (signal) => ({
      severity: signal.severity || "medium",
      category: "Installment Finance",
      title: signal.title || "Installment Finance review",
      detail: signal.detail || "",
      path: signal.path || "/equipment-installment-finance/collections",
    })
  );

  if (financeAlerts.length > 0) {
    summary.alerts = [...summary.alerts, ...financeAlerts].slice(0, 80);
    summary.alert_counts = summary.alerts.reduce(
      (counts, alert) => {
        counts.total += 1;
        counts[alert.severity] = (counts[alert.severity] || 0) + 1;
        return counts;
      },
      { total: 0, critical: 0, high: 0, medium: 0, low: 0 }
    );
  }

  summary.command_centre =
    await loadGroupCommandCentreSummary({
      period: summary.period,
    });

  const commandAlerts =
    summary.command_centre?.alerts || [];

  if (commandAlerts.length > 0) {
    const severityRank = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    summary.alerts = [
      ...(summary.alerts || []),
      ...commandAlerts,
    ]
      .sort(
        (left, right) =>
          (severityRank[left.severity] ?? 9) -
          (severityRank[right.severity] ?? 9)
      )
      .slice(0, 80);

    summary.alert_counts = summary.alerts.reduce(
      (counts, alert) => {
        counts.total += 1;
        counts[alert.severity] =
          (counts[alert.severity] || 0) + 1;
        return counts;
      },
      {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      }
    );
  }

  const financeRecommendations = (
    summary.installment_finance.signals || []
  ).map((signal) => ({
    priority: signal.severity || "medium",
    area: "Installment Finance",
    title: signal.title || "Review Installment Finance",
    detail:
      [signal.detail, signal.action].filter(Boolean).join(" Management action: "),
    path: signal.path || "/equipment-installment-finance/collections",
  }));

  summary.recommendations = [
    ...financeRecommendations,
    ...(summary.command_centre?.recommendations || []),
    ...buildRecommendations(summary),
  ].slice(0, 24);

  return summary;
}

const EXECUTIVE_COLORS = {
  navy: "0B1F3A",
  blue: "305496",
  gold: "D9B63C",
  goldLight: "FFF2CC",
  green: "217346",
  greenLight: "E2F0D9",
  red: "C00000",
  redLight: "FCE4D6",
  amber: "BF8F00",
  gray: "667085",
  grayLight: "F3F6FA",
  border: "D5DCE6",
  white: "FFFFFF",
  text: "172033",
};

function executiveFill(argb) {
  return {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb },
  };
}

function executiveBorder(color = EXECUTIVE_COLORS.border) {
  return {
    top: { style: "thin", color: { argb: color } },
    left: { style: "thin", color: { argb: color } },
    bottom: { style: "thin", color: { argb: color } },
    right: { style: "thin", color: { argb: color } },
  };
}

function executiveScopeLabel(summary) {
  return summary.business_scope?.label || "All Chalin 03 businesses";
}

function sparePartsScopeLabel(summary) {
  return (
    summary.business_scope?.spare_parts_filter ||
    (summary.branch_scope?.mode === "all"
      ? "All Spare Parts stores"
      : "Selected Spare Parts store")
  );
}

function configureSheet(sheet, title, columns) {
  sheet.columns = columns.map((column) => ({
    key: column.key,
    width: column.width || 18,
  }));

  sheet.mergeCells(1, 1, 1, columns.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 16, color: { argb: EXECUTIVE_COLORS.white } };
  titleCell.fill = executiveFill(EXECUTIVE_COLORS.navy);
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  sheet.getRow(1).height = 30;

  sheet.mergeCells(2, 1, 2, columns.length);
  const contextCell = sheet.getCell(2, 1);
  contextCell.fill = executiveFill(EXECUTIVE_COLORS.grayLight);
  contextCell.font = { italic: true, color: { argb: EXECUTIVE_COLORS.text } };
  contextCell.alignment = { vertical: "middle", wrapText: true };
  contextCell.border = executiveBorder();
  sheet.getRow(2).height = 24;

  const header = sheet.getRow(3);
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.header;
    cell.border = executiveBorder(EXECUTIVE_COLORS.blue);
  });
  header.font = { bold: true, color: { argb: EXECUTIVE_COLORS.white } };
  header.fill = executiveFill(EXECUTIVE_COLORS.blue);
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 24;

  sheet.views = [{ state: "frozen", ySplit: 3 }];
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: columns.length },
  };
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
}

function setSheetContext(sheet, summary, detail = "") {
  if (sheet.name === "Executive Dashboard") return;
  const contextCell = sheet.getCell(2, 1);
  const parts = [
    "Reporting period: " + summary.period.from + " to " + summary.period.to,
    "Group scope: " + executiveScopeLabel(summary),
    "Spare Parts store filter: " + sparePartsScopeLabel(summary),
    detail,
  ].filter(Boolean);
  contextCell.value = parts.join("  •  ");
}

function styleRows(sheet, moneyColumns = []) {
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: "top", wrapText: true };
    row.height = Math.max(row.height || 18, 20);
    if (rowNumber % 2 === 0) {
      row.fill = executiveFill(EXECUTIVE_COLORS.grayLight);
    }
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = executiveBorder();
      cell.font = {
        ...(cell.font || {}),
        color: { argb: EXECUTIVE_COLORS.text },
      };
    });
  }

  moneyColumns.forEach((key) => {
    sheet.getColumn(key).numFmt = '"GHS" #,##0.00;[Red]-"GHS" #,##0.00';
  });
}

function stylePriorityRow(row, severity) {
  const value = String(severity || "").toLowerCase();
  const palette =
    value === "critical"
      ? { fill: EXECUTIVE_COLORS.redLight, text: EXECUTIVE_COLORS.red }
      : value === "high"
        ? { fill: "FDE9D9", text: "9C0006" }
        : value === "medium"
          ? { fill: EXECUTIVE_COLORS.goldLight, text: "7F6000" }
          : { fill: EXECUTIVE_COLORS.greenLight, text: EXECUTIVE_COLORS.green };

  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = executiveFill(palette.fill);
    cell.border = executiveBorder();
    cell.alignment = { vertical: "top", wrapText: true };
  });
  row.getCell(1).font = { bold: true, color: { argb: palette.text } };
}

function addExecutiveKpi(sheet, startColumn, row, label, value, note, fill, money = false) {
  const endColumn = startColumn + 1;
  sheet.mergeCells(row, startColumn, row, endColumn);
  sheet.mergeCells(row + 1, startColumn, row + 1, endColumn);
  sheet.mergeCells(row + 2, startColumn, row + 2, endColumn);

  const labelCell = sheet.getCell(row, startColumn);
  const valueCell = sheet.getCell(row + 1, startColumn);
  const noteCell = sheet.getCell(row + 2, startColumn);

  labelCell.value = label;
  valueCell.value = value;
  noteCell.value = note;

  [labelCell, valueCell, noteCell].forEach((cell) => {
    cell.fill = executiveFill(fill);
    cell.border = executiveBorder(fill);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  labelCell.font = { bold: true, size: 9, color: { argb: "E9EEF5" } };
  valueCell.font = { bold: true, size: 18, color: { argb: EXECUTIVE_COLORS.white } };
  noteCell.font = { italic: true, size: 8, color: { argb: "E9EEF5" } };
  if (money && typeof value === "number") valueCell.numFmt = '"GHS" #,##0.00;[Red]-"GHS" #,##0.00';
}

function createExecutiveDashboard(workbook, summary) {
  const sheet = workbook.addWorksheet("Executive Dashboard");
  for (let column = 1; column <= 8; column += 1) {
    sheet.getColumn(column).width = 18;
  }
  sheet.views = [{ state: "frozen", ySplit: 4 }];

  sheet.mergeCells("A1:H2");
  const title = sheet.getCell("A1");
  title.value = "CHALIN 03 COMPANY LIMITED — GROUP EXECUTIVE INTELLIGENCE";
  title.fill = executiveFill(EXECUTIVE_COLORS.navy);
  title.font = { bold: true, size: 20, color: { argb: EXECUTIVE_COLORS.white } };
  title.alignment = { vertical: "middle", horizontal: "left" };

  sheet.mergeCells("A3:H3");
  const period = sheet.getCell("A3");
  period.value =
    "REPORTING PERIOD: " +
    summary.period.from +
    " TO " +
    summary.period.to +
    "  •  " +
    executiveScopeLabel(summary) +
    "  •  Spare Parts filter: " +
    sparePartsScopeLabel(summary) +
    "  •  Generated " +
    String(summary.generated_at || "").replace("T", " ").replace("Z", " UTC");
  period.fill = executiveFill(EXECUTIVE_COLORS.goldLight);
  period.font = { bold: true, color: { argb: EXECUTIVE_COLORS.text } };
  period.border = executiveBorder(EXECUTIVE_COLORS.gold);
  period.alignment = { vertical: "middle", wrapText: true };

  sheet.mergeCells("A4:H4");
  const note = sheet.getCell("A4");
  note.value =
    "Group-wide executive pack covering every Chalin 03 business. Each business is analysed separately so Installment Finance portfolio exposure is not incorrectly blended into ordinary sales revenue. Trading roll-ups are management indicators, not final audited profit figures.";
  note.font = { italic: true, size: 9, color: { argb: EXECUTIVE_COLORS.gray } };
  note.border = executiveBorder();
  note.alignment = { vertical: "middle", wrapText: true };

  addExecutiveKpi(sheet, 1, 6, "SPARE PARTS SALES", numeric(summary.spare_parts.sales_total), "Selected period • " + sparePartsScopeLabel(summary), EXECUTIVE_COLORS.navy, true);
  addExecutiveKpi(sheet, 3, 6, "INSTALLMENT COLLECTIONS", numeric(summary.installment_finance.payments_amount_in_period), numeric(summary.installment_finance.payments_in_period) + " payment record(s) in period", EXECUTIVE_COLORS.green, true);
  addExecutiveKpi(sheet, 5, 6, "FINANCE OUTSTANDING", numeric(summary.installment_finance.outstanding_amount), numeric(summary.installment_finance.active_accounts) + " active agreement(s)", EXECUTIVE_COLORS.blue, true);
  addExecutiveKpi(sheet, 7, 6, "FINANCE OVERDUE", numeric(summary.installment_finance.overdue_amount), numeric(summary.installment_finance.overdue_accounts) + " overdue agreement(s)", numeric(summary.installment_finance.overdue_amount) > 0 ? EXECUTIVE_COLORS.red : EXECUTIVE_COLORS.green, true);

  addExecutiveKpi(sheet, 1, 10, "EQUIPMENT HIRE INVOICED", numeric(summary.hire.invoiced_total), numeric(summary.hire.active_contracts) + " active contract(s)", EXECUTIVE_COLORS.blue, true);
  addExecutiveKpi(sheet, 3, 10, "MINING OPERATING COST", numeric(summary.mining.operating_cost), numeric(summary.mining.working_hours).toFixed(1) + " working hour(s)", "7F6000", true);
  addExecutiveKpi(sheet, 5, 10, "CASH CONTROL EXCEPTIONS", numeric(summary.cash_control.variance_count) + numeric(summary.cash_control.changed_after_close_count), numeric(summary.cash_control.variance_count) + " variance(s) • " + numeric(summary.cash_control.changed_after_close_count) + " changed after close", numeric(summary.cash_control.changed_after_close_count) > 0 ? EXECUTIVE_COLORS.red : EXECUTIVE_COLORS.amber);
  addExecutiveKpi(sheet, 7, 10, "MANAGEMENT ALERTS", numeric(summary.alert_counts.total), numeric(summary.alert_counts.critical) + " critical • " + numeric(summary.alert_counts.high) + " high", numeric(summary.alert_counts.critical) > 0 ? EXECUTIVE_COLORS.red : EXECUTIVE_COLORS.blue);

  sheet.mergeCells("A14:H14");
  const businessTitle = sheet.getCell("A14");
  businessTitle.value = "BUSINESS UNIT SCORECARD";
  businessTitle.fill = executiveFill(EXECUTIVE_COLORS.navy);
  businessTitle.font = { bold: true, color: { argb: EXECUTIVE_COLORS.white } };

  const scorecards = [
    ["A", "B", "SPARE PARTS", [
      ["Sales", numeric(summary.spare_parts.sales_total), '"GHS" #,##0.00'],
      ["Received", numeric(summary.spare_parts.sales_received), '"GHS" #,##0.00'],
      ["Debt", numeric(summary.spare_parts.debt_balance), '"GHS" #,##0.00'],
      ["Low stock", numeric(summary.spare_parts.low_stock_count), "#,##0"],
    ]],
    ["C", "D", "MINING", [
      ["Working hours", numeric(summary.mining.working_hours), "#,##0.0"],
      ["Operating cost", numeric(summary.mining.operating_cost), '"GHS" #,##0.00'],
      ["Open incidents", numeric(summary.mining.open_incidents), "#,##0"],
      ["Unapproved logs", numeric(summary.mining.unapproved_daily_logs), "#,##0"],
    ]],
    ["E", "F", "EQUIPMENT HIRE", [
      ["Invoiced", numeric(summary.hire.invoiced_total), '"GHS" #,##0.00'],
      ["Payments", numeric(summary.hire.payments_total), '"GHS" #,##0.00'],
      ["Outstanding", numeric(summary.hire.invoice_balance), '"GHS" #,##0.00'],
      ["Active contracts", numeric(summary.hire.active_contracts), "#,##0"],
    ]],
    ["G", "H", "INSTALLMENT FINANCE", [
      ["Active accounts", numeric(summary.installment_finance.active_accounts), "#,##0"],
      ["Outstanding", numeric(summary.installment_finance.outstanding_amount), '"GHS" #,##0.00'],
      ["Overdue", numeric(summary.installment_finance.overdue_amount), '"GHS" #,##0.00'],
      ["Collection rate", numeric(summary.installment_finance.collection_rate), '0.0"%"'],
    ]],
  ];

  scorecards.forEach(([left, right, heading, metrics]) => {
    sheet.mergeCells(left + "15:" + right + "15");
    const headingCell = sheet.getCell(left + "15");
    headingCell.value = heading;
    headingCell.fill = executiveFill(EXECUTIVE_COLORS.blue);
    headingCell.font = { bold: true, color: { argb: EXECUTIVE_COLORS.white } };
    headingCell.alignment = { horizontal: "center", vertical: "middle" };

    const leftColumn = sheet.getColumn(left).number;
    metrics.forEach(([label, value, format], index) => {
      const row = 16 + index;
      const labelCell = sheet.getCell(row, leftColumn);
      const valueCell = sheet.getCell(row, leftColumn + 1);
      labelCell.value = label;
      valueCell.value = value;
      labelCell.font = { bold: true, color: { argb: EXECUTIVE_COLORS.gray } };
      valueCell.font = { bold: true, color: { argb: EXECUTIVE_COLORS.text } };
      labelCell.border = executiveBorder();
      valueCell.border = executiveBorder();
      labelCell.alignment = { vertical: "middle", wrapText: true };
      valueCell.alignment = { vertical: "middle", wrapText: true };
      valueCell.numFmt = format;
    });
  });

  sheet.mergeCells("A21:H21");
  const actionTitle = sheet.getCell("A21");
  actionTitle.value = "MANAGEMENT ACTION QUEUE";
  actionTitle.fill = executiveFill(EXECUTIVE_COLORS.navy);
  actionTitle.font = { bold: true, color: { argb: EXECUTIVE_COLORS.white } };

  sheet.getCell("A22").value = "Priority";
  sheet.mergeCells("B22:C22");
  sheet.getCell("B22").value = "Area";
  sheet.mergeCells("D22:E22");
  sheet.getCell("D22").value = "Action";
  sheet.mergeCells("F22:H22");
  sheet.getCell("F22").value = "Management detail";
  ["A22", "B22", "D22", "F22"].forEach((address) => {
    const cell = sheet.getCell(address);
    cell.fill = executiveFill(EXECUTIVE_COLORS.blue);
    cell.font = { bold: true, color: { argb: EXECUTIVE_COLORS.white } };
    cell.border = executiveBorder(EXECUTIVE_COLORS.blue);
  });

  (summary.recommendations || []).slice(0, 10).forEach((action, index) => {
    const rowNumber = 23 + index;
    sheet.mergeCells(rowNumber, 2, rowNumber, 3);
    sheet.mergeCells(rowNumber, 4, rowNumber, 5);
    sheet.mergeCells(rowNumber, 6, rowNumber, 8);
    sheet.getCell(rowNumber, 1).value = String(action.priority || "medium").toUpperCase();
    sheet.getCell(rowNumber, 2).value = action.area || "Group";
    sheet.getCell(rowNumber, 4).value = action.title || "Review";
    sheet.getCell(rowNumber, 6).value = action.detail || "";
    stylePriorityRow(sheet.getRow(rowNumber), action.priority);
    sheet.getRow(rowNumber).height = 34;
  });

  return sheet;
}

function createExecutiveCommandSheet(workbook, summary) {
  const sheet = workbook.addWorksheet("Command Centre");
  configureSheet(sheet, "Security, Backup, Workforce & System Readiness", [
    { header: "Control Area", key: "area", width: 24 },
    { header: "Indicator", key: "metric", width: 34 },
    { header: "Current Value", key: "value", width: 24 },
    { header: "Management Meaning", key: "note", width: 58 },
  ]);

  const command = summary.command_centre || {};
  const rows = [
    ["Owner Security", "Protection readiness", command.owner_security?.readiness_label || "Not available", "Owner break-glass protection readiness."],
    ["Owner Security", "MFA enabled", command.owner_security?.mfa_enabled ? "Yes" : "No", "Multi-factor authentication status for the protected Owner identity."],
    ["Owner Security", "Unused recovery codes", numeric(command.owner_security?.unused_recovery_codes), "Remaining protected recovery codes."],
    ["Accounts", "Locked accounts", numeric(command.accounts?.locked_accounts), "Staff accounts currently locked and requiring review."],
    ["Accounts", "Active sessions", numeric(command.accounts?.active_sessions), "Server-side sessions currently active."],
    ["Backups", "Latest backup age (hours)", command.backups?.latest_backup_age_hours == null ? "No backup" : numeric(command.backups.latest_backup_age_hours), "Configured maximum age: " + numeric(command.backups?.maximum_age_hours) + " hours."],
    ["Backups", "Failed backups", numeric(command.backups?.failed_backups), "Failed professional backup records."],
    ["Backups", "Unverified backups", numeric(command.backups?.unverified_backups), "Backups awaiting verification."],
    ["Workforce", "Active workers", numeric(command.workforce?.active_workers), "Current active workforce records."],
    ["Workforce", "Expiring documents", numeric(command.workforce?.expiring_documents), "Expired or warning-period worker documents."],
    ["Workforce", "Expiring licences", numeric(command.workforce?.expiring_licenses), "Expired or warning-period worker licences."],
    ["Workforce", "Overdue property returns", numeric(command.workforce?.overdue_property_returns), "Company property overdue for return."],
    ["Security", "Failed Owner logins (24 hours)", numeric(command.security?.failed_owner_logins_24h), "Unsuccessful protected Owner login attempts."],
    ["Security", "Critical privileged actions (7 days)", numeric(command.security?.critical_privileged_actions_7d), "Critical privileged actions for management review."],
    ["System", "Server errors (24 hours)", numeric(command.system?.application_errors_24h), "HTTP 500-level application errors."],
    ["Notifications", "Active notifications", numeric(command.notification_centre?.active_notifications), "All active group notifications."],
    ["Notifications", "Critical notifications", numeric(command.notification_centre?.critical_notifications), "Critical active notifications requiring immediate review."],
    ["Notifications", "High notifications", numeric(command.notification_centre?.high_notifications), "High-priority active notifications."],
  ];

  rows.forEach(([area, metric, value, note]) => {
    sheet.addRow({ area, metric, value, note });
  });
  styleRows(sheet);
  return sheet;
}

async function logWorkbookDownload(req, summary) {
  try {
    await pool.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [
        currentBranchId(req),
        req.user?.id || null,
        "DOWNLOAD_GROUP_EXECUTIVE_WORKBOOK",
        `Downloaded Group Executive workbook for ${summary.period.from} to ${summary.period.to} (all businesses; Spare Parts filter: ${sparePartsScopeLabel(summary)})`,
      ]
    );
  } catch (error) {
    console.warn("Group executive workbook activity log skipped:", error.message);
  }

  await writeSharedControlEvidence({
    req,
    controlArea: "reports",
    actionType: "export",
    documentType: "group_executive_workbook",
    documentNumber: `${summary.period.from}-to-${summary.period.to}`,
    exportFormat: "xlsx",
    description: `Downloaded Group Executive workbook for ${summary.period.from} to ${summary.period.to}.`,
    metadata: {
      group_scope: executiveScopeLabel(summary),
      spare_parts_filter: sparePartsScopeLabel(summary),
      branch_scope: summary.branch_scope?.mode || "authorized",
    },
    workspaceCode: "group",
  });
}

router.use(requireAuth);
router.use((req, res, next) => {
  if (!isOriginalSystemAdministrator(req.user)) {
    return res.status(403).json({
      status: "error",
      code: "SYSTEM_ADMINISTRATOR_REQUIRED",
      message: "Only the original System Administrator can open group-wide executive control.",
    });
  }
  return next();
});

router.get("/summary", async (req, res) => {
  try {
    const summary = await loadGroupSummary(req);

    return res.json({
      status: "success",
      message: "Group Executive Control summary loaded.",
      summary,
    });
  } catch (error) {
    console.error("Group executive summary error:", error);
    if (sendSetupError(res, error)) return;

    return res.status(500).json({
      status: "error",
      message: error.message || "Could not load Group Executive Control.",
    });
  }
});

router.get("/workbook.xlsx", async (req, res) => {
  try {
    const summary = await loadGroupSummary(req);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Chalin 03 Group Operations Platform";
    workbook.created = new Date();
    workbook.title = "Chalin 03 Group Executive Intelligence";
    workbook.subject = "Executive management intelligence, operational control and risk";
    workbook.company = "Chalin 03 Company Limited";

    createExecutiveDashboard(workbook, summary);
    createExecutiveCommandSheet(workbook, summary);

    const executive = workbook.addWorksheet("Executive Metrics");
    configureSheet(executive, "Executive Metrics Detail", [
      { header: "Area", key: "area", width: 28 },
      { header: "Metric", key: "metric", width: 34 },
      { header: "Value", key: "value", width: 24 },
      { header: "Period / Note", key: "note", width: 36 },
    ]);

    const executiveRows = [
      ["Group", "Recorded revenue", summary.group.recorded_revenue],
      ["Group", "Payments received", summary.group.cash_received],
      ["Group", "Operating cost", summary.group.operating_cost],
      ["Group", "Outstanding receivables", summary.group.outstanding_receivables],
      ["Group", "Indicative balance", summary.group.indicative_balance],
      ["Group", "Payment-to-revenue rate (%)", summary.group.collection_rate],
      ["Group", "Operating cost ratio (%)", summary.group.cost_ratio],
      ["Group", "Receivables ratio (%)", summary.group.receivable_ratio],
      ["Cash Control", "Closings completed", summary.cash_control.closing_count],
      ["Cash Control", "Closings with variance", summary.cash_control.variance_count],
      ["Cash Control", "Awaiting verification", summary.cash_control.awaiting_verification_count],
      ["Cash Control", "Changed after closing", summary.cash_control.changed_after_close_count],
      ["Cash Control", "Absolute variance", summary.cash_control.absolute_variance],
      ["Cash Control", "Protected sale changes", summary.cash_control.protected_sale_change_count],
      ["Spare Parts", "Sales total", summary.spare_parts.sales_total],
      ["Spare Parts", "Expenses", summary.spare_parts.expenses_total],
      ["Spare Parts", "Current debt", summary.spare_parts.debt_balance],
      ["Spare Parts", "Cost stock value", summary.spare_parts.stock_value_cost],
      ["Installment Finance", "Active accounts", summary.installment_finance.active_accounts],
      ["Installment Finance", "Financed amount", summary.installment_finance.financed_amount],
      ["Installment Finance", "Collected amount", summary.installment_finance.collected_amount],
      ["Installment Finance", "Collections in selected period", summary.installment_finance.payments_amount_in_period],
      ["Installment Finance", "Outstanding portfolio", summary.installment_finance.outstanding_amount],
      ["Installment Finance", "Overdue amount", summary.installment_finance.overdue_amount],
      ["Installment Finance", "Overdue accounts", summary.installment_finance.overdue_accounts],
      ["Installment Finance", "High-risk accounts", summary.installment_finance.high_risk_accounts],
      ["Installment Finance", "Critical-risk accounts", summary.installment_finance.critical_risk_accounts],
      ["Installment Finance", "Collection rate (%)", summary.installment_finance.collection_rate],
      ["Installment Finance", "Portfolio at risk (%)", summary.installment_finance.portfolio_at_risk_rate],
      ["Mining", "Operating cost", summary.mining.operating_cost],
      ["Mining", "Working hours", summary.mining.working_hours],
      ["Mining", "Open incidents", summary.mining.open_incidents],
      ["Equipment Hire", "Invoiced total", summary.hire.invoiced_total],
      ["Equipment Hire", "Payments", summary.hire.payments_total],
      ["Equipment Hire", "Outstanding invoices", summary.hire.invoice_balance],
      ["Fleet", "Total assets", summary.fleet.total_assets],
      ["Fleet", "Available assets", summary.fleet.available_assets],
      ["Fleet", "Service due", summary.fleet.service_due_count],
    ];

    executiveRows.forEach(([area, metric, value]) => {
      executive.addRow({
        area,
        metric,
        value,
        note: `${summary.period.from} to ${summary.period.to}`,
      });
    });
    executive.getColumn("value").numFmt = '#,##0.00';
    styleRows(executive);

    const trend = workbook.addWorksheet("Financial Trend");
    configureSheet(trend, "Daily Group Financial Trend", [
      { header: "Date", key: "date", width: 16 },
      { header: "Recorded Revenue", key: "recorded_revenue", width: 20 },
      { header: "Payments Received", key: "cash_received", width: 20 },
      { header: "Operating Cost", key: "operating_cost", width: 20 },
      { header: "Indicative Result", key: "indicative_result", width: 20 },
      { header: "Spare Parts Sales", key: "spare_sales", width: 20 },
      { header: "Hire Invoiced", key: "hire_invoiced", width: 20 },
      { header: "Mining Cost", key: "mining_cost", width: 18 },
    ]);
    summary.financial_trend.forEach((row) => trend.addRow(row));
    styleRows(trend, [
      "recorded_revenue",
      "cash_received",
      "operating_cost",
      "indicative_result",
      "spare_sales",
      "hire_invoiced",
      "mining_cost",
    ]);

    const branches = workbook.addWorksheet("Spare Parts Branches");
    configureSheet(branches, "Spare Parts Branch Comparison", [
      { header: "Code", key: "branch_code", width: 14 },
      { header: "Branch", key: "branch_name", width: 26 },
      { header: "Sales", key: "sales_total", width: 18 },
      { header: "Received", key: "sales_received", width: 18 },
      { header: "Expenses", key: "expenses_total", width: 18 },
      { header: "Current Debt", key: "debt_balance", width: 18 },
      { header: "Cost Stock Value", key: "stock_value_cost", width: 20 },
      { header: "Low Stock", key: "low_stock_count", width: 14 },
    ]);
    summary.branch_comparison.forEach((row) => branches.addRow(row));
    styleRows(branches, [
      "sales_total",
      "sales_received",
      "expenses_total",
      "debt_balance",
      "stock_value_cost",
    ]);

    const sites = workbook.addWorksheet("Mining Sites");
    configureSheet(sites, "Mining Site Performance", [
      { header: "Site Code", key: "site_code", width: 15 },
      { header: "Site Name", key: "site_name", width: 28 },
      { header: "Status", key: "status", width: 14 },
      { header: "Unit", key: "production_unit", width: 14 },
      { header: "Target", key: "daily_target", width: 14 },
      { header: "Production", key: "production_quantity", width: 16 },
      { header: "Working Hours", key: "working_hours", width: 16 },
      { header: "Expenses", key: "expenses_total", width: 18 },
    ]);
    summary.mining_sites.forEach((row) => sites.addRow(row));
    styleRows(sites, ["expenses_total"]);

    const financePortfolio = workbook.addWorksheet("Installment Finance");
    configureSheet(financePortfolio, "Equipment Installment Finance Portfolio", [
      { header: "Metric", key: "metric", width: 34 },
      { header: "Value", key: "value", width: 24 },
      { header: "Executive Meaning", key: "meaning", width: 68 },
    ]);
    [
      ["Active agreements", summary.installment_finance.active_accounts, "Current live installment agreements in the Finance portfolio."],
      ["Financed amount", summary.installment_finance.financed_amount, "Total financed principal represented by the current portfolio."],
      ["Collected amount", summary.installment_finance.collected_amount, "Collections recorded against the current portfolio."],
      ["Collections in selected period", summary.installment_finance.payments_amount_in_period, "Cash received through Finance payment records inside the selected report period."],
      ["Outstanding portfolio", summary.installment_finance.outstanding_amount, "Amount still outstanding across active Finance agreements."],
      ["Overdue amount", summary.installment_finance.overdue_amount, "Outstanding amount already past due."],
      ["Overdue agreements", summary.installment_finance.overdue_accounts, "Number of Finance agreements with overdue exposure."],
      ["High-risk agreements", summary.installment_finance.high_risk_accounts, "Accounts currently classified in the high-risk band."],
      ["Critical-risk agreements", summary.installment_finance.critical_risk_accounts, "Accounts currently classified in the critical-risk band."],
      ["Due next 7 days", summary.installment_finance.due_next_7_days, "Scheduled Finance collections falling due within seven days."],
      ["Due next 30 days", summary.installment_finance.due_next_30_days, "Scheduled Finance collections falling due within thirty days."],
      ["Collection rate (%)", summary.installment_finance.collection_rate, "Portfolio collection performance indicator."],
      ["Portfolio at risk (%)", summary.installment_finance.portfolio_at_risk_rate, "Share of the Finance portfolio currently exposed to arrears risk."],
    ].forEach(([metric, value, meaning]) =>
      financePortfolio.addRow({ metric, value, meaning })
    );
    styleRows(financePortfolio);
    financePortfolio.getColumn("value").numFmt = '#,##0.00';

    const financeRisk = workbook.addWorksheet("Finance Risk Accounts");
    configureSheet(financeRisk, "Installment Finance Priority Accounts", [
      { header: "Agreement", key: "agreement", width: 22 },
      { header: "Customer", key: "customer", width: 30 },
      { header: "Machine", key: "machine", width: 28 },
      { header: "Outstanding", key: "outstanding", width: 18 },
      { header: "Overdue", key: "overdue", width: 18 },
      { header: "Days Past Due", key: "days_past_due", width: 16 },
      { header: "Risk Band", key: "risk_band", width: 16 },
      { header: "Risk Score", key: "risk_score", width: 14 },
      { header: "Recommended Action", key: "recommended_action", width: 60 },
    ]);
    (summary.installment_finance.urgent_accounts || []).forEach((row) =>
      financeRisk.addRow(row)
    );
    styleRows(financeRisk, ["outstanding", "overdue"]);

    const customers = workbook.addWorksheet("Hire Customers");
    configureSheet(customers, "Equipment Hire Customer Accounts", [
      { header: "Code", key: "customer_code", width: 16 },
      { header: "Customer", key: "customer_name", width: 30 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Invoiced", key: "invoiced_total", width: 18 },
      { header: "Paid", key: "paid_total", width: 18 },
      { header: "Balance", key: "balance_total", width: 18 },
    ]);
    summary.hire_customers.forEach((row) => customers.addRow(row));
    styleRows(customers, ["invoiced_total", "paid_total", "balance_total"]);

    const fleet = workbook.addWorksheet("Fleet Utilization");
    configureSheet(fleet, "Shared Fleet Utilization", [
      { header: "Asset Code", key: "asset_code", width: 16 },
      { header: "Asset", key: "asset_name", width: 28 },
      { header: "Status", key: "current_status", width: 16 },
      { header: "Location", key: "current_location", width: 24 },
      { header: "Mining Hours", key: "mining_working_hours", width: 16 },
      { header: "Hire Hours", key: "hire_billable_hours", width: 16 },
      { header: "Total Productive", key: "total_productive_hours", width: 18 },
      { header: "Breakdown Hours", key: "breakdown_hours", width: 18 },
    ]);
    summary.fleet_utilization.forEach((row) => fleet.addRow(row));
    styleRows(fleet);

    const alerts = workbook.addWorksheet("Alerts");
    configureSheet(alerts, "Management Alerts", [
      { header: "Severity", key: "severity", width: 14 },
      { header: "Category", key: "category", width: 22 },
      { header: "Title", key: "title", width: 34 },
      { header: "Detail", key: "detail", width: 70 },
      { header: "System Page", key: "path", width: 28 },
    ]);
    summary.alerts.forEach((item) => {
      const row = alerts.addRow(item);
      stylePriorityRow(row, item.severity);
      row.height = 34;
    });

    const recommendations = workbook.addWorksheet("Recommendations");
    configureSheet(recommendations, "Management Recommendations", [
      { header: "Priority", key: "priority", width: 14 },
      { header: "Area", key: "area", width: 22 },
      { header: "Action", key: "title", width: 34 },
      { header: "Detail", key: "detail", width: 70 },
      { header: "System Page", key: "path", width: 28 },
    ]);
    summary.recommendations.forEach((item) => {
      const row = recommendations.addRow(item);
      stylePriorityRow(row, item.priority);
      row.height = 34;
    });

    workbook.worksheets.forEach((sheet) => {
      setSheetContext(sheet, summary);
    });

    const filename = `Chalin03-Group-Executive-${summary.period.from}-to-${summary.period.to}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await logWorkbookDownload(req, summary);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error("Group executive workbook error:", error);
    if (sendSetupError(res, error)) return;

    return res.status(500).json({
      status: "error",
      message: error.message || "Could not create Group Executive workbook.",
    });
  }
});

module.exports = router;
