const { runNotificationSync } = require("./notificationService");
const { runExecutiveNotificationSync } = require("./executiveNotificationService");

const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_INITIAL_DELAY_MS = 20_000;

let initialTimer = null;
let intervalTimer = null;
let syncRunning = false;

function booleanSetting(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function notificationSchedulerConfig(env = process.env) {
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  const enabled = booleanSetting(env.NOTIFICATION_SYNC_ENABLED, production);
  const intelligenceEnabled = booleanSetting(
    env.EXECUTIVE_NOTIFICATION_INTELLIGENCE_ENABLED,
    production
  );
  const intervalMinutes = boundedNumber(
    env.NOTIFICATION_SYNC_INTERVAL_MINUTES,
    DEFAULT_INTERVAL_MINUTES,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES
  );
  const initialDelayMs = boundedNumber(
    env.NOTIFICATION_SYNC_INITIAL_DELAY_MS,
    DEFAULT_INITIAL_DELAY_MS,
    1_000,
    5 * 60_000
  );

  return {
    enabled,
    intelligenceEnabled,
    intervalMinutes,
    intervalMs: Math.round(intervalMinutes * 60_000),
    initialDelayMs: Math.round(initialDelayMs),
  };
}

async function runScheduledNotificationSync({
  sync = runNotificationSync,
  intelligenceSync = runExecutiveNotificationSync,
  intelligenceEnabled = true,
  logger = console,
} = {}) {
  if (syncRunning) return { skipped: true, reason: "local_sync_already_running" };

  syncRunning = true;
  try {
    const result = await sync({ workspaceCode: "group", userId: null });
    const intelligence = intelligenceEnabled
      ? await intelligenceSync({ logger })
      : null;

    logger.log(
      `Notification sync completed: generated ${Number(
        result?.generated_count || 0
      )}, resolved ${Number(result?.resolved_count || 0)}.`
    );
    return { skipped: false, result, intelligence };
  } catch (error) {
    if (Number(error?.statusCode || 0) === 409) {
      logger.warn(
        "Notification sync skipped because another server instance holds the database lock."
      );
      return { skipped: true, reason: "database_sync_already_running" };
    }
    logger.error("Automatic notification sync failed:", error.message);
    return { skipped: false, failed: true, error };
  } finally {
    syncRunning = false;
  }
}

function startNotificationSyncScheduler({
  env = process.env,
  sync = runNotificationSync,
  intelligenceSync = runExecutiveNotificationSync,
  logger = console,
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
} = {}) {
  const config = notificationSchedulerConfig(env);
  if (!config.enabled) {
    logger.log("Automatic notification sync is disabled.");
    return { started: false, ...config };
  }
  if (initialTimer || intervalTimer) {
    return { started: false, alreadyStarted: true, ...config };
  }

  const execute = () =>
    runScheduledNotificationSync({
      sync,
      intelligenceSync,
      intelligenceEnabled: config.intelligenceEnabled,
      logger,
    });

  initialTimer = setTimeoutFn(() => {
    initialTimer = null;
    void execute();
  }, config.initialDelayMs);
  initialTimer?.unref?.();

  intervalTimer = setIntervalFn(() => {
    void execute();
  }, config.intervalMs);
  intervalTimer?.unref?.();

  logger.log(
    `Automatic notification sync scheduled every ${config.intervalMinutes} minute(s).`
  );
  return { started: true, ...config };
}

function resetNotificationSchedulerForTests() {
  initialTimer = null;
  intervalTimer = null;
  syncRunning = false;
}

module.exports = {
  DEFAULT_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  notificationSchedulerConfig,
  runScheduledNotificationSync,
  startNotificationSyncScheduler,
  resetNotificationSchedulerForTests,
};
