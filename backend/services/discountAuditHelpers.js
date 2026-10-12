"use strict";

/** Pure, production-safe helpers for the owner discount investigation export. */
function isAdminAuthorized(user) {
  return String(user?.role || "").trim().toLowerCase() === "admin";
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidDateRange(from, to) {
  return (!from || isValidDate(from)) && (!to || isValidDate(to)) &&
    (!from || !to || from <= to);
}

function escapeExcelText(value) {
  const text = value == null ? "" : String(value).trim();
  // Excel may interpret user-supplied cell text beginning with these as a formula.
  return /^[=+@-]/.test(text) ? "'" + text : text;
}

function discountPercent(discount, subtotal) {
  const gross = Number(subtotal);
  const amount = Number(discount);
  if (!Number.isFinite(gross) || gross <= 0 || !Number.isFinite(amount)) return null;
  return Number((amount / gross * 100).toFixed(2));
}

module.exports = { isAdminAuthorized, isValidDate, isValidDateRange, escapeExcelText, discountPercent };
