"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAdminAuthorized, isValidDateRange, escapeExcelText, discountPercent,
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
