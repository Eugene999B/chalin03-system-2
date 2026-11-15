import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(frontend, path), "utf8");
const page = read("src/pages/EquipmentFinanceReadyCashPage.jsx");
const css = read("src/styles/equipmentFinanceReadyCash.css");
const entry = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const nav = read("src/layouts/InstallmentFinanceLayout.jsx");

assert.match(entry, /stage === "ready-cash"/);
assert.match(nav, /Ready Cash · Full Payment/);
assert.match(page, /phase-one\/bootstrap/);
assert.match(page, /ready-cash\/recent/);
assert.match(page, /ready-cash\/checkout/);
assert.match(page, /\/handover/);
assert.match(page, /isAvailable\(machine\)/);
assert.match(page, /cash_received_confirmed: true/);
assert.match(page, /customer_terms_accepted: true/);
assert.match(page, /idempotency_key: key/);
assert.match(page, /cashReceived/);
assert.match(page, /signedConfirmed/);
assert.match(page, /ownership_status === "transferred"/);
assert.match(page, /No discounts and no financing/);
assert.match(css, /@media\(max-width:650px\)/);
console.log("Ready Cash UI contract passed.");