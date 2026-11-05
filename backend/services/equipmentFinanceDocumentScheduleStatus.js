"use strict";
const { dateOnly } = require("./equipmentFinanceDateOnlyService");

// This is presentation-only. It never changes installment schedules, receipts,
// payment allocations or the ledger in the database.
function documentScheduleStatus(row, today = new Date().toISOString().slice(0, 10)) {
  const status = String(row?.schedule_status || "");
  const due = dateOnly(row?.due_date);
  const remaining = Number(row?.scheduled_amount || 0) +
    Number(row?.late_charge_amount || 0) -
    Number(row?.waived_charge_amount || 0) -
    Number(row?.amount_paid || 0);
  if (!due || remaining <= 0.01) return status;
  if (due < today && (status === "upcoming" || status === "due")) return "overdue";
  if (due === today && status === "upcoming") return "due";
  return status;
}

module.exports = { documentScheduleStatus };
