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
  const css = read(
    "frontend",
    "src",
    "styles",
    "customerDebtConsolidation.css"
  );

  assert.match(source, /customer-debt-detail-backdrop/);
  assert.match(source, /customer-debt-detail-content/);
  assert.match(source, /customer-debt-close-button/);
  assert.match(source, /aria-modal="true"/);
  assert.match(css, /z-index:\s*100000/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /max-height:\s*100dvh/);
  assert.match(css, /position:\s*sticky/);
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
  assert.match(
    serviceWorker,
    /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
  );
  assert.match(serviceWorker, /isBuildAssetRequest\(request, url\)/);
  assert.match(serviceWorker, /X-Chalin03-Asset-Mismatch/);
  assert.doesNotMatch(serviceWorker, /debt-responsive-hotfix\.css/);
  assert.doesNotMatch(serviceWorker, /debt-mobile-contrast-hotfix\.css/);
});

test("bundled debt dashboard uses compact desktop cards and mobile stacking", () => {
  const css = read(
    "frontend",
    "src",
    "styles",
    "customerDebtConsolidation.css"
  );

  assert.match(
    css,
    /\.customer-debt-consolidation-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,/
  );
  assert.match(
    css,
    /\.customer-debt-consolidation-card\s*\{[\s\S]*border-radius:\s*22px/
  );
  assert.match(
    css,
    /\.customer-debt-consolidation-heading\s*\{[\s\S]*linear-gradient/
  );
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(max-width: 460px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("mobile outstanding balance keeps guaranteed high contrast in bundled CSS", () => {
  const css = read(
    "frontend",
    "src",
    "styles",
    "customerDebtConsolidation.css"
  );
  const indexHtml = read("frontend", "index.html");

  assert.match(css, /background:\s*#08253f/);
  assert.match(css, /background-image:\s*linear-gradient\(135deg, #06172b/);
  assert.match(css, /opacity:\s*1/);
  assert.match(css, /color:\s*#ffffff/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.doesNotMatch(indexHtml, /debt-responsive-hotfix\.css/);
  assert.doesNotMatch(indexHtml, /debt-mobile-contrast-hotfix\.css/);
});
