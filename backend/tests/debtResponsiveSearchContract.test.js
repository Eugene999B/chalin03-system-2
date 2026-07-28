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
  assert.match(serviceWorker, /chalin03-mobile-debt-contrast-v13/);
});

test("premium debt dashboard uses compact desktop cards and mobile stacking", () => {
  const responsiveCss = read(
    "frontend",
    "public",
    "debt-responsive-hotfix.css"
  );

  assert.match(responsiveCss, /\.customer-debt-consolidation-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,/);
  assert.match(responsiveCss, /\.customer-debt-consolidation-card\s*\{[\s\S]*border-radius:\s*23px/);
  assert.match(responsiveCss, /\.customer-debt-consolidation-heading\s*\{[\s\S]*linear-gradient/);
  assert.match(responsiveCss, /@media \(max-width: 720px\)/);
  assert.match(responsiveCss, /@media \(max-width: 460px\)/);
  assert.match(responsiveCss, /prefers-reduced-motion/);
});

test("mobile outstanding balance keeps guaranteed high contrast", () => {
  const contrastCss = read(
    "frontend",
    "public",
    "debt-mobile-contrast-hotfix.css"
  );
  const indexHtml = read("frontend", "index.html");
  const serviceWorker = read("frontend", "public", "sw.js");

  assert.match(contrastCss, /background-color:\s*#08253f\s*!important/);
  assert.match(contrastCss, /opacity:\s*1\s*!important/);
  assert.match(contrastCss, /color:\s*#ffffff\s*!important/);
  assert.match(contrastCss, /@media \(max-width: 720px\)/);
  assert.match(indexHtml, /debt-mobile-contrast-hotfix\.css/);
  assert.match(serviceWorker, /debt-mobile-contrast-hotfix\.css/);
});
