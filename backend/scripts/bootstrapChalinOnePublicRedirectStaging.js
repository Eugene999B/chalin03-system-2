"use strict";

require("dotenv").config();

const {
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");
const {
  RELEASE_CONFIRMATION,
  runChalinOnePublicRedirectMigration,
} = require("./runChalinOnePublicRedirectMigration");

async function bootstrapChalinOnePublicRedirectStaging({ env = process.env } = {}) {
  validateFullStagingEnvironment(env, { mode: "runtime" });
  const result = await runChalinOnePublicRedirectMigration({
    env: {
      ...env,
      CHALIN_ONE_ALLOW_PUBLIC_REDIRECT_MIGRATION: "true",
      CHALIN_ONE_PUBLIC_REDIRECT_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    },
  });
  console.log("CHALIN ONE staging public redirect foundation verified safely.");
  return result;
}

if (require.main === module) {
  bootstrapChalinOnePublicRedirectStaging().catch((error) => {
    console.error(`CHALIN ONE public redirect staging bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  bootstrapChalinOnePublicRedirectStaging,
};
