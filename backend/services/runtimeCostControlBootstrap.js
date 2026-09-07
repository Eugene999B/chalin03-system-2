const MINIMUMS = Object.freeze({
  // Safe floors for non-critical background work; critical user actions stay synchronous.
  EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS: 5 * 60 * 1000,
  EQUIPMENT_FINANCE_PAYMENT_MESSAGE_INTERVAL_MS: 15 * 60 * 1000,
  NOTIFICATION_SYNC_INTERVAL_MINUTES: 60,
  SMS_DELIVERY_POLL_INTERVAL_MS: 10 * 60 * 1000,
});

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function enforceMinimum(env, key, minimum) {
  const raw = Number(env[key]);
  const effective = Number.isFinite(raw) && raw > 0
    ? Math.max(raw, minimum)
    : minimum;
  env[key] = String(effective);
  return effective;
}

function applyRuntimeCostControl(env = process.env) {
  if (!isProduction(env)) return { applied: false, production: false };

  const applied = {};
  for (const [key, minimum] of Object.entries(MINIMUMS)) {
    applied[key] = enforceMinimum(env, key, minimum);
  }
  return { applied: true, production: true, ...applied };
}

const runtimeCostState = applyRuntimeCostControl();

if (runtimeCostState.applied) {
  console.log(
    `Runtime cost controls: boss=${Math.round(runtimeCostState.EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS / 60000)}m, ` +
    `payment=${Math.round(runtimeCostState.EQUIPMENT_FINANCE_PAYMENT_MESSAGE_INTERVAL_MS / 60000)}m, ` +
    `notifications=${Math.round(runtimeCostState.NOTIFICATION_SYNC_INTERVAL_MINUTES)}m, ` +
    `sms_delivery=${Math.round(runtimeCostState.SMS_DELIVERY_POLL_INTERVAL_MS / 60000)}m.`
  );
}

module.exports = {
  MINIMUMS,
  applyRuntimeCostControl,
  enforceMinimum,
  isProduction,
};
