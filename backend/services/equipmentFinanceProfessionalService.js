const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const {
  reconcileFinanceAgreement,
} = require("./equipmentFinanceReconciliationService");
const { nextDocumentNumber } = require("./groupConfigurationService");
const { sendSmsAlertToPhone } = require("./smsAlertService");

const REQUIRED_TABLES = Object.freeze([
  "equipment_finance_settings",
  "equipment_finance_settings_history",
  "equipment_finance_document_signatures",
  "equipment_finance_issued_documents",
  "equipment_finance_payment_alerts",
  "equipment_media",
  "equipment_sales_enquiries",
  "equipment_sales_quotations",
  "equipment_sales_quotation_items",
  "equipment_sale_agreements",
  "equipment_asset_sale_locks",
  "equipment_installment_schedule",
  "equipment_sale_payments",
  "equipment_sale_payment_allocations",
  "equipment_deliveries",
  "equipment_ownership_transfers",
  "equipment_sales_reminder_log",
  "equipment_legacy_installment_migrations",
]);

const REQUIRED_COLUMNS = Object.freeze({
  fleet_assets: [
    "registration_number",
    "customs_reference",
    "title_document_reference",
    "insurance_reference",
    "minimum_selling_price",
    "equipment_category",
    "model_year",
    "chassis_number",
    "engine_number",
    "colour",
    "capacity_description",
    "condition_status",
    "operational_purpose",
    "sale_status",
    "hire_location_id",
    "acquisition_date",
    "acquisition_cost",
    "target_selling_price",
    "standard_hire_rate",
    "supplier_name",
    "acquisition_reference",
  ],
  equipment_sale_agreements: [
    "terms_version",
    "agreement_document_number",
    "agreement_issued_at",
    "agreement_signed_at",
  ],
});

const BOOLEAN_SETTINGS = new Set([
  "boss_payment_alert_enabled",
  "boss_due_alert_enabled",
  "boss_overdue_alert_enabled",
  "customer_payment_receipt_sms_enabled",
  "customer_due_soon_sms_enabled",
  "customer_due_today_sms_enabled",
  "customer_overdue_sms_enabled",
  "late_fee_applied_sms_enabled",
  "payment_reversal_sms_enabled",
  "deposit_alert_enabled",
  "settlement_alert_enabled",
  "ownership_ready_alert_enabled",
  "automatic_reminders_enabled",
  "skip_weekends",
  "allow_partial_payments",
  "advance_excess_to_future",
  "buyer_signature_required",
  "witness_signature_required",
  "guarantor_signature_required",
]);

const INTEGER_SETTINGS = new Set([
  "overdue_repeat_days",
  "max_sms_7_days",
  "max_sms_30_days",
  "minimum_hours_between_sms",
  "maximum_term_months",
  "maximum_installment_count",
  "default_first_due_days",
  "default_grace_days",
  "default_review_missed_installments",
  "notice_cure_days",
  "complimentary_service_count",
]);

const DECIMAL_SETTINGS = new Set([
  "minimum_deposit_percent",
  "late_charge_value",
  "late_charge_cap",
  "delivery_threshold_percent",
]);

const ENUM_SETTINGS = Object.freeze({
  late_charge_type: ["none", "fixed", "percentage"],
  delivery_policy: ["immediate", "after_deposit", "after_percentage", "after_settlement"],
  legal_review_status: ["draft", "approved", "expired"],
  signature_mode: ["electronic", "wet_ink", "either"],
});

const SETTINGS_AUDIT_PREFIX = "equipment_finance_settings";

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function booleanValue(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

function integerValue(value, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : undefined;
}

function decimalValue(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? Number(number.toFixed(2)) : undefined;
}

function enumValue(value, allowed) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : undefined;
}

function timeValue(value) {
  const text = String(value ?? "").trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text) ? text : undefined;
}

function dateValue(value) {
  const text = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : text;
}

function dataImageBuffer(value) {
  const text = String(value || "");
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(text);
  if (!match) return null;
  try {
    return Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
}

class ProfessionalFinanceError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const MAX_SIGNATURE_BYTES = 160 * 1024;

function normaliseSignatureDataUrl(value) {
  if (!value) return null;
  const buffer = dataImageBuffer(value);
  if (!buffer || buffer.length > MAX_SIGNATURE_BYTES) return null;
  return String(value);
}
