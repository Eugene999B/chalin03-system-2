"use strict";

const {
  buildAccountingIntelligence,
} = require("./accountingIntelligenceService");

const MAX_WINDOW_DAYS = 366;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class AiSparePartsIntelligenceError extends Error {
  constructor(message, { code = "AI_SPARE_PARTS_INTELLIGENCE_ERROR", statusCode = 400 } = {}) {
    super(message);
    this.name = "AiSparePartsIntelligenceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function dateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!DATE_PATTERN.test(raw)) {
    throw new AiSparePartsIntelligenceError(
      "Spare Parts intelligence dates must use YYYY-MM-DD format.",
      { code: "AI_SPARE_PARTS_DATE_INVALID" }
    );
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new AiSparePartsIntelligenceError(
      "Spare Parts intelligence received an invalid calendar date.",
      { code: "AI_SPARE_PARTS_DATE_INVALID" }
    );
  }
  return raw;
}

function windowDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function normalizeDateWindow(input = {}) {
  let startDate = dateOnly(input.start_date);
  let endDate = dateOnly(input.end_date);
  if (startDate && endDate && startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }
  const days = windowDays(startDate, endDate);
  if (days && days > MAX_WINDOW_DAYS) {
    throw new AiSparePartsIntelligenceError(
      `Spare Parts intelligence is limited to ${MAX_WINDOW_DAYS} days per request.`,
      { code: "AI_SPARE_PARTS_WINDOW_TOO_LARGE" }
    );
  }
  return Object.freeze({ start_date: startDate, end_date: endDate });
}

function safeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function boundedArray(value, limit = 20) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function buildScopedAccountingRequest(context, input = {}) {
  const branchId = positiveInteger(context?.scope?.branch_id);
  if (!branchId) {
    throw new AiSparePartsIntelligenceError(
      "Choose an authorized Spare Parts branch before requesting intelligence.",
      { code: "AI_SPARE_PARTS_BRANCH_REQUIRED", statusCode: 409 }
    );
  }
  const window = normalizeDateWindow(input);
  const query = { branch_id: branchId };
  if (window.start_date) query.start_date = window.start_date;
  if (window.end_date) query.end_date = window.end_date;

  return Object.freeze({
    user: Object.freeze({
      id: positiveInteger(context?.actor?.id),
      role: String(context?.actor?.role || "").slice(0, 80),
      branch_id: branchId,
      default_branch_id: branchId,
    }),
    query: Object.freeze(query),
  });
}

function safeRecommendations(intelligence) {
  return boundedArray(intelligence?.recommendations, 8).map((item) => ({
    priority: String(item?.priority || "medium").slice(0, 30),
    title: String(item?.title || "Recommendation").slice(0, 180),
    action: String(item?.action || "").slice(0, 700),
  }));
}

function safeAudit(intelligence) {
  return {
    score: safeNumber(intelligence?.audit?.audit_score),
    status: String(intelligence?.audit?.audit_status || "unknown").slice(0, 40),
    flags: boundedArray(intelligence?.audit?.flags, 10).map((flag) => ({
      severity: String(flag?.severity || "info").slice(0, 20),
      category: String(flag?.category || "General").slice(0, 80),
      title: String(flag?.title || "Review item").slice(0, 180),
      detail: String(flag?.detail || "").slice(0, 700),
      recommended_action: String(flag?.recommended_action || "").slice(0, 700),
    })),
  };
}

function safeScope(intelligence, context) {
  return {
    workspace_code: "spare_parts",
    branch_id: positiveInteger(context?.scope?.branch_id),
    branch_code: intelligence?.scope?.branch_code || null,
    branch_name: intelligence?.scope?.branch_name || null,
    start_date: intelligence?.scope?.start_date || null,
    end_date: intelligence?.scope?.end_date || null,
    days: safeNumber(intelligence?.scope?.days),
  };
}

function buildOperationsSnapshot(intelligence, context) {
  const sales = intelligence?.sales || {};
  const debts = intelligence?.debts || {};
  const stock = intelligence?.stock || {};
  const purchases = intelligence?.purchases || {};
  const returns = intelligence?.returns || {};
  const adjustments = intelligence?.stock_adjustments || {};
  const transfers = intelligence?.stock_transfers || {};
  const expenses = intelligence?.expenses || {};

  return {
    scope: safeScope(intelligence, context),
    sales: {
      transaction_count: safeNumber(sales.transaction_count),
      total_sales: safeNumber(sales.total_sales),
      total_paid: safeNumber(sales.total_paid),
      total_balance: safeNumber(sales.total_balance),
      total_discount: safeNumber(sales.total_discount),
      average_sale: safeNumber(sales.average_sale),
      collection_rate: safeNumber(sales.collection_rate),
      payment_mix: {
        cash: safeNumber(sales.cash_total),
        momo: safeNumber(sales.momo_total),
        bank: safeNumber(sales.bank_total),
        credit: safeNumber(sales.credit_total),
        mixed: safeNumber(sales.mixed_total),
      },
    },
    collections: {
      active_debt_count: safeNumber(debts.active_debt_count),
      total_debt_balance: safeNumber(debts.total_debt_balance),
      new_debt_amount: safeNumber(debts.new_debt_amount),
      debt_payments: safeNumber(debts.debt_payments),
    },
    inventory: {
      product_count: safeNumber(stock.product_count),
      total_quantity: safeNumber(stock.total_quantity),
      low_stock_count: safeNumber(stock.low_stock_count),
      negative_stock_count: safeNumber(stock.negative_stock_count),
      estimated_stock_cost_value: safeNumber(stock.estimated_stock_cost_value),
      estimated_stock_retail_value: safeNumber(stock.estimated_stock_retail_value),
    },
    operations: {
      expense_count: safeNumber(expenses.expense_count),
      total_expenses: safeNumber(expenses.total_expenses),
      purchase_count: safeNumber(purchases.purchase_count),
      total_purchases: safeNumber(purchases.total_purchases),
      purchase_balance: safeNumber(purchases.balance),
      return_count: safeNumber(returns.return_count),
      return_amount: safeNumber(returns.total_return_amount),
      stock_adjustment_count: safeNumber(adjustments.adjustment_count),
      stock_transfer_count: safeNumber(transfers.transfer_count),
    },
    audit: safeAudit(intelligence),
    recommendations: safeRecommendations(intelligence),
    generated_at: intelligence?.generated_at || new Date().toISOString(),
    privacy: {
      customer_identity_included: false,
      phone_numbers_included: false,
      raw_rows_included: false,
    },
  };
}

function buildInventoryHealth(intelligence, context) {
  const stock = intelligence?.stock || {};
  const adjustments = intelligence?.stock_adjustments || {};
  const transfers = intelligence?.stock_transfers || {};
  return {
    scope: safeScope(intelligence, context),
    inventory: {
      product_count: safeNumber(stock.product_count),
      total_quantity: safeNumber(stock.total_quantity),
      low_stock_count: safeNumber(stock.low_stock_count),
      negative_stock_count: safeNumber(stock.negative_stock_count),
      estimated_stock_cost_value: safeNumber(stock.estimated_stock_cost_value),
      estimated_stock_retail_value: safeNumber(stock.estimated_stock_retail_value),
      low_stock_items: boundedArray(stock.low_stock_items, 20).map((item) => ({
        product_id: positiveInteger(item?.id),
        name: String(item?.name || "Unnamed product").slice(0, 220),
        quantity: safeNumber(item?.quantity),
        low_stock_threshold: safeNumber(item?.low_stock_threshold),
      })),
    },
    stock_control: {
      adjustment_count: safeNumber(adjustments.adjustment_count),
      decrease_count: safeNumber(adjustments.decrease_count),
      set_count: safeNumber(adjustments.set_count),
      damaged_count: safeNumber(adjustments.damaged_count),
      lost_count: safeNumber(adjustments.lost_count),
      transfer_count: safeNumber(transfers.transfer_count),
      dispatched_not_received_count: safeNumber(transfers.dispatched_not_received_count),
      quantity_mismatch_count: safeNumber(transfers.quantity_mismatch_count),
    },
    audit: safeAudit(intelligence),
    generated_at: intelligence?.generated_at || new Date().toISOString(),
  };
}

function buildCollectionsHealth(intelligence, context) {
  const debts = intelligence?.debts || {};
  const sales = intelligence?.sales || {};
  return {
    scope: safeScope(intelligence, context),
    collections: {
      active_debt_count: safeNumber(debts.active_debt_count),
      total_debt_balance: safeNumber(debts.total_debt_balance),
      new_debt_amount: safeNumber(debts.new_debt_amount),
      debt_payments: safeNumber(debts.debt_payments),
      sales_total: safeNumber(sales.total_sales),
      sales_paid: safeNumber(sales.total_paid),
      sales_balance: safeNumber(sales.total_balance),
      collection_rate: safeNumber(sales.collection_rate),
      aging: boundedArray(debts.aging, 8).map((bucket) => ({
        bucket: String(bucket?.bucket || "Unknown").slice(0, 40),
        count: safeNumber(bucket?.count),
        total: safeNumber(bucket?.total),
      })),
    },
    recommendations: safeRecommendations(intelligence).filter((item) =>
      /debt|collect|credit|receiv|payment/i.test(`${item.title} ${item.action}`)
    ),
    generated_at: intelligence?.generated_at || new Date().toISOString(),
    privacy: {
      customer_identity_included: false,
      phone_numbers_included: false,
      individual_debt_rows_included: false,
    },
  };
}

async function loadSparePartsIntelligence({ context, input = {} } = {}) {
  const request = buildScopedAccountingRequest(context, input);
  const intelligence = await buildAccountingIntelligence(request);
  return Object.freeze({ intelligence, context });
}

module.exports = {
  AiSparePartsIntelligenceError,
  DATE_PATTERN,
  MAX_WINDOW_DAYS,
  boundedArray,
  buildCollectionsHealth,
  buildInventoryHealth,
  buildOperationsSnapshot,
  buildScopedAccountingRequest,
  dateOnly,
  loadSparePartsIntelligence,
  normalizeDateWindow,
  safeAudit,
  safeRecommendations,
};
