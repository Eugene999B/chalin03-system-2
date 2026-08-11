const { pool } = require("../config/db");
const {
  LABEL_BATCH_STATUSES,
  RISK_TIERS,
  TRACEABILITY_STATES,
  TRACKING_MODES,
  UNIT_STATUSES,
  assertTrackingConfiguration,
  assertUnitTransition,
  buildUnitEventHash,
  generateBatchCode,
  generateUnitCode,
  normalizePrintFormat,
  normalizeRiskTier,
  normalizeUnitCode,
} = require("./inventoryTraceabilityService");

const INVENTORY_BEARING_STATUSES = Object.freeze([
  UNIT_STATUSES.LABEL_PENDING,
  UNIT_STATUSES.ACTIVE,
  UNIT_STATUSES.RESERVED_SALE,
  UNIT_STATUSES.IN_TRANSIT,
  UNIT_STATUSES.RETURNED_QUARANTINE,
  UNIT_STATUSES.DAMAGED,
  UNIT_STATUSES.MISSING,
]);

function positiveInt(value, fieldName = "value") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    const error = new Error(`${fieldName} must be a positive whole number.`);
    error.statusCode = 400;
    error.code = "INVALID_TRACEABILITY_NUMBER";
    throw error;
  }
  return number;
}

function cleanText(value, maxLength = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function nullableNumber(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

async function appendUnitEvent(
  connection,
  {
    unitId,
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
  }
) {
  const cleanUnitId = positiveInt(unitId, "unitId");
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanEventType = cleanText(eventType, 50);
  if (!cleanEventType) {
    const error = new Error("Inventory event type is required.");
    error.statusCode = 400;
    error.code = "TRACEABILITY_EVENT_TYPE_REQUIRED";
    throw error;
  }

  const [previousRows] = await connection.query(
    `SELECT event_sequence, event_hash
     FROM inventory_unit_events
     WHERE unit_id = ?
     ORDER BY event_sequence DESC
     LIMIT 1
     FOR UPDATE`,
    [cleanUnitId]
  );

  const previous = previousRows[0] || null;
  const eventSequence = Number(previous?.event_sequence || 0) + 1;
  const previousEventHash = previous?.event_hash || null;
  const eventHash = buildUnitEventHash({
    unitId: cleanUnitId,
    eventSequence,
    branchId: cleanBranchId,
    eventType: cleanEventType,
    fromStatus,
    toStatus,
    sourceType,
    sourceId,
    actorUserId,
    reason,
    requestId,
    metadata,
    previousEventHash,
  });

  const [result] = await connection.query(
    `INSERT INTO inventory_unit_events (
       unit_id,
       event_sequence,
       branch_id,
       event_type,
       from_status,
       to_status,
       source_type,
       source_id,
       actor_user_id,
       reason,
       request_id,
       metadata_json,
       previous_event_hash,
       event_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cleanUnitId,
      eventSequence,
      cleanBranchId,
      cleanEventType,
      cleanText(fromStatus, 30),
      cleanText(toStatus, 30),
      cleanText(sourceType, 40),
      nullableNumber(sourceId),
      nullableNumber(actorUserId),
      cleanText(reason, 500),
      cleanText(requestId, 100),
      metadata === null || metadata === undefined ? null : JSON.stringify(metadata),
      previousEventHash,
      eventHash,
    ]
  );

  return {
    id: result.insertId,
    unit_id: cleanUnitId,
    event_sequence: eventSequence,
    previous_event_hash: previousEventHash,
    event_hash: eventHash,
  };
}

async function getProductTraceabilitySummary(
  connection,
  { branchId, productId, forUpdate = false }
) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanProductId = positiveInt(productId, "productId");
  const [products] = await connection.query(
    `SELECT
       p.id,
       p.branch_id,
       p.name,
       p.size,
       p.category,
       p.quantity,
       p.inventory_tracking_mode,
       p.inventory_product_code,
       p.inventory_risk_tier,
       p.inventory_traceability_state,
       p.inventory_traceability_configured_by,
       p.inventory_traceability_configured_at,
       b.branch_code,
       b.name AS branch_name
     FROM products p
     INNER JOIN branches b ON b.id = p.branch_id
     WHERE p.id = ?
       AND p.branch_id = ?
       AND p.is_active = TRUE
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [cleanProductId, cleanBranchId]
  );

  if (products.length === 0) {
    const error = new Error("Product not found in the selected store.");
    error.statusCode = 404;
    error.code = "TRACEABILITY_PRODUCT_NOT_FOUND";
    throw error;
  }

  const [statusRows] = await connection.query(
    `SELECT status, COUNT(*) AS unit_count
     FROM inventory_units
     WHERE product_id = ?
       AND current_branch_id = ?
     GROUP BY status`,
    [cleanProductId, cleanBranchId]
  );

  const counts = Object.fromEntries(
    Object.values(UNIT_STATUSES).map((status) => [status, 0])
  );
  for (const row of statusRows) {
    counts[row.status] = Number(row.unit_count || 0);
  }

  const systemQuantity = Number(products[0].quantity || 0);
  const activeIdentityCount = Number(counts[UNIT_STATUSES.ACTIVE] || 0);
  const pendingIdentityCount = Number(counts[UNIT_STATUSES.LABEL_PENDING] || 0);
  const inventoryIdentityCount = INVENTORY_BEARING_STATUSES.reduce(
    (sum, status) => sum + Number(counts[status] || 0),
    0
  );
  const identityGap = systemQuantity - inventoryIdentityCount;

  return {
    ...products[0],
    quantity: systemQuantity,
    unit_counts: counts,
    active_identity_count: activeIdentityCount,
    pending_identity_count: pendingIdentityCount,
    inventory_identity_count: inventoryIdentityCount,
    identity_gap: identityGap,
    unidentified_quantity: Math.max(identityGap, 0),
    identity_overage: Math.max(-identityGap, 0),
    ready_for_serialized_enforcement:
      products[0].inventory_tracking_mode === TRACKING_MODES.SERIALIZED &&
      activeIdentityCount === systemQuantity &&
      inventoryIdentityCount === systemQuantity &&
      pendingIdentityCount === 0,
  };
}

async function configureProductTraceability(
  connection,
  {
    branchId,
    productId,
    trackingMode,
    traceabilityState,
    productCode,
    riskTier = RISK_TIERS.STANDARD,
    configuredBy,
  }
) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanProductId = positiveInt(productId, "productId");
  const cleanConfiguredBy = positiveInt(configuredBy, "configuredBy");
  const configuration = assertTrackingConfiguration({
    trackingMode,
    traceabilityState,
    productCode,
  });
  const cleanRiskTier = normalizeRiskTier(riskTier);

  const current = await getProductTraceabilitySummary(connection, {
    branchId: cleanBranchId,
    productId: cleanProductId,
    forUpdate: true,
  });

  const [allUnitRows] = await connection.query(
    `SELECT COUNT(*) AS unit_count
     FROM inventory_units
     WHERE product_id = ?`,
    [cleanProductId]
  );
  const totalUnitRecords = Number(allUnitRows[0]?.unit_count || 0);

  if (
    totalUnitRecords > 0 &&
    current.inventory_product_code &&
    configuration.productCode !== current.inventory_product_code
  ) {
    const error = new Error(
      "The product traceability code cannot change after physical unit identities have been generated."
    );
    error.statusCode = 409;
    error.code = "TRACEABILITY_PRODUCT_CODE_LOCKED";
    throw error;
  }

  if (configuration.trackingMode === TRACKING_MODES.QUANTITY && totalUnitRecords > 0) {
    const error = new Error(
      "This product already has serialized identity history and cannot be downgraded to ordinary quantity tracking."
    );
    error.statusCode = 409;
    error.code = "TRACEABILITY_DOWNGRADE_BLOCKED";
    throw error;
  }

  // Entering enforcement is an explicit admin action and is allowed only when
  // every physical stock unit is represented by one active serialized identity.
  // Once enforced, legitimate lifecycle states (sold, in transit, quarantine) must
  // not prevent an admin from saving unrelated policy fields while keeping enforcement.
  if (
    configuration.traceabilityState === TRACEABILITY_STATES.ENFORCED &&
    configuration.trackingMode === TRACKING_MODES.SERIALIZED &&
    current.inventory_traceability_state !== TRACEABILITY_STATES.ENFORCED &&
    !current.ready_for_serialized_enforcement
  ) {
    const error = new Error(
      `Serialized enforcement requires exactly ${current.quantity} active unit identities and zero non-active stock identities.`
    );
    error.statusCode = 409;
    error.code = "TRACEABILITY_IDENTITY_RECONCILIATION_REQUIRED";
    throw error;
  }

  await connection.query(
    `UPDATE products
     SET inventory_tracking_mode = ?,
         inventory_product_code = ?,
         inventory_risk_tier = ?,
         inventory_traceability_state = ?,
         inventory_traceability_configured_by = ?,
         inventory_traceability_configured_at = NOW()
     WHERE id = ?
       AND branch_id = ?`,
    [
      configuration.trackingMode,
      configuration.productCode,
      cleanRiskTier,
      configuration.traceabilityState,
      cleanConfiguredBy,
      cleanProductId,
      cleanBranchId,
    ]
  );

  return getProductTraceabilitySummary(connection, {
    branchId: cleanBranchId,
    productId: cleanProductId,
  });
}

async function insertUniqueUnit(
  connection,
  {
    branchId,
    productId,
    labelBatchId,
    productCode,
    actorUserId,
    sourceType,
    sourceId,
    sourceItemId,
    unitCodeFactory,
  }
) {
  const maxAttempts = 12;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const unitCode = generateUnitCode(productCode, unitCodeFactory);
    try {
      const [result] = await connection.query(
        `INSERT INTO inventory_units (
           unit_code,
           product_id,
           origin_branch_id,
           current_branch_id,
           label_batch_id,
           status,
           status_changed_at
         ) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          unitCode,
          productId,
          branchId,
          branchId,
          labelBatchId,
          UNIT_STATUSES.LABEL_PENDING,
        ]
      );

      await appendUnitEvent(connection, {
        unitId: result.insertId,
        branchId,
        eventType: "label_generated",
        toStatus: UNIT_STATUSES.LABEL_PENDING,
        sourceType,
        sourceId,
        actorUserId,
        metadata: {
          label_batch_id: labelBatchId,
          source_item_id: sourceItemId || null,
          unit_code: unitCode,
        },
      });

      return { id: result.insertId, unit_code: unitCode };
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY" || attempt === maxAttempts - 1) {
        throw error;
      }
    }
  }

  const error = new Error("Unable to generate a unique inventory unit identity.");
  error.code = "TRACEABILITY_UNIT_CODE_GENERATION_FAILED";
  throw error;
}

async function createSerializedLabelBatch(
  connection,
  {
    branchId,
    productId,
    expectedQuantity,
    sourceType = "opening_reconciliation",
    sourceId = null,
    sourceItemId = null,
    createdBy,
    notes = null,
    batchCodeFactory,
    unitCodeFactory,
  }
) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanProductId = positiveInt(productId, "productId");
  const cleanCreatedBy = positiveInt(createdBy, "createdBy");
  const quantity = positiveInt(expectedQuantity, "expectedQuantity");
  const cleanSourceType = cleanText(sourceType, 40) || "opening_reconciliation";
  const cleanSourceId = nullableNumber(sourceId);
  const cleanSourceItemId = nullableNumber(sourceItemId);

  if (quantity > 2000) {
    const error = new Error("A single label batch cannot exceed 2,000 physical units.");
    error.statusCode = 400;
    error.code = "TRACEABILITY_BATCH_TOO_LARGE";
    throw error;
  }

  // Lock the product row before calculating identity coverage. That serializes
  // competing batch-generation requests for the same product.
  const product = await getProductTraceabilitySummary(connection, {
    branchId: cleanBranchId,
    productId: cleanProductId,
    forUpdate: true,
  });

  if (product.inventory_tracking_mode !== TRACKING_MODES.SERIALIZED) {
    const error = new Error(
      "Label-unit generation is only available for serialized products."
    );
    error.statusCode = 409;
    error.code = "SERIALIZED_TRACKING_REQUIRED";
    throw error;
  }

  if (product.inventory_traceability_state === TRACEABILITY_STATES.OFF) {
    const error = new Error(
      "Put the product into traceability setup before generating labels."
    );
    error.statusCode = 409;
    error.code = "TRACEABILITY_SETUP_REQUIRED";
    throw error;
  }

  if (product.identity_gap <= 0) {
    const error = new Error(
      "All current system stock is already covered by physical identity records. Resolve or void an existing identity before generating another label batch."
    );
    error.statusCode = 409;
    error.code = "TRACEABILITY_NO_IDENTITY_GAP";
    throw error;
  }

  if (quantity > product.identity_gap) {
    const error = new Error(
      `Cannot generate ${quantity} identities when only ${product.identity_gap} unit(s) of system stock remain without identity coverage.`
    );
    error.statusCode = 409;
    error.code = "TRACEABILITY_BATCH_EXCEEDS_IDENTITY_GAP";
    throw error;
  }

  if (cleanSourceId !== null && cleanSourceItemId !== null) {
    const [existingSourceRows] = await connection.query(
      `SELECT id, batch_code, status
       FROM inventory_label_batches
       WHERE branch_id = ?
         AND source_type = ?
         AND source_id = ?
         AND source_item_id = ?
       LIMIT 1
       FOR UPDATE`,
      [cleanBranchId, cleanSourceType, cleanSourceId, cleanSourceItemId]
    );
    if (existingSourceRows.length > 0) {
      const error = new Error(
        `Source item already has controlled label batch ${existingSourceRows[0].batch_code}.`
      );
      error.statusCode = 409;
      error.code = "TRACEABILITY_SOURCE_BATCH_EXISTS";
      error.existingBatch = existingSourceRows[0];
      throw error;
    }
  }

  const batchCode = generateBatchCode(
    product.branch_code,
    new Date(),
    batchCodeFactory
  );
  const [batchResult] = await connection.query(
    `INSERT INTO inventory_label_batches (
       batch_code,
       branch_id,
       product_id,
       source_type,
       source_id,
       source_item_id,
       expected_quantity,
       generated_quantity,
       status,
       created_by,
       notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      batchCode,
      cleanBranchId,
      cleanProductId,
      cleanSourceType,
      cleanSourceId,
      cleanSourceItemId,
      quantity,
      quantity,
      LABEL_BATCH_STATUSES.GENERATED,
      cleanCreatedBy,
      cleanText(notes, 5000),
    ]
  );

  const units = [];
  for (let index = 0; index < quantity; index += 1) {
    units.push(
      await insertUniqueUnit(connection, {
        branchId: cleanBranchId,
        productId: cleanProductId,
        labelBatchId: batchResult.insertId,
        productCode: product.inventory_product_code,
        actorUserId: cleanCreatedBy,
        sourceType: cleanSourceType,
        sourceId: cleanSourceId,
        sourceItemId: cleanSourceItemId,
        unitCodeFactory,
      })
    );
  }

  return {
    id: batchResult.insertId,
    batch_code: batchCode,
    product_id: cleanProductId,
    expected_quantity: quantity,
    generated_quantity: units.length,
    status: LABEL_BATCH_STATUSES.GENERATED,
    identity_gap_before: product.identity_gap,
    identity_gap_after_generation: product.identity_gap - units.length,
    units,
  };
}

async function markLabelBatchPrinted(
  connection,
  {
    branchId,
    batchId,
    printFormat,
    copies = 1,
    printedBy,
    approvedBy = null,
    reason = null,
  }
) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanBatchId = positiveInt(batchId, "batchId");
  const cleanPrintedBy = positiveInt(printedBy, "printedBy");
  const cleanFormat = normalizePrintFormat(printFormat);
  const cleanCopies = positiveInt(copies, "copies");

  if (cleanCopies > 5) {
    const error = new Error(
      "Printing more than five copies requires a separate controlled request."
    );
    error.statusCode = 400;
    error.code = "TRACEABILITY_PRINT_COPY_LIMIT";
    throw error;
  }

  const [batchRows] = await connection.query(
    `SELECT id, status
     FROM inventory_label_batches
     WHERE id = ?
       AND branch_id = ?
     LIMIT 1
     FOR UPDATE`,
    [cleanBatchId, cleanBranchId]
  );

  if (batchRows.length === 0) {
    const error = new Error("Label batch not found in the selected store.");
    error.statusCode = 404;
    error.code = "TRACEABILITY_BATCH_NOT_FOUND";
    throw error;
  }

  if (
    [LABEL_BATCH_STATUSES.ACTIVATED, LABEL_BATCH_STATUSES.CANCELLED].includes(
      batchRows[0].status
    )
  ) {
    const error = new Error(
      "This label batch can no longer be printed as an initial batch."
    );
    error.statusCode = 409;
    error.code = "TRACEABILITY_BATCH_PRINT_LOCKED";
    throw error;
  }

  await connection.query(
    `INSERT INTO inventory_label_print_events (
       branch_id,
       label_batch_id,
       unit_id,
       print_format,
       copies,
       print_reason,
       printed_by,
       approved_by
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    [
      cleanBranchId,
      cleanBatchId,
      cleanFormat,
      cleanCopies,
      cleanText(reason, 500),
      cleanPrintedBy,
      approvedBy ? positiveInt(approvedBy, "approvedBy") : null,
    ]
  );

  await connection.query(
    `UPDATE inventory_label_batches
     SET status = ?,
         label_format = ?,
         printed_by = ?,
         printed_at = NOW()
     WHERE id = ?
       AND branch_id = ?`,
    [
      LABEL_BATCH_STATUSES.PRINTED,
      cleanFormat,
      cleanPrintedBy,
      cleanBatchId,
      cleanBranchId,
    ]
  );

  return {
    id: cleanBatchId,
    status: LABEL_BATCH_STATUSES.PRINTED,
    label_format: cleanFormat,
  };
}

async function activateLabelBatch(
  connection,
  {
    branchId,
    batchId,
    activeUnitCodes,
    voidUnitCodes = [],
    verifiedBy,
    notes = null,
  }
) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanBatchId = positiveInt(batchId, "batchId");
  const cleanVerifiedBy = positiveInt(verifiedBy, "verifiedBy");
  const activeCodes = [...new Set((activeUnitCodes || []).map(normalizeUnitCode))];
  const voidCodes = [...new Set((voidUnitCodes || []).map(normalizeUnitCode))];
  const overlap = activeCodes.filter((code) => voidCodes.includes(code));

  if (overlap.length > 0) {
    const error = new Error(
      "A unit identity cannot be both activated and voided."
    );
    error.statusCode = 400;
    error.code = "TRACEABILITY_ACTIVATION_OVERLAP";
    throw error;
  }

  const [batchRows] = await connection.query(
    `SELECT *
     FROM inventory_label_batches
     WHERE id = ?
       AND branch_id = ?
     LIMIT 1
     FOR UPDATE`,
    [cleanBatchId, cleanBranchId]
  );

  if (batchRows.length === 0) {
    const error = new Error("Label batch not found in the selected store.");
    error.statusCode = 404;
    error.code = "TRACEABILITY_BATCH_NOT_FOUND";
    throw error;
  }

  const batch = batchRows[0];
  if (
    batch.status === LABEL_BATCH_STATUSES.ACTIVATED ||
    batch.status === LABEL_BATCH_STATUSES.CANCELLED
  ) {
    const error = new Error("This label batch is already finalized.");
    error.statusCode = 409;
    error.code = "TRACEABILITY_BATCH_FINALIZED";
    throw error;
  }

  const [units] = await connection.query(
    `SELECT id, unit_code, status
     FROM inventory_units
     WHERE label_batch_id = ?
       AND current_branch_id = ?
     ORDER BY id ASC
     FOR UPDATE`,
    [cleanBatchId, cleanBranchId]
  );

  const generatedCodes = new Set(units.map((unit) => unit.unit_code));
  const suppliedCodes = new Set([...activeCodes, ...voidCodes]);
  if (
    generatedCodes.size !== suppliedCodes.size ||
    [...generatedCodes].some((code) => !suppliedCodes.has(code))
  ) {
    const error = new Error(
      "Every generated label identity must be explicitly confirmed as attached or voided before the batch can be finalized."
    );
    error.statusCode = 409;
    error.code = "TRACEABILITY_BATCH_CONFIRMATION_INCOMPLETE";
    throw error;
  }

  for (const unit of units) {
    if (unit.status !== UNIT_STATUSES.LABEL_PENDING) {
      const error = new Error(
        `Unit ${unit.unit_code} is no longer pending label confirmation.`
      );
      error.statusCode = 409;
      error.code = "TRACEABILITY_UNIT_NOT_PENDING";
      throw error;
    }

    const target = activeCodes.includes(unit.unit_code)
      ? UNIT_STATUSES.ACTIVE
      : UNIT_STATUSES.VOIDED;
    assertUnitTransition(unit.status, target);

    await connection.query(
      `UPDATE inventory_units
       SET status = ?,
           activated_by = CASE WHEN ? = 'active' THEN ? ELSE activated_by END,
           activated_at = CASE WHEN ? = 'active' THEN NOW() ELSE activated_at END,
           last_verified_by = ?,
           last_verified_at = NOW(),
           status_changed_at = NOW()
       WHERE id = ?`,
      [
        target,
        target,
        cleanVerifiedBy,
        target,
        cleanVerifiedBy,
        unit.id,
      ]
    );

    await appendUnitEvent(connection, {
      unitId: unit.id,
      branchId: cleanBranchId,
      eventType:
        target === UNIT_STATUSES.ACTIVE ? "unit_activated" : "label_voided",
      fromStatus: UNIT_STATUSES.LABEL_PENDING,
      toStatus: target,
      sourceType: "label_batch",
      sourceId: cleanBatchId,
      actorUserId: cleanVerifiedBy,
      reason: cleanText(notes, 500),
      metadata: {
        batch_code: batch.batch_code,
        unit_code: unit.unit_code,
      },
    });
  }

  await connection.query(
    `UPDATE inventory_label_batches
     SET status = ?,
         activated_quantity = ?,
         voided_quantity = ?,
         verified_by = ?,
         verified_at = NOW(),
         activated_by = ?,
         activated_at = NOW(),
         notes = COALESCE(?, notes)
     WHERE id = ?
       AND branch_id = ?`,
    [
      LABEL_BATCH_STATUSES.ACTIVATED,
      activeCodes.length,
      voidCodes.length,
      cleanVerifiedBy,
      cleanVerifiedBy,
      cleanText(notes, 5000),
      cleanBatchId,
      cleanBranchId,
    ]
  );

  const product = await getProductTraceabilitySummary(connection, {
    branchId: cleanBranchId,
    productId: batch.product_id,
  });

  return {
    id: cleanBatchId,
    batch_code: batch.batch_code,
    status: LABEL_BATCH_STATUSES.ACTIVATED,
    activated_quantity: activeCodes.length,
    voided_quantity: voidCodes.length,
    product,
  };
}

async function getUnitTraceability(connection, { branchId, unitCode }) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanUnitCode = normalizeUnitCode(unitCode);

  const [units] = await connection.query(
    `SELECT
       u.*,
       p.name AS product_name,
       p.size AS product_size,
       p.category AS product_category,
       p.inventory_product_code,
       p.inventory_risk_tier,
       b.name AS current_branch_name,
       b.branch_code AS current_branch_code,
       ob.name AS origin_branch_name,
       lb.batch_code,
       lb.source_type AS label_source_type,
       lb.source_id AS label_source_id,
       cu.full_name AS custody_user_name,
       au.full_name AS activated_by_name,
       vu.full_name AS last_verified_by_name
     FROM inventory_units u
     INNER JOIN products p ON p.id = u.product_id
     INNER JOIN branches b ON b.id = u.current_branch_id
     INNER JOIN branches ob ON ob.id = u.origin_branch_id
     INNER JOIN inventory_label_batches lb ON lb.id = u.label_batch_id
     LEFT JOIN users cu ON cu.id = u.custody_user_id
     LEFT JOIN users au ON au.id = u.activated_by
     LEFT JOIN users vu ON vu.id = u.last_verified_by
     WHERE u.unit_code = ?
       AND (u.current_branch_id = ? OR u.origin_branch_id = ?)
     LIMIT 1`,
    [cleanUnitCode, cleanBranchId, cleanBranchId]
  );

  if (units.length === 0) {
    const error = new Error(
      "Inventory unit identity was not found for this store."
    );
    error.statusCode = 404;
    error.code = "TRACEABILITY_UNIT_NOT_FOUND";
    throw error;
  }

  const [events] = await connection.query(
    `SELECT
       e.id,
       e.event_sequence,
       e.branch_id,
       e.event_type,
       e.from_status,
       e.to_status,
       e.source_type,
       e.source_id,
       e.actor_user_id,
       e.reason,
       e.request_id,
       e.metadata_json,
       e.previous_event_hash,
       e.event_hash,
       e.created_at,
       actor.full_name AS actor_name,
       branch.name AS branch_name,
       branch.branch_code
     FROM inventory_unit_events e
     LEFT JOIN users actor ON actor.id = e.actor_user_id
     LEFT JOIN branches branch ON branch.id = e.branch_id
     WHERE e.unit_id = ?
     ORDER BY e.event_sequence ASC`,
    [units[0].id]
  );

  return { unit: units[0], events };
}

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  INVENTORY_BEARING_STATUSES,
  activateLabelBatch,
  appendUnitEvent,
  configureProductTraceability,
  createSerializedLabelBatch,
  getProductTraceabilitySummary,
  getUnitTraceability,
  markLabelBatchPrinted,
  positiveInt,
  withTransaction,
};