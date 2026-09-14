const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { normalizePhone } = require("../services/customerIdentityMatchingService");

const router = express.Router();

const MERGE_ACTION = "MERGE_CUSTOMER_IDENTITIES";
const UNDO_ACTION = "UNDO_CUSTOMER_IDENTITY_MERGE";
const MERGE_FREEZE_MESSAGE =
  "Customer merging is temporarily frozen while today's customer debt assignments are reviewed. No sale, debt or payment has been deleted.";

router.use(requireAuth);
router.use(requireRole("admin"));

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function roundMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function getBranchId(req) {
  return positiveId(req.user?.branch_id || req.user?.default_branch_id);
}

function dateOnly(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : new Date().toISOString().slice(0, 10);
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function identityMatches(snapshotName, snapshotPhone, profile) {
  const snapshotPhoneNormalized = normalizePhone(snapshotPhone);
  const profilePhoneNormalized = normalizePhone(profile?.phone);
  const phoneMatch = Boolean(
    snapshotPhoneNormalized &&
      profilePhoneNormalized &&
      snapshotPhoneNormalized === profilePhoneNormalized
  );
  const snapshotNameNormalized = normalizeName(snapshotName);
  const profileNameNormalized = normalizeName(profile?.name);
  const nameMatch = Boolean(
    snapshotNameNormalized &&
      profileNameNormalized &&
      snapshotNameNormalized === profileNameNormalized
  );
  return { phoneMatch, nameMatch, matched: phoneMatch || nameMatch };
}

async function tableHasColumns(connection, tableName, columnNames) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );
  const columns = new Set(rows.map((row) => row.COLUMN_NAME));
  return columnNames.every((column) => columns.has(column));
}

async function loadMergeAudit(connection, branchId, activityId, lock = false) {
  const [rows] = await connection.query(
    `SELECT
       al.id,
       al.branch_id,
       al.user_id,
       al.entity_id,
       al.action,
       al.action_type,
       al.details,
       al.metadata_json,
       al.created_at,
       u.full_name AS performed_by_name,
       u.username AS performed_by_username
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.id = ?
       AND al.branch_id = ?
       AND (al.action = ? OR al.action_type = ?)
     LIMIT 1
     ${lock ? "FOR UPDATE" : ""}`,
    [activityId, branchId, MERGE_ACTION, MERGE_ACTION]
  );
  const row = rows[0];
  if (!row) return null;
  return { ...row, metadata: parseMetadata(row.metadata_json) };
}

async function loadMergeAuditsForDate(connection, branchId, reviewDate) {
  const [rows] = await connection.query(
    `SELECT
       al.id,
       al.branch_id,
       al.user_id,
       al.entity_id,
       al.action,
       al.action_type,
       al.details,
       al.metadata_json,
       al.created_at,
       u.full_name AS performed_by_name,
       u.username AS performed_by_username
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.branch_id = ?
       AND DATE(al.created_at) = ?
       AND (al.action = ? OR al.action_type = ?)
     ORDER BY al.created_at DESC, al.id DESC`,
    [branchId, reviewDate, MERGE_ACTION, MERGE_ACTION]
  );
  return rows.map((row) => ({ ...row, metadata: parseMetadata(row.metadata_json) }));
}

async function wasMergeReversed(connection, branchId, activityId) {
  const marker = `[MergeUndo:${activityId}]`;
  const [rows] = await connection.query(
    `SELECT id, created_at, details
     FROM activity_log
     WHERE branch_id = ?
       AND (action = ? OR action_type = ?)
       AND details LIKE ?
     ORDER BY id DESC
     LIMIT 1`,
    [branchId, UNDO_ACTION, UNDO_ACTION, `%${marker}%`]
  );
  return rows[0] || null;
}

async function loadTargetTransactions(connection, branchId, targetCustomerId) {
  const [rows] = await connection.query(
    `SELECT
       s.id AS sale_id,
       s.receipt_number,
       s.customer_id AS current_customer_id,
       s.customer_name AS sale_customer_name_snapshot,
       s.customer_phone AS sale_customer_phone_snapshot,
       s.total AS sale_total,
       s.amount_paid AS sale_amount_paid,
       s.balance AS sale_balance,
       s.payment_type,
       s.sale_status,
       s.is_voided,
       s.created_at AS sale_date,
       d.id AS debt_id,
       d.customer_id AS debt_customer_id,
       d.customer_name AS debt_customer_name_snapshot,
       d.customer_phone AS debt_customer_phone_snapshot,
       d.amount_owed,
       d.amount_paid AS debt_amount_paid,
       d.balance AS debt_balance,
       d.status AS debt_status,
       d.due_date,
       COALESCE(payment_summary.payment_total, 0) AS debt_payment_total,
       COALESCE(payment_summary.payment_count, 0) AS debt_payment_count
     FROM sales s
     LEFT JOIN debts d
       ON d.sale_id = s.id
      AND d.branch_id = s.branch_id
     LEFT JOIN (
       SELECT
         branch_id,
         debt_id,
         SUM(amount) AS payment_total,
         COUNT(*) AS payment_count
       FROM debt_payments
       GROUP BY branch_id, debt_id
     ) payment_summary
       ON payment_summary.branch_id = d.branch_id
      AND payment_summary.debt_id = d.id
     WHERE s.branch_id = ?
       AND s.customer_id = ?
     ORDER BY s.created_at DESC, s.id DESC, d.id DESC`,
    [branchId, targetCustomerId]
  );
  return rows;
}

function decorateTransaction(row, sourceProfiles, targetProfile) {
  const snapshotName =
    row.sale_customer_name_snapshot || row.debt_customer_name_snapshot || "";
  const snapshotPhone =
    row.sale_customer_phone_snapshot || row.debt_customer_phone_snapshot || "";
  const matches = sourceProfiles
    .map((profile) => ({
      source_customer_id: positiveId(profile.id),
      source_customer_name: profile.name || "",
      ...identityMatches(snapshotName, snapshotPhone, profile),
    }))
    .filter((match) => match.matched);
  const targetMatch = identityMatches(snapshotName, snapshotPhone, targetProfile).matched;
  const recommendedSourceId =
    matches.length === 1 && !targetMatch ? matches[0].source_customer_id : null;

  return {
    sale_id: Number(row.sale_id),
    receipt_number: row.receipt_number,
    sale_customer_name_snapshot: row.sale_customer_name_snapshot,
    sale_customer_phone_snapshot: row.sale_customer_phone_snapshot,
    sale_total: roundMoney(row.sale_total),
    sale_amount_paid: roundMoney(row.sale_amount_paid),
    sale_balance: roundMoney(row.sale_balance),
    payment_type: row.payment_type,
    sale_status: row.sale_status,
    is_voided: Number(row.is_voided || 0) === 1,
    sale_date: row.sale_date,
    debt_id: row.debt_id ? Number(row.debt_id) : null,
    debt_customer_name_snapshot: row.debt_customer_name_snapshot,
    debt_customer_phone_snapshot: row.debt_customer_phone_snapshot,
    amount_owed: roundMoney(row.amount_owed),
    debt_amount_paid: roundMoney(row.debt_amount_paid),
    debt_balance: roundMoney(row.debt_balance),
    debt_status: row.debt_status,
    due_date: row.due_date,
    debt_payment_total: roundMoney(row.debt_payment_total),
    debt_payment_count: Number(row.debt_payment_count || 0),
    source_matches: matches,
    target_snapshot_match: targetMatch,
    recommended_source_customer_id: recommendedSourceId,
    review_status: recommendedSourceId
      ? "strong_source_match"
      : matches.length > 0
        ? "ambiguous_match"
        : targetMatch
          ? "target_match"
          : "manual_review",
  };
}

async function buildMergeReview(connection, branchId, audit) {
  const metadata = audit.metadata || {};
  const targetId =
    positiveId(audit.entity_id) ||
    positiveId(metadata.target_customer_after?.id) ||
    positiveId(metadata.target_customer_before?.id);
  const sourceProfiles = Array.isArray(metadata.source_customers)
    ? metadata.source_customers.filter((profile) => positiveId(profile?.id))
    : [];
  const targetBefore = metadata.target_customer_before || {};
  const [targetRows] = targetId
    ? await connection.query(
        `SELECT id, branch_id, name, phone, location, created_at, updated_at
         FROM customers
         WHERE id = ? AND branch_id = ?
         LIMIT 1`,
        [targetId, branchId]
      )
    : [[]];
  const currentTarget = targetRows[0] || null;
  const transactions = targetId
    ? await loadTargetTransactions(connection, branchId, targetId)
    : [];
  const decoratedTransactions = transactions.map((row) =>
    decorateTransaction(row, sourceProfiles, currentTarget || targetBefore)
  );
  const reversal = await wasMergeReversed(connection, branchId, audit.id);

  return {
    activity_id: Number(audit.id),
    performed_at: audit.created_at,
    performed_by: audit.performed_by_name || audit.performed_by_username || "Unknown user",
    reason: metadata.reason || audit.details || "",
    target_customer_id: targetId,
    target_customer_before: targetBefore,
    target_customer_after: metadata.target_customer_after || null,
    current_target_customer: currentTarget,
    source_customers: sourceProfiles,
    original_impact: metadata.preview_impact || null,
    original_counts: {
      sales_relinked: Number(metadata.sales_relinked || 0),
      debts_relinked: Number(metadata.debts_relinked || 0),
      installment_agreements_relinked: Number(
        metadata.installment_agreements_relinked || 0
      ),
      source_customers_removed: Number(metadata.source_customers_removed || 0),
    },
    reversed: Boolean(reversal),
    reversal,
    summary: {
      current_sale_count: new Set(decoratedTransactions.map((row) => row.sale_id)).size,
      current_sales_value: roundMoney(
        decoratedTransactions.reduce((sum, row) => sum + row.sale_total, 0)
      ),
      current_debt_balance: roundMoney(
        decoratedTransactions.reduce((sum, row) => sum + row.debt_balance, 0)
      ),
      strong_source_matches: decoratedTransactions.filter(
        (row) => row.review_status === "strong_source_match"
      ).length,
      ambiguous_rows: decoratedTransactions.filter(
        (row) => row.review_status === "ambiguous_match"
      ).length,
      manual_review_rows: decoratedTransactions.filter(
        (row) => row.review_status === "manual_review"
      ).length,
    },
    transactions: decoratedTransactions,
  };
}

async function loadDebtIntegrity(connection, branchId) {
  const [rows] = await connection.query(
    `SELECT
       d.id AS debt_id,
       d.sale_id,
       d.customer_id AS debt_customer_id,
       s.customer_id AS sale_customer_id,
       s.receipt_number,
       s.customer_name AS sale_customer_name_snapshot,
       s.customer_phone AS sale_customer_phone_snapshot,
       c.name AS current_customer_name,
       c.phone AS current_customer_phone,
       s.total AS sale_total,
       s.amount_paid AS sale_amount_paid,
       s.balance AS sale_balance,
       d.amount_owed,
       d.amount_paid AS debt_amount_paid,
       d.balance AS debt_balance,
       d.status AS debt_status,
       s.sale_status,
       s.is_voided,
       s.created_at AS sale_date,
       COALESCE(payment_summary.payment_total, 0) AS payment_total
     FROM debts d
     LEFT JOIN sales s
       ON s.id = d.sale_id
      AND s.branch_id = d.branch_id
     LEFT JOIN customers c
       ON c.id = COALESCE(s.customer_id, d.customer_id)
      AND c.branch_id = d.branch_id
     LEFT JOIN (
       SELECT branch_id, debt_id, SUM(amount) AS payment_total
       FROM debt_payments
       GROUP BY branch_id, debt_id
     ) payment_summary
       ON payment_summary.branch_id = d.branch_id
      AND payment_summary.debt_id = d.id
     WHERE d.branch_id = ?
     ORDER BY d.created_at DESC, d.id DESC`,
    [branchId]
  );

  const anomalies = [];
  const customerGroups = new Map();

  for (const row of rows) {
    const reasons = [];
    if (!row.sale_id || !row.receipt_number) reasons.push("orphan_debt_without_sale");
    if (
      row.sale_customer_id &&
      row.debt_customer_id &&
      Number(row.sale_customer_id) !== Number(row.debt_customer_id)
    ) {
      reasons.push("sale_and_debt_customer_mismatch");
    }
    if (row.sale_id && Math.abs(Number(row.amount_owed || 0) - Number(row.sale_total || 0)) >= 0.01) {
      reasons.push("debt_owed_differs_from_sale_total");
    }
    if (row.sale_id && Math.abs(Number(row.debt_amount_paid || 0) - Number(row.sale_amount_paid || 0)) >= 0.01) {
      reasons.push("debt_paid_differs_from_sale_paid");
    }
    if (row.sale_id && Math.abs(Number(row.debt_balance || 0) - Number(row.sale_balance || 0)) >= 0.01) {
      reasons.push("debt_balance_differs_from_sale_balance");
    }
    const expectedDebtPaid = roundMoney(
      Math.max(Number(row.sale_amount_paid || 0), 0)
    );
    const recordedCollection = roundMoney(row.payment_total);
    if (recordedCollection > expectedDebtPaid + 0.01) {
      reasons.push("payment_ledger_exceeds_recorded_sale_paid");
    }

    if (reasons.length > 0) {
      anomalies.push({
        debt_id: Number(row.debt_id),
        sale_id: row.sale_id ? Number(row.sale_id) : null,
        receipt_number: row.receipt_number,
        customer_id: positiveId(row.sale_customer_id || row.debt_customer_id),
        current_customer_name: row.current_customer_name,
        sale_customer_name_snapshot: row.sale_customer_name_snapshot,
        sale_total: roundMoney(row.sale_total),
        amount_owed: roundMoney(row.amount_owed),
        sale_amount_paid: roundMoney(row.sale_amount_paid),
        debt_amount_paid: roundMoney(row.debt_amount_paid),
        sale_balance: roundMoney(row.sale_balance),
        debt_balance: roundMoney(row.debt_balance),
        payment_total: recordedCollection,
        reasons,
      });
    }

    const customerId = positiveId(row.sale_customer_id || row.debt_customer_id);
    if (!customerId) continue;
    if (!customerGroups.has(customerId)) {
      customerGroups.set(customerId, {
        customer_id: customerId,
        current_customer_name: row.current_customer_name,
        snapshots: new Map(),
        debt_count: 0,
        outstanding_balance: 0,
      });
    }
    const group = customerGroups.get(customerId);
    const identityKey = `${normalizeName(row.sale_customer_name_snapshot)}|${normalizePhone(
      row.sale_customer_phone_snapshot
    )}`;
    if (identityKey !== "|") {
      group.snapshots.set(identityKey, {
        name: row.sale_customer_name_snapshot,
        phone: row.sale_customer_phone_snapshot,
      });
    }
    group.debt_count += 1;
    group.outstanding_balance += Number(row.debt_balance || 0);
  }

  const mixedIdentityAccounts = [...customerGroups.values()]
    .filter((group) => group.snapshots.size > 1)
    .map((group) => ({
      customer_id: group.customer_id,
      current_customer_name: group.current_customer_name,
      debt_count: group.debt_count,
      outstanding_balance: roundMoney(group.outstanding_balance),
      preserved_sale_identities: [...group.snapshots.values()],
    }))
    .sort((left, right) => right.outstanding_balance - left.outstanding_balance);

  return {
    checked_debt_records: rows.length,
    anomaly_count: anomalies.length,
    mixed_identity_account_count: mixedIdentityAccounts.length,
    anomalies,
    mixed_identity_accounts: mixedIdentityAccounts,
  };
}

async function restoreSourceCustomer(connection, branchId, sourceProfile) {
  const originalId = positiveId(sourceProfile.id);
  const [existingRows] = originalId
    ? await connection.query(
        `SELECT id, branch_id, name, phone, location
         FROM customers
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [originalId]
      )
    : [[]];
  const existing = existingRows[0];

  if (existing && Number(existing.branch_id) === Number(branchId)) {
    return { customerId: Number(existing.id), reused: true, originalIdPreserved: true };
  }

  const values = [
    branchId,
    cleanText(sourceProfile.name, 150) || "Recovered Customer",
    cleanText(sourceProfile.phone, 30) || null,
    cleanText(sourceProfile.location, 150) || null,
  ];

  if (originalId && !existing) {
    const [result] = await connection.query(
      `INSERT INTO customers (id, branch_id, name, phone, location, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`,
      [originalId, ...values, sourceProfile.created_at || null]
    );
    return {
      customerId: Number(result.insertId || originalId),
      reused: false,
      originalIdPreserved: true,
    };
  }

  const [result] = await connection.query(
    `INSERT INTO customers (branch_id, name, phone, location)
     VALUES (?, ?, ?, ?)`,
    values
  );
  return {
    customerId: Number(result.insertId),
    reused: false,
    originalIdPreserved: false,
  };
}

router.get("/status", async (req, res) => {
  return res.json({
    status: "success",
    merge_writes_frozen: true,
    message: MERGE_FREEZE_MESSAGE,
    review_date: new Date().toISOString().slice(0, 10),
  });
});

router.get("/today", async (req, res) => {
  try {
    const branchId = getBranchId(req);
    if (!branchId) {
      return res.status(400).json({ status: "error", message: "No store is selected." });
    }
    const reviewDate = dateOnly(req.query.date);
    const audits = await loadMergeAuditsForDate(pool, branchId, reviewDate);
    const reviews = [];
    for (const audit of audits) {
      reviews.push(await buildMergeReview(pool, branchId, audit));
    }
    return res.json({
      status: "success",
      branch_id: branchId,
      review_date: reviewDate,
      merge_writes_frozen: true,
      message: MERGE_FREEZE_MESSAGE,
      merge_count: reviews.length,
      merges: reviews,
    });
  } catch (error) {
    console.error("Customer merge recovery review error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load today's customer merge audit safely.",
    });
  }
});

router.get("/integrity", async (req, res) => {
  try {
    const branchId = getBranchId(req);
    if (!branchId) {
      return res.status(400).json({ status: "error", message: "No store is selected." });
    }
    const report = await loadDebtIntegrity(pool, branchId);
    return res.json({
      status: "success",
      branch_id: branchId,
      generated_at: new Date().toISOString(),
      ...report,
    });
  } catch (error) {
    console.error("Customer debt integrity review error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not complete the customer debt integrity review.",
    });
  }
});

router.post("/:activityId/reverse", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const branchId = getBranchId(req);
    const activityId = positiveId(req.params.activityId);
    const confirmation = cleanText(req.body?.confirmation, 30).toUpperCase();
    const reason = cleanText(req.body?.reason, 500);
    const rawAssignments = Array.isArray(req.body?.assignments)
      ? req.body.assignments
      : [];

    if (!branchId || !activityId) {
      return res.status(400).json({ status: "error", message: "Invalid merge recovery request." });
    }
    if (confirmation !== "UNDO MERGE") {
      return res.status(400).json({
        status: "error",
        message: "Type UNDO MERGE exactly to authorize this financial identity correction.",
      });
    }
    if (reason.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Enter a clear reason of at least 10 characters.",
      });
    }

    const assignments = rawAssignments
      .map((item) => ({
        saleId: positiveId(item?.sale_id),
        sourceCustomerId: positiveId(item?.source_customer_id),
      }))
      .filter((item) => item.saleId && item.sourceCustomerId);
    const uniqueSaleIds = [...new Set(assignments.map((item) => item.saleId))];
    if (assignments.length === 0 || uniqueSaleIds.length !== assignments.length) {
      return res.status(400).json({
        status: "error",
        message: "Select at least one receipt and assign each receipt only once.",
      });
    }

    await connection.beginTransaction();
    const audit = await loadMergeAudit(connection, branchId, activityId, true);
    if (!audit) {
      const error = new Error("The selected customer merge audit record was not found.");
      error.statusCode = 404;
      throw error;
    }
    if (await wasMergeReversed(connection, branchId, activityId)) {
      const error = new Error("This customer merge has already been reversed.");
      error.statusCode = 409;
      throw error;
    }

    const metadata = audit.metadata || {};
    const targetCustomerId =
      positiveId(audit.entity_id) ||
      positiveId(metadata.target_customer_after?.id) ||
      positiveId(metadata.target_customer_before?.id);
    const sourceProfiles = Array.isArray(metadata.source_customers)
      ? metadata.source_customers.filter((profile) => positiveId(profile?.id))
      : [];
    const sourceMap = new Map(sourceProfiles.map((profile) => [Number(profile.id), profile]));
    for (const assignment of assignments) {
      if (!sourceMap.has(assignment.sourceCustomerId)) {
        const error = new Error("A selected receipt was assigned to a customer outside this merge audit.");
        error.statusCode = 400;
        throw error;
      }
    }

    const placeholders = uniqueSaleIds.map(() => "?").join(",");
    const [sales] = await connection.query(
      `SELECT id, customer_id, receipt_number
       FROM sales
       WHERE branch_id = ?
         AND id IN (${placeholders})
       FOR UPDATE`,
      [branchId, ...uniqueSaleIds]
    );
    if (sales.length !== uniqueSaleIds.length) {
      const error = new Error("One or more selected receipts no longer exist in this store.");
      error.statusCode = 409;
      throw error;
    }
    if (sales.some((sale) => Number(sale.customer_id) !== Number(targetCustomerId))) {
      const error = new Error(
        "One or more selected receipts are no longer attached to the merged target. Refresh the review before trying again."
      );
      error.statusCode = 409;
      throw error;
    }

    const restoredCustomers = new Map();
    const results = [];
    for (const sourceCustomerId of [...new Set(assignments.map((item) => item.sourceCustomerId))]) {
      const restored = await restoreSourceCustomer(
        connection,
        branchId,
        sourceMap.get(sourceCustomerId)
      );
      restoredCustomers.set(sourceCustomerId, restored);
    }

    for (const [sourceCustomerId, restored] of restoredCustomers.entries()) {
      const saleIds = assignments
        .filter((item) => item.sourceCustomerId === sourceCustomerId)
        .map((item) => item.saleId);
      const salePlaceholders = saleIds.map(() => "?").join(",");
      const [saleUpdate] = await connection.query(
        `UPDATE sales
         SET customer_id = ?
         WHERE branch_id = ?
           AND customer_id = ?
           AND id IN (${salePlaceholders})`,
        [restored.customerId, branchId, targetCustomerId, ...saleIds]
      );
      const [debtUpdate] = await connection.query(
        `UPDATE debts
         SET customer_id = ?
         WHERE branch_id = ?
           AND sale_id IN (${salePlaceholders})`,
        [restored.customerId, branchId, ...saleIds]
      );

      let installmentUpdated = 0;
      if (
        await tableHasColumns(connection, "installment_agreements", [
          "branch_id",
          "sale_id",
          "customer_id",
        ])
      ) {
        const [installmentUpdate] = await connection.query(
          `UPDATE installment_agreements
           SET customer_id = ?
           WHERE branch_id = ?
             AND sale_id IN (${salePlaceholders})`,
          [restored.customerId, branchId, ...saleIds]
        );
        installmentUpdated = Number(installmentUpdate.affectedRows || 0);
      }

      results.push({
        original_source_customer_id: sourceCustomerId,
        restored_customer_id: restored.customerId,
        original_id_preserved: restored.originalIdPreserved,
        sale_ids: saleIds,
        sales_reassigned: Number(saleUpdate.affectedRows || 0),
        debts_reassigned: Number(debtUpdate.affectedRows || 0),
        installment_agreements_reassigned: installmentUpdated,
      });
    }

    const marker = `[MergeUndo:${activityId}]`;
    await writeAuditEvent({
      connection,
      req,
      branchId,
      action: UNDO_ACTION,
      details: `${marker} Reversed selected receipt assignments from customer merge audit ${activityId}. Reason: ${reason}`,
      workspaceCode: "spare_parts",
      entityType: "customer_merge_recovery",
      entityId: activityId,
      actionType: UNDO_ACTION,
      outcome: "success",
      severity: "critical",
      metadata: {
        original_merge_activity_id: activityId,
        target_customer_id: targetCustomerId,
        reason,
        assignments,
        results,
      },
    });

    await connection.commit();
    return res.json({
      status: "success",
      message:
        "Selected receipts, debts and installment links were returned to the restored customer profiles. No debt amount or payment amount was recalculated or deleted.",
      result: {
        original_merge_activity_id: activityId,
        target_customer_id: targetCustomerId,
        recovered_sources: results,
      },
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Keep the original recovery error.
    }
    console.error("Customer merge reversal error:", error);
    return res.status(error.statusCode || 500).json({
      status: "error",
      message:
        error.statusCode && error.message
          ? error.message
          : "The customer merge correction was stopped safely. No partial change was saved.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
module.exports.MERGE_FREEZE_MESSAGE = MERGE_FREEZE_MESSAGE;
module.exports.MERGE_ACTION = MERGE_ACTION;
module.exports.UNDO_ACTION = UNDO_ACTION;
