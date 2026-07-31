const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  getFinanceCustomerPortfolio,
  listFinanceCustomers,
} = require("../services/equipmentFinanceCustomerPortfolioService");

const router = express.Router();

const COMPANY_WIDE_SETTINGS = Object.freeze({
  automatic_sms_enabled: false,
  manual_sms_enabled: true,
  manual_whatsapp_enabled: true,
  reminder_time: "09:00",
  due_soon_enabled: true,
  due_soon_days: [7, 3, 1],
  due_today_enabled: true,
  overdue_enabled: true,
  overdue_start_days: 1,
  overdue_repeat_days: 3,
  max_sms_7_days: 3,
  max_sms_30_days: 8,
  minimum_hours_between_sms: 24,
  minimum_balance: 1,
  max_messages_per_run: 50,
  skip_weekends: false,
  include_payment_phone: true,
  message_template:
    "CHALIN03: Dear {customer_name}, your equipment installment {agreement_number} for {equipment_name} has GHS {outstanding_balance} outstanding. {due_sentence}{payment_sentence} Thank you.",
});

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

function deliveryAllowed(agreement) {
  const paid = Number(agreement.amount_paid || 0);
  const total = Number(agreement.total_amount || 0);
  if (agreement.delivery_policy === "immediate") return true;
  if (agreement.delivery_policy === "after_deposit") {
    return paid + 0.01 >= Number(agreement.deposit_required || 0);
  }
  if (agreement.delivery_policy === "after_percentage") {
    return (
      total > 0 &&
      (paid / total) * 100 + 0.0001 >=
        Number(agreement.delivery_threshold_percent || 0)
    );
  }
  return Number(agreement.outstanding_balance || 0) <= 0.01;
}

function lifecycleAccount(agreement) {
  return {
    agreement_id: agreement.id,
    agreement_number: agreement.agreement_number,
    agreement_status: agreement.agreement_status,
    application_id: agreement.credit_application_id,
    application_number: agreement.application_number,
    customer_id: agreement.customer_id,
    customer_name: agreement.customer_name,
    customer_phone: agreement.customer_phone,
    customer_address: agreement.customer_address,
    asset_id: agreement.asset_id,
    asset_code: agreement.asset_code,
    asset_name: agreement.asset_name,
    main_image_url: agreement.main_image_url,
    finance_location_name: agreement.equipment_origin_name,
    equipment_origin_name: agreement.equipment_origin_name,
    total_amount: Number(agreement.total_amount || 0),
    deposit_required: Number(agreement.deposit_required || 0),
    deposit_received: Number(agreement.deposit_received || 0),
    amount_paid: Number(agreement.amount_paid || 0),
    outstanding_balance: Number(agreement.outstanding_balance || 0),
    overdue_amount: Number(agreement.overdue_amount || 0),
    next_due_date: agreement.next_due_date,
    last_payment_at: agreement.last_payment_at,
    delivery_policy: agreement.delivery_policy,
    delivery_threshold_percent: Number(agreement.delivery_threshold_percent || 0),
    delivery_eligible: deliveryAllowed(agreement),
    equipment_commitment_status: agreement.equipment_commitment_status,
    reserved: agreement.equipment_commitment_status === "reserved",
    delivery_id: agreement.delivery_id,
    delivery_number: agreement.delivery_number,
    delivery_datetime: agreement.delivery_datetime,
    delivery_status: agreement.delivery_status,
    handover_stage: agreement.handover_stage,
    ownership_id: agreement.ownership_id,
    transfer_number: agreement.transfer_number,
    transfer_date: agreement.transfer_date,
    ownership_status: agreement.ownership_status,
    transfer_stage: agreement.transfer_stage,
    fully_paid: Number(agreement.outstanding_balance || 0) <= 0.01,
    active_hire_count: Number(agreement.active_hire_count || 0),
  };
}

function financePolicy() {
  return {
    division: "installment_finance",
    scope: "company_wide",
    hire_location_selection_required: false,
    hire_workflow_access: false,
    automatic_sms_enabled: false,
    machine_active_hire_check_enabled: true,
  };
}

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

router.get(
  "/finance-lifecycle/accounts",
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
           customer.address AS customer_address,
           asset.asset_code,
           asset.asset_name,
           asset.main_image_url,
           asset.current_meter,
           asset.sale_status AS asset_sale_status,
           asset.operational_purpose,
           asset.is_active AS asset_is_active,
           location.name AS equipment_origin_name,
           sale_lock.id AS active_lock_id,
           sale_lock.lock_status AS active_lock_status,
           delivery.id AS delivery_id,
           delivery.delivery_number,
           delivery.delivery_datetime,
           delivery.status AS delivery_status,
           delivery.handover_stage,
           ownership.id AS ownership_id,
           ownership.transfer_number,
           ownership.transfer_date,
           ownership.status AS ownership_status,
           ownership.transfer_stage,
           (SELECT COUNT(*)
              FROM hire_contract_assets hire_asset
             WHERE hire_asset.asset_id = agreement.asset_id
               AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count,
           (SELECT MAX(payment.payment_date)
              FROM equipment_sale_payments payment
             WHERE payment.agreement_id = agreement.id
               AND payment.is_voided = FALSE) AS last_payment_at
         FROM equipment_sale_agreements agreement
         INNER JOIN equipment_credit_applications application
           ON application.id = agreement.credit_application_id
         INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
         INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
         LEFT JOIN business_locations location ON location.id = agreement.hire_location_id
         LEFT JOIN equipment_asset_sale_locks sale_lock
           ON sale_lock.agreement_id = agreement.id
          AND sale_lock.released_at IS NULL
         LEFT JOIN equipment_deliveries delivery ON delivery.agreement_id = agreement.id
         LEFT JOIN equipment_ownership_transfers ownership
           ON ownership.agreement_id = agreement.id
         WHERE agreement.sale_type = 'installment'
           AND agreement.activation_source = 'approved_credit_application'
         ORDER BY agreement.created_at DESC
         LIMIT 400`
      );
      const accounts = rows.map(lifecycleAccount);
      return res.json({
        status: "success",
        count: accounts.length,
        accounts,
        policy: financePolicy(),
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/installment-command/settings",
  requirePermission("fleet.assets.view"),
  (_req, res) =>
    res.json({
      status: "success",
      hire_location_id: null,
      scope: "company_wide_finance",
      settings: COMPANY_WIDE_SETTINGS,
      sms: {
        automatic_available: false,
        automatic_sms_enabled: false,
        reason: "Automatic installment SMS remains disabled until a separate approved release.",
      },
      policy: financePolicy(),
    })
);

router.put(
  "/installment-command/settings",
  requirePermission("fleet.assets.manage"),
  (_req, res) =>
    res.status(409).json({
      status: "error",
      code: "FINANCE_AUTOMATIC_REMINDERS_DISABLED",
      message:
        "Company-wide automatic Finance reminder settings remain disabled until a separate approved release.",
      policy: financePolicy(),
    })
);

router.get(
  "/installment-command/reminders/preview",
  requirePermission("fleet.assets.manage"),
  (_req, res) =>
    res.json({
      status: "success",
      count: 0,
      reminders: [],
      disabled: true,
      message: "Automatic installment reminders are disabled.",
      policy: financePolicy(),
    })
);

router.post(
  "/installment-command/reminders/run",
  requirePermission("fleet.assets.manage"),
  (_req, res) =>
    res.status(409).json({
      status: "error",
      code: "FINANCE_AUTOMATIC_REMINDERS_DISABLED",
      message: "Automatic installment reminders are disabled and were not sent.",
      policy: financePolicy(),
    })
);

router.get(
  "/installment-command/reminders/history",
  requirePermission("fleet.assets.view"),
  (_req, res) =>
    res.json({
      status: "success",
      count: 0,
      history: [],
      scope: "company_wide_finance",
      policy: financePolicy(),
    })
);

module.exports = router;
module.exports.COMPANY_WIDE_SETTINGS = COMPANY_WIDE_SETTINGS;
module.exports.financePolicy = financePolicy;
