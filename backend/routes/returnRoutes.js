const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { markClosingStale } = require("../services/dailyClosingSecurityService");
const { listActiveReturnReservations } = require("../services/operationalApprovalService");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const { validateReturnCreateRequest } = require("../validation/financialRequestValidators");
const {
  lockReturnUnitSelection,
  markReturnUnitsQuarantined,
} = require("../services/inventoryReturnTraceabilityService");

const router = express.Router();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}


async function verifyIndependentReturnApprover(
  connection,
  { currentUserId, branchId, approverUsername, approverPassword }
) {
  const username = cleanText(approverUsername);
  const password = String(approverPassword || "");

  if (!username || !password) {
    return { error: "Independent manager username and password are required for a financial refund." };
  }

  const [rows] = await connection.query(
    `SELECT id, full_name, username, role, password_hash, is_active,
            default_branch_id, can_access_all_branches
     FROM users
     WHERE username = ?
     LIMIT 1
     FOR UPDATE`,
    [username]
  );
  const approver = rows[0];

  if (!approver || Number(approver.is_active) !== 1) {
    return { error: "Independent refund approver was not found or is inactive." };
  }
  const approverRole = String(approver.role || "").toLowerCase();
  if (!["admin", "manager"].includes(approverRole)) {
    return { error: "Refund approver must be an active administrator or manager." };
  }

  const samePerson = Number(approver.id) === Number(currentUserId);
  if (samePerson && approverRole !== "admin") {
    return {
      error: "Only a System Administrator can approve their own financial refund.",
    };
  }

  if (
    !Number(approver.can_access_all_branches || 0) &&
    Number(approver.default_branch_id || 0) !== Number(branchId)
  ) {
    const [accessRows] = await connection.query(
      `SELECT 1
       FROM user_branch_access
       WHERE user_id = ? AND branch_id = ? AND can_access = 1
       LIMIT 1`,
      [approver.id, branchId]
    );
    if (accessRows.length === 0) {
      return { error: "Refund approver is not authorized for the selected store." };
    }
  }

  const passwordMatches = await bcrypt.compare(password, approver.password_hash);
  if (!passwordMatches) {
    return { error: "Independent refund approver password is incorrect." };
  }

  return { approver };
}

async function logActivity(userId, branchId, action, details) {
  await writeAuditEvent({
    branchId: branchId || null,
    userId: userId || null,
    action,
    details,
    workspaceCode: "spare_parts",
    entityType: "return",
    actionType: action,
    outcome: "success",
    severity: "notice",
  });
}

// GET /api/returns/sales
router.get(
  "/sales",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const search = cleanText(req.query.search);

      const params = [branchId];
      let whereClause = `
        WHERE s.branch_id = ?
        AND s.sale_status = 'completed'
        AND COALESCE(s.is_voided, 0) = 0
      `;

      if (search) {
        whereClause += ` AND (
          s.receipt_number LIKE ?
          OR s.customer_name LIKE ?
          OR s.customer_phone LIKE ?
          OR c.name LIKE ?
          OR c.phone LIKE ?
        )`;

        const searchValue = `%${search}%`;
        params.push(
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue
        );
      }

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.branch_id,
          s.receipt_number,
          s.total,
          s.payment_type,
          s.amount_paid,
          s.balance,
          s.created_at,
          COALESCE(s.customer_name, c.name) AS customer_name,
          COALESCE(s.customer_phone, c.phone) AS customer_phone
         FROM sales s
         LEFT JOIN customers c
          ON s.customer_id = c.id
          AND c.branch_id = s.branch_id
         ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT 50`,
        params
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        count: sales.length,
        sales,
      });
    } catch (error) {
      console.error("Search sales for returns error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while searching sales.",
      });
    }
  }
);

// GET /api/returns/sales/:saleId/items
router.get(
  "/sales/:saleId/items",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const { saleId } = req.params;

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.branch_id,
          s.receipt_number,
          s.total,
          s.payment_type,
          s.created_at,
          COALESCE(s.customer_name, c.name) AS customer_name,
          COALESCE(s.customer_phone, c.phone) AS customer_phone
         FROM sales s
         LEFT JOIN customers c
          ON s.customer_id = c.id
          AND c.branch_id = s.branch_id
         WHERE s.id = ?
         AND s.branch_id = ?
         LIMIT 1`,
        [saleId, branchId]
      );

      if (sales.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Sale not found in the selected store.",
        });
      }

      const [items] = await pool.query(
        `SELECT
          si.product_id,
          si.product_name,
          SUM(si.quantity) AS quantity_sold,
          MAX(si.unit_price) AS unit_price,
          SUM(si.line_total) AS line_total,
          MAX(p.inventory_tracking_mode) AS inventory_tracking_mode,
          MAX(p.inventory_traceability_state) AS inventory_traceability_state,
          MAX(p.inventory_product_code) AS inventory_product_code,
          COALESCE((
            SELECT SUM(r.quantity)
            FROM returns r
            WHERE r.branch_id = ?
            AND r.sale_id = si.sale_id
            AND r.product_id = si.product_id
          ), 0) AS returned_quantity
         FROM sale_items si
         INNER JOIN sales s ON si.sale_id = s.id
         INNER JOIN products p ON p.id = si.product_id AND p.branch_id = s.branch_id
         WHERE si.sale_id = ?
         AND s.branch_id = ?
         GROUP BY si.sale_id, si.product_id, si.product_name
         ORDER BY si.product_name ASC`,
        [branchId, saleId, branchId]
      );

      const activeReservations = await listActiveReturnReservations(pool, {
        branchId,
        saleId: Number(saleId),
      });
      const reservationsByProduct = new Map();
      for (const reservation of activeReservations) {
        const key = Number(reservation.product_id);
        const current = reservationsByProduct.get(key) || [];
        current.push(reservation);
        reservationsByProduct.set(key, current);
      }

      const cleanItems = items.map((item) => {
        const quantitySold = Number(item.quantity_sold || 0);
        const returnedQuantity = Number(item.returned_quantity || 0);
        const reservations = reservationsByProduct.get(Number(item.product_id)) || [];
        const pendingQuantity = reservations.reduce(
          (sum, reservation) => sum + Number(reservation.quantity || 0),
          0
        );
        const physicalRemaining = Math.max(0, quantitySold - returnedQuantity);
        const availableQuantity = Math.max(0, physicalRemaining - pendingQuantity);

        return {
          product_id: item.product_id,
          product_name: item.product_name,
          quantity_sold: quantitySold,
          unit_price: Number(item.unit_price || 0),
          line_total: Number(item.line_total || 0),
          returned_quantity: returnedQuantity,
          pending_return_quantity: pendingQuantity,
          active_refund_request_count: reservations.length,
          active_refund_request_codes: reservations.map((reservation) => reservation.request_code),
          physical_remaining_quantity: physicalRemaining,
          remaining_quantity: availableQuantity,
          inventory_tracking_mode: item.inventory_tracking_mode || "quantity",
          inventory_traceability_state: item.inventory_traceability_state || "off",
          inventory_product_code: item.inventory_product_code || null,
          serialized_return_requires_unit_ids:
            item.inventory_tracking_mode === "serialized" &&
            item.inventory_traceability_state === "enforced",
        };
      });

      return res.json({
        status: "success",
        branch_id: branchId,
        sale: sales[0],
        items: cleanItems,
      });
    } catch (error) {
      console.error("Get sale items for return error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching sale items.",
      });
    }
  }
);

// GET /api/returns
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const search = cleanText(req.query.search);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      let whereClause = "WHERE r.branch_id = ?";

      if (search) {
        whereClause += ` AND (
          s.receipt_number LIKE ?
          OR s.customer_name LIKE ?
          OR s.customer_phone LIKE ?
          OR c.name LIKE ?
          OR c.phone LIKE ?
          OR p.name LIKE ?
          OR r.reason LIKE ?
        )`;

        const searchValue = `%${search}%`;
        params.push(
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue
        );
      }

      if (from) {
        whereClause += ` AND DATE(r.returned_at) >= ?`;
        params.push(from);
      }

      if (to) {
        whereClause += ` AND DATE(r.returned_at) <= ?`;
        params.push(to);
      }

      const [returns] = await pool.query(
        `SELECT
          r.id,
          r.branch_id,
          r.sale_id,
          r.product_id,
          r.quantity,
          r.reason,
          r.return_type,
          r.refund_amount,
          r.refund_method,
          r.refund_reference,
          r.returned_by,
          r.approved_by,
          r.approved_at,
          r.returned_at,
          s.receipt_number,
          COALESCE(s.customer_name, c.name) AS customer_name,
          COALESCE(s.customer_phone, c.phone) AS customer_phone,
          p.name AS product_name,
          returned_user.full_name AS returned_by_name,
          approved_user.full_name AS approved_by_name,
          b.name AS branch_name,
          b.location AS branch_location
         FROM returns r
         LEFT JOIN sales s
          ON r.sale_id = s.id
          AND s.branch_id = r.branch_id
         LEFT JOIN customers c
          ON s.customer_id = c.id
          AND c.branch_id = r.branch_id
         LEFT JOIN products p
          ON r.product_id = p.id
          AND p.branch_id = r.branch_id
         LEFT JOIN users returned_user ON r.returned_by = returned_user.id
         LEFT JOIN users approved_user ON r.approved_by = approved_user.id
         LEFT JOIN branches b ON r.branch_id = b.id
         ${whereClause}
         ORDER BY r.returned_at DESC, r.id DESC`,
        params
      );

      const [summaryRows] = await pool.query(
        `SELECT
          COUNT(*) AS return_count,
          COALESCE(SUM(r.quantity), 0) AS total_quantity_returned,
          COALESCE(SUM(r.refund_amount), 0) AS total_refunded
         FROM returns r
         LEFT JOIN sales s
          ON r.sale_id = s.id
          AND s.branch_id = r.branch_id
         LEFT JOIN customers c
          ON s.customer_id = c.id
          AND c.branch_id = r.branch_id
         LEFT JOIN products p
          ON r.product_id = p.id
          AND p.branch_id = r.branch_id
         ${whereClause}`,
        params
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        count: returns.length,
        summary: {
          return_count: Number(summaryRows[0].return_count || 0),
          total_quantity_returned: Number(
            summaryRows[0].total_quantity_returned || 0
          ),
          total_refunded: Number(summaryRows[0].total_refunded || 0),
        },
        returns,
      });
    } catch (error) {
      console.error("Get returns error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching returns.",
      });
    }
  }
);

// POST /api/returns
router.post(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  validateRequest(validateReturnCreateRequest),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const branchId = getBranchId(req);
      const {
        sale_id,
        product_id,
        quantity,
        reason,
        return_type,
        refund_amount,
        refund_method,
        refund_reference,
        approver_username,
        approver_password,
        unit_ids = [],
      } = req.validated.body;

      if (!sale_id || !product_id || !quantity || !cleanText(reason)) {
        return res.status(400).json({
          status: "error",
          message: "Sale, product, quantity and reason are required.",
        });
      }

      const cleanSaleId = Number(sale_id);
      const cleanProductId = Number(product_id);
      const cleanQuantity = Number(quantity);
      const cleanReason = cleanText(reason);
      const allowedReturnTypes = new Set(["stock_only", "refund"]);
      const cleanReturnType = allowedReturnTypes.has(String(return_type || "stock_only").toLowerCase())
        ? String(return_type || "stock_only").toLowerCase()
        : "stock_only";
      const allowedRefundMethods = new Set(["cash", "momo", "bank", "other"]);
      const requestedRefundMethod = String(refund_method || "none").toLowerCase();
      const cleanRefundAmount = Number(refund_amount || 0);
      const cleanRefundReference = cleanText(refund_reference).slice(0, 180);

      if (!Number.isFinite(cleanRefundAmount) || cleanRefundAmount < 0) {
        return res.status(400).json({
          status: "error",
          message: "Refund amount must be a valid non-negative number.",
        });
      }

      if (cleanReturnType === "refund") {
        if (cleanRefundAmount <= 0 || !allowedRefundMethods.has(requestedRefundMethod)) {
          return res.status(400).json({
            status: "error",
            message: "A financial refund requires a positive refund amount and Cash, MoMo, Bank or Other refund method.",
          });
        }
        if (["momo", "bank", "other"].includes(requestedRefundMethod) && !cleanRefundReference) {
          return res.status(400).json({
            status: "error",
            message: "A transaction/reference number is required for MoMo, Bank or Other refunds.",
          });
        }
      }

      if (
        !cleanSaleId ||
        !cleanProductId ||
        !Number.isInteger(cleanQuantity) ||
        cleanQuantity <= 0
      ) {
        return res.status(400).json({
          status: "error",
          message: "Quantity must be a positive whole number.",
        });
      }

      await connection.beginTransaction();

      const [sales] = await connection.query(
        `SELECT
          id,
          branch_id,
          receipt_number,
          sale_status,
          is_voided,
          amount_paid,
          created_at
         FROM sales
         WHERE id = ?
         AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [cleanSaleId, branchId]
      );

      if (sales.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Sale not found in the selected store.",
        });
      }

      if (
        sales[0].sale_status !== "completed" ||
        Number(sales[0].is_voided || 0) === 1
      ) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "Only active completed sales can be returned.",
        });
      }

      const [saleItems] = await connection.query(
        `SELECT
          si.product_id,
          si.product_name,
          SUM(si.quantity) AS quantity_sold,
          MAX(si.unit_price) AS unit_price
         FROM sale_items si
         INNER JOIN sales s ON si.sale_id = s.id
         WHERE si.sale_id = ?
         AND s.branch_id = ?
         AND si.product_id = ?
         GROUP BY si.product_id, si.product_name
         LIMIT 1`,
        [cleanSaleId, branchId, cleanProductId]
      );

      if (saleItems.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "This product was not found in the selected sale.",
        });
      }

      const [products] = await connection.query(
        `SELECT
          id, branch_id, name,
          inventory_tracking_mode,
          inventory_traceability_state,
          inventory_product_code
         FROM products
         WHERE id = ?
         AND branch_id = ?
         AND is_active = TRUE
         LIMIT 1
         FOR UPDATE`,
        [cleanProductId, branchId]
      );

      if (products.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Product not found in the selected store.",
        });
      }

      const saleItem = saleItems[0];

      if (!req.approvalExecution?.request_id) {
        const activeReservations = await listActiveReturnReservations(connection, {
          branchId,
          saleId: cleanSaleId,
          forUpdate: true,
        });
        const activeForProduct = activeReservations.filter(
          (reservation) => Number(reservation.product_id) === Number(cleanProductId)
        );
        if (activeForProduct.length > 0) {
          await connection.rollback();
          return res.status(409).json({
            status: "error",
            code: "ACTIVE_RETURN_REQUEST_EXISTS",
            message: `This item already has an active financial return request (${activeForProduct
              .map((reservation) => reservation.request_code)
              .join(", ")}). Resolve that request before recording another return for this item.`,
          });
        }
      }

      const [previousReturns] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS returned_quantity
         FROM returns
         WHERE branch_id = ?
         AND sale_id = ?
         AND product_id = ?`,
        [branchId, cleanSaleId, cleanProductId]
      );

      const quantitySold = Number(saleItem.quantity_sold || 0);
      const alreadyReturned = Number(
        previousReturns[0].returned_quantity || 0
      );
      const remainingQuantity = quantitySold - alreadyReturned;

      if (cleanQuantity > remainingQuantity) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: `You cannot return ${cleanQuantity}. Only ${remainingQuantity} remaining from this sale.`,
        });
      }

      const returnTraceabilitySelection = await lockReturnUnitSelection(connection, {
        branchId,
        saleId: cleanSaleId,
        product: products[0],
        quantity: cleanQuantity,
        unitCodes: unit_ids || [],
      });

      const estimatedReturnAmount = Number(saleItem.unit_price || 0) * cleanQuantity;
      const finalRefundAmount = cleanReturnType === "refund"
        ? Number(cleanRefundAmount.toFixed(2))
        : 0;
      const finalRefundMethod = cleanReturnType === "refund"
        ? requestedRefundMethod
        : "none";

      if (finalRefundAmount - estimatedReturnAmount > 0.009) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message: `Refund amount cannot exceed the returned item value of GHS ${estimatedReturnAmount.toFixed(2)}.`,
        });
      }

      if (cleanReturnType === "refund") {
        const [priorRefundRows] = await connection.query(
          `SELECT COALESCE(SUM(refund_amount), 0) AS refunded_total
           FROM returns
           WHERE branch_id = ? AND sale_id = ? AND return_type = 'refund'`,
          [branchId, cleanSaleId]
        );
        const collectedAvailable = Math.max(
          0,
          Number(sales[0].amount_paid || 0) - Number(priorRefundRows[0]?.refunded_total || 0)
        );
        if (finalRefundAmount - collectedAvailable > 0.009) {
          await connection.rollback();
          return res.status(409).json({
            status: "error",
            code: "REFUND_EXCEEDS_COLLECTED_MONEY",
            message: `Only GHS ${collectedAvailable.toFixed(2)} of collected customer money remains available to refund on this sale.`,
          });
        }
      }

      let approver = null;
      if (cleanReturnType === "refund") {
        const approvalResult = await verifyIndependentReturnApprover(connection, {
          currentUserId: req.user.id,
          branchId,
          approverUsername: approver_username,
          approverPassword: approver_password,
        });
        if (approvalResult.error) {
          await connection.rollback();
          return res.status(403).json({ status: "error", message: approvalResult.error });
        }
        approver = approvalResult.approver;
      }

      const [returnResult] = await connection.query(
        `INSERT INTO returns (
          branch_id,
          sale_id,
          product_id,
          quantity,
          reason,
          return_type,
          refund_amount,
          refund_method,
          refund_reference,
          returned_by,
          approved_by,
          approved_at,
          returned_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          branchId,
          cleanSaleId,
          cleanProductId,
          cleanQuantity,
          cleanReason,
          cleanReturnType,
          finalRefundAmount,
          finalRefundMethod,
          cleanRefundReference || null,
          req.user.id,
          approver?.id || null,
          approver ? new Date() : null,
        ]
      );

      const quarantinedUnits = await markReturnUnitsQuarantined(connection, {
        branchId,
        returnId: returnResult.insertId,
        saleId: cleanSaleId,
        productId: cleanProductId,
        unitCodes: returnTraceabilitySelection.unit_codes,
        actorUserId: req.user.id,
        reason: cleanReason,
        requestId: req.requestId || req.id || req.approvalExecution?.request_code || null,
      });

      await connection.query(
        `UPDATE products
         SET quantity = quantity + ?
         WHERE id = ?
         AND branch_id = ?`,
        [cleanQuantity, cleanProductId, branchId]
      );

      const returnAmount = estimatedReturnAmount;

      await writeAuditEvent({
        connection,
        req,
        branchId,
        userId: req.user.id,
        action: "CREATE_RETURN",
        details: `Returned ${cleanQuantity} x ${saleItem.product_name} from receipt ${sales[0].receipt_number}. Type: ${cleanReturnType}. Refund: GHS ${finalRefundAmount.toFixed(2)} by ${finalRefundMethod}${approver ? ` approved by ${approver.full_name}` : ""}`,
        workspaceCode: "spare_parts",
        entityType: "return",
        entityId: returnResult.insertId,
        actionType: cleanReturnType === "refund" ? "return_refund_executed" : "stock_return_executed",
        outcome: "success",
        severity: cleanReturnType === "refund" ? "high" : "notice",
        metadata: {
          approval_request_id: req.approvalExecution?.request_id || null,
          approval_request_code: req.approvalExecution?.request_code || null,
          sale_id: cleanSaleId,
          product_id: cleanProductId,
          quantity: cleanQuantity,
          refund_amount: finalRefundAmount,
          refund_method: finalRefundMethod,
          refund_reference: cleanRefundReference || null,
          approved_by: approver?.id || null,
          unit_ids: quarantinedUnits.map((unit) => unit.unit_code),
          serialized_quarantine: quarantinedUnits.length > 0,
        },
      });

      const affectedClosing = await markClosingStale(connection, {
        branchId,
        transactionDate: new Date(),
        reason: `A ${cleanReturnType} return was recorded after closing for receipt ${sales[0].receipt_number}: ${cleanQuantity} x ${saleItem.product_name}. Refund GHS ${finalRefundAmount.toFixed(2)} by ${finalRefundMethod}.`,
        sourceEntityType: "return",
        sourceEntityId: returnResult.insertId,
        changedBy: req.user.id,
        approvedBy: approver?.id || null,
      });

      if (req.approvalExecution?.request_id) {
        const durableExecutionResult = {
          return_id: returnResult.insertId,
          sale_id: cleanSaleId,
          product_id: cleanProductId,
          quantity: cleanQuantity,
          refund_amount: finalRefundAmount,
          refund_method: finalRefundMethod,
          unit_ids: quarantinedUnits.map((unit) => unit.unit_code),
          serialized_quarantine: quarantinedUnits.length > 0,
          affected_closing_id: affectedClosing?.id || null,
        };
        const [approvalUpdate] = await connection.query(
          `UPDATE audit_unlock_requests
           SET execution_status = 'executed', executed_at = NOW(),
               execution_result_json = ?, execution_error = NULL,
               execution_token_hash = NULL
           WHERE id = ?
             AND approval_kind = 'return_refund'
             AND execution_status = 'executing'`,
          [JSON.stringify(durableExecutionResult), req.approvalExecution.request_id]
        );
        if (Number(approvalUpdate.affectedRows || 0) !== 1) {
          const error = new Error(
            "The approval request could not be finalized atomically with the return."
          );
          error.code = "RETURN_APPROVAL_FINALIZATION_FAILED";
          throw error;
        }
      }

      await connection.commit();

      return res.status(201).json({
        status: "success",
        message:
          quarantinedUnits.length > 0
            ? "Return recorded successfully. Physical serialized units are in quarantine and are not sellable until inspection clears them."
            : "Return recorded successfully. Stock has been increased.",
        return_record: {
          branch_id: branchId,
          sale_id: cleanSaleId,
          product_id: cleanProductId,
          product_name: saleItem.product_name,
          quantity: cleanQuantity,
          reason: cleanReason,
          return_type: cleanReturnType,
          estimated_return_amount: returnAmount,
          refund_amount: finalRefundAmount,
          refund_method: finalRefundMethod,
          refund_reference: cleanRefundReference || null,
          approved_by: approver?.full_name || null,
          approval_request_id: req.approvalExecution?.request_id || null,
          unit_ids: quarantinedUnits.map((unit) => unit.unit_code),
          serialized_quarantine: quarantinedUnits.length > 0,
        },
        affected_closing: affectedClosing,
      });
    } catch (error) {
      await connection.rollback();

      console.error("Create return error:", error);

      const statusCode = Number(error.statusCode || 500);
      return res.status(statusCode).json({
        status: "error",
        code: error.code || "RETURN_CREATE_ERROR",
        message:
          statusCode >= 500
            ? "Something went wrong while recording return."
            : error.message,
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
