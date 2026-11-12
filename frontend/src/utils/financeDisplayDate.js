// Finance calendar dates are day-only obligations, not local-midnight timestamps.
// Never render an object as "[object Object]" or shift a due date by time zone.
export function financeDateOnly(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (value && typeof value === "object") {
    // Some responses wrap a SQL DATE; only accept explicitly named date fields.
    for (const key of ["date", "due_date", "value", "iso"]) {
      if (value[key] != null) {
        const normalized = financeDateOnly(value[key]);
        if (normalized) return normalized;
      }
    }
    return null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(String(value).trim());
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== match[1]
    ? null : match[1];
}

export function financeDateLabel(value, fallback = "Not scheduled") {
  const date = financeDateOnly(value);
  if (!date) return fallback;
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GH", {
    timeZone: "UTC", year: "numeric", month: "short", day: "2-digit",
  });
}

const TERMINAL = new Set(["paid", "cancelled", "waived", "rescheduled"]);

export function earliestUnpaidFinancePeriod(schedule) {
  if (!Array.isArray(schedule)) return null;
  return schedule
    .filter((row) => {
      const status = String(row?.schedule_status || "").toLowerCase();
      const remaining = Number(row?.scheduled_amount || 0)
        + Number(row?.late_charge_amount || 0)
        - Number(row?.waived_charge_amount || 0)
        - Number(row?.amount_paid || 0);
      return financeDateOnly(row?.due_date) && !TERMINAL.has(status)
        && remaining > 0.005;
    })
    .sort((left, right) =>
      financeDateOnly(left.due_date).localeCompare(financeDateOnly(right.due_date))
      || Number(left.sequence_number || 0) - Number(right.sequence_number || 0)
    )[0] || null;
}
