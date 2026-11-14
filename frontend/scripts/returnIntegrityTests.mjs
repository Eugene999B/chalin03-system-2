import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const page = read("src/pages/ReturnsPage.jsx");
const panel = read("src/components/MultiItemReturnPanel.jsx");
const accounting = read("src/pages/AdvancedAccountingIntelligencePage.jsx");

assert.match(page, /loadSaleItems\(selectedSaleId\), loadSales\(\)/);
assert.match(panel, /active_refund_request_count/);
assert.match(panel, /pending_return_quantity/);
assert.match(panel, /active_refund_request_codes/);
assert.match(panel, /Pending approval/);
assert.match(accounting, /title: "Refunds"/);
assert.match(accounting, /Net After Refunds Before Stock Cost/);

assert.match(page, /refundQuote/);
assert.match(page, /refund-quote/);
assert.match(page, /maximum_refund/);
assert.match(page, /quoteMatches/);
assert.match(page, /refundQuoteError/);
assert.doesNotMatch(page, /refundAmount - historicalGrossEstimate/);
assert.match(panel, /refundQuotes/);
assert.match(panel, /quoteKey/);
assert.match(panel, /verifiedQuote/);
assert.match(panel, /maximum_refund/);
assert.match(panel, /amount_collected_available/);
assert.match(panel, /not automatically rolled back/);
assert.doesNotMatch(panel, /const maximum =\s*line\.unit_price \* quantity/);

console.log("Returns integrity frontend contract passed.");
