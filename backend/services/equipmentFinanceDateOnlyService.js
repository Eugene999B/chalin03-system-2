"use strict";

/**
 * MySQL DATE fields can arrive as native JS Date objects or yyyy-mm-dd strings.
 * String(date).slice(0,10) returns 'Thu Oct 15' and breaks the Finance
 * reconciliation date evidence, generating an artificial 30-day fallback.
 * Preserve the database calendar date in a strict normalized yyyy-mm-dd form.
 */
function dateOnly(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(text);
  if (!match || match[1].startsWith("0000-")) return null;
  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== match[1] ? null : match[1];
}
module.exports = { dateOnly };
