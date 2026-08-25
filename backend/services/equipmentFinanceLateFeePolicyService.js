function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateLateFee({ lateChargeType, lateChargeValue, lateChargeCap, overdueAmount }) {
  const base = Math.max(number(overdueAmount), 0);
  const value = Math.max(number(lateChargeValue), 0);
  const cap = Math.max(number(lateChargeCap), 0);
  const type = String(lateChargeType || "none").toLowerCase();

  if (!base || !value || type === "none") return 0;

  let fee = type === "percentage" ? (base * value) / 100 : value;
  if (cap > 0) fee = Math.min(fee, cap);
  return Number(Math.max(fee, 0).toFixed(2));
}

function lateFeeClause({ lateChargeType, lateChargeValue, lateChargeCap, currency = "GHS" }) {
  const type = String(lateChargeType || "none").toLowerCase();
  const value = number(lateChargeValue);
  const cap = number(lateChargeCap);
  const money = (amount) => `${currency} ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (type === "fixed" && value > 0) {
    return cap > 0
      ? `Failure to pay an installment by its due date attracts a late payment fee of ${money(value)}, subject to a maximum charge of ${money(cap)}.`
      : `Failure to pay an installment by its due date attracts a late payment fee of ${money(value)}.`;
  }

  if (type === "percentage" && value > 0) {
    return cap > 0
      ? `Failure to pay an installment by its due date attracts a late payment fee of ${value}% of the overdue installment balance, subject to a maximum charge of ${money(cap)}.`
      : `Failure to pay an installment by its due date attracts a late payment fee of ${value}% of the overdue installment balance.`;
  }

  return "No late payment fee is currently configured for this Installment Finance policy.";
}

module.exports = { calculateLateFee, lateFeeClause };
