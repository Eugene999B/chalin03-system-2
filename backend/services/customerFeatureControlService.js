const { pool } = require("../config/db");

const DEFAULT_CONTROLS = Object.freeze({
  customer_identity_editing_enabled: true,
  customer_merge_enabled: true,
});

let schemaPromise = null;

async function ensureCustomerFeatureControlsSchema() {
  if (!schemaPromise) {
    schemaPromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS customer_feature_controls (
          branch_id INT NOT NULL PRIMARY KEY,
          customer_identity_editing_enabled TINYINT(1) NOT NULL DEFAULT 1,
          customer_merge_enabled TINYINT(1) NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }

  await schemaPromise;
}

function normalizeBranchId(branchId) {
  const value = Number(branchId);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function normalizeFlag(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

async function getCustomerFeatureControls(branchId) {
  const normalizedBranchId = normalizeBranchId(branchId);
  await ensureCustomerFeatureControlsSchema();

  await pool.query(
    `INSERT IGNORE INTO customer_feature_controls (
      branch_id,
      customer_identity_editing_enabled,
      customer_merge_enabled
    ) VALUES (?, ?, ?)`,
    [
      normalizedBranchId,
      DEFAULT_CONTROLS.customer_identity_editing_enabled ? 1 : 0,
      DEFAULT_CONTROLS.customer_merge_enabled ? 1 : 0,
    ]
  );

  const [rows] = await pool.query(
    `SELECT
       branch_id,
       customer_identity_editing_enabled,
       customer_merge_enabled,
       created_at,
       updated_at
     FROM customer_feature_controls
     WHERE branch_id = ?
     LIMIT 1`,
    [normalizedBranchId]
  );

  const row = rows[0] || {};

  return {
    branch_id: normalizedBranchId,
    customer_identity_editing_enabled: normalizeFlag(
      row.customer_identity_editing_enabled,
      DEFAULT_CONTROLS.customer_identity_editing_enabled
    ),
    customer_merge_enabled: normalizeFlag(
      row.customer_merge_enabled,
      DEFAULT_CONTROLS.customer_merge_enabled
    ),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function updateCustomerFeatureControls(
  branchId,
  { customer_identity_editing_enabled, customer_merge_enabled } = {}
) {
  const normalizedBranchId = normalizeBranchId(branchId);
  await ensureCustomerFeatureControlsSchema();

  const current = await getCustomerFeatureControls(normalizedBranchId);
  const next = {
    customer_identity_editing_enabled: normalizeFlag(
      customer_identity_editing_enabled,
      current.customer_identity_editing_enabled
    ),
    customer_merge_enabled: normalizeFlag(
      customer_merge_enabled,
      current.customer_merge_enabled
    ),
  };

  await pool.query(
    `INSERT INTO customer_feature_controls (
       branch_id,
       customer_identity_editing_enabled,
       customer_merge_enabled
     ) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       customer_identity_editing_enabled = VALUES(customer_identity_editing_enabled),
       customer_merge_enabled = VALUES(customer_merge_enabled)`,
    [
      normalizedBranchId,
      next.customer_identity_editing_enabled ? 1 : 0,
      next.customer_merge_enabled ? 1 : 0,
    ]
  );

  return getCustomerFeatureControls(normalizedBranchId);
}

function getFeatureDisabledMessage(featureName) {
  if (featureName === "customer_identity_editing") {
    return "Customer identity editing is disabled by an administrator for this store.";
  }

  if (featureName === "customer_merge") {
    return "Customer merging is disabled by an administrator for this store.";
  }

  return "This customer data feature is currently disabled by an administrator.";
}

module.exports = {
  DEFAULT_CONTROLS,
  ensureCustomerFeatureControlsSchema,
  getCustomerFeatureControls,
  updateCustomerFeatureControls,
  getFeatureDisabledMessage,
};
