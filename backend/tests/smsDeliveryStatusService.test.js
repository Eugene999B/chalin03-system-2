const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildArkeselDeliveryCallbackUrl,
  fetchArkeselMessageReports,
  interpretArkeselReport,
  isAutomaticDeliveryReady,
} = require("../services/smsDeliveryStatusService");

test("Arkesel callback URL includes the protected token automatically", () => {
  const callbackUrl = buildArkeselDeliveryCallbackUrl({
    deliveryCallbackUrl:
      "https://api.chalin03.com/api/sms/delivery-report?source=arkesel",
    deliveryWebhookSecret: "secret-123",
  });

  const parsed = new URL(callbackUrl);

  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.searchParams.get("source"), "arkesel");
  assert.equal(parsed.searchParams.get("token"), "secret-123");
});

test("Arkesel batch reports use the official message-reports contract", async () => {
  let request;

  const response = await fetchArkeselMessageReports({
    messageIds: ["sms-1", "sms-2", "sms-1"],
    config: {
      arkeselApiKey: "test-key",
      arkeselReportsUrl:
        "https://sms.arkesel.com/api/v2/sms/message-reports",
      timeoutMs: 1_000,
    },
    fetchImpl: async (url, options) => {
      request = { url, options };

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "success",
            data: {
              "sms-1": { status: "DELIVERED" },
              "sms-2": { status: "QUEUED" },
            },
          }),
      };
    },
  });

  assert.equal(
    request.url,
    "https://sms.arkesel.com/api/v2/sms/message-reports"
  );
  assert.equal(request.options.headers["api-key"], "test-key");
  assert.deepEqual(JSON.parse(request.options.body), {
    msg_ids: ["sms-1", "sms-2"],
  });
  assert.equal(response.data["sms-1"].status, "DELIVERED");
});

test("Arkesel report statuses are normalized without false delivery claims", () => {
  assert.equal(
    interpretArkeselReport("sms-1", { status: "DELIVERED" })
      .normalized_status,
    "delivered"
  );
  assert.equal(
    interpretArkeselReport("sms-2", { status: "SUBMITTED" })
      .normalized_status,
    "accepted"
  );
  assert.equal(
    interpretArkeselReport("sms-3", { status: "NOT_DELIVERED" })
      .normalized_status,
    "undelivered"
  );
  assert.equal(
    interpretArkeselReport("sms-4", {
      status: "error",
      response: "message does not exist",
    }).lookup_error,
    true
  );
});

test("automatic polling is ready without requiring staff confirmation", () => {
  assert.equal(
    isAutomaticDeliveryReady({
      enabled: true,
      provider: "arkesel",
      arkeselApiKey: "key",
      arkeselReportsUrl:
        "https://sms.arkesel.com/api/v2/sms/message-reports",
      deliveryPollEnabled: true,
    }),
    true
  );
});
