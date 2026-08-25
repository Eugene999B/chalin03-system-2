// Temporary production-safe diagnostic helper for Opening Deposit failures.
// This file is intentionally side-effect free and is removed after the investigation.
module.exports = function diagnoseOpeningDepositUnexpectedFailure(error, operation = "unknown") {
  return {
    operation,
    mysql_code: error?.code || null,
    mysql_errno: error?.errno || null,
    sql_state: error?.sqlState || null,
    mysql_message: String(error?.sqlMessage || error?.message || "").slice(0, 500),
    backend_revision:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.RAILWAY_GIT_COMMIT_SHA_SHORT ||
      process.env.RAILWAY_GIT_COMMIT ||
      "unknown",
  };
};
