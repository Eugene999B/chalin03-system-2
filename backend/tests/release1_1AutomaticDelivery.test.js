const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function read(relativePath) {
  return readFileSync(join(__dirname, "..", relativePath), "utf8");
}

test("Release 1.1 sends an Arkesel callback URL and accepts query callbacks", () => {
  const serviceSource = read("services/smsService.js");
  const routeSource = read("routes/smsRoutes.js");

  assert.match(serviceSource, /payload\.callback_url = callbackUrl/);
  assert.match(routeSource, /req\.query/);
  assert.match(routeSource, /router\.get\(\s*"\/delivery-report"/);
  assert.match(routeSource, /router\.post\(\s*"\/delivery-report"/);
});

test("Release 1.1 starts automatic Arkesel batch status polling", () => {
  const serverSource = read("server.js");
  const syncSource = read("services/smsDeliveryStatusService.js");

  assert.match(serverSource, /startSmsDeliveryStatusSync\(\)/);
  assert.match(syncSource, /\/api\/v2\/sms\/message-reports/);
  assert.match(syncSource, /setInterval/);
  assert.match(syncSource, /msg_ids/);
});

test("SMS page updates delivery evidence automatically without a staff tick", () => {
  const frontendSource = read("../frontend/src/pages/SmsPage.jsx");

  assert.match(frontendSource, /window\.setInterval/);
  assert.match(frontendSource, /updates automatically from Arkesel/i);
  assert.doesNotMatch(frontendSource, /Mark Delivered|Confirm Delivery/);
});
