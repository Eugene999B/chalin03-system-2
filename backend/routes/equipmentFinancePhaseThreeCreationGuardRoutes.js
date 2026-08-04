const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { acquireConnection } = require("./equipmentFinanceCriticalEntryRoutes");
const {
  FinanceWorkflowError,
  classifyFinanceWorkflowError,
  inspectWorkflowSchema,
} = require("./equipmentFinancePhaseThreeWorkflowRoutes");

const router = express.Router();
const CONNECTION_TIMEOUT_MS = 7000;
const QUERY_TIMEOUT_MS = 6000;

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function query(connection, sql, params = []) {
  return connection.query({ sql, timeout: QUERY_TIMEOUT_MS }, params);
}

async function invalidWorkflowEnums(connection) {
  const expectations = [
    {
      table: "equipment_credit_applications",
      column: "application_status",
      values: [
        "draft",
        "submitted",
        "under_review",
        "changes_requested",
        "approved",
        "declined",
        "withdrawn",
      ],
    },
    {
      table: "equipment_credit_applications",
      column: "kyc_status",
      values: ["not_started", "incomplete", "complete", "verified", "rejected"],
    },
    {
      table: "equipment_credit_applications",
      column: "affordability_status",
      values: ["not_assessed", "eligible", "manual_review", "ineligible"],
    },
    {
      table: "equipment_credit_applications",
      column: "risk_band",
      values: ["low", "medium", "high", "critical"],
    },
    {
      table: "equipment_credit_application_decisions",
      column: "action_type",
      values: [
        "created",
        "updated",
        "assessed",
        "submitted",
        "review_started",
        "changes_requested",
        "approved",
        "declined",
        "withdrawn",
        "kyc_verified",
      ],
    },
  ];
  const pairs = expectations.map(() => "(TABLE_NAME = ? AND COLUMN_NAME = ?)").join(" OR ");
  const params = expectations.flatMap((item) => [item.table, item.column]);
  const [rows] = await query(
    connection,
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND (${pairs})`,
    params
  );
  const typeByKey = new Map(
    rows.map((row) => [`${row.table_name}.${row.column_name}`, String(row.column_type || "").toLowerCase()])
  );
  return expectations.flatMap((item) => {
    const type = typeByKey.get(`${item.table}.${item.column}`) || "";
    const missingValues = item.values.filter((value) => !type.includes(`'${value}'`));
    return missingValues.length
      ? [{ table: item.table, column: item.column, missing_values: missingValues }]
      : [];
  });
}

function sendFailure(req, res, error, details = null) {
  const failure = classifyFinanceWorkflowError(error);
  return res.status(failure.statusCode).json({
    status: "error",
    code: failure.code,
    message: failure.message,
    request_id: req.requestId || null,
    retryable: failure.statusCode >= 500,
    ...(details ? { readiness: details } : {}),
  });
}

router.post(
  "/phase-one/start-installment",
  requirePermission("fleet.assets.manage"),
  async (req, res, next) => {
    let connection;
    try {
      const actor = positiveId(req.user?.id);
      const assetId = positiveId(req.body?.asset_id);
      const customerId = positiveId(req.body?.customer_id);
      if (!actor) {
        throw new FinanceWorkflowError(401, "A signed-in Finance user is required.", "FINANCE_USER_REQUIRED");
      }
      if (!assetId) {
        throw new FinanceWorkflowError(400, "Choose an available excavator.", "INVALID_FINANCE_MACHINE");
      }

      connection = await acquireConnection(CONNECTION_TIMEOUT_MS);
      const readiness = await inspectWorkflowSchema(connection);
      const invalidEnums = await invalidWorkflowEnums(connection);
      readiness.invalid_enums = invalidEnums;
      readiness.ready = readiness.ready && invalidEnums.length === 0;
      if (!readiness.ready) {
        if (readiness.missing_tables.length) {
          throw new FinanceWorkflowError(
            503,
            "A required Finance application table is missing from the production database.",
            "FINANCE_APPLICATION_TABLE_MISSING"
          );
        }
        if (readiness.missing_columns.length) {
          throw new FinanceWorkflowError(
            503,
            "A required Finance application column is missing from the production database.",
            "FINANCE_APPLICATION_COLUMN_MISSING"
          );
        }
        if (readiness.invalid_nullability.length) {
          throw new FinanceWorkflowError(
            503,
            "The production Finance location columns still reject company-wide records.",
            "FINANCE_LOCATION_NULLABILITY_REQUIRED"
          );
        }
        if (invalidEnums.length) {
          throw new FinanceWorkflowError(
            503,
            "The production database does not accept every required Finance workflow status.",
            "FINANCE_WORKFLOW_ENUM_REQUIRED"
          );
        }
        throw new FinanceWorkflowError(
          503,
          "The Finance creation query could not be verified before starting the transaction.",
          "FINANCE_CREATION_SCHEMA_UNVERIFIED"
        );
      }

      const [assetRows] = await query(
        connection,
        "SELECT id FROM fleet_assets WHERE id = ? AND is_active = TRUE LIMIT 1",
        [assetId]
      );
      if (!assetRows.length) {
        throw new FinanceWorkflowError(
          409,
          "The selected excavator record is missing or no longer active.",
          "FINANCE_FOREIGN_KEY_CONFLICT"
        );
      }
      if (customerId) {
        const [customerRows] = await query(
          connection,
          "SELECT id FROM hire_customers WHERE id = ? AND is_active = TRUE LIMIT 1",
          [customerId]
        );
        if (!customerRows.length) {
          throw new FinanceWorkflowError(
            409,
            "The selected Finance customer record is missing or no longer active.",
            "FINANCE_FOREIGN_KEY_CONFLICT"
          );
        }
      }
      return next();
    } catch (error) {
      let readiness = null;
      if (error instanceof FinanceWorkflowError && connection) {
        try {
          readiness = await inspectWorkflowSchema(connection);
        } catch {
          readiness = null;
        }
      }
      return sendFailure(req, res, error, readiness);
    } finally {
      connection?.release();
    }
  }
);

module.exports = router;
module.exports.invalidWorkflowEnums = invalidWorkflowEnums;
