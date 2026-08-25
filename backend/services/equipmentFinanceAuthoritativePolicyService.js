function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function ghanaToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function agreementLateFeePolicy(agreement) {
  const type = String(agreement?.late_charge_type_snapshot || 'none').toLowerCase();
  return {
    type: ['none', 'fixed', 'percentage'].includes(type) ? type : 'none',
    value: Math.max(number(agreement?.late_charge_value_snapshot), 0),
    cap: Math.max(number(agreement?.late_charge_cap_snapshot), 0),
    graceDays: Math.max(Math.floor(number(agreement?.grace_days_snapshot)), 0),
    version: agreement?.policy_version_snapshot || null,
    legacyReviewRequired: String(agreement?.policy_version_snapshot || '').startsWith('LEGACY-REVIEW-'),
  };
}

function calculateProspectiveLateFee({ agreement, overdueBalance, alreadyApplied = 0 }) {
  const policy = agreementLateFeePolicy(agreement);
  const base = Math.max(number(overdueBalance), 0);
  const applied = Math.max(number(alreadyApplied), 0);
  if (policy.legacyReviewRequired || !base || !policy.value || policy.type === 'none') return 0;

  let fee = policy.type === 'percentage' ? (base * policy.value) / 100 : policy.value;
  if (policy.cap > 0) fee = Math.min(fee, policy.cap);
  fee = Math.max(Number(fee.toFixed(2)), 0);

  // Never advertise another fee when the contractual fee has already been
  // applied to the same overdue installment. This is deliberately based on
  // the persisted schedule late-charge amount, not a second calculation.
  if (applied > 0) return 0;
  return fee;
}

function nextDueFromSchedule(scheduleRows = [], today = ghanaToday()) {
  const candidates = scheduleRows
    .map((row) => {
      const dueDate = normalizeDate(row?.due_date);
      const remaining = Math.max(
        number(row?.scheduled_amount) + number(row?.late_charge_amount) -
          number(row?.waived_charge_amount) - number(row?.amount_paid),
        0
      );
      return { row, dueDate, remaining };
    })
    .filter((item) => item.remaining > 0.01 && item.dueDate && item.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || number(a.row?.sequence_number) - number(b.row?.sequence_number));

  return candidates[0] || null;
}

function describeDueDate({ row, today = ghanaToday(), agreement }) {
  if (!row) return { date: null, amount: 0, status: 'not_scheduled', lateFeeWarningAmount: 0 };
  const dueDate = normalizeDate(row.due_date);
  const remaining = Math.max(
    number(row.scheduled_amount) + number(row.late_charge_amount) -
      number(row.waived_charge_amount) - number(row.amount_paid),
    0
  );
  const lateFeeWarningAmount = dueDate && dueDate < today
    ? calculateProspectiveLateFee({ agreement, overdueBalance: remaining, alreadyApplied: row.late_charge_amount })
    : 0;

  return {
    date: dueDate,
    amount: Number(remaining.toFixed(2)),
    status: dueDate < today ? 'overdue' : dueDate === today ? 'due_today' : 'upcoming',
    lateFeeWarningAmount,
    daysUntilDue: dueDate ? Math.round((new Date(`${dueDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000) : null,
  };
}

module.exports = {
  agreementLateFeePolicy,
  calculateProspectiveLateFee,
  describeDueDate,
  ghanaToday,
  nextDueFromSchedule,
  normalizeDate,
};
