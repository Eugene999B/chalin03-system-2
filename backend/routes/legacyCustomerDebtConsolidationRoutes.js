const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  ALGORITHM_VERSION,
  DEFAULT_SUGGESTION_SCORE,
  duplicateGroups,
  duplicateSuggestions,
  normalizePhone,
  publicCustomer,
} = require("../services/customerIdentityMatchingService");

const router = express.Router();

router.use(requireAuth);

const MAX_DIRECTORY_ROWS = 5000;

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

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
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

function safeIdentifier(value) {
  const identifier = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error("Unsafe database identifier detected.");
  }
  return `\`${identifier}\``;
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

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function loadCustomerDirectory(
  connection,
  branchId,
  { search = "", limit = MAX_DIRECTORY_ROWS } = {}
) {
  const normalizedLimit = Math.floor(
    clamp(Number(limit) || MAX_DIRECTORY_ROWS, 1, MAX_DIRECTORY_ROWS)
  );
  const searchTerm = cleanText(search, 150);
  const likeSearch = `%${searchTerm}%`;

  const [countRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM customers
     WHERE branch_id = ?`,
    [branchId]
  );

  const [rows] = await connection.query(
    `SELECT
       c.id AS customer_id,
       c.name AS customer_name,
       c.phone AS customer_phone,
       c.location AS customer_location,
       c.created_at,
       c.updated_at,
       COALESCE(s.sale_count, 0) AS sale_count,
       COALESCE(s.total_sales_value, 0) AS total_sales_value,
       s.first_sale_at,
       s.last_sale_at,
       COALESCE(d.debt_count, 0) AS debt_count,
       COALESCE(d.active_debt_count, 0) AS active_debt_count,
       COALESCE(d.total_owed, 0) AS total_owed,
       COALESCE(d.total_paid, 0) AS total_paid,
       COALESCE(d.outstanding_balance, 0) AS outstanding_balance,
       d.first_debt_at,
       d.last_debt_at,
       (COALESCE(s.sale_count, 0) + COALESCE(d.debt_count, 0)) AS transaction_count,
       LEAST(
         COALESCE(s.first_sale_at, c.created_at),
         COALESCE(d.first_debt_at, c.created_at),
         c.created_at
       ) AS first_activity_at,
       GREATEST(
         COALESCE(s.last_sale_at, c.updated_at, c.created_at),
         COALESCE(d.last_debt_at, c.updated_at, c.created_at),
         COALESCE(c.updated_at, c.created_at)
       ) AS last_activity_at
     FROM customers c
     LEFT JOIN (
       SELECT
         branch_id,
         customer_id,
         COUNT(*) AS sale_count,
         COALESCE(SUM(total), 0) AS total_sales_value,
         MIN(created_at) AS first_sale_at,
         MAX(created_at) AS last_sale_at
       FROM sales
       WHERE branch_id = ?
         AND customer_id IS NOT NULL
       GROUP BY branch_id, customer_id
     ) s
       ON s.branch_id = c.branch_id
      AND s.customer_id = c.id
     LEFT JOIN (
       SELECT
         branch_id,
         customer_id,
         COUNT(*) AS debt_count,
         SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS active_debt_count,
         COALESCE(SUM(amount_owed), 0) AS total_owed,
         COALESCE(SUM(amount_paid), 0) AS total_paid,
         COALESCE(SUM(balance), 0) AS outstanding_balance,
         MIN(created_at) AS first_debt_at,
         MAX(created_at) AS last_debt_at
       FROM debts
       WHERE branch_id = ?
         AND customer_id IS NOT NULL
       GROUP BY branch_id, customer_id
     ) d
       ON d.branch_id = c.branch_id
      AND d.customer_id = c.id
     WHERE c.branch_id = ?
       AND (
         ? = ''
         OR CAST(c.id AS CHAR) LIKE ?
         OR c.name LIKE ?
         OR COALESCE(c.phone, '') LIKE ?
         OR COALESCE(c.location, '') LIKE ?
       )
     ORDER BY
       (COALESCE(s.sale_count, 0) + COALESCE(d.debt_count, 0)) DESC,
       c.name ASC,
       c.id ASC
     LIMIT ?`,
    [
      branchId,
      branchId,
      branchId,
      searchTerm,
      likeSearch,
      likeSearch,
      likeSearch,
      likeSearch,
      normalizedLimit,
    ]
  );

  return {
    database_total: Number(countRows[0]?.total || 0),
    rows,
    scan_limited: Number(countRows[0]?.total || 0) > normalizedLimit,
    limit: normalizedLimit,
  };
}

function directorySummary(rows, databaseTotal) {
  return rows.reduce(
    (summary, customer) => {
      summary.loaded_customer_count += 1;
      if (Number(customer.sale_count || 0) > 0) summary.customers_with_sales += 1;
      if (Number(customer.debt_count || 0) > 0) summary.customers_with_debt_history += 1;
      if (Number(customer.active_debt_count || 0) > 0) summary.customers_with_active_debt += 1;
      if (
        Number(customer.sale_count || 0) === 0 &&
        Number(customer.debt_count || 0) === 0
      ) {
        summary.customers_without_activity += 1;
      }
      if (!normalizePhone(customer.customer_phone)) summary.customers_without_phone += 1;
      summary.total_sales_value += Number(customer.total_sales_value || 0);
      summary.outstanding_balance += Number(customer.outstanding_balance || 0);
      return summary;
    },
    {
      database_customer_count: Number(databaseTotal || 0),
      loaded_customer_count: 0,
      customers_with_sales: 0,
      customers_with_debt_history: 0,
      customers_with_active_debt: 0,
      customers_without_activity: 0,
      customers_without_phone: 0,
      total_sales_value: 0,
      outstanding_balance: 0,
    }
  );
}

async function discoverAdditionalCustomerReferences(connection) {
  const [rows] = await connection.query(
    `SELECT DISTINCT
       kcu.TABLE_NAME AS table_name,
       kcu.COLUMN_NAME AS column_name,
       CASE WHEN branch_column.COLUMN_NAME IS NULL THEN NULL ELSE 'branch_id' END AS branch_column
     FROM information_schema.KEY_COLUMN_USAGE kcu
     LEFT JOIN information_schema.COLUMNS branch_column
       ON branch_column.TABLE_SCHEMA = kcu.TABLE_SCHEMA
      AND branch_column.TABLE_NAME = kcu.TABLE_NAME
      AND branch_column.COLUMN_NAME = 'branch_id'
     WHERE kcu.TABLE_SCHEMA = DATABASE()
       AND kcu.REFERENCED_TABLE_SCHEMA = DATABASE()
       AND kcu.REFERENCED_TABLE_NAME = 'customers'
       AND kcu.REFERENCED_COLUMN_NAME = 'id'
       AND kcu.TABLE_NAME <> 'customers'`
  );

  const excluded = new Set([
    "sales.customer_id",
    "debts.customer_id",
    "installment_agreements.customer_id",
  ]);

  return rows
    .filter((row) => !excluded.has(`${row.table_name}.${row.column_name}`))
    .map((row) => ({
      table: row.table_name,
      column: row.column_name,
      branchColumn: row.branch_column || null,
      source: "foreign_key",
    }));
}

async function countReferenceRows(
  connection,
  { table, column, branchColumn },
  branchId,
  sourceCustomerIds
) {
  if (!(await tableExists(connection, table))) return 0;
  if (!(await columnExists(connection, table, column))) return 0;

  const sourcePlaceholders = sourceCustomerIds.map(() => "?").join(",");
  const tableSql = safeIdentifier(table);
  const columnSql = safeIdentifier(column);
  let where = `${columnSql} IN (${sourcePlaceholders})`;
  const params = [...sourceCustomerIds];

  if (branchColumn && (await columnExists(connection, table, branchColumn))) {
    where = `${safeIdentifier(branchColumn)} = ? AND ${where}`;
    params.unshift(branchId);
  }

  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count FROM ${tableSql} WHERE ${where}`,
    params
  );
  return Number(rows[0]?.count || 0);
}

async function collectMergeImpact(connection, branchId, sourceCustomerIds) {
  const impact = [];
  const explicitSpecs = [
    { table: "sales", column: "customer_id", branchColumn: "branch_id" },
    { table: "debts", column: "customer_id", branchColumn: "branch_id" },
    {
      table: "installment_agreements",
      column: "customer_id",
      branchColumn: "branch_id",
    },
  ];

  for (const spec of explicitSpecs) {
    const count = await countReferenceRows(
      connection,
      spec,
      branchId,
      sourceCustomerIds
    );
    if ((await tableExists(connection, spec.table)) && count >= 0) {
      impact.push({ ...spec, source: "core", affected_rows: count });
    }
  }

  const additionalSpecs = await discoverAdditionalCustomerReferences(connection);
  for (const spec of additionalSpecs) {
    const count = await countReferenceRows(
      connection,
      spec,
      branchId,
      sourceCustomerIds
    );
    impact.push({ ...spec, affected_rows: count });
  }

  return {
    references: impact,
    total_references: impact.reduce(
      (total, row) => total + Number(row.affected_rows || 0),
      0
    ),
  };
}

async function updateAdditionalReference(
  connection,
  spec,
  branchId,
  targetCustomerId,
  sourceCustomerIds
) {
  const sourcePlaceholders = sourceCustomerIds.map(() => "?").join(",");
  const tableSql = safeIdentifier(spec.table);
  const columnSql = safeIdentifier(spec.column);
  let where = `${columnSql} IN (${sourcePlaceholders})`;
  const params = [targetCustomerId, ...sourceCustomerIds];

  if (spec.branchColumn) {
    where = `${safeIdentifier(spec.branchColumn)} = ? AND ${where}`;
    params.splice(1, 0, branchId);
  }

  const [result] = await connection.query(
    `UPDATE ${tableSql} SET ${columnSql} = ? WHERE ${where}`,
    params
  );
  return Number(result.affectedRows || 0);
}

async function loadSelectedCustomers(
  connection,
  branchId,
  targetCustomerId,
  sourceCustomerIds,
  lockRows = false
) {
  const customerIds = [targetCustomerId, ...sourceCustomerIds];
  const placeholders = customerIds.map(() => "?").join(",");
  const [customers] = await connection.query(
    `SELECT id, branch_id, name, phone, location, created_at, updated_at
     FROM customers
     WHERE branch_id = ?
       AND id IN (${placeholders})
     ORDER BY id
     ${lockRows ? "FOR UPDATE" : ""}`,
    [branchId, ...customerIds]
  );

  if (customers.length !== customerIds.length) {
    const error = new Error(
      "One or more selected customer records were not found in this store."
    );
    error.statusCode = 404;
    throw error;
  }

  return {
    targetCustomer: customers.find(
      (customer) => Number(customer.id) === Number(targetCustomerId)
    ),
    sourceCustomers: customers.filter(
      (customer) => Number(customer.id) !== Number(targetCustomerId)
    ),
  };
}

function parseMergeRequest(req) {
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

  return {
    targetCustomerId,
    sourceCustomerIds,
    reason: cleanText(req.body?.reason, 500),
    confirmation: cleanText(req.body?.confirmation, 20).toUpperCase(),
    masterProfile: {
      name: cleanText(req.body?.master_profile?.name, 255),
      phone: cleanText(req.body?.master_profile?.phone, 100),
      location: cleanText(req.body?.master_profile?.location, 255),
    },
  };
}

function validateMergeSelection(branchId, targetCustomerId, sourceCustomerIds) {
  if (!branchId || !targetCustomerId || sourceCustomerIds.length === 0) {
    const error = new Error(
      "Choose one master customer and at least one duplicate customer."
    );
    error.statusCode = 400;
    throw error;
  }

  if (sourceCustomerIds.length > 25) {
    const error = new Error(
      "Merge no more than 25 duplicate customer records at a time."
    );
    error.statusCode = 400;
    throw error;
  }
}

router.get("/directory", async (req, res) => {
  try {
    const branchId = getBranchId(req);
    if (!branchId) {
      return res.status(400).json({
        status: "error",
        message: "No store is selected for this session.",
      });
    }

    const directory = await loadCustomerDirectory(pool, branchId, {
      search: req.query.search,
      limit: req.query.limit,
    });
    const summary = directorySummary(directory.rows, directory.database_total);
    summary.total_sales_value = roundMoney(summary.total_sales_value);
    summary.outstanding_balance = roundMoney(summary.outstanding_balance);

    return res.json({
      status: "success",
      branch_id: branchId,
      summary,
      scan_limited: directory.scan_limited,
      limit: directory.limit,
      customers: directory.rows.map(publicCustomer),
    });
  } catch (error) {
    console.error("Customer identity directory error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load the complete customer directory.",
    });
  }
});

router.get("/duplicate-suggestions", async (req, res) => {
  try {
    const branchId = getBranchId(req);
    if (!branchId) {
      return res.status(400).json({
        status: "error",
        message: "No store is selected for this session.",
      });
    }

    const minimumScore = clamp(
      Number(req.query.minimum_score) || DEFAULT_SUGGESTION_SCORE,
      40,
      100
    );
    const resultLimit = Math.floor(
      clamp(Number(req.query.limit) || 100, 1, 250)
    );
    const directory = await loadCustomerDirectory(pool, branchId, {
      limit: MAX_DIRECTORY_ROWS,
    });
    const pairs = duplicateSuggestions(directory.rows, minimumScore);
    const groups = duplicateGroups(pairs).slice(0, resultLimit);

    return res.json({
      status: "success",
      branch_id: branchId,
      algorithm: {
        version: ALGORITHM_VERSION,
        minimum_score: minimumScore,
        scanned_customers: directory.rows.length,
        database_customers: directory.database_total,
        scan_limited: directory.scan_limited,
        signals: [
          "normalized Ghana phone number",
          "exact and order-independent name matching",
          "spelling similarity",
          "phonetic name similarity",
          "name-token overlap",
          "location similarity",
          "conflicting-phone penalty",
        ],
      },
      summary: {
        possible_duplicate_groups: groups.length,
        possible_duplicate_pairs: pairs.length,
        very_likely_groups: groups.filter(
          (group) => group.confidence === "very_likely"
        ).length,
        likely_groups: groups.filter((group) => group.confidence === "likely")
          .length,
        review_groups: groups.filter((group) => group.confidence === "review")
          .length,
      },
      groups,
    });
  } catch (error) {
    console.error("Customer duplicate suggestion error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not scan the customer directory for possible duplicates.",
    });
  }
});

router.post(
  "/merge-preview",
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const { targetCustomerId, sourceCustomerIds } = parseMergeRequest(req);
      validateMergeSelection(branchId, targetCustomerId, sourceCustomerIds);

      const { targetCustomer, sourceCustomers } = await loadSelectedCustomers(
        pool,
        branchId,
        targetCustomerId,
        sourceCustomerIds
      );
      const impact = await collectMergeImpact(
        pool,
        branchId,
        sourceCustomerIds
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        target_customer: targetCustomer,
        source_customers: sourceCustomers,
        impact,
        safeguards: [
          "The merge is restricted to the selected store.",
          "All updates and deletion run in one database transaction.",
          "Any database conflict rolls back the complete merge.",
          "Receipts and historical transaction snapshots remain unchanged.",
          "The action is written to the audit trail.",
        ],
      });
    } catch (error) {
      console.error("Customer merge preview error:", error);
      return res.status(error.statusCode || 500).json({
        status: "error",
        message:
          error.statusCode && error.message
            ? error.message
            : "Could not prepare the customer merge preview.",
      });
    }
  }
);

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
      const {
        targetCustomerId,
        sourceCustomerIds,
        reason,
        confirmation,
        masterProfile,
      } = parseMergeRequest(req);

      validateMergeSelection(branchId, targetCustomerId, sourceCustomerIds);

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

      const { targetCustomer, sourceCustomers } = await loadSelectedCustomers(
        connection,
        branchId,
        targetCustomerId,
        sourceCustomerIds,
        true
      );
      const sourcePlaceholders = sourceCustomerIds.map(() => "?").join(",");
      const impact = await collectMergeImpact(
        connection,
        branchId,
        sourceCustomerIds
      );

      const finalProfile = {
        name: masterProfile.name || targetCustomer.name,
        phone:
          masterProfile.phone ||
          targetCustomer.phone ||
          sourceCustomers.find((customer) => cleanText(customer.phone, 100))?.phone ||
          "",
        location:
          masterProfile.location ||
          targetCustomer.location ||
          sourceCustomers.find((customer) => cleanText(customer.location, 255))
            ?.location ||
          "",
      };

      if (!cleanText(finalProfile.name, 255)) {
        const error = new Error("The master customer must have a name.");
        error.statusCode = 400;
        throw error;
      }

      await connection.query(
        `UPDATE customers
         SET name = ?, phone = ?, location = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND branch_id = ?`,
        [
          cleanText(finalProfile.name, 255),
          cleanText(finalProfile.phone, 100) || null,
          cleanText(finalProfile.location, 255) || null,
          targetCustomerId,
          branchId,
        ]
      );

      let salesUpdated = 0;
      if (await tableExists(connection, "sales")) {
        const [salesResult] = await connection.query(
          `UPDATE sales
           SET customer_id = ?
           WHERE branch_id = ?
             AND customer_id IN (${sourcePlaceholders})`,
          [targetCustomerId, branchId, ...sourceCustomerIds]
        );
        salesUpdated = Number(salesResult.affectedRows || 0);
      }

      let debtsUpdated = 0;
      if (await tableExists(connection, "debts")) {
        const [debtsResult] = await connection.query(
          `UPDATE debts
           SET customer_id = ?
           WHERE branch_id = ?
             AND customer_id IN (${sourcePlaceholders})`,
          [targetCustomerId, branchId, ...sourceCustomerIds]
        );
        debtsUpdated = Number(debtsResult.affectedRows || 0);
      }

      let installmentAgreementsUpdated = 0;
      if (await tableExists(connection, "installment_agreements")) {
        const [installmentResult] = await connection.query(
          `UPDATE installment_agreements
           SET customer_id = ?
           WHERE branch_id = ?
             AND customer_id IN (${sourcePlaceholders})`,
          [targetCustomerId, branchId, ...sourceCustomerIds]
        );
        installmentAgreementsUpdated = Number(
          installmentResult.affectedRows || 0
        );
      }

      const additionalReferences = await discoverAdditionalCustomerReferences(
        connection
      );
      const additionalUpdates = [];
      for (const reference of additionalReferences) {
        const affectedRows = await updateAdditionalReference(
          connection,
          reference,
          branchId,
          targetCustomerId,
          sourceCustomerIds
        );
        additionalUpdates.push({
          table: reference.table,
          column: reference.column,
          affected_rows: affectedRows,
        });
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
        details: `Merged ${sourceCustomerIds.length} duplicate customer record(s) into ${finalProfile.name}. Reason: ${reason}`,
        workspaceCode: "spare_parts",
        entityType: "customer",
        entityId: targetCustomerId,
        actionType: "MERGE_CUSTOMER_IDENTITIES",
        outcome: "success",
        severity: "warning",
        metadata: {
          algorithm_version: ALGORITHM_VERSION,
          target_customer_before: targetCustomer,
          target_customer_after: {
            ...targetCustomer,
            ...finalProfile,
          },
          source_customers: sourceCustomers,
          preview_impact: impact,
          sales_relinked: salesUpdated,
          debts_relinked: debtsUpdated,
          installment_agreements_relinked: installmentAgreementsUpdated,
          additional_references_relinked: additionalUpdates,
          source_customers_removed: Number(deleteResult.affectedRows || 0),
          reason,
        },
      });

      await connection.commit();

      return res.json({
        status: "success",
        message: `Customer records were merged into ${finalProfile.name}. Original sales, receipts, debt records and payments were preserved.`,
        result: {
          target_customer: {
            ...targetCustomer,
            ...finalProfile,
          },
          source_customer_ids: sourceCustomerIds,
          sales_relinked: salesUpdated,
          debts_relinked: debtsUpdated,
          installment_agreements_relinked: installmentAgreementsUpdated,
          additional_references_relinked: additionalUpdates,
          source_customers_removed: Number(deleteResult.affectedRows || 0),
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Merge duplicate customers error:", error);

      const duplicateConflict = error?.code === "ER_DUP_ENTRY";
      return res.status(error.statusCode || (duplicateConflict ? 409 : 500)).json({
        status: "error",
        message: duplicateConflict
          ? "The merge was safely stopped because both customers already have a unique linked record in another part of the system. No data was changed. Review those records before merging."
          : error.statusCode && error.message
            ? error.message
            : "Could not merge the selected customer records. No partial merge was saved.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
