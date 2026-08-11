"use strict";

const { pool } = require("../config/db");

const MAX_TOP_CUSTOMERS = 10;
const DEFAULT_ACCOUNT_LOOKBACK_DAYS = 30;

class AiCustomerCommercialIntelligenceError extends Error {
  constructor(message, { code = "AI_CUSTOMER_COMMERCIAL_FAILED", statusCode = 500 } = {}) {
    super(message);
    this.name = "AiCustomerCommercialIntelligenceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function clean(value, maximum = 200) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function dateOnly(value) {
  const text = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function addUtcDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizedWindow(input = {}, { mode = "top_customers", now = new Date() } = {}) {
  let start = dateOnly(input.start_date);
  let end = dateOnly(input.end_date);
  const today = utcDate(now);

  if (!start && !end) {
    if (mode === "top_customers") {
      start = today;
      end = today;
    } else {
      end = today;
      start = addUtcDays(today, -(DEFAULT_ACCOUNT_LOOKBACK_DAYS - 1));
    }
  } else if (!start) {
    start = end;
  } else if (!end) {
    end = start;
  }

  if (start > end) [start, end] = [end, start];
  return Object.freeze({ start_date: start, end_date: end });
}

function maskPhone(value) {
  const raw = clean(value, 80);
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, "");
  if (compact.length <= 4) return "****";
  return `${compact.slice(0, 3)}${"*".repeat(Math.max(4, compact.length - 6))}${compact.slice(-3)}`;
}

function normalizedMode(input = {}) {
  const requested = clean(input.mode, 40).toLowerCase();
  if (["top_customers", "customer_account"].includes(requested)) return requested;
  if (positiveInteger(input.customer_id) || clean(input.customer_query, 180)) {
    return "customer_account";
  }
  return "top_customers";
}

function saleValiditySql(alias = "s") {
  return `COALESCE(${alias}.is_voided, 0) = 0
    AND LOWER(COALESCE(${alias}.sale_status, 'completed')) NOT IN ('void', 'voided', 'cancelled', 'canceled')`;
}

function identityKey(row = {}) {
  const id = positiveInteger(row.customer_id);
  if (id) return `id:${id}`;
  const phone = clean(row.customer_phone, 80).toLowerCase();
  if (phone) return `phone:${phone}`;
  return `name:${clean(row.customer_name || "Customer", 180).toLowerCase()}`;
}

function customerPublicIdentity(row = {}) {
  return Object.freeze({
    customer_id: positiveInteger(row.customer_id),
    customer_name: clean(row.customer_name || "Customer", 180),
    phone_masked: maskPhone(row.customer_phone),
  });
}

async function branchMeta(branchId, connection = pool) {
  try {
    const [rows] = await connection.query(
      `SELECT id, COALESCE(code, branch_code) AS branch_code,
              COALESCE(name, branch_name) AS branch_name
         FROM branches WHERE id = ? LIMIT 1`,
      [branchId]
    );
    const row = rows[0] || {};
    return Object.freeze({
      branch_id: branchId,
      branch_code: clean(row.branch_code || `BR-${branchId}`, 60),
      branch_name: clean(row.branch_name || `Branch ${branchId}`, 160),
    });
  } catch (_error) {
    return Object.freeze({
      branch_id: branchId,
      branch_code: `BR-${branchId}`,
      branch_name: `Branch ${branchId}`,
    });
  }
}

async function currentDebtForIdentity(identity, branchId, connection = pool) {
  const params = [branchId];
  let identitySql = "";
  if (positiveInteger(identity.customer_id)) {
    identitySql = "AND d.customer_id = ?";
    params.push(Number(identity.customer_id));
  } else {
    identitySql = `AND LOWER(COALESCE(d.customer_name, '')) = LOWER(?)
      AND LOWER(COALESCE(d.customer_phone, '')) = LOWER(?)`;
    params.push(clean(identity.customer_name, 180), clean(identity.customer_phone, 80));
  }

  const [rows] = await connection.query(
    `SELECT COUNT(CASE WHEN d.balance > 0 THEN 1 END) AS active_debt_count,
            COALESCE(SUM(CASE WHEN d.balance > 0 THEN d.balance ELSE 0 END), 0) AS outstanding_balance,
            COALESCE(SUM(CASE WHEN d.balance > 0 AND d.due_date IS NOT NULL
                                  AND DATE(d.due_date) < CURRENT_DATE
                              THEN d.balance ELSE 0 END), 0) AS overdue_balance,
            MIN(CASE WHEN d.balance > 0 THEN d.due_date ELSE NULL END) AS oldest_open_due_date
       FROM debts d
      WHERE d.branch_id = ? ${identitySql}`,
    params
  );
  const row = rows[0] || {};
  return Object.freeze({
    active_debt_count: Number(row.active_debt_count || 0),
    outstanding_balance: money(row.outstanding_balance),
    overdue_balance: money(row.overdue_balance),
    oldest_open_due_date: row.oldest_open_due_date
      ? String(row.oldest_open_due_date).slice(0, 10)
      : null,
  });
}

async function branchSalesTotal(branchId, window, connection = pool) {
  const [rows] = await connection.query(
    `SELECT COALESCE(SUM(s.total), 0) AS total_sales
       FROM sales s
      WHERE s.branch_id = ?
        AND DATE(s.created_at) BETWEEN ? AND ?
        AND ${saleValiditySql("s")}`,
    [branchId, window.start_date, window.end_date]
  );
  return money(rows[0]?.total_sales);
}

async function loadTopCustomers({ branchId, window, limit, connection = pool }) {
  const [rows] = await connection.query(
    `SELECT s.customer_id,
            COALESCE(NULLIF(TRIM(s.customer_name), ''), 'Customer') AS customer_name,
            COALESCE(s.customer_phone, '') AS customer_phone,
            COUNT(*) AS sales_count,
            COALESCE(SUM(s.total), 0) AS total_sales,
            COALESCE(SUM(s.amount_paid), 0) AS sale_record_paid_amount,
            COALESCE(SUM(s.balance), 0) AS selected_sale_balance,
            MAX(s.created_at) AS last_sale_at
       FROM sales s
      WHERE s.branch_id = ?
        AND DATE(s.created_at) BETWEEN ? AND ?
        AND ${saleValiditySql("s")}
        AND (s.customer_id IS NOT NULL OR TRIM(COALESCE(s.customer_name, '')) <> '')
      GROUP BY s.customer_id, customer_name, customer_phone
      ORDER BY total_sales DESC, sales_count DESC, customer_name ASC
      LIMIT ?`,
    [branchId, window.start_date, window.end_date, limit]
  );
  const branchTotal = await branchSalesTotal(branchId, window, connection);
  const result = [];
  for (const row of rows) {
    const debt = await currentDebtForIdentity(row, branchId, connection);
    result.push(
      Object.freeze({
        ...customerPublicIdentity(row),
        identity_key: identityKey(row),
        ranking_basis: "valid_sales_value_in_selected_period",
        sales_count: Number(row.sales_count || 0),
        total_sales: money(row.total_sales),
        contribution_share_percent:
          branchTotal > 0 ? Number(((Number(row.total_sales || 0) / branchTotal) * 100).toFixed(2)) : 0,
        sale_record_paid_amount: money(row.sale_record_paid_amount),
        selected_sale_balance: money(row.selected_sale_balance),
        current_outstanding_debt: debt.outstanding_balance,
        current_overdue_debt: debt.overdue_balance,
        active_debt_count: debt.active_debt_count,
        oldest_open_due_date: debt.oldest_open_due_date,
        last_sale_at: row.last_sale_at || null,
      })
    );
  }
  return Object.freeze({
    ranking_basis: "valid_sales_value_in_selected_period",
    branch_period_sales: branchTotal,
    customers: Object.freeze(result),
  });
}

async function exactCustomerCandidates({ branchId, query, connection = pool }) {
  const exact = clean(query, 180);
  if (!exact) return Object.freeze([]);
  const [rows] = await connection.query(
    `SELECT customer_id, customer_name, customer_phone
       FROM (
         SELECT s.customer_id, s.customer_name, s.customer_phone
           FROM sales s
          WHERE s.branch_id = ?
            AND (LOWER(TRIM(COALESCE(s.customer_name, ''))) = LOWER(?)
                 OR TRIM(COALESCE(s.customer_phone, '')) = ?)
         UNION
         SELECT d.customer_id, d.customer_name, d.customer_phone
           FROM debts d
          WHERE d.branch_id = ?
            AND (LOWER(TRIM(COALESCE(d.customer_name, ''))) = LOWER(?)
                 OR TRIM(COALESCE(d.customer_phone, '')) = ?)
       ) candidate`,
    [branchId, exact, exact, branchId, exact, exact]
  );
  const unique = new Map();
  for (const row of rows) {
    const key = identityKey(row);
    if (!unique.has(key)) unique.set(key, row);
  }
  return Object.freeze(
    [...unique.values()].slice(0, 12).map((row) =>
      Object.freeze({
        ...customerPublicIdentity(row),
        identity_key: identityKey(row),
      })
    )
  );
}

async function identityByCustomerId(branchId, customerId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT customer_id, customer_name, customer_phone
       FROM (
         SELECT s.customer_id, s.customer_name, s.customer_phone, MAX(s.created_at) AS touched_at
           FROM sales s WHERE s.branch_id = ? AND s.customer_id = ?
          GROUP BY s.customer_id, s.customer_name, s.customer_phone
         UNION ALL
         SELECT d.customer_id, d.customer_name, d.customer_phone, MAX(d.created_at) AS touched_at
           FROM debts d WHERE d.branch_id = ? AND d.customer_id = ?
          GROUP BY d.customer_id, d.customer_name, d.customer_phone
       ) identity_rows
      ORDER BY touched_at DESC LIMIT 1`,
    [branchId, customerId, branchId, customerId]
  );
  return rows[0] || null;
}

async function loadCustomerAccount({ branchId, window, identity, connection = pool }) {
  const params = [branchId, window.start_date, window.end_date];
  let identitySql = "";
  if (positiveInteger(identity.customer_id)) {
    identitySql = "AND s.customer_id = ?";
    params.push(Number(identity.customer_id));
  } else {
    identitySql = `AND LOWER(COALESCE(s.customer_name, '')) = LOWER(?)
      AND LOWER(COALESCE(s.customer_phone, '')) = LOWER(?)`;
    params.push(clean(identity.customer_name, 180), clean(identity.customer_phone, 80));
  }

  const [salesRows] = await connection.query(
    `SELECT COUNT(*) AS sales_count,
            COALESCE(SUM(s.total), 0) AS total_sales,
            COALESCE(SUM(s.amount_paid), 0) AS sale_record_paid_amount,
            COALESCE(SUM(s.balance), 0) AS selected_sale_balance,
            MAX(s.created_at) AS last_sale_at
       FROM sales s
      WHERE s.branch_id = ?
        AND DATE(s.created_at) BETWEEN ? AND ?
        AND ${saleValiditySql("s")}
        ${identitySql}`,
    params
  );

  const debt = await currentDebtForIdentity(identity, branchId, connection);
  const itemParams = [branchId, window.start_date, window.end_date];
  let itemIdentitySql = "";
  if (positiveInteger(identity.customer_id)) {
    itemIdentitySql = "AND s.customer_id = ?";
    itemParams.push(Number(identity.customer_id));
  } else {
    itemIdentitySql = `AND LOWER(COALESCE(s.customer_name, '')) = LOWER(?)
      AND LOWER(COALESCE(s.customer_phone, '')) = LOWER(?)`;
    itemParams.push(clean(identity.customer_name, 180), clean(identity.customer_phone, 80));
  }
  const [itemRows] = await connection.query(
    `SELECT COALESCE(NULLIF(TRIM(si.product_name), ''), 'Item') AS product_name,
            COALESCE(SUM(si.quantity), 0) AS quantity,
            COALESCE(SUM(si.line_total), 0) AS sales_value
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
      WHERE s.branch_id = ?
        AND DATE(s.created_at) BETWEEN ? AND ?
        AND ${saleValiditySql("s")}
        ${itemIdentitySql}
      GROUP BY product_name
      ORDER BY sales_value DESC, quantity DESC, product_name ASC
      LIMIT 12`,
    itemParams
  );

  const row = salesRows[0] || {};
  return Object.freeze({
    ...customerPublicIdentity(identity),
    identity_key: identityKey(identity),
    selected_period: window,
    sales_count: Number(row.sales_count || 0),
    selected_period_sales: money(row.total_sales),
    sale_record_paid_amount: money(row.sale_record_paid_amount),
    selected_sale_balance: money(row.selected_sale_balance),
    current_outstanding_debt: debt.outstanding_balance,
    current_overdue_debt: debt.overdue_balance,
    active_debt_count: debt.active_debt_count,
    oldest_open_due_date: debt.oldest_open_due_date,
    last_sale_at: row.last_sale_at || null,
    top_purchased_items: Object.freeze(
      itemRows.map((item) =>
        Object.freeze({
          product_name: clean(item.product_name, 180),
          quantity: money(item.quantity),
          sales_value: money(item.sales_value),
        })
      )
    ),
  });
}

async function loadCustomerCommercialIntelligence({
  context,
  input = {},
  connection = pool,
  now = new Date(),
} = {}) {
  const branchId = positiveInteger(context?.scope?.branch_id);
  if (!branchId) {
    throw new AiCustomerCommercialIntelligenceError(
      "Choose an authorized Spare Parts branch before requesting customer intelligence.",
      { code: "AI_CUSTOMER_BRANCH_SCOPE_REQUIRED", statusCode: 409 }
    );
  }

  const mode = normalizedMode(input);
  const window = normalizedWindow(input, { mode, now });
  const branch = await branchMeta(branchId, connection);

  try {
    if (mode === "top_customers") {
      const limit = Math.min(
        MAX_TOP_CUSTOMERS,
        Math.max(1, positiveInteger(input.limit) || 5)
      );
      const ranked = await loadTopCustomers({
        branchId,
        window,
        limit,
        connection,
      });
      return Object.freeze({
        scope: Object.freeze({ ...branch, ...window, workspace_code: "spare_parts" }),
        mode,
        ranking_basis: ranked.ranking_basis,
        branch_period_sales: ranked.branch_period_sales,
        customers: ranked.customers,
        customer_rows_exposed: true,
        phone_numbers_masked: true,
        generated_at: new Date().toISOString(),
        execution_authority: "read_only_sensitive",
      });
    }

    let identity = null;
    const customerId = positiveInteger(input.customer_id);
    if (customerId) {
      identity = await identityByCustomerId(branchId, customerId, connection);
      if (!identity) {
        throw new AiCustomerCommercialIntelligenceError(
          "That customer was not found in the authorized branch.",
          { code: "AI_CUSTOMER_NOT_FOUND", statusCode: 404 }
        );
      }
    } else {
      const query = clean(input.customer_query, 180);
      if (!query) {
        throw new AiCustomerCommercialIntelligenceError(
          "Choose an exact customer ID, name or phone reference.",
          { code: "AI_CUSTOMER_REFERENCE_REQUIRED", statusCode: 400 }
        );
      }
      const candidates = await exactCustomerCandidates({ branchId, query, connection });
      if (candidates.length === 0) {
        return Object.freeze({
          scope: Object.freeze({ ...branch, ...window, workspace_code: "spare_parts" }),
          mode,
          resolution_status: "not_found",
          candidates: Object.freeze([]),
          customer_rows_exposed: false,
          phone_numbers_masked: true,
          generated_at: new Date().toISOString(),
          execution_authority: "read_only_sensitive",
        });
      }
      if (candidates.length > 1) {
        return Object.freeze({
          scope: Object.freeze({ ...branch, ...window, workspace_code: "spare_parts" }),
          mode,
          resolution_status: "ambiguous",
          candidates,
          customer_rows_exposed: true,
          phone_numbers_masked: true,
          generated_at: new Date().toISOString(),
          execution_authority: "read_only_sensitive",
        });
      }
      identity = candidates[0];
    }

    const account = await loadCustomerAccount({
      branchId,
      window,
      identity,
      connection,
    });
    return Object.freeze({
      scope: Object.freeze({ ...branch, ...window, workspace_code: "spare_parts" }),
      mode,
      resolution_status: "resolved",
      customer: account,
      customer_rows_exposed: true,
      phone_numbers_masked: true,
      generated_at: new Date().toISOString(),
      execution_authority: "read_only_sensitive",
    });
  } catch (error) {
    if (error instanceof AiCustomerCommercialIntelligenceError) throw error;
    throw new AiCustomerCommercialIntelligenceError(
      "Customer commercial intelligence could not be loaded safely."
    );
  }
}

module.exports = {
  AiCustomerCommercialIntelligenceError,
  DEFAULT_ACCOUNT_LOOKBACK_DAYS,
  MAX_TOP_CUSTOMERS,
  branchSalesTotal,
  currentDebtForIdentity,
  dateOnly,
  exactCustomerCandidates,
  identityByCustomerId,
  identityKey,
  loadCustomerAccount,
  loadCustomerCommercialIntelligence,
  loadTopCustomers,
  maskPhone,
  normalizedMode,
  normalizedWindow,
  saleValiditySql,
};
