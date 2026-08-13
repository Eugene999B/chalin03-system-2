const STUDIO_PRINT_FORMATS = Object.freeze(["a4", "thermal", "sticker", "compact"]);
const STUDIO_LABEL_STYLES = Object.freeze(["compact", "standard", "detailed"]);
const STUDIO_MAX_SELECTION = 500;
const AUTOMATIC_ID_BATCH_LIMIT = 2000;

function automaticProductCode(product) {
  if (product?.inventory_product_code) {
    return String(product.inventory_product_code).trim().toUpperCase();
  }

  const idSuffix = Math.max(Number(product?.id || 0), 1)
    .toString(36)
    .toUpperCase()
    .slice(-5);
  const source = `${product?.name || ""}${product?.size || ""}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "") || "PRD";
  const prefixLength = Math.max(3, 12 - idSuffix.length);
  let prefix = source.slice(0, prefixLength);
  if (prefix.length < 3) prefix = `${prefix}PRD`.slice(0, 3);
  return `${prefix}${idSuffix}`.slice(0, 12);
}

async function ensureAutomaticIdentityProfile(connection, {
  branchId,
  productId,
  actorUserId,
}) {
  const {
    RISK_TIERS,
    TRACEABILITY_STATES,
    TRACKING_MODES,
  } = require("./inventoryTraceabilityService");
  const {
    configureProductTraceability,
    getProductTraceabilitySummary,
  } = require("./inventoryTraceabilityRepositoryService");

  let product = await getProductTraceabilitySummary(connection, {
    branchId,
    productId,
    forUpdate: true,
  });

  if (
    product.inventory_tracking_mode === TRACKING_MODES.SERIALIZED &&
    product.inventory_product_code &&
    product.inventory_traceability_state !== TRACEABILITY_STATES.OFF
  ) {
    return product;
  }

  product = await configureProductTraceability(connection, {
    branchId,
    productId,
    trackingMode: TRACKING_MODES.SERIALIZED,
    traceabilityState:
      product.inventory_traceability_state === TRACEABILITY_STATES.ENFORCED
        ? TRACEABILITY_STATES.ENFORCED
        : TRACEABILITY_STATES.SETUP,
    productCode: automaticProductCode(product),
    riskTier: product.inventory_risk_tier || RISK_TIERS.STANDARD,
    configuredBy: actorUserId,
  });

  return product;
}

async function createAutomaticIdentityBatches(connection, {
  branchId,
  productId,
  actorUserId,
  quantity,
  sourceType,
  sourceId = null,
  sourceItemId = null,
  notes = null,
}) {
  const {
    createSerializedLabelBatch,
  } = require("./inventoryTraceabilityRepositoryService");

  let remaining = Number(quantity || 0);
  if (!Number.isInteger(remaining) || remaining < 0) {
    const error = new Error("Automatic identity quantity must be a non-negative whole number.");
    error.statusCode = 400;
    error.code = "AUTOMATIC_IDENTITY_INVALID_QUANTITY";
    throw error;
  }
  if (remaining === 0) return [];

  await ensureAutomaticIdentityProfile(connection, {
    branchId,
    productId,
    actorUserId,
  });

  const batches = [];
  let chunkIndex = 0;
  while (remaining > 0) {
    const chunk = Math.min(remaining, AUTOMATIC_ID_BATCH_LIMIT);
    const batch = await createSerializedLabelBatch(connection, {
      branchId,
      productId,
      expectedQuantity: chunk,
      sourceType,
      sourceId,
      sourceItemId: chunkIndex === 0 ? sourceItemId : null,
      createdBy: actorUserId,
      notes: [
        notes,
        chunkIndex > 0 ? `Automatic identity batch ${chunkIndex + 1}.` : null,
      ]
        .filter(Boolean)
        .join(" ") || null,
    });
    batches.push(batch);
    remaining -= chunk;
    chunkIndex += 1;
  }
  return batches;
}

async function reconcileAutomaticIdentityCoverage(connection, {
  branchId,
  productId,
  actorUserId,
  notes = "Automatic identity coverage for existing stock.",
}) {
  const {
    createSerializedLabelBatch,
    getProductTraceabilitySummary,
  } = require("./inventoryTraceabilityRepositoryService");

  let product = await ensureAutomaticIdentityProfile(connection, {
    branchId,
    productId,
    actorUserId,
  });
  let gap = Math.max(0, Number(product.identity_gap || 0));
  const batches = [];

  while (gap > 0) {
    const chunk = Math.min(gap, AUTOMATIC_ID_BATCH_LIMIT);
    const batch = await createSerializedLabelBatch(connection, {
      branchId,
      productId,
      expectedQuantity: chunk,
      sourceType: "opening_reconciliation",
      createdBy: actorUserId,
      notes,
    });
    batches.push(batch);
    gap -= chunk;
  }

  product = await getProductTraceabilitySummary(connection, {
    branchId,
    productId,
  });

  return {
    product,
    generated_quantity: batches.reduce(
      (sum, batch) => sum + Number(batch.generated_quantity || 0),
      0
    ),
    batches,
  };
}

module.exports = {
  AUTOMATIC_ID_BATCH_LIMIT,
  STUDIO_PRINT_FORMATS,
  STUDIO_LABEL_STYLES,
  STUDIO_MAX_SELECTION,
  automaticProductCode,
  createAutomaticIdentityBatches,
  ensureAutomaticIdentityProfile,
  reconcileAutomaticIdentityCoverage,
};
