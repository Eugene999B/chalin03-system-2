const crypto = require("crypto");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const {
  getProfessionalSettings,
} = require("./equipmentFinanceProfessionalService");
const {
  startProfessionalReminderScheduler,
} = require("./equipmentFinanceProfessionalReminderService");
const {
  reconcileFinanceAgreement,
  reconcileFinancePortfolio,
} = require("./equipmentFinanceReconciliationService");

const REQUIRED_TABLES = Object.freeze([
  "equipment_finance_phase6_message_log",
  "equipment_finance_phase6_runtime_state",
  "equipment_finance_phase6_export_log",
]);

const PAYMENT_MESSAGE_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.EQUIPMENT_FINANCE_PAYMENT_MESSAGE_INTERVAL_MS || 60 * 1000)
);

let phaseSixSchedulersStarted = false;
let paymentMessageSyncRunning = false;

class EquipmentFinancePhaseSixError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_PHASE6_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value, label = "ID") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new EquipmentFinancePhaseSixError(
      400,
      `${label} must be a positive whole number.`,
      "INVALID_IDENTIFIER"
    );
  }
  return number;
}

function dateInput(value, fallback) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function money(value) {
  return Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function numberValue(value) {
  return Number(Number(value || 0).toFixed(2));
}

function dateLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Accra",
  });
}

function dateTimeLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Accra",
  });
}

function replaceTemplate(template, values) {
  return String(template || "").replace(/\{([a-z0-9_]+)\}/gi, (_match, key) =>
    values[key] === undefined || values[key] === null ? "" : String(values[key])
  );
}

function safeFilename(value, fallback = "equipment-finance") {
  return (
    cleanText(value, 120)
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || fallback
  );
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function phaseSixSchemaStatus(connection = pool) {
  const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})`,
    REQUIRED_TABLES
  );
  const found = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = REQUIRED_TABLES.filter((tableName) => !found.has(tableName));
  return {
    ready: missing.length === 0,
    migration: "equipment_finance_phase6_reporting_notifications",
    missing_tables: missing,
  };
}

async function assertPhaseSixSchema(connection = pool) {
  const readiness = await phaseSixSchemaStatus(connection);
  if (!readiness.ready) {
    const error = new EquipmentFinancePhaseSixError(
      503,
      "Equipment Finance Phase 6 is awaiting its approved additive database migration.",
      "EQUIPMENT_FINANCE_PHASE6_MIGRATION_REQUIRED"
    );
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

async function loadPaymentSnapshot(paymentId, connection = pool) {
  const id = positiveId(paymentId, "Payment ID");
  const [rows] = await connection.query(
    `SELECT payment.id, payment.payment_number, payment.receipt_number,
            payment.payment_date, payment.payment_category, payment.payment_stage,
            payment.amount, payment.payment_method, payment.reference_number,
            payment.notes, payment.received_by, payment.is_voided,
            agreement.id AS agreement_id, agreement.agreement_number,
            agreement.total_amount, agreement.amount_paid,
            agreement.outstanding_balance, agreement.overdue_amount,
            agreement.customer_name_snapshot, agreement.customer_phone_snapshot,
            agreement.asset_name_snapshot, agreement.asset_code_snapshot,
            customer.customer_name, customer.phone AS customer_phone,
            asset.asset_name, asset.asset_code,
            user.full_name AS received_by_name
       FROM equipment_sale_payments payment
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
       INNER JOIN hire_customers customer ON customer.id = payment.customer_id
       INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
       LEFT JOIN users user ON user.id = payment.received_by
      WHERE payment.id = ?
        AND agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
      LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row || Number(row.is_voided || 0) === 1) {
    throw new EquipmentFinancePhaseSixError(
      404,
      "The active Finance payment was not found.",
      "EQUIPMENT_FINANCE_PAYMENT_NOT_FOUND"
    );
  }
  return {
    ...row,
    customer_name: row.customer_name_snapshot || row.customer_name || "Customer",
    customer_phone: row.customer_phone_snapshot || row.customer_phone || "",
    equipment_name: row.asset_name_snapshot || row.asset_name || "equipment",
    equipment_code: row.asset_code_snapshot || row.asset_code || "",
    amount: numberValue(row.amount),
    total_amount: numberValue(row.total_amount),
    amount_paid: numberValue(row.amount_paid),
    outstanding_balance: numberValue(row.outstanding_balance),
    overdue_amount: numberValue(row.overdue_amount),
  };
}

function customerReceiptMessage(payment, settings) {
  return replaceTemplate(settings.customer_receipt_template, {
    customer_name: payment.customer_name,
    amount: money(payment.amount),
    agreement_number: payment.agreement_number,
    equipment_name: payment.equipment_name,
    receipt_number: payment.receipt_number,
    outstanding_balance: money(payment.outstanding_balance),
    payment_method: payment.payment_method,
    payment_date: String(payment.payment_date || "").slice(0, 10),
    staff_name: payment.received_by_name || "Chalin 03",
  }).slice(0, 480);
}

async function sendCustomerPaymentReceipt({ paymentId, sentBy = null, retry = false } = {}) {
  await assertPhaseSixSchema();
  const payment = await loadPaymentSnapshot(paymentId);
  const settings = await getProfessionalSettings();
  const messageKey = `finance-payment-receipt:${payment.id}`;
  const message = customerReceiptMessage(payment, settings);

  if (!settings.customer_payment_receipt_sms_enabled) {
    return {
      ok: false,
      skipped: true,
      status: "skipped",
      reason: "customer_payment_receipt_sms_disabled",
      payment_id: payment.id,
    };
  }

  if (!cleanText(payment.customer_phone, 40)) {
    await pool.query(
      `INSERT INTO equipment_finance_phase6_message_log (
         message_key, message_type, payment_id, agreement_id, recipient_type,
         recipient_phone, message_preview, delivery_status, attempt_count,
         last_error, sent_by
       ) VALUES (?, 'customer_payment_receipt', ?, ?, 'customer', NULL, ?, 'skipped', 0, ?, ?)
       ON DUPLICATE KEY UPDATE
         delivery_status = 'skipped', last_error = VALUES(last_error), updated_at = NOW()`,
      [messageKey, payment.id, payment.agreement_id, message, "Customer phone is missing.", sentBy]
    );
    return {
      ok: false,
      skipped: true,
      status: "skipped",
      reason: "customer_phone_missing",
      payment_id: payment.id,
    };
  }

  if (retry) {
    await pool.query(
      `INSERT INTO equipment_finance_phase6_message_log (message_key, message_type, payment_id, agreement_id,
         recipient_type, recipient_phone, message_preview, delivery_status, attempt_count, last_error, sent_by)
       VALUES (?, 'customer_payment_receipt', ?, ?, 'customer', ?, ?, 'queued', 0, NULL, ?)
       ON DUPLICATE KEY UPDATE
         recipient_phone = VALUES(recipient_phone), message_preview = VALUES(message_preview),
         delivery_status = 'queued', last_error = NULL, sent_by = VALUES(sent_by), updated_at = NOW()`,
      [messageKey, payment.id, payment.agreement_id, payment.customer_phone, message, sentBy]
    );
  }
  const result = await sendSmsAlertToPhone({
    phone: payment.customer_phone,
    message,
    sourceReference: messageKey,
    smsType: "equipment_finance_payment_alert",
  });

  await pool.query(
    `INSERT INTO equipment_finance_phase6_message_log (
       message_key, message_type, payment_id, agreement_id, recipient_type,
       recipient_phone, message_preview, delivery_status, attempt_count,
       sent_at, last_error, sent_by
     ) VALUES (?, 'customer_payment_receipt', ?, ?, 'customer', ?, ?, ?, 1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       recipient_phone = VALUES(recipient_phone), message_preview = VALUES(message_preview),
       delivery_status = VALUES(delivery_status), attempt_count = attempt_count + 1,
       sent_at = VALUES(sent_at), last_error = VALUES(last_error), sent_by = VALUES(sent_by), updated_at = NOW()`,
    [
      messageKey,
      payment.id,
      payment.agreement_id,
      payment.customer_phone,
      message,
      result.ok ? "submitted" : "failed",
      result.ok ? new Date() : null,
      result.ok ? null : result.reason || "SMS provider rejected the request.",
      sentBy,
    ]
  );

  return {
    ok: Boolean(result.ok),
    skipped: false,
    status: result.ok ? "submitted" : "failed",
    reason: result.reason || null,
    provider: result.provider || null,
    payment_id: payment.id,
  };
}

async function syncCustomerPaymentReceipts({ sentBy = null, limit = 100 } = {}) {
  await assertPhaseSixSchema();
  const safeLimit = Math.max(1, Math.min(Number(limit || 100), 500));
  const [payments] = await pool.query(
    `SELECT payment.id
       FROM equipment_sale_payments payment
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
       LEFT JOIN equipment_finance_phase6_message_log message
         ON message.message_key = CONCAT('finance-payment-receipt:', payment.id)
      WHERE payment.is_voided = FALSE
        AND agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
        AND payment.payment_stage = 'installment'
        AND (message.id IS NULL OR message.delivery_status IN ('failed','skipped'))
      ORDER BY payment.payment_date DESC, payment.id DESC
      LIMIT ?`,
    [safeLimit]
  );
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const payment of payments) {
    const result = await sendCustomerPaymentReceipt({ paymentId: payment.id, sentBy, retry: true });
    if (result.ok) sent += 1;
    else if (result.skipped) skipped += 1;
    else failed += 1;
  }
  return { attempted: payments.length, sent, failed, skipped };
}

async function getCustomerStatement(agreementId) {
  await assertPhaseSixSchema();
  const id = positiveId(agreementId, "Agreement ID");
  const reconciliation = await reconcileFinanceAgreement(id);
  const [[agreement], [schedule], [payments], [allocations]] = await Promise.all([
    pool.query(
      `SELECT agreement.*,
              customer.customer_name, customer.phone AS customer_phone,
              customer.address AS customer_address,
              asset.asset_code, asset.asset_name
         FROM equipment_sale_agreements agreement
         INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
         INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
        WHERE agreement.id = ?
          AND agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
        LIMIT 1`,
      [id]
    ),
    pool.query(
      `SELECT schedule.*
         FROM equipment_installment_schedule schedule
        WHERE schedule.agreement_id = ?
        ORDER BY schedule.sequence_number`,
      [id]
    ),
    pool.query(
      `SELECT payment.*, user.full_name AS received_by_name,
              message.delivery_status AS customer_sms_status,
              boss.alert_status AS boss_sms_status
         FROM equipment_sale_payments payment
         LEFT JOIN users user ON user.id = payment.received_by
         LEFT JOIN equipment_finance_phase6_message_log message
           ON message.message_key = CONCAT('finance-payment-receipt:', payment.id)
         LEFT JOIN equipment_finance_payment_alerts boss ON boss.payment_id = payment.id
        WHERE payment.agreement_id = ?
        ORDER BY payment.payment_date, payment.id`,
      [id]
    ),
    pool.query(
      `SELECT allocation.payment_id, allocation.schedule_id,
              allocation.allocated_amount, schedule.sequence_number,
              schedule.due_date, payment.receipt_number
         FROM equipment_sale_payment_allocations allocation
         INNER JOIN equipment_installment_schedule schedule ON schedule.id = allocation.schedule_id
         INNER JOIN equipment_sale_payments payment ON payment.id = allocation.payment_id
        WHERE schedule.agreement_id = ?
        ORDER BY payment.payment_date, allocation.id`,
      [id]
    ),
  ]);
  if (!agreement.length) {
    throw new EquipmentFinancePhaseSixError(
      404,
      "The active Finance agreement was not found.",
      "EQUIPMENT_FINANCE_AGREEMENT_NOT_FOUND"
    );
  }
  return {
    generated_at: new Date().toISOString(),
    reconciliation: {
      consistent: reconciliation.consistent,
      mismatches: reconciliation.mismatches,
      calculated: reconciliation.calculated,
    },
    agreement: {
      ...agreement[0],
      customer_name: agreement[0].customer_name_snapshot || agreement[0].customer_name,
      customer_phone: agreement[0].customer_phone_snapshot || agreement[0].customer_phone,
      customer_address: agreement[0].customer_location_snapshot || agreement[0].customer_address,
      asset_code: agreement[0].asset_code_snapshot || agreement[0].asset_code,
      asset_name: agreement[0].asset_name_snapshot || agreement[0].asset_name,
      total_amount: numberValue(agreement[0].total_amount),
      deposit_required: numberValue(agreement[0].deposit_required),
      deposit_received: reconciliation.calculated.deposit_received,
      financed_amount: numberValue(agreement[0].financed_amount),
      amount_paid: reconciliation.calculated.amount_paid,
      late_charges_total: reconciliation.calculated.late_charges_total,
      waived_charges_total: reconciliation.calculated.waived_charges_total,
      outstanding_balance: reconciliation.calculated.outstanding_balance,
      overdue_amount: reconciliation.calculated.overdue_amount,
      next_due_date: reconciliation.calculated.next_due_date,
      agreement_status: reconciliation.calculated.agreement_status,
    },
    schedule: schedule[0].map((row) => ({
      ...row,
      scheduled_amount: numberValue(row.scheduled_amount),
      amount_paid: numberValue(row.amount_paid),
      late_charge_amount: numberValue(row.late_charge_amount),
      waived_charge_amount: numberValue(row.waived_charge_amount),
      balance: numberValue(
        Math.max(
          Number(row.scheduled_amount || 0) + Number(row.late_charge_amount || 0) -
            Number(row.waived_charge_amount || 0) - Number(row.amount_paid || 0),
          0
        )
      ),
    })),
    payments: payments[0].map((row) => ({ ...row, amount: numberValue(row.amount) })),
    allocations: allocations[0].map((row) => ({
      ...row,
      allocated_amount: numberValue(row.allocated_amount),
    })),
  };
}

async function getArrearsReport({ dateTo } = {}) {
  await assertPhaseSixSchema();
  const today = new Date().toISOString().slice(0, 10);
  const asOf = dateInput(dateTo, today);
  const [rows] = await pool.query(
    `SELECT agreement.id, agreement.agreement_number,
            agreement.customer_name_snapshot AS customer_name,
            agreement.asset_code_snapshot AS asset_code,
            schedule.sequence_number, schedule.due_date,
            schedule.scheduled_amount, schedule.amount_paid,
            schedule.late_charge_amount, schedule.waived_charge_amount,
            GREATEST(schedule.scheduled_amount + schedule.late_charge_amount -
              schedule.waived_charge_amount - schedule.amount_paid, 0) AS balance,
            DATEDIFF(?, schedule.due_date) AS days_overdue
       FROM equipment_installment_schedule schedule
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = schedule.agreement_id
      WHERE schedule.due_date < ?
        AND schedule.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
        AND agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
      ORDER BY schedule.due_date, agreement.agreement_number, schedule.sequence_number`,
    [asOf, asOf]
  );
  const detail = rows.map((row) => ({
    ...row,
    scheduled_amount: numberValue(row.scheduled_amount),
    amount_paid: numberValue(row.amount_paid),
    late_charge_amount: numberValue(row.late_charge_amount),
    waived_charge_amount: numberValue(row.waived_charge_amount),
    balance: numberValue(row.balance),
  }));
  const summary = detail.reduce(
    (acc, row) => {
      acc.overdue_amount += row.balance;
      acc.overdue_installments += 1;
      if (row.days_overdue > acc.max_days_overdue) acc.max_days_overdue = row.days_overdue;
      return acc;
    },
    { overdue_amount: 0, overdue_installments: 0, max_days_overdue: 0 }
  );
  const [counts] = await pool.query(
    `SELECT COUNT(DISTINCT agreement.id) AS overdue_accounts,
            COALESCE(SUM(GREATEST(schedule.scheduled_amount + schedule.late_charge_amount -
              schedule.waived_charge_amount - schedule.amount_paid, 0)), 0) AS overdue_amount
       FROM equipment_installment_schedule schedule
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = schedule.agreement_id
      WHERE schedule.due_date < ?
        AND schedule.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
        AND agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'`,
    [asOf]
  );
  return {
    as_of: asOf,
    summary: {
      overdue_accounts: Number(counts[0]?.overdue_accounts || 0),
      overdue_installments: summary.overdue_installments,
      overdue_amount: numberValue(counts[0]?.overdue_amount || summary.overdue_amount),
      max_days_overdue: Number(summary.max_days_overdue || 0),
    },
    rows: detail,
  };
}

async function getCashFlowReport({ dateFrom, dateTo } = {}) {
  await assertPhaseSixSchema();
  const today = new Date().toISOString().slice(0, 10);
  const from = dateInput(dateFrom, `${today.slice(0, 4)}-01-01`);
  const to = dateInput(dateTo, today);
  const [rows] = await pool.query(
    `SELECT DATE(payment.payment_date) AS transaction_date,
            payment.payment_method, payment.payment_stage,
            COUNT(*) AS payment_count, COALESCE(SUM(payment.amount), 0) AS amount
       FROM equipment_sale_payments payment
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
      WHERE payment.is_voided = FALSE
        AND DATE(payment.payment_date) BETWEEN ? AND ?
        AND agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
      GROUP BY DATE(payment.payment_date), payment.payment_method, payment.payment_stage
      ORDER BY transaction_date, payment.payment_method, payment.payment_stage`,
    [from, to]
  );
  const detail = rows.map((row) => ({ ...row, amount: numberValue(row.amount) }));
  const summary = detail.reduce(
    (acc, row) => {
      acc.total_collected += row.amount;
      acc.payment_count += Number(row.payment_count || 0);
      return acc;
    },
    { total_collected: 0, payment_count: 0 }
  );
  return {
    period: { date_from: from, date_to: to },
    summary: { total_collected: numberValue(summary.total_collected), payment_count: summary.payment_count },
    rows: detail,
  };
}

async function getPortfolioDashboard({ dateFrom, dateTo } = {}) {
  await assertPhaseSixSchema();
  const today = new Date().toISOString().slice(0, 10);
  const from = dateInput(dateFrom, `${today.slice(0, 4)}-01-01`);
  const to = dateInput(dateTo, today);
  const [portfolio, [collectionRows], [upcoming], [recentPayments]] = await Promise.all([
    reconcileFinancePortfolio(),
    pool.query(
      `SELECT COUNT(*) AS payment_count, COALESCE(SUM(payment.amount), 0) AS collected_amount
         FROM equipment_sale_payments payment
         INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
        WHERE payment.is_voided = FALSE AND DATE(payment.payment_date) BETWEEN ? AND ?
          AND agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'`,
      [from, to]
    ),
    pool.query(
      `SELECT schedule.due_date, COUNT(DISTINCT schedule.agreement_id) AS agreements,
              COALESCE(SUM(GREATEST(schedule.scheduled_amount + schedule.late_charge_amount -
                schedule.waived_charge_amount - schedule.amount_paid, 0)), 0) AS expected_amount
         FROM equipment_installment_schedule schedule
         INNER JOIN equipment_sale_agreements agreement ON agreement.id = schedule.agreement_id
        WHERE schedule.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
          AND schedule.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
          AND agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
        GROUP BY schedule.due_date
        ORDER BY schedule.due_date`
    ),
    pool.query(
      `SELECT payment.id, payment.receipt_number, payment.payment_date,
              payment.amount, payment.payment_method, payment.payment_stage,
              agreement.id AS agreement_id, agreement.agreement_number,
              agreement.customer_name_snapshot AS customer_name,
              message.delivery_status AS customer_sms_status,
              boss.alert_status AS boss_sms_status
         FROM equipment_sale_payments payment
         INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
         LEFT JOIN equipment_finance_phase6_message_log message
           ON message.message_key = CONCAT('finance-payment-receipt:', payment.id)
         LEFT JOIN equipment_finance_payment_alerts boss ON boss.payment_id = payment.id
        WHERE payment.is_voided = FALSE
          AND agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
        ORDER BY payment.payment_date DESC, payment.id DESC
        LIMIT 20`
    ),
  ]);

  const collection = collectionRows[0] || {};
  const statusMap = new Map();
  const agingMap = new Map();
  let portfolioValue = 0;
  let depositsReceived = 0;
  let lifetimeCollections = 0;
  let outstandingBalance = 0;
  let overdueBalance = 0;
  let paidPercentTotal = 0;
  let paidPercentCount = 0;
  let activeCount = 0;
  let completedCount = 0;
  let overdueCount = 0;
  let reconciliationAttentionCount = 0;

  const accounts = portfolio.map((result) => {
    const agreement = result.agreement;
    const calculated = result.calculated;
    const total = numberValue(agreement.total_amount);
    const paid = calculated.amount_paid;
    const status = calculated.agreement_status;
    const outstanding = calculated.outstanding_balance;
    const overdue = calculated.overdue_amount;

    portfolioValue += total;
    depositsReceived += calculated.deposit_received;
    lifetimeCollections += paid;
    outstandingBalance += outstanding;
    overdueBalance += overdue;
    if (total > 0) {
      paidPercentTotal += (paid / total) * 100;
      paidPercentCount += 1;
    }
    if (["approved", "active", "due_soon", "payment_due", "overdue"].includes(status)) {
      activeCount += 1;
    }
    if (status === "completed") completedCount += 1;
    if (status === "overdue" || overdue > 0.01) overdueCount += 1;
    if (!result.consistent) reconciliationAttentionCount += 1;

    const statusEntry = statusMap.get(status) || { agreement_status: status, agreements: 0, outstanding_amount: 0 };
    statusEntry.agreements += 1;
    statusEntry.outstanding_amount += outstanding;
    statusMap.set(status, statusEntry);

    const agingBucket = overdue <= 0.01 ? "current" : calculated.days_overdue <= 30 ? "1_30" : calculated.days_overdue <= 60 ? "31_60" : calculated.days_overdue <= 90 ? "61_90" : "90_plus";
    const agingEntry = agingMap.get(agingBucket) || { aging_bucket: agingBucket, accounts: 0, amount: 0 };
    agingEntry.accounts += overdue > 0.01 ? 1 : 0;
    agingEntry.amount += overdue;
    agingMap.set(agingBucket, agingEntry);

    return {
      agreement_id: agreement.id,
      agreement_number: agreement.agreement_number,
      customer_name: agreement.customer_name_snapshot || agreement.customer_name,
      asset_code: agreement.asset_code_snapshot || agreement.asset_code,
      asset_name: agreement.asset_name_snapshot || agreement.asset_name,
      agreement_status: status,
      total_amount: total,
      deposit_required: numberValue(agreement.deposit_required),
      deposit_received: calculated.deposit_received,
      financed_amount: numberValue(agreement.financed_amount),
      amount_paid: paid,
      outstanding_balance: outstanding,
      overdue_amount: overdue,
      days_overdue: calculated.days_overdue,
      next_due_date: calculated.next_due_date,
      consistency: result.consistent ? "consistent" : "attention",
      reconciliation_mismatches: result.mismatches,
    };
  });

  return {
    period: {
      date_from: from,
      date_to: to,
    },
    summary: {
      agreement_count: accounts.length,
      active_count: activeCount,
      completed_count: completedCount,
      overdue_count: overdueCount,
      portfolio_value: numberValue(portfolioValue),
      deposits_received: numberValue(depositsReceived),
      lifetime_collections: numberValue(lifetimeCollections),
      period_collections: numberValue(collection.collected_amount),
      period_payment_count: Number(collection.payment_count || 0),
      outstanding_balance: numberValue(outstandingBalance),
      overdue_balance: numberValue(overdueBalance),
      collection_rate: portfolioValue > 0 ? numberValue((lifetimeCollections / portfolioValue) * 100) : 0,
      average_paid_percent: paidPercentCount > 0 ? numberValue(paidPercentTotal / paidPercentCount) : 0,
      reconciliation_attention_count: reconciliationAttentionCount,
    },
    status_breakdown: Array.from(statusMap.values()).map((row) => ({
      ...row,
      outstanding_amount: numberValue(row.outstanding_amount),
    })),
    aging: Array.from(agingMap.values()).map((row) => ({
      ...row,
      amount: numberValue(row.amount),
    })),
    upcoming_due: upcoming.map((row) => ({
      ...row,
      agreements: Number(row.agreements || 0),
      expected_amount: numberValue(row.expected_amount),
    })),
    recent_payments: recentPayments.map((row) => ({ ...row, amount: numberValue(row.amount) })),
    accounts,
  };
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

async function renderCustomerStatementPdf(statement) {
  const settings = await getProfessionalSettings();
  const document = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const output = collectPdf(document);
  const agreement = statement.agreement;
  document.font("Helvetica-Bold").fontSize(17).text(settings.company_name || "CHALIN 03 COMPANY LIMITED", { align: "center" });
  document.font("Helvetica").fontSize(9).text(settings.company_address || "", { align: "center" });
  document.moveDown(0.5);
  document.font("Helvetica-Bold").fontSize(15).text("INSTALLMENT CUSTOMER STATEMENT", { align: "center" });
  document.font("Helvetica").fontSize(9).text(`Generated ${dateTimeLabel(statement.generated_at)}`, { align: "center" });
  document.moveDown();
  const details = [
    ["Agreement", agreement.agreement_number],
    ["Customer", agreement.customer_name],
    ["Phone", agreement.customer_phone],
    ["Machine", `${agreement.asset_code || ""} ${agreement.asset_name || ""}`.trim()],
    ["Total price", `GHS ${money(agreement.total_amount)}`],
    ["Paid", `GHS ${money(agreement.amount_paid)}`],
    ["Outstanding", `GHS ${money(agreement.outstanding_balance)}`],
    ["Overdue", `GHS ${money(agreement.overdue_amount)}`],
    ["Next due", dateLabel(agreement.next_due_date)],
  ];
  for (const [label, value] of details) {
    document.font("Helvetica-Bold").fontSize(9).text(`${label}: `, { continued: true });
    document.font("Helvetica").text(String(value || "—"));
  }
  document.moveDown();
  document.font("Helvetica-Bold").fontSize(11).text("PAYMENT HISTORY");
  document.moveDown(0.3);
  if (!statement.payments.length) {
    document.font("Helvetica").fontSize(9).text("No payments have been recorded.");
  }
  for (const payment of statement.payments) {
    if (document.y > 730) document.addPage();
    document.font("Helvetica-Bold").fontSize(9).text(`${dateLabel(payment.payment_date)} • ${payment.receipt_number}`);
    document.font("Helvetica").fontSize(8.5).text(
      `GHS ${money(payment.amount)} • ${String(payment.payment_method || "").toUpperCase()} • Received by ${payment.received_by_name || "Chalin 03"}`
    );
    document.fontSize(8).text(
      `Customer SMS: ${payment.customer_sms_status || "not sent"} • Boss SMS: ${payment.boss_sms_status || "not sent"}`
    );
    document.moveDown(0.45);
  }
  document.moveDown();
  document.font("Helvetica-Bold").fontSize(11).text("INSTALLMENT SCHEDULE");
  document.moveDown(0.3);
  for (const row of statement.schedule) {
    if (document.y > 740) document.addPage();
    document.font("Helvetica").fontSize(8.2).text(
      `#${row.sequence_number} • ${dateLabel(row.due_date)} • Due GHS ${money(row.scheduled_amount)} • Paid GHS ${money(row.amount_paid)} • Balance GHS ${money(row.balance)} • ${String(row.schedule_status || "").toUpperCase()}`
    );
  }
  document.moveDown();
  document.font("Helvetica").fontSize(7.5).text(
    "This statement is generated from the official server-side agreement, schedule, payment and allocation records. Voided payments remain visible in the audit system and are not counted as collections.",
    { align: "center" }
  );
  document.end();
  return output;
}

async function renderThermalReceiptPdf(paymentId) {
  await assertPhaseSixSchema();
  const payment = await loadPaymentSnapshot(paymentId);
  const settings = await getProfessionalSettings();
  const [allocations] = await pool.query(
    `SELECT allocation.allocated_amount, schedule.sequence_number, schedule.due_date
       FROM equipment_sale_payment_allocations allocation
       INNER JOIN equipment_installment_schedule schedule ON schedule.id = allocation.schedule_id
      WHERE allocation.payment_id = ? ORDER BY schedule.sequence_number`,
    [payment.id]
  );
  const pageHeight = Math.max(430, 360 + allocations.length * 26);
  const document = new PDFDocument({ size: [226.77, pageHeight], margins: { top: 16, bottom: 16, left: 15, right: 15 } });
  const output = collectPdf(document);
  const width = 196.77;
  document.font("Helvetica-Bold").fontSize(12).text(settings.company_name || "CHALIN 03 COMPANY LIMITED", { width, align: "center" });
  document.font("Helvetica").fontSize(7.5).text(settings.company_address || "Dunkwa-On-Offin, Ghana", { width, align: "center" });
  if (settings.company_phone) document.text(`Tel: ${settings.company_phone}`, { width, align: "center" });
  document.moveDown(0.5);
  document.moveTo(15, document.y).lineTo(211.77, document.y).stroke();
  document.moveDown(0.5);
  document.font("Helvetica-Bold").fontSize(11).text("INSTALLMENT PAYMENT RECEIPT", { width, align: "center" });
  document.moveDown(0.5);
  const line = (label, value, bold = false) => {
    document.font("Helvetica-Bold").fontSize(7.8).text(`${label}: `, { continued: true });
    document.font(bold ? "Helvetica-Bold" : "Helvetica").text(String(value || "—"));
  };
  line("Receipt", payment.receipt_number, true);
  line("Date", dateTimeLabel(payment.payment_date));
  line("Agreement", payment.agreement_number);
  line("Customer", payment.customer_name);
  line("Machine", `${payment.equipment_code} ${payment.equipment_name}`.trim());
  line("Method", String(payment.payment_method || "").toUpperCase());
  if (payment.reference_number) line("Reference", payment.reference_number);
  document.moveDown(0.5);
  document.moveTo(15, document.y).lineTo(211.77, document.y).stroke();
  document.moveDown(0.5);
  document.font("Helvetica-Bold").fontSize(15).text(`GHS ${money(payment.amount)}`, { width, align: "center" });
  document.font("Helvetica").fontSize(8).text("AMOUNT RECEIVED", { width, align: "center" });
  document.moveDown(0.5);
  line("Total paid", `GHS ${money(payment.amount_paid)}`);
  line("Outstanding", `GHS ${money(payment.outstanding_balance)}`, true);
  if (allocations.length) {
    document.moveDown(0.5);
    document.font("Helvetica-Bold").fontSize(8).text("ALLOCATED TO");
    for (const allocation of allocations) {
      document.font("Helvetica").fontSize(7.4).text(
        `Installment #${allocation.sequence_number} (${dateLabel(allocation.due_date)}): GHS ${money(allocation.allocated_amount)}`
      );
    }
  }
  document.moveDown(0.7);
  document.moveTo(15, document.y).lineTo(211.77, document.y).stroke();
  document.moveDown(0.6);
  document.font("Helvetica").fontSize(7.5).text(`Received by: ${payment.received_by_name || "Chalin 03"}`, { width, align: "center" });
  document.text("Thank you. Keep this receipt for your records.", { width, align: "center" });
  document.text("Generated from the official Chalin 03 Finance ledger.", { width, align: "center" });
  document.end();
  return { buffer: await output, payment, filename: safeFilename(payment.receipt_number) };
}

function accountingRowsFromPayments(payments) {
  const cashAccount = {
    cash: ["1100", "Cash on Hand"],
    momo: ["1110", "Mobile Money"],
    bank: ["1120", "Bank"],
    cheque: ["1130", "Cheques Receivable"],
    other: ["1190", "Payment Clearing"],
  };
  const rows = [];
  for (const payment of payments) {
    const [debitCode, debitName] = cashAccount[payment.payment_method] || cashAccount.other;
    const description = `${payment.payment_stage === "settlement" ? "Settlement" : "Installment payment"} ${payment.agreement_number} - ${payment.customer_name}`;
    rows.push({
      transaction_date: String(payment.payment_date || "").slice(0, 10),
      reference: payment.receipt_number,
      agreement_number: payment.agreement_number,
      customer_name: payment.customer_name,
      asset_code: payment.asset_code,
      payment_method: payment.payment_method,
      account_code: debitCode,
      account_name: debitName,
      debit: numberValue(payment.amount),
      credit: 0,
      description,
    });
    rows.push({
      transaction_date: String(payment.payment_date || "").slice(0, 10),
      reference: payment.receipt_number,
      agreement_number: payment.agreement_number,
      customer_name: payment.customer_name,
      asset_code: payment.asset_code,
      payment_method: payment.payment_method,
      account_code: "1200",
      account_name: "Installment Receivables",
      debit: 0,
      credit: numberValue(payment.amount),
      description,
    });
  }
  return rows;
}

async function getAccountingExport({ dateFrom, dateTo } = {}) {
  await assertPhaseSixSchema();
  const today = new Date().toISOString().slice(0, 10);
  const from = dateInput(dateFrom, `${today.slice(0, 4)}-01-01`);
  const to = dateInput(dateTo, today);
  const [payments] = await pool.query(
    `SELECT payment.payment_date, payment.receipt_number, payment.payment_stage,
            payment.amount, payment.payment_method,
            agreement.agreement_number,
            agreement.customer_name_snapshot AS customer_name,
            agreement.asset_code_snapshot AS asset_code
       FROM equipment_sale_payments payment
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
      WHERE payment.is_voided = FALSE AND DATE(payment.payment_date) BETWEEN ? AND ?
        AND agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
      ORDER BY payment.payment_date, payment.id`,
    [from, to]
  );
  return {
    period: { date_from: from, date_to: to },
    payment_count: payments.length,
    rows: accountingRowsFromPayments(payments),
  };
}

function accountingCsv(rows) {
  const columns = [
    "transaction_date",
    "reference",
    "agreement_number",
    "customer_name",
    "asset_code",
    "payment_method",
    "account_code",
    "account_name",
    "debit",
    "credit",
    "description",
  ];
  return [columns.join(","), ...rows.map((row) => columns.map((key) => csvCell(row[key])).join(","))].join("\r\n");
}

async function logAccountingExport({ exportType, period, rows, userId, checksum }) {
  await assertPhaseSixSchema();
  await pool.query(
    `INSERT INTO equipment_finance_phase6_export_log (
       export_type, date_from, date_to, row_count, file_checksum, generated_by
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [exportType, period.date_from, period.date_to, rows.length, checksum, userId || null]
  );
}

async function listPhaseSixMessageHistory(limit = 100) {
  await assertPhaseSixSchema();
  const safeLimit = Math.max(1, Math.min(Number(limit || 100), 500));
  const [[customerMessages], [bossAlerts], [reminders]] = await Promise.all([
    pool.query(
      `SELECT message.id, message.message_type, message.payment_id, message.agreement_id,
              message.recipient_type, message.recipient_phone, message.message_preview,
              message.delivery_status, message.attempt_count, message.last_error,
              message.sent_at, message.created_at, agreement.agreement_number,
              agreement.customer_name_snapshot AS customer_name,
              payment.receipt_number
         FROM equipment_finance_phase6_message_log message
         INNER JOIN equipment_sale_agreements agreement ON agreement.id = message.agreement_id
         LEFT JOIN equipment_sale_payments payment ON payment.id = message.payment_id
        ORDER BY message.created_at DESC, message.id DESC LIMIT ?`,
      [safeLimit]
    ),
    pool.query(
      `SELECT boss_messages.id, boss_messages.message_type, boss_messages.payment_id,
              boss_messages.agreement_id, boss_messages.recipient_type,
              boss_messages.recipient_phone, boss_messages.message_preview,
              boss_messages.delivery_status, boss_messages.attempt_count,
              boss_messages.last_error, boss_messages.sent_at,
              boss_messages.created_at, boss_messages.agreement_number,
              boss_messages.customer_name, boss_messages.receipt_number
         FROM (
           SELECT alert.id, 'boss_payment_alert' AS message_type,
                  alert.payment_id, alert.agreement_id, 'boss' AS recipient_type,
                  alert.boss_phone AS recipient_phone,
                  alert.alert_message AS message_preview,
                  alert.alert_status AS delivery_status,
                  alert.attempt_count, alert.last_error,
                  alert.submitted_at AS sent_at, alert.created_at,
                  agreement.agreement_number,
                  agreement.customer_name_snapshot AS customer_name,
                  payment.receipt_number
             FROM equipment_finance_payment_alerts alert
             INNER JOIN equipment_sale_agreements agreement
               ON agreement.id = alert.agreement_id
              AND agreement.sale_type = 'installment'
              AND agreement.activation_source = 'approved_credit_application'
             INNER JOIN equipment_sale_payments payment
               ON payment.id = alert.payment_id
              AND payment.is_voided = FALSE

           UNION ALL

           SELECT sms.id, 'boss_activity_alert' AS message_type,
                  NULL AS payment_id, NULL AS agreement_id,
                  'boss' AS recipient_type, sms.recipient_phone,
                  sms.message AS message_preview, sms.status AS delivery_status,
                  sms.retry_count AS attempt_count, sms.status_reason AS last_error,
                  sms.submitted_at AS sent_at, sms.created_at,
                  NULL AS agreement_number, NULL AS customer_name,
                  NULL AS receipt_number
             FROM sms_log sms
             INNER JOIN activity_log activity
               ON activity.id = CAST(SUBSTRING_INDEX(sms.source_reference, ':', -1) AS UNSIGNED)
              AND activity.workspace_code = 'equipment_installment_finance'
              AND activity.outcome = 'success'
            WHERE sms.sms_type = 'equipment_finance_boss_alert'
              AND sms.source_reference LIKE 'equipment-finance-boss-activity:%'
         ) boss_messages
        ORDER BY boss_messages.created_at DESC, boss_messages.id DESC
        LIMIT ?`,
      [safeLimit]
    ),
    pool.query(
      `SELECT reminder.id, reminder.reminder_type AS message_type, NULL AS payment_id,
              reminder.agreement_id, 'customer' AS recipient_type,
              reminder.recipient_phone, reminder.message_preview,
              reminder.delivery_status, 1 AS attempt_count, NULL AS last_error,
              reminder.sent_at, reminder.created_at, agreement.agreement_number,
              agreement.customer_name_snapshot AS customer_name, NULL AS receipt_number
         FROM equipment_sales_reminder_log reminder
         INNER JOIN equipment_sale_agreements agreement ON agreement.id = reminder.agreement_id
        WHERE agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
          AND reminder.reminder_type IN ('due_soon','due_today','overdue')
        ORDER BY reminder.created_at DESC, reminder.id DESC LIMIT ?`,
      [safeLimit]
    ),
  ]);
  return {
    customer_payment_receipts: customerMessages,
    boss_payment_alerts: bossAlerts,
    reminders,
  };
}

function startEquipmentFinancePhaseSixSchedulers() {
  if (phaseSixSchedulersStarted) return { started: false, reason: "already_started" };
  phaseSixSchedulersStarted = true;
  const testEnvironment =
    String(process.env.NODE_ENV || "").toLowerCase() === "test" ||
    Boolean(process.env.NODE_TEST_CONTEXT);
  if (testEnvironment) {
    return { started: false, reason: "test_environment" };
  }
  const reminderScheduler = startProfessionalReminderScheduler();
  const runPaymentMessages = async () => {
    if (paymentMessageSyncRunning) return;
    paymentMessageSyncRunning = true;
    try {
      await syncCustomerPaymentReceipts({ limit: 100 });
    } catch (error) {
      console.error("Equipment Finance customer payment SMS scheduler failed:", error);
    } finally {
      paymentMessageSyncRunning = false;
    }
  };
  setTimeout(runPaymentMessages, 15000).unref?.();
  setInterval(runPaymentMessages, PAYMENT_MESSAGE_INTERVAL_MS).unref?.();
  return {
    started: true,
    payment_message_interval_ms: PAYMENT_MESSAGE_INTERVAL_MS,
    reminder_scheduler: reminderScheduler,
  };
}

module.exports = {
  EquipmentFinancePhaseSixError,
  accountingCsv,
  accountingRowsFromPayments,
  assertPhaseSixSchema,
  getAccountingExport,
  getArrearsReport,
  getCashFlowReport,
  getCustomerStatement,
  getPortfolioDashboard,
  listPhaseSixMessageHistory,
  loadPaymentSnapshot,
  logAccountingExport,
  phaseSixSchemaStatus,
  renderCustomerStatementPdf,
  renderThermalReceiptPdf,
  safeFilename,
  sendCustomerPaymentReceipt,
  startEquipmentFinancePhaseSixSchedulers,
  syncCustomerPaymentReceipts,
};
