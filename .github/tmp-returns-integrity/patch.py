from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def rep(path, old, new, expected=1):
    text = read(path)
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} match(es), got {count}: {old[:120]!r}")
    write(path, text.replace(old, new, expected))


# ---------------------------------------------------------------------------
# Operational Approval service: active-return reservations, admin self-reject,
# and durable/idempotent execution finalization.
# ---------------------------------------------------------------------------
p = "backend/services/operationalApprovalService.js"
source = read(p)
anchor = "async function createOperationalRequest({\n"
if source.count(anchor) != 1:
    raise SystemExit("createOperationalRequest anchor mismatch")
helper = r'''function normalizeReturnReservation(row) {
  const payload = parseJson(row?.approval_payload_json, {});
  return {
    id: positiveInteger(row?.id),
    request_code: requestCodeFromRow(row),
    status: cleanText(row?.status, 30).toLowerCase(),
    execution_status: cleanText(row?.execution_status, 30).toLowerCase(),
    product_id: positiveInteger(payload?.product_id),
    quantity: positiveInteger(payload?.quantity),
    sale_id: positiveInteger(payload?.sale_id || row?.entity_id),
    refund_amount: money(payload?.refund_amount),
  };
}

async function listActiveReturnReservations(
  connection = pool,
  { branchId, saleId, excludeRequestId = null, forUpdate = false } = {}
) {
  const cleanBranchId = positiveInteger(branchId);
  const cleanSaleId = positiveInteger(saleId);
  if (!cleanBranchId || !cleanSaleId) return [];

  const params = [cleanBranchId, cleanSaleId];
  let excludeSql = "";
  const cleanExcludeId = positiveInteger(excludeRequestId);
  if (cleanExcludeId) {
    excludeSql = " AND id <> ?";
    params.push(cleanExcludeId);
  }

  const [rows] = await connection.query(
    `SELECT id, requested_action, status, execution_status, expires_at,
            entity_id, approval_payload_json
     FROM audit_unlock_requests
     WHERE branch_id = ?
       AND approval_kind = 'return_refund'
       AND entity_type = 'sale'
       AND entity_id = ?
       AND status IN ('pending', 'approved')
       AND execution_status IN ('pending', 'executing', 'failed')
       AND (
         execution_status = 'executing'
         OR expires_at IS NULL
         OR expires_at > NOW()
       )${excludeSql}
     ORDER BY id ASC${forUpdate ? " FOR UPDATE" : ""}`,
    params
  );

  return rows
    .map(normalizeReturnReservation)
    .filter((reservation) => reservation.id && reservation.product_id && reservation.quantity);
}

'''
source = source.replace(anchor, helper + anchor, 1)
write(p, source)

rep(
    p,
    '''    if (Number(request.requested_by) === Number(getUserId(req))) {
      const error = new Error("The requester cannot review their own action.");
      error.statusCode = 403;
      throw error;
    }
''',
    '''    const selfReview =
      Number(request.requested_by) === Number(getUserId(req));
    const adminReturnSelfRejection =
      selfReview &&
      getRole(req) === "admin" &&
      request.approval_kind === "return_refund";

    if (selfReview && !adminReturnSelfRejection) {
      const error = new Error("The requester cannot review their own action.");
      error.statusCode = 403;
      throw error;
    }
'''
)

rep(
    p,
    '''      details: `${request.request_code} rejected by ${reviewer.username}: ${cleanText(
        reviewNote,
        500
      )}`,
''',
    '''      details: `${request.request_code} rejected by ${reviewer.username}${
        adminReturnSelfRejection ? " (administrator closed their own return/refund request)" : ""
      }: ${cleanText(reviewNote, 500)}`,
'''
)

source = read(p)
pattern = re.compile(r"async function finishOperationalExecution\(\{ requestId, success, result, errorMessage \}\) \{.*?\n\}\n\nmodule\.exports = \{", re.S)
match = pattern.search(source)
if not match:
    raise SystemExit("finishOperationalExecution function not found")
new_finish = r'''async function finishOperationalExecution({ requestId, success, result, errorMessage }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const request = await lockOperationalRequest(connection, requestId);
    if (!request) throw new Error("Operational request disappeared during execution.");

    // Return/refund execution may finalize itself inside the same transaction
    // that changes stock and money. If so, never downgrade that durable success
    // merely because the internal HTTP response was interrupted afterward.
    if (request.execution_status === "executed") {
      if (request.notification_id) {
        await connection.query(
          `UPDATE notifications
           SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW()),
               resolved_by = COALESCE(resolved_by, ?),
               resolution_note = 'Approved action executed successfully.'
           WHERE id = ?`,
          [request.reviewed_by || null, request.notification_id]
        ).catch(() => {});
      }
      await connection.commit();
      return request;
    }

    if (request.execution_status !== "executing") {
      await connection.commit();
      return request;
    }

    const finalStatus = success ? "executed" : "failed";
    if (success) {
      await connection.query(
        `UPDATE audit_unlock_requests
         SET execution_status = 'executed', executed_at = NOW(),
             execution_result_json = ?, execution_error = NULL,
             execution_token_hash = NULL
         WHERE id = ? AND execution_status = 'executing'`,
        [JSON.stringify(result || {}), requestId]
      );

      if (request.notification_id) {
        await connection.query(
          `UPDATE notifications
           SET status = 'resolved', resolved_at = NOW(), resolved_by = ?,
               resolution_note = 'Approved action executed successfully.'
           WHERE id = ?`,
          [request.reviewed_by || null, request.notification_id]
        ).catch(() => {});
      }
    } else {
      await connection.query(
        `UPDATE audit_unlock_requests
         SET execution_status = 'failed', execution_error = ?,
             execution_token_hash = NULL
         WHERE id = ? AND execution_status = 'executing'`,
        [cleanText(errorMessage, 12000), requestId]
      );
    }

    await writeAuditEvent({
      connection,
      userId: request.reviewed_by || request.requested_by || null,
      branchId: request.branch_id || null,
      action: success
        ? "EXECUTE_OPERATIONAL_APPROVAL_REQUEST"
        : "FAIL_OPERATIONAL_APPROVAL_EXECUTION",
      details: success
        ? `${request.request_code} protected action executed successfully.`
        : `${request.request_code} protected action execution failed: ${cleanText(errorMessage, 1000)}`,
      workspaceCode: "spare_parts",
      entityType: "operational_approval_request",
      entityId: request.id,
      actionType: success ? "execution_success" : "execution_failure",
      outcome: success ? "success" : "failure",
      severity: success ? "high" : "critical",
      metadata: {
        request_code: request.request_code,
        approval_kind: request.approval_kind,
        execution_status: finalStatus,
      },
    });

    await connection.commit();
    return normalizeRequestRow({
      ...request,
      execution_status: finalStatus,
      execution_error: success ? null : cleanText(errorMessage, 12000),
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {'''
source = source[:match.start()] + new_finish + source[match.end():]
write(p, source)

rep(
    p,
    '''  listOperationalRequests,
  lockOperationalRequest,
''',
    '''  listOperationalRequests,
  listActiveReturnReservations,
  lockOperationalRequest,
'''
)

# ---------------------------------------------------------------------------
# Operational Approval routes: one active request per sale item, reserve the
# item, cap refunds by collected money, and recover safely after lost response.
# ---------------------------------------------------------------------------
p = "backend/routes/operationalApprovalRoutes.js"
rep(
    p,
    '''  listOperationalRequests,
  money,
''',
    '''  listOperationalRequests,
  listActiveReturnReservations,
  money,
'''
)

rep(
    p,
    '''    const remaining = Number(item.quantity_sold || 0) - Number(item.quantity_returned || 0);
    if (quantity > remaining) {
''',
    '''    const remaining = Number(item.quantity_sold || 0) - Number(item.quantity_returned || 0);

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
'''
)

rep(
    p,
    '''    const maximumRefund = Number(item.unit_price || 0) * quantity;
    if (refundAmount - maximumRefund > 0.009) {
      throw Object.assign(
        new Error(`Refund cannot exceed GHS ${maximumRefund.toFixed(2)} for this quantity.`),
        { statusCode: 400 }
      );
    }

    const payload = {
''',
    '''    const maximumRefund = Number(item.unit_price || 0) * quantity;
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
'''
)

rep(
    p,
    '''  } catch (error) {
    await finishOperationalExecution({
      requestId,
      success: false,
      errorMessage: error.message,
    }).catch(() => {});
    return res.status(500).json({
      status: "error",
      code: "APPROVED_ACTION_EXECUTION_ERROR",
      message: `The approval was recorded, but protected execution failed: ${error.message}`,
      request_id: requestId,
    });
  }
}
''',
    '''  } catch (error) {
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
'''
)

# ---------------------------------------------------------------------------
# Return route: pending reservation visibility, direct-return conflict guard,
# collected-money cap, rich audit, and exact-once approval finalization.
# ---------------------------------------------------------------------------
p = "backend/routes/returnRoutes.js"
rep(
    p,
    '''const { markClosingStale } = require("../services/dailyClosingSecurityService");
''',
    '''const { markClosingStale } = require("../services/dailyClosingSecurityService");
const { listActiveReturnReservations } = require("../services/operationalApprovalService");
'''
)

rep(
    p,
    '''      const cleanItems = items.map((item) => {
        const quantitySold = Number(item.quantity_sold || 0);
        const returnedQuantity = Number(item.returned_quantity || 0);

        return {
          product_id: item.product_id,
          product_name: item.product_name,
          quantity_sold: quantitySold,
          unit_price: Number(item.unit_price || 0),
          line_total: Number(item.line_total || 0),
          returned_quantity: returnedQuantity,
          remaining_quantity: quantitySold - returnedQuantity,
        };
      });
''',
    '''      const activeReservations = await listActiveReturnReservations(pool, {
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
        };
      });
'''
)

rep(
    p,
    '''          sale_status,
          is_voided,
          created_at
''',
    '''          sale_status,
          is_voided,
          amount_paid,
          created_at
'''
)

rep(
    p,
    '''      const saleItem = saleItems[0];

      const [previousReturns] = await connection.query(
''',
    '''      const saleItem = saleItems[0];

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
'''
)

rep(
    p,
    '''      const finalRefundMethod = cleanReturnType === "refund"
        ? requestedRefundMethod
        : "none";

      if (finalRefundAmount - estimatedReturnAmount > 0.009) {
''',
    '''      const finalRefundMethod = cleanReturnType === "refund"
        ? requestedRefundMethod
        : "none";

      if (finalRefundAmount - estimatedReturnAmount > 0.009) {
'''
)
# Insert collected-money guard immediately after the item-value guard block.
rep(
    p,
    '''      if (finalRefundAmount - estimatedReturnAmount > 0.009) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message: `Refund amount cannot exceed the returned item value of GHS ${estimatedReturnAmount.toFixed(2)}.`,
        });
      }

      let approver = null;
''',
    '''      if (finalRefundAmount - estimatedReturnAmount > 0.009) {
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
'''
)

old_log = '''      await connection.query(
        `INSERT INTO activity_log (branch_id, user_id, action, details)
         VALUES (?, ?, ?, ?)`,
        [
          branchId,
          req.user.id,
          "CREATE_RETURN",
          `Returned ${cleanQuantity} x ${saleItem.product_name} from receipt ${sales[0].receipt_number}. Type: ${cleanReturnType}. Refund: GHS ${finalRefundAmount.toFixed(2)} by ${finalRefundMethod}${approver ? ` approved by ${approver.full_name}` : ""}`,
        ]
      );
'''
new_log = '''      await writeAuditEvent({
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
        },
      });
'''
rep(p, old_log, new_log)

rep(
    p,
    '''      const affectedClosing = await markClosingStale(connection, {
        branchId,
        transactionDate: new Date(),
        reason: `A ${cleanReturnType} return was recorded after closing for receipt ${sales[0].receipt_number}: ${cleanQuantity} x ${saleItem.product_name}. Refund GHS ${finalRefundAmount.toFixed(2)} by ${finalRefundMethod}.`,
        sourceEntityType: "return",
        sourceEntityId: returnResult.insertId,
        changedBy: req.user.id,
        approvedBy: approver?.id || null,
      });

      await connection.commit();
''',
    '''      const affectedClosing = await markClosingStale(connection, {
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
'''
)

rep(
    p,
    '''          approved_by: approver?.full_name || null,
        },
''',
    '''          approved_by: approver?.full_name || null,
          approval_request_id: req.approvalExecution?.request_id || null,
        },
'''
)

# ---------------------------------------------------------------------------
# Accounting Intelligence: refunds reduce P&L net sales and cash estimate.
# ---------------------------------------------------------------------------
p = "backend/services/accountingIntelligenceService.js"
rep(
    p,
    '''function buildProfitAndLoss({ sales, expenses, purchases }) {
  const grossSales = money(sales.total_sales);
  const discounts = money(sales.total_discount);
  const netSales = money(grossSales - discounts);
  const operatingExpenses = money(expenses.total_expenses);
  const purchasesAsCostSignal = money(purchases.total_purchases);
  const estimatedNetBeforeStockCost = money(netSales - operatingExpenses);
  const conservativeCashPosition = money(sales.total_paid - operatingExpenses - purchases.amount_paid);

  return {
    gross_sales: grossSales,
    discounts,
    net_sales: netSales,
    operating_expenses: operatingExpenses,
    purchases_cost_signal: purchasesAsCostSignal,
    estimated_net_before_stock_cost: estimatedNetBeforeStockCost,
    conservative_cash_position: conservativeCashPosition,
''',
    '''function buildProfitAndLoss({ sales, expenses, purchases, returns }) {
  const grossSales = money(sales.total_sales);
  const discounts = money(sales.total_discount);
  const returnsAndRefunds = money(returns.total_return_amount || 0);
  const netSales = money(grossSales - discounts - returnsAndRefunds);
  const operatingExpenses = money(expenses.total_expenses);
  const purchasesAsCostSignal = money(purchases.total_purchases);
  const estimatedNetBeforeStockCost = money(netSales - operatingExpenses);
  const conservativeCashPosition = money(
    sales.total_paid - returnsAndRefunds - operatingExpenses - purchases.amount_paid
  );

  return {
    gross_sales: grossSales,
    discounts,
    returns_and_refunds: returnsAndRefunds,
    net_sales: netSales,
    operating_expenses: operatingExpenses,
    purchases_cost_signal: purchasesAsCostSignal,
    estimated_net_before_stock_cost: estimatedNetBeforeStockCost,
    conservative_cash_position: conservativeCashPosition,
'''
)
rep(
    p,
    '''  const profitAndLoss = buildProfitAndLoss({ sales, expenses, purchases });
''',
    '''  const profitAndLoss = buildProfitAndLoss({ sales, expenses, purchases, returns });
'''
)
rep(
    p,
    '''      total_paid: sales.total_paid,
      total_balance: sales.total_balance,
      total_expenses: expenses.total_expenses,
''',
    '''      total_paid: sales.total_paid,
      total_balance: sales.total_balance,
      total_refunds: returns.total_return_amount,
      net_sales_after_returns: profitAndLoss.net_sales,
      total_expenses: expenses.total_expenses,
'''
)

# ---------------------------------------------------------------------------
# Returns UX: reload pending reservations and show the item as unavailable.
# ---------------------------------------------------------------------------
p = "frontend/src/pages/ReturnsPage.jsx"
rep(
    p,
    '''      if (isRefund) {
        await loadSales();
      } else {
''',
    '''      if (isRefund) {
        await Promise.all([loadSaleItems(selectedSaleId), loadSales()]);
      } else {
'''
)
rep(
    p,
    '''    } else {
      await loadSales();
    }
''',
    '''    } else {
      await Promise.all([loadSaleItems(selectedSaleId), loadSales()]);
    }
'''
)

p = "frontend/src/components/MultiItemReturnPanel.jsx"
rep(
    p,
    '''    remaining_quantity: Number(
      item.remaining_quantity || 0
    ),
    unit_price: Number(item.unit_price || 0),
''',
    '''    remaining_quantity: Number(
      item.remaining_quantity || 0
    ),
    pending_return_quantity: Number(item.pending_return_quantity || 0),
    active_refund_request_count: Number(item.active_refund_request_count || 0),
    active_refund_request_codes: Array.isArray(item.active_refund_request_codes)
      ? item.active_refund_request_codes
      : [],
    unit_price: Number(item.unit_price || 0),
'''
)
rep(
    p,
    '''          const unavailable =
            line.remaining_quantity <= 0;
''',
    '''          const unavailable =
            line.remaining_quantity <= 0 || line.active_refund_request_count > 0;
'''
)
rep(
    p,
    '''                  <small>
                    Remaining:{" "}
                    {
                      line.remaining_quantity
                    }
                    {" · "}
                    {formatMoney(
                      line.unit_price
                    )}{" "}
                    each
                  </small>
''',
    '''                  <small>
                    Remaining available: {line.remaining_quantity}
                    {line.pending_return_quantity > 0
                      ? ` · Pending approval: ${line.pending_return_quantity}`
                      : ""}
                    {" · "}
                    {formatMoney(line.unit_price)} each
                    {line.active_refund_request_codes.length > 0
                      ? ` · ${line.active_refund_request_codes.join(", ")}`
                      : ""}
                  </small>
'''
)

# Accounting UI: make refund impact visible to management.
p = "frontend/src/pages/AdvancedAccountingIntelligencePage.jsx"
rep(
    p,
    '''    {
      title: "Paid",
      value: formatMoney(summary.total_paid),
      note: "Collected money",
      icon: "💰",
    },
''',
    '''    {
      title: "Paid",
      value: formatMoney(summary.total_paid),
      note: "Collected money",
      icon: "💰",
    },
    {
      title: "Refunds",
      value: formatMoney(summary.total_refunds),
      note: "Executed returns/refunds reduce net sales",
      icon: "↩️",
      tone: Number(summary.total_refunds || 0) > 0 ? "warning" : "normal",
    },
'''
)
rep(
    p,
    '''      title: "Net Before Stock Cost",
      value: formatMoney(summary.estimated_net_before_stock_cost),
      note: "Management estimate only",
''',
    '''      title: "Net After Refunds Before Stock Cost",
      value: formatMoney(summary.estimated_net_before_stock_cost),
      note: "Sales less discounts, refunds and operating expenses",
'''
)

# ---------------------------------------------------------------------------
# Regression contracts.
# ---------------------------------------------------------------------------
backend_test = ROOT / "backend/tests/returnIntegrityContract.test.js"
backend_test.write_text(r'''const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const approvalService = read("services/operationalApprovalService.js");
const approvalRoutes = read("routes/operationalApprovalRoutes.js");
const returnRoutes = read("routes/returnRoutes.js");
const closingRoutes = read("routes/dailyClosingRoutes.js");
const accounting = read("services/accountingIntelligenceService.js");

test("one active financial return request reserves a sale item across users and retry states", () => {
  assert.match(approvalService, /listActiveReturnReservations/);
  assert.match(approvalService, /approval_kind = 'return_refund'/);
  assert.match(approvalService, /status IN \('pending', 'approved'\)/);
  assert.match(approvalService, /execution_status IN \('pending', 'executing', 'failed'\)/);
  assert.match(approvalRoutes, /ACTIVE_RETURN_REQUEST_EXISTS/);
  assert.match(approvalRoutes, /Approve\/retry it or reject it before creating another return request/);
});

test("System Administrator can close their own duplicate or failed return request but other self-review stays blocked", () => {
  assert.match(approvalService, /const adminReturnSelfRejection =[\s\S]*getRole\(req\) === "admin"[\s\S]*request\.approval_kind === "return_refund"/);
  assert.match(approvalService, /if \(selfReview && !adminReturnSelfRejection\)/);
  assert.match(approvalService, /execution_status = 'rejected'/);
});

test("approved return is finalized exactly once inside the stock and refund transaction", () => {
  assert.match(returnRoutes, /req\.approvalExecution\?\.request_id/);
  assert.match(returnRoutes, /SET execution_status = 'executed', executed_at = NOW\(\)/);
  assert.match(returnRoutes, /RETURN_APPROVAL_FINALIZATION_FAILED/);
  assert.match(approvalService, /if \(request\.execution_status === "executed"\)/);
  assert.match(approvalRoutes, /internal response was interrupted after the business transaction completed/);
});

test("return changes stock, creates rich audit evidence and marks Daily Closing stale", () => {
  assert.match(returnRoutes, /SET quantity = quantity \+ \?/);
  assert.match(returnRoutes, /writeAuditEvent\(\{/);
  assert.match(returnRoutes, /entityType: "return"/);
  assert.match(returnRoutes, /approval_request_id/);
  assert.match(returnRoutes, /markClosingStale/);
  assert.match(returnRoutes, /sourceEntityType: "return"/);
});

test("refund cannot exceed item value or customer money actually collected", () => {
  assert.match(approvalRoutes, /REFUND_EXCEEDS_COLLECTED_MONEY/);
  assert.match(returnRoutes, /REFUND_EXCEEDS_COLLECTED_MONEY/);
  assert.match(approvalRoutes, /SUM\(refund_amount\)/);
  assert.match(returnRoutes, /SUM\(refund_amount\)/);
});

test("Daily Closing subtracts refunds from their exact real money channel", () => {
  assert.match(closingRoutes, /refundCash/);
  assert.match(closingRoutes, /refundMomo/);
  assert.match(closingRoutes, /refundBank/);
  assert.match(closingRoutes, /refundOther/);
  assert.match(closingRoutes, /- expenseCash - refundCash/);
  assert.match(closingRoutes, /- expenseMomo - refundMomo/);
  assert.match(closingRoutes, /- expenseBank - refundBank/);
  assert.match(closingRoutes, /- expenseOther - refundOther/);
});

test("management P&L subtracts executed return refunds from net sales", () => {
  assert.match(accounting, /returnsAndRefunds = money\(returns\.total_return_amount \|\| 0\)/);
  assert.match(accounting, /netSales = money\(grossSales - discounts - returnsAndRefunds\)/);
  assert.match(accounting, /returns_and_refunds: returnsAndRefunds/);
  assert.match(accounting, /buildProfitAndLoss\(\{ sales, expenses, purchases, returns \}\)/);
});
''', encoding="utf-8")

frontend_test = ROOT / "frontend/scripts/returnIntegrityTests.mjs"
frontend_test.write_text(r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const page = read("src/pages/ReturnsPage.jsx");
const panel = read("src/components/MultiItemReturnPanel.jsx");
const accounting = read("src/pages/AdvancedAccountingIntelligencePage.jsx");

assert.match(page, /loadSaleItems\(selectedSaleId\), loadSales\(\)/);
assert.match(panel, /active_refund_request_count/);
assert.match(panel, /pending_return_quantity/);
assert.match(panel, /active_refund_request_codes/);
assert.match(panel, /Pending approval/);
assert.match(accounting, /title: "Refunds"/);
assert.match(accounting, /Net After Refunds Before Stock Cost/);

console.log("Returns integrity frontend contract passed.");
''', encoding="utf-8")

p = "frontend/package.json"
text = read(p)
needle = 'node scripts/backupRestoreDirectApiTests.mjs"'
if needle not in text:
    raise SystemExit("frontend package test tail not found")
text = text.replace(
    needle,
    'node scripts/backupRestoreDirectApiTests.mjs && node scripts/returnIntegrityTests.mjs"',
    1,
)
write(p, text)

print("Returns integrity patch applied.")
