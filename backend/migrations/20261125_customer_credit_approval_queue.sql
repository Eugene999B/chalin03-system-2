-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: verified full database backup and tested restore on a separate staging database.
-- Pending credit requests are not sales, receipts, inventory movements or debt.
CREATE TABLE IF NOT EXISTS customer_credit_approval_requests (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 branch_id INT NOT NULL,
 customer_id INT NOT NULL,
 requested_by INT NOT NULL,
 reviewed_by INT NULL,
 request_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 sale_payload JSON NOT NULL,
 new_debt_pesewas BIGINT UNSIGNED NOT NULL,
 score_at_request TINYINT UNSIGNED NOT NULL,
 limit_at_request_pesewas BIGINT UNSIGNED NOT NULL,
 exposure_at_request_pesewas BIGINT UNSIGNED NOT NULL,
 status ENUM('pending','approved','rejected','cancelled','expired','executed') NOT NULL DEFAULT 'pending',
 review_reason VARCHAR(500) NULL,
 expires_at DATETIME NOT NULL,
 reviewed_at DATETIME NULL,
 executed_sale_id INT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_credit_request_key (branch_id,requested_by,request_key),
 UNIQUE KEY uq_credit_request_sale (executed_sale_id),
 INDEX idx_credit_approval_queue (branch_id,status,expires_at),
 INDEX idx_credit_customer_reservation (customer_id,status,expires_at),
 CONSTRAINT fk_credit_request_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
 CONSTRAINT fk_credit_request_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
 CONSTRAINT fk_credit_request_requester FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
 CONSTRAINT fk_credit_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE RESTRICT,
 CONSTRAINT fk_credit_request_sale FOREIGN KEY (executed_sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
 CONSTRAINT chk_credit_request_score CHECK (score_at_request<=100),
 CONSTRAINT chk_credit_request_amount CHECK (new_debt_pesewas>0),
 CONSTRAINT chk_credit_distinct_reviewer CHECK (reviewed_by IS NULL OR reviewed_by<>requested_by)
) ENGINE=InnoDB;

INSERT INTO schema_migrations (migration_name,description)
VALUES ('20261125_customer_credit_approval_queue','Adds isolated credit approval request and reservation records.')
ON DUPLICATE KEY UPDATE description=VALUES(description);
