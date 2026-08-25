const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  equipmentFinancePerformanceLogger,
} = require("../middleware/equipmentFinancePerformanceMiddleware");
const {
  getFinanceCustomerPortfolio,
  listFinanceCustomers,
} = require("../services/equipmentFinanceCustomerPortfolioService");
const {
  assertProfessionalSchema,
  listProfessionalMachines,
} = require("../services/equipmentFinanceProfessionalService");
const equipmentFinancePhaseTwoImageRoutes = require("./equipmentFinancePhaseTwoImageRoutes");
const equipmentFinanceAdministratorOverrideRoutes = require("./equipmentFinanceAdministratorOverrideRoutes");
const equipmentFinancePhaseThreeWorkflowRoutes = require("./equipmentFinancePhaseThreeWorkflowRoutes");
const equipmentFinancePhaseThreeCreationGuardRoutes = require("./equipmentFinancePhaseThreeCreationGuardRoutes");
const equipmentFinanceMachineVisibilityRoutes = require("./equipmentFinanceMachineVisibilityRoutes");
const equipmentFinanceCriticalEntryRoutes = require("./equipmentFinanceCriticalEntryRoutes");
const equipmentFinanceCustomerPhotoCaptureRoutes = require("./equipmentFinanceCustomerPhotoCaptureRoutes");
const equipmentFinanceImageSafeStartRoutes = require("./equipmentFinanceImageSafeStartRoutes");
const equipmentFinanceApplicationReadRoutes = require("./equipmentFinanceApplicationReadRoutes");
const equipmentFinanceRuntimeHotfixRoutes = require("./equipmentFinanceRuntimeHotfixRoutes");
const equipmentFinanceDraftRuntimeRoutes = require("./equipmentFinanceDraftRuntimeRoutes");
const equipmentFinanceMachineRegisterRoutes = require("./equipmentFinanceMachineRegisterRoutes");
const equipmentFinanceScheduleRoutes = require("./equipmentFinanceScheduleRoutes");
const equipmentFinancePhaseOneRoutes = require("./equipmentFinancePhaseOneRoutes");
const equipmentCreditOptionalDecisionRoutes = require("./equipmentCreditOptionalDecisionRoutes");
const equipmentFinanceDraftRecoveryRoutes = require("./equipmentFinanceDraftRecoveryRoutes");
const equipmentFinanceAgreementActivationRoutes = require("./equipmentFinanceAgreementActivationRoutes");
const equipmentFinanceDepositReservationRoutes = require("./equipmentFinanceDepositReservationRoutes");
const equipmentFinanceDocumentCompletionRoutes = require("./equipmentFinanceDocumentCompletionRoutes");
const equipmentFinanceProfessionalRoutes = require("./equipmentFinanceProfessionalRoutes");
const equipmentFinanceOperationalPolishRoutes = require("./equipmentFinanceOperationalPolishRoutes");
const equipmentFinanceCorrectionRoutes = require("./equipmentFinanceCorrectionRoutes");
const equipmentFinancePrivateDocumentsRoutes = require("./equipmentFinancePrivateDocumentsRoutes");
const equipmentFinanceDocumentReviewRoutes = require("./equipmentFinanceDocumentReviewRoutes");
const equipmentFinanceDeliveryAuthorizationRoutes = require("./equipmentFinanceDeliveryAuthorizationRoutes");
const equipmentFinanceDeliveryConfirmationRoutes = require("./equipmentFinanceDeliveryConfirmationRoutes");
const equipmentFinancePhaseSixRoutes = require("./equipmentFinancePhaseSixRoutes");
const installmentCompletionPhaseFourRoutes = require("./installmentCompletionPhaseFourRoutes");
const {
  router: equipmentFinanceExportPeriodRoutes,
} = require("./equipmentFinanceExportPeriodRoutes");

const router = express.Router();

router.use(equipmentFinancePerformanceLogger);

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
    delivery_authorization_enabled: true,
    independent_delivery_authorization_enabled: true,
    controlled_delivery_enabled: true,
    delivery_confirmation_enabled: true,
    independent_delivery_confirmation_enabled: true,
    server_draft_autosave: true,
    controlled_amendments: true,
    correction_ledger_enabled: true,
    independent_correction_approval: true,
    configurable_return_settlement_policy: true,
    phase6_customer_payment_sms: true,
    phase6_automatic_reminders: true,
    phase6_portfolio_reporting: true,
    phase6_accounting_export: true,
    phase6_thermal_receipt: true,
    completion_phase_four_enabled: true,
    production_finance_reset_blocked: true,
  };
}

router.use(equipmentFinancePhaseTwoImageRoutes);
router.use(equipmentFinanceAdministratorOverrideRoutes);
router.use(equipmentFinancePhaseThreeWorkflowRoutes);
router.use(equipmentFinancePhaseThreeCreationGuardRoutes);
router.use(equipmentFinanceMachineVisibilityRoutes);
router.use(equipmentFinanceCriticalEntryRoutes);

router.use(equipmentFinanceCustomerPhotoCaptureRoutes);
router.use(equipmentFinanceImageSafeStartRoutes);

router.use("/credit-applications", equipmentFinanceApplicationReadRoutes);
router.use(equipmentFinanceRuntimeHotfixRoutes);
router.use(equipmentFinanceDraftRuntimeRoutes);

// The Excavators register needs to describe a machine that is already in the
// protected installment workflow as "Under Installment", not as missing the
// availability field. This is intentionally read-only; payment/reservation
// writes remain on their existing routes.
router.get(
  "/professional/machine-register",
  requirePermission("fleet.assets.view"),
  async (req, res, next) => {
    try {
      const machines = await listProfessionalMachines({
        search: req.query.search,
        status: req.query.status,
        limit: req.query.limit,
      });
      const normalizedMachines = machines.map((machine) => {
        const underInstallment = machine.sale_status === "installment_active";
        if (!underInstallment) return machine;
        return {
          ...machine,
          workflow_status: "installment",
          workflow_status_label: "Under Installment",
          readiness: {
            ...machine.readiness,
            ready: true,
            missing: (machine.readiness?.missing || []).filter(
              (item) => item !== "available sale status"
            ),
          },
          editability: {
            ...(machine.editability || {}),
            editable: false,
            reason: "This excavator is protected under an active Finance installment workflow.",
          },
        };
      });
      return res.json({
        status: "success",
        count: normalizedMachines.length,
        machines: normalizedMachines,
        image_policy: {
          crop: false,
          object_fit: "contain",
          protected_photo_limit_bytes: 48128,
          stored_formats: ["image/jpeg", "image/png"],
          legacy_webp_download_compatibility: true,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.use("/professional/machine-register", equipmentFinanceMachineRegisterRoutes);
router.use("/deposit-reservations", equipmentFinanceDepositReservationRoutes);
router.use("/finance-corrections", equipmentFinanceCorrectionRoutes);
router.use("/private-documents", equipmentFinancePrivateDocumentsRoutes);
router.use("/private-documents", equipmentFinanceDocumentReviewRoutes);
router.use("/delivery-authorizations", equipmentFinanceDeliveryAuthorizationRoutes);
router.use(equipmentFinanceScheduleRoutes);
router.use("/agreement-activations", equipmentFinanceAgreementActivationRoutes);
router.use("/credit-applications", equipmentCreditOptionalDecisionRoutes);
router.use("/credit-applications", equipmentFinanceDraftRecoveryRoutes);
router.get(
  "/phase-one/bootstrap",
  requirePermission("fleet.assets.view"),
  async (req, res, next) => {
    try {
      const machines = await listProfessionalMachines({
        search: req.query.search,
        status: req.query.status,
        limit: req.query.limit,
      });
      return res.json({ status: "success", count: machines.length, machines });
    } catch (error) {
      return next(error);
    }
  }
);

router.use(equipmentFinancePhaseOneRoutes);

router.use(equipmentFinanceDocumentCompletionRoutes);
router.use(equipmentFinanceProfessionalRoutes);
router.use(equipmentFinanceOperationalPolishRoutes);
router.use(equipmentFinanceExportPeriodRoutes);
router.use(equipmentFinancePhaseSixRoutes);
router.use(installmentCompletionPhaseFourRoutes);

router.use("/finance-lifecycle", equipmentFinanceDeliveryConfirmationRoutes);

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
        `SELECT application.*, kyc.customer_name_snapshot,
                kyc.customer_phone_snapshot, quotation.quotation_number,
                quotation.status AS quotation_status,
                quotation.proposed_first_due_date,
                item.asset_code_snapshot, item.asset_name_snapshot
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

module.exports = router;
