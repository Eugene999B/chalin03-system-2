const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/permissionMiddleware");
const {
  resolveHireLocationScope,
  appendHireLocationFilter,
  sendHireLocationScopeError,
} = require("../services/hireLocationScope");
const { writeAuditEvent } = require("../services/auditTrailService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");

const router = express.Router();

const READ_ROLES = [
  "admin",
  "manager",
  "auditor",
  "hire_officer",
  "dispatcher",
  "fleet_officer",
  "accountant",
];
const WRITE_ROLES = [
  "admin",
  "manager",
  "hire_officer",
  "dispatcher",
  "fleet_officer",
  "accountant",
];

const CUSTOMER_TYPES = new Set(["individual", "company", "contractor", "government"]);
const ENQUIRY_STATUSES = new Set(["open", "quoted", "won", "lost", "cancelled"]);
const QUOTATION_STATUSES = new Set(["draft", "approved", "accepted", "rejected", "expired", "converted"]);
const CONTRACT_STATUSES = new Set([
  "draft",
  "confirmed",
  "mobilizing",
  "active",
  "suspended",
  "completed",
  "cancelled",
  "disputed",
]);
const CONTRACT_ASSET_STATUSES = new Set([
  "assigned",
  "dispatched",
  "active",
  "returned",
  "cancelled",
]);
const CHARGING_METHODS = new Set(["hourly", "daily", "shift", "weekly", "monthly", "fixed"]);
const FUEL_RESPONSIBILITIES = new Set(["customer", "owner", "mixed"]);
const WORK_LOG_STATUSES = new Set(["draft", "approved", "rejected"]);
const INVOICE_STATUSES = new Set(["issued", "part_paid", "paid", "overdue", "disputed", "void"]);
const PAYMENT_CATEGORIES = new Set(["deposit", "invoice", "other"]);
const PAYMENT_METHODS = new Set(["cash", "momo", "bank", "cheque", "other"]);
const CONDITION_STATUSES = new Set(["excellent", "good", "fair", "poor", "damaged"]);

function cleanText(value, maxLength = 255) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  const cleaned = cleanText(value, maxLength);
  return cleaned || null;
}

function toPositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function toNonNegativeNumber(value, fallback = null, decimals = 2) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Number(number.toFixed(decimals));
}

function toPositiveNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Number(number.toFixed(decimals));
}

function toDateOnly(value, fallback = null) {
  const cleaned = cleanText(value, 20);
  if (!cleaned) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
}

function toDateTime(value, fallback = null) {
  const cleaned = cleanText(value, 50);
  if (!cleaned) return fallback;
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 0);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function isMissingHireTableError(error) {
  return error?.code === "ER_NO_SUCH_TABLE" || error?.errno === 1146;
}

function sendHireSetupError(res, error) {
  if (!isMissingHireTableError(error)) return false;

  res.status(503).json({
    status: "error",
    code: "EQUIPMENT_HIRE_DATABASE_SETUP_REQUIRED",
    message:
      "The Equipment Hire database migration has not been applied yet. Run database/migrations/004_add_equipment_hire_LOCAL.sql in the local chalin03_db database.",
  });

  return true;
}

function sendDuplicateError(res, error, message) {
  if (error?.code !== "ER_DUP_ENTRY") return false;
  res.status(409).json({ status: "error", message });
  return true;
}

function generateDocumentNumber(prefix) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const time = now.toISOString().slice(11, 19).replaceAll(":", "");
  const random = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `${prefix}-${date}-${time}-${random}`;
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function databaseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value);
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => toPositiveInt(item)).filter(Boolean))
  );
}

function invoiceStatusForBalance(balance, dueDate) {
  const numericBalance = Number(balance || 0);
  if (numericBalance <= 0) return "paid";
  const due = databaseDate(dueDate);
  const today = new Date().toISOString().slice(0, 10);
  if (due && due < today) return "overdue";
  return "part_paid";
}

function agingBucketSql(alias = "hi") {
  return `CASE
    WHEN ${alias}.balance <= 0 OR ${alias}.status IN ('paid', 'void') THEN 'settled'
    WHEN ${alias}.due_date IS NULL OR ${alias}.due_date >= CURDATE() THEN 'current'
    WHEN DATEDIFF(CURDATE(), ${alias}.due_date) BETWEEN 1 AND 30 THEN '1_30'
    WHEN DATEDIFF(CURDATE(), ${alias}.due_date) BETWEEN 31 AND 60 THEN '31_60'
    WHEN DATEDIFF(CURDATE(), ${alias}.due_date) BETWEEN 61 AND 90 THEN '61_90'
    ELSE 'over_90'
  END`;
}

function isDamagedReturn({ condition, damageAmount, damageDetails, missingItems }) {
  return (
    ["poor", "damaged"].includes(condition) ||
    Number(damageAmount || 0) > 0 ||
    Boolean(cleanText(damageDetails, 3000)) ||
    Boolean(cleanText(missingItems, 3000))
  );
}

function calculateHireQuoteTotals({
  chargingMethod,
  rate,
  estimatedQuantity,
  minimumQuantity,
  mobilization,
  demobilization,
  operatorAmount,
  discount,
  taxRate,
}) {
  const chargeQuantity = Math.max(
    Number(estimatedQuantity || 0),
    Number(minimumQuantity || 0)
  );
  const baseAmount =
    chargingMethod === "fixed"
      ? Number(rate || 0)
      : Number((Number(rate || 0) * chargeQuantity).toFixed(2));
  const subtotal = Number(
    (
      baseAmount +
      Number(mobilization || 0) +
      Number(demobilization || 0) +
      Number(operatorAmount || 0)
    ).toFixed(2)
  );
  if (Number(discount || 0) > subtotal) {
    return null;
  }
  const taxable = subtotal - Number(discount || 0);
  const taxAmount = Number((taxable * (Number(taxRate || 0) / 100)).toFixed(2));
  const total = Number((taxable + taxAmount).toFixed(2));

  return {
    base_amount: baseAmount,
    subtotal,
    discount_amount: Number(discount || 0),
    tax_amount: taxAmount,
    total_amount: total,
  };
}

async function logActivity(connectionOrPool, req, action, details) {
  try {
    await writeAuditEvent({
      connection: connectionOrPool,
      req,
      action,
      details,
      workspaceCode: "equipment_hire",
      hireLocationId:
        req.hireLocationScope?.locationId ||
        req.body?.hire_location_id ||
        req.params?.locationId ||
        null,
      entityType: "equipment_hire_operation",
      entityId: req.params?.id || req.params?.contractAssetId || null,
      actionType: action,
      outcome: "success",
      severity:
        action.includes("PAYMENT") ||
        action.includes("VOID") ||
        action.includes("CLOSE") ||
        action.includes("APPROVE")
          ? "notice"
          : "info",
      metadata: {
        route: req.originalUrl,
        method: req.method,
      },
    });
  } catch (error) {
    console.warn("Equipment Hire activity log skipped:", error.message);
  }
}

function buildDateFilters(req, dateColumn, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const from = toDateOnly(req.query.from);
  const to = toDateOnly(req.query.to);
  const where = [];
  const params = [];

  if (from) {
    where.push(`DATE(${prefix}${dateColumn}) >= ?`);
    params.push(from);
  }

  if (to) {
    where.push(`DATE(${prefix}${dateColumn}) <= ?`);
    params.push(to);
  }

  return { where, params, from, to };
}


function selectedHireLocationId(req) {
  return Number(req.hireLocationScope?.locationId || 0) || null;
}

function addSelectedHireLocation(filter, req, alias, column = "hire_location_id") {
  appendHireLocationFilter(
    filter.where,
    filter.params,
    alias,
    req.hireLocationScope,
    column
  );
}

function locationSql(req, alias, column = "hire_location_id") {
  const locationId = selectedHireLocationId(req);
  if (!locationId) {
    return { clause: "", params: [] };
  }

  const prefix = alias ? `${alias}.` : "";
  return {
    clause: `${prefix}${column} = ?`,
    params: [locationId],
  };
}


async function getContract(
  contractId,
  connection = pool,
  lock = false,
  hireLocationId = null
) {
  const params = [contractId];
  const locationClause = hireLocationId
    ? " AND hc.hire_location_id = ?"
    : "";

  if (hireLocationId) params.push(hireLocationId);

  const [rows] = await connection.query(
    `SELECT hc.*, hcu.customer_name, hcu.phone AS customer_phone
     FROM hire_contracts hc
     INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
     WHERE hc.id = ?${locationClause}
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    params
  );
  return rows[0] || null;
}

async function getContractAsset(
  contractAssetId,
  connection = pool,
  lock = false,
  hireLocationId = null
) {
  const params = [contractAssetId];
  const locationClause = hireLocationId
    ? " AND hc.hire_location_id = ?"
    : "";

  if (hireLocationId) params.push(hireLocationId);

  const [rows] = await connection.query(
    `SELECT hca.*, hc.contract_number, hc.customer_id, hc.work_location,
            hc.hire_location_id, hc.status AS contract_status,
            hc.expected_end_date, fa.asset_code, fa.asset_name,
            fa.current_meter, fa.current_status
     FROM hire_contract_assets hca
     INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
     INNER JOIN fleet_assets fa ON fa.id = hca.asset_id
     WHERE hca.id = ?${locationClause}
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    params
  );
  return rows[0] || null;
}

router.use(requireAuth);

router.use(async (req, res, next) => {
  try {
    const isCustomerRoute = String(req.path || "").startsWith("/customers");
    const requireSelection =
      String(req.method || "GET").toUpperCase() !== "GET" && !isCustomerRoute;

    req.hireLocationScope = await resolveHireLocationScope(req, {
      requireSelection,
    });

    next();
  } catch (error) {
    if (sendHireLocationScopeError(res, error)) return;

    console.error("Equipment Hire location scope error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not validate the Equipment Hire location context.",
    });
  }
});

// GET /api/equipment-hire/dashboard
router.get(
  "/dashboard",
  requireAnyPermission(
    "hire.customers.view",
    "hire.enquiries.view",
    "hire.quotations.view",
    "hire.contracts.view",
    "hire.dispatch.view",
    "hire.work_logs.view",
    "hire.invoices.view",
    "hire.payments.view",
    "hire.returns.view",
    "hire.reports.view",
    "fleet.assets.view"
  ),
  async (req, res) => {
  try {
    const locationId = selectedHireLocationId(req);
    const locationClause = (alias) =>
      locationId ? `AND ${alias}.hire_location_id = ?` : "";
    const locationParams = locationId ? [locationId] : [];
    const agingBucket = agingBucketSql("hi");

    const [
      [fleetRows],
      [enquiryRows],
      [quotationRows],
      [contractRows],
      [workRows],
      [invoiceRows],
      [agingRows],
      [customerRows],
      [returnRows],
      [readyClosureRows],
      [recentContracts],
      [recentInvoices],
      [endingContracts],
      [closureCandidates],
    ] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM fleet_assets WHERE is_active = TRUE) AS total_assets,
           (SELECT COUNT(*) FROM fleet_assets
             WHERE is_active = TRUE
               AND current_status IN ('available', 'idle')) AS available_assets,
           (SELECT COUNT(*) FROM fleet_assets
             WHERE is_active = TRUE
               AND current_status IN ('maintenance', 'breakdown')) AS maintenance_assets,
           (
             SELECT COUNT(DISTINCT hca.asset_id)
             FROM hire_contract_assets hca
             INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
             WHERE hca.status IN ('assigned', 'dispatched', 'active')
               AND hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
               ${locationClause("hc")}
           ) AS assets_on_hire,
           (
             SELECT COUNT(DISTINCT hca.asset_id)
             FROM hire_contract_assets hca
             INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
             WHERE hca.status = 'returned'
               ${locationClause("hc")}
           ) AS returned_assets`,
        [...locationParams, ...locationParams]
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total_enquiries,
           SUM(CASE WHEN he.status IN ('open', 'quoted') THEN 1 ELSE 0 END) AS active_enquiries,
           SUM(CASE WHEN he.status = 'won' THEN 1 ELSE 0 END) AS won_enquiries,
           SUM(CASE WHEN he.status IN ('lost', 'cancelled') THEN 1 ELSE 0 END) AS inactive_enquiries
         FROM hire_enquiries he
         WHERE 1 = 1 ${locationClause("he")}`,
        locationParams
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total_quotations,
           SUM(CASE WHEN hq.status = 'draft' THEN 1 ELSE 0 END) AS draft_quotations,
           SUM(CASE WHEN hq.status IN ('approved', 'accepted') THEN 1 ELSE 0 END) AS approved_quotations,
           SUM(CASE WHEN hq.status IN ('rejected', 'expired') THEN 1 ELSE 0 END) AS inactive_quotations,
           COALESCE(SUM(CASE WHEN hq.status NOT IN ('rejected', 'expired') THEN hq.total_amount ELSE 0 END), 0) AS open_quotation_value
         FROM hire_quotations hq
         WHERE 1 = 1 ${locationClause("hq")}`,
        locationParams
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total_contracts,
           SUM(CASE WHEN hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended') THEN 1 ELSE 0 END) AS active_contracts,
           SUM(CASE WHEN hc.status = 'draft' THEN 1 ELSE 0 END) AS draft_contracts,
           SUM(CASE WHEN hc.status = 'completed' THEN 1 ELSE 0 END) AS completed_contracts,
           SUM(CASE WHEN hc.operational_status = 'returned_pending_closure' THEN 1 ELSE 0 END) AS returned_pending_closure,
           SUM(CASE WHEN hc.financial_status = 'outstanding' THEN 1 ELSE 0 END) AS closed_with_balance
         FROM hire_contracts hc
         WHERE 1 = 1 ${locationClause("hc")}`,
        locationParams
      ),
      pool.query(
        `SELECT
           COUNT(*) AS work_logs,
           COALESCE(SUM(CASE WHEN hwl.work_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN hwl.billable_hours ELSE 0 END), 0) AS billable_hours_30d,
           SUM(CASE WHEN hwl.status = 'draft' THEN 1 ELSE 0 END) AS unapproved_logs,
           COALESCE(SUM(CASE WHEN hwl.work_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN hwl.breakdown_hours ELSE 0 END), 0) AS breakdown_hours_30d,
           SUM(CASE WHEN hwl.status = 'approved' AND hil.id IS NULL THEN 1 ELSE 0 END) AS approved_uninvoiced_work_logs
         FROM hire_work_logs hwl
         LEFT JOIN hire_invoice_lines hil ON hil.work_log_id = hwl.id
         WHERE 1 = 1 ${locationClause("hwl")}`,
        locationParams
      ),
      pool.query(
        `SELECT
           COUNT(*) AS invoices,
           COALESCE(SUM(CASE WHEN hi.status <> 'void' THEN hi.total_amount ELSE 0 END), 0) AS invoiced_amount,
           COALESCE(SUM(CASE WHEN hi.status <> 'void' THEN hi.amount_paid ELSE 0 END), 0) AS paid_amount,
           COALESCE(SUM(CASE WHEN hi.status <> 'void' THEN hi.balance ELSE 0 END), 0) AS outstanding_amount,
           SUM(CASE WHEN hi.status <> 'void' AND hi.balance > 0 THEN 1 ELSE 0 END) AS outstanding_invoices,
           SUM(CASE WHEN hi.status <> 'void' AND hi.balance > 0 AND hi.due_date < CURDATE() THEN 1 ELSE 0 END) AS overdue_invoices,
           COALESCE(SUM(CASE WHEN hi.status <> 'void' AND hi.balance > 0 AND hi.due_date < CURDATE() THEN hi.balance ELSE 0 END), 0) AS overdue_amount
         FROM hire_invoices hi
         WHERE 1 = 1 ${locationClause("hi")}`,
        locationParams
      ),
      pool.query(
        `SELECT ${agingBucket} AS bucket,
                COUNT(*) AS invoice_count,
                COALESCE(SUM(hi.balance), 0) AS balance
         FROM hire_invoices hi
         WHERE hi.status <> 'void'
           AND hi.balance > 0
           ${locationClause("hi")}
         GROUP BY bucket`,
        locationParams
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total_customers,
           SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) AS active_customers
         FROM hire_customers`
      ),
      pool.query(
        `SELECT COUNT(DISTINCT hca.id) AS returns_due_or_incomplete
         FROM hire_contract_assets hca
         INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
         WHERE hca.status IN ('assigned', 'dispatched', 'active')
           AND hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
           AND (
             hca.assigned_to < NOW()
             OR (hc.expected_end_date IS NOT NULL AND hc.expected_end_date < CURDATE())
           )
           ${locationClause("hc")}`,
        locationParams
      ),
      pool.query(
        `SELECT COUNT(*) AS contracts_ready_for_closure
         FROM hire_contracts hc
         WHERE hc.status NOT IN ('completed', 'cancelled')
           ${locationClause("hc")}
           AND EXISTS (
             SELECT 1 FROM hire_contract_assets hca
             WHERE hca.contract_id = hc.id
               AND hca.status = 'returned'
           )
           AND NOT EXISTS (
             SELECT 1 FROM hire_contract_assets hca
             WHERE hca.contract_id = hc.id
               AND hca.status IN ('assigned', 'dispatched', 'active')
           )
           AND NOT EXISTS (
             SELECT 1 FROM hire_work_logs hwl
             WHERE hwl.contract_id = hc.id
               AND hwl.status = 'draft'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM hire_work_logs hwl
             LEFT JOIN hire_invoice_lines hil ON hil.work_log_id = hwl.id
             WHERE hwl.contract_id = hc.id
               AND hwl.status = 'approved'
               AND hil.id IS NULL
           )`,
        locationParams
      ),
      pool.query(
        `SELECT hc.id, hc.contract_number, hc.work_location, hc.start_date,
                hc.expected_end_date, hc.status, hc.deposit_required,
                hc.deposit_received, hc.hire_location_id,
                hcu.customer_name, bl.code AS hire_location_code,
                bl.name AS hire_location_name,
                (
                  SELECT COUNT(*)
                  FROM hire_contract_assets hca
                  WHERE hca.contract_id = hc.id
                ) AS asset_count
         FROM hire_contracts hc
         INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
         INNER JOIN business_locations bl ON bl.id = hc.hire_location_id
         WHERE 1 = 1 ${locationClause("hc")}
         ORDER BY hc.created_at DESC
         LIMIT 8`,
        locationParams
      ),
      pool.query(
        `SELECT hi.id, hi.invoice_number, hi.invoice_date, hi.due_date,
                hi.total_amount, hi.amount_paid, hi.balance, hi.status,
                hi.hire_location_id, hcu.customer_name, hc.contract_number,
                bl.code AS hire_location_code, bl.name AS hire_location_name
         FROM hire_invoices hi
         INNER JOIN hire_customers hcu ON hcu.id = hi.customer_id
         INNER JOIN hire_contracts hc ON hc.id = hi.contract_id
         INNER JOIN business_locations bl ON bl.id = hi.hire_location_id
         WHERE 1 = 1 ${locationClause("hi")}
         ORDER BY hi.created_at DESC
         LIMIT 8`,
        locationParams
      ),
      pool.query(
        `SELECT hc.id, hc.contract_number, hc.expected_end_date, hc.status,
                hcu.customer_name, hc.work_location, hc.hire_location_id,
                bl.code AS hire_location_code, bl.name AS hire_location_name
         FROM hire_contracts hc
         INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
         INNER JOIN business_locations bl ON bl.id = hc.hire_location_id
         WHERE hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
           AND hc.expected_end_date IS NOT NULL
           AND hc.expected_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 14 DAY)
           ${locationClause("hc")}
         ORDER BY hc.expected_end_date ASC
         LIMIT 10`,
        locationParams
      ),
      pool.query(
        `SELECT hc.id, hc.contract_number, hc.actual_end_date, hc.financial_status,
                hc.hire_location_id, hcu.customer_name, bl.code AS hire_location_code,
                bl.name AS hire_location_name
         FROM hire_contracts hc
         INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
         INNER JOIN business_locations bl ON bl.id = hc.hire_location_id
         WHERE hc.status NOT IN ('completed', 'cancelled')
           ${locationClause("hc")}
           AND EXISTS (
             SELECT 1 FROM hire_contract_assets hca
             WHERE hca.contract_id = hc.id
               AND hca.status = 'returned'
           )
           AND NOT EXISTS (
             SELECT 1 FROM hire_contract_assets hca
             WHERE hca.contract_id = hc.id
               AND hca.status IN ('assigned', 'dispatched', 'active')
           )
         ORDER BY hc.actual_end_date ASC, hc.id ASC
         LIMIT 10`,
        locationParams
      ),
    ]);

    const aging = {
      current: { invoice_count: 0, balance: 0 },
      "1_30": { invoice_count: 0, balance: 0 },
      "31_60": { invoice_count: 0, balance: 0 },
      "61_90": { invoice_count: 0, balance: 0 },
      over_90: { invoice_count: 0, balance: 0 },
    };
    agingRows.forEach((row) => {
      if (aging[row.bucket]) {
        aging[row.bucket] = {
          invoice_count: Number(row.invoice_count || 0),
          balance: Number(row.balance || 0),
        };
      }
    });

    const fleetSummary = fleetRows[0] || {};
    const enquirySummary = enquiryRows[0] || {};
    const quotationSummary = quotationRows[0] || {};
    const contractSummary = contractRows[0] || {};
    const workSummary = workRows[0] || {};
    const invoiceSummary = invoiceRows[0] || {};
    const customerSummary = customerRows[0] || {};
    const returnSummary = returnRows[0] || {};
    const readyClosureSummary = readyClosureRows[0] || {};

    return res.json({
      status: "success",
      hire_location: req.hireLocationScope?.location || null,
      all_locations: Boolean(req.hireLocationScope?.allLocations),
      dashboard: {
        kpis: {
          active_enquiries: Number(enquirySummary.active_enquiries || 0),
          draft_quotations: Number(quotationSummary.draft_quotations || 0),
          approved_quotations: Number(quotationSummary.approved_quotations || 0),
          active_contracts: Number(contractSummary.active_contracts || 0),
          equipment_on_hire: Number(fleetSummary.assets_on_hire || 0),
          available_assets: Number(fleetSummary.available_assets || 0),
          assets_in_maintenance: Number(fleetSummary.maintenance_assets || 0),
          approved_uninvoiced_work_logs: Number(workSummary.approved_uninvoiced_work_logs || 0),
          outstanding_invoices: Number(invoiceSummary.outstanding_invoices || 0),
          overdue_invoices: Number(invoiceSummary.overdue_invoices || 0),
          total_outstanding_balance: Number(invoiceSummary.outstanding_amount || 0),
          returns_due_or_incomplete: Number(returnSummary.returns_due_or_incomplete || 0),
          contracts_ready_for_closure: Number(readyClosureSummary.contracts_ready_for_closure || 0),
        },
        fleet: fleetSummary,
        enquiries: enquirySummary,
        quotations: quotationSummary,
        contracts: contractSummary,
        work: workSummary,
        invoices: invoiceSummary,
        customers: customerSummary,
        aging,
        recent_contracts: recentContracts,
        recent_invoices: recentInvoices,
        ending_contracts: endingContracts,
        closure_candidates: closureCandidates,
      },
    });
  } catch (error) {
    console.error("Equipment Hire dashboard error:", error);
    if (sendHireLocationScopeError(res, error)) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({
      status: "error",
      message: "Could not load the Equipment Hire dashboard.",
    });
  }
});

// GET /api/equipment-hire/reports
router.get("/reports", requirePermission("hire.reports.view"), async (req, res) => {
  try {
    const from = toDateOnly(req.query.from);
    const to = toDateOnly(req.query.to);
    const locationId = selectedHireLocationId(req);
    const locationClause = (alias) =>
      locationId ? `AND ${alias}.hire_location_id = ?` : "";
    const locationParams = locationId ? [locationId] : [];
    const agingBucket = agingBucketSql("hi");

    const paymentWhere = ["1 = 1"];
    const paymentParams = [];
    if (from) {
      paymentWhere.push("DATE(hp.payment_date) >= ?");
      paymentParams.push(from);
    }
    if (to) {
      paymentWhere.push("DATE(hp.payment_date) <= ?");
      paymentParams.push(to);
    }
    if (locationId) {
      paymentWhere.push("hp.hire_location_id = ?");
      paymentParams.push(locationId);
    }

    const utilWhere = ["1 = 1"];
    const utilParams = [];
    if (from) {
      utilWhere.push("hwl.work_date >= ?");
      utilParams.push(from);
    }
    if (to) {
      utilWhere.push("hwl.work_date <= ?");
      utilParams.push(to);
    }
    if (locationId) {
      utilWhere.push("hwl.hire_location_id = ?");
      utilParams.push(locationId);
    }

    const [
      [outstandingInvoices],
      [customerOutstanding],
      [agingSummaryRows],
      [agingDetail],
      [overdueInvoices],
      [overdueContracts],
      [paymentHistory],
      [unpaidClosedContracts],
      [fleetUtilization],
    ] = await Promise.all([
      pool.query(
        `SELECT hi.id, hi.invoice_number, hi.invoice_date, hi.due_date,
                hi.total_amount, hi.amount_paid, hi.balance, hi.status,
                ${agingBucket} AS aging_bucket,
                hcu.customer_name, hc.contract_number,
                bl.code AS hire_location_code, bl.name AS hire_location_name
         FROM hire_invoices hi
         INNER JOIN hire_customers hcu ON hcu.id = hi.customer_id
         INNER JOIN hire_contracts hc ON hc.id = hi.contract_id
         INNER JOIN business_locations bl ON bl.id = hi.hire_location_id
         WHERE hi.status <> 'void'
           AND hi.balance > 0
           ${locationClause("hi")}
         ORDER BY hi.due_date ASC, hi.invoice_date ASC, hi.id ASC`,
        locationParams
      ),
      pool.query(
        `SELECT hcu.id AS customer_id, hcu.customer_code, hcu.customer_name,
                COUNT(hi.id) AS invoice_count,
                COALESCE(SUM(hi.total_amount), 0) AS invoice_total,
                COALESCE(SUM(hi.amount_paid), 0) AS amount_paid,
                COALESCE(SUM(hi.balance), 0) AS outstanding_balance,
                COALESCE(SUM(CASE WHEN hi.due_date < CURDATE() THEN hi.balance ELSE 0 END), 0) AS overdue_balance
         FROM hire_invoices hi
         INNER JOIN hire_customers hcu ON hcu.id = hi.customer_id
         WHERE hi.status <> 'void'
           AND hi.balance > 0
           ${locationClause("hi")}
         GROUP BY hcu.id, hcu.customer_code, hcu.customer_name
         ORDER BY outstanding_balance DESC, hcu.customer_name ASC`,
        locationParams
      ),
      pool.query(
        `SELECT ${agingBucket} AS aging_bucket,
                COUNT(*) AS invoice_count,
                COALESCE(SUM(hi.balance), 0) AS balance
         FROM hire_invoices hi
         WHERE hi.status <> 'void'
           AND hi.balance > 0
           ${locationClause("hi")}
         GROUP BY aging_bucket
         ORDER BY FIELD(aging_bucket, 'current', '1_30', '31_60', '61_90', 'over_90')`,
        locationParams
      ),
      pool.query(
        `SELECT hi.id, hi.invoice_number, hi.invoice_date, hi.due_date,
                DATEDIFF(CURDATE(), hi.due_date) AS days_overdue,
                ${agingBucket} AS aging_bucket,
                hi.total_amount, hi.amount_paid, hi.balance, hi.status,
                hcu.customer_name, hc.contract_number,
                bl.code AS hire_location_code, bl.name AS hire_location_name
         FROM hire_invoices hi
         INNER JOIN hire_customers hcu ON hcu.id = hi.customer_id
         INNER JOIN hire_contracts hc ON hc.id = hi.contract_id
         INNER JOIN business_locations bl ON bl.id = hi.hire_location_id
         WHERE hi.status <> 'void'
           AND hi.balance > 0
           ${locationClause("hi")}
         ORDER BY hi.due_date ASC, hi.invoice_date ASC`,
        locationParams
      ),
      pool.query(
        `SELECT hi.id, hi.invoice_number, hi.due_date, hi.balance,
                hcu.customer_name, hc.contract_number,
                bl.code AS hire_location_code, bl.name AS hire_location_name
         FROM hire_invoices hi
         INNER JOIN hire_customers hcu ON hcu.id = hi.customer_id
         INNER JOIN hire_contracts hc ON hc.id = hi.contract_id
         INNER JOIN business_locations bl ON bl.id = hi.hire_location_id
         WHERE hi.status <> 'void'
           AND hi.balance > 0
           AND hi.due_date < CURDATE()
           ${locationClause("hi")}
         ORDER BY hi.due_date ASC, hi.balance DESC
         LIMIT 100`,
        locationParams
      ),
      pool.query(
        `SELECT hc.id, hc.contract_number, hc.expected_end_date, hc.status,
                hcu.customer_name, hc.work_location,
                bl.code AS hire_location_code, bl.name AS hire_location_name
         FROM hire_contracts hc
         INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
         INNER JOIN business_locations bl ON bl.id = hc.hire_location_id
         WHERE hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
           AND hc.expected_end_date IS NOT NULL
           AND hc.expected_end_date < CURDATE()
           ${locationClause("hc")}
         ORDER BY hc.expected_end_date ASC
         LIMIT 100`,
        locationParams
      ),
      pool.query(
        `SELECT hp.id, hp.payment_date, hp.payment_category, hp.amount,
                hp.payment_method, hp.reference_number,
                hcu.customer_name, hc.contract_number, hi.invoice_number,
                bl.code AS hire_location_code, bl.name AS hire_location_name
         FROM hire_payments hp
         INNER JOIN hire_customers hcu ON hcu.id = hp.customer_id
         INNER JOIN hire_contracts hc ON hc.id = hp.contract_id
         LEFT JOIN hire_invoices hi ON hi.id = hp.invoice_id
         INNER JOIN business_locations bl ON bl.id = hp.hire_location_id
         WHERE ${paymentWhere.join(" AND ")}
         ORDER BY hp.payment_date DESC, hp.id DESC
         LIMIT 500`,
        paymentParams
      ),
      pool.query(
        `SELECT hc.id, hc.contract_number, hc.closed_at, hc.financial_status,
                hcu.customer_name, bl.code AS hire_location_code,
                bl.name AS hire_location_name,
                COUNT(hi.id) AS invoice_count,
                COALESCE(SUM(hi.balance), 0) AS outstanding_balance
         FROM hire_contracts hc
         INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
         INNER JOIN business_locations bl ON bl.id = hc.hire_location_id
         INNER JOIN hire_invoices hi ON hi.contract_id = hc.id AND hi.status <> 'void'
         WHERE hc.status = 'completed'
           ${locationClause("hc")}
         GROUP BY hc.id, hc.contract_number, hc.closed_at, hc.financial_status,
                  hcu.customer_name, bl.code, bl.name
         HAVING outstanding_balance > 0.01
         ORDER BY outstanding_balance DESC, hc.closed_at DESC`,
        locationParams
      ),
      pool.query(
        `SELECT fa.id AS asset_id, fa.asset_code, fa.asset_name, fa.asset_type,
                fa.current_status, fa.current_location, fa.current_meter,
                COALESCE(util.work_log_count, 0) AS work_log_count,
                COALESCE(util.billable_hours, 0) AS billable_hours,
                COALESCE(util.idle_hours, 0) AS idle_hours,
                COALESCE(util.breakdown_hours, 0) AS breakdown_hours,
                COALESCE(util.fuel_litres, 0) AS fuel_litres,
                util.first_work_date, util.last_work_date,
                active_hire.contract_number AS current_contract_number,
                active_hire.customer_name AS current_customer_name,
                active_hire.hire_location_code,
                active_hire.hire_location_name,
                active_hire.assigned_from,
                active_hire.upcoming_available_at
         FROM fleet_assets fa
         LEFT JOIN (
           SELECT hwl.asset_id,
                  COUNT(*) AS work_log_count,
                  COALESCE(SUM(hwl.billable_hours), 0) AS billable_hours,
                  COALESCE(SUM(hwl.idle_hours), 0) AS idle_hours,
                  COALESCE(SUM(hwl.breakdown_hours), 0) AS breakdown_hours,
                  COALESCE(SUM(hwl.fuel_litres), 0) AS fuel_litres,
                  MIN(hwl.work_date) AS first_work_date,
                  MAX(hwl.work_date) AS last_work_date
           FROM hire_work_logs hwl
           WHERE ${utilWhere.join(" AND ")}
           GROUP BY hwl.asset_id
         ) util ON util.asset_id = fa.id
         LEFT JOIN (
           SELECT hca.asset_id,
                  MAX(hc.contract_number) AS contract_number,
                  MAX(hcu.customer_name) AS customer_name,
                  MAX(bl.code) AS hire_location_code,
                  MAX(bl.name) AS hire_location_name,
                  MIN(hca.assigned_from) AS assigned_from,
                  MIN(COALESCE(hca.assigned_to, hc.expected_end_date)) AS upcoming_available_at
           FROM hire_contract_assets hca
           INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
           INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
           INNER JOIN business_locations bl ON bl.id = hc.hire_location_id
           WHERE hca.status IN ('assigned', 'dispatched', 'active')
             AND hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
             ${locationClause("hc")}
           GROUP BY hca.asset_id
         ) active_hire ON active_hire.asset_id = fa.id
         WHERE fa.is_active = TRUE
           AND (util.asset_id IS NOT NULL OR active_hire.asset_id IS NOT NULL)
         ORDER BY FIELD(
                    fa.current_status,
                    'assigned_hire',
                    'working',
                    'maintenance',
                    'breakdown',
                    'available',
                    'idle',
                    'retired',
                    'sold'
                  ),
                  fa.asset_code ASC`,
        [...utilParams, ...locationParams]
      ),
    ]);

    const aging = {
      current: { invoice_count: 0, balance: 0 },
      "1_30": { invoice_count: 0, balance: 0 },
      "31_60": { invoice_count: 0, balance: 0 },
      "61_90": { invoice_count: 0, balance: 0 },
      over_90: { invoice_count: 0, balance: 0 },
    };
    agingSummaryRows.forEach((row) => {
      if (aging[row.aging_bucket]) {
        aging[row.aging_bucket] = {
          invoice_count: Number(row.invoice_count || 0),
          balance: Number(row.balance || 0),
        };
      }
    });

    return res.json({
      status: "success",
      filters: { from, to, hire_location_id: locationId },
      hire_location: req.hireLocationScope?.location || null,
      all_locations: Boolean(req.hireLocationScope?.allLocations),
      reports: {
        outstanding_invoices: outstandingInvoices,
        customer_outstanding: customerOutstanding,
        aging_summary: aging,
        aging_detail: agingDetail,
        overdue_alerts: {
          invoices: overdueInvoices,
          contracts: overdueContracts,
        },
        payment_history: paymentHistory,
        unpaid_closed_contracts: unpaidClosedContracts,
        fleet_utilization: fleetUtilization,
      },
    });
  } catch (error) {
    console.error("Equipment Hire reports error:", error);
    if (sendHireLocationScopeError(res, error)) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({
      status: "error",
      message: "Could not load Equipment Hire reports.",
    });
  }
});

// GET /api/equipment-hire/customers
router.get("/customers", requirePermission("hire.customers.view"), async (req, res) => {
  try {
    const search = cleanText(req.query.search, 120);
    const locationId = selectedHireLocationId(req);
    const searchParams = [];
    let where = "";

    if (search) {
      where =
        "WHERE customer_name LIKE ? OR customer_code LIKE ? OR phone LIKE ? OR contact_person LIKE ?";
      const term = `%${search}%`;
      searchParams.push(term, term, term, term);
    }

    const balanceLocationClause = locationId
      ? " AND hi.hire_location_id = ?"
      : "";
    const queryParams = locationId
      ? [locationId, ...searchParams]
      : searchParams;

    const [customers] = await pool.query(
      `SELECT hc.*,
              COALESCE((
                SELECT SUM(hi.balance)
                FROM hire_invoices hi
                WHERE hi.customer_id = hc.id
                  AND hi.status <> 'void'
                  ${balanceLocationClause}
              ), 0) AS outstanding_balance
       FROM hire_customers hc
       ${where}
       ORDER BY hc.is_active DESC, hc.customer_name ASC
       LIMIT 500`,
      queryParams
    );

    return res.json({
      status: "success",
      count: customers.length,
      hire_location: req.hireLocationScope?.location || null,
      all_locations: Boolean(req.hireLocationScope?.allLocations),
      customers,
    });
  } catch (error) {
    console.error("Get hire customers error:", error);
    if (sendHireLocationScopeError(res, error)) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({
      status: "error",
      message: "Could not load hire customers.",
    });
  }
});

// POST /api/equipment-hire/customers
router.post("/customers", requirePermission("hire.customers.manage"), async (req, res) => {
  try {
    const customerName = cleanText(req.body.customer_name, 180);
    const customerType = cleanText(req.body.customer_type, 30).toLowerCase() || "individual";
    const paymentTermsDays = toNonNegativeNumber(req.body.payment_terms_days, 0, 0);
    const creditLimit = toNonNegativeNumber(req.body.credit_limit, 0);

    if (!customerName || !CUSTOMER_TYPES.has(customerType)) {
      return res.status(400).json({
        status: "error",
        message: "Customer name and a valid customer type are required.",
      });
    }

    if (paymentTermsDays === null || creditLimit === null) {
      return res.status(400).json({
        status: "error",
        message: "Payment terms and credit limit must be zero or greater.",
      });
    }

    const customerCode =
      cleanText(req.body.customer_code, 50).toUpperCase() ||
      generateDocumentNumber("HCUS");

    const [result] = await pool.query(
      `INSERT INTO hire_customers (
         customer_code, customer_name, customer_type, phone, whatsapp_phone,
         email, address, contact_person, payment_terms_days, credit_limit,
         risk_notes, is_active, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerCode,
        customerName,
        customerType,
        nullableText(req.body.phone, 40),
        nullableText(req.body.whatsapp_phone, 40),
        nullableText(req.body.email, 150),
        nullableText(req.body.address, 255),
        nullableText(req.body.contact_person, 150),
        paymentTermsDays,
        creditLimit,
        nullableText(req.body.risk_notes, 3000),
        req.body.is_active === false ? 0 : 1,
        req.user.id,
        req.user.id,
      ]
    );

    await logActivity(
      pool,
      req,
      "CREATE_HIRE_CUSTOMER",
      `Created Equipment Hire customer ${customerCode} — ${customerName}`
    );

    return res.status(201).json({
      status: "success",
      message: "Hire customer created successfully.",
      customer_id: result.insertId,
      customer_code: customerCode,
    });
  } catch (error) {
    console.error("Create hire customer error:", error);
    if (sendDuplicateError(res, error, "That hire customer code already exists.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not create hire customer." });
  }
});

// PUT /api/equipment-hire/customers/:id
router.put("/customers/:id", requirePermission("hire.customers.manage"), async (req, res) => {
  try {
    const customerId = toPositiveInt(req.params.id);
    const customerName = cleanText(req.body.customer_name, 180);
    const customerType = cleanText(req.body.customer_type, 30).toLowerCase();
    const paymentTermsDays = toNonNegativeNumber(req.body.payment_terms_days, 0, 0);
    const creditLimit = toNonNegativeNumber(req.body.credit_limit, 0);

    if (!customerId || !customerName || !CUSTOMER_TYPES.has(customerType)) {
      return res.status(400).json({ status: "error", message: "Valid customer details are required." });
    }

    const [result] = await pool.query(
      `UPDATE hire_customers
       SET customer_name = ?, customer_type = ?, phone = ?, whatsapp_phone = ?,
           email = ?, address = ?, contact_person = ?, payment_terms_days = ?,
           credit_limit = ?, risk_notes = ?, is_active = ?, updated_by = ?
       WHERE id = ?`,
      [
        customerName,
        customerType,
        nullableText(req.body.phone, 40),
        nullableText(req.body.whatsapp_phone, 40),
        nullableText(req.body.email, 150),
        nullableText(req.body.address, 255),
        nullableText(req.body.contact_person, 150),
        paymentTermsDays,
        creditLimit,
        nullableText(req.body.risk_notes, 3000),
        req.body.is_active === false ? 0 : 1,
        req.user.id,
        customerId,
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ status: "error", message: "Hire customer not found." });
    }

    await logActivity(pool, req, "UPDATE_HIRE_CUSTOMER", `Updated hire customer ID ${customerId}`);
    return res.json({ status: "success", message: "Hire customer updated successfully." });
  } catch (error) {
    console.error("Update hire customer error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not update hire customer." });
  }
});

// GET /api/equipment-hire/enquiries
router.get("/enquiries", requirePermission("hire.enquiries.view"), async (req, res) => {
  try {
    const filter = buildDateFilters(req, "enquiry_date", "he");
    const status = cleanText(req.query.status, 30).toLowerCase();
    if (status) {
      filter.where.push("he.status = ?");
      filter.params.push(status);
    }
    addSelectedHireLocation(filter, req, "he");
    const where = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";

    const [enquiries] = await pool.query(
      `SELECT he.*, hc.customer_code, hc.customer_name, hc.phone,
              creator.full_name AS created_by_name,
              bl.code AS hire_location_code,
              bl.name AS hire_location_name
       FROM hire_enquiries he
       INNER JOIN hire_customers hc ON hc.id = he.customer_id
       INNER JOIN business_locations bl ON bl.id = he.hire_location_id
       LEFT JOIN users creator ON creator.id = he.created_by
       ${where}
       ORDER BY he.enquiry_date DESC, he.id DESC
       LIMIT 500`,
      filter.params
    );

    return res.json({ status: "success", count: enquiries.length, enquiries });
  } catch (error) {
    console.error("Get hire enquiries error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load hire enquiries." });
  }
});

// POST /api/equipment-hire/enquiries
router.post("/enquiries", requirePermission("hire.enquiries.manage"), async (req, res) => {
  try {
    const customerId = toPositiveInt(req.body.customer_id);
    const enquiryDate = toDateOnly(req.body.enquiry_date);
    const equipmentType = cleanText(req.body.equipment_type, 100);
    const workLocation = cleanText(req.body.work_location, 255);
    const startDate = toDateOnly(req.body.requested_start_date, null);
    const endDate = toDateOnly(req.body.expected_end_date, null);
    const chargingMethod = cleanText(req.body.preferred_charging_method, 30).toLowerCase();
    const estimatedQuantity = toNonNegativeNumber(req.body.estimated_quantity, null);

    if (!customerId || !enquiryDate || !equipmentType || !workLocation) {
      return res.status(400).json({
        status: "error",
        message: "Customer, enquiry date, equipment type and work location are required.",
      });
    }

    if (chargingMethod && !CHARGING_METHODS.has(chargingMethod)) {
      return res.status(400).json({ status: "error", message: "Invalid preferred charging method." });
    }

    if (startDate && endDate && endDate < startDate) {
      return res.status(400).json({ status: "error", message: "Expected end date cannot be before start date." });
    }

    const [customerRows] = await pool.query(
      "SELECT id FROM hire_customers WHERE id = ? AND is_active = TRUE LIMIT 1",
      [customerId]
    );
    if (!customerRows.length) {
      return res.status(404).json({ status: "error", message: "Active hire customer not found." });
    }

    const enquiryNumber = await nextDocumentNumber("HENQ", { userId: req.user.id });
    const [result] = await pool.query(
      `INSERT INTO hire_enquiries (
         hire_location_id, enquiry_number, customer_id, enquiry_date,
         equipment_type, work_location, requested_start_date, expected_end_date,
         preferred_charging_method, estimated_quantity, notes, status,
         created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [
        selectedHireLocationId(req),
        enquiryNumber,
        customerId,
        enquiryDate,
        equipmentType,
        workLocation,
        startDate,
        endDate,
        chargingMethod || null,
        estimatedQuantity,
        nullableText(req.body.notes, 3000),
        req.user.id,
        req.user.id,
      ]
    );

    await logActivity(pool, req, "CREATE_HIRE_ENQUIRY", `Created hire enquiry ${enquiryNumber}`);
    return res.status(201).json({
      status: "success",
      message: "Equipment enquiry created successfully.",
      enquiry_id: result.insertId,
      enquiry_number: enquiryNumber,
    });
  } catch (error) {
    console.error("Create hire enquiry error:", error);
    if (sendDuplicateError(res, error, "That enquiry number already exists.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not create equipment enquiry." });
  }
});

// PUT /api/equipment-hire/enquiries/:id
router.put("/enquiries/:id", requirePermission("hire.enquiries.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const enquiryId = toPositiveInt(req.params.id);
    const customerId = toPositiveInt(req.body.customer_id);
    const enquiryDate = toDateOnly(req.body.enquiry_date);
    const equipmentType = cleanText(req.body.equipment_type, 100);
    const workLocation = cleanText(req.body.work_location, 255);
    const startDate = toDateOnly(req.body.requested_start_date, null);
    const endDate = toDateOnly(req.body.expected_end_date, null);
    const chargingMethod = cleanText(req.body.preferred_charging_method, 30).toLowerCase();
    const estimatedQuantity = toNonNegativeNumber(req.body.estimated_quantity, null);

    if (!enquiryId || !customerId || !enquiryDate || !equipmentType || !workLocation) {
      return res.status(400).json({
        status: "error",
        message: "Customer, enquiry date, equipment type and work location are required.",
      });
    }
    if (chargingMethod && !CHARGING_METHODS.has(chargingMethod)) {
      return res.status(400).json({ status: "error", message: "Invalid preferred charging method." });
    }
    if (startDate && endDate && endDate < startDate) {
      return res.status(400).json({ status: "error", message: "Expected end date cannot be before start date." });
    }

    await connection.beginTransaction();

    const [enquiryRows] = await connection.query(
      `SELECT *
       FROM hire_enquiries
       WHERE id = ? AND hire_location_id = ?
       LIMIT 1 FOR UPDATE`,
      [enquiryId, selectedHireLocationId(req)]
    );
    const enquiry = enquiryRows[0] || null;
    if (!enquiry) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Equipment enquiry not found." });
    }
    if (enquiry.status !== "open") {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Only open enquiries can be edited.",
      });
    }

    const [customerRows] = await connection.query(
      "SELECT id FROM hire_customers WHERE id = ? AND is_active = TRUE LIMIT 1",
      [customerId]
    );
    if (!customerRows.length) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Active hire customer not found." });
    }

    await connection.query(
      `UPDATE hire_enquiries
       SET customer_id = ?, enquiry_date = ?, equipment_type = ?,
           work_location = ?, requested_start_date = ?, expected_end_date = ?,
           preferred_charging_method = ?, estimated_quantity = ?,
           notes = ?, updated_by = ?
       WHERE id = ? AND hire_location_id = ?`,
      [
        customerId,
        enquiryDate,
        equipmentType,
        workLocation,
        startDate,
        endDate,
        chargingMethod || null,
        estimatedQuantity,
        nullableText(req.body.notes, 3000),
        req.user.id,
        enquiryId,
        selectedHireLocationId(req),
      ]
    );

    await logActivity(
      connection,
      req,
      "UPDATE_HIRE_ENQUIRY",
      `Updated hire enquiry ${enquiry.enquiry_number}`
    );
    await connection.commit();

    return res.json({
      status: "success",
      message: "Equipment enquiry updated successfully.",
      enquiry_id: enquiryId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Update hire enquiry details error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not update equipment enquiry." });
  } finally {
    connection.release();
  }
});

// POST /api/equipment-hire/enquiries/:id/convert-to-quotation
router.post("/enquiries/:id/convert-to-quotation", requirePermission("hire.enquiries.manage", "hire.quotations.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const enquiryId = toPositiveInt(req.params.id);
    if (!enquiryId) {
      return res.status(400).json({ status: "error", message: "A valid enquiry is required." });
    }

    await connection.beginTransaction();
    const [enquiryRows] = await connection.query(
      `SELECT he.*, hc.is_active AS customer_is_active
       FROM hire_enquiries he
       INNER JOIN hire_customers hc ON hc.id = he.customer_id
       WHERE he.id = ? AND he.hire_location_id = ?
       LIMIT 1 FOR UPDATE`,
      [enquiryId, selectedHireLocationId(req)]
    );
    const enquiry = enquiryRows[0] || null;
    if (!enquiry) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Equipment enquiry not found." });
    }
    if (!Number(enquiry.customer_is_active)) {
      await connection.rollback();
      return res.status(409).json({ status: "error", message: "The enquiry customer is inactive." });
    }

    const [existingRows] = await connection.query(
      `SELECT id, quotation_number
       FROM hire_quotations
       WHERE enquiry_id = ? AND hire_location_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [enquiryId, selectedHireLocationId(req)]
    );
    if (existingRows.length && !req.body.confirm_duplicate) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        code: "HIRE_ENQUIRY_ALREADY_QUOTED",
        message: `This enquiry already has quotation ${existingRows[0].quotation_number}.`,
        quotation_id: existingRows[0].id,
      });
    }

    const chargingMethod =
      cleanText(req.body.charging_method, 30).toLowerCase() ||
      enquiry.preferred_charging_method ||
      "hourly";
    const rate = toNonNegativeNumber(req.body.rate, 0);
    const estimatedQuantity =
      toNonNegativeNumber(req.body.estimated_quantity, null) ??
      Number(enquiry.estimated_quantity || 0);
    const minimumQuantity = toNonNegativeNumber(req.body.minimum_quantity, 0);
    const mobilization = toNonNegativeNumber(req.body.mobilization_amount, 0);
    const demobilization = toNonNegativeNumber(req.body.demobilization_amount, 0);
    const operatorAmount = toNonNegativeNumber(req.body.operator_amount, 0);
    const discount = toNonNegativeNumber(req.body.discount_amount, 0);
    const taxRate = toNonNegativeNumber(req.body.tax_rate, 0);
    const fuelResponsibility =
      cleanText(req.body.fuel_responsibility, 30).toLowerCase() || "customer";

    if (!CHARGING_METHODS.has(chargingMethod) || !FUEL_RESPONSIBILITIES.has(fuelResponsibility)) {
      await connection.rollback();
      return res.status(400).json({ status: "error", message: "Quotation method and fuel responsibility must be valid." });
    }
    if ([rate, estimatedQuantity, minimumQuantity, mobilization, demobilization, operatorAmount, discount, taxRate].some((value) => value === null)) {
      await connection.rollback();
      return res.status(400).json({ status: "error", message: "Quotation amounts must be zero or greater." });
    }

    const totals = calculateHireQuoteTotals({
      chargingMethod,
      rate,
      estimatedQuantity,
      minimumQuantity,
      mobilization,
      demobilization,
      operatorAmount,
      discount,
      taxRate,
    });
    if (!totals) {
      await connection.rollback();
      return res.status(400).json({ status: "error", message: "Discount cannot exceed the quotation subtotal." });
    }

    const quotationNumber = await nextDocumentNumber("HQUO", { userId: req.user.id });
    const [result] = await connection.query(
      `INSERT INTO hire_quotations (
         hire_location_id, quotation_number, enquiry_id, customer_id,
         requested_asset_type, preferred_asset_id, work_location,
         requested_start_date, expected_end_date,
         charging_method, rate, estimated_quantity, minimum_quantity,
         mobilization_amount, demobilization_amount, operator_amount,
         fuel_responsibility, subtotal, discount_amount, tax_amount, total_amount,
         validity_date, status, terms, notes, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        selectedHireLocationId(req),
        quotationNumber,
        enquiryId,
        enquiry.customer_id,
        enquiry.equipment_type,
        enquiry.work_location,
        databaseDate(enquiry.requested_start_date),
        databaseDate(enquiry.expected_end_date),
        chargingMethod,
        rate,
        estimatedQuantity,
        minimumQuantity,
        mobilization,
        demobilization,
        operatorAmount,
        fuelResponsibility,
        totals.subtotal,
        totals.discount_amount,
        totals.tax_amount,
        totals.total_amount,
        toDateOnly(req.body.validity_date, null) || addDays(new Date().toISOString().slice(0, 10), 14),
        nullableText(req.body.terms, 5000),
        nullableText(req.body.notes, 3000) || enquiry.notes,
        req.user.id,
        req.user.id,
      ]
    );

    await connection.query(
      `UPDATE hire_enquiries
       SET status = 'quoted', updated_by = ?
       WHERE id = ? AND hire_location_id = ?`,
      [req.user.id, enquiryId, selectedHireLocationId(req)]
    );

    await logActivity(
      connection,
      req,
      "CONVERT_HIRE_ENQUIRY_TO_QUOTATION",
      `Converted ${enquiry.enquiry_number} to quotation ${quotationNumber}`
    );
    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Enquiry converted to a draft quotation.",
      quotation_id: result.insertId,
      quotation_number: quotationNumber,
      totals,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Convert hire enquiry error:", error);
    if (sendDuplicateError(res, error, "This enquiry already has a quotation.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not convert enquiry to quotation." });
  } finally {
    connection.release();
  }
});

// PATCH /api/equipment-hire/enquiries/:id/status
router.patch("/enquiries/:id/status", requirePermission("hire.enquiries.manage"), async (req, res) => {
  try {
    const enquiryId = toPositiveInt(req.params.id);
    const status = cleanText(req.body.status, 30).toLowerCase();
    if (!enquiryId || !ENQUIRY_STATUSES.has(status)) {
      return res.status(400).json({ status: "error", message: "Valid enquiry and status are required." });
    }

    const [result] = await pool.query(
      `UPDATE hire_enquiries
       SET status = ?, updated_by = ?
       WHERE id = ? AND hire_location_id = ?`,
      [status, req.user.id, enquiryId, selectedHireLocationId(req)]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ status: "error", message: "Equipment enquiry not found." });
    }

    await logActivity(pool, req, "UPDATE_HIRE_ENQUIRY_STATUS", `Changed enquiry ${enquiryId} to ${status}`);
    return res.json({ status: "success", message: "Enquiry status updated." });
  } catch (error) {
    console.error("Update hire enquiry error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not update enquiry status." });
  }
});

// GET /api/equipment-hire/availability
router.get("/availability", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    const from = toDateOnly(req.query.from, new Date().toISOString().slice(0, 10));
    const to = toDateOnly(req.query.to, from);
    if (!from || !to || to < from) {
      return res.status(400).json({ status: "error", message: "A valid availability date range is required." });
    }

    const locationId = selectedHireLocationId(req);
    const locationClause = locationId ? "AND hc.hire_location_id = ?" : "";

    const [assets] = await pool.query(
      `SELECT fa.*,
              CASE
                WHEN fa.is_active = FALSE THEN 'inactive'
                WHEN fa.current_status IN ('maintenance', 'breakdown', 'retired', 'sold', 'assigned_mining') THEN fa.current_status
                WHEN EXISTS (
                  SELECT 1
                  FROM hire_contract_assets hca
                  INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
                  WHERE hca.asset_id = fa.id
                    AND hca.status IN ('assigned', 'dispatched', 'active')
                    AND hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
                    ${locationClause}
                    AND DATE(hca.assigned_from) <= ?
                    AND DATE(COALESCE(hca.assigned_to, hc.expected_end_date, '9999-12-31')) >= ?
                ) THEN 'booked'
                WHEN fa.current_status IN ('available', 'idle') THEN 'available'
                ELSE fa.current_status
              END AS availability_status,
              (
                SELECT hc.contract_number
                FROM hire_contract_assets hca
                INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
                WHERE hca.asset_id = fa.id
                  AND hca.status IN ('assigned', 'dispatched', 'active')
                  AND hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
                  ${locationClause}
                ORDER BY hca.assigned_from DESC
                LIMIT 1
              ) AS active_contract_number
       FROM fleet_assets fa
       WHERE fa.is_active = TRUE
       ORDER BY availability_status = 'available' DESC, fa.asset_code ASC`,
      locationId ? [locationId, to, from, locationId] : [to, from]
    );

    return res.json({
      status: "success",
      from,
      to,
      count: assets.length,
      assets,
    });
  } catch (error) {
    console.error("Get hire availability error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load equipment availability." });
  }
});

// GET /api/equipment-hire/quotations
router.get("/quotations", requirePermission("hire.quotations.view"), async (req, res) => {
  try {
    const filter = buildDateFilters(req, "created_at", "hq");
    const status = cleanText(req.query.status, 30).toLowerCase();
    if (status) {
      filter.where.push("hq.status = ?");
      filter.params.push(status);
    }
    addSelectedHireLocation(filter, req, "hq");
    const where = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";

    const [quotations] = await pool.query(
      `SELECT hq.*, hc.customer_code, hc.customer_name, he.enquiry_number,
              fa.asset_code AS preferred_asset_code,
              creator.full_name AS created_by_name,
              approver.full_name AS approved_by_name,
              bl.code AS hire_location_code,
              bl.name AS hire_location_name
       FROM hire_quotations hq
       INNER JOIN hire_customers hc ON hc.id = hq.customer_id
       INNER JOIN business_locations bl ON bl.id = hq.hire_location_id
       LEFT JOIN hire_enquiries he ON he.id = hq.enquiry_id
       LEFT JOIN fleet_assets fa ON fa.id = hq.preferred_asset_id
       LEFT JOIN users creator ON creator.id = hq.created_by
       LEFT JOIN users approver ON approver.id = hq.approved_by
       ${where}
       ORDER BY hq.created_at DESC, hq.id DESC
       LIMIT 500`,
      filter.params
    );

    return res.json({ status: "success", count: quotations.length, quotations });
  } catch (error) {
    console.error("Get hire quotations error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load quotations." });
  }
});

// POST /api/equipment-hire/quotations
router.post("/quotations", requirePermission("hire.quotations.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const enquiryId = toPositiveInt(req.body.enquiry_id);
    const customerId = toPositiveInt(req.body.customer_id);
    const preferredAssetId = toPositiveInt(req.body.preferred_asset_id);
    const assetType = cleanText(req.body.requested_asset_type, 100);
    const workLocation = cleanText(req.body.work_location, 255);
    const startDate = toDateOnly(req.body.requested_start_date, null);
    const endDate = toDateOnly(req.body.expected_end_date, null);
    const chargingMethod = cleanText(req.body.charging_method, 30).toLowerCase();
    const rate = toNonNegativeNumber(req.body.rate, 0);
    const estimatedQuantity = toNonNegativeNumber(req.body.estimated_quantity, 0);
    const minimumQuantity = toNonNegativeNumber(req.body.minimum_quantity, 0);
    const mobilization = toNonNegativeNumber(req.body.mobilization_amount, 0);
    const demobilization = toNonNegativeNumber(req.body.demobilization_amount, 0);
    const operatorAmount = toNonNegativeNumber(req.body.operator_amount, 0);
    const discount = toNonNegativeNumber(req.body.discount_amount, 0);
    const taxRate = toNonNegativeNumber(req.body.tax_rate, 0);
    const fuelResponsibility = cleanText(req.body.fuel_responsibility, 30).toLowerCase();

    if (
      !customerId ||
      !assetType ||
      !workLocation ||
      !CHARGING_METHODS.has(chargingMethod) ||
      !FUEL_RESPONSIBILITIES.has(fuelResponsibility)
    ) {
      return res.status(400).json({
        status: "error",
        message: "Customer, equipment type, location, charging method and fuel responsibility are required.",
      });
    }

    const numbers = [
      rate,
      estimatedQuantity,
      minimumQuantity,
      mobilization,
      demobilization,
      operatorAmount,
      discount,
      taxRate,
    ];
    if (numbers.some((value) => value === null)) {
      return res.status(400).json({ status: "error", message: "Quotation amounts must be zero or greater." });
    }
    if (startDate && endDate && endDate < startDate) {
      return res.status(400).json({ status: "error", message: "Quotation end date cannot be before start date." });
    }

    const totals = calculateHireQuoteTotals({
      chargingMethod,
      rate,
      estimatedQuantity,
      minimumQuantity,
      mobilization,
      demobilization,
      operatorAmount,
      discount,
      taxRate,
    });
    if (!totals) {
      return res.status(400).json({ status: "error", message: "Discount cannot exceed the quotation subtotal." });
    }
    const quotationNumber = await nextDocumentNumber("HQUO", { userId: req.user.id });

    await connection.beginTransaction();

    const [customerRows] = await connection.query(
      "SELECT id FROM hire_customers WHERE id = ? AND is_active = TRUE LIMIT 1",
      [customerId]
    );
    if (!customerRows.length) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Active hire customer not found." });
    }

    if (preferredAssetId) {
      const [assetRows] = await connection.query(
        "SELECT id FROM fleet_assets WHERE id = ? AND is_active = TRUE LIMIT 1",
        [preferredAssetId]
      );
      if (!assetRows.length) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "Preferred fleet asset not found." });
      }
    }

    if (enquiryId) {
      const [enquiryRows] = await connection.query(
        `SELECT id, customer_id
         FROM hire_enquiries
         WHERE id = ? AND hire_location_id = ?
         LIMIT 1 FOR UPDATE`,
        [enquiryId, selectedHireLocationId(req)]
      );

      if (!enquiryRows.length) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "The linked enquiry was not found in the selected Hire location.",
        });
      }

      if (Number(enquiryRows[0].customer_id) !== Number(customerId)) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message: "The quotation customer must match the linked enquiry customer.",
        });
      }

      const [existingQuoteRows] = await connection.query(
        `SELECT id, quotation_number
         FROM hire_quotations
         WHERE enquiry_id = ? AND hire_location_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [enquiryId, selectedHireLocationId(req)]
      );
      if (existingQuoteRows.length && !req.body.confirm_duplicate) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          code: "HIRE_ENQUIRY_ALREADY_QUOTED",
          message: `This enquiry already has quotation ${existingQuoteRows[0].quotation_number}.`,
          quotation_id: existingQuoteRows[0].id,
        });
      }
    }

    const [result] = await connection.query(
      `INSERT INTO hire_quotations (
         hire_location_id, quotation_number, enquiry_id, customer_id,
         requested_asset_type, preferred_asset_id, work_location,
         requested_start_date, expected_end_date,
         charging_method, rate, estimated_quantity, minimum_quantity,
         mobilization_amount, demobilization_amount, operator_amount,
         fuel_responsibility, subtotal, discount_amount, tax_amount, total_amount,
         validity_date, status, terms, notes, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        selectedHireLocationId(req),
        quotationNumber,
        enquiryId,
        customerId,
        assetType,
        preferredAssetId,
        workLocation,
        startDate,
        endDate,
        chargingMethod,
        rate,
        estimatedQuantity,
        minimumQuantity,
        mobilization,
        demobilization,
        operatorAmount,
        fuelResponsibility,
        totals.subtotal,
        discount,
        totals.tax_amount,
        totals.total_amount,
        toDateOnly(req.body.validity_date, null),
        nullableText(req.body.terms, 5000),
        nullableText(req.body.notes, 3000),
        req.user.id,
        req.user.id,
      ]
    );

    if (enquiryId) {
      await connection.query(
        `UPDATE hire_enquiries
         SET status = 'quoted', updated_by = ?
         WHERE id = ? AND hire_location_id = ?`,
        [req.user.id, enquiryId, selectedHireLocationId(req)]
      );
    }

    await logActivity(
      connection,
      req,
      "CREATE_HIRE_QUOTATION",
      `Created quotation ${quotationNumber} for GHS ${totals.total_amount.toFixed(2)}`
    );
    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Equipment Hire quotation created successfully.",
      quotation_id: result.insertId,
      quotation_number: quotationNumber,
      totals,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create hire quotation error:", error);
    if (sendDuplicateError(res, error, "That quotation number already exists.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not create quotation." });
  } finally {
    connection.release();
  }
});

// PUT /api/equipment-hire/quotations/:id
router.put("/quotations/:id", requirePermission("hire.quotations.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const quotationId = toPositiveInt(req.params.id);
    const enquiryId = toPositiveInt(req.body.enquiry_id);
    const customerId = toPositiveInt(req.body.customer_id);
    const preferredAssetId = toPositiveInt(req.body.preferred_asset_id);
    const assetType = cleanText(req.body.requested_asset_type, 100);
    const workLocation = cleanText(req.body.work_location, 255);
    const startDate = toDateOnly(req.body.requested_start_date, null);
    const endDate = toDateOnly(req.body.expected_end_date, null);
    const chargingMethod = cleanText(req.body.charging_method, 30).toLowerCase();
    const rate = toNonNegativeNumber(req.body.rate, 0);
    const estimatedQuantity = toNonNegativeNumber(req.body.estimated_quantity, 0);
    const minimumQuantity = toNonNegativeNumber(req.body.minimum_quantity, 0);
    const mobilization = toNonNegativeNumber(req.body.mobilization_amount, 0);
    const demobilization = toNonNegativeNumber(req.body.demobilization_amount, 0);
    const operatorAmount = toNonNegativeNumber(req.body.operator_amount, 0);
    const discount = toNonNegativeNumber(req.body.discount_amount, 0);
    const taxRate = toNonNegativeNumber(req.body.tax_rate, 0);
    const fuelResponsibility = cleanText(req.body.fuel_responsibility, 30).toLowerCase();

    if (
      !quotationId ||
      !customerId ||
      !assetType ||
      !workLocation ||
      !CHARGING_METHODS.has(chargingMethod) ||
      !FUEL_RESPONSIBILITIES.has(fuelResponsibility)
    ) {
      return res.status(400).json({
        status: "error",
        message: "Customer, equipment type, location, charging method and fuel responsibility are required.",
      });
    }

    const numbers = [
      rate,
      estimatedQuantity,
      minimumQuantity,
      mobilization,
      demobilization,
      operatorAmount,
      discount,
      taxRate,
    ];
    if (numbers.some((value) => value === null)) {
      return res.status(400).json({ status: "error", message: "Quotation amounts must be zero or greater." });
    }
    if (startDate && endDate && endDate < startDate) {
      return res.status(400).json({ status: "error", message: "Quotation end date cannot be before start date." });
    }

    const totals = calculateHireQuoteTotals({
      chargingMethod,
      rate,
      estimatedQuantity,
      minimumQuantity,
      mobilization,
      demobilization,
      operatorAmount,
      discount,
      taxRate,
    });
    if (!totals) {
      return res.status(400).json({ status: "error", message: "Discount cannot exceed the quotation subtotal." });
    }

    await connection.beginTransaction();
    const [quoteRows] = await connection.query(
      `SELECT *
       FROM hire_quotations
       WHERE id = ? AND hire_location_id = ?
       LIMIT 1 FOR UPDATE`,
      [quotationId, selectedHireLocationId(req)]
    );
    const quote = quoteRows[0] || null;
    if (!quote) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Quotation not found." });
    }
    if (quote.status !== "draft") {
      await connection.rollback();
      return res.status(409).json({ status: "error", message: "Only draft quotations can be edited." });
    }

    const [customerRows] = await connection.query(
      "SELECT id FROM hire_customers WHERE id = ? AND is_active = TRUE LIMIT 1",
      [customerId]
    );
    if (!customerRows.length) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Active hire customer not found." });
    }

    if (preferredAssetId) {
      const [assetRows] = await connection.query(
        "SELECT id FROM fleet_assets WHERE id = ? AND is_active = TRUE LIMIT 1",
        [preferredAssetId]
      );
      if (!assetRows.length) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "Preferred fleet asset not found." });
      }
    }

    if (enquiryId) {
      const [enquiryRows] = await connection.query(
        `SELECT id, customer_id
         FROM hire_enquiries
         WHERE id = ? AND hire_location_id = ?
         LIMIT 1 FOR UPDATE`,
        [enquiryId, selectedHireLocationId(req)]
      );
      if (!enquiryRows.length) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "The linked enquiry was not found in the selected Hire location.",
        });
      }
      if (Number(enquiryRows[0].customer_id) !== Number(customerId)) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message: "The quotation customer must match the linked enquiry customer.",
        });
      }

      const [duplicateRows] = await connection.query(
        `SELECT id, quotation_number
         FROM hire_quotations
         WHERE enquiry_id = ? AND hire_location_id = ? AND id <> ?
         ORDER BY id DESC
         LIMIT 1`,
        [enquiryId, selectedHireLocationId(req), quotationId]
      );
      if (duplicateRows.length && !req.body.confirm_duplicate) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          code: "HIRE_ENQUIRY_ALREADY_QUOTED",
          message: `This enquiry already has quotation ${duplicateRows[0].quotation_number}.`,
          quotation_id: duplicateRows[0].id,
        });
      }
    }

    await connection.query(
      `UPDATE hire_quotations
       SET enquiry_id = ?, customer_id = ?, requested_asset_type = ?,
           preferred_asset_id = ?, work_location = ?, requested_start_date = ?,
           expected_end_date = ?, charging_method = ?, rate = ?,
           estimated_quantity = ?, minimum_quantity = ?, mobilization_amount = ?,
           demobilization_amount = ?, operator_amount = ?, fuel_responsibility = ?,
           subtotal = ?, discount_amount = ?, tax_amount = ?, total_amount = ?,
           validity_date = ?, terms = ?, notes = ?, updated_by = ?
       WHERE id = ? AND hire_location_id = ?`,
      [
        enquiryId,
        customerId,
        assetType,
        preferredAssetId,
        workLocation,
        startDate,
        endDate,
        chargingMethod,
        rate,
        estimatedQuantity,
        minimumQuantity,
        mobilization,
        demobilization,
        operatorAmount,
        fuelResponsibility,
        totals.subtotal,
        totals.discount_amount,
        totals.tax_amount,
        totals.total_amount,
        toDateOnly(req.body.validity_date, null),
        nullableText(req.body.terms, 5000),
        nullableText(req.body.notes, 3000),
        req.user.id,
        quotationId,
        selectedHireLocationId(req),
      ]
    );

    await logActivity(
      connection,
      req,
      "UPDATE_HIRE_QUOTATION",
      `Updated quotation ${quote.quotation_number}`
    );
    await connection.commit();

    return res.json({
      status: "success",
      message: "Equipment Hire quotation updated successfully.",
      quotation_id: quotationId,
      totals,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Update hire quotation details error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not update quotation." });
  } finally {
    connection.release();
  }
});

// POST /api/equipment-hire/quotations/:id/convert-to-contract
router.post("/quotations/:id/convert-to-contract", requirePermission("hire.quotations.manage", "hire.contracts.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const quotationId = toPositiveInt(req.params.id);
    const depositRequired = toNonNegativeNumber(req.body.deposit_required, 0);

    if (!quotationId || depositRequired === null) {
      return res.status(400).json({
        status: "error",
        message: "A valid quotation and deposit amount are required.",
      });
    }

    await connection.beginTransaction();
    const [quoteRows] = await connection.query(
      `SELECT hq.*, hc.is_active AS customer_is_active
       FROM hire_quotations hq
       INNER JOIN hire_customers hc ON hc.id = hq.customer_id
       WHERE hq.id = ? AND hq.hire_location_id = ?
       LIMIT 1 FOR UPDATE`,
      [quotationId, selectedHireLocationId(req)]
    );
    const quote = quoteRows[0] || null;
    if (!quote) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Quotation not found." });
    }
    if (!["approved", "accepted"].includes(quote.status)) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Only an approved or accepted quotation can become a contract.",
      });
    }
    if (!Number(quote.customer_is_active)) {
      await connection.rollback();
      return res.status(409).json({ status: "error", message: "The quotation customer is inactive." });
    }

    const [existingContractRows] = await connection.query(
      `SELECT id, contract_number
       FROM hire_contracts
       WHERE quotation_id = ? AND hire_location_id = ?
       LIMIT 1`,
      [quotationId, selectedHireLocationId(req)]
    );
    if (existingContractRows.length) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        code: "HIRE_QUOTATION_ALREADY_CONVERTED",
        message: `This quotation already has contract ${existingContractRows[0].contract_number}.`,
        contract_id: existingContractRows[0].id,
      });
    }

    const startDate = databaseDate(quote.requested_start_date) || new Date().toISOString().slice(0, 10);
    const contractNumber = await nextDocumentNumber("HCON", { userId: req.user.id });
    const [result] = await connection.query(
      `INSERT INTO hire_contracts (
         hire_location_id, contract_number, quotation_id, customer_id,
         work_location, start_date, expected_end_date, charging_method,
         rate, minimum_quantity, mobilization_amount, demobilization_amount,
         operator_amount, deposit_required, deposit_received,
         fuel_responsibility, status, terms, notes,
         created_by, approved_by, approved_at, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'confirmed', ?, ?, ?, ?, NOW(), ?)`,
      [
        selectedHireLocationId(req),
        contractNumber,
        quotationId,
        quote.customer_id,
        quote.work_location,
        startDate,
        databaseDate(quote.expected_end_date),
        quote.charging_method,
        Number(quote.rate || 0),
        Number(quote.minimum_quantity || 0),
        Number(quote.mobilization_amount || 0),
        Number(quote.demobilization_amount || 0),
        Number(quote.operator_amount || 0),
        depositRequired,
        quote.fuel_responsibility,
        nullableText(req.body.terms, 5000) || quote.terms,
        nullableText(req.body.notes, 3000) || quote.notes,
        req.user.id,
        req.user.id,
        req.user.id,
      ]
    );

    await connection.query(
      `UPDATE hire_quotations
       SET status = 'converted', updated_by = ?
       WHERE id = ? AND hire_location_id = ?`,
      [req.user.id, quotationId, selectedHireLocationId(req)]
    );
    if (quote.enquiry_id) {
      await connection.query(
        `UPDATE hire_enquiries
         SET status = 'won', updated_by = ?
         WHERE id = ? AND hire_location_id = ?`,
        [req.user.id, quote.enquiry_id, selectedHireLocationId(req)]
      );
    }

    await logActivity(
      connection,
      req,
      "CONVERT_HIRE_QUOTATION_TO_CONTRACT",
      `Converted quotation ${quote.quotation_number} to contract ${contractNumber}`
    );
    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Approved quotation converted to a hire contract.",
      contract_id: result.insertId,
      contract_number: contractNumber,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Convert hire quotation error:", error);
    if (sendDuplicateError(res, error, "This quotation already has a contract.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not convert quotation to contract." });
  } finally {
    connection.release();
  }
});

// PATCH /api/equipment-hire/quotations/:id/status
router.patch("/quotations/:id/status", requirePermission("hire.quotations.approve"), async (req, res) => {
  try {
    const quotationId = toPositiveInt(req.params.id);
    const status = cleanText(req.body.status, 30).toLowerCase();
    if (!quotationId || !QUOTATION_STATUSES.has(status)) {
      return res.status(400).json({ status: "error", message: "Valid quotation and status are required." });
    }

    const approvalFields =
      status === "approved"
        ? ", approved_by = ?, approved_at = NOW()"
        : "";
    const params =
      status === "approved"
        ? [
            status,
            req.user.id,
            req.user.id,
            quotationId,
            selectedHireLocationId(req),
          ]
        : [status, req.user.id, quotationId, selectedHireLocationId(req)];

    const [result] = await pool.query(
      `UPDATE hire_quotations
       SET status = ?, updated_by = ?${approvalFields}
       WHERE id = ? AND hire_location_id = ?`,
      params
    );

    if (!result.affectedRows) {
      return res.status(404).json({ status: "error", message: "Quotation not found." });
    }

    await logActivity(pool, req, "UPDATE_HIRE_QUOTATION_STATUS", `Changed quotation ${quotationId} to ${status}`);
    return res.json({ status: "success", message: "Quotation status updated." });
  } catch (error) {
    console.error("Update quotation status error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not update quotation status." });
  }
});

// GET /api/equipment-hire/contracts
router.get("/contracts", requirePermission("hire.contracts.view"), async (req, res) => {
  try {
    const filter = buildDateFilters(req, "start_date", "hc");
    const status = cleanText(req.query.status, 30).toLowerCase();
    if (status) {
      filter.where.push("hc.status = ?");
      filter.params.push(status);
    }
    addSelectedHireLocation(filter, req, "hc");
    const where = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";

    const [contracts] = await pool.query(
      `SELECT hc.*, hcu.customer_code, hcu.customer_name, hcu.phone,
              hq.quotation_number,
              bl.code AS hire_location_code,
              bl.name AS hire_location_name,
              COUNT(DISTINCT hca.id) AS asset_count,
              SUM(CASE WHEN hca.status IN ('assigned', 'dispatched', 'active') THEN 1 ELSE 0 END) AS open_asset_count,
              SUM(CASE WHEN hca.status = 'returned' THEN 1 ELSE 0 END) AS returned_asset_count,
              GROUP_CONCAT(DISTINCT fa.asset_code ORDER BY fa.asset_code SEPARATOR ', ') AS asset_codes,
              COALESCE((
                SELECT SUM(hi.balance)
                FROM hire_invoices hi
                WHERE hi.contract_id = hc.id AND hi.status <> 'void'
              ), 0) AS outstanding_balance
       FROM hire_contracts hc
       INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
       INNER JOIN business_locations bl ON bl.id = hc.hire_location_id
       LEFT JOIN hire_quotations hq ON hq.id = hc.quotation_id
       LEFT JOIN hire_contract_assets hca ON hca.contract_id = hc.id
       LEFT JOIN fleet_assets fa ON fa.id = hca.asset_id
       ${where}
       GROUP BY hc.id
       ORDER BY hc.created_at DESC, hc.id DESC
       LIMIT 500`,
      filter.params
    );

    return res.json({ status: "success", count: contracts.length, contracts });
  } catch (error) {
    console.error("Get hire contracts error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load hire contracts." });
  }
});

// POST /api/equipment-hire/contracts
router.post("/contracts", requirePermission("hire.contracts.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const quotationId = toPositiveInt(req.body.quotation_id);
    let customerId = toPositiveInt(req.body.customer_id);
    let workLocation = cleanText(req.body.work_location, 255);
    let startDate = toDateOnly(req.body.start_date);
    let endDate = toDateOnly(req.body.expected_end_date, null);
    let chargingMethod = cleanText(req.body.charging_method, 30).toLowerCase();
    let rate = toNonNegativeNumber(req.body.rate, null);
    let minimumQuantity = toNonNegativeNumber(req.body.minimum_quantity, 0);
    let mobilization = toNonNegativeNumber(req.body.mobilization_amount, 0);
    let demobilization = toNonNegativeNumber(req.body.demobilization_amount, 0);
    let operatorAmount = toNonNegativeNumber(req.body.operator_amount, 0);
    let fuelResponsibility = cleanText(req.body.fuel_responsibility, 30).toLowerCase();
    const depositRequired = toNonNegativeNumber(req.body.deposit_required, 0);

    await connection.beginTransaction();

    let quotation = null;
    if (quotationId) {
      const [quoteRows] = await connection.query(
        `SELECT *
         FROM hire_quotations
         WHERE id = ? AND hire_location_id = ?
         LIMIT 1 FOR UPDATE`,
        [quotationId, selectedHireLocationId(req)]
      );
      quotation = quoteRows[0] || null;
      if (!quotation) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "Quotation not found." });
      }
      if (!["approved", "accepted"].includes(quotation.status)) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "Only an approved or accepted quotation can become a contract.",
        });
      }

      const [existingContractRows] = await connection.query(
        `SELECT id, contract_number
         FROM hire_contracts
         WHERE quotation_id = ? AND hire_location_id = ?
         LIMIT 1`,
        [quotationId, selectedHireLocationId(req)]
      );
      if (existingContractRows.length) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          code: "HIRE_QUOTATION_ALREADY_CONVERTED",
          message: `This quotation already has contract ${existingContractRows[0].contract_number}.`,
          contract_id: existingContractRows[0].id,
        });
      }

      customerId = customerId || quotation.customer_id;
      workLocation = workLocation || quotation.work_location;
      startDate = startDate || databaseDate(quotation.requested_start_date);
      endDate = endDate || databaseDate(quotation.expected_end_date);
      chargingMethod = chargingMethod || quotation.charging_method;
      rate = rate === null ? Number(quotation.rate) : rate;
      minimumQuantity =
        req.body.minimum_quantity === undefined ? Number(quotation.minimum_quantity || 0) : minimumQuantity;
      mobilization =
        req.body.mobilization_amount === undefined ? Number(quotation.mobilization_amount || 0) : mobilization;
      demobilization =
        req.body.demobilization_amount === undefined ? Number(quotation.demobilization_amount || 0) : demobilization;
      operatorAmount =
        req.body.operator_amount === undefined ? Number(quotation.operator_amount || 0) : operatorAmount;
      fuelResponsibility = fuelResponsibility || quotation.fuel_responsibility;
    }

    if (
      !customerId ||
      !workLocation ||
      !startDate ||
      !CHARGING_METHODS.has(chargingMethod) ||
      rate === null ||
      minimumQuantity === null ||
      depositRequired === null ||
      !FUEL_RESPONSIBILITIES.has(fuelResponsibility)
    ) {
      await connection.rollback();
      return res.status(400).json({
        status: "error",
        message: "Customer, location, start date, charging method, rate and fuel responsibility are required.",
      });
    }
    if (endDate && endDate < startDate) {
      await connection.rollback();
      return res.status(400).json({ status: "error", message: "Contract end date cannot be before start date." });
    }

    const [customerRows] = await connection.query(
      "SELECT id FROM hire_customers WHERE id = ? AND is_active = TRUE LIMIT 1",
      [customerId]
    );
    if (!customerRows.length) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Active hire customer not found." });
    }

    const contractNumber = await nextDocumentNumber("HCON", { userId: req.user.id });
    const [result] = await connection.query(
      `INSERT INTO hire_contracts (
         hire_location_id, contract_number, quotation_id, customer_id,
         work_location, start_date,
         expected_end_date, charging_method, rate, minimum_quantity,
         mobilization_amount, demobilization_amount, operator_amount,
         deposit_required, deposit_received, fuel_responsibility, status,
         terms, notes, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft', ?, ?, ?, ?)`,
      [
        selectedHireLocationId(req),
        contractNumber,
        quotationId,
        customerId,
        workLocation,
        startDate,
        endDate,
        chargingMethod,
        rate,
        minimumQuantity,
        mobilization,
        demobilization,
        operatorAmount,
        depositRequired,
        fuelResponsibility,
        nullableText(req.body.terms, 5000) || quotation?.terms || null,
        nullableText(req.body.notes, 3000),
        req.user.id,
        req.user.id,
      ]
    );

    if (quotationId) {
      await connection.query(
        `UPDATE hire_quotations
         SET status = 'converted', updated_by = ?
         WHERE id = ? AND hire_location_id = ?`,
        [req.user.id, quotationId, selectedHireLocationId(req)]
      );
      if (quotation.enquiry_id) {
        await connection.query(
          `UPDATE hire_enquiries
           SET status = 'won', updated_by = ?
           WHERE id = ? AND hire_location_id = ?`,
          [req.user.id, quotation.enquiry_id, selectedHireLocationId(req)]
        );
      }
    }

    await logActivity(connection, req, "CREATE_HIRE_CONTRACT", `Created contract ${contractNumber}`);
    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Equipment Hire contract created successfully.",
      contract_id: result.insertId,
      contract_number: contractNumber,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create hire contract error:", error);
    if (sendDuplicateError(res, error, "That contract number already exists.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not create hire contract." });
  } finally {
    connection.release();
  }
});

// PATCH /api/equipment-hire/contracts/:id/status
router.patch("/contracts/:id/status", requirePermission("hire.contracts.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const contractId = toPositiveInt(req.params.id);
    const status = cleanText(req.body.status, 30).toLowerCase();
    if (!contractId || !CONTRACT_STATUSES.has(status)) {
      return res.status(400).json({ status: "error", message: "Valid contract and status are required." });
    }

    await connection.beginTransaction();
    const contract = await getContract(
      contractId,
      connection,
      true,
      selectedHireLocationId(req)
    );
    if (!contract) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Hire contract not found." });
    }

    const approvalSql =
      status === "confirmed" ? ", approved_by = ?, approved_at = NOW()" : "";
    const actualEndSql =
      status === "completed" ? ", actual_end_date = CURDATE()" : "";
    const params =
      status === "confirmed"
        ? [status, req.user.id, req.user.id, contractId]
        : [status, req.user.id, contractId];

    await connection.query(
      `UPDATE hire_contracts
       SET status = ?, updated_by = ?${approvalSql}${actualEndSql}
       WHERE id = ?`,
      params
    );

    if (status === "cancelled") {
      const [assignments] = await connection.query(
        `SELECT hca.id, hca.asset_id
         FROM hire_contract_assets hca
         WHERE hca.contract_id = ? AND hca.status IN ('assigned', 'dispatched', 'active')`,
        [contractId]
      );

      await connection.query(
        `UPDATE hire_contract_assets
         SET status = 'cancelled', updated_by = ?
         WHERE contract_id = ? AND status IN ('assigned', 'dispatched', 'active')`,
        [req.user.id, contractId]
      );

      for (const assignment of assignments) {
        await connection.query(
          `UPDATE fleet_assets
           SET current_status = 'available', current_location = 'Available yard',
               assigned_operator_name = NULL, updated_by = ?
           WHERE id = ?`,
          [req.user.id, assignment.asset_id]
        );
      }
    }

    await logActivity(connection, req, "UPDATE_HIRE_CONTRACT_STATUS", `Changed ${contract.contract_number} to ${status}`);
    await connection.commit();
    return res.json({ status: "success", message: "Contract status updated." });
  } catch (error) {
    await connection.rollback();
    console.error("Update contract status error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not update contract status." });
  } finally {
    connection.release();
  }
});

// PATCH /api/equipment-hire/contracts/:id/close
router.patch("/contracts/:id/close", requirePermission("hire.contracts.close_operational"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const contractId = toPositiveInt(req.params.id);
    if (!contractId) {
      return res.status(400).json({ status: "error", message: "A valid contract is required." });
    }

    await connection.beginTransaction();
    const contract = await getContract(
      contractId,
      connection,
      true,
      selectedHireLocationId(req)
    );
    if (!contract) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Hire contract not found." });
    }
    if (contract.status === "completed") {
      await connection.rollback();
      return res.status(409).json({ status: "error", message: "This contract is already closed." });
    }

    const [[activeAssignments]] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM hire_contract_assets
       WHERE contract_id = ?
         AND status IN ('assigned', 'dispatched', 'active')`,
      [contractId]
    );
    if (Number(activeAssignments.count || 0) > 0) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Return all assigned or dispatched equipment before closing this contract.",
      });
    }

    const [[missingReturns]] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM hire_contract_assets hca
       LEFT JOIN hire_return_inspections hri ON hri.contract_asset_id = hca.id
       WHERE hca.contract_id = ?
         AND hca.status <> 'cancelled'
         AND hri.id IS NULL`,
      [contractId]
    );
    if (Number(missingReturns.count || 0) > 0) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Every non-cancelled equipment assignment must have a return inspection before closure.",
      });
    }

    const [[draftLogs]] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM hire_work_logs
       WHERE contract_id = ?
         AND status = 'draft'`,
      [contractId]
    );
    if (Number(draftLogs.count || 0) > 0) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Approve or reject draft work logs before closing this contract.",
      });
    }

    const [[unbilledLogs]] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM hire_work_logs hwl
       LEFT JOIN hire_invoice_lines hil ON hil.work_log_id = hwl.id
       WHERE hwl.contract_id = ?
         AND hwl.status = 'approved'
         AND hil.id IS NULL`,
      [contractId]
    );
    if (Number(unbilledLogs.count || 0) > 0) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Invoice approved work logs before closing this contract.",
      });
    }

    const [[invoiceSummary]] = await connection.query(
      `SELECT COALESCE(SUM(balance), 0) AS outstanding_balance
       FROM hire_invoices
       WHERE contract_id = ?
         AND status <> 'void'`,
      [contractId]
    );
    const outstandingBalance = Number(invoiceSummary.outstanding_balance || 0);
    const financialStatus = outstandingBalance > 0 ? "outstanding" : "settled";

    await connection.query(
      `UPDATE hire_contracts
       SET status = 'completed',
           operational_status = 'closed',
           financial_status = ?,
           closure_notes = ?,
           closed_by = ?,
           closed_at = NOW(),
           actual_end_date = COALESCE(actual_end_date, CURDATE()),
           updated_by = ?
       WHERE id = ?`,
      [
        financialStatus,
        nullableText(req.body.closure_notes, 3000),
        req.user.id,
        req.user.id,
        contractId,
      ]
    );

    await logActivity(
      connection,
      req,
      "CLOSE_HIRE_CONTRACT",
      `Closed ${contract.contract_number}; finance ${financialStatus}; balance GHS ${outstandingBalance.toFixed(2)}`
    );
    await connection.commit();

    return res.json({
      status: "success",
      message:
        financialStatus === "outstanding"
          ? "Contract operations closed. Outstanding balance remains visible."
          : "Contract closed with no outstanding balance.",
      financial_status: financialStatus,
      outstanding_balance: outstandingBalance,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Close hire contract error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not close hire contract." });
  } finally {
    connection.release();
  }
});

// PATCH /api/equipment-hire/contracts/:id/financial-close
router.patch("/contracts/:id/financial-close", requirePermission("hire.contracts.close_financial"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const contractId = toPositiveInt(req.params.id);
    if (!contractId) {
      return res.status(400).json({ status: "error", message: "A valid contract is required." });
    }

    await connection.beginTransaction();
    const contract = await getContract(
      contractId,
      connection,
      true,
      selectedHireLocationId(req)
    );
    if (!contract) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Hire contract not found." });
    }

    if (contract.operational_status !== "closed" && contract.status !== "completed") {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Close contract operations before financial closure.",
      });
    }

    const [[invoiceSummary]] = await connection.query(
      `SELECT COALESCE(SUM(balance), 0) AS outstanding_balance
       FROM hire_invoices
       WHERE contract_id = ?
         AND status <> 'void'`,
      [contractId]
    );
    const outstandingBalance = Number(invoiceSummary.outstanding_balance || 0);
    if (outstandingBalance > 0) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Settle outstanding invoices before financial closure.",
        outstanding_balance: outstandingBalance,
      });
    }

    await connection.query(
      `UPDATE hire_contracts
       SET financial_status = 'settled',
           closure_notes = COALESCE(?, closure_notes),
           updated_by = ?
       WHERE id = ?`,
      [nullableText(req.body.closure_notes, 3000), req.user.id, contractId]
    );

    await logActivity(
      connection,
      req,
      "FINANCIAL_CLOSE_HIRE_CONTRACT",
      `Financially closed ${contract.contract_number}; balance GHS ${outstandingBalance.toFixed(2)}`
    );
    await connection.commit();

    return res.json({
      status: "success",
      message: "Contract financially closed.",
      financial_status: "settled",
      outstanding_balance: outstandingBalance,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Financial close hire contract error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not financially close hire contract." });
  } finally {
    connection.release();
  }
});

// GET /api/equipment-hire/contract-assets
router.get("/contract-assets", requirePermission("hire.contracts.view"), async (req, res) => {
  try {
    const contractId = toPositiveInt(req.query.contract_id);
    const filters = { where: [], params: [] };

    if (contractId) {
      filters.where.push("hca.contract_id = ?");
      filters.params.push(contractId);
    }

    addSelectedHireLocation(filters, req, "hc");
    const where = filters.where.length
      ? `WHERE ${filters.where.join(" AND ")}`
      : "";

    const [assignments] = await pool.query(
      `SELECT hca.*, hc.contract_number, hc.customer_id, hc.work_location,
              hc.hire_location_id, hc.start_date, hc.expected_end_date,
              hc.status AS contract_status, bl.code AS hire_location_code,
              bl.name AS hire_location_name, hcu.customer_name,
              fa.asset_code, fa.asset_name, fa.asset_type,
              fa.current_meter, fa.current_status
       FROM hire_contract_assets hca
       INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
       INNER JOIN business_locations bl ON bl.id = hc.hire_location_id
       INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
       INNER JOIN fleet_assets fa ON fa.id = hca.asset_id
       ${where}
       ORDER BY hca.created_at DESC
       LIMIT 500`,
      filters.params
    );

    return res.json({ status: "success", count: assignments.length, contract_assets: assignments });
  } catch (error) {
    console.error("Get contract assets error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load contract equipment." });
  }
});

// POST /api/equipment-hire/contracts/:id/assets
router.post("/contracts/:id/assets", requirePermission("hire.contracts.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const contractId = toPositiveInt(req.params.id);
    const assetId = toPositiveInt(req.body.asset_id);
    const assignedFrom = toDateTime(req.body.assigned_from);
    const assignedTo = toDateTime(req.body.assigned_to, null);
    const openingMeter = toNonNegativeNumber(req.body.opening_meter, null);

    if (!contractId || !assetId || !assignedFrom) {
      return res.status(400).json({
        status: "error",
        message: "Contract, fleet asset and assignment start are required.",
      });
    }
    if (assignedTo && assignedTo < assignedFrom) {
      return res.status(400).json({ status: "error", message: "Assignment end cannot be before start." });
    }

    await connection.beginTransaction();
    const contract = await getContract(
      contractId,
      connection,
      true,
      selectedHireLocationId(req)
    );
    if (!contract) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Hire contract not found." });
    }
    if (["completed", "cancelled"].includes(contract.status)) {
      await connection.rollback();
      return res.status(409).json({ status: "error", message: "Equipment cannot be assigned to a closed contract." });
    }

    const [assetRows] = await connection.query(
      "SELECT * FROM fleet_assets WHERE id = ? AND is_active = TRUE LIMIT 1 FOR UPDATE",
      [assetId]
    );
    const asset = assetRows[0] || null;
    if (!asset) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Active fleet asset not found." });
    }
    if (!["available", "idle"].includes(String(asset.current_status).toLowerCase())) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: `${asset.asset_code} is currently ${asset.current_status} and is not available for hire.`,
      });
    }
    if (openingMeter !== null && openingMeter < Number(asset.current_meter || 0)) {
      await connection.rollback();
      return res.status(400).json({
        status: "error",
        message: `Opening meter cannot be below the current Fleet meter of ${asset.current_meter}.`,
      });
    }

    const [overlaps] = await connection.query(
      `SELECT hca.id, hc.contract_number
       FROM hire_contract_assets hca
       INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
       WHERE hca.asset_id = ?
         AND hca.status IN ('assigned', 'dispatched', 'active')
         AND hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended', 'draft')
         AND hca.assigned_from <= COALESCE(?, '9999-12-31 23:59:59')
         AND COALESCE(hca.assigned_to, hc.expected_end_date, '9999-12-31') >= DATE(?)
       LIMIT 1`,
      [assetId, assignedTo, assignedFrom]
    );
    if (overlaps.length) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: `This asset is already assigned to ${overlaps[0].contract_number}.`,
      });
    }

    const [result] = await connection.query(
      `INSERT INTO hire_contract_assets (
         contract_id, asset_id, operator_name, assigned_from, assigned_to,
         opening_meter, status, notes, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, 'assigned', ?, ?, ?)`,
      [
        contractId,
        assetId,
        nullableText(req.body.operator_name, 150),
        assignedFrom,
        assignedTo,
        openingMeter === null ? Number(asset.current_meter || 0) : openingMeter,
        nullableText(req.body.notes, 3000),
        req.user.id,
        req.user.id,
      ]
    );

    await connection.query(
      `UPDATE fleet_assets
       SET current_status = 'assigned_hire', current_location = ?,
           assigned_operator_name = ?, updated_by = ?
       WHERE id = ?`,
      [
        contract.work_location,
        nullableText(req.body.operator_name, 150),
        req.user.id,
        assetId,
      ]
    );

    if (contract.status === "draft") {
      await connection.query(
        `UPDATE hire_contracts
         SET status = 'confirmed', approved_by = ?, approved_at = NOW(), updated_by = ?
         WHERE id = ?`,
        [req.user.id, req.user.id, contractId]
      );
    }

    await logActivity(
      connection,
      req,
      "ASSIGN_HIRE_ASSET",
      `Assigned ${asset.asset_code} to ${contract.contract_number}`
    );
    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Equipment assigned to the hire contract and Fleet availability updated.",
      contract_asset_id: result.insertId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Assign hire asset error:", error);
    if (sendDuplicateError(res, error, "This equipment assignment conflicts with an existing record.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not assign equipment to contract." });
  } finally {
    connection.release();
  }
});

// DELETE /api/equipment-hire/contract-assets/:id
router.delete("/contract-assets/:id", requirePermission("hire.contracts.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const contractAssetId = toPositiveInt(req.params.id);
    if (!contractAssetId) {
      return res.status(400).json({ status: "error", message: "A valid equipment assignment is required." });
    }

    await connection.beginTransaction();
    const assignment = await getContractAsset(
      contractAssetId,
      connection,
      true,
      selectedHireLocationId(req)
    );
    if (!assignment) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Contract equipment assignment not found." });
    }
    if (assignment.status !== "assigned") {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Only an assignment that has not been dispatched can be removed.",
      });
    }

    const [dispatchRows] = await connection.query(
      `SELECT id
       FROM hire_dispatches
       WHERE contract_asset_id = ?
       LIMIT 1`,
      [contractAssetId]
    );
    if (dispatchRows.length) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "This equipment has already been dispatched and cannot be removed here.",
      });
    }

    await connection.query(
      `UPDATE hire_contract_assets
       SET status = 'cancelled', updated_by = ?
       WHERE id = ?`,
      [req.user.id, contractAssetId]
    );

    const [otherObligations] = await connection.query(
      `SELECT hca.id
       FROM hire_contract_assets hca
       INNER JOIN hire_contracts hc ON hc.id = hca.contract_id
       WHERE hca.asset_id = ?
         AND hca.id <> ?
         AND hca.status IN ('assigned', 'dispatched', 'active')
         AND hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
       LIMIT 1`,
      [assignment.asset_id, contractAssetId]
    );

    if (!otherObligations.length) {
      await connection.query(
        `UPDATE fleet_assets
         SET current_status = 'available', current_location = 'Available yard',
             assigned_operator_name = NULL, updated_by = ?
         WHERE id = ?`,
        [req.user.id, assignment.asset_id]
      );
    }

    await logActivity(
      connection,
      req,
      "REMOVE_HIRE_ASSET_ASSIGNMENT",
      `Removed ${assignment.asset_code} from ${assignment.contract_number} before dispatch`
    );
    await connection.commit();

    return res.json({
      status: "success",
      message: "Equipment assignment removed before dispatch.",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Remove hire asset assignment error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not remove equipment assignment." });
  } finally {
    connection.release();
  }
});

// GET /api/equipment-hire/dispatches
router.get("/dispatches", requirePermission("hire.dispatch.view"), async (req, res) => {
  try {
    const filter = buildDateFilters(req, "dispatch_datetime", "hd");
    addSelectedHireLocation(filter, req, "hd");
    const where = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const [dispatches] = await pool.query(
      `SELECT hd.*, hc.contract_number, hcu.customer_name,
              fa.asset_code, fa.asset_name, hca.operator_name,
              bl.code AS hire_location_code,
              bl.name AS hire_location_name
       FROM hire_dispatches hd
       INNER JOIN hire_contracts hc ON hc.id = hd.contract_id
       INNER JOIN business_locations bl ON bl.id = hd.hire_location_id
       INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
       INNER JOIN hire_contract_assets hca ON hca.id = hd.contract_asset_id
       INNER JOIN fleet_assets fa ON fa.id = hca.asset_id
       ${where}
       ORDER BY hd.dispatch_datetime DESC, hd.id DESC
       LIMIT 500`,
      filter.params
    );
    return res.json({ status: "success", count: dispatches.length, dispatches });
  } catch (error) {
    console.error("Get hire dispatches error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load dispatch records." });
  }
});

// POST /api/equipment-hire/dispatches
router.post("/dispatches", requirePermission("hire.dispatch.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const contractAssetId = toPositiveInt(req.body.contract_asset_id);
    const dispatchDateTime = toDateTime(req.body.dispatch_datetime);
    const destination = cleanText(req.body.destination, 255);
    const openingMeter = toNonNegativeNumber(req.body.opening_meter, null);
    const fuelLevel = toNonNegativeNumber(req.body.fuel_level_percent, null);
    const condition = cleanText(req.body.condition_status, 30).toLowerCase() || "good";

    if (!contractAssetId || !dispatchDateTime || !destination || openingMeter === null) {
      return res.status(400).json({
        status: "error",
        message: "Assigned equipment, dispatch time, destination and opening meter are required.",
      });
    }
    if (fuelLevel !== null && fuelLevel > 100) {
      return res.status(400).json({ status: "error", message: "Fuel level cannot exceed 100 percent." });
    }
    if (!CONDITION_STATUSES.has(condition)) {
      return res.status(400).json({ status: "error", message: "Invalid dispatch condition." });
    }

    await connection.beginTransaction();
    const assignment = await getContractAsset(
      contractAssetId,
      connection,
      true,
      selectedHireLocationId(req)
    );
    if (!assignment) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Contract equipment assignment not found." });
    }
    if (assignment.status !== "assigned") {
      await connection.rollback();
      return res.status(409).json({ status: "error", message: "This equipment cannot be dispatched in its current state." });
    }
    if (!["confirmed", "mobilizing"].includes(assignment.contract_status)) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Only confirmed or mobilizing contracts can be dispatched.",
      });
    }
    if (openingMeter < Number(assignment.current_meter || 0)) {
      await connection.rollback();
      return res.status(400).json({
        status: "error",
        message: `Dispatch meter cannot be below the current Fleet meter of ${assignment.current_meter}.`,
      });
    }

    const dispatchNumber = await nextDocumentNumber("HDSP", { userId: req.user.id });
    const [result] = await connection.query(
      `INSERT INTO hire_dispatches (
         dispatch_number, hire_location_id, contract_id, contract_asset_id,
         dispatch_datetime, destination, opening_meter, fuel_level_percent,
         condition_status, attachments_tools, transport_details,
         receiving_person, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dispatchNumber,
        selectedHireLocationId(req),
        assignment.contract_id,
        contractAssetId,
        dispatchDateTime,
        destination,
        openingMeter,
        fuelLevel,
        condition,
        nullableText(req.body.attachments_tools, 3000),
        nullableText(req.body.transport_details, 3000),
        nullableText(req.body.receiving_person, 150),
        nullableText(req.body.notes, 3000),
        req.user.id,
      ]
    );

    await connection.query(
      `UPDATE hire_contract_assets
       SET status = 'dispatched', opening_meter = ?, updated_by = ?
       WHERE id = ?`,
      [openingMeter, req.user.id, contractAssetId]
    );
    await connection.query(
      `UPDATE hire_contracts
       SET status = 'active', updated_by = ?
       WHERE id = ?`,
      [req.user.id, assignment.contract_id]
    );
    await connection.query(
      `UPDATE fleet_assets
       SET current_meter = GREATEST(current_meter, ?), current_status = 'working',
           current_location = ?, assigned_operator_name = ?, updated_by = ?
       WHERE id = ?`,
      [
        openingMeter,
        destination,
        assignment.operator_name,
        req.user.id,
        assignment.asset_id,
      ]
    );
    await connection.query(
      `INSERT INTO fleet_meter_readings (
         asset_id, reading_value, reading_datetime, source_type, notes, recorded_by
       ) VALUES (?, ?, ?, 'hire_dispatch', ?, ?)`,
      [
        assignment.asset_id,
        openingMeter,
        dispatchDateTime,
        `Dispatch for ${assignment.contract_number}; hire dispatch ${result.insertId}`,
        req.user.id,
      ]
    );

    await logActivity(
      connection,
      req,
      "DISPATCH_HIRE_ASSET",
      `Dispatched ${assignment.asset_code} for ${assignment.contract_number}`
    );
    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Equipment dispatched and Fleet status updated.",
      dispatch_id: result.insertId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create hire dispatch error:", error);
    if (sendDuplicateError(res, error, "This contract equipment already has a dispatch record.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not save equipment dispatch." });
  } finally {
    connection.release();
  }
});

// GET /api/equipment-hire/work-logs
router.get("/work-logs", requirePermission("hire.work_logs.view"), async (req, res) => {
  try {
    const filter = buildDateFilters(req, "work_date", "hwl");
    const contractId = toPositiveInt(req.query.contract_id);
    const status = cleanText(req.query.status, 30).toLowerCase();
    if (contractId) {
      filter.where.push("hwl.contract_id = ?");
      filter.params.push(contractId);
    }
    if (status) {
      filter.where.push("hwl.status = ?");
      filter.params.push(status);
    }
    addSelectedHireLocation(filter, req, "hwl");
    const where = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";

    const [logs] = await pool.query(
      `SELECT hwl.*, hc.contract_number, hcu.customer_name,
              fa.asset_code, fa.asset_name,
              creator.full_name AS created_by_name,
              approver.full_name AS approved_by_name,
              bl.code AS hire_location_code,
              bl.name AS hire_location_name
       FROM hire_work_logs hwl
       INNER JOIN hire_contracts hc ON hc.id = hwl.contract_id
       INNER JOIN business_locations bl ON bl.id = hwl.hire_location_id
       INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
       INNER JOIN fleet_assets fa ON fa.id = hwl.asset_id
       LEFT JOIN users creator ON creator.id = hwl.created_by
       LEFT JOIN users approver ON approver.id = hwl.approved_by
       ${where}
       ORDER BY hwl.work_date DESC, hwl.id DESC
       LIMIT 500`,
      filter.params
    );

    return res.json({ status: "success", count: logs.length, work_logs: logs });
  } catch (error) {
    console.error("Get hire work logs error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load work logs." });
  }
});

// POST /api/equipment-hire/work-logs
router.post("/work-logs", requirePermission("hire.work_logs.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const contractAssetId = toPositiveInt(req.body.contract_asset_id);
    const workDate = toDateOnly(req.body.work_date);
    const startMeter = toNonNegativeNumber(req.body.start_meter, null);
    const endMeter = toNonNegativeNumber(req.body.end_meter, null);
    let billableHours = toNonNegativeNumber(req.body.billable_hours, null);
    const idleHours = toNonNegativeNumber(req.body.idle_hours, 0);
    const breakdownHours = toNonNegativeNumber(req.body.breakdown_hours, 0);
    const fuelLitres = toNonNegativeNumber(req.body.fuel_litres, 0);

    if (!contractAssetId || !workDate || startMeter === null || endMeter === null) {
      return res.status(400).json({
        status: "error",
        message: "Contract equipment, work date, start meter and end meter are required.",
      });
    }
    if (endMeter < startMeter) {
      return res.status(400).json({ status: "error", message: "End meter cannot be below start meter." });
    }
    if ([idleHours, breakdownHours, fuelLitres].some((value) => value === null)) {
      return res.status(400).json({ status: "error", message: "Work-log values must be zero or greater." });
    }
    if (billableHours === null) {
      billableHours = Number((endMeter - startMeter).toFixed(2));
    }

    await connection.beginTransaction();
    const assignment = await getContractAsset(
      contractAssetId,
      connection,
      true,
      selectedHireLocationId(req)
    );
    if (!assignment) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Contract equipment assignment not found." });
    }
    if (!["dispatched", "active"].includes(assignment.status)) {
      await connection.rollback();
      return res.status(409).json({ status: "error", message: "This equipment must be dispatched before a work log can be recorded." });
    }
    if (startMeter < Number(assignment.current_meter || 0)) {
      await connection.rollback();
      return res.status(400).json({
        status: "error",
        message: `Start meter cannot be below the current Fleet meter of ${assignment.current_meter}.`,
      });
    }

    const [dispatchRows] = await connection.query(
      `SELECT id
       FROM hire_dispatches
       WHERE contract_asset_id = ?
         AND contract_id = ?
         AND hire_location_id = ?
       LIMIT 1`,
      [contractAssetId, assignment.contract_id, selectedHireLocationId(req)]
    );
    if (!dispatchRows.length) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "A valid dispatch is required before recording work logs.",
      });
    }

    const [result] = await connection.query(
      `INSERT INTO hire_work_logs (
         hire_location_id, contract_id, contract_asset_id, asset_id,
         work_date, start_meter, end_meter, billable_hours, idle_hours,
         breakdown_hours, fuel_litres, work_description,
         customer_representative, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [
        selectedHireLocationId(req),
        assignment.contract_id,
        contractAssetId,
        assignment.asset_id,
        workDate,
        startMeter,
        endMeter,
        billableHours,
        idleHours,
        breakdownHours,
        fuelLitres,
        nullableText(req.body.work_description, 3000),
        nullableText(req.body.customer_representative, 150),
        req.user.id,
      ]
    );

    await connection.query(
      `UPDATE hire_contract_assets
       SET status = 'active', updated_by = ?
       WHERE id = ?`,
      [req.user.id, contractAssetId]
    );
    await connection.query(
      `UPDATE fleet_assets
       SET current_meter = GREATEST(current_meter, ?), current_status = 'working',
           updated_by = ?
       WHERE id = ?`,
      [endMeter, req.user.id, assignment.asset_id]
    );
    await connection.query(
      `INSERT INTO fleet_meter_readings (
         asset_id, reading_value, reading_datetime, source_type, notes, recorded_by
       ) VALUES (?, ?, ?, 'hire_work_log', ?, ?)`,
      [
        assignment.asset_id,
        endMeter,
        `${workDate} 18:00:00`,
        `Work log for ${assignment.contract_number}; hire work log ${result.insertId}`,
        req.user.id,
      ]
    );

    await logActivity(
      connection,
      req,
      "CREATE_HIRE_WORK_LOG",
      `Recorded ${billableHours} billable hours for ${assignment.asset_code} on ${assignment.contract_number}`
    );
    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Hire work log saved and Fleet meter updated.",
      work_log_id: result.insertId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create hire work log error:", error);
    if (sendDuplicateError(res, error, "This equipment already has a work log for the selected date.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not save hire work log." });
  } finally {
    connection.release();
  }
});

// PATCH /api/equipment-hire/work-logs/:id/approve
router.patch("/work-logs/:id/approve", requirePermission("hire.work_logs.approve"), async (req, res) => {
  try {
    const workLogId = toPositiveInt(req.params.id);
    const status = cleanText(req.body.status, 30).toLowerCase() || "approved";
    if (!workLogId || !WORK_LOG_STATUSES.has(status)) {
      return res.status(400).json({ status: "error", message: "Valid work log and status are required." });
    }

    const [result] = await pool.query(
      `UPDATE hire_work_logs
       SET status = ?, approved_by = ?,
           approved_at = CASE WHEN ? = 'approved' THEN NOW() ELSE NULL END
       WHERE id = ? AND hire_location_id = ?`,
      [status, req.user.id, status, workLogId, selectedHireLocationId(req)]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ status: "error", message: "Hire work log not found." });
    }

    await logActivity(pool, req, "APPROVE_HIRE_WORK_LOG", `Changed work log ${workLogId} to ${status}`);
    return res.json({ status: "success", message: "Work-log status updated." });
  } catch (error) {
    console.error("Approve hire work log error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not update work-log status." });
  }
});

// GET /api/equipment-hire/invoices
router.get("/finance-summary", requirePermission("hire.reports.view"), async (req, res) => {
  try {
    const locationId = selectedHireLocationId(req);
    const invoiceLocation = locationId ? "AND hi.hire_location_id = ?" : "";
    const customerLocation = locationId ? "AND hi.hire_location_id = ?" : "";
    const params = locationId ? [locationId] : [];
    const agingBucket = agingBucketSql("hi");

    const [[invoiceSummaryRows], [agingRows], [customerBalances], [outstandingInvoices]] =
      await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) AS invoice_count,
             COALESCE(SUM(CASE WHEN hi.status <> 'void' THEN hi.total_amount ELSE 0 END), 0) AS invoice_total,
             COALESCE(SUM(CASE WHEN hi.status <> 'void' THEN hi.amount_paid ELSE 0 END), 0) AS amount_paid,
             COALESCE(SUM(CASE WHEN hi.status <> 'void' THEN hi.balance ELSE 0 END), 0) AS outstanding_balance,
             COALESCE(SUM(CASE WHEN hi.status <> 'void' AND hi.balance > 0 AND hi.due_date < CURDATE() THEN hi.balance ELSE 0 END), 0) AS overdue_balance,
             SUM(CASE WHEN hi.status <> 'void' AND hi.balance > 0 THEN 1 ELSE 0 END) AS open_invoice_count
           FROM hire_invoices hi
           WHERE 1 = 1 ${invoiceLocation}`,
          params
        ),
        pool.query(
          `SELECT bucket, COUNT(*) AS invoice_count, COALESCE(SUM(balance), 0) AS balance
           FROM (
             SELECT ${agingBucket} AS bucket, hi.balance
             FROM hire_invoices hi
             WHERE hi.status <> 'void'
               AND hi.balance > 0
               ${invoiceLocation}
           ) aged
           GROUP BY bucket`,
          params
        ),
        pool.query(
          `SELECT hcu.id, hcu.customer_code, hcu.customer_name,
                  COUNT(hi.id) AS invoice_count,
                  COALESCE(SUM(hi.total_amount), 0) AS total_amount,
                  COALESCE(SUM(hi.amount_paid), 0) AS amount_paid,
                  COALESCE(SUM(hi.balance), 0) AS outstanding_balance,
                  COALESCE(SUM(CASE WHEN hi.balance > 0 AND hi.due_date < CURDATE() THEN hi.balance ELSE 0 END), 0) AS overdue_balance
           FROM hire_customers hcu
           INNER JOIN hire_invoices hi ON hi.customer_id = hcu.id
           WHERE hi.status <> 'void'
             AND hi.balance > 0
             ${customerLocation}
           GROUP BY hcu.id, hcu.customer_code, hcu.customer_name
           ORDER BY outstanding_balance DESC, hcu.customer_name ASC
           LIMIT 50`,
          params
        ),
        pool.query(
          `SELECT hi.id, hi.invoice_number, hi.invoice_date, hi.due_date,
                  hi.total_amount, hi.amount_paid, hi.balance, hi.status,
                  ${agingBucket} AS aging_bucket,
                  hcu.customer_name, hc.contract_number,
                  bl.code AS hire_location_code, bl.name AS hire_location_name
           FROM hire_invoices hi
           INNER JOIN hire_customers hcu ON hcu.id = hi.customer_id
           INNER JOIN hire_contracts hc ON hc.id = hi.contract_id
           INNER JOIN business_locations bl ON bl.id = hi.hire_location_id
           WHERE hi.status <> 'void'
             AND hi.balance > 0
             ${invoiceLocation}
           ORDER BY hi.due_date ASC, hi.invoice_date ASC
           LIMIT 100`,
          params
        ),
      ]);

    const aging = {
      current: { invoice_count: 0, balance: 0 },
      "1_30": { invoice_count: 0, balance: 0 },
      "31_60": { invoice_count: 0, balance: 0 },
      "61_90": { invoice_count: 0, balance: 0 },
      over_90: { invoice_count: 0, balance: 0 },
    };
    agingRows.forEach((row) => {
      if (aging[row.bucket]) {
        aging[row.bucket] = {
          invoice_count: Number(row.invoice_count || 0),
          balance: Number(row.balance || 0),
        };
      }
    });

    return res.json({
      status: "success",
      hire_location: req.hireLocationScope?.location || null,
      all_locations: Boolean(req.hireLocationScope?.allLocations),
      summary: invoiceSummaryRows[0] || {},
      aging,
      customer_balances: customerBalances,
      outstanding_invoices: outstandingInvoices,
    });
  } catch (error) {
    console.error("Get hire finance summary error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load Equipment Hire finance summary." });
  }
});

// GET /api/equipment-hire/billable-work-logs
router.get("/billable-work-logs", requirePermission("hire.work_logs.view"), async (req, res) => {
  try {
    const contractId = toPositiveInt(req.query.contract_id);
    const filter = buildDateFilters(req, "work_date", "hwl");
    filter.where.push("hwl.status = 'approved'");
    filter.where.push("hil.id IS NULL");
    if (contractId) {
      filter.where.push("hwl.contract_id = ?");
      filter.params.push(contractId);
    }
    addSelectedHireLocation(filter, req, "hwl");
    const where = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";

    const [logs] = await pool.query(
      `SELECT hwl.*, hc.contract_number, hc.rate, hc.charging_method,
              hcu.customer_name, fa.asset_code, fa.asset_name,
              bl.code AS hire_location_code, bl.name AS hire_location_name
       FROM hire_work_logs hwl
       INNER JOIN hire_contracts hc ON hc.id = hwl.contract_id
       INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
       INNER JOIN fleet_assets fa ON fa.id = hwl.asset_id
       INNER JOIN business_locations bl ON bl.id = hwl.hire_location_id
       LEFT JOIN hire_invoice_lines hil ON hil.work_log_id = hwl.id
       ${where}
       ORDER BY hwl.work_date ASC, hwl.id ASC
       LIMIT 500`,
      filter.params
    );

    return res.json({ status: "success", count: logs.length, work_logs: logs });
  } catch (error) {
    console.error("Get billable hire work logs error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load approved uninvoiced work logs." });
  }
});

// GET /api/equipment-hire/invoices
router.get("/invoices", requirePermission("hire.invoices.view"), async (req, res) => {
  try {
    const filter = buildDateFilters(req, "invoice_date", "hi");
    const status = cleanText(req.query.status, 30).toLowerCase();
    if (status) {
      filter.where.push("hi.status = ?");
      filter.params.push(status);
    }
    addSelectedHireLocation(filter, req, "hi");
    const where = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";

    const [invoices] = await pool.query(
      `SELECT hi.*, hc.contract_number, hcu.customer_code, hcu.customer_name,
              creator.full_name AS created_by_name,
              ${agingBucketSql("hi")} AS aging_bucket,
              (
                SELECT COUNT(*)
                FROM hire_invoice_lines hil
                WHERE hil.invoice_id = hi.id
              ) AS line_count,
              bl.code AS hire_location_code,
              bl.name AS hire_location_name
       FROM hire_invoices hi
       INNER JOIN hire_contracts hc ON hc.id = hi.contract_id
       INNER JOIN business_locations bl ON bl.id = hi.hire_location_id
       INNER JOIN hire_customers hcu ON hcu.id = hi.customer_id
       LEFT JOIN users creator ON creator.id = hi.created_by
       ${where}
       ORDER BY hi.invoice_date DESC, hi.id DESC
       LIMIT 500`,
      filter.params
    );

    return res.json({ status: "success", count: invoices.length, invoices });
  } catch (error) {
    console.error("Get hire invoices error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load hire invoices." });
  }
});

// POST /api/equipment-hire/invoices
router.post("/invoices", requirePermission("hire.invoices.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const contractId = toPositiveInt(req.body.contract_id);
    const invoiceDate = toDateOnly(req.body.invoice_date);
    const periodStart = toDateOnly(req.body.period_start, null);
    const periodEnd = toDateOnly(req.body.period_end, null);
    const manualQuantity = toNonNegativeNumber(req.body.billable_quantity, null);
    const workLogIds = normalizeIdList(req.body.work_log_ids);
    const otherAmount = toNonNegativeNumber(req.body.other_amount, 0);
    const discount = toNonNegativeNumber(req.body.discount_amount, 0);
    const taxRate = toNonNegativeNumber(req.body.tax_rate, 0);

    if (!contractId || !invoiceDate) {
      return res.status(400).json({ status: "error", message: "Contract and invoice date are required." });
    }
    if (periodStart && periodEnd && periodEnd < periodStart) {
      return res.status(400).json({ status: "error", message: "Invoice period end cannot be before start." });
    }
    if ([otherAmount, discount, taxRate].some((value) => value === null)) {
      return res.status(400).json({ status: "error", message: "Invoice amounts must be zero or greater." });
    }

    await connection.beginTransaction();
    const contract = await getContract(
      contractId,
      connection,
      true,
      selectedHireLocationId(req)
    );
    if (!contract) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Hire contract not found." });
    }

    const [[customer]] = await connection.query(
      "SELECT payment_terms_days FROM hire_customers WHERE id = ? LIMIT 1",
      [contract.customer_id]
    );
    const dueDate =
      toDateOnly(req.body.due_date, null) ||
      addDays(invoiceDate, Number(customer?.payment_terms_days || 0));
    if (dueDate < invoiceDate) {
      await connection.rollback();
      return res.status(400).json({ status: "error", message: "Invoice due date cannot be before invoice date." });
    }

    let approvedQuantity = 0;
    let approvedLogs = [];
    if (manualQuantity === null || workLogIds.length) {
      const params = [contractId, selectedHireLocationId(req)];
      const where = [
        "hwl.contract_id = ?",
        "hwl.hire_location_id = ?",
        "hwl.status = 'approved'",
        "hil.id IS NULL",
      ];
      if (!workLogIds.length && periodStart) {
        where.push("hwl.work_date >= ?");
        params.push(periodStart);
      }
      if (!workLogIds.length && periodEnd) {
        where.push("hwl.work_date <= ?");
        params.push(periodEnd);
      }
      if (workLogIds.length) {
        where.push(`hwl.id IN (${workLogIds.map(() => "?").join(", ")})`);
        params.push(...workLogIds);
      }
      const [logs] = await connection.query(
        `SELECT hwl.*, fa.asset_code, fa.asset_name
         FROM hire_work_logs hwl
         INNER JOIN fleet_assets fa ON fa.id = hwl.asset_id
         LEFT JOIN hire_invoice_lines hil ON hil.work_log_id = hwl.id
         WHERE ${where.join(" AND ")}
         ORDER BY hwl.work_date ASC, hwl.id ASC
         FOR UPDATE`,
        params
      );
      approvedLogs = logs;

      if (workLogIds.length && approvedLogs.length !== workLogIds.length) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message:
            "One or more selected work logs are not approved, are already invoiced, or are outside this Hire location.",
        });
      }

      if (!approvedLogs.length && manualQuantity === null) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "No approved uninvoiced work logs were found for this contract and period.",
        });
      }

      approvedQuantity = approvedLogs.reduce(
        (sum, row) => sum + Number(row.billable_hours || 0),
        0
      );
    } else {
      approvedQuantity = manualQuantity;
    }

    const billingQuantity =
      contract.charging_method === "fixed"
        ? 1
        : Math.max(approvedQuantity, Number(contract.minimum_quantity || 0));
    const baseAmount =
      contract.charging_method === "fixed"
        ? Number(contract.rate || 0)
        : Number((billingQuantity * Number(contract.rate || 0)).toFixed(2));

    const mobilization = req.body.include_mobilization
      ? Number(contract.mobilization_amount || 0)
      : 0;
    const demobilization = req.body.include_demobilization
      ? Number(contract.demobilization_amount || 0)
      : 0;
    const operatorAmount = req.body.include_operator
      ? Number(contract.operator_amount || 0)
      : 0;

    const chargeLines = [];
    if (approvedLogs.length) {
      if (contract.charging_method === "fixed") {
        let allocated = 0;
        approvedLogs.forEach((log, index) => {
          const isLast = index === approvedLogs.length - 1;
          const proportion =
            approvedQuantity > 0
              ? Number(log.billable_hours || 0) / approvedQuantity
              : 1 / approvedLogs.length;
          const lineAmount = isLast
            ? Number((baseAmount - allocated).toFixed(2))
            : Number((baseAmount * proportion).toFixed(2));
          allocated = Number((allocated + lineAmount).toFixed(2));
          chargeLines.push({
            work_log_id: log.id,
            contract_asset_id: log.contract_asset_id,
            asset_id: log.asset_id,
            description: `${log.asset_code} ${log.asset_name} work log ${databaseDate(log.work_date)}`,
            quantity: Number(log.billable_hours || 0),
            unit_rate: 0,
            line_amount: lineAmount,
          });
        });
      } else {
        approvedLogs.forEach((log) => {
          chargeLines.push({
            work_log_id: log.id,
            contract_asset_id: log.contract_asset_id,
            asset_id: log.asset_id,
            description: `${log.asset_code} ${log.asset_name} work log ${databaseDate(log.work_date)}`,
            quantity: Number(log.billable_hours || 0),
            unit_rate: Number(contract.rate || 0),
            line_amount: Number((Number(log.billable_hours || 0) * Number(contract.rate || 0)).toFixed(2)),
          });
        });

        const workLogLineTotal = chargeLines.reduce(
          (sum, line) => sum + Number(line.line_amount || 0),
          0
        );
        if (baseAmount > workLogLineTotal) {
          chargeLines.push({
            work_log_id: null,
            contract_asset_id: null,
            asset_id: null,
            description: "Minimum hire quantity adjustment",
            quantity: Number((billingQuantity - approvedQuantity).toFixed(2)),
            unit_rate: Number(contract.rate || 0),
            line_amount: Number((baseAmount - workLogLineTotal).toFixed(2)),
          });
        }
      }
    } else {
      chargeLines.push({
        work_log_id: null,
        contract_asset_id: null,
        asset_id: null,
        description: `${contract.charging_method} contract charge for ${contract.contract_number}`,
        quantity: billingQuantity,
        unit_rate: Number(contract.rate || 0),
        line_amount: baseAmount,
      });
    }

    [
      ["Mobilization", mobilization],
      ["Demobilization", demobilization],
      ["Operator charge", operatorAmount],
      ["Other approved charges", otherAmount],
    ].forEach(([description, amount]) => {
      if (Number(amount || 0) > 0) {
        chargeLines.push({
          work_log_id: null,
          contract_asset_id: null,
          asset_id: null,
          description,
          quantity: 1,
          unit_rate: Number(amount || 0),
          line_amount: Number(amount || 0),
        });
      }
    });

    const subtotal = Number(
      (baseAmount + mobilization + demobilization + operatorAmount + otherAmount).toFixed(2)
    );
    if (discount > subtotal) {
      await connection.rollback();
      return res.status(400).json({ status: "error", message: "Invoice discount cannot exceed subtotal." });
    }
    const taxable = subtotal - discount;
    const taxAmount = Number((taxable * (taxRate / 100)).toFixed(2));
    const total = Number((taxable + taxAmount).toFixed(2));

    const invoiceNumber = await nextDocumentNumber("HINV", { userId: req.user.id });
    const initialStatus =
      dueDate < new Date().toISOString().slice(0, 10) ? "overdue" : "issued";
    const [result] = await connection.query(
      `INSERT INTO hire_invoices (
         hire_location_id, invoice_number, contract_id, customer_id,
         invoice_date, due_date,
         period_start, period_end, billable_quantity, rate, base_amount,
         mobilization_amount, demobilization_amount, operator_amount, other_amount,
         subtotal, discount_amount, tax_amount, total_amount, amount_paid, balance,
         status, notes, created_by, issued_by, issued_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, NOW())`,
      [
        selectedHireLocationId(req),
        invoiceNumber,
        contractId,
        contract.customer_id,
        invoiceDate,
        dueDate,
        periodStart,
        periodEnd,
        approvedQuantity,
        Number(contract.rate || 0),
        baseAmount,
        mobilization,
        demobilization,
        operatorAmount,
        otherAmount,
        subtotal,
        discount,
        taxAmount,
        total,
        total,
        initialStatus,
        nullableText(req.body.notes, 3000),
        req.user.id,
        req.user.id,
      ]
    );

    for (const line of chargeLines) {
      if (Number(line.quantity || 0) < 0 || Number(line.unit_rate || 0) < 0) {
        await connection.rollback();
        return res.status(400).json({ status: "error", message: "Invoice line quantities and rates must be zero or greater." });
      }

      await connection.query(
        `INSERT INTO hire_invoice_lines (
           invoice_id, work_log_id, contract_asset_id, asset_id,
           description, quantity, unit_rate, line_amount,
           discount_amount, tax_amount
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        [
          result.insertId,
          line.work_log_id,
          line.contract_asset_id,
          line.asset_id,
          cleanText(line.description, 255),
          Number(line.quantity || 0),
          Number(line.unit_rate || 0),
          Number(line.line_amount || 0),
        ]
      );
    }

    await logActivity(
      connection,
      req,
      "CREATE_HIRE_INVOICE",
      `Issued ${invoiceNumber} for ${contract.contract_number}; GHS ${total.toFixed(2)}`
    );
    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Hire invoice created successfully.",
      invoice_id: result.insertId,
      invoice_number: invoiceNumber,
      totals: { billable_quantity: approvedQuantity, subtotal, tax_amount: taxAmount, total_amount: total },
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create hire invoice error:", error);
    if (error?.code === "ER_DUP_ENTRY" && String(error.message || "").includes("uq_hire_invoice_line_work_log")) {
      return res.status(409).json({ status: "error", message: "One of these approved work logs has already been invoiced." });
    }
    if (sendDuplicateError(res, error, "That invoice number already exists.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not create hire invoice." });
  } finally {
    connection.release();
  }
});

// PATCH /api/equipment-hire/invoices/:id/void
router.patch("/invoices/:id/void", requirePermission("hire.invoices.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const invoiceId = toPositiveInt(req.params.id);
    if (!invoiceId) {
      return res.status(400).json({ status: "error", message: "A valid invoice is required." });
    }

    await connection.beginTransaction();
    const [invoiceRows] = await connection.query(
      `SELECT *
       FROM hire_invoices
       WHERE id = ? AND hire_location_id = ?
       LIMIT 1 FOR UPDATE`,
      [invoiceId, selectedHireLocationId(req)]
    );
    const invoice = invoiceRows[0] || null;
    if (!invoice) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Hire invoice not found." });
    }
    if (invoice.status === "void") {
      await connection.rollback();
      return res.status(409).json({ status: "error", message: "This invoice is already void." });
    }
    if (Number(invoice.amount_paid || 0) > 0) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Invoices with payments cannot be voided. Reverse the payment through the approved process first.",
      });
    }

    await connection.query(
      `UPDATE hire_invoices
       SET status = 'void', balance = 0
       WHERE id = ?`,
      [invoiceId]
    );

    // Preserve the void invoice's descriptive lines but release approved work
    // logs so they may be selected on a corrected replacement invoice.
    await connection.query(
      `UPDATE hire_invoice_lines
       SET work_log_id = NULL
       WHERE invoice_id = ?`,
      [invoiceId]
    );

    await logActivity(
      connection,
      req,
      "VOID_HIRE_INVOICE",
      `Voided hire invoice ${invoice.invoice_number}`
    );
    await connection.commit();

    return res.json({ status: "success", message: "Hire invoice voided." });
  } catch (error) {
    await connection.rollback();
    console.error("Void hire invoice error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not void hire invoice." });
  } finally {
    connection.release();
  }
});

// GET /api/equipment-hire/payments
router.get("/payments", requirePermission("hire.payments.view"), async (req, res) => {
  try {
    const filter = buildDateFilters(req, "payment_date", "hp");
    addSelectedHireLocation(filter, req, "hp");
    const where = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const [payments] = await pool.query(
      `SELECT hp.*, hc.contract_number, hcu.customer_name, hi.invoice_number,
              receiver.full_name AS received_by_name,
              bl.code AS hire_location_code,
              bl.name AS hire_location_name
       FROM hire_payments hp
       INNER JOIN hire_contracts hc ON hc.id = hp.contract_id
       INNER JOIN business_locations bl ON bl.id = hp.hire_location_id
       INNER JOIN hire_customers hcu ON hcu.id = hp.customer_id
       LEFT JOIN hire_invoices hi ON hi.id = hp.invoice_id
       LEFT JOIN users receiver ON receiver.id = hp.received_by
       ${where}
       ORDER BY hp.payment_date DESC, hp.id DESC
       LIMIT 500`,
      filter.params
    );
    return res.json({ status: "success", count: payments.length, payments });
  } catch (error) {
    console.error("Get hire payments error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load hire payments." });
  }
});

// POST /api/equipment-hire/payments
router.post("/payments", requirePermission("hire.payments.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const invoiceId = toPositiveInt(req.body.invoice_id);
    let contractId = toPositiveInt(req.body.contract_id);
    const paymentDate = toDateTime(req.body.payment_date);
    const category = cleanText(req.body.payment_category, 30).toLowerCase();
    const amount = toPositiveNumber(req.body.amount);
    const paymentMethod = cleanText(req.body.payment_method, 40).toLowerCase();

    if (
      !paymentDate ||
      !amount ||
      !PAYMENT_CATEGORIES.has(category) ||
      !PAYMENT_METHODS.has(paymentMethod)
    ) {
      return res.status(400).json({
        status: "error",
        message: "Payment date, category, amount and payment method are required.",
      });
    }
    if (category === "invoice" && !invoiceId) {
      return res.status(400).json({
        status: "error",
        message: "Choose an invoice before recording an invoice payment.",
      });
    }
    if (category !== "invoice" && invoiceId) {
      return res.status(400).json({
        status: "error",
        message: "Only invoice-category payments may be linked to an invoice.",
      });
    }

    await connection.beginTransaction();

    let invoice = null;
    if (invoiceId) {
      const [invoiceRows] = await connection.query(
        `SELECT *
         FROM hire_invoices
         WHERE id = ? AND hire_location_id = ?
         LIMIT 1 FOR UPDATE`,
        [invoiceId, selectedHireLocationId(req)]
      );
      invoice = invoiceRows[0] || null;
      if (!invoice) {
        await connection.rollback();
        return res.status(404).json({ status: "error", message: "Hire invoice not found." });
      }
      if (invoice.status === "void") {
        await connection.rollback();
        return res.status(409).json({ status: "error", message: "A void invoice cannot receive payment." });
      }
      if (amount > Number(invoice.balance || 0)) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message: `Payment cannot exceed the invoice balance of GHS ${Number(invoice.balance || 0).toFixed(2)}.`,
        });
      }
      contractId = invoice.contract_id;
    }

    if (!contractId) {
      await connection.rollback();
      return res.status(400).json({ status: "error", message: "Contract is required for this payment." });
    }

    const contract = await getContract(
      contractId,
      connection,
      true,
      selectedHireLocationId(req)
    );
    if (!contract) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Hire contract not found." });
    }
    if (invoice && Number(invoice.customer_id) !== Number(contract.customer_id)) {
      await connection.rollback();
      return res.status(400).json({ status: "error", message: "Invoice and contract customer do not match." });
    }

    const referenceNumber = nullableText(req.body.reference_number, 120);
    if (referenceNumber) {
      const [duplicateReferences] = await connection.query(
        `SELECT id
         FROM hire_payments
         WHERE hire_location_id = ?
           AND payment_method = ?
           AND reference_number = ?
         LIMIT 1`,
        [selectedHireLocationId(req), paymentMethod, referenceNumber]
      );
      if (duplicateReferences.length) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "A payment with this method and reference number already exists in this Hire location.",
        });
      }
    }

    const [result] = await connection.query(
      `INSERT INTO hire_payments (
         hire_location_id, invoice_id, contract_id, customer_id,
         payment_date, payment_category, amount, payment_method,
         reference_number, notes, received_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        selectedHireLocationId(req),
        invoiceId,
        contractId,
        contract.customer_id,
        paymentDate,
        category,
        amount,
        paymentMethod,
        referenceNumber,
        nullableText(req.body.notes, 3000),
        req.user.id,
      ]
    );

    if (invoice) {
      const nextPaid = Number((Number(invoice.amount_paid || 0) + amount).toFixed(2));
      const nextBalance = Number((Number(invoice.total_amount || 0) - nextPaid).toFixed(2));
      const nextStatus = invoiceStatusForBalance(nextBalance, invoice.due_date);
      await connection.query(
        `UPDATE hire_invoices
         SET amount_paid = ?, balance = ?, status = ?
         WHERE id = ?`,
        [nextPaid, Math.max(0, nextBalance), nextStatus, invoiceId]
      );
    }

    if (category === "deposit") {
      await connection.query(
        `UPDATE hire_contracts
         SET deposit_received = deposit_received + ?, updated_by = ?
         WHERE id = ?`,
        [amount, req.user.id, contractId]
      );
    }

    await logActivity(
      connection,
      req,
      "CREATE_HIRE_PAYMENT",
      `Received GHS ${amount.toFixed(2)} for ${contract.contract_number}`
    );
    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Hire payment recorded successfully.",
      payment_id: result.insertId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create hire payment error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not record hire payment." });
  } finally {
    connection.release();
  }
});

// GET /api/equipment-hire/returns
router.get("/returns", requirePermission("hire.returns.view"), async (req, res) => {
  try {
    const filter = buildDateFilters(req, "return_datetime", "hri");
    addSelectedHireLocation(filter, req, "hri");
    const where = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const [returns] = await pool.query(
      `SELECT hri.*, hc.contract_number, hcu.customer_name,
              fa.asset_code, fa.asset_name, hca.operator_name,
              bl.code AS hire_location_code,
              bl.name AS hire_location_name
       FROM hire_return_inspections hri
       INNER JOIN hire_contracts hc ON hc.id = hri.contract_id
       INNER JOIN business_locations bl ON bl.id = hri.hire_location_id
       INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
       INNER JOIN hire_contract_assets hca ON hca.id = hri.contract_asset_id
       INNER JOIN fleet_assets fa ON fa.id = hca.asset_id
       ${where}
       ORDER BY hri.return_datetime DESC, hri.id DESC
       LIMIT 500`,
      filter.params
    );
    return res.json({ status: "success", count: returns.length, returns });
  } catch (error) {
    console.error("Get hire returns error:", error);
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not load return inspections." });
  }
});

// POST /api/equipment-hire/returns
router.post("/returns", requirePermission("hire.returns.manage"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const contractAssetId = toPositiveInt(req.body.contract_asset_id);
    const returnDateTime = toDateTime(req.body.return_datetime);
    const closingMeter = toNonNegativeNumber(req.body.closing_meter, null);
    const fuelLevel = toNonNegativeNumber(req.body.fuel_level_percent, null);
    const condition = cleanText(req.body.condition_status, 30).toLowerCase();
    const damageAmount = toNonNegativeNumber(req.body.estimated_damage_amount, 0);

    if (!contractAssetId || !returnDateTime || closingMeter === null || !CONDITION_STATUSES.has(condition)) {
      return res.status(400).json({
        status: "error",
        message: "Contract equipment, return time, closing meter and condition are required.",
      });
    }
    if (fuelLevel !== null && fuelLevel > 100) {
      return res.status(400).json({ status: "error", message: "Fuel level cannot exceed 100 percent." });
    }
    if (damageAmount === null) {
      return res.status(400).json({ status: "error", message: "Damage estimate must be zero or greater." });
    }

    await connection.beginTransaction();
    const assignment = await getContractAsset(
      contractAssetId,
      connection,
      true,
      selectedHireLocationId(req)
    );
    if (!assignment) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Contract equipment assignment not found." });
    }
    if (["returned", "cancelled"].includes(assignment.status)) {
      await connection.rollback();
      return res.status(409).json({ status: "error", message: "This equipment assignment is already closed." });
    }
    if (!["dispatched", "active"].includes(assignment.status)) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Equipment must be dispatched before a return inspection can be completed.",
      });
    }
    if (closingMeter < Number(assignment.current_meter || 0)) {
      await connection.rollback();
      return res.status(400).json({
        status: "error",
        message: `Closing meter cannot be below the current Fleet meter of ${assignment.current_meter}.`,
      });
    }

    const [dispatchRows] = await connection.query(
      `SELECT id
       FROM hire_dispatches
       WHERE contract_asset_id = ?
         AND contract_id = ?
         AND hire_location_id = ?
       LIMIT 1`,
      [contractAssetId, assignment.contract_id, selectedHireLocationId(req)]
    );
    if (!dispatchRows.length) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "A valid dispatch is required before equipment can be returned.",
      });
    }

    const damageDetails = nullableText(req.body.damage_details, 3000);
    const missingItems = nullableText(req.body.missing_items, 3000);
    const damaged = isDamagedReturn({
      condition,
      damageAmount,
      damageDetails,
      missingItems,
    });

    const returnNumber = await nextDocumentNumber("HRET", { userId: req.user.id });
    const [result] = await connection.query(
      `INSERT INTO hire_return_inspections (
         return_number, hire_location_id, contract_id, contract_asset_id,
         return_datetime, closing_meter, fuel_level_percent,
         condition_status, damage_details, missing_items,
         estimated_damage_amount, customer_representative, status,
         notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
      [
        returnNumber,
        selectedHireLocationId(req),
        assignment.contract_id,
        contractAssetId,
        returnDateTime,
        closingMeter,
        fuelLevel,
        condition,
        damageDetails,
        missingItems,
        damageAmount,
        nullableText(req.body.customer_representative, 150),
        nullableText(req.body.notes, 3000),
        req.user.id,
      ]
    );

    await connection.query(
      `UPDATE hire_contract_assets
       SET status = 'returned', closing_meter = ?, assigned_to = ?,
           updated_by = ?
       WHERE id = ?`,
      [closingMeter, returnDateTime, req.user.id, contractAssetId]
    );
    await connection.query(
      `UPDATE fleet_assets
       SET current_meter = GREATEST(current_meter, ?), current_status = ?,
           current_location = ?, assigned_operator_name = NULL,
           updated_by = ?
       WHERE id = ?`,
      [
        closingMeter,
        damaged ? "maintenance" : "available",
        damaged ? "Maintenance required after hire return" : "Available yard",
        req.user.id,
        assignment.asset_id,
      ]
    );
    await connection.query(
      `INSERT INTO fleet_meter_readings (
         asset_id, reading_value, reading_datetime, source_type, notes, recorded_by
       ) VALUES (?, ?, ?, 'hire_return', ?, ?)`,
      [
        assignment.asset_id,
        closingMeter,
        returnDateTime,
        `Return inspection for ${assignment.contract_number}; hire return ${result.insertId}`,
        req.user.id,
      ]
    );

    const [[openAssignments]] = await connection.query(
      `SELECT COUNT(*) AS open_count
       FROM hire_contract_assets
       WHERE contract_id = ? AND status IN ('assigned', 'dispatched', 'active')`,
      [assignment.contract_id]
    );
    if (Number(openAssignments.open_count || 0) === 0) {
      await connection.query(
        `UPDATE hire_contracts
         SET operational_status = 'returned_pending_closure',
             actual_end_date = DATE(?),
             updated_by = ?
         WHERE id = ?`,
        [returnDateTime, req.user.id, assignment.contract_id]
      );
    }

    await logActivity(
      connection,
      req,
      "RETURN_HIRE_ASSET",
      `Returned ${assignment.asset_code} from ${assignment.contract_number}`
    );
    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: damaged
        ? "Return inspection saved. Equipment moved to Fleet maintenance."
        : "Return inspection saved and equipment released back to Fleet.",
      return_id: result.insertId,
      fleet_status: damaged ? "maintenance" : "available",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create hire return error:", error);
    if (sendDuplicateError(res, error, "This contract equipment already has a return inspection.")) return;
    if (sendHireSetupError(res, error)) return;
    return res.status(500).json({ status: "error", message: "Could not save return inspection." });
  } finally {
    connection.release();
  }
});

module.exports = router;
