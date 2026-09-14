const { pool } = require("../config/db");

const SORT_COLUMNS = Object.freeze({
  payment_date: "payment.payment_date",
  amount: "payment.amount",
  customer_name: "agreement.customer_name_snapshot",
  agreement_number: "agreement.agreement_number",
  receipt_number: "payment.receipt_number",
});

const VALID_METHODS = new Set(["cash", "momo", "bank", "cheque", "other"]);
const VALID_CATEGORIES = new Set(["deposit", "installment", "settlement", "adjustment", "refund"]);
const VALID_STATUSES = new Set(["active", "voided", "all"]);

class EquipmentFinancePaymentHistoryError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_PAYMENT_HISTORY_ERROR") {
    super(message);
    this.name = "EquipmentFinancePaymentHistoryError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function text(value, max = 120) {
  const result = String(value ?? "").trim();
  return result.length > max ? result.slice(0, max) : result;
}

function date(value, field) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new EquipmentFinancePaymentHistoryError(400, `${field} must be a valid YYYY-MM-DD date.`, "INVALID_PAYMENT_HISTORY_DATE");
  }
  return result;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOptions(input = {}) {
  const status = text(input.status, 20).toLowerCase() || "active";
  if (!VALID_STATUSES.has(status)) {
    throw new EquipmentFinancePaymentHistoryError(400, "Payment status must be active, voided or all.", "INVALID_PAYMENT_HISTORY_STATUS");
  }
  const paymentMethod = text(input.paymentMethod, 20).toLowerCase();
  if (paymentMethod && !VALID_METHODS.has(paymentMethod)) {
    throw new EquipmentFinancePaymentHistoryError(400, "Payment method is not supported.", "INVALID_PAYMENT_HISTORY_METHOD");
  }
  const paymentCategory = text(input.paymentCategory, 30).toLowerCase();
  if (paymentCategory && !VALID_CATEGORIES.has(paymentCategory)) {
    throw new EquipmentFinancePaymentHistoryError(400, "Payment category is not supported.", "INVALID_PAYMENT_HISTORY_CATEGORY");
  }
  const sortBy = text(input.sortBy, 30).toLowerCase() || "payment_date";
  if (!Object.prototype.hasOwnProperty.call(SORT_COLUMNS, sortBy)) {
    throw new EquipmentFinancePaymentHistoryError(400, "Payment history sort field is not supported.", "INVALID_PAYMENT_HISTORY_SORT");
  }
  const sortDir = text(input.sortDir, 4).toLowerCase() === "asc" ? "ASC" : "DESC";
  const page = Math.min(100000, positiveInteger(input.page, 1));
  const pageSize = Math.min(100, Math.max(10, positiveInteger(input.pageSize, 25)));
  const dateFrom = date(input.dateFrom, "date_from");
  const dateTo = date(input.dateTo, "date_to");
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new EquipmentFinancePaymentHistoryError(400, "From date cannot be after To date.", "INVALID_PAYMENT_HISTORY_DATE_RANGE");
  }
  return { search: text(input.search), dateFrom, dateTo, paymentMethod, paymentCategory, status, sortBy, sortDir, page, pageSize };
}

function paymentHistoryWhere(options) {
  const clauses = [
    "agreement.sale_type = 'installment'",
    "agreement.activation_source = 'approved_credit_application'",
  ];
  const params = [];
  if (options.status === "active") clauses.push("COALESCE(payment.is_voided, 0) = 0");
  if (options.status === "voided") clauses.push("COALESCE(payment.is_voided, 0) = 1");
  if (options.paymentMethod) {
    clauses.push("LOWER(COALESCE(payment.payment_method, '')) = ?");
    params.push(options.paymentMethod);
  }
  if (options.paymentCategory) {
    clauses.push("LOWER(COALESCE(payment.payment_category, '')) = ?");
    params.push(options.paymentCategory);
  }
  if (options.dateFrom) {
    clauses.push("payment.payment_date >= ?");
    params.push(`${options.dateFrom} 00:00:00`);
  }
  if (options.dateTo) {
    clauses.push("payment.payment_date < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(options.dateTo);
  }
  if (options.search) {
    const like = `%${options.search}%`;
    clauses.push(`(
      payment.receipt_number LIKE ? OR
      payment.payment_number LIKE ? OR
      agreement.agreement_number LIKE ? OR
      COALESCE(agreement.customer_name_snapshot, '') LIKE ? OR
      COALESCE(agreement.customer_phone_snapshot, '') LIKE ? OR
      COALESCE(agreement.asset_code_snapshot, '') LIKE ? OR
      COALESCE(agreement.asset_name_snapshot, '') LIKE ? OR
      COALESCE(payment.reference_number, '') LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like, like);
  }
  return { clauses, params };
}

function mapPayment(row) {
  return {
    id: Number(row.id),
    agreement_id: Number(row.agreement_id),
    customer_id: row.customer_id == null ? null : Number(row.customer_id),
    receipt_number: row.receipt_number || row.payment_number || `PAY-${row.id}`,
    payment_number: row.payment_number || null,
    payment_date: row.payment_date,
    amount: Number(row.amount || 0),
    payment_method: row.payment_method || "other",
    payment_category: row.payment_category || "installment",
    reference_number: row.reference_number || "",
    notes: row.notes || "",
    is_voided: Boolean(row.is_voided),
    voided_at: row.voided_at || null,
    received_by_name: row.received_by_name || "",
    agreement_number: row.agreement_number || "",
    customer_name: row.customer_name_snapshot || "",
    customer_phone: row.customer_phone_snapshot || "",
    asset_code: row.asset_code_snapshot || "",
    asset_name: row.asset_name_snapshot || "",
  };
}

async function listPaymentHistory(input = {}, connection = pool) {
  const options = normalizeOptions(input);
  const { clauses, params } = paymentHistoryWhere(options);
  const where = clauses.join(" AND ");
  const sortColumn = SORT_COLUMNS[options.sortBy];
  const secondary = options.sortBy === "payment_date" ? "payment.id" : "payment.payment_date";
  const order = `${sortColumn} ${options.sortDir}, ${secondary} ${options.sortDir}`;
  const offset = (options.page - 1) * options.pageSize;

  const countSql = `
    SELECT COUNT(*) AS total
    FROM equipment_sale_payments payment
    INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
    WHERE ${where}
  `;
  const summarySql = `
    SELECT COUNT(*) AS total_count,
      SUM(CASE WHEN COALESCE(payment.is_voided, 0) = 0 THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN COALESCE(payment.is_voided, 0) = 1 THEN 1 ELSE 0 END) AS voided_count,
      COALESCE(SUM(CASE WHEN COALESCE(payment.is_voided, 0) = 0 THEN payment.amount ELSE 0 END), 0) AS active_total,
      COALESCE(SUM(CASE WHEN COALESCE(payment.is_voided, 0) = 1 THEN payment.amount ELSE 0 END), 0) AS voided_total,
      MAX(payment.payment_date) AS latest_payment_date
    FROM equipment_sale_payments payment
    INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
    WHERE ${where}
  `;
  const dataSql = `
    SELECT payment.id, payment.agreement_id, payment.customer_id,
      payment.receipt_number, payment.payment_number, payment.payment_date,
      payment.amount, payment.payment_method, payment.payment_category,
      payment.reference_number, payment.notes, payment.is_voided, payment.voided_at,
      receiver.full_name AS received_by_name,
      agreement.agreement_number, agreement.customer_name_snapshot,
      agreement.customer_phone_snapshot, agreement.asset_code_snapshot,
      agreement.asset_name_snapshot
    FROM equipment_sale_payments payment
    INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
    LEFT JOIN users receiver ON receiver.id = payment.received_by
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ? OFFSET ?
  `;

  try {
    const [countRows, summaryRows, rows] = await Promise.all([
      connection.query(countSql, params),
      connection.query(summarySql, params),
      connection.query(dataSql, [...params, options.pageSize, offset]),
    ]);
    const rawTotal = Number(countRows?.[0]?.[0]?.total || 0);
    const summaryRow = summaryRows?.[0]?.[0] || {};
    const totalPages = Math.max(1, Math.ceil(rawTotal / options.pageSize));
    const currentPage = rawTotal === 0 ? 1 : Math.min(options.page, totalPages);
    return {
      payments: (rows?.[0] || []).map(mapPayment),
      pagination: {
        page: currentPage,
        page_size: options.pageSize,
        total: rawTotal,
        total_pages: totalPages,
        has_previous_page: currentPage > 1,
        has_next_page: currentPage < totalPages,
      },
      summary: {
        total_count: Number(summaryRow.total_count || 0),
        active_count: Number(summaryRow.active_count || 0),
        voided_count: Number(summaryRow.voided_count || 0),
        active_total: Number(summaryRow.active_total || 0),
        voided_total: Number(summaryRow.voided_total || 0),
        latest_payment_date: summaryRow.latest_payment_date || null,
      },
      filters: {
        search: options.search,
        date_from: options.dateFrom,
        date_to: options.dateTo,
        payment_method: options.paymentMethod,
        payment_category: options.paymentCategory,
        status: options.status,
        sort_by: options.sortBy,
        sort_dir: options.sortDir.toLowerCase(),
      },
    };
  } catch (error) {
    const message = String(error?.message || "");
    if (/unknown table|doesn't exist|does not exist/i.test(message)) {
      throw new EquipmentFinancePaymentHistoryError(503, "Finance payment history is temporarily unavailable because the required Finance records are not ready.", "FINANCE_PAYMENT_HISTORY_SCHEMA_NOT_READY");
    }
    throw error;
  }
}

module.exports = { EquipmentFinancePaymentHistoryError, listPaymentHistory };
