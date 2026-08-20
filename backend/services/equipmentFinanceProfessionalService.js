const crypto = require("crypto");
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
]);

const REQUIRED_COLUMNS = Object.freeze({
  fleet_assets: [
    "registration_number",
    "customs_reference",
    "title_document_reference",
    "insurance_reference",
    "minimum_selling_price",
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
  "customer_payment_receipt_sms_enabled",
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
  default_payment_frequency: new Set(["weekly", "fortnightly", "monthly", "custom"]),
  late_charge_type: new Set(["none", "fixed", "percentage"]),
  delivery_policy: new Set([
    "immediate",
    "after_deposit",
    "after_percentage",
    "after_full_payment",
  ]),
  payment_allocation_policy: new Set(["oldest_due_first"]),
  legal_review_status: new Set(["draft", "reviewed", "approved"]),
});

const SIGNER_ROLES = new Set([
  "seller",
  "buyer",
  "buyer_witness",
  "seller_witness",
  "guarantor",
]);

class ProfessionalFinanceError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_PROFESSIONAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if ([true, 1, "1", "true", "yes", "on", "enabled"].includes(value)) return true;
  if ([false, 0, "0", "false", "no", "off", "disabled"].includes(value)) return false;
  return undefined;
}

function integerValue(value, minimum, maximum, fallback = undefined) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : undefined;
}

function decimalValue(value, minimum, maximum, fallback = undefined) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? Number(number.toFixed(4))
    : undefined;
}

function enumValue(value, allowed, fallback = undefined) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  return allowed.has(text) ? text : undefined;
}

function timeValue(value, fallback = undefined) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = cleanText(value, 8);
  return /^\d{2}:\d{2}(:\d{2})?$/.test(text)
    ? text.length === 5
      ? `${text}:00`
      : text
    : undefined;
}

function dateValue(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Accra",
  });
}

function dateTimeLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Accra",
  });
}

function requestIp(req) {
  return cleanText(
    String(req?.headers?.["x-forwarded-for"] || req?.ip || "").split(",")[0],
    80
  );
}

function requestUserAgent(req) {
  return cleanText(req?.headers?.["user-agent"], 500);
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function dataImageBuffer(value) {
  const match = String(value || "").match(
    /^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  return buffer.length ? buffer : null;
}

async function professionalSchemaStatus(connection = pool) {
  const tablePlaceholders = REQUIRED_TABLES.map(() => "?").join(",");
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${tablePlaceholders})`,
    REQUIRED_TABLES
  );
  const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME));
  const missingTables = REQUIRED_TABLES.filter((name) => !existingTables.has(name));

  const columnTables = Object.keys(REQUIRED_COLUMNS);
  const columnPlaceholders = columnTables.map(() => "?").join(",");
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${columnPlaceholders})`,
    columnTables
  );
  const found = new Map(columnTables.map((name) => [name, new Set()]));
  for (const row of columnRows) {
    if (!found.has(row.TABLE_NAME)) found.set(row.TABLE_NAME, new Set());
    found.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }
  const missingColumns = [];
  for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) {
      if (!found.get(tableName)?.has(column)) {
        missingColumns.push(`${tableName}.${column}`);
      }
    }
  }

  return {
    ready: missingTables.length === 0 && missingColumns.length === 0,
    migration: "20260731_equipment_finance_professional_rebuild",
    missing_tables: missingTables,
    missing_columns: missingColumns,
  };
}

async function assertProfessionalSchema(connection = pool) {
  const readiness = await professionalSchemaStatus(connection);
  if (!readiness.ready) {
    const error = new ProfessionalFinanceError(
      503,
      "Professional Installment Finance is awaiting its approved additive database migration.",
      "EQUIPMENT_FINANCE_PROFESSIONAL_MIGRATION_REQUIRED"
    );
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

function publicSettings(row) {
  if (!row) return null;
  const output = { ...row };
  for (const key of BOOLEAN_SETTINGS) output[key] = Boolean(Number(row[key]));
  for (const key of INTEGER_SETTINGS) output[key] = Number(row[key] || 0);
  for (const key of DECIMAL_SETTINGS) output[key] = Number(row[key] || 0);
  output.authorised_seller_signature_configured = Boolean(
    row.authorised_seller_signature_data_url
  );
  delete output.authorised_seller_signature_data_url;
  return output;
}

async function getProfessionalSettings(connection = pool, { includeSignature = false } = {}) {
  await assertProfessionalSchema(connection);
  const [rows] = await connection.query(
    `SELECT settings.*, user.full_name AS updated_by_name
     FROM equipment_finance_settings settings
     LEFT JOIN users user ON user.id = settings.updated_by
     WHERE settings.id = 1
     LIMIT 1`
  );
  const row = rows[0];
  if (!row) {
    throw new ProfessionalFinanceError(
      503,
      "Professional Finance settings have not been initialised.",
      "EQUIPMENT_FINANCE_SETTINGS_MISSING"
    );
  }
  return includeSignature ? row : publicSettings(row);
}

function normalizeSettingsPayload(body, current) {
  const allowedText = new Map([
    ["company_name", 180],
    ["company_phone", 40],
    ["company_email", 180],
    ["company_address", 255],
    ["company_postal_address", 180],
    ["company_digital_address", 80],
    ["boss_payment_alert_phone", 40],
    ["due_soon_days", 100],
    ["legal_reviewed_by", 180],
    ["terms_version", 60],
    ["agreement_terms", 30000],
    ["authorised_seller_name", 180],
    ["authorised_seller_title", 120],
    ["payment_alert_template", 480],
    ["customer_receipt_template", 480],
    ["reminder_template", 480],
  ]);
  const next = {};

  for (const [key, maxLength] of allowedText) {
    if (body[key] === undefined) continue;
    const value = cleanText(body[key], maxLength);
    if (["company_name", "terms_version", "agreement_terms"].includes(key) && !value) {
      throw new ProfessionalFinanceError(400, `${key.replaceAll("_", " ")} is required.`);
    }
    next[key] = value || null;
  }

  if (body.currency !== undefined) {
    const currency = cleanText(body.currency, 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ProfessionalFinanceError(400, "Currency must use a three-letter code such as GHS.");
    }
    next.currency = currency;
  }

  for (const key of BOOLEAN_SETTINGS) {
    if (body[key] === undefined) continue;
    const value = booleanValue(body[key], undefined);
    if (value === undefined) {
      throw new ProfessionalFinanceError(400, `${key.replaceAll("_", " ")} must be true or false.`);
    }
    next[key] = value ? 1 : 0;
  }

  const integerRules = {
    overdue_repeat_days: [1, 365],
    max_sms_7_days: [1, 50],
    max_sms_30_days: [1, 200],
    minimum_hours_between_sms: [1, 720],
    maximum_term_months: [1, 120],
    maximum_installment_count: [1, 520],
    default_first_due_days: [0, 365],
    default_grace_days: [0, 90],
    default_review_missed_installments: [1, 24],
    notice_cure_days: [1, 180],
    complimentary_service_count: [0, 20],
  };
  for (const [key, [minimum, maximum]] of Object.entries(integerRules)) {
    if (body[key] === undefined) continue;
    const value = integerValue(body[key], minimum, maximum);
    if (value === undefined) {
      throw new ProfessionalFinanceError(
        400,
        `${key.replaceAll("_", " ")} must be between ${minimum} and ${maximum}.`
      );
    }
    next[key] = value;
  }

  const decimalRules = {
    minimum_deposit_percent: [0, 100],
    late_charge_value: [0, 1000000000],
    late_charge_cap: [0, 1000000000],
    delivery_threshold_percent: [0, 100],
  };
  for (const [key, [minimum, maximum]] of Object.entries(decimalRules)) {
    if (body[key] === undefined) continue;
    const value = decimalValue(body[key], minimum, maximum);
    if (value === undefined) {
      throw new ProfessionalFinanceError(
        400,
        `${key.replaceAll("_", " ")} must be between ${minimum} and ${maximum}.`
      );
    }
    next[key] = value;
  }

  for (const [key, allowed] of Object.entries(ENUM_SETTINGS)) {
    if (body[key] === undefined) continue;
    const value = enumValue(body[key], allowed);
    if (value === undefined) {
      throw new ProfessionalFinanceError(400, `Choose a valid ${key.replaceAll("_", " ")}.`);
    }
    next[key] = value;
  }

  for (const key of ["reminder_time", "quiet_hours_start", "quiet_hours_end"]) {
    if (body[key] === undefined) continue;
    const value = timeValue(body[key]);
    if (value === undefined) {
      throw new ProfessionalFinanceError(400, `${key.replaceAll("_", " ")} must use HH:MM.`);
    }
    next[key] = value;
  }

  if (body.legal_review_date !== undefined) {
    const value = dateValue(body.legal_review_date);
    if (value === undefined) {
      throw new ProfessionalFinanceError(400, "Legal review date is invalid.");
    }
    next.legal_review_date = value;
  }

  if (body.authorised_seller_signature_data_url !== undefined) {
    const signature = cleanText(body.authorised_seller_signature_data_url, 100000);
    if (signature && !dataImageBuffer(signature)) {
      throw new ProfessionalFinanceError(400, "Authorised seller signature must be a valid image.");
    }
    next.authorised_seller_signature_data_url = signature || null;
  } else if (body.remove_authorised_seller_signature === true) {
    next.authorised_seller_signature_data_url = null;
  }

  const effective = { ...current, ...next };
  if (effective.automatic_reminders_enabled && !cleanText(effective.reminder_template, 480)) {
    throw new ProfessionalFinanceError(400, "A reminder template is required before automation is enabled.");
  }
  if (effective.boss_payment_alert_enabled && !cleanText(effective.boss_payment_alert_phone, 40)) {
    throw new ProfessionalFinanceError(400, "Enter the boss phone before enabling payment alerts.");
  }
  if (effective.legal_review_status === "approved") {
    if (!cleanText(effective.legal_reviewed_by, 180) || !effective.legal_review_date) {
      throw new ProfessionalFinanceError(
        400,
        "Approved legal terms require the reviewer name and review date."
      );
    }
    if (cleanText(effective.agreement_terms, 30000).length < 500) {
      throw new ProfessionalFinanceError(400, "Approved agreement terms are incomplete.");
    }
  }

  return next;
}

async function updateProfessionalSettings({ body, reason, userId, req }) {
  const cleanReason = cleanText(reason, 500);
  if (cleanReason.length < 5) {
    throw new ProfessionalFinanceError(400, "Enter a clear settings change reason of at least 5 characters.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertProfessionalSchema(connection);
    const [rows] = await connection.query(
      "SELECT * FROM equipment_finance_settings WHERE id = 1 LIMIT 1 FOR UPDATE"
    );
    const current = rows[0];
    if (!current) throw new ProfessionalFinanceError(503, "Finance settings are missing.");
    const updates = normalizeSettingsPayload(body || {}, current);
    const keys = Object.keys(updates);
    if (!keys.length) {
      await connection.commit();
      return { changed: false, settings: publicSettings(current) };
    }

    const assignments = keys.map((key) => `\`${key}\` = ?`).join(", ");
    await connection.query(
      `UPDATE equipment_finance_settings
       SET ${assignments}, updated_by = ?, updated_at = NOW()
       WHERE id = 1`,
      [...keys.map((key) => updates[key]), userId || null]
    );
    const [newRows] = await connection.query(
      "SELECT * FROM equipment_finance_settings WHERE id = 1 LIMIT 1"
    );
    const next = newRows[0];
    await connection.query(
      `INSERT INTO equipment_finance_settings_history (
         settings_id, old_snapshot_json, new_snapshot_json, change_reason,
         changed_by, request_id, ip_address, user_agent
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        safeJson(publicSettings(current)),
        safeJson(publicSettings(next)),
        cleanReason,
        userId || null,
        cleanText(req?.requestId || req?.id, 120) || null,
        requestIp(req) || null,
        requestUserAgent(req) || null,
      ]
    );
    await connection.commit();
    return { changed: true, settings: publicSettings(next) };
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

function machineReadiness(machine, media) {
  const missing = [];
  if (!cleanText(machine.asset_code)) missing.push("equipment code");
  if (!cleanText(machine.asset_name)) missing.push("equipment name");
  if (!cleanText(machine.asset_type)) missing.push("equipment type");
  if (!cleanText(machine.make)) missing.push("make");
  if (!cleanText(machine.model)) missing.push("model");
  if (!cleanText(machine.serial_number) && !cleanText(machine.chassis_number)) {
    missing.push("serial or chassis number");
  }
  if (Number(machine.target_selling_price || 0) <= 0) missing.push("selling price");
  if (!media.some((item) => item.evidence_type === "main" || item.is_primary)) {
    missing.push("full machine photo");
  }
  if (!machine.is_active) missing.push("active machine status");
  if (!["sale_only", "sale_or_hire"].includes(machine.operational_purpose)) {
    missing.push("sale purpose approval");
  }
  if (machine.sale_status !== "available") missing.push("available sale status");
  if (Number(machine.active_hire_count || 0) > 0) missing.push("not active on Hire");
  return {
    ready: missing.length === 0,
    missing,
    photo_count: media.length,
  };
}

async function listProfessionalMachines({ search = "", status = "", limit = 200 } = {}) {
  await assertProfessionalSchema();
  const where = ["asset.is_active = TRUE"];
  const params = [];
  const term = cleanText(search, 150);
  if (term) {
    where.push(
      "(asset.asset_code LIKE ? OR asset.asset_name LIKE ? OR asset.make LIKE ? OR asset.model LIKE ? OR asset.serial_number LIKE ? OR asset.chassis_number LIKE ? OR asset.registration_number LIKE ?)"
    );
    const like = `%${term}%`;
    params.push(like, like, like, like, like, like, like);
  }
  const saleStatus = cleanText(status, 40).toLowerCase();
  if (saleStatus) {
    where.push("asset.sale_status = ?");
    params.push(saleStatus);
  }
  const safeLimit = integerValue(limit, 1, 500, 200);
  params.push(safeLimit);

  const [assets] = await pool.query(
    `SELECT asset.*, location.name AS location_name,
            (SELECT COUNT(*)
               FROM hire_contract_assets hire_asset
              WHERE hire_asset.asset_id = asset.id
                AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count
     FROM fleet_assets asset
     LEFT JOIN business_locations location ON location.id = asset.hire_location_id
     WHERE ${where.join(" AND ")}
     ORDER BY asset.updated_at DESC, asset.id DESC
     LIMIT ?`,
    params
  );
  if (!assets.length) return [];
  const ids = assets.map((asset) => asset.id);
  const placeholders = ids.map(() => "?").join(",");
  const [mediaRows] = await pool.query(
    `SELECT id, asset_id, evidence_type, file_url, thumbnail_url, file_name,
            mime_type, caption, is_primary, sort_order, captured_at, created_at
     FROM equipment_media
     WHERE asset_id IN (${placeholders})
       AND archived_at IS NULL
       AND media_category = 'photo'
     ORDER BY is_primary DESC, sort_order ASC, id ASC`,
    ids
  );
  const mediaByAsset = new Map();
  for (const item of mediaRows) {
    if (!mediaByAsset.has(item.asset_id)) mediaByAsset.set(item.asset_id, []);
    mediaByAsset.get(item.asset_id).push({ ...item, is_primary: Boolean(item.is_primary) });
  }
  return assets.map((asset) => {
    const media = mediaByAsset.get(asset.id) || [];
    return {
      ...asset,
      is_active: Boolean(asset.is_active),
      active_hire_count: Number(asset.active_hire_count || 0),
      media,
      readiness: machineReadiness(asset, media),
    };
  });
}

async function loadAgreementSnapshot(agreementId, connection = pool) {
  await assertProfessionalSchema(connection);
  const id = positiveId(agreementId);
  if (!id) throw new ProfessionalFinanceError(400, "Choose a valid Finance agreement.");

  const [agreementRows] = await connection.query(
    `SELECT
       agreement.*,
       application.application_number,
       application.application_date,
       application.application_status,
       application.kyc_status,
       application.affordability_status,
       application.risk_band,
       application.risk_score,
       application.total_monthly_income,
       application.total_monthly_commitments,
       application.net_monthly_surplus,
       application.debt_service_ratio_percent,
       application.assessment_recommendation,
       application.assessment_notes,
       application.reviewed_at,
       application.decision_reason,
       kyc.customer_name_snapshot AS kyc_customer_name,
       kyc.customer_phone_snapshot AS kyc_customer_phone,
       kyc.customer_email_snapshot,
       kyc.customer_address_snapshot,
       kyc.id_type,
       kyc.id_number,
       kyc.date_of_birth,
       kyc.nationality,
       kyc.employment_type,
       kyc.occupation,
       kyc.employer_business_name,
       kyc.business_registration_number,
       kyc.residential_address,
       kyc.work_address,
       kyc.guarantor_name AS kyc_guarantor_name,
       kyc.guarantor_phone AS kyc_guarantor_phone,
       kyc.guarantor_address,
       kyc.guarantor_id_type,
       kyc.guarantor_id_number,
       kyc.guarantor_relationship,
       kyc.identity_verified,
       kyc.address_verified,
       kyc.income_verified,
       kyc.guarantor_verified,
       customer.customer_name,
       customer.phone AS customer_phone,
       customer.email AS customer_email,
       customer.address AS customer_address,
       asset.asset_code,
       asset.asset_name,
       asset.asset_type,
       asset.equipment_category,
       asset.make,
       asset.model,
       asset.model_year,
       asset.serial_number,
       asset.chassis_number,
       asset.engine_number,
       asset.registration_number,
       asset.colour,
       asset.capacity_description,
       asset.condition_status,
       asset.meter_type,
       asset.current_meter,
       asset.ownership_type,
       asset.customs_reference,
       asset.title_document_reference,
       asset.insurance_reference,
       asset.main_image_url,
       location.name AS finance_location_name,
       creator.full_name AS created_by_name,
       approver.full_name AS approved_by_name
     FROM equipment_sale_agreements agreement
     LEFT JOIN equipment_credit_applications application
       ON application.id = agreement.credit_application_id
     LEFT JOIN equipment_credit_application_kyc kyc
       ON kyc.application_id = application.id
     INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
     LEFT JOIN business_locations location ON location.id = agreement.hire_location_id
     LEFT JOIN users creator ON creator.id = agreement.created_by
     LEFT JOIN users approver ON approver.id = agreement.approved_by
     WHERE agreement.id = ?
       AND agreement.sale_type = 'installment'
       AND agreement.activation_source = 'approved_credit_application'
     LIMIT 1`,
    [id]
  );
  const agreement = agreementRows[0];
  if (!agreement) throw new ProfessionalFinanceError(404, "Finance agreement was not found.");
  const reconciliation = await reconcileFinanceAgreement(id, { connection });
  Object.assign(agreement, reconciliation.calculated);

  const [[schedule], [payments], [media], [signatures]] = await Promise.all([
    connection.query(
      `SELECT id, sequence_number, due_date, scheduled_amount, amount_paid,
              late_charge_amount, waived_charge_amount, schedule_status, fully_paid_at
       FROM equipment_installment_schedule
       WHERE agreement_id = ?
       ORDER BY sequence_number`,
      [id]
    ),
    connection.query(
      `SELECT payment.id, payment.payment_number, payment.receipt_number,
              payment.payment_date, payment.payment_category, payment.payment_stage,
              payment.amount, payment.payment_method, payment.reference_number,
              payment.notes, user.full_name AS received_by_name
       FROM equipment_sale_payments payment
       LEFT JOIN users user ON user.id = payment.received_by
       WHERE payment.agreement_id = ? AND payment.is_voided = FALSE
       ORDER BY payment.payment_date, payment.id`,
      [id]
    ),
    connection.query(
      `SELECT id, evidence_type, file_url, thumbnail_url, file_name, mime_type,
              caption, is_primary, sort_order, captured_at
       FROM equipment_media
       WHERE asset_id = ? AND archived_at IS NULL AND media_category = 'photo'
       ORDER BY is_primary DESC, sort_order ASC, id ASC`,
      [agreement.asset_id]
    ),
    connection.query(
      `SELECT signer_role, signer_name, signer_phone, signature_data_url,
              signed_at, notes
       FROM equipment_finance_document_signatures
       WHERE agreement_id = ?
       ORDER BY FIELD(signer_role, 'seller','buyer','buyer_witness','seller_witness','guarantor')`,
      [id]
    ),
  ]);
  const settings = await getProfessionalSettings(connection, { includeSignature: true });
  return {
    generated_at: new Date().toISOString(),
    template_version: settings.terms_version,
    company: {
      name: settings.company_name,
      phone: settings.company_phone,
      email: settings.company_email,
      address: settings.company_address,
      postal_address: settings.company_postal_address,
      digital_address: settings.company_digital_address,
      authorised_seller_name: settings.authorised_seller_name,
      authorised_seller_title: settings.authorised_seller_title,
      authorised_seller_signature_data_url:
        settings.authorised_seller_signature_data_url || null,
    },
    policy: {
      legal_review_status: settings.legal_review_status,
      legal_reviewed_by: settings.legal_reviewed_by,
      legal_review_date: settings.legal_review_date,
      terms_version: settings.terms_version,
      agreement_terms: settings.agreement_terms,
      complimentary_service_count: Number(settings.complimentary_service_count || 0),
      notice_cure_days: Number(settings.notice_cure_days || 0),
      default_review_missed_installments: Number(
        settings.default_review_missed_installments || 0
      ),
    },
    reconciliation: {
      consistent: reconciliation.consistent,
      mismatches: reconciliation.mismatches,
      calculated: reconciliation.calculated,
    },
    agreement,
    schedule: schedule.map((row) => ({
      ...row,
      scheduled_amount: Number(row.scheduled_amount || 0),
      amount_paid: Number(row.amount_paid || 0),
      late_charge_amount: Number(row.late_charge_amount || 0),
      waived_charge_amount: Number(row.waived_charge_amount || 0),
      balance: Number(
        Math.max(
          Number(row.scheduled_amount || 0) +
            Number(row.late_charge_amount || 0) -
            Number(row.waived_charge_amount || 0) -
            Number(row.amount_paid || 0),
          0
        ).toFixed(2)
      ),
    })),
    payments: payments.map((row) => ({ ...row, amount: Number(row.amount || 0) })),
    media: media.map((row) => ({ ...row, is_primary: Boolean(row.is_primary) })),
    signatures,
  };
}

async function documentNumber(type, userId) {
  const sequenceByType = {
    installment_agreement: ["EQUIPMENT_FINANCE_AGREEMENT_DOCUMENT", "EFA"],
    payment_schedule: ["EQUIPMENT_FINANCE_SCHEDULE_DOCUMENT", "EFS"],
    machine_annexure: ["EQUIPMENT_FINANCE_MACHINE_ANNEXURE", "EFM"],
    guarantor_undertaking: ["EQUIPMENT_FINANCE_GUARANTOR_DOCUMENT", "EFG"],
    customer_statement: ["EQUIPMENT_FINANCE_CUSTOMER_STATEMENT", "EFST"],
    settlement_confirmation: ["EQUIPMENT_FINANCE_SETTLEMENT_DOCUMENT", "EFSC"],
    ownership_transfer: ["EQUIPMENT_FINANCE_OWNERSHIP_DOCUMENT", "EFO"],
  };
  const [sequence, prefix] = sequenceByType[type] || [
    "EQUIPMENT_FINANCE_DOCUMENT",
    "EFD",
  ];
  try {
    return await nextDocumentNumber(sequence, { userId: positiveId(userId) });
  } catch (_error) {
    return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto
      .randomInt(0, 10000)
      .toString()
      .padStart(4, "0")}`;
  }
}

async function issueDocument({ agreementId, documentType, format, userId }) {
  const allowedFormats = new Set(["pdf", "word", "print", "json"]);
  const cleanFormat = cleanText(format, 20).toLowerCase();
  if (!allowedFormats.has(cleanFormat)) {
    throw new ProfessionalFinanceError(400, "Choose PDF, Word, print or JSON format.");
  }
  const snapshot = await loadAgreementSnapshot(agreementId);
  if (!snapshot.reconciliation.consistent) {
    throw new ProfessionalFinanceError(
      409,
      "The Finance account does not reconcile with its receipts, schedule and ledger. Correct the account before issuing an official document.",
      "EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED"
    );
  }
  if (snapshot.policy.legal_review_status !== "approved") {
    throw new ProfessionalFinanceError(
      409,
      "The agreement terms must be marked legally approved in Finance Settings before an official document can be issued.",
      "EQUIPMENT_FINANCE_TERMS_APPROVAL_REQUIRED"
    );
  }
  const type = cleanText(documentType, 80).toLowerCase().replace(/[\s-]+/g, "_");
  const number = await documentNumber(type, userId);
  const snapshotText = safeJson(snapshot);
  const checksum = crypto.createHash("sha256").update(snapshotText).digest("hex");
  const [result] = await pool.query(
    `INSERT INTO equipment_finance_issued_documents (
       document_number, agreement_id, document_type, document_format,
       template_version, snapshot_json, snapshot_checksum, issued_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      number,
      positiveId(agreementId),
      type,
      cleanFormat,
      snapshot.template_version,
      snapshotText,
      checksum,
      userId || null,
    ]
  );
  if (type === "installment_agreement") {
    await pool.query(
      `UPDATE equipment_sale_agreements
       SET agreement_document_number = COALESCE(agreement_document_number, ?),
           terms_version = COALESCE(terms_version, ?),
           agreement_issued_at = COALESCE(agreement_issued_at, NOW())
       WHERE id = ?`,
      [number, snapshot.template_version, positiveId(agreementId)]
    );
  }
  return {
    id: result.insertId,
    document_number: number,
    document_type: type,
    document_format: cleanFormat,
    snapshot_checksum: checksum,
    snapshot,
  };
}

async function getIssuedDocument(documentId) {
  await assertProfessionalSchema();
  const id = positiveId(documentId);
  if (!id) throw new ProfessionalFinanceError(400, "Choose a valid issued document.");
  const [rows] = await pool.query(
    `SELECT document.*, user.full_name AS issued_by_name
     FROM equipment_finance_issued_documents document
     LEFT JOIN users user ON user.id = document.issued_by
     WHERE document.id = ? AND document.archived_at IS NULL
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw new ProfessionalFinanceError(404, "Issued Finance document was not found.");
  const snapshot = parseJson(row.snapshot_json);
  const checksum = crypto
    .createHash("sha256")
    .update(String(row.snapshot_json || ""))
    .digest("hex");
  if (!snapshot || checksum !== row.snapshot_checksum) {
    throw new ProfessionalFinanceError(
      409,
      "The issued document snapshot failed its integrity check.",
      "EQUIPMENT_FINANCE_DOCUMENT_INTEGRITY_FAILED"
    );
  }
  return { ...row, snapshot };
}

async function listIssuedDocuments({ agreementId = null, limit = 200 } = {}) {
  await assertProfessionalSchema();
  const where = ["document.archived_at IS NULL"];
  const params = [];
  const id = positiveId(agreementId);
  if (id) {
    where.push("document.agreement_id = ?");
    params.push(id);
  }
  params.push(integerValue(limit, 1, 500, 200));
  const [rows] = await pool.query(
    `SELECT document.id, document.document_number, document.agreement_id,
            document.document_type, document.document_format,
            document.template_version, document.snapshot_checksum,
            document.issued_at, user.full_name AS issued_by_name,
            agreement.agreement_number, agreement.customer_name_snapshot,
            agreement.asset_name_snapshot
     FROM equipment_finance_issued_documents document
     INNER JOIN equipment_sale_agreements agreement ON agreement.id = document.agreement_id
     LEFT JOIN users user ON user.id = document.issued_by
     WHERE ${where.join(" AND ")}
     ORDER BY document.issued_at DESC, document.id DESC
     LIMIT ?`,
    params
  );
  return rows;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function imageHtml(dataUrl, alt, className = "machine-photo") {
  if (!dataImageBuffer(dataUrl)) return "";
  return `<img class="${className}" src="${htmlEscape(dataUrl)}" alt="${htmlEscape(alt)}" />`;
}

function renderAgreementWord(snapshot, documentNumberValue) {
  const agreement = snapshot.agreement;
  const mainPhoto =
    snapshot.media.find((item) => item.evidence_type === "main")?.file_url ||
    snapshot.media.find((item) => item.is_primary)?.file_url ||
    agreement.main_image_url;
  const scheduleRows = snapshot.schedule
    .map(
      (row) => `<tr><td>${row.sequence_number}</td><td>${dateLabel(row.due_date)}</td><td>${money(
        row.scheduled_amount
      )}</td><td>${money(row.amount_paid)}</td><td>${money(row.balance)}</td><td>${htmlEscape(
        row.schedule_status
      )}</td></tr>`
    )
    .join("");
  const mediaRows = snapshot.media
    .slice(0, 10)
    .map(
      (item) => `<figure>${imageHtml(
        item.file_url,
        item.evidence_type,
        "evidence-photo"
      )}<figcaption>${htmlEscape(item.evidence_type.replaceAll("_", " "))}</figcaption></figure>`
    )
    .join("");
  const terms = htmlEscape(snapshot.policy.agreement_terms)
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br />")}</p>`)
    .join("");
  const sellerSignature =
    snapshot.signatures.find((row) => row.signer_role === "seller")?.signature_data_url ||
    snapshot.company.authorised_seller_signature_data_url;
  const signer = (role, label) => {
    const row = snapshot.signatures.find((item) => item.signer_role === role);
    return `<div class="signature"><strong>${label}</strong>${
      row ? imageHtml(row.signature_data_url, label, "signature-image") : ""
    }<p>Name: ${htmlEscape(row?.signer_name || "")}</p><p>Date: ${htmlEscape(
      row ? dateLabel(row.signed_at) : ""
    )}</p></div>`;
  };

  return Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(
      documentNumberValue
    )}</title><style>
      @page{size:A4;margin:16mm} body{font-family:Arial,sans-serif;color:#172033;font-size:10.5pt;line-height:1.45}
      .header{display:flex;justify-content:space-between;border-bottom:4px solid #b7791f;padding-bottom:10px;margin-bottom:18px}
      .brand h1{margin:0;font-size:18pt}.brand p,.contact p{margin:2px 0}.title{text-align:center;margin:20px 0}.title h2{font-size:19pt;margin:0}.meta{color:#5b6474}
      .hero{border:1px solid #d9dee8;border-radius:10px;padding:12px;background:#f8fafc}.machine-photo{display:block;width:100%;height:245px;object-fit:contain;background:#fff}
      h3{margin-top:22px;border-bottom:2px solid #d7a247;padding-bottom:5px;color:#26344f}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 20px}.grid p{margin:2px 0}
      table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #8c96a8;padding:6px;text-align:left}th{background:#edf1f7}
      .photos{display:grid;grid-template-columns:1fr 1fr;gap:10px}.photos figure{margin:0;border:1px solid #d9dee8;padding:6px}.evidence-photo{width:100%;height:175px;object-fit:contain}.photos figcaption{text-transform:capitalize;text-align:center;font-size:9pt}
      .signatures{display:grid;grid-template-columns:1fr 1fr;gap:18px}.signature{min-height:115px;border-top:1px solid #333;padding-top:6px;margin-top:28px}.signature-image{display:block;max-width:180px;max-height:65px;object-fit:contain}
      .footer{margin-top:25px;padding-top:8px;border-top:1px solid #bbb;font-size:8.5pt;color:#596273}.page-break{page-break-before:always}
    </style></head><body>
      <div class="header"><div class="brand"><h1>${htmlEscape(
        snapshot.company.name
      )}</h1><p>Equipment Installment Finance</p></div><div class="contact"><p>${htmlEscape(
      snapshot.company.phone || ""
    )}</p><p>${htmlEscape(snapshot.company.email || "")}</p><p>${htmlEscape(
      snapshot.company.postal_address || snapshot.company.address || ""
    )}</p></div></div>
      <div class="title"><h2>EXCAVATOR SALE & INSTALLMENT AGREEMENT</h2><p class="meta">Document ${htmlEscape(
        documentNumberValue
      )} · Agreement ${htmlEscape(agreement.agreement_number)} · Terms ${htmlEscape(
      snapshot.template_version
    )}</p></div>
      <div class="hero">${imageHtml(mainPhoto, agreement.asset_name, "machine-photo")}</div>
      <h3>Parties</h3><div class="grid"><p><strong>Seller:</strong> ${htmlEscape(
        snapshot.company.name
      )}</p><p><strong>Agreement date:</strong> ${dateLabel(
      agreement.created_at
    )}</p><p><strong>Buyer:</strong> ${htmlEscape(
      agreement.kyc_customer_name || agreement.customer_name_snapshot || agreement.customer_name
    )}</p><p><strong>Phone:</strong> ${htmlEscape(
      agreement.kyc_customer_phone || agreement.customer_phone_snapshot || agreement.customer_phone
    )}</p><p><strong>Ghana Card / ID:</strong> ${htmlEscape(
      `${agreement.id_type || ""} ${agreement.id_number || ""}`
    )}</p><p><strong>Address:</strong> ${htmlEscape(
      agreement.residential_address || agreement.customer_address_snapshot || agreement.customer_address
    )}</p><p><strong>Guarantor:</strong> ${htmlEscape(
      agreement.kyc_guarantor_name || agreement.guarantor_name || "Not recorded"
    )}</p><p><strong>Guarantor phone:</strong> ${htmlEscape(
      agreement.kyc_guarantor_phone || agreement.guarantor_phone || ""
    )}</p></div>
      <h3>Machine</h3><div class="grid"><p><strong>Equipment:</strong> ${htmlEscape(
        `${agreement.asset_code} — ${agreement.asset_name}`
      )}</p><p><strong>Make / model:</strong> ${htmlEscape(
      `${agreement.make || ""} ${agreement.model || ""} ${agreement.model_year || ""}`
    )}</p><p><strong>Serial:</strong> ${htmlEscape(
      agreement.serial_number || ""
    )}</p><p><strong>Chassis:</strong> ${htmlEscape(
      agreement.chassis_number || ""
    )}</p><p><strong>Engine:</strong> ${htmlEscape(
      agreement.engine_number || ""
    )}</p><p><strong>Registration:</strong> ${htmlEscape(
      agreement.registration_number || ""
    )}</p><p><strong>Condition:</strong> ${htmlEscape(
      agreement.condition_status || ""
    )}</p><p><strong>Meter:</strong> ${htmlEscape(
      `${agreement.current_meter || 0} ${agreement.meter_type || ""}`
    )}</p></div>
      <h3>Commercial Terms</h3><div class="grid"><p><strong>Total purchase price:</strong> ${money(
        agreement.total_amount
      )}</p><p><strong>Deposit required:</strong> ${money(
      agreement.deposit_required
    )}</p><p><strong>Deposit received:</strong> ${money(
      agreement.deposit_received
    )}</p><p><strong>Financed balance:</strong> ${money(
      agreement.financed_amount
    )}</p><p><strong>Frequency:</strong> ${htmlEscape(
      agreement.payment_frequency || ""
    )}</p><p><strong>Installments:</strong> ${htmlEscape(
      agreement.installment_count || ""
    )}</p><p><strong>First due date:</strong> ${dateLabel(
      agreement.first_due_date
    )}</p><p><strong>Final due date:</strong> ${dateLabel(
      agreement.final_due_date
    )}</p><p><strong>Delivery policy:</strong> ${htmlEscape(
      agreement.delivery_policy || ""
    )}</p><p><strong>Outstanding balance:</strong> ${money(
      agreement.outstanding_balance
    )}</p></div>
      <div class="page-break"></div><h3>Installment Payment Schedule</h3><table><thead><tr><th>No.</th><th>Due date</th><th>Scheduled</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${scheduleRows}</tbody></table>
      <h3>Terms and Conditions</h3>${terms}
      <div class="page-break"></div><h3>Machine Identity and Photo Annexure</h3><div class="photos">${mediaRows}</div>
      <h3>Signatures</h3><div class="signatures">${sellerSignature ? `<div class="signature"><strong>Seller's Representative</strong>${imageHtml(
        sellerSignature,
        "Seller signature",
        "signature-image"
      )}<p>Name: ${htmlEscape(
        snapshot.company.authorised_seller_name || ""
      )}</p><p>Title: ${htmlEscape(
        snapshot.company.authorised_seller_title || ""
      )}</p></div>` : signer("seller", "Seller's Representative")}${signer(
      "buyer",
      "Buyer"
    )}${signer("buyer_witness", "Buyer Witness")}${signer(
      "guarantor",
      "Guarantor"
    )}</div>
      <div class="footer">Snapshot checksum: ${htmlEscape(
        crypto.createHash("sha256").update(safeJson(snapshot)).digest("hex")
      )}<br />Generated ${htmlEscape(dateTimeLabel(snapshot.generated_at))}. This issued document is linked to the immutable Finance document register.</div>
    </body></html>`,
    "utf8"
  );
}

function addPdfHeader(doc, snapshot, documentNumberValue) {
  doc.font("Helvetica-Bold").fontSize(15).text(snapshot.company.name, { align: "left" });
  doc.font("Helvetica").fontSize(9).text("Equipment Installment Finance");
  doc.text(
    [snapshot.company.phone, snapshot.company.email, snapshot.company.postal_address]
      .filter(Boolean)
      .join(" · "),
    { align: "right" }
  );
  doc.moveDown(0.5).lineWidth(3).moveTo(45, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(17).text("EXCAVATOR SALE & INSTALLMENT AGREEMENT", {
    align: "center",
  });
  doc
    .font("Helvetica")
    .fontSize(8)
    .text(
      `Document ${documentNumberValue} · Agreement ${snapshot.agreement.agreement_number} · Terms ${snapshot.template_version}`,
      { align: "center" }
    );
  doc.moveDown();
}

function pdfField(doc, label, value, x, y, width = 240) {
  doc.font("Helvetica-Bold").fontSize(8).text(`${label}:`, x, y, { width: 85 });
  doc.font("Helvetica").fontSize(8).text(String(value ?? "—"), x + 88, y, { width: width - 88 });
}

async function renderAgreementPdf(snapshot, documentNumberValue) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 45, left: 45, right: 45 } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      addPdfHeader(doc, snapshot, documentNumberValue);
      const agreement = snapshot.agreement;
      const mainPhoto =
        snapshot.media.find((item) => item.evidence_type === "main")?.file_url ||
        snapshot.media.find((item) => item.is_primary)?.file_url ||
        agreement.main_image_url;
      const image = dataImageBuffer(mainPhoto);
      if (image) {
        doc.rect(45, doc.y, 505, 190).stroke();
        doc.image(image, 50, doc.y + 5, { fit: [495, 180], align: "center", valign: "center" });
        doc.y += 200;
      }
      doc.font("Helvetica-Bold").fontSize(12).text("Parties and machine");
      let y = doc.y + 7;
      pdfField(doc, "Buyer", agreement.kyc_customer_name || agreement.customer_name_snapshot, 45, y);
      pdfField(doc, "Phone", agreement.kyc_customer_phone || agreement.customer_phone_snapshot, 305, y);
      y += 18;
      pdfField(doc, "ID", `${agreement.id_type || ""} ${agreement.id_number || ""}`, 45, y);
      pdfField(doc, "Address", agreement.residential_address || agreement.customer_address_snapshot, 305, y);
      y += 18;
      pdfField(doc, "Equipment", `${agreement.asset_code} — ${agreement.asset_name}`, 45, y);
      pdfField(doc, "Make/model", `${agreement.make || ""} ${agreement.model || ""}`, 305, y);
      y += 18;
      pdfField(doc, "Serial", agreement.serial_number, 45, y);
      pdfField(doc, "Chassis", agreement.chassis_number, 305, y);
      y += 25;
      doc.y = y;
      doc.font("Helvetica-Bold").fontSize(12).text("Commercial terms");
      y = doc.y + 7;
      pdfField(doc, "Purchase price", money(agreement.total_amount), 45, y);
      pdfField(doc, "Deposit", money(agreement.deposit_received), 305, y);
      y += 18;
      pdfField(doc, "Financed balance", money(agreement.financed_amount), 45, y);
      pdfField(doc, "Outstanding", money(agreement.outstanding_balance), 305, y);
      y += 18;
      pdfField(doc, "Frequency", agreement.payment_frequency, 45, y);
      pdfField(doc, "Installments", agreement.installment_count, 305, y);
      doc.y = y + 28;

      doc.addPage();
      addPdfHeader(doc, snapshot, documentNumberValue);
      doc.font("Helvetica-Bold").fontSize(12).text("Installment payment schedule");
      doc.moveDown(0.4);
      const columns = [45, 78, 145, 235, 325, 415];
      ["No.", "Due date", "Scheduled", "Paid", "Balance", "Status"].forEach((heading, index) => {
        doc.font("Helvetica-Bold").fontSize(7).text(heading, columns[index], doc.y, { width: index === 1 ? 65 : 85 });
      });
      doc.moveDown(1.1);
      for (const row of snapshot.schedule) {
        if (doc.y > 745) {
          doc.addPage();
          addPdfHeader(doc, snapshot, documentNumberValue);
        }
        const rowY = doc.y;
        const values = [
          row.sequence_number,
          dateLabel(row.due_date),
          money(row.scheduled_amount),
          money(row.amount_paid),
          money(row.balance),
          row.schedule_status,
        ];
        values.forEach((value, index) => {
          doc.font("Helvetica").fontSize(7).text(String(value), columns[index], rowY, {
            width: index === 1 ? 65 : 85,
          });
        });
        doc.y = rowY + 17;
        doc.moveTo(45, doc.y - 2).lineTo(550, doc.y - 2).lineWidth(0.3).stroke();
      }

      doc.addPage();
      addPdfHeader(doc, snapshot, documentNumberValue);
      doc.font("Helvetica-Bold").fontSize(12).text("Terms and conditions");
      doc.moveDown(0.4);
      doc.font("Helvetica").fontSize(8.2).text(snapshot.policy.agreement_terms, {
        align: "justify",
        lineGap: 2,
      });

      doc.addPage();
      addPdfHeader(doc, snapshot, documentNumberValue);
      doc.font("Helvetica-Bold").fontSize(12).text("Machine identity and photo annexure");
      doc.moveDown();
      const photos = snapshot.media.slice(0, 8);
      for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index];
        const buffer = dataImageBuffer(photo.file_url);
        if (!buffer) continue;
        if (doc.y > 650) {
          doc.addPage();
          addPdfHeader(doc, snapshot, documentNumberValue);
        }
        const x = index % 2 === 0 ? 45 : 305;
        const photoY = index % 2 === 0 ? doc.y : doc.y - 150;
        doc.rect(x, photoY, 245, 135).stroke();
        doc.image(buffer, x + 5, photoY + 5, {
          fit: [235, 110],
          align: "center",
          valign: "center",
        });
        doc.font("Helvetica").fontSize(7).text(photo.evidence_type.replaceAll("_", " "), x, photoY + 118, {
          width: 245,
          align: "center",
        });
        if (index % 2 === 1 || index === photos.length - 1) doc.y = photoY + 150;
      }

      if (doc.y > 610) doc.addPage();
      doc.moveDown().font("Helvetica-Bold").fontSize(12).text("Signatures");
      const roles = [
        ["seller", "Seller's Representative"],
        ["buyer", "Buyer"],
        ["buyer_witness", "Witness"],
        ["guarantor", "Guarantor"],
      ];
      for (const [role, title] of roles) {
        const signature = snapshot.signatures.find((item) => item.signer_role === role);
        const fallbackSignature = role === "seller" ? snapshot.company.authorised_seller_signature_data_url : null;
        const signatureImage = dataImageBuffer(signature?.signature_data_url || fallbackSignature);
        if (doc.y > 710) doc.addPage();
        doc.moveDown(0.8).font("Helvetica-Bold").fontSize(9).text(title);
        if (signatureImage) doc.image(signatureImage, 45, doc.y + 2, { fit: [180, 50] });
        doc.moveDown(3.2).font("Helvetica").fontSize(8).text(
          `Name: ${signature?.signer_name || (role === "seller" ? snapshot.company.authorised_seller_name || "" : "")}    Date: ${
            signature ? dateLabel(signature.signed_at) : ""
          }`
        );
        doc.moveTo(45, doc.y + 5).lineTo(280, doc.y + 5).stroke();
      }
      doc
        .font("Helvetica")
        .fontSize(6.5)
        .fillColor("#555555")
        .text(
          `Snapshot checksum ${crypto
            .createHash("sha256")
            .update(safeJson(snapshot))
            .digest("hex")} · Generated ${dateTimeLabel(snapshot.generated_at)}`,
          45,
          780,
          { width: 505, align: "center" }
        );
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function saveSignature({ agreementId, role, name, phone, signatureDataUrl, notes, userId }) {
  await assertProfessionalSchema();
  const id = positiveId(agreementId);
  const signerRole = enumValue(role, SIGNER_ROLES);
  const signerName = cleanText(name, 180);
  const signature = cleanText(signatureDataUrl, 100000);
  if (!id || !signerRole || signerName.length < 2 || !dataImageBuffer(signature)) {
    throw new ProfessionalFinanceError(
      400,
      "Choose a valid agreement, signer role, signer name and signature image."
    );
  }
  const [agreementRows] = await pool.query(
    "SELECT id FROM equipment_sale_agreements WHERE id = ? LIMIT 1",
    [id]
  );
  if (!agreementRows.length) throw new ProfessionalFinanceError(404, "Agreement was not found.");
  await pool.query(
    `INSERT INTO equipment_finance_document_signatures (
       agreement_id, signer_role, signer_name, signer_phone,
       signature_data_url, signed_at, captured_by, notes
     ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       signer_name = VALUES(signer_name),
       signer_phone = VALUES(signer_phone),
       signature_data_url = VALUES(signature_data_url),
       signed_at = VALUES(signed_at),
       captured_by = VALUES(captured_by),
       notes = VALUES(notes)`,
    [
      id,
      signerRole,
      signerName,
      cleanText(phone, 40) || null,
      signature,
      userId || null,
      cleanText(notes, 500) || null,
    ]
  );
  const [rows] = await pool.query(
    `SELECT signer_role, signer_name, signer_phone, signed_at, notes
     FROM equipment_finance_document_signatures
     WHERE agreement_id = ? AND signer_role = ?
     LIMIT 1`,
    [id, signerRole]
  );
  const settings = await getProfessionalSettings(pool, { includeSignature: true });
  const requiredRoles = ["buyer"];
  if (settings.witness_signature_required) requiredRoles.push("buyer_witness");
  if (settings.guarantor_signature_required) requiredRoles.push("guarantor");
  const [countRows] = await pool.query(
    `SELECT signer_role
     FROM equipment_finance_document_signatures
     WHERE agreement_id = ?`,
    [id]
  );
  const present = new Set(countRows.map((row) => row.signer_role));
  if (requiredRoles.every((requiredRole) => present.has(requiredRole))) {
    await pool.query(
      `UPDATE equipment_sale_agreements
       SET agreement_signed_at = COALESCE(agreement_signed_at, NOW())
       WHERE id = ?`,
      [id]
    );
  }
  return rows[0];
}

function replaceTemplate(template, values) {
  return String(template || "").replace(/\{([a-z0-9_]+)\}/gi, (_match, key) =>
    values[key] === undefined || values[key] === null ? "" : String(values[key])
  );
}

async function sendBossPaymentAlert({ paymentId, agreementId, userId = null }) {
  try {
    await assertProfessionalSchema();
    const payment = positiveId(paymentId);
    const agreement = positiveId(agreementId);
    if (!payment || !agreement) {
      return { ok: false, skipped: true, reason: "Invalid payment alert identity." };
    }
    const [existingRows] = await pool.query(
      `SELECT * FROM equipment_finance_payment_alerts
       WHERE payment_id = ? LIMIT 1`,
      [payment]
    );
    const existing = existingRows[0];
    if (existing && ["accepted", "delivered", "delivery_unknown", "skipped"].includes(existing.alert_status)) {
      return {
        ok: ["accepted", "delivered", "delivery_unknown"].includes(existing.alert_status),
        replayed: true,
        status: existing.alert_status,
        alert_id: existing.id,
      };
    }

    const settings = await getProfessionalSettings(pool, { includeSignature: true });
    const [rows] = await pool.query(
      `SELECT payment.id AS payment_id, payment.receipt_number, payment.amount,
              payment.payment_method, payment.payment_date,
              agreement.id AS agreement_id, agreement.agreement_number,
              agreement.outstanding_balance, agreement.customer_name_snapshot,
              agreement.asset_name_snapshot, agreement.hire_location_id,
              customer.customer_name, asset.asset_name,
              staff.full_name AS received_by_name
       FROM equipment_sale_payments payment
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
       INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
       INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
       LEFT JOIN users staff ON staff.id = payment.received_by
       WHERE payment.id = ? AND agreement.id = ? AND payment.is_voided = FALSE
         AND agreement.sale_type = 'installment'
         AND agreement.activation_source = 'approved_credit_application'
       LIMIT 1`,
      [payment, agreement]
    );
    const row = rows[0];
    if (!row) return { ok: false, skipped: true, reason: "Committed payment was not found." };
    const values = {
      customer_name: row.customer_name_snapshot || row.customer_name,
      amount: Number(row.amount || 0).toFixed(2),
      agreement_number: row.agreement_number,
      equipment_name: row.asset_name_snapshot || row.asset_name,
      receipt_number: row.receipt_number,
      outstanding_balance: Number(row.outstanding_balance || 0).toFixed(2),
      staff_name: row.received_by_name || "Finance staff",
      payment_method: row.payment_method,
      payment_date: dateTimeLabel(row.payment_date),
    };
    const message = replaceTemplate(settings.payment_alert_template, values).slice(0, 480);
    const enabled = Boolean(Number(settings.boss_payment_alert_enabled));
    const phone = cleanText(settings.boss_payment_alert_phone, 40);
    if (!enabled || !phone) {
      await pool.query(
        `INSERT INTO equipment_finance_payment_alerts (
           payment_id, agreement_id, boss_phone, alert_message, alert_status,
           attempt_count, last_error
         ) VALUES (?, ?, ?, ?, 'skipped', 0, ?)
         ON DUPLICATE KEY UPDATE
           alert_status = 'skipped', last_error = VALUES(last_error), updated_at = NOW()`,
        [payment, agreement, phone || null, message, enabled ? "Boss alert phone is missing." : "Boss payment alerts are disabled."]
      );
      return { ok: false, skipped: true, status: "skipped" };
    }

    await pool.query(
      `INSERT INTO equipment_finance_payment_alerts (
         payment_id, agreement_id, boss_phone, alert_message, alert_status,
         attempt_count
       ) VALUES (?, ?, ?, ?, 'pending', 0)
       ON DUPLICATE KEY UPDATE
         boss_phone = VALUES(boss_phone),
         alert_message = VALUES(alert_message),
         updated_at = NOW()`,
      [payment, agreement, phone, message]
    );
    const result = await sendSmsAlertToPhone({
      branchId: null,
      phone,
      message,
      logMessage: `Finance boss alert for ${row.agreement_number}, receipt ${row.receipt_number}.`,
      smsType: "equipment_finance_payment_alert",
      sentBy: userId,
      sourceReference: `equipment-finance-payment:${payment}`,
    });
    const status = result.skipped
      ? "skipped"
      : ["accepted", "delivered", "delivery_unknown", "failed"].includes(result.status)
        ? result.status
        : result.ok
          ? "accepted"
          : "failed";
    await pool.query(
      `UPDATE equipment_finance_payment_alerts
       SET alert_status = ?,
           sms_log_id = ?,
           attempt_count = attempt_count + 1,
           last_error = ?,
           submitted_at = CASE WHEN ? IN ('accepted','delivered','delivery_unknown') THEN NOW() ELSE submitted_at END,
           delivered_at = CASE WHEN ? = 'delivered' THEN NOW() ELSE delivered_at END,
           updated_at = NOW()
       WHERE payment_id = ?`,
      [
        status,
        result.log_id || null,
        result.error || result.reason || null,
        status,
        status,
        payment,
      ]
    );
    return { ...result, status };
  } catch (error) {
    console.error("Finance boss payment alert failed after committed payment:", error);
    return { ok: false, skipped: true, status: "failed", reason: error.message };
  }
}

module.exports = {
  ProfessionalFinanceError,
  assertProfessionalSchema,
  getIssuedDocument,
  getProfessionalSettings,
  issueDocument,
  listIssuedDocuments,
  listProfessionalMachines,
  loadAgreementSnapshot,
  professionalSchemaStatus,
  publicSettings,
  renderAgreementPdf,
  renderAgreementWord,
  saveSignature,
  sendBossPaymentAlert,
  updateProfessionalSettings,
};
