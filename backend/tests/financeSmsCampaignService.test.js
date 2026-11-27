const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CAMPAIGN_ID,
  DEFAULT_MESSAGE,
  buildFinanceRecipients,
  sourceReference,
  validMobile,
  maskPhone,
} = require("../services/financeSmsCampaignService");

test("finance SMS campaign remains a specific, approved offer", () => {
  assert.equal(CAMPAIGN_ID, "excavator-discount-2026-11");
  assert.match(DEFAULT_MESSAGE, /excavator/i);
  assert.match(DEFAULT_MESSAGE, /ready.cash/i);
  assert.match(DEFAULT_MESSAGE, /installment/i);
  assert.match(DEFAULT_MESSAGE, /discount/i);
  assert.match(DEFAULT_MESSAGE, /024 946 9080/);
  assert.ok(DEFAULT_MESSAGE.length <= 480);
});

test("rejects 9-digit local phone and invalid Ghana formats", () => {
  assert.equal(validMobile("055952921"), "");
  assert.equal(validMobile("0559529212"), "+233559529212");
  assert.equal(validMobile("+233559529212"), "+233559529212");
  assert.equal(validMobile("233559529212"), "+233559529212");
  assert.equal(validMobile("0240000000"), "+233240000000");
  assert.equal(validMobile("0123456789"), "");
  assert.equal(validMobile("not a phone"), "");
});

test("build Finance audience from registered customers and deduplicate by phone", () => {
  const result = buildFinanceRecipients([
    { customer_id: 1, customer_name: "First", phone: "0240000000", portfolio_status: "active" },
    { customer_id: 2, customer_name: "Duplicate", phone: "+233240000000", portfolio_status: "completed" },
    { customer_id: 3, customer_name: "Invalid", phone: "055952921" },
    { customer_id: 4, customer_name: "Second", phone: "0559529212", portfolio_status: "application_only" },
    { customer_id: 5, customer_name: "No number", phone: null },
  ]);
  assert.equal(result.recipients.length, 2);
  assert.equal(result.duplicate_count, 1);
  assert.equal(result.invalid_count, 2);
  assert.deepEqual(result.recipients.map((x) => x.customer_id), [1, 4]);
  assert.deepEqual(result.recipients.map((x) => x.phone), ["+233240000000", "+233559529212"]);
});

test("campaign idempotency key is stable per phone and never leaks the number", () => {
  const first = sourceReference("+233240000000");
  assert.equal(first, sourceReference("+233240000000"));
  assert.notEqual(first, sourceReference("+233559529212"));
  assert.ok(first.startsWith("finance-promo:excavator-discount-2026-11:"));
  assert.doesNotMatch(first, /240000000/);
  assert.equal(maskPhone("+233240000000"), "+23324****000");
});
