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

/**
 * Display purchased products alongside each discounted receipt. Item-level prices
 * come from the historical sale_items snapshot, NOT today's product catalogue.
 * An overall sale discount must never be misrepresented as an item discount.
 */
function describeSaleItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "No recorded items — review receipt";
  const lines = items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price || 0);
    const lineTotal = Number(item.line_total || 0);
    const productName = String(item.product_name || "Unnamed product").replace(/[\r\n]+/g, " ").trim();
    return `${quantity} × ${productName} @ GHS ${unitPrice.toFixed(2)} = GHS ${lineTotal.toFixed(2)}`;
  });
  // Excel cells cannot exceed 32,767 characters. Never silently omit items:
  // the full product list remains available on the separate item worksheet.
  const value = lines.join("\n");
  if (value.length <= 32000) return escapeExcelText(value);
  return escapeExcelText(value.slice(0, 31900) + "\n[Long item list — see Products in Discounted Sales worksheet for full detail]");
}

module.exports = { isAdminAuthorized, isValidDate, isValidDateRange, escapeExcelText, discountPercent, describeSaleItems };
