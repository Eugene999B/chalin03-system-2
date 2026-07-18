-- CHALIN 03 RELEASE 3E READ-ONLY VERIFICATION

SELECT
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS shared_control_evidence_table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'shared_control_evidence';

SELECT
  CASE WHEN COUNT(*) >= 18 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS required_column_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'shared_control_evidence'
  AND COLUMN_NAME IN (
    'id', 'request_id', 'user_id', 'workspace_code', 'branch_id',
    'mining_site_id', 'hire_location_id', 'context_type', 'context_id',
    'control_area', 'action_type', 'document_type', 'document_id',
    'document_number', 'export_format', 'description', 'metadata_json', 'created_at'
  );

SELECT
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS migration_record_count
FROM schema_migrations
WHERE migration_name = '20260718_release3e_shared_reports_documents_roles_audit';

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS orphan_user_evidence_count
FROM shared_control_evidence sce
LEFT JOIN users u ON u.id = sce.user_id
WHERE sce.user_id IS NOT NULL
  AND u.id IS NULL;

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS invalid_branch_scope_count
FROM shared_control_evidence sce
LEFT JOIN branches b ON b.id = sce.branch_id
WHERE sce.branch_id IS NOT NULL
  AND b.id IS NULL;

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS invalid_mining_scope_count
FROM shared_control_evidence sce
LEFT JOIN mining_sites ms ON ms.id = sce.mining_site_id
WHERE sce.mining_site_id IS NOT NULL
  AND ms.id IS NULL;

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS invalid_hire_scope_count
FROM shared_control_evidence sce
LEFT JOIN business_locations bl ON bl.id = sce.hire_location_id
LEFT JOIN business_units bu ON bu.id = bl.business_unit_id
WHERE sce.hire_location_id IS NOT NULL
  AND (bl.id IS NULL OR bu.code <> 'equipment_hire');

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS invalid_action_count
FROM shared_control_evidence
WHERE action_type NOT IN ('view', 'open', 'download', 'reprint', 'print', 'export');

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS invalid_workspace_scope_count
FROM shared_control_evidence
WHERE workspace_code NOT IN ('spare_parts', 'mining', 'equipment_hire', 'group')
   OR (branch_id IS NOT NULL AND workspace_code <> 'spare_parts')
   OR (mining_site_id IS NOT NULL AND workspace_code <> 'mining')
   OR (hire_location_id IS NOT NULL AND workspace_code <> 'equipment_hire');
