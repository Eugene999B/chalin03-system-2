const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  auditApprovalEvent,
  cleanText,
  ensureOperationalColumns,
  getBranchId,
  getUserId,
  hashPayload,
  normalizeRequestRow,
  positiveInteger,
  stableStringify,
} = require("../services/operationalApprovalService");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  buildOwnerAlertContext,
  formatMoney,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");

const router = express.Router();
const PRODUCT_DELETE_KIND = "product_delete";
const REQUEST_EXPIRY_HOURS = 24;

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function randomRequestCode() {
  return `APR-PD-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

function productSnapshot(product) {
  return {
    id: Number(product.id),
    branch_id: Number(product.branch_id),
    name: product.name || "",
    size: product.size || "",
    category: product.category || "",
    barcode: product.barcode || "",
    quantity: Number(product.quantity || 0),
    cost_price: Number(product.cost_price || 0).toFixed(2),
    selling_price: Number(product.selling_price || 0).toFixed(2),
    updated_at: isoDate(product.updated_at),
  };
}

function sameSnapshot(expected = {}, actual = {}) {
  const keys = [
    "id",
    "branch_id",
    "name",
    "size",
    "category",
    "barcode",
    "quantity",
    "cost_price",
    "selling_price",
    "updated_at",
  ];
  return keys.every(
    (key) => String(expected?.[key] ?? "") === String(actual?.[key] ?? "")
  );
}

async function createNotification(connection, request) {
  try {
    const notificationKey = `approval.${request.id}.${PRODUCT_DELETE_KIND}`;
    const [result] = await connection.query(
      `INSERT INTO notifications (
         notification_key, workspace_code, branch_id,
         target_role, category, notification_type, severity,
         title, message, action_path, source_type, source_reference,
         status, auto_generated, occurred_at, metadata_json, created_by
       ) VALUES (?, 'spare_parts', ?, 'admin', 'approval', 'approval_request',
         'critical', ?, ?, '/audit-unlock-requests', 'approval_request', ?,
         'active', TRUE, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         message = VALUES(message),
         status = 'active',
         occurred_at = NOW(),
         metadata_json = VALUES(metadata_json),
         updated_at = NOW()`,
      [
        notificationKey,
        request.branch_id,
        `CRITICAL product deletion ${request.request_code}`,
        request.notification_message,
        request.request_code,
        JSON.stringify({
          approval_request_id: request.id,
          approval_kind: PRODUCT_DELETE_KIND,
          entity_type: "product",
          entity_id: request.entity_id,
          system_administrator_only: true,
        }),
        request.requested_by,
      ]
    );

    const notificationId = result.insertId || null;
    if (notificationId) {
      await connection.query(
        `UPDATE audit_unlock_requests SET notification_id = ? WHERE id = ?`,
        [notificationId, request.id]
      );
    }
    return notificationId;
  } catch (error) {
    console.warn("Product deletion approval notification skipped:", error.message);
    return null;
  }
}

async function loadProduct(connection, productId, branchId, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT id, branch_id, name, size, category, barcode, quantity,
            cost_price, selling_price, is_active, updated_at
     FROM products
     WHERE id = ? AND branch_id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [productId, branchId]
  );
  return rows[0] || null;
}

async function loadProductDeleteRequest(connection, requestId, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT aur.*,
            requester.full_name AS requested_by_name,
            requester.username AS requested_by_username,
            requester.role AS requested_by_role,
            b.code AS branch_code,
            b.name AS branch_name,
            b.location AS branch_location
     FROM audit_unlock_requests aur
     LEFT JOIN users requester ON requester.id = aur.requested_by
     LEFT JOIN branches b ON b.id = aur.branch_id
     WHERE aur.id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [requestId]
  );
  if (!rows[0] || rows[0].approval_kind !== PRODUCT_DELETE_KIND) return null;
  return normalizeRequestRow(rows[0]);
}

async function verifyOriginalSystemAdminPassword(connection, req, password) {
  if (!isOriginalSystemAdministrator(req.user)) {
    const error = new Error(
      "Only the original System Administrator can approve or reject a product deletion request."
    );
    error.statusCode = 403;
    error.code = "PRODUCT_DELETE_SYSTEM_ADMIN_ONLY";
    throw error;
  }

  const reviewerId = getUserId(req);
  const [rows] = await connection.query(
    `SELECT id, full_name, username, role, password_hash, is_active
     FROM users
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [reviewerId]
  );
  const reviewer = rows[0];

  if (
    !reviewer ||
    Number(reviewer.is_active || 0) !== 1 ||
    !isOriginalSystemAdministrator(reviewer)
  ) {
    const error = new Error("The original System Administrator account is inactive or unavailable.");
    error.statusCode = 403;
    error.code = "SYSTEM_ADMIN_ACCOUNT_UNAVAILABLE";
    throw error;
  }

  if (!password || !(await bcrypt.compare(String(password), reviewer.password_hash))) {
    const error = new Error("System Administrator password is incorrect.");
    error.statusCode = 401;
    error.code = "SYSTEM_ADMIN_PASSWORD_INVALID";
    throw error;
  }

  return reviewer;
}

async function sendDeletionRequestAlert({ product, req, branchId, requestCode, reason }) {
  try {
    const { businessName, branch } = await buildOwnerAlertContext(branchId);
    const requester =
      req.user?.full_name || req.user?.username || `User ${getUserId(req)}`;
    const role = String(req.user?.role || "staff").toUpperCase();
    const message =
      `${businessName}: CRITICAL PRODUCT DELETION REQUEST. ${product.name} ` +
      `(barcode ${product.barcode || "-"}, qty ${Number(product.quantity || 0)}, ` +
      `selling GHS ${formatMoney(product.selling_price)}) at ${branch.name} (${branch.code}). ` +
      `Requested by ${requester} [${role}] on ${formatSecurityDateTime()}. ` +
      `Ref ${requestCode}. Reason: ${cleanText(reason, 140)}. ` +
      `NO PRODUCT REMOVED - original System Administrator approval required.`;

    await sendOwnerSmsAlert({
      branchId,
      message,
      smsType: "security_alert",
      sentBy: getUserId(req),
      sourceReference: requestCode,
    });
  } catch (error) {
    console.warn("Product deletion request SMS alert skipped:", error.message);
  }
}

async function sendDeletionOutcomeAlert({
  product,
  branchId,
  request,
  reviewer,
  outcome,
  note,
}) {
  try {
    const { businessName, branch } = await buildOwnerAlertContext(branchId);
    const requester =
      request.requested_by_name || request.requested_by_username || `User ${request.requested_by}`;
    const message =
      `${businessName}: PRODUCT DELETION ${outcome}. ${product?.name || "Product"} ` +
      `(ID ${request.entity_id}, barcode ${product?.barcode || request.approval_payload?.product_snapshot?.barcode || "-"}). ` +
      `Request ${request.request_code} by ${requester}. ` +
      `Reviewed by ${reviewer.full_name || reviewer.username} on ${formatSecurityDateTime()}. ` +
      `Store ${branch.name} (${branch.code}). ${cleanText(note, 160)}`;

    await sendOwnerSmsAlert({
      branchId,
      message,
      smsType: "security_alert",
      sentBy: reviewer.id,
      sourceReference: request.request_code,
    });
  } catch (error) {
    console.warn("Product deletion outcome SMS alert skipped:", error.message);
  }
}

router.post(
  "/operational/product-delete/:productId",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;
    let committed = false;

    try {
      await ensureOperationalColumns(connection);

      const branchId = getBranchId(req);
      const productId = positiveInteger(req.params.productId);
      const reason = cleanText(req.body?.reason, 1000);

      if (!branchId || !productId) {
        return res.status(400).json({
          status: "error",
          message: "A valid store and product are required.",
        });
      }

      if (isOriginalSystemAdministrator(req.user)) {
        return res.status(409).json({
          status: "error",
          code: "SYSTEM_ADMIN_CAN_DELETE_DIRECTLY",
          message:
            "The original System Administrator does not need a deletion request. Use the protected Delete / Archive action directly.",
        });
      }

      if (reason.length < 8) {
        return res.status(400).json({
          status: "error",
          message: "Enter a clear deletion reason of at least 8 characters.",
        });
      }

      await connection.beginTransaction();
      transactionStarted = true;

      const product = await loadProduct(connection, productId, branchId, true);
      if (!product || Number(product.is_active || 0) !== 1) {
        const error = new Error("Active product not found in the selected store.");
        error.statusCode = 404;
        throw error;
      }

      const [pendingRows] = await connection.query(
        `SELECT id, requested_action
         FROM audit_unlock_requests
         WHERE branch_id = ?
           AND approval_kind = ?
           AND entity_type = 'product'
           AND entity_id = ?
           AND status IN ('pending', 'approved')
           AND execution_status IN ('pending', 'executing', 'failed')
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [branchId, PRODUCT_DELETE_KIND, productId]
      );

      if (pendingRows.length > 0) {
        const codeMatch = /^\[([^\]]+)\]/.exec(
          String(pendingRows[0].requested_action || "")
        );
        const requestCode = codeMatch?.[1] || `APR-${pendingRows[0].id}`;
        const error = new Error(
          `A deletion request for this product is already active (${requestCode}). Review or reject that request first.`
        );
        error.statusCode = 409;
        error.code = "PRODUCT_DELETE_REQUEST_ALREADY_PENDING";
        error.requestCode = requestCode;
        throw error;
      }

      const snapshot = productSnapshot(product);
      const payload = { reason, product_snapshot: snapshot };
      const payloadJson = stableStringify(payload);
      const payloadHash = hashPayload(payload);
      const requestCode = randomRequestCode();
      const requestedBy = getUserId(req);
      const stockValue =
        Number(product.selling_price || 0) * Number(product.quantity || 0);
      const detail = [
        `Product: ${product.name}`,
        `Barcode: ${product.barcode || "-"}`,
        `Quantity: ${Number(product.quantity || 0)}`,
        `Cost: GHS ${formatMoney(product.cost_price)}`,
        `Selling: GHS ${formatMoney(product.selling_price)}`,
        `Requested by: ${req.user?.full_name || req.user?.username || `user ${requestedBy}`}`,
        `Role: ${String(req.user?.role || "-")}`,
        `Reason: ${reason}`,
        "The product remains active until the original System Administrator approves and executes this request.",
      ].join(" | ");

      const [insertResult] = await connection.query(
        `INSERT INTO audit_unlock_requests (
           branch_id, audit_signoff_id, period_label, period_start, period_end,
           request_area, requested_action, reason, status, requested_by,
           approval_kind, entity_type, entity_id, approval_amount,
           approval_payload_json, approval_payload_hash, expires_at,
           execution_status
         ) VALUES (?, NULL, ?, NULL, NULL, 'product', ?, ?, 'pending', ?, ?,
           'product', ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), 'pending')`,
        [
          branchId,
          `Product deletion approval — ${product.name}`,
          `[${requestCode}] Archive product ${product.name} (ID ${productId})`,
          detail,
          requestedBy,
          PRODUCT_DELETE_KIND,
          productId,
          Number(stockValue.toFixed(2)),
          payloadJson,
          payloadHash,
          REQUEST_EXPIRY_HOURS,
        ]
      );

      const request = {
        id: insertResult.insertId,
        request_code: requestCode,
        branch_id: branchId,
        requested_by: requestedBy,
        approval_kind: PRODUCT_DELETE_KIND,
        entity_type: "product",
        entity_id: productId,
        approval_amount: Number(stockValue.toFixed(2)),
        approval_payload_hash: payloadHash,
        execution_status: "pending",
        status: "pending",
        notification_message:
          `${req.user?.full_name || req.user?.username || "A manager"} requested deletion of ` +
          `${product.name}. Only the original System Administrator can approve and execute this action.`,
      };

      await createNotification(connection, request);
      await auditApprovalEvent({
        req,
        connection,
        action: "CREATE_PRODUCT_DELETE_APPROVAL_REQUEST",
        request,
        severity: "critical",
        details:
          `${requestCode}: product deletion requested by user ${requestedBy}. ` +
          `Product ${product.name} remains active pending original System Administrator approval.`,
      });

      await connection.commit();
      committed = true;

      await sendDeletionRequestAlert({
        product,
        req,
        branchId,
        requestCode,
        reason,
      });

      return res.status(201).json({
        status: "success",
        pending_approval: true,
        message:
          "Deletion request sent to the original System Administrator. The product has NOT been removed.",
        request: {
          id: request.id,
          request_code: requestCode,
          execution_status: "pending",
          expires_in_hours: REQUEST_EXPIRY_HOURS,
        },
      });
    } catch (error) {
      if (transactionStarted && !committed) {
        await connection.rollback().catch(() => {});
      }
      console.error("Product deletion approval request error:", error);
      return res.status(Number(error?.statusCode || 500)).json({
        status: "error",
        code: error?.code || "PRODUCT_DELETE_REQUEST_FAILED",
        message: error?.message || "Failed to submit the product deletion request.",
        ...(error?.requestCode ? { request_code: error.requestCode } : {}),
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/operational/:id/approve",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    const requestId = positiveInteger(req.params.id);
    if (!requestId) return next();

    const probe = await loadProductDeleteRequest(pool, requestId, false).catch(() => null);
    if (!probe) return next();

    const connection = await pool.getConnection();
    let committed = false;
    let product = null;
    let request = null;
    let reviewer = null;

    try {
      await ensureOperationalColumns(connection);
      await connection.beginTransaction();

      request = await loadProductDeleteRequest(connection, requestId, true);
      if (!request) {
        const error = new Error("Product deletion approval request not found.");
        error.statusCode = 404;
        throw error;
      }

      reviewer = await verifyOriginalSystemAdminPassword(
        connection,
        req,
        String(req.body?.password || "")
      );
      const reviewNote =
        cleanText(req.body?.review_note, 5000) ||
        "Reviewed product snapshot and deletion reason. Approved by original System Administrator.";

      if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
        const error = new Error(
          "This product deletion request has expired. The requester must submit a new request."
        );
        error.statusCode = 409;
        error.code = "PRODUCT_DELETE_REQUEST_EXPIRED";
        throw error;
      }

      if (request.status !== "pending" || request.execution_status !== "pending") {
        const error = new Error("This product deletion request has already been reviewed.");
        error.statusCode = 409;
        error.code = "PRODUCT_DELETE_REQUEST_ALREADY_REVIEWED";
        throw error;
      }

      const payload = request.approval_payload || {};
      if (hashPayload(payload) !== request.approval_payload_hash) {
        const error = new Error("The deletion request failed its integrity check.");
        error.statusCode = 409;
        error.code = "PRODUCT_DELETE_PAYLOAD_INTEGRITY_FAILED";
        throw error;
      }

      product = await loadProduct(
        connection,
        positiveInteger(request.entity_id),
        positiveInteger(request.branch_id),
        true
      );
      if (!product || Number(product.is_active || 0) !== 1) {
        const error = new Error("The requested product is no longer active in this store.");
        error.statusCode = 409;
        error.code = "PRODUCT_DELETE_TARGET_NOT_ACTIVE";
        throw error;
      }

      if (!sameSnapshot(payload.product_snapshot, productSnapshot(product))) {
        await connection.query(
          `UPDATE audit_unlock_requests
           SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(),
               review_notes = ?, execution_status = 'rejected',
               execution_error = ?, execution_token_hash = NULL
           WHERE id = ?`,
          [
            reviewer.id,
            "Automatically rejected because the product changed after the request was submitted.",
            "Product snapshot changed after deletion request creation.",
            request.id,
          ]
        );
        await writeAuditEvent({
          connection,
          userId: reviewer.id,
          branchId: request.branch_id,
          action: "BLOCK_PRODUCT_DELETE_CHANGED_SINCE_REQUEST",
          details: `${request.request_code} was blocked because product ${product.name} changed after request creation.`,
          workspaceCode: "spare_parts",
          entityType: "product",
          entityId: String(product.id),
          actionType: "BLOCK_PRODUCT_DELETE_CHANGED_SINCE_REQUEST",
          outcome: "blocked",
          severity: "critical",
        });
        await connection.commit();
        committed = true;

        await sendDeletionOutcomeAlert({
          product,
          branchId: request.branch_id,
          request,
          reviewer,
          outcome: "BLOCKED",
          note: "Product details changed after the request. A fresh deletion request is required.",
        });

        return res.status(409).json({
          status: "error",
          code: "PRODUCT_CHANGED_SINCE_DELETE_REQUEST",
          message:
            "This product changed after the deletion request was created. The old request was closed; submit a new request.",
        });
      }

      await connection.query(
        `UPDATE products
         SET is_active = FALSE
         WHERE id = ? AND branch_id = ? AND is_active = TRUE`,
        [product.id, request.branch_id]
      );

      await connection.query(
        `UPDATE audit_unlock_requests
         SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(),
             review_notes = ?, execution_status = 'executed', executed_at = NOW(),
             execution_result_json = ?, execution_error = NULL,
             execution_token_hash = NULL
         WHERE id = ?`,
        [
          reviewer.id,
          reviewNote,
          JSON.stringify({
            product_id: product.id,
            archived: true,
            approved_by_system_administrator: reviewer.id,
          }),
          request.id,
        ]
      );

      if (request.notification_id) {
        await connection.query(
          `UPDATE notifications
           SET status = 'resolved', resolved_at = NOW(), resolved_by = ?,
               resolution_note = 'Product deletion approved and product archived by original System Administrator.'
           WHERE id = ?`,
          [reviewer.id, request.notification_id]
        ).catch(() => {});
      }

      await writeAuditEvent({
        connection,
        userId: reviewer.id,
        branchId: request.branch_id,
        action: "DELETE_PRODUCT",
        details:
          `Soft-deleted product "${product.name}" with ID ${product.id} after approved request ` +
          `${request.request_code}; requested by user ${request.requested_by}.`,
        workspaceCode: "spare_parts",
        entityType: "product",
        entityId: String(product.id),
        actionType: "DELETE_PRODUCT",
        outcome: "success",
        severity: "critical",
        metadata: {
          request_id: request.id,
          request_code: request.request_code,
          requested_by: request.requested_by,
          approved_by: reviewer.id,
          product_snapshot: payload.product_snapshot,
        },
      });

      await auditApprovalEvent({
        req,
        connection,
        action: "APPROVE_PRODUCT_DELETE_REQUEST",
        request: { ...request, execution_status: "executed" },
        severity: "critical",
        userId: reviewer.id,
        details:
          `${request.request_code} approved and executed by original System Administrator ` +
          `${reviewer.username}; product ${product.name} archived.`,
      });

      await connection.commit();
      committed = true;

      await sendDeletionOutcomeAlert({
        product,
        branchId: request.branch_id,
        request,
        reviewer,
        outcome: "EXECUTED",
        note: `Qty before archive ${Number(product.quantity || 0)}. Full audit evidence preserved.`,
      });

      return res.json({
        status: "success",
        message:
          "Product deletion approved by the original System Administrator and the product was archived successfully.",
        request_id: request.id,
        request_code: request.request_code,
        product_id: product.id,
        archived: true,
      });
    } catch (error) {
      if (!committed) await connection.rollback().catch(() => {});
      return res.status(Number(error?.statusCode || 500)).json({
        status: "error",
        code: error?.code || "PRODUCT_DELETE_APPROVAL_FAILED",
        message: error?.message || "The product deletion request could not be approved safely.",
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/operational/:id/reject",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    const requestId = positiveInteger(req.params.id);
    if (!requestId) return next();

    const probe = await loadProductDeleteRequest(pool, requestId, false).catch(() => null);
    if (!probe) return next();

    const connection = await pool.getConnection();
    let committed = false;
    let request = null;
    let reviewer = null;
    let product = null;

    try {
      await ensureOperationalColumns(connection);
      await connection.beginTransaction();
      request = await loadProductDeleteRequest(connection, requestId, true);
      reviewer = await verifyOriginalSystemAdminPassword(
        connection,
        req,
        String(req.body?.password || "")
      );
      const reviewNote = cleanText(req.body?.review_note, 5000);

      if (!reviewNote) {
        const error = new Error("A rejection reason is required.");
        error.statusCode = 400;
        throw error;
      }
      if (!request || request.status !== "pending" || request.execution_status !== "pending") {
        const error = new Error("This product deletion request can no longer be rejected.");
        error.statusCode = 409;
        throw error;
      }

      product = await loadProduct(
        connection,
        positiveInteger(request.entity_id),
        positiveInteger(request.branch_id),
        false
      );

      await connection.query(
        `UPDATE audit_unlock_requests
         SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(),
             review_notes = ?, execution_status = 'rejected',
             execution_token_hash = NULL, execution_error = NULL
         WHERE id = ?`,
        [reviewer.id, reviewNote, request.id]
      );

      if (request.notification_id) {
        await connection.query(
          `UPDATE notifications
           SET status = 'resolved', resolved_at = NOW(), resolved_by = ?,
               resolution_note = ?
           WHERE id = ?`,
          [reviewer.id, `Rejected by original System Administrator: ${cleanText(reviewNote, 400)}`, request.notification_id]
        ).catch(() => {});
      }

      await auditApprovalEvent({
        req,
        connection,
        action: "REJECT_PRODUCT_DELETE_REQUEST",
        request: { ...request, execution_status: "rejected" },
        severity: "critical",
        userId: reviewer.id,
        details: `${request.request_code} rejected by original System Administrator ${reviewer.username}: ${cleanText(reviewNote, 500)}`,
      });

      await connection.commit();
      committed = true;

      await sendDeletionOutcomeAlert({
        product,
        branchId: request.branch_id,
        request,
        reviewer,
        outcome: "REJECTED",
        note: reviewNote,
      });

      return res.json({
        status: "success",
        message: "Product deletion request rejected. The product remains active.",
        request_id: request.id,
        request_code: request.request_code,
      });
    } catch (error) {
      if (!committed) await connection.rollback().catch(() => {});
      return res.status(Number(error?.statusCode || 500)).json({
        status: "error",
        code: error?.code || "PRODUCT_DELETE_REJECTION_FAILED",
        message: error?.message || "The product deletion request could not be rejected safely.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
