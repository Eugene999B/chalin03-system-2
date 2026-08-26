-- Additive, idempotent production migration for customer identity feature controls.
CREATE TABLE IF NOT EXISTS customer_feature_controls (
  branch_id INT NOT NULL PRIMARY KEY,
  customer_identity_editing_enabled TINYINT(1) NOT NULL DEFAULT 1,
  customer_merge_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
