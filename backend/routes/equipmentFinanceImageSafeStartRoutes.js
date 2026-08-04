const crypto = require("crypto");
const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  evaluateCreditApplication,
} = require("../services/equipmentCreditApplicationPolicy");
const {
  FinanceScheduleError,
  monthlyEquivalent,
} = require("../services/equipmentFinanceScheduleService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const {
  PhaseOneError,
  normalizeAffordability,
  normalizeKyc,
  normalizeOffer,
} = require("./equipmentFinancePhaseOneRoutes");
const { safeSettings } = require("./equipmentFinanceRuntimeHotfixRoutes");
const { acquireConnection } = require("./equipmentFinanceCriticalEntryRoutes");

const router = express.Router();
const QUERY_TIMEOUT_MS = 10000;
const DOCUMENT_NUMBER_TIMEOUT_MS = 5000;
const CUSTOMER_TYPES = new Set([
  "individual",
  "company",
  "contractor",
  "government",
]);

function cleanText(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if ([true, 1, "1", "true", "yes", "on"].includes(value)) return true;
  if ([false, 0, "0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function normalizePhone(value) {
  const digits = cleanText(value, 40).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00233")) return `0${digits.slice(5)}`;
  if (digits.startsWith("233")) return `0${digits.slice(3)}`;
  return digits;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fallbackNumber(prefix) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${prefix}-${stamp}-${String(crypto.randomInt(0, 1000000)).padStart(6, "0")}`;
}

async function withDeadline(promise, timeoutMs, fallbackValue) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function documentNumber(sequence, prefix, actorId) {
  return withDeadline(
    nextDocumentNumber(sequence, { userId: actorId }).catch(() => fallbackNumber(prefix)),
    DOCUMENT_NUMBER_TIMEOUT_MS,
    fallbackNumber(prefix)
  );
}

function query(connection, sql, params = [], timeout = QUERY_TIMEOUT_MS) {
  return connection.query({ sql, timeout }, params);
}

async function customerRecord(connection, customerId, lock = false) {
  const [rows] = await query(
    connection,
    `SELECT id, customer_code, customer_name, customer_type, phone,
            whatsapp_phone, email, address, contact_person, risk_notes, is_active
       FROM hire_customers
      WHERE id = ? AND is_active = TRUE
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [customerId]
  );
  return rows[0] || null;
}

function normalizeCustomer(body = {}) {
  const customerName = cleanText(body.customer_name, 180);
  const customerType = cleanText(body.customer_type || "individual", 30)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const phone = normalizePhone(body.phone);
  if (!customerName || !CUSTOMER_TYPES.has(customerType)) {
    throw new PhaseOneError(
      400,
      "Enter the customer name and choose a valid customer type."
    );
  }
  if (!phone) throw new PhaseOneError(400, "Enter the customer phone number.");
  return {
    customer_name: customerName,
    customer_type: customerType,
    phone,
    whatsapp_phone: normalizePhone(body.whatsapp_phone) || phone,
    email: cleanText(body.email, 150) || null,
    address: cleanText(body.address, 1000) || null,
    contact_person: cleanText(body.contact_person, 150) || null,
    risk_notes: cleanText(body.risk_notes, 3000) || null,
  };
}

async function createCustomer(
  connection,
  body,
  actorId,
  confirmDuplicate,
  customerCode
) {
  const customer = normalizeCustomer(body);
  const [duplicates] = await query(
    connection,
    `SELECT id, customer_code, customer_name, phone
       FROM hire_customers
      WHERE is_active = TRUE
        AND (
          REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '233', '0') = ?
          OR LOWER(customer_name) = LOWER(?)
        )
      ORDER BY id DESC
      LIMIT 5`,
    [customer.phone, customer.customer_name]
  );
  if (duplicates.length && !confirmDuplicate) {
    const error = new PhaseOneError(
      409,
      "A customer with this phone number or name already exists. Select the existing customer or confirm that this is a different person.",
      "POSSIBLE_DUPLICATE_FINANCE_CUSTOMER"
    );
    error.duplicates = duplicates;
    throw error;
  }
  const [result] = await query(
    connection,
    "INSERT INTO hire_customers SET ?",
    {
      customer_code: customerCode,
      ...customer,
      payment_terms_days: 0,
      credit_limit: 0,
      is_active: 1,
      created_by: actorId,
      updated_by: actorId,
    }
  );
  return { id: result.insertId, customer_code: customerCode, ...customer };
}

async function financeMachine(connection, assetId) {
  const [rows] = await query(
    connection,
    `SELECT asset.id, asset.asset_code, asset.asset_name, asset.asset_type,
            asset.make, asset.model, asset.model_year, asset.serial_number,
            asset.chassis_number, asset.minimum_selling_price,
            asset.target_selling_price, asset.operational_purpose,
            asset.sale_status, asset.is_active,
            (SELECT COUNT(*) FROM hire_contract_assets hire_asset
              WHERE hire_asset.asset_id = asset.id
                AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count,
            (SELECT COUNT(*) FROM equipment_asset_sale_locks sale_lock
              WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL) AS active_sale_lock_count,
            (SELECT COUNT(*) FROM equipment_credit_applications application
              WHERE application.asset_id = asset.id
                AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')) AS active_application_count,
            (SELECT application.application_number FROM equipment_credit_applications application
              WHERE application.asset_id = asset.id
                AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')
              ORDER BY application.id DESC LIMIT 1) AS blocking_application_number,
            (SELECT agreement.agreement_number
               FROM equipment_asset_sale_locks sale_lock
               INNER JOIN equipment_sale_agreements agreement ON agreement.id = sale_lock.agreement_id
              WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL
              ORDER BY sale_lock.locked_at DESC LIMIT 1) AS blocking_agreement_number
       FROM fleet_assets asset
      WHERE asset.id = ? AND asset.is_active = TRUE
      LIMIT 1 FOR UPDATE`,
    [assetId]
  );
  return rows[0] || null;
}

function assertMachineAvailable(machine) {
  if (!machine) throw new PhaseOneError(404, "The selected excavator was not found.");
  if (!["sale_only", "sale_or_hire"].includes(machine.operational_purpose)) {
    throw new PhaseOneError(409, "The selected excavator is not approved for sale.");
  }
  if (machine.sale_status !== "available") {
    throw new PhaseOneError(
      409,
      "The selected excavator is not currently available for a new installment."
    );
  }
  if (Number(machine.active_hire_count || 0) > 0) {
    throw new PhaseOneError(
      409,
      "The selected excavator is active on Hire and cannot enter an installment."
    );
  }
  if (Number(machine.active_sale_lock_count || 0) > 0) {
    throw new PhaseOneError(
      409,
      `The selected excavator is reserved by Finance agreement ${machine.blocking_agreement_number || "on record"}.`,
      "FINANCE_ASSET_HELD_BY_AGREEMENT"
    );
  }
  if (Number(machine.active_application_count || 0) > 0) {
    throw new PhaseOneError(
      409,
      `The selected excavator is held by application ${machine.blocking_application_number || "on record"}.`,
      "FINANCE_ASSET_HELD_BY_APPLICATION"
    );
  }
}

async function insertKyc(connection, applicationId, kyc, actorId) {
  await query(connection, "INSERT INTO equipment_credit_application_kyc SET ?", {
    application_id: applicationId,
    customer_name_snapshot: kyc.customer_name_snapshot,
    customer_phone_snapshot: kyc.customer_phone_snapshot,
    customer_email_snapshot: kyc.customer_email_snapshot,
    customer_address_snapshot: kyc.customer_address_snapshot,
    id_type: kyc.id_type,
    id_number: kyc.id_number,
    date_of_birth: kyc.date_of_birth,
    nationality: kyc.nationality,
    employment_type: kyc.employment_type,
    occupation: kyc.occupation,
    employer_business_name: kyc.employer_business_name,
    business_registration_number: kyc.business_registration_number,
    residential_address: kyc.residential_address,
    work_address: kyc.work_address,
    years_at_residence: kyc.years_at_residence,
    years_in_employment_business: kyc.years_in_employment_business,
    emergency_contact_name: kyc.emergency_contact_name,
    emergency_contact_phone: kyc.emergency_contact_phone,
    emergency_contact_relationship: kyc.emergency_contact_relationship,
    guarantor_name: kyc.guarantor_name,
    guarantor_phone: kyc.guarantor_phone,
    guarantor_address: kyc.guarantor_address,
    guarantor_id_type: kyc.guarantor_id_type,
    guarantor_id_number: kyc.guarantor_id_number,
    guarantor_relationship: kyc.guarantor_relationship,
    identity_document_url: null,
    address_evidence_url: null,
    income_evidence_url: null,
    bank_statement_url: null,
    business_registration_url: null,
    guarantor_document_url: null,
    identity_verified: 0,
    address_verified: 0,
    income_verified: 0,
    guarantor_verified: 0,
    customer_consent_confirmed: kyc.customer_consent_confirmed ? 1 : 0,
    credit_assessment_consent_confirmed:
      kyc.credit_assessment_consent_confirmed ? 1 : 0,
    verification_notes: kyc.verification_notes,
    created_by: actorId,
    updated_by: actorId,
  });
}

function assessmentResult(offer, affordability, kyc) {
  const calculated = evaluateCreditApplication(
    {
      quoted_total: offer.selling_price,
      proposed_deposit: offer.deposit,
      proposed_frequency: offer.payment_frequency,
      proposed_interval_days: offer.custom_interval_days,
      proposed_installment_count: offer.installment_count,
      ...affordability,
    },
    kyc
  );
  if (affordability.provided) return calculated;
  return {
    ...calculated,
    affordability_status: "not_assessed",
    risk_score: Math.min(Number(calculated.risk_score || 0), 50),
    risk_band: "medium",
    assessment_recommendation:
      "Draft created. Complete customer affordability before submitting this application for approval.",
    reasons: [],
    warnings: ["Affordability information has not been completed yet."],
  };
}

async function writeCreationAudit(req, result, offer, assessment) {
  try {
    await withDeadline(
      writeAuditEvent({
        req,
        action: "EQUIPMENT_FINANCE_INSTALLMENT_STARTED",
        actionType: "EQUIPMENT_FINANCE_INSTALLMENT_STARTED",
        entityType: "equipment_credit_application",
        entityId: result.application.id,
        workspaceCode: "equipment_installment_finance",
        hireLocationId: null,
        severity: "notice",
        outcome: "success",
        details: `Started ${result.application.application_number} for ${result.customer.customer_name} and ${result.machine.asset_code}.`,
        metadata: {
          finance_division: "installment_finance",
          finance_scope: "company_wide",
          customer_id: result.customer.id,
          asset_id: result.machine.id,
          automatic_installment_offer_id: result.installment_offer.id,
          automatic_installment_offer_number: result.installment_offer.number,
          quoted_total: assessment.quoted_total,
          financed_amount: assessment.financed_amount,
          payment_frequency: offer.payment_frequency,
          first_due_date: offer.first_due_date,
          final_due_date: offer.final_due_date,
          image_bytes_loaded: false,
          image_snapshot_stored: false,
        },
      }).catch(() => null),
      3000,
      null
    );
  } catch {
    // Audit failure must not roll back a committed customer application.
  }
}

router.post(
  "/phase-one/start-installment",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    const actorId = positiveId(req.user?.id);
    const assetId = positiveId(req.body?.asset_id);
    const requestedCustomerId = positiveId(req.body?.customer_id);
    if (!actorId) {
      return res.status(401).json({
        status: "error",
        code: "FINANCE_USER_REQUIRED",
        message: "A signed-in Finance user is required.",
      });
    }
    if (!assetId) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_FINANCE_MACHINE",
        message: "Choose an available excavator.",
      });
    }

    let connection;
    let transactionActive = false;
    try {
      const settingsResult = await withDeadline(
        safeSettings(),
        5000,
        { settings: { minimum_deposit_percent: 0, delivery_policy: "after_deposit" } }
      );
      const settings = settingsResult?.settings || settingsResult || {};
      const [applicationNumber, offerNumber, customerNumber] = await Promise.all([
        documentNumber("EQUIPMENT_CREDIT_APPLICATION", "ECAPP", actorId),
        documentNumber("EQUIPMENT_SALES_QUOTATION", "EIO", actorId),
        requestedCustomerId
          ? Promise.resolve(null)
          : documentNumber("EQUIPMENT_FINANCE_CUSTOMER", "FCUS", actorId),
      ]);

      connection = await acquireConnection(7000);
      await connection.beginTransaction();
      transactionActive = true;

      const machine = await financeMachine(connection, assetId);
      assertMachineAvailable(machine);

      let customer;
      if (requestedCustomerId) {
        customer = await customerRecord(connection, requestedCustomerId, true);
        if (!customer) {
          throw new PhaseOneError(
            404,
            "The selected Finance customer was not found."
          );
        }
      } else {
        customer = await createCustomer(
          connection,
          req.body?.customer || {},
          actorId,
          booleanValue(req.body?.confirm_duplicate_customer, false),
          customerNumber
        );
      }

      const offer = normalizeOffer(req.body?.offer || {}, machine, settings);
      const kyc = normalizeKyc(req.body?.kyc || {}, customer);
      const affordability = normalizeAffordability(req.body?.affordability || {});
      const assessment = assessmentResult(offer, affordability, kyc);
      const monthlyAmount = monthlyEquivalent(
        offer.periodic_amount,
        offer.payment_frequency,
        offer.custom_interval_days
      );

      const [quotationInsert] = await query(
        connection,
        "INSERT INTO equipment_sales_quotations SET ?",
        {
          quotation_number: offerNumber,
          hire_location_id: null,
          enquiry_id: null,
          customer_id: customer.id,
          quotation_date: today(),
          validity_date: offer.validity_date,
          status: "approved",
          subtotal: offer.selling_price,
          discount_amount: 0,
          tax_rate_percent: 0,
          tax_amount: 0,
          total_amount: offer.selling_price,
          deposit_required: offer.deposit,
          proposed_frequency: offer.payment_frequency,
          proposed_interval_days: offer.custom_interval_days,
          proposed_non_working_day_rule: offer.non_working_day_rule,
          proposed_installment_count: offer.installment_count,
          proposed_first_due_date: offer.first_due_date,
          delivery_policy: offer.delivery_policy,
          delivery_threshold_percent: offer.delivery_threshold_percent,
          terms: offer.terms,
          notes: offer.notes,
          approval_reason:
            "Automatically approved as the commercial Installment Offer inside Start New Installment.",
          created_by: actorId,
          approved_by: actorId,
          approved_at: new Date(),
        }
      );

      const [itemInsert] = await query(
        connection,
        "INSERT INTO equipment_sales_quotation_items SET ?",
        {
          quotation_id: quotationInsert.insertId,
          hire_location_id: null,
          line_number: 1,
          asset_id: machine.id,
          asset_code_snapshot: machine.asset_code,
          asset_name_snapshot: machine.asset_name,
          asset_type_snapshot: machine.asset_type,
          make_snapshot: machine.make,
          model_snapshot: machine.model,
          model_year_snapshot: machine.model_year,
          serial_number_snapshot: machine.serial_number,
          main_image_url_snapshot: null,
          description:
            `${machine.make || ""} ${machine.model || ""}`.trim() ||
            machine.asset_name,
          quantity: 1,
          unit_price: offer.selling_price,
          discount_amount: 0,
          tax_amount: 0,
          line_total: offer.selling_price,
        }
      );

      const [applicationInsert] = await query(
        connection,
        "INSERT INTO equipment_credit_applications SET ?",
        {
          application_number: applicationNumber,
          hire_location_id: null,
          customer_id: customer.id,
          enquiry_id: null,
          quotation_id: quotationInsert.insertId,
          asset_id: machine.id,
          application_date: today(),
          application_status: "draft",
          kyc_status: assessment.kyc_status,
          affordability_status: assessment.affordability_status,
          risk_band: assessment.risk_band,
          risk_score: assessment.risk_score,
          quoted_total: assessment.quoted_total,
          proposed_deposit: assessment.proposed_deposit,
          financed_amount: assessment.financed_amount,
          proposed_frequency: offer.payment_frequency,
          proposed_interval_days: offer.custom_interval_days,
          proposed_non_working_day_rule: offer.non_working_day_rule,
          proposed_installment_count: offer.installment_count,
          proposed_installment_amount: monthlyAmount,
          proposed_periodic_amount: offer.periodic_amount,
          monthly_salary_income: assessment.monthly_salary_income,
          monthly_business_income: assessment.monthly_business_income,
          monthly_other_income: assessment.monthly_other_income,
          monthly_business_costs: assessment.monthly_business_costs,
          monthly_household_expenses: assessment.monthly_household_expenses,
          existing_monthly_debt: assessment.existing_monthly_debt,
          total_monthly_income: assessment.total_monthly_income,
          total_monthly_commitments: assessment.total_monthly_commitments,
          net_monthly_surplus: assessment.net_monthly_surplus,
          debt_service_ratio_percent: assessment.debt_service_ratio_percent,
          total_commitment_ratio_percent: assessment.total_commitment_ratio_percent,
          deposit_ratio_percent: assessment.deposit_ratio_percent,
          assessment_recommendation: assessment.assessment_recommendation,
          assessment_notes: affordability.assessment_notes,
          customer_consent_at: kyc.customer_consent_confirmed ? new Date() : null,
          decision_version: 1,
          created_by: actorId,
          updated_by: actorId,
        }
      );

      await insertKyc(connection, applicationInsert.insertId, kyc, actorId);
      await query(
        connection,
        "INSERT INTO equipment_credit_application_decisions SET ?",
        {
          application_id: applicationInsert.insertId,
          decision_version: 1,
          action_type: "created",
          from_status: null,
          to_status: "draft",
          affordability_status: assessment.affordability_status,
          risk_band: assessment.risk_band,
          risk_score: assessment.risk_score,
          debt_service_ratio_percent: assessment.debt_service_ratio_percent,
          net_monthly_surplus: assessment.net_monthly_surplus,
          notes:
            "Created through the bounded company-wide Start New Installment workflow. Machine photo bytes were not loaded or copied into the transaction.",
          snapshot_json: JSON.stringify({
            installment_offer_number: offerNumber,
            quotation_item_id: itemInsert.insertId,
            machine: {
              id: machine.id,
              code: machine.asset_code,
              name: machine.asset_name,
            },
            exact_schedule: offer.schedule,
            assessment,
            image_policy: {
              bytes_loaded: false,
              snapshot_stored: false,
              source: "protected_machine_register",
            },
          }),
          decided_by: actorId,
        }
      );

      await connection.commit();
      transactionActive = false;

      const result = {
        customer: {
          id: customer.id,
          customer_code: customer.customer_code,
          customer_name: customer.customer_name,
        },
        machine: {
          id: machine.id,
          asset_code: machine.asset_code,
          asset_name: machine.asset_name,
        },
        installment_offer: {
          id: quotationInsert.insertId,
          number: offerNumber,
          status: "approved",
          created_automatically: true,
          exact_schedule: offer.schedule,
        },
        application: {
          id: applicationInsert.insertId,
          application_number: applicationNumber,
          application_status: "draft",
          kyc_status: assessment.kyc_status,
          affordability_status: assessment.affordability_status,
          risk_band: assessment.risk_band,
          risk_score: assessment.risk_score,
        },
      };

      void writeCreationAudit(req, result, offer, assessment);

      return res.status(201).json({
        status: "success",
        message:
          "Installment Offer and draft credit application created without loading or copying excavator photo bytes.",
        ...result,
        next_path: `/equipment-installment-finance/applications?application=${applicationInsert.insertId}`,
        safeguards: {
          machine_photo_bytes_loaded: false,
          machine_photo_snapshot_stored: false,
          transaction_query_timeout_ms: QUERY_TIMEOUT_MS,
        },
      });
    } catch (error) {
      if (transactionActive && connection) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original failure.
        }
      }
      if (error instanceof PhaseOneError || error instanceof FinanceScheduleError) {
        return res.status(Number(error.statusCode || 400)).json({
          status: "error",
          code: error.code || "EQUIPMENT_FINANCE_PHASE_ONE_ERROR",
          message: error.message,
          ...(error.duplicates ? { duplicates: error.duplicates } : {}),
        });
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          code: "DUPLICATE_FINANCE_RECORD",
          message:
            "That customer, Installment Offer or application already exists.",
        });
      }
      if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
        return res.status(503).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_STABILIZATION_REQUIRED",
          message:
            "The approved Finance database foundation is incomplete for this transaction.",
        });
      }
      console.error("Image-safe Finance installment creation failed:", error);
      return res.status(503).json({
        status: "error",
        code: error?.code || "EQUIPMENT_FINANCE_START_TIMEOUT",
        message:
          error?.message ||
          "The installment transaction did not finish. No partial application was committed.",
      });
    } finally {
      connection?.release();
    }
  }
);

module.exports = router;
module.exports.assertMachineAvailable = assertMachineAvailable;
module.exports.financeMachine = financeMachine;
module.exports.normalizeCustomer = normalizeCustomer;
