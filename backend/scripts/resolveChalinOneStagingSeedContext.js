"use strict";

const {
  positiveId,
  validateStagingEnvironment,
} = require("./verifyChalinOneStagingEnvironment");
const {
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");

function stagingUsers(env = process.env) {
  const users = {
    author: positiveId(env.CHALIN_ONE_STAGING_AUTHOR_USER_ID),
    reviewer: positiveId(env.CHALIN_ONE_STAGING_REVIEWER_USER_ID),
    publisher: positiveId(env.CHALIN_ONE_STAGING_PUBLISHER_USER_ID),
  };

  if (!users.author || !users.reviewer || !users.publisher) {
    throw new Error(
      "CHALIN ONE staging seed requires author, reviewer and publisher user IDs."
    );
  }

  if (new Set(Object.values(users)).size !== 3) {
    throw new Error(
      "CHALIN ONE staging seed requires three different governance users."
    );
  }

  return Object.freeze(users);
}

function resolveChalinOneStagingSeedContext(env = process.env) {
  try {
    return validateStagingEnvironment(env, { mode: "seed" });
  } catch (legacyError) {
    const full = validateFullStagingEnvironment(env, { mode: "runtime" });
    return Object.freeze({
      ...full,
      users: stagingUsers(env),
      seed_profile: "full-staging",
      legacy_seed_validator_error: legacyError?.code || legacyError?.name || null,
    });
  }
}

module.exports = {
  resolveChalinOneStagingSeedContext,
  stagingUsers,
};
