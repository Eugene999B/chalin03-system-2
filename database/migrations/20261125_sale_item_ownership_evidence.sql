-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: verified full database backup and tested restore on a separate staging database.
-- Explicit per-sale-line ownership evidence; never changes recorded sale values.
-- Unmapped lines remain unclassified, not silently excluded from the full ledger.
CREATE TABLE IF NOT EXISTS sale_item_ownership_classifications (
 sale_item_id INT NOT NULL PRIMARY KEY,
 owner_code ENUM('chalin03','partner','unclassified') NOT NULL DEFAULT 'unclassified',
 evidence_reference VARCHAR(255) NULL,
 classified_by INT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 1,
 classified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_owner_classification_sale_item FOREIGN KEY(sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT,
 CONSTRAINT fk_owner_classification_user FOREIGN KEY(classified_by) REFERENCES users(id) ON DELETE RESTRICT,
 CONSTRAINT chk_owner_classification_evidence CHECK (owner_code='unclassified' OR (evidence_reference IS NOT NULL AND CHAR_LENGTH(TRIM(evidence_reference))>0 AND classified_by IS NOT NULL)),
 INDEX idx_sale_item_ownership_code(owner_code)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sale_item_ownership_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 sale_item_id INT NOT NULL,
 previous_owner ENUM('chalin03','partner','unclassified') NOT NULL,
 new_owner ENUM('chalin03','partner','unclassified') NOT NULL,
 evidence_reference VARCHAR(255) NOT NULL,
 actor_id INT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_owner_event_sale_item FOREIGN KEY(sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT,
 CONSTRAINT fk_owner_event_actor FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE RESTRICT,
 INDEX idx_ownership_events_item(sale_item_id,id)
) ENGINE=InnoDB;
INSERT INTO schema_migrations (migration_name,description)
VALUES ('20261125_sale_item_ownership_evidence','Adds traceable sale line ownership classifications without altering financial records.')
ON DUPLICATE KEY UPDATE description=VALUES(description);
