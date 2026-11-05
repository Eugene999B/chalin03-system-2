const mysql = require("mysql2/promise");

const {
  RESET_LOCK,
  connectionOptions,
  resolveExecutionMode,
  runUserAuthorizedInstallmentRestartReset20260805,
} = require("./runUserAuthorizedInstallmentRestartReset20260805");

const SAFE_RESET_LOCK = "chalin03:eq-fin:restart-reset:20260805";

function assertSafeLockNames() {
  if (SAFE_RESET_LOCK.length > 64) {
    throw new Error("Installment reset advisory lock exceeds MySQL's 64-character limit.");
  }
  if (SAFE_RESET_LOCK === RESET_LOCK) {
    throw new Error("Installment reset lock fix must replace the rejected legacy lock.");
  }
}

function withSafeResetLock(connection) {
  const originalQuery = connection.query.bind(connection);

  return new Proxy(connection, {
    get(target, property) {
      if (property === "query") {
        return (sql, values) => {
          const parameters = Array.isArray(values) ? [...values] : values;
          if (
            Array.isArray(parameters) &&
            parameters[0] === RESET_LOCK &&
            /\b(?:GET_LOCK|RELEASE_LOCK)\s*\(/i.test(String(sql || ""))
          ) {
            parameters[0] = SAFE_RESET_LOCK;
          }
          return originalQuery(sql, parameters);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function runUserAuthorizedInstallmentRestartResetLockFix20260805({
  environment = process.env,
  createConnection = mysql.createConnection,
} = {}) {
  assertSafeLockNames();

  if (resolveExecutionMode(environment) !== "execute_once") {
    return runUserAuthorizedInstallmentRestartReset20260805({ environment });
  }

  const connection = await createConnection(connectionOptions(environment));
  try {
    return await runUserAuthorizedInstallmentRestartReset20260805({
      environment,
      connection: withSafeResetLock(connection),
    });
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  runUserAuthorizedInstallmentRestartResetLockFix20260805().catch((error) => {
    console.error("One-time Installment Finance restart reset lock fix failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  SAFE_RESET_LOCK,
  assertSafeLockNames,
  runUserAuthorizedInstallmentRestartResetLockFix20260805,
  withSafeResetLock,
};
