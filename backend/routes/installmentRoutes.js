const crypto = require("crypto");
const express = require("express");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requireAnyPermission,
  requirePermission,
} = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  buildInstallmentSchedule,
  cleanText,
  dateOnly,
  money,
  positiveInteger,
  refreshAgreementFinancials,
  refreshBranchAgreements,
} = require("../services/installmentService");
const { getSmsConfig, normalizeGhanaPhone, sendSms } = require("../services/smsService");
const {
  runInstallmentReminderSync,
  sendInstallmentEventSms,
} = require("../services/installmentReminderService");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const { validateInstallmentPaymentRequest } = require("../validation/financialRequestValidators");

const router = express.Router();

router.use(requireAuth);

function branchIdFromRequest(req) {
  const branchId = Number(
    req.user?.branch_id || req.user?.default_branch_id || req.user?.selected_branch?.id
  );

  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function requireBranch(req, res) {
  const branchId = branchIdFromRequest(req);

  if (!branchId) {
    res.status(400).json({
      status: "error",
      code: "STORE_CONTEXT_REQUIRED",
      message: "Select a Spare Parts store before using installment sales.",
    });
    return null;
  }

  return branchId;
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null).slice(0, 12000);
  } catch {
    return null;
  }
}

function paymentMethod(value) {
  const method = String(value || "").trim().toLowerCase();
  return ["cash", "momo", "bank", "other"].includes(method)
    ? method
    : null;
}

function cleanOverdueReminderDays(value) {
  const days = String(value || "1,3,7")
    .split(",")
    .map((item) => Number(String(item).trim()))
    .filter((item) => Number.isInteger(item) && item > 0 && item <= 365);

  return [...new Set(days)].sort((left, right) => left - right).join(",") || "1,3,7";
}

async function loadAgreement(connection, branchId, agreementId, lock = false) {
  const [rows] = await connection.query(
    `SELECT
      ia.*,
      s.receipt_number,
      s.payment_type,
      d.status AS debt_status,
      creator.full_name AS created_by_name,
      approver.full_name AS approved_by_name
     FROM installment_agreements ia
     INNER JOIN sales s ON s.id = ia.sale_id
     LEFT JOIN debts d ON d.id = ia.debt_id
     LEFT JOIN users creator ON creator.id = ia.created_by
     LEFT JOIN users approver ON approver.id = ia.approved_by
     WHERE ia.id = ? AND ia.branch_id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [agreementId, branchId]
  );

  return rows[0] || null;
}

async function loadAgreementDetail(connection, branchId, agreementId) {
  const agreement = await loadAgreement(connection, branchId, agreementId);

  if (!agreement) return null;

  const [items] = await connection.query(
    `SELECT *
     FROM installment_agreement_items
     WHERE agreement_id = ?
     ORDER BY id`,
    [agreementId]
  );
  const [schedule] = await connection.query(
    `SELECT *
     FROM installment_schedule
     WHERE agreement_id = ?
     ORDER BY sequence_number`,
    [agreementId]
  );
  const [payments] = await connection.query(
    `SELECT
      ip.*,
      u.full_name AS received_by_name
     FROM installment_payments ip
     LEFT JOIN users u ON u.id = ip.received_by
     WHERE ip.agreement_id = ?
     ORDER BY ip.paid_at DESC, ip.id DESC`,
    [agreementId]
  );
  const [reschedules] = await connection.query(
    `SELECT
      ir.*,
      requester.full_name AS requested_by_name,
      decider.full_name AS decided_by_name
     FROM installment_reschedules ir
     LEFT JOIN users requester ON requester.id = ir.requested_by
     LEFT JOIN users decider ON decider.id = ir.decided_by
     WHERE ir.agreement_id = ?
     ORDER BY ir.requested_at DESC, ir.id DESC`,
    [agreementId]
  );
  const [reminders] = await connection.query(
    `SELECT *
     FROM installment_reminder_log
     WHERE agreement_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
    [agreementId]
  );

  return { agreement, items, schedule, payments, reschedules, reminders };
}

async function cancelUnderlyingSaleAndDebt(
  connection,
  { agreement, userId, reason }
) {
  await connection.query(
    `UPDATE sales
     SET sale_status = 'cancelled',
         is_voided = 1,
         void_reason = ?,
         voided_by = ?,
         voided_at = NOW(),
         balance = 0
     WHERE id = ? AND branch_id = ?`,
    [reason, userId || null, agreement.sale_id, agreement.branch_id]
  );

  if (agreement.debt_id) {
    await connection.query(
      `UPDATE debts
       SET amount_owed = 0,
           amount_paid = 0,
           balance = 0,
           status = 'paid',
           due_date = NULL
       WHERE id = ? AND branch_id = ?`,
      [agreement.debt_id, agreement.branch_id]
    );
  }
}

function paymentReceiptNumber({ branchId, branchCode, paymentId }) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const code = String(branchCode || `B${branchId}`)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);

  return `IP-${code}-${date}-${String(paymentId).padStart(8, "0")}`;
}

function statusFilter(value) {
  const status = String(value || "").trim().toLowerCase();
  const allowed = new Set([
    "draft",
    "pending_approval",
    "active",
    "due_soon",
    "payment_due",
    "overdue",
    "completed",
    "cancelled",
    "defaulted",
  ]);
  return allowed.has(status) ? status : null;
}

router.get(
  "/dashboard",
  requireAnyPermission("installments.view", "installments.manage", "installments.collect"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    if (!branchId) return;

    try {
      await refreshBranchAgreements(pool, branchId);
      const [[summary]] = await pool.query(
        `SELECT
          COUNT(*) AS agreement_count,
          SUM(agreement_status IN ('active','due_soon','payment_due','overdue')) AS active_count,
          SUM(agreement_status = 'overdue') AS overdue_count,
          SUM(agreement_status = 'completed') AS completed_count,
          COALESCE(SUM(sale_total), 0) AS financed_sales_total,
          COALESCE(SUM(deposit_amount), 0) AS deposits_total,
          COALESCE(SUM(amount_paid), 0) AS collections_total,
          COALESCE(SUM(outstanding_balance), 0) AS outstanding_total,
          COALESCE(SUM(overdue_amount), 0) AS overdue_total,
          SUM(next_due_date = CURRENT_DATE AND outstanding_balance > 0) AS due_today_count,
          SUM(next_due_date BETWEEN CURRENT_DATE AND DATE_ADD(CURRENT_DATE, INTERVAL 3 DAY)
              AND outstanding_balance > 0) AS due_soon_count
         FROM installment_agreements
         WHERE branch_id = ?`,
        [branchId]
      );

      const [upcoming] = await pool.query(
        `SELECT
          ia.id,
          ia.agreement_number,
          ia.customer_name,
          ia.customer_phone,
          ia.next_due_date,
          ia.outstanding_balance,
          ia.overdue_amount,
          ia.agreement_status,
          COALESCE((
            SELECT scheduled_amount + late_charge_amount - waived_charge_amount - amount_paid
            FROM installment_schedule sc
            WHERE sc.agreement_id = ia.id
              AND sc.schedule_status <> 'paid'
            ORDER BY sc.sequence_number
            LIMIT 1
          ), ia.outstanding_balance) AS next_amount
         FROM installment_agreements ia
         WHERE ia.branch_id = ?
           AND ia.agreement_status IN ('active','due_soon','payment_due','overdue')
         ORDER BY
           CASE WHEN ia.agreement_status = 'overdue' THEN 0 ELSE 1 END,
           ia.next_due_date,
           ia.id
         LIMIT 20`,
        [branchId]
      );

      res.json({
        status: "success",
        summary: {
          ...summary,
          agreement_count: Number(summary?.agreement_count || 0),
          active_count: Number(summary?.active_count || 0),
          overdue_count: Number(summary?.overdue_count || 0),
          completed_count: Number(summary?.completed_count || 0),
          due_today_count: Number(summary?.due_today_count || 0),
          due_soon_count: Number(summary?.due_soon_count || 0),
        },
        upcoming,
      });
    } catch (error) {
      console.error("Installment dashboard error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not load the installment dashboard.",
        request_id: req.requestId || null,
      });
    }
  }
);

router.get(
  "/agreements",
  requireAnyPermission("installments.view", "installments.manage", "installments.collect"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    if (!branchId) return;

    try {
      await refreshBranchAgreements(pool, branchId);
      const filters = ["ia.branch_id = ?"];
      const params = [branchId];
      const cleanStatus = statusFilter(req.query.status);
      const search = cleanText(req.query.search, 150);
      const from = dateOnly(req.query.from);
      const to = dateOnly(req.query.to);

      if (cleanStatus) {
        filters.push("ia.agreement_status = ?");
        params.push(cleanStatus);
      }
      if (search) {
        filters.push(`(
          ia.agreement_number LIKE ?
          OR ia.customer_name LIKE ?
          OR ia.customer_phone LIKE ?
          OR s.receipt_number LIKE ?
        )`);
        const like = `%${search}%`;
        params.push(like, like, like, like);
      }
      if (from) {
        filters.push("DATE(ia.created_at) >= ?");
        params.push(from);
      }
      if (to) {
        filters.push("DATE(ia.created_at) <= ?");
        params.push(to);
      }

      const [rows] = await pool.query(
        `SELECT
          ia.*,
          s.receipt_number,
          creator.full_name AS created_by_name
         FROM installment_agreements ia
         INNER JOIN sales s ON s.id = ia.sale_id
         LEFT JOIN users creator ON creator.id = ia.created_by
         WHERE ${filters.join(" AND ")}
         ORDER BY ia.created_at DESC, ia.id DESC
         LIMIT 500`,
        params
      );

      res.json({ status: "success", agreements: rows });
    } catch (error) {
      console.error("List installment agreements error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not load installment agreements.",
        request_id: req.requestId || null,
      });
    }
  }
);

router.get(
  "/agreements/:agreementId",
  requireAnyPermission("installments.view", "installments.manage", "installments.collect"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    if (!branchId) return;
    if (!agreementId) {
      return res.status(400).json({ status: "error", message: "Invalid agreement ID." });
    }

    try {
      const detail = await loadAgreementDetail(pool, branchId, agreementId);
      if (!detail) {
        return res.status(404).json({
          status: "error",
          message: "Installment agreement was not found in this store.",
        });
      }
      res.json({ status: "success", ...detail });
    } catch (error) {
      console.error("Installment detail error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not load the installment agreement.",
        request_id: req.requestId || null,
      });
    }
  }
);

router.post(
  "/agreements/:agreementId/approval",
  requirePermission("installments.manage"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    const decision = String(req.body?.decision || "").toLowerCase();
    const reason = cleanText(req.body?.reason, 500);

    if (!branchId) return;
    if (!agreementId || !["approve", "reject"].includes(decision)) {
      return res.status(400).json({
        status: "error",
        message: "Choose approve or reject for the installment agreement.",
      });
    }
    if (decision === "reject" && !reason) {
      return res.status(400).json({
        status: "error",
        message: "A rejection reason is required.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const agreement = await loadAgreement(connection, branchId, agreementId, true);

      if (!agreement) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "Agreement not found." });
      }

      if (agreement.approval_status !== "pending") {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "This agreement is not awaiting approval.",
        });
      }

      if (decision === "approve") {
        const deliverImmediately = agreement.delivery_policy === "immediate";

        await connection.query(
          `UPDATE installment_agreements
           SET approval_status = 'approved',
               agreement_status = 'active',
               approved_by = ?,
               approved_at = NOW(),
               delivery_status = CASE WHEN ? THEN 'delivered' ELSE delivery_status END,
               delivered_at = CASE WHEN ? THEN NOW() ELSE delivered_at END,
               delivered_by = CASE WHEN ? THEN ? ELSE delivered_by END
           WHERE id = ?`,
          [
            req.user.id,
            deliverImmediately ? 1 : 0,
            deliverImmediately ? 1 : 0,
            deliverImmediately ? 1 : 0,
            req.user.id,
            agreementId,
          ]
        );

        if (deliverImmediately) {
          await connection.query(
            `UPDATE installment_agreement_items
             SET reservation_status = 'delivered',
                 delivered_quantity = quantity,
                 delivered_at = NOW(),
                 delivered_by = ?
             WHERE agreement_id = ?`,
            [req.user.id, agreementId]
          );
        }
      } else {
        if (agreement.delivery_status === "reserved") {
          const [items] = await connection.query(
            `SELECT product_id, quantity
             FROM installment_agreement_items
             WHERE agreement_id = ?
             FOR UPDATE`,
            [agreementId]
          );

          for (const item of items) {
            await connection.query(
              `UPDATE products
               SET quantity = quantity + ?
               WHERE id = ? AND branch_id = ?`,
              [item.quantity, item.product_id, branchId]
            );
          }

          await connection.query(
            `UPDATE installment_agreement_items
             SET reservation_status = 'released'
             WHERE agreement_id = ?`,
            [agreementId]
          );
        }

        await connection.query(
          `UPDATE installment_agreements
           SET approval_status = 'rejected',
               agreement_status = 'cancelled',
               cancelled_by = ?,
               cancelled_at = NOW(),
               cancellation_reason = ?,
               delivery_status = CASE
                 WHEN delivery_status = 'reserved' THEN 'cancelled'
                 ELSE delivery_status
               END,
               next_due_date = NULL
           WHERE id = ?`,
          [req.user.id, reason, agreementId]
        );
        await connection.query(
          `UPDATE installment_schedule
           SET schedule_status = 'cancelled'
           WHERE agreement_id = ? AND schedule_status <> 'paid'`,
          [agreementId]
        );

        await cancelUnderlyingSaleAndDebt(connection, {
          agreement,
          userId: req.user.id,
          reason: `Installment approval rejected: ${reason}`,
        });
      }

      await writeAuditEvent({
        connection,
        req,
        branchId,
        workspaceCode: "spare_parts",
        action:
          decision === "approve"
            ? "INSTALLMENT_AGREEMENT_APPROVED"
            : "INSTALLMENT_AGREEMENT_REJECTED",
        actionType:
          decision === "approve"
            ? "INSTALLMENT_AGREEMENT_APPROVED"
            : "INSTALLMENT_AGREEMENT_REJECTED",
        entityType: "installment_agreement",
        entityId: agreementId,
        outcome: "success",
        severity: decision === "approve" ? "notice" : "warning",
        details: `${
          decision === "approve" ? "Approved" : "Rejected"
        } ${agreement.agreement_number}${reason ? `. Reason: ${reason}` : ""}`,
      });

      await connection.commit();
      res.json({
        status: "success",
        message:
          decision === "approve"
            ? "Installment agreement approved."
            : "Installment agreement rejected and reserved stock released.",
      });
    } catch (error) {
      await connection.rollback();
      console.error("Installment approval error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not complete the installment approval.",
        request_id: req.requestId || null,
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/agreements/:agreementId/payments",
  requirePermission("installments.collect"),
  validateRequest(validateInstallmentPaymentRequest),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const { agreementId } = req.validated.params;
    const {
      amount,
      payment_method: method,
      payment_reference: paymentReference,
      notes: paymentNotes,
      send_sms: sendSms,
    } = req.validated.body;

    if (!branchId) return;
    if (!agreementId || amount === null || amount <= 0 || !method) {
      return res.status(400).json({
        status: "error",
        message: "Agreement, positive payment amount and valid payment method are required.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const agreement = await loadAgreement(connection, branchId, agreementId, true);

      if (!agreement) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "Installment agreement was not found in this store.",
        });
      }

      if (
        ["pending_approval", "cancelled", "defaulted"].includes(
          agreement.agreement_status
        )
      ) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message:
            agreement.agreement_status === "pending_approval"
              ? "This agreement must be approved before payments are collected."
              : "Payments cannot be recorded on a cancelled or defaulted agreement.",
        });
      }

      if (amount > Number(agreement.outstanding_balance || 0) + 0.005) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message: `Payment exceeds the outstanding balance of GHS ${Number(
            agreement.outstanding_balance || 0
          ).toFixed(2)}.`,
        });
      }

      const temporaryReceipt = `PENDING-${crypto.randomUUID()}`;
      const [paymentResult] = await connection.query(
        `INSERT INTO installment_payments (
          branch_id, agreement_id, receipt_number, amount,
          payment_method, payment_reference, notes, received_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          agreementId,
          temporaryReceipt,
          amount,
          method,
          paymentReference,
          paymentNotes,
          req.user.id,
        ]
      );
      const receiptNumber = paymentReceiptNumber({
        branchId,
        branchCode: req.user?.branch_code,
        paymentId: paymentResult.insertId,
      });
      await connection.query(
        `UPDATE installment_payments SET receipt_number = ? WHERE id = ?`,
        [receiptNumber, paymentResult.insertId]
      );

      let remaining = amount;
      const [schedule] = await connection.query(
        `SELECT *
         FROM installment_schedule
         WHERE agreement_id = ?
           AND schedule_status NOT IN ('paid','cancelled','waived')
         ORDER BY sequence_number
         FOR UPDATE`,
        [agreementId]
      );

      for (const row of schedule) {
        if (remaining <= 0.005) break;
        const due =
          Number(row.scheduled_amount || 0) +
          Number(row.late_charge_amount || 0) -
          Number(row.waived_charge_amount || 0) -
          Number(row.amount_paid || 0);
        if (due <= 0.005) continue;
        const allocated = Number(Math.min(due, remaining).toFixed(2));

        await connection.query(
          `INSERT INTO installment_payment_allocations (
            payment_id, schedule_id, allocated_amount
          ) VALUES (?, ?, ?)`,
          [paymentResult.insertId, row.id, allocated]
        );
        await connection.query(
          `UPDATE installment_schedule
           SET amount_paid = amount_paid + ?
           WHERE id = ?`,
          [allocated, row.id]
        );
        remaining = Number((remaining - allocated).toFixed(2));
      }

      const refreshed = await refreshAgreementFinancials(connection, agreementId);

      await writeAuditEvent({
        connection,
        req,
        branchId,
        workspaceCode: "spare_parts",
        action: "INSTALLMENT_PAYMENT_RECORDED",
        actionType: "INSTALLMENT_PAYMENT_RECORDED",
        entityType: "installment_agreement",
        entityId: agreementId,
        outcome: "success",
        severity: "notice",
        details: `Recorded installment payment ${receiptNumber} of GHS ${amount.toFixed(
          2
        )} for ${agreement.agreement_number}.`,
        metadata: {
          agreement_number: agreement.agreement_number,
          payment_receipt: receiptNumber,
          payment_method: method,
          amount,
          remaining_balance: refreshed.outstanding_balance,
        },
      });

      await connection.commit();

      let sms = null;
      if (sendSms) {
        try {
          sms = await sendInstallmentEventSms({
            agreementId,
            branchId,
            type:
              refreshed.agreement_status === "completed"
                ? "completed"
                : "payment_receipt",
            details: {
              amount,
              receipt_number: receiptNumber,
              outstanding_balance: refreshed.outstanding_balance,
            },
            sentBy: req.user.id,
          });
        } catch (smsError) {
          sms = {
            success: false,
            status: "failed",
            error: smsError.message,
          };
        }
      }

      res.status(201).json({
        status: "success",
        message: "Installment payment recorded successfully.",
        payment: {
          id: paymentResult.insertId,
          receipt_number: receiptNumber,
          amount,
          payment_method: method,
        },
        agreement: refreshed,
        sms,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Record installment payment error:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Could not record the installment payment.",
        request_id: req.requestId || null,
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/agreements/:agreementId/payments/:paymentId/void",
  requirePermission("installments.manage"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    const paymentId = positiveInteger(req.params.paymentId);
    const reason = cleanText(req.body?.reason, 500);

    if (!branchId) return;
    if (!agreementId || !paymentId || !reason) {
      return res.status(400).json({
        status: "error",
        message: "Payment and correction reason are required.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const agreement = await loadAgreement(connection, branchId, agreementId, true);
      const [[payment]] = await connection.query(
        `SELECT *
         FROM installment_payments
         WHERE id = ? AND agreement_id = ? AND branch_id = ?
         FOR UPDATE`,
        [paymentId, agreementId, branchId]
      );

      if (!agreement || !payment) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "Installment payment was not found.",
        });
      }

      if (payment.is_voided) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "This payment has already been voided.",
        });
      }

      const [allocations] = await connection.query(
        `SELECT schedule_id, allocated_amount
         FROM installment_payment_allocations
         WHERE payment_id = ?
         FOR UPDATE`,
        [paymentId]
      );

      for (const allocation of allocations) {
        await connection.query(
          `UPDATE installment_schedule
           SET amount_paid = GREATEST(amount_paid - ?, 0),
               fully_paid_at = NULL
           WHERE id = ? AND agreement_id = ?`,
          [allocation.allocated_amount, allocation.schedule_id, agreementId]
        );
      }

      await connection.query(
        `UPDATE installment_payments
         SET is_voided = 1,
             void_reason = ?,
             voided_by = ?,
             voided_at = NOW()
         WHERE id = ?`,
        [reason, req.user.id, paymentId]
      );

      const refreshed = await refreshAgreementFinancials(connection, agreementId);

      await writeAuditEvent({
        connection,
        req,
        branchId,
        workspaceCode: "spare_parts",
        action: "INSTALLMENT_PAYMENT_VOIDED",
        actionType: "INSTALLMENT_PAYMENT_VOIDED",
        entityType: "installment_payment",
        entityId: paymentId,
        outcome: "success",
        severity: "critical",
        details: `Voided installment payment ${payment.receipt_number}. Reason: ${reason}`,
        metadata: {
          agreement_number: agreement.agreement_number,
          amount: payment.amount,
          outstanding_balance: refreshed.outstanding_balance,
        },
      });

      await connection.commit();
      res.json({
        status: "success",
        message: "Installment payment correction completed.",
        agreement: refreshed,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Void installment payment error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not void the installment payment.",
        request_id: req.requestId || null,
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/agreements/:agreementId/schedules/:scheduleId/waive-charge",
  requirePermission("installments.manage"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    const scheduleId = positiveInteger(req.params.scheduleId);
    const reason = cleanText(req.body?.reason, 500);
    const requestedAmount = money(req.body?.amount);

    if (!branchId) return;
    if (!agreementId || !scheduleId || !reason) {
      return res.status(400).json({
        status: "error",
        message: "Schedule and waiver reason are required.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const agreement = await loadAgreement(connection, branchId, agreementId, true);
      const [[schedule]] = await connection.query(
        `SELECT *
         FROM installment_schedule
         WHERE id = ? AND agreement_id = ?
         FOR UPDATE`,
        [scheduleId, agreementId]
      );

      if (!agreement || !schedule) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "Installment schedule was not found.",
        });
      }

      const remainingCharge = Math.max(
        Number(schedule.late_charge_amount || 0) -
          Number(schedule.waived_charge_amount || 0),
        0
      );
      const waiver =
        requestedAmount === null
          ? remainingCharge
          : Math.min(requestedAmount, remainingCharge);

      if (waiver <= 0.005) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "There is no remaining late charge to waive.",
        });
      }

      await connection.query(
        `UPDATE installment_schedule
         SET waived_charge_amount = waived_charge_amount + ?
         WHERE id = ?`,
        [waiver, scheduleId]
      );

      const refreshed = await refreshAgreementFinancials(connection, agreementId);

      await writeAuditEvent({
        connection,
        req,
        branchId,
        workspaceCode: "spare_parts",
        action: "INSTALLMENT_LATE_CHARGE_WAIVED",
        actionType: "INSTALLMENT_LATE_CHARGE_WAIVED",
        entityType: "installment_schedule",
        entityId: scheduleId,
        outcome: "success",
        severity: "warning",
        details: `Waived GHS ${waiver.toFixed(2)} late charge on ${
          agreement.agreement_number
        }. Reason: ${reason}`,
      });

      await connection.commit();
      res.json({
        status: "success",
        message: "Late charge waiver recorded.",
        agreement: refreshed,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Waive installment charge error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not waive the installment late charge.",
        request_id: req.requestId || null,
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/agreements/:agreementId/reschedule",
  requirePermission("installments.manage"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    const firstDueDate = dateOnly(req.body?.first_due_date);
    const installmentCount = positiveInteger(req.body?.installment_count);
    const frequency = String(req.body?.frequency || "").toLowerCase();
    const reason = cleanText(req.body?.reason, 500);

    if (!branchId) return;
    if (
      !agreementId ||
      !firstDueDate ||
      !installmentCount ||
      !["weekly", "fortnightly", "monthly", "custom"].includes(frequency) ||
      !reason
    ) {
      return res.status(400).json({
        status: "error",
        message: "A valid new schedule and rescheduling reason are required.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const agreement = await loadAgreement(connection, branchId, agreementId, true);

      if (!agreement) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "Installment agreement was not found.",
        });
      }

      if (["pending_approval", "completed", "cancelled", "defaulted"].includes(agreement.agreement_status)) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "This agreement can no longer be rescheduled.",
        });
      }

      const remainingBalance = Number(agreement.outstanding_balance || 0);
      const newSchedule = buildInstallmentSchedule({
        financedAmount: remainingBalance,
        installmentCount,
        firstDueDate,
        frequency,
        customDueDates: req.body?.custom_due_dates,
      });

      const [requestResult] = await connection.query(
        `INSERT INTO installment_reschedules (
          agreement_id, old_frequency, new_frequency,
          old_next_due_date, new_first_due_date,
          old_installment_count, new_installment_count,
          remaining_balance, reason, approval_status,
          requested_by, decided_by, decided_at, decision_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, NOW(), ?)`,
        [
          agreementId,
          agreement.payment_frequency,
          frequency,
          agreement.next_due_date,
          newSchedule[0].due_date,
          agreement.installment_count,
          installmentCount,
          remainingBalance,
          reason,
          req.user.id,
          req.user.id,
          "Approved during controlled rescheduling.",
        ]
      );

      await connection.query(
        `UPDATE installment_schedule
         SET schedule_status = 'cancelled'
         WHERE agreement_id = ?
           AND schedule_status NOT IN ('paid','waived')`,
        [agreementId]
      );

      for (const row of newSchedule) {
        const [[lastSequence]] = await connection.query(
          `SELECT COALESCE(MAX(sequence_number), 0) AS max_sequence
           FROM installment_schedule
           WHERE agreement_id = ?`,
          [agreementId]
        );

        await connection.query(
          `INSERT INTO installment_schedule (
            agreement_id, sequence_number, due_date, scheduled_amount,
            amount_paid, schedule_status
          ) VALUES (?, ?, ?, ?, 0, 'upcoming')`,
          [
            agreementId,
            Number(lastSequence.max_sequence || 0) + 1,
            row.due_date,
            row.scheduled_amount,
          ]
        );
      }

      await connection.query(
        `UPDATE installment_agreements
         SET payment_frequency = ?,
             installment_count = ?,
             first_due_date = ?,
             next_due_date = ?,
             final_due_date = ?,
             agreement_status = 'active'
         WHERE id = ?`,
        [
          frequency,
          installmentCount,
          newSchedule[0].due_date,
          newSchedule[0].due_date,
          newSchedule[newSchedule.length - 1].due_date,
          agreementId,
        ]
      );

      await refreshAgreementFinancials(connection, agreementId);

      await writeAuditEvent({
        connection,
        req,
        branchId,
        workspaceCode: "spare_parts",
        action: "INSTALLMENT_RESCHEDULED",
        actionType: "INSTALLMENT_RESCHEDULED",
        entityType: "installment_agreement",
        entityId: agreementId,
        outcome: "success",
        severity: "warning",
        details: `Rescheduled ${agreement.agreement_number}. Reason: ${reason}`,
        metadata: {
          reschedule_id: requestResult.insertId,
          old_next_due_date: agreement.next_due_date,
          new_first_due_date: newSchedule[0].due_date,
          installment_count: installmentCount,
          frequency,
        },
      });

      await connection.commit();

      let sms = null;
      if (req.body?.send_sms !== false) {
        try {
          sms = await sendInstallmentEventSms({
            agreementId,
            branchId,
            type: "rescheduled",
            details: {
              next_due_date: newSchedule[0].due_date,
              outstanding_balance: remainingBalance,
              event_key: requestResult.insertId,
            },
            sentBy: req.user.id,
          });
        } catch (smsError) {
          sms = {
            success: false,
            status: "failed",
            error: smsError.message,
          };
        }
      }

      res.json({
        status: "success",
        message: "Installment schedule updated successfully.",
        schedule: newSchedule,
        sms,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Reschedule installment error:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Could not reschedule the installment agreement.",
        request_id: req.requestId || null,
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/agreements/:agreementId/deliver",
  requirePermission("installments.manage"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    if (!branchId) return;

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const agreement = await loadAgreement(connection, branchId, agreementId, true);

      if (!agreement) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "Agreement not found." });
      }

      if (["pending_approval", "cancelled", "defaulted"].includes(agreement.agreement_status)) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "This agreement is not eligible for delivery.",
        });
      }

      if (agreement.delivery_status === "delivered") {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "Items for this agreement have already been delivered.",
        });
      }

      if (
        agreement.delivery_policy === "after_full_payment" &&
        Number(agreement.outstanding_balance || 0) > 0.005
      ) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "Full settlement is required before delivery.",
        });
      }

      await connection.query(
        `UPDATE installment_agreements
         SET delivery_status = 'delivered',
             delivered_at = NOW(),
             delivered_by = ?
         WHERE id = ?`,
        [req.user.id, agreementId]
      );
      await connection.query(
        `UPDATE installment_agreement_items
         SET reservation_status = 'delivered',
             delivered_quantity = quantity,
             delivered_at = NOW(),
             delivered_by = ?
         WHERE agreement_id = ?`,
        [req.user.id, agreementId]
      );

      await writeAuditEvent({
        connection,
        req,
        branchId,
        workspaceCode: "spare_parts",
        action: "INSTALLMENT_ITEMS_DELIVERED",
        actionType: "INSTALLMENT_ITEMS_DELIVERED",
        entityType: "installment_agreement",
        entityId: agreementId,
        outcome: "success",
        severity: "notice",
        details: `Delivered reserved items for ${agreement.agreement_number}.`,
      });

      await connection.commit();
      res.json({ status: "success", message: "Delivery recorded successfully." });
    } catch (error) {
      await connection.rollback();
      console.error("Installment delivery error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not record installment delivery.",
        request_id: req.requestId || null,
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/agreements/:agreementId/cancel",
  requirePermission("installments.manage"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    const reason = cleanText(req.body?.reason, 500);

    if (!branchId) return;
    if (!reason) {
      return res.status(400).json({
        status: "error",
        message: "A cancellation reason is required.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const agreement = await loadAgreement(connection, branchId, agreementId, true);

      if (!agreement) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "Agreement not found." });
      }

      if (agreement.agreement_status === "completed") {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "A completed agreement cannot be cancelled.",
        });
      }

      if (agreement.delivery_status !== "reserved") {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message:
            "Only undelivered reserved agreements can be cancelled here. Use the controlled Returns workflow for delivered items.",
        });
      }

      if (Number(agreement.amount_paid || 0) > 0.005) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message:
            "This agreement already contains a deposit or payment. Correct or refund the financial evidence before cancellation.",
        });
      }

      if (agreement.delivery_status === "reserved") {
        const [items] = await connection.query(
          `SELECT product_id, quantity
           FROM installment_agreement_items
           WHERE agreement_id = ?
           FOR UPDATE`,
          [agreementId]
        );

        for (const item of items) {
          await connection.query(
            `UPDATE products
             SET quantity = quantity + ?
             WHERE id = ? AND branch_id = ?`,
            [item.quantity, item.product_id, branchId]
          );
        }

        await connection.query(
          `UPDATE installment_agreement_items
           SET reservation_status = 'released'
           WHERE agreement_id = ?`,
          [agreementId]
        );
      }

      await connection.query(
        `UPDATE installment_agreements
         SET agreement_status = 'cancelled',
             delivery_status = CASE
               WHEN delivery_status = 'reserved' THEN 'cancelled'
               ELSE delivery_status
             END,
             cancelled_by = ?,
             cancelled_at = NOW(),
             cancellation_reason = ?,
             next_due_date = NULL
         WHERE id = ?`,
        [req.user.id, reason, agreementId]
      );
      await connection.query(
        `UPDATE installment_schedule
         SET schedule_status = 'cancelled'
         WHERE agreement_id = ? AND schedule_status <> 'paid'`,
        [agreementId]
      );

      await cancelUnderlyingSaleAndDebt(connection, {
        agreement,
        userId: req.user.id,
        reason: `Installment agreement cancelled: ${reason}`,
      });

      await writeAuditEvent({
        connection,
        req,
        branchId,
        workspaceCode: "spare_parts",
        action: "INSTALLMENT_CANCELLED",
        actionType: "INSTALLMENT_CANCELLED",
        entityType: "installment_agreement",
        entityId: agreementId,
        outcome: "success",
        severity: "warning",
        details: `Cancelled ${agreement.agreement_number}. Reason: ${reason}`,
      });

      await connection.commit();
      res.json({ status: "success", message: "Installment agreement cancelled." });
    } catch (error) {
      await connection.rollback();
      console.error("Cancel installment agreement error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not cancel the installment agreement.",
        request_id: req.requestId || null,
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/agreements/:agreementId/default-status",
  requirePermission("installments.manage"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    const action = String(req.body?.action || "").trim().toLowerCase();
    const reason = cleanText(req.body?.reason, 500);

    if (!branchId) return;
    if (!agreementId || !["mark_defaulted", "reactivate"].includes(action) || !reason) {
      return res.status(400).json({
        status: "error",
        message: "Choose a valid default action and enter a reason.",
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const agreement = await loadAgreement(connection, branchId, agreementId, true);
      if (!agreement) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "Agreement not found." });
      }

      if (["pending_approval", "completed", "cancelled"].includes(agreement.agreement_status)) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "Completed or cancelled agreements cannot change default status.",
        });
      }

      if (action === "mark_defaulted") {
        await connection.query(
          `UPDATE installment_agreements
           SET agreement_status = 'defaulted', next_due_date = NULL
           WHERE id = ?`,
          [agreementId]
        );
      } else {
        await connection.query(
          `UPDATE installment_agreements SET agreement_status = 'active' WHERE id = ?`,
          [agreementId]
        );
        await refreshAgreementFinancials(connection, agreementId);
      }

      await writeAuditEvent({
        connection,
        req,
        branchId,
        workspaceCode: "spare_parts",
        action: action === "mark_defaulted"
          ? "INSTALLMENT_MARKED_DEFAULTED"
          : "INSTALLMENT_REACTIVATED",
        actionType: action === "mark_defaulted"
          ? "INSTALLMENT_MARKED_DEFAULTED"
          : "INSTALLMENT_REACTIVATED",
        entityType: "installment_agreement",
        entityId: agreementId,
        outcome: "success",
        severity: action === "mark_defaulted" ? "critical" : "warning",
        details: `${agreement.agreement_number}: ${reason}`,
      });

      await connection.commit();
      res.json({
        status: "success",
        message: action === "mark_defaulted"
          ? "Agreement marked as defaulted."
          : "Agreement reactivated and financial status recalculated.",
      });
    } catch (error) {
      await connection.rollback();
      console.error("Installment default status error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not update the installment default status.",
        request_id: req.requestId || null,
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/agreements/:agreementId/reminders",
  requirePermission("installments.remind"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    const reminderType = String(req.body?.reminder_type || "manual").toLowerCase();

    if (!branchId) return;

    try {
      const detail = await loadAgreementDetail(pool, branchId, agreementId);
      if (!detail) {
        return res.status(404).json({ status: "error", message: "Agreement not found." });
      }

      const { agreement } = detail;
      const phone = normalizeGhanaPhone(agreement.customer_phone);
      if (!phone) {
        return res.status(400).json({
          status: "error",
          message: "The customer does not have a valid Ghana phone number.",
        });
      }

      const nextAmount = detail.schedule.find((row) => row.schedule_status !== "paid");
      const message = cleanText(req.body?.message, 480) ||
        `CHALIN03: ${agreement.customer_name}, installment ${agreement.agreement_number} has GHS ${Number(
          agreement.outstanding_balance || 0
        ).toFixed(2)} outstanding. Next payment GHS ${Number(
          nextAmount
            ? Number(nextAmount.scheduled_amount || 0) -
                Number(nextAmount.amount_paid || 0)
            : agreement.outstanding_balance || 0
        ).toFixed(2)} is due ${agreement.next_due_date || "now"}. Thank you.`;

      let result;
      let status = "failed";
      let statusReason = null;

      try {
        result = await sendSms({ to: phone, message });
        status = result.status || "delivery_unknown";
      } catch (error) {
        statusReason = error.message;
        result = {
          success: false,
          provider: getSmsConfig().provider,
          senderId: getSmsConfig().senderId,
          providerMessageId: null,
          providerStatus: null,
          providerResponse: { error: error.message },
          segmentCount: 1,
          estimatedCredits: 1,
          submittedAt: null,
        };
      }

      const [smsLogResult] = await pool.query(
        `INSERT INTO sms_log (
          branch_id, recipient_phone, message, sms_type, status,
          provider, sender_id, provider_message_id, provider_status,
          status_reason, segment_count, estimated_credits,
          source_reference, provider_response, sent_by,
          sent_at, submitted_at, last_status_at
        ) VALUES (?, ?, ?, 'other', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          branchId,
          phone,
          message,
          status,
          result.provider || null,
          result.senderId || null,
          result.providerMessageId || null,
          result.providerStatus || null,
          statusReason,
          Math.max(Number(result.segmentCount || 1), 1),
          Math.max(Number(result.estimatedCredits || 1), 0),
          `installment:${agreementId}:${reminderType}`,
          safeJson(result.providerResponse),
          req.user.id,
          result.submittedAt ? new Date(result.submittedAt) : null,
          result.submittedAt ? new Date(result.submittedAt) : null,
        ]
      );

      await pool.query(
        `INSERT INTO installment_reminder_log (
          branch_id, agreement_id, reminder_key, reminder_type, recipient_phone,
          sms_log_id, delivery_status, message_preview, sent_by, sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          agreementId,
          `manual:${agreementId}:${Date.now()}:${req.user.id}`,
          [
            "agreement_created",
            "due_soon",
            "due_today",
            "overdue",
            "payment_receipt",
            "rescheduled",
            "completed",
            "manual",
          ].includes(reminderType)
            ? reminderType
            : "manual",
          phone,
          smsLogResult.insertId,
          status,
          message.slice(0, 500),
          req.user.id,
          result.submittedAt ? new Date(result.submittedAt) : null,
        ]
      );

      await writeAuditEvent({
        req,
        branchId,
        workspaceCode: "spare_parts",
        action: "INSTALLMENT_REMINDER_SENT",
        actionType: "INSTALLMENT_REMINDER_SENT",
        entityType: "installment_agreement",
        entityId: agreementId,
        outcome: result.success ? "success" : "failed",
        severity: result.success ? "notice" : "warning",
        details: `Installment reminder for ${agreement.agreement_number} recorded as ${status}.`,
        metadata: {
          sms_log_id: smsLogResult.insertId,
          reminder_type: reminderType,
          provider: result.provider,
          provider_status: result.providerStatus,
        },
      });

      res.status(result.success ? 201 : 502).json({
        status: result.success ? "success" : "error",
        message: result.success
          ? "Installment reminder submitted to the SMS provider."
          : statusReason || "Installment reminder could not be submitted.",
        sms_status: status,
        provider_status: result.providerStatus || null,
        sms_log_id: smsLogResult.insertId,
      });
    } catch (error) {
      console.error("Installment reminder error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not send the installment reminder.",
        request_id: req.requestId || null,
      });
    }
  }
);

router.get(
  "/agreements/:agreementId/agreement.pdf",
  requireAnyPermission("installments.view", "installments.export"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    if (!branchId) return;

    try {
      const detail = await loadAgreementDetail(pool, branchId, agreementId);
      if (!detail) {
        return res.status(404).json({ status: "error", message: "Agreement not found." });
      }

      const { agreement, items, schedule } = detail;
      const doc = new PDFDocument({ margin: 45, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${agreement.agreement_number}-agreement.pdf"`
      );
      doc.pipe(res);

      doc.fontSize(18).font("Helvetica-Bold").text("CHALIN 03 COMPANY LIMITED");
      doc.fontSize(12).font("Helvetica").text("Professional Installment Agreement");
      doc.moveDown();
      doc.fontSize(11).text(`Agreement: ${agreement.agreement_number}`);
      doc.text(`Sale receipt: ${agreement.receipt_number}`);
      doc.text(`Customer: ${agreement.customer_name}`);
      doc.text(`Phone: ${agreement.customer_phone}`);
      doc.text(`Location: ${agreement.customer_location || "-"}`);
      doc.text(`Status: ${String(agreement.agreement_status).replaceAll("_", " ")}`);
      doc.moveDown();

      doc.font("Helvetica-Bold").text("Financial Terms");
      doc.font("Helvetica");
      doc.text(`Sale total: GHS ${Number(agreement.sale_total || 0).toFixed(2)}`);
      doc.text(`Deposit: GHS ${Number(agreement.deposit_amount || 0).toFixed(2)}`);
      doc.text(`Financed amount: GHS ${Number(agreement.financed_amount || 0).toFixed(2)}`);
      doc.text(`Frequency: ${agreement.payment_frequency}`);
      doc.text(`Number of payments: ${agreement.installment_count}`);
      doc.text(`First due date: ${agreement.first_due_date}`);
      doc.text(`Final due date: ${agreement.final_due_date || "-"}`);
      doc.text(`Grace period: ${agreement.grace_days} day(s)`);
      doc.text(`Delivery policy: ${String(agreement.delivery_policy).replaceAll("_", " ")}`);
      doc.moveDown();

      doc.font("Helvetica-Bold").text("Items");
      doc.font("Helvetica");
      for (const item of items) {
        doc.text(
          `${item.product_name} — ${item.quantity} × GHS ${Number(
            item.unit_price || 0
          ).toFixed(2)} = GHS ${Number(item.line_total || 0).toFixed(2)}`
        );
      }
      doc.moveDown();

      doc.font("Helvetica-Bold").text("Payment Schedule");
      doc.font("Helvetica");
      for (const row of schedule) {
        doc.text(
          `${row.sequence_number}. ${row.due_date} — GHS ${Number(
            row.scheduled_amount || 0
          ).toFixed(2)} — ${row.schedule_status}`
        );
      }
      doc.moveDown();

      if (agreement.guarantor_name) {
        doc.font("Helvetica-Bold").text("Guarantor / Reference");
        doc.font("Helvetica").text(
          `${agreement.guarantor_name} · ${agreement.guarantor_phone || "-"} · ${
            agreement.guarantor_location || "-"
          }`
        );
        doc.moveDown();
      }

      if (agreement.agreement_notes) {
        doc.font("Helvetica-Bold").text("Special Terms / Notes");
        doc.font("Helvetica").text(agreement.agreement_notes);
        doc.moveDown();
      }

      doc
        .fontSize(9)
        .fillColor("#555555")
        .text(
          "This system document preserves the agreed schedule and payment evidence. Corrections, rescheduling, delivery and cancellation must be recorded through controlled Chalin 03 actions.",
          { align: "justify" }
        );
      doc.moveDown(2);
      doc.fillColor("#000000").fontSize(10);
      doc.text("Customer Signature: ______________________________");
      doc.moveDown();
      doc.text("Authorized Staff: _________________________________");
      doc.moveDown();
      doc.text(`Generated: ${new Date().toLocaleString("en-GB")}`);
      doc.end();
    } catch (error) {
      console.error("Installment agreement PDF error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          status: "error",
          message: "Could not generate the installment agreement PDF.",
        });
      } else {
        res.end();
      }
    }
  }
);

router.get(
  "/agreements/:agreementId/payments/:paymentId/receipt.pdf",
  requireAnyPermission("installments.view", "installments.export", "installments.collect"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    const paymentId = positiveInteger(req.params.paymentId);
    if (!branchId) return;

    try {
      const [[row]] = await pool.query(
        `SELECT
          ip.*,
          ia.agreement_number,
          ia.customer_name,
          ia.customer_phone,
          ia.outstanding_balance,
          u.full_name AS received_by_name,
          b.name AS branch_name,
          b.location AS branch_location
         FROM installment_payments ip
         INNER JOIN installment_agreements ia ON ia.id = ip.agreement_id
         INNER JOIN branches b ON b.id = ip.branch_id
         LEFT JOIN users u ON u.id = ip.received_by
         WHERE ip.id = ? AND ip.agreement_id = ? AND ip.branch_id = ?
         LIMIT 1`,
        [paymentId, agreementId, branchId]
      );

      if (!row) {
        return res.status(404).json({
          status: "error",
          message: "Installment payment receipt was not found.",
        });
      }

      const doc = new PDFDocument({ margin: 50, size: "A5" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${row.receipt_number}.pdf"`
      );
      doc.pipe(res);

      doc.fontSize(17).font("Helvetica-Bold").text("CHALIN 03 COMPANY LIMITED", {
        align: "center",
      });
      doc.fontSize(10).font("Helvetica").text(row.branch_name || "Spare Parts", {
        align: "center",
      });
      doc.text(row.branch_location || "Dunkwa Police Barrier", { align: "center" });
      doc.moveDown();
      doc.fontSize(14).font("Helvetica-Bold").text("INSTALLMENT PAYMENT RECEIPT", {
        align: "center",
      });
      doc.moveDown();
      doc.fontSize(10).font("Helvetica");
      doc.text(`Receipt: ${row.receipt_number}`);
      doc.text(`Agreement: ${row.agreement_number}`);
      doc.text(`Customer: ${row.customer_name}`);
      doc.text(`Phone: ${row.customer_phone}`);
      doc.text(`Date: ${new Date(row.paid_at).toLocaleString("en-GB")}`);
      doc.text(`Payment method: ${row.payment_method}`);
      if (row.payment_reference) doc.text(`Reference: ${row.payment_reference}`);
      doc.moveDown();
      doc
        .fontSize(18)
        .font("Helvetica-Bold")
        .text(`AMOUNT PAID: GHS ${Number(row.amount || 0).toFixed(2)}`, {
          align: "center",
        });
      doc.moveDown();
      doc
        .fontSize(11)
        .font("Helvetica")
        .text(`Current agreement balance: GHS ${Number(row.outstanding_balance || 0).toFixed(2)}`);
      doc.text(`Received by: ${row.received_by_name || "System"}`);
      if (row.notes) doc.text(`Notes: ${row.notes}`);
      if (row.is_voided) {
        doc.moveDown();
        doc.fillColor("#b91c1c").font("Helvetica-Bold").text("VOIDED PAYMENT");
        doc.font("Helvetica").text(row.void_reason || "");
      }
      doc.moveDown(2);
      doc.fillColor("#000000").fontSize(9).text(
        "Thank you. Keep this receipt as proof of payment.",
        { align: "center" }
      );
      doc.end();
    } catch (error) {
      console.error("Installment payment receipt PDF error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          status: "error",
          message: "Could not generate the installment payment receipt.",
        });
      } else {
        res.end();
      }
    }
  }
);

router.get(
  "/agreements/:agreementId/statement.csv",
  requirePermission("installments.export"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    const agreementId = positiveInteger(req.params.agreementId);
    if (!branchId) return;

    try {
      const detail = await loadAgreementDetail(pool, branchId, agreementId);
      if (!detail) {
        return res.status(404).json({ status: "error", message: "Agreement not found." });
      }

      const rows = [
        ["Agreement", detail.agreement.agreement_number],
        ["Customer", detail.agreement.customer_name],
        ["Phone", detail.agreement.customer_phone],
        ["Sale Total", detail.agreement.sale_total],
        ["Amount Paid", detail.agreement.amount_paid],
        ["Outstanding", detail.agreement.outstanding_balance],
        [],
        ["Installment", "Due Date", "Scheduled", "Paid", "Status"],
        ...detail.schedule.map((row) => [
          row.sequence_number,
          row.due_date,
          row.scheduled_amount,
          row.amount_paid,
          row.schedule_status,
        ]),
        [],
        ["Payment Receipt", "Paid At", "Method", "Amount", "Received By"],
        ...detail.payments.map((row) => [
          row.receipt_number,
          row.paid_at,
          row.payment_method,
          row.amount,
          row.received_by_name || "",
        ]),
      ];

      const csv = rows
        .map((row) =>
          row
            .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
            .join(",")
        )
        .join("\r\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${detail.agreement.agreement_number}-statement.csv"`
      );
      res.send(`\uFEFF${csv}`);
    } catch (error) {
      console.error("Installment statement export error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not export the installment statement.",
      });
    }
  }
);

router.get(
  "/reports/workbook.xlsx",
  requirePermission("installments.export"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    if (!branchId) return;

    try {
      const [agreements] = await pool.query(
        `SELECT
          agreement_number, customer_name, customer_phone, agreement_status,
          sale_total, deposit_amount, amount_paid, outstanding_balance,
          overdue_amount, payment_frequency, installment_count,
          first_due_date, next_due_date, final_due_date,
          delivery_policy, delivery_status, created_at
         FROM installment_agreements
         WHERE branch_id = ?
         ORDER BY created_at DESC`,
        [branchId]
      );

      const [payments] = await pool.query(
        `SELECT
          ia.agreement_number,
          ia.customer_name,
          ip.receipt_number,
          ip.amount,
          ip.payment_method,
          ip.payment_reference,
          ip.paid_at,
          u.full_name AS received_by
         FROM installment_payments ip
         INNER JOIN installment_agreements ia ON ia.id = ip.agreement_id
         LEFT JOIN users u ON u.id = ip.received_by
         WHERE ip.branch_id = ? AND ip.is_voided = 0
         ORDER BY ip.paid_at DESC`,
        [branchId]
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 Company Limited";
      workbook.created = new Date();

      const agreementSheet = workbook.addWorksheet("Agreements");
      agreementSheet.columns = [
        ["Agreement", "agreement_number", 24],
        ["Customer", "customer_name", 24],
        ["Phone", "customer_phone", 18],
        ["Status", "agreement_status", 18],
        ["Sale Total", "sale_total", 15],
        ["Deposit", "deposit_amount", 15],
        ["Paid", "amount_paid", 15],
        ["Outstanding", "outstanding_balance", 15],
        ["Overdue", "overdue_amount", 15],
        ["Frequency", "payment_frequency", 14],
        ["Count", "installment_count", 10],
        ["First Due", "first_due_date", 14],
        ["Next Due", "next_due_date", 14],
        ["Final Due", "final_due_date", 14],
        ["Delivery Policy", "delivery_policy", 18],
        ["Delivery Status", "delivery_status", 18],
        ["Created", "created_at", 20],
      ].map(([header, key, width]) => ({ header, key, width }));
      agreementSheet.addRows(agreements);
      agreementSheet.getRow(1).font = { bold: true };
      agreementSheet.views = [{ state: "frozen", ySplit: 1 }];
      agreementSheet.autoFilter = "A1:Q1";

      const paymentSheet = workbook.addWorksheet("Collections");
      paymentSheet.columns = [
        ["Agreement", "agreement_number", 24],
        ["Customer", "customer_name", 24],
        ["Receipt", "receipt_number", 22],
        ["Amount", "amount", 15],
        ["Method", "payment_method", 14],
        ["Reference", "payment_reference", 20],
        ["Paid At", "paid_at", 20],
        ["Received By", "received_by", 22],
      ].map(([header, key, width]) => ({ header, key, width }));
      paymentSheet.addRows(payments);
      paymentSheet.getRow(1).font = { bold: true };
      paymentSheet.views = [{ state: "frozen", ySplit: 1 }];
      paymentSheet.autoFilter = "A1:H1";

      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="Chalin03-Installment-Workbook-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx"`
      );
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Installment workbook error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not generate the installment workbook.",
      });
    }
  }
);

router.post(
  "/reminders/sync",
  requirePermission("installments.remind"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    if (!branchId) return;

    try {
      const result = await runInstallmentReminderSync({ branchId });
      await writeAuditEvent({
        req,
        branchId,
        workspaceCode: "spare_parts",
        action: "INSTALLMENT_REMINDER_SYNC",
        actionType: "INSTALLMENT_REMINDER_SYNC",
        entityType: "installment_reminders",
        entityId: branchId,
        outcome: result.failed > 0 ? "partial" : "success",
        severity: result.failed > 0 ? "warning" : "notice",
        details: `Installment reminder sync checked ${result.checked}, sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}.`,
        metadata: result,
      });
      res.json({
        status: "success",
        message: "Installment reminder synchronization completed.",
        result,
      });
    } catch (error) {
      console.error("Installment reminder sync error:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Could not synchronize installment reminders.",
        request_id: req.requestId || null,
      });
    }
  }
);

router.get(
  "/settings",
  requireAnyPermission("installments.view", "installments.manage"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    if (!branchId) return;

    try {
      const [rows] = await pool.query(
        `SELECT * FROM installment_settings WHERE branch_id = ? LIMIT 1`,
        [branchId]
      );
      res.json({ status: "success", settings: rows[0] || null });
    } catch (error) {
      res.status(500).json({ status: "error", message: "Could not load installment settings." });
    }
  }
);

router.put(
  "/settings",
  requirePermission("installments.settings"),
  async (req, res) => {
    const branchId = requireBranch(req, res);
    if (!branchId) return;

    const frequency = ["weekly", "fortnightly", "monthly", "custom"].includes(
      String(req.body?.default_frequency || "")
    )
      ? String(req.body.default_frequency)
      : "monthly";
    const count = Math.max(1, Math.min(positiveInteger(req.body?.default_installment_count, 3), 120));
    const grace = Math.max(0, Math.min(Number(req.body?.default_grace_days || 0), 60));
    const before = Math.max(0, Math.min(Number(req.body?.reminder_days_before || 3), 30));
    const lateType = ["none", "fixed", "percentage"].includes(
      String(req.body?.late_charge_type || "")
    )
      ? String(req.body.late_charge_type)
      : "none";
    const lateValue = money(req.body?.late_charge_value || 0) ?? 0;
    const deliveryPolicy = ["immediate", "after_full_payment"].includes(
      String(req.body?.default_delivery_policy || "")
    )
      ? String(req.body.default_delivery_policy)
      : "immediate";

    try {
      await pool.query(
        `INSERT INTO installment_settings (
          branch_id, default_frequency, default_installment_count,
          default_grace_days, reminder_days_before, overdue_reminder_days,
          late_charge_type, late_charge_value, require_manager_approval,
          default_delivery_policy, sms_reminders_enabled, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          default_frequency = VALUES(default_frequency),
          default_installment_count = VALUES(default_installment_count),
          default_grace_days = VALUES(default_grace_days),
          reminder_days_before = VALUES(reminder_days_before),
          overdue_reminder_days = VALUES(overdue_reminder_days),
          late_charge_type = VALUES(late_charge_type),
          late_charge_value = VALUES(late_charge_value),
          require_manager_approval = VALUES(require_manager_approval),
          default_delivery_policy = VALUES(default_delivery_policy),
          sms_reminders_enabled = VALUES(sms_reminders_enabled),
          updated_by = VALUES(updated_by)`,
        [
          branchId,
          frequency,
          count,
          grace,
          before,
          cleanOverdueReminderDays(req.body?.overdue_reminder_days),
          lateType,
          lateValue,
          Boolean(req.body?.require_manager_approval),
          deliveryPolicy,
          req.body?.sms_reminders_enabled !== false,
          req.user.id,
          req.user.id,
        ]
      );

      await writeAuditEvent({
        req,
        branchId,
        workspaceCode: "spare_parts",
        action: "INSTALLMENT_SETTINGS_UPDATED",
        actionType: "INSTALLMENT_SETTINGS_UPDATED",
        entityType: "installment_settings",
        entityId: branchId,
        outcome: "success",
        severity: "warning",
        details: "Updated branch installment-sale controls.",
        metadata: {
          frequency,
          count,
          grace,
          before,
          lateType,
          lateValue,
          deliveryPolicy,
          overdueReminderDays: cleanOverdueReminderDays(
            req.body?.overdue_reminder_days
          ),
          requireManagerApproval: Boolean(req.body?.require_manager_approval),
          smsRemindersEnabled: req.body?.sms_reminders_enabled !== false,
        },
      });

      res.json({ status: "success", message: "Installment settings updated." });
    } catch (error) {
      console.error("Installment settings update error:", error);
      res.status(500).json({
        status: "error",
        message: "Could not update installment settings.",
      });
    }
  }
);

module.exports = router;
