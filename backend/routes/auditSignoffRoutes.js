const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

const allowedPeriodTypes = ["all", "today", "week", "month", "year", "custom"];
const allowedPeriodStatuses = ["draft", "reviewed", "approved", "rejected"];

let tableReadyPromise = null;
let reapprovalTableReadyPromise = null;

const EXTENDED_SIGNOFF_CHECK_COLUMNS = [
  {
    name: "purchases_checked",
    definition: "purchases_checked BOOLEAN NOT NULL DEFAULT FALSE AFTER reports_checked",
  },
  {
    name: "returns_checked",
    definition: "returns_checked BOOLEAN NOT NULL DEFAULT FALSE AFTER purchases_checked",
  },
  {
    name: "transfers_checked",
    definition: "transfers_checked BOOLEAN NOT NULL DEFAULT FALSE AFTER returns_checked",
  },
  {
    name: "sms_checked",
    definition: "sms_checked BOOLEAN NOT NULL DEFAULT FALSE AFTER transfers_checked",
  },
  {
    name: "stock_ledger_checked",
    definition:
      "stock_ledger_checked BOOLEAN NOT NULL DEFAULT FALSE AFTER sms_checked",
  },
  {
    name: "backup_checked",
    definition: "backup_checked BOOLEAN NOT NULL DEFAULT FALSE AFTER stock_ledger_checked",
  },
  {
    name: "maintenance_checked",
    definition:
      "maintenance_checked BOOLEAN NOT NULL DEFAULT FALSE AFTER backup_checked",
  },
];

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function cleanDate(value) {
  const text = cleanText(value);
  if (!text) return null;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function cleanInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(number);
}

function cleanBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function cleanPeriodType(value) {
  const cleanValue = String(value || "month").toLowerCase();
  return allowedPeriodTypes.includes(cleanValue) ? cleanValue : "month";
}

function cleanPeriodStatus(value) {
  const cleanValue = String(value || "draft").toLowerCase();
  return allowedPeriodStatuses.includes(cleanValue) ? cleanValue : "draft";
}

function getUserId(req) {
  return req.user?.id || req.user?.user_id || null;
}

function getUserRole(req) {
  return String(req.user?.role || "").toLowerCase();
}

function getUserDisplayName(req) {
  return (
    cleanText(req.user?.full_name) ||
    cleanText(req.user?.username) ||
    cleanText(req.user?.email) ||
    null
  );
}

function requireAdminOrManager(req, res, next) {
  const role = getUserRole(req);

  if (role !== "admin" && role !== "manager" && role !== "auditor") {
    return res.status(403).json({
      status: "error",
      message: "Only admin, manager or auditor can access audit sign-offs.",
    });
  }

  return next();
}

function requireAdmin(req, res, next) {
  const role = getUserRole(req);

  if (role !== "admin" && role !== "auditor") {
    return res.status(403).json({
      status: "error",
      message: "Only admin or auditor can request protected audit sign-off actions.",
    });
  }

  return next();
}

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    null
  );
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function normalizeDateForSql(value) {
  const cleanValue = cleanDate(value);
  return cleanValue || null;
}

function escapeLike(value) {
  return String(value || "").replace(/[%_\\]/g, "\\$&");
}

function resolvePeriodRange({ periodType, periodStart, periodEnd }) {
  const start = normalizeDateForSql(periodStart);
  const end = normalizeDateForSql(periodEnd);

  if (start || end) {
    return {
      from: start,
      to: end || start,
    };
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (periodType === "today") {
    return { from: today, to: today };
  }

  if (periodType === "week") {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    return {
      from: monday.toISOString().slice(0, 10),
      to: sunday.toISOString().slice(0, 10),
    };
  }

  if (periodType === "month") {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return {
      from: firstDay.toISOString().slice(0, 10),
      to: lastDay.toISOString().slice(0, 10),
    };
  }

  if (periodType === "year") {
    return {
      from: `${now.getFullYear()}-01-01`,
      to: `${now.getFullYear()}-12-31`,
    };
  }

  return {
    from: null,
    to: null,
  };
}

function addDateFilter(sqlParts, params, columnName, from, to) {
  if (from) {
    sqlParts.push(`DATE(${columnName}) >= ?`);
    params.push(from);
  }

  if (to) {
    sqlParts.push(`DATE(${columnName}) <= ?`);
    params.push(to);
  }
}

async function ensureColumn(tableName, columnName, columnDefinition) {
  const [columns] = await pool.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [
    columnName,
  ]);

  if (columns.length === 0) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

async function ensureIndex(tableName, indexName, indexDefinition) {
  const [indexes] = await pool.query(
    `SHOW INDEX FROM ${tableName} WHERE Key_name = ?`,
    [indexName]
  );

  if (indexes.length === 0) {
    await pool.query(`ALTER TABLE ${tableName} ADD INDEX ${indexDefinition}`);
  }
}

async function tableExists(connection, tableName) {
  try {
    const [rows] = await connection.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       LIMIT 1`,
      [tableName]
    );

    return rows.length > 0;
  } catch (error) {
    console.warn(`Could not check if table ${tableName} exists:`, error.message);
    return false;
  }
}

async function getTableColumnsFromConnection(connection, tableName) {
  try {
    const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
    return columns.map((column) => column.Field);
  } catch (error) {
    console.warn(`Could not read columns for ${tableName}:`, error.message);
    return [];
  }
}

async function safeQueryOne(connection, label, sql, params, warnings) {
  try {
    const [rows] = await connection.query(sql, params);
    return rows[0] || {};
  } catch (error) {
    warnings.push(`${label} could not be checked: ${error.message}`);
    console.warn(`${label} query skipped:`, error.message);
    return {};
  }
}

async function safeQueryRows(connection, label, sql, params, warnings) {
  try {
    const [rows] = await connection.query(sql, params);
    return rows;
  } catch (error) {
    warnings.push(`${label} could not be checked: ${error.message}`);
    console.warn(`${label} query skipped:`, error.message);
    return [];
  }
}

async function ensureAuditSignoffsTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_signoffs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id INT NOT NULL DEFAULT 1,
          period_type ENUM('all', 'today', 'week', 'month', 'year', 'custom') NOT NULL DEFAULT 'month',
          period_label VARCHAR(255) NOT NULL,
          period_start DATE NULL,
          period_end DATE NULL,
          audit_score INT NOT NULL DEFAULT 0,
          audit_status VARCHAR(50) NOT NULL DEFAULT 'Needs Review',
          prepared_by_name VARCHAR(150),
          reviewed_by_name VARCHAR(150),
          approved_by_name VARCHAR(150),
          review_date DATE NULL,
          period_status ENUM('draft', 'reviewed', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
          sales_checked BOOLEAN NOT NULL DEFAULT FALSE,
          expenses_checked BOOLEAN NOT NULL DEFAULT FALSE,
          debts_checked BOOLEAN NOT NULL DEFAULT FALSE,
          stock_checked BOOLEAN NOT NULL DEFAULT FALSE,
          warnings_checked BOOLEAN NOT NULL DEFAULT FALSE,
          reports_checked BOOLEAN NOT NULL DEFAULT FALSE,
          purchases_checked BOOLEAN NOT NULL DEFAULT FALSE,
          returns_checked BOOLEAN NOT NULL DEFAULT FALSE,
          transfers_checked BOOLEAN NOT NULL DEFAULT FALSE,
          sms_checked BOOLEAN NOT NULL DEFAULT FALSE,
          stock_ledger_checked BOOLEAN NOT NULL DEFAULT FALSE,
          backup_checked BOOLEAN NOT NULL DEFAULT FALSE,
          maintenance_checked BOOLEAN NOT NULL DEFAULT FALSE,
          accountant_notes TEXT,
          management_notes TEXT,
          created_by INT,
          approved_by INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_audit_signoff_branch (branch_id),
          INDEX idx_audit_signoff_period_type (period_type),
          INDEX idx_audit_signoff_period_dates (period_start, period_end),
          INDEX idx_audit_signoff_status (period_status),
          INDEX idx_audit_signoff_created_by (created_by),
          INDEX idx_audit_signoff_approved_by (approved_by),
          INDEX idx_audit_signoff_created_at (created_at)
        )
      `);

      await ensureColumn(
        "audit_signoffs",
        "branch_id",
        "branch_id INT NOT NULL DEFAULT 1 AFTER id"
      );

      await ensureIndex(
        "audit_signoffs",
        "idx_audit_signoff_branch",
        "idx_audit_signoff_branch (branch_id)"
      );

      for (const column of EXTENDED_SIGNOFF_CHECK_COLUMNS) {
        await ensureColumn("audit_signoffs", column.name, column.definition);
      }
    })().catch((error) => {
      tableReadyPromise = null;
      throw error;
    });
  }

  await tableReadyPromise;
}

async function ensureAuditReapprovalLogTable() {
  if (!reapprovalTableReadyPromise) {
    reapprovalTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_reapproval_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id INT NOT NULL DEFAULT 1,

          audit_signoff_id INT NULL,
          unlock_request_id INT NULL,

          period_label VARCHAR(255) NOT NULL,
          period_start DATE NULL,
          period_end DATE NULL,

          previous_status VARCHAR(50) NULL,
          new_status VARCHAR(50) NOT NULL DEFAULT 'approved',

          audit_score INT NOT NULL DEFAULT 0,
          audit_status VARCHAR(50) NULL,

          reapproved_by INT NULL,
          reapproved_by_name VARCHAR(150) NULL,
          reapproved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

          reapproval_notes TEXT,
          accountant_notes TEXT,
          management_notes TEXT,

          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

          INDEX idx_reapproval_branch (branch_id),
          INDEX idx_reapproval_signoff (audit_signoff_id),
          INDEX idx_reapproval_unlock_request (unlock_request_id),
          INDEX idx_reapproval_period_dates (period_start, period_end),
          INDEX idx_reapproval_user (reapproved_by),
          INDEX idx_reapproval_date (reapproved_at)
        )
      `);

      await ensureColumn(
        "audit_reapproval_log",
        "branch_id",
        "branch_id INT NOT NULL DEFAULT 1 AFTER id"
      );

      await ensureIndex(
        "audit_reapproval_log",
        "idx_reapproval_branch",
        "idx_reapproval_branch (branch_id)"
      );
    })().catch((error) => {
      reapprovalTableReadyPromise = null;
      throw error;
    });
  }

  await reapprovalTableReadyPromise;
}

async function safeLogActivity(
  connection,
  userId,
  branchId,
  action,
  details,
  ipAddress
) {
  try {
    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      [branchId || null, userId || null, action, details || null, ipAddress || null]
    );
  } catch (error) {
    console.warn("Could not write audit signoff activity log:", error.message);
  }
}

async function findLatestApprovedUnlockRequest(connection, signoffId, branchId) {
  if (!signoffId) return null;

  try {
    const [rows] = await connection.query(
      `
      SELECT
        id,
        branch_id,
        audit_signoff_id,
        reason,
        review_notes,
        reviewed_by,
        reviewed_at,
        created_at
      FROM audit_unlock_requests
      WHERE branch_id = ?
      AND audit_signoff_id = ?
      AND status = 'approved'
      ORDER BY reviewed_at DESC, updated_at DESC, id DESC
      LIMIT 1
      `,
      [branchId, signoffId]
    );

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.warn(
      "Could not check latest approved audit unlock request:",
      error.message
    );

    return null;
  }
}

async function createReapprovalLogIfNeeded({
  connection,
  branchId,
  signoffId,
  latestApprovedUnlockRequest,
  previousStatus,
  periodStatus,
  periodLabel,
  periodStart,
  periodEnd,
  auditScore,
  auditStatus,
  reapprovedBy,
  reapprovedByName,
  reapprovalNotes,
  accountantNotes,
  managementNotes,
}) {
  if (!branchId) return false;
  if (!signoffId) return false;
  if (!latestApprovedUnlockRequest?.id) return false;
  if (previousStatus === "approved") return false;
  if (periodStatus !== "approved") return false;

  await ensureAuditReapprovalLogTable();

  const [existingLogRows] = await connection.query(
    `
    SELECT id
    FROM audit_reapproval_log
    WHERE branch_id = ?
    AND audit_signoff_id = ?
    AND unlock_request_id = ?
    LIMIT 1
    `,
    [branchId, signoffId, latestApprovedUnlockRequest.id]
  );

  if (existingLogRows.length > 0) {
    return false;
  }

  const finalReapprovalNotes =
    reapprovalNotes ||
    managementNotes ||
    latestApprovedUnlockRequest.review_notes ||
    latestApprovedUnlockRequest.reason ||
    `Period re-approved after unlock request #${latestApprovedUnlockRequest.id}.`;

  await connection.query(
    `
    INSERT INTO audit_reapproval_log (
      branch_id,
      audit_signoff_id,
      unlock_request_id,
      period_label,
      period_start,
      period_end,
      previous_status,
      new_status,
      audit_score,
      audit_status,
      reapproved_by,
      reapproved_by_name,
      reapproval_notes,
      accountant_notes,
      management_notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      branchId,
      signoffId,
      latestApprovedUnlockRequest.id,
      periodLabel,
      periodStart,
      periodEnd,
      previousStatus || null,
      auditScore,
      auditStatus,
      reapprovedBy || null,
      reapprovedByName || null,
      finalReapprovalNotes,
      accountantNotes || null,
      managementNotes || null,
    ]
  );

  return true;
}

function normalizeSignoff(row) {
  if (!row) return null;

  return {
    id: row.id,
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    branch_location: row.branch_location,
    period_type: row.period_type,
    period_label: row.period_label,
    period_start: row.period_start,
    period_end: row.period_end,
    audit_score: Number(row.audit_score || 0),
    audit_status: row.audit_status,
    prepared_by_name: row.prepared_by_name,
    reviewed_by_name: row.reviewed_by_name,
    approved_by_name: row.approved_by_name,
    review_date: row.review_date,
    period_status: row.period_status,
    sales_checked: Boolean(row.sales_checked),
    expenses_checked: Boolean(row.expenses_checked),
    debts_checked: Boolean(row.debts_checked),
    stock_checked: Boolean(row.stock_checked),
    warnings_checked: Boolean(row.warnings_checked),
    reports_checked: Boolean(row.reports_checked),
    purchases_checked: Boolean(row.purchases_checked),
    returns_checked: Boolean(row.returns_checked),
    transfers_checked: Boolean(row.transfers_checked),
    sms_checked: Boolean(row.sms_checked),
    stock_ledger_checked: Boolean(row.stock_ledger_checked),
    backup_checked: Boolean(row.backup_checked),
    maintenance_checked: Boolean(row.maintenance_checked),
    accountant_notes: row.accountant_notes,
    management_notes: row.management_notes,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    approved_by: row.approved_by,
    approved_by_user_name: row.approved_by_user_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeReapprovalLog(row) {
  if (!row) return null;

  return {
    id: row.id,
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    branch_location: row.branch_location,
    audit_signoff_id: row.audit_signoff_id,
    unlock_request_id: row.unlock_request_id,
    period_label: row.period_label,
    period_start: row.period_start,
    period_end: row.period_end,
    previous_status: row.previous_status,
    new_status: row.new_status,
    audit_score: Number(row.audit_score || 0),
    audit_status: row.audit_status,
    reapproved_by: row.reapproved_by,
    reapproved_by_name: row.reapproved_by_name,
    reapproved_at: row.reapproved_at,
    reapproval_notes: row.reapproval_notes,
    accountant_notes: row.accountant_notes,
    management_notes: row.management_notes,
    unlock_reason: row.unlock_reason,
    unlock_review_notes: row.unlock_review_notes,
    created_at: row.created_at,
  };
}

function buildSignoffPayload(req) {
  const periodStatus = cleanPeriodStatus(req.body.period_status);
  const userId = getUserId(req);

  return {
    periodType: cleanPeriodType(req.body.period_type),
    periodLabel: cleanText(req.body.period_label),
    periodStart: cleanDate(req.body.period_start),
    periodEnd: cleanDate(req.body.period_end),
    auditScore: cleanInteger(req.body.audit_score, 0),
    auditStatus: cleanText(req.body.audit_status) || "Needs Review",
    preparedByName: cleanText(req.body.prepared_by_name),
    reviewedByName: cleanText(req.body.reviewed_by_name),
    approvedByName: cleanText(req.body.approved_by_name),
    reviewDate: cleanDate(req.body.review_date),
    periodStatus,
    salesChecked: cleanBoolean(req.body.sales_checked),
    expensesChecked: cleanBoolean(req.body.expenses_checked),
    debtsChecked: cleanBoolean(req.body.debts_checked),
    stockChecked: cleanBoolean(req.body.stock_checked),
    warningsChecked: cleanBoolean(req.body.warnings_checked),
    reportsChecked: cleanBoolean(req.body.reports_checked),
    purchasesChecked: cleanBoolean(req.body.purchases_checked),
    returnsChecked: cleanBoolean(req.body.returns_checked),
    transfersChecked: cleanBoolean(req.body.transfers_checked),
    smsChecked: cleanBoolean(req.body.sms_checked),
    stockLedgerChecked: cleanBoolean(req.body.stock_ledger_checked),
    backupChecked: cleanBoolean(req.body.backup_checked),
    maintenanceChecked: cleanBoolean(req.body.maintenance_checked),
    accountantNotes: cleanText(req.body.accountant_notes),
    managementNotes: cleanText(req.body.management_notes),
    reapprovalNotes: cleanText(req.body.reapproval_notes),
    approvedBy: periodStatus === "approved" ? userId : null,
  };
}

async function buildAuditReviewSummary(connection, req) {
  const branchId = getBranchId(req);
  const periodType = cleanPeriodType(req.query.period_type);
  const periodLabel = cleanText(req.query.period_label);
  const requestedStart = cleanDate(req.query.period_start || req.query.from);
  const requestedEnd = cleanDate(req.query.period_end || req.query.to);
  const { from, to } = resolvePeriodRange({
    periodType,
    periodStart: requestedStart,
    periodEnd: requestedEnd,
  });

  const warnings = [];
  const missingTables = [];
  const checkedTables = [
    "branches",
    "users",
    "settings",
    "products",
    "stock_adjustments",
    "stock_transfers",
    "stock_transfer_items",
    "customers",
    "sales",
    "sale_items",
    "debts",
    "debt_payments",
    "returns",
    "expenses",
    "purchases",
    "purchase_items",
    "purchase_payments",
    "daily_closings",
    "audit_signoffs",
    "audit_unlock_requests",
    "audit_reapproval_log",
    "sms_log",
    "activity_log",
  ];

  const tableStatus = {};

  for (const tableName of checkedTables) {
    const exists = await tableExists(connection, tableName);
    tableStatus[tableName] = exists;

    if (!exists) {
      missingTables.push(tableName);
    }
  }

  if (missingTables.length > 0) {
    warnings.push(
      `Some audit source tables are missing and were skipped: ${missingTables.join(
        ", "
      )}.`
    );
  }

  const branch = await safeQueryOne(
    connection,
    "Branch summary",
    `SELECT id, name, location
     FROM branches
     WHERE id = ?
     LIMIT 1`,
    [branchId],
    warnings
  );

  const salesWhere = ["branch_id = ?"];
  const salesParams = [branchId];
  addDateFilter(salesWhere, salesParams, "created_at", from, to);

  const salesSummary = tableStatus.sales
    ? await safeQueryOne(
        connection,
        "Sales summary",
        `
        SELECT
          COUNT(*) AS total_sales,
          COALESCE(SUM(total), 0) AS total_sales_amount,
          COALESCE(SUM(amount_paid), 0) AS total_amount_paid,
          COALESCE(SUM(balance), 0) AS total_balance,
          COALESCE(SUM(CASE WHEN payment_type = 'cash' THEN total ELSE 0 END), 0) AS cash_sales,
          COALESCE(SUM(CASE WHEN payment_type = 'momo' THEN total ELSE 0 END), 0) AS momo_sales,
          COALESCE(SUM(CASE WHEN payment_type = 'bank' THEN total ELSE 0 END), 0) AS bank_sales,
          COALESCE(SUM(CASE WHEN payment_type = 'credit' THEN total ELSE 0 END), 0) AS credit_sales,
          COALESCE(SUM(CASE WHEN payment_type = 'mixed' THEN total ELSE 0 END), 0) AS mixed_sales,
          COALESCE(SUM(CASE WHEN is_voided = TRUE THEN 1 ELSE 0 END), 0) AS voided_sales_count,
          COALESCE(SUM(CASE WHEN is_voided = TRUE THEN total ELSE 0 END), 0) AS voided_sales_amount
        FROM sales
        WHERE ${salesWhere.join(" AND ")}
        `,
        salesParams,
        warnings
      )
    : {};

  const saleItemsSummary = tableStatus.sale_items && tableStatus.sales
    ? await safeQueryOne(
        connection,
        "Sale items summary",
        `
        SELECT
          COUNT(si.id) AS total_sale_items,
          COALESCE(SUM(si.quantity), 0) AS total_quantity_sold,
          COALESCE(SUM(si.line_total), 0) AS total_sale_items_amount
        FROM sale_items si
        INNER JOIN sales s ON si.sale_id = s.id
        WHERE ${salesWhere.map((part) => part.replace("branch_id", "s.branch_id").replace("created_at", "s.created_at")).join(" AND ")}
        `,
        salesParams,
        warnings
      )
    : {};

  const debtsWhere = ["branch_id = ?"];
  const debtsParams = [branchId];
  addDateFilter(debtsWhere, debtsParams, "created_at", from, to);

  const debtSummary = tableStatus.debts
    ? await safeQueryOne(
        connection,
        "Debt summary",
        `
        SELECT
          COUNT(*) AS total_debts,
          COALESCE(SUM(amount_owed), 0) AS total_debt_amount,
          COALESCE(SUM(amount_paid), 0) AS total_debt_paid,
          COALESCE(SUM(balance), 0) AS total_debt_balance,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_debt_count,
          COALESCE(SUM(CASE WHEN status != 'paid' THEN 1 ELSE 0 END), 0) AS unpaid_debt_count
        FROM debts
        WHERE ${debtsWhere.join(" AND ")}
        `,
        debtsParams,
        warnings
      )
    : {};

  const debtPaymentWhere = ["d.branch_id = ?"];
  const debtPaymentParams = [branchId];
  addDateFilter(debtPaymentWhere, debtPaymentParams, "dp.paid_at", from, to);

  const debtPaymentSummary = tableStatus.debt_payments && tableStatus.debts
    ? await safeQueryOne(
        connection,
        "Debt payment summary",
        `
        SELECT
          COUNT(dp.id) AS total_debt_payments,
          COALESCE(SUM(dp.amount), 0) AS total_debt_payment_amount
        FROM debt_payments dp
        INNER JOIN debts d ON dp.debt_id = d.id
        WHERE ${debtPaymentWhere.join(" AND ")}
        `,
        debtPaymentParams,
        warnings
      )
    : {};

  const expensesWhere = ["branch_id = ?"];
  const expensesParams = [branchId];
  addDateFilter(expensesWhere, expensesParams, "expense_date", from, to);

  const expensesSummary = tableStatus.expenses
    ? await safeQueryOne(
        connection,
        "Expense summary",
        `
        SELECT
          COUNT(*) AS total_expenses,
          COALESCE(SUM(amount), 0) AS total_expense_amount
        FROM expenses
        WHERE ${expensesWhere.join(" AND ")}
        `,
        expensesParams,
        warnings
      )
    : {};

  const purchasesWhere = ["branch_id = ?"];
  const purchasesParams = [branchId];
  addDateFilter(purchasesWhere, purchasesParams, "purchase_date", from, to);

  const purchasesSummary = tableStatus.purchases
    ? await safeQueryOne(
        connection,
        "Purchase summary",
        `
        SELECT
          COUNT(*) AS total_purchases,
          COALESCE(SUM(total_amount), 0) AS total_purchase_amount,
          COALESCE(SUM(amount_paid), 0) AS total_purchase_paid,
          COALESCE(SUM(balance), 0) AS total_purchase_balance
        FROM purchases
        WHERE ${purchasesWhere.join(" AND ")}
        `,
        purchasesParams,
        warnings
      )
    : {};

  const returnsWhere = ["branch_id = ?"];
  const returnsParams = [branchId];
  addDateFilter(returnsWhere, returnsParams, "returned_at", from, to);

  const returnsSummary = tableStatus.returns
    ? await safeQueryOne(
        connection,
        "Returns summary",
        `
        SELECT
          COUNT(*) AS total_returns,
          COALESCE(SUM(refund_amount), 0) AS total_refund_amount,
          COALESCE(SUM(quantity), 0) AS total_return_quantity
        FROM returns
        WHERE ${returnsWhere.join(" AND ")}
        `,
        returnsParams,
        warnings
      )
    : {};

  const productSummary = tableStatus.products
    ? await safeQueryOne(
        connection,
        "Product stock summary",
        `
        SELECT
          COUNT(*) AS total_products,
          COALESCE(SUM(quantity), 0) AS total_stock_quantity,
          COALESCE(SUM(quantity * cost_price), 0) AS stock_value_at_cost,
          COALESCE(SUM(quantity * selling_price), 0) AS stock_value_at_selling,
          COALESCE(SUM(CASE WHEN quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) AS low_stock_count,
          COALESCE(SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock_count
        FROM products
        WHERE branch_id = ?
        AND is_active = TRUE
        `,
        [branchId],
        warnings
      )
    : {};

  const adjustmentWhere = ["branch_id = ?"];
  const adjustmentParams = [branchId];
  addDateFilter(adjustmentWhere, adjustmentParams, "adjusted_at", from, to);

  const stockAdjustmentSummary = tableStatus.stock_adjustments
    ? await safeQueryOne(
        connection,
        "Stock adjustment summary",
        `
        SELECT
          COUNT(*) AS total_adjustments,
          COALESCE(SUM(CASE WHEN adjustment_type = 'increase' THEN 1 ELSE 0 END), 0) AS increase_count,
          COALESCE(SUM(CASE WHEN adjustment_type = 'decrease' THEN 1 ELSE 0 END), 0) AS decrease_count,
          COALESCE(SUM(CASE WHEN adjustment_type = 'set' THEN 1 ELSE 0 END), 0) AS set_count,
          COALESCE(SUM(CASE WHEN adjustment_type = 'increase' THEN quantity ELSE 0 END), 0) AS total_increased_quantity,
          COALESCE(SUM(CASE WHEN adjustment_type = 'decrease' THEN quantity ELSE 0 END), 0) AS total_decreased_quantity,
          COALESCE(SUM(CASE WHEN LOWER(reason) LIKE '%damag%' THEN 1 ELSE 0 END), 0) AS damaged_count,
          COALESCE(SUM(CASE WHEN LOWER(reason) LIKE '%lost%' THEN 1 ELSE 0 END), 0) AS lost_count,
          COALESCE(SUM(CASE WHEN LOWER(reason) LIKE '%physical%' OR LOWER(reason) LIKE '%count%' THEN 1 ELSE 0 END), 0) AS physical_count_count,
          COALESCE(SUM(CASE WHEN LOWER(reason) LIKE '%wrong%' OR LOWER(reason) LIKE '%mistake%' OR LOWER(reason) LIKE '%error%' THEN 1 ELSE 0 END), 0) AS correction_count
        FROM stock_adjustments
        WHERE ${adjustmentWhere.join(" AND ")}
        `,
        adjustmentParams,
        warnings
      )
    : {};

  const transferWhere = ["(st.from_branch_id = ? OR st.to_branch_id = ?)"];
  const transferParams = [branchId, branchId];
  addDateFilter(transferWhere, transferParams, "st.created_at", from, to);

  const stockTransferSummary = tableStatus.stock_transfers
    ? await safeQueryOne(
        connection,
        "Stock transfer summary",
        `
        SELECT
          COUNT(DISTINCT st.id) AS total_transfers,
          COALESCE(SUM(CASE WHEN st.from_branch_id = ? THEN 1 ELSE 0 END), 0) AS transfer_out_count,
          COALESCE(SUM(CASE WHEN st.to_branch_id = ? THEN 1 ELSE 0 END), 0) AS transfer_in_count,
          COALESCE(SUM(CASE WHEN st.status = 'requested' THEN 1 ELSE 0 END), 0) AS requested_count,
          COALESCE(SUM(CASE WHEN st.status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
          COALESCE(SUM(CASE WHEN st.status = 'dispatched' THEN 1 ELSE 0 END), 0) AS dispatched_count,
          COALESCE(SUM(CASE WHEN st.status = 'received' THEN 1 ELSE 0 END), 0) AS received_count,
          COALESCE(SUM(CASE WHEN st.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
          COALESCE(SUM(CASE WHEN st.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count
        FROM stock_transfers st
        WHERE ${transferWhere.join(" AND ")}
        `,
        [branchId, branchId, ...transferParams],
        warnings
      )
    : {};

  const transferItemSummary = tableStatus.stock_transfers && tableStatus.stock_transfer_items
    ? await safeQueryOne(
        connection,
        "Stock transfer item summary",
        `
        SELECT
          COUNT(sti.id) AS total_transfer_items,
          COALESCE(SUM(CASE WHEN st.from_branch_id = ? THEN sti.requested_quantity ELSE 0 END), 0) AS requested_out_quantity,
          COALESCE(SUM(CASE WHEN st.from_branch_id = ? THEN sti.dispatched_quantity ELSE 0 END), 0) AS dispatched_out_quantity,
          COALESCE(SUM(CASE WHEN st.to_branch_id = ? THEN sti.received_quantity ELSE 0 END), 0) AS received_in_quantity,
          COALESCE(SUM(CASE WHEN st.status = 'received' AND COALESCE(sti.dispatched_quantity, 0) <> COALESCE(sti.received_quantity, 0) THEN 1 ELSE 0 END), 0) AS quantity_mismatch_count
        FROM stock_transfer_items sti
        INNER JOIN stock_transfers st ON sti.transfer_id = st.id
        WHERE ${transferWhere.join(" AND ")}
        `,
        [branchId, branchId, branchId, ...transferParams],
        warnings
      )
    : {};

  const dailyClosingWhere = ["branch_id = ?"];
  const dailyClosingParams = [branchId];
  addDateFilter(dailyClosingWhere, dailyClosingParams, "closing_date", from, to);

  const dailyClosingSummary = tableStatus.daily_closings
    ? await safeQueryOne(
        connection,
        "Daily closing summary",
        `
        SELECT
          COUNT(*) AS total_daily_closings,
          COALESCE(SUM(cash_difference), 0) AS total_cash_difference,
          COALESCE(SUM(momo_difference), 0) AS total_momo_difference,
          COALESCE(SUM(bank_difference), 0) AS total_bank_difference
        FROM daily_closings
        WHERE ${dailyClosingWhere.join(" AND ")}
        `,
        dailyClosingParams,
        warnings
      )
    : {};

  const smsWhere = ["branch_id = ?"];
  const smsParams = [branchId];
  addDateFilter(smsWhere, smsParams, "sent_at", from, to);

  const smsSummary = tableStatus.sms_log
    ? await safeQueryOne(
        connection,
        "SMS summary",
        `
        SELECT
          COUNT(*) AS total_sms,
          COALESCE(SUM(CASE WHEN status = 'sent' OR status = 'success' THEN 1 ELSE 0 END), 0) AS sent_count,
          COALESCE(SUM(CASE WHEN status = 'failed' OR status = 'error' THEN 1 ELSE 0 END), 0) AS failed_count,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN sms_type = 'daily_summary' THEN 1 ELSE 0 END), 0) AS daily_summary_count,
          COALESCE(SUM(CASE WHEN sms_type = 'security_alert' THEN 1 ELSE 0 END), 0) AS security_alert_count
        FROM sms_log
        WHERE ${smsWhere.join(" AND ")}
        `,
        smsParams,
        warnings
      )
    : {};

  const activityWhere = ["branch_id = ?"];
  const activityParams = [branchId];
  addDateFilter(activityWhere, activityParams, "created_at", from, to);

  const activitySummary = tableStatus.activity_log
    ? await safeQueryOne(
        connection,
        "Security and maintenance activity summary",
        `
        SELECT
          COUNT(*) AS total_activities,
          COALESCE(SUM(CASE WHEN action LIKE '%BACKUP%' THEN 1 ELSE 0 END), 0) AS backup_activity_count,
          COALESCE(SUM(CASE WHEN action LIKE '%RESTORE%' THEN 1 ELSE 0 END), 0) AS restore_activity_count,
          COALESCE(SUM(CASE WHEN action LIKE '%CLEAR_BUSINESS_DATA%' THEN 1 ELSE 0 END), 0) AS clear_business_data_count,
          COALESCE(SUM(CASE WHEN action LIKE '%AUDIT%' THEN 1 ELSE 0 END), 0) AS audit_activity_count,
          COALESCE(SUM(CASE WHEN action LIKE '%VOID%' THEN 1 ELSE 0 END), 0) AS void_activity_count,
          COALESCE(SUM(CASE WHEN action LIKE '%DELETE%' THEN 1 ELSE 0 END), 0) AS delete_activity_count
        FROM activity_log
        WHERE ${activityWhere.join(" AND ")}
        `,
        activityParams,
        warnings
      )
    : {};

  const signoffWhere = ["branch_id = ?"];
  const signoffParams = [branchId];
  addDateFilter(signoffWhere, signoffParams, "created_at", from, to);

  const signoffSummary = tableStatus.audit_signoffs
    ? await safeQueryOne(
        connection,
        "Audit signoff summary",
        `
        SELECT
          COUNT(*) AS total_signoffs,
          COALESCE(SUM(CASE WHEN period_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
          COALESCE(SUM(CASE WHEN period_status = 'reviewed' THEN 1 ELSE 0 END), 0) AS reviewed_count,
          COALESCE(SUM(CASE WHEN period_status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_count,
          COALESCE(SUM(CASE WHEN period_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count
        FROM audit_signoffs
        WHERE ${signoffWhere.join(" AND ")}
        `,
        signoffParams,
        warnings
      )
    : {};

  const unlockWhere = ["branch_id = ?"];
  const unlockParams = [branchId];
  addDateFilter(unlockWhere, unlockParams, "created_at", from, to);

  const unlockSummary = tableStatus.audit_unlock_requests
    ? await safeQueryOne(
        connection,
        "Audit unlock request summary",
        `
        SELECT
          COUNT(*) AS total_unlock_requests,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_unlock_count,
          COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_unlock_count,
          COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_unlock_count
        FROM audit_unlock_requests
        WHERE ${unlockWhere.join(" AND ")}
        `,
        unlockParams,
        warnings
      )
    : {};

  const recentStockAdjustments = tableStatus.stock_adjustments
    ? await safeQueryRows(
        connection,
        "Recent stock adjustments",
        `
        SELECT
          sa.id,
          sa.adjustment_type,
          sa.quantity,
          sa.old_quantity,
          sa.new_quantity,
          sa.reason,
          sa.adjusted_at,
          p.name AS product_name,
          u.full_name AS adjusted_by_name
        FROM stock_adjustments sa
        LEFT JOIN products p ON p.id = sa.product_id
        LEFT JOIN users u ON u.id = sa.adjusted_by
        WHERE ${adjustmentWhere.join(" AND ")}
        ORDER BY sa.adjusted_at DESC, sa.id DESC
        LIMIT 20
        `,
        adjustmentParams,
        warnings
      )
    : [];

  const recentStockTransfers = tableStatus.stock_transfers
    ? await safeQueryRows(
        connection,
        "Recent stock transfers",
        `
        SELECT
          st.id,
          st.transfer_number,
          st.status,
          st.created_at,
          fb.name AS from_branch_name,
          tb.name AS to_branch_name,
          u.full_name AS requested_by_name
        FROM stock_transfers st
        LEFT JOIN branches fb ON fb.id = st.from_branch_id
        LEFT JOIN branches tb ON tb.id = st.to_branch_id
        LEFT JOIN users u ON u.id = st.requested_by
        WHERE ${transferWhere.join(" AND ")}
        ORDER BY st.created_at DESC, st.id DESC
        LIMIT 20
        `,
        transferParams,
        warnings
      )
    : [];

  const recentSmsFailures = tableStatus.sms_log
    ? await safeQueryRows(
        connection,
        "Recent SMS failures",
        `
        SELECT
          id,
          recipient_phone,
          sms_type,
          status,
          error_message,
          sent_at,
          created_at
        FROM sms_log
        WHERE ${smsWhere.join(" AND ")}
        AND (status = 'failed' OR status = 'error')
        ORDER BY sent_at DESC, created_at DESC, id DESC
        LIMIT 20
        `,
        smsParams,
        warnings
      )
    : [];

  const openIssues = [];

  if (toNumber(productSummary.low_stock_count) > 0) {
    openIssues.push({
      level: "warning",
      area: "Stock",
      message: `${productSummary.low_stock_count} product(s) are at or below low-stock level.`,
    });
  }

  if (toNumber(productSummary.out_of_stock_count) > 0) {
    openIssues.push({
      level: "danger",
      area: "Stock",
      message: `${productSummary.out_of_stock_count} product(s) are out of stock.`,
    });
  }

  if (toNumber(debtSummary.total_debt_balance) > 0) {
    openIssues.push({
      level: "warning",
      area: "Debts",
      message: `Outstanding customer debt is GHS ${roundMoney(
        debtSummary.total_debt_balance
      ).toFixed(2)}.`,
    });
  }

  if (toNumber(stockAdjustmentSummary.total_adjustments) > 0) {
    openIssues.push({
      level: toNumber(stockAdjustmentSummary.total_adjustments) >= 10 ? "danger" : "warning",
      area: "Stock Adjustments",
      message: `${stockAdjustmentSummary.total_adjustments} stock adjustment record(s) found in this period. Review reasons and staff names.`,
    });
  }

  if (toNumber(stockAdjustmentSummary.damaged_count) > 0) {
    openIssues.push({
      level: "warning",
      area: "Damaged Stock",
      message: `${stockAdjustmentSummary.damaged_count} damaged-stock adjustment(s) found.`,
    });
  }

  if (toNumber(stockAdjustmentSummary.lost_count) > 0) {
    openIssues.push({
      level: "danger",
      area: "Lost Stock",
      message: `${stockAdjustmentSummary.lost_count} lost-stock adjustment(s) found.`,
    });
  }

  if (toNumber(stockTransferSummary.dispatched_count) > 0) {
    openIssues.push({
      level: "warning",
      area: "Stock Transfers",
      message: `${stockTransferSummary.dispatched_count} transfer(s) are dispatched but not yet fully received.`,
    });
  }

  if (toNumber(transferItemSummary.quantity_mismatch_count) > 0) {
    openIssues.push({
      level: "danger",
      area: "Transfer Quantity Mismatch",
      message: `${transferItemSummary.quantity_mismatch_count} transfer item(s) have dispatched/received quantity mismatch.`,
    });
  }

  if (toNumber(smsSummary.failed_count) > 0) {
    openIssues.push({
      level: "warning",
      area: "SMS",
      message: `${smsSummary.failed_count} failed SMS record(s) found. Review Arkesel/provider errors.`,
    });
  }

  if (toNumber(activitySummary.restore_activity_count) > 0) {
    openIssues.push({
      level: "danger",
      area: "Backup / Restore",
      message: `${activitySummary.restore_activity_count} restore activity record(s) found in this period. Confirm management approval.`,
    });
  }

  if (toNumber(activitySummary.clear_business_data_count) > 0) {
    openIssues.push({
      level: "danger",
      area: "Maintenance",
      message: `${activitySummary.clear_business_data_count} clear-business-data activity record(s) found. Confirm this was intentional.`,
    });
  }

  if (toNumber(dailyClosingSummary.total_daily_closings) === 0 && from && to) {
    openIssues.push({
      level: "warning",
      area: "Daily Closing",
      message:
        "No daily closing record found for this period. Daily closing should be checked before approval.",
    });
  }

  return {
    branch_id: branchId,
    branch: {
      id: branch.id || branchId,
      code: branch.branch_code || branch.code || null,
      name: branch.name || null,
      location: branch.location || null,
    },
    period: {
      period_type: periodType,
      period_label: periodLabel,
      period_start: from,
      period_end: to,
    },
    table_status: tableStatus,
    missing_tables: missingTables,
    warnings,
    open_issues: openIssues,
    summaries: {
      sales: {
        total_sales: toNumber(salesSummary.total_sales),
        total_sales_amount: roundMoney(salesSummary.total_sales_amount),
        total_amount_paid: roundMoney(salesSummary.total_amount_paid),
        total_balance: roundMoney(salesSummary.total_balance),
        cash_sales: roundMoney(salesSummary.cash_sales),
        momo_sales: roundMoney(salesSummary.momo_sales),
        bank_sales: roundMoney(salesSummary.bank_sales),
        credit_sales: roundMoney(salesSummary.credit_sales),
        mixed_sales: roundMoney(salesSummary.mixed_sales),
        voided_sales_count: toNumber(salesSummary.voided_sales_count),
        voided_sales_amount: roundMoney(salesSummary.voided_sales_amount),
        total_sale_items: toNumber(saleItemsSummary.total_sale_items),
        total_quantity_sold: toNumber(saleItemsSummary.total_quantity_sold),
      },
      debts: {
        total_debts: toNumber(debtSummary.total_debts),
        total_debt_amount: roundMoney(debtSummary.total_debt_amount),
        total_debt_paid: roundMoney(debtSummary.total_debt_paid),
        total_debt_balance: roundMoney(debtSummary.total_debt_balance),
        paid_debt_count: toNumber(debtSummary.paid_debt_count),
        unpaid_debt_count: toNumber(debtSummary.unpaid_debt_count),
        total_debt_payments: toNumber(debtPaymentSummary.total_debt_payments),
        total_debt_payment_amount: roundMoney(
          debtPaymentSummary.total_debt_payment_amount
        ),
      },
      expenses: {
        total_expenses: toNumber(expensesSummary.total_expenses),
        total_expense_amount: roundMoney(expensesSummary.total_expense_amount),
      },
      purchases: {
        total_purchases: toNumber(purchasesSummary.total_purchases),
        total_purchase_amount: roundMoney(purchasesSummary.total_purchase_amount),
        total_purchase_paid: roundMoney(purchasesSummary.total_purchase_paid),
        total_purchase_balance: roundMoney(purchasesSummary.total_purchase_balance),
      },
      returns: {
        total_returns: toNumber(returnsSummary.total_returns),
        total_refund_amount: roundMoney(returnsSummary.total_refund_amount),
        total_return_quantity: toNumber(returnsSummary.total_return_quantity),
      },
      stock: {
        total_products: toNumber(productSummary.total_products),
        total_stock_quantity: toNumber(productSummary.total_stock_quantity),
        stock_value_at_cost: roundMoney(productSummary.stock_value_at_cost),
        stock_value_at_selling: roundMoney(productSummary.stock_value_at_selling),
        low_stock_count: toNumber(productSummary.low_stock_count),
        out_of_stock_count: toNumber(productSummary.out_of_stock_count),
      },
      stock_adjustments: {
        total_adjustments: toNumber(stockAdjustmentSummary.total_adjustments),
        increase_count: toNumber(stockAdjustmentSummary.increase_count),
        decrease_count: toNumber(stockAdjustmentSummary.decrease_count),
        set_count: toNumber(stockAdjustmentSummary.set_count),
        total_increased_quantity: toNumber(
          stockAdjustmentSummary.total_increased_quantity
        ),
        total_decreased_quantity: toNumber(
          stockAdjustmentSummary.total_decreased_quantity
        ),
        damaged_count: toNumber(stockAdjustmentSummary.damaged_count),
        lost_count: toNumber(stockAdjustmentSummary.lost_count),
        physical_count_count: toNumber(
          stockAdjustmentSummary.physical_count_count
        ),
        correction_count: toNumber(stockAdjustmentSummary.correction_count),
      },
      stock_transfers: {
        total_transfers: toNumber(stockTransferSummary.total_transfers),
        transfer_out_count: toNumber(stockTransferSummary.transfer_out_count),
        transfer_in_count: toNumber(stockTransferSummary.transfer_in_count),
        requested_count: toNumber(stockTransferSummary.requested_count),
        approved_count: toNumber(stockTransferSummary.approved_count),
        dispatched_count: toNumber(stockTransferSummary.dispatched_count),
        received_count: toNumber(stockTransferSummary.received_count),
        cancelled_count: toNumber(stockTransferSummary.cancelled_count),
        rejected_count: toNumber(stockTransferSummary.rejected_count),
        total_transfer_items: toNumber(transferItemSummary.total_transfer_items),
        requested_out_quantity: toNumber(
          transferItemSummary.requested_out_quantity
        ),
        dispatched_out_quantity: toNumber(
          transferItemSummary.dispatched_out_quantity
        ),
        received_in_quantity: toNumber(transferItemSummary.received_in_quantity),
        quantity_mismatch_count: toNumber(
          transferItemSummary.quantity_mismatch_count
        ),
      },
      daily_closings: {
        total_daily_closings: toNumber(
          dailyClosingSummary.total_daily_closings
        ),
        total_cash_difference: roundMoney(
          dailyClosingSummary.total_cash_difference
        ),
        total_momo_difference: roundMoney(
          dailyClosingSummary.total_momo_difference
        ),
        total_bank_difference: roundMoney(
          dailyClosingSummary.total_bank_difference
        ),
      },
      sms: {
        total_sms: toNumber(smsSummary.total_sms),
        sent_count: toNumber(smsSummary.sent_count),
        failed_count: toNumber(smsSummary.failed_count),
        pending_count: toNumber(smsSummary.pending_count),
        daily_summary_count: toNumber(smsSummary.daily_summary_count),
        security_alert_count: toNumber(smsSummary.security_alert_count),
      },
      security_and_maintenance: {
        total_activities: toNumber(activitySummary.total_activities),
        backup_activity_count: toNumber(activitySummary.backup_activity_count),
        restore_activity_count: toNumber(activitySummary.restore_activity_count),
        clear_business_data_count: toNumber(
          activitySummary.clear_business_data_count
        ),
        audit_activity_count: toNumber(activitySummary.audit_activity_count),
        void_activity_count: toNumber(activitySummary.void_activity_count),
        delete_activity_count: toNumber(activitySummary.delete_activity_count),
      },
      audit: {
        total_signoffs: toNumber(signoffSummary.total_signoffs),
        approved_count: toNumber(signoffSummary.approved_count),
        reviewed_count: toNumber(signoffSummary.reviewed_count),
        draft_count: toNumber(signoffSummary.draft_count),
        rejected_count: toNumber(signoffSummary.rejected_count),
        total_unlock_requests: toNumber(unlockSummary.total_unlock_requests),
        pending_unlock_count: toNumber(unlockSummary.pending_unlock_count),
        approved_unlock_count: toNumber(unlockSummary.approved_unlock_count),
        rejected_unlock_count: toNumber(unlockSummary.rejected_unlock_count),
      },
    },
    recent_records: {
      stock_adjustments: recentStockAdjustments,
      stock_transfers: recentStockTransfers,
      sms_failures: recentSmsFailures,
    },
    stock_ledger_note:
      "The Stock Movement Ledger has no separate table. It is rebuilt from sales, purchases, returns, stock adjustments, and stock transfers. Review those source records before approving the period.",
    sms_note:
      "SMS audit includes Arkesel/live SMS logs, failed SMS records, daily summary SMS, and security alert SMS where sms_log is available.",
  };
}

router.get("/", requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    await ensureAuditSignoffsTable();

    const branchId = getBranchId(req);
    const periodType = cleanText(req.query.period_type);
    const periodStatus = cleanText(req.query.period_status);
    const search = cleanText(req.query.search);

    let sql = `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name,
        b.name AS branch_name,
        b.location AS branch_location
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      LEFT JOIN branches b ON a.branch_id = b.id
      WHERE a.branch_id = ?
    `;

    const params = [branchId];

    if (periodType && allowedPeriodTypes.includes(periodType)) {
      sql += " AND a.period_type = ?";
      params.push(periodType);
    }

    if (periodStatus && allowedPeriodStatuses.includes(periodStatus)) {
      sql += " AND a.period_status = ?";
      params.push(periodStatus);
    }

    if (search) {
      sql += `
        AND (
          a.period_label LIKE ?
          OR a.prepared_by_name LIKE ?
          OR a.reviewed_by_name LIKE ?
          OR a.approved_by_name LIKE ?
        )
      `;
      const searchValue = `%${escapeLike(search)}%`;
      params.push(searchValue, searchValue, searchValue, searchValue);
    }

    sql += " ORDER BY a.updated_at DESC, a.created_at DESC LIMIT 300";

    const [rows] = await pool.query(sql, params);

    return res.json({
      status: "success",
      branch_id: branchId,
      count: rows.length,
      signoffs: rows.map(normalizeSignoff),
    });
  } catch (error) {
    console.error("Get audit signoffs error:", error);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching audit sign-offs.",
    });
  }
});

router.get("/latest", requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    await ensureAuditSignoffsTable();

    const branchId = getBranchId(req);
    const periodType = cleanPeriodType(req.query.period_type);
    const periodLabel = cleanText(req.query.period_label);
    const periodStart = cleanDate(req.query.period_start);
    const periodEnd = cleanDate(req.query.period_end);

    let sql = `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name,
        b.name AS branch_name,
        b.location AS branch_location
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      LEFT JOIN branches b ON a.branch_id = b.id
      WHERE a.branch_id = ?
      AND a.period_type = ?
    `;

    const params = [branchId, periodType];

    if (periodStart || periodEnd) {
      sql += " AND a.period_start <=> ? AND a.period_end <=> ?";
      params.push(periodStart, periodEnd);
    } else if (periodLabel) {
      sql += " AND a.period_label = ?";
      params.push(periodLabel);
    }

    sql += " ORDER BY a.updated_at DESC, a.created_at DESC LIMIT 1";

    const [rows] = await pool.query(sql, params);

    return res.json({
      status: "success",
      branch_id: branchId,
      signoff: rows.length > 0 ? normalizeSignoff(rows[0]) : null,
    });
  } catch (error) {
    console.error("Get latest audit signoff error:", error);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching latest audit sign-off.",
    });
  }
});

router.get(
  "/reapproval-log",
  requireAuth,
  requireAdminOrManager,
  async (req, res) => {
    try {
      await ensureAuditReapprovalLogTable();

      const branchId = getBranchId(req);
      const signoffId = Number(req.query.audit_signoff_id || 0);
      const search = cleanText(req.query.search);
      const from = cleanDate(req.query.from);
      const to = cleanDate(req.query.to);

      let sql = `
        SELECT
          arl.*,
          aur.reason AS unlock_reason,
          aur.review_notes AS unlock_review_notes,
          b.name AS branch_name,
          b.location AS branch_location
        FROM audit_reapproval_log arl
        LEFT JOIN audit_unlock_requests aur
          ON arl.unlock_request_id = aur.id
          AND aur.branch_id = arl.branch_id
        LEFT JOIN branches b ON arl.branch_id = b.id
        WHERE arl.branch_id = ?
      `;

      const params = [branchId];

      if (Number.isInteger(signoffId) && signoffId > 0) {
        sql += " AND arl.audit_signoff_id = ?";
        params.push(signoffId);
      }

      if (from) {
        sql += " AND DATE(arl.reapproved_at) >= ?";
        params.push(from);
      }

      if (to) {
        sql += " AND DATE(arl.reapproved_at) <= ?";
        params.push(to);
      }

      if (search) {
        sql += `
          AND (
            arl.period_label LIKE ?
            OR arl.reapproved_by_name LIKE ?
            OR arl.reapproval_notes LIKE ?
            OR arl.accountant_notes LIKE ?
            OR arl.management_notes LIKE ?
            OR aur.reason LIKE ?
            OR aur.review_notes LIKE ?
          )
        `;

        const searchValue = `%${escapeLike(search)}%`;

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

      sql += " ORDER BY arl.reapproved_at DESC, arl.id DESC LIMIT 300";

      const [rows] = await pool.query(sql, params);

      const [summaryRows] = await pool.query(
        `
        SELECT
          COUNT(*) AS total_reapprovals,
          MAX(reapproved_at) AS latest_reapproval_at
        FROM audit_reapproval_log
        WHERE branch_id = ?
        `,
        [branchId]
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        count: rows.length,
        summary: summaryRows[0] || {
          total_reapprovals: 0,
          latest_reapproval_at: null,
        },
        logs: rows.map(normalizeReapprovalLog),
      });
    } catch (error) {
      console.error("Get audit reapproval log error:", error);
      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching audit re-approval log.",
      });
    }
  }
);

router.get(
  "/review-summary",
  requireAuth,
  requireAdminOrManager,
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      await ensureAuditSignoffsTable();
      await ensureAuditReapprovalLogTable();

      const summary = await buildAuditReviewSummary(connection, req);

      return res.json({
        status: "success",
        message:
          "Audit review summary loaded with sales, debts, expenses, purchases, returns, stock adjustments, stock transfers, stock ledger source records, SMS, backup, restore and maintenance checks.",
        ...summary,
      });
    } catch (error) {
      console.error("Get audit review summary error:", error);
      return res.status(500).json({
        status: "error",
        message: "Something went wrong while loading audit review summary.",
      });
    } finally {
      connection.release();
    }
  }
);

router.get("/:id", requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    await ensureAuditSignoffsTable();

    const branchId = getBranchId(req);
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid sign-off ID." });
    }

    const [rows] = await pool.query(
      `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name,
        b.name AS branch_name,
        b.location AS branch_location
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      LEFT JOIN branches b ON a.branch_id = b.id
      WHERE a.id = ?
      AND a.branch_id = ?
      LIMIT 1
      `,
      [id, branchId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Audit sign-off not found in the selected store.",
      });
    }

    return res.json({
      status: "success",
      branch_id: branchId,
      signoff: normalizeSignoff(rows[0]),
    });
  } catch (error) {
    console.error("Get audit signoff error:", error);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching audit sign-off.",
    });
  }
});

router.post("/", requireAuth, requireAdminOrManager, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await ensureAuditSignoffsTable();
    await ensureAuditReapprovalLogTable();

    const branchId = getBranchId(req);
    const userId = getUserId(req);
    const ipAddress = getClientIp(req);
    const payload = buildSignoffPayload(req);

    if (!payload.periodLabel) {
      return res
        .status(400)
        .json({ status: "error", message: "Period label is required." });
    }

    if (payload.auditScore < 0 || payload.auditScore > 100) {
      return res.status(400).json({
        status: "error",
        message: "Audit score must be between 0 and 100.",
      });
    }

    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `
      SELECT id, period_status
      FROM audit_signoffs
      WHERE branch_id = ?
      AND period_type = ?
      AND (
        (period_start <=> ? AND period_end <=> ?)
        OR period_label = ?
      )
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
      `,
      [
        branchId,
        payload.periodType,
        payload.periodStart,
        payload.periodEnd,
        payload.periodLabel,
      ]
    );

    let signoffId;
    let previousStatus = null;
    let reapprovalLogged = false;

    const saveValues = [
      payload.periodLabel,
      payload.periodStart,
      payload.periodEnd,
      payload.auditScore,
      payload.auditStatus,
      payload.preparedByName,
      payload.reviewedByName,
      payload.approvedByName,
      payload.reviewDate,
      payload.periodStatus,
      payload.salesChecked,
      payload.expensesChecked,
      payload.debtsChecked,
      payload.stockChecked,
      payload.warningsChecked,
      payload.reportsChecked,
      payload.purchasesChecked,
      payload.returnsChecked,
      payload.transfersChecked,
      payload.smsChecked,
      payload.stockLedgerChecked,
      payload.backupChecked,
      payload.maintenanceChecked,
      payload.accountantNotes,
      payload.managementNotes,
      payload.approvedBy,
    ];

    if (existingRows.length > 0) {
      signoffId = existingRows[0].id;
      previousStatus = existingRows[0].period_status || null;

      const latestApprovedUnlockRequest =
        await findLatestApprovedUnlockRequest(connection, signoffId, branchId);

      await connection.query(
        `
        UPDATE audit_signoffs
        SET
          period_label = ?,
          period_start = ?,
          period_end = ?,
          audit_score = ?,
          audit_status = ?,
          prepared_by_name = ?,
          reviewed_by_name = ?,
          approved_by_name = ?,
          review_date = ?,
          period_status = ?,
          sales_checked = ?,
          expenses_checked = ?,
          debts_checked = ?,
          stock_checked = ?,
          warnings_checked = ?,
          reports_checked = ?,
          purchases_checked = ?,
          returns_checked = ?,
          transfers_checked = ?,
          sms_checked = ?,
          stock_ledger_checked = ?,
          backup_checked = ?,
          maintenance_checked = ?,
          accountant_notes = ?,
          management_notes = ?,
          approved_by = ?
        WHERE id = ?
        AND branch_id = ?
        `,
        [...saveValues, signoffId, branchId]
      );

      reapprovalLogged = await createReapprovalLogIfNeeded({
        connection,
        branchId,
        signoffId,
        latestApprovedUnlockRequest,
        previousStatus,
        periodStatus: payload.periodStatus,
        periodLabel: payload.periodLabel,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        auditScore: payload.auditScore,
        auditStatus: payload.auditStatus,
        reapprovedBy: userId,
        reapprovedByName: payload.approvedByName || getUserDisplayName(req),
        reapprovalNotes: payload.reapprovalNotes,
        accountantNotes: payload.accountantNotes,
        managementNotes: payload.managementNotes,
      });

      await safeLogActivity(
        connection,
        userId,
        branchId,
        reapprovalLogged ? "REAPPROVE_AUDIT_SIGNOFF" : "UPDATE_AUDIT_SIGNOFF",
        reapprovalLogged
          ? `Re-approved audit sign-off for ${payload.periodLabel} after unlock request. Checked sales, debts, expenses, purchases, returns, stock, transfers, SMS, stock ledger source records, backups and maintenance.`
          : `Updated audit sign-off for ${payload.periodLabel} with status ${payload.periodStatus}.`,
        ipAddress
      );
    } else {
      const [insertResult] = await connection.query(
        `
        INSERT INTO audit_signoffs (
          branch_id,
          period_type,
          period_label,
          period_start,
          period_end,
          audit_score,
          audit_status,
          prepared_by_name,
          reviewed_by_name,
          approved_by_name,
          review_date,
          period_status,
          sales_checked,
          expenses_checked,
          debts_checked,
          stock_checked,
          warnings_checked,
          reports_checked,
          purchases_checked,
          returns_checked,
          transfers_checked,
          sms_checked,
          stock_ledger_checked,
          backup_checked,
          maintenance_checked,
          accountant_notes,
          management_notes,
          created_by,
          approved_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          branchId,
          payload.periodType,
          ...saveValues.slice(0, 25),
          userId,
          payload.approvedBy,
        ]
      );

      signoffId = insertResult.insertId;

      await safeLogActivity(
        connection,
        userId,
        branchId,
        "CREATE_AUDIT_SIGNOFF",
        `Created audit sign-off for ${payload.periodLabel} with status ${payload.periodStatus}. Audit scope includes sales, debts, expenses, purchases, returns, stock, transfers, SMS, stock ledger source records, backups and maintenance.`,
        ipAddress
      );
    }

    const [savedRows] = await connection.query(
      `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name,
        b.name AS branch_name,
        b.location AS branch_location
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      LEFT JOIN branches b ON a.branch_id = b.id
      WHERE a.id = ?
      AND a.branch_id = ?
      LIMIT 1
      `,
      [signoffId, branchId]
    );

    await connection.commit();

    return res.status(existingRows.length > 0 ? 200 : 201).json({
      status: "success",
      branch_id: branchId,
      message: reapprovalLogged
        ? "Audit period re-approved and re-approval log saved successfully."
        : existingRows.length > 0
        ? "Audit sign-off updated successfully."
        : "Audit sign-off saved successfully.",
      reapproval_logged: reapprovalLogged,
      previous_status: previousStatus,
      signoff: normalizeSignoff(savedRows[0]),
    });
  } catch (error) {
    await connection.rollback();
    console.error("Save audit signoff error:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Something went wrong while saving audit sign-off.",
    });
  } finally {
    connection.release();
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const branchId = getBranchId(req);
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res
      .status(400)
      .json({ status: "error", message: "Invalid sign-off ID." });
  }

  await safeLogActivity(
    pool,
    getUserId(req),
    branchId,
    "BLOCK_DELETE_AUDIT_SIGNOFF",
    `Blocked physical deletion request for audit sign-off ID ${id}. Audit sign-offs are permanent compliance evidence and must be corrected through review, unlock and re-approval.`,
    getClientIp(req)
  );

  return res.status(409).json({
    status: "error",
    code: "AUDIT_SIGNOFF_IMMUTABLE",
    message:
      "Audit sign-offs are permanent compliance evidence and cannot be deleted. Create or update the corrected sign-off through the controlled review, unlock and re-approval process.",
  });
});

module.exports = router;
