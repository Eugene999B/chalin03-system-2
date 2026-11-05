const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");

const router = express.Router();

const APPLICATION_STATUSES = new Set([
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "declined",
  "withdrawn",
]);
const ACTIVE_EXPOSURE_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
];
const REQUIRED_COLUMNS = Object.freeze({
  equipment_credit_applications: [
    "id",
    "application_number",
    "customer_id",
    "quotation_id",
    "asset_id",
    "application_status",
  ],
  equipment_credit_application_kyc: ["application_id"],
  equipment_credit_application_decisions: ["application_id"],
  hire_customers: ["id", "customer_name"],
  equipment_sales_quotations: ["id"],
  fleet_assets: ["id", "asset_code", "asset_name"],
});
const MAX_PAGE_SIZE = 100;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

class FinanceApplicationReadError extends Error {
  constructor(statusCode, message, code, readiness = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.readiness = readiness;
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
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizedStatus(value) {
  const status = cleanText(value, 50).toLowerCase().replace(/[\s-]+/g, "_");
  if (!status || status === "all") return null;
  if (!APPLICATION_STATUSES.has(status)) {
    throw new FinanceApplicationReadError(
      400,
      "Choose a valid installment application status.",
      "INVALID_FINANCE_APPLICATION_STATUS"
    );
  }
  return status;
}

function dateOnly(value, fieldLabel) {
  const text = cleanText(value, 20);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new FinanceApplicationReadError(
      400,
      `Choose a valid ${fieldLabel} date.`,
      "INVALID_FINANCE_APPLICATION_DATE_FILTER"
    );
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new FinanceApplicationReadError(
      400,
      `Choose a valid ${fieldLabel} date.`,
      "INVALID_FINANCE_APPLICATION_DATE_FILTER"
    );
  }
  return text;
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function columnExpression(columns, alias, column, fallback = "NULL", output = column) {
  return columns.has(column)
    ? `${alias}.\`${column}\` AS \`${output}\``
    : `${fallback} AS \`${output}\``;
}

async function inspectSchema(connection) {
  const tableNames = Object.keys(REQUIRED_COLUMNS);
  const [rows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders(tableNames)})`,
    tableNames
  );

  const columnsByTable = new Map(
    tableNames.map((tableName) => [tableName, new Set()])
  );
  for (const row of rows) {
    if (!columnsByTable.has(row.TABLE_NAME)) {
      columnsByTable.set(row.TABLE_NAME, new Set());
    }
    columnsByTable.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }

  const missingTables = tableNames.filter(
    (tableName) => (columnsByTable.get(tableName) || new Set()).size === 0
  );
  const missingColumns = [];
  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    if (missingTables.includes(tableName)) continue;
    const actual = columnsByTable.get(tableName) || new Set();
    for (const column of requiredColumns) {
      if (!actual.has(column)) missingColumns.push(`${tableName}.${column}`);
    }
  }

  return {
    columnsByTable,
    readiness: {
      ready: missingTables.length === 0 && missingColumns.length === 0,
      missing_tables: missingTables,
      missing_columns: missingColumns,
      scope: "company_wide",
      hire_location_selection_required: false,
    },
  };
}

function assertReady(schema) {
  if (schema.readiness.ready) return;
  throw new FinanceApplicationReadError(
    503,
    "The installment application register is not ready on this database revision.",
    "EQUIPMENT_CREDIT_FOUNDATION_REQUIRED",
    schema.readiness
  );
}

function imageFromDataUrl(value) {
  const match = String(value || "").match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
  return { mimeType, buffer };
}

async function optionalTableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function loadApplicationImage(connection, applicationId, schema) {
  const assetColumns = schema.columnsByTable.get("fleet_assets") || new Set();
  const mainImageExpression = assetColumns.has("main_image_url")
    ? "asset.main_image_url"
    : "NULL";
  const [rows] = await connection.query(
    `SELECT application.asset_id, ${mainImageExpression} AS image_data
       FROM equipment_credit_applications application
       INNER JOIN fleet_assets asset ON asset.id = application.asset_id
      WHERE application.id = ?
      LIMIT 1`,
    [applicationId]
  );
  const application = rows[0];
  if (!application) {
    throw new FinanceApplicationReadError(
      404,
      "Installment application was not found.",
      "FINANCE_APPLICATION_NOT_FOUND"
    );
  }

  let image = imageFromDataUrl(application.image_data);
  if (image) return image;

  const mediaColumns = await optionalTableColumns(connection, "equipment_media");
  if (!mediaColumns.has("asset_id") || !mediaColumns.has("file_url")) return null;

  const where = ["asset_id = ?"];
  if (mediaColumns.has("archived_at")) where.push("archived_at IS NULL");
  if (mediaColumns.has("media_category")) where.push("media_category = 'photo'");
  const order = [
    mediaColumns.has("is_primary") ? "is_primary DESC" : null,
    mediaColumns.has("sort_order") ? "sort_order ASC" : null,
    mediaColumns.has("id") ? "id DESC" : null,
  ].filter(Boolean);
  const [mediaRows] = await connection.query(
    `SELECT file_url
       FROM equipment_media
      WHERE ${where.join(" AND ")}
      ${order.length ? `ORDER BY ${order.join(", ")}` : ""}
      LIMIT 1`,
    [application.asset_id]
  );
  image = imageFromDataUrl(mediaRows[0]?.file_url);
  return image;
}

function sendError(res, error, fallbackMessage) {
  if (error instanceof FinanceApplicationReadError) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code,
      message: error.message,
      ...(error.readiness ? { readiness: error.readiness } : {}),
    });
  }
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_CREDIT_FOUNDATION_REQUIRED",
      message: "The installment application register is not ready on this database revision.",
    });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({
    status: "error",
    code: "FINANCE_APPLICATION_READ_FAILED",
    message: fallbackMessage,
  });
}

router.get(
  "/readiness",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    const connection = await pool.getConnection();
    try {
      const schema = await inspectSchema(connection);
      return res.status(schema.readiness.ready ? 200 : 503).json({
        status: schema.readiness.ready ? "success" : "error",
        code: schema.readiness.ready
          ? undefined
          : "EQUIPMENT_CREDIT_FOUNDATION_REQUIRED",
        readiness: schema.readiness,
      });
    } catch (error) {
      return sendError(res, error, "Could not check installment application readiness.");
    } finally {
      connection.release();
    }
  }
);

router.get(
  "/:id/image",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    const applicationId = positiveId(req.params.id);
    if (!applicationId) {
      return sendError(
        res,
        new FinanceApplicationReadError(
          400,
          "Invalid installment application ID.",
          "INVALID_FINANCE_APPLICATION_ID"
        ),
        "Could not load the protected excavator image."
      );
    }

    const connection = await pool.getConnection();
    try {
      const schema = await inspectSchema(connection);
      assertReady(schema);
      const image = await loadApplicationImage(connection, applicationId, schema);
      if (!image) {
        throw new FinanceApplicationReadError(
          404,
          "No protected excavator image is available for this application.",
          "FINANCE_APPLICATION_IMAGE_NOT_FOUND"
        );
      }
      res.setHeader("Content-Type", image.mimeType);
      res.setHeader("Content-Length", String(image.buffer.length));
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(image.buffer);
    } catch (error) {
      return sendError(res, error, "Could not load the protected excavator image.");
    } finally {
      connection.release();
    }
  }
);

router.get("/", requirePermission("fleet.assets.view"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const schema = await inspectSchema(connection);
    assertReady(schema);

    const applicationColumns =
      schema.columnsByTable.get("equipment_credit_applications") || new Set();
    const customerColumns = schema.columnsByTable.get("hire_customers") || new Set();
    const quotationColumns =
      schema.columnsByTable.get("equipment_sales_quotations") || new Set();
    const assetColumns = schema.columnsByTable.get("fleet_assets") || new Set();
    const locationColumns = await optionalTableColumns(connection, "business_locations");

    const requestedPage = positiveInteger(req.query.page, 1);
    const pageSize = positiveInteger(req.query.page_size, 25, MAX_PAGE_SIZE);
    const status = normalizedStatus(req.query.status);
    const search = cleanText(req.query.search, 150);
    const dateFrom = dateOnly(req.query.date_from, "from");
    const dateTo = dateOnly(req.query.date_to, "to");
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new FinanceApplicationReadError(
        400,
        "The from date cannot be after the to date.",
        "INVALID_FINANCE_APPLICATION_DATE_RANGE"
      );
    }

    const canJoinLocation =
      applicationColumns.has("hire_location_id") &&
      locationColumns.has("id") &&
      locationColumns.has("name");
    const locationJoin = canJoinLocation
      ? "LEFT JOIN business_locations location ON location.id = application.hire_location_id"
      : "";
    const fromSql = `
      FROM equipment_credit_applications application
      INNER JOIN hire_customers customer ON customer.id = application.customer_id
      INNER JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
      INNER JOIN fleet_assets asset ON asset.id = application.asset_id
      ${locationJoin}`;

    const baseWhere = ["1 = 1"];
    const baseParams = [];
    if (search) {
      const searchable = [
        applicationColumns.has("application_number")
          ? "application.application_number"
          : null,
        customerColumns.has("customer_name") ? "customer.customer_name" : null,
        customerColumns.has("phone") ? "customer.phone" : null,
        quotationColumns.has("quotation_number")
          ? "quotation.quotation_number"
          : null,
        assetColumns.has("asset_code") ? "asset.asset_code" : null,
        assetColumns.has("asset_name") ? "asset.asset_name" : null,
      ].filter(Boolean);
      if (searchable.length) {
        baseWhere.push(`(${searchable.map((column) => `${column} LIKE ?`).join(" OR ")})`);
        baseParams.push(...searchable.map(() => `%${search}%`));
      }
    }

    const dateColumn = applicationColumns.has("application_date")
      ? "application.application_date"
      : applicationColumns.has("created_at")
        ? "application.created_at"
        : applicationColumns.has("updated_at")
          ? "application.updated_at"
          : null;
    if (dateFrom && dateColumn) {
      baseWhere.push(`DATE(${dateColumn}) >= ?`);
      baseParams.push(dateFrom);
    }
    if (dateTo && dateColumn) {
      baseWhere.push(`DATE(${dateColumn}) <= ?`);
      baseParams.push(dateTo);
    }

    const listWhere = [...baseWhere];
    const listParams = [...baseParams];
    if (status) {
      listWhere.push("application.application_status = ?");
      listParams.push(status);
    }

    const [countRows] = await connection.query(
      `SELECT COUNT(*) AS total
       ${fromSql}
       WHERE ${listWhere.join(" AND ")}`,
      listParams
    );
    const total = Number(countRows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;

    const financedExpression = applicationColumns.has("financed_amount")
      ? "COALESCE(application.financed_amount, 0)"
      : "0";
    const [summaryRows] = await connection.query(
      `SELECT
         SUM(CASE WHEN application.application_status IN ('draft','changes_requested') THEN 1 ELSE 0 END) AS drafts,
         SUM(CASE WHEN application.application_status IN ('submitted','under_review') THEN 1 ELSE 0 END) AS awaiting_review,
         SUM(CASE WHEN application.application_status = 'approved' THEN 1 ELSE 0 END) AS approved,
         COALESCE(SUM(CASE
           WHEN application.application_status IN (${placeholders(ACTIVE_EXPOSURE_STATUSES)})
           THEN ${financedExpression}
           ELSE 0
         END), 0) AS proposed_exposure
       ${fromSql}
       WHERE ${baseWhere.join(" AND ")}`,
      [...ACTIVE_EXPOSURE_STATUSES, ...baseParams]
    );

    const selected = [
      columnExpression(applicationColumns, "application", "id"),
      columnExpression(applicationColumns, "application", "application_number"),
      columnExpression(applicationColumns, "application", "application_date"),
      columnExpression(applicationColumns, "application", "application_status"),
      columnExpression(applicationColumns, "application", "kyc_status", "'not_assessed'"),
      columnExpression(
        applicationColumns,
        "application",
        "affordability_status",
        "'not_assessed'"
      ),
      columnExpression(applicationColumns, "application", "risk_band", "'not_assessed'"),
      columnExpression(applicationColumns, "application", "risk_score", "0"),
      columnExpression(applicationColumns, "application", "quoted_total", "0"),
      columnExpression(applicationColumns, "application", "proposed_deposit", "0"),
      columnExpression(applicationColumns, "application", "financed_amount", "0"),
      columnExpression(applicationColumns, "application", "proposed_frequency"),
      columnExpression(applicationColumns, "application", "proposed_interval_days"),
      columnExpression(applicationColumns, "application", "proposed_installment_count", "0"),
      columnExpression(applicationColumns, "application", "proposed_installment_amount", "0"),
      columnExpression(applicationColumns, "application", "decision_version", "0"),
      columnExpression(applicationColumns, "application", "submitted_at"),
      columnExpression(applicationColumns, "application", "reviewed_at"),
      columnExpression(applicationColumns, "application", "created_at"),
      columnExpression(applicationColumns, "application", "updated_at"),
      columnExpression(customerColumns, "customer", "customer_name"),
      columnExpression(customerColumns, "customer", "phone", "NULL", "customer_phone"),
      columnExpression(
        quotationColumns,
        "quotation",
        "quotation_number",
        "NULL"
      ),
      columnExpression(assetColumns, "asset", "asset_code"),
      columnExpression(assetColumns, "asset", "asset_name"),
      columnExpression(assetColumns, "asset", "make"),
      columnExpression(assetColumns, "asset", "model"),
      canJoinLocation
        ? "location.name AS equipment_origin_name"
        : assetColumns.has("current_location")
          ? "asset.current_location AS equipment_origin_name"
          : "NULL AS equipment_origin_name",
      applicationColumns.has("hire_location_id")
        ? "application.hire_location_id AS equipment_origin_location_id"
        : assetColumns.has("hire_location_id")
          ? "asset.hire_location_id AS equipment_origin_location_id"
          : "NULL AS equipment_origin_location_id",
    ];
    const orderBy = applicationColumns.has("updated_at")
      ? "application.updated_at DESC, application.id DESC"
      : applicationColumns.has("created_at")
        ? "application.created_at DESC, application.id DESC"
        : "application.id DESC";
    const [rows] = await connection.query(
      `SELECT ${selected.join(", ")}
       ${fromSql}
       WHERE ${listWhere.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...listParams, pageSize, offset]
    );

    const applications = rows.map((row) => ({
      ...row,
      risk_score: Number(row.risk_score || 0),
      quoted_total: Number(row.quoted_total || 0),
      proposed_deposit: Number(row.proposed_deposit || 0),
      financed_amount: Number(row.financed_amount || 0),
      proposed_interval_days: Number(row.proposed_interval_days || 0),
      proposed_installment_count: Number(row.proposed_installment_count || 0),
      proposed_installment_amount: Number(row.proposed_installment_amount || 0),
      decision_version: Number(row.decision_version || 0),
    }));
    const summary = summaryRows[0] || {};

    return res.json({
      status: "success",
      applications,
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: totalPages,
      },
      summary: {
        drafts: Number(summary.drafts || 0),
        awaiting_review: Number(summary.awaiting_review || 0),
        approved: Number(summary.approved || 0),
        proposed_exposure: Number(summary.proposed_exposure || 0),
      },
      policy: {
        scope: "company_wide",
        hire_location_selection_required: false,
        list_contains_image_bytes: false,
        protected_image_endpoint: "/credit-applications/:id/image",
      },
    });
  } catch (error) {
    return sendError(res, error, "Could not load Finance applications.");
  } finally {
    connection.release();
  }
});

module.exports = router;
module.exports.inspectSchema = inspectSchema;
module.exports.normalizedStatus = normalizedStatus;
