const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applySmsStatusTransition,
  buildSmsEvidence,
  estimateSmsSegments,
  extractProviderMessageId,
  normalizeSmsDeliveryStatus,
} = require("../services/smsReliabilityService");
const { normalizeGhanaPhone } = require("../services/smsService");

test("Ghana phone numbers are normalized without changing the destination", () => {
  assert.equal(normalizeGhanaPhone("024 123 4567"), "+233241234567");
  assert.equal(normalizeGhanaPhone("233241234567"), "+233241234567");
  assert.equal(normalizeGhanaPhone("+233 24 123 4567"), "+233241234567");
  assert.equal(normalizeGhanaPhone("12345"), "");
});

test("SMS segment estimates distinguish GSM and Unicode messages", () => {
  assert.equal(estimateSmsSegments("A".repeat(160)).segment_count, 1);
  assert.equal(estimateSmsSegments("A".repeat(161)).segment_count, 2);
  assert.equal(estimateSmsSegments("🙂".repeat(70)).segment_count, 1);
  assert.equal(estimateSmsSegments("🙂".repeat(71)).segment_count, 2);
});

test("provider acceptance is not converted into delivered", () => {
  const evidence = buildSmsEvidence({
    provider: "arkesel",
    senderId: "CHALIN 03",
    message: "Test message",
    providerResponse: {
      status: "success",
      data: { message_id: "ark-123" },
    },
  });

  assert.equal(evidence.status, "accepted");
  assert.equal(evidence.provider_message_id, "ark-123");
  assert.equal(extractProviderMessageId({ data: { id: 55 } }), "55");
});

test("delivery report statuses remain explicit", () => {
  assert.equal(normalizeSmsDeliveryStatus("delivered"), "delivered");
  assert.equal(normalizeSmsDeliveryStatus("undelivered"), "undelivered");
  assert.equal(normalizeSmsDeliveryStatus("expired"), "expired");
  assert.equal(normalizeSmsDeliveryStatus("queued"), "accepted");
  assert.equal(normalizeSmsDeliveryStatus("prohibited"), "undelivered");
  assert.equal(normalizeSmsDeliveryStatus("mystery"), "delivery_unknown");
});


test("delivery status transitions never downgrade final evidence", () => {
  assert.equal(applySmsStatusTransition("delivered", "accepted"), "delivered");
  assert.equal(applySmsStatusTransition("undelivered", "accepted"), "undelivered");
  assert.equal(applySmsStatusTransition("accepted", "delivered"), "delivered");
  assert.equal(applySmsStatusTransition("pending", "accepted"), "accepted");
});
