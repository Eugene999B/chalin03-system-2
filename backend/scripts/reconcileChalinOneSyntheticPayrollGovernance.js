"use strict";

require("dotenv").config();

const { pool } = require("../config/db");

const CHALIN_ONE_STAGING_ENVIRONMENT_ID =
  "db796450-1b80-42e8-9988-db3e90ca0713";
const TRIAL_WORKER_PREFIX = "TRIAL-20260813-WRK-%";
const TRIAL_PAYROLL_PERIOD_CODES = Object.freeze([
  "TRIAL-20260813-PAY-spare_parts",
  "TRIAL-20260813-PAY-mining",
  "TRIAL-20260813-PAY-equipment_hire",
  "TR26-spare_parts",
  "TR26-mining",
  "TR26-hire",
]);

class ChalinOneSyntheticPayrollGovernanceError extends Error {
  constructor(
    message,
    code = "CHALIN_ONE_SYNTHETIC_PAYROLL_GOVERNANCE_REPAIR_FAILED"
  ) {
    super(message);
    this.name = "ChalinOneSyntheticPayrollGovernanceError";
    this.code = code;
  }
}

function assertDedicatedStaging(env = process.env) {
  const environmentId = String(env.RAILWAY_ENVIRONMENT_ID || "").trim();
  if (environmentId !== CHALIN_ONE_STAGING_ENVIRONMENT_ID) {
    throw new ChalinOneSyntheticPayrollGovernanceError(
      "Synthetic payroll governance reconciliation is allowed only in the dedicated CHALIN ONE Railway staging environment.",
      "CHALIN_ONE_SYNTHETIC_PAYROLL_GOVERNANCE_ENVIRONMENT_REFUSED"
    );
  }
  return environmentId;
}

async function resolveGovernanceIdentities(connection) {
  const [rows] = await connection.query(
    `SELECT id, username
       FROM users
      WHERE username IN ('admin', 'chalin-one-reviewer')`
  );
  const byUsername = new Map(
    rows.map((row) => [String(row.username || "").trim(), Number(row.id)])
  );
  const adminId = byUsername.get("admin");
  const reviewerId = byUsername.get("chalin-one-reviewer");

  if (!Number.isInteger(adminId) || adminId <= 0) {
    throw new ChalinOneSyntheticPayrollGovernanceError(
      "The synthetic payroll governance repair could not resolve the staging admin identity.",
      "CHALIN_ONE_SYNTHETIC_PAYROLL_GOVERNANCE_ADMIN_MISSING"
    );
  }
  if (!Number.isInteger(reviewerId) || reviewerId <= 0) {
    throw new ChalinOneSyntheticPayrollGovernanceError(
      "The synthetic payroll governance repair could not resolve the staging reviewer identity.",
      "CHALIN_ONE_SYNTHETIC_PAYROLL_GOVERNANCE_REVIEWER_MISSING"
    );
  }
  if (adminId === reviewerId) {
    throw new ChalinOneSyntheticPayrollGovernanceError(
      "The staging admin and reviewer identities must remain distinct for payroll approval separation.",
      "CHALIN_ONE_SYNTHETIC_PAYROLL_GOVERNANCE_IDENTITY_CONFLICT"
    );
  }

  return Object.freeze({ adminId, reviewerId });
}

function periodPlaceholders() {
  return TRIAL_PAYROLL_PERIOD_CODES.map(() => "?").join(", ");
}

async function verifySyntheticSeparation(connection) {
  const placeholders = periodPlaceholders();
  const [[row]] = await connection.query(
    `SELECT
       (
         SELECT COUNT(*)
           FROM payroll_compensation_profiles profile
           INNER JOIN worker_profiles worker ON worker.id = profile.worker_id
          WHERE worker.employee_number LIKE ?
            AND profile.approved_by IS NOT NULL
            AND profile.approved_by = profile.created_by
       ) AS self_approved_compensation_profiles,
       (
         SELECT COUNT(*)
           FROM payroll_periods period_row
          WHERE period_row.period_code IN (${placeholders})
            AND period_row.approved_by IS NOT NULL
            AND period_row.approved_by = period_row.prepared_by
       ) AS self_approved_payroll_periods,
       (
         SELECT COUNT(*)
           FROM payroll_entries entry_row
           INNER JOIN payroll_periods period_row
             ON period_row.id = entry_row.payroll_period_id
          WHERE period_row.period_code IN (${placeholders})
            AND entry_row.approved_by IS NOT NULL
            AND entry_row.approved_by = entry_row.prepared_by
       ) AS self_approved_payroll_entries`,
    [
      TRIAL_WORKER_PREFIX,
      ...TRIAL_PAYROLL_PERIOD_CODES,
      ...TRIAL_PAYROLL_PERIOD_CODES,
    ]
  );

  const verification = Object.freeze({
    self_approved_compensation_profiles: Number(
      row?.self_approved_compensation_profiles || 0
    ),
    self_approved_payroll_periods: Number(
      row?.self_approved_payroll_periods || 0
    ),
    self_approved_payroll_entries: Number(
      row?.self_approved_payroll_entries || 0
    ),
  });

  if (Object.values(verification).some((value) => value !== 0)) {
    throw new ChalinOneSyntheticPayrollGovernanceError(
      `Synthetic payroll approval separation is still invalid after reconciliation: ${Object.entries(
        verification
      )
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")}.`,
      "CHALIN_ONE_SYNTHETIC_PAYROLL_GOVERNANCE_VERIFY_FAILED"
    );
  }

  return verification;
}

async function reconcileChalinOneSyntheticPayrollGovernance({
  connection = null,
  env = process.env,
} = {}) {
  const environmentId = assertDedicatedStaging(env);
  const ownConnection = !connection;
  const db = connection || (await pool.getConnection());

  try {
    const identities = await resolveGovernanceIdentities(db);
    const placeholders = periodPlaceholders();

    const [profiles] = await db.query(
      `UPDATE payroll_compensation_profiles profile
       INNER JOIN worker_profiles worker ON worker.id = profile.worker_id
          SET profile.approved_by = ?
        WHERE worker.employee_number LIKE ?
          AND profile.approved_by IS NOT NULL
          AND profile.approved_by = profile.created_by
          AND profile.created_by <> ?`,
      [identities.reviewerId, TRIAL_WORKER_PREFIX, identities.reviewerId]
    );

    const [periods] = await db.query(
      `UPDATE payroll_periods period_row
          SET period_row.approved_by = ?
        WHERE period_row.period_code IN (${placeholders})
          AND period_row.approved_by IS NOT NULL
          AND period_row.approved_by = period_row.prepared_by
          AND period_row.prepared_by <> ?`,
      [
        identities.reviewerId,
        ...TRIAL_PAYROLL_PERIOD_CODES,
        identities.reviewerId,
      ]
    );

    const [entries] = await db.query(
      `UPDATE payroll_entries entry_row
       INNER JOIN payroll_periods period_row
          ON period_row.id = entry_row.payroll_period_id
          SET entry_row.approved_by = ?
        WHERE period_row.period_code IN (${placeholders})
          AND entry_row.approved_by IS NOT NULL
          AND entry_row.approved_by = entry_row.prepared_by
          AND entry_row.prepared_by <> ?`,
      [
        identities.reviewerId,
        ...TRIAL_PAYROLL_PERIOD_CODES,
        identities.reviewerId,
      ]
    );

    const verification = await verifySyntheticSeparation(db);
    const result = Object.freeze({
      safe: true,
      environment_id: environmentId,
      reviewer_id: identities.reviewerId,
      updated_compensation_profiles: Number(profiles?.affectedRows || 0),
      updated_payroll_periods: Number(periods?.affectedRows || 0),
      updated_payroll_entries: Number(entries?.affectedRows || 0),
      verification,
    });

    console.log(
      `CHALIN ONE synthetic payroll governance reconciled safely: profiles=${result.updated_compensation_profiles}, periods=${result.updated_payroll_periods}, entries=${result.updated_payroll_entries}.`
    );
    return result;
  } finally {
    if (ownConnection) db.release();
  }
}

if (require.main === module) {
  reconcileChalinOneSyntheticPayrollGovernance()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(
        `CHALIN ONE synthetic payroll governance reconciliation failed [${
          error.code || "ERROR"
        }]: ${error.message}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}

module.exports = {
  CHALIN_ONE_STAGING_ENVIRONMENT_ID,
  TRIAL_PAYROLL_PERIOD_CODES,
  TRIAL_WORKER_PREFIX,
  ChalinOneSyntheticPayrollGovernanceError,
  assertDedicatedStaging,
  reconcileChalinOneSyntheticPayrollGovernance,
  resolveGovernanceIdentities,
  verifySyntheticSeparation,
};
