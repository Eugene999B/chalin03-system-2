const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

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

async function logActivity(userId, action, details) {
  await pool.query(
    `INSERT INTO activity_log (user_id, action, details)
     VALUES (?, ?, ?)`,
    [userId || null, action, details]
  );
}

// GET /api/settings
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const [settingsRows] = await pool.query(
      `SELECT *
       FROM settings
       ORDER BY id ASC
       LIMIT 1`
    );

    if (settingsRows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Settings record not found.",
      });
    }

    return res.json({
      status: "success",
      settings: settingsRows[0],
    });
  } catch (error) {
    console.error("Get settings error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching settings.",
    });
  }
});

// PUT /api/settings
router.put("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const {
      business_name,
      business_address,
      business_phone,
      owner_phone,
      tax_rate,
      debt_reminder_days,
      daily_summary_time,
      receipt_footer,
    } = req.body;

    if (!business_name) {
      return res.status(400).json({
        status: "error",
        message: "Business name is required.",
      });
    }

    const taxRate = toNonNegativeNumber(tax_rate ?? 0);
    const reminderDays = toPositiveInt(Number(debt_reminder_days ?? 7));

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

    const [settingsRows] = await pool.query(
      `SELECT id FROM settings ORDER BY id ASC LIMIT 1`
    );

    if (settingsRows.length === 0) {
      await pool.query(
        `INSERT INTO settings (
          business_name,
          business_address,
          business_phone,
          owner_phone,
          tax_rate,
          debt_reminder_days,
          daily_summary_time,
          receipt_footer
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          business_name,
          business_address || null,
          business_phone || null,
          owner_phone || null,
          taxRate,
          reminderDays,
          daily_summary_time || "18:00:00",
          receipt_footer || null,
        ]
      );
    } else {
      await pool.query(
        `UPDATE settings
         SET business_name = ?,
             business_address = ?,
             business_phone = ?,
             owner_phone = ?,
             tax_rate = ?,
             debt_reminder_days = ?,
             daily_summary_time = ?,
             receipt_footer = ?
         WHERE id = ?`,
        [
          business_name,
          business_address || null,
          business_phone || null,
          owner_phone || null,
          taxRate,
          reminderDays,
          daily_summary_time || "18:00:00",
          receipt_footer || null,
          settingsRows[0].id,
        ]
      );
    }

    await logActivity(
      req.user.id,
      "UPDATE_SETTINGS",
      "Updated system settings"
    );

    const [updatedSettings] = await pool.query(
      `SELECT *
       FROM settings
       ORDER BY id ASC
       LIMIT 1`
    );

    return res.json({
      status: "success",
      message: "Settings updated successfully.",
      settings: updatedSettings[0],
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