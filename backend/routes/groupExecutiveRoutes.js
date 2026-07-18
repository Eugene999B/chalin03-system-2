const express = require("express");
const ExcelJS = require("exceljs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  loadGroupCommandCentreSummary,
} = require("../services/groupCommandCentreService");
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

  summary.recommendations = [
    ...(summary.command_centre?.recommendations || []),
    ...buildRecommendations(summary),
  ].slice(0, 20);

  return summary;
}

function configureSheet(sheet, title, columns) {
  sheet.columns = columns.map((column) => ({
    key: column.key,
    width: column.width || 18,
  }));

  sheet.mergeCells(1, 1, 1, columns.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 15, color: { argb: "FFFFFF" } };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "17365D" },
  };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 28;

  const header = sheet.getRow(3);
  columns.forEach((column, index) => {
    header.getCell(index + 1).value = column.header;
  });
  header.font = { bold: true, color: { argb: "FFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "305496" },
  };
  sheet.views = [{ state: "frozen", ySplit: 3 }];
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: columns.length },
  };
}

function styleRows(sheet, moneyColumns = []) {
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "F2F6FC" },
      };
    }
  }

  moneyColumns.forEach((key) => {
    sheet.getColumn(key).numFmt = '"GHS" #,##0.00';
  });
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
        `Downloaded Group Executive workbook for ${summary.period.from} to ${summary.period.to} (${summary.branch_scope.mode} branch scope)`,
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
    metadata: { branch_scope: summary.branch_scope?.mode || "authorized" },
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

    const executive = workbook.addWorksheet("Executive Summary");
    configureSheet(executive, "Chalin 03 Group Executive Summary", [
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
    summary.alerts.forEach((row) => alerts.addRow(row));
    styleRows(alerts);

    const recommendations = workbook.addWorksheet("Recommendations");
    configureSheet(recommendations, "Management Recommendations", [
      { header: "Priority", key: "priority", width: 14 },
      { header: "Area", key: "area", width: 22 },
      { header: "Action", key: "title", width: 34 },
      { header: "Detail", key: "detail", width: 70 },
      { header: "System Page", key: "path", width: 28 },
    ]);
    summary.recommendations.forEach((row) => recommendations.addRow(row));
    styleRows(recommendations);

    const filename = `chalin03-group-executive-${summary.period.from}-to-${summary.period.to}.xlsx`;
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
