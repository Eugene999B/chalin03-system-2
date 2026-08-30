const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const { getProfessionalSettings } = require("./equipmentFinanceProfessionalService");
const { getAgreementScheduleTruth } = require("./equipmentFinanceScheduleTruthService");

const ACTIVE_AGREEMENT_STATUS = new Set(["active", "payment_due", "overdue", "due_soon", "defaulted"]);
const TRIGGER_MODES = new Set(["each_missed_installment", "after_final_due_plus_grace"]);
const DECISION_MODES = new Set(["automatic", "boss_approval"]);
const DECISIONS = new Set(["approve", "decline"]);

function appError(message, statusCode = 400, code = "EQUIPMENT_FINANCE_LATE_FEE_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function dateText(value) {
  return value ? String(value).slice(0, 10) : null;
}

function addDays(dateValue, days) {
  if (!dateValue) return null;
  const date = new Date(`${dateText(dateValue)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function todayInGhana() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function onOrAfter(left, right) {
  return Boolean(left && right && left >= right);
}

function normalizeWeekInterval(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 4 ? number : fallback;
}

async function ensureDecisionTable(connection = pool) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS equipment_finance_late_fee_decisions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      agreement_id BIGINT NOT NULL,
      schedule_id BIGINT NOT NULL,
      trigger_mode VARCHAR(60) NOT NULL,
      decision_mode VARCHAR(30) NOT NULL,
      eligible_on DATE NOT NULL,
      proposed_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      basis_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      fee_type VARCHAR(30) NOT NULL DEFAULT 'fixed',
      fee_value DECIMAL(15,4) NOT NULL DEFAULT 0,
      status ENUM('pending','applied','waived') NOT NULL DEFAULT 'pending',
      decided_by INT NULL,
      decided_at DATETIME NULL,
      decision_reason VARCHAR(1000) NULL,
      applied_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_equipment_finance_late_fee_decision (agreement_id, schedule_id, trigger_mode),
      INDEX idx_equipment_finance_late_fee_queue (status, eligible_on),
      INDEX idx_equipment_finance_late_fee_agreement (agreement_id, status)
    )
  `);
}

function computeFee({ feeType, feeValue, cap, basisAmount }) {
  const basis = money(basisAmount);
  if (!basis || Number(feeValue || 0) <= 0 || feeType === "none") return 0;
  let fee = feeType === "percentage"
    ? (basis * Number(feeValue || 0)) / 100
    : Number(feeValue || 0);
  if (Number(cap || 0) > 0) fee = Math.min(fee, Number(cap));
  return money(Math.min(fee, basis));
}

async function loadOpenScheduleRows(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT
       schedule.id,
       schedule.sequence_number,
       schedule.due_date,
       schedule.scheduled_amount,
       schedule.amount_paid,
       schedule.late_charge_amount,
       schedule.waived_charge_amount,
       GREATEST(
         COALESCE(schedule.scheduled_amount, 0)
         + COALESCE(schedule.late_charge_amount, 0)
         - COALESCE(schedule.waived_charge_amount, 0)
         - COALESCE(allocation.allocated_amount, 0),
         0
       ) AS remaining_amount
     FROM equipment_installment_schedule schedule
     LEFT JOIN (
       SELECT schedule_id, SUM(COALESCE(allocated_amount, 0)) AS allocated_amount
       FROM equipment_sale_payment_allocations allocation
       INNER JOIN equipment_sale_payments payment ON payment.id = allocation.payment_id
       WHERE payment.is_voided = FALSE
       GROUP BY schedule_id
     ) allocation ON allocation.schedule_id = schedule.id
     WHERE schedule.agreement_id = ?
       AND schedule.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
     ORDER BY schedule.due_date, schedule.sequence_number`,
    [Number(agreementId)]
  );
  return rows;
}

async function loadAgreement(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT agreement.id,
            agreement.agreement_number,
            agreement.agreement_status,
            agreement.customer_id,
            customer.customer_name,
            customer.phone AS customer_phone,
            asset.asset_code,
            asset.asset_name
     FROM equipment_sale_agreements agreement
     INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
     WHERE agreement.id = ?
       AND agreement.sale_type = 'installment'
       AND agreement.activation_source = 'approved_credit_application'
     LIMIT 1`,
    [Number(agreementId)]
  );
  if (!rows.length) {
    throw appError("The Finance installment agreement was not found.", 404, "FINANCE_AGREEMENT_NOT_FOUND");
  }
  return rows[0];
}

async function getPolicy() {
  const settings = await getProfessionalSettings();
  const triggerMode = TRIGGER_MODES.has(String(settings.late_fee_trigger_mode))
    ? String(settings.late_fee_trigger_mode)
    : "each_missed_installment";
  const decisionMode = DECISION_MODES.has(String(settings.late_fee_decision_mode))
    ? String(settings.late_fee_decision_mode)
    : "automatic";
  return {
    default_week_interval_weeks: normalizeWeekInterval(settings.default_week_interval_weeks),
    late_fee_trigger_mode: triggerMode,
    late_fee_decision_mode: decisionMode,
    late_charge_type: settings.late_charge_type || "none",
    late_charge_value: Number(settings.late_charge_value || 0),
    late_charge_cap: Number(settings.late_charge_cap || 0),
    default_grace_days: Number(settings.default_grace_days || 0),
  };
}

function validatePolicyInput(input = {}) {
  const weekInterval = Number(input.default_week_interval_weeks);
  if (!Number.isInteger(weekInterval) || weekInterval < 1 || weekInterval > 4) {
    throw appError("Default week interval must be 1, 2, 3 or 4 weeks.");
  }
  if (!TRIGGER_MODES.has(String(input.late_fee_trigger_mode))) {
    throw appError("Choose a valid late-fee timing policy.");
  }
  if (!DECISION_MODES.has(String(input.late_fee_decision_mode))) {
    throw appError("Choose a valid late-fee decision policy.");
  }
  return {
    default_week_interval_weeks: weekInterval,
    late_fee_trigger_mode: String(input.late_fee_trigger_mode),
    late_fee_decision_mode: String(input.late_fee_decision_mode),
  };
}

async function updatePolicy({ input, userId, req, reason }) {
  const changes = validatePolicyInput(input);
  const cleanReason = String(reason || "").trim();
  if (cleanReason.length < 5) throw appError("Enter a clear reason for the Finance policy change.");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM equipment_finance_settings WHERE id = 1 LIMIT 1 FOR UPDATE"
    );
    if (!rows.length) throw appError("Finance settings are missing.", 503, "EQUIPMENT_FINANCE_SETTINGS_MISSING");
    const current = rows[0];
    await connection.query(
      `UPDATE equipment_finance_settings
       SET default_week_interval_weeks = ?,
           late_fee_trigger_mode = ?,
           late_fee_decision_mode = ?,
           updated_by = ?,
           updated_at = NOW()
       WHERE id = 1`,
      [changes.default_week_interval_weeks, changes.late_fee_trigger_mode, changes.late_fee_decision_mode, userId || null]
    );
    const [nextRows] = await connection.query(
      "SELECT * FROM equipment_finance_settings WHERE id = 1 LIMIT 1"
    );
    const next = nextRows[0];
    await connection.query(
      `INSERT INTO equipment_finance_settings_history (
         settings_id, old_snapshot_json, new_snapshot_json, change_reason,
         changed_by, request_id, ip_address, user_agent
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        JSON.stringify({
          default_week_interval_weeks: current.default_week_interval_weeks,
          late_fee_trigger_mode: current.late_fee_trigger_mode,
          late_fee_decision_mode: current.late_fee_decision_mode,
        }),
        JSON.stringify(changes),
        cleanReason,
        userId || null,
        String(req?.requestId || req?.id || "").slice(0, 120) || null,
        String(req?.headers?.["x-forwarded-for"] || req?.ip || "").split(",")[0].slice(0, 80) || null,
        String(req?.headers?.["user-agent"] || "").slice(0, 500) || null,
      ]
    );
    await connection.commit();
    return { ...changes, changed: true, saved_at: next.updated_at };
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    throw error;
  } finally {
    connection.release();
  }
}

async function createDecision(connection, agreementId, scheduleRow, policy, eligibleOn, basisAmount) {
  const proposedAmount = computeFee({
    feeType: policy.late_charge_type,
    feeValue: policy.late_charge_value,
    cap: policy.late_charge_cap,
    basisAmount,
  });
  if (!proposedAmount) return null;

  const [existing] = await connection.query(
    `SELECT * FROM equipment_finance_late_fee_decisions
     WHERE agreement_id = ? AND schedule_id = ? AND trigger_mode = ?
     LIMIT 1`,
    [Number(agreementId), Number(scheduleRow.id), policy.late_fee_trigger_mode]
  );
  if (existing.length) return existing[0];

  const status = policy.late_fee_decision_mode === "boss_approval" ? "pending" : "applied";
  const [result] = await connection.query(
    `INSERT INTO equipment_finance_late_fee_decisions (
       agreement_id, schedule_id, trigger_mode, decision_mode, eligible_on,
       proposed_amount, basis_amount, fee_type, fee_value, status, applied_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(agreementId), Number(scheduleRow.id), policy.late_fee_trigger_mode,
      policy.late_fee_decision_mode, eligibleOn, proposedAmount, money(basisAmount),
      policy.late_charge_type, Number(policy.late_charge_value || 0), status,
      status === "applied" ? new Date() : null,
    ]
  );
  const [rows] = await connection.query(
    "SELECT * FROM equipment_finance_late_fee_decisions WHERE id = ? LIMIT 1",
    [result.insertId]
  );
  return rows[0] || null;
}

async function setScheduleLateCharge(connection, scheduleId, amountValue) {
  if (amountValue <= 0) return;
  await connection.query(
    `UPDATE equipment_installment_schedule
     SET late_charge_amount = GREATEST(COALESCE(late_charge_amount,0), ?)
     WHERE id = ?`,
    [money(amountValue), Number(scheduleId)]
  );
}

async function evaluateAgreementLateFee(agreementId, { create = true, connection: suppliedConnection = null } = {}) {
  const policy = await getPolicy();
  if (policy.late_charge_type === "none" || policy.late_charge_value <= 0) {
    return { eligible: false, reason: "Late fee is disabled by Finance Settings.", policy };
  }

  const connection = suppliedConnection || await pool.getConnection();
  const ownsConnection = !suppliedConnection;
  try {
    await ensureDecisionTable(connection);
    const agreement = await loadAgreement(connection, agreementId);
    if (!ACTIVE_AGREEMENT_STATUS.has(String(agreement.agreement_status))) {
      return { eligible: false, reason: "The agreement is not active for late-fee evaluation.", policy, agreement };
    }
    const scheduleTruth = await getAgreementScheduleTruth(connection, agreementId);
    const scheduleRows = await loadOpenScheduleRows(connection, agreementId);
    const today = todayInGhana();

    if (policy.late_fee_trigger_mode === "after_final_due_plus_grace") {
      const finalDueDate = scheduleTruth.final_due_date;
      const eligibleOn = addDays(finalDueDate, policy.default_grace_days);
      if (!finalDueDate || !onOrAfter(today, eligibleOn) || scheduleTruth.schedule_outstanding <= 0.01) {
        return {
          eligible: false,
          reason: "The final scheduled due date plus the configured grace period has not been reached, or the agreement is settled.",
          policy,
          agreement,
          scheduleTruth,
        };
      }
      const finalSchedule = scheduleRows.length ? scheduleRows[scheduleRows.length - 1] : null;
      if (!finalSchedule || Number(finalSchedule.remaining_amount || 0) <= 0.01) {
        return { eligible: false, reason: "No outstanding final schedule line remains.", policy, agreement, scheduleTruth };
      }
      const decision = create
        ? await createDecision(connection, agreementId, finalSchedule, policy, eligibleOn, scheduleTruth.schedule_outstanding)
        : null;
      if (create && decision?.status === "applied") {
        await setScheduleLateCharge(connection, finalSchedule.id, Number(decision.proposed_amount || 0));
      }
      return {
        eligible: true,
        policy,
        agreement,
        scheduleTruth,
        eligible_on: eligibleOn,
        decision,
        proposed_amount: Number(decision?.proposed_amount || computeFee({
          feeType: policy.late_charge_type,
          feeValue: policy.late_charge_value,
          cap: policy.late_charge_cap,
          basisAmount: scheduleTruth.schedule_outstanding,
        })),
      };
    }

    const eligible = scheduleRows.filter(
      (row) => Number(row.remaining_amount || 0) > 0.01
        && row.due_date
        && onOrAfter(today, addDays(row.due_date, policy.default_grace_days))
    );
    const decisions = [];
    for (const row of eligible) {
      const eligibleOn = addDays(row.due_date, policy.default_grace_days);
      const decision = create
        ? await createDecision(connection, agreementId, row, policy, eligibleOn, Number(row.remaining_amount || 0))
        : null;
      if (create && decision?.status === "applied") {
        await setScheduleLateCharge(connection, row.id, Number(decision.proposed_amount || 0));
      }
      decisions.push({ ...row, eligible_on: eligibleOn, decision });
    }
    return { eligible: decisions.length > 0, policy, agreement, decisions, scheduleTruth };
  } finally {
    if (ownsConnection) connection.release();
  }
}

async function listPendingLateFees() {
  const policy = await getPolicy();
  const connection = await pool.getConnection();
  try {
    await ensureDecisionTable(connection);
    const [agreements] = await connection.query(
      `SELECT id
       FROM equipment_sale_agreements
       WHERE sale_type = 'installment'
         AND activation_source = 'approved_credit_application'
         AND agreement_status NOT IN ('completed','cancelled')
       ORDER BY id`
    );
    const results = [];
    for (const row of agreements) {
      const evaluated = await evaluateAgreementLateFee(Number(row.id), { create: true });
      if (evaluated.decision?.status === "pending") {
        results.push({ agreement: evaluated.agreement, policy, schedule: null, decision: evaluated.decision });
      }
      for (const item of evaluated.decisions || []) {
        if (item.decision?.status === "pending") {
          results.push({ agreement: evaluated.agreement, policy, schedule: item, decision: item.decision });
        }
      }
    }
    return results;
  } finally {
    connection.release();
  }
}

async function getAgreementLateFee(agreementId) {
  return evaluateAgreementLateFee(agreementId, { create: true });
}

async function decideLateFee({ agreementId, decision, userId, reason }) {
  if (!DECISIONS.has(String(decision))) throw appError("Choose approve or decline for the late fee decision.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureDecisionTable(connection);
    const [rows] = await connection.query(
      `SELECT d.*, a.agreement_number
       FROM equipment_finance_late_fee_decisions d
       INNER JOIN equipment_sale_agreements a ON a.id = d.agreement_id
       WHERE d.agreement_id = ? AND d.status = 'pending'
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT 1 FOR UPDATE`,
      [Number(agreementId)]
    );
    if (!rows.length) throw appError("There is no pending late-fee decision for this agreement.", 404, "NO_PENDING_LATE_FEE");
    const row = rows[0];
    const cleanReason = String(reason || "").trim().slice(0, 1000) || null;
    if (String(decision) === "approve") {
      await setScheduleLateCharge(connection, row.schedule_id, Number(row.proposed_amount || 0));
      await connection.query(
        `UPDATE equipment_finance_late_fee_decisions
         SET status = 'applied', decided_by = ?, decided_at = NOW(),
             decision_reason = ?, applied_at = COALESCE(applied_at, NOW())
         WHERE id = ? AND status = 'pending'`,
        [userId || null, cleanReason || "Late fee approved by authorised Finance management.", Number(row.id)]
      );
      await writeAuditEvent({
        connection,
        req: null,
        action: "EQUIPMENT_FINANCE_LATE_FEE_APPLIED",
        actionType: "LATE_FEE_DECISION",
        entityType: "equipment_sale_agreement",
        entityId: Number(agreementId),
        workspaceCode: "equipment_installment_finance",
        hireLocationId: null,
        severity: "notice",
        outcome: "success",
        details: `Late fee of GHS ${money(row.proposed_amount).toLocaleString("en-GH", { minimumFractionDigits: 2 })} approved and added to agreement ${row.agreement_number}.`,
        metadata: { decision_id: Number(row.id), late_fee_amount: money(row.proposed_amount), decision: "approve" },
      });
      await connection.commit();
      return { status: "applied", decision_id: Number(row.id), amount: money(row.proposed_amount) };
    }

    await connection.query(
      `UPDATE equipment_finance_late_fee_decisions
       SET status = 'waived', decided_by = ?, decided_at = NOW(), decision_reason = ?
       WHERE id = ? AND status = 'pending'`,
      [userId || null, cleanReason || "Late fee declined by authorised Finance management.", Number(row.id)]
    );
    await writeAuditEvent({
      connection,
      req: null,
      action: "EQUIPMENT_FINANCE_LATE_FEE_WAIVED",
      actionType: "LATE_FEE_DECISION",
      entityType: "equipment_sale_agreement",
      entityId: Number(agreementId),
      workspaceCode: "equipment_installment_finance",
      hireLocationId: null,
      severity: "info",
      outcome: "success",
      details: `Late fee of GHS ${money(row.proposed_amount).toLocaleString("en-GH", { minimumFractionDigits: 2 })} waived for agreement ${row.agreement_number}.`,
      metadata: { decision_id: Number(row.id), late_fee_amount: money(row.proposed_amount), decision: "decline" },
    });
    await connection.commit();
    return { status: "waived", decision_id: Number(row.id), amount: money(row.proposed_amount) };
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getPolicy,
  updatePolicy,
  evaluateAgreementLateFee,
  listPendingLateFees,
  getAgreementLateFee,
  decideLateFee,
};
