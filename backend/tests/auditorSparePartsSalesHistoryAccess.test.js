"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"../..");
const frontend=file=>fs.readFileSync(path.join(root,"frontend/src",file),"utf8");
const backend=file=>fs.readFileSync(path.join(root,"backend",file),"utf8");

test("Spare Parts auditor has the explicitly requested store-operational and blind-count pages",()=>{
 const app=frontend("App.jsx");
 assert.match(app,/const businessWorkRoles = \["admin", "manager", "cashier", "auditor"\]/);
 assert.match(app,/path="sales-history"/);
 assert.match(app,/path="new-sale"/);
 assert.match(app,/path="products"/);
 assert.match(app,/path="stock-count"/);
 assert.match(app,/<SparePartsBlindCountPage \/>/);
});
test("Auditor navigation includes stock work and investigation exports",()=>{
 const nav=frontend("components/Layout.jsx");
 const auditorMenu=nav.slice(nav.indexOf("const mainWorkItems = isAuditor"),nav.indexOf("      : [",nav.indexOf("const mainWorkItems = isAuditor")));
 assert.match(auditorMenu,/path: "\/new-sale"/);
 assert.match(auditorMenu,/path: "\/products"/);
 assert.match(auditorMenu,/path: "\/sales-history"/);
 assert.match(nav,/path: "\/stock-count"/);
 assert.match(nav,/path: "\/exports"/);
});
test("Sales creation retains strict validation and selected store scoping",()=>{
 const sales=backend("routes/saleRoutes.js");
 assert.match(sales,/router\.post\("\/", requireAuth, validateRequest\(validateSaleCreateRequest\)/);
 assert.match(sales,/requireSelectedBranch\(req, res\)/);
 assert.doesNotMatch(sales,/AUDITOR_SALES_READ_ONLY/);
 assert.match(sales,/requireRole\("admin"\)/);
});
test("Auditors can inspect and download receipts without permission to void them",()=>{
 const page=frontend("pages/SalesHistoryPage.jsx");
 assert.match(page,/role === "auditor"/);
 assert.match(page,/axiosClient\.get\("\/sales"/);
 assert.match(page,/axiosClient\.get/);
 assert.match(page,/\/receipts\/sales\//);
 assert.match(page,/isAdmin && !voided/);
 assert.match(page,/isAdmin && !isSaleVoided\(selectedReceipt\)/);
});
test("Auditor receipt PDF remains restricted to selected store",()=>{
 const route=backend("routes/receiptRoutes.js");
 assert.match(route,/Number\(sale\.branch_id\) !== selectedBranchId/);
 assert.match(route,/Receipt not found in the selected store/);
 assert.match(route,/router\.get\("\/sales\/:id\/pdf", requireAuth/);
});
