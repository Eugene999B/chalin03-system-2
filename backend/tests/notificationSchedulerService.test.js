const test = require("node:test");
const assert = require("node:assert/strict");

const {
  notificationSchedulerConfig,
  resetNotificationSchedulerForTests,
  runScheduledNotificationSync,
  startNotificationSyncScheduler,
} = require("../services/notificationSchedulerService");

test("notification scheduler defaults on only in production", () => {
  assert.equal(notificationSchedulerConfig({ NODE_ENV: "production" }).enabled, true);
  assert.equal(notificationSchedulerConfig({ NODE_ENV: "development" }).enabled, false);
  assert.equal(
    notificationSchedulerConfig({
      NODE_ENV: "production",
      NOTIFICATION_SYNC_ENABLED: "false",
    }).enabled,
    false
  );
});

test("notification scheduler enforces a safe minimum interval", () => {
  const config = notificationSchedulerConfig({
    NODE_ENV: "production",
    NOTIFICATION_SYNC_INTERVAL_MINUTES: "1",
  });
  assert.equal(config.intervalMinutes, 5);
  assert.equal(config.intervalMs, 5 * 60_000);
});

test("notification scheduler registers one initial run and one recurring run", () => {
  resetNotificationSchedulerForTests();
  const delays = [];
  const handles = [];
  const fakeHandle = () => ({ unref() { handles.push("unref"); } });

  const result = startNotificationSyncScheduler({
    env: { NODE_ENV: "production" },
    sync: async () => ({ generated_count: 0, resolved_count: 0 }),
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn(callback, delay) {
      delays.push(["timeout", delay, typeof callback]);
      return fakeHandle();
    },
    setIntervalFn(callback, delay) {
      delays.push(["interval", delay, typeof callback]);
      return fakeHandle();
    },
  });

  assert.equal(result.started, true);
  assert.equal(delays.length, 2);
  assert.equal(delays[0][0], "timeout");
  assert.equal(delays[1][0], "interval");
  assert.equal(delays[1][1], 15 * 60_000);
  assert.equal(handles.length, 2);
  resetNotificationSchedulerForTests();
});

test("notification scheduler prevents overlapping local executions", async () => {
  resetNotificationSchedulerForTests();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const sync = async () => {
    calls += 1;
    await pending;
    return { generated_count: 1, resolved_count: 0 };
  };
  const logger = { log() {}, warn() {}, error() {} };

  const first = runScheduledNotificationSync({ sync, logger });
  await Promise.resolve();
  const second = await runScheduledNotificationSync({ sync, logger });

  assert.equal(second.skipped, true);
  assert.equal(calls, 1);
  release();
  await first;
  resetNotificationSchedulerForTests();
});
