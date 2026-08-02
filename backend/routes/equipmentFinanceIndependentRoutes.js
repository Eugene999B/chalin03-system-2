const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  getFinanceCustomerPortfolio,
  listFinanceCustomers,
} = require("../services/equipmentFinanceCustomerPortfolioService");
const {
  assertProfessionalSchema,
} = require("../services/equipmentFinanceProfessionalService");
const equipmentFinanceMachineRegisterRoutes = require("./equipmentFinanceMachineRegisterRoutes");
const equipmentFinanceScheduleRoutes = require("./equipmentFinanceScheduleRoutes");
const equipmentFinancePhaseOneRoutes = require("./equipmentFinancePhaseOneRoutes");
const equipmentFinanceProfessionalRoutes = require("./equipmentFinanceProfessionalRoutes");
const equipmentFinanceOperationalPolishRoutes = require("./equipmentFinanceOperationalPolishRoutes");
const equipmentFinanceCorrectionRoutes = require("./equipmentFinanceCorrectionRoutes");
const equipmentFinancePrivateDocumentsRoutes = require("./equipmentFinancePrivateDocumentsRoutes");
const equipmentFinanceDocumentReviewRoutes = require("./equipmentFinanceDocumentReviewRoutes");

const router = express.Router();

function activationCandidate(application) {
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
    installment_count: Number(application.proposed_installment_count || 0),
    proposed_first_due_date: application.proposed_first_due_date,
    agreement_id: application.agreement_id || null,
    agreement_activated_at: application.agreement_activated_at || null,
    equipment_origin_location_id: application.hire_location_id || null,
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

function depositCandidate(agreement) {
  const required = Number(agreement.deposit_required || 0);
  const received = Number(agreement.deposit_received || 0);
  return {
    agreement_id: agreement.id,
    agreement_number: agreement.agreement_number,
    agreement_status: agreement.agreement_status,
    equipment_commitment_status: agreement.equipment_commitment_status,
    application_id: agreement.credit_application_id,
    application_number: agreement.application_number,
    customer_id: agreement.customer_id,
    customer_name: agreement.customer_name,
    customer_phone: agreement.customer_phone,
    asset_id: agreement.asset_id,
    asset_code: agreement.asset_code,
    asset_name: agreement.asset_name,
    main_image_url: agreement.main_image_url,
    asset_sale_status: agreement.sale_status,
    active_hire_count: Number(agreement.active_hire_count || 0),
    total_amount: Number(agreement.total_amount || 0),
    deposit_required: required,
    deposit_received: received,
    deposit_remaining: Number(Math.max(required - received, 0).toFixed(2)),
    financed_amount: Number(agreement.financed_amount || 0),
    outstanding_balance: Number(agreement.outstanding_balance || 0),
    payment_frequency: agreement.payment_frequency,
    installment_count: agreement.installment_count,
    first_due_date: agreement.first_due_date,
    deposit_completed_at: agreement.deposit_completed_at,
    reservation_activated_at: agreement.reservation_activated_at,
    reserved: agreement.equipment_commitment_status === "reserved",
    equipment_origin_name: agreement.equipment_origin_name || null,
  };
}

function financePolicy() {
  return {
    division: "installment_finance",
    scope: "company_wide",
    hire_location_selection_required: false,
    hire_workflow_access: false,
    professional_settings_enabled: true,
    boss_payment_alert_after_commit: true,
    machine_active_hire_check_enabled: true,
    guided_start_enabled: true,
    installment_offer_created_automatically: true,
    exact_schedule_preview_enabled: true,
    custom_interval_days_enabled: true,
    non_working_day_rules_enabled: true,
    operational_polish_enabled: true,
    private_case_documents: true,
    private_document_vault_enabled: true,
    private_document_review_enabled: true,
    separate_document_approval_enabled: true,
    controlled_delivery_enabled: false,
    server_draft_autosave: true,
    controlled_amendments: true,
    correction_ledger_enabled: true,
    independent_correction_approval: true,
    configurable_return_settlement_policy: true,
  };
}

router.use("/professional/machine-register", equipmentFinanceMachineRegisterRoutes);
router.use("/finance-corrections", equipmentFinanceCorrectionRoutes);
router.use("/private-documents", equipmentFinancePrivateDocumentsRoutes);
router.use("/private-documents", equipmentFinanceDocumentReviewRoutes);
router.use(equipmentFinanceScheduleRoutes);
router.use(equipmentFinancePhaseOneRoutes);
router.use(equipmentFinanceProfessionalRoutes);
router.use(equipmentFinanceOperationalPolishRoutes);

// The final lifecycle query now returns professional agreement/document fields.
// Check the professional migration before handing the URL to that router so a
// missing additive migration becomes a controlled 503 rather than a raw SQL 500.
router.use("/finance-lifecycle", async (_req, res, next) => {
  try {
    await assertProfessionalSchema();
    return next();
  } catch (error) {
    return res.status(Number(error.statusCode || 503)).json({
      status: "error",
      code: error.code || "EQUIPMENT_FINANCE_PROFESSIONAL_MIGRATION_REQUIRED",
      message: error.message,
      ...(error.readiness ? { readiness: error.readiness } : {}),
    });
  }
});

router.get(
  "/finance-customers",
  requirePermission("fleet.assets.view"),
  async (req, res, next) => {
    try {
      const result = await listFinanceCustomers({
        search: req.query.search,
        status: req.query.status,
        limit: req.query.limit,
      });
      return res.json({ status: "success", ...result });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/finance-customers/:customerId",
  requirePermission("fleet.assets.view"),
  async (req, res, next) => {
    try {
      const result = await getFinanceCustomerPortfolio(req.params.customerId);
      return res.json({ status: "success", ...result });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/agreement-activations/candidates",
  requirePermission("fleet.assets.view"),
  async (_req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT
           application.*,
           kyc.customer_name_snapshot,
           kyc.customer_phone_snapshot,
           quotation.quotation_number,
           quotation.status AS quotation_status,
           quotation.proposed_first_due_date,
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
        policy: financePolicy(),
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/deposit-reservations/candidates",
  requirePermission("fleet.assets.view"),
  async (_req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT
           agreement.*,
           application.application_number,
           application.application_status,
           application.kyc_status,
           application.affordability_status,
           customer.customer_name,
           customer.phone AS customer_phone,
           asset.asset_code,
           asset.asset_name,
           asset.main_image_url,
           asset.operational_purpose,
           asset.sale_status,
           asset.is_active AS asset_is_active,
           location.name AS equipment_origin_name,
           sale_lock.lock_status AS active_lock_status,
           sale_lock.released_at AS active_lock_released_at,
           (SELECT COUNT(*)
              FROM hire_contract_assets hire_asset
             WHERE hire_asset.asset_id = agreement.asset_id
               AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count
         FROM equipment_sale_agreements agreement
         INNER JOIN equipment_credit_applications application
           ON application.id = agreement.credit_application_id
         INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
         INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
         LEFT JOIN business_locations location ON location.id = agreement.hire_location_id
         LEFT JOIN equipment_asset_sale_locks sale_lock
           ON sale_lock.agreement_id = agreement.id
          AND sale_lock.released_at IS NULL
         WHERE agreement.sale_type = 'installment'
           AND agreement.activation_source = 'approved_credit_application'
           AND agreement.agreement_status IN ('approved','active')
         ORDER BY
           CASE WHEN agreement.equipment_commitment_status = 'reserved' THEN 1 ELSE 0 END,
           agreement.approved_at,
           agreement.id`
      );
      return res.json({
        status: "success",
        candidates: rows.map(depositCandidate),
        policy: financePolicy(),
        safeguards: {
          hire_work_created: false,
          delivery_created: false,
          ownership_transferred: false,
          sms_sent: false,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
);

// The authoritative final lifecycle router owns /finance-lifecycle/*.
// Keeping a second accounts implementation here caused production requests to
// bypass the lifecycle readiness gate and surface raw SQL errors as HTTP 500.

module.exports = router;
module.exports.financePolicy = financePolicy;
