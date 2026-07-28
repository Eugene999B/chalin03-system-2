const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

test("customer debt modal stays above navigation and supports mobile", () => {
  const source = read(
    "frontend",
    "src",
    "components",
    "CustomerDebtConsolidationPanel.jsx"
  );
  const responsiveCss = read(
    "frontend",
    "public",
    "debt-responsive-hotfix.css"
  );
  const indexHtml = read("frontend", "index.html");

  assert.match(source, /customer-debt-detail-backdrop/);
  assert.match(source, /customer-debt-detail-content/);
  assert.match(source, /customer-debt-close-button/);
  assert.match(source, /aria-modal="true"/);
  assert.match(responsiveCss, /z-index:\s*100000/);
  assert.match(responsiveCss, /height:\s*100dvh/);
  assert.match(responsiveCss, /max-height:\s*100dvh/);
  assert.match(responsiveCss, /position:\s*sticky/);
  assert.match(indexHtml, /debt-responsive-hotfix\.css/);
});

test("debt and merge searches expose identifying information", () => {
  const source = read(
    "frontend",
    "src",
    "components",
    "CustomerDebtConsolidationPanel.jsx"
  );
  const serviceWorker = read("frontend", "public", "sw.js");

  assert.match(source, /Search Master Customer/);
  assert.match(source, /Search Duplicate Customer/);
  assert.match(source, /Search This Customer's Debt Records/);
  assert.match(source, /customer\.customer_id/);
  assert.match(source, /customer\.customer_phone/);
  assert.match(source, /customer\.customer_location/);
  assert.match(source, /Receipt, item, staff, payment method or amount/);
  assert.match(serviceWorker, /debt-responsive-hotfix\.css/);
  assert.match(serviceWorker, /chalin03-customer-debt-statement-v11/);
});
