const FREQUENCIES = new Set(["weekly", "fortnightly", "monthly", "custom"]);
const NON_WORKING_RULES = new Set([
  "exact",
  "next_weekday",
  "previous_weekday",
]);

class FinanceScheduleError extends Error {
  constructor(statusCode, message, code = "INVALID_FINANCE_SCHEDULE") {
    super(message);
    this.name = "FinanceScheduleError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 100) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function dateValue(value) {
  let year;
  let month;
  let day;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    year = value.getUTCFullYear();
    month = value.getUTCMonth() + 1;
    day = value.getUTCDate();
  } else {
    const text = cleanText(value, 50);
    const match = /^(\d{4})-(\d{2})-(\d{2})(?=$|[T\s])/.exec(text);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
}

function ghanaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function moneyValue(value, minimum = 0) {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (!normalized || !/^(?:\d+|\d*\.\d{1,2})$/.test(normalized)) {
    return undefined;
  }
  const number = Number(normalized);
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
  const frequency = cleanText(value, 30)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return FREQUENCIES.has(frequency) ? frequency : null;
}

function normalizeNonWorkingRule(value) {
  const rule = cleanText(value || "exact", 40)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return NON_WORKING_RULES.has(rule) ? rule : null;
}

function normalizeNonWorkingDates(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const dates = raw.map(dateValue).filter(Boolean);
  return new Set(dates);
}

function intervalDaysFor(frequency, customIntervalDays = null) {
  if (frequency === "weekly") return 7;
  if (frequency === "fortnightly") return 14;
  if (frequency === "custom") {
    return wholeNumber(customIntervalDays, 1, 365);
  }
  return null;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date, months) {
  const originalDay = date.getUTCDate();
  const firstOfTargetMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
  );
  const lastDay = new Date(
    Date.UTC(
      firstOfTargetMonth.getUTCFullYear(),
      firstOfTargetMonth.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();
  firstOfTargetMonth.setUTCDate(Math.min(originalDay, lastDay));
  return firstOfTargetMonth;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function isNonWorkingDate(date, blockedDates = new Set()) {
  const day = date.getUTCDay();
  return day === 0 || day === 6 || blockedDates.has(isoDate(date));
}

function applyNonWorkingRule(date, rule, blockedDates = new Set()) {
  if (rule === "exact") return date;
  let adjusted = new Date(date.getTime());
  const direction = rule === "previous_weekday" ? -1 : 1;
  let guard = 0;
  while (isNonWorkingDate(adjusted, blockedDates)) {
    adjusted = addDays(adjusted, direction);
    guard += 1;
    if (guard > 370) {
      throw new FinanceScheduleError(
        400,
        "The non-working-day calendar cannot produce a valid installment date.",
        "FINANCE_NON_WORKING_DATE_EXHAUSTED"
      );
    }
  }
  return adjusted;
}

function nextAvailableDateAfter(date, blockedDates = new Set()) {
  let candidate = addDays(date, 1);
  let guard = 0;
  while (isNonWorkingDate(candidate, blockedDates)) {
    candidate = addDays(candidate, 1);
    guard += 1;
    if (guard > 370) {
      throw new FinanceScheduleError(
        400,
        "The non-working-day calendar cannot produce a unique installment date.",
        "FINANCE_SCHEDULE_DATE_COLLISION"
      );
    }
  }
  return candidate;
}

function dueDateFor({
  firstDate,
  frequency,
  intervalDays,
  index,
  nonWorkingDayRule,
  nonWorkingDates,
}) {
  const unadjusted =
    frequency === "monthly"
      ? addMonths(firstDate, index)
      : addDays(firstDate, index * intervalDays);
  const adjusted = applyNonWorkingRule(unadjusted, nonWorkingDayRule, nonWorkingDates);
  return { unadjusted, adjusted };
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
  const minimumFirstDueDate = input.minimum_first_due_date
    ? dateValue(input.minimum_first_due_date)
    : ghanaToday();
  const nonWorkingDayRule = normalizeNonWorkingRule(
    input.non_working_day_rule ?? input.proposed_non_working_day_rule
  );
  const intervalDays = intervalDaysFor(
    paymentFrequency,
    input.custom_interval_days ??
      input.proposed_interval_days ??
      input.payment_interval_days
  );
  const nonWorkingDates = normalizeNonWorkingDates(
    input.non_working_dates ?? input.company_non_working_dates ?? []
  );

  const invalidFields = [];
  if (sellingPrice === undefined) invalidFields.push("selling price");
  if (deposit === undefined || (sellingPrice !== undefined && deposit >= sellingPrice)) {
    invalidFields.push("deposit below the selling price");
  }
  if (!paymentFrequency) invalidFields.push("payment frequency");
  if (paymentFrequency && paymentFrequency !== "monthly" && intervalDays === undefined) {
    invalidFields.push("payment interval");
  }
  if (installmentCount === undefined) invalidFields.push("number of payments");
  if (!firstDueDate) invalidFields.push("first due date");
  if (input.minimum_first_due_date && !minimumFirstDueDate) {
    invalidFields.push("minimum first due date");
  }
  if (!nonWorkingDayRule) invalidFields.push("non-working-day rule");

  if (invalidFields.length) {
    throw new FinanceScheduleError(
      400,
      `The approved payment plan has invalid or missing ${invalidFields.join(", ")}. Correct only those fields in the application and try again.`
    );
  }

  if (minimumFirstDueDate && firstDueDate < minimumFirstDueDate) {
    throw new FinanceScheduleError(
      409,
      `The first installment due date cannot be earlier than ${minimumFirstDueDate}. Review the approved payment plan before activation.`,
      "FINANCE_FIRST_DUE_DATE_IN_PAST"
    );
  }

  return {
    selling_price: sellingPrice,
    deposit,
    financed_amount: Number((sellingPrice - deposit).toFixed(2)),
    installment_count: installmentCount,
    payment_frequency: paymentFrequency,
    custom_interval_days: intervalDays,
    first_due_date: firstDueDate,
    non_working_day_rule: nonWorkingDayRule,
    non_working_dates: [...nonWorkingDates].sort(),
  };
}

function buildFinanceSchedule(input = {}) {
  const normalized = normalizeScheduleInput(input);
  const totalCents = Math.round(normalized.financed_amount * 100);
  const baseCents = Math.floor(totalCents / normalized.installment_count);
  const firstDate = new Date(`${normalized.first_due_date}T00:00:00Z`);
  const nonWorkingDates = new Set(normalized.non_working_dates || []);
  let assignedCents = 0;
  let previousDueDate = null;
  let collisionAdjustments = 0;
  const dateAdjustments = [];
  const schedule = [];

  for (let index = 0; index < normalized.installment_count; index += 1) {
    const cents =
      index === normalized.installment_count - 1
        ? totalCents - assignedCents
        : baseCents;
    assignedCents += cents;
    const dueDateResult = dueDateFor({
      firstDate,
      frequency: normalized.payment_frequency,
      intervalDays: normalized.custom_interval_days,
      index,
      nonWorkingDayRule: normalized.non_working_day_rule,
      nonWorkingDates,
    });
    let dueDate = dueDateResult.adjusted;

    if (isoDate(dueDateResult.unadjusted) !== isoDate(dueDateResult.adjusted)) {
      dateAdjustments.push({
        sequence_number: index + 1,
        reason: "non_working_day_rule",
        original_due_date: isoDate(dueDateResult.unadjusted),
        adjusted_due_date: isoDate(dueDateResult.adjusted),
      });
    }

    if (previousDueDate && dueDate.getTime() <= previousDueDate.getTime()) {
      const originalCollisionDate = isoDate(dueDate);
      dueDate = nextAvailableDateAfter(previousDueDate, nonWorkingDates);
      collisionAdjustments += 1;
      dateAdjustments.push({
        sequence_number: index + 1,
        reason: "duplicate_date_collision",
        original_due_date: originalCollisionDate,
        adjusted_due_date: isoDate(dueDate),
      });
    }

    previousDueDate = dueDate;
    schedule.push({
      sequence_number: index + 1,
      due_date: isoDate(dueDate),
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
      strictly_increasing_dates: true,
      duplicate_due_dates_allowed: false,
      collision_adjustments: collisionAdjustments,
      date_adjustments: dateAdjustments,
      monthly_anchor_day_preserved: true,
      rounding: "final_schedule_line_only",
      non_working_day_rule: normalized.non_working_day_rule,
      company_non_working_dates_supported: true,
    },
  };
}

function monthlyEquivalent(periodicAmount, frequency, intervalDays = null) {
  const amount = moneyValue(periodicAmount, 0) || 0;
  const normalized = normalizeFrequency(frequency);
  if (normalized === "weekly") {
    return Number(((amount * 52) / 12).toFixed(2));
  }
  if (normalized === "fortnightly") {
    return Number(((amount * 26) / 12).toFixed(2));
  }
  if (normalized === "custom") {
    const days = wholeNumber(intervalDays, 1, 365);
    if (!days) {
      throw new FinanceScheduleError(
        400,
        "Enter a valid custom payment interval between 1 and 365 days."
      );
    }
    return Number(((amount * 365.2425) / days / 12).toFixed(2));
  }
  return amount;
}

module.exports = {
  FinanceScheduleError,
  FREQUENCIES,
  NON_WORKING_RULES,
  applyNonWorkingRule,
  buildFinanceSchedule,
  dateValue,
  intervalDaysFor,
  monthlyEquivalent,
  normalizeNonWorkingDates,
  normalizeScheduleInput,
};
