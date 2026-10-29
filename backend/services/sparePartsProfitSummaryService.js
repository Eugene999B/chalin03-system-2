"use strict";

// A store's profit pipeline reports transactions *within the selected
// reporting period*. The caller must date-filter returns by returned_at,
// not the creation date of the sale that was later returned.
function amount(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function calculateSparePartsProfitSummary({ profit = {}, expenses = {}, refunds = {} } = {}) {
  const grossProfit = amount(profit.gross_profit);
  const totalExpenses = amount(expenses.total_expenses);
  const totalRefunds = amount(refunds.total_refunds);
  const recoveredReturnCost = amount(refunds.recovered_return_cost);
  const netProfit = Math.round(
    (grossProfit - totalExpenses - totalRefunds + recoveredReturnCost) * 100
  ) / 100;

  return {
    gross_profit: grossProfit,
    total_expenses: totalExpenses,
    total_refunds: totalRefunds,
    recovered_return_cost: recoveredReturnCost,
    net_profit: netProfit,
  };
}

module.exports = { calculateSparePartsProfitSummary };
