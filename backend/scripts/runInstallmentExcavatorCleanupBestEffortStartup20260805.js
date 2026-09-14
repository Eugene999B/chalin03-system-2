const {
  runUserAuthorizedInstallmentExcavatorCleanup20260805,
} = require("./runUserAuthorizedInstallmentExcavatorCleanup20260805");

async function runInstallmentExcavatorCleanupBestEffortStartup20260805() {
  try {
    const result =
      await runUserAuthorizedInstallmentExcavatorCleanup20260805();
    console.log(
      "Installment Finance excavator cleanup startup result:",
      JSON.stringify(result)
    );
    return { ok: true, result };
  } catch (error) {
    console.error(
      "Installment Finance excavator cleanup did not complete; API startup will continue with the operational-reset visibility cutoff."
    );
    console.error(error.message);
    return {
      ok: false,
      error: error.message,
      fallback: "operational_reset_visibility_cutoff",
    };
  }
}

if (require.main === module) {
  runInstallmentExcavatorCleanupBestEffortStartup20260805().then(() => {
    process.exitCode = 0;
  });
}

module.exports = {
  runInstallmentExcavatorCleanupBestEffortStartup20260805,
};
