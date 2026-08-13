"use strict";

const CHALIN_ONE_STAGING_ENVIRONMENT_ID =
  "db796450-1b80-42e8-9988-db3e90ca0713";

async function runChalinOneFullTrialSeedIfStaging({
  env = process.env,
  seed = null,
} = {}) {
  const environmentId = String(env.RAILWAY_ENVIRONMENT_ID || "").trim();
  if (environmentId !== CHALIN_ONE_STAGING_ENVIRONMENT_ID) {
    return Object.freeze({
      status: "skipped",
      reason: "not-dedicated-chalin-one-staging",
      environment_id: environmentId || null,
    });
  }

  const seedFunction =
    seed || require("./seedChalinOneFullTrialData").seedChalinOneFullTrialData;
  return seedFunction();
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
  runChalinOneFullTrialSeedIfStaging,
};
