"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const frontend = (file) => fs.readFileSync(path.join(root, "frontend/src", file), "utf8");
const backend = (file) => fs.readFileSync(path.join(root, "backend", file), "utf8");

test("Spare Parts auditor can access only Sales History, not selling or stock editing routes", () => {
  const routes = frontend("App.jsx");
  assert.match(routes, /path="sales-history"\s+element=\{rolePage\(\[\.\.\.businessWorkRoles, "auditor"\], <SalesHistoryPage \/>\)\}/);
  assert.match(routes, /path="new-sale"\s+element=\{rolePage\(businessWorkRoles, <NewSalePage \/>\)\}/);
  assert.match(routes, /path="products"\s+element=\{rolePage\(businessWorkRoles, <ProductsPage \/>\)\}/);
});

test("Auditor main navigation includes Sales History explicitly, not New Sale", () => {
  const nav = frontend("components/Layout.jsx");
  const auditorMenu = nav.slice(nav.indexOf("const mainWorkItems = isAuditor"), nav.indexOf("      : [", nav.indexOf("const mainWorkItems = isAuditor")));
  assert.match(auditorMenu, /title: "Sales History"/);
  assert.match(auditorMenu, /path: "\/sales-history"/);
  assert.match(auditorMenu, /Read-only review/);
  assert.doesNotMatch(auditorMenu, /path: "\/new-sale"/);
});

test("Auditor Sales History has date/product search, details, and receipt PDF without editing/void controls", () => {
  const page = frontend("pages/SalesHistoryPage.jsx");
  assert.match(page, /role === "auditor"/);
  assert.match(page, /Auditor read-only view/);
  assert.match(page, /axiosClient\.get\("\/sales"/);
  assert.match(page, /axiosClient\.get\(`\/sales\/\$\{saleId\}`\)/);
  assert.match(page, /axiosClient\.get\(`\/receipts\/sales\/\$\{saleId\}\/pdf`/);
  assert.match(page, /product_search: productSearch/);
  assert.match(page, /\bfrom,\s+to,/);
  assert.match(page, /isAdmin && !voided/);
  assert.match(page, /isAdmin && !isSaleVoided\(selectedReceipt\)/);
});

test("Backend auditors can inspect selected-store sales but cannot create, edit or void them", () => {
  const sales = backend("routes/saleRoutes.js");
  assert.match(sales, /router\.get\("\/", requireAuth/);
  assert.match(sales, /router\.get\("\/:id", requireAuth/);
  assert.match(sales, /AND s\.branch_id = \?/);
  assert.match(sales, /String\(req\.user\?\.role \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "auditor"/);
  assert.match(sales, /code: "AUDITOR_SALES_READ_ONLY"/);
  assert.match(sales, /router\.put\("\/:id", requireAuth, requireRole\("admin"\)/);
  assert.match(sales, /requireRole\("admin"\)/);
});

test("Auditor receipt PDF requests cannot access sales from other branches", () => {
  const route = backend("routes/receiptRoutes.js");
  assert.match(route, /String\(req\.user\?\.role \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "auditor"/);
  assert.match(route, /Number\(sale\.branch_id\) !== selectedBranchId/);
  assert.match(route, /Receipt not found in the selected store/);
  assert.match(route, /router\.get\("\/sales\/:id\/pdf", requireAuth/);
});
