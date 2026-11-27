const { pool } = require("../config/db");

const DEFAULT_CONTROLS = Object.freeze({
  customer_identity_editing_enabled: true,
  customer_merge_enabled: true,
});

let schemaPromise;

async function ensureCustomerFeatureControlsSchema() {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS customer_feature_controls (
        branch_id INT NOT NULL PRIMARY KEY,
        customer_identity_editing_enabled TINYINT(1) NOT NULL DEFAULT 1,
        customer_merge_enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

function branchIdOf(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 1;
}
function flagOf(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

async function getCustomerFeatureControls(branchId) {
  const id = branchIdOf(branchId);
  await ensureCustomerFeatureControlsSchema();
  await pool.query(
    `INSERT IGNORE INTO customer_feature_controls
      (branch_id, customer_identity_editing_enabled, customer_merge_enabled)
     VALUES (?, 1, 1)`,
    [id]
  );
  const [rows] = await pool.query(
    `SELECT branch_id, customer_identity_editing_enabled, customer_merge_enabled,
            created_at, updated_at
       FROM customer_feature_controls
      WHERE branch_id = ? LIMIT 1`,
    [id]
  );
  const row = rows[0] || {};
  return {
    branch_id: id,
    customer_identity_editing_enabled: flagOf(row.customer_identity_editing_enabled, true),
    customer_merge_enabled: flagOf(row.customer_merge_enabled, true),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function updateCustomerFeatureControls(branchId, changes = {}) {
  const id = branchIdOf(branchId);
  const current = await getCustomerFeatureControls(id);
  const next = {
    customer_identity_editing_enabled: flagOf(changes.customer_identity_editing_enabled, current.customer_identity_editing_enabled),
    customer_merge_enabled: flagOf(changes.customer_merge_enabled, current.customer_merge_enabled),
  };
  await pool.query(
    `INSERT INTO customer_feature_controls
      (branch_id, customer_identity_editing_enabled, customer_merge_enabled)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       customer_identity_editing_enabled = VALUES(customer_identity_editing_enabled),
       customer_merge_enabled = VALUES(customer_merge_enabled)`,
    [id, next.customer_identity_editing_enabled ? 1 : 0, next.customer_merge_enabled ? 1 : 0]
  );
  return getCustomerFeatureControls(id);
}

function getFeatureDisabledMessage(feature) {
  if (feature === "customer_identity_editing") return "Customer identity editing is disabled by an administrator for this store.";
  if (feature === "customer_merge") return "Customer merging is disabled by an administrator for this store.";
  return "This customer data feature is disabled by an administrator.";
}

module.exports = {
  DEFAULT_CONTROLS,
  ensureCustomerFeatureControlsSchema,
  getCustomerFeatureControls,
  updateCustomerFeatureControls,
  getFeatureDisabledMessage,
};
