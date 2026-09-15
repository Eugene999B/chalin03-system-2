const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  ensureWorkerIdentitySchema,
  normalizeEmployeePrefix,
  normalizeValidityMonths,
} = require("../services/workerIdentityService");
const {
  branchIdForUser,
  getUserSettingsSystemAdminOnly,
  isOriginalSystemAdministrator,
} = require("../services/sparePartsUserSettingsAccessService");

const router = express.Router();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function cleanBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function nullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function toNonNegativeNumber(value) {
  const number = Number(value);

  if (Number.isNaN(number) || number < 0) {
    return null;
  }

  return Number(number.toFixed(2));
}

function toPositiveInt(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

async function logActivity(userId, branchId, action, details) {
  await pool.query(
    `INSERT INTO activity_log (branch_id, user_id, action, details)
     VALUES (?, ?, ?, ?)`,
    [branchId || null, userId || null, action, details]
  );
}

async function getBranch(branchId) {
  const [branches] = await pool.query(
    `SELECT id, code, name, location
     FROM branches
     WHERE id = ?
     LIMIT 1`,
    [branchId]
  );

  return branches[0] || null;
}

async function createDefaultSettingsForBranch(branchId) {
  await ensureWorkerIdentitySchema();
  const branch = await getBranch(branchId);

  const branchName = branch?.name || "Chalin 03 Store";
  const branchLocation = branch?.location || "Dunkwa Police Barrier";
  const branchCode = branch?.code || "CHL";

  const [result] = await pool.query(
    `INSERT INTO settings (
      branch_id,
      branch_name,
      business_name,
      business_address,
      business_phone,
      owner_phone,
      tax_rate,
      debt_reminder_days,
      daily_summary_time,
      receipt_footer,
      receipt_prefix
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      branchId,
      branchName,
      "Chalin 03 Company Limited",
      branchLocation,
      "0249469080 / 0249995510",
      "0543421127",
      0,
      7,
      "18:00:00",
      "Thank You For Coming",
      branchCode,
    ]
  );

  return result.insertId;
}

async function getSettingsForBranch(branchId) {
  await ensureWorkerIdentitySchema();
  let [settingsRows] = await pool.query(
    `SELECT
      s.*,
      b.code AS branch_code,
      b.name AS store_name,
      b.location AS store_location
     FROM settings s
     LEFT JOIN branches b ON s.branch_id = b.id
     WHERE s.branch_id = ?
     ORDER BY s.id DESC
     LIMIT 1`,
    [branchId]
  );

  if (settingsRows.length === 0) {
    await createDefaultSettingsForBranch(branchId);

    [settingsRows] = await pool.query(
      `SELECT
        s.*,
        b.code AS branch_code,
        b.name AS store_name,
        b.location AS store_location
       FROM settings s
       LEFT JOIN branches b ON s.branch_id = b.id
       WHERE s.branch_id = ?
       ORDER BY s.id DESC
       LIMIT 1`,
      [branchId]
    );
  }

  return settingsRows[0] || null;
}

// GET /api/settings
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const settings = await getSettingsForBranch(branchId);

    if (!settings) {
      return res.status(404).json({
        status: "error",
        message: "Settings record not found for the selected store.",
      });
    }

    return res.json({
      status: "success",
      branch_id: branchId,
      settings,
    });
  } catch (error) {
    console.error("Get settings error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching settings.",
    });
  }
});

// GET /api/settings/user-settings-access
router.get(
  "/user-settings-access",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const branchId = branchIdForUser(req.user);
      const settings = await getSettingsForBranch(branchId);
      const systemAdminOnly = await getUserSettingsSystemAdminOnly(branchId);

      return res.json({
        status: "success",
        branch_id: branchId,
        user_settings_system_admin_only: systemAdminOnly,
        can_manage_access_control: isOriginalSystemAdministrator(req.user),
        can_access_user_settings:
          isOriginalSystemAdministrator(req.user) || !systemAdminOnly,
        settings_id: Number(settings?.id || 0) || null,
      });
    } catch (error) {
      console.error("Get User Settings access control error:", error);
      return res.status(500).json({
        status: "error",
        message: "User Settings access control could not be loaded.",
      });
    }
  }
);

// PATCH /api/settings/user-settings-access
router.patch(
  "/user-settings-access",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      if (!isOriginalSystemAdministrator(req.user)) {
        return res.status(403).json({
          status: "error",
          code: "SPARE_PARTS_USER_SETTINGS_ACCESS_CONTROL_SYSTEM_ADMIN_ONLY",
          message:
            "Only the System Administrator can change this User Settings access control.",
        });
      }

      const branchId = branchIdForUser(req.user);
      const settings = await getSettingsForBranch(branchId);
      const enabled = cleanBoolean(req.body?.user_settings_system_admin_only);

      await pool.query(
        `UPDATE settings
            SET user_settings_system_admin_only = ?
          WHERE id = ?
            AND branch_id = ?`,
        [enabled ? 1 : 0, Number(settings.id), branchId]
      );

      await logActivity(
        req.user.id,
        branchId,
        "UPDATE_SPARE_PARTS_USER_SETTINGS_ACCESS_CONTROL",
        enabled
          ? "Restricted Spare Parts User Settings access to the System Administrator."
          : "Restored Spare Parts User Settings access to other administrators."
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        user_settings_system_admin_only: enabled,
        message: enabled
          ? "User Settings are now restricted to the System Administrator."
          : "User Settings are now available to other administrators.",
      });
    } catch (error) {
      console.error("Update User Settings access control error:", error);
      return res.status(500).json({
        status: "error",
        message: "User Settings access control could not be updated.",
      });
    }
  }
);

// PUT /api/settings
router.put("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const branchId = getBranchId(req);

    const {
      branch_name,
      business_name,
      business_address,
      business_phone,
      owner_phone,
      tax_rate,
      debt_reminder_days,
      daily_summary_time,
      receipt_footer,
      receipt_prefix,
      worker_id_card_validity_months,
      worker_employee_number_prefix,
    } = req.body;

    const cleanBusinessName = cleanText(business_name);
    const cleanBranchName = cleanText(branch_name);

    if (!cleanBusinessName) {
      return res.status(400).json({
        status: "error",
        message: "Business name is required.",
      });
    }

    const taxRate = toNonNegativeNumber(tax_rate ?? 0);
    const reminderDays = toPositiveInt(Number(debt_reminder_days ?? 7));
    const cardValidityMonths = normalizeValidityMonths(
      Number(worker_id_card_validity_months ?? 24)
    );
    const employeeNumberPrefix = normalizeEmployeePrefix(
      worker_employee_number_prefix
    );

    if (taxRate === null) {
      return res.status(400).json({
        status: "error",
        message: "Tax rate must be a valid number.",
      });
    }

    if (reminderDays === null) {
      return res.status(400).json({
        status: "error",
        message: "Debt reminder days must be a positive whole number.",
      });
    }

    let [settingsRows] = await pool.query(
      `SELECT id
       FROM settings
       WHERE branch_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [branchId]
    );

    if (settingsRows.length === 0) {
      await createDefaultSettingsForBranch(branchId);

      [settingsRows] = await pool.query(
        `SELECT id
         FROM settings
         WHERE branch_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [branchId]
      );
    }

    const settingsId = settingsRows[0].id;

    await pool.query(
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
       WHERE id = ?
       AND branch_id = ?`,
      [
        cleanBranchName || null,
        cleanBusinessName,
        nullableText(business_address),
        nullableText(business_phone),
        nullableText(owner_phone),
        taxRate,
        reminderDays,
        daily_summary_time || "18:00:00",
        nullableText(receipt_footer),
        nullableText(receipt_prefix),
        cardValidityMonths,
        employeeNumberPrefix,
        settingsId,
        branchId,
      ]
    );

    // Worker identity rules are group-wide so every workspace generates consistent cards.
    await pool.query(
      `UPDATE settings
       SET worker_id_card_validity_months = ?,
           worker_employee_number_prefix = ?`,
      [cardValidityMonths, employeeNumberPrefix]
    );

    /*
      Keep the store name/address in the branches table close to the settings.
      This helps the login store selector and receipt header stay consistent.
    */
    if (cleanBranchName || cleanText(business_address)) {
      await pool.query(
        `UPDATE branches
         SET name = COALESCE(?, name),
             location = COALESCE(?, location)
         WHERE id = ?`,
        [
          cleanBranchName || null,
          nullableText(business_address),
          branchId,
        ]
      );
    }

    await logActivity(
      req.user.id,
      branchId,
      "UPDATE_SETTINGS",
      "Updated selected store settings"
    );

    const updatedSettings = await getSettingsForBranch(branchId);

    return res.json({
      status: "success",
      branch_id: branchId,
      message: "Settings updated successfully.",
      settings: updatedSettings,
    });
  } catch (error) {
    console.error("Update settings error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while updating settings.",
    });
  }
});

module.exports = router;
