const FREQUENCIES = new Set(["weekly", "fortnightly", "monthly", "custom"]);
const NON_WORKING_RULES = new Set(["exact", "next_weekday", "previous_weekday"]);

class FinanceScheduleError extends Error {
  constructor(statusCode, message, code = "INVALID_FINANCE_SCHEDULE") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 100) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function dateValue(value) {
  const text = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : text;
}

function moneyValue(value, minimum = 0) {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  if (!Number.isFinite(number) || number < minimum) return undefined;
  return Number(number.toFixed(2));
}

function wholeNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : undefined;
}

function normalizeFrequency(value) {
  const frequency = cleanText(value, 30).toLowerCase().replace(/[\s-]+/g, "_");
  return FREQUENCIES.has(frequency) ? frequency : null;
}

function normalizeNonWorkingRule(value) {
  const rule = cleanText(value || "exact", 40).toLowerCase().replace(/[\s-]+/g, "_");
  return NON_WORKING_RULES.has(rule) ? rule : null;
}

function intervalDaysFor(frequency, customIntervalDays = null) {
  if (frequency === "weekly") return 7;
  if (frequency === "fortnightly") return 14;
  if (frequency === "custom") return wholeNumber(customIntervalDays, 1, 365);
  return null;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date, months) {
  const originalDay = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
  ).getUTCDate();
  next.setUTCDate(Math.min(originalDay, lastDay));
  return next;
}

function applyNonWorkingRule(date, rule) {
  if (rule === "exact") return date;
  const day = date.getUTCDay();
  if (day !== 0 && day !== 6) return date;
  if (rule === "next_weekday") {
    return addDays(date, day === 6 ? 2 : 1);
  }
  return addDays(date, day === 6 ? -1 : -2);
}

function dueDateFor({ firstDate, frequency, intervalDays, index, nonWorkingDayRule }) {
  const unadjusted =
    frequency === "monthly"
      ? addMonths(firstDate, index)
      : addDays(firstDate, index * intervalDays);
  return applyNonWorkingRule(unadjusted, nonWorkingDayRule);
}

function normalizeScheduleInput(input = {}) {
  const sellingPrice = moneyValue(
    input.selling_price ?? input.purchase_price ?? input.total_amount,
    0.01
  );
  const deposit = moneyValue(input.deposit ?? input.proposed_deposit ?? 0, 0);
  const installmentCount = wholeNumber(
    input.installment_count ?? input.proposed_installment_count,
    1,
    520
  );
  const paymentFrequency = normalizeFrequency(
    input.payment_frequency ?? input.proposed_frequency
  );
  const firstDueDate = dateValue(
    input.first_due_date ?? input.proposed_first_due_date
  );
  const nonWorkingDayRule = normalizeNonWorkingRule(input.non_working_day_rule);
  const customIntervalDays = intervalDaysFor(
    paymentFrequency,
    input.custom_interval_days ?? input.proposed_interval_days ?? input.payment_interval_days
  );

  if (
    sellingPrice === undefined ||
    deposit === undefined ||
    deposit > sellingPrice ||
    installmentCount === undefined ||
    !paymentFrequency ||
    !firstDueDate ||
    !nonWorkingDayRule ||
    (paymentFrequency !== "monthly" && customIntervalDays === undefined)
  ) {
    throw new FinanceScheduleError(
      400,
      "Enter a valid selling price, deposit, payment frequency, interval, number of payments and first due date."
    );
  }

  return {
    selling_price: sellingPrice,
    deposit,
    financed_amount: Number((sellingPrice - deposit).toFixed(2)),
    installment_count: installmentCount,
    payment_frequency: paymentFrequency,
    custom_interval_days: customIntervalDays,
    first_due_date: firstDueDate,
    non_working_day_rule: nonWorkingDayRule,
  };
}

function buildFinanceSchedule(input = {}) {
  const normalized = normalizeScheduleInput(input);
  const totalCents = Math.round(normalized.financed_amount * 100);
  const baseCents = Math.floor(totalCents / normalized.installment_count);
  const firstDate = new Date(`${normalized.first_due_date}T00:00:00Z`);
  let assignedCents = 0;
  const schedule = [];

  for (let index = 0; index < normalized.installment_count; index += 1) {
    const cents =
      index === normalized.installment_count - 1
        ? totalCents - assignedCents
        : baseCents;
    assignedCents += cents;
    const dueDate = dueDateFor({
      firstDate,
      frequency: normalized.payment_frequency,
      intervalDays: normalized.custom_interval_days,
      index,
      nonWorkingDayRule: normalized.non_working_day_rule,
    });
    schedule.push({
      sequence_number: index + 1,
      due_date: dueDate.toISOString().slice(0, 10),
      scheduled_amount: Number((cents / 100).toFixed(2)),
    });
  }

  return {
    ...normalized,
    periodic_amount: schedule[0]?.scheduled_amount || 0,
    final_payment_amount: schedule.at(-1)?.scheduled_amount || 0,
    final_due_date: schedule.at(-1)?.due_date || normalized.first_due_date,
    schedule,
    calculation_policy: {
      exact_dates_generated: true,
      monthly_anchor_day_preserved: true,
      rounding: "final_schedule_line_only",
      non_working_day_rule: normalized.non_working_day_rule,
    },
  };
}

function monthlyEquivalent(periodicAmount, frequency, intervalDays = null) {
  const amount = moneyValue(periodicAmount, 0) || 0;
  if (frequency === "weekly") return Number(((amount * 52) / 12).toFixed(2));
  if (frequency === "fortnightly") return Number(((amount * 26) / 12).toFixed(2));
  if (frequency === "custom") {
    const days = wholeNumber(intervalDays, 1, 365) || 30;
    return Number(((amount * 365.2425) / days / 12).toFixed(2));
  }
  return amount;
}

module.exports = {
  FinanceScheduleError,
  FREQUENCIES,
  NON_WORKING_RULES,
  buildFinanceSchedule,
  intervalDaysFor,
  monthlyEquivalent,
  normalizeScheduleInput,
};
