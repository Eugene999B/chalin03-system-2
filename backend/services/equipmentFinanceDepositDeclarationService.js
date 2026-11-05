"use strict";

// Render evidence already recorded in Finance, never a supposed payment date
// inferred from the agreed deposit or the PDF issue date.
function paymentDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const valueText = String(value);
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(valueText);
  return match ? match[1] : null;
}

function isDepositPayment(payment) {
  return ["deposit", "opening_deposit"].includes(String(payment?.payment_category || "").toLowerCase()) ||
    ["deposit", "opening_deposit"].includes(String(payment?.payment_stage || "").toLowerCase());
}

function financeDepositEvidence(snapshot = {}) {
  const agreement = snapshot.agreement || {};
  const recordedAmount = Number(agreement.deposit_received || 0);
  const paid = (Array.isArray(snapshot.payments) ? snapshot.payments : [])
    .filter((payment) => isDepositPayment(payment) && Number(payment.amount || 0) > 0)
    .sort((a, b) => String(paymentDateOnly(a.payment_date) || "").localeCompare(String(paymentDateOnly(b.payment_date) || "")));
  const dates = [...new Set(paid.map((payment) => paymentDateOnly(payment.payment_date)).filter(Boolean))];
  return {
    amount: Number.isFinite(recordedAmount) ? recordedAmount : 0,
    first_paid_date: dates[0] || null,
    last_paid_date: dates.at(-1) || null,
    payment_count: paid.length,
    references: paid.map((payment) => String(payment.receipt_number || payment.payment_number || "").trim()).filter(Boolean),
  };
}

function buyerDeclaration(snapshot = {}) {
  const agreement = snapshot.agreement || {};
  const buyer = String(agreement.kyc_customer_name || agreement.customer_name_snapshot || agreement.customer_name || "________________").trim().slice(0, 160);
  return `I, ${buyer}, declare that I have reviewed the identified equipment, the purchase price, the initial deposit, and the instalment amounts and payment dates in this agreement. I understand my payment obligations and confirm that the details stated here require my acceptance by signature below.`;
}

module.exports = { financeDepositEvidence, buyerDeclaration, paymentDateOnly };
