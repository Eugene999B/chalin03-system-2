const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  cleanText,
  createOperationalRequest,
  getBranchId,
  getUserId,
  positiveInteger,
} = require("../services/operationalApprovalService");
const {
  buildOwnerAlertContext,
  formatMoney,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");

const router = express.Router();

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

async function sendDeletionRequestAlert({ product, req, branchId, requestCode, reason }) {
  try {
    const { businessName, branch } = await buildOwnerAlertContext(branchId);
    const requester = req.user?.full_name || req.user?.username || `User ${getUserId(req)}`;
    const role = String(req.user?.role || "staff").toUpperCase();
    const message =
      `${businessName}: CRITICAL PRODUCT DELETION REQUEST. ${product.name} ` +
      `(barcode ${product.barcode || "-"}, qty ${Number(product.quantity || 0)}, ` +
      `selling GHS ${formatMoney(product.selling_price)}) at ${branch.name} (${branch.code}). ` +
      `Requested by ${requester} [${role}] on ${formatSecurityDateTime()}. ` +
      `Ref ${requestCode}. Reason: ${cleanText(reason, 140)}. ` +
      `NO PRODUCT REMOVED - System Administrator approval required.`;

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

router.post(
  "/operational/product-delete/:productId",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();
    let committed = false;

    try {
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

      const [productRows] = await connection.query(
        `SELECT id, branch_id, name, size, category, barcode, quantity,
                cost_price, selling_price, is_active, updated_at
         FROM products
         WHERE id = ? AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [productId, branchId]
      );

      const product = productRows[0];
      if (!product || Number(product.is_active || 0) !== 1) {
        return res.status(404).json({
          status: "error",
          message: "Active product not found in the selected store.",
        });
      }

      const [pendingRows] = await connection.query(
        `SELECT id, requested_action
         FROM audit_unlock_requests
         WHERE branch_id = ?
           AND approval_kind = 'product_delete'
           AND entity_type = 'product'
           AND entity_id = ?
           AND status IN ('pending', 'approved')
           AND execution_status IN ('pending', 'executing', 'failed')
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [branchId, productId]
      );

      if (pendingRows.length > 0) {
        const codeMatch = /^\[([^\]]+)\]/.exec(String(pendingRows[0].requested_action || ""));
        const requestCode = codeMatch?.[1] || `APR-${pendingRows[0].id}`;
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          code: "PRODUCT_DELETE_REQUEST_ALREADY_PENDING",
          message: `A deletion request for this product is already active (${requestCode}). Review or reject that request first.`,
          request_code: requestCode,
        });
      }

      const snapshot = productSnapshot(product);
      const detail = [
        `Product: ${product.name}`,
        `Barcode: ${product.barcode || "-"}`,
        `Quantity: ${Number(product.quantity || 0)}`,
        `Cost: GHS ${formatMoney(product.cost_price)}`,
        `Selling: GHS ${formatMoney(product.selling_price)}`,
        `Requested by: ${req.user?.full_name || req.user?.username || `user ${getUserId(req)}`}`,
        `Role: ${String(req.user?.role || "-")}`,
        `Reason: ${reason}`,
        "The product remains active until the original System Administrator approves and executes this request.",
      ].join(" | ");

      const created = await createOperationalRequest({
        req,
        connection,
        branchId,
        approvalKind: "product_delete",
        entityType: "product",
        entityId: productId,
        requestArea: "product",
        periodLabel: `Product deletion approval — ${product.name}`,
        requestedAction: `Archive product ${product.name} (ID ${productId})`,
        reason: detail,
        amount: Number(product.selling_price || 0) * Number(product.quantity || 0),
        payload: {
          reason,
          product_snapshot: snapshot,
        },
        expiryHours: 24,
        notificationMessage:
          `${req.user?.full_name || req.user?.username || "A manager"} requested deletion of ` +
          `${product.name}. Only the original System Administrator can approve and execute this action.`,
      });

      await connection.commit();
      committed = true;

      await sendDeletionRequestAlert({
        product,
        req,
        branchId,
        requestCode: created.request.request_code,
        reason,
      });

      return res.status(created.duplicate ? 200 : 201).json({
        status: "success",
        pending_approval: true,
        duplicate: created.duplicate,
        message: created.duplicate
          ? "This product deletion request is already awaiting System Administrator approval."
          : "Deletion request sent to the System Administrator. The product has NOT been removed.",
        request: {
          id: created.request.id,
          request_code: created.request.request_code,
          execution_status: "pending",
          expires_in_hours: 24,
        },
      });
    } catch (error) {
      if (!committed) {
        await connection.rollback().catch(() => {});
      }
      console.error("Product deletion approval request error:", error);
      return res.status(Number(error?.statusCode || 500)).json({
        status: "error",
        code: error?.code || "PRODUCT_DELETE_REQUEST_FAILED",
        message: error?.message || "Failed to submit the product deletion request.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
