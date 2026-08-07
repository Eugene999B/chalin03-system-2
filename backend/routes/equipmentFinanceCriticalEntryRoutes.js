const crypto = require("crypto");
const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  classifyFinanceDatabaseError,
  inspectFinanceApplicationSchema,
} = require("../services/equipmentFinancePhaseOneDiagnosticsService");

const router = express.Router();

const CONNECTION_TIMEOUT_MS = 5000;
const QUERY_TIMEOUT_MS = 6000;
const CUSTOMER_LIMIT = 80;
const MACHINE_LIMIT = 80;
const APPLICATION_PAGE_SIZE = 25;
const MAX_APPLICATION_PAGE_SIZE = 100;
const IMAGE_URL_TTL_SECONDS = 60 * 60;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACTIVE_APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
];
const ALLOWED_APPLICATION_STATUSES = new Set([
  ...ACTIVE_APPLICATION_STATUSES,
  "declined",
  "withdrawn",
]);

class CriticalFinanceError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maximum = 200) {
  return String(value ?? "").trim().slice(0, maximum);
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function dateOnly(value) {
  const text = cleanText(value, 20);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new CriticalFinanceError(
      400,
      "Choose a valid application date.",
      "INVALID_FINANCE_APPLICATION_DATE"
    );
  }
  return text;
}

function normalizedStatus(value) {
  const status = cleanText(value, 50).toLowerCase().replace(/[\s-]+/g, "_");
  if (!status || status === "all") return null;
  if (!ALLOWED_APPLICATION_STATUSES.has(status)) {
    throw new CriticalFinanceError(
      400,
      "Choose a valid installment application status.",
      "INVALID_FINANCE_APPLICATION_STATUS"
    );
  }
  return status;
}

async function acquireConnection(timeoutMs = CONNECTION_TIMEOUT_MS) {
  const pending = pool.getConnection();
  let timedOut = false;
  let timer;
  try {
    return await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            new CriticalFinanceError(
              503,
              "Finance data is busy. The screen was released instead of remaining stuck.",
              "FINANCE_CRITICAL_CONNECTION_TIMEOUT"
            )
          );
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      pending.then((connection) => connection.release()).catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function query(connection, sql, params = [], timeout = QUERY_TIMEOUT_MS) {
  return connection.query({ sql, timeout }, params);
}

function imageSigningSecret() {
  return cleanText(
    process.env.FINANCE_IMAGE_SIGNING_SECRET ||
      process.env.JWT_SECRET ||
      process.env.SESSION_SECRET,
    1000
  );
}

function imageSignature(assetId, photoId, expires) {
  const secret = imageSigningSecret();
  if (!secret) return "";
  return crypto
    .createHmac("sha256", secret)
    .update(`${assetId}:${photoId}:${expires}`)
    .digest("hex");
}

function signedImageUrl(req, assetId, photoId) {
  const expires = Math.floor(Date.now() / 1000) + IMAGE_URL_TTL_SECONDS;
  const signature = imageSignature(assetId, photoId, expires);
  if (!signature) return null;
  const forwardedProtocol = cleanText(req.get("x-forwarded-proto"), 30)
    .split(",")[0]
    .trim();
  const protocol = forwardedProtocol || req.protocol || "https";
  const host = req.get("host");
  if (!host) return null;
  return `${protocol}://${host}/api/equipment-catalogue/sales/phase-one/machine-image/${assetId}/${photoId}?expires=${expires}&signature=${signature}`;
}

function verifyImageSignature(assetId, photoId, expiresValue, signatureValue) {
  const expires = Number(expiresValue);
  const signature = cleanText(signatureValue, 128);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(expires) || expires < now || expires > now + IMAGE_URL_TTL_SECONDS + 60) {
    return false;
  }
  const expected = imageSignature(assetId, photoId, expires);
  if (!expected || signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function dataImage(value) {
  const match = String(value || "").match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === "image/jpg"
    ? "image/jpeg"
    : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
  return { mimeType, buffer };
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
  if (Number(machine.target_selling_price || 0) <= 0) missing.push("selling price");
  if (Number(machine.photo_count || 0) <= 0 && !machine.has_legacy_image) {
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
    photo_count: Number(machine.photo_count || 0),
  };
}

async function loadCustomers() {
  const connection = await acquireConnection();
  try {
    const [rows] = await query(
      connection,
      `SELECT customer.id, customer.customer_code, customer.customer_name,
              customer.customer_type, customer.phone, customer.whatsapp_phone,
              customer.email, customer.address, customer.contact_person,
              customer.updated_at
         FROM hire_customers customer
        WHERE customer.is_active = TRUE
        ORDER BY customer.id DESC
        LIMIT ?`,
      [CUSTOMER_LIMIT]
    );
    return rows.map((row) => ({
      ...row,
      finance_application_count: 0,
      finance_agreement_count: 0,
      outstanding_balance: 0,
    }));
  } finally {
    connection.release();
  }
}

async function loadMachineMedia(connection, assetIds, req) {
  if (!assetIds.length) return new Map();
  const placeholders = assetIds.map(() => "?").join(",");
  try {
    const [rows] = await query(
      connection,
      `SELECT media.id, media.asset_id, media.evidence_type, media.file_name,
              media.mime_type, media.caption, media.is_primary,
              media.sort_order, media.captured_at
         FROM equipment_media media
        WHERE media.asset_id IN (${placeholders})
          AND media.archived_at IS NULL
          AND media.media_category = 'photo'
        ORDER BY media.asset_id, media.is_primary DESC, media.sort_order ASC, media.id ASC`,
      assetIds
    );
    const result = new Map();
    for (const row of rows) {
      if (!result.has(Number(row.asset_id))) result.set(Number(row.asset_id), []);
      const list = result.get(Number(row.asset_id));
      if (list.length >= 6) continue;
      list.push({
        id: row.id,
        asset_id: row.asset_id,
        evidence_type: row.evidence_type,
        file_name: row.file_name,
        mime_type: row.mime_type,
        caption: row.caption,
        is_primary: Boolean(row.is_primary),
        sort_order: Number(row.sort_order || 0),
        captured_at: row.captured_at,
        file_url: signedImageUrl(req, row.asset_id, row.id),
      });
    }
    return result;
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
      return new Map();
    }
    throw error;
  }
}

async function loadMachines(req) {
  const connection = await acquireConnection();
  try {
    const [assets] = await query(
      connection,
      `SELECT asset.id, asset.asset_code, asset.asset_name, asset.asset_type,
              asset.equipment_category, asset.make, asset.model, asset.model_year,
              asset.serial_number, asset.chassis_number, asset.engine_number,
              asset.registration_number, asset.colour, asset.capacity_description,
              asset.condition_status, asset.ownership_type, asset.operational_purpose,
              asset.current_status, asset.sale_status, asset.current_location,
              asset.hire_location_id, asset.meter_type, asset.current_meter,
              asset.fuel_type, asset.insurance_expiry, asset.registration_expiry,
              asset.acquisition_date, asset.acquisition_cost,
              asset.target_selling_price, asset.minimum_selling_price,
              asset.supplier_name, asset.acquisition_reference,
              asset.customs_reference, asset.title_document_reference,
              asset.insurance_reference, asset.notes, asset.is_active,
              asset.updated_at, location.name AS location_name,
              CASE WHEN asset.main_image_url IS NULL OR asset.main_image_url = '' THEN 0 ELSE 1 END AS has_legacy_image,
              (SELECT COUNT(*) FROM equipment_credit_applications application
                WHERE application.asset_id = asset.id
                  AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')) AS active_application_count,
              (SELECT application.id FROM equipment_credit_applications application
                WHERE application.asset_id = asset.id
                  AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')
                ORDER BY application.id DESC LIMIT 1) AS blocking_application_id,
              (SELECT application.application_number FROM equipment_credit_applications application
                WHERE application.asset_id = asset.id
                  AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')
                ORDER BY application.id DESC LIMIT 1) AS blocking_application_number,
              (SELECT COUNT(*) FROM equipment_asset_sale_locks sale_lock
                WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL) AS active_sale_lock_count,
              (SELECT agreement.agreement_number
                 FROM equipment_asset_sale_locks sale_lock
                 INNER JOIN equipment_sale_agreements agreement ON agreement.id = sale_lock.agreement_id
                WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL
                ORDER BY sale_lock.locked_at DESC LIMIT 1) AS blocking_agreement_number,
              (SELECT COUNT(*) FROM hire_contract_assets hire_asset
                WHERE hire_asset.asset_id = asset.id
                  AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count
         FROM fleet_assets asset
         LEFT JOIN business_locations location ON location.id = asset.hire_location_id
        WHERE asset.is_active = TRUE
        ORDER BY asset.id DESC
        LIMIT ?`,
      [MACHINE_LIMIT]
    );

    const ids = assets.map((asset) => Number(asset.id)).filter(Boolean);
    const mediaByAsset = await loadMachineMedia(connection, ids, req);

    return assets.map((asset) => {
      const media = mediaByAsset.get(Number(asset.id)) || [];
      const primary = media.find((item) => item.is_primary) || media[0] || null;
      const photoCount = media.length;
      const machine = {
        ...asset,
        is_active: Boolean(Number(asset.is_active ?? 1)),
        has_legacy_image: Boolean(Number(asset.has_legacy_image || 0)),
        active_application_count: Number(asset.active_application_count || 0),
        active_sale_lock_count: Number(asset.active_sale_lock_count || 0),
        active_hire_count: Number(asset.active_hire_count || 0),
        acquisition_cost: Number(asset.acquisition_cost || 0),
        target_selling_price: Number(asset.target_selling_price || 0),
        minimum_selling_price: Number(asset.minimum_selling_price || 0),
        current_meter: Number(asset.current_meter || 0),
        photo_count: photoCount,
        media,
        main_image_url:
          primary?.file_url ||
          (asset.has_legacy_image ? signedImageUrl(req, asset.id, "legacy") : null),
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

async function loadLocations() {
  const connection = await acquireConnection();
  try {
    const [rows] = await query(
      connection,
      `SELECT id, name, code
         FROM business_locations
        WHERE is_active = TRUE
        ORDER BY name ASC
        LIMIT 200`
    );
    return rows;
  } finally {
    connection.release();
  }
}

function fallbackSettings() {
  return {
    currency: "GHS",
    minimum_deposit_percent: 0,
    default_payment_frequency: "monthly",
    default_first_due_days: 30,
    maximum_term_months: 120,
    maximum_installment_count: 520,
    delivery_policy: "after_deposit",
    compatibility_mode: true,
  };
}

router.get(
  "/phase-one/bootstrap",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    const [customerResult, machineResult] = await Promise.allSettled([
      loadCustomers(),
      loadMachines(req),
    ]);
    const customers = customerResult.status === "fulfilled" ? customerResult.value : [];
    const machines = machineResult.status === "fulfilled" ? machineResult.value : [];
    const failures = [
      customerResult.status === "rejected" ? "customers" : null,
      machineResult.status === "rejected" ? "excavators" : null,
    ].filter(Boolean);

    if (customerResult.status === "rejected") {
      console.error("Critical Finance customer bootstrap degraded:", customerResult.reason);
    }
    if (machineResult.status === "rejected") {
      console.error("Critical Finance machine bootstrap degraded:", machineResult.reason);
    }

    return res.json({
      status: failures.length ? "degraded" : "success",
      message: failures.length
        ? `The ${failures.join(" and ")} list could not finish, but the installment screen was released for use.`
        : "Finance customer and excavator lists loaded.",
      customers,
      machines,
      settings: fallbackSettings(),
      settings_readiness: {
        ready: true,
        degraded: failures.length > 0,
        compatibility_mode: true,
      },
      policy: {
        scope: "company_wide",
        hire_location_id: null,
        hire_location_selection_required: false,
        installment_offer_created_automatically: true,
        exact_schedule_preview_enabled: true,
        optional_draft_kyc_and_affordability: true,
        list_contains_image_bytes: false,
        signed_machine_images: true,
        bootstrap_row_limit: MACHINE_LIMIT,
      },
    });
  }
);

router.get(
  "/professional/machine-register/locations",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      return res.json({ status: "success", locations: await loadLocations() });
    } catch (error) {
      console.error("Critical Finance location list degraded:", error);
      return res.json({
        status: "degraded",
        message: "Equipment yards could not be loaded, but the machine register remains available.",
        locations: [],
      });
    }
  }
);

router.get("/phase-one/machine-image/:assetId/:photoId", async (req, res) => {
  const assetId = positiveId(req.params.assetId);
  const photoId = req.params.photoId === "legacy" ? "legacy" : positiveId(req.params.photoId);
  if (!assetId || !photoId || !verifyImageSignature(
    assetId,
    photoId,
    req.query.expires,
    req.query.signature
  )) {
    return res.status(403).json({
      status: "error",
      code: "FINANCE_MACHINE_IMAGE_SIGNATURE_INVALID",
      message: "This protected excavator image link is invalid or expired.",
    });
  }

  const connection = await acquireConnection();
  try {
    let imageValue = null;
    if (photoId === "legacy") {
      const [rows] = await query(
        connection,
        "SELECT main_image_url FROM fleet_assets WHERE id = ? LIMIT 1",
        [assetId]
      );
      imageValue = rows[0]?.main_image_url || null;
    } else {
      const [rows] = await query(
        connection,
        `SELECT file_url
           FROM equipment_media
          WHERE id = ? AND asset_id = ? AND archived_at IS NULL
          LIMIT 1`,
        [photoId, assetId]
      );
      imageValue = rows[0]?.file_url || null;
    }
    const image = dataImage(imageValue);
    if (!image) {
      return res.status(404).json({
        status: "error",
        code: "FINANCE_MACHINE_IMAGE_NOT_FOUND",
        message: "The protected excavator image could not be read.",
      });
    }
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("Content-Length", String(image.buffer.length));
    res.setHeader("Cache-Control", "private, max-age=1800");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(image.buffer);
  } catch (error) {
    console.error("Could not serve signed Finance machine image:", error);
    return res.status(503).json({
      status: "error",
      code: "FINANCE_MACHINE_IMAGE_UNAVAILABLE",
      message: "The excavator image is temporarily unavailable.",
    });
  } finally {
    connection.release();
  }
});

async function applicationReadiness() {
  let connection;
  try {
    connection = await acquireConnection();
    return await inspectFinanceApplicationSchema(connection, {
      queryTimeoutMs: QUERY_TIMEOUT_MS,
    });
  } catch (error) {
    const failure = classifyFinanceDatabaseError(error);
    return {
      ready: false,
      checked_at: new Date().toISOString(),
      scope: "company_wide",
      hire_location_selection_required: false,
      critical_read_path: true,
      diagnostic_unavailable: true,
      code: failure.code,
      operator_message: failure.operator_message,
      database_error_code: cleanText(error?.code, 80) || null,
      missing_tables: [],
      missing_columns: [],
      invalid_nullability: [],
      invalid_enums: [],
      capabilities: {
        window_functions_supported: null,
        register_query_compiles: null,
      },
    };
  } finally {
    connection?.release();
  }
}

router.get(
  "/credit-applications/readiness",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    const readiness = await applicationReadiness();
    return res.status(200).json({
      status: readiness.ready ? "success" : "degraded",
      request_id: req.requestId || null,
      operator_message: readiness.operator_message,
      readiness: {
        ...readiness,
        request_id: req.requestId || null,
      },
    });
  }
);

router.get(
  "/credit-applications",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    let connection;
    try {
      const requestedPage = positiveInteger(req.query.page, 1);
      const pageSize = positiveInteger(
        req.query.page_size,
        APPLICATION_PAGE_SIZE,
        MAX_APPLICATION_PAGE_SIZE
      );
      const status = normalizedStatus(req.query.status);
      const search = cleanText(req.query.search, 150);
      const dateFrom = dateOnly(req.query.date_from);
      const dateTo = dateOnly(req.query.date_to);
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new CriticalFinanceError(
          400,
          "The from date cannot be after the to date.",
          "INVALID_FINANCE_APPLICATION_DATE_RANGE"
        );
      }

      const where = ["1 = 1"];
      const params = [];
      if (status) {
        where.push("application.application_status = ?");
        params.push(status);
      }
      if (search) {
        where.push(`(
          application.application_number LIKE ? OR
          customer.customer_name LIKE ? OR customer.phone LIKE ? OR
          quotation.quotation_number LIKE ? OR
          asset.asset_code LIKE ? OR asset.asset_name LIKE ?
        )`);
        const like = `%${search}%`;
        params.push(like, like, like, like, like, like);
      }
      if (dateFrom) {
        where.push("application.application_date >= ?");
        params.push(dateFrom);
      }
      if (dateTo) {
        where.push("application.application_date <= ?");
        params.push(dateTo);
      }

      const offset = (requestedPage - 1) * pageSize;
      connection = await acquireConnection();
      const [rows] = await query(
        connection,
        `SELECT application.id, application.application_number,
                application.application_date, application.application_status,
                application.kyc_status, application.affordability_status,
                application.risk_band, application.risk_score,
                application.quoted_total, application.proposed_deposit,
                application.financed_amount, application.proposed_frequency,
                application.proposed_interval_days,
                application.proposed_installment_count,
                application.proposed_installment_amount,
                application.decision_version, application.submitted_at,
                application.reviewed_at, application.created_at,
                application.updated_at,
                customer.id AS customer_id,
                customer.customer_name, customer.phone AS customer_phone,
                quotation.id AS quotation_id, quotation.quotation_number,
                quotation.status AS quotation_status,
                asset.id AS asset_id, asset.asset_code, asset.asset_name,
                asset.make, asset.model,
                0 AS has_image,
                NULL AS equipment_origin_name,
                COUNT(*) OVER() AS total_count,
                SUM(CASE WHEN application.application_status IN ('draft','changes_requested') THEN 1 ELSE 0 END) OVER() AS summary_drafts,
                SUM(CASE WHEN application.application_status IN ('submitted','under_review') THEN 1 ELSE 0 END) OVER() AS summary_review,
                SUM(CASE WHEN application.application_status = 'approved' THEN 1 ELSE 0 END) OVER() AS summary_approved,
                SUM(CASE WHEN application.application_status IN ('draft','submitted','under_review','changes_requested','approved')
                         THEN COALESCE(application.financed_amount, 0) ELSE 0 END) OVER() AS summary_exposure
           FROM equipment_credit_applications application
           INNER JOIN hire_customers customer ON customer.id = application.customer_id
           INNER JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
           INNER JOIN fleet_assets asset ON asset.id = application.asset_id
          WHERE ${where.join(" AND ")}
          ORDER BY application.id DESC
          LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      const total = Number(rows[0]?.total_count || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const applications = rows.map((row) => {
        const output = { ...row };
        delete output.total_count;
        delete output.summary_drafts;
        delete output.summary_review;
        delete output.summary_approved;
        delete output.summary_exposure;
        return output;
      });
      return res.json({
        status: "success",
        request_id: req.requestId || null,
        applications,
        pagination: {
          page: requestedPage,
          page_size: pageSize,
          total,
          total_pages: totalPages,
        },
        summary: {
          drafts: Number(rows[0]?.summary_drafts || 0),
          awaiting_review: Number(rows[0]?.summary_review || 0),
          approved: Number(rows[0]?.summary_approved || 0),
          proposed_exposure: Number(rows[0]?.summary_exposure || 0),
        },
        policy: {
          scope: "company_wide",
          hire_location_selection_required: false,
          list_contains_image_bytes: false,
          critical_read_path: true,
          empty_results_are_never_substituted_for_errors: true,
        },
      });
    } catch (error) {
      if (error instanceof CriticalFinanceError && error.statusCode < 500) {
        return res.status(error.statusCode).json({
          status: "error",
          code: error.code,
          message: error.message,
          request_id: req.requestId || null,
        });
      }

      if (connection) {
        connection.release();
        connection = null;
      }
      const readiness = await applicationReadiness();
      const failure = classifyFinanceDatabaseError(error, readiness);
      console.error("Critical Finance application register failed:", {
        request_id: req.requestId || null,
        code: error?.code || null,
        errno: error?.errno || null,
        sql_state: error?.sqlState || null,
        message: error?.message || null,
        classified_as: failure.code,
      });
      return res.status(503).json({
        status: "error",
        code: failure.code,
        message: "Finance application register unavailable.",
        operator_message: failure.operator_message,
        request_id: req.requestId || null,
        retryable: true,
        readiness: {
          ...readiness,
          request_id: req.requestId || null,
          failure_code: cleanText(error?.code, 80) || null,
        },
      });
    } finally {
      connection?.release();
    }
  }
);

module.exports = router;
module.exports.acquireConnection = acquireConnection;
module.exports.applicationReadiness = applicationReadiness;
module.exports.dataImage = dataImage;
module.exports.imageSignature = imageSignature;
module.exports.loadCustomers = loadCustomers;
module.exports.loadMachines = loadMachines;
module.exports.verifyImageSignature = verifyImageSignature;
