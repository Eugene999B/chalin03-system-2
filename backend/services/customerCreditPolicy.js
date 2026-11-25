"use strict";

// Pure decision rules only. All monetary inputs/outputs are integer pesewas.
// This module does not post sales, modify debts, or grant credit overrides.
const INITIAL_SCORE = 30;
const DEFAULT_TERM_MONTHS = 1;
const INITIAL_LIMIT = 2_500_000;
const MAX_LIMIT = 20_000_000;

function assertInteger(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(name + " must be an integer between " + min + " and " + max);
  }
  return value;
}

function creditLimitPesewas(score) {
  assertInteger(score, "score", 0, 100);
  return score <= INITIAL_SCORE
    ? Math.floor(INITIAL_LIMIT * score / INITIAL_SCORE)
    : INITIAL_LIMIT + Math.floor((MAX_LIMIT - INITIAL_LIMIT) * (score - INITIAL_SCORE) / (100 - INITIAL_SCORE));
}

function evaluateCredit({ score = INITIAL_SCORE, outstandingPesewas, reservedPesewas, newCreditPesewas }) {
  const limit = creditLimitPesewas(score);
  assertInteger(outstandingPesewas, "outstandingPesewas");
  assertInteger(reservedPesewas, "reservedPesewas");
  assertInteger(newCreditPesewas, "newCreditPesewas");
  const exposure = assertInteger(outstandingPesewas + reservedPesewas, "exposure");
  const projectedExposure = assertInteger(exposure + newCreditPesewas, "projectedExposure");
  const available = Math.max(0, limit - exposure);
  const decision = newCreditPesewas === 0 ? "non_credit"
    : projectedExposure <= limit ? "within_limit" : "approval_required";
  return {
    score, limitPesewas: limit, outstandingPesewas, reservedPesewas,
    exposurePesewas: exposure, availablePesewas: available, newCreditPesewas,
    projectedExposurePesewas: projectedExposure,
    overLimitPesewas: Math.max(0, projectedExposure - limit),
    decision
  };
}

// Calendar months, clamped to the last valid day, in Ghana's UTC calendar.
// Accept only an unambiguous date. Never retroactively modify an existing invoice.
function repaymentDueDate(issuedDate, months = DEFAULT_TERM_MONTHS) {
  assertInteger(months, "months", 1, 120);
  if (typeof issuedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(issuedDate)) {
    throw new RangeError("issuedDate must be YYYY-MM-DD");
  }
  const date = new Date(issuedDate + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== issuedDate) {
    throw new RangeError("issuedDate is not a valid calendar date");
  }
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const end = new Date(date.getTime());
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, end.getUTCDate()));
  if (date.getUTCFullYear() > 9999) throw new RangeError("due date exceeds supported range");
  return date.toISOString().slice(0, 10);
}

module.exports = { INITIAL_SCORE, DEFAULT_TERM_MONTHS, creditLimitPesewas, evaluateCredit, repaymentDueDate };
