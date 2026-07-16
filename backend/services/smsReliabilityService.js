const GSM_BASIC_CHARACTERS = new Set(
  [
    "@", "£", "$", "¥", "è", "é", "ù", "ì", "ò", "Ç", "\n", "Ø", "ø", "\r", "Å", "å",
    "Δ", "_", "Φ", "Γ", "Λ", "Ω", "Π", "Ψ", "Σ", "Θ", "Ξ", "Æ", "æ", "ß", "É",
    " ", "!", '"', "#", "¤", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":", ";", "<", "=", ">", "?",
    "¡", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
    "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "Ä", "Ö", "Ñ", "Ü", "§",
    "¿", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
    "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "ä", "ö", "ñ", "ü", "à",
  ]
);

const GSM_EXTENDED_CHARACTERS = new Set(["^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

const SUCCESS_STATUSES = new Set([
  "success",
  "successful",
  "accepted",
  "submitted",
  "queued",
  "queue",
  "pending",
  "processing",
  "sent",
  "ok",
]);

const DELIVERED_STATUSES = new Set([
  "delivered",
  "delivery_success",
  "delivery successful",
  "success_delivered",
]);

const UNDELIVERED_STATUSES = new Set([
  "undelivered",
  "not_delivered",
  "delivery_failed",
  "rejected",
  "bounced",
  "blocked",
]);

const EXPIRED_STATUSES = new Set(["expired", "ttl_expired", "timed_out", "timeout"]);
const FAILED_STATUSES = new Set(["failed", "failure", "error", "invalid", "cancelled", "canceled"]);

function cleanStatus(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function estimateSmsSegments(message) {
  const text = String(message || "");

  if (!text) {
    return {
      encoding: "gsm7",
      character_count: 0,
      encoded_length: 0,
      segment_count: 1,
      estimated_credits: 1,
    };
  }

  let gsmSeptets = 0;
  let isGsm7 = true;

  for (const character of text) {
    if (GSM_BASIC_CHARACTERS.has(character)) {
      gsmSeptets += 1;
    } else if (GSM_EXTENDED_CHARACTERS.has(character)) {
      gsmSeptets += 2;
    } else {
      isGsm7 = false;
      break;
    }
  }

  if (isGsm7) {
    const segmentCount = gsmSeptets <= 160 ? 1 : Math.ceil(gsmSeptets / 153);

    return {
      encoding: "gsm7",
      character_count: [...text].length,
      encoded_length: gsmSeptets,
      segment_count: Math.max(segmentCount, 1),
      estimated_credits: Math.max(segmentCount, 1),
    };
  }

  const unicodeLength = [...text].length;
  const segmentCount = unicodeLength <= 70 ? 1 : Math.ceil(unicodeLength / 67);

  return {
    encoding: "unicode",
    character_count: unicodeLength,
    encoded_length: unicodeLength,
    segment_count: Math.max(segmentCount, 1),
    estimated_credits: Math.max(segmentCount, 1),
  };
}

function visitObject(value, visitor, depth = 0, visited = new Set()) {
  if (value === null || value === undefined || depth > 8) {
    return undefined;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  if (visited.has(value)) {
    return undefined;
  }

  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = visitObject(item, visitor, depth + 1, visited);
      if (result !== undefined && result !== null && result !== "") {
        return result;
      }
    }

    return undefined;
  }

  const directResult = visitor(value);
  if (directResult !== undefined && directResult !== null && directResult !== "") {
    return directResult;
  }

  for (const nestedValue of Object.values(value)) {
    const result = visitObject(nestedValue, visitor, depth + 1, visited);
    if (result !== undefined && result !== null && result !== "") {
      return result;
    }
  }

  return undefined;
}

function extractProviderMessageId(providerResponse) {
  const candidate = visitObject(providerResponse, (object) => {
    const keys = [
      "message_id",
      "messageId",
      "messageID",
      "sms_id",
      "smsId",
      "request_id",
      "requestId",
      "reference_id",
      "referenceId",
      "reference",
      "batch_id",
      "batchId",
      "id",
    ];

    for (const key of keys) {
      const value = object[key];
      if (["string", "number"].includes(typeof value) && String(value).trim()) {
        return String(value).trim();
      }
    }

    return undefined;
  });

  return candidate ? String(candidate).slice(0, 191) : "";
}

function extractProviderStatus(providerResponse) {
  const candidate = visitObject(providerResponse, (object) => {
    const keys = [
      "delivery_status",
      "deliveryStatus",
      "message_status",
      "messageStatus",
      "state",
      "status",
      "status_text",
      "statusText",
    ];

    for (const key of keys) {
      const value = object[key];
      if (["string", "number", "boolean"].includes(typeof value) && String(value).trim()) {
        return String(value).trim();
      }
    }

    return undefined;
  });

  return candidate ? String(candidate).slice(0, 80) : "";
}

function normalizeSmsDeliveryStatus(value, fallback = "delivery_unknown") {
  const status = cleanStatus(value);

  if (!status) {
    return fallback;
  }

  if (DELIVERED_STATUSES.has(status) || status.includes("delivered")) {
    if (status.includes("not_") || status.includes("un")) {
      return "undelivered";
    }
    return "delivered";
  }

  if (UNDELIVERED_STATUSES.has(status)) {
    return "undelivered";
  }

  if (EXPIRED_STATUSES.has(status) || status.includes("expired")) {
    return "expired";
  }

  if (FAILED_STATUSES.has(status)) {
    return "failed";
  }

  if (SUCCESS_STATUSES.has(status)) {
    return "accepted";
  }

  return fallback;
}

function hasExplicitProviderFailure(providerResponse) {
  if (!providerResponse || typeof providerResponse !== "object") {
    return false;
  }

  const errorValue = visitObject(providerResponse, (object) => {
    if (object.success === false || object.ok === false) {
      return true;
    }

    const keys = ["error", "errors", "failure", "failed"];
    for (const key of keys) {
      if (object[key]) {
        return true;
      }
    }

    return undefined;
  });

  if (errorValue === true) {
    return true;
  }

  const normalized = normalizeSmsDeliveryStatus(
    extractProviderStatus(providerResponse),
    "delivery_unknown"
  );

  return ["failed", "undelivered", "expired"].includes(normalized);
}

function buildSmsEvidence({ providerResponse, message, provider, senderId }) {
  const metrics = estimateSmsSegments(message);
  const providerStatus = extractProviderStatus(providerResponse);
  const normalizedStatus = normalizeSmsDeliveryStatus(
    providerStatus,
    provider === "mock" ? "delivery_unknown" : "accepted"
  );

  return {
    status: normalizedStatus,
    provider_status: providerStatus || null,
    provider_message_id: extractProviderMessageId(providerResponse) || null,
    provider: provider || null,
    sender_id: senderId || null,
    ...metrics,
  };
}

function applySmsStatusTransition(currentStatus, incomingStatus) {
  const current = String(currentStatus || "pending").toLowerCase();
  const incoming = String(incomingStatus || "delivery_unknown").toLowerCase();

  if (current === "delivered") {
    return "delivered";
  }

  if (incoming === "delivered") {
    return "delivered";
  }

  if (
    ["undelivered", "expired", "failed"].includes(current) &&
    ["pending", "accepted", "delivery_unknown"].includes(incoming)
  ) {
    return current;
  }

  return incoming;
}

function isSubmissionAccepted(status) {
  return ["accepted", "delivered", "delivery_unknown"].includes(
    String(status || "").toLowerCase()
  );
}

function humanizeSmsStatus(status) {
  const labels = {
    pending: "Pending submission",
    accepted: "Accepted by provider",
    delivered: "Delivered",
    undelivered: "Undelivered",
    expired: "Expired",
    failed: "Failed",
    delivery_unknown: "Delivery unknown",
  };

  return labels[String(status || "").toLowerCase()] || "Delivery unknown";
}

module.exports = {
  applySmsStatusTransition,
  buildSmsEvidence,
  estimateSmsSegments,
  extractProviderMessageId,
  extractProviderStatus,
  hasExplicitProviderFailure,
  humanizeSmsStatus,
  isSubmissionAccepted,
  normalizeSmsDeliveryStatus,
};
