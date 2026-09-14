const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
} = require("../middleware/permissionMiddleware");
const {
  revokeAllUserSessions,
} = require("../services/accountSessionService");
const {
  friendlySessionEvidence,
} = require("../services/sessionDeviceService");
const {
  writeAuditEvent,
} = require("../services/auditTrailService");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
  sendSmsAlertToPhone,
} = require("../services/smsAlertService");
const {
  getBusinessUnitId,
  normalizeCategory,
} = require("../services/categoryIsolationService");

const router = express.Router();

const SYSTEM_ADMIN_ID = Number(
  process.env.SYSTEM_ADMIN_USER_ID || 1
);
const SYSTEM_ADMIN_USERNAME = String(
  process.env.SYSTEM_ADMIN_USERNAME || "admin"
)
  .trim()
  .toLowerCase();

const PROTECTED_WINDOW_MINUTES = Math.max(
  Math.min(
    Number(
      process.env.PROTECTED_ACTION_WINDOW_MINUTES || 10
    ),
    30
  ),
  5
);

const OWNER_SESSION_MINUTES = Math.max(
  Math.min(
    Number(
      process.env.OWNER_RECOVERY_SESSION_MINUTES || 15
    ),
    30
  ),
  5
);

const OWNER_MAX_FAILURES = Math.max(
  Math.min(
    Number(
      process.env.OWNER_RECOVERY_MAX_FAILED_ATTEMPTS || 5
    ),
    10
  ),
  3
);

const MANIFEST_VERSION = "chalin03-release2-final-v1";

const LEGACY_TABLES = new Set([
  "stores",
  "user_store_access",
  "activity_logs",
]);

const DATE_COLUMN_CANDIDATES = [
  "created_at",
  "updated_at",
  "closing_date",
  "expense_date",
  "purchase_date",
  "work_date",
  "shift_date",
  "log_date",
  "invoice_date",
  "payment_date",
  "returned_at",
  "sent_at",
  "requested_at",
  "approved_at",
  "reported_at",
  "incident_datetime",
  "movement_datetime",
  "transaction_datetime",
  "reconciliation_datetime",
  "production_datetime",
  "log_datetime",
  "reading_datetime",
  "dispatch_datetime",
  "return_datetime",
  "changed_at",
  "issued_at",
];

const DIMENSION_TABLES = new Set([
  "branches",
  "schema_migrations",
  "users",
  "user_permission_overrides",
  "user_branch_access",
  "business_units",
  "business_locations",
  "user_business_access",
  "user_category_assignment_conflicts",
  "worker_category_assignment_conflicts",
  "settings",
  "group_configuration",
  "document_sequences",
  "mining_sites",
  "fleet_assets",
  "hire_customers",
  "worker_profiles",
  "owner_break_glass_accounts",
  "owner_break_glass_recovery_codes",
]);

const COMMON_DEPENDENCIES = [
  "branches",
  "schema_migrations",
  "users",
  "user_branch_access",
  "business_units",
  "business_locations",
  "user_business_access",
  "settings",
  "group_configuration",
  "group_configuration_history",
  "document_sequences",
  "document_sequence_history",
  "notification_rules",
  "notifications",
  "notification_user_states",
  "notification_escalations",
  "notification_sync_runs",
  "shared_control_evidence",
  "installment_settings",
  "installment_sequences",
  "installment_agreements",
  "installment_agreement_items",
  "installment_schedule",
  "installment_payments",
  "installment_payment_allocations",
  "installment_reschedules",
  "installment_reminder_log",
];

const PAYROLL_WORKFORCE_TABLES = Object.freeze([
  "payroll_statutory_rule_versions",
  "payroll_compensation_profiles",
  "payroll_recurring_components",
  "payroll_periods",
  "payroll_entries",
  "payroll_entry_lines",
  "payroll_salary_payments",
  "payroll_adjustment_requests",
  "payroll_worker_loans",
  "payroll_loan_transactions",
  "payroll_payslips",
]);

const SCOPE_TABLES = Object.freeze({
  spare_parts: [
    ...COMMON_DEPENDENCIES,
    ...PAYROLL_WORKFORCE_TABLES,
    "products",
    "stock_adjustments",
    "suppliers",
    "purchases",
    "purchase_items",
    "purchase_payments",
    "customers",
    "sales",
    "sale_items",
    "sale_payment_allocations",
    "sale_change_history",
    "debts",
    "debt_payments",
    "returns",
    "expenses",
    "daily_closings",
    "daily_closing_revisions",
    "audit_signoffs",
    "audit_unlock_requests",
    "audit_reapproval_log",
    "stock_transfers",
    "stock_transfer_items",
    "sms_log",
    "activity_log",
  ],

  mining: [
    ...COMMON_DEPENDENCIES,
    ...PAYROLL_WORKFORCE_TABLES,
    "mining_sites",
    "user_mining_site_access",
    "mining_daily_logs",
    "mining_production_records",
    "mining_equipment_logs",
    "mining_fuel_logs",
    "mining_expenses",
    "mining_incidents",
    "mining_stockpiles",
    "mining_dispatches",
    "mining_stockpile_movements",
    "mining_fuel_tanks",
    "mining_fuel_transactions",
    "mining_fuel_reconciliations",
    "mining_contractors",
    "mining_shift_crews",
    "mining_shift_crew_members",
    "mining_site_closings",
    "fleet_assets",
    "fleet_meter_readings",
    "fleet_fuel_logs",
    "fleet_maintenance_records",
    "fleet_inspections",
    "worker_profiles",
  "owner_break_glass_accounts",
  "owner_break_glass_recovery_codes",
    "worker_assignments",
    "worker_documents",
    "worker_licenses",
    "worker_property_assignments",
    "worker_status_history",
    "worker_family_members",
    "worker_emergency_contacts",
    "worker_private_files",
    "worker_profile_change_history",
    "worker_print_history",
    "worker_hr_letters",
    "activity_log",
  ],

  equipment_hire: [
    ...COMMON_DEPENDENCIES,
    ...PAYROLL_WORKFORCE_TABLES,
    "user_hire_location_access",
    "hire_customers",
    "hire_enquiries",
    "hire_quotations",
    "hire_contracts",
    "hire_contract_assets",
    "hire_dispatches",
    "hire_work_logs",
    "hire_invoices",
    "hire_invoice_lines",
    "hire_payments",
    "hire_return_inspections",
    "hire_rate_cards",
    "hire_quotation_items",
    "hire_contract_items",
    "hire_contract_amendments",
    "hire_deposit_transactions",
    "hire_commercial_approvals",
    "hire_evidence_files",
    "hire_damage_assessments",
    "fleet_assets",
    "fleet_meter_readings",
    "fleet_fuel_logs",
    "fleet_maintenance_records",
    "fleet_inspections",
    "worker_profiles",
  "owner_break_glass_accounts",
  "owner_break_glass_recovery_codes",
    "worker_assignments",
    "worker_documents",
    "worker_licenses",
    "worker_property_assignments",
    "worker_status_history",
    "worker_family_members",
    "worker_emergency_contacts",
    "worker_private_files",
    "worker_profile_change_history",
    "worker_print_history",
    "worker_hr_letters",
    "activity_log",
  ],

  shared_fleet: [
    ...COMMON_DEPENDENCIES,
    "fleet_assets",
    "fleet_meter_readings",
    "fleet_fuel_logs",
    "fleet_maintenance_records",
    "fleet_inspections",
    "mining_equipment_logs",
    "hire_contract_assets",
    "hire_dispatches",
    "hire_work_logs",
    "hire_return_inspections",
    "worker_profiles",
  "owner_break_glass_accounts",
  "owner_break_glass_recovery_codes",
    "worker_assignments",
    "worker_licenses",
    "worker_family_members",
    "worker_emergency_contacts",
    "worker_private_files",
    "worker_profile_change_history",
    "worker_print_history",
    "worker_hr_letters",
    "activity_log",
  ],
});

const CATEGORY_TABLES = Object.freeze({
  operations: new Set([
    "products",
    "stock_adjustments",
    "stock_transfers",
    "stock_transfer_items",
    "fleet_assets",
    "fleet_meter_readings",
    "fleet_fuel_logs",
    "fleet_maintenance_records",
    "fleet_inspections",
    "mining_sites",
    "mining_daily_logs",
    "mining_production_records",
    "mining_equipment_logs",
    "mining_fuel_logs",
    "mining_incidents",
    "mining_stockpiles",
    "mining_dispatches",
    "mining_stockpile_movements",
    "mining_fuel_tanks",
    "mining_fuel_transactions",
    "mining_fuel_reconciliations",
    "mining_contractors",
    "mining_shift_crews",
    "mining_shift_crew_members",
    "mining_site_closings",
    "hire_customers",
    "hire_enquiries",
    "hire_quotations",
    "hire_contracts",
    "hire_contract_assets",
    "hire_dispatches",
    "hire_work_logs",
    "hire_return_inspections",
    "hire_rate_cards",
    "hire_quotation_items",
    "hire_contract_items",
    "hire_contract_amendments",
    "hire_commercial_approvals",
    "hire_evidence_files",
    "hire_damage_assessments",
  ]),

  financial: new Set([
    ...PAYROLL_WORKFORCE_TABLES,
    "suppliers",
    "purchases",
    "purchase_items",
    "purchase_payments",
    "customers",
    "sales",
    "sale_items",
    "sale_payment_allocations",
    "debts",
    "debt_payments",
    "returns",
    "expenses",
    "daily_closings",
    "daily_closing_revisions",
    "audit_signoffs",
    "audit_unlock_requests",
    "audit_reapproval_log",
    "mining_expenses",
    "hire_invoices",
    "hire_invoice_lines",
    "hire_payments",
    "hire_deposit_transactions",
    "hire_damage_assessments",
  ]),

  security: new Set([
    "users",
    "user_branch_access",
    "user_business_access",
    "user_mining_site_access",
    "user_hire_location_access",
    "auth_sessions",
    "password_recovery_otps",
    "protected_action_sessions",
  "security_event_dismissals",
    "owner_break_glass_accounts",
    "owner_recovery_sessions",
    "owner_break_glass_mfa_enrollments",
    "owner_break_glass_recovery_codes",
    "owner_break_glass_login_history",
    "privileged_action_ledger",
    "activity_log",
    "application_error_log",
    "sms_log",
    "backup_history",
    "notification_rules",
    "notifications",
    "notification_user_states",
    "notification_escalations",
    "notification_sync_runs",
  "shared_control_evidence",
  ]),

  workforce: new Set([
    ...PAYROLL_WORKFORCE_TABLES,
    "users",
    "user_branch_access",
    "user_business_access",
    "user_mining_site_access",
    "user_hire_location_access",
    "worker_profiles",
  "owner_break_glass_accounts",
  "owner_break_glass_recovery_codes",
    "worker_assignments",
    "worker_documents",
    "worker_licenses",
    "worker_property_assignments",
    "worker_status_history",
    "worker_family_members",
    "worker_emergency_contacts",
    "worker_private_files",
    "worker_profile_change_history",
    "worker_print_history",
    "worker_hr_letters",
  ]),
});

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanText(value, maxLength = 255) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : null;
}

function booleanValue(value) {
  return value === true || Number(value || 0) === 1;
}

function requestIp(req) {
  return cleanText(
    String(
      req.headers["x-forwarded-for"] ||
        req.ip ||
        req.socket?.remoteAddress ||
        ""
    ).split(",")[0],
    50
  );
}

function requestUserAgent(req) {
  return cleanText(
    req.headers["user-agent"],
    500
  );
}

function mysqlDateTime(value = new Date()) {
  return value
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function dateOnly(value) {
  const text = cleanText(value, 20);

  return /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : null;
}

function safeIdentifier(value) {
  const text = cleanText(value, 80);

  if (!/^[a-zA-Z0-9_]+$/.test(text)) {
    throw new Error("Unsafe database identifier.");
  }

  return text;
}

function randomToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function tokenHash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) =>
      canonicalize(item)
    );
  }

  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date)
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalize(value[key]),
        ])
    );
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function canonicalJson(value) {
  return JSON.stringify(
    canonicalize(value)
  );
}

function backupSafeValue(value) {
  if (Buffer.isBuffer(value)) {
    return {
      encoding: "base64",
      data: value.toString("base64"),
    };
  }

  if (Array.isArray(value)) {
    return value.map(backupSafeValue);
  }

  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        backupSafeValue(item),
      ])
    );
  }

  return value;
}

function backupSafeRows(rows) {
  return rows.map((row) =>
    backupSafeValue(row)
  );
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function strongPasswordError(password) {
  const text = String(password || "");

  if (text.length < 8) {
    return "Password must be at least 8 characters.";
  }

  if (
    !/[a-z]/.test(text) ||
    !/[A-Z]/.test(text)
  ) {
    return "Password must contain uppercase and lowercase letters.";
  }

  if (!/\d/.test(text)) {
    return "Password must contain a number.";
  }

  if (!/[^A-Za-z0-9]/.test(text)) {
    return "Password must contain a symbol.";
  }

  return "";
}

function isOriginalSystemAdministrator(user) {
  return (
    Number(user?.id) === SYSTEM_ADMIN_ID &&
    cleanText(
      user?.username,
      100
    ).toLowerCase() ===
      SYSTEM_ADMIN_USERNAME &&
    cleanText(
      user?.role,
      40
    ).toLowerCase() === "admin"
  );
}

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [safeIdentifier(tableName)]
  );

  return rows.length > 0;
}

async function tableColumns(tableName) {
  const safeName = safeIdentifier(
    tableName
  );

  const [rows] = await pool.query(
    `SHOW COLUMNS FROM \`${safeName}\``
  );

  return rows.map((row) =>
    row.Field
  );
}

async function appendLedger({
  req = null,
  actorUserId = null,
  targetUserId = null,
  actorType = "user",
  actionCode,
  outcome = "success",
  severity = "critical",
  entityType = null,
  entityId = null,
  payload = {},
}) {
  const connection =
    await pool.getConnection();

  let namedLockAcquired = false;

  try {
    const [lockRows] = await connection.query(
      "SELECT GET_LOCK(?, 10) AS acquired",
      ["chalin03_privileged_ledger"]
    );

    if (Number(lockRows[0]?.acquired || 0) !== 1) {
      const error = new Error(
        "Privileged ledger is busy. Please retry the protected action."
      );
      error.statusCode = 503;
      throw error;
    }

    namedLockAcquired = true;

    await connection.beginTransaction();

    const [previousRows] =
      await connection.query(
        `SELECT event_hash
         FROM privileged_action_ledger
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`
      );

    const previousHash =
      previousRows[0]?.event_hash ||
      null;

    const occurredAt =
      mysqlDateTime();

    const cleanPayload =
      canonicalize(payload);

    const hashPayload =
      canonicalJson({
        action_code: actionCode,
        actor_type: actorType,
        actor_user_id:
          actorUserId || null,
        target_user_id:
          targetUserId || null,
        outcome,
        severity,
        entity_type: entityType,
        entity_id:
          entityId === null
            ? null
            : String(entityId),
        occurred_at: occurredAt,
        payload: cleanPayload,
      });

    const eventHash = sha256(
      `${previousHash || ""}\n${hashPayload}`
    );

    await connection.query(
      `INSERT INTO privileged_action_ledger (
         actor_user_id,
         target_user_id,
         actor_type,
         action_code,
         outcome,
         severity,
         entity_type,
         entity_id,
         request_id,
         ip_address,
         user_agent,
         payload_json,
         hash_payload,
         previous_event_hash,
         event_hash,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorUserId || null,
        targetUserId || null,
        actorType,
        cleanText(
          actionCode,
          150
        ),
        cleanText(
          outcome,
          40
        ),
        cleanText(
          severity,
          40
        ),
        cleanText(
          entityType,
          80
        ) || null,
        entityId === null
          ? null
          : cleanText(
              entityId,
              100
            ),
        req?.requestId || null,
        req
          ? requestIp(req) ||
            null
          : null,
        req
          ? requestUserAgent(req) ||
            null
          : null,
        canonicalJson(cleanPayload),
        hashPayload,
        previousHash,
        eventHash,
        occurredAt,
      ]
    );

    await connection.commit();

    return eventHash;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Keep the original error.
    }

    throw error;
  } finally {
    if (namedLockAcquired) {
      try {
        await connection.query(
          "SELECT RELEASE_LOCK(?) AS released",
          ["chalin03_privileged_ledger"]
        );
      } catch (releaseError) {
        console.warn(
          "Privileged ledger lock release warning:",
          releaseError.message
        );
      }
    }

    connection.release();
  }
}

async function verifyLedgerChain() {
  const [rows] = await pool.query(
    `SELECT
       id,
       previous_event_hash,
       event_hash,
       hash_payload
     FROM privileged_action_ledger
     ORDER BY id ASC`
  );

  let expectedPrevious = null;

  for (const row of rows) {
    if (
      (row.previous_event_hash ||
        null) !==
      expectedPrevious
    ) {
      return {
        valid: false,
        checked_events:
          rows.length,
        failed_event_id:
          row.id,
        reason:
          "Previous-event hash does not match.",
      };
    }

    const expectedHash = sha256(
      `${expectedPrevious || ""}\n${
        row.hash_payload
      }`
    );

    if (
      expectedHash !==
      row.event_hash
    ) {
      return {
        valid: false,
        checked_events:
          rows.length,
        failed_event_id:
          row.id,
        reason:
          "Event hash does not match its protected payload.",
      };
    }

    expectedPrevious =
      row.event_hash;
  }

  return {
    valid: true,
    checked_events:
      rows.length,
    failed_event_id: null,
    reason:
      rows.length > 0
        ? "Privileged ledger chain is intact."
        : "Privileged ledger is empty and intact.",
    latest_event_hash:
      expectedPrevious,
  };
}

async function protectedActionRecord(
  req
) {
  const rawToken = cleanText(
    req.headers[
      "x-protected-action-token"
    ],
    200
  );

  if (!rawToken) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT
       id,
       user_id,
       purpose,
       expires_at
     FROM protected_action_sessions
     WHERE token_hash = ?
       AND user_id = ?
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [
      tokenHash(rawToken),
      req.user.id,
    ]
  );

  if (!rows.length) {
    return null;
  }

  await pool.query(
    `UPDATE protected_action_sessions
     SET last_used_at = NOW()
     WHERE id = ?`,
    [rows[0].id]
  );

  return rows[0];
}

function requireProtectedAction(
  req,
  res,
  next
) {
  protectedActionRecord(req)
    .then((record) => {
      if (!record) {
        return res
          .status(403)
          .json({
            status: "error",
            code:
              "PROTECTED_ACTION_REQUIRED",
            message:
              "Unlock protected actions with your current password before continuing.",
          });
      }

      req.protectedAction =
        record;

      return next();
    })
    .catch(next);
}

async function ownerSessionRecord(
  req
) {
  const rawToken = cleanText(
    req.headers[
      "x-owner-recovery-token"
    ],
    200
  );

  if (!rawToken) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT
       ors.id,
       ors.owner_account_id,
       ors.expires_at,
       oba.username,
       oba.phone
     FROM owner_recovery_sessions ors
     INNER JOIN owner_break_glass_accounts oba
       ON oba.id = ors.owner_account_id
     WHERE ors.token_hash = ?
       AND ors.used_at IS NULL
       AND ors.revoked_at IS NULL
       AND ors.expires_at > NOW()
       AND oba.is_active = TRUE
     LIMIT 1`,
    [tokenHash(rawToken)]
  );

  return rows[0] || null;
}

function requireOwnerSession(
  req,
  res,
  next
) {
  ownerSessionRecord(req)
    .then((record) => {
      if (!record) {
        return res
          .status(401)
          .json({
            status: "error",
            code:
              "OWNER_RECOVERY_SESSION_INVALID",
            message:
              "The Owner Break-Glass session is invalid or expired.",
          });
      }

      req.ownerRecovery =
        record;

      return next();
    })
    .catch(next);
}

async function sendBackupFailureAlert(
  req,
  reason
) {
  try {
    const branchId =
      Number(
        req.user?.branch_id ||
          req.user
            ?.default_branch_id ||
          1
      ) || 1;

    const {
      businessName,
    } =
      await buildOwnerAlertContext(
        branchId
      );

    await sendOwnerSmsAlert({
      branchId,
      message: `${businessName}: Approved backup-failure alert. A professional backup failed on ${formatSecurityDateTime()}. User: ${
        req.user?.username ||
        "unknown"
      }. Reason: ${cleanText(
        reason,
        160
      )}. Review Railway logs and do not run schema.sql.`,
      smsType:
        "security_alert",
      sentBy:
        req.user?.id || null,
      sourceReference:
        "release2-final-backup-failure",
    });
  } catch (error) {
    console.warn(
      "Backup failure SMS alert skipped:",
      error.message
    );
  }
}

function downloadFilename(
  scope,
  category
) {
  return `chalin03-${scope}-${category}-professional-backup-${new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-")}.json`;
}

async function existingTables() {
  const [rows] =
    await pool.query(
      "SHOW TABLES"
    );

  return rows
    .map(
      (row) =>
        Object.values(row)[0]
    )
    .filter(
      (tableName) =>
        /^[a-zA-Z0-9_]+$/.test(
          tableName
        ) &&
        !LEGACY_TABLES.has(
          tableName
        )
    )
    .sort();
}

async function latestSchemaVersion() {
  if (
    !(await tableExists(
      "schema_migrations"
    ))
  ) {
    return null;
  }

  const [rows] =
    await pool.query(
      `SELECT migration_name
       FROM schema_migrations
       ORDER BY id DESC
       LIMIT 1`
    );

  return (
    rows[0]
      ?.migration_name || null
  );
}

function selectedScopeTables(
  scope,
  allTables
) {
  if (scope === "full_system") {
    return [...allTables];
  }

  return [
    ...new Set([
      ...COMMON_DEPENDENCIES,
      ...(SCOPE_TABLES[
        scope
      ] || []),
    ]),
  ].filter((tableName) =>
    allTables.includes(tableName)
  );
}

function selectedCategoryTables(
  tables,
  category
) {
  if (
    !category ||
    category === "all"
  ) {
    return tables;
  }

  const categoryTables =
    CATEGORY_TABLES[category];

  if (!categoryTables) {
    return [];
  }

  return tables.filter(
    (tableName) =>
      COMMON_DEPENDENCIES.includes(
        tableName
      ) ||
      categoryTables.has(
        tableName
      )
  );
}

async function rowsForBackupTable({
  tableName,
  from,
  to,
}) {
  const safeName =
    safeIdentifier(tableName);

  const columns =
    await tableColumns(
      safeName
    );

  const orderSql =
    columns.includes("id")
      ? " ORDER BY id ASC"
      : "";

  const dateColumn =
    !DIMENSION_TABLES.has(
      safeName
    ) &&
    from &&
    to
      ? DATE_COLUMN_CANDIDATES.find(
          (candidate) =>
            columns.includes(
              candidate
            )
        )
      : null;

  if (dateColumn) {
    const [rows] =
      await pool.query(
        `SELECT *
         FROM \`${safeName}\`
         WHERE DATE(\`${safeIdentifier(
           dateColumn
         )}\`) BETWEEN ? AND ?
         ${orderSql}`,
        [from, to]
      );

    return {
      rows: backupSafeRows(rows),
      date_column:
        dateColumn,
      date_filtered: true,
    };
  }

  const [rows] =
    await pool.query(
      `SELECT *
       FROM \`${safeName}\`
       ${orderSql}`
    );

  return {
    rows: backupSafeRows(rows),
    date_column: null,
    date_filtered: false,
  };
}

async function createProfessionalPackage({
  req,
  scope,
  category,
  from,
  to,
}) {
  const allTables =
    await existingTables();

  const scopeTables =
    selectedScopeTables(
      scope,
      allTables
    );

  const tables =
    selectedCategoryTables(
      scopeTables,
      category
    );

  if (!tables.length) {
    const error = new Error(
      "No database tables matched the selected backup scope and category."
    );

    error.statusCode = 400;
    throw error;
  }

  const backupId =
    crypto.randomUUID();

  const packageData = {
    app:
      "Chalin 03 Group Operations Platform",
    package_type:
      "chalin03_professional_backup",
    manifest_version:
      MANIFEST_VERSION,
    backup_id: backupId,
    created_at:
      new Date().toISOString(),
    created_by: {
      id: req.user.id,
      username:
        req.user.username,
    },
    scope,
    category,
    date_range: {
      from: from || null,
      to: to || null,
    },
    schema_version:
      await latestSchemaVersion(),
    warning:
      "Private business recovery package. Keep it encrypted and restrict access.",
    restore_policy:
      "Release 2 Final does not provide automatic selective production restore or merge.",
    manifest: {
      included_tables: [],
      table_counts: {},
      table_checksums_sha256:
        {},
      date_filter_evidence:
        {},
      total_record_count: 0,
    },
    tables: {},
  };

  for (const tableName of tables) {
    const tableResult =
      await rowsForBackupTable({
        tableName,
        from,
        to,
      });

    packageData.tables[
      tableName
    ] = tableResult.rows;

    packageData.manifest.included_tables.push(
      tableName
    );

    packageData.manifest.table_counts[
      tableName
    ] =
      tableResult.rows.length;

    packageData.manifest.table_checksums_sha256[
      tableName
    ] = sha256(
      canonicalJson(
        tableResult.rows
      )
    );

    packageData.manifest.date_filter_evidence[
      tableName
    ] = {
      filtered:
        tableResult.date_filtered,
      column:
        tableResult.date_column,
    };

    packageData.manifest.total_record_count +=
      tableResult.rows.length;
  }

  packageData.package_checksum_sha256 =
    sha256(
      canonicalJson(
        packageData
      )
    );

  await pool.query(
    `INSERT INTO backup_history (
       backup_id,
       scope_code,
       category_code,
       date_from,
       date_to,
       manifest_version,
       schema_version,
       included_table_count,
       total_record_count,
       package_checksum_sha256,
       status,
       verification_status,
       created_by
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', 'not_verified', ?)`,
    [
      backupId,
      scope,
      category,
      from || null,
      to || null,
      MANIFEST_VERSION,
      packageData.schema_version,
      tables.length,
      packageData.manifest
        .total_record_count,
      packageData
        .package_checksum_sha256,
      req.user.id,
    ]
  );

  await appendLedger({
    req,
    actorUserId:
      req.user.id,
    actionCode:
      "PROFESSIONAL_BACKUP_CREATED",
    entityType: "backup",
    entityId: backupId,
    payload: {
      scope,
      category,
      from,
      to,
      table_count:
        tables.length,
      total_record_count:
        packageData.manifest
          .total_record_count,
      package_checksum_sha256:
        packageData
          .package_checksum_sha256,
    },
  });

  return packageData;
}

function verifyProfessionalPackage(
  packageData
) {
  const errors = [];

  if (
    packageData
      ?.package_type !==
    "chalin03_professional_backup"
  ) {
    errors.push(
      "The file is not a Chalin 03 professional backup package."
    );
  }

  if (
    !packageData?.tables ||
    typeof packageData.tables !==
      "object"
  ) {
    errors.push(
      "Backup tables are missing."
    );
  }

  const expectedTableHashes =
    packageData?.manifest
      ?.table_checksums_sha256 ||
    {};

  for (const [
    tableName,
    rows,
  ] of Object.entries(
    packageData?.tables || {}
  )) {
    if (!Array.isArray(rows)) {
      errors.push(
        `Table ${tableName} is not a row array.`
      );

      continue;
    }

    const actual = sha256(
      canonicalJson(rows)
    );

    if (
      expectedTableHashes[
        tableName
      ] !== actual
    ) {
      errors.push(
        `Checksum mismatch for table ${tableName}.`
      );
    }
  }

  const suppliedPackageHash =
    packageData
      ?.package_checksum_sha256;

  const withoutHash = {
    ...packageData,
  };

  delete withoutHash
    .package_checksum_sha256;

  const actualPackageHash =
    sha256(
      canonicalJson(
        withoutHash
      )
    );

  if (
    suppliedPackageHash !==
    actualPackageHash
  ) {
    errors.push(
      "Package checksum does not match the package contents."
    );
  }

  return {
    valid:
      errors.length === 0,
    errors,
    actual_package_checksum_sha256:
      actualPackageHash,
  };
}

async function loadWorkerDetail(
  workerId
) {
  const [profileRows] =
    await pool.query(
      `SELECT
         wp.*,
         u.username,
         u.role AS account_role,
         u.is_active AS account_is_active,
         supervisor.full_name AS supervisor_name
       FROM worker_profiles wp
       LEFT JOIN users u
         ON u.id = wp.user_id
       LEFT JOIN worker_profiles supervisor
         ON supervisor.id = wp.supervisor_worker_id
       WHERE wp.id = ?
       LIMIT 1`,
      [workerId]
    );

  if (!profileRows.length) {
    return null;
  }

  const [
    [assignments],
    [documents],
    [licenses],
    [property],
    [history],
  ] = await Promise.all([
    pool.query(
      `SELECT *
       FROM worker_assignments
       WHERE worker_id = ?
       ORDER BY is_active DESC, id DESC`,
      [workerId]
    ),
    pool.query(
      `SELECT *
       FROM worker_documents
       WHERE worker_id = ?
       ORDER BY expiry_date ASC, id DESC`,
      [workerId]
    ),
    pool.query(
      `SELECT *
       FROM worker_licenses
       WHERE worker_id = ?
       ORDER BY expiry_date ASC, id DESC`,
      [workerId]
    ),
    pool.query(
      `SELECT *
       FROM worker_property_assignments
       WHERE worker_id = ?
       ORDER BY status ASC, id DESC`,
      [workerId]
    ),
    pool.query(
      `SELECT
         wsh.*,
         u.full_name AS changed_by_name
       FROM worker_status_history wsh
       LEFT JOIN users u
         ON u.id = wsh.changed_by
       WHERE wsh.worker_id = ?
       ORDER BY wsh.id DESC`,
      [workerId]
    ),
  ]);

  return {
    profile:
      profileRows[0],
    assignments,
    documents,
    licenses,
    property,
    status_history:
      history,
  };
}

async function disableLinkedAccess(
  userId
) {
  if (!userId) {
    return;
  }

  await pool.query(
    `UPDATE users
     SET is_active = FALSE,
         token_version =
           token_version + 1
     WHERE id = ?`,
    [userId]
  );

  const accessUpdates = [
    [
      "user_branch_access",
      `UPDATE user_branch_access
       SET can_access = FALSE
       WHERE user_id = ?`,
    ],
    [
      "user_business_access",
      `UPDATE user_business_access
       SET can_access = FALSE
       WHERE user_id = ?`,
    ],
    [
      "user_mining_site_access",
      `UPDATE user_mining_site_access
       SET can_access = FALSE,
           is_default = FALSE
       WHERE user_id = ?`,
    ],
    [
      "user_hire_location_access",
      `UPDATE user_hire_location_access
       SET can_access = FALSE,
           is_default = FALSE
       WHERE user_id = ?`,
    ],
  ];

  for (const [
    tableName,
    sql,
  ] of accessUpdates) {
    if (
      await tableExists(
        tableName
      )
    ) {
      await pool.query(
        sql,
        [userId]
      );
    }
  }

  await revokeAllUserSessions(
    userId,
    "worker_deactivated"
  );
}

async function executiveSummary() {
  const [
    [workerCounts],
    [assignmentCounts],
    [expiryCounts],
    [securityCounts],
    [backupCounts],
    [mismatchCounts],
    [recentEvents],
    [recentBackups],
    [expiringItems],
  ] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) AS total_workers,
         SUM(employment_status = 'active') AS active_workers,
         SUM(employment_status IN ('inactive', 'suspended')) AS inactive_workers,
         SUM(employment_status = 'terminated') AS terminated_workers
       FROM worker_profiles`
    ),
    pool.query(
      `SELECT
         workspace_code,
         COUNT(*) AS assignment_count
       FROM worker_assignments
       WHERE is_active = TRUE
       GROUP BY workspace_code
       ORDER BY workspace_code`
    ),
    pool.query(
      `SELECT
         (SELECT COUNT(*)
          FROM worker_documents
          WHERE expiry_date IS NOT NULL
            AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
            AND status <> 'expired') AS expiring_documents,
         (SELECT COUNT(*)
          FROM worker_licenses
          WHERE expiry_date IS NOT NULL
            AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
            AND status <> 'expired') AS expiring_licenses,
         (SELECT COUNT(*)
          FROM worker_property_assignments
          WHERE status = 'issued'
            AND expected_return_date IS NOT NULL
            AND expected_return_date < CURDATE()) AS overdue_property`
    ),
    pool.query(
      `SELECT
         (SELECT COUNT(*)
          FROM auth_sessions
          WHERE revoked_at IS NULL
            AND expires_at > NOW()) AS active_sessions,
         (SELECT COUNT(*)
          FROM users
          WHERE is_login_locked = TRUE) AS locked_accounts,
         (SELECT COUNT(*)
          FROM activity_log
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND severity IN ('critical', 'warning')) AS serious_security_events,
         (SELECT COUNT(*)
          FROM privileged_action_ledger) AS privileged_events`
    ),
    pool.query(
      `SELECT
         COUNT(*) AS total_backups,
         SUM(status = 'failed') AS failed_backups,
         SUM(verification_status = 'verified') AS verified_backups,
         SUM(verification_status <> 'verified') AS unverified_backups,
         MAX(created_at) AS latest_backup_at
       FROM backup_history`
    ),
    pool.query(
      `SELECT
         SUM(
           wp.employment_status = 'active'
           AND wp.user_id IS NOT NULL
           AND COALESCE(u.is_active, 0) = 0
         ) AS active_worker_inactive_account,
         SUM(
           wp.employment_status <> 'active'
           AND wp.user_id IS NOT NULL
           AND COALESCE(u.is_active, 0) = 1
         ) AS inactive_worker_active_account,
         (
           SELECT COUNT(*)
           FROM users ux
           LEFT JOIN worker_profiles wx
             ON wx.user_id = ux.id
           WHERE ux.is_active = TRUE
             AND wx.id IS NULL
         ) AS active_accounts_without_profile
       FROM worker_profiles wp
       LEFT JOIN users u
         ON u.id = wp.user_id`
    ),
    pool.query(
      `SELECT
         al.id,
         al.action,
         al.details,
         al.severity,
         al.outcome,
         al.created_at,
         u.full_name,
         u.username
       FROM activity_log al
       LEFT JOIN users u
         ON u.id = al.user_id
       WHERE al.severity IN ('critical', 'warning')
       ORDER BY al.id DESC
       LIMIT 20`
    ),
    pool.query(
      `SELECT *
       FROM backup_history
       ORDER BY id DESC
       LIMIT 12`
    ),
    pool.query(
      `SELECT *
       FROM (
         SELECT
           'document' AS item_type,
           wd.id,
           wp.employee_number,
           wp.full_name,
           wd.title AS item_name,
           wd.expiry_date
         FROM worker_documents wd
         INNER JOIN worker_profiles wp
           ON wp.id = wd.worker_id
         WHERE wd.expiry_date IS NOT NULL
           AND wd.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)

         UNION ALL

         SELECT
           'license',
           wl.id,
           wp.employee_number,
           wp.full_name,
           wl.license_type,
           wl.expiry_date
         FROM worker_licenses wl
         INNER JOIN worker_profiles wp
           ON wp.id = wl.worker_id
         WHERE wl.expiry_date IS NOT NULL
           AND wl.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
       ) expiring
       ORDER BY expiry_date ASC
       LIMIT 30`
    ),
  ]);

  const ledger =
    await verifyLedgerChain();

  return {
    generated_at:
      new Date().toISOString(),
    workforce:
      workerCounts[0] || {},
    assignments:
      assignmentCounts,
    expiry:
      expiryCounts[0] || {},
    security:
      securityCounts[0] || {},
    backups:
      backupCounts[0] || {},
    mismatches:
      mismatchCounts[0] || {},
    privileged_ledger:
      ledger,
    recent_security_events:
      recentEvents,
    recent_backups:
      recentBackups,
    expiring_worker_items:
      expiringItems,
  };
}

router.post(
  "/security/unlock",
  requireAuth,
  requirePermission(
    "security.view"
  ),
  asyncHandler(
    async (req, res) => {
      const password =
        req.body?.password;

      if (!password) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Current password is required.",
          });
      }

      const [users] =
        await pool.query(
          `SELECT
             id,
             password_hash,
             is_active
           FROM users
           WHERE id = ?
           LIMIT 1`,
          [req.user.id]
        );

      const user = users[0];

      if (
        !user ||
        !booleanValue(
          user.is_active
        ) ||
        !(await bcrypt.compare(
          password,
          user.password_hash
        ))
      ) {
        await appendLedger({
          req,
          actorUserId:
            req.user.id,
          actionCode:
            "PROTECTED_ACTION_UNLOCK_FAILED",
          outcome: "failure",
          severity: "warning",
          payload: {
            password_recorded:
              false,
          },
        });

        return res
          .status(403)
          .json({
            status: "error",
            message:
              "Current password was not accepted.",
          });
      }

      await pool.query(
        `UPDATE protected_action_sessions
         SET revoked_at = NOW()
         WHERE user_id = ?
           AND revoked_at IS NULL`,
        [req.user.id]
      );

      const token =
        randomToken();

      await pool.query(
        `INSERT INTO protected_action_sessions (
           user_id,
           token_hash,
           purpose,
           ip_address,
           user_agent,
           created_at,
           expires_at
         )
         VALUES (?, ?, 'release2_final_privileged_actions', ?, ?, NOW(),
           DATE_ADD(NOW(), INTERVAL ${PROTECTED_WINDOW_MINUTES} MINUTE)
         )`,
        [
          req.user.id,
          tokenHash(token),
          requestIp(req) ||
            null,
          requestUserAgent(req) ||
            null,
        ]
      );

      await appendLedger({
        req,
        actorUserId:
          req.user.id,
        actionCode:
          "PROTECTED_ACTION_UNLOCKED",
        payload: {
          window_minutes:
            PROTECTED_WINDOW_MINUTES,
          password_recorded:
            false,
        },
      });

      return res.json({
        status: "success",
        message:
          `Protected actions are unlocked for ${PROTECTED_WINDOW_MINUTES} minutes.`,
        protected_action_token:
          token,
        expires_in_minutes:
          PROTECTED_WINDOW_MINUTES,
      });
    }
  )
);

router.get(
  "/security/overview",
  requireAuth,
  requirePermission(
    "security.view"
  ),
  asyncHandler(
    async (req, res) => {
      const [
        [sessionCounts],
        [lockCounts],
        [recoveryCounts],
        [smsCounts],
        [breakGlassRows],
        [recentSessions],
        [recentEvents],
        [recentLedger],
        [backupRows],
      ] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) AS total_sessions,
             SUM(revoked_at IS NULL AND expires_at > NOW()) AS active_sessions,
             SUM(revocation_reason = 'replaced_by_new_login') AS replaced_sessions,
             SUM(revoked_at IS NOT NULL) AS revoked_sessions
           FROM auth_sessions`
        ),
        pool.query(
          `SELECT
             COUNT(*) AS total_users,
             SUM(is_login_locked = TRUE) AS locked_accounts,
             SUM(failed_login_attempts > 0) AS accounts_with_failures
           FROM users`
        ),
        pool.query(
          `SELECT
             COUNT(*) AS total_otp_requests,
             SUM(consumed_at IS NOT NULL) AS completed_otp_recoveries,
             SUM(invalidation_reason = 'maximum_attempts_reached') AS exhausted_otp_codes
           FROM password_recovery_otps`
        ),
        pool.query(
          `SELECT
             COUNT(*) AS security_sms,
             SUM(status IN ('failed', 'undelivered', 'expired')) AS failed_security_sms
           FROM sms_log
           WHERE sms_type IN (
             'security_alert',
             'account_lock_alert',
             'account_lock_admin_alert',
             'password_recovery_otp',
             'password_recovery_confirmation',
             'password_recovery_admin_alert',
             'administrator_password_reset',
             'administrator_password_reset_alert'
           )`
        ),
        pool.query(
          `SELECT
             id,
             username,
             phone,
             is_active,
             failed_attempts,
             locked_until,
             last_login_at,
             rotated_at,
             created_at
           FROM owner_break_glass_accounts
           ORDER BY id DESC
           LIMIT 1`
        ),
        pool.query(
          `SELECT
             s.id,
             s.workspace_code,
             s.login_method,
             s.branch_id,
             s.ip_address,
             s.user_agent,
             s.device_type,
             s.device_label,
             s.device_model,
             s.device_platform,
             s.architecture,
             s.os_name,
             s.os_version,
             s.browser_name,
             s.browser_version,
             s.client_timezone,
             s.client_language,
             s.screen_width,
             s.screen_height,
             s.pixel_ratio,
             s.touch_points,
             s.pwa_mode,
             s.location_permission,
             s.location_source,
             s.latitude,
             s.longitude,
             s.location_accuracy_m,
             s.location_recorded_at,
             s.network_country,
             s.created_at,
             s.last_seen_at,
             s.expires_at,
             s.revoked_at,
             s.revocation_reason,
             u.full_name,
             u.username
           FROM auth_sessions s
           INNER JOIN users u
             ON u.id = s.user_id
           ORDER BY s.id DESC
           LIMIT 30`
        ),
        pool.query(
          `SELECT
             al.id,
             al.action,
             al.action_type,
             al.details,
             al.outcome,
             al.severity,
             al.ip_address,
             al.user_agent,
             al.created_at,
             u.full_name,
             u.username
           FROM activity_log al
           LEFT JOIN users u
             ON u.id = al.user_id
           LEFT JOIN security_event_dismissals sed
             ON sed.activity_log_id = al.id
            AND sed.restored_at IS NULL
           WHERE sed.id IS NULL
             AND COALESCE(al.action_type, '') NOT IN (
               'security.message.dismissed',
               'security.message.restored'
             )
             AND (
               al.action_type LIKE 'security.%'
               OR al.action REGEXP 'LOGIN|PASSWORD|LOCK|SESSION|RECOVERY|SECURITY'
             )
           ORDER BY al.id DESC
           LIMIT 40`
        ),
        pool.query(
          `SELECT
             id,
             action_code,
             actor_type,
             actor_user_id,
             target_user_id,
             outcome,
             severity,
             event_hash,
             previous_event_hash,
             created_at
           FROM privileged_action_ledger
           ORDER BY id DESC
           LIMIT 25`
        ),
        pool.query(
          `SELECT *
           FROM backup_history
           ORDER BY id DESC
           LIMIT 10`
        ),
      ]);

      const ledger =
        await verifyLedgerChain();

      const breakGlass =
        breakGlassRows[0] || null;

      const ownerSecurityReadiness =
        !breakGlass?.id
          ? {
              code: "not_configured",
              label: "Not configured",
              detail:
                "Create a separate Owner Break-Glass credential before relying on emergency recovery.",
              fully_protected: false,
            }
          : {
              code: "configured_without_mfa",
              label: "MFA pending",
              detail:
                "Owner Break-Glass exists. Release 3 MFA activation is required before protection is complete.",
              fully_protected: false,
            };

      return res.json({
        status: "success",
        generated_at:
          new Date().toISOString(),
        sessions:
          sessionCounts[0] || {},
        accounts:
          lockCounts[0] || {},
        recovery:
          recoveryCounts[0] || {},
        security_sms:
          smsCounts[0] || {},
        break_glass:
          breakGlass || {
            configured: false,
          },
        owner_security_readiness:
          ownerSecurityReadiness,
        privileged_ledger:
          ledger,
        recent_sessions:
          recentSessions.map(friendlySessionEvidence),
        recent_security_events:
          recentEvents,
        recent_privileged_actions:
          recentLedger,
        recent_backups:
          backupRows,
      });
    }
  )
);

router.post(
  "/security/events/dismiss",
  requireAuth,
  requirePermission("security.admin"),
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const eventIds = [...new Set(
      (Array.isArray(req.body?.event_ids) ? req.body.event_ids : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )].slice(0, 100);
    const reason = cleanText(req.body?.reason, 500);

    if (eventIds.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Choose at least one Security Centre message to delete.",
      });
    }

    if (!reason || reason.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Enter a clear deletion reason of at least 8 characters.",
      });
    }

    const placeholders = eventIds.map(() => "?").join(",");
    const [events] = await pool.query(
      `SELECT id, action, action_type, severity
       FROM activity_log
       WHERE id IN (${placeholders})
         AND COALESCE(action_type, '') NOT IN (
           'security.message.dismissed',
           'security.message.restored'
         )
         AND (
           action_type LIKE 'security.%'
           OR action REGEXP 'LOGIN|PASSWORD|LOCK|SESSION|RECOVERY|SECURITY'
         )`,
      eventIds
    );

    if (events.length !== eventIds.length) {
      return res.status(409).json({
        status: "error",
        message:
          "One or more selected records are not removable Security Centre messages.",
      });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      for (const event of events) {
        await connection.query(
          `INSERT INTO security_event_dismissals (
             activity_log_id,
             dismissed_by,
             dismissal_reason,
             dismissed_at,
             restored_by,
             restored_at,
             restoration_reason
           )
           VALUES (?, ?, ?, NOW(), NULL, NULL, NULL)
           ON DUPLICATE KEY UPDATE
             dismissed_by = VALUES(dismissed_by),
             dismissal_reason = VALUES(dismissal_reason),
             dismissed_at = NOW(),
             restored_by = NULL,
             restored_at = NULL,
             restoration_reason = NULL`,
          [event.id, req.user.id, reason]
        );
      }

      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Keep the original error.
      }
      throw error;
    } finally {
      connection.release();
    }

    await writeAuditEvent({
      req,
      userId: req.user.id,
      action: "SECURITY_MESSAGE_DISMISSED",
      actionType: "security.message.dismissed",
      outcome: "success",
      severity: "warning",
      entityType: "security_event_dismissal",
      entityId: eventIds.join(","),
      details: `${eventIds.length} Security Centre message(s) removed from the active view.`,
      metadata: {
        event_ids: eventIds,
        reason,
        evidence_deleted: false,
      },
    });

    await appendLedger({
      req,
      actorUserId: req.user.id,
      actionCode: "SECURITY_MESSAGE_DISMISSED",
      outcome: "success",
      severity: "warning",
      payload: {
        event_ids: eventIds,
        reason,
        evidence_deleted: false,
      },
    });

    return res.json({
      status: "success",
      message:
        `${eventIds.length} message(s) deleted from the Security Centre view. ` +
        "The protected audit evidence remains preserved.",
      dismissed_event_ids: eventIds,
    });
  })
);

router.get(
  "/security/ledger/verify",
  requireAuth,
  requirePermission(
    "security.view"
  ),
  asyncHandler(
    async (req, res) => {
      const verification =
        await verifyLedgerChain();

      return res
        .status(
          verification.valid
            ? 200
            : 409
        )
        .json({
          status:
            verification.valid
              ? "success"
              : "error",
          verification,
        });
    }
  )
);

router.post(
  "/security/break-glass/setup",
  requireAuth,
  requirePermission(
    "security.admin"
  ),
  requireProtectedAction,
  asyncHandler(
    async (req, res) => {
      const [requesters] =
        await pool.query(
          `SELECT id, username, role
           FROM users
           WHERE id = ?
           LIMIT 1`,
          [req.user.id]
        );

      if (
        !isOriginalSystemAdministrator(
          requesters[0]
        )
      ) {
        return res
          .status(403)
          .json({
            status: "error",
            message:
              "Only the original System Administrator can initialize or rotate Owner Break-Glass.",
          });
      }

      const username =
        cleanText(
          req.body?.username,
          100
        ).toLowerCase();

      const phone =
        cleanText(
          req.body?.phone,
          30
        );

      const password =
        req.body?.password;

      const confirmPassword =
        req.body
          ?.confirm_password;

      if (
        !username ||
        !phone ||
        !password
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Owner username, phone and password are required.",
          });
      }

      if (
        username ===
        SYSTEM_ADMIN_USERNAME
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Owner Break-Glass must use a separate username from the System Administrator.",
          });
      }

      if (
        password !==
        confirmPassword
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Password confirmation does not match.",
          });
      }

      const policyError =
        strongPasswordError(
          password
        );

      if (policyError) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              policyError,
          });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      await pool.query(
        `UPDATE owner_break_glass_accounts
         SET is_active = FALSE
         WHERE is_active = TRUE`
      );

      await pool.query(
        `INSERT INTO owner_break_glass_accounts (
           username,
           password_hash,
           phone,
           is_active,
           failed_attempts,
           locked_until,
           created_by,
           created_at,
           rotated_at
         )
         VALUES (?, ?, ?, TRUE, 0, NULL, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           password_hash = VALUES(password_hash),
           phone = VALUES(phone),
           is_active = TRUE,
           failed_attempts = 0,
           locked_until = NULL,
           created_by = VALUES(created_by),
           rotated_at = NOW()`,
        [
          username,
          passwordHash,
          phone,
          req.user.id,
        ]
      );

      await appendLedger({
        req,
        actorUserId:
          req.user.id,
        actionCode:
          "OWNER_BREAK_GLASS_CONFIGURED",
        entityType:
          "owner_break_glass",
        payload: {
          owner_username:
            username,
          phone_mask:
            phone.length > 6
              ? `${phone.slice(
                  0,
                  3
                )}***${phone.slice(
                  -3
                )}`
              : "***",
          password_recorded:
            false,
        },
      });

      await writeAuditEvent({
        req,
        action:
          "OWNER_BREAK_GLASS_CONFIGURED",
        actionType:
          "security.break_glass.configured",
        severity: "critical",
        outcome: "success",
        entityType:
          "owner_break_glass",
        details:
          "Owner Break-Glass was initialized or rotated. No owner password was recorded.",
      });

      return res.json({
        status: "success",
        message:
          "Owner Break-Glass was configured successfully. Store the credentials securely outside the ordinary system. Release 3 MFA activation is still required before protection is complete.",
      });
    }
  )
);

// Owner Break-Glass authentication is implemented exclusively in
// ownerSecurityRoutes.js, where password plus MFA/recovery-code evidence
// is mandatory. Do not add a second login handler to this legacy router.

router.get(
  "/owner/events",
  requireOwnerSession,
  asyncHandler(
    async (req, res) => {
      const [
        [events],
        [ledger],
      ] = await Promise.all([
        pool.query(
          `SELECT
             al.id,
             al.action,
             al.details,
             al.outcome,
             al.severity,
             al.created_at,
             u.full_name,
             u.username
           FROM activity_log al
           LEFT JOIN users u
             ON u.id = al.user_id
           WHERE al.severity IN ('critical', 'warning')
           ORDER BY al.id DESC
           LIMIT 30`
        ),
        pool.query(
          `SELECT
             id,
             action_code,
             outcome,
             severity,
             event_hash,
             created_at
           FROM privileged_action_ledger
           ORDER BY id DESC
           LIMIT 20`
        ),
      ]);

      return res.json({
        status: "success",
        serious_events:
          events,
        privileged_events:
          ledger,
        ledger_verification:
          await verifyLedgerChain(),
      });
    }
  )
);

router.post(
  "/owner/reset-system-admin",
  requireOwnerSession,
  asyncHandler(
    async (req, res) => {
      const password =
        req.body
          ?.temporary_password;

      const confirmation =
        req.body
          ?.confirm_password;

      if (
        password !== confirmation
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Temporary password confirmation does not match.",
          });
      }

      const policyError =
        strongPasswordError(
          password
        );

      if (policyError) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              policyError,
          });
      }

      const [users] =
        await pool.query(
          `SELECT
             id,
             full_name,
             username,
             phone,
             role,
             default_branch_id
           FROM users
           WHERE id = ?
             AND username = ?
           LIMIT 1`,
          [
            SYSTEM_ADMIN_ID,
            SYSTEM_ADMIN_USERNAME,
          ]
        );

      const systemAdmin =
        users[0];

      if (
        !isOriginalSystemAdministrator(
          systemAdmin
        )
      ) {
        return res
          .status(503)
          .json({
            status: "error",
            message:
              "The original System Administrator account could not be verified.",
          });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      await pool.query(
        `UPDATE users
         SET password_hash = ?,
             must_change_password = TRUE,
             password_changed_at = NULL,
             token_version = token_version + 1,
             failed_login_attempts = 0,
             locked_until = NULL,
             is_login_locked = FALSE,
             login_locked_at = NULL,
             login_lock_reason = NULL,
             last_failed_login_at = NULL,
             last_failed_login_ip = NULL,
             is_active = TRUE
         WHERE id = ?`,
        [
          passwordHash,
          systemAdmin.id,
        ]
      );

      if (
        await tableExists(
          "password_recovery_otps"
        )
      ) {
        await pool.query(
          `UPDATE password_recovery_otps
           SET invalidated_at = NOW(),
               invalidation_reason = 'owner_break_glass_reset'
           WHERE user_id = ?
             AND consumed_at IS NULL
             AND invalidated_at IS NULL`,
          [systemAdmin.id]
        );
      }

      await revokeAllUserSessions(
        systemAdmin.id,
        "owner_break_glass_reset"
      );

      await pool.query(
        `UPDATE owner_recovery_sessions
         SET used_at = NOW()
         WHERE id = ?`,
        [
          req.ownerRecovery.id,
        ]
      );

      await appendLedger({
        req,
        actorType: "owner",
        targetUserId:
          systemAdmin.id,
        actionCode:
          "OWNER_RESET_SYSTEM_ADMIN",
        entityType: "user",
        entityId:
          systemAdmin.id,
        payload: {
          target_username:
            systemAdmin.username,
          temporary_password_recorded:
            false,
          sessions_revoked:
            true,
          immediate_password_change_required:
            true,
        },
      });

      await writeAuditEvent({
        req,
        userId:
          systemAdmin.id,
        branchId:
          systemAdmin.default_branch_id ||
          null,
        action:
          "OWNER_BREAK_GLASS_SYSTEM_ADMIN_RESET",
        actionType:
          "security.break_glass.system_admin_reset",
        severity: "critical",
        outcome: "success",
        entityType: "user",
        entityId:
          systemAdmin.id,
        details:
          "Owner Break-Glass reset the original System Administrator. Existing sessions were revoked and immediate password change was required.",
        metadata: {
          temporary_password_recorded:
            false,
        },
      });

      try {
        const branchId =
          systemAdmin.default_branch_id ||
          1;

        const {
          businessName,
        } =
          await buildOwnerAlertContext(
            branchId
          );

        if (
          systemAdmin.phone
        ) {
          await sendSmsAlertToPhone({
            branchId,
            phone:
              systemAdmin.phone,
            message: `${businessName}: Owner Break-Glass reset the System Administrator account on ${formatSecurityDateTime()}. All previous sessions were signed out. Use the temporary password supplied securely and change it immediately. No password is included in this SMS.`,
            logMessage:
              `${businessName}: Owner Break-Glass recovery confirmation sent. No temporary password was recorded.`,
            smsType:
              "security_alert",
            sentBy: null,
            sourceReference:
              "owner-break-glass-system-admin-reset",
          });
        }

        await sendOwnerSmsAlert({
          branchId,
          message: `${businessName}: Owner Break-Glass successfully reset the original System Administrator on ${formatSecurityDateTime()}. Sessions were revoked and immediate password change is required.`,
          smsType:
            "security_alert",
          sentBy: null,
          sourceReference:
            "owner-break-glass-confirmation",
        });
      } catch (error) {
        console.warn(
          "Break-Glass confirmation SMS skipped:",
          error.message
        );
      }

      return res.json({
        status: "success",
        message:
          "The original System Administrator was reset successfully. All old sessions were revoked and the temporary password must be changed immediately.",
      });
    }
  )
);

router.get(
  "/backups/history",
  requireAuth,
  requirePermission(
    "backup.download"
  ),
  asyncHandler(
    async (req, res) => {
      const [rows] =
        await pool.query(
          `SELECT
             bh.*,
             creator.full_name AS created_by_name,
             verifier.full_name AS verified_by_name
           FROM backup_history bh
           LEFT JOIN users creator
             ON creator.id = bh.created_by
           LEFT JOIN users verifier
             ON verifier.id = bh.verified_by
           ORDER BY bh.id DESC
           LIMIT 100`
        );

      return res.json({
        status: "success",
        backups: rows,
      });
    }
  )
);

router.get(
  "/backups/download",
  requireAuth,
  requirePermission(
    "backup.download"
  ),
  requireProtectedAction,
  asyncHandler(
    async (req, res) => {
      const allowedScopes =
        new Set([
          "full_system",
          "spare_parts",
          "mining",
          "equipment_hire",
          "shared_fleet",
        ]);

      const allowedCategories =
        new Set([
          "all",
          "operations",
          "financial",
          "security",
          "workforce",
        ]);

      const scope =
        cleanText(
          req.query.scope,
          50
        ) ||
        "full_system";

      const category =
        cleanText(
          req.query.category,
          50
        ) || "all";

      const from =
        dateOnly(
          req.query.from
        );

      const to =
        dateOnly(
          req.query.to
        );

      if (
        !allowedScopes.has(
          scope
        ) ||
        !allowedCategories.has(
          category
        )
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Invalid professional backup scope or category.",
          });
      }

      if (
        (from && !to) ||
        (!from && to) ||
        (from && to && from > to)
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Choose a valid complete backup date range.",
          });
      }

      try {
        const packageData =
          await createProfessionalPackage({
            req,
            scope,
            category,
            from,
            to,
          });

        res.setHeader(
          "Content-Type",
          "application/json"
        );

        res.setHeader(
          "Cache-Control",
          "no-store"
        );

        res.setHeader(
          "X-Content-Type-Options",
          "nosniff"
        );

        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${downloadFilename(
            scope,
            category
          )}"`
        );

        return res.json(
          packageData
        );
      } catch (error) {
        await pool.query(
          `INSERT INTO backup_history (
             backup_id,
             scope_code,
             category_code,
             date_from,
             date_to,
             manifest_version,
             status,
             verification_status,
             verification_message,
             created_by
           )
           VALUES (?, ?, ?, ?, ?, ?, 'failed', 'not_verified', ?, ?)`,
          [
            crypto.randomUUID(),
            scope,
            category,
            from || null,
            to || null,
            MANIFEST_VERSION,
            cleanText(
              error.message,
              1000
            ),
            req.user.id,
          ]
        );

        await sendBackupFailureAlert(
          req,
          error.message
        );

        throw error;
      }
    }
  )
);

router.post(
  "/backups/verify",
  requireAuth,
  requirePermission(
    "backup.validate"
  ),
  asyncHandler(
    async (req, res) => {
      const packageData =
        req.body?.backup ||
        req.body;

      const verification =
        verifyProfessionalPackage(
          packageData
        );

      const backupId =
        cleanText(
          packageData?.backup_id,
          36
        );

      if (backupId) {
        await pool.query(
          `UPDATE backup_history
           SET verification_status = ?,
               verification_message = ?,
               verified_by = ?,
               verified_at = NOW()
           WHERE backup_id = ?`,
          [
            verification.valid
              ? "verified"
              : "failed",
            verification.valid
              ? "All package and table checksums matched."
              : verification.errors.join(
                  " "
                ),
            req.user.id,
            backupId,
          ]
        );
      }

      await appendLedger({
        req,
        actorUserId:
          req.user.id,
        actionCode:
          "PROFESSIONAL_BACKUP_VERIFIED",
        outcome:
          verification.valid
            ? "success"
            : "failure",
        severity:
          verification.valid
            ? "notice"
            : "critical",
        entityType: "backup",
        entityId:
          backupId || null,
        payload: {
          valid:
            verification.valid,
          errors:
            verification.errors,
        },
      });

      return res
        .status(
          verification.valid
            ? 200
            : 400
        )
        .json({
          status:
            verification.valid
              ? "success"
              : "error",
          verification,
        });
    }
  )
);

router.get(
  "/workers",
  requireAuth,
  requirePermission(
    "workers.view"
  ),
  asyncHandler(
    async (req, res) => {
      const search =
        cleanText(
          req.query.search,
          120
        );

      const status =
        cleanText(
          req.query.status,
          40
        );

      const workspace =
        normalizeCategory(req.user?.workspace_code) || "spare_parts";

      const where = [
        "wp.workspace_code = ?",
      ];

      const params = [workspace];

      if (search) {
        where.push(
          `(wp.employee_number LIKE ?
            OR wp.full_name LIKE ?
            OR wp.phone LIKE ?
            OR wp.job_title LIKE ?)`
        );

        const term =
          `%${search}%`;

        params.push(
          term,
          term,
          term,
          term
        );
      }

      if (status) {
        where.push(
          "wp.employment_status = ?"
        );

        params.push(
          status
        );
      }


      const [rows] =
        await pool.query(
          `SELECT
             wp.*,
             u.username,
             u.role AS account_role,
             u.is_active AS account_is_active,
             supervisor.full_name AS supervisor_name,
             (
               SELECT COUNT(*)
               FROM worker_assignments wa
               WHERE wa.worker_id = wp.id
                 AND wa.workspace_code = wp.workspace_code
                 AND wa.is_active = TRUE
             ) AS active_assignment_count,
             (
               SELECT COUNT(*)
               FROM worker_documents wd
               WHERE wd.worker_id = wp.id
                 AND wd.expiry_date IS NOT NULL
                 AND wd.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
             ) AS expiring_document_count,
             (
               SELECT COUNT(*)
               FROM worker_licenses wl
               WHERE wl.worker_id = wp.id
                 AND wl.expiry_date IS NOT NULL
                 AND wl.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
             ) AS expiring_license_count
           FROM worker_profiles wp
           LEFT JOIN users u
             ON u.id = wp.user_id
           LEFT JOIN worker_profiles supervisor
             ON supervisor.id = wp.supervisor_worker_id
           WHERE ${where.join(
             " AND "
           )}
           ORDER BY
             FIELD(
               wp.employment_status,
               'active',
               'suspended',
               'inactive',
               'terminated'
             ),
             wp.full_name ASC`,
          params
        );

      return res.json({
        status: "success",
        workers: rows,
      });
    }
  )
);

router.get(
  "/workers/:id",
  requireAuth,
  requirePermission(
    "workers.view"
  ),
  asyncHandler(
    async (req, res) => {
      const workerId =
        positiveId(
          req.params.id
        );

      const worker =
        workerId
          ? await loadWorkerDetail(
              workerId
            )
          : null;

      if (!worker) {
        return res
          .status(404)
          .json({
            status: "error",
            message:
              "Worker profile not found.",
          });
      }

      return res.json({
        status: "success",
        worker,
      });
    }
  )
);

router.post(
  "/workers",
  requireAuth,
  requirePermission(
    "workers.manage"
  ),
  asyncHandler(
    async (req, res) => {
      const employeeNumber =
        cleanText(
          req.body
            ?.employee_number,
          80
        ).toUpperCase();

      const fullName =
        cleanText(
          req.body?.full_name,
          180
        );

      if (
        !employeeNumber ||
        !fullName
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Employee number and full name are required.",
          });
      }

      const workspaceCode =
        normalizeCategory(req.user?.workspace_code) || "spare_parts";
      const businessUnitId = await getBusinessUnitId(workspaceCode);

      const [result] =
        await pool.query(
          `INSERT INTO worker_profiles (
             employee_number,
             user_id,
             workspace_code,
             business_unit_id,
             full_name,
             phone,
             email,
             emergency_contact_name,
             emergency_contact_phone,
             job_title,
             department,
             employment_type,
             employment_start_date,
             employment_status,
             supervisor_worker_id,
             photo_storage_key,
             photo_checksum_sha256,
             notes,
             created_by,
             updated_by
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            employeeNumber,
            positiveId(
              req.body
                ?.user_id
            ),
            workspaceCode,
            businessUnitId,
            fullName,
            cleanText(
              req.body?.phone,
              30
            ) || null,
            cleanText(
              req.body?.email,
              180
            ) || null,
            cleanText(
              req.body
                ?.emergency_contact_name,
              180
            ) || null,
            cleanText(
              req.body
                ?.emergency_contact_phone,
              30
            ) || null,
            cleanText(
              req.body
                ?.job_title,
              150
            ) || null,
            cleanText(
              req.body
                ?.department,
              150
            ) || null,
            cleanText(
              req.body
                ?.employment_type,
              60
            ) || "permanent",
            dateOnly(
              req.body
                ?.employment_start_date
            ),
            cleanText(
              req.body
                ?.employment_status,
              40
            ) || "active",
            positiveId(
              req.body
                ?.supervisor_worker_id
            ),
            cleanText(
              req.body
                ?.photo_storage_key,
              500
            ) || null,
            /^[a-f0-9]{64}$/i.test(
              String(
                req.body
                  ?.photo_checksum_sha256 ||
                  ""
              )
            )
              ? String(
                  req.body
                    .photo_checksum_sha256
                ).toLowerCase()
              : null,
            cleanText(
              req.body?.notes,
              2000
            ) || null,
            req.user.id,
            req.user.id,
          ]
        );

      await writeAuditEvent({
        req,
        action:
          "WORKER_PROFILE_CREATED",
        actionType:
          "workforce.profile.created",
        entityType: "worker",
        entityId:
          result.insertId,
        severity: "notice",
        details:
          `Worker profile ${employeeNumber} was created.`,
      });

      return res
        .status(201)
        .json({
          status: "success",
          message:
            "Worker profile created successfully.",
          worker:
            await loadWorkerDetail(
              result.insertId
            ),
        });
    }
  )
);

router.put(
  "/workers/:id",
  requireAuth,
  requirePermission(
    "workers.manage"
  ),
  asyncHandler(
    async (req, res) => {
      const workerId =
        positiveId(
          req.params.id
        );

      if (!workerId) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Invalid worker ID.",
          });
      }

      const fullName =
        cleanText(
          req.body?.full_name,
          180
        );

      if (!fullName) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Full name is required.",
          });
      }

      await pool.query(
        `UPDATE worker_profiles
         SET user_id = ?,
             full_name = ?,
             phone = ?,
             email = ?,
             emergency_contact_name = ?,
             emergency_contact_phone = ?,
             job_title = ?,
             department = ?,
             employment_type = ?,
             employment_start_date = ?,
             employment_end_date = ?,
             supervisor_worker_id = ?,
             photo_storage_key = ?,
             photo_checksum_sha256 = ?,
             notes = ?,
             updated_by = ?
         WHERE id = ?`,
        [
          positiveId(
            req.body
              ?.user_id
          ),
          fullName,
          cleanText(
            req.body?.phone,
            30
          ) || null,
          cleanText(
            req.body?.email,
            180
          ) || null,
          cleanText(
            req.body
              ?.emergency_contact_name,
            180
          ) || null,
          cleanText(
            req.body
              ?.emergency_contact_phone,
            30
          ) || null,
          cleanText(
            req.body
              ?.job_title,
            150
          ) || null,
          cleanText(
            req.body
              ?.department,
            150
          ) || null,
          cleanText(
            req.body
              ?.employment_type,
            60
          ) || "permanent",
          dateOnly(
            req.body
              ?.employment_start_date
          ),
          dateOnly(
            req.body
              ?.employment_end_date
          ),
          positiveId(
            req.body
              ?.supervisor_worker_id
          ),
          cleanText(
            req.body
              ?.photo_storage_key,
            500
          ) || null,
          /^[a-f0-9]{64}$/i.test(
            String(
              req.body
                ?.photo_checksum_sha256 ||
                ""
            )
          )
            ? String(
                req.body
                  .photo_checksum_sha256
              ).toLowerCase()
            : null,
          cleanText(
            req.body?.notes,
            2000
          ) || null,
          req.user.id,
          workerId,
        ]
      );

      return res.json({
        status: "success",
        message:
          "Worker profile updated successfully.",
        worker:
          await loadWorkerDetail(
            workerId
          ),
      });
    }
  )
);

router.post(
  "/workers/:id/status",
  requireAuth,
  requirePermission(
    "workers.deactivate"
  ),
  requireProtectedAction,
  asyncHandler(
    async (req, res) => {
      const workerId =
        positiveId(
          req.params.id
        );

      const newStatus =
        cleanText(
          req.body?.status,
          40
        ).toLowerCase();

      const reason =
        cleanText(
          req.body?.reason,
          2000
        );

      const allowedStatuses =
        new Set([
          "active",
          "inactive",
          "suspended",
          "terminated",
        ]);

      if (
        !workerId ||
        !allowedStatuses.has(
          newStatus
        ) ||
        !reason
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Valid worker status and a reason are required.",
          });
      }

      const [rows] =
        await pool.query(
          `SELECT
             id,
             user_id,
             full_name,
             employee_number,
             employment_status
           FROM worker_profiles
           WHERE id = ?
           LIMIT 1`,
          [workerId]
        );

      const worker =
        rows[0];

      if (!worker) {
        return res
          .status(404)
          .json({
            status: "error",
            message:
              "Worker profile not found.",
          });
      }

      await pool.query(
        `UPDATE worker_profiles
         SET employment_status = ?,
             employment_end_date =
               CASE
                 WHEN ? IN ('inactive', 'terminated')
                 THEN COALESCE(employment_end_date, CURDATE())
                 ELSE employment_end_date
               END,
             updated_by = ?
         WHERE id = ?`,
        [
          newStatus,
          newStatus,
          req.user.id,
          workerId,
        ]
      );

      await pool.query(
        `INSERT INTO worker_status_history (
           worker_id,
           previous_status,
           new_status,
           reason,
           changed_by
         )
         VALUES (?, ?, ?, ?, ?)`,
        [
          workerId,
          worker.employment_status,
          newStatus,
          reason,
          req.user.id,
        ]
      );

      if (
        newStatus !== "active"
      ) {
        await pool.query(
          `UPDATE worker_assignments
           SET is_active = FALSE,
               assignment_end = COALESCE(assignment_end, CURDATE())
           WHERE worker_id = ?
             AND is_active = TRUE`,
          [workerId]
        );

        await disableLinkedAccess(
          worker.user_id
        );
      }

      await appendLedger({
        req,
        actorUserId:
          req.user.id,
        targetUserId:
          worker.user_id,
        actionCode:
          newStatus ===
          "active"
            ? "WORKER_REACTIVATED"
            : "WORKER_DEACTIVATED",
        entityType: "worker",
        entityId:
          workerId,
        payload: {
          employee_number:
            worker.employee_number,
          previous_status:
            worker.employment_status,
          new_status:
            newStatus,
          reason,
          linked_account_sessions_revoked:
            newStatus !==
            "active" &&
            Boolean(
              worker.user_id
            ),
          access_automatically_restored:
            false,
        },
      });

      return res.json({
        status: "success",
        message:
          newStatus ===
          "active"
            ? "Worker profile reactivated. Account and workspace access must be reviewed separately before use."
            : "Worker was deactivated and linked system access was revoked.",
        worker:
          await loadWorkerDetail(
            workerId
          ),
      });
    }
  )
);

router.post(
  "/workers/:id/assignments",
  requireAuth,
  requirePermission(
    "workers.manage"
  ),
  asyncHandler(
    async (req, res) => {
      const workerId =
        positiveId(
          req.params.id
        );

      const workspaceCode =
        normalizeCategory(req.user?.workspace_code) || "spare_parts";
      const businessUnitId = await getBusinessUnitId(workspaceCode);

      if (!workerId) {
        return res
          .status(400)
          .json({
            status: "error",
            message: "Valid worker is required.",
          });
      }

      const [result] =
        await pool.query(
          `INSERT INTO worker_assignments (
             worker_id,
             workspace_code,
             business_unit_id,
             branch_id,
             context_type,
             context_id,
             context_label,
             role_code,
             is_primary,
             is_active,
             assignment_start,
             assignment_end,
             notes,
             created_by
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?)`,
          [
            workerId,
            workspaceCode,
            businessUnitId,
            workspaceCode === "spare_parts"
              ? positiveId(req.body?.branch_id)
              : null,
            cleanText(
              req.body
                ?.context_type,
              50
            ) || null,
            positiveId(
              req.body
                ?.context_id
            ),
            cleanText(
              req.body
                ?.context_label,
              180
            ) || null,
            cleanText(
              req.body
                ?.role_code,
              80
            ) || null,
            booleanValue(
              req.body
                ?.is_primary
            )
              ? 1
              : 0,
            dateOnly(
              req.body
                ?.assignment_start
            ),
            dateOnly(
              req.body
                ?.assignment_end
            ),
            cleanText(
              req.body?.notes,
              2000
            ) || null,
            req.user.id,
          ]
        );

      return res
        .status(201)
        .json({
          status: "success",
          message:
            "Worker assignment recorded.",
          assignment_id:
            result.insertId,
          worker:
            await loadWorkerDetail(
              workerId
            ),
        });
    }
  )
);

router.post(
  "/workers/:id/documents",
  requireAuth,
  requirePermission(
    "workers.documents.manage"
  ),
  asyncHandler(
    async (req, res) => {
      const workerId =
        positiveId(
          req.params.id
        );

      const title =
        cleanText(
          req.body?.title,
          180
        );

      const storageKey =
        cleanText(
          req.body
            ?.private_storage_key,
          500
        );

      const checksum =
        cleanText(
          req.body
            ?.checksum_sha256,
          64
        ).toLowerCase();

      if (
        !workerId ||
        !title ||
        !storageKey ||
        !/^[a-f0-9]{64}$/.test(
          checksum
        )
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Document title, private storage key and SHA-256 checksum are required.",
          });
      }

      await pool.query(
        `INSERT INTO worker_documents (
           worker_id,
           document_type,
           title,
           document_number,
           private_storage_key,
           checksum_sha256,
           issued_date,
           expiry_date,
           status,
           notes,
           created_by
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workerId,
          cleanText(
            req.body
              ?.document_type,
            100
          ) || "other",
          title,
          cleanText(
            req.body
              ?.document_number,
            120
          ) || null,
          storageKey,
          checksum,
          dateOnly(
            req.body
              ?.issued_date
          ),
          dateOnly(
            req.body
              ?.expiry_date
          ),
          cleanText(
            req.body?.status,
            40
          ) || "valid",
          cleanText(
            req.body?.notes,
            2000
          ) || null,
          req.user.id,
        ]
      );

      return res
        .status(201)
        .json({
          status: "success",
          message:
            "Private worker document metadata recorded.",
          worker:
            await loadWorkerDetail(
              workerId
            ),
        });
    }
  )
);

router.post(
  "/workers/:id/licenses",
  requireAuth,
  requirePermission(
    "workers.documents.manage"
  ),
  asyncHandler(
    async (req, res) => {
      const workerId =
        positiveId(
          req.params.id
        );

      const licenseType =
        cleanText(
          req.body
            ?.license_type,
          120
        );

      if (
        !workerId ||
        !licenseType
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Worker and licence type are required.",
          });
      }

      const checksum =
        cleanText(
          req.body
            ?.checksum_sha256,
          64
        ).toLowerCase();

      if (
        checksum &&
        !/^[a-f0-9]{64}$/.test(
          checksum
        )
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Licence checksum must be a SHA-256 value.",
          });
      }

      await pool.query(
        `INSERT INTO worker_licenses (
           worker_id,
           license_type,
           license_number,
           issuing_authority,
           issued_date,
           expiry_date,
           status,
           private_storage_key,
           checksum_sha256,
           notes,
           created_by
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workerId,
          licenseType,
          cleanText(
            req.body
              ?.license_number,
            150
          ) || null,
          cleanText(
            req.body
              ?.issuing_authority,
            180
          ) || null,
          dateOnly(
            req.body
              ?.issued_date
          ),
          dateOnly(
            req.body
              ?.expiry_date
          ),
          cleanText(
            req.body?.status,
            40
          ) || "valid",
          cleanText(
            req.body
              ?.private_storage_key,
            500
          ) || null,
          checksum || null,
          cleanText(
            req.body?.notes,
            2000
          ) || null,
          req.user.id,
        ]
      );

      return res
        .status(201)
        .json({
          status: "success",
          message:
            "Worker licence recorded.",
          worker:
            await loadWorkerDetail(
              workerId
            ),
        });
    }
  )
);

router.post(
  "/workers/:id/property",
  requireAuth,
  requirePermission(
    "workers.manage"
  ),
  asyncHandler(
    async (req, res) => {
      const workerId =
        positiveId(
          req.params.id
        );

      const description =
        cleanText(
          req.body
            ?.description,
          255
        );

      if (
        !workerId ||
        !description
      ) {
        return res
          .status(400)
          .json({
            status: "error",
            message:
              "Worker and property description are required.",
          });
      }

      await pool.query(
        `INSERT INTO worker_property_assignments (
           worker_id,
           property_type,
           property_code,
           description,
           issued_at,
           expected_return_date,
           condition_issued,
           status,
           notes,
           created_by
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
        [
          workerId,
          cleanText(
            req.body
              ?.property_type,
            120
          ) || "other",
          cleanText(
            req.body
              ?.property_code,
            120
          ) || null,
          description,
          dateOnly(
            req.body
              ?.issued_at
          ),
          dateOnly(
            req.body
              ?.expected_return_date
          ),
          cleanText(
            req.body
              ?.condition_issued,
            120
          ) || null,
          cleanText(
            req.body?.notes,
            2000
          ) || null,
          req.user.id,
        ]
      );

      return res
        .status(201)
        .json({
          status: "success",
          message:
            "Company property assignment recorded.",
          worker:
            await loadWorkerDetail(
              workerId
            ),
        });
    }
  )
);

router.get(
  "/executive/summary",
  requireAuth,
  requirePermission(
    "executive.operations.view"
  ),
  asyncHandler(
    async (req, res) => {
      return res.json({
        status: "success",
        summary:
          await executiveSummary(),
      });
    }
  )
);

module.exports = router;
module.exports.requireProtectedAction = requireProtectedAction;
module.exports.appendLedger = appendLedger;
