const express = require("express");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  resolveHireLocationScope,
  sendHireLocationScopeError,
} = require("../services/hireLocationScope");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

const CHARGING_METHODS = new Set(["hourly", "daily", "shift", "weekly", "monthly", "fixed"]);
const FUEL_RESPONSIBILITIES = new Set(["customer", "owner", "mixed"]);
const AMENDMENT_TYPES = new Set(["extension", "rate_change", "scope_change", "suspension", "reactivation", "other"]);
const DEPOSIT_TYPES = new Set(["receipt", "allocation", "refund", "forfeit", "adjustment"]);
const PAYMENT_METHODS = new Set(["cash", "momo", "bank", "cheque", "other"]);
const EVIDENCE_ENTITY_TYPES = new Set(["quotation", "contract", "dispatch", "work_log", "invoice", "return", "damage"]);
const EVIDENCE_TYPES = new Set(["photo", "video", "signed_document", "delivery_note", "job_card", "invoice", "receipt", "damage", "other"]);
const DAMAGE_SETTLEMENT_METHODS = new Set(["deposit_deduction", "invoice", "direct_payment", "insurance", "waiver", "mixed"]);
const DEFAULT_DISCOUNT_APPROVAL_PERCENT = Math.max(0, Number(process.env.HIRE_DISCOUNT_APPROVAL_PERCENT || 10));

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegative(value, fallback = null, decimals = 2) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Number(number.toFixed(decimals));
}

function positiveAmount(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Number(number.toFixed(decimals));
}

function dateOnly(value, fallback = null) {
  const text = cleanText(value, 20);
  if (!text) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateTime(value, fallback = null) {
  const text = cleanText(value, 60);
  if (!text) return fallback;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function appError(message, statusCode = 400, code = "HIRE_COMMERCIAL_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function locationId(req) {
  return Number(req.hireLocationScope?.locationId || 0);
}

function independentApproval(req, createdBy, label = "record") {
  if (Number(createdBy || 0) === Number(req.user?.id || 0)) {
    throw appError(
      `Independent approval is required. The user who created this ${label} cannot approve it.`,
      409,
      "INDEPENDENT_APPROVAL_REQUIRED"
    );
  }
}

function quoteItemTotals(item) {
  const method = cleanText(item.charging_method, 30).toLowerCase();
  const rate = nonNegative(item.rate, null);
  const quantity = nonNegative(item.estimated_quantity, 0);
  const minimum = nonNegative(item.minimum_quantity, 0);
  const mobilization = nonNegative(item.mobilization_amount, 0);
  const demobilization = nonNegative(item.demobilization_amount, 0);
  const operator = nonNegative(item.operator_amount, 0);
  const discount = nonNegative(item.discount_amount, 0);
  const taxRate = nonNegative(item.tax_rate_percent, 0, 4);

  if (!CHARGING_METHODS.has(method) || rate === null || quantity === null || minimum === null ||
      mobilization === null || demobilization === null || operator === null || discount === null || taxRate === null) {
    throw appError("Every quotation line requires a valid charging method and non-negative commercial amounts.");
  }
  if (taxRate > 100) throw appError("Tax rate cannot exceed 100 percent.");

  const billableQuantity = method === "fixed" ? 1 : Math.max(quantity, minimum);
  const base = method === "fixed" ? rate : Number((rate * billableQuantity).toFixed(2));
  const subtotal = Number((base + mobilization + demobilization + operator).toFixed(2));
  if (discount > subtotal) throw appError("A quotation-line discount cannot exceed its subtotal.");
  const taxable = subtotal - discount;
  const tax = Number((taxable * taxRate / 100).toFixed(2));
  const total = Number((taxable + tax).toFixed(2));

  return {
    charging_method: method,
    rate,
    estimated_quantity: quantity,
    minimum_quantity: minimum,
    mobilization_amount: mobilization,
    demobilization_amount: demobilization,
    operator_amount: operator,
    discount_amount: discount,
    tax_rate_percent: taxRate,
    line_subtotal: subtotal,
    tax_amount: tax,
    line_total: total,
  };
}

async function audit(connection, req, action, details, entityType, entityId, severity = "notice") {
  await writeAuditEvent({
    connection,
    req,
    action,
    details,
    workspaceCode: "equipment_hire",
    hireLocationId: locationId(req),
    entityType,
    entityId,
    actionType: action,
    outcome: "success",
    severity,
  });
}

async function customerExposure(connection, customerId) {
  const [[customer]] = await connection.query(
    `SELECT id, customer_name, credit_limit, is_active
     FROM hire_customers
     WHERE id = ?
     LIMIT 1`,
    [customerId]
  );
  if (!customer || Number(customer.is_active) !== 1) {
    throw appError("The selected active Hire customer was not found.", 404, "HIRE_CUSTOMER_NOT_FOUND");
  }

  const [[exposure]] = await connection.query(
    `SELECT COALESCE(SUM(balance), 0) AS outstanding_balance
     FROM hire_invoices
     WHERE customer_id = ?
       AND status NOT IN ('paid', 'void')`,
    [customerId]
  );

  return {
    customer,
    outstanding: Number(exposure?.outstanding_balance || 0),
    credit_limit: Number(customer.credit_limit || 0),
  };
}

async function insertApproval(connection, req, {
  approvalType,
  entityType,
  entityId,
  customerId = null,
  requestedAmount = 0,
  thresholdAmount = 0,
  reason,
}) {
  const approvalNumber = await nextDocumentNumber("HAPR", { userId: req.user.id });
  const [result] = await connection.query(
    `INSERT INTO hire_commercial_approvals (
       approval_number, hire_location_id, approval_type, entity_type, entity_id,
       customer_id, requested_amount, threshold_amount, reason, status, requested_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      approvalNumber,
      locationId(req),
      approvalType,
      entityType,
      entityId,
      customerId,
      requestedAmount,
      thresholdAmount,
      reason,
      req.user.id,
    ]
  );
  return result.insertId;
}

async function recalculateDepositBalance(connection, contractId, userId) {
  const [[row]] = await connection.query(
    `SELECT COALESCE(SUM(
       CASE
         WHEN transaction_type IN ('receipt', 'adjustment') THEN amount
         WHEN transaction_type IN ('allocation', 'refund', 'forfeit') THEN -amount
         ELSE 0
       END
     ), 0) AS balance
     FROM hire_deposit_transactions
     WHERE contract_id = ?
       AND status = 'approved'`,
    [contractId]
  );
  const balance = Math.max(0, Number(row?.balance || 0));
  await connection.query(
    `UPDATE hire_contracts
     SET deposit_received = ?, updated_by = ?
     WHERE id = ?`,
    [balance, userId, contractId]
  );
  return balance;
}

function sendPdf(res, filename, title, metadata, sections) {
  const doc = new PDFDocument({ size: "A4", margin: 44, info: { Title: title } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  doc.pipe(res);
  doc.fontSize(18).text("CHALIN 03 COMPANY LIMITED", { align: "center" });
  doc.moveDown(0.2).fontSize(14).text(title, { align: "center" });
  doc.moveDown();
  Object.entries(metadata).forEach(([key, value]) => {
    doc.fontSize(9).fillColor("#555").text(`${key}:`, { continued: true });
    doc.fillColor("#111").text(` ${value ?? "—"}`);
  });
  for (const section of sections) {
    doc.moveDown().fontSize(12).fillColor("#111").text(section.title, { underline: true });
    for (const line of section.lines) {
      doc.moveDown(0.25).fontSize(9).text(line);
    }
  }
  doc.moveDown(2).fontSize(8).fillColor("#666").text(
    `Generated by Chalin 03 Equipment Hire Commercial Control on ${new Date().toLocaleString("en-GH")}.`,
    { align: "center" }
  );
  doc.end();
}

router.use(requireAuth);
router.use(async (req, res, next) => {
  try {
    req.hireLocationScope = await resolveHireLocationScope(req, { requireSelection: true });
    next();
  } catch (error) {
    if (sendHireLocationScopeError(res, error)) return;
    next(error);
  }
});

router.get("/dashboard", requirePermission("hire.commercial.view"), async (req, res, next) => {
  try {
    const id = locationId(req);
    const [[summary]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM hire_rate_cards WHERE hire_location_id = ? AND status = 'approved') AS active_rate_cards,
         (SELECT COUNT(*) FROM hire_quotations WHERE hire_location_id = ? AND status IN ('draft', 'pending_approval')) AS open_quotes,
         (SELECT COUNT(*) FROM hire_contract_amendments WHERE hire_location_id = ? AND status = 'pending_approval') AS pending_amendments,
         (SELECT COUNT(*) FROM hire_commercial_approvals WHERE hire_location_id = ? AND status = 'pending') AS pending_approvals,
         (SELECT COALESCE(SUM(balance), 0) FROM hire_invoices WHERE hire_location_id = ? AND status NOT IN ('paid', 'void')) AS outstanding_invoices,
         (SELECT COALESCE(SUM(
            CASE WHEN transaction_type IN ('receipt','adjustment') THEN amount
                 WHEN transaction_type IN ('allocation','refund','forfeit') THEN -amount ELSE 0 END
          ), 0) FROM hire_deposit_transactions WHERE hire_location_id = ? AND status = 'approved') AS deposit_balance,
         (SELECT COUNT(*) FROM hire_damage_assessments WHERE hire_location_id = ? AND status <> 'settled') AS open_damage_cases`,
      [id, id, id, id, id, id, id]
    );
    const [approvals] = await pool.query(
      `SELECT hca.*, hcu.customer_name, u.username AS requested_by_username
       FROM hire_commercial_approvals hca
       LEFT JOIN hire_customers hcu ON hcu.id = hca.customer_id
       LEFT JOIN users u ON u.id = hca.requested_by
       WHERE hca.hire_location_id = ? AND hca.status = 'pending'
       ORDER BY hca.created_at DESC LIMIT 30`,
      [id]
    );
    res.json({ status: "success", summary, pending_approvals: approvals });
  } catch (error) { next(error); }
});

router.get("/rate-cards", requirePermission("hire.commercial.view"), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT hrc.*, fa.asset_code, fa.asset_name,
              creator.username AS created_by_username,
              approver.username AS approved_by_username
       FROM hire_rate_cards hrc
       LEFT JOIN fleet_assets fa ON fa.id = hrc.asset_id
       LEFT JOIN users creator ON creator.id = hrc.created_by
       LEFT JOIN users approver ON approver.id = hrc.approved_by
       WHERE hrc.hire_location_id = ?
       ORDER BY hrc.effective_from DESC, hrc.id DESC`,
      [locationId(req)]
    );
    res.json({ status: "success", rate_cards: rows });
  } catch (error) { next(error); }
});

router.post("/rate-cards", requirePermission("hire.commercial.manage"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const assetType = cleanText(req.body.asset_type, 100);
    const method = cleanText(req.body.charging_method, 30).toLowerCase();
    const rate = positiveAmount(req.body.standard_rate);
    const effectiveFrom = dateOnly(req.body.effective_from);
    const effectiveTo = dateOnly(req.body.effective_to);
    const fuel = cleanText(req.body.fuel_responsibility, 30).toLowerCase() || "customer";
    if (!assetType || !CHARGING_METHODS.has(method) || !rate || !effectiveFrom || !FUEL_RESPONSIBILITIES.has(fuel)) {
      throw appError("Asset type, charging method, positive rate, fuel responsibility and effective date are required.");
    }
    if (effectiveTo && effectiveTo < effectiveFrom) throw appError("Rate-card end date cannot be before its start date.");
    const rateCardNumber = await nextDocumentNumber("HRTC", { userId: req.user.id });
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO hire_rate_cards (
         rate_card_number, hire_location_id, asset_type, asset_id, charging_method,
         standard_rate, minimum_quantity, mobilization_amount, demobilization_amount,
         operator_amount, fuel_responsibility, effective_from, effective_to,
         status, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        rateCardNumber, locationId(req), assetType, positiveId(req.body.asset_id), method, rate,
        nonNegative(req.body.minimum_quantity, 0), nonNegative(req.body.mobilization_amount, 0),
        nonNegative(req.body.demobilization_amount, 0), nonNegative(req.body.operator_amount, 0),
        fuel, effectiveFrom, effectiveTo, nullableText(req.body.notes, 3000), req.user.id,
      ]
    );
    await audit(connection, req, "CREATE_HIRE_RATE_CARD", `Created rate card ${rateCardNumber}.`, "hire_rate_card", result.insertId);
    await connection.commit();
    res.status(201).json({ status: "success", message: "Rate card saved for independent approval.", rate_card_id: result.insertId, rate_card_number: rateCardNumber });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.patch("/rate-cards/:id/approve", requirePermission("hire.commercial.approve"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[row]] = await connection.query(
      `SELECT * FROM hire_rate_cards WHERE id = ? AND hire_location_id = ? LIMIT 1 FOR UPDATE`,
      [positiveId(req.params.id), locationId(req)]
    );
    if (!row) throw appError("Rate card not found in this Hire location.", 404);
    independentApproval(req, row.created_by, "rate card");
    if (row.status !== "draft") throw appError("Only draft rate cards can be approved.", 409);
    await connection.query(
      `UPDATE hire_rate_cards SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`,
      [req.user.id, row.id]
    );
    await audit(connection, req, "APPROVE_HIRE_RATE_CARD", `Approved rate card ${row.rate_card_number}.`, "hire_rate_card", row.id);
    await connection.commit();
    res.json({ status: "success", message: "Rate card approved." });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.get("/quotations", requirePermission("hire.commercial.view"), async (req, res, next) => {
  try {
    const [quotes] = await pool.query(
      `SELECT hq.*, hcu.customer_name, hcu.customer_code, hcu.credit_limit,
              creator.username AS created_by_username, approver.username AS approved_by_username
       FROM hire_quotations hq
       INNER JOIN hire_customers hcu ON hcu.id = hq.customer_id
       LEFT JOIN users creator ON creator.id = hq.created_by
       LEFT JOIN users approver ON approver.id = hq.approved_by
       WHERE hq.hire_location_id = ?
       ORDER BY hq.created_at DESC LIMIT 500`,
      [locationId(req)]
    );
    const quoteIds = quotes.map((row) => row.id);
    let items = [];
    let approvals = [];
    if (quoteIds.length) {
      const placeholders = quoteIds.map(() => "?").join(",");
      [items] = await pool.query(
        `SELECT hqi.*, fa.asset_code, fa.asset_name
         FROM hire_quotation_items hqi
         LEFT JOIN fleet_assets fa ON fa.id = hqi.preferred_asset_id
         WHERE hqi.quotation_id IN (${placeholders})
         ORDER BY hqi.quotation_id, hqi.line_number`, quoteIds
      );
      [approvals] = await pool.query(
        `SELECT * FROM hire_commercial_approvals
         WHERE entity_type = 'quotation' AND entity_id IN (${placeholders})
         ORDER BY created_at DESC`, quoteIds
      );
    }
    const itemMap = new Map();
    for (const item of items) {
      if (!itemMap.has(item.quotation_id)) itemMap.set(item.quotation_id, []);
      itemMap.get(item.quotation_id).push(item);
    }
    const approvalMap = new Map();
    for (const approval of approvals) {
      if (!approvalMap.has(Number(approval.entity_id))) approvalMap.set(Number(approval.entity_id), []);
      approvalMap.get(Number(approval.entity_id)).push(approval);
    }
    res.json({ status: "success", quotations: quotes.map((quote) => ({ ...quote, items: itemMap.get(quote.id) || [], approvals: approvalMap.get(quote.id) || [] })) });
  } catch (error) { next(error); }
});

router.post("/quotations", requirePermission("hire.commercial.manage"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const customerId = positiveId(req.body.customer_id);
    const workLocation = cleanText(req.body.work_location, 255);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const requestedStart = dateOnly(req.body.requested_start_date);
    const expectedEnd = dateOnly(req.body.expected_end_date);
    if (!customerId || !workLocation || items.length < 1 || items.length > 20) {
      throw appError("Customer, work location and between 1 and 20 equipment lines are required.");
    }
    if (requestedStart && expectedEnd && expectedEnd < requestedStart) throw appError("Expected end date cannot be before requested start date.");

    const normalizedItems = items.map((item, index) => {
      const totals = quoteItemTotals(item);
      const assetType = cleanText(item.asset_type, 100);
      const description = cleanText(item.description || `${assetType} hire`, 255);
      const fuel = cleanText(item.fuel_responsibility, 30).toLowerCase() || "customer";
      if (!assetType || !description || !FUEL_RESPONSIBILITIES.has(fuel)) throw appError(`Quotation line ${index + 1} requires an asset type, description and valid fuel responsibility.`);
      return { ...totals, line_number: index + 1, rate_card_id: positiveId(item.rate_card_id), asset_type: assetType, preferred_asset_id: positiveId(item.preferred_asset_id), description, fuel_responsibility: fuel, notes: nullableText(item.notes, 3000) };
    });

    const subtotal = Number(normalizedItems.reduce((sum, item) => sum + item.line_subtotal, 0).toFixed(2));
    const discount = Number(normalizedItems.reduce((sum, item) => sum + item.discount_amount, 0).toFixed(2));
    const tax = Number(normalizedItems.reduce((sum, item) => sum + item.tax_amount, 0).toFixed(2));
    const total = Number(normalizedItems.reduce((sum, item) => sum + item.line_total, 0).toFixed(2));
    const discountPercent = subtotal > 0 ? Number((discount / subtotal * 100).toFixed(4)) : 0;

    await connection.beginTransaction();
    const exposure = await customerExposure(connection, customerId);
    const approvalReasons = [];
    if (discountPercent > DEFAULT_DISCOUNT_APPROVAL_PERCENT) {
      approvalReasons.push(`Discount ${discountPercent}% exceeds the ${DEFAULT_DISCOUNT_APPROVAL_PERCENT}% automatic limit.`);
    }
    if (exposure.credit_limit > 0 && exposure.outstanding + total > exposure.credit_limit) {
      approvalReasons.push(`Projected exposure GHS ${(exposure.outstanding + total).toFixed(2)} exceeds customer credit limit GHS ${exposure.credit_limit.toFixed(2)}.`);
    }

    const quotationNumber = await nextDocumentNumber("HQUO", { userId: req.user.id });
    const first = normalizedItems[0];
    const status = approvalReasons.length ? "pending_approval" : "draft";
    const [result] = await connection.query(
      `INSERT INTO hire_quotations (
         hire_location_id, quotation_number, commercial_version, enquiry_id, customer_id,
         requested_asset_type, preferred_asset_id, work_location, requested_start_date,
         expected_end_date, charging_method, rate, estimated_quantity, minimum_quantity,
         mobilization_amount, demobilization_amount, operator_amount, fuel_responsibility,
         subtotal, discount_amount, tax_amount, total_amount, validity_date, status,
         approval_reason, terms, notes, created_by, updated_by
       ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        locationId(req), quotationNumber, positiveId(req.body.enquiry_id), customerId,
        first.asset_type, first.preferred_asset_id, workLocation, requestedStart, expectedEnd,
        first.charging_method, first.rate, first.estimated_quantity, first.minimum_quantity,
        normalizedItems.reduce((sum, item) => sum + item.mobilization_amount, 0),
        normalizedItems.reduce((sum, item) => sum + item.demobilization_amount, 0),
        normalizedItems.reduce((sum, item) => sum + item.operator_amount, 0),
        first.fuel_responsibility, subtotal, discount, tax, total, dateOnly(req.body.validity_date),
        status, approvalReasons.join(" ") || null, nullableText(req.body.terms, 5000),
        nullableText(req.body.notes, 3000), req.user.id, req.user.id,
      ]
    );

    for (const item of normalizedItems) {
      await connection.query(
        `INSERT INTO hire_quotation_items (
           hire_location_id, quotation_id, line_number, rate_card_id, asset_type,
           preferred_asset_id, description, charging_method, rate, estimated_quantity,
           minimum_quantity, mobilization_amount, demobilization_amount, operator_amount,
           fuel_responsibility, line_subtotal, discount_amount, tax_amount, line_total, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [locationId(req), result.insertId, item.line_number, item.rate_card_id, item.asset_type,
          item.preferred_asset_id, item.description, item.charging_method, item.rate,
          item.estimated_quantity, item.minimum_quantity, item.mobilization_amount,
          item.demobilization_amount, item.operator_amount, item.fuel_responsibility,
          item.line_subtotal, item.discount_amount, item.tax_amount, item.line_total, item.notes]
      );
    }

    for (const reason of approvalReasons) {
      await insertApproval(connection, req, {
        approvalType: reason.startsWith("Discount") ? "quotation_discount" : "customer_credit",
        entityType: "quotation", entityId: result.insertId, customerId,
        requestedAmount: reason.startsWith("Discount") ? discount : exposure.outstanding + total,
        thresholdAmount: reason.startsWith("Discount") ? subtotal * DEFAULT_DISCOUNT_APPROVAL_PERCENT / 100 : exposure.credit_limit,
        reason,
      });
    }

    await audit(connection, req, "CREATE_MULTI_ITEM_HIRE_QUOTATION", `Created ${quotationNumber} with ${normalizedItems.length} equipment lines.`, "hire_quotation", result.insertId);
    await connection.commit();
    res.status(201).json({ status: "success", message: approvalReasons.length ? "Quotation saved and routed for commercial approval." : "Multi-item quotation saved.", quotation_id: result.insertId, quotation_number: quotationNumber, approval_required: approvalReasons.length > 0, approval_reasons: approvalReasons });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.patch("/quotations/:id/approve", requirePermission("hire.commercial.approve"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[quote]] = await connection.query(
      `SELECT * FROM hire_quotations WHERE id = ? AND hire_location_id = ? LIMIT 1 FOR UPDATE`,
      [positiveId(req.params.id), locationId(req)]
    );
    if (!quote) throw appError("Quotation not found in this Hire location.", 404);
    independentApproval(req, quote.created_by, "quotation");
    if (!["draft", "pending_approval"].includes(quote.status)) throw appError("Only draft or pending quotations can be approved.", 409);
    await connection.query(
      `UPDATE hire_quotations SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_by = ? WHERE id = ?`,
      [req.user.id, req.user.id, quote.id]
    );
    await connection.query(
      `UPDATE hire_commercial_approvals
       SET status = 'approved', decided_by = ?, decided_at = NOW(), decision_notes = ?
       WHERE hire_location_id = ? AND entity_type = 'quotation' AND entity_id = ? AND status = 'pending'`,
      [req.user.id, nullableText(req.body.decision_notes, 500), locationId(req), quote.id]
    );
    await audit(connection, req, "APPROVE_HIRE_COMMERCIAL_QUOTATION", `Approved ${quote.quotation_number}.`, "hire_quotation", quote.id, "critical");
    await connection.commit();
    res.json({ status: "success", message: "Quotation and its commercial exceptions were approved." });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.post("/quotations/:id/convert-to-contract", requirePermission("hire.commercial.manage"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const startDate = dateOnly(req.body.start_date);
    if (!startDate) throw appError("Contract start date is required.");
    await connection.beginTransaction();
    const [[quote]] = await connection.query(
      `SELECT * FROM hire_quotations WHERE id = ? AND hire_location_id = ? LIMIT 1 FOR UPDATE`,
      [positiveId(req.params.id), locationId(req)]
    );
    if (!quote) throw appError("Quotation not found in this Hire location.", 404);
    if (!["approved", "accepted"].includes(quote.status)) throw appError("Only approved or accepted quotations can become contracts.", 409);
    const [[existing]] = await connection.query(`SELECT id FROM hire_contracts WHERE quotation_id = ? LIMIT 1`, [quote.id]);
    if (existing) throw appError("This quotation already has a contract.", 409);
    const [items] = await connection.query(`SELECT * FROM hire_quotation_items WHERE quotation_id = ? ORDER BY line_number`, [quote.id]);
    if (!items.length) throw appError("The quotation has no equipment lines.", 409);
    const contractNumber = await nextDocumentNumber("HCON", { userId: req.user.id });
    const first = items[0];
    const [result] = await connection.query(
      `INSERT INTO hire_contracts (
         hire_location_id, contract_number, commercial_version, quotation_id, customer_id,
         work_location, start_date, expected_end_date, charging_method, rate,
         minimum_quantity, mobilization_amount, demobilization_amount, operator_amount,
         deposit_required, deposit_received, fuel_responsibility, status, terms, notes,
         operational_status, financial_status, created_by, approved_by, approved_at, updated_by
       ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'confirmed', ?, ?, 'open', 'open', ?, ?, NOW(), ?)`,
      [
        locationId(req), contractNumber, quote.id, quote.customer_id, quote.work_location,
        startDate, dateOnly(req.body.expected_end_date, quote.expected_end_date), first.charging_method,
        first.rate, first.minimum_quantity, quote.mobilization_amount, quote.demobilization_amount,
        quote.operator_amount, nonNegative(req.body.deposit_required, 0), first.fuel_responsibility,
        nullableText(req.body.terms, 5000) || quote.terms, nullableText(req.body.notes, 3000) || quote.notes,
        req.user.id, req.user.id, req.user.id,
      ]
    );
    for (const item of items) {
      await connection.query(
        `INSERT INTO hire_contract_items (
           hire_location_id, contract_id, quotation_item_id, line_number, asset_type,
           preferred_asset_id, description, charging_method, rate, minimum_quantity,
           mobilization_amount, demobilization_amount, operator_amount,
           fuel_responsibility, agreed_line_total, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [locationId(req), result.insertId, item.id, item.line_number, item.asset_type,
          item.preferred_asset_id, item.description, item.charging_method, item.rate,
          item.minimum_quantity, item.mobilization_amount, item.demobilization_amount,
          item.operator_amount, item.fuel_responsibility, item.line_total, item.notes]
      );
    }
    await connection.query(`UPDATE hire_quotations SET status = 'converted', updated_by = ? WHERE id = ?`, [req.user.id, quote.id]);
    await audit(connection, req, "CONVERT_HIRE_QUOTATION_TO_CONTRACT", `Converted ${quote.quotation_number} to ${contractNumber}.`, "hire_contract", result.insertId, "critical");
    await connection.commit();
    res.status(201).json({ status: "success", message: "Approved quotation converted to a multi-item contract.", contract_id: result.insertId, contract_number: contractNumber });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.get("/contracts", requirePermission("hire.commercial.view"), async (req, res, next) => {
  try {
    const [contracts] = await pool.query(
      `SELECT hc.*, hcu.customer_name, hcu.customer_code,
              COALESCE(dt.deposit_balance, 0) AS deposit_ledger_balance
       FROM hire_contracts hc
       INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
       LEFT JOIN (
         SELECT contract_id, SUM(CASE
           WHEN transaction_type IN ('receipt','adjustment') AND status = 'approved' THEN amount
           WHEN transaction_type IN ('allocation','refund','forfeit') AND status = 'approved' THEN -amount
           ELSE 0 END) AS deposit_balance
         FROM hire_deposit_transactions GROUP BY contract_id
       ) dt ON dt.contract_id = hc.id
       WHERE hc.hire_location_id = ?
       ORDER BY hc.created_at DESC LIMIT 500`,
      [locationId(req)]
    );
    const ids = contracts.map((row) => row.id);
    let items = [], amendments = [];
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      [items] = await pool.query(`SELECT * FROM hire_contract_items WHERE contract_id IN (${placeholders}) ORDER BY contract_id, line_number`, ids);
      [amendments] = await pool.query(`SELECT * FROM hire_contract_amendments WHERE contract_id IN (${placeholders}) ORDER BY created_at DESC`, ids);
    }
    const group = (rows) => rows.reduce((map, row) => { if (!map.has(row.contract_id)) map.set(row.contract_id, []); map.get(row.contract_id).push(row); return map; }, new Map());
    const itemMap = group(items), amendmentMap = group(amendments);
    res.json({ status: "success", contracts: contracts.map((row) => ({ ...row, items: itemMap.get(row.id) || [], amendments: amendmentMap.get(row.id) || [] })) });
  } catch (error) { next(error); }
});

router.post("/contracts/:id/amendments", requirePermission("hire.commercial.manage"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const type = cleanText(req.body.amendment_type, 40).toLowerCase();
    const effectiveDate = dateOnly(req.body.effective_date);
    const reason = cleanText(req.body.reason, 500);
    if (!AMENDMENT_TYPES.has(type) || !effectiveDate || !reason) throw appError("Amendment type, effective date and reason are required.");
    await connection.beginTransaction();
    const [[contract]] = await connection.query(`SELECT * FROM hire_contracts WHERE id = ? AND hire_location_id = ? LIMIT 1 FOR UPDATE`, [positiveId(req.params.id), locationId(req)]);
    if (!contract) throw appError("Contract not found in this Hire location.", 404);
    if (["completed", "cancelled"].includes(contract.status)) throw appError("Closed contracts cannot be amended.", 409);
    const proposedEnd = dateOnly(req.body.proposed_end_date);
    const proposedRate = nonNegative(req.body.proposed_rate, null);
    if (type === "extension" && (!proposedEnd || proposedEnd <= (contract.expected_end_date || contract.start_date))) throw appError("An extension requires a later proposed end date.");
    if (type === "rate_change" && proposedRate === null) throw appError("A rate change requires a proposed rate.");
    const number = await nextDocumentNumber("HAMD", { userId: req.user.id });
    const [result] = await connection.query(
      `INSERT INTO hire_contract_amendments (
         amendment_number, hire_location_id, contract_id, amendment_type, effective_date,
         previous_end_date, proposed_end_date, previous_rate, proposed_rate,
         amount_adjustment, reason, terms, status, requested_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?)`,
      [number, locationId(req), contract.id, type, effectiveDate, contract.expected_end_date,
        proposedEnd, contract.rate, proposedRate, nonNegative(req.body.amount_adjustment, 0),
        reason, nullableText(req.body.terms, 5000), req.user.id]
    );
    await insertApproval(connection, req, { approvalType: "contract_amendment", entityType: "contract_amendment", entityId: result.insertId, customerId: contract.customer_id, requestedAmount: nonNegative(req.body.amount_adjustment, 0), reason: `${number}: ${reason}` });
    await audit(connection, req, "REQUEST_HIRE_CONTRACT_AMENDMENT", `Requested ${number} for ${contract.contract_number}.`, "hire_contract_amendment", result.insertId);
    await connection.commit();
    res.status(201).json({ status: "success", message: "Contract amendment submitted for independent approval.", amendment_id: result.insertId, amendment_number: number });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.patch("/amendments/:id/approve", requirePermission("hire.commercial.approve"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[row]] = await connection.query(
      `SELECT hca.*, hc.contract_number FROM hire_contract_amendments hca
       INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
       WHERE hca.id = ? AND hca.hire_location_id = ? LIMIT 1 FOR UPDATE`,
      [positiveId(req.params.id), locationId(req)]
    );
    if (!row) throw appError("Contract amendment not found.", 404);
    independentApproval(req, row.requested_by, "contract amendment");
    if (row.status !== "pending_approval") throw appError("Only pending amendments can be approved.", 409);
    const updates = ["commercial_version = commercial_version + 1", "updated_by = ?"];
    const values = [req.user.id];
    if (row.amendment_type === "extension") { updates.push("expected_end_date = ?"); values.push(row.proposed_end_date); }
    if (row.amendment_type === "rate_change") { updates.push("rate = ?"); values.push(row.proposed_rate); }
    if (row.amendment_type === "suspension") updates.push("status = 'suspended'");
    if (row.amendment_type === "reactivation") updates.push("status = 'active'");
    values.push(row.contract_id);
    await connection.query(`UPDATE hire_contracts SET ${updates.join(", ")} WHERE id = ?`, values);
    await connection.query(`UPDATE hire_contract_amendments SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`, [req.user.id, row.id]);
    await connection.query(`UPDATE hire_commercial_approvals SET status = 'approved', decided_by = ?, decided_at = NOW(), decision_notes = ? WHERE entity_type = 'contract_amendment' AND entity_id = ? AND status = 'pending'`, [req.user.id, nullableText(req.body.decision_notes, 500), row.id]);
    await audit(connection, req, "APPROVE_HIRE_CONTRACT_AMENDMENT", `Approved ${row.amendment_number} for ${row.contract_number}.`, "hire_contract_amendment", row.id, "critical");
    await connection.commit();
    res.json({ status: "success", message: "Contract amendment approved and applied." });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.get("/deposits", requirePermission("hire.commercial.view"), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT hdt.*, hc.contract_number, hcu.customer_name,
              creator.username AS created_by_username, approver.username AS approved_by_username
       FROM hire_deposit_transactions hdt
       INNER JOIN hire_contracts hc ON hc.id = hdt.contract_id
       INNER JOIN hire_customers hcu ON hcu.id = hdt.customer_id
       LEFT JOIN users creator ON creator.id = hdt.created_by
       LEFT JOIN users approver ON approver.id = hdt.approved_by
       WHERE hdt.hire_location_id = ?
       ORDER BY hdt.transaction_date DESC, hdt.id DESC LIMIT 1000`,
      [locationId(req)]
    );
    res.json({ status: "success", deposit_transactions: rows });
  } catch (error) { next(error); }
});

router.post("/deposits", requirePermission("hire.commercial.manage"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const contractId = positiveId(req.body.contract_id);
    const type = cleanText(req.body.transaction_type, 30).toLowerCase();
    const amount = positiveAmount(req.body.amount);
    const occurredAt = dateTime(req.body.transaction_date, new Date().toISOString());
    if (!contractId || !DEPOSIT_TYPES.has(type) || !amount || !occurredAt) throw appError("Contract, deposit transaction type, positive amount and date are required.");
    const method = cleanText(req.body.payment_method, 40).toLowerCase();
    if (method && !PAYMENT_METHODS.has(method)) throw appError("Invalid payment method.");
    await connection.beginTransaction();
    const [[contract]] = await connection.query(`SELECT * FROM hire_contracts WHERE id = ? AND hire_location_id = ? LIMIT 1 FOR UPDATE`, [contractId, locationId(req)]);
    if (!contract) throw appError("Contract not found in this Hire location.", 404);
    const status = type === "refund" || type === "forfeit" ? "pending_approval" : "approved";
    const number = await nextDocumentNumber("HDEP", { userId: req.user.id });
    const [result] = await connection.query(
      `INSERT INTO hire_deposit_transactions (
         transaction_number, hire_location_id, contract_id, customer_id, invoice_id,
         transaction_type, transaction_date, amount, payment_method, reference_number,
         reason, status, created_by, approved_by, approved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [number, locationId(req), contract.id, contract.customer_id, positiveId(req.body.invoice_id),
        type, occurredAt, amount, method || null, nullableText(req.body.reference_number, 120),
        nullableText(req.body.reason, 500), status, req.user.id,
        status === "approved" ? req.user.id : null, status === "approved" ? new Date() : null]
    );
    if (status === "pending_approval") {
      await insertApproval(connection, req, { approvalType: `deposit_${type}`, entityType: "deposit_transaction", entityId: result.insertId, customerId: contract.customer_id, requestedAmount: amount, reason: nullableText(req.body.reason, 500) || `${type} requested for ${contract.contract_number}.` });
    } else {
      await recalculateDepositBalance(connection, contract.id, req.user.id);
    }
    await audit(connection, req, "CREATE_HIRE_DEPOSIT_TRANSACTION", `Created ${number} (${type}) for ${contract.contract_number}.`, "hire_deposit_transaction", result.insertId, type === "refund" ? "critical" : "notice");
    await connection.commit();
    res.status(201).json({ status: "success", message: status === "pending_approval" ? "Deposit transaction submitted for independent approval." : "Deposit transaction recorded.", transaction_id: result.insertId, transaction_number: number, approval_required: status === "pending_approval" });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.patch("/deposits/:id/approve", requirePermission("hire.commercial.approve"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[row]] = await connection.query(`SELECT * FROM hire_deposit_transactions WHERE id = ? AND hire_location_id = ? LIMIT 1 FOR UPDATE`, [positiveId(req.params.id), locationId(req)]);
    if (!row) throw appError("Deposit transaction not found.", 404);
    independentApproval(req, row.created_by, "deposit transaction");
    if (row.status !== "pending_approval") throw appError("Only pending deposit transactions can be approved.", 409);
    const currentBalance = await recalculateDepositBalance(connection, row.contract_id, req.user.id);
    if (["refund", "forfeit", "allocation"].includes(row.transaction_type) && Number(row.amount) > currentBalance) throw appError(`The approved deposit balance is GHS ${currentBalance.toFixed(2)}, which is below this transaction.`, 409, "INSUFFICIENT_DEPOSIT_BALANCE");
    await connection.query(`UPDATE hire_deposit_transactions SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`, [req.user.id, row.id]);
    const newBalance = await recalculateDepositBalance(connection, row.contract_id, req.user.id);
    await connection.query(`UPDATE hire_commercial_approvals SET status = 'approved', decided_by = ?, decided_at = NOW(), decision_notes = ? WHERE entity_type = 'deposit_transaction' AND entity_id = ? AND status = 'pending'`, [req.user.id, nullableText(req.body.decision_notes, 500), row.id]);
    await audit(connection, req, "APPROVE_HIRE_DEPOSIT_TRANSACTION", `Approved ${row.transaction_number}.`, "hire_deposit_transaction", row.id, "critical");
    await connection.commit();
    res.json({ status: "success", message: "Deposit transaction approved.", deposit_balance: newBalance });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.get("/evidence", requirePermission("hire.commercial.view"), async (req, res, next) => {
  try {
    const entityType = cleanText(req.query.entity_type, 50).toLowerCase();
    const entityId = positiveId(req.query.entity_id);
    const where = ["hef.hire_location_id = ?"];
    const params = [locationId(req)];
    if (entityType) { where.push("hef.entity_type = ?"); params.push(entityType); }
    if (entityId) { where.push("hef.entity_id = ?"); params.push(entityId); }
    const [rows] = await pool.query(
      `SELECT hef.*, u.username AS created_by_username
       FROM hire_evidence_files hef
       LEFT JOIN users u ON u.id = hef.created_by
       WHERE ${where.join(" AND ")}
       ORDER BY hef.created_at DESC LIMIT 1000`, params
    );
    res.json({ status: "success", evidence: rows });
  } catch (error) { next(error); }
});

router.post("/evidence", requirePermission("hire.commercial.evidence"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const entityType = cleanText(req.body.entity_type, 50).toLowerCase();
    const entityId = positiveId(req.body.entity_id);
    const evidenceType = cleanText(req.body.evidence_type, 50).toLowerCase();
    const fileName = cleanText(req.body.file_name, 255);
    const storageReference = cleanText(req.body.storage_reference, 1000);
    const checksum = cleanText(req.body.checksum_sha256, 64).toLowerCase();
    if (!EVIDENCE_ENTITY_TYPES.has(entityType) || !entityId || !EVIDENCE_TYPES.has(evidenceType) || !fileName || !storageReference) throw appError("Evidence requires a supported entity, record ID, evidence type, file name and storage reference.");
    if (checksum && !/^[a-f0-9]{64}$/.test(checksum)) throw appError("Evidence checksum must be a SHA-256 hexadecimal value.");
    const number = await nextDocumentNumber("HEVD", { userId: req.user.id });
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO hire_evidence_files (
         evidence_number, hire_location_id, entity_type, entity_id, evidence_type,
         file_name, mime_type, size_bytes, storage_reference, checksum_sha256,
         captured_at, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [number, locationId(req), entityType, entityId, evidenceType, fileName,
        nullableText(req.body.mime_type, 120), nonNegative(req.body.size_bytes, null, 0),
        storageReference, checksum || null, dateTime(req.body.captured_at),
        nullableText(req.body.notes, 3000), req.user.id]
    );
    await audit(connection, req, "ADD_HIRE_EVIDENCE", `Registered evidence ${number} for ${entityType} ${entityId}.`, "hire_evidence", result.insertId);
    await connection.commit();
    res.status(201).json({ status: "success", message: "Evidence reference registered in the audit trail.", evidence_id: result.insertId, evidence_number: number });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.get("/damage-assessments", requirePermission("hire.commercial.view"), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT hda.*, hc.contract_number, hcu.customer_name, fa.asset_code, fa.asset_name,
              hri.return_number, hri.return_datetime
       FROM hire_damage_assessments hda
       INNER JOIN hire_contracts hc ON hc.id = hda.contract_id
       INNER JOIN hire_customers hcu ON hcu.id = hda.customer_id
       INNER JOIN hire_contract_assets hca ON hca.id = hda.contract_asset_id
       INNER JOIN fleet_assets fa ON fa.id = hca.asset_id
       INNER JOIN hire_return_inspections hri ON hri.id = hda.return_inspection_id
       WHERE hda.hire_location_id = ?
       ORDER BY hda.created_at DESC LIMIT 500`,
      [locationId(req)]
    );
    res.json({ status: "success", damage_assessments: rows });
  } catch (error) { next(error); }
});

router.post("/damage-assessments", requirePermission("hire.commercial.damage"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const returnId = positiveId(req.body.return_inspection_id);
    const assessed = nonNegative(req.body.assessed_amount, null);
    const liability = nonNegative(req.body.customer_liability_amount, null);
    const summary = cleanText(req.body.damage_summary, 500);
    if (!returnId || assessed === null || liability === null || !summary) throw appError("Return inspection, assessed amount, customer liability and damage summary are required.");
    if (liability > assessed) throw appError("Customer liability cannot exceed the assessed damage amount.");
    await connection.beginTransaction();
    const [[record]] = await connection.query(
      `SELECT hri.*, hc.customer_id
       FROM hire_return_inspections hri
       INNER JOIN hire_contracts hc ON hc.id = hri.contract_id
       WHERE hri.id = ? AND hri.hire_location_id = ? LIMIT 1`,
      [returnId, locationId(req)]
    );
    if (!record) throw appError("Return inspection not found in this Hire location.", 404);
    const number = await nextDocumentNumber("HDMG", { userId: req.user.id });
    const [result] = await connection.query(
      `INSERT INTO hire_damage_assessments (
         assessment_number, hire_location_id, return_inspection_id, contract_id,
         contract_asset_id, customer_id, assessed_amount, customer_liability_amount,
         damage_summary, assessment_notes, status, assessed_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [number, locationId(req), record.id, record.contract_id, record.contract_asset_id,
        record.customer_id, assessed, liability, summary,
        nullableText(req.body.assessment_notes, 3000), req.user.id]
    );
    if (liability > 0) {
      await insertApproval(connection, req, { approvalType: "damage_assessment", entityType: "damage_assessment", entityId: result.insertId, customerId: record.customer_id, requestedAmount: liability, reason: `${number}: ${summary}` });
    }
    await audit(connection, req, "CREATE_HIRE_DAMAGE_ASSESSMENT", `Created damage assessment ${number}.`, "hire_damage_assessment", result.insertId, "critical");
    await connection.commit();
    res.status(201).json({ status: "success", message: "Damage assessment saved for controlled settlement.", assessment_id: result.insertId, assessment_number: number });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.patch("/damage-assessments/:id/settle", requirePermission("hire.commercial.approve"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const method = cleanText(req.body.settlement_method, 40).toLowerCase();
    const depositApplied = nonNegative(req.body.deposit_applied_amount, 0);
    const invoiced = nonNegative(req.body.invoiced_amount, 0);
    const waived = nonNegative(req.body.waived_amount, 0);
    const settled = nonNegative(req.body.settled_amount, 0);
    if (!DAMAGE_SETTLEMENT_METHODS.has(method) || [depositApplied, invoiced, waived, settled].some((value) => value === null)) throw appError("A valid settlement method and non-negative settlement allocations are required.");
    await connection.beginTransaction();
    const [[row]] = await connection.query(`SELECT * FROM hire_damage_assessments WHERE id = ? AND hire_location_id = ? LIMIT 1 FOR UPDATE`, [positiveId(req.params.id), locationId(req)]);
    if (!row) throw appError("Damage assessment not found.", 404);
    independentApproval(req, row.assessed_by, "damage assessment");
    if (row.status === "settled") throw appError("This damage assessment is already settled.", 409);
    const totalAllocation = Number((depositApplied + invoiced + waived + settled).toFixed(2));
    if (Math.abs(totalAllocation - Number(row.customer_liability_amount || 0)) >= 0.01) throw appError("Settlement allocations must equal the customer liability amount.");
    if (depositApplied > 0) {
      const currentBalance = await recalculateDepositBalance(connection, row.contract_id, req.user.id);
      if (depositApplied > currentBalance) throw appError(`Deposit allocation exceeds the approved deposit balance of GHS ${currentBalance.toFixed(2)}.`, 409, "INSUFFICIENT_DEPOSIT_BALANCE");
      const number = await nextDocumentNumber("HDEP", { userId: req.user.id });
      await connection.query(
        `INSERT INTO hire_deposit_transactions (
           transaction_number, hire_location_id, contract_id, customer_id,
           transaction_type, transaction_date, amount, reason, status,
           created_by, approved_by, approved_at
         ) VALUES (?, ?, ?, ?, 'allocation', NOW(), ?, ?, 'approved', ?, ?, NOW())`,
        [number, locationId(req), row.contract_id, row.customer_id, depositApplied,
          `Damage settlement ${row.assessment_number}`, req.user.id, req.user.id]
      );
      await recalculateDepositBalance(connection, row.contract_id, req.user.id);
    }
    await connection.query(
      `UPDATE hire_damage_assessments
       SET deposit_applied_amount = ?, invoiced_amount = ?, waived_amount = ?,
           settled_amount = ?, settlement_method = ?, settlement_notes = ?,
           status = 'settled', settled_by = ?, settled_at = NOW()
       WHERE id = ?`,
      [depositApplied, invoiced, waived, settled, method,
        nullableText(req.body.settlement_notes, 3000), req.user.id, row.id]
    );
    await connection.query(`UPDATE hire_commercial_approvals SET status = 'approved', decided_by = ?, decided_at = NOW(), decision_notes = ? WHERE entity_type = 'damage_assessment' AND entity_id = ? AND status = 'pending'`, [req.user.id, nullableText(req.body.settlement_notes, 500), row.id]);
    await audit(connection, req, "SETTLE_HIRE_DAMAGE_ASSESSMENT", `Settled ${row.assessment_number}.`, "hire_damage_assessment", row.id, "critical");
    await connection.commit();
    res.json({ status: "success", message: "Damage assessment settled with a balanced allocation." });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.get("/documents/:type/:id.pdf", requirePermission("hire.commercial.view"), async (req, res, next) => {
  try {
    const type = cleanText(req.params.type, 30).toLowerCase();
    const id = positiveId(req.params.id);
    if (!id || !["quotation", "contract", "damage"].includes(type)) throw appError("Unsupported commercial document.", 404);
    if (type === "quotation") {
      const [[quote]] = await pool.query(
        `SELECT hq.*, hcu.customer_name, hcu.customer_code
         FROM hire_quotations hq INNER JOIN hire_customers hcu ON hcu.id = hq.customer_id
         WHERE hq.id = ? AND hq.hire_location_id = ? LIMIT 1`, [id, locationId(req)]
      );
      if (!quote) throw appError("Quotation not found.", 404);
      const [items] = await pool.query(`SELECT * FROM hire_quotation_items WHERE quotation_id = ? ORDER BY line_number`, [id]);
      return sendPdf(res, `${quote.quotation_number}.pdf`, "EQUIPMENT HIRE QUOTATION", {
        "Quotation": quote.quotation_number, "Customer": `${quote.customer_code} — ${quote.customer_name}`,
        "Work location": quote.work_location, "Status": quote.status, "Total": `GHS ${Number(quote.total_amount).toFixed(2)}`,
      }, [{ title: "Equipment lines", lines: items.map((item) => `${item.line_number}. ${item.description} | ${item.charging_method} | Qty ${item.estimated_quantity} | Rate GHS ${Number(item.rate).toFixed(2)} | Total GHS ${Number(item.line_total).toFixed(2)}`) }, { title: "Terms", lines: [quote.terms || "No additional terms recorded."] }]);
    }
    if (type === "contract") {
      const [[contract]] = await pool.query(
        `SELECT hc.*, hcu.customer_name, hcu.customer_code
         FROM hire_contracts hc INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
         WHERE hc.id = ? AND hc.hire_location_id = ? LIMIT 1`, [id, locationId(req)]
      );
      if (!contract) throw appError("Contract not found.", 404);
      const [items] = await pool.query(`SELECT * FROM hire_contract_items WHERE contract_id = ? ORDER BY line_number`, [id]);
      const [amendments] = await pool.query(`SELECT * FROM hire_contract_amendments WHERE contract_id = ? ORDER BY created_at`, [id]);
      return sendPdf(res, `${contract.contract_number}.pdf`, "EQUIPMENT HIRE CONTRACT", {
        "Contract": contract.contract_number, "Customer": `${contract.customer_code} — ${contract.customer_name}`,
        "Work location": contract.work_location, "Period": `${contract.start_date} to ${contract.expected_end_date || "open"}`,
        "Deposit required": `GHS ${Number(contract.deposit_required).toFixed(2)}`,
      }, [{ title: "Commercial lines", lines: items.map((item) => `${item.line_number}. ${item.description} | ${item.charging_method} | Rate GHS ${Number(item.rate).toFixed(2)} | Agreed GHS ${Number(item.agreed_line_total).toFixed(2)}`) }, { title: "Approved amendments", lines: amendments.filter((row) => row.status === "approved").map((row) => `${row.amendment_number}: ${row.amendment_type} effective ${row.effective_date} — ${row.reason}`) }, { title: "Terms", lines: [contract.terms || "No additional terms recorded."] }]);
    }
    const [[damage]] = await pool.query(
      `SELECT hda.*, hc.contract_number, hcu.customer_name, fa.asset_code, fa.asset_name
       FROM hire_damage_assessments hda
       INNER JOIN hire_contracts hc ON hc.id = hda.contract_id
       INNER JOIN hire_customers hcu ON hcu.id = hda.customer_id
       INNER JOIN hire_contract_assets hca ON hca.id = hda.contract_asset_id
       INNER JOIN fleet_assets fa ON fa.id = hca.asset_id
       WHERE hda.id = ? AND hda.hire_location_id = ? LIMIT 1`, [id, locationId(req)]
    );
    if (!damage) throw appError("Damage assessment not found.", 404);
    return sendPdf(res, `${damage.assessment_number}.pdf`, "EQUIPMENT RETURN DAMAGE ASSESSMENT", {
      "Assessment": damage.assessment_number, "Contract": damage.contract_number,
      "Customer": damage.customer_name, "Equipment": `${damage.asset_code} — ${damage.asset_name}`,
      "Status": damage.status,
    }, [{ title: "Assessment", lines: [damage.damage_summary, `Assessed: GHS ${Number(damage.assessed_amount).toFixed(2)}`, `Customer liability: GHS ${Number(damage.customer_liability_amount).toFixed(2)}`, damage.assessment_notes || "No assessment notes."] }, { title: "Settlement", lines: [`Method: ${damage.settlement_method || "Pending"}`, `Deposit applied: GHS ${Number(damage.deposit_applied_amount).toFixed(2)}`, `Invoiced: GHS ${Number(damage.invoiced_amount).toFixed(2)}`, `Waived: GHS ${Number(damage.waived_amount).toFixed(2)}`, `Directly settled: GHS ${Number(damage.settled_amount).toFixed(2)}`, damage.settlement_notes || "No settlement notes."] }]);
  } catch (error) { next(error); }
});

router.use((error, req, res, next) => {
  if (sendHireLocationScopeError(res, error)) return;
  if (error?.code === "ER_NO_SUCH_TABLE" || error?.errno === 1146 || error?.code === "ER_BAD_FIELD_ERROR") {
    return res.status(503).json({ status: "error", code: "RELEASE3C_DATABASE_SETUP_REQUIRED", message: "Release 3C Equipment Hire migration has not been applied yet." });
  }
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ status: "error", code: "DUPLICATE_HIRE_COMMERCIAL_RECORD", message: "This Equipment Hire commercial record already exists." });
  }
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ status: "error", code: error.code || "HIRE_COMMERCIAL_ERROR", message: error.message });
  }
  console.error("Hire commercial control error:", error);
  return res.status(500).json({ status: "error", message: "The Equipment Hire commercial operation could not be completed safely." });
});

module.exports = router;
