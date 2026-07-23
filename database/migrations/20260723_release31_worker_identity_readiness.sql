-- CHALIN 03 RELEASE 3.1 WORKER IDENTITY READINESS
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED before production execution.
-- Seeds missing workspace counters only; existing counters and worker records are preserved.

INSERT IGNORE INTO worker_identity_sequences (workspace_code, last_number)
VALUES
  ('spare_parts', 0),
  ('mining', 0),
  ('equipment_hire', 0);

UPDATE settings
SET worker_id_card_validity_months = COALESCE(worker_id_card_validity_months, 24),
    worker_employee_number_prefix = COALESCE(NULLIF(worker_employee_number_prefix, ''), 'CH03')
WHERE worker_id_card_validity_months IS NULL
   OR worker_employee_number_prefix IS NULL
   OR worker_employee_number_prefix = '';

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20260723_release31_worker_identity_readiness',
  'Seeds the three workspace worker identity counters and normalizes missing worker card settings through the controlled migration process.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
