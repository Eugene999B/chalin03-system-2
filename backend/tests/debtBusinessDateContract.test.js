const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

test("Debt Desk separates credit and due dates using Ghana business time", () => {
  const source = read("frontend", "src", "pages", "LegacyDebtsPage.jsx");
  const wrapper = read("frontend", "src", "pages", "DebtsPage.jsx");
  const saleRoutes = read("backend", "routes", "saleRoutes.js");

  assert.match(wrapper, /LegacyDebtsPage/);
  assert.match(source, /formatBusinessDate/);
  assert.match(source, /function dateLabel\(value\)/);
  assert.match(source, /dateLabel\(debt\.sale_date \|\| debt\.created_at\)/);
  assert.match(source, /dateLabel\(debt\.due_date\)/);
  assert.match(source, />Due</);
  assert.match(source, /Credit receipts/);
  assert.doesNotMatch(source, /date\.toLocaleDateString\(\)/);
  assert.doesNotMatch(source, /date\.toLocaleString\(\)/);
  assert.match(saleRoutes, /setUTCDate\(date\.getUTCDate\(\) \+ days\)/);
});

test("business date helper preserves Ghana calendar dates", async () => {
  const moduleUrl = pathToFileURL(
    path.join(root, "frontend", "src", "utils", "businessDate.js")
  ).href;
  const { BUSINESS_TIME_ZONE, formatBusinessDate, formatBusinessDateTime } =
    await import(`${moduleUrl}?debt-date-test=1`);

  assert.equal(BUSINESS_TIME_ZONE, "Africa/Accra");
  assert.equal(formatBusinessDate("2026-07-27"), "27 Jul 2026");

  const timestamp = formatBusinessDateTime("2026-07-27T16:30:00Z");
  assert.match(timestamp, /27 Jul 2026/);
  assert.match(timestamp, /04:30/i);
});
