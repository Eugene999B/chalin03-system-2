"use strict";

/**
 * Pure price-only projections from a locked Equipment Finance agreement.
 * Does NOT update database records, issued documents, actual payments, fees,
 * machine identity, signed terms or signatures.
 */
class PriceScenarioError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.code = "PRICE_SCENARIO_INVALID";
  }
}

const cents = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new PriceScenarioError("Enter a valid amount.");
  return Math.round(amount * 100);
};
const money = (amountCents) => Number((amountCents / 100).toFixed(2));

function priceScenario(snapshot, priceInput) {
  if (!snapshot?.agreement || !Array.isArray(snapshot.schedule)) {
    throw new PriceScenarioError("The original agreement is unavailable.", 409);
  }
  const source = snapshot.agreement;
  const originalPrice = cents(source.total_amount);
  const originalDeposit = cents(source.deposit_required || 0);
  const targetPrice = cents(priceInput);
  const targetDeposit = originalDeposit; // Preserve all non-price contract terms.
  const recordedPaid = cents(source.amount_paid || 0);
  if (targetPrice <= 0 || targetPrice > 99999999999) {
    throw new PriceScenarioError("Enter a valid excavator price.");
  }
  if (targetPrice < targetDeposit) {
    throw new PriceScenarioError("The price cannot be below the original required deposit.");
  }
  if (targetPrice < recordedPaid) {
    throw new PriceScenarioError("The proposed price is below payments already recorded.");
  }
  if (!snapshot.schedule.length) {
    throw new PriceScenarioError("The original agreement has no installment schedule.", 409);
  }

  const priceDifference = targetPrice - originalPrice;
  const financeDifference = priceDifference;
  const originalFinanced = cents(source.financed_amount || 0);
  const originalOutstanding = cents(source.outstanding_balance || 0);
  if (originalFinanced + financeDifference < 0 ||
      originalOutstanding + priceDifference < 0) {
    throw new PriceScenarioError("This price would create a negative financed or outstanding amount.");
  }

  const sourceSchedule = snapshot.schedule.map((row) => cents(row.scheduled_amount || 0));
  const scheduleTotal = sourceSchedule.reduce((sum, amount) => sum + amount, 0);
  if (scheduleTotal <= 0 || scheduleTotal + financeDifference < 0) {
    throw new PriceScenarioError("The original payment schedule cannot support this price.");
  }
  let allocated = 0;
  const newSchedule = snapshot.schedule.map((row, index) => {
    // Distribute only the revised financed amount; retain every original due
    // date, sequence, recorded payment and historical penalty.
    const addition = index === snapshot.schedule.length - 1
      ? financeDifference - allocated
      : Math.round(financeDifference * sourceSchedule[index] / scheduleTotal);
    allocated += addition;
    const proposedAmount = sourceSchedule[index] + addition;
    if (proposedAmount < 0) {
      throw new PriceScenarioError("The chosen amount cannot fit the original installment schedule.");
    }
    const paid = cents(row.amount_paid || 0);
    const late = cents(row.late_charge_amount || 0);
    const waived = cents(row.waived_charge_amount || 0);
    const balance = proposedAmount + late - waived - paid;
    return {
      ...row,
      scheduled_amount: money(proposedAmount),
      amount_paid: money(paid), // recorded evidence, never projected
      balance: money(Math.max(0, balance)),
      schedule_status: balance <= 0 ? "paid" : paid > 0 ? "part_paid" : "projected",
    };
  });

  const agreement = {
    ...source,
    total_amount: money(targetPrice),
    sale_price: money(cents(source.sale_price || source.total_amount) + priceDifference),
    subtotal: money(cents(source.subtotal || source.total_amount) + priceDifference),
    deposit_required: money(targetDeposit),
    // Deposit received and all posted payments belong to the ORIGINAL ledger.
    deposit_received: Number(source.deposit_received || 0),
    financed_amount: money(originalFinanced + financeDifference),
    scheduled_total: money(scheduleTotal + financeDifference),
    periodic_amount: newSchedule[0]?.scheduled_amount || 0,
    installment_amount: newSchedule[0]?.scheduled_amount || 0,
    outstanding_balance: money(originalOutstanding + priceDifference),
    amount_paid: Number(source.amount_paid || 0),
  };

  return {
    ...snapshot,
    agreement,
    schedule: newSchedule,
    // Never reuse actual signed images in a differently priced document.
    company: {
      ...snapshot.company,
      authorised_seller_signature_data_url: null,
    },
    signatures: [],
    price_scenario: {
      kind: "price_only_pro_forma",
      source_agreement_number: String(source.agreement_number || ""),
      original_price: money(originalPrice),
      proposed_price: money(targetPrice),
      original_deposit: money(originalDeposit),
      proposed_deposit: money(originalDeposit),
      price_difference: money(priceDifference),
      recorded_paid: money(recordedPaid),
      finance_difference: money(financeDifference),
      is_official_agreement: false,
    },
  };
}

function summarizePriceScenario(snapshot) {
  const a = snapshot.agreement;
  return {
    agreement_id: Number(a.id),
    agreement_number: a.agreement_number,
    excavator: [a.asset_code, a.asset_name].filter(Boolean).join(" - "),
    buyer: a.kyc_customer_name || a.customer_name_snapshot || a.customer_name || "",
    original_price: snapshot.price_scenario.original_price,
    scenario_price: snapshot.price_scenario.proposed_price,
    deposit_required: Number(a.deposit_required || 0),
    deposit_recorded: Number(a.deposit_received || 0),
    financed: Number(a.financed_amount || 0),
    actual_paid: Number(a.amount_paid || 0),
    projected_outstanding: Number(a.outstanding_balance || 0),
    schedule: snapshot.schedule.map((row) => ({
      number: row.sequence_number,
      due_date: row.due_date,
      amount: row.scheduled_amount,
      recorded_paid: row.amount_paid,
      projected_balance: row.balance,
    })),
  };
}

module.exports = { PriceScenarioError, priceScenario, summarizePriceScenario };
