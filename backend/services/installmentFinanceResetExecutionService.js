const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { RESET_CONFIRMATION, buildDryRun } = require("./installmentFinanceLiveResetService");
const { clearEverythingInInstallment } = require("./installmentCompletePurgeService");

async function verifyPassword(db, userId, password) {
  const [[user]] = await db.query("SELECT id,password_hash,is_active FROM users WHERE id=? LIMIT 1", [userId]);
  if (!user || Number(user.is_active) !== 1 || !user.password_hash || !(await bcrypt.compare(String(password || ""), String(user.password_hash)))) {
    const error = new Error("The current password is incorrect.");
    error.statusCode = 401;
    error.code = "RESET_PASSWORD_INVALID";
    throw error;
  }
}

async function executeReset({ userId, password, confirmation, dryRunFingerprint, connection = null } = {}) {
  if (String(confirmation || "").trim() !== RESET_CONFIRMATION) {
    const error = new Error(`Type ${RESET_CONFIRMATION} exactly to confirm the Installment reset.`);
    error.statusCode = 400;
    error.code = "RESET_CONFIRMATION_REQUIRED";
    throw error;
  }

  const ownsConnection = !connection;
  const db = connection || await pool.getConnection();
  try {
    await verifyPassword(db, userId, password);
    const dryRun = await buildDryRun(db);
    if (!dryRunFingerprint || dryRunFingerprint !== dryRun.fingerprint) {
      const error = new Error("The reset scope changed. Prepare a new dry run before executing the reset.");
      error.statusCode = 409;
      error.code = "RESET_DRY_RUN_STALE";
      throw error;
    }

    await db.beginTransaction();
    const result = await clearEverythingInInstallment(db);
    await db.commit();

    return {
      status: "success",
      mode: "installment_reset",
      dry_run_fingerprint: dryRun.fingerprint,
      deleted: result.deleted,
      cleared_installment_ids: result.ids,
      message: "Installment data was completely cleared. Shared records still referenced outside Installment were preserved.",
    };
  } catch (error) {
    try { await db.rollback(); } catch (_) {}
    throw error;
  } finally {
    if (ownsConnection) db.release();
  }
}

module.exports = { executeReset };
