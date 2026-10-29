import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const layout = read("src/layouts/InstallmentFinanceLayout.jsx");
const start = read("src/pages/EquipmentFinanceStartInstallmentPage.jsx");
const router = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const photo = read("src/components/CustomerPortrait.jsx");
const modalCss = read("src/styles/financeUiRealFix.css");
const startCss = read("src/styles/equipmentFinanceStartInstallment.css");
const nextDue = read("src/utils/installmentFinanceNextDue.js");

assert.match(layout, /installmentFinanceNextDue\.js/);
assert.match(layout, /financeUiRealFix\.css/);
assert.match(router, /stage === "start"\) return <EquipmentFinanceStartInstallmentPage \/>/);
assert.match(start, /Customer identity photo/);
assert.match(start, /customer_photo:/);
assert.match(start, /CustomerPortraitPicker/);
assert.match(start, /photoKey/);
assert.match(photo, /CustomerPortrait/);
assert.match(photo, /accept="image\/\*"/);
assert.match(modalCss, /\.finance-simple__dialog-backdrop/);
assert.match(startCss, /\.c03-start2-page/);
assert.match(startCss, /\.c03-start2-hero/);
assert.match(startCss, /\.c03-start2-steps/);
assert.match(nextDue, /nextDueFromSchedule/);
assert.match(nextDue, /next_installment_due_date/);
assert.match(nextDue, /schedule_status/);

console.log("finance UI real-fix contract checks passed");
