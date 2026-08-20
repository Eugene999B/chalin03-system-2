const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

router.use(requireAuth);

const MAX_SOURCE_ACCOUNTS = 25;

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function roundMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function getBranchId(req) {
  return positiveId(req.user?.branch_id || req.user?.default_branch_id);
}

function parseAccountKey(value) {
  const match = /^(customer|legacy)-(\d+)$/.exec(cleanText(value, 80));
  if (!match) return null;
  const id = positiveId(match[2]);
  return id ? { key: `${match[1]}-${id}`, type: match[1], id } : null;
}

function parseMergeRequest(req) {
  const target = parseAccountKey(req.body?.target_customer_key);
  const rawSources = Array.isArray(req.body?.source_customer_keys)
    ? req.body.source_customer_keys
    : [];
  const sources = [];
  const seen = new Set();

  for (const value of rawSources) {
    const parsed = parseAccountKey(value);
    if (!parsed || parsed.key === target?.key || seen.has(parsed.key)) continue;
    seen.add(parsed.key);
    sources.push(parsed);
  }

  return {
    target,
    sources,
    reason: cleanText(req.body?.reason, 500),
    confirmation: cleanText(req.body?.confirmation, 20).toUpperCase(),
  };
}

function validateMergeRequest(branchId, request) {
  if (!branchId) {
    const error = new Error("No store is selected for this session.");
    error.statusCode = 400;
    throw error;
  }
  if (!request.target || request.target.type !== "customer") {
    const error = new Error(
      "Choose a saved customer account as the master record to keep."
    );
    error.statusCode = 400;
    throw error;
  }
  if (request.sources.length === 0) {
    const error = new Error("Select at least one duplicate account to merge.");
    error.statusCode = 400;
    throw error;
  }
  if (request.sources.length > MAX_SOURCE_ACCOUNTS) {
    const error = new Error(
      `Merge no more than ${MAX_SOURCE_ACCOUNTS} duplicate accounts at a time.`
    );
    error.statusCode = 400;
    throw error;
  }
  if (request.reason.length < 5) {
    const error = new Error("Enter a clear reason for this customer merge.");
    error.statusCode = 400;
    throw error;
  }
  if (request.confirmation !== "MERGE") {
    const error = new Error("Type MERGE to confirm this customer consolidation.");
    error.statusCode = 400;
    throw error;
  }
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
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
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

async function financialSnapshot(connection) {
  const closingSql = (await tableExists(connection, "daily_closings"))
    ? "(SELECT COUNT(*) FROM daily_closings)"
    : "0";
  const [[row]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM customers) AS customer_count,
       (SELECT COUNT(*) FROM sales) AS sale_count,
       (SELECT COALESCE(SUM(total), 0) FROM sales) AS sale_total,
       (SELECT COALESCE(SUM(amount_paid), 0) FROM sales) AS sale_paid,
       (SELECT COALESCE(SUM(balance), 0) FROM sales) AS sale_balance,
       (SELECT COUNT(*) FROM sales WHERE customer_id IS NULL) AS unlinked_sale_count,
       (SELECT COUNT(*) FROM debts) AS debt_count,
       (SELECT COALESCE(SUM(amount_owed), 0) FROM debts) AS debt_owed,
       (SELECT COALESCE(SUM(amount_paid), 0) FROM debts) AS debt_paid,
       (SELECT COALESCE(SUM(balance), 0) FROM debts) AS debt_balance,
       (SELECT COUNT(*) FROM debts WHERE customer_id IS NULL) AS unlinked_debt_count,
       (SELECT COUNT(*) FROM debt_payments) AS payment_count,
       (SELECT COALESCE(SUM(amount), 0) FROM debt_payments) AS payment_total,
       (SELECT COUNT(*) FROM products) AS product_count,
       (SELECT COALESCE(SUM(quantity), 0) FROM products) AS stock_quantity,
       ${closingSql} AS daily_closing_count`
  );

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      key.includes("count") || key === "stock_quantity"
        ? Number(value || 0)
        : roundMoney(value),
    ])
  );
}

function assertFinancialSnapshot(before, after, expected = {}) {
  for (const field of [
    "sale_count",
    "debt_count",
    "payment_count",
    "product_count",
    "stock_quantity",
    "daily_closing_count",
  ]) {
    if (Number(before[field]) !== Number(after[field])) {
      throw new Error(`Protected count changed for ${field}.`);
    }
  }

  for (const field of [
    "sale_total",
    "sale_paid",
    "sale_balance",
    "debt_owed",
    "debt_paid",
    "debt_balance",
    "payment_total",
  ]) {
    if (Math.abs(roundMoney(before[field]) - roundMoney(after[field])) > 0.01) {
      throw new Error(`Protected financial total changed for ${field}.`);
    }
  }

  if (
    Number(after.customer_count) !==
    Number(before.customer_count) - Number(expected.removedCustomerCount || 0)
  ) {
    throw new Error("Unexpected customer count change during merge.");
  }
  if (
    Number(after.unlinked_debt_count) !==
    Number(before.unlinked_debt_count) - Number(expected.linkedLegacyDebtCount || 0)
  ) {
    throw new Error("Unexpected receipt-level debt ownership change.");
  }
  if (
    Number(after.unlinked_sale_count) !==
    Number(before.unlinked_sale_count) - Number(expected.linkedLegacySaleCount || 0)
  ) {
    throw new Error("Unexpected receipt-level sale ownership change.");
  }
}

async function loadTargetCustomer(connection, branchId, customerId) {
  const [rows] = await connection.query(
    `SELECT id, branch_id, name, phone, location, created_at, updated_at
     FROM customers
     WHERE branch_id = ? AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [branchId, customerId]
  );
  if (rows.length !== 1) {
    const error = new Error("The selected master customer was not found in this store.");
    error.statusCode = 404;
    throw error;
  }
  return rows[0];
}

async function loadSourceCustomers(connection, branchId, sourceCustomerIds) {
  if (sourceCustomerIds.length === 0) return [];
  const placeholders = sourceCustomerIds.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT id, branch_id, name, phone, location, created_at, updated_at
     FROM customers
     WHERE branch_id = ? AND id IN (${placeholders})
     ORDER BY id
     FOR UPDATE`,
    [branchId, ...sourceCustomerIds]
  );
  if (rows.length !== sourceCustomerIds.length) {
    const error = new Error(
      "One or more duplicate customer accounts no longer exist in this store."
    );
    error.statusCode = 409;
    throw error;
  }
  return rows;
}

function normaliseLegacyRow(row) {
  return {
    debt_id: Number(row.debt_id),
    sale_id: row.sale_id == null ? null : Number(row.sale_id),
    debt_customer_id:
      row.debt_customer_id == null ? null : Number(row.debt_customer_id),
    sale_customer_id:
      row.sale_customer_id == null ? null : Number(row.sale_customer_id),
    debt_customer_name: cleanText(row.debt_customer_name, 255),
    sale_customer_name: cleanText(row.sale_customer_name, 255),
    amount_owed: roundMoney(row.amount_owed),
    debt_amount_paid: roundMoney(row.debt_amount_paid),
    debt_balance: roundMoney(row.debt_balance),
    debt_status: cleanText(row.debt_status, 50),
    sale_total: roundMoney(row.sale_total),
    sale_amount_paid: roundMoney(row.sale_amount_paid),
    sale_balance: roundMoney(row.sale_balance),
    payment_count: Number(row.payment_count || 0),
    payment_total: roundMoney(row.payment_total),
  };
}

async function lockLegacyDebtIds(connection, branchId, debtIds) {
  if (debtIds.length === 0) return;
  const placeholders = debtIds.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT id
     FROM debts
     WHERE branch_id = ? AND id IN (${placeholders})
     ORDER BY id
     FOR UPDATE`,
    [branchId, ...debtIds]
  );
  if (rows.length !== debtIds.length) {
    const error = new Error(
      "One or more receipt-level debt accounts no longer exist in this store."
    );
    error.statusCode = 409;
    throw error;
  }
}

async function loadLegacyDebts(
  connection,
  branchId,
  debtIds,
  { expectedCustomerId = null } = {}
) {
  if (debtIds.length === 0) return [];
  const placeholders = debtIds.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT
       d.id AS debt_id,
       d.sale_id,
       d.customer_id AS debt_customer_id,
       d.customer_name AS debt_customer_name,
       d.amount_owed,
       d.amount_paid AS debt_amount_paid,
       d.balance AS debt_balance,
       d.status AS debt_status,
       s.customer_id AS sale_customer_id,
       s.customer_name AS sale_customer_name,
       s.total AS sale_total,
       s.amount_paid AS sale_amount_paid,
       s.balance AS sale_balance,
       COUNT(dp.id) AS payment_count,
       COALESCE(SUM(dp.amount), 0) AS payment_total
     FROM debts d
     LEFT JOIN sales s ON s.id = d.sale_id AND s.branch_id = d.branch_id
     LEFT JOIN debt_payments dp
       ON dp.debt_id = d.id AND dp.branch_id = d.branch_id
     WHERE d.branch_id = ? AND d.id IN (${placeholders})
     GROUP BY
       d.id, d.sale_id, d.customer_id, d.customer_name,
       d.amount_owed, d.amount_paid, d.balance, d.status,
       s.customer_id, s.customer_name, s.total, s.amount_paid, s.balance
     ORDER BY d.id`,
    [branchId, ...debtIds]
  );
  if (rows.length !== debtIds.length) {
    const error = new Error(
      "One or more receipt-level debt accounts could not be verified."
    );
    error.statusCode = 409;
    throw error;
  }

  const normalised = rows.map(normaliseLegacyRow);
  for (const row of normalised) {
    if (expectedCustomerId === null) {
      if (row.debt_customer_id !== null || row.sale_customer_id !== null) {
        const error = new Error(
          `Receipt-level debt #${row.debt_id} is already linked to a saved customer. Refresh the Debt Desk and try again.`
        );
        error.statusCode = 409;
        throw error;
      }
    } else if (
      row.debt_customer_id !== expectedCustomerId ||
      (row.sale_id && row.sale_customer_id !== expectedCustomerId)
    ) {
      throw new Error(
        `Receipt-level debt #${row.debt_id} was not linked to the selected master customer.`
      );
    }
  }
  return normalised;
}

function assertLegacyRowsPreserved(beforeRows, afterRows, targetCustomerId) {
  if (beforeRows.length !== afterRows.length) {
    throw new Error("A receipt-level debt disappeared during merge.");
  }
  const afterById = new Map(afterRows.map((row) => [row.debt_id, row]));
  for (const before of beforeRows) {
    const after = afterById.get(before.debt_id);
    if (!after) throw new Error(`Debt #${before.debt_id} could not be verified.`);
    if (after.debt_customer_id !== targetCustomerId) {
      throw new Error(`Debt #${before.debt_id} was not linked to the master customer.`);
    }
    if (before.sale_id && after.sale_customer_id !== targetCustomerId) {
      throw new Error(`Sale for debt #${before.debt_id} was not linked to the master customer.`);
    }

    const protectedBefore = {
      ...before,
      debt_customer_id: null,
      sale_customer_id: null,
    };
    const protectedAfter = {
      ...after,
      debt_customer_id: null,
      sale_customer_id: null,
    };
    if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) {
      throw new Error(
        `Debt #${before.debt_id} changed financially or lost its payment history.`
      );
    }
  }
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
    }));
}

async function updateReference(
  connection,
  spec,
  branchId,
  targetCustomerId,
  sourceCustomerIds
) {
  if (sourceCustomerIds.length === 0) return 0;
  if (!(await tableExists(connection, spec.table))) return 0;
  if (!(await columnExists(connection, spec.table, spec.column))) return 0;

  const placeholders = sourceCustomerIds.map(() => "?").join(",");
  const tableSql = safeIdentifier(spec.table);
  const columnSql = safeIdentifier(spec.column);
  let where = `${columnSql} IN (${placeholders})`;
  const params = [targetCustomerId, ...sourceCustomerIds];

  if (
    spec.branchColumn &&
    (await columnExists(connection, spec.table, spec.branchColumn))
  ) {
    where = `${safeIdentifier(spec.branchColumn)} = ? AND ${where}`;
    params.splice(1, 0, branchId);
  }

  const [result] = await connection.query(
    `UPDATE ${tableSql} SET ${columnSql} = ? WHERE ${where}`,
    params
  );
  return Number(result.affectedRows || 0);
}

router.post(
  "/merge-accounts",
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      const branchId = getBranchId(req);
      const request = parseMergeRequest(req);
      validateMergeRequest(branchId, request);

      const sourceCustomerIds = request.sources
        .filter((source) => source.type === "customer")
        .map((source) => source.id);
      const legacyDebtIds = request.sources
        .filter((source) => source.type === "legacy")
        .map((source) => source.id);

      await connection.beginTransaction();
      transactionStarted = true;

      const before = await financialSnapshot(connection);
      const targetCustomer = await loadTargetCustomer(
        connection,
        branchId,
        request.target.id
      );
      const sourceCustomers = await loadSourceCustomers(
        connection,
        branchId,
        sourceCustomerIds
      );
      await lockLegacyDebtIds(connection, branchId, legacyDebtIds);
      const legacyBefore = await loadLegacyDebts(
        connection,
        branchId,
        legacyDebtIds
      );

      const coreUpdates = [];
      if (sourceCustomerIds.length > 0) {
        for (const table of ["sales", "debts", "installment_agreements"]) {
          coreUpdates.push({
            table,
            affected_rows: await updateReference(
              connection,
              { table, column: "customer_id", branchColumn: "branch_id" },
              branchId,
              request.target.id,
              sourceCustomerIds
            ),
          });
        }

        const additionalReferences = await discoverAdditionalCustomerReferences(
          connection
        );
        for (const reference of additionalReferences) {
          coreUpdates.push({
            table: reference.table,
            column: reference.column,
            affected_rows: await updateReference(
              connection,
              reference,
              branchId,
              request.target.id,
              sourceCustomerIds
            ),
          });
        }
      }

      const legacySaleIds = [
        ...new Set(
          legacyBefore
            .map((row) => row.sale_id)
            .filter((saleId) => Number.isInteger(saleId) && saleId > 0)
        ),
      ];

      if (legacyDebtIds.length > 0) {
        const placeholders = legacyDebtIds.map(() => "?").join(",");
        const [result] = await connection.query(
          `UPDATE debts
           SET customer_id = ?
           WHERE branch_id = ?
             AND id IN (${placeholders})
             AND customer_id IS NULL`,
          [request.target.id, branchId, ...legacyDebtIds]
        );
        if (Number(result.affectedRows || 0) !== legacyDebtIds.length) {
          throw new Error(
            "A receipt-level debt changed while the merge was being prepared. No data was saved."
          );
        }
      }

      if (legacySaleIds.length > 0) {
        const placeholders = legacySaleIds.map(() => "?").join(",");
        const [result] = await connection.query(
          `UPDATE sales
           SET customer_id = ?
           WHERE branch_id = ?
             AND id IN (${placeholders})
             AND customer_id IS NULL`,
          [request.target.id, branchId, ...legacySaleIds]
        );
        if (Number(result.affectedRows || 0) !== legacySaleIds.length) {
          throw new Error(
            "A receipt-level sale changed while the merge was being prepared. No data was saved."
          );
        }
      }

      let removedCustomers = 0;
      if (sourceCustomerIds.length > 0) {
        const placeholders = sourceCustomerIds.map(() => "?").join(",");
        const [deleteResult] = await connection.query(
          `DELETE FROM customers
           WHERE branch_id = ? AND id IN (${placeholders})`,
          [branchId, ...sourceCustomerIds]
        );
        removedCustomers = Number(deleteResult.affectedRows || 0);
        if (removedCustomers !== sourceCustomerIds.length) {
          throw new Error(
            "Not every duplicate customer profile could be removed safely. No data was saved."
          );
        }
      }

      const legacyAfter = await loadLegacyDebts(
        connection,
        branchId,
        legacyDebtIds,
        { expectedCustomerId: request.target.id }
      );
      assertLegacyRowsPreserved(
        legacyBefore,
        legacyAfter,
        request.target.id
      );

      const after = await financialSnapshot(connection);
      assertFinancialSnapshot(before, after, {
        removedCustomerCount: removedCustomers,
        linkedLegacyDebtCount: legacyDebtIds.length,
        linkedLegacySaleCount: legacySaleIds.length,
      });

      await writeAuditEvent({
        connection,
        req,
        branchId,
        action: "MERGE_DEBT_DESK_ACCOUNTS",
        details: `Merged ${request.sources.length} top Debt Desk account(s) into ${targetCustomer.name}. Reason: ${request.reason}`,
        workspaceCode: "spare_parts",
        entityType: "customer",
        entityId: request.target.id,
        actionType: "MERGE_DEBT_DESK_ACCOUNTS",
        outcome: "success",
        severity: "warning",
        metadata: {
          source: "top_debt_desk",
          target_customer: targetCustomer,
          saved_source_customers: sourceCustomers,
          receipt_level_debt_ids: legacyDebtIds,
          core_updates: coreUpdates,
          removed_customer_profiles: removedCustomers,
          reason: request.reason,
          financial_values_changed: false,
          payment_history_changed: false,
          stock_changed: false,
          daily_closing_changed: false,
        },
      });

      await connection.commit();
      transactionStarted = false;

      return res.json({
        status: "success",
        message: `Accounts were merged into ${targetCustomer.name}. Receipts, balances and payment history were preserved.`,
        result: {
          target_customer_id: request.target.id,
          target_customer_name: targetCustomer.name,
          merged_account_keys: request.sources.map((source) => source.key),
          saved_customer_profiles_removed: removedCustomers,
          receipt_level_debts_linked: legacyDebtIds.length,
          financial_values_changed: false,
          payment_history_changed: false,
        },
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {}
      }
      console.error("Top Debt Desk account merge error:", error);
      const duplicateConflict = error?.code === "ER_DUP_ENTRY";
      return res.status(error.statusCode || (duplicateConflict ? 409 : 500)).json({
        status: "error",
        message: duplicateConflict
          ? "The merge was stopped because the selected accounts conflict with a unique linked record elsewhere. No data was changed."
          : error.statusCode && error.message
            ? error.message
            : error.message || "Could not merge these accounts. No partial merge was saved.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
module.exports.parseAccountKey = parseAccountKey;
module.exports.assertFinancialSnapshot = assertFinancialSnapshot;
module.exports.assertLegacyRowsPreserved = assertLegacyRowsPreserved;
