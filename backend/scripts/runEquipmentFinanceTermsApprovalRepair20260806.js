const { pool } = require("../config/db");

const APPROVAL_DATE = "2026-08-06";
const APPROVAL_LABEL = "Chalin 03 management-approved Finance terms";

async function runEquipmentFinanceTermsApprovalRepair20260806() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, legal_review_status, legal_reviewed_by, legal_review_date,
              terms_version, CHAR_LENGTH(agreement_terms) AS terms_length
         FROM equipment_finance_settings
        WHERE id = 1
        LIMIT 1
        FOR UPDATE`
    );
    const settings = rows[0];
    if (!settings) {
      throw new Error("Equipment Finance settings row 1 is missing.");
    }
    if (!String(settings.terms_version || "").trim() || Number(settings.terms_length || 0) < 100) {
      throw new Error("Equipment Finance agreement terms are missing or incomplete; approval was not changed.");
    }

    if (settings.legal_review_status !== "approved") {
      await connection.query(
        `UPDATE equipment_finance_settings
            SET legal_review_status = 'approved',
                legal_reviewed_by = COALESCE(NULLIF(legal_reviewed_by, ''), ?),
                legal_review_date = COALESCE(legal_review_date, ?)
          WHERE id = 1`,
        [APPROVAL_LABEL, APPROVAL_DATE]
      );
      console.log("✅ Equipment Finance terms enabled for approved agreements and document issue.");
    } else {
      console.log("✅ Equipment Finance terms approval was already enabled.");
    }

    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_rollbackError) {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  runEquipmentFinanceTermsApprovalRepair20260806()
    .then(async () => {
      await pool.end();
    })
    .catch(async (error) => {
      console.error("❌ Equipment Finance terms approval repair failed:", error.message);
      try {
        await pool.end();
      } catch (_closeError) {
        // Ignore close failure after reporting the original error.
      }
      process.exit(1);
    });
}

module.exports = {
  APPROVAL_DATE,
  APPROVAL_LABEL,
  runEquipmentFinanceTermsApprovalRepair20260806,
};
