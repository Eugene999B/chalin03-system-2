const express = require("express");

const { pool } = require("../config/db");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  UNIT_STATUSES,
  assertUnitTransition,
  normalizeUnitCode,
} = require("../services/inventoryTraceabilityService");
const {
  appendUnitEvent,
  positiveInt,
  withTransaction,
} = require("../services/inventoryTraceabilityRepositoryService");
const { buildInventoryLabelPdf } = require("../services/inventoryLabelDocumentService");
const {
  buildSelectedInventoryLabelPdf,
  normalizeLabelStyle,
  normalizeStudioFormat,
} = require("../services/inventoryIdentityStudioDocumentService");

const inventoryTraceabilityCoreRoutes = require("./inventoryTraceabilityCoreRoutes");
const inventoryTraceabilityReceivingRoutes = require("./inventoryTraceabilityReceivingRoutes");
const inventoryLossDetectionRoutes = require("./inventoryLossDetectionRoutes");
const inventorySaleScanRoutes = require("./inventorySaleScanRoutes");
const inventorySaleCatalogueRoutes = require("./inventorySaleCatalogueRoutes");
const inventoryReturnScanRoutes = require("./inventoryReturnScanRoutes");
const inventoryReturnQuarantineRoutes = require("./inventoryReturnQuarantineRoutes");
const inventoryTransferTraceabilityRoutes = require("./inventoryTransferTraceabilityRoutes");

const router = express.Router();
const STUDIO_MAX_SELECTION = 500;
const CONTROLLED_SOURCE_TYPES = new Set([
  "purchase",
  "restock",
  "transfer",
  "transfer_receipt",
  "stock_transfer",
  "supplier_receiving",
]);

function storeId(req) {
  const id = Number(req.user?.branch_id || req.user?.default_branch_id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function roleOf(req) {
  return String(req.user?.role || "").trim().toLowerCase();
}

function cleanText(value, max = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : "";
}

function routeError(message, statusCode, code, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function sendRouteError(res, error, fallback) {
  const statusCode = Number(error.statusCode || 500);
  if (statusCode >= 500) console.error(fallback, error);
  return res.status(statusCode).json({
    status: "error",
    code: error.code || "INVENTORY_LABEL_STUDIO_ERROR",
    message: statusCode >= 500 ? fallback : error.message,
    ...(error.details ? { details: error.details } : {}),
  });
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function normalizeCodes(values, fieldName = "unit_codes", allowEmpty = false) {
  if ((!Array.isArray(values) || values.length === 0) && allowEmpty) return [];
  if (!Array.isArray(values) || values.length === 0) {
    throw routeError("Select at least one exact stock-unit ID.", 400, "LABEL_STUDIO_SELECTION_REQUIRED");
  }
  if (values.length > STUDIO_MAX_SELECTION) {
    throw routeError(
      `A single controlled action can include at most ${STUDIO_MAX_SELECTION} exact stock-unit IDs.`,
      400,
      "LABEL_STUDIO_SELECTION_TOO_LARGE"
    );
  }
  const result = [];
  const seen = new Set();
  for (const value of values) {
    let code;
    try {
      code = normalizeUnitCode(value);
    } catch {
      throw routeError(`${fieldName} contains an invalid stock-unit ID.`, 400, "LABEL_STUDIO_INVALID_UNIT_CODE");
    }
    if (!seen.has(code)) {
      seen.add(code);
      result.push(code);
    }
  }
  return result;
}

async function loadStudioUnits(connection, branchId, unitCodes, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT
       u.id,
       u.unit_code,
       u.status,
       u.created_at,
       u.product_id,
       u.label_batch_id,
       p.name AS product_name,
       p.size AS product_size,
       p.category AS product_category,
       p.inventory_product_code,
       p.inventory_risk_tier,
       p.inventory_traceability_state,
       lb.batch_code,
       lb.status AS batch_status,
       b.branch_code,
       b.name AS branch_name
     FROM inventory_units u
     INNER JOIN products p ON p.id = u.product_id
     INNER JOIN inventory_label_batches lb ON lb.id = u.label_batch_id
     INNER JOIN branches b ON b.id = u.current_branch_id
     WHERE u.current_branch_id = ?
       AND p.inventory_tracking_mode = 'serialized'
       AND u.unit_code IN (${placeholders(unitCodes)})
     ORDER BY p.name ASC, lb.id ASC, u.id ASC${forUpdate ? " FOR UPDATE" : ""}`,
    [branchId, ...unitCodes]
  );
  if (!rows.length) return rows;
  const ids = rows.map((row) => Number(row.id));
  const batchIds = [...new Set(rows.map((row) => Number(row.label_batch_id)))];
  const [printRows] = await connection.query(
    `SELECT unit_id, COUNT(*) AS print_count, MAX(created_at) AS last_printed_at
     FROM inventory_label_print_events
     WHERE unit_id IN (${placeholders(ids)})
     GROUP BY unit_id`,
    ids
  );
  const [legacyRows] = await connection.query(
    `SELECT label_batch_id, COUNT(*) AS print_count
     FROM inventory_label_print_events
     WHERE unit_id IS NULL
       AND label_batch_id IN (${placeholders(batchIds)})
     GROUP BY label_batch_id`,
    batchIds
  );
  const perUnit = new Map(printRows.map((row) => [Number(row.unit_id), row]));
  const legacy = new Map(legacyRows.map((row) => [Number(row.label_batch_id), row]));
  return rows.map((row) => {
    const unitPrint = perUnit.get(Number(row.id));
    const legacyPrint = legacy.get(Number(row.label_batch_id));
    const printCount = Number(unitPrint?.print_count || 0);
    const legacyCount = Number(legacyPrint?.print_count || 0);
    return {
      ...row,
      unit_print_count: printCount,
      legacy_batch_print_count: legacyCount,
      last_printed_at: unitPrint?.last_printed_at || null,
      requires_reprint:
        printCount > 0 || legacyCount > 0 || String(row.status) !== UNIT_STATUSES.LABEL_PENDING,
    };
  });
}

function requireExactSelection(rows, unitCodes) {
  if (rows.length === unitCodes.length) return;
  const found = new Set(rows.map((row) => row.unit_code));
  throw routeError(
    "One or more selected stock-unit IDs are unavailable in the selected store.",
    409,
    "LABEL_STUDIO_SELECTION_CHANGED",
    { unavailable_unit_codes: unitCodes.filter((code) => !found.has(code)) }
  );
}

function requirePrintable(rows) {
  const blocked = rows.filter(
    (row) => ![UNIT_STATUSES.LABEL_PENDING, UNIT_STATUSES.ACTIVE].includes(String(row.status))
  );
  if (blocked.length) {
    throw routeError(
      "Only label-pending or currently active stock units can be printed.",
      409,
      "LABEL_STUDIO_STATUS_NOT_PRINTABLE",
      { blocked_unit_codes: blocked.map((row) => row.unit_code) }
    );
  }
}

function reprintRows(req, rows, reason) {
  const reprints = rows.filter((row) => row.requires_reprint);
  if (!reprints.length) return reprints;
  if (roleOf(req) !== "admin") {
    throw routeError(
      "This selection contains previously printed or already-active labels. Only a System Administrator can produce replacement labels.",
      403,
      "LABEL_STUDIO_REPRINT_ADMIN_REQUIRED",
      { reprint_unit_codes: reprints.map((row) => row.unit_code) }
    );
  }
  if (!reason || reason.length < 8) {
    throw routeError(
      "A clear reprint reason of at least 8 characters is required.",
      400,
      "LABEL_STUDIO_REPRINT_REASON_REQUIRED"
    );
  }
  return reprints;
}

function studioPrintCode(req) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const tail = `${Date.now()}${Number(req.user?.id || 0)}`.slice(-8);
  return `IDP-${date}-${tail}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

// Generic setup batches must not impersonate supplier/transfer provenance.
router.post("/products/:productId/label-batches", requireRole("admin", "manager"), (req, res, next) => {
  const sourceType = String(req.body?.source_type || "opening_reconciliation").trim().toLowerCase();
  if (!CONTROLLED_SOURCE_TYPES.has(sourceType)) return next();
  return res.status(409).json({
    status: "error",
    code: "TRACEABILITY_CONTROLLED_SOURCE_WORKFLOW_REQUIRED",
    message:
      sourceType === "purchase" || sourceType === "supplier_receiving"
        ? "Purchase labels must be prepared from Serialized Receiving so the IDs are tied to the exact recorded purchase line."
        : "Transfer/restock provenance cannot be created from the generic label screen. Use the dedicated controlled receiving or transfer workflow.",
  });
});

// GET /api/inventory-traceability/identity-studio/units
router.get("/identity-studio/units", requireRole("admin", "manager"), async (req, res) => {
  try {
    const branchId = storeId(req);
    if (!branchId) throw routeError("Select a store before opening the Label Studio.", 400, "LABEL_STUDIO_BRANCH_REQUIRED");
    const limit = Math.min(Math.max(Number(req.query.limit) || 1500, 1), 2000);
    const [rows] = await pool.query(
      `SELECT
         u.id,
         u.unit_code,
         u.status,
         u.created_at,
         u.product_id,
         u.label_batch_id,
         p.name AS product_name,
         p.size AS product_size,
         p.category AS product_category,
         p.inventory_product_code,
         p.inventory_risk_tier,
         p.inventory_traceability_state,
         lb.batch_code,
         lb.status AS batch_status,
         b.branch_code,
         b.name AS branch_name,
         (SELECT COUNT(*) FROM inventory_label_print_events pe WHERE pe.unit_id = u.id) AS unit_print_count,
         (SELECT MAX(pe.created_at) FROM inventory_label_print_events pe WHERE pe.unit_id = u.id) AS last_printed_at,
         (SELECT COUNT(*) FROM inventory_label_print_events pe WHERE pe.label_batch_id = lb.id AND pe.unit_id IS NULL) AS legacy_batch_print_count
       FROM inventory_units u
       INNER JOIN products p ON p.id = u.product_id
       INNER JOIN inventory_label_batches lb ON lb.id = u.label_batch_id
       INNER JOIN branches b ON b.id = u.current_branch_id
       WHERE u.current_branch_id = ?
         AND p.inventory_tracking_mode = 'serialized'
       ORDER BY
         FIELD(u.status, 'label_pending', 'active', 'missing', 'in_transit', 'returned_quarantine', 'damaged', 'sold', 'written_off', 'voided'),
         p.name ASC,
         u.id ASC
       LIMIT ?`,
      [branchId, limit]
    );
    const units = rows.map((row) => ({
      ...row,
      unit_print_count: Number(row.unit_print_count || 0),
      legacy_batch_print_count: Number(row.legacy_batch_print_count || 0),
      requires_reprint:
        Number(row.unit_print_count || 0) > 0 ||
        Number(row.legacy_batch_print_count || 0) > 0 ||
        String(row.status) !== UNIT_STATUSES.LABEL_PENDING,
    }));
    const products = new Map();
    for (const unit of units) {
      const key = Number(unit.product_id);
      if (!products.has(key)) {
        products.set(key, {
          id: key,
          name: unit.product_name,
          size: unit.product_size,
          product_code: unit.inventory_product_code,
          risk_tier: unit.inventory_risk_tier,
          unit_count: 0,
          pending_count: 0,
          active_count: 0,
        });
      }
      const product = products.get(key);
      product.unit_count += 1;
      if (unit.status === UNIT_STATUSES.LABEL_PENDING) product.pending_count += 1;
      if (unit.status === UNIT_STATUSES.ACTIVE) product.active_count += 1;
    }
    return res.json({
      status: "success",
      branch_id: branchId,
      max_selection: STUDIO_MAX_SELECTION,
      formats: ["a4", "thermal", "sticker", "compact"],
      styles: ["compact", "standard", "detailed"],
      products: [...products.values()],
      units,
    });
  } catch (error) {
    return sendRouteError(res, error, "Unable to load the Inventory Label Studio.");
  }
});

// POST /api/inventory-traceability/identity-studio/print-selected
router.post("/identity-studio/print-selected", requireRole("admin", "manager"), async (req, res) => {
  try {
    const branchId = storeId(req);
    if (!branchId) throw routeError("Select a store before printing labels.", 400, "LABEL_STUDIO_BRANCH_REQUIRED");
    const unitCodes = normalizeCodes(req.body?.unit_codes);
    const format = normalizeStudioFormat(req.body?.print_format || "a4");
    const style = normalizeLabelStyle(req.body?.label_style || "standard");
    const reason = cleanText(req.body?.reason, 500);
    const code = studioPrintCode(req);

    const firstRead = await loadStudioUnits(pool, branchId, unitCodes);
    requireExactSelection(firstRead, unitCodes);
    requirePrintable(firstRead);
    reprintRows(req, firstRead, reason);
    const document = await buildSelectedInventoryLabelPdf({
      units: firstRead,
      format,
      style,
      printCode: code,
    });

    const recorded = await withTransaction(async (connection) => {
      const locked = await loadStudioUnits(connection, branchId, unitCodes, true);
      requireExactSelection(locked, unitCodes);
      requirePrintable(locked);
      const reprints = reprintRows(req, locked, reason);
      const reprintIds = new Set(reprints.map((row) => Number(row.id)));

      for (const unit of locked) {
        const isReprint = reprintIds.has(Number(unit.id));
        await connection.query(
          `INSERT INTO inventory_label_print_events (
             branch_id, label_batch_id, unit_id, print_format, copies,
             print_reason, printed_by, approved_by
           ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
          [
            branchId,
            unit.label_batch_id,
            unit.id,
            format,
            isReprint ? reason : reason || `Initial selected print ${code}`,
            req.user.id,
            isReprint ? req.user.id : null,
          ]
        );
      }
      const batchIds = [...new Set(locked.map((row) => Number(row.label_batch_id)))];
      for (const batchId of batchIds) {
        await connection.query(
          `UPDATE inventory_label_batches
           SET status = CASE WHEN status IN ('draft', 'generated') THEN 'printed' ELSE status END,
               label_format = ?,
               printed_by = COALESCE(printed_by, ?),
               printed_at = COALESCE(printed_at, NOW())
           WHERE id = ? AND branch_id = ?`,
          [format, req.user.id, batchId, branchId]
        );
      }
      await writeAuditEvent({
        connection,
        req,
        branchId,
        userId: req.user.id,
        action: reprints.length ? "PRINT_SELECTED_STOCK_IDS_WITH_REPRINT" : "PRINT_SELECTED_STOCK_IDS",
        details: `Prepared ${locked.length} selected stock label(s) in ${code}: ${locked.length - reprints.length} initial and ${reprints.length} replacement.`,
        workspaceCode: "spare_parts",
        entityType: "inventory_label_selection",
        entityId: code,
        actionType: "inventory_selected_label_print",
        outcome: "success",
        severity: reprints.length ? "high" : "notice",
        metadata: {
          print_code: code,
          unit_codes: locked.map((row) => row.unit_code),
          selected_count: locked.length,
          initial_count: locked.length - reprints.length,
          reprint_count: reprints.length,
          print_format: format,
          label_style: style,
          reason: reprints.length ? reason : null,
        },
      });
      return { count: locked.length, reprints: reprints.length };
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${document.file_name.replace(/[^A-Za-z0-9_.-]/g, "_")}"`);
    res.setHeader("X-Inventory-Print-Code", code);
    res.setHeader("X-Inventory-Label-Count", String(recorded.count));
    res.setHeader("X-Inventory-Reprint-Count", String(recorded.reprints));
    res.setHeader("X-Inventory-Label-Style", style);
    return res.send(document.buffer);
  } catch (error) {
    return sendRouteError(res, error, "Unable to prepare the selected labels safely.");
  }
});

// POST /api/inventory-traceability/identity-studio/export-selected
router.post("/identity-studio/export-selected", requireRole("admin", "manager"), async (req, res) => {
  try {
    const branchId = storeId(req);
    if (!branchId) throw routeError("Select a store before exporting IDs.", 400, "LABEL_STUDIO_BRANCH_REQUIRED");
    const unitCodes = normalizeCodes(req.body?.unit_codes);
    const rows = await loadStudioUnits(pool, branchId, unitCodes);
    requireExactSelection(rows, unitCodes);

    const lines = [[
      "Exact Unit ID",
      "Product",
      "Product Code",
      "Batch",
      "Store",
      "Status",
      "Per-ID Print Count",
      "Legacy Batch Print Evidence",
      "Last Per-ID Print",
      "Created At",
    ].map(csvCell).join(",")];
    for (const unit of rows) {
      lines.push([
        unit.unit_code,
        unit.product_name,
        unit.inventory_product_code,
        unit.batch_code,
        `${unit.branch_code} — ${unit.branch_name}`,
        unit.status,
        unit.unit_print_count,
        unit.legacy_batch_print_count,
        unit.last_printed_at || "",
        unit.created_at || "",
      ].map(csvCell).join(","));
    }

    await writeAuditEvent({
      req,
      branchId,
      userId: req.user.id,
      action: "EXPORT_SELECTED_STOCK_IDS",
      details: `Downloaded a human-readable list containing ${rows.length} selected stock-unit IDs.`,
      workspaceCode: "spare_parts",
      entityType: "inventory_label_export",
      actionType: "inventory_selected_id_export",
      outcome: "success",
      severity: "notice",
      metadata: {
        unit_codes: rows.map((row) => row.unit_code),
        selected_count: rows.length,
        signed_qr_payloads_included: false,
      },
    });

    const fileName = `chalin03-selected-stock-ids-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(`\uFEFF${lines.join("\n")}`);
  } catch (error) {
    return sendRouteError(res, error, "Unable to export the selected stock-unit IDs.");
  }
});

// POST /api/inventory-traceability/identity-studio/confirm-selected
router.post("/identity-studio/confirm-selected", requireRole("admin", "manager"), async (req, res) => {
  try {
    const branchId = storeId(req);
    if (!branchId) throw routeError("Select a store before confirming labels.", 400, "LABEL_STUDIO_BRANCH_REQUIRED");
    const activeCodes = normalizeCodes(req.body?.active_unit_codes, "active_unit_codes", true);
    const voidCodes = normalizeCodes(req.body?.void_unit_codes, "void_unit_codes", true);
    const supplied = [...new Set([...activeCodes, ...voidCodes])];
    if (!supplied.length) throw routeError("Choose printed IDs to confirm as attached or void.", 400, "LABEL_STUDIO_CONFIRMATION_REQUIRED");
    if (supplied.length > STUDIO_MAX_SELECTION) throw routeError("Too many IDs in one confirmation.", 400, "LABEL_STUDIO_SELECTION_TOO_LARGE");
    const overlap = activeCodes.filter((code) => voidCodes.includes(code));
    if (overlap.length) throw routeError("An ID cannot be both attached and voided.", 400, "LABEL_STUDIO_CONFIRMATION_OVERLAP", { unit_codes: overlap });
    const notes = cleanText(req.body?.notes, 500) || "Label Studio physical attachment confirmation";

    const result = await withTransaction(async (connection) => {
      const units = await loadStudioUnits(connection, branchId, supplied, true);
      requireExactSelection(units, supplied);
      const nonPending = units.filter((unit) => unit.status !== UNIT_STATUSES.LABEL_PENDING);
      if (nonPending.length) throw routeError("Only label-pending IDs can be physically confirmed.", 409, "LABEL_STUDIO_UNIT_NOT_PENDING", { unit_codes: nonPending.map((unit) => unit.unit_code) });

      const unitIds = units.map((unit) => Number(unit.id));
      const [printEvidence] = await connection.query(
        `SELECT unit_id, COUNT(*) AS print_count,
                MAX(CASE WHEN printed_by = ? THEN 1 ELSE 0 END) AS printed_by_requester
         FROM inventory_label_print_events
         WHERE unit_id IN (${placeholders(unitIds)})
         GROUP BY unit_id`,
        [req.user.id, ...unitIds]
      );
      const evidence = new Map(printEvidence.map((row) => [Number(row.unit_id), row]));
      const unprinted = units.filter((unit) => Number(evidence.get(Number(unit.id))?.print_count || 0) <= 0);
      if (unprinted.length) throw routeError("Every confirmed ID must have per-ID print evidence. Print the exact selected labels first.", 409, "LABEL_STUDIO_EXACT_PRINT_REQUIRED", { unit_codes: unprinted.map((unit) => unit.unit_code) });
      if (roleOf(req) !== "admin") {
        const selfPrinted = units.filter((unit) => Number(evidence.get(Number(unit.id))?.printed_by_requester || 0) > 0);
        if (selfPrinted.length) throw routeError("A manager cannot independently verify labels they printed. Ask another authorized manager or the System Administrator.", 403, "LABEL_STUDIO_INDEPENDENT_VERIFICATION_REQUIRED", { unit_codes: selfPrinted.map((unit) => unit.unit_code) });
      }

      const activeSet = new Set(activeCodes);
      const batchChanges = new Map();
      for (const unit of units) {
        const target = activeSet.has(unit.unit_code) ? UNIT_STATUSES.ACTIVE : UNIT_STATUSES.VOIDED;
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
          [target, target, req.user.id, target, req.user.id, unit.id]
        );
        await appendUnitEvent(connection, {
          unitId: unit.id,
          branchId,
          eventType: target === UNIT_STATUSES.ACTIVE ? "unit_activated" : "label_voided",
          fromStatus: UNIT_STATUSES.LABEL_PENDING,
          toStatus: target,
          sourceType: "label_studio",
          sourceId: unit.label_batch_id,
          actorUserId: req.user.id,
          reason: notes,
          metadata: { batch_code: unit.batch_code, unit_code: unit.unit_code, exact_print_evidence: true },
        });
        const change = batchChanges.get(Number(unit.label_batch_id)) || { active: 0, voided: 0 };
        if (target === UNIT_STATUSES.ACTIVE) change.active += 1;
        else change.voided += 1;
        batchChanges.set(Number(unit.label_batch_id), change);
      }

      for (const [batchId, change] of batchChanges.entries()) {
        const [pendingRows] = await connection.query(
          `SELECT COUNT(*) AS pending_count
           FROM inventory_units
           WHERE label_batch_id = ? AND current_branch_id = ? AND status = 'label_pending'`,
          [batchId, branchId]
        );
        const pending = Number(pendingRows[0]?.pending_count || 0);
        await connection.query(
          `UPDATE inventory_label_batches
           SET activated_quantity = activated_quantity + ?,
               voided_quantity = voided_quantity + ?,
               verified_by = ?,
               verified_at = NOW(),
               status = ?,
               activated_by = CASE WHEN ? = 0 THEN ? ELSE activated_by END,
               activated_at = CASE WHEN ? = 0 THEN NOW() ELSE activated_at END
           WHERE id = ? AND branch_id = ?`,
          [change.active, change.voided, req.user.id, pending === 0 ? "activated" : "printed", pending, req.user.id, pending, batchId, branchId]
        );
      }

      await writeAuditEvent({
        connection,
        req,
        branchId,
        userId: req.user.id,
        action: "CONFIRM_SELECTED_STOCK_IDS",
        details: `Confirmed ${activeCodes.length} selected label(s) as attached and ${voidCodes.length} as void; unselected pending IDs were left untouched.`,
        workspaceCode: "spare_parts",
        entityType: "inventory_label_confirmation",
        actionType: "inventory_selected_label_confirmation",
        outcome: "success",
        severity: "high",
        metadata: {
          active_unit_codes: activeCodes,
          void_unit_codes: voidCodes,
          exact_print_evidence_verified: true,
          independent_verification: roleOf(req) === "admin" ? "admin_override_allowed" : "separate_manager",
        },
      });
      return { activated_count: activeCodes.length, voided_count: voidCodes.length };
    });

    return res.json({
      status: "success",
      message: `Confirmed ${result.activated_count} attached ID(s) and voided ${result.voided_count}. Unselected IDs remain untouched.`,
      ...result,
    });
  } catch (error) {
    return sendRouteError(res, error, "Unable to confirm selected labels safely.");
  }
});

// Existing whole-batch printing now records evidence for every exact stock-unit ID.
router.post("/label-batches/:batchId/print", requireRole("admin", "manager"), async (req, res) => {
  try {
    const branchId = storeId(req);
    if (!branchId) throw routeError("Select a store before printing labels.", 400, "TRACEABILITY_BRANCH_REQUIRED");
    const batchId = positiveInt(req.params.batchId, "batchId");
    const format = String(req.body?.print_format || "a4").trim().toLowerCase();
    const reason = cleanText(req.body?.reason, 500);
    const [batchRows] = await pool.query(
      `SELECT lb.id, lb.batch_code, lb.branch_id, lb.product_id, lb.status,
              lb.created_by, lb.printed_by, p.name AS product_name,
              p.size AS product_size, p.inventory_product_code,
              b.branch_code, b.name AS branch_name
       FROM inventory_label_batches lb
       INNER JOIN products p ON p.id = lb.product_id
       INNER JOIN branches b ON b.id = lb.branch_id
       WHERE lb.id = ? AND lb.branch_id = ? LIMIT 1`,
      [batchId, branchId]
    );
    if (!batchRows.length) throw routeError("Label batch not found.", 404, "TRACEABILITY_BATCH_NOT_FOUND");
    const [units] = await pool.query(
      `SELECT id, unit_code, status
       FROM inventory_units
       WHERE label_batch_id = ? AND current_branch_id = ? AND status = 'label_pending'
       ORDER BY id ASC`,
      [batchId, branchId]
    );
    if (!units.length) throw routeError("This batch has no pending labels to print.", 409, "TRACEABILITY_NO_PRINTABLE_UNITS");
    const document = await buildInventoryLabelPdf({ batch: batchRows[0], units, format });

    const result = await withTransaction(async (connection) => {
      const [lockedBatch] = await connection.query(
        `SELECT id, status FROM inventory_label_batches WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE`,
        [batchId, branchId]
      );
      if (!lockedBatch.length) throw routeError("Label batch not found.", 404, "TRACEABILITY_BATCH_NOT_FOUND");
      const [priorRows] = await connection.query(
        `SELECT COUNT(*) AS print_count FROM inventory_label_print_events WHERE label_batch_id = ? AND branch_id = ?`,
        [batchId, branchId]
      );
      const prior = Number(priorRows[0]?.print_count || 0);
      const isReprint = prior > 0;
      if (isReprint && roleOf(req) !== "admin") throw routeError("Only a System Administrator can reprint stock-unit labels.", 403, "TRACEABILITY_REPRINT_ADMIN_REQUIRED");
      if (isReprint && (!reason || reason.length < 8)) throw routeError("A reprint reason of at least 8 characters is required.", 400, "TRACEABILITY_REPRINT_REASON_REQUIRED");

      const [lockedUnits] = await connection.query(
        `SELECT id, unit_code FROM inventory_units
         WHERE label_batch_id = ? AND current_branch_id = ? AND status = 'label_pending'
         ORDER BY id ASC FOR UPDATE`,
        [batchId, branchId]
      );
      if (lockedUnits.length !== units.length || lockedUnits.some((unit, index) => unit.unit_code !== units[index].unit_code)) {
        throw routeError("Pending labels changed while the PDF was being prepared. Retry the print action.", 409, "TRACEABILITY_PRINT_SELECTION_CHANGED");
      }
      for (const unit of lockedUnits) {
        await connection.query(
          `INSERT INTO inventory_label_print_events (
             branch_id, label_batch_id, unit_id, print_format, copies,
             print_reason, printed_by, approved_by
           ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
          [branchId, batchId, unit.id, document.format, isReprint ? reason : reason || "Initial controlled label print", req.user.id, isReprint ? req.user.id : null]
        );
      }
      await connection.query(
        `UPDATE inventory_label_batches
         SET status = CASE WHEN status IN ('draft', 'generated') THEN 'printed' ELSE status END,
             label_format = ?, printed_by = ?, printed_at = NOW()
         WHERE id = ? AND branch_id = ?`,
        [document.format, req.user.id, batchId, branchId]
      );
      await writeAuditEvent({
        connection,
        req,
        branchId,
        userId: req.user.id,
        action: isReprint ? "REPRINT_INVENTORY_LABEL_BATCH" : "PRINT_INVENTORY_LABEL_BATCH",
        details: `${isReprint ? "Reprinted" : "Printed"} ${document.label_count} stock-unit labels for ${batchRows[0].batch_code} with per-ID print evidence.`,
        workspaceCode: "spare_parts",
        entityType: "inventory_label_batch",
        entityId: batchId,
        actionType: isReprint ? "inventory_label_batch_reprinted" : "inventory_label_batch_printed",
        outcome: "success",
        severity: isReprint ? "high" : "notice",
        metadata: {
          product_id: batchRows[0].product_id,
          unit_codes: lockedUnits.map((unit) => unit.unit_code),
          label_count: document.label_count,
          print_format: document.format,
          reprint: isReprint,
          prior_print_evidence_count: prior,
        },
      });
      return { isReprint };
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${document.file_name.replace(/[^A-Za-z0-9_.-]/g, "_")}"`);
    res.setHeader("X-Inventory-Label-Count", String(document.label_count));
    res.setHeader("X-Inventory-Label-Reprint", result.isReprint ? "true" : "false");
    return res.send(document.buffer);
  } catch (error) {
    return sendRouteError(res, error, "Unable to generate controlled inventory labels.");
  }
});

// Old batch finalization must prove every exact supplied label was printed.
router.post("/label-batches/:batchId/activate", requireRole("admin", "manager"), async (req, res, next) => {
  try {
    const branchId = storeId(req);
    if (!branchId) throw routeError("Select a store before confirming labels.", 400, "TRACEABILITY_BRANCH_REQUIRED");
    const codes = [...new Set([
      ...normalizeCodes(req.body?.active_unit_codes, "active_unit_codes", true),
      ...normalizeCodes(req.body?.void_unit_codes, "void_unit_codes", true),
    ])];
    if (!codes.length) return next();
    const [rows] = await pool.query(
      `SELECT u.unit_code,
              (SELECT COUNT(*) FROM inventory_label_print_events pe WHERE pe.unit_id = u.id) AS exact_print_count
       FROM inventory_units u
       WHERE u.current_branch_id = ? AND u.label_batch_id = ? AND u.unit_code IN (${placeholders(codes)})`,
      [branchId, positiveInt(req.params.batchId, "batchId"), ...codes]
    );
    const byCode = new Map(rows.map((row) => [row.unit_code, Number(row.exact_print_count || 0)]));
    const missing = codes.filter((code) => Number(byCode.get(code) || 0) <= 0);
    if (missing.length) {
      return res.status(409).json({
        status: "error",
        code: "TRACEABILITY_EXACT_PRINT_REQUIRED_BEFORE_ACTIVATION",
        message: "Every exact stock-unit label being confirmed must have per-ID print evidence. Reprint the affected labels through the Label Studio first.",
        unit_codes: missing,
      });
    }
    return next();
  } catch (error) {
    return sendRouteError(res, error, "Unable to verify exact print evidence before activation.");
  }
});

router.use("/receiving", inventoryTraceabilityReceivingRoutes);
router.use("/loss-control", inventoryLossDetectionRoutes);
router.use("/sale-products", inventorySaleCatalogueRoutes);
router.use("/sale-scan", inventorySaleScanRoutes);
router.use("/return-scan", inventoryReturnScanRoutes);
router.use("/return-quarantine", inventoryReturnQuarantineRoutes);
router.use("/transfer-control", inventoryTransferTraceabilityRoutes);
router.use(inventoryTraceabilityCoreRoutes);

module.exports = router;
