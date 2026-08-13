"use strict";

const CHALIN_ONE_STAGING_ENVIRONMENT_ID =
  "db796450-1b80-42e8-9988-db3e90ca0713";

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

  const seedFunction =
    seed || require("./seedChalinOneFullTrialData").seedChalinOneFullTrialData;
  const seedResult = await seedFunction();

  // Preserve dependency-injected unit-test behavior unless a verifier is also
  // explicitly supplied. Runtime calls always verify the live staging data.
  if (seed && !verify) return seedResult;

  const verifyFunction =
    verify || require("./verifyChalinOneFullTrialData").verifyChalinOneFullTrialData;
  const verification = await verifyFunction({ env });

  return Object.freeze({
    ...seedResult,
    verification,
  });
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
