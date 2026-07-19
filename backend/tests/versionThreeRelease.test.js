const assert = require("node:assert/strict");
const test = require("node:test");

const {
  APP_RELEASE_LABEL,
  APP_RELEASE_NAME,
  APP_VERSION,
} = require("../config/version");

test("Version Three release identity is stable", () => {
  assert.equal(APP_VERSION, "3.0.0");
  assert.equal(APP_RELEASE_NAME, "Version Three");
  assert.equal(APP_RELEASE_LABEL, "Version Three · v3.0.0");
});
