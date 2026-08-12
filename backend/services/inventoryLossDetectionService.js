const { pool } = require("../config/db");
const {
  normalizeUnitCode,
  secureRandomToken,
  verifySignedLabelPayload,
} = require("./inventoryTraceabilityService");

const COUNT_TYPES = Object.freeze({
  BLIND_CYCLE: "blind_cycle",
  FULL_COUNT: "full_count",
  SPOT_CHECK: "spot_check",
  HANDOVER: "handover",
});

const SELECTION_METHODS = Object.freeze({
  MANUAL: "manual",
  RANDOM_RISK: "random_risk",
  RANDOM_ALL: "random_all",
  SYSTEM_ALERT: "system_alert",
  HANDOVER: "handover",
});

const COUNT_EXPECTED_UNIT_STATUSES = Object.freeze([
  "active",
  "reserved_sale",
  "returned_quarantine",
  "damaged",
  "missing",
]);

const INVESTIGATION_RESOLUTIONS = Object.freeze([
  "found",
  "count_error",
  "transfer_issue",
  "damage",
  "confirmed_loss",
  "other",
]);

function lossError(message, statusCode = 400, code = "INVENTORY_LOSS_CONTROL_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function positiveInt(value, fieldName = "value") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw lossError(`${fieldName} must be a positive whole number.`, 400, "INVALID_LOSS_CONTROL_NUMBER");
  }
  return number;
}

function nonNegativeInt(value, fieldName = "value") {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw lossError(`${fieldName} must be a whole number of zero or more.`, 400, "INVALID_LOSS_CONTROL_NUMBER");
  }
  return number;
}

function cleanText(value, max = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function enumValue(value, allowed, fieldName) {
  const clean = String(value || "").trim().toLowerCase();
  if (!allowed.includes(clean)) {
    throw lossError(`Invalid ${fieldName}.`, 400, "INVALID_LOSS_CONTROL_VALUE");
  }
  return clean;
}

function normalizeCountType(value) {
  return enumValue(value || COUNT_TYPES.BLIND_CYCLE, Object.values(COUNT_TYPES), "count type");
}

function normalizeSelectionMethod(value) {
  return enumValue(value || SELECTION_METHODS.MANUAL, Object.values(SELECTION_METHODS), "selection method");
}

function normalizeResolution(value) {
  return enumValue(value, INVESTIGATION_RESOLUTIONS, "investigation resolution");
}

function riskSeverity(riskTier, kind = "shortage") {
  const risk = String(riskTier || "standard").toLowerCase();
  if (risk === "critical") return kind === "missing_unit" ? "critical" : "high";
  if (risk === "high") return "high";
  if (risk === "elevated") return "review";
  return "review";
}

function compactBranchCode(value) {
  return String(value || "STORE")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8) || "STORE";
}

function dateToken(now = new Date()) {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

function generateCountSessionCode(branchCode, now = new Date(), tokenFactory = () => secureRandomToken(6)) {
  return `CNT-${compactBranchCode(branchCode)}-${dateToken(now)}-${String(tokenFactory()).toUpperCase()}`;
}

function generateInvestigationCode(branchCode, now = new Date(), tokenFactory = () => secureRandomToken(6)) {
  return `INV-${compactBranchCode(branchCode)}-${dateToken(now)}-${String(tokenFactory()).toUpperCase()}`;
}

function generateHandoverCode(branchCode, now = new Date(), tokenFactory = () => secureRandomToken(6)) {
  return `HOV-${compactBranchCode(branchCode)}-${dateToken(now)}-${String(tokenFactory()).toUpperCase()}`;
}

function normalizeScanValue(value) {
  const raw = cleanText(value, 240);
  if (!raw) {
    throw lossError("Scan or enter an inventory unit ID.", 400, "INVENTORY_UNIT_ID_REQUIRED");
  }
  if (raw.startsWith("C03U1|")) {
    const signed = verifySignedLabelPayload(raw);
    if (!signed.valid) {
      throw lossError(
        `The inventory label signature is invalid (${signed.reason}).`,
        400,
        "INVALID_INVENTORY_LABEL"
      );
    }
    return { unitCode: signed.unitCode, signed: true };
  }
  return { unitCode: normalizeUnitCode(raw), signed: false };
}

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Keep the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function loadBranch(connection, branchId) {
  const id = positiveInt(branchId, "branchId");
  const [rows] = await connection.query(
    `SELECT id, branch_code, name
     FROM branches
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  if (!rows[0]) throw lossError("Selected store was not found.", 404, "LOSS_CONTROL_BRANCH_NOT_FOUND");
  return rows[0];
}

async function loadCountSessionForUpdate(connection, { branchId, sessionId }) {
  const [rows] = await connection.query(
    `SELECT *
     FROM inventory_count_sessions
     WHERE id = ? AND branch_id = ?
     LIMIT 1
     FOR UPDATE`,
    [positiveInt(sessionId, "sessionId"), positiveInt(branchId, "branchId")]
  );
  if (!rows[0]) throw lossError("Inventory count session was not found in this store.", 404, "COUNT_SESSION_NOT_FOUND");
  return rows[0];
}

async function loadExpectedSerializedUnits(connection, { branchId, productId }) {
  const placeholders = COUNT_EXPECTED_UNIT_STATUSES.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT
       u.id,
       u.unit_code,
       u.status,
       u.current_location,
       u.custody_user_id,
       (
         SELECT e.id
         FROM inventory_unit_events e
         WHERE e.unit_id = u.id
         ORDER BY e.event_sequence DESC
         LIMIT 1
       ) AS last_event_id,
       (
         SELECT e.created_at
         FROM inventory_unit_events e
         WHERE e.unit_id = u.id
         ORDER BY e.event_sequence DESC
         LIMIT 1
       ) AS last_event_at
     FROM inventory_units u
     WHERE u.product_id = ?
       AND u.current_branch_id = ?
       AND u.status IN (${placeholders})
     ORDER BY u.id ASC
     FOR UPDATE`,
    [positiveInt(productId, "productId"), positiveInt(branchId, "branchId"), ...COUNT_EXPECTED_UNIT_STATUSES]
  );
  return rows;
}

async function createBlindCountSession({
  branchId,
  productIds,
  createdBy,
  countType = COUNT_TYPES.BLIND_CYCLE,
  selectionMethod = SELECTION_METHODS.MANUAL,
  reason = null,
  areaLabel = null,
  notes = null,
}) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanCreatedBy = positiveInt(createdBy, "createdBy");
  const cleanCountType = normalizeCountType(countType);
  const cleanSelectionMethod = normalizeSelectionMethod(selectionMethod);
  const ids = [...new Set((productIds || []).map((value) => positiveInt(value, "productId")))];
  if (ids.length === 0) {
    throw lossError("Choose at least one product for the blind count.", 400, "COUNT_PRODUCTS_REQUIRED");
  }
  if (ids.length > 100) {
    throw lossError("A single blind count cannot contain more than 100 products.", 400, "COUNT_SCOPE_TOO_LARGE");
  }

  return withTransaction(async (connection) => {
    const branch = await loadBranch(connection, cleanBranchId);
    const placeholders = ids.map(() => "?").join(", ");
    const [products] = await connection.query(
      `SELECT
         id,
         name,
         quantity,
         inventory_tracking_mode,
         inventory_risk_tier,
         inventory_traceability_state
       FROM products
       WHERE branch_id = ?
         AND is_active = TRUE
         AND id IN (${placeholders})
       ORDER BY id ASC
       FOR UPDATE`,
      [cleanBranchId, ...ids]
    );
    if (products.length !== ids.length) {
      throw lossError(
        "One or more selected products are missing, inactive, or belong to another store.",
        409,
        "COUNT_SCOPE_PRODUCT_MISMATCH"
      );
    }

    const sessionCode = generateCountSessionCode(branch.branch_code);
    const [sessionResult] = await connection.query(
      `INSERT INTO inventory_count_sessions (
         session_code, branch_id, count_type, status, blind_mode,
         selection_method, reason, area_label, created_by, started_by,
         started_at, notes
       ) VALUES (?, ?, ?, 'open', 1, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        sessionCode,
        cleanBranchId,
        cleanCountType,
        cleanSelectionMethod,
        cleanText(reason, 500),
        cleanText(areaLabel, 120),
        cleanCreatedBy,
        cleanCreatedBy,
        cleanText(notes, 5000),
      ]
    );

    const scopes = [];
    for (let index = 0; index < products.length; index += 1) {
      const product = products[index];
      let expectedUnits = [];
      if (product.inventory_tracking_mode === "serialized") {
        expectedUnits = await loadExpectedSerializedUnits(connection, {
          branchId: cleanBranchId,
          productId: product.id,
        });
        if (expectedUnits.length !== Number(product.quantity || 0)) {
          throw lossError(
            `${product.name} cannot enter an exact serialized blind count yet. System quantity is ${Number(product.quantity || 0)}, but ${expectedUnits.length} countable physical identities are frozen for this store. Reconcile identity coverage first.`,
            409,
            "COUNT_SERIALIZED_IDENTITY_COVERAGE_REQUIRED"
          );
        }
      }

      const [scopeResult] = await connection.query(
        `INSERT INTO inventory_count_scope (
           session_id, product_id, expected_system_quantity,
           expected_identity_count, tracking_mode_snapshot,
           risk_tier_snapshot, expected_snapshot_at, sequence_number
         ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          sessionResult.insertId,
          product.id,
          Number(product.quantity || 0),
          expectedUnits.length,
          product.inventory_tracking_mode || "quantity",
          product.inventory_risk_tier || "standard",
          index + 1,
        ]
      );

      for (const unit of expectedUnits) {
        await connection.query(
          `INSERT INTO inventory_count_expected_units (
             session_id, scope_id, branch_id, product_id, unit_id,
             unit_code_snapshot, status_snapshot, current_location_snapshot,
             custody_user_id_snapshot, last_event_id_snapshot,
             last_event_at_snapshot, snapshot_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            sessionResult.insertId,
            scopeResult.insertId,
            cleanBranchId,
            product.id,
            unit.id,
            unit.unit_code,
            unit.status,
            unit.current_location || null,
            unit.custody_user_id || null,
            unit.last_event_id || null,
            unit.last_event_at || null,
          ]
        );
      }

      scopes.push({
        id: scopeResult.insertId,
        product_id: product.id,
        product_name: product.name,
        tracking_mode: product.inventory_tracking_mode || "quantity",
        risk_tier: product.inventory_risk_tier || "standard",
      });
    }

    return {
      id: sessionResult.insertId,
      session_code: sessionCode,
      status: "open",
      blind_mode: true,
      branch_id: cleanBranchId,
      branch_code: branch.branch_code,
      scopes,
    };
  });
}

async function recordSerializedObservation({
  branchId,
  sessionId,
  value,
  observedBy,
  deviceNote = null,
}) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanSessionId = positiveInt(sessionId, "sessionId");
  const cleanObservedBy = positiveInt(observedBy, "observedBy");
  const decoded = normalizeScanValue(value);

  return withTransaction(async (connection) => {
    const session = await loadCountSessionForUpdate(connection, {
      branchId: cleanBranchId,
      sessionId: cleanSessionId,
    });
    if (session.status !== "open") {
      throw lossError("This blind count is no longer open for scanning.", 409, "COUNT_SESSION_NOT_OPEN");
    }

    const [units] = await connection.query(
      `SELECT id, unit_code, product_id, current_branch_id, status
       FROM inventory_units
       WHERE unit_code = ?
       LIMIT 1
       FOR UPDATE`,
      [decoded.unitCode]
    );
    const unit = units[0];
    if (!unit) {
      throw lossError("The scanned inventory identity does not exist.", 404, "COUNT_UNIT_NOT_FOUND");
    }

    const [scopeRows] = await connection.query(
      `SELECT id, product_id, tracking_mode_snapshot
       FROM inventory_count_scope
       WHERE session_id = ? AND product_id = ?
       LIMIT 1`,
      [cleanSessionId, unit.product_id]
    );
    const scope = scopeRows[0];
    if (!scope) {
      throw lossError(
        "This physical unit belongs to a product outside the blind-count scope.",
        409,
        "COUNT_UNIT_OUT_OF_SCOPE"
      );
    }
    if (scope.tracking_mode_snapshot !== "serialized") {
      throw lossError(
        "This product is not using exact serialized counting in this session.",
        409,
        "COUNT_SERIALIZED_SCAN_NOT_ALLOWED"
      );
    }

    const [duplicateRows] = await connection.query(
      `SELECT id
       FROM inventory_count_observations
       WHERE session_id = ? AND unit_id = ?
         AND validation_status IN ('accepted', 'unexpected', 'wrong_store')
       LIMIT 1`,
      [cleanSessionId, unit.id]
    );

    let validationStatus = "accepted";
    if (duplicateRows.length > 0) {
      validationStatus = "duplicate";
    } else if (Number(unit.current_branch_id) !== cleanBranchId) {
      validationStatus = "wrong_store";
    } else {
      const [expectedRows] = await connection.query(
        `SELECT id
         FROM inventory_count_expected_units
         WHERE session_id = ? AND scope_id = ? AND unit_id = ?
         LIMIT 1`,
        [cleanSessionId, scope.id, unit.id]
      );
      if (expectedRows.length === 0) validationStatus = "unexpected";
    }

    const [result] = await connection.query(
      `INSERT INTO inventory_count_observations (
         session_id, scope_id, product_id, unit_id, unit_code_snapshot,
         observation_type, quantity_observed, validation_status,
         observed_by, device_note, metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [
        cleanSessionId,
        scope.id,
        unit.product_id,
        unit.id,
        unit.unit_code,
        decoded.signed ? "unit_scan" : "manual_unit_id",
        validationStatus,
        cleanObservedBy,
        cleanText(deviceNote, 200),
        JSON.stringify({ signed_label: decoded.signed }),
      ]
    );

    return {
      observation_id: result.insertId,
      session_id: cleanSessionId,
      unit_code: unit.unit_code,
      validation_status: validationStatus,
      accepted: validationStatus === "accepted",
      duplicate: validationStatus === "duplicate",
      signed_label: decoded.signed,
    };
  });
}

async function recordQuantityObservation({
  branchId,
  sessionId,
  productId,
  quantity,
  observedBy,
  deviceNote = null,
}) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanSessionId = positiveInt(sessionId, "sessionId");
  const cleanProductId = positiveInt(productId, "productId");
  const cleanQuantity = nonNegativeInt(quantity, "quantity");
  const cleanObservedBy = positiveInt(observedBy, "observedBy");

  return withTransaction(async (connection) => {
    const session = await loadCountSessionForUpdate(connection, {
      branchId: cleanBranchId,
      sessionId: cleanSessionId,
    });
    if (session.status !== "open") {
      throw lossError("This blind count is no longer open for counting.", 409, "COUNT_SESSION_NOT_OPEN");
    }
    const [scopeRows] = await connection.query(
      `SELECT id, tracking_mode_snapshot
       FROM inventory_count_scope
       WHERE session_id = ? AND product_id = ?
       LIMIT 1`,
      [cleanSessionId, cleanProductId]
    );
    const scope = scopeRows[0];
    if (!scope) throw lossError("Product is outside this count scope.", 404, "COUNT_PRODUCT_OUT_OF_SCOPE");
    if (scope.tracking_mode_snapshot === "serialized") {
      throw lossError("Serialized products must be counted by physical unit ID.", 409, "COUNT_SERIALIZED_REQUIRES_UNIT_SCAN");
    }

    const [result] = await connection.query(
      `INSERT INTO inventory_count_observations (
         session_id, scope_id, product_id, observation_type,
         quantity_observed, validation_status, observed_by, device_note
       ) VALUES (?, ?, ?, 'quantity_count', ?, 'accepted', ?, ?)`,
      [cleanSessionId, scope.id, cleanProductId, cleanQuantity, cleanObservedBy, cleanText(deviceNote, 200)]
    );

    return {
      observation_id: result.insertId,
      session_id: cleanSessionId,
      product_id: cleanProductId,
      quantity_observed: cleanQuantity,
      validation_status: "accepted",
    };
  });
}

async function openInvestigation(connection, {
  branch,
  productId,
  unitId = null,
  sessionId,
  varianceId,
  varianceUnitId = null,
  investigationType,
  severity,
  lastKnownEventId = null,
  lastKnownAt = null,
  openedBy,
}) {
  const code = generateInvestigationCode(branch.branch_code);
  const [result] = await connection.query(
    `INSERT INTO inventory_loss_investigations (
       investigation_code, branch_id, product_id, unit_id,
       count_session_id, variance_id, variance_unit_id,
       investigation_type, severity, status, discovered_at,
       last_known_event_id, last_known_at, opened_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW(), ?, ?, ?)`,
    [
      code,
      branch.id,
      productId,
      unitId,
      sessionId,
      varianceId,
      varianceUnitId,
      investigationType,
      severity,
      lastKnownEventId,
      lastKnownAt,
      openedBy,
    ]
  );
  return { id: result.insertId, investigation_code: code };
}

async function submitBlindCountSession({ branchId, sessionId, submittedBy }) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanSessionId = positiveInt(sessionId, "sessionId");
  const cleanSubmittedBy = positiveInt(submittedBy, "submittedBy");

  return withTransaction(async (connection) => {
    const session = await loadCountSessionForUpdate(connection, {
      branchId: cleanBranchId,
      sessionId: cleanSessionId,
    });
    if (session.status !== "open") {
      throw lossError("Only an open blind count can be submitted.", 409, "COUNT_SESSION_NOT_OPEN");
    }
    const branch = await loadBranch(connection, cleanBranchId);
    const [scopes] = await connection.query(
      `SELECT sc.*, p.name AS product_name
       FROM inventory_count_scope sc
       INNER JOIN products p ON p.id = sc.product_id
       WHERE sc.session_id = ?
       ORDER BY sc.sequence_number ASC, sc.id ASC
       FOR UPDATE`,
      [cleanSessionId]
    );
    if (scopes.length === 0) throw lossError("Count has no product scope.", 409, "COUNT_SCOPE_EMPTY");

    const variances = [];
    for (const scope of scopes) {
      let observedQuantity = 0;
      let observedIdentityCount = 0;
      let missingRows = [];
      let unexpectedRows = [];

      if (scope.tracking_mode_snapshot === "serialized") {
        const [expectedRows] = await connection.query(
          `SELECT *
           FROM inventory_count_expected_units
           WHERE session_id = ? AND scope_id = ?
           ORDER BY id ASC`,
          [cleanSessionId, scope.id]
        );
        const [acceptedRows] = await connection.query(
          `SELECT DISTINCT unit_id
           FROM inventory_count_observations
           WHERE session_id = ? AND scope_id = ?
             AND validation_status = 'accepted'
             AND unit_id IS NOT NULL`,
          [cleanSessionId, scope.id]
        );
        const acceptedIds = new Set(acceptedRows.map((row) => Number(row.unit_id)));
        missingRows = expectedRows.filter((row) => !acceptedIds.has(Number(row.unit_id)));

        const [exceptionRows] = await connection.query(
          `SELECT o.unit_id, o.unit_code_snapshot, o.validation_status,
                  u.current_branch_id, u.status,
                  (
                    SELECT e.id FROM inventory_unit_events e
                    WHERE e.unit_id = o.unit_id
                    ORDER BY e.event_sequence DESC LIMIT 1
                  ) AS last_event_id
           FROM inventory_count_observations o
           LEFT JOIN inventory_units u ON u.id = o.unit_id
           WHERE o.session_id = ? AND o.scope_id = ?
             AND o.validation_status IN ('unexpected', 'wrong_store')
             AND o.unit_id IS NOT NULL
           GROUP BY o.unit_id, o.unit_code_snapshot, o.validation_status,
                    u.current_branch_id, u.status`,
          [cleanSessionId, scope.id]
        );
        unexpectedRows = exceptionRows;
        observedIdentityCount = acceptedIds.size + new Set(exceptionRows.map((row) => Number(row.unit_id))).size;
        observedQuantity = observedIdentityCount;
      } else {
        const [quantityRows] = await connection.query(
          `SELECT quantity_observed
           FROM inventory_count_observations
           WHERE session_id = ? AND scope_id = ?
             AND observation_type = 'quantity_count'
             AND validation_status = 'accepted'
           ORDER BY id DESC
           LIMIT 1`,
          [cleanSessionId, scope.id]
        );
        if (!quantityRows[0]) {
          throw lossError(
            `${scope.product_name} does not yet have a physical quantity count. Enter even zero before submitting.`,
            409,
            "COUNT_QUANTITY_OBSERVATION_REQUIRED"
          );
        }
        observedQuantity = Number(quantityRows[0].quantity_observed || 0);
      }

      const varianceQuantity = observedQuantity - Number(scope.expected_system_quantity || 0);
      const [varianceResult] = await connection.query(
        `INSERT INTO inventory_count_variances (
           session_id, scope_id, branch_id, product_id,
           expected_quantity, observed_quantity, variance_quantity,
           expected_identity_count, observed_identity_count,
           missing_identity_count, unexpected_identity_count,
           review_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        [
          cleanSessionId,
          scope.id,
          cleanBranchId,
          scope.product_id,
          Number(scope.expected_system_quantity || 0),
          observedQuantity,
          varianceQuantity,
          Number(scope.expected_identity_count || 0),
          observedIdentityCount,
          missingRows.length,
          unexpectedRows.length,
        ]
      );

      const investigations = [];
      for (const missing of missingRows) {
        const [varianceUnitResult] = await connection.query(
          `INSERT INTO inventory_count_variance_units (
             variance_id, unit_id, unit_code_snapshot, variance_type,
             last_known_status, last_known_branch_id, last_known_event_id,
             resolution_status
           ) VALUES (?, ?, ?, 'missing', ?, ?, ?, 'unresolved')`,
          [
            varianceResult.insertId,
            missing.unit_id,
            missing.unit_code_snapshot,
            missing.status_snapshot,
            missing.branch_id,
            missing.last_event_id_snapshot,
          ]
        );
        investigations.push(await openInvestigation(connection, {
          branch,
          productId: scope.product_id,
          unitId: missing.unit_id,
          sessionId: cleanSessionId,
          varianceId: varianceResult.insertId,
          varianceUnitId: varianceUnitResult.insertId,
          investigationType: "missing_serialized_unit",
          severity: riskSeverity(scope.risk_tier_snapshot, "missing_unit"),
          lastKnownEventId: missing.last_event_id_snapshot,
          lastKnownAt: missing.last_event_at_snapshot,
          openedBy: cleanSubmittedBy,
        }));
      }

      for (const unexpected of unexpectedRows) {
        const varianceType = unexpected.validation_status === "wrong_store" ? "wrong_store" : "unexpected";
        const [varianceUnitResult] = await connection.query(
          `INSERT INTO inventory_count_variance_units (
             variance_id, unit_id, unit_code_snapshot, variance_type,
             last_known_status, last_known_branch_id, last_known_event_id,
             resolution_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unresolved')`,
          [
            varianceResult.insertId,
            unexpected.unit_id,
            unexpected.unit_code_snapshot,
            varianceType,
            unexpected.status || null,
            unexpected.current_branch_id || null,
            unexpected.last_event_id || null,
          ]
        );
        investigations.push(await openInvestigation(connection, {
          branch,
          productId: scope.product_id,
          unitId: unexpected.unit_id,
          sessionId: cleanSessionId,
          varianceId: varianceResult.insertId,
          varianceUnitId: varianceUnitResult.insertId,
          investigationType: "unexpected_unit",
          severity: riskSeverity(scope.risk_tier_snapshot, "unexpected"),
          lastKnownEventId: unexpected.last_event_id || null,
          openedBy: cleanSubmittedBy,
        }));
      }

      if (scope.tracking_mode_snapshot !== "serialized" && varianceQuantity !== 0) {
        investigations.push(await openInvestigation(connection, {
          branch,
          productId: scope.product_id,
          sessionId: cleanSessionId,
          varianceId: varianceResult.insertId,
          investigationType: "quantity_shortage",
          severity: riskSeverity(scope.risk_tier_snapshot, "shortage"),
          openedBy: cleanSubmittedBy,
        }));
      }

      variances.push({
        id: varianceResult.insertId,
        product_id: scope.product_id,
        product_name: scope.product_name,
        tracking_mode: scope.tracking_mode_snapshot,
        expected_quantity: Number(scope.expected_system_quantity || 0),
        observed_quantity: observedQuantity,
        variance_quantity: varianceQuantity,
        missing_identity_count: missingRows.length,
        unexpected_identity_count: unexpectedRows.length,
        investigations,
      });
    }

    await connection.query(
      `UPDATE inventory_count_sessions
       SET status = 'submitted', submitted_by = ?, submitted_at = NOW()
       WHERE id = ? AND branch_id = ?`,
      [cleanSubmittedBy, cleanSessionId, cleanBranchId]
    );

    return {
      id: cleanSessionId,
      session_code: session.session_code,
      status: "submitted",
      variances,
    };
  });
}

async function listCountSessions({ branchId, limit = 40 }) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanLimit = Math.min(100, Math.max(1, Number(limit) || 40));
  const [rows] = await pool.query(
    `SELECT
       s.id, s.session_code, s.count_type, s.status, s.blind_mode,
       s.selection_method, s.reason, s.area_label, s.created_at,
       s.started_at, s.submitted_at, s.reviewed_at, s.closed_at,
       COUNT(DISTINCT sc.id) AS product_count,
       COUNT(DISTINCT v.id) AS variance_count,
       SUM(CASE WHEN v.variance_quantity <> 0 OR v.missing_identity_count > 0 OR v.unexpected_identity_count > 0 THEN 1 ELSE 0 END) AS exception_product_count
     FROM inventory_count_sessions s
     LEFT JOIN inventory_count_scope sc ON sc.session_id = s.id
     LEFT JOIN inventory_count_variances v ON v.session_id = s.id
     WHERE s.branch_id = ?
     GROUP BY s.id
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT ?`,
    [cleanBranchId, cleanLimit]
  );
  return rows;
}

async function getCountSession({ branchId, sessionId }) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanSessionId = positiveInt(sessionId, "sessionId");
  const [sessions] = await pool.query(
    `SELECT * FROM inventory_count_sessions
     WHERE id = ? AND branch_id = ? LIMIT 1`,
    [cleanSessionId, cleanBranchId]
  );
  const session = sessions[0];
  if (!session) throw lossError("Inventory count session was not found.", 404, "COUNT_SESSION_NOT_FOUND");

  const [scopes] = await pool.query(
    `SELECT sc.id, sc.product_id, p.name AS product_name,
            sc.tracking_mode_snapshot, sc.risk_tier_snapshot,
            sc.expected_system_quantity, sc.expected_identity_count,
            v.id AS variance_id, v.observed_quantity, v.variance_quantity,
            v.missing_identity_count, v.unexpected_identity_count,
            v.review_status
     FROM inventory_count_scope sc
     INNER JOIN products p ON p.id = sc.product_id
     LEFT JOIN inventory_count_variances v ON v.scope_id = sc.id
     WHERE sc.session_id = ?
     ORDER BY sc.sequence_number ASC, sc.id ASC`,
    [cleanSessionId]
  );

  const [progressRows] = await pool.query(
    `SELECT scope_id,
            SUM(CASE WHEN validation_status = 'accepted' THEN 1 ELSE 0 END) AS accepted_observations,
            SUM(CASE WHEN validation_status = 'duplicate' THEN 1 ELSE 0 END) AS duplicate_observations,
            SUM(CASE WHEN validation_status IN ('unexpected', 'wrong_store') THEN 1 ELSE 0 END) AS exception_observations,
            MAX(CASE WHEN observation_type = 'quantity_count' AND validation_status = 'accepted' THEN id ELSE NULL END) AS latest_quantity_observation_id
     FROM inventory_count_observations
     WHERE session_id = ?
     GROUP BY scope_id`,
    [cleanSessionId]
  );
  const progress = new Map(progressRows.map((row) => [Number(row.scope_id), row]));

  const hideExpected = Boolean(Number(session.blind_mode)) && session.status === "open";
  return {
    ...session,
    blind_expected_values_hidden: hideExpected,
    scopes: scopes.map((scope) => {
      const row = { ...scope, progress: progress.get(Number(scope.id)) || null };
      if (hideExpected) {
        delete row.expected_system_quantity;
        delete row.expected_identity_count;
      }
      return row;
    }),
  };
}

async function listInvestigations({ branchId, status = null, limit = 100 }) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanLimit = Math.min(200, Math.max(1, Number(limit) || 100));
  const values = [cleanBranchId];
  let statusClause = "";
  if (status) {
    const cleanStatus = enumValue(status, ["open", "reviewing", "awaiting_evidence", "resolved", "closed"], "investigation status");
    statusClause = " AND i.status = ?";
    values.push(cleanStatus);
  }
  values.push(cleanLimit);
  const [rows] = await pool.query(
    `SELECT
       i.*, p.name AS product_name, u.unit_code,
       s.session_code, v.variance_quantity,
       vu.variance_type, vu.resolution_status AS unit_resolution_status
     FROM inventory_loss_investigations i
     INNER JOIN products p ON p.id = i.product_id
     LEFT JOIN inventory_units u ON u.id = i.unit_id
     LEFT JOIN inventory_count_sessions s ON s.id = i.count_session_id
     LEFT JOIN inventory_count_variances v ON v.id = i.variance_id
     LEFT JOIN inventory_count_variance_units vu ON vu.id = i.variance_unit_id
     WHERE i.branch_id = ?${statusClause}
     ORDER BY
       FIELD(i.severity, 'critical', 'high', 'review', 'notice'),
       i.discovered_at DESC, i.id DESC
     LIMIT ?`,
    values
  );
  return rows;
}

async function resolveInvestigation({
  branchId,
  investigationId,
  resolvedBy,
  resolutionCategory,
  resolutionNotes,
}) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanInvestigationId = positiveInt(investigationId, "investigationId");
  const cleanResolvedBy = positiveInt(resolvedBy, "resolvedBy");
  const cleanResolution = normalizeResolution(resolutionCategory);
  const notes = cleanText(resolutionNotes, 5000);
  if (!notes || notes.length < 8) {
    throw lossError("Investigation resolution notes must explain the evidence and outcome.", 400, "INVESTIGATION_RESOLUTION_NOTES_REQUIRED");
  }

  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM inventory_loss_investigations
       WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE`,
      [cleanInvestigationId, cleanBranchId]
    );
    const investigation = rows[0];
    if (!investigation) throw lossError("Investigation not found.", 404, "INVESTIGATION_NOT_FOUND");
    if (["resolved", "closed"].includes(investigation.status)) {
      throw lossError("This investigation is already resolved.", 409, "INVESTIGATION_ALREADY_RESOLVED");
    }

    await connection.query(
      `UPDATE inventory_loss_investigations
       SET status = 'resolved', resolution_category = ?, resolution_notes = ?,
           resolved_by = ?, resolved_at = NOW()
       WHERE id = ? AND branch_id = ?`,
      [cleanResolution, notes, cleanResolvedBy, cleanInvestigationId, cleanBranchId]
    );

    if (investigation.variance_unit_id) {
      await connection.query(
        `UPDATE inventory_count_variance_units
         SET resolution_status = ?, resolution_note = ?, resolved_by = ?, resolved_at = NOW()
         WHERE id = ?`,
        [cleanResolution, notes.slice(0, 1000), cleanResolvedBy, investigation.variance_unit_id]
      );
    }

    return {
      id: cleanInvestigationId,
      status: "resolved",
      resolution_category: cleanResolution,
      stock_mutated: false,
      worker_fault_assigned: false,
    };
  });
}

async function createCustodyHandover({
  branchId,
  outgoingUserId,
  incomingUserId,
  unitCodes,
  createdBy,
  areaLabel = null,
  notes = null,
}) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanOutgoing = positiveInt(outgoingUserId, "outgoingUserId");
  const cleanIncoming = positiveInt(incomingUserId, "incomingUserId");
  const cleanCreatedBy = positiveInt(createdBy, "createdBy");
  if (cleanOutgoing === cleanIncoming) {
    throw lossError("Outgoing and incoming custodians must be different people.", 400, "HANDOVER_INDEPENDENT_CUSTODIANS_REQUIRED");
  }
  const codes = [...new Set((unitCodes || []).map((value) => normalizeUnitCode(value)))];
  if (codes.length === 0) throw lossError("Choose at least one physical unit for handover.", 400, "HANDOVER_UNITS_REQUIRED");
  if (codes.length > 500) throw lossError("A single custody handover cannot exceed 500 units.", 400, "HANDOVER_TOO_LARGE");

  return withTransaction(async (connection) => {
    const branch = await loadBranch(connection, cleanBranchId);
    const placeholders = codes.map(() => "?").join(", ");
    const [users] = await connection.query(
      `SELECT id, is_active FROM users WHERE id IN (?, ?) FOR UPDATE`,
      [cleanOutgoing, cleanIncoming]
    );
    if (users.length !== 2 || users.some((user) => Number(user.is_active) !== 1)) {
      throw lossError("Both custody users must be active accounts.", 409, "HANDOVER_USER_NOT_ACTIVE");
    }
    const [units] = await connection.query(
      `SELECT id, unit_code, status, current_branch_id
       FROM inventory_units
       WHERE unit_code IN (${placeholders})
       ORDER BY id ASC
       FOR UPDATE`,
      codes
    );
    if (units.length !== codes.length) throw lossError("One or more custody unit IDs were not found.", 404, "HANDOVER_UNIT_NOT_FOUND");
    if (units.some((unit) => Number(unit.current_branch_id) !== cleanBranchId)) {
      throw lossError("All custody units must currently belong to the selected store.", 409, "HANDOVER_UNIT_WRONG_STORE");
    }
    if (units.some((unit) => !COUNT_EXPECTED_UNIT_STATUSES.includes(unit.status))) {
      throw lossError("Sold, voided, written-off, pending-label or in-transit units cannot enter this custody handover.", 409, "HANDOVER_UNIT_STATUS_NOT_ALLOWED");
    }

    const handoverCode = generateHandoverCode(branch.branch_code);
    const [handoverResult] = await connection.query(
      `INSERT INTO inventory_custody_handovers (
         handover_code, branch_id, area_label, status,
         outgoing_user_id, incoming_user_id, expected_unit_count,
         created_by, notes
       ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      [
        handoverCode,
        cleanBranchId,
        cleanText(areaLabel, 120),
        cleanOutgoing,
        cleanIncoming,
        units.length,
        cleanCreatedBy,
        cleanText(notes, 5000),
      ]
    );
    for (const unit of units) {
      await connection.query(
        `INSERT INTO inventory_custody_handover_units (
           handover_id, unit_id, unit_code_snapshot,
           expected_status, verification_status
         ) VALUES (?, ?, ?, ?, 'pending')`,
        [handoverResult.insertId, unit.id, unit.unit_code, unit.status]
      );
    }
    return {
      id: handoverResult.insertId,
      handover_code: handoverCode,
      status: "draft",
      expected_unit_count: units.length,
    };
  });
}

async function verifyCustodyHandoverUnit({ branchId, handoverId, value, verifiedBy }) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanHandoverId = positiveInt(handoverId, "handoverId");
  const cleanVerifiedBy = positiveInt(verifiedBy, "verifiedBy");
  const decoded = normalizeScanValue(value);

  return withTransaction(async (connection) => {
    const [handovers] = await connection.query(
      `SELECT * FROM inventory_custody_handovers
       WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE`,
      [cleanHandoverId, cleanBranchId]
    );
    const handover = handovers[0];
    if (!handover) throw lossError("Custody handover not found.", 404, "HANDOVER_NOT_FOUND");
    if (!["draft", "outgoing_confirmed", "incoming_verification"].includes(handover.status)) {
      throw lossError("This custody handover is no longer open for verification.", 409, "HANDOVER_NOT_OPEN");
    }
    if (cleanVerifiedBy !== Number(handover.incoming_user_id) && cleanVerifiedBy === Number(handover.outgoing_user_id)) {
      throw lossError("The outgoing custodian cannot perform the incoming verification.", 403, "HANDOVER_INDEPENDENT_VERIFICATION_REQUIRED");
    }

    const [unitRows] = await connection.query(
      `SELECT hu.id, hu.verification_status, u.id AS unit_id, u.unit_code, u.current_branch_id
       FROM inventory_custody_handover_units hu
       INNER JOIN inventory_units u ON u.id = hu.unit_id
       WHERE hu.handover_id = ? AND hu.unit_code_snapshot = ?
       LIMIT 1 FOR UPDATE`,
      [cleanHandoverId, decoded.unitCode]
    );
    const row = unitRows[0];
    if (!row) throw lossError("Scanned unit is not part of this custody handover.", 409, "HANDOVER_UNIT_UNEXPECTED");
    if (row.verification_status === "verified") {
      return { unit_code: row.unit_code, verification_status: "verified", duplicate: true };
    }
    if (Number(row.current_branch_id) !== cleanBranchId) {
      await connection.query(
        `UPDATE inventory_custody_handover_units
         SET verification_status = 'exception', verified_by = ?, verified_at = NOW(), note = ?
         WHERE id = ?`,
        [cleanVerifiedBy, "Unit system location changed before incoming verification.", row.id]
      );
      throw lossError("Unit system location changed before handover verification.", 409, "HANDOVER_UNIT_LOCATION_CHANGED");
    }

    await connection.query(
      `UPDATE inventory_custody_handover_units
       SET verification_status = 'verified', verified_by = ?, verified_at = NOW()
       WHERE id = ?`,
      [cleanVerifiedBy, row.id]
    );
    await connection.query(
      `UPDATE inventory_custody_handovers
       SET status = 'incoming_verification',
           incoming_confirmed_at = COALESCE(incoming_confirmed_at, NOW()),
           verified_unit_count = (
             SELECT COUNT(*) FROM inventory_custody_handover_units
             WHERE handover_id = ? AND verification_status = 'verified'
           )
       WHERE id = ?`,
      [cleanHandoverId, cleanHandoverId]
    );
    return { unit_code: row.unit_code, verification_status: "verified", duplicate: false };
  });
}

async function closeCustodyHandover({ branchId, handoverId, closedBy }) {
  const cleanBranchId = positiveInt(branchId, "branchId");
  const cleanHandoverId = positiveInt(handoverId, "handoverId");
  const cleanClosedBy = positiveInt(closedBy, "closedBy");
  return withTransaction(async (connection) => {
    const [handovers] = await connection.query(
      `SELECT * FROM inventory_custody_handovers
       WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE`,
      [cleanHandoverId, cleanBranchId]
    );
    const handover = handovers[0];
    if (!handover) throw lossError("Custody handover not found.", 404, "HANDOVER_NOT_FOUND");
    const [counts] = await connection.query(
      `SELECT
         COUNT(*) AS expected_count,
         SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
         SUM(CASE WHEN verification_status <> 'verified' THEN 1 ELSE 0 END) AS variance_count
       FROM inventory_custody_handover_units
       WHERE handover_id = ?`,
      [cleanHandoverId]
    );
    const expected = Number(counts[0]?.expected_count || 0);
    const verified = Number(counts[0]?.verified_count || 0);
    const variance = Number(counts[0]?.variance_count || 0);
    const status = variance === 0 ? "closed" : "variance";
    await connection.query(
      `UPDATE inventory_custody_handovers
       SET status = ?, verified_unit_count = ?, variance_unit_count = ?,
           closed_at = NOW(), incoming_confirmed_at = COALESCE(incoming_confirmed_at, NOW())
       WHERE id = ? AND branch_id = ?`,
      [status, verified, variance, cleanHandoverId, cleanBranchId]
    );
    if (variance === 0) {
      await connection.query(
        `UPDATE inventory_units u
         INNER JOIN inventory_custody_handover_units hu ON hu.unit_id = u.id
         SET u.custody_user_id = ?, u.last_verified_by = ?, u.last_verified_at = NOW()
         WHERE hu.handover_id = ? AND hu.verification_status = 'verified'`,
        [handover.incoming_user_id, cleanClosedBy, cleanHandoverId]
      );
    }
    return {
      id: cleanHandoverId,
      status,
      expected_unit_count: expected,
      verified_unit_count: verified,
      variance_unit_count: variance,
      custody_transferred: variance === 0,
    };
  });
}

module.exports = {
  COUNT_EXPECTED_UNIT_STATUSES,
  COUNT_TYPES,
  INVESTIGATION_RESOLUTIONS,
  SELECTION_METHODS,
  cleanText,
  closeCustodyHandover,
  createBlindCountSession,
  createCustodyHandover,
  generateCountSessionCode,
  generateHandoverCode,
  generateInvestigationCode,
  getCountSession,
  listCountSessions,
  listInvestigations,
  nonNegativeInt,
  normalizeScanValue,
  recordQuantityObservation,
  recordSerializedObservation,
  resolveInvestigation,
  riskSeverity,
  submitBlindCountSession,
  verifyCustodyHandoverUnit,
};
