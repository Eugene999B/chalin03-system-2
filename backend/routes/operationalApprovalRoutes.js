const express = require("express");

const { pool } = require("../config/db");
const {
  actionRoute,
  claimOperationalRequest,
  cleanText,
  createOperationalRequest,
  finishOperationalExecution,
  getBranchId,
  getRole,
  getUserId,
  listOperationalRequests,
  listActiveReturnReservations,
  money,
  positiveInteger,
  rejectOperationalRequest,
} = require("../services/operationalApprovalService");

const { lockReturnUnitSelection } = require("../services/inventoryReturnTraceabilityService");

const router = express.Router();
const ALLOWED_PAYMENT_TYPES = new Set(["cash", "momo", "bank", "credit", "mixed"]);
const ALLOWED_REFUND_METHODS = new Set(["cash", "momo", "bank", "other"]);

function requireManagerOrAdmin(req, res, next) {
  if (["admin", "manager"].includes(getRole(req))) return next();
  return res.status(403).json({
    status: "error",
    message: "Only managers and administrators can submit protected approval requests.",
  });
}

function requireAdministrator(req, res, next) {
  if (getRole(req) === "admin") return next();
  return res.status(403).json({
    status: "error",
    message: "Only an administrator can approve or reject protected actions.",
  });
}

function sendError(res, error, fallback) {
  const statusCode = Number(error?.statusCode || 500);
  return res.status(statusCode).json({
    status: "error",
    code: error?.code || "OPERATIONAL_APPROVAL_ERROR",
    message: error?.message || fallback,
  });
}

function parseItems(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw Object.assign(new Error("At least one sale item is required."), {
      statusCode: 400,
    });
  }
  if (value.length > 200) {
    throw Object.assign(new Error("A sale correction cannot contain more than 200 items."), {
      statusCode: 400,
    });
  }

  const seen = new Set();
  return value.map((item, index) => {
    const productId = positiveInteger(item?.product_id);
    const quantity = positiveInteger(item?.quantity);
    const unitPrice =
      item?.unit_price === undefined || item?.unit_price === null || item?.unit_price === ""
        ? null
        : money(item.unit_price, -1);

    if (!productId) {
      throw Object.assign(new Error(`Item ${index + 1} has an invalid product.`), {
        statusCode: 400,
      });
    }
    if (!quantity) {
      throw Object.assign(new Error(`Item ${index + 1} has an invalid quantity.`), {
        statusCode: 400,
      });
    }
    if (unitPrice !== null && unitPrice < 0) {
      throw Object.assign(new Error(`Item ${index + 1} has an invalid unit price.`), {
        statusCode: 400,
      });
    }
    if (seen.has(productId)) {
      throw Object.assign(new Error("The same product cannot appear twice in one correction."), {
        statusCode: 400,
      });
    }
    seen.add(productId);

    return {
      product_id: productId,
      quantity,
      ...(unitPrice === null ? {} : { unit_price: unitPrice }),
    };
  });
}

function normalizeAllocations(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    cash: money(source.cash),
    momo: money(source.momo),
    bank: money(source.bank),
    other: money(source.other),
  };
}

async function findSale(connection, saleId, branchId, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT s.*, COALESCE(s.customer_name, c.name) AS effective_customer_name,
            COALESCE(s.customer_phone, c.phone) AS effective_customer_phone
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id AND c.branch_id = s.branch_id
     WHERE s.id = ? AND s.branch_id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [saleId, branchId]
  );
  return rows[0] || null;
}

function assertActiveSale(sale) {
  if (!sale) {
    throw Object.assign(new Error("Sale not found in the selected store."), {
      statusCode: 404,
    });
  }
  if (
    Number(sale.is_voided || 0) === 1 ||
    ["voided", "cancelled"].includes(String(sale.sale_status || "").toLowerCase())
  ) {
    throw Object.assign(new Error("A deleted or voided sale cannot be submitted for correction."), {
      statusCode: 409,
    });
  }
}

async function createReturnRefundRequest(req, res) {
  const connection = await pool.getConnection();
  try {
    const branchId = getBranchId(req);
    const saleId = positiveInteger(req.body?.sale_id);
    const productId = positiveInteger(req.body?.product_id);
    const quantity = positiveInteger(req.body?.quantity);
    const reason = cleanText(req.body?.reason, 500);
    const refundAmount = money(req.body?.refund_amount, -1);
    const refundMethod = cleanText(req.body?.refund_method, 30).toLowerCase();
    const refundReference = cleanText(req.body?.refund_reference, 180);
    const unitIds = Array.isArray(req.body?.unit_ids) ? req.body.unit_ids : [];

    if (!branchId || !saleId || !productId || !quantity || !reason) {
      return res.status(400).json({
        status: "error",
        message: "Sale, product, quantity and return reason are required.",
      });
    }
    if (refundAmount <= 0 || !ALLOWED_REFUND_METHODS.has(refundMethod)) {
      return res.status(400).json({
        status: "error",
        message: "A positive refund amount and exact refund channel are required.",
      });
    }
    if (["momo", "bank", "other"].includes(refundMethod) && !refundReference) {
      return res.status(400).json({
        status: "error",
        message: "Enter the transaction or reference number for this refund.",
      });
    }

    await connection.beginTransaction();
    const sale = await findSale(connection, saleId, branchId, { forUpdate: true });
    assertActiveSale(sale);

    const [itemRows] = await connection.query(
      `SELECT si.product_id, si.product_name,
              SUM(si.quantity) AS quantity_sold,
              MAX(si.unit_price) AS unit_price,
              MAX(p.inventory_tracking_mode) AS inventory_tracking_mode,
              MAX(p.inventory_traceability_state) AS inventory_traceability_state,
              MAX(p.inventory_product_code) AS inventory_product_code,
              COALESCE((
                SELECT SUM(r.quantity)
                FROM returns r
                WHERE r.branch_id = ? AND r.sale_id = ? AND r.product_id = ?
              ), 0) AS quantity_returned
       FROM sale_items si
       INNER JOIN products p ON p.id = si.product_id AND p.branch_id = ?
       WHERE si.sale_id = ? AND si.product_id = ?
       GROUP BY si.product_id, si.product_name
       LIMIT 1
       FOR UPDATE`,
      [branchId, saleId, productId, branchId, saleId, productId]
    );
    const item = itemRows[0];
    if (!item) {
      throw Object.assign(new Error("The selected product was not part of this sale."), {
        statusCode: 404,
      });
    }

    const remaining = Number(item.quantity_sold || 0) - Number(item.quantity_returned || 0);

    const activeReservations = await listActiveReturnReservations(connection, {
      branchId,
      saleId,
      forUpdate: true,
    });
    const activeForProduct = activeReservations.filter(
      (reservation) => Number(reservation.product_id) === Number(productId)
    );
    if (activeForProduct.length > 0) {
      const codes = activeForProduct.map((reservation) => reservation.request_code).join(", ");
      const error = new Error(
        `This item already has an active refund request (${codes}). Approve/retry it or reject it before creating another return request.`
      );
      error.statusCode = 409;
      error.code = "ACTIVE_RETURN_REQUEST_EXISTS";
      throw error;
    }

    if (quantity > remaining) {
      throw Object.assign(
        new Error(`Only ${remaining} unit(s) remain available for return.`),
        { statusCode: 409 }
      );
    }

    const returnTraceabilitySelection = await lockReturnUnitSelection(connection, {
      branchId,
      saleId,
      product: {
        id: productId,
        name: item.product_name,
        inventory_tracking_mode: item.inventory_tracking_mode || "quantity",
        inventory_traceability_state: item.inventory_traceability_state || "off",
      },
      quantity,
      unitCodes: unitIds,
    });

    const maximumRefund = Number(item.unit_price || 0) * quantity;
    if (refundAmount - maximumRefund > 0.009) {
      throw Object.assign(
        new Error(`Refund cannot exceed GHS ${maximumRefund.toFixed(2)} for this quantity.`),
        { statusCode: 400 }
      );
    }

    const [priorRefundRows] = await connection.query(
      `SELECT COALESCE(SUM(refund_amount), 0) AS refunded_total
       FROM returns
       WHERE branch_id = ? AND sale_id = ? AND return_type = 'refund'`,
      [branchId, saleId]
    );
    const collectedAvailable = Math.max(
      0,
      money(sale.amount_paid) - money(priorRefundRows[0]?.refunded_total)
    );
    if (refundAmount - collectedAvailable > 0.009) {
      const error = new Error(
        `Only GHS ${collectedAvailable.toFixed(2)} of collected customer money remains available to refund on this sale.`
      );
      error.statusCode = 409;
      error.code = "REFUND_EXCEEDS_COLLECTED_MONEY";
      throw error;
    }

    const payload = {
      sale_id: saleId,
      product_id: productId,
      quantity,
      reason,
      return_type: "refund",
      refund_amount: refundAmount,
      refund_method: refundMethod,
      refund_reference: refundReference,
      unit_ids: returnTraceabilitySelection.unit_codes,
    };

    const detail = [
      `Receipt ${sale.receipt_number}`,
      `${item.product_name}: ${quantity} unit(s)`,
      `Refund GHS ${refundAmount.toFixed(2)} by ${refundMethod.toUpperCase()}`,
      refundReference ? `Reference ${refundReference}` : "",
      returnTraceabilitySelection.unit_codes.length
        ? `Physical IDs ${returnTraceabilitySelection.unit_codes.join(", ")}`
        : "",
      `Requested by ${req.user?.full_name || req.user?.username || `user ${getUserId(req)}`}`,
      `Reason: ${reason}`,
      "No stock or money record changes until an administrator approves.",
    ]
      .filter(Boolean)
      .join(" | ");

    const created = await createOperationalRequest({
      req,
      connection,
      branchId,
      approvalKind: "return_refund",
      entityType: "sale",
      entityId: saleId,
      requestArea: "return",
      periodLabel: `Refund approval — ${sale.receipt_number}`,
      requestedAction: `Refund GHS ${refundAmount.toFixed(2)} for ${item.product_name}`,
      reason: detail,
      amount: refundAmount,
      payload,
      notificationMessage: `${req.user?.full_name || req.user?.username || "A manager"} requested a GHS ${refundAmount.toFixed(2)} refund for receipt ${sale.receipt_number}. Open the Approval Centre to review it.`,
    });

    await connection.commit();
    return res.status(created.duplicate ? 200 : 201).json({
      status: "success",
      pending_approval: true,
      duplicate: created.duplicate,
      message: created.duplicate
        ? "This refund request is already waiting for administrator approval."
        : "Refund request sent to all authorized administrators. No stock or refund record has changed yet.",
      request: {
        id: created.request.id,
        request_code: created.request.request_code,
        execution_status: "pending",
      },
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return sendError(res, error, "Failed to send the refund approval request.");
  } finally {
    connection.release();
  }
}

async function createSaleVoidRequest(req, res) {
  const connection = await pool.getConnection();
  try {
    const branchId = getBranchId(req);
    const saleId = positiveInteger(req.params.saleId);
    const reason = cleanText(req.body?.reason, 1000);
    if (!branchId || !saleId || !reason) {
      return res.status(400).json({
        status: "error",
        message: "Select a sale and provide the exact reason for voiding it.",
      });
    }

    await connection.beginTransaction();
    const sale = await findSale(connection, saleId, branchId, { forUpdate: true });
    assertActiveSale(sale);

    const [returnRows] = await connection.query(
      `SELECT COUNT(*) AS total FROM returns WHERE sale_id = ? AND branch_id = ?`,
      [saleId, branchId]
    );
    if (Number(returnRows[0]?.total || 0) > 0) {
      throw Object.assign(
        new Error("This sale already has return records and cannot be voided through the approval workflow."),
        { statusCode: 409 }
      );
    }

    const payload = { reason };
    const detail = [
      `Receipt ${sale.receipt_number}`,
      `Customer ${sale.effective_customer_name || "Walk-in"}`,
      `Sale total GHS ${Number(sale.total || 0).toFixed(2)}`,
      `Requested by ${req.user?.full_name || req.user?.username || `user ${getUserId(req)}`}`,
      `Reason: ${reason}`,
      "Approval will restore sold stock and close linked debt while preserving the original record.",
    ].join(" | ");

    const created = await createOperationalRequest({
      req,
      connection,
      branchId,
      approvalKind: "sale_void",
      entityType: "sale",
      entityId: saleId,
      requestArea: "sale",
      periodLabel: `Sale void approval — ${sale.receipt_number}`,
      requestedAction: `Void completed sale ${sale.receipt_number}`,
      reason: detail,
      amount: Number(sale.total || 0),
      payload,
      notificationMessage: `${req.user?.full_name || req.user?.username || "A manager"} requested that completed sale ${sale.receipt_number} (GHS ${Number(sale.total || 0).toFixed(2)}) be voided.`,
    });

    await connection.commit();
    return res.status(created.duplicate ? 200 : 201).json({
      status: "success",
      pending_approval: true,
      duplicate: created.duplicate,
      message: created.duplicate
        ? "This sale-void request is already waiting for administrator approval."
        : "Sale-void request sent to all authorized administrators. The sale remains unchanged until approval.",
      request: {
        id: created.request.id,
        request_code: created.request.request_code,
      },
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return sendError(res, error, "Failed to send the sale-void request.");
  } finally {
    connection.release();
  }
}

async function createSaleEditRequest(req, res) {
  const connection = await pool.getConnection();
  try {
    const branchId = getBranchId(req);
    const saleId = positiveInteger(req.params.saleId);
    const editReason = cleanText(req.body?.edit_reason, 1000);
    const paymentType = cleanText(req.body?.payment_type, 30).toLowerCase();
    const items = parseItems(req.body?.items);

    if (!branchId || !saleId || !editReason) {
      return res.status(400).json({
        status: "error",
        message: "Select a sale and enter the exact correction reason.",
      });
    }
    if (!ALLOWED_PAYMENT_TYPES.has(paymentType)) {
      return res.status(400).json({
        status: "error",
        message: "Payment type must be cash, momo, bank, credit or mixed.",
      });
    }

    await connection.beginTransaction();
    const sale = await findSale(connection, saleId, branchId, { forUpdate: true });
    assertActiveSale(sale);

    const productIds = items.map((item) => item.product_id);
    const placeholders = productIds.map(() => "?").join(", ");
    const [products] = await connection.query(
      `SELECT id, name, selling_price, quantity, is_active
       FROM products
       WHERE branch_id = ? AND id IN (${placeholders})
       FOR UPDATE`,
      [branchId, ...productIds]
    );
    const productMap = new Map(products.map((product) => [Number(product.id), product]));
    if (productMap.size !== productIds.length) {
      throw Object.assign(new Error("One or more selected products do not exist in this store."), {
        statusCode: 400,
      });
    }

    const normalizedItems = items.map((item) => {
      const product = productMap.get(item.product_id);
      return {
        product_id: item.product_id,
        quantity: item.quantity,
        ...(item.unit_price === undefined
          ? {}
          : { unit_price: item.unit_price }),
        preview_name: product.name,
        preview_price:
          item.unit_price === undefined
            ? Number(product.selling_price || 0)
            : item.unit_price,
      };
    });

    const discountAmount = money(req.body?.discount_amount);
    const amountTendered = money(
      req.body?.amount_tendered ?? req.body?.amount_paid ?? 0
    );
    const amountPaid = money(
      req.body?.amount_paid ?? req.body?.amount_tendered ?? 0
    );
    const paymentAllocations = normalizeAllocations(req.body?.payment_allocations);

    const payload = {
      customer_name: cleanText(req.body?.customer_name, 150),
      customer_phone: cleanText(req.body?.customer_phone, 30),
      customer_location: cleanText(req.body?.customer_location, 180),
      payment_type: paymentType,
      amount_tendered: amountTendered,
      amount_paid: amountPaid,
      discount_amount: discountAmount,
      payment_allocations: paymentAllocations,
      edit_reason: editReason,
      items: normalizedItems.map(({ preview_name, preview_price, ...item }) => item),
    };

    const previewSubtotal = normalizedItems.reduce(
      (sum, item) => sum + item.preview_price * item.quantity,
      0
    );
    const previewTotal = Math.max(previewSubtotal - discountAmount, 0);
    const itemSummary = normalizedItems
      .map((item) => `${item.preview_name} x${item.quantity} @ GHS ${item.preview_price.toFixed(2)}`)
      .join("; ");

    const detail = [
      `Receipt ${sale.receipt_number}`,
      `Current total GHS ${Number(sale.total || 0).toFixed(2)}`,
      `Proposed item value about GHS ${previewTotal.toFixed(2)}`,
      `Payment ${String(sale.payment_type || "-").toUpperCase()} → ${paymentType.toUpperCase()}`,
      `Customer ${sale.effective_customer_name || "Walk-in"} → ${payload.customer_name || "Walk-in"}`,
      `Items: ${itemSummary}`,
      `Requested by ${req.user?.full_name || req.user?.username || `user ${getUserId(req)}`}`,
      `Reason: ${editReason}`,
      "The original sale remains unchanged until an administrator approves.",
    ].join(" | ");

    const created = await createOperationalRequest({
      req,
      connection,
      branchId,
      approvalKind: "sale_edit",
      entityType: "sale",
      entityId: saleId,
      requestArea: "sale",
      periodLabel: `Sale edit approval — ${sale.receipt_number}`,
      requestedAction: `Edit completed sale ${sale.receipt_number}`,
      reason: detail,
      amount: previewTotal,
      payload,
      notificationMessage: `${req.user?.full_name || req.user?.username || "A manager"} requested changes to completed sale ${sale.receipt_number}. Review the before/after details in the Approval Centre.`,
    });

    await connection.commit();
    return res.status(created.duplicate ? 200 : 201).json({
      status: "success",
      pending_approval: true,
      duplicate: created.duplicate,
      message: created.duplicate
        ? "This sale-edit request is already waiting for administrator approval."
        : "Sale-edit request sent to all authorized administrators. The original sale remains unchanged until approval.",
      request: {
        id: created.request.id,
        request_code: created.request.request_code,
      },
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return sendError(res, error, "Failed to send the sale-edit request.");
  } finally {
    connection.release();
  }
}

async function executeApprovedRequest(req, res) {
  const requestId = positiveInteger(req.params.id);
  const password = String(req.body?.password || "");
  const reviewNote = cleanText(req.body?.review_note, 5000) ||
    "Approved after reviewing the protected request details.";

  if (!requestId || !password) {
    return res.status(400).json({
      status: "error",
      message: "Administrator password is required to approve this request.",
    });
  }

  let claimed;
  try {
    claimed = await claimOperationalRequest({
      req,
      requestId,
      password,
      reviewNote,
    });
  } catch (error) {
    return sendError(res, error, "The request could not be approved.");
  }

  const route = actionRoute(claimed.request);
  if (!route) {
    await finishOperationalExecution({
      requestId,
      success: false,
      errorMessage: "No protected action route exists for this approval type.",
    }).catch(() => {});
    return res.status(409).json({
      status: "error",
      message: "This approval type cannot be executed by the current system version.",
    });
  }

  const port = Number(process.env.PORT || 5000);
  const url = `http://127.0.0.1:${port}${route.path}`;
  const headers = {
    "content-type": "application/json",
    "x-chalin-approval-request-id": String(requestId),
    "x-chalin-approval-execution": claimed.executionToken,
  };
  const authorization = req.get("authorization");
  const cookie = req.get("cookie");
  if (authorization) headers.authorization = authorization;
  if (cookie) headers.cookie = cookie;

  try {
    const internalResponse = await fetch(url, {
      method: route.method,
      headers,
      body: JSON.stringify({
        ...(claimed.request.approval_payload || {}),
        __approval_admin_username: claimed.reviewer.username,
        __approval_admin_password: password,
      }),
      signal: AbortSignal.timeout(90000),
    });

    const responseText = await internalResponse.text();
    let responseBody;
    try {
      responseBody = responseText ? JSON.parse(responseText) : {};
    } catch {
      responseBody = { message: responseText || "Protected action returned no details." };
    }

    if (!internalResponse.ok) {
      const executionError =
        responseBody?.message ||
        `Protected action failed with HTTP ${internalResponse.status}.`;
      await finishOperationalExecution({
        requestId,
        success: false,
        errorMessage: executionError,
      });
      return res.status(409).json({
        status: "error",
        code: "APPROVED_ACTION_FAILED",
        message: `Approval was recorded, but the action could not be executed: ${executionError}`,
        request_id: requestId,
        action_response: responseBody,
      });
    }

    await finishOperationalExecution({
      requestId,
      success: true,
      result: responseBody,
    });

    return res.json({
      status: "success",
      message: "Request approved and the protected action was executed successfully.",
      request_id: requestId,
      action_result: responseBody,
    });
  } catch (error) {
    const finalized = await finishOperationalExecution({
      requestId,
      success: false,
      errorMessage: error.message,
    }).catch(() => null);

    if (finalized?.execution_status === "executed") {
      return res.json({
        status: "success",
        message: "The approved return was committed successfully. The internal response was interrupted after the business transaction completed.",
        request_id: requestId,
      });
    }

    return res.status(500).json({
      status: "error",
      code: "APPROVED_ACTION_EXECUTION_ERROR",
      message: `The approval was recorded, but protected execution failed: ${error.message}`,
      request_id: requestId,
    });
  }
}

router.get(
  "/operational",
  requireManagerOrAdmin,
  async (req, res) => {
    try {
      const requests = await listOperationalRequests(req, {
        status: cleanText(req.query.status, 30).toLowerCase(),
        search: cleanText(req.query.search, 200),
      });
      const summary = requests.reduce(
        (result, request) => {
          result.total += 1;
          const key = request.execution_status || "unknown";
          result[key] = (result[key] || 0) + 1;
          return result;
        },
        { total: 0, pending: 0, executing: 0, executed: 0, failed: 0, rejected: 0 }
      );
      return res.json({
        status: "success",
        count: requests.length,
        summary,
        requests,
      });
    } catch (error) {
      return sendError(res, error, "Failed to load operational approval requests.");
    }
  }
);

router.post(
  "/operational/return-refund",
  requireManagerOrAdmin,
  createReturnRefundRequest
);
router.post(
  "/operational/sale-edit/:saleId",
  requireManagerOrAdmin,
  createSaleEditRequest
);
router.post(
  "/operational/sale-void/:saleId",
  requireManagerOrAdmin,
  createSaleVoidRequest
);
router.post(
  "/operational/:id/approve",
  requireAdministrator,
  executeApprovedRequest
);
router.post(
  "/operational/:id/reject",
  requireAdministrator,
  async (req, res) => {
    const requestId = positiveInteger(req.params.id);
    const password = String(req.body?.password || "");
    const reviewNote = cleanText(req.body?.review_note, 5000);
    if (!requestId || !password || !reviewNote) {
      return res.status(400).json({
        status: "error",
        message: "Administrator password and rejection reason are required.",
      });
    }

    try {
      await rejectOperationalRequest({
        req,
        requestId,
        password,
        reviewNote,
      });
      return res.json({
        status: "success",
        message: "Protected request rejected. No business record was changed.",
      });
    } catch (error) {
      return sendError(res, error, "The request could not be rejected.");
    }
  }
);

// The legacy Audit Unlock screen sends reviews here. Operational requests are
// intentionally reviewed through the floating Approval Centre, where the admin
// confirms their own password on their own device before execution.
router.patch("/:id/review", async (req, res, next) => {
  const requestId = positiveInteger(req.params.id);
  if (!requestId) return next();

  try {
    const [rows] = await pool.query(
      `SELECT approval_kind
       FROM audit_unlock_requests
       WHERE id = ?
       LIMIT 1`,
      [requestId]
    );
    if (!rows[0]?.approval_kind) return next();

    return res.status(409).json({
      status: "error",
      code: "USE_OPERATIONAL_APPROVAL_CENTRE",
      message:
        "This is an operational financial request. Open the gold Approval Centre button and approve it with your own administrator password.",
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
