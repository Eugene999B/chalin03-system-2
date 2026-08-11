const crypto = require("crypto");

const TRACKING_MODES = Object.freeze({
  QUANTITY: "quantity",
  BATCH: "batch",
  SERIALIZED: "serialized",
});

const TRACEABILITY_STATES = Object.freeze({
  OFF: "off",
  SETUP: "setup",
  ENFORCED: "enforced",
});

const RISK_TIERS = Object.freeze({
  STANDARD: "standard",
  ELEVATED: "elevated",
  HIGH: "high",
  CRITICAL: "critical",
});

const UNIT_STATUSES = Object.freeze({
  LABEL_PENDING: "label_pending",
  ACTIVE: "active",
  RESERVED_SALE: "reserved_sale",
  IN_TRANSIT: "in_transit",
  SOLD: "sold",
  RETURNED_QUARANTINE: "returned_quarantine",
  DAMAGED: "damaged",
  MISSING: "missing",
  WRITTEN_OFF: "written_off",
  VOIDED: "voided",
});

const LABEL_BATCH_STATUSES = Object.freeze({
  DRAFT: "draft",
  GENERATED: "generated",
  PRINTED: "printed",
  VERIFICATION: "verification",
  ACTIVATED: "activated",
  CANCELLED: "cancelled",
});

const PRINT_FORMATS = Object.freeze({
  STICKER: "sticker",
  THERMAL: "thermal",
  A4: "a4",
  OTHER: "other",
});

const RANDOM_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PRODUCT_CODE_PATTERN = /^[A-Z0-9]{3,12}$/;
const UNIT_CODE_PATTERN = /^[A-Z0-9]{3,12}-[A-HJ-NP-Z2-9]{8}$/;
const QR_PREFIX = "C03U1";

const TRANSITIONS = Object.freeze({
  [UNIT_STATUSES.LABEL_PENDING]: new Set([
    UNIT_STATUSES.ACTIVE,
    UNIT_STATUSES.VOIDED,
  ]),
  [UNIT_STATUSES.ACTIVE]: new Set([
    UNIT_STATUSES.RESERVED_SALE,
    UNIT_STATUSES.IN_TRANSIT,
    UNIT_STATUSES.RETURNED_QUARANTINE,
    UNIT_STATUSES.DAMAGED,
    UNIT_STATUSES.MISSING,
    UNIT_STATUSES.WRITTEN_OFF,
  ]),
  [UNIT_STATUSES.RESERVED_SALE]: new Set([
    UNIT_STATUSES.ACTIVE,
    UNIT_STATUSES.SOLD,
  ]),
  [UNIT_STATUSES.IN_TRANSIT]: new Set([
    UNIT_STATUSES.ACTIVE,
    UNIT_STATUSES.DAMAGED,
    UNIT_STATUSES.MISSING,
  ]),
  [UNIT_STATUSES.SOLD]: new Set([
    UNIT_STATUSES.RETURNED_QUARANTINE,
  ]),
  [UNIT_STATUSES.RETURNED_QUARANTINE]: new Set([
    UNIT_STATUSES.ACTIVE,
    UNIT_STATUSES.DAMAGED,
    UNIT_STATUSES.WRITTEN_OFF,
  ]),
  [UNIT_STATUSES.DAMAGED]: new Set([
    UNIT_STATUSES.ACTIVE,
    UNIT_STATUSES.WRITTEN_OFF,
  ]),
  [UNIT_STATUSES.MISSING]: new Set([
    UNIT_STATUSES.ACTIVE,
    UNIT_STATUSES.WRITTEN_OFF,
  ]),
  [UNIT_STATUSES.WRITTEN_OFF]: new Set(),
  [UNIT_STATUSES.VOIDED]: new Set(),
});

function cleanText(value) {
  return String(value ?? "").trim();
}

function enumValue(value, allowed, fieldName) {
  const clean = cleanText(value).toLowerCase();
  if (!Object.values(allowed).includes(clean)) {
    const error = new Error(`Invalid ${fieldName}.`);
    error.code = "INVALID_TRACEABILITY_VALUE";
    throw error;
  }
  return clean;
}

function normalizeTrackingMode(value) {
  return enumValue(value, TRACKING_MODES, "inventory tracking mode");
}

function normalizeTraceabilityState(value) {
  return enumValue(value, TRACEABILITY_STATES, "inventory traceability state");
}

function normalizeRiskTier(value) {
  return enumValue(value, RISK_TIERS, "inventory risk tier");
}

function normalizePrintFormat(value) {
  return enumValue(value, PRINT_FORMATS, "label print format");
}

function normalizeProductCode(value) {
  const code = cleanText(value).toUpperCase().replace(/\s+/g, "");
  if (!PRODUCT_CODE_PATTERN.test(code)) {
    const error = new Error(
      "Product traceability code must contain 3-12 uppercase letters/numbers."
    );
    error.code = "INVALID_INVENTORY_PRODUCT_CODE";
    throw error;
  }
  return code;
}

function secureRandomToken(length = 8) {
  const cleanLength = Number(length);
  if (!Number.isInteger(cleanLength) || cleanLength < 6 || cleanLength > 32) {
    throw new Error("Random traceability token length must be between 6 and 32.");
  }

  let output = "";
  for (let index = 0; index < cleanLength; index += 1) {
    output += RANDOM_ALPHABET[crypto.randomInt(0, RANDOM_ALPHABET.length)];
  }
  return output;
}

function generateUnitCode(productCode, tokenFactory = () => secureRandomToken(8)) {
  const code = normalizeProductCode(productCode);
  const token = cleanText(tokenFactory()).toUpperCase();
  if (!new RegExp(`^[${RANDOM_ALPHABET}]{8}$`).test(token)) {
    const error = new Error("Generated inventory unit token is invalid.");
    error.code = "INVALID_INVENTORY_UNIT_TOKEN";
    throw error;
  }
  return `${code}-${token}`;
}

function normalizeUnitCode(value) {
  const unitCode = cleanText(value).toUpperCase();
  if (!UNIT_CODE_PATTERN.test(unitCode)) {
    const error = new Error("Inventory unit code format is invalid.");
    error.code = "INVALID_INVENTORY_UNIT_CODE";
    throw error;
  }
  return unitCode;
}

function generateBatchCode(branchCode, now = new Date(), tokenFactory = () => secureRandomToken(6)) {
  const cleanBranch = cleanText(branchCode)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8) || "STORE";
  const date = now instanceof Date && !Number.isNaN(now.getTime())
    ? now.toISOString().slice(0, 10).replace(/-/g, "")
    : new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const token = cleanText(tokenFactory()).toUpperCase();
  if (!new RegExp(`^[${RANDOM_ALPHABET}]{6}$`).test(token)) {
    throw new Error("Generated inventory label-batch token is invalid.");
  }
  return `LBL-${cleanBranch}-${date}-${token}`;
}

function assertTrackingConfiguration({ trackingMode, traceabilityState, productCode }) {
  const mode = normalizeTrackingMode(trackingMode);
  const state = normalizeTraceabilityState(traceabilityState);

  // Exact-ID checkout enforcement is only meaningful for serialized products.
  // The repository service separately verifies physical identity reconciliation
  // before a product is allowed to enter ENFORCED for the first time.
  if (
    state === TRACEABILITY_STATES.ENFORCED &&
    mode !== TRACKING_MODES.SERIALIZED
  ) {
    const error = new Error(
      "Exact-ID enforcement is available only for serialized products."
    );
    error.statusCode = 409;
    error.code = "TRACEABILITY_ENFORCEMENT_REQUIRES_SERIALIZED";
    throw error;
  }

  const code = mode === TRACKING_MODES.QUANTITY && !cleanText(productCode)
    ? null
    : normalizeProductCode(productCode);

  if (mode !== TRACKING_MODES.QUANTITY && !code) {
    const error = new Error("Batch/serialized products require a product traceability code.");
    error.code = "INVENTORY_PRODUCT_CODE_REQUIRED";
    throw error;
  }

  return { trackingMode: mode, traceabilityState: state, productCode: code };
}

function canTransitionUnit(fromStatus, toStatus) {
  const from = cleanText(fromStatus).toLowerCase();
  const to = cleanText(toStatus).toLowerCase();
  if (!Object.values(UNIT_STATUSES).includes(from) || !Object.values(UNIT_STATUSES).includes(to)) {
    return false;
  }
  if (from === to) return true;
  return TRANSITIONS[from]?.has(to) === true;
}

function assertUnitTransition(fromStatus, toStatus) {
  if (!canTransitionUnit(fromStatus, toStatus)) {
    const error = new Error(`Inventory unit cannot move from ${fromStatus} to ${toStatus}.`);
    error.code = "INVALID_INVENTORY_UNIT_TRANSITION";
    throw error;
  }
  return true;
}

function requireLabelSigningSecret(secret = process.env.INVENTORY_LABEL_SIGNING_SECRET) {
  const clean = cleanText(secret);
  if (Buffer.byteLength(clean, "utf8") < 32) {
    const error = new Error(
      "INVENTORY_LABEL_SIGNING_SECRET must be configured with at least 32 bytes before signed inventory labels can be generated."
    );
    error.code = "INVENTORY_LABEL_SIGNING_SECRET_REQUIRED";
    throw error;
  }
  return clean;
}

function labelSignature(unitCode, secret) {
  const normalized = normalizeUnitCode(unitCode);
  const signingSecret = requireLabelSigningSecret(secret);
  return crypto
    .createHmac("sha256", signingSecret)
    .update(`${QR_PREFIX}|${normalized}`, "utf8")
    .digest("base64url")
    .slice(0, 22);
}

function buildSignedLabelPayload(unitCode, secret) {
  const normalized = normalizeUnitCode(unitCode);
  return `${QR_PREFIX}|${normalized}|${labelSignature(normalized, secret)}`;
}

function verifySignedLabelPayload(payload, secret) {
  const parts = cleanText(payload).split("|");
  if (parts.length !== 3 || parts[0] !== QR_PREFIX) {
    return { valid: false, unitCode: null, reason: "format" };
  }

  let normalized;
  try {
    normalized = normalizeUnitCode(parts[1]);
  } catch {
    return { valid: false, unitCode: null, reason: "unit_code" };
  }

  let expected;
  try {
    expected = labelSignature(normalized, secret);
  } catch (error) {
    return { valid: false, unitCode: normalized, reason: error.code || "secret" };
  }

  const receivedBuffer = Buffer.from(parts[2]);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) {
    return { valid: false, unitCode: normalized, reason: "signature" };
  }

  const valid = crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
  return { valid, unitCode: normalized, reason: valid ? null : "signature" };
}

function stableJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildUnitEventHash({
  unitId,
  eventSequence,
  branchId,
  eventType,
  fromStatus = null,
  toStatus = null,
  sourceType = null,
  sourceId = null,
  actorUserId = null,
  reason = null,
  requestId = null,
  metadata = null,
  previousEventHash = null,
}) {
  const canonical = stableJson({
    unitId: Number(unitId),
    eventSequence: Number(eventSequence),
    branchId: Number(branchId),
    eventType: cleanText(eventType),
    fromStatus: fromStatus ? cleanText(fromStatus).toLowerCase() : null,
    toStatus: toStatus ? cleanText(toStatus).toLowerCase() : null,
    sourceType: sourceType ? cleanText(sourceType) : null,
    sourceId: sourceId === null || sourceId === undefined ? null : Number(sourceId),
    actorUserId: actorUserId === null || actorUserId === undefined ? null : Number(actorUserId),
    reason: reason ? cleanText(reason) : null,
    requestId: requestId ? cleanText(requestId) : null,
    metadata: metadata ?? null,
    previousEventHash: previousEventHash ? cleanText(previousEventHash).toLowerCase() : null,
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

module.exports = {
  LABEL_BATCH_STATUSES,
  PRINT_FORMATS,
  PRODUCT_CODE_PATTERN,
  QR_PREFIX,
  RANDOM_ALPHABET,
  RISK_TIERS,
  TRACEABILITY_STATES,
  TRACKING_MODES,
  TRANSITIONS,
  UNIT_CODE_PATTERN,
  UNIT_STATUSES,
  assertTrackingConfiguration,
  assertUnitTransition,
  buildSignedLabelPayload,
  buildUnitEventHash,
  canTransitionUnit,
  generateBatchCode,
  generateUnitCode,
  labelSignature,
  normalizePrintFormat,
  normalizeProductCode,
  normalizeRiskTier,
  normalizeTraceabilityState,
  normalizeTrackingMode,
  normalizeUnitCode,
  requireLabelSigningSecret,
  secureRandomToken,
  stableJson,
  verifySignedLabelPayload,
};