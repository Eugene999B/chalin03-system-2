const { getSmsConfig } = require("./smsService");
const {
  applySmsStatusTransition,
  humanizeSmsStatus,
  normalizeSmsDeliveryStatus,
} = require("./smsReliabilityService");

const DEFAULT_ARKESEL_REPORTS_URL =
  "https://sms.arkesel.com/api/v2/sms/message-reports";
const DEFAULT_CALLBACK_URL =
  "https://api.chalin03.com/api/sms/delivery-report";
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_INITIAL_DELAY_MS = 8_000;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_LOOKBACK_HOURS = 720;
const DEFAULT_MIN_STATUS_AGE_SECONDS = 30;
const MAX_PROVIDER_RESPONSE_LENGTH = 12_000;

function getDefaultDatabase() {
  return require("../config/db").pool;
}

let initialTimer = null;
let intervalTimer = null;
let syncInFlight = false;

const syncState = {
  started: false,
  last_started_at: null,
  last_completed_at: null,
  last_error_at: null,
  last_error: null,
  last_checked_count: 0,
  last_updated_count: 0,
};

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  return String(value).trim().toLowerCase() === "true";
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function getSmsDeliverySyncConfig(baseConfig = getSmsConfig()) {
  return {
    ...baseConfig,
    arkeselReportsUrl: String(
      process.env.SMS_ARKESEL_REPORTS_URL || DEFAULT_ARKESEL_REPORTS_URL
    ).trim(),
    deliveryCallbackUrl: String(
      process.env.SMS_DELIVERY_CALLBACK_URL || DEFAULT_CALLBACK_URL
    ).trim(),
    deliveryPollEnabled: parseBoolean(
      process.env.SMS_DELIVERY_POLL_ENABLED,
      true
    ),
    deliveryPollIntervalMs: positiveInteger(
      process.env.SMS_DELIVERY_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      3_600_000
    ),
    deliveryPollInitialDelayMs: positiveInteger(
      process.env.SMS_DELIVERY_POLL_INITIAL_DELAY_MS,
      DEFAULT_INITIAL_DELAY_MS,
      600_000
    ),
    deliveryPollBatchSize: positiveInteger(
      process.env.SMS_DELIVERY_POLL_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      1_000
    ),
    deliveryPollLookbackHours: positiveInteger(
      process.env.SMS_DELIVERY_POLL_LOOKBACK_HOURS,
      DEFAULT_LOOKBACK_HOURS,
      8_760
    ),
    deliveryPollMinimumAgeSeconds: positiveInteger(
      process.env.SMS_DELIVERY_POLL_MIN_AGE_SECONDS,
      DEFAULT_MIN_STATUS_AGE_SECONDS,
      86_400
    ),
  };
}

function buildArkeselDeliveryCallbackUrl(config = getSmsDeliverySyncConfig()) {
  if (!config.deliveryWebhookSecret || !config.deliveryCallbackUrl) {
    return "";
  }

  let callbackUrl;

  try {
    callbackUrl = new URL(config.deliveryCallbackUrl);
  } catch {
    throw new Error("SMS_DELIVERY_CALLBACK_URL must be a valid URL.");
  }

  const isLocalhost = ["localhost", "127.0.0.1"].includes(
    callbackUrl.hostname.toLowerCase()
  );

  if (callbackUrl.protocol !== "https:" && !isLocalhost) {
    throw new Error(
      "SMS_DELIVERY_CALLBACK_URL must use HTTPS outside local development."
    );
  }

  callbackUrl.searchParams.set("token", config.deliveryWebhookSecret);

  return callbackUrl.toString();
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return String(value ?? "");
  }
}

function getTimeoutMs(config) {
  const timeoutMs = Number(config.timeoutMs);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000;
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return { raw: "", parsed: null };
  }

  try {
    return { raw: text, parsed: JSON.parse(text) };
  } catch {
    return { raw: text, parsed: text };
  }
}

async function fetchArkeselMessageReports({
  messageIds,
  config = getSmsDeliverySyncConfig(),
  fetchImpl = global.fetch,
}) {
  const uniqueIds = [
    ...new Set(
      (Array.isArray(messageIds) ? messageIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ),
  ].slice(0, 1_000);

  if (uniqueIds.length === 0) {
    return {
      status: "success",
      data: {},
      requested_message_ids: [],
    };
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("Node.js fetch is unavailable for Arkesel status checks.");
  }

  if (!config.arkeselApiKey) {
    throw new Error("SMS_ARKESEL_API_KEY is required for delivery-status checks.");
  }

  if (!config.arkeselReportsUrl) {
    throw new Error("SMS_ARKESEL_REPORTS_URL is required.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs(config));

  let response;

  try {
    response = await fetchImpl(config.arkeselReportsUrl, {
      method: "POST",
      headers: {
        "api-key": config.arkeselApiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ msg_ids: uniqueIds }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Arkesel delivery-status request timed out.");
    }

    throw new Error(`Arkesel delivery-status network error: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await readJsonResponse(response);
  const providerResponse = responseBody.parsed ?? responseBody.raw;

  if (
    !response.ok ||
    !providerResponse ||
    typeof providerResponse !== "object" ||
    String(providerResponse.status || "").toLowerCase() !== "success"
  ) {
    const providerMessage =
      providerResponse?.message ||
      providerResponse?.error ||
      response.statusText ||
      "Unknown provider response";

    throw new Error(
      `Arkesel delivery-status request failed. HTTP ${response.status}: ${providerMessage}`
    );
  }

  return {
    ...providerResponse,
    data:
      providerResponse.data && typeof providerResponse.data === "object"
        ? providerResponse.data
        : {},
    requested_message_ids: uniqueIds,
  };
}

function interpretArkeselReport(providerMessageId, reportEntry) {
  const entry =
    reportEntry && typeof reportEntry === "object" ? reportEntry : null;

  if (!entry) {
    return {
      provider_message_id: providerMessageId,
      has_report: false,
      lookup_error: false,
      provider_status: null,
      normalized_status: "delivery_unknown",
      status_reason:
        "Automatic Arkesel status check has not returned a delivery record yet.",
      provider_response: null,
    };
  }

  const providerStatus = String(
    entry.status || entry.delivery_status || entry.state || ""
  ).trim();
  const lookupError =
    providerStatus.toLowerCase() === "error" ||
    Boolean(entry.error) ||
    /does not exist|not found/i.test(String(entry.response || entry.message || ""));

  if (lookupError) {
    return {
      provider_message_id: providerMessageId,
      has_report: true,
      lookup_error: true,
      provider_status: providerStatus || "error",
      normalized_status: "delivery_unknown",
      status_reason: `Automatic Arkesel status check could not confirm delivery: ${
        entry.response || entry.message || entry.error || "message record unavailable"
      }`,
      provider_response: entry,
    };
  }

  const normalizedStatus = normalizeSmsDeliveryStatus(
    providerStatus,
    "delivery_unknown"
  );

  return {
    provider_message_id: providerMessageId,
    has_report: true,
    lookup_error: false,
    provider_status: providerStatus || null,
    normalized_status: normalizedStatus,
    status_reason: `Automatic Arkesel status check: ${humanizeSmsStatus(
      normalizedStatus
    )}${providerStatus ? ` (${providerStatus})` : ""}.`,
    provider_response: entry,
  };
}

async function loadPendingArkeselLogs(config, database = null) {
  const databaseClient = database || getDefaultDatabase();
  const now = Date.now();
  const lookbackCutoff = new Date(
    now - config.deliveryPollLookbackHours * 60 * 60 * 1_000
  );
  const statusCutoff = new Date(
    now - config.deliveryPollMinimumAgeSeconds * 1_000
  );
  const limit = positiveInteger(
    config.deliveryPollBatchSize,
    DEFAULT_BATCH_SIZE,
    1_000
  );

  const [rows] = await databaseClient.execute(
    `SELECT id, status, provider_message_id
     FROM sms_log
     WHERE LOWER(COALESCE(provider, '')) = 'arkesel'
       AND status IN ('pending', 'accepted', 'delivery_unknown')
       AND provider_message_id IS NOT NULL
       AND TRIM(provider_message_id) <> ''
       AND COALESCE(submitted_at, created_at) >= ?
       AND (last_status_at IS NULL OR last_status_at <= ?)
     ORDER BY id ASC
     LIMIT ${limit}`,
    [lookbackCutoff, statusCutoff]
  );

  return Array.isArray(rows) ? rows : [];
}

async function updateAutomaticStatus({
  database = null,
  log,
  interpretation,
}) {
  const finalStatus =
    interpretation.lookup_error || !interpretation.has_report
      ? String(log.status || "delivery_unknown").toLowerCase()
      : applySmsStatusTransition(
          log.status,
          interpretation.normalized_status
        );

  const databaseClient = database || getDefaultDatabase();

  const [result] = await databaseClient.execute(
    `UPDATE sms_log
     SET status = ?,
         provider_status = ?,
         status_reason = ?,
         delivery_report_response = ?,
         delivery_confirmed_at =
           CASE
             WHEN ? = 'delivered' THEN COALESCE(delivery_confirmed_at, NOW())
             ELSE delivery_confirmed_at
           END,
         last_status_at = NOW()
     WHERE id = ?`,
    [
      finalStatus,
      interpretation.provider_status || null,
      interpretation.status_reason,
      safeJson(interpretation.provider_response).slice(
        0,
        MAX_PROVIDER_RESPONSE_LENGTH
      ),
      finalStatus,
      log.id,
    ]
  );

  return {
    id: log.id,
    previous_status: log.status,
    final_status: finalStatus,
    changed: String(log.status || "").toLowerCase() !== finalStatus,
    affected_rows: Number(result?.affectedRows || 0),
  };
}

function isAutomaticDeliveryReady(config = getSmsDeliverySyncConfig()) {
  return Boolean(
    config.enabled &&
      String(config.provider || "").toLowerCase() === "arkesel" &&
      config.arkeselApiKey &&
      config.arkeselReportsUrl &&
      config.deliveryPollEnabled
  );
}

async function syncSmsDeliveryStatuses({
  database = null,
  config = getSmsDeliverySyncConfig(),
  fetchImpl = global.fetch,
  logger = console,
} = {}) {
  if (!isAutomaticDeliveryReady(config)) {
    return {
      skipped: true,
      reason: "Automatic Arkesel delivery polling is not ready.",
      checked_count: 0,
      updated_count: 0,
    };
  }

  if (syncInFlight) {
    return {
      skipped: true,
      reason: "An automatic delivery-status check is already running.",
      checked_count: 0,
      updated_count: 0,
    };
  }

  const databaseClient = database || getDefaultDatabase();

  syncInFlight = true;
  syncState.last_started_at = new Date().toISOString();

  try {
    const logs = await loadPendingArkeselLogs(config, databaseClient);

    if (logs.length === 0) {
      syncState.last_completed_at = new Date().toISOString();
      syncState.last_error = null;
      syncState.last_checked_count = 0;
      syncState.last_updated_count = 0;

      return {
        skipped: false,
        checked_count: 0,
        updated_count: 0,
        changed_count: 0,
      };
    }

    const reports = await fetchArkeselMessageReports({
      messageIds: logs.map((log) => log.provider_message_id),
      config,
      fetchImpl,
    });

    const updates = [];

    for (const log of logs) {
      const providerMessageId = String(log.provider_message_id);
      const interpretation = interpretArkeselReport(
        providerMessageId,
        reports.data?.[providerMessageId]
      );

      updates.push(
        await updateAutomaticStatus({
          database: databaseClient,
          log,
          interpretation,
        })
      );
    }

    const changedCount = updates.filter((update) => update.changed).length;

    syncState.last_completed_at = new Date().toISOString();
    syncState.last_error_at = null;
    syncState.last_error = null;
    syncState.last_checked_count = logs.length;
    syncState.last_updated_count = changedCount;

    if (changedCount > 0) {
      logger.info(
        `Automatic SMS delivery status updated ${changedCount} of ${logs.length} Arkesel record(s).`
      );
    }

    return {
      skipped: false,
      checked_count: logs.length,
      updated_count: updates.reduce(
        (sum, update) => sum + update.affected_rows,
        0
      ),
      changed_count: changedCount,
      updates,
    };
  } catch (error) {
    syncState.last_error_at = new Date().toISOString();
    syncState.last_error = error.message || "Automatic SMS status check failed.";
    logger.error("Automatic SMS delivery-status check failed:", error.message);

    return {
      skipped: false,
      checked_count: 0,
      updated_count: 0,
      changed_count: 0,
      error: syncState.last_error,
    };
  } finally {
    syncInFlight = false;
  }
}

function getSmsDeliverySyncState(config = getSmsDeliverySyncConfig()) {
  return {
    ...syncState,
    ready: isAutomaticDeliveryReady(config),
    callback_ready: Boolean(buildArkeselDeliveryCallbackUrl(config)),
    poll_interval_seconds: Math.round(
      config.deliveryPollIntervalMs / 1_000
    ),
  };
}

function stopSmsDeliveryStatusSync() {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }

  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }

  syncState.started = false;
}

function startSmsDeliveryStatusSync({
  database = null,
  config = getSmsDeliverySyncConfig(),
  fetchImpl = global.fetch,
  logger = console,
} = {}) {
  stopSmsDeliveryStatusSync();

  if (!isAutomaticDeliveryReady(config)) {
    logger.info(
      "Automatic SMS delivery polling is inactive because Arkesel live configuration is not ready."
    );

    return {
      started: false,
      reason: "Automatic Arkesel delivery polling is not ready.",
    };
  }

  const runSync = () =>
    syncSmsDeliveryStatuses({
      database,
      config: getSmsDeliverySyncConfig(),
      fetchImpl,
      logger,
    });

  initialTimer = setTimeout(runSync, config.deliveryPollInitialDelayMs);
  intervalTimer = setInterval(runSync, config.deliveryPollIntervalMs);

  if (typeof initialTimer.unref === "function") initialTimer.unref();
  if (typeof intervalTimer.unref === "function") intervalTimer.unref();

  syncState.started = true;

  logger.info(
    `Automatic SMS delivery polling started: every ${Math.round(
      config.deliveryPollIntervalMs / 1_000
    )} seconds.`
  );

  return {
    started: true,
    poll_interval_ms: config.deliveryPollIntervalMs,
  };
}

module.exports = {
  buildArkeselDeliveryCallbackUrl,
  fetchArkeselMessageReports,
  getSmsDeliverySyncConfig,
  getSmsDeliverySyncState,
  interpretArkeselReport,
  isAutomaticDeliveryReady,
  startSmsDeliveryStatusSync,
  stopSmsDeliveryStatusSync,
  syncSmsDeliveryStatuses,
};
