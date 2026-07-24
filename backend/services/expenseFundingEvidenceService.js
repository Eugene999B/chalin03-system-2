const { pool } = require("../config/db");

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function cleanDate(value, fallback) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function resolveRange(scope = {}) {
  const defaults = defaultRange();
  let startDate = cleanDate(scope.start_date, defaults.startDate);
  let endDate = cleanDate(scope.end_date, defaults.endDate);
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  return { startDate, endDate };
}

function whereForScope(scope = {}) {
  const { startDate, endDate } = resolveRange(scope);
  const branchId = Number(scope.selected_branch_id || 0);
  const params = [startDate, endDate];
  let sql = "WHERE e.expense_date >= ? AND e.expense_date <= ?";
  if (Number.isInteger(branchId) && branchId > 0) {
    sql += " AND e.branch_id = ?";
    params.push(branchId);
  }
  return { sql, params, startDate, endDate, branchId: branchId || null };
}

async function loadExpenseFundingEvidence(scope = {}, connection = pool) {
  const filter = whereForScope(scope);

  const [summaryRows] = await connection.query(
    `SELECT
       COUNT(*) AS expense_count,
       COALESCE(SUM(e.amount), 0) AS total_expenses,
       COALESCE(SUM(CASE
         WHEN e.funding_source = 'today_sales_receipts'
          AND e.affects_daily_closing = 1
         THEN e.amount ELSE 0 END), 0) AS receipts_funded_expenses,
       COALESCE(SUM(CASE
         WHEN NOT (e.funding_source = 'today_sales_receipts'
          AND e.affects_daily_closing = 1)
         THEN e.amount ELSE 0 END), 0) AS externally_funded_expenses,
       COALESCE(SUM(CASE
         WHEN e.funding_source = 'today_sales_receipts'
          AND e.affects_daily_closing = 1
          AND e.payment_method = 'cash'
         THEN e.amount ELSE 0 END), 0) AS cash_closing_deduction,
       COALESCE(SUM(CASE
         WHEN e.funding_source = 'today_sales_receipts'
          AND e.affects_daily_closing = 1
          AND e.payment_method = 'momo'
         THEN e.amount ELSE 0 END), 0) AS momo_closing_deduction,
       COALESCE(SUM(CASE
         WHEN e.funding_source = 'today_sales_receipts'
          AND e.affects_daily_closing = 1
          AND e.payment_method = 'bank'
         THEN e.amount ELSE 0 END), 0) AS bank_closing_deduction,
       COALESCE(SUM(CASE
         WHEN e.funding_source = 'today_sales_receipts'
          AND e.affects_daily_closing = 1
          AND e.payment_method NOT IN ('cash', 'momo', 'bank')
         THEN e.amount ELSE 0 END), 0) AS other_closing_deduction
     FROM expenses e
     ${filter.sql}`,
    filter.params
  );

  const [fundingRows] = await connection.query(
    `SELECT
       COALESCE(NULLIF(e.funding_source, ''), 'other') AS funding_source,
       COUNT(*) AS expense_count,
       COALESCE(SUM(e.amount), 0) AS total,
       COALESCE(SUM(CASE WHEN e.affects_daily_closing = 1 THEN e.amount ELSE 0 END), 0)
         AS closing_deduction
     FROM expenses e
     ${filter.sql}
     GROUP BY COALESCE(NULLIF(e.funding_source, ''), 'other')
     ORDER BY total DESC, funding_source ASC`,
    filter.params
  );

  const [recentRows] = await connection.query(
    `SELECT
       e.id,
       e.branch_id,
       b.code AS branch_code,
       b.name AS branch_name,
       e.expense_date,
       e.category,
       e.description,
       e.amount,
       e.payment_method,
       e.funding_source,
       e.affects_daily_closing,
       e.closing_treatment_note,
       e.created_at,
       COALESCE(u.full_name, 'System') AS recorded_by_name
     FROM expenses e
     LEFT JOIN branches b ON b.id = e.branch_id
     LEFT JOIN users u ON u.id = e.recorded_by
     ${filter.sql}
     ORDER BY e.expense_date DESC, e.created_at DESC, e.id DESC
     LIMIT 100`,
    filter.params
  );

  const summary = summaryRows[0] || {};
  return {
    period: {
      start_date: filter.startDate,
      end_date: filter.endDate,
      branch_id: filter.branchId,
    },
    expense_count: Number(summary.expense_count || 0),
    total_expenses: money(summary.total_expenses),
    receipts_funded_expenses: money(summary.receipts_funded_expenses),
    externally_funded_expenses: money(summary.externally_funded_expenses),
    closing_deductions: {
      cash: money(summary.cash_closing_deduction),
      momo: money(summary.momo_closing_deduction),
      bank: money(summary.bank_closing_deduction),
      other: money(summary.other_closing_deduction),
      total: money(summary.receipts_funded_expenses),
    },
    by_funding_source: fundingRows.map((row) => ({
      funding_source: row.funding_source,
      expense_count: Number(row.expense_count || 0),
      total: money(row.total),
      closing_deduction: money(row.closing_deduction),
      accounting_only: money(Number(row.total || 0) - Number(row.closing_deduction || 0)),
    })),
    recent_expenses: recentRows.map((row) => ({
      ...row,
      amount: money(row.amount),
      affects_daily_closing: Number(row.affects_daily_closing || 0) === 1,
      accounting_treatment: "operating_expense",
      cash_settlement_treatment:
        row.funding_source === "today_sales_receipts" &&
        Number(row.affects_daily_closing || 0) === 1
          ? `deduct_from_${String(row.payment_method || "other").toLowerCase()}_daily_closing`
          : "accounting_only_no_daily_closing_deduction",
    })),
    accounting_note:
      "Every valid business expense reduces profit for accounting. Only an expense explicitly funded from today's sales receipts reduces the matching Cash, MoMo, Bank or Other amount expected in Daily Closing.",
  };
}

module.exports = {
  loadExpenseFundingEvidence,
};
