const { pool } = require("../config/db");

const DEFAULT_CONTROLS = Object.freeze({
  customer_identity_editing_enabled: true,
  customer_merge_enabled: true,
});

const CONTROL_ACTION = "CUSTOMER_FEATURE_CONTROLS_UPDATED";

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

function parseControlMetadata(value) {
  if (!value) return null;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

async function getCustomerFeatureControls(branchId) {
  const normalizedBranchId = normalizeBranchId(branchId);

  const [rows] = await pool.query(
    `SELECT
       id,
       branch_id,
       metadata_json,
       created_at
     FROM activity_log
     WHERE branch_id = ?
       AND action = ?
     ORDER BY id DESC
     LIMIT 1`,
    [normalizedBranchId, CONTROL_ACTION]
  );

  const row = rows[0] || null;
  const metadata = parseControlMetadata(row?.metadata_json);
  const controls = metadata?.controls || {};

  return {
    branch_id: normalizedBranchId,
    customer_identity_editing_enabled: normalizeFlag(
      controls.customer_identity_editing_enabled,
      DEFAULT_CONTROLS.customer_identity_editing_enabled
    ),
    customer_merge_enabled: normalizeFlag(
      controls.customer_merge_enabled,
      DEFAULT_CONTROLS.customer_merge_enabled
    ),
    created_at: row?.created_at || null,
    updated_at: row?.created_at || null,
  };
}

async function updateCustomerFeatureControls(
  branchId,
  { customer_identity_editing_enabled, customer_merge_enabled } = {},
  userId = null
) {
  const normalizedBranchId = normalizeBranchId(branchId);
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
    `INSERT INTO activity_log (
       branch_id,
       user_id,
       action,
       details,
       workspace_code,
       entity_type,
       action_type,
       metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizedBranchId,
      userId || null,
      CONTROL_ACTION,
      "Updated customer identity editing and customer merge feature controls",
      "spare_parts",
      "customer_feature_controls",
      "update",
      JSON.stringify({
        controls: next,
        changed_at: new Date().toISOString(),
      }),
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
  getCustomerFeatureControls,
  updateCustomerFeatureControls,
  getFeatureDisabledMessage,
};
