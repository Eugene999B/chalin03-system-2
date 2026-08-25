const { pool } = require("../config/db");
const { refreshFinanceAgreementFromEvidence } = require("./equipmentFinanceReconciliationService");
const { agreementLateFeePolicy } = require("./equipmentFinanceAuthoritativePolicyService");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const { getProfessionalSettings } = require("./equipmentFinanceProfessionalService");

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateFee(policy, overdueBalance) {
  const base = Math.max(number(overdueBalance), 0);
  if (!base || policy.legacyReviewRequired || !policy.value || policy.type === "none") return 0;
  let fee = policy.type === "percentage" ? (base * policy.value) / 100 : policy.value;
  if (policy.cap > 0) fee = Math.min(fee, policy.cap);
  return Number(Math.max(fee, 0).toFixed(2));
}

async function applyEligibleLateFees({
  connection = pool,
  today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()),
  sendNotifications = true,
  sentBy = null,
} = {}) {
  const [rows] = await connection.query(
    `SELECT schedule.id AS schedule_id,
            schedule.agreement_id,
            schedule.sequence_number,
            schedule.due_date,
            schedule.scheduled_amount,
            schedule.amount_paid,
            schedule.waived_charge_amount,
            schedule.late_charge_amount,
            agreement.agreement_number,
            agreement.policy_version_snapshot,
            agreement.late_charge_type_snapshot,
            agreement.late_charge_value_snapshot,
            agreement.late_charge_cap_snapshot,
            agreement.grace_days_snapshot,
            agreement.customer_name_snapshot,
            agreement.customer_phone_snapshot
       FROM equipment_installment_schedule schedule
       INNER JOIN equipment_sale_agreements agreement
         ON agreement.id = schedule.agreement_id
      WHERE agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
        AND agreement.agreement_status IN ('active','due_soon','payment_due','overdue')
        AND agreement.outstanding_balance > 0.01
        AND schedule.schedule_status IN ('upcoming','due','partial','overdue')
        AND schedule.due_date < ?
        AND DATEDIFF(?, schedule.due_date) > COALESCE(agreement.grace_days_snapshot, 0)
        AND COALESCE(schedule.late_charge_amount, 0) <= 0.009
        AND GREATEST(
              schedule.scheduled_amount - schedule.waived_charge_amount - schedule.amount_paid,
              0
            ) > 0.01
      ORDER BY schedule.due_date, agreement.id, schedule.sequence_number
      LIMIT 500`,
    [today, today]
  );

  const applied = [];
  for (const candidate of rows) {
    const policy = agreementLateFeePolicy(candidate);
    const overduePrincipal = Math.max(
      number(candidate.scheduled_amount) -
        number(candidate.waived_charge_amount) -
        number(candidate.amount_paid),
      0
    );
    const fee = calculateFee(policy, overduePrincipal);
    if (fee <= 0) continue;

    const transaction = connection === pool ? await pool.getConnection() : connection;
    const ownsTransaction = transaction !== connection;
    try {
      if (ownsTransaction) await transaction.beginTransaction();

      const [update] = await transaction.query(
        `UPDATE equipment_installment_schedule
            SET late_charge_amount = ?,
                schedule_status = 'overdue'
          WHERE id = ?
            AND agreement_id = ?
            AND schedule_status IN ('upcoming','due','partial','overdue')
            AND COALESCE(late_charge_amount, 0) <= 0.009
            AND due_date < ?`,
        [fee, candidate.schedule_id, candidate.agreement_id, today]
      );

      if (!update.affectedRows) {
        if (ownsTransaction) await transaction.rollback();
        continue;
      }

      const reconciled = await refreshFinanceAgreementFromEvidence(transaction, candidate.agreement_id);
      if (ownsTransaction) await transaction.commit();

      applied.push({
        agreement_id: candidate.agreement_id,
        agreement_number: candidate.agreement_number,
        schedule_id: candidate.schedule_id,
        sequence_number: candidate.sequence_number,
        due_date: String(candidate.due_date).slice(0, 10),
        late_fee_amount: fee,
        reconciliation_status: reconciled.consistent ? "reconciled" : "review_required",
        customer_name: candidate.customer_name_snapshot || "Customer",
        customer_phone: candidate.customer_phone_snapshot || "",
      });

      if (sendNotifications && applied.length <= 100) {
        const settings = await getProfessionalSettings();
        if (Number(settings.late_fee_applied_sms_enabled ?? 1) && candidate.customer_phone_snapshot) {
          await sendSmsAlertToPhone({
            branchId: null,
            phone: candidate.customer_phone_snapshot,
            message: `CHALIN03 FINANCE: A late payment fee of GHS ${fee.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been applied to installment ${candidate.sequence_number} on agreement ${candidate.agreement_number} because the installment remained unpaid after its due date.`,
            logMessage: `Finance late fee applied for ${candidate.agreement_number}, installment ${candidate.sequence_number}.`,
            smsType: "equipment_finance_late_fee_applied",
            sentBy,
            sourceReference: `finance:late-fee:${candidate.schedule_id}:${today}`,
          });
        }
        if (Number(settings.boss_overdue_alert_enabled ?? 1) && Number(settings.boss_payment_alert_enabled ?? 1) && settings.boss_payment_alert_phone) {
          await sendSmsAlertToPhone({
            branchId: null,
            phone: settings.boss_payment_alert_phone,
            message: `CHALIN03 FINANCE: late fee GHS ${fee.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} applied to ${candidate.agreement_number}, installment ${candidate.sequence_number}, customer ${candidate.customer_name_snapshot || "Customer"}.`,
            logMessage: `Finance boss late fee applied alert for ${candidate.agreement_number}.`,
            smsType: "equipment_finance_boss_late_fee_applied",
            sentBy,
            sourceReference: `finance:late-fee:${candidate.schedule_id}:${today}:boss`,
          });
        }
      }
    } catch (error) {
      if (ownsTransaction) await transaction.rollback();
      throw error;
    } finally {
      if (ownsTransaction) transaction.release();
    }
  }

  return applied;
}

module.exports = { applyEligibleLateFees, calculateFee };
