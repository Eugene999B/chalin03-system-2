const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { RESET_CONFIRMATION, buildDryRun } = require("./installmentFinanceResetScopeServiceV2");
const { resetInstallmentTransaction } = require("./installmentUnifiedDeletionServiceV1");
const {
  runEquipmentFinanceOpeningDepositFoundationRepair,
} = require("../scripts/runEquipmentFinanceOpeningDepositFoundationRepair");

async function verifyPassword(db, userId, password) {
  const [[user]] = await db.query("SELECT id,password_hash,is_active FROM users WHERE id=? LIMIT 1", [userId]);
  if (!user || Number(user.is_active) !== 1 || !user.password_hash || !(await bcrypt.compare(String(password || ""), String(user.password_hash)))) {
    const error = new Error("The current password is incorrect.");
    error.statusCode = 401;
    error.code = "RESET_PASSWORD_INVALID";
    throw error;
  }
}

async function executeReset({ userId, password, confirmation, dryRunFingerprint } = {}) {
  if (String(confirmation || "").trim() !== RESET_CONFIRMATION) {
    const error = new Error(`Type ${RESET_CONFIRMATION} exactly to confirm the Installment reset.`);
    error.statusCode = 400;
    error.code = "RESET_CONFIRMATION_REQUIRED";
    throw error;
  }
  const db = await pool.getConnection();
  try {
    await verifyPassword(db, userId, password);
    const dryRun = await buildDryRun(db);
    if (!dryRunFingerprint || dryRunFingerprint !== dryRun.fingerprint) {
      const error = new Error("The reset scope changed. Prepare a new dry run before executing the reset.");
      error.statusCode = 409;
      error.code = "RESET_DRY_RUN_STALE";
      throw error;
    }
  } finally { db.release(); }

  const result = await resetInstallmentTransaction();

  try {
    // A reset must never leave the Opening Deposit foundation in an invalid state.
    // Repair and verify the same approved schema/triggers before reporting success.
    await runEquipmentFinanceOpeningDepositFoundationRepair();
  } catch (repairError) {
    repairError.statusCode = 503;
    repairError.code = "RESET_OPENING_DEPOSIT_FOUNDATION_REPAIR_FAILED";
    repairError.message = `Installment reset completed, but the Opening Deposit foundation repair failed: ${repairError.message}`;
    throw repairError;
  }

  return {
    ...result,
    mode: "installment_reset",
    dry_run_fingerprint: dryRunFingerprint,
    cleared_installment_ids: result.scope,
    message: "Installment Finance was reset through the same transactional deletion engine used by individual customer and excavator deletes. The Opening Deposit foundation was repaired and verified before the reset was reported successful. Shared non-Installment records remain protected.",
  };
}

module.exports = { executeReset };