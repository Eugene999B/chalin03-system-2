const { pool } = require("../config/db");

const REQUIRED_TABLES = Object.freeze([
  "equipment_sale_agreements",
  "equipment_installment_schedule",
]);

function appError(message, statusCode = 503, code = "INSTALLMENT_READ_MODEL_UNAVAILABLE") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cleanText(value, maxLength = 150) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dateText(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function ghanaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayDifference(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function locationFilter(alias, locationId) {
  if (!positiveId(locationId)) return { sql: "", params: [] };
  return { sql: ` AND ${alias}.hire_location_id = ?`, params: [Number(locationId)] };
}

async function loadColumnMap(connection = pool) {
  const tableNames = [
    "equipment_sale_agreements",
    "equipment_installment_schedule",
    "equipment_sale_payments",
    "business_locations",
  ];
  const placeholders = tableNames.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const map = new Map(tableNames.map((name) => [name, new Set()]));
  for (const row of rows) {
    if (!map.has(row.TABLE_NAME)) map.set(row.TABLE_NAME, new Set());
    map.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }
  return map;
}

function assertCoreTables(columnMap) {
  const missing = REQUIRED_TABLES.filter(
    (tableName) => (columnMap.get(tableName) || new Set()).size === 0
  );
  if (missing.length) {
    throw appError(
      `Installment portfolio storage is not ready. Missing: ${missing.join(", ")}.`,
      503,
      "INSTALLMENT_PORTFOLIO_STORAGE_UNAVAILABLE"
    );
  }
}

function hasColumn(columnMap, tableName, columnName) {
  return (columnMap.get(tableName) || new Set()).has(columnName);
}

function scheduleRemainingExpression(columnMap, alias = "eis") {
  const scheduled = hasColumn(
    columnMap,
    "equipment_installment_schedule",
    "scheduled_amount"
  )
    ? `${alias}.scheduled_amount`
    : "0";
  const amountPaid = hasColumn(
    columnMap,
    "equipment_installment_schedule",
    "amount_paid"
  )
    ? `${alias}.amount_paid`
    : "0";
  const lateCharge = hasColumn(
    columnMap,
    "equipment_installment_schedule",
    "late_charge_amount"
  )
    ? `${alias}.late_charge_amount`
    : "0";
  const waivedCharge = hasColumn(
    columnMap,
    "equipment_installment_schedule",
    "waived_charge_amount"
  )
    ? `${alias}.waived_charge_amount`
    : "0";
  return `GREATEST(${scheduled} + ${lateCharge} - ${waivedCharge} - ${amountPaid}, 0)`;
}

function scheduleOpenCondition(columnMap, alias = "eis") {
  if (!hasColumn(columnMap, "equipment_installment_schedule", "schedule_status")) {
    return "1 = 1";
  }
  return `${alias}.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')`;
}

function paymentWhere(columnMap, alias = "esp") {
  const clauses = [];
  if (hasColumn(columnMap, "equipment_sale_payments", "is_voided")) {
    clauses.push(`${alias}.is_voided = FALSE`);
  }
  if (hasColumn(columnMap, "equipment_sale_payments", "payment_category")) {
    clauses.push(`${alias}.payment_category <> 'refund'`);
  }
  return clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
}

function deriveAccount(row, today = ghanaToday()) {
  const nextDueDate = dateText(row.next_schedule_due_date || row.next_due_date);
  const oldestOverdueDate = dateText(row.oldest_overdue_date);
  const daysPastDue = oldestOverdueDate
    ? Math.max(dayDifference(oldestOverdueDate, today) || 0, 0)
    : Math.max(Number(row.days_past_due || 0), 0);
  const daysUntilDue = nextDueDate ? dayDifference(today, nextDueDate) : null;
  const outstanding = Number(row.outstanding_balance || 0);
  const calculatedOverdue = Number(row.calculated_overdue_amount || 0);
  const storedOverdue = Number(row.overdue_amount || 0);
  const overdue = Math.max(calculatedOverdue, storedOverdue, 0);

  let status = String(row.agreement_status || "active");
  if (!["cancelled", "defaulted"].includes(status)) {
    if (outstanding <= 0.01) status = "completed";
    else if (daysPastDue > 0 || overdue > 0.01) status = "overdue";
    else if (daysUntilDue === 0) status = "payment_due";
    else if (daysUntilDue !== null && daysUntilDue > 0 && daysUntilDue <= 3) {
      status = "due_soon";
    } else if (!["draft", "pending_approval", "approved"].includes(status)) {
      status = "active";
    }
  }

  const total = Number(row.total_amount || 0);
  const lastPaymentDate = dateText(row.last_payment_at);
  const daysSincePayment = lastPaymentDate
    ? Math.max(dayDifference(lastPaymentDate, today) || 0, 0)
    : null;
  let score = 0;
  if (status === "defaulted") score = 100;
  else {
    if (daysPastDue > 0) score += Math.min(45, 10 + daysPastDue * 0.8);
    if (total > 0) score += Math.min(20, (outstanding / total) * 20);
    if (outstanding > 0 && overdue / outstanding >= 0.5) score += 15;
    if (!row.customer_phone_snapshot) score += 10;
    if (!row.customer_id_number) score += 5;
    if (!row.guarantor_name && total >= 100000) score += 5;
    if (daysSincePayment === null && Number(row.amount_paid || 0) <= 0.01) score += 10;
    else if (daysSincePayment !== null && daysSincePayment > 45) score += 10;
  }
  score = Math.min(100, Math.round(score));

  let riskBand = "low";
  if (score >= 75) riskBand = "critical";
  else if (score >= 50) riskBand = "high";
  else if (score >= 25) riskBand = "medium";

  let recommendedAction = "Monitor the next scheduled payment.";
  if (status === "defaulted") {
    recommendedAction = "Management recovery review is required.";
  } else if (daysPastDue >= 90) {
    recommendedAction = "Escalate for management, guarantor and recovery review.";
  } else if (daysPastDue >= 31) {
    recommendedAction = "Call the customer, contact the guarantor and record a payment plan.";
  } else if (daysPastDue >= 8) {
    recommendedAction = "Contact the customer today and secure a promise-to-pay date.";
  } else if (daysPastDue > 0) {
    recommendedAction = "Send a reminder and call before arrears increase.";
  } else if (daysUntilDue !== null && daysUntilDue <= 3) {
    recommendedAction = "Confirm the upcoming payment before its due date.";
  }

  return {
    ...row,
    agreement_status: status,
    next_due_date: nextDueDate,
    next_schedule_due_date: nextDueDate,
    oldest_overdue_date: oldestOverdueDate,
    overdue_amount: Number(overdue.toFixed(2)),
    days_past_due: daysPastDue,
    days_until_due: daysUntilDue,
    risk_score: score,
    risk_band: riskBand,
    recommended_action: recommendedAction,
    days_since_payment: daysSincePayment,
    last_reminder_at: row.last_reminder_at || null,
    reminders_30_days: Number(row.reminders_30_days || 0),
    last_follow_up_at: row.last_follow_up_at || null,
  };
}

function agingBucket(row) {
  const days = Math.max(Number(row.days_past_due || 0), 0);
  if (days === 0) return "current";
  if (days <= 7) return "1_7_days";
  if (days <= 30) return "8_30_days";
  if (days <= 60) return "31_60_days";
  if (days <= 90) return "61_90_days";
  return "over_90_days";
}

async function loadRows(connection = pool, locationId = null) {
  const columnMap = await loadColumnMap(connection);
  assertCoreTables(columnMap);

  const remaining = scheduleRemainingExpression(columnMap);
  const openSchedule = scheduleOpenCondition(columnMap);
  const filter = locationFilter("esa", locationId);
  const hasPayments = (columnMap.get("equipment_sale_payments") || new Set()).size > 0;
  const hasLocations = (columnMap.get("business_locations") || new Set()).size > 0;
  const paymentDateColumn = hasColumn(columnMap, "equipment_sale_payments", "payment_date");
  const paymentAmountColumn = hasColumn(columnMap, "equipment_sale_payments", "amount");
  const paymentFilter = paymentWhere(columnMap);

  const lastPaymentDateSql = hasPayments && paymentDateColumn
    ? `(SELECT MAX(esp.payment_date)
        FROM equipment_sale_payments esp
        WHERE esp.agreement_id = esa.id${paymentFilter})`
    : "NULL";
  const lastPaymentAmountSql = hasPayments && paymentDateColumn && paymentAmountColumn
    ? `(SELECT esp.amount
        FROM equipment_sale_payments esp
        WHERE esp.agreement_id = esa.id${paymentFilter}
        ORDER BY esp.payment_date DESC, esp.id DESC
        LIMIT 1)`
    : "NULL";
  const locationJoin = hasLocations
    ? "LEFT JOIN business_locations bl ON bl.id = esa.hire_location_id"
    : "";
  const locationName = hasLocations ? "bl.name" : "NULL";
  const locationCode = hasLocations ? "bl.code" : "NULL";

  const [rows] = await connection.query(
    `SELECT
       esa.*,
       ${locationName} AS hire_location_name,
       ${locationCode} AS hire_location_code,
       ${lastPaymentDateSql} AS last_payment_at,
       ${lastPaymentAmountSql} AS last_payment_amount,
       (SELECT MIN(eis.due_date)
        FROM equipment_installment_schedule eis
        WHERE eis.agreement_id = esa.id
          AND ${openSchedule}) AS next_schedule_due_date,
       (SELECT ${remaining}
        FROM equipment_installment_schedule eis
        WHERE eis.agreement_id = esa.id
          AND ${openSchedule}
        ORDER BY eis.due_date, eis.sequence_number
        LIMIT 1) AS next_payment_amount,
       (SELECT MIN(eis.due_date)
        FROM equipment_installment_schedule eis
        WHERE eis.agreement_id = esa.id
          AND ${openSchedule}
          AND eis.due_date < CURDATE()
          AND ${remaining} > 0) AS oldest_overdue_date,
       COALESCE((SELECT SUM(${remaining})
        FROM equipment_installment_schedule eis
        WHERE eis.agreement_id = esa.id
          AND ${openSchedule}
          AND eis.due_date < CURDATE()), 0) AS calculated_overdue_amount,
       NULL AS last_reminder_at,
       0 AS reminders_30_days,
       NULL AS last_follow_up_at
     FROM equipment_sale_agreements esa
     ${locationJoin}
     WHERE esa.sale_type = 'installment'
       AND esa.activation_source = 'approved_credit_application'
       ${filter.sql}
     ORDER BY esa.next_due_date, esa.id`,
    filter.params
  );

  return {
    rows: rows.map((row) => deriveAccount(row)),
    readiness: {
      ready: true,
      mode: "resilient_read_model",
      optional_evidence_deferred: true,
    },
  };
}

function emptyAging() {
  return [
    "current",
    "1_7_days",
    "8_30_days",
    "31_60_days",
    "61_90_days",
    "over_90_days",
  ].map((aging_bucket) => ({
    aging_bucket,
    accounts: 0,
    outstanding_amount: 0,
    overdue_amount: 0,
  }));
}

async function getInstallmentPortfolio({ locationId = null } = {}) {
  const { rows, readiness } = await loadRows(pool, locationId);
  const active = rows.filter(
    (row) => !["completed", "cancelled"].includes(row.agreement_status)
  );
  const today = ghanaToday();
  const summary = active.reduce(
    (result, row) => {
      result.active_accounts += 1;
      result.total_sales_value += Number(row.total_amount || 0);
      result.financed_amount += Number(row.financed_amount || 0);
      result.collected_amount += Number(row.amount_paid || 0);
      result.outstanding_amount += Number(row.outstanding_balance || 0);
      result.overdue_amount += Number(row.overdue_amount || 0);
      if (row.agreement_status === "overdue") result.overdue_accounts += 1;
      if (row.agreement_status === "defaulted") result.defaulted_accounts += 1;
      if (row.risk_band === "critical") result.critical_risk_accounts += 1;
      if (row.risk_band === "high") result.high_risk_accounts += 1;
      const diff = row.next_due_date ? dayDifference(today, row.next_due_date) : null;
      if (diff === 0) result.due_today_accounts += 1;
      if (diff !== null && diff >= 0 && diff <= 7) {
        result.due_next_7_days += Number(row.next_payment_amount || 0);
      }
      if (diff !== null && diff >= 0 && diff <= 30) {
        result.due_next_30_days += Number(row.next_payment_amount || 0);
      }
      return result;
    },
    {
      active_accounts: 0,
      overdue_accounts: 0,
      defaulted_accounts: 0,
      critical_risk_accounts: 0,
      high_risk_accounts: 0,
      due_today_accounts: 0,
      total_sales_value: 0,
      financed_amount: 0,
      collected_amount: 0,
      outstanding_amount: 0,
      overdue_amount: 0,
      due_next_7_days: 0,
      due_next_30_days: 0,
    }
  );
  summary.collection_rate = summary.total_sales_value > 0
    ? Number(((summary.collected_amount / summary.total_sales_value) * 100).toFixed(2))
    : 0;
  summary.portfolio_at_risk_rate = summary.outstanding_amount > 0
    ? Number(((summary.overdue_amount / summary.outstanding_amount) * 100).toFixed(2))
    : 0;

  const aging = emptyAging();
  const agingMap = new Map(aging.map((row) => [row.aging_bucket, row]));
  for (const row of active) {
    const bucket = agingBucket(row);
    const current = agingMap.get(bucket);
    current.accounts += 1;
    current.outstanding_amount += Number(row.outstanding_balance || 0);
    current.overdue_amount += Number(row.overdue_amount || 0);
  }

  const filter = locationFilter("esa", locationId);
  let forecast = [];
  try {
    const columnMap = await loadColumnMap(pool);
    const remaining = scheduleRemainingExpression(columnMap);
    const openSchedule = scheduleOpenCondition(columnMap);
    const [rowsForecast] = await pool.query(
      `SELECT
         eis.due_date,
         COUNT(DISTINCT esa.id) AS accounts,
         COALESCE(SUM(${remaining}), 0) AS expected_amount
       FROM equipment_installment_schedule eis
       INNER JOIN equipment_sale_agreements esa ON esa.id = eis.agreement_id
       WHERE esa.sale_type = 'installment'
         AND esa.activation_source = 'approved_credit_application'
         AND esa.agreement_status NOT IN ('completed','cancelled','defaulted')
         AND ${openSchedule}
         AND eis.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
         ${filter.sql}
       GROUP BY eis.due_date
       ORDER BY eis.due_date`,
      filter.params
    );
    forecast = rowsForecast;
  } catch (_forecastError) {
    readiness.forecast_available = false;
  }

  return {
    generated_at: new Date().toISOString(),
    readiness,
    summary,
    aging,
    forecast,
    urgent_accounts: active
      .filter((row) => ["critical", "high"].includes(row.risk_band))
      .sort((left, right) => right.risk_score - left.risk_score)
      .slice(0, 12),
    upcoming_accounts: active
      .filter(
        (row) =>
          Number(row.days_until_due) >= 0 && Number(row.days_until_due) <= 7
      )
      .sort((left, right) => Number(left.days_until_due) - Number(right.days_until_due))
      .slice(0, 12),
  };
}

async function listInstallmentCollections({
  locationId = null,
  search = "",
  status = "",
  risk = "",
  aging = "",
  limit = null,
} = {}) {
  const { rows, readiness } = await loadRows(pool, locationId);
  const term = cleanText(search).toLowerCase();
  const cleanStatus = cleanText(status, 40).toLowerCase();
  const cleanRisk = cleanText(risk, 20).toLowerCase();
  const cleanAging = cleanText(aging, 30).toLowerCase();
  const filtered = rows.filter((row) => {
    if (cleanStatus && row.agreement_status !== cleanStatus) return false;
    if (cleanRisk && row.risk_band !== cleanRisk) return false;
    if (cleanAging && agingBucket(row) !== cleanAging) return false;
    if (!term) return true;
    return [
      row.agreement_number,
      row.customer_name_snapshot,
      row.customer_phone_snapshot,
      row.asset_code_snapshot,
      row.asset_name_snapshot,
      row.hire_location_name,
      row.guarantor_name,
      row.guarantor_phone,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  const requestedLimit = Number(limit);
  const accounts = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? filtered.slice(0, requestedLimit)
    : filtered;
  return {
    readiness,
    count: filtered.length,
    accounts,
  };
}

module.exports = {
  agingBucket,
  deriveAccount,
  getInstallmentPortfolio,
  listInstallmentCollections,
  scheduleOpenCondition,
  scheduleRemainingExpression,
};
