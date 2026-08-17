CREATE TABLE IF NOT EXISTS installment_reset_ownership (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_code VARCHAR(80) NOT NULL,
  entity_type ENUM('customer','fleet_asset') NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  ownership_source VARCHAR(120) NOT NULL,
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_installment_reset_ownership_entity (workspace_code, entity_type, entity_id),
  KEY idx_installment_reset_ownership_lookup (entity_type, entity_id),
  KEY idx_installment_reset_ownership_workspace (workspace_code, entity_type)
) ENGINE=InnoDB;

INSERT IGNORE INTO installment_reset_ownership (workspace_code, entity_type, entity_id, ownership_source)
SELECT DISTINCT 'equipment_installment_finance', 'fleet_asset', CAST(registration.entity_id AS UNSIGNED), 'activity_log_installment_machine_registration'
FROM activity_log registration
WHERE registration.entity_type = 'fleet_asset'
  AND registration.entity_id REGEXP '^[0-9]+$'
  AND (registration.action_type = 'equipment.finance.machine.register' OR registration.action = 'EQUIPMENT_FINANCE_MACHINE_REGISTERED')
  AND (registration.workspace_code = 'equipment_installment_finance' OR registration.workspace_code IS NULL);

INSERT IGNORE INTO installment_reset_ownership (workspace_code, entity_type, entity_id, ownership_source)
SELECT DISTINCT 'equipment_installment_finance', 'customer', CAST(registration.entity_id AS UNSIGNED), 'activity_log_installment_customer_registration'
FROM activity_log registration
WHERE registration.entity_id REGEXP '^[0-9]+$'
  AND registration.entity_type IN ('customer','customers','customer_profile','customer_identity')
  AND (LOWER(COALESCE(registration.action_type,'')) LIKE '%customer%register%' OR LOWER(COALESCE(registration.action_type,'')) LIKE '%customer%create%' OR LOWER(COALESCE(registration.action,'')) LIKE '%customer%register%' OR LOWER(COALESCE(registration.action,'')) LIKE '%customer%create%')
  AND (registration.workspace_code = 'equipment_installment_finance' OR registration.workspace_code IS NULL);

INSERT INTO schema_migrations (migration_name, description)
SELECT '20260817_installment_reset_ownership', 'Explicit Installment ownership registry for deterministic reset cleanup.'
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_name = '20260817_installment_reset_ownership');
