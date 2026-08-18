const { recoverInstallmentLegacyTrialOwnership } = require("../services/installmentLegacyTrialRecoveryService");

let recoveryPromise = null;

async function recover(req, res, next) {
  if (!recoveryPromise) {
    recoveryPromise = (async () => {
      const { pool } = require("../config/db");
      const db = await pool.getConnection();
      try {
        return await recoverInstallmentLegacyTrialOwnership({ connection: db });
      } finally {
        db.release();
      }
    })().catch((error) => {
      recoveryPromise = null;
      throw error;
    });
  }

  try {
    await recoveryPromise;
    return next();
  } catch (error) {
    console.error("Installment legacy recovery failed:", error);
    return res.status(503).json({
      status: "error",
      code: "INSTALLMENT_LEGACY_RECOVERY_UNAVAILABLE",
      message: "Installment trial ownership recovery could not be prepared. The operation was not started.",
    });
  }
}

module.exports = { recover };
