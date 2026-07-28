const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

router.use(requireAuth);

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function getBranchId(req) {
  return positiveId(req.user?.branch_id || req.user?.default_branch_id);
}

function roundMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function customerSummary(rows) {
  return rows.reduce(
    (summary, row) => {
      summary.customer_count += 1;
      summary.debt_record_count += Number(row.debt_count || 0);
      summary.active_debt_count += Number(row.active_debt_count || 0);
      summary.overdue_debt_count += Number(row.overdue_count || 0);
      summary.total_owed += Number(row.total_owed || 0);
      summary.total_paid += Number(row.total_paid || 0);
      summary.outstanding_balance += Number(row.outstanding_balance || 0);
      return summary;
    },
    {
      customer_count: 0,
      debt_record_count: 0,
      active_debt_count: 0,
      overdue_debt_count: 0,
      total_owed: 0,
      total_paid: 0,
      outstanding_balance: 0,
    }
  );
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

router.get("/", async (req, res) => {
  try {
    const branchId = getBranchId(req);
    if (!branchId) {
      return res.status(400).json({
        status: "error",
        message: "No store is selected for this session.",
      });
    }

    const includePaid = String(req.query.include_paid || "").toLowerCase() === "true";
    const [customers] = await pool.query(
      `SELECT
         c.id AS customer_id,
         c.name AS customer_name,
         c.phone AS customer_phone,
         c.location AS customer_location,
         COUNT(d.id) AS debt_count,
         SUM(CASE WHEN d.balance > 0 THEN 1 ELSE 0 END) AS active_debt_count,
         SUM(CASE
               WHEN d.balance > 0
                AND d.due_date IS NOT NULL
                AND d.due_date < CURRENT_DATE
               THEN 1 ELSE 0
             END) AS overdue_count,
         COALESCE(SUM(d.amount_owed), 0) AS total_owed,
         COALESCE(SUM(d.amount_paid), 0) AS total_paid,
         COALESCE(SUM(d.balance), 0) AS outstanding_balance,
         MIN(d.created_at) AS first_debt_date,
         MAX(d.created_at) AS last_debt_date,
         MIN(CASE WHEN d.balance > 0 THEN d.due_date END) AS next_due_date
       FROM customers c
       INNER JOIN debts d
         ON d.customer_id = c.id
        AND d.branch_id = c.branch_id
       WHERE c.branch_id = ?
       GROUP BY c.id, c.name, c.phone, c.location
       HAVING (? = 1 OR SUM(CASE WHEN d.balance > 0 THEN 1 ELSE 0 END) > 0)
       ORDER BY outstanding_balance DESC, c.name ASC
       LIMIT 500`,
      [branchId, includePaid ? 1 : 0]
    );

    const [unlinkedRows] = await pool.query(
      `SELECT
         COUNT(*) AS debt_count,
         COALESCE(SUM(balance), 0) AS outstanding_balance
       FROM debts
       WHERE branch_id = ?
         AND customer_id IS NULL
         AND balance > 0`,
      [branchId]
    );

    const summary = customerSummary(customers);
    Object.keys(summary).forEach((key) => {
      if (key.includes("total") || key.includes("balance")) {
        summary[key] = roundMoney(summary[key]);
      }
    });

    return res.json({
      status: "success",
      branch_id: branchId,
      summary,
      unlinked: {
        debt_count: Number(unlinkedRows[0]?.debt_count || 0),
        outstanding_balance: roundMoney(unlinkedRows[0]?.outstanding_balance),
      },
      customers,
    });
  } catch (error) {
    console.error("Customer debt consolidation summary error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load the consolidated customer debt view.",
    });
  }
});

router.get("/:customerId", async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const customerId = positiveId(req.params.customerId);

    if (!branchId || !customerId) {
      return res.status(400).json({
        status: "error",
        message: "A valid store and customer are required.",
      });
    }

    const [customers] = await pool.query(
      `SELECT id, branch_id, name, phone, location, created_at, updated_at
       FROM customers
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [customerId, branchId]
    );

    if (!customers[0]) {
      return res.status(404).json({
        status: "error",
        message: "Customer was not found in the selected store.",
      });
    }

    const [debts] = await pool.query(
      `SELECT
         d.id,
         d.sale_id,
         d.customer_id,
         d.customer_name,
         d.customer_phone,
         d.amount_owed,
         d.amount_paid,
         d.balance,
         d.status,
         d.due_date,
         d.created_at,
         d.updated_at,
         s.receipt_number,
         s.total AS sale_total,
         s.payment_type,
         s.amount_tendered,
         s.amount_paid AS sale_amount_paid,
         s.balance AS sale_balance,
         s.created_at AS sale_date,
         u.full_name AS staff_name
       FROM debts d
       LEFT JOIN sales s
         ON s.id = d.sale_id
        AND s.branch_id = d.branch_id
       LEFT JOIN users u
         ON u.id = s.staff_id
       WHERE d.branch_id = ?
         AND d.customer_id = ?
       ORDER BY d.created_at DESC, d.id DESC`,
      [branchId, customerId]
    );

    const saleIds = [...new Set(debts.map((row) => positiveId(row.sale_id)).filter(Boolean))];
    const debtIds = debts.map((row) => positiveId(row.id)).filter(Boolean);
    let items = [];
    let payments = [];

    if (saleIds.length > 0) {
      const placeholders = saleIds.map(() => "?").join(",");
      const [rows] = await pool.query(
        `SELECT
           id,
           sale_id,
           product_id,
           product_name,
           quantity,
           unit_price,
           line_total
         FROM sale_items
         WHERE sale_id IN (${placeholders})
         ORDER BY sale_id ASC, id ASC`,
        saleIds
      );
      items = rows;
    }

    if (debtIds.length > 0) {
      const placeholders = debtIds.map(() => "?").join(",");
      const [rows] = await pool.query(
        `SELECT
           dp.id,
           dp.debt_id,
           dp.amount,
           dp.payment_method,
           dp.paid_at,
           dp.notes,
           u.full_name AS received_by_name
         FROM debt_payments dp
         LEFT JOIN users u ON u.id = dp.received_by
         WHERE dp.branch_id = ?
           AND dp.debt_id IN (${placeholders})
         ORDER BY dp.paid_at DESC, dp.id DESC`,
        [branchId, ...debtIds]
      );
      payments = rows;
    }

    const itemsBySale = new Map();
    items.forEach((item) => {
      const saleId = Number(item.sale_id);
      if (!itemsBySale.has(saleId)) itemsBySale.set(saleId, []);
      itemsBySale.get(saleId).push(item);
    });

    const paymentsByDebt = new Map();
    payments.forEach((payment) => {
      const debtId = Number(payment.debt_id);
      if (!paymentsByDebt.has(debtId)) paymentsByDebt.set(debtId, []);
      paymentsByDebt.get(debtId).push(payment);
    });

    const debtBreakdown = debts.map((debt) => ({
      ...debt,
      items: itemsBySale.get(Number(debt.sale_id)) || [],
      payments: paymentsByDebt.get(Number(debt.id)) || [],
    }));

    const summary = debtBreakdown.reduce(
      (result, debt) => {
        result.debt_count += 1;
        if (Number(debt.balance || 0) > 0) result.active_debt_count += 1;
        if (
          Number(debt.balance || 0) > 0 &&
          debt.due_date &&
          new Date(`${debt.due_date}T23:59:59Z`) < new Date()
        ) {
          result.overdue_debt_count += 1;
        }
        result.total_owed += Number(debt.amount_owed || 0);
        result.total_paid += Number(debt.amount_paid || 0);
        result.outstanding_balance += Number(debt.balance || 0);
        return result;
      },
      {
        debt_count: 0,
        active_debt_count: 0,
        overdue_debt_count: 0,
        total_owed: 0,
        total_paid: 0,
        outstanding_balance: 0,
      }
    );

    summary.total_owed = roundMoney(summary.total_owed);
    summary.total_paid = roundMoney(summary.total_paid);
    summary.outstanding_balance = roundMoney(summary.outstanding_balance);

    return res.json({
      status: "success",
      branch_id: branchId,
      customer: customers[0],
      summary,
      debts: debtBreakdown,
    });
  } catch (error) {
    console.error("Customer debt consolidation detail error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load the customer's debt breakdown.",
    });
  }
});

router.post(
  "/merge",
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const branchId = getBranchId(req);
      const targetCustomerId = positiveId(req.body?.target_customer_id);
      const sourceCustomerIds = [
        ...new Set(
          (Array.isArray(req.body?.source_customer_ids)
            ? req.body.source_customer_ids
            : []
          )
            .map(positiveId)
            .filter((id) => id && id !== targetCustomerId)
        ),
      ];
      const reason = cleanText(req.body?.reason, 500);
      const confirmation = cleanText(req.body?.confirmation, 20).toUpperCase();

      if (!branchId || !targetCustomerId || sourceCustomerIds.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "Choose one master customer and at least one duplicate customer.",
        });
      }

      if (sourceCustomerIds.length > 25) {
        return res.status(400).json({
          status: "error",
          message: "Merge no more than 25 duplicate customer records at a time.",
        });
      }

      if (reason.length < 5) {
        return res.status(400).json({
          status: "error",
          message: "Enter a clear reason for merging these customer records.",
        });
      }

      if (confirmation !== "MERGE") {
        return res.status(400).json({
          status: "error",
          message: "Type MERGE to confirm this customer consolidation.",
        });
      }

      await connection.beginTransaction();

      const customerIds = [targetCustomerId, ...sourceCustomerIds];
      const placeholders = customerIds.map(() => "?").join(",");
      const [customers] = await connection.query(
        `SELECT id, branch_id, name, phone, location
         FROM customers
         WHERE branch_id = ?
           AND id IN (${placeholders})
         ORDER BY id
         FOR UPDATE`,
        [branchId, ...customerIds]
      );

      if (customers.length !== customerIds.length) {
        const error = new Error(
          "One or more selected customer records were not found in this store."
        );
        error.statusCode = 404;
        throw error;
      }

      const targetCustomer = customers.find(
        (customer) => Number(customer.id) === Number(targetCustomerId)
      );
      const sourceCustomers = customers.filter(
        (customer) => Number(customer.id) !== Number(targetCustomerId)
      );
      const sourcePlaceholders = sourceCustomerIds.map(() => "?").join(",");

      const [salesResult] = await connection.query(
        `UPDATE sales
         SET customer_id = ?
         WHERE branch_id = ?
           AND customer_id IN (${sourcePlaceholders})`,
        [targetCustomerId, branchId, ...sourceCustomerIds]
      );

      const [debtsResult] = await connection.query(
        `UPDATE debts
         SET customer_id = ?
         WHERE branch_id = ?
           AND customer_id IN (${sourcePlaceholders})`,
        [targetCustomerId, branchId, ...sourceCustomerIds]
      );

      let installmentAgreementsUpdated = 0;
      if (await tableExists(connection, "installment_agreements")) {
        const [installmentResult] = await connection.query(
          `UPDATE installment_agreements
           SET customer_id = ?
           WHERE branch_id = ?
             AND customer_id IN (${sourcePlaceholders})`,
          [targetCustomerId, branchId, ...sourceCustomerIds]
        );
        installmentAgreementsUpdated = Number(installmentResult.affectedRows || 0);
      }

      const [deleteResult] = await connection.query(
        `DELETE FROM customers
         WHERE branch_id = ?
           AND id IN (${sourcePlaceholders})`,
        [branchId, ...sourceCustomerIds]
      );

      await writeAuditEvent({
        connection,
        req,
        branchId,
        action: "MERGE_CUSTOMER_IDENTITIES",
        details: `Merged ${sourceCustomerIds.length} duplicate customer record(s) into ${targetCustomer.name}. Reason: ${reason}`,
        workspaceCode: "spare_parts",
        entityType: "customer",
        entityId: targetCustomerId,
        actionType: "MERGE_CUSTOMER_IDENTITIES",
        outcome: "success",
        severity: "warning",
        metadata: {
          target_customer: targetCustomer,
          source_customers: sourceCustomers,
          sales_relinked: Number(salesResult.affectedRows || 0),
          debts_relinked: Number(debtsResult.affectedRows || 0),
          installment_agreements_relinked: installmentAgreementsUpdated,
          source_customers_removed: Number(deleteResult.affectedRows || 0),
          reason,
        },
      });

      await connection.commit();

      return res.json({
        status: "success",
        message: `Customer records were merged into ${targetCustomer.name}. Original sales, receipts, debt records and payments were preserved.`,
        result: {
          target_customer: targetCustomer,
          source_customer_ids: sourceCustomerIds,
          sales_relinked: Number(salesResult.affectedRows || 0),
          debts_relinked: Number(debtsResult.affectedRows || 0),
          installment_agreements_relinked: installmentAgreementsUpdated,
          source_customers_removed: Number(deleteResult.affectedRows || 0),
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Merge duplicate customers error:", error);
      return res.status(error.statusCode || 500).json({
        status: "error",
        message:
          error.statusCode && error.message
            ? error.message
            : "Could not merge the selected customer records.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
