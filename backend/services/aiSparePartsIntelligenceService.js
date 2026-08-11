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

function safePercent(numerator, denominator) {
  const base = safeNumber(denominator);
  if (base <= 0) return 0;
  return Number(((safeNumber(numerator) / base) * 100).toFixed(2));
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
    branch_code:
      intelligence?.scope?.branch_code ||
      intelligence?.scope?.selected_branch_code ||
      null,
    branch_name:
      intelligence?.scope?.branch_name ||
      intelligence?.scope?.selected_branch_name ||
      null,
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

function diagnosticSeverity(percentValue, { medium = 10, high = 25 } = {}) {
  if (percentValue >= high) return "high";
  if (percentValue >= medium) return "medium";
  return "info";
}

function diagnosticDriver({ key, category, severity, effect, metric, explanation }) {
  return Object.freeze({
    key,
    category,
    severity,
    effect,
    metric,
    explanation,
  });
}

function buildPerformanceDiagnostics(intelligence, context) {
  const sales = intelligence?.sales || {};
  const expenses = intelligence?.expenses || {};
  const debts = intelligence?.debts || {};
  const stock = intelligence?.stock || {};
  const purchases = intelligence?.purchases || {};
  const returns = intelligence?.returns || {};
  const adjustments = intelligence?.stock_adjustments || {};
  const transfers = intelligence?.stock_transfers || {};
  const pnl = intelligence?.profit_and_loss || {};

  const totalSales = safeNumber(sales.total_sales);
  const totalPaid = safeNumber(sales.total_paid);
  const discounts = safeNumber(sales.total_discount);
  const totalExpenses = safeNumber(expenses.total_expenses);
  const returnAmount = safeNumber(returns.total_return_amount);
  const totalPurchases = safeNumber(purchases.total_purchases);
  const purchasePaid = safeNumber(purchases.amount_paid);
  const debtBalance = safeNumber(debts.total_debt_balance);
  const collectionRate = safeNumber(sales.collection_rate);
  const discountRate = safePercent(discounts, totalSales);
  const expenseRate = safePercent(totalExpenses, totalSales);
  const returnRate = safePercent(returnAmount, totalSales);
  const debtToSalesRate = safePercent(debtBalance, totalSales);
  const purchaseCashRate = safePercent(purchasePaid, Math.max(totalPaid, 1));
  const drivers = [];

  if (totalSales <= 0) {
    drivers.push(
      diagnosticDriver({
        key: "no_sales",
        category: "revenue",
        severity: "high",
        effect: "profit_estimate_and_cash",
        metric: { total_sales: totalSales },
        explanation:
          "No sales were recorded in the selected branch/date scope. Confirm the scope first; if correct, the absence of revenue is the primary commercial issue.",
      })
    );
  }

  if (discounts > 0) {
    drivers.push(
      diagnosticDriver({
        key: "discount_pressure",
        category: "revenue",
        severity: diagnosticSeverity(discountRate, { medium: 5, high: 10 }),
        effect: "reduces_net_sales",
        metric: { discount_amount: discounts, discount_rate_percent: discountRate },
        explanation:
          "Discounts reduce net sales directly. Review whether the discount level was intentional and commercially justified.",
      })
    );
  }

  if (totalExpenses > 0) {
    drivers.push(
      diagnosticDriver({
        key: "operating_expense_pressure",
        category: "profit_estimate",
        severity: diagnosticSeverity(expenseRate, { medium: 20, high: 50 }),
        effect: "reduces_management_net_and_cash",
        metric: { total_expenses: totalExpenses, expense_to_sales_percent: expenseRate },
        explanation:
          "Operating expenses reduce the current management net estimate and cash position. High expense-to-sales ratio is a direct performance pressure.",
      })
    );
  }

  if (returnAmount > 0) {
    drivers.push(
      diagnosticDriver({
        key: "return_refund_pressure",
        category: "returns",
        severity: diagnosticSeverity(returnRate, { medium: 5, high: 10 }),
        effect: "cash_stock_and_contra_income_review",
        metric: { return_amount: returnAmount, return_to_sales_percent: returnRate },
        explanation:
          "Returns/refunds reverse cash and stock effects and appear as contra-income/review signals. On this source lineage, the management P&L estimate does not automatically prove that every return is already deducted, so review returns separately before claiming profit.",
      })
    );
  }

  if (totalSales > 0 && collectionRate < 90) {
    drivers.push(
      diagnosticDriver({
        key: "collection_pressure",
        category: "cash_flow",
        severity: collectionRate < 70 ? "high" : collectionRate < 85 ? "medium" : "info",
        effect: "cash_conversion_not_profit",
        metric: {
          collection_rate_percent: collectionRate,
          sales_paid: totalPaid,
          sales_balance: safeNumber(sales.total_balance),
        },
        explanation:
          "Low collection rate means recorded sales are not converting to cash quickly. This is a receivables/cash-flow problem and must not be described as lost accounting profit by itself.",
      })
    );
  }

  if (debtBalance > 0) {
    drivers.push(
      diagnosticDriver({
        key: "receivables_pressure",
        category: "cash_flow",
        severity: diagnosticSeverity(debtToSalesRate, { medium: 25, high: 50 }),
        effect: "cash_and_credit_risk_not_new_revenue",
        metric: {
          total_debt_balance: debtBalance,
          debt_to_period_sales_percent: debtToSalesRate,
          active_debt_count: safeNumber(debts.active_debt_count),
          debt_payments: safeNumber(debts.debt_payments),
        },
        explanation:
          "Outstanding debt ties up receivables and increases collection risk. Later debt payments improve cash/receivables but are not a second sale.",
      })
    );
  }

  if (totalPurchases > 0 || purchasePaid > 0) {
    drivers.push(
      diagnosticDriver({
        key: "inventory_purchase_pressure",
        category: "cash_and_inventory",
        severity: diagnosticSeverity(purchaseCashRate, { medium: 30, high: 60 }),
        effect: "cash_outflow_and_inventory_build_not_certified_cogs",
        metric: {
          total_purchases: totalPurchases,
          purchase_amount_paid: purchasePaid,
          purchase_balance: safeNumber(purchases.balance),
          purchase_paid_to_sales_cash_percent: purchaseCashRate,
        },
        explanation:
          "Purchases can consume cash while building inventory or supplier balances. They are not certified COGS and should not be subtracted from revenue as if every purchased item was sold in the same period.",
      })
    );
  }

  if (safeNumber(stock.low_stock_count) > 0) {
    drivers.push(
      diagnosticDriver({
        key: "low_stock_sales_capacity",
        category: "inventory",
        severity: "medium",
        effect: "future_sales_capacity_risk",
        metric: { low_stock_count: safeNumber(stock.low_stock_count) },
        explanation:
          "Low stock can constrain future sales or cause missed demand. It is an availability risk, not direct proof of low profit in the selected period.",
      })
    );
  }

  if (safeNumber(stock.negative_stock_count) > 0) {
    drivers.push(
      diagnosticDriver({
        key: "negative_stock_integrity",
        category: "data_quality",
        severity: "high",
        effect: "weakens_inventory_and_profit_confidence",
        metric: { negative_stock_count: safeNumber(stock.negative_stock_count) },
        explanation:
          "Negative stock is a strong data/control warning. Inventory and profit interpretations should be treated cautiously until the underlying movements are reconciled.",
      })
    );
  }

  const adjustmentRisk =
    safeNumber(adjustments.decrease_count) +
    safeNumber(adjustments.set_count) +
    safeNumber(adjustments.damaged_count) +
    safeNumber(adjustments.lost_count);
  if (adjustmentRisk > 0) {
    drivers.push(
      diagnosticDriver({
        key: "manual_stock_control",
        category: "control",
        severity: "medium",
        effect: "shrinkage_or_data_quality_risk",
        metric: {
          decrease_count: safeNumber(adjustments.decrease_count),
          set_count: safeNumber(adjustments.set_count),
          damaged_count: safeNumber(adjustments.damaged_count),
          lost_count: safeNumber(adjustments.lost_count),
        },
        explanation:
          "Manual decreases/sets and damaged/lost adjustments can represent legitimate corrections or shrinkage. Review the source movements before attributing performance changes to sales alone.",
      })
    );
  }

  const transferRisk =
    safeNumber(transfers.dispatched_not_received_count) +
    safeNumber(transfers.quantity_mismatch_count);
  if (transferRisk > 0) {
    drivers.push(
      diagnosticDriver({
        key: "transfer_reconciliation",
        category: "control",
        severity: "high",
        effect: "branch_stock_availability_and_data_quality_risk",
        metric: {
          dispatched_not_received_count: safeNumber(transfers.dispatched_not_received_count),
          quantity_mismatch_count: safeNumber(transfers.quantity_mismatch_count),
        },
        explanation:
          "Unreceived dispatches or quantity mismatches can distort branch stock availability and weaken confidence in branch-level inventory conclusions.",
      })
    );
  }

  if (drivers.length === 0) {
    drivers.push(
      diagnosticDriver({
        key: "no_material_pressure_detected",
        category: "summary",
        severity: "info",
        effect: "no_deterministic_driver_identified",
        metric: {},
        explanation:
          "No material deterministic pressure was identified from the available aggregate signals. A deeper comparison period or product-level investigation may be needed.",
      })
    );
  }

  return {
    scope: safeScope(intelligence, context),
    financial_view: {
      gross_sales: safeNumber(pnl.gross_sales ?? sales.total_sales),
      discounts: safeNumber(pnl.discounts ?? sales.total_discount),
      net_sales: safeNumber(pnl.net_sales),
      operating_expenses: safeNumber(pnl.operating_expenses ?? expenses.total_expenses),
      estimated_net_before_stock_cost: safeNumber(pnl.estimated_net_before_stock_cost),
      conservative_cash_position: safeNumber(pnl.conservative_cash_position),
      total_paid: totalPaid,
      sales_balance: safeNumber(sales.total_balance),
      collection_rate: collectionRate,
      return_amount: returnAmount,
      total_debt_balance: debtBalance,
      purchase_total: totalPurchases,
      purchase_amount_paid: purchasePaid,
    },
    inventory_view: {
      product_count: safeNumber(stock.product_count),
      low_stock_count: safeNumber(stock.low_stock_count),
      negative_stock_count: safeNumber(stock.negative_stock_count),
      estimated_stock_cost_value: safeNumber(stock.estimated_stock_cost_value),
      estimated_stock_retail_value: safeNumber(stock.estimated_stock_retail_value),
      stock_adjustment_count: safeNumber(adjustments.adjustment_count),
      stock_transfer_count: safeNumber(transfers.transfer_count),
    },
    certainty: {
      profit_authority: "management_estimate_before_reliable_cogs",
      certified_profit_available: false,
      purchases_are_certified_cogs: false,
      collections_are_profit: false,
      returns_automatically_deducted_from_current_estimate: false,
      warning:
        String(
          pnl.warning ||
            "True profit requires reliable cost of goods sold. Use this as management diagnosis, not certified statutory profit."
        ).slice(0, 700),
    },
    causal_map: Object.freeze([
      Object.freeze({
        relationship: "sale -> paid/balance -> debt -> debt payment",
        meaning: "Revenue and cash collection are related but not the same event.",
      }),
      Object.freeze({
        relationship: "purchase -> stock/cash/supplier balance",
        meaning: "Inventory acquisition is not automatically period COGS.",
      }),
      Object.freeze({
        relationship: "return/refund -> cash reversal + stock correction + contra-income review",
        meaning: "Returns must be checked against the original sale before profit claims.",
      }),
      Object.freeze({
        relationship: "expense -> management net estimate + cash",
        meaning: "Operating expenses are a direct pressure on the current management net estimate.",
      }),
      Object.freeze({
        relationship: "adjustment/transfer mismatch -> stock/control confidence",
        meaning: "Inventory-control anomalies can weaken the reliability of commercial conclusions.",
      }),
    ]),
    drivers: Object.freeze(drivers),
    audit: safeAudit(intelligence),
    recommendations: safeRecommendations(intelligence),
    generated_at: intelligence?.generated_at || new Date().toISOString(),
    privacy: {
      customer_identity_included: false,
      phone_numbers_included: false,
      raw_sales_rows_included: false,
      raw_debt_rows_included: false,
      execution_authority: "read_only",
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
  buildPerformanceDiagnostics,
  buildScopedAccountingRequest,
  dateOnly,
  diagnosticDriver,
  diagnosticSeverity,
  loadSparePartsIntelligence,
  normalizeDateWindow,
  safeAudit,
  safePercent,
  safeRecommendations,
};
