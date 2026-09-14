import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const wrapper = fs.readFileSync(
  path.join(root, "src/pages/DebtsPage.jsx"),
  "utf8"
);
const page = fs.readFileSync(
  path.join(root, "src/pages/LegacyDebtsPage.jsx"),
  "utf8"
);
const history = fs.readFileSync(
  path.join(root, "src/components/DebtPaymentHistory.jsx"),
  "utf8"
);
const styles = fs.readFileSync(
  path.join(root, "src/styles/debtPaymentHistory.css"),
  "utf8"
);

assert.match(wrapper, /LegacyDebtsPage/);
assert.match(page, /DebtPaymentHistory/);
assert.match(page, /debts=\{selected\.debts\}/);
assert.match(page, /customer=\{selected\.customer\}/);
assert.match(page, /onError=\{setError\}/);

assert.match(history, /Print thermal receipt/);
assert.match(history, /@page\{size:80mm auto/);
assert.match(history, /Payment ID/);
assert.match(history, /Sale receipt/);
assert.match(history, /Received by/);
assert.match(history, /paymentEvidence/);
assert.match(history, /DEBT-PAY-/);

assert.match(styles, /@media \(max-width: 700px\)/);
assert.match(styles, /grid-column: 1 \/ -1/);
assert.match(styles, /width: 100%/);

console.log("Credit-return debt and historical thermal receipt UI contracts passed.");
