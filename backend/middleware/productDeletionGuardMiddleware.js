const { pool } = require("../config/db");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");
const {
  isOriginalSystemAdministrator,
} = require("../security/systemAdminIdentity");

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function branchIdFromRequest(req) {
  return positiveInteger(
    req.user?.branch_id || req.user?.default_branch_id || req.user?.selected_branch?.id
  );
}

function productIdFromRequest(req) {
  const match = /^\/(\d+)\/?$/.exec(String(req.path || ""));
  return match ? positiveInteger(match[1]) : null;
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function currentSnapshot(product) {
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
  return keys.every((key) => String(expected?.[key] ?? "") === String(actual?.[key] ?? ""));
}

async function loadProduct(productId, branchId) {
  const [rows] = await pool.query(
    `SELECT id, branch_id, name, size, category, barcode, quantity,
            cost_price, selling_price, is_active, updated_at
     FROM products
     WHERE id = ? AND branch_id = ?
     LIMIT 1`,
    [productId, branchId]
  );
  return rows[0] || null;
}

async function loadUser(userId) {
  const [rows] = await pool.query(
    `SELECT id, full_name, username, role, is_active,
            default_branch_id, can_access_all_branches
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function auditAttempt({ req, product, branchId, action, outcome, details }) {
  try {
    await writeAuditEvent({
      req,
      branchId,
      userId: req.user?.id || req.user?.user_id || null,
      action,
      details,
      workspaceCode: "spare_parts",
      entityType: "product",
      entityId: product?.id || null,
      actionType: action,
      outcome,
      severity: "critical",
      metadata: {
        product_name: product?.name || null,
        barcode: product?.barcode || null,
        quantity: product ? Number(product.quantity || 0) : null,
        role: req.user?.role || null,
        approval_request_id: req.approvalExecution?.request_id || null,
        approval_request_code: req.approvalExecution?.request_code || null,
      },
    });
  } catch (error) {
    console.warn("Product deletion security audit skipped:", error.message);
  }
}

async function alertOwner({ req, product, branchId, eventLabel, extra = "" }) {
  try {
    const { businessName, branch } = await buildOwnerAlertContext(branchId);
    const actor = req.user?.full_name || req.user?.username || `User ${req.user?.id || "unknown"}`;
    const message =
      `${businessName}: CRITICAL PRODUCT DELETE ${eventLabel}. ` +
      `${product?.name || "Unknown product"} (ID ${product?.id || "-"}, barcode ${product?.barcode || "-"}, ` +
      `qty ${Number(product?.quantity || 0)}) at ${branch.name} (${branch.code}). ` +
      `Actor ${actor} [${String(req.user?.role || "unknown").toUpperCase()}] on ${formatSecurityDateTime()}. ` +
      `${extra}`;

    await sendOwnerSmsAlert({
      branchId,
      message,
      smsType: "security_alert",
      sentBy: req.user?.id || req.user?.user_id || null,
      sourceReference: req.approvalExecution?.request_code || null,
    });
  } catch (error) {
    console.warn("Product deletion security SMS skipped:", error.message);
  }
}

async function productDeletionGuardMiddleware(req, res, next) {
  if (req.method.toUpperCase() !== "DELETE") return next();

  const productId = productIdFromRequest(req);
  if (!productId) return next();

  const branchId = branchIdFromRequest(req);
  if (!branchId) {
    return res.status(400).json({
      status: "error",
      code: "PRODUCT_DELETE_BRANCH_REQUIRED",
      message: "Select a store before attempting a protected product deletion.",
    });
  }

  try {
    const product = await loadProduct(productId, branchId);

    if (req.approvalExecution?.approval_kind === "product_delete") {
      const reviewer = await loadUser(req.approvalExecution.approved_by);
      if (!reviewer || Number(reviewer.is_active || 0) !== 1 || !isOriginalSystemAdministrator(reviewer)) {
        await auditAttempt({
          req,
          product,
          branchId,
          action: "BLOCK_PRODUCT_DELETE_INVALID_APPROVER",
          outcome: "blocked",
          details: `Blocked approved product deletion because reviewer ${req.approvalExecution.approved_by || "unknown"} is not the original System Administrator.`,
        });
        return res.status(403).json({
          status: "error",
          code: "PRODUCT_DELETE_SYSTEM_ADMIN_REQUIRED",
          message: "Only the original System Administrator can execute an approved product deletion.",
        });
      }

      if (!product || Number(product.is_active || 0) !== 1) {
        return res.status(404).json({
          status: "error",
          message: "The approved product is no longer active in this store.",
        });
      }

      const expectedSnapshot = req.body?.product_snapshot || {};
      const actualSnapshot = currentSnapshot(product);
      if (!sameSnapshot(expectedSnapshot, actualSnapshot)) {
        await auditAttempt({
          req,
          product,
          branchId,
          action: "BLOCK_PRODUCT_DELETE_CHANGED_SINCE_REQUEST",
          outcome: "blocked",
          details: `Blocked ${req.approvalExecution.request_code || "product deletion"} because the product changed after the request was submitted.`,
        });
        await alertOwner({
          req,
          product,
          branchId,
          eventLabel: "BLOCKED - PRODUCT CHANGED",
          extra: `Request ${req.approvalExecution.request_code || "-"} must be submitted again.`,
        });
        return res.status(409).json({
          status: "error",
          code: "PRODUCT_CHANGED_SINCE_DELETE_REQUEST",
          message:
            "This product changed after the deletion request was created. The old approval cannot be used; submit a new deletion request.",
        });
      }

      req.user = {
        ...req.user,
        ...reviewer,
        id: reviewer.id,
        user_id: reviewer.id,
        role: reviewer.role,
        branch_id: branchId,
        default_branch_id: branchId,
      };

      await auditAttempt({
        req,
        product,
        branchId,
        action: "EXECUTE_APPROVED_PRODUCT_DELETE",
        outcome: "authorized",
        details: `${req.approvalExecution.request_code || "Approved request"} authorized by the original System Administrator for product ${product.name}.`,
      });
      return next();
    }

    if (isOriginalSystemAdministrator(req.user)) {
      await auditAttempt({
        req,
        product,
        branchId,
        action: "SYSTEM_ADMIN_PRODUCT_DELETE_ATTEMPT",
        outcome: "authorized",
        details: `Original System Administrator initiated direct protected deletion of product ${product?.name || productId}.`,
      });
      await alertOwner({
        req,
        product,
        branchId,
        eventLabel: "INITIATED BY SYSTEM ADMINISTRATOR",
        extra: "Deletion has entered the protected execution path; a completion alert will follow.",
      });
      return next();
    }

    await auditAttempt({
      req,
      product,
      branchId,
      action: "BLOCK_UNAPPROVED_PRODUCT_DELETE_ATTEMPT",
      outcome: "blocked",
      details: `Blocked direct product deletion attempt by ${req.user?.username || req.user?.id || "unknown user"}. System Administrator approval is required.`,
    });
    await alertOwner({
      req,
      product,
      branchId,
      eventLabel: "BLOCKED UNAPPROVED ATTEMPT",
      extra: "No product was removed. The user must submit a deletion request for System Administrator approval.",
    });

    return res.status(403).json({
      status: "error",
      code: "PRODUCT_DELETE_REQUIRES_SYSTEM_ADMIN_APPROVAL",
      message:
        "You cannot delete this product directly. Submit a deletion request for the original System Administrator to approve.",
    });
  } catch (error) {
    console.error("Product deletion guard error:", error);
    return res.status(500).json({
      status: "error",
      code: "PRODUCT_DELETE_SECURITY_CHECK_FAILED",
      message: "The protected product deletion security check could not be completed safely.",
    });
  }
}

module.exports = { productDeletionGuardMiddleware };
