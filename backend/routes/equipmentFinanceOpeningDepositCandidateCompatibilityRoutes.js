const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { runEquipmentFinanceOpeningDepositFoundationRepair } = require("../scripts/runEquipmentFinanceOpeningDepositFoundationRepair");
const { runEquipmentFinancePhaseFourStartup } = require("../scripts/runEquipmentFinancePhaseFourStartup");

const router = express.Router();

const REQUIRED_CONTROL_COLUMNS = Object.freeze({
  equipment_sale_agreements: [
    "credit_application_id",
    "activation_source",
    "equipment_commitment_status",
    "deposit_completed_at",
    "deposit_completed_by",
    "reservation_activated_at",
    "reservation_activated_by",
  ],
  equipment_sale_payments: [
    "credit_application_id",
    "payment_stage",
    "reservation_effect",
    "idempotency_key",
  ],
});

const REQUIRED_CONTROL_TRIGGERS = Object.freeze([
  "trg_equipment_finance_payment_gate_before_insert",
  "trg_equipment_finance_reservation_gate_before_insert",
  "trg_equipment_finance_commitment_gate_before_update",
]);

const REQUIRED_AGREEMENT_COLUMNS = Object.freeze([
  "id",
  "agreement_number",
  "sale_type",
  "agreement_status",
  "credit_application_id",
  "customer_id",
  "asset_id",
  "activation_source",
  "equipment_commitment_status",
  "deposit_required",
  "deposit_received",
]);

class CandidateCompatibilityError extends Error {
  constructor(statusCode, message, code, readiness = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.readiness = readiness;
  }
}

function cleanText(value, maximum = 200) {
  return String(value ?? "").trim().slice(0, maximum);
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function fromCents(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function columnExpression(columns, alias, column, fallback = "NULL", output = column) {
  return columns.has(column)
    ? `${alias}.\`${column}\` AS \`${output}\``
    : `${fallback} AS \`${output}\``;
}

async function tableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME AS column_name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => row.column_name));
}

async function controlFoundationStatus(connection) {
  const tableNames = Object.keys(REQUIRED_CONTROL_COLUMNS);
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders(tableNames)})`,
    tableNames
  );

  const found = new Map(tableNames.map((tableName) => [tableName, new Set()]));
  for (const row of columnRows) {
    if (!found.has(row.table_name)) found.set(row.table_name, new Set());
    found.get(row.table_name).add(row.column_name);
  }

  const missingColumns = [];
  for (const [tableName, columns] of Object.entries(REQUIRED_CONTROL_COLUMNS)) {
    for (const column of columns) {
      if (!(found.get(tableName) || new Set()).has(column)) {
        missingColumns.push(`${tableName}.${column}`);
      }
    }
  }

  const [triggerRows] = await connection.query(
    `SELECT TRIGGER_NAME AS trigger_name
       FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME IN (${placeholders(REQUIRED_CONTROL_TRIGGERS)})`,
    REQUIRED_CONTROL_TRIGGERS
  );
  const installedTriggers = new Set(triggerRows.map((row) => row.trigger_name));
  const missingTriggers = REQUIRED_CONTROL_TRIGGERS.filter(
    (triggerName) => !installedTriggers.has(triggerName)
  );

  return {
    ready: missingColumns.length === 0 && missingTriggers.length === 0,
    missing_columns: missingColumns,
    missing_triggers: missingTriggers,
  };
}

let lazyFoundationRepairPromise = null;

async function ensureDepositFoundationReady() {
  const connection = await pool.getConnection();
  try {
    const status = await controlFoundationStatus(connection);
    if (status.ready) return status;
  } finally {
    connection.release();
  }

  if (!lazyFoundationRepairPromise) {
    lazyFoundationRepairPromise = (async () => {
      await runEquipmentFinanceOpeningDepositFoundationRepair();
      await runEquipmentFinancePhaseFourStartup();
    })().finally(() => {
      lazyFoundationRepairPromise = null;
    });
  }

  await lazyFoundationRepairPromise;

  const verificationConnection = await pool.getConnection();
  try {
    const finalStatus = await controlFoundationStatus(verificationConnection);
    if (!finalStatus.ready) {
      const error = new CandidateCompatibilityError(
        503,
        "Finance deposit controls could not be verified after the approved foundation repair.",
        "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED",
        finalStatus
      );
      throw error;
    }
    return finalStatus;
  } finally {
    verificationConnection.release();
  }
}

async function activeLockMap(connection, assetIds, columns) {
  const result = new Map();
  const ready =
    assetIds.length > 0 &&
    columns.has("asset_id") &&
    columns.has("agreement_id");
  if (!ready) return { ready: false, result };

  const activeWhere = columns.has("released_at")
    ? "sale_lock.released_at IS NULL"
    : columns.has("lock_status")
      ? "sale_lock.lock_status IN ('installment_active','active','reserved','locked')"
      : "1 = 1";
  const [rows] = await connection.query(
    `SELECT sale_lock.asset_id, sale_lock.agreement_id
       FROM equipment_asset_sale_locks sale_lock
      WHERE sale_lock.asset_id IN (${placeholders(assetIds)})
        AND ${activeWhere}
      ORDER BY sale_lock.id`,
    assetIds
  );
  for (const row of rows) {
    const assetId = Number(row.asset_id);
    const current = result.get(assetId) || [];
    current.push(Number(row.agreement_id));
    result.set(assetId, current);
  }
  return { ready: true, result };
}

async function activeHireMap(connection, assetIds, columns) {
  const result = new Map();
  const ready = assetIds.length > 0 && columns.has("asset_id");
  if (!ready) return { ready: false, result };

  const statusWhere = columns.has("status")
    ? "AND hire_asset.status IN ('assigned','dispatched','active')"
    : "";
  const [rows] = await connection.query(
    `SELECT hire_asset.asset_id, COUNT(*) AS active_hire_count
       FROM hire_contract_assets hire_asset
      WHERE hire_asset.asset_id IN (${placeholders(assetIds)})
        ${statusWhere}
      GROUP BY hire_asset.asset_id`,
    assetIds
  );
  for (const row of rows) {
    result.set(Number(row.asset_id), Number(row.active_hire_count || 0));
  }
  return { ready: true, result };
}

function candidateShape(row, { lockState, hireState }) {
  const requiredCents = toCents(row.deposit_required);
  const receivedCents = toCents(row.deposit_received);
  const remainingCents = Math.max(requiredCents - receivedCents, 0);
  const reserved = row.equipment_commitment_status === "reserved";
  const blockers = [];

  if (row.application_status !== "approved") blockers.push("application_not_approved");
  if (!row.customer_linked) blockers.push("customer_link_invalid");
  if (!row.asset_linked) blockers.push("asset_link_invalid");

  if (row.asset_is_active === null || row.asset_is_active === undefined) {
    blockers.push("asset_active_status_unavailable");
  } else if (!Boolean(Number(row.asset_is_active))) {
    blockers.push("asset_inactive");
  }

  if (!row.operational_purpose) {
    blockers.push("asset_sale_authorisation_unavailable");
  } else if (!["sale_only", "sale_or_hire"].includes(row.operational_purpose)) {
    blockers.push("asset_not_sale_authorised");
  }

  if (!row.sale_status) {
    blockers.push("asset_sale_status_unavailable");
  } else if (!["available", "installment_active"].includes(row.sale_status)) {
    blockers.push("asset_not_available");
  }

  if (!hireState.ready) {
    blockers.push("hire_conflict_control_unavailable");
  } else if (Number(row.active_hire_count || 0) > 0) {
    blockers.push("asset_active_on_hire");
  }

  if (!lockState.ready) {
    blockers.push("sale_lock_control_unavailable");
  } else if (
    (row.active_lock_agreement_ids || []).some(
      (agreementId) => Number(agreementId) !== Number(row.agreement_id)
    )
  ) {
    blockers.push("asset_locked_to_another_agreement");
  }

  return {
    agreement_id: row.agreement_id,
    agreement_number: row.agreement_number || `Agreement ${row.agreement_id}`,
    agreement_status: row.agreement_status,
    equipment_commitment_status: row.equipment_commitment_status,
    application_id: row.application_id,
    application_number: row.application_number || null,
    customer_id: row.customer_id,
    customer_name: row.customer_name || "Customer",
    customer_phone: row.customer_phone || null,
    asset_id: row.asset_id,
    asset_code: row.asset_code || `Asset ${row.asset_id}`,
    asset_name: row.asset_name || "Equipment",
    main_image_url: row.main_image_url || null,
    asset_sale_status: row.sale_status || null,
    active_hire_count: Number(row.active_hire_count || 0),
    total_amount: Number(row.total_amount || 0),
    deposit_required: fromCents(requiredCents),
    deposit_received: fromCents(receivedCents),
    deposit_remaining: fromCents(remainingCents),
    financed_amount: Number(row.financed_amount || 0),
    outstanding_balance: Number(row.outstanding_balance || 0),
    payment_frequency: row.payment_frequency || null,
    installment_count: Number(row.installment_count || 0),
    first_due_date: row.first_due_date || null,
    deposit_completed_at: row.deposit_completed_at || null,
    reservation_activated_at: row.reservation_activated_at || null,
    reserved,
    equipment_origin_location_id: row.hire_location_id || null,
    equipment_origin_name: row.equipment_origin_name || null,
    optional_advisory: {
      kyc_status: row.kyc_status || null,
      affordability_status: row.affordability_status || null,
    },
    blockers: [...new Set(blockers)],
    ready_for_deposit: !reserved && blockers.length === 0,
    next_action: reserved
      ? {
          code: "await_delivery_authorization",
          label:
            "Machine reserved; continue to independent delivery authorization.",
        }
      : {
          code: receivedCents > 0 ? "complete_opening_deposit" : "record_opening_deposit",
          label:
            receivedCents > 0
              ? "Complete the required opening deposit."
              : "Record the opening deposit.",
        },
  };
}

async function listCandidates(connection) {
  const [
    agreementColumns,
    applicationColumns,
    customerColumns,
    assetColumns,
    locationColumns,
    lockColumns,
    hireColumns,
  ] = await Promise.all([
    tableColumns(connection, "equipment_sale_agreements"),
    tableColumns(connection, "equipment_credit_applications"),
    tableColumns(connection, "hire_customers"),
    tableColumns(connection, "fleet_assets"),
    tableColumns(connection, "business_locations"),
    tableColumns(connection, "equipment_asset_sale_locks"),
    tableColumns(connection, "hire_contract_assets"),
  ]);

  const missingAgreementColumns = REQUIRED_AGREEMENT_COLUMNS.filter(
    (column) => !agreementColumns.has(column)
  );
  const missingApplicationColumns = ["id", "application_status"].filter(
    (column) => !applicationColumns.has(column)
  );
  if (missingAgreementColumns.length || missingApplicationColumns.length) {
    const missing = [
      ...missingAgreementColumns.map((column) => `equipment_sale_agreements.${column}`),
      ...missingApplicationColumns.map(
        (column) => `equipment_credit_applications.${column}`
      ),
    ];
    throw new CandidateCompatibilityError(
      503,
      "Opening Deposit agreements are missing required production fields.",
      "EQUIPMENT_FINANCE_DEPOSIT_CANDIDATE_SCHEMA_REQUIRED",
      { ready: false, missing_columns: missing }
    );
  }

  const customerJoinReady = customerColumns.has("id");
  const assetJoinReady = assetColumns.has("id");
  const locationJoinReady =
    agreementColumns.has("hire_location_id") &&
    locationColumns.has("id") &&
    locationColumns.has("name");

  const select = [
    columnExpression(agreementColumns, "agreement", "id", "NULL", "agreement_id"),
    columnExpression(agreementColumns, "agreement", "agreement_number"),
    columnExpression(agreementColumns, "agreement", "agreement_status"),
    columnExpression(
      agreementColumns,
      "agreement",
      "equipment_commitment_status"
    ),
    columnExpression(
      agreementColumns,
      "agreement",
      "credit_application_id",
      "NULL",
      "application_id"
    ),
    columnExpression(agreementColumns, "agreement", "customer_id"),
    columnExpression(agreementColumns, "agreement", "asset_id"),
    columnExpression(agreementColumns, "agreement", "deposit_required", "0"),
    columnExpression(agreementColumns, "agreement", "deposit_received", "0"),
    columnExpression(agreementColumns, "agreement", "total_amount", "0"),
    columnExpression(agreementColumns, "agreement", "financed_amount", "0"),
    columnExpression(agreementColumns, "agreement", "outstanding_balance", "0"),
    columnExpression(agreementColumns, "agreement", "payment_frequency"),
    columnExpression(agreementColumns, "agreement", "installment_count", "0"),
    columnExpression(agreementColumns, "agreement", "first_due_date"),
    columnExpression(agreementColumns, "agreement", "deposit_completed_at"),
    columnExpression(agreementColumns, "agreement", "reservation_activated_at"),
    columnExpression(agreementColumns, "agreement", "hire_location_id"),
    columnExpression(applicationColumns, "application", "application_number"),
    columnExpression(applicationColumns, "application", "application_status"),
    columnExpression(applicationColumns, "application", "kyc_status"),
    columnExpression(applicationColumns, "application", "affordability_status"),
    customerJoinReady && customerColumns.has("customer_name")
      ? "customer.customer_name AS customer_name"
      : "NULL AS customer_name",
    customerJoinReady && customerColumns.has("phone")
      ? "customer.phone AS customer_phone"
      : "NULL AS customer_phone",
    customerJoinReady ? "CASE WHEN customer.id IS NULL THEN 0 ELSE 1 END AS customer_linked" : "0 AS customer_linked",
    assetJoinReady && assetColumns.has("asset_code")
      ? "asset.asset_code AS asset_code"
      : "NULL AS asset_code",
    assetJoinReady && assetColumns.has("asset_name")
      ? "asset.asset_name AS asset_name"
      : "NULL AS asset_name",
    assetJoinReady && assetColumns.has("main_image_url")
      ? "asset.main_image_url AS main_image_url"
      : "NULL AS main_image_url",
    assetJoinReady && assetColumns.has("operational_purpose")
      ? "asset.operational_purpose AS operational_purpose"
      : "NULL AS operational_purpose",
    assetJoinReady && assetColumns.has("sale_status")
      ? "asset.sale_status AS sale_status"
      : "NULL AS sale_status",
    assetJoinReady && assetColumns.has("is_active")
      ? "asset.is_active AS asset_is_active"
      : "NULL AS asset_is_active",
    assetJoinReady ? "CASE WHEN asset.id IS NULL THEN 0 ELSE 1 END AS asset_linked" : "0 AS asset_linked",
    locationJoinReady
      ? "location.name AS equipment_origin_name"
      : "NULL AS equipment_origin_name",
  ];

  const joins = [
    "INNER JOIN equipment_credit_applications application ON application.id = agreement.credit_application_id",
    customerJoinReady
      ? "LEFT JOIN hire_customers customer ON customer.id = agreement.customer_id"
      : "",
    assetJoinReady
      ? "LEFT JOIN fleet_assets asset ON asset.id = agreement.asset_id"
      : "",
    locationJoinReady
      ? "LEFT JOIN business_locations location ON location.id = agreement.hire_location_id"
      : "",
  ].filter(Boolean);

  const orderBy = agreementColumns.has("approved_at")
    ? "agreement.approved_at, agreement.id"
    : "agreement.id";
  const [rows] = await connection.query(
    `SELECT ${select.join(", ")}
       FROM equipment_sale_agreements agreement
       ${joins.join("\n")}
      WHERE agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
        AND agreement.agreement_status IN ('approved','active')
      ORDER BY
        CASE WHEN agreement.equipment_commitment_status = 'reserved' THEN 1 ELSE 0 END,
        ${orderBy}`
  );

  const assetIds = [...new Set(rows.map((row) => Number(row.asset_id)).filter(Boolean))];
  const [lockState, hireState] = await Promise.all([
    activeLockMap(connection, assetIds, lockColumns),
    activeHireMap(connection, assetIds, hireColumns),
  ]);

  return rows.map((row) => {
    const activeLockAgreementIds = lockState.result.get(Number(row.asset_id)) || [];
    return candidateShape(
      {
        ...row,
        active_hire_count: hireState.result.get(Number(row.asset_id)) || 0,
        active_lock_agreement_ids: activeLockAgreementIds,
      },
      { lockState, hireState }
    );
  });
}

router.use("/deposit-reservations", async (req, _res, next) => {
  try {
    await ensureDepositFoundationReady();
    return next();
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/deposit-reservations/candidates",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    const connection = await pool.getConnection();
    try {
      const controls = await controlFoundationStatus(connection);
      if (!controls.ready) {
        throw new CandidateCompatibilityError(
          503,
          "Finance deposit controls are incomplete.",
          "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED",
          controls
        );
      }

      const candidates = await listCandidates(connection);
      return res.json({
        status: "success",
        candidates,
        scope: "company_wide",
        hire_location_selection_required: false,
        compatibility_mode: true,
        safeguards: {
          hire_work_created: false,
          delivery_created: false,
          ownership_transferred: false,
          sms_sent: false,
        },
      });
    } catch (error) {
      if (error instanceof CandidateCompatibilityError) {
        return res.status(error.statusCode).json({
          status: "error",
          code: error.code,
          message: error.message,
          ...(error.readiness ? { readiness: error.readiness } : {}),
        });
      }
      console.error("Could not load schema-compatible Finance deposit candidates.", {
        code: cleanText(error?.code, 80),
        errno: Number(error?.errno || 0) || null,
      });
      return res.status(500).json({
        status: "error",
        code: "EQUIPMENT_FINANCE_DEPOSIT_CANDIDATE_QUERY_FAILED",
        message: "Could not load Finance deposit agreements.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
module.exports.REQUIRED_AGREEMENT_COLUMNS = REQUIRED_AGREEMENT_COLUMNS;
module.exports.REQUIRED_CONTROL_COLUMNS = REQUIRED_CONTROL_COLUMNS;
module.exports.REQUIRED_CONTROL_TRIGGERS = REQUIRED_CONTROL_TRIGGERS;
module.exports.activeHireMap = activeHireMap;
module.exports.activeLockMap = activeLockMap;
module.exports.candidateShape = candidateShape;
module.exports.columnExpression = columnExpression;
module.exports.controlFoundationStatus = controlFoundationStatus;
module.exports.ensureDepositFoundationReady = ensureDepositFoundationReady;
module.exports.listCandidates = listCandidates;
module.exports.tableColumns = tableColumns;
