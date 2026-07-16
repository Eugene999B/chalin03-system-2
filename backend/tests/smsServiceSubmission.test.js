const test = require("node:test");
const assert = require("node:assert/strict");

const { sendSms } = require("../services/smsService");

function withSmsEnvironment(callback) {
  const keys = [
    "SMS_ENABLED",
    "SMS_PROVIDER",
    "SMS_SENDER_ID",
    "SMS_ARKESEL_API_KEY",
    "SMS_ARKESEL_BASE_URL",
    "SMS_TIMEOUT_MS",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;

  process.env.SMS_ENABLED = "true";
  process.env.SMS_PROVIDER = "arkesel";
  process.env.SMS_SENDER_ID = "CHALIN 03";
  process.env.SMS_ARKESEL_API_KEY = "test-key";
  process.env.SMS_ARKESEL_BASE_URL = "https://example.test/sms";
  process.env.SMS_TIMEOUT_MS = "1000";

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      global.fetch = previousFetch;
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test("Arkesel HTTP success is recorded as accepted, not delivered", async () => {
  await withSmsEnvironment(async () => {
    let requestBody;
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ status: "success", data: { message_id: "ark-789" } }),
      };
    };

    const result = await sendSms({
      to: "0241234567",
      message: "Release 1 test",
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.providerMessageId, "ark-789");
    assert.deepEqual(requestBody.recipients, ["233241234567"]);
    assert.equal(requestBody.sender, "CHALIN 03");
  });
});

test("explicit provider failure is not treated as an accepted submission", async () => {
  await withSmsEnvironment(async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: "failed", error: "Rejected" }),
    });

    await assert.rejects(
      () => sendSms({ to: "0241234567", message: "Rejected test" }),
      /not accepted/i
    );
  });
});
