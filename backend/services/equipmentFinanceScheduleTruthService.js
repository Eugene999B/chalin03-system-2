const { pool } = require("../config/db");

const TERMINAL_STATUSES = new Set(["cancelled", "waived", "rescheduled"]);

function amount(value) {
  return Number(Number(value || 0).toFixed(2));
}

function dateText(value) {
  return value ? String(value).slice(0, 10) : null;
}

async function getAgreementScheduleTruth(connection = pool, agreementId) {
  const [rows] = await connection.query(
    `SELECT
       MIN(CASE
         WHEN s.schedule_status NOT IN ('cancelled','waived','rescheduled')
           AND DATE(s.due_date) >= DATE(agreement.created_at)
           AND GREATEST(
             s.scheduled_amount + s.late_charge_amount - s.waived_charge_amount
               - COALESCE(a.allocated_amount, 0),
             0
           ) > 0.009
         THEN s.due_date
       END) AS next_due_date,
       MIN(CASE
         WHEN s.schedule_status NOT IN ('cancelled','waived','rescheduled')
           AND s.due_date < CURDATE()
           AND GREATEST(
             s.scheduled_amount + s.late_charge_amount - s.waived_charge_amount
               - COALESCE(a.allocated_amount, 0),
             0
           ) > 0.009
         THEN s.due_date
       END) AS oldest_overdue_date,
       MIN(CASE
         WHEN s.schedule_status <> 'rescheduled' THEN s.due_date
       END) AS first_due_date,
       MAX(CASE
         WHEN s.schedule_status <> 'rescheduled' THEN s.due_date
       END) AS final_due_date,
       COALESCE(SUM(CASE
         WHEN s.schedule_status NOT IN ('cancelled','waived','rescheduled')
         THEN GREATEST(
           s.scheduled_amount + s.late_charge_amount - s.waived_charge_amount
             - COALESCE(a.allocated_amount, 0),
           0
         )
         ELSE 0
       END), 0) AS schedule_outstanding
     FROM equipment_installment_schedule s
     INNER JOIN equipment_sale_agreements agreement ON agreement.id = s.agreement_id
     LEFT JOIN (
       SELECT
         allocation.schedule_id,
         SUM(CASE WHEN payment.is_voided = FALSE THEN allocation.allocated_amount ELSE 0 END) AS allocated_amount
       FROM equipment_sale_payment_allocations allocation
       INNER JOIN equipment_sale_payments payment
         ON payment.id = allocation.payment_id
       GROUP BY allocation.schedule_id
     ) a ON a.schedule_id = s.id
     WHERE s.agreement_id = ?`,
    [Number(agreementId)]
  );

  const row = rows[0] || {};
  return {
    next_due_date: dateText(row.next_due_date),
    oldest_overdue_date: dateText(row.oldest_overdue_date),
    first_due_date: dateText(row.first_due_date),
    final_due_date: dateText(row.final_due_date),
    schedule_outstanding: amount(row.schedule_outstanding),
  };
}

async function getPortfolioScheduleTruth(connection = pool) {
  const [rows] = await connection.query(
    `SELECT
       s.agreement_id,
       MIN(CASE
         WHEN s.schedule_status NOT IN ('cancelled','waived','rescheduled')
           AND DATE(s.due_date) >= DATE(agreement.created_at)
           AND GREATEST(
             s.scheduled_amount + s.late_charge_amount - s.waived_charge_amount
               - COALESCE(a.allocated_amount, 0),
             0
           ) > 0.009
         THEN s.due_date
       END) AS next_due_date,
       MIN(CASE
         WHEN s.schedule_status NOT IN ('cancelled','waived','rescheduled')
           AND s.due_date < CURDATE()
           AND GREATEST(
             s.scheduled_amount + s.late_charge_amount - s.waived_charge_amount
               - COALESCE(a.allocated_amount, 0),
             0
           ) > 0.009
         THEN s.due_date
       END) AS oldest_overdue_date,
       MIN(CASE WHEN s.schedule_status <> 'rescheduled' THEN s.due_date END) AS first_due_date,
       MAX(CASE WHEN s.schedule_status <> 'rescheduled' THEN s.due_date END) AS final_due_date,
       COALESCE(SUM(CASE
         WHEN s.schedule_status NOT IN ('cancelled','waived','rescheduled')
         THEN GREATEST(
           s.scheduled_amount + s.late_charge_amount - s.waived_charge_amount
             - COALESCE(a.allocated_amount, 0),
           0
         )
         ELSE 0
       END), 0) AS schedule_outstanding
     FROM equipment_installment_schedule s
     INNER JOIN equipment_sale_agreements agreement ON agreement.id = s.agreement_id
     LEFT JOIN (
       SELECT
         allocation.schedule_id,
         SUM(CASE WHEN payment.is_voided = FALSE THEN allocation.allocated_amount ELSE 0 END) AS allocated_amount
       FROM equipment_sale_payment_allocations allocation
       INNER JOIN equipment_sale_payments payment
         ON payment.id = allocation.payment_id
       GROUP BY allocation.schedule_id
     ) a ON a.schedule_id = s.id
    GROUP BY s.agreement_id`,
  );

  return new Map(
    rows.map((row) => [
      Number(row.agreement_id),
      {
        next_due_date: dateText(row.next_due_date),
        oldest_overdue_date: dateText(row.oldest_overdue_date),
        first_due_date: dateText(row.first_due_date),
        final_due_date: dateText(row.final_due_date),
        schedule_outstanding: amount(row.schedule_outstanding),
      },
    ])
  );
}

module.exports = {
  TERMINAL_STATUSES,
  getAgreementScheduleTruth,
  getPortfolioScheduleTruth,
};
