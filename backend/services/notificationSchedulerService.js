const { runNotificationSync } = require("./notificationService");
const { runScheduledBusinessReports } = require("./executiveBusinessReportService");

const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_INITIAL_DELAY_MS = 20_000;

let initialTimer = null;
let intervalTimer = null;
let syncRunning = false;

function booleanSetting(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase()
  );
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function notificationSchedulerConfig(env = process.env) {
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  const enabled = booleanSetting(env.NOTIFICATION_SYNC_ENABLED, production);
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
    intervalMinutes,
    intervalMs: Math.round(intervalMinutes * 60_000),
    initialDelayMs: Math.round(initialDelayMs),
  };
}

async function runScheduledNotificationSync({
  sync = runNotificationSync,
  logger = console,
  executiveReports = runScheduledBusinessReports,
} = {}) {
  if (syncRunning) {
    return { skipped: true, reason: "local_sync_already_running" };
  }

  syncRunning = true;
  try {
    const [notificationResult, executiveResult] = await Promise.allSettled([
      sync({ workspaceCode: "group", userId: null }),
      executiveReports({ logger }),
    ]);

    if (notificationResult.status === "fulfilled") {
      const result = notificationResult.value;
      logger.log(
        `Notification sync completed: generated ${Number(
          result?.generated_count || 0
        )}, resolved ${Number(result?.resolved_count || 0)}.`
      );
    } else {
      const error = notificationResult.reason;
      if (Number(error?.statusCode || 0) === 409) {
        logger.warn(
          "Notification sync skipped because another server instance holds the database lock."
        );
      } else {
        logger.error("Automatic notification sync failed:", error?.message || error);
      }
    }

    if (executiveResult.status === "fulfilled") {
      const result = executiveResult.value || {};
      const weekly = result.weekly || {};
      const monthly = result.monthly || {};

      if (!weekly.skipped) {
        logger.log("Weekly executive business intelligence processed.");
      }
      if (!monthly.skipped) {
        logger.log("Monthly executive business intelligence processed.");
      }
    } else {
      logger.error(
        "Automatic executive business intelligence failed:",
        executiveResult.reason?.message || executiveResult.reason
      );
    }

    return {
      skipped: false,
      notification:
        notificationResult.status === "fulfilled"
          ? { skipped: false, result: notificationResult.value }
          : { skipped: false, failed: true, error: notificationResult.reason },
      executive_reports:
        executiveResult.status === "fulfilled"
          ? executiveResult.value
          : { skipped: true, reason: executiveResult.reason?.message || "executive_report_error" },
    };
  } finally {
    syncRunning = false;
  }
}

function startNotificationSyncScheduler({
  env = process.env,
  sync = runNotificationSync,
  executiveReports = runScheduledBusinessReports,
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
      executiveReports,
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
    `Automatic notification sync scheduled every ${config.intervalMinutes} minute(s), including weekly/monthly executive intelligence checks.`
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
