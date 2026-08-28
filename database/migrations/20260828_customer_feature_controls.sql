CREATE TABLE IF NOT EXISTS customer_feature_controls (
    branch_id INT NOT NULL PRIMARY KEY,
    customer_identity_editing_enabled TINYINT(1) NOT NULL DEFAULT 1,
    customer_merge_enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_customer_feature_controls_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

INSERT INTO customer_feature_controls (branch_id, customer_identity_editing_enabled, customer_merge_enabled)
SELECT id, 1, 1
FROM branches
WHERE is_active = TRUE
ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id);
