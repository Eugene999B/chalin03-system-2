"use strict";

const { pool } = require("../config/db");
const {
  ALGORITHM_VERSION,
  DEFAULT_SUGGESTION_SCORE,
  duplicateSuggestions,
} = require("./customerIdentityMatchingService");

const MAX_SCAN_ROWS = 3000;
const MAX_SUGGESTIONS = 30;

class AiCustomerIdentityIntelligenceError extends Error {
  constructor(message, { code = "AI_CUSTOMER_IDENTITY_ERROR", statusCode = 400 } = {}) {
    super(message);
    this.name = "AiCustomerIdentityIntelligenceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  const visible = digits.slice(-4);
  return `***${visible}`;
}

function safeMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function safeCustomer(customer) {
  return {
    customer_id: positiveInteger(customer?.customer_id),
    customer_name: String(customer?.customer_name || "").slice(0, 255),
    phone_masked: maskPhone(customer?.customer_phone),
    customer_location: String(customer?.customer_location || "").slice(0, 255),
    sale_count: Number(customer?.sale_count || 0),
    debt_count: Number(customer?.debt_count || 0),
    active_debt_count: Number(customer?.active_debt_count || 0),
    outstanding_balance: safeMoney(customer?.outstanding_balance),
    total_sales_value: safeMoney(customer?.total_sales_value),
    transaction_count: Number(customer?.transaction_count || 0),
    first_activity_at: customer?.first_activity_at || null,
    last_activity_at: customer?.last_activity_at || null,
  };
}

function safeSuggestion(pair) {
  return {
    pair_id: String(pair?.pair_id || "").slice(0, 80),
    score: Number(pair?.score || 0),
    confidence: String(pair?.confidence || "review").slice(0, 30),
    reasons: Array.isArray(pair?.reasons)
      ? pair.reasons.slice(0, 12).map((item) => String(item).slice(0, 220))
      : [],
    warnings: Array.isArray(pair?.warnings)
      ? pair.warnings.slice(0, 12).map((item) => String(item).slice(0, 220))
      : [],
    name_similarity: Number(pair?.name_similarity || 0),
    location_similarity: Number(pair?.location_similarity || 0),
    recommended_master_id: positiveInteger(pair?.recommended_master_id),
    customers: Array.isArray(pair?.customers)
      ? pair.customers.slice(0, 2).map(safeCustomer)
      : [],
  };
}

async function loadBranchCustomerDirectory(branchId, limit = MAX_SCAN_ROWS) {
  const safeBranchId = positiveInteger(branchId);
  if (!safeBranchId) {
    throw new AiCustomerIdentityIntelligenceError(
      "Choose an authorized Spare Parts branch before checking customer identities.",
      { code: "AI_CUSTOMER_IDENTITY_BRANCH_REQUIRED", statusCode: 409 }
    );
  }
  const safeLimit = clampInteger(limit, MAX_SCAN_ROWS, 1, MAX_SCAN_ROWS);

  const [[countRow]] = await pool.query(
    "SELECT COUNT(*) AS total FROM customers WHERE branch_id = ?",
    [safeBranchId]
  );

  const [rows] = await pool.query(
    `SELECT
       c.id AS customer_id,
       c.name AS customer_name,
       c.phone AS customer_phone,
       c.location AS customer_location,
       c.created_at,
       c.updated_at,
       COALESCE(s.sale_count, 0) AS sale_count,
       COALESCE(s.total_sales_value, 0) AS total_sales_value,
       s.first_sale_at,
       s.last_sale_at,
       COALESCE(d.debt_count, 0) AS debt_count,
       COALESCE(d.active_debt_count, 0) AS active_debt_count,
       COALESCE(d.outstanding_balance, 0) AS outstanding_balance,
       d.first_debt_at,
       d.last_debt_at,
       (COALESCE(s.sale_count, 0) + COALESCE(d.debt_count, 0)) AS transaction_count,
       LEAST(
         COALESCE(s.first_sale_at, c.created_at),
         COALESCE(d.first_debt_at, c.created_at),
         c.created_at
       ) AS first_activity_at,
       GREATEST(
         COALESCE(s.last_sale_at, c.updated_at, c.created_at),
         COALESCE(d.last_debt_at, c.updated_at, c.created_at),
         COALESCE(c.updated_at, c.created_at)
       ) AS last_activity_at
     FROM customers c
     LEFT JOIN (
       SELECT branch_id, customer_id, COUNT(*) AS sale_count,
              COALESCE(SUM(total), 0) AS total_sales_value,
              MIN(created_at) AS first_sale_at, MAX(created_at) AS last_sale_at
       FROM sales
       WHERE branch_id = ? AND customer_id IS NOT NULL
       GROUP BY branch_id, customer_id
     ) s ON s.branch_id = c.branch_id AND s.customer_id = c.id
     LEFT JOIN (
       SELECT branch_id, customer_id, COUNT(*) AS debt_count,
              SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS active_debt_count,
              COALESCE(SUM(balance), 0) AS outstanding_balance,
              MIN(created_at) AS first_debt_at, MAX(created_at) AS last_debt_at
       FROM debts
       WHERE branch_id = ? AND customer_id IS NOT NULL
       GROUP BY branch_id, customer_id
     ) d ON d.branch_id = c.branch_id AND d.customer_id = c.id
     WHERE c.branch_id = ?
     ORDER BY (COALESCE(s.sale_count, 0) + COALESCE(d.debt_count, 0)) DESC,
              c.name ASC, c.id ASC
     LIMIT ?`,
    [safeBranchId, safeBranchId, safeBranchId, safeLimit]
  );

  const total = Number(countRow?.total || 0);
  return Object.freeze({
    rows,
    database_total: total,
    loaded_count: rows.length,
    scan_limited: total > rows.length,
    limit: safeLimit,
  });
}

async function findDuplicateCustomerSuggestions({ context, input = {} } = {}) {
  const branchId = positiveInteger(context?.scope?.branch_id);
  if (!branchId) {
    throw new AiCustomerIdentityIntelligenceError(
      "Choose an authorized Spare Parts branch before checking customer identities.",
      { code: "AI_CUSTOMER_IDENTITY_BRANCH_REQUIRED", statusCode: 409 }
    );
  }
  const minimumScore = clampInteger(
    input.minimum_score,
    DEFAULT_SUGGESTION_SCORE,
    DEFAULT_SUGGESTION_SCORE,
    100
  );
  const resultLimit = clampInteger(input.limit, 12, 1, MAX_SUGGESTIONS);
  const directory = await loadBranchCustomerDirectory(branchId, MAX_SCAN_ROWS);
  const pairs = duplicateSuggestions(directory.rows, minimumScore);
  const suggestions = pairs.slice(0, resultLimit).map(safeSuggestion);

  return Object.freeze({
    workspace_code: "spare_parts",
    branch_id: branchId,
    algorithm_version: ALGORITHM_VERSION,
    minimum_score: minimumScore,
    database_customer_count: directory.database_total,
    scanned_customer_count: directory.loaded_count,
    scan_limited: directory.scan_limited,
    total_matching_pairs: pairs.length,
    returned_pairs: suggestions.length,
    suggestions,
    execution_authority: "suggestion_only",
    merge_executed: false,
    generated_at: new Date().toISOString(),
  });
}

module.exports = {
  AiCustomerIdentityIntelligenceError,
  MAX_SCAN_ROWS,
  MAX_SUGGESTIONS,
  findDuplicateCustomerSuggestions,
  loadBranchCustomerDirectory,
  maskPhone,
  safeCustomer,
  safeSuggestion,
};
