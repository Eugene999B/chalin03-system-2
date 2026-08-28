import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const layout = read("src/layouts/InstallmentFinanceLayout.jsx");
const start = read("src/pages/EquipmentFinancePhaseThreeStartRedirectPage.jsx");
const photo = read("src/components/EquipmentFinanceCustomerPhotoPanel.jsx");
const modalCss = read("src/styles/financeUiRealFix.css");
const nextDue = read("src/utils/installmentFinanceNextDue.js");

assert.match(layout, /installmentFinanceNextDue\.js/);
assert.match(layout, /financeUiRealFix\.css/);
assert.match(start, /EquipmentFinanceCustomerPhotoPanel/);
assert.match(photo, /Customer Photo <em>\(Optional\)<\/em>/);
assert.match(photo, /Add optional photo/);
assert.match(photo, /accept="image\/\*"/);
assert.match(modalCss, /\.finance-simple__dialog-backdrop/);
assert.match(modalCss, /left: 300px !important/);
assert.match(modalCss, /@media \(max-width: 960px\)/);
assert.match(nextDue, /nextDueFromSchedule/);
assert.match(nextDue, /next_installment_due_date/);
assert.match(nextDue, /schedule_status/);

console.log("finance UI real-fix contract checks passed");
