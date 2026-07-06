const DEFAULT_HUBTEL_BASE_URL = "https://smsc.hubtel.com/v1/messages/send";

function getSmsConfig() {
  return {
    enabled: String(process.env.SMS_ENABLED || "false").toLowerCase() === "true",
    provider: String(process.env.SMS_PROVIDER || "mock").toLowerCase(),
    senderId: process.env.SMS_SENDER_ID || "CHALIN03",
    hubtelClientId: process.env.SMS_HUBTEL_CLIENT_ID || "",
    hubtelClientSecret: process.env.SMS_HUBTEL_CLIENT_SECRET || "",
    hubtelBaseUrl: process.env.SMS_HUBTEL_BASE_URL || DEFAULT_HUBTEL_BASE_URL,
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

  if (digits.startsWith("0")) {
    digits = `233${digits.slice(1)}`;
  }

  if (digits.length === 9) {
    digits = `233${digits}`;
  }

  if (!digits.startsWith("233")) {
    return "";
  }

  if (digits.length < 12 || digits.length > 13) {
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

async function sendSms({ to, message }) {
  const config = getSmsConfig();

  const normalizedTo = normalizeGhanaPhone(to);
  const cleanMessage = validateSmsMessage(message);

  if (!normalizedTo) {
    throw new Error("Invalid Ghana phone number.");
  }

  if (config.provider === "mock") {
    return {
      success: true,
      provider: "mock",
      to: normalizedTo,
      status: "sent",
      providerResponse: {
        message:
          "Mock SMS sent successfully. No real SMS credit was used. Switch SMS_PROVIDER to hubtel for live SMS.",
      },
    };
  }

  if (!config.enabled) {
    throw new Error("SMS is disabled. Set SMS_ENABLED=true in backend .env.");
  }

  if (config.provider !== "hubtel") {
    throw new Error(`Unsupported SMS provider: ${config.provider}`);
  }

  if (!config.hubtelClientId || !config.hubtelClientSecret) {
    throw new Error("Hubtel Client ID and Client Secret are required.");
  }

  if (!config.senderId) {
    throw new Error("SMS sender ID is required.");
  }

  if (typeof fetch !== "function") {
    throw new Error(
      "This backend needs Node.js 18 or newer for SMS sending. Railway should be okay, but check your Node version."
    );
  }

  const authToken = Buffer.from(
    `${config.hubtelClientId}:${config.hubtelClientSecret}`
  ).toString("base64");

  const payload = {
    From: config.senderId,
    To: normalizedTo,
    Content: cleanMessage,
  };

  const response = await fetch(config.hubtelBaseUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();

  let parsedResponse = responseText;

  try {
    parsedResponse = JSON.parse(responseText);
  } catch {
    parsedResponse = responseText;
  }

  if (!response.ok) {
    const error = new Error("Hubtel SMS request failed.");
    error.providerResponse = parsedResponse;
    error.statusCode = response.status;
    throw error;
  }

  return {
    success: true,
    provider: "hubtel",
    to: normalizedTo,
    status: "sent",
    providerResponse: parsedResponse,
  };
}

module.exports = {
  getSmsConfig,
  normalizeGhanaPhone,
  sendSms,
};