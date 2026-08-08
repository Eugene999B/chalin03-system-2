"use strict";

require("dotenv").config();

const { pool } = require("../config/db");
const {
  RAILWAY_STAGING_ISOLATION_CONFIRMATION,
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");

const REQUIRED_STORES = Object.freeze([
  Object.freeze({
    id: 1,
    code: "MAIN",
    name: "Chalin 03 Main Store",
    location: "Dunkwa Police Barrier",
    is_head_office: 1,
  }),
  Object.freeze({
    id: 2,
    code: "AJAKAA",
    name: "Chalin 03 Store",
    location: "Ajakaa Manso",
    is_head_office: 0,
  }),
]);

class ChalinOneStagingOperationalBaselineError extends Error {
  constructor(message, code = "CHALIN_ONE_STAGING_OPERATIONAL_BASELINE_UNSAFE") {
    super(message);
    this.name = "ChalinOneStagingOperationalBaselineError";
    this.code = code;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function assertStagingOnly(env = process.env) {
  validateFullStagingEnvironment(env, { mode: "runtime" });

  const railwayEnvironment = clean(
    env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT
  ).toLowerCase();
  if (railwayEnvironment !== "staging") {
    throw new ChalinOneStagingOperationalBaselineError(
      "Operational baseline seeding requires Railway environment staging.",
      "CHALIN_ONE_STAGING_OPERATIONAL_BASELINE_RAILWAY_STAGING_REQUIRED"
    );
  }

  const host = clean(env.DB_HOST || env.MYSQLHOST || env.MYSQL_HOST);
  if (!/\.railway\.internal$/i.test(host)) {
    throw new ChalinOneStagingOperationalBaselineError(
      "Operational baseline seeding requires the dedicated internal Railway staging MySQL host.",
      "CHALIN_ONE_STAGING_OPERATIONAL_BASELINE_INTERNAL_DB_REQUIRED"
    );
  }

  if (
    clean(env.CHALIN_ONE_STAGING_DATABASE_ISOLATION) !==
    RAILWAY_STAGING_ISOLATION_CONFIRMATION
  ) {
    throw new ChalinOneStagingOperationalBaselineError(
      "Operational baseline seeding requires the dedicated CHALIN ONE Railway staging database isolation token.",
      "CHALIN_ONE_STAGING_OPERATIONAL_BASELINE_ISOLATION_REQUIRED"
    );
  }
}

function normalizedCode(row) {
  return clean(row?.code || row?.branch_code).toUpperCase();
}

async function verifyNoStoreIdentityConflict(connection) {
  const [rows] = await connection.query(
    `SELECT id, code, branch_code, name, location, is_active
       FROM branches
      WHERE id IN (1, 2)
         OR code IN ('MAIN', 'AJAKAA')
         OR branch_code IN ('MAIN', 'AJAKAA')
      ORDER BY id`
  );

  for (const store of REQUIRED_STORES) {
    const byId = rows.find((row) => Number(row.id) === store.id);
    if (byId && normalizedCode(byId) !== store.code) {
      throw new ChalinOneStagingOperationalBaselineError(
        `Refusing to replace staging branch id ${store.id}; it belongs to ${normalizedCode(byId) || "an unknown code"}.`,
        "CHALIN_ONE_STAGING_OPERATIONAL_BASELINE_ID_CONFLICT"
      );
    }

    const byCode = rows.find((row) => normalizedCode(row) === store.code);
    if (byCode && Number(byCode.id) !== store.id) {
      throw new ChalinOneStagingOperationalBaselineError(
        `Refusing to move staging branch ${store.code} from id ${byCode.id} to ${store.id}.`,
        "CHALIN_ONE_STAGING_OPERATIONAL_BASELINE_CODE_CONFLICT"
      );
    }
  }
}

async function ensureRequiredStores(connection) {
  await verifyNoStoreIdentityConflict(connection);

  for (const store of REQUIRED_STORES) {
    await connection.query(
      `INSERT INTO branches
        (id, code, branch_code, name, location, phone, manager_name, is_head_office, is_active)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 1)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         branch_code = VALUES(branch_code),
         name = VALUES(name),
         location = VALUES(location),
         is_head_office = VALUES(is_head_office),
         is_active = 1`,
      [
        store.id,
        store.code,
        store.code,
        store.name,
        store.location,
        store.is_head_office,
      ]
    );
  }

  const [rows] = await connection.query(
    `SELECT id, code, branch_code, name, location, is_active
       FROM branches
      WHERE id IN (1, 2)
      ORDER BY id`
  );

  if (rows.length !== REQUIRED_STORES.length) {
    throw new ChalinOneStagingOperationalBaselineError(
      "Staging Spare Parts store verification did not return both required stores.",
      "CHALIN_ONE_STAGING_OPERATIONAL_BASELINE_VERIFY_FAILED"
    );
  }

  for (const store of REQUIRED_STORES) {
    const row = rows.find((candidate) => Number(candidate.id) === store.id);
    if (
      !row ||
      normalizedCode(row) !== store.code ||
      clean(row.name) !== store.name ||
      clean(row.location) !== store.location ||
      Number(row.is_active) !== 1
    ) {
      throw new ChalinOneStagingOperationalBaselineError(
        `Staging Spare Parts store ${store.code} failed post-seed verification.`,
        "CHALIN_ONE_STAGING_OPERATIONAL_BASELINE_VERIFY_FAILED"
      );
    }
  }

  return rows;
}

async function ensureChalinOneStagingOperationalBaseline() {
  assertStagingOnly(process.env);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const rows = await ensureRequiredStores(connection);
    await connection.commit();

    console.log(
      `CHALIN ONE staging operational baseline ready: ${rows
        .map((row) => `${row.code}:${row.name}`)
        .join(", ")}.`
    );
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  ensureChalinOneStagingOperationalBaseline()
    .catch((error) => {
      console.error(
        `CHALIN ONE staging operational baseline failed: ${error.message}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}

module.exports = {
  REQUIRED_STORES,
  ChalinOneStagingOperationalBaselineError,
  assertStagingOnly,
  ensureChalinOneStagingOperationalBaseline,
  ensureRequiredStores,
  verifyNoStoreIdentityConflict,
};
