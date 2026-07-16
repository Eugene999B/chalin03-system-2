const {
  buildSmsEvidence,
  estimateSmsSegments,
  hasExplicitProviderFailure,
} = require("./smsReliabilityService");

const DEFAULT_HUBTEL_BASE_URL = "https://smsc.hubtel.com/v1/messages/send";
const DEFAULT_ARKESEL_BASE_URL = "https://sms.arkesel.com/api/v2/sms/send";
const DEFAULT_SMS_TIMEOUT_MS = 15000;

function getSmsConfig() {
  return {
    enabled:
      String(process.env.SMS_ENABLED || "false").trim().toLowerCase() ===
      "true",
    provider: String(process.env.SMS_PROVIDER || "mock").trim().toLowerCase(),
    senderId: String(process.env.SMS_SENDER_ID || "CHALIN03").trim(),

    // Arkesel
    arkeselApiKey: String(process.env.SMS_ARKESEL_API_KEY || "").trim(),
    arkeselBaseUrl: String(
      process.env.SMS_ARKESEL_BASE_URL || DEFAULT_ARKESEL_BASE_URL
    ).trim(),

    // Optional delivery-report callback protection.
    deliveryWebhookSecret: String(
      process.env.SMS_DELIVERY_WEBHOOK_SECRET || ""
    ).trim(),

    // Hubtel kept as optional backup
    hubtelClientId: String(process.env.SMS_HUBTEL_CLIENT_ID || "").trim(),
    hubtelClientSecret: String(process.env.SMS_HUBTEL_CLIENT_SECRET || "").trim(),
    hubtelBaseUrl: String(
      process.env.SMS_HUBTEL_BASE_URL || DEFAULT_HUBTEL_BASE_URL
    ).trim(),

    timeoutMs: Number(process.env.SMS_TIMEOUT_MS || DEFAULT_SMS_TIMEOUT_MS),
  };
}

function normalizeGhanaPhone(phone) {
  const rawPhone = String(phone || "").trim();

  if (!rawPhone) {
    return "";
  }

  let digits = rawPhone.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("0") && digits.length === 10) {
    digits = `233${digits.slice(1)}`;
  }

  if (digits.length === 9) {
    digits = `233${digits}`;
  }

  if (digits.startsWith("2330") && digits.length === 13) {
    digits = `233${digits.slice(4)}`;
  }

  if (!digits.startsWith("233") || digits.length !== 12) {
    return "";
  }

  return `+${digits}`;
}

function validateSmsMessage(message) {
  const cleanMessage = String(message || "").trim();

  if (!cleanMessage) {
    throw new Error("SMS message is required.");
  }

  if (cleanMessage.length > 480) {
    throw new Error("SMS message is too long. Keep it under 480 characters.");
  }

  return cleanMessage;
}

function createSmsError(message, extra = {}) {
  const error = new Error(message);

  Object.assign(error, {
    statusCode: extra.statusCode || null,
    providerResponse:
      extra.providerResponse === undefined ? null : extra.providerResponse,
    provider: extra.provider || null,
    providerMessageId: extra.providerMessageId || null,
    providerStatus: extra.providerStatus || null,
  });

  return error;
}

async function readResponseBody(response) {
  const responseText = await response.text();

  if (!responseText) {
    return { raw: "", parsed: null };
  }

  try {
    return { raw: responseText, parsed: JSON.parse(responseText) };
  } catch {
    return { raw: responseText, parsed: responseText };
  }
}

function getProviderMessage(providerResponse) {
  if (!providerResponse) return "";
  if (typeof providerResponse === "string") return providerResponse;

  if (Array.isArray(providerResponse)) {
    return providerResponse
      .map((item) => getProviderMessage(item))
      .filter(Boolean)
      .join(" | ");
  }

  if (typeof providerResponse === "object") {
    const possibleMessage =
      providerResponse.message ||
      providerResponse.error ||
      providerResponse.detail ||
      providerResponse.description ||
      providerResponse.reason;

    if (possibleMessage) return String(possibleMessage);
    if (providerResponse.errors) return getProviderMessage(providerResponse.errors);
    if (providerResponse.data) return getProviderMessage(providerResponse.data);

    try {
      return JSON.stringify(providerResponse);
    } catch {
      return "";
    }
  }

  return String(providerResponse);
}

function getTimeoutMs(config) {
  return Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
    ? config.timeoutMs
    : DEFAULT_SMS_TIMEOUT_MS;
}

function ensureFetchAvailable() {
  if (typeof fetch !== "function") {
    throw new Error("This backend needs Node.js 18 or newer for live SMS sending.");
  }
}

function validateArkeselConfig(config) {
  if (!config.arkeselApiKey) {
    throw new Error(
      "Arkesel API Key is required. Add SMS_ARKESEL_API_KEY to backend .env."
    );
  }

  if (!config.senderId) {
    throw new Error("SMS sender ID is required. Add SMS_SENDER_ID to backend .env.");
  }

  if (config.senderId.length > 11) {
    throw new Error(
      "SMS sender ID is too long. Arkesel sender IDs must be 11 characters or fewer."
    );
  }

  if (!config.arkeselBaseUrl) {
    throw new Error(
      "Arkesel base URL is required. Add SMS_ARKESEL_BASE_URL to backend .env."
    );
  }

  ensureFetchAvailable();
}

function validateHubtelConfig(config) {
  if (!config.hubtelClientId || !config.hubtelClientSecret) {
    throw new Error(
      "Hubtel Client ID and Client Secret are required. Add them to backend .env."
    );
  }

  if (!config.senderId) {
    throw new Error("SMS sender ID is required. Add SMS_SENDER_ID to backend .env.");
  }

  if (!config.hubtelBaseUrl) {
    throw new Error(
      "Hubtel base URL is required. Add SMS_HUBTEL_BASE_URL to backend .env."
    );
  }

  ensureFetchAvailable();
}

function buildSubmissionResult({ provider, to, message, config, providerResponse }) {
  const evidence = buildSmsEvidence({
    providerResponse,
    message,
    provider,
    senderId: config.senderId,
  });

  return {
    success: true,
    provider,
    to,
    status: evidence.status === "delivered" ? "delivered" : "accepted",
    providerStatus: evidence.provider_status,
    providerMessageId: evidence.provider_message_id,
    senderId: evidence.sender_id,
    encoding: evidence.encoding,
    characterCount: evidence.character_count,
    encodedLength: evidence.encoded_length,
    segmentCount: evidence.segment_count,
    estimatedCredits: evidence.estimated_credits,
    submittedAt: new Date(),
    providerResponse,
  };
}

async function postWithTimeout({ url, headers, payload, timeoutMs, provider }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw createSmsError(`${provider} SMS request timed out.`, {
        provider: provider.toLowerCase(),
        statusCode: 408,
        providerResponse: {
          message: `Request timed out after ${timeoutMs}ms. Delivery is unknown; do not resend until the provider dashboard is checked.`,
        },
      });
    }

    throw createSmsError(`${provider} SMS network error: ${error.message}`, {
      provider: provider.toLowerCase(),
      providerResponse: { message: error.message },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendArkeselSms({ config, to, message }) {
  validateArkeselConfig(config);

  // Arkesel's recipient payload uses the international digits. The log keeps +233.
  const providerRecipient = String(to).replace(/^\+/, "");
  const payload = {
    sender: config.senderId,
    message,
    recipients: [providerRecipient],
  };

  const response = await postWithTimeout({
    url: config.arkeselBaseUrl,
    headers: {
      "api-key": config.arkeselApiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    payload,
    timeoutMs: getTimeoutMs(config),
    provider: "Arkesel",
  });

  const responseBody = await readResponseBody(response);
  const providerResponse = responseBody.parsed ?? responseBody.raw;
  const providerMessage = getProviderMessage(providerResponse);
  const evidence = buildSmsEvidence({
    providerResponse,
    message,
    provider: "arkesel",
    senderId: config.senderId,
  });

  if (!response.ok || hasExplicitProviderFailure(providerResponse)) {
    throw createSmsError(
      providerMessage
        ? `Arkesel SMS was not accepted. HTTP ${response.status}: ${providerMessage}`
        : `Arkesel SMS was not accepted. HTTP ${response.status}.`,
      {
        provider: "arkesel",
        statusCode: response.status,
        providerResponse,
        providerMessageId: evidence.provider_message_id,
        providerStatus: evidence.provider_status,
      }
    );
  }

  return buildSubmissionResult({
    provider: "arkesel",
    to,
    message,
    config,
    providerResponse,
  });
}

async function sendHubtelSms({ config, to, message }) {
  validateHubtelConfig(config);

  const authToken = Buffer.from(
    `${config.hubtelClientId}:${config.hubtelClientSecret}`
  ).toString("base64");

  const response = await postWithTimeout({
    url: config.hubtelBaseUrl,
    headers: {
      Authorization: `Basic ${authToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    payload: {
      From: config.senderId,
      To: to,
      Content: message,
    },
    timeoutMs: getTimeoutMs(config),
    provider: "Hubtel",
  });

  const responseBody = await readResponseBody(response);
  const providerResponse = responseBody.parsed ?? responseBody.raw;
  const providerMessage = getProviderMessage(providerResponse);
  const evidence = buildSmsEvidence({
    providerResponse,
    message,
    provider: "hubtel",
    senderId: config.senderId,
  });

  if (!response.ok || hasExplicitProviderFailure(providerResponse)) {
    throw createSmsError(
      providerMessage
        ? `Hubtel SMS was not accepted. HTTP ${response.status}: ${providerMessage}`
        : `Hubtel SMS was not accepted. HTTP ${response.status}.`,
      {
        provider: "hubtel",
        statusCode: response.status,
        providerResponse,
        providerMessageId: evidence.provider_message_id,
        providerStatus: evidence.provider_status,
      }
    );
  }

  return buildSubmissionResult({
    provider: "hubtel",
    to,
    message,
    config,
    providerResponse,
  });
}

async function sendSms({ to, message }) {
  const config = getSmsConfig();
  const normalizedTo = normalizeGhanaPhone(to);
  const cleanMessage = validateSmsMessage(message);
  const metrics = estimateSmsSegments(cleanMessage);

  if (!normalizedTo) {
    throw new Error("Invalid Ghana phone number.");
  }

  if (!config.enabled) {
    throw new Error("SMS is disabled. Set SMS_ENABLED=true in backend .env.");
  }

  if (config.provider === "mock") {
    return {
      success: true,
      provider: "mock",
      to: normalizedTo,
      status: "delivery_unknown",
      providerStatus: "mock",
      providerMessageId: null,
      senderId: config.senderId,
      encoding: metrics.encoding,
      characterCount: metrics.character_count,
      encodedLength: metrics.encoded_length,
      segmentCount: metrics.segment_count,
      estimatedCredits: 0,
      submittedAt: new Date(),
      providerResponse: {
        message:
          "Mock SMS recorded. No real provider submission occurred and no credit was used.",
      },
    };
  }

  if (config.provider === "arkesel") {
    return sendArkeselSms({ config, to: normalizedTo, message: cleanMessage });
  }

  if (config.provider === "hubtel") {
    return sendHubtelSms({ config, to: normalizedTo, message: cleanMessage });
  }

  throw new Error(`Unsupported SMS provider: ${config.provider}`);
}

module.exports = {
  getSmsConfig,
  normalizeGhanaPhone,
  sendSms,
  validateSmsMessage,
};
