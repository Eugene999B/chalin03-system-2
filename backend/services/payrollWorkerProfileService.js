const { pool } = require("../config/db");
const {
  assertSchemaReady,
  compensationHistory,
  loadWorkerForWorkspace,
} = require("./payrollFoundationService");

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateText(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function tenureDays(worker, today = new Date()) {
  const startText = dateText(worker?.employment_start_date);
  if (!startText) return null;
  const endText = dateText(worker?.employment_end_date);
  const start = new Date(`${startText}T00:00:00.000Z`);
  const end = endText ? new Date(`${endText}T00:00:00.000Z`) : today;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function currentApprovedCompensation(profiles, todayText) {
  return (profiles || []).find((profile) => {
    if (profile.status !== "approved") return false;
    const start = dateText(profile.effective_from);
    const end = dateText(profile.effective_to);
    return start && start <= todayText && (!end || end >= todayText);
  }) || null;
}

async function workerPayrollProfile({ workerId, workspaceCode, connection = pool }) {
  await assertSchemaReady(connection);
  const worker = await loadWorkerForWorkspace(connection, workerId, workspaceCode);
  const compensation = await compensationHistory({
    workerId: worker.id,
    workspaceCode: worker.workspace_code,
    connection,
  });

  const [[entries], [payments], [loans], [payslips]] = await Promise.all([
    connection.query(
      `SELECT entry.*,
              period.period_code,
              period.period_start,
              period.period_end,
              period.scheduled_pay_date,
              period.status AS period_status
       FROM payroll_entries entry
       INNER JOIN payroll_periods period ON period.id = entry.payroll_period_id
       WHERE entry.worker_id = ?
         AND entry.workspace_code = ?
         AND period.workspace_code = entry.workspace_code
       ORDER BY period.period_start DESC, entry.id DESC
       LIMIT 120`,
      [worker.id, worker.workspace_code]
    ),
    connection.query(
      `SELECT payment.*,
              period.period_code,
              period.period_start,
              period.period_end
       FROM payroll_salary_payments payment
       INNER JOIN payroll_entries entry ON entry.id = payment.payroll_entry_id
       INNER JOIN payroll_periods period ON period.id = entry.payroll_period_id
       WHERE payment.worker_id = ?
         AND payment.workspace_code = ?
         AND entry.worker_id = payment.worker_id
         AND entry.workspace_code = payment.workspace_code
       ORDER BY payment.payment_date DESC, payment.id DESC
       LIMIT 240`,
      [worker.id, worker.workspace_code]
    ),
    connection.query(
      `SELECT loan.*
       FROM payroll_worker_loans loan
       WHERE loan.worker_id = ?
         AND loan.workspace_code = ?
       ORDER BY loan.start_date DESC, loan.id DESC
       LIMIT 120`,
      [worker.id, worker.workspace_code]
    ),
    connection.query(
      `SELECT payslip.id, payslip.payslip_number, payslip.issue_version,
              payslip.issue_status, payslip.verification_reference, payslip.issued_at,
              entry.payroll_period_id, period.period_code
       FROM payroll_payslips payslip
       INNER JOIN payroll_entries entry ON entry.id = payslip.payroll_entry_id
       INNER JOIN payroll_periods period ON period.id = entry.payroll_period_id
       WHERE payslip.worker_id = ?
         AND payslip.workspace_code = ?
         AND entry.worker_id = payslip.worker_id
         AND entry.workspace_code = payslip.workspace_code
       ORDER BY payslip.issued_at DESC, payslip.id DESC
       LIMIT 120`,
      [worker.id, worker.workspace_code]
    ),
  ]);

  let loanTransactions = [];
  if (loans.length) {
    const loanIds = loans.map((loan) => loan.id);
    const [rows] = await connection.query(
      `SELECT transaction.*
       FROM payroll_loan_transactions transaction
       INNER JOIN payroll_worker_loans loan ON loan.id = transaction.loan_id
       WHERE transaction.loan_id IN (${loanIds.map(() => "?").join(", ")})
         AND loan.worker_id = ?
         AND loan.workspace_code = ?
       ORDER BY transaction.transaction_date DESC, transaction.id DESC
       LIMIT 360`,
      [...loanIds, worker.id, worker.workspace_code]
    );
    loanTransactions = rows;
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  const ytdStart = `${year}-01-01`;
  const ytdEntries = entries.filter((entry) => {
    const start = dateText(entry.period_start);
    return start && start >= ytdStart && start <= today && entry.entry_status !== "cancelled";
  });
  const processedEntries = entries.filter(
    (entry) => !["draft", "cancelled"].includes(String(entry.entry_status || ""))
  );
  const currentEntry = entries.find((entry) => {
    const start = dateText(entry.period_start);
    const end = dateText(entry.period_end);
    return start && end && start <= monthEnd && end >= monthStart;
  }) || null;
  const activeLoans = loans.filter((loan) => !["settled", "cancelled"].includes(String(loan.status || "")));
  const currentCompensation = currentApprovedCompensation(compensation.profiles, today);

  return {
    worker,
    summary: {
      as_of_date: today,
      tenure_days: tenureDays(worker, now),
      processed_months: processedEntries.length,
      paid_months: entries.filter((entry) => entry.entry_status === "paid").length,
      part_paid_months: entries.filter((entry) => entry.entry_status === "part_paid").length,
      current_month_status: currentEntry?.entry_status || "not_processed",
      current_period_code: currentEntry?.period_code || null,
      current_basic_salary: number(currentCompensation?.basic_salary),
      current_pay_frequency: currentCompensation?.pay_frequency || null,
      ytd_gross_earnings: Number(ytdEntries.reduce((sum, entry) => sum + number(entry.gross_earnings), 0).toFixed(2)),
      ytd_total_deductions: Number(ytdEntries.reduce((sum, entry) => sum + number(entry.total_deductions), 0).toFixed(2)),
      ytd_net_salary: Number(ytdEntries.reduce((sum, entry) => sum + number(entry.net_salary), 0).toFixed(2)),
      ytd_amount_paid: Number(ytdEntries.reduce((sum, entry) => sum + number(entry.amount_paid), 0).toFixed(2)),
      outstanding_salary: Number(entries.reduce((sum, entry) => {
        if (["cancelled", "reversed"].includes(String(entry.entry_status || ""))) return sum;
        return sum + number(entry.remaining_balance);
      }, 0).toFixed(2)),
      active_loan_count: activeLoans.length,
      loan_advance_outstanding: Number(activeLoans.reduce((sum, loan) => sum + number(loan.outstanding_balance), 0).toFixed(2)),
    },
    current_compensation: currentCompensation,
    compensation_history: compensation.profiles,
    payroll_timeline: entries,
    payment_history: payments,
    loans,
    loan_transactions: loanTransactions,
    payslips,
    policy: {
      read_only_profile: true,
      salary_source: "payroll_compensation_profiles",
      payroll_source: "payroll_entries_and_payroll_salary_payments",
      category_isolation_enforced: true,
    },
  };
}

module.exports = {
  workerPayrollProfile,
};
