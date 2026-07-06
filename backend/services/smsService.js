const DEFAULT_HUBTEL_BASE_URL = "https://smsc.hubtel.com/v1/messages/send";
const DEFAULT_ARKESEL_BASE_URL = "https://sms.arkesel.com/api/v2/sms/send";
const DEFAULT_SMS_TIMEOUT_MS = 15000;

function getSmsConfig() {
  return {
    enabled: String(process.env.SMS_ENABLED || "false").toLowerCase() === "true",
    provider: String(process.env.SMS_PROVIDER || "mock").toLowerCase().trim(),
    senderId: String(process.env.SMS_SENDER_ID || "CHALIN03").trim(),

    // Arkesel
    arkeselApiKey: String(process.env.SMS_ARKESEL_API_KEY || "").trim(),
    arkeselBaseUrl: String(
      process.env.SMS_ARKESEL_BASE_URL || DEFAULT_ARKESEL_BASE_URL
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

  // Example: 0543421127 -> 233543421127
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `233${digits.slice(1)}`;
  }

  // Example: 543421127 -> 233543421127
  if (digits.length === 9) {
    digits = `233${digits}`;
  }

  // Example: 2330543421127 -> 233543421127
  if (digits.startsWith("2330") && digits.length === 13) {
    digits = `233${digits.slice(4)}`;
  }

  // Ghana SMS format: 233 + 9 digits = 12 digits
  if (!digits.startsWith("233")) {
    return "";
  }

  if (digits.length !== 12) {
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

  if (extra.statusCode) {
    error.statusCode = extra.statusCode;
  }

  if (extra.providerResponse !== undefined) {
    error.providerResponse = extra.providerResponse;
  }

  if (extra.provider) {
    error.provider = extra.provider;
  }

  return error;
}

async function readResponseBody(response) {
  const responseText = await response.text();

  if (!responseText) {
    return {
      raw: "",
      parsed: null,
    };
  }

  try {
    return {
      raw: responseText,
      parsed: JSON.parse(responseText),
    };
  } catch {
    return {
      raw: responseText,
      parsed: responseText,
    };
  }
}

function getTimeoutMs(config) {
  if (Number.isFinite(config.timeoutMs) && config.timeoutMs > 0) {
    return config.timeoutMs;
  }

  return DEFAULT_SMS_TIMEOUT_MS;
}

function ensureFetchAvailable() {
  if (typeof fetch !== "function") {
    throw new Error(
      "This backend needs Node.js 18 or newer for live SMS sending."
    );
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

async function sendArkeselSms({ config, to, message }) {
  validateArkeselConfig(config);

  const payload = {
    sender: config.senderId,
    message,
    recipients: [to],
  };

  const controller = new AbortController();
  const timeoutMs = getTimeoutMs(config);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;

  try {
    response = await fetch(config.arkeselBaseUrl, {
      method: "POST",
      headers: {
        "api-key": config.arkeselApiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw createSmsError("Arkesel SMS request timed out.", {
        provider: "arkesel",
        statusCode: 408,
        providerResponse: {
          message: `Request timed out after ${timeoutMs}ms.`,
        },
      });
    }

    throw createSmsError(`Arkesel SMS network error: ${error.message}`, {
      provider: "arkesel",
      providerResponse: {
        message: error.message,
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    throw createSmsError("Arkesel SMS request failed.", {
      provider: "arkesel",
      statusCode: response.status,
      providerResponse: responseBody.parsed,
    });
  }

  if (
    responseBody.parsed &&
    typeof responseBody.parsed === "object" &&
    responseBody.parsed.status &&
    String(responseBody.parsed.status).toLowerCase() !== "success"
  ) {
    throw createSmsError("Arkesel SMS was not accepted.", {
      provider: "arkesel",
      statusCode: response.status,
      providerResponse: responseBody.parsed,
    });
  }

  return {
    success: true,
    provider: "arkesel",
    to,
    status: "sent",
    providerResponse: responseBody.parsed,
  };
}

async function sendHubtelSms({ config, to, message }) {
  validateHubtelConfig(config);

  const authToken = Buffer.from(
    `${config.hubtelClientId}:${config.hubtelClientSecret}`
  ).toString("base64");

  const payload = {
    From: config.senderId,
    To: to,
    Content: message,
  };

  const controller = new AbortController();
  const timeoutMs = getTimeoutMs(config);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;

  try {
    response = await fetch(config.hubtelBaseUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw createSmsError("Hubtel SMS request timed out.", {
        provider: "hubtel",
        statusCode: 408,
        providerResponse: {
          message: `Request timed out after ${timeoutMs}ms.`,
        },
      });
    }

    throw createSmsError(`Hubtel SMS network error: ${error.message}`, {
      provider: "hubtel",
      providerResponse: {
        message: error.message,
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    throw createSmsError("Hubtel SMS request failed.", {
      provider: "hubtel",
      statusCode: response.status,
      providerResponse: responseBody.parsed,
    });
  }

  return {
    success: true,
    provider: "hubtel",
    to,
    status: "sent",
    providerResponse: responseBody.parsed,
  };
}

async function sendSms({ to, message }) {
  const config = getSmsConfig();

  const normalizedTo = normalizeGhanaPhone(to);
  const cleanMessage = validateSmsMessage(message);

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
      status: "sent",
      providerResponse: {
        message:
          "Mock SMS sent successfully. No real SMS credit was used. Switch SMS_PROVIDER to arkesel or hubtel for live SMS.",
      },
    };
  }

  if (config.provider === "arkesel") {
    return sendArkeselSms({
      config,
      to: normalizedTo,
      message: cleanMessage,
    });
  }

  if (config.provider === "hubtel") {
    return sendHubtelSms({
      config,
      to: normalizedTo,
      message: cleanMessage,
    });
  }

  throw new Error(`Unsupported SMS provider: ${config.provider}`);
}

module.exports = {
  getSmsConfig,
  normalizeGhanaPhone,
  sendSms,
  validateSmsMessage,
};