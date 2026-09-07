const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MINIMUMS,
  applyRuntimeCostControl,
} = require("../services/runtimeCostControlBootstrap");

test("runtime cost controls do not apply outside production", () => {
  const env = {
    NODE_ENV: "test",
    EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS: "1000",
    EQUIPMENT_FINANCE_PAYMENT_MESSAGE_INTERVAL_MS: "1000",
    NOTIFICATION_SYNC_INTERVAL_MINUTES: "1",
    SMS_DELIVERY_POLL_INTERVAL_MS: "1000",
  };

  const result = applyRuntimeCostControl(env);

  assert.equal(result.applied, false);
  assert.equal(env.EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS, "1000");
  assert.equal(env.EQUIPMENT_FINANCE_PAYMENT_MESSAGE_INTERVAL_MS, "1000");
  assert.equal(env.NOTIFICATION_SYNC_INTERVAL_MINUTES, "1");
  assert.equal(env.SMS_DELIVERY_POLL_INTERVAL_MS, "1000");
});

test("production scheduler intervals are clamped to safe minimums", () => {
  const env = {
    NODE_ENV: "production",
    EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS: "1000",
    EQUIPMENT_FINANCE_PAYMENT_MESSAGE_INTERVAL_MS: "1000",
    NOTIFICATION_SYNC_INTERVAL_MINUTES: "5",
    SMS_DELIVERY_POLL_INTERVAL_MS: "1000",
  };

  const result = applyRuntimeCostControl(env);

  assert.equal(result.applied, true);
  assert.equal(Number(env.EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS), MINIMUMS.EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS);
  assert.equal(Number(env.EQUIPMENT_FINANCE_PAYMENT_MESSAGE_INTERVAL_MS), MINIMUMS.EQUIPMENT_FINANCE_PAYMENT_MESSAGE_INTERVAL_MS);
  assert.equal(Number(env.NOTIFICATION_SYNC_INTERVAL_MINUTES), MINIMUMS.NOTIFICATION_SYNC_INTERVAL_MINUTES);
  assert.equal(Number(env.SMS_DELIVERY_POLL_INTERVAL_MS), MINIMUMS.SMS_DELIVERY_POLL_INTERVAL_MS);
});

test("production scheduler intervals preserve deliberately slower settings", () => {
  const env = {
    NODE_ENV: "production",
    EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS: "600000",
    EQUIPMENT_FINANCE_PAYMENT_MESSAGE_INTERVAL_MS: "3600000",
    NOTIFICATION_SYNC_INTERVAL_MINUTES: "120",
    SMS_DELIVERY_POLL_INTERVAL_MS: "1800000",
  };

  applyRuntimeCostControl(env);

  assert.equal(env.EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS, "600000");
  assert.equal(env.EQUIPMENT_FINANCE_PAYMENT_MESSAGE_INTERVAL_MS, "3600000");
  assert.equal(env.NOTIFICATION_SYNC_INTERVAL_MINUTES, "120");
  assert.equal(env.SMS_DELIVERY_POLL_INTERVAL_MS, "1800000");
});
