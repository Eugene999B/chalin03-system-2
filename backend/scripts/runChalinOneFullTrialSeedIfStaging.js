"use strict";

const CHALIN_ONE_STAGING_ENVIRONMENT_ID =
  "db796450-1b80-42e8-9988-db3e90ca0713";
const TRIAL_PAYROLL_PERIOD_CODES = Object.freeze({
  "TRIAL-20260813-PAY-spare_parts": "TR26-spare_parts",
  "TRIAL-20260813-PAY-mining": "TR26-mining",
  "TRIAL-20260813-PAY-equipment_hire": "TR26-hire",
});

function compactTrialPayrollPeriodCode(value) {
  const text = String(value || "");
  return TRIAL_PAYROLL_PERIOD_CODES[text] || text;
}

function installTrialPayrollPeriodCompatibility(pool) {
  if (!pool || typeof pool.getConnection !== "function") {
    throw new Error("Database pool is unavailable for trial payroll compatibility.");
  }

  const originalGetConnection = pool.getConnection.bind(pool);
  pool.getConnection = async function getTrialSeedConnection(...args) {
    const connection = await originalGetConnection(...args);
    const originalQuery = connection.query.bind(connection);

    connection.query = function queryWithTrialPeriodCompatibility(sql, params, ...rest) {
      const statement = String(sql || "");
      if (
        /^\s*INSERT\s+INTO\s+`?payroll_periods`?/i.test(statement) &&
        Array.isArray(params)
      ) {
        const columnsMatch = statement.match(
          /^\s*INSERT\s+INTO\s+`?payroll_periods`?\s*\(([^)]+)\)/i
        );
        if (columnsMatch) {
          const columns = columnsMatch[1]
            .split(",")
            .map((column) => column.replace(/`/g, "").trim());
          const periodIndex = columns.indexOf("period_code");
          if (periodIndex >= 0 && periodIndex < params.length) {
            const nextParams = [...params];
            nextParams[periodIndex] = compactTrialPayrollPeriodCode(
              nextParams[periodIndex]
            );
            return originalQuery(sql, nextParams, ...rest);
          }
        }
      }
      return originalQuery(sql, params, ...rest);
    };

    return connection;
  };

  return function restorePoolConnectionFactory() {
    pool.getConnection = originalGetConnection;
  };
}

async function runChalinOneFullTrialSeedIfStaging({
  env = process.env,
  seed = null,
  verify = null,
} = {}) {
  const environmentId = String(env.RAILWAY_ENVIRONMENT_ID || "").trim();
  if (environmentId !== CHALIN_ONE_STAGING_ENVIRONMENT_ID) {
    return Object.freeze({
      status: "skipped",
      reason: "not-dedicated-chalin-one-staging",
      environment_id: environmentId || null,
    });
  }

  let restorePoolConnectionFactory = null;
  if (!seed) {
    const { pool } = require("../config/db");
    restorePoolConnectionFactory = installTrialPayrollPeriodCompatibility(pool);
  }

  try {
    const seedFunction =
      seed || require("./seedChalinOneFullTrialData").seedChalinOneFullTrialData;
    const seedResult = await seedFunction();

    // Preserve dependency-injected unit-test behavior unless a verifier is also
    // explicitly supplied. Runtime calls always verify the live staging data.
    if (seed && !verify) return seedResult;

    if (restorePoolConnectionFactory) {
      restorePoolConnectionFactory();
      restorePoolConnectionFactory = null;
    }

    const verifyFunction =
      verify || require("./verifyChalinOneFullTrialData").verifyChalinOneFullTrialData;
    const verification = await verifyFunction({ env });

    return Object.freeze({
      ...seedResult,
      verification,
    });
  } finally {
    if (restorePoolConnectionFactory) restorePoolConnectionFactory();
  }
}

if (require.main === module) {
  runChalinOneFullTrialSeedIfStaging()
    .then((result) => {
      console.log("CHALIN ONE guarded full-trial seed launcher completed.");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(
        `CHALIN ONE guarded full-trial seed launcher failed [${
          error.code || "ERROR"
        }]: ${error.message}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        const { pool } = require("../config/db");
        await pool.end();
      } catch {}
    });
}

module.exports = {
  CHALIN_ONE_STAGING_ENVIRONMENT_ID,
  TRIAL_PAYROLL_PERIOD_CODES,
  compactTrialPayrollPeriodCode,
  installTrialPayrollPeriodCompatibility,
  runChalinOneFullTrialSeedIfStaging,
};
