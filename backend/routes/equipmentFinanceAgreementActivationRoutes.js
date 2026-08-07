const crypto = require("crypto");
const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  FinanceScheduleError,
  buildFinanceSchedule,
} = require("../services/equipmentFinanceScheduleService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

const router = express.Router();

const ACTIVATION_ROLES = new Set([
  "admin",
  "administrator",
  "manager",
  "system_admin",
  "system_administrator",
  "super_admin",
  "finance_manager",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const REQUIRED_COLUMNS = Object.freeze({
  equipment_sale_agreements: [
    "credit_application_id",
    "activation_source",
    "equipment_commitment_status",
    "payment_interval_days",
    "non_working_day_rule",
  ],
  equipment_credit_applications: [
    "agreement_id",
    "agreement_activated_by",
    "agreement_activated_at",
    "agreement_activation_notes",
    "proposed_interval_days",
    "proposed_non_working_day_rule",
    "proposed_periodic_amount",
  ],
});
const REQUIRED_TRIGGERS = Object.freeze([
  "trg_equipment_installment_credit_gate_before_insert",
  "trg_equipment_installment_credit_gate_before_update",
]);
const REQUIRED_MIGRATIONS = Object.freeze([
  "20260803_equipment_finance_phase3_agreement_creation",
]);

class ActivationError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_ACTIVATION_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 500) {
  return cleanText(value, maxLength) || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function wholeNumber(value, fallback = 0, maximum = 365) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= maximum
    ? number
    : undefined;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if ([true, 1, "1", "true", "yes", "on"].includes(value)) return true;
  if ([false, 0, "0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function normalizedRole(value) {
  return cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
}

function activationRolesFor(user = {}) {
  const values = [
    user.workspace_role,
    user.access_role,
    user.role,
    user.base_role,
    ...(Array.isArray(user.roles) ? user.roles : []),
  ];
  return new Set(values.map(normalizedRole).filter(Boolean));
}

function assertActivationOfficer(req) {
  if (isOriginalSystemAdministrator(req.user)) return;
  if (![...activationRolesFor(req.user)].some((role) => ACTIVATION_ROLES.has(role))) {
    throw new ActivationError(
      403,
      "Only an authorised Finance manager, accountant or administrator can activate an approved Finance agreement.",
      "EQUIPMENT_FINANCE_ACTIVATION_PERMISSION_REQUIRED"
    );
  }
}

function fallbackAgreementNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `ESA-${stamp}-${String(crypto.randomInt(0, 10000)).padStart(4, "0")}`;
}

async function agreementNumber(req) {
  try {
    return await nextDocumentNumber("EQUIPMENT_SALE_AGREEMENT", {
      userId: positiveId(req.user?.id),
    });
  } catch (_error) {
    return fallbackAgreementNumber();
  }
}

async function schemaStatus(connection = pool) {
  const tableNames = Object.keys(REQUIRED_COLUMNS);
  const placeholders = tableNames.map(() => "?").join(",");
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const found = new Map(tableNames.map((tableName) => [tableName, new Set()]));
  for (const row of columnRows) {
    if (!found.has(row.TABLE_NAME)) found.set(row.TABLE_NAME, new Set());
    found.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }
  const missingColumns = [];
  for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) {
      if (!(found.get(tableName) || new Set()).has(column)) {
        missingColumns.push(`${tableName}.${column}`);
      }
    }
  }

  const triggerPlaceholders = REQUIRED_TRIGGERS.map(() => "?").join(",");
  const [triggerRows] = await connection.query(
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${triggerPlaceholders})`,
    REQUIRED_TRIGGERS
  );
  const installedTriggers = new Set(triggerRows.map((row) => row.TRIGGER_NAME));
  const missingTriggers = REQUIRED_TRIGGERS.filter(
    (triggerName) => !installedTriggers.has(triggerName)
  );

  const migrationPlaceholders = REQUIRED_MIGRATIONS.map(() => "?").join(",");
  const [migrationRows] = await connection.query(
    `SELECT migration_name
     FROM schema_migrations
     WHERE migration_name IN (${migrationPlaceholders})`,
    REQUIRED_MIGRATIONS
  );
  const installedMigrations = new Set(
    migrationRows.map((row) => row.migration_name)
  );
  const missingMigrations = REQUIRED_MIGRATIONS.filter(
    (migrationName) => !installedMigrations.has(migrationName)
  );

  return {
    ready:
      missingColumns.length === 0 &&
      missingTriggers.length === 0 &&
      missingMigrations.length === 0,
    missing_columns: missingColumns,
    missing_triggers: missingTriggers,
    missing_migrations: missingMigrations,
  };
}

async function assertSchemaReady(connection = pool) {
  const status = await schemaStatus(connection);
  if (!status.ready) {
    const error = new ActivationError(
      503,
      "Finance agreement activation is being prepared. Apply and verify the approved Phase 3 agreement migration first.",
      "EQUIPMENT_FINANCE_ACTIVATION_FOUNDATION_REQUIRED"
    );
    error.readiness = status;
    throw error;
  }
  return status;
}

function sendError(res, error, fallbackMessage) {
  if (error instanceof ActivationError || error instanceof FinanceScheduleError) {
    return res.status(Number(error.statusCode || 400)).json({
      status: "error",
      code: error.code || "INVALID_FINANCE_SCHEDULE",
      message: error.message,
      readiness: error.readiness,
    });
  }
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_ACTIVATION_FOUNDATION_REQUIRED",
      message:
        "Finance agreement activation is being prepared. Apply and verify the approved Phase 3 agreement migration first.",
    });
  }
  if (error?.errno === 1644 || error?.sqlState === "45000") {
    return res.status(409).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_APPROVAL_GATE_REJECTED",
      message: cleanText(error.sqlMessage || error.message, 500),
    });
  }
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_AGREEMENT_ALREADY_ACTIVATED",
      message: "This approved credit application, quotation or machine already has a Finance agreement.",
    });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ status: "error", message: fallbackMessage });
}

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_rollbackError) {
      // Preserve the original error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function loadApplication(connection, applicationId) {
  const [rows] = await connection.query(
    `SELECT
       application.*,
       kyc.customer_name_snapshot,
       kyc.customer_phone_snapshot,
       kyc.customer_email_snapshot,
       kyc.customer_address_snapshot,
       kyc.id_type,
       kyc.id_number,
       kyc.identity_document_url,
       kyc.guarantor_name,
       kyc.guarantor_phone,
       kyc.guarantor_address,
       kyc.guarantor_id_type,
       kyc.guarantor_id_number,
       kyc.guarantor_document_url,
       quotation.quotation_number,
       quotation.status AS quotation_status,
       quotation.subtotal,
       quotation.discount_amount,
       quotation.tax_amount,
       quotation.total_amount,
       quotation.deposit_required AS quotation_deposit_required,
       quotation.proposed_first_due_date AS quotation_first_due_date,
       quotation.delivery_policy,
       quotation.delivery_threshold_percent,
       quotation.terms AS quotation_terms,
       item.id AS quotation_item_id,
       item.asset_code_snapshot,
       item.asset_name_snapshot,
       item.asset_type_snapshot,
       item.make_snapshot,
       item.model_snapshot,
       item.model_year_snapshot,
       item.serial_number_snapshot,
       item.main_image_url_snapshot,
       customer.customer_name,
       customer.phone AS customer_phone,
       customer.address AS customer_address,
       asset.sale_status,
       asset.operational_purpose,
       asset.is_active AS asset_is_active
     FROM equipment_credit_applications application
     LEFT JOIN equipment_credit_application_kyc kyc
       ON kyc.application_id = application.id
     INNER JOIN equipment_sales_quotations quotation
       ON quotation.id = application.quotation_id
     INNER JOIN equipment_sales_quotation_items item
       ON item.quotation_id = quotation.id
      AND item.asset_id = application.asset_id
     INNER JOIN hire_customers customer
       ON customer.id = application.customer_id
     INNER JOIN fleet_assets asset
       ON asset.id = application.asset_id
     WHERE application.id = ?
     ORDER BY item.line_number
     LIMIT 1`,
    [applicationId]
  );
  return rows[0] || null;
}

async function loadAgreement(connection, agreementId) {
  const [rows] = await connection.query(
    "SELECT * FROM equipment_sale_agreements WHERE id = ? LIMIT 1",
    [agreementId]
  );
  return rows[0] || null;
}

async function loadAgreementAndSchedule(connection, agreementId) {
  const agreement = await loadAgreement(connection, agreementId);
  if (!agreement) {
    throw new ActivationError(
      409,
      "The application points to a missing agreement. Repair the data link before continuing.",
      "EQUIPMENT_FINANCE_AGREEMENT_LINK_INVALID"
    );
  }
  const [schedule] = await connection.query(
    `SELECT sequence_number, due_date, scheduled_amount, amount_paid, schedule_status
     FROM equipment_installment_schedule
     WHERE agreement_id = ?
     ORDER BY sequence_number`,
    [agreementId]
  );
  return { agreement, schedule };
}

function approvedSchedule(application) {
  const quotedTotal = Number(
    application.quoted_total ?? application.total_amount ?? 0
  );
  const approvedDeposit = Number(application.proposed_deposit ?? 0);
  const schedule = buildFinanceSchedule({
    selling_price: quotedTotal,
    deposit: approvedDeposit,
    payment_frequency: application.proposed_frequency,
    custom_interval_days: application.proposed_interval_days,
    installment_count: application.proposed_installment_count,
    first_due_date:
      application.proposed_first_due_date || application.quotation_first_due_date,
    non_working_day_rule:
      application.proposed_non_working_day_rule || "exact",
  });

  const storedFinancedAmount = Number(application.financed_amount || 0);
  if (
    storedFinancedAmount > 0 &&
    Math.abs(storedFinancedAmount - schedule.financed_amount) >= 0.01
  ) {
    throw new ActivationError(
      409,
      "The approved financed amount does not reconcile to the approved price and deposit.",
      "EQUIPMENT_FINANCE_APPROVED_TERMS_MISMATCH"
    );
  }

  const storedPeriodicAmount = Number(
    application.proposed_periodic_amount ||
      application.proposed_installment_amount ||
      0
  );
  if (
    storedPeriodicAmount > 0 &&
    Math.abs(storedPeriodicAmount - schedule.periodic_amount) >= 0.01
  ) {
    throw new ActivationError(
      409,
      "The approved periodic payment does not reconcile to the exact installment schedule.",
      "EQUIPMENT_FINANCE_APPROVED_TERMS_MISMATCH"
    );
  }

  return schedule;
}

function activationCandidate(application) {
  let schedule = null;
  let scheduleProblem = null;
  try {
    schedule = approvedSchedule(application);
  } catch (error) {
    scheduleProblem = error.message;
  }

  return {
    id: application.id,
    application_number: application.application_number,
    application_status: application.application_status,
    kyc_status: application.kyc_status,
    affordability_status: application.affordability_status,
    risk_band: application.risk_band,
    customer_id: application.customer_id,
    customer_name:
      application.customer_name_snapshot || application.customer_name || "Customer",
    customer_phone:
      application.customer_phone_snapshot || application.customer_phone || null,
    quotation_id: application.quotation_id,
    quotation_number: application.quotation_number,
    quotation_status: application.quotation_status,
    asset_id: application.asset_id,
    asset_code: application.asset_code_snapshot,
    asset_name: application.asset_name_snapshot,
    quoted_total: Number(application.quoted_total ?? application.total_amount ?? 0),
    approved_deposit: Number(application.proposed_deposit || 0),
    financed_amount: schedule?.financed_amount ?? Number(application.financed_amount || 0),
    payment_frequency: application.proposed_frequency,
    payment_interval_days:
      schedule?.custom_interval_days ?? application.proposed_interval_days ?? null,
    non_working_day_rule:
      schedule?.non_working_day_rule ||
      application.proposed_non_working_day_rule ||
      "exact",
    installment_count: Number(application.proposed_installment_count || 0),
    proposed_first_due_date:
      schedule?.first_due_date ||
      application.proposed_first_due_date ||
      application.quotation_first_due_date,
    periodic_amount:
      schedule?.periodic_amount ||
      Number(application.proposed_periodic_amount || 0),
    final_payment_amount: schedule?.final_payment_amount || null,
    final_due_date: schedule?.final_due_date || null,
    agreement_id: application.agreement_id || null,
    agreement_activated_at: application.agreement_activated_at || null,
    equipment_origin_location_id: application.hire_location_id || null,
    activation_ready:
      application.application_status === "approved" &&
      !application.agreement_id &&
      Boolean(schedule),
    activation_blockers: scheduleProblem ? [scheduleProblem] : [],
    safeguards: {
      creates_hire_job: false,
      creates_hire_contract: false,
      records_payment: false,
      reserves_equipment: false,
      changes_fleet_status: false,
      sends_sms: false,
    },
  };
}

router.get(
  "/readiness",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      const readiness = await schemaStatus(pool);
      return res.status(readiness.ready ? 200 : 503).json({
        status: readiness.ready ? "success" : "error",
        readiness,
      });
    } catch (error) {
      return sendError(res, error, "Could not check Finance agreement activation readiness.");
    }
  }
);

router.get(
  "/candidates",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      await assertSchemaReady(pool);
      const [rows] = await pool.query(
        `SELECT
           application.*,
           kyc.customer_name_snapshot,
           kyc.customer_phone_snapshot,
           quotation.quotation_number,
           quotation.status AS quotation_status,
           quotation.total_amount,
           quotation.proposed_first_due_date AS quotation_first_due_date,
           item.asset_code_snapshot,
           item.asset_name_snapshot
         FROM equipment_credit_applications application
         LEFT JOIN equipment_credit_application_kyc kyc
           ON kyc.application_id = application.id
         INNER JOIN equipment_sales_quotations quotation
           ON quotation.id = application.quotation_id
         INNER JOIN equipment_sales_quotation_items item
           ON item.quotation_id = quotation.id
          AND item.asset_id = application.asset_id
         WHERE application.application_status = 'approved'
         ORDER BY application.reviewed_at DESC, application.id DESC`
      );
      return res.json({
        status: "success",
        candidates: rows.map(activationCandidate),
        scope: "company_wide",
        optional_advisory_fields: ["kyc_status", "affordability_status"],
      });
    } catch (error) {
      return sendError(res, error, "Could not load approved Finance applications.");
    }
  }
);

router.get(
  "/:applicationId",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      await assertSchemaReady(pool);
      const applicationId = positiveId(req.params.applicationId);
      if (!applicationId) {
        throw new ActivationError(400, "Invalid Finance credit application ID.");
      }
      const application = await loadApplication(pool, applicationId);
      if (!application) {
        throw new ActivationError(404, "Finance credit application was not found.");
      }
      const existing = application.agreement_id
        ? await loadAgreementAndSchedule(pool, application.agreement_id)
        : { agreement: null, schedule: [] };
      return res.json({
        status: "success",
        candidate: activationCandidate(application),
        ...existing,
        next_action: existing.agreement
          ? {
              code: "collect_deposit",
              label: "Record the required deposit to reserve the exact machine.",
            }
          : {
              code: "activate_agreement",
              label: "Confirm the approved terms and create the agreement.",
            },
      });
    } catch (error) {
      return sendError(res, error, "Could not load Finance activation details.");
    }
  }
);

router.post(
  "/:applicationId",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      assertActivationOfficer(req);
      await assertSchemaReady(pool);
      const applicationId = positiveId(req.params.applicationId);
      const graceDays = wholeNumber(req.body.grace_days, 0, 90);
      const termsAccepted = boolValue(req.body.terms_accepted, false);
      const activationNotes = nullableText(req.body.activation_notes, 2000);
      if (!applicationId || graceDays === undefined || termsAccepted !== true) {
        throw new ActivationError(
          400,
          "Confirm the approved Finance agreement terms and valid grace days before activation."
        );
      }

      const activated = await withTransaction(async (connection) => {
        const [lockedApplications] = await connection.query(
          "SELECT id, agreement_id FROM equipment_credit_applications WHERE id = ? LIMIT 1 FOR UPDATE",
          [applicationId]
        );
        if (!lockedApplications.length) {
          throw new ActivationError(404, "Finance credit application was not found.");
        }

        const application = await loadApplication(connection, applicationId);
        if (!application) {
          throw new ActivationError(
            409,
            "The Finance application has an invalid customer, quotation or machine link.",
            "EQUIPMENT_FINANCE_APPLICATION_LINK_INVALID"
          );
        }

        if (application.agreement_id) {
          const existing = await loadAgreementAndSchedule(
            connection,
            application.agreement_id
          );
          if (
            Number(existing.agreement.credit_application_id) !== Number(application.id)
          ) {
            throw new ActivationError(
              409,
              "The application and agreement links do not match. Repair the data link before continuing.",
              "EQUIPMENT_FINANCE_AGREEMENT_LINK_INVALID"
            );
          }
          return { ...existing, already_activated: true };
        }

        const [sameApplicationAgreements] = await connection.query(
          `SELECT id
           FROM equipment_sale_agreements
           WHERE credit_application_id = ?
           LIMIT 1
           FOR UPDATE`,
          [application.id]
        );
        if (sameApplicationAgreements.length) {
          const existing = await loadAgreementAndSchedule(
            connection,
            sameApplicationAgreements[0].id
          );
          await connection.query(
            `UPDATE equipment_credit_applications
             SET agreement_id = ?,
                 agreement_activated_by = COALESCE(agreement_activated_by, ?),
                 agreement_activated_at = COALESCE(agreement_activated_at, NOW()),
                 updated_by = ?
             WHERE id = ? AND agreement_id IS NULL`,
            [
              existing.agreement.id,
              positiveId(req.user?.id),
              positiveId(req.user?.id),
              application.id,
            ]
          );
          return { ...existing, already_activated: true };
        }

        if (application.application_status !== "approved") {
          throw new ActivationError(
            409,
            "Only an approved Finance credit application can become an agreement.",
            "EQUIPMENT_FINANCE_APPLICATION_APPROVAL_REQUIRED"
          );
        }
        if (!["approved", "accepted"].includes(application.quotation_status)) {
          throw new ActivationError(
            409,
            "The linked installment quotation is no longer approved or accepted."
          );
        }

        const scheduleDefinition = approvedSchedule(application);
        const schedule = scheduleDefinition.schedule;
        const quotedTotal = scheduleDefinition.selling_price;
        const approvedDeposit = scheduleDefinition.deposit;
        const financedAmount = scheduleDefinition.financed_amount;

        const [assetRows] = await connection.query(
          `SELECT id, is_active, operational_purpose, sale_status
           FROM fleet_assets
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
          [application.asset_id]
        );
        const asset = assetRows[0];
        if (!asset || !Boolean(Number(asset.is_active))) {
          throw new ActivationError(409, "The linked equipment record is inactive.");
        }
        if (!["sale_only", "sale_or_hire"].includes(asset.operational_purpose)) {
          throw new ActivationError(409, "The linked equipment is not authorised for sale.");
        }
        if (asset.sale_status !== "available") {
          throw new ActivationError(
            409,
            "The linked equipment is no longer available for a new Finance agreement."
          );
        }

        const [conflicts] = await connection.query(
          `SELECT id, agreement_number, credit_application_id, quotation_id, asset_id
           FROM equipment_sale_agreements
           WHERE sale_type = 'installment'
             AND (
               quotation_id = ?
               OR (
                 asset_id = ?
                 AND agreement_status NOT IN ('completed','cancelled','defaulted')
               )
             )
           ORDER BY id
           FOR UPDATE`,
          [application.quotation_id, application.asset_id]
        );
        if (conflicts.length) {
          throw new ActivationError(
            409,
            `Finance agreement ${conflicts[0].agreement_number} already uses this quotation or machine.`,
            "EQUIPMENT_FINANCE_AGREEMENT_ALREADY_EXISTS"
          );
        }

        const number = await agreementNumber(req);
        const agreementFields = {
          agreement_number: number,
          credit_application_id: application.id,
          activation_source: "approved_credit_application",
          equipment_commitment_status: "not_reserved",
          hire_location_id: null,
          quotation_id: application.quotation_id,
          quotation_item_id: application.quotation_item_id,
          enquiry_id: application.enquiry_id || null,
          customer_id: application.customer_id,
          asset_id: application.asset_id,
          sale_type: "installment",
          agreement_status: "approved",
          approval_status: "approved",
          customer_name_snapshot: cleanText(
            application.customer_name_snapshot || application.customer_name,
            150
          ),
          customer_phone_snapshot: cleanText(
            application.customer_phone_snapshot || application.customer_phone,
            30
          ),
          customer_location_snapshot: nullableText(
            application.customer_address_snapshot || application.customer_address,
            180
          ),
          customer_id_type: nullableText(application.id_type, 60),
          customer_id_number: nullableText(application.id_number, 120),
          customer_id_document_url: nullableText(
            application.identity_document_url,
            10000
          ),
          asset_code_snapshot: cleanText(application.asset_code_snapshot, 50),
          asset_name_snapshot: cleanText(application.asset_name_snapshot, 150),
          asset_type_snapshot: cleanText(application.asset_type_snapshot, 100),
          make_snapshot: nullableText(application.make_snapshot, 100),
          model_snapshot: nullableText(application.model_snapshot, 100),
          model_year_snapshot: application.model_year_snapshot || null,
          serial_number_snapshot: nullableText(application.serial_number_snapshot, 120),
          main_image_url_snapshot: nullableText(
            application.main_image_url_snapshot,
            10000
          ),
          sale_price: Number(application.subtotal || quotedTotal),
          discount_amount: Number(application.discount_amount || 0),
          tax_amount: Number(application.tax_amount || 0),
          total_amount: quotedTotal,
          deposit_required: approvedDeposit,
          deposit_received: 0,
          financed_amount: financedAmount,
          scheduled_total: financedAmount,
          amount_paid: 0,
          outstanding_balance: quotedTotal,
          payment_frequency: scheduleDefinition.payment_frequency,
          payment_interval_days: scheduleDefinition.custom_interval_days,
          non_working_day_rule: scheduleDefinition.non_working_day_rule,
          installment_count: scheduleDefinition.installment_count,
          first_due_date: scheduleDefinition.first_due_date,
          next_due_date: schedule[0]?.due_date || null,
          final_due_date: scheduleDefinition.final_due_date,
          grace_days: graceDays,
          delivery_policy: application.delivery_policy,
          delivery_threshold_percent: application.delivery_threshold_percent,
          guarantor_name: nullableText(application.guarantor_name, 150),
          guarantor_phone: nullableText(application.guarantor_phone, 30),
          guarantor_location: nullableText(application.guarantor_address, 180),
          guarantor_id_type: nullableText(application.guarantor_id_type, 60),
          guarantor_id_number: nullableText(application.guarantor_id_number, 120),
          guarantor_document_url: nullableText(
            application.guarantor_document_url,
            10000
          ),
          terms_accepted: true,
          agreement_notes:
            activationNotes || nullableText(application.quotation_terms, 5000),
          created_by: positiveId(req.user?.id),
          approved_by: application.reviewed_by,
          approved_at: application.reviewed_at,
        };
        if (
          !agreementFields.customer_name_snapshot ||
          !agreementFields.customer_phone_snapshot ||
          !agreementFields.asset_code_snapshot ||
          !agreementFields.asset_name_snapshot ||
          !agreementFields.asset_type_snapshot
        ) {
          throw new ActivationError(
            409,
            "Customer contact and machine snapshot details are required before agreement creation.",
            "EQUIPMENT_FINANCE_AGREEMENT_SNAPSHOT_INCOMPLETE"
          );
        }

        const columns = Object.keys(agreementFields);
        const values = Object.values(agreementFields);
        const [insert] = await connection.query(
          `INSERT INTO equipment_sale_agreements (${columns.join(", ")})
           VALUES (${columns.map(() => "?").join(", ")})`,
          values
        );

        const scheduleValues = [];
        for (const row of schedule) {
          scheduleValues.push(
            insert.insertId,
            row.sequence_number,
            row.due_date,
            row.scheduled_amount
          );
        }
        await connection.query(
          `INSERT INTO equipment_installment_schedule (
             agreement_id, sequence_number, due_date, scheduled_amount,
             amount_paid, schedule_status
           ) VALUES ${schedule
             .map(() => "(?, ?, ?, ?, 0, 'upcoming')")
             .join(", ")}`,
          scheduleValues
        );

        await connection.query(
          `UPDATE equipment_credit_applications
           SET agreement_id = ?, agreement_activated_by = ?,
               agreement_activated_at = NOW(), agreement_activation_notes = ?,
               updated_by = ?
           WHERE id = ? AND agreement_id IS NULL`,
          [
            insert.insertId,
            positiveId(req.user?.id),
            activationNotes,
            positiveId(req.user?.id),
            application.id,
          ]
        );
        await connection.query(
          `UPDATE equipment_sales_quotations
           SET status = 'converted'
           WHERE id = ? AND status IN ('approved','accepted')`,
          [application.quotation_id]
        );
        if (application.enquiry_id) {
          await connection.query(
            `UPDATE equipment_sales_enquiries
             SET status = 'won', updated_by = ?
             WHERE id = ?`,
            [positiveId(req.user?.id), application.enquiry_id]
          );
        }

        await writeAuditEvent({
          connection,
          req,
          action: "EQUIPMENT_FINANCE_AGREEMENT_ACTIVATED",
          actionType: "equipment.finance.agreement.activate",
          entityType: "equipment_sale_agreement",
          entityId: insert.insertId,
          workspaceCode: "equipment_installment_finance",
          hireLocationId: null,
          severity: "notice",
          outcome: "success",
          details: `Activated Finance agreement ${number} from approved credit application ${application.application_number}.`,
          metadata: {
            credit_application_id: application.id,
            quotation_id: application.quotation_id,
            asset_id: application.asset_id,
            equipment_origin_location_id: application.hire_location_id || null,
            total_amount: quotedTotal,
            deposit_required: approvedDeposit,
            financed_amount: financedAmount,
            payment_frequency: scheduleDefinition.payment_frequency,
            payment_interval_days: scheduleDefinition.custom_interval_days,
            non_working_day_rule: scheduleDefinition.non_working_day_rule,
            installment_count: scheduleDefinition.installment_count,
            first_due_date: scheduleDefinition.first_due_date,
            final_due_date: scheduleDefinition.final_due_date,
            equipment_reserved: false,
            hire_contract_created: false,
            payment_recorded: false,
            sms_sent: false,
          },
        });

        return {
          agreement: await loadAgreement(connection, insert.insertId),
          schedule,
          already_activated: false,
        };
      });

      return res.status(activated.already_activated ? 200 : 201).json({
        status: "success",
        message: activated.already_activated
          ? "This approved application already has a Finance agreement."
          : "Finance agreement and exact installment schedule created. No payment, reservation, Hire work or SMS was created.",
        agreement: activated.agreement,
        schedule: activated.schedule,
        already_activated: activated.already_activated,
        next_action: {
          code: "collect_deposit",
          label: "Record the required deposit to reserve the exact machine.",
        },
        safeguards: {
          equipment_reserved: false,
          fleet_status_changed: false,
          payment_recorded: false,
          hire_job_created: false,
          hire_contract_created: false,
          sms_sent: false,
        },
      });
    } catch (error) {
      return sendError(res, error, "Could not activate the Finance agreement.");
    }
  }
);

module.exports = router;
module.exports.ACTIVATION_ROLES = ACTIVATION_ROLES;
module.exports.REQUIRED_COLUMNS = REQUIRED_COLUMNS;
module.exports.REQUIRED_MIGRATIONS = REQUIRED_MIGRATIONS;
module.exports.REQUIRED_TRIGGERS = REQUIRED_TRIGGERS;
module.exports.approvedSchedule = approvedSchedule;
module.exports.schemaStatus = schemaStatus;


