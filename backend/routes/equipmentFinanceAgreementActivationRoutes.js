const crypto = require("crypto");
const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  buildFinanceSchedule,
  FinanceScheduleError,
} = require("../services/equipmentFinanceScheduleService");

const router = express.Router();

const ACTIVATION_ROLES = new Set(["finance_manager", "finance_accountant"]);
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
  const text = cleanText(value, maxLength);
  return text || null;
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

function dateOnly(value, fallback = null) {
  const text = cleanText(value, 20);
  if (!text) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : text;
}

function ghanaToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function assertActivationOfficer(req) {
  if (isOriginalSystemAdministrator(req.user)) return;
  if (!ACTIVATION_ROLES.has(workspaceRoleFor(req.user))) {
    throw new ActivationError(
      403,
      "Only the Finance Manager or Finance Accountant can activate an approved Finance agreement.",
      "EQUIPMENT_FINANCE_ACTIVATION_PERMISSION_REQUIRED"
    );
  }
}

function buildSchedule(
  totalAmount,
  count,
  firstDueDate,
  frequency,
  intervalDays = null,
  nonWorkingDayRule = "exact"
) {
  return buildFinanceSchedule({
    selling_price: totalAmount,
    deposit: 0,
    installment_count: count,
    first_due_date: firstDueDate,
    payment_frequency: frequency,
    custom_interval_days: intervalDays,
    non_working_day_rule: nonWorkingDayRule,
  }).schedule;
}

function fallbackAgreementNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `ESA-${stamp}-${String(crypto.randomInt(0, 1000000)).padStart(6, "0")}`;
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
  for (const row of columnRows) found.get(row.TABLE_NAME)?.add(row.COLUMN_NAME);
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

  return {
    ready: missingColumns.length === 0 && missingTriggers.length === 0,
    missing_columns: missingColumns,
    missing_triggers: missingTriggers,
  };
}

async function assertSchemaReady(connection = pool) {
  const status = await schemaStatus(connection);
  if (!status.ready) {
    const error = new ActivationError(
      503,
      "Finance agreement activation is being prepared. Apply and verify the company-wide stabilization first.",
      "EQUIPMENT_FINANCE_STABILIZATION_REQUIRED"
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
      code: error.code,
      message: error.message,
      ...(error.readiness ? { readiness: error.readiness } : {}),
    });
  }
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_STABILIZATION_REQUIRED",
      message: "Finance agreement activation is being prepared. Try again after deployment completes.",
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
      message: "This approved credit application already has a Finance agreement.",
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

async function loadApplication(connection, applicationId, lock = false) {
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
       quotation.proposed_first_due_date,
       quotation.proposed_interval_days AS quotation_interval_days,
       quotation.proposed_non_working_day_rule AS quotation_non_working_day_rule,
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
     INNER JOIN equipment_credit_application_kyc kyc
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
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [applicationId]
  );
  return rows[0] || null;
}

async function loadAgreement(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT * FROM equipment_sale_agreements WHERE id = ? LIMIT 1`,
    [agreementId]
  );
  return rows[0] || null;
}

function scheduleForApplication(application) {
  return buildFinanceSchedule({
    selling_price: Number(application.financed_amount || 0),
    deposit: 0,
    installment_count: Number(application.proposed_installment_count || 0),
    first_due_date: application.proposed_first_due_date,
    payment_frequency: application.proposed_frequency,
    custom_interval_days:
      application.proposed_interval_days ?? application.quotation_interval_days,
    non_working_day_rule:
      application.proposed_non_working_day_rule ||
      application.quotation_non_working_day_rule ||
      "exact",
  });
}

function activationCandidate(application) {
  let exactSchedule = null;
  try {
    exactSchedule = scheduleForApplication(application);
  } catch (_error) {
    exactSchedule = null;
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
    quoted_total: Number(application.quoted_total || application.total_amount || 0),
    approved_deposit: Number(application.proposed_deposit || 0),
    financed_amount: Number(application.financed_amount || 0),
    payment_frequency: application.proposed_frequency,
    payment_interval_days:
      application.proposed_interval_days ?? application.quotation_interval_days ?? null,
    non_working_day_rule:
      application.proposed_non_working_day_rule ||
      application.quotation_non_working_day_rule ||
      "exact",
    installment_count: Number(application.proposed_installment_count || 0),
    periodic_amount: Number(
      application.proposed_periodic_amount || exactSchedule?.periodic_amount || 0
    ),
    proposed_first_due_date: application.proposed_first_due_date,
    final_due_date: exactSchedule?.final_due_date || null,
    exact_schedule: exactSchedule?.schedule || [],
    agreement_id: application.agreement_id || null,
    agreement_activated_at: application.agreement_activated_at || null,
    company_wide_finance: true,
    hire_location_id: null,
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
           quotation.proposed_first_due_date,
           quotation.proposed_interval_days AS quotation_interval_days,
           quotation.proposed_non_working_day_rule AS quotation_non_working_day_rule,
           item.asset_code_snapshot,
           item.asset_name_snapshot
         FROM equipment_credit_applications application
         INNER JOIN equipment_credit_application_kyc kyc
           ON kyc.application_id = application.id
         INNER JOIN equipment_sales_quotations quotation
           ON quotation.id = application.quotation_id
         INNER JOIN equipment_sales_quotation_items item
           ON item.quotation_id = quotation.id
          AND item.asset_id = application.asset_id
         WHERE application.application_status = 'approved'
           AND application.kyc_status = 'verified'
           AND application.affordability_status IN ('eligible','manual_review')
         ORDER BY application.reviewed_at DESC, application.id DESC`
      );
      return res.json({
        status: "success",
        candidates: rows.map(activationCandidate),
        policy: {
          scope: "company_wide",
          hire_location_selection_required: false,
          approved_schedule_is_immutable: true,
        },
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
      const application = await loadApplication(pool, applicationId, false);
      if (!application) {
        throw new ActivationError(404, "Finance credit application was not found.");
      }
      const agreement = application.agreement_id
        ? await loadAgreement(pool, application.agreement_id)
        : null;
      return res.json({
        status: "success",
        candidate: activationCandidate(application),
        agreement,
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
          "Confirm the Finance agreement terms and grace days before activation."
        );
      }

      const number = await agreementNumber(req);
      const activated = await withTransaction(async (connection) => {
        const application = await loadApplication(connection, applicationId, true);
        if (!application) {
          throw new ActivationError(404, "Finance credit application was not found.");
        }

        if (application.agreement_id) {
          return {
            agreement: await loadAgreement(connection, application.agreement_id),
            already_activated: true,
            schedule: [],
          };
        }

        if (application.application_status !== "approved") {
          throw new ActivationError(
            409,
            "Only an approved Finance credit application can become an agreement.",
            "EQUIPMENT_FINANCE_APPLICATION_APPROVAL_REQUIRED"
          );
        }
        if (application.kyc_status !== "verified") {
          throw new ActivationError(
            409,
            "Verified KYC evidence is required before Finance agreement activation."
          );
        }
        if (!["eligible", "manual_review"].includes(application.affordability_status)) {
          throw new ActivationError(
            409,
            "Complete and approve the affordability assessment before agreement activation."
          );
        }
        if (!["approved", "accepted"].includes(application.quotation_status)) {
          throw new ActivationError(
            409,
            "The linked Installment Offer is no longer approved or accepted."
          );
        }
        if (!application.asset_is_active) {
          throw new ActivationError(409, "The linked equipment record is inactive.");
        }
        if (!["sale_only", "sale_or_hire"].includes(application.operational_purpose)) {
          throw new ActivationError(409, "The linked equipment is not authorised for sale.");
        }
        if (!["available", "reserved"].includes(application.sale_status)) {
          throw new ActivationError(
            409,
            "The linked equipment is no longer available for this Finance agreement."
          );
        }

        const approvedFirstDueDate = dateOnly(application.proposed_first_due_date, null);
        const requestedFirstDueDate = dateOnly(req.body.first_due_date, approvedFirstDueDate);
        if (!approvedFirstDueDate || requestedFirstDueDate === undefined) {
          throw new ActivationError(409, "The approved first installment due date is missing.");
        }
        if (requestedFirstDueDate !== approvedFirstDueDate) {
          throw new ActivationError(
            409,
            "The approved first due date cannot be changed during activation. Create a controlled amendment and obtain approval first.",
            "FINANCE_APPROVED_TERMS_AMENDMENT_REQUIRED"
          );
        }
        if (approvedFirstDueDate < ghanaToday()) {
          throw new ActivationError(
            409,
            "The approved first due date is now in the past. Create a controlled schedule amendment before activation.",
            "FINANCE_APPROVED_TERMS_AMENDMENT_REQUIRED"
          );
        }

        const exactSchedule = scheduleForApplication(application);
        const schedule = exactSchedule.schedule;
        const installmentCount = exactSchedule.installment_count;
        const financedAmount = exactSchedule.financed_amount;
        const quotedTotal = Number(application.quoted_total || 0);
        const approvedDeposit = Number(application.proposed_deposit || 0);
        if (quotedTotal <= 0 || approvedDeposit < 0 || approvedDeposit > quotedTotal) {
          throw new ActivationError(
            409,
            "The approved Finance terms are incomplete or internally inconsistent."
          );
        }

        const [conflicts] = await connection.query(
          `SELECT id, agreement_number, credit_application_id
           FROM equipment_sale_agreements
           WHERE sale_type = 'installment'
             AND (credit_application_id = ? OR quotation_id = ?)
           LIMIT 1 FOR UPDATE`,
          [application.id, application.quotation_id]
        );
        if (conflicts.length) {
          throw new ActivationError(
            409,
            `Finance agreement ${conflicts[0].agreement_number} already uses this approved application or Installment Offer.`,
            "EQUIPMENT_FINANCE_AGREEMENT_ALREADY_EXISTS"
          );
        }

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
          customer_id_document_url: nullableText(application.identity_document_url, 10000),
          asset_code_snapshot: application.asset_code_snapshot,
          asset_name_snapshot: application.asset_name_snapshot,
          asset_type_snapshot: application.asset_type_snapshot,
          make_snapshot: application.make_snapshot,
          model_snapshot: application.model_snapshot,
          model_year_snapshot: application.model_year_snapshot,
          serial_number_snapshot: application.serial_number_snapshot,
          main_image_url_snapshot: application.main_image_url_snapshot,
          sale_price: application.subtotal,
          discount_amount: application.discount_amount,
          tax_amount: application.tax_amount,
          total_amount: quotedTotal,
          deposit_required: approvedDeposit,
          deposit_received: 0,
          financed_amount: financedAmount,
          scheduled_total: financedAmount,
          amount_paid: 0,
          outstanding_balance: quotedTotal,
          payment_frequency: exactSchedule.payment_frequency,
          payment_interval_days: exactSchedule.custom_interval_days,
          non_working_day_rule: exactSchedule.non_working_day_rule,
          installment_count: installmentCount,
          first_due_date: approvedFirstDueDate,
          next_due_date: schedule[0]?.due_date || null,
          final_due_date: exactSchedule.final_due_date,
          grace_days: graceDays,
          delivery_policy: application.delivery_policy,
          delivery_threshold_percent: application.delivery_threshold_percent,
          guarantor_name: nullableText(application.guarantor_name, 150),
          guarantor_phone: nullableText(application.guarantor_phone, 30),
          guarantor_location: nullableText(application.guarantor_address, 180),
          guarantor_id_type: nullableText(application.guarantor_id_type, 60),
          guarantor_id_number: nullableText(application.guarantor_id_number, 120),
          guarantor_document_url: nullableText(application.guarantor_document_url, 10000),
          terms_accepted: true,
          agreement_notes:
            activationNotes || nullableText(application.quotation_terms, 5000),
          created_by: positiveId(req.user?.id),
          approved_by: application.reviewed_by,
          approved_at: application.reviewed_at,
        };
        if (!agreementFields.customer_name_snapshot || !agreementFields.customer_phone_snapshot) {
          throw new ActivationError(
            409,
            "The verified customer name and phone number are required for the agreement snapshot."
          );
        }

        const [insert] = await connection.query(
          `INSERT INTO equipment_sale_agreements SET ?`,
          agreementFields
        );

        for (const row of schedule) {
          await connection.query(
            `INSERT INTO equipment_installment_schedule (
               agreement_id, sequence_number, due_date, scheduled_amount,
               amount_paid, schedule_status
             ) VALUES (?, ?, ?, ?, 0, 'upcoming')`,
            [insert.insertId, row.sequence_number, row.due_date, row.scheduled_amount]
          );
        }

        await connection.query(
          `UPDATE equipment_credit_applications
           SET agreement_id = ?, agreement_activated_by = ?,
               agreement_activated_at = NOW(), agreement_activation_notes = ?,
               hire_location_id = NULL, updated_by = ?
           WHERE id = ?`,
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
           SET status = 'converted', hire_location_id = NULL
           WHERE id = ?`,
          [application.quotation_id]
        );

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
            total_amount: quotedTotal,
            deposit_required: approvedDeposit,
            financed_amount: financedAmount,
            payment_frequency: exactSchedule.payment_frequency,
            payment_interval_days: exactSchedule.custom_interval_days,
            first_due_date: approvedFirstDueDate,
            final_due_date: exactSchedule.final_due_date,
            installment_count: installmentCount,
            hire_location_id: null,
            equipment_reserved: false,
            hire_contract_created: false,
            payment_recorded: false,
            sms_sent: false,
          },
        });

        return {
          agreement: await loadAgreement(connection, insert.insertId),
          already_activated: false,
          schedule,
        };
      });

      return res.status(activated.already_activated ? 200 : 201).json({
        status: "success",
        message: activated.already_activated
          ? "This approved application already has a Finance agreement."
          : "Finance agreement and exact installment schedule activated. No payment, equipment reservation, Hire job or SMS was created.",
        agreement: activated.agreement,
        schedule: activated.schedule,
        already_activated: activated.already_activated,
        safeguards: {
          company_wide_finance: true,
          hire_location_id: null,
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
module.exports.REQUIRED_TRIGGERS = REQUIRED_TRIGGERS;
module.exports.buildSchedule = buildSchedule;
module.exports.schemaStatus = schemaStatus;
