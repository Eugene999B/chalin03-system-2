const Module = require("module");
const path = require("path");

const originalLoad = Module._load;
let installed = false;

function numberValue(value) {
  return Number(Number(value || 0).toFixed(2));
}

function dateValue(value) {
  return value ? String(value).slice(0, 10) : null;
}

function install() {
  if (installed) return;
  installed = true;

  Module._load = function chalin03PortfolioResilience(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    if (!request.endsWith("equipmentFinancePhaseSixService")) return loaded;
    if (!loaded || typeof loaded.getPortfolioDashboard !== "function" || loaded.__portfolioResilient) {
      return loaded;
    }

    const originalGetPortfolioDashboard = loaded.getPortfolioDashboard;

    async function fallbackPortfolioDashboard({ dateFrom, dateTo } = {}) {
      const { pool } = require("../config/db");
      const today = new Date().toISOString().slice(0, 10);
      const from = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(dateFrom || "")) ? String(dateFrom) : `${today.slice(0, 4)}-01-01`;
      const to = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(dateTo || "")) ? String(dateTo) : today;

      const [[aggregate]] = await pool.query(`
        SELECT
          COUNT(*) AS agreement_count,
          COALESCE(SUM(agreement.total_amount), 0) AS portfolio_value,
          COALESCE(SUM(agreement.deposit_received), 0) AS deposits_received,
          COALESCE(SUM(agreement.amount_paid), 0) AS recorded_collections
        FROM equipment_sale_agreements agreement
        WHERE agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
      `);

      const [accounts] = await pool.query(`
        SELECT
          agreement.id AS agreement_id,
          agreement.agreement_number,
          agreement.agreement_status,
          agreement.customer_name_snapshot AS customer_name,
          agreement.customer_phone_snapshot AS customer_phone,
          agreement.asset_code_snapshot AS asset_code,
          agreement.asset_name_snapshot AS asset_name,
          agreement.total_amount,
          agreement.amount_paid,
          agreement.outstanding_balance,
          agreement.overdue_amount,
          agreement.next_due_date,
          agreement.first_due_date,
          agreement.final_due_date,
          agreement.deposit_received,
          agreement.financed_amount,
          agreement.equipment_commitment_status
        FROM equipment_sale_agreements agreement
        WHERE agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
        ORDER BY agreement.id DESC
      `);

      const [paymentRows] = await pool.query(`
        SELECT COALESCE(SUM(payment.amount), 0) AS amount
        FROM equipment_sale_payments payment
        INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
        WHERE payment.is_voided = FALSE
          AND agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
          AND DATE(payment.payment_date) BETWEEN ? AND ?
      `, [from, to]);

      const [upcoming] = await pool.query(`
        SELECT
          schedule.due_date,
          COUNT(DISTINCT schedule.agreement_id) AS agreements,
          COALESCE(SUM(GREATEST(
            schedule.scheduled_amount + schedule.late_charge_amount - schedule.waived_charge_amount - schedule.amount_paid,
            0
          )), 0) AS expected_amount
        FROM equipment_installment_schedule schedule
        INNER JOIN equipment_sale_agreements agreement ON agreement.id = schedule.agreement_id
        WHERE schedule.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
          AND schedule.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
          AND agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
        GROUP BY schedule.due_date
        ORDER BY schedule.due_date
      `);

      const [recentPayments] = await pool.query(`
        SELECT
          payment.id AS payment_id,
          payment.receipt_number,
          payment.payment_date,
          payment.amount,
          payment.payment_method,
          agreement.agreement_number,
          COALESCE(agreement.customer_name_snapshot, customer.customer_name) AS customer_name
        FROM equipment_sale_payments payment
        INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
        LEFT JOIN hire_customers customer ON customer.id = payment.customer_id
        WHERE payment.is_voided = FALSE
          AND agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
          AND DATE(payment.payment_date) BETWEEN ? AND ?
        ORDER BY payment.payment_date DESC, payment.id DESC
        LIMIT 25
      `, [from, to]);

      const normalizedAccounts = accounts.map((row) => ({
        ...row,
        agreement_id: Number(row.agreement_id),
        total_amount: numberValue(row.total_amount),
        amount_paid: numberValue(row.amount_paid),
        outstanding_balance: numberValue(row.outstanding_balance),
        overdue_amount: numberValue(row.overdue_amount),
        deposit_received: numberValue(row.deposit_received),
        financed_amount: numberValue(row.financed_amount),
        next_due_date: dateValue(row.next_due_date),
        first_due_date: dateValue(row.first_due_date),
        final_due_date: dateValue(row.final_due_date),
      }));

      const activeCount = normalizedAccounts.filter((row) => !["completed", "cancelled", "defaulted"].includes(row.agreement_status) && row.outstanding_balance > 0.01).length;
      const completedCount = normalizedAccounts.filter((row) => row.outstanding_balance <= 0.01 || row.agreement_status === "completed").length;
      const overdueCount = normalizedAccounts.filter((row) => row.overdue_amount > 0.01).length;
      const lifetimeCollections = normalizedAccounts.reduce((sum, row) => sum + row.amount_paid, 0);
      const depositsReceived = normalizedAccounts.reduce((sum, row) => sum + row.deposit_received, 0);
      const portfolioValue = normalizedAccounts.reduce((sum, row) => sum + row.total_amount, 0);
      const outstandingBalance = normalizedAccounts.reduce((sum, row) => sum + row.outstanding_balance, 0);
      const overdueAmount = normalizedAccounts.reduce((sum, row) => sum + row.overdue_amount, 0);

      return {
        period: { date_from: from, date_to: to },
        summary: {
          agreement_count: normalizedAccounts.length,
          active_count: activeCount,
          completed_count: completedCount,
          overdue_count: overdueCount,
          portfolio_value: numberValue(portfolioValue || aggregate.portfolio_value),
          deposits_received: numberValue(depositsReceived || aggregate.deposits_received),
          lifetime_collections: numberValue(lifetimeCollections || aggregate.recorded_collections),
          outstanding_balance: numberValue(outstandingBalance),
          overdue_amount: numberValue(overdueAmount),
          collection_count: Number(aggregate.agreement_count || 0),
          collected_amount: numberValue(paymentRows[0]?.amount),
        },
        accounts: normalizedAccounts,
        recent_payments: recentPayments.map((row) => ({
          ...row,
          payment_id: Number(row.payment_id),
          amount: numberValue(row.amount),
          payment_date: row.payment_date,
        })),
        upcoming: upcoming.map((row) => ({
          ...row,
          agreements: Number(row.agreements || 0),
          expected_amount: numberValue(row.expected_amount),
          due_date: dateValue(row.due_date),
        })),
        aging: {
          current: numberValue(Math.max(outstandingBalance - overdueAmount, 0)),
          overdue: numberValue(overdueAmount),
        },
        reconciliation_warning: true,
      };
    }

    loaded.getPortfolioDashboard = async function resilientGetPortfolioDashboard(options = {}) {
      try {
        return await originalGetPortfolioDashboard(options);
      } catch (error) {
        console.error("Finance portfolio reconciliation failed; serving read-only portfolio fallback:", error);
        const fallback = await fallbackPortfolioDashboard(options);
        return {
          ...fallback,
          reconciliation_warning: true,
          reconciliation_error_code: error?.code || "EQUIPMENT_FINANCE_RECONCILIATION_ERROR",
        };
      }
    };
    loaded.__portfolioResilient = true;
    return loaded;
  };
}

install();
