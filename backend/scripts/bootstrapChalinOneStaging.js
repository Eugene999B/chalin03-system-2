"use strict";

const bcrypt = require("bcryptjs");
require("dotenv").config();

const { pool } = require("../config/db");
const {
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");
const {
  repairChalinOneStagingAuthBaseline,
} = require("./repairChalinOneStagingAuthBaseline");
const {
  completeChalinOneFullStagingDatabase,
} = require("./completeChalinOneFullStagingDatabase");

const PASSWORD_SPECS = Object.freeze([
  Object.freeze({
    idEnv: "CHALIN_ONE_STAGING_AUTHOR_USER_ID",
    usernameEnv: "SYSTEM_ADMIN_USERNAME",
    fallbackUsername: "admin",
    passwordEnv: "CHALIN_ONE_STAGING_ADMIN_PASSWORD",
    legacyPasswordEnv: "ADMIN_PASSWORD",
    label: "administrator",
  }),
  Object.freeze({
    idEnv: "CHALIN_ONE_STAGING_REVIEWER_USER_ID",
    fallbackUsername: "chalin-one-reviewer",
    passwordEnv: "CHALIN_ONE_STAGING_REVIEWER_PASSWORD",
    label: "reviewer",
  }),
  Object.freeze({
    idEnv: "CHALIN_ONE_STAGING_PUBLISHER_USER_ID",
    fallbackUsername: "chalin-one-publisher",
    passwordEnv: "CHALIN_ONE_STAGING_PUBLISHER_PASSWORD",
    label: "publisher",
  }),
]);

function clean(value) {
  return String(value ?? "").trim();
}

function passwordPolicyError(password) {
  const value = String(password || "");
  if (value.length < 8) return "must contain at least 8 characters";
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value)) {
    return "must include uppercase and lowercase letters";
  }
  if (!/\d/.test(value)) return "must include at least one number";
  if (!/[^A-Za-z0-9]/.test(value)) return "must include at least one symbol";
  return "";
}

function maskedCompletionEnvironment(env = process.env) {
  return {
    ...env,
    CHALIN_ONE_STAGING_ADMIN_PASSWORD: "",
    CHALIN_ONE_STAGING_REVIEWER_PASSWORD: "",
    CHALIN_ONE_STAGING_PUBLISHER_PASSWORD: "",
    ADMIN_PASSWORD: "",
  };
}

function configuredCredential(spec, env = process.env) {
  const id = Number(env[spec.idEnv]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${spec.idEnv} must be a positive integer.`);
  }

  const username = clean(
    spec.usernameEnv ? env[spec.usernameEnv] : spec.fallbackUsername
  ) || spec.fallbackUsername;
  const password = String(
    env[spec.passwordEnv] ||
      (spec.legacyPasswordEnv ? env[spec.legacyPasswordEnv] : "") ||
      ""
  );

  if (!password) {
    return { ...spec, id, username, password: "", configured: false };
  }

  const policyError = passwordPolicyError(password);
  if (policyError) {
    throw new Error(`${spec.passwordEnv} ${policyError}.`);
  }

  return { ...spec, id, username, password, configured: true };
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row?.present || 0) === 1;
}

async function rotateCredential(connection, credential) {
  if (!credential.configured) {
    return {
      id: credential.id,
      username: credential.username,
      configured: false,
      rotated: false,
    };
  }

  const [rows] = await connection.query(
    `SELECT id, username, password_hash
       FROM users
      WHERE id = ? OR username = ?
      ORDER BY id
      LIMIT 2`,
    [credential.id, credential.username]
  );

  const idMatch = rows.find((row) => Number(row.id) === credential.id);
  const usernameMatch = rows.find(
    (row) => clean(row.username).toLowerCase() === credential.username.toLowerCase()
  );

  if (!idMatch) {
    throw new Error(
      `The CHALIN ONE staging ${credential.label} user ID ${credential.id} does not exist after database completion.`
    );
  }
  if (clean(idMatch.username).toLowerCase() !== credential.username.toLowerCase()) {
    throw new Error(
      `The CHALIN ONE staging ${credential.label} user ID ${credential.id} belongs to a different username.`
    );
  }
  if (usernameMatch && Number(usernameMatch.id) !== credential.id) {
    throw new Error(
      `The CHALIN ONE staging ${credential.label} username belongs to a different user ID.`
    );
  }

  const alreadyMatches = await bcrypt.compare(
    credential.password,
    String(idMatch.password_hash || "")
  );

  if (!alreadyMatches) {
    const passwordHash = await bcrypt.hash(credential.password, 12);
    await connection.query(
      `UPDATE users
          SET password_hash = ?,
              is_active = TRUE,
              must_change_password = FALSE,
              password_changed_at = NOW(),
              token_version = COALESCE(token_version, 0) + 1
        WHERE id = ?`,
      [passwordHash, credential.id]
    );

    if (await tableExists(connection, "auth_sessions")) {
      await connection.query(
        `UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, NOW()),
                revocation_reason = COALESCE(
                  revocation_reason,
                  'chalin_one_staging_credential_rotation'
                )
          WHERE user_id = ?
            AND revoked_at IS NULL`,
        [credential.id]
      );
    }
  }

  return {
    id: credential.id,
    username: credential.username,
    configured: true,
    rotated: !alreadyMatches,
    minimum_password_length: 8,
  };
}

async function applyConfiguredGovernancePasswords(env = process.env) {
  const credentials = PASSWORD_SPECS.map((spec) =>
    configuredCredential(spec, env)
  );
  const connection = await pool.getConnection();

  try {
    const results = [];
    for (const credential of credentials) {
      results.push(await rotateCredential(connection, credential));
    }
    return results;
  } finally {
    connection.release();
  }
}

async function bootstrapChalinOneStaging({ env = process.env } = {}) {
  validateFullStagingEnvironment(env, { mode: "runtime" });

  const maskedEnv = maskedCompletionEnvironment(env);
  await repairChalinOneStagingAuthBaseline({ env: maskedEnv });
  const database = await completeChalinOneFullStagingDatabase({ env: maskedEnv });
  const credentials = await applyConfiguredGovernancePasswords(env);

  const result = Object.freeze({
    safe: true,
    database: database.database,
    table_count: database.table_count,
    password_policy: {
      minimum_length: 8,
      requires_uppercase: true,
      requires_lowercase: true,
      requires_number: true,
      requires_symbol: true,
    },
    credentials,
  });

  console.log("CHALIN ONE staging bootstrap completed with the 8+ password policy.");
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  bootstrapChalinOneStaging()
    .catch((error) => {
      console.error(`CHALIN ONE staging bootstrap failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}

module.exports = {
  PASSWORD_SPECS,
  applyConfiguredGovernancePasswords,
  bootstrapChalinOneStaging,
  configuredCredential,
  maskedCompletionEnvironment,
  passwordPolicyError,
};
