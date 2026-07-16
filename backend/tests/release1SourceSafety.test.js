const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function read(relativePath) {
  return readFileSync(join(__dirname, "..", relativePath), "utf8");
}

test("product detail editing cannot directly update quantity", () => {
  const source = read("routes/productRoutes.js");
  const updateStart = source.indexOf("// PUT /api/products/:id");
  const restockStart = source.indexOf("// POST /api/products/:id/restock");
  const updateSection = source.slice(updateStart, restockStart);

  assert.match(updateSection, /STOCK_CHANGE_REQUIRES_MOVEMENT/);
  assert.doesNotMatch(updateSection, /SET\s+[\s\S]*quantity\s*=\s*\?/i);
  assert.match(source, /\/\:id\/restock/);
  assert.match(source, /movement_type/);
});

test("daily closing reports provider acceptance separately from delivery", () => {
  const source = read("routes/dailyClosingRoutes.js");
  assert.match(source, /accepted by the provider; phone delivery is still pending confirmation/);
  assert.doesNotMatch(source, /Boss daily summary SMS sent\./);
});


test("provider acceptance survives SMS evidence logging errors", () => {
  const source = read("routes/smsRoutes.js");
  assert.match(source, /updateSmsLogSafely/);
  assert.match(source, /log_update_warning/);
  assert.match(source, /result = await sendSms/);
});
