-- CHALIN 03 EQUIPMENT FINANCE PHASE 3 VERIFIER
-- Every result must be exactly zero.

SELECT COUNT(*) AS missing_operational_polish_tables
FROM (
    SELECT 'equipment_finance_case_drafts' AS table_name
    UNION ALL SELECT 'equipment_finance_case_documents'
    UNION ALL SELECT 'equipment_finance_case_tasks'
    UNION ALL SELECT 'equipment_finance_case_amendments'
    UNION ALL SELECT 'equipment_finance_schedule_simulations'
    UNION ALL SELECT 'equipment_finance_document_shares'
    UNION ALL SELECT 'equipment_finance_case_events'
) required
LEFT JOIN information_schema.TABLES tables_found
  ON tables_found.TABLE_SCHEMA = DATABASE()
 AND tables_found.TABLE_NAME = required.table_name
WHERE tables_found.TABLE_NAME IS NULL;

SELECT COUNT(*) AS missing_operational_polish_columns
FROM (
    SELECT 'equipment_finance_case_drafts' AS table_name, 'version_no' AS column_name
    UNION ALL SELECT 'equipment_finance_case_drafts', 'payload_json'
    UNION ALL SELECT 'equipment_finance_case_drafts', 'progress_json'
    UNION ALL SELECT 'equipment_finance_case_documents', 'file_content'
    UNION ALL SELECT 'equipment_finance_case_documents', 'checksum_sha256'
    UNION ALL SELECT 'equipment_finance_case_documents', 'document_status'
    UNION ALL SELECT 'equipment_finance_case_tasks', 'approval_status'
    UNION ALL SELECT 'equipment_finance_case_tasks', 'assigned_role'
    UNION ALL SELECT 'equipment_finance_case_amendments', 'proposed_changes_json'
    UNION ALL SELECT 'equipment_finance_case_amendments', 'apply_mode'
    UNION ALL SELECT 'equipment_finance_schedule_simulations', 'result_checksum'
    UNION ALL SELECT 'equipment_finance_document_shares', 'share_status'
    UNION ALL SELECT 'equipment_finance_case_events', 'event_metadata_json'
) required
LEFT JOIN information_schema.COLUMNS columns_found
  ON columns_found.TABLE_SCHEMA = DATABASE()
 AND columns_found.TABLE_NAME = required.table_name
 AND columns_found.COLUMN_NAME = required.column_name
WHERE columns_found.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS missing_operational_polish_indexes
FROM (
    SELECT 'equipment_finance_case_drafts' AS table_name, 'uq_finance_case_draft_user_key' AS index_name
    UNION ALL SELECT 'equipment_finance_case_documents', 'idx_finance_case_document_checksum'
    UNION ALL SELECT 'equipment_finance_case_tasks', 'idx_finance_task_inbox'
    UNION ALL SELECT 'equipment_finance_case_amendments', 'idx_finance_amendment_approval'
    UNION ALL SELECT 'equipment_finance_schedule_simulations', 'idx_finance_simulation_application'
    UNION ALL SELECT 'equipment_finance_document_shares', 'idx_finance_share_source'
    UNION ALL SELECT 'equipment_finance_case_events', 'idx_finance_event_application'
) required
LEFT JOIN information_schema.STATISTICS indexes_found
  ON indexes_found.TABLE_SCHEMA = DATABASE()
 AND indexes_found.TABLE_NAME = required.table_name
 AND indexes_found.INDEX_NAME = required.index_name
WHERE indexes_found.INDEX_NAME IS NULL;

SELECT COUNT(*) AS invalid_operational_polish_drafts
FROM equipment_finance_case_drafts
WHERE version_no < 1
   OR completion_percent < 0
   OR completion_percent > 100
   OR JSON_VALID(payload_json) = 0
   OR JSON_VALID(progress_json) = 0;

SELECT COUNT(*) AS invalid_operational_polish_documents
FROM equipment_finance_case_documents
WHERE byte_size < 1
   OR CHAR_LENGTH(checksum_sha256) <> 64
   OR stored_mime_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp')
   OR storage_scope <> 'database_private'
   OR document_status NOT IN ('uploaded','verified','rejected','superseded');

SELECT COUNT(*) AS invalid_operational_polish_amendments
FROM equipment_finance_case_amendments
WHERE CHAR_LENGTH(checksum_sha256) <> 64
   OR JSON_VALID(before_snapshot_json) = 0
   OR JSON_VALID(proposed_changes_json) = 0
   OR amendment_status NOT IN ('draft','pending_approval','approved','rejected','applied','cancelled')
   OR apply_mode NOT IN ('pending','direct_safe_update','numbered_variation','not_applied');

SELECT CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END AS operational_polish_migration_record_missing
FROM schema_migrations
WHERE migration_name = '20260731_equipment_finance_operational_polish';
