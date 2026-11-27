"use strict";

// Pure decision policy. All monetary inputs and outputs are integer pesewas.
// Call only with server-computed balances, inside a locked sale transaction.
const INITIAL_SCORE = 30;
const DEFAULT_TERM_MONTHS = 1;
const INITIAL_LIMIT = 2500000;
const MAX_LIMIT = 20000000;

function assertInteger(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(name + " must be an integer between " + min + " and " + max);
  }
  return value;
}

function creditLimit(score = INITIAL_SCORE) {
  assertInteger(score, "score", 0, 100);
  return score <= 30
    ? Math.floor(INITIAL_LIMIT * score / 30)
    : INITIAL_LIMIT + (score - 30) * 250000;
}

function evaluateCredit({ score = INITIAL_SCORE, outstanding, reserved = 0, total, paid }) {
  const limit = creditLimit(score);
  assertInteger(outstanding, "outstanding");
  assertInteger(reserved, "reserved");
  assertInteger(total, "total", 1);
  assertInteger(paid, "paid", 0, total);
  const exposure = assertInteger(outstanding + reserved, "exposure");
  const newDebt = total - paid;
  const projectedExposure = assertInteger(exposure + newDebt, "projectedExposure");
  const available = Math.max(0, limit - exposure);
  return Object.freeze({
    score, limit, outstanding, reserved, exposure, available, newDebt,
    projectedExposure,
    decision: newDebt === 0 ? "fully_paid" : newDebt <= available ? "within_limit" : "approval_required"
  });
}

// Calendar month, clamped to the final valid day; UTC date-only (Ghana).
// The configured term must be snapshotted when the credit item is finalized.
function debtDueDate(dateOnly, months = DEFAULT_TERM_MONTHS) {
  assertInteger(months, "months", 1, 12);
  if (typeof dateOnly !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    throw new TypeError("dateOnly must be YYYY-MM-DD");
  }
  const source = new Date(dateOnly + "T00:00:00Z");
  if (!Number.isFinite(source.getTime()) || source.toISOString().slice(0,10) !== dateOnly ||
      source.getUTCFullYear() < 1900 || source.getUTCFullYear() > 9998) {
    throw new RangeError("Invalid business date");
  }
  const year = source.getUTCFullYear(), month = source.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + months, Math.min(source.getUTCDate(), lastDay)))
    .toISOString().slice(0,10);
}

module.exports = { INITIAL_SCORE, DEFAULT_TERM_MONTHS, INITIAL_LIMIT, MAX_LIMIT, creditLimit, evaluateCredit, debtDueDate };
