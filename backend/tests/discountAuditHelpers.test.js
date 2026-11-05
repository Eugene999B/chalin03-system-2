"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAdminAuthorized, isValidDateRange, escapeExcelText, discountPercent, describeSaleItems, isExplicitQuantityHeader,
} = require("../services/discountAuditHelpers");

test("discount audit is restricted to true administrators, not auditors or managers", () => {
  assert.equal(isAdminAuthorized({ role: "admin" }), true);
  assert.equal(isAdminAuthorized({ role: "ADMIN" }), true);
  assert.equal(isAdminAuthorized({ role: "auditor" }), false);
  assert.equal(isAdminAuthorized({ role: "manager" }), false);
  assert.equal(isAdminAuthorized({ role: "staff", workspace_role: "admin" }), false);
  assert.equal(isAdminAuthorized(null), false);
});

test("discount audit validates all-history and bounded date ranges correctly", () => {
  assert.equal(isValidDateRange("", ""), true);
  assert.equal(isValidDateRange("2026-10-01", "2026-10-12"), true);
  assert.equal(isValidDateRange("2026-10-12", "2026-10-01"), false);
  assert.equal(isValidDateRange("2026-02-30", ""), false);
  assert.equal(isValidDateRange("2026-1-1", ""), false);
  assert.equal(isValidDateRange("2024-02-29", ""), true);
});

test("untrusted spreadsheet text cannot become formulas", () => {
  assert.equal(escapeExcelText("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(escapeExcelText("+cmd"), "'+cmd");
  assert.equal(escapeExcelText("@SUM(1)"), "'@SUM(1)");
  assert.equal(escapeExcelText("-1+2"), "'-1+2");
  assert.equal(escapeExcelText("  =HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(escapeExcelText("ordinary"), "ordinary");
  assert.equal(escapeExcelText(null), "");
});

test("discount percentage is computed from persisted sale-level gross and discount", () => {
  assert.equal(discountPercent(25, 100), 25);
  assert.equal(discountPercent(12.5, 200), 6.25);
  assert.equal(discountPercent(0, 100), 0);
  assert.equal(discountPercent(20, 0), null);
});

test("discount summary is compact but clearly identifies purchased products and quantities", () => {
  const result = describeSaleItems([
    { product_name: "Rice 5kg", quantity: 2, unit_price: 65, line_total: 130 },
    { product_name: "Cooking Oil", quantity: 1, unit_price: 40, line_total: 40 },
  ]);
  assert.equal(result, "2 x Rice 5kg; 1 x Cooking Oil");
  assert.equal(describeSaleItems([]), "No items recorded - see receipt");
});

test("products summary never invents a discount per item", () => {
  const item = { product_name: "Mixer", quantity: 1, unit_price: 200, line_total: 200 };
  assert.equal(describeSaleItems([item]), "1 x Mixer");
  assert.equal(discountPercent(50, 200), 25);
});

test("product lists prevent row overflow and link to the complete item worksheet", () => {
  const manyItems = Array.from({ length: 9 }, (_, n) => ({
    product_name: "Item " + (n + 1), quantity: 1,
  }));
  const preview = describeSaleItems(manyItems);
  assert.match(preview, /1 x Item 1/);
  assert.match(preview, /\(\+5 more - see Purchased Items sheet\)/);
  assert.doesNotMatch(preview, /Item 9/);
  assert.equal(describeSaleItems([{ product_name: "=HYPERLINK(1)\nspam", quantity: 1 }]), "1 x =HYPERLINK(1) spam");
});

test("quantities and staff counts cannot receive Ghana-cedi number formatting", () => {
  for (const header of ["Total Item Quantity", "Units Bought", "Quantity", "Product Lines", "Active Sales Count", "Voided Sales Count"]) {
    assert.equal(isExplicitQuantityHeader(header), true, header);
  }
  for (const header of ["Unit Price (GHS)", "Discount Amount (GHS)", "Final Sale Amount (GHS)", "Amount Paid (GHS)"]) {
    assert.equal(isExplicitQuantityHeader(header), false, header);
  }
});
