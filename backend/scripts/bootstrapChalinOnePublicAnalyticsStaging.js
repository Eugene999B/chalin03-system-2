"use strict";

require("dotenv").config();

const {
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");
const {
  RELEASE_CONFIRMATION,
  runChalinOnePublicAnalyticsMigration,
} = require("./runChalinOnePublicAnalyticsMigration");

async function bootstrapChalinOnePublicAnalyticsStaging({ env = process.env } = {}) {
  validateFullStagingEnvironment(env, { mode: "runtime" });
  const result = await runChalinOnePublicAnalyticsMigration({
    env: {
      ...env,
      CHALIN_ONE_ALLOW_PUBLIC_ANALYTICS_MIGRATION: "true",
      CHALIN_ONE_PUBLIC_ANALYTICS_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    },
  });
  console.log("CHALIN ONE staging public analytics foundation verified safely.");
  return result;
}

if (require.main === module) {
  bootstrapChalinOnePublicAnalyticsStaging().catch((error) => {
    console.error(`CHALIN ONE public analytics staging bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  bootstrapChalinOnePublicAnalyticsStaging,
};
