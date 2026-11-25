-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: verified full database backup and tested restore on a separate staging database.
CREATE TABLE IF NOT EXISTS management_planning_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  assumed_partner_percent TINYINT UNSIGNED NOT NULL DEFAULT 40,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_management_planning_singleton CHECK (id=1),
  CONSTRAINT chk_management_planning_percent CHECK (assumed_partner_percent BETWEEN 0 AND 100)
) ENGINE=InnoDB;
INSERT INTO management_planning_settings (id) VALUES (1)
ON DUPLICATE KEY UPDATE id=management_planning_settings.id;
INSERT INTO schema_migrations (migration_name,description)
VALUES ('20261125_management_planning_settings','Adds adjustable planning assumption without altering recorded transactions.')
ON DUPLICATE KEY UPDATE description=VALUES(description);
