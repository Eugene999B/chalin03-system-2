"use strict";
const {creditLimit, evaluateCredit, debtDueDate, INITIAL_SCORE, DEFAULT_TERM_MONTHS} = require("./customerCreditPolicy");

function toPesewas(value) {
  // mysql2 normally returns DECIMAL as a string. Reject excess precision.
  const raw = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new RangeError("Invalid nonnegative money");
  const [whole, fraction = ""] = raw.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new RangeError("Monetary value out of range");
  return result;
}

function describeCredit({score = INITIAL_SCORE, outstanding, termMonths = DEFAULT_TERM_MONTHS}) {
  const balance = toPesewas(outstanding);
  const limit = creditLimit(score);
  return {
    score, limit: limit / 100, outstanding: balance / 100,
    available: Math.max(0, limit - balance) / 100,
    utilization_percent: limit ? Math.round(balance / limit * 10000) / 100 : null,
    term_months: termMonths,
    over_limit: balance > limit,
    at_limit: balance >= limit
  };
}

async function loadCreditProfile(db, {branchId, customerId}) {
  if (![branchId, customerId].every(v => Number.isSafeInteger(v) && v > 0)) {
    throw new RangeError("A valid branch and customer are required");
  }
  const [rows] = await db.query(
    `SELECT c.id, COALESCE(p.score, 30) AS score, COALESCE(p.version,1) AS version, COALESCE(cs.term_months,1) AS term_months
     FROM customers c
     LEFT JOIN customer_credit_profiles p ON p.customer_id=c.id
     LEFT JOIN customer_credit_settings cs ON cs.branch_id=c.branch_id
     WHERE c.id=? AND c.branch_id=?`, [customerId, branchId]
  );
  if (!rows.length) return null;
  const [balances] = await db.query(
    `SELECT COALESCE(SUM(d.balance),0) AS outstanding
     FROM debts d LEFT JOIN sales s ON s.id=d.sale_id AND s.branch_id=d.branch_id
     WHERE d.branch_id=? AND COALESCE(s.customer_id,d.customer_id)=? AND d.balance>0`,
    [branchId, customerId]
  );
  return {...describeCredit({score:Number(rows[0].score), outstanding:balances[0].outstanding, termMonths:Number(rows[0].term_months)}),version:String(rows[0].version??1)};
}

// Caller must hold the customer lock and provide fresh authoritative exposure,
// including outstanding approved reservations. This helper never posts a sale.
function assessPreparedSale({profile, total, paid, reserved, businessDate}) {
  if (!profile) throw new Error("Canonical customer is required");
  const result = evaluateCredit({
    score:profile.score, outstanding:toPesewas(profile.outstanding),
    reserved:toPesewas(reserved), total:toPesewas(total), paid:toPesewas(paid)
  });
  return {...result, due_date:result.newDebt ? debtDueDate(businessDate,profile.term_months) : null};
}
module.exports = {toPesewas, describeCredit, loadCreditProfile, assessPreparedSale};
