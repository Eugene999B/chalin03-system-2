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
  if (!Array.isArray(items) || items.length === 0) {
    return "No items recorded - see receipt";
  }
  const labels = items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const name = String(item.product_name || "Unnamed product")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `${quantity} x ${name}`;
  });
  // Keep the overview readable on mobile. The item worksheet preserves every
  // historic item and exact price without truncation.
  const preview = [];
  let used = 0;
  for (const label of labels) {
    if (preview.length >= 4 || used + label.length > 175) break;
    preview.push(label);
    used += label.length + 3;
  }
  if (preview.length === 0) preview.push(labels[0].slice(0, 120));
  const remaining = labels.length - preview.length;
  return escapeExcelText(
    preview.join("; ") +
      (remaining > 0 ? ` (+${remaining} more - see Purchased Items sheet)` : "")
  );
}

/** True count/quantity headers must never be printed with a GHS currency mask. */
function isExplicitQuantityHeader(header) {
  return /\b(?:quantity|qty|units? bought|units? purchased|product lines|item count|number of items|discounted sales count|sales count|receipt count)\b/i.test(
    String(header || "")
  );
}

module.exports = { isAdminAuthorized, isValidDate, isValidDateRange, escapeExcelText, discountPercent, describeSaleItems, isExplicitQuantityHeader };
