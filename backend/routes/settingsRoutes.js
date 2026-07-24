const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  ensureWorkerIdentitySchema,
  normalizeEmployeePrefix,
  normalizeValidityMonths,
} = require("../services/workerIdentityService");

const router = express.Router();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 0);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Number(number.toFixed(2));
}

function toPositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeTime(value, fallback = "18:00:00") {
  const text = cleanText(value, 8);
  if (!text) return fallback;
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text)) return null;
  return text.length === 5 ? `${text}:00` : text;
}

async function loadBranch(connection, branchId, lock = false) {
  const [rows] = await connection.query(
    `SELECT id, code, branch_code, name, location, phone, is_active
     FROM branches
     WHERE id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [branchId]
  );
  return rows[0] || null;
}

async function loadSettings(connection, branchId, lock = false) {
  const [rows] = await connection.query(
    `SELECT
       s.*,
       b.code AS branch_code,
       b.name AS store_name,
       b.location AS store_location
     FROM settings s
     LEFT JOIN branches b ON b.id = s.branch_id
     WHERE s.branch_id = ?
     ORDER BY s.id DESC
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [branchId]
  );
  return rows[0] || null;
}

function sendSettingsError(res, error, fallbackMessage) {
  if (
    [
      "WORKER_IDENTITY_SCHEMA_NOT_READY",
      "BRANCH_SCHEMA_NOT_READY",
    ].includes(error?.code)
  ) {
    return res.status(503).json({
      status: "error",
      code: error.code,
      message:
        "Store settings are unavailable because the approved database migration is incomplete.",
      missing_tables: error.missingTables || [],
      missing_columns: error.missingColumns || [],
    });
  }

  return res.status(Number(error?.statusCode || 500)).json({
    status: "error",
    code: error?.code || "SETTINGS_OPERATION_FAILED",
    message:
      Number(error?.statusCode || 500) < 500
        ? error.message
        : fallbackMessage,
  });
}

// GET /api/settings
// Deliberately read-only. Missing settings are reported instead of being seeded
// by opening this page.
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const branchId = getBranchId(req);
    if (!branchId) {
      return res.status(400).json({
        status: "error",
        code: "VALID_BRANCH_REQUIRED",
        message: "Choose a valid Spare Parts store before loading settings.",
      });
    }

    await ensureWorkerIdentitySchema(pool);
    const settings = await loadSettings(pool, branchId);
    if (!settings) {
      return res.status(404).json({
        status: "error",
        code: "STORE_SETTINGS_NOT_CONFIGURED",
        message:
          "Settings have not been configured for this store. Save the settings form once as an Administrator to create them explicitly.",
      });
    }

    return res.json({
      status: "success",
      branch_id: branchId,
      settings,
    });
  } catch (error) {
    console.error("Get settings error:", {
      code: error?.code,
      message: error?.message,
      missing_tables: error?.missingTables,
      missing_columns: error?.missingColumns,
    });
    return sendSettingsError(
      res,
      error,
      "Something went wrong while fetching settings."
    );
  }
});

// PUT /api/settings
// Creating a missing row is allowed only as this explicit Administrator write.
router.put("/", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    const branchId = getBranchId(req);
    if (!branchId) {
      return res.status(400).json({
        status: "error",
        code: "VALID_BRANCH_REQUIRED",
        message: "Choose a valid Spare Parts store before saving settings.",
      });
    }

    const cleanBusinessName = cleanText(req.body.business_name, 150);
    const cleanBranchName = cleanText(req.body.branch_name, 150);
    const businessAddress = nullableText(req.body.business_address, 255);
    const businessPhone = nullableText(req.body.business_phone, 80);
    const ownerPhone = nullableText(req.body.owner_phone, 80);
    const receiptFooter = nullableText(req.body.receipt_footer, 500);
    const receiptPrefix = nullableText(req.body.receipt_prefix, 30);
    const taxRate = toNonNegativeNumber(req.body.tax_rate ?? 0);
    const reminderDays = toPositiveInt(req.body.debt_reminder_days ?? 7);
    const dailySummaryTime = normalizeTime(req.body.daily_summary_time);
    const cardValidityMonths = normalizeValidityMonths(
      Number(req.body.worker_id_card_validity_months ?? 24)
    );
    const employeeNumberPrefix = normalizeEmployeePrefix(
      req.body.worker_employee_number_prefix
    );

    if (!cleanBusinessName) {
      return res.status(400).json({
        status: "error",
        code: "BUSINESS_NAME_REQUIRED",
        message: "Business name is required.",
      });
    }
    if (taxRate === null) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_TAX_RATE",
        message: "Tax rate must be a non-negative number.",
      });
    }
    if (reminderDays === null) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_DEBT_REMINDER_DAYS",
        message: "Debt reminder days must be a positive whole number.",
      });
    }
    if (!dailySummaryTime) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_DAILY_SUMMARY_TIME",
        message: "Daily summary time must use a valid 24-hour time.",
      });
    }

    await ensureWorkerIdentitySchema(connection);
    await connection.beginTransaction();
    transactionStarted = true;

    const branch = await loadBranch(connection, branchId, true);
    if (!branch || !Number(branch.is_active)) {
      const error = new Error("The selected active store was not found.");
      error.code = "ACTIVE_BRANCH_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    let settings = await loadSettings(connection, branchId, true);
    if (!settings) {
      const [result] = await connection.query(
        `INSERT INTO settings (
           branch_id, branch_name, business_name, business_address,
           business_phone, owner_phone, tax_rate, debt_reminder_days,
           daily_summary_time, receipt_footer, receipt_prefix,
           worker_id_card_validity_months, worker_employee_number_prefix
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          cleanBranchName || branch.name,
          cleanBusinessName,
          businessAddress || branch.location || null,
          businessPhone || branch.phone || null,
          ownerPhone,
          taxRate,
          reminderDays,
          dailySummaryTime,
          receiptFooter,
          receiptPrefix || branch.code || branch.branch_code || "CHL",
          cardValidityMonths,
          employeeNumberPrefix,
        ]
      );
      settings = { id: result.insertId };
    } else {
      await connection.query(
        `UPDATE settings
         SET branch_name = ?,
             business_name = ?,
             business_address = ?,
             business_phone = ?,
             owner_phone = ?,
             tax_rate = ?,
             debt_reminder_days = ?,
             daily_summary_time = ?,
             receipt_footer = ?,
             receipt_prefix = ?,
             worker_id_card_validity_months = ?,
             worker_employee_number_prefix = ?
         WHERE id = ? AND branch_id = ?`,
        [
          cleanBranchName || branch.name,
          cleanBusinessName,
          businessAddress,
          businessPhone,
          ownerPhone,
          taxRate,
          reminderDays,
          dailySummaryTime,
          receiptFooter,
          receiptPrefix,
          cardValidityMonths,
          employeeNumberPrefix,
          settings.id,
          branchId,
        ]
      );
    }

    // Worker identity rules are group-wide and are changed only by this explicit
    // Administrator action, never by a settings read.
    await connection.query(
      `UPDATE settings
       SET worker_id_card_validity_months = ?,
           worker_employee_number_prefix = ?`,
      [cardValidityMonths, employeeNumberPrefix]
    );

    if (cleanBranchName || businessAddress) {
      await connection.query(
        `UPDATE branches
         SET name = COALESCE(?, name),
             location = COALESCE(?, location)
         WHERE id = ?`,
        [cleanBranchName || null, businessAddress, branchId]
      );
    }

    await writeAuditEvent({
      connection,
      req,
      action: "UPDATE_SETTINGS",
      actionType: "settings.store.updated",
      entityType: "settings",
      entityId: settings.id,
      workspaceCode: "spare_parts",
      branchId,
      severity: "notice",
      outcome: "success",
      details: "Updated selected store settings through an explicit Administrator action.",
      metadata: {
        worker_id_card_validity_months: cardValidityMonths,
        worker_employee_number_prefix: employeeNumberPrefix,
      },
    });

    await connection.commit();
    transactionStarted = false;

    const updatedSettings = await loadSettings(pool, branchId);
    return res.json({
      status: "success",
      branch_id: branchId,
      message: "Settings updated successfully.",
      settings: updatedSettings,
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original settings failure.
      }
    }
    console.error("Update settings error:", {
      code: error?.code,
      message: error?.message,
      missing_tables: error?.missingTables,
      missing_columns: error?.missingColumns,
    });
    return sendSettingsError(
      res,
      error,
      "Something went wrong while updating settings."
    );
  } finally {
    connection.release();
  }
});

module.exports = router;
