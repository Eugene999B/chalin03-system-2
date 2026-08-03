const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  getProfessionalSettings,
  professionalSchemaStatus,
} = require("../services/equipmentFinanceProfessionalService");

const router = express.Router();

const ACTIVE_APPLICATION_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
]);
const EDITABLE_APPLICATION_STATUSES = new Set(["draft", "changes_requested"]);
const WITHDRAWABLE_APPLICATION_STATUSES = new Set([
  "draft",
  "changes_requested",
  "submitted",
]);
const MAX_MACHINE_ROWS = 250;
const MAX_CUSTOMER_ROWS = 250;

function cleanText(value, maximum = 200) {
  return String(value ?? "").trim().slice(0, maximum);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function safeLimit(value, fallback = 200, maximum = 250) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function columnExpression(columns, alias, column, fallback = "NULL") {
  return columns.has(column)
    ? `${alias}.\`${column}\` AS \`${column}\``
    : `${fallback} AS \`${column}\``;
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(rows[0]?.present || 0) === 1;
}

async function tableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

function machineReadiness(machine) {
  const missing = [];
  if (!cleanText(machine.asset_code)) missing.push("equipment code");
  if (!cleanText(machine.asset_name)) missing.push("equipment name");
  if (!cleanText(machine.asset_type)) missing.push("equipment type");
  if (!cleanText(machine.make)) missing.push("make");
  if (!cleanText(machine.model)) missing.push("model");
  if (!cleanText(machine.serial_number) && !cleanText(machine.chassis_number)) {
    missing.push("serial or chassis number");
  }
  if (Number(machine.target_selling_price || 0) <= 0) {
    missing.push("selling price");
  }
  if (Number(machine.photo_count || 0) <= 0 && !machine.has_image) {
    missing.push("full machine photo");
  }
  if (!machine.is_active) missing.push("active machine status");
  if (!["sale_only", "sale_or_hire"].includes(machine.operational_purpose)) {
    missing.push("sale purpose approval");
  }
  if (machine.sale_status !== "available") {
    missing.push("available sale status");
  }
  if (Number(machine.active_hire_count || 0) > 0) {
    missing.push("not active on Hire");
  }
  return {
    ready: missing.length === 0,
    missing,
    photo_count: Number(machine.photo_count || 0),
  };
}

async function activeApplicationMap(connection, assetIds) {
  const result = new Map();
  if (!assetIds.length || !(await tableExists(connection, "equipment_credit_applications"))) {
    return result;
  }
  const columns = await tableColumns(connection, "equipment_credit_applications");
  if (!columns.has("asset_id") || !columns.has("application_status")) return result;
  const selected = [
    "asset_id",
    columns.has("id") ? "id" : "NULL AS id",
    columns.has("application_number")
      ? "application_number"
      : "NULL AS application_number",
    columns.has("updated_at") ? "updated_at" : "NULL AS updated_at",
  ];
  const orderBy = columns.has("updated_at")
    ? "updated_at DESC, id DESC"
    : columns.has("id")
      ? "id DESC"
      : "asset_id";
  const [rows] = await connection.query(
    `SELECT ${selected.join(", ")}
       FROM equipment_credit_applications
      WHERE asset_id IN (${placeholders(assetIds)})
        AND application_status IN (${ACTIVE_APPLICATION_STATUSES.map(() => "?").join(",")})
      ORDER BY ${orderBy}`,
    [...assetIds, ...ACTIVE_APPLICATION_STATUSES]
  );
  for (const row of rows) {
    const assetId = Number(row.asset_id);
    const current = result.get(assetId) || {
      count: 0,
      blocking_application_id: null,
      blocking_application_number: null,
    };
    current.count += 1;
    if (!current.blocking_application_id) {
      current.blocking_application_id = row.id || null;
      current.blocking_application_number = row.application_number || null;
    }
    result.set(assetId, current);
  }
  return result;
}

async function activeLockMap(connection, assetIds) {
  const result = new Map();
  if (!assetIds.length || !(await tableExists(connection, "equipment_asset_sale_locks"))) {
    return result;
  }
  const lockColumns = await tableColumns(connection, "equipment_asset_sale_locks");
  if (!lockColumns.has("asset_id")) return result;
  const agreementExists = await tableExists(connection, "equipment_sale_agreements");
  const releasedWhere = lockColumns.has("released_at")
    ? "AND sale_lock.released_at IS NULL"
    : lockColumns.has("lock_status")
      ? "AND sale_lock.lock_status IN ('active','reserved','locked')"
      : "";
  const joinAgreement =
    agreementExists && lockColumns.has("agreement_id")
      ? "LEFT JOIN equipment_sale_agreements agreement ON agreement.id = sale_lock.agreement_id"
      : "";
  const agreementNumber =
    agreementExists && lockColumns.has("agreement_id")
      ? "agreement.agreement_number"
      : "NULL";
  const [rows] = await connection.query(
    `SELECT sale_lock.asset_id,
            COUNT(*) AS active_sale_lock_count,
            MAX(${agreementNumber}) AS blocking_agreement_number
       FROM equipment_asset_sale_locks sale_lock
       ${joinAgreement}
      WHERE sale_lock.asset_id IN (${placeholders(assetIds)})
        ${releasedWhere}
      GROUP BY sale_lock.asset_id`,
    assetIds
  );
  for (const row of rows) {
    result.set(Number(row.asset_id), {
      count: Number(row.active_sale_lock_count || 0),
      blocking_agreement_number: row.blocking_agreement_number || null,
    });
  }
  return result;
}

async function activeHireMap(connection, assetIds) {
  const result = new Map();
  if (!assetIds.length || !(await tableExists(connection, "hire_contract_assets"))) {
    return result;
  }
  const columns = await tableColumns(connection, "hire_contract_assets");
  if (!columns.has("asset_id")) return result;
  const statusWhere = columns.has("status")
    ? "AND status IN ('assigned','dispatched','active')"
    : "";
  const [rows] = await connection.query(
    `SELECT asset_id, COUNT(*) AS active_hire_count
       FROM hire_contract_assets
      WHERE asset_id IN (${placeholders(assetIds)})
        ${statusWhere}
      GROUP BY asset_id`,
    assetIds
  );
  for (const row of rows) {
    result.set(Number(row.asset_id), Number(row.active_hire_count || 0));
  }
  return result;
}

async function photoCountMap(connection, assetIds) {
  const result = new Map();
  if (!assetIds.length || !(await tableExists(connection, "equipment_media"))) {
    return result;
  }
  const columns = await tableColumns(connection, "equipment_media");
  if (!columns.has("asset_id")) return result;
  const where = [];
  if (columns.has("archived_at")) where.push("archived_at IS NULL");
  if (columns.has("media_category")) where.push("media_category = 'photo'");
  const primaryExpression = columns.has("is_primary")
    ? "SUM(CASE WHEN is_primary = TRUE THEN 1 ELSE 0 END)"
    : "0";
  const [rows] = await connection.query(
    `SELECT asset_id,
            COUNT(*) AS photo_count,
            ${primaryExpression} AS primary_photo_count
       FROM equipment_media
      WHERE asset_id IN (${placeholders(assetIds)})
        ${where.length ? `AND ${where.join(" AND ")}` : ""}
      GROUP BY asset_id`,
    assetIds
  );
  for (const row of rows) {
    result.set(Number(row.asset_id), {
      count: Number(row.photo_count || 0),
      primary_count: Number(row.primary_photo_count || 0),
    });
  }
  return result;
}

async function listMachines({ search = "", status = "", limit = 200 } = {}) {
  const connection = await pool.getConnection();
  try {
    if (!(await tableExists(connection, "fleet_assets"))) {
      const error = new Error("The shared excavator register table is missing.");
      error.statusCode = 503;
      error.code = "FINANCE_MACHINE_REGISTER_TABLE_MISSING";
      throw error;
    }

    const columns = await tableColumns(connection, "fleet_assets");
    const essential = ["id", "asset_code", "asset_name"];
    const missingEssential = essential.filter((column) => !columns.has(column));
    if (missingEssential.length) {
      const error = new Error(
        `The excavator register is missing required columns: ${missingEssential.join(", ")}.`
      );
      error.statusCode = 503;
      error.code = "FINANCE_MACHINE_REGISTER_SCHEMA_MISMATCH";
      error.readiness = { ready: false, missing_columns: missingEssential };
      throw error;
    }

    const desiredColumns = [
      ["id", "NULL"],
      ["asset_code", "NULL"],
      ["asset_name", "NULL"],
      ["asset_type", "'Excavator'"],
      ["equipment_category", "'Earthmoving Equipment'"],
      ["make", "NULL"],
      ["model", "NULL"],
      ["model_year", "NULL"],
      ["serial_number", "NULL"],
      ["chassis_number", "NULL"],
      ["engine_number", "NULL"],
      ["registration_number", "NULL"],
      ["colour", "NULL"],
      ["capacity_description", "NULL"],
      ["condition_status", "'good'"],
      ["ownership_type", "'company_owned'"],
      ["operational_purpose", "'sale_only'"],
      ["current_status", "'available'"],
      ["sale_status", "'available'"],
      ["current_location", "NULL"],
      ["hire_location_id", "NULL"],
      ["meter_type", "'hour_meter'"],
      ["current_meter", "0"],
      ["fuel_type", "'Diesel'"],
      ["insurance_expiry", "NULL"],
      ["registration_expiry", "NULL"],
      ["acquisition_date", "NULL"],
      ["acquisition_cost", "0"],
      ["target_selling_price", "0"],
      ["minimum_selling_price", "0"],
      ["supplier_name", "NULL"],
      ["acquisition_reference", "NULL"],
      ["customs_reference", "NULL"],
      ["title_document_reference", "NULL"],
      ["insurance_reference", "NULL"],
      ["notes", "NULL"],
      ["is_active", "1"],
      ["updated_at", "NULL"],
    ];

    const select = desiredColumns.map(([column, fallback]) =>
      columnExpression(columns, "asset", column, fallback)
    );
    select.push(
      columns.has("main_image_url")
        ? "CASE WHEN asset.main_image_url IS NULL OR asset.main_image_url = '' THEN 0 ELSE 1 END AS has_legacy_image"
        : "0 AS has_legacy_image"
    );

    const locationReady =
      columns.has("hire_location_id") &&
      (await tableExists(connection, "business_locations"));
    const locationJoin = locationReady
      ? "LEFT JOIN business_locations location ON location.id = asset.hire_location_id"
      : "";
    select.push(locationReady ? "location.name AS location_name" : "NULL AS location_name");

    const where = [];
    const params = [];
    if (columns.has("is_active")) where.push("asset.is_active = TRUE");

    const normalizedStatus = cleanText(status, 40).toLowerCase();
    if (normalizedStatus && columns.has("sale_status")) {
      where.push("asset.sale_status = ?");
      params.push(normalizedStatus);
    }

    const term = cleanText(search, 150);
    if (term) {
      const searchable = [
        "asset_code",
        "asset_name",
        "make",
        "model",
        "serial_number",
        "chassis_number",
        "registration_number",
      ].filter((column) => columns.has(column));
      if (searchable.length) {
        where.push(`(${searchable.map((column) => `asset.\`${column}\` LIKE ?`).join(" OR ")})`);
        const like = `%${term}%`;
        params.push(...searchable.map(() => like));
      }
    }

    const orderBy = columns.has("updated_at")
      ? "asset.updated_at DESC, asset.id DESC"
      : "asset.id DESC";
    const rowLimit = safeLimit(limit, 200, MAX_MACHINE_ROWS);
    const [assets] = await connection.query(
      `SELECT ${select.join(", ")}
         FROM fleet_assets asset
         ${locationJoin}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY ${orderBy}
        LIMIT ?`,
      [...params, rowLimit]
    );

    const ids = assets.map((asset) => Number(asset.id)).filter(Boolean);
    const [applications, locks, hires, photos] = await Promise.all([
      activeApplicationMap(connection, ids),
      activeLockMap(connection, ids),
      activeHireMap(connection, ids),
      photoCountMap(connection, ids),
    ]);

    return assets.map((asset) => {
      const application = applications.get(Number(asset.id)) || {};
      const lock = locks.get(Number(asset.id)) || {};
      const photo = photos.get(Number(asset.id)) || {};
      const machine = {
        ...asset,
        is_active: Boolean(Number(asset.is_active ?? 1)),
        target_selling_price: Number(asset.target_selling_price || 0),
        minimum_selling_price: Number(asset.minimum_selling_price || 0),
        acquisition_cost: Number(asset.acquisition_cost || 0),
        current_meter: Number(asset.current_meter || 0),
        active_application_count: Number(application.count || 0),
        active_sale_lock_count: Number(lock.count || 0),
        active_hire_count: Number(hires.get(Number(asset.id)) || 0),
        blocking_application_id: application.blocking_application_id || null,
        blocking_application_number:
          application.blocking_application_number || null,
        blocking_agreement_number: lock.blocking_agreement_number || null,
        photo_count: Number(photo.count || 0),
        has_image:
          Boolean(Number(asset.has_legacy_image || 0)) ||
          Number(photo.count || 0) > 0,
        main_image_url: null,
        media: [],
      };
      machine.readiness = machineReadiness(machine);
      const editable =
        machine.sale_status === "available" &&
        machine.active_application_count === 0 &&
        machine.active_sale_lock_count === 0 &&
        machine.active_hire_count === 0;
      machine.editability = {
        editable,
        reason: editable
          ? "This excavator has not entered an installment workflow."
          : machine.blocking_application_number
            ? `Held by Finance application ${machine.blocking_application_number}.`
            : machine.blocking_agreement_number
              ? `Reserved by Finance agreement ${machine.blocking_agreement_number}.`
              : machine.active_hire_count > 0
                ? "This excavator is active on Equipment Hire."
                : "This excavator is linked to an active reservation, agreement or final sale status.",
      };
      return machine;
    });
  } finally {
    connection.release();
  }
}

async function listCustomers(search = "") {
  const connection = await pool.getConnection();
  try {
    if (!(await tableExists(connection, "hire_customers"))) return [];
    const columns = await tableColumns(connection, "hire_customers");
    if (!columns.has("id") || !columns.has("customer_name")) return [];
    const desired = [
      ["id", "NULL"],
      ["customer_code", "NULL"],
      ["customer_name", "NULL"],
      ["customer_type", "'individual'"],
      ["phone", "NULL"],
      ["whatsapp_phone", "NULL"],
      ["email", "NULL"],
      ["address", "NULL"],
      ["contact_person", "NULL"],
      ["risk_notes", "NULL"],
      ["is_active", "1"],
      ["updated_at", "NULL"],
    ];
    const select = desired.map(([column, fallback]) =>
      columnExpression(columns, "customer", column, fallback)
    );
    const where = [];
    const params = [];
    if (columns.has("is_active")) where.push("customer.is_active = TRUE");
    const term = cleanText(search, 120);
    if (term) {
      const searchable = ["customer_name", "phone", "customer_code", "email"].filter(
        (column) => columns.has(column)
      );
      if (searchable.length) {
        where.push(`(${searchable.map((column) => `customer.\`${column}\` LIKE ?`).join(" OR ")})`);
        const like = `%${term}%`;
        params.push(...searchable.map(() => like));
      }
    }
    const orderBy = columns.has("updated_at")
      ? "customer.updated_at DESC, customer.customer_name ASC"
      : "customer.customer_name ASC";
    const [rows] = await connection.query(
      `SELECT ${select.join(", ")}
         FROM hire_customers customer
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY ${orderBy}
        LIMIT ?`,
      [...params, MAX_CUSTOMER_ROWS]
    );
    return rows.map((row) => ({
      ...row,
      is_active: Boolean(Number(row.is_active ?? 1)),
      finance_application_count: 0,
      finance_agreement_count: 0,
      outstanding_balance: 0,
    }));
  } finally {
    connection.release();
  }
}

function fallbackSettings() {
  return {
    id: null,
    company_name: "Chalin 03 Company Limited",
    currency: "GHS",
    minimum_deposit_percent: 0,
    default_payment_frequency: "monthly",
    default_first_due_days: 30,
    maximum_term_months: 120,
    maximum_installment_count: 520,
    skip_weekends: false,
    allow_partial_payments: true,
    advance_excess_to_future: true,
    delivery_policy: "after_deposit",
    legal_review_status: "draft",
    compatibility_mode: true,
  };
}

async function safeSettings() {
  try {
    const readiness = await professionalSchemaStatus();
    if (!readiness.ready) {
      return {
        settings: fallbackSettings(),
        readiness,
      };
    }
    return {
      settings: await getProfessionalSettings(),
      readiness,
    };
  } catch (error) {
    return {
      settings: fallbackSettings(),
      readiness: {
        ready: false,
        code: error.code || "FINANCE_SETTINGS_UNAVAILABLE",
        message: error.message,
      },
    };
  }
}

async function applicationDetail(applicationId) {
  const connection = await pool.getConnection();
  try {
    const usersColumns = (await tableExists(connection, "users"))
      ? await tableColumns(connection, "users")
      : new Set();
    const userNameColumn = usersColumns.has("name")
      ? "name"
      : usersColumns.has("full_name")
        ? "full_name"
        : null;
    const decidedByName = userNameColumn
      ? `reviewer.\`${userNameColumn}\` AS decided_by_name`
      : "NULL AS decided_by_name";

    const [rows] = await connection.query(
      `SELECT
         application.id,
         application.application_number,
         application.application_date,
         application.application_status,
         application.kyc_status,
         application.affordability_status,
         application.risk_band,
         application.risk_score,
         application.quoted_total,
         application.proposed_deposit,
         application.financed_amount,
         application.proposed_frequency,
         application.proposed_interval_days,
         application.proposed_non_working_day_rule,
         application.proposed_installment_count,
         application.proposed_installment_amount,
         application.monthly_salary_income,
         application.monthly_business_income,
         application.monthly_other_income,
         application.monthly_business_costs,
         application.monthly_household_expenses,
         application.existing_monthly_debt,
         application.total_monthly_income,
         application.total_monthly_commitments,
         application.net_monthly_surplus,
         application.debt_service_ratio_percent,
         application.total_commitment_ratio_percent,
         application.deposit_ratio_percent,
         application.assessment_recommendation,
         application.decision_reason,
         application.decision_version,
         application.submitted_at,
         application.reviewed_at,
         application.created_at,
         application.updated_at,
         customer.id AS customer_id,
         customer.customer_code,
         customer.customer_name,
         customer.phone AS customer_phone,
         customer.email AS customer_email,
         customer.address AS customer_address,
         quotation.id AS quotation_id,
         quotation.quotation_number,
         quotation.status AS quotation_status,
         quotation.proposed_first_due_date,
         quotation.proposed_interval_days AS quotation_interval_days,
         quotation.proposed_non_working_day_rule AS quotation_non_working_day_rule,
         quotation.terms AS quotation_terms,
         quotation.notes AS quotation_notes,
         asset.id AS asset_id,
         asset.asset_code,
         asset.asset_name,
         asset.asset_type,
         asset.make,
         asset.model,
         asset.model_year,
         asset.serial_number,
         asset.chassis_number,
         asset.hire_location_id AS equipment_origin_location_id,
         CASE
           WHEN asset.main_image_url IS NULL OR asset.main_image_url = '' THEN 0
           ELSE 1
         END AS has_image,
         origin.name AS equipment_origin_name,
         agreement.id AS agreement_id,
         agreement.agreement_number,
         agreement.agreement_status,
         agreement.equipment_commitment_status
       FROM equipment_credit_applications application
       INNER JOIN equipment_sales_quotations quotation
         ON quotation.id = application.quotation_id
       INNER JOIN hire_customers customer
         ON customer.id = application.customer_id
       INNER JOIN fleet_assets asset
         ON asset.id = application.asset_id
       LEFT JOIN business_locations origin
         ON origin.id = asset.hire_location_id
       LEFT JOIN equipment_sale_agreements agreement
         ON agreement.credit_application_id = application.id
       WHERE application.id = ?
       LIMIT 1`,
      [applicationId]
    );
    const application = rows[0];
    if (!application) {
      const error = new Error("Installment application was not found.");
      error.statusCode = 404;
      error.code = "FINANCE_APPLICATION_NOT_FOUND";
      throw error;
    }

    const [kycResult, decisionResult, lockResult] = await Promise.all([
      connection.query(
        `SELECT
           id,
           application_id,
           customer_name_snapshot,
           customer_phone_snapshot,
           customer_email_snapshot,
           customer_address_snapshot,
           id_type,
           id_number,
           date_of_birth,
           nationality,
           employment_type,
           occupation,
           residential_address,
           work_address,
           guarantor_name,
           guarantor_phone,
           guarantor_id_number,
           customer_consent_confirmed,
           credit_assessment_consent_confirmed,
           identity_verified,
           address_verified,
           income_verified,
           guarantor_verified,
           verified_at,
           verification_notes,
           created_at,
           updated_at
         FROM equipment_credit_application_kyc
         WHERE application_id = ?
         LIMIT 1`,
        [applicationId]
      ),
      connection.query(
        `SELECT
           decision.id,
           decision.decision_version,
           decision.action_type,
           decision.from_status,
           decision.to_status,
           decision.affordability_status,
           decision.risk_band,
           decision.risk_score,
           decision.debt_service_ratio_percent,
           decision.net_monthly_surplus,
           decision.notes,
           decision.decided_by,
           decision.decided_at,
           ${decidedByName}
         FROM equipment_credit_application_decisions decision
         ${userNameColumn ? "LEFT JOIN users reviewer ON reviewer.id = decision.decided_by" : ""}
         WHERE decision.application_id = ?
         ORDER BY decision.decision_version DESC, decision.id DESC
         LIMIT 20`,
        [applicationId]
      ),
      connection.query(
        `SELECT
           sale_lock.id,
           sale_lock.lock_status,
           sale_lock.agreement_id,
           agreement.agreement_number,
           sale_lock.created_at,
           sale_lock.released_at
         FROM equipment_asset_sale_locks sale_lock
         LEFT JOIN equipment_sale_agreements agreement
           ON agreement.id = sale_lock.agreement_id
         WHERE sale_lock.asset_id = ?
           AND sale_lock.released_at IS NULL
         ORDER BY sale_lock.created_at DESC, sale_lock.id DESC
         LIMIT 10`,
        [application.asset_id]
      ),
    ]);

    const hasImage = Boolean(Number(application.has_image || 0));
    return {
      application: {
        ...application,
        hire_location_id: null,
        has_image: hasImage,
        main_image_url: null,
        image_path: hasImage
          ? `/equipment-catalogue/sales/credit-applications/${application.id}/image`
          : null,
      },
      kyc: kycResult[0][0] || null,
      decisions: decisionResult[0],
      active_asset_locks: lockResult[0],
      editable: EDITABLE_APPLICATION_STATUSES.has(
        application.application_status
      ),
      withdrawable: WITHDRAWABLE_APPLICATION_STATUSES.has(
        application.application_status
      ),
      policy: {
        scope: "company_wide",
        hire_location_selection_required: false,
        equipment_origin_is_metadata_only: true,
        list_contains_image_bytes: false,
        detail_contains_image_bytes: false,
        decision_history_limit: 20,
      },
    };
  } finally {
    connection.release();
  }
}

function sendError(res, error, fallback) {
  const statusCode = Number(error.statusCode || 500);
  if (statusCode >= 500) console.error(fallback, error);
  return res.status(statusCode).json({
    status: "error",
    code: error.code || "FINANCE_RUNTIME_HOTFIX_ERROR",
    message: error.message || fallback,
    ...(error.readiness ? { readiness: error.readiness } : {}),
  });
}

router.get(
  "/phase-one/bootstrap",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const [customers, machines, settingsResult] = await Promise.all([
        listCustomers(req.query.search),
        listMachines({
          search: req.query.machine_search,
          status: req.query.machine_status,
          limit: req.query.limit,
        }),
        safeSettings(),
      ]);
      return res.json({
        status: "success",
        customers,
        machines,
        settings: settingsResult.settings,
        settings_readiness: settingsResult.readiness,
        policy: {
          scope: "company_wide",
          hire_location_id: null,
          hire_location_selection_required: false,
          installment_offer_created_automatically: true,
          exact_schedule_preview_enabled: true,
          optional_draft_kyc_and_affordability: true,
          list_contains_image_bytes: false,
          professional_settings_are_non_blocking:
            !settingsResult.readiness?.ready,
        },
      });
    } catch (error) {
      return sendError(
        res,
        error,
        "Could not prepare the Finance customer and excavator workspace."
      );
    }
  }
);

router.get(
  "/professional/machine-register",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const machines = await listMachines(req.query);
      return res.json({
        status: "success",
        count: machines.length,
        machines,
        image_policy: {
          list_contains_image_bytes: false,
          photos_load_only_from_protected_detail: true,
        },
      });
    } catch (error) {
      return sendError(res, error, "Could not load the Finance Machine Register.");
    }
  }
);

router.get(
  "/credit-applications/:id",
  requirePermission("fleet.assets.view"),
  async (req, res, next) => {
    if (req.params.id === "readiness") return next();
    const applicationId = positiveId(req.params.id);
    if (!applicationId) return next();
    try {
      return res.json({
        status: "success",
        ...(await applicationDetail(applicationId)),
      });
    } catch (error) {
      return sendError(res, error, "Could not open the Finance application.");
    }
  }
);

module.exports = router;
module.exports.applicationDetail = applicationDetail;
module.exports.listCustomers = listCustomers;
module.exports.listMachines = listMachines;
module.exports.safeSettings = safeSettings;
