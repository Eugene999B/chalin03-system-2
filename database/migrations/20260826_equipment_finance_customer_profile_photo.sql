ALTER TABLE hire_customers
  ADD COLUMN profile_photo_data_url LONGTEXT NULL AFTER risk_notes;

INSERT INTO schema_migrations (migration_name, description)
VALUES ('20260826_equipment_finance_customer_profile_photo', 'Adds an optional normalized customer passport portrait to the shared Hire/Finance customer master.')
ON DUPLICATE KEY UPDATE description = VALUES(description);
