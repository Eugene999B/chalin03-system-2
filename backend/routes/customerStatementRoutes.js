const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

function cleanSearch(value) {
  if (!value) return "";

  return String(value).trim();
}

function toNumber(value) {
  return Number(value || 0);
}

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 0);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return null;
  }

  return branchId;
}

function getBranchInfo(req) {
  return {
    id: getBranchId(req),
    branch_code: req.user?.branch_code || null,
    name: req.user?.branch_name || null,
    location: req.user?.branch_location || null,
  };
}

function sendMissingBranchResponse(res) {
  return res.status(400).json({
    status: "error",
    message:
      "No store was selected for this session. Please logout, choose a store, and login again.",
  });
}

function validationError(message, code = "INVALID_CUSTOMER_IDENTITY") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function normalizeIdentityPayload(payload = {}) {
  const name = String(payload.name || "").trim().replace(/\s+/g, " ");
  const rawPhone = String(payload.phone || "").trim();
  const location = String(payload.location || "").trim().replace(/\s+/g, " ");

  const nameParts = name.split(" ").filter(Boolean);
  if (nameParts.length < 2) {
    throw validationError(
      "Enter the customer's first and last names. Use at least two separate names."
    );
  }

  if (!/^[\p{L}][\p{L}'’.\-]*(?:\s+[\p{L}][\p{L}'’.\-]*)+$/u.test(name)) {
    throw validationError(
      "Customer name must contain at least two clear names separated by spaces."
    );
  }

  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw validationError(
      "Enter a valid customer phone number containing 7 to 15 digits."
    );
  }

  if (/[<>{}]/.test(location)) {
    throw validationError("Customer location contains invalid characters.");
  }

  return {
    name,
    phone: rawPhone.replace(/\s+/g, " ").slice(0, 30),
    location: location ? location.slice(0, 150) : null,
  };
}

function sameNullableText(left, right) {
  return String(left || "").trim() === String(right || "").trim();
}

async function recordIdentityAudit(connection, req, branchId, details) {
  await writeAuditEvent({
    connection,
    req,
    branchId,
    userId: req.user?.id || null,
    action: "customer_identity.updated",
    actionType: "customer_identity.updated",
    workspaceCode: "spare_parts",
    entityType: "customer",
    entityId: details.customerId || null,
    outcome: "success",
    severity: "notice",
    details: `Customer identity corrected from ${details.beforeName || "Unnamed Customer"} to ${details.afterName}.`,
    metadata: {
      source: details.source,
      customer_id: details.customerId || null,
      before: {
        name: details.beforeName || null,
        phone: details.beforePhone || null,
        location: details.beforeLocation || null,
      },
      after: {
        name: details.afterName,
        phone: details.afterPhone,
        location: details.afterLocation || null,
      },
      affected_sales: details.affectedSales,
      affected_debts: details.affectedDebts,
      legacy_promoted: Boolean(details.legacyPromoted),
    },
  });
}

// GET /api/customer-statements/search?query=ama
router.get(
  "/search",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);

      if (!branchId) {
        return sendMissingBranchResponse(res);
      }

      const query = cleanSearch(req.query.query);

      if (!query) {
        return res.json({
          status: "success",
          branch: getBranchInfo(req),
          count: 0,
          customers: [],
        });
      }

      const searchValue = `%${query}%`;

      const [customers] = await pool.query(
        `SELECT
          customer_name,
          customer_phone,
          COUNT(*) AS sales_count,
          SUM(CASE
            WHEN COALESCE(is_voided, 0) = 0
            AND sale_status != 'cancelled'
            THEN total
            ELSE 0
          END) AS total_sales,
          SUM(CASE
            WHEN COALESCE(is_voided, 0) = 0
            AND sale_status != 'cancelled'
            THEN balance
            ELSE 0
          END) AS sales_balance
         FROM sales
         WHERE branch_id = ?
         AND (
          customer_name LIKE ?
          OR customer_phone LIKE ?
         )
         GROUP BY customer_name, customer_phone
         ORDER BY customer_name ASC
         LIMIT 30`,
        [branchId, searchValue, searchValue]
      );

      return res.json({
        status: "success",
        branch: getBranchInfo(req),
        count: customers.length,
        customers,
      });
    } catch (error) {
      console.error("Search customer statements error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while searching customers.",
      });
    }
  }
);

// GET /api/customer-statements/identity-editor
router.get(
  "/identity-editor",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);

      if (!branchId) {
        return sendMissingBranchResponse(res);
      }

      const [linked] = await pool.query(
        `SELECT
           c.id AS customer_id,
           c.name AS customer_name,
           c.phone AS customer_phone,
           c.location AS customer_location,
           COALESCE(s.sales_count, 0) AS sales_count,
           COALESCE(d.debt_count, 0) AS debt_count,
           COALESCE(d.outstanding_balance, 0) AS outstanding_balance,
           'linked' AS identity_source
         FROM customers c
         LEFT JOIN (
           SELECT branch_id, customer_id, COUNT(*) AS sales_count
           FROM sales
           WHERE customer_id IS NOT NULL
           GROUP BY branch_id, customer_id
         ) s
           ON s.branch_id = c.branch_id
          AND s.customer_id = c.id
         LEFT JOIN (
           SELECT branch_id, customer_id, COUNT(*) AS debt_count,
                  COALESCE(SUM(balance), 0) AS outstanding_balance
           FROM debts
           WHERE customer_id IS NOT NULL
           GROUP BY branch_id, customer_id
         ) d
           ON d.branch_id = c.branch_id
          AND d.customer_id = c.id
         WHERE c.branch_id = ?
           AND (s.customer_id IS NOT NULL OR d.customer_id IS NOT NULL)
         ORDER BY c.name ASC, c.id ASC`,
        [branchId]
      );

      const [legacy] = await pool.query(
        `SELECT
           CONCAT(
             COALESCE(NULLIF(TRIM(customer_name), ''), 'Legacy Customer'),
             '::',
             COALESCE(customer_phone, '')
           ) AS legacy_key,
           COALESCE(NULLIF(TRIM(customer_name), ''), 'Legacy Customer') AS customer_name,
           customer_phone,
           SUM(sales_count) AS sales_count,
           SUM(debt_count) AS debt_count,
           SUM(outstanding_balance) AS outstanding_balance,
           'legacy' AS identity_source
         FROM (
           SELECT
             customer_name,
             customer_phone,
             COUNT(*) AS sales_count,
             0 AS debt_count,
             0 AS outstanding_balance
           FROM sales
           WHERE branch_id = ?
             AND customer_id IS NULL
           GROUP BY customer_name, customer_phone

           UNION ALL

           SELECT
             customer_name,
             customer_phone,
             0 AS sales_count,
             COUNT(*) AS debt_count,
             COALESCE(SUM(balance), 0) AS outstanding_balance
           FROM debts
           WHERE branch_id = ?
             AND customer_id IS NULL
           GROUP BY customer_name, customer_phone
         ) legacy_rows
         GROUP BY customer_name, customer_phone
         ORDER BY customer_name ASC, customer_phone ASC`,
        [branchId, branchId]
      );

      return res.json({
        status: "success",
        branch: getBranchInfo(req),
        customers: [
          ...linked.map((row) => ({
            customer_id: Number(row.customer_id),
            customer_name: row.customer_name || "Unnamed Customer",
            customer_phone: row.customer_phone || "",
            customer_location: row.customer_location || "",
            sales_count: Number(row.sales_count || 0),
            debt_count: Number(row.debt_count || 0),
            outstanding_balance: Number(toNumber(row.outstanding_balance).toFixed(2)),
            identity_source: "linked",
            legacy_key: null,
          })),
          ...legacy.map((row) => ({
            customer_id: null,
            customer_name: row.customer_name || "Legacy Customer",
            customer_phone: row.customer_phone || "",
            customer_location: "",
            sales_count: Number(row.sales_count || 0),
            debt_count: Number(row.debt_count || 0),
            outstanding_balance: Number(toNumber(row.outstanding_balance).toFixed(2)),
            identity_source: "legacy",
            legacy_key: row.legacy_key,
          })),
        ],
      });
    } catch (error) {
      console.error("Customer identity editor list error:", error);
      return res.status(500).json({
        status: "error",
        message: "Something went wrong while loading customer identity records.",
      });
    }
  }
);

// PUT /api/customer-statements/identity-editor/customer/:id
router.put(
  "/identity-editor/customer/:id",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const branchId = getBranchId(req);
    const customerId = Number(req.params.id || 0);

    if (!branchId) return sendMissingBranchResponse(res);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({
        status: "error",
        message: "The selected customer is invalid.",
      });
    }

    const identity = normalizeIdentityPayload(req.body);
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT id, name, phone, location
         FROM customers
         WHERE id = ? AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [customerId, branchId]
      );

      const current = rows[0];
      if (!current) {
        throw validationError("That customer record no longer exists.", "CUSTOMER_NOT_FOUND");
      }

      const [salesRows] = await connection.query(
        `SELECT COUNT(*) AS total FROM sales WHERE branch_id = ? AND customer_id = ?`,
        [branchId, customerId]
      );
      const [debtRows] = await connection.query(
        `SELECT COUNT(*) AS total FROM debts WHERE branch_id = ? AND customer_id = ?`,
        [branchId, customerId]
      );

      await connection.query(
        `UPDATE customers
         SET name = ?, phone = ?, location = ?
         WHERE id = ? AND branch_id = ?`,
        [identity.name, identity.phone, identity.location, customerId, branchId]
      );

      await connection.query(
        `UPDATE sales
         SET customer_name = ?,
             customer_phone = ?,
             edited_by = ?,
             edited_at = CURRENT_TIMESTAMP,
             edit_reason = 'Customer identity cleanup'
         WHERE branch_id = ?
           AND customer_id = ?`,
        [identity.name, identity.phone, req.user?.id || null, branchId, customerId]
      );

      await connection.query(
        `UPDATE debts
         SET customer_name = ?, customer_phone = ?
         WHERE branch_id = ? AND customer_id = ?`,
        [identity.name, identity.phone, branchId, customerId]
      );

      await recordIdentityAudit(connection, req, branchId, {
        source: "linked",
        customerId,
        beforeName: current.name,
        beforePhone: current.phone,
        beforeLocation: current.location,
        afterName: identity.name,
        afterPhone: identity.phone,
        afterLocation: identity.location,
        affectedSales: Number(salesRows[0]?.total || 0),
        affectedDebts: Number(debtRows[0]?.total || 0),
        legacyPromoted: false,
      });

      await connection.commit();

      return res.json({
        status: "success",
        message: "Customer identity updated successfully.",
        customer: {
          customer_id: customerId,
          name: identity.name,
          phone: identity.phone,
          location: identity.location || "",
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Customer identity update error:", error);

      return res.status(error.statusCode || 500).json({
        status: "error",
        code: error.code || "CUSTOMER_IDENTITY_UPDATE_FAILED",
        message: error.message || "Could not update the customer identity.",
      });
    } finally {
      connection.release();
    }
  }
);

// PUT /api/customer-statements/identity-editor/legacy
router.put(
  "/identity-editor/legacy",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const branchId = getBranchId(req);
    const currentName = String(req.body?.current_name || "").trim();
    const currentPhone = String(req.body?.current_phone || "").trim();

    if (!branchId) return sendMissingBranchResponse(res);
    if (!currentName) {
      return res.status(400).json({
        status: "error",
        message: "The original customer name is required.",
      });
    }

    const identity = normalizeIdentityPayload(req.body);
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const phoneCondition = currentPhone
        ? "customer_phone = ?"
        : "(customer_phone IS NULL OR customer_phone = '')";
      const phoneParams = currentPhone ? [currentPhone] : [];

      const [salesRows] = await connection.query(
        `SELECT id
         FROM sales
         WHERE branch_id = ?
           AND customer_id IS NULL
           AND customer_name = ?
           AND ${phoneCondition}
         FOR UPDATE`,
        [branchId, currentName, ...phoneParams]
      );

      const [debtRows] = await connection.query(
        `SELECT id
         FROM debts
         WHERE branch_id = ?
           AND customer_id IS NULL
           AND customer_name = ?
           AND ${phoneCondition}
         FOR UPDATE`,
        [branchId, currentName, ...phoneParams]
      );

      if (salesRows.length === 0 && debtRows.length === 0) {
        throw validationError(
          "Those legacy customer records could not be found. Refresh the list and try again.",
          "LEGACY_CUSTOMER_NOT_FOUND"
        );
      }

      const [existingCustomerRows] = await connection.query(
        `SELECT id, name, phone
         FROM customers
         WHERE branch_id = ? AND phone = ?
         ORDER BY id ASC
         LIMIT 2
         FOR UPDATE`,
        [branchId, identity.phone]
      );

      if (existingCustomerRows.length > 0) {
        const conflicting = existingCustomerRows.find(
          (row) => !sameNullableText(row.name, identity.name)
        );
        if (conflicting) {
          throw validationError(
            "That phone number is already assigned to another customer in this store. Use the existing customer's record instead.",
            "CUSTOMER_PHONE_ALREADY_ASSIGNED"
          );
        }
      }

      let customerId = existingCustomerRows[0]?.id || null;
      let legacyPromoted = false;

      if (!customerId) {
        const [insertResult] = await connection.query(
          `INSERT INTO customers (branch_id, name, phone, location)
           VALUES (?, ?, ?, ?)`,
          [branchId, identity.name, identity.phone, identity.location]
        );
        customerId = Number(insertResult.insertId);
        legacyPromoted = true;
      } else {
        await connection.query(
          `UPDATE customers
           SET name = ?, phone = ?, location = ?
           WHERE id = ? AND branch_id = ?`,
          [identity.name, identity.phone, identity.location, customerId, branchId]
        );
      }

      const salesIds = salesRows.map((row) => row.id);
      const debtIds = debtRows.map((row) => row.id);

      if (salesIds.length > 0) {
        const placeholders = salesIds.map(() => "?").join(",");
        await connection.query(
          `UPDATE sales
           SET customer_id = ?,
               customer_name = ?,
               customer_phone = ?,
               edited_by = ?,
               edited_at = CURRENT_TIMESTAMP,
               edit_reason = 'Customer identity cleanup'
           WHERE branch_id = ? AND id IN (${placeholders})`,
          [customerId, identity.name, identity.phone, req.user?.id || null, branchId, ...salesIds]
        );
      }

      if (debtIds.length > 0) {
        const placeholders = debtIds.map(() => "?").join(",");
        await connection.query(
          `UPDATE debts
           SET customer_id = ?, customer_name = ?, customer_phone = ?
           WHERE branch_id = ? AND id IN (${placeholders})`,
          [customerId, identity.name, identity.phone, branchId, ...debtIds]
        );
      }

      await recordIdentityAudit(connection, req, branchId, {
        source: "legacy",
        customerId,
        beforeName: currentName,
        beforePhone: currentPhone,
        beforeLocation: null,
        afterName: identity.name,
        afterPhone: identity.phone,
        afterLocation: identity.location,
        affectedSales: salesIds.length,
        affectedDebts: debtIds.length,
        legacyPromoted,
      });

      await connection.commit();

      return res.json({
        status: "success",
        message: "Legacy customer records were cleaned and linked to the customer master.",
        customer: {
          customer_id: customerId,
          name: identity.name,
          phone: identity.phone,
          location: identity.location || "",
        },
        affected_sales: salesIds.length,
        affected_debts: debtIds.length,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Legacy customer identity update error:", error);

      return res.status(error.statusCode || 500).json({
        status: "error",
        code: error.code || "LEGACY_CUSTOMER_IDENTITY_UPDATE_FAILED",
        message: error.message || "Could not update the legacy customer identity.",
      });
    } finally {
      connection.release();
    }
  }
);

// GET /api/customer-statements?phone=0240000000&name=Customer
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);

      if (!branchId) {
        return sendMissingBranchResponse(res);
      }

      const phone = cleanSearch(req.query.phone);
      const name = cleanSearch(req.query.name);

      if (!phone && !name) {
        return res.status(400).json({
          status: "error",
          message: "Customer phone or name is required.",
        });
      }

      const conditions = [];
      const params = [branchId];

      if (phone) {
        conditions.push("s.customer_phone = ?");
        params.push(phone);
      }

      if (name) {
        conditions.push("s.customer_name = ?");
        params.push(name);
      }

      const whereCustomer = conditions.join(" OR ");

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.branch_id,
          s.receipt_number,
          s.customer_name,
          s.customer_phone,
          s.subtotal,
          s.discount_amount,
          s.tax_amount,
          s.total,
          s.payment_type,
          s.amount_paid,
          s.balance,
          s.sale_status,
          s.is_voided,
          s.created_at,
          u.full_name AS staff_name
         FROM sales s
         LEFT JOIN users u ON s.staff_id = u.id
         WHERE s.branch_id = ?
         AND (${whereCustomer})
         ORDER BY s.created_at DESC`,
        params
      );

      const saleIds = sales.map((sale) => sale.id);

      let debts = [];
      let debtPayments = [];

      if (saleIds.length > 0) {
        const placeholders = saleIds.map(() => "?").join(",");

        const [debtRows] = await pool.query(
          `SELECT
            d.id,
            d.branch_id,
            d.sale_id,
            d.customer_name,
            d.customer_phone,
            d.amount_owed,
            d.amount_paid,
            d.balance,
            d.status,
            d.due_date,
            d.created_at,
            s.receipt_number
           FROM debts d
           INNER JOIN sales s
            ON d.sale_id = s.id
            AND s.branch_id = d.branch_id
           WHERE d.branch_id = ?
           AND d.sale_id IN (${placeholders})
           ORDER BY d.created_at DESC`,
          [branchId, ...saleIds]
        );

        debts = debtRows;

        const debtIds = debts.map((debt) => debt.id);

        if (debtIds.length > 0) {
          const debtPlaceholders = debtIds.map(() => "?").join(",");

          const [paymentRows] = await pool.query(
            `SELECT
              dp.id,
              dp.branch_id,
              dp.debt_id,
              dp.amount,
              dp.payment_method,
              dp.paid_at,
              dp.notes,
              d.customer_name,
              d.customer_phone,
              s.receipt_number,
              u.full_name AS received_by_name
             FROM debt_payments dp
             INNER JOIN debts d
              ON dp.debt_id = d.id
              AND d.branch_id = dp.branch_id
             INNER JOIN sales s
              ON d.sale_id = s.id
              AND s.branch_id = d.branch_id
             LEFT JOIN users u ON dp.received_by = u.id
             WHERE dp.branch_id = ?
             AND dp.debt_id IN (${debtPlaceholders})
             ORDER BY dp.paid_at DESC, dp.id DESC`,
            [branchId, ...debtIds]
          );

          debtPayments = paymentRows;
        }
      }

      const validSales = sales.filter(
        (sale) =>
          Number(sale.is_voided || 0) === 0 && sale.sale_status !== "cancelled"
      );

      const totalSales = validSales.reduce(
        (sum, sale) => sum + toNumber(sale.total),
        0
      );

      const totalPaidOnSales = validSales.reduce(
        (sum, sale) => sum + toNumber(sale.amount_paid),
        0
      );

      const totalDebtPayments = debtPayments.reduce(
        (sum, payment) => sum + toNumber(payment.amount),
        0
      );

      const totalOutstanding = debts.reduce(
        (sum, debt) => sum + toNumber(debt.balance),
        0
      );

      const customerName =
        sales[0]?.customer_name || debts[0]?.customer_name || name || "";

      const customerPhone =
        sales[0]?.customer_phone || debts[0]?.customer_phone || phone || "";

      return res.json({
        status: "success",
        branch: getBranchInfo(req),
        customer: {
          name: customerName,
          phone: customerPhone,
        },
        summary: {
          sales_count: sales.length,
          valid_sales_count: validSales.length,
          debts_count: debts.length,
          payments_count: debtPayments.length,
          total_sales: Number(totalSales.toFixed(2)),
          total_paid_on_sales: Number(totalPaidOnSales.toFixed(2)),
          total_debt_payments: Number(totalDebtPayments.toFixed(2)),
          total_received: Number(
            (totalPaidOnSales + totalDebtPayments).toFixed(2)
          ),
          total_outstanding: Number(totalOutstanding.toFixed(2)),
        },
        sales,
        debts,
        debt_payments: debtPayments,
      });
    } catch (error) {
      console.error("Customer statement error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while loading customer statement.",
      });
    }
  }
);

module.exports = router;
